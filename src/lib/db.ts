import type { Env } from '../env';

export const newId = () => crypto.randomUUID();

/**
 * Log event. `chave` = idempotency: the same effect replayed (a re-run Workflow step, a redelivered queue message) is
 * not written twice. Status never goes through here: state transitions live in kernel/states.ts.
 */
export function stmtEvent(env: Env, e: { tenantId: string | null; tipo: string; refTipo: string; refId: string; payload?: unknown; chave?: string }) {
  return env.DB.prepare('INSERT OR IGNORE INTO eventos (tenant_id, tipo, ref_tipo, ref_id, payload_json, chave) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(e.tenantId, e.tipo, e.refTipo, e.refId, e.payload == null ? null : JSON.stringify(e.payload), e.chave ?? null);
}

export async function recordEvent(env: Env, tenantId: string | null, type: string, refType: string, refId: string, payload: unknown = null, key?: string) {
  await stmtEvent(env, { tenantId, tipo: type, refTipo: refType, refId, payload, chave: key }).run();
}

export async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
