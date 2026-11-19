import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

// Tests with the real model (they cost calls; outside `npm test`): `npm run symmetry`. The same Worker and local D1 as
// vitest.config.ts, but with the keys from .dev.vars (DeepSeek and, if present, the second provider) and the AI Gateway.
export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        remoteBindings: false,
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            PUBLIC_BASE_URL: 'http://localhost:8787',
            BETTER_AUTH_SECRET: 'teste-teste-teste-teste-teste-teste-0000',
            TOKEN_ENC_KEY: 'chave-de-teste',
          },
        },
      }),
    ],
    test: { include: ['scripts/symmetry/**/*.test.ts'], setupFiles: ['./test/setup.ts'], testTimeout: 600_000 },
  };
});
