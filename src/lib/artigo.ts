import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import { bloqueado, type RespostaNavegador } from './navegador';

// Extração do texto da matéria a partir do HTML (Readability + linkedom).

export interface Artigo {
  titulo: string;
  texto: string;
  url: string;              // canônica, se o publisher informar e for do mesmo host
  publicadoEm: string | null;
  modificadoEm: string | null;
  capturadoEm: string;
  metodo: string;           // jsonld_article_body | g1_article_body | readability
  sha256: string;
}

export const MAX_CHARS_ARTIGO = 100_000;
const MAX_HTML_BYTES = 2_000_000;
const limpar = (v: string) => v.replace(/\s+/g, ' ').trim();
// textContent cola blocos ("normalDevido"). Fecha bloco vira quebra antes de extrair o texto.
const separarBlocos = (html: string) => html.replace(/<(br|hr)\b[^>]*>|<\/(p|div|li|ul|ol|h[1-6]|tr|td|th|section|article|blockquote|figcaption|dd|dt)\s*>/gi, '$&\n');
const hostKey = (host: string) => host.toLowerCase().replace(/^www\./, '');

export const entradaModelo = (a: Pick<Artigo, 'titulo' | 'texto'>) => `${a.titulo}\n\n${a.texto}`;

export function urlSegura(value: string): boolean {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      && (!url.port || ['80', '443'].includes(url.port))
      && !/^[\d.]+$|[:\[\]]/.test(url.hostname)
      && url.hostname.includes('.') && !/(^|\.)(localhost|local|internal|test|invalid)$/.test(url.hostname);
  } catch { return false; }
}

// Data editorial válida: calendário real, não no futuro, não antes de 2000.
export function diaValido(value: string, agora: Date): boolean {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const [ano, mes, dia] = [+m[1], +m[2], +m[3]];
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia
    && ano >= 2000 && d.getTime() <= agora.getTime() + 24 * 3600 * 1000;
}

function dataEditorial(value: unknown, agora: Date): string | null {
  if (typeof value !== 'string' || !diaValido(value.slice(0, 10), agora)) return null;
  if (value.length === 10) return value;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed <= agora.getTime() ? value : null;
}

export async function extrairArtigo(html: string, url: string, agora = new Date()): Promise<Artigo> {
  const { document } = parseHTML(html);
  const nos: Record<string, unknown>[] = [];
  const visitar = (value: unknown, depth = 0) => {
    if (depth > 5 || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach((item) => visitar(item, depth + 1)); return; }
    const node = value as Record<string, unknown>;
    const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
    if (types.some((t) => typeof t === 'string' && /^(NewsArticle|Article|ReportageNewsArticle|BlogPosting)$/.test(t))) nos.push(node);
    if (node['@graph']) visitar(node['@graph'], depth + 1);
  };
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { visitar(JSON.parse(script.textContent ?? '')); } catch { /* JSON-LD é opcional */ }
  }

  let canonica = url;
  const href = document.querySelector('link[rel="canonical"]')?.getAttribute('href');
  if (href) {
    try {
      const c = new URL(href, url);
      if (urlSegura(c.href) && hostKey(c.hostname) === hostKey(new URL(url).hostname)) canonica = c.href;
    } catch { /* mantém a URL buscada */ }
  }

  const identidade = (node: Record<string, unknown>) => {
    const id = node.mainEntityOfPage;
    return typeof id === 'string' ? id : id && typeof id === 'object' ? (id as Record<string, unknown>)['@id'] : node.url;
  };
  const casados = nos.filter((n) => { const c = identidade(n); return typeof c === 'string' && c.split('#')[0] === canonica.split('#')[0]; });
  // Vários Article sem relação não autorizam escolher o primeiro.
  const meta = casados.length === 1 ? casados[0] : nos.length === 1 && !identidade(nos[0]) ? nos[0] : null;

  const prop = (p: string) => document.querySelector(`meta[property="${p}"]`)?.getAttribute('content');
  let titulo = limpar(prop('og:title') ?? document.querySelector('h1')?.textContent ?? document.title ?? '');
  // "Manchete | G1" → "Manchete". Só remove quando o sufixo é o nome do site.
  const site = limpar(prop('og:site_name') ?? '');
  if (site) {
    const sufixo = titulo.match(/\s+[|\-–]\s+([^|\-–]{1,40})$/);
    if (sufixo && sufixo[1].trim().toLowerCase() === site.toLowerCase()) titulo = limpar(titulo.slice(0, sufixo.index));
  }
  const headItem = (ip: string) => document.head?.querySelector(`meta[itemprop="${ip}"]`)?.getAttribute('content');
  const publicadoEm = dataEditorial(meta?.datePublished, agora) ?? dataEditorial(prop('article:published_time'), agora) ?? dataEditorial(headItem('datePublished'), agora);
  let modificadoEm = dataEditorial(meta?.dateModified, agora) ?? dataEditorial(prop('article:modified_time'), agora) ?? dataEditorial(headItem('dateModified'), agora);
  if (modificadoEm && publicadoEm && Date.parse(modificadoEm) < Date.parse(publicadoEm)) modificadoEm = null;

  let texto = '';
  let metodo = 'readability';
  if (typeof meta?.articleBody === 'string') {
    const body = parseHTML(`<html><body>${separarBlocos(meta.articleBody)}</body></html>`).document;
    for (const n of body.querySelectorAll('script,style,nav,footer,aside,form')) n.remove();
    texto = limpar(body.body.textContent ?? '');
    metodo = 'jsonld_article_body';
  }
  if (texto.length < 160 && hostKey(new URL(url).hostname) === 'g1.globo.com') {
    // Readability perde o lead do G1 (onde está o município). O container do publisher preserva.
    texto = [...document.querySelectorAll('.mc-article-body p.content-text__container')].map((n) => limpar(n.textContent ?? '')).filter(Boolean).join('\n\n');
    if (texto.length >= 160) metodo = 'g1_article_body';
  }
  if (texto.length < 160) {
    for (const n of document.querySelectorAll('script,style,nav,footer,aside,form,[role="navigation"]')) n.remove();
    // Sem lib DOM no Worker: o Document do linkedom entra como any.
    const parsed = new Readability(document as any, { charThreshold: 160, maxElemsToParse: 100_000 }).parse();
    // Readability devolve HTML limpo em content; dele sai o texto com separador de bloco.
    const limpo = parsed?.content ? parseHTML(`<html><body>${separarBlocos(parsed.content)}</body></html>`).document.body.textContent ?? '' : parsed?.textContent ?? '';
    texto = limpar(limpo);
    metodo = 'readability';
  }
  if (!titulo || texto.length < 160) throw new Error('artigo_conteudo_insuficiente');
  const entrada = entradaModelo({ titulo, texto });
  if (entrada.length > MAX_CHARS_ARTIGO) throw new Error('artigo_excede_limite');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(entrada));
  return {
    titulo, texto, url: canonica, publicadoEm, modificadoEm, capturadoEm: agora.toISOString(), metodo,
    sha256: Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join(''),
  };
}

