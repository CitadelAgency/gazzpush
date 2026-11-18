// Raio-X dos posts antigos: o que dá para ler do arquivo do Instagram e da resposta do modelo de visão. Puro.
// O formato do arquivo da Meta não está confirmado: o leitor procura em qualquer JSON objetos com `uri` e `creation_timestamp`.
export const MAX_ITENS_LOTE = 2000;
export const MINIATURA_LADO = 512;
export const MINIATURA_MAX_BYTES = 256 * 1024;
export const LEGENDA_MAX = 2200;
export const ITENS_POR_PAGINA = 60;

export interface PostArquivo { uri: string; data: string; legenda: string }

/** Exportação da Meta: UTF-8 lido como Latin-1 ("aÃ§Ã£o"). Texto que já está certo não muda. */
export function consertarAcento(s: string): string {
  const cod = [...s].map((c) => c.codePointAt(0)!);
  if (!cod.some((c) => c >= 0x80) || cod.some((c) => c > 0xff)) return s;
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(Uint8Array.from(cod));
  } catch {
    return s;
  }
}

/** Todo objeto com `uri` e `creation_timestamp`, em qualquer profundidade. A legenda pode estar nele ou no objeto de fora. */
export function acharPosts(json: unknown): PostArquivo[] {
  const achados: PostArquivo[] = [];
  const andar = (v: unknown, tituloDeFora: string) => {
    if (Array.isArray(v)) { for (const x of v) andar(x, tituloDeFora); return; }
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    const titulo = typeof o.title === 'string' && o.title.trim() ? o.title : tituloDeFora;
    const ts = Number(o.creation_timestamp);
    if (typeof o.uri === 'string' && o.uri && !/^https?:/i.test(o.uri) && Number.isFinite(ts) && ts > 0) {
      achados.push({ uri: o.uri.replace(/^\.?\//, ''), data: new Date(ts * 1000).toISOString(), legenda: consertarAcento(titulo).slice(0, LEGENDA_MAX) });
    }
    for (const x of Object.values(o)) if (x && typeof x === 'object') andar(x, titulo);
  };
  andar(json, '');
  return achados;
}

const NA_LEGENDA = [
  /\bvia\s+@[\w.]+/iu, /\bcr[ée]ditos?\b[^\n]{0,40}/iu, /\bfotos?\s*:[^\n]{0,40}/iu, /\bimagem\s*:[^\n]{0,40}/iu, /\breprodu[çc][ãa]o\b/iu,
  /\bcredits?\b[^\n]{0,40}/iu, /\bphotos?\s*(?:by|:)[^\n]{0,40}/iu, /\bimage\s*:[^\n]{0,40}/iu, /\bcourtesy of\b[^\n]{0,40}/iu, /\brepost(?:ed)?\b[^\n]{0,40}/iu,
];

/** O trecho da legenda que aponta para mídia de terceiro. */
export function marcasNaLegenda(legenda: string): string[] {
  const achados = NA_LEGENDA.map((r) => legenda.match(r)?.[0].trim()).filter((x): x is string => !!x);
  return [...new Set(achados)].slice(0, 3);
}

export const PROMPT_RAIOX = 'Inspecione a imagem e responda SOMENTE com JSON, sem comentário: {"marca_dagua":true|false,"logo":true|false,"credito":true|false}. '
  + 'marca_dagua = marca d\'água de outra página ou agência sobre a imagem. logo = logotipo de terceiro, de TV, jornal ou agência. credito = crédito de foto escrito na imagem.';

export const CODIGOS_VISAO = ['marca_dagua', 'logo', 'credito'] as const;

/** Os motivos que o modelo apontou; null se a resposta não dá para ler. */
export function lerVisao(resposta: unknown): string[] | null {
  const texto = typeof resposta === 'string' ? resposta : JSON.stringify(resposta ?? null);
  const m = texto.match(/\{[^}]*\}/);
  if (!m) return null;
  try {
    const r = JSON.parse(m[0]) as Record<string, unknown>;
    if (!CODIGOS_VISAO.some((c) => typeof r[c] === 'boolean')) return null;
    return CODIGOS_VISAO.filter((c) => r[c] === true);
  } catch {
    return null;
  }
}
