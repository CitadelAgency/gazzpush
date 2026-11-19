// Which key each model call uses. Order: the outlet's key (AI keys tab, encrypted in `chaves_ia`), then the server's
// (the usual variables), and with neither the feature is off, with the reason on screen. An install that only has the
// server variables works as before. Text and image have two providers each: first the outlet's key (the one chosen
// earlier) counts, then the server's (the one chosen earlier). The plaintext key only exists in the request's memory:
// never in logs, errors, events, API responses or Workflow step results.
import type { Env } from '../env';
import { decryptToken } from './crypto';
import { DeskError } from './desk';
import { PROVIDERS_IDS, PROVIDERS, PROVIDERS_IMAGE, PROVIDERS_TEXT, isProvider, type Provider, type ProviderImage, type ProviderText } from './providersTable';

export type KeyOrigin = 'veiculo' | 'servidor';
export interface UsedKey<P extends Provider = Provider> { provedor: P; chave: string; origem: KeyOrigin }
export interface OutletKeys {
  texto: UsedKey<ProviderText> | null;
  segunda: UsedKey<'anthropic'> | null;
  imagem: UsedKey<ProviderImage> | null;
  escolha: { texto: ProviderText; imagem: ProviderImage };
}

const gateway = (env: Env, provider: string) => `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.AI_GATEWAY_ID}/${provider}`;

/** Gemini base: GEMINI_URL (tests), the AI Gateway (google-ai-studio) or the direct API. */
export const baseGemini = (env: Env) => env.GEMINI_URL ? env.GEMINI_URL.replace(/\/$/, '') : env.AI_GATEWAY_ID ? gateway(env, 'google-ai-studio') : 'https://generativelanguage.googleapis.com';
/** Base for synchronous fal (fal.run): FAL_URL (tests), the AI Gateway or the direct API. */
export const baseFal = (env: Env) => env.FAL_URL ? env.FAL_URL.replace(/\/$/, '') : env.AI_GATEWAY_ID ? gateway(env, 'fal') : 'https://fal.run';

export const fromServerKey = (env: Env, p: Provider): string | null => {
  const v = (env as unknown as Record<string, unknown>)[PROVIDERS[p].variavel];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
};

const choiceText = (v: unknown): ProviderText => ((PROVIDERS_TEXT as readonly string[]).includes(v as string) ? v as ProviderText : 'deepseek');
const choiceImage = (v: unknown): ProviderImage => ((PROVIDERS_IMAGE as readonly string[]).includes(v as string) ? v as ProviderImage : 'kie');

/**
 * The outlet's keys, resolved once per operation (the check verifies several blocks with the same object). An outlet
 * that does not exist (tests, a job for a deleted outlet) falls back to the server's keys. A key that does not decrypt
 * (TOKEN_ENC_KEY changed) counts as missing.
 */
export async function fromOutletKeys(env: Env, tenantId: string): Promise<OutletKeys> {
  // No outlet (a test request built by hand): server keys only.
  const [t, k] = tenantId ? await env.DB.batch([
    env.DB.prepare('SELECT provedor_texto, provedor_imagem FROM tenants WHERE id = ?').bind(tenantId),
    env.DB.prepare('SELECT provedor, chave_enc FROM chaves_ia WHERE tenant_id = ?').bind(tenantId),
  ]) : [{ results: [] }, { results: [] }];
  const choice = (t.results[0] ?? {}) as { provedor_texto?: string; provedor_imagem?: string };
  const fromOutlet = new Map<Provider, string>();
  for (const r of k.results as { provedor: string; chave_enc: string }[]) {
    if (!isProvider(r.provedor)) continue;
    try {
      fromOutlet.set(r.provedor, await decryptToken(env, r.chave_enc));
    } catch {
      console.error('tenant AI key does not decrypt', tenantId, r.provedor);
    }
  }
  function resolve<P extends Provider>(order: readonly P[]): UsedKey<P> | null {
    for (const p of order) { const c = fromOutlet.get(p); if (c) return { provedor: p, chave: c, origem: 'veiculo' }; }
    for (const p of order) { const c = fromServerKey(env, p); if (c) return { provedor: p, chave: c, origem: 'servidor' }; }
    return null;
  }
  const text = choiceText(choice.provedor_texto), image = choiceImage(choice.provedor_imagem);
  return {
    texto: resolve([text, ...PROVIDERS_TEXT.filter((p) => p !== text)]),
    segunda: resolve(['anthropic'] as const),
    imagem: resolve([image, ...PROVIDERS_IMAGE.filter((p) => p !== image)]),
    escolha: { texto: text, imagem: image },
  };
}

/** No text key at all: the post door and the check door block, like the plan limit (402, the queue does not lose the lead). */
export const withoutKeyTextError = () => new DeskError('sem_chave_texto',
  'Falta a chave de IA de texto deste veículo. O admin cola a chave em Veículo, na aba Chaves de IA.', 402,
  "This outlet is missing its AI text key. The admin pastes the key in Publication, under the AI keys tab.");

