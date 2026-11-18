import type { Env, ProducaoParams } from '../env';
import { iniciarExecucao, transitar } from '../kernel/estados';
import { idProducao, iniciarProducao } from '../workflows/producao';
import { novoId, registrarEvento } from './db';
import { erroLimite, guardaCota, mesBrasilia, situacaoPlano, somarPost } from './planos';
import { exigirChaveTexto } from './provedores';

export type Produzida = { pecaId: string; workflowId: string; pendente: boolean } | null;

/**
 * Pauta → peça + rodada 1 de produção. Pauta, peça e execução num batch; a instância do Workflow só depois. null = a
 * pauta já estava em produção (ou saiu da fila) e nada foi criado. `pendente`: o Workflow não confirmou o início (o
 * cron recria). Serve à rota "Produzir" e ao início do veículo autoral.
 */
export async function produzirPauta(env: Env, tenantId: string, pautaId: string, por: string, formato: ProducaoParams['formato'], o: { semCota?: boolean } = {}): Promise<Produzida> {
  // Sem chave de texto (nem do veículo, nem do servidor), a redação não teria como rodar: barra na porta, como o limite do plano.
  await exigirChaveTexto(env, tenantId);
  const pecaId = novoId();
  const execucaoId = idProducao(pecaId, 1);
  const params = { tenantId, pautaId, pecaId, formato, rodada: 1 };
  // Produzir de novo depois de falha não é post novo: a primeira vez já contou.
  const refeita = await env.DB.prepare('SELECT 1 AS x FROM pecas WHERE pauta_id = ? AND tenant_id = ? LIMIT 1').bind(pautaId, tenantId).first();
  const mes = mesBrasilia();
  const cota = o.semCota || refeita ? [] : [guardaCota(env, tenantId, mes), somarPost(env, tenantId, mes)];
  let mudou: boolean;
  try {
    ({ mudou } = await transitar(env, {
      tipo: 'pauta', id: pautaId, tenantId, para: 'em_producao', por, dados: { pecaId, formato },
      batch: [
        ...cota,
        env.DB.prepare('INSERT INTO pecas (id, tenant_id, pauta_id, formato, rodada, workflow_id) VALUES (?, ?, ?, ?, 1, ?)').bind(pecaId, tenantId, pautaId, formato, execucaoId),
        iniciarExecucao(env, { id: execucaoId, tenantId, tipo: 'producao', refTipo: 'peca', refId: pecaId, params }),
      ],
    }));
  } catch (e) {
    if (!String(e).includes('malformed JSON')) throw e;
    await registrarEvento(env, tenantId, 'uso.limite', 'pauta', pautaId, { mes, por }, `uso.limite:${pautaId}:${mes}`);
    throw erroLimite(await situacaoPlano(env, tenantId, mes));
  }
  if (!mudou) return null;
  const erro = await iniciarProducao(env, params);
  return { pecaId, workflowId: execucaoId, pendente: !!erro };
}
