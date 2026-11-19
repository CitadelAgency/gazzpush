// Phase D: the queue's API (Ideas, production progress, discard, sources). Includes IDOR and roles.
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { stepProduction, statusList } from '../src/shell/queue';
import { register, eventsOf, req, seedMember, seedLead, seedPiece, seedTenant, statusOf } from './helpers';

async function member(role: 'admin' | 'editor' | 'reporter' = 'editor') {
  const s = await register();
  const t = await seedTenant();
  await seedMember(t, s.userId, role);
  return { s, t };
}
const get = async <T>(path: string, cookie: string) => {
  const res = await req(path, { cookie });
  expect(res.status, path).toBe(200);
  return res.json<T>();
};

describe('stepProduction', () => {
  const base = { versaoExibida: 0, versoesDaRodada: [] as number[], validacaoOk: null as boolean | null, ilustrou: false };
  it('follows what the Workflow recorded', () => {
    expect(stepProduction(base)).toEqual({ etapa: 'redigir', tentativa: 1 });
    expect(stepProduction({ ...base, versoesDaRodada: [1] })).toEqual({ etapa: 'validar', tentativa: 1 });
    expect(stepProduction({ ...base, versaoExibida: 1, versoesDaRodada: [1], validacaoOk: false })).toEqual({ etapa: 'redigir', tentativa: 2 });
    expect(stepProduction({ ...base, versaoExibida: 1, versoesDaRodada: [1, 2], validacaoOk: false })).toEqual({ etapa: 'validar', tentativa: 2 });
    expect(stepProduction({ ...base, versaoExibida: 2, versoesDaRodada: [1, 2], validacaoOk: true })).toEqual({ etapa: 'ilustrar', tentativa: 2 });
    expect(stepProduction({ ...base, versaoExibida: 2, versoesDaRodada: [1, 2], validacaoOk: true, ilustrou: true })).toEqual({ etapa: 'renderizar', tentativa: 2 });
  });
  it('new round (rewrite): the displayed version is still from the previous round', () => {
    expect(stepProduction({ ...base, versaoExibida: 3, versoesDaRodada: [], validacaoOk: true })).toEqual({ etapa: 'redigir', tentativa: 1 });
    expect(stepProduction({ ...base, versaoExibida: 3, versoesDaRodada: [4], validacaoOk: true })).toEqual({ etapa: 'validar', tentativa: 1 });
  });
});

describe('statusList', () => {
  const V = ['a', 'b', 'c'] as const;
  it('default, list and invalid', () => {
    expect(statusList(undefined, V, ['a'])).toEqual(['a']);
    expect(statusList('b, c,b', V, ['a'])).toEqual(['b', 'c']);
    expect(statusList('a,x', V, ['a'])).toBeNull();
    expect(statusList(',', V, ['a'])).toBeNull();
  });
});

