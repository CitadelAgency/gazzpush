// Reels (Fase 4): o carrossel animado em 9:16, com ou sem a voz do dono (Fase 6). Os cards saem dos mesmos templates do carrossel
// (src/templates/card.html e convite.html, com a classe `r916`), viram uma composição HyperFrames (HTML + GSAP, um
// timeline pausado e determinístico) e o Container do Reels (container/reels/) devolve o MP4 de 1080×1920 a 30 fps.
// Spike, números e decisão: docs/SPIKE-reels-2026-11.md.
import { NonRetryableError } from 'cloudflare:workflows';
import type { Env } from '../env';
import { ehConvite, rotuloCard } from './cards';
import type { Pauta } from './pauta';
import { ALTURA_R916, qaCard, type MetricasLayout } from './qaLayout';
import type { Rascunho } from './redacao';
import { navegador, prepararCards, type AbrirNavegador, type ArteRenderizada, type CardPreparado } from './render';
import type { Musica } from './musica';
import { RITMO_PADRAO, RITMO_REELS, composicaoReels, temposReels, totalReels, type RitmoReels } from './reelsHtml';
import { temposDaNarracao } from './fala';
import { roteiroDoReels, type Narracao } from './narracao';

export { composicaoReels, escoparCss, temposReels, totalReels } from './reelsHtml';

/** O pedido ao Container: a composição e, uma vez cada, as imagens e a música que ela cita pelo nome. */
export interface PedidoReels { html: string; duracao: number; arquivos: { nome: string; base64: string }[] }

/**
 * O Container do Reels (Cloudflare Containers, classe ReelsContainer em src/reelsContainer.ts). Objeto mutável para os
 * testes trocarem por um falso (o Container não roda no vitest). Uma instância por peça: dois Reels da mesma peça
 * não correm juntos (o servidor do Container responde 429 se já estiver ocupado).
 */
export const containerReels = {
  async render(env: Env, pecaId: string, pedido: PedidoReels): Promise<Response> {
    // Desenvolvimento no Windows (o wrangler dev não sobe container): o mesmo container, no `docker run`.
    if (env.REELS_URL_LOCAL) {
      return fetch(`${env.REELS_URL_LOCAL.replace(/\/$/, '')}/render`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(pedido) });
    }
    const { getContainer } = await import('@cloudflare/containers');
    return getContainer(env.REELS, pecaId).fetch(new Request('http://reels/render', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(pedido),
    }));
  },
};

async function sha256(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function b64(bytes: ArrayBuffer) {
  const u8 = new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

/** `capaReels`: JPEG 9:16 do primeiro card, a capa publicada. Ausente em Reels antigo (`publicar` usa `thumb_offset`). */
export interface ArteReels extends ArteRenderizada { mp4: string; duracao: number; musica: string | null; tempoMs?: Record<string, number>; capaReels?: string }

/**
 * Tira do HTML as imagens em data URI (arte, foto, logo) e devolve cada uma uma vez, com um nome curto que o HTML passa
 * a citar: dez cards com a mesma ilustração de 3 MB mandam 3 MB, não 30. As fontes ficam no HTML (já vão uma vez só).
 */
export function separarArquivos(html: string) {
  const nomes = new Map<string, string>();
  const arquivos: { nome: string; base64: string }[] = [];
  const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg', 'image/webp': 'webp' };
  const saida = html.replace(/data:(image\/(?:png|jpeg|svg\+xml|webp));base64,([A-Za-z0-9+/=]+)/g, (_, tipo: string, base64: string) => {
    let nome = nomes.get(base64);
    if (!nome) {
      nome = `a${nomes.size + 1}.${EXT[tipo]}`;
      nomes.set(base64, nome);
      arquivos.push({ nome, base64 });
    }
    return nome;
  });
  return { html: saida, arquivos };
}

/** Teto do pedido ao Container (o servidor recusa acima de 40 MB). */
const MAX_PEDIDO = 38 * 1024 * 1024;

/**
 * Passa cada card pelo QA em 1080×1920 e tira a capa, o JPEG do primeiro card. Card reprovado derruba a produção sem
 * nova tentativa: o mesmo texto reprovaria de novo, e `motivoFalha` (web/src/regras.ts) lê o número do card na mensagem.
 */
async function conferirQuadro(preparados: CardPreparado[], abrir: AbrirNavegador) {
  const browser = await abrir();
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: ALTURA_R916 }, deviceScaleFactor: 1 });
    await page.route(/^https?:\/\//, (route: any) => route.abort());
    let primeiro: { capa: Uint8Array; metricas: MetricasLayout } | null = null;
    for (const p of preparados) {
      await page.setContent(p.html, { waitUntil: 'load' });
      const { metricas, ok } = await qaCard(page, { promo: ehConvite(p.card), altura: ALTURA_R916 });
      if (!ok) throw new NonRetryableError(`layout 9:16 reprovado no card ${p.indice + 1} (${rotuloCard(p.card)}): ${JSON.stringify(metricas)}`);
      primeiro ??= { capa: await page.locator('.card').screenshot({ type: 'jpeg', quality: 90 }), metricas };
    }
    return primeiro!;
  } finally {
    await browser.close();
  }
}

