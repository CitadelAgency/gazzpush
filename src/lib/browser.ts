import { launch } from '@cloudflare/playwright';
import type { Env } from '../env';

/**
 * Fallback for sites that block `fetch` (WAF 403/429): opens the page in Browser Rendering and returns the body.
 * Not the default: it costs more and is slow. An XML feed comes raw (the response body); HTML comes rendered
 * (`page.content()`).
 */
export interface BrowserAnswer {
  status: number;
  corpo: string;
  tipo: string | null;   // response content-type
  url: string;           // final URL (after redirects)
}

export const TIMEOUT_BROWSER_MS = 20_000;
/** Body cap (UTF-8 bytes), measured in the browser: a larger page never reaches the Worker. */
export const MAX_BYTES_BROWSER = 2_000_000;

// The page.evaluate callback runs in Browser Rendering's Chrome (no DOM lib in the Worker).
declare const document: any;

async function openInBrowser(env: Env, url: string): Promise<BrowserAnswer> {
  const browser = await launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    const res = await page.goto(url, { timeout: TIMEOUT_BROWSER_MS, waitUntil: 'domcontentloaded' });
    if (!res) throw new Error('navegador_sem_resposta');
    const type = res.headers()['content-type'] ?? null;
    const declared = Number(res.headers()['content-length'] ?? 0);
    const measured: number = await page.evaluate(() => new Blob([document.documentElement?.outerHTML ?? '']).size);
    if (declared > MAX_BYTES_BROWSER || measured > MAX_BYTES_BROWSER) throw new Error('navegador_corpo_grande');
    const body = type && /xml|rss|atom/i.test(type) ? await res.text() : await page.content();
    if (new TextEncoder().encode(body).byteLength > MAX_BYTES_BROWSER) throw new Error('navegador_corpo_grande');
    return { status: res.status(), corpo: body, tipo: type, url: page.url() };
  } finally {
    await browser.close();
  }
}

/** Injectable: the Browser binding does not exist in vitest (tests swap `navegador.abrir` for a fake). */
export const browserApi = { abrir: openInBrowser };

export const fetchWithBrowser = (env: Env, url: string) => browserApi.abrir(env, url);

/** `fetch` statuses that justify trying through the browser. */
export const blocked = (status: number) => status === 403 || status === 429;
