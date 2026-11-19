// Reels (Phase 4): the animated carousel in 9:16, with or without the owner's voice (Phase 6). The cards come from the
// same templates as the carousel (src/templates/card.html and cta.html, with the `r916` class), become a HyperFrames
// composition (HTML + GSAP, one paused and deterministic timeline) and the Reels Container (container/reels/) returns a
// 1080×1920 MP4 at 30 fps. Spike, numbers and decision: docs/SPIKE-reels-2026-11.md.
import { NonRetryableError } from 'cloudflare:workflows';
import type { Env } from '../env';
import { isInvite, cardLabel } from './cards';
import type { Lead } from './lead';
import { HEIGHT_R916, qaCard, type MetricsLayout } from './qaLayout';
import type { Draft } from './drafting';
import { browserApi, prepareCards, type OpenBrowser, type ArtRendered, type CardPrepared } from './render';
import type { Music } from './music';
import { DEFAULT_PACE, REELS_PACE, compositionReels, timesReels, totalReels, type ReelsPace } from './reelsHtml';
import { timesNarration } from './speech';
import { roteiroDoReels, type Narration } from './narration';

export { compositionReels as composicaoReels, scopeCss as escoparCss, timesReels as temposReels, totalReels } from './reelsHtml';

/** The request to the Container: the composition and, once each, the images and music it references by name. */
export interface ReelsRequest { html: string; duracao: number; arquivos: { nome: string; base64: string }[] }

/**
 * The Reels Container (Cloudflare Containers, ReelsContainer class in src/reelsContainer.ts). A mutable object so tests
 * can swap it for a fake (the Container does not run in vitest). One instance per piece: two Reels of the same piece do
 * not run together (the Container's server answers 429 if it is already busy).
 */
