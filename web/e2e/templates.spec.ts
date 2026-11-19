// Step 6: the outlet's templates. The Brand tab's Templates section, for real against the local D1, and Review's
// picker. Switching the template renders in the remote Browser Rendering, so the PUT's response is simulated; the path
// is in test/styles.test.ts. Axe 0. Screenshots in design/telas/modelos/.
import { spawnSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PRINTS = "design/telas/modelos";
const SCREENS = { celular: { width: 390, height: 844 }, computador: { width: 1440, height: 900 } } as const;
const DESIGN = { email: "design@redacao.dev", senha: "senha-forte-123", veiculo: "portal-litoral" };
const ORIGIN = { origin: "http://localhost:8787" };
const PIECE = "e2e-anuncio-peca";

const d1 = (args: string) => {
  const r = spawnSync(`npx wrangler d1 execute redacao-db --local ${args}`, { shell: true, stdio: "ignore" });
  expect(r.status).toBe(0);
};
const clean = () => d1(`--command "DELETE FROM estilos WHERE tenant_id = '${DESIGN.veiculo}'; DELETE FROM patrocinios WHERE tenant_id = '${DESIGN.veiculo}'"`);

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

const section = (page: Page) => page.goto(`/t/${DESIGN.veiculo}/veiculo?aba=marca&secao=modelos`);
const group = (page: Page, name: RegExp) => page.getByRole("button", { name: name }).click();
const createPerApi = async (page: Page, name: string) => {
  const r = await page.request.post(`/api/t/${DESIGN.veiculo}/estilos`, { headers: ORIGIN, data: { nome: name, params: { composicao: "cartaz" }, valePara: {} } });
  expect(r.status()).toBe(201);
  return (await r.json()).id as string;
};

test.afterAll(() => { clean(); d1("--file seeds/ad-cleanup-local.sql"); });

for (const [view, viewport] of Object.entries(SCREENS)) {
  test.describe(view, () => {
    test.use({ viewport, deviceScaleFactor: view === "celular" ? 2 : 1 });
    test.beforeEach(() => { clean(); d1("--file seeds/ad-cleanup-local.sql"); d1("--file seeds/ad-local.sql"); });
    test.afterEach(async ({ page }) => { await page.request.put("/api/me/idioma", { data: { idioma: "pt-BR" }, headers: ORIGIN }).catch(() => {}); });

    test("the admin creates a template with live preview, edits and archives", async ({ page }) => {
      await signIn(page);
      await section(page);
      await expect(page.getByText("Nenhum modelo ainda.")).toBeVisible();
      await look(page, "vazio");
      await page.getByRole("button", { name: "Novo modelo" }).click();
      await page.getByLabel("Nome do modelo").fill("Urgente");
      await page.getByLabel("Nome do modelo").press("Enter");
      await expect(page.getByLabel("Nome do modelo")).toBeVisible();
      await group(page, /^Técnica da ilustração/);
      await expect(page.getByRole("radio", { name: /^Retícula/ })).toBeChecked();
      await group(page, /^Composição/);
      await page.getByRole("radio", { name: /^Cartaz/ }).check();
      const preview = page.frameLocator("iframe").first();
      await expect(preview.locator(".card.comp-cartaz")).toBeAttached();
      await expect(page.getByRole("radiogroup", { name: "Técnica da ilustração" })).toHaveCount(0);
      await page.getByRole("radio", { name: /^Primeira página/ }).check();
      await expect(preview.locator(".card.comp-primeira-pagina")).toBeAttached();
      // Closed, the group states the choice; the open one stays in the URL; one open at a time.
      await group(page, /^Técnica da ilustração/);
      await expect(page).toHaveURL(/[?&]grupo=tecnica/);
      await expect(page.getByRole("radio", { name: /^Primeira página/ })).toBeHidden();
      await expect(page.getByRole("button", { name: /^Composição/ })).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByRole("button", { name: /^Composição/ })).toContainText("Primeira página");
      await page.getByRole("radio", { name: /^Xilogravura/ }).check();
      await group(page, /^Cores/);
      await page.getByRole("radio", { name: "Invertidas: fundo e texto trocados" }).check();
      await group(page, /^Sequência sugerida/);
      await page.getByLabel("Acrescentar card à sequência").selectOption("lista");
      await group(page, /^Editorias/);
      await page.getByRole("checkbox", { name: "Trânsito" }).check();
      await group(page, /^Tipos de post/);
      await page.getByRole("checkbox", { name: "Publicidade" }).check();
      await group(page, /^Palavras/);
      await page.getByLabel("Vale para as palavras").fill("urgente, plantão");
      await expect(page.getByRole("button", { name: "Salvar o modelo" })).toBeInViewport();
      await look(page, "editar");
      await group(page, /^Palavras/);
      await expect(page.getByLabel("Vale para as palavras")).toBeHidden();
      await expect(page).toHaveURL(/[?&]grupo=nenhuma/);
      await look(page, "editar-fechado");
      await page.getByRole("button", { name: "Salvar o modelo" }).click();

      const list = page.getByRole("list", { name: "Modelos do veículo" });
      await expect(list.getByRole("listitem")).toHaveCount(1);
      await expect(list).toContainText("Primeira página");
      await look(page, "lista");

      await page.getByRole("button", { name: "Editar Urgente" }).click();
      await expect(page).toHaveURL(/[?&]modelo=/);
      await group(page, /^Palavras/);
      await expect(page.getByLabel("Vale para as palavras")).toHaveValue("urgente, plantão");
      // Reloading goes back to the same template and the same group.
      await page.reload();
      await expect(page.getByLabel("Vale para as palavras")).toHaveValue("urgente, plantão");
      await page.getByRole("button", { name: "Cancelar" }).click();
      await page.getByRole("button", { name: "Arquivar Urgente" }).click();
      await expect(page.getByText("Nenhum modelo ainda.")).toBeVisible();
    });

    test("invalid field opens the closed group and gets focus on save", async ({ page }) => {
      await signIn(page);
      await section(page);
      await page.getByRole("button", { name: "Novo modelo" }).click();
      await page.getByRole("button", { name: "Salvar o modelo" }).click();
      await expect(page.getByLabel("Nome do modelo")).toBeFocused();
      await expect(page.getByLabel("Nome do modelo")).toHaveAttribute("aria-invalid", "true");
      await expect(page.getByRole("alert")).toContainText("Dê um nome ao modelo.");
      await page.getByLabel("Nome do modelo").fill("Demais");
      await group(page, /^Palavras/);
      await page.getByLabel("Vale para as palavras").fill(Array.from({ length: 40 }, (_, i) => `p${i}`).join(", "));
      await group(page, /^Composição/);
      await expect(page.getByLabel("Vale para as palavras")).toBeHidden();
      await expect(page.getByRole("button", { name: /^Palavras/ })).toContainText("p0");
      await page.getByRole("button", { name: "Salvar o modelo" }).click();
      await expect(page.getByLabel("Vale para as palavras")).toBeVisible();
      await expect(page.getByLabel("Vale para as palavras")).toBeFocused();
      await expect(page.getByLabel("Vale para as palavras")).toHaveAttribute("aria-invalid", "true");
    });

    test("the admin registers a sponsor, and the template turns on the strip", async ({ page }) => {
      await signIn(page);
      await page.goto(`/t/${DESIGN.veiculo}/veiculo?aba=marca&secao=patrocinios`);
      await expect(page.getByText("Nenhum patrocinador ainda.")).toBeVisible();
      await page.getByRole("button", { name: "Novo patrocinador" }).click();
      await page.getByLabel("Nome do patrocinador").fill("Padaria Sol");
      await page.getByRole("button", { name: "Salvar o patrocinador" }).click();
      await expect(page.getByRole("alert")).toContainText("período");
      await page.getByLabel("Início", { exact: true }).fill("2026-11-01");
      await page.getByLabel("Fim", { exact: true }).fill("2026-11-30");
      await look(page, "patrocinio-novo");
      await page.getByRole("button", { name: "Salvar o patrocinador" }).click();
      const list = page.getByRole("list", { name: "Patrocinadores" });
      await expect(list).toContainText("Padaria Sol");
      await expect(list).toContainText("01/11/2026 – 30/11/2026 · sem logo");
      await look(page, "patrocinios");

      await section(page);
      await page.getByRole("button", { name: "Novo modelo" }).click();
      await page.getByLabel("Nome do modelo").fill("Resumo patrocinado");
      await group(page, /^Patrocinador na arte/);
      await page.getByRole("combobox", { name: "Patrocinador na arte" }).selectOption({ label: "Padaria Sol" });
      await page.getByRole("button", { name: "Salvar o modelo" }).click();
      await expect(page.getByRole("list", { name: "Modelos do veículo" })).toContainText("Resumo patrocinado");
    });

    test("in Review, the selector switches the template, and the warning offers Apply", async ({ page }) => {
      await signIn(page);
      const id = await createPerApi(page, "Tarja da casa");
      let body: unknown = null;
      await page.route(`**/api/t/*/pecas/*/estilo`, (route) => {
        body = route.request().postDataJSON();
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, versao: 1, validacao: { ok: true, erros: [], avisos: [] }, renderizados: [], reaproveitados: [] }) });
      });
      await page.goto(`/t/${DESIGN.veiculo}/p/${PIECE}`);
      const selector = page.getByLabel("Modelo", { exact: true });
      await expect(selector).toHaveValue("");
      await look(page, "revisao");
      await selector.selectOption({ label: "Tarja da casa" });
      await expect.poll(() => body).toEqual({ versao: 1, estiloId: id });

      // A piece already on the template, on an earlier version of it.
      await page.unrouteAll({ behavior: "ignoreErrors" });
      d1(`--command "UPDATE pecas SET conteudo_json = json_set(conteudo_json, '$.estilo', json('{\\"id\\":\\"${id}\\",\\"versao\\":0,\\"params\\":{\\"composicao\\":\\"cartaz\\",\\"caixaTitulo\\":\\"alta\\",\\"papelCores\\":\\"normal\\",\\"sequencia\\":[]},\\"marcaVisual\\":{}}')) WHERE id = '${PIECE}'"`);
      await page.reload();
      await expect(page.getByText("Modelo mudou.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Aplicar" })).toBeVisible();
      await look(page, "revisao-mudou");
    });

    test("in English: the templates section and the review selector", async ({ page }) => {
      await signIn(page);
      await page.request.put("/api/me/idioma", { data: { idioma: "en" }, headers: ORIGIN });
      await createPerApi(page, "Poster");
      await section(page);
      await page.getByRole("button", { name: "Edit Poster" }).click();
      await group(page, /^Composition/);
      await expect(page.getByRole("radio", { name: /^Front page/ })).toBeVisible();
      await look(page, "editar-en");
      await page.goto(`/t/${DESIGN.veiculo}/veiculo?aba=marca&secao=patrocinios`);
      await expect(page.getByRole("button", { name: "New sponsor" })).toBeVisible();
      await page.goto(`/t/${DESIGN.veiculo}/p/${PIECE}`);
      await expect(page.getByLabel("Template", { exact: true })).toBeVisible();
    });
  });
}
