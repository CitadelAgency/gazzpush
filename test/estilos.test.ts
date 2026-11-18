// Modelos do veículo: escolha pela pauta, cópia da marca que protege a peça, catálogo, papéis e IDOR. Browser falso.
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { escolherEstilo, marcaComCopia, marcaVisualDe, mesmaMarca, PARAMS_PADRAO, type Estilo, type EstiloPeca } from '../src/lib/estilo';
import { estiloDaPeca, validarEstilo } from '../src/lib/estilos';
import { carregarPauta, type Marca } from '../src/lib/pauta';
import type { Rascunho } from '../src/lib/redacao';
import { baseDoCard, navegador, pautaDoEstilo, prepararCards } from '../src/lib/render';
import { aplicarEstilo } from '../src/shell/edicao';
import { cadastrar, req, seedMembro, seedTenant } from './helpers';

const CORPO = { nome: 'Urgente', params: { composicao: 'tarja', caixaTitulo: 'normal', papelCores: 'invertido', sequencia: ['texto', 'lista'] }, valePara: { palavras: ['urgente'] } };

async function membro(papel: 'admin' | 'editor' | 'reporter' = 'admin') {
  const s = await cadastrar();
  const t = await seedTenant();
  await seedMembro(t, s.userId, papel);
  return { s, t };
}

async function criar(s: { cookie: string }, t: string, corpo: unknown = CORPO) {
  const r = await req(`/api/t/${t}/estilos`, { cookie: s.cookie, body: corpo });
  expect(r.status).toBe(201);
  return (await r.json<{ id: string }>()).id;
}

/** Peça de verdade no banco, sem fatos: basta para render e versão. */
async function peca(t: string, o: { status?: string; estilo?: EstiloPeca; nova?: boolean } = {}) {
  const pautaId = crypto.randomUUID();
  const id = crypto.randomUUID();
  const [doc, fato] = [crypto.randomUUID(), crypto.randomUUID()];
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO fontes (id, tenant_id, tipo, nome) VALUES (?, ?, 'manual', 'Teste')").bind(`${t}:f`, t),
    env.DB.prepare("INSERT INTO documentos (id, tenant_id, fonte_id, url, hash_texto, status) VALUES (?, ?, ?, ?, ?, 'triado')").bind(doc, t, `${t}:f`, `https://a.example/${doc}`, doc),
    env.DB.prepare("INSERT INTO fatos (id, tenant_id, documento_id, tipo, texto, hash) VALUES (?, ?, ?, 'manchete', 'Título do item', ?)").bind(fato, t, doc, fato),
    env.DB.prepare("INSERT INTO pautas (id, tenant_id, status, origem, titulo, fato_ids_json, documento_ids_json, score) VALUES (?, ?, 'em_producao', 'manual', 'Título do item', ?, ?, 1)").bind(pautaId, t, JSON.stringify([fato]), JSON.stringify([doc])),
  ]);
  const conteudo: Rascunho = {
    manchete: 'Título do item', resumo: '', legenda: 'Legenda', modelo: 'ia', custoUsd: 0,
    cards: [{ id: 'c1', layout: 'capa', titulo: 'Título do item', frases: [{ texto: 'Título do item', fatoId: fato }] }], ...(o.estilo ? { estilo: o.estilo } : {}),
  };
  await env.DB.prepare(`INSERT INTO pecas (id, tenant_id, pauta_id, formato, status, versao, conteudo_json, validacao_json, arte_r2_keys_json, workflow_id)
                        VALUES (?, ?, ?, 'post', ?, 1, ?, '{"ok":true,"erros":[],"avisos":[]}', '[]', ?)`)
    .bind(id, t, pautaId, o.status ?? 'revisao', JSON.stringify(conteudo), `${id}-r1`).run();
  if (!o.nova) await env.DB.prepare("INSERT INTO peca_versoes (id, tenant_id, peca_id, versao, rodada, conteudo_json, autor) VALUES (?, ?, ?, 1, 1, ?, 'ia')").bind(crypto.randomUUID(), t, id, JSON.stringify(conteudo)).run();
  return { id, pautaId, conteudo };
}

