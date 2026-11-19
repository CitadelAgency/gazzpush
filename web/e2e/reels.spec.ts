// Phase 4: Reels as an animated 9:16 carousel. Against `wrangler dev` with the seeded local D1 (README, Local testing).
// The carousel is real (in review); the music library, the Reels request, production and the package are simulated on
// the browser's route, because the Container does not run in Windows `wrangler dev` (the real path is covered in
// test/reels.test.ts and measured in docs/SPIKE-reels-2026-11.md). Axe 0. Screenshots in design/telas/reels/.
import { partLine, part } from "./parts";
import { expect, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PRINTS = "design/telas/reels";
const SCREENS = { celular: { width: 390, height: 844 }, computador: { width: 1440, height: 900 } } as const;
const DESIGN = { email: "design@redacao.dev", senha: "senha-forte-123", veiculo: "portal-litoral" };
const VIDEO = "/media/reels/e2e/reels.mp4";
const BAND = { id: "manha-calma", titulo: "Manhã calma", autor: "Autora Fictícia", licenca: "Licença de teste", licencaUrl: "https://licenca.example/manha-calma" };

const lookVoice = (page: Page, name: string) => look(page, name, "design/telas/reels-voz");

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

async function signIn(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(DESIGN.email);
  await page.getByLabel("Senha").fill(DESIGN.senha);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  // Sign-in lands on the first outlet by name, which depends on what other specs created: open this one.
  await expect(page).toHaveURL(/\/t\/[^/]+$/);
  await page.goto(`/t/${DESIGN.veiculo}`);
}

/** The text animation of an upright preview card (the iframe may still be loading: wait). */
const animationPreview = (page: Page, card = 1) => expect.poll(async () => {
  const frame = page.frames().filter((f) => f !== page.mainFrame() && f.url() === "about:srcdoc")[card];
  return frame ? frame.evaluate(() => document.querySelector("h1") ? getComputedStyle(document.querySelector("h1")!).animationName : null).catch(() => null) : null;
});

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/** A real carousel in review; the Reels that comes out of it is simulated (request, production, review, approval and package). */
async function scenario(page: Page) {
  const list = await (await page.request.get(`/api/t/${DESIGN.veiculo}/pecas`)).json();
  const origin = (list.pecas as { id: string; status: string; formato: string }[]).find((p) => p.status === "revisao" && p.formato === "carrossel");
  expect(origin, "D1 local precisa de um carrossel em revisão (README, Teste local)").toBeTruthy();
  const id = origin!.id;
  const real = await (await page.request.get(`/api/t/${DESIGN.veiculo}/pecas/${id}`)).json();
  const status = await (await page.request.get(`/api/t/${DESIGN.veiculo}/pecas/${id}/status`)).json();
  const reels = "e2e-reels-0001";
  const yes = { pedido: null as unknown, status: "rascunho", consultas: 0, decisao: null as unknown };

  await page.route(`**/api/t/*/musicas`, (route) => json(route, { musicas: [BAND] }));
  // The voice: the transcript and Whisper are simulated; the real comparison is in test/narration.test.ts.
  const voice = { narracao: null as null | { id: string; estado: string; erro: null; duracao: number; avisos: { tipo: string; motivo: string; esperado: string; inicio: number; decisao: string | null }[] }, consultas: 0 };
  await page.route(`**/api/t/*/pecas/${id}/narracao`, async (route) => {
    if (route.request().method() === "POST") {
      voice.narracao = { id: "voz-1", estado: "lendo", erro: null, duracao: 21, avisos: [{ tipo: "numero", motivo: "trocado", esperado: "20", inicio: 4.2, decisao: null }] };
      return json(route, { id: "voz-1" }, 201);
    }
    if (voice.narracao && ++voice.consultas > 1) voice.narracao.estado = "pronto";
    return json(route, { narracao: voice.narracao });
  });
  await page.route(`**/api/t/*/pecas/${id}/narracao/voz-1/avisos/0`, (route) => {
    voice.narracao!.avisos[0].decisao = "fala_certa";
    return json(route, { avisos: voice.narracao!.avisos });
  });
  await page.route(`**/api/t/*/pecas/${id}/reels`, async (route) => {
    yes.pedido = route.request().postDataJSON();
    return json(route, { pecaId: reels, workflowId: `${reels}-r1` }, 201);
  });
  await page.route(`**/api/t/*/pecas/${reels}/status`, async (route) => {
    // Two queries producing (assembling the video), then in review.
    yes.consultas++;
    if (yes.status === "rascunho" && yes.consultas > 2) yes.status = "revisao";
    return json(route, {
      ...status, id: reels, formato: "reels", status: yes.status, rodada: 1, versao: 1,
      etapa: yes.status === "rascunho" ? "renderizar" : null, tentativa: yes.status === "rascunho" ? 1 : null,
      ...(yes.status === "aprovada" ? { conta_modo: "manual", conta_nome: "@portal.litoral", conta_external_id: null } : {}),
    });
  });
  const artwork = [{ papel: "reels", id: "reels", hash: "h", png: real.artes[0].png, jpg: real.artes[0].jpg, mp4: VIDEO, duracao: 15 }];
  await page.route(new RegExp(`/api/t/[^/]+/pecas/${reels}$`), (route) =>
    json(route, { ...real, peca: { ...real.peca, id: reels, formato: "reels", status: yes.status, versao: 1, rodada: 1 }, artes: artwork, previa: null, eventos: [], decisoes: [] }));
  await page.route(`**/api/t/*/pecas/${reels}/revisao`, async (route) => {
    yes.decisao = route.request().postDataJSON();
    yes.status = "aprovada";
    return json(route, { status: "aprovada", modo: "manual" });
  });
  await page.route(`**/api/t/*/pecas/${reels}/pacote`, (route) =>
    json(route, { formato: "reels", legenda: real.peca.conteudo.legenda, imagens: [{ papel: "reels", jpg: real.artes[0].jpg }], video: VIDEO }));
  // The "MP4": dummy bytes (the screen does not play it in the test; download and share only need the file).
  await page.route(`**${VIDEO}`, (route) => route.fulfill({ status: 200, contentType: "video/mp4", body: Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]) }));
  return { id, reels, sim: yes, cards: real.peca.conteudo.cards.length as number };
}

