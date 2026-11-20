// AI keys per outlet: stored encrypted, never returned, admin only, 404 across outlets, the order of preference (the
// outlet's, the server's, off), a refused key is not stored, Gemini through the test address, the separate cost in the
// panel and the self-hosted mode. Providers simulated through fetch (no real key).
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptToken } from '../src/lib/crypto';
import { fromOutletKeys } from '../src/lib/providers';
import { fromKeyLink } from '../src/lib/providersTable';
import { callSecond } from '../src/lib/secondOpinion';
import { callText } from '../src/lib/textModel';
import { panelUsage } from '../src/lib/usage';
import { register, req, seedMember, seedLead, seedTenant } from './helpers';

const KEY = 'sk-veiculo-0123456789-abcd';
type RequestEntry = { url: string; headers: Headers; corpo: string };
let requests: RequestEntry[] = [];
/** Each provider's response by URL; `status` changes the key check's one. */
let check = 200;

const answerText = (url: string) => url.includes('generateContent')
  ? Response.json({ candidates: [{ content: { parts: [{ text: '{"ok":"gemini"}' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 100, cachedContentTokenCount: 400, thoughtsTokenCount: 50 } })
  : url.includes('/anthropic/v1/messages')
    ? Response.json({ id: 'msg_kie', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null, content: [{ type: 'text', text: '{"afirmacoes":[]}' }], usage: { input_tokens: 300, output_tokens: 90, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 } })
    : url.includes('gemini-3-8-flash-openai')
      ? Response.json({ choices: [{ message: { content: '{"ok":"kie"}' } }], usage: { prompt_tokens: 1000, completion_tokens: 120, prompt_tokens_details: { cached_tokens: 200 } } })
      : Response.json({ choices: [{ message: { content: '{"ok":"deepseek"}' } }], usage: { prompt_tokens: 1000, completion_tokens: 200 } });

beforeEach(async () => {
  requests = [];
  check = 200;
  await env.DB.prepare('DELETE FROM uso_modelo').run();
  vi.stubGlobal('fetch', vi.fn(async (u: RequestInfo | URL, init?: RequestInit) => {
    const url = String(u);
    requests.push({ url, headers: new Headers(init?.headers), corpo: String(init?.body ?? '') });
    if (/\/models(\?|$)|chat\/credit|\/requests\/.+\/status/.test(url)) return new Response('{"code":200}', { status: check });
    return answerText(url);
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  const e = env as unknown as Record<string, unknown>;
  e.DEEPSEEK_API_KEY = 'sk-teste';
  for (const k of ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'KIE_API_KEY', 'INSTALACAO_PROPRIA', 'ADMIN_USER_IDS']) delete e[k];
});

async function outlet(role: 'admin' | 'editor' = 'admin') {
  const t = await seedTenant();
  const s = await register();
  await seedMember(t, s.userId, role);
  const url = `/api/t/${t}/chaves-ia`;
  const save = (p: string, key = KEY) => req(`${url}/${p}`, { method: 'PUT', cookie: s.cookie, body: { chave: key } });
  return { t, s, url, salvar: save };
}

describe('store the key', () => {
  it('stores it encrypted, checked with the provider, and the key never comes back in any response', async () => {
    const v = await outlet();
    const res = await v.salvar('deepseek');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain(KEY);
    expect(body).not.toContain(KEY.slice(0, -4));
    const line = await env.DB.prepare('SELECT * FROM chaves_ia WHERE tenant_id = ?').bind(v.t).first<Record<string, string>>();
    expect(line).toMatchObject({ provedor: 'deepseek', final: 'abcd', salva_por: v.s.userId });
    expect(line!.chave_enc).toMatch(/^v1\./);
    expect(line!.chave_enc).not.toContain(KEY);
    expect(await decryptToken(env, line!.chave_enc)).toBe(KEY);
    // The check was a no-cost call (the model list), with the outlet's key.
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toMatch(/\/models$/);
    expect(requests[0].headers.get('authorization')).toBe(`Bearer ${KEY}`);

    const get = await req(v.url, { cookie: v.s.cookie });
    const text = await get.text();
    expect(text).not.toContain(KEY);
    const state = JSON.parse(text) as { provedores: { id: string; veiculo: { final: string; salvaEm: string } | null; servidor: boolean }[]; emUso: { texto: unknown } };
    expect(state.provedores.find((p) => p.id === 'deepseek')).toMatchObject({ veiculo: { final: 'abcd' }, servidor: true });
    expect(state.provedores.find((p) => p.id === 'gemini')).toMatchObject({ veiculo: null, servidor: false });
    expect(state.emUso.texto).toEqual({ provedor: 'deepseek', origem: 'veiculo' });
    // The event says who saved, never the key.
    const ev = await env.DB.prepare("SELECT payload_json FROM eventos WHERE tenant_id = ? AND tipo = 'chave_ia.salva'").bind(v.t).first<{ payload_json: string }>();
    expect(ev!.payload_json).not.toContain(KEY);
  });

  it("key refused by the provider, or with no response, isn't stored", async () => {
    const v = await outlet();
    check = 401;
    const refused = await v.salvar('deepseek');
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({ code: 'chave_recusada' });
    check = 500;
    const outside = await v.salvar('anthropic');
    expect(outside.status).toBe(502);
    expect((await outside.text())).not.toContain(KEY);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM chaves_ia WHERE tenant_id = ?').bind(v.t).first<{ n: number }>())!.n).toBe(0);
    // Too short (the last 4 would say too much): it does not even go to the provider.
    requests = [];
    expect((await v.salvar('deepseek', 'sk-123')).status).toBe(400);
    expect(requests).toHaveLength(0);
  });

  it("removing deletes the outlet's key; unknown provider gives 404", async () => {
    const v = await outlet();
    await v.salvar('kie');
    expect(requests[0].url).toBe('https://kie.example/api/v1/chat/credit');
    const del = await req(`${v.url}/kie`, { method: 'DELETE', cookie: v.s.cookie });
    expect(del.status).toBe(200);
    expect(await env.DB.prepare('SELECT 1 FROM chaves_ia WHERE tenant_id = ?').bind(v.t).first()).toBeNull();
    expect((await v.salvar('openai')).status).toBe(404);
  });

  it("fal: the status of a request that doesn't exist checks the key (404 accepts, 401 refuses)", async () => {
    const v = await outlet();
    check = 404;
    expect((await v.salvar('fal')).status).toBe(200);
    expect(requests[0].url).toBe('https://fal.example/xai/grok-imagine-image/requests/00000000-0000-0000-0000-000000000000/status');
    expect(requests[0].headers.get('authorization')).toBe(`Key ${KEY}`);
    check = 403;
    expect((await v.salvar('fal', `${KEY}-nova`)).status).toBe(422);
  });
});

describe('who can', () => {
  it('only admin sees and changes; another outlet responds 404', async () => {
    const ed = await outlet('editor');
    expect((await req(ed.url, { cookie: ed.s.cookie })).status).toBe(403);
    expect((await ed.salvar('deepseek')).status).toBe(403);
    expect((await req(ed.url, { method: 'PATCH', cookie: ed.s.cookie, body: { texto: 'gemini' } })).status).toBe(403);
    expect((await req(`${ed.url}/deepseek`, { method: 'DELETE', cookie: ed.s.cookie })).status).toBe(403);

    const a = await outlet();
    const b = await outlet();
    expect((await req(b.url, { cookie: a.s.cookie })).status).toBe(404);
    expect((await req(`${b.url}/deepseek`, { method: 'PUT', cookie: a.s.cookie, body: { chave: KEY } })).status).toBe(404);
    expect(await env.DB.prepare('SELECT 1 FROM chaves_ia WHERE tenant_id = ?').bind(b.t).first()).toBeNull();
  });
});

describe('order of preference', () => {
  it("without the outlet's key, the server's, same as today; with it, the outlet's, and the cost is marked as its", async () => {
    const v = await outlet();
    const where = { tenantId: v.t, funcao: 'post' as const };
    await callText(env, where, 's', 'u');
    expect(requests.at(-1)!.headers.get('authorization')).toBe('Bearer sk-teste');
    expect(JSON.parse(requests.at(-1)!.corpo)).toMatchObject({ model: 'deepseek-flash' });
    await v.salvar('deepseek');
    await callText(env, where, 's', 'u');
    expect(requests.at(-1)!.headers.get('authorization')).toBe(`Bearer ${KEY}`);
    const { results } = await env.DB.prepare('SELECT chave FROM uso_modelo WHERE tenant_id = ? ORDER BY id').bind(v.t).all<{ chave: string }>();
    expect(results.map((r) => r.chave)).toEqual(['servidor', 'veiculo']);
    const p = await panelUsage(env, 1);
    expect(p.totais.custoVeiculoUsd).toBeGreaterThan(0);
    expect(p.totais.custoVeiculoUsd).toBeLessThan(p.totais.custoUsd);
    expect(p.ultimas[0].chave).toBe('veiculo');
  });

  it("outlet that doesn't exist uses the server's; with none, the function stays off and production blocks at the door", async () => {
    expect((await fromOutletKeys(env, 'nao-existe')).texto).toMatchObject({ provedor: 'deepseek', origem: 'servidor' });
    expect((await fromOutletKeys(env, 'nao-existe')).segunda).toBeNull();
    (env as unknown as Record<string, unknown>).ANTHROPIC_API_KEY = 'sk-ant-servidor';
    expect((await fromOutletKeys(env, 'nao-existe')).segunda).toMatchObject({ origem: 'servidor' });

    const v = await outlet();
    delete (env as unknown as Record<string, unknown>).DEEPSEEK_API_KEY;
    expect((await fromOutletKeys(env, v.t)).texto).toBeNull();
    const { pautaId: leadId } = await seedLead(v.t);
    const res = await req(`/api/t/${v.t}/pautas/${leadId}/produzir`, { cookie: v.s.cookie, body: { formato: 'post' } });
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ code: 'sem_chave_texto' });
    expect((await env.DB.prepare('SELECT status FROM pautas WHERE id = ?').bind(leadId).first<{ status: string }>())!.status).toBe('sugerida');
    // The outlet's key turns it on again, without the server's.
    await v.salvar('gemini');
    expect((await fromOutletKeys(env, v.t)).texto).toMatchObject({ provedor: 'gemini', origem: 'veiculo' });
  });

  it("the outlet's key comes before the server's, even from another provider; among the outlet's, the chosen one", async () => {
    const v = await outlet();
    await v.salvar('gemini');
    expect((await fromOutletKeys(env, v.t)).texto).toMatchObject({ provedor: 'gemini', origem: 'veiculo' });
    await v.salvar('deepseek');
    expect((await fromOutletKeys(env, v.t)).texto).toMatchObject({ provedor: 'deepseek', origem: 'veiculo' });
    expect((await req(v.url, { method: 'PATCH', cookie: v.s.cookie, body: { texto: 'gemini' } })).status).toBe(200);
    expect((await fromOutletKeys(env, v.t)).texto).toMatchObject({ provedor: 'gemini', origem: 'veiculo' });
  });
});

describe('check without a text key', () => {
  it('answers the reason before streaming, and not "parou no meio"', async () => {
    const t = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO tenants (id, slug, nome, modo, marca_json, plano) VALUES (?, ?, 'Cartas', 'autoral', '{}', 'cortesia')").bind(t, `a-${t.slice(0, 8)}`).run();
    const s = await register();
    await seedMember(t, s.userId, 'admin');
    const { texto: text } = await (await req(`/api/t/${t}/textos`, { cookie: s.cookie, body: { titulo: 'Contratos', texto: 'A Câmara renovou 12 contratos.' } })).json<{ texto: { id: string } }>();
    delete (env as unknown as Record<string, unknown>).DEEPSEEK_API_KEY;
    for (const headers of [{}, { accept: 'application/x-ndjson' }] as Record<string, string>[]) {
      const res = await req(`/api/t/${t}/textos/${text.id}/conferir`, { cookie: s.cookie, body: {}, headers });
      expect(res.status).toBe(402);
      expect(await res.json()).toMatchObject({ code: 'sem_chave_texto' });
    }
  });
});

describe('provider choice', () => {
  it('only providers with a key; outside the list, 400', async () => {
    const v = await outlet();
    const withoutKey = await req(v.url, { method: 'PATCH', cookie: v.s.cookie, body: { texto: 'gemini' } });
    expect(withoutKey.status).toBe(409);
    expect(await withoutKey.json()).toMatchObject({ code: 'sem_chave' });
    expect((await req(v.url, { method: 'PATCH', cookie: v.s.cookie, body: { texto: 'anthropic' } })).status).toBe(400);
    expect((await req(v.url, { method: 'PATCH', cookie: v.s.cookie, body: { imagem: 'deepseek' } })).status).toBe(400);
    // With the server's key, it can choose without pasting its own.
    (env as unknown as Record<string, unknown>).GEMINI_API_KEY = 'chave-gemini-do-servidor';
    const ok = await req(v.url, { method: 'PATCH', cookie: v.s.cookie, body: { texto: 'gemini' } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ escolha: { texto: 'gemini', segunda: 'anthropic', imagem: 'kie' }, emUso: { texto: { provedor: 'gemini', origem: 'servidor' } } });
  });
});

describe('Kie.ai all-in-one (opt-in)', () => {
  it('exposes the affiliate link with disclosure flag', () => {
    expect(fromKeyLink('kie')).toEqual({ url: 'https://kie.ai?ref=6bb5696952ed37a98d23e2af63cbc03c', afiliado: true });
    expect(fromKeyLink('deepseek').afiliado).toBe(false);
  });

  it('saving a Kie key does NOT switch text or second opinion until the outlet explicitly chooses Kie', async () => {
    const v = await outlet();
    delete (env as unknown as Record<string, unknown>).DEEPSEEK_API_KEY;
    await v.salvar('kie');
    // Kie key is saved for illustrations, but BYOK defaults stay untouched until explicitly opted in.
    const before = await fromOutletKeys(env, v.t);
    expect(before.escolha).toEqual({ texto: 'deepseek', segunda: 'anthropic', imagem: 'kie' });
    expect(before.texto).toBeNull();
    expect(before.segunda).toBeNull();
    expect(before.imagem).toMatchObject({ provedor: 'kie', origem: 'veiculo' });

    // Server KIE_API_KEY also never auto-enables text or second opinion.
    (env as unknown as Record<string, unknown>).KIE_API_KEY = 'kie-do-servidor-0123456789';
    expect((await fromOutletKeys(env, 'nao-existe')).texto).toBeNull();
    expect((await fromOutletKeys(env, 'nao-existe')).segunda).toBeNull();

    // Explicit opt-in switches all three roles to Kie.
    const optIn = await req(v.url, { method: 'PATCH', cookie: v.s.cookie, body: { texto: 'kie', segunda: 'kie', imagem: 'kie' } });
    expect(optIn.status).toBe(200);
    expect(await optIn.json()).toMatchObject({
      escolha: { texto: 'kie', segunda: 'kie', imagem: 'kie' },
      emUso: {
        texto: { provedor: 'kie', origem: 'veiculo' },
        segunda: { provedor: 'kie', origem: 'veiculo' },
        imagem: { provedor: 'kie', origem: 'veiculo' },
      },
    });

    // Switching second opinion back to Anthropic (BYOK) works even without an Anthropic key (turns second opinion off).
    const revert = await req(v.url, { method: 'PATCH', cookie: v.s.cookie, body: { segunda: 'anthropic' } });
    expect(revert.status).toBe(200);
    expect(await revert.json()).toMatchObject({ escolha: { segunda: 'anthropic' }, emUso: { segunda: null } });
  });

  it('requires a Kie key before opting in and rejects invalid segunda values', async () => {
    const v = await outlet();
    expect((await req(v.url, { method: 'PATCH', cookie: v.s.cookie, body: { segunda: 'deepseek' } })).status).toBe(400);
    const noKey = await req(v.url, { method: 'PATCH', cookie: v.s.cookie, body: { texto: 'kie', segunda: 'kie', imagem: 'kie' } });
    expect(noKey.status).toBe(409);
    expect(await noKey.json()).toMatchObject({ code: 'sem_chave' });
  });

  it('routes callText and callSecond through Kie.ai with Bearer auth and records usage', async () => {
    const v = await outlet();
    await v.salvar('kie');
    await req(v.url, { method: 'PATCH', cookie: v.s.cookie, body: { texto: 'kie', segunda: 'kie', imagem: 'kie' } });

    const t = await callText(env, { tenantId: v.t, funcao: 'conferencia' }, 'sistema', 'pedido', 0);
    expect(t).toMatchObject({ json: { ok: 'kie' }, provedor: 'kie', modelo: 'gemini-3-8-flash' });
    const textReq = requests.at(-1)!;
    expect(textReq.url).toBe('https://kie.example/gemini-3-8-flash-openai/v1/chat/completions');
    expect(textReq.headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(textReq.corpo)).toMatchObject({
      messages: [{ role: 'system', content: 'sistema' }, { role: 'user', content: 'pedido' }],
      response_format: { type: 'json_object' },
      stream: false,
    });

    const s = await callSecond(env, { tenantId: v.t, funcao: 'conferencia' }, 'sistema', 'prefixo', 'bloco');
    expect(s.json).toEqual({ afirmacoes: [] });
    const secReq = requests.at(-1)!;
    expect(secReq.url).toBe('https://kie.example/anthropic/v1/messages');
    expect(secReq.headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(secReq.headers.get('anthropic-beta')).toBeNull();

    const { results } = await env.DB.prepare('SELECT modelo, entrada, saida, cache_lido, chave FROM uso_modelo WHERE tenant_id = ? ORDER BY id')
      .bind(v.t).all<Record<string, unknown>>();
    expect(results).toEqual([
      { modelo: 'gemini-3-8-flash', entrada: 800, saida: 120, cache_lido: 200, chave: 'veiculo' },
      { modelo: 'claude-opus-5-5', entrada: 300, saida: 90, cache_lido: 100, chave: 'veiculo' },
    ]);
  });

  it('rejects Kie HTTP 200 soft errors without leaking provider messages', async () => {
    const v = await outlet();
    await v.salvar('kie');
    await req(v.url, { method: 'PATCH', cookie: v.s.cookie, body: { texto: 'kie' } });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code: 402, msg: `insufficient credit for ${KEY}` })));
    await expect(callText(env, { tenantId: v.t, funcao: 'post' }, 's', 'u')).rejects.toThrow('kie text refused: code 402');
  });
});

describe('Gemini', () => {
  it('through the test endpoint, with the key only in the header, in JSON mode, and the cost counts the reasoning', async () => {
    const v = await outlet();
    await v.salvar('gemini');
    expect(requests[0].url).toBe('https://gemini.example/v1beta/models?pageSize=1');
    expect(requests[0].headers.get('x-goog-api-key')).toBe(KEY);
    await req(v.url, { method: 'PATCH', cookie: v.s.cookie, body: { texto: 'gemini' } });
    const r = await callText(env, { tenantId: v.t, funcao: 'conferencia' }, 'sistema', 'pedido', 0);
    expect(r).toMatchObject({ json: { ok: 'gemini' }, provedor: 'gemini', modelo: 'gemini-3.5-flash-lite' });
    const p = requests.at(-1)!;
    expect(p.url).toBe('https://gemini.example/v1beta/models/gemini-3.5-flash-lite:generateContent');
    expect(p.url).not.toContain(KEY);
    expect(p.headers.get('x-goog-api-key')).toBe(KEY);
    expect(JSON.parse(p.corpo)).toMatchObject({ systemInstruction: { parts: [{ text: 'sistema' }] }, contents: [{ role: 'user', parts: [{ text: 'pedido' }] }], generationConfig: { responseMimeType: 'application/json' } });
    const line = await env.DB.prepare('SELECT * FROM uso_modelo WHERE tenant_id = ?').bind(v.t).first<Record<string, unknown>>();
    expect(line).toMatchObject({ modelo: 'gemini-3.5-flash-lite', entrada: 600, saida: 150, cache_lido: 400, chave: 'veiculo' });
    expect(line!.custo_usd).toBeCloseTo((600 * 0.3 + 400 * 0.03 + 150 * 2.5) / 1e6, 12);
  });

  it('blocked or non-JSON response is an error (the caller does not accept silence)', async () => {
    (env as unknown as Record<string, unknown>).GEMINI_API_KEY = 'chave-gemini-do-servidor';
    delete (env as unknown as Record<string, unknown>).DEEPSEEK_API_KEY;
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ promptFeedback: { blockReason: 'SAFETY' }, usageMetadata: { promptTokenCount: 10 } })));
    await expect(callText(env, { tenantId: 'nao-existe', funcao: 'post' }, 's', 'u')).rejects.toThrow(/blocked/);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ candidates: [{ content: { parts: [{ text: 'não é json' }] } }] })));
    await expect(callText(env, { tenantId: 'nao-existe', funcao: 'post' }, 's', 'u')).rejects.toThrow();
  });
});

