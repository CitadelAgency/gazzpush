// Documento do editor da Matéria (ProseMirror/Tiptap) em JSON, comum ao Worker e à tela. Só o que o editor permite:
// parágrafo, intertítulo (h2), citação (blockquote com parágrafos), negrito, itálico, link, imagem e o bloco de apoio
// (patrocínio). Imagem e apoio ficam fora da conferência: não são afirmação do texto. Cada bloco de texto
// (parágrafo ou intertítulo) tem um id estável em `attrs.id`: as afirmações se prendem ao bloco e à posição dentro
// dele, e a conferência é por bloco (só o que mudou é conferido de novo). Sem dependência de Worker nem de DOM.

export interface Marca { type: string; attrs?: Record<string, unknown> }
export interface No { type: string; attrs?: Record<string, unknown>; content?: No[]; text?: string; marks?: Marca[] }
export type TipoBloco = 'paragrafo' | 'intertitulo' | 'citacao';
export interface Bloco { id: string; tipo: TipoBloco; texto: string }

export const BLOCOS_MAX = 2_000;
export const DOC_MAX = 400_000;             // caracteres do JSON (o corpo tem teto de 100 mil; a estrutura cabe folgada)
const ID_OK = /^[A-Za-z0-9_-]{1,40}$/;

/** Texto de um bloco como a conferência vê: os textos na ordem; a quebra de linha vira espaço; a nota, o rótulo dela. */
export function textoDoNo(no: No): string {
  if (no.type === 'text') return no.text ?? '';
  if (no.type === 'hardBreak') return ' ';
  if (no.type === 'nota') return String(no.attrs?.rotulo ?? '');
  return (no.content ?? []).map(textoDoNo).join('');
}

/** Blocos de texto na ordem do documento (o parágrafo de dentro de uma citação é um bloco `citacao`). */
export function blocosDoDoc(doc: No): Bloco[] {
  const out: Bloco[] = [];
  for (const n of doc.content ?? []) {
    if (n.type === 'paragraph') out.push({ id: String(n.attrs?.id ?? ''), tipo: 'paragrafo', texto: textoDoNo(n) });
    else if (n.type === 'heading') out.push({ id: String(n.attrs?.id ?? ''), tipo: 'intertitulo', texto: textoDoNo(n) });
    else if (n.type === 'blockquote') for (const p of n.content ?? []) if (p.type === 'paragraph') out.push({ id: String(p.attrs?.id ?? ''), tipo: 'citacao', texto: textoDoNo(p) });
  }
  return out;
}

/** Parágrafo como a mesa guarda em `paragrafos_json` (Docs, Substack, Instagram): espaços juntos, sem vazios. */
export const normalParagrafo = (p: string) => p.replace(/\s+/g, ' ').trim();
export const paragrafosDoDoc = (doc: No) => blocosDoDoc(doc).map((b) => normalParagrafo(b.texto)).filter(Boolean);

/** Sem título digitado, vale a primeira linha do texto. */
export const tituloDaPrimeiraLinha = (doc: No) => (paragrafosDoDoc(doc)[0] ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);

const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * HTML de um parágrafo do Google Docs (`<a href><i><b>texto</b></i></a>` por trecho, como src/lib/google.ts monta) →
 * nós de texto com as marcas. Só vale se o texto que sai for igual ao parágrafo da mesa; senão, texto puro.
 */
export function inlineDoHtmlDocs(html: string, texto: string): No[] {
  const nos: No[] = [];
  const re = /(?:<a href="([^"]*)">)?(<i>)?(<b>)?([^<]+)(?:<\/b>)?(?:<\/i>)?(?:<\/a>)?/g;
  for (const m of html.matchAll(re)) {
    const t = unesc(m[4]).replace(/\s+/g, ' ');
    if (!t) continue;
    const marks: Marca[] = [];
    if (m[3]) marks.push({ type: 'bold' });
    if (m[2]) marks.push({ type: 'italic' });
    if (m[1] && /^https?:\/\//.test(unesc(m[1]))) marks.push({ type: 'link', attrs: { href: unesc(m[1]) } });
    nos.push({ type: 'text', text: t, ...(marks.length ? { marks } : {}) });
  }
  // O resultado tem de ser exatamente o parágrafo da mesa (espaços nas pontas e entre trechos inclusive).
  if (nos.map((n) => n.text).join('') !== texto) return texto ? [{ type: 'text', text: texto }] : [];
  return nos;
}

