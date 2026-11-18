// Chaves de IA por veículo: gravada cifrada, nunca devolvida, só admin, 404 entre veículos, a ordem de preferência (a do veículo,
// a do servidor, desligada), chave recusada não grava, Gemini pelo endereço de teste, o custo separado no painel e o modo
// instalação própria. Provedores simulados por fetch (nenhuma chave real).
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decifrarToken } from '../src/lib/crypto';
import { chavesDoVeiculo } from '../src/lib/provedores';
import { chamarTexto } from '../src/lib/texto';
import { painelDeUso } from '../src/lib/uso';
import { cadastrar, req, seedMembro, seedPauta, seedTenant } from './helpers';

const CHAVE = crypto.randomUUID();
let chaveDoServidor: string | undefined;
type Pedido = { url: string; headers: Headers; corpo: string };
let pedidos: Pedido[] = [];
/** Resposta de cada provedor por URL; `status` muda a da conferência de chave. */
let conferencia = 200;

const respostaTexto = (url: string) => url.includes('generateContent')
  ? Response.json({ candidates: [{ content: { parts: [{ text: '{"ok":"gemini"}' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 100, cachedContentTokenCount: 400, thoughtsTokenCount: 50 } })
  : Response.json({ choices: [{ message: { content: '{"ok":"deepseek"}' } }], usage: { prompt_tokens: 1000, completion_tokens: 200 } });

beforeEach(async () => {
  chaveDoServidor = env.DEEPSEEK_API_KEY;
  pedidos = [];
  conferencia = 200;
  await env.DB.prepare('DELETE FROM uso_modelo').run();
  vi.stubGlobal('fetch', vi.fn(async (u: RequestInfo | URL, init?: RequestInit) => {
    const url = String(u);
    pedidos.push({ url, headers: new Headers(init?.headers), corpo: String(init?.body ?? '') });
    if (/\/models(\?|$)|chat\/credit|\/requests\/.+\/status/.test(url)) return new Response('{"code":200}', { status: conferencia });
    return respostaTexto(url);
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  const e = env as unknown as Record<string, unknown>;
  if (chaveDoServidor === undefined) delete e.DEEPSEEK_API_KEY;
  else e.DEEPSEEK_API_KEY = chaveDoServidor;
  for (const k of ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'INSTALACAO_PROPRIA', 'ADMIN_USER_IDS']) delete e[k];
});

async function veiculo(papel: 'admin' | 'editor' = 'admin') {
  const t = await seedTenant();
  const s = await cadastrar();
  await seedMembro(t, s.userId, papel);
  const url = `/api/t/${t}/chaves-ia`;
  const salvar = (p: string, chave: string = CHAVE) => req(`${url}/${p}`, { method: 'PUT', cookie: s.cookie, body: { chave } });
  return { t, s, url, salvar };
}

describe('guardar a chave', () => {
  it('grava cifrada, conferida com o provedor, e a chave não volta em resposta nenhuma', async () => {
    const v = await veiculo();
    const res = await v.salvar('deepseek');
    expect(res.status).toBe(200);
    const corpo = await res.text();
    expect(corpo).not.toContain(CHAVE);
    expect(corpo).not.toContain(CHAVE.slice(0, -4));
    const linha = await env.DB.prepare('SELECT * FROM chaves_ia WHERE tenant_id = ?').bind(v.t).first<Record<string, string>>();
    expect(linha).toMatchObject({ provedor: 'deepseek', final: CHAVE.slice(-4), salva_por: v.s.userId });
    expect(linha!.chave_enc).toMatch(/^v1\./);
    expect(linha!.chave_enc).not.toContain(CHAVE);
    expect(await decifrarToken(env, linha!.chave_enc)).toBe(CHAVE);
    // A conferência foi uma chamada sem custo (a lista de modelos), com a chave do veículo.
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].url).toMatch(/\/models$/);
    expect(pedidos[0].headers.get('authorization')).toBe(`Bearer ${CHAVE}`);

    const get = await req(v.url, { cookie: v.s.cookie });
    const texto = await get.text();
    expect(texto).not.toContain(CHAVE);
    const estado = JSON.parse(texto) as { provedores: { id: string; veiculo: { final: string; salvaEm: string } | null; servidor: boolean }[]; emUso: { texto: unknown } };
    expect(estado.provedores.find((p) => p.id === 'deepseek')).toMatchObject({ veiculo: { final: CHAVE.slice(-4) }, servidor: true });
    expect(estado.provedores.find((p) => p.id === 'gemini')).toMatchObject({ veiculo: null, servidor: false });
    expect(estado.emUso.texto).toEqual({ provedor: 'deepseek', origem: 'veiculo' });
    // O evento diz quem salvou, nunca a chave.
    const ev = await env.DB.prepare("SELECT payload_json FROM eventos WHERE tenant_id = ? AND tipo = 'chave_ia.salva'").bind(v.t).first<{ payload_json: string }>();
    expect(ev!.payload_json).not.toContain(CHAVE);
  });

  it('chave recusada pelo provedor, ou sem resposta, não é gravada', async () => {
    const v = await veiculo();
    conferencia = 401;
    const recusada = await v.salvar('deepseek');
    expect(recusada.status).toBe(422);
    expect(await recusada.json()).toMatchObject({ code: 'chave_recusada' });
    conferencia = 500;
    const fora = await v.salvar('anthropic');
    expect(fora.status).toBe(502);
    expect((await fora.text())).not.toContain(CHAVE);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM chaves_ia WHERE tenant_id = ?').bind(v.t).first<{ n: number }>())!.n).toBe(0);
    // Curta demais (os 4 últimos diriam demais) nem vai ao provedor.
    pedidos = [];
    expect((await v.salvar('deepseek', CHAVE.slice(0, 4))).status).toBe(400);
    expect(pedidos).toHaveLength(0);
  });

  it('remover apaga a chave do veículo; provedor desconhecido dá 404', async () => {
    const v = await veiculo();
    await v.salvar('kie');
    expect(pedidos[0].url).toBe('https://kie.example/api/v1/chat/credit');
    const del = await req(`${v.url}/kie`, { method: 'DELETE', cookie: v.s.cookie });
    expect(del.status).toBe(200);
    expect(await env.DB.prepare('SELECT 1 FROM chaves_ia WHERE tenant_id = ?').bind(v.t).first()).toBeNull();
    expect((await v.salvar('openai')).status).toBe(404);
  });

  it('fal: o status de um pedido que não existe confere a chave (404 aceita, 401 recusa)', async () => {
    const v = await veiculo();
    conferencia = 404;
    expect((await v.salvar('fal')).status).toBe(200);
    expect(pedidos[0].url).toBe('https://fal.example/xai/grok-imagine-image/requests/00000000-0000-0000-0000-000000000000/status');
    expect(pedidos[0].headers.get('authorization')).toBe(`Key ${CHAVE}`);
    conferencia = 403;
    expect((await v.salvar('fal', `${CHAVE}-nova`)).status).toBe(422);
  });
});

describe('quem pode', () => {
  it('só o admin vê e muda; outro veículo responde 404', async () => {
    const ed = await veiculo('editor');
    expect((await req(ed.url, { cookie: ed.s.cookie })).status).toBe(403);
    expect((await ed.salvar('deepseek')).status).toBe(403);
    expect((await req(ed.url, { method: 'PATCH', cookie: ed.s.cookie, body: { texto: 'gemini' } })).status).toBe(403);
    expect((await req(`${ed.url}/deepseek`, { method: 'DELETE', cookie: ed.s.cookie })).status).toBe(403);

    const a = await veiculo();
    const b = await veiculo();
    expect((await req(b.url, { cookie: a.s.cookie })).status).toBe(404);
    expect((await req(`${b.url}/deepseek`, { method: 'PUT', cookie: a.s.cookie, body: { chave: CHAVE } })).status).toBe(404);
    expect(await env.DB.prepare('SELECT 1 FROM chaves_ia WHERE tenant_id = ?').bind(b.t).first()).toBeNull();
  });
});

describe('ordem de preferência', () => {
  it('sem chave do veículo, a do servidor, igual a hoje; com ela, a do veículo, e o custo fica marcado como dele', async () => {
    const v = await veiculo();
    const onde = { tenantId: v.t, funcao: 'post' as const };
    await chamarTexto(env, onde, 's', 'u');
    expect(pedidos.at(-1)!.headers.get('authorization')).toBe(`Bearer ${chaveDoServidor}`);
    expect(JSON.parse(pedidos.at(-1)!.corpo)).toMatchObject({ model: 'deepseek-chat' });
    await v.salvar('deepseek');
    await chamarTexto(env, onde, 's', 'u');
    expect(pedidos.at(-1)!.headers.get('authorization')).toBe(`Bearer ${CHAVE}`);
    const { results } = await env.DB.prepare('SELECT chave FROM uso_modelo WHERE tenant_id = ? ORDER BY id').bind(v.t).all<{ chave: string }>();
    expect(results.map((r) => r.chave)).toEqual(['servidor', 'veiculo']);
    const p = await painelDeUso(env, 1);
    expect(p.totais.custoVeiculoUsd).toBeGreaterThan(0);
    expect(p.totais.custoVeiculoUsd).toBeLessThan(p.totais.custoUsd);
    expect(p.ultimas[0].chave).toBe('veiculo');
  });

  it('veículo que não existe usa as do servidor; sem nenhuma, a função fica desligada e a produção barra na porta', async () => {
    expect((await chavesDoVeiculo(env, 'nao-existe')).texto).toMatchObject({ provedor: 'deepseek', origem: 'servidor' });
    expect((await chavesDoVeiculo(env, 'nao-existe')).segunda).toBeNull();
    (env as unknown as Record<string, unknown>).ANTHROPIC_API_KEY = crypto.randomUUID();
    expect((await chavesDoVeiculo(env, 'nao-existe')).segunda).toMatchObject({ origem: 'servidor' });

    const v = await veiculo();
    delete (env as unknown as Record<string, unknown>).DEEPSEEK_API_KEY;
    expect((await chavesDoVeiculo(env, v.t)).texto).toBeNull();
    const { pautaId } = await seedPauta(v.t);
    const res = await req(`/api/t/${v.t}/pautas/${pautaId}/produzir`, { cookie: v.s.cookie, body: { formato: 'post' } });
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ code: 'sem_chave_texto' });
    expect((await env.DB.prepare('SELECT status FROM pautas WHERE id = ?').bind(pautaId).first<{ status: string }>())!.status).toBe('sugerida');
    // A chave do veículo liga de novo, sem a do servidor.
    await v.salvar('gemini');
    expect((await chavesDoVeiculo(env, v.t)).texto).toMatchObject({ provedor: 'gemini', origem: 'veiculo' });
  });

  it('a chave do veículo vem antes da do servidor, mesmo de outro provedor; entre as do veículo, a escolhida', async () => {
    const v = await veiculo();
    await v.salvar('gemini');
    expect((await chavesDoVeiculo(env, v.t)).texto).toMatchObject({ provedor: 'gemini', origem: 'veiculo' });
    await v.salvar('deepseek');
    expect((await chavesDoVeiculo(env, v.t)).texto).toMatchObject({ provedor: 'deepseek', origem: 'veiculo' });
    expect((await req(v.url, { method: 'PATCH', cookie: v.s.cookie, body: { texto: 'gemini' } })).status).toBe(200);
    expect((await chavesDoVeiculo(env, v.t)).texto).toMatchObject({ provedor: 'gemini', origem: 'veiculo' });
  });
});

describe('conferência sem chave de texto', () => {
  it('responde o motivo antes do streaming, e não "parou no meio"', async () => {
    const t = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO tenants (id, slug, nome, modo, marca_json, plano) VALUES (?, ?, 'Cartas', 'autoral', '{}', 'cortesia')").bind(t, `a-${t.slice(0, 8)}`).run();
    const s = await cadastrar();
    await seedMembro(t, s.userId, 'admin');
    const { texto } = await (await req(`/api/t/${t}/textos`, { cookie: s.cookie, body: { titulo: 'Contratos', texto: 'A Câmara renovou 12 contratos.' } })).json<{ texto: { id: string } }>();
    delete (env as unknown as Record<string, unknown>).DEEPSEEK_API_KEY;
    for (const headers of [{}, { accept: 'application/x-ndjson' }] as Record<string, string>[]) {
      const res = await req(`/api/t/${t}/textos/${texto.id}/conferir`, { cookie: s.cookie, body: {}, headers });
      expect(res.status).toBe(402);
      expect(await res.json()).toMatchObject({ code: 'sem_chave_texto' });
    }
  });
});

describe('escolha do provedor', () => {
  it('só provedor com chave; fora da lista, 400', async () => {
    const v = await veiculo();
    const semChave = await req(v.url, { method: 'PATCH', cookie: v.s.cookie, body: { texto: 'gemini' } });
    expect(semChave.status).toBe(409);
    expect(await semChave.json()).toMatchObject({ code: 'sem_chave' });
    expect((await req(v.url, { method: 'PATCH', cookie: v.s.cookie, body: { texto: 'anthropic' } })).status).toBe(400);
    expect((await req(v.url, { method: 'PATCH', cookie: v.s.cookie, body: { imagem: 'deepseek' } })).status).toBe(400);
    // Com a chave do servidor, pode escolher sem colar a dele.
    (env as unknown as Record<string, unknown>).GEMINI_API_KEY = crypto.randomUUID();
    const ok = await req(v.url, { method: 'PATCH', cookie: v.s.cookie, body: { texto: 'gemini' } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ escolha: { texto: 'gemini', imagem: 'kie' }, emUso: { texto: { provedor: 'gemini', origem: 'servidor' } } });
  });
});

describe('Gemini', () => {
  it('pelo endereço de teste, com a chave só no cabeçalho, em modo JSON, e o custo conta o raciocínio', async () => {
    const v = await veiculo();
    await v.salvar('gemini');
    expect(pedidos[0].url).toBe('https://gemini.example/v1beta/models?pageSize=1');
    expect(pedidos[0].headers.get('x-goog-api-key')).toBe(CHAVE);
    await req(v.url, { method: 'PATCH', cookie: v.s.cookie, body: { texto: 'gemini' } });
    const r = await chamarTexto(env, { tenantId: v.t, funcao: 'conferencia' }, 'sistema', 'pedido', 0);
    expect(r).toMatchObject({ json: { ok: 'gemini' }, provedor: 'gemini', modelo: 'gemini-3.5-flash-lite' });
    const p = pedidos.at(-1)!;
    expect(p.url).toBe('https://gemini.example/v1beta/models/gemini-3.5-flash-lite:generateContent');
    expect(p.url).not.toContain(CHAVE);
    expect(p.headers.get('x-goog-api-key')).toBe(CHAVE);
    expect(JSON.parse(p.corpo)).toMatchObject({ systemInstruction: { parts: [{ text: 'sistema' }] }, contents: [{ role: 'user', parts: [{ text: 'pedido' }] }], generationConfig: { responseMimeType: 'application/json' } });
    const linha = await env.DB.prepare('SELECT * FROM uso_modelo WHERE tenant_id = ?').bind(v.t).first<Record<string, unknown>>();
    expect(linha).toMatchObject({ modelo: 'gemini-3.5-flash-lite', entrada: 600, saida: 150, cache_lido: 400, chave: 'veiculo' });
    expect(linha!.custo_usd).toBeCloseTo((600 * 0.3 + 400 * 0.03 + 150 * 2.5) / 1e6, 12);
  });

  it('resposta bloqueada ou fora do JSON é erro (quem chama não aceita calado)', async () => {
    (env as unknown as Record<string, unknown>).GEMINI_API_KEY = crypto.randomUUID();
    delete (env as unknown as Record<string, unknown>).DEEPSEEK_API_KEY;
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ promptFeedback: { blockReason: 'SAFETY' }, usageMetadata: { promptTokenCount: 10 } })));
    await expect(chamarTexto(env, { tenantId: 'nao-existe', funcao: 'post' }, 's', 'u')).rejects.toThrow(/bloqueou/);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ candidates: [{ content: { parts: [{ text: 'não é json' }] } }] })));
    await expect(chamarTexto(env, { tenantId: 'nao-existe', funcao: 'post' }, 's', 'u')).rejects.toThrow();
  });
});

