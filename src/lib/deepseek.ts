import type { Env } from '../env';
import type { UsedKey } from './providers';
import { PROVIDERS } from './providersTable';
import { recordUsage, type WhereUsage } from './usage';

/**
 * DeepSeek through the AI Gateway (logs, cost, cache) when configured; straight to the API in dev. Same path as
 * drafting. `DEEPSEEK_URL` swaps the address (e2e points it at a local fake model: `npm run dev:e2e`).
 */
export const urlDeepseek = (env: Env) => env.DEEPSEEK_URL ? env.DEEPSEEK_URL : env.AI_GATEWAY_ID
  ? `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.AI_GATEWAY_ID}/deepseek/chat/completions`
  : 'https://api.deepseek.com/chat/completions';

const { modelo: MODEL, preco: PRICE } = PROVIDERS.deepseek;

/**
 * The body of every call: JSON mode and reasoning off. With reasoning on (deepseek-flash's default) it ignores
 * `temperature` and spends more tokens.
 */
export const deepseekBody = (system: string, user: string, temperature: number) => JSON.stringify({
  model: MODEL, thinking: { type: 'disabled' }, response_format: { type: 'json_object' }, temperature,
  messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
});

/**
 * At peak the price doubles: Monday to Friday, 01:00–04:00 and 06:00–10:00 UTC. Chinese holidays are off-peak in the
 * price table and are not handled here: on those days the recorded cost comes out higher, never lower.
 */
export const peakDeepseek = (now: Date) => {
  const day = now.getUTCDay(), hour = now.getUTCHours();
  return day >= 1 && day <= 5 && ((hour >= 1 && hour < 4) || (hour >= 6 && hour < 10));
};

/** Cost of one call in US$. `entrada` is only the new input: what came from the cache goes in `cacheLido`. */
export const deepseekCost = (u: { entrada: number; saida: number; cacheLido?: number }, now = new Date()) =>
  (peakDeepseek(now) ? 2 : 1) * (u.entrada * PRICE.entrada + (u.cacheLido ?? 0) * PRICE.cacheLido + u.saida * PRICE.saida) / 1_000_000;

/** One DeepSeek call in JSON mode, with the key already resolved (src/lib/textModel.ts chooses). Returns the reply JSON
 *  and the cost. */
export async function callDeepseek(env: Env, where: WhereUsage, key: UsedKey, system: string, user: string, temperature = 0): Promise<{ json: unknown; custoUsd: number; uso: { entrada: number; saida: number; cacheLido: number; cacheEscrito: number } }> {
  const res = await fetch(urlDeepseek(env), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key.chave}` },
    body: deepseekBody(system, user, temperature),
    signal: AbortSignal.timeout(90_000),
  });
  // Status only: a rejected-key response echoes part of the key, and this error goes to logs and events.
  if (!res.ok) { await res.body?.cancel(); throw new Error(`deepseek ${res.status}`); }
  const data = await res.json<{ choices: { message: { content: string } }[]; usage?: { prompt_tokens: number; completion_tokens: number; prompt_cache_hit_tokens?: number } }>();
  const u = data.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
  // The repeated prefix (dossier and full text) comes from DeepSeek's cache, cheaper than new input.
  const cache = Math.min(u.prompt_cache_hit_tokens ?? 0, u.prompt_tokens);
  const usage = { entrada: u.prompt_tokens - cache, saida: u.completion_tokens, cacheLido: cache, cacheEscrito: 0 };
  const costUsd = deepseekCost(usage);
  // Before reading the reply: if it is malformed, the call has already been paid for.
  await recordUsage(env, where, { modelo: MODEL, ...usage, custoUsd: costUsd, origem: key.origem });
  return { json: JSON.parse(data.choices[0].message.content), custoUsd: costUsd, uso: usage };
}
