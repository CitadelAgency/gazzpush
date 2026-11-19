// The outlet's templates: choice by lead, the brand copy that protects the piece, catalogue, roles and IDOR. Fake browser.
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseStyle, withCopyBrand, visualBrand, sameBrand, DEFAULT_PARAMS, type Style, type PieceStyle } from '../src/lib/style';
import { fromPieceStyle, validateStyle } from '../src/lib/styles';
import { loadLead, type Brand } from '../src/lib/lead';
import type { Draft } from '../src/lib/drafting';
import { baseCard, browserApi, leadStyle, prepareCards } from '../src/lib/render';
import { applyStyle } from '../src/shell/editing';
import { register, req, seedMember, seedTenant } from './helpers';

const BODY = { nome: 'Urgente', params: { composicao: 'tarja', caixaTitulo: 'normal', papelCores: 'invertido', sequencia: ['texto', 'lista'] }, valePara: { palavras: ['urgente'] } };

async function member(role: 'admin' | 'editor' | 'reporter' = 'admin') {
  const s = await register();
  const t = await seedTenant();
  await seedMember(t, s.userId, role);
  return { s, t };
}

async function create(s: { cookie: string }, t: string, body: unknown = BODY) {
  const r = await req(`/api/t/${t}/estilos`, { cookie: s.cookie, body: body });
  expect(r.status).toBe(201);
  return (await r.json<{ id: string }>()).id;
}

/** A real piece in the database, without facts: enough for render and version. */
async function pieceOf(t: string, o: { status?: string; estilo?: PieceStyle; nova?: boolean } = {}) {
  const leadId = crypto.randomUUID();
  const id = crypto.randomUUID();
  const [doc, fact] = [crypto.randomUUID(), crypto.randomUUID()];
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO fontes (id, tenant_id, tipo, nome) VALUES (?, ?, 'manual', 'Teste')").bind(`${t}:f`, t),
    env.DB.prepare("INSERT INTO documentos (id, tenant_id, fonte_id, url, hash_texto, status) VALUES (?, ?, ?, ?, ?, 'triado')").bind(doc, t, `${t}:f`, `https://a.example/${doc}`, doc),
    env.DB.prepare("INSERT INTO fatos (id, tenant_id, documento_id, tipo, texto, hash) VALUES (?, ?, ?, 'manchete', 'Ponte fecha', ?)").bind(fact, t, doc, fact),
    env.DB.prepare("INSERT INTO pautas (id, tenant_id, status, origem, titulo, fato_ids_json, documento_ids_json, score) VALUES (?, ?, 'em_producao', 'manual', 'Ponte fecha', ?, ?, 1)").bind(leadId, t, JSON.stringify([fact]), JSON.stringify([doc])),
  ]);
  const content: Draft = {
    manchete: 'Ponte fecha', resumo: '', legenda: 'Legenda', modelo: 'ia', custoUsd: 0,
    cards: [{ id: 'c1', layout: 'capa', titulo: 'Ponte fecha', frases: [{ texto: 'Ponte fecha', fatoId: fact }] }], ...(o.estilo ? { estilo: o.estilo } : {}),
  };
  await env.DB.prepare(`INSERT INTO pecas (id, tenant_id, pauta_id, formato, status, versao, conteudo_json, validacao_json, arte_r2_keys_json, workflow_id)
                        VALUES (?, ?, ?, 'post', ?, 1, ?, '{"ok":true,"erros":[],"avisos":[]}', '[]', ?)`)
    .bind(id, t, leadId, o.status ?? 'revisao', JSON.stringify(content), `${id}-r1`).run();
  if (!o.nova) await env.DB.prepare("INSERT INTO peca_versoes (id, tenant_id, peca_id, versao, rodada, conteudo_json, autor) VALUES (?, ?, ?, 1, 1, ?, 'ia')").bind(crypto.randomUUID(), t, id, JSON.stringify(content)).run();
  return { id, pautaId: leadId, conteudo: content };
}

