// Modelos do veículo no banco: catálogo, escrita e o que a peça grava. O desenho puro fica em ./estilo.ts.
import type { Env } from '../env';
import { LAYOUTS_DE_CONTEUDO, ehLayoutDeConteudo, type LayoutConteudo } from './cards';
import { novoId } from './db';
import { hojeISO } from './lai';
import {
  CAIXAS_TITULO, MAX_ESTILOS, aceitaPatrocinio, NOME_ESTILO_MAX, PALAVRAS_MAX, PAPEIS_COR, PARAMS_PADRAO, SEQUENCIA_MAX, TECNICAS, TIPOS_POST, ehComposicao, escolherEstilo, marcaVisualDe, mesmaMarca,
  type Estilo, type EstiloPeca, type ParamsEstilo, type Patrocinador, type ValePara,
} from './estilo';
import type { Marca, Pauta } from './pauta';
import { MOVIMENTOS_REELS, PASSOS_REELS, RITMO_PADRAO, type RitmoReels } from './reelsHtml';
import { EDITORIAS } from './spans';

type Idioma = 'pt-BR' | 'en';
export type EstiloValido = { nome: string; valePara: ValePara; params: ParamsEstilo; padrao: boolean };

interface Linha { id: string; nome: string; vale_para_json: string; params_json: string; versao: number; padrao: number }
const paraEstilo = (l: Linha): Estilo => ({
  id: l.id, nome: l.nome, valePara: JSON.parse(l.vale_para_json), params: { ...PARAMS_PADRAO, ...JSON.parse(l.params_json) }, versao: l.versao, padrao: !!l.padrao,
});

/** Só catálogo: nenhum hex, fonte ou texto livre vai para o card. */
export function validarEstilo(corpo: unknown, idioma: Idioma = 'pt-BR'): EstiloValido | { erro: string } {
  const tr = (pt: string, en: string) => (idioma === 'en' ? en : pt);
  const c = (corpo ?? {}) as Record<string, unknown>;
  const nome = typeof c.nome === 'string' ? c.nome.replace(/\s+/g, ' ').trim() : '';
  if (!nome || nome.length > NOME_ESTILO_MAX) return { erro: tr(`nome: de 1 a ${NOME_ESTILO_MAX} caracteres`, `name: 1 to ${NOME_ESTILO_MAX} characters`) };
  const p = (c.params ?? {}) as Record<string, unknown>;
  const composicao = p.composicao ?? PARAMS_PADRAO.composicao;
  if (!ehComposicao(composicao)) return { erro: tr('composição inválida', 'invalid composition') };
  const caixaTitulo = p.caixaTitulo ?? PARAMS_PADRAO.caixaTitulo;
  if (!CAIXAS_TITULO.includes(caixaTitulo as never)) return { erro: tr('caixa do título inválida', 'invalid headline case') };
  const papelCores = p.papelCores ?? PARAMS_PADRAO.papelCores;
  if (!PAPEIS_COR.includes(papelCores as never)) return { erro: tr('papel das cores inválido', 'invalid color role') };
  const sequencia = p.sequencia ?? [];
  if (!Array.isArray(sequencia) || sequencia.length > SEQUENCIA_MAX || !sequencia.every(ehLayoutDeConteudo)) {
    return { erro: tr(`sequência: até ${SEQUENCIA_MAX} de ${LAYOUTS_DE_CONTEUDO.join(', ')}`, `sequence: up to ${SEQUENCIA_MAX} of ${LAYOUTS_DE_CONTEUDO.join(', ')}`) };
  }
  const patrocinio = p.patrocinio ?? null;
  if (patrocinio !== null && typeof patrocinio !== 'string') return { erro: tr('patrocinador inválido', 'invalid sponsor') };
  const reels = (p.reels ?? {}) as Record<string, unknown>;
  const passo = reels.passo ?? RITMO_PADRAO.passo;
  if (!PASSOS_REELS.includes(passo as never)) return { erro: tr('passo do Reels inválido', 'invalid Reel pace') };
  const movimento = reels.movimento ?? RITMO_PADRAO.movimento;
  if (!MOVIMENTOS_REELS.includes(movimento as never)) return { erro: tr('movimento do Reels inválido', 'invalid Reel motion') };
  const tecnica = p.tecnica ?? PARAMS_PADRAO.tecnica;
  if (!TECNICAS.includes(tecnica as never)) return { erro: tr('técnica inválida', 'invalid technique') };
  const v = (c.valePara ?? {}) as Record<string, unknown>;
  const lista = (x: unknown) => (x === undefined ? [] : Array.isArray(x) && x.every((i) => typeof i === 'string') ? x as string[] : null);
  const editorias = lista(v.editorias);
  if (!editorias || !editorias.every((e) => (EDITORIAS as readonly string[]).includes(e))) return { erro: tr('editoria inválida', 'invalid section') };
  const tiposPost = lista(v.tiposPost);
  if (!tiposPost || !tiposPost.every((e) => (TIPOS_POST as readonly string[]).includes(e))) return { erro: tr('tipo de post inválido', 'invalid post type') };
  const brutas = lista(v.palavras);
  const palavras = brutas ? [...new Set(brutas.map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean))] : null;
  if (!palavras || palavras.length > PALAVRAS_MAX || palavras.some((x) => x.length > 30)) return { erro: tr(`palavras: até ${PALAVRAS_MAX}, cada uma com até 30 caracteres`, `words: up to ${PALAVRAS_MAX}, each up to 30 characters`) };
  return {
    nome, padrao: c.padrao === true, valePara: { editorias, tiposPost, palavras },
    params: { composicao, tecnica: tecnica as ParamsEstilo['tecnica'], caixaTitulo: caixaTitulo as ParamsEstilo['caixaTitulo'], papelCores: papelCores as ParamsEstilo['papelCores'], sequencia: sequencia as LayoutConteudo[], reels: { passo: passo as RitmoReels['passo'], movimento: movimento as RitmoReels['movimento'] }, patrocinio },
  };
}

