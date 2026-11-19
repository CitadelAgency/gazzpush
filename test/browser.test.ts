// Sources that block fetch (403/429) are read through Browser Rendering. The Browser does not exist in vitest:
// `navegador.abrir` is swapped for a fake that returns the body. The queue (sendBatch) is fake too: document triage does not run here.
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { processSource, queue } from '../src/monitor/consumer';
import { fetchArticle } from '../src/lib/article';
import { browserApi, type BrowserAnswer } from '../src/lib/browser';
import { RSS_CITY_HALL } from './fixtures';
import { register, req, seedMember, seedTenant } from './helpers';

const FEED = 'https://www.atribuna.com.br/feed/';
const ARTICLE_URL = 'https://www.atribuna.com.br/cidades/guaruja/ponte';
const BODY = 'A Prefeitura de Guarujá interdita a ponte da Avenida Santos Dumont a partir de segunda-feira para obras. ' +
  'As obras de recuperação estrutural duram 15 dias, segundo a Secretaria de Obras, e o desvio é pela Avenida Puglisi.';
const HTML = `<html><head><meta property="og:title" content="Ponte da Santos Dumont fecha">
<script type="application/ld+json">${JSON.stringify({ '@type': 'NewsArticle', articleBody: BODY })}</script></head><body><p>${BODY}</p></body></html>`;

let status: Record<string, number> = {};
let callsBrowser: string[] = [];
let browserAnswer: (url: string) => BrowserAnswer | Promise<BrowserAnswer>;

beforeEach(() => {
  status = {};
  callsBrowser = [];
  browserAnswer = (url) => ({ status: 200, corpo: RSS_CITY_HALL, tipo: 'application/rss+xml', url });
  vi.spyOn(browserApi, 'abrir').mockImplementation(async (_env, url) => { callsBrowser.push(url); return browserAnswer(url); });
  vi.spyOn(env.MONITOR_QUEUE, 'sendBatch').mockResolvedValue(undefined as never);
  const original = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url in status) {
      const s = status[url];
      return s === 200
        ? new Response(url === FEED ? RSS_CITY_HALL : HTML, { headers: { 'content-type': url === FEED ? 'application/rss+xml' : 'text/html' } })
        : new Response('Forbidden', { status: s, headers: { 'content-type': 'text/html' } });
    }
    return original(input, init);
  });
});
afterEach(() => vi.restoreAllMocks());

async function source(type = 'rss') {
  const t = await seedTenant();
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO fontes (id, tenant_id, tipo, nome, url, etag) VALUES (?, ?, ?, 'A Tribuna', ?, 'W/\"velho\"')").bind(id, t, type, FEED).run();
  return { t, id };
}
const line = (id: string) => env.DB.prepare('SELECT falhas, via_navegador, etag, ultimo_fetch_at FROM fontes WHERE id = ?').bind(id)
  .first<{ falhas: number; via_navegador: number; etag: string | null; ultimo_fetch_at: string | null }>();
const docs = async (t: string) => (await env.DB.prepare('SELECT url FROM documentos WHERE tenant_id = ? ORDER BY url').bind(t).all<{ url: string }>()).results.map((d) => d.url);

function batch(body: { tipo: 'fonte'; tenantId: string; fonteId: string }) {
  const msg = { body, attempts: 1, acked: false, retried: false, ack() { this.acked = true; }, retry() { this.retried = true; } };
  return { msg, batch: { messages: [msg] } as unknown as MessageBatch<typeof body> };
}

