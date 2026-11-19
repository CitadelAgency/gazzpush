// Daily digest: the best news of the last 24 hours in one carousel, with one card per story and each one's source. The
// 18:00 Brasília cron and the "Summarize the day" button call the same function.
import type { Env } from '../env';
import { recordEvent } from './db';
import { todayIso } from './lai';
import { produceLead } from './produce';
import { textsContent, fromOutletLanguage } from './contentLanguage';

export const MIN_SUMMARY = 3;
export const MAX_SUMMARY = 5;

export type ResultSummary = { situacao: 'nova'; pautaId: string; pecaId: string | null } | { situacao: 'ja_existe'; pautaId: string } | { situacao: 'poucas'; encontradas: number };

/** Id derived from the outlet and the day: the same day never yields two digests, from the cron, the button or a redelivery. */
export const summaryId = (tenantId: string, day: string) => `resumo:${tenantId}:${day}`;

export async function buildSummary(env: Env, tenantId: string, day = todayIso(), actor = 'sistema'): Promise<ResultSummary> {
  const leadId = summaryId(tenantId, day);
  const exists = await env.DB.prepare('SELECT 1 AS x FROM pautas WHERE id = ? AND tenant_id = ?').bind(leadId, tenantId).first();
  if (exists) return { situacao: 'ja_existe', pautaId: leadId };

  // News only: advertising, corrections and digests have `tipo_post`.
  const { results } = await env.DB.prepare(
    `SELECT id, fato_ids_json, documento_ids_json FROM pautas
      WHERE tenant_id = ? AND tipo_post IS NULL AND status != 'descartada' AND created_at >= datetime('now', '-1 day')
      ORDER BY score DESC, created_at DESC LIMIT ?`,
  ).bind(tenantId, MAX_SUMMARY).all<{ id: string; fato_ids_json: string; documento_ids_json: string }>();
  if (results.length < MIN_SUMMARY) return { situacao: 'poucas', encontradas: results.length };

  const together = (k: 'fato_ids_json' | 'documento_ids_json') => JSON.stringify([...new Set(results.flatMap((r) => JSON.parse(r[k]) as string[]))]);
  const tenant = await env.DB.prepare('SELECT idioma FROM tenants WHERE id = ?').bind(tenantId).first<{ idioma: string | null }>();
  // The system title carries no date: a number outside the facts would fail the check. The date goes in the card's date field.
  const title = textsContent(fromOutletLanguage(tenant?.idioma)).resumoDoDia;
  const r = await env.DB.prepare(
    `INSERT OR IGNORE INTO pautas (id, tenant_id, status, origem, titulo, fato_ids_json, documento_ids_json, score, tipo_post) VALUES (?, ?, 'sugerida', 'resumo', ?, ?, ?, 0, 'resumo')`,
  ).bind(leadId, tenantId, title, together('fato_ids_json'), together('documento_ids_json')).run();
  if (!r.meta.changes) return { situacao: 'ja_existe', pautaId: leadId };

  await recordEvent(env, tenantId, 'resumo.criado', 'pauta', leadId, { dia: day, pautas: results.map((x) => x.id), por: actor }, `resumo:${tenantId}:${day}`);
  const p = await produceLead(env, tenantId, leadId, actor, 'carrossel');
  return { situacao: 'nova', pautaId: leadId, pecaId: p?.pecaId ?? null };
}

/** 18:00 Brasília cron: one message per outlet with the digest turned on. */
export async function enqueueSummaries(env: Env, day = todayIso()) {
  const { results } = await env.DB.prepare("SELECT id FROM tenants WHERE resumo_ligado = 1 AND modo != 'autoral'").all<{ id: string }>();
  for (let i = 0; i < results.length; i += 100) {
    await env.MONITOR_QUEUE.sendBatch(results.slice(i, i + 100).map((t) => ({ body: { tipo: 'resumo' as const, tenantId: t.id, dia: day } })));
  }
}
