import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import { blocked, type BrowserAnswer } from './browser';

// Extracts the article text from HTML (Readability + linkedom).

export interface Article {
  titulo: string;
  texto: string;
  url: string;              // canonical, if the publisher provides it and it is on the same host
  publicadoEm: string | null;
  modificadoEm: string | null;
  capturadoEm: string;
  metodo: string;           // jsonld_article_body | g1_article_body | readability
  sha256: string;
}

export const MAX_CHARS_ARTICLE = 100_000;
const MAX_HTML_BYTES = 2_000_000;
const tidy = (v: string) => v.replace(/\s+/g, ' ').trim();
// textContent glues blocks together ("normalDevido"). A block close becomes a line break before the text is extracted.
const splitBlocks = (html: string) => html.replace(/<(br|hr)\b[^>]*>|<\/(p|div|li|ul|ol|h[1-6]|tr|td|th|section|article|blockquote|figcaption|dd|dt)\s*>/gi, '$&\n');
const hostKey = (host: string) => host.toLowerCase().replace(/^www\./, '');

export const inputModel = (a: Pick<Article, 'titulo' | 'texto'>) => `${a.titulo}\n\n${a.texto}`;

export function safeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      && (!url.port || ['80', '443'].includes(url.port))
      && !/^[\d.]+$|[:\[\]]/.test(url.hostname)
      && url.hostname.includes('.') && !/(^|\.)(localhost|local|internal|test|invalid)$/.test(url.hostname);
  } catch { return false; }
}

// Valid editorial date: a real calendar date, not in the future, not before 2000.
export function validDay(value: string, now: Date): boolean {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const [year, month, day] = [+m[1], +m[2], +m[3]];
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day
    && year >= 2000 && d.getTime() <= now.getTime() + 24 * 3600 * 1000;
}

function editorialDate(value: unknown, now: Date): string | null {
  if (typeof value !== 'string' || !validDay(value.slice(0, 10), now)) return null;
  if (value.length === 10) return value;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed <= now.getTime() ? value : null;
}

