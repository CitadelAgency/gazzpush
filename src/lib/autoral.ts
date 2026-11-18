import { TEXTO_CLARO, contraste } from './contraste';
import { parseHTML } from 'linkedom';
import type { Env, MonitorMessage } from '../env';
import { TransicaoInvalida } from '../kernel/estados';
import { UA, parseRss } from '../monitor/consumer';
import { ehJpeg, ehPng, lerCorpoAte, sanitizarSvg } from '../shell/marca';
import { urlSegura } from './artigo';
import { novoId, registrarEvento } from './db';
import { novaPauta } from './nova';
import { ehLimite } from './planos';
import { produzirPauta } from './produzir';
import { ctaAutoral } from './redacao';
import type { Marca } from './pauta';
import type { IdiomaConteudo } from './idiomaConteudo';

// Veículo `autoral`: a página do próprio autor no Instagram, criada pela URL do Substack. O feed (`<origem>/feed`) vira
// a fonte RSS do veículo; o feed e a página dão nome, logo, cor e assinatura; os 3 textos mais recentes viram as
// primeiras pautas, produzidas em carrossel pela fila (MonitorMessage `autoral`), para a primeira visita ter posts.

export class ErroAutoral extends Error {}

const FEED_MAX_BYTES = 5 * 1024 * 1024;   // o feed do Substack traz o HTML inteiro dos posts abertos
const PAGINA_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_MAX_BYTES = 512 * 1024;
export const ITENS_INICIAIS = 3;
const HEX = /^#[0-9a-f]{6}$/i;

export interface Substack {
  origem: string;                         // origem HTTPS da publicação
  feedUrl: string;
  titulo: string | null;                  // nome da publicação
  autor: string | null;                   // dc:creator do post mais recente (ou itunes:author)
  imagem: string | null;                  // imagem do canal ou og:image da página
  corTema: string | null;                 // meta theme-color (#rrggbb)
  itens: { url: string; titulo: string | null; publicadoEm: string | null }[];   // do mais recente para o mais antigo
}

/** URL colada pela pessoa → origem do Substack. Aceita sem esquema e link de post. */
export function origemSubstack(bruto: string): string | null {
  const v = bruto.trim();
  if (!v || v.length > 2000) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    return urlSegura(u.href) ? u.origin : null;
  } catch { return null; }
}

const decodificar = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, ' ').trim();
function tag(xml: string, nome: string): string | null {
  const m = xml.match(new RegExp(`<${nome}\\b[^>]*>([\\s\\S]*?)<\\/${nome}>`, 'i'));
  const v = m ? decodificar(m[1]) : '';
  return v || null;
}

const MAX_REDIRECTS = 5;

/**
 * GET com teto de bytes. Redirect seguido à mão, com urlSegura em cada salto (o domínio próprio de um Substack
 * redireciona para outro host, então o host pode mudar; endereço interno ou sem https, não).
 */
