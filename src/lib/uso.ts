// Consumo dos modelos (DeepSeek, Claude e Kie): cada chamada vira uma linha em `uso_modelo`, e o painel interno do dono lê daqui.
// Workers AI (Whisper, triagem, QA da imagem, embeddings) não informa tokens e fica de fora. O custo é a estimativa da tabela de
// preços do código, não a fatura. Registrar nunca derruba o produto: quem chama já tem a resposta do modelo.
import type { Env } from '../env';
import { PLANOS, type Plano } from './planosTabela';
import type { ChavesVeiculo, OrigemChave } from './provedores';

export type FuncaoUso = 'conferencia' | 'post' | 'ajuste' | 'gancho' | 'pergunta_documento' | 'divulgacao' | 'segunda_leitura' | 'ilustracao';
/**
 * Quem pagou a chamada e para quê. `chaves`: as chaves do veículo já resolvidas (quem faz várias chamadas na mesma operação
 * resolve uma vez); sem elas, cada chamada resolve as suas.
 */
export interface OndeUso { tenantId: string; funcao: FuncaoUso; chaves?: ChavesVeiculo }
/** `origem`: de quem era a chave (padrão: a do servidor, a conta do dono). */
export interface ConsumoChamada { modelo: string; entrada?: number; saida?: number; cacheLido?: number; cacheEscrito?: number; custoUsd: number; origem?: OrigemChave }

export async function registrarUso(env: Env, onde: OndeUso, c: ConsumoChamada) {
  try {
    await env.DB.prepare('INSERT INTO uso_modelo (tenant_id, funcao, modelo, entrada, saida, cache_lido, cache_escrito, custo_usd, chave) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(onde.tenantId, onde.funcao, c.modelo, c.entrada ?? 0, c.saida ?? 0, c.cacheLido ?? 0, c.cacheEscrito ?? 0, c.custoUsd, c.origem ?? 'servidor').run();
  } catch (e) {
    console.error('uso_modelo', onde.funcao, String(e).slice(0, 200));
  }
}

export const PERIODOS_USO = [1, 7, 30] as const;
export type PeriodoUso = (typeof PERIODOS_USO)[number];
// `custo_veiculo_usd`: a parte paga com a chave do próprio veículo (não sai da conta do dono).
const SOMAS = "COUNT(*) AS chamadas, COALESCE(SUM(entrada), 0) AS entrada, COALESCE(SUM(saida), 0) AS saida, COALESCE(SUM(cache_lido + cache_escrito), 0) AS cache, COALESCE(SUM(custo_usd), 0) AS custo_usd, COALESCE(SUM(CASE WHEN chave = 'veiculo' THEN custo_usd END), 0) AS custo_veiculo_usd";
interface Somas { chamadas: number; entrada: number; saida: number; cache: number; custo_usd: number; custo_veiculo_usd: number }
const somas = ({ chamadas, entrada, saida, cache, custo_usd, custo_veiculo_usd }: Somas) => ({ chamadas, entrada, saida, cache, tokens: entrada + saida + cache, custoUsd: custo_usd, custoVeiculoUsd: custo_veiculo_usd });

/** O consumo do período (`dias` = 1 é hoje), com o dia contado no horário de Brasília. */
export async function painelDeUso(env: Env, dias: PeriodoUso) {
  const desde = `datetime(date('now', '-3 hours', '-${dias - 1} days'), '+3 hours')`;   // `dias` vem de PERIODOS_USO, nunca da URL crua
  const [totais, veiculos, funcoes, porDia, ultimas, inicio] = await env.DB.batch([
    env.DB.prepare(`SELECT ${SOMAS} FROM uso_modelo WHERE created_at >= ${desde}`),
    env.DB.prepare(`SELECT u.tenant_id AS id, COALESCE(t.nome, u.tenant_id) AS nome, t.plano, ${SOMAS} FROM uso_modelo u LEFT JOIN tenants t ON t.id = u.tenant_id
      WHERE u.created_at >= ${desde} GROUP BY u.tenant_id ORDER BY custo_usd DESC`),
    env.DB.prepare(`SELECT funcao, ${SOMAS} FROM uso_modelo WHERE created_at >= ${desde} GROUP BY funcao ORDER BY custo_usd DESC`),
    env.DB.prepare(`SELECT date(created_at, '-3 hours') AS dia, ${SOMAS} FROM uso_modelo WHERE created_at >= ${desde} GROUP BY dia ORDER BY dia DESC`),
    env.DB.prepare(`SELECT u.id, COALESCE(t.nome, u.tenant_id) AS veiculo, u.funcao, u.modelo, u.entrada + u.saida + u.cache_lido + u.cache_escrito AS tokens, u.custo_usd, u.chave, u.created_at
      FROM uso_modelo u LEFT JOIN tenants t ON t.id = u.tenant_id WHERE u.created_at >= ${desde} ORDER BY u.id DESC LIMIT 20`),
    env.DB.prepare('SELECT MIN(created_at) AS em FROM uso_modelo'),
  ]);
  type Ultima = { id: number; veiculo: string; funcao: FuncaoUso; modelo: string; tokens: number; custo_usd: number; chave: OrigemChave; created_at: string };
  return {
    dias,
    registrandoDesde: (inicio.results[0] as { em: string | null }).em,
    totais: somas(totais.results[0] as unknown as Somas),
    veiculos: (veiculos.results as unknown as (Somas & { id: string; nome: string; plano: string | null })[]).map((v) => ({
      id: v.id, nome: v.nome, plano: v.plano, precoReais: v.plano && v.plano in PLANOS ? PLANOS[v.plano as Plano].precoReais : null, ...somas(v),
    })),
    funcoes: (funcoes.results as unknown as (Somas & { funcao: FuncaoUso })[]).map((f) => ({ funcao: f.funcao, ...somas(f) })),
    porDia: (porDia.results as unknown as (Somas & { dia: string })[]).map((d) => ({ dia: d.dia, ...somas(d) })),
    ultimas: (ultimas.results as unknown as Ultima[]).map((u) => ({ id: u.id, veiculo: u.veiculo, funcao: u.funcao, modelo: u.modelo, tokens: u.tokens, custoUsd: u.custo_usd, chave: u.chave, em: u.created_at })),
  };
}
