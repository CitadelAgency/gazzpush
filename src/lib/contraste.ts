// Contraste WCAG 2. Puro: o Worker (autoral, QA do card) e a tela (previa.ts) usam a mesma conta.
const luminancia = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** Razão de contraste entre duas cores #rrggbb. */
export function contraste(a: string, b: string) {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (escuro + 0.05);
}

/** `rgb(r, g, b)` do navegador em #rrggbb; `null` em cor com transparência ou em outro espaço de cor. */
export function hexDeRgb(cor: string): string | null {
  const m = cor.match(/^rgb\((\d+), (\d+), (\d+)\)$/);
  return m ? `#${m.slice(1, 4).map((v) => Number(v).toString(16).padStart(2, '0')).join('')}` : null;
}

export const CONTRASTE_MINIMO = 4.5;

/** O texto padrão do render. */
export const TEXTO_CLARO = '#fffcf6';
