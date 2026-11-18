// Equipe: convidar por e-mail e aceitar pelo link. Sem e-mail transacional nesta fase: a tela mostra o link
// `/entrar?convite=<id>` para o admin mandar à mão. Aceitar exige sessão, o id (aleatório, só quem recebeu o link
// tem) e o e-mail da conta igual ao convidado: o cadastro é aberto e sem verificação de e-mail, então registrar o
// endereço convidado, sozinho, não dá acesso a nada.
import { novoId } from '../lib/db';

export const PAPEIS_CONVITE = ['editor', 'reporter'] as const;
export type PapelConvite = (typeof PAPEIS_CONVITE)[number];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** E-mail normalizado (minúsculas, sem espaço) ou null. */
export function emailValido(v: unknown): string | null {
  const e = String(v ?? '').trim().toLowerCase();
  return e.length <= 254 && EMAIL.test(e) ? e : null;
}

export const papelConvite = (v: unknown): PapelConvite | null =>
  (PAPEIS_CONVITE as readonly string[]).includes(String(v)) ? (v as PapelConvite) : null;

export const linkConvite = (id: string) => `/entrar?convite=${encodeURIComponent(id)}`;

export type Aceite = { ok: true; slug: string; papel: string; jaEra: boolean } | { ok: false; motivo: 'nao_encontrado' | 'outro_email' };

/**
 * Aceitar o convite `id` para a conta `userId`/`email`: vira membro do veículo com o papel do convite e o convite fica
 * marcado como aceito. Idempotente (de novo, ou já membro: `jaEra`). E-mail diferente do convidado → `outro_email`.
 */
export async function aceitarConvite(db: D1Database, id: string, userId: string, email: string): Promise<Aceite> {
  const c = await db.prepare(
    'SELECT c.tenant_id, c.email, c.papel, c.aceito_em, t.slug FROM convites c JOIN tenants t ON t.id = c.tenant_id WHERE c.id = ?',
  ).bind(id).first<{ tenant_id: string; email: string; papel: string; aceito_em: string | null; slug: string }>();
  if (!c) return { ok: false, motivo: 'nao_encontrado' };
  if (c.email !== email.trim().toLowerCase()) return { ok: false, motivo: 'outro_email' };
  const ja = await db.prepare('SELECT papel FROM membros WHERE tenant_id = ? AND user_id = ?').bind(c.tenant_id, userId).first<{ papel: string }>();
  if (ja) {
    if (!c.aceito_em) await db.prepare("UPDATE convites SET aceito_em = datetime('now') WHERE id = ?").bind(id).run();
    return { ok: true, slug: c.slug, papel: ja.papel, jaEra: true };
  }
  await db.batch([
    db.prepare('INSERT INTO membros (id, tenant_id, user_id, papel) VALUES (?, ?, ?, ?)').bind(novoId(), c.tenant_id, userId, c.papel),
    db.prepare("UPDATE convites SET aceito_em = datetime('now') WHERE id = ?").bind(id),
  ]);
  return { ok: true, slug: c.slug, papel: c.papel, jaEra: false };
}
