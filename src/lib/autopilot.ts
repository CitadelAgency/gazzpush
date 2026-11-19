// Autopilot (an outlet option, off by default): approves only what came from the outlet's own site, with no warning at
// all from the check, on an account that posts by itself, with a daily cap and a gap between posts. Everything else stays
// in To approve, with the reason in an event.
import type { Env } from '../env';
import { recordEvent } from './db';
import { approvePiece } from './approve';
import { WithoutAccount, loadAccount } from './publish';

export const INTERVAL_AUTOPILOT_MIN = 60;
/** Tolerance for posting right away instead of scheduling a few seconds out. */
const IN_HOUR_MS = 60_000;

/** The default account, if it posts by itself. */
export async function fromAutopilotAccount(env: Env, tenantId: string) {
  const account = await loadAccount(env, tenantId).catch((e) => { if (e instanceof WithoutAccount) return null; throw e; });
  return account && account.modo !== 'manual' ? account : null;
}

/** Reserves the next slot: after the last scheduled, the last posted and the previous reservation. A single UPDATE. */
async function reserveTurn(env: Env, tenantId: string): Promise<string> {
  const hour = `${INTERVAL_AUTOPILOT_MIN} / 1440.0`;
  const r = await env.DB.prepare(
    `UPDATE tenants SET piloto_vez_em = strftime('%Y-%m-%dT%H:%M:%fZ', ${hour} + MAX(
       julianday('now'),
       COALESCE(julianday(piloto_vez_em), 0),
       COALESCE((SELECT julianday(MAX(agendado_para)) + ${hour} FROM pecas WHERE tenant_id = ?1 AND status = 'agendada'), 0),
       COALESCE((SELECT julianday(MAX(publicado_em)) + ${hour} FROM publicacoes WHERE tenant_id = ?1 AND status = 'publicada'), 0)
     )) WHERE id = ?1 RETURNING piloto_vez_em`,
  ).bind(tenantId).first<{ piloto_vez_em: string }>();
  return new Date(Date.parse(r!.piloto_vez_em) - INTERVAL_AUTOPILOT_MIN * 60_000).toISOString();
}

interface PieceLine {
  id: string; pauta_id: string; status: string; versao: number; formato: string; validacao_ok: number | null;
  erros: number | null; avisos: number | null; origem: string; tipo_post: string | null;
}

/** The `piloto` step, after review. It never brings production down: when in doubt, the piece is left to a person. */
export async function autopilot(env: Env, a: { tenantId: string; pecaId: string; rodada: number; versao: number }): Promise<void> {
  const { tenantId, pecaId: pieceId, versao: version } = a;
  const block = (reason: string) => recordEvent(env, tenantId, 'peca.piloto_barrou', 'peca', pieceId, { versao: version, motivo: reason }, `${pieceId}:v${version}:piloto`);
  try {
    const t = await env.DB.prepare('SELECT piloto_ligado_em, piloto_ligado_por, piloto_por_dia FROM tenants WHERE id = ?')
      .bind(tenantId).first<{ piloto_ligado_em: string | null; piloto_ligado_por: string | null; piloto_por_dia: number }>();
    if (!t?.piloto_ligado_em) return;
    const piece = await env.DB.prepare(
      `SELECT pc.id, pc.pauta_id, pc.status, pc.versao, pc.formato, json_extract(pc.validacao_json, '$.ok') AS validacao_ok,
              json_array_length(pc.validacao_json, '$.erros') AS erros, json_array_length(pc.validacao_json, '$.avisos') AS avisos,
              pa.origem, pa.tipo_post
         FROM pecas pc JOIN pautas pa ON pa.id = pc.pauta_id AND pa.tenant_id = pc.tenant_id
        WHERE pc.id = ? AND pc.tenant_id = ?`,
    ).bind(pieceId, tenantId).first<PieceLine>();
    // Replay of the step, or someone already decided.
    if (!piece || piece.status !== 'revisao') return;
    if (a.rodada > 1) return await block('reescrita pedida por pessoa');
    if (piece.origem !== 'site') return await block('não veio do site do veículo');
    if (piece.tipo_post) return await block(`tipo de post: ${piece.tipo_post}`);
    if (piece.validacao_ok !== 1 || piece.erros !== 0 || piece.avisos !== 0) return await block('conferência com erro ou aviso');
    const account = await fromAutopilotAccount(env, tenantId);
    if (!account) return await block('a conta padrão não posta sozinha');
    const today = await env.DB.prepare("SELECT COUNT(*) AS n FROM decisoes WHERE tenant_id = ? AND por = 'piloto' AND decisao = 'aprovar' AND created_at >= datetime('now', '-1 day')")
      .bind(tenantId).first<{ n: number }>();
    if ((today?.n ?? 0) >= t.piloto_por_dia) return await block(`teto de ${t.piloto_por_dia} por dia`);
    const turn = await reserveTurn(env, tenantId);
    const r = await approvePiece(env, {
      tenantId, por: 'piloto', peca: piece, contaId: account.id,
      ...(Date.parse(turn) > Date.now() + IN_HOUR_MS ? { agendarPara: turn } : {}),
      extra: { ligadoPor: t.piloto_ligado_por },
    });
    if (!r.ok) await block(r.erro);
  } catch (e) {
    await block(String(e).slice(0, 200));
  }
}
