// Veículo novo com estilo pronto: lê o site do veículo no Browser Rendering e sugere nome, logo, cores e par de fontes. A pessoa
// confere na tela antes de salvar. Só http/https em endereço público, com prazo. Imagem de matéria não entra: o logo sai do
// cabeçalho ou de elemento marcado como logo, nunca de dentro de `<article>`. SVG passa por `sanitizarSvg`.
import type { Env } from '../env';
import { LOGO_MAX_BYTES, ehPng, sanitizarSvg } from '../shell/marca';
import { urlSegura } from './artigo';
import { buscar } from './autoral';
import { LER_SITE, coresDoSite, parDoSite, type CoresDoSite, type LeituraSite } from './leituraSite';
import { navegador, type AbrirNavegador } from './render';
import type { ParFontes } from './tipografia';

export const PRAZO_PUXAR_MS = 20_000;
/** Cada leitura abre um navegador: o teto segura o custo por veículo. */
export const MAX_PUXADAS_DIA = 10;
const MAX_LOGOS = 4;

export interface MarcaDoSite {
  nome: string | null;
  cores: CoresDoSite;
  fontes: ParFontes;
  logo: { tipo: 'image/png' | 'image/svg+xml'; base64: string } | null;
}

const base64 = (b: Uint8Array) => {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
const emBase64 = (texto: string) => base64(new TextEncoder().encode(texto));

async function logoDoSite(l: LeituraSite): Promise<MarcaDoSite['logo']> {
  const limpo = l.svg ? sanitizarSvg(l.svg) : null;
  if (limpo) return { tipo: 'image/svg+xml', base64: emBase64(limpo) };
  for (const url of l.logos.slice(0, MAX_LOGOS)) {
    const r = await buscar(url, 'image/png, image/svg+xml;q=0.9', LOGO_MAX_BYTES);
    if (!r?.bytes?.length) continue;
    if (ehPng(r.bytes)) return { tipo: 'image/png', base64: base64(r.bytes) };
    if (/svg/i.test(r.tipo)) {
      const svg = sanitizarSvg(new TextDecoder().decode(r.bytes));
      if (svg) return { tipo: 'image/svg+xml', base64: emBase64(svg) };
    }
  }
  return null;
}

/** Aceita o endereço como a pessoa cola, sem `https://`. Devolve null se não for endereço público. */
export function enderecoDoSite(valor: unknown): string | null {
  const v = typeof valor === 'string' ? valor.trim() : '';
  if (!v || v.length > 500) return null;
  const url = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
  return urlSegura(url) ? new URL(url).href : null;
}

/** Lança se o site não abrir, passar do prazo ou redirecionar para endereço que não é público. */
export async function puxarMarca(env: Env, url: string, abrir: AbrirNavegador = () => navegador.abrir(env)): Promise<MarcaDoSite> {
  const browser = await abrir();
  let prazo: ReturnType<typeof setTimeout> | undefined;
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    // Só a página e o CSS: imagem, vídeo e fonte não mudam o que é lido, e endereço interno não abre nem por redirecionamento.
    await page.route(/^https?:\/\//, (rota: any) => (['image', 'media', 'font'].includes(rota.request().resourceType()) || !urlSegura(rota.request().url()) ? rota.abort() : rota.continue()));
    const leitura = await Promise.race([
      (async () => {
        const res = await page.goto(url, { timeout: PRAZO_PUXAR_MS, waitUntil: 'domcontentloaded' });
        if (!res?.ok() || !urlSegura(page.url())) throw new Error('site_fora');
        return (await page.evaluate(LER_SITE)) as LeituraSite;
      })(),
      new Promise<never>((_, nao) => { prazo = setTimeout(() => nao(new Error('site_fora')), PRAZO_PUXAR_MS); }),
    ]);
    return { nome: leitura.nome?.replace(/\s+/g, ' ').trim().slice(0, 80) || null, cores: coresDoSite(leitura), fontes: parDoSite(leitura.fontes), logo: await logoDoSite(leitura) };
  } finally {
    clearTimeout(prazo);
    await browser.close();
  }
}
