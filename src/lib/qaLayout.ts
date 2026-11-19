// Card layout QA (overflow, overlap, fonts, images, contrast), the same in both frames: 1080×1350 in the carousel
// render, 1080×1920 in Reels and, with local Chromium, in web/e2e/compositions.spec.ts. Pure: it only talks to the `page`.
import { MIN_CONTRAST, contrast, hexRgb } from './contrast';

export interface MetricsLayout {
  width: number;
  height: number;
  overflow: string[];
  overlap: boolean;
  headlineLines: number;
  imagesLoaded: boolean;
  badText: boolean;
  fontsReady: boolean;
  /** Text on a flat colour below 4.5:1 (compositions only). */
  semContraste?: string[];
}

export const CAROUSEL_HEIGHT = 1350;
export const HEIGHT_R916 = 1920;

// The measureLayout callback runs in Chrome, not in the Worker. No DOM lib in the tsconfig. No named function inside it:
// the Worker's esbuild (keepNames) would wrap it in a helper that does not exist in the browser.
declare const document: any;
declare const getComputedStyle: any;

interface MeasureColor { alvo: string; cor: string; fundo: string }

export const measureLayout = (promo: boolean): MetricsLayout & { cores: MeasureColor[] } => {
  const box = document.querySelector('.card')!.getBoundingClientRect();
  const story = document.querySelector('.story')!.getBoundingClientRect();
  const footer = document.querySelector('footer')!.getBoundingClientRect();
  const header = document.querySelector('header')!.getBoundingClientRect();
  const badge = document.querySelector('.selo-publi')?.getBoundingClientRect();
  const composition = Boolean(document.querySelector('.card[class*="comp-"]'));
  const corner = composition ? document.querySelector('.marca-dagua.canto')?.getBoundingClientRect() : undefined;
  const h1 = document.querySelector('h1')!;
  const overflow: string[] = [...document.querySelectorAll('[data-fit], [data-fit] *')].filter((el: any) => {
    if (!el.getClientRects().length) return false;
    const r = el.getBoundingClientRect();
    return r.left < box.left - 1 || r.right > box.right + 1 || r.top < box.top - 1 || r.bottom > box.bottom + 1 || (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1);
  }).map((el: any) => String(el.className || el.tagName));
  // In compositions all text sits on a flat colour: that of the first ancestor with an opaque background. Here it only
  // collects; the Worker judges, in `qaCard`.
  const colors: MeasureColor[] = [];
  if (composition) {
    for (const el of document.querySelectorAll('[data-fit] *, .selo-publi')) {
      if (!el.getClientRects().length || ![...el.childNodes].some((n: any) => n.nodeType === 3 && n.textContent.trim())) continue;
      let owner = el;
      while (owner.parentElement && !/^rgb\(/.test(getComputedStyle(owner).backgroundColor)) owner = owner.parentElement;
      colors.push({ alvo: String(el.className || el.tagName), cor: getComputedStyle(el).color, fundo: getComputedStyle(owner).backgroundColor });
    }
  }
  return {
    width: box.width as number, height: box.height as number, overflow, cores: colors,
    overlap: Boolean(story.top <= Math.max(header.bottom, badge?.bottom ?? 0) || (!promo && story.bottom >= footer.top)
      || (corner && corner.bottom > story.top && corner.top < story.bottom && corner.left < story.right)),
    headlineLines: Math.round(h1.clientHeight / parseFloat(getComputedStyle(h1).lineHeight)),
    imagesLoaded: [...document.images].every((img: any) => img.naturalWidth > 0),
    badText: /\b(?:undefined|null|NaN)\b/.test(document.body.innerText),
    fontsReady: Boolean(document.fonts.check('900 58px Corpo') && document.fonts.check('700 58px Destaque')),
  };
};

export const layoutOk = (m: MetricsLayout, height: number) =>
  m.width === 1080 && m.height === height && !m.overflow.length && !m.overlap && m.imagesLoaded && !m.badText && m.fontsReady && !m.semContraste?.length;

/** What fell below the minimum, with the ratio. A colour the browser did not give as rgb() is left out of the count. */
export function judgeContrast(colors: MeasureColor[]) {
  const bad = new Set<string>();
  for (const c of colors) {
    const [color, background] = [hexRgb(c.cor), hexRgb(c.fundo)];
    if (!color || !background) continue;
    const ratio = contrast(color, background);
    if (ratio < MIN_CONTRAST) bad.add(`${c.alvo} ${ratio.toFixed(1)}:1`);
  }
  return [...bad];
}

/** Waits for the fonts and images of the card already loaded in `page`, measures and judges by the frame's expected height. */
export async function qaCard(page: { evaluate: (...a: any[]) => Promise<any> }, o: { promo: boolean; altura: number }) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((img: any) => img.decode().catch(() => {})));
  });
  const { cores: colors, ...measures } = await page.evaluate(measureLayout, o.promo) as ReturnType<typeof measureLayout>;
  const withoutContrast = judgeContrast(colors ?? []);
  const metrics: MetricsLayout = { ...measures, ...(withoutContrast.length ? { semContraste: withoutContrast } : {}) };
  return { metricas: metrics, ok: layoutOk(metrics, o.altura) };
}
