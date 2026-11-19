// The editor after the bench: count, focus, interview quotes, support, image, promotion, second read and versions, in
// both sizes. Screenshots in design/telas/bancada/.
import { spawnSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { fakeWav } from "../../test/fake-audio";
import { goDownModel, SPEECH_RECORDED, uploadModel } from "./fake-model";
import { ORIGIN_E2_AND } from "./origin";

const PRINTS = "design/telas/bancada";
const OUTLET = "cartas-da-orla";
const ORIGIN = { origin: ORIGIN_E2_AND };
const DESIGN = { email: "design@redacao.dev", senha: "senha-forte-123" };
const SCREENS = { celular: { width: 390, height: 844 }, computador: { width: 1440, height: 900 } } as const;
const PARAGRAPHS = ["A Câmara renovou 12 contratos de ônibus sem licitação em 2025.", "O relatório aponta que as renovações foram feitas por dispensa.", "A secretaria disse que vai analisar o relatório."];

test.beforeAll(async () => {
  const r = spawnSync("npx wrangler d1 execute redacao-db --local --file seeds/author-local.sql", { shell: true, stdio: "ignore" });
  if (r.status !== 0) throw new Error("seed autoral-local.sql falhou");
  await uploadModel();
});
test.afterAll(goDownModel);

async function look(page: Page, label: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${PRINTS}/${label}-${page.viewportSize()!.width}.png` });
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).setLegacyMode(true).options({ iframes: false }).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), label).toEqual([]);
}

async function openText(page: Page, suffix = "") {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(DESIGN.email);
  await page.getByLabel("Senha").fill(DESIGN.senha);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(/\/t\//);
  const res = await page.request.post(`/api/t/${OUTLET}/textos`, { data: { titulo: `Contratos de ônibus ${suffix}`, texto: PARAGRAPHS.join("\n") }, headers: ORIGIN });
  expect(res.status()).toBe(201);
  const id = ((await res.json()) as { texto: { id: string } }).texto.id;
  await page.goto(`/t/${OUTLET}/textos/${id}`);
  await expect(page.locator(".ProseMirror")).toContainText("A Câmara renovou");
  return id;
}

const part = (page: Page, name: string | RegExp) => page.getByRole("button", { name: name, exact: typeof name === "string" ? false : undefined });
const editor = (page: Page) => page.locator(".ProseMirror");
// On desktop the tools sit in a panel tab; on mobile, after the text.
async function tab(page: Page, label: string) {
  const b = page.getByRole("group", { name: "Partes do painel" }).getByRole("button", { name: label });
  if (await b.isVisible()) await b.click();
}
// Ctrl+End does not move in ProseMirror under Playwright: the cursor goes to the end through the editor itself.
async function inEnd(page: Page) {
  await expect(editor(page)).toBeVisible();
  await page.evaluate(() => (document.querySelector(".ProseMirror") as unknown as { editor: { commands: { focus: (p: string) => void } } }).editor.commands.focus("end"));
  await expect(editor(page)).toBeFocused();
}
const SHEET = {
  "pt-BR": { novo: "Novo texto", titulo: "Título", conferir: "Conferir", semTitulo: "Sem título", salvo: /^salvo/ },
  en: { novo: "New text", titulo: "Title", conferir: "Check", semTitulo: "Untitled", salvo: /^saved/ },
};
const saved = (page: Page) => expect(page.getByText(/^salvo/)).toBeVisible({ timeout: 15_000 });

for (const [view, viewport] of Object.entries(SCREENS)) {
  test.describe(view, () => {
    test.use({ viewport, locale: "pt-BR", deviceScaleFactor: view === "celular" ? 2 : 1 });

    test("the sheet's footer counts words, and the counter does not sit on top of the text", async ({ page }) => {
      await openText(page, "pé");
      const foot = page.locator(".folha-doc-pe");
      const total = PARAGRAPHS.join(" ").split(/\s+/).length;
      await expect(foot).toContainText(`${total} palavras · 1 min de leitura`);
      await expect(foot.getByRole("button")).toContainText(/marcas? abertas?/);
      await inEnd(page);
      await page.keyboard.type(" Mais duas");
      await expect(foot).toContainText(`${total + 2} palavras`);
      await look(page, "pe");
    });

    test("interview quote: the speech goes into the text in quotation marks and matches the recording", async ({ page }) => {
      const id = await openText(page, "aspas");
      await page.goto(`/t/${OUTLET}/textos/${id}?aba=dossie`);
      await part(page, /^Gravações/).click();
      const rec = page.getByRole("region", { name: "Gravações" });
      await rec.locator("input[type=file]").setInputFiles({ name: "entrevista.wav", mimeType: "audio/wav", buffer: Buffer.from(fakeWav(2)) });
      await expect(rec.getByText(/de áudio · transcrito/)).toBeVisible({ timeout: 30_000 });
      await page.goto(`/t/${OUTLET}/textos/${id}?aba=texto&ferramenta=aspas`);
      await expect(editor(page)).toContainText("A Câmara renovou");
      const speech = SPEECH_RECORDED[0][1];
      await inEnd(page);
      await page.keyboard.press("Enter");
      const search = page.getByLabel("Procurar na fala");
      await search.fill(speech.split(" ").slice(0, 2).join(" "));
      const item = page.getByRole("listitem").filter({ hasText: speech });
      await expect(item).toHaveCount(1);
      await item.getByRole("button", { name: /^Inserir/ }).click();
      await expect(editor(page).locator("p").last()).toContainText(`“${speech}”`);
      await expect(editor(page).locator("p")).toHaveCount(PARAGRAPHS.length + 1);
      // The parts' one-line summary must not widen the column: the panel cut off the search and the speech on the right side.
      const panel = page.getByRole("complementary", { name: "Marcas e dossiê" });
      if (view === "computador") expect(await panel.evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(0);
      const searchWidth = (await search.boundingBox())!;
      expect(searchWidth.x + searchWidth.width).toBeLessThanOrEqual(viewport.width);
      await saved(page);
      await look(page, "aspas");
      await search.fill("palavra que ninguém disse");
      await expect(page.getByText("Nada com essas palavras na fala.")).toBeVisible();
    });

    test("promote suggests and copies, and the second read leads to the passage, without changing the text", async ({ page, context }) => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      const id = await openText(page, "ajuda");
      const version = async () => ((await (await page.request.get(`/api/t/${OUTLET}/textos/${id}`)).json()) as { texto: { versao: number } }).texto.versao;
      const before = await version();
      await tab(page, "Ferramentas");
      await part(page, /^Divulgar/).click();
      await page.getByRole("button", { name: "Sugerir", exact: true }).click();
      const subjects = page.getByRole("list", { name: "Assuntos do e-mail" });
      await expect(subjects.getByRole("listitem")).toHaveCount(2);
      await subjects.getByRole("listitem").first().getByRole("button", { name: /^Copiar/ }).click();
      await expect(subjects.getByText("copiado")).toBeVisible();
      await expect(page.getByText("Mensagem para WhatsApp")).toBeVisible();
      await look(page, "divulgar");

      await part(page, /^Segunda leitura/).click();
      await page.getByRole("button", { name: "Pedir a leitura" }).click();
      const passage = page.getByRole("button", { name: /vai analisar o relatório/ });
      await passage.click();
      await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toContain("vai analisar o relatório");
      await look(page, "leitura");
      expect(await version()).toBe(before);
    });

    test("versions: restore brings back the old text, and the current one can come back", async ({ page }) => {
      await openText(page, "versões");
      await inEnd(page);
      await page.keyboard.type(" Frase nova que vai sumir.");
      await saved(page);
      await tab(page, "Ferramentas");
      await part(page, /^Versões/).click();
      await page.getByRole("button", { name: /Contratos de ônibus versões/ }).first().click();
      await page.getByRole("button", { name: "Restaurar esta versão" }).click();
      await expect(editor(page)).not.toContainText("Frase nova");
      await saved(page);
      await page.reload();
      await expect(editor(page)).not.toContainText("Frase nova");
      await expect(page.getByText(/^versão \d+ ·/)).toHaveCount(2);
      await expect(page.getByText(/^versão \d+ ·/)).toHaveCount(2);
    });

    test("image asks for a description, goes into the text and stays after reloading", async ({ page }) => {
      await openText(page, "imagem");
      await inEnd(page);
      await page.getByText("Imagem", { exact: true }).locator("input[type=file]").setInputFiles({
        name: "foto.png", mimeType: "image/png",
        buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"),
      });
      const alt = page.getByLabel(/Descreva a imagem/);
      await expect(alt).toBeFocused();
      await page.getByRole("button", { name: "Inserir", exact: true }).click();
      await expect(alt).toBeFocused();   // without a description, it does not go out
      await alt.fill("Ônibus na orla");
      await page.getByRole("button", { name: "Inserir", exact: true }).click();
      await expect(editor(page).getByRole("img", { name: "Ônibus na orla" })).toBeVisible();
      await saved(page);
      await page.reload();
      await expect(editor(page).getByRole("img", { name: "Ônibus na orla" })).toBeVisible();
    });

    test("support without sponsorship in the period explains; with sponsorship, it goes in labelled and goes out on Substack", async ({ page, context }) => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await openText(page, "apoio");
      await tab(page, "Ferramentas");
      await part(page, /^Apoio/).click();
      await page.route("**/api/t/*/patrocinios", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ patrocinios: [] }) }));
      await page.reload();
      await expect(page.getByText("Nenhum patrocínio no período.")).toBeVisible();
      await page.unrouteAll();
      const today = new Date().toISOString().slice(0, 10);
      await page.route("**/api/t/*/patrocinios", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ patrocinios: [{ id: "p1", nome: "Padaria Central", temLogo: false, inicio: today, fim: today }] }) }));
      await page.reload();
      await inEnd(page);
      await page.getByRole("button", { name: /Inserir no texto/ }).click();
      await expect(editor(page).locator("[data-apoio]")).toHaveText("Publicidade. Esta edição tem o apoio de Padaria Central.");
      await saved(page);
      await page.getByRole("button", { name: "Copiar para o Substack" }).click();
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("Esta edição tem o apoio de Padaria Central.");
    });
  });
}

test.describe("desktop panel", () => {
  test.use({ viewport: SCREENS.computador, locale: "pt-BR" });

  test("shows one part at a time, fits the screen without scrolling, and mark, alert and URL work", async ({ page }) => {
    await openText(page, "painel");
    const panel = page.getByRole("complementary", { name: "Marcas e dossiê" });
    const tabs = page.getByRole("group", { name: "Partes do painel" });
    await expect(tabs.getByRole("button", { name: /^Marcas/ })).toHaveAttribute("aria-pressed", "true");
    await expect(panel.getByText("Pessoas e instituições")).toHaveCount(0);
    await expect(panel.getByRole("group", { name: "Filtrar as marcas" })).toHaveCount(0);
    await expect(page.getByLabel("Acrescentar link")).toBeHidden();
    expect(await panel.evaluate((e) => e.scrollHeight - e.clientHeight)).toBeLessThanOrEqual(0);
    expect((await panel.boundingBox())!.width).toBeLessThanOrEqual(308);
    await look(page, "painel-marcas");

    await tabs.getByRole("button", { name: /^Dossiê/ }).click();
    await expect(page).toHaveURL(/painel=dossie/);
    await expect(page.getByLabel("Acrescentar link")).toBeVisible();
    await expect(page.getByRole("button", { name: "Publicar a página de fontes" })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Acrescentar link")).toBeVisible();
    await look(page, "painel-dossie");

    await tabs.getByRole("button", { name: "Ferramentas" }).click();
    await expect(part(page, /^Aspas da entrevista/)).toBeVisible();
    await look(page, "painel-ferramentas");

    await page.getByRole("button", { name: "Aspas", exact: true }).click();
    await expect(page).toHaveURL(/ferramenta=aspas/);
    await expect(page.getByText("Nenhuma gravação transcrita neste texto.", { exact: false })).toBeVisible();

    await page.getByRole("button", { name: /marcas? abertas?/ }).click();
    await expect(tabs.getByRole("button", { name: /^Marcas/ })).toHaveAttribute("aria-pressed", "true");
  });
});

for (const [view, viewport] of Object.entries(SCREENS)) {
  for (const [language, texts] of Object.entries(SHEET)) {
    test.describe(`blank sheet, ${view}, ${language}`, () => {
      test.use({ viewport, locale: "pt-BR" });
      test.afterEach(async ({ page }) => { await page.request.put("/api/me/idioma", { data: { idioma: "pt-BR" }, headers: ORIGIN }).catch(() => {}); });

      test("New text opens the empty editor, focused on the title, and what is written saves and becomes the name in the list", async ({ page }) => {
        await openText(page, `folha-${view}-${language}`);
        await page.request.put("/api/me/idioma", { data: { idioma: language }, headers: ORIGIN });
        spawnSync(`npx wrangler d1 execute redacao-db --local --command "DELETE FROM textos WHERE titulo = ''"`, { shell: true, stdio: "ignore" });
        await page.goto(`/t/${OUTLET}/textos`);
        await page.getByRole("button", { name: texts.novo, exact: true }).click();
        await expect(page).toHaveURL(/\/textos\/[^/?]+$/);
        const url = page.url();
        await expect(editor(page)).toBeVisible();
        await expect(page.getByRole("textbox", { name: texts.titulo })).toBeFocused();
        await expect(page.getByRole("button", { name: texts.conferir, exact: true })).toBeDisabled();
        await look(page, `folha-branca-${language}`);

        // Leaving without writing leaves no junk: New text returns to the same sheet.
        await page.goto(`/t/${OUTLET}/textos`);
        await expect(page.getByText(texts.semTitulo)).toHaveCount(1);
        await page.getByRole("button", { name: texts.novo, exact: true }).click();
        await expect(page).toHaveURL(url);

        // Enter in the title goes to the text; with no title typed, the first line gives the name.
        await page.getByRole("textbox", { name: texts.titulo }).press("Enter");
        await expect(editor(page)).toBeFocused();
        await page.keyboard.type("A prefeitura abriu a licitação.");
        await expect(page.getByText(texts.salvo)).toBeVisible({ timeout: 15_000 });
        await page.goto(`/t/${OUTLET}/textos`);
        await expect(page.getByRole("link", { name: /A prefeitura abriu a licitação/ }).first()).toBeVisible();
        await page.goto(url);
        await expect(editor(page)).toContainText("A prefeitura abriu a licitação.");
        await expect(page.getByRole("textbox", { name: texts.titulo })).toHaveValue("");
      });
    });
  }
}

test.describe("text that no longer exists", () => {
  test.use({ viewport: SCREENS.computador, locale: "pt-BR" });

  test("says so and leads to the texts, with no Tentar de novo button", async ({ page }) => {
    await openText(page, "sumiu");
    await page.goto(`/t/${OUTLET}/textos/nao-existe`);
    await expect(page.getByText("Este texto não existe mais.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Tentar de novo" })).toHaveCount(0);
    await page.getByRole("link", { name: "Ver os textos" }).click();
    await expect(page).toHaveURL(new RegExp(`/t/${OUTLET}/textos$`));
  });
});

test.describe("focus mode", () => {
  test.use({ viewport: SCREENS.computador, locale: "pt-BR" });

  test("only the sheet, in the URL, with the failures and the footer in view; opening a tool leaves focus", async ({ page }) => {
    await openText(page, "foco");
    const sidebar = page.getByRole("complementary", { name: "Veículo e seções" });
    await expect(sidebar).toBeVisible();
    await page.getByRole("button", { name: "Foco", exact: true }).click();
    await expect(page).toHaveURL(/[?&]foco=1/);
    await expect(sidebar).toBeHidden();
    await expect(page.getByRole("complementary", { name: "Marcas e dossiê" })).toHaveCount(0);
    await expect(page.locator(".folha-doc-pe")).toBeVisible();
    const sheet = await page.locator(".folha-doc").boundingBox();
    // In the middle of the usable area: round 4 reserves the scrollbar's space (scrollbar-gutter), which is left out of the measurement.
    const half = await page.evaluate(() => document.body.getBoundingClientRect().width / 2);
    expect(sheet!.x + sheet!.width / 2).toBeCloseTo(half, -1);
    await look(page, "foco");
    await page.reload();
    await expect(sidebar).toBeHidden();
    await page.getByRole("button", { name: "Aspas", exact: true }).click();
    await expect(page).not.toHaveURL(/foco=1/);
    await expect(sidebar).toBeVisible();
    await expect(page).toHaveURL(/ferramenta=aspas/);
  });

  test("leaving the editor with focus on returns the sidebar", async ({ page }) => {
    await openText(page, "foco2");
    await page.getByRole("button", { name: "Foco", exact: true }).click();
    await expect(page).toHaveURL(/foco=1/);
    await expect(page.getByRole("complementary", { name: "Veículo e seções" })).toBeHidden();
    await page.getByRole("link", { name: "Textos" }).first().click();
    await expect(page.getByRole("complementary", { name: "Veículo e seções" })).toBeVisible();
  });
});
