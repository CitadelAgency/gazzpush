import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { FAKE_ROOT } from './test/fake-tsa';

// The real Worker (wrangler.jsonc) inside workerd, with local D1/R2/KV/Workflows. Remote bindings (AI, Browser,
// Vectorize) are off: tests do not talk to Cloudflare. Test secrets override .dev.vars.
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
            DEEPSEEK_API_KEY: 'sk-teste',
            // Legal shield: nothing goes out to the network in tests (Wayback and the TSA are .example, simulated through fetch).
            WAYBACK_URL: 'https://wayback.example',
            TSA_URL: 'https://tsa.example/tsr',
            TSA_RAIZ: FAKE_ROOT,
            // Ask the document: word search only; the test that turns on semantic search passes a simulated index.
            BUSCA_VETORIAL: 'desligada',
            // Recordings: Whisper is simulated (a .example server through fetch).
            WHISPER_URL: 'https://whisper.example/transcrever',
            // Living story: DataJud is simulated (a .example server through fetch); the key only turns tracking on.
            DATAJUD_URL: 'https://datajud.example',
            CF_ACCOUNT_ID: 'conta-teste',
            AI_GATEWAY_ID: '',
            KIE_API_KEY: '',
            // AI keys: Gemini and fal through the test address (simulated through fetch); no server key.
            GEMINI_URL: 'https://gemini.example',
            FAL_URL: 'https://fal.example',
            KIE_URL: 'https://kie.example',
            GEMINI_API_KEY: '',
            FAL_KEY: '',
            INSTALACAO_PROPRIA: '',
            GOOGLE_CLIENT_ID: '',
            GOOGLE_CLIENT_SECRET: '',
          },
        },
      }),
    ],
    // Only test/: web/e2e is Playwright (npm run e2e), it does not run in workerd.
    // A 20 s timeout: route tests build an outlet, a text and dozens of requests in workerd; with a busy machine the
    // heaviest ones went over the default 5 s and failed on time, a different one each run.
    test: { include: ['test/**/*.test.ts'], setupFiles: ['./test/setup.ts'], testTimeout: 20_000 },
  };
});
