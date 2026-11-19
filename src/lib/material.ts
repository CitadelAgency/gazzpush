import type { Env } from '../env';
import { newId, recordEvent } from './db';
import { findInRecording } from './recording';
import { DeskError, readText } from './desk';
import {
  NOTE_MAX, CLIPPINGS_PER_TEXT, PASSAGE_MAX, PASSAGE_MIN, MIN_DOCUMENT_PASSAGE, SEARCH_MAX, findInText, double, joinSpaces, paragraphsSource,
  termsSearch, inSourcePassage, type Found,
} from './clipping';

// Material on the side: the editor's source organiser. Clippings (a literal passage from a source, or the person's note)
// per text, the source's stored text to read alongside, a single search across the text's sources and the outlet's
// library (sources and clippings saved from other texts, to bring in without reading, processing or transcribing again).
// All by code, no model. The literal check is clipping.ts's, the same one the screen uses.

const error = (code: string, pt: string, en: string, status: 400 | 404 | 409 | 422 = 400) => new DeskError(code, pt, status, en);
const notFound = () => error('nao_encontrado', 'não encontrado', 'not found', 404);

export const ORIGINS_CLIPPING = ['evidencia', 'documento', 'gravacao', 'nota'] as const;
export type ClippingOrigin = (typeof ORIGINS_CLIPPING)[number];

export interface Clipping {
  id: string; origem: ClippingOrigin; evidenciaId: string | null; arquivoId: string | null; pagina: number | null; inicio: number | null;
  trecho: string; nota: string | null; fonte: { nome: string | null; url: string | null };
  /** The source is still in this text (the evidence may have left the dossier; the clipping stays). A note: always. */
  fonteExiste: boolean;
  /** Can go to the library: a note, PDF, recording or link. The other side's reply and the LAI one stay with their text. */
  compartilhavel: boolean;
  acervo: boolean; ordem: number; por: string; porNome: string | null; criadoEm: string;
}

interface ClippingLine {
  id: string; tenant_id: string; texto_id: string; origem: string; evidencia_id: string | null; arquivo_id: string | null; pagina: number | null; inicio: number | null;
  trecho: string; nota: string | null; fonte_nome: string | null; fonte_url: string | null; acervo: number; ordem: number; por: string; created_at: string;
}

