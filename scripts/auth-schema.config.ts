// Só pra CLI do Better Auth gerar o schema (npm run auth:schema). O Worker usa src/shell/auth.ts com D1.
// SQLite em memória do Node: a CLI introspecta o banco vazio e emite o CREATE TABLE completo.
import { DatabaseSync } from 'node:sqlite';
import { betterAuth } from 'better-auth';
import { opcoesAuth } from '../src/shell/auth';

export const auth = betterAuth({
  ...opcoesAuth({ PUBLIC_BASE_URL: 'http://localhost:8787', BETTER_AUTH_SECRET: 'cli-only-not-a-secret-000000000000', GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'x' }),
  database: new DatabaseSync(':memory:'),
});