describe('monitor: blocked feed read by the browser', () => {
  it('403 → browser → documents created and via_navegador = 1', async () => {
    status[FEED] = 403;
    const { t, id } = await source();
    await processSource(env, { tipo: 'fonte', tenantId: t, fonteId: id });
    expect(callsBrowser).toEqual([FEED]);
    expect(await docs(t)).toEqual(['https://www.guaruja.sp.gov.br/ponte-santos-dumont-interditada/', 'https://www.guaruja.sp.gov.br/vacinacao-sabado/']);
    expect(await line(id)).toMatchObject({ falhas: 0, via_navegador: 1, etag: null });
  });

  it('429 also goes through the browser; 200 afterwards goes back to 0 without calling the browser', async () => {
    status[FEED] = 429;
    const { t, id } = await source();
    await processSource(env, { tipo: 'fonte', tenantId: t, fonteId: id });
    expect((await line(id))?.via_navegador).toBe(1);
    status[FEED] = 200;
    callsBrowser = [];
    await processSource(env, { tipo: 'fonte', tenantId: t, fonteId: id });
    expect(callsBrowser).toEqual([]);
    expect((await line(id))?.via_navegador).toBe(0);
  });

  it("200 → browser isn't called", async () => {
    status[FEED] = 200;
    const { t, id } = await source();
    await processSource(env, { tipo: 'fonte', tenantId: t, fonteId: id });
    expect(callsBrowser).toEqual([]);
    expect(await docs(t)).toHaveLength(2);
    expect((await line(id))?.via_navegador).toBe(0);
  });

  it('browser also failed (403 or exception) → failures += 1, as today, and no document', async () => {
    status[FEED] = 403;
    const { t, id } = await source();
    browserAnswer = (url) => ({ status: 403, corpo: 'Forbidden', tipo: 'text/html', url });
    const a = batch({ tipo: 'fonte', tenantId: t, fonteId: id });
    await queue(a.batch, env, {} as ExecutionContext);
    expect(a.msg.retried).toBe(true);
    browserAnswer = () => { throw new Error('timeout'); };
    const b = batch({ tipo: 'fonte', tenantId: t, fonteId: id });
    await queue(b.batch, env, {} as ExecutionContext);
    expect(await line(id)).toMatchObject({ falhas: 2, via_navegador: 0 });
    expect(await docs(t)).toEqual([]);
  });

  it("500 doesn't try the browser", async () => {
    status[FEED] = 500;
    const { t, id } = await source();
    await expect(processSource(env, { tipo: 'fonte', tenantId: t, fonteId: id })).rejects.toThrow('HTTP 500');
    expect(callsBrowser).toEqual([]);
  });

  it('GET fontes returns viaNavegador', async () => {
    status[FEED] = 403;
    const s = await register();
    const { t, id } = await source();
    await seedMember(t, s.userId, 'reporter');
    await processSource(env, { tipo: 'fonte', tenantId: t, fonteId: id });
    const { fontes: sources } = await (await req(`/api/t/${t}/fontes`, { cookie: s.cookie })).json<{ fontes: { id: string; viaNavegador: boolean }[] }>();
    expect(sources).toEqual([expect.objectContaining({ id, viaNavegador: true, ok: true })]);
  });
});

describe('article: blocked page read by the browser', () => {
  const open = (u: string) => browserApi.abrir(env, u);
  it('403 → browser → article extracted and HTML saved', async () => {
    status[ARTICLE_URL] = 403;
    browserAnswer = (url) => ({ status: 200, corpo: HTML, tipo: 'text/html', url });
    let saved = '';
    const a = await fetchArticle(ARTICLE_URL, new Date(), async (h) => { saved = h; }, open);
    expect(callsBrowser).toEqual([ARTICLE_URL]);
    expect(a.titulo).toBe('Ponte da Santos Dumont fecha');
    expect(a.texto).toContain('Avenida Puglisi');
    expect(saved).toBe(HTML);
  });
  it("200 → browser isn't called; without a browser, 403 stays an error", async () => {
    status[ARTICLE_URL] = 200;
    await fetchArticle(ARTICLE_URL, new Date(), undefined, open);
    expect(callsBrowser).toEqual([]);
    status[ARTICLE_URL] = 403;
    await expect(fetchArticle(ARTICLE_URL)).rejects.toThrow('artigo_http_403');
  });
  it('browser failed or ended up on another host → error', async () => {
    status[ARTICLE_URL] = 403;
    browserAnswer = (url) => ({ status: 403, corpo: '', tipo: 'text/html', url });
    await expect(fetchArticle(ARTICLE_URL, new Date(), undefined, open)).rejects.toThrow('artigo_http_403_navegador_403');
    browserAnswer = () => ({ status: 200, corpo: HTML, tipo: 'text/html', url: 'https://outro.example.com/x' });
    await expect(fetchArticle(ARTICLE_URL, new Date(), undefined, open)).rejects.toThrow('redirect_fora_do_host');
    // The cap is in bytes, as in the ordinary fetch: 1.1 million "ã" are 2.2 MB.
    browserAnswer = (url) => ({ status: 200, corpo: HTML + 'ã'.repeat(1_100_000), tipo: 'text/html', url });
    await expect(fetchArticle(ARTICLE_URL, new Date(), undefined, open)).rejects.toThrow('artigo_html_grande');
  });
});

describe('kie: reference type from the bytes', () => {
  it('JPEG uploads as image/jpeg .jpg; the rest as PNG', async () => {
    const { referenceType } = await import('../src/lib/kie');
    expect(referenceType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer)).toEqual({ mime: 'image/jpeg', ext: 'jpg' });
    expect(referenceType(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer)).toEqual({ mime: 'image/png', ext: 'png' });
  });
});