let htmls: string[] = [];
beforeEach(() => {
  htmls = [];
  const page = {
    on: () => {}, route: async () => {}, setContent: async (h: string) => { htmls.push(h); }, evaluate: async (f: unknown) => (typeof f === 'function' && f.length ? { width: 1080, height: 1350, overflow: [], overlap: false, headlineLines: 2, imagesLoaded: true, badText: false, fontsReady: true, cores: [] } : undefined),
    locator: () => ({ screenshot: async () => new Uint8Array([1]) }),
  };
  vi.spyOn(navegador, 'abrir').mockImplementation((() => Promise.resolve({ newPage: async () => page, close: async () => {} })) as never);
});
afterEach(() => vi.restoreAllMocks());

describe('escolherEstilo', () => {
  const e = (nome: string, v: Partial<Estilo['valePara']>, padrao = false) => ({ nome, padrao, valePara: { editorias: [], tiposPost: [], palavras: [], ...v } });
  const lista = [e('Geral', {}, true), e('Polícia', { editorias: ['policia'] }), e('Vaga', { palavras: ['vaga', 'Emprego'] }), e('Publi', { tiposPost: ['publicidade'] })];

  it('tipo de post vence palavra, palavra vence editoria, editoria vence o padrão', () => {
    expect(escolherEstilo(lista, { tipoPost: 'publicidade', titulo: 'Vaga aberta', editoria: 'policia' })?.nome).toBe('Publi');
    expect(escolherEstilo(lista, { titulo: 'Vaga aberta', editoria: 'policia' })?.nome).toBe('Vaga');
    expect(escolherEstilo(lista, { titulo: 'Assalto no centro', editoria: 'policia' })?.nome).toBe('Polícia');
    expect(escolherEstilo(lista, { titulo: 'Festa', editoria: 'cultura' })?.nome).toBe('Geral');
  });

  it('palavra sai do resumo, sem acento nem caixa, e só inteira', () => {
    expect(escolherEstilo(lista, { titulo: 'Festa', resumo: 'Há EMPREGO temporário' })?.nome).toBe('Vaga');
    expect(escolherEstilo(lista, { titulo: 'Vagamente lembrado' })?.nome).toBe('Geral');
    expect(escolherEstilo([e('Urgente', { palavras: ['atenção'] })], { titulo: 'ATENCAO no trânsito' })?.nome).toBe('Urgente');
  });

  it('sem nenhum que sirva: o visual de hoje', () => {
    expect(escolherEstilo([e('Vaga', { palavras: ['vaga'] })], { titulo: 'Festa' })).toBeNull();
    expect(escolherEstilo([], { titulo: 'Festa' })).toBeNull();
  });
});

describe('validarEstilo', () => {
  it('fecha pelo catálogo', () => {
    expect(validarEstilo({ nome: 'X', params: { composicao: 'neon' } })).toHaveProperty('erro');
    expect(validarEstilo({ nome: 'X', params: { caixaTitulo: 'pequena' } })).toHaveProperty('erro');
    expect(validarEstilo({ nome: 'X', params: { papelCores: '#ff0000' } })).toHaveProperty('erro');
    expect(validarEstilo({ nome: 'X', params: { sequencia: ['convite'] } })).toHaveProperty('erro');
    expect(validarEstilo({ nome: 'X', params: { sequencia: Array(7).fill('texto') } })).toHaveProperty('erro');
    expect(validarEstilo({ nome: 'X', valePara: { editorias: ['futebol'] } })).toHaveProperty('erro');
    expect(validarEstilo({ nome: 'X', valePara: { tiposPost: ['noticia'] } })).toHaveProperty('erro');
    expect(validarEstilo({ nome: 'X', valePara: { palavras: Array.from({ length: 9 }, (_, i) => `p${i}`) } })).toHaveProperty('erro');
    expect(validarEstilo({ nome: '' })).toHaveProperty('erro');
  });

  it('não leva campo fora do catálogo', () => {
    const v = validarEstilo({ ...CORPO, params: { ...CORPO.params, cor: '#ff0000', fonte: 'Comic Sans' } });
    expect(v).not.toHaveProperty('erro');
    expect(JSON.stringify(v)).not.toMatch(/ff0000|Comic/);
  });
});

