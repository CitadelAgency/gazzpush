// Cobertura multi-cidade: GET/POST/DELETE areas (papel, IDOR, regras) e a cidade da pauta no GET pautas.
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { cadastrar, req, seedMembro, seedPauta, seedTenant } from './helpers';

async function membro(papel: 'admin' | 'editor' | 'reporter' = 'admin') {
  const s = await cadastrar();
  const t = await seedTenant();
  await seedMembro(t, s.userId, papel);
  return { s, t };
}
const SANTOS = { municipioIbge: '3548500', municipioNome: 'Santos' };
const areas = async (t: string, cookie: string) => (await (await req(`/api/t/${t}/areas`, { cookie })).json<{ areas: { ibge: string; nome: string }[] }>()).areas;

describe('areas: cobertura do veículo', () => {
  it('admin acrescenta Santos (201), de novo é idempotente (200); a lista vem na ordem de entrada', async () => {
    const { s, t } = await membro();
    expect(await areas(t, s.cookie)).toEqual([{ ibge: '3518701', nome: 'Guarujá' }]);
    const r1 = await req(`/api/t/${t}/areas`, { cookie: s.cookie, body: SANTOS });
    expect(r1.status).toBe(201);
    expect(await r1.json()).toEqual({ ibge: '3548500', nome: 'Santos', existia: false });
    const [r2, r3] = await Promise.all([1, 2].map(() => req(`/api/t/${t}/areas`, { cookie: s.cookie, body: SANTOS })));
    expect([r2.status, r3.status]).toEqual([200, 200]);
    expect(await areas(t, s.cookie)).toEqual([{ ibge: '3518701', nome: 'Guarujá' }, { ibge: '3548500', nome: 'Santos' }]);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM tenant_areas WHERE tenant_id = ?').bind(t).first<{ n: number }>();
    expect(n?.n).toBe(2);
  });

  it('valida o código e o nome (400); veículo temático não tem cobertura (409)', async () => {
    const { s, t } = await membro();
    for (const body of [{ municipioIbge: '354850', municipioNome: 'Santos' }, { municipioIbge: '35485000', municipioNome: 'Santos' },
      { municipioIbge: 'abcdefg', municipioNome: 'Santos' }, { municipioIbge: '3548500', municipioNome: 'S' }, { municipioIbge: '3548500' }]) {
      expect((await req(`/api/t/${t}/areas`, { cookie: s.cookie, body })).status, JSON.stringify(body)).toBe(400);
    }
    await env.DB.prepare("UPDATE tenants SET modo = 'tematico' WHERE id = ?").bind(t).run();
    expect((await req(`/api/t/${t}/areas`, { cookie: s.cookie, body: SANTOS })).status).toBe(409);
  });

  it('tirar: sai a cidade (com bairros); a última não sai (409); inexistente 404', async () => {
    const { s, t } = await membro();
    await req(`/api/t/${t}/areas`, { cookie: s.cookie, body: SANTOS });
    await env.DB.prepare("INSERT INTO tenant_areas (tenant_id, municipio_ibge, municipio_nome, bairro) VALUES (?, '3548500', 'Santos', 'Gonzaga')").bind(t).run();
    expect((await req(`/api/t/${t}/areas/3548500`, { method: 'DELETE', cookie: s.cookie })).status).toBe(200);
    expect(await areas(t, s.cookie)).toEqual([{ ibge: '3518701', nome: 'Guarujá' }]);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM tenant_areas WHERE tenant_id = ? AND municipio_ibge = '3548500'").bind(t).first<{ n: number }>())?.n).toBe(0);
    expect((await req(`/api/t/${t}/areas/3518701`, { method: 'DELETE', cookie: s.cookie })).status).toBe(409);
    expect((await req(`/api/t/${t}/areas/3548500`, { method: 'DELETE', cookie: s.cookie })).status).toBe(404);
    expect(await areas(t, s.cookie)).toHaveLength(1);
  });

  it('tirar o município principal: o veículo passa a ter como principal a primeira cidade que ficou (com a UF)', async () => {
    const { s, t } = await membro();
    await req(`/api/t/${t}/areas`, { cookie: s.cookie, body: { municipioIbge: '5208707', municipioNome: 'Goiânia' } });
    expect((await req(`/api/t/${t}/areas/3518701`, { method: 'DELETE', cookie: s.cookie })).status).toBe(200);
    expect(await env.DB.prepare('SELECT municipio_ibge, uf FROM tenants WHERE id = ?').bind(t).first()).toEqual({ municipio_ibge: '5208707', uf: 'GO' });
    const me = await (await req('/api/me', { cookie: s.cookie })).json<{ tenants: { id: string; municipio: string; uf: string }[] }>();
    expect(me.tenants.find((x) => x.id === t)).toMatchObject({ municipio: 'Goiânia', uf: 'GO' });
  });

  it('duas remoções ao mesmo tempo: o principal sempre é uma cidade que ficou', async () => {
    const { s, t } = await membro();
    await req(`/api/t/${t}/areas`, { cookie: s.cookie, body: SANTOS });
    await req(`/api/t/${t}/areas`, { cookie: s.cookie, body: { municipioIbge: '5208707', municipioNome: 'Goiânia' } });
    await Promise.all(['3518701', '3548500'].map((i) => req(`/api/t/${t}/areas/${i}`, { method: 'DELETE', cookie: s.cookie })));
    expect(await areas(t, s.cookie)).toEqual([{ ibge: '5208707', nome: 'Goiânia' }]);
    expect(await env.DB.prepare('SELECT municipio_ibge, uf FROM tenants WHERE id = ?').bind(t).first()).toEqual({ municipio_ibge: '5208707', uf: 'GO' });
  });

  it('editor e repórter veem, mas não alteram (403); outro veículo: 404 e nada muda', async () => {
    const { s, t } = await membro();
    await req(`/api/t/${t}/areas`, { cookie: s.cookie, body: SANTOS });
    for (const papel of ['editor', 'reporter'] as const) {
      const o = await cadastrar();
      await seedMembro(t, o.userId, papel);
      expect(await areas(t, o.cookie)).toHaveLength(2);
      expect((await req(`/api/t/${t}/areas`, { cookie: o.cookie, body: { municipioIbge: '3541000', municipioNome: 'Praia Grande' } })).status).toBe(403);
      expect((await req(`/api/t/${t}/areas/3548500`, { method: 'DELETE', cookie: o.cookie })).status).toBe(403);
    }
    const b = await membro();
    expect((await req(`/api/t/${t}/areas`, { cookie: b.s.cookie })).status).toBe(404);
    expect((await req(`/api/t/${t}/areas`, { cookie: b.s.cookie, body: { municipioIbge: '3541000', municipioNome: 'Praia Grande' } })).status).toBe(404);
    expect((await req(`/api/t/${t}/areas/3548500`, { method: 'DELETE', cookie: b.s.cookie })).status).toBe(404);
    expect(await areas(t, s.cookie)).toHaveLength(2);
  });
});

