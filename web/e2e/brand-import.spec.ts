// Step 18: the new outlet's brand step, pasting the site, and copying a template between outlets. Browser Rendering does
// not run in the local Worker, so /marca/puxar's response is simulated on screen; the read itself (`READ_SITE`) runs
// here, in a real Chrome, on a sample site. Axe 0. Screenshots in design/telas/veiculo/.
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { READ_SITE, fromSiteColors, fromSitePair, type ReadingSite } from "../../src/lib/siteReader";

const PRINTS = "design/telas/veiculo";
const SCREENS = { celular: { width: 390, height: 844 }, computador: { width: 1440, height: 900 } } as const;
const DESIGN = { email: "design@redacao.dev", senha: "senha-forte-123", veiculo: "portal-litoral" };
const ORIGIN = { origin: "http://localhost:8787" };
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#e63946"/></svg>';
const SUGGESTION = { nome: "Gazeta da Orla", cores: { fundo: "#102a57", texto: "#fffcf6", acento: "#e63946" }, fontes: "jornal", logo: { tipo: "image/svg+xml", base64: Buffer.from(SVG).toString("base64") } };

const SITE = `<!DOCTYPE html><html><head><title>Gazeta da Orla | Notícias</title><meta name="theme-color" content="#102a57">
<style>body{font-family:Arial,sans-serif}h1{font-family:Georgia,serif}header{background:#102a57}a{color:#e63946}.botao{background:rgb(230,57,70)}</style></head>
<body><header><a href="/" class="logo"><img src="/logo.png" alt="Gazeta"></a></header><nav><a href="/a">Cidade</a></nav><button class="botao">Assine</button>
<section class="destaques"><img src="/psicologo.png" alt="O psicólogo em entrevista"></section>
<main><article><img class="logo-parceiro" src="/materia.jpg" alt="logo do parceiro"><h1>Ponte fecha</h1><a href="/b">Leia</a></article></main></body></html>`;

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

async function newOutlet(page: Page) {
  const name = `Puxar ${Date.now()}`;
  const r = await page.request.post("/api/tenants", { data: { nome: name, modo: "tematico" }, headers: ORIGIN });
  expect(r.ok()).toBe(true);
  return (await r.json()) as { id: string; slug: string };
}

test("reading the site in a real Chrome: name, header logo, color and font; the story's image is left out", async ({ page }) => {
  await page.route("https://gazeta.example/**", (r) => r.fulfill({ contentType: "text/html; charset=utf-8", body: SITE }));
  await page.goto("https://gazeta.example/");
  const l = (await page.evaluate(READ_SITE)) as ReadingSite;
  expect(l.nome).toBe("Gazeta da Orla");
  expect(l.logos).toEqual(["https://gazeta.example/logo.png"]);
  expect(fromSiteColors(l)).toEqual({ fundo: "#102a57", texto: "#fffcf6", acento: "#e63946" });
  expect(fromSitePair(l.fontes)).toBe("jornal");
});

