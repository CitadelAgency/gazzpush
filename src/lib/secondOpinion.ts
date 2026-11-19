import Anthropic from '@anthropic-ai/sdk';
import type { Env } from '../env';
import { fromOutletKeys, type OutletKeys } from './providers';
import { PRICES_CLAUDE, PROVIDERS } from './providersTable';
import { recordUsage, type WhereUsage } from './usage';

/**
 * Second check provider (Anthropic, through the AI Gateway): checks on its own the topic text that Chinese models soften
 * (topic bias) and gives the second opinion on legal risk and accusations. Without the outlet's or the server's Anthropic
 * key (`ANTHROPIC_API_KEY`), it is off: the check carries on with a single opinion and the screen says so.
 * `SEGUNDA_MODELO` swaps the model (default: Claude Opus 5.5); `SEGUNDA_URL` swaps the address (e2e points it at the
 * local fake model).
 */
export const secondOn = (keys: OutletKeys) => !!keys.segunda;
export const secondModel = (env: Env) => env.SEGUNDA_MODELO || PROVIDERS.anthropic.modelo;

const baseSecond = (env: Env) => env.SEGUNDA_URL ? env.SEGUNDA_URL : env.AI_GATEWAY_ID
  ? `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.AI_GATEWAY_ID}/anthropic`
  : undefined;

/** The same shape DeepSeek returns (resolveCheck checks each passage by code the same way). */
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['afirmacoes'],
  properties: {
    afirmacoes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['paragrafo', 'trecho', 'estado', 'risco', 'evidencia', 'trecho_evidencia', 'explicacao'],
        properties: {
          paragrafo: { type: 'integer' },
          trecho: { type: 'string' },
          estado: { type: 'string', enum: ['com_evidencia', 'sem_fonte', 'risco'] },
          risco: { anyOf: [{ type: 'string', enum: ['acusacao_sem_condenacao', 'vitima_ou_menor', 'sem_outro_lado'] }, { type: 'null' }] },
          evidencia: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          trecho_evidencia: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          explicacao: { type: 'string' },
        },
      },
    },
  },
};

export class SecondError extends Error {}

export interface Usage { entrada: number; saida: number; cacheLido: number; cacheEscrito: number }

/**
 * One block check on the second provider. `prefixo` (dossier and full text, the same in every block) is cached; `bloco`
 * goes at the end. A refusal or a malformed reply is an error (the caller shows it; it never disappears silently).
 */
export async function callSecond(env: Env, where: WhereUsage, system: string, prefix: string, block: string, schema: Record<string, unknown> = SCHEMA): Promise<{ json: unknown; custoUsd: number; uso: Usage }> {
  const model = secondModel(env);
  const key = (where.chaves ?? await fromOutletKeys(env, where.tenantId)).segunda;
  if (!key) throw new SecondError('sem chave');
  const client = new Anthropic({
    apiKey: key.chave, baseURL: baseSecond(env), maxRetries: 1, timeout: 90_000,
    // The fetch at call time (tests swap the global).
    fetch: (input, init) => globalThis.fetch(input, init),
  });
  // Opus and Sonnet: a classifier refusal is retried on the model Anthropic indicates for the category.
  const fallback = /opus|sonnet/.test(model);
  let r: Anthropic.Beta.BetaMessage;
  try {
    r = await client.beta.messages.create({
      model: model,
      max_tokens: 16_000,
      system,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: schema } },
      messages: [{ role: 'user', content: [{ type: 'text', text: prefix, cache_control: { type: 'ephemeral' } }, { type: 'text', text: block }] }],
      ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    });
  } catch (e) {
    // Status only: the provider's message can echo part of the key.
    if (e instanceof Anthropic.APIError) throw new SecondError(`anthropic ${e.status ?? 'sem resposta'}`);
    throw e;
  }
  const u = r.usage;
  const usage: Usage = { entrada: u.input_tokens, saida: u.output_tokens, cacheLido: u.cache_read_input_tokens ?? 0, cacheEscrito: u.cache_creation_input_tokens ?? 0 };
  const [foot, ps, pl, pw] = PRICES_CLAUDE[model] ?? PRICES_CLAUDE[PROVIDERS.anthropic.modelo];
  const costUsd = (usage.entrada * foot + usage.saida * ps + usage.cacheLido * pl + usage.cacheEscrito * pw) / 1_000_000;
  if (r.stop_reason === 'refusal') throw new SecondError('recusa');
  await recordUsage(env, where, { modelo: model, ...usage, custoUsd: costUsd, origem: key.origem });
  const text = r.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') throw new SecondError('sem texto');
  try {
    return { json: JSON.parse(text.text), custoUsd: costUsd, uso: usage };
  } catch {
    throw new SecondError('json inválido');
  }
}