export async function clippingsText(env: Env, tenantId: string, textId: string): Promise<Clipping[]> {
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.origem, r.evidencia_id, r.arquivo_id, r.pagina, r.inicio, r.trecho, r.nota, r.fonte_nome, r.fonte_url, r.acervo, r.ordem, r.por, r.created_at,
            u.name AS por_nome, e.origem AS ev_origem, a.id AS arq_id
       FROM recortes r
       LEFT JOIN "user" u ON u.id = r.por
       LEFT JOIN evidencias e ON e.id = r.evidencia_id AND e.texto_id = r.texto_id AND e.tenant_id = r.tenant_id
       LEFT JOIN arquivos a ON a.id = r.arquivo_id AND a.texto_id = r.texto_id AND a.tenant_id = r.tenant_id
      WHERE r.tenant_id = ? AND r.texto_id = ? ORDER BY r.ordem, r.created_at, r.rowid`,
  ).bind(tenantId, textId).all<ClippingLine & { por_nome: string | null; ev_origem: string | null; arq_id: string | null }>();
  return results.map((r) => ({
    id: r.id, origem: r.origem as ClippingOrigin, evidenciaId: r.evidencia_id, arquivoId: r.arquivo_id, pagina: r.pagina, inicio: r.inicio,
    trecho: r.trecho, nota: r.nota, fonte: { nome: r.fonte_nome, url: r.fonte_url },
    fonteExiste: r.origem === 'nota' || (r.origem === 'evidencia' ? !!r.ev_origem : !!r.arq_id),
    compartilhavel: r.origem !== 'evidencia' || r.ev_origem === 'link' || (!r.ev_origem && !!r.fonte_url),
    acervo: r.acervo === 1, ordem: r.ordem, por: r.por, porNome: r.por_nome, criadoEm: r.created_at,
  }));
}

/** The text of a page or of the transcript; null: the source is not in the text. */
async function fromSourceClippingText(env: Env, tenantId: string, textId: string, originKind: ClippingOrigin, b: Record<string, unknown>) {
  if (originKind === 'evidencia') {
    if (typeof b.evidenciaId !== 'string') throw error('fonte', 'evidenciaId: texto', 'evidenciaId: string');
    const e = await env.DB.prepare('SELECT id, url, titulo, origem, r2_texto FROM evidencias WHERE id = ? AND texto_id = ? AND tenant_id = ?')
      .bind(b.evidenciaId, textId, tenantId).first<{ id: string; url: string; titulo: string | null; origem: string; r2_texto: string }>();
    if (!e) throw notFound();
    const text = (await env.MEDIA.get(e.r2_texto).then((x) => x?.text())) ?? '';
    return { texto: text, evidenciaId: e.id, arquivoId: null, pagina: null, nome: e.titulo ?? e.url, url: e.origem === 'link' ? e.url : null, trechos: null };
  }
  if (typeof b.arquivoId !== 'string') throw error('fonte', 'arquivoId: texto', 'arquivoId: string');
  const a = await env.DB.prepare('SELECT id, nome, estado FROM arquivos WHERE id = ? AND texto_id = ? AND tenant_id = ? AND tipo = ?')
    .bind(b.arquivoId, textId, tenantId, originKind === 'documento' ? 'pdf' : 'audio').first<{ id: string; nome: string; estado: string }>();
  if (!a) throw notFound();
  if (a.estado !== 'pronto') throw error('nao_pronto', 'Essa fonte ainda não foi lida (ou a leitura falhou).', "That source hasn't been read yet (or reading failed).", 409);
  if (originKind === 'documento') {
    const page = Number(b.pagina);
    const p = Number.isInteger(page) ? await env.DB.prepare('SELECT texto FROM arquivo_paginas WHERE arquivo_id = ? AND tenant_id = ? AND pagina = ?').bind(a.id, tenantId, page).first<{ texto: string }>() : null;
    if (!p) throw error('pagina', 'Essa página não existe no documento.', "That page doesn't exist in the document.", 422);
    return { texto: p.texto, evidenciaId: null, arquivoId: a.id, pagina: page, nome: a.nome, url: null, trechos: null };
  }
  const { results } = await env.DB.prepare('SELECT inicio, fim, texto, palavras_json FROM gravacao_trechos WHERE arquivo_id = ? AND tenant_id = ? ORDER BY n')
    .bind(a.id, tenantId).all<{ inicio: number; fim: number; texto: string; palavras_json: string }>();
  // Passages joined by a space: a selection that takes the end of one and the start of the next stays literal.
  const passages = results.map((r) => ({ ...r, texto: joinSpaces(r.texto) })).filter((r) => r.texto);
  return { texto: passages.map((r) => r.texto).join(' '), evidenciaId: null, arquivoId: a.id, pagina: null, nome: a.nome, url: null, trechos: passages };
}

/** The second the passage starts in the recording: the word's, if the speech matches word for word there; otherwise, the passage's. */
function inRecordingHome(passage: string, passages: { inicio: number; fim: number; texto: string; palavras_json: string }[], fileId: string, fileName: string): number {
  let after = 0;
  const target = joinSpaces(passage);
  const where = passages.map((r) => r.texto).join(' ').indexOf(target);
  for (const r of passages) {
    if (where < after + r.texto.length + 1) {
      const g = findInRecording(target, [{ id: fileId, nome: fileName, trechos: passages.map((x) => ({ inicio: x.inicio, fim: x.fim, texto: x.texto, palavras: JSON.parse(x.palavras_json) })) }]);
      return g && g.inicio >= r.inicio - 0.5 && g.inicio <= r.fim + 0.5 ? g.inicio : r.inicio;
    }
    after += r.texto.length + 1;
  }
  return passages[0]?.inicio ?? 0;
}

interface NewClipping {
  origem: ClippingOrigin; evidenciaId: string | null; arquivoId: string | null; pagina: number | null; inicio: number | null;
  trecho: string; nota: string | null; fonteNome: string | null; fonteUrl: string | null;
}

/**
 * Stores the clipping at the end of the list. The same clipping again (same source, same page, same passage) returns
 * the existing one (the unique index decides, with no race); the per-text clipping cap applies inside the same INSERT.
 */
async function insertClipping(env: Env, tenantId: string, textId: string, actor: string, r: NewClipping): Promise<{ id: string; existia: boolean }> {
  const id = newId();
  const created = await env.DB.prepare(
    `INSERT INTO recortes (id, tenant_id, texto_id, origem, evidencia_id, arquivo_id, pagina, inicio, trecho, nota, fonte_nome, fonte_url, ordem, por)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT MAX(ordem) FROM recortes WHERE texto_id = ? AND tenant_id = ?), 0) + 1, ?
      WHERE (SELECT COUNT(*) FROM recortes WHERE texto_id = ? AND tenant_id = ?) < ?
     ON CONFLICT DO NOTHING RETURNING id`,
  ).bind(id, tenantId, textId, r.origem, r.evidenciaId, r.arquivoId, r.pagina, r.inicio, r.trecho, r.nota, r.fonteNome, r.fonteUrl, textId, tenantId, actor,
    textId, tenantId, CLIPPINGS_PER_TEXT).first<{ id: string }>();
  if (created) return { id, existia: false };
  const already = await env.DB.prepare(
    `SELECT id FROM recortes WHERE texto_id = ? AND tenant_id = ? AND origem = ? AND IFNULL(evidencia_id, '') = ? AND IFNULL(arquivo_id, '') = ? AND IFNULL(pagina, -1) = ? AND trecho = ?`,
  ).bind(textId, tenantId, r.origem, r.evidenciaId ?? '', r.arquivoId ?? '', r.pagina ?? -1, r.trecho).first<{ id: string }>();
  if (already) return { id: already.id, existia: true };
  throw error('teto', `Este texto já tem ${CLIPPINGS_PER_TEXT} recortes. Tire os que não vai usar.`, `This text already has ${CLIPPINGS_PER_TEXT} clippings. Remove the ones you won't use.`, 409);
}

const noteOf = (v: unknown) => {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw error('nota', 'nota: texto', 'nota: string');
  const n = joinSpaces(v);
  if (n.length > NOTE_MAX) throw error('nota', `A anotação passa de ${NOTE_MAX} caracteres.`, `The note is over ${NOTE_MAX} characters.`);
  return n || null;
};

/**
 * Saves a clipping. From a source (evidence, PDF page, transcript): the passage must be, letter for letter, in its
 * stored text (only whitespace may differ), otherwise 422. A note (`origem: nota`): the text is the person's, unchecked.
 */
