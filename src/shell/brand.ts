import { DOMParser } from 'linkedom';
import { OPACITY_MAX, OPACITY_MIN, POSITIONS_BRAND_WATER, type WaterBrand } from '../lib/watermark';
import { SOURCES_PAIRS, DEFAULT_PAIR, isPairSources, type SourcesPair } from '../lib/typography';
import type { Language } from './language';

/**
 * The outlet's brand (PATCH /marca, POST /marca/logo and /marca/referencia): name, @, 3 colours, illustration style, the
 * texts of the existing CTAs and the watermark. R2 keys, CTA highlights and phone, domain and URL do not come in
 * through here.
 */

export const LOGO_MAX_BYTES = 512 * 1024;
export const REFERENCE_MAX_BYTES = 2 * 1024 * 1024;
export const ART_STYLE_MAX = 300;
/** The author card's signature (author outlet): the writer's name, in the footer. */
export const SIGNATURE_MAX = 60;
/** Editable fields of each CTA (`ctas[i]`) and each one's maximum length. `acao` is optional (the render has a default). */
export const CTA_FIELDS = { titulo: 80, texto: 200, legenda: 300, acao: 60 } as const;
export type CtaText = { titulo: string; texto: string; legenda: string; acao?: string };
// The CTA goes into the caption and the last card, and the piece's validation (src/lib/validation.ts) checks every
// number and weekday against the story's facts: a "24 hours" in the CTA would bring every piece down. So the CTA carries none.
const NOT_FACT = /\d|\b(domingo|segunda|terça|quarta|quinta|sexta|sábado)\b/i;
const HEX = /^#[0-9a-f]{6}$/i;
const HANDLE = /^[A-Za-z0-9._]{1,30}$/;
const COLORS = ['fundo', 'texto', 'acento'] as const;

export interface PatchBrand {
  nome?: string;
  handle?: string | null;
  cores?: Partial<Record<(typeof COLORS)[number], string>>;
  estiloArte?: string | null;
  marcaDagua?: WaterBrand;
  assinatura?: string | null;
  fontes?: SourcesPair;
}

/**
 * Validates the PATCH body and returns the merge-patch (RFC 7396, SQLite's `json_patch`) or the error message. The CTA
 * texts come back separately (`ctas`): the whole list is replaced in the patch, so the route merges with what exists.
 */
