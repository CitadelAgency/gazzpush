// Phase D2: + New. The "New idea" sheet opens from any screen; text, link and screenshot become an idea at the top of
// Ideas through the real path (local D1, remote AI, the link really fetched). Errors and loading intercepted by route.
// The ideas created here are removed from the list at the end of each test (running again gives "back to the top").
// Axe 0 on every screen. Screenshots in design/telas/fase-d2/.
import { expect, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PRINTS = "design/telas/fase-d2";
const SCREENS = { celular: { width: 390, height: 844 }, computador: { width: 1440, height: 900 } } as const;
const DESIGN = { email: "design@redacao.dev", senha: "senha-forte-123", veiculo: "portal-litoral" };
const ORIGIN = "http://localhost:8787";
// A real news item the monitor discarded for being outside the area (the whole Baixada): requested by hand, it becomes an idea.
const LINK = "https://g1.globo.com/sp/santos-regiao/noticia/2026/11/01/feriado-de-finados-veja-o-que-abre-e-fecha-na-baixada-santista.ghtml";
const PRINT = "web/e2e/fixtures/news-print.png";

async function look(page: Page, label: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);   // pencil strokes and the sheet finish entering
  const w = page.viewportSize()!.width;
  if (w > 1000) await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path: `${PRINTS}/${label}-${w}.png`, fullPage: w > 1000 });
  if (w < 1000) await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  if (w < 1000) await page.screenshot({ path: `${PRINTS}/${label}-${w}-inteira.png`, fullPage: true });
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

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/** The "New" button: at the top of the sidebar (desktop) or in the middle of the bottom navigation (mobile). */
const newButton = (page: Page) => page.getByRole("button", { name: /^Nova( ideia)?$/ }).filter({ visible: true });
const sheet = (page: Page) => page.getByRole("dialog", { name: "Nova ideia" });

/** Keeps what the server answered to + New (read on the route: after navigation the body vanishes from the inspector). */
async function newListen(page: Page) {
  const r: { pautaId?: string; situacao?: string; status?: number } = {};
  await page.route(`**/api/t/*/pautas`, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const res = await route.fetch({ timeout: 60_000 });
    Object.assign(r, await res.json(), { status: res.status() });
    await route.fulfill({ response: res });
  });
  return r;
}

/** Removes the idea created by the test from the list (the local D1 stays as it was). */
async function remove(page: Page, leadId?: string) {
  if (!leadId) return;
  const tenant = (await (await page.request.get("/api/me")).json()).tenants.find((t: { slug: string }) => t.slug === DESIGN.veiculo).id;
  await page.request.post(`/api/t/${tenant}/pautas/${leadId}/descartar`, { headers: { origin: ORIGIN }, data: { motivo: "e2e D2" } });
}

/** The idea brought in is the first in the list, with the notice of what happened. */
async function inTop(page: Page, title: string | RegExp) {
  // Reading the link or the screenshot takes from a few seconds to half a minute.
  await expect(page).toHaveURL(new RegExp(`/t/${DESIGN.veiculo}$`), { timeout: 60_000 });
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: /topo da lista/ })).toBeVisible();
  const first = page.locator("ol > li").first();
  await expect(first.getByRole("heading", { level: 3 })).toHaveText(title);
  await expect(first).toContainText("trazida pela equipe");
}

