// Outlet templates in the database: catalogue, writes and what the piece stores. The pure design lives in ./style.ts.
import type { Env } from '../env';
import { LAYOUTS_CONTENT, isLayoutContent, type LayoutContent } from './cards';
import { newId } from './db';
import { todayIso } from './lai';
import {
  BOXES_TITLE, MAX_STYLES, acceptedSponsorship, STYLE_NAME_MAX, WORDS_MAX, ROLES_COLOR, DEFAULT_PARAMS, SEQUENCE_MAX, TECHNIQUES, POST_TYPES, isComposition, chooseStyle, visualBrand, sameBrand,
  type Style, type PieceStyle, type ParamsStyle, type Sponsor, type AppliesTo,
} from './style';
import type { Brand, Lead } from './lead';
import { MOTIONS_REELS, STEPS_REELS, DEFAULT_PACE, type ReelsPace } from './reelsHtml';
import { DESKS } from './spans';

type Language = 'pt-BR' | 'en';
export type ValidStyle = { nome: string; valePara: AppliesTo; params: ParamsStyle; padrao: boolean };

interface Line { id: string; nome: string; vale_para_json: string; params_json: string; versao: number; padrao: number }
const toStyle = (l: Line): Style => ({
  id: l.id, nome: l.nome, valePara: JSON.parse(l.vale_para_json), params: { ...DEFAULT_PARAMS, ...JSON.parse(l.params_json) }, versao: l.versao, padrao: !!l.padrao,
});

/** Catalogue only: no hex, font or free text goes into the card. */
export function validateStyle(body: unknown, language: Language = 'pt-BR'): ValidStyle | { erro: string } {
  const tr = (pt: string, en: string) => (language === 'en' ? en : pt);
  const c = (body ?? {}) as Record<string, unknown>;
  const name = typeof c.nome === 'string' ? c.nome.replace(/\s+/g, ' ').trim() : '';
  if (!name || name.length > STYLE_NAME_MAX) return { erro: tr(`nome: de 1 a ${STYLE_NAME_MAX} caracteres`, `name: 1 to ${STYLE_NAME_MAX} characters`) };
  const p = (c.params ?? {}) as Record<string, unknown>;
  const composition = p.composicao ?? DEFAULT_PARAMS.composicao;
  if (!isComposition(composition)) return { erro: tr('composição inválida', 'invalid composition') };
  const boxTitle = p.caixaTitulo ?? DEFAULT_PARAMS.caixaTitulo;
  if (!BOXES_TITLE.includes(boxTitle as never)) return { erro: tr('caixa do título inválida', 'invalid headline case') };
  const colorsRole = p.papelCores ?? DEFAULT_PARAMS.papelCores;
  if (!ROLES_COLOR.includes(colorsRole as never)) return { erro: tr('papel das cores inválido', 'invalid color role') };
  const sequence = p.sequencia ?? [];
  if (!Array.isArray(sequence) || sequence.length > SEQUENCE_MAX || !sequence.every(isLayoutContent)) {
    return { erro: tr(`sequência: até ${SEQUENCE_MAX} de ${LAYOUTS_CONTENT.join(', ')}`, `sequence: up to ${SEQUENCE_MAX} of ${LAYOUTS_CONTENT.join(', ')}`) };
  }
  const sponsorship = p.patrocinio ?? null;
  if (sponsorship !== null && typeof sponsorship !== 'string') return { erro: tr('patrocinador inválido', 'invalid sponsor') };
  const reels = (p.reels ?? {}) as Record<string, unknown>;
  const step = reels.passo ?? DEFAULT_PACE.passo;
  if (!STEPS_REELS.includes(step as never)) return { erro: tr('passo do Reels inválido', 'invalid Reel pace') };
  const motion = reels.movimento ?? DEFAULT_PACE.movimento;
  if (!MOTIONS_REELS.includes(motion as never)) return { erro: tr('movimento do Reels inválido', 'invalid Reel motion') };
  const technique = p.tecnica ?? DEFAULT_PARAMS.tecnica;
  if (!TECHNIQUES.includes(technique as never)) return { erro: tr('técnica inválida', 'invalid technique') };
  const v = (c.valePara ?? {}) as Record<string, unknown>;
  const list = (x: unknown) => (x === undefined ? [] : Array.isArray(x) && x.every((i) => typeof i === 'string') ? x as string[] : null);
  const desks = list(v.editorias);
  if (!desks || !desks.every((e) => (DESKS as readonly string[]).includes(e))) return { erro: tr('editoria inválida', 'invalid section') };
  const postTypes = list(v.tiposPost);
  if (!postTypes || !postTypes.every((e) => (POST_TYPES as readonly string[]).includes(e))) return { erro: tr('tipo de post inválido', 'invalid post type') };
  const raw = list(v.palavras);
  const words = raw ? [...new Set(raw.map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean))] : null;
  if (!words || words.length > WORDS_MAX || words.some((x) => x.length > 30)) return { erro: tr(`palavras: até ${WORDS_MAX}, cada uma com até 30 caracteres`, `words: up to ${WORDS_MAX}, each up to 30 characters`) };
  return {
    nome: name, padrao: c.padrao === true, valePara: { editorias: desks, tiposPost: postTypes, palavras: words },
    params: { composicao: composition, tecnica: technique as ParamsStyle['tecnica'], caixaTitulo: boxTitle as ParamsStyle['caixaTitulo'], papelCores: colorsRole as ParamsStyle['papelCores'], sequencia: sequence as LayoutContent[], reels: { passo: step as ReelsPace['passo'], movimento: motion as ReelsPace['movimento'] }, patrocinio: sponsorship },
  };
}

