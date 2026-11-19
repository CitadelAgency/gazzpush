// Phase 3: autopilot. Each condition blocks on its own, the cap and the interval apply, and replaying the step does not approve twice.
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INTERVAL_AUTOPILOT_MIN, autopilot } from '../src/lib/autopilot';
import { register, req, seedAccount, seedMember, seedTenant } from './helpers';

beforeEach(() => { vi.spyOn(env.PUBLICACAO_WORKFLOW, 'create').mockResolvedValue({ id: 'x' } as never); });
afterEach(() => vi.restoreAllMocks());

async function outlet(o: { ligado?: boolean; modo?: 'real' | 'intermediario' | 'simulada' | 'manual' | null; porDia?: number } = {}) {
  const t = await seedTenant();
  const owner = await register();
  await seedMember(t, owner.userId, 'admin');
  if (o.modo !== null) await seedAccount(t, o.modo ?? 'simulada');
  if (o.ligado !== false) await env.DB.prepare("UPDATE tenants SET piloto_ligado_em = datetime('now'), piloto_ligado_por = ?, piloto_por_dia = ? WHERE id = ?").bind(owner.userId, o.porDia ?? 6, t).run();
  return { t, dono: owner };
}

async function piece(t: string, o: { origem?: string; tipoPost?: string; validacao?: object; status?: string; formato?: string } = {}) {
  const [leadId, id] = [crypto.randomUUID(), crypto.randomUUID()];
  await env.DB.batch([
    env.DB.prepare("INSERT INTO pautas (id, tenant_id, status, origem, titulo, fato_ids_json, documento_ids_json, score, tipo_post) VALUES (?, ?, 'em_producao', ?, 'Ponte', '[]', '[]', 1, ?)")
      .bind(leadId, t, o.origem ?? 'site', o.tipoPost ?? null),
    env.DB.prepare(`INSERT INTO pecas (id, tenant_id, pauta_id, formato, status, versao, custo_usd, conteudo_json, validacao_json, arte_r2_keys_json, workflow_id)
                    VALUES (?, ?, ?, ?, ?, 1, 0, '{}', ?, '[]', ?)`)
      .bind(id, t, leadId, o.formato ?? 'carrossel', o.status ?? 'revisao', JSON.stringify(o.validacao ?? { ok: true, erros: [], avisos: [] }), `${id}-r1`),
  ]);
  return id;
}

const state = (id: string) => env.DB.prepare('SELECT status, agendado_para FROM pecas WHERE id = ?').bind(id).first<{ status: string; agendado_para: string | null }>();
const reason = async (id: string) => JSON.parse((await env.DB.prepare("SELECT payload_json FROM eventos WHERE ref_id = ? AND tipo = 'peca.piloto_barrou'").bind(id).first<{ payload_json: string }>())?.payload_json ?? '{}').motivo;
const run = (t: string, id: string, round = 1) => autopilot(env, { tenantId: t, pecaId: id, rodada: round, versao: 1 });

