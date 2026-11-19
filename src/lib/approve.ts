// Approving a piece: decision, account and publishing, in the same batch as the transition. Used by the review route and
// the autopilot.
import type { Env } from '../env';
import { newId } from './db';
import { startExecution, transition, type AccountMode } from '../kernel/states';
import { loadAccount } from './publish';
import { startPublication } from '../workflows/publishing';

/**
 * Statement for a decision's batch: aborts (like the `transitar` assertion) if the piece is no longer at the version the
 * decider saw, or if that version failed the check (an edit saved in the middle of the approval).
 */
export const guardVersionApprovable = (env: Env, tenantId: string, pieceId: string, version: number) => env.DB.prepare(
  `SELECT json(CASE WHEN EXISTS (SELECT 1 FROM pecas WHERE id = ? AND tenant_id = ? AND versao = ?
                                    AND COALESCE(json_extract(validacao_json, '$.ok'), 1) <> 0) THEN '1' ELSE 'versao_mudou' END)`,
).bind(pieceId, tenantId, version);

export interface PieceApprovable { id: string; pauta_id: string; versao: number; formato: string; validacao_ok: number | null }
export type Approval =
  | { ok: true; status: 'aprovada' | 'agendada'; modo: AccountMode; workflowId?: string; pendente?: true }
  | { ok: false; erro: 'conferencia' | 'data' | 'reels_intermediario' | 'conflito' };

/** `por`: the id of who approved, or `piloto`. `extra` goes into the decision payload. */
export async function approvePiece(env: Env, a: { tenantId: string; por: string; peca: PieceApprovable; contaId?: string; agendarPara?: string; extra?: Record<string, unknown> }): Promise<Approval> {
  const { tenantId, por: actor, peca: piece } = a;
  const pieceId = piece.id;
  // An edit that failed the check (sentence without a fact, number not in the source, text that does not fit): fix it first.
  if (piece.validacao_ok === 0) return { ok: false, erro: 'conferencia' };
  let scheduledTo: string | null = null;
  if (a.agendarPara) {
    const ts = Date.parse(a.agendarPara);
    if (!Number.isFinite(ts)) return { ok: false, erro: 'data' };
    scheduledTo = new Date(ts).toISOString();
  }
  const account = await loadAccount(env, tenantId, a.contaId);
  if (piece.formato === 'reels' && account.modo === 'intermediario') return { ok: false, erro: 'reels_intermediario' };
  const to = scheduledTo ? 'agendada' : 'aprovada';
  const common = [
    // The approved version is the one read here, and valid: an edit saved in the middle (another version, or failed) aborts.
    guardVersionApprovable(env, tenantId, pieceId, piece.versao),
    env.DB.prepare('INSERT INTO decisoes (id, tenant_id, peca_id, versao, decisao, por, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(newId(), tenantId, pieceId, piece.versao, 'aprovar', actor, JSON.stringify({ contaId: account.id, modo: account.modo, agendarPara: scheduledTo, ...a.extra })),
    env.DB.prepare('UPDATE pecas SET conta_id = ?, agendado_para = ? WHERE id = ? AND tenant_id = ?').bind(account.id, scheduledTo, pieceId, tenantId),
  ];
  const data = { decisao: 'aprovar', versao: piece.versao, contaId: account.id, modo: account.modo, agendarPara: scheduledTo };

  const changedVersion = (e: unknown) => String(e).includes('malformed JSON');
  if (account.modo === 'manual') {
    try {
      const { mudou: changed } = await transition(env, { tipo: 'peca', id: pieceId, tenantId, para: to, por: actor, dados: data, batch: common });
      return changed ? { ok: true, status: to, modo: 'manual' } : { ok: false, erro: 'conflito' };
    } catch (e) {
      if (changedVersion(e)) return { ok: false, erro: 'conflito' };
      throw e;
    }
  }

  const n = ((await env.DB.prepare("SELECT COUNT(*) AS n FROM execucoes WHERE tenant_id = ? AND ref_id = ? AND tipo = 'publicacao'")
    .bind(tenantId, pieceId).first<{ n: number }>())?.n ?? 0) + 1;
  const executionId = `${pieceId}-pub-${n}`;
  const params = { tenantId, pautaId: piece.pauta_id, pecaId: pieceId, contaId: account.id, ...(scheduledTo ? { agendadoPara: scheduledTo } : {}) };
  let changed: boolean;
  try {
    ({ mudou: changed } = await transition(env, {
      tipo: 'peca', id: pieceId, tenantId, para: to, por: actor, dados: { ...data, workflowId: executionId },
      batch: [...common, startExecution(env, { id: executionId, tenantId, tipo: 'publicacao', refTipo: 'peca', refId: pieceId, params })],
    }));
  } catch (e) {
    if (changedVersion(e)) return { ok: false, erro: 'conflito' };
    throw e;
  }
  if (!changed) return { ok: false, erro: 'conflito' };
  const error = await startPublication(env, executionId, params);
  return { ok: true, status: to, modo: account.modo as AccountMode, workflowId: executionId, ...(error ? { pendente: true as const } : {}) };
}
