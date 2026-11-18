import type { Env } from '../env';
import type { ChaveUsada } from './provedores';
import { PROVEDORES } from './provedoresTabela';
import { registrarUso, type OndeUso } from './uso';

/**
 * DeepSeek pelo AI Gateway (log, custo, cache) quando configurado; direto na API em dev. Mesmo caminho da redação.
 * `DEEPSEEK_URL` troca o endereço do serviço.
 */
export const urlDeepseek = (env: Env) => env.DEEPSEEK_URL ? env.DEEPSEEK_URL : env.AI_GATEWAY_ID
  ? `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.AI_GATEWAY_ID}/deepseek/chat/completions`
  : 'https://api.deepseek.com/chat/completions';

const { modelo: MODELO, preco: PRECO } = PROVEDORES.deepseek;

/** Uma chamada ao DeepSeek em modo JSON, com a chave resolvida (src/lib/texto.ts escolhe). Devolve o JSON da resposta e o custo. */
export async function chamarDeepseek(env: Env, onde: OndeUso, chave: ChaveUsada, system: string, user: string, temperature = 0): Promise<{ json: unknown; custoUsd: number; uso: { entrada: number; saida: number; cacheLido: number; cacheEscrito: number } }> {
  const res = await fetch(urlDeepseek(env), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${chave.chave}` },
    body: JSON.stringify({
      model: MODELO, response_format: { type: 'json_object' }, temperature,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(90_000),
  });
  // Só o status: a resposta de chave recusada ecoa parte da chave, e este erro vai para log e evento.
  if (!res.ok) { await res.body?.cancel(); throw new Error(`deepseek ${res.status}`); }
  const data = await res.json<{ choices: { message: { content: string } }[]; usage?: { prompt_tokens: number; completion_tokens: number; prompt_cache_hit_tokens?: number } }>();
  const u = data.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
  // O prefixo repetido (dossiê e texto inteiro) sai do cache do DeepSeek, mais barato que a entrada nova.
  const cache = Math.min(u.prompt_cache_hit_tokens ?? 0, u.prompt_tokens);
  const uso = { entrada: u.prompt_tokens - cache, saida: u.completion_tokens, cacheLido: cache, cacheEscrito: 0 };
  const custoUsd = (uso.entrada * PRECO.entrada + cache * PRECO.cacheLido + uso.saida * PRECO.saida) / 1_000_000;
  // Antes de ler a resposta: fora do formato, a chamada já foi paga.
  await registrarUso(env, onde, { modelo: MODELO, ...uso, custoUsd, origem: chave.origem });
  return { json: JSON.parse(data.choices[0].message.content), custoUsd, uso };
}