describe('GET pautas', () => {
  it('various situations, with source, number of facts and reason for the last failure', async () => {
    const { s, t } = await member();
    const { pautaId: suggested } = await seedLead(t);
    const { pautaId: accepted } = await seedLead(t, 'aceita');
    await seedLead(t, 'descartada');
    await seedPiece(t, accepted, { status: 'falhou' });
    await env.DB.prepare("UPDATE pecas SET erro = 'validação reprovou 3 redações' WHERE pauta_id = ?").bind(accepted).run();

    const only = await get<{ pautas: { id: string }[] }>(`/api/t/${t}/pautas`, s.cookie);
    expect(only.pautas.map((p) => p.id)).toEqual([suggested]);

    const { pautas: leads } = await get<{ pautas: Record<string, unknown>[] }>(`/api/t/${t}/pautas?status=sugerida,aceita`, s.cookie);
    expect(leads.map((p) => p.id).sort()).toEqual([suggested, accepted].sort());
    const a = leads.find((p) => p.id === accepted)!;
    expect(a).toMatchObject({ status: 'aceita', fonte: 'Prefeitura', nfatos: 2, falhou: 'validação reprovou 3 redações', origem: 'monitor' });
    expect(leads.find((p) => p.id === suggested)!.falhou).toBeNull();

    expect((await req(`/api/t/${t}/pautas?status=sugerida,xyz`, { cookie: s.cookie })).status).toBe(400);
  });

  it("brings the text of each fact in the lead's order, and only the outlet's own", async () => {
    const { s, t } = await member();
    const { pautaId: leadId, fatos: facts } = await seedLead(t);
    const { pautaId: withoutFacts } = await seedLead(t);
    const other = await seedLead(await seedTenant());
    await env.DB.batch([
      env.DB.prepare("UPDATE fatos SET texto = 'fato de outro veículo' WHERE id = ?").bind(other.fatos[0].id),
      // The order is the lead's, not the insertion's; in the middle, the id of a fact from another outlet, which must not leak.
      env.DB.prepare('UPDATE pautas SET fato_ids_json = ? WHERE id = ?').bind(JSON.stringify([facts[1].id, other.fatos[0].id, facts[0].id]), leadId),
      env.DB.prepare("UPDATE pautas SET fato_ids_json = '[]' WHERE id = ?").bind(withoutFacts),
    ]);
    const { pautas: leads } = await get<{ pautas: { id: string; fatos: string[] }[] }>(`/api/t/${t}/pautas`, s.cookie);
    expect(leads.find((p) => p.id === leadId)!.fatos).toEqual([facts[1].texto, facts[0].texto]);
    expect(leads.find((p) => p.id === withoutFacts)!.fatos).toEqual([]);
  });

  it("an old failure doesn't show if the lead's newest piece is running", async () => {
    const { s, t } = await member();
    const { pautaId: leadId } = await seedLead(t, 'em_producao');
    await seedPiece(t, leadId, { status: 'falhou' });
    await env.DB.prepare("UPDATE pecas SET created_at = datetime('now', '-1 hour') WHERE pauta_id = ?").bind(leadId).run();
    await seedPiece(t, leadId, { status: 'rascunho' });
    const { pautas: leads } = await get<{ pautas: Record<string, unknown>[] }>(`/api/t/${t}/pautas?status=em_producao`, s.cookie);
    expect(leads[0].falhou).toBeNull();
  });
});

describe('POST pautas/:id/descartar', () => {
  it('editor discards sugerida and aceita; the event carries the session user; repeating changes nothing', async () => {
    const { s, t } = await member('editor');
    const { pautaId: leadId } = await seedLead(t);
    const res = await req(`/api/t/${t}/pautas/${leadId}/descartar`, { cookie: s.cookie, body: { motivo: 'fora do perfil', por: 'outro' } });
    expect(res.status).toBe(200);
    expect(await statusOf('pautas', leadId)).toBe('descartada');
    const ev = (await eventsOf(leadId)).filter((e) => e.tipo === 'pauta.descartada');
    expect(ev).toHaveLength(1);
    expect(ev[0].payload).toMatchObject({ por: s.userId, motivo: 'fora do perfil', de: 'sugerida' });
    expect((await req(`/api/t/${t}/pautas/${leadId}/descartar`, { cookie: s.cookie, body: {} })).status).toBe(200);
    expect((await eventsOf(leadId)).filter((e) => e.tipo === 'pauta.descartada')).toHaveLength(1);

    const { pautaId: accepted } = await seedLead(t, 'aceita');
    expect((await req(`/api/t/${t}/pautas/${accepted}/descartar`, { cookie: s.cookie, body: {} })).status).toBe(200);
  });

  it("a lead in production isn't discarded here (409); nonexistent 404; reporter 403", async () => {
    const { s, t } = await member('editor');
    const { pautaId: leadId } = await seedLead(t, 'em_producao');
    expect((await req(`/api/t/${t}/pautas/${leadId}/descartar`, { cookie: s.cookie, body: {} })).status).toBe(409);
    expect(await statusOf('pautas', leadId)).toBe('em_producao');
    expect((await req(`/api/t/${t}/pautas/nao-existe/descartar`, { cookie: s.cookie, body: {} })).status).toBe(404);

    const r = await register();
    await seedMember(t, r.userId, 'reporter');
    const { pautaId: other } = await seedLead(t);
    expect((await req(`/api/t/${t}/pautas/${other}/descartar`, { cookie: r.cookie, body: {} })).status).toBe(403);
    expect(await statusOf('pautas', other)).toBe('sugerida');
  });
});

