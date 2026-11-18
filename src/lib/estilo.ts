// Composições de gráfica: quatro moldes sobre o card, sem gradiente, com texto sobre cor chapada. Puro. O CSS entra pelo
// `{{?ESTILO_CSS}}` do template: em `padrao` não entra nada, e o HTML sai byte a byte igual, com o mesmo hash.
import { RITMO_PADRAO, type RitmoReels } from './reelsHtml';
import type { LayoutConteudo } from './cards';
import type { Marca } from './pauta';

/** Como a ilustração é desenhada. `referencia`: só a imagem da marca manda, e o prompt não diz técnica nenhuma. */
export const TECNICAS = ['xilogravura', 'reticula', 'nanquim', 'referencia'] as const;
export type Tecnica = (typeof TECNICAS)[number];
export const TECNICA_PADRAO: Tecnica = 'reticula';

export const COMPOSICOES = ['padrao', 'tarja', 'coluna', 'cartaz', 'primeira-pagina'] as const;
export type Composicao = (typeof COMPOSICOES)[number];
export const ehComposicao = (v: unknown): v is Composicao => COMPOSICOES.includes(v as Composicao);

/** A classe do card. A mesma do QA de contraste: todo card com ela tem o texto sobre cor chapada. */
export const classeComposicao = (c: Composicao) => (c === 'padrao' ? '' : `comp-${c}`);

// Sem ilustração, a cor chapada do acento: o fundo de sempre é um gradiente.
const SEM_SOMBRA = (c: string) => `.comp-${c} .shade { display: none; }
    .comp-${c} .art-flat { background: var(--accent); }`;
// Rodapé em tira chapada: o texto fica onde sempre esteve.
const TIRA_PE = (c: string) => `.comp-${c} footer { left: 0; right: 0; bottom: 0; height: 100px; padding: 0 68px 53px; align-items: flex-end; background: var(--bg); opacity: 1; }
    .r916 .comp-${c} footer { right: 0; bottom: 0; height: 400px; padding: 0 150px 300px 68px; }`;
const TIRA_TOPO = (c: string) => `.comp-${c} header { top: 0; left: 0; right: 0; min-height: 170px; padding: 0 68px; align-items: center; background: var(--bg); }
    .r916 .comp-${c} header { top: 0; min-height: 320px; padding: 200px 68px 0; }
    .r916 .comp-${c} .selo-publi { top: 336px; }`;
// 1 px de folga para o QA (o texto não encosta no rodapé); a sombra sem desfoque fecha a emenda das duas tiras.
const BLOCO = (c: string) => `.comp-${c} .story { left: 0; right: 0; bottom: 101px; padding: 34px 68px 26px; background: var(--bg); box-shadow: 0 1px 0 var(--bg); }
    .r916 .comp-${c} .story { right: 0; bottom: 401px; padding-right: 150px; }`;

const CSS: Record<Exclude<Composicao, 'padrao'>, string> = {
  tarja: [SEM_SOMBRA('tarja'), TIRA_TOPO('tarja'), TIRA_PE('tarja'), BLOCO('tarja')].join('\n    '),
  coluna: [SEM_SOMBRA('coluna'), TIRA_TOPO('coluna'), TIRA_PE('coluna'), BLOCO('coluna'),
    '.comp-coluna .art { height: 50%; }',
    '.comp-coluna .story { min-height: 574px; }',
    '.r916 .comp-coluna .story { min-height: 559px; }'].join('\n    '),
  cartaz: [SEM_SOMBRA('cartaz'),
    '.comp-cartaz footer { opacity: 1; }',
    '.comp-cartaz.cover h1 { font-size: 76px; line-height: 1.05; letter-spacing: -1px; }',
    '.comp-cartaz.detail h1, .comp-cartaz.list h1 { font-size: 56px; }'].join('\n    '),
  'primeira-pagina': [SEM_SOMBRA('primeira-pagina'), TIRA_PE('primeira-pagina'),
    '.comp-primeira-pagina header { top: 52px; flex-direction: column; align-items: center; gap: 8px; padding-bottom: 14px; border-bottom: 8px double var(--ink); }',
    '.r916 .comp-primeira-pagina header { top: 190px; }',
    '.comp-primeira-pagina .brand { line-height: 1; }',
    '.comp-primeira-pagina .brand-name { font-size: 62px; letter-spacing: -1px; }',
    '.comp-primeira-pagina .archive { text-align: center; font-size: 22px; }',
    '.comp-primeira-pagina .archive strong { display: inline; margin-right: 12px; font-size: 20px; }',
    '.comp-primeira-pagina .selo-publi { top: 212px; }',
    '.r916 .comp-primeira-pagina .selo-publi { top: 350px; }',
    '.comp-primeira-pagina .story { top: 286px; left: 0; right: 0; bottom: auto; padding: 0 68px 22px; background: var(--bg); }',
    '.r916 .comp-primeira-pagina .story { top: 424px; right: 0; bottom: auto; padding-right: 150px; }',
    '.comp-primeira-pagina .art { top: auto; bottom: 100px; height: 42%; }',
    '.r916 .comp-primeira-pagina .art { bottom: 400px; height: 34%; }',
    '.comp-primeira-pagina .marca-dagua.canto { top: auto; bottom: 120px; }',
    '.r916 .comp-primeira-pagina .marca-dagua.canto { top: auto; bottom: 420px; }'].join('\n    '),
};

/** CSS da composição, para somar ao `{{?ESTILO_CSS}}`. */
export const cssComposicao = (c: Composicao) => (c === 'padrao' ? '' : `${CSS[c]}\n  `);

