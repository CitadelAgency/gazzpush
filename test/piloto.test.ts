// Fase 3: piloto automático. Cada condição barra sozinha, o teto e o intervalo valem, e o replay do step não aprova duas vezes.
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INTERVALO_PILOTO_MIN, pilotar } from '../src/lib/piloto';
import { cadastrar, req, seedConta, seedMembro, seedTenant } from './helpers';

beforeEach(() => { vi.spyOn(env.PUBLICACAO_WORKFLOW, 'create').mockResolvedValue({ id: 'x' } as never); });
afterEach(() => vi.restoreAllMocks());

async function veiculo(o: { ligado?: boolean; modo?: 'real' | 'intermediario' | 'simulada' | 'manual' | null; porDia?: number } = {}) {
  const t = await seedTenant();
  const dono = await cadastrar();
  await seedMembro(t, dono.userId, 'admin');
  if (o.modo !== null) await seedConta(t, o.modo ?? 'simulada');
  if (o.ligado !== false) await env.DB.prepare("UPDATE tenants SET piloto_ligado_em = datetime('now'), piloto_ligado_por = ?, piloto_por_dia = ? WHERE id = ?").bind(dono.userId, o.porDia ?? 6, t).run();
  return { t, dono };
}

async function peca(t: string, o: { origem?: string; tipoPost?: string; validacao?: object; status?: string; formato?: string } = {}) {
  const [pautaId, id] = [crypto.randomUUID(), crypto.randomUUID()];
  await env.DB.batch([
    env.DB.prepare("INSERT INTO pautas (id, tenant_id, status, origem, titulo, fato_ids_json, documento_ids_json, score, tipo_post) VALUES (?, ?, 'em_producao', ?, 'Título', '[]', '[]', 1, ?)")
      .bind(pautaId, t, o.origem ?? 'site', o.tipoPost ?? null),
    env.DB.prepare(`INSERT INTO pecas (id, tenant_id, pauta_id, formato, status, versao, custo_usd, conteudo_json, validacao_json, arte_r2_keys_json, workflow_id)
                    VALUES (?, ?, ?, ?, ?, 1, 0, '{}', ?, '[]', ?)`)
      .bind(id, t, pautaId, o.formato ?? 'carrossel', o.status ?? 'revisao', JSON.stringify(o.validacao ?? { ok: true, erros: [], avisos: [] }), `${id}-r1`),
  ]);
  return id;
}

const estado = (id: string) => env.DB.prepare('SELECT status, agendado_para FROM pecas WHERE id = ?').bind(id).first<{ status: string; agendado_para: string | null }>();
const motivo = async (id: string) => JSON.parse((await env.DB.prepare("SELECT payload_json FROM eventos WHERE ref_id = ? AND tipo = 'peca.piloto_barrou'").bind(id).first<{ payload_json: string }>())?.payload_json ?? '{}').motivo;
const rodar = (t: string, id: string, rodada = 1) => pilotar(env, { tenantId: t, pecaId: id, rodada, versao: 1 });

