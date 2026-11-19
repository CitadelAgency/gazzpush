import { LIGHT_TEXT, contrast } from './contrast';
import { parseHTML } from 'linkedom';
import type { Env, MonitorMessage } from '../env';
import { InvalidTransition } from '../kernel/states';
import { UA, parseRss } from '../monitor/consumer';
import { isJpeg, isPng, readBodyUntil, sanitizeSvg } from '../shell/brand';
import { safeUrl } from './article';
import { newId, recordEvent } from './db';
import { newLead } from './intake';
import { isLimit } from './plans';
import { produceLead } from './produce';
import { ctaAuthor } from './drafting';
import type { Brand } from './lead';
import type { ContentLanguage } from './contentLanguage';

// `autoral` outlet: the author's own Instagram page, created from the Substack URL. The feed (`<origem>/feed`) becomes
// the outlet's RSS source; the feed and the page give the name, logo, colour and signature; the 3 most recent texts
// become the first leads, produced as carousels by the queue (MonitorMessage `autoral`), so the first visit has posts.

export class AuthorError extends Error {}

const FEED_MAX_BYTES = 5 * 1024 * 1024;   // the Substack feed carries the full HTML of the open posts
const PAGE_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_MAX_BYTES = 512 * 1024;
export const ITEMS_INITIALS = 3;
const HEX = /^#[0-9a-f]{6}$/i;

export interface Substack {
  origem: string;                         // https://fulana.substack.com
  feedUrl: string;
  titulo: string | null;                  // publication name
  autor: string | null;                   // dc:creator of the most recent post (or itunes:author)
  imagem: string | null;                  // channel image or the page's og:image
  corTema: string | null;                 // meta theme-color (#rrggbb)
  itens: { url: string; titulo: string | null; publicadoEm: string | null }[];   // newest to oldest
}

/** URL pasted by the person → Substack origin. Accepts no scheme ("fulana.substack.com") and post links. */
export function substackOrigin(raw: string): string | null {
  const v = raw.trim();
  if (!v || v.length > 2000) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    return safeUrl(u.href) ? u.origin : null;
  } catch { return null; }
}

const decode = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, ' ').trim();
function tag(xml: string, tagName: string): string | null {
  const m = xml.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  const v = m ? decode(m[1]) : '';
  return v || null;
}

const MAX_REDIRECTS = 5;

/**
 * GET with a byte cap. Redirects followed by hand, with safeUrl on each hop (a Substack's custom domain redirects to
 * another host, so the host can change; to an internal address or one without https, no).
 */
