// O que se lê do site do veículo, sem Worker: o texto que roda no Chrome e as regras puras que viram sugestão. Separado de
// `puxarMarca.ts` para o teste de navegador rodar isto num Chrome de verdade.
import { TEXTO_CLARO, contraste } from './contraste';
import type { ParFontes } from './tipografia';

const FUNDO_PADRAO = '#1f2a24';

export interface LeituraSite { nome: string | null; logos: string[]; svg: string | null; fundos: string[]; destaques: string[]; fontes: string[] }
export interface CoresDoSite { fundo?: string; texto?: string; acento?: string }

/**
 * Roda no Chrome, como texto: o `keepNames` do bundle do Worker injeta `__name` em função passada a `page.evaluate`, e essa
 * função não existe na página. `web/e2e/puxar-marca.spec.ts` roda este texto num Chrome de verdade.
 */
export const LER_SITE = `(() => {
  const meta = (s) => (document.querySelector(s)?.getAttribute('content') ?? '').trim() || null;
  const abs = (u) => { try { return u ? new URL(u, location.href).href : null; } catch { return null; } };
  const estilo = (el, p) => (el ? getComputedStyle(el)[p] : null);
  // "logo" como palavra: "psicólogo" e "catálogo" no alt de foto de matéria não contam.
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

const doisDigitos = (n: number) => Math.round(n).toString(16).padStart(2, '0');

/** `rgb()`, `rgba()` ou hex de 3 ou 6 dígitos em #rrggbb. Cor transparente é nada. */
export function paraHex(cor: string): string | null {
  const c = cor.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(c)) return c;
  if (/^#[0-9a-f]{3}$/.test(c)) return `#${[...c.slice(1)].map((x) => x + x).join('')}`;
  const m = c.match(/^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)(?:[\s,/]+(\d*\.?\d+))?\s*\)$/);
  if (!m || (m[4] !== undefined && Number(m[4]) < 0.5)) return null;
  return `#${[m[1], m[2], m[3]].map((x) => doisDigitos(Math.min(255, Number(x)))).join('')}`;
}

const saturada = (hex: string) => {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return (Math.max(...v) - Math.min(...v)) / 255 > 0.2;
};

/** Fundo só com contraste de 4,5:1 para o texto claro; destaque só cor de verdade, legível sobre o fundo. */
export function coresDoSite(l: Pick<LeituraSite, 'fundos' | 'destaques'>): CoresDoSite {
  const fundo = l.fundos.map(paraHex).find((c): c is string => !!c && contraste(TEXTO_CLARO, c) >= 4.5);
  const candidatas = [...l.fundos, ...l.destaques].map(paraHex).filter((c): c is string => !!c);
  const acento = candidatas.find((c) => c !== fundo && saturada(c) && contraste(c, fundo ?? FUNDO_PADRAO) >= 3);
  return { ...(fundo ? { fundo, texto: TEXTO_CLARO } : {}), ...(acento ? { acento } : {}) };
}

const SERIFADAS = /georgia|times|merriweather|playfair|lora|garamond|serif pro|source serif|noto serif|pt serif|roboto slab|cambria|palatino|baskerville|minion/i;
const ARREDONDADAS = /nunito|quicksand|rounded|comfortaa|varela/i;

/** O tipo da fonte do título sugere um par do catálogo. A fonte do site em si nunca entra no card. */
export function parDoSite(fontes: string[]): ParFontes {
  const f = fontes[0] ?? '';
  if (!f) return 'padrao';
  if (ARREDONDADAS.test(f)) return 'padrao';
  if (SERIFADAS.test(f) || (/\bserif\b/i.test(f) && !/sans-serif/i.test(f))) return 'jornal';
  return 'grotesca';
}
