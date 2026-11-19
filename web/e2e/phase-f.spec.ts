// Phase F: Ready to post, publish (share on mobile, download on desktop, caption, confirm with the link), posting by
// itself, posted and Posted, with the local D1's real pieces (one approved on a manual account, one posted by the
// simulated account). The confirmation is intercepted by route (confirming for real would spend the test piece); the
// body sent is checked and the next status simulated. Axe 0 on every screen. Screenshots in design/telas/fase-f/.
import { expect, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PRINTS = "design/telas/fase-f";
const SCREENS = { celular: { width: 390, height: 844 }, computador: { width: 1440, height: 900 } } as const;
const DESIGN = { email: "design@redacao.dev", senha: "senha-forte-123", veiculo: "portal-litoral" };
const ERROR_500 = { status: 500, contentType: "application/json", body: JSON.stringify({ erro: "erro interno" }) };

type Ready = { id: string; status: string; formato: string; ncards: number | null; conta_modo: string | null; manchete: string | null };

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

async function signIn(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(DESIGN.email);
  await page.getByLabel("Senha").fill(DESIGN.senha);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  // Sign-in lands on the first outlet by name, which depends on what other specs created: open this one.
  await expect(page).toHaveURL(/\/t\/[^/]+$/);
  await page.goto(`/t/${DESIGN.veiculo}`);
}

/** What is on the clipboard (Windows returns CRLF and trailing spaces). */
const pasted = async (page: Page) => (await page.evaluate(() => navigator.clipboard.readText())).replace(/[ \t]*\r?\n/g, "\n");

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/** The approved one on a manual account in the local D1 (README, Local test; handoff §8, block F). */
async function manualApproved(page: Page): Promise<Ready> {
  const list = await (await page.request.get(`/api/t/${DESIGN.veiculo}/pecas?status=aprovada,agendada`)).json();
  const p = (list.pecas as Ready[]).find((x) => x.conta_modo === "manual");
  expect(p, "D1 local precisa de um post aprovado em conta manual (handoff §8, bloco F)").toBeTruthy();
  return p!;
}

/** Overrides the post's real status (`depois`), from the moment `ativo()` says so. */
async function perTopStatus(page: Page, id: string, actor: (real: Record<string, unknown>) => Record<string, unknown> | null) {
  await page.route(`**/api/t/*/pecas/${id}/status`, async (route) => {
    const real = await (await route.fetch()).json();
    const swap = actor(real);
    await json(route, swap ? { ...real, ...swap } : real);
  });
}

for (const [view, viewport] of Object.entries(SCREENS)) {
  test.describe(view, () => {
    const phone = view === "celular";
    // On mobile: touch (pointer: coarse) and the system share, recorded instead of opening the sheet.
    test.use({ viewport, deviceScaleFactor: phone ? 2 : 1, hasTouch: phone, isMobile: phone, permissions: ["clipboard-read", "clipboard-write"] });
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => {
        const w = window as unknown as { __compartilhado?: { n: number; tipos: string[]; nomes: string[] } };
        navigator.canShare = (d?: ShareData) => !!d?.files?.length;
        navigator.share = async (d?: ShareData) => { w.__compartilhado = { n: d?.files?.length ?? 0, tipos: (d?.files ?? []).map((f) => f.type), nomes: (d?.files ?? []).map((f) => f.name) }; };
      });
    });

    test("Ready to post → send the images, caption and confirm with the link", async ({ page }) => {
      await signIn(page);
      const p = await manualApproved(page);
      // The section's counter says how many are waiting for someone to post.
      await expect(page.getByRole("navigation", { name: "Seções" }).getByText(/\d+ para postar/)).toBeVisible();
      await page.getByRole("navigation", { name: "Seções" }).getByRole("link", { name: phone ? /Postar$/ : /^Prontos para postar/ }).click();
      await expect(page).toHaveURL(new RegExp(`/t/${DESIGN.veiculo}/postar$`));
      await expect(page.getByRole("heading", { level: 1, name: "Prontos para postar" })).toBeVisible();
      // The screen changed: focus goes to the start of the new content (screen reader and keyboard do not get lost).
      await expect(page.locator("main#conteudo")).toBeFocused();
      // No count sentence: each row writes its wait ("waiting 14 h · approved today, 10:00").
      await expect(page.getByRole("main").getByRole("listitem").getByRole("link").first()).toContainText(/espera há \d+ (min|h|dias) · aprovado /);
      await expect(page.locator(".lapis-volta")).toHaveCount(1);
      await look(page, "postar");

      await page.getByRole("link", { name: /Postar a próxima/ }).click();
      if (!phone) {
        // Round 4: on a wide screen a click selects the proof and the posting script appears beside it, without leaving the
        // list; "Open the post" leads to its screen (all the images, the Reels).
        await expect(page).toHaveURL(new RegExp(`/postar[?]post=${p.id}$`));
        const script = page.locator("section.roteiro");   // its name is the chosen post's headline
        await expect(script).toContainText("Copie a legenda");
        await expect(page.locator(".lapis-volta")).toHaveCount(1);
        await look(page, "postar-roteiro");
        await script.getByRole("link", { name: "Abrir o post" }).click();
      }
      await expect(page).toHaveURL(new RegExp(`/p/${p.id}$`));
      await expect(page.getByRole("heading", { name: /^Postar no Instagram/ })).toBeVisible();
      const n = p.ncards ?? 1;
      await expect(page.getByRole("img", { name: new RegExp(`^Card 1 de ${n}: Capa`) })).toBeVisible();
      // The marked section is Ready to post; the way back leads there.
      await expect(page.getByRole("main").getByRole("link", { name: "Prontos para postar", exact: true })).toBeVisible();
      await expect(page.locator(".lapis-volta")).toHaveCount(1);

      const caption = ((await (await page.request.get(`/api/t/${DESIGN.veiculo}/pecas/${p.id}/pacote`)).json()).legenda as string).replace(/[ \t]*\n/g, "\n");
      if (phone) {
        const share = page.getByRole("button", { name: "Compartilhar no Instagram" });
        await expect(share).toBeEnabled();
        await look(page, "publicar");
        await share.click();
        await expect(page.getByText(/^Imagens enviadas e legenda copiada/)).toBeVisible();
        const sent = await page.evaluate(() => (window as unknown as { __compartilhado: unknown }).__compartilhado);
        expect(sent).toEqual({ n, tipos: Array(n).fill("image/jpeg"), nomes: expect.arrayContaining([expect.stringMatching(/^portal-litoral-1-capa\.jpg$/)]) });
        expect(await pasted(page)).toBe(caption);
        // Round 4: a done step shrinks to a line; its title opens it again, and the "or download" way out is still there.
        await page.getByRole("button", { name: n > 1 ? "Mande as imagens" : "Mande a imagem" }).click();
        await expect(page.getByRole("button", { name: "ou baixar as imagens" })).toBeVisible();
      } else {
        // On desktop: download. A carousel comes in a .zip with the JPEGs in order.
        const save = page.getByRole("button", { name: n > 1 ? `Baixar as ${n} imagens` : "Baixar a imagem" });
        await expect(save).toBeEnabled();
        await expect(page.getByRole("button", { name: "Compartilhar no Instagram" })).toHaveCount(0);
        await look(page, "publicar");
        const [download] = await Promise.all([page.waitForEvent("download"), save.click()]);
        expect(download.suggestedFilename()).toMatch(n > 1 ? /^portal-litoral-post\.zip$/ : /\.jpg$/);
        const path = await download.path();
        const bytes = new Uint8Array(await (await import("node:fs/promises")).readFile(path));
        if (n > 1) {
          expect([...bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
          const text = new TextDecoder("latin1").decode(bytes);
          expect(text).toContain("portal-litoral-1-capa.jpg");
          expect((text.match(/\xff\xd8\xff/g) ?? []).length).toBe(n);
        }
        await expect(page.getByText("Imagens baixadas. Confira a pasta de downloads.")).toBeVisible();
        await page.getByRole("button", { name: "copiar" }).click();
        expect(await pasted(page)).toBe(caption);
      }

      // Confirm: a strange link asks again; a good link goes along; the next status becomes "Posted".
      let sent: unknown = null;
      await page.route(`**/api/t/*/pecas/${p.id}/publicada`, (route) => {
        sent = route.request().postDataJSON();
        return json(route, { status: "publicada", publicacaoId: "pub-e2e" });
      });
      await perTopStatus(page, p.id, () => (sent
        ? { status: "publicada", publicacao_status: "publicada", publicacao_url: "https://www.instagram.com/p/E2E123/", publicado_em: new Date().toISOString(), publicacao_modo: "manual" }
        : null));
      const field = page.getByLabel(/Link do post/);
      await field.fill("postei");
      await page.getByRole("button", { name: "Confirmar que postei" }).click();
      await expect(field).toHaveAttribute("aria-invalid", "true");
      await expect(page.getByText(/^Esse link não é de um post do Instagram/)).toBeVisible();
      // A link from another site does not count either: only an Instagram post.
      await field.fill("https://example.com/p/E2E123/");
      await page.getByRole("button", { name: "Confirmar que postei" }).click();
      await expect(field).toHaveAttribute("aria-invalid", "true");
      expect(sent).toBeNull();
      await field.fill("instagram.com/p/E2E123/");
      await expect(field).toHaveAttribute("aria-invalid", "false");
      await look(page, "publicar-confirmar");
      await page.getByRole("button", { name: "Confirmar que postei" }).click();
      await expect(page.getByRole("heading", { name: "Postado" })).toBeVisible();
      expect(sent).toEqual({ url: "https://instagram.com/p/E2E123/" });
      await expect(page.getByRole("link", { name: /^Ver no Instagram/ })).toHaveAttribute("href", "https://www.instagram.com/p/E2E123/");
      await expect(page.getByRole("main").getByRole("link", { name: "Postados", exact: true })).toBeVisible();
      await look(page, "postado");
    });

    test("Posted: what went out, with the test account labelled, and the post open", async ({ page }) => {
      await signIn(page);
      await page.goto(`/t/${DESIGN.veiculo}/postados`);
      await expect(page.getByRole("heading", { level: 1, name: "Postados" })).toBeVisible();
      const items = page.getByRole("main").getByRole("listitem");
      await expect(items.first()).toBeVisible();
      await expect(page.getByText("Conta de teste: sem link de verdade.").first()).toBeVisible();
      // There is a ready post: the next action is to post.
      await expect(page.locator(".lapis-volta")).toHaveCount(1);
      await look(page, "postados");
      await items.first().getByRole("heading").getByRole("link").click();
      await expect(page.getByRole("heading", { name: "Simulação concluída" })).toBeVisible();
      await expect(page.getByText(/^Conta de teste @portal\.litoral: nada saiu de verdade/)).toBeVisible();
      await expect(page.getByRole("link", { name: /^Ver no Instagram/ })).toHaveCount(0);
    });

    test("Posted: older ones by cursor, empty, loading and error", async ({ page }) => {
      await signIn(page);
      const real = await (await page.request.get(`/api/t/${DESIGN.veiculo}/publicacoes`)).json();
      const one = real.publicacoes[0];
      const requests: (string | null)[] = [];
      await page.route("**/api/t/*/publicacoes*", (route) => {
        const before = new URL(route.request().url()).searchParams.get("antes");
        requests.push(before);
        // A publication older than 7 days: with one from this week, the sidebar's Today card would already fetch the next page
        // by itself (to count the whole week) and the button would disappear before the click.
        if (!before) return json(route, { publicacoes: [{ ...one, id: "a", modo: "manual", url: "https://www.instagram.com/p/A/", manchete: "Primeira página", publicado_em: "2026-10-01 08:00:00" }], proximo: "2026-11-01 08:00:00|a" });
        return json(route, { publicacoes: [{ ...one, id: "b", modo: "manual", url: null, manchete: "Segunda página" }], proximo: null });
      });
      await page.goto(`/t/${DESIGN.veiculo}/postados`);
      await expect(page.getByText("Primeira página")).toBeVisible();
      await page.getByRole("button", { name: "Ver mais antigos" }).click();
      await expect(page.getByText("Segunda página")).toBeVisible();
      await expect(page.getByText("Confirmado sem o link do post.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Ver mais antigos" })).toHaveCount(0);
      expect(requests).toEqual([null, "2026-11-01 08:00:00|a"]);
      await page.unrouteAll();

      await page.route("**/api/t/*/publicacoes*", () => new Promise<void>(() => {}));
      await page.reload();
      await expect(page.getByRole("status").filter({ hasText: "Carregando os postados" })).toBeAttached();
      await look(page, "postados-carga");
      await page.unrouteAll({ behavior: "ignoreErrors" });

      await page.route("**/api/t/*/publicacoes*", (route) => route.fulfill(ERROR_500));
      await page.reload();
      await expect(page.getByRole("alert").filter({ hasText: "Não carregou os postados." })).toBeVisible();
      await look(page, "postados-erro");
      await page.unrouteAll();

      await page.route("**/api/t/*/publicacoes*", (route) => json(route, { publicacoes: [], proximo: null }));
      await page.reload();
      await expect(page.getByText("Nada postado ainda.")).toBeVisible();
      await expect(page.getByRole("link", { name: "Ver Prontos para postar" })).toBeVisible();
      await look(page, "postados-vazio");
    });

    test("Ready to post: loading, error and empty", async ({ page }) => {
      await signIn(page);
      await page.route("**/api/t/*/pecas?status=aprovada*", () => new Promise<void>(() => {}));
      await page.goto(`/t/${DESIGN.veiculo}/postar`);
      await expect(page.getByRole("status").filter({ hasText: "Carregando os posts" })).toBeAttached();
      await look(page, "postar-carga");
      await page.unrouteAll({ behavior: "ignoreErrors" });

      await page.route("**/api/t/*/pecas?status=aprovada*", (route) => route.fulfill(ERROR_500));
      await page.reload();
      await expect(page.getByRole("alert").filter({ hasText: "Não carregou os posts prontos para postar." })).toBeVisible();
      await look(page, "postar-erro");
      await page.unrouteAll();

      await page.route("**/api/t/*/pecas?status=aprovada*", (route) => json(route, { pecas: [], total: {}, manuais: 0, prontasDesde: null }));
      await page.reload();
      await expect(page.getByText("Nada para postar agora.")).toBeVisible();
      // There are posts waiting for approval in the local D1: the empty state points there.
      await expect(page.getByRole("link", { name: "Ver Para aprovar" })).toBeVisible();
      await look(page, "postar-vazio");
    });

    test("account that posts on its own: posting, with time and posting failure", async ({ page }) => {
      await signIn(page);
      const p = await manualApproved(page);
      let phase: Record<string, unknown> = { conta_modo: "simulada", conta_nome: "@portal.litoral (simulada)" };
      await perTopStatus(page, p.id, () => phase);
      await page.goto(`/t/${DESIGN.veiculo}/p/${p.id}`);
      await expect(page.getByRole("heading", { name: "Simulando a postagem" })).toBeVisible();
      await expect(page.getByText(/^Conta de teste: nada sai de verdade\. Pode sair desta tela: o envio continua\./)).toBeVisible();
      await expect(page.getByRole("button", { name: /Compartilhar|Baixar/ })).toHaveCount(0);
      await look(page, "postando-sozinho");

      phase = { ...phase, status: "agendada", agendado_para: new Date(Date.now() + 26 * 3600_000).toISOString() };
      await page.reload();
      await expect(page.getByRole("heading", { name: "Simulação marcada" })).toBeVisible();
      await expect(page.getByText(/^Sai (amanhã|\d\d\/\d\d), \d\d:\d\d em @portal\.litoral\./)).toBeVisible();

      phase = { ...phase, status: "falhou", erro: "Error: Graph 500", publicacao_status: "falhou", pauta_status: "aceita" };
      await page.reload();
      // The outcome is uncertain (it may have gone out before the failure): no claiming that it did not go out.
      await expect(page.getByRole("heading", { name: "Não deu para confirmar a postagem" })).toBeVisible();
      await expect(page.getByText(/o post pode ter saído mesmo assim\. Confira no Instagram antes de tentar de novo\./)).toBeVisible();
      // The next action is to check the profile (the pencil loop); producing again stays in text, for when it did not go out.
      await expect(page.getByRole("link", { name: /^Conferir no Instagram/ })).toHaveAttribute("href", "https://www.instagram.com/portal.litoral/");
      await expect(page.locator(".lapis-volta")).toHaveCount(1);
      await expect(page.getByRole("button", { name: "Não saiu: produzir de novo" })).toBeVisible();
      await look(page, "falhou-ao-postar");
    });

    test("posted on its own with the screen open: Posted and the counter update at once", async ({ page }) => {
      await signIn(page);
      const p = await manualApproved(page);
      let requestsPosted = 0;
      page.on("request", (r) => { if (r.method() === "GET" && /\/api\/t\/[^/]+\/publicacoes/.test(r.url())) requestsPosted++; });
      await page.goto(`/t/${DESIGN.veiculo}/postados`);
      await expect(page.getByRole("heading", { level: 1, name: "Postados" })).toBeVisible();
      // At least one: Posted's pace strip fetches the following pages while the week is not closed (round 4).
      await expect.poll(() => requestsPosted).toBeGreaterThanOrEqual(1);
      // The account posts by itself and the post goes out while its screen is open (the status changes in the follow-up).
      let left = false;
      await perTopStatus(page, p.id, () => (left
        ? { status: "publicada", conta_modo: "simulada", publicacao_status: "publicada", publicacao_modo: "simulada", publicado_em: new Date().toISOString() }
        : { conta_modo: "simulada" }));
      // All by navigation inside the app (reloading the page would reset the cache and the test would prove nothing).
      await page.getByRole("navigation", { name: "Seções" }).getByRole("link", { name: phone ? /Postar$/ : /^Prontos para postar/ }).click();
      await page.getByRole("link", { name: "Postar a próxima" }).click();
      // On a wide screen a click selects the proof; the post's own screen is what follows it closely.
      if (!phone) await page.locator("section.roteiro").getByRole("link", { name: "Abrir o post" }).click();
      await expect(page).toHaveURL(new RegExp(`/p/${p.id}$`));
      await expect(page.getByRole("heading", { name: "Simulando a postagem" })).toBeVisible();
      // Count before the post goes out: with the Today card in the sidebar, the Posted list stays active and is fetched again
      // the moment the follow-up sees the post go out (before going back to the screen); without it, on opening Posted.
      const before = requestsPosted;
      left = true;
      await expect(page.getByRole("heading", { name: "Simulação concluída" })).toBeVisible({ timeout: 10_000 });
      // Back on Posted in under 30 s: the list was already fetched again (the earlier one did not stay).
      await page.getByRole("main").getByRole("link", { name: "Postados", exact: true }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Postados" })).toBeVisible();
      await expect.poll(() => requestsPosted).toBeGreaterThan(before);
    });

    test("publish: images that do not load and refused confirmation", async ({ page }) => {
      await signIn(page);
      const p = await manualApproved(page);
      await page.route(`**/api/t/*/pecas/${p.id}/pacote`, (route) => route.fulfill(ERROR_500));
      await page.goto(`/t/${DESIGN.veiculo}/p/${p.id}`);
      await expect(page.getByRole("alert").filter({ hasText: "Não carregou as imagens." })).toBeVisible();
      // Without the images, the button says they did not come (it does not stay "preparing" forever); the step follows the device.
      await expect(page.getByRole("button", { name: "Imagens indisponíveis" })).toBeDisabled();
      await expect(page.getByRole("heading", { name: phone ? "Mande as imagens" : "Baixe as imagens" })).toBeVisible();
      await look(page, "publicar-erro");
      await page.unrouteAll();
      await page.getByRole("button", { name: "Tentar de novo" }).click();
      await expect(page.getByRole("button", { name: phone ? "Compartilhar no Instagram" : /^Baixar a/ })).toBeEnabled();

      await page.route(`**/api/t/*/pecas/${p.id}/publicada`, (route) => json(route, { erro: "peça em publicada" }, 409));
      await page.getByRole("button", { name: "Confirmar que postei" }).click();
      await expect(page.getByRole("alert")).toContainText("Este post mudou: outra pessoa já confirmou");
    });
  });
}

