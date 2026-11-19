// Card watermark ("Product improvements" batch): the logo, or the @ when there is no logo, semi-transparent. Pure (no
// imports): used by the render (src/lib/render.ts) and by the UI preview (web/src/onboarding/preview.ts), with the same HTML.

export const POSITIONS_BRAND_WATER = ['canto', 'rodape', 'nenhuma'] as const;
export type PositionBrandWater = (typeof POSITIONS_BRAND_WATER)[number];
export interface WaterBrand { posicao: PositionBrandWater; opacidade: number }
export const WATER_DEFAULT_BRAND: WaterBrand = { posicao: 'nenhuma', opacidade: 0.4 };
export const OPACITY_MIN = 0.2;
export const OPACITY_MAX = 0.8;

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Watermark tag for card.html's `{{WATERMARK}}`. `logo` is the URL (data: in the render, signed in the preview);
 * without a logo the @ is used (or the name). Position `nenhuma`, or nothing to show: empty.
 */
export function waterTagBrand(m: Partial<WaterBrand> | null | undefined, o: { logo: string | null; handle?: string | null; nome?: string | null }): string {
  const position = m?.posicao ?? WATER_DEFAULT_BRAND.posicao;
  if (position === 'nenhuma') return '';
  const opacity = Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, Number(m?.opacidade ?? WATER_DEFAULT_BRAND.opacidade)));
  const text = o.handle || o.nome || '';
  if (!o.logo && !text) return '';
  const inside = o.logo ? `<img src="${esc(o.logo)}" alt="">` : `<span>${esc(text)}</span>`;
  return `<div class="marca-dagua ${position}" style="opacity:${opacity.toFixed(2)}" aria-hidden="true">${inside}</div>`;
}
