// The compositions matrix: each layout, in both frames, with the text at LIMITES's limit, in local Chromium, measured by
// the render's own QA (src/lib/qaLayout.ts). Browser Rendering does not run here, and vitest swaps it for a fake: this
// spec is what proves the text fits. It needs no server: the HTML comes from the render's same pure functions.
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { WITH_LABEL, LAYOUTS, LIMITS, LABEL_MAX, type Card, type Layout } from "../../src/lib/cards";
import { inviteRich, cardExtras, tagList, fillTemplate, cardVars, type BaseCard } from "../../src/lib/cardHtml";
import { COMPOSITIONS, type Composition } from "../../src/lib/style";
import { CAROUSEL_HEIGHT, HEIGHT_R916, qaCard } from "../../src/lib/qaLayout";
import { CATALOG_SOURCES, SOURCES_PAIRS, fromPairWeights, type SourcesPair } from "../../src/lib/typography";

const template = (name: string) => readFileSync(`src/templates/${name}`, "utf8");
const source = (file: string) => readFileSync(`assets/fonts/${file}`).toString("base64");
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

/** Truly wide words: capitals, accents and numbers, without extra spaces, cut at the limit. */
const TEXT = "PREFEITURA ANUNCIA INTERDIÇÃO DA PONTE NA AVENIDA SANTOS DUMONT DURANTE QUINZE DIAS PARA OBRAS EMERGENCIAIS DE RECUPERAÇÃO ESTRUTURAL COM DESVIO PELA RUA MARECHAL DEODORO E REFORÇO NO TRANSPORTE PÚBLICO MUNICIPAL ";
const fill = (n: number) => TEXT.repeat(Math.ceil(n / TEXT.length)).slice(0, n).replace(/\s+$/, "X");
const common = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

/** The number's title sits at 190 px: a single 16-letter word fits at no width, and the QA is what blocks it. */
const NUMBER_TITLE = "R$ 5 MIL POR MÊS";

function cardInLimit(layout: Layout): Card {
  const l = LIMITS[layout];
  const n = l.frasesMax;
  const each = Math.min(l.frase ?? Infinity, Math.floor(l.corpo / n));
  const title = layout === "numero" ? NUMBER_TITLE : layout === "convite" ? common(fill(l.titulo)) : fill(l.titulo);
  return {
    id: "c1", layout, titulo: title,
    frases: Array.from({ length: n }, () => ({ texto: common(fill(each)), fatoId: null, ...(WITH_LABEL.includes(layout) ? { rotulo: common(fill(LABEL_MAX)) } : {}) })),
  };
}

const base = (pair: SourcesPair): BaseCard => ({
  autoral: false, idioma: "pt-BR", par: pair, cores: { fundo: "#1f2a24", texto: "#fffcf6", acento: "#b3e9c2" }, marcaNome: "Gazeta do Guarujá",
  editoria: "Cidade", eyebrowCapa: "Cidade · Enseada", dataLabel: "Ocorrência", dataValor: "02 de nov. de 2026",
  fonteNome: "Prefeitura do Guarujá", fonteUrl: "https://exemplo.example/n", ctaUrl: "https://gazeta.example", dominio: "gazeta.example",
});

interface Options { patrocinio?: string; rico?: boolean; publicidade?: string; composicao?: Composition; cores?: BaseCard["cores"]; marcaDagua?: boolean; arte?: string }

function html(card: Card, pair: SourcesPair, r916: boolean, o: Options = {}) {
  const def = CATALOG_SOURCES[pair];
  const b: BaseCard = {
    ...base(pair), ...(o.cores ? { cores: o.cores } : {}), ...(o.composicao ? { composicao: o.composicao } : {}),
    ...(o.publicidade ? { publicidade: { rotulo: "Publicidade", anunciante: o.publicidade } } : {}),
    ...(o.patrocinio ? { patrocinio: { rotulo: "Publicidade", oferecimento: "Oferecimento", nome: o.patrocinio, logo: null } } : {}),
  };
  const vars: Record<string, string> = {
    FONT_BODY: source(def.corpo.arquivo), FONT_DISPLAY: source(def.destaque.arquivo), ...fromPairWeights(pair),
    ...cardVars(b, card, "carrossel"), ...(r916 ? { FORMAT_CLASS: "r916" } : {}),
  };
  const raw: Record<string, string> = {
    ART_TAG: `<img class="art" src="${o.arte ?? PNG}" alt="">`, BRAND_TAG: '<span class="brand-name">Gazeta do Guarujá</span>',
    LIST_TAG: tagList(card), WATERMARK: o.marcaDagua ? '<div class="marca-dagua canto"><span>@gazetadoguaruja</span></div>' : "", ...cardExtras(b, card),
  };
  if (!o.rico) return fillTemplate(template("card.html"), vars, raw);
  const r = inviteRich({
    titulo: "Mande sua pauta no direct da página", texto: "A gente confere antes de postar.", acao: "Mandar no direct",
    telefone: { titulo: "Gazeta", status: "online", mensagens: [{ de: "morador", texto: "Oi! Vi uma coisa aqui no bairro, posso mandar?" }, { de: "pagina", texto: "Pode mandar. A gente confere antes de postar." }] },
  }, { nome: "Gazeta do Guarujá", handle: "@gazeta" }, pair);
  return fillTemplate(template("cta.html"), { ...vars, ...r.vars }, { ...raw, MESSAGES: r.mensagens });
}

