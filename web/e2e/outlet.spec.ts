// The outlet screen (Brand · Accounts · Sources · Team): an admin edits the brand (on a new outlet, so Portal Litoral's
// data is not touched), editor/reporter only read; entry through the sidebar's Outlet group (desktop) or the avatar
// menu (mobile); loading and error. Axe 0. Screenshots in design/telas/veiculo/.
import { partLine, part } from "./parts";
import { spawnSync } from "node:child_process";
import { expect, test, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PRINTS = "design/telas/veiculo";
const SCREENS = { celular: { width: 390, height: 844 }, computador: { width: 1440, height: 900 } } as const;
const OUTLET = "portal-litoral";
const DESIGN = { email: "design@redacao.dev", senha: "senha-forte-123" };
const REPORTER = { email: "reporter@redacao.dev", senha: "senha-forte-123" };
const ERROR_500 = { status: 500, contentType: "application/json", body: JSON.stringify({ erro: "erro interno" }) };

async function look(page: Page, label: string, folder = PRINTS) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700);
  const w = page.viewportSize()!.width;
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path: `${folder}/${label}-${w}.png`, fullPage: true });
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .setLegacyMode(true).options({ iframes: false }).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), label).toEqual([]);
}

async function signIn(page: Page, who: { email: string; senha: string }) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail", { exact: true }).fill(who.email);
  await page.getByLabel("Senha").fill(who.senha);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  // Sign-in lands on the first outlet by name, which depends on what other specs created: open this one.
  await expect(page).toHaveURL(/\/t\/[^/]+$/);
  await page.goto(`/t/${OUTLET}`);
}

const FOLDER_MD = "design/telas/marca-mestre-detalhe";
const SECTIONS = ["Nome e cores", "Ilustração", "Convite do fim", "Marca d'água"];
// The chosen section: in the desktop list (≥ 1280 px), `aria-current`; in the mobile accordion, `aria-expanded`.
async function chosen(page: Page, sections: Locator[], i: number) {
  const list = page.viewportSize()!.width >= 1280;
  for (const [j, s] of sections.entries()) {
    if (list) await (j === i ? expect(s).toHaveAttribute("aria-current", "true") : expect(s).not.toHaveAttribute("aria-current"));
    else await expect(s).toHaveAttribute("aria-expanded", String(j === i));
  }
}

// The tab row only exists on mobile; on desktop, the sidebar's Outlet group is the row (one name per screen).
const tabs = (page: Page) => (page.viewportSize()!.width >= 1024
  ? page.getByRole("navigation", { name: "Veículo", exact: true })
  : page.getByRole("navigation", { name: "Partes do veículo" }));

