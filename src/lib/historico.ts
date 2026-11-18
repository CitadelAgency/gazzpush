// Histórico do editor. O salvamento automático roda a cada pausa: guardar todos encheria o banco de quase iguais, então fica um
// retrato a cada 10 minutos e os 30 mais novos de cada texto. Restaurar é um salvamento comum, feito pela tela.
import type { Env } from '../env';
import { novoId } from './db';
import { ErroMesa, estrutura, type LinhaTexto } from './mesa';

const MINUTOS = 10;
const GUARDADOS = 30;

/** Guarda `t` como estava antes de salvar. `forcar`: antes de restaurar, para o restaurar poder ser desfeito. */
export async function guardarRetrato(env: Env, tenantId: string, t: LinhaTexto, por: string, forcar = false) {
  if (!forcar) {
    const recente = await env.DB.prepare(`SELECT 1 AS x FROM textos_historico WHERE texto_id = ? AND created_at > datetime('now', '-${MINUTOS} minutes') LIMIT 1`).bind(t.id).first();
    if (recente) return;
  }
  const { doc } = await estrutura(t);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO textos_historico (id, tenant_id, texto_id, versao, titulo, doc_json, por) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(novoId(), tenantId, t.id, t.versao, t.titulo, JSON.stringify(doc), por),
    env.DB.prepare(`DELETE FROM textos_historico WHERE texto_id = ?1 AND id NOT IN (SELECT id FROM textos_historico WHERE texto_id = ?1 ORDER BY created_at DESC, versao DESC LIMIT ${GUARDADOS})`).bind(t.id),
  ]);
}

export async function listarHistorico(env: Env, tenantId: string, textoId: string) {
  const { results } = await env.DB.prepare(
    `SELECT h.id, h.versao, h.titulo, h.created_at AS em, COALESCE(u.name, '') AS por FROM textos_historico h LEFT JOIN "user" u ON u.id = h.por
      WHERE h.texto_id = ? AND h.tenant_id = ? ORDER BY h.created_at DESC, h.versao DESC`,
  ).bind(textoId, tenantId).all<{ id: string; versao: number; titulo: string; em: string; por: string }>();
  return results;
}

export async function lerRetrato(env: Env, tenantId: string, textoId: string, id: string) {
  const r = await env.DB.prepare('SELECT versao, titulo, doc_json FROM textos_historico WHERE id = ? AND texto_id = ? AND tenant_id = ?')
    .bind(id, textoId, tenantId).first<{ versao: number; titulo: string; doc_json: string }>();
  if (!r) throw new ErroMesa('nao_encontrado', 'não encontrado', 404, 'not found');
  return { versao: r.versao, titulo: r.titulo, doc: JSON.parse(r.doc_json) as unknown };
}
