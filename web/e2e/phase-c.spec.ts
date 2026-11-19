// Phase C: sign in/create account → create an outlet with logo and colours → empty Ideas; the shell on mobile and
// desktop; loading, error and empty states. Axe without violations on every screen touched. Screenshots in design/telas/fase-c/.
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PRINTS = "design/telas/fase-c";
const SCREENS = { celular: { width: 390, height: 844 }, computador: { width: 1440, height: 900 } } as const;
const DESIGN = { email: "design@redacao.dev", senha: "senha-forte-123", veiculo: "portal-litoral" };

async function look(page: Page, label: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);   // the pencil loop finishes drawing (700 ms)
  const w = page.viewportSize()!.width;
  // Mobile: the visible screen (fixed bars in place) and the whole page; desktop: the whole page.
  if (w > 1000) await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path: `${PRINTS}/${label}-${w}.png`, fullPage: w > 1000 });
  if (w < 1000) await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  if (w < 1000) await page.screenshot({ path: `${PRINTS}/${label}-${w}-inteira.png`, fullPage: true });
  // Legacy mode and iframes: false: the card preview (a script-free iframe) is the product's art, not UI; the iframe
  // itself (title, focus) stays in axe. In normal mode @axe-core/playwright opens a new page to gather the frames'
  // results and Chromium refuses the target ("Failed to find browser context").
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .setLegacyMode(true).options({ iframes: false }).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), label).toEqual([]);
}

async function signInAs(page: Page, email: string, password: string) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
}

