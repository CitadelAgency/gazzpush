// Phase D: Ideas (what changed since the last visit, in progress, new × already seen, sources), produce → progress →
// ready or failure, discard, loading and error. Ideas with the local D1's real data; production is simulated by route
// (the light status's states in sequence), so as not to spend the model on every run and to see each step. Axe 0 on
// every screen. Screenshots in design/telas/fase-d/.
import { expect, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { partLine, part } from "./parts";

const PRINTS = "design/telas/fase-d";
const SCREENS = { celular: { width: 390, height: 844 }, computador: { width: 1440, height: 900 } } as const;
const DESIGN = { email: "design@redacao.dev", senha: "senha-forte-123", veiculo: "portal-litoral" };
// The previous visit falls among the monitor's leads of 01/11 (02:05–02:06 UTC): some new, some already seen.
const VISIT = Date.parse("2026-11-01T02:06:15Z");
const ERROR_500 = { status: 500, contentType: "application/json", body: JSON.stringify({ erro: "erro interno" }) };

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

async function signIn(page: Page, visit: number | null = VISIT) {
  // Before any of the app's scripts: the previous visit is read once per load.
  await page.addInitScript((v) => {
    if (v === null) localStorage.removeItem("redacao:visita:portal-litoral");
    else localStorage.setItem("redacao:visita:portal-litoral", String(v));
  }, visit);
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(DESIGN.email);
  await page.getByLabel("Senha").fill(DESIGN.senha);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  // Sign-in lands on the first outlet by name, which depends on what other specs created: open this one.
  await expect(page).toHaveURL(/\/t\/[^/]+$/);
  await page.goto(`/t/${DESIGN.veiculo}`);
}

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/** The light status of a simulated piece: a common base + what changes per step. */
function status(over: Record<string, unknown>) {
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  return {
    id: "peca-e2e", status: "rascunho", formato: "carrossel", rodada: 1, versao: 0, erro: null, created_at: now, updated_at: now,
    titulo: "Operação Comboio e excesso de veículos causam lentidão em rodovias", manchete: null, iniciada_em: now,
    etapa: "redigir", tentativa: 1, ...over,
  };
}

for (const [view, viewport] of Object.entries(SCREENS)) {
  test.describe(view, () => {
    test.use({ viewport, deviceScaleFactor: view === "celular" ? 2 : 1 });
    const desktop = view === "computador";

    test("Ideas: first visit and after, with what changed, new × already seen and sources", async ({ page }) => {
      await signIn(page, null);
      await expect(page.getByText("Para começar:")).toBeVisible();
      await expect(page.getByRole("heading", { name: /^Ideias sugeridas/ })).toBeVisible();
      await look(page, "ideias-primeira");

      await page.addInitScript((v) => localStorage.setItem("redacao:visita:portal-litoral", String(v)), VISIT);
      await page.reload();
      await expect(page.getByText("Desde a sua última visita:")).toBeVisible();
      await expect(page.getByRole("status").filter({ hasText: "Desde a sua última visita" })).toContainText("posts prontos para aprovar");
      // round 4: the posts in progress no longer have a section title ("In progress"); they are the "Now" block.
      const now = page.getByRole("region", { name: "Agora" });
      await expect(now).toBeVisible();
      await expect(page.getByRole("heading", { name: /^Ideias novas/ })).toBeVisible();
      await expect(page.getByRole("heading", { name: /^Já vistas/ })).toBeVisible();
      // Already seen stays closed, with the count; opening goes to the URL and comes back on reload.
      const seen = partLine(page, "Já vistas");
      await expect(seen).toHaveAttribute("aria-expanded", "false");
      await expect(seen).toContainText(/\d+ ideias?/);
      await look(page, "ideias-vistas-fechadas");
      await seen.click();
      await expect(page).toHaveURL(/[?&]ideias=todas/);
      await expect(seen).toHaveAttribute("aria-expanded", "true");
      await page.reload();
      await expect(seen).toHaveAttribute("aria-expanded", "true");
      await seen.click();
      await expect(seen).toHaveAttribute("aria-expanded", "false");
      // One hand mark per screen: the loop sits on "Review the next one" (there is a ready post); Produce becomes an ordinary button.
      await expect(page.locator(".lapis-volta")).toHaveCount(1);
      // Posts in progress: the whole block is the link, with the wait written out.
      const inProgress = page.getByRole("link", { name: /Revisar a próxima/ });
      await expect(inProgress).toBeVisible();
      await expect(inProgress).toContainText(/espera há \d+ (min|h|dias)/);
      // round 4: the header used to state the oldest one's wait; now the oldest is the next action (the wait above is its
      // own), the block says how many are waiting and the following ones come in rows, each with its wait.
      await expect(inProgress).toContainText(/Para aprovar · \d+ esperam? você/);
      await expect(now.getByRole("heading", { name: "Na fila" })).toBeVisible();
      await expect(now.locator("a.fila-linha").first()).toContainText(/agora|há \d+ (min|h|dias)/);
      await expect(page.getByRole("heading", { name: /por relevância/ })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Produzir" }).first()).toBeVisible();

      if (desktop) {
        const sidebar = page.getByRole("complementary", { name: "Veículo e seções" });
        // Sources in one row: the state on the right, the whole row leads to the Sources tab (the Outlet group, below, has
        // another "Sources" link: the row is the first).
        const sources = sidebar.getByRole("link", { name: /^Fontes/ }).first();
        await expect(sources).toContainText("1 indisponível");
        await expect(sources).toHaveAttribute("href", /\/veiculo\?aba=fontes$/);
        await expect(sidebar.getByText("Fluxo", { exact: true })).toHaveCount(0);
        await expect(sidebar.getByRole("link", { name: /Para aprovar.*para aprovar/ })).toBeVisible();
      } else {
        // round 4: the folio (hidden on mobile) also says "1 source unavailable"; the screen's notice is what opens the details.
        await page.locator("summary").filter({ hasText: "1 fonte indisponível" }).click();
        await expect(page.getByText(/Prefeitura de Guarujá: a última coleta não respondeu/)).toBeVisible();
      }
      await look(page, "ideias");
    });

    test("produce → progress by stage → review", async ({ page }) => {
      await signIn(page);
      // A simulated piece: the POST does not touch D1 and the status advances on each query (2 s).
      const steps = [
        status({ etapa: "redigir", tentativa: 1 }),
        status({ etapa: "validar", tentativa: 1, versao: 0 }),
        status({ etapa: "redigir", tentativa: 2, versao: 1 }),
        status({ etapa: "ilustrar", tentativa: 2, versao: 2, manchete: "Comboio na Anchieta deixa trânsito lento na volta do feriado" }),
        status({ etapa: "renderizar", tentativa: 2, versao: 2, manchete: "Comboio na Anchieta deixa trânsito lento na volta do feriado" }),
        status({ status: "revisao", etapa: null, tentativa: null, versao: 2, manchete: "Comboio na Anchieta deixa trânsito lento na volta do feriado" }),
      ];
      let request: unknown = null;
      let i = 0;
      let queries = 0;
      let swapped = 0;
      let last = steps[0];
      await page.route("**/api/t/*/pautas/*/produzir", async (route) => {
        request = route.request().postDataJSON();
        await json(route, { pecaId: "peca-e2e", workflowId: "peca-e2e-r1" }, 201);
      });
      // round 4: the same status is requested by the Ideas short-queue row, by the sidebar card and by the post screen, each
      // when it appears. The step advances with the query, but at most once every 1.5 s: back-to-back requests (the post
      // screen arriving right after the queue row) get the same step, and none is skipped.
      await page.route("**/api/t/*/pecas/peca-e2e/status", (route) => {
        queries++;
        if (Date.now() - swapped >= 1500) { last = steps[Math.min(i++, steps.length - 1)]; swapped = Date.now(); }
        return json(route, last);
      });
      // The progress list (Ideas and the sidebar's "In production" card) carries the simulated piece while it produces: only
      // after Produce (before it the piece does not exist, and the sidebar must not spend the first step).
      await page.route(/\/api\/t\/[^/]+\/pecas\?status=rascunho(,|%2C)revisao/, async (route) => {
        // The list is queried every 5 s: the call in flight when the test ends must not become an error.
        const r = await route.fetch().catch(() => null);
        if (!r) return;
        const body = await r.json();
        if (request && last.status === "rascunho") {
          const { etapa: _e, tentativa: _t, iniciada_em: _i, ...piece } = last;
          body.pecas.push({ ...piece, formato: "post", editoria: "transito", agendado_para: null, conta_modo: null, conta_nome: null, conta_external_id: null, ncards: null, capa: null });
          body.total.rascunho = (body.total.rascunho ?? 0) + 1;
        }
        await json(route, body);
      });
      // The full piece (art) comes from a real piece in review, so the screenshot shows real images.
      await page.route("**/api/t/*/pecas/peca-e2e", async (route) => {
        const list = await (await page.request.get(`/api/t/${DESIGN.veiculo}/pecas`)).json();
        const real = list.pecas.find((p: { status: string; formato: string }) => p.status === "revisao" && p.formato === "carrossel");
        const r = await route.fetch({ url: route.request().url().replace("peca-e2e", real.id) });
        await route.fulfill({ response: r });
      });

      // round 4: on desktop the format and Produce sit on the chosen idea's lead sheet; on mobile, on the row.
      const actions = desktop ? page.getByRole("region", { name: "Folha de pauta" }) : page.getByRole("listitem").filter({ has: page.getByRole("button", { name: "Produzir" }) }).first();
      const post = actions.getByRole("button", { name: /^post/ });
      await post.click();
      await expect(post).toHaveAttribute("aria-pressed", "true");
      await actions.getByRole("button", { name: "Produzir", exact: true }).click();
      await expect(page).toHaveURL(/\/p\/peca-e2e$/);
      expect(request).toEqual({ formato: "post" });

      await expect(page.getByRole("heading", { name: /^Produzindo/ })).toBeVisible();
      await expect(page.getByRole("status").filter({ hasText: "Agora:" })).toHaveText("Agora: Escrever o texto.");
      // With history (ready posts in the local D1), the sentence states the outlet's measured time, not "1 or 2 minutes".
      await expect(page.getByText(/^Neste veículo costuma levar cerca de \d+ (s|min)\./)).toBeVisible();
      // Sidebar (desktop): the "In production" card follows the same piece, through the same status query.
      const production = page.getByRole("complementary", { name: "Veículo e seções" }).getByRole("region", { name: "Em produção" });
      if (desktop) {
        await expect(production).toContainText("Operação Comboio e excesso de veículos");
        await expect(production).toContainText("Escrever o texto · 1 de 4");
      }
      await look(page, "peca-produzindo");
      await expect(page.getByRole("status").filter({ hasText: "Agora:" })).toHaveText("Agora: Escrever o texto (tentativa 2 de 3).", { timeout: 15_000 });
      await expect(page.getByRole("status").filter({ hasText: "Agora:" })).toHaveText("Agora: Desenhar a ilustração.", { timeout: 15_000 });
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Comboio na Anchieta deixa trânsito lento na volta do feriado");
      if (desktop) await expect(production).toContainText("Desenhar a ilustração · 3 de 4");
      await look(page, "peca-ilustrando");
      if (desktop) await expect(production).toContainText("Montar a imagem · 4 de 4", { timeout: 15_000 });

      // Ready: review (Phase E) takes the place of the progress.
      await expect(page.getByRole("button", { name: "Aprovar" })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("img", { name: /^Card 1 de \d+: Capa/ })).toBeVisible();
      const untilHere = queries;
      await page.waitForTimeout(4500);
      expect(queries, "polling para no estado final").toBe(untilHere);
      // The sidebar card goes away when the piece becomes review (the progress list reloads by itself).
      if (desktop) await expect(production).toBeHidden({ timeout: 10_000 });
      await look(page, "peca-pronta");

      await page.getByRole("main").getByRole("link", { name: "Para aprovar", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/t/${DESIGN.veiculo}/aprovar$`));
      await page.unrouteAll({ behavior: "ignoreErrors" });
    });

    test("failure shows the reason in plain language and the way back", async ({ page }) => {
      await signIn(page);
      await page.route("**/api/t/*/pecas/peca-e2e/status", (route) =>
        json(route, status({ status: "falhou", etapa: null, tentativa: null, erro: "validação reprovou 3 redações", pauta_id: "pauta-e2e", pauta_status: "aceita" })));
      let request: { url: string; corpo: unknown } | null = null;
      await page.route("**/api/t/*/pautas/pauta-e2e/produzir", (route) => {
        request = { url: route.request().url(), corpo: route.request().postDataJSON() };
        return json(route, { pecaId: "peca-e2e-2", workflowId: "peca-e2e-2-r1" }, 201);
      });
      await page.route("**/api/t/*/pecas/peca-e2e-2/status", (route) => json(route, status({ id: "peca-e2e-2" })));
      await page.goto(`/t/${DESIGN.veiculo}/p/peca-e2e`);
      await expect(page.getByRole("alert")).toContainText("Não deu certo");
      await expect(page.getByRole("alert")).toContainText("não passou na conferência com as fontes");
      await expect(page.getByText("validação reprovou 3 redações")).toBeHidden();
      await look(page, "peca-falhou");
      // Produce again from here, in the same format, and follow the new piece.
      await page.getByRole("button", { name: "Produzir de novo (carrossel)" }).click();
      await expect(page).toHaveURL(/\/p\/peca-e2e-2$/);
      expect(request).toEqual({ url: expect.stringMatching(/\/pautas\/pauta-e2e\/produzir$/), corpo: { formato: "carrossel" } });

      await page.unrouteAll();
      await page.goto(`/t/${DESIGN.veiculo}/p/nao-existe`);
      await expect(page.getByText("Esse post não existe ou é de outro veículo.")).toBeVisible();
    });

    test("discard asks for confirmation; conflict becomes a warning and the list updates", async ({ page }) => {
      await signIn(page);
      const calls: string[] = [];
      await page.route("**/api/t/*/pautas/*/descartar", (route) => {
        calls.push(route.request().url());
        return calls.length === 1 ? json(route, { erro: "pauta: transição em_producao → descartada inválida" }, 409) : json(route, { status: "descartada" });
      });
      await part(page, /^(Mais ideias|Já vistas)/);
      const item = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: /^Polícia apreende granadas/ }) });
      // round 4: on desktop the row selects the idea (it goes to the URL) and the actions sit on the lead sheet; on mobile,
      // they stay on the row itself.
      const actions = desktop ? page.getByRole("region", { name: "Folha de pauta" }) : item;
      if (desktop) {
        await item.getByRole("button", { name: /^Polícia apreende granadas/ }).click();
        await expect(page).toHaveURL(/[?&]ideia=/);
        await expect(item).toHaveAttribute("aria-current", "true");
        await expect(actions.getByRole("heading", { level: 2 })).toHaveText(/^Polícia apreende granadas/);
      }
      await actions.getByRole("button", { name: "Descartar ideia" }).click();
      await expect(actions.getByText("Tirar esta ideia da lista?")).toBeVisible();
      // round 4: the step opens with focus on "Remove" (X and then Enter, by keyboard).
      await expect(actions.getByRole("button", { name: "Tirar", exact: true })).toBeFocused();
      await look(page, "ideias-descartar");
      let reloads = 0;
      page.on("request", (r) => { if (r.method() === "GET" && /\/api\/t\/[^/]+\/pautas\?/.test(r.url())) reloads++; });
      await actions.getByRole("button", { name: "Tirar", exact: true }).click();
      await expect(actions.getByRole("alert")).toContainText("Essa ideia já mudou");
      await expect.poll(() => reloads, { message: "conflito recarrega a lista" }).toBeGreaterThan(0);
      await actions.getByRole("button", { name: "Tirar", exact: true }).click();
      await expect.poll(() => calls.length).toBe(2);
      expect(calls[0]).toMatch(/\/pautas\/[^/]+\/descartar$/);
      // round 4: once removed, the step closes by itself (before, it stayed open until the list reloaded, and the test cancelled by hand).
      await expect(page.getByText("Tirar esta ideia da lista?")).toHaveCount(0);
    });

    if (desktop) {
      // round 4: the idea list moves by keyboard; the key opens the step and the button decides (DESIGN.md §6.12).
      test("list shortcuts: J and K move, 1 and 2 switch the format, P goes to Produce and X opens discard, without deciding", async ({ page }) => {
        await signIn(page);
        const requests: string[] = [];
        await page.route("**/api/t/*/pautas/*/*", (route) => { requests.push(route.request().url()); return route.abort(); });
        const sheet = page.getByRole("region", { name: "Folha de pauta" });
        // With the already-seen ones open, the list surely has more than one row (the new ones may be just one).
        await part(page, /^(Mais ideias|Já vistas)/);
        const lines = page.locator(".pauta-lista > li");
        // Without a parameter, the first one is chosen, and the sheet shows its headline.
        await expect(lines.first()).toHaveAttribute("aria-current", "true");
        await expect(sheet.getByRole("heading", { level: 2 })).toHaveText((await lines.first().getByRole("heading").textContent())!);
        await page.keyboard.press("j");
        await expect(lines.nth(1)).toHaveAttribute("aria-current", "true");
        await expect(page).toHaveURL(/[?&]ideia=/);
        await expect(sheet.getByRole("heading", { level: 2 })).toHaveText((await lines.nth(1).getByRole("heading").textContent())!);
        // The chosen one comes back on reload.
        await page.reload();
        await expect(lines.nth(1)).toHaveAttribute("aria-current", "true");
        await page.keyboard.press("k");
        await expect(lines.first()).toHaveAttribute("aria-current", "true");
        await page.keyboard.press("ArrowDown");
        await expect(lines.nth(1)).toHaveAttribute("aria-current", "true");
        await page.keyboard.press("1");
        await expect(sheet.getByRole("button", { name: /^post/ })).toHaveAttribute("aria-pressed", "true");
        await page.keyboard.press("2");
        await expect(sheet.getByRole("button", { name: /^carrossel/ })).toHaveAttribute("aria-pressed", "true");
        await page.keyboard.press("p");
        await expect(sheet.getByRole("button", { name: "Produzir", exact: true })).toBeFocused();
        await page.keyboard.press("x");
        await expect(sheet.getByRole("button", { name: "Tirar", exact: true })).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(sheet.getByRole("button", { name: "Descartar ideia" })).toBeFocused();
        expect(requests, "atalho só abre: nada é produzido nem descartado").toEqual([]);
        await look(page, "ideias-atalhos");
      });
    }

    test("loading and error: Ideas and progress", async ({ page }) => {
      await signIn(page);
      await page.route("**/api/t/*/pautas*", () => new Promise<void>(() => {}));
      await page.reload();
      await expect(page.getByRole("status").filter({ hasText: "Carregando as ideias" })).toBeAttached();
      await look(page, "ideias-carga");
      await page.unrouteAll({ behavior: "ignoreErrors" });

      await page.route("**/api/t/*/pautas*", (route) => route.fulfill(ERROR_500));
      await page.reload();
      await expect(page.getByRole("alert")).toContainText("Não carregou as ideias.");
      await look(page, "ideias-erro");
      await page.unrouteAll();
      await page.getByRole("button", { name: "Tentar de novo" }).click();
      await expect(page.getByRole("heading", { name: /^Ideias novas/ })).toBeVisible();

      await page.route("**/api/t/*/pecas/peca-e2e/status", (route) => route.fulfill(ERROR_500));
      await page.goto(`/t/${DESIGN.veiculo}/p/peca-e2e`);
      await expect(page.getByRole("alert")).toContainText("Não carregou o andamento.", { timeout: 10_000 });
      await look(page, "peca-erro");
    });
  });
}