export function validateBrand(b: Record<string, unknown>, language: Language = 'pt-BR'): { patch: PatchBrand; ctas?: CtaText[] } | { erro: string } {
  const tr = (pt: string, en: string) => (language === 'en' ? en : pt);
  const patch: PatchBrand = {};
  if (b.nome !== undefined) {
    const name = String(b.nome ?? '').trim();
    if (name.length < 2 || name.length > 80) return { erro: tr('nome entre 2 e 80 caracteres', 'name must be 2 to 80 characters') };
    patch.nome = name;
  }
  if (b.handle !== undefined) {
    const h = String(b.handle ?? '').trim().replace(/^@/, '');
    if (h && !HANDLE.test(h)) return { erro: tr('handle: até 30 letras, números, ponto ou _', 'handle: up to 30 letters, numbers, period or _') };
    patch.handle = h ? `@${h}` : null;   // vazio apaga
  }
  if (b.cores !== undefined) {
    if (!b.cores || typeof b.cores !== 'object') return { erro: tr('cores: { fundo, texto, acento } em #rrggbb', 'cores: { fundo, texto, acento } in #rrggbb') };
    const colors: PatchBrand['cores'] = {};
    for (const k of COLORS) {
      const v = (b.cores as Record<string, unknown>)[k];
      if (v === undefined) continue;
      if (typeof v !== 'string' || !HEX.test(v)) return { erro: `cores.${k}: hex #rrggbb` };
      colors[k] = v.toLowerCase();
    }
    patch.cores = colors;
  }
  if (b.estiloArte !== undefined) {
    if (b.estiloArte !== null && typeof b.estiloArte !== 'string') return { erro: tr('estiloArte: texto', 'estiloArte: text') };
    const e = String(b.estiloArte ?? '').replace(/\s+/g, ' ').trim();
    if (e.length > ART_STYLE_MAX) return { erro: tr(`estiloArte: até ${ART_STYLE_MAX} caracteres`, `estiloArte: up to ${ART_STYLE_MAX} characters`) };
    patch.estiloArte = e || null;   // empty clears it (back to the style derived from the colours)
  }
  if (b.marcaDagua !== undefined) {
    const m = b.marcaDagua as Record<string, unknown> | null;
    if (!m || typeof m !== 'object' || !(POSITIONS_BRAND_WATER as readonly unknown[]).includes(m.posicao)) {
      return { erro: `marcaDagua.posicao: ${POSITIONS_BRAND_WATER.join(' | ')}` };
    }
    const o = m.opacidade;
    if (typeof o !== 'number' || !Number.isFinite(o) || o < OPACITY_MIN || o > OPACITY_MAX) {
      return { erro: tr(`marcaDagua.opacidade: de ${OPACITY_MIN} a ${OPACITY_MAX}`, `marcaDagua.opacidade: from ${OPACITY_MIN} to ${OPACITY_MAX}`) };
    }
    patch.marcaDagua = { posicao: m.posicao as WaterBrand['posicao'], opacidade: Math.round(o * 100) / 100 };
  }
  if (b.assinatura !== undefined) {
    if (b.assinatura !== null && typeof b.assinatura !== 'string') return { erro: tr('assinatura: texto', 'assinatura: text') };
    const a = String(b.assinatura ?? '').replace(/\s+/g, ' ').trim();
    if (a.length > SIGNATURE_MAX) return { erro: tr(`assinatura: até ${SIGNATURE_MAX} caracteres`, `assinatura: up to ${SIGNATURE_MAX} characters`) };
    patch.assinatura = a || null;   // empty clears it (the card signs with the outlet's name)
  }
  if (b.fontes !== undefined) {
    if (!isPairSources(b.fontes)) return { erro: `fontes: ${SOURCES_PAIRS.join(' | ')}` };
    patch.fontes = b.fontes;
  }
  if (b.ctas === undefined) return { patch };
  if (!Array.isArray(b.ctas) || b.ctas.length > 10) return { erro: tr('ctas: lista dos convites', 'ctas: list of invite cards') };
  const ctas: CtaText[] = [];
  for (const [i, c] of b.ctas.entries()) {
    if (!c || typeof c !== 'object') return { erro: tr(`ctas[${i}]: objeto`, `ctas[${i}]: object`) };
    const t = {} as CtaText;
    for (const [k, max] of Object.entries(CTA_FIELDS) as [keyof CtaText, number][]) {
      const v = (c as Record<string, unknown>)[k];
      if (k === 'acao' && (v === undefined || v === null || v === '')) continue;   // no button: the render uses the title
      if (typeof v !== 'string') return { erro: tr(`ctas[${i}].${k}: texto`, `ctas[${i}].${k}: text`) };
      const clean = v.replace(/\s+/g, ' ').trim();
      if (k === 'acao' && !clean) continue;
      if (!clean || clean.length > max) return { erro: tr(`ctas[${i}].${k}: de 1 a ${max} caracteres`, `ctas[${i}].${k}: 1 to ${max} characters`) };
      if (NOT_FACT.test(clean)) return { erro: tr(`convite ${i + 1}: sem números nem dia da semana (a checagem de fatos recusaria o post)`, `invite card ${i + 1}: no numbers or days of the week (the fact check would reject the post)`) };
      t[k] = clean;
    }
    ctas.push(t);
  }
  return { patch, ctas };
}

/**
 * New texts over the existing CTAs, in the same order: only title, text, caption and action change; highlights, phone,
 * url and edition stay. A different count: error (CTAs are neither created nor deleted through here).
 */
export function mergeCtas(current: unknown, texts: CtaText[], language: Language = 'pt-BR'): Record<string, unknown>[] | { erro: string } {
  const list = Array.isArray(current) ? (current as Record<string, unknown>[]) : [];
  if (list.length !== texts.length) {
    return { erro: language === 'en'
      ? `ctas: the publication has ${list.length} invite card${list.length === 1 ? '' : 's'}; send all ${list.length}`
      : `ctas: o veículo tem ${list.length} convite(s); mande os ${list.length}` };
  }
  return list.map((c, i) => {
    const { acao: _old, ...rest } = c;
    // No action in the request: the CTA has no button of its own (the render uses the title), as before it had one.
    return { ...rest, ...texts[i] };
  });
}

/**
 * What the UI sees of the brand: no R2 keys; of the CTAs, only the editable texts. `temReferencia`: there is a reference
 * image for the illustration (without it, the art comes out in the default style).
 */
export function publicBrand(json: string | null | undefined) {
  const m = JSON.parse(json || '{}') as {
    nome?: string; handle?: string; cores?: Record<string, string>; logoR2?: string; arteRefR2?: string; estiloArte?: string;
    ctas?: Record<string, unknown>[]; marcaDagua?: WaterBrand; assinatura?: string; dominio?: string; fontes?: string;
  };
  const text = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    nome: m.nome ?? null, handle: m.handle ?? null, cores: m.cores ?? {}, temLogo: Boolean(m.logoR2), temReferencia: Boolean(m.arteRefR2),
    estiloArte: m.estiloArte ?? null,
    ctas: (Array.isArray(m.ctas) ? m.ctas : []).map((c) => ({ titulo: text(c.titulo), texto: text(c.texto), legenda: text(c.legenda), acao: text(c.acao) })),
    marcaDagua: m.marcaDagua ?? { posicao: 'nenhuma' as WaterBrand['posicao'], opacidade: 0.4 },
    // Only the author outlet uses it (author card); missing on the others.
    assinatura: m.assinatura ?? undefined,
    // The card's font pair (src/lib/typography.ts); missing = the default (the UI shows the default as selected).
    fontes: isPairSources(m.fontes) && m.fontes !== DEFAULT_PAIR ? m.fontes : undefined,
    dominio: m.dominio ?? undefined,   // the card footer shows the domain before the @ (render)
  };
}

