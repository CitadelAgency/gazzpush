import { createMiddleware } from 'hono/factory';
import type { Env } from '../env';
import { ROLES, type Role } from '../kernel/states';
import { createAuth, type User } from './auth';
import { t } from './language';

export interface TenantCtx { id: string; slug: string; nome: string; papel: Role }
export type AppEnv = { Bindings: Env; Variables: { user: User; tenant: TenantCtx } };

const METHODS_SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF by Origin on the API routes (Better Auth's have its own check). Browsers always send Origin on
 * POST/PUT/PATCH/DELETE; an Origin that is present and different from the public origin → 403. No Origin = a
 * non-browser client (curl, a server), which does not carry a victim's cookie.
 */
export const requireSameOrigin = createMiddleware<AppEnv>(async (c, next) => {
  if (!METHODS_SAFE.has(c.req.method)) {
    const origin = c.req.header('origin');
    if (origin && origin !== new URL(c.env.PUBLIC_BASE_URL).origin) return c.json({ erro: t(c, 'origem não permitida', 'origin not allowed') }, 403);
  }
  await next();
});

/** Required session (Better Auth cookie). Injects c.var.user. */
export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const session = await createAuth(c.env).api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ erro: t(c, 'não autenticado', 'not signed in') }, 401);
  c.set('user', session.user);
  await next();
});

/**
 * Member of the path's tenant (`:tenantId`). Not a member → 404 (does not reveal that the tenant exists).
 * With `papel`, requires that role or higher (admin > editor > reporter) → 403.
 * Can be stacked: the second call reuses c.var.tenant and only checks the role.
 */
export function requireMember(role?: Role) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const tenantId = c.req.param('tenantId');
    let tenant = c.get('tenant');
    if (!tenant || tenant.id !== tenantId) {
      const row = await c.env.DB.prepare(
        'SELECT t.id, t.slug, t.nome, m.papel FROM membros m JOIN tenants t ON t.id = m.tenant_id WHERE m.tenant_id = ? AND m.user_id = ?',
      ).bind(tenantId, c.get('user').id).first<TenantCtx>();
      if (!row) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
      tenant = row;
      c.set('tenant', tenant);
    }
    if (role && ROLES.indexOf(tenant.papel) > ROLES.indexOf(role)) return c.json({ erro: t(c, `exige papel ${role}`, `requires the ${role} role`) }, 403);
    await next();
  });
}

/**
 * Platform operation (not a tenant's): the session's user.id in ADMIN_USER_IDS. Never by email: sign-up is open and
 * does not prove ownership of the address, so whoever first registered an admin's email would get the access.
 */
export const isAdminPlatform = (env: Env, userId: string) => (env.ADMIN_USER_IDS ?? '').split(',').map((e) => e.trim()).filter(Boolean).includes(userId);
export const requireAdminPlatform = createMiddleware<AppEnv>(async (c, next) => {
  if (!isAdminPlatform(c.env, c.get('user').id)) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  await next();
});
