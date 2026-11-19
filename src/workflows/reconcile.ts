import type { Env, ProductionParams, PublicationParams } from '../env';
import { recordEvent } from '../lib/db';
import { createInstance, instanceStatus } from './instance';
import { failProduction } from './production';
import { failPublication } from './publishing';

const AGE_MIN = 5;        // newer than this may be a request still in progress
const GIVE_UP_MIN = 60;    // instance confirmed absent and create failing for 1 h → falhou
const PAGE = 50;
const MAX_PAGES = 20;
const CURSOR_KEY = 'reconciliar:cursor';   // KV: where the scan stopped when it hit MAX_PAGES

type Cursor = { em: string; id: string };

/**
 * The API stores the piece/run in a batch and only then creates the Workflow instance (create is not part of the D1
 * batch). If the request dies between the two, or create fails, a `rodando` run without an instance is left. This cron
 * step recreates the instance with the stored params (deterministic id: a repeated create fails instead of duplicating).
 * A cursor-paginated scan, resumed from where it stopped in the previous round: publications sleeping until their
 * scheduled time stay `rodando` and must not hide the newer runs.
 */
export async function reconcileExecutions(env: Env, page = PAGE, maxPages = MAX_PAGES): Promise<{ recriadas: number; falhas: number }> {
  let recreated = 0, failures = 0;
  let cursor: Cursor = (await env.CONFIG.get<Cursor>(CURSOR_KEY, 'json')) ?? { em: '', id: '' };
  for (let p = 0; p < maxPages; p++) {
    const { results } = await env.DB.prepare(
      `SELECT id, tenant_id, tipo, ref_id, params_json, iniciado_em, iniciado_em < datetime('now', ?) AS velha
       FROM execucoes
       WHERE status = 'rodando' AND iniciado_em < datetime('now', ?) AND (iniciado_em > ? OR (iniciado_em = ? AND id > ?))
       ORDER BY iniciado_em, id LIMIT ?`,
    ).bind(`-${GIVE_UP_MIN} minutes`, `-${AGE_MIN} minutes`, cursor.em, cursor.em, cursor.id, page)
      .all<{ id: string; tenant_id: string; tipo: string; ref_id: string; params_json: string; iniciado_em: string; velha: number }>();

    for (const e of results) {
      const production = e.tipo === 'producao';
      const wf = (production ? env.PRODUCAO_WORKFLOW : env.PUBLICACAO_WORKFLOW) as Workflow<ProductionParams | PublicationParams>;
      if ((await instanceStatus(wf, e.id)) !== 'ausente') continue;   // exists, or there is no way to know right now
      const params = JSON.parse(e.params_json);
      const error = await createInstance(wf, e.id, params);
      if (!error) {
        await recordEvent(env, e.tenant_id, 'execucao.recriada', 'peca', e.ref_id, { execucaoId: e.id }, `${e.id}:recriada`);
        recreated++;
      } else if (e.velha && (await instanceStatus(wf, e.id)) === 'ausente') {
        const reason = `no instance for more than ${GIVE_UP_MIN} min; ${error}`;
        await (production ? failProduction(env, params as ProductionParams, e.id, reason) : failPublication(env, params as PublicationParams, e.id, reason));
        failures++;
      }
    }
    if (results.length < page) {
      await env.CONFIG.delete(CURSOR_KEY);   // full scan: the next one starts from the beginning
      return { recriadas: recreated, falhas: failures };
    }
    const last = results[results.length - 1];
    cursor = { em: last.iniciado_em, id: last.id };
  }
  await env.CONFIG.put(CURSOR_KEY, JSON.stringify(cursor), { expirationTtl: 24 * 3600 });
  return { recriadas: recreated, falhas: failures };
}