export const containerReels = {
  async render(env: Env, pieceId: string, request: ReelsRequest): Promise<Response> {
    // Development on Windows (wrangler dev does not run containers): the same container, via `docker run`.
    if (env.REELS_URL_LOCAL) {
      return fetch(`${env.REELS_URL_LOCAL.replace(/\/$/, '')}/render`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
    }
    const { getContainer } = await import('@cloudflare/containers');
    return getContainer(env.REELS, pieceId).fetch(new Request('http://reels/render', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
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

/** `capaReels`: 9:16 JPEG of the first card, the published cover. Absent in older Reels (`publicar` uses `thumb_offset`). */
export interface ArtReels extends ArtRendered { mp4: string; duracao: number; musica: string | null; tempoMs?: Record<string, number>; capaReels?: string }

/**
 * Takes the data URI images (art, photo, logo) out of the HTML and returns each one once, with a short name the HTML
 * then references: ten cards with the same 3 MB illustration send 3 MB, not 30. Fonts stay in the HTML (they already
 * go only once).
 */
export function splitFiles(html: string) {
  const names = new Map<string, string>();
  const files: { nome: string; base64: string }[] = [];
  const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg', 'image/webp': 'webp' };
  const output = html.replace(/data:(image\/(?:png|jpeg|svg\+xml|webp));base64,([A-Za-z0-9+/=]+)/g, (_, type: string, base64: string) => {
    let name = names.get(base64);
    if (!name) {
      name = `a${names.size + 1}.${EXT[type]}`;
      names.set(base64, name);
      files.push({ nome: name, base64 });
    }
    return name;
  });
  return { html: output, arquivos: files };
}

/** Cap for the request to the Container (the server rejects above 40 MB). */
const MAX_REQUEST = 38 * 1024 * 1024;

/**
 * Runs each card through QA at 1080×1920 and takes the cover, the JPEG of the first card. A rejected card brings
 * production down without another attempt: the same text would fail again, and `failureReason` (web/src/rules.ts) reads
 * the card number from the message.
 */
async function checkFrame(prepared: CardPrepared[], launch: OpenBrowser) {
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: HEIGHT_R916 }, deviceScaleFactor: 1 });
    await page.route(/^https?:\/\//, (route: any) => route.abort());
    let first: { capa: Uint8Array; metricas: MetricsLayout } | null = null;
    for (const p of prepared) {
      await page.setContent(p.html, { waitUntil: 'load' });
      const { metricas: metrics, ok } = await qaCard(page, { promo: isInvite(p.card), altura: HEIGHT_R916 });
      if (!ok) throw new NonRetryableError(`layout 9:16 rejected on card ${p.indice + 1} (${cardLabel(p.card)}): ${JSON.stringify(metrics)}`);
      first ??= { capa: await page.locator('.card').screenshot({ type: 'jpeg', quality: 90 }), metricas: metrics };
    }
    return first!;
  } finally {
    await browser.close();
  }
}

/**
 * Builds the Reels for a version: 9:16 cards → QA → composition → Container → MP4 in R2
 * (`reels/<tenant>/<piece>/v<n>-<hash>.mp4`). The key carries the hash of the composition (with images) and of the
 * track (the file's ETag in R2): the step's replay finds the file and does not render again; swapping the track under
 * the same name makes a new video. The screen's and the package's cover is the source carousel's first art; the
 * published cover is `capaReels`, the first card in 9:16, next to the MP4. `hoje`: the request's date (a card without a
 * fact date shows the publication date), frozen so a replay after midnight gives the same HTML. QA runs on every card,
 * on replay too; the stored metrics are the first card's.
 */
export async function renderReels(env: Env, input: {
  tenantId: string; pecaId: string; versao: number; rascunho: Draft; pauta: Lead; ilustracaoR2?: string;
  musica: Music | null; capa: { png: string; jpg: string }; hoje?: string; ritmo?: ReelsPace; voz?: Narration | null;
}, launch: OpenBrowser = () => browserApi.abrir(env)): Promise<ArtReels[]> {
  const prepared = await prepareCards(env, {
    tenantId: input.tenantId, pecaId: input.pecaId, versao: input.versao, formato: 'carrossel', quadro: 'r916',
    rascunho: input.rascunho, pauta: input.pauta, ilustracaoR2: input.ilustracaoR2, hoje: input.hoje,
  });
  const { capa: cover, metricas: metrics } = await checkFrame(prepared, launch);
  const { passo: step, movimento: motion } = input.ritmo ?? DEFAULT_PACE;
  // With voice, timing comes from the speech alignment; without voice, from each card's text.
  const voice = input.voz ?? null;
  const aligned = voice ? timesNarration(roteiroDoReels(prepared.map((p) => p.card)), voice.palavras, voice.duracao ?? 0, prepared.length, REELS_PACE.convite) : null;
  const times = aligned?.tempos ?? timesReels(prepared.map((p) => p.card), step);
  const duration = totalReels(times);
  const voiceName = voice ? `voz.${voice.r2.slice(voice.r2.lastIndexOf('.') + 1)}` : null;
  const musicName = input.musica ? `musica${input.musica.arquivo.slice(input.musica.arquivo.lastIndexOf('.'))}` : null;
  const complete = compositionReels({
    cards: prepared.map((p) => p.html), tempos: times, movimento: motion, musica: musicName, idioma: input.pauta.idioma,
    voz: voice && aligned ? { arquivo: voiceName!, duracao: voice.duracao ?? 0, frases: aligned.frases } : null,
  });
  const band = input.musica ? await env.MEDIA.head(input.musica.arquivo) : null;
  if (input.musica && !band) throw new Error(`music track ${input.musica.id} is not in R2 (${input.musica.arquivo})`);
  const hash = await sha256(`${complete}\n${input.musica?.arquivo ?? ''}\n${band?.etag ?? ''}${voice ? `\n${voice.sha256}` : ''}`);
  const base = `reels/${input.tenantId}/${input.pecaId}/v${input.versao}-${hash.slice(0, 16)}`;
  const key = `${base}.mp4`;
  const reelsCover = `${base}-capa.jpg`;
  await env.MEDIA.put(reelsCover, cover, { httpMetadata: { contentType: 'image/jpeg' } });
  let timeMs: Record<string, number> | null = null;
  if (!(await env.MEDIA.head(key))) {
    const { html, arquivos: files } = splitFiles(complete);
    if (input.musica && musicName) {
      const obj = await env.MEDIA.get(input.musica.arquivo);
      if (!obj) throw new Error(`music track ${input.musica.id} is not in R2 (${input.musica.arquivo})`);
      files.push({ nome: musicName, base64: b64(await obj.arrayBuffer()) });
    }
    if (voice && voiceName) {
      const obj = await env.MEDIA.get(voice.r2);
      if (!obj) throw new Error('the Reels voice is not in R2');
      files.push({ nome: voiceName, base64: b64(await obj.arrayBuffer()) });
    }
    const size = html.length + files.reduce((t, a) => t + a.base64.length, 0);
    if (size > MAX_REQUEST) throw new Error(`reels too large for the container (${Math.round(size / 1048576)} MB): images or music too heavy`);
    const res = await containerReels.render(env, input.pecaId, { html, duracao: duration, arquivos: files });
    if (!res.ok) throw new Error(`reels container → ${res.status}: ${(await res.text()).slice(0, 500)}`);
    if (!(res.headers.get('content-type') ?? '').startsWith('video/mp4')) throw new Error('reels container: response is not MP4');
    try { timeMs = JSON.parse(res.headers.get('x-tempo-ms') ?? 'null'); } catch { timeMs = null; }
    await env.MEDIA.put(key, await res.arrayBuffer(), { httpMetadata: { contentType: 'video/mp4' } });
  }
  return [{
    papel: 'reels', id: 'reels', layout: 'capa', png: input.capa.png, jpg: input.capa.jpg, hash, mp4: key, capaReels: reelsCover, duracao: duration,
    musica: input.musica?.id ?? null, ...(timeMs ? { tempoMs: timeMs } : {}), metricas: metrics,
  }];
}
