// Material on the side (the editor's source organiser): what the Worker and the screen must do the same way. The literal
// check of the clipping, the reader's paragraphs, accent- and case-insensitive search and "already in the text". Pure
// functions, with no Worker or DOM dependency (the screen imports from here, as from doc.ts and reviewer.ts).

export const PASSAGE_MIN = 3;
/** A PDF clipping becomes evidence through the existing route (`toEvidencePassage`), which requires 8 characters. */
export const MIN_DOCUMENT_PASSAGE = 8;
export const PASSAGE_MAX = 2000;
export const NOTE_MAX = 500;
export const CLIPPINGS_PER_TEXT = 200;

/**
 * Normalisation of both sides: all whitespace (line break, tab, non-breaking space) becomes one space, with no space at
 * the ends. It is the same as `quotesBlock` (reporting.ts) and `recordReporting`: a clipping that passes here is found
 * by the quote check when it enters the text, and nothing else is tolerated (not accents, not case, not quote marks).
 */
export const joinSpaces = (s: string) => s.replace(/\s+/g, ' ').trim();

/** The passage is, letter for letter, in the source's stored text (only whitespace may differ). */
export function inSourcePassage(source: string, passage: string): boolean {
  const t = joinSpaces(passage);
  return t.length >= PASSAGE_MIN && joinSpaces(source).includes(t);
}

/** Above this, a reader paragraph is cut at a sentence end (a page read by Readability comes in a single line). */
const PARAGRAPH_MAX = 900;

/**
 * The source's stored text in paragraphs, for the side reader: blank lines separate them; a paragraph that is too long
 * is cut at a sentence end. Each paragraph comes out with its spaces collapsed, and is a slice of the stored text: a
 * selection made inside it passes `inSourcePassage`. The paragraph index is the same in search and in the reader.
 */
export function paragraphsSource(text: string): string[] {
  const out: string[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    const p = joinSpaces(block);
    if (!p) continue;
    if (p.length <= PARAGRAPH_MAX) { out.push(p); continue; }
    let current = '';
    for (const sentence of p.split(/(?<=[.!?…])\s+/)) {
      if (current && current.length + sentence.length + 1 > PARAGRAPH_MAX) { out.push(current); current = ''; }
      current = current ? `${current} ${sentence}` : sentence;
      // A sentence with no full stop for thousands of characters (a table, a pasted list): cut wherever possible.
      while (current.length > PARAGRAPH_MAX * 2) { out.push(current.slice(0, PARAGRAPH_MAX)); current = current.slice(PARAGRAPH_MAX); }
    }
    if (current) out.push(current);
  }
  return out;
}

/** Is the passage already in the saved text (the paragraphs in `paragrafos_json`)? It comes from the saved text, not the live document. */
export function inText(passage: string, paragraphs: string[]): boolean {
  const t = joinSpaces(passage);
  return !!t && joinSpaces(paragraphs.join(' ')).includes(t);
}

// ── busca ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Without accents and in lower case, one UTF-16 unit at a time (the same length: positions found are valid in the
 * original text, and the screen marks the match with `<mark>` in the right place).
 */
export function double(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    // Half of a surrogate pair (emoji): left as is, so the length does not change.
    if (c >= 0xd800 && c <= 0xdfff) { out += s[i]; continue; }
    out += (s[i].normalize('NFD').replace(/\p{M}/gu, '').toLowerCase() || s[i])[0];
  }
  return out;
}

export const SEARCH_MIN = 2;
export const SEARCH_MAX = 100;

/** The words searched for: without accents, without case, 2 letters or more, up to 8. */
export const termsSearch = (q: string) => [...new Set(double(joinSpaces(q)).split(' ').filter((t) => t.length >= SEARCH_MIN))].slice(0, 8);

export interface Found { trecho: string; marcas: [number, number][] }

const RAY = 90;

/**
 * Are all the searched words in the text? Returns the slice around the first one that appears (cut at a space), with
 * the positions of each word found inside it. Without all of them: null.
 */
export function findInText(text: string, terms: string[]): Found | null {
  if (!terms.length) return null;
  const plan = double(text);
  const first = terms.map((t) => plan.indexOf(t));
  if (first.some((i) => i < 0)) return null;
  const center = Math.min(...first);
  let from = Math.max(0, center - RAY);
  let until = Math.min(text.length, center + RAY * 2);
  if (from > 0) { const e = text.indexOf(' ', from); if (e >= 0 && e < center) from = e + 1; }
  if (until < text.length) { const e = text.lastIndexOf(' ', until); if (e > center) until = e; }
  const chunk = plan.slice(from, until);
  const marks: [number, number][] = [];
  for (const t of terms) {
    for (let i = chunk.indexOf(t); i >= 0; i = chunk.indexOf(t, i + t.length)) marks.push([i, i + t.length]);
  }
  // Marks that overlap ("lic" and "licitação") become one.
  marks.sort((a, b) => a[0] - b[0]);
  const together = marks.reduce<[number, number][]>((js, m) => {
    const u = js.at(-1);
    if (u && m[0] <= u[1]) u[1] = Math.max(u[1], m[1]); else js.push([m[0], m[1]]);
    return js;
  }, []);
  const prefix = from > 0 ? '…' : '', suffix = until < text.length ? '…' : '';
  return { trecho: `${prefix}${text.slice(from, until)}${suffix}`, marcas: together.map(([i, f]) => [i + prefix.length, f + prefix.length]) };
}
