// The Story (handoffs/2026-11-02-materia-e-editor-investigativo.md): the Dossier · Text · Posts · After tabs, sending to
// Instagram gated by an open legal risk and the evidence per sentence. Against `wrangler dev` with the seeded local D1
// (README, Local testing) and seeds/author-local.sql. The check and the dossier go straight into the local D1 (the
// `wrangler dev` Worker reaches neither a fictional page nor the model): the real server decides the rest. In pt-BR and
// en, at widths 390 and 1440, axe 0. Screenshots in design/telas/materia/.
import { spawnSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { partLine, part } from "./parts";
import { writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";
import { callsModel, goDownModel, uploadModel, resetCalls } from "./fake-model";
import { ORIGIN_E2_AND } from "./origin";
import { pdfFake } from "../../test/fake-pdf";
import { fakeWav } from "../../test/fake-audio";

const PRINTS = "design/telas/materia";
const SCREENS = { celular: { width: 390, height: 844 }, computador: { width: 1440, height: 900 } } as const;
const OUTLET = "cartas-da-orla";
const DESIGN = { email: "design@redacao.dev", senha: "senha-forte-123" };
const ORIGIN = { origin: ORIGIN_E2_AND };
export const TITLE = "Contratos sem concorrência";
export const PARAGRAPHS = [
  "A Câmara renovou 12 contratos de ônibus sem licitação em 2025, segundo o relatório da comissão.",
  "O vereador citado desviou dinheiro dos contratos, dizem moradores.",
  "A cidade gasta mais com transporte do que com saúde.",
  "Eu acho que isso diz muito sobre a cidade.",
];
export const EVIDENCE = { url: "https://camara.example/relatorio-transporte", titulo: "Relatório da comissão de transporte" };
export const EV_PASSAGE = "A Câmara aprovou em 2025 a renovação de 12 contratos de ônibus sem licitação";

export function sql(command: string) {
  const r = spawnSync(`npx wrangler d1 execute redacao-db --local --command "${command.replace(/"/g, '\\"')}"`, { shell: true, stdio: "ignore" });
  if (r.status !== 0) throw new Error(`d1 local: ${command.slice(0, 80)}`);
}
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

test.beforeAll(async () => {
  const r = spawnSync("npx wrangler d1 execute redacao-db --local --file seeds/author-local.sql", { shell: true, stdio: "ignore" });
  if (r.status !== 0) throw new Error("seed autoral-local.sql falhou");
  await uploadModel();
});
test.afterAll(goDownModel);

export const EV_TEXT = `Relatório da comissão de transporte

${EV_PASSAGE}, segundo o relatório da comissão de transporte. O documento lista as empresas e os valores pagos.`;
/** Evidence in the real dossier: the text stored in the local R2 and the row in the local D1 (the local Worker does not read a fictional page). */
export function evidenceReal(id: string) {
  const ev = `ev-${id.slice(0, 8)}`;
  const file = `test-results/${ev}.txt`;
  writeFileSync(file, EV_TEXT);
  const r = spawnSync(`npx wrangler r2 object put redacao-media/evidencias/cartas-da-orla/${ev}.txt --file ${file} --local`, { shell: true, stdio: "ignore" });
  if (r.status !== 0) throw new Error("r2 local: evidência");
  sql(`INSERT INTO evidencias (id, tenant_id, texto_id, url, titulo, r2_texto, hash, hash_atual) VALUES (${q(ev)}, 'cartas-da-orla', ${q(id)}, ${q(EVIDENCE.url)}, ${q(EVIDENCE.titulo)}, ${q(`evidencias/cartas-da-orla/${ev}.txt`)}, 'h1', 'h1');`);
  return ev;
}

/** Removes the author outlet's texts (and whatever hung off them). */
export function clean() {
  sql(["alertas", "pedidos_lai", "processos", "gravacao_sessoes", "gravacao_segmentos", "gravacao_trechos", "perguntas", "arquivo_paginas_fts", "arquivo_paginas", "arquivos", "afirmacoes", "blocos", "apuracoes", "assinaturas", "marcas_historico", "manual_regras", "pedidos_outro_lado", "texto_versoes", "paginas_fontes", "pacotes_defesa", "recortes", "evidencias"].map((t) => `DELETE FROM ${t} WHERE tenant_id = 'cartas-da-orla';`).join(" ") +
    " DELETE FROM peca_versoes WHERE peca_id IN (SELECT pc.id FROM pecas pc JOIN pautas pa ON pa.id = pc.pauta_id WHERE pc.tenant_id = 'cartas-da-orla' AND pa.texto_id IS NOT NULL);" +
    " DELETE FROM decisoes WHERE peca_id IN (SELECT pc.id FROM pecas pc JOIN pautas pa ON pa.id = pc.pauta_id WHERE pc.tenant_id = 'cartas-da-orla' AND pa.texto_id IS NOT NULL);" +
    " DELETE FROM publicacoes WHERE peca_id IN (SELECT pc.id FROM pecas pc JOIN pautas pa ON pa.id = pc.pauta_id WHERE pc.tenant_id = 'cartas-da-orla' AND pa.texto_id IS NOT NULL);" +
    " DELETE FROM pecas WHERE tenant_id = 'cartas-da-orla' AND pauta_id IN (SELECT id FROM pautas WHERE texto_id IS NOT NULL);" +
    " DELETE FROM pautas WHERE tenant_id = 'cartas-da-orla' AND texto_id IS NOT NULL; DELETE FROM textos WHERE tenant_id = 'cartas-da-orla';");
}

/** Version 1's check and dossier (the state the server would have after checking), in the local D1. */
export function check(id: string, o: { risco?: boolean; mudou?: boolean; post?: boolean } = {}) {
  const ev = `ev-${id.slice(0, 8)}`;
  const lines = [
    `INSERT INTO evidencias (id, tenant_id, texto_id, url, titulo, r2_texto, hash, hash_atual, mudou_em) VALUES (${q(ev)}, 'cartas-da-orla', ${q(id)}, ${q(EVIDENCE.url)}, ${q(EVIDENCE.titulo)}, 'evidencias/x.txt', 'h1', 'h1', ${o.mudou ? "datetime('now', '-2 hours')" : "NULL"});`,
    `INSERT INTO afirmacoes (id, tenant_id, texto_id, versao, paragrafo, inicio, fim, trecho, estado, risco, evidencia_id, evidencia_trecho, explicacao) VALUES ` +
      `(${q(`a1-${id.slice(0, 8)}`)}, 'cartas-da-orla', ${q(id)}, 1, 0, 0, 62, ${q(PARAGRAPHS[0].slice(0, 62))}, 'com_evidencia', NULL, ${q(ev)}, ${q(EV_PASSAGE)}, 'O relatório da comissão traz o número e o ano.'),` +
      `(${q(`a3-${id.slice(0, 8)}`)}, 'cartas-da-orla', ${q(id)}, 1, 2, 0, ${PARAGRAPHS[2].length}, ${q(PARAGRAPHS[2])}, 'sem_fonte', NULL, NULL, NULL, 'Nenhuma evidência do dossiê sustenta esta afirmação.')` +
      (o.risco ? `,(${q(`a2-${id.slice(0, 8)}`)}, 'cartas-da-orla', ${q(id)}, 1, 1, 0, 49, ${q(PARAGRAPHS[1].slice(0, 49))}, 'risco', 'acusacao_sem_condenacao', NULL, NULL, 'Acusa pessoa identificada de crime sem condenação nem fonte oficial.')` : "") + ";",
    `UPDATE textos SET conferido_versao = versao, conferido_em = datetime('now') WHERE id = ${q(id)};`,
  ];
  if (o.post) {
    lines.push(
      `INSERT INTO pautas (id, tenant_id, status, origem, titulo, fato_ids_json, documento_ids_json, texto_id, texto_versao) VALUES (${q(`p-${id.slice(0, 8)}`)}, 'cartas-da-orla', 'em_producao', 'manual', ${q(TITLE)}, '[]', '[]', ${q(id)}, 1);`,
      `INSERT INTO pecas (id, tenant_id, pauta_id, formato, status, versao, conteudo_json) VALUES (${q(`pc-${id.slice(0, 8)}`)}, 'cartas-da-orla', ${q(`p-${id.slice(0, 8)}`)}, 'carrossel', 'revisao', 1, ${q(JSON.stringify({ manchete: "A rotina dos contratos sem licitação" }))});`,
    );
  }
  sql(lines.join(" "));
}

export async function look(page: Page, label: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  const w = page.viewportSize()!.width;
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path: `${PRINTS}/${label}-${w}.png`, fullPage: true });
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .setLegacyMode(true).options({ iframes: false }).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), label).toEqual([]);
}

