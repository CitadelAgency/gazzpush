// The design lenses' "Now" sprint (design/personas/00-sintese.md): screenshots at 390 and 1440 of the screens touched,
// axe 0, and the measurements the lenses asked for: 44 px targets (Wroblewski 40), keyboard attributes per field
// (Wroblewski 36). Real data from the local D1 (design@redacao.dev admin, reporter@redacao.dev reporter). Screenshots in
// design/telas/personas-agora/.
import { part } from "./parts";
import { expect, test, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PRINTS = "design/telas/personas-agora";
const SCREENS = { celular: { width: 390, height: 844 }, computador: { width: 1440, height: 900 } } as const;
const OUTLET = "portal-litoral";
const DESIGN = { email: "design@redacao.dev", senha: "senha-forte-123" };
const REPORTER = { email: "reporter@redacao.dev", senha: "senha-forte-123" };

async function look(page: Page, label: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);   // pencil strokes finish drawing (700 ms)
  const w = page.viewportSize()!.width;
  if (w > 1000) await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path: `${PRINTS}/${label}-${w}.png`, fullPage: w > 1000 });
  if (w < 1000) await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  if (w < 1000) await page.screenshot({ path: `${PRINTS}/${label}-${w}-inteira.png`, fullPage: true });
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .setLegacyMode(true).options({ iframes: false }).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), label).toEqual([]);
}

async function signIn(page: Page, who: { email: string; senha: string } = DESIGN) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail", { exact: true }).fill(who.email);
  await page.getByLabel("Senha").fill(who.senha);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  // Sign-in lands on the first outlet by name, which depends on what other specs created: open this one.
  await expect(page).toHaveURL(/\/t\/[^/]+$/);
  await page.goto(`/t/${OUTLET}`);
}

/**
 * Every touch target 44 px tall or more (Wroblewski 40). round 4: on desktop (sidebar, from 1024 px up) the minimum is
 * 30 px, the density of mouse users (DESIGN.md §12); on mobile it stays 44.
 */
async function targets(locs: Locator[], label: string) {
  for (const l of locs) {
    const min = (l.page().viewportSize()?.width ?? 0) >= 1024 ? 30 : 44;
    const n = await l.count();
    for (let i = 0; i < n; i++) {
      const box = await l.nth(i).boundingBox();
      if (!box) continue;
      expect(box.height, `${label}: alvo ${i} de ${await l.nth(i).innerText().catch(() => "?")}`).toBeGreaterThanOrEqual(min);
    }
  }
}

