// Author mode (handoffs/2026-11-02-autoral-e-mesa.md). Against `wrangler dev` with the seeded local D1, including
// seeds/author-local.sql (the spec applies it before starting). The `wrangler dev` Worker does not reach a fictional
// feed: reading Substack is covered in test/author.test.ts (simulated fetch), and here the response of POST /api/tenants
// is simulated on the browser's route, landing on the seeded author outlet. Axe 0. Screenshots in design/telas/autoral/.
import { partLine, part } from "./parts";
import { spawnSync } from "node:child_process";
import { expect, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PRINTS = "design/telas/autoral";
const SCREENS = { celular: { width: 390, height: 844 }, computador: { width: 1440, height: 900 } } as const;
const AUTHOR = { id: "cartas-da-orla", slug: "cartas-da-orla", nome: "Cartas da Orla" };
const DESIGN = { email: "design@redacao.dev", senha: "senha-forte-123" };
const IDEAS = [
  "Contratos sem concorrência são a rotina do transporte",
  "A orla que ninguém vê de manhã cedo",
  "Carta a quem chega na cidade em novembro",
];

test.beforeAll(() => {
  const r = spawnSync("npx wrangler d1 execute redacao-db --local --file seeds/author-local.sql", { shell: true, stdio: "ignore" });
  if (r.status !== 0) throw new Error("seed autoral-local.sql falhou");
});

/** The desk starts without texts (each test creates its own). */
function cleanTexts() {
  const sql = ["alertas", "pedidos_lai", "processos", "gravacao_sessoes", "gravacao_segmentos", "gravacao_trechos", "perguntas", "arquivo_paginas_fts", "arquivo_paginas", "arquivos", "afirmacoes", "blocos", "apuracoes", "assinaturas", "marcas_historico", "manual_regras", "pedidos_outro_lado", "texto_versoes", "paginas_fontes", "pacotes_defesa", "recortes", "evidencias", "textos"].map((t) => `DELETE FROM ${t} WHERE tenant_id = 'cartas-da-orla';`).join(" ");
  const r = spawnSync(`npx wrangler d1 execute redacao-db --local --command "${sql}"`, { shell: true, stdio: "ignore" });
  if (r.status !== 0) throw new Error("limpar os textos do veículo de autor falhou");
}

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const TITLE = "Contratos sem concorrência";
const PARAGRAPHS = [
  "A Câmara renovou 12 contratos de ônibus sem licitação em 2025, segundo o relatório da comissão.",
  "O vereador citado desviou dinheiro dos contratos, dizem moradores.",
  "A cidade gasta mais com transporte do que com saúde.",
  "Eu acho que isso diz muito sobre a cidade.",
];
const EVIDENCE = { id: "ev-e2e", url: "https://camara.example/relatorio-transporte", titulo: "Relatório da comissão de transporte", via: false };
/** A claim's mark: the passage is literal from the paragraph (the position comes from it). */
function brand(id: string, paragraph: number, passage: string, state: string, extra: Record<string, unknown> = {}) {
  const home = PARAGRAPHS[paragraph].indexOf(passage);
  return { id, paragrafo: paragraph, inicio: home, fim: home + passage.length, trecho: passage, estado: state, risco: null, evidenciaId: null, evidenciaTrecho: null, explicacao: null, blocoId: `p${paragraph}`,
    incerto: false, aberta: state !== "com_evidencia", apuracao: null, ...extra };
}

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
  await page.getByLabel("E-mail", { exact: true }).fill(DESIGN.email);
  await page.getByLabel("Senha").fill(DESIGN.senha);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/t\/[^/]+$/);
}

