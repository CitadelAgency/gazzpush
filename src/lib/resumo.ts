// Resumo do dia: as melhores notícias das últimas 24 horas num carrossel, com um card por notícia e a fonte de cada uma.
// O cron das 18h de Brasília e o botão "Resumir o dia" chamam a mesma função.
import type { Env } from '../env';
import { registrarEvento } from './db';
import { hojeISO } from './lai';
import { produzirPauta } from './produzir';
import { textosConteudo, idiomaDoVeiculo } from './idiomaConteudo';

export const MIN_RESUMO = 3;
export const MAX_RESUMO = 5;

export type ResultadoResumo = { situacao: 'nova'; pautaId: string; pecaId: string | null } | { situacao: 'ja_existe'; pautaId: string } | { situacao: 'poucas'; encontradas: number };

/** Id derivado do veículo e do dia: o mesmo dia não gera dois resumos, venha do cron, do botão ou de uma reentrega. */
export const idResumo = (tenantId: string, dia: string) => `resumo:${tenantId}:${dia}`;

export async function montarResumo(env: Env, tenantId: string, dia = hojeISO(), por = 'sistema'): Promise<ResultadoResumo> {
  const pautaId = idResumo(tenantId, dia);
  const existe = await env.DB.prepare('SELECT 1 AS x FROM pautas WHERE id = ? AND tenant_id = ?').bind(pautaId, tenantId).first();
  if (existe) return { situacao: 'ja_existe', pautaId };

  // Só notícia: publicidade, correção e resumo têm `tipo_post`.
  const { results } = await env.DB.prepare(
    `SELECT id, fato_ids_json, documento_ids_json FROM pautas
      WHERE tenant_id = ? AND tipo_post IS NULL AND status != 'descartada' AND created_at >= datetime('now', '-1 day')
      ORDER BY score DESC, created_at DESC LIMIT ?`,
  ).bind(tenantId, MAX_RESUMO).all<{ id: string; fato_ids_json: string; documento_ids_json: string }>();
  if (results.length < MIN_RESUMO) return { situacao: 'poucas', encontradas: results.length };

  const juntos = (k: 'fato_ids_json' | 'documento_ids_json') => JSON.stringify([...new Set(results.flatMap((r) => JSON.parse(r[k]) as string[]))]);
  const tenant = await env.DB.prepare('SELECT idioma FROM tenants WHERE id = ?').bind(tenantId).first<{ idioma: string | null }>();
  // O título do sistema não leva data: número fora dos fatos cairia na conferência. A data vai no campo de data do card.
  const titulo = textosConteudo(idiomaDoVeiculo(tenant?.idioma)).resumoDoDia;
  const r = await env.DB.prepare(
    `INSERT OR IGNORE INTO pautas (id, tenant_id, status, origem, titulo, fato_ids_json, documento_ids_json, score, tipo_post) VALUES (?, ?, 'sugerida', 'resumo', ?, ?, ?, 0, 'resumo')`,
  ).bind(pautaId, tenantId, titulo, juntos('fato_ids_json'), juntos('documento_ids_json')).run();
  if (!r.meta.changes) return { situacao: 'ja_existe', pautaId };

  await registrarEvento(env, tenantId, 'resumo.criado', 'pauta', pautaId, { dia, pautas: results.map((x) => x.id), por }, `resumo:${tenantId}:${dia}`);
  const p = await produzirPauta(env, tenantId, pautaId, por, 'carrossel');
  return { situacao: 'nova', pautaId, pecaId: p?.pecaId ?? null };
}

/** Cron das 18h de Brasília: uma mensagem por veículo com o resumo ligado. */
export async function enfileirarResumos(env: Env, dia = hojeISO()) {
  const { results } = await env.DB.prepare("SELECT id FROM tenants WHERE resumo_ligado = 1 AND modo != 'autoral'").all<{ id: string }>();
  for (let i = 0; i < results.length; i += 100) {
    await env.MONITOR_QUEUE.sendBatch(results.slice(i, i + 100).map((t) => ({ body: { tipo: 'resumo' as const, tenantId: t.id, dia } })));
  }
}
