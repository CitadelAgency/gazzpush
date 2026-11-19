import type { Env } from '../env';
import type { Cta, Lead } from './lead';
import { DESCRIPTION_LAYOUT, LAYOUTS_CONTENT, LIMITS, MAX_CARDS, isInvite, isLayoutContent, type Card, type LayoutContent } from './cards';
import type { PieceStyle } from './style';
import { advertisingLabel, textsContent, type ContentLanguage } from './contentLanguage';
import { callText } from './textModel';

export type { Card, Sentence as Frase } from './cards';

export interface Draft {
  manchete: string;
  resumo: string;
  legenda: string;
  cards: Card[];
  visualBrief?: { primary: string; context?: string; fatoIds: string[] };
  modelo: string;
  custoUsd: number;
  /** Reels: the source carousel and the music library track (src/lib/music.ts). */
  origem?: { pecaId: string; versao: number; capa?: { png: string; jpg: string }; ilustracao?: string | null; em?: string };
  /** The outlet's template with the visual part of the brand frozen (src/lib/style.ts). Missing: today's look. */
  estilo?: PieceStyle;
  musica?: string | null;
  /** Reels with voice: the take used (narracoes table). */
  narracao?: string | null;
}

/** Marker in the CTA caption that becomes the link to the lead's text (author outlet). */
export const MARKER_LINK = '{link}';

/**
 * The author outlet's default CTA, created with it (editable in the Brand tab). No numbers: the brand rejects a CTA
 * with digits (the fact check would reject the post), so a publication name with a number stays out of the text.
 */
export function ctaAuthor(publication: string, language?: ContentLanguage): Cta {
  const name = publication.replace(/\s+/g, ' ').trim();
  return { ...textsContent(language).ctaAutoral(name && !/\d/.test(name) && name.length <= 160 ? name : null) };
}

