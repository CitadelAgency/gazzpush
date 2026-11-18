// O HTML do card a partir do template: variáveis por card e preenchimento. Puro (sem Worker): o render no Browser
// Rendering e a prévia da edição na Revisão (web/src/novo/previaEdicao.ts) montam o mesmo card com estas funções.
import { CLASSE_FRASE } from './reelsHtml';
import { COM_ROTULO, layoutDe, type Card, type Foco, type Layout } from './cards';
import { classeTitulo, type ParFontes } from './tipografia';
import { textosConteudo, type IdiomaConteudo } from './idiomaConteudo';
import { classeComposicao, cssComposicao, type CaixaTitulo, type Composicao } from './estilo';

export const escapeHtml = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** O que não muda de um card para outro da mesma peça (marca, data, fonte, rodapé). O Worker monta (`baseDoCard`). */
export interface BaseCard {
  autoral: boolean;
  /** Idioma do conteúdo do veículo (ausente: português, como nas peças antigas). */
  idioma?: IdiomaConteudo;
  par: ParFontes;
  cores: { fundo: string; texto: string; acento: string };
  marcaNome: string;
  editoria: string;
  eyebrowCapa: string;
  dataLabel: string;
  dataValor: string;
  fonteNome: string;
  fonteUrl: string;
  ctaUrl: string;
  dominio: string;
  /** Resumo do dia: a fonte de cada fato, porque cada card fala de uma notícia. */
  fontesPorFato?: Record<string, { nome: string; url: string }>;
  /** Card de documento: a fonte e a data do fato da frase, com o rótulo da data. */
  fatosDoDocumento?: Record<string, { nome: string; url: string; data: string | null }>;
  rotuloDataFato?: string;
  /** Peça de publicidade: selo em todo card e o anunciante no rodapé, no lugar da fonte. */
  publicidade?: { rotulo: string; anunciante: string };
  /** Molde do card (src/lib/estilo.ts). Ausente: o de sempre. O convite não muda. */
  composicao?: Composicao;
  /** `normal`: título sem caixa alta. Ausente: o de sempre. */
  caixaTitulo?: CaixaTitulo;
  /** Faixa de patrocínio. `logo`: data URI no render, URL assinada na prévia. */
  patrocinio?: { rotulo: string; oferecimento: string; nome: string; logo: string | null };
}

// Classe e rótulo de cima do card: o papel antigo manda (peça antiga e saída antiga do modelo saem iguais).
const KIND_PAPEL: Record<string, string> = { capa: 'cover', o_que_aconteceu: 'detail', contexto: 'context', convite: 'promo' };
const KIND_LAYOUT: Record<Layout, string> = { capa: 'cover', texto: 'detail', citacao: 'quote', numero: 'stat', lista: 'list', documento: 'paper', comparacao: 'versus', linha_do_tempo: 'timeline', convite: 'promo' };
const POSICAO_PAPEL: Record<string, number> = { capa: 72, o_que_aconteceu: 100, contexto: 63, convite: 35 };
const POSICAO_LAYOUT: Record<Layout, number> = { capa: 72, texto: 100, citacao: 63, numero: 50, lista: 63, documento: 50, comparacao: 63, linha_do_tempo: 63, convite: 35 };
const POSICAO_FOCO: Record<Foco, [number, number]> = { centro: [50, 50], topo: [50, 0], base: [50, 100], esquerda: [0, 50], direita: [100, 50] };

/**
 * Variáveis de texto e cor de um card. Veículo `autoral`: sem rótulo de data nem eyebrow de notícia (só a editoria,
 * quando há); o rodapé assina no lugar de "Fonte:". Card com `papel` (peça antiga, saída antiga do modelo) sai como
 * sempre saiu; os layouts novos, pelo layout.
 */
