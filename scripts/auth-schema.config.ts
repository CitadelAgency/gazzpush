// Only for the Better Auth CLI to generate the schema (npm run auth:schema). The Worker uses src/shell/auth.ts with D1.
// In-memory SQLite on Node: the CLI introspects the empty database and emits the complete CREATE TABLE.
import { DatabaseSync } from 'node:sqlite';
import { betterAuth } from 'better-auth';
import { optionsAuth } from '../src/shell/auth';

export const auth = betterAuth({
  ...optionsAuth({ PUBLIC_BASE_URL: 'http://localhost:8787', BETTER_AUTH_SECRET: 'cli-only-not-a-secret-000000000000', GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'x' }),
  database: new DatabaseSync(':memory:'),
});
