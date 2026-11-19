// The card HTML from the template: per-card variables and filling. Pure (no Worker): the Browser Rendering render and
// the edit preview in Review (web/src/onboarding/editPreview.ts) build the same card with these functions.
import { SENTENCE_CLASS } from './reelsHtml';
import { WITH_LABEL, layoutOf, type Card, type Focus, type Layout } from './cards';
import { titleClass, type SourcesPair } from './typography';
import { textsContent, type ContentLanguage } from './contentLanguage';
import { compositionClass, cssComposition, type BoxTitle, type Composition } from './style';

export const escapeHtml = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** What stays the same from one card to the next in a piece (brand, date, source, footer). The Worker builds it (`baseCard`). */
export interface BaseCard {
  autoral: boolean;
  /** Language of the outlet's content (missing: Portuguese, as in older pieces). */
  idioma?: ContentLanguage;
  par: SourcesPair;
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
  /** Daily digest: each fact's source, because each card covers a different story. */
  fontesPorFato?: Record<string, { nome: string; url: string }>;
  /** Document card: the source and date of the sentence's fact, with the date label. */
  fatosDoDocumento?: Record<string, { nome: string; url: string; data: string | null }>;
  rotuloDataFato?: string;
  /** Advertising piece: a badge on every card and the advertiser in the footer, in place of the source. */
  publicidade?: { rotulo: string; anunciante: string };
  /** Card mould (src/lib/style.ts). Missing: the usual one. The CTA does not change. */
  composicao?: Composition;
  /** `normal`: title without uppercase. Missing: the usual. */
  caixaTitulo?: BoxTitle;
  /** Sponsorship strip. `logo`: data URI in the render, signed URL in the preview. */
  patrocinio?: { rotulo: string; oferecimento: string; nome: string; logo: string | null };
}

// The card's class and top label: the old role wins (old pieces and old model output come out the same).
const KIND_ROLE: Record<string, string> = { capa: 'cover', o_que_aconteceu: 'detail', contexto: 'context', convite: 'promo' };
const KIND_LAYOUT: Record<Layout, string> = { capa: 'cover', texto: 'detail', citacao: 'quote', numero: 'stat', lista: 'list', documento: 'paper', comparacao: 'versus', linha_do_tempo: 'timeline', convite: 'promo' };
const POSITION_ROLE: Record<string, number> = { capa: 72, o_que_aconteceu: 100, contexto: 63, convite: 35 };
const POSITION_LAYOUT: Record<Layout, number> = { capa: 72, texto: 100, citacao: 63, numero: 50, lista: 63, documento: 50, comparacao: 63, linha_do_tempo: 63, convite: 35 };
const POSITION_FOCUS: Record<Focus, [number, number]> = { centro: [50, 50], topo: [50, 0], base: [50, 100], esquerda: [0, 50], direita: [100, 50] };

/**
 * A card's text and colour variables. `autoral` outlet: no date label and no news eyebrow (only the desk, when there is
 * one); the footer signs in place of "Source:". A card with `papel` (old piece, old model output) comes out as it always
 * did; the new layouts, by layout.
 */