export function varsDoCard(b: BaseCard, card: Card, formato: 'post' | 'carrossel'): Record<string, string> {
  const layout = layoutDe(card);
  const convite = layout === 'convite';
  const tx = textosConteudo(b.idioma);
  const [fotoX, fotoY] = POSICAO_FOCO[card.foco ?? 'centro'];
  const fatoDoCard = (card.frases ?? []).find((f) => f.fatoId)?.fatoId ?? '';
  const doDocumento = layout === 'documento' ? b.fatosDoDocumento?.[fatoDoCard] : undefined;
  const fonteDoCard = doDocumento ?? b.fontesPorFato?.[fatoDoCard];
  const eyebrowPapel: Record<string, string> = { capa: '', o_que_aconteceu: tx.oQueAconteceu, contexto: tx.contexto, convite: tx.siga };
  const eyebrow = b.autoral
    ? (convite ? '' : b.editoria)
    : card.papel ? (card.papel === 'capa' ? b.eyebrowCapa : eyebrowPapel[card.papel]) : layout === 'capa' ? b.eyebrowCapa : convite ? tx.siga : b.editoria;
  return {
    LANG: b.idioma ?? 'pt-BR',
    COLOR_BG: b.cores.fundo, COLOR_INK: b.cores.texto, COLOR_ACCENT: b.cores.acento,
    ART_POSITION: String(card.imagem ? fotoX : card.papel ? POSICAO_PAPEL[card.papel] : POSICAO_LAYOUT[layout]),
    ART_POSITION_Y: String(card.imagem ? fotoY : 50),
    SLIDE_CLASS: [card.papel ? KIND_PAPEL[card.papel] : KIND_LAYOUT[layout], card.imagem ? 'photo' : '', classeTitulo(b.par), convite ? '' : classeComposicao(b.composicao ?? 'padrao'), !convite && b.caixaTitulo === 'normal' ? 'caixa-normal' : ''].filter(Boolean).join(' '),
    BRAND_NAME: b.marcaNome,
    DATE_LABEL: doDocumento?.data ? b.rotuloDataFato ?? b.dataLabel : b.dataLabel,
    DATE_VALUE: doDocumento?.data ?? b.dataValor,
    EYEBROW: eyebrow,
    HEADLINE: card.titulo,
    // Capa do carrossel que veio do modelo: só a manchete (o texto vai nos cards seguintes). A que o editor escreveu
    // com frase, mostra. No post a capa é a imagem única e leva as frases. Lista: os itens vão no LIST_TAG.
    BODY_TEXT: (card.papel === 'capa' && formato !== 'post') || layout === 'lista' || COM_ROTULO.includes(layout) ? '' : (card.frases ?? []).map((f) => f.texto).join(' '),
    FOOTER_LABEL: convite || b.autoral ? '' : `${b.publicidade?.rotulo ?? tx.fonte}:`,
    SOURCE_NAME: convite ? '' : b.publicidade?.anunciante ?? fonteDoCard?.nome ?? b.fonteNome,
    SOURCE_URL: fonteDoCard?.url ?? b.fonteUrl,
    CTA_URL: b.ctaUrl,
    DOMAIN: b.dominio,
  };
}

// O selo fica sob o logo, à esquerda: lugar que toda composição deixa livre. O QA mede se o texto chega nele.
const CSS_SELO = `.selo-publi { position: absolute; left: 68px; top: 184px; margin: 0; padding: 9px 16px; background: var(--ink); color: var(--bg); font: 900 24px/1 Corpo, sans-serif; letter-spacing: 2px; text-transform: uppercase; }
    .r916 .selo-publi { top: 316px; }
    /* No convite rico o texto começa logo abaixo do cabeçalho: o selo fica no lugar de "no direct". */
    .card:has(.phone) .edition { visibility: hidden; }
    .phone ~ .selo-publi { left: auto; right: 68px; top: 89px; }
    .r916 .phone ~ .selo-publi { top: 219px; }
  `;

// A faixa usa o lugar do selo, que toda composição reserva: publicidade não tem patrocínio, então os dois nunca se encontram.
const CSS_PATROCINIO = `.faixa-oferece { display: flex; align-items: center; gap: 14px; max-width: 760px; font-size: 19px; letter-spacing: 1.5px; }
    .faixa-oferece b { font: 900 24px/1 Corpo, sans-serif; letter-spacing: 0; text-transform: none; overflow-wrap: anywhere; }
    .faixa-oferece img { height: 34px; max-width: 200px; object-fit: contain; }
  `;