export async function listStyles(env: Env, tenantId: string): Promise<Style[]> {
  const { results } = await env.DB.prepare('SELECT id, nome, vale_para_json, params_json, versao, padrao FROM estilos WHERE tenant_id = ? AND arquivado_em IS NULL ORDER BY created_at, rowid')
    .bind(tenantId).all<Line>();
  return results.map(toStyle);
}

const REPEATED_NAME = (language: Language) => (language === 'en' ? 'A template with this name already exists' : 'Já existe um modelo com esse nome');
const defaultRemove = (env: Env, tenantId: string, id: string) => env.DB.prepare('UPDATE estilos SET padrao = 0 WHERE tenant_id = ? AND id <> ? AND padrao = 1').bind(tenantId, id);

export async function createStyle(env: Env, tenantId: string, v: ValidStyle, actor: string, language: Language = 'pt-BR'): Promise<{ id: string } | { erro: string }> {
  const active = await env.DB.prepare('SELECT COUNT(*) AS n FROM estilos WHERE tenant_id = ? AND arquivado_em IS NULL').bind(tenantId).first<{ n: number }>();
  if ((active?.n ?? 0) >= MAX_STYLES) return { erro: language === 'en' ? `Up to ${MAX_STYLES} templates per outlet. Archive one first.` : `Até ${MAX_STYLES} modelos por veículo. Arquive um antes.` };
  const id = newId();
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO estilos (id, tenant_id, nome, vale_para_json, params_json, padrao, por) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(id, tenantId, v.nome, JSON.stringify(v.valePara), JSON.stringify(v.params), v.padrao ? 1 : 0, actor),
      ...(v.padrao ? [defaultRemove(env, tenantId, id)] : []),
    ]);
  } catch (e) {
    if (String(e).includes('UNIQUE')) return { erro: REPEATED_NAME(language) };
    throw e;
  }
  return { id };
}

/**
 * Copies a template to another outlet: only name, `vale_para` and `params`, with a new id and no link back. The sponsor
 * belongs to the source outlet and stays behind. The caller checks the role in both outlets.
 */
export async function copyStyle(env: Env, sourceTenantId: string, styleId: string, target: string, actor: string, language: Language = 'pt-BR') {
  const e = await env.DB.prepare('SELECT nome, vale_para_json, params_json FROM estilos WHERE id = ? AND tenant_id = ? AND arquivado_em IS NULL')
    .bind(styleId, sourceTenantId).first<{ nome: string; vale_para_json: string; params_json: string }>();
  if (!e) return null;
  const { patrocinio: _, ...params } = JSON.parse(e.params_json) as ParamsStyle;
  const v = validateStyle({ nome: e.nome, valePara: JSON.parse(e.vale_para_json), params, padrao: false }, language);
  return 'erro' in v ? v : createStyle(env, target, v, actor, language);
}

/** The version goes up on each edit: that is what lights "Template changed. Apply" on a piece under review. */
export async function updateStyle(env: Env, tenantId: string, id: string, v: ValidStyle, language: Language = 'pt-BR'): Promise<{ id: string } | { erro: string } | null> {
  try {
    const [r] = await env.DB.batch([
      env.DB.prepare(`UPDATE estilos SET nome = ?, vale_para_json = ?, params_json = ?, padrao = ?, versao = versao + 1, updated_at = datetime('now')
                       WHERE id = ? AND tenant_id = ? AND arquivado_em IS NULL`)
        .bind(v.nome, JSON.stringify(v.valePara), JSON.stringify(v.params), v.padrao ? 1 : 0, id, tenantId),
      env.DB.prepare(`UPDATE estilos SET padrao = 0 WHERE tenant_id = ? AND id <> ? AND padrao = 1
                        AND EXISTS (SELECT 1 FROM estilos WHERE id = ? AND tenant_id = ? AND padrao = 1 AND arquivado_em IS NULL)`).bind(tenantId, id, id, tenantId),
    ]);
    return r.meta.changes ? { id } : null;
  } catch (e) {
    if (String(e).includes('UNIQUE')) return { erro: REPEATED_NAME(language) };
    throw e;
  }
}

export async function archiveStyle(env: Env, tenantId: string, id: string) {
  const r = await env.DB.prepare(`UPDATE estilos SET arquivado_em = datetime('now'), padrao = 0, updated_at = datetime('now') WHERE id = ? AND tenant_id = ? AND arquivado_em IS NULL`).bind(id, tenantId).run();
  return r.meta.changes > 0;
}

