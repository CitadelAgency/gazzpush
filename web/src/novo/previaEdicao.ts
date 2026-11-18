// Prévia de cada card na edição do carrossel (Revisão): o mesmo src/templates/card.html do render, com as variáveis de
// src/lib/cardHtml.ts (as mesmas funções que o Worker usa) e a parte fixa do card que a API manda (`previa.base`).
// Ilustração, logo e fotos por URL assinada; a foto acabada de subir, pela URL que o upload devolveu.
import card from "../../../src/templates/card.html?raw";
import convite from "../../../src/templates/convite.html?raw";
import { conviteRico, corpoPorFrase, extrasDoCard, listaTag, varsDoCard, type BaseCard, type ConviteRico } from "../../../src/lib/cardHtml";
import { ehConvite, type Card } from "../../../src/lib/cards";
import { marcaDaguaTag, type MarcaDagua } from "../../../src/lib/marcaDagua";
import { CLASSE_FRASE, type MovimentoReels } from "../../../src/lib/reelsHtml";
import { esc, preencher } from "./previa";

export interface PreviaPeca {
  base: BaseCard;
  nome: string;
  handle: string;
  logo: string | null;
  arte: string | null;
  marcaDagua: MarcaDagua | null;
  imagens: Record<string, string>;
  /** Os convites da marca (índice em marca.ctas); `rico`: o do celular de exemplo, que sai no convite.html. */
  convites: { indice: number; titulo: string; texto: string; rico: ConviteRico | null }[];
  convitePadrao: number;
}

/** HTML de um card da edição. `imagens`: chave da foto → URL (as do servidor e as subidas agora). `r916`: em pé (Reels). */
export function htmlCardEdicao(p: PreviaPeca, c: Card, formato: "post" | "carrossel", imagens: Record<string, string>, r916 = false): string {
  const vars: Record<string, string> = { ...varsDoCard(p.base, c, formato), ...(r916 ? { FORMAT_CLASS: "r916" } : {}) };
  const indice = c.cta ?? p.convitePadrao;
  const rico = ehConvite(c) ? p.convites.find((x) => x.indice === indice)?.rico : null;
  if (rico) {
    const r = conviteRico(rico, { nome: p.nome || null, handle: p.handle || null }, p.base.par, p.base.idioma);
    const brand = p.logo ? `<img class="brand-mark" src="${esc(p.logo)}" alt="">` : `<span class="brand-name">${esc(p.nome || p.handle)}</span>`;
    return preencher(convite, { ...vars, ...r.vars, CTA_URL: rico.url ?? vars.CTA_URL }, { FONT_BODY: "", FONT_DISPLAY: "", BRAND_TAG: brand, MESSAGES: r.mensagens, ...extrasDoCard(p.base, c) }, p.base.par);
  }
  const foto = c.imagem ? imagens[c.imagem] ?? p.imagens[c.imagem] ?? null : null;
  const doCard = c.ilustracao ? imagens[c.ilustracao] ?? p.imagens[c.ilustracao] ?? null : null;
  const arte = foto ?? doCard ?? p.arte;
  const raw: Record<string, string> = {
    FONT_BODY: "", FONT_DISPLAY: "",
    ART_TAG: arte ? `<img class="art" src="${esc(arte)}" alt="">` : '<div class="art art-flat" aria-hidden="true"></div>',
    BRAND_TAG: p.logo ? `<img class="brand-mark" src="${esc(p.logo)}" alt="">` : `<span class="brand-name">${esc(p.nome || p.handle)}</span>`,
    LIST_TAG: listaTag(c),
    ...(r916 && !ehConvite(c) ? { BODY_TEXT: corpoPorFrase(c, vars.BODY_TEXT) } : {}),
    ...extrasDoCard(p.base, c),
    WATERMARK: marcaDaguaTag(p.marcaDagua, { logo: p.logo, handle: p.handle, nome: p.nome }),
  };
  return preencher(card, vars, raw, p.base.par);
}

// A entrada de cada card no Reels (a mesma do src/lib/reelsHtml.ts, em CSS): a arte aproxima devagar nos três movimentos;
// o primeiro card já abre inteiro, e só a arte anda. Só sem "reduzir movimento"; com ele, o card fica parado.
const ENTRADA_REELS = (primeiro: boolean, segundos: number, movimento: MovimentoReels) => `<style>
@media (prefers-reduced-motion: no-preference) {
  .card .art { animation: rl-aproxima ${segundos}s linear both; }
${primeiro || movimento === "seco" ? "" : movimento === "folha" ? `  .card { animation: rl-folha .5s ease-out both; }
` : `  .card header { animation: rl-aparece .4s .05s ease-out both; }
  .card .location, .card h1 { animation: rl-sobe .6s .15s cubic-bezier(.16,1,.3,1) both; }
${[1, 2, 3, 4, 5, 6].map((n) => `  .card .${CLASSE_FRASE}:nth-of-type(${n}), .card .story-list li:nth-child(${n}) { animation: rl-aparece .4s ${0.75 + (n - 1) * 0.6}s ease-out both; }`).join("\n")}
`}}
@keyframes rl-aproxima { from { transform: scale(1.08); } to { transform: scale(1); } }
@keyframes rl-aparece { from { opacity: 0; } to { opacity: 1; } }
@keyframes rl-sobe { from { opacity: 0; transform: translateY(48px); } to { opacity: 1; transform: none; } }
@keyframes rl-folha { from { transform: translateX(100%); } to { transform: none; } }
</style>`;

/** Card do Reels em pé (1080×1920), com a entrada animada da prévia. */
export function htmlCardReels(p: PreviaPeca, c: Card, primeiro: boolean, segundos: number, movimento: MovimentoReels): string {
  return htmlCardEdicao(p, c, "carrossel", {}, true).replace("</head>", `${ENTRADA_REELS(primeiro, segundos, movimento)}</head>`);
}
