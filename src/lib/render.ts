import { launch } from '@cloudflare/playwright';
import type { Env } from '../env';
import type { Brand, Lead } from './lead';
import type { Draft } from './drafting';
import template from '../templates/card.html';
import templateConvite from '../templates/cta.html';
import { chooseCta, fromTextLink } from './drafting';
import { waterTagBrand } from './watermark';
import { isInvite, normalizeCards, cardLabel, type Card, type CardNormal, type Layout } from './cards';
import { fromRoleColors, withCopyBrand, type PieceStyle } from './style';
import { inviteRich, perSentenceBody, escapeHtml as escape, cardExtras, tagList, fillTemplate, cardVars, type BaseCard } from './cardHtml';
import { CATALOG_SOURCES, titleClass, pair, fromPairWeights, type SourcesPair } from './typography';
import { deskInCard, localeContent, advertisingLabel, textsContent, type ContentLanguage } from './contentLanguage';
import { CAROUSEL_HEIGHT, qaCard, type MetricsLayout } from './qaLayout';
import nunito from '../../assets/fonts/nunito-latin.woff2';
import quicksand from '../../assets/fonts/quicksand-latin.woff2';
import sourceSans from '../../assets/fonts/source-sans-3-latin.woff2';
import sourceSerif from '../../assets/fonts/source-serif-4-latin.woff2';
import inter from '../../assets/fonts/inter-latin.woff2';
import archivo from '../../assets/fonts/archivo-latin.woff2';

export interface RenderInput {
  tenantId: string;
  pecaId: string;
  versao: number;                 // goes into the R2 key: versions do not overwrite each other
  formato: 'post' | 'carrossel';
  rascunho: Draft;
  pauta: Lead;
  ilustracaoR2?: string;          // illustration generated for the piece (all cards), if any
  /** Art already rendered (previous version): a card whose HTML did not change reuses the keys, without opening the browser. */
  anteriores?: ArtRendered[];
  /** File name with the card hash (edits): attempts competing for the same version do not overwrite each other. */
  chavesPorConteudo?: boolean;
  /** `r916`: the card in 9:16 for Reels (src/lib/reels.ts). Without it, 1080×1350. */
  quadro?: 'r916';
  /** Today's date for a card without a fact date (ISO). Reels freezes the request's: the replay gives the same HTML. */
  hoje?: string;
}

export type { MetricsLayout as MetricasLayout } from './qaLayout';

export interface ArtRendered {
  /** Old role, or the layout: the card's label in the package and on screen (old pieces only have this field). */
  papel: string;
  id?: string;                    // card id (cards.ts); missing on old pieces
  layout?: Layout;
  png: string;                    // chave R2
  jpg: string;                    // chave R2 (IG Graph exige JPEG)
  /** SHA-256 of the card HTML: the same in the next version = the same image, reused. */
  hash?: string;
  /** Illustration used on the card (editing reuses the same one). */
  arte?: string;
  metricas: MetricsLayout;
}

/** Card rejected by layout QA (text does not fit, overlap): editing shows the reason on the card itself. */
export class LayoutError extends Error {
  name = 'ErroLayout';
  constructor(readonly cardId: string, readonly indice: number, readonly metricas: MetricsLayout, label: string) {
    super(`layout reprovado no card ${indice + 1} (${label}): ${JSON.stringify(metricas)}`);
  }
}

const SOURCES: Record<string, ArrayBuffer> = {
  'nunito-latin.woff2': nunito, 'quicksand-latin.woff2': quicksand, 'source-sans-3-latin.woff2': sourceSans,
  'source-serif-4-latin.woff2': sourceSerif, 'inter-latin.woff2': inter, 'archivo-latin.woff2': archivo,
};
const b64Sources = new Map<string, string>();
/** Base64 of the pair's two fonts (memoised: the same file serves every card). */
export function fromPairSources(pair: SourcesPair) {
  const def = CATALOG_SOURCES[pair];
  const from = (file: string) => b64Sources.get(file) ?? (b64Sources.set(file, b64(SOURCES[file])), b64Sources.get(file)!);
  return { FONT_BODY: from(def.corpo.arquivo), FONT_DISPLAY: from(def.destaque.arquivo), ...fromPairWeights(pair) };
}