describe('pilotar', () => {
  it('aprova na hora, com por = piloto e quem ligou no payload', async () => {
    const { t, dono } = await veiculo();
    const id = await peca(t);
    await rodar(t, id);
    expect(await estado(id)).toMatchObject({ status: 'aprovada', agendado_para: null });
    const d = await env.DB.prepare('SELECT por, decisao, payload_json FROM decisoes WHERE peca_id = ?').bind(id).first<{ por: string; decisao: string; payload_json: string }>();
    expect(d).toMatchObject({ por: 'piloto', decisao: 'aprovar' });
    expect(JSON.parse(d!.payload_json)).toMatchObject({ ligadoPor: dono.userId, modo: 'simulada' });
  });

  it.each(['real', 'intermediario', 'simulada'] as const)('conta %s posta sozinha', async (modo) => {
    const { t } = await veiculo({ modo });
    const id = await peca(t);
    await rodar(t, id);
    expect((await estado(id))?.status).toBe('aprovada');
  });

  it('desligado: nada acontece, nem evento', async () => {
    const { t } = await veiculo({ ligado: false });
    const id = await peca(t);
    await rodar(t, id);
    expect((await estado(id))?.status).toBe('revisao');
    expect(await motivo(id)).toBeUndefined();
  });

  const casos: [string, Parameters<typeof peca>[1], string][] = [
    ['origem', { origem: 'monitor' }, 'não veio do site do veículo'],
    ['publicidade', { tipoPost: 'publicidade' }, 'tipo de post: publicidade'],
    ['correção', { tipoPost: 'errata' }, 'tipo de post: errata'],
    ['atualização', { tipoPost: 'atualizacao' }, 'tipo de post: atualizacao'],
    ['resumo', { tipoPost: 'resumo' }, 'tipo de post: resumo'],
    ['aviso', { validacao: { ok: true, erros: [], avisos: ['frase longa'] } }, 'conferência com erro ou aviso'],
    ['erro', { validacao: { ok: false, erros: ['x'], avisos: [] } }, 'conferência com erro ou aviso'],
    ['sem conferência', { validacao: {} }, 'conferência com erro ou aviso'],
  ];
  it.each(casos)('barra: %s', async (_, o, esperado) => {
    const { t } = await veiculo();
    const id = await peca(t, o);
    await rodar(t, id);
    expect((await estado(id))?.status).toBe('revisao');
    expect(await motivo(id)).toBe(esperado);
  });

  it.each([['manual', 'manual'], ['sem conta', null]] as const)('barra: conta padrão %s', async (_, modo) => {
    const { t } = await veiculo({ modo });
    const id = await peca(t);
    await rodar(t, id);
    expect((await estado(id))?.status).toBe('revisao');
    expect(await motivo(id)).toBe('a conta padrão não posta sozinha');
  });

  it('barra: reescrita pedida por pessoa fica com a pessoa', async () => {
    const { t } = await veiculo();
    const id = await peca(t);
    await rodar(t, id, 2);
    expect((await estado(id))?.status).toBe('revisao');
    expect(await motivo(id)).toBe('reescrita pedida por pessoa');
  });

  it('o teto do dia barra a seguinte', async () => {
    const { t } = await veiculo({ porDia: 2 });
    const [a, b, c] = [await peca(t), await peca(t), await peca(t)];
    for (const id of [a, b, c]) await rodar(t, id);
    expect((await estado(a))?.status).toBe('aprovada');
    expect((await estado(b))?.status).toBe('agendada');
    expect((await estado(c))?.status).toBe('revisao');
    expect(await motivo(c)).toBe('teto de 2 por dia');
  });

  it('dois posts ficam com 60 minutos entre eles, mesmo ao mesmo tempo', async () => {
    const { t } = await veiculo();
    const ids = [await peca(t), await peca(t), await peca(t)];
    await Promise.all(ids.map((id) => rodar(t, id)));
    const horas = (await Promise.all(ids.map(estado))).map((e) => (e?.agendado_para ? Date.parse(e.agendado_para) : Date.now())).sort();
    expect(horas[1] - horas[0]).toBeGreaterThan((INTERVALO_PILOTO_MIN - 1) * 60_000);
    expect(horas[2] - horas[1]).toBeGreaterThanOrEqual(INTERVALO_PILOTO_MIN * 60_000 - 1);
  });

  it('o intervalo conta o último post e o último agendado por pessoa', async () => {
    const { t } = await veiculo();
    const conta = await env.DB.prepare('SELECT id FROM contas_sociais WHERE tenant_id = ?').bind(t).first<{ id: string }>();
    const antiga = await peca(t, { status: 'publicada' });
    await env.DB.prepare("INSERT INTO publicacoes (id, tenant_id, peca_id, conta_id, rede, modo, publicado_em, status) VALUES (?, ?, ?, ?, 'instagram', 'simulada', datetime('now', '-10 minutes'), 'publicada')")
      .bind(crypto.randomUUID(), t, antiga, conta!.id).run();
    const id = await peca(t);
    await rodar(t, id);
    const e = await estado(id);
    expect(e?.status).toBe('agendada');
    const falta = (Date.parse(e!.agendado_para!) - Date.now()) / 60_000;
    expect(falta).toBeGreaterThan(48);
    expect(falta).toBeLessThan(51);
  });

  it('replay do step não aprova duas vezes', async () => {
    const { t } = await veiculo();
    const id = await peca(t);
    await rodar(t, id);
    await rodar(t, id);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM decisoes WHERE peca_id = ?').bind(id).first('n')).toBe(1);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM execucoes WHERE ref_id = ? AND tipo = 'publicacao'").bind(id).first('n')).toBe(1);
  });

  it('peça que alguém já decidiu fica como está', async () => {
    const { t } = await veiculo();
    const id = await peca(t, { status: 'rejeitada' });
    await rodar(t, id);
    expect((await estado(id))?.status).toBe('rejeitada');
  });
});

