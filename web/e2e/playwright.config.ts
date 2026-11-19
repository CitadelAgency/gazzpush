import { defineConfig } from "@playwright/test";
import { ORIGIN_E2_AND } from "./origin";

// E2E against `wrangler dev` (localhost:8787, or `E2E_ORIGEM`) with the seeded local D1 (README "Local testing"). Start
// it first: `npm run web:build && npm run dev`. Screenshots in design/telas/fase-c/.
export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: ORIGIN_E2_AND, channel: "chromium", locale: "pt-BR", timezoneId: "America/Sao_Paulo" },
});
