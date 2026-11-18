import type { Env, MonitorMessage } from '../env';
import { reconciliarExecucoes } from '../workflows/reconciliar';
import { enfileirarDossie } from '../lib/mesa';
import { enfileirarProcessos, sincronizarPrazosLai } from '../lib/viva';
import { encerrarArquivosParados } from '../lib/documento';
import { concluirSessoesParadas } from '../lib/gravacaoSessao';
import { enfileirarResumos } from '../lib/resumo';

/** Cron diário (06h em Brasília) da mesa revisora: relê as evidências dos dossiês, consulta processos e vê prazos de LAI. */
export const CRON_DOSSIE = '0 9 * * *';
/** Resumo do dia, 18h em Brasília. Hora fixa: fuso por veículo é lacuna conhecida. */
export const CRON_RESUMO = '0 21 * * *';

/** Fonte com este tanto de falhas seguidas sai da fila do cron (a UI mostra "coleta parada"). */
export const MAX_FALHAS_FONTE = 10;

// Cron: recria instâncias de Workflow que ficaram sem create e enfileira fontes cujo intervalo venceu.
export const scheduled: ExportedHandlerScheduledHandler<Env> = async (ctrl, env) => {
  if (ctrl.cron === CRON_RESUMO) {
    await enfileirarResumos(env);
    return;
  }
  if (ctrl.cron === CRON_DOSSIE) {
    await enfileirarDossie(env);
    // Matéria viva: os processos citados (DataJud, com a chave) e os prazos de LAI viram alertas na aba Depois.
    await enfileirarProcessos(env).catch((e) => console.error('enfileirarProcessos', e));
    await sincronizarPrazosLai(env).catch((e) => console.error('sincronizarPrazosLai', e));
    return;
  }
  await reconciliarExecucoes(env).catch((e) => console.error('reconciliarExecucoes', e));
  // PDF e áudio que a fila largou sem desfecho viram "falhou", com o motivo (mandar de novo recomeça).
  await encerrarArquivosParados(env).catch((e) => console.error('encerrarArquivosParados', e));
  // Gravação que ficou aberta: o que subiu vira gravação, sem depender de a pessoa voltar.
  await concluirSessoesParadas(env).catch((e) => console.error('concluirSessoesParadas', e));

  const { results } = await env.DB.prepare(
    `SELECT id, tenant_id FROM fontes
     WHERE ativo = 1 AND tipo != 'manual' AND falhas < ${MAX_FALHAS_FONTE}
       AND tenant_id NOT IN (SELECT id FROM tenants WHERE plano = 'teste')  -- sem assinatura, não há coleta nem triagem
       AND (ultimo_fetch_at IS NULL OR datetime(ultimo_fetch_at, '+' || intervalo_min || ' minutes') <= datetime('now'))
     LIMIT 500`,
  ).all<{ id: string; tenant_id: string }>();
  if (!results.length) return;

  const msgs: { body: MonitorMessage }[] = results.map((f) => ({ body: { tipo: 'fonte', tenantId: f.tenant_id, fonteId: f.id } }));
  for (let i = 0; i < msgs.length; i += 100) await env.MONITOR_QUEUE.sendBatch(msgs.slice(i, i + 100));
};
