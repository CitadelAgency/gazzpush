// Fase D: API da fila (Ideias, andamento da produção, descartar, fontes). Inclui IDOR e papéis.
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { etapaProducao, listaDeStatus } from '../src/shell/fila';
import { cadastrar, eventosDe, req, seedMembro, seedPauta, seedPeca, seedTenant, statusDe } from './helpers';

async function membro(papel: 'admin' | 'editor' | 'reporter' = 'editor') {
  const s = await cadastrar();
  const t = await seedTenant();
  await seedMembro(t, s.userId, papel);
  return { s, t };
}
const get = async <T>(path: string, cookie: string) => {
  const res = await req(path, { cookie });
  expect(res.status, path).toBe(200);
  return res.json<T>();
};

describe('etapaProducao', () => {
  const base = { versaoExibida: 0, versoesDaRodada: [] as number[], validacaoOk: null as boolean | null, ilustrou: false };
  it('segue o que o Workflow gravou', () => {
    expect(etapaProducao(base)).toEqual({ etapa: 'redigir', tentativa: 1 });
    expect(etapaProducao({ ...base, versoesDaRodada: [1] })).toEqual({ etapa: 'validar', tentativa: 1 });
    expect(etapaProducao({ ...base, versaoExibida: 1, versoesDaRodada: [1], validacaoOk: false })).toEqual({ etapa: 'redigir', tentativa: 2 });
    expect(etapaProducao({ ...base, versaoExibida: 1, versoesDaRodada: [1, 2], validacaoOk: false })).toEqual({ etapa: 'validar', tentativa: 2 });
    expect(etapaProducao({ ...base, versaoExibida: 2, versoesDaRodada: [1, 2], validacaoOk: true })).toEqual({ etapa: 'ilustrar', tentativa: 2 });
    expect(etapaProducao({ ...base, versaoExibida: 2, versoesDaRodada: [1, 2], validacaoOk: true, ilustrou: true })).toEqual({ etapa: 'renderizar', tentativa: 2 });
  });
  it('rodada nova (reescrita): a versão exibida ainda é da rodada anterior', () => {
    expect(etapaProducao({ ...base, versaoExibida: 3, versoesDaRodada: [], validacaoOk: true })).toEqual({ etapa: 'redigir', tentativa: 1 });
    expect(etapaProducao({ ...base, versaoExibida: 3, versoesDaRodada: [4], validacaoOk: true })).toEqual({ etapa: 'validar', tentativa: 1 });
  });
});

describe('listaDeStatus', () => {
  const V = ['a', 'b', 'c'] as const;
  it('padrão, lista e inválidos', () => {
    expect(listaDeStatus(undefined, V, ['a'])).toEqual(['a']);
    expect(listaDeStatus('b, c,b', V, ['a'])).toEqual(['b', 'c']);
    expect(listaDeStatus('a,x', V, ['a'])).toBeNull();
    expect(listaDeStatus(',', V, ['a'])).toBeNull();
  });
});

