// Prévia do último card (o convite) no navegador: o mesmo src/templates/convite.html do render, com a marca e os textos
// do convite aberto. Arquivo à parte porque a aba Marca o carrega sob demanda (import()), só quando abrem "Convite do fim".
// A prévia usa o nome e o texto do convite que a pessoa está editando.
import convite from "../../../src/templates/convite.html?raw";
import { esc, preencher, type Cores } from "./previa";
import { classeTitulo, type ParFontes } from "../../../src/lib/tipografia";
import { textosConteudo, type IdiomaConteudo } from "../../../src/lib/idiomaConteudo";

export type TextosConvite = { titulo: string; texto: string; acao: string };

export function htmlPreviaConvite(o: { nome: string; handle: string; cores: Cores; logo: string | null; convite: TextosConvite; fontes?: ParFontes; idioma?: IdiomaConteudo }): string {
  // O card é conteúdo do veículo: no idioma dos posts, não no da tela.
  const tx = textosConteudo(o.idioma);
  const iniciais = o.nome.split(/\s+/).map((p) => p[0] ?? "").join("").slice(0, 2).toUpperCase();
  const c = o.convite;
  const vars: Record<string, string> = {
    LANG: o.idioma ?? "pt-BR",
    COLOR_BG: o.cores.fundo, COLOR_INK: o.cores.texto, COLOR_ACCENT: o.cores.acento, BRAND_NAME: o.nome,
    EDITION: tx.noDirect, HEADLINE: c.titulo, BODY_TEXT: c.texto,
    FEATURE_HEADING: tx.comoFunciona, FEATURE_ONE: c.texto, FEATURE_TWO: "",
    AVATAR: iniciais, PHONE_TITLE: o.nome, PHONE_STATUS: "", DEMO_LABEL: "",
    MAIN_CTA: c.acao.trim() || c.titulo, HANDLE_LINE: `${tx.linkNoPerfil} · ${o.handle || o.nome}`, CTA_URL: "#", DOMAIN: o.handle,
    TITLE_CLASS: o.fontes ? classeTitulo(o.fontes) : "",
  };
  const raw: Record<string, string> = {
    FONT_BODY: "", FONT_DISPLAY: "",
    BRAND_TAG: o.logo ? `<img class="brand-mark" src="${esc(o.logo)}" alt="">` : `<span class="brand-name">${esc(o.nome)}</span>`,
    MESSAGES: "",
  };
  return preencher(convite, vars, raw, o.fontes);
}