export async function createClipping(env: Env, tenantId: string, textId: string, actor: string, b: Record<string, unknown>): Promise<{ id: string; existia: boolean }> {
  await readText(env, tenantId, textId);
  if (!(ORIGINS_CLIPPING as readonly unknown[]).includes(b.origem)) throw error('origem', `origem: um de ${ORIGINS_CLIPPING.join(', ')}`, `origem: one of ${ORIGINS_CLIPPING.join(', ')}`);
  const origin = b.origem as ClippingOrigin;
  const passage = typeof b.trecho === 'string' ? joinSpaces(b.trecho) : '';
  // In an own note, the text is the passage; the note about a clipping only exists on a clipping from a source.
  if (origin === 'nota') {
    if (!passage || passage.length > PASSAGE_MAX) throw error('trecho', `Escreva a anotação (até ${PASSAGE_MAX} caracteres).`, `Write the note (up to ${PASSAGE_MAX} characters).`);
    return insertClipping(env, tenantId, textId, actor, { origem: origin, evidenciaId: null, arquivoId: null, pagina: null, inicio: null, trecho: passage, nota: null, fonteNome: null, fonteUrl: null });
  }
  const note = noteOf(b.nota);
  const min = origin === 'documento' ? MIN_DOCUMENT_PASSAGE : PASSAGE_MIN;
  if (passage.length < min || passage.length > PASSAGE_MAX) {
    throw error('trecho', `Selecione um trecho de ${min} a ${PASSAGE_MAX} caracteres na fonte.`, `Select a passage of ${min} to ${PASSAGE_MAX} characters in the source.`);
  }
  const f = await fromSourceClippingText(env, tenantId, textId, origin, b);
  if (!inSourcePassage(f.texto, passage)) {
    throw error('trecho_fora', 'Esse trecho não está, letra por letra, no texto guardado da fonte. Selecione de novo no leitor.', "That passage is not, word for word, in the source's saved text. Select it again in the reader.", 422);
  }
  const home = f.trechos ? inRecordingHome(passage, f.trechos, f.arquivoId!, f.nome) : null;
  return insertClipping(env, tenantId, textId, actor, { origem: origin, evidenciaId: f.evidenciaId, arquivoId: f.arquivoId, pagina: f.pagina, inicio: home, trecho: passage, nota: note, fonteNome: f.nome.slice(0, 300), fonteUrl: f.url });
}

/**
 * Note (`nota`), library (`acervo`), move (`mover`: up | down, or `posicao`, from 0). A source's passage does not change
 * (it is literal); an own note's text does (`trecho`). false: the clipping does not belong to this text.
 */
export async function changeClipping(env: Env, tenantId: string, textId: string, clippingId: string, b: Record<string, unknown>): Promise<boolean> {
  await readText(env, tenantId, textId);
  const r = (await clippingsText(env, tenantId, textId)).find((x) => x.id === clippingId);
  if (!r) return false;
  const sets: string[] = [];
  const binds: unknown[] = [];
  if ('nota' in b) { sets.push('nota = ?'); binds.push(noteOf(b.nota)); }
  if ('trecho' in b) {
    if (r.origem !== 'nota') throw error('trecho_literal', 'O trecho de uma fonte não muda. Guarde outro recorte.', "A source passage can't change. Save another clipping.", 422);
    const passage = typeof b.trecho === 'string' ? joinSpaces(b.trecho) : '';
    if (!passage || passage.length > PASSAGE_MAX) throw error('trecho', `Escreva a anotação (até ${PASSAGE_MAX} caracteres).`, `Write the note (up to ${PASSAGE_MAX} characters).`);
    sets.push('trecho = ?'); binds.push(passage);
  }
  if ('acervo' in b) {
    if (typeof b.acervo !== 'boolean') throw error('acervo', 'acervo: verdadeiro ou falso', 'acervo: true or false');
    if (b.acervo && !r.compartilhavel) {
      throw error('nao_compartilhavel', 'Este recorte vem de uma resposta que fica neste texto. Para usar em outro, guarde como anotação.', 'This clipping comes from a reply that stays in this text. To use it elsewhere, save it as a note.', 422);
    }
    sets.push('acervo = ?'); binds.push(b.acervo ? 1 : 0);
  }
  const move = b.mover === 'cima' || b.mover === 'baixo' ? b.mover : null;
  const position = Number.isInteger(b.posicao) && (b.posicao as number) >= 0 ? (b.posicao as number) : null;
  if ((b.mover !== undefined && !move) || (b.posicao !== undefined && position === null)) throw error('mover', 'mover: cima ou baixo; posicao: inteiro a partir de 0', 'mover: cima or baixo; posicao: integer from 0');
  if (!sets.length && !move && position === null) throw error('nada', 'Diga o que mudar: nota, acervo, mover ou posicao.', 'Say what to change: nota, acervo, mover or posicao.');
  const stmts: D1PreparedStatement[] = [];
  if (sets.length) stmts.push(env.DB.prepare(`UPDATE recortes SET ${sets.join(', ')} WHERE id = ? AND texto_id = ? AND tenant_id = ?`).bind(...binds, clippingId, textId, tenantId));
  if (move || position !== null) {
    // The whole list's new order (up to 200), numbered from 1: moving the first up or the last down changes nothing.
    const ids = (await clippingsText(env, tenantId, textId)).map((x) => x.id);
    const from = ids.indexOf(clippingId);
    const to = Math.max(0, Math.min(ids.length - 1, move === 'cima' ? from - 1 : move === 'baixo' ? from + 1 : position!));
    ids.splice(from, 1);
    ids.splice(to, 0, clippingId);
    stmts.push(...ids.map((id, i) => env.DB.prepare('UPDATE recortes SET ordem = ? WHERE id = ? AND texto_id = ? AND tenant_id = ?').bind(i + 1, id, textId, tenantId)));
  }
  try {
    await env.DB.batch(stmts);
  } catch (e) {
    if (String(e).includes('UNIQUE')) throw error('existe', 'Já há uma anotação igual neste texto.', 'There is already an identical note in this text.', 409);
    throw e;
  }
  return true;
}

export async function removeClipping(env: Env, tenantId: string, textId: string, clippingId: string): Promise<boolean> {
  await readText(env, tenantId, textId);
  const r = await env.DB.prepare('DELETE FROM recortes WHERE id = ? AND texto_id = ? AND tenant_id = ? RETURNING id').bind(clippingId, textId, tenantId).first();
  return !!r;
}

// ── side reader ────────────────────────────────────────────────────────────────────────────────────────────────────