let htmls: string[] = [];
beforeEach(() => {
  htmls = [];
  const page = {
    on: () => {}, route: async () => {}, setContent: async (h: string) => { htmls.push(h); }, evaluate: async (f: unknown) => (typeof f === 'function' && f.length ? { width: 1080, height: 1350, overflow: [], overlap: false, headlineLines: 2, imagesLoaded: true, badText: false, fontsReady: true, cores: [] } : undefined),
    locator: () => ({ screenshot: async () => new Uint8Array([1]) }),
  };
  vi.spyOn(browserApi, 'abrir').mockImplementation((() => Promise.resolve({ newPage: async () => page, close: async () => {} })) as never);
});
afterEach(() => vi.restoreAllMocks());

describe('chooseStyle', () => {
  const e = (name: string, v: Partial<Style['valePara']>, fallback = false) => ({ nome: name, padrao: fallback, valePara: { editorias: [], tiposPost: [], palavras: [], ...v } });
  const list = [e('Geral', {}, true), e('Polícia', { editorias: ['policia'] }), e('Vaga', { palavras: ['vaga', 'Emprego'] }), e('Publi', { tiposPost: ['publicidade'] })];

  it('post type beats keyword, keyword beats section, section beats the default', () => {
    expect(chooseStyle(list, { tipoPost: 'publicidade', titulo: 'Vaga aberta', editoria: 'policia' })?.nome).toBe('Publi');
    expect(chooseStyle(list, { titulo: 'Vaga aberta', editoria: 'policia' })?.nome).toBe('Vaga');
    expect(chooseStyle(list, { titulo: 'Assalto no centro', editoria: 'policia' })?.nome).toBe('Polícia');
    expect(chooseStyle(list, { titulo: 'Festa', editoria: 'cultura' })?.nome).toBe('Geral');
  });

  it('the keyword comes from the summary, without accents or case, and only whole', () => {
    expect(chooseStyle(list, { titulo: 'Festa', resumo: 'Há EMPREGO temporário' })?.nome).toBe('Vaga');
    expect(chooseStyle(list, { titulo: 'Vagamente lembrado' })?.nome).toBe('Geral');
    expect(chooseStyle([e('Urgente', { palavras: ['atenção'] })], { titulo: 'ATENCAO no trânsito' })?.nome).toBe('Urgente');
  });

  it("no template fits: today's look", () => {
    expect(chooseStyle([e('Vaga', { palavras: ['vaga'] })], { titulo: 'Festa' })).toBeNull();
    expect(chooseStyle([], { titulo: 'Festa' })).toBeNull();
  });
});

describe('validateStyle', () => {
  it('closes by the catalog', () => {
    expect(validateStyle({ nome: 'X', params: { composicao: 'neon' } })).toHaveProperty('erro');
    expect(validateStyle({ nome: 'X', params: { caixaTitulo: 'pequena' } })).toHaveProperty('erro');
    expect(validateStyle({ nome: 'X', params: { papelCores: '#ff0000' } })).toHaveProperty('erro');
    expect(validateStyle({ nome: 'X', params: { sequencia: ['convite'] } })).toHaveProperty('erro');
    expect(validateStyle({ nome: 'X', params: { sequencia: Array(7).fill('texto') } })).toHaveProperty('erro');
    expect(validateStyle({ nome: 'X', valePara: { editorias: ['futebol'] } })).toHaveProperty('erro');
    expect(validateStyle({ nome: 'X', valePara: { tiposPost: ['noticia'] } })).toHaveProperty('erro');
    expect(validateStyle({ nome: 'X', valePara: { palavras: Array.from({ length: 9 }, (_, i) => `p${i}`) } })).toHaveProperty('erro');
    expect(validateStyle({ nome: '' })).toHaveProperty('erro');
  });

  it('takes no field outside the catalog', () => {
    const v = validateStyle({ ...BODY, params: { ...BODY.params, cor: '#ff0000', fonte: 'Comic Sans' } });
    expect(v).not.toHaveProperty('erro');
    expect(JSON.stringify(v)).not.toMatch(/ff0000|Comic/);
  });
});

