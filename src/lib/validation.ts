import type { Lead } from './lead';
import { openingAdvertising, fromCaptionBody, type Draft } from './drafting';
import type { ContentLanguage } from './contentLanguage';
import { WITH_LABEL, LIMITS, LITERAL, MAX_CARDS, LABEL_MAX, MIN_CARDS, LAYOUT_NAME, LAYOUT_NAME_EN, isInvite, layoutOf, normalizeCards, cardLabel, type Card, type Sentence } from './cards';

export interface Validation {
  ok: boolean;
  erros: string[];
  avisos: string[];
  /** Per card (id from `normalizeCards`): the reason in plain language, for Review to show on the card itself. */
  porCard?: Record<string, string[]>;
  /** What does not belong to a card (headline, caption, the whole piece), also in plain language. */
  geral?: string[];
  /** The same `porCard` and `geral` messages in English, for whoever uses the screens in English (old validations lack them). */
  en?: { porCard?: Record<string, string[]>; geral?: string[] };
}

export interface OptionsValidation {
  /** A version written by a person (editing in Review). Only there does a sentence marked "my own claim" count. */
  humano?: boolean;
  /** Carousel: checks the number of cards (2 to 10) and the CTA at the end. Only editing sends it; the AI has the limit in code. */
  formato?: 'post' | 'carrossel';
}

const DAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const RE_DAYS = /\b(domingo|segunda|terça|quarta|quinta|sexta|sábado)(?:-feira)?\b/g;
const RE_NUM = /\b\d+(?:[.,]\d+)?\b/g;
// English outlet: the same days, in English.
const DAYS_EN = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const RE_DAYS_EN = /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/g;