export async function buscar(url: string, accept: string, max: number): Promise<{ status: number; tipo: string; bytes: Uint8Array | null } | null> {
  let atual = url;
  try {
    for (let salto = 0; salto <= MAX_REDIRECTS; salto++) {
      if (!urlSegura(atual)) return null;
      const res = await fetch(atual, { headers: { 'user-agent': UA, accept }, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
      const destino = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (destino) { await res.body?.cancel(); atual = new URL(destino, atual).href; continue; }
      if (!res.ok) { await res.body?.cancel(); return { status: res.status, tipo: '', bytes: null }; }
      return { status: res.status, tipo: res.headers.get('content-type') ?? '', bytes: await lerCorpoAte(res.body, max) };
    }
    return null;
  } catch { return null; }
}

/** Feed e página do Substack. Feed que não responde ou não é RSS/Atom: ErroAutoral (a tela diz em linguagem de leigo). */
export async function lerSubstack(origem: string): Promise<Substack> {
  const feedUrl = `${origem}/feed`;
  const feed = await buscar(feedUrl, 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5', FEED_MAX_BYTES);
  const xml = feed?.bytes ? new TextDecoder().decode(feed.bytes) : '';
  if (!/<(rss|feed)\b/i.test(xml)) throw new ErroAutoral('nao_e_feed');
  // Cabeça do canal: antes do primeiro item.
  const cabeca = xml.split(/<(?:item|entry)\b/i)[0];
  const itens = parseRss(xml).sort((a, b) => (b.publicadoEm ?? '').localeCompare(a.publicadoEm ?? ''));
  const primeiro = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/i)?.[0] ?? '';
  const imagemCanal = cabeca.match(/<image\b[^>]*>[\s\S]*?<url>([\s\S]*?)<\/url>/i)?.[1] ?? cabeca.match(/<itunes:image\b[^>]*href="([^"]+)"/i)?.[1] ?? null;

  let ogImage: string | null = null, corTema: string | null = null, siteNome: string | null = null;
  const pagina = await buscar(origem, 'text/html,application/xhtml+xml', PAGINA_MAX_BYTES);
  if (pagina?.bytes && /html/i.test(pagina.tipo)) {
    const { document } = parseHTML(new TextDecoder().decode(pagina.bytes));
    const meta = (sel: string) => document.querySelector(sel)?.getAttribute('content')?.trim() || null;
    ogImage = meta('meta[property="og:image"]');
    siteNome = meta('meta[property="og:site_name"]');
    const cor = meta('meta[name="theme-color"]');
    corTema = cor && HEX.test(cor) ? cor.toLowerCase() : null;
  }
  return {
    origem, feedUrl, itens,
    titulo: tag(cabeca, 'title') ?? siteNome,
    autor: tag(primeiro, 'dc:creator') ?? tag(cabeca, 'itunes:author') ?? tag(cabeca, 'managingEditor'),
    imagem: (imagemCanal && decodificar(imagemCanal)) || ogImage,
    corTema,
  };
}

/**
 * Cor do tema → cores do card. Escura o bastante para o texto claro (4,5:1) vira o fundo; clara vira o destaque (o
 * fundo fica o padrão escuro do render). Sem cor: nada (paleta padrão; o passo da marca mostra).
 */
export function coresDoTema(cor: string | null): Marca['cores'] | undefined {
  if (!cor || !HEX.test(cor)) return undefined;
  return contraste(TEXTO_CLARO, cor) >= 4.5 ? { fundo: cor, texto: TEXTO_CLARO } : { acento: cor };
}

/** Imagem do canal → logo no R2 (PNG, JPEG ou SVG limpo, até 512 KB). Falha = sem logo (o card assina com o nome). */
export async function baixarLogo(env: Env, tenantId: string, url: string | null): Promise<string | null> {
  if (!url) return null;
  const r = await buscar(url, 'image/png, image/jpeg, image/svg+xml;q=0.9', LOGO_MAX_BYTES);
  if (!r?.bytes?.length) return null;
  let corpo: Uint8Array | string = r.bytes, tipo: string, ext: string;
  if (ehPng(r.bytes)) { tipo = 'image/png'; ext = 'png'; }
  else if (ehJpeg(r.bytes)) { tipo = 'image/jpeg'; ext = 'jpg'; }
  else if (/svg/i.test(r.tipo)) {
    const limpo = sanitizarSvg(new TextDecoder().decode(r.bytes));
    if (!limpo) return null;
    corpo = limpo; tipo = 'image/svg+xml'; ext = 'svg';
  } else return null;
  const key = `marcas/${tenantId}/logo-${novoId()}.${ext}`;
  await env.MEDIA.put(key, corpo, { httpMetadata: { contentType: tipo } });
  return key;
}

/** Marca inicial do veículo autoral: nome, domínio, link, assinatura, cores do tema e o convite padrão do autor. */
export function marcaAutoral(nome: string, s: Substack, idioma?: IdiomaConteudo): Marca {
  const cores = coresDoTema(s.corTema);
  return {
    nome, dominio: new URL(s.origem).host, ctaUrl: s.origem,
    assinatura: (s.autor ?? nome).slice(0, 60),
    ...(cores ? { cores } : {}),
    ctas: [ctaAutoral(s.titulo ?? nome, idioma)],
  };
}

/** A abertura de um texto (até 2 frases, 300 caracteres) para os exemplos de voz da redação. */
export function abertura(texto: string): string | null {
  const limpo = texto.replace(/\s+/g, ' ').trim();
  if (!limpo) return null;
  let out = '';
  for (const { segment } of new Intl.Segmenter('pt-BR', { granularity: 'sentence' }).segment(limpo)) {
    if (out && (out + segment).length > 300) break;
    out += segment;
    if (out.length >= 140) break;
  }
  out = out.trim();
  if (out.length <= 300) return out;
  const corte = out.lastIndexOf(' ', 297);
  return `${out.slice(0, corte > 100 ? corte : 297).trim()}…`;
}

/** Reenvios dos textos que falharam (em 5 min, 15 min, 45 min); depois disso o monitor do feed traz o resto. */
const REENVIOS_AUTORAL = 3;

/**
 * Fila: os primeiros textos do autor → pautas manuais (o mesmo caminho do link na Nova ideia) → exemplos de voz (a
 * abertura de cada um) → produção em carrossel. Reentregue, a pauta que já existe volta como existente e a que já está
 * em produção não é produzida de novo. Texto que falhou volta numa mensagem nova só com ele: os que deram certo não se
 * repetem (descartados no meio-tempo ou com o texto mudado no Substack, virariam pauta de novo).
 */
export async function iniciarAutoral(env: Env, m: Extract<MonitorMessage, { tipo: 'autoral' }>) {
  const { tenantId, por, urls } = m;
  const pautas: { pautaId: string; status: string }[] = [];
  const falhas: string[] = [];
  for (const url of urls) {
    try {
      const r = await novaPauta(env, tenantId, por, { tipo: 'link', url });
      pautas.push({ pautaId: r.pautaId, status: r.status });
    } catch (e) {
      falhas.push(url);
      await registrarEvento(env, tenantId, 'autoral.item_falhou', 'tenant', tenantId, { url, erro: String((e as Error).message ?? e).slice(0, 300) });
    }
  }

  // Exemplos de voz: a abertura dos textos importados, na ordem do feed. Só se ninguém escreveu exemplos antes.
  const exemplos: string[] = [];
  for (const { pautaId } of pautas) {
    const doc = await env.DB.prepare("SELECT json_extract(documento_ids_json, '$[0]') AS doc FROM pautas WHERE id = ? AND tenant_id = ?")
      .bind(pautaId, tenantId).first<{ doc: string | null }>();
    const texto = doc?.doc ? await env.MEDIA.get(`texto/${tenantId}/${doc.doc}.txt`).then((o) => o?.text()) : null;
    const corpo = texto?.slice(texto.indexOf('\n\n') + 2) ?? '';
    const a = abertura(corpo);
    if (a) exemplos.push(a);
  }
  if (exemplos.length) {
    await env.DB.prepare("UPDATE tenants SET voz_json = json_set(voz_json, '$.exemplos', json(?)) WHERE id = ? AND json_extract(voz_json, '$.exemplos') IS NULL")
      .bind(JSON.stringify(exemplos), tenantId).run();
  }

  for (const p of pautas) {
    if (p.status !== 'sugerida') continue;
    try {
      await produzirPauta(env, tenantId, p.pautaId, por, 'carrossel');
    } catch (e) {
      if (!(e instanceof TransicaoInvalida) && !ehLimite(e)) throw e;   // outra pessoa já mandou produzir ou descartou, ou o teste acabou: fica em Ideias
    }
  }
  const tentativa = m.tentativa ?? 0;
  if (falhas.length && tentativa < REENVIOS_AUTORAL) {
    await env.MONITOR_QUEUE.send({ ...m, urls: falhas, tentativa: tentativa + 1 }, { delaySeconds: 300 * 3 ** tentativa });
  }
}
