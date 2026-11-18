import { betterAuth, type BetterAuthOptions } from 'better-auth';
import type { Env } from '../env';

/**
 * Opções do Better Auth sem o banco. Compartilhado entre o Worker (D1 por request) e o config da CLI
 * (scripts/auth-schema.config.ts), que usa as mesmas opções pra gerar migrations/0002_auth.sql.
 */
export function opcoesAuth(env: Pick<Env, 'PUBLIC_BASE_URL' | 'BETTER_AUTH_SECRET' | 'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET'>) {
  const base = env.PUBLIC_BASE_URL.replace(/\/$/, '');
  return {
    appName: 'Gazzpush',
    baseURL: base,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    // CSRF: o Better Auth confere Origin/Referer contra esta lista em toda mutação com cookie.
    trustedOrigins: [base],
    emailAndPassword: { enabled: true, autoSignIn: true, minPasswordLength: 10 },
    // Google entra quando houver client id/secret (docs/HANDOFF-lote1.md §6). Sem eles, só e-mail/senha.
    socialProviders: env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
      : {},
    // Conectar o Google Docs vincula a conta Google à sessão (linkSocial com o escopo drive.file). A pessoa pode usar
    // no Docs um Google de outro e-mail que o do cadastro: o vínculo é pedido por ela, logada.
    account: { accountLinking: { allowDifferentEmails: true } },
    // Credencial do Google só no servidor: as rotas que devolvem token de conta (inclusive o refresh token) saem do
    // roteador HTTP. O Worker usa auth.api.getAccessToken por dentro; a tela pede o token curto do Picker a
    // GET /api/google/token.
    disabledPaths: ['/refresh-token', '/get-access-token'],
    advanced: {
      // httpOnly e SameSite=Lax são o padrão do Better Auth; Secure acompanha o esquema da baseURL.
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
      useSecureCookies: base.startsWith('https://'),
    },
    telemetry: { enabled: false },
  } satisfies Omit<BetterAuthOptions, 'database'>;
}

/** Uma instância por request: o binding D1 só existe dentro do request (factory, não singleton de módulo). */
export function criarAuth(env: Env) {
  return betterAuth({ ...opcoesAuth(env), database: env.DB });
}

export type Auth = ReturnType<typeof criarAuth>;
export type Usuario = Auth['$Infer']['Session']['user'];
