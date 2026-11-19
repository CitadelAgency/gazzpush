// The blue-pencil reviewer: the note that appears on leaving the paragraph, the one that gets struck through, the source
// that lights up the text, the recording's speech, the closed-proof stamp, the switch and the reporter, at 390 and 1440 px,
// in Portuguese and English. Screenshots in design/telas/revisor/.
// The local Worker does not read a fictional page: "add link" is answered here, with real evidence in the local D1 and
// R2, and the check that comes after is the real one, by streaming, against the fake model.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import { fakeWav } from "../../test/fake-audio";
import { callsModel, goDownModel, SPEECH_RECORDED, uploadModel, resetCalls } from "./fake-model";
import { ORIGIN_E2_AND } from "./origin";

const PRINTS = "design/telas/revisor";
const OUTLET = "cartas-da-orla";
const ORIGIN = { origin: ORIGIN_E2_AND };
const DESIGN = { email: "design@redacao.dev", senha: "senha-forte-123" };
const REPORTER = { email: "reporter@redacao.dev", senha: "senha-forte-123" };
const SCREENS = { celular: { width: 390, height: 844 }, computador: { width: 1440, height: 900 } } as const;
const TEXTS = {
  "pt-BR": {
    numero: "Quem disse esse número?", link: "Tem o link? Cole no Dossiê.", isso: "Quem disse isso?", carimbo: "Pode publicar", notas: "Notas", conferido: /^conferido$/, adicionar: "Adicionar ao dossiê?", botaoAdicionar: "Adicionar",
    ignorar: "Ignorar", comEvidencia: "com evidência:", semFonte: "sem fonte:", bateGravacao: "bate com a gravação:", acrescentar: "Acrescentar link", botaoAcrescentar: "Acrescentar", marcas: "Partes do painel", gravacoes: /^Gravações/, regiaoGrav: "Gravações", transcrito: /de áudio · transcrito/,
    foco: "Foco", painel: "Marcas e dossiê", fechar: "Fechar",
  },
  en: {
    numero: "Who gave this number?", link: "Got the link? Paste it in the Dossier.", isso: "Who said this?", carimbo: "Ready to publish", notas: "Notes", conferido: /^checked$/, adicionar: "Add to the dossier?", botaoAdicionar: "Add",
    ignorar: "Ignore", comEvidencia: "with evidence:", semFonte: "no source:", bateGravacao: "matches the recording:", acrescentar: "Add link", botaoAcrescentar: "Add", marcas: "Panel sections", gravacoes: /^Recordings/, regiaoGrav: "Recordings", transcrito: /of audio · transcribed/,
    foco: "Focus", painel: "Marks and dossier", fechar: "Close",
  },
} as const;
const SENTENCE = "A obra da orla custou R$ 40 milhões em 2025";
const SOURCE = { url: "https://prefeitura.example/obras", titulo: "Balanço de obras", texto: "Balanço de obras\n\nA obra da orla custou R$ 40 milhões em 2025, segundo o balanço da prefeitura. O documento lista as empresas." };
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

function sql(command: string) {
  const file = "test-results/revisor.sql";
  writeFileSync(file, command);
  const r = spawnSync(`npx wrangler d1 execute redacao-db --local --file ${file}`, { shell: true, stdio: "ignore" });
  if (r.status !== 0) throw new Error(`sql falhou: ${command.slice(0, 80)}`);
}

test.beforeAll(async () => {
  const r = spawnSync("npx wrangler d1 execute redacao-db --local --file seeds/author-local.sql", { shell: true, stdio: "ignore" });
  if (r.status !== 0) throw new Error("seed autoral-local.sql falhou");
  sql(`INSERT OR IGNORE INTO membros (id, tenant_id, user_id, papel) SELECT 'm-cartas-reporter', 'cartas-da-orla', id, 'reporter' FROM "user" WHERE email = '${REPORTER.email}';`);
  await uploadModel();
});
test.afterAll(goDownModel);

