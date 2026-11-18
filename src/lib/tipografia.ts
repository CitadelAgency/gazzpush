// Catálogo curto de pares de fontes do card (OFL, woff2 subconjunto latino em assets/fonts/, licença ao lado). O par é
// do veículo (marca.fontes), não do card. Puro: o render embute os arquivos em base64 e a prévia da web os pede por URL.
// No template: `Corpo` é a família do texto; `Destaque` a do nome do veículo e do título do convite; o título dos cards
// usa a família de `titulo` (no par padrão, a do corpo em peso 900, como sempre foi).

export const PARES_FONTES = ['padrao', 'jornal', 'grotesca'] as const;
export type ParFontes = (typeof PARES_FONTES)[number];

export interface DefinicaoPar {
  nome: string;
  descricao: string;
  /** Nome e descrição nas telas em inglês. */
  nomeEn: string;
  descricaoEn: string;
  corpo: { familia: string; arquivo: string; pesos: string };
  destaque: { familia: string; arquivo: string; pesos: string };
  /** Qual das duas famílias faz o título dos cards. */
  titulo: 'corpo' | 'destaque';
}

export const PAR_PADRAO: ParFontes = 'padrao';

export const CATALOGO_FONTES: Record<ParFontes, DefinicaoPar> = {
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

export const ehParFontes = (v: unknown): v is ParFontes => typeof v === 'string' && (PARES_FONTES as readonly string[]).includes(v);
export const parDe = (v: unknown): ParFontes => (ehParFontes(v) ? v : PAR_PADRAO);

/** Faixa de pesos de cada família no @font-face (a de cada arquivo variável). */
export const pesosDoPar = (par: ParFontes) => ({ FONT_BODY_WEIGHT: CATALOGO_FONTES[par].corpo.pesos, FONT_DISPLAY_WEIGHT: CATALOGO_FONTES[par].destaque.pesos });

/** Classe do `<article>` que põe o título na família de destaque (pares em que ela é a serifa ou a grotesca). */
export const classeTitulo = (par: ParFontes) => (CATALOGO_FONTES[par].titulo === 'destaque' ? 'titulo-destaque' : '');