export function cardVars(b: BaseCard, card: Card, format: 'post' | 'carrossel'): Record<string, string> {
  const layout = layoutOf(card);
  const invite = layout === 'convite';
  const tx = textsContent(b.idioma);
  const [photoX, photoY] = POSITION_FOCUS[card.foco ?? 'centro'];
  const factCard = (card.frases ?? []).find((f) => f.fatoId)?.fatoId ?? '';
  const fromDocument = layout === 'documento' ? b.fatosDoDocumento?.[factCard] : undefined;
  const fromCardSource = fromDocument ?? b.fontesPorFato?.[factCard];
  const eyebrowRole: Record<string, string> = { capa: '', o_que_aconteceu: tx.oQueAconteceu, contexto: tx.contexto, convite: tx.siga };
  const eyebrow = b.autoral
    ? (invite ? '' : b.editoria)
    : card.papel ? (card.papel === 'capa' ? b.eyebrowCapa : eyebrowRole[card.papel]) : layout === 'capa' ? b.eyebrowCapa : invite ? tx.siga : b.editoria;
  return {
    LANG: b.idioma ?? 'pt-BR',
    COLOR_BG: b.cores.fundo, COLOR_INK: b.cores.texto, COLOR_ACCENT: b.cores.acento,
    ART_POSITION: String(card.imagem ? photoX : card.papel ? POSITION_ROLE[card.papel] : POSITION_LAYOUT[layout]),
    ART_POSITION_Y: String(card.imagem ? photoY : 50),
    SLIDE_CLASS: [card.papel ? KIND_ROLE[card.papel] : KIND_LAYOUT[layout], card.imagem ? 'photo' : '', titleClass(b.par), invite ? '' : compositionClass(b.composicao ?? 'padrao'), !invite && b.caixaTitulo === 'normal' ? 'caixa-normal' : ''].filter(Boolean).join(' '),
    BRAND_NAME: b.marcaNome,
    DATE_LABEL: fromDocument?.data ? b.rotuloDataFato ?? b.dataLabel : b.dataLabel,
    DATE_VALUE: fromDocument?.data ?? b.dataValor,
    EYEBROW: eyebrow,
    HEADLINE: card.titulo,
    // Carousel cover from the model: only the headline (the text goes in the following cards). One the editor wrote with
    // a sentence shows it. In a post the cover is the single image and carries the sentences. List: items go in LIST_TAG.
    BODY_TEXT: (card.papel === 'capa' && format !== 'post') || layout === 'lista' || WITH_LABEL.includes(layout) ? '' : (card.frases ?? []).map((f) => f.texto).join(' '),
    FOOTER_LABEL: invite || b.autoral ? '' : `${b.publicidade?.rotulo ?? tx.fonte}:`,
    SOURCE_NAME: invite ? '' : b.publicidade?.anunciante ?? fromCardSource?.nome ?? b.fonteNome,
    SOURCE_URL: fromCardSource?.url ?? b.fonteUrl,
    CTA_URL: b.ctaUrl,
    DOMAIN: b.dominio,
  };
}

// The badge sits under the logo, on the left: a spot every composition leaves free. QA measures whether text reaches it.
const CSS_BADGE = `.selo-publi { position: absolute; left: 68px; top: 184px; margin: 0; padding: 9px 16px; background: var(--ink); color: var(--bg); font: 900 24px/1 Corpo, sans-serif; letter-spacing: 2px; text-transform: uppercase; }
    .r916 .selo-publi { top: 316px; }
    /* No convite rico o texto começa logo abaixo do cabeçalho: o selo fica no lugar de "no direct". */
    .card:has(.phone) .edition { visibility: hidden; }
    .phone ~ .selo-publi { left: auto; right: 68px; top: 89px; }
    .r916 .phone ~ .selo-publi { top: 219px; }
  `;

// The strip uses the badge's spot, which every composition reserves: advertising has no sponsorship, so the two never meet.
const CSS_SPONSORSHIP = `.faixa-oferece { display: flex; align-items: center; gap: 14px; max-width: 760px; font-size: 19px; letter-spacing: 1.5px; }
    .faixa-oferece b { font: 900 24px/1 Corpo, sans-serif; letter-spacing: 0; text-transform: none; overflow-wrap: anywhere; }
    .faixa-oferece img { height: 34px; max-width: 200px; object-fit: contain; }
  `;
