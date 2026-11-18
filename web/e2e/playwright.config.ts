import { defineConfig } from "@playwright/test";
import { ORIGEM_E2E } from "./origem";

export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  workers: 1,
  reporter: "list",
  webServer: process.env.E2E_ORIGEM ? undefined : {
    command: "npm run web:build && npm exec -- vite preview web --host 127.0.0.1 --port 4187 --strictPort",
    cwd: "../..",
    url: ORIGEM_E2E,
    reuseExistingServer: false,
  },
  use: { baseURL: ORIGEM_E2E, channel: "chromium", locale: "pt-BR", timezoneId: "America/Sao_Paulo" },
});
