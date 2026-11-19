// The blue-pencil reviewer (DESIGN.md §10): an experienced editor's question in the margin of each paragraph. The
// questions are fixed, set by code, and never come from the model: no cost, no hallucination and the same for any person
// mentioned. Also from here: the note's cycle (stays, gets struck through, is born) and the search for speech in
// transcripts, which the web app uses while the person types. Pure functions, with no Worker dependency.
import { attributionInPassage } from './reporting';

export interface ReviewerBrand { id: string; blocoId: string; trecho: string; estado: string; risco?: string | null; aberta: boolean }

export type NoteKey = 'vitima_ou_menor' | 'acusacao_sem_condenacao' | 'sem_outro_lado' | 'conta' | 'aspa' | 'sem_fonte' | 'sem_fonte_numero' | 'sem_fonte_atribuida' | 'manual';

const QUESTIONS: Record<NoteKey, { pt: string; en: string }> = {
  sem_fonte: { pt: 'Quem disse isso?', en: 'Who said this?' },
  sem_fonte_numero: { pt: 'Quem disse esse número?', en: 'Who gave this number?' },
  sem_fonte_atribuida: { pt: 'Tem o link? Cole no Dossiê.', en: 'Got the link? Paste it in the Dossier.' },
  sem_outro_lado: { pt: 'Você procurou o outro lado?', en: 'Did you reach the other side?' },
  acusacao_sem_condenacao: { pt: 'Há condenação ou fonte oficial?', en: 'Is there a conviction or official source?' },
  vitima_ou_menor: { pt: 'Precisa do nome aqui?', en: 'Does the name need to be here?' },
  conta: { pt: 'Essa conta fecha?', en: 'Does this math add up?' },
  aspa: { pt: 'Essa fala está em alguma fonte?', en: 'Is this quote in any source?' },
  manual: { pt: 'O manual pede outra forma aqui.', en: 'The style guide asks for another form.' },
};

// From most to least serious: a paragraph only shows the first question in this order.
const PRIORITY: NoteKey[] = ['vitima_ou_menor', 'acusacao_sem_condenacao', 'sem_outro_lado', 'conta', 'aspa', 'sem_fonte_atribuida', 'sem_fonte_numero', 'sem_fonte', 'manual'];
const weight = (c: NoteKey) => (c.startsWith('sem_fonte') ? PRIORITY.indexOf('sem_fonte') : PRIORITY.indexOf(c));

export interface Note { blocoId: string; marcaId: string; chave: NoteKey; pt: string; en: string }

/** A mark's question. Only an open mark asks; what already has a source, a recording or the person's decision does not. */
function fromBrandKey(m: ReviewerBrand): NoteKey | null {
  if (!m.aberta) return null;
  if (m.estado === 'risco') return m.risco === 'vitima_ou_menor' || m.risco === 'acusacao_sem_condenacao' || m.risco === 'sem_outro_lado' ? m.risco : null;
  if (m.estado === 'conta' || m.estado === 'aspa' || m.estado === 'manual') return m.estado;
  if (m.estado !== 'sem_fonte') return null;
  // An attributed sentence without a link is still unsourced: the question changes, because now only the document is missing.
  if (attributionInPassage(m.trecho)) return 'sem_fonte_atribuida';
  return /\d/.test(m.trecho) ? 'sem_fonte_numero' : 'sem_fonte';
}

/** At most one note per paragraph: the most serious; on a tie, the first mark's. */
export function notesText(marks: ReviewerBrand[]): Note[] {
  const perBlock = new Map<string, Note>();
  for (const m of marks) {
    const key = fromBrandKey(m);
    if (!key) continue;
    const current = perBlock.get(m.blocoId);
    if (!current || weight(key) < weight(current.chave)) perBlock.set(m.blocoId, { blocoId: m.blocoId, marcaId: m.id, chave: key, ...QUESTIONS[key] });
  }
  return [...perBlock.values()];
}

// ── the note's cycle ────────────────────────────────────────────────────────────────────────────────────────────

export type PhaseNote = 'pronta' | 'nasce' | 'risca';
export type NoteLive = Note & { fase: PhaseNote };

export interface OptionsCycle {
  /** Blocks with text: a deleted block's note goes away without ceremony. */
  existem: Set<string>;
  /** Blocks without a valid check right now (edited, checking, failed): the earlier note stays as it is. */
  espera: Set<string>;
  /** The paragraph the person is writing in gets no new note. */
  cursor: string | null;
  /** False when the text opens: everything comes in ready, including in the cursor's paragraph. */
  sessao: boolean;
  /** False with `prefers-reduced-motion`: a note that would leave struck through leaves at once, and a new one comes in ready. */
  animar: boolean;
}

