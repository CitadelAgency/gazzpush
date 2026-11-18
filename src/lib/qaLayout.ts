// QA de layout do card (overflow, sobreposição, fontes, imagens, contraste), o mesmo nos dois quadros: 1080×1350 no render do
// carrossel, 1080×1920 no Reels e, com o Chromium local, em web/e2e/composicoes.spec.ts. Puro: só fala com a `page`.
import { CONTRASTE_MINIMO, contraste, hexDeRgb } from './contraste';

export interface MetricasLayout {
  width: number;
  height: number;
  overflow: string[];
  overlap: boolean;
  headlineLines: number;
  imagesLoaded: boolean;
  badText: boolean;
  fontsReady: boolean;
  /** Texto sobre cor chapada abaixo de 4,5:1 (só nas composições). */
  semContraste?: string[];
}

export const ALTURA_CARROSSEL = 1350;
export const ALTURA_R916 = 1920;

// O callback de medirLayout roda no Chrome, não no Worker. Sem lib DOM no tsconfig. Sem função com nome lá dentro: o
// esbuild do Worker (keepNames) a embrulharia num helper que não existe no navegador.
declare const document: any;
declare const getComputedStyle: any;

interface CorMedida { alvo: string; cor: string; fundo: string }

export const medirLayout = (promo: boolean): MetricasLayout & { cores: CorMedida[] } => {
  const box = document.querySelector('.card')!.getBoundingClientRect();
  const story = document.querySelector('.story')!.getBoundingClientRect();
  const footer = document.querySelector('footer')!.getBoundingClientRect();
  const header = document.querySelector('header')!.getBoundingClientRect();
  const selo = document.querySelector('.selo-publi')?.getBoundingClientRect();
  const composicao = Boolean(document.querySelector('.card[class*="comp-"]'));
  const canto = composicao ? document.querySelector('.marca-dagua.canto')?.getBoundingClientRect() : undefined;
  const h1 = document.querySelector('h1')!;
  const overflow: string[] = [...document.querySelectorAll('[data-fit], [data-fit] *')].filter((el: any) => {
    if (!el.getClientRects().length) return false;
    const r = el.getBoundingClientRect();
    return r.left < box.left - 1 || r.right > box.right + 1 || r.top < box.top - 1 || r.bottom > box.bottom + 1 || (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1);
  }).map((el: any) => String(el.className || el.tagName));
  // Nas composições, todo texto fica sobre cor chapada: a do primeiro ancestral com fundo opaco. Aqui só colhe; quem
  // julga é o Worker, em `qaCard`.
  const cores: CorMedida[] = [];
  if (composicao) {
    for (const el of document.querySelectorAll('[data-fit] *, .selo-publi')) {
      if (!el.getClientRects().length || ![...el.childNodes].some((n: any) => n.nodeType === 3 && n.textContent.trim())) continue;
      let dono = el;
      while (dono.parentElement && !/^rgb\(/.test(getComputedStyle(dono).backgroundColor)) dono = dono.parentElement;
      cores.push({ alvo: String(el.className || el.tagName), cor: getComputedStyle(el).color, fundo: getComputedStyle(dono).backgroundColor });
    }
  }
  return {
    width: box.width as number, height: box.height as number, overflow, cores,
    overlap: Boolean(story.top <= Math.max(header.bottom, selo?.bottom ?? 0) || (!promo && story.bottom >= footer.top)
      || (canto && canto.bottom > story.top && canto.top < story.bottom && canto.left < story.right)),
    headlineLines: Math.round(h1.clientHeight / parseFloat(getComputedStyle(h1).lineHeight)),
    imagesLoaded: [...document.images].every((img: any) => img.naturalWidth > 0),
    badText: /\b(?:undefined|null|NaN)\b/.test(document.body.innerText),
    fontsReady: Boolean(document.fonts.check('900 58px Corpo') && document.fonts.check('700 58px Destaque')),
  };
};

export const layoutOk = (m: MetricasLayout, altura: number) =>
  m.width === 1080 && m.height === altura && !m.overflow.length && !m.overlap && m.imagesLoaded && !m.badText && m.fontsReady && !m.semContraste?.length;

/** O que ficou abaixo do mínimo, com a razão. Cor que o navegador não deu em rgb() fica fora da conta. */
export function julgarContraste(cores: CorMedida[]) {
  const ruins = new Set<string>();
  for (const c of cores) {
    const [cor, fundo] = [hexDeRgb(c.cor), hexDeRgb(c.fundo)];
    if (!cor || !fundo) continue;
    const razao = contraste(cor, fundo);
    if (razao < CONTRASTE_MINIMO) ruins.add(`${c.alvo} ${razao.toFixed(1)}:1`);
  }
  return [...ruins];
}

/** Espera fontes e imagens do card já carregado na `page`, mede e julga pela altura esperada do quadro. */
export async function qaCard(page: { evaluate: (...a: any[]) => Promise<any> }, o: { promo: boolean; altura: number }) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((img: any) => img.decode().catch(() => {})));
  });
  const { cores, ...medidas } = await page.evaluate(medirLayout, o.promo) as ReturnType<typeof medirLayout>;
  const semContraste = julgarContraste(cores ?? []);
  const metricas: MetricasLayout = { ...medidas, ...(semContraste.length ? { semContraste } : {}) };
  return { metricas, ok: layoutOk(metricas, o.altura) };
}