async function look(page: Page, label: string, axe = true) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${PRINTS}/${label}-${page.viewportSize()!.width}.png` });
  if (!axe) return;
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).setLegacyMode(true).options({ iframes: false }).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), label).toEqual([]);
}

/** Keeps every note and stamp class that passed across the screen, to prove what animated and what did not. */
const WATCH = () => {
  const seen = new Set<string>();
  (window as unknown as { vistas: Set<string> }).vistas = seen;
  const look = (n: Element) => {
    for (const el of [n, ...n.querySelectorAll("*")]) for (const c of el.classList) if (/^(nota-(nasce|risca|pronta)|carimbo-bate|marca-acende|lapis--desenhar)$/.test(c)) seen.add(c);
  };
  new MutationObserver((ms) => {
    for (const m of ms) {
      if (m.type === "attributes" && m.target instanceof Element) look(m.target);
      for (const n of m.addedNodes) if (n instanceof Element) look(n);
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
};
const seen = (page: Page) => page.evaluate(() => [...(window as unknown as { vistas: Set<string> }).vistas]);
/** Leaves the struck-through note on screen long enough to look at: stretches the clock and the exit, with nothing test-related in the site's code. */
async function holdStruck(page: Page) {
  await page.addInitScript(() => {
    const original = window.setTimeout;
    window.setTimeout = ((f: TimerHandler, ms?: number, ...rest: unknown[]) => original(f, ms === 920 ? 8000 : ms, ...rest)) as typeof window.setTimeout;
    document.addEventListener("DOMContentLoaded", () => {
      const s = document.createElement("style");
      s.textContent = ":root { --nota-saida-atraso: 7s; }";
      document.head.appendChild(s);
    });
  });
}

async function signIn(page: Page, language: "pt-BR" | "en", account = DESIGN) {
  await page.goto("/entrar");
  await page.evaluate((i) => localStorage.setItem("redacao:idioma", i), language);
  await page.reload();
  await page.locator("input[type=email]").fill(account.email);
  await page.locator("input[type=password]").fill(account.senha);
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/t\//);
  await page.request.put("/api/me/idioma", { data: { idioma: language }, headers: ORIGIN });
}
async function createText(page: Page, title: string, paragraphs: string[]) {
  const res = await page.request.post(`/api/t/${OUTLET}/textos`, { data: { titulo: title, texto: paragraphs.join("\n") }, headers: ORIGIN });
  expect(res.status()).toBe(201);
  const id = ((await res.json()) as { texto: { id: string } }).texto.id;
  // A pasted text is born unchecked: here it opens already checked, like that of someone coming back to it.
  const checked = await page.request.post(`/api/t/${OUTLET}/textos/${id}/conferir`, { data: {}, headers: ORIGIN });
  expect(checked.status()).toBe(200);
  return id;
}
const editor = (page: Page) => page.locator(".ProseMirror");
const note = (page: Page, text: string) => page.locator("[data-nota]").filter({ hasText: text }).first();
// Ctrl+End does not move in ProseMirror under Playwright, and Tiptap's focus arrives on the next frame: a key before it is lost.
async function inEnd(page: Page) {
  await expect(editor(page)).toBeVisible();
  await page.evaluate(() => (document.querySelector(".ProseMirror") as unknown as { editor: { commands: { focus: (p: string) => void } } }).editor.commands.focus("end"));
  await expect(editor(page)).toBeFocused();
  await page.waitForTimeout(100);
}
async function launch(page: Page, id: string, extra = "") {
  await page.goto(`/t/${OUTLET}/textos/${id}${extra}`);
  await expect(editor(page)).toBeVisible();
}
const ready = (page: Page, checked: RegExp) => expect(page.locator(".folha-doc-pe").getByRole("status").filter({ hasText: checked })).toBeVisible({ timeout: 20_000 });

/** Real evidence in the local D1 and R2, and the route's response with the text's state. */
async function answerSource(page: Page, id: string) {
  await page.route(`**/api/t/${OUTLET}/textos/${id}/evidencias`, async (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const ev = `rv-${id.slice(0, 8)}`;
    const file = `test-results/${ev}.txt`;
    writeFileSync(file, SOURCE.texto);
    const r = spawnSync(`npx wrangler r2 object put redacao-media/evidencias/${OUTLET}/${ev}.txt --file ${file} --local`, { shell: true, stdio: "ignore" });
    if (r.status !== 0) throw new Error("r2 local");
    sql(`INSERT OR IGNORE INTO evidencias (id, tenant_id, texto_id, url, titulo, r2_texto, hash, hash_atual) VALUES (${q(ev)}, '${OUTLET}', ${q(id)}, ${q(SOURCE.url)}, ${q(SOURCE.titulo)}, ${q(`evidencias/${OUTLET}/${ev}.txt`)}, 'h1', 'h1');`);
    await route.fulfill({ response: await page.request.get(`/api/t/${OUTLET}/textos/${id}`) });
  });
}
async function sendRecording(page: Page, id: string, l: (typeof TEXTS)["pt-BR" | "en"]) {
  await page.goto(`/t/${OUTLET}/textos/${id}?aba=dossie`);
  await page.getByRole("button", { name: l.gravacoes }).click();
  const rec = page.getByRole("region", { name: l.regiaoGrav });
  await rec.locator("input[type=file]").setInputFiles({ name: "entrevista.wav", mimeType: "audio/wav", buffer: Buffer.from(fakeWav(2)) });
  await expect(rec.getByText(l.transcrito)).toBeVisible({ timeout: 30_000 });
}

for (const [view, viewport] of Object.entries(SCREENS)) {
  for (const language of ["pt-BR", "en"] as const) {
    test.describe(`${view} · ${language}`, () => {
      test.use({ viewport, locale: language, deviceScaleFactor: view === "celular" ? 2 : 1 });
      test.afterEach(async ({ page }) => { await page.request.put("/api/me/idioma", { data: { idioma: "pt-BR" }, headers: ORIGIN }).catch(() => {}); });
      const l = TEXTS[language];
      const suffix = language === "en" ? "-en" : "";

      test("the note does not appear in the paragraph with the cursor and appears on leaving it", async ({ page }) => {
        await page.addInitScript(WATCH);
        await signIn(page, language);
        const id = await createText(page, "Revisor cursor", ["A cidade acordou cedo."]);
        await launch(page, id);
        await inEnd(page);
        await page.keyboard.press("Enter");
        await page.keyboard.type(`${SENTENCE}.`);
        await ready(page, l.conferido);
        // The mark is already in the text; the question waits for the person to finish the paragraph.
        await expect(editor(page).locator("[data-marca]").first()).toBeVisible();
        await expect(page.locator("[data-nota]")).toHaveCount(0);
        await page.keyboard.press("Enter");
        await expect(note(page, l.numero)).toBeVisible();
        expect(await seen(page)).toContain("nota-nasce");
        const p = editor(page).locator("p").filter({ hasText: SENTENCE });
        const boxP = (await p.boundingBox())!, boxN = (await note(page, l.numero).boundingBox())!;
        // In the margin, at the paragraph's height; below 1180 px, right below it.
        if (view === "computador") expect(Math.abs(boxN.y - boxP.y)).toBeLessThan(24);
        else expect(boxN.y).toBeGreaterThanOrEqual(boxP.y + boxP.height - 1);
        await page.waitForTimeout(900);
        await expect(page.locator("[data-nota]")).toHaveCount(1);
        await look(page, `nota${suffix}`);
        // In focus mode there is no margin: the note comes right below the paragraph, and clicking it leaves focus and opens the card.
        if (view === "computador") {
          await page.getByRole("button", { name: l.foco, exact: true }).click();
          await expect(page.getByRole("complementary", { name: l.painel })).toHaveCount(0);
          const paragraph = (await p.boundingBox())!;
          expect((await note(page, l.numero).boundingBox())!.y).toBeGreaterThanOrEqual(paragraph.y + paragraph.height - 1);
          await note(page, l.numero).click();
          await expect(page.getByRole("button", { name: l.ignorar, exact: true })).toBeVisible();
        }
        // Opening again: ready, without drawing.
        await page.goto("about:blank");
        await launch(page, id);
        await expect(note(page, l.numero)).toBeVisible();
        const reopened = await seen(page);
        expect(reopened).toContain("nota-pronta");
        expect(reopened).not.toContain("nota-nasce");
      });

      test("the note is struck through: from whoever said that number to the link in the dossier", async ({ page }) => {
        await holdStruck(page);
        await signIn(page, language);
        const id = await createText(page, "Revisor risco", [SENTENCE]);
        await launch(page, id);
        await expect(note(page, l.numero)).toBeVisible();
        const back = page.locator(".acao-lapis .lapis-volta");
        await expect(back).toHaveCount(0);
        await inEnd(page);
        await page.keyboard.type(", segundo o Diário Oficial.");
        // While saving and checking, the note stays in place, even with the mark disappearing from the text.
        await expect(note(page, l.numero)).toBeVisible();
        await expect(page.locator(".nota-risca").filter({ hasText: l.numero })).toBeVisible({ timeout: 20_000 });
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await expect(note(page, l.link)).toBeVisible();
        await expect(page.locator(".nota-risca").filter({ hasText: l.numero })).toBeVisible();
        await page.waitForTimeout(450);
        await look(page, `nota-riscada${suffix}`, false);
        // An attributed sentence without a link stays unsourced: the mark does not change.
        await expect(editor(page).locator(".marca-icone").first()).toContainText(l.semFonte);
      });

      test("pasting a link swaps the sentence to with-evidence and removes the note, without clicking Conferir", async ({ page }) => {
        await holdStruck(page);
        await page.addInitScript(WATCH);
        await signIn(page, language);
        const id = await createText(page, "Revisor fonte", [`${SENTENCE}.`, "Fecha a carta."]);
        await answerSource(page, id);
        await launch(page, id);
        await expect(note(page, l.numero)).toBeVisible();
        await page.waitForTimeout(300);
        resetCalls();
        await inEnd(page);
        await page.evaluate((url) => {
          const dt = new DataTransfer();
          dt.setData("text/plain", url);
          document.querySelector(".ProseMirror")!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
        }, SOURCE.url);
        const offer = page.getByRole("status").filter({ hasText: l.adicionar });
        await offer.getByRole("button", { name: l.botaoAdicionar, exact: true }).click();
        await expect(page.locator(".marca-acende").first()).toBeVisible({ timeout: 20_000 });
        await expect(editor(page).locator(".marca-icone").first()).toContainText(l.comEvidencia);
        await expect(page.locator(".nota-risca").filter({ hasText: l.numero })).toBeVisible();
        await look(page, `fonte-acendendo${suffix}`, false);
        expect(callsModel().some((c) => c.includes(SENTENCE))).toBe(true);
        await expect(page.locator(".nota-pronta,.nota-nasce")).toHaveCount(0);
        expect(await seen(page)).toContain("marca-acende");
      });

      test("in the Dossier tab, without the editor, the new source checks and updates without animation; if it fails, the link stays", async ({ page }) => {
        await signIn(page, language);
        const id = await createText(page, "Revisor dossiê", [`${SENTENCE}.`]);
        await answerSource(page, id);
        await page.goto(`/t/${OUTLET}/textos/${id}?aba=dossie&parte=dossie`);
        await page.getByLabel(l.acrescentar).fill(SOURCE.url);
        // First the check drops: the error appears and the link is saved.
        await page.route(`**/api/t/${OUTLET}/textos/${id}/conferir`, (r) => r.fulfill({ status: 503, json: { erro: "fora do ar" } }), { times: 1 });
        await page.getByRole("button", { name: l.botaoAcrescentar, exact: true }).click();
        await expect(page.getByRole("alert").filter({ hasText: "fora do ar" })).toBeVisible();
        const state = async () => (await (await page.request.get(`/api/t/${OUTLET}/textos/${id}`)).json()) as { evidencias: unknown[]; afirmacoes: { estado: string }[] };
        expect((await state()).evidencias).toHaveLength(1);
        expect((await state()).afirmacoes[0].estado).toBe("sem_fonte");
        // Then, without failure: adding the same link again checks it.
        await page.getByLabel(l.acrescentar).fill(SOURCE.url);
        await page.getByRole("button", { name: l.botaoAcrescentar, exact: true }).click();
        await expect.poll(async () => (await state()).afirmacoes[0].estado, { timeout: 20_000 }).toBe("com_evidencia");
        await launch(page, id);
        await expect(editor(page).locator(".marca-icone").first()).toContainText(l.comEvidencia);
        await expect(page.locator("[data-nota]")).toHaveCount(0);
      });

      test("the offered speech enters literally with Tab, Esc dismisses it, and with no match nothing appears", async ({ page }) => {
        await signIn(page, language);
        const id = await createText(page, "Revisor fala", ["A entrevista foi na terça."]);
        await sendRecording(page, id, l);
        await launch(page, id);
        const [minute, speech] = SPEECH_RECORDED[1];
        const offer = page.locator("#oferta-fala");
        await inEnd(page);
        await page.keyboard.press("Enter");
        await page.keyboard.type("Ele disse: “olha, eu");
        await page.waitForTimeout(200);
        await expect(offer).toHaveCount(0);      // two words not yet
        await page.keyboard.type(" nun");
        await expect(offer).toContainText(speech);
        await expect(offer).toContainText("01:12");
        await expect(offer).toContainText("entrevista.wav");
        expect(minute).toBe(72.4);
        const boxOffer = (await offer.boundingBox())!;
        expect(boxOffer.x + boxOffer.width).toBeLessThanOrEqual(viewport.width);
        await look(page, `oferta-fala${suffix}`);
        await page.keyboard.press("Tab");
        await expect(editor(page).locator("p").last()).toHaveText(`Ele disse: “olha, eu nun${speech.slice("Olha, eu nun".length)}”`);
        await expect(offer).toHaveCount(0);
        await expect(editor(page)).toBeFocused();

        await page.keyboard.press("Enter");
        await page.keyboard.type("“A licitação vai");
        await expect(offer).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(offer).toHaveCount(0);
        await expect(editor(page).locator("p").last()).toHaveText("“A licitação vai");
        await page.keyboard.type(" sair");
        await expect(offer).toHaveCount(0);      // dismissed applies to this quote
        await page.keyboard.press("Enter");
        await page.keyboard.type("“palavra que ninguém disse");
        await page.waitForTimeout(200);
        await expect(offer).toHaveCount(0);
        // Without an offer, Tab is Tab: it leaves the editor.
        await page.keyboard.press("Tab");
        await expect(editor(page)).not.toBeFocused();
        // The check ties the quote to the minute.
        await expect(editor(page).getByText(l.bateGravacao).first()).toBeAttached({ timeout: 20_000 });
      });

      test("the stamp appears on resolving the last mark, disappears on editing and returns ready on reload", async ({ page }) => {
        await page.addInitScript(WATCH);
        await signIn(page, language);
        const id = await createText(page, "Revisor carimbo", [`${SENTENCE}.`]);
        await launch(page, id);
        const timestamp = page.locator(".folha-doc-pe .carimbo");
        await expect(timestamp).toHaveCount(0);
        // Clicking the note opens the card with today's actions.
        await note(page, l.numero).click();
        await page.getByRole("button", { name: l.ignorar, exact: true }).click();
        await expect(timestamp).toHaveText(l.carimbo);
        await expect(timestamp).toHaveClass(/carimbo-bate/);
        await expect(page.locator(".folha-doc-pe").getByRole("status").filter({ hasText: l.carimbo })).toBeVisible();
        if (view === "celular") await page.getByRole("button", { name: l.fechar, exact: true }).click();
        await expect(page.locator(".acao-lapis .lapis-volta")).toHaveCount(1);    // a closed proof: the pencil goes back to the next action
        await expect(page.locator("[data-nota]")).toHaveCount(0);   // the struck-through note just left
        await page.waitForTimeout(300);
        await look(page, `carimbo${suffix}`);
        await inEnd(page);
        await page.keyboard.type(" Fim.");
        await expect(timestamp).toHaveCount(0);
        await expect(timestamp).toBeVisible({ timeout: 20_000 });
        await page.goto("about:blank");
        await launch(page, id);
        await expect(timestamp).toBeVisible();
        await expect(timestamp).not.toHaveClass(/carimbo-bate/);
        expect(await seen(page)).not.toContain("carimbo-bate");
      });

      test.describe("reduced motion", () => {
        test.use({ reducedMotion: "reduce" });
        test("with prefers-reduced-motion everything appears ready", async ({ page }) => {
          await page.addInitScript(WATCH);
          await signIn(page, language);
          const id = await createText(page, "Revisor reduzido", ["A cidade acordou cedo."]);
          await launch(page, id);
          await inEnd(page);
          await page.keyboard.press("Enter");
          await page.keyboard.type(SENTENCE);
          await ready(page, l.conferido);
          await page.keyboard.type(", segundo o Diário Oficial.");
          await page.keyboard.press("Enter");
          await expect(note(page, l.link)).toBeVisible({ timeout: 20_000 });
          const v = await seen(page);
          expect(v).toContain("nota-pronta");
          for (const c of ["nota-nasce", "nota-risca", "marca-acende"]) expect(v).not.toContain(c);
          await expect(page.locator(".nota-pronta").first().locator(".lapis path")).toHaveCSS("animation-name", "none");
        });
      });

      test("with Notes off nothing appears, the marks stay, and the choice stays in this browser", async ({ page }) => {
        await signIn(page, language);
        const id = await createText(page, "Revisor notas", [`${SENTENCE}.`]);
        await sendRecording(page, id, l);
        await launch(page, id);
        await expect(note(page, l.numero)).toBeVisible();
        const button = page.getByRole("button", { name: l.notas, exact: true });
        await expect(button).toHaveAttribute("aria-pressed", "true");
        await button.click();
        await expect(button).toHaveAttribute("aria-pressed", "false");
        await expect(page.locator("[data-nota]")).toHaveCount(0);
        await expect(editor(page).locator("[data-marca]").first()).toBeAttached();
        await inEnd(page);
        await page.keyboard.press("Enter");
        await page.keyboard.type("“Olha, eu nun");
        await page.waitForTimeout(250);
        await expect(page.locator("#oferta-fala")).toHaveCount(0);
        await page.keyboard.press("End");
        await page.keyboard.type("ca recebi”");
        await page.keyboard.press("Enter");
        await ready(page, l.conferido);
        await expect(page.locator("[data-nota]")).toHaveCount(0);
        await page.reload();
        await expect(editor(page)).toBeVisible();
        await expect(page.getByRole("button", { name: l.notas, exact: true })).toHaveAttribute("aria-pressed", "false");
        await expect(page.locator("[data-nota]")).toHaveCount(0);
      });

      test("reporter sees no note, offer or switch", async ({ page, context }) => {
        await signIn(page, language);
        const id = await createText(page, "Revisor repórter", [`${SENTENCE}.`]);
        await context.clearCookies();
        await signIn(page, language, REPORTER);
        await page.goto(`/t/${OUTLET}/textos/${id}`);
        await expect(editor(page)).toContainText(SENTENCE);
        await expect(editor(page).locator("[data-marca]").first()).toBeAttached();
        await expect(page.locator("[data-nota]")).toHaveCount(0);
        await expect(page.getByRole("button", { name: l.notas, exact: true })).toHaveCount(0);
      });
    });
  }
}
