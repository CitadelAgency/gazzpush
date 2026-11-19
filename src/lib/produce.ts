import type { Env, ProductionParams } from '../env';
import { startExecution, transition } from '../kernel/states';
import { productionId, startProduction } from '../workflows/production';
import { newId, recordEvent } from './db';
import { limitError, guardQuota, brasiliaMonth, planStatus, addPost } from './plans';
import { requireKeyText } from './providers';

export type Produced = { pecaId: string; workflowId: string; pendente: boolean } | null;

/**
 * Lead → piece + production round 1. Lead, piece and run in one batch; the Workflow instance only afterwards. null = the
 * lead was already in production (or left the queue) and nothing was created. `pendente`: the Workflow did not confirm
 * its start (the cron recreates it). Used by the "Produce" route and by the start of an author outlet.
 */
export async function produceLead(env: Env, tenantId: string, leadId: string, actor: string, format: ProductionParams['formato'], o: { semCota?: boolean } = {}): Promise<Produced> {
  // Without a text key (neither the outlet's nor the server's), drafting could not run: blocked at the door, like the plan limit.
  await requireKeyText(env, tenantId);
  const pieceId = newId();
  const executionId = productionId(pieceId, 1);
  const params = { tenantId, pautaId: leadId, pecaId: pieceId, formato: format, rodada: 1 };
  // Producing again after a failure is not a new post: the first time already counted.
  const redone = await env.DB.prepare('SELECT 1 AS x FROM pecas WHERE pauta_id = ? AND tenant_id = ? LIMIT 1').bind(leadId, tenantId).first();
  const month = brasiliaMonth();
  const quota = o.semCota || redone ? [] : [guardQuota(env, tenantId, month), addPost(env, tenantId, month)];
  let changed: boolean;
  try {
    ({ mudou: changed } = await transition(env, {
      tipo: 'pauta', id: leadId, tenantId, para: 'em_producao', por: actor, dados: { pecaId: pieceId, formato: format },
      batch: [
        ...quota,
        env.DB.prepare('INSERT INTO pecas (id, tenant_id, pauta_id, formato, rodada, workflow_id) VALUES (?, ?, ?, ?, 1, ?)').bind(pieceId, tenantId, leadId, format, executionId),
        startExecution(env, { id: executionId, tenantId, tipo: 'producao', refTipo: 'peca', refId: pieceId, params }),
      ],
    }));
  } catch (e) {
    if (!String(e).includes('malformed JSON')) throw e;
    await recordEvent(env, tenantId, 'uso.limite', 'pauta', leadId, { mes: month, por: actor }, `uso.limite:${leadId}:${month}`);
    throw limitError(await planStatus(env, tenantId, month));
  }
  if (!changed) return null;
  const error = await startProduction(env, params);
  return { pecaId: pieceId, workflowId: executionId, pendente: !!error };
}