/** The evidence's stored text in paragraphs (`paragraphsSource`): the clipping comes from it and is checked against it. */
export async function fromEvidenceText(env: Env, tenantId: string, textId: string, evidenceId: string) {
  await readText(env, tenantId, textId);
  const e = await env.DB.prepare('SELECT id, url, titulo, origem, r2_texto, conferida_em, mudou_em FROM evidencias WHERE id = ? AND texto_id = ? AND tenant_id = ?')
    .bind(evidenceId, textId, tenantId).first<{ id: string; url: string; titulo: string | null; origem: string; r2_texto: string; conferida_em: string; mudou_em: string | null }>();
  if (!e) throw notFound();
  const text = await env.MEDIA.get(e.r2_texto).then((x) => x?.text());
  if (text === undefined) throw error('texto_sumiu', 'O texto guardado desta fonte sumiu do armazenamento.', "This source's saved text is missing from storage.", 404);
  return {
    id: e.id, titulo: e.titulo, origem: e.origem as 'link' | 'resposta' | 'documento' | 'lai',
    // Only a link has an original page to open (a reply and a PDF passage have internal addresses).
    url: e.origem === 'link' ? e.url : null,
    conferidaEm: e.conferida_em, mudouEm: e.mudou_em, paragrafos: paragraphsSource(text),
  };
}

export const PAGES_PER_REQUEST = 10;
const CHARS_PER_REQUEST = 200_000;

/**
 * The text of the PDF pages from `de` to `ate` (at most 10 pages and 200k characters per request; the window's first
 * page always comes). `proxima`: the page where the next window starts, or null at the end.
 */
export async function pagesDocument(env: Env, tenantId: string, textId: string, fileId: string, raw: unknown, untilRaw: unknown) {
  await readText(env, tenantId, textId);
  const a = await env.DB.prepare("SELECT id, nome, estado, paginas FROM arquivos WHERE id = ? AND texto_id = ? AND tenant_id = ? AND tipo = 'pdf'")
    .bind(fileId, textId, tenantId).first<{ id: string; nome: string; estado: string; paginas: number | null }>();
  if (!a) throw notFound();
  if (a.estado !== 'pronto') throw error('nao_pronto', 'O documento ainda não foi lido (ou a leitura falhou).', "The document hasn't been read yet (or reading failed).", 409);
  const from = raw === undefined || raw === '' ? 1 : Number(raw);
  const untilWants = untilRaw === undefined || untilRaw === '' ? from + PAGES_PER_REQUEST - 1 : Number(untilRaw);
  if (!Number.isInteger(from) || from < 1 || !Number.isInteger(untilWants) || untilWants < from) throw error('paginas', 'de e ate: páginas a partir de 1, com ate depois de de', 'de and ate: pages from 1, with ate after de');
  const until = Math.min(untilWants, from + PAGES_PER_REQUEST - 1);
  const { results } = await env.DB.prepare('SELECT pagina, texto FROM arquivo_paginas WHERE arquivo_id = ? AND tenant_id = ? AND pagina BETWEEN ? AND ? ORDER BY pagina')
    .bind(a.id, tenantId, from, until).all<{ pagina: number; texto: string }>();
  const pages: { pagina: number; paragrafos: string[] }[] = [];
  let used = 0;
  for (const p of results) {
    if (pages.length && used + p.texto.length > CHARS_PER_REQUEST) break;
    used += p.texto.length;
    pages.push({ pagina: p.pagina, paragrafos: paragraphsSource(p.texto) });
  }
  const last = pages.at(-1)?.pagina ?? until;
  const total = a.paginas ?? 0;
  return { arquivoId: a.id, nome: a.nome, total, paginas: pages, proxima: last < total ? last + 1 : null };
}

// ── single search ──────────────────────────────────────────────────────────────────────────────────────────────────

const FINDINGS_PER_SOURCE = 5;
const TOTAL_FINDINGS = 60;
/** Per request (the screen asks with a typing debounce): up to 40 pieces of evidence and 3 MB from R2; the rest is left out and the response says so. */
const EVIDENCE_IN_SEARCH = 40;
const BYTES_R2_IN_SEARCH = 3_000_000;
const PAGES_IN_SEARCH = 40;
const PASSAGES_IN_SEARCH = 5_000;

export type FoundType = 'recortes' | 'evidencia' | 'documento' | 'gravacao';
export interface SearchGroup {
  tipo: FoundType;
  /** Evidence or file; for clippings, null (each hit names its clipping). */
  id: string | null;
  nome: string | null;
  achados: (Found & { paragrafo?: number; pagina?: number; inicio?: number; recorteId?: string })[];
  /** There were more hits in this source than the per-source cap. */
  mais: boolean;
}

/**
 * A single search, accent- and case-insensitive, across everything the text has: clippings, evidence (paragraph by
 * paragraph, with the same index as the reader), PDF pages (FTS5, by word prefix; the hit comes from the page's
 * paragraph) and transcripts (a passage with its second). All words must be in the same paragraph, page or passage.
 * Caps per source, in total and on R2 reads: `cortado` says when one applied.
 */
