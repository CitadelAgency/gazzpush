// The speech against the script, by code and pure: spelled-out numbers count, in pt and en. Transcription often gets
// numbers and names wrong, so what comes out of here is a warning to listen, never a rejection. Transcript text never
// leaves here: only the time.
import { layoutOf, normalizeCards, type Card } from './cards';
import type { Word } from './segments';

export type SpeechLanguage = 'pt-BR' | 'en';
/** One script unit: the title (`frase` null) or one sentence of a card. */
export interface ScriptPart { card: number; frase: number | null; texto: string }
export interface SpeechWarning { tipo: 'numero' | 'nome' | 'fora'; motivo: 'ausente' | 'trocado' | 'extra'; esperado: string | null; inicio: number; decisao?: 'fala_certa' | null }

/** The script: the cards' titles and sentences. The cover only has its title on screen, and the CTA is left out. */
export function scriptReels(cards: Card[] | undefined): ScriptPart[] {
  const parts: ScriptPart[] = [];
  normalizeCards(cards).forEach((c, card) => {
    const layout = layoutOf(c);
    if (layout === 'convite') return;
    if (c.titulo?.trim()) parts.push({ card, frase: null, texto: c.titulo });
    if (layout !== 'capa') (c.frases ?? []).forEach((f, sentence) => { if (f.texto.trim()) parts.push({ card, frase: sentence, texto: f.rotulo ? `${f.rotulo}: ${f.texto}` : f.texto }); });
  });
  return parts;
}