export async function extractArticle(html: string, url: string, now = new Date()): Promise<Article> {
  const { document } = parseHTML(html);
  const nodes: Record<string, unknown>[] = [];
  const visit = (value: unknown, depth = 0) => {
    if (depth > 5 || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach((item) => visit(item, depth + 1)); return; }
    const node = value as Record<string, unknown>;
    const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
    if (types.some((t) => typeof t === 'string' && /^(NewsArticle|Article|ReportageNewsArticle|BlogPosting)$/.test(t))) nodes.push(node);
    if (node['@graph']) visit(node['@graph'], depth + 1);
  };
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { visit(JSON.parse(script.textContent ?? '')); } catch { /* JSON-LD is optional */ }
  }

  let canonical = url;
  const href = document.querySelector('link[rel="canonical"]')?.getAttribute('href');
  if (href) {
    try {
      const c = new URL(href, url);
      if (safeUrl(c.href) && hostKey(c.hostname) === hostKey(new URL(url).hostname)) canonical = c.href;
    } catch { /* keeps the fetched URL */ }
  }

  const identity = (node: Record<string, unknown>) => {
    const id = node.mainEntityOfPage;
    return typeof id === 'string' ? id : id && typeof id === 'object' ? (id as Record<string, unknown>)['@id'] : node.url;
  };
  const matched = nodes.filter((n) => { const c = identity(n); return typeof c === 'string' && c.split('#')[0] === canonical.split('#')[0]; });
  // Several unrelated Article objects do not justify picking the first.
  const meta = matched.length === 1 ? matched[0] : nodes.length === 1 && !identity(nodes[0]) ? nodes[0] : null;

  const prop = (p: string) => document.querySelector(`meta[property="${p}"]`)?.getAttribute('content');
  let title = tidy(prop('og:title') ?? document.querySelector('h1')?.textContent ?? document.title ?? '');
  // "Headline | G1" → "Headline". Only removed when the suffix is the site name.
  const site = tidy(prop('og:site_name') ?? '');
  if (site) {
    const suffix = title.match(/\s+[|\-–]\s+([^|\-–]{1,40})$/);
    if (suffix && suffix[1].trim().toLowerCase() === site.toLowerCase()) title = tidy(title.slice(0, suffix.index));
  }
  const headItem = (ip: string) => document.head?.querySelector(`meta[itemprop="${ip}"]`)?.getAttribute('content');
  const publishedAt = editorialDate(meta?.datePublished, now) ?? editorialDate(prop('article:published_time'), now) ?? editorialDate(headItem('datePublished'), now);
  let modifiedAt = editorialDate(meta?.dateModified, now) ?? editorialDate(prop('article:modified_time'), now) ?? editorialDate(headItem('dateModified'), now);
  if (modifiedAt && publishedAt && Date.parse(modifiedAt) < Date.parse(publishedAt)) modifiedAt = null;

  let text = '';
  let method = 'readability';
  if (typeof meta?.articleBody === 'string') {
    const body = parseHTML(`<html><body>${splitBlocks(meta.articleBody)}</body></html>`).document;
    for (const n of body.querySelectorAll('script,style,nav,footer,aside,form')) n.remove();
    text = tidy(body.body.textContent ?? '');
    method = 'jsonld_article_body';
  }
  if (text.length < 160 && hostKey(new URL(url).hostname) === 'g1.globo.com') {
    // Readability loses G1's lead paragraph (where the municipality is). The publisher's container keeps it.
    text = [...document.querySelectorAll('.mc-article-body p.content-text__container')].map((n) => tidy(n.textContent ?? '')).filter(Boolean).join('\n\n');
    if (text.length >= 160) method = 'g1_article_body';
  }
  if (text.length < 160) {
    for (const n of document.querySelectorAll('script,style,nav,footer,aside,form,[role="navigation"]')) n.remove();
    // No DOM lib in the Worker: linkedom's Document comes in as any.
    const parsed = new Readability(document as any, { charThreshold: 160, maxElemsToParse: 100_000 }).parse();
    // Readability returns clean HTML in content; the text with block separators comes from it.
    const clean = parsed?.content ? parseHTML(`<html><body>${splitBlocks(parsed.content)}</body></html>`).document.body.textContent ?? '' : parsed?.textContent ?? '';
    text = tidy(clean);
    method = 'readability';
  }
  if (!title || text.length < 160) throw new Error('artigo_conteudo_insuficiente');
  const input = inputModel({ titulo: title, texto: text });
  if (input.length > MAX_CHARS_ARTICLE) throw new Error('artigo_excede_limite');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return {
    titulo: title, texto: text, url: canonical, publicadoEm: publishedAt, modificadoEm: modifiedAt, capturadoEm: now.toISOString(), metodo: method,
    sha256: Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join(''),
  };
}

// Follows redirects only on the same host, caps the size, requires HTML. A site that blocks fetch (403/429) is opened
// once by the browser, when the caller passes `navegador` (Browser Rendering; see src/lib/browser.ts).
export async function fetchArticle(
  url: string, now = new Date(), saveHtml?: (html: string, url: string) => Promise<void>,
  browser?: (url: string) => Promise<BrowserAnswer>,
): Promise<Article> {
  if (!safeUrl(url)) throw new Error('url_insegura');
  const host = hostKey(new URL(url).hostname);
  let current = url;
  for (let i = 0; i <= 4; i++) {
    if (!safeUrl(current) || hostKey(new URL(current).hostname) !== host) throw new Error('redirect_fora_do_host');
    const res = await fetch(current, {
      redirect: 'manual', signal: AbortSignal.timeout(20_000),
      // Same UA as the monitor: city governments block "bot"/"compatible".
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Redacao/0.1', accept: 'text/html,application/xhtml+xml' },
    });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) { await res.body?.cancel(); current = new URL(loc, current).href; continue; }
    if (!res.ok && browser && blocked(res.status)) {
      await res.body?.cancel();
      const nav = await browser(current);
      if (nav.status < 200 || nav.status >= 300) throw new Error(`artigo_http_${res.status}_navegador_${nav.status}`);
      if (!safeUrl(nav.url) || hostKey(new URL(nav.url).hostname) !== host) throw new Error('redirect_fora_do_host');
      if (new TextEncoder().encode(nav.corpo).byteLength > MAX_HTML_BYTES) throw new Error('artigo_html_grande');
      await saveHtml?.(nav.corpo, nav.url);
      return extractArticle(nav.corpo, nav.url, now);
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
    await saveHtml?.(html, current);
    return extractArticle(html, current, now);
  }
  throw new Error('artigo_limite_redirect');
}