export async function fetchInMaterial(env: Env, tenantId: string, textId: string, q: unknown) {
  await readText(env, tenantId, textId);
  const query = typeof q === 'string' ? joinSpaces(q).slice(0, SEARCH_MAX) : '';
  const terms = termsSearch(query);
  if (!terms.length) throw error('busca', 'Escreva pelo menos duas letras para procurar.', 'Type at least two letters to search.');
  const groups: SearchGroup[] = [];
  let total = 0, cut = false;
  const group = (g: Omit<SearchGroup, 'achados' | 'mais'>) => {
    const created: SearchGroup = { ...g, achados: [], mais: false };
    return {
      add:(a: SearchGroup['achados'][number]) => {
        if (created.achados.length >= FINDINGS_PER_SOURCE) { created.mais = true; return; }
        if (total >= TOTAL_FINDINGS) { cut = true; return; }
        created.achados.push(a); total++;
      },
      fim: () => { if (created.achados.length) groups.push(created); if (created.mais) cut = true; },
    };
  };

  // Clippings: the passage, or the person's note about it.
  const g0 = group({ tipo: 'recortes', id: null, nome: null });
  for (const r of await clippingsText(env, tenantId, textId)) {
    const a = findInText(r.trecho, terms) ?? (r.nota ? findInText(r.nota, terms) : null);
    if (a) g0.add({ ...a, recorteId: r.id });
  }
  g0.fim();

  // Evidence: the text stored in R2, read here with a cap (search cannot load the whole dossier on every keystroke).
  const { results: evs } = await env.DB.prepare('SELECT id, url, titulo, r2_texto FROM evidencias WHERE texto_id = ? AND tenant_id = ? ORDER BY created_at, rowid LIMIT ?')
    .bind(textId, tenantId, EVIDENCE_IN_SEARCH + 1).all<{ id: string; url: string; titulo: string | null; r2_texto: string }>();
  if (evs.length > EVIDENCE_IN_SEARCH) cut = true;
  let read = 0;
  for (const e of evs.slice(0, EVIDENCE_IN_SEARCH)) {
    if (read >= BYTES_R2_IN_SEARCH) { cut = true; break; }
    const text = (await env.MEDIA.get(e.r2_texto).then((x) => x?.text())) ?? '';
    read += text.length;
    const g = group({ tipo: 'evidencia', id: e.id, nome: e.titulo ?? e.url });
    paragraphsSource(text).forEach((p, i) => { const a = findInText(p, terms); if (a) g.add({ ...a, paragrafo: i }); });
    g.fim();
  }

  const { results: files } = await env.DB.prepare("SELECT id, tipo, nome FROM arquivos WHERE texto_id = ? AND tenant_id = ? AND estado = 'pronto' ORDER BY created_at, rowid")
    .bind(textId, tenantId).all<{ id: string; tipo: string; nome: string }>();
  const names = new Map(files.map((a) => [a.id, a.nome]));

  // PDFs: the pages the word index finds (all words, by word prefix, accent-insensitive).
  if (files.some((a) => a.tipo === 'pdf')) {
    const fts = terms.map((t) => `"${t.replace(/"/g, '')}"*`).join(' ');
    let pages: { arquivo_id: string; pagina: number; texto: string }[] = [];
    try {
      ({ results: pages } = await env.DB.prepare(
        `SELECT arquivo_id, pagina, texto FROM arquivo_paginas_fts WHERE arquivo_paginas_fts MATCH ? AND tenant_id = ?
            AND arquivo_id IN (SELECT id FROM arquivos WHERE texto_id = ? AND tenant_id = ? AND tipo = 'pdf' AND estado = 'pronto') ORDER BY rank LIMIT ?`,
      ).bind(fts, tenantId, textId, tenantId, PAGES_IN_SEARCH + 1).all<{ arquivo_id: string; pagina: number; texto: string }>());
    } catch (e) {
      // A query FTS5 cannot parse (punctuation only): no PDF hits, the rest of the search still applies.
      console.error('busca no material: fts', String(e).slice(0, 200));
    }
    if (pages.length > PAGES_IN_SEARCH) cut = true;
    const perFile = new Map<string, { pagina: number; texto: string }[]>();
    for (const p of pages.slice(0, PAGES_IN_SEARCH)) perFile.set(p.arquivo_id, [...(perFile.get(p.arquivo_id) ?? []), p]);
    for (const [fileId, ps] of perFile) {
      const g = group({ tipo: 'documento', id: fileId, nome: names.get(fileId) ?? null });
      for (const p of ps.sort((x, y) => x.pagina - y.pagina)) {
        paragraphsSource(p.texto).forEach((pair, i) => { const a = findInText(pair, terms); if (a) g.add({ ...a, pagina: p.pagina, paragrafo: i }); });
      }
      g.fim();
    }
  }

  // Transcripts: each passage, with the second it starts at.
  if (files.some((a) => a.tipo === 'audio')) {
    const { results: passages } = await env.DB.prepare(
      `SELECT g.arquivo_id, g.inicio, g.texto FROM gravacao_trechos g JOIN arquivos a ON a.id = g.arquivo_id AND a.tenant_id = g.tenant_id
        WHERE g.tenant_id = ? AND a.texto_id = ? AND a.tipo = 'audio' AND a.estado = 'pronto' ORDER BY a.created_at, g.arquivo_id, g.n LIMIT ?`,
    ).bind(tenantId, textId, PASSAGES_IN_SEARCH + 1).all<{ arquivo_id: string; inicio: number; texto: string }>();
    if (passages.length > PASSAGES_IN_SEARCH) cut = true;
    let current: ReturnType<typeof group> | null = null, from = '';
    for (const t of passages.slice(0, PASSAGES_IN_SEARCH)) {
      if (t.arquivo_id !== from) { current?.fim(); current = group({ tipo: 'gravacao', id: t.arquivo_id, nome: names.get(t.arquivo_id) ?? null }); from = t.arquivo_id; }
      const a = findInText(joinSpaces(t.texto), terms);
      if (a) current!.add({ ...a, inicio: t.inicio });
    }
    current?.fim();
  }
  return { q: query, termos: terms, grupos: groups, cortado: cut };
}

// ── outlet library ─────────────────────────────────────────────────────────────────────────────────────────────────

const ARCHIVE_LINES = 2_000;
const ARCHIVE_MAX = 100;

export interface ArchiveSource {
  tipo: 'link' | 'documento' | 'gravacao'; id: string; nome: string; url: string | null;
  /** Which text it came from (the most recent use) and when it entered it. */
  texto: { id: string; titulo: string }; em: string;
  /** In how many of the outlet's texts this source appears (the same address, the same file). */
  textos: number;
  /** Already in the `menos` text (bringing it returns the existing one). */
  jaNoTexto: boolean;
  paginas: number | null; duracao: number | null;
}

/**
 * The outlet's library: other texts' sources (links by address, PDFs and recordings by sha256, without repeats: the
 * most recent use counts) and the clippings saved to the library. Only what can be brought in: a link, a read PDF, a
 * fully transcribed recording (no segment left to assemble). `q` filters without accents or case; `cortado` says when
 * the cap applied.
 */
