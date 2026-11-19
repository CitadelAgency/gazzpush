// Card preview in the browser: the same src/templates/card.html as the render (Browser Rendering), filled here with the
// form's brand. No illustration: the brand's plain background, as a piece comes out when there is no art.
import type { Card } from "../../../src/lib/cards";
import { cardExtras } from "../../../src/lib/cardHtml";
import { compositionClass, fromRoleColors, type ParamsStyle } from "../../../src/lib/style";
import card from "../../../src/templates/card.html?raw";
import nunito from "../../../assets/fonts/nunito-latin.woff2?url";
import quicksand from "../../../assets/fonts/quicksand-latin.woff2?url";
import sourceSans from "../../../assets/fonts/source-sans-3-latin.woff2?url";
import sourceSerif from "../../../assets/fonts/source-serif-4-latin.woff2?url";
import inter from "../../../assets/fonts/inter-latin.woff2?url";
import archivo from "../../../assets/fonts/archivo-latin.woff2?url";
import { waterTagBrand, type WaterBrand } from "../../../src/lib/watermark";
import { CATALOG_SOURCES, DEFAULT_PAIR, titleClass, fromPairWeights, type SourcesPair } from "../../../src/lib/typography";
import { deskInCard, localeContent, textsContent, type ContentLanguage } from "../../../src/lib/contentLanguage";

export type Colors = { fundo: string; texto: string; acento: string };
/** The render's neutral palette (src/lib/render.ts) when the outlet does not choose colours. */
export const DEFAULT_COLORS: Colors = { fundo: "#1f2a24", texto: "#fffcf6", acento: "#b3e9c2" };

export const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const SOURCE_URL: Record<string, string> = {
  "nunito-latin.woff2": nunito, "quicksand-latin.woff2": quicksand, "source-sans-3-latin.woff2": sourceSans,
  "source-serif-4-latin.woff2": sourceSerif, "inter-latin.woff2": inter, "archivo-latin.woff2": archivo,
};

/** The pair's fonts by URL (the srcdoc inherits the page's origin) instead of embedded base64. Serves both templates. */
export const withSources = (tpl: string, pair: SourcesPair = DEFAULT_PAIR) => {
  const def = CATALOG_SOURCES[pair];
  const weights = fromPairWeights(pair);
  return tpl
    .replace("url(data:font/woff2;base64,{{FONT_BODY}})", `url(${SOURCE_URL[def.corpo.arquivo]})`)
    .replace("url(data:font/woff2;base64,{{FONT_DISPLAY}})", `url(${SOURCE_URL[def.destaque.arquivo]})`)
    .replace("{{?FONT_BODY_WEIGHT}}", weights.FONT_BODY_WEIGHT)
    .replace("{{?FONT_DISPLAY_WEIGHT}}", weights.FONT_DISPLAY_WEIGHT);
};
/**
 * `{{KEY}}` (and the optional `{{?KEY}}`) → raw (ready HTML) or vars (escaped). The preview does not navigate (nothing
 * focusable in the iframe): a link becomes a span, with the same class, so the CTA button and the domain keep their style.
 */
export const fill = (tpl: string, vars: Record<string, string>, raw: Record<string, string>, pair: SourcesPair = DEFAULT_PAIR) => withSources(tpl, pair)
  .replace(/\{\{\??([A-Z_]+)\}\}/g, (_, k: string) => (k in raw ? raw[k] : esc(vars[k] ?? "")))
  .replace(/<a\b([^>]*)>/g, (_, at: string) => `<span${at.match(/\sclass="[^"]*"/)?.[0] ?? ""}>`).replace(/<\/a>/g, "</span>");

/**
 * Sample cover. `arte`: the image in place of the illustration (the Brand tab shows the reference this way); without
 * it, a plain background. `autoral`: the render's author card (src/lib/render.ts, varsCard): no date or eyebrow, the
 * signature in the footer.
 */
export function htmlPreview(o: {
  nome: string; handle: string; cores: Colors; logo: string | null; local: string; hoje?: Date; marcaDagua?: WaterBrand; arte?: string | null;
  autoral?: { assinatura: string; dominio?: string }; fontes?: SourcesPair; idioma?: ContentLanguage;
  /** The template open in the Templates section: the preview comes out in it. */
  estilo?: Pick<ParamsStyle, "composicao" | "caixaTitulo" | "papelCores"> | null;
}): string {
  // The card is the outlet's content: in the post language, not the screen's.
  const tx = textsContent(o.idioma);
  const city = o.idioma === "en" ? deskInCard("cidade", "en") : "Cidade";
  const data = new Intl.DateTimeFormat(localeContent(o.idioma), { day: "2-digit", month: "short", year: "numeric", timeZone: "America/Sao_Paulo" }).format(o.hoje ?? new Date());
  const a = o.autoral;
  const colors = o.estilo ? fromRoleColors(o.cores, o.estilo.papelCores) : o.cores;
  const extras = o.estilo ? { composicao: o.estilo.composicao, caixaTitulo: o.estilo.caixaTitulo, marcaNome: o.nome } : null;
  const cover: Card = { id: "previa", layout: "capa", titulo: "", frases: [] };
  const vars: Record<string, string> = {
    LANG: o.idioma ?? "pt-BR",
    COLOR_BG: colors.fundo, COLOR_INK: colors.texto, COLOR_ACCENT: colors.acento,
    ART_POSITION: "50", ART_POSITION_Y: "50", SLIDE_CLASS: ["cover", titleClass(o.fontes ?? DEFAULT_PAIR), o.estilo ? compositionClass(o.estilo.composicao) : "", o.estilo?.caixaTitulo === "normal" ? "caixa-normal" : ""].filter(Boolean).join(" "), BRAND_NAME: o.nome,
    DATE_LABEL: a ? "" : tx.publicacao, DATE_VALUE: a ? "" : data,
    EYEBROW: a ? "" : o.local ? `${city} · ${o.local}` : city,
    HEADLINE: a ? tx.ideiaExemplo : tx.mancheteExemplo, BODY_TEXT: "",
    FOOTER_LABEL: a ? "" : `${tx.fonte}:`, SOURCE_NAME: a ? a.assinatura.trim() || o.nome : tx.fonteExemplo, SOURCE_URL: "#", CTA_URL: "#",
    DOMAIN: a?.dominio || o.handle,
  };
  const raw: Record<string, string> = {
    FONT_BODY: "", FONT_DISPLAY: "",
    ART_TAG: o.arte ? `<img class="art" src="${esc(o.arte)}" alt="">` : '<div class="art art-flat" aria-hidden="true"></div>',
    BRAND_TAG: o.logo ? `<img class="brand-mark" src="${esc(o.logo)}" alt="">` : `<span class="brand-name">${esc(o.nome)}</span>`,
    // The same watermark as the render (src/lib/watermark.ts).
    WATERMARK: waterTagBrand(o.marcaDagua, { logo: o.logo, handle: o.handle, nome: o.nome }),
    ...(extras ? cardExtras(extras, cover) : {}),
  };
  return fill(card, vars, raw, o.fontes);
}

export { contrast as contraste } from "../../../src/lib/contrast";