describe('PATCH /piloto', () => {
  it('só admin liga; o dado é do veículo', async () => {
    const { t, dono } = await veiculo({ ligado: false });
    const outro = await veiculo({ ligado: false });
    const editor = await cadastrar();
    await seedMembro(t, editor.userId, 'editor');
    const pedir = (cookie: string, tt = t, ligado: unknown = true) => req(`/api/t/${tt}/piloto`, { cookie, method: 'PATCH', body: { ligado } });
    expect((await pedir(editor.cookie)).status).toBe(403);
    expect((await pedir(dono.cookie, outro.t)).status).toBe(404);
    expect((await pedir(dono.cookie, t, 'sim')).status).toBe(400);
    expect((await pedir(dono.cookie)).status).toBe(200);
    const l = await env.DB.prepare('SELECT piloto_ligado_em, piloto_ligado_por, piloto_por_dia FROM tenants WHERE id = ?').bind(t).first<Record<string, unknown>>();
    expect(l).toMatchObject({ piloto_ligado_por: dono.userId, piloto_por_dia: 6 });
    expect(l?.piloto_ligado_em).toBeTruthy();
    expect((await env.DB.prepare('SELECT piloto_ligado_em AS l FROM tenants WHERE id = ?').bind(outro.t).first<{ l: string | null }>())?.l).toBeNull();
    expect((await pedir(dono.cookie, t, false)).status).toBe(200);
    expect((await env.DB.prepare('SELECT piloto_ligado_em AS l, piloto_ligado_por AS p FROM tenants WHERE id = ?').bind(t).first())).toEqual({ l: null, p: null });
  });

  it('sem conta que poste sozinha não liga, e o estado aparece em /fontes', async () => {
    const { t, dono } = await veiculo({ ligado: false, modo: 'manual' });
    expect((await req(`/api/t/${t}/piloto`, { cookie: dono.cookie, method: 'PATCH', body: { ligado: true } })).status).toBe(409);
    const f = await (await req(`/api/t/${t}/fontes`, { cookie: dono.cookie })).json<{ piloto: unknown }>();
    expect(f.piloto).toEqual({ ligado: false, porDia: 6, contaSozinha: false });
  });

  it('veículo autoral não tem piloto', async () => {
    const { t, dono } = await veiculo({ ligado: false });
    await env.DB.prepare("UPDATE tenants SET modo = 'autoral' WHERE id = ?").bind(t).run();
    expect((await req(`/api/t/${t}/piloto`, { cookie: dono.cookie, method: 'PATCH', body: { ligado: true } })).status).toBe(400);
  });
});

describe('Postados', () => {
  it('marca o que o piloto aprovou', async () => {
    const { t, dono } = await veiculo();
    const conta = await env.DB.prepare('SELECT id FROM contas_sociais WHERE tenant_id = ?').bind(t).first<{ id: string }>();
    const id = await peca(t);
    await rodar(t, id);
    await env.DB.prepare("INSERT INTO publicacoes (id, tenant_id, peca_id, conta_id, rede, modo, publicado_em, status) VALUES (?, ?, ?, ?, 'instagram', 'simulada', datetime('now'), 'publicada')")
      .bind(crypto.randomUUID(), t, id, conta!.id).run();
    const r = await (await req(`/api/t/${t}/publicacoes`, { cookie: dono.cookie })).json<{ publicacoes: { piloto: number }[] }>();
    expect(r.publicacoes[0].piloto).toBe(1);
  });
});
