// Preview of the last card (the CTA) in the browser: the same src/templates/cta.html as the render, with the brand and
// the open CTA's texts. A separate file because the Brand tab loads it on demand (import()), only when "Closing CTA" is
// opened. The phone conversation, the highlights and the badge come from the CTA's configuration, which the UI does not
// receive: here the defaults from src/lib/render.ts go in, plus a sample conversation, with no numbers (the fact check
// would reject it).
import convite from "../../../src/templates/cta.html?raw";
import { esc, fill, type Colors } from "./preview";
import { titleClass, type SourcesPair } from "../../../src/lib/typography";
import { textsContent, type ContentLanguage } from "../../../src/lib/contentLanguage";

export type TextsInvite = { titulo: string; texto: string; acao: string };

export function htmlPreviewInvite(o: { nome: string; handle: string; cores: Colors; logo: string | null; convite: TextsInvite; fontes?: SourcesPair; idioma?: ContentLanguage }): string {
  // The card is the outlet's content: in the post language, not the screen's.
  const tx = textsContent(o.idioma);
  const initials = (o.nome || "BN").split(/\s+/).map((p) => p[0] ?? "").join("").slice(0, 2).toUpperCase();
  const c = o.convite;
  const vars: Record<string, string> = {
    LANG: o.idioma ?? "pt-BR",
    COLOR_BG: o.cores.fundo, COLOR_INK: o.cores.texto, COLOR_ACCENT: o.cores.acento, BRAND_NAME: o.nome,
    EDITION: tx.noDirect, HEADLINE: c.titulo, BODY_TEXT: c.texto,
    FEATURE_HEADING: tx.comoFunciona, FEATURE_ONE: c.texto, FEATURE_TWO: "",
    AVATAR: initials, PHONE_TITLE: o.nome, PHONE_STATUS: tx.respondeNoDirect, DEMO_LABEL: tx.exemplo,
    MAIN_CTA: c.acao.trim() || c.titulo, HANDLE_LINE: `${tx.linkNoPerfil} · ${o.handle || o.nome}`, CTA_URL: "#", DOMAIN: o.handle,
    TITLE_CLASS: o.fontes ? titleClass(o.fontes) : "",
  };
  const msg = (from: "morador" | "pagina", text: string) =>
    `<div class="msg ${from}" data-fit><b>${from === "pagina" ? esc(o.nome || tx.pagina) : tx.morador}</b>${esc(text)}</div>`;
  const raw: Record<string, string> = {
    FONT_BODY: "", FONT_DISPLAY: "",
    BRAND_TAG: o.logo ? `<img class="brand-mark" src="${esc(o.logo)}" alt="">` : `<span class="brand-name">${esc(o.nome)}</span>`,
    MESSAGES: msg("morador", tx.conversaExemplo[0]) + msg("pagina", tx.conversaExemplo[1]),
  };
  return fill(convite, vars, raw, o.fontes);
}