for (const [view, viewport] of Object.entries(SCREENS)) {
  test.describe(view, () => {
    test.use({ viewport, deviceScaleFactor: view === "celular" ? 2 : 1 });

    test("sign-up → outlet with logo and colors → empty Ideas", async ({ page }) => {
      const n = Date.now().toString(36);
      await page.goto("/entrar");
      await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
      await look(page, "entrar");

      await page.getByRole("button", { name: "Criar conta" }).click();
      await page.getByLabel("Seu nome").fill("Teste E2E");
      await page.getByLabel("E-mail").fill(`e2e-${n}@redacao.dev`);
      await page.getByLabel("Senha").fill("senha-forte-123");
      await page.getByRole("button", { name: "Criar conta e montar o veículo", exact: true }).click();

      await expect(page).toHaveURL(/\/novo$/);
      await expect(page.getByRole("heading", { name: "Crie o seu veículo" })).toBeVisible();
      await look(page, "novo-1");

      // Without a municipality it does not continue.
      await page.getByLabel("Nome do veículo").fill(`Gazeta ${n}`);
      await page.getByRole("button", { name: "Continuar" }).click();
      await expect(page.getByText("Escolha o município na lista.")).toBeVisible();

      const mun = page.getByRole("combobox", { name: "Município" });
      await mun.fill("guaruja");
      await expect(page.getByRole("option", { name: "Guarujá SP", exact: true })).toBeVisible();
      await look(page, "novo-1-municipio");
      // The second in the list by keyboard; then leaving and returning to the field and pressing Enter must not break the choice.
      await mun.press("ArrowDown");
      await mun.press("Enter");
      await expect(mun).toHaveValue("Guarujá do Sul · SC");
      await page.getByLabel("Nome do veículo").focus();
      await mun.focus();
      await mun.press("Enter");
      await expect(mun).toHaveValue("Guarujá do Sul · SC");
      await mun.fill("guaruja");
      await expect(page.getByRole("option", { name: "Guarujá SP", exact: true })).toBeVisible();
      await mun.press("Enter");
      await expect(mun).toHaveValue("Guarujá · SP");
      await page.getByRole("button", { name: "Continuar" }).click();

      await expect(page).toHaveURL(/\/novo\?marca=gazeta-/);
      await expect(page.getByRole("heading", { name: `A cara do Gazeta ${n}` })).toBeVisible();
      await page.getByLabel("@ no Instagram").fill(`@gazeta_${n}`);
      await page.locator('input[type="file"]').setInputFiles("web/public/icone-192.png");
      await page.getByLabel("Fundo").fill("#7a8a99");
      await page.getByLabel("Texto").fill("#ffffff");
      await expect(page.getByText(/contraste de 3,\d:1/)).toBeVisible();   // aviso AA
      await look(page, "novo-2-aviso");
      await page.getByLabel("Fundo").fill("#14213d");
      await page.getByLabel("Destaque").fill("#fca311");
      await expect(page.getByText(/contraste de/)).toHaveCount(0);
      await expect(page.frameLocator("iframe").locator(".brand-mark")).toBeVisible();
      await look(page, "novo-2");

      // What the server answered on save (read on the route: after navigation the body vanishes from the inspector).
      const saved: Record<string, unknown> = {};
      await page.route(/\/marca(\/logo)?$/, async (route) => {
        const r = await route.fetch();
        saved[route.request().url().endsWith("/logo") ? "logo" : "marca"] = await r.json();
        await route.fulfill({ response: r });
      });
      await page.getByRole("button", { name: "Salvar e ir para as Ideias" }).click();

      await expect(page).toHaveURL(new RegExp(`/t/gazeta-${n}$`));
      expect(saved.marca).toMatchObject({ marca: { handle: `@gazeta_${n}`, cores: { fundo: "#14213d", texto: "#ffffff", acento: "#fca311" } } });
      // One @, one account: the brand's @ became the manual account to post to (Approve is not off on the 1st post).
      const tenant = (await (await page.request.get("/api/me")).json()).tenants.find((t: { slug: string }) => t.slug === `gazeta-${n}`);
      const accounts = (await (await page.request.get(`/api/t/${tenant.id}/contas`)).json()).contas;
      expect(accounts).toEqual([expect.objectContaining({ nome: `@gazeta_${n}`, modo: "manual", status: "ativa" })]);
      expect(saved.logo).toMatchObject({ marca: { temLogo: true } });
      await expect(page.getByRole("heading", { name: "Nenhuma ideia por enquanto" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Nova ideia" })).toBeVisible();
      await look(page, "ideias-vazia");
    });

    test("full Ideas, outlet selector, section not yet arrived, sign out", async ({ page }) => {
      await signInAs(page, DESIGN.email, DESIGN.senha);
      // Sign-in lands on the first outlet by name, which depends on what other specs created: open this one.
      await expect(page).toHaveURL(/\/t\/[^/]+$/);
      await page.goto(`/t/${DESIGN.veiculo}`);
      await expect(page.getByRole("heading", { name: /^(Ideias sugeridas|Ideias novas|Já vistas)/ })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Seções" }).getByRole("link", { name: "Ideias" })).toHaveAttribute("aria-current", "page");
      await look(page, "ideias");

      await page.getByRole("button", { name: /trocar de veículo/ }).click();
      await expect(page.getByRole("menuitem", { name: "Criar outro veículo" })).toBeVisible();
      await look(page, "ideias-menu-veiculo");
      await page.keyboard.press("Escape");

      await page.getByRole("navigation", { name: "Seções" }).getByRole("link", { name: /aprovar/i }).click();
      await expect(page).toHaveURL(new RegExp(`/t/${DESIGN.veiculo}/aprovar$`));
      await expect(page.getByRole("heading", { name: "Para aprovar" })).toBeVisible();
      await look(page, "aprovar-em-breve");

      // Account on the avatar (mobile) or on the sidebar's bottom row (desktop): both open the same menu.
      const clickSignOut = async (photo?: string) => {
        await page.getByRole("button", { name: /^Conta:/ }).filter({ visible: true }).click();
        if (photo) await look(page, photo);
        await page.getByRole("menuitem", { name: "Sair" }).click();
      };
      // Signing out without network: stays on the account and offers to try again (the session stays valid).
      await page.route("**/api/auth/sign-out", (route) => route.abort());
      await clickSignOut("menu-conta");
      await expect(page.getByRole("alert")).toContainText("Não deu para sair agora");
      await expect(page).toHaveURL(new RegExp(`/t/${DESIGN.veiculo}/aprovar$`));
      await look(page, "sair-erro");
      await page.unrouteAll();
      await page.getByRole("alert").getByRole("button", { name: "Tentar de novo" }).click();
      await expect(page).toHaveURL(/\/entrar$/);
      await page.goto(`/t/${DESIGN.veiculo}`);
      await expect(page).toHaveURL(/\/entrar\?de=/);
    });

    test("loading and error never turn into 'nenhuma ideia'", async ({ page }) => {
      await signInAs(page, DESIGN.email, DESIGN.senha);
      await expect(page.getByRole("heading", { name: /^(Ideias sugeridas|Ideias novas|Já vistas)/ })).toBeVisible();

      const ERROR_500 = { status: 500, contentType: "application/json", body: JSON.stringify({ erro: "erro interno" }) };
      await page.route("**/api/t/*/pautas*", (route) => route.fulfill(ERROR_500));
      await page.reload();
      await expect(page.getByText("Não carregou as ideias.")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText("Nenhuma ideia por enquanto")).toHaveCount(0);
      await look(page, "ideias-erro");
      await page.unrouteAll();
      await page.getByRole("button", { name: "Tentar de novo" }).click();
      await expect(page.getByRole("heading", { name: /^(Ideias sugeridas|Ideias novas|Já vistas)/ })).toBeVisible();

      // Loading: the response does not arrive until the end of the test.
      await page.route("**/api/t/*/pautas*", () => new Promise<void>(() => {}));
      await page.reload();
      await expect(page.getByRole("status").filter({ hasText: "Carregando as ideias" })).toBeAttached();
      await look(page, "ideias-carga");
      await page.unrouteAll({ behavior: "ignoreErrors" });
    });

    test("wrong login translated; another outlet's: not found", async ({ page }) => {
      await signInAs(page, DESIGN.email, "senha-errada-000");
      await expect(page.getByRole("alert")).toHaveText("E-mail ou senha não conferem.");
      await look(page, "entrar-erro");
      await signInAs(page, DESIGN.email, DESIGN.senha);
      // Sign-in lands on the first outlet by name, which depends on what other specs created: open this one.
      await expect(page).toHaveURL(/\/t\/[^/]+$/);
      await page.goto(`/t/${DESIGN.veiculo}`);
      await page.goto("/t/veiculo-de-outra-pessoa");
      await expect(page.getByRole("heading", { name: "Página não encontrada" })).toBeVisible();
    });
  });
}
