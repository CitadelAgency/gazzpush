import { createMiddleware } from 'hono/factory';
import type { Env } from '../env';
import { PAPEIS, type Papel } from '../kernel/estados';
import { criarAuth, type Usuario } from './auth';
import { t } from './idioma';

export interface TenantCtx { id: string; slug: string; nome: string; papel: Papel }
export type AppEnv = { Bindings: Env; Variables: { user: Usuario; tenant: TenantCtx } };

const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF por Origin nas rotas da API (as do Better Auth têm a checagem dele). Navegador sempre manda Origin em
 * POST/PUT/PATCH/DELETE; Origin presente e diferente da origem pública → 403. Sem Origin = cliente não-navegador
 * (curl, servidor), que não carrega cookie de vítima.
 */
export const exigirMesmaOrigem = createMiddleware<AppEnv>(async (c, next) => {
  if (!METODOS_SEGUROS.has(c.req.method)) {
    const origin = c.req.header('origin');
    if (origin && origin !== new URL(c.env.PUBLIC_BASE_URL).origin) return c.json({ erro: t(c, 'origem não permitida', 'origin not allowed') }, 403);
  }
  await next();
});

/** Sessão obrigatória (cookie do Better Auth). Injeta c.var.user. */
export const exigirSessao = createMiddleware<AppEnv>(async (c, next) => {
  const sessao = await criarAuth(c.env).api.getSession({ headers: c.req.raw.headers });
  if (!sessao) return c.json({ erro: t(c, 'não autenticado', 'not signed in') }, 401);
  c.set('user', sessao.user);
  await next();
});

/**
 * Membro do tenant do path (`:tenantId`). Não membro → 404 (não revela que o tenant existe).
 * Com `papel`, exige esse papel ou maior (admin > editor > reporter) → 403.
 * Pode ser empilhado: a segunda chamada reaproveita c.var.tenant e só confere o papel.
 */
export function requireMembro(papel?: Papel) {
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
    if (papel && PAPEIS.indexOf(tenant.papel) > PAPEIS.indexOf(papel)) return c.json({ erro: t(c, `exige papel ${papel}`, `requires the ${papel} role`) }, 403);
    await next();
  });
}

/**
 * Operação da plataforma (não de tenant): user.id da sessão em ADMIN_USER_IDS. Nunca por e-mail: o cadastro é aberto e
 * não prova posse do endereço, então quem registrasse primeiro um e-mail de admin ganharia o acesso.
 */
export const ehAdminPlataforma = (env: Env, userId: string) => (env.ADMIN_USER_IDS ?? '').split(',').map((e) => e.trim()).filter(Boolean).includes(userId);
export const exigirAdminPlataforma = createMiddleware<AppEnv>(async (c, next) => {
  if (!ehAdminPlataforma(c.env, c.get('user').id)) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  await next();
});
