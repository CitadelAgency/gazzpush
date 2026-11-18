import type { Env } from '../env';
import { baseGemini, type ChaveUsada } from './provedores';
import { PROVEDORES } from './provedoresTabela';
import { registrarUso, type OndeUso } from './uso';

const { modelo: MODELO, preco: PRECO } = PROVEDORES.gemini;

interface RespostaGemini {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number; thoughtsTokenCount?: number };
}

/**
 * Gemini no lugar do DeepSeek, com o mesmo contrato: o mesmo system e o mesmo pedido, resposta em JSON (responseMimeType),
 * e o JSON volta para a mesma conferência por código de quem chamou. generateContent pelo AI Gateway (google-ai-studio)
 * quando configurado; a chave vai só no cabeçalho x-goog-api-key, nunca na URL. `GEMINI_URL` troca o endereço no teste.
 */
export async function chamarGemini(env: Env, onde: OndeUso, chave: ChaveUsada, system: string, user: string, temperature = 0): Promise<{ json: unknown; custoUsd: number; uso: { entrada: number; saida: number; cacheLido: number; cacheEscrito: number } }> {
  const res = await fetch(`${baseGemini(env)}/v1beta/models/${MODELO}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': chave.chave },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { responseMimeType: 'application/json', temperature },
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) { await res.body?.cancel(); throw new Error(`gemini ${res.status}`); }
  const data = await res.json<RespostaGemini>();
  const u = data.usageMetadata ?? {};
  // promptTokenCount já inclui o que veio do cache; a saída cobrada inclui o raciocínio.
  const cache = Math.min(u.cachedContentTokenCount ?? 0, u.promptTokenCount ?? 0);
  const uso = { entrada: (u.promptTokenCount ?? 0) - cache, saida: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0), cacheLido: cache, cacheEscrito: 0 };
  const custoUsd = (uso.entrada * PRECO.entrada + cache * PRECO.cacheLido + uso.saida * PRECO.saida) / 1_000_000;
  // Antes de ler a resposta: fora do formato, a chamada já foi paga.
  await registrarUso(env, onde, { modelo: MODELO, ...uso, custoUsd, origem: chave.origem });
  if (data.promptFeedback?.blockReason) throw new Error(`gemini bloqueou o pedido: ${data.promptFeedback.blockReason}`);
  const candidato = data.candidates?.[0];
  const texto = (candidato?.content?.parts ?? []).filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
  if (!texto) throw new Error(`gemini sem texto: ${candidato?.finishReason ?? 'sem candidato'}`);
  return { json: JSON.parse(texto), custoUsd, uso };
}