/** Signs in with the design account in the requested language and creates a pasted text; returns the id. */
export async function openText(page: Page, language: "pt-BR" | "en") {
  await page.goto("/entrar");
  await page.evaluate((i) => localStorage.setItem("redacao:idioma", i), language);
  await page.reload();
  await page.locator("input[type=email]").fill(DESIGN.email);
  await page.locator("input[type=password]").fill(DESIGN.senha);
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/t\/[^/]+$/);
  await page.request.put("/api/me/idioma", { data: { idioma: language }, headers: ORIGIN });
  const res = await page.request.post(`/api/t/${OUTLET}/textos`, { data: { titulo: TITLE, texto: PARAGRAPHS.join("\n") }, headers: ORIGIN });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { texto: { id: string } }).texto.id;
}

const A = {
  "pt-BR": {
    assinar: "Assinar a publicação", assinado: /Publicação assinada por/, checklistAssinado: "checklist: assinado", fechar: "Fechar",
    duas: "duas opiniões: DeepSeek e Claude", outroLado: "Procurei o outro lado", quem: "Quem você procurou", meio: "Por qual meio", registrar: "Registrar",
    procurado: /Outro lado procurado: Assessoria do vereador/, opiniao: "É opinião", minha: /Afirmação sua \(opinião\)/, zeroAbertas: "0 marcas abertas",
    comandos: "Comandos", buscaCitar: "Citar", citar: "Citar do dossiê", adicionarDossie: "Adicionar ao dossiê?", agoraNao: "Agora não",
    manual: "Manual de redação", evitar: "Evitar", pede: "O manual pede", acrescentarRegra: "Acrescentar regra", porTema: "Por tema", politica: "Política partidária",
  },
  en: {
    assinar: "Sign off the publication", assinado: /Publication signed off by/, checklistAssinado: "checklist: signed off", fechar: "Close",
    duas: "two opinions: DeepSeek and Claude", outroLado: "I contacted the other side", quem: "Who you contacted", meio: "By what means", registrar: "Record",
    procurado: /Other side contacted: Assessoria do vereador/, opiniao: "It's opinion", minha: /Your own claim \(opinion\)/, zeroAbertas: "0 open marks",
    comandos: "Commands", buscaCitar: "Cite", citar: "Cite from the dossier", adicionarDossie: "Add to the dossier?", agoraNao: "Not now",
    manual: "Style guide", evitar: "Avoid", pede: "The guide asks for", acrescentarRegra: "Add rule", porTema: "By topic", politica: "Party politics",
  },
} as const;

