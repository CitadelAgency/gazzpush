// Prévia do card no navegador: o mesmo src/templates/card.html do render (Browser Rendering), preenchido aqui com a
// marca do formulário. Sem ilustração: fundo liso da marca, como sai a peça quando não há arte.
import type { Card } from "../../../src/lib/cards";
import { extrasDoCard } from "../../../src/lib/cardHtml";
import { classeComposicao, coresDoPapel, type ParamsEstilo } from "../../../src/lib/estilo";
import card from "../../../src/templates/card.html?raw";
import nunito from "../../../assets/fonts/nunito-latin.woff2?url";
import quicksand from "../../../assets/fonts/quicksand-latin.woff2?url";
import sourceSans from "../../../assets/fonts/source-sans-3-latin.woff2?url";
import sourceSerif from "../../../assets/fonts/source-serif-4-latin.woff2?url";
import inter from "../../../assets/fonts/inter-latin.woff2?url";
import archivo from "../../../assets/fonts/archivo-latin.woff2?url";
import { marcaDaguaTag, type MarcaDagua } from "../../../src/lib/marcaDagua";
import { CATALOGO_FONTES, PAR_PADRAO, classeTitulo, pesosDoPar, type ParFontes } from "../../../src/lib/tipografia";
import { editoriaNoCard, localeConteudo, textosConteudo, type IdiomaConteudo } from "../../../src/lib/idiomaConteudo";

export type Cores = { fundo: string; texto: string; acento: string };
/** Paleta neutra do render (src/lib/render.ts) quando o veículo não escolhe cores. */
export const CORES_PADRAO: Cores = { fundo: "#1f2a24", texto: "#fffcf6", acento: "#b3e9c2" };

export const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const URL_FONTE: Record<string, string> = {
  "nunito-latin.woff2": nunito, "quicksand-latin.woff2": quicksand, "source-sans-3-latin.woff2": sourceSans,
  "source-serif-4-latin.woff2": sourceSerif, "inter-latin.woff2": inter, "archivo-latin.woff2": archivo,
};

/** Fontes do par por URL (o srcdoc herda a origem da página) em vez de base64 embutido. Serve aos dois templates. */
export const comFontes = (tpl: string, par: ParFontes = PAR_PADRAO) => {
  const def = CATALOGO_FONTES[par];
  const pesos = pesosDoPar(par);
  return tpl
    .replace("url(data:font/woff2;base64,{{FONT_BODY}})", `url(${URL_FONTE[def.corpo.arquivo]})`)
    .replace("url(data:font/woff2;base64,{{FONT_DISPLAY}})", `url(${URL_FONTE[def.destaque.arquivo]})`)
    .replace("{{?FONT_BODY_WEIGHT}}", pesos.FONT_BODY_WEIGHT)
    .replace("{{?FONT_DISPLAY_WEIGHT}}", pesos.FONT_DISPLAY_WEIGHT);
};
/**
 * `{{CHAVE}}` (e o opcional `{{?CHAVE}}`) → raw (HTML pronto) ou vars (escapado). A prévia não navega (nada focável no
 * iframe): link vira span, com a mesma classe, para o botão do convite e o domínio manterem o estilo.
 */
export const preencher = (tpl: string, vars: Record<string, string>, raw: Record<string, string>, par: ParFontes = PAR_PADRAO) => comFontes(tpl, par)
  .replace(/\{\{\??([A-Z_]+)\}\}/g, (_, k: string) => (k in raw ? raw[k] : esc(vars[k] ?? "")))
  .replace(/<a\b([^>]*)>/g, (_, at: string) => `<span${at.match(/\sclass="[^"]*"/)?.[0] ?? ""}>`).replace(/<\/a>/g, "</span>");

/**
 * Capa de exemplo. `arte`: a imagem no lugar da ilustração (a aba Marca mostra a referência assim); sem ela, fundo liso.
 * `autoral`: o card de autor do render (src/lib/render.ts, varsCard): sem data nem eyebrow, a assinatura no rodapé.
 */
export function htmlPrevia(o: {
  nome: string; handle: string; cores: Cores; logo: string | null; local: string; hoje?: Date; marcaDagua?: MarcaDagua; arte?: string | null;
  autoral?: { assinatura: string; dominio?: string }; fontes?: ParFontes; idioma?: IdiomaConteudo;
  /** O modelo aberto na seção Modelos: a prévia sai nele. */
  estilo?: Pick<ParamsEstilo, "composicao" | "caixaTitulo" | "papelCores"> | null;
}): string {
  // O card é conteúdo do veículo: no idioma dos posts, não no da tela.
  const tx = textosConteudo(o.idioma);
  const cidade = o.idioma === "en" ? editoriaNoCard("cidade", "en") : "Cidade";
  const data = new Intl.DateTimeFormat(localeConteudo(o.idioma), { day: "2-digit", month: "short", year: "numeric", timeZone: "America/Sao_Paulo" }).format(o.hoje ?? new Date());
  const a = o.autoral;
  const cores = o.estilo ? coresDoPapel(o.cores, o.estilo.papelCores) : o.cores;
  const extras = o.estilo ? { composicao: o.estilo.composicao, caixaTitulo: o.estilo.caixaTitulo, marcaNome: o.nome } : null;
  const capa: Card = { id: "previa", layout: "capa", titulo: "", frases: [] };
  const vars: Record<string, string> = {
    LANG: o.idioma ?? "pt-BR",
    COLOR_BG: cores.fundo, COLOR_INK: cores.texto, COLOR_ACCENT: cores.acento,
    ART_POSITION: "50", ART_POSITION_Y: "50", SLIDE_CLASS: ["cover", classeTitulo(o.fontes ?? PAR_PADRAO), o.estilo ? classeComposicao(o.estilo.composicao) : "", o.estilo?.caixaTitulo === "normal" ? "caixa-normal" : ""].filter(Boolean).join(" "), BRAND_NAME: o.nome,
    DATE_LABEL: a ? "" : tx.publicacao, DATE_VALUE: a ? "" : data,
    EYEBROW: a ? "" : o.local ? `${cidade} · ${o.local}` : cidade,
    HEADLINE: a ? tx.rotuloIdeia : tx.rotuloManchete, BODY_TEXT: "",
    FOOTER_LABEL: a ? "" : `${tx.fonte}:`, SOURCE_NAME: a ? a.assinatura.trim() || o.nome : tx.rotuloFonte, SOURCE_URL: "#", CTA_URL: "#",
    DOMAIN: a?.dominio || o.handle,
  };
  const raw: Record<string, string> = {
    FONT_BODY: "", FONT_DISPLAY: "",
    ART_TAG: o.arte ? `<img class="art" src="${esc(o.arte)}" alt="">` : '<div class="art art-flat" aria-hidden="true"></div>',
    BRAND_TAG: o.logo ? `<img class="brand-mark" src="${esc(o.logo)}" alt="">` : `<span class="brand-name">${esc(o.nome)}</span>`,
    // A mesma marca d'água do render (src/lib/marcaDagua.ts).
    WATERMARK: marcaDaguaTag(o.marcaDagua, { logo: o.logo, handle: o.handle, nome: o.nome }),
    ...(extras ? extrasDoCard(extras, capa) : {}),
  };
  return preencher(card, vars, raw, o.fontes);
}

export { contraste } from "../../../src/lib/contraste";
