// HTML → PDF in Browser Rendering (mocked in tests through `navegador.abrir`). The HTML arrives complete, with images
// embedded: nothing goes out to the network.
import type { Env } from '../env';
import { browserApi, type OpenBrowser } from './render';

export async function generatePdf(env: Env, html: string, launch: OpenBrowser = () => browserApi.abrir(env)): Promise<Uint8Array<ArrayBuffer>> {
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 1 });
    await page.route(/^https?:\/\//, (route: any) => route.abort());
    await page.setContent(html, { waitUntil: 'load' });
    return await page.pdf({ format: 'A4', printBackground: true });
  } finally {
    await browser.close();
  }
}
