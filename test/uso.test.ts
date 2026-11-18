// Consumo dos modelos: a conferência registra tokens e custo por veículo, o painel soma por veículo e por função, só o dono da
// plataforma enxerga, e falha ao registrar não derruba quem chamou. DeepSeek é fetch simulado.
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chamarTexto } from '../src/lib/texto';
import { painelDeUso, registrarUso } from '../src/lib/uso';
import { cadastrar, req } from './helpers';

const respostaDeepseek = (conteudo: unknown) => new Response(JSON.stringify({
  choices: [{ message: { content: JSON.stringify(conteudo) } }],
  usage: { prompt_tokens: 1000, completion_tokens: 200, prompt_cache_hit_tokens: 400 },
}), { headers: { 'content-type': 'application/json' } });

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM uso_modelo').run();
  vi.stubGlobal('fetch', vi.fn(async () => respostaDeepseek({ ok: true })));
});
afterEach(() => { vi.unstubAllGlobals(); delete (env as { ADMIN_USER_IDS?: string }).ADMIN_USER_IDS; });

describe('registro', () => {
  it('a chamada grava tokens e custo, com o veículo e a função', async () => {
    const r = await chamarTexto(env, { tenantId: 't1', funcao: 'conferencia' }, 'sistema', 'pedido');
    const linha = await env.DB.prepare('SELECT * FROM uso_modelo').first<Record<string, unknown>>();
    expect(linha).toMatchObject({ tenant_id: 't1', funcao: 'conferencia', modelo: 'deepseek-chat', entrada: 600, saida: 200, cache_lido: 400 });
    expect(linha!.custo_usd).toBeCloseTo(r.custoUsd, 10);
    expect(r.custoUsd).toBeGreaterThan(0);
  });

  it('resposta fora do formato já foi paga: conta, mesmo com o erro', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'não é json' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }))));
    await expect(chamarTexto(env, { tenantId: 't1', funcao: 'post' }, 's', 'u')).rejects.toThrow();
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM uso_modelo').first<{ n: number }>())!.n).toBe(1);
  });

  it('falha ao registrar não derruba quem chamou', async () => {
    const fora = { ...env, DB: { prepare: () => { throw new Error('banco fora'); } } } as unknown as typeof env;
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(registrarUso(fora, { tenantId: 't1', funcao: 'post' }, { modelo: 'x', custoUsd: 1 })).resolves.toBeUndefined();
    expect(erro).toHaveBeenCalled();
    erro.mockRestore();
  });
});

describe('painel', () => {
  it('soma por veículo, por função e por dia, e veículo apagado continua na conta', async () => {
    await registrarUso(env, { tenantId: 'a', funcao: 'conferencia' }, { modelo: 'm', entrada: 100, saida: 10, custoUsd: 0.5 });
    await registrarUso(env, { tenantId: 'a', funcao: 'post' }, { modelo: 'm', entrada: 50, saida: 5, cacheLido: 5, custoUsd: 0.25 });
    await registrarUso(env, { tenantId: 'apagado', funcao: 'conferencia' }, { modelo: 'm', entrada: 1, custoUsd: 1 });
    const p = await painelDeUso(env, 7);
    expect(p.totais).toMatchObject({ chamadas: 3, entrada: 151, saida: 15, cache: 5, tokens: 171, custoUsd: 1.75 });
    expect(p.veiculos.map((v) => [v.nome, v.chamadas, v.custoUsd])).toEqual([['apagado', 1, 1], ['a', 2, 0.75]]);
    expect(p.veiculos[0].plano).toBeNull();
    expect(p.funcoes.map((f) => [f.funcao, f.chamadas])).toEqual([['conferencia', 2], ['post', 1]]);
    expect(p.porDia).toHaveLength(1);
    expect(p.ultimas[0]).toMatchObject({ veiculo: 'apagado', funcao: 'conferencia' });
  });

  it('o que veio antes do período fica de fora; hoje conta no horário de Brasília', async () => {
    await env.DB.prepare("INSERT INTO uso_modelo (tenant_id, funcao, modelo, custo_usd, created_at) VALUES ('a', 'post', 'm', 9, datetime('now', '-40 days'))").run();
    await registrarUso(env, { tenantId: 'a', funcao: 'post' }, { modelo: 'm', custoUsd: 1 });
    expect((await painelDeUso(env, 30)).totais.custoUsd).toBe(1);
    expect((await painelDeUso(env, 1)).totais.chamadas).toBe(1);
  });

  it('sem chamada nenhuma, zero e listas vazias', async () => {
    const p = await painelDeUso(env, 1);
    expect(p.totais).toMatchObject({ chamadas: 0, tokens: 0, custoUsd: 0 });
    expect(p.veiculos).toEqual([]);
    expect(p.registrandoDesde).toBeNull();
  });
});

describe('quem vê', () => {
  it('só quem está em ADMIN_USER_IDS; para os outros a rota não existe', async () => {
    const s = await cadastrar('Alguém');
    expect((await req('/api/admin/uso', { cookie: s.cookie })).status).toBe(404);
    expect((await (await req('/api/me', { cookie: s.cookie })).json<{ adminPlataforma: boolean }>()).adminPlataforma).toBe(false);
    (env as { ADMIN_USER_IDS?: string }).ADMIN_USER_IDS = s.userId;
    const ok = await req('/api/admin/uso?dias=7', { cookie: s.cookie });
    expect(ok.status).toBe(200);
    expect((await ok.json<{ dias: number }>()).dias).toBe(7);
    expect((await (await req('/api/me', { cookie: s.cookie })).json<{ adminPlataforma: boolean }>()).adminPlataforma).toBe(true);
  });

  it('sem sessão: 401; período fora da lista cai em hoje', async () => {
    expect((await req('/api/admin/uso')).status).toBe(401);
    const s = await cadastrar('Dona');
    (env as { ADMIN_USER_IDS?: string }).ADMIN_USER_IDS = s.userId;
    expect((await (await req("/api/admin/uso?dias=1'%20OR%201=1", { cookie: s.cookie })).json<{ dias: number }>()).dias).toBe(1);
  });
});