describe('a cópia da marca', () => {
  const marca: Marca = { nome: 'Marca', logoR2: 'logos/a.png', cores: { fundo: '#111111', texto: '#eeeeee', acento: '#00ff00' }, marcaDagua: { posicao: 'canto', opacidade: 0.5 }, ctas: [] };

  it('marca nova com logo não entra em peça congelada sem logo', () => {
    const copia = marcaVisualDe({ nome: 'Marca' });
    expect(marcaComCopia(marca, copia).logoR2).toBeUndefined();
    expect(marcaComCopia(marca, copia).marcaDagua).toBeUndefined();
    expect(marcaComCopia(marca, copia).nome).toBe('Marca');
  });

  it('a ordem das chaves não acende "a marca mudou"', () => {
    expect(mesmaMarca({ cores: { fundo: '#111111', texto: '#eeeeee' } }, { cores: { texto: '#eeeeee', fundo: '#111111' } })).toBe(true);
    expect(mesmaMarca({ cores: { fundo: '#111111' } }, { cores: { fundo: '#222222' } })).toBe(false);
  });

  it('o card usa a cópia e os parâmetros, com as cores no papel pedido', async () => {
    const { t } = await membro();
    const { pautaId, conteudo } = await peca(t);
    const pauta = await carregarPauta(env, t, pautaId);
    const estilo: EstiloPeca = { id: 'e', versao: 1, params: { ...PARAMS_PADRAO, composicao: 'cartaz', papelCores: 'invertido' }, marcaVisual: { cores: marca.cores } };
    expect(baseDoCard(pautaDoEstilo(pauta, estilo)).cores).toEqual({ fundo: '#eeeeee', texto: '#111111', acento: '#00ff00' });
    const [c] = await prepararCards(env, { tenantId: t, pecaId: 'p', versao: 1, formato: 'carrossel', pauta, rascunho: { ...conteudo, estilo } });
    expect(c.html).toContain('comp-cartaz');
    expect(c.html).not.toContain('class="art');
  });

  it('peça sem modelo sai igual à de um veículo que tem modelos', async () => {
    const { s, t } = await membro();
    const { pautaId, conteudo } = await peca(t);
    const pauta = await carregarPauta(env, t, pautaId);
    const hoje = '2026-11-05T12:00:00Z';
    const [antes] = await prepararCards(env, { tenantId: t, pecaId: 'p', versao: 1, formato: 'carrossel', pauta, rascunho: conteudo, hoje });
    await criar(s, t, { ...CORPO, padrao: true });
    const [depois] = await prepararCards(env, { tenantId: t, pecaId: 'p', versao: 1, formato: 'carrossel', pauta: await carregarPauta(env, t, pautaId), rascunho: conteudo, hoje });
    expect(depois.hash).toBe(antes.hash);
  });
});

describe('na produção', () => {
  it('peça nova escolhe pela pauta e congela a marca de agora', async () => {
    const { s, t } = await membro();
    const id = await criar(s, t, { ...CORPO, valePara: {}, padrao: true });
    const { id: pecaId, pautaId } = await peca(t, { nova: true });
    const e = await estiloDaPeca(env, t, pecaId, await carregarPauta(env, t, pautaId));
    expect(e).toMatchObject({ id, versao: 1, params: { composicao: 'tarja' } });
  });

  it('reescrever mantém o da versão anterior, e a peça sem modelo continua sem', async () => {
    const { s, t } = await membro();
    await criar(s, t, { ...CORPO, valePara: {}, padrao: true });
    const { id: pecaId, pautaId, conteudo } = await peca(t);
    const pauta = await carregarPauta(env, t, pautaId);
    expect(await estiloDaPeca(env, t, pecaId, pauta)).toBeNull();
    const estilo: EstiloPeca = { id: 'velho', versao: 3, params: PARAMS_PADRAO, marcaVisual: {} };
    await env.DB.prepare("INSERT INTO peca_versoes (id, tenant_id, peca_id, versao, rodada, conteudo_json, autor) VALUES (?, ?, ?, 2, 2, ?, 'ia')").bind(crypto.randomUUID(), t, pecaId, JSON.stringify({ ...conteudo, estilo })).run();
    expect(await estiloDaPeca(env, t, pecaId, pauta)).toEqual(estilo);
  });
});

