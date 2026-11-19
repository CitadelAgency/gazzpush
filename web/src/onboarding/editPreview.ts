// Preview of each card while editing the carousel (Review): the same src/templates/card.html as the render, with the
// variables from src/lib/cardHtml.ts (the same functions the Worker uses) and the card's fixed part the API sends
// (`previa.base`). Illustration, logo and photos by signed URL; a just-uploaded photo, by the URL the upload returned.
import card from "../../../src/templates/card.html?raw";
import convite from "../../../src/templates/cta.html?raw";
import { inviteRich, perSentenceBody, cardExtras, tagList, cardVars, type BaseCard, type InviteRich } from "../../../src/lib/cardHtml";
import { isInvite, type Card } from "../../../src/lib/cards";
import { waterTagBrand, type WaterBrand } from "../../../src/lib/watermark";
import { SENTENCE_CLASS, type MotionReels } from "../../../src/lib/reelsHtml";
import { esc, fill } from "./preview";

export interface PreviewPiece {
  base: BaseCard;
  nome: string;
  handle: string;
  logo: string | null;
  arte: string | null;
  marcaDagua: WaterBrand | null;
  imagens: Record<string, string>;
  /** The brand's CTAs (index into marca.ctas); `rico`: the sample-phone one, which comes out in cta.html. */
  convites: { indice: number; titulo: string; texto: string; rico: InviteRich | null }[];
  convitePadrao: number;
}

/** HTML of an edited card. `imagens`: photo key → URL (the server's and the ones just uploaded). `r916`: upright (Reels). */
export function htmlCardEdit(p: PreviewPiece, c: Card, format: "post" | "carrossel", images: Record<string, string>, r916 = false): string {
  const vars: Record<string, string> = { ...cardVars(p.base, c, format), ...(r916 ? { FORMAT_CLASS: "r916" } : {}) };
  const index = c.cta ?? p.convitePadrao;
  const rich = isInvite(c) ? p.convites.find((x) => x.indice === index)?.rico : null;
  if (rich) {
    const r = inviteRich(rich, { nome: p.nome || null, handle: p.handle || null }, p.base.par, p.base.idioma);
    const brand = p.logo ? `<img class="brand-mark" src="${esc(p.logo)}" alt="">` : `<span class="brand-name">${esc(p.nome || p.handle)}</span>`;
    return fill(convite, { ...vars, ...r.vars, CTA_URL: rich.url ?? vars.CTA_URL }, { FONT_BODY: "", FONT_DISPLAY: "", BRAND_TAG: brand, MESSAGES: r.mensagens, ...cardExtras(p.base, c) }, p.base.par);
  }
  const photo = c.imagem ? images[c.imagem] ?? p.imagens[c.imagem] ?? null : null;
  const fromCard = c.ilustracao ? images[c.ilustracao] ?? p.imagens[c.ilustracao] ?? null : null;
  const art = photo ?? fromCard ?? p.arte;
  const raw: Record<string, string> = {
    FONT_BODY: "", FONT_DISPLAY: "",
    ART_TAG: art ? `<img class="art" src="${esc(art)}" alt="">` : '<div class="art art-flat" aria-hidden="true"></div>',
    BRAND_TAG: p.logo ? `<img class="brand-mark" src="${esc(p.logo)}" alt="">` : `<span class="brand-name">${esc(p.nome || p.handle)}</span>`,
    LIST_TAG: tagList(c),
    ...(r916 && !isInvite(c) ? { BODY_TEXT: perSentenceBody(c, vars.BODY_TEXT) } : {}),
    ...cardExtras(p.base, c),
    WATERMARK: waterTagBrand(p.marcaDagua, { logo: p.logo, handle: p.handle, nome: p.nome }),
  };
  return fill(card, vars, raw, p.base.par);
}

// Each card's entrance in Reels (the same as src/lib/reelsHtml.ts, in CSS): the art zooms in slowly in all three
// motions; the first card opens whole, and only the art moves. Only without "reduce motion"; with it, the card stays still.
const INPUT_REELS = (first: boolean, seconds: number, motion: MotionReels) => `<style>
@media (prefers-reduced-motion: no-preference) {
  .card .art { animation: rl-aproxima ${seconds}s linear both; }
${first || motion === "seco" ? "" : motion === "folha" ? `  .card { animation: rl-folha .5s ease-out both; }
` : `  .card header { animation: rl-aparece .4s .05s ease-out both; }
  .card .location, .card h1 { animation: rl-sobe .6s .15s cubic-bezier(.16,1,.3,1) both; }
${[1, 2, 3, 4, 5, 6].map((n) => `  .card .${SENTENCE_CLASS}:nth-of-type(${n}), .card .story-list li:nth-child(${n}) { animation: rl-aparece .4s ${0.75 + (n - 1) * 0.6}s ease-out both; }`).join("\n")}
`}}
@keyframes rl-aproxima { from { transform: scale(1.08); } to { transform: scale(1); } }
@keyframes rl-aparece { from { opacity: 0; } to { opacity: 1; } }
@keyframes rl-sobe { from { opacity: 0; transform: translateY(48px); } to { opacity: 1; transform: none; } }
@keyframes rl-folha { from { transform: translateX(100%); } to { transform: none; } }
</style>`;

/** An upright Reels card (1080×1920), with the preview's animated entrance. */
export function htmlCardReels(p: PreviewPiece, c: Card, first: boolean, seconds: number, motion: MotionReels): string {
  return htmlCardEdit(p, c, "carrossel", {}, true).replace("</head>", `${INPUT_REELS(first, seconds, motion)}</head>`);
}
