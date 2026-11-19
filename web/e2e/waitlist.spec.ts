// Waitlist: the public door. Prices in view, sign-up at both sizes, in both languages. Screenshots in design/telas/lista-espera/.
import { spawnSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const PRINTS = "design/telas/lista-espera";
const SCREENS = { celular: { width: 390, height: 844 }, computador: { width: 1440, height: 900 } } as const;

function sql(command: string) {
  const r = spawnSync(`npx wrangler d1 execute redacao-db --local --command "${command}"`, { shell: true, stdio: "ignore" });
  if (r.status !== 0) throw new Error(`sql falhou: ${command}`);
}
const clean = () => sql("DELETE FROM lista_espera WHERE email LIKE '%@lista.e2e'");

async function look(page: Page, label: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
  const w = page.viewportSize()!.width;
  await page.screenshot({ path: `${PRINTS}/${label}-${w}.png`, fullPage: true });
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).setLegacyMode(true).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), label).toEqual([]);
}

test.beforeAll(clean);
test.afterAll(clean);

for (const [view, viewport] of Object.entries(SCREENS)) {
  test.describe(view, () => {
    test.use({ viewport, locale: "pt-BR", deviceScaleFactor: view === "celular" ? 2 : 1 });

    test("without a session, / opens the list with the prices; the button stays in view", async ({ page }) => {
      await page.goto("/");
      await expect(page).toHaveURL(/\/lista-de-espera$/);
      await expect(page).toHaveTitle(/Lista de espera/);
      for (const price of ["R$ 99 por mês", "R$ 210 por mês"]) await expect(page.getByText(price, { exact: true })).toBeVisible();
      for (const quota of ["60 posts por mês", "150 posts por mês"]) await expect(page.getByText(new RegExp(quota))).toBeVisible();
      await expect(page.getByRole("radio")).toHaveCount(2);
      await expect(page.getByText(/Grátis|Teste|Cortesia/)).toHaveCount(0);
      const button = await page.getByRole("button", { name: "Entrar na lista de espera" }).boundingBox();
      expect(button!.y + button!.height).toBeLessThanOrEqual(viewport.height);
      await look(page, "lista");
    });

    test("sign-up with a plan: confirms, saves and gets focus", async ({ page }) => {
      const email = `${view}-${Date.now().toString(36)}@lista.e2e`;
      await page.goto("/lista-de-espera");
      await page.getByLabel("E-mail").fill(email);
      await page.getByLabel("Seu nome (opcional)").fill("Ana E2E");
      await page.getByRole("radio", { name: /Página/ }).check();
      await page.getByRole("button", { name: "Entrar na lista de espera" }).click();
      const ok = page.getByRole("status");
      await expect(ok).toContainText("Você está na lista.");
      await expect(ok).toContainText(email);
      await expect(ok).toBeFocused();
      await look(page, "pronto");
    });

    test("empty email holds in the field; email refused by the server returns to the field", async ({ page }) => {
      await page.goto("/lista-de-espera");
      await page.getByRole("button", { name: "Entrar na lista de espera" }).click();
      await expect(page.getByLabel("E-mail")).toBeFocused();
      await page.getByLabel("E-mail").fill("ana@sem-ponto");
      await page.getByRole("button", { name: "Entrar na lista de espera" }).click();
      await expect(page.getByRole("alert")).toHaveText("Confira o e-mail: ele parece incompleto.");
      await expect(page.getByLabel("E-mail")).toBeFocused();
      await expect(page.getByLabel("E-mail")).toHaveAttribute("aria-invalid", "true");
      await look(page, "email-recusado");
    });

    test("limit and network drop: the message appears and what was typed stays", async ({ page }) => {
      await page.goto("/lista-de-espera");
      await page.getByLabel("E-mail").fill(`rede-${view}@lista.e2e`);
      await page.route("**/api/lista-espera", (r) => r.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ erro: "Muitos cadastros seguidos desta conexão. Tente de novo em uma hora." }) }));
      await page.getByRole("button", { name: "Entrar na lista de espera" }).click();
      await expect(page.getByRole("alert")).toContainText("Tente de novo em uma hora");
      await page.unrouteAll();
      await page.route("**/api/lista-espera", (r) => r.abort());
      await page.getByRole("button", { name: "Entrar na lista de espera" }).click();
      await expect(page.getByRole("alert")).toContainText("Sem conexão");
      await expect(page.getByLabel("E-mail")).toHaveValue(`rede-${view}@lista.e2e`);
    });

    test("whoever already has an account reaches sign-in", async ({ page }) => {
      await page.goto("/lista-de-espera");
      await page.getByRole("link", { name: "Entrar" }).click();
      await expect(page).toHaveURL(/\/entrar$/);
      await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
    });

    test("in English, everything changes together, including the server's message", async ({ page }) => {
      await page.goto("/lista-de-espera");
      await page.getByRole("button", { name: "English" }).click();
      await expect(page.getByRole("heading", { name: "Join the waitlist" })).toBeVisible();
      await expect(page).toHaveTitle(/Waitlist/);
      await expect(page.getByText("R$ 99 per month", { exact: true })).toBeVisible();
      await expect(page.getByText(/150 posts per month/)).toBeVisible();
      await look(page, "en");
      await page.getByLabel("Email").fill("ana@sem-ponto");
      await page.getByRole("button", { name: "Join the waitlist" }).click();
      await expect(page.getByRole("alert")).toHaveText("Check the email: it looks incomplete.");
    });
  });
}
