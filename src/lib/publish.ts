import type { Env } from '../env';
import type { AccountMode } from '../kernel/states';
import { signMedia, decryptToken } from './crypto';
import type { ArtRendered } from './render';
import type { ArtReels } from './reels';
import type { Draft } from './drafting';

export interface Publication {
  rede: 'instagram';
  externalId: string;
  url?: string;
  simulada?: boolean;
  chamadas?: CallGraph[];      // simulated mode: what would have been sent. The Workflow records the event.
}

export interface Account { id: string; rede: string; external_id: string | null; token_enc: string | null; modo: AccountMode; provedor: string | null; provedor_ref: string | null }

/** One HTTP call to the Graph API, as it would be sent (token redacted). In simulated mode it is what goes to the log. */
export interface CallGraph { metodo: 'GET' | 'POST'; url: string; body?: Record<string, string>; resposta?: Record<string, any> }

// https://developers.facebook.com/documentation/instagram-platform/content-publishing (v26.0 as of 2026-10)
const GRAPH = 'https://graph.facebook.com/v26.0';
const CAPTION_LIMIT = 2200;
const URL_TTL_S = 60 * 60 * 2;   // Meta downloads the image when the container is created; 2 h covers the step's retries.
const POLL_MS = 2000;
const POLL_MAX = 30;
// Video: Meta downloads and processes the MP4 (seconds to a few minutes). 5 s × 72 = 6 min.
const POLL_REELS_MS = 5000;
const POLL_REELS_MAX = 72;
const REELS_THUMB_OFFSET_MS = '1500';

/** The tenant's active Instagram account. With `contaId`, only that one; without it, the preferred one: real > intermediario > manual > simulada. */
export async function loadAccount(env: Env, tenantId: string, accountId?: string | null): Promise<Account> {
  const cols = 'id, rede, external_id, token_enc, modo, provedor, provedor_ref';
  const account = accountId
    ? await env.DB.prepare(`SELECT ${cols} FROM contas_sociais WHERE id = ? AND tenant_id = ? AND rede = 'instagram' AND status = 'ativa'`).bind(accountId, tenantId).first<Account>()
    : await env.DB.prepare(`SELECT ${cols} FROM contas_sociais WHERE tenant_id = ? AND rede = 'instagram' AND status = 'ativa'
        ORDER BY CASE modo WHEN 'real' THEN 0 WHEN 'intermediario' THEN 1 WHEN 'manual' THEN 2 ELSE 3 END, created_at LIMIT 1`).bind(tenantId).first<Account>();
  if (!account) throw new WithoutAccount(
    accountId ? `conta ${accountId} não encontrada ou inativa` : 'tenant sem conta Instagram ativa',
    accountId ? `account ${accountId} not found or inactive` : 'publication has no active Instagram account',
  );
  return account;
}

export class WithoutAccount extends Error {
  name = 'SemConta';
  /** `en`: the same message in English (the API picks by the request's language; `message` is the Portuguese one). */
  constructor(message: string, readonly en?: string) { super(message); }
}

/**
 * Everything the operator needs to publish by hand: signed JPEGs (24 h) + caption. Also used by the intermediary.
 * Reels: `video` is the signed MP4 (24 h), `imagens` only carries the screen's cover and `capa` is the published 9:16
 * JPEG (null in older Reels).
 */
export async function packagePublication(env: Env, tenantId: string, pieceId: string) {
  const piece = await env.DB.prepare('SELECT formato, conteudo_json, arte_r2_keys_json FROM pecas WHERE id = ? AND tenant_id = ?')
    .bind(pieceId, tenantId).first<{ formato: string; conteudo_json: string; arte_r2_keys_json: string | null }>();
  if (!piece) return null;
  if (!piece.arte_r2_keys_json) throw new Error('piece has no rendered art');
  const draft = JSON.parse(piece.conteudo_json) as Draft;
  const artwork = JSON.parse(piece.arte_r2_keys_json) as ArtRendered[];
  const caption = draft.legenda.length > CAPTION_LIMIT ? `${draft.legenda.slice(0, CAPTION_LIMIT - 1)}…` : draft.legenda;
  const images = await Promise.all(artwork.map(async (a) => ({ papel: a.papel, jpg: await signMedia(env, a.jpg, 24 * 3600) })));
  const mp4 = piece.formato === 'reels' ? (artwork[0] as Partial<ArtReels> | undefined)?.mp4 : undefined;
  if (piece.formato === 'reels' && !mp4) throw new Error('reels without an assembled video');
  const reelsCover = piece.formato === 'reels' ? (artwork[0] as Partial<ArtReels>).capaReels : undefined;
  return { formato: piece.formato, legenda: caption, imagens: images, video: mp4 ? await signMedia(env, mp4, 24 * 3600) : null, capa: reelsCover ? await signMedia(env, reelsCover, 24 * 3600) : null };
}