/**
 * Texto antigo (sem `doc_json`): os parágrafos viram blocos com ids derivados da posição (`p0`, `p1`…), para as marcas
 * de antes (presas ao índice) acharem o bloco. Do Docs, o intertítulo e o negrito, itálico e links de lá.
 */
export function docDeParagrafos(paragrafos: string[], docs?: { texto: string; estilo: string | null; html: string }[] | null): No {
  const porTexto = new Map((docs ?? []).map((p) => [p.texto, p]));
  return {
    type: 'doc',
    content: paragrafos.map((texto, i) => {
      const d = porTexto.get(texto);
      const content = d ? inlineDoHtmlDocs(d.html, texto) : texto ? [{ type: 'text', text: texto }] : [];
      return /^HEADING_/.test(d?.estilo ?? '')
        ? { type: 'heading', attrs: { id: `p${i}`, level: 2 }, content }
        : { type: 'paragraph', attrs: { id: `p${i}` }, content };
    }),
  };
}

export class ErroDoc extends Error {
  constructor(message: string, readonly en: string) { super(message); }
}

/**
 * Documento vindo da tela → documento limpo: só os nós e marcas permitidos (o resto sai), link só http(s), intertítulo
 * sempre h2. Bloco sem id, com id inválido ou repetido ganha um id novo (`novoId`).
 */