for (const [view, viewport] of Object.entries(SCREENS)) {
  test.describe(view, () => {
    test.use({ viewport, deviceScaleFactor: view === "celular" ? 2 : 1 });
    const desktop = view === "computador";

    test("create an author outlet from the Substack URL: the brand comes pre-filled and the 3 ideas appear", async ({ page }) => {
      await signIn(page);
      let request: Record<string, unknown> | null = null;
      // The server's response after reading the feed (simulated: the outlet is the seeded one).
      await page.route("**/api/tenants", async (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        request = route.request().postDataJSON();
        await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ...AUTHOR, modo: "autoral", papel: "admin", textos: 3 }) });
      });
      await page.goto("/novo");
      await page.getByRole("radio", { name: /^Autor/ }).check();
      await expect(page.getByRole("button", { name: "Continuar" })).toBeInViewport();
      const field = page.getByLabel("Endereço do seu Substack");
      await expect(page.getByLabel("Nome do veículo")).not.toHaveAttribute("required", "");
      // Empty: the error stays in the field, with focus on it.
      await page.getByRole("button", { name: "Continuar" }).click();
      await expect(field).toBeFocused();
      await expect(page.getByText("Cole o endereço do seu Substack.")).toBeVisible();
      await field.fill("autora.substack.example");
      await look(page, "novo-autor");
      await page.getByRole("button", { name: "Continuar" }).click();

      await expect(page).toHaveURL(new RegExp(`/novo\\?marca=${AUTHOR.slug}$`));
      expect(request).toEqual({ nome: "", modo: "autoral", substack: "autora.substack.example" });
      // The brand step: what came from Substack, with the author card's signature and the preview without a date or "Source:".
      await expect(page.getByLabel("Assinatura")).toHaveValue("Ana Ribeiro");
      const preview = page.locator("iframe[title^='Prévia do card']");
      await expect(preview).toHaveAttribute("srcdoc", /Ana Ribeiro/);
      expect(await preview.getAttribute("srcdoc")).not.toMatch(/Fonte:|Publicação/);
      await look(page, "marca-autor");

      await page.getByRole("link", { name: "Pular por agora" }).click();
      await expect(page).toHaveURL(new RegExp(`/t/${AUTHOR.slug}$`));
      // round 4: on desktop the chosen idea's headline also appears on the lead sheet; the list's one is the row's h3.
      const idea = (title: string) => page.getByRole("heading", { level: 3, name: title, exact: true });
      await expect(idea(IDEAS[0])).toBeVisible();
      // Another spec may have left one more idea: beyond three (six with the lead sheet), the rest stays in "More ideas".
      const more = partLine(page, "Mais ideias");
      if (await more.isVisible()) await more.click();
      for (const title of IDEAS) await expect(idea(title)).toBeVisible();
      await look(page, "ideias-autor");
    });

    test("defense package: incomplete on the part's row; a failure after leaving reopens the part", async ({ page }) => {
      cleanTexts();
      await signIn(page);
      await page.goto(`/t/${AUTHOR.slug}/textos?novo=colar`);
      await page.getByLabel("Título").fill(TITLE);
      await page.getByRole("textbox", { name: /^Texto/ }).fill(PARAGRAPHS.join("\n"));
      await page.getByRole("button", { name: "Abrir na mesa" }).click();
      await expect(page).toHaveURL(new RegExp(`/t/${AUTHOR.slug}/textos/[^/]+$`));
      await page.goto(`${page.url()}?aba=dossie&parte=pacote`);
      let failure = false;
      await page.route("**/api/t/*/textos/*/pacote", async (route) => {
        await new Promise((r) => setTimeout(r, 700));
        if (failure) return route.fulfill({ status: 500, contentType: "application/json", body: '{"erro":"Pacote caiu."}' });
        await route.fulfill({ status: 200, contentType: "application/zip", body: "zip", headers: { "content-disposition": 'attachment; filename="p.zip"', "x-carimbo-erro": "fora", "x-pacote-fora": "2" } });
      });
      const download = page.getByRole("button", { name: "Baixar o pacote de defesa" });
      const line = partLine(page, "Pacote de defesa");
      await download.click();
      await partLine(page, "Dossiê").click();
      await expect(line).toContainText("baixado sem carimbo de tempo · 2 arquivos fora");
      await part(page, "Pacote de defesa");
      failure = true;
      await download.click();
      await partLine(page, "Dossiê").click();
      await expect(page.getByRole("alert").filter({ hasText: "Pacote caiu." })).toBeVisible();
      await page.unrouteAll({ behavior: "ignoreErrors" });
    });

    test("reviewer desk: pasted text, evidence in the dossier, three marks, Substack and Instagram", async ({ page, context }) => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      cleanTexts();
      await signIn(page);
      await page.goto(`/t/${AUTHOR.slug}`);
      // Texts opens the author outlet's Flow: in the sidebar on desktop, in the account menu on mobile.
      if (desktop) {
        await page.getByRole("complementary", { name: "Veículo e seções" }).getByRole("link", { name: "Textos" }).click();
      } else {
        await page.getByRole("button", { name: /^Conta:/ }).click();
        await page.getByRole("menuitem", { name: "Textos" }).click();
      }
      await expect(page).toHaveURL(new RegExp(`/t/${AUTHOR.slug}/textos$`));
      await expect(page.getByRole("heading", { name: "Textos", level: 1 })).toBeVisible();
      await expect(page.getByText("Nenhum texto ainda.")).toBeVisible();
      // A finished text is the second option. Empty: the error stays in the field.
      await page.getByRole("button", { name: /^Colar/ }).click();
      await expect(page).toHaveURL(/novo=colar/);
      await page.getByRole("button", { name: "Abrir na mesa" }).click();
      await expect(page.getByText("Cole o texto que você quer conferir.")).toBeVisible();
      await page.getByLabel("Título").fill(TITLE);
      await page.getByRole("textbox", { name: /^Texto/ }).fill(PARAGRAPHS.join("\n"));
      await look(page, "textos");
      await page.getByRole("button", { name: "Abrir na mesa" }).click();
      await expect(page).toHaveURL(new RegExp(`/t/${AUTHOR.slug}/textos/[^/]+$`));
      const id = page.url().split("/").at(-1)!;
      await expect(page.getByRole("heading", { name: TITLE, level: 1 })).toBeVisible();
      await expect(page.getByText("ainda não conferido nesta versão")).toBeVisible();

      // The local Worker reaches neither the evidence's page nor the model: the dossier and the check are simulated on the
      // route, over the real state of the saved text.
      const real = await (await page.request.get(`/api/t/${AUTHOR.id}/textos/${id}`)).json();
      const ev = { id: EVIDENCE.id, url: EVIDENCE.url, titulo: EVIDENCE.titulo, conferidaEm: real.texto.criadoEm, mudouEm: null, viaNavegador: false, usada: 0,
        tipoFonte: null, tipoSugerido: null, forca: "sem_tipo", origem: "link", wayback: null };
      let current = real;
      await page.route(`**/api/t/*/textos/${id}`, (route) => (route.request().method() === "GET" ? json(route, current) : route.fallback()));
      let evidenceRequest: unknown = null;
      await page.route(`**/api/t/*/textos/${id}/evidencias`, async (route) => {
        evidenceRequest = route.request().postDataJSON();
        current = { ...real, evidencias: [ev] };
        await json(route, { ...current, evidenciaId: ev.id, existia: false }, 201);
      });
      await page.route(`**/api/t/*/textos/${id}/conferir`, async (route) => {
        await new Promise((r) => setTimeout(r, 400));
        current = {
          ...real,
          texto: { ...real.texto, conferidoVersao: real.texto.versao, conferidoEm: real.texto.criadoEm },
          blocos: real.blocos.map((b: Record<string, unknown>) => ({ ...b, estado: "conferido" })),
          evidencias: [{ ...ev, usada: 1 }],
          afirmacoes: [
            brand("a1", 0, "A Câmara renovou 12 contratos de ônibus sem licitação em 2025", "com_evidencia", {
              evidenciaId: ev.id, evidenciaTrecho: "A Câmara aprovou em 2025 a renovação de 12 contratos de ônibus sem licitação",
              explicacao: "O relatório da comissão traz o número e o ano.",
            }),
            brand("a2", 1, "O vereador citado desviou dinheiro dos contratos", "risco", {
              risco: "acusacao_sem_condenacao", explicacao: "Acusa pessoa identificada de crime sem condenação nem fonte oficial.",
            }),
            brand("a3", 2, "A cidade gasta mais com transporte do que com saúde.", "sem_fonte", { explicacao: "Nenhuma evidência do dossiê sustenta esta afirmação." }),
          ],
        };
        await json(route, current);
      });

      // On mobile the dossier is the row after the text; on desktop, a tab of the panel beside it.
      if (desktop) await page.getByRole("group", { name: "Partes do painel" }).getByRole("button", { name: /^Dossiê/ }).click();
      else {
        await expect(partLine(page, "Dossiê")).toHaveAttribute("aria-expanded", "false");
        await part(page, "Dossiê");
        await expect(page).toHaveURL(/[?&]dossie=aberto/);
      }
      await page.getByLabel("Acrescentar link").fill(EVIDENCE.url);
      await page.getByRole("button", { name: "Acrescentar", exact: true }).click();
      await expect(page.getByRole("link", { name: EVIDENCE.titulo })).toBeVisible();
      expect(evidenceRequest).toEqual({ url: EVIDENCE.url });
      if (!desktop) {
        // A changed source: the dossier arrives open; without a warning, it arrives closed, with the count on the row.
        const withoutWarning = current;
        current = { ...withoutWarning, evidencias: [{ ...ev, mudouEm: real.texto.criadoEm }] };
        await page.goto(`/t/${AUTHOR.slug}/textos/${id}`);
        await expect(partLine(page, "Dossiê")).toHaveAttribute("aria-expanded", "true");
        current = withoutWarning;
        await page.goto(`/t/${AUTHOR.slug}/textos/${id}`);
        await expect(partLine(page, "Dossiê")).toHaveAttribute("aria-expanded", "false");
        await expect(partLine(page, "Dossiê")).toContainText("1 evidência");
      }

      // The Story editor (Phase 2): the marks over the text and one card per mark in the panel.
      await page.getByRole("button", { name: "Conferir", exact: true }).click();
      await expect(page.getByRole("status").filter({ hasText: "conferindo…" })).toBeVisible();
      const text = page.getByRole("textbox", { name: "Texto da matéria" });
      const marks = text.locator(".marca-ed");
      await expect(marks).toHaveCount(3);
      await expect(marks.filter({ hasText: "A Câmara renovou" })).toHaveClass(/shadow-\[inset_0_-1px/);
      await expect(marks.filter({ hasText: "O vereador citado" })).toHaveClass(/bg-terracota-claro/);
      await expect(marks.filter({ hasText: "A cidade gasta mais" })).toHaveClass(/bg-ambar-claro/);
      await expect(page.getByText("1 com evidência").first()).toBeVisible();
      await expect(page.getByText("1 sem fonte", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("1 risco jurídico", { exact: true }).first()).toBeVisible();
      // The body stays what the person pasted: the check marks, it does not rewrite.
      await expect(text).toContainText(PARAGRAPHS[3]);

      // The mark opens the card: on desktop, the panel's card; on mobile, the counter opens the sheet with it.
      if (desktop) {
        await page.getByRole("group", { name: "Partes do painel" }).getByRole("button", { name: /^Marcas/ }).click();
        await page.getByRole("region", { name: "Marcas" }).getByRole("button", { name: /com evidência.*A Câmara renovou/ }).click();
      } else {
        await marks.filter({ hasText: "A Câmara renovou" }).click();
        await page.getByRole("button", { name: /ver a marca/ }).click();
      }
      const detail = desktop ? page.getByRole("region", { name: "Marcas" }) : page.getByRole("dialog", { name: "Marcas" });
      await expect(detail.getByText("A Câmara aprovou em 2025 a renovação de 12 contratos de ônibus sem licitação")).toBeVisible();
      await expect(detail.getByRole("link", { name: EVIDENCE.titulo })).toBeVisible();
      await look(page, "mesa-conferida");
      if (!desktop) {
        await page.getByRole("button", { name: "Fechar" }).click();
        await expect(page.getByRole("dialog", { name: "Marcas" })).toBeHidden();
        await look(page, "mesa-marcas");
      }

      // Copy to Substack: title and paragraphs, with formatting (HTML) and as text.
      await page.getByRole("button", { name: "Copiar para o Substack" }).click();
      await expect(page.getByText("Copiado com a formatação. Cole no editor do Substack.")).toBeVisible();
      // O clipboard do Windows guarda as quebras como CRLF.
      const copied = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n");
      expect(copied).toBe([TITLE, ...PARAGRAPHS].join("\n\n"));

      // Send to Instagram: becomes a lead, goes into carousel production and the screen moves to the post.
      const now = new Date().toISOString().replace("T", " ").slice(0, 19);
      await page.route("**/api/t/*/textos/*/instagram", (route) => json(route, { pautaId: "p-mesa-e2e", pecaId: "peca-mesa-e2e", situacao: "nova" }, 201));
      await page.route("**/api/t/*/pecas/peca-mesa-e2e/status", (route) => json(route, {
        id: "peca-mesa-e2e", status: "rascunho", formato: "carrossel", rodada: 1, versao: 0, erro: null, created_at: now, updated_at: now,
        titulo: TITLE, manchete: null, iniciada_em: now, etapa: "redigir", tentativa: 1,
      }));
      await page.getByRole("button", { name: "Mandar para o Instagram" }).click();
      await expect(page).toHaveURL(new RegExp(`/t/${AUTHOR.slug}/p/peca-mesa-e2e$`));
      await expect(page.getByRole("heading", { name: /^Produzindo/ })).toBeVisible();
      await page.unrouteAll({ behavior: "ignoreErrors" });
    });
  });
}