for (const [view, viewport] of Object.entries(SCREENS)) {
  test.describe(view, () => {
    test.use({ viewport, deviceScaleFactor: view === "celular" ? 2 : 1 });
    test.afterEach(async ({ page }) => {
      await page.request.put("/api/me/idioma", { data: { idioma: "pt-BR" }, headers: ORIGIN }).catch(() => {});
    });

    test("pasting the site fills name, colors, logo and fonts; the person changes and saves; the brand stays as they left it", async ({ page }) => {
      await signIn(page);
      const v = await newOutlet(page);
      await page.route("**/marca/puxar", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(SUGGESTION) }));
      await page.goto(`/novo?marca=${v.slug}`);
      const field = page.getByLabel("Já tem site? Cole o endereço");
      await expect(page.getByLabel("Nome nos cards")).toHaveCount(0);
      await look(page, "novo-site-vazio");
      await field.fill("gazetadaorla.com.br");
      await page.getByRole("button", { name: "Preencher com o site" }).click();
      await expect(page.getByRole("status")).toContainText("Confira tudo abaixo");
      await expect(page.getByLabel("Nome nos cards")).toHaveValue("Gazeta da Orla");
      await expect(page.getByRole("radio", { name: /Source Serif/ })).toBeChecked();
      await look(page, "novo-site-preenchido");
      await page.getByLabel("Nome nos cards").fill("Gazeta");
      await page.getByRole("button", { name: "Salvar e ir para as Ideias" }).click();
      await expect(page).toHaveURL(new RegExp(`/t/${v.slug}$`));
      const { marca: brand } = await (await page.request.get(`/api/t/${v.id}/marca`)).json();
      expect(brand).toMatchObject({ nome: "Gazeta", fontes: "jornal", cores: { fundo: "#102a57", acento: "#e63946" } });
      expect(brand.logo).toBeTruthy();
    });

    test("without a logo, the screen says so; a site that is down shows the error and the fields stay manual", async ({ page }) => {
      await signIn(page);
      const v = await newOutlet(page);
      let turn = 0;
      await page.route("**/marca/puxar", (r) => (turn++ === 0
        ? r.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ erro: "Não deu para ler esse site agora. Preencha à mão ou tente de novo." }) })
        : r.fulfill({ contentType: "application/json", body: JSON.stringify({ ...SUGGESTION, logo: null }) })));
      await page.goto(`/novo?marca=${v.slug}`);
      await page.getByLabel("Já tem site? Cole o endereço").fill("gazeta.example");
      await page.getByRole("button", { name: "Preencher com o site" }).click();
      await expect(page.getByRole("alert")).toContainText("Não deu para ler esse site");
      await expect(page.getByLabel("Nome nos cards")).toHaveCount(0);
      await page.getByRole("button", { name: "Preencher com o site" }).click();
      await expect(page.getByRole("status")).toContainText("não achamos um PNG ou SVG");
    });

    test("copy a template from another outlet: the copy appears in the destination", async ({ page }) => {
      await signIn(page);
      const v = await newOutlet(page);
      const target = await newOutlet(page);
      const name = `Plantão ${Date.now()}`;
      const c = await page.request.post(`/api/t/${v.id}/estilos`, { data: { nome: name, valePara: {}, params: { composicao: "tarja", caixaTitulo: "alta", papelCores: "normal", sequencia: [] } }, headers: ORIGIN });
      expect(c.status()).toBe(201);
      await page.goto(`/t/${target.slug}/veiculo?aba=marca&secao=modelos`);
      const block = page.getByText("Copiar de outro veículo");
      await block.scrollIntoViewIfNeeded();
      await page.getByLabel("Veículo de origem").selectOption(v.id);
      await page.getByLabel("Modelo a copiar").selectOption({ label: name });
      await look(page, "copiar-modelo");
      await page.getByRole("button", { name: "Copiar este modelo" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Modelo copiado." })).toBeVisible();
      const { estilos: styles } = await (await page.request.get(`/api/t/${target.id}/estilos`)).json();
      expect(styles.map((e: { nome: string }) => e.nome)).toContain(name);
    });

    test("in English: fill in from the site", async ({ page }) => {
      await signIn(page);
      const v = await newOutlet(page);
      await page.request.put("/api/me/idioma", { data: { idioma: "en" }, headers: ORIGIN });
      await page.route("**/marca/puxar", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(SUGGESTION) }));
      await page.goto(`/novo?marca=${v.slug}`);
      await page.getByLabel("Already have a site? Paste the address").fill("shorelinegazette.com");
      await page.getByRole("button", { name: "Fill in from the site" }).click();
      await expect(page.getByRole("status")).toContainText("Check everything below");
      await expect(page.getByLabel("Name on the cards")).toHaveValue("Gazeta da Orla");
      await look(page, "novo-site-en");
    });
  });
}