describe('autopilot', () => {
  it('approves right away, with por = piloto and who turned it on in the payload', async () => {
    const { t, dono: owner } = await outlet();
    const id = await piece(t);
    await run(t, id);
    expect(await state(id)).toMatchObject({ status: 'aprovada', agendado_para: null });
    const d = await env.DB.prepare('SELECT por, decisao, payload_json FROM decisoes WHERE peca_id = ?').bind(id).first<{ por: string; decisao: string; payload_json: string }>();
    expect(d).toMatchObject({ por: 'piloto', decisao: 'aprovar' });
    expect(JSON.parse(d!.payload_json)).toMatchObject({ ligadoPor: owner.userId, modo: 'simulada' });
  });

  it.each(['real', 'intermediario', 'simulada'] as const)('account %s posts on its own', async (mode) => {
    const { t } = await outlet({ modo: mode });
    const id = await piece(t);
    await run(t, id);
    expect((await state(id))?.status).toBe('aprovada');
  });

  it('off: nothing happens, no event either', async () => {
    const { t } = await outlet({ ligado: false });
    const id = await piece(t);
    await run(t, id);
    expect((await state(id))?.status).toBe('revisao');
    expect(await reason(id)).toBeUndefined();
  });

  const cases: [string, Parameters<typeof piece>[1], string][] = [
    ['origem', { origem: 'monitor' }, 'não veio do site do veículo'],
    ['publicidade', { tipoPost: 'publicidade' }, 'tipo de post: publicidade'],
    ['correção', { tipoPost: 'errata' }, 'tipo de post: errata'],
    ['atualização', { tipoPost: 'atualizacao' }, 'tipo de post: atualizacao'],
    ['resumo', { tipoPost: 'resumo' }, 'tipo de post: resumo'],
    ['aviso', { validacao: { ok: true, erros: [], avisos: ['frase longa'] } }, 'conferência com erro ou aviso'],
    ['erro', { validacao: { ok: false, erros: ['x'], avisos: [] } }, 'conferência com erro ou aviso'],
    ['sem conferência', { validacao: {} }, 'conferência com erro ou aviso'],
  ];
  it.each(cases)('blocks: %s', async (_, o, expected) => {
    const { t } = await outlet();
    const id = await piece(t, o);
    await run(t, id);
    expect((await state(id))?.status).toBe('revisao');
    expect(await reason(id)).toBe(expected);
  });

  it.each([['manual', 'manual'], ['sem conta', null]] as const)('blocks: default account %s', async (_, mode) => {
    const { t } = await outlet({ modo: mode });
    const id = await piece(t);
    await run(t, id);
    expect((await state(id))?.status).toBe('revisao');
    expect(await reason(id)).toBe('a conta padrão não posta sozinha');
  });

  it('blocks: a rewrite requested by a person stays with the person', async () => {
    const { t } = await outlet();
    const id = await piece(t);
    await run(t, id, 2);
    expect((await state(id))?.status).toBe('revisao');
    expect(await reason(id)).toBe('reescrita pedida por pessoa');
  });

  it('the daily cap blocks the next one', async () => {
    const { t } = await outlet({ porDia: 2 });
    const [a, b, c] = [await piece(t), await piece(t), await piece(t)];
    for (const id of [a, b, c]) await run(t, id);
    expect((await state(a))?.status).toBe('aprovada');
    expect((await state(b))?.status).toBe('agendada');
    expect((await state(c))?.status).toBe('revisao');
    expect(await reason(c)).toBe('teto de 2 por dia');
  });

  it('two posts keep 60 minutes between them, even at the same time', async () => {
    const { t } = await outlet();
    const ids = [await piece(t), await piece(t), await piece(t)];
    await Promise.all(ids.map((id) => run(t, id)));
    const hours = (await Promise.all(ids.map(state))).map((e) => (e?.agendado_para ? Date.parse(e.agendado_para) : Date.now())).sort();
    expect(hours[1] - hours[0]).toBeGreaterThan((INTERVAL_AUTOPILOT_MIN - 1) * 60_000);
    expect(hours[2] - hours[1]).toBeGreaterThanOrEqual(INTERVAL_AUTOPILOT_MIN * 60_000 - 1);
  });

  it('the interval counts the last post and the last scheduled one per person', async () => {
    const { t } = await outlet();
    const account = await env.DB.prepare('SELECT id FROM contas_sociais WHERE tenant_id = ?').bind(t).first<{ id: string }>();
    const old = await piece(t, { status: 'publicada' });
    await env.DB.prepare("INSERT INTO publicacoes (id, tenant_id, peca_id, conta_id, rede, modo, publicado_em, status) VALUES (?, ?, ?, ?, 'instagram', 'simulada', datetime('now', '-10 minutes'), 'publicada')")
      .bind(crypto.randomUUID(), t, old, account!.id).run();
    const id = await piece(t);
    await run(t, id);
    const e = await state(id);
    expect(e?.status).toBe('agendada');
    const missing = (Date.parse(e!.agendado_para!) - Date.now()) / 60_000;
    expect(missing).toBeGreaterThan(48);
    expect(missing).toBeLessThan(51);
  });

  it("step replay doesn't approve twice", async () => {
    const { t } = await outlet();
    const id = await piece(t);
    await run(t, id);
    await run(t, id);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM decisoes WHERE peca_id = ?').bind(id).first('n')).toBe(1);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM execucoes WHERE ref_id = ? AND tipo = 'publicacao'").bind(id).first('n')).toBe(1);
  });

  it('a piece someone already decided stays as it is', async () => {
    const { t } = await outlet();
    const id = await piece(t, { status: 'rejeitada' });
    await run(t, id);
    expect((await state(id))?.status).toBe('rejeitada');
  });
});