describe('rotas', () => {
  it('admin cria, edita (a versão sobe) e arquiva; lista só os ativos; um padrão só', async () => {
    const { s, t } = await membro();
    const a = await criar(s, t, { ...CORPO, padrao: true });
    const b = await criar(s, t, { ...CORPO, nome: 'Vaga', padrao: true });
    const lista = async () => (await (await req(`/api/t/${t}/estilos`, { cookie: s.cookie })).json<{ estilos: Estilo[] }>()).estilos;
    expect((await lista()).map((e) => [e.nome, e.padrao])).toEqual([['Urgente', false], ['Vaga', true]]);
    const r = await req(`/api/t/${t}/estilos/${a}`, { cookie: s.cookie, method: 'PUT', body: { ...CORPO, nome: 'Plantão', padrao: true } });
    expect(r.status).toBe(200);
    expect((await lista()).map((e) => [e.nome, e.versao, e.padrao])).toEqual([['Plantão', 2, true], ['Vaga', 1, false]]);
    expect((await req(`/api/t/${t}/estilos/${b}`, { cookie: s.cookie, method: 'DELETE' })).status).toBe(200);
    expect((await lista()).map((e) => e.nome)).toEqual(['Plantão']);
    expect((await req(`/api/t/${t}/estilos/${b}`, { cookie: s.cookie, method: 'PUT', body: CORPO })).status).toBe(404);
  });

  it('nome repetido e o sétimo modelo dão 409', async () => {
    const { s, t } = await membro();
    await criar(s, t);
    expect((await req(`/api/t/${t}/estilos`, { cookie: s.cookie, body: CORPO })).status).toBe(409);
    for (let i = 0; i < 5; i++) await criar(s, t, { ...CORPO, nome: `M${i}` });
    const r = await req(`/api/t/${t}/estilos`, { cookie: s.cookie, body: { ...CORPO, nome: 'Sétimo' } });
    expect(r.status).toBe(409);
    expect((await r.json<{ erro: string }>()).erro).toMatch(/Até 6/);
  });

  it('papéis: repórter e editor só veem; repórter não aplica', async () => {
    const { s, t } = await membro();
    const id = await criar(s, t);
    const { id: pecaId } = await peca(t);
    for (const papel of ['reporter', 'editor'] as const) {
      const outro = await cadastrar();
      await seedMembro(t, outro.userId, papel);
      expect((await req(`/api/t/${t}/estilos`, { cookie: outro.cookie })).status).toBe(200);
      expect((await req(`/api/t/${t}/estilos`, { cookie: outro.cookie, body: { ...CORPO, nome: 'Z' } })).status).toBe(403);
      expect((await req(`/api/t/${t}/estilos/${id}`, { cookie: outro.cookie, method: 'PUT', body: CORPO })).status).toBe(403);
      expect((await req(`/api/t/${t}/estilos/${id}`, { cookie: outro.cookie, method: 'DELETE' })).status).toBe(403);
      const aplicar = await req(`/api/t/${t}/pecas/${pecaId}/estilo`, { cookie: outro.cookie, method: 'PUT', body: { versao: 1, estiloId: id } });
      expect(aplicar.status).toBe(papel === 'reporter' ? 403 : 200);
      await env.DB.prepare("UPDATE pecas SET versao = 1 WHERE id = ?").bind(pecaId).run();
    }
  });

  it('IDOR: modelo e peça de outro veículo dão 404', async () => {
    const a = await membro();
    const b = await membro();
    const id = await criar(a.s, a.t);
    const pecaA = await peca(a.t);
    const pecaB = await peca(b.t);
    expect((await req(`/api/t/${b.t}/estilos/${id}`, { cookie: b.s.cookie, method: 'PUT', body: CORPO })).status).toBe(404);
    expect((await req(`/api/t/${b.t}/estilos/${id}`, { cookie: b.s.cookie, method: 'DELETE' })).status).toBe(404);
    expect((await req(`/api/t/${a.t}/estilos`, { cookie: b.s.cookie })).status).toBe(404);
    expect((await req(`/api/t/${b.t}/pecas/${pecaB.id}/estilo`, { cookie: b.s.cookie, method: 'PUT', body: { versao: 1, estiloId: id } })).status).toBe(404);
    expect((await req(`/api/t/${b.t}/pecas/${pecaA.id}/estilo`, { cookie: b.s.cookie, method: 'PUT', body: { versao: 1, estiloId: null } })).status).toBe(404);
  });
});

