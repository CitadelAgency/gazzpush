import type { Env } from '../env';
import { baseGemini, type UsedKey } from './providers';
import { PROVIDERS } from './providersTable';
import { recordUsage, type WhereUsage } from './usage';

const { modelo: MODEL, preco: PRICE } = PROVIDERS.gemini;

interface GeminiAnswer {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number; thoughtsTokenCount?: number };
}

/**
 * Gemini in place of DeepSeek, with the same contract: the same system prompt and request, a JSON reply
 * (responseMimeType), and the JSON goes back through the caller's same code check. generateContent through the AI
 * Gateway (google-ai-studio) when configured; the key only goes in the x-goog-api-key header, never in the URL.
 * `GEMINI_URL` swaps the address in tests.
 */
export async function callGemini(env: Env, where: WhereUsage, key: UsedKey, system: string, user: string, temperature = 0): Promise<{ json: unknown; custoUsd: number; uso: { entrada: number; saida: number; cacheLido: number; cacheEscrito: number } }> {
  const res = await fetch(`${baseGemini(env)}/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key.chave },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { responseMimeType: 'application/json', temperature },
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) { await res.body?.cancel(); throw new Error(`gemini ${res.status}`); }
  const data = await res.json<GeminiAnswer>();
  const u = data.usageMetadata ?? {};
  // promptTokenCount already includes what came from the cache; billed output includes reasoning.
  const cache = Math.min(u.cachedContentTokenCount ?? 0, u.promptTokenCount ?? 0);
  const usage = { entrada: (u.promptTokenCount ?? 0) - cache, saida: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0), cacheLido: cache, cacheEscrito: 0 };
  const costUsd = (usage.entrada * PRICE.entrada + cache * PRICE.cacheLido + usage.saida * PRICE.saida) / 1_000_000;
  // Before reading the reply: if it is malformed, the call has already been paid for.
  await recordUsage(env, where, { modelo: MODEL, ...usage, custoUsd: costUsd, origem: key.origem });
  if (data.promptFeedback?.blockReason) throw new Error(`gemini blocked the request: ${data.promptFeedback.blockReason}`);
  const candidate = data.candidates?.[0];
  const text = (candidate?.content?.parts ?? []).filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
  if (!text) throw new Error(`gemini returned no text: ${candidate?.finishReason ?? 'no candidate'}`);
  return { json: JSON.parse(text), custoUsd: costUsd, uso: usage };
}