export function limparDoc(raw: unknown, novoId: () => string): No {
  if (!raw || typeof raw !== 'object' || (raw as No).type !== 'doc' || !Array.isArray((raw as No).content)) {
    throw new ErroDoc('doc: documento do editor inválido', 'doc: invalid editor document');
  }
  if (JSON.stringify(raw).length > DOC_MAX) throw new ErroDoc('Texto longo demais.', 'Text too long.');
  const vistos = new Set<string>();
  const idDe = (a: unknown) => {
    const v = typeof a === 'string' && ID_OK.test(a) && !vistos.has(a) ? a : novoId().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
    vistos.add(v);
    return v;
  };
  const marcas = (ms: unknown): Marca[] => {
    if (!Array.isArray(ms)) return [];
    const out: Marca[] = [];
    for (const m of ms as Marca[]) {
      if (m?.type === 'bold' || m?.type === 'italic') out.push({ type: m.type });
      else if (m?.type === 'link' && typeof m.attrs?.href === 'string' && /^https?:\/\//.test(m.attrs.href) && m.attrs.href.length <= 2000) out.push({ type: 'link', attrs: { href: m.attrs.href } });
    }
    return out;
  };
  const inline = (ns: unknown): No[] => {
    if (!Array.isArray(ns)) return [];
    const out: No[] = [];
    for (const n of ns as No[]) {
      if (n?.type === 'text' && typeof n.text === 'string' && n.text) {
        const ms = marcas(n.marks);
        out.push({ type: 'text', text: n.text, ...(ms.length ? { marks: ms } : {}) });
      } else if (n?.type === 'hardBreak') out.push({ type: 'hardBreak' });
      else if (n?.type === 'nota' && typeof n.attrs?.rotulo === 'string' && typeof n.attrs?.evidencia === 'string') {
        out.push({ type: 'nota', attrs: { rotulo: n.attrs.rotulo.slice(0, 300), evidencia: n.attrs.evidencia.slice(0, 60) } });
      }
    }
    return out;
  };
  // Os blocos de texto (parágrafo ou intertítulo) de qualquer profundidade: citação dentro de citação, lista ou outro
  // contêiner que o editor deixou passar vira parágrafos, na ordem, sem perder o texto.
  const blocosDeTexto = (n: No | undefined): No[] =>
    n?.type === 'paragraph' || n?.type === 'heading' ? [n] : Array.isArray(n?.content) ? (n.content as No[]).flatMap(blocosDeTexto) : [];
  const paragrafo = (p: No): No => ({ type: 'paragraph', attrs: { id: idDe(p.attrs?.id) }, content: inline(p.content) });
  const content: No[] = [];
  for (const n of (raw as No).content as No[]) {
    if (n?.type === 'paragraph') content.push(paragrafo(n));
    else if (n?.type === 'imagem') {
      const { src, alt } = n.attrs ?? {};
      if (typeof src === 'string' && /^https?:\/\//.test(src) && src.length <= 2000) content.push({ type: 'imagem', attrs: { src, alt: typeof alt === 'string' ? alt.slice(0, 300) : '' } });
    } else if (n?.type === 'apoio') {
      const { patrocinio, texto } = n.attrs ?? {};
      if (typeof texto === 'string' && texto.trim()) content.push({ type: 'apoio', attrs: { patrocinio: typeof patrocinio === 'string' ? patrocinio.slice(0, 60) : '', texto: texto.trim().slice(0, 300) } });
    } else if (n?.type === 'heading') content.push({ type: 'heading', attrs: { id: idDe(n.attrs?.id), level: 2 }, content: inline(n.content) });
    else if (n?.type === 'blockquote') {
      // Dentro da citação só há parágrafo (de um nível): intertítulo e citação aninhada viram parágrafos dela.
      const ps = blocosDeTexto(n).map(paragrafo);
      if (ps.length) content.push({ type: 'blockquote', content: ps });
    } else content.push(...blocosDeTexto(n).map(paragrafo));
  }
  if (!content.length) content.push({ type: 'paragraph', attrs: { id: idDe(null) }, content: [] });
  if (blocosDoDoc({ type: 'doc', content }).length > BLOCOS_MAX) throw new ErroDoc(`Texto com parágrafos demais (até ${BLOCOS_MAX}).`, `Too many paragraphs (up to ${BLOCOS_MAX}).`);
  return { type: 'doc', content };
}

/** Parágrafos novos (texto colado no lugar do documento) com os ids dos blocos de antes que têm o mesmo texto. */
export function docComIdsDe(paragrafos: string[], antes: Bloco[], novoId: () => string): No {
  const livres = new Map<string, string[]>();
  for (const b of antes) livres.set(normalParagrafo(b.texto), [...(livres.get(normalParagrafo(b.texto)) ?? []), b.id]);
  return {
    type: 'doc',
    content: paragrafos.map((texto) => {
      const id = livres.get(texto)?.shift() ?? novoId();
      return { type: 'paragraph', attrs: { id }, content: texto ? [{ type: 'text', text: texto }] : [] };
    }),
  };
}

function inlineHtml(ns: No[] = []): string {
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

/** "Copiar para o Substack": título e documento em HTML (h1, h2, p, blockquote, strong, em, a, img) e em texto puro. */
export function substackDoDoc(titulo: string, doc: No): { html: string; texto: string } {
  const partes: string[] = [`<h1>${esc(titulo)}</h1>`];
  const textos: string[] = [titulo];
  for (const n of doc.content ?? []) {
    if (n.type === 'paragraph' || n.type === 'heading') {
      const t = normalParagrafo(textoDoNo(n));
      if (!t) continue;
      partes.push(n.type === 'heading' ? `<h2>${inlineHtml(n.content)}</h2>` : `<p>${inlineHtml(n.content)}</p>`);
      textos.push(t);
    } else if (n.type === 'blockquote') {
      const ps = (n.content ?? []).filter((p) => normalParagrafo(textoDoNo(p)));
      if (!ps.length) continue;
      partes.push(`<blockquote>${ps.map((p) => `<p>${inlineHtml(p.content)}</p>`).join('')}</blockquote>`);
      textos.push(...ps.map((p) => normalParagrafo(textoDoNo(p))));
    } else if (n.type === 'imagem') {
      partes.push(`<p><img src="${esc(String(n.attrs?.src ?? ''))}" alt="${esc(String(n.attrs?.alt ?? ''))}"></p>`);
    } else if (n.type === 'apoio') {
      partes.push(`<p><em>${esc(String(n.attrs?.texto ?? ''))}</em></p>`);
      textos.push(String(n.attrs?.texto ?? ''));
    }
  }
  return { html: partes.join('\n'), texto: textos.join('\n\n') };
}
