// The "Product improvement" batch: sources read through the browser, a visible simple illustration, accounts that post
// by themselves, multi-city coverage, the full brand. Against `wrangler dev` with the seeded local D1
// (seeds/portal-litoral.sql + seeds/improvements-local.sql). Axe 0. Screenshots in design/telas/melhora/.
import { partLine, part } from "./parts";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PRINTS = "design/telas/melhora";
const SCREENS = { celular: { width: 390, height: 844 }, computador: { width: 1440, height: 900 } } as const;
const OUTLET = "portal-litoral";
const DESIGN = { email: "design@redacao.dev", senha: "senha-forte-123" };

async function look(page: Page, label: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700);
  const w = page.viewportSize()!.width;
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path: `${PRINTS}/${label}-${w}.png`, fullPage: true });
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

for (const [view, viewport] of Object.entries(SCREENS)) {
  test.describe(view, () => {
    test.use({ viewport, deviceScaleFactor: view === "celular" ? 2 : 1 });

    test("sources: the one that blocks the fetch shows as read by the browser", async ({ page }) => {
      await signIn(page);
      await page.goto(`/t/${OUTLET}/veiculo?aba=fontes`);
      const list = page.getByRole("main").getByRole("listitem");
      await expect(list.filter({ hasText: "A Tribuna" })).toContainText("lida pelo navegador");
      await expect(list.filter({ hasText: "G1 Santos e Região" })).not.toContainText("lida pelo navegador");
      await look(page, "fontes");
    });

    test("simple illustration: amber band in the review; reference warning on the brand", async ({ page }) => {
      await signIn(page);
      // A piece in review in the local D1: Kie answered 402 (no credit) and the art fell back to the default style.
      await page.goto(`/t/${OUTLET}/p/12f4e3f8-4beb-4b88-b8a1-26c329441da2`);
      const band = page.getByRole("note").filter({ hasText: "Ilustração simples" });
      await expect(band).toHaveText("Ilustração simples: o serviço de ilustração está sem crédito.");
      await expect(band).toHaveClass(/faixa-aviso/);
      await look(page, "revisao");
      // Portal Litoral has a reference: no warning. A new outlet does not.
      await page.goto(`/t/${OUTLET}/veiculo?aba=marca`);
      await expect(page.getByRole("heading", { name: "A cara do Portal Litoral" })).toBeVisible();
      await expect(page.getByText("Sem imagem de referência")).toHaveCount(0);
      const n = Date.now().toString(36).slice(-5);
      const r = await page.request.post("/api/tenants", {
        data: { nome: `Ref E2E ${n}`, modo: "local", uf: "SP", municipioIbge: "3518701", municipioNome: "Guarujá" }, headers: { origin: "http://localhost:8787" },
      });
      const { slug } = await r.json();
      await page.goto(`/t/${slug}/veiculo?aba=marca`);
      // Closed, the Illustration section already says it in the summary (in amber); open, the warning strip.
      const illustration = page.getByRole("button", { name: /^Ilustração/ });
      await expect(illustration).toContainText("sem imagem de referência");
      await illustration.click();
      await expect(page.getByRole("note").filter({ hasText: "Sem imagem de referência: as ilustrações saem no estilo padrão." })).toBeVisible();
    });

    test("accounts: manual on, direct Instagram and Ayrshare on a new outlet; the secret does not come back", async ({ page }) => {
      await signIn(page);
      const n = Date.now().toString(36).slice(-5);
      const r = await page.request.post("/api/tenants", {
        data: { nome: `Contas E2E ${n}`, modo: "local", uf: "SP", municipioIbge: "3518701", municipioNome: "Guarujá" }, headers: { origin: "http://localhost:8787" },
      });
      const { slug, id } = await r.json();
      await page.goto(`/t/${slug}/veiculo?aba=contas`);
      const list = page.getByRole("main").getByRole("listitem");
      const enable = page.getByRole("button", { name: "Ligar conta" });

      // Without an account, the screen arrives at the form; connecting leads to the list, where the new account appears.
      await page.getByLabel("@ da conta no Instagram").fill(`manual.${n}`);
      await enable.click();
      await expect(list.filter({ hasText: `@manual.${n}` })).toContainText("você posta pelo celular");

      await part(page, "Ligar uma conta");
      await page.getByRole("radio", { name: /Instagram direto/ }).check();
      await page.getByLabel("@ da conta no Instagram").fill(`direto.${n}`);
      await page.getByLabel("Id da conta profissional").fill("17841400000000000");
      await page.getByLabel("Token de acesso").fill("EAAG-token-de-teste");
      await expect(page.getByLabel("Token de acesso")).toHaveAttribute("type", "password");
      await enable.click();
      await expect(list.filter({ hasText: `@direto.${n}` })).toContainText("posta sozinho no Instagram");

      await part(page, "Ligar uma conta");
      await page.getByRole("radio", { name: /Por intermediário/ }).check();
      await expect(page.getByRole("radio", { name: /PostPeer/ })).toBeDisabled();
      await expect(page.getByRole("radio", { name: /Zernio/ })).toBeDisabled();
      await page.getByLabel("@ da conta no Instagram").fill(`ayr.${n}`);
      await page.getByLabel("Chave da API").fill("AYR-chave-de-teste");
      await page.getByLabel("Profile Key (opcional)").fill("PERFIL-TESTE");
      await enable.click();
      await expect(list.filter({ hasText: `@ayr.${n}` })).toContainText("posta sozinho pelo Ayrshare");
      await look(page, "contas");
      await part(page, "Ligar uma conta");
      await expect(page.getByLabel("Chave da API")).toHaveValue("");

      const body = await (await page.request.get(`/api/t/${id}/contas?todas=1`)).text();
      expect(body).not.toContain("EAAG-token-de-teste");
      expect(body).not.toContain("AYR-chave-de-teste");
      expect(body).not.toContain("PERFIL-TESTE");
    });

    test("coverage: two cities in the Sources tab; Ideas shows the city and filters by it", async ({ page }) => {
      await signIn(page);
      await page.goto(`/t/${OUTLET}/veiculo?aba=fontes`);
      await expect(page.getByRole("button", { name: /^Cobertura/ })).toContainText("2 cidades");
      await part(page, "Cobertura");
      const cities = page.getByRole("list", { name: "Cidades cobertas" });
      await expect(cities.getByRole("listitem")).toHaveText([/Guarujá · SP/, /Santos · SP/]);
      await look(page, "cobertura");

      await page.goto(`/t/${OUTLET}`);
      const filter = page.getByRole("navigation", { name: "Cidade" });
      await expect(filter.getByRole("link")).toHaveText(["Todas", "Guarujá · SP", "Santos · SP"]);
      await expect(filter.getByRole("link", { name: "Todas" })).toHaveAttribute("aria-current", "page");
      // round 4: with the lead sheet (desktop) six ideas stay in view, and "More ideas" only exists beyond that.
      const allAsIdeas = async () => {
        await expect(page.locator(".pauta-lista > li").first()).toBeVisible();
        if (await partLine(page, "Mais ideias").count()) await part(page, "Mais ideias");
      };
      await allAsIdeas();
      const santos = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: /Ponte dos Barreiros/ }) });
      await expect(santos).toContainText("Santos");
      await filter.getByRole("link", { name: "Santos · SP" }).click();
      await expect(page).toHaveURL(/\?cidade=3548500$/);
      await expect(filter.getByRole("link", { name: "Santos · SP" })).toHaveAttribute("aria-current", "page");
      await expect(page.getByRole("heading", { name: /Polícia apreende granadas/ })).toHaveCount(0);
      await expect(santos).toBeVisible();
      await look(page, "ideias-santos");
      await filter.getByRole("link", { name: "Todas" }).click();
      // The marked chip comes out with the same layout as the unfiltered list: only after it can one know whether there are "More ideas".
      await expect(filter.getByRole("link", { name: "Todas" })).toHaveAttribute("aria-current", "page");
      await allAsIdeas();
      // round 4: the chosen idea's headline also appears on the lead sheet; the list's one is the row's h3.
      await expect(page.getByRole("heading", { level: 3, name: /Polícia apreende granadas/ })).toBeVisible();
      // Coverage did not load: the URL's filter keeps applying and the screen says what happened.
      await page.route("**/api/t/*/areas", (route) => route.fulfill({ status: 500, contentType: "application/json", body: '{"erro":"x"}' }));
      await page.goto(`/t/${OUTLET}?cidade=3548500`);
      await expect(page.getByRole("alert").filter({ hasText: "Não carregou as cidades" })).toBeVisible({ timeout: 15_000 });
      await expect(santos).toBeVisible();
      await expect(page.getByRole("heading", { name: /Polícia apreende granadas/ })).toHaveCount(0);
      await page.unrouteAll();
    });

    test("brand: invite texts and the Portal Litoral watermark saved and in the preview", async ({ page }) => {
      await signIn(page);
      await page.goto(`/t/${OUTLET}/veiculo?aba=marca`);
      // One section open at a time and, in Closing CTA, one CTA open at a time: open it before filling in.
      await page.getByRole("button", { name: /^Convite do fim/ }).click();
      await expect(page.getByRole("group", { name: "Convite 1" }).getByRole("textbox", { name: /^Título/ })).toHaveValue("Seu bairro, com fonte.");
      const button3 = page.getByRole("group", { name: "Convite 3" }).getByRole("textbox", { name: /^Botão/ });
      await page.getByRole("button", { name: /^Convite 3/ }).click();
      await button3.fill("Compartilhe com o vizinho");
      await page.getByRole("button", { name: /^Marca d'água/ }).click();
      await page.getByRole("radio", { name: /^Canto/ }).check();
      await page.getByRole("slider").fill("50");
      await expect(page.getByText("Visibilidade 50%")).toBeVisible();
      const preview = page.locator("iframe[title^='Prévia do card']");
      await expect.poll(async () => (await preview.getAttribute("srcdoc")) ?? "").toContain('class="marca-dagua canto" style="opacity:0.50"');
      await page.getByRole("button", { name: "Salvar a marca" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Salvo." })).toBeVisible();
      await page.reload();
      // The open section is in the URL: reloading goes back to Watermark.
      await expect(page.getByRole("radio", { name: /^Canto/ })).toBeChecked();
      await expect.poll(async () => (await preview.getAttribute("srcdoc")) ?? "").toContain("marca-dagua canto");
      await page.getByRole("button", { name: /^Convite do fim/ }).click();
      await page.getByRole("button", { name: /^Convite 3/ }).click();
      await expect(button3).toHaveValue("Compartilhe com o vizinho");
      // The CTA's highlights and phone stay (only the texts change): the rich card still has what it needs.
      const { marca: brand } = await (await page.request.get(`/api/t/${OUTLET}/marca`)).json();
      expect(brand.ctas[2].acao).toBe("Compartilhe com o vizinho");
      expect(brand.ctas).toHaveLength(3);
      await look(page, "marca");
    });

    test("brand: new outlet gets style, reference image and a watermark in the footer", async ({ page }) => {
      await signIn(page);
      const n = Date.now().toString(36).slice(-5);
      const r = await page.request.post("/api/tenants", {
        data: { nome: `Marca E2E ${n}`, modo: "local", uf: "SP", municipioIbge: "3518701", municipioNome: "Guarujá" }, headers: { origin: "http://localhost:8787" },
      });
      const { slug, id } = await r.json();
      await page.goto(`/t/${slug}/veiculo?aba=marca`);
      await expect(page.getByRole("button", { name: /^Convite do fim/ })).toContainText("sem convite");
      await page.getByRole("button", { name: /^Convite do fim/ }).click();
      await expect(page.getByText("Este veículo ainda não tem textos de convite")).toBeVisible();
      await page.getByRole("button", { name: /^Nome e cores/ }).click();
      await page.getByLabel("@ no Instagram").fill(`marca.${n}`);
      await page.getByRole("button", { name: /^Ilustração/ }).click();
      await page.getByLabel("Estilo em uma frase").fill("traço leve, tons de areia e azul do mar");
      await page.getByLabel("Imagem de referência").setInputFiles({ name: "ref.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64") });
      await page.getByRole("button", { name: /^Marca d'água/ }).click();
      await page.getByRole("radio", { name: /^Rodapé/ }).check();
      await page.getByRole("slider").fill("30");
      await page.getByRole("button", { name: "Salvar a marca" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Salvo." })).toBeVisible();
      await page.reload();
      const preview = page.locator("iframe[title^='Prévia do card']");
      await expect.poll(async () => (await preview.getAttribute("srcdoc")) ?? "").toContain(`<div class="marca-dagua rodape" style="opacity:0.30" aria-hidden="true"><span>@marca.${n}</span></div>`);
      await page.getByRole("button", { name: /^Ilustração/ }).click();
      await expect(page.getByLabel("Estilo em uma frase")).toHaveValue("traço leve, tons de areia e azul do mar");
      await expect(page.getByRole("img", { name: "Imagem de referência atual" })).toBeVisible();
      await expect(page.getByText("Sem imagem de referência")).toHaveCount(0);
      const { marca: brand } = await (await page.request.get(`/api/t/${id}/marca`)).json();
      expect(brand).toMatchObject({ temReferencia: true, estiloArte: "traço leve, tons de areia e azul do mar", marcaDagua: { posicao: "rodape", opacidade: 0.3 } });
      await look(page, "marca-nova");
    });

    test("coverage: admin adds and removes a city on a new outlet; the last one cannot be removed", async ({ page }) => {
      await signIn(page);
      const n = Date.now().toString(36).slice(-5);
      const r = await page.request.post("/api/tenants", {
        data: { nome: `Cobertura E2E ${n}`, modo: "local", uf: "SP", municipioIbge: "3518701", municipioNome: "Guarujá" }, headers: { origin: "http://localhost:8787" },
      });
      const { slug } = await r.json();
      await page.goto(`/t/${slug}/veiculo?aba=fontes`);
      await part(page, /Cobertura(?! E2E)/);  // the outlet picker also starts with the word
      const cities = page.getByRole("list", { name: "Cidades cobertas" });
      await expect(cities.getByRole("button", { name: /Tirar/ })).toHaveCount(0);
      await page.getByLabel("Acrescentar uma cidade").fill("Bertioga");
      await page.getByRole("option", { name: /Bertioga/ }).click();
      await page.getByRole("button", { name: "Acrescentar cidade" }).click();
      await expect(cities.getByRole("listitem")).toHaveText([/Guarujá · SP/, /Bertioga · SP/]);
      await expect(page.getByRole("status").filter({ hasText: "Bertioga entrou na cobertura." })).toBeVisible();
      await expect(page.getByLabel("Acrescentar uma cidade")).toHaveValue("");
      await cities.getByRole("button", { name: "Tirar Guarujá" }).click();
      await expect(cities.getByRole("listitem")).toHaveText([/Bertioga · SP/]);
      await expect(cities.getByRole("button", { name: /Tirar/ })).toHaveCount(0);
    });
  });
}
