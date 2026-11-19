// Public waitlist: no account and no session. The answer is the same for a new and a repeated email, so the page does
// not reveal who is already on the list.
import type { Env } from '../env';
import { summarize } from './crypto';
import { PLANS_PAID, type PaidPlan } from './plansTable';

/** Per IP, per hour. Generous because mobile carriers put many people behind the same IP. */
export const HOURLY_LIMIT = 20;

export type Signup = { email: string; nome: string | null; plano: PaidPlan | null };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** `null` when the email is no good. Name and plan are optional: an odd value in them becomes empty, without blocking sign-up. */
export function readSignup(body: unknown): Signup | null {
  const { email, nome: name, plano: plan } = (body ?? {}) as Record<string, unknown>;
  const clean = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (clean.length > 254 || !EMAIL.test(clean)) return null;
  return {
    email: clean,
    nome: (typeof name === 'string' && name.trim().slice(0, 80)) || null,
    plano: PLANS_PAID.find((p) => p === plan) ?? null,
  };
}

/** False when the IP went over the limit. */
export async function signInInList(env: Env, c: Signup, language: string, ip: string) {
  const ipHash = await summarize(env, 'lista-espera-ip', ip);
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM lista_espera WHERE ip_hash = ? AND created_at > datetime('now', '-1 hour')")
    .bind(ipHash).first<number>('n');
  if ((recent ?? 0) >= HOURLY_LIMIT) return false;
  await env.DB.prepare('INSERT INTO lista_espera (email, nome, plano, idioma, ip_hash) VALUES (?, ?, ?, ?, ?) ON CONFLICT (email) DO NOTHING')
    .bind(c.email, c.nome, c.plano, language, ipHash).run();
  return true;
}
