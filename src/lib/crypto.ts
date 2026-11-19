import type { Env } from '../env';

// Social network tokens at rest (AES-GCM) and signed media URLs (HMAC), both derived from TOKEN_ENC_KEY.
// Distinct keys by labelled derivation: leaking a URL signature does not hand over the token key.

const enc = new TextEncoder();

async function derive(env: Env, purpose: string, usage: 'AES-GCM' | 'HMAC') {
  if (!env.TOKEN_ENC_KEY) throw new Error('TOKEN_ENC_KEY missing');
  const material = await crypto.subtle.digest('SHA-256', enc.encode(`${purpose}:${env.TOKEN_ENC_KEY}`));
  return usage === 'AES-GCM'
    ? crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
    : crypto.subtle.importKey('raw', material, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

const b64url = (u8: Uint8Array) => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

export async function encryptToken(env: Env, text: string) {
  const key = await derive(env, 'token', 'AES-GCM');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text)));
  return `v1.${b64url(iv)}.${b64url(ct)}`;
}

export async function decryptToken(env: Env, blob: string) {
  const [v, iv, ct] = blob.split('.');
  if (v !== 'v1' || !iv || !ct) throw new Error('encrypted token in an unknown format');
  const key = await derive(env, 'token', 'AES-GCM');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64url(iv) }, key, unb64url(ct));
  return new TextDecoder().decode(pt);
}

/** Absolute, short-lived URL for an R2 object. Whoever has the URL can read the object until `exp`; nothing else. */
/** Digest of a value that must not be stored in the clear (the waitlist IP). Same value, same digest. */
export async function summarize(env: Env, purpose: string, value: string) {
  const sig = await crypto.subtle.sign('HMAC', await derive(env, purpose, 'HMAC'), enc.encode(value));
  return b64url(new Uint8Array(sig));
}

export async function signMedia(env: Env, key: string, ttlSeconds: number) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = await signature(env, key, exp);
  const base = env.PUBLIC_BASE_URL.replace(/\/$/, '');
  return `${base}/media/${key.split('/').map(encodeURIComponent).join('/')}?exp=${exp}&sig=${sig}`;
}

export async function verifyMedia(env: Env, key: string, exp: string | undefined, sig: string | undefined) {
  const expN = Number(exp);
  if (!Number.isFinite(expN) || !sig || expN < Date.now() / 1000) return false;
  return (await signature(env, key, expN)) === sig;
}

async function signature(env: Env, key: string, exp: number) {
  const k = await derive(env, 'media', 'HMAC');
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(`${key}\n${exp}`))));
}
