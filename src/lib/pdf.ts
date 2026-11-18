// HTML → PDF no Browser Rendering (mockado nos testes por `navegador.abrir`). O HTML chega pronto, com as imagens
// embutidas: nada sai para a rede.
import type { Env } from '../env';
import { navegador, type AbrirNavegador } from './render';

export async function gerarPdf(env: Env, html: string, abrir: AbrirNavegador = () => navegador.abrir(env)): Promise<Uint8Array<ArrayBuffer>> {
  const browser = await abrir();
  try {
    const page = await browser.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 1 });
    await page.route(/^https?:\/\//, (route: any) => route.abort());
    await page.setContent(html, { waitUntil: 'load' });
    return await page.pdf({ format: 'A4', printBackground: true });
  } finally {
    await browser.close();
  }
}