describe('GET pecas (queue)', () => {
  it('default: in production and in review, with headline, lead title and signed cover', async () => {
    const { s, t } = await member('reporter');
    const { pautaId: leadId } = await seedLead(t, 'em_producao');
    const review = await seedPiece(t, leadId, { status: 'revisao' });
    const draft = await seedPiece(t, leadId, { status: 'rascunho', artes: false });
    await seedPiece(t, leadId, { status: 'aprovada' });
    const { pecas: pieces } = await get<{ pecas: Record<string, unknown>[] }>(`/api/t/${t}/pecas`, s.cookie);
    expect(pieces.map((p) => p.id).sort()).toEqual([review, draft].sort());
    const r = pieces.find((p) => p.id === review)!;
    expect(r).toMatchObject({ status: 'revisao', manchete: 'M', titulo: 'Ponte interditada', ncards: 1 });
    expect(String(r.capa)).toMatch(new RegExp(`/media/artes/${t}/${review}/v1/01-capa\\.jpg\\?exp=\\d+&sig=`));
    expect(pieces.find((p) => p.id === draft)!.capa).toBeNull();

    const approved = await get<{ pecas: unknown[] }>(`/api/t/${t}/pecas?status=aprovada`, s.cookie);
    expect(approved.pecas).toHaveLength(1);
    expect((await req(`/api/t/${t}/pecas?status=pronta`, { cookie: s.cookie })).status).toBe(400);
  });
});

describe('GET pecas: more than 50', () => {
  it('the list stops at 50, in review the oldest first; the total counts all', async () => {
    const { s, t } = await member('reporter');
    const { pautaId: leadId } = await seedLead(t, 'em_producao');
    const ids: string[] = [];
    for (let i = 0; i < 52; i++) ids.push(await seedPiece(t, leadId, { status: 'revisao', artes: false }));
    await seedPiece(t, leadId, { status: 'rascunho', artes: false });
    // The oldest in review is the last one seeded.
    await env.DB.prepare("UPDATE pecas SET updated_at = datetime('now', '-1 day') WHERE id = ?").bind(ids[51]).run();
    const r = await get<{ pecas: { id: string; status: string }[]; total: Record<string, number> }>(`/api/t/${t}/pecas`, s.cookie);
    expect(r.pecas).toHaveLength(50);
    expect(r.pecas[0].id).toBe(ids[51]);
    expect(r.pecas.every((p) => p.status === 'revisao')).toBe(true);
    expect(r.total).toEqual({ revisao: 52, rascunho: 1 });
  });
});

describe('?desde= counts in the database, beyond the list', () => {
  it('leads created and pieces ready after the previous visit', async () => {
    const { s, t } = await member('reporter');
    const { pautaId: stale } = await seedLead(t);
    await seedLead(t);
    await env.DB.prepare("UPDATE pautas SET created_at = '2026-10-01 10:00:00' WHERE id = ?").bind(stale).run();
    const ready = await seedPiece(t, (await seedLead(t, 'em_producao')).pautaId, { status: 'revisao' });
    const old = await seedPiece(t, (await seedLead(t, 'em_producao')).pautaId, { status: 'revisao' });
    await env.DB.prepare("UPDATE pecas SET updated_at = '2026-10-01 10:00:00' WHERE id = ?").bind(old).run();
    const since = Date.parse('2026-10-15T00:00:00Z');

    const pa = await get<{ novasDesde: number | null }>(`/api/t/${t}/pautas?status=sugerida&desde=${since}`, s.cookie);
    expect(pa.novasDesde).toBe(1);
    const pc = await get<{ prontasDesde: number | null; total: Record<string, number> }>(`/api/t/${t}/pecas?desde=${since}`, s.cookie);
    expect(pc.prontasDesde).toBe(1);
    expect(pc.total.revisao).toBe(2);
    expect(ready).toBeTruthy();
    // Without desde (first visit) or invalid: null, nothing is counted as new.
    expect((await get<{ novasDesde: unknown }>(`/api/t/${t}/pautas?desde=abc`, s.cookie)).novasDesde).toBeNull();
    expect((await get<{ prontasDesde: unknown }>(`/api/t/${t}/pecas`, s.cookie)).prontasDesde).toBeNull();
  });
});