// Segue redirects só no mesmo host, limita tamanho, exige HTML. Site que barra o fetch (403/429) é aberto uma vez pelo
// navegador, quando quem chama passa `navegador` (Browser Rendering; ver src/lib/navegador.ts).
export async function buscarArtigo(
  url: string, agora = new Date(), salvarHtml?: (html: string, url: string) => Promise<void>,
  navegador?: (url: string) => Promise<RespostaNavegador>,
): Promise<Artigo> {
  if (!urlSegura(url)) throw new Error('url_insegura');
  const host = hostKey(new URL(url).hostname);
  let atual = url;
  for (let i = 0; i <= 4; i++) {
    if (!urlSegura(atual) || hostKey(new URL(atual).hostname) !== host) throw new Error('redirect_fora_do_host');
    const res = await fetch(atual, {
      redirect: 'manual', signal: AbortSignal.timeout(20_000),
      // Mesmo UA do monitor: prefeituras bloqueiam "bot"/"compatible".
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Redacao/0.1', accept: 'text/html,application/xhtml+xml' },
    });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) { await res.body?.cancel(); atual = new URL(loc, atual).href; continue; }
    if (!res.ok && navegador && bloqueado(res.status)) {
      await res.body?.cancel();
      const nav = await navegador(atual);
      if (nav.status < 200 || nav.status >= 300) throw new Error(`artigo_http_${res.status}_navegador_${nav.status}`);
      if (!urlSegura(nav.url) || hostKey(new URL(nav.url).hostname) !== host) throw new Error('redirect_fora_do_host');
      if (new TextEncoder().encode(nav.corpo).byteLength > MAX_HTML_BYTES) throw new Error('artigo_html_grande');
      await salvarHtml?.(nav.corpo, nav.url);
      return extrairArtigo(nav.corpo, nav.url, agora);
    }
    if (!res.ok) { await res.body?.cancel(); throw new Error(`artigo_http_${res.status}`); }
    if (!/text\/html|application\/xhtml\+xml/i.test(res.headers.get('content-type') ?? '')) { await res.body?.cancel(); throw new Error('artigo_nao_html'); }
    const reader = res.body?.getReader();
    if (!reader) throw new Error('artigo_corpo_vazio');
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_HTML_BYTES) { await reader.cancel(); throw new Error('artigo_html_grande'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let off = 0;
    for (const c of chunks) { bytes.set(c, off); off += c.byteLength; }
    const html = new TextDecoder().decode(bytes);
    await salvarHtml?.(html, atual);
    return extrairArtigo(html, atual, agora);
  }
  throw new Error('artigo_limite_redirect');
}
