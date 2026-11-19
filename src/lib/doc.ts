// The Story editor's document (ProseMirror/Tiptap) as JSON, shared by the Worker and the screen. Only what the editor
// allows: paragraph, subheading (h2), quote (blockquote with paragraphs), bold, italic, link, image and the support
// block (sponsorship). Images and support blocks stay out of the check: they are not claims of the text. Each text block
// (paragraph or subheading) has a stable id in `attrs.id`: claims are tied to the block and to the position inside it,
// and the check runs per block (only what changed is checked again). No Worker or DOM dependency.

export interface Brand { type: string; attrs?: Record<string, unknown> }
export interface In { type: string; attrs?: Record<string, unknown>; content?: In[]; text?: string; marks?: Brand[] }
export type BlockType = 'paragrafo' | 'intertitulo' | 'citacao';
export interface Block { id: string; tipo: BlockType; texto: string }

export const BLOCKS_MAX = 2_000;
export const DOC_MAX = 400_000;             // characters of JSON (the body is capped at 100k; the structure fits easily)
const ID_OK = /^[A-Za-z0-9_-]{1,40}$/;

/** A block's text as the check sees it: the texts in order; a line break becomes a space; a note, its label. */
export function fromInText(node: In): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return ' ';
  if (node.type === 'nota') return String(node.attrs?.rotulo ?? '');
  return (node.content ?? []).map(fromInText).join('');
}

/** Text blocks in document order (a paragraph inside a quote is a `citacao` block). */
export function blocksDoc(doc: In): Block[] {
  const out: Block[] = [];
  for (const n of doc.content ?? []) {
    if (n.type === 'paragraph') out.push({ id: String(n.attrs?.id ?? ''), tipo: 'paragrafo', texto: fromInText(n) });
    else if (n.type === 'heading') out.push({ id: String(n.attrs?.id ?? ''), tipo: 'intertitulo', texto: fromInText(n) });
    else if (n.type === 'blockquote') for (const p of n.content ?? []) if (p.type === 'paragraph') out.push({ id: String(p.attrs?.id ?? ''), tipo: 'citacao', texto: fromInText(p) });
  }
  return out;
}

/** A paragraph as the desk stores it in `paragrafos_json` (Docs, Substack, Instagram): spaces collapsed, no empties. */
export const normalParagraph = (p: string) => p.replace(/\s+/g, ' ').trim();
export const paragraphsDoc = (doc: In) => blocksDoc(doc).map((b) => normalParagraph(b.texto)).filter(Boolean);

/** Without a typed title, the first line of the text is used. */
export const fromFirstLineTitle = (doc: In) => (paragraphsDoc(doc)[0] ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);

const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * HTML of a Google Docs paragraph (`<a href><i><b>text</b></i></a>` per run, as src/lib/google.ts builds it) → text
 * nodes with marks. Only valid if the resulting text equals the desk's paragraph; otherwise, plain text.
 */
export function inlineHtmlDocs(html: string, text: string): In[] {
  const nodes: In[] = [];
  const re = /(?:<a href="([^"]*)">)?(<i>)?(<b>)?([^<]+)(?:<\/b>)?(?:<\/i>)?(?:<\/a>)?/g;
  for (const m of html.matchAll(re)) {
    const t = unesc(m[4]).replace(/\s+/g, ' ');
    if (!t) continue;
    const marks: Brand[] = [];
    if (m[3]) marks.push({ type: 'bold' });
    if (m[2]) marks.push({ type: 'italic' });
    if (m[1] && /^https?:\/\//.test(unesc(m[1]))) marks.push({ type: 'link', attrs: { href: unesc(m[1]) } });
    nodes.push({ type: 'text', text: t, ...(marks.length ? { marks } : {}) });
  }
  // The result must be exactly the desk's paragraph (including spaces at the ends and between runs).
  if (nodes.map((n) => n.text).join('') !== text) return text ? [{ type: 'text', text: text }] : [];
  return nodes;
}

