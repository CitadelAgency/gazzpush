// Marca d'água do card (lote "Melhora do produto"): o logo, ou o @ quando não há logo, semitransparente. Puro (sem
// imports): usado pelo render (src/lib/render.ts) e pela prévia da UI (web/src/novo/previa.ts), com o mesmo HTML.

export const POSICOES_MARCA_DAGUA = ['canto', 'rodape', 'nenhuma'] as const;
export type PosicaoMarcaDagua = (typeof POSICOES_MARCA_DAGUA)[number];
export interface MarcaDagua { posicao: PosicaoMarcaDagua; opacidade: number }
export const MARCA_DAGUA_PADRAO: MarcaDagua = { posicao: 'nenhuma', opacidade: 0.4 };
export const OPACIDADE_MIN = 0.2;
export const OPACIDADE_MAX = 0.8;

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Tag da marca d'água para o `{{WATERMARK}}` do card.html. `logo` é a URL (data: no render, assinada na prévia);
 * sem logo vale o @ (ou o nome). Posição `nenhuma` ou sem nada para mostrar: vazio.
 */
export function marcaDaguaTag(m: Partial<MarcaDagua> | null | undefined, o: { logo: string | null; handle?: string | null; nome?: string | null }): string {
  const posicao = m?.posicao ?? MARCA_DAGUA_PADRAO.posicao;
  if (posicao === 'nenhuma') return '';
  const opacidade = Math.min(OPACIDADE_MAX, Math.max(OPACIDADE_MIN, Number(m?.opacidade ?? MARCA_DAGUA_PADRAO.opacidade)));
  const texto = o.handle || o.nome || '';
  if (!o.logo && !texto) return '';
  const dentro = o.logo ? `<img src="${esc(o.logo)}" alt="">` : `<span>${esc(texto)}</span>`;
  return `<div class="marca-dagua ${posicao}" style="opacity:${opacidade.toFixed(2)}" aria-hidden="true">${dentro}</div>`;
}