describe('trocar o modelo da peça', () => {
  it('cria versão nova, renderiza e dá 409 em versão velha', async () => {
    const { s, t } = await membro();
    const id = await criar(s, t);
    const { id: pecaId } = await peca(t);
    const r = await aplicarEstilo(env, { tenantId: t, pecaId, por: s.userId, versao: 1, estiloId: id });
    expect(r).toMatchObject({ ok: true, versao: 2, validacao: { erros: [] }, renderizados: ['c1'] });
    expect(htmls[0]).toContain('comp-tarja');
    expect(await aplicarEstilo(env, { tenantId: t, pecaId, por: s.userId, versao: 1, estiloId: id })).toMatchObject({ ok: false, status: 409 });
    const row = await env.DB.prepare('SELECT conteudo_json FROM pecas WHERE id = ?').bind(pecaId).first<{ conteudo_json: string }>();
    expect(JSON.parse(row!.conteudo_json).estilo).toMatchObject({ id, versao: 1 });
  });

  it('`null` tira o modelo', async () => {
    const { s, t } = await membro();
    const { id: pecaId } = await peca(t, { estilo: { id: 'x', versao: 1, params: { ...PARAMS_PADRAO, composicao: 'tarja' }, marcaVisual: {} } });
    expect(await aplicarEstilo(env, { tenantId: t, pecaId, por: s.userId, versao: 1, estiloId: null })).toMatchObject({ ok: true });
    const row = await env.DB.prepare('SELECT conteudo_json FROM pecas WHERE id = ?').bind(pecaId).first<{ conteudo_json: string }>();
    expect(JSON.parse(row!.conteudo_json).estilo).toBeUndefined();
  });

  it('publicada fica intacta', async () => {
    const { s, t } = await membro();
    const id = await criar(s, t);
    const { id: pecaId, conteudo } = await peca(t, { status: 'publicada' });
    expect(await aplicarEstilo(env, { tenantId: t, pecaId, por: s.userId, versao: 1, estiloId: id })).toMatchObject({ ok: false, status: 409 });
    const row = await env.DB.prepare('SELECT conteudo_json, versao FROM pecas WHERE id = ?').bind(pecaId).first<{ conteudo_json: string; versao: number }>();
    expect(row).toEqual({ conteudo_json: JSON.stringify(conteudo), versao: 1 });
  });

  it('a Revisão avisa que o modelo mudou, e que a marca mudou; a peça em si fica como estava até aplicar', async () => {
    const { s, t } = await membro();
    const id = await criar(s, t);
    const { id: pecaId } = await peca(t);
    await aplicarEstilo(env, { tenantId: t, pecaId, por: s.userId, versao: 1, estiloId: id });
    const situacao = async () => (await (await req(`/api/t/${t}/pecas/${pecaId}`, { cookie: s.cookie })).json<{ modelo: unknown }>()).modelo;
    expect(await situacao()).toEqual({ id, modeloMudou: false, marcaMudou: false });
    await req(`/api/t/${t}/estilos/${id}`, { cookie: s.cookie, method: 'PUT', body: { ...CORPO, params: { ...CORPO.params, composicao: 'coluna' } } });
    expect(await situacao()).toEqual({ id, modeloMudou: true, marcaMudou: false });
    await aplicarEstilo(env, { tenantId: t, pecaId, por: s.userId, versao: 2, estiloId: id });
    expect(await situacao()).toEqual({ id, modeloMudou: false, marcaMudou: false });
    await env.DB.prepare(`UPDATE tenants SET marca_json = json_patch(marca_json, '{"cores":{"fundo":"#123456"}}') WHERE id = ?`).bind(t).run();
    const row = await env.DB.prepare('SELECT conteudo_json FROM pecas WHERE id = ?').bind(pecaId).first<{ conteudo_json: string }>();
    expect(JSON.parse(row!.conteudo_json).estilo.marcaVisual.cores?.fundo).not.toBe('#123456');
    expect(await situacao()).toEqual({ id, modeloMudou: false, marcaMudou: true });
    await aplicarEstilo(env, { tenantId: t, pecaId, por: s.userId, versao: 3, estiloId: id });
    expect(await situacao()).toEqual({ id, modeloMudou: false, marcaMudou: false });
  });
});