export async function load(url: string, accept: string, max: number): Promise<{ status: number; tipo: string; bytes: Uint8Array | null } | null> {
  let current = url;
  try {
    for (let jump = 0; jump <= MAX_REDIRECTS; jump++) {
      if (!safeUrl(current)) return null;
      const res = await fetch(current, { headers: { 'user-agent': UA, accept }, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
      const target = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (target) { await res.body?.cancel(); current = new URL(target, current).href; continue; }
      if (!res.ok) { await res.body?.cancel(); return { status: res.status, tipo: '', bytes: null }; }
      return { status: res.status, tipo: res.headers.get('content-type') ?? '', bytes: await readBodyUntil(res.body, max) };
    }
    return null;
  } catch { return null; }
}

/** Substack feed and page. A feed that does not answer or is not RSS/Atom: AuthorError (the screen says it in plain language). */
export async function readSubstack(originUrl: string): Promise<Substack> {
  const feedUrl = `${originUrl}/feed`;
  const feed = await load(feedUrl, 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5', FEED_MAX_BYTES);
  const xml = feed?.bytes ? new TextDecoder().decode(feed.bytes) : '';
  if (!/<(rss|feed)\b/i.test(xml)) throw new AuthorError('nao_e_feed');
  // Channel head: before the first item.
  const head = xml.split(/<(?:item|entry)\b/i)[0];
  const items = parseRss(xml).sort((a, b) => (b.publicadoEm ?? '').localeCompare(a.publicadoEm ?? ''));
  const first = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/i)?.[0] ?? '';
  const imageChannel = head.match(/<image\b[^>]*>[\s\S]*?<url>([\s\S]*?)<\/url>/i)?.[1] ?? head.match(/<itunes:image\b[^>]*href="([^"]+)"/i)?.[1] ?? null;

  let ogImage: string | null = null, topicColor: string | null = null, siteName: string | null = null;
  const page = await load(originUrl, 'text/html,application/xhtml+xml', PAGE_MAX_BYTES);
  if (page?.bytes && /html/i.test(page.tipo)) {
    const { document } = parseHTML(new TextDecoder().decode(page.bytes));
    const meta = (sel: string) => document.querySelector(sel)?.getAttribute('content')?.trim() || null;
    ogImage = meta('meta[property="og:image"]');
    siteName = meta('meta[property="og:site_name"]');
    const color = meta('meta[name="theme-color"]');
    topicColor = color && HEX.test(color) ? color.toLowerCase() : null;
  }
  return {
    origem: originUrl, feedUrl, itens: items,
    titulo: tag(head, 'title') ?? siteName,
    autor: tag(first, 'dc:creator') ?? tag(head, 'itunes:author') ?? tag(head, 'managingEditor'),
    imagem: (imageChannel && decode(imageChannel)) || ogImage,
    corTema: topicColor,
  };
}

/**
 * Theme colour → card colours. Dark enough for light text (4.5:1) becomes the background; light becomes the accent (the
 * background stays the render's dark default). Without a colour: nothing (default palette; the brand step shows it).
 */
export function fromTopicColors(color: string | null): Brand['cores'] | undefined {
  if (!color || !HEX.test(color)) return undefined;
  return contrast(LIGHT_TEXT, color) >= 4.5 ? { fundo: color, texto: LIGHT_TEXT } : { acento: color };
}

/** Channel image → logo in R2 (PNG, JPEG or clean SVG, up to 512 KB). Failure = no logo (the card signs with the name). */
export async function downloadLogo(env: Env, tenantId: string, url: string | null): Promise<string | null> {
  if (!url) return null;
  const r = await load(url, 'image/png, image/jpeg, image/svg+xml;q=0.9', LOGO_MAX_BYTES);
  if (!r?.bytes?.length) return null;
  let body: Uint8Array | string = r.bytes, type: string, ext: string;
  if (isPng(r.bytes)) { type = 'image/png'; ext = 'png'; }
  else if (isJpeg(r.bytes)) { type = 'image/jpeg'; ext = 'jpg'; }
  else if (/svg/i.test(r.tipo)) {
    const clean = sanitizeSvg(new TextDecoder().decode(r.bytes));
    if (!clean) return null;
    body = clean; type = 'image/svg+xml'; ext = 'svg';
  } else return null;
  const key = `marcas/${tenantId}/logo-${newId()}.${ext}`;
  await env.MEDIA.put(key, body, { httpMetadata: { contentType: type } });
  return key;
}

/** The author outlet's initial brand: name, domain, link, signature, theme colours and the author's default CTA. */
export function authorBrand(outletName: string, s: Substack, language?: ContentLanguage): Brand {
  const colors = fromTopicColors(s.corTema);
  return {
    nome: outletName, dominio: new URL(s.origem).host, ctaUrl: s.origem,
    assinatura: (s.autor ?? outletName).slice(0, 60),
    ...(colors ? { cores: colors } : {}),
    ctas: [ctaAuthor(s.titulo ?? outletName, language)],
  };
}

/** A text's opening (up to 2 sentences, 300 characters) for drafting's voice examples. */
export function opening(text: string): string | null {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  let out = '';
  for (const { segment } of new Intl.Segmenter('pt-BR', { granularity: 'sentence' }).segment(clean)) {
    if (out && (out + segment).length > 300) break;
    out += segment;
    if (out.length >= 140) break;
  }
  out = out.trim();
  if (out.length <= 300) return out;
  const cut = out.lastIndexOf(' ', 297);
  return `${out.slice(0, cut > 100 ? cut : 297).trim()}…`;
}

/** Resends of the texts that failed (at 5 min, 15 min, 45 min); after that the feed monitor brings the rest. */
const RESENDS_AUTHOR = 3;

/**
 * Queue: the author's first texts → manual leads (the same path as a link in New idea) → voice examples (each one's
 * opening) → carousel production. On redelivery, a lead that already exists comes back as existing and one already in
 * production is not produced again. A text that failed comes back in a new message with only itself: those that
 * succeeded are not repeated (if discarded meanwhile or changed on Substack, they would become leads again).
 */
export async function startAuthor(env: Env, m: Extract<MonitorMessage, { tipo: 'autoral' }>) {
  const { tenantId, por: actor, urls } = m;
  const leads: { pautaId: string; status: string }[] = [];
  const failures: string[] = [];
  for (const url of urls) {
    try {
      const r = await newLead(env, tenantId, actor, { tipo: 'link', url });
      leads.push({ pautaId: r.pautaId, status: r.status });
    } catch (e) {
      failures.push(url);
      await recordEvent(env, tenantId, 'autoral.item_falhou', 'tenant', tenantId, { url, erro: String((e as Error).message ?? e).slice(0, 300) });
    }
  }

  // Voice examples: the opening of the imported texts, in feed order. Only if nobody wrote examples before.
  const examples: string[] = [];
  for (const { pautaId: leadId } of leads) {
    const doc = await env.DB.prepare("SELECT json_extract(documento_ids_json, '$[0]') AS doc FROM pautas WHERE id = ? AND tenant_id = ?")
      .bind(leadId, tenantId).first<{ doc: string | null }>();
    const text = doc?.doc ? await env.MEDIA.get(`texto/${tenantId}/${doc.doc}.txt`).then((o) => o?.text()) : null;
    const body = text?.slice(text.indexOf('\n\n') + 2) ?? '';
    const a = opening(body);
    if (a) examples.push(a);
  }
  if (examples.length) {
    await env.DB.prepare("UPDATE tenants SET voz_json = json_set(voz_json, '$.exemplos', json(?)) WHERE id = ? AND json_extract(voz_json, '$.exemplos') IS NULL")
      .bind(JSON.stringify(examples), tenantId).run();
  }

  for (const p of leads) {
    if (p.status !== 'sugerida') continue;
    try {
      await produceLead(env, tenantId, p.pautaId, actor, 'carrossel');
    } catch (e) {
      if (!(e instanceof InvalidTransition) && !isLimit(e)) throw e;   // someone else already sent it to production or discarded it, or the trial ended: it stays in Ideas
    }
  }
  const attempt = m.tentativa ?? 0;
  if (failures.length && attempt < RESENDS_AUTHOR) {
    await env.MONITOR_QUEUE.send({ ...m, urls: failures, tentativa: attempt + 1 }, { delaySeconds: 300 * 3 ** attempt });
  }
}