/** Names of the animations of a screen change (View Transition) triggered on the page. */
const animationsSwap = (page: Page) => page.evaluate(async () => {
  const t = (document as Document & { startViewTransition?: (f: () => void) => { ready: Promise<void>; finished: Promise<void> } })
    .startViewTransition?.(() => {});
  if (!t) return null;
  await t.ready;
  const names = document.getAnimations().map((a) => (a as CSSAnimation).animationName).filter(Boolean);
  await t.finished;
  return names.filter((n) => n.startsWith("troca-")).sort();
});

for (const reduce of [false, true]) {
  test.describe(reduce ? "reduced motion" : "motion", () => {
    test.use({ viewport: SCREENS.celular, reducedMotion: reduce ? "reduce" : "no-preference" });

    test(reduce ? "plain screen swap, pencil stroke already drawn" : "screen swap: the content leaves and enters", async ({ page }) => {
      await signIn(page);
      await page.goto(`/t/${DESIGN.veiculo}/postados`);
      await expect(page.getByRole("heading", { level: 1, name: "Postados" })).toBeVisible();
      expect(await animationsSwap(page)).toEqual(reduce ? [] : ["troca-entra", "troca-sai"]);
      if (reduce) {
        const back = page.locator(".lapis-volta path").first();
        await expect(back).toBeVisible();
        expect(await back.evaluate((el) => getComputedStyle(el).strokeDashoffset)).toMatch(/^0(px)?$/);
      }
    });
  });
}
