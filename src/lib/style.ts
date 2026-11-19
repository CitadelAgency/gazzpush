// Print-shop compositions: four moulds over the card, no gradients, with text on flat colour. Pure. The CSS goes in
// through the template's `{{?ESTILO_CSS}}`: with `padrao` nothing goes in, and the HTML comes out byte for byte the
// same, with the same hash.
import { DEFAULT_PACE, type ReelsPace } from './reelsHtml';
import type { LayoutContent } from './cards';
import type { Brand } from './lead';

/** How the illustration is drawn. `referencia`: only the brand image decides, and the prompt names no technique. */
export const TECHNIQUES = ['xilogravura', 'reticula', 'nanquim', 'referencia'] as const;
export type Technique = (typeof TECHNIQUES)[number];
export const DEFAULT_TECHNIQUE: Technique = 'reticula';

export const COMPOSITIONS = ['padrao', 'tarja', 'coluna', 'cartaz', 'primeira-pagina'] as const;
export type Composition = (typeof COMPOSITIONS)[number];
export const isComposition = (v: unknown): v is Composition => COMPOSITIONS.includes(v as Composition);

/** The card's class. The same one the contrast QA uses: every card with it has its text on a flat colour. */
export const compositionClass = (c: Composition) => (c === 'padrao' ? '' : `comp-${c}`);

// Without an illustration, the accent's flat colour: the usual background is a gradient.
const WITHOUT_SHADOW = (c: string) => `.comp-${c} .shade { display: none; }
    .comp-${c} .art-flat { background: var(--accent); }`;
// Footer on a flat strip: the text stays where it always was.
const REMOVES_FOOT = (c: string) => `.comp-${c} footer { left: 0; right: 0; bottom: 0; height: 100px; padding: 0 68px 53px; align-items: flex-end; background: var(--bg); opacity: 1; }
    .r916 .comp-${c} footer { right: 0; bottom: 0; height: 400px; padding: 0 150px 300px 68px; }`;
const REMOVES_TOP = (c: string) => `.comp-${c} header { top: 0; left: 0; right: 0; min-height: 170px; padding: 0 68px; align-items: center; background: var(--bg); }
    .r916 .comp-${c} header { top: 0; min-height: 320px; padding: 200px 68px 0; }
    .r916 .comp-${c} .selo-publi { top: 336px; }`;
// 1 px of slack for QA (the text does not touch the footer); the unblurred shadow closes the seam between the two strips.
const BLOCK = (c: string) => `.comp-${c} .story { left: 0; right: 0; bottom: 101px; padding: 34px 68px 26px; background: var(--bg); box-shadow: 0 1px 0 var(--bg); }
    .r916 .comp-${c} .story { right: 0; bottom: 401px; padding-right: 150px; }`;

