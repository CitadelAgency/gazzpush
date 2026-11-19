// Phase 4: the "Summarise the day" button (the response is simulated: production uses remote models and Browser
// Rendering, covered in test/digest.test.ts) and the Sources tab's box, for real against the local D1. Axe 0.
// Screenshots in design/telas/resumo/.
import { part } from "./parts";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PRINTS = "design/telas/resumo";
const SCREENS = { celular: { width: 390, height: 844 }, computador: { width: 1440, height: 900 } } as const;
const DESIGN = { email: "design@redacao.dev", senha: "senha-forte-123", veiculo: "portal-litoral" };
const ORIGIN = { origin: "http://localhost:8787" };

async function look(page: Page, label: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path: `${PRINTS}/${label}-${page.viewportSize()!.width}.png`, fullPage: true });
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).setLegacyMode(true).options({ iframes: false }).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), label).toEqual([]);
}

async function signIn(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(DESIGN.email);
  await page.getByLabel("Senha").fill(DESIGN.senha);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  // Sign-in lands on the first outlet by name, which depends on what other specs created: open this one.
  await expect(page).toHaveURL(/\/t\/[^/]+$/);
  await page.goto(`/t/${DESIGN.veiculo}`);
}

const answer = (page: Page, status: number, body: unknown) =>
  page.route("**/api/t/*/resumo", (route) => (route.request().method() === "POST" ? route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }) : route.continue()));

for (const [view, viewport] of Object.entries(SCREENS)) {
  test.describe(view, () => {
    test.use({ viewport, deviceScaleFactor: view === "celular" ? 2 : 1 });
    test.afterEach(async ({ page }) => {
      await page.request.patch(`/api/t/${DESIGN.veiculo}/resumo`, { data: { ligado: false }, headers: ORIGIN }).catch(() => {});
      await page.request.put("/api/me/idioma", { data: { idioma: "pt-BR" }, headers: ORIGIN }).catch(() => {});
    });

    test("Summarize the day says what happened, and the Sources tab turns on the 6pm one", async ({ page }) => {
      await signIn(page);
      await answer(page, 409, { situacao: "poucas", encontradas: 2, erro: "Só 2 notícias nas últimas 24 horas. O resumo precisa de 3." });
      await page.getByRole("button", { name: "Resumir o dia" }).click();
      await expect(page.getByRole("alert")).toHaveText("Só 2 notícias nas últimas 24 horas. O resumo precisa de 3.");
      await look(page, "poucas");
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await answer(page, 201, { situacao: "nova", pautaId: "resumo", pecaId: "p" });
      await page.getByRole("button", { name: "Resumir o dia" }).click();
      await expect(page.getByRole("status").filter({ hasText: "sendo produzido" })).toBeVisible();
      await look(page, "feito");
      await page.unrouteAll({ behavior: "ignoreErrors" });

      await page.goto(`/t/${DESIGN.veiculo}/veiculo?aba=fontes`);
      await part(page, "Resumo do dia");
      const box = page.getByRole("checkbox", { name: /Resumo do dia às 18h/ });
      await expect(box).not.toBeChecked();
      await box.click();
      await expect(box).toBeChecked();
      await look(page, "fontes");
      await page.reload();
      await expect(page.getByRole("checkbox", { name: /Resumo do dia às 18h/ })).toBeChecked();
    });

    test("in English: the button and the checkbox", async ({ page }) => {
      await signIn(page);
      await page.request.put("/api/me/idioma", { data: { idioma: "en" }, headers: ORIGIN });
      await page.goto(`/t/${DESIGN.veiculo}`);
      await expect(page.getByRole("button", { name: "Sum up the day" })).toBeVisible();
      await page.goto(`/t/${DESIGN.veiculo}/veiculo?aba=fontes`);
      await part(page, "Daily roundup");
      await expect(page.getByRole("checkbox", { name: /Daily roundup at 6 p\.m\./ })).toBeVisible();
    });
  });
}
