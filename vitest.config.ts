import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

// Worker real (wrangler.jsonc) dentro do workerd, com D1/R2/KV/Workflows locais. Bindings remotos (AI, Browser,
// Vectorize) desligados: teste não fala com a Cloudflare. Secrets de teste sobrescrevem o .dev.vars.
export default defineConfig(async () => {
  const migracoes = await readD1Migrations('./migrations');
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        remoteBindings: false,
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migracoes,
            PUBLIC_BASE_URL: 'http://localhost:8787',
            BETTER_AUTH_SECRET: crypto.randomUUID(),
            TOKEN_ENC_KEY: crypto.randomUUID(),
            DEEPSEEK_API_KEY: crypto.randomUUID(),
            // Escudo jurídico: nada sai para a rede nos testes (o Wayback e a TSA são .example, simulados por fetch).
            WAYBACK_URL: 'https://wayback.example',
            TSA_URL: 'https://tsa.example/tsr',
            // Pergunte ao documento: só por palavra; o teste que liga a busca por sentido passa um índice simulado.
            BUSCA_VETORIAL: 'desligada',
            // Gravações: o Whisper é simulado (servidor .example por fetch).
            WHISPER_URL: 'https://whisper.example/transcrever',
            // Matéria viva: o DataJud é simulado (servidor .example por fetch); a chave só liga o acompanhamento.
            DATAJUD_URL: 'https://datajud.example',
            CF_ACCOUNT_ID: 'conta-teste',
            AI_GATEWAY_ID: '',
            KIE_API_KEY: '',
            // Chaves de IA: Gemini e fal pelo endereço de teste (simulados por fetch); sem chave do servidor.
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
    // Só test/: web/e2e é Playwright (npm run e2e), não roda no workerd.
    // Prazo de 20 s: os testes de rota montam veículo, texto e dezenas de pedidos no workerd; com a máquina ocupada
    // os mais pesados passavam dos 5 s padrão e caíam por tempo, um diferente a cada rodada.
    test: { include: ['test/**/*.test.ts'], setupFiles: ['./test/setup.ts'], testTimeout: 20_000 },
  };
});
