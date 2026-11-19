import type { Env } from '../env';
import { PROVIDERS } from './providersTable';

// Grok image-edit through Kie, with a style reference image. The key arrives resolved (the outlet's or the server's,
// src/lib/providers.ts). `KIE_URL` swaps the API base in tests.
export const KIE_MODEL = PROVIDERS.kie.modelo;
export const KIE_CREDIT_USD = PROVIDERS.kie.preco.creditoUsd;
export const KIE_RESERVE_USD = PROVIDERS.kie.preco.imagemUsd;   // typical cost of one image; used when the provider does not report credits
const api = (env: Env) => `${env.KIE_URL ? env.KIE_URL.replace(/\/$/, '') : 'https://api.kie.ai'}/api/v1/jobs/`;
const UPLOAD = 'https://kieai.redpandaai.co/api/file-base64-upload';
const MAX_BYTES = 25_000_000;

export interface TaskKie {
  state: string;                 // waiting | queuing | generating | success | fail
  resultUrls: string[];
  creditsConsumed: number | null;
  failCode: string | null;
  failMsg: string | null;
}

export function b64(bytes: ArrayBuffer) {
  const u8 = new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

function httpsUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error(`kie: invalid URL ${url.hostname}`);
  return url.href;
}

async function call(key: string, url: string, body?: unknown): Promise<Record<string, any>> {
  if (!key) throw new Error('KIE_API_KEY missing');
  // Workers do not implement redirect:'error'; 'manual' plus a status check has the same effect (credentials never follow a redirect).
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    redirect: 'manual',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) { await res.body?.cancel(); throw new Error(`kie HTTP ${res.status}`); }
  const data = await res.json<Record<string, any>>();
  // jobs/* answers {code:200,...}; the upload answers {success:true,...}
  // Code only (402 = out of credit, read by review): the provider's message stays out of the event and the log.
  if (!(Number(data.code) === 200 || data.success === true)) throw new Error(`kie refused: code ${data.code ?? '?'}`);
  return data;
}

/** Reference type from its bytes (the Brand tab accepts PNG and JPEG). */
export const referenceType = (bytes: ArrayBuffer) => {
  const b = new Uint8Array(bytes, 0, Math.min(3, bytes.byteLength));
  return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? { mime: 'image/jpeg', ext: 'jpg' } : { mime: 'image/png', ext: 'png' };
};

/** Uploads the reference image (PNG or JPEG ≤ 10 MB) and returns an https URL the model can read. */
export async function sendReference(key: string, bytes: ArrayBuffer, base: string): Promise<string> {
  if (bytes.byteLength > 10_000_000) throw new Error('reference exceeds 10 MB');
  const { mime, ext } = referenceType(bytes);
  const data = await call(key, UPLOAD, { base64Data: `data:${mime};base64,${b64(bytes)}`, uploadPath: 'images/redacao', fileName: `${base}.${ext}` });
  const url = data.data?.downloadUrl;
  if (typeof url !== 'string') throw new Error('kie: upload has no downloadUrl');
  return httpsUrl(url);
}

export async function createTask(env: Env, key: string, prompt: string, referenceUrl: string): Promise<string> {
  if (!prompt || prompt.length > 20_000) throw new Error('invalid image prompt');
  const data = await call(key, `${api(env)}createTask`, { model: KIE_MODEL, input: { prompt, image_urls: [httpsUrl(referenceUrl)], aspect_ratio: '2:3' } });
  const taskId = data.data?.taskId;
  if (typeof taskId !== 'string' || !/^[\w-]{1,200}$/.test(taskId)) throw new Error('kie: createTask has no taskId');
  return taskId;
}

export async function queryTask(env: Env, key: string, taskId: string): Promise<TaskKie> {
  const data = await call(key, `${api(env)}recordInfo?taskId=${encodeURIComponent(taskId)}`);
  const d = data.data ?? {};
  if (d.taskId !== taskId || typeof d.state !== 'string') throw new Error('kie: task mismatch');
  let result = d.resultJson ?? {};
  if (typeof result === 'string') result = JSON.parse(result);
  const credits = Number(d.creditsConsumed);
  return {
    state: d.state,
    resultUrls: Array.isArray(result.resultUrls) ? result.resultUrls.map(httpsUrl) : [],
    creditsConsumed: Number.isFinite(credits) && credits >= 0 ? credits : null,
    failCode: d.failCode == null ? null : String(d.failCode).slice(0, 50),
    failMsg: typeof d.failMsg === 'string' ? d.failMsg.slice(0, 500) : null,
  };
}

/** CDN download without credentials and without following redirects. */
export async function downloadImage(url: string): Promise<ArrayBuffer> {
  const res = await fetch(httpsUrl(url), { redirect: 'manual', signal: AbortSignal.timeout(90_000) });
  if (!res.ok) { await res.body?.cancel(); throw new Error(`kie: download HTTP ${res.status}`); }
  if (Number(res.headers.get('content-length')) > MAX_BYTES) { await res.body?.cancel(); throw new Error('image exceeds limit'); }
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES || bytes.byteLength < 20) throw new Error('image has an invalid size');
  return bytes;
}