function b64(bytes: ArrayBuffer | Uint8Array) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

// data_fato only carries the day (YYYY-MM-DD): new Date() would read UTC midnight, which in São Paulo is the day before.
export const formatDate = (iso: string | null | undefined, language?: ContentLanguage) =>
  iso
    ? new Intl.DateTimeFormat(localeContent(language), { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Sao_Paulo' }).format(
        new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00-03:00` : iso),
      )
    : '';

async function dataUri(env: Env, key: string | undefined | null, fallbackType: string) {
  if (!key) return null;
  const obj = await env.MEDIA.get(key);
  if (!obj) throw new Error(`asset ${key} not found in R2`);
  return `data:${obj.httpMetadata?.contentType ?? fallbackType};base64,${b64(await obj.arrayBuffer())}`;
}

const fromSourceName = (f: { fonteNome: string | null; fonteUrl: string }) => f.fonteNome ?? new URL(f.fonteUrl).hostname;

/** The part of the card that does not change between a piece's cards (brand, date, source, footer). Also goes to the edit preview. */
export function baseCard(lead: Lead, today = new Date()): BaseCard {
  const brand: Brand = lead.marca;
  const source = lead.fatos[0];
  const local = lead.bairro ?? null;
  const summary = lead.tipoPost === 'resumo';
  // Daily digest: each story has its own date; the card's is today.
  const factDate = summary ? null : lead.fatos.map((f) => f.dataFato).find(Boolean) ?? null;
  const author = lead.modo === 'autoral';
  const tx = textsContent(lead.idioma);
  const desk = deskInCard(lead.editoria, lead.idioma);
  return {
    autoral: author, idioma: lead.idioma ?? 'pt-BR', par: pair(brand.fontes),
    cores: fromRoleColors({ fundo: brand.cores?.fundo ?? '#1f2a24', texto: brand.cores?.texto ?? '#fffcf6', acento: brand.cores?.acento ?? '#b3e9c2' }, lead.estiloParams?.papelCores ?? 'normal'),
    marcaNome: brand.nome ?? '',
    editoria: desk,
    eyebrowCapa: local ? `${desk} · ${local}`.replace(/^ · /, '') : desk,
    dataLabel: author ? '' : factDate ? tx.ocorrencia : tx.publicacao,
    dataValor: author ? '' : formatDate(factDate ?? today.toISOString(), lead.idioma),
    fonteNome: author ? brand.assinatura ?? brand.nome ?? '' : summary ? tx.variasFontes : fromSourceName(source),
    fonteUrl: author ? fromTextLink(lead) : source.fonteUrl,
    ...(summary ? { fontesPorFato: Object.fromEntries(lead.fatos.map((f) => [f.id, { nome: fromSourceName(f), url: f.fonteUrl }])) } : {}),
    fatosDoDocumento: Object.fromEntries(lead.fatos.map((f) => [f.id, { nome: fromSourceName(f), url: f.fonteUrl, data: !author && f.dataFato ? formatDate(f.dataFato, lead.idioma) : null }])),
    rotuloDataFato: tx.ocorrencia,
    ctaUrl: brand.ctaUrl ?? `https://${brand.dominio ?? 'instagram.com'}`,
    dominio: brand.dominio ?? brand.handle ?? '',
    ...(lead.estiloParams ? { composicao: lead.estiloParams.composicao, caixaTitulo: lead.estiloParams.caixaTitulo } : {}),
    ...(lead.patrocinador ? { patrocinio: { rotulo: advertisingLabel(lead.idioma), oferecimento: tx.oferecimento, nome: lead.patrocinador.nome, logo: null } } : {}),
    ...(lead.tipoPost === 'publicidade' ? { publicidade: { rotulo: advertisingLabel(lead.idioma), anunciante: lead.anunciante ?? '' } } : {}),
  };
}

