import type { Env } from '../env';

/**
 * Snapshot of the text at the moments that matter (check, signature, Instagram, sources page, package): the defence
 * package carries the versions. The first time a version appears is the one that stays. Leaf module (no desk imports):
 * desk, assistant, Story and shield call it without a cycle.
 */
export async function retractVersion(env: Env, tenantId: string, t: { id: string; versao: number; titulo: string; paragrafos_json: string }, reason: 'conferencia' | 'assinatura' | 'instagram' | 'pagina_fontes' | 'pacote') {
  await env.DB.prepare('INSERT OR IGNORE INTO texto_versoes (tenant_id, texto_id, versao, titulo, paragrafos_json, motivo) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(tenantId, t.id, t.versao, t.titulo, t.paragrafos_json, reason).run();
}