describe('self-hosted install', () => {
  const create = (cookie: string, name: string) => req('/api/tenants', { cookie, body: { nome: name, uf: 'SP', municipioIbge: '3518701', municipioNome: 'Guarujá' } });
  const planOf = async (id: string) => (await env.DB.prepare('SELECT plano FROM tenants WHERE id = ?').bind(id).first<{ plano: string }>())!.plano;

  it('with INSTALACAO_PROPRIA=1, a new outlet starts on cortesia and the Plan tab knows it; without it, on teste', async () => {
    const s = await register();
    const before = await create(s.cookie, 'Jornal Sem Variável');
    expect(await planOf((await before.json<{ id: string }>()).id)).toBe('teste');
    expect(await (await req('/api/instalacao')).json()).toEqual({ propria: false });

    (env as unknown as Record<string, unknown>).INSTALACAO_PROPRIA = '1';
    const after = await create(s.cookie, 'Jornal Instalado');
    const { id } = await after.json<{ id: string }>();
    expect(await planOf(id)).toBe('cortesia');
    expect(await (await req('/api/instalacao')).json()).toEqual({ propria: true });
    const plan = await (await req(`/api/t/${id}/plano`, { cookie: s.cookie })).json<{ instalacaoPropria: boolean; limite: number | null }>();
    expect(plan).toMatchObject({ instalacaoPropria: true, limite: null });
  });
});