describe('PATCH /piloto', () => {
  it('only admin turns it on; the data belongs to the outlet', async () => {
    const { t, dono: owner } = await outlet({ ligado: false });
    const other = await outlet({ ligado: false });
    const editor = await register();
    await seedMember(t, editor.userId, 'editor');
    const request = (cookie: string, tt = t, on: unknown = true) => req(`/api/t/${tt}/piloto`, { cookie, method: 'PATCH', body: { ligado: on } });
    expect((await request(editor.cookie)).status).toBe(403);
    expect((await request(owner.cookie, other.t)).status).toBe(404);
    expect((await request(owner.cookie, t, 'sim')).status).toBe(400);
    expect((await request(owner.cookie)).status).toBe(200);
    const l = await env.DB.prepare('SELECT piloto_ligado_em, piloto_ligado_por, piloto_por_dia FROM tenants WHERE id = ?').bind(t).first<Record<string, unknown>>();
    expect(l).toMatchObject({ piloto_ligado_por: owner.userId, piloto_por_dia: 6 });
    expect(l?.piloto_ligado_em).toBeTruthy();
    expect((await env.DB.prepare('SELECT piloto_ligado_em AS l FROM tenants WHERE id = ?').bind(other.t).first<{ l: string | null }>())?.l).toBeNull();
    expect((await request(owner.cookie, t, false)).status).toBe(200);
    expect((await env.DB.prepare('SELECT piloto_ligado_em AS l, piloto_ligado_por AS p FROM tenants WHERE id = ?').bind(t).first())).toEqual({ l: null, p: null });
  });

  it("without an account that posts on its own it won't turn on, and the status shows in /fontes", async () => {
    const { t, dono: owner } = await outlet({ ligado: false, modo: 'manual' });
    expect((await req(`/api/t/${t}/piloto`, { cookie: owner.cookie, method: 'PATCH', body: { ligado: true } })).status).toBe(409);
    const f = await (await req(`/api/t/${t}/fontes`, { cookie: owner.cookie })).json<{ piloto: unknown }>();
    expect(f.piloto).toEqual({ ligado: false, porDia: 6, contaSozinha: false });
  });

  it('author outlet has no autopilot', async () => {
    const { t, dono: owner } = await outlet({ ligado: false });
    await env.DB.prepare("UPDATE tenants SET modo = 'autoral' WHERE id = ?").bind(t).run();
    expect((await req(`/api/t/${t}/piloto`, { cookie: owner.cookie, method: 'PATCH', body: { ligado: true } })).status).toBe(400);
  });
});

describe('Posted', () => {
  it('marks what autopilot approved', async () => {
    const { t, dono: owner } = await outlet();
    const account = await env.DB.prepare('SELECT id FROM contas_sociais WHERE tenant_id = ?').bind(t).first<{ id: string }>();
    const id = await piece(t);
    await run(t, id);
    await env.DB.prepare("INSERT INTO publicacoes (id, tenant_id, peca_id, conta_id, rede, modo, publicado_em, status) VALUES (?, ?, ?, ?, 'instagram', 'simulada', datetime('now'), 'publicada')")
      .bind(crypto.randomUUID(), t, id, account!.id).run();
    const r = await (await req(`/api/t/${t}/publicacoes`, { cookie: owner.cookie })).json<{ publicacoes: { piloto: number }[] }>();
    expect(r.publicacoes[0].piloto).toBe(1);
  });
});