describe("the brand's copy", () => {
  const brand: Brand = { nome: 'Gazeta', logoR2: 'logos/a.png', cores: { fundo: '#111111', texto: '#eeeeee', acento: '#00ff00' }, marcaDagua: { posicao: 'canto', opacidade: 0.5 }, ctas: [] };

  it("a new brand with logo doesn't enter a frozen piece without logo", () => {
    const copy = visualBrand({ nome: 'Gazeta' });
    expect(withCopyBrand(brand, copy).logoR2).toBeUndefined();
    expect(withCopyBrand(brand, copy).marcaDagua).toBeUndefined();
    expect(withCopyBrand(brand, copy).nome).toBe('Gazeta');
  });

  it('key order doesn\'t trigger "the brand changed"', () => {
    expect(sameBrand({ cores: { fundo: '#111111', texto: '#eeeeee' } }, { cores: { texto: '#eeeeee', fundo: '#111111' } })).toBe(true);
    expect(sameBrand({ cores: { fundo: '#111111' } }, { cores: { fundo: '#222222' } })).toBe(false);
  });

  it('the card uses the copy and the parameters, with the colors in the requested role', async () => {
    const { t } = await member();
    const { pautaId: leadId, conteudo: content } = await pieceOf(t);
    const lead = await loadLead(env, t, leadId);
    const style: PieceStyle = { id: 'e', versao: 1, params: { ...DEFAULT_PARAMS, composicao: 'cartaz', papelCores: 'invertido' }, marcaVisual: { cores: brand.cores } };
    expect(baseCard(leadStyle(lead, style)).cores).toEqual({ fundo: '#eeeeee', texto: '#111111', acento: '#00ff00' });
    const [c] = await prepareCards(env, { tenantId: t, pecaId: 'p', versao: 1, formato: 'carrossel', pauta: lead, rascunho: { ...content, estilo: style } });
    expect(c.html).toContain('comp-cartaz');
    expect(c.html).not.toContain('class="art');
  });

  it('a piece without template comes out the same as one from an outlet that has templates', async () => {
    const { s, t } = await member();
    const { pautaId: leadId, conteudo: content } = await pieceOf(t);
    const lead = await loadLead(env, t, leadId);
    const today = '2026-11-05T12:00:00Z';
    const [before] = await prepareCards(env, { tenantId: t, pecaId: 'p', versao: 1, formato: 'carrossel', pauta: lead, rascunho: content, hoje: today });
    await create(s, t, { ...BODY, padrao: true });
    const [after] = await prepareCards(env, { tenantId: t, pecaId: 'p', versao: 1, formato: 'carrossel', pauta: await loadLead(env, t, leadId), rascunho: content, hoje: today });
    expect(after.hash).toBe(before.hash);
  });
});

describe('in production', () => {
  it("a new piece picks by lead and freezes today's brand", async () => {
    const { s, t } = await member();
    const id = await create(s, t, { ...BODY, valePara: {}, padrao: true });
    const { id: pieceId, pautaId: leadId } = await pieceOf(t, { nova: true });
    const e = await fromPieceStyle(env, t, pieceId, await loadLead(env, t, leadId));
    expect(e).toMatchObject({ id, versao: 1, params: { composicao: 'tarja' } });
  });

  it("rewrite keeps the previous version's, and a piece without template stays without", async () => {
    const { s, t } = await member();
    await create(s, t, { ...BODY, valePara: {}, padrao: true });
    const { id: pieceId, pautaId: leadId, conteudo: content } = await pieceOf(t);
    const lead = await loadLead(env, t, leadId);
    expect(await fromPieceStyle(env, t, pieceId, lead)).toBeNull();
    const style: PieceStyle = { id: 'velho', versao: 3, params: DEFAULT_PARAMS, marcaVisual: {} };
    await env.DB.prepare("INSERT INTO peca_versoes (id, tenant_id, peca_id, versao, rodada, conteudo_json, autor) VALUES (?, ?, ?, 2, 2, ?, 'ia')").bind(crypto.randomUUID(), t, pieceId, JSON.stringify({ ...content, estilo: style })).run();
    expect(await fromPieceStyle(env, t, pieceId, lead)).toEqual(style);
  });
});

