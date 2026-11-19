import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import type { Env, PublicationParams } from '../env';
import { loadAccount, publish, type Account, type Publication } from '../lib/publish';
import { stmtEvent } from '../lib/db';
import { closeExecution, transition, type Transition } from '../kernel/states';
import { createInstance } from './instance';

/**
 * Automatic publishing (real, intermediary or simulated account) of an approved/scheduled piece.
 * Short: sleeps until the scheduled time, publishes, records. A manual account never gets here (the operator confirms
 * through the API).
 */
export class PublicacaoWorkflow extends WorkflowEntrypoint<Env, PublicationParams> {
  async run(event: Readonly<WorkflowEvent<PublicationParams>>, step: WorkflowStep) {
    const p = event.payload;
    const executionId = event.instanceId;
    const env = this.env;
    try {
      if (p.agendadoPara) await step.sleepUntil('agendar', new Date(p.agendadoPara));
      const account = await step.do('conta', () => loadAccount(env, p.tenantId, p.contaId));
      // The Graph API is not idempotent: a retry after an accepted publish duplicates the post. A low limit on purpose.
      const pub = await step.do('publicar', { retries: { limit: 2, delay: '1 minute', backoff: 'exponential' } }, () =>
        publish(env, { tenantId: p.tenantId, pecaId: p.pecaId, conta: account }));
      await step.do('registrar', () => recordPublication(env, p, executionId, account, pub));
      return { status: 'publicada' as const, externalId: pub.externalId, url: pub.url };
    } catch (e) {
      const reason = String(e).slice(0, 500);
      await step.do('registrar falha', () => failPublication(env, p, executionId, reason));
      throw e;
    }
  }
}

/** publicacoes + published piece + finished lead + closed run, in one batch. The publication id = the run id. */
export async function recordPublication(env: Env, p: PublicationParams, executionId: string, account: Pick<Account, 'id' | 'rede' | 'modo'>, pub: Publication) {
  const { tenantId, pecaId: pieceId } = p;
  const batch = [
    env.DB.prepare(`INSERT OR IGNORE INTO publicacoes (id, tenant_id, peca_id, conta_id, rede, modo, external_id, url, publicado_em, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 'publicada')`)
      .bind(executionId, tenantId, pieceId, account.id, pub.rede, account.modo, pub.externalId, pub.url ?? null),
    closeExecution(env, executionId, 'concluida'),
  ];
  if (pub.chamadas) {
    batch.push(stmtEvent(env, {
      tenantId, tipo: 'peca.publicacao_simulada', refTipo: 'peca', refId: pieceId,
      payload: { contaId: account.id, chamadas: pub.chamadas }, chave: `${executionId}:simulada`,
    }));
  }
  // The lead finishes if it is still in production. A Reels can go out after its carousel was rejected (lead discarded)
  // or failed (accepted): its publication counts all the same, and the lead stays as is.
  const lead = await env.DB.prepare('SELECT status FROM pautas WHERE id = ? AND tenant_id = ?').bind(p.pautaId, tenantId).first<{ status: string }>();
  const ts: Transition[] = [{ tipo: 'peca', id: pieceId, tenantId, para: 'publicada', por: 'sistema', dados: { publicacaoId: executionId, externalId: pub.externalId, url: pub.url ?? null, modo: account.modo }, batch }];
  if (lead?.status === 'em_producao') ts.push({ tipo: 'pauta', id: p.pautaId, tenantId, para: 'concluida', por: 'sistema' });
  const { mudou: changed } = await transition(env, ts);
  if (changed) {
    env.METRICS.writeDataPoint({ blobs: [tenantId, 'publicada', account.modo], doubles: [1], indexes: [tenantId] });
    // A simulated account published nothing: there is nothing to certify. Publishing never waits for or fails because of the certificate.
    if (account.modo !== 'simulada') await requestCertificate(env, tenantId, pieceId);
  }
}

/** Queues the certificate. Queue down: it is left for "Generate certificate", and publishing carries on. */
export const requestCertificate = (env: Env, tenantId: string, pieceId: string) =>
  env.MONITOR_QUEUE.send({ tipo: 'certidao', tenantId, pecaId: pieceId }).catch((e) => console.error('certificate not queued', pieceId, String(e)));

/** Piece → falhou, lead back to the queue, attempt recorded in publicacoes, run closed. Idempotent. */
export async function failPublication(env: Env, p: PublicationParams, executionId: string, reason: string) {
  const { tenantId, pecaId: pieceId } = p;
  // Run already closed (it published and only the step's completion was lost, or it had already failed): the outcome is not rewritten.
  const exec = await env.DB.prepare('SELECT status FROM execucoes WHERE id = ? AND tenant_id = ?').bind(executionId, tenantId).first<{ status: string }>();
  if (exec && exec.status !== 'rodando') return;
  const account = await env.DB.prepare('SELECT rede, modo FROM contas_sociais WHERE id = ? AND tenant_id = ?').bind(p.contaId, tenantId).first<{ rede: string; modo: string }>();
  const lead = await env.DB.prepare('SELECT status FROM pautas WHERE id = ? AND tenant_id = ?').bind(p.pautaId, tenantId).first<{ status: string }>();
  const piece = await env.DB.prepare('SELECT formato FROM pecas WHERE id = ? AND tenant_id = ?').bind(pieceId, tenantId).first<{ formato: string }>();
  const ts: Transition[] = [{
    tipo: 'peca', id: pieceId, tenantId, para: 'falhou', por: 'sistema', motivo: reason,
    batch: [
      env.DB.prepare(`INSERT OR IGNORE INTO publicacoes (id, tenant_id, peca_id, conta_id, rede, modo, status, erro) VALUES (?, ?, ?, ?, ?, ?, 'falhou', ?)`)
        .bind(executionId, tenantId, pieceId, p.contaId, account?.rede ?? 'instagram', account?.modo ?? '?', reason),
      closeExecution(env, executionId, 'falhou', reason),
    ],
  }];
  // A Reels does not send the lead back to the queue: its source carousel does that.
  if (lead?.status === 'em_producao' && piece?.formato !== 'reels') ts.push({ tipo: 'pauta', id: p.pautaId, tenantId, para: 'aceita', por: 'sistema', motivo: reason });
  await transition(env, ts);
}

/**
 * Creates the publishing instance after the approval batch. Never marks a failure here: if create was accepted and only
 * the response was lost, the Workflow really publishes. Error = pending; the reconciler recreates it. Error or null.
 */
export function startPublication(env: Env, id: string, params: PublicationParams): Promise<string | null> {
  return createInstance(env.PUBLICACAO_WORKFLOW, id, params);
}
