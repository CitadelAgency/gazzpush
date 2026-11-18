import type { Env } from '../env';

export const novoId = () => crypto.randomUUID();

/**
 * Evento de log. `chave` = idempotência: o mesmo efeito replayado (step de Workflow re-executado, mensagem de fila
 * reentregue) não grava duas vezes. Status nunca passa por aqui: transição de estado é kernel/estados.ts.
 */
export function eventoStmt(env: Env, e: { tenantId: string | null; tipo: string; refTipo: string; refId: string; payload?: unknown; chave?: string }) {
  return env.DB.prepare('INSERT OR IGNORE INTO eventos (tenant_id, tipo, ref_tipo, ref_id, payload_json, chave) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(e.tenantId, e.tipo, e.refTipo, e.refId, e.payload == null ? null : JSON.stringify(e.payload), e.chave ?? null);
}

export async function registrarEvento(env: Env, tenantId: string | null, tipo: string, refTipo: string, refId: string, payload: unknown = null, chave?: string) {
  await eventoStmt(env, { tenantId, tipo, refTipo, refId, payload, chave }).run();
}

export async function sha256Hex(texto: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
