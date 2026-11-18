import Anthropic from '@anthropic-ai/sdk';
import type { Env } from '../env';
import { chavesDoVeiculo, type ChavesVeiculo } from './provedores';
import { PRECOS_CLAUDE, PROVEDORES } from './provedoresTabela';
import { registrarUso, type OndeUso } from './uso';

/**
 * Segundo fornecedor da conferência (Anthropic, pelo AI Gateway): confere sozinho o texto de tema que modelos chineses
 * suavizam (desvio por tema) e dá a segunda opinião em risco jurídico e acusação. Sem a chave Anthropic do veículo nem a do
 * servidor (`ANTHROPIC_API_KEY`), desligado: a conferência segue com uma opinião só e a tela diz isso. `SEGUNDA_MODELO` troca o modelo (padrão: Claude Opus 5.5);
 * `SEGUNDA_URL` troca o endereço (o e2e aponta para o modelo falso local).
 */
export const segundaLigada = (chaves: ChavesVeiculo) => !!chaves.segunda;
export const modeloSegunda = (env: Env) => env.SEGUNDA_MODELO || PROVEDORES.anthropic.modelo;

const baseSegunda = (env: Env) => env.SEGUNDA_URL ? env.SEGUNDA_URL : env.AI_GATEWAY_ID
  ? `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.AI_GATEWAY_ID}/anthropic`
  : undefined;

/** O mesmo formato que o DeepSeek devolve (resolverConferencia confere cada trecho por código do mesmo jeito). */
const ESQUEMA = {
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

export class ErroSegunda extends Error {}

export interface Uso { entrada: number; saida: number; cacheLido: number; cacheEscrito: number }

/**
 * Uma conferência de bloco no segundo fornecedor. `prefixo` (dossiê e texto inteiro, igual em todos os blocos) vai em
 * cache; `bloco` no fim. Recusa ou resposta fora do formato: erro (quem chama mostra, nunca some calado).
 */
export async function chamarSegunda(env: Env, onde: OndeUso, system: string, prefixo: string, bloco: string, esquema: Record<string, unknown> = ESQUEMA): Promise<{ json: unknown; custoUsd: number; uso: Uso }> {
  const modelo = modeloSegunda(env);
  const chave = (onde.chaves ?? await chavesDoVeiculo(env, onde.tenantId)).segunda;
  if (!chave) throw new ErroSegunda('sem chave');
  const cliente = new Anthropic({
    apiKey: chave.chave, baseURL: baseSegunda(env), maxRetries: 1, timeout: 90_000,
    // O fetch do momento da chamada (os testes trocam o global).
    fetch: (input, init) => globalThis.fetch(input, init),
  });
  // Opus e Sonnet: recusa de classificador refeita no modelo que a Anthropic indica para a categoria.
  const fallback = /opus|sonnet/.test(modelo);
  let r: Anthropic.Beta.BetaMessage;
  try {
    r = await cliente.beta.messages.create({
      model: modelo,
      max_tokens: 16_000,
      system,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: esquema } },
      messages: [{ role: 'user', content: [{ type: 'text', text: prefixo, cache_control: { type: 'ephemeral' } }, { type: 'text', text: bloco }] }],
      ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    });
  } catch (e) {
    // Só o status: a mensagem do provedor pode ecoar parte da chave.
    if (e instanceof Anthropic.APIError) throw new ErroSegunda(`anthropic ${e.status ?? 'sem resposta'}`);
    throw e;
  }
  const u = r.usage;
  const uso: Uso = { entrada: u.input_tokens, saida: u.output_tokens, cacheLido: u.cache_read_input_tokens ?? 0, cacheEscrito: u.cache_creation_input_tokens ?? 0 };
  const [pe, ps, pl, pw] = PRECOS_CLAUDE[modelo] ?? PRECOS_CLAUDE[PROVEDORES.anthropic.modelo];
  const custoUsd = (uso.entrada * pe + uso.saida * ps + uso.cacheLido * pl + uso.cacheEscrito * pw) / 1_000_000;
  if (r.stop_reason === 'refusal') throw new ErroSegunda('recusa');
  await registrarUso(env, onde, { modelo, ...uso, custoUsd, origem: chave.origem });
  const texto = r.content.find((b) => b.type === 'text');
  if (!texto || texto.type !== 'text') throw new ErroSegunda('sem texto');
  try {
    return { json: JSON.parse(texto.text), custoUsd, uso };
  } catch {
    throw new ErroSegunda('json inválido');
  }
}
