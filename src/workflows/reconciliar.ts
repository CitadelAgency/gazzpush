import type { Env, ProducaoParams, PublicacaoParams } from '../env';
import { registrarEvento } from '../lib/db';
import { criarInstancia, situacaoInstancia } from './instancia';
import { falharProducao } from './producao';
import { falharPublicacao } from './publicacao';

const IDADE_MIN = 5;        // mais novo que isso pode ser um request ainda em andamento
const DESISTIR_MIN = 60;    // instância confirmadamente ausente e create falhando há 1 h → falhou
const PAGINA = 50;
const MAX_PAGINAS = 20;
const CHAVE_CURSOR = 'reconciliar:cursor';   // KV: onde a varredura parou quando bateu MAX_PAGINAS

type Cursor = { em: string; id: string };

/**
 * A API grava peça/execução num batch e só depois cria a instância do Workflow (create não entra no batch do D1).
 * Se o request morrer entre os dois, ou o create falhar, sobra execução `rodando` sem instância. Este passo do cron
 * recria a instância com os params gravados (id determinístico: create repetido falha em vez de duplicar).
 * Varredura paginada por cursor, retomada do ponto em que parou na rodada anterior: publicações dormindo até o
 * horário agendado continuam `rodando` e não podem esconder as execuções mais novas.
 */
export async function reconciliarExecucoes(env: Env, pagina = PAGINA, maxPaginas = MAX_PAGINAS): Promise<{ recriadas: number; falhas: number }> {
  let recriadas = 0, falhas = 0;
  let cursor: Cursor = (await env.CONFIG.get<Cursor>(CHAVE_CURSOR, 'json')) ?? { em: '', id: '' };
  for (let p = 0; p < maxPaginas; p++) {
    const { results } = await env.DB.prepare(
      `SELECT id, tenant_id, tipo, ref_id, params_json, iniciado_em, iniciado_em < datetime('now', ?) AS velha
       FROM execucoes
       WHERE status = 'rodando' AND iniciado_em < datetime('now', ?) AND (iniciado_em > ? OR (iniciado_em = ? AND id > ?))
       ORDER BY iniciado_em, id LIMIT ?`,
    ).bind(`-${DESISTIR_MIN} minutes`, `-${IDADE_MIN} minutes`, cursor.em, cursor.em, cursor.id, pagina)
      .all<{ id: string; tenant_id: string; tipo: string; ref_id: string; params_json: string; iniciado_em: string; velha: number }>();

    for (const e of results) {
      const producao = e.tipo === 'producao';
      const wf = (producao ? env.PRODUCAO_WORKFLOW : env.PUBLICACAO_WORKFLOW) as Workflow<ProducaoParams | PublicacaoParams>;
      if ((await situacaoInstancia(wf, e.id)) !== 'ausente') continue;   // existe, ou não dá pra saber agora
      const params = JSON.parse(e.params_json);
      const erro = await criarInstancia(wf, e.id, params);
      if (!erro) {
        await registrarEvento(env, e.tenant_id, 'execucao.recriada', 'peca', e.ref_id, { execucaoId: e.id }, `${e.id}:recriada`);
        recriadas++;
      } else if (e.velha && (await situacaoInstancia(wf, e.id)) === 'ausente') {
        const motivo = `sem instância há mais de ${DESISTIR_MIN} min; ${erro}`;
        await (producao ? falharProducao(env, params as ProducaoParams, e.id, motivo) : falharPublicacao(env, params as PublicacaoParams, e.id, motivo));
        falhas++;
      }
    }
    if (results.length < pagina) {
      await env.CONFIG.delete(CHAVE_CURSOR);   // varredura completa: a próxima recomeça do início
      return { recriadas, falhas };
    }
    const ultimo = results[results.length - 1];
    cursor = { em: ultimo.iniciado_em, id: ultimo.id };
  }
  await env.CONFIG.put(CHAVE_CURSOR, JSON.stringify(cursor), { expirationTtl: 24 * 3600 });
  return { recriadas, falhas };
}