for (const [view, viewport] of Object.entries(SCREENS)) {
  test.describe(view, () => {
    test.use({ viewport, deviceScaleFactor: view === "celular" ? 2 : 1 });
    const desktop = view === "computador";

    test("admin: gets in from the sidebar or the avatar, sees the brand, accounts, sources and the team", async ({ page }) => {
      await signIn(page, DESIGN);
      if (desktop) {
        await page.getByRole("navigation", { name: "Veículo", exact: true }).getByRole("link", { name: "Marca" }).click();
      } else {
        await page.getByRole("button", { name: /^Conta:/ }).click();
        await page.getByRole("menuitem", { name: "Marca" }).click();
      }
      await expect(page).toHaveURL(new RegExp(`/t/${OUTLET}/veiculo\\?aba=marca$`));
      // The screen's title is the menu item that opened it; "Outlet" does not appear as a title.
      await expect(page.getByRole("heading", { level: 1, name: "Marca" })).toBeVisible();
      await expect(page.getByRole("heading", { level: 1, name: "Veículo" })).toHaveCount(0);
      if (desktop) await expect(page.getByRole("navigation", { name: "Partes do veículo" })).toBeHidden();
      await expect(page.getByRole("heading", { name: "A cara do Portal Litoral" })).toBeVisible();
      await expect(page.getByLabel("@ no Instagram")).toHaveValue("@portal.litoral");
      await expect(page.getByRole("button", { name: "Salvar a marca" })).toBeVisible();
      await expect(page.getByText("Só o admin altera")).toHaveCount(0);
      if (desktop) await expect(page.getByRole("navigation", { name: "Veículo", exact: true }).getByRole("link", { name: "Marca" })).toHaveAttribute("aria-current", "page");
      await look(page, "marca");

      await tabs(page).getByRole("link", { name: "Contas" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Contas" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Onde os posts saem" })).toBeVisible();
      const list = page.getByRole("main").getByRole("listitem");
      await expect(list.filter({ hasText: "você posta pelo celular" })).toContainText("@portal.litoral");
      await expect(list.filter({ hasText: "simulação" })).toHaveCount(1);
      await look(page, "contas");

      await tabs(page).getByRole("link", { name: "Fontes" }).click();
      await expect(page.getByRole("heading", { name: "De onde vêm as ideias" })).toBeVisible();
      await expect(list.filter({ hasText: "Prefeitura de Guarujá" })).toContainText("indisponível");
      await expect(list.filter({ hasText: "G1 Santos e Região" })).toContainText("a cada 30 min");
      await look(page, "fontes");

      await tabs(page).getByRole("link", { name: "Equipe" }).click();
      await expect(page.getByRole("heading", { name: "Quem trabalha aqui" })).toBeVisible();
      await look(page, "equipe");
      // An unknown tab falls back to Brand.
      await page.goto(`/t/${OUTLET}/veiculo?aba=xyz`);
      await expect(page.getByRole("heading", { name: "A cara do Portal Litoral" })).toBeVisible();
    });

    test("admin saves the brand of a new outlet: handle, color and logo; the selector shows the new brand", async ({ page }) => {
      await signIn(page, DESIGN);
      const n = Date.now().toString(36).slice(-5);
      const r = await page.request.post("/api/tenants", {
        data: { nome: `Veículo E2E ${n}`, modo: "local", uf: "SP", municipioIbge: "3518701", municipioNome: "Guarujá" }, headers: { origin: "http://localhost:8787" },
      });
      expect(r.status()).toBe(201);
      const { slug, id } = await r.json();
      await page.goto(`/t/${slug}/veiculo`);
      await expect(page.getByRole("heading", { name: `A cara do Veículo E2E ${n}` })).toBeVisible();
      await expect(page.getByLabel("@ no Instagram")).toHaveValue("");
      await expect(page.getByText("Sem logo ainda. PNG ou SVG, até 512 KB")).toBeVisible();
      await look(page, "marca-vazia");

      await page.getByLabel("@ no Instagram").fill(`gazeta.${n}`);
      await page.locator('input[type="color"]').first().fill("#112233");
      await page.getByLabel("Logo").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64") });
      await page.getByRole("button", { name: "Salvar a marca" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Salvo." })).toBeVisible();
      const brand = await (await page.request.get(`/api/t/${id}/marca`)).json();
      expect(brand.marca).toMatchObject({ handle: `@gazeta.${n}`, cores: { fundo: "#112233" }, temLogo: true });
      // Reloading shows what was saved, with the logo.
      await page.reload();
      await expect(page.getByLabel("@ no Instagram")).toHaveValue(`@gazeta.${n}`);
      await expect(page.getByText("Trocar arquivo")).toBeVisible();
      await expect(page.getByRole("button", { name: /trocar de veículo/ }).filter({ visible: true })).toContainText(`Veículo E2E ${n}`);

      // Accounts: the @ saved in the brand already became the manual account → turn off → turn on again → connect another through the form.
      await tabs(page).getByRole("link", { name: "Contas" }).click();
      const account = page.getByRole("main").getByRole("listitem").filter({ hasText: `@gazeta.${n}` });
      await expect(account).toContainText("você posta pelo celular");
      await look(page, "contas-uma");
      await account.getByRole("button", { name: /^Desligar/ }).click();
      await expect(account).toContainText("desligada");
      const active = await (await page.request.get(`/api/t/${id}/contas`)).json();
      expect(active.contas).toEqual([]);
      await account.getByRole("button", { name: /^Religar/ }).click();
      await expect(account).toContainText("você posta pelo celular");
      await part(page, "Ligar uma conta");
      await page.getByLabel("@ da conta no Instagram").fill(`gazeta2.${n}`);
      await page.getByRole("button", { name: "Ligar conta" }).click();
      await expect(page.getByRole("main").getByRole("listitem").filter({ hasText: `@gazeta2.${n}` })).toContainText("você posta pelo celular");

      // Sources: empty → add → the same again does not duplicate → bad address → pause → resume.
      await tabs(page).getByRole("link", { name: "Fontes" }).click();
      // Without a source, the screen arrives at the next action: the form open; the list says it is empty.
      await expect(page.getByLabel("Nome", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: /^De onde vêm as ideias/ })).toContainText("nenhuma fonte");
      await look(page, "fontes-vazia");
      await part(page, "De onde vêm as ideias");
      await expect(page.getByText("Nenhuma fonte ainda.")).toBeVisible();
      await part(page, "Adicionar um feed RSS");
      await page.getByLabel("Nome", { exact: true }).fill("Diário E2E");
      await page.getByLabel("Endereço do feed").fill(`https://diario-${n}.example/feed.xml`);
      await page.getByRole("button", { name: "Adicionar fonte" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Fonte adicionada" })).toContainText(/Entra na próxima coleta, \d\d:\d\d\./);
      const source = page.getByRole("main").getByRole("listitem").filter({ hasText: "Diário E2E" });
      await expect(source).toContainText("aguardando a primeira coleta · a cada 30 min");
      await look(page, "fontes-uma");
      await part(page, "Adicionar um feed RSS");
      await page.getByLabel("Nome", { exact: true }).fill("Outro nome");
      await page.getByLabel("Endereço do feed").fill(`https://diario-${n}.example/feed.xml`);
      await page.getByRole("button", { name: "Adicionar fonte" }).click();
      await expect(page.getByRole("status").filter({ hasText: "já estava na lista" })).toBeVisible();
      // Only the sources (Coverage, above, is also a list).
      await expect(page.getByRole("main").getByRole("listitem").filter({ hasText: "example/feed" })).toHaveCount(1);
      await part(page, "Adicionar um feed RSS");
      await page.getByLabel("Nome", { exact: true }).fill("Ruim");
      await page.getByLabel("Endereço do feed").fill("ftp://x.example/feed");
      await page.getByRole("button", { name: "Adicionar fonte" }).click();
      await expect(page.getByRole("alert")).toContainText("não parece o de um feed");
      await look(page, "fontes-erro");
      await part(page, "De onde vêm as ideias");
      // The outlet's site: applies from now on, and the sentence says what happens.
      await source.getByRole("checkbox", { name: /Este é o site do veículo/ }).click();
      await expect(page.getByText("Matéria nova do site do veículo vira post em Para aprovar")).toBeVisible();
      await look(page, "fonte-propria", "design/telas/fila-do-site");
      await source.getByRole("checkbox", { name: /Este é o site do veículo/ }).click();
      await expect(page.getByText("Matéria nova do site do veículo vira post em Para aprovar")).toHaveCount(0);
      await source.getByRole("button", { name: /^Pausar/ }).click();
      await expect(source).toContainText("pausada");
      await source.getByRole("button", { name: /^Retomar/ }).click();
      await expect(source).toContainText("aguardando a primeira coleta");

      // Team: whoever already has an account joins at once; whoever does not becomes an invite with a link; the link creates the account already inside.
      await tabs(page).getByRole("link", { name: "Equipe" }).click();
      const team = page.getByRole("main").getByRole("listitem");
      await expect(team.filter({ hasText: "Design" })).toContainText("admin");
      await page.getByLabel("E-mail", { exact: true }).fill(REPORTER.email);
      await page.getByRole("radio", { name: /^Repórter/ }).check();
      await page.getByRole("button", { name: "Convidar" }).click();
      await expect(page.getByRole("status").filter({ hasText: "já tinha conta" })).toContainText("entrou como repórter");
      await expect(team.filter({ hasText: REPORTER.email })).toContainText("repórter");
      const newEmail = `convidada-${n}@redacao.dev`;
      await page.getByLabel("E-mail", { exact: true }).fill(newEmail);
      await page.getByRole("radio", { name: /^Editor/ }).check();
      await page.getByRole("button", { name: "Convidar" }).click();
      await expect(page.getByRole("heading", { name: "Convites pendentes" })).toBeVisible();
      const invite = team.filter({ hasText: newEmail });
      await expect(invite).toContainText("editor");
      const link = (await invite.locator("span[title]").getAttribute("title"))!;
      expect(link).toMatch(/\/entrar\?convite=[\w-]+$/);
      await look(page, "equipe");
      // The same email again: already a member.
      await page.getByLabel("E-mail", { exact: true }).fill(REPORTER.email);
      await page.getByRole("button", { name: "Convidar" }).click();
      await expect(page.getByRole("alert")).toContainText("já é reporter deste veículo");

      // Someone else opens the link: create account comes with the email; on creating, lands in the outlet as an editor.
      const other = await page.context().browser()!.newContext({ viewport, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
      const p2 = await other.newPage();
      await p2.goto(link);
      await expect(p2.getByRole("heading", { name: "Criar conta" })).toBeVisible();
      await expect(p2.getByRole("status")).toContainText(`Você foi convidado para Veículo E2E ${n} como editor`);
      await expect(p2.getByLabel("E-mail", { exact: true })).toHaveValue(newEmail);
      if (desktop) await p2.screenshot({ path: `${PRINTS}/entrar-convite-${viewport.width}.png` });
      await p2.getByLabel("Seu nome").fill("Convidada E2E");
      await p2.getByLabel("Senha").fill("senha-forte-123");
      await p2.getByRole("button", { name: "Criar conta", exact: true }).click();
      await expect(p2).toHaveURL(new RegExp(`/t/${slug}$`));
      const me = await (await p2.request.get("/api/me")).json();
      expect(me.tenants.find((t: { slug: string }) => t.slug === slug)?.papel).toBe("editor");
      await other.close();
      // For the inviter, the invite left the list and the person is on the team.
      await page.reload();
      await expect(team.filter({ hasText: "Convidada E2E" })).toContainText("editor");
      await expect(page.getByRole("heading", { name: "Convites pendentes" })).toHaveCount(0);
    });

    test("brand in sections: master-detail on desktop, accordion on mobile, summary, section preview and section in the URL", async ({ page }) => {
      await signIn(page, DESIGN);
      await page.goto(`/t/${OUTLET}/veiculo?aba=marca`);
      const sections = SECTIONS.map((name) => page.getByRole("button", { name: new RegExp(`^${name}`) }));
      // Without ?secao=, the first is chosen; the others show the summary of what is chosen.
      await chosen(page, sections, 0);
      await expect(page.getByLabel("@ no Instagram")).toBeVisible();
      await expect(page.getByLabel("Estilo em uma frase")).toHaveCount(0);
      await expect(sections[1]).toContainText("com imagem");
      await expect(sections[2]).toContainText("3 convites");
      await expect(sections[3]).toContainText(/canto|rodapé|nenhuma/);
      if (desktop) {
        // The list points to the panel, which is a region with the section's name.
        await expect(sections[0]).toHaveAttribute("aria-controls", "painel-secao");
        await expect(page.getByRole("region", { name: "Nome e cores" })).toHaveAttribute("id", "painel-secao");
        await expect(page.getByRole("list", { name: "Seções da marca" }).getByRole("listitem")).toHaveCount(6);
      }
      // Touch target: each section's row is at least 44 px (measured at 390 and 1440).
      for (const s of sections) expect((await s.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await look(page, "nome", FOLDER_MD);

      // Changes the @ without saving, switches section, comes back: the value stays.
      await page.getByLabel("@ no Instagram").fill("@rascunho.e2e");
      await sections[1].click();
      await expect(page).toHaveURL(/[?&]secao=ilustracao/);
      await expect(page.getByLabel("@ no Instagram")).toHaveCount(0);
      await expect(page.getByRole("figure").getByText("Referência no lugar da ilustração · ela orienta o estilo, não sai no post")).toBeVisible();
      await look(page, "ilustracao", FOLDER_MD);
      await sections[0].click();
      await expect(page.getByLabel("@ no Instagram")).toHaveValue("@rascunho.e2e");
      await chosen(page, sections, 0);

      // Closing CTA: the preview becomes the CTA card with CTA 1's title; the URL keeps the section.
      await sections[2].click();
      await expect(page).toHaveURL(new RegExp(`/t/${OUTLET}/veiculo\\?aba=marca&secao=convites$`));
      const title1 = await page.getByRole("group", { name: "Convite 1" }).getByRole("textbox", { name: /^Título/ }).inputValue();
      const preview = page.locator("iframe[title^='Prévia do card']");
      await expect(preview).toHaveCount(1);
      await expect.poll(async () => (await preview.getAttribute("srcdoc")) ?? "").toContain(`<h1 id="headline">${title1}</h1>`);
      await expect.poll(async () => (await preview.getAttribute("srcdoc")) ?? "").toContain('class="phone"');
      // One CTA open at a time: the others are a row with the title.
      await expect(page.getByRole("group", { name: /^Convite [23]$/ })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^Convite 2/ })).toHaveAttribute("aria-expanded", "false");
      await look(page, "convites", FOLDER_MD);
      // Reloading keeps the section (the @ draft does not survive the reload: the browser warns and it is lost).
      page.once("dialog", (d) => d.accept());
      await page.reload();
      await chosen(page, sections, 2);
      await expect(page.getByRole("group", { name: "Convite 1" })).toBeVisible();
      await expect(sections[0]).toContainText("@portal.litoral");

      await sections[3].click();
      await expect(page.getByRole("radiogroup", { name: "Posição da marca d'água" })).toBeVisible();
      await expect.poll(async () => (await preview.getAttribute("srcdoc")) ?? "").toContain('class="card cover"');
      await look(page, "marca-dagua", FOLDER_MD);
    });

    test("brand: unsaved changes marked by section, a line beside Save, warning on reload; saving clears it", async ({ page }) => {
      await signIn(page, DESIGN);
      const n = Date.now().toString(36).slice(-5);
      const r = await page.request.post("/api/tenants", {
        data: { nome: `Veículo E2E ${n} alterado`, modo: "local", uf: "SP", municipioIbge: "3518701", municipioNome: "Guarujá" }, headers: { origin: "http://localhost:8787" },
      });
      const { slug } = await r.json();
      await page.goto(`/t/${slug}/veiculo?aba=marca`);
      const sections = SECTIONS.map((name) => page.getByRole("button", { name: new RegExp(`^${name}`) }));
      const sentence = page.getByText(/^Alterações não salvas em /);
      await expect(page.getByLabel("@ no Instagram")).toBeVisible();
      for (const s of sections) await expect(s).not.toContainText("alterado");
      await expect(sentence).toHaveCount(0);

      // Changes the @ and the watermark: both sections say "changed" and the sentence lists both.
      await page.getByLabel("@ no Instagram").fill(`alt.${n}`);
      await sections[3].click();
      await page.getByRole("radio", { name: /^Rodapé/ }).check();
      await sections[1].click();
      await expect(sections[0]).toContainText("alterado");
      await expect(sections[3]).toContainText("alterado");
      await expect(sections[2]).not.toContainText("alterado");
      await expect(sentence).toHaveText("Alterações não salvas em Nome e cores e Marca d'água.");
      await look(page, "alterado", FOLDER_MD);

      // Salvar limpa as marcas e a frase.
      await page.getByRole("button", { name: "Salvar a marca" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Salvo." })).toBeVisible();
      for (const s of sections) await expect(s).not.toContainText("alterado");
      await expect(sentence).toHaveCount(0);

      // Going back by hand to what is saved also clears it; changed again, reloading asks the browser for confirmation.
      await sections[0].click();
      await page.getByLabel("@ no Instagram").fill(`outro.${n}`);
      await expect(sentence).toHaveText("Alterações não salvas em Nome e cores.");
      await page.getByLabel("@ no Instagram").fill(`@alt.${n}`);
      await expect(sentence).toHaveCount(0);
      await page.getByLabel("@ no Instagram").fill(`outro.${n}`);
      const dialog = page.waitForEvent("dialog");
      const reload = page.reload();
      const d = await dialog;
      expect(d.type()).toBe("beforeunload");
      await d.accept();
      await reload;
      await expect(page.getByLabel("@ no Instagram")).toHaveValue(`@alt.${n}`);

      // Dark Text and Background: the Name and colours summary says "low contrast", in amber.
      const colors = page.locator('input[type="color"]');
      await colors.nth(0).fill("#111111");
      await colors.nth(1).fill("#222222");
      await sections[1].click();
      await expect(sections[0]).toContainText("contraste baixo");
      await expect(sections[0].getByText("contraste baixo")).toHaveClass(/text-ambar/);
    });

    test("brand: switching section does not move the list on desktop", async ({ page }) => {
      test.skip(!desktop, "the fixed list only exists from 1280 px up");
      await signIn(page, DESIGN);
      await page.goto(`/t/${OUTLET}/veiculo?aba=marca`);
      const watermark = page.getByRole("button", { name: /^Marca d'água/ });
      const before = (await watermark.boundingBox())!.y;
      await page.getByRole("button", { name: /^Convite do fim/ }).click();
      await expect(page.getByRole("group", { name: "Convite 1" })).toBeVisible();
      expect((await watermark.boundingBox())!.y).toBe(before);
      await page.getByRole("button", { name: /^Ilustração/ }).click();
      await expect(page.getByLabel("Estilo em uma frase")).toBeVisible();
      expect((await watermark.boundingBox())!.y).toBe(before);

      // A long summary without spaces (a single-word style; a 30-letter @) wraps inside the 220 px column, without
      // invading the middle panel.
      await page.getByLabel("Estilo em uma frase").fill("a".repeat(120));
      await page.getByRole("button", { name: /^Nome e cores/ }).click();
      await page.getByLabel("@ no Instagram").fill("a".repeat(30));
      await page.getByRole("button", { name: /^Marca d'água/ }).click();
      const list = (await page.getByRole("list", { name: "Seções da marca" }).boundingBox())!;
      const panel = (await page.getByRole("region", { name: "Marca d'água" }).boundingBox())!;
      for (const name of ["Nome e cores", "Ilustração"]) {
        const item = page.getByRole("button", { name: new RegExp(`^${name}`) });
        const box = (await item.boundingBox())!;
        expect(box.x + box.width).toBeLessThanOrEqual(list.x + list.width + 0.5);
        expect(await item.evaluate((b) => [...b.querySelectorAll(":scope > span")].every((s) => s.scrollWidth <= s.clientWidth + 1))).toBe(true);
        expect(box.x + box.width).toBeLessThan(panel.x);
      }
    });

    test("reporter sees it read-only: 'Só o admin altera', fields disabled, no save", async ({ page }) => {
      await signIn(page, REPORTER);
      await page.goto(`/t/${OUTLET}/veiculo?aba=marca`);
      await expect(page.getByText("Só o admin altera. Você vê como está.")).toBeVisible();
      await expect(page.getByLabel("@ no Instagram")).toBeDisabled();
      await expect(page.getByRole("button", { name: "Salvar a marca" })).toHaveCount(0);
      await expect(page.getByText("Escolher arquivo")).toHaveCount(0);
      await look(page, "marca-leitura");
      // The sections open for whoever only reads (only the fields are disabled).
      await page.getByRole("button", { name: /^Convite do fim/ }).click();
      await expect(page.getByRole("group", { name: "Convite 1" }).getByRole("textbox", { name: /^Título/ })).toBeDisabled();
      await page.getByRole("button", { name: /^Convite 2/ }).click();
      await expect(page.getByRole("group", { name: "Convite 2" }).getByRole("textbox", { name: /^Título/ })).toBeDisabled();
      await page.getByRole("button", { name: /^Marca d'água/ }).click();
      await expect(page.getByRole("radio", { name: /^Canto/ })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Salvar a marca" })).toHaveCount(0);
      await tabs(page).getByRole("link", { name: "Contas" }).click();
      await expect(page.getByRole("button", { name: "Ligar conta" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^Desligar/ })).toHaveCount(0);
      await tabs(page).getByRole("link", { name: "Fontes" }).click();
      await expect(page.getByRole("button", { name: "Adicionar fonte" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^Pausar/ })).toHaveCount(0);
      await tabs(page).getByRole("link", { name: "Equipe" }).click();
      await expect(page.getByRole("main").getByRole("listitem").filter({ hasText: "Design" })).toContainText("admin");
      await expect(page.getByRole("button", { name: "Convidar" })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Convites pendentes" })).toHaveCount(0);
    });

    test("brand loading and error", async ({ page }) => {
      await signIn(page, DESIGN);
      await page.route("**/api/t/*/marca", () => new Promise<void>(() => {}));
      await page.goto(`/t/${OUTLET}/veiculo`);
      await expect(page.getByRole("status").filter({ hasText: "Carregando a marca" })).toBeAttached();
      await look(page, "marca-carga");
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await page.route("**/api/t/*/marca", (route) => route.fulfill(ERROR_500));
      await page.reload();
      await expect(page.getByRole("alert")).toContainText("Não carregou a marca.");
      await look(page, "marca-erro");
      await page.unrouteAll();
      await page.getByRole("button", { name: "Tentar de novo" }).click();
      await expect(page.getByLabel("@ no Instagram")).toHaveValue("@portal.litoral");
    });

    test("site story: the origin in Ideas, Approve and go to the next one in Review", async ({ page }) => {
      const PIECE = "e2e-anuncio-peca";
      const d1 = (args: string) => expect(spawnSync(`npx wrangler d1 execute redacao-db --local ${args}`, { shell: true, stdio: "ignore" }).status).toBe(0);
      d1("--file seeds/ad-cleanup-local.sql");
      d1("--file seeds/ad-local.sql");
      d1(`--command "UPDATE pautas SET origem = 'site', tipo_post = NULL WHERE id IN ('e2e-anuncio-pauta', 'e2e-anuncio-ideia'); DELETE FROM anuncios WHERE pauta_id IN ('e2e-anuncio-pauta', 'e2e-anuncio-ideia')"`);
      try {
        await signIn(page, DESIGN);
        await expect(page.getByRole("listitem").filter({ hasText: "Pizza em dobro" })).toContainText("do seu site");
        await look(page, "ideias", "design/telas/fila-do-site");

        // A single account (the test outlet has more) and a simulated decision: the piece's state is left for the other specs.
        let decision: unknown = null;
        await page.route("**/api/t/*/contas*", async (route) => {
          const r = await route.fetch();
          const j = await r.json();
          await route.fulfill({ response: r, json: { ...j, contas: j.contas.slice(0, 1) } });
        });
        await page.route(`**/api/t/*/pecas/${PIECE}/revisao`, async (route) => {
          decision = route.request().postDataJSON();
          await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
        });
        await page.goto(`/t/${OUTLET}/p/${PIECE}`);
        const oneTouch = page.getByRole("button", { name: "Aprovar e ir para a próxima" });
        await expect(oneTouch).toBeVisible();
        await look(page, "revisao", "design/telas/fila-do-site");
        await oneTouch.click();
        await expect.poll(() => decision).toMatchObject({ decisao: "aprovar", versao: 1 });
        await expect(page).not.toHaveURL(new RegExp(PIECE));
        await expect(page).toHaveURL(/\/t\/portal-litoral\/(p\/|aprovar)/);
      } finally {
        await page.unrouteAll({ behavior: "ignoreErrors" });
        d1("--file seeds/ad-cleanup-local.sql");
      }
    });

    test("Accounts in parts: the action in view, one at a time, in the URL", async ({ page }) => {
      await signIn(page, DESIGN);
      await page.goto(`/t/${OUTLET}/veiculo?aba=contas`);
      const list = partLine(page, "Onde os posts saem");
      const enable = partLine(page, "Ligar uma conta");
      await expect(list).toHaveAttribute("aria-expanded", "true");
      await expect(enable).toBeInViewport();
      await enable.click();
      await expect(page).toHaveURL(/[?&]parte=ligar/);
      await expect(page.getByRole("button", { name: "Ligar conta" })).toBeInViewport();
      await page.reload();
      await expect(page.getByLabel("@ da conta no Instagram")).toBeVisible();
      await expect(list).toContainText(/\d+ contas?/);
      await list.click();
      await expect(page.getByLabel("@ da conta no Instagram")).toBeHidden();
      await expect(page.getByRole("main").getByRole("listitem").filter({ hasText: "@portal.litoral" }).first()).toBeVisible();
    });

    test("Sources in parts: warning open, one at a time, in the URL, and the closed row keeps the alert", async ({ page }) => {
      await signIn(page, DESIGN);
      await page.goto(`/t/${OUTLET}/veiculo?aba=fontes`);
      // The unavailable source opens its part by itself.
      const list = partLine(page, "De onde vêm as ideias");
      await expect(list).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByRole("main").getByRole("listitem").filter({ hasText: "Prefeitura de Guarujá" })).toContainText("indisponível");
      await expect(partLine(page, "Adicionar um feed RSS")).toBeInViewport();
      // Opening one switches from the other and stays in the URL; reloading keeps it.
      const add = partLine(page, "Adicionar um feed RSS");
      await add.click();
      await expect(page).toHaveURL(/[?&]parte=adicionar/);
      await expect(add).toHaveAttribute("aria-expanded", "true");
      await expect(list).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByLabel("Endereço do feed")).toBeVisible();
      await page.reload();
      await expect(page.getByLabel("Endereço do feed")).toBeVisible();
      // Closed, the row keeps saying what is wrong, in the warning colour.
      await expect(list).toContainText("1 indisponível");
      await expect(list.locator(".text-ambar")).toContainText("1 indisponível");
      await list.click();
      await expect(list).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByLabel("Endereço do feed")).toBeHidden();
      if (!desktop) {
        // In the accordion the open part closes, and the URL keeps that.
        await list.click();
        await expect(list).toHaveAttribute("aria-expanded", "false");
        await expect(page).toHaveURL(/[?&]parte=nenhuma/);
        await page.reload();
        await expect(list).toHaveAttribute("aria-expanded", "false");
      }
    });

    test("Brand: font and language in a closed part, with the summary, and Save always in view", async ({ page }) => {
      await signIn(page, DESIGN);
      await page.goto(`/t/${OUTLET}/veiculo?aba=marca&secao=nome`);
      const save = page.getByRole("button", { name: "Salvar a marca" });
      await expect(save).toBeInViewport();
      const letter = partLine(page, "Letra e idioma");
      await expect(letter).toHaveAttribute("aria-expanded", "false");
      await expect(letter).toContainText(/ · Português/);
      await letter.click();
      await expect(page).toHaveURL(/[?&]letra=aberta/);
      await expect(page.getByRole("group", { name: "Fontes do card" })).toBeVisible();
      await page.reload();
      await expect(page.getByRole("group", { name: "Fontes do card" })).toBeVisible();
      await expect(save).toBeInViewport();
      await letter.click();
      await expect(page.getByRole("group", { name: "Fontes do card" })).toBeHidden();
    });

    test("in English: the outlet's site checkbox", async ({ page }) => {
      await signIn(page, DESIGN);
      await page.request.put("/api/me/idioma", { data: { idioma: "en" }, headers: { origin: "http://localhost:8787" } });
      try {
        await page.goto(`/t/${OUTLET}/veiculo?aba=fontes`);
        await expect(page.getByRole("checkbox", { name: /This is the outlet's site/ }).first()).toBeVisible();
      } finally {
        await page.request.put("/api/me/idioma", { data: { idioma: "pt-BR" }, headers: { origin: "http://localhost:8787" } });
      }
    });
  });
}

test.describe("middle widths", () => {
  test("master-detail from 1280 px up, accordion below", async ({ page }) => {
    await signIn(page, DESIGN);
    for (const [width, master] of [[1024, false], [1279, false], [1280, true]] as const) {
      await page.setViewportSize({ width: width, height: 900 });
      await page.goto(`/t/${OUTLET}/veiculo?aba=fontes`);
      await expect(partLine(page, "Adicionar um feed RSS")).toBeVisible();
      await expect(page.getByRole("list", { name: "Partes das fontes" })).toHaveCount(master ? 1 : 0);
    }
  });

  // round 4: the ideas are a list, no longer a grid of two or three columns. Without a new idea three stay in view without
  // the lead sheet (below 1180 px) and six with it; the rest goes to "More ideas".
  test("Ideas: without the lead sheet, three ideas in view; with it, six", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await signIn(page, DESIGN);
    await page.goto(`/t/${OUTLET}`);
    const total = ((await (await page.request.get(`/api/t/${OUTLET}/pautas?status=sugerida,aceita`)).json()).pautas as unknown[]).length;
    expect(total, "D1 local precisa de mais de três ideias (README, Teste local)").toBeGreaterThan(3);
    const view = page.locator(".pauta-lista").first().locator("> li");
    await expect(partLine(page, "Mais ideias")).toBeVisible();
    await expect(view).toHaveCount(3);
    await expect(page.getByRole("region", { name: "Folha de pauta" })).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 900 });
    // The count applies on arrival: changing the width brings the sheet, but does not move the idea between lists.
    await expect(page.getByRole("region", { name: "Folha de pauta" })).toBeVisible();
    await expect(view).toHaveCount(3);
    await page.reload();
    await expect(view).toHaveCount(Math.min(total, 6));
    await expect(partLine(page, "Mais ideias")).toHaveCount(total > 6 ? 1 : 0);
  });

  test("crossing 1280 px does not erase what was typed in the part", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page, DESIGN);
    await page.goto(`/t/${OUTLET}/veiculo?aba=fontes&parte=adicionar`);
    await page.getByLabel("Nome", { exact: true }).fill("Rascunho da largura");
    await page.setViewportSize({ width: 1279, height: 900 });
    await expect(page.getByRole("list", { name: "Partes das fontes" })).toHaveCount(0);
    await expect(page.getByLabel("Nome", { exact: true })).toHaveValue("Rascunho da largura");
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.getByLabel("Nome", { exact: true })).toHaveValue("Rascunho da largura");
  });

  test("an alert that arrives later opens the part; an action failure in a closed panel too", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, DESIGN);
    // Coverage fails after the sources: the part opens by itself, with the message and Try again.
    await page.route("**/api/t/*/areas", async (route) => {
      await new Promise((r) => setTimeout(r, 1200));
      await route.fulfill({ status: 500, contentType: "application/json", body: '{"erro":"x"}' });
    });
    await page.goto(`/t/${OUTLET}/veiculo?aba=fontes`);
    await expect(partLine(page, "Cobertura")).toHaveAttribute("aria-expanded", "true", { timeout: 15_000 });
    await page.unrouteAll({ behavior: "ignoreErrors" });
    // The daily digest fails after the person went to another part: the part opens again, with the error.
    await page.goto(`/t/${OUTLET}/veiculo?aba=fontes&parte=resumo`);
    await page.route("**/api/t/*/resumo", async (route) => {
      if (route.request().method() !== "PATCH") return route.fallback();
      await new Promise((r) => setTimeout(r, 800));
      await route.fulfill({ status: 500, contentType: "application/json", body: '{"erro":"x"}' });
    });
    await page.getByRole("checkbox", { name: /Resumo do dia às 18h/ }).click();
    await partLine(page, "De onde vêm as ideias").click();
    await expect(page.getByRole("alert").filter({ hasText: /resumo/i })).toBeVisible();
    await expect(partLine(page, "Resumo do dia")).toHaveAttribute("aria-expanded", "true");
  });
});
