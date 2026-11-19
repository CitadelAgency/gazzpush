// New outlet with a ready style: reads the outlet's site in Browser Rendering and suggests name, logo, colours and font
// pair. The person checks it on screen before saving. Only http/https on a public address, with a deadline. Story images
// are ignored: the logo comes from the header or from an element marked as a logo, never from inside `<article>`. SVG
// goes through `sanitizeSvg`.
import type { Env } from '../env';
import { LOGO_MAX_BYTES, isPng, sanitizeSvg } from '../shell/brand';
import { safeUrl } from './article';
import { load } from './author';
import { READ_SITE, fromSiteColors, fromSitePair, type FromSiteColors, type ReadingSite } from './siteReader';
import { browserApi, type OpenBrowser } from './render';
import type { SourcesPair } from './typography';

export const IMPORT_DEADLINE_MS = 20_000;
/** Each read opens a browser: the cap limits the cost per outlet. */
export const MAX_IMPORTS_DAY = 10;
const MAX_LOGOS = 4;

export interface FromSiteBrand {
  nome: string | null;
  cores: FromSiteColors;
  fontes: SourcesPair;
  logo: { tipo: 'image/png' | 'image/svg+xml'; base64: string } | null;
}

const base64 = (b: Uint8Array) => {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
const inBase64 = (text: string) => base64(new TextEncoder().encode(text));

async function logoSite(l: ReadingSite): Promise<FromSiteBrand['logo']> {
  const clean = l.svg ? sanitizeSvg(l.svg) : null;
  if (clean) return { tipo: 'image/svg+xml', base64: inBase64(clean) };
  for (const url of l.logos.slice(0, MAX_LOGOS)) {
    const r = await load(url, 'image/png, image/svg+xml;q=0.9', LOGO_MAX_BYTES);
    if (!r?.bytes?.length) continue;
    if (isPng(r.bytes)) return { tipo: 'image/png', base64: base64(r.bytes) };
    if (/svg/i.test(r.tipo)) {
      const svg = sanitizeSvg(new TextDecoder().decode(r.bytes));
      if (svg) return { tipo: 'image/svg+xml', base64: inBase64(svg) };
    }
  }
  return null;
}

/** Accepts the address as the person pastes it, without `https://`. Returns null if it is not a public address. */
export function addressSite(value: unknown): string | null {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v || v.length > 500) return null;
  const url = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
  return safeUrl(url) ? new URL(url).href : null;
}

/** Throws if the site does not open, exceeds the deadline or redirects to an address that is not public. */
export async function importBrand(env: Env, url: string, launch: OpenBrowser = () => browserApi.abrir(env)): Promise<FromSiteBrand> {
  const browser = await launch();
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    // Only the page and the CSS: images, video and fonts do not change what is read, and an internal address does not open,
// not even through a redirect.
    await page.route(/^https?:\/\//, (route: any) => (['image', 'media', 'font'].includes(route.request().resourceType()) || !safeUrl(route.request().url()) ? route.abort() : route.continue()));
    const reading = await Promise.race([
      (async () => {
        const res = await page.goto(url, { timeout: IMPORT_DEADLINE_MS, waitUntil: 'domcontentloaded' });
        if (!res?.ok() || !safeUrl(page.url())) throw new Error('site_fora');
        return (await page.evaluate(READ_SITE)) as ReadingSite;
      })(),
      new Promise<never>((_, not) => { deadline = setTimeout(() => not(new Error('site_fora')), IMPORT_DEADLINE_MS); }),
    ]);
    return { nome: reading.nome?.replace(/\s+/g, ' ').trim().slice(0, 80) || null, cores: fromSiteColors(reading), fontes: fromSitePair(reading.fontes), logo: await logoSite(reading) };
  } finally {
    clearTimeout(deadline);
    await browser.close();
  }
}
