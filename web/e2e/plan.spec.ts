// Phase 10: the Plan tab, for real against the local D1 and the fake Stripe of web/e2e/fake-model.ts: usage, the 80 %
// warning, subscribing, a signed webhook changing the plan, and "Produce" at the limit, for admins and non-admins. Limit
// and webhook rules are in test/plans.test.ts. Axe 0. Screenshots in design/telas/plano/.
import { createHmac } from "node:crypto";
import { spawnSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { goDownModel, uploadModel } from "./fake-model";

const PRINTS = "design/telas/plano";
const SCREENS = { celular: { width: 390, height: 844 }, computador: { width: 1440, height: 900 } } as const;
const DESIGN = { email: "design@redacao.dev", senha: "senha-forte-123", veiculo: "portal-litoral" };
const ORIGIN = { origin: "http://localhost:8787" };
const SECRET = "segredo-falso-do-e2e";   // dev:e2e's --var
const month = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);

function sql(command: string) {
  const r = spawnSync(`npx wrangler d1 execute redacao-db --local --command "${command.replace(/"/g, '\\"')}"`, { shell: true, stdio: "ignore" });
  expect(r.status, command).toBe(0);
}

test.beforeAll(async () => { await uploadModel(); });
test.afterAll(async () => { await goDownModel(); });

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
  const r = await page.request.post("/api/tenants", { data: { nome: `Plano ${Date.now()}`, modo: "tematico" }, headers: ORIGIN });
  expect(r.ok()).toBe(true);
  return (await r.json()) as { id: string; slug: string };
}

async function webhook(page: Page, type: string, object: unknown) {
  const body = JSON.stringify({ id: `evt_${Date.now()}_${Math.random()}`, type, data: { object } });
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", SECRET).update(`${t}.${body}`).digest("hex");
  const r = await page.request.post("/stripe/webhook", { data: body, headers: { "content-type": "application/json", "stripe-signature": `t=${t},v1=${v1}` } });
  expect(r.status()).toBe(200);
}

