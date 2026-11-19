// Phase 5: recording in the app with Chromium's fake microphone. The network drops through `page.route`, the warning
// appears, the stored slice uploads when the network comes back, and finishing sends to the fake Whisper. Axe 0.
// Screenshots in design/telas/gravador/.
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { part } from "./parts";
import { goDownModel, uploadModel } from "./fake-model";

const PRINTS = "design/telas/gravador";
const SCREENS = { celular: { width: 390, height: 844 }, computador: { width: 1440, height: 900 } } as const;
const OUTLET = "cartas-da-orla";
const DESIGN = { email: "design@redacao.dev", senha: "senha-forte-123" };
const ORIGIN = { origin: "http://localhost:8787" };

test.use({ launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } });
test.beforeAll(uploadModel);
test.afterAll(goDownModel);

async function look(page: Page, label: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path: `${PRINTS}/${label}-${page.viewportSize()!.width}.png`, fullPage: true });
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).setLegacyMode(true).options({ iframes: false }).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), label).toEqual([]);
}

async function launch(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(DESIGN.email);
  await page.getByLabel("Senha").fill(DESIGN.senha);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/t\//);
  const res = await page.request.post(`/api/t/${OUTLET}/textos`, { data: { titulo: "Entrevista gravada", texto: "Entrevista gravada\nO vereador falou." }, headers: ORIGIN });
  return ((await res.json()) as { texto: { id: string } }).texto.id;
}

for (const [view, viewport] of Object.entries(SCREENS)) {
  test.describe(view, () => {
    test.use({ viewport, deviceScaleFactor: view === "celular" ? 2 : 1 });
    test.setTimeout(120_000);
    test.afterEach(async ({ page }) => {
      await page.request.put("/api/me/idioma", { data: { idioma: "pt-BR" }, headers: ORIGIN }).catch(() => {});
    });

    test("record: time, level and Saved up to; the network drops, the warning appears; the network returns, the slice goes up; finish transcribes", async ({ page }) => {
      const id = await launch(page);
      await page.goto(`/t/${OUTLET}/textos/${id}?aba=dossie`);
      await part(page, "Gravações");
      const rec = page.getByRole("region", { name: "Gravações" });
      await expect(rec.getByText("a tela apagada pode cortar a gravação")).toBeVisible();
      await look(page, "antes");
      await rec.getByRole("button", { name: "Gravar" }).click();
      await expect(rec.getByRole("status").filter({ hasText: "Salvo até 00:05" })).toBeVisible({ timeout: 15_000 });
      await expect.poll(() => rec.getByRole("meter", { name: "Nível do microfone" }).getAttribute("aria-valuenow").then(Number)).toBeGreaterThan(0);

      // The network drops: no slice is confirmed, and "Saved up to" does not move.
      let block = true;
      const received: string[] = [];
      await page.route("**/gravacoes/sessao/*/*/*", (route) => {
        if (block) return route.abort();
        received.push(route.request().url().split("/").slice(-2).join("/"));
        return route.continue();
      });
      await expect(rec.getByRole("alert").filter({ hasText: "Sem confirmação do servidor há 15 s" })).toBeVisible({ timeout: 40_000 });
      const saved = await rec.getByRole("status").filter({ hasText: "Salvo até" }).textContent();
      await look(page, "sem-rede");
      await expect(rec.getByRole("status").filter({ hasText: "Salvo até" })).toHaveText(saved!);

      block = false;
      await expect(rec.getByRole("alert").filter({ hasText: "Sem confirmação do servidor" })).toHaveCount(0, { timeout: 15_000 });
      await expect(rec.getByRole("status").filter({ hasText: "Salvo até" })).not.toHaveText(saved!);
      expect(received.length).toBeGreaterThan(1);
      await look(page, "gravando");

      await rec.getByRole("button", { name: "Parar e concluir" }).click();
      await expect(rec.getByText(/de áudio · transcrito/)).toBeVisible({ timeout: 30_000 });
      await look(page, "concluido");
      await page.unrouteAll({ behavior: "ignoreErrors" });
    });

    test("the segment turn: each one starts at slice 0, with its own header", async ({ page }) => {
      const id = await launch(page);
      // The server sends 2 s per segment and 1 s per slice, only in this test, so the handover fits in it.
      await page.route(`**/textos/${id}/gravacoes/sessao`, async (route) => {
        const r = await route.fetch();
        await route.fulfill({ response: r, json: { ...(await r.json()), segundos: 2, fatia: 1 } });
      });
      const slices: string[] = [];
      page.on("request", (r) => { if (r.method() === "PUT" && r.url().includes("/gravacoes/sessao/")) slices.push(r.url().split("/").slice(-2).join("/")); });
      await page.goto(`/t/${OUTLET}/textos/${id}?aba=dossie`);
      await part(page, "Gravações");
      const rec = page.getByRole("region", { name: "Gravações" });
      await rec.getByRole("button", { name: "Gravar" }).click();
      await expect.poll(() => slices.includes("1/0") && slices.includes("2/0"), { timeout: 20_000 }).toBe(true);
      await rec.getByRole("button", { name: "Parar e concluir" }).click();
      await expect(rec.getByText(/de áudio · transcrito/)).toBeVisible({ timeout: 30_000 });
      const list = await (await page.request.get(`/api/t/${OUTLET}/textos/${id}`)).json();
      expect(list.gravacoes[0].segmentos.total).toBeGreaterThanOrEqual(3);
    });

    test("closing the tab loses nothing: on return, the screen offers finish", async ({ page }) => {
      const id = await launch(page);
      await page.goto(`/t/${OUTLET}/textos/${id}?aba=dossie`);
      await part(page, "Gravações");
      const rec = page.getByRole("region", { name: "Gravações" });
      await rec.getByRole("button", { name: "Gravar" }).click();
      await expect(rec.getByRole("status").filter({ hasText: "Salvo até 00:05" })).toBeVisible({ timeout: 15_000 });
      await page.reload();
      // A recording not finished is a warning: the part moves ahead and opens by itself.
      const back = page.getByRole("region", { name: "Gravações" });
      await expect(page.getByRole("button", { name: /^Gravações/ }).first()).toHaveAttribute("aria-expanded", "true");
      await expect(back.getByText("ficou sem concluir")).toBeVisible();
      await look(page, "voltar");
      await back.getByRole("button", { name: "Concluir" }).click();
      await expect(back.getByText(/de áudio · transcrito/)).toBeVisible({ timeout: 30_000 });
      await expect(back.getByText("ficou sem concluir")).toHaveCount(0);
    });

    test("in English: recording, saved up to and finish", async ({ page }) => {
      const id = await launch(page);
      await page.request.put("/api/me/idioma", { data: { idioma: "en" }, headers: ORIGIN });
      await page.goto(`/t/${OUTLET}/textos/${id}?aba=dossie`);
      await part(page, "Recordings");
      const rec = page.getByRole("region", { name: "Recordings" });
      await expect(rec.getByText("a dark screen can cut the recording")).toBeVisible();
      await rec.getByRole("button", { name: "Record", exact: true }).click();
      await expect(rec.getByRole("status").filter({ hasText: "Saved up to 00:05" })).toBeVisible({ timeout: 15_000 });
      await rec.getByRole("button", { name: "Stop and finish" }).click();
      await expect(rec.getByText(/of audio · transcribed/)).toBeVisible({ timeout: 30_000 });
    });
  });
}
