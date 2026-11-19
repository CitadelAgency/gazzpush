// Phase 1: from briefing to receipt. Against `wrangler dev` with the migrated local D1. The scenario comes from
// seeds/ad-local.sql: producing the post uses remote models and Browser Rendering and is covered in test/ad.test.ts.
// Here the Ad tab (the submission is simulated), Review, the link, the public page, Posted and the receipt run for
// real. Axe 0. Screenshots in design/telas/anuncio/.
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PRINTS = "design/telas/anuncio";
const SCREENS = { celular: { width: 390, height: 844 }, computador: { width: 1440, height: 900 } } as const;
const DESIGN = { email: "design@redacao.dev", senha: "senha-forte-123", veiculo: "portal-litoral" };
const ORIGIN = { origin: "http://localhost:8787" };
const PIECE = "e2e-anuncio-peca";

const d1 = (args: string) => {
  const r = spawnSync(`npx wrangler d1 execute redacao-db --local ${args}`, { shell: true, stdio: "ignore" });
  expect(r.status).toBe(0);
};

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

async function signIn(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(DESIGN.email);
  await page.getByLabel("Senha").fill(DESIGN.senha);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  // Sign-in lands on the first outlet by name, which depends on what other specs created: open this one.
  await expect(page).toHaveURL(/\/t\/[^/]+$/);
  await page.goto(`/t/${DESIGN.veiculo}`);
}

test.beforeAll(async ({ browser }) => {
  // The post's art: any image in the local R2, generated here so no binary goes into the repository.
  const file = join(tmpdir(), "e2e-anuncio-capa.jpg");
  const p = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
  await p.setContent(`<body style="margin:0;background:#16324f;color:#fff;font:bold 96px sans-serif;padding:80px">Tomate por R$ 19,90 no Mercado Bom Preço</body>`);
  await p.screenshot({ path: file, type: "jpeg" });
  await p.close();
  const r = spawnSync(`npx wrangler r2 object put redacao-media/artes/portal-litoral/${PIECE}/capa.jpg --file "${file}" --content-type image/jpeg --local`, { shell: true, stdio: "ignore" });
  expect(r.status).toBe(0);
});

test.afterAll(() => d1("--file seeds/ad-cleanup-local.sql"));

