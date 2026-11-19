// Phase 3: the customisable carousel. Against `wrangler dev` with the seeded local D1 (README, Local testing). The piece
// is a real carousel in review; the photo upload goes to the real Worker (local R2), and the edit (PUT cards) is
// simulated on the browser's route because the local Worker does not reach Browser Rendering: the response follows the
// check's rules (a number outside the facts fails) and the following piece (status and GET) now has the cards sent.
// Axe 0. Screenshots in design/telas/carrossel/.
import { expect, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { part } from "./parts";
import { goDownModel, uploadModel } from "./fake-model";

const PRINTS = "design/telas/carrossel";
const SCREENS = { celular: { width: 390, height: 844 }, computador: { width: 1440, height: 900 } } as const;
const DESIGN = { email: "design@redacao.dev", senha: "senha-forte-123", veiculo: "portal-litoral" };
// A valid 1×1 PNG (the API checks the signature).
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

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

async function signIn(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(DESIGN.email);
  await page.getByLabel("Senha").fill(DESIGN.senha);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  // Sign-in lands on the first outlet by name, which depends on what other specs created: open this one.
  await expect(page).toHaveURL(/\/t\/[^/]+$/);
  await page.goto(`/t/${DESIGN.veiculo}`);
}

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

type CardSent = { id: string; layout: string; titulo: string; frases: { texto: string; fatoId: string | null; autor?: boolean }[]; imagem: string | null };

/**
 * A real carousel in review with the edit simulated. The simulation's "check": a number that is not in the facts fails
 * the card (it is src/lib/validation.ts's rule, really covered in test/carousel.test.ts).
 */
async function openCarousel(page: Page) {
  const list = await (await page.request.get(`/api/t/${DESIGN.veiculo}/pecas`)).json();
  const piece = (list.pecas as { id: string; status: string; formato: string }[]).find((p) => p.status === "revisao" && p.formato === "carrossel");
  expect(piece, "D1 local precisa de um carrossel em revisão (README, Teste local)").toBeTruthy();
  const id = piece!.id;
  const real = await (await page.request.get(`/api/t/${DESIGN.veiculo}/pecas/${id}`)).json();
  const facts = (real.fatos as { texto: string }[]).map((f) => f.texto).join(" ");
  const yes = { versao: real.peca.versao as number, cards: null as CardSent[] | null, validacao: null as unknown, status: "revisao", envios: [] as { versao: number; cards: CardSent[] }[], decisao: null as unknown };

  await page.route(`**/api/t/*/pecas/${id}/cards`, async (route) => {
    const body = route.request().postDataJSON() as { versao: number; cards: CardSent[] };
    yes.envios.push(body);
    if (body.versao !== yes.versao) return json(route, { erro: "outra pessoa salvou este post antes; abra de novo" }, 409);
    const perCard: Record<string, string[]> = {};
    for (const c of body.cards) {
      if (c.titulo.length > 90) (perCard[c.id] ??= []).push("O texto não cabe no card. Encurte o título ou as frases.");
      for (const n of [c.titulo, ...c.frases.map((f) => f.texto)].join(" ").match(/\b\d+\b/g) ?? []) {
        if (!facts.includes(n)) (perCard[c.id] ??= []).push(`O número ${n} não aparece em nenhum fato da fonte.`);
      }
    }
    const ok = !Object.keys(perCard).length;
    yes.versao += 1;
    yes.cards = body.cards;
    yes.validacao = ok ? { ok, erros: [], avisos: [] } : { ok, erros: ["número fora dos fatos"], avisos: [], porCard: perCard };
    return json(route, { versao: yes.versao, validacao: yes.validacao, renderizados: ok ? [body.cards[0].id] : [], reaproveitados: [] });
  });
  await page.route(`**/api/t/*/pecas/${id}/status`, async (route) => {
    const s = await (await route.fetch()).json();
    await json(route, { ...s, versao: yes.versao, status: yes.status });
  });
  await page.route(new RegExp(`/api/t/[^/]+/pecas/${id}$`), async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const p = await (await route.fetch()).json();
    await json(route, yes.cards ? { ...p, peca: { ...p.peca, versao: yes.versao, conteudo: { ...p.peca.conteudo, cards: yes.cards }, validacao: yes.validacao } } : p);
  });
  await page.route(`**/api/t/*/pecas/${id}/revisao`, async (route) => {
    yes.decisao = route.request().postDataJSON();
    yes.status = "aprovada";
    return json(route, { status: "aprovada", modo: "manual" });
  });
  await page.goto(`/t/${DESIGN.veiculo}/p/${id}`);
  await expect(page.getByRole("img", { name: /^Card 1 (de|of) \d+: / })).toBeVisible();
  return { id, sim: yes };
}