/** The keyboard attributes of each of the 38 measured fields (Wroblewski 36). They do not depend on width: only at 390. */
test.describe("right keyboard in each field", () => {
  test.use({ viewport: SCREENS.celular, deviceScaleFactor: 2 });
  const attributes = async (field: Locator, expected: Record<string, string>) => {
    for (const [k, v] of Object.entries(expected)) await expect(field, k).toHaveAttribute(k, v);
  };
  const TEXTAREA = { autocapitalize: "sentences", enterkeyhint: "enter" };
  const URL = { inputmode: "url", autocapitalize: "none", autocorrect: "off", spellcheck: "false", enterkeyhint: "go" };
  const HANDLE = { autocapitalize: "none", autocorrect: "off", spellcheck: "false", autocomplete: "off" };

  test("sign in, create account, new idea, review, publish", async ({ page }) => {
    await page.goto("/entrar");
    await attributes(page.getByLabel("E-mail"), { type: "email", inputmode: "email", autocomplete: "username", autocapitalize: "none", autocorrect: "off", enterkeyhint: "next" });
    await attributes(page.getByLabel("Senha"), { type: "password", autocomplete: "current-password", enterkeyhint: "done" });
    await page.getByRole("button", { name: "Criar conta" }).click();
    await attributes(page.getByLabel("Seu nome"), { autocomplete: "name", autocapitalize: "words", enterkeyhint: "next" });
    await attributes(page.getByLabel("E-mail"), { autocomplete: "username", enterkeyhint: "next" });
    await attributes(page.getByLabel("Senha"), { autocomplete: "new-password", enterkeyhint: "done" });

    await signIn(page);
    await page.goto(`/t/${OUTLET}?nova=link`);
    const sheet = page.getByRole("dialog", { name: "Nova ideia" });
    await attributes(sheet.getByLabel("Link da notícia"), URL);
    await sheet.getByText("Texto", { exact: true }).click();
    await attributes(sheet.getByLabel("O que aconteceu?"), TEXTAREA);
    await sheet.getByText("Print", { exact: true }).click();
    await attributes(sheet.getByLabel("Print da notícia"), { type: "file", accept: "image/*" });
    await page.keyboard.press("Escape");

    const pieces = (await (await page.request.get(`/api/t/${OUTLET}/pecas?status=revisao,aprovada,agendada`)).json()).pecas as { id: string; status: string; formato: string; conta_modo: string | null }[];
    // Reels has no Rewrite, and other specs leave Reels pieces in review on this outlet.
    const review = pieces.find((p) => p.status === "revisao" && p.formato !== "reels")!;
    await page.goto(`/t/${OUTLET}/p/${review.id}`);
    await page.getByRole("button", { name: "Rejeitar" }).click();
    await attributes(page.getByLabel("Por quê?"), TEXTAREA);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Reescrever" }).click();
    await attributes(page.getByLabel(/O que mudar/), TEXTAREA);
    const approved = pieces.find((p) => p.status !== "revisao" && p.conta_modo === "manual")!;
    await page.goto(`/t/${OUTLET}/p/${approved.id}`);
    await attributes(page.getByLabel(/Link do post/), URL);
  });

  test("outlet: brand, accounts, sources and team; create outlet", async ({ page }) => {
    await signIn(page);
    await page.goto(`/t/${OUTLET}/veiculo?aba=marca`);
    await attributes(page.getByLabel("@ no Instagram"), { ...HANDLE, enterkeyhint: "done", pattern: "@?[A-Za-z0-9._]{1,30}" });
    await attributes(page.getByLabel("Logo"), { type: "file", accept: "image/png,image/svg+xml" });
    await expect(page.locator('input[type="color"]'), "as três cores").toHaveCount(3);
    // One section open at a time (and one CTA open at a time): opens each before checking its fields.
    await page.getByRole("button", { name: /^Ilustração/ }).click();
    await attributes(page.getByLabel("Estilo em uma frase"), TEXTAREA);
    await attributes(page.getByLabel("Imagem de referência"), { type: "file", accept: "image/png,image/jpeg" });
    await page.getByRole("button", { name: /^Convite do fim/ }).click();
    for (let i = 1; i <= 3; i++) {
      if (i > 1) await page.getByRole("button", { name: new RegExp(`^Convite ${i}`) }).click();
      const group = page.getByRole("group", { name: `Convite ${i}` });
      // The accessible name carries the help with it ("TítuloA frase grande do último card."): match by the start.
      for (const label of [/^Título/, /^TextoUma frase/, /^Fim da legenda/, /^Botão \(opcional\)/]) {
        await attributes(group.getByLabel(label), { autocapitalize: "sentences", enterkeyhint: "next" });
      }
    }
    await page.getByRole("button", { name: /^Marca d'água/ }).click();
    await attributes(page.getByLabel(/^Visibilidade/), { type: "range" });

    await page.goto(`/t/${OUTLET}/veiculo?aba=contas`);
    await part(page, "Ligar uma conta");
    await attributes(page.getByLabel("@ da conta no Instagram"), { ...HANDLE, enterkeyhint: "done" });

    await page.goto(`/t/${OUTLET}/veiculo?aba=fontes`);
    await part(page, "Cobertura");
    await attributes(page.getByRole("combobox", { name: "Acrescentar uma cidade" }), { autocomplete: "off", autocapitalize: "words", autocorrect: "off", enterkeyhint: "done" });
    await part(page, "Adicionar um feed RSS");
    await attributes(page.getByLabel("Nome", { exact: true }), { autocomplete: "off", autocapitalize: "words", enterkeyhint: "next" });
    await attributes(page.getByLabel("Endereço do feed"), { type: "url", inputmode: "url", autocapitalize: "none", autocorrect: "off", enterkeyhint: "done" });

    await page.goto(`/t/${OUTLET}/veiculo?aba=equipe`);
    await attributes(page.getByLabel("E-mail", { exact: true }), { type: "email", inputmode: "email", autocomplete: "off", autocapitalize: "none", enterkeyhint: "done" });

    await page.goto("/novo");
    await attributes(page.getByLabel("Nome do veículo"), { autocomplete: "organization", autocapitalize: "words", enterkeyhint: "next" });
    await attributes(page.getByRole("combobox", { name: "Município" }), { autocomplete: "off", autocapitalize: "words", autocorrect: "off", enterkeyhint: "done" });
  });
});

for (const [view, viewport] of Object.entries(SCREENS)) {
  test.describe(view, () => {
    test.use({ viewport, deviceScaleFactor: view === "celular" ? 2 : 1 });
    const desktop = view === "computador";

    test("one name per screen; sidebar with Sources on one line and dense Today; dense lists with the wait written out", async ({ page }) => {
      await signIn(page);
      // Ideas: the title is the menu item; the outlet's name stays only in the picker/bar.
      await expect(page.getByRole("heading", { level: 1, name: "Ideias" })).toBeVisible();
      await expect(page.getByRole("main").getByRole("heading", { level: 1 })).not.toContainText("Portal Litoral");
      await expect(page.getByRole("heading", { name: /por relevância/ })).toHaveCount(0);
      // Ideas all the same size (the first is not bigger).
      const titles = page.getByRole("main").locator("ol h3");
      const [a, b] = await Promise.all([titles.nth(0).evaluate((e) => getComputedStyle(e).fontSize), titles.nth(1).evaluate((e) => getComputedStyle(e).fontSize)]);
      expect(a).toBe(b);
      // The format's help. round 4: with the lead sheet (desktop), each format button says what it produces; without it
      // (mobile), the help stays on one line, once, and each idea's picker points to it.
      const format = page.getByRole("group", { name: "Formato" }).first();
      if (desktop) {
        await expect(page.locator("#formato-ajuda")).toHaveCount(0);
        await expect(format.getByRole("button", { name: /^post/ })).toContainText("1 imagem com a manchete e 1 ou 2 frases");
        await expect(format.getByRole("button", { name: /^carrossel/ })).toContainText("4 cards (capa, o que aconteceu, contexto, convite)");
      } else {
        await expect(page.locator("#formato-ajuda")).toHaveText(/^post: 1 imagem com a manchete e 1 ou 2 frases · carrossel: 4 cards/);
        await expect(format).toHaveAttribute("aria-describedby", "formato-ajuda");
      }
      // Posts in progress, the whole row as the target. round 4: they are the "Now" block's links (the next action, the short
      // queue's rows and "see the N").
      const progress = page.getByRole("region", { name: "Agora" }).getByRole("link");
      await expect(progress.first()).toBeVisible();
      await targets([progress, page.getByRole("navigation", { name: "Cidade" }).getByRole("link")], "ideias");
      await look(page, "ideias");

      await page.goto(`/t/${OUTLET}/aprovar`);
      await expect(page.getByRole("heading", { level: 1, name: "Para aprovar" })).toBeVisible();
      const lines = page.getByRole("main").getByRole("listitem").getByRole("link");
      await expect(lines.first()).toContainText(/espera há/);
      await targets([lines], "aprovar");
      await look(page, "aprovar");

      await page.goto(`/t/${OUTLET}/postar`);
      await expect(page.getByRole("heading", { level: 1, name: "Prontos para postar" })).toBeVisible();
      await targets([page.getByRole("main").getByRole("listitem").getByRole("link")], "postar");
      await look(page, "postar");

      // Outlet: title = part; on desktop without the tab row (the sidebar is the row); on mobile the tabs at 44 px.
      await page.goto(`/t/${OUTLET}/veiculo?aba=fontes`);
      await expect(page.getByRole("heading", { level: 1, name: "Fontes" })).toBeVisible();
      if (desktop) await expect(page.getByRole("navigation", { name: "Partes do veículo" })).toBeHidden();
      else {
        await part(page, "Cobertura");
        await targets([page.getByRole("navigation", { name: "Partes do veículo" }).getByRole("link"), page.getByRole("button", { name: /^Tirar/ })], "veiculo");
        await part(page, "De onde vêm as ideias");
      }
      // The green dot left: only the unavailable source gets colour.
      await expect(page.getByRole("main").locator("li .bg-verde")).toHaveCount(0);
      await expect(page.getByRole("main").locator("li .bg-ambar")).toHaveCount(1);
      await look(page, "veiculo-fontes");
    });

    test("sign in: toggle at 44 px", async ({ page }) => {
      await page.goto("/entrar");
      await targets([page.getByRole("button", { name: "Criar conta" })], "entrar");
      await look(page, "entrar");
    });

    test("reporter: read lists, no hand-made brand in an action that is not theirs", async ({ page }) => {
      await signIn(page, REPORTER);
      await expect(page.locator(".lapis-volta")).toHaveCount(0);
      await expect(page.getByRole("link", { name: /Ver$/ }).first()).toBeVisible();
      await page.goto(`/t/${OUTLET}/aprovar`);
      await expect(page.locator(".lapis-volta")).toHaveCount(0);
      await expect(page.getByRole("link", { name: /Revisar/ })).toHaveCount(0);
      await look(page, "reporter-aprovar");
      // In review, the sentence names who decides (GET members), instead of "whoever is an editor or admin".
      await page.getByRole("link", { name: /Ver$/ }).first().click();
      await expect(page.getByRole("complementary", { name: "Decisão" })).toHaveText(/decide(m)? este post|\(admin\) decide/);
      await expect(page.getByRole("complementary", { name: "Decisão" })).not.toContainText("Quem é editor ou admin");
      await look(page, "reporter-revisao");
      await page.goto(`/t/${OUTLET}/postados`);
      await expect(page.locator(".lapis-volta")).toHaveCount(0);
    });

    test("without an Instagram account, the review points the way out (Veículo › Contas) instead of 'quando um admin ligar uma'", async ({ page }) => {
      await signIn(page);
      await page.route("**/api/t/*/contas", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ contas: [] }) }));
      const pieces = (await (await page.request.get(`/api/t/${OUTLET}/pecas?status=revisao`)).json()).pecas as { id: string }[];
      await page.goto(`/t/${OUTLET}/p/${pieces[0].id}`);
      const decision = page.getByRole("complementary", { name: "Decisão" });
      await expect(decision).toContainText("Ligue uma em Veículo › Contas.");
      await expect(decision.getByRole("link", { name: "Veículo › Contas" })).toHaveAttribute("href", /\/veiculo\?aba=contas$/);
      await expect(decision).not.toContainText("quando um admin ligar uma");
      await look(page, "revisao-sem-conta");
    });
  });
}