const LONG_ADVERTISER = "Supermercado Bom Preço da Enseada e Região do Guarujá, Bertioga e Vicente de Carvalho".slice(0, 80);
const LONG_SPONSOR = "Supermercado Bom Preço da Enseada e Vicente de Carvalho".slice(0, 60);
const FRAMES = [{ nome: "4:5", r916: false, altura: CAROUSEL_HEIGHT }, { nome: "9:16", r916: true, altura: HEIGHT_R916 }];

for (const q of FRAMES) {
  test.describe(`frame ${q.nome}`, () => {
    test.use({ viewport: { width: 1080, height: q.altura } });
    for (const pair of SOURCES_PAIRS) {
      for (const layout of LAYOUTS) {
        test(`${layout}, fonts ${pair}`, async ({ page }) => {
          await page.setContent(html(cardInLimit(layout), pair, q.r916), { waitUntil: "load" });
          const { metricas: metrics, ok } = await qaCard(page, { promo: layout === "convite", altura: q.altura });
          expect(ok, JSON.stringify(metrics)).toBe(true);
        });
      }
      test(`rich CTA, fonts ${pair}`, async ({ page }) => {
        await page.setContent(html(cardInLimit("convite"), pair, q.r916, { rico: true }), { waitUntil: "load" });
        const { metricas: metrics, ok } = await qaCard(page, { promo: true, altura: q.altura });
        expect(ok, JSON.stringify(metrics)).toBe(true);
      });
      test(`rich CTA with advertising seal, fonts ${pair}`, async ({ page }) => {
        await page.setContent(html(cardInLimit("convite"), pair, q.r916, { rico: true, publicidade: LONG_ADVERTISER }), { waitUntil: "load" });
        const { metricas: metrics, ok } = await qaCard(page, { promo: true, altura: q.altura });
        expect(ok, JSON.stringify(metrics)).toBe(true);
      });
      // The advertising badge, with the longest advertiser name the catalogue accepts.
      for (const layout of LAYOUTS) {
        test(`${layout} with advertising seal, fonts ${pair}`, async ({ page }) => {
          await page.setContent(html(cardInLimit(layout), pair, q.r916, { publicidade: LONG_ADVERTISER }), { waitUntil: "load" });
          await expect(page.locator(".selo-publi")).toHaveCount(1);
          const { metricas: metrics, ok } = await qaCard(page, { promo: layout === "convite", altura: q.altura });
          expect(ok, JSON.stringify(metrics)).toBe(true);
        });
      }
      // The sponsorship strip in its reserved place, with the longest name.
      for (const composition of COMPOSITIONS) {
        for (const layout of LAYOUTS.filter((l) => l !== "convite")) {
          test(`${layout} in ${composition} with sponsorship, fonts ${pair}`, async ({ page }) => {
            await page.setContent(html(cardInLimit(layout), pair, q.r916, { composicao: composition, patrocinio: LONG_SPONSOR, marcaDagua: true }), { waitUntil: "load" });
            await expect(page.locator(".faixa-oferece")).toHaveCount(1);
            const { metricas: metrics, ok } = await qaCard(page, { promo: false, altura: q.altura });
            expect(ok, JSON.stringify(metrics)).toBe(true);
          });
        }
      }
      // The four compositions, in the worst case: text at the limit, advertising badge and watermark in the corner.
      for (const composition of COMPOSITIONS.filter((c) => c !== "padrao")) {
        for (const layout of LAYOUTS) {
          test(`${layout} in ${composition}, fonts ${pair}`, async ({ page }) => {
            await page.setContent(html(cardInLimit(layout), pair, q.r916, { composicao: composition, publicidade: LONG_ADVERTISER, marcaDagua: true }), { waitUntil: "load" });
            await expect(page.locator(".card")).toHaveClass(layout === "convite" ? /^(?!.*comp-)/ : new RegExp(`comp-${composition}`));
            const { metricas: metrics, ok } = await qaCard(page, { promo: layout === "convite", altura: q.altura });
            expect(ok, JSON.stringify(metrics)).toBe(true);
          });
        }
      }
    }
    test("text without contrast over the solid color fails; on the usual card, over the art, the QA does not measure", async ({ page }) => {
      const colors = { fundo: "#808080", texto: "#8c8c8c", acento: "#909090" };
      await page.setContent(html(cardInLimit("capa"), "padrao", q.r916, { composicao: "cartaz", cores: colors }), { waitUntil: "load" });
      const failed = await qaCard(page, { promo: false, altura: q.altura });
      expect(failed.ok).toBe(false);
      expect(failed.metricas.semContraste?.length).toBeGreaterThan(0);
      await page.setContent(html(cardInLimit("capa"), "padrao", q.r916, { cores: colors }), { waitUntil: "load" });
      expect((await qaCard(page, { promo: false, altura: q.altura })).ok).toBe(true);
    });
    test("screenshots of the compositions with real text", async ({ page }) => {
      const art = `data:image/png;base64,${readFileSync("web/e2e/fixtures/news-print.png").toString("base64")}`;
      const c: Card = { id: "c1", layout: "capa", titulo: "Ponte da Enseada fecha por 15 dias para obras", frases: [] };
      const list: Card = { id: "c2", layout: "lista", titulo: "O que muda no trânsito", frases: [{ texto: "Desvio pela Rua Marechal Deodoro", fatoId: null }, { texto: "Mais ônibus nos horários de pico", fatoId: null }, { texto: "Pedestres seguem pela passarela", fatoId: null }] };
      for (const composition of COMPOSITIONS.filter((x) => x !== "padrao")) {
        for (const [name, card] of [["capa", c], ["lista", list]] as const) {
          await page.setContent(html(card, "jornal", q.r916, { composicao: composition, arte: art, publicidade: "Mercado Bom Preço" }), { waitUntil: "load" });
          await page.locator(".card").screenshot({ path: `design/telas/composicoes/${composition}-${name}-${q.r916 ? "916" : "45"}.png` });
        }
      }
    });
    test("screenshots of the proof cards", async ({ page }) => {
      const fact = "f1";
      const cards: Card[] = [
        { id: "d", layout: "documento", titulo: "Diário Oficial do Guarujá", frases: [{ texto: "Fica dispensada a licitação para a contratação emergencial da recuperação da ponte da Enseada", fatoId: fact }] },
        { id: "v", layout: "comparacao", titulo: "Quanto a Prefeitura pagou pela obra", frases: [{ texto: "R$ 12 mil", rotulo: "Em 2024", fatoId: fact }, { texto: "R$ 30 mil", rotulo: "Em 2025", fatoId: fact }] },
        { id: "t", layout: "linha_do_tempo", titulo: "Como a interdição chegou aqui", frases: [{ texto: "Laudo aponta trincas na ponte", rotulo: "3 de março", fatoId: fact }, { texto: "Prefeitura contrata a obra", rotulo: "12 de maio", fatoId: fact }, { texto: "Interdição começa", rotulo: "2 de novembro", fatoId: fact }] },
      ];
      for (const card of cards) {
        await page.setContent(html(card, "jornal", q.r916), { waitUntil: "load" });
        await page.locator(".card").screenshot({ path: `design/telas/composicoes/prova-${card.layout}-${q.r916 ? "916" : "45"}.png` });
      }
    });
    test("poster carries no art; front page shows the outlet's name", async ({ page }) => {
      await page.setContent(html(cardInLimit("capa"), "padrao", q.r916, { composicao: "cartaz" }), { waitUntil: "load" });
      await expect(page.locator(".art")).toHaveCount(0);
      await page.setContent(html(cardInLimit("capa"), "padrao", q.r916, { composicao: "primeira-pagina" }), { waitUntil: "load" });
      await expect(page.locator("header .brand-name")).toHaveText("Gazeta do Guarujá");
    });
  });
}
