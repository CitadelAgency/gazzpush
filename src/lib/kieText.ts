import type { Env } from '../env';
import { baseKie, type UsedKey } from './providers';
import { KIE_TEXT } from './providersTable';
import { recordUsage, type WhereUsage } from './usage';

const { modelo: MODEL, rota: ROUTE, preco: PRICE } = KIE_TEXT;

interface KieChatAnswer {
  code?: unknown;
  error?: unknown;
  choices?: { message?: { content?: string | { type?: string; text?: string }[] } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

/** Strips an optional ```json ... ``` wrapper if a proxy returns fenced JSON. */
export function unwrapJson(raw: string) {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : trimmed;
}

/**
 * Text call through Kie.ai (OpenAI-compatible Gemini Flash route), used only when the outlet explicitly opts into
 * Kie.ai for text instead of separate BYOK keys. Same JSON contract as DeepSeek and Gemini; every answer still passes
 * the caller's deterministic code check. `KIE_URL` swaps the API base in tests.
 */
export async function callKieText(
  env: Env,
  where: WhereUsage,
  key: UsedKey,
  system: string,
  user: string,
  temperature = 0,
): Promise<{ json: unknown; custoUsd: number; uso: { entrada: number; saida: number; cacheLido: number; cacheEscrito: number } }> {
  const res = await fetch(`${baseKie(env)}/${ROUTE}/v1/chat/completions`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key.chave}` },
    body: JSON.stringify({
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      response_format: { type: 'json_object' },
      temperature,
      stream: false,
    }),
    signal: AbortSignal.timeout(90_000),
  });
  // Status only: a rejected-key response can echo part of the key, and this error goes to logs and events.
  if (!res.ok) { await res.body?.cancel(); throw new Error(`kie text ${res.status}`); }
  const data = await res.json<KieChatAnswer>();
  // Kie often returns HTTP 200 with a JSON code (e.g. 402 out of credit); keep provider messages out of logs.
  if (data.code !== undefined && Number(data.code) !== 200) throw new Error(`kie text refused: code ${data.code}`);
  if (data.error) throw new Error('kie text error');

  const u = data.usage ?? {};
  const promptTokens = u.prompt_tokens ?? 0;
  const cache = Math.min(u.prompt_tokens_details?.cached_tokens ?? 0, promptTokens);
  const usage = { entrada: promptTokens - cache, saida: u.completion_tokens ?? 0, cacheLido: cache, cacheEscrito: 0 };
  const costUsd = (usage.entrada * PRICE.entrada + cache * PRICE.cacheLido + usage.saida * PRICE.saida) / 1_000_000;
  // Before reading the reply: if it is malformed, the call has already been paid for.
  await recordUsage(env, where, { modelo: MODEL, ...usage, custoUsd: costUsd, origem: key.origem });

  const content = data.choices?.[0]?.message?.content;
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.filter((p) => typeof p?.text === 'string').map((p) => p.text).join('')
      : '';
  if (!text.trim()) throw new Error('kie text returned no content');
  return { json: JSON.parse(unwrapJson(text)), custoUsd: costUsd, uso: usage };
}
