// Phase E: To approve and review (carousel, validation, caption, facts, decision sheet), with the local D1's real pieces
// in review. Decisions are intercepted by route (the body sent is checked and the next status simulated): approving,
// rewriting or rejecting for real would spend the test pieces and, on rewrite, the model. Axe 0 on every screen.
// Screenshots in design/telas/fase-e/.
import { expect, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PRINTS = "design/telas/fase-e";
const SCREENS = { celular: { width: 390, height: 844 }, computador: { width: 1440, height: 900 } } as const;
const DESIGN = { email: "design@redacao.dev", senha: "senha-forte-123", veiculo: "portal-litoral" };
const ERROR_500 = { status: 500, contentType: "application/json", body: JSON.stringify({ erro: "erro interno" }) };

type PieceQueue = { id: string; status: string; formato: string; ncards: number | null };

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

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/** Posts in review in the local D1, in the API's order (whoever has waited longest first). */
async function inReview(page: Page): Promise<PieceQueue[]> {
  const list = await (await page.request.get(`/api/t/${DESIGN.veiculo}/pecas`)).json();
  const ready = (list.pecas as PieceQueue[]).filter((p) => p.status === "revisao");
  expect(ready.length, "D1 local precisa de posts em revisão (README, Teste local)").toBeGreaterThan(1);
  return ready;
}

type Status = Record<string, unknown> & { versao: number; rodada: number };

/**
 * Opens the review of a real carousel with the decision intercepted: returns the body sent and, after the response,
 * swaps the status (`depois`, over the real status).
 */
async function openWithDecision(page: Page, answer: { status?: number; corpo: unknown; depois?: (real: Status) => Record<string, unknown> }) {
  const piece = (await inReview(page)).find((p) => p.formato === "carrossel")!;
  let sent: Record<string, unknown> | null = null;
  await page.route(`**/api/t/*/pecas/${piece.id}/revisao`, (route) => {
    sent = route.request().postDataJSON();
    return json(route, answer.corpo, answer.status ?? 200);
  });
  await page.route(`**/api/t/*/pecas/${piece.id}/status`, async (route) => {
    const real: Status = await (await route.fetch()).json();
    await json(route, sent && answer.depois ? { ...real, ...answer.depois(real) } : real);
  });
  await page.goto(`/t/${DESIGN.veiculo}/p/${piece.id}`);
  await expect(page.getByRole("img", { name: /^Card 1 de \d+: Capa/ })).toBeVisible();
  return { peca: piece, enviado: () => sent };
}

for (const [view, viewport] of Object.entries(SCREENS)) {
  test.describe(view, () => {
    test.use({ viewport, deviceScaleFactor: view === "celular" ? 2 : 1 });
    const desktop = view === "computador";

    test("To approve → review: carousel, validation, caption, facts and sheet", async ({ page }) => {
      await signIn(page);
      const ready = await inReview(page);
      await page.goto(`/t/${DESIGN.veiculo}/aprovar`);
      await expect(page.getByRole("heading", { level: 1, name: "Para aprovar" })).toBeVisible();
      // No count sentence: the wait is written on each row ("waiting 23 h · ready yesterday, 23:08"), and the whole row is
      // the target (44 px or more).
      await expect(page.getByRole("status").filter({ hasText: /quem espera há mais tempo/ })).toHaveCount(0);
      const lines = page.getByRole("main").getByRole("listitem").getByRole("link");
      await expect(lines).toHaveCount(ready.length);
      await expect(lines.first()).toContainText(/espera há \d+ (min|h|dias) · pronto /);
      expect((await lines.first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await expect(page.locator(".lapis-volta")).toHaveCount(1);
      await expect(page.getByRole("link", { name: /Revisar$/ })).toHaveCount(ready.length - 1);
      await look(page, "aprovar");

      await page.getByRole("link", { name: /Revisar a próxima/ }).click();
      await expect(page).toHaveURL(new RegExp(`/p/${ready[0].id}$`));
      await expect(page.getByRole("button", { name: "Aprovar" })).toBeVisible();
      // One hand mark per screen: the check on Approve (validation's is green, for validation, not for action).
      await expect(page.locator(".lapis-volta")).toHaveCount(0);
      // On mobile the sheet takes the place of the bottom navigation.
      if (!desktop) await expect(page.getByRole("navigation", { name: "Seções" })).toHaveCount(0);

      // A carousel of a post with several cards: arrows and dots.
      const carousel = ready.find((p) => p.formato === "carrossel")!;
      await page.goto(`/t/${DESIGN.veiculo}/p/${carousel.id}`);
      const n = carousel.ncards ?? 4;
      await expect(page.getByRole("img", { name: new RegExp(`^Card 1 de ${n}: Capa`) })).toBeVisible();
      await expect(page.getByText(`1 / ${n} · Capa`)).toBeVisible();
      await look(page, "revisao");
      await expect(page.getByRole("button", { name: "Card anterior" })).toBeDisabled();
      await page.getByRole("button", { name: "Próximo card" }).click();
      await expect(page.getByText(new RegExp(`^2 / ${n} · `))).toBeVisible();
      await page.getByRole("button", { name: new RegExp(`^Card ${n}:`) }).click();
      await expect(page.getByText(new RegExp(`^${n} / ${n} · `))).toBeVisible();
      await expect(page.getByRole("button", { name: "Próximo card" })).toBeDisabled();

      // "Validation ok" opens the checks; the whole caption; facts with the source's link.
      await page.getByText("Validação ok").click();
      await expect(page.getByText("Cada frase dos cards aponta para um fato da fonte.")).toBeVisible();
      await page.getByRole("button", { name: "ver inteira" }).click();
      await expect(page.getByRole("button", { name: "ver menos" })).toHaveAttribute("aria-expanded", "true");
      // Round 4: "Sentences and sources" takes the place of "Facts used": each sentence with its source, in view.
      await expect(page.getByRole("heading", { name: "Frases e fontes" })).toBeVisible();
      const source = page.getByRole("link", { name: /\(abre em outra aba\)$/ }).first();
      await expect(source).toHaveAttribute("href", /^https?:\/\//);
      await expect(source).toHaveAttribute("target", "_blank");
      await look(page, "revisao-detalhes");
    });

    test("approve: account, time only in the future, version sent and the next action", async ({ page }) => {
      await signIn(page);
      const r = await openWithDecision(page, { corpo: { status: "aprovada", modo: "manual" }, depois: () => ({ status: "aprovada" }) });
      // The fixed sentence sits in the desktop decision bar; on mobile the step already states the account and the time.
      if (desktop) await expect(page.getByText(/^Aprovar não publica: o post vai para Prontos para postar/)).toBeVisible();
      await page.getByRole("button", { name: "Aprovar" }).click();
      await expect(page.getByRole("heading", { name: "Aprovar este post" })).toBeFocused();
      const where = page.getByRole("group", { name: "Onde postar" });
      await expect(where.getByRole("radio")).toHaveCount(2);
      await expect(where.getByRole("radio").first()).toBeChecked();
      await page.getByRole("radio", { name: /^Anotar horário · só um lembrete/ }).check();
      await page.getByLabel("Dia e hora").fill("2020-01-01T10:00");
      await page.getByRole("button", { name: "Aprovar" }).click();
      await expect(page.getByText("Escolha um dia e hora daqui para a frente.")).toBeVisible();
      expect(r.enviado(), "horário no passado não envia").toBeNull();
      await page.getByRole("radio", { name: /^Sem horário/ }).check();
      await look(page, "revisao-aprovar");
      if (desktop) {
        // The decision is the bar pinned to the sheet's bottom (DESIGN.md §12): with the step open it grows upwards and stays against the bottom.
        const bar = (await page.getByRole("complementary", { name: "Decisão" }).boundingBox())!;
        expect(Math.abs(bar.y + bar.height - (page.viewportSize()!.height - 8))).toBeLessThanOrEqual(2);
      }

      // Escape goes back to the start and returns focus to the button that opened the step.
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "Aprovar" })).toBeFocused();
      await page.getByRole("button", { name: "Aprovar" }).click();
      await page.getByRole("button", { name: "Aprovar" }).click();
      await expect(page.getByRole("heading", { name: "Aprovado" })).toBeVisible();
      expect(r.enviado()).toEqual({ decisao: "aprovar", contaId: "c-bng-ig-manual", versao: expect.any(Number) });
      await expect(page.getByRole("link", { name: "Revisar a próxima" })).toBeVisible();
      // The next post, on another version, does not inherit this one's seen version: no new-version warning.
      await page.route(new RegExp(`/api/t/[^/]+/pecas/(?!${r.peca.id})[^/]+/status$`), async (route) => {
        const real: Status = await (await route.fetch()).json();
        await json(route, { ...real, versao: real.versao + 3 });
      });
      await page.getByRole("link", { name: "Revisar a próxima" }).click();
      await expect(page.getByRole("button", { name: "Aprovar" })).toBeVisible();
      await expect(page.getByText(/^Chegou a versão/)).toHaveCount(0);
      await page.goBack();
      // Phase F: approved, the post belongs to Ready to post (the screen is the publish one) and the way back leads there.
      await expect(page.getByRole("heading", { name: /^Postar no Instagram/ })).toBeVisible();
      await page.getByRole("main").getByRole("link", { name: "Prontos para postar", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/t/${DESIGN.veiculo}/postar$`));
      await page.goBack();
      if (!desktop) await expect(page.getByRole("navigation", { name: "Seções" })).toBeVisible();
      await look(page, "revisao-aprovado");
    });

    test("rewrite: optional instruction, version n of 3, back to progress", async ({ page }) => {
      await signIn(page);
      const r = await openWithDecision(page, {
        corpo: { status: "rascunho", rodada: 2 },
        depois: () => ({ status: "rascunho", rodada: 2, etapa: "redigir", tentativa: 1, iniciada_em: null }),
      });
      await page.getByRole("button", { name: "Reescrever" }).click();
      await expect(page.getByRole("heading", { name: /^Reescrever/ })).toContainText("versão 2 de 3");
      await page.getByLabel(/O que mudar\?/).fill("manchete mais curta");
      await look(page, "revisao-reescrever");
      await page.getByRole("button", { name: "Reescrever" }).click();
      await expect(page.getByRole("heading", { name: /^Produzindo/ })).toBeVisible();
      expect(r.enviado()).toEqual({ decisao: "reescrever", instrucao: "manchete mais curta", versao: expect.any(Number) });
    });

    test("reject asks for a reason; conflict becomes a plain sentence", async ({ page }) => {
      await signIn(page);
      const r = await openWithDecision(page, { status: 409, corpo: { erro: "peça na versão 2, não na 1" } });
      await page.getByRole("button", { name: "Rejeitar" }).click();
      const reason = page.getByLabel("Por quê?");
      await expect(reason).toBeFocused();
      await page.getByRole("button", { name: "Rejeitar" }).click();
      await expect(page.getByText("Escreva o motivo (uma frase basta).")).toBeVisible();
      await expect(reason).toHaveAttribute("aria-invalid", "true");
      expect(r.enviado()).toBeNull();
      await reason.fill("notícia velha");
      await page.getByRole("button", { name: "Rejeitar" }).click();
      await expect(page.getByRole("alert")).toContainText("Este post mudou enquanto você olhava");
      expect(r.enviado()).toEqual({ decisao: "rejeitar", motivo: "notícia velha", versao: expect.any(Number) });
      await look(page, "revisao-rejeitar-conflito");
    });

    test("rejected: the result and the next action", async ({ page }) => {
      await signIn(page);
      await openWithDecision(page, { corpo: { status: "rejeitada" }, depois: () => ({ status: "rejeitada" }) });
      await page.getByRole("button", { name: "Rejeitar" }).click();
      await page.getByLabel("Por quê?").fill("fora da nossa área");
      await page.getByRole("button", { name: "Rejeitar" }).click();
      await expect(page.getByRole("heading", { name: "Rejeitado" })).toBeVisible();
      await expect(page.getByText("A ideia saiu da lista.")).toBeVisible();
    });

    test("loading, error and empty: review and To approve", async ({ page }) => {
      await signIn(page);
      const piece = (await inReview(page))[0];
      await page.route(`**/api/t/*/pecas/${piece.id}`, () => new Promise<void>(() => {}));
      await page.goto(`/t/${DESIGN.veiculo}/p/${piece.id}`);
      await expect(page.getByRole("status").filter({ hasText: "Carregando o post" })).toBeAttached();
      await look(page, "revisao-carga");
      await page.unrouteAll({ behavior: "ignoreErrors" });

      await page.route(`**/api/t/*/pecas/${piece.id}`, (route) => route.fulfill(ERROR_500));
      await page.reload();
      await expect(page.getByRole("alert")).toContainText("Não carregou o post.");
      // The headline (from the light status) stays in view: the failure is only of the images and the full text.
      await expect(page.getByRole("heading", { level: 1 })).not.toBeEmpty();
      await look(page, "revisao-erro");
      await page.unrouteAll();
      await page.getByRole("button", { name: "Tentar de novo" }).click();
      await expect(page.getByRole("button", { name: "Aprovar" })).toBeVisible();

      await page.route("**/api/t/*/pecas?*", () => new Promise<void>(() => {}));
      await page.goto(`/t/${DESIGN.veiculo}/aprovar`);
      await expect(page.getByRole("status").filter({ hasText: "Carregando os posts" })).toBeAttached();
      await look(page, "aprovar-carga");
      await page.unrouteAll({ behavior: "ignoreErrors" });

      await page.route("**/api/t/*/pecas?*", (route) => route.fulfill(ERROR_500));
      await page.reload();
      await expect(page.getByRole("alert").filter({ hasText: "Não carregou os posts para aprovar." })).toBeVisible();
      await look(page, "aprovar-erro");
      await page.unrouteAll();

      await page.route("**/api/t/*/pecas?*", (route) =>
        json(route, { pecas: [], total: { rascunho: 1, revisao: 0 }, prontasDesde: 0 }));
      await page.reload();
      await expect(page.getByText("Nada esperando a sua aprovação.")).toBeVisible();
      await expect(page.getByText(/^1 post está sendo produzido/)).toBeVisible();
      await expect(page.getByRole("link", { name: "Ver as ideias" })).toBeVisible();
      await look(page, "aprovar-vazio");
    });
  });
}

test.describe("tablet", () => {
  test.use({ viewport: { width: 820, height: 1180 } });

  test("carousel reaches the last card even with several in view", async ({ page }) => {
    await signIn(page);
    const carousel = (await inReview(page)).find((p) => p.formato === "carrossel")!;
    const n = carousel.ncards ?? 4;
    await page.goto(`/t/${DESIGN.veiculo}/p/${carousel.id}`);
    await expect(page.getByText(`1 / ${n} · Capa`)).toBeVisible();
    await page.getByRole("button", { name: new RegExp(`^Card ${n}:`) }).click();
    await expect(page.getByText(new RegExp(`^${n} / ${n} · `))).toBeVisible();
    await expect(page.getByRole("button", { name: "Próximo card" })).toBeDisabled();
    await page.getByRole("button", { name: "Card anterior" }).click();
    await expect(page.getByText(new RegExp(`^${n - 1} / ${n} · `))).toBeVisible();
    await page.getByRole("button", { name: "Próximo card" }).click();
    await expect(page.getByText(new RegExp(`^${n} / ${n} · `))).toBeVisible();
    await page.getByRole("button", { name: "Card 1:" , exact: false }).first().click();
    await expect(page.getByText(`1 / ${n} · Capa`)).toBeVisible();
  });

  test("conflict with a new version: the review restarts and warns", async ({ page }) => {
    await signIn(page);
    await openWithDecision(page, {
      status: 409, corpo: { erro: "peça na versão 9, não na 1" },
      depois: (real) => ({ versao: real.versao + 1, rodada: real.rodada + 1 }),
    });
    await page.getByRole("button", { name: "Rejeitar" }).click();
    await page.getByLabel("Por quê?").fill("notícia velha");
    await page.getByRole("button", { name: "Rejeitar" }).click();
    await expect(page.getByRole("status").filter({ hasText: /^Chegou a versão 2 deste post/ })).toBeVisible();
    await expect(page.getByLabel("Por quê?")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Aprovar" })).toBeVisible();
  });
});