/** What the piece stores: the template and the brand's current visual part. */
export const freeze = (e: Pick<Style, 'id' | 'versao' | 'params'>, brand: Brand): PieceStyle => ({ id: e.id, versao: e.versao, params: e.params, marcaVisual: visualBrand(brand) });

/** The sponsor the piece can carry now: within its period, not archived, and only on a lead that accepts a strip. */
async function sponsorPiece(env: Env, tenantId: string, id: string | null | undefined, lead: Lead, now: Date): Promise<Sponsor | null> {
  if (!id || !acceptedSponsorship(lead)) return null;
  const day = todayIso(now);
  const p = await env.DB.prepare('SELECT nome, logo_r2 FROM patrocinios WHERE id = ? AND tenant_id = ? AND arquivado_em IS NULL AND inicio <= ? AND fim >= ?')
    .bind(id, tenantId, day, day).first<{ nome: string; logo_r2: string | null }>();
  return p ? { nome: p.nome, logoR2: p.logo_r2 } : null;
}

export async function freezeToPiece(env: Env, tenantId: string, e: Pick<Style, 'id' | 'versao' | 'params'>, lead: Lead, now = new Date()): Promise<PieceStyle> {
  const sponsor = await sponsorPiece(env, tenantId, e.params.patrocinio, lead, now);
  return { ...freeze(e, lead.marca), ...(sponsor ? { patrocinador: sponsor } : {}) };
}

/** A piece that already has a version keeps what it had, with or without a template. A new piece chooses by its lead. */
export async function fromPieceStyle(env: Env, tenantId: string, pieceId: string, lead: Lead): Promise<PieceStyle | null> {
  const previous = await env.DB.prepare('SELECT conteudo_json FROM peca_versoes WHERE peca_id = ? AND tenant_id = ? ORDER BY versao DESC LIMIT 1').bind(pieceId, tenantId).first<{ conteudo_json: string }>();
  if (previous) return (JSON.parse(previous.conteudo_json) as { estilo?: PieceStyle }).estilo ?? null;
  const e = chooseStyle(await listStyles(env, tenantId), lead);
  return e ? freezeToPiece(env, tenantId, e, lead) : null;
}

/** For Review: which template the piece uses and whether the template or the brand changed since. An archived template
 *  does not offer Apply. */
export async function fromStyleStatus(env: Env, tenantId: string, style?: PieceStyle) {
  if (!style) return { id: null, modeloMudou: false, marcaMudou: false };
  const l = await env.DB.prepare('SELECT e.versao, e.arquivado_em, t.marca_json FROM estilos e JOIN tenants t ON t.id = e.tenant_id WHERE e.id = ? AND e.tenant_id = ?')
    .bind(style.id, tenantId).first<{ versao: number; arquivado_em: string | null; marca_json: string | null }>();
  if (!l || l.arquivado_em) return { id: style.id, modeloMudou: false, marcaMudou: false };
  return { id: style.id, modeloMudou: l.versao !== style.versao, marcaMudou: !sameBrand(visualBrand(JSON.parse(l.marca_json ?? '{}')), style.marcaVisual) };
}

// Sponsors. The admin registers them on the Brand tab, and the model turns the strip on. Dates in YYYY-MM-DD, both ends count.
const SPONSORSHIP_NAME_MAX = 60;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (v: unknown): v is string => typeof v === 'string' && DATE.test(v) && !Number.isNaN(Date.parse(v));

export function validateSponsorship(body: unknown, language: Language = 'pt-BR'): { nome: string; inicio: string; fim: string } | { erro: string } {
  const tr = (pt: string, en: string) => (language === 'en' ? en : pt);
  const c = (body ?? {}) as Record<string, unknown>;
  const name = typeof c.nome === 'string' ? c.nome.replace(/\s+/g, ' ').trim() : '';
  if (!name || name.length > SPONSORSHIP_NAME_MAX) return { erro: tr(`nome: de 1 a ${SPONSORSHIP_NAME_MAX} caracteres`, `name: 1 to ${SPONSORSHIP_NAME_MAX} characters`) };
  if (!validDate(c.inicio) || !validDate(c.fim)) return { erro: tr('período: início e fim', 'period: start and end') };
  if (c.fim < c.inicio) return { erro: tr('o fim vem depois do início', 'the end comes after the start') };
  return { nome: name, inicio: c.inicio, fim: c.fim };
}

export async function listSponsorships(env: Env, tenantId: string) {
  const { results } = await env.DB.prepare('SELECT id, nome, logo_r2, inicio, fim FROM patrocinios WHERE tenant_id = ? AND arquivado_em IS NULL ORDER BY inicio, rowid')
    .bind(tenantId).all<{ id: string; nome: string; logo_r2: string | null; inicio: string; fim: string }>();
  return results.map((p) => ({ id: p.id, nome: p.nome, temLogo: !!p.logo_r2, inicio: p.inicio, fim: p.fim }));
}

/** A template only points to a sponsor of its own outlet. */
export async function sponsorshipOutlet(env: Env, tenantId: string, id: string) {
  return !!(await env.DB.prepare('SELECT 1 AS x FROM patrocinios WHERE id = ? AND tenant_id = ? AND arquivado_em IS NULL').bind(id, tenantId).first());
}
