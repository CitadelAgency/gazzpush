// As rotas do cadastro têm cobertura no Worker em test/lista-espera.test.ts.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const TELAS = { celular: { width: 390, height: 844 }, computador: { width: 1440, height: 900 } } as const;

async function olhar(page: Page, nome: string) {
  await page.evaluate(() => document.fonts.ready);
  const logo = page.getByRole("img", { name: "Gazzpush", exact: true });
  await expect(logo).toBeVisible();
  expect(await logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  const largura = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(largura).toBeLessThanOrEqual(page.viewportSize()!.width);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).setLegacyMode(true).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), nome).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  // Quando há um Worker local explicitamente indicado, a suíte exercita o serviço inteiro.
  if (process.env.E2E_ORIGEM) return;
  await page.route("**/api/instalacao", (rota) => rota.fulfill({ json: { propria: true } }));
  await page.route("**/api/me", (rota) => rota.fulfill({ status: 401, json: {} }));
  await page.route("**/api/auth/**", (rota) => rota.fulfill({ json: {} }));
  await page.route("**/api/lista-espera", (rota) => {
    const req = rota.request();
    if (req.postDataJSON().email.endsWith("@sem-ponto")) {
      const en = req.headers()["x-idioma"] === "en";
      return rota.fulfill({ status: 400, json: { erro: en ? "Check the email: it looks incomplete." : "Confira o e-mail: ele parece incompleto." } });
    }
    return rota.fulfill({ json: { ok: true } });
  });
});

for (const [tela, viewport] of Object.entries(TELAS)) {
  test.describe(tela, () => {
    test.use({ viewport, locale: "pt-BR", deviceScaleFactor: tela === "celular" ? 2 : 1 });

    test("a instalação própria abre o login", async ({ page }) => {
      await page.goto("/");
      await expect(page).toHaveURL(/\/entrar$/);
      await expect(page.getByRole("heading", { name: "Entrar", exact: true })).toBeVisible();
      await olhar(page, "entrar");
    });

    test("a lista exibe os preços e o botão fica à vista", async ({ page }) => {
      await page.goto("/lista-de-espera");
      await expect(page).toHaveURL(/\/lista-de-espera$/);
      await expect(page).toHaveTitle(/Lista de espera/);
      for (const preco of ["R$ 99 por mês", "R$ 210 por mês"]) await expect(page.getByText(preco, { exact: true })).toBeVisible();
      for (const cota of ["60 posts por mês", "150 posts por mês"]) await expect(page.getByText(new RegExp(cota))).toBeVisible();
      await expect(page.getByRole("radio")).toHaveCount(2);
      await expect(page.getByText(/Grátis|Teste|Cortesia/)).toHaveCount(0);
      const botao = await page.getByRole("button", { name: "Entrar na lista de espera" }).boundingBox();
      expect(botao!.y + botao!.height).toBeLessThanOrEqual(viewport.height);
      await olhar(page, "lista");
    });

    test("cadastro com plano: confirma e recebe o foco", async ({ page }) => {
      const email = `${tela}-${Date.now().toString(36)}@example.test`;
      await page.goto("/lista-de-espera");
      await page.getByLabel("E-mail").fill(email);
      await page.getByLabel("Seu nome (opcional)").fill("Campo");
      await page.getByRole("radio", { name: /Página/ }).check();
      await page.getByRole("button", { name: "Entrar na lista de espera" }).click();
      const ok = page.getByRole("status");
      await expect(ok).toContainText("Você está na lista.");
      await expect(ok).toContainText(email);
      await expect(ok).toBeFocused();
      await olhar(page, "pronto");
    });

    test("e-mail vazio segura no campo; e-mail recusado pelo servidor volta ao campo", async ({ page }) => {
      await page.goto("/lista-de-espera");
      await page.getByRole("button", { name: "Entrar na lista de espera" }).click();
      await expect(page.getByLabel("E-mail")).toBeFocused();
      await page.getByLabel("E-mail").fill("campo@sem-ponto");
      await page.getByRole("button", { name: "Entrar na lista de espera" }).click();
      await expect(page.getByRole("alert")).toHaveText("Confira o e-mail: ele parece incompleto.");
      await expect(page.getByLabel("E-mail")).toBeFocused();
      await expect(page.getByLabel("E-mail")).toHaveAttribute("aria-invalid", "true");
      await olhar(page, "email-recusado");
    });

    test("limite e queda de rede: a mensagem aparece e o que foi digitado fica", async ({ page }) => {
      await page.goto("/lista-de-espera");
      await page.getByLabel("E-mail").fill(`rede-${tela}@example.test`);
      await page.route("**/api/lista-espera", (r) => r.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ erro: "Muitos cadastros seguidos desta conexão. Tente de novo em uma hora." }) }));
      await page.getByRole("button", { name: "Entrar na lista de espera" }).click();
      await expect(page.getByRole("alert")).toContainText("Tente de novo em uma hora");
      await page.unrouteAll();
      await page.route("**/api/lista-espera", (r) => r.abort());
      await page.getByRole("button", { name: "Entrar na lista de espera" }).click();
      await expect(page.getByRole("alert")).toContainText("Sem conexão");
      await expect(page.getByLabel("E-mail")).toHaveValue(`rede-${tela}@example.test`);
    });

    test("quem já tem conta chega ao login", async ({ page }) => {
      await page.goto("/lista-de-espera");
      await page.getByRole("link", { name: "Entrar" }).click();
      await expect(page).toHaveURL(/\/entrar$/);
      await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
    });

    test("em inglês, tudo muda junto, inclusive a mensagem do servidor", async ({ page }) => {
      await page.goto("/lista-de-espera");
      await page.getByRole("button", { name: "English" }).click();
      await expect(page.getByRole("heading", { name: "Join the waitlist" })).toBeVisible();
      await expect(page).toHaveTitle(/Waitlist/);
      await expect(page.getByText("R$ 99 per month", { exact: true })).toBeVisible();
      await expect(page.getByText(/150 posts per month/)).toBeVisible();
      await olhar(page, "en");
      await page.getByLabel("Email").fill("campo@sem-ponto");
      await page.getByRole("button", { name: "Join the waitlist" }).click();
      await expect(page.getByRole("alert")).toHaveText("Check the email: it looks incomplete.");
    });
  });
}
