import { DOMParser } from 'linkedom';
import { OPACIDADE_MAX, OPACIDADE_MIN, POSICOES_MARCA_DAGUA, type MarcaDagua } from '../lib/marcaDagua';
import { PARES_FONTES, PAR_PADRAO, ehParFontes, type ParFontes } from '../lib/tipografia';
import type { Idioma } from './idioma';

/**
 * Marca do veículo (PATCH /marca, POST /marca/logo e /marca/referencia): nome, @, 3 cores, estilo da ilustração, os
 * textos dos convites que já existem e a marca d'água. Chaves do R2, destaques e telefone dos convites, domínio e URL
 * não entram por aqui.
 */

export const LOGO_MAX_BYTES = 512 * 1024;
export const REFERENCIA_MAX_BYTES = 2 * 1024 * 1024;
export const ESTILO_ARTE_MAX = 300;
/** Assinatura do card de autor (veículo autoral): o nome de quem escreve, no rodapé. */
export const ASSINATURA_MAX = 60;
/** Campos editáveis de cada convite (`ctas[i]`) e o tamanho máximo de cada um. `acao` é opcional (o render tem padrão). */
export const CTA_CAMPOS = { titulo: 80, texto: 200, legenda: 300, acao: 60 } as const;
export type CtaTexto = { titulo: string; texto: string; legenda: string; acao?: string };
// O convite entra na legenda e no último card, e a validação da peça (src/lib/validacao.ts) confere todo número e dia
// da semana contra os fatos da notícia: um "24 horas" no convite derrubaria toda peça. Por isso o convite não leva.
const NAO_FATO = /\d|\b(domingo|segunda|terça|quarta|quinta|sexta|sábado)\b/i;
const HEX = /^#[0-9a-f]{6}$/i;
const HANDLE = /^[A-Za-z0-9._]{1,30}$/;
const CORES = ['fundo', 'texto', 'acento'] as const;

export interface MarcaPatch {
  nome?: string;
  handle?: string | null;
  cores?: Partial<Record<(typeof CORES)[number], string>>;
  estiloArte?: string | null;
  marcaDagua?: MarcaDagua;
  assinatura?: string | null;
  fontes?: ParFontes;
}

/**
 * Valida o body do PATCH e devolve o merge-patch (RFC 7396, `json_patch` do SQLite) ou a mensagem de erro. Os textos
 * dos convites voltam à parte (`ctas`): a lista inteira é trocada no patch, então a rota mescla com o que já existe.
 */