// Cards de prova: compostos em tipo, sobre a cor da marca. Imagem do papel não entra. O grifo é a frase inteira.
const CSS_PROVA: Partial<Record<string, string>> = {
  documento: `.paper .shade { display: none; }
    .paper h1 { font-size: 42px; line-height: 1.15; padding-bottom: 16px; border-bottom: 3px solid var(--ink); }
    .paper .story-body { display: inline; font-size: 37px; line-height: 1.5; font-weight: 800; color: var(--bg); background: var(--accent); padding: 4px 0; box-shadow: 8px 0 0 var(--accent), -8px 0 0 var(--accent); -webkit-box-decoration-break: clone; box-decoration-break: clone; }
  `,
  comparacao: `.versus h1 { font-size: 52px; line-height: 1.1; }
    .versus .story-list { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }
    .versus .story-list li { display: block; border-top: 4px solid var(--accent); }
    .versus .story-list li::before { content: none; }
    .versus .rotulo { display: block; margin-bottom: 10px; color: var(--accent); font-size: 28px; font-weight: 900; overflow-wrap: anywhere; }
  `,
  linha_do_tempo: `.timeline h1 { font-size: 47px; line-height: 1.1; }
    .timeline .story-list li { display: grid; grid-template-columns: 250px 1fr; gap: 20px; font-size: 30px; padding: 12px 0; }
    .timeline .story-list li::before { content: none; }
    .timeline .rotulo { color: var(--accent); font-weight: 900; overflow-wrap: anywhere; }
  `,
};
const CSS_CAIXA = `.caixa-normal h1 { text-transform: none; letter-spacing: 0; }
  `;

/**
 * O que só entra quando a peça pede: vazio, o HTML sai byte a byte como antes, e o hash do card não muda. Render e prévia
 * usam esta função, que devolve HTML pronto para `{{?ESTILO_CSS}}` e `{{?SELO_TAG}}` e, por composição, troca `ART_TAG` e
 * `BRAND_TAG`: ela vem depois deles no `raw`.
 */
export function extrasDoCard(b: Pick<BaseCard, 'publicidade' | 'composicao' | 'caixaTitulo' | 'marcaNome' | 'patrocinio'>, card: Card): Record<string, string> {
  const convite = layoutDe(card) === 'convite';
  const composicao = convite ? 'padrao' : b.composicao ?? 'padrao';
  const patrocinio = convite ? undefined : b.patrocinio;
  const prova = CSS_PROVA[layoutDe(card)];
  const css = `${b.publicidade || patrocinio ? CSS_SELO : ''}${patrocinio ? CSS_PATROCINIO : ''}${cssComposicao(composicao)}${!convite && b.caixaTitulo === 'normal' ? CSS_CAIXA : ''}${prova ?? ''}`;
  return {
    ...(css ? { ESTILO_CSS: css } : {}),
    ...(b.publicidade ? { SELO_TAG: `<p class="selo-publi">${escapeHtml(b.publicidade.rotulo)}</p>` } : {}),
    ...(patrocinio ? {
      SPONSOR_TAG: `<p class="selo-publi faixa-oferece"><span>${escapeHtml(patrocinio.rotulo)} · ${escapeHtml(patrocinio.oferecimento)}</span>${patrocinio.logo ? `<img src="${escapeHtml(patrocinio.logo)}" alt="${escapeHtml(patrocinio.nome)}">` : `<b>${escapeHtml(patrocinio.nome)}</b>`}</p>`,
    } : {}),
    // Cartaz é só tipografia. Primeira página: o nome do veículo é o cabeçalho, mesmo com logo.
    ...(composicao === 'cartaz' || layoutDe(card) === 'documento' ? { ART_TAG: '' } : {}),
    ...(composicao === 'primeira-pagina' ? { BRAND_TAG: `<span class="brand-name">${escapeHtml(b.marcaNome)}</span>` } : {}),
  };
}