for (const [view, viewport] of Object.entries(SCREENS)) {
  test.describe(view, () => {
    test.use({ viewport, deviceScaleFactor: view === "celular" ? 2 : 1 });
    test.beforeEach(() => { d1("--file seeds/ad-cleanup-local.sql"); d1("--file seeds/ad-local.sql"); });
    test.afterEach(async ({ page }) => {
      await page.request.put("/api/me/idioma", { data: { idioma: "pt-BR" }, headers: ORIGIN }).catch(() => {});
    });

    test("from briefing to receipt: Ad tab, timestamp, link, advertiser approval, Posted and receipt", async ({ page, context, browser }) => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://localhost:8787" });
      await signIn(page);
      let sent: unknown = null;
      await page.route(`**/api/t/*/pautas`, async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        sent = route.request().postDataJSON();
        await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ pautaId: "e2e-anuncio-ideia", situacao: "nova", status: "sugerida" }) });
      });

      await page.goto(`/t/${DESIGN.veiculo}?nova=anuncio`);
      await expect(page.getByRole("radio", { name: "Anúncio" })).toBeChecked();
      await page.getByRole("button", { name: "Trazer para as Ideias" }).click();
      await expect(page.getByRole("alert")).toHaveText("Diga quem é o anunciante.");
      await page.getByLabel("Anunciante").fill("Pizzaria do Porto");
      await page.getByLabel("Briefing").fill("Pizza em dobro na Pizzaria do Porto toda terça, por R$ 59,90 até o fim do mês.");
      await look(page, "nova");
      await page.getByRole("button", { name: "Trazer para as Ideias" }).click();
      await expect.poll(() => sent).toMatchObject({ anuncio: { anunciante: "Pizzaria do Porto" } });

      const idea = page.getByRole("listitem").filter({ hasText: "Pizza em dobro na Pizzaria do Porto" });
      await expect(idea.getByText("Publicidade", { exact: true })).toBeVisible();
      await look(page, "ideias");

      // Review: warns, does not gate.
      await page.goto(`/t/${DESIGN.veiculo}/p/${PIECE}`);
      await expect(page.getByRole("heading", { name: "Publicidade de Mercado Bom Preço" })).toBeVisible();
      await expect(page.getByText("O anunciante ainda não viu este post.")).toBeVisible();
      await look(page, "revisao");
      await page.getByRole("button", { name: "Copiar link" }).click();
      await expect(page.getByText("Link copiado. Vale 7 dias, só para esta versão.")).toBeVisible();
      await expect(page.getByText("Aguardando a resposta do anunciante.")).toBeVisible();
      const link = await page.evaluate(() => navigator.clipboard.readText());
      expect(link).toMatch(/\/anuncio\/[A-Za-z0-9_-]{43}$/);

      // The advertiser, without an account.
      const outside = await browser.newContext({ viewport, deviceScaleFactor: view === "celular" ? 2 : 1 });
      const advertiser = await outside.newPage();
      await advertiser.goto(link);
      await expect(advertiser.getByRole("heading", { name: "Aprovar a publicidade" })).toBeVisible();
      await expect(advertiser.getByText("O quilo do tomate sai por R$ 19,90 até sábado.")).toBeVisible();
      await look(advertiser, "aprovar-link");
      await advertiser.getByRole("button", { name: "Aprovar" }).click();
      await expect(advertiser.getByText("Aprovado. Obrigado!")).toBeVisible();
      await look(advertiser, "aprovado-link");
      await outside.close();

      await page.reload();
      await expect(page.getByText(/^Aprovado pelo anunciante/)).toBeVisible();

      // Published: Posted with the stamp and the receipt.
      d1(`--command "UPDATE pecas SET status = 'publicada' WHERE id = '${PIECE}'; INSERT INTO publicacoes (id, tenant_id, peca_id, rede, modo, publicado_em, status) VALUES ('e2e-anuncio-pub', 'portal-litoral', '${PIECE}', 'instagram', 'manual', datetime('now'), 'publicada');"`);
      await page.goto(`/t/${DESIGN.veiculo}/postados`);
      const item = page.getByRole("listitem").filter({ hasText: "Tomate por R$ 19,90" });
      await expect(item.getByRole("link", { name: "Comprovante" })).toHaveAttribute("href", `/api/t/${DESIGN.veiculo}/pecas/${PIECE}/comprovante`);
      await look(page, "postados");
      await page.goto(`/api/t/${DESIGN.veiculo}/pecas/${PIECE}/comprovante?html=1`);
      await expect(page.getByRole("heading", { name: "Comprovante de publicação" })).toBeVisible();
      await expect(page.getByText("link não informado")).toBeVisible();
      await expect(page.getByText("Não é nota fiscal.", { exact: false })).toBeVisible();
      await look(page, "comprovante");
    });

    test("in English: the Ad tab and the review panel", async ({ page }) => {
      await signIn(page);
      await page.request.put("/api/me/idioma", { data: { idioma: "en" }, headers: ORIGIN });
      await page.goto(`/t/${DESIGN.veiculo}?nova=anuncio`);
      await expect(page.getByRole("radio", { name: "Ad" })).toBeChecked();
      await expect(page.getByLabel("Advertiser")).toBeVisible();
      await page.goto(`/t/${DESIGN.veiculo}/p/${PIECE}`);
      await expect(page.getByRole("heading", { name: "Advertisement for Mercado Bom Preço" })).toBeVisible();
      await look(page, "revisao-en");
    });
  });
}
