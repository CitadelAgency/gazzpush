// Carousel card model (Phase 3): `{id, layout, titulo, frases, imagem?}`, 2 to 10 cards, the last always the system's
// CTA. Pure and with no Worker dependency: the web app imports this file for editing in Review.
//
// Compatibility: pieces saved earlier had a fixed `papel` (capa, o_que_aconteceu, contexto, convite) and no id. Nothing
// is rewritten in the database: `layoutOf` and `idOf` derive what is missing on read, and the old `papel` still counts
// for the render (class and top label of the card), so an old piece comes out as it used to.

export const LAYOUTS = ['capa', 'texto', 'citacao', 'numero', 'lista', 'documento', 'comparacao', 'linha_do_tempo', 'convite'] as const;
export type Layout = (typeof LAYOUTS)[number];
/** The ones the model and the editor choose. The CTA belongs to the system (owner's copy, `marca.ctas`). */
export const LAYOUTS_CONTENT = ['capa', 'texto', 'citacao', 'numero', 'lista', 'documento', 'comparacao', 'linha_do_tempo'] as const satisfies readonly Layout[];
export type LayoutContent = (typeof LAYOUTS_CONTENT)[number];
export type OldRole = 'capa' | 'o_que_aconteceu' | 'contexto' | 'convite';

/** Instagram accepts up to 10 children in a carousel; fewer than 2 is not a carousel. The last one is the CTA. */
export const MIN_CARDS = 2;
export const MAX_CARDS = 10;

/** Cap for a card's own photo (the browser already shrinks it before upload; the logo stays at 512 KB). */
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;

/** Framing of the own photo. */
export const FOCUSES = ['centro', 'topo', 'base', 'esquerda', 'direita'] as const;
export type Focus = (typeof FOCUSES)[number];
export const isFocus = (v: unknown): v is Focus => typeof v === 'string' && (FOCUSES as readonly string[]).includes(v);

/** Who took the photo and under what right: the uploader's statement, stored on the piece for the certificate. */
export const ORIGIN_PHOTO_TYPES = ['minha', 'equipe', 'autorizada'] as const;
export type OriginPhotoType = (typeof ORIGIN_PHOTO_TYPES)[number];
export const AUTHOR_PHOTO_MAX = 80;
export interface PhotoOrigin { autor: string; tipo: OriginPhotoType }

export const LABEL_MAX = 24;
/** The layouts where each sentence carries a label. */
/** Does the card show an illustration? The CTA, documents and the Poster composition do not. */
export const takesArt = (c: { layout: Layout }, composition?: string) => c.layout !== 'convite' && c.layout !== 'documento' && composition !== 'cartaz';

export const WITH_LABEL: readonly Layout[] = ['comparacao', 'linha_do_tempo'];
/** The sentence is a passage of the fact, word for word. */
export const LITERAL: readonly Layout[] = ['citacao', 'documento'];

export interface Sentence {
  texto: string;
  fatoId: string | null;   // null = no fact: only on the CTA, or with `autor`
  /** Comparison and timeline: the compared side, or the date. Goes through the number and date checks. */
  rotulo?: string;
  /** "My own claim": only in the author outlet and only in a version written by a person (the author is the source). */
  autor?: boolean;
}

export interface Card {
  id?: string;             // missing on old pieces and in model output: `idOf`
  layout?: Layout;         // missing on old pieces: `layoutOf`
  papel?: OldRole;     // only old pieces and old model output
  titulo: string;
  frases: Sentence[];
  imagem?: string | null;  // R2 key of an own photo (fotos/<tenant>/<piece>/…)
  ilustracao?: string | null; // R2 key of the illustration for this card only (artes/<tenant>/<piece>/cards/…)
  foco?: Focus;             // framing of the own photo; missing: centre
  fotoOrigem?: PhotoOrigin; // required on a new photo; missing on photos saved before it existed
  cta?: number;            // CTA: which of the brand's CTAs (index into marca.ctas)
}

export type CardNormal = Card & { id: string; layout: Layout };

const ROLE: Record<OldRole, Layout> = { capa: 'capa', o_que_aconteceu: 'texto', contexto: 'texto', convite: 'convite' };

export const isLayout = (v: unknown): v is Layout => typeof v === 'string' && (LAYOUTS as readonly string[]).includes(v);
export const isLayoutContent = (v: unknown): v is LayoutContent => typeof v === 'string' && (LAYOUTS_CONTENT as readonly string[]).includes(v);