export function validarMarca(b: Record<string, unknown>, idioma: Idioma = 'pt-BR'): { patch: MarcaPatch; ctas?: CtaTexto[] } | { erro: string } {
  const tr = (pt: string, en: string) => (idioma === 'en' ? en : pt);
  const patch: MarcaPatch = {};
  if (b.nome !== undefined) {
    const nome = String(b.nome ?? '').trim();
    if (nome.length < 2 || nome.length > 80) return { erro: tr('nome entre 2 e 80 caracteres', 'name must be 2 to 80 characters') };
    patch.nome = nome;
  }
  if (b.handle !== undefined) {
    const h = String(b.handle ?? '').trim().replace(/^@/, '');
    if (h && !HANDLE.test(h)) return { erro: tr('handle: até 30 letras, números, ponto ou _', 'handle: up to 30 letters, numbers, period or _') };
    patch.handle = h ? `@${h}` : null;   // vazio apaga
  }
  if (b.cores !== undefined) {
    if (!b.cores || typeof b.cores !== 'object') return { erro: tr('cores: { fundo, texto, acento } em #rrggbb', 'cores: { fundo, texto, acento } in #rrggbb') };
    const cores: MarcaPatch['cores'] = {};
    for (const k of CORES) {
      const v = (b.cores as Record<string, unknown>)[k];
      if (v === undefined) continue;
      if (typeof v !== 'string' || !HEX.test(v)) return { erro: `cores.${k}: hex #rrggbb` };
      cores[k] = v.toLowerCase();
    }
    patch.cores = cores;
  }
  if (b.estiloArte !== undefined) {
    if (b.estiloArte !== null && typeof b.estiloArte !== 'string') return { erro: tr('estiloArte: texto', 'estiloArte: text') };
    const e = String(b.estiloArte ?? '').replace(/\s+/g, ' ').trim();
    if (e.length > ESTILO_ARTE_MAX) return { erro: tr(`estiloArte: até ${ESTILO_ARTE_MAX} caracteres`, `estiloArte: up to ${ESTILO_ARTE_MAX} characters`) };
    patch.estiloArte = e || null;   // vazio apaga (volta ao estilo derivado das cores)
  }
  if (b.marcaDagua !== undefined) {
    const m = b.marcaDagua as Record<string, unknown> | null;
    if (!m || typeof m !== 'object' || !(POSICOES_MARCA_DAGUA as readonly unknown[]).includes(m.posicao)) {
      return { erro: `marcaDagua.posicao: ${POSICOES_MARCA_DAGUA.join(' | ')}` };
    }
    const o = m.opacidade;
    if (typeof o !== 'number' || !Number.isFinite(o) || o < OPACIDADE_MIN || o > OPACIDADE_MAX) {
      return { erro: tr(`marcaDagua.opacidade: de ${OPACIDADE_MIN} a ${OPACIDADE_MAX}`, `marcaDagua.opacidade: from ${OPACIDADE_MIN} to ${OPACIDADE_MAX}`) };
    }
    patch.marcaDagua = { posicao: m.posicao as MarcaDagua['posicao'], opacidade: Math.round(o * 100) / 100 };
  }
  if (b.assinatura !== undefined) {
    if (b.assinatura !== null && typeof b.assinatura !== 'string') return { erro: tr('assinatura: texto', 'assinatura: text') };
    const a = String(b.assinatura ?? '').replace(/\s+/g, ' ').trim();
    if (a.length > ASSINATURA_MAX) return { erro: tr(`assinatura: até ${ASSINATURA_MAX} caracteres`, `assinatura: up to ${ASSINATURA_MAX} characters`) };
    patch.assinatura = a || null;   // vazio apaga (o card assina com o nome do veículo)
  }
  if (b.fontes !== undefined) {
    if (!ehParFontes(b.fontes)) return { erro: `fontes: ${PARES_FONTES.join(' | ')}` };
    patch.fontes = b.fontes;
  }
  if (b.ctas === undefined) return { patch };
  if (!Array.isArray(b.ctas) || b.ctas.length > 10) return { erro: tr('ctas: lista dos convites', 'ctas: list of invite cards') };
  const ctas: CtaTexto[] = [];
  for (const [i, c] of b.ctas.entries()) {
    if (!c || typeof c !== 'object') return { erro: tr(`ctas[${i}]: objeto`, `ctas[${i}]: object`) };
    const t = {} as CtaTexto;
    for (const [k, max] of Object.entries(CTA_CAMPOS) as [keyof CtaTexto, number][]) {
      const v = (c as Record<string, unknown>)[k];
      if (k === 'acao' && (v === undefined || v === null || v === '')) continue;   // sem botão: o render usa o título
      if (typeof v !== 'string') return { erro: tr(`ctas[${i}].${k}: texto`, `ctas[${i}].${k}: text`) };
      const limpo = v.replace(/\s+/g, ' ').trim();
      if (k === 'acao' && !limpo) continue;
      if (!limpo || limpo.length > max) return { erro: tr(`ctas[${i}].${k}: de 1 a ${max} caracteres`, `ctas[${i}].${k}: 1 to ${max} characters`) };
      if (NAO_FATO.test(limpo)) return { erro: tr(`convite ${i + 1}: sem números nem dia da semana (a checagem de fatos recusaria o post)`, `invite card ${i + 1}: no numbers or days of the week (the fact check would reject the post)`) };
      t[k] = limpo;
    }
    ctas.push(t);
  }
  return { patch, ctas };
}

