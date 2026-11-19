// Screens in Portuguese and English, per person. Against `wrangler dev` with the seeded local D1 (README, Local
// testing). The choice at sign-in stays in this browser; the account menu's is stored on the account. Axe 0 in English.
// Screenshots in design/telas/idioma/.
import { part } from "./parts";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PRINTS = "design/telas/idioma";
const SCREENS = { celular: { width: 390, height: 844 }, computador: { width: 1440, height: 900 } } as const;
const DESIGN = { email: "design@redacao.dev", senha: "senha-forte-123", veiculo: "portal-litoral" };
const ORIGIN = { origin: "http://localhost:8787" };

async function look(page: Page, label: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  const w = page.viewportSize()!.width;
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path: `${PRINTS}/${label}-${w}.png`, fullPage: true });
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .setLegacyMode(true).options({ iframes: false }).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), label).toEqual([]);
}

const lang = (page: Page) => page.evaluate(() => document.documentElement.lang);

for (const [view, viewport] of Object.entries(SCREENS)) {
  test.describe(view, () => {
    test.use({ viewport, deviceScaleFactor: view === "celular" ? 2 : 1 });
    // The test account is the same as the other specs': it goes back to Portuguese at the end, whatever happens.
    test.afterEach(async ({ page }) => {
      await page.request.put("/api/me/idioma", { data: { idioma: "pt-BR" }, headers: ORIGIN }).catch(() => {});
    });

    test("screens in English: choose at login, see the screens and go back to Portuguese from the account menu", async ({ page }) => {
      await page.goto("/entrar");
      expect(await lang(page)).toBe("pt-BR");
      // The language choice is in view on arrival, with the current one marked.
      await expect(page.getByRole("group", { name: "Idioma · Language" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Português" })).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("button", { name: "English" }).click();
      expect(await lang(page)).toBe("en");
      await expect(page.getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByLabel("Email")).toBeVisible();
      await look(page, "entrar");

      await page.getByLabel("Email").fill(DESIGN.email);
      await page.getByLabel("Password").fill(DESIGN.senha);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      // Sign-in lands on the first outlet by name, which depends on what other specs created: open this one.
      await expect(page).toHaveURL(/\/t\/[^/]+$/);
      await page.goto(`/t/${DESIGN.veiculo}`);
      await expect(page).toHaveTitle(/Ideas/);
      expect(await lang(page)).toBe("en");
      // The sign-in choice overrides the one the account had (Portuguese, at the end of the previous test) and goes to the account.
      await expect.poll(async () => (await (await page.request.get("/api/me")).json()).user.idioma).toBe("en");
      await look(page, "ideias");

      // A carousel in review: buttons and labels in English; the cards' text belongs to the outlet and does not change.
      const list = await (await page.request.get(`/api/t/${DESIGN.veiculo}/pecas`)).json();
      const carousel = (list.pecas as { id: string; status: string; formato: string }[]).find((p) => p.status === "revisao" && p.formato === "carrossel");
      expect(carousel, "D1 local precisa de um carrossel em revisão (README, Teste local)").toBeTruthy();
      await page.goto(`/t/${DESIGN.veiculo}/p/${carousel!.id}`);
      await expect(page.getByRole("button", { name: "Edit the cards" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Approve" }).first()).toBeVisible();
      await look(page, "revisao");

      await page.goto(`/t/${DESIGN.veiculo}/veiculo?aba=marca`);
      await expect(page.getByRole("tab", { name: "Brand" }).or(page.getByRole("link", { name: "Brand" })).first()).toBeVisible();
      await look(page, "marca");
      // Post language (the outlet's, not the screen's): the card preview changes along. Without saving: the test account is shared.
      const preview = page.locator("iframe").first();
      await expect(preview).toHaveAttribute("srcdoc", /lang="pt-BR"[\s\S]*Publicação/);
      await part(page, "Type and language");
      await page.getByRole("radio", { name: "English" }).check();
      await expect(preview).toHaveAttribute("srcdoc", /lang="en"[\s\S]*Published[\s\S]*Source:/);
      await expect(page.getByText("Unsaved changes in Name and colors.")).toBeVisible();
      await look(page, "marca-posts-em-ingles");
      // Undoes before leaving (a pending change asks for confirmation when leaving the page).
      await page.getByRole("radio", { name: "Português" }).check();
      await expect(page.getByText("Unsaved changes in Name and colors.")).toHaveCount(0);

      // An API error in the screen's language (x-idioma header).
      const error = await page.request.put("/api/me/idioma", { data: { idioma: "fr" }, headers: { ...ORIGIN, "x-idioma": "en" } });
      expect(await error.json()).toEqual({ erro: "idioma: pt-BR or en" });

      // Account menu: Português brings everything back and is stored on the account.
      await page.goto(`/t/${DESIGN.veiculo}`);
      await page.getByRole("button", { name: /^Account/ }).click();
      await page.getByRole("menuitemradio", { name: "Português" }).click();
      await expect(page).toHaveTitle(/Ideias/);
      expect(await lang(page)).toBe("pt-BR");
      const me = await (await page.request.get("/api/me")).json();
      expect(me.user.idioma).toBe("pt-BR");
    });
  });
}