const SHIELD = {
  "pt-BR": {
    wayback: /cópia no Wayback/, outroLado: "Outro lado", pedir: "Pedir o outro lado", quem: "Quem você está procurando", pedido: "O pedido",
    copiarFora: "Copiar e mandar por fora", porOnde: "Por onde mandou", registrarEnvio: "Registrar o envio", mandadoFora: /mandado por fora \(e-mail\)/,
    registrarResposta: "Registrar resposta de Assessoria do vereador", aResposta: "A resposta, como chegou", porNoDossie: "Pôr no dossiê",
    respondeu: /respondeu .*; a resposta está no dossiê/, dossie: /^Dossiê/, respostaRotulo: "resposta do outro lado", folha: "Folha para o advogado", folhaPede: "Confira esta versão antes de gerar a folha.", pacote: "Pacote de defesa",
    baixar: "Baixar o pacote de defesa", comCarimbo: /com carimbo de tempo/, publicar: "Publicar a página de fontes", noAr: /página de fontes no ar/,
    cardFinal: /card final “Como apuramos”/, ver: "ver",
  },
  en: {
    wayback: /Wayback copy/, outroLado: "Other side", pedir: "Ask the other side", quem: "Who you are contacting", pedido: "The request",
    copiarFora: "Copy and send it yourself", porOnde: "How you sent it", registrarEnvio: "Record that it was sent", mandadoFora: /sent outside the app \(email\)/,
    registrarResposta: "Record reply from Assessoria do vereador", aResposta: "The reply, as it arrived", porNoDossie: "Add to the dossier",
    respondeu: /replied .*; the reply is in the dossier/, dossie: /^Dossier/, respostaRotulo: "reply from the other side", folha: "Sheet for the lawyer", folhaPede: "Check this version before making the sheet.", pacote: "Defense package",
    baixar: "Download the defense package", comCarimbo: /with a timestamp/, publicar: "Publish the sources page", noAr: /sources page live/,
    cardFinal: /final “How we reported this” card/, ver: "view",
  },
} as const;

const DOC = {
  "pt-BR": {
    documentos: "Documentos", enviar: "Enviar PDF", pergunte: "Pergunte ao documento", perguntar: "Perguntar", paginas: /3 páginas · busca por palavra/,
    citada: /resposta do modelo, presa às citações/, usar: "Usar como evidência (página 2)", naoAchei: "Não encontrei no documento.", traz: "O que o documento traz",
    pdfRotulo: "página de documento do dossiê", dossie: /^Dossiê/,
  },
  en: {
    documentos: "Documents", enviar: "Upload PDF", pergunte: "Ask the document", perguntar: "Ask", paginas: /3 pages · search by word/,
    citada: /model's answer, tied to the citations/, usar: "Use as evidence (page 2)", naoAchei: "I didn't find it in the document.", traz: "What the document contains",
    pdfRotulo: "page of a dossier document", dossie: /^Dossier/,
  },
} as const;
const PDF_PAGES = [
  ["Relatório da comissão de transporte de Vila Serena", "A Câmara aprovou em 2025 a renovação de 12 contratos de ônibus sem licitação."],
  ["Contratos renovados", "Viação Serena Ltda, CNPJ 98.765.432/0001-98", "Contrato 1: R$ 20 milhões", "Contrato 2: R$ 28 milhões", "Total dos contratos: R$ 48 milhões"],
  ["Anexo", "A frota tem ônibus com mais de 15 anos de uso, segundo a prefeitura."],
];

const REC = {
  "pt-BR": {
    gravacoes: "Gravações", transcrito: /01:30 de áudio · transcrito/, aspas: "Aspas do texto", bate: /bate com a gravação aos 01:13 · entrevista-vereador\.wav/,
    naoAchou: "não encontrada nas gravações nem no dossiê", ler: "Ler a transcrição", ouvir: "Ouvir o trecho (01:13)",
    explicacao: "Bate com a gravação aos 01:13 (entrevista-vereador.wav), palavra por palavra.", rotulo: /bate com a gravação/,
  },
  en: {
    gravacoes: "Recordings", transcrito: /01:30 of audio · transcribed/, aspas: "Quotes in the text", bate: /matches the recording at 01:13 · entrevista-vereador\.wav/,
    naoAchou: "not found in the recordings or the dossier", ler: "Read the transcript", ouvir: "Play the excerpt (01:13)",
    // The explanation comes in the outlet's language (Portuguese), like the server's others.
    explicacao: "Bate com a gravação aos 01:13 (entrevista-vereador.wav), palavra por palavra.", rotulo: /matches the recording/,
  },
} as const;
const INTERVIEW = [
  "O vereador Ícaro Nunes negou as acusações: \u201cNunca recebi um centavo das empresas de ônibus\u201d, disse ele.",
  "Ele também afirmou que \u201ca licitação vai sair em março do ano que vem\u201d.",
];