/** Só no quadro 9:16: cada frase marcada, para entrar uma a uma no Reels. O 4:5 segue com o texto corrido, byte a byte. */
export const corpoPorFrase = (card: Card, texto: string) =>
  texto ? (card.frases ?? []).map((f) => `<span class="${CLASSE_FRASE}">${escapeHtml(f.texto)}</span>`).join(' ') : '';

/** Itens do layout lista (HTML pronto para o `{{?LIST_TAG}}`). */
export const listaTag = (card: Card) => {
  if (layoutDe(card) === 'lista') return `<ul class="story-list">${(card.frases ?? []).map((f) => `<li>${escapeHtml(f.texto)}</li>`).join('')}</ul>`;
  if (!COM_ROTULO.includes(layoutDe(card))) return '';
  return `<ul class="story-list">${(card.frases ?? []).map((f) => `<li><span class="rotulo">${escapeHtml(f.rotulo ?? '')}</span><span>${escapeHtml(f.texto)}</span></li>`).join('')}</ul>`;
};

/**
 * `{{CHAVE}}` → valor escapado (vars) ou HTML pronto (raw). Variável que o template pede e ninguém deu: erro.
 * `{{?CHAVE}}` é opcional: sem valor, vazio.
 */
export function preencherTemplate(tpl: string, vars: Record<string, string>, raw: Record<string, string>) {
  return tpl.replace(/\{\{(\?)?([A-Z_]+)\}\}/g, (_, opcional: string | undefined, k: string) => {
    if (k in raw) return raw[k];
    if (!(k in vars)) {
      if (opcional) return '';
      throw new Error(`variável ausente no template: ${k}`);
    }
    return escapeHtml(vars[k]);
  });
}

/** O convite rico da marca (o que o template convite.html usa): a parte de `Cta` com o celular de exemplo. */
export interface ConviteRico {
  titulo: string;
  texto: string;
  url?: string;
  acao?: string;
  edicao?: string;
  destaques?: { titulo: string; itens: string[] };
  telefone: { titulo: string; status: string; rotulo?: string; mensagens: { de: string; texto: string }[] };
}

/**
 * Variáveis e mensagens do convite rico: celular com direct de exemplo, destaques
 * e botão, tudo da configuração do convite. As mesmas no render e na prévia da edição. `CTA_URL` fica com quem chama.
 */
export function conviteRico(cta: ConviteRico, marca: { nome?: string | null; handle?: string | null }, par: ParFontes, idioma?: IdiomaConteudo) {
  const tx = textosConteudo(idioma);
  const iniciais = (marca.nome ?? '').split(/\s+/).map((p) => p[0] ?? '').join('').slice(0, 2).toUpperCase();
  const vars: Record<string, string> = {
    EDITION: cta.edicao ?? tx.noDirect,
    FEATURE_HEADING: cta.destaques?.titulo ?? tx.comoFunciona,
    FEATURE_ONE: cta.destaques?.itens[0] ?? cta.texto,
    FEATURE_TWO: cta.destaques?.itens[1] ?? '',
    AVATAR: iniciais,
    PHONE_TITLE: cta.telefone.titulo,
    PHONE_STATUS: cta.telefone.status,
    DEMO_LABEL: cta.telefone.rotulo ?? tx.exemplo,
    MAIN_CTA: cta.acao ?? cta.titulo,
    HANDLE_LINE: `${tx.linkNoPerfil} · ${marca.handle ?? marca.nome ?? ''}`,
    TITLE_CLASS: classeTitulo(par),
  };
  const mensagens = cta.telefone.mensagens.slice(0, 3).map((m) =>
    `<div class="msg ${m.de === 'pagina' ? 'pagina' : 'morador'}" data-fit><b>${m.de === 'pagina' ? escapeHtml(marca.nome ?? tx.pagina) : tx.morador}</b>${escapeHtml(m.texto)}</div>`).join('');
  return { vars, mensagens };
}