for (const [view, viewport] of Object.entries(SCREENS)) {
  test.describe(view, () => {
    test.use({ viewport, deviceScaleFactor: view === "celular" ? 2 : 1 });

    test("make the Reels of a carousel: standing cards, licensed music, production, review with the video and package with the MP4", async ({ page }) => {
      await signIn(page);
      const { id, reels, sim: yes, cards } = await scenario(page);
      await page.goto(`/t/${DESIGN.veiculo}/p/${id}`);
      await page.getByRole("link", { name: "Fazer Reels" }).click();
      await expect(page).toHaveURL(new RegExp(`/p/${id}/reels$`));
      await expect(page.getByRole("heading", { name: "Fazer o Reels" })).toBeVisible();
      await expect(page.getByText(new RegExp(`^${cards} cards · .* s · 9:16 · sem narração$`))).toBeVisible();
      const frames = page.getByRole("list", { name: "Cards do Reels, na ordem" }).locator("iframe");
      await expect(frames).toHaveCount(cards);
      await expect(frames.first()).toHaveAttribute("srcdoc", /class="export r916"/);
      // The animated entrance runs in the preview without "reduce motion".
      await animationPreview(page).toBe("rl-sobe");
      // The first card opens whole: it is the video's frame 0.
      await animationPreview(page, 0).toBe("none");
      // The action stays in view, with the settings closed in rows that say what applies.
      await expect(page.getByRole("button", { name: "Fazer o Reels" })).toBeInViewport();
      await expect(partLine(page, "Música")).toContainText("sem música");
      await part(page, "Música");
      await expect(page).toHaveURL(/[?&]ajuste=musica/);
      await expect(page.getByRole("radio", { name: "Sem música" })).toBeChecked();
      await expect(page.getByRole("link", { name: BAND.licenca })).toHaveAttribute("href", BAND.licencaUrl);
      await page.getByRole("radio", { name: /Manhã calma/ }).check();
      await part(page, "Ritmo");
      await expect(partLine(page, "Música")).toContainText("Manhã calma");
      // Pace: the total duration follows; the motion changes the preview's entrance.
      await expect(page.getByRole("radio", { name: /^Normal/ })).toBeChecked();
      await expect(partLine(page, "Movimento")).toContainText("Manchete");
      const line = page.getByText(/^\d+ cards · /);
      const before = await line.textContent();
      await page.getByRole("radio", { name: /^Mais calmo/ }).check();
      await expect(line).not.toHaveText(before!);
      await part(page, "Movimento");
      await expect(page.getByRole("radio", { name: /^Manchete/ })).toBeChecked();
      await page.getByRole("radio", { name: /^Folha/ }).check();
      await expect(page.getByText("o seguinte entra deslizando por cima")).toBeVisible();
      await expect(frames.nth(1)).toHaveAttribute("srcdoc", /rl-folha \.5s/);
      await look(page, "ritmo");
      await page.getByRole("radio", { name: /^Manchete/ }).check();
      await look(page, "fazer");

      await page.getByRole("button", { name: "Fazer o Reels" }).click();
      await expect(page).toHaveURL(new RegExp(`/p/${reels}$`));
      expect(yes.pedido).toEqual({ musica: BAND.id, versao: 1, passo: 1.25, movimento: "manchete" });
      await expect(page.getByText("Montar o vídeo").first()).toBeVisible();
      await expect(page.getByText("Escrever o texto")).toHaveCount(0);
      await look(page, "produzindo");

      // In review: the upright video in place of the carousel; no Rewrite and no card editing.
      await expect(page.getByLabel(/^Vídeo do Reels, 15 segundos$/)).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("button", { name: "Reescrever" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Editar os cards" })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Fazer Reels" })).toHaveCount(0);
      await look(page, "revisao");

      await page.getByRole("button", { name: "Aprovar" }).click();
      await page.getByRole("button", { name: "Aprovar" }).click();
      await expect(page.getByRole("heading", { name: "Aprovado" })).toBeVisible();
      expect(yes.decisao).toMatchObject({ decisao: "aprovar", versao: 1 });
      await expect(page.getByLabel("Vídeo do Reels")).toBeVisible();
      await expect(page.getByRole("heading", { name: /^(Baixe|Mande) o vídeo$/ })).toBeVisible();
      await expect(page.getByRole("button", { name: /^(Baixar o vídeo|Compartilhar no Instagram)$/ })).toBeEnabled();
      await look(page, "publicar");
    });

    test("with your voice: script without a CTA, a warning to listen, and Make the Reels only with everything decided", async ({ page }) => {
      await signIn(page);
      const { id, reels, sim: yes } = await scenario(page);
      await page.goto(`/t/${DESIGN.veiculo}/p/${id}/reels`);
      await page.getByRole("radio", { name: "Com a sua voz" }).check();
      await expect(page.getByText("Roteiro", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Gravar a voz" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Fazer o Reels" })).toBeDisabled();
      await expect(page.getByRole("note").filter({ hasText: "Grave a voz ou envie o arquivo" })).toBeVisible();
      await expect(page.getByRole("radio", { name: /^Normal/ })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Fazer o Reels" })).toBeInViewport();
      await lookVoice(page, "roteiro");

      await page.getByLabel("Enviar arquivo").setInputFiles({ name: "voz.wav", mimeType: "audio/wav", buffer: Buffer.from("RIFF0000WAVEfmt 1234") });
      const warnings = page.getByRole("list", { name: "Avisos da fala" });
      await expect(warnings.getByRole("listitem")).toContainText("Confira o número 20", { timeout: 10_000 });
      await expect(page.getByRole("note").filter({ hasText: "Decida cada aviso" })).toBeVisible();
      await expect(page.getByText(/ · 24,8 s · 9:16 · com a sua voz$/)).toBeVisible();
      await lookVoice(page, "aviso");
      // With the Voice part closed, the warning stays on the row, in amber, and the button says why it is held.
      await part(page, "Música");
      await expect(partLine(page, "Voz").locator(".text-ambar")).toContainText("decida os avisos");
      await expect(page.getByRole("note").filter({ hasText: "Decida cada aviso" })).toBeVisible();
      await part(page, "Voz");
      await warnings.getByRole("button", { name: /A fala está certa/ }).click();
      await expect(warnings.getByText("a fala está certa")).toBeVisible();
      await expect(page.getByRole("button", { name: "Fazer o Reels" })).toBeEnabled();
      await lookVoice(page, "decidido");
      await page.getByRole("button", { name: "Fazer o Reels" }).click();
      await expect(page).toHaveURL(new RegExp(`/p/${reels}$`));
      expect(yes.pedido).toMatchObject({ narracao: "voz-1", versao: 1 });
    });

    test("with your voice, in English", async ({ page }) => {
      await signIn(page);
      const { id } = await scenario(page);
      await page.request.put("/api/me/idioma", { data: { idioma: "en" }, headers: { origin: "http://localhost:8787" } });
      try {
        await page.goto(`/t/${DESIGN.veiculo}/p/${id}/reels`);
        await page.getByRole("radio", { name: "With your voice" }).check();
        await expect(page.getByText("Script", { exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "Record your voice" })).toBeVisible();
        await expect(page.getByRole("note").filter({ hasText: "Record your voice or upload the file" })).toBeVisible();
      } finally {
        await page.request.put("/api/me/idioma", { data: { idioma: "pt-BR" }, headers: { origin: "http://localhost:8787" } }).catch(() => {});
      }
    });

    test("in English: pace, motion and the total length", async ({ page }) => {
      await signIn(page);
      const { id } = await scenario(page);
      await page.request.put("/api/me/idioma", { data: { idioma: "en" }, headers: { origin: "http://localhost:8787" } });
      try {
        await page.goto(`/t/${DESIGN.veiculo}/p/${id}/reels`);
        await part(page, "Pace");
        await page.getByRole("radio", { name: /^Faster/ }).check();
        await part(page, "Motion");
        await page.getByRole("radio", { name: /^Cut/ }).check();
        await expect(page.getByText("with a straight cut between them")).toBeVisible();
      } finally {
        await page.request.put("/api/me/idioma", { data: { idioma: "pt-BR" }, headers: { origin: "http://localhost:8787" } }).catch(() => {});
      }
    });

    test("with 'reduzir movimento' the preview stays still", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await signIn(page);
      const { id } = await scenario(page);
      await page.goto(`/t/${DESIGN.veiculo}/p/${id}/reels`);
      await expect(page.getByRole("list", { name: "Cards do Reels, na ordem" }).locator("iframe").first()).toBeVisible();
      await animationPreview(page).toBe("none");
    });
  });
}