describe('GET pautas', () => {
  it('várias situações, com fonte, número de fatos e motivo da última falha', async () => {
    const { s, t } = await membro();
    const { pautaId: sugerida } = await seedPauta(t);
    const { pautaId: aceita } = await seedPauta(t, 'aceita');
    await seedPauta(t, 'descartada');
    await seedPeca(t, aceita, { status: 'falhou' });
    await env.DB.prepare("UPDATE pecas SET erro = 'validação reprovou 3 redações' WHERE pauta_id = ?").bind(aceita).run();

    const so = await get<{ pautas: { id: string }[] }>(`/api/t/${t}/pautas`, s.cookie);
    expect(so.pautas.map((p) => p.id)).toEqual([sugerida]);

    const { pautas } = await get<{ pautas: Record<string, unknown>[] }>(`/api/t/${t}/pautas?status=sugerida,aceita`, s.cookie);
    expect(pautas.map((p) => p.id).sort()).toEqual([sugerida, aceita].sort());
    const a = pautas.find((p) => p.id === aceita)!;
    expect(a).toMatchObject({ status: 'aceita', fonte: 'Fonte', nfatos: 2, falhou: 'validação reprovou 3 redações', origem: 'monitor' });
    expect(pautas.find((p) => p.id === sugerida)!.falhou).toBeNull();

    expect((await req(`/api/t/${t}/pautas?status=sugerida,xyz`, { cookie: s.cookie })).status).toBe(400);
  });

  it('traz o texto de cada fato na ordem da pauta, e só os do próprio veículo', async () => {
    const { s, t } = await membro();
    const { pautaId, fatos } = await seedPauta(t);
    const { pautaId: semFatos } = await seedPauta(t);
    const outro = await seedPauta(await seedTenant());
    await env.DB.batch([
      env.DB.prepare("UPDATE fatos SET texto = 'fato de outro veículo' WHERE id = ?").bind(outro.fatos[0].id),
      // A ordem é a da pauta, não a de inserção; no meio, o id de um fato de outro veículo, que não pode vazar.
      env.DB.prepare('UPDATE pautas SET fato_ids_json = ? WHERE id = ?').bind(JSON.stringify([fatos[1].id, outro.fatos[0].id, fatos[0].id]), pautaId),
      env.DB.prepare("UPDATE pautas SET fato_ids_json = '[]' WHERE id = ?").bind(semFatos),
    ]);
    const { pautas } = await get<{ pautas: { id: string; fatos: string[] }[] }>(`/api/t/${t}/pautas`, s.cookie);
    expect(pautas.find((p) => p.id === pautaId)!.fatos).toEqual([fatos[1].texto, fatos[0].texto]);
    expect(pautas.find((p) => p.id === semFatos)!.fatos).toEqual([]);
  });

  it('falha antiga não aparece se a peça mais nova da pauta está andando', async () => {
    const { s, t } = await membro();
    const { pautaId } = await seedPauta(t, 'em_producao');
    await seedPeca(t, pautaId, { status: 'falhou' });
    await env.DB.prepare("UPDATE pecas SET created_at = datetime('now', '-1 hour') WHERE pauta_id = ?").bind(pautaId).run();
    await seedPeca(t, pautaId, { status: 'rascunho' });
    const { pautas } = await get<{ pautas: Record<string, unknown>[] }>(`/api/t/${t}/pautas?status=em_producao`, s.cookie);
    expect(pautas[0].falhou).toBeNull();
  });
});

describe('POST pautas/:id/descartar', () => {
  it('editor descarta sugerida e aceita; evento leva o usuário da sessão; repetir não muda nada', async () => {
    const { s, t } = await membro('editor');
    const { pautaId } = await seedPauta(t);
    const res = await req(`/api/t/${t}/pautas/${pautaId}/descartar`, { cookie: s.cookie, body: { motivo: 'fora do perfil', por: 'outro' } });
    expect(res.status).toBe(200);
    expect(await statusDe('pautas', pautaId)).toBe('descartada');
    const ev = (await eventosDe(pautaId)).filter((e) => e.tipo === 'pauta.descartada');
    expect(ev).toHaveLength(1);
    expect(ev[0].payload).toMatchObject({ por: s.userId, motivo: 'fora do perfil', de: 'sugerida' });
    expect((await req(`/api/t/${t}/pautas/${pautaId}/descartar`, { cookie: s.cookie, body: {} })).status).toBe(200);
    expect((await eventosDe(pautaId)).filter((e) => e.tipo === 'pauta.descartada')).toHaveLength(1);

    const { pautaId: aceita } = await seedPauta(t, 'aceita');
    expect((await req(`/api/t/${t}/pautas/${aceita}/descartar`, { cookie: s.cookie, body: {} })).status).toBe(200);
  });

  it('pauta em produção não é descartada por aqui (409); inexistente 404; repórter 403', async () => {
    const { s, t } = await membro('editor');
    const { pautaId } = await seedPauta(t, 'em_producao');
    expect((await req(`/api/t/${t}/pautas/${pautaId}/descartar`, { cookie: s.cookie, body: {} })).status).toBe(409);
    expect(await statusDe('pautas', pautaId)).toBe('em_producao');
    expect((await req(`/api/t/${t}/pautas/nao-existe/descartar`, { cookie: s.cookie, body: {} })).status).toBe(404);

    const r = await cadastrar();
    await seedMembro(t, r.userId, 'reporter');
    const { pautaId: outra } = await seedPauta(t);
    expect((await req(`/api/t/${t}/pautas/${outra}/descartar`, { cookie: r.cookie, body: {} })).status).toBe(403);
    expect(await statusDe('pautas', outra)).toBe('sugerida');
  });
});