export async function archiveOutlet(env: Env, tenantId: string, less: string | null, q: unknown) {
  const terms = typeof q === 'string' ? termsSearch(q.slice(0, SEARCH_MAX)) : [];
  const home = (...fields: (string | null | undefined)[]) => { const t = double(fields.filter(Boolean).join(' ')); return terms.every((x) => t.includes(x)); };
  const [links, files, recs, recsInText] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare(`SELECT e.id, e.url, e.titulo, e.texto_id, t.titulo AS texto_titulo, e.created_at FROM evidencias e JOIN textos t ON t.id = e.texto_id AND t.tenant_id = e.tenant_id
                     WHERE e.tenant_id = ? AND e.origem = 'link' ORDER BY e.created_at DESC, e.rowid DESC LIMIT ?`).bind(tenantId, ARCHIVE_LINES),
    env.DB.prepare(`SELECT a.id, a.tipo, a.nome, a.sha256, a.paginas, a.duracao, a.texto_id, t.titulo AS texto_titulo, a.created_at FROM arquivos a JOIN textos t ON t.id = a.texto_id AND t.tenant_id = a.tenant_id
                     WHERE a.tenant_id = ? AND a.estado = 'pronto' AND a.tipo IN ('pdf', 'audio')
                       AND NOT EXISTS (SELECT 1 FROM gravacao_segmentos s WHERE s.arquivo_id = a.id AND s.tenant_id = a.tenant_id AND s.r2 IS NULL)
                     ORDER BY a.created_at DESC, a.rowid DESC LIMIT ?`).bind(tenantId, ARCHIVE_LINES),
    env.DB.prepare(`SELECT r.id, r.origem, r.trecho, r.nota, r.fonte_nome, r.fonte_url, r.pagina, r.inicio, r.texto_id, t.titulo AS texto_titulo, r.created_at
                      FROM recortes r JOIN textos t ON t.id = r.texto_id AND t.tenant_id = r.tenant_id
                     WHERE r.tenant_id = ? AND r.acervo = 1 ORDER BY r.created_at DESC, r.rowid DESC LIMIT ?`).bind(tenantId, ARCHIVE_LINES),
    env.DB.prepare('SELECT origem, trecho FROM recortes WHERE tenant_id = ? AND texto_id = ?').bind(tenantId, less ?? ''),
  ]);
  let cut = links.results.length >= ARCHIVE_LINES || files.results.length >= ARCHIVE_LINES || recs.results.length >= ARCHIVE_LINES;
  const sources: ArchiveSource[] = [];
  // How many texts use each source, and whether the current text already has it: per text row, before grouping.
  const usages = new Map<string, Set<string>>();
  const key = (r: Record<string, unknown>) => (r.url !== undefined ? `link:${r.url}` : `${r.tipo}:${r.sha256}`);
  for (const r of [...links.results, ...files.results]) usages.set(key(r), (usages.get(key(r)) ?? new Set()).add(r.texto_id as string));
  const seen = new Set<string>();
  for (const r of [...links.results, ...files.results]) {
    const k = key(r);
    if (r.texto_id === less || seen.has(k)) continue;
    seen.add(k);
    const link = r.url !== undefined;
    const name = link ? ((r.titulo as string | null) ?? (r.url as string)) : (r.nome as string);
    if (!home(name, link ? (r.url as string) : null, r.texto_titulo as string)) continue;
    sources.push({
      tipo: link ? 'link' : r.tipo === 'pdf' ? 'documento' : 'gravacao', id: r.id as string, nome: name, url: link ? (r.url as string) : null,
      texto: { id: r.texto_id as string, titulo: r.texto_titulo as string }, em: r.created_at as string,
      textos: usages.get(k)!.size, jaNoTexto: !!less && usages.get(k)!.has(less),
      paginas: link ? null : (r.paginas as number | null), duracao: link ? null : (r.duracao as number | null),
    });
  }
  sources.sort((a, b) => (a.em < b.em ? 1 : a.em > b.em ? -1 : 0));
  const inText = new Set(recsInText.results.map((r) => `${r.origem}|${r.trecho}`));
  const clippings = recs.results.filter((r) => home(r.trecho as string, r.nota as string | null, r.fonte_nome as string | null, r.texto_titulo as string)).map((r) => ({
    id: r.id as string, origem: r.origem as ClippingOrigin, trecho: r.trecho as string, nota: r.nota as string | null,
    fonte: { nome: r.fonte_nome as string | null, url: r.fonte_url as string | null }, pagina: r.pagina as number | null, inicio: r.inicio as number | null,
    texto: { id: r.texto_id as string, titulo: r.texto_titulo as string }, em: r.created_at as string,
    jaNoTexto: r.texto_id === less || inText.has(`${r.origem}|${r.trecho}`),
  }));
  if (sources.length > ARCHIVE_MAX || clippings.length > ARCHIVE_MAX) cut = true;
  return { fontes: sources.slice(0, ARCHIVE_MAX), recortes: clippings.slice(0, ARCHIVE_MAX), cortado: cut };
}

export const BRING_TYPES = ['link', 'documento', 'gravacao', 'recorte'] as const;
export type BringType = (typeof BRING_TYPES)[number];

const vanishedSource = () => error('fonte_sumiu', 'A fonte deste item não está mais no acervo.', "This item's source is no longer in the archive.", 409);

/**
 * A library link for this text, without reading the page again: a new row in `evidencias` and the stored text copied
 * to a new R2 key. Copy, not share: `removeEvidence` deletes the R2 object of the evidence that leaves, and a shared
 * key would break the other text. The copy keeps the hash and date of the original read (the "source changed" cron
 * compares with the text that was read, when it was read) and the source type; the Wayback copy comes along only if it
 * was already saved (otherwise the route queues it, as for a new link). The same address already in the text: returns
 * the existing one.
 */
