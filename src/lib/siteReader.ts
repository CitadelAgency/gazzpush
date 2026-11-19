// What is read from the outlet's site, without the Worker: the script that runs in Chrome and the pure rules that turn
// it into a suggestion. Kept apart from `brandImport.ts` so the browser test can run it in a real Chrome.
import { LIGHT_TEXT, contrast } from './contrast';
import type { SourcesPair } from './typography';

const DEFAULT_BACKGROUND = '#1f2a24';

export interface ReadingSite { nome: string | null; logos: string[]; svg: string | null; fundos: string[]; destaques: string[]; fontes: string[] }
export interface FromSiteColors { fundo?: string; texto?: string; acento?: string }

/**
 * Runs in Chrome, as text: the Worker bundle's `keepNames` injects `__name` into functions passed to `page.evaluate`,
 * and that function does not exist on the page. `web/e2e/brand-import.spec.ts` runs this text in a real Chrome.
 */
export const READ_SITE = `(() => {
  const meta = (s) => (document.querySelector(s)?.getAttribute('content') ?? '').trim() || null;
  const abs = (u) => { try { return u ? new URL(u, location.href).href : null; } catch { return null; } };
  const estilo = (el, p) => (el ? getComputedStyle(el)[p] : null);
  // "logo" as a whole word: "psicólogo" and "catálogo" in the alt of a story photo do not count.
  const ehLogo = (t) => /(?<![\\p{L}])logo(?:tipo|marca)?(?![\\p{L}])/iu.test(t ?? '');
  const marcada = (el) => ehLogo(el.getAttribute('class')) || ehLogo(el.id) || ehLogo(el.getAttribute('alt')) || ehLogo(el.parentElement?.getAttribute('class'));
  const imgs = [...document.querySelectorAll('img')].filter((el) => !el.closest('article, main') && (marcada(el) || el.closest('header, [role="banner"], nav')))
    .sort((a, b) => Number(marcada(b)) - Number(marcada(a)));
  const icones = [...document.querySelectorAll('link[rel="icon"][type="image/svg+xml"], link[rel="apple-touch-icon"]')].map((l) => l.href);
  const svg = [...document.querySelectorAll('svg')].find((el) => !el.closest('article, main') && (ehLogo(el.getAttribute('class')) || ehLogo(el.parentElement?.getAttribute('class')) || el.closest('header a[href="/"]')));
  const cabeca = document.querySelector('header, [role="banner"]');
  const barra = document.querySelector('nav');
  const botoes = [...document.querySelectorAll('button, [class*="btn" i], [class*="button" i]')].filter((el) => !el.closest('article')).slice(0, 30);
  const links = [...document.querySelectorAll('header a, nav a, a')].filter((el) => !el.closest('article')).slice(0, 80);
  const contagem = new Map();
  for (const el of [...botoes, ...links]) for (const c of [estilo(el, 'backgroundColor'), estilo(el, 'color')]) if (c) contagem.set(c, (contagem.get(c) ?? 0) + 1);
  const titulo = document.querySelector('h1, h2');
  return {
    nome: meta('meta[property="og:site_name"]') || meta('meta[name="application-name"]') || document.title.split(/\\s[|–—·-]\\s/)[0].trim() || null,
    logos: [...new Set([...imgs.map((el) => abs(el.currentSrc || el.getAttribute('src'))), ...icones].filter(Boolean))],
    svg: svg ? svg.outerHTML : null,
    fundos: [meta('meta[name="theme-color"]'), estilo(cabeca, 'backgroundColor'), estilo(barra, 'backgroundColor'), ...botoes.map((el) => estilo(el, 'backgroundColor'))].filter(Boolean),
    destaques: [...contagem.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]),
    fontes: [estilo(titulo, 'fontFamily'), estilo(document.body, 'fontFamily')].filter(Boolean),
  };
})()`;

const twoDigits = (n: number) => Math.round(n).toString(16).padStart(2, '0');

/** `rgb()`, `rgba()` or 3- or 6-digit hex as #rrggbb. A transparent colour is nothing. */
export function toHex(color: string): string | null {
  const c = color.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(c)) return c;
  if (/^#[0-9a-f]{3}$/.test(c)) return `#${[...c.slice(1)].map((x) => x + x).join('')}`;
  const m = c.match(/^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)(?:[\s,/]+(\d*\.?\d+))?\s*\)$/);
  if (!m || (m[4] !== undefined && Number(m[4]) < 0.5)) return null;
  return `#${[m[1], m[2], m[3]].map((x) => twoDigits(Math.min(255, Number(x)))).join('')}`;
}

const saturated = (hex: string) => {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return (Math.max(...v) - Math.min(...v)) / 255 > 0.2;
};

/** Background only with 4.5:1 contrast for light text; accent only a real colour, legible on the background. */
export function fromSiteColors(l: Pick<ReadingSite, 'fundos' | 'destaques'>): FromSiteColors {
  const background = l.fundos.map(toHex).find((c): c is string => !!c && contrast(LIGHT_TEXT, c) >= 4.5);
  const candidates = [...l.fundos, ...l.destaques].map(toHex).filter((c): c is string => !!c);
  const accent = candidates.find((c) => c !== background && saturated(c) && contrast(c, background ?? DEFAULT_BACKGROUND) >= 3);
  return { ...(background ? { fundo: background, texto: LIGHT_TEXT } : {}), ...(accent ? { acento: accent } : {}) };
}

const SERIF = /georgia|times|merriweather|playfair|lora|garamond|serif pro|source serif|noto serif|pt serif|roboto slab|cambria|palatino|baskerville|minion/i;
const ROUNDED = /nunito|quicksand|rounded|comfortaa|varela/i;

/** The title font's style suggests a pair from the catalogue. The site's own font never goes into the card. */
export function fromSitePair(sources: string[]): SourcesPair {
  const f = sources[0] ?? '';
  if (!f) return 'padrao';
  if (ROUNDED.test(f)) return 'padrao';
  if (SERIF.test(f) || (/\bserif\b/i.test(f) && !/sans-serif/i.test(f))) return 'jornal';
  return 'grotesca';
}
