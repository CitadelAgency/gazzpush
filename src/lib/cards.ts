// Modelo do card do carrossel (Fase 3): `{id, layout, titulo, frases, imagem?}`, de 2 a 10 cards, o último sempre o
// convite do sistema. Puro e sem dependência do Worker: a web importa este arquivo para a edição na Revisão.
//
// Compatibilidade: peças gravadas antes tinham `papel` fixo (capa, o_que_aconteceu, contexto, convite) e nenhum id. Nada
// é reescrito no banco: `layoutDe` e `idDe` derivam o que falta na leitura, e o `papel` antigo continua valendo para o
// render (classe e rótulo de cima do card), de modo que uma peça antiga sai igual ao que saía.

export const LAYOUTS = ['capa', 'texto', 'citacao', 'numero', 'lista', 'documento', 'comparacao', 'linha_do_tempo', 'convite'] as const;
export type Layout = (typeof LAYOUTS)[number];
/** Os que o modelo e o editor escolhem. O convite é do sistema (copy do dono, `marca.ctas`). */
export const LAYOUTS_DE_CONTEUDO = ['capa', 'texto', 'citacao', 'numero', 'lista', 'documento', 'comparacao', 'linha_do_tempo'] as const satisfies readonly Layout[];
export type LayoutConteudo = (typeof LAYOUTS_DE_CONTEUDO)[number];
export type PapelAntigo = 'capa' | 'o_que_aconteceu' | 'contexto' | 'convite';

/** O Instagram aceita até 10 filhos num carrossel; menos de 2 não é carrossel. O último é o convite. */
export const MIN_CARDS = 2;
export const MAX_CARDS = 10;

/** Teto da foto própria de um card (o navegador já reduz antes de enviar; o logo segue em 512 KB). */
export const FOTO_MAX_BYTES = 2 * 1024 * 1024;

/** Enquadramento da foto própria. */
export const FOCOS = ['centro', 'topo', 'base', 'esquerda', 'direita'] as const;
export type Foco = (typeof FOCOS)[number];
export const ehFoco = (v: unknown): v is Foco => typeof v === 'string' && (FOCOS as readonly string[]).includes(v);

/** Quem fez a foto e com que direito: declaração de quem subiu, guardada na peça para a certidão. */
export const TIPOS_ORIGEM_FOTO = ['minha', 'equipe', 'autorizada'] as const;
export type TipoOrigemFoto = (typeof TIPOS_ORIGEM_FOTO)[number];
export const AUTOR_FOTO_MAX = 80;
export interface FotoOrigem { autor: string; tipo: TipoOrigemFoto }

export const ROTULO_MAX = 24;
/** Os layouts em que cada frase traz um rótulo. */
/** O card mostra ilustração? Convite, documento e a composição Cartaz não mostram. */
export const levaArte = (c: { layout: Layout }, composicao?: string) => c.layout !== 'convite' && c.layout !== 'documento' && composicao !== 'cartaz';

export const COM_ROTULO: readonly Layout[] = ['comparacao', 'linha_do_tempo'];
/** A frase é trecho do fato, palavra por palavra. */
export const LITERAIS: readonly Layout[] = ['citacao', 'documento'];

export interface Frase {
  texto: string;
  fatoId: string | null;   // null = sem fato: só no convite, ou com `autor`
  /** Comparação e linha do tempo: o lado comparado, ou a data. Passa pelas conferências de número e data. */
  rotulo?: string;
  /** "Afirmação minha": só no veículo autoral e só em versão escrita por uma pessoa (o autor é a fonte). */
  autor?: boolean;
}

export interface Card {
  id?: string;             // ausente em peça antiga e na saída do modelo: `idDe`
  layout?: Layout;         // ausente em peça antiga: `layoutDe`
  papel?: PapelAntigo;     // só peça antiga e saída antiga do modelo
  titulo: string;
  frases: Frase[];
  imagem?: string | null;  // chave R2 de foto própria (fotos/<tenant>/<peça>/…)
  ilustracao?: string | null; // chave R2 da ilustração só deste card (artes/<tenant>/<peça>/cards/…)
  foco?: Foco;             // enquadramento da foto própria; ausente: centro
  fotoOrigem?: FotoOrigem; // obrigatória em foto nova; ausente em foto gravada antes de existir
  cta?: number;            // convite: qual dos convites da marca (índice em marca.ctas)
}