describe('GET pecas (fila)', () => {
  it('padrão: produzindo e em revisão, com manchete, título da pauta e capa assinada', async () => {
    const { s, t } = await membro('reporter');
    const { pautaId } = await seedPauta(t, 'em_producao');
    const revisao = await seedPeca(t, pautaId, { status: 'revisao' });
    const rascunho = await seedPeca(t, pautaId, { status: 'rascunho', artes: false });
    await seedPeca(t, pautaId, { status: 'aprovada' });
    const { pecas } = await get<{ pecas: Record<string, unknown>[] }>(`/api/t/${t}/pecas`, s.cookie);
    expect(pecas.map((p) => p.id).sort()).toEqual([revisao, rascunho].sort());
    const r = pecas.find((p) => p.id === revisao)!;
    expect(r).toMatchObject({ status: 'revisao', manchete: 'M', titulo: 'Título da pauta', ncards: 1 });
    expect(String(r.capa)).toMatch(new RegExp(`/media/artes/${t}/${revisao}/v1/01-capa\\.jpg\\?exp=\\d+&sig=`));
    expect(pecas.find((p) => p.id === rascunho)!.capa).toBeNull();

    const aprovadas = await get<{ pecas: unknown[] }>(`/api/t/${t}/pecas?status=aprovada`, s.cookie);
    expect(aprovadas.pecas).toHaveLength(1);
    expect((await req(`/api/t/${t}/pecas?status=pronta`, { cookie: s.cookie })).status).toBe(400);
  });
});

describe('GET pecas: mais de 50', () => {
  it('lista para em 50, em revisão a mais antiga primeiro; o total conta todas', async () => {
    const { s, t } = await membro('reporter');
    const { pautaId } = await seedPauta(t, 'em_producao');
    const ids: string[] = [];
    for (let i = 0; i < 52; i++) ids.push(await seedPeca(t, pautaId, { status: 'revisao', artes: false }));
    await seedPeca(t, pautaId, { status: 'rascunho', artes: false });
    // A mais antiga em revisão é a última semeada.
    await env.DB.prepare("UPDATE pecas SET updated_at = datetime('now', '-1 day') WHERE id = ?").bind(ids[51]).run();
    const r = await get<{ pecas: { id: string; status: string }[]; total: Record<string, number> }>(`/api/t/${t}/pecas`, s.cookie);
    expect(r.pecas).toHaveLength(50);
    expect(r.pecas[0].id).toBe(ids[51]);
    expect(r.pecas.every((p) => p.status === 'revisao')).toBe(true);
    expect(r.total).toEqual({ revisao: 52, rascunho: 1 });
  });
});

describe('?desde= conta no banco, além da lista', () => {
  it('pautas criadas e peças prontas depois da visita anterior', async () => {
    const { s, t } = await membro('reporter');
    const { pautaId: velha } = await seedPauta(t);
    await seedPauta(t);
    await env.DB.prepare("UPDATE pautas SET created_at = '2026-10-01 10:00:00' WHERE id = ?").bind(velha).run();
    const pronta = await seedPeca(t, (await seedPauta(t, 'em_producao')).pautaId, { status: 'revisao' });
    const antiga = await seedPeca(t, (await seedPauta(t, 'em_producao')).pautaId, { status: 'revisao' });
    await env.DB.prepare("UPDATE pecas SET updated_at = '2026-10-01 10:00:00' WHERE id = ?").bind(antiga).run();
    const desde = Date.parse('2026-10-15T00:00:00Z');

    const pa = await get<{ novasDesde: number | null }>(`/api/t/${t}/pautas?status=sugerida&desde=${desde}`, s.cookie);
    expect(pa.novasDesde).toBe(1);
    const pc = await get<{ prontasDesde: number | null; total: Record<string, number> }>(`/api/t/${t}/pecas?desde=${desde}`, s.cookie);
    expect(pc.prontasDesde).toBe(1);
    expect(pc.total.revisao).toBe(2);
    expect(pronta).toBeTruthy();
    // Sem desde (primeira visita) ou inválido: null, nada é contado como novo.
    expect((await get<{ novasDesde: unknown }>(`/api/t/${t}/pautas?desde=abc`, s.cookie)).novasDesde).toBeNull();
    expect((await get<{ prontasDesde: unknown }>(`/api/t/${t}/pecas`, s.cookie)).prontasDesde).toBeNull();
  });
});

