// X-ray of old posts: what can be read from the Instagram archive and from the vision model's reply. Pure.
// Meta's archive format is not confirmed: the reader looks in any JSON for objects with `uri` and `creation_timestamp`.
export const MAX_ITEMS_BATCH = 2000;
export const THUMBNAIL_SIDE = 512;
export const THUMBNAIL_MAX_BYTES = 256 * 1024;
export const CAPTION_MAX = 2200;
export const ITEMS_PER_PAGE = 60;

export interface PostFile { uri: string; data: string; legenda: string }

/** Meta's export: UTF-8 read as Latin-1 ("aÃ§Ã£o"). Text that is already right does not change. */
export function fixAccent(s: string): string {
  const code = [...s].map((c) => c.codePointAt(0)!);
  if (!code.some((c) => c >= 0x80) || code.some((c) => c > 0xff)) return s;
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(Uint8Array.from(code));
  } catch {
    return s;
  }
}

/** Every object with `uri` and `creation_timestamp`, at any depth. The caption can be on it or on the outer object. */
export function findPosts(json: unknown): PostFile[] {
  const findings: PostFile[] = [];
  const move = (v: unknown, outsideTitle: string) => {
    if (Array.isArray(v)) { for (const x of v) move(x, outsideTitle); return; }
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    const title = typeof o.title === 'string' && o.title.trim() ? o.title : outsideTitle;
    const ts = Number(o.creation_timestamp);
    if (typeof o.uri === 'string' && o.uri && !/^https?:/i.test(o.uri) && Number.isFinite(ts) && ts > 0) {
      findings.push({ uri: o.uri.replace(/^\.?\//, ''), data: new Date(ts * 1000).toISOString(), legenda: fixAccent(title).slice(0, CAPTION_MAX) });
    }
    for (const x of Object.values(o)) if (x && typeof x === 'object') move(x, title);
  };
  move(json, '');
  return findings;
}

const IN_CAPTION = [
  /\bvia\s+@[\w.]+/iu, /\bcr[ée]ditos?\b[^\n]{0,40}/iu, /\bfotos?\s*:[^\n]{0,40}/iu, /\bimagem\s*:[^\n]{0,40}/iu, /\breprodu[çc][ãa]o\b/iu,
  /\bcredits?\b[^\n]{0,40}/iu, /\bphotos?\s*(?:by|:)[^\n]{0,40}/iu, /\bimage\s*:[^\n]{0,40}/iu, /\bcourtesy of\b[^\n]{0,40}/iu, /\brepost(?:ed)?\b[^\n]{0,40}/iu,
];

/** The caption passage that points to third-party media. */
export function marksInCaption(caption: string): string[] {
  const findings = IN_CAPTION.map((r) => caption.match(r)?.[0].trim()).filter((x): x is string => !!x);
  return [...new Set(findings)].slice(0, 3);
}

export const PROMPT_XRAY = 'Inspect the image and respond ONLY with JSON, no comment: {"marca_dagua":true|false,"logo":true|false,"credito":true|false}. '
  + 'marca_dagua = watermark of another page or agency over the image. logo = third-party logo, from TV, a newspaper or an agency. credito = photo credit written on the image.';

export const CODES_VISION = ['marca_dagua', 'logo', 'credito'] as const;

/** The reasons the model pointed out; null if the reply cannot be read. */
export function readVision(answer: unknown): string[] | null {
  const text = typeof answer === 'string' ? answer : JSON.stringify(answer ?? null);
  const m = text.match(/\{[^}]*\}/);
  if (!m) return null;
  try {
    const r = JSON.parse(m[0]) as Record<string, unknown>;
    if (!CODES_VISION.some((c) => typeof r[c] === 'boolean')) return null;
    return CODES_VISION.filter((c) => r[c] === true);
  } catch {
    return null;
  }
}
