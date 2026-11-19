// Phase 3: the autopilot section on the Sources tab, for real against the local D1, and the label in Posted with the
// list simulated. The rule for when the autopilot approves is in test/autopilot.test.ts. Axe 0. Screenshots in design/telas/piloto/.
import { part } from "./parts";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PRINTS = "design/telas/piloto";
const SCREENS = { celular: { width: 390, height: 844 }, computador: { width: 1440, height: 900 } } as const;
const DESIGN = { email: "design@redacao.dev", senha: "senha-forte-123", veiculo: "portal-litoral" };
const ORIGIN = { origin: "http://localhost:8787" };
const TITLE = "Piloto automático";

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

const accounts = async (page: Page) => (await (await page.request.get(`/api/t/${DESIGN.veiculo}/contas?todas=1`)).json()).contas as { id: string; modo: string; status: string }[];
const activate = (page: Page, id: string, active: boolean) => page.request.patch(`/api/t/${DESIGN.veiculo}/contas/${id}`, { data: { ativo: active }, headers: ORIGIN });

/** Turns off the accounts of a type and returns how they were. The manual account comes before the simulated one in the default account's order. */
async function turnOff(page: Page, which: (mode: string) => boolean) {
  const list = (await accounts(page)).filter((c) => which(c.modo) && c.status === "ativa");
  for (const c of list) await activate(page, c.id, false);
  return async () => { for (const c of list) await activate(page, c.id, true); };
}

async function withAccountSimulated(page: Page) {
  const r = await page.request.post(`/api/t/${DESIGN.veiculo}/contas`, { data: { rede: "instagram", modo: "simulada", nome: "Teste do piloto" }, headers: ORIGIN });
  expect(r.ok(), await r.text()).toBe(true);
  return ((await r.json()) as { id: string }).id;
}

for (const [view, viewport] of Object.entries(SCREENS)) {
  test.describe(view, () => {
    test.use({ viewport, deviceScaleFactor: view === "celular" ? 2 : 1 });
    test.afterEach(async ({ page }) => {
      await page.request.patch(`/api/t/${DESIGN.veiculo}/piloto`, { data: { ligado: false }, headers: ORIGIN }).catch(() => {});
      await page.request.put("/api/me/idioma", { data: { idioma: "pt-BR" }, headers: ORIGIN }).catch(() => {});
    });

    test("without an account that posts on its own, the control stays still; with one, it turns on and off", async ({ page }) => {
      await signIn(page);
      const back = await turnOff(page, (m) => m !== "manual");
      let manualBack = async () => {};
      let created: string | null = null;
      try {
        await page.goto(`/t/${DESIGN.veiculo}/veiculo?aba=fontes`);
        await expect(page.getByRole("button", { name: new RegExp(`^${TITLE}`) })).toContainText("falta conta que posta sozinha");
        await part(page, TITLE);
        await expect(page.getByRole("heading", { name: TITLE })).toBeVisible();
        const box = page.getByRole("checkbox", { name: /site do veículo/ }).last();
        await expect(page.getByText("Exige a conexão direta com o Instagram")).toBeVisible();
        await expect(box).toBeDisabled();
        await look(page, "sem-conta");

        manualBack = await turnOff(page, (m) => m === "manual");
        created = await withAccountSimulated(page);
        await page.reload();
        const enable = page.getByRole("checkbox", { name: /Aprovar sozinho/ });
        await expect(enable).toBeEnabled();
        await expect(page.getByText("O risco: um post sai sem ninguém ler")).toBeVisible();
        await expect(page.getByText(/Publicidade, correção, resumo e Reels nunca passam pelo piloto/)).toBeVisible();
        await enable.click();
        await expect(enable).toBeChecked();
        await look(page, "ligado");
        // On is a risk in progress: outside the part, the warning stays in view on the row, and the part opens by itself on arrival.
        await page.goto(`/t/${DESIGN.veiculo}/veiculo?aba=fontes&parte=adicionar`);
        const line = page.getByRole("button", { name: new RegExp(`^${TITLE}`) });
        await expect(line).toContainText("sem ninguém ler");
        await expect(line.locator(".text-ambar").or(line.getByText("sem ninguém ler"))).toHaveClass(/text-ambar/);
        await part(page, TITLE);
        await expect(page.getByRole("checkbox", { name: /Aprovar sozinho/ })).toBeChecked();
        await page.getByRole("checkbox", { name: /Aprovar sozinho/ }).click();
        await expect(page.getByRole("checkbox", { name: /Aprovar sozinho/ })).not.toBeChecked();
      } finally {
        if (created) await activate(page, created, false);
        await manualBack();
        await back();
      }
    });

    test("Posted shows what the autopilot approved", async ({ page }) => {
      await signIn(page);
      const list = await (await page.request.get(`/api/t/${DESIGN.veiculo}/publicacoes`)).json();
      const base = list.publicacoes[0] ?? { id: "x", peca_id: "x", url: null, modo: "real", publicado_em: "2026-11-05T12:00:00Z", created_at: "2026-11-05T12:00:00Z", formato: "carrossel", titulo: "Ponte fecha", tipo_post: null, conta_nome: "Conta", conta_external_id: null, manchete: "Ponte fecha", ncards: 4, capa: null };
      await page.route("**/api/t/*/publicacoes*", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...list, publicacoes: [{ ...base, piloto: 1 }] }) }));
      await page.goto(`/t/${DESIGN.veiculo}/postados`);
      await expect(page.getByText("Aprovado pelo piloto")).toBeVisible();
      await look(page, "postados");
    });

    test("in English: the section reads in English", async ({ page }) => {
      await signIn(page);
      await page.request.put("/api/me/idioma", { data: { idioma: "en" }, headers: ORIGIN });
      await page.goto(`/t/${DESIGN.veiculo}/veiculo?aba=fontes`);
      await part(page, "Autopilot");
      await expect(page.getByRole("heading", { name: "Autopilot" })).toBeVisible();
      await expect(page.getByText(/Advertising, corrections, roundups and Reels never go through autopilot/)).toBeVisible();
      await look(page, "en");
    });
  });
}
