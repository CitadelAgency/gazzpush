import { betterAuth, type BetterAuthOptions } from 'better-auth';
import type { Env } from '../env';

/**
 * Better Auth options without the database. Shared between the Worker (D1 per request) and the CLI config
 * (scripts/auth-schema.config.ts), which uses the same options to generate migrations/0002_auth.sql.
 */
export function optionsAuth(env: Pick<Env, 'PUBLIC_BASE_URL' | 'BETTER_AUTH_SECRET' | 'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET'>) {
  const base = env.PUBLIC_BASE_URL.replace(/\/$/, '');
  return {
    appName: 'Gazzpush',
    baseURL: base,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    // CSRF: Better Auth checks Origin/Referer against this list on every mutation with a cookie.
    trustedOrigins: [base],
    emailAndPassword: { enabled: true, autoSignIn: true, minPasswordLength: 10 },
    // Google comes in when there is a client id/secret (docs/HANDOFF-lote1.md §6). Without them, email/password only.
    socialProviders: env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
      : {},
    // Connecting Google Docs links the Google account to the session (linkSocial with the drive.file scope). The person
    // may use, for Docs, a Google account with a different email from their sign-up one: they request the link while signed in.
    account: { accountLinking: { allowDifferentEmails: true } },
    // The Google credential stays on the server: the routes that return an account token (the refresh token included) stay off the
    // HTTP router. The Worker uses auth.api.getAccessToken internally; the screen asks for the short-lived Picker token at
    // GET /api/google/token.
    disabledPaths: ['/refresh-token', '/get-access-token'],
    advanced: {
      // httpOnly and SameSite=Lax are Better Auth's defaults; Secure follows the baseURL's scheme.
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
      useSecureCookies: base.startsWith('https://'),
    },
    telemetry: { enabled: false },
  } satisfies Omit<BetterAuthOptions, 'database'>;
}

/** One instance per request: the D1 binding only exists inside the request (a factory, not a module singleton). */
export function createAuth(env: Env) {
  return betterAuth({ ...optionsAuth(env), database: env.DB });
}

export type Auth = ReturnType<typeof createAuth>;
export type User = Auth['$Infer']['Session']['user'];
