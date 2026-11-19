// Model usage: the check records tokens and cost per outlet, the panel sums per outlet and per feature, only the
// platform owner sees it, and a failure to record does not bring down the caller. DeepSeek is a simulated fetch.
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deepseekCost } from '../src/lib/deepseek';
import { callText } from '../src/lib/textModel';
import { panelUsage, recordUsage } from '../src/lib/usage';
import { register, req } from './helpers';

const deepseekAnswer = (content: unknown) => new Response(JSON.stringify({
  choices: [{ message: { content: JSON.stringify(content) } }],
  usage: { prompt_tokens: 1000, completion_tokens: 200, prompt_cache_hit_tokens: 400 },
}), { headers: { 'content-type': 'application/json' } });

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM uso_modelo').run();
  vi.stubGlobal('fetch', vi.fn(async () => deepseekAnswer({ ok: true })));
});
afterEach(() => { vi.unstubAllGlobals(); delete (env as { ADMIN_USER_IDS?: string }).ADMIN_USER_IDS; });

describe('logging', () => {
  it('the call records tokens and cost, with the outlet and the function', async () => {
    const r = await callText(env, { tenantId: 't1', funcao: 'conferencia' }, 'sistema', 'pedido');
    const line = await env.DB.prepare('SELECT * FROM uso_modelo').first<Record<string, unknown>>();
    expect(line).toMatchObject({ tenant_id: 't1', funcao: 'conferencia', modelo: 'deepseek-flash', entrada: 600, saida: 200, cache_lido: 400 });
    expect(line!.custo_usd).toBeCloseTo(r.custoUsd, 10);
    expect(r.custoUsd).toBeGreaterThan(0);
  });

  it("the request goes with the model's current name and reasoning turned off", async () => {
    await callText(env, { tenantId: 't1', funcao: 'conferencia' }, 'sistema', 'pedido', 0.2);
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]!.body));
    expect(body).toMatchObject({ model: 'deepseek-flash', thinking: { type: 'disabled' }, response_format: { type: 'json_object' }, temperature: 0.2 });
  });

  it('list price off-peak; double Monday to Friday, 01h–04h and 06h–10h UTC', () => {
    const million = { entrada: 1_000_000, cacheLido: 1_000_000, saida: 1_000_000 };   // 0,15 + 0,003 + 0,60
    const wednesday = (hour: string) => deepseekCost(million, new Date(`2026-11-11T${hour}:00Z`));
    for (const hour of ['00:59', '04:00', '05:59', '10:00', '15:00']) expect(wednesday(hour), hour).toBeCloseTo(0.753, 9);
    for (const hour of ['01:00', '03:59', '06:00', '09:59']) expect(wednesday(hour), hour).toBeCloseTo(1.506, 9);
    expect(deepseekCost(million, new Date('2026-11-14T07:00:00Z')), 'sábado').toBeCloseTo(0.753, 9);
    expect(deepseekCost({ entrada: 1000, saida: 500 }, new Date('2026-11-14T07:00:00Z'))).toBeCloseTo(0.00045, 9);
  });

  it('a response outside the format was already paid for: it counts, even with the error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'não é json' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }))));
    await expect(callText(env, { tenantId: 't1', funcao: 'post' }, 's', 'u')).rejects.toThrow();
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM uso_modelo').first<{ n: number }>())!.n).toBe(1);
  });

  it("failure to record doesn't break the caller", async () => {
    const outside = { ...env, DB: { prepare: () => { throw new Error('banco fora'); } } } as unknown as typeof env;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(recordUsage(outside, { tenantId: 't1', funcao: 'post' }, { modelo: 'x', custoUsd: 1 })).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('dashboard', () => {
  it('sums by outlet, by function and by day, and a deleted outlet stays in the count', async () => {
    await recordUsage(env, { tenantId: 'a', funcao: 'conferencia' }, { modelo: 'm', entrada: 100, saida: 10, custoUsd: 0.5 });
    await recordUsage(env, { tenantId: 'a', funcao: 'post' }, { modelo: 'm', entrada: 50, saida: 5, cacheLido: 5, custoUsd: 0.25 });
    await recordUsage(env, { tenantId: 'apagado', funcao: 'conferencia' }, { modelo: 'm', entrada: 1, custoUsd: 1 });
    const p = await panelUsage(env, 7);
    expect(p.totais).toMatchObject({ chamadas: 3, entrada: 151, saida: 15, cache: 5, tokens: 171, custoUsd: 1.75 });
    expect(p.veiculos.map((v) => [v.nome, v.chamadas, v.custoUsd])).toEqual([['apagado', 1, 1], ['a', 2, 0.75]]);
    expect(p.veiculos[0].plano).toBeNull();
    expect(p.funcoes.map((f) => [f.funcao, f.chamadas])).toEqual([['conferencia', 2], ['post', 1]]);
    expect(p.porDia).toHaveLength(1);
    expect(p.ultimas[0]).toMatchObject({ veiculo: 'apagado', funcao: 'conferencia' });
  });

  it('anything before the period is left out; today counts on Brasília time', async () => {
    await env.DB.prepare("INSERT INTO uso_modelo (tenant_id, funcao, modelo, custo_usd, created_at) VALUES ('a', 'post', 'm', 9, datetime('now', '-40 days'))").run();
    await recordUsage(env, { tenantId: 'a', funcao: 'post' }, { modelo: 'm', custoUsd: 1 });
    expect((await panelUsage(env, 30)).totais.custoUsd).toBe(1);
    expect((await panelUsage(env, 1)).totais.chamadas).toBe(1);
  });

  it('no calls at all: zeros and empty lists', async () => {
    const p = await panelUsage(env, 1);
    expect(p.totais).toMatchObject({ chamadas: 0, tokens: 0, custoUsd: 0 });
    expect(p.veiculos).toEqual([]);
    expect(p.registrandoDesde).toBeNull();
  });
});

describe('who can see', () => {
  it("only those in ADMIN_USER_IDS; for others the route doesn't exist", async () => {
    const s = await register('Alguém');
    expect((await req('/api/admin/uso', { cookie: s.cookie })).status).toBe(404);
    expect((await (await req('/api/me', { cookie: s.cookie })).json<{ adminPlataforma: boolean }>()).adminPlataforma).toBe(false);
    (env as { ADMIN_USER_IDS?: string }).ADMIN_USER_IDS = s.userId;
    const ok = await req('/api/admin/uso?dias=7', { cookie: s.cookie });
    expect(ok.status).toBe(200);
    expect((await ok.json<{ dias: number }>()).dias).toBe(7);
    expect((await (await req('/api/me', { cookie: s.cookie })).json<{ adminPlataforma: boolean }>()).adminPlataforma).toBe(true);
  });

  it('no session: 401; a period outside the list falls back to today', async () => {
    expect((await req('/api/admin/uso')).status).toBe(401);
    const s = await register('Dona');
    (env as { ADMIN_USER_IDS?: string }).ADMIN_USER_IDS = s.userId;
    expect((await (await req("/api/admin/uso?dias=1'%20OR%201=1", { cookie: s.cookie })).json<{ dias: number }>()).dias).toBe(1);
  });
});