export async function requireKeyText(env: Env, tenantId: string) {
  const keys = await fromOutletKeys(env, tenantId);
  if (!keys.texto) throw withoutKeyTextError();
  return keys;
}

// ── checking a key before storing it ──────────────────────────────────────────────────────────────────────────────────

export type ResultCheck = 'aceita' | 'recusada' | 'sem_resposta';

/**
 * A call that generates nothing (the model list, the balance) to learn whether the provider accepts the key. 401 and
 * 403 (for Gemini also 400, which is how Google answers an invalid key) are a rejection; any other failure is "no
 * answer", and in both cases the key is not stored. The provider's response does not leave here: it can echo the key.
 */
export async function checkKey(env: Env, p: Provider, key: string): Promise<ResultCheck> {
  const request = checkRequest(env, p, key);
  let res: Response;
  try {
    res = await fetch(request.url, { headers: request.headers, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
  } catch {
    return 'sem_resposta';
  }
  const body = await res.text().catch(() => '');
  if (request.recusa.includes(res.status)) return 'recusada';
  if (p === 'kie' && res.ok) {
    // Kie answers 200 with the code in the body.
    const code = Number((() => { try { return (JSON.parse(body) as { code?: unknown }).code; } catch { return NaN; } })());
    return code === 200 ? 'aceita' : code === 401 || code === 403 ? 'recusada' : 'sem_resposta';
  }
  return res.ok || request.aceita.includes(res.status) ? 'aceita' : 'sem_resposta';
}

// A request at no cost. fal has no public key-check route: the status of a request that does not exist answers 404 with
// an accepted key and 401/403 with a rejected one.
function checkRequest(env: Env, p: Provider, key: string): { url: string; headers: Record<string, string>; recusa: number[]; aceita: number[] } {
  switch (p) {
    case 'deepseek':
      return { url: env.DEEPSEEK_URL ? env.DEEPSEEK_URL.replace(/\/chat\/completions$/, '/models') : 'https://api.deepseek.com/models', headers: { authorization: `Bearer ${key}` }, recusa: [401, 403], aceita: [] };
    case 'gemini':
      return { url: `${env.GEMINI_URL ? env.GEMINI_URL.replace(/\/$/, '') : 'https://generativelanguage.googleapis.com'}/v1beta/models?pageSize=1`, headers: { 'x-goog-api-key': key }, recusa: [400, 401, 403], aceita: [] };
    case 'anthropic':
      return { url: `${env.SEGUNDA_URL ? env.SEGUNDA_URL.replace(/\/$/, '') : 'https://api.anthropic.com'}/v1/models?limit=1`, headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, recusa: [401, 403], aceita: [] };
    case 'kie':
      return { url: `${env.KIE_URL ? env.KIE_URL.replace(/\/$/, '') : 'https://api.kie.ai'}/api/v1/chat/credit`, headers: { authorization: `Bearer ${key}` }, recusa: [401, 403], aceita: [] };
    case 'fal':
      return {
        url: `${env.FAL_URL ? env.FAL_URL.replace(/\/$/, '') : 'https://queue.fal.run'}/${PROVIDERS.fal.modelo.split('/').slice(0, 2).join('/')}/requests/00000000-0000-0000-0000-000000000000/status`,
        headers: { authorization: `Key ${key}` }, recusa: [401, 403], aceita: [404],
      };
  }
}

// ── the AI keys tab ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Shortest key accepted: below this, the last 4 characters would say too much about it. */
export const KEY_MIN = 16;
export const KEY_MAX = 400;

/**
 * What the tab shows: for each provider, whether the outlet has a key (the last 4 and when it was saved) and whether the
 * server has one; the text and image choice; and what is in use right now for each feature. The key never leaves here.
 */
export async function keysState(env: Env, tenantId: string) {
  const [{ results }, keys] = await Promise.all([
    env.DB.prepare('SELECT provedor, final, salva_em FROM chaves_ia WHERE tenant_id = ?').bind(tenantId).all<{ provedor: string; final: string; salva_em: string }>(),
    fromOutletKeys(env, tenantId),
  ]);
  const inUse = <P extends Provider>(c: UsedKey<P> | null) => (c ? { provedor: c.provedor, origem: c.origem } : null);
  return {
    provedores: PROVIDERS_IDS.map((id) => {
      const v = results.find((r) => r.provedor === id);
      return { id, veiculo: v ? { final: v.final, salvaEm: v.salva_em } : null, servidor: !!fromServerKey(env, id) };
    }),
    escolha: keys.escolha,
    emUso: { texto: inUse(keys.texto), segunda: inUse(keys.segunda), imagem: inUse(keys.imagem) },
  };
}
export type KeysState = Awaited<ReturnType<typeof keysState>>;

/** Can the outlet use the provider (its own key or the server's)? The text and image choice requires it. */
export async function hasKey(env: Env, tenantId: string, p: Provider) {
  if (fromServerKey(env, p)) return true;
  return !!(await env.DB.prepare('SELECT 1 AS x FROM chaves_ia WHERE tenant_id = ? AND provedor = ?').bind(tenantId, p).first());
}