describe('routes', () => {
  it('admin creates, edits (the version goes up) and archives; lists only the active ones; only one default', async () => {
    const { s, t } = await member();
    const a = await create(s, t, { ...BODY, padrao: true });
    const b = await create(s, t, { ...BODY, nome: 'Vaga', padrao: true });
    const list = async () => (await (await req(`/api/t/${t}/estilos`, { cookie: s.cookie })).json<{ estilos: Style[] }>()).estilos;
    expect((await list()).map((e) => [e.nome, e.padrao])).toEqual([['Urgente', false], ['Vaga', true]]);
    const r = await req(`/api/t/${t}/estilos/${a}`, { cookie: s.cookie, method: 'PUT', body: { ...BODY, nome: 'Plantão', padrao: true } });
    expect(r.status).toBe(200);
    expect((await list()).map((e) => [e.nome, e.versao, e.padrao])).toEqual([['Plantão', 2, true], ['Vaga', 1, false]]);
    expect((await req(`/api/t/${t}/estilos/${b}`, { cookie: s.cookie, method: 'DELETE' })).status).toBe(200);
    expect((await list()).map((e) => e.nome)).toEqual(['Plantão']);
    expect((await req(`/api/t/${t}/estilos/${b}`, { cookie: s.cookie, method: 'PUT', body: BODY })).status).toBe(404);
  });

  it('duplicate name and the seventh template give 409', async () => {
    const { s, t } = await member();
    await create(s, t);
    expect((await req(`/api/t/${t}/estilos`, { cookie: s.cookie, body: BODY })).status).toBe(409);
    for (let i = 0; i < 5; i++) await create(s, t, { ...BODY, nome: `M${i}` });
    const r = await req(`/api/t/${t}/estilos`, { cookie: s.cookie, body: { ...BODY, nome: 'Sétimo' } });
    expect(r.status).toBe(409);
    expect((await r.json<{ erro: string }>()).erro).toMatch(/Até 6/);
  });

  it("roles: reporter and editor can only view; reporter doesn't apply", async () => {
    const { s, t } = await member();
    const id = await create(s, t);
    const { id: pieceId } = await pieceOf(t);
    for (const role of ['reporter', 'editor'] as const) {
      const other = await register();
      await seedMember(t, other.userId, role);
      expect((await req(`/api/t/${t}/estilos`, { cookie: other.cookie })).status).toBe(200);
      expect((await req(`/api/t/${t}/estilos`, { cookie: other.cookie, body: { ...BODY, nome: 'Z' } })).status).toBe(403);
      expect((await req(`/api/t/${t}/estilos/${id}`, { cookie: other.cookie, method: 'PUT', body: BODY })).status).toBe(403);
      expect((await req(`/api/t/${t}/estilos/${id}`, { cookie: other.cookie, method: 'DELETE' })).status).toBe(403);
      const apply = await req(`/api/t/${t}/pecas/${pieceId}/estilo`, { cookie: other.cookie, method: 'PUT', body: { versao: 1, estiloId: id } });
      expect(apply.status).toBe(role === 'reporter' ? 403 : 200);
      await env.DB.prepare("UPDATE pecas SET versao = 1 WHERE id = ?").bind(pieceId).run();
    }
  });

  it('IDOR: template and piece from another outlet give 404', async () => {
    const a = await member();
    const b = await member();
    const id = await create(a.s, a.t);
    const piece = await pieceOf(a.t);
    const pieceB = await pieceOf(b.t);
    expect((await req(`/api/t/${b.t}/estilos/${id}`, { cookie: b.s.cookie, method: 'PUT', body: BODY })).status).toBe(404);
    expect((await req(`/api/t/${b.t}/estilos/${id}`, { cookie: b.s.cookie, method: 'DELETE' })).status).toBe(404);
    expect((await req(`/api/t/${a.t}/estilos`, { cookie: b.s.cookie })).status).toBe(404);
    expect((await req(`/api/t/${b.t}/pecas/${pieceB.id}/estilo`, { cookie: b.s.cookie, method: 'PUT', body: { versao: 1, estiloId: id } })).status).toBe(404);
    expect((await req(`/api/t/${b.t}/pecas/${piece.id}/estilo`, { cookie: b.s.cookie, method: 'PUT', body: { versao: 1, estiloId: null } })).status).toBe(404);
  });
});