async function bringLink(env: Env, tenantId: string, textId: string, evidenceId: string): Promise<{ id: string; existia: boolean; wayback: boolean }> {
  const e = await env.DB.prepare("SELECT * FROM evidencias WHERE id = ? AND tenant_id = ? AND origem = 'link'").bind(evidenceId, tenantId).first<Record<string, unknown>>();
  if (!e) throw notFound();
  const perUrl = () => env.DB.prepare('SELECT id FROM evidencias WHERE texto_id = ? AND tenant_id = ? AND url = ?').bind(textId, tenantId, e.url).first<{ id: string }>();
  const already = await perUrl();
  if (already) return { id: already.id, existia: true, wayback: false };
  const text = await env.MEDIA.get(e.r2_texto as string).then((x) => x?.text());
  if (text === undefined) throw vanishedSource();
  const id = newId();
  const key = `evidencias/${tenantId}/${id}.txt`;
  await env.MEDIA.put(key, text, { httpMetadata: { contentType: 'text/plain; charset=utf-8' } });
  const saved = e.wayback_estado === 'salvo';
  const r = await env.DB.prepare(
    `INSERT INTO evidencias (id, tenant_id, texto_id, url, titulo, r2_texto, hash, hash_atual, via_navegador, conferida_em, mudou_em, falhas, tipo_fonte, origem,
                             wayback_estado, wayback_url, wayback_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'link', ?, ?, ?) ON CONFLICT (texto_id, url) DO NOTHING RETURNING id`,
  ).bind(id, tenantId, textId, e.url, e.titulo, key, e.hash, e.hash_atual, e.via_navegador, e.conferida_em, e.mudou_em, e.falhas, e.tipo_fonte,
    saved ? 'salvo' : null, saved ? e.wayback_url : null, saved ? e.wayback_em : null).first<{ id: string }>();
  if (!r) {
    await env.MEDIA.delete(key);
    return { id: (await perUrl())!.id, existia: true, wayback: false };
  }
  return { id, existia: false, wayback: !saved };
}

/**
 * A library PDF or recording for this text, without processing again: a new row in `arquivos` (ready) with the pages
 * and the word index, or the transcript's passages and segments, copied in D1. The R2 file is shared: no path deletes a
 * PDF or audio file (there is no file removal from the dossier; the recording session only deletes slices, which a
 * ready, assembled recording no longer has, which is why the library only offers recordings with no segment left to
 * assemble). Whoever deletes one some day checks first whether another row uses the same `r2` (as `removeEvidence`
 * does with `documentos`). The copy's semantic search is off (the index is per file); word search works. The same file
 * already in the text: returns the existing one.
 */
