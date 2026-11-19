// Team: invite by email and accept through the link. No transactional email in this phase: the screen shows the
// `/entrar?convite=<id>` link for the admin to send by hand. Accepting requires a session, the id (random; only whoever
// received the link has it) and an account email equal to the invited one: sign-up is open and does not verify email,
// so registering the invited address on its own grants nothing.
import { newId } from '../lib/db';

export const ROLES_INVITE = ['editor', 'reporter'] as const;
export type InviteRole = (typeof ROLES_INVITE)[number];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Normalised email (lower case, no spaces) or null. */
export function validEmail(v: unknown): string | null {
  const e = String(v ?? '').trim().toLowerCase();
  return e.length <= 254 && EMAIL.test(e) ? e : null;
}

export const inviteRole = (v: unknown): InviteRole | null =>
  (ROLES_INVITE as readonly string[]).includes(String(v)) ? (v as InviteRole) : null;

export const inviteLink = (id: string) => `/entrar?convite=${encodeURIComponent(id)}`;

export type Accept = { ok: true; slug: string; papel: string; jaEra: boolean } | { ok: false; motivo: 'nao_encontrado' | 'outro_email' };

/**
 * Accepts invite `id` for the account `userId`/`email`: they become a member of the outlet with the invite's role and
 * the invite is marked accepted. Idempotent (again, or already a member: `jaEra`). An email different from the invited
 * one → `outro_email`.
 */
export async function acceptInvite(db: D1Database, id: string, userId: string, email: string): Promise<Accept> {
  const c = await db.prepare(
    'SELECT c.tenant_id, c.email, c.papel, c.aceito_em, t.slug FROM convites c JOIN tenants t ON t.id = c.tenant_id WHERE c.id = ?',
  ).bind(id).first<{ tenant_id: string; email: string; papel: string; aceito_em: string | null; slug: string }>();
  if (!c) return { ok: false, motivo: 'nao_encontrado' };
  if (c.email !== email.trim().toLowerCase()) return { ok: false, motivo: 'outro_email' };
  const already = await db.prepare('SELECT papel FROM membros WHERE tenant_id = ? AND user_id = ?').bind(c.tenant_id, userId).first<{ papel: string }>();
  if (already) {
    if (!c.aceito_em) await db.prepare("UPDATE convites SET aceito_em = datetime('now') WHERE id = ?").bind(id).run();
    return { ok: true, slug: c.slug, papel: already.papel, jaEra: true };
  }
  await db.batch([
    db.prepare('INSERT INTO membros (id, tenant_id, user_id, papel) VALUES (?, ?, ?, ?)').bind(newId(), c.tenant_id, userId, c.papel),
    db.prepare("UPDATE convites SET aceito_em = datetime('now') WHERE id = ?").bind(id),
  ]);
  return { ok: true, slug: c.slug, papel: c.papel, jaEra: false };
}