// Modelos do veículo. A marca diz quem fala; o modelo, como a peça se apresenta. Modelo não guarda hex, fonte nem texto.
export const CAIXAS_TITULO = ['alta', 'normal'] as const;
export type CaixaTitulo = (typeof CAIXAS_TITULO)[number];
export const PAPEIS_COR = ['normal', 'invertido', 'acento'] as const;
export type PapelCores = (typeof PAPEIS_COR)[number];
/** Os tipos de post que têm modelo próprio. Vaga, Evento e Urgente saem de palavras no título e no resumo. */
export const TIPOS_POST = ['publicidade', 'atualizacao', 'errata', 'resumo'] as const;
export const MAX_ESTILOS = 6;
export const SEQUENCIA_MAX = 6;
export const PALAVRAS_MAX = 8;
export const NOME_ESTILO_MAX = 40;

export interface ParamsEstilo {
  composicao: Composicao;
  caixaTitulo: CaixaTitulo;
  papelCores: PapelCores;
  /** Sugerida ao redator: ele continua escolhendo o layout que serve ao conteúdo. */
  sequencia: LayoutConteudo[];
  /** Patrocinador do veículo que entra na arte. Vencido ou arquivado não aparece. */
  patrocinio?: string | null;
  /** Passo e movimento do Reels: preenchem a tela, que pode mudar para aquele Reels. */
  reels: RitmoReels;
  tecnica: Tecnica;
}
export interface ValePara { editorias: string[]; tiposPost: string[]; palavras: string[] }
export interface Estilo { id: string; nome: string; valePara: ValePara; params: ParamsEstilo; versao: number; padrao: boolean }

/** O que a peça congela da marca: mudar a marca depois não muda peça que já nasceu com modelo. */
export type MarcaVisual = Pick<Marca, 'cores' | 'fontes' | 'logoR2' | 'marcaDagua' | 'assinatura'>;
const CAMPOS_VISUAIS = ['cores', 'fontes', 'logoR2', 'marcaDagua', 'assinatura'] as const;
/** Gravado em `conteudo_json`. */
export interface EstiloPeca { id: string; versao: number; params: ParamsEstilo; marcaVisual: MarcaVisual; patrocinador?: Patrocinador }
export interface Patrocinador { nome: string; logoR2: string | null }

/** Editoria em que faixa de patrocínio não entra: crime e tragédia. */
export const EDITORIAS_SEM_PATROCINIO = ['policia'];
/** Publicidade, correção e errata ficam sem faixa, e o veículo autoral também. */
export const aceitaPatrocinio = (p: { editoria?: string | null; tipoPost?: string | null; modo?: string | null }) =>
  (!p.tipoPost || p.tipoPost === 'resumo') && p.modo !== 'autoral' && !EDITORIAS_SEM_PATROCINIO.includes(p.editoria ?? '');

export const PARAMS_PADRAO: ParamsEstilo = { composicao: 'padrao', caixaTitulo: 'alta', papelCores: 'normal', sequencia: [], reels: RITMO_PADRAO, tecnica: TECNICA_PADRAO };

export function marcaVisualDe(marca: Marca): MarcaVisual {
  const v: Record<string, unknown> = {};
  for (const k of CAMPOS_VISUAIS) if (marca[k] !== undefined) v[k] = marca[k];
  return v as MarcaVisual;
}

/** A marca atual com a parte visual da cópia: campo que a cópia não tem sai, para o logo novo não entrar em peça antiga. */
export function marcaComCopia(marca: Marca, copia: MarcaVisual): Marca {
  const m: Marca = { ...marca };
  for (const k of CAMPOS_VISUAIS) delete m[k];
  return { ...m, ...copia };
}

/** Comparação estável (a ordem das chaves no JSON do banco não conta). */
const canonico = (v: unknown): string => (v && typeof v === 'object'
  ? `{${Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => `${k}:${canonico(x)}`).join(',')}}`
  : JSON.stringify(v));
export const mesmaMarca = (a: MarcaVisual, b: MarcaVisual) => canonico(a) === canonico(b);

export const coresDoPapel = (c: { fundo: string; texto: string; acento: string }, papel: PapelCores) =>
  papel === 'invertido' ? { fundo: c.texto, texto: c.fundo, acento: c.acento }
    : papel === 'acento' ? { fundo: c.acento, texto: c.fundo, acento: c.fundo } : c;

const semAcento = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const temPalavra = (texto: string, palavra: string) => {
  const p = semAcento(palavra).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${p}($|[^\\p{L}\\p{N}])`, 'u').test(texto);
};

/** Ordem: tipo de post, palavras, editoria, padrão do veículo. Sem nenhum: `null`, o visual de hoje. */
export function escolherEstilo<T extends Pick<Estilo, 'valePara' | 'padrao'>>(estilos: T[], pauta: { tipoPost?: string | null; titulo: string; resumo?: string | null; editoria?: string | null }): T | null {
  const texto = semAcento(`${pauta.titulo} ${pauta.resumo ?? ''}`);
  return estilos.find((e) => pauta.tipoPost && e.valePara.tiposPost.includes(pauta.tipoPost))
    ?? estilos.find((e) => e.valePara.palavras.some((p) => temPalavra(texto, p)))
    ?? estilos.find((e) => pauta.editoria && e.valePara.editorias.includes(pauta.editoria))
    ?? estilos.find((e) => e.padrao)
    ?? null;
}