/** The link the CTA gives the reader: the published post's (http source); without it (a Docs draft), the outlet's. */
export function fromTextLink(lead: Lead): string {
  // A Story fact (`afirmacao`) has the evidence as its source, not the author's text: it is not the text's link.
  return lead.fatos.filter((f) => f.tipo !== 'afirmacao').map((f) => f.fonteUrl).find((u) => /^https?:\/\//.test(u)) ?? lead.marca.ctaUrl ?? '';
}

/**
 * Deterministic rotation: same lead → same CTA (a rewrite does not swap the CTA). Without config → the profile's
 * generic CTA. `indice`: the CTA the editor chose in Review (index into marca.ctas); outside the list, rotation applies.
 */
export function chooseCta(lead: Lead, index?: number | null): Cta {
  // A Story with its sources page published and the card requested: the last card is "How we reported this", with its link.
  if (lead.fontesUrl && lead.modo === 'autoral') return textsContent(lead.idioma).ctaFontes(lead.fontesUrl);
  const ctas = lead.marca.ctas?.filter((c) => c.titulo && c.texto && c.legenda) ?? [];
  if (!ctas.length && lead.modo === 'autoral') return ctaAuthor(lead.marca.nome ?? '', lead.idioma);
  if (!ctas.length) {
    const tx = textsContent(lead.idioma);
    return { ...tx.ctaPadrao(lead.marca.handle ?? lead.marca.nome ?? tx.aPagina) };
  }
  const chosen = Number.isInteger(index) ? lead.marca.ctas?.[index!] : undefined;
  if (chosen && ctas.includes(chosen)) return chosen;
  let h = 0;
  for (const ch of lead.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return ctas[h % ctas.length];
}

/** The invite chosen in a draft: the `cta` of the invite card, if the editor picked one. */
export const ctaDraft = (r: { cards?: Card[] }) => r.cards?.find((c) => isInvite(c))?.cta ?? null;

/**
 * The system's CTA card (owner's copy), for editing: title and text always come from the brand, never from the editor.
 * `cta` is only stored when the editor chose a CTA from the list.
 */
export function cardInvite(lead: Lead, index: number | null, id: string): Card {
  const cta = chooseCta(lead, index);
  return { id, layout: 'convite', titulo: cta.titulo, frases: [{ texto: cta.texto, fatoId: null }], ...(validCta(lead, index) ? { cta: index } : {}) };
}

/** A valid brand CTA index (the editor only picks among those that exist). */
export const validCta = (lead: Lead, index: unknown): index is number =>
  Number.isInteger(index) && !!lead.marca.ctas?.[index as number] && chooseCta(lead, index as number) === lead.marca.ctas[index as number];

/** The first line of an advertising caption, set by code. `validar` rejects a caption without it. */
export const openingAdvertising = (lead: Lead) => `${advertisingLabel(lead.idioma)} · ${lead.anunciante ?? ''}`;

/**
 * What the system appends to the caption, after the model's text: the CTA's closing and the facts' real source (never
 * what the model makes up, "police reporting"). Deterministic per lead: the validator strips this passage before
 * checking numbers and days, because the outlet's or source's name can contain a number ("Gazeta do Bairro 2") and the
 * model cannot fix what it did not write.
 */
export function closingCaption(lead: Lead, ctaIndex?: number | null): string {
  const cta = chooseCta(lead, ctaIndex);
  // Author: the author owns the outlet; the call to the full text already carries the link, without the "Source:" line.
  if (lead.modo === 'autoral') return `

${cta.legenda.replaceAll(MARKER_LINK, fromTextLink(lead)).trim()}`;
  // Advertising: in place of the source, whose ad it is.
  if (lead.tipoPost === 'publicidade') return `\n\n${cta.legenda}\n\n${advertisingLabel(lead.idioma)}: ${lead.anunciante ?? ''}`;
  const realSources = [...new Set(lead.fatos.map((f) => f.fonteNome ?? new URL(f.fonteUrl).hostname))];
  return `\n\n${cta.legenda}\n\n${textsContent(lead.idioma).fonte}: ${realSources.join(', ')}`;
}

/** The sponsor's fixed line, the caption's last. Only code writes it, and it is only recognised with the exact name. */
export const sponsorshipLine = (lead: Lead, name: string) => `\n\n${textsContent(lead.idioma).oferecimento}: ${name}`;

/**
 * What belongs to the model (or the editor) in the caption: without the system's closing. The closing can come from any
 * of the brand's CTAs, or from a CTA the brand has since replaced (the piece was generated earlier): then the
 * "Source: …" paragraph and the CTA before it are removed. `fecho`: whether there was a recognisable closing.
 */
export function fromCaptionBody(lead: Lead, whole: string, sponsor?: string | null): { corpo: string; fecho: boolean } {
  const line = sponsor ? sponsorshipLine(lead, sponsor) : null;
  const caption = line && whole.endsWith(line) ? whole.slice(0, -line.length) : whole;
  const indexes = [null, ...Array.from({ length: lead.marca.ctas?.length ?? 0 }, (_, i) => i)];
  for (const i of indexes) {
    const f = closingCaption(lead, i);
    if (caption.endsWith(f)) return { corpo: caption.slice(0, -f.length), fecho: true };
  }
  const parts = caption.split('\n\n');
  const closingLabel = lead.tipoPost === 'publicidade' ? advertisingLabel(lead.idioma) : textsContent(lead.idioma).fonte;
  if (lead.modo !== 'autoral' && parts.length >= 3 && parts[parts.length - 1].startsWith(`${closingLabel}: `)) {
    return { corpo: parts.slice(0, -2).join('\n\n'), fecho: true };
  }
  return { corpo: caption, fecho: false };
}

/** The caption with another CTA's closing (the editor swapped the last card's CTA). Without a recognisable closing, it stays. */
export function swapClosing(lead: Lead, caption: string, to: number | null, sponsor: { de?: string | null; para?: string | null } = {}): string {
  const { corpo: body, fecho: closing } = fromCaptionBody(lead, caption, sponsor.de);
  return `${body}${closing ? closingCaption(lead, to) : ''}${sponsor.para ? sponsorshipLine(lead, sponsor.para) : ''}`;
}

/**
 * DeepSeek through the AI Gateway (JSON mode):
 * headline, summary, caption, cards and visualBrief, each sentence tied to a fatoId.
 * TODO: bring the prompt from scripts/lib/social/deepseek.mjs and the tenant's voice examples.
 */
export async function draftPiece(env: Env, input: { pauta: Lead; formato: 'post' | 'carrossel'; instrucao?: string; sequencia?: LayoutContent[] }): Promise<Draft> {
  const { pauta: lead, formato: format, instrucao: instruction, sequencia: sequence } = input;
  // DeepSeek or Gemini (src/lib/textModel.ts), through the AI Gateway when configured; straight to the API in dev; the fake model in e2e.

  const summaryDay = lead.tipoPost === 'resumo';
  const factLine = (f: Lead['fatos'][number]) => `- [${f.id}] ${f.texto}${f.tipo === 'opiniao' && lead.modo === 'autoral' ? ' (author\'s opinion, no external source: attribute it to the author, never as a verified fact)' : ''}${f.bairro ? ` (neighbourhood: ${f.bairro})` : ''}${f.dataFato ? ` (date: ${f.dataFato})` : ''}`;
  // Daily digest: facts per story, so each card covers just one.
  const facts = summaryDay
    ? [...new Set(lead.fatos.map((f) => f.documentoId))].map((doc, i) => `Story ${i + 1}:\n${lead.fatos.filter((f) => f.documentoId === doc).map(factLine).join('\n')}`).join('\n\n')
    : lead.fatos.map(factLine).join('\n');
  const author = lead.modo === 'autoral';
  const correction = lead.tipoPost === 'atualizacao' || lead.tipoPost === 'errata' ? lead.tipoPost : null;
  // English outlet: everything that reaches the reader in English, even with facts in another language (quotes only with English facts).
  const writeAt = lead.idioma === 'en'
    ? 'Write in English: headline, summary, caption and cards, even if the facts are in another language. Use the citacao layout only with a fact already written in English. Headline and titles in sentence case: a capital letter only on the first word and on proper nouns (the check reads a capitalised word as a name).'
    : 'Write in Brazilian Portuguese.';
  const examples = (lead.voz.exemplos ?? []).filter((e) => typeof e === 'string' && e.trim()).slice(0, 3);
  const head = author
    ? [
        `You write the author's own page on Instagram, from a text the author wrote. ${writeAt}`,
        "Keep the author's way of writing: if the original text is in the first person, write in the first person; the tone and vocabulary are the author's.",
        "Write the text's key ideas as the author would present their own argument, not as a news portal headline.",
        'Use ONLY the facts listed (literal passages of the author\'s text). Each sentence must cite the id of the fact that supports it.',
        'Do not invent names, numbers, dates, places, causes or consequences that are not in the passages.',
        'The order of the cards carries the argument: the cover brings the central idea; the following ones develop the main idea and the argument or consequence the author argues for.',
        ...(examples.length
          ? [`Examples of how the author opens their texts (for tone only; they are not facts and cannot be cited):\n${examples.map((e) => `- ${e}`).join('\n')}`]
          : []),
        lead.voz.tom ? `Author's tone: ${lead.voz.tom}` : '',
        lead.voz.evitar?.length ? `Avoid: ${lead.voz.evitar.join('; ')}` : '',
      ]
    : [
        `You are a writer for a local news page. ${writeAt}`,
        'Use ONLY the facts listed. Each sentence must cite the id of the fact that supports it.',
        'Do not invent names, numbers, dates, places, causes or consequences. No opinion adjectives.',
      ];
  const system = [
    ...head,
    'Respond in JSON with: manchete, resumo, legenda, cards[{layout, titulo, frases[{texto, fatoId, rotulo?}]}], visualBrief{primary, context, fatoIds}. rotulo only in comparacao and linha_do_tempo.',
    ...(summaryDay ? ['This post is the day\'s digest: the cover and then one card per story, in the order given, with the texto layout. Each card uses facts from one story only. Do not mix two stories in the same card.'] : []),
    format === 'post'
      ? 'cards must have exactly 1 item (layout capa): it is the only image of the post, with the headline and 1 or 2 sentences tied to facts, at most 200 characters in total.'
      : `cards must have 3 to 6 items, the first with layout capa. For each of the others, the layout that best serves the content: ${LAYOUTS_CONTENT.map((l) => DESCRIPTION_LAYOUT[l]).join('; ')}. citacao only for a literal quote that is in the facts; numero only for a number that is in the facts. DO NOT write a convite card; the system adds it.${sequence?.length ? ` Suggested sequence after the cover: ${sequence.join(', ')}. Change a layout only if the content does not suit it.` : ''}`,
    `Each card is a 1080×1350 image with little room. titulo = short headline specific to that card (NEVER the name of the layout): ${LAYOUTS_CONTENT.map((l) => `${l} ≤ ${LIMITS[l].titulo}`).join(', ')} characters.`,
    format === 'post'
      ? 'capa: titulo and frases (each sentence with the fatoId that supports it).'
      : 'capa: frases empty (headline only). texto: 1 or 2 sentences, at most 240 characters in total. Every sentence, of any layout, with the fatoId that supports it.',
    'visualBrief.primary: affirmative description of ONE illustrable scene with only place, objects and condition (e.g.: "pátio de contêineres ao entardecer, portão aberto"). Never cite people, plates, posters, papers, signs, weapons or text. Only what the facts support. visualBrief.fatoIds: ids of the facts the scene uses. Write visualBrief in Brazilian Portuguese.',
    author
      ? 'manchete ≤ 90 characters. legenda: Instagram text in the author\'s voice, may be longer, with the ideas of the text. Do NOT write a link, fact ids or "Fonte:" in the legenda; the system adds the call to the full text.'
      : 'manchete ≤ 90 characters. legenda: full Instagram text, may be longer, with the facts. Do NOT write fact ids or "Fonte:" in the legenda; the system adds the real source.',
    correction
      ? `This post is ${lead.tipoPost === 'errata' ? 'an ERRATUM' : 'an UPDATE'} to a text already published ("${lead.titulo}"): say only what changed or what was corrected, with the fact listed, without repeating the story. The system puts the label on the headline.`
      : '',
    lead.tipoPost === 'publicidade'
      ? `This post is ADVERTISING for ${lead.anunciante}, not news: never call it 'notícia', 'reportagem' or 'matéria', nor news, a report or a story. Use only what the briefing says, with price and date exactly as they are in the facts. Do not write the advertising label: the system adds it.`
      : '',
    instruction ? `Editor's instruction: ${instruction}` : '',
  ].filter(Boolean).join('\n');
  const user = `Lead: ${lead.titulo}\n${lead.resumo ?? ''}\nSection: ${lead.editoria ?? 'cidade'}\nFacts:\n${facts}`;

  // Usage is recorded before reading the reply: if it is malformed, the call has already been paid for.
  const { json, custoUsd: costUsd, modelo: model } = await callText(env, { tenantId: lead.tenantId, funcao: 'post' }, system, user, 0.3);
  const parsed = json as Omit<Draft, 'modelo' | 'custoUsd'>;

  // The CTA and the caption's closing are the owner's copy (marca.ctas), rotated per lead. The model never writes a CTA.
  const cta = chooseCta(lead);
  // The "my own claim" mark only belongs to whoever writes by hand (Review): anything the model returns with it loses the mark.
  const fromModel = (Array.isArray(parsed.cards) ? parsed.cards : []).map(cleanModel);
  if (format === 'carrossel') {
    parsed.cards = fromModel.filter((c) => !isInvite(c)).slice(0, MAX_CARDS - 1);
    parsed.cards.push({ papel: 'convite', titulo: cta.titulo, frases: [{ texto: cta.texto, fatoId: null }] });
  } else {
    // Post: a single image. The first card is the cover, whatever layout the model wrote.
    parsed.cards = fromModel.slice(0, 1).map(({ layout: _l, ...c }) => ({ ...c, papel: 'capa' as const }));
  }
  // Correction post: the label goes on the headline, the cover and the start of the caption by code (the model may forget).
  if (correction) {
    const label = textsContent(lead.idioma).rotuloCorrecao(correction);
    const withValue = (s: unknown) => { const x = String(s ?? '').trim(); return x.toLowerCase().startsWith(label.toLowerCase()) ? x : `${label}: ${x}`; };
    parsed.manchete = withValue(parsed.manchete);
    if (parsed.cards[0]) parsed.cards[0] = { ...parsed.cards[0], titulo: withValue(parsed.cards[0].titulo) };
    parsed.legenda = withValue(parsed.legenda);
  }
  parsed.legenda = `${String(parsed.legenda ?? '').replace(/\s*(?:Fonte|Source):[^\n]*$/i, '').trim()}${closingCaption(lead)}`;
  if (lead.tipoPost === 'publicidade') parsed.legenda = `${openingAdvertising(lead)}\n\n${parsed.legenda}`;

  return { ...parsed, modelo: model, custoUsd: costUsd };
}

/**
 * Card as the model returned it → system card. The old role, if present, stays and counts as always; otherwise the
 * layout (outside the set, it becomes text). Sentences with text and fatoId only: without the author mark. No id
 * (`idOf` derives it on read).
 */
function cleanModel(c: Card): Card {
  const sentences = (Array.isArray(c?.frases) ? c.frases : []).map((f) => ({ texto: String(f?.texto ?? ''), fatoId: f?.fatoId ?? null, ...(typeof f?.rotulo === 'string' && f.rotulo.trim() ? { rotulo: f.rotulo.trim() } : {}) }));
  const title = String(c?.titulo ?? '');
  return c?.papel ? { papel: c.papel, titulo: title, frases: sentences } : { layout: isLayoutContent(c?.layout) ? c.layout : 'texto', titulo: title, frases: sentences };
}