/**
 * Textos novos sobre os convites que já existem, na mesma ordem: só título, texto, legenda e ação mudam; destaques,
 * telefone, url e edição ficam. Quantidade diferente: erro (não se cria nem apaga convite por aqui).
 */
export function mesclarCtas(atuais: unknown, textos: CtaTexto[], idioma: Idioma = 'pt-BR'): Record<string, unknown>[] | { erro: string } {
  const lista = Array.isArray(atuais) ? (atuais as Record<string, unknown>[]) : [];
  if (lista.length !== textos.length) {
    return { erro: idioma === 'en'
      ? `ctas: the publication has ${lista.length} invite card${lista.length === 1 ? '' : 's'}; send all ${lista.length}`
      : `ctas: o veículo tem ${lista.length} convite(s); mande os ${lista.length}` };
  }
  return lista.map((c, i) => {
    const { acao: _velha, ...resto } = c;
    // Sem ação no pedido: o convite fica sem botão próprio (o render usa o título), como era antes de ter.
    return { ...resto, ...textos[i] };
  });
}

/**
 * O que a UI vê da marca: sem chaves do R2; dos convites, só os textos editáveis. `temReferencia`: há imagem de
 * referência para a ilustração (sem ela, a arte sai no estilo padrão).
 */
export function marcaPublica(json: string | null | undefined) {
  const m = JSON.parse(json || '{}') as {
    nome?: string; handle?: string; cores?: Record<string, string>; logoR2?: string; arteRefR2?: string; estiloArte?: string;
    ctas?: Record<string, unknown>[]; marcaDagua?: MarcaDagua; assinatura?: string; dominio?: string; fontes?: string;
  };
  const texto = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    nome: m.nome ?? null, handle: m.handle ?? null, cores: m.cores ?? {}, temLogo: Boolean(m.logoR2), temReferencia: Boolean(m.arteRefR2),
    estiloArte: m.estiloArte ?? null,
    ctas: (Array.isArray(m.ctas) ? m.ctas : []).map((c) => ({ titulo: texto(c.titulo), texto: texto(c.texto), legenda: texto(c.legenda), acao: texto(c.acao) })),
    marcaDagua: m.marcaDagua ?? { posicao: 'nenhuma' as MarcaDagua['posicao'], opacidade: 0.4 },
    // Só o veículo autoral usa (card de autor); ausente nos outros.
    assinatura: m.assinatura ?? undefined,
    // Par de fontes do card (src/lib/tipografia.ts); ausente = o padrão (a UI mostra o padrão marcado).
    fontes: ehParFontes(m.fontes) && m.fontes !== PAR_PADRAO ? m.fontes : undefined,
    dominio: m.dominio ?? undefined,   // o rodapé do card mostra o domínio antes do @ (render)
  };
}

export const ehJpeg = (b: Uint8Array) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

export const ehPng = (b: Uint8Array) =>
  b.length > 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x);

// ── SVG ──────────────────────────────────────────────────────────────────────────────────────────────────────────
// SVG é vetor de XSS quando aberto direto da nossa origem. Lista branca de elementos e atributos, serialização
// própria (escape nosso, não o do parser), nenhum recurso externo: href só para âncora interna (#id), url() só #id.