describe('GET pecas/:id/status', () => {
  it('etapa pela produção gravada no D1; nula fora de rascunho; motivo da falha', async () => {
    const { s, t } = await membro('reporter');
    const { pautaId } = await seedPauta(t, 'em_producao');
    const id = await seedPeca(t, pautaId, { status: 'rascunho', versao: 0, artes: false });
    await env.DB.prepare("INSERT INTO execucoes (id, tenant_id, tipo, ref_tipo, ref_id, params_json) VALUES (?, ?, 'producao', 'peca', ?, '{}')").bind(`${id}-r1`, t, id).run();
    const st = () => get<Record<string, unknown>>(`/api/t/${t}/pecas/${id}/status`, s.cookie);

    expect(await st()).toMatchObject({ id, status: 'rascunho', etapa: 'redigir', tentativa: 1, titulo: 'Título da pauta', rodada: 1 });
    expect((await st()).iniciada_em).toEqual(expect.any(String));

    await env.DB.prepare("INSERT INTO peca_versoes (id, tenant_id, peca_id, versao, rodada, conteudo_json, autor) VALUES (?, ?, ?, 1, 1, '{}', 'ia')").bind(crypto.randomUUID(), t, id).run();
    expect(await st()).toMatchObject({ etapa: 'validar', tentativa: 1 });

    await env.DB.prepare("UPDATE pecas SET versao = 1, validacao_json = '{\"ok\":true}' WHERE id = ?").bind(id).run();
    expect(await st()).toMatchObject({ etapa: 'ilustrar' });

    await env.DB.prepare("INSERT INTO eventos (tenant_id, tipo, ref_tipo, ref_id, payload_json) VALUES (?, 'peca.ilustracao', 'peca', ?, '{\"versao\":1}')").bind(t, id).run();
    expect(await st()).toMatchObject({ etapa: 'renderizar' });

    await env.DB.prepare("UPDATE pecas SET status = 'falhou', erro = 'render caiu' WHERE id = ?").bind(id).run();
    expect(await st()).toMatchObject({ status: 'falhou', etapa: null, tentativa: null, erro: 'render caiu', pauta_id: pautaId, pauta_status: 'em_producao' });
  });
});

describe('GET fontes', () => {
  it('ok = sem falha; coleta mais recente; fonte manual fica de fora', async () => {
    const { s, t } = await membro('reporter');
    await env.DB.batch([
      env.DB.prepare("INSERT INTO fontes (id, tenant_id, tipo, nome, url, ultimo_fetch_at) VALUES (?, ?, 'rss', 'Ativa', 'https://feed.example/a', '2026-11-01 02:05:00')").bind(crypto.randomUUID(), t),
      env.DB.prepare("INSERT INTO fontes (id, tenant_id, tipo, nome, url, falhas, ultimo_fetch_at) VALUES (?, ?, 'html', 'Fonte', 'https://p/x', 3, '2026-11-01 02:06:00')").bind(crypto.randomUUID(), t),
      env.DB.prepare("INSERT INTO fontes (id, tenant_id, tipo, nome) VALUES (?, ?, 'manual', 'Relato')").bind(crypto.randomUUID(), t),
      env.DB.prepare("INSERT INTO fontes (id, tenant_id, tipo, nome, url, ativo) VALUES (?, ?, 'rss', 'Desligada', 'https://d/x', 0)").bind(crypto.randomUUID(), t),
    ]);
    await env.DB.prepare("INSERT INTO fontes (id, tenant_id, tipo, nome, url, falhas, ultimo_fetch_at) VALUES (?, ?, 'rss', 'Suspensa', 'https://feed.example/b', 10, '2026-11-01 02:00:00')").bind(crypto.randomUUID(), t).run();
    const r = await get<{ fontes: { nome: string; ok: boolean; intervaloMin: number; coletavel: boolean }[]; coletaEm: string }>(`/api/t/${t}/fontes`, s.cookie);
    expect(r.fontes.map((f) => [f.nome, f.ok, f.intervaloMin, f.coletavel])).toEqual([['Ativa', true, 30, true], ['Fonte', false, 30, true], ['Suspensa', false, 30, false]]);
    expect(r.coletaEm).toBe('2026-11-01 02:06:00');
  });
});

describe('IDOR nas rotas da Fase D', () => {
  it('membro de A recebe 404 em tudo de B, e nada de B muda', async () => {
    const a = await membro('admin');
    const b = await membro('admin');
    const { pautaId } = await seedPauta(b.t);
    const peca = await seedPeca(b.t, (await seedPauta(b.t, 'em_producao')).pautaId, { status: 'rascunho' });
    for (const [rota, body] of [
      [`/api/t/${b.t}/pecas`], [`/api/t/${b.t}/pecas/${peca}/status`], [`/api/t/${b.t}/fontes`],
      [`/api/t/${b.t}/pautas?status=sugerida,aceita`], [`/api/t/${b.t}/pautas/${pautaId}/descartar`, {}],
      [`/api/t/${a.t}/pecas/${peca}/status`], [`/api/t/${a.t}/pautas/${pautaId}/descartar`, {}],
    ] as const) {
      expect((await req(rota, { cookie: a.s.cookie, body })).status, rota).toBe(404);
    }
    expect(await statusDe('pautas', pautaId)).toBe('sugerida');
  });
});
