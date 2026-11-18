// Piloto automático (opção do veículo, desligado por padrão): aprova só o que veio do site do próprio veículo, sem aviso
// nenhum da conferência, em conta que posta sozinha, com teto por dia e um intervalo entre posts. O resto fica em Para
// aprovar, com o motivo em evento.
import type { Env } from '../env';
import { registrarEvento } from './db';
import { aprovarPeca } from './aprovar';
import { SemConta, carregarConta } from './publicar';

export const INTERVALO_PILOTO_MIN = 60;
/** Tolerância para sair na hora, em vez de agendar para daqui a segundos. */
const NA_HORA_MS = 60_000;

/** A conta padrão, se ela posta sozinha. */
export async function contaDoPiloto(env: Env, tenantId: string) {
  const conta = await carregarConta(env, tenantId).catch((e) => { if (e instanceof SemConta) return null; throw e; });
  return conta && conta.modo !== 'manual' ? conta : null;
}

/** Reserva o próximo horário: depois do último agendado, do último postado e da reserva anterior. Um UPDATE só. */
async function reservarVez(env: Env, tenantId: string): Promise<string> {
  const hora = `${INTERVALO_PILOTO_MIN} / 1440.0`;
  const r = await env.DB.prepare(
    `UPDATE tenants SET piloto_vez_em = strftime('%Y-%m-%dT%H:%M:%fZ', ${hora} + MAX(
       julianday('now'),
       COALESCE(julianday(piloto_vez_em), 0),
       COALESCE((SELECT julianday(MAX(agendado_para)) + ${hora} FROM pecas WHERE tenant_id = ?1 AND status = 'agendada'), 0),
       COALESCE((SELECT julianday(MAX(publicado_em)) + ${hora} FROM publicacoes WHERE tenant_id = ?1 AND status = 'publicada'), 0)
     )) WHERE id = ?1 RETURNING piloto_vez_em`,
  ).bind(tenantId).first<{ piloto_vez_em: string }>();
  return new Date(Date.parse(r!.piloto_vez_em) - INTERVALO_PILOTO_MIN * 60_000).toISOString();
}

interface LinhaPeca {
  id: string; pauta_id: string; status: string; versao: number; formato: string; validacao_ok: number | null;
  erros: number | null; avisos: number | null; origem: string; tipo_post: string | null;
}

/** Step `piloto`, depois da revisão. Nunca derruba a produção: em qualquer dúvida, a peça fica para a pessoa. */
export async function pilotar(env: Env, a: { tenantId: string; pecaId: string; rodada: number; versao: number }): Promise<void> {
  const { tenantId, pecaId, versao } = a;
  const barrar = (motivo: string) => registrarEvento(env, tenantId, 'peca.piloto_barrou', 'peca', pecaId, { versao, motivo }, `${pecaId}:v${versao}:piloto`);
  try {
    const t = await env.DB.prepare('SELECT piloto_ligado_em, piloto_ligado_por, piloto_por_dia FROM tenants WHERE id = ?')
      .bind(tenantId).first<{ piloto_ligado_em: string | null; piloto_ligado_por: string | null; piloto_por_dia: number }>();
    if (!t?.piloto_ligado_em) return;
    const peca = await env.DB.prepare(
      `SELECT pc.id, pc.pauta_id, pc.status, pc.versao, pc.formato, json_extract(pc.validacao_json, '$.ok') AS validacao_ok,
              json_array_length(pc.validacao_json, '$.erros') AS erros, json_array_length(pc.validacao_json, '$.avisos') AS avisos,
              pa.origem, pa.tipo_post
         FROM pecas pc JOIN pautas pa ON pa.id = pc.pauta_id AND pa.tenant_id = pc.tenant_id
        WHERE pc.id = ? AND pc.tenant_id = ?`,
    ).bind(pecaId, tenantId).first<LinhaPeca>();
    // Replay do step, ou alguém já decidiu.
    if (!peca || peca.status !== 'revisao') return;
    if (a.rodada > 1) return await barrar('reescrita pedida por pessoa');
    if (peca.origem !== 'site') return await barrar('não veio do site do veículo');
    if (peca.tipo_post) return await barrar(`tipo de post: ${peca.tipo_post}`);
    if (peca.validacao_ok !== 1 || peca.erros !== 0 || peca.avisos !== 0) return await barrar('conferência com erro ou aviso');
    const conta = await contaDoPiloto(env, tenantId);
    if (!conta) return await barrar('a conta padrão não posta sozinha');
    const hoje = await env.DB.prepare("SELECT COUNT(*) AS n FROM decisoes WHERE tenant_id = ? AND por = 'piloto' AND decisao = 'aprovar' AND created_at >= datetime('now', '-1 day')")
      .bind(tenantId).first<{ n: number }>();
    if ((hoje?.n ?? 0) >= t.piloto_por_dia) return await barrar(`teto de ${t.piloto_por_dia} por dia`);
    const vez = await reservarVez(env, tenantId);
    const r = await aprovarPeca(env, {
      tenantId, por: 'piloto', peca, contaId: conta.id,
      ...(Date.parse(vez) > Date.now() + NA_HORA_MS ? { agendarPara: vez } : {}),
      extra: { ligadoPor: t.piloto_ligado_por },
    });
    if (!r.ok) await barrar(r.erro);
  } catch (e) {
    await barrar(String(e).slice(0, 200));
  }
}