const ELEMENTOS = new Set([
  'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs', 'use', 'symbol',
  'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'pattern', 'title', 'desc', 'style',
]);
const PERIGO_CSS = /@import|expression\s*\(|javascript:|\\/i;
/** Algum url(...) que não aponta para âncora interna? Argumento lido inteiro: espaço e aspas antes do # são válidos. */
const urlExterna = (v: string) =>
  [...v.matchAll(/url\s*\(([^)]*)\)?/gi)].some((m) => !m[1].trim().replace(/^['"]\s*/, '').startsWith('#'));
const perigoCss = (v: string) => PERIGO_CSS.test(v) || urlExterna(v);

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// linkedom sem lib DOM no Worker: nós entram como any (mesmo esquema de src/lib/artigo.ts).
function serializar(el: any): string {
  const nome = String(el.localName ?? el.tagName);
  if (!ELEMENTOS.has(nome)) return '';
  const filhos = [...el.childNodes].map((n: any) => {
    if (n.nodeType === 1) return serializar(n);
    if (n.nodeType === 3 || n.nodeType === 4) return esc(String(n.nodeValue ?? ''));
    return '';   // comentário, instrução de processamento
  }).join('');
  if (nome === 'style' && perigoCss([...el.childNodes].map((n: any) => String(n.nodeValue ?? '')).join(''))) return '';
  const attrs = [...el.attributes].filter((a: any) => {
    const n = String(a.name).toLowerCase(), v = String(a.value);
    if (n.startsWith('on')) return false;
    if (n === 'href' || n === 'xlink:href') return v.trim().startsWith('#');
    if (/(?:java|vb)script:|data:/i.test(v)) return false;
    return !perigoCss(v);
  }).map((a: any) => ` ${a.name}="${esc(String(a.value))}"`).join('');
  return `<${nome}${attrs}>${filhos}</${nome}>`;
}

/** SVG limpo, ou null se não for um SVG aceitável (DOCTYPE/entidade, raiz que não é <svg>, nada sobrou). */
export function sanitizarSvg(texto: string): string | null {
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(texto)) return null;
  let raiz: any;
  try {
    raiz = new DOMParser().parseFromString(texto, 'image/svg+xml').documentElement;
  } catch {
    return null;
  }
  if (!raiz || raiz.localName !== 'svg') return null;
  const limpo = serializar(raiz);
  if (!/<(?:path|rect|circle|ellipse|line|polyline|polygon|text|use)[\s>]/.test(limpo)) return null;
  // Sem xmlns o navegador não desenha o arquivo como imagem.
  return /^<svg[^>]*\sxmlns="/.test(limpo) ? limpo : limpo.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
}

/** Lê o corpo até `max` bytes e cancela o resto: sem Content-Length (chunked) o limite vale durante a leitura. */
export async function lerCorpoAte(corpo: ReadableStream<Uint8Array> | null, max: number): Promise<Uint8Array | null> {
  if (!corpo) return new Uint8Array();
  const leitor = corpo.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await leitor.cancel();
      return null;
    }
    partes.push(value);
  }
  const bytes = new Uint8Array(total);
  let i = 0;
  for (const p of partes) { bytes.set(p, i); i += p.byteLength; }
  return bytes;
}

/** O logo no corpo cru: PNG ou SVG limpo, até 512 KB. O da marca e o do patrocinador passam pela mesma porta. */
export async function lerLogo(req: Request, idioma: 'pt-BR' | 'en' = 'pt-BR'): Promise<{ corpo: Uint8Array | string; tipo: string; ext: 'png' | 'svg' } | { erro: string; status: 400 | 413 | 415 }> {
  const tr = (pt: string, en: string) => (idioma === 'en' ? en : pt);
  const tipo = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (tipo !== 'image/png' && tipo !== 'image/svg+xml') return { erro: tr('logo: PNG ou SVG', 'logo: PNG or SVG'), status: 415 };
  if (Number(req.headers.get('content-length') ?? 0) > LOGO_MAX_BYTES) return { erro: tr('logo: até 512 KB', 'logo: up to 512 KB'), status: 413 };
  const bytes = await lerCorpoAte(req.body, LOGO_MAX_BYTES);
  if (!bytes) return { erro: tr('logo: até 512 KB', 'logo: up to 512 KB'), status: 413 };
  if (tipo === 'image/png') return ehPng(bytes) ? { corpo: bytes, tipo, ext: 'png' } : { erro: tr('arquivo não é PNG', 'file is not a PNG'), status: 400 };
  const limpo = sanitizarSvg(new TextDecoder().decode(bytes));
  return limpo ? { corpo: limpo, tipo, ext: 'svg' } : { erro: tr('SVG inválido ou sem desenho', 'invalid SVG or no drawing'), status: 400 };
}