export function layoutOf(card: Pick<Card, 'layout' | 'papel'>): Layout {
  if (isLayout(card.layout)) return card.layout;
  return card.papel && ROLE[card.papel] ? ROLE[card.papel] : 'texto';
}

/** Stable id: the stored one; otherwise the old role (unique in an old piece) or the position (model output). */
export const idOf = (card: Pick<Card, 'id' | 'papel'>, i: number) => card.id ?? card.papel ?? `c${i + 1}`;

export const isInvite = (card: Pick<Card, 'layout' | 'papel'>) => layoutOf(card) === 'convite';

/** Cards with explicit id and layout (the rest as is). Repeated ids (there should be none) get a suffix. */
export function normalizeCards(cards: Card[] | undefined): CardNormal[] {
  const seen = new Set<string>();
  return (cards ?? []).map((c, i) => {
    let id = idOf(c, i);
    while (seen.has(id)) id = `${id}-${i + 1}`;
    seen.add(id);
    return { ...c, id, layout: layoutOf(c), frases: Array.isArray(c.frases) ? c.frases : [] };
  });
}

/** How the card appears in validation messages and in the file name: the old role, or the layout. */
export const cardLabel = (card: Pick<Card, 'layout' | 'papel'>) => card.papel ?? layoutOf(card);

/**
 * Limits of each layout in the 1080×1350 template (the render's layout QA is the final gate). `capa` and `texto` are the
 * earlier ones (cover ≤ 90 title, text ≤ 110, body ≤ 280, up to 2 sentences). `frase`: cap for each sentence (list).
 */
export const LIMITS: Record<Layout, { titulo: number; corpo: number; frasesMin: number; frasesMax: number; frase?: number }> = {
  capa: { titulo: 90, corpo: 280, frasesMin: 0, frasesMax: 2 },
  texto: { titulo: 110, corpo: 280, frasesMin: 0, frasesMax: 2 },
  citacao: { titulo: 60, corpo: 220, frasesMin: 1, frasesMax: 1 },
  numero: { titulo: 16, corpo: 200, frasesMin: 1, frasesMax: 1 },
  lista: { titulo: 90, corpo: 360, frasesMin: 2, frasesMax: 4, frase: 110 },
  documento: { titulo: 70, corpo: 240, frasesMin: 1, frasesMax: 1 },
  comparacao: { titulo: 80, corpo: 160, frasesMin: 2, frasesMax: 2, frase: 80 },
  linha_do_tempo: { titulo: 80, corpo: 300, frasesMin: 2, frasesMax: 4, frase: 80 },
  convite: { titulo: 80, corpo: 200, frasesMin: 1, frasesMax: 1 },
};

/** For the prompt and for the screen: what each layout is. */
export const DESCRIPTION_LAYOUT: Record<LayoutContent, string> = {
  capa: 'capa: the headline of the post (always the first card in the carousel, no sentences)',
  texto: 'texto: title and 1 or 2 sentences',
  citacao: 'citacao: one literal sentence in quotation marks (1 sentence) and, in the title, who said it (up to 60 characters)',
  numero: 'numero: a number highlighted in the title (up to 16 characters, e.g. "15 dias") and 1 sentence that explains it',
  lista: 'lista: title and 2 to 4 short items (each item is a sentence of up to 110 characters)',
  documento: 'documento: a literal passage from a public document (1 sentence, copied from the fact, word for word) and, in the title, the name of the document or agency',
  comparacao: 'comparacao: title and 2 sentences, each with a rotulo (the side being compared, up to 24 characters) and the value in the text (up to 80 characters)',
  linha_do_tempo: 'linha_do_tempo: title and 2 to 4 sentences in order, each with the date in the rotulo (up to 24 characters)',
};

export const LAYOUT_NAME: Record<Layout, string> = {
  capa: 'Capa', texto: 'Texto', citacao: 'Citação', numero: 'Número em destaque', lista: 'Lista', documento: 'Documento', comparacao: 'Comparação', linha_do_tempo: 'Linha do tempo', convite: 'Convite',
};
/** The same names on the English screens. */
export const LAYOUT_NAME_EN: Record<Layout, string> = {
  capa: 'Cover', texto: 'Text', citacao: 'Quote', numero: 'Big number', lista: 'List', documento: 'Document', comparacao: 'Comparison', linha_do_tempo: 'Timeline', convite: 'Invite card',
};
