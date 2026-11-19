// Phase 7: the "If the account goes down" tab, for real against the local D1, and the certificate button in Posted
// with the list simulated. Manifest and timestamp are in test/certificate.test.ts. Axe 0. Screenshots in design/telas/kit/.
import { partLine } from "./parts";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { strToU8, zipSync } from "fflate";

const PRINTS = "design/telas/kit";
const SCREENS = { celular: { width: 390, height: 844 }, computador: { width: 1440, height: 900 } } as const;
const DESIGN = { email: "design@redacao.dev", senha: "senha-forte-123", veiculo: "portal-litoral" };
const ORIGIN = { origin: "http://localhost:8787" };

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

async function clean(page: Page) {
  const kit = await (await page.request.get(`/api/t/${DESIGN.veiculo}/kit`)).json();
  for (const c of kit.casos) await page.request.delete(`/api/t/${DESIGN.veiculo}/kit/casos/${c.id}`, { headers: ORIGIN });
}

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
const ZIP_JSON = zipSync({
  "instagram-gazeta/media/posts/202401/a.jpg": new Uint8Array(PNG),
  "instagram-gazeta/your_activity/posts_1.json": strToU8(JSON.stringify([{ media: [{ uri: "media/posts/202401/a.jpg", creation_timestamp: 1_704_067_200 }], title: "Foto: Agência X" }])),
});
const ZIP_HTML = zipSync({ "index.html": strToU8("<html></html>") });

async function deleteRayX(page: Page) {
  const r = await (await page.request.get(`/api/t/${DESIGN.veiculo}/raiox`)).json();
  if (r.lote) await page.request.delete(`/api/t/${DESIGN.veiculo}/raiox/${r.lote.id}`, { headers: ORIGIN });
}

/** Opens the part, whether an accordion row or a master-detail list item. */
const part = async (page: Page, name: string) => {
  const b = page.getByRole("button", { name: new RegExp(`^${name}`) }).first();
  if ((await b.getAttribute("aria-expanded")) !== "true") await b.click();
  await expect(b).toHaveAttribute("aria-expanded", "true");
};

const base = { id: "x", peca_id: "x", url: "https://instagram.com/p/x", modo: "manual", publicado_em: "2026-11-05T12:00:00Z", created_at: "2026-11-05T12:00:00Z", formato: "carrossel", titulo: "Ponte fecha", tipo_post: null, conta_nome: "Conta", conta_external_id: null, manchete: "Ponte fecha por 15 dias", ncards: 4, capa: null, piloto: 0 };

