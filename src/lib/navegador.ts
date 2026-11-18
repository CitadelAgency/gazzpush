import { launch } from '@cloudflare/playwright';
import type { Env } from '../env';

/**
 * Fallback para site que barra o `fetch` (403/429 de WAF): abre a página no Browser Rendering e devolve o corpo.
 * Não é o padrão: custa mais e é lento. Feed XML vem cru (corpo do response); HTML vem renderizado (`page.content()`).
 */
export interface RespostaNavegador {
  status: number;
  corpo: string;
  tipo: string | null;   // content-type do response
  url: string;           // URL final (depois de redirects)
}

export const TIMEOUT_NAVEGADOR_MS = 20_000;
/** Teto do corpo (bytes UTF-8), medido ainda no navegador: página maior não vem para o Worker. */
export const MAX_BYTES_NAVEGADOR = 2_000_000;

// O callback de page.evaluate roda no Chrome do Browser Rendering (sem lib DOM no Worker).
declare const document: any;

async function abrirNoNavegador(env: Env, url: string): Promise<RespostaNavegador> {
  const browser = await launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    const res = await page.goto(url, { timeout: TIMEOUT_NAVEGADOR_MS, waitUntil: 'domcontentloaded' });
    if (!res) throw new Error('navegador_sem_resposta');
    const tipo = res.headers()['content-type'] ?? null;
    const declarado = Number(res.headers()['content-length'] ?? 0);
    const medido: number = await page.evaluate(() => new Blob([document.documentElement?.outerHTML ?? '']).size);
    if (declarado > MAX_BYTES_NAVEGADOR || medido > MAX_BYTES_NAVEGADOR) throw new Error('navegador_corpo_grande');
    const corpo = tipo && /xml|rss|atom/i.test(tipo) ? await res.text() : await page.content();
    if (new TextEncoder().encode(corpo).byteLength > MAX_BYTES_NAVEGADOR) throw new Error('navegador_corpo_grande');
    return { status: res.status(), corpo, tipo, url: page.url() };
  } finally {
    await browser.close();
  }
}

/** Injetável: o Browser binding não existe no vitest (os testes trocam `navegador.abrir` por um fake). */
export const navegador = { abrir: abrirNoNavegador };

export const buscarComNavegador = (env: Env, url: string) => navegador.abrir(env, url);

/** Status do `fetch` que justificam tentar pelo navegador. */
export const bloqueado = (status: number) => status === 403 || status === 429;