/**
 * Monta o Reels de uma versão: cards 9:16 → QA → composição → Container → MP4 no R2 (`reels/<tenant>/<peça>/v<n>-<hash>.mp4`).
 * A chave leva o hash da composição (com as imagens) e da faixa (o ETag do arquivo no R2): o replay do step acha o
 * arquivo e não renderiza de novo; trocar a faixa no mesmo nome gera outro vídeo. A capa da tela e do pacote é a
 * primeira arte do carrossel de origem; a capa publicada é `capaReels`, o primeiro card em 9:16, ao lado do MP4.
 * `hoje`: a data do pedido (o card sem data de fato mostra a data de publicação), congelada para o replay depois da
 * meia-noite dar o mesmo HTML. O QA roda em todo card, também no replay; as métricas gravadas são as do primeiro.
 */
export async function renderizarReels(env: Env, input: {
  tenantId: string; pecaId: string; versao: number; rascunho: Rascunho; pauta: Pauta; ilustracaoR2?: string;
  musica: Musica | null; capa: { png: string; jpg: string }; hoje?: string; ritmo?: RitmoReels; voz?: Narracao | null;
}, abrir: AbrirNavegador = () => navegador.abrir(env)): Promise<ArteReels[]> {
  const preparados = await prepararCards(env, {
    tenantId: input.tenantId, pecaId: input.pecaId, versao: input.versao, formato: 'carrossel', quadro: 'r916',
    rascunho: input.rascunho, pauta: input.pauta, ilustracaoR2: input.ilustracaoR2, hoje: input.hoje,
  });
  const { capa, metricas } = await conferirQuadro(preparados, abrir);
  const { passo, movimento } = input.ritmo ?? RITMO_PADRAO;
  // Com voz, o tempo vem do alinhamento da fala; sem voz, do texto de cada card.
  const voz = input.voz ?? null;
  const alinhado = voz ? temposDaNarracao(roteiroDoReels(preparados.map((p) => p.card)), voz.palavras, voz.duracao ?? 0, preparados.length, RITMO_REELS.convite) : null;
  const tempos = alinhado?.tempos ?? temposReels(preparados.map((p) => p.card), passo);
  const duracao = totalReels(tempos);
  const nomeVoz = voz ? `voz.${voz.r2.slice(voz.r2.lastIndexOf('.') + 1)}` : null;
  const nomeMusica = input.musica ? `musica${input.musica.arquivo.slice(input.musica.arquivo.lastIndexOf('.'))}` : null;
  const completo = composicaoReels({
    cards: preparados.map((p) => p.html), tempos, movimento, musica: nomeMusica, idioma: input.pauta.idioma,
    voz: voz && alinhado ? { arquivo: nomeVoz!, duracao: voz.duracao ?? 0, frases: alinhado.frases } : null,
  });
  const faixa = input.musica ? await env.MEDIA.head(input.musica.arquivo) : null;
  if (input.musica && !faixa) throw new Error(`música ${input.musica.id} não está no R2 (${input.musica.arquivo})`);
  const hash = await sha256(`${completo}\n${input.musica?.arquivo ?? ''}\n${faixa?.etag ?? ''}${voz ? `\n${voz.sha256}` : ''}`);
  const base = `reels/${input.tenantId}/${input.pecaId}/v${input.versao}-${hash.slice(0, 16)}`;
  const chave = `${base}.mp4`;
  const capaReels = `${base}-capa.jpg`;
  await env.MEDIA.put(capaReels, capa, { httpMetadata: { contentType: 'image/jpeg' } });
  let tempoMs: Record<string, number> | null = null;
  if (!(await env.MEDIA.head(chave))) {
    const { html, arquivos } = separarArquivos(completo);
    if (input.musica && nomeMusica) {
      const obj = await env.MEDIA.get(input.musica.arquivo);
      if (!obj) throw new Error(`música ${input.musica.id} não está no R2 (${input.musica.arquivo})`);
      arquivos.push({ nome: nomeMusica, base64: b64(await obj.arrayBuffer()) });
    }
    if (voz && nomeVoz) {
      const obj = await env.MEDIA.get(voz.r2);
      if (!obj) throw new Error('a voz do Reels não está no R2');
      arquivos.push({ nome: nomeVoz, base64: b64(await obj.arrayBuffer()) });
    }
    const tamanho = html.length + arquivos.reduce((t, a) => t + a.base64.length, 0);
    if (tamanho > MAX_PEDIDO) throw new Error(`reels grande demais para o container (${Math.round(tamanho / 1048576)} MB): imagens ou música pesadas demais`);
    const res = await containerReels.render(env, input.pecaId, { html, duracao, arquivos });
    if (!res.ok) throw new Error(`container do reels → ${res.status}: ${(await res.text()).slice(0, 500)}`);
    if (!(res.headers.get('content-type') ?? '').startsWith('video/mp4')) throw new Error('container do reels: resposta não é MP4');
    try { tempoMs = JSON.parse(res.headers.get('x-tempo-ms') ?? 'null'); } catch { tempoMs = null; }
    await env.MEDIA.put(chave, await res.arrayBuffer(), { httpMetadata: { contentType: 'video/mp4' } });
  }
  return [{
    papel: 'reels', id: 'reels', layout: 'capa', png: input.capa.png, jpg: input.capa.jpg, hash, mp4: chave, capaReels, duracao,
    musica: input.musica?.id ?? null, ...(tempoMs ? { tempoMs } : {}), metricas,
  }];
}