export const isJpeg = (b: Uint8Array) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

export const isPng = (b: Uint8Array) =>
  b.length > 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x);

// ── SVG ──────────────────────────────────────────────────────────────────────────────────────────────────────────
// SVG is an XSS vector when opened directly from our origin. An allowlist of elements and attributes, our own
// serialisation (our escaping, not the parser's), no external resources: href only to an internal anchor (#id), url() only #id.

const ELEMENTS = new Set([
  'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs', 'use', 'symbol',
  'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'pattern', 'title', 'desc', 'style',
]);
const DANGER_CSS = /@import|expression\s*\(|javascript:|\\/i;
/** Any url(...) that does not point to an internal anchor? The argument is read whole: spaces and quotes before the # are valid. */
const externalUrl = (v: string) =>
  [...v.matchAll(/url\s*\(([^)]*)\)?/gi)].some((m) => !m[1].trim().replace(/^['"]\s*/, '').startsWith('#'));
const dangerCss = (v: string) => DANGER_CSS.test(v) || externalUrl(v);

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// linkedom without the DOM lib in the Worker: nodes come in as any (the same scheme as src/lib/article.ts).
function serialize(el: any): string {
  const name = String(el.localName ?? el.tagName);
  if (!ELEMENTS.has(name)) return '';
  const children = [...el.childNodes].map((n: any) => {
    if (n.nodeType === 1) return serialize(n);
    if (n.nodeType === 3 || n.nodeType === 4) return esc(String(n.nodeValue ?? ''));
    return '';   // comment, processing instruction
  }).join('');
  if (name === 'style' && dangerCss([...el.childNodes].map((n: any) => String(n.nodeValue ?? '')).join(''))) return '';
  const attrs = [...el.attributes].filter((a: any) => {
    const n = String(a.name).toLowerCase(), v = String(a.value);
    if (n.startsWith('on')) return false;
    if (n === 'href' || n === 'xlink:href') return v.trim().startsWith('#');
    if (/(?:java|vb)script:|data:/i.test(v)) return false;
    return !dangerCss(v);
  }).map((a: any) => ` ${a.name}="${esc(String(a.value))}"`).join('');
  return `<${name}${attrs}>${children}</${name}>`;
}

/** Clean SVG, or null if it is not an acceptable SVG (DOCTYPE/entity, a root that is not <svg>, nothing left). */
export function sanitizeSvg(text: string): string | null {
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(text)) return null;
  let root: any;
  try {
    root = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
  } catch {
    return null;
  }
  if (!root || root.localName !== 'svg') return null;
  const clean = serialize(root);
  if (!/<(?:path|rect|circle|ellipse|line|polyline|polygon|text|use)[\s>]/.test(clean)) return null;
  // Without xmlns the browser does not draw the file as an image.
  return /^<svg[^>]*\sxmlns="/.test(clean) ? clean : clean.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
}

/** Reads the body up to `max` bytes and cancels the rest: without Content-Length (chunked) the limit applies while reading. */
export async function readBodyUntil(body: ReadableStream<Uint8Array> | null, max: number): Promise<Uint8Array | null> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(total);
  let i = 0;
  for (const p of parts) { bytes.set(p, i); i += p.byteLength; }
  return bytes;
}

/** The logo in the raw body: PNG or clean SVG, up to 512 KB. The brand's and the sponsor's go through the same door. */
export async function readLogo(req: Request, language: 'pt-BR' | 'en' = 'pt-BR'): Promise<{ corpo: Uint8Array | string; tipo: string; ext: 'png' | 'svg' } | { erro: string; status: 400 | 413 | 415 }> {
  const tr = (pt: string, en: string) => (language === 'en' ? en : pt);
  const type = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'image/png' && type !== 'image/svg+xml') return { erro: tr('logo: PNG ou SVG', 'logo: PNG or SVG'), status: 415 };
  if (Number(req.headers.get('content-length') ?? 0) > LOGO_MAX_BYTES) return { erro: tr('logo: até 512 KB', 'logo: up to 512 KB'), status: 413 };
  const bytes = await readBodyUntil(req.body, LOGO_MAX_BYTES);
  if (!bytes) return { erro: tr('logo: até 512 KB', 'logo: up to 512 KB'), status: 413 };
  if (type === 'image/png') return isPng(bytes) ? { corpo: bytes, tipo: type, ext: 'png' } : { erro: tr('arquivo não é PNG', 'file is not a PNG'), status: 400 };
  const clean = sanitizeSvg(new TextDecoder().decode(bytes));
  return clean ? { corpo: clean, tipo: type, ext: 'svg' } : { erro: tr('SVG inválido ou sem desenho', 'invalid SVG or no drawing'), status: 400 };
}
