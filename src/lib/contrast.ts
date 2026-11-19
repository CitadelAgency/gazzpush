// WCAG 2 contrast. Pure: the Worker (author mode, card QA) and the screen (web/src/onboarding/preview.ts) use the same math.
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** Contrast ratio between two #rrggbb colours. */
export function contrast(a: string, b: string) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** The browser's `rgb(r, g, b)` as #rrggbb; `null` for a colour with transparency or in another colour space. */
export function hexRgb(color: string): string | null {
  const m = color.match(/^rgb\((\d+), (\d+), (\d+)\)$/);
  return m ? `#${m.slice(1, 4).map((v) => Number(v).toString(16).padStart(2, '0')).join('')}` : null;
}

export const MIN_CONTRAST = 4.5;

/** The render's default text colour. */
export const LIGHT_TEXT = '#fffcf6';
