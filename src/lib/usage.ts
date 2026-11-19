// Model usage (DeepSeek, Claude and Kie): each call becomes a row in `uso_modelo`, and the owner's internal dashboard
// reads from here. Workers AI (Whisper, triage, image QA, embeddings) does not report tokens and is left out. The cost is
// the estimate from the price table in code, not the invoice. Recording never brings the product down: the caller
// already has the model's reply.
import type { Env } from '../env';
import { PLANS, type Plan } from './plansTable';
import type { OutletKeys, KeyOrigin } from './providers';

export type FunctionUsage = 'conferencia' | 'post' | 'ajuste' | 'gancho' | 'pergunta_documento' | 'divulgacao' | 'segunda_leitura' | 'ilustracao';
/**
 * Who paid for the call and what for. `chaves`: the outlet's keys already resolved (whoever makes several calls in the
 * same operation resolves them once); without them, each call resolves its own.
 */
export interface WhereUsage { tenantId: string; funcao: FunctionUsage; chaves?: OutletKeys }
/** `origem`: whose key it was (default: the server's, the owner's account). */
export interface UsageCall { modelo: string; entrada?: number; saida?: number; cacheLido?: number; cacheEscrito?: number; custoUsd: number; origem?: KeyOrigin }

export async function recordUsage(env: Env, where: WhereUsage, c: UsageCall) {
  try {
    await env.DB.prepare('INSERT INTO uso_modelo (tenant_id, funcao, modelo, entrada, saida, cache_lido, cache_escrito, custo_usd, chave) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(where.tenantId, where.funcao, c.modelo, c.entrada ?? 0, c.saida ?? 0, c.cacheLido ?? 0, c.cacheEscrito ?? 0, c.custoUsd, c.origem ?? 'servidor').run();
  } catch (e) {
    console.error('uso_modelo', where.funcao, String(e).slice(0, 200));
  }
}

export const PERIODS_USAGE = [1, 7, 30] as const;
export type PeriodUsage = (typeof PERIODS_USAGE)[number];
// `custo_veiculo_usd`: the part paid with the outlet's own key (it does not come out of the owner's account).
const SUMS = "COUNT(*) AS chamadas, COALESCE(SUM(entrada), 0) AS entrada, COALESCE(SUM(saida), 0) AS saida, COALESCE(SUM(cache_lido + cache_escrito), 0) AS cache, COALESCE(SUM(custo_usd), 0) AS custo_usd, COALESCE(SUM(CASE WHEN chave = 'veiculo' THEN custo_usd END), 0) AS custo_veiculo_usd";
interface Sums { chamadas: number; entrada: number; saida: number; cache: number; custo_usd: number; custo_veiculo_usd: number }
const sums = ({ chamadas: calls, entrada: input, saida: output, cache, custo_usd: cost_usd, custo_veiculo_usd: outlet_cost_usd }: Sums) => ({ chamadas: calls, entrada: input, saida: output, cache, tokens: input + output + cache, custoUsd: cost_usd, custoVeiculoUsd: outlet_cost_usd });

/** Usage for the period (`dias` = 1 is today), with days counted in Brasília time. */
export async function panelUsage(env: Env, days: PeriodUsage) {
  const since = `datetime(date('now', '-3 hours', '-${days - 1} days'), '+3 hours')`;   // `dias` comes from PERIODS_USAGE, never from the raw URL
  const [totals, outlets, functions, perDay, last, home] = await env.DB.batch([
    env.DB.prepare(`SELECT ${SUMS} FROM uso_modelo WHERE created_at >= ${since}`),
    env.DB.prepare(`SELECT u.tenant_id AS id, COALESCE(t.nome, u.tenant_id) AS nome, t.plano, ${SUMS} FROM uso_modelo u LEFT JOIN tenants t ON t.id = u.tenant_id
      WHERE u.created_at >= ${since} GROUP BY u.tenant_id ORDER BY custo_usd DESC`),
    env.DB.prepare(`SELECT funcao, ${SUMS} FROM uso_modelo WHERE created_at >= ${since} GROUP BY funcao ORDER BY custo_usd DESC`),
    env.DB.prepare(`SELECT date(created_at, '-3 hours') AS dia, ${SUMS} FROM uso_modelo WHERE created_at >= ${since} GROUP BY dia ORDER BY dia DESC`),
    env.DB.prepare(`SELECT u.id, COALESCE(t.nome, u.tenant_id) AS veiculo, u.funcao, u.modelo, u.entrada + u.saida + u.cache_lido + u.cache_escrito AS tokens, u.custo_usd, u.chave, u.created_at
      FROM uso_modelo u LEFT JOIN tenants t ON t.id = u.tenant_id WHERE u.created_at >= ${since} ORDER BY u.id DESC LIMIT 20`),
    env.DB.prepare('SELECT MIN(created_at) AS em FROM uso_modelo'),
  ]);
  type Last = { id: number; veiculo: string; funcao: FunctionUsage; modelo: string; tokens: number; custo_usd: number; chave: KeyOrigin; created_at: string };
  return {
    dias: days,
    registrandoDesde: (home.results[0] as { em: string | null }).em,
    totais: sums(totals.results[0] as unknown as Sums),
    veiculos: (outlets.results as unknown as (Sums & { id: string; nome: string; plano: string | null })[]).map((v) => ({
      id: v.id, nome: v.nome, plano: v.plano, precoReais: v.plano && v.plano in PLANS ? PLANS[v.plano as Plan].precoReais : null, ...sums(v),
    })),
    funcoes: (functions.results as unknown as (Sums & { funcao: FunctionUsage })[]).map((f) => ({ funcao: f.funcao, ...sums(f) })),
    porDia: (perDay.results as unknown as (Sums & { dia: string })[]).map((d) => ({ dia: d.dia, ...sums(d) })),
    ultimas: (last.results as unknown as Last[]).map((u) => ({ id: u.id, veiculo: u.veiculo, funcao: u.funcao, modelo: u.modelo, tokens: u.tokens, custoUsd: u.custo_usd, chave: u.chave, em: u.created_at })),
  };
}