/**
 * Automatic publishing. 'real' mode: Instagram Graph API in 2 steps (container → publish); carousel = N children + 1
 * parent. 'simulada' mode: builds the same calls and returns them in `chamadas`, without sending. 'manual' mode never
 * gets here (the Workflow waits for the operator). 'intermediario' mode: one adapter per provider (Ayrshare; PostPeer and
 * Zernio later). `makeFetch` is injectable (tests); the default is the global fetch.
 */
export async function publish(env: Env, input: { tenantId: string; pecaId: string; conta: Account }, makeFetch: typeof fetch = (...a) => fetch(...a)): Promise<Publication> {
  const { conta: account } = input;
  if (account.modo === 'manual') throw new Error("account in manual mode: publishing is the operator's, not the Workflow's");
  if (account.modo === 'intermediario') {
    if (account.provedor !== 'ayrshare') throw new Error(`intermediary '${account.provedor ?? '?'}' is not implemented yet`);
    return publishAyrshare(env, input, makeFetch);
  }

  const packageOrNothing = await packagePublication(env, input.tenantId, input.pecaId);
  if (!packageOrNothing) throw new Error(`piece ${input.pecaId} not found`);
  const { formato: format, legenda: caption, imagens: pkg, video, capa: cover } = packageOrNothing;
  const images = pkg.map((i) => i.jpg);   // IG requires JPEG and a public URL

  const simulated = account.modo === 'simulada';
  const igUserId = account.external_id ?? (simulated ? 'IG_USER_ID' : null);
  if (!igUserId) throw new Error(`account ${account.id} has no external_id (the Instagram professional account id)`);
  const token = simulated ? 'TOKEN_REDIGIDO' : await decryptToken(env, account.token_enc ?? '');
  const graph = new Graph(token, simulated);

  // 1. child containers (carousel), video (Reels) or single (post)
  let creationId: string;
  if (format === 'reels' && video) {
    // Without a cover or an offset Meta uses frame 0, and an older Reels opens without its title: by 1.5 s the text is in.
    const frame: Record<string, string> = cover ? { cover_url: cover } : { thumb_offset: REELS_THUMB_OFFSET_MS };
    creationId = (await graph.post(`${igUserId}/media`, { media_type: 'REELS', video_url: video, caption: caption, share_to_feed: 'true', ...frame })).id;
  } else if (format === 'carrossel' && images.length > 1) {
    const children: string[] = [];
    for (const image_url of images) children.push((await graph.post(`${igUserId}/media`, { image_url, is_carousel_item: 'true' })).id);
    creationId = (await graph.post(`${igUserId}/media`, { media_type: 'CAROUSEL', children: children.join(','), caption: caption })).id;
  } else {
    creationId = (await graph.post(`${igUserId}/media`, { image_url: images[0], caption: caption })).id;
  }

  // 2. the container must be FINISHED before publish (Meta downloads and processes the image or video asynchronously)
  const [pollMs, pollMax] = format === 'reels' ? [POLL_REELS_MS, POLL_REELS_MAX] : [POLL_MS, POLL_MAX];
  for (let i = 0; i < pollMax; i++) {
    const st = await graph.get(`${creationId}`, { fields: 'status_code,status' });
    if (st.status_code === 'FINISHED') break;
    if (st.status_code === 'ERROR' || st.status_code === 'EXPIRED') throw new Error(`container ${creationId}: ${st.status_code} ${st.status ?? ''}`);
    if (i === pollMax - 1) throw new Error(`container ${creationId} was not ready after ${(pollMs * pollMax) / 1000}s`);
    await new Promise((r) => setTimeout(r, pollMs));
  }

  // 3. publish → media id → permalink
  const media = await graph.post(`${igUserId}/media_publish`, { creation_id: creationId });
  const info = await graph.get(`${media.id}`, { fields: 'permalink' });

  return { rede: 'instagram', externalId: media.id, url: info.permalink, simulada: simulated, ...(simulated ? { chamadas: graph.log } : {}) };
}

/** Minimal client. In simulated mode it returns plausible responses and records each call with the token redacted. */
class Graph {
  readonly log: CallGraph[] = [];
  private seq = 0;
  constructor(private token: string, private simulada: boolean) {}

  async post(path: string, body: Record<string, string>) { return this.call('POST', path, body); }
  async get(path: string, query: Record<string, string>) { return this.call('GET', path, query); }