describe("change the piece's template", () => {
  it('creates a new version, renders, and gives 409 for an old version', async () => {
    const { s, t } = await member();
    const id = await create(s, t);
    const { id: pieceId } = await pieceOf(t);
    const r = await applyStyle(env, { tenantId: t, pecaId: pieceId, por: s.userId, versao: 1, estiloId: id });
    expect(r).toMatchObject({ ok: true, versao: 2, validacao: { erros: [] }, renderizados: ['c1'] });
    expect(htmls[0]).toContain('comp-tarja');
    expect(await applyStyle(env, { tenantId: t, pecaId: pieceId, por: s.userId, versao: 1, estiloId: id })).toMatchObject({ ok: false, status: 409 });
    const row = await env.DB.prepare('SELECT conteudo_json FROM pecas WHERE id = ?').bind(pieceId).first<{ conteudo_json: string }>();
    expect(JSON.parse(row!.conteudo_json).estilo).toMatchObject({ id, versao: 1 });
  });

  it('`null` removes the template', async () => {
    const { s, t } = await member();
    const { id: pieceId } = await pieceOf(t, { estilo: { id: 'x', versao: 1, params: { ...DEFAULT_PARAMS, composicao: 'tarja' }, marcaVisual: {} } });
    expect(await applyStyle(env, { tenantId: t, pecaId: pieceId, por: s.userId, versao: 1, estiloId: null })).toMatchObject({ ok: true });
    const row = await env.DB.prepare('SELECT conteudo_json FROM pecas WHERE id = ?').bind(pieceId).first<{ conteudo_json: string }>();
    expect(JSON.parse(row!.conteudo_json).estilo).toBeUndefined();
  });

  it('published stays intact', async () => {
    const { s, t } = await member();
    const id = await create(s, t);
    const { id: pieceId, conteudo: content } = await pieceOf(t, { status: 'publicada' });
    expect(await applyStyle(env, { tenantId: t, pecaId: pieceId, por: s.userId, versao: 1, estiloId: id })).toMatchObject({ ok: false, status: 409 });
    const row = await env.DB.prepare('SELECT conteudo_json, versao FROM pecas WHERE id = ?').bind(pieceId).first<{ conteudo_json: string; versao: number }>();
    expect(row).toEqual({ conteudo_json: JSON.stringify(content), versao: 1 });
  });

  it('the Review warns that the template changed and that the brand changed; the piece itself stays as it was until applied', async () => {
    const { s, t } = await member();
    const id = await create(s, t);
    const { id: pieceId } = await pieceOf(t);
    await applyStyle(env, { tenantId: t, pecaId: pieceId, por: s.userId, versao: 1, estiloId: id });
    const status = async () => (await (await req(`/api/t/${t}/pecas/${pieceId}`, { cookie: s.cookie })).json<{ modelo: unknown }>()).modelo;
    expect(await status()).toEqual({ id, modeloMudou: false, marcaMudou: false });
    await req(`/api/t/${t}/estilos/${id}`, { cookie: s.cookie, method: 'PUT', body: { ...BODY, params: { ...BODY.params, composicao: 'coluna' } } });
    expect(await status()).toEqual({ id, modeloMudou: true, marcaMudou: false });
    await applyStyle(env, { tenantId: t, pecaId: pieceId, por: s.userId, versao: 2, estiloId: id });
    expect(await status()).toEqual({ id, modeloMudou: false, marcaMudou: false });
    await env.DB.prepare(`UPDATE tenants SET marca_json = json_patch(marca_json, '{"cores":{"fundo":"#123456"}}') WHERE id = ?`).bind(t).run();
    const row = await env.DB.prepare('SELECT conteudo_json FROM pecas WHERE id = ?').bind(pieceId).first<{ conteudo_json: string }>();
    expect(JSON.parse(row!.conteudo_json).estilo.marcaVisual.cores?.fundo).not.toBe('#123456');
    expect(await status()).toEqual({ id, modeloMudou: false, marcaMudou: true });
    await applyStyle(env, { tenantId: t, pecaId: pieceId, por: s.userId, versao: 3, estiloId: id });
    expect(await status()).toEqual({ id, modeloMudou: false, marcaMudou: false });
  });
});