test.beforeAll(uploadModel);
test.afterAll(goDownModel);

for (const [view, viewport] of Object.entries(SCREENS)) {
  test.describe(view, () => {
    test.use({ viewport, deviceScaleFactor: view === "celular" ? 2 : 1 });

    test("edit the sentence, see the check error and Approve stays stopped; fix, change layout, reorder, upload photo and approve", async ({ page }) => {
      await signIn(page);
      const { sim: yes } = await openCarousel(page);
      await page.getByRole("button", { name: "Editar os cards" }).click();
      await expect(page).toHaveURL(/editar=1/);
      await expect(page.getByRole("heading", { name: "Editar os cards" })).toBeVisible();
      const list = page.getByRole("list", { name: "Cards do post" });
      const n = await list.getByRole("listitem").count();
      expect(n).toBeGreaterThanOrEqual(3);
      await expect(page.getByRole("button", { name: "Salvar e conferir" })).toBeDisabled();
      // The proof and Save in view; the tools only on the current card.
      await expect(page.locator('iframe[title="Prévia do card 1"]')).toBeInViewport();
      await expect(page.getByRole("button", { name: "Salvar e conferir" })).toBeInViewport();
      await expect(page.getByRole("button", { name: "Subir o card 2" })).toHaveCount(0);
      await look(page, "editar");

      // Card 2: the sentence with a number that is not in the source.
      await list.getByRole("listitem").nth(1).getByRole("button").first().click();
      await expect(page.getByRole("heading", { name: /^Card 2 · / })).toBeVisible();
      const sentence = page.getByRole("textbox", { name: /^(Frase|Item|Fala) 1$/ });
      await sentence.fill("A ponte fica fechada por 40 dias.");
      await expect(page.locator('iframe[title="Prévia do card 2"]')).toHaveAttribute("srcdoc", /40 dias/);
      await page.getByRole("button", { name: "Salvar e conferir" }).click();
      const error = page.getByRole("alert").filter({ hasText: "A conferência apontou" });
      await expect(error).toContainText("O número 40 não aparece em nenhum fato da fonte.");
      await expect(list.getByText("corrigir")).toHaveCount(1);
      await look(page, "editar-erro");

      // Outside editing: the error on the card and Approve held, with the reason beside it.
      await page.getByRole("button", { name: "Fechar a edição" }).click();
      await expect(page.getByText(/^Card 2 \(.+\): O número 40 não aparece/)).toBeVisible();
      await expect(page.getByRole("button", { name: "Aprovar" })).toBeDisabled();
      await expect(page.getByText("Aprovar espera: corrija os cards que a conferência apontou e salve de novo.")).toBeVisible();
      await look(page, "revisao-bloqueada");

      // Fix, change card 3's layout, move card 3 up (it becomes 2) and put a photo on it.
      await page.getByRole("button", { name: "Corrigir nos cards" }).click();
      await expect(page.getByRole("heading", { name: /^Card 2 · / })).toBeVisible();
      await page.getByRole("textbox", { name: /^(Frase|Item|Fala) 1$/ }).fill("A ponte fica fechada para obras.");
      await list.getByRole("listitem").nth(2).getByRole("button").first().click();
      await expect(page).toHaveURL(/[?&]card=/);
      await part(page, "Tipo do card");
      await page.getByRole("radio", { name: "Citação" }).check();
      await expect(page.getByRole("heading", { name: "Card 3 · Citação" })).toBeVisible();
      await expect(page.locator('iframe[title="Prévia do card 3"]')).toHaveAttribute("srcdoc", /class="card quote/);
      await page.getByRole("button", { name: "Subir o card 3" }).click();
      await expect(page.getByRole("heading", { name: "Card 2 · Citação" })).toBeVisible();
      await part(page, "Imagem do card");
      await page.getByLabel("Foto própria").setInputFiles({ name: "foto.png", mimeType: "image/png", buffer: PNG });
      // A new photo without saying who took it: Save waits.
      await expect(page.getByRole("button", { name: "Salvar e conferir" })).toBeDisabled();
      await expect(page.getByText("Diga quem fez a foto do card 2.")).toBeVisible();
      await page.getByLabel("Quem fez a foto").fill("Ana Costa");
      await page.getByLabel("De quem é o direito").selectOption("equipe");
      await page.getByRole("radio", { name: "Topo" }).check();
      await expect(page.locator('iframe[title="Prévia do card 2"]')).toHaveAttribute("srcdoc", /object-position: 50% 0%/);
      await expect(list.getByRole("listitem").nth(1)).toContainText("foto própria");
      await expect(page.locator('iframe[title="Prévia do card 2"]')).toHaveAttribute("srcdoc", /class="card quote photo/);
      await look(page, "editar-foto");
      await page.getByRole("button", { name: "Salvar e conferir" }).click();
      await expect(page.getByRole("heading", { name: "Editar os cards" })).toHaveCount(0);

      const last = yes.envios.at(-1)!;
      expect(last.versao).toBe(yes.versao - 1);
      expect(last.cards[1]).toMatchObject({ layout: "citacao", imagem: expect.stringMatching(/^fotos\/portal-litoral\//), foco: "topo", fotoOrigem: { autor: "Ana Costa", tipo: "equipe" } });
      expect(last.cards.at(-1)!.layout).toBe("convite");
      // Saving one's own edit does not become "someone else edited".
      await expect(page.getByText(/^Outra pessoa editou/)).toHaveCount(0);
      await expect(page.getByText("Validação ok")).toBeVisible();

      await page.getByRole("button", { name: "Aprovar" }).click();
      await page.getByRole("button", { name: "Aprovar" }).click();
      await expect(page.getByRole("heading", { name: "Aprovado" })).toBeVisible();
      expect(yes.decisao).toMatchObject({ decisao: "aprovar", versao: yes.versao });
    });

    test("cover: see other headlines, the one that invents a number disappears; using it swaps the title and the headline goes into the save", async ({ page }) => {
      await signIn(page);
      const { sim: yes } = await openCarousel(page);
      await page.getByRole("button", { name: "Editar os cards" }).click();
      await page.getByRole("button", { name: "Ver outras manchetes" }).click();
      const list = page.getByRole("list", { name: "Manchetes conferidas" });
      await expect(list.getByRole("listitem").first()).toBeVisible();
      await expect(list).not.toContainText("9871");
      await look(page, "outras-manchetes");
      const title = (await list.getByRole("listitem").first().locator("b").textContent())!;
      await list.getByRole("button").first().click();
      await expect(page.getByRole("textbox", { name: /^Título/ })).toHaveValue(title);
      await page.getByRole("button", { name: "Salvar e conferir" }).click();
      await expect(page.getByRole("heading", { name: "Editar os cards" })).toHaveCount(0);
      expect(yes.envios.at(-1)).toMatchObject({ manchete: title });
      expect(yes.envios.at(-1)!.cards[0].titulo).toBe(title);
      // The status query in progress must not drop at the end of the test, with the page already closed.
      await page.unrouteAll({ behavior: "ignoreErrors" });
    });

    test("sentence: shortening to fit brings a checked version, the one that invents disappears, and using it only swaps the field", async ({ page }) => {
      await signIn(page);
      const { sim: yes } = await openCarousel(page);
      await page.getByRole("button", { name: "Editar os cards" }).click();
      await page.getByRole("list", { name: "Cards do post" }).getByRole("listitem").nth(1).getByRole("button").first().click();
      await expect(page.getByRole("heading", { name: /^Card 2 · / })).toBeVisible();
      const before = yes.envios.length;
      await page.getByRole("button", { name: "Encurtar para caber" }).first().click();
      const list = page.getByRole("list", { name: "Versões conferidas" });
      await expect(list.getByRole("listitem").first()).toBeVisible();
      await expect(list).not.toContainText("9871");
      await look(page, "encurtar");
      const text = (await list.getByRole("listitem").first().locator("span").first().textContent())!;
      await list.getByRole("button").first().click();
      await expect(page.getByRole("textbox", { name: /^(Frase|Item|Fala) 1$/ })).toHaveValue(text);
      expect(yes.envios.length).toBe(before);

      // The card comes back with "does not fit": the title gets the same button.
      const buttons = page.getByRole("button", { name: "Encurtar para caber" });
      const perSentence = await buttons.count();
      await page.getByRole("textbox", { name: /^Título/ }).fill("Título longo demais para este card ".repeat(3));
      await page.getByRole("button", { name: "Salvar e conferir" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "A conferência apontou" })).toBeVisible();
      await expect(buttons).toHaveCount(perSentence + 1);
      await page.unrouteAll({ behavior: "ignoreErrors" });
    });

    test("proof cards: comparison asks for a label and a value, timeline asks for a date, document shows the passage", async ({ page }) => {
      await signIn(page);
      const { sim: yes } = await openCarousel(page);
      await page.getByRole("button", { name: "Editar os cards" }).click();
      await page.getByRole("list", { name: "Cards do post" }).getByRole("listitem").nth(1).getByRole("button").first().click();
      await part(page, "Tipo do card");
      await page.getByRole("radio", { name: "Comparação" }).check();
      await expect(page.getByLabel("Rótulo 1")).toBeVisible();
      await page.getByLabel("Rótulo 1").fill("Antes");
      await page.getByRole("textbox", { name: /^(Lado|Valor) 1$/ }).fill("Texto do primeiro lado");
      await look(page, "prova-comparacao");
      await page.getByRole("radio", { name: "Linha do tempo" }).check();
      await expect(page.getByLabel("Data 1")).toHaveValue("Antes");
      await page.getByRole("radio", { name: "Documento" }).check();
      await expect(page.getByLabel("Data 1")).toHaveCount(0);
      await expect(page.getByRole("textbox", { name: "Trecho 1" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Encurtar para caber" })).toHaveCount(0);
      await look(page, "prova-documento");
      await page.getByRole("radio", { name: "Comparação" }).check();
      await page.getByRole("button", { name: "Salvar e conferir" }).click();
      await expect.poll(() => yes.envios.at(-1)?.cards[1].layout).toBe("comparacao");
      await page.unrouteAll({ behavior: "ignoreErrors" });
    });

    test("another illustration: generated for the card, shown in the preview, saved, and the post's own comes back", async ({ page }) => {
      await signIn(page);
      const { sim: yes, id } = await openCarousel(page);
      // The image generator does not run in the local Worker: the route is simulated, and its rule is in test/technique.test.ts.
      const key = `artes/${DESIGN.veiculo}/${id}/cards/c/um`;
      let remaining = 2;
      await page.route(`**/api/t/*/pecas/${id}/cards/*/ilustracao`, (route) => json(route, { chave: key, url: `data:image/png;base64,${PNG.toString("base64")}`, restantes: remaining--, custoUsd: 0.02 }));
      await page.getByRole("button", { name: "Editar os cards" }).click();
      await page.getByRole("list", { name: "Cards do post" }).getByRole("listitem").nth(1).getByRole("button").first().click();
      await part(page, "Imagem do card");
      await expect(page.getByText("Até 3 por card. A escolhida vale depois de salvar.")).toBeVisible();
      await page.getByRole("button", { name: "Outra ilustração" }).click();
      await expect(page.getByText("Pode pedir mais 2 para este card.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Voltar à do post" })).toBeVisible();
      await look(page, "outra-ilustracao");
      await page.getByRole("button", { name: "Voltar à do post" }).click();
      await expect(page.getByRole("button", { name: "Voltar à do post" })).toHaveCount(0);
      await part(page, "Tipo do card");
      await page.getByRole("radio", { name: "Documento" }).check();
      await part(page, "Imagem do card");
      await expect(page.getByRole("button", { name: "Outra ilustração" })).toHaveCount(0);
      await part(page, "Tipo do card");
      await page.getByRole("radio", { name: "Texto" }).check();
      await part(page, "Imagem do card");
      await page.getByRole("button", { name: "Outra ilustração" }).click();
      await expect(page.getByText("Pode pedir mais 1 para este card.")).toBeVisible();
      await page.getByRole("button", { name: "Salvar e conferir" }).click();
      await expect.poll(() => (yes.envios.at(-1)?.cards[1] as { ilustracao?: string } | undefined)?.ilustracao).toBe(key);
      await page.unrouteAll({ behavior: "ignoreErrors" });
    });

    test("in English: a phone JPEG is shrunk before upload, an unreadable file gets a clear message", async ({ page }) => {
      await signIn(page);
      await page.request.put("/api/me/idioma", { data: { idioma: "en" }, headers: { origin: "http://localhost:8787" } });
      try {
        await openCarousel(page);
        await page.getByRole("button", { name: "Edit the cards" }).click();
        await page.getByRole("button", { name: "See other headlines" }).click();
        await expect(page.getByRole("list", { name: "Checked headlines" }).getByRole("button").first()).toBeVisible();
        await page.getByRole("list", { name: "Post cards" }).getByRole("listitem").nth(1).getByRole("button").first().click();
        await page.getByRole("button", { name: "Shorten to fit" }).first().click();
        await expect(page.getByRole("list", { name: "Checked versions" }).getByRole("button").first()).toBeVisible();
        await part(page, "Card image");
        await expect(page.getByRole("button", { name: "Another illustration" })).toBeVisible();
        await part(page, "Card type");
        await page.getByRole("radio", { name: "Timeline" }).check();
        await expect(page.getByLabel("Date 1")).toBeVisible();
        await page.getByRole("radio", { name: "Document" }).check();
        await expect(page.getByRole("textbox", { name: "Passage 1" })).toBeVisible();
        await part(page, "Card image");
        const photo = page.getByLabel("Own photo");
        await photo.setInputFiles({ name: "foto.heic", mimeType: "image/heic", buffer: Buffer.from("isto nao e imagem") });
        await expect(page.getByText("The browser couldn't open that file. Send it as JPEG or PNG.")).toBeVisible();
        // A 3000 px JPEG, like a phone's.
        const jpeg = await page.evaluate(async () => {
          const c = new OffscreenCanvas(3000, 2000);
          const g = c.getContext("2d")!;
          for (let i = 0; i < 400; i++) { g.fillStyle = `hsl(${i} 70% 50%)`; g.fillRect((i * 37) % 3000, (i * 53) % 2000, 300, 300); }
          const b = await c.convertToBlob({ type: "image/jpeg", quality: 1 });
          return [...new Uint8Array(await b.arrayBuffer())];
        });
        const upload = page.waitForRequest((r) => r.url().endsWith("/fotos") && r.method() === "POST");
        await photo.setInputFiles({ name: "IMG_0001.jpg", mimeType: "image/jpeg", buffer: Buffer.from(jpeg) });
        const request = await upload;
        expect(request.headers()["content-type"]).toBe("image/jpeg");
        const side = await page.evaluate(async (b) => {
          const i = await createImageBitmap(new Blob([new Uint8Array(b)], { type: "image/jpeg" }));
          return Math.max(i.width, i.height);
        }, [...request.postDataBuffer()!]);
        expect(side).toBe(1620);
        await expect(page.getByLabel("Who took the photo")).toBeVisible();
        await expect(page.getByRole("button", { name: "Save and check" })).toBeDisabled();
      } finally {
        await page.request.put("/api/me/idioma", { data: { idioma: "pt-BR" }, headers: { origin: "http://localhost:8787" } }).catch(() => {});
      }
    });

    test("moving the card keeps the card open; a larger preview does not push Save out of view", async ({ page }) => {
      await signIn(page);
      await openCarousel(page);
      await page.getByRole("button", { name: "Editar os cards" }).click();
      const field = page.locator("#ed-titulo-card");
      const before = await field.inputValue();
      await page.getByRole("button", { name: "Descer o card 1" }).click();
      await expect(page).toHaveURL(/[?&]card=/);
      await expect(field).toHaveValue(before);
      if (view === "celular") {
        await page.getByRole("button", { name: "Prévia maior" }).click();
        const save = (await page.getByRole("button", { name: "Salvar e conferir" }).boundingBox())!;
        expect(save.x + save.width).toBeLessThanOrEqual(390);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      }
    });

    test("Brand: changing the font pair changes the preview and goes into the save", async ({ page }) => {
      await signIn(page);
      await page.goto(`/t/${DESIGN.veiculo}/veiculo?aba=marca&secao=nome`);
      const preview = page.locator('iframe[title="Prévia do card com a marca escolhida"]').first();
      await expect(preview).toHaveAttribute("srcdoc", /nunito-latin/);
      await part(page, "Letra e idioma");
      const sources = page.getByRole("group", { name: "Fontes do card" });
      await expect(sources.getByRole("radio", { name: /^Nunito e Quicksand/ })).toBeChecked();
      await sources.getByRole("radio", { name: /^Source Serif e Source Sans/ }).check();
      await expect(preview).toHaveAttribute("srcdoc", /source-serif-4-latin/);
      await expect(preview).toHaveAttribute("srcdoc", /class="card cover titulo-destaque"/);
      await look(page, "marca-fontes");
      let sent: Record<string, unknown> | null = null;
      await page.route(`**/api/t/*/marca`, async (route) => {
        if (route.request().method() !== "PATCH") return route.continue();
        sent = route.request().postDataJSON();
        await route.continue();
      });
      try {
        await page.getByRole("button", { name: "Salvar a marca" }).click();
        await expect.poll(() => sent).toMatchObject({ fontes: "jornal" });
        await expect(page.getByText(/^Alterações não salvas/)).toHaveCount(0);
        await page.reload();
        await part(page, "Letra e idioma");
        await expect(page.getByRole("group", { name: "Fontes do card" }).getByRole("radio", { name: /^Source Serif e Source Sans/ })).toBeChecked();
      } finally {
        // The test outlet goes back to the default pair.
        await page.request.patch(`/api/t/${DESIGN.veiculo}/marca`, { data: { fontes: "padrao" }, headers: { origin: "http://localhost:8787" } });
      }
    });

    test("someone else saves while this one edits: what was typed stays, the warning appears and saving is refused", async ({ page }) => {
      await signIn(page);
      const { sim: yes } = await openCarousel(page);
      await page.getByRole("button", { name: "Editar os cards" }).click();
      const list = page.getByRole("list", { name: "Cards do post" });
      await list.getByRole("listitem").nth(1).getByRole("button").first().click();
      const sentence = page.getByRole("textbox", { name: /^(Frase|Item|Fala) 1$/ });
      await sentence.fill("A ponte fica fechada para obras de recuperação.");
      // Someone else saved: the follow-up sees the new version (returning to the tab forces the query).
      yes.versao += 1;
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await expect(page.getByRole("alert").filter({ hasText: "Outra pessoa salvou uma versão nova" })).toBeVisible({ timeout: 25_000 });
      await expect(sentence).toHaveValue("A ponte fica fechada para obras de recuperação.");
      await look(page, "editar-outra-versao");
      await page.getByRole("button", { name: "Salvar e conferir" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "Outra pessoa salvou este post antes de você." })).toBeVisible();
      expect(yes.envios.at(-1)!.versao).toBe(yes.versao - 1);
      await page.getByRole("button", { name: "Abrir a versão nova" }).first().click();
      await expect(page.getByRole("alert").filter({ hasText: "Outra pessoa salvou" })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Editar os cards" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Salvar e conferir" })).toBeDisabled();
    });
  });
}