export type CardNormal = Card & { id: string; layout: Layout };

const DE_PAPEL: Record<PapelAntigo, Layout> = { capa: 'capa', o_que_aconteceu: 'texto', contexto: 'texto', convite: 'convite' };

export const ehLayout = (v: unknown): v is Layout => typeof v === 'string' && (LAYOUTS as readonly string[]).includes(v);
export const ehLayoutDeConteudo = (v: unknown): v is LayoutConteudo => typeof v === 'string' && (LAYOUTS_DE_CONTEUDO as readonly string[]).includes(v);

export function layoutDe(card: Pick<Card, 'layout' | 'papel'>): Layout {
  if (ehLayout(card.layout)) return card.layout;
  return card.papel && DE_PAPEL[card.papel] ? DE_PAPEL[card.papel] : 'texto';
}

/** Id estável: o gravado; senão o papel antigo (único na peça antiga) ou a posição (saída do modelo). */
export const idDe = (card: Pick<Card, 'id' | 'papel'>, i: number) => card.id ?? card.papel ?? `c${i + 1}`;

export const ehConvite = (card: Pick<Card, 'layout' | 'papel'>) => layoutDe(card) === 'convite';

/** Cards com id e layout explícitos (o resto como está). Ids repetidos (não deveria haver) ganham sufixo. */
export function normalizarCards(cards: Card[] | undefined): CardNormal[] {
  const vistos = new Set<string>();
  return (cards ?? []).map((c, i) => {
    let id = idDe(c, i);
    while (vistos.has(id)) id = `${id}-${i + 1}`;
    vistos.add(id);
    return { ...c, id, layout: layoutDe(c), frases: Array.isArray(c.frases) ? c.frases : [] };
  });
}

/** Como o card aparece nas mensagens da validação e no nome do arquivo: o papel antigo, ou o layout. */
export const rotuloCard = (card: Pick<Card, 'layout' | 'papel'>) => card.papel ?? layoutDe(card);

/**
 * Limites de cada layout no template 1080×1350 (o QA de layout do render é o gate final). `capa` e `texto` são os de
 * antes (capa ≤ 90 de título, texto ≤ 110, corpo ≤ 280, até 2 frases). `frase`: teto de cada frase (lista).
 */
export const LIMITES: Record<Layout, { titulo: number; corpo: number; frasesMin: number; frasesMax: number; frase?: number }> = {
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

/** Para o prompt e para a tela: o que cada layout é. */
export const DESCRICAO_LAYOUT: Record<LayoutConteudo, string> = {
  capa: 'capa: a manchete do post (sempre o primeiro card; no carrossel, sem frases)',
  texto: 'texto: título e 1 ou 2 frases',
  citacao: 'citacao: uma frase literal entre aspas (1 frase) e, no título, de quem é a fala (até 60 caracteres)',
  numero: 'numero: um número em destaque no título (até 16 caracteres, ex.: "15 dias") e 1 frase que o explica',
  lista: 'lista: título e de 2 a 4 itens curtos (cada item é uma frase de até 110 caracteres)',
  documento: 'documento: um trecho literal de documento público (1 frase, copiada do fato, palavra por palavra) e, no título, o nome do documento ou do órgão',
  comparacao: 'comparacao: título e 2 frases, cada uma com rotulo (o lado comparado, até 24 caracteres) e o valor no texto (até 80 caracteres)',
  linha_do_tempo: 'linha_do_tempo: título e de 2 a 4 frases em ordem, cada uma com a data no rotulo (até 24 caracteres)',
};

export const NOME_LAYOUT: Record<Layout, string> = {
  capa: 'Capa', texto: 'Texto', citacao: 'Citação', numero: 'Número em destaque', lista: 'Lista', documento: 'Documento', comparacao: 'Comparação', linha_do_tempo: 'Linha do tempo', convite: 'Convite',
};
/** Os mesmos nomes nas telas em inglês. */
export const NOME_LAYOUT_EN: Record<Layout, string> = {
  capa: 'Cover', texto: 'Text', citacao: 'Quote', numero: 'Big number', lista: 'List', documento: 'Document', comparacao: 'Comparison', linha_do_tempo: 'Timeline', convite: 'Invite card',
};