/** The lead as the piece sees it: with a template, the brand frozen in it and the parameters. Without one, today's. */
export const leadStyle = (lead: Lead, style?: PieceStyle | null): Lead =>
  style ? { ...lead, marca: withCopyBrand(lead.marca, style.marcaVisual), estiloParams: style.params, patrocinador: style.patrocinador } : lead;

/**
 * A card's text and colour variables (without fonts, art and logo, which the render builds separately). `autoral`
 * outlet: the author owns the outlet, so the card has no date label and no news eyebrow ("What happened", "Context";
 * only the desk, when there is one), and the footer signs with `marca.assinatura` linked to the text, in place of
 * "Source: <site>".
 */
export const varsCard = (lead: Lead, card: Card, format: 'post' | 'carrossel', today = new Date()) => cardVars(baseCard(lead, today), card, format);

export { tagList as listaTag, fillTemplate as preencherTemplate };

/** Each card's HTML, ready for the browser, and its hash (it decides what needs rendering again). */
export interface CardPrepared { card: CardNormal; indice: number; html: string; hash: string; arte: string | null }

export async function prepareCards(env: Env, input: Omit<RenderInput, 'anteriores'>): Promise<CardPrepared[]> {
  const { rascunho: draft, formato: format } = input;
  const lead = leadStyle(input.pauta, draft.estilo);
  const brand: Brand = lead.marca;
  const cards = format === 'post' ? normalizeCards(draft.cards).slice(0, 1) : normalizeCards(draft.cards);
  if (!cards.length) throw new Error('draft has no cards');

  const logo = await dataUri(env, brand.logoR2, 'image/svg+xml');
  const illustration = await dataUri(env, input.ilustracaoR2 ?? null, 'image/png');
  const defaultArt = illustration ?? (await dataUri(env, brand.arteR2, 'image/png'));
  const sources = fromPairSources(pair(brand.fontes));
  const base = baseCard(lead);
  const logoSponsorship = await dataUri(env, lead.patrocinador?.logoR2, 'image/png');
  const output: CardPrepared[] = [];
  for (const [i, card] of cards.entries()) {
    // Own photo (uploaded by the editor); otherwise the card's illustration, the piece's, or the brand's default art.
    const photo = card.imagem ? await dataUri(env, card.imagem, 'image/png') : null;
    const fromCard = !photo && card.ilustracao ? await dataUri(env, card.ilustracao, 'image/png') : null;
    const art = photo ?? fromCard ?? defaultArt;
    const vars: Record<string, string> = { ...sources, ...varsCard(lead, card, format, input.hoje ? new Date(input.hoje) : undefined), ...(input.quadro ? { FORMAT_CLASS: input.quadro } : {}) };
    // Tags built outside escaping: image (or flat background) and logo (or name).
    const raw: Record<string, string> = {
      ART_TAG: art
        ? `<img class="art" src="${art}" alt="${escape(photo ? textsContent(lead.idioma).fotoDoVeiculo : draft.visualBrief?.primary ?? textsContent(lead.idioma).ilustracao)}">`
        : '<div class="art art-flat" aria-hidden="true"></div>',
      BRAND_TAG: logo
        ? `<img class="brand-mark" src="${logo}" alt="${escape(brand.nome ?? '')}">`
        : `<span class="brand-name">${escape(brand.nome ?? brand.handle ?? '')}</span>`,
      LIST_TAG: tagList(card),
      ...cardExtras(base.patrocinio ? { ...base, patrocinio: { ...base.patrocinio, logo: logoSponsorship } } : base, card),
    };
    if (input.quadro && !isInvite(card)) raw.BODY_TEXT = perSentenceBody(card, vars.BODY_TEXT);
    // Rich CTA: a phone with a sample DM, highlights and a button, all from the CTA config (cardHtml.inviteRich).
    const cta = isInvite(card) ? chooseCta(lead, card.cta) : null;
    let tpl = template;
    if (cta?.telefone) {
      tpl = templateConvite;
      const rich = inviteRich({ ...cta, telefone: cta.telefone }, brand, pair(brand.fontes), lead.idioma);
      Object.assign(vars, rich.vars, { CTA_URL: cta.url ?? vars.CTA_URL });
      raw.MESSAGES = rich.mensagens;
    }
    // Watermark (logo or @), except on the rich CTA (its template has no spot for it).
    raw.WATERMARK = waterTagBrand(brand.marcaDagua, { logo, handle: brand.handle, nome: brand.nome });
    const html = fillTemplate(tpl, vars, raw);
    output.push({ card, indice: i, html, hash: await sha256(`1080x1350\n${html}`), arte: photo ? null : input.ilustracaoR2 ?? null });
  }
  return output;
}

