// Material on the side: the column to the left of the sheet (1440 and 1600 px) and the mobile bottom sheet (390 px);
// the reader for the three sources (link, PDF, recording) with save and insert by selection or by paragraph, at the
// point where the cursor was; the clippings and their actions; the single search; the outlet's library; the states the
// happy path hides; and the cost of typing with the Material open. Screenshots in design/telas/material/, with axe on each.
// The local Worker does not read a fictional page: the evidence goes straight into the local D1 and R2 (as in
// reviewer.spec.ts), and the check that comes after is the real one, against the fake model. PDF and audio upload
// through the API and are read by the local queue.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { fakeWav } from "../../test/fake-audio";
import { pdfFake } from "../../test/fake-pdf";
import { goDownModel, SPEECH_RECORDED, uploadModel } from "./fake-model";
import { ORIGIN_E2_AND } from "./origin";

const PRINTS = "design/telas/material";
const OUTLET = "cartas-da-orla";
const ORIGIN = { origin: ORIGIN_E2_AND };
const DESIGN = { email: "design@redacao.dev", senha: "senha-forte-123" };
const REPORTER = { email: "reporter@redacao.dev", senha: "senha-forte-123" };
const SCREENS = { celular: { width: 390, height: 844 }, computador: { width: 1440, height: 900 }, largo: { width: 1600, height: 900 } } as const;
const PARAGRAPHS = [
  "A obra da orla custou R$ 40 milhões em 2025, segundo a prefeitura.",
  "O relatório aponta que as renovações foram feitas por dispensa.",
  "A secretaria disse que vai analisar o relatório.",
];
const SOURCE = {
  url: "https://prefeitura.example/balanco-material", titulo: "Balanço de obras",
  texto: "Balanço de obras\n\nA obra da orla custou R$ 40 milhões em 2025, segundo o balanço da prefeitura. O documento lista as empresas.\n\nAs renovações dos contratos de ônibus foram feitas por dispensa de licitação, sem concorrência.\n\nA prefeitura promete publicar os contratos até março.",
};
const CLIPPING = "dispensa de licitação, sem concorrência";
// Twelve pages: the reader's window has ten, and "More pages" brings the rest.
const PDF = [
  ["Relatório da comissão de transporte", "A Câmara aprovou em 2025 a renovação de 12 contratos de ônibus sem licitação."],
  ["Contratos renovados", "Viação Serena Ltda, CNPJ 98.765.432/0001-98", "Total dos contratos: R$ 48 milhões"],
  ...Array.from({ length: 9 }, (_, i) => [`Anexo ${i + 1}`, `Planilha de linhas do lote ${i + 1}, sem valores.`]),
  ["Conclusão", "A comissão recomenda abrir a licitação das linhas em 2026."],
];
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

