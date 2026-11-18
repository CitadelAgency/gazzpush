import type { Env } from '../env';

// Tokens de rede social em repouso (AES-GCM) e URLs de mídia assinadas (HMAC), ambos derivados de TOKEN_ENC_KEY.
// Chaves distintas por derivação com rótulo: vazar uma assinatura de URL não entrega a chave dos tokens.

const enc = new TextEncoder();

async function derivar(env: Env, rotulo: string, uso: 'AES-GCM' | 'HMAC') {
  if (!env.TOKEN_ENC_KEY) throw new Error('TOKEN_ENC_KEY ausente');
  const material = await crypto.subtle.digest('SHA-256', enc.encode(`${rotulo}:${env.TOKEN_ENC_KEY}`));
  return uso === 'AES-GCM'
    ? crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
    : crypto.subtle.importKey('raw', material, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

const b64url = (u8: Uint8Array) => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

export async function cifrarToken(env: Env, texto: string) {
  const key = await derivar(env, 'token', 'AES-GCM');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(texto)));
  return `v1.${b64url(iv)}.${b64url(ct)}`;
}

export async function decifrarToken(env: Env, blob: string) {
  const [v, iv, ct] = blob.split('.');
  if (v !== 'v1' || !iv || !ct) throw new Error('token cifrado em formato desconhecido');
  const key = await derivar(env, 'token', 'AES-GCM');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64url(iv) }, key, unb64url(ct));
  return new TextDecoder().decode(pt);
}

/** URL absoluta e efêmera pra um objeto do R2. Quem tem a URL lê o objeto até `exp`; nada além dele. */
/** Resumo de um dado que não deve ficar guardado em claro (o IP da lista de espera). Mesmo valor, mesmo resumo. */
export async function resumir(env: Env, rotulo: string, valor: string) {
  const sig = await crypto.subtle.sign('HMAC', await derivar(env, rotulo, 'HMAC'), enc.encode(valor));
  return b64url(new Uint8Array(sig));
}

export async function assinarMedia(env: Env, key: string, ttlSegundos: number) {
  const exp = Math.floor(Date.now() / 1000) + ttlSegundos;
  const sig = await assinatura(env, key, exp);
  const base = env.PUBLIC_BASE_URL.replace(/\/$/, '');
  return `${base}/media/${key.split('/').map(encodeURIComponent).join('/')}?exp=${exp}&sig=${sig}`;
}

export async function verificarMedia(env: Env, key: string, exp: string | undefined, sig: string | undefined) {
  const expN = Number(exp);
  if (!Number.isFinite(expN) || !sig || expN < Date.now() / 1000) return false;
  return (await assinatura(env, key, expN)) === sig;
}

async function assinatura(env: Env, key: string, exp: number) {
  const k = await derivar(env, 'media', 'HMAC');
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(`${key}\n${exp}`))));
}
