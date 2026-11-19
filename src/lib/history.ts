// Editor history. Autosave runs on every pause: keeping all of them would fill the database with near-duplicates, so
// one snapshot is kept every 10 minutes, plus the 30 newest per text. Restoring is an ordinary save, done by the screen.
import type { Env } from '../env';
import { newId } from './db';
import { DeskError, structure, type TextLine } from './desk';

const MINUTES = 10;
const SAVED = 30;

/** Stores `t` as it was before saving. `forcar`: before a restore, so the restore can be undone. */
export async function saveSnapshot(env: Env, tenantId: string, t: TextLine, actor: string, force = false) {
  if (!force) {
    const recent = await env.DB.prepare(`SELECT 1 AS x FROM textos_historico WHERE texto_id = ? AND created_at > datetime('now', '-${MINUTES} minutes') LIMIT 1`).bind(t.id).first();
    if (recent) return;
  }
  const { doc } = await structure(t);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO textos_historico (id, tenant_id, texto_id, versao, titulo, doc_json, por) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(newId(), tenantId, t.id, t.versao, t.titulo, JSON.stringify(doc), actor),
    env.DB.prepare(`DELETE FROM textos_historico WHERE texto_id = ?1 AND id NOT IN (SELECT id FROM textos_historico WHERE texto_id = ?1 ORDER BY created_at DESC, versao DESC LIMIT ${SAVED})`).bind(t.id),
  ]);
}

export async function listHistory(env: Env, tenantId: string, textId: string) {
  const { results } = await env.DB.prepare(
    `SELECT h.id, h.versao, h.titulo, h.created_at AS em, COALESCE(u.name, '') AS por FROM textos_historico h LEFT JOIN "user" u ON u.id = h.por
      WHERE h.texto_id = ? AND h.tenant_id = ? ORDER BY h.created_at DESC, h.versao DESC`,
  ).bind(textId, tenantId).all<{ id: string; versao: number; titulo: string; em: string; por: string }>();
  return results;
}

export async function readSnapshot(env: Env, tenantId: string, textId: string, id: string) {
  const r = await env.DB.prepare('SELECT versao, titulo, doc_json FROM textos_historico WHERE id = ? AND texto_id = ? AND tenant_id = ?')
    .bind(id, textId, tenantId).first<{ versao: number; titulo: string; doc_json: string }>();
  if (!r) throw new DeskError('nao_encontrado', 'não encontrado', 404, 'not found');
  return { versao: r.versao, titulo: r.titulo, doc: JSON.parse(r.doc_json) as unknown };
}