for (const [view, viewport] of Object.entries(SCREENS)) {
  test.describe(view, () => {
    const phone = view === "celular";
    test.use({ viewport, deviceScaleFactor: phone ? 2 : 1, hasTouch: phone, isMobile: phone });

    test("from another screen, what happened in text becomes an idea at the top; going back does not reopen the sheet", async ({ page }) => {
      test.setTimeout(120_000);
      await signIn(page);
      await page.getByRole("navigation", { name: "Seções" }).getByRole("link", { name: "Postados" }).click();
      await expect(page).toHaveURL(new RegExp(`/t/${DESIGN.veiculo}/postados$`));

      await newButton(page).click();
      await expect(sheet(page)).toBeVisible();
      await expect(page).toHaveURL(/\/postados\?nova=link$/);
      // Opens on link, with focus in the field; the rest of the screen is inert (modal).
      await expect(sheet(page).getByLabel("Link da notícia")).toBeFocused();
      await look(page, "nova-link");

      await sheet(page).getByText("Texto", { exact: true }).click();
      await expect(page).toHaveURL(/\?nova=texto$/);
      const field = sheet(page).getByLabel("O que aconteceu?");
      // Too short: asks for more, without going to the server.
      await field.fill("Acidente agora.");
      await sheet(page).getByRole("button", { name: "Trazer para as Ideias" }).click();
      await expect(sheet(page).getByRole("alert")).toHaveText(/Escreva um pouco mais/);

      // A unique account per run (the same text would return the same idea).
      const [h, m, seg] = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).split(":");
      const hm = `${h}h${m}min${seg}s`;
      const title = `Semáforo apagado no cruzamento da Avenida Puglisi com a Rua Montenegro, em Guarujá, desde as ${hm}.`;
      await field.fill(`${title} Motoristas relatam fila nos dois sentidos e a CET ainda não chegou ao local.`);
      await look(page, "nova-texto");
      const answer = await newListen(page);
      await sheet(page).getByRole("button", { name: "Trazer para as Ideias" }).click();
      await expect(sheet(page).getByRole("button", { name: "Lendo o relato…" })).toBeDisabled();
      await inTop(page, title);
      expect(answer).toMatchObject({ situacao: "nova", status: 201 });
      await expect(page.getByRole("status").filter({ hasText: "Ideia nova, no topo da lista." })).toBeVisible();
      await look(page, "ideias-trazida");

      // The sheet left the history: going back leads to Posted, it does not reopen the sheet.
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`/t/${DESIGN.veiculo}/postados$`));
      await expect(sheet(page)).toHaveCount(0);
      await remove(page, answer.pautaId);
    });

    test("real news link; the same link again says it was already there; a link that does not open explains why", async ({ page }) => {
      test.setTimeout(120_000);
      await signIn(page);
      await newButton(page).click();
      const field = sheet(page).getByLabel("Link da notícia");
      const bring = sheet(page).getByRole("button", { name: "Trazer para as Ideias" });

      await bring.click();
      await expect(sheet(page).getByRole("alert")).toHaveText("Cole o link da notícia.");
      await expect(field).toBeFocused();
      await field.fill("notícia do feriado");
      await bring.click();
      await expect(sheet(page).getByRole("alert")).toHaveText(/não parece o endereço de uma notícia/);
      await expect(field).toHaveAttribute("aria-invalid", "true");
      await look(page, "nova-link-erro");

      await field.fill("https://www.guaruja.sp.gov.br/esta-pagina-nao-existe-redacao-e2e/");
      await bring.click();
      await expect(sheet(page).getByRole("alert")).toHaveText(/Não deu para ler a notícia desse link/, { timeout: 30_000 });

      const answer = await newListen(page);
      await field.fill(LINK);
      await bring.click();
      await expect(sheet(page).getByRole("button", { name: "Lendo a notícia…" })).toBeVisible();
      await inTop(page, /Feriado de Finados/);
      expect(answer.situacao).toMatch(/^(nova|de_volta)$/);
      await expect(page.locator("ol > li").first()).toContainText("g1.globo.com");

      // Again: the same idea, without duplicating.
      const before = await page.locator("ol > li").count();
      await newButton(page).click();
      await sheet(page).getByLabel("Link da notícia").fill(LINK);
      await sheet(page).getByRole("button", { name: "Trazer para as Ideias" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Essa notícia já estava na lista." })).toBeVisible({ timeout: 30_000 });
      await expect(page.locator("ol > li")).toHaveCount(before);
      await remove(page, answer.pautaId);
    });

    test("news screenshot: chooses, sees the thumbnail and becomes an idea", async ({ page }) => {
      test.setTimeout(120_000);
      await signIn(page);
      await newButton(page).click();
      await sheet(page).getByText("Print", { exact: true }).click();
      await expect(sheet(page).getByText("Escolher o print")).toBeVisible();
      await sheet(page).getByRole("button", { name: "Trazer para as Ideias" }).click();
      await expect(sheet(page).getByRole("alert")).toHaveText("Escolha o print da notícia.");
      await sheet(page).getByLabel("Print da notícia").setInputFiles(PRINT);
      await expect(sheet(page).getByRole("img", { name: "Print escolhido" })).toBeVisible();
      await expect(sheet(page).getByRole("alert")).toHaveCount(0);
      await look(page, "nova-print");

      const answer = await newListen(page);
      await sheet(page).getByRole("button", { name: "Trazer para as Ideias" }).click();
      await expect(sheet(page).getByRole("button", { name: "Lendo o print…" })).toBeVisible();
      await inTop(page, /salva-vidas|guarda-vidas/i);
      expect(answer.situacao).toMatch(/^(nova|de_volta)$/);
      await expect(page.locator("ol > li").first()).toContainText("print de notícia");
      await remove(page, answer.pautaId);
    });

    test("reading, server failure, no network, already in production; Esc and outside the sheet close; old address opens", async ({ page }) => {
      await signIn(page);
      // The old address of the New section: opens the sheet over Ideas.
      await page.goto(`/t/${DESIGN.veiculo}/nova`);
      await expect(page).toHaveURL(new RegExp(`/t/${DESIGN.veiculo}\\?nova=link$`));
      await expect(sheet(page)).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(sheet(page)).toHaveCount(0);
      await expect(page).toHaveURL(new RegExp(`/t/${DESIGN.veiculo}$`));

      // Esc returns focus to the button that opened it.
      await newButton(page).click();
      await expect(sheet(page)).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(sheet(page)).toHaveCount(0);
      await expect(newButton(page)).toBeFocused();

      // Reading: the button says what is happening and the sheet does not close midway.
      let release: () => void = () => {};
      await page.route("**/api/t/*/pautas", async (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        await new Promise<void>((ok) => { release = ok; });
        await json(route, { erro: "erro interno" }, 500);
      });
      await newButton(page).click();
      await sheet(page).getByLabel("Link da notícia").fill(LINK);
      await sheet(page).getByRole("button", { name: "Trazer para as Ideias" }).click();
      await expect(sheet(page).getByRole("button", { name: "Lendo a notícia…" })).toBeDisabled();
      await expect(sheet(page).getByRole("status")).toHaveText(/Leva alguns segundos/);
      await look(page, "nova-lendo");
      await page.keyboard.press("Escape");
      await expect(sheet(page)).toBeVisible();
      release();
      await expect(sheet(page).getByRole("alert")).toHaveText("A leitura falhou agora. Tente de novo em instantes.");
      await look(page, "nova-erro");

      await page.unrouteAll();
      await page.route("**/api/t/*/pautas", (route) => (route.request().method() === "POST" ? route.abort() : route.fallback()));
      await sheet(page).getByRole("button", { name: "Trazer para as Ideias" }).click();
      await expect(sheet(page).getByRole("alert")).toHaveText(/Sem conexão/);

      // A screenshot that is not news (the API's code).
      await page.unrouteAll();
      await page.route("**/api/t/*/pautas", (route) => (route.request().method() === "POST"
        ? json(route, { erro: "não deu para ler", code: "print_sem_noticia" }, 422) : route.fallback()));
      await sheet(page).getByText("Print", { exact: true }).click();
      await sheet(page).getByLabel("Print da notícia").setInputFiles(PRINT);
      await sheet(page).getByRole("button", { name: "Trazer para as Ideias" }).click();
      await expect(sheet(page).getByRole("alert")).toHaveText(/Não deu para ler uma notícia nesse print/);

      // Clicking outside the sheet closes it (away from the right edge: the scrollbar's reserved space is there).
      await page.mouse.click(viewport.width - 40, 5);
      await expect(sheet(page)).toHaveCount(0);

      // Going back in the browser closes the sheet even while reading; the response that arrives later does not swap the open screen.
      await page.unrouteAll();
      await page.getByRole("navigation", { name: "Seções" }).getByRole("link", { name: "Postados" }).click();
      await expect(page).toHaveURL(/\/postados$/);
      let answer: () => void = () => {};
      await page.route("**/api/t/*/pautas", async (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        await new Promise<void>((ok) => { answer = ok; });
        await json(route, { pautaId: "x", situacao: "nova", status: "sugerida" }, 201);
      });
      await newButton(page).click();
      await sheet(page).getByLabel("Link da notícia").fill(LINK);
      await sheet(page).getByRole("button", { name: "Trazer para as Ideias" }).click();
      await expect(sheet(page).getByRole("button", { name: "Lendo a notícia…" })).toBeVisible();
      await page.goBack();
      await expect(sheet(page)).toHaveCount(0);
      await expect(page).toHaveURL(/\/postados$/);
      answer();
      // The open screen does not change; the notice of what happened appears on it, with "View" for the idea.
      const outside = page.getByRole("status").filter({ hasText: "A ideia que você trouxe entrou no topo das Ideias." });
      await expect(outside).toBeVisible();
      await expect(page).toHaveURL(/\/postados$/);
      await look(page, "nova-fechada-aviso");
      await outside.getByRole("link", { name: "Ver" }).click();
      await expect(page).toHaveURL(new RegExp(`/t/${DESIGN.veiculo}$`));
      await expect(outside).toHaveCount(0);
      await expect(page.getByRole("status").filter({ hasText: "Ideia nova, no topo da lista." })).toBeVisible();

      // The news already became a post and was approved: says where it is and leads to it.
      await page.unrouteAll();
      await page.route("**/api/t/*/pautas", (route) => (route.request().method() === "POST"
        ? json(route, { pautaId: "x", situacao: "existente", status: "em_producao", peca: { id: "p-teste", status: "aprovada" } }) : route.fallback()));
      await newButton(page).click();
      await sheet(page).getByLabel("Link da notícia").fill(LINK);
      await sheet(page).getByRole("button", { name: "Trazer para as Ideias" }).click();
      const warning = page.getByRole("status").filter({ hasText: "Essa notícia já foi aprovada e espera ser postada." });
      await expect(warning).toBeVisible();
      await expect(warning.getByRole("link", { name: "Abrir o post" })).toHaveAttribute("href", `/t/${DESIGN.veiculo}/p/p-teste`);
      await look(page, "ideias-ja-aprovada");
    });
  });
}