const CSS: Record<Exclude<Composition, 'padrao'>, string> = {
  tarja: [WITHOUT_SHADOW('tarja'), REMOVES_TOP('tarja'), REMOVES_FOOT('tarja'), BLOCK('tarja')].join('\n    '),
  coluna: [WITHOUT_SHADOW('coluna'), REMOVES_TOP('coluna'), REMOVES_FOOT('coluna'), BLOCK('coluna'),
    '.comp-coluna .art { height: 50%; }',
    '.comp-coluna .story { min-height: 574px; }',
    '.r916 .comp-coluna .story { min-height: 559px; }'].join('\n    '),
  cartaz: [WITHOUT_SHADOW('cartaz'),
    '.comp-cartaz footer { opacity: 1; }',
    '.comp-cartaz.cover h1 { font-size: 76px; line-height: 1.05; letter-spacing: -1px; }',
    '.comp-cartaz.detail h1, .comp-cartaz.list h1 { font-size: 56px; }'].join('\n    '),
  'primeira-pagina': [WITHOUT_SHADOW('primeira-pagina'), REMOVES_FOOT('primeira-pagina'),
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

/** The composition's CSS, to add to `{{?ESTILO_CSS}}`. */
export const cssComposition = (c: Composition) => (c === 'padrao' ? '' : `${CSS[c]}\n  `);

// Outlet templates. The brand says who speaks; the template, how the piece presents itself. A template stores no hex,
// font or text.
export const BOXES_TITLE = ['alta', 'normal'] as const;
export type BoxTitle = (typeof BOXES_TITLE)[number];
export const ROLES_COLOR = ['normal', 'invertido', 'acento'] as const;
export type ColorsRole = (typeof ROLES_COLOR)[number];
/** The post types that have their own template. Job, Event and Breaking come from words in the title and summary. */
export const POST_TYPES = ['publicidade', 'atualizacao', 'errata', 'resumo'] as const;
export const MAX_STYLES = 6;
export const SEQUENCE_MAX = 6;
export const WORDS_MAX = 8;
export const STYLE_NAME_MAX = 40;

export interface ParamsStyle {
  composicao: Composition;
  caixaTitulo: BoxTitle;
  papelCores: ColorsRole;
  /** Suggested to the drafter: it still picks the layout that suits the content. */
  sequencia: LayoutContent[];
  /** The outlet's sponsor that goes into the art. Expired or archived ones do not appear. */
  patrocinio?: string | null;
  /** Reels pace and motion: they prefill the screen, which can change them for that Reels. */
  reels: ReelsPace;
  tecnica: Technique;
}
export interface AppliesTo { editorias: string[]; tiposPost: string[]; palavras: string[] }
export interface Style { id: string; nome: string; valePara: AppliesTo; params: ParamsStyle; versao: number; padrao: boolean }

/** What the piece freezes from the brand: changing the brand later does not change a piece already born with a template. */
export type VisualBrand = Pick<Brand, 'cores' | 'fontes' | 'logoR2' | 'marcaDagua' | 'assinatura'>;
const FIELDS_VISUAL = ['cores', 'fontes', 'logoR2', 'marcaDagua', 'assinatura'] as const;
/** Stored in `conteudo_json`. */
export interface PieceStyle { id: string; versao: number; params: ParamsStyle; marcaVisual: VisualBrand; patrocinador?: Sponsor }
export interface Sponsor { nome: string; logoR2: string | null }

/** Desks where a sponsorship strip never goes: crime and tragedy. */
export const DESKS_WITHOUT_SPONSORSHIP = ['policia'];
/** Advertising, corrections and errata get no strip, and neither does the author outlet. */
export const acceptedSponsorship = (p: { editoria?: string | null; tipoPost?: string | null; modo?: string | null }) =>
  (!p.tipoPost || p.tipoPost === 'resumo') && p.modo !== 'autoral' && !DESKS_WITHOUT_SPONSORSHIP.includes(p.editoria ?? '');

export const DEFAULT_PARAMS: ParamsStyle = { composicao: 'padrao', caixaTitulo: 'alta', papelCores: 'normal', sequencia: [], reels: DEFAULT_PACE, tecnica: DEFAULT_TECHNIQUE };

export function visualBrand(brand: Brand): VisualBrand {
  const v: Record<string, unknown> = {};
  for (const k of FIELDS_VISUAL) if (brand[k] !== undefined) v[k] = brand[k];
  return v as VisualBrand;
}

/** The current brand with the visual part of the copy: a field the copy lacks is dropped, so a new logo stays out of old pieces. */
export function withCopyBrand(brand: Brand, copy: VisualBrand): Brand {
  const m: Brand = { ...brand };
  for (const k of FIELDS_VISUAL) delete m[k];
  return { ...m, ...copy };
}

/** Stable comparison (key order in the database JSON does not count). */
const canonical = (v: unknown): string => (v && typeof v === 'object'
  ? `{${Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => `${k}:${canonical(x)}`).join(',')}}`
  : JSON.stringify(v));
export const sameBrand = (a: VisualBrand, b: VisualBrand) => canonical(a) === canonical(b);

export const fromRoleColors = (c: { fundo: string; texto: string; acento: string }, role: ColorsRole) =>
  role === 'invertido' ? { fundo: c.texto, texto: c.fundo, acento: c.acento }
    : role === 'acento' ? { fundo: c.acento, texto: c.fundo, acento: c.fundo } : c;

const withoutAccent = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const hasWord = (text: string, word: string) => {
  const p = withoutAccent(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${p}($|[^\\p{L}\\p{N}])`, 'u').test(text);
};

/** Order: post type, words, desk, outlet default. With none: `null`, today's look. */
export function chooseStyle<T extends Pick<Style, 'valePara' | 'padrao'>>(styles: T[], lead: { tipoPost?: string | null; titulo: string; resumo?: string | null; editoria?: string | null }): T | null {
  const text = withoutAccent(`${lead.titulo} ${lead.resumo ?? ''}`);
  return styles.find((e) => lead.tipoPost && e.valePara.tiposPost.includes(lead.tipoPost))
    ?? styles.find((e) => e.valePara.palavras.some((p) => hasWord(text, p)))
    ?? styles.find((e) => lead.editoria && e.valePara.editorias.includes(lead.editoria))
    ?? styles.find((e) => e.padrao)
    ?? null;
}