// Proof cards: set in type, on the brand colour. The paper's image does not go in. The highlight is the whole sentence.
const CSS_PROOF: Partial<Record<string, string>> = {
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
const CSS_BOX = `.caixa-normal h1 { text-transform: none; letter-spacing: 0; }
  `;

/**
 * What only goes in when the piece asks for it: when empty, the HTML comes out byte for byte as before, and the card
 * hash does not change. Render and preview use this function, which returns ready HTML for `{{?ESTILO_CSS}}` and
 * `{{?SELO_TAG}}` and, per composition, replaces `ART_TAG` and `BRAND_TAG`: it comes after them in `raw`.
 */
export function cardExtras(b: Pick<BaseCard, 'publicidade' | 'composicao' | 'caixaTitulo' | 'marcaNome' | 'patrocinio'>, card: Card): Record<string, string> {
  const invite = layoutOf(card) === 'convite';
  const composition = invite ? 'padrao' : b.composicao ?? 'padrao';
  const sponsorship = invite ? undefined : b.patrocinio;
  const proof = CSS_PROOF[layoutOf(card)];
  const css = `${b.publicidade || sponsorship ? CSS_BADGE : ''}${sponsorship ? CSS_SPONSORSHIP : ''}${cssComposition(composition)}${!invite && b.caixaTitulo === 'normal' ? CSS_BOX : ''}${proof ?? ''}`;
  return {
    ...(css ? { ESTILO_CSS: css } : {}),
    ...(b.publicidade ? { SELO_TAG: `<p class="selo-publi">${escapeHtml(b.publicidade.rotulo)}</p>` } : {}),
    ...(sponsorship ? {
      SPONSOR_TAG: `<p class="selo-publi faixa-oferece"><span>${escapeHtml(sponsorship.rotulo)} · ${escapeHtml(sponsorship.oferecimento)}</span>${sponsorship.logo ? `<img src="${escapeHtml(sponsorship.logo)}" alt="${escapeHtml(sponsorship.nome)}">` : `<b>${escapeHtml(sponsorship.nome)}</b>`}</p>`,
    } : {}),
    // Poster is type only. First page: the outlet name is the header, even with a logo.
    ...(composition === 'cartaz' || layoutOf(card) === 'documento' ? { ART_TAG: '' } : {}),
    ...(composition === 'primeira-pagina' ? { BRAND_TAG: `<span class="brand-name">${escapeHtml(b.marcaNome)}</span>` } : {}),
  };
}

/** Only in the 9:16 frame: each sentence tagged, so they enter one by one in Reels. 4:5 keeps the running text, byte for byte. */
export const perSentenceBody = (card: Card, text: string) =>
  text ? (card.frases ?? []).map((f) => `<span class="${SENTENCE_CLASS}">${escapeHtml(f.texto)}</span>`).join(' ') : '';

/** Items of the list layout (ready HTML for `{{?LIST_TAG}}`). */
export const tagList = (card: Card) => {
  if (layoutOf(card) === 'lista') return `<ul class="story-list">${(card.frases ?? []).map((f) => `<li>${escapeHtml(f.texto)}</li>`).join('')}</ul>`;
  if (!WITH_LABEL.includes(layoutOf(card))) return '';
  return `<ul class="story-list">${(card.frases ?? []).map((f) => `<li><span class="rotulo">${escapeHtml(f.rotulo ?? '')}</span><span>${escapeHtml(f.texto)}</span></li>`).join('')}</ul>`;
};

/**
 * `{{KEY}}` → escaped value (vars) or ready HTML (raw). A variable the template asks for that nobody provided: error.
 * `{{?KEY}}` is optional: without a value, empty.
 */
export function fillTemplate(tpl: string, vars: Record<string, string>, raw: Record<string, string>) {
  return tpl.replace(/\{\{(\?)?([A-Z_]+)\}\}/g, (_, optional: string | undefined, k: string) => {
    if (k in raw) return raw[k];
    if (!(k in vars)) {
      if (optional) return '';
      throw new Error(`template variable missing: ${k}`);
    }
    return escapeHtml(vars[k]);
  });
}

/** The brand's rich CTA (what the cta.html template uses): the part of `Cta` with the sample phone. */
export interface InviteRich {
  titulo: string;
  texto: string;
  url?: string;
  acao?: string;
  edicao?: string;
  destaques?: { titulo: string; itens: string[] };
  telefone: { titulo: string; status: string; rotulo?: string; mensagens: { de: string; texto: string }[] };
}

/**
 * Variables and messages of the rich call-to-action card: a phone with a sample DM, highlights and a button, all from
 * the call-to-action settings. The same in rendering and in the edit preview. `CTA_URL` is set by the caller.
 */
export function inviteRich(cta: InviteRich, brand: { nome?: string | null; handle?: string | null }, pair: SourcesPair, language?: ContentLanguage) {
  const tx = textsContent(language);
  const initials = (brand.nome ?? 'BN').split(/\s+/).map((p) => p[0] ?? '').join('').slice(0, 2).toUpperCase();
  const vars: Record<string, string> = {
    EDITION: cta.edicao ?? tx.noDirect,
    FEATURE_HEADING: cta.destaques?.titulo ?? tx.comoFunciona,
    FEATURE_ONE: cta.destaques?.itens[0] ?? cta.texto,
    FEATURE_TWO: cta.destaques?.itens[1] ?? '',
    AVATAR: initials,
    PHONE_TITLE: cta.telefone.titulo,
    PHONE_STATUS: cta.telefone.status,
    DEMO_LABEL: cta.telefone.rotulo ?? tx.exemplo,
    MAIN_CTA: cta.acao ?? cta.titulo,
    HANDLE_LINE: `${tx.linkNoPerfil} · ${brand.handle ?? brand.nome ?? ''}`,
    TITLE_CLASS: titleClass(pair),
  };
  const messages = cta.telefone.mensagens.slice(0, 3).map((m) =>
    `<div class="msg ${m.de === 'pagina' ? 'pagina' : 'morador'}" data-fit><b>${m.de === 'pagina' ? escapeHtml(brand.nome ?? tx.pagina) : tx.morador}</b>${escapeHtml(m.texto)}</div>`).join('');
  return { vars, mensagens: messages };
}