export async function listarEstilos(env: Env, tenantId: string): Promise<Estilo[]> {
  const { results } = await env.DB.prepare('SELECT id, nome, vale_para_json, params_json, versao, padrao FROM estilos WHERE tenant_id = ? AND arquivado_em IS NULL ORDER BY created_at, rowid')
    .bind(tenantId).all<Linha>();
  return results.map(paraEstilo);
}

const NOME_REPETIDO = (idioma: Idioma) => (idioma === 'en' ? 'A template with this name already exists' : 'Já existe um modelo com esse nome');
const tirarPadrao = (env: Env, tenantId: string, id: string) => env.DB.prepare('UPDATE estilos SET padrao = 0 WHERE tenant_id = ? AND id <> ? AND padrao = 1').bind(tenantId, id);

export async function criarEstilo(env: Env, tenantId: string, v: EstiloValido, por: string, idioma: Idioma = 'pt-BR'): Promise<{ id: string } | { erro: string }> {
  const ativos = await env.DB.prepare('SELECT COUNT(*) AS n FROM estilos WHERE tenant_id = ? AND arquivado_em IS NULL').bind(tenantId).first<{ n: number }>();
  if ((ativos?.n ?? 0) >= MAX_ESTILOS) return { erro: idioma === 'en' ? `Up to ${MAX_ESTILOS} templates per outlet. Archive one first.` : `Até ${MAX_ESTILOS} modelos por veículo. Arquive um antes.` };
  const id = novoId();
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO estilos (id, tenant_id, nome, vale_para_json, params_json, padrao, por) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(id, tenantId, v.nome, JSON.stringify(v.valePara), JSON.stringify(v.params), v.padrao ? 1 : 0, por),
      ...(v.padrao ? [tirarPadrao(env, tenantId, id)] : []),
    ]);
  } catch (e) {
    if (String(e).includes('UNIQUE')) return { erro: NOME_REPETIDO(idioma) };
    throw e;
  }
  return { id };
}

/**
 * Copia um modelo para outro veículo: só nome, `vale_para` e `params`, com id novo e sem vínculo. O patrocinador é do veículo de
 * origem e fica para trás. Quem chama confere o papel nos dois veículos.
 */
export async function copiarEstilo(env: Env, origem: string, estiloId: string, destino: string, por: string, idioma: Idioma = 'pt-BR') {
  const e = await env.DB.prepare('SELECT nome, vale_para_json, params_json FROM estilos WHERE id = ? AND tenant_id = ? AND arquivado_em IS NULL')
    .bind(estiloId, origem).first<{ nome: string; vale_para_json: string; params_json: string }>();
  if (!e) return null;
  const { patrocinio: _, ...params } = JSON.parse(e.params_json) as ParamsEstilo;
  const v = validarEstilo({ nome: e.nome, valePara: JSON.parse(e.vale_para_json), params, padrao: false }, idioma);
  return 'erro' in v ? v : criarEstilo(env, destino, v, por, idioma);
}

/** Versão sobe a cada edição: é o que acende "Modelo mudou. Aplicar" na peça em revisão. */
export async function atualizarEstilo(env: Env, tenantId: string, id: string, v: EstiloValido, idioma: Idioma = 'pt-BR'): Promise<{ id: string } | { erro: string } | null> {
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
    if (String(e).includes('UNIQUE')) return { erro: NOME_REPETIDO(idioma) };
    throw e;
  }
}

export async function arquivarEstilo(env: Env, tenantId: string, id: string) {
  const r = await env.DB.prepare(`UPDATE estilos SET arquivado_em = datetime('now'), padrao = 0, updated_at = datetime('now') WHERE id = ? AND tenant_id = ? AND arquivado_em IS NULL`).bind(id, tenantId).run();
  return r.meta.changes > 0;
}

/** O que a peça grava: o modelo e a parte visual da marca de agora. */
export const congelar = (e: Pick<Estilo, 'id' | 'versao' | 'params'>, marca: Marca): EstiloPeca => ({ id: e.id, versao: e.versao, params: e.params, marcaVisual: marcaVisualDe(marca) });