async function bringFile(env: Env, tenantId: string, textId: string, fileId: string, type: 'pdf' | 'audio', actor: string): Promise<{ id: string; existia: boolean }> {
  const a = await env.DB.prepare(
    `SELECT id, sha256 FROM arquivos a WHERE id = ? AND tenant_id = ? AND tipo = ? AND estado = 'pronto'
        AND NOT EXISTS (SELECT 1 FROM gravacao_segmentos s WHERE s.arquivo_id = a.id AND s.tenant_id = a.tenant_id AND s.r2 IS NULL)`,
  ).bind(fileId, tenantId, type).first<{ id: string; sha256: string }>();
  if (!a) throw notFound();
  const perSha = () => env.DB.prepare('SELECT id FROM arquivos WHERE texto_id = ? AND tenant_id = ? AND sha256 = ?').bind(textId, tenantId, a.sha256).first<{ id: string }>();
  const already = await perSha();
  if (already) return { id: already.id, existia: true };
  const id = newId();
  // The copies of pages, passages and segments only count with the new row written (the batch is a transaction; if
  // another request brought the same file first, the INSERT does not happen and nothing is copied).
  const mine = 'EXISTS (SELECT 1 FROM arquivos WHERE id = ? AND texto_id = ? AND tenant_id = ?)';
  const me = [id, textId, tenantId];
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO arquivos (id, tenant_id, texto_id, tipo, nome, r2, bytes, sha256, estado, paginas, vetor, entidades_json, totais_json, mime, duracao, por)
       SELECT ?, tenant_id, ?, tipo, nome, r2, bytes, sha256, 'pronto', paginas, CASE WHEN tipo = 'pdf' THEN 'desligado' ELSE vetor END, entidades_json, totais_json, mime, duracao, ?
         FROM arquivos WHERE id = ? AND tenant_id = ? ON CONFLICT DO NOTHING`,
    ).bind(id, textId, actor, a.id, tenantId),
    ...(type === 'pdf' ? [
      env.DB.prepare(`INSERT INTO arquivo_paginas (tenant_id, arquivo_id, pagina, texto) SELECT tenant_id, ?, pagina, texto FROM arquivo_paginas WHERE arquivo_id = ? AND tenant_id = ? AND ${mine}`)
        .bind(id, a.id, tenantId, ...me),
      env.DB.prepare(`INSERT INTO arquivo_paginas_fts (texto, arquivo_id, tenant_id, pagina) SELECT texto, ?, tenant_id, pagina FROM arquivo_paginas WHERE arquivo_id = ? AND tenant_id = ? AND ${mine}`)
        .bind(id, a.id, tenantId, ...me),
    ] : [
      env.DB.prepare(`INSERT INTO gravacao_trechos (tenant_id, arquivo_id, n, inicio, fim, texto, palavras_json) SELECT tenant_id, ?, n, inicio, fim, texto, palavras_json FROM gravacao_trechos WHERE arquivo_id = ? AND tenant_id = ? AND ${mine}`)
        .bind(id, a.id, tenantId, ...me),
      env.DB.prepare(`INSERT INTO gravacao_segmentos (tenant_id, arquivo_id, n, r2, inicio, bytes, sha256, estado, erro, faltas_json)
                      SELECT tenant_id, ?, n, r2, inicio, bytes, sha256, estado, erro, faltas_json FROM gravacao_segmentos WHERE arquivo_id = ? AND tenant_id = ? AND ${mine}`)
        .bind(id, a.id, tenantId, ...me),
    ]),
  ]);
  const my = await env.DB.prepare('SELECT 1 AS x FROM arquivos WHERE id = ? AND tenant_id = ?').bind(id, tenantId).first();
  if (!my) return { id: (await perSha())!.id, existia: true };
  return { id, existia: false };
}

/**
 * Brings into this text a library source (`tipo`: link, documento, gravacao; `id`: the evidence or file in the other
 * text) or a library clipping (`tipo: recorte`), with its source. Idempotent: what is already in the text comes back as
 * is (`existia`). `wayback`: the copied evidence must go to the Wayback queue (the route sends it).
 */
export async function bringArchive(env: Env, tenantId: string, textId: string, actor: string, b: Record<string, unknown>): Promise<{ tipo: BringType; id: string; existia: boolean; wayback: string | null }> {
  await readText(env, tenantId, textId);
  if (!(BRING_TYPES as readonly unknown[]).includes(b.tipo)) throw error('tipo', `tipo: um de ${BRING_TYPES.join(', ')}`, `tipo: one of ${BRING_TYPES.join(', ')}`);
  if (typeof b.id !== 'string') throw error('id', 'id: texto', 'id: string');
  const type = b.tipo as BringType;
  let r: { id: string; existia: boolean; wayback: string | null };
  if (type === 'link') {
    const l = await bringLink(env, tenantId, textId, b.id);
    r = { id: l.id, existia: l.existia, wayback: l.wayback ? l.id : null };
  } else if (type === 'documento' || type === 'gravacao') {
    r = { ...(await bringFile(env, tenantId, textId, b.id, type === 'documento' ? 'pdf' : 'audio', actor)), wayback: null };
  } else {
    r = await bringClipping(env, tenantId, textId, actor, b.id);
  }
  if (!r.existia) {
    await env.DB.prepare("UPDATE textos SET updated_at = datetime('now') WHERE id = ? AND tenant_id = ?").bind(textId, tenantId).run();
    // Like `materia.documento` and `apuracao.*`: what enters the dossier from another text goes in the log, with its origin.
    await recordEvent(env, tenantId, 'material.trazido', 'texto', textId, { tipo: type, de: b.id, para: r.id, por: actor });
  }
  return { tipo: type, ...r };
}

async function bringClipping(env: Env, tenantId: string, textId: string, actor: string, clippingId: string): Promise<{ id: string; existia: boolean; wayback: string | null }> {
  const s = await env.DB.prepare('SELECT * FROM recortes WHERE id = ? AND tenant_id = ? AND acervo = 1').bind(clippingId, tenantId).first<ClippingLine>();
  if (!s) throw notFound();
  if (s.texto_id === textId) return { id: s.id, existia: true, wayback: null };
  let evidenceId: string | null = null, fileId: string | null = null, wayback: string | null = null;
  if (s.origem === 'evidencia') {
    // The source evidence; if it left the dossier there, the same address in another of the outlet's texts.
    const ev = await env.DB.prepare('SELECT id, origem FROM evidencias WHERE id = ? AND tenant_id = ?').bind(s.evidencia_id, tenantId).first<{ id: string; origem: string }>()
      ?? (s.fonte_url ? await env.DB.prepare("SELECT id, origem FROM evidencias WHERE tenant_id = ? AND origem = 'link' AND url = ? ORDER BY created_at DESC LIMIT 1")
        .bind(tenantId, s.fonte_url).first<{ id: string; origem: string }>() : null);
    if (!ev) throw vanishedSource();
    if (ev.origem !== 'link') throw error('nao_compartilhavel', 'Este recorte vem de uma resposta que fica no texto dela.', 'This clipping comes from a reply that stays in its own text.', 422);
    // The clipping stays literal in the source it will point to: the one this text already has with the same address (it
    // may have been read on another day, with another text) or the copy of the one from there. Checked before bringing it
    // in: a refusal leaves nothing half done.
    const target = await env.DB.prepare(
      `SELECT COALESCE((SELECT d.r2_texto FROM evidencias d WHERE d.texto_id = ? AND d.tenant_id = o.tenant_id AND d.url = o.url), o.r2_texto) AS r2
         FROM evidencias o WHERE o.id = ? AND o.tenant_id = ?`,
    ).bind(textId, ev.id, tenantId).first<{ r2: string }>();
    const saved = target ? await env.MEDIA.get(target.r2).then((x) => x?.text()) : undefined;
    if (saved === undefined) throw vanishedSource();
    if (!inSourcePassage(saved, s.trecho)) {
      throw error('trecho_fora', 'Esse trecho não está mais, letra por letra, no texto guardado desta fonte. Traga a fonte e recorte de novo no leitor.',
        "That passage is no longer, word for word, in this source's saved text. Bring the source and clip it again in the reader.", 422);
    }
    const l = await bringLink(env, tenantId, textId, ev.id);
    evidenceId = l.id;
    wayback = l.wayback ? l.id : null;
  } else if (s.origem === 'documento' || s.origem === 'gravacao') {
    try {
      fileId = (await bringFile(env, tenantId, textId, s.arquivo_id ?? '', s.origem === 'documento' ? 'pdf' : 'audio', actor)).id;
    } catch (e) {
      if (e instanceof DeskError && e.codigo === 'nao_encontrado') throw vanishedSource();
      throw e;
    }
  }
  const r = await insertClipping(env, tenantId, textId, actor, {
    origem: s.origem as ClippingOrigin, evidenciaId: evidenceId, arquivoId: fileId, pagina: s.pagina, inicio: s.inicio, trecho: s.trecho, nota: s.nota, fonteNome: s.fonte_nome, fonteUrl: s.fonte_url,
  });
  return { ...r, wayback };
}
