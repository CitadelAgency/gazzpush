// Short catalogue of card font pairs (OFL, latin-subset woff2 in assets/fonts/, licence next to it). The pair belongs to
// the outlet (marca.fontes), not to the card. Pure: the render embeds the files as base64 and the web preview requests
// them by URL. In the template: `Corpo` is the text family; `Destaque` the one for the outlet name and the CTA title;
// the cards' title uses the `titulo` family (in the default pair, the body's at weight 900, as it always was).

export const SOURCES_PAIRS = ['padrao', 'jornal', 'grotesca'] as const;
export type SourcesPair = (typeof SOURCES_PAIRS)[number];

export interface DefinitionPair {
  nome: string;
  descricao: string;
  /** Name and description on the English screens. */
  nomeEn: string;
  descricaoEn: string;
  corpo: { familia: string; arquivo: string; pesos: string };
  destaque: { familia: string; arquivo: string; pesos: string };
  /** Which of the two families sets the cards' title. */
  titulo: 'corpo' | 'destaque';
}

export const DEFAULT_PAIR: SourcesPair = 'padrao';

export const CATALOG_SOURCES: Record<SourcesPair, DefinitionPair> = {
  padrao: {
    nome: 'Nunito e Quicksand', descricao: 'Arredondada, de conversa. A de sempre.',
    nomeEn: 'Nunito and Quicksand', descricaoEn: 'Rounded and conversational. The usual one.',
    corpo: { familia: 'Nunito', arquivo: 'nunito-latin.woff2', pesos: '200 1000' }, destaque: { familia: 'Quicksand', arquivo: 'quicksand-latin.woff2', pesos: '300 700' }, titulo: 'corpo',
  },
  jornal: {
    nome: 'Source Serif e Source Sans', descricao: 'Serifa de jornal no título, texto limpo.',
    nomeEn: 'Source Serif and Source Sans', descricaoEn: 'Newspaper serif in the title, clean text.',
    corpo: { familia: 'Source Sans 3', arquivo: 'source-sans-3-latin.woff2', pesos: '200 900' }, destaque: { familia: 'Source Serif 4', arquivo: 'source-serif-4-latin.woff2', pesos: '200 900' }, titulo: 'destaque',
  },
  grotesca: {
    nome: 'Archivo e Inter', descricao: 'Grotesca firme, de cartaz.',
    nomeEn: 'Archivo and Inter', descricaoEn: 'Firm grotesque, poster style.',
    corpo: { familia: 'Inter', arquivo: 'inter-latin.woff2', pesos: '100 900' }, destaque: { familia: 'Archivo', arquivo: 'archivo-latin.woff2', pesos: '100 900' }, titulo: 'destaque',
  },
};

export const isPairSources = (v: unknown): v is SourcesPair => typeof v === 'string' && (SOURCES_PAIRS as readonly string[]).includes(v);
export const pair = (v: unknown): SourcesPair => (isPairSources(v) ? v : DEFAULT_PAIR);

/** Weight range of each family in @font-face (that of each variable file). */
export const fromPairWeights = (fontPair: SourcesPair) => ({ FONT_BODY_WEIGHT: CATALOG_SOURCES[fontPair].corpo.pesos, FONT_DISPLAY_WEIGHT: CATALOG_SOURCES[fontPair].destaque.pesos });

/** Class on `<article>` that puts the title in the display family (pairs where it is the serif or the grotesque). */
export const titleClass = (fontPair: SourcesPair) => (CATALOG_SOURCES[fontPair].titulo === 'destaque' ? 'titulo-destaque' : '');
