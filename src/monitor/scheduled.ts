import type { Env, MonitorMessage } from '../env';
import { reconcileExecutions } from '../workflows/reconcile';
import { enqueueDossier } from '../lib/desk';
import { enqueueCases, syncDeadlinesLai } from '../lib/living';
import { closeFilesStopped } from '../lib/document';
import { finishSessionsStopped } from '../lib/recordingSession';
import { enqueueSummaries } from '../lib/digest';

/** The review desk's daily cron (06:00 Brasília): re-reads dossier evidence, queries court cases and checks LAI deadlines. */
export const CRON_DOSSIER = '0 9 * * *';
/** Daily digest, 18:00 Brasília. A fixed hour: a per-outlet time zone is a known gap. */
export const CRON_SUMMARY = '0 21 * * *';

/** A source with this many consecutive failures leaves the cron queue (the UI shows "collection stopped"). */
export const MAX_FAILURES_SOURCE = 10;

// Cron: recreates Workflow instances that were left without a create and queues sources whose interval elapsed.
export const scheduled: ExportedHandlerScheduledHandler<Env> = async (ctrl, env) => {
  if (ctrl.cron === CRON_SUMMARY) {
    await enqueueSummaries(env);
    return;
  }
  if (ctrl.cron === CRON_DOSSIER) {
    await enqueueDossier(env);
    // Living story: cited court cases (DataJud, with the key) and LAI deadlines become alerts in the After tab.
    await enqueueCases(env).catch((e) => console.error('enfileirarProcessos', e));
    await syncDeadlinesLai(env).catch((e) => console.error('sincronizarPrazosLai', e));
    return;
  }
  await reconcileExecutions(env).catch((e) => console.error('reconciliarExecucoes', e));
  // PDFs and audio the queue dropped without an outcome become "falhou", with the reason (sending again starts over).
  await closeFilesStopped(env).catch((e) => console.error('encerrarArquivosParados', e));
  // A recording left open: what was uploaded becomes a recording, without depending on the person coming back.
  await finishSessionsStopped(env).catch((e) => console.error('concluirSessoesParadas', e));

  const { results } = await env.DB.prepare(
    `SELECT id, tenant_id FROM fontes
     WHERE ativo = 1 AND tipo != 'manual' AND falhas < ${MAX_FAILURES_SOURCE}
       AND tenant_id NOT IN (SELECT id FROM tenants WHERE plano = 'teste')  -- sem assinatura, não há coleta nem triagem
       AND (ultimo_fetch_at IS NULL OR datetime(ultimo_fetch_at, '+' || intervalo_min || ' minutes') <= datetime('now'))
     LIMIT 500`,
  ).all<{ id: string; tenant_id: string }>();
  if (!results.length) return;

  const msgs: { body: MonitorMessage }[] = results.map((f) => ({ body: { tipo: 'fonte', tenantId: f.tenant_id, fonteId: f.id } }));
  for (let i = 0; i < msgs.length; i += 100) await env.MONITOR_QUEUE.sendBatch(msgs.slice(i, i + 100));
};