/** O patrocinador que a peça pode levar agora: no período, não arquivado, e só em pauta que aceita faixa. */
async function patrocinadorDaPeca(env: Env, tenantId: string, id: string | null | undefined, pauta: Pauta, agora: Date): Promise<Patrocinador | null> {
  if (!id || !aceitaPatrocinio(pauta)) return null;
  const dia = hojeISO(agora);
  const p = await env.DB.prepare('SELECT nome, logo_r2 FROM patrocinios WHERE id = ? AND tenant_id = ? AND arquivado_em IS NULL AND inicio <= ? AND fim >= ?')
    .bind(id, tenantId, dia, dia).first<{ nome: string; logo_r2: string | null }>();
  return p ? { nome: p.nome, logoR2: p.logo_r2 } : null;
}

export async function congelarParaPeca(env: Env, tenantId: string, e: Pick<Estilo, 'id' | 'versao' | 'params'>, pauta: Pauta, agora = new Date()): Promise<EstiloPeca> {
  const patrocinador = await patrocinadorDaPeca(env, tenantId, e.params.patrocinio, pauta, agora);
  return { ...congelar(e, pauta.marca), ...(patrocinador ? { patrocinador } : {}) };
}

/** Peça que já tem versão fica com o que tinha, com ou sem modelo. Peça nova escolhe pela pauta. */
export async function estiloDaPeca(env: Env, tenantId: string, pecaId: string, pauta: Pauta): Promise<EstiloPeca | null> {
  const anterior = await env.DB.prepare('SELECT conteudo_json FROM peca_versoes WHERE peca_id = ? AND tenant_id = ? ORDER BY versao DESC LIMIT 1').bind(pecaId, tenantId).first<{ conteudo_json: string }>();
  if (anterior) return (JSON.parse(anterior.conteudo_json) as { estilo?: EstiloPeca }).estilo ?? null;
  const e = escolherEstilo(await listarEstilos(env, tenantId), pauta);
  return e ? congelarParaPeca(env, tenantId, e, pauta) : null;
}

/** Para a Revisão: qual modelo a peça usa e se o modelo ou a marca mudaram depois. Modelo arquivado não oferece Aplicar. */
export async function situacaoDoEstilo(env: Env, tenantId: string, estilo?: EstiloPeca) {
  if (!estilo) return { id: null, modeloMudou: false, marcaMudou: false };
  const l = await env.DB.prepare('SELECT e.versao, e.arquivado_em, t.marca_json FROM estilos e JOIN tenants t ON t.id = e.tenant_id WHERE e.id = ? AND e.tenant_id = ?')
    .bind(estilo.id, tenantId).first<{ versao: number; arquivado_em: string | null; marca_json: string | null }>();
  if (!l || l.arquivado_em) return { id: estilo.id, modeloMudou: false, marcaMudou: false };
  return { id: estilo.id, modeloMudou: l.versao !== estilo.versao, marcaMudou: !mesmaMarca(marcaVisualDe(JSON.parse(l.marca_json ?? '{}')), estilo.marcaVisual) };
}

// Patrocinadores. O admin cadastra na aba Marca, e o modelo liga a faixa. Datas em AAAA-MM-DD, as duas pontas valem.
const NOME_PATROCINIO_MAX = 60;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const dataValida = (v: unknown): v is string => typeof v === 'string' && DATA.test(v) && !Number.isNaN(Date.parse(v));

export function validarPatrocinio(corpo: unknown, idioma: Idioma = 'pt-BR'): { nome: string; inicio: string; fim: string } | { erro: string } {
  const tr = (pt: string, en: string) => (idioma === 'en' ? en : pt);
  const c = (corpo ?? {}) as Record<string, unknown>;
  const nome = typeof c.nome === 'string' ? c.nome.replace(/\s+/g, ' ').trim() : '';
  if (!nome || nome.length > NOME_PATROCINIO_MAX) return { erro: tr(`nome: de 1 a ${NOME_PATROCINIO_MAX} caracteres`, `name: 1 to ${NOME_PATROCINIO_MAX} characters`) };
  if (!dataValida(c.inicio) || !dataValida(c.fim)) return { erro: tr('período: início e fim', 'period: start and end') };
  if (c.fim < c.inicio) return { erro: tr('o fim vem depois do início', 'the end comes after the start') };
  return { nome, inicio: c.inicio, fim: c.fim };
}

export async function listarPatrocinios(env: Env, tenantId: string) {
  const { results } = await env.DB.prepare('SELECT id, nome, logo_r2, inicio, fim FROM patrocinios WHERE tenant_id = ? AND arquivado_em IS NULL ORDER BY inicio, rowid')
    .bind(tenantId).all<{ id: string; nome: string; logo_r2: string | null; inicio: string; fim: string }>();
  return results.map((p) => ({ id: p.id, nome: p.nome, temLogo: !!p.logo_r2, inicio: p.inicio, fim: p.fim }));
}

/** O modelo só aponta para patrocinador do próprio veículo. */
export async function patrocinioDoVeiculo(env: Env, tenantId: string, id: string) {
  return !!(await env.DB.prepare('SELECT 1 AS x FROM patrocinios WHERE id = ? AND tenant_id = ? AND arquivado_em IS NULL').bind(id, tenantId).first());
}
