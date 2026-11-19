// The owner's usage panel: enters through the account menu, shows totals and tables, and the number rises by itself when
// a new call arrives. A non-owner sees "not found". Requires ADMIN_USER_IDS with design@redacao.dev's id in .dev.vars.
// Screenshots in design/telas/uso/.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const PRINTS = "design/telas/uso";
const DESIGN = { email: "design@redacao.dev", senha: "senha-forte-123" };
const REPORTER = { email: "reporter@redacao.dev", senha: "senha-forte-123" };
const SCREENS = { celular: { width: 390, height: 844 }, computador: { width: 1440, height: 900 } } as const;
const TEST_MODEL = "modelo-do-e2e";

function sql(command: string) {
  const file = "test-results/uso.sql";
  writeFileSync(file, command);
  const r = spawnSync(`npx wrangler d1 execute redacao-db --local --file ${file}`, { shell: true, stdio: "ignore" });
  if (r.status !== 0) throw new Error(`sql falhou: ${command.slice(0, 80)}`);
}
const line = (fn: string, cost: number) => `INSERT INTO uso_modelo (tenant_id, funcao, modelo, entrada, saida, cache_lido, custo_usd) VALUES ('cartas-da-orla', '${fn}', '${TEST_MODEL}', 1000, 200, 300, ${cost});`;

test.afterAll(() => sql(`DELETE FROM uso_modelo WHERE modelo = '${TEST_MODEL}';`));

async function signIn(page: Page, language: "pt-BR" | "en", account = DESIGN) {
  await page.goto("/entrar");
  await page.evaluate((i) => localStorage.setItem("redacao:idioma", i), language);
  await page.reload();
  await page.locator("input[type=email]").fill(account.email);
  await page.locator("input[type=password]").fill(account.senha);
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/t\//);
  // The account stores the language, and it beats the browser's one.
  await page.request.put("/api/me/idioma", { data: { idioma: language }, headers: { origin: "http://localhost:8787" } });
  await page.evaluate((i) => localStorage.setItem("redacao:idioma", i), language);
  await page.reload();
}

for (const [view, viewport] of Object.entries(SCREENS)) {
  for (const language of ["pt-BR", "en"] as const) {
    test.describe(`${view} · ${language}`, () => {
      test.use({ viewport, locale: language, deviceScaleFactor: view === "celular" ? 2 : 1 });
      test.afterEach(async ({ page }) => { await page.request.put("/api/me/idioma", { data: { idioma: "pt-BR" }, headers: { origin: "http://localhost:8787" } }).catch(() => {}); });
      const name = language === "en" ? "Token usage" : "Consumo de tokens";
      const newFunction = language === "en" ? "Second read" : "Segunda leitura";

      test("the owner finds it in the menu, reads the numbers, and the new call appears on its own", async ({ page }) => {
        sql(`DELETE FROM uso_modelo WHERE modelo = '${TEST_MODEL}';${line("conferencia", 0.0123)}`);
        await signIn(page, language);
        await page.getByRole("button", { name: /Design/ }).last().click();
        await page.getByRole("menuitem", { name: name }).click();
        await expect(page).toHaveURL(/\/admin\/uso/);
        await expect(page.getByRole("heading", { name: name, level: 1 })).toBeVisible();
        await expect(page.getByRole("region", { name: language === "en" ? "By publication" : "Por veículo" })).toContainText("Cartas da Orla");
        await expect(page.getByText(TEST_MODEL).first()).toBeVisible();

        const last = page.getByRole("region", { name: language === "en" ? "Latest calls" : "Últimas chamadas" });
        await expect(last.getByText(newFunction)).toHaveCount(0);
        sql(line("segunda_leitura", 0.0456));
        await expect(last.getByText(newFunction).first()).toBeVisible({ timeout: 10_000 });   // without reloading

        const width = await page.evaluate(() => document.documentElement.scrollWidth);
        expect(width).toBeLessThanOrEqual(viewport.width);
        await page.getByRole("button", { name: language === "en" ? "7 days" : "7 dias" }).click();
        await expect(page).toHaveURL(/dias=7/);
        await expect(page.getByRole("region", { name: language === "en" ? "By day" : "Por dia" })).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: `${PRINTS}/uso${language === "en" ? "-en" : ""}-${viewport.width}.png`, fullPage: true });
        const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).setLegacyMode(true).options({ iframes: false }).analyze();
        expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
      });

      test("non-owners see page not found and do not have the item in the menu", async ({ page }) => {
        await signIn(page, language, REPORTER);
        await page.goto("/admin/uso");
        await expect(page.getByText(language === "en" ? "Page not found" : "Página não encontrada")).toBeVisible();
        await expect(page.getByText(TEST_MODEL)).toHaveCount(0);
      });
    });
  }
}