  private async call(method: 'GET' | 'POST', path: string, params: Record<string, string>): Promise<Record<string, any>> {
    const url = `${GRAPH}/${path}`;
    if (this.simulada) {
      const answer = this.fingir(path, params);
      this.log.push({ metodo: method, url, body: params, resposta: answer });
      return answer;
    }
    const form = new URLSearchParams({ ...params, access_token: this.token });
    const res = method === 'GET'
      ? await fetch(`${url}?${form}`, { signal: AbortSignal.timeout(30_000) })
      : await fetch(url, { method: 'POST', body: form, signal: AbortSignal.timeout(30_000) });
    const data = await res.json<Record<string, any>>().catch((): Record<string, any> => ({}));
    if (!res.ok || data.error) throw new Error(`graph ${method} ${path} → ${res.status}: ${JSON.stringify(data.error ?? data).slice(0, 400)}`);
    return data;
  }

  private fingir(path: string, params: Record<string, string>): Record<string, any> {
    this.seq++;
    if (path.endsWith('/media_publish')) return { id: `sim_media_${params.creation_id}` };
    if (path.endsWith('/media')) return { id: `sim_container_${this.seq}` };
    if (params.fields?.includes('status_code')) return { status_code: 'FINISHED', id: path };
    if (params.fields?.includes('permalink')) return { permalink: `https://www.instagram.com/p/SIMULADO_${path.replace(/\W/g, '').slice(-8)}/`, id: path };
    return { id: path };
  }
}

// ── intermediary: Ayrshare ──────────────────────────────────────────────────────────────────────────────────────
// https://www.ayrshare.com/docs/apis/post/post — POST /api/post with the API key (Bearer) and the client's profile
// (`Profile-Key` = provedor_ref). Ayrshare downloads the images from the signed URLs (24 h) and publishes with its own app.
const AYRSHARE = 'https://api.ayrshare.com/api/post';

async function publishAyrshare(env: Env, input: { tenantId: string; pecaId: string; conta: Account }, makeFetch: typeof fetch): Promise<Publication> {
  const { conta: account } = input;
  const pkg = await packagePublication(env, input.tenantId, input.pecaId);
  if (!pkg) throw new Error(`piece ${input.pecaId} not found`);
  if (!account.token_enc) throw new Error(`account ${account.id} has no Ayrshare API key`);
  if (pkg.formato === 'reels') throw new Error("Reels don't go out through the intermediary yet: use the manual account or the direct connection");
  const key = await decryptToken(env, account.token_enc);
  const images = pkg.formato === 'carrossel' ? pkg.imagens : pkg.imagens.slice(0, 1);
  const headers: Record<string, string> = { authorization: `Bearer ${key}`, 'content-type': 'application/json' };
  if (account.provedor_ref) headers['profile-key'] = account.provedor_ref;
  const res = await makeFetch(AYRSHARE, {
    method: 'POST', headers, signal: AbortSignal.timeout(60_000),
    // Idempotency key = the piece: if the response to an accepted send is lost, the Workflow's retry does not post again
    // (Ayrshare rejects the repeated key).
    body: JSON.stringify({ post: pkg.legenda, platforms: ['instagram'], mediaUrls: images.map((i) => i.jpg), idempotencyKey: `redacao-${input.pecaId}` }),
  });
  const data = await res.json<Record<string, any>>().catch((): Record<string, any> => ({}));
  // With Profile-Key the response comes per profile (`posts[].postIds`); without it, `postIds` is at the root. Both formats are accepted.
  const postIds = [data, ...(Array.isArray(data.posts) ? data.posts : [])].flatMap((d: Record<string, any>) => (Array.isArray(d?.postIds) ? d.postIds : []));
  const ig = postIds.find((p: Record<string, any>) => p?.platform === 'instagram') as Record<string, any> | undefined;
  // The error message only comes from what Ayrshare returned (never from the key or the headers).
  if (!res.ok || data.status === 'error' || !ig || ig.status === 'error') {
    const msg = String(data.message ?? ig?.message ?? data.errors?.[0]?.message ?? '').replace(key, '[chave]').slice(0, 300);
    // Repeated key: an earlier send of this piece was accepted. It is not a new posting failure; the post may already be there.
    if (/idempoten/i.test(msg)) throw new Error(`ayrshare: this piece was already sent before (repeated idempotency key); check on Instagram before you try again`);
    throw new Error(`ayrshare ${res.status}: ${msg || 'no detail'}`);
  }
  const externalId = String(ig.id ?? data.id ?? '');
  if (!externalId) throw new Error('ayrshare: response has no post id');
  const url = typeof ig.postUrl === 'string' && /^https:\/\//.test(ig.postUrl) ? ig.postUrl : undefined;
  return { rede: 'instagram', externalId, ...(url ? { url } : {}) };
}