for (const [view, viewport] of Object.entries(SCREENS)) {
  test.describe(view, () => {
    test.use({ viewport, deviceScaleFactor: view === "celular" ? 2 : 1 });
    test.afterEach(async ({ page }) => {
      await clean(page).catch(() => {});
      await deleteRayX(page).catch(() => {});
      await page.request.patch(`/api/t/${DESIGN.veiculo}/pagina-publica`, { data: { ligada: false }, headers: ORIGIN }).catch(() => {});
      await page.request.put("/api/me/idioma", { data: { idioma: "pt-BR" }, headers: ORIGIN }).catch(() => {});
    });

    test("logging the case counts the days, the templates copy, and closing makes the case disappear", async ({ page }) => {
      await signIn(page);
      await clean(page);
      await page.goto(`/t/${DESIGN.veiculo}/veiculo?aba=kit`);
      // Without a case, reporting opens by itself, and the rest stays summarised.
      await expect(page.getByRole("button", { name: /^Registrar o caso/ }).first()).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByRole("button", { name: /^Modelos para copiar/ })).toContainText("modelos");
      await look(page, "vazio");
      await part(page, "O que fazer agora");
      await expect(page.getByRole("heading", { name: "O que fazer agora" })).toBeVisible();
      await expect(page).toHaveURL(/[?&]parte=agora/);
      await page.reload();
      await expect(page.getByRole("heading", { name: "O que fazer agora" })).toBeVisible();
      await part(page, "Registrar o caso");
      await page.getByLabel("O que aconteceu").selectOption("direito_autoral");
      const fromHere = new Date(Date.now() + 10 * 86_400_000).toLocaleDateString("en-CA");
      await page.getByLabel("Prazo do aviso").fill(fromHere);
      await page.getByLabel("Nota").fill("Aviso de 01/11");
      await page.getByRole("button", { name: "Registrar o caso", exact: true }).last().click();
      const cases = page.getByRole("list", { name: "Casos abertos" });
      await expect(cases).toContainText("Denúncia de direito autoral");
      await expect(cases).toContainText(/faltam (9|10|11) dias para o prazo/);
      await expect(cases).toContainText("Próximo passo:");
      await page.goto(`/t/${DESIGN.veiculo}/veiculo?aba=kit`);
      // With an open case, the deadline and the next step come first, and the templates open by themselves with only the name and Copy.
      await expect(cases).toContainText(/faltam (9|10|11) dias para o prazo/);
      await expect(page.getByRole("button", { name: /^Modelos para copiar/ }).first()).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByRole("textbox", { name: "Pedido de revisão à Meta" })).toBeHidden();
      await look(page, "caso");
      await cases.getByRole("button", { name: "Abrir o pedido" }).click();
      await expect(page).toHaveURL(/[?&]texto=revisao/);
      await expect(page.getByRole("textbox", { name: "Pedido de revisão à Meta" })).toBeVisible();
      await look(page, "caso-modelo");
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
      await page.getByRole("button", { name: /Copiar Pedido de revisão à Meta/ }).click();
      await expect(page.getByText("Copiado.").or(page.getByText("O navegador não deixou copiar"))).toBeVisible();
      await cases.getByRole("button", { name: /Encerrar/ }).click();
      await expect(cases).toHaveCount(0);
    });

    test("Posted: ready certificate downloads; without it, generate, with the failure in view", async ({ page }) => {
      await signIn(page);
      const list = await (await page.request.get(`/api/t/${DESIGN.veiculo}/publicacoes`)).json();
      await page.route("**/api/t/*/publicacoes*", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...list, publicacoes: [{ ...base, id: "a", peca_id: "aa", certidao: "abc", certidao_erro: null }, { ...base, id: "b", peca_id: "bb", certidao: null, certidao_erro: "falhou" }] }) }));
      await page.goto(`/t/${DESIGN.veiculo}/postados`);
      await expect(page.getByRole("link", { name: "Certidão" })).toHaveAttribute("href", `/api/t/${DESIGN.veiculo}/pecas/aa/certidao`);
      await expect(page.getByRole("button", { name: "Gerar certidão" })).toBeVisible();
      await expect(page.getByText("A certidão falhou na publicação. Gere de novo.")).toBeVisible();
      await look(page, "postados");
    });

    test("X-ray: zip with HTML is refused; zip with JSON uploads the thumbnail; the list shows the reason; delete clears it", async ({ page }) => {
      await signIn(page);
      await deleteRayX(page);
      await page.goto(`/t/${DESIGN.veiculo}/veiculo?aba=kit`);
      await part(page, "Raio-X dos posts antigos");
      const field = page.getByLabel("Escolher o arquivo .zip");
      await field.setInputFiles({ name: "html.zip", mimeType: "application/zip", buffer: Buffer.from(ZIP_HTML) });
      await expect(page.getByRole("alert")).toContainText("no formato JSON");
      const upload = page.waitForRequest((r) => /\/raiox\/[^/]+\/itens$/.test(r.url()));
      await field.setInputFiles({ name: "instagram.zip", mimeType: "application/zip", buffer: Buffer.from(ZIP_JSON) });
      const request = await upload;
      expect(request.headers()["content-type"]).toContain("multipart/form-data");
      await expect(page.getByRole("status").filter({ hasText: /^1 posts · / })).toBeVisible();
      // The vision model does not run in the local Worker: the read is simulated, and its rule is in test/xray.test.ts.
      await page.route("**/api/t/*/raiox", async (route) => {
        if (route.request().method() !== "GET") return route.continue();
        const r = await (await route.fetch()).json();
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ lote: { ...r.lote, marcados: 1, ilegiveis: 1, pendentes: 0 }, itens: [
          { id: "1", data: "2024-01-01T00:00:00.000Z", legenda: "Foto: Agência X", estado: "marcado", motivos: ["marca_dagua", "legenda:Foto: Agência X"], miniatura: `data:image/png;base64,${PNG.toString("base64")}` },
          { id: "2", data: "2023-12-01T00:00:00.000Z", legenda: "", estado: "ilegivel", motivos: [], miniatura: `data:image/png;base64,${PNG.toString("base64")}` },
        ], proxima: null }) });
      });
      await page.goto(`/t/${DESIGN.veiculo}/veiculo?aba=kit`);
      // A post with a mark is a warning: the part moves ahead and opens by itself.
      await expect(page.getByRole("button", { name: /^Raio-X dos posts antigos/ }).first()).toHaveAttribute("aria-expanded", "true");
      const list = page.getByRole("list", { name: "Posts com marca" });
      await expect(list).toContainText("marca d'água");
      await expect(list).toContainText('na legenda: "Foto: Agência X"');
      await expect(list).toContainText("Não deu para ler");
      await expect(page.getByRole("button", { name: /apagar o post/i })).toHaveCount(0);
      await look(page, "raiox");
      await page.getByRole("button", { name: "Apagar este raio-X" }).click();
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await page.reload();
      await part(page, "Raio-X dos posts antigos");
      await expect(page.getByLabel("Escolher o arquivo .zip")).toBeAttached();
    });

    test("the public page links to the kit and opens without a session; Send to the Channel appears in Publish", async ({ page, browser }) => {
      await signIn(page);
      await page.goto(`/t/${DESIGN.veiculo}/veiculo?aba=kit`);
      await part(page, "Reserva");
      await page.getByRole("checkbox", { name: /Página pública do veículo/ }).click();
      const link = page.getByRole("link", { name: /\/v\/portal-litoral/ });
      await expect(link).toBeVisible();
      const anon = await browser.newContext();
      const outside = await anon.newPage();
      await outside.goto(`http://localhost:8787/v/${DESIGN.veiculo}`);
      await expect(outside.getByRole("heading", { level: 1 })).toBeVisible();
      await outside.screenshot({ path: `${PRINTS}/pagina-publica-${page.viewportSize()!.width}.png`, fullPage: true });
      await page.getByRole("checkbox", { name: /Página pública do veículo/ }).click();
      await expect(link).toHaveCount(0);
      expect((await outside.goto(`http://localhost:8787/v/${DESIGN.veiculo}`))?.status()).toBe(404);
      await anon.close();

      const list = await (await page.request.get(`/api/t/${DESIGN.veiculo}/pecas?status=aprovada,agendada`)).json();
      const ready = (list.pecas as { id: string; status: string }[]).find((p) => p.status === "aprovada" || p.status === "agendada");
      expect(ready, "D1 local precisa de um post pronto para postar").toBeTruthy();
      await page.goto(`/t/${DESIGN.veiculo}/p/${ready!.id}`);
      await expect(page.getByRole("button", { name: "Mandar para o Canal" })).toBeVisible();
      await look(page, "canal");
    });

    test("X-ray that did not load: the part opens with the failure, with no loading loop", async ({ page }) => {
      await signIn(page);
      let requests = 0;
      await page.route("**/api/t/*/raiox", (route) => {
        if (route.request().method() !== "GET") return route.fallback();
        requests += 1;
        return route.fulfill({ status: 500, contentType: "application/json", body: '{"erro":"x"}' });
      });
      await page.goto(`/t/${DESIGN.veiculo}/veiculo?aba=kit`);
      await expect(page.getByText("Não carregou o raio-X.")).toBeVisible({ timeout: 15_000 });
      await expect(partLine(page, "Raio-X dos posts antigos")).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByText("ainda não feito")).toHaveCount(0);
      await page.waitForTimeout(2500);
      expect(requests).toBeLessThan(6);
    });

    test("in English: the tab, a case and the templates", async ({ page }) => {
      await signIn(page);
      await page.request.put("/api/me/idioma", { data: { idioma: "en" }, headers: ORIGIN });
      await page.goto(`/t/${DESIGN.veiculo}/veiculo?aba=kit`);
      await part(page, "What to do now");
      await expect(page.getByRole("heading", { name: "What to do now" })).toBeVisible();
      await part(page, "Templates to copy");
      await expect(page.getByRole("heading", { name: "Templates to copy" })).toBeVisible();
      await part(page, "Review of old posts");
      await expect(page.getByRole("heading", { name: "Review of old posts" })).toBeVisible();
      await part(page, "Reserve");
      await expect(page.getByRole("heading", { name: "Reserve" })).toBeVisible();
      await part(page, "Register the case");
      await page.getByRole("button", { name: "Register the case", exact: true }).last().click();
      await expect(page.getByRole("list", { name: "Open cases" })).toContainText("no deadline in the notice");
      await look(page, "en");
    });
  });
}
