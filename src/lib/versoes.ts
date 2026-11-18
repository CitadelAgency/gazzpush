import type { Env } from '../env';

/**
 * Retrato do texto nas horas que importam (conferência, assinatura, Instagram, página de fontes, pacote): o pacote de
 * defesa leva as versões. A primeira vez que a versão aparece é a que fica. Módulo folha (sem imports da mesa): mesa,
 * assistente, Matéria e escudo chamam daqui sem ciclo.
 */
export async function retratarVersao(env: Env, tenantId: string, t: { id: string; versao: number; titulo: string; paragrafos_json: string }, motivo: 'conferencia' | 'assinatura' | 'instagram' | 'pagina_fontes' | 'pacote') {
  await env.DB.prepare('INSERT OR IGNORE INTO texto_versoes (tenant_id, texto_id, versao, titulo, paragrafos_json, motivo) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(tenantId, t.id, t.versao, t.titulo, t.paragrafos_json, motivo).run();
}