/** Lower case without accents: compare a person's or place's name regardless of case and accents. */
const plan = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** For checking a quote: no quote marks, no punctuation at the ends and single spaces (case and accents count as equal). */
const literal = (s: string) => plan(s).replace(/["“”«»'‘’]/g, '').replace(/\s+/g, ' ').trim().replace(/^[\s.,;:!?—–-]+|[\s.,;:!?—–-]+$/g, '');

// Words that appear capitalised mid-sentence without being proper names.
const NOT_NAME = new Set(['eu', 'o', 'a', 'os', 'as', 'um', 'uma', 'e', 'é', 'de', 'da', 'do', 'em', 'no', 'na', 'que', 'se', 'mas', 'para', 'pra', 'por']);
// In English, also days and months (always capitalised) and the short words a title-cased heading carries.
// A Title With Every Word Capitalised still counts as names: the prompt asks only for the first word and names.
const NOT_NAME_EN = new Set([
  'i', 'a', 'an', 'the', 'and', 'or', 'but', 'of', 'in', 'on', 'at', 'to', 'for', 'from', 'by', 'with', 'as', 'is', 'are', 'was', 'were',
  'it', 'its', 'this', 'that', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'they', 'his', 'her', 'their', 'im', 'ive', 'id', 'ill',
  ...DAYS_EN, 'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
]);

/**
 * The text's proper names: a capitalised word that does not start a sentence (starting a sentence requires a capital
 * anyway), and acronyms. A passage entirely in upper case is emphasis, not a name, and is left out.
 */
export function ownNames(text: string, language?: ContentLanguage): string[] {
  const notName = language === 'en' ? NOT_NAME_EN : NOT_NAME;
  const names: string[] = [];
  for (const passage of text.split(/[.!?:;\n"“”«»()—–]+|\s-\s/)) {
    const words = passage.match(/[\p{L}][\p{L}\p{M}'’-]*/gu) ?? [];
    const letters = words.join('');
    if (letters.length > 3 && letters === letters.toUpperCase()) continue;
    words.forEach((p, i) => {
      if (i === 0 || p.length < 2 || !/^\p{Lu}/u.test(p) || notName.has(plan(p).replace(/['’]/g, ''))) return;
      names.push(p.replace(/['’]s$/, ''));
    });
  }
  return [...new Set(names)];
}

/**
 * Deterministic checks, no AI. JornAI style: whatever can be proven in code is proven in code.
 * - every factual card sentence points to an existing fatoId, and there is at least one (a post with no sentence tied
 *   to a fact breaks the "every sentence tied to its source" promise); the exception is the author's "my own claim", in
 *   a human version
 * - numbers mentioned exist in some fact (only in the model's text: the caption's closing and the CTA are the system's)
 * - a day of the week mentioned matches data_fato
 * - proper names in the cards and the headline appear in the facts
 * - title and body limits of each layout
 * - a neighbourhood mentioned is the lead's/facts'
 */
export function validate(lead: Lead, r: Draft, o: OptionsValidation = {}): Validation {
  const errors: string[] = [];
  const warnings: string[] = [];
  // Each plain-language reason in both screen languages: the reviewer may use the app in English.
  const perCard: Record<string, string[]> = Object.create(null);
  const perCardEn: Record<string, string[]> = Object.create(null);
  const inCard = (id: string, reason: string, en: string) => { (perCard[id] ??= []).push(reason); (perCardEn[id] ??= []).push(en); };
  const general: [string, string][] = [];
  const generalIn = (reason: string, en: string) => { general.push([reason, en]); };
  const factIds = new Set(lead.fatos.map((f) => f.id));
  // Daily digest: each card shows one source, so it can only cover one story.
  if (lead.tipoPost === 'resumo') {
    const documentOf = new Map(lead.fatos.map((f) => [f.id, f.documentoId]));
    for (const card of normalizeCards(r.cards ?? [])) {
      const documents = new Set((card.frases ?? []).flatMap((f) => (f.fatoId && documentOf.has(f.fatoId) ? [documentOf.get(f.fatoId)] : [])));
      if (documents.size > 1) {
        errors.push(`card com duas notícias (${cardLabel(card)})`);
        inCard(card.id, 'Este card mistura fatos de duas notícias. Deixe só uma: cada card do resumo mostra uma fonte.', 'This card mixes facts from two stories. Keep one: each roundup card shows a single source.');
      }
    }
  }
  const factsText = lead.fatos.map((f) => f.texto).join(' \n ');
  const author = lead.modo === 'autoral';
  const english = lead.idioma === 'en';
  const days = english ? DAYS_EN : DAYS;
  const reDays = english ? RE_DAYS_EN : RE_DAYS;

  const cards = normalizeCards(r.cards);
  const factual = cards.filter((c) => !isInvite(c));
  // The author's sentence ("my own claim"): they are the source. Outside the author outlet, or in an AI version, it does not count.
  const fromAuthor = (f: Sentence) => !!f.autor && author && !!o.humano;
  let pinned = 0;
  for (const card of factual) {
    for (const sentence of card.frases) {
      if (sentence.autor && !fromAuthor(sentence)) {
        errors.push(`afirmação do autor fora de lugar (${cardLabel(card)}): "${sentence.texto.slice(0, 60)}"`);
        inCard(card.id, author
          ? `"${sentence.texto.slice(0, 60)}" está marcada como afirmação sua, mas esta versão não foi escrita por uma pessoa. Prenda a frase a um fato.`
          : `"${sentence.texto.slice(0, 60)}" está marcada como afirmação do autor, o que só vale em veículo de autor. Prenda a frase a um fato.`,
          author
          ? `"${sentence.texto.slice(0, 60)}" is marked as your own claim, but this version wasn't written by a person. Link the sentence to a fact.`
          : `"${sentence.texto.slice(0, 60)}" is marked as the author's claim, which only counts in an author publication. Link the sentence to a fact.`);
        continue;
      }
      if (fromAuthor(sentence)) { pinned++; continue; }
      if (!sentence.fatoId) {
        errors.push(`frase sem fato (${cardLabel(card)}): "${sentence.texto.slice(0, 60)}"`);
        inCard(card.id, `"${sentence.texto.slice(0, 60)}" não está presa a nenhum fato da fonte. Escolha o fato que sustenta a frase${author ? ' ou marque como afirmação sua' : ''}.`,
          `"${sentence.texto.slice(0, 60)}" isn't linked to any fact from the source. Pick the fact that backs the sentence${author ? ' or mark it as your own claim' : ''}.`);
        continue;
      }
      if (!factIds.has(sentence.fatoId)) {
        errors.push(`fatoId inexistente ${sentence.fatoId} (${cardLabel(card)})`);
        inCard(card.id, `"${sentence.texto.slice(0, 60)}" aponta para um fato que não está nesta pauta. Escolha outro fato.`,
          `"${sentence.texto.slice(0, 60)}" points to a fact that isn't in this idea. Pick another fact.`);
        continue;
      }
      // A quote is someone's speech: the quoted passage must be, word for word, in the fact it cites.
      if (LITERAL.includes(layoutOf(card))) {
        const fact = lead.fatos.find((f) => f.id === sentence.fatoId)!;
        if (!literal(fact.texto).includes(literal(sentence.texto))) {
          errors.push(`citação não literal (${cardLabel(card)})`);
          inCard(card.id, 'A citação precisa ser o trecho exato do fato, palavra por palavra. Copie a frase do fato ou use o layout Texto.',
            'The quote must be the exact passage from the fact, word for word. Copy the sentence from the fact or use the Text layout.');
        }
      }
      pinned++;
    }
  }
  if (!pinned) {
    errors.push('nenhuma frase com fonte: os cards precisam de frases presas a um fato');
    generalIn('Nenhuma frase dos cards está presa a um fato da fonte. Prenda pelo menos uma.', 'No sentence in the cards is linked to a fact from the source. Link at least one.');
  }

  // Only what the model (or the editor) wrote: the caption's closing (CTA and "Source:") and the CTA card are the system's.
  const advertising = lead.tipoPost === 'publicidade';
  const captionBody = fromCaptionBody(lead, String(r.legenda ?? ''), r.estilo?.patrocinador?.nome).corpo;
  const opening = advertising ? openingAdvertising(lead) : '';
  // The opening is the system's (the advertiser's name may contain a number). Without it, the caption stopped saying it is advertising.
  if (advertising && !captionBody.startsWith(opening)) {
    errors.push('legenda de publicidade sem o rótulo');
    generalIn(`A legenda precisa começar com "${opening}". Volte o rótulo.`, `The caption must start with "${opening}". Put the label back.`);
  }
  const modelCaption = advertising && captionBody.startsWith(opening) ? captionBody.slice(opening.length) : captionBody;
  // In advertising a number is a price: compare as a whole token, because `includes` accepts 19,9 inside 19,90.
  const tokensFacts = new Set(factsText.match(RE_NUM) ?? []);
  const inFactsNumber = (n: string) => (advertising ? tokensFacts.has(n) : factsText.includes(n));
  // Each card's checked text: title and sentences, minus the author's claims (they answer for those).
  const cardText = (c: Card) => [c.titulo, ...c.frases.filter((f) => !fromAuthor(f)).flatMap((f) => [f.rotulo ?? '', f.texto])].join(' \n ');
  const pieceText = [r.manchete, r.resumo, modelCaption, ...factual.map(cardText)].join(' ');

  for (const num of pieceText.match(RE_NUM) ?? []) {
    if (!inFactsNumber(num)) errors.push(`número ${num} não aparece nos fatos`);
  }
  const outsideText = [r.manchete, r.resumo, modelCaption].join(' \n ');
  for (const num of new Set(outsideText.match(RE_NUM) ?? [])) {
    if (!inFactsNumber(num)) generalIn(`O número ${num} da manchete ou da legenda não aparece em nenhum fato da fonte.`, `The number ${num} in the headline or caption doesn't appear in any fact from the source.`);
  }

  const dates = lead.fatos.map((f) => f.dataFato).filter(Boolean) as string[];
  const expected = new Set(dates.map((d) => days[new Date(`${d}T12:00:00-03:00`).getDay()]));
  const wrongDay = (day: string) => dates.length > 0 && !expected.has(day.replace('-feira', ''));
  for (const day of pieceText.toLowerCase().match(reDays) ?? []) {
    if (wrongDay(day)) errors.push(`dia "${day}" não bate com data dos fatos (${[...expected].join(', ')})`);
  }
  for (const day of new Set(outsideText.toLowerCase().match(reDays) ?? [])) {
    if (wrongDay(day)) generalIn(`"${day}", na manchete ou na legenda, não bate com a data dos fatos (foi ${[...expected].join(' ou ')}).`, `"${day}", in the headline or caption, doesn't match the date of the facts (it was ${[...expected].join(' or ')}).`);
  }

  // Names: what appears in the facts, plus the names that belong to the outlet itself, the area and the author.
  const known = plan([factsText, lead.marca.nome, lead.marca.handle, lead.marca.assinatura, lead.cidade, lead.bairro, lead.anunciante].filter(Boolean).join(' \n '));
  const knownName = (n: string) => new RegExp(`(^|[^\\p{L}])${plan(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'u').test(known);
  const outsideNames = (t: string) => ownNames(t, lead.idioma).filter((n) => !knownName(n));
  for (const n of outsideNames(r.manchete ?? '')) {
    errors.push(`nome "${n}" não aparece nos fatos`);
    generalIn(`"${n}", na manchete, não aparece em nenhum fato da fonte.`, `"${n}", in the headline, doesn't appear in any fact from the source.`);
  }

  // Per card: numbers, days and names, with the reason on the card itself.
  for (const card of factual) {
    const t = cardText(card);
    for (const num of new Set(t.match(RE_NUM) ?? [])) if (!inFactsNumber(num)) inCard(card.id, `O número ${num} não aparece em nenhum fato da fonte.`, `The number ${num} doesn't appear in any fact from the source.`);
    for (const day of new Set(t.toLowerCase().match(reDays) ?? [])) {
      if (wrongDay(day)) inCard(card.id, `"${day}" não bate com a data dos fatos (foi ${[...expected].join(' ou ')}).`, `"${day}" doesn't match the date of the facts (it was ${[...expected].join(' or ')}).`);
    }
    for (const n of outsideNames(t)) {
      errors.push(`nome "${n}" não aparece nos fatos (${cardLabel(card)})`);
      inCard(card.id, `"${n}" não aparece em nenhum fato da fonte. Tire o nome ou prenda a frase a um fato que o cite.`, `"${n}" doesn't appear in any fact from the source. Remove the name or link the sentence to a fact that mentions it.`);
    }
  }

  const neighborhoods = new Set(lead.fatos.map((f) => f.bairro).filter(Boolean).concat(lead.bairro ? [lead.bairro] : []) as string[]);
  if (neighborhoods.size && lead.bairro && !pieceText.includes(lead.bairro)) warnings.push(`bairro da pauta (${lead.bairro}) não citado`);

  if (!r.manchete?.trim()) { errors.push('manchete vazia'); generalIn('A peça está sem manchete.', 'The post has no headline.'); }
  if ((r.manchete ?? '').length > 90) { errors.push(`manchete longa (${r.manchete.length} > 90)`); generalIn(`A manchete tem ${r.manchete.length} caracteres; cabem 90.`, `The headline has ${r.manchete.length} characters; 90 fit.`); }

  // Limits of the 1080×1350 template, per layout. Beyond them the render rejects; better to reject here and rewrite.
  const ROLES = new Set(['capa', 'o_que_aconteceu', 'contexto', 'convite']);
  for (const card of cards) {
    const lim = LIMITS[layoutOf(card)];
    const name = cardLabel(card);
    const title = card.titulo ?? '';
    const body = card.frases.map((f) => f.texto).join(' ');
    const n = card.frases.length;
    if (!title.trim()) { errors.push(`card ${name} sem título`); inCard(card.id, 'O card está sem título.', 'The card has no title.'); }
    if (ROLES.has(title.trim().toLowerCase().replace(/ /g, '_')) || /^(o que aconteceu|contexto|convite|capa)$/i.test(title.trim())) {
      errors.push(`card ${name}: título é o nome do papel, não uma manchete`);
      inCard(card.id, 'O título é o nome do tipo de card. Escreva uma manchete para ele.', 'The title is the name of the card type. Write a headline for it.');
    }
    for (const f of card.frases) {
      const label = f.rotulo ?? '';
      if (WITH_LABEL.includes(layoutOf(card)) && !label.trim()) {
        errors.push(`card ${name}: frase sem rótulo`);
        inCard(card.id, `"${f.texto.slice(0, 60)}" está sem rótulo. ${layoutOf(card) === 'linha_do_tempo' ? 'Escreva a data.' : 'Escreva o lado comparado.'}`, `"${f.texto.slice(0, 60)}" has no label. ${layoutOf(card) === 'linha_do_tempo' ? 'Write the date.' : 'Write the side being compared.'}`);
      }
      if (label.length > LABEL_MAX) {
        errors.push(`card ${name}: rótulo longo (${label.length})`);
        inCard(card.id, `O rótulo "${label.slice(0, 40)}" tem ${label.length} caracteres; cabem ${LABEL_MAX}.`, `The label "${label.slice(0, 40)}" has ${label.length} characters; ${LABEL_MAX} fit.`);
      }
    }
    if (title.length > lim.titulo) {
      errors.push(`card ${name}: título longo (${title.length})`);
      inCard(card.id, `O título tem ${title.length} caracteres; neste layout cabem ${lim.titulo}.`, `The title has ${title.length} characters; this layout fits ${lim.titulo}.`);
    }
    // The prompt asks for ≤ 240; here the slack goes to 280 because the render's layout QA is the real gate. 251 fitted and
    // cost 2 rewrites. It applies to the cover too: in a post it carries the sentences (in a carousel it comes empty and passes).
    if (body.length > lim.corpo) {
      errors.push(`card ${name}: corpo longo (${body.length} > ${lim.corpo})`);
      inCard(card.id, `O texto do card tem ${body.length} caracteres; neste layout cabem ${lim.corpo}.`, `The card text has ${body.length} characters; this layout fits ${lim.corpo}.`);
    }
    if (n > lim.frasesMax) {
      errors.push(`card ${name}: mais de ${lim.frasesMax} frase${lim.frasesMax > 1 ? 's' : ''}`);
      inCard(card.id, `${LAYOUT_NAME[layoutOf(card)]} leva no máximo ${lim.frasesMax} frase${lim.frasesMax > 1 ? 's' : ''}; este card tem ${n}.`,
        `${LAYOUT_NAME_EN[layoutOf(card)]} takes at most ${lim.frasesMax} sentence${lim.frasesMax > 1 ? 's' : ''}; this card has ${n}.`);
    }
    if (n < lim.frasesMin) {
      errors.push(`card ${name}: menos de ${lim.frasesMin} frase${lim.frasesMin > 1 ? 's' : ''}`);
      inCard(card.id, `${LAYOUT_NAME[layoutOf(card)]} precisa de ${lim.frasesMin === 1 ? '1 frase' : `pelo menos ${lim.frasesMin} frases`}.`,
        `${LAYOUT_NAME_EN[layoutOf(card)]} needs ${lim.frasesMin === 1 ? '1 sentence' : `at least ${lim.frasesMin} sentences`}.`);
    }
    if (lim.frase) for (const f of card.frases) {
      if (f.texto.length > lim.frase) inCard(card.id, `Um item da lista tem ${f.texto.length} caracteres; cabem ${lim.frase}.`, `A list item has ${f.texto.length} characters; ${lim.frase} fit.`);
    }
    if (card.frases.some((f) => !f.texto.trim())) { errors.push(`card ${name}: frase vazia`); inCard(card.id, 'Há uma frase vazia. Escreva ou tire.', 'There is an empty sentence. Write it or remove it.'); }
  }

  if (o.formato === 'carrossel') {
    if (cards.length < MIN_CARDS || cards.length > MAX_CARDS) {
      errors.push(`carrossel com ${cards.length} cards (de ${MIN_CARDS} a ${MAX_CARDS})`);
      generalIn(`O carrossel tem ${cards.length} cards; vão de ${MIN_CARDS} a ${MAX_CARDS}, contando o convite.`, `The carousel has ${cards.length} cards; it takes ${MIN_CARDS} to ${MAX_CARDS}, counting the invite card.`);
    }
    if (!cards.length || !isInvite(cards[cards.length - 1]) || cards.filter((c) => isInvite(c)).length !== 1) {
      errors.push('o convite é o último card, e só um');
      generalIn('O convite é o último card, e só um.', 'The invite card is the last card, and there is only one.');
    }
  }

  // A card error only the per-card count caught (a long list item) also rejects.
  const someCard = Object.keys(perCard).length > 0;
  if (someCard && !errors.length) errors.push('há card com problema');
  // An error with no plain-language reason anywhere (there should be none): the screen still says there is something to fix.
  if (errors.length && !someCard && !general.length) generalIn('A conferência apontou um problema fora dos cards. Peça para reescrever.', 'The check found a problem outside the cards. Ask for a rewrite.');
  const unique = general.filter(([pt], i) => general.findIndex(([p]) => p === pt) === i);
  const en = { ...(someCard ? { porCard: perCardEn } : {}), ...(unique.length ? { geral: unique.map(([, e]) => e) } : {}) };
  return {
    ok: errors.length === 0, erros: errors, avisos: warnings,
    ...(someCard ? { porCard: perCard } : {}), ...(unique.length ? { geral: unique.map(([pt]) => pt) } : {}),
    ...(someCard || unique.length ? { en } : {}),
  };
}