function sql(command: string) {
  const file = "test-results/material.sql";
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
test.afterEach(async ({ page }) => { await page.request.put("/api/me/idioma", { data: { idioma: "pt-BR" }, headers: ORIGIN }).catch(() => {}); });

async function look(page: Page, label: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${PRINTS}/${label}-${page.viewportSize()!.width}.png` });
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).setLegacyMode(true).options({ iframes: false }).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), label).toEqual([]);
}

async function signIn(page: Page, language: "pt-BR" | "en" = "pt-BR", account = DESIGN) {
  await page.goto("/entrar");
  await page.evaluate((i) => localStorage.setItem("redacao:idioma", i), language);
  await page.reload();
  await page.locator("input[type=email]").fill(account.email);
  await page.locator("input[type=password]").fill(account.senha);
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/t\//);
  await page.request.put("/api/me/idioma", { data: { idioma: language }, headers: ORIGIN });
}

/** Real evidence in the local D1 and R2, as if the link had been read. */
function perSource(id: string, f: { url: string; titulo: string; texto: string } = SOURCE) {
  const ev = `mt-${id.slice(0, 8)}-${f.url.length}`;
  const file = `test-results/${ev}.txt`;
  writeFileSync(file, f.texto);
  const r = spawnSync(`npx wrangler r2 object put redacao-media/evidencias/${OUTLET}/${ev}.txt --file ${file} --local`, { shell: true, stdio: "ignore" });
  if (r.status !== 0) throw new Error("r2 local");
  sql(`INSERT OR IGNORE INTO evidencias (id, tenant_id, texto_id, url, titulo, r2_texto, hash, hash_atual) VALUES (${q(ev)}, '${OUTLET}', ${q(id)}, ${q(f.url)}, ${q(f.titulo)}, ${q(`evidencias/${OUTLET}/${ev}.txt`)}, 'h1', 'h1');`);
  return ev;
}

/** The pasted text, with the source in the dossier, already checked (like that of someone coming back to it). */
async function createText(page: Page, title: string, o: { fonte?: boolean; paragrafos?: string[] } = {}) {
  const res = await page.request.post(`/api/t/${OUTLET}/textos`, { data: { titulo: title, texto: (o.paragrafos ?? PARAGRAPHS).join("\n") }, headers: ORIGIN });
  expect(res.status()).toBe(201);
  const id = ((await res.json()) as { texto: { id: string } }).texto.id;
  const ev = o.fonte === false ? null : perSource(id);
  expect((await page.request.post(`/api/t/${OUTLET}/textos/${id}/conferir`, { data: {}, headers: ORIGIN })).status()).toBe(200);
  return { id, ev };
}

type State = { apontamentos: { tipo: string; trecho: string }[]; documentos: { id: string; estado: string }[]; gravacoes: { id: string; estado: string }[]; evidencias: { id: string }[] };
const state = async (page: Page, id: string) => (await (await page.request.get(`/api/t/${OUTLET}/textos/${id}`)).json()) as State;

/** PDF and audio through the API, and waiting for the local queue (PDF read, transcription by the fake Whisper). */
async function sendFiles(page: Page, id: string) {
  const pdf = await page.request.post(`/api/t/${OUTLET}/textos/${id}/documentos`, { data: Buffer.from(pdfFake(PDF)), headers: { ...ORIGIN, "content-type": "application/pdf", "x-nome": encodeURIComponent("relatorio-comissao.pdf") } });
  expect(pdf.status()).toBeLessThan(300);
  const audio = await page.request.post(`/api/t/${OUTLET}/textos/${id}/gravacoes`, { data: Buffer.from(fakeWav(2)), headers: { ...ORIGIN, "content-type": "audio/wav", "x-nome": encodeURIComponent("entrevista-secretario.wav") } });
  expect(audio.status()).toBeLessThan(300);
  await expect.poll(async () => { const e = await state(page, id); return [...e.documentos, ...e.gravacoes].map((x) => x.estado).join(","); }, { timeout: 60_000 }).toBe("pronto,pronto");
}

const editor = (page: Page) => page.locator(".ProseMirror");
const material = (page: Page) => page.locator("[data-material]");
const saved = (page: Page) => expect(page.getByText(/^salvo/)).toBeVisible({ timeout: 15_000 });

/** Puts the cursor right after a passage of the text (through the editor itself) and returns the position. */
const cursorAfterOf = (page: Page, passage: string) => page.evaluate((s) => {
  type Ed = { state: { doc: { descendants: (f: (n: { isText: boolean; text?: string }, p: number) => void) => void }; selection: { from: number } }; chain: () => { focus: () => { setTextSelection: (p: number) => { run: () => void } } } };
  const ed = (document.querySelector(".ProseMirror") as unknown as { editor: Ed }).editor;
  let after = -1;
  ed.state.doc.descendants((n, p) => { if (after < 0 && n.isText && n.text!.includes(s)) after = p + n.text!.indexOf(s) + s.length; });
  ed.chain().focus().setTextSelection(after).run();
  return after;
}, passage);
const selectionEditor = (page: Page) => page.evaluate(() => {
  const ed = (document.querySelector(".ProseMirror") as unknown as { editor: { state: { selection: { from: number; to: number } } } }).editor;
  return [ed.state.selection.from, ed.state.selection.to];
});
/** Selects a passage inside a reader element, as the person would with the mouse. */
const select = (target: Locator, passage: string) => target.evaluate((el, s) => {
  const nodes: [Text, number][] = [];
  let all = "";
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) { nodes.push([n as Text, all.length]); all += n.textContent; }
  const i = all.indexOf(s);
  if (i < 0) throw new Error(`trecho fora do parágrafo: ${s}`);
  const find = (after: number) => { for (let k = nodes.length - 1; k >= 0; k--) if (nodes[k][1] <= after) return [nodes[k][0], after - nodes[k][1]] as const; throw new Error("pos"); };
  const [a, ao] = find(i), [b, bo] = find(i + s.length);
  const r = document.createRange();
  r.setStart(a, ao);
  r.setEnd(b, bo);
  getSelection()!.removeAllRanges();
  getSelection()!.addRange(r);
}, passage);
/** The reader paragraph (or speech passage) that contains the text. */
const inReader = (page: Page, text: string) => material(page).locator("li").filter({ has: page.locator("[data-trecho]", { hasText: text }) }).first();
async function openPart(page: Page, label: RegExp) {
  const b = material(page).getByRole("button", { name: label }).first();
  if ((await b.getAttribute("aria-expanded")) !== "true") await b.click();
  await expect(b).toHaveAttribute("aria-expanded", "true");
}

test.describe("desktop, 1440", () => {
  test.use({ viewport: SCREENS.computador, locale: "pt-BR" });

  test("opens in the column without moving the cursor, reads the source, saves and inserts at the cursor point with the citation resolved", async ({ page }) => {
    await signIn(page);
    const { id } = await createText(page, "Obra da orla: material ao lado");
    await page.goto(`/t/${OUTLET}/textos/${id}`);
    await expect(editor(page)).toContainText("feitas por dispensa");
    const sidebar = page.getByRole("complementary", { name: "Veículo e seções" });
    await expect(sidebar).toBeVisible();
    const after = await cursorAfterOf(page, "feitas por ");

    // The button does not take focus: the cursor stays in the text, in the same place.
    await page.getByRole("button", { name: "Material", exact: true }).click();
    await expect(page).toHaveURL(/[?&]material=aberto/);
    await expect(sidebar).toBeHidden();
    await expect(page.getByRole("complementary", { name: "Marcas e dossiê" })).toHaveCount(0);
    await expect(editor(page)).toBeFocused();
    expect(await selectionEditor(page)).toEqual([after, after]);
    const col = material(page);
    const box = (await col.boundingBox())!, sheet = (await page.locator(".folha-doc").boundingBox())!;
    expect(box.x + box.width).toBeLessThan(sheet.x);
    expect(box.width).toBeGreaterThan(340);
    expect(box.width).toBeLessThanOrEqual(360);
    await expect(col.getByRole("button", { name: /^Fontes/ })).toHaveAttribute("aria-expanded", "true");
    await look(page, "fontes");

    // The reader: the passage that supports the text's claim comes highlighted in light green.
    await col.getByRole("button", { name: /Balanço de obras/ }).click();
    await expect(page).toHaveURL(/[?&]fonte=evidencia/);
    await expect(col.getByRole("heading", { name: "Balanço de obras" })).toBeVisible();
    await expect(col.locator("mark.bg-verde-claro").filter({ hasText: "custou R$ 40 milhões" })).toBeVisible();
    const pair = inReader(page, CLIPPING);
    await select(pair.locator("[data-trecho]"), CLIPPING);
    await look(page, "leitor");

    await pair.getByRole("button", { name: /^Guardar recorte/ }).click();
    await expect(col.getByText("Guardado nos recortes.")).toBeVisible();
    await pair.getByRole("button", { name: /^Guardar recorte/ }).click();
    await expect(col.getByText("Esse trecho já estava nos recortes.")).toBeVisible();
    expect(await selectionEditor(page)).toEqual([after, after]);

    // Insert: the selection made in the source goes in where the cursor was, in quotes and with the citation note.
    await pair.getByRole("button", { name: /^Inserir/ }).click();
    await expect(editor(page).locator("p").nth(1)).toHaveText(`O relatório aponta que as renovações foram feitas por “${CLIPPING}” [Balanço de obras] dispensa.`);
    await expect(editor(page)).toBeFocused();
    // Control: a quote that is in no source, at the end of the text, opens the finding; the inserted one does not.
    await cursorAfterOf(page, "vai analisar o relatório.");
    await page.keyboard.type(" Ele disse “uma frase que ninguém escreveu antes”.");
    await saved(page);
    await expect.poll(async () => (await state(page, id)).apontamentos.filter((p) => p.tipo === "aspa").map((p) => p.trecho).join(" | "), { timeout: 15_000 }).toContain("ninguém escreveu");
    expect((await state(page, id)).apontamentos.filter((p) => p.tipo === "aspa" && p.trecho.includes("dispensa de licitação"))).toHaveLength(0);

    // The clippings: "in the text" comes from the saved text; own note, order, annotate, library, cite only and remove.
    await col.getByRole("button", { name: "Voltar ao material" }).click();
    await openPart(page, /^Recortes/);
    const list = col.getByRole("list", { name: "Recortes" });
    const card = list.getByRole("listitem").filter({ hasText: CLIPPING });
    await expect(card.getByText("no texto")).toBeVisible();
    await col.getByLabel("Anotação", { exact: true }).fill("Perguntar à prefeitura o número do processo da dispensa.");
    await col.getByRole("button", { name: "Guardar a anotação" }).click();
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await expect(list.getByRole("listitem").first()).toContainText(CLIPPING);
    await list.getByRole("button", { name: /^Subir: Perguntar/ }).click();
    await expect(list.getByRole("listitem").first()).toContainText("Perguntar à prefeitura");
    await expect(list.getByRole("button", { name: /^Subir: Perguntar/ })).toBeDisabled();
    await card.getByRole("button", { name: /^Anotar/ }).click();
    await card.getByLabel("Anotação sobre o recorte").fill("Confirmar a data da dispensa.");
    await card.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(card.getByText("Confirmar a data da dispensa.")).toBeVisible();
    await card.getByRole("button", { name: /^Guardar no acervo/ }).click();
    await expect(card.getByRole("button", { name: /^No acervo/ })).toHaveAttribute("aria-pressed", "true");
    const end1 = await cursorAfterOf(page, "segundo a prefeitura.");
    await card.getByRole("button", { name: /^Só citar/ }).click();
    // (toContainText: the check's mark puts the state's name for screen readers inside the paragraph.)
    await expect(editor(page).locator("p").first()).toContainText(`${PARAGRAPHS[0]}[Balanço de obras]`);
    expect(end1).toBeGreaterThan(0);
    await look(page, "recortes");
    await list.getByRole("listitem").filter({ hasText: "Perguntar à prefeitura" }).getByRole("button", { name: /^Tirar/ }).click();
    await expect(list.getByRole("listitem")).toHaveCount(1);

    // Fechar devolve a lateral e o painel.
    await col.getByRole("button", { name: "Fechar o material" }).click();
    await expect(page).not.toHaveURL(/material=/);
    await expect(sidebar).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Marcas e dossiê" })).toBeVisible();
  });

  test("whoever has not put the cursor in the text gets the passage at the end, not pasted at the start of the first line", async ({ page }) => {
    await signIn(page);
    const { id, ev } = await createText(page, "Obra da orla: sem cursor");
    // Arrives through the address, with the reader open, and goes straight to the source: the editor is born with the cursor at the start.
    await page.goto(`/t/${OUTLET}/textos/${id}?material=aberto&fonte=evidencia:${ev}`);
    await expect(editor(page)).toContainText("feitas por dispensa");
    const pair = inReader(page, CLIPPING);
    await select(pair.locator("[data-trecho]"), CLIPPING);
    await pair.getByRole("button", { name: /^Inserir/ }).click();
    await expect(editor(page).locator("p").last()).toContainText(`vai analisar o relatório. “${CLIPPING}” [Balanço de obras]`);
    await expect(editor(page).locator("p").first()).not.toContainText(CLIPPING);
    // From then on the cursor is the person's: the next passage goes where they put it.
    await cursorAfterOf(page, "feitas por ");
    await select(pair.locator("[data-trecho]"), CLIPPING);
    await pair.getByRole("button", { name: /^Inserir/ }).click();
    await expect(editor(page).locator("p").nth(1)).toContainText(`feitas por “${CLIPPING}” [Balanço de obras] dispensa.`);
  });

  test("single search across the four types, accent-insensitive; the PDF and recording readers insert at the cursor", async ({ page }) => {
    test.setTimeout(150_000);
    await signIn(page);
    const { id } = await createText(page, "Licitação das linhas: busca no material");
    await sendFiles(page, id);
    await page.request.post(`/api/t/${OUTLET}/textos/${id}/recortes`, { data: { origem: "nota", trecho: "Ligar para a comissão sobre a licitação de 2026." }, headers: ORIGIN });
    await page.goto(`/t/${OUTLET}/textos/${id}?material=aberto`);
    const col = material(page);
    await expect(col).toBeVisible();
    const after = await cursorAfterOf(page, "vai analisar o relatório.");

    await col.getByLabel("Procurar no material").fill("licitacao");
    await expect(col.getByRole("region", { name: /^recortes/ })).toBeVisible();
    await expect(col.getByRole("region", { name: /^fonte: Balanço de obras/ })).toBeVisible();
    await expect(col.getByRole("region", { name: /^PDF: relatorio-comissao\.pdf/ })).toBeVisible();
    await expect(col.getByRole("region", { name: /^gravação: entrevista-secretario\.wav/ })).toBeVisible();
    await expect(col.locator("mark").first()).toBeVisible();
    await look(page, "busca");

    // The recording opens on the found passage, with the minute and the player.
    await col.getByRole("region", { name: /^gravação/ }).getByRole("button").first().click();
    await expect(page).toHaveURL(/[?&]fonte=gravacao/);
    const speech = SPEECH_RECORDED[2][1];
    const passage = inReader(page, speech.slice(0, 20));
    await expect(passage).toHaveAttribute("data-alvo", "true");
    await expect(passage.getByText("01:20", { exact: true })).toBeVisible();
    await expect(passage.getByRole("button", { name: /^Ouvir o trecho/ })).toBeVisible();
    // Short speech: warns and does not insert.
    await select(passage.locator("[data-trecho]"), "em abril");
    await passage.getByRole("button", { name: /^Inserir/ }).click();
    await expect(col.getByText(/Fala curta demais/)).toBeVisible();
    await select(passage.locator("[data-trecho]"), "A licitação vai sair em abril");
    await passage.getByRole("button", { name: /^Inserir/ }).click();
    await expect(editor(page).locator("p").nth(2)).toContainText(`${PARAGRAPHS[2]}“A licitação vai sair em abril”`);
    expect(after).toBeGreaterThan(0);
    await look(page, "leitor-gravacao");

    // The PDF opens on the found page; inserting becomes evidence and goes in with the page's note.
    await col.getByRole("button", { name: "Voltar ao material" }).click();
    await col.getByLabel("Procurar no material").fill("48 milhoes");
    // Waits for this search's hit (the previous one's list stays in view, dimmed, until the new one arrives).
    await col.getByRole("region", { name: /^PDF/ }).getByRole("button", { name: /48 milhões/ }).click();
    await expect(page).toHaveURL(/[?&]fonte=documento/);
    const pageNumber = inReader(page, "R$ 48 milhões");
    await expect(pageNumber).toHaveAttribute("data-alvo", "true");
    await cursorAfterOf(page, "segundo a prefeitura.");
    await select(pageNumber.locator("[data-trecho]"), "Total dos contratos: R$ 48 milhões");
    await pageNumber.getByRole("button", { name: /^Inserir/ }).click();
    await expect(editor(page).locator("p").first()).toContainText("segundo a prefeitura.“Total dos contratos: R$ 48 milhões” [relatorio-comissao.pdf, p. 2]");
    await expect(col.getByRole("button", { name: "Mais páginas" })).toBeVisible();
    await col.getByRole("button", { name: "Mais páginas" }).click();
    await expect(inReader(page, "recomenda abrir a licitação")).toBeVisible();
    await look(page, "leitor-pdf");
    await saved(page);
    await expect.poll(async () => (await state(page, id)).apontamentos.filter((p) => p.tipo === "aspa").length, { timeout: 15_000 }).toBe(0);
    expect((await state(page, id)).apontamentos.filter((p) => p.tipo === "gravacao")).toHaveLength(1);

    // No result, and the search cut by the cap.
    await col.getByRole("button", { name: "Voltar ao material" }).click();
    await col.getByLabel("Procurar no material").fill("palavra que ninguém escreveu");
    await expect(col.getByText(/^Nada com essas palavras no material/)).toBeVisible();
    await page.route((u) => u.pathname.endsWith("/material/busca"), async (r) => {
      const res = await r.fetch();
      const body = { ...(await res.json()), cortado: true };
      await r.fulfill({ response: res, json: body });
    });
    await col.getByLabel("Procurar no material").fill("contratos");
    await expect(col.getByText(/A busca parou no teto/)).toBeVisible();
  });

  test("outlet library: searches, brings the source and the clipping from another text, without repeating", async ({ page }) => {
    await signIn(page);
    const other = { url: `https://camara.example/sessao-${Date.now()}`, titulo: "Ata da sessão da Câmara", texto: "Ata da sessão\n\nOs vereadores aprovaram a CPI dos ônibus por 11 votos a 2.\n\nA sessão terminou às 22h." };
    // The other text's title is unique per run: the local D1 keeps the library from earlier runs.
    const otherTitle = `Outro texto: a CPI dos ônibus nº ${Date.now() % 100000}`;
    const { id: otherId } = await createText(page, otherTitle, { fonte: false, paragrafos: ["A CPI dos ônibus foi aprovada."] });
    const evOther = perSource(otherId, other);
    const rec = await page.request.post(`/api/t/${OUTLET}/textos/${otherId}/recortes`, { data: { origem: "evidencia", evidenciaId: evOther, trecho: "aprovaram a CPI dos ônibus por 11 votos a 2" }, headers: ORIGIN });
    const clippingId = ((await rec.json()) as { recorteId: string }).recorteId;
    await page.request.patch(`/api/t/${OUTLET}/textos/${otherId}/recortes/${clippingId}`, { data: { acervo: true }, headers: ORIGIN });

    const { id } = await createText(page, "Texto que traz do acervo", { fonte: false });
    await page.goto(`/t/${OUTLET}/textos/${id}?material=aberto`);
    const col = material(page);
    await expect(col.getByText("Nenhuma fonte no dossiê.", { exact: false })).toBeVisible();
    await openPart(page, /^Acervo do veículo/);
    await col.getByLabel("Procurar no acervo").fill("sessao da camara");
    const source = col.locator("section[aria-labelledby=acervo-fontes-t] li").filter({ hasText: "Ata da sessão da Câmara" }).filter({ hasText: `de “${otherTitle}”` });
    await expect(source).toHaveCount(1);
    await look(page, "acervo");
    await source.getByRole("button", { name: /^Trazer para este texto/ }).click();
    await expect(source.getByText(/trazido: está nas fontes deste texto|já está neste texto/)).toBeVisible();
    await expect.poll(async () => (await state(page, id)).evidencias.length).toBe(1);

    await col.getByLabel("Procurar no acervo").fill("11 votos");
    const clipping = col.locator("section[aria-labelledby=acervo-recortes-t] li").filter({ hasText: "aprovaram a CPI dos ônibus" }).filter({ hasText: `de “${otherTitle}”` });
    await clipping.getByRole("button", { name: /^Trazer/ }).click();
    await expect(clipping.getByText(/trazido para os recortes|já está neste texto/)).toBeVisible();
    await openPart(page, /^Recortes/);
    await expect(col.getByRole("list", { name: "Recortes" }).getByRole("listitem")).toHaveCount(1);
    // Bringing again does not duplicate: the source and the clipping already in the text stay as they are.
    const again = await page.request.post(`/api/t/${OUTLET}/textos/${id}/acervo/trazer`, { data: { tipo: "recorte", id: clippingId }, headers: ORIGIN });
    expect(again.status()).toBe(200);
    expect((await state(page, id)).evidencias).toHaveLength(1);
  });

  test("states: empty material, source that left the dossier, PDF being read and network error on an action", async ({ page }) => {
    await signIn(page);
    const empty = await createText(page, "Texto sem material", { fonte: false });
    await page.goto(`/t/${OUTLET}/textos/${empty.id}?material=aberto`);
    const col = material(page);
    await expect(col.getByText("Nenhuma fonte no dossiê.", { exact: false })).toBeVisible();
    await openPart(page, /^Recortes/);
    await expect(col.getByText("Nenhum recorte ainda.", { exact: false })).toBeVisible();
    await look(page, "vazio");

    // Network error: the action fails with the sentence of what to do, and what was typed stays.
    await page.route("**/recortes", (r) => (r.request().method() === "POST" ? r.abort() : r.fallback()));
    await col.getByLabel("Anotação", { exact: true }).fill("Conferir o contrato.");
    await col.getByRole("button", { name: "Guardar a anotação" }).click();
    await expect(col.getByRole("alert")).toContainText("Sem conexão");
    await expect(col.getByLabel("Anotação", { exact: true })).toHaveValue("Conferir o contrato.");
    await page.unrouteAll();

    // The source left the dossier: the clipping stays, it can be inserted, not cited or opened.
    const { id, ev } = await createText(page, "Fonte que saiu do dossiê");
    await page.request.post(`/api/t/${OUTLET}/textos/${id}/recortes`, { data: { origem: "evidencia", evidenciaId: ev, trecho: CLIPPING }, headers: ORIGIN });
    expect((await page.request.delete(`/api/t/${OUTLET}/textos/${id}/evidencias/${ev}`, { headers: ORIGIN })).status()).toBe(200);
    await page.goto(`/t/${OUTLET}/textos/${id}?material=aberto`);
    const card = col.getByRole("list", { name: "Recortes" }).getByRole("listitem").first();
    await expect(card.getByText("a fonte saiu do dossiê", { exact: false })).toBeVisible();
    await expect(card.getByRole("button", { name: /^Inserir/ })).toBeEnabled();
    await expect(card.getByRole("button", { name: /^Só citar/ })).toHaveCount(0);
    await expect(card.getByRole("button", { name: /^Abrir na fonte/ })).toHaveCount(0);

    // PDF being read: the row says so and the reader does not open.
    await page.route(`**/api/t/${OUTLET}/textos/${id}`, async (r) => {
      if (r.request().method() !== "GET") return r.fallback();
      const res = await r.fetch();
      const body = await res.json();
      body.documentos = [{ id: "pdf-lendo", nome: "processo-licitacao.pdf", estado: "lendo", paginas: null, vetor: null, erro: null, perguntas: [], entidades: null, em: new Date().toISOString() }];
      await r.fulfill({ response: res, json: body });
    });
    await page.reload();
    // The summary only appears with the part closed (kit/Parts).
    await expect(col.getByRole("button", { name: /^Documentos/ })).toContainText("1 sendo lido");
    await openPart(page, /^Documentos/);
    await expect(col.getByRole("button", { name: /processo-licitacao\.pdf/ })).toBeDisabled();
    await expect(col.getByText("lendo o PDF…")).toBeVisible();
    await look(page, "pdf-lendo");
  });

  test("read-only users see and read the material, without inserting, saving or changing", async ({ page }) => {
    await signIn(page);
    const { id, ev } = await createText(page, "Texto que o repórter lê");
    await page.request.post(`/api/t/${OUTLET}/textos/${id}/recortes`, { data: { origem: "evidencia", evidenciaId: ev, trecho: CLIPPING }, headers: ORIGIN });
    await page.context().clearCookies();
    await signIn(page, "pt-BR", REPORTER);
    await page.goto(`/t/${OUTLET}/textos/${id}`);
    await page.getByRole("button", { name: "Material", exact: true }).click();
    const col = material(page);
    const card = col.getByRole("list", { name: "Recortes" }).getByRole("listitem").first();
    await expect(card).toContainText(CLIPPING);
    for (const name of [/^Inserir/, /^Só citar/, /^Tirar/, /^Anotar/, /^Guardar no acervo/, /^Subir/]) await expect(card.getByRole("button", { name: name })).toHaveCount(0);
    await expect(col.getByLabel("Anotação", { exact: true })).toHaveCount(0);
    await card.getByRole("button", { name: /^Abrir na fonte/ }).click();
    await expect(inReader(page, CLIPPING)).toHaveAttribute("data-alvo", "true");
    await expect(col.getByRole("button", { name: /^Guardar recorte/ })).toHaveCount(0);
    await look(page, "leitura");
  });

  test("focus and material exclude each other, the palette opens and searches, and typing does not redraw the material", async ({ page }) => {
    await signIn(page);
    const { id } = await createText(page, "Foco, paleta e custo da digitação");
    await page.goto(`/t/${OUTLET}/textos/${id}`);
    await expect(editor(page)).toContainText("feitas por dispensa");
    await page.getByRole("button", { name: "Foco", exact: true }).click();
    await expect(page).toHaveURL(/foco=1/);
    await page.getByRole("button", { name: "Material", exact: true }).click();
    await expect(page).toHaveURL(/material=aberto/);
    await expect(page).not.toHaveURL(/foco=1/);
    await page.getByRole("button", { name: "Foco", exact: true }).click();
    await expect(page).not.toHaveURL(/material=/);
    await page.getByRole("button", { name: "Foco", exact: true }).click();

    await cursorAfterOf(page, "vai analisar o relatório.");
    await page.keyboard.press("Control+k");
    // The Material mounts on open and fetches the clippings: the measurement starts after that arrival, not during it.
    const clippingsArrived = page.waitForResponse((r) => r.url().endsWith(`/textos/${id}/recortes`) && r.request().method() === "GET");
    await page.getByRole("option", { name: "Procurar no material" }).click();
    await expect(page.getByLabel("Procurar no material")).toBeFocused();
    await expect(page).toHaveURL(/material=aberto/);
    await clippingsArrived;

    // Typing with the Material open: no change in its DOM and the component does not render (memo with stable props). The
    // save is held while measuring: the server's response brings a new state and then the Material draws again, once per
    // save (which is what should happen: the "in the text" clippings depend on the saved text), not per keystroke.
    let release!: () => void;
    const pinned = new Promise<void>((r) => { release = r; });
    await page.route(`**/api/t/${OUTLET}/textos/${id}`, async (r) => {
      if (r.request().method() === "PUT") await pinned;
      return r.fallback();
    });
    await cursorAfterOf(page, "vai analisar o relatório.");
    // Tiptap's focus arrives on a later frame: without waiting, the first key would land in the Material's search.
    await expect(editor(page)).toBeFocused();
    await expect(material(page).getByRole("button", { name: /^Recortes/ })).toBeVisible();
    await page.evaluate(() => {
      const el = document.querySelector("[data-material]")!;
      const w = window as unknown as { mudancas: number; antes: unknown[] };
      w.mudancas = 0;
      new MutationObserver((ms) => { w.mudancas += ms.length; }).observe(el, { subtree: true, childList: true, characterData: true, attributes: true });
      const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"))!;
      type Fiber = { elementType?: { displayName?: string } | null; memoizedState: unknown; alternate: Fiber | null; return: Fiber | null };
      let f = (el as unknown as Record<string, Fiber>)[key] as Fiber | null;
      while (f && f.elementType?.displayName !== "Material") f = f.return;
      if (!f) throw new Error("sem a fibra do Material");
      w.antes = [f.memoizedState, f.alternate?.memoizedState];
    });
    await page.keyboard.type(" E a obra começou em junho.", { delay: 20 });
    await expect(editor(page).locator("p").nth(2)).toContainText("começou em junho.");
    const cost = await page.evaluate(() => {
      const el = document.querySelector("[data-material]")!;
      const w = window as unknown as { mudancas: number; antes: unknown[] };
      const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"))!;
      type Fiber = { elementType?: { displayName?: string } | null; memoizedState: unknown; alternate: Fiber | null; return: Fiber | null };
      let f = (el as unknown as Record<string, Fiber>)[key] as Fiber | null;
      while (f && f.elementType?.displayName !== "Material") f = f.return;
      const now = [f!.memoizedState, f!.alternate?.memoizedState];
      // Rendering creates the hook list again: without a render, both sides of the fiber keep the earlier list.
      return { mudancas: w.mudancas, renderizou: now.some((x) => !w.antes.includes(x)) };
    });
    expect(cost).toEqual({ mudancas: 0, renderizou: false });
    release();
    await saved(page);
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });
});