/**
 * Older text (no `doc_json`): paragraphs become blocks with ids derived from position (`p0`, `p1`…), so earlier marks
 * (tied to the index) find their block. From Docs: subheadings, and bold, italic and links from there.
 */
export function docParagraphs(paragraphs: string[], docs?: { texto: string; estilo: string | null; html: string }[] | null): In {
  const perText = new Map((docs ?? []).map((p) => [p.texto, p]));
  return {
    type: 'doc',
    content: paragraphs.map((text, i) => {
      const d = perText.get(text);
      const content = d ? inlineHtmlDocs(d.html, text) : text ? [{ type: 'text', text: text }] : [];
      return /^HEADING_/.test(d?.estilo ?? '')
        ? { type: 'heading', attrs: { id: `p${i}`, level: 2 }, content }
        : { type: 'paragraph', attrs: { id: `p${i}` }, content };
    }),
  };
}

export class DocError extends Error {
  constructor(message: string, readonly en: string) { super(message); }
}

/**
 * Document from the screen → clean document: only the allowed nodes and marks (the rest is dropped), links only
 * http(s), subheadings always h2. A block without an id, with an invalid or repeated id gets a new one (`newId`).
 */
export function cleanDoc(raw: unknown, newId: () => string): In {
  if (!raw || typeof raw !== 'object' || (raw as In).type !== 'doc' || !Array.isArray((raw as In).content)) {
    throw new DocError('doc: documento do editor inválido', 'doc: invalid editor document');
  }
  if (JSON.stringify(raw).length > DOC_MAX) throw new DocError('Texto longo demais.', 'Text too long.');
  const seen = new Set<string>();
  const id = (a: unknown) => {
    const v = typeof a === 'string' && ID_OK.test(a) && !seen.has(a) ? a : newId().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
    seen.add(v);
    return v;
  };
  const marks = (ms: unknown): Brand[] => {
    if (!Array.isArray(ms)) return [];
    const out: Brand[] = [];
    for (const m of ms as Brand[]) {
      if (m?.type === 'bold' || m?.type === 'italic') out.push({ type: m.type });
      else if (m?.type === 'link' && typeof m.attrs?.href === 'string' && /^https?:\/\//.test(m.attrs.href) && m.attrs.href.length <= 2000) out.push({ type: 'link', attrs: { href: m.attrs.href } });
    }
    return out;
  };
  const inline = (ns: unknown): In[] => {
    if (!Array.isArray(ns)) return [];
    const out: In[] = [];
    for (const n of ns as In[]) {
      if (n?.type === 'text' && typeof n.text === 'string' && n.text) {
        const ms = marks(n.marks);
        out.push({ type: 'text', text: n.text, ...(ms.length ? { marks: ms } : {}) });
      } else if (n?.type === 'hardBreak') out.push({ type: 'hardBreak' });
      else if (n?.type === 'nota' && typeof n.attrs?.rotulo === 'string' && typeof n.attrs?.evidencia === 'string') {
        out.push({ type: 'nota', attrs: { rotulo: n.attrs.rotulo.slice(0, 300), evidencia: n.attrs.evidencia.slice(0, 60) } });
      }
    }
    return out;
  };
  // Text blocks (paragraph or subheading) at any depth: a quote inside a quote, a list or another container the editor
  // let through becomes paragraphs, in order, without losing text.
  const blocksText = (n: In | undefined): In[] =>
    n?.type === 'paragraph' || n?.type === 'heading' ? [n] : Array.isArray(n?.content) ? (n.content as In[]).flatMap(blocksText) : [];
  const paragraph = (p: In): In => ({ type: 'paragraph', attrs: { id: id(p.attrs?.id) }, content: inline(p.content) });
  const content: In[] = [];
  for (const n of (raw as In).content as In[]) {
    if (n?.type === 'paragraph') content.push(paragraph(n));
    else if (n?.type === 'imagem') {
      const { src, alt } = n.attrs ?? {};
      if (typeof src === 'string' && /^https?:\/\//.test(src) && src.length <= 2000) content.push({ type: 'imagem', attrs: { src, alt: typeof alt === 'string' ? alt.slice(0, 300) : '' } });
    } else if (n?.type === 'apoio') {
      const { patrocinio: sponsorship, texto: text } = n.attrs ?? {};
      if (typeof text === 'string' && text.trim()) content.push({ type: 'apoio', attrs: { patrocinio: typeof sponsorship === 'string' ? sponsorship.slice(0, 60) : '', texto: text.trim().slice(0, 300) } });
    } else if (n?.type === 'heading') content.push({ type: 'heading', attrs: { id: id(n.attrs?.id), level: 2 }, content: inline(n.content) });
    else if (n?.type === 'blockquote') {
      // Inside a quote there are only paragraphs (one level): subheadings and nested quotes become its paragraphs.
      const ps = blocksText(n).map(paragraph);
      if (ps.length) content.push({ type: 'blockquote', content: ps });
    } else content.push(...blocksText(n).map(paragraph));
  }
  if (!content.length) content.push({ type: 'paragraph', attrs: { id: id(null) }, content: [] });
  if (blocksDoc({ type: 'doc', content }).length > BLOCKS_MAX) throw new DocError(`Texto com parágrafos demais (até ${BLOCKS_MAX}).`, `Too many paragraphs (up to ${BLOCKS_MAX}).`);
  return { type: 'doc', content };
}

/** New paragraphs (text pasted in place of the document) with the ids of earlier blocks that have the same text. */
export function docWithIdsOf(paragraphs: string[], before: Block[], newId: () => string): In {
  const free = new Map<string, string[]>();
  for (const b of before) free.set(normalParagraph(b.texto), [...(free.get(normalParagraph(b.texto)) ?? []), b.id]);
  return {
    type: 'doc',
    content: paragraphs.map((text) => {
      const id = free.get(text)?.shift() ?? newId();
      return { type: 'paragraph', attrs: { id }, content: text ? [{ type: 'text', text: text }] : [] };
    }),
  };
}

function inlineHtml(ns: In[] = []): string {
  return ns.map((n) => {
    if (n.type === 'hardBreak') return '<br>';
    if (n.type === 'nota') return esc(String(n.attrs?.rotulo ?? ''));
    let h = esc(n.text ?? '');
    for (const m of n.marks ?? []) {
      if (m.type === 'bold') h = `<strong>${h}</strong>`;
      else if (m.type === 'italic') h = `<em>${h}</em>`;
      else if (m.type === 'link') h = `<a href="${esc(String(m.attrs?.href ?? ''))}">${h}</a>`;
    }
    return h;
  }).join('');
}

/** "Copy to Substack": title and document as HTML (h1, h2, p, blockquote, strong, em, a, img) and as plain text. */
export function substackDoc(title: string, doc: In): { html: string; texto: string } {
  const parts: string[] = [`<h1>${esc(title)}</h1>`];
  const texts: string[] = [title];
  for (const n of doc.content ?? []) {
    if (n.type === 'paragraph' || n.type === 'heading') {
      const t = normalParagraph(fromInText(n));
      if (!t) continue;
      parts.push(n.type === 'heading' ? `<h2>${inlineHtml(n.content)}</h2>` : `<p>${inlineHtml(n.content)}</p>`);
      texts.push(t);
    } else if (n.type === 'blockquote') {
      const ps = (n.content ?? []).filter((p) => normalParagraph(fromInText(p)));
      if (!ps.length) continue;
      parts.push(`<blockquote>${ps.map((p) => `<p>${inlineHtml(p.content)}</p>`).join('')}</blockquote>`);
      texts.push(...ps.map((p) => normalParagraph(fromInText(p))));
    } else if (n.type === 'imagem') {
      parts.push(`<p><img src="${esc(String(n.attrs?.src ?? ''))}" alt="${esc(String(n.attrs?.alt ?? ''))}"></p>`);
    } else if (n.type === 'apoio') {
      parts.push(`<p><em>${esc(String(n.attrs?.texto ?? ''))}</em></p>`);
      texts.push(String(n.attrs?.texto ?? ''));
    }
  }
  return { html: parts.join('\n'), texto: texts.join('\n\n') };
}
