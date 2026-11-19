// The AI keys tab, for real against the local D1 and the fake providers of web/e2e/fake-model.ts (DEEPSEEK_URL,
// GEMINI_URL, FAL_URL and SEGUNDA_URL of `npm run dev:e2e`): what is in use, a refused key that is not stored, an
// accepted key that appears only with its last 4, choosing Gemini (only with a key), removing. Key, role and order
// rules are in test/ai-keys.test.ts. Axe 0. Screenshots in design/telas/chaves/.
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { goDownModel, uploadModel } from "./fake-model";

const PRINTS = "design/telas/chaves";
const SCREENS = { celular: { width: 390, height: 844 }, computador: { width: 1440, height: 900 } } as const;
const DESIGN = { email: "design@redacao.dev", senha: "senha-forte-123", veiculo: "portal-litoral" };
const ORIGIN = { origin: "http://localhost:8787" };
const GOOD = "sk-chave-boa-do-e2e-00001234";

test.beforeAll(async () => { await uploadModel(); });
test.afterAll(async () => { await goDownModel(); });

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

async function newOutlet(page: Page) {
  const r = await page.request.post("/api/tenants", { data: { nome: `Chaves ${Date.now()}`, modo: "tematico" }, headers: ORIGIN });
  expect(r.ok()).toBe(true);
  return (await r.json()) as { id: string; slug: string };
}

const item = (page: Page, name: string) => page.getByRole("listitem", { name: name, exact: true });

for (const [view, viewport] of Object.entries(SCREENS)) {
  test.describe(view, () => {
    test.use({ viewport, deviceScaleFactor: view === "celular" ? 2 : 1 });

    test("paste, refuse, choose and remove; the key never shows up again", async ({ page }) => {
      await signIn(page);
      const v = await newOutlet(page);
      await page.goto(`/t/${v.slug}/veiculo?aba=chaves`);
      await expect(page.getByRole("heading", { name: "Chaves de IA", level: 1 })).toBeVisible();
      const inUse = page.getByRole("region", { name: "Em uso agora" });
      await expect(inUse.getByRole("listitem").filter({ hasText: "Texto" })).toContainText("DeepSeek, com a chave do servidor");
      await expect(inUse.getByRole("listitem").filter({ hasText: "Segunda opinião" })).toContainText("com a chave do servidor");
      await look(page, "inicio");

      // Refused by the provider: not stored, and it says why.
      const deepseek = item(page, "DeepSeek");
      await deepseek.getByLabel("Colar a chave").fill("sk-chave-recusada-do-e2e-0000");
      await deepseek.getByRole("button", { name: "Salvar DeepSeek" }).click();
      await expect(deepseek.getByRole("alert")).toHaveText("O DeepSeek recusou essa chave. Confira se ela foi copiada inteira e se ainda está ativa.");
      await expect(deepseek).toContainText("chave do servidor");

      // Accepted: leaves the field and only the ending stays.
      await deepseek.getByLabel("Colar a chave").fill(GOOD);
      await deepseek.getByRole("button", { name: "Salvar DeepSeek" }).click();
      await expect(deepseek.getByRole("status")).toHaveText("Chave do DeepSeek aceita e salva.");
      await expect(deepseek).toContainText("chave do veículo terminando em ••••1234");
      await expect(deepseek.getByLabel("Trocar a chave")).toHaveValue("");
      await expect(inUse.getByRole("listitem").filter({ hasText: "Texto" })).toContainText("DeepSeek, com a chave do veículo");

      // Gemini can only be chosen with a key; with one, it starts writing.
      await page.getByRole("radio", { name: "Gemini" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "Salve a chave do Gemini antes de escolher." })).toBeVisible();
      await expect(page.getByRole("radio", { name: "DeepSeek" })).toBeChecked();
      const gemini = item(page, "Gemini");
      await gemini.getByLabel("Colar a chave").fill("AIza-chave-do-e2e-000000005678");
      await gemini.getByRole("button", { name: "Salvar Gemini" }).click();
      await expect(gemini).toContainText("chave do veículo terminando em ••••5678");
      await page.getByRole("radio", { name: "Gemini" }).click();
      await expect(inUse.getByRole("listitem").filter({ hasText: "Texto" })).toContainText("Gemini, com a chave do veículo");
      await expect(page.getByRole("radio", { name: "Gemini" })).toBeChecked();
      await expect(page.getByRole("link", { name: "Pegar a chave no site do Gemini" })).toHaveAttribute("href", "https://aistudio.google.com/apikey");
      await look(page, "com-chaves");

      // The key does not come back: neither on screen nor in the tab's GET.
      expect(await page.content()).not.toContain(GOOD);
      const state = await page.request.get(`/api/t/${v.id}/chaves-ia`);
      expect(await state.text()).not.toContain(GOOD);

      // fal: checked through the status of a request that does not exist.
      const fal = item(page, "fal");
      await fal.getByLabel("Colar a chave").fill("fal-chave-do-e2e-0000000009999");
      await fal.getByRole("button", { name: "Salvar fal" }).click();
      await expect(fal).toContainText("chave do veículo terminando em ••••9999");
      await page.getByRole("radio", { name: "fal" }).click();
      await expect(inUse.getByRole("listitem").filter({ hasText: "Ilustração" })).toContainText("fal, com a chave do veículo");

      // Remove the DeepSeek key: the server's one comes back.
      await deepseek.getByRole("button", { name: "Remover DeepSeek" }).click();
      await expect(deepseek).toContainText("chave do servidor");
      await expect(deepseek.getByRole("button", { name: "Remover DeepSeek" })).toHaveCount(0);
    });
  });
}