test.describe("wide desktop, 1600", () => {
  test.use({ viewport: SCREENS.largo, locale: "pt-BR" });

  test("three columns: material on the left, the proof in the middle and the reviewer's margin on the right", async ({ page }) => {
    await signIn(page);
    const { id } = await createText(page, "Três colunas", { paragrafos: [...PARAGRAPHS, "A obra da orla gasta mais do que a da praça."] });
    await page.goto(`/t/${OUTLET}/textos/${id}?material=aberto`);
    const col = material(page);
    await expect(col).toBeVisible();
    const panel = page.getByRole("complementary", { name: "Marcas e dossiê" });
    await expect(panel).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Veículo e seções" })).toBeHidden();
    const a = (await col.boundingBox())!, b = (await page.locator(".folha-doc").boundingBox())!, c = (await panel.boundingBox())!;
    expect(a.x + a.width).toBeLessThan(b.x);
    expect(b.x + b.width).toBeLessThan(c.x);
    expect(b.width).toBeGreaterThan(680);
    await col.getByRole("button", { name: /Balanço de obras/ }).click();
    await expect(col.locator("mark.bg-verde-claro").first()).toBeVisible();
    await look(page, "tres-colunas");
  });
});

test.describe("mobile, 390", () => {
  test.use({ viewport: SCREENS.celular, locale: "pt-BR", deviceScaleFactor: 2 });

  test("the material opens in the bottom sheet; inserting closes the sheet and puts the passage where the cursor was", async ({ page }) => {
    await signIn(page);
    const { id } = await createText(page, "Material no celular");
    await page.goto(`/t/${OUTLET}/textos/${id}`);
    await expect(editor(page)).toContainText("feitas por dispensa");
    const after = await cursorAfterOf(page, "feitas por ");
    await page.getByRole("button", { name: "Material", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Material" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("button", { name: /^Fontes/ })).toHaveAttribute("aria-expanded", "true");
    await look(page, "folha");
    await sheet.getByRole("button", { name: /Balanço de obras/ }).click();
    const pair = inReader(page, CLIPPING);
    await select(pair.locator("[data-trecho]"), CLIPPING);
    await look(page, "leitor");
    await pair.getByRole("button", { name: /^Inserir/ }).click();
    await expect(sheet).toBeHidden();
    await expect(page).not.toHaveURL(/material=/);
    await expect(editor(page)).toBeFocused();
    await expect(editor(page).locator("p").nth(1)).toHaveText(`O relatório aponta que as renovações foram feitas por “${CLIPPING}” [Balanço de obras] dispensa.`);
    // The cursor stays right after what went in: writing can continue from there.
    const [from] = await selectionEditor(page);
    expect(from).toBeGreaterThan(after);
    // Reopening goes back to the same reader.
    await page.getByRole("button", { name: "Material", exact: true }).click();
    await expect(sheet.getByRole("heading", { name: "Balanço de obras" })).toBeVisible();
  });
});

test.describe("English", () => {
  test.use({ viewport: SCREENS.computador, locale: "en" });

  test("the material and the reader in English", async ({ page }) => {
    await signIn(page, "en");
    const { id, ev } = await createText(page, "Material in English");
    await page.request.post(`/api/t/${OUTLET}/textos/${id}/recortes`, { data: { origem: "evidencia", evidenciaId: ev, trecho: CLIPPING }, headers: ORIGIN });
    await page.goto(`/t/${OUTLET}/textos/${id}?material=aberto`);
    const col = material(page);
    await expect(col.getByRole("button", { name: /^Clippings/ })).toHaveAttribute("aria-expanded", "true");
    await expect(col.getByRole("button", { name: /^Insert/ })).toBeVisible();
    await expect(col.getByLabel("Search the material")).toBeVisible();
    await look(page, "recortes-en");
    await col.getByRole("button", { name: /^Open in source/ }).click();
    await expect(col.getByRole("button", { name: "Back to the material" })).toBeVisible();
    await expect(col.getByRole("button", { name: /^Save clipping/ }).first()).toBeVisible();
    await look(page, "leitor-en");
  });
});