describe('GET pautas: cidade', () => {
  it('cada pauta traz municipio_ibge e o nome da cidade pela cobertura', async () => {
    const { s, t } = await membro('reporter');
    await env.DB.prepare("INSERT INTO tenant_areas (tenant_id, municipio_ibge, municipio_nome, bairro) VALUES (?, '3548500', 'Santos', NULL)").bind(t).run();
    const a = await seedPauta(t);
    const b = await seedPauta(t);
    const c = await seedPauta(t);
    await env.DB.prepare("UPDATE pautas SET municipio_ibge = '3548500' WHERE id = ?").bind(a.pautaId).run();
    await env.DB.prepare("UPDATE pautas SET municipio_ibge = '3518701' WHERE id = ?").bind(b.pautaId).run();
    const { pautas } = await (await req(`/api/t/${t}/pautas`, { cookie: s.cookie })).json<{ pautas: { id: string; municipio_ibge: string | null; cidade: string | null }[] }>();
    const por = Object.fromEntries(pautas.map((p) => [p.id, [p.municipio_ibge, p.cidade]]));
    expect(por[a.pautaId]).toEqual(['3548500', 'Santos']);
    expect(por[b.pautaId]).toEqual(['3518701', 'Guarujá']);
    expect(por[c.pautaId]).toEqual([null, null]);
  });
});