describe('instalação própria', () => {
  const criar = (cookie: string, nome: string) => req('/api/tenants', { cookie, body: { nome, uf: 'SP', municipioIbge: '3518701', municipioNome: 'Guarujá' } });
  const planoDe = async (id: string) => (await env.DB.prepare('SELECT plano FROM tenants WHERE id = ?').bind(id).first<{ plano: string }>())!.plano;

  it('com INSTALACAO_PROPRIA=1, veículo novo nasce em cortesia e a aba Plano sabe; sem ela, em teste', async () => {
    const s = await cadastrar();
    const antes = await criar(s.cookie, crypto.randomUUID());
    expect(await planoDe((await antes.json<{ id: string }>()).id)).toBe('teste');
    expect(await (await req('/api/instalacao')).json()).toEqual({ propria: false });

    (env as unknown as Record<string, unknown>).INSTALACAO_PROPRIA = '1';
    const depois = await criar(s.cookie, crypto.randomUUID());
    const { id } = await depois.json<{ id: string }>();
    expect(await planoDe(id)).toBe('cortesia');
    expect(await (await req('/api/instalacao')).json()).toEqual({ propria: true });
    const plano = await (await req(`/api/t/${id}/plano`, { cookie: s.cookie })).json<{ instalacaoPropria: boolean; limite: number | null }>();
    expect(plano).toMatchObject({ instalacaoPropria: true, limite: null });
  });
});