async function sha256(s: string) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The minimal Playwright surface the render uses: tests swap it for a fake browser. */
export type OpenBrowser = () => Promise<{ newPage: (o: { viewport: { width: number; height: number }; deviceScaleFactor: number }) => Promise<any>; close: () => Promise<void> }>;
/** Object for tests to swap (vi.spyOn): Browser Rendering only exists remotely. */
export const browserApi = { abrir: (env: Env): ReturnType<OpenBrowser> => launch(env.BROWSER) as never };

/**
 * Port of scripts/lib/social/render.mjs: HTML per card → 1080×1350 screenshot in Browser Rendering → R2.
 * Keeps the layout QA (overflow, overlap, fonts, images) and the ban on external requests. With `anteriores`, a card
 * with identical HTML (same hash) reuses the previous version's keys; with nothing to render, it does not even open the
 * browser.
 */
export async function renderCards(env: Env, input: RenderInput, show: OpenBrowser = () => browserApi.abrir(env)): Promise<ArtRendered[]> {
  const { tenantId, pecaId: pieceId, versao: version } = input;
  const prepared = await prepareCards(env, input);
  const perHash = new Map((input.anteriores ?? []).filter((a) => a.hash).map((a) => [a.hash!, a]));
  const output: (ArtRendered | null)[] = prepared.map((p) => {
    const old = perHash.get(p.hash);
    return old ? { ...old, papel: cardLabel(p.card), id: p.card.id, layout: p.card.layout } : null;
  });
  const missing = prepared.filter((_, i) => !output[i]);
  if (!missing.length) return output as ArtRendered[];

  const prefix = `artes/${tenantId}/${pieceId}/v${version}`;
  const browser = await show();
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
    const errors: string[] = [];
    const external: string[] = [];
    page.on('pageerror', (e: Error) => errors.push(e.message));
    page.on('console', (m: { type(): string; text(): string }) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.route(/^https?:\/\//, async (route: any) => { external.push(route.request().url()); await route.abort(); });

    for (const p of missing) {
      const { card, indice: i, html } = p;
      await page.setContent(html, { waitUntil: 'load' });
      const { metricas: metrics, ok } = await qaCard(page, { promo: isInvite(card), altura: CAROUSEL_HEIGHT });
      if (!ok) throw new LayoutError(card.id, i, metrics, cardLabel(card));

      const el = page.locator('.card');
      const png = await el.screenshot({ type: 'png' });
      const jpg = await el.screenshot({ type: 'jpeg', quality: 95 });
      // Name with the card id: within a version, two cards never compete for a key (reordering does not overwrite).
      const base = `${prefix}/${String(i + 1).padStart(2, '0')}-${cardLabel(card)}${card.id === cardLabel(card) ? '' : `-${card.id.replace(/[^a-z0-9-]/gi, '').slice(0, 24)}`}${input.chavesPorConteudo ? `-${p.hash.slice(0, 16)}` : ''}`;
      await Promise.all([
        env.MEDIA.put(`${base}.png`, png, { httpMetadata: { contentType: 'image/png' } }),
        env.MEDIA.put(`${base}.jpg`, jpg, { httpMetadata: { contentType: 'image/jpeg' } }),
      ]);
      output[i] = { papel: cardLabel(card), id: card.id, layout: card.layout, png: `${base}.png`, jpg: `${base}.jpg`, hash: p.hash, ...(p.arte ? { arte: p.arte } : {}), metricas: metrics };
    }

    if (errors.length || external.length) throw new Error(`render with errors: ${JSON.stringify({ erros: errors, externos: external })}`);
  } finally {
    await browser.close();
  }
  return output as ArtRendered[];
}