const SIMPLE_PT: Record<string, number> = {
  zero: 0, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13, catorze: 14, quatorze: 14, quinze: 15,
  dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90,
  cem: 100, cento: 100, duzentos: 200, duzentas: 200, trezentos: 300, trezentas: 300, quatrocentos: 400, quatrocentas: 400, quinhentos: 500, quinhentas: 500,
  seiscentos: 600, seiscentas: 600, setecentos: 700, setecentas: 700, oitocentos: 800, oitocentas: 800, novecentos: 900, novecentas: 900,
};
const SIMPLE_EN: Record<string, number> = {
  zero: 0, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
/** "um" on its own is an article: it only counts inside a number ("vinte e um"). */
const ONE = new Set(['um', 'uma', 'one']);
const THOUSAND = new Set(['mil', 'thousand']);
const ENABLES = new Set(['e', 'and']);
const COMMA = new Set(['virgula', 'ponto', 'point']);

const withoutAccent = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const digits = (s: string) => (/^\d+(?:[.,]\d{3})+$/.test(s) ? s.replace(/[.,]/g, '') : s.replace(',', '.'));

interface Raw { w: string; bruto: string; i?: number; f?: number; parte?: number; maiuscula: boolean; comeco: boolean }
export interface Token { w: string; bruto: string; i?: number; f?: number; parte?: number; num: boolean; nome: boolean }

function raw(text: string, base: Omit<Raw, 'w' | 'bruto' | 'maiuscula' | 'comeco'>, before: { fim: boolean }): Raw[] {
  const out: Raw[] = [];
  for (const m of text.matchAll(/\d+(?:[.,]\d+)*|\p{L}[\p{L}\p{M}'’-]*|[.!?:]/gu)) {
    if (/^[.!?:]$/.test(m[0])) { before.fim = true; continue; }
    out.push({ ...base, w: /^\d/.test(m[0]) ? digits(m[0]) : withoutAccent(m[0]), bruto: m[0], maiuscula: /^\p{Lu}/u.test(m[0]), comeco: before.fim });
    before.fim = false;
  }
  return out;
}

/** Joins spelled-out numbers into a single token, with the value in digits. */
function joinNumbers(c: Raw[]): Token[] {
  const simple = { ...SIMPLE_PT, ...SIMPLE_EN };
  const out: Token[] = [];
  const word = (x: Raw): Token => ({ w: x.w, bruto: x.bruto, i: x.i, f: x.f, parte: x.parte, num: /^\d/.test(x.w), nome: x.maiuscula && !x.comeco && !/^\d/.test(x.w) && x.w.length > 2 });
  for (let i = 0; i < c.length;) {
    const isNum = (w: string) => w in simple || THOUSAND.has(w) || w === 'hundred';
    if (!isNum(c[i].w) && !(ONE.has(c[i].w) && c[i + 1] && THOUSAND.has(c[i + 1].w))) { out.push(word(c[i])); i++; continue; }
    let total = 0;
    let acc = 0;
    let k = i;
    for (;;) {
      const w = c[k]?.w;
      if (w === undefined) break;
      if (THOUSAND.has(w)) { total += (acc || 1) * 1000; acc = 0; k++; }
      else if (w === 'hundred') { acc = (acc || 1) * 100; k++; }
      else if (w in simple) { acc += simple[w]; k++; }
      else if (ONE.has(w) && k > i) { acc += 1; k++; }
      else if (ENABLES.has(w) && c[k + 1] && (c[k + 1].w in simple || ONE.has(c[k + 1].w))) k++;
      else break;
    }
    const end = c[k - 1];
    out.push({ w: String(total + acc), bruto: c.slice(i, k).map((x) => x.bruto).join(' '), i: c[i].i, f: end.f, parte: c[i].parte, num: true, nome: false });
    i = k;
  }
  // "dois vírgula cinco" is 2.5, and counts the same as the digits.
  for (let i = 1; i < out.length - 1; i++) {
    if (COMMA.has(out[i].w) && out[i - 1].num && out[i + 1].num) {
      out.splice(i - 1, 3, { ...out[i - 1], w: `${out[i - 1].w}.${out[i + 1].w}`, f: out[i + 1].f, bruto: `${out[i - 1].bruto} ${out[i].bruto} ${out[i + 1].bruto}` });
    }
  }
  return out;
}

export function tokensScript(parts: ScriptPart[]): Token[] {
  return parts.flatMap((p, part) => joinNumbers(raw(p.texto, { parte: part }, { fim: true })));
}

export function tokensSpeech(words: Word[]): Token[] {
  const before = { fim: false };
  return joinNumbers(words.flatMap((w) => raw(w.p, { i: w.i, f: w.f }, before)));
}

/** The longest common subsequence: which script tokens were heard, and where. */
export function align(a: Token[], b: Token[]): number[] {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i].w === b[j].w ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const pair = new Array<number>(n).fill(-1);
  for (let i = 0, j = 0; i < n && j < m;) {
    if (a[i].w === b[j].w) { pair[i] = j; i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pair;
}

/** A long passage outside the script is also a warning: it may be conversation that got into the recording. */
const MIN_OUTSIDE = 6;

export function compareNarration(parts: ScriptPart[], words: Word[]): SpeechWarning[] {
  const a = tokensScript(parts);
  const b = tokensSpeech(words);
  const pair = align(a, b);
  const warnings: SpeechWarning[] = [];
  a.forEach((t, i) => {
    if (pair[i] >= 0 || !(t.num || t.nome)) return;
    const before = pair.slice(0, i).filter((x) => x >= 0).at(-1) ?? -1;
    const after = pair.slice(i + 1).find((x) => x >= 0) ?? b.length;
    const go = b.slice(before + 1, after);
    const swapped = t.num ? go.some((x) => x.num) : go.length > 0;
    const home = go[0]?.i ?? b[before]?.f ?? 0;
    warnings.push({ tipo: t.num ? 'numero' : 'nome', motivo: swapped ? 'trocado' : 'ausente', esperado: t.bruto, inicio: home, decisao: null });
  });
  const heard = new Set(pair);
  for (let j = 0; j < b.length;) {
    if (heard.has(j)) { j++; continue; }
    let k = j;
    while (k < b.length && !heard.has(k)) k++;
    if (k - j >= MIN_OUTSIDE) warnings.push({ tipo: 'fora', motivo: 'extra', esperado: null, inicio: b[j].i ?? 0, decisao: null });
    j = k;
  }
  return warnings.sort((x, y) => x.inicio - y.inicio);
}

const ms = (n: number) => Math.round(n * 1000) / 1000;
const MIN_CARD_S = 0.5;

/**
 * Start of each part: that of its first aligned word. A part without alignment falls between its neighbours, in
 * proportion to the words. With no alignment at all, everything is proportional to the words.
 */
export function startsParts(parts: ScriptPart[], words: Word[], duration: number): number[] {
  const a = tokensScript(parts);
  const b = tokensSpeech(words);
  const pair = align(a, b);
  const weights = parts.map((_, p) => Math.max(1, a.filter((t) => t.parte === p).length));
  const findings = parts.map((_, p) => {
    const i = a.findIndex((t, k) => t.parte === p && pair[k] >= 0);
    return i >= 0 ? b[pair[i]].i ?? null : null;
  });
  const fixed: { p: number; t: number }[] = [{ p: 0, t: 0 }];
  findings.forEach((t, p) => { if (t !== null && p > 0 && t >= fixed.at(-1)!.t) fixed.push({ p, t }); });
  fixed.push({ p: parts.length, t: duration });
  const starts = new Array<number>(parts.length).fill(0);
  for (let f = 0; f + 1 < fixed.length; f++) {
    const { p: from, t: tOf } = fixed[f];
    const { p: until, t: tUntil } = fixed[f + 1];
    const sum = weights.slice(from, until).reduce((x, y) => x + y, 0);
    let acc = 0;
    for (let p = from; p < until; p++) {
      starts[p] = ms(tOf + ((tUntil - tOf) * acc) / sum);
      acc += weights[p];
    }
  }
  return starts;
}

/** Each card's time and each sentence's moment, with the voice. `convite`: after the voice, with its own time. */
export function timesNarration(parts: ScriptPart[], words: Word[], duration: number, totalCards: number, invite: number) {
  const startIndexes = startsParts(parts, words, duration);
  const cards = [...new Set(parts.map((p) => p.card))];
  const starts = cards.map((c, j) => (j === 0 ? 0 : startIndexes[parts.findIndex((p) => p.card === c)]));
  for (let j = 1; j < starts.length; j++) starts[j] = Math.max(starts[j], starts[j - 1] + MIN_CARD_S);
  if (starts.at(-1)! > duration - MIN_CARD_S) starts.forEach((_, j) => { starts[j] = ms((duration * j) / starts.length); });
  const times = new Array<number>(totalCards).fill(0);
  const sentences: number[][] = Array.from({ length: totalCards }, () => []);
  cards.forEach((c, j) => { times[c] = ms((starts[j + 1] ?? duration) - starts[j]); });
  parts.forEach((p, k) => { if (p.frase !== null) sentences[p.card][p.frase] = startIndexes[k]; });
  for (let c = 0; c < totalCards; c++) if (!times[c]) times[c] = invite;
  return { tempos: times, frases: sentences };
}