const LIVE = {
  "pt-BR": {
    lai: "Pedidos de LAI", pedirLai: "Pedir por LAI a Prefeitura de Vila Serena", pedido: /O pedido \(em português/, preparar: "Preparar o pedido",
    pronto: /pronto para protocolar/, registrarProtocolo: "Registrar o protocolo", numero: "Número do protocolo", dataProtocolo: "Data do protocolo", registrar: "Registrar",
    vencido: /prazo vencido sem resposta/, recorrerAte: /Dá para recorrer até/, prepararRecurso: "Preparar o recurso", recurso: /O recurso \(em português/, registrarRecurso: "Registrar o recurso",
    emRecurso: /em recurso/, fontes: "Fontes que mudaram", prazos: "Prazos de LAI", alertaFonte: /A página mudou: Relatório da comissão de transporte/,
    errata: "Post de errata", corrigido: "O que foi corrigido", criar: "Criar o post de errata", criado: /post de errata criado/, verPost: "ver o post",
    processos: "Processos citados no texto", desligado: /acompanhamento desligado/,
  },
  en: {
    lai: "FOI requests (LAI)", pedirLai: "File an FOI request with Prefeitura de Vila Serena", pedido: /The request \(in Portuguese/, preparar: "Prepare the request",
    pronto: /ready to file/, registrarProtocolo: "Record the protocol", numero: "Protocol number", dataProtocolo: "Filing date", registrar: "Record",
    vencido: /deadline passed with no reply/, recorrerAte: /You can appeal until/, prepararRecurso: "Prepare the appeal", recurso: /The appeal \(in Portuguese/, registrarRecurso: "Record the appeal",
    emRecurso: /under appeal/, fontes: "Sources that changed", prazos: "FOI deadlines", alertaFonte: /The page changed: Relatório da comissão de transporte/,
    errata: "Correction post", corrigido: "What was corrected", criar: "Create the correction post", criado: /correction post created/, verPost: "see the post",
    processos: "Court cases cited in the text", desligado: /tracking off/,
  },
} as const;
const LIVE_TEXT = [
  "A Prefeitura de Vila Serena gastou R$ 3 milhões com publicidade em 2025.",
  "O caso corre no processo 1234567-13.2024.8.26.0100, segundo a defesa.",
];

const L = {
  "pt-BR": { editor: "Texto da matéria", conferir: "Conferir", conferido: "conferido", risco2: "Risco", semFonte: "Sem fonte", todos: "Todos", marcas: "Marcas", painelBotao: /marcas? abertas?/, partes: "Partes da matéria", dossie: "Dossiê", texto: "Texto", posts: "Posts", depois: "Depois", mandar: "Mandar para o Instagram", risco: /Falta 1 item do checklist/, checklist: "Checklist de publicação", sustenta: "O que cada fonte sustenta", semPosts: /Nenhum post ainda/, mudou: "Fontes que mudaram", status: "para aprovar" },
  en: { editor: "Story text", conferir: "Check", conferido: "checked", risco2: "Risk", semFonte: "No source", todos: "All", marcas: "Marks", painelBotao: /open marks?/, partes: "Parts of the story", dossie: "Dossier", texto: "Text", posts: "Posts", depois: "After", mandar: "Send to Instagram", risco: /1 publication checklist item is open/, checklist: "Publication checklist", sustenta: "What each source supports", semPosts: /No posts yet/, mudou: "Sources that changed", status: "to approve" },
} as const;

for (const [view, viewport] of Object.entries(SCREENS)) {
  for (const language of ["pt-BR", "en"] as const) {
    test.describe(`${view} · ${language}`, () => {
      test.use({ viewport, deviceScaleFactor: view === "celular" ? 2 : 1 });
      test.afterEach(async ({ page }) => {
        await page.request.put("/api/me/idioma", { data: { idioma: "pt-BR" }, headers: ORIGIN }).catch(() => {});
      });
      const l = L[language];
      const a = A[language];
      const e = SHIELD[language];
      const d = DOC[language];
      const g = REC[language];
      const v = LIVE[language];
      const suffix = language === "en" ? "-en" : "";

      test("Story tabs: an open risk locks Instagram with the list; Dossier, Posts and After", async ({ page }) => {
        clean();
        const id = await openText(page, language);
        check(id, { risco: true, mudou: true });
        await page.goto(`/t/${OUTLET}/textos/${id}`);
        const tabs = page.getByRole("navigation", { name: l.partes });
        await expect(tabs.getByRole("link", { name: l.texto })).toHaveAttribute("aria-current", "page");
        await expect(page.getByRole("heading", { name: TITLE, level: 1 })).toBeVisible();

        // The server refuses: the publishing checklist opens with the list; the list's sentence opens the mark.
        await page.getByRole("button", { name: l.mandar }).click();
        await expect(page.getByRole("alert").filter({ hasText: l.risco })).toBeVisible();
        const list = page.getByRole("region", { name: l.checklist });
        await expect(list).toBeVisible();
        await list.getByRole("button", { name: /O vereador citado/ }).click();
        // The Marks panel opens with the sentence's card (on mobile, in the bottom sheet).
        const detail = view === "computador" ? page.getByRole("region", { name: l.marcas }) : page.getByRole("dialog", { name: l.marcas });
        await expect(detail.getByText(/Acusa pessoa identificada/)).toBeVisible();
        await look(page, `materia-texto-risco${suffix}`);
        if (view === "celular") await detail.getByRole("button", { name: /Fechar|Close/ }).click();

        await tabs.getByRole("link", { name: l.dossie }).click();
        await expect(page).toHaveURL(/aba=dossie/);
        await part(page, l.sustenta);
        await expect(page.getByRole("heading", { name: l.sustenta })).toBeVisible();
        await expect(page.getByText(EV_PASSAGE)).toBeVisible();
        await look(page, `materia-dossie${suffix}`);

        await tabs.getByRole("link", { name: l.posts }).click();
        await expect(page.getByText(l.semPosts)).toBeVisible();

        await tabs.getByRole("link", { name: l.depois }).click();
        await expect(page.getByRole("heading", { name: l.mudou })).toBeVisible();
        await expect(page.getByRole("link", { name: EVIDENCE.titulo })).toBeVisible();
        await look(page, `materia-depois${suffix}`);
      });

      test("editor: check by block, the mark follows the sentence when typing before it, only the edited block goes back to the model, F8 and filters", async ({ page }) => {
        clean();
        const id = await openText(page, language);
        evidenceReal(id);
        resetCalls();
        await page.goto(`/t/${OUTLET}/textos/${id}`);
        const text = page.getByRole("textbox", { name: l.editor });
        await expect(text).toBeVisible();
        await page.getByRole("button", { name: l.conferir, exact: true }).click();
        const marks = text.locator(".marca-ed");
        await expect(marks).toHaveCount(3);
        expect(callsModel().sort(), "suba o Worker com `npm run dev:e2e` (modelo falso)").toEqual([...PARAGRAPHS].sort());
        const sentence0 = PARAGRAPHS[0];
        await expect(marks.filter({ hasText: "A Câmara renovou" })).toHaveText(sentence0);
        await expect(page.getByRole("button", { name: new RegExp(l.painelBotao.source) })).toContainText(l.conferido);
        await look(page, `editor-conferido${suffix}`);
        // The formatting bar fits on one line at 1440 px with the sidebar and the panel in view (the worst width case on desktop).
        if (view === "computador") expect((await page.getByRole("toolbar", { name: language === "en" ? "Formatting" : "Formatação" }).boundingBox())!.height).toBeLessThan(56);

        // Types before the mark: it stays on the right sentence at once (without waiting for the network).
        resetCalls();
        await text.locator("p").first().click({ position: { x: 4, y: 8 } });
        await page.keyboard.press("Home");
        await page.keyboard.type("Ontem, ");
        // The paragraph's text, without the state name the screen reader hears before the mark.
        await expect.poll(() => text.locator("p").first().evaluate((p) => { const c = p.cloneNode(true) as HTMLElement; c.querySelectorAll(".sr-only").forEach((x) => x.remove()); return c.textContent; })).toBe(`Ontem, ${sentence0}`);
        await expect(marks.filter({ hasText: "A Câmara renovou" })).toHaveText(sentence0);
        // After the pause: saves and only the edited paragraph goes to the model.
        await expect.poll(() => callsModel(), { timeout: 15_000 }).toEqual([`Ontem, ${sentence0}`]);
        await expect(page.getByRole("button", { name: new RegExp(l.painelBotao.source) })).toContainText(l.conferido);
        await expect(marks.filter({ hasText: "A Câmara renovou" })).toContainText(sentence0);
        await expect(marks).toHaveCount(3);

        // F8 goes to the next open mark (the risk, in paragraph 2); Shift+F8 goes back.
        await page.keyboard.press("F8");
        await expect(text.locator(".marca-ativa")).toContainText("O vereador citado");
        await page.keyboard.press("F8");
        await expect(text.locator(".marca-ativa")).toContainText("A cidade gasta mais");
        await page.keyboard.press("Shift+F8");
        await expect(text.locator(".marca-ativa")).toContainText("O vereador citado");

        // Panel: Risk filter (on mobile, the panel opens in the sheet from the counter).
        if (view === "celular") await page.getByRole("button", { name: new RegExp(l.painelBotao.source) }).click();
        const panel = page.getByRole("region", { name: l.marcas });
        // The filters sit in the pinned head (outside the marks region) since the count moved to the top of the column.
        await page.getByRole("group", { name: language === "en" ? "Filter the marks" : "Filtrar as marcas" }).getByRole("button", { name: new RegExp(`^${l.risco2}`) }).click();
        await expect(panel.locator("li[id^=cartao-]")).toHaveCount(1);
        await expect(panel.locator("li[id^=cartao-]")).toContainText("O vereador citado");
        await look(page, `editor-filtro-risco${suffix}`);
      });

      test("assistant: checklist that locks and sign-off, card actions, Ctrl/⌘K, quote with @ and a pasted link", async ({ page }) => {
        clean();
        const id = await openText(page, language);
        evidenceReal(id);
        await page.goto(`/t/${OUTLET}/textos/${id}`);
        const text = page.getByRole("textbox", { name: l.editor });
        await page.getByRole("button", { name: l.conferir, exact: true }).click();
        const marks = text.locator(".marca-ed");
        await expect(marks).toHaveCount(3);
        const counter = page.getByRole("button", { name: new RegExp(l.painelBotao.source) });
        await expect(counter).toContainText(l.conferido);

        // A gating checklist: the open risk holds Instagram; the editor signs the version (it is recorded).
        await page.getByRole("button", { name: l.mandar }).click();
        const list = page.getByRole("region", { name: l.checklist });
        await expect(list.getByRole("button", { name: /O vereador citado/ })).toBeVisible();
        await look(page, `assistente-checklist${suffix}`);
        await list.getByRole("button", { name: a.assinar }).click();
        await expect(list.getByText(a.assinado)).toBeVisible();
        await expect(page.getByRole("button", { name: /^checklist:/ })).toHaveText(a.checklistAssinado);
        await list.getByRole("button", { name: a.fechar, exact: true }).click();

        // The risk's card: two opinions and "I reached the other side" (who, when, by which means). Nothing changes in the text.
        const openCard = async (sentence: RegExp) => {
          if (view === "computador") {
            const panel = page.getByRole("region", { name: l.marcas });
            await panel.getByRole("button", { name: sentence }).click();
            return panel;
          }
          await marks.filter({ hasText: sentence }).click();
          await counter.click();
          return page.getByRole("dialog", { name: l.marcas });
        };
        const card = await openCard(/O vereador citado/);
        await expect(card.getByText(a.duas)).toBeVisible();
        await card.getByRole("button", { name: a.outroLado }).click();
        await card.getByLabel(a.quem).fill("Assessoria do vereador");
        await card.getByLabel(a.meio).selectOption("telefone");
        await card.getByRole("button", { name: a.registrar }).click();
        await expect(card.getByText(a.procurado)).toBeVisible();
        await expect(text).toContainText(PARAGRAPHS[1]);
        // The reviewer's note on this mark is struck through and leaves in under 1 s: the screenshot and axe wait for it to go.
        await expect(page.locator(".nota-risca")).toHaveCount(0);
        await look(page, `assistente-cartao${suffix}`);
        if (view === "celular") await card.getByRole("button", { name: a.fechar, exact: true }).click();

        // "It is opinion": becomes the author's claim and leaves the check; no mark stays open.
        const c2 = await openCard(/A cidade gasta mais/);
        await c2.getByRole("button", { name: a.opiniao }).click();
        await expect(c2.getByText(a.minha)).toBeVisible();
        if (view === "celular") await c2.getByRole("button", { name: a.fechar, exact: true }).click();
        await expect(counter).toContainText(a.zeroAbertas);

        // Ctrl/⌘K: the command palette; "Cite from the dossier" opens the @ menu at the end of the paragraph.
        await text.locator("p").first().click();
        await page.keyboard.press("End");
        await page.keyboard.type(" ");
        await page.keyboard.press("Control+k");
        const commands = page.getByRole("dialog", { name: a.comandos });
        await expect(commands).toBeVisible();
        await page.keyboard.type(a.buscaCitar);
        await look(page, `assistente-comandos${suffix}`);
        await page.keyboard.press("Enter");
        await expect(commands).toBeHidden();
        const menu = page.getByRole("listbox", { name: a.citar });
        await expect(menu).toBeVisible();
        await page.keyboard.type("Rel");
        await expect(menu.getByRole("option", { name: new RegExp(EVIDENCE.titulo) })).toBeVisible();
        await look(page, `assistente-arroba${suffix}`);
        await page.keyboard.press("Enter");
        await expect(menu).toBeHidden();
        await expect(text.locator(".nota-ed")).toHaveText(`[${EVIDENCE.titulo}]`);

        // Pasting a bare link: pastes in the text and offers to put it in the dossier.
        await page.evaluate(() => {
          const dt = new DataTransfer();
          dt.setData("text/plain", "https://prefeitura.example/nota-oficial");
          document.querySelector(".ProseMirror")!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
        });
        const offer = page.getByRole("status").filter({ hasText: a.adicionarDossie });
        await expect(offer).toBeVisible();
        await expect(text).toContainText("https://prefeitura.example/nota-oficial");
        await offer.getByRole("button", { name: a.agoraNao }).click();
        await expect(offer).toBeHidden();
        // The reporting was recorded on the server, with who did it.
        const state = await (await page.request.get(`/api/t/${OUTLET}/textos/${id}`)).json() as { afirmacoes: { trecho: string; apuracao: { tipo: string; porNome: string } | null }[] };
        expect(state.afirmacoes.map((x) => x.apuracao?.tipo ?? null).sort()).toEqual(["opiniao", "outro_lado", null].sort());
      });

      test("style guide and audit: the rule points in the text; the marks by theme and the ignored ones", async ({ page }) => {
        clean();
        const id = await openText(page, language);
        await page.goto(`/t/${OUTLET}/textos?ver=manual`);
        await expect(page.getByRole("heading", { name: a.manual, level: 2 })).toBeVisible();
        await page.getByLabel(a.evitar).fill("vereador");
        await page.getByLabel(a.pede).fill("parlamentar");
        await page.getByRole("button", { name: a.acrescentarRegra }).click();
        await expect(page.getByText("parlamentar", { exact: true })).toBeVisible();
        await look(page, `textos-manual${suffix}`);

        await page.goto(`/t/${OUTLET}/textos/${id}`);
        const text = page.getByRole("textbox", { name: l.editor });
        await expect(text.locator(".marca-ed").filter({ hasText: /^vereador$/ })).toHaveCount(1);
        await page.getByRole("button", { name: l.conferir, exact: true }).click();
        await expect(page.getByRole("button", { name: new RegExp(l.painelBotao.source) })).toContainText(l.conferido);

        await page.goto(`/t/${OUTLET}/textos?ver=auditoria`);
        const audit = page.getByRole("table", { name: a.porTema });
        await expect(audit).toBeVisible();
        await expect(audit.getByRole("row", { name: new RegExp(a.politica) })).toContainText("1");
        await look(page, `textos-auditoria${suffix}`);
      });

      test("legal shield: other-side request copied, reply in the dossier, defense package downloaded and public sources page", async ({ page }) => {
        clean();
        const id = await openText(page, language);
        evidenceReal(id);
        sql(`UPDATE evidencias SET wayback_estado = 'salvo', wayback_url = 'http://127.0.0.1:8789/wayback/web/20261103101112/${EVIDENCE.url}', wayback_em = '2026-11-03T10:11:12Z' WHERE texto_id = '${id}';`);
        await page.goto(`/t/${OUTLET}/textos/${id}`);
        await page.getByRole("button", { name: l.conferir, exact: true }).click();
        await expect(page.getByRole("textbox", { name: l.editor }).locator(".marca-ed")).toHaveCount(3);

        // Other side: the request template carries the risky sentence; copied and sent elsewhere, with when and how.
        await page.goto(`/t/${OUTLET}/textos/${id}?aba=dossie`);
        await part(page, e.dossie);
        await expect(page.getByText(e.wayback)).toBeVisible();
        await part(page, e.outroLado);
        const other = page.getByRole("region", { name: e.outroLado });
        await other.getByRole("button", { name: e.pedir }).click();
        await other.getByLabel(e.quem).fill("Assessoria do vereador");
        await expect(other.getByLabel(e.pedido)).toHaveValue(new RegExp(PARAGRAPHS[1].slice(0, 30)));
        await look(page, `escudo-pedido${suffix}`);
        await other.getByRole("button", { name: e.copiarFora }).click();
        await other.getByLabel(e.porOnde).selectOption("email");
        await other.getByRole("button", { name: e.registrarEnvio }).click();
        const card = other.getByRole("listitem").filter({ hasText: "Assessoria do vereador" });
        await expect(card.getByText(e.mandadoFora)).toBeVisible();

        // The pasted reply enters the dossier.
        await card.getByRole("button", { name: e.registrarResposta }).click();
        await card.getByLabel(e.aResposta).fill("O vereador nega o desvio e diz que as contas foram aprovadas.");
        await card.getByRole("button", { name: e.porNoDossie }).click();
        await expect(card.getByText(e.respondeu)).toBeVisible();
        await part(page, e.dossie);
        await expect(page.getByRole("region", { name: e.dossie }).getByText(e.respostaRotulo).first()).toBeVisible();
        await look(page, `escudo-outro-lado${suffix}`);

        // Defence package: the zip with the pieces, the manifest and the timestamp.
        await part(page, e.pacote);
        const pkg = page.getByRole("region", { name: e.pacote });
        const [download] = await Promise.all([page.waitForEvent("download"), pkg.getByRole("button", { name: e.baixar }).click()]);
        expect(download.suggestedFilename()).toMatch(/^pacote-defesa-.+\.zip$/);
        await expect(pkg.getByText(e.comCarimbo)).toBeVisible();
        const zip = unzipSync(new Uint8Array(readFileSync((await download.path())!)));
        for (const name of ["LEIA-ME.txt", "manifesto.json", "manifesto.json.tsr", "texto/atual.txt", "dossie/evidencias.json", "outro-lado/pedidos.json", "apuracao/decisoes.json"]) expect(Object.keys(zip)).toContain(name);
        expect(Object.keys(zip).some((n) => n.endsWith(".wayback.html"))).toBe(true);
        expect(JSON.parse(strFromU8(zip["outro-lado/pedidos.json"]))[0]).toMatchObject({ paraNome: "Assessoria do vereador", meio: "copiado", canal: "email" });
        await look(page, `escudo-pacote${suffix}`);

        // Sheet for the lawyer: the PDF only exists in production (Browser Rendering does not run in the local Worker), so its
        // HTML goes to the screenshot; an old version asks for the check on the screen itself.
        await expect(pkg.getByRole("button", { name: e.folha })).toBeVisible();
        const sheet = await page.request.get(`/api/t/${OUTLET}/textos/${id}/folha?html=1`);
        expect(sheet.status()).toBe(200);
        const tab = await page.context().newPage();
        await tab.setContent(await sheet.text());
        await expect(tab.getByRole("heading", { level: 1 })).toHaveText("Folha para o advogado"); // the sheet comes out in the outlet's language, not the screen's
        await tab.screenshot({ path: `design/telas/materia/folha-${page.viewportSize()!.width}${suffix}.png`, fullPage: true });
        await tab.close();
        await page.route("**/folha", (route) => route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ code: "nao_conferido", erro: e.folhaPede }) }));
        await pkg.getByRole("button", { name: e.folha }).click();
        await expect(pkg.getByRole("alert")).toContainText(e.folhaPede);
        await look(page, `folha-pede-conferencia${suffix}`);
        await page.unroute("**/folha");

        // Sources page: the other side contacted closed the risk; the checklist allows publishing. The public page shows
        // neither the risky sentence nor the request.
        await page.goto(`/t/${OUTLET}/textos/${id}?painel=dossie`);
        await page.getByRole("button", { name: e.publicar }).click();
        const inAr = page.getByText(e.noAr);
        await expect(inAr).toBeVisible();
        await expect(page.getByRole("checkbox", { name: e.cardFinal })).toBeChecked();
        await look(page, `escudo-pagina-no-ar${suffix}`);
        const url = await inAr.getByRole("link", { name: e.ver, exact: true }).getAttribute("href");
        await page.goto(url!);
        await expect(page.getByRole("heading", { level: 1 })).toHaveText("Contratos sem concorrência");
        await expect(page.getByText(EV_PASSAGE)).toBeVisible();
        await expect(page.locator("body")).not.toContainText("Assessoria do vereador");
        await expect(page.locator("body")).not.toContainText(PARAGRAPHS[1]);
        await look(page, `pagina-de-fontes${suffix}`);
      });

      test("ask the document: PDF read by page, answer cited and checked, the passage becomes evidence", async ({ page }) => {
        clean();
        const id = await openText(page, language);
        await page.goto(`/t/${OUTLET}/textos/${id}?aba=dossie`);
        await part(page, d.documentos);
        const docs = page.getByRole("region", { name: d.documentos });
        await docs.locator("input[type=file]").setInputFiles({ name: "relatorio-comissao.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdfFake(PDF_PAGES)) });
        const card = docs.getByRole("listitem").filter({ hasText: "relatorio-comissao.pdf" });
        await expect(card.getByText(d.paginas)).toBeVisible({ timeout: 30_000 });

        // The answer only comes with the page and the literal passage (the fake model cites the line; the server checks).
        await card.getByLabel(d.pergunte).fill("Qual o valor total?");
        await card.getByRole("button", { name: d.perguntar, exact: true }).click();
        await expect(card.getByText(d.citada)).toBeVisible();
        await expect(card.locator("mark", { hasText: "Total dos contratos: R$ 48 milhões" })).toBeVisible();
        // What is not in the document: "not found", without an invented answer.
        await card.getByLabel(d.pergunte).fill("Quem pilotava o helicóptero?");
        await card.getByRole("button", { name: d.perguntar, exact: true }).click();
        await expect(card.getByText(d.naoAchei)).toBeVisible();
        await card.getByText(d.traz).click();
        await expect(card.getByText("98.765.432/0001-98")).toBeVisible();
        await look(page, `documento-resposta${suffix}`);

        // The cited passage becomes dossier evidence (a document page, without an external link).
        await card.getByRole("button", { name: d.usar }).click();
        await part(page, d.dossie);
        await expect(page.getByRole("region", { name: d.dossie }).getByText(d.pdfRotulo).first()).toBeVisible();
        await look(page, `documento-evidencia${suffix}`);
      });

      test("quotes against the recording: the transcribed audio, the quote that matches at mm:ss with the playable passage and the one that does not", async ({ page }) => {
        clean();
        await openText(page, language);
        const res = await page.request.post(`/api/t/${OUTLET}/textos`, { data: { titulo: "Entrevista com o vereador", texto: INTERVIEW.join("\n") }, headers: ORIGIN });
        const id = ((await res.json()) as { texto: { id: string } }).texto.id;
        await page.goto(`/t/${OUTLET}/textos/${id}?aba=dossie`);
        await part(page, g.gravacoes);
        const rec = page.getByRole("region", { name: g.gravacoes });
        await rec.locator("input[type=file]").setInputFiles({ name: "entrevista-vereador.wav", mimeType: "audio/wav", buffer: Buffer.from(fakeWav(2)) });
        await expect(rec.getByText(g.transcrito)).toBeVisible({ timeout: 30_000 });
        const quotes = rec.getByRole("listitem").filter({ hasText: "Nunca recebi um centavo" });
        await expect(quotes.getByText(g.bate)).toBeVisible();
        await expect(quotes.getByRole("button", { name: g.ouvir })).toBeVisible();
        await expect(rec.getByRole("listitem").filter({ hasText: "março do ano que vem" }).getByText(g.naoAchou)).toBeVisible();
        await rec.getByText(g.ler).click();
        await expect(rec.getByText("Olha, eu nunca recebi um centavo das empresas de ônibus. Isso é mentira.")).toBeVisible();
        // The audio plays with Range (the browser jumps to the minute).
        const audio = await page.request.get(`/api/t/${OUTLET}/textos/${id}/gravacoes/${await rec.locator("audio").getAttribute("src").then((s) => s!.split("/gravacoes/")[1].split("/")[0])}/audio`, { headers: { range: "bytes=0-3" } });
        expect(audio.status()).toBe(206);
        expect((await audio.body()).toString("latin1")).toBe("RIFF");
        await look(page, `gravacao-aspas${suffix}`);

        // In the text: the matching quote gets the green mark with the minute's card and the playable passage.
        await page.goto(`/t/${OUTLET}/textos/${id}`);
        const text = page.getByRole("textbox", { name: l.editor });
        await expect(text.locator(".marca-ed").filter({ hasText: "Nunca recebi um centavo" })).toHaveCount(1);
        let card;
        if (view === "computador") {
          card = page.getByRole("region", { name: l.marcas });
          await card.getByRole("button", { name: /Nunca recebi um centavo/ }).click();
        } else {
          await text.locator(".marca-ed").filter({ hasText: "Nunca recebi um centavo" }).click();
          await page.getByRole("button", { name: new RegExp(l.painelBotao.source) }).click();
          card = page.getByRole("dialog", { name: l.marcas });
        }
        await expect(card.getByText(g.explicacao)).toBeVisible();
        await expect(card.getByRole("button", { name: g.ouvir })).toBeVisible();
        await look(page, `gravacao-marca${suffix}`);
      });

      test("living story: FOI request with an expired deadline and appeal; alert from a changed source becomes a correction post", async ({ page }) => {
        clean();
        await openText(page, language);
        const res = await page.request.post(`/api/t/${OUTLET}/textos`, { data: { titulo: "Publicidade da prefeitura", texto: LIVE_TEXT.join("\n") }, headers: ORIGIN });
        const id = ((await res.json()) as { texto: { id: string } }).texto.id;
        sql(`INSERT INTO evidencias (id, tenant_id, texto_id, url, titulo, r2_texto, hash, hash_atual, mudou_em) VALUES ('ev-${id.slice(0, 8)}', 'cartas-da-orla', '${id}', '${EVIDENCE.url}', '${EVIDENCE.titulo}', 'evidencias/x.txt', 'h1', 'h2', datetime('now', '-2 hours'));`);
        await page.goto(`/t/${OUTLET}/textos/${id}`);
        await page.getByRole("button", { name: l.conferir, exact: true }).click();
        await expect(page.getByRole("textbox", { name: l.editor }).locator(".marca-ed").filter({ hasText: "gastou R$ 3 milhões" })).toHaveCount(1);

        // LAI: the unsourced sentence with a public body becomes the request (in Portuguese, with the legal basis); the filing
        // from 25 days ago expired without an answer, and the appeal comes out ready (art. 15).
        await page.goto(`/t/${OUTLET}/textos/${id}?aba=dossie`);
        await part(page, v.lai);
        const lai = page.getByRole("region", { name: v.lai });
        await lai.getByRole("button", { name: v.pedirLai }).click();
        // Its own parameter: opening the other-side request does not erase this draft, nor the other way round.
        await expect(page).toHaveURL(/[?&]lai=0/);
        expect(page.url()).not.toContain("pedir=");
        await expect(lai.getByLabel(v.pedido)).toHaveValue(/Lei nº 12\.527\/2011/);
        await look(page, `lai-pedido${suffix}`);
        await lai.getByRole("button", { name: v.preparar }).click();
        const card = lai.getByRole("listitem").filter({ hasText: "Prefeitura de Vila Serena" });
        await expect(card.getByText(v.pronto)).toBeVisible();
        await card.getByRole("button", { name: v.registrarProtocolo }).click();
        await card.getByLabel(v.numero).fill("00106.000123/2026-11");
        const ha25 = new Date(Date.now() - 25 * 86_400_000).toISOString().slice(0, 10);
        await card.getByLabel(v.dataProtocolo).fill(ha25);
        await card.getByRole("button", { name: v.registrar, exact: true }).click();
        await expect(card.getByText(v.vencido)).toBeVisible();
        await expect(card.getByText(v.recorrerAte)).toBeVisible();
        // Expired without an answer moves ahead and opens by itself, on a new visit.
        await page.goto(`/t/${OUTLET}/textos/${id}?aba=dossie`);
        await expect(partLine(page, v.lai)).toHaveAttribute("aria-expanded", "true");
        await card.getByRole("button", { name: v.prepararRecurso }).click();
        await expect(card.getByLabel(v.recurso)).toHaveValue(/art\. 15 da Lei nº 12\.527\/2011/);
        await look(page, `lai-recurso${suffix}`);
        await card.getByRole("button", { name: v.registrarRecurso }).click();
        await expect(card.getByText(v.emRecurso)).toBeVisible();

        // After: the changed-source alert becomes a new correction post, with the person's note; the LAI deadline and the
        // cited case (without the DataJud key, off) appear too.
        await page.goto(`/t/${OUTLET}/textos/${id}?aba=depois`);
        await expect(page.getByRole("heading", { name: v.prazos })).toBeVisible();
        await expect(page.getByRole("region", { name: v.processos }).getByText(v.desligado)).toBeVisible();
        const sources = page.getByRole("region", { name: v.fontes });
        const alert = sources.getByRole("listitem").filter({ hasText: v.alertaFonte });
        await alert.getByRole("button", { name: v.errata }).click();
        await alert.getByLabel(v.corrigido).fill("O valor certo é R$ 2 milhões, não R$ 3 milhões, segundo o relatório revisto.");
        await look(page, `depois-errata${suffix}`);
        await alert.getByRole("button", { name: v.criar }).click();
        await expect(alert.getByText(v.criado)).toBeVisible();
        await expect(alert.getByRole("link", { name: v.verPost })).toBeVisible();
        await look(page, `depois-alertas${suffix}`);
      });

      test("Posts tab: the piece linked to the text, with its status", async ({ page }) => {
        clean();
        const id = await openText(page, language);
        check(id, { post: true });
        await page.goto(`/t/${OUTLET}/textos/${id}?aba=posts`);
        const post = page.getByRole("link", { name: /A rotina dos contratos sem licitação/ });
        await expect(post).toBeVisible();
        await expect(post).toContainText(l.status);
        await look(page, `materia-posts${suffix}`);
        await post.click();
        await expect(page).toHaveURL(new RegExp(`/t/${OUTLET}/p/pc-`));
      });
    });
  }
}