for (const [view, viewport] of Object.entries(SCREENS)) {
  test.describe(view, () => {
    test.use({ viewport, deviceScaleFactor: view === "celular" ? 2 : 1 });
    test.afterEach(async ({ page }) => {
      await page.request.put("/api/me/idioma", { data: { idioma: "pt-BR" }, headers: ORIGIN }).catch(() => {});
    });

    test("no plan: subscribing leads to Stripe; the webhook changes the plan; managing opens the portal", async ({ page }) => {
      await signIn(page);
      const v = await newOutlet(page);
      await page.goto(`/t/${v.slug}/veiculo?aba=plano`);
      await expect(page.getByRole("heading", { name: "Sem plano", exact: true })).toBeVisible();
      await expect(page.getByText("Assine um plano para produzir posts e conferir textos.")).toBeVisible();
      await expect(page.getByRole("status").filter({ hasText: "Este veículo ainda não tem plano." })).toBeVisible();
      await look(page, "sem-plano");

      sql(`INSERT INTO uso (tenant_id, mes, posts) VALUES ('${v.id}', '${month}', 8);`);
      await page.getByRole("button", { name: "Assinar Página" }).click();
      await expect(page.getByRole("heading", { name: "Stripe falsa" })).toBeVisible();

      await webhook(page, "checkout.session.completed", { client_reference_id: v.id, subscription: `sub_${v.id}`, customer: "cus_falso" });
      await page.goto(`/t/${v.slug}/veiculo?aba=plano`);
      await expect(page.getByRole("heading", { name: "Plano Página" })).toBeVisible();
      await expect(page.getByText(/^8 de 60 posts em /)).toBeVisible();
      await expect(page.getByText("seu plano", { exact: true })).toBeVisible();
      await expect(page.getByText(/Próxima cobrança em /)).toBeVisible();
      await expect(page.getByText("Este veículo ainda não tem plano.")).toHaveCount(0);
      await look(page, "assinante");

      sql(`UPDATE uso SET posts = 50 WHERE tenant_id = '${v.id}';`);
      await page.reload();
      await expect(page.getByText("Faltam 10 posts.")).toBeVisible();
      await look(page, "aviso");

      await webhook(page, "invoice.payment_failed", { subscription: `sub_${v.id}` });
      await page.reload();
      await expect(page.getByText("A última cobrança falhou.", { exact: false })).toBeVisible();
      await look(page, "atraso");

      await page.getByRole("button", { name: "Gerenciar assinatura" }).click();
      await expect(page.getByRole("heading", { name: "Stripe falsa" })).toBeVisible();
    });

    test("no plan: Produce explains and leads to the plan; the idea stays in the list; at the plan limit, the tab shows the band", async ({ page }) => {
      await signIn(page);
      const v = await newOutlet(page);
      const id = crypto.randomUUID();
      sql(`INSERT INTO pautas (id, tenant_id, status, origem, titulo, fato_ids_json, documento_ids_json, score) VALUES ('${id}', '${v.id}', 'sugerida', 'manual', 'Ponte fecha para obras', '[]', '[]', 90);`);
      await page.goto(`/t/${v.slug}`);
      await page.getByRole("button", { name: "Produzir", exact: true }).first().click();
      const warning = page.getByRole("alert").filter({ hasText: "Este veículo ainda não tem plano." });
      await expect(warning).toBeVisible();
      // round 4: on desktop the headline appears on the row and on the lead sheet; the row is what proves the idea stayed.
      await expect(page.getByRole("listitem").filter({ hasText: "Ponte fecha para obras" })).toBeVisible();
      await look(page, "limite-ideias");
      await warning.getByRole("link", { name: "Ver o plano" }).click();
      await expect(page).toHaveURL(new RegExp(`/t/${v.slug}/veiculo\\?aba=plano$`));
      sql(`UPDATE tenants SET plano = 'pagina' WHERE id = '${v.id}'; INSERT INTO uso (tenant_id, mes, posts) VALUES ('${v.id}', '${month}', 60);`);
      await page.reload();
      await expect(page.getByText(/O limite chegou/)).toBeVisible();
      await look(page, "limite-plano");
    });

    test("non-admins read 'Peça ao admin'", async ({ page }) => {
      await signIn(page);
      const outlet = { id: "x", slug: DESIGN.veiculo };
      await page.route("**/api/me", async (r) => {
        const answer = await r.fetch();
        const me = await answer.json();
        me.tenants = me.tenants.map((t: { slug: string; papel: string }) => (t.slug === outlet.slug ? { ...t, papel: "editor" } : t));
        await r.fulfill({ response: answer, json: me });
      });
      await page.route("**/pautas/*/produzir", (r) => r.fulfill({ status: 402, contentType: "application/json", body: JSON.stringify({ code: "limite_plano", erro: "Este veículo já usou os 60 posts do mês." }) }));
      await page.goto(`/t/${DESIGN.veiculo}`);
      await page.getByRole("button", { name: "Produzir", exact: true }).first().click();
      const warning = page.getByRole("alert").filter({ hasText: "Este veículo já usou" });
      await expect(warning).toContainText("Peça ao admin do veículo.");
      await expect(warning.getByRole("link")).toHaveCount(0);
    });

    test("in English: the plan tab", async ({ page }) => {
      await signIn(page);
      const v = await newOutlet(page);
      await page.request.put("/api/me/idioma", { data: { idioma: "en" }, headers: ORIGIN });
      await page.goto(`/t/${v.slug}/veiculo?aba=plano`);
      await expect(page.getByRole("heading", { name: "No plan", exact: true })).toBeVisible();
      await expect(page.getByText("Subscribe to a plan to produce posts and check texts.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Subscribe to Page" })).toBeVisible();
      await look(page, "en");
    });
  });
}