describe('GET pecas/:id/status', () => {
  it('stage from the production recorded in D1; null outside rascunho; failure reason', async () => {
    const { s, t } = await member('reporter');
    const { pautaId: leadId } = await seedLead(t, 'em_producao');
    const id = await seedPiece(t, leadId, { status: 'rascunho', versao: 0, artes: false });
    await env.DB.prepare("INSERT INTO execucoes (id, tenant_id, tipo, ref_tipo, ref_id, params_json) VALUES (?, ?, 'producao', 'peca', ?, '{}')").bind(`${id}-r1`, t, id).run();
    const st = () => get<Record<string, unknown>>(`/api/t/${t}/pecas/${id}/status`, s.cookie);

    expect(await st()).toMatchObject({ id, status: 'rascunho', etapa: 'redigir', tentativa: 1, titulo: 'Ponte interditada', rodada: 1 });
    expect((await st()).iniciada_em).toEqual(expect.any(String));

    await env.DB.prepare("INSERT INTO peca_versoes (id, tenant_id, peca_id, versao, rodada, conteudo_json, autor) VALUES (?, ?, ?, 1, 1, '{}', 'ia')").bind(crypto.randomUUID(), t, id).run();
    expect(await st()).toMatchObject({ etapa: 'validar', tentativa: 1 });

    await env.DB.prepare("UPDATE pecas SET versao = 1, validacao_json = '{\"ok\":true}' WHERE id = ?").bind(id).run();
    expect(await st()).toMatchObject({ etapa: 'ilustrar' });

    await env.DB.prepare("INSERT INTO eventos (tenant_id, tipo, ref_tipo, ref_id, payload_json) VALUES (?, 'peca.ilustracao', 'peca', ?, '{\"versao\":1}')").bind(t, id).run();
    expect(await st()).toMatchObject({ etapa: 'renderizar' });

    await env.DB.prepare("UPDATE pecas SET status = 'falhou', erro = 'render caiu' WHERE id = ?").bind(id).run();
    expect(await st()).toMatchObject({ status: 'falhou', etapa: null, tentativa: null, erro: 'render caiu', pauta_id: leadId, pauta_status: 'em_producao' });
  });
});

describe('GET fontes', () => {
  it('ok = no failure; most recent collection; manual source stays out', async () => {
    const { s, t } = await member('reporter');
    await env.DB.batch([
      env.DB.prepare("INSERT INTO fontes (id, tenant_id, tipo, nome, url, ultimo_fetch_at) VALUES (?, ?, 'rss', 'G1', 'https://g1/x', '2026-11-01 02:05:00')").bind(crypto.randomUUID(), t),
      env.DB.prepare("INSERT INTO fontes (id, tenant_id, tipo, nome, url, falhas, ultimo_fetch_at) VALUES (?, ?, 'html', 'Prefeitura', 'https://p/x', 3, '2026-11-01 02:06:00')").bind(crypto.randomUUID(), t),
      env.DB.prepare("INSERT INTO fontes (id, tenant_id, tipo, nome) VALUES (?, ?, 'manual', 'Relato')").bind(crypto.randomUUID(), t),
      env.DB.prepare("INSERT INTO fontes (id, tenant_id, tipo, nome, url, ativo) VALUES (?, ?, 'rss', 'Desligada', 'https://d/x', 0)").bind(crypto.randomUUID(), t),
    ]);
    await env.DB.prepare("INSERT INTO fontes (id, tenant_id, tipo, nome, url, falhas, ultimo_fetch_at) VALUES (?, ?, 'rss', 'Morta', 'https://m/x', 10, '2026-11-01 02:00:00')").bind(crypto.randomUUID(), t).run();
    const r = await get<{ fontes: { nome: string; ok: boolean; intervaloMin: number; coletavel: boolean }[]; coletaEm: string }>(`/api/t/${t}/fontes`, s.cookie);
    expect(r.fontes.map((f) => [f.nome, f.ok, f.intervaloMin, f.coletavel])).toEqual([['G1', true, 30, true], ['Morta', false, 30, false], ['Prefeitura', false, 30, true]]);
    expect(r.coletaEm).toBe('2026-11-01 02:06:00');
  });
});

describe('IDOR on the Phase D routes', () => {
  it('a member of A gets 404 on everything of B, and nothing of B changes', async () => {
    const a = await member('admin');
    const b = await member('admin');
    const { pautaId: leadId } = await seedLead(b.t);
    const piece = await seedPiece(b.t, (await seedLead(b.t, 'em_producao')).pautaId, { status: 'rascunho' });
    for (const [route, body] of [
      [`/api/t/${b.t}/pecas`], [`/api/t/${b.t}/pecas/${piece}/status`], [`/api/t/${b.t}/fontes`],
      [`/api/t/${b.t}/pautas?status=sugerida,aceita`], [`/api/t/${b.t}/pautas/${leadId}/descartar`, {}],
      [`/api/t/${a.t}/pecas/${piece}/status`], [`/api/t/${a.t}/pautas/${leadId}/descartar`, {}],
    ] as const) {
      expect((await req(route, { cookie: a.s.cookie, body })).status, route).toBe(404);
    }
    expect(await statusOf('pautas', leadId)).toBe('sugerida');
  });
});