/** What the margin shows after a change: `alvo` is what the marks ask for now, `vivas` what is already on screen. */
export function reconcileNotes(live: NoteLive[], target: Note[], o: OptionsCycle): NoteLive[] {
  const requested = new Map(target.map((n) => [n.blocoId, n]));
  const stay = new Set<string>();
  const output: NoteLive[] = [];
  for (const v of live) {
    if (!o.existem.has(v.blocoId)) continue;
    if (v.fase === 'risca') { if (o.animar) output.push(v); continue; }
    if (o.espera.has(v.blocoId)) { output.push(v); stay.add(v.blocoId); continue; }
    const n = requested.get(v.blocoId);
    if (n?.chave === v.chave) { output.push({ ...n, fase: v.fase }); stay.add(v.blocoId); }
    else if (o.animar && !output.some((x) => x.fase === 'risca' && x.blocoId === v.blocoId && x.chave === v.chave)) output.push({ ...v, fase: 'risca' });
  }
  for (const n of target) {
    if (stay.has(n.blocoId) || o.espera.has(n.blocoId) || !o.existem.has(n.blocoId)) continue;
    if (o.sessao && o.cursor === n.blocoId) continue;
    output.push({ ...n, fase: o.sessao && o.animar ? 'nasce' : 'pronta' });
  }
  return output;
}

// ── speech from the recording ───────────────────────────────────────────────────────────────────────────────────

const normal = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const WORD = /[\p{L}\p{M}\p{N}]+/gu;

export interface OpenQuote { inicio: number; digitado: string; fecha: string }

/** The quote mark opened before the cursor, with what came after it. An already closed quote does not count. */
export function openQuote(before: string): OpenQuote | null {
  let home = -1, closes = '';
  for (let i = 0; i < before.length; i++) {
    const c = before[i];
    if (c === '“') { home = i; closes = '”'; }
    else if (c === '«') { home = i; closes = '»'; }
    else if (c === '”' || c === '»') home = -1;
    else if (c === '"') {
      if (home >= 0 && closes === '"') home = -1;
      else if (home < 0) { home = i; closes = '"'; }
    }
  }
  return home < 0 ? null : { inicio: home, digitado: before.slice(home + 1), fecha: closes };
}

export interface SpeechPassage { gravacao: string; nome: string; inicio: number; texto: string }
export interface SpeechFound { trecho: SpeechPassage; resto: string }

/** Where to stop inside the literal word, after `n` unaccented letters: "ônibus" with 3 letters stops at "ôni|bus". */
function cutInWord(word: string, n: number) {
  let read = 0, after = 0;
  for (const c of word) {
    if (read >= n) break;
    read += normal(c).length;
    after += c.length;
  }
  return after;
}

/**
 * Looks up what was typed after the quote mark, word by word, without accents or case. The last word may be half
 * typed, unless the person has already moved past it. Returns the speech and its literal remainder, which is the only
 * text the screen inserts. Fewer than 3 words, or the speech already complete: nothing.
 */
export function findSpeech(typed: string, passages: SpeechPassage[]): SpeechFound | null {
  const q = normal(typed).match(WORD) ?? [];
  if (q.length < 3) return null;
  const byHalf = /[\p{L}\p{M}\p{N}]$/u.test(typed);
  const last = q[q.length - 1];
  for (const passage of passages) {
    const found = [...passage.texto.matchAll(WORD)];
    const ws = found.map((m) => normal(m[0]));
    for (let i = 0; i + q.length <= ws.length; i++) {
      let k = 0;
      while (k < q.length - 1 && ws[i + k] === q[k]) k++;
      if (k < q.length - 1) continue;
      const target = ws[i + k];
      if (!(target === last || (byHalf && target.startsWith(last)))) continue;
      const m = found[i + k];
      let rest = passage.texto.slice(m.index + (target === last ? m[0].length : cutInWord(m[0], last.length))).trimEnd();
      if (/\s$/.test(typed)) rest = rest.trimStart();
      else if (!byHalf && rest[0] === typed.at(-1)) rest = rest.slice(1).trimStart();
      if (!/[\p{L}\p{N}]/u.test(rest)) return null;
      return { trecho: passage, resto: rest };
    }
  }
  return null;
}
