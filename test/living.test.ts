// Phase 7 (handoffs/2026-11-02-materia-e-editor-investigativo.md): living story and LAI. Alerts in the After tab
// (a source that changed or went offline, a person in new news, a case with activity in DataJud, an LAI deadline), the
// new Update or Correction post with its label by code, the LAI request with the sentence checked letter by letter, the
// 20 + 10 day deadline, the answer in the dossier and the appeal; the package carries everything; IDOR on the new
// routes. DeepSeek and DataJud simulated.
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import type { Env } from '../src/env';
import { alertsPeople, queryCase, digitCnjOk, postAlert, casesInText, dataJudCourt } from '../src/lib/living';
import { todayIso, withoutMasthead, laiStatus, addDays, expiry } from '../src/lib/lai';
import { draftPiece } from '../src/lib/drafting';
import type { Lead } from '../src/lib/lead';
import { register, req, seedMember } from './helpers';

const CASE = '1234567-13.2024.8.26.0100';
const P = [
  'Contratos da prefeitura',
  'A Prefeitura de Vila Serena gastou R$ 3 milhões com publicidade em 2025.',
  `O caso está no processo ${CASE}, segundo a defesa de Ícaro Nunes.`,
];
const SOURCE = 'https://camara.example/relatorio-publicidade';

type Item = Record<string, unknown>;
let deepseek: (user: string) => Item;
let datajud: (body: Item, url: string, auth: string | null) => Response;
beforeEach(() => {
  deepseek = (user) => {
    const block = user.slice(user.lastIndexOf('[P0] ') + 5);
    return { afirmacoes: block === P[1] ? [{ paragrafo: 0, trecho: P[1], estado: 'sem_fonte', risco: null, evidencia: null, trecho_evidencia: null, explicacao: 'Nenhuma evidência do dossiê sustenta esta afirmação.' }] : [] };
  };
  datajud = () => Response.json({ hits: { hits: [] } });
  const original = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('deepseek')) {
      const body = JSON.parse(init!.body as string) as { messages: { content: string }[] };
      return Response.json({ choices: [{ message: { content: JSON.stringify(deepseek(body.messages[1].content)) } }], usage: { prompt_tokens: 100, completion_tokens: 50 } });
    }
    if (url.startsWith('https://datajud.example/')) return datajud(JSON.parse(init!.body as string), url, new Headers(init!.headers).get('authorization'));
    if (url.includes('.example')) return new Response('não achei', { status: 404 });
    return original(input, init);
  });
});
afterEach(() => vi.restoreAllMocks());

async function story() {
  const s = await register('Editora Teste');
  const t = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO tenants (id, slug, nome, modo, plano) VALUES (?, ?, 'Cartas', 'autoral', 'cortesia')").bind(t, `v-${t.slice(0, 8)}`).run();
  await seedMember(t, s.userId, 'admin');
  const { texto: text } = await (await req(`/api/t/${t}/textos`, { cookie: s.cookie, body: { texto: P.join('\n') } })).json<{ texto: { id: string } }>();
  expect((await req(`/api/t/${t}/textos/${text.id}/conferir`, { cookie: s.cookie, body: {} })).status).toBe(200);
  return { s, t, id: text.id };
}
const ROUTE = (t: string, id: string) => `/api/t/${t}/textos/${id}`;

interface Alert { id: string; tipo: string; titulo: string; detalhe: Item; estado: string; acao: string | null; pecaId: string | null; porNome: string | null }
interface LaiRequest { id: string; estado: string; prazo: string | null; prazoFinal: string | null; vencido: boolean; podeRecorrer: boolean; recorrerAte: string | null; modeloRecurso: string | null; respostaEvidenciaId: string | null; recursoEvidenciaId: string | null }
interface State {
  alertas: Alert[];
  processos: { ligado: boolean; lista: { numero: string; tribunal: string | null; ultimoMovimento: string | null; erro: string | null }[] };
  lai: { pedidos: LaiRequest[]; candidatas: { blocoId: string; trecho: string; orgao: string; modelo: string }[]; portal: string };
  evidencias: { id: string; origem: string; titulo: string }[];
}
const read = async (t: string, id: string, cookie: string) => (await req(ROUTE(t, id), { cookie })).json<State>();
const wf = { create: async ({ id: i }: { id: string }) => ({ id: i }), get: async (i: string) => ({ id: i, status: async () => ({ status: 'running' }) }) };

describe('alerts in the After tab', () => {
  it('a source that changed or went missing becomes an alert (once); "atualizei o texto" closes with whoever; a closed one doesn\'t close again', async () => {
    const { s, t, id } = await story();
    await env.DB.prepare("INSERT INTO evidencias (id, tenant_id, texto_id, url, titulo, r2_texto, hash, hash_atual, mudou_em) VALUES (?, ?, ?, ?, 'Relatório de publicidade', 'evidencias/x.txt', 'h1', 'h2', datetime('now'))")
      .bind(`ev-${id.slice(0, 6)}`, t, id, SOURCE).run();
    await env.DB.prepare("INSERT INTO evidencias (id, tenant_id, texto_id, url, titulo, r2_texto, hash, hash_atual, falhas) VALUES (?, ?, ?, 'https://diario.example/edicao', 'Diário oficial', 'evidencias/y.txt', 'h1', 'h1', 4)")
      .bind(`ef-${id.slice(0, 6)}`, t, id).run();
    const e = await read(t, id, s.cookie);
    expect(e.alertas.map((a) => a.tipo).sort()).toEqual(['fonte_fora', 'fonte_mudou']);
    expect((await read(t, id, s.cookie)).alertas).toHaveLength(2);   // idempotente
    const changed = e.alertas.find((a) => a.tipo === 'fonte_mudou')!;
    expect(changed).toMatchObject({ titulo: 'Relatório de publicidade', estado: 'aberto', detalhe: { url: SOURCE } });

    const r = await req(`${ROUTE(t, id)}/alertas/${changed.id}/resolver`, { cookie: s.cookie, body: { acao: 'texto_atualizado' } });
    expect(r.status).toBe(200);
    expect((await r.json<State>()).alertas.find((a) => a.id === changed.id)).toMatchObject({ estado: 'resolvido', acao: 'texto_atualizado', porNome: 'Editora Teste' });
    expect((await req(`${ROUTE(t, id)}/alertas/${changed.id}/resolver`, { cookie: s.cookie, body: { acao: 'ignorado' } })).status).toBe(409);
    expect((await req(`${ROUTE(t, id)}/alertas/${changed.id}/resolver`, { cookie: s.cookie, body: { acao: 'apagar' } })).status).toBe(422);
  });

  it("errata post: a new post, one image, with the person's note as their claim; the alert keeps the post", async () => {
    const { s, t, id } = await story();
    await env.DB.prepare("INSERT INTO evidencias (id, tenant_id, texto_id, url, titulo, r2_texto, hash, hash_atual, mudou_em) VALUES (?, ?, ?, ?, 'Relatório', 'evidencias/x.txt', 'h1', 'h2', datetime('now'))")
      .bind(`ev-${id.slice(0, 6)}`, t, id, SOURCE).run();
    const alert = (await read(t, id, s.cookie)).alertas[0];
    const e = { ...env, PRODUCAO_WORKFLOW: wf } as unknown as Env;
    await expect(postAlert(e, t, id, alert.id, s.userId, { tipo: 'errata', nota: 'curta' })).rejects.toMatchObject({ codigo: 'nota' });
    await expect(postAlert(e, t, id, alert.id, s.userId, { tipo: 'retratacao', nota: 'O valor certo é R$ 2 milhões, não R$ 3 milhões.' })).rejects.toMatchObject({ codigo: 'tipo' });
    const r = await postAlert(e, t, id, alert.id, s.userId, { tipo: 'errata', nota: 'O valor certo é R$ 2 milhões, não R$ 3 milhões.' });
    expect(r.pecaId).toBeTruthy();
    const lead = await env.DB.prepare('SELECT tipo_post, texto_id, fato_ids_json FROM pautas WHERE id = ?').bind(r.pautaId).first<{ tipo_post: string; texto_id: string; fato_ids_json: string }>();
    expect(lead).toMatchObject({ tipo_post: 'errata', texto_id: id });
    const fact = await env.DB.prepare('SELECT tipo, texto FROM fatos WHERE id = ?').bind(JSON.parse(lead!.fato_ids_json)[0]).first();
    expect(fact).toEqual({ tipo: 'opiniao', texto: 'O valor certo é R$ 2 milhões, não R$ 3 milhões.' });
    expect((await env.DB.prepare('SELECT formato FROM pecas WHERE id = ?').bind(r.pecaId).first<{ formato: string }>())?.formato).toBe('post');
    expect((await read(t, id, s.cookie)).alertas[0]).toMatchObject({ estado: 'resolvido', acao: 'post_errata', pecaId: r.pecaId });
    await expect(postAlert(e, t, id, alert.id, s.userId, { tipo: 'errata', nota: 'O valor certo é R$ 2 milhões, não R$ 3 milhões.' })).rejects.toMatchObject({ codigo: 'fechado' });
  });

  it('the Errata/Atualização label goes into the headline, the cover and the caption by code, in pt and en', async () => {
    deepseek = () => ({ manchete: 'O valor do contrato era menor', resumo: 'r', legenda: 'O valor certo é R$ 2 milhões.', cards: [{ layout: 'capa', titulo: 'O valor era menor', frases: [{ texto: 'R$ 2 milhões', fatoId: 'f1' }] }], visualBrief: { primary: 'mesa', context: '', fatoIds: ['f1'] } });
    const base = { id: 'p1', titulo: 'Contratos', resumo: null, editoria: null, fatos: [{ id: 'f1', tipo: 'opiniao', texto: 'O valor certo é R$ 2 milhões.' }], marca: { nome: 'Cartas' }, voz: {}, modo: 'autoral' } as unknown as Lead;
    const pt = await draftPiece(env as unknown as Env, { pauta: { ...base, tipoPost: 'errata' }, formato: 'post' });
    expect(pt.manchete).toBe('Errata: O valor do contrato era menor');
    expect(pt.cards[0].titulo).toBe('Errata: O valor era menor');
    expect(pt.legenda.startsWith('Errata: O valor certo')).toBe(true);
    const en = await draftPiece(env as unknown as Env, { pauta: { ...base, idioma: 'en', tipoPost: 'atualizacao' }, formato: 'post' });
    expect(en.manchete).toBe('Update: O valor do contrato era menor');
    const without = await draftPiece(env as unknown as Env, { pauta: base, formato: 'post' });
    expect(without.manchete).toBe('O valor do contrato era menor');
  });

  it("a person cited in the text who appears in new news from the outlet's sources becomes an alert (once per news item)", async () => {
    const { s, t, id } = await story();
    await env.MEDIA.put(`docs/${id}.txt`, 'A Justiça ouviu nesta terça o vereador Icaro Nunes sobre os contratos de publicidade.');
    await env.DB.prepare("INSERT INTO documentos (id, tenant_id, url, hash_texto, titulo, r2_texto) VALUES (?, ?, 'https://jornal.example/vereador-depoe', ?, 'Vereador depõe', ?)")
      .bind(`d-${id.slice(0, 8)}`, t, `h-${id}`, `docs/${id}.txt`).run();
    await env.DB.prepare("INSERT INTO documentos (id, tenant_id, url, hash_texto, titulo, r2_texto) VALUES (?, ?, 'https://jornal.example/outra', ?, 'Outra notícia', NULL)")
      .bind(`o-${id.slice(0, 8)}`, t, `o-${id}`).run();
    expect(await alertsPeople(env as unknown as Env, t, `d-${id.slice(0, 8)}`)).toBe(1);
    expect(await alertsPeople(env as unknown as Env, t, `d-${id.slice(0, 8)}`)).toBe(0);
    expect(await alertsPeople(env as unknown as Env, t, `o-${id.slice(0, 8)}`)).toBe(0);
    const a = (await read(t, id, s.cookie)).alertas.find((x) => x.tipo === 'pessoa');
    expect(a).toMatchObject({ titulo: 'Ícaro Nunes', detalhe: { url: 'https://jornal.example/vereador-depoe', titulo: 'Vereador depõe' } });
  });
});

describe('court cases (DataJud)', () => {
  it('CNJ number with correct check digit, court from J.TR', () => {
    expect(casesInText([P[2], 'Número errado: 1234567-14.2024.8.26.0100. Sem máscara: 12345671320248260100.'])).toEqual(['12345671320248260100']);
    expect(digitCnjOk('00076548120254013400')).toBe(true);
    expect(dataJudCourt('12345671320248260100')).toBe('tjsp');
    expect(dataJudCourt('00076548120254013400')).toBe('trf1');
    expect(dataJudCourt('00000000020245020000')).toBe('trt2');
    expect(dataJudCourt('00000000020246070000')).toBe('tre-df');    // DF's electoral court: tre-df (the state court is tjdft)
    expect(dataJudCourt('00000000020248070000')).toBe('tjdft');
    expect(dataJudCourt('00000000020243000000')).toBe('stj');
    expect(dataJudCourt('00000000020241000000')).toBeNull();   // The STF is not in DataJud
  });

  it("without a key: lists the case and says it's off; with a key, the first query is the base and new movement becomes an alert", async () => {
    const { s, t, id } = await story();
    const e0 = await read(t, id, s.cookie);
    expect(e0.processos).toEqual({ ligado: false, lista: [expect.objectContaining({ numero: '12345671320248260100', tribunal: 'tjsp', ultimoMovimento: null })] });
    const pid = (await env.DB.prepare('SELECT id FROM processos WHERE texto_id = ?').bind(id).first<{ id: string }>())!.id;
    const withKey = { ...env, DATAJUD_API_KEY: 'chave-publica-de-teste' } as unknown as Env;
    let motions = [{ nome: 'Distribuição', dataHora: '2024-03-01T10:00:00.000Z' }, { nome: 'Conclusão', dataHora: '2025-06-10T10:00:00.000Z' }];
    const requests: { corpo: Item; url: string; auth: string | null }[] = [];
    datajud = (body, url, auth) => { requests.push({ corpo: body, url, auth }); return Response.json({ hits: { hits: [{ _source: { numeroProcesso: '12345671320248260100', movimentos: motions } }] } }); };
    await queryCase(withKey, t, pid);
    expect(requests[0]).toMatchObject({ url: 'https://datajud.example/api_publica_tjsp/_search', auth: 'APIKey chave-publica-de-teste', corpo: { query: { match: { numeroProcesso: '12345671320248260100' } } } });
    expect((await read(t, id, s.cookie)).alertas.filter((a) => a.tipo === 'processo')).toHaveLength(0);   // the baseline, no alert
    motions = [...motions, { nome: 'Sentença', dataHora: '2026-10-30T15:00:00.000Z' }];
    await queryCase(withKey, t, pid);
    await queryCase(withKey, t, pid);
    const alerts = (await read(t, id, s.cookie)).alertas.filter((a) => a.tipo === 'processo');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].detalhe).toMatchObject({ numero: '12345671320248260100', tribunal: 'tjsp', movimento: 'Sentença' });
    // DataJud down: the error stays visible on the case.
    datajud = () => new Response('fora', { status: 503 });
    await queryCase(withKey, t, pid);
    expect((await env.DB.prepare('SELECT erro, ultimo_movimento FROM processos WHERE id = ?').bind(pid).first())).toEqual({ erro: 'HTTP 503', ultimo_movimento: 'Sentença' });
  });
});

describe('LAI', () => {
  it('20-day deadline, 10-day extension, appeal within 10 days of notice; a due date on a day without business moves to the next business day', () => {
    expect(addDays('2026-10-01', 20)).toBe('2026-10-21');
    expect(expiry('2026-06-01', 20)).toBe('2026-06-22');   // 21/06/2026 is a Sunday
    expect(expiry('2026-10-13', 20)).toBe('2026-11-03');   // 02/11/2026 is All Souls' Day
    expect(expiry('2026-03-14', 20)).toBe('2026-04-06');   // 03/04/2026 is Good Friday; then Saturday and Sunday
    expect(withoutMasthead('2026-11-15') && withoutMasthead('2026-11-20') && !withoutMasthead('2026-11-04')).toBe(true);
    const base = { esfera: 'municipal', prorrogado_em: null, resposta_em: null, atendeu: null, recurso_em: null };
    expect(laiStatus({ ...base, protocolado_em: '2026-10-01' }, '2026-10-21')).toMatchObject({ prazo: '2026-10-21', vencido: false, diasRestantes: 0, estado: 'protocolado' });
    // 01/11 is a Sunday and 02/11 a holiday: the appeal runs until 03/11. State and municipality: the local rule may differ (the screen warns).
    expect(laiStatus({ ...base, protocolado_em: '2026-10-01' }, '2026-10-22')).toMatchObject({ vencido: true, podeRecorrer: true, tipoRecurso: 'recurso', recorrerAte: '2026-11-03', regraLocal: true, estado: 'vencido' });
    expect(laiStatus({ ...base, protocolado_em: '2026-10-01', prorrogado_em: '2026-10-15' }, '2026-10-25')).toMatchObject({ prazoFinal: '2026-11-03', vencido: false, estado: 'prorrogado' });
    expect(laiStatus({ ...base, protocolado_em: '2026-10-01', resposta_em: '2026-10-10', atendeu: 0 }, '2026-10-12')).toMatchObject({ podeRecorrer: true, tipoRecurso: 'recurso', recorrerAte: '2026-10-20', estado: 'negado' });
    // No answer from the federal Executive: a complaint (Decree no. 7,724/2012, art. 22), from the 30th day of the request, for 10 days.
    const federal = { ...base, esfera: 'federal', protocolado_em: '2026-10-01' };
    expect(laiStatus(federal, '2026-10-22')).toMatchObject({ vencido: true, tipoRecurso: 'reclamacao', recorrerDe: '2026-10-31', podeRecorrer: false, regraLocal: false });
    expect(laiStatus(federal, '2026-10-31')).toMatchObject({ podeRecorrer: true, recorrerAte: '2026-11-10' });
    // A denial at the federal level is still a recurso (appeal); the answer to the recurso closes it.
    expect(laiStatus({ ...federal, resposta_em: '2026-10-10', atendeu: 0 }, '2026-10-12')).toMatchObject({ tipoRecurso: 'recurso', podeRecorrer: true });
    expect(laiStatus({ ...base, protocolado_em: '2026-10-01', resposta_em: '2026-10-10', atendeu: 0, recurso_em: '2026-10-12', recurso_resposta_em: '2026-10-20', recurso_atendeu: 1 }, '2026-10-25'))
      .toMatchObject({ estado: 'respondido', podeRecorrer: false });
  });

  it('sentence without a source with a public body becomes a candidate; the request checks the sentence; protocol, due date, answer in the dossier and appeal', async () => {
    const { s, t, id } = await story();
    const e0 = await read(t, id, s.cookie);
    expect(e0.lai.candidatas).toHaveLength(1);
    const c = e0.lai.candidatas[0];
    expect(c).toMatchObject({ trecho: P[1], orgao: 'Prefeitura de Vila Serena' });
    expect(c.modelo).toContain('Lei nº 12.527/2011');
    expect(c.modelo).toContain('art. 11, §§ 1º e 2º');
    expect(c.modelo).toContain(P[1]);

    const create = (b: Item) => req(`${ROUTE(t, id)}/lai`, { cookie: s.cookie, body: { blocoId: c.blocoId, orgao: c.orgao, esfera: 'municipal', pedido: `${c.modelo}os contratos de publicidade de 2025.`, ...b } });
    expect((await create({ trecho: 'A Prefeitura de Vila Serena gastou R$ 4 milhões' })).status).toBe(422);
    expect((await create({ trecho: P[1], esfera: 'distrital' })).status).toBe(422);
    const ok = await create({ trecho: P[1] });
    expect(ok.status).toBe(201);
    const e1 = await ok.json<State & { pedidoId: string }>();
    expect(e1.lai.pedidos[0]).toMatchObject({ estado: 'rascunho', prazo: null });
    expect(e1.lai.candidatas).toHaveLength(0);   // the sentence already has a request

    const move = (action: string, b: Item) => req(`${ROUTE(t, id)}/lai/${e1.pedidoId}/${action}`, { cookie: s.cookie, body: b });
    expect((await move('resposta', { texto: 'Segue a planilha.', recebidaEm: todayIso(), atendeu: true })).status).toBe(409);   // no filing number
    expect((await move('protocolo', { protocolo: '00106.000123/2026-11', protocoladoEm: addDays(todayIso(), 1) })).status).toBe(422);   // no futuro
    const twentyFive = addDays(todayIso(), -25);
    expect((await move('protocolo', { protocolo: '00106.000123/2026-11', protocoladoEm: twentyFive })).status).toBe(200);
    const e2 = await read(t, id, s.cookie);
    expect(e2.lai.pedidos[0]).toMatchObject({ estado: 'vencido', prazoFinal: expiry(twentyFive, 20), podeRecorrer: true, tipoRecurso: 'recurso', regraLocal: true });
    expect(e2.lai.pedidos[0].modeloRecurso).toContain('art. 15 da Lei nº 12.527/2011');
    expect(e2.lai.pedidos[0].modeloRecurso).toContain('00106.000123/2026-11');
    expect(e2.alertas.find((a) => a.tipo === 'lai_vencido')).toMatchObject({ titulo: 'Prefeitura de Vila Serena' });

    // An answer that does not satisfy enters the dossier (official source, no link) and opens the appeal.
    expect((await move('resposta', { texto: 'A informação está em sigilo.', recebidaEm: todayIso(), atendeu: false })).status).toBe(200);
    const e3 = await read(t, id, s.cookie);
    const ev = e3.evidencias.find((x) => x.id === e3.lai.pedidos[0].respostaEvidenciaId);
    expect(ev).toMatchObject({ origem: 'lai' });
    expect(ev!.titulo).toContain('Resposta de Prefeitura de Vila Serena (LAI nº 00106.000123/2026-11');
    expect(e3.lai.pedidos[0]).toMatchObject({ estado: 'negado', podeRecorrer: true, recorrerAte: expiry(todayIso(), 10) });
    // The answer does not leave the dossier (it is the request's record): 409 with the reason.
    const remove = await req(`${ROUTE(t, id)}/evidencias/${ev!.id}`, { method: 'DELETE', cookie: s.cookie });
    expect(remove.status).toBe(409);
    expect((await remove.json<{ code: string }>()).code).toBe('evidencia_lai');
    expect((await move('resposta', { texto: 'Outra resposta ao mesmo pedido.', recebidaEm: todayIso(), atendeu: true })).status).toBe(409);   // already recorded
    expect((await move('recurso', { texto: 'curto', em: todayIso() })).status).toBe(422);
    expect((await move('recurso', { texto: e3.lai.pedidos[0].modeloRecurso, em: todayIso() })).status).toBe(200);
    expect((await read(t, id, s.cookie)).lai.pedidos[0]).toMatchObject({ estado: 'recurso', podeRecorrer: false, recursoTipo: 'recurso' });
    // The answer to the appeal is another answer, with its own evidence; once recorded, the request closes.
    expect((await move('resposta', { texto: 'Em grau de recurso, segue a planilha dos contratos.', recebidaEm: todayIso(), atendeu: true })).status).toBe(200);
    const e4 = await read(t, id, s.cookie);
    expect(e4.lai.pedidos[0]).toMatchObject({ estado: 'respondido', recursoAtendeu: true });
    expect(e4.evidencias.find((x) => x.id === e4.lai.pedidos[0].recursoEvidenciaId)!.titulo).toContain('Resposta ao recurso de Prefeitura de Vila Serena');
    expect((await move('resposta', { texto: 'Mais uma resposta.', recebidaEm: todayIso(), atendeu: true })).status).toBe(409);
    expect((await move('apagar', {})).status).toBe(404);

    // The defence package carries the LAI requests and the alerts.
    const zip = unzipSync(new Uint8Array(await (await req(`${ROUTE(t, id)}/pacote`, { method: 'GET', cookie: s.cookie })).arrayBuffer()));
    expect(JSON.parse(strFromU8(zip['lai/pedidos.json']))[0]).toMatchObject({ orgao: 'Prefeitura de Vila Serena', protocolo: '00106.000123/2026-11', atendeu: 0 });
    expect(JSON.parse(strFromU8(zip['depois/alertas.json'])).map((a: { tipo: string }) => a.tipo)).toContain('lai_vencido');
  });
});

describe('IDOR and role on the new routes', () => {
  it("another outlet can't reach it (404); reporter doesn't write (403)", async () => {
    const a = await story();
    const b = await story();
    await env.DB.prepare("INSERT INTO evidencias (id, tenant_id, texto_id, url, titulo, r2_texto, hash, hash_atual, mudou_em) VALUES (?, ?, ?, ?, 'Relatório', 'evidencias/x.txt', 'h1', 'h2', datetime('now'))")
      .bind(`ev-${a.id.slice(0, 6)}`, a.t, a.id, SOURCE).run();
    const ea = await read(a.t, a.id, a.s.cookie);
    const alert = ea.alertas[0].id;
    const c = ea.lai.candidatas[0];
    const { pedidoId: requestId } = await (await req(`${ROUTE(a.t, a.id)}/lai`, { cookie: a.s.cookie, body: { blocoId: c.blocoId, trecho: c.trecho, orgao: c.orgao, esfera: 'municipal', pedido: c.modelo } })).json<{ pedidoId: string }>();
    const routes: [string, Item][] = [
      [`${ROUTE(a.t, a.id)}/alertas/${alert}/resolver`, { acao: 'ignorado' }],
      [`${ROUTE(a.t, a.id)}/alertas/${alert}/post`, { tipo: 'errata', nota: 'O valor certo é R$ 2 milhões, não R$ 3 milhões.' }],
      [`${ROUTE(a.t, a.id)}/lai`, { blocoId: c.blocoId, trecho: c.trecho, orgao: c.orgao, esfera: 'municipal', pedido: c.modelo }],
      [`${ROUTE(a.t, a.id)}/lai/${requestId}/protocolo`, { protocolo: '123', protocoladoEm: todayIso() }],
    ];
    for (const [p, body] of routes) expect((await req(p, { cookie: b.s.cookie, body })).status, p).toBe(404);
    // Outlet A's alert and request through outlet B's text routes: 404.
    expect((await req(`${ROUTE(b.t, b.id)}/alertas/${alert}/resolver`, { cookie: b.s.cookie, body: { acao: 'ignorado' } })).status).toBe(404);
    expect((await req(`${ROUTE(b.t, b.id)}/lai/${requestId}/protocolo`, { cookie: b.s.cookie, body: { protocolo: '123', protocoladoEm: todayIso() } })).status).toBe(404);

    const rep = await register('Repórter Só');
    await seedMember(a.t, rep.userId, 'reporter');
    for (const [p, body] of routes) expect((await req(p, { cookie: rep.cookie, body })).status, p).toBe(403);
    expect((await req(ROUTE(a.t, a.id), { cookie: rep.cookie })).status).toBe(200);
    expect((await read(a.t, a.id, a.s.cookie)).alertas[0].estado).toBe('aberto');
  });
});

// ── review (Codex, 03/11): duplicate alert post; LAI cron through the queue; a re-read source becomes an alert without opening the text ──

describe('review: living story without opening the text', () => {
  const alertsInDb = async (id: string) =>
    (await env.DB.prepare('SELECT tipo FROM alertas WHERE texto_id = ? ORDER BY tipo').bind(id).all<{ tipo: string }>()).results.map((a) => a.tipo);
  const message = (body: unknown) => {
    const m = { body, attempts: 1, acks: 0, retries: 0, ack() { m.acks++; }, retry() { m.retries++; } };
    return m;
  };

  it('two clicks on "post de errata" at the same time: one post only; the second is told the alert is already closed', async () => {
    const { s, t, id } = await story();
    await env.DB.prepare("INSERT INTO evidencias (id, tenant_id, texto_id, url, titulo, r2_texto, hash, hash_atual, mudou_em) VALUES (?, ?, ?, ?, 'Relatório', 'evidencias/x.txt', 'h1', 'h2', datetime('now'))")
      .bind(`ev-${id.slice(0, 6)}`, t, id, SOURCE).run();
    const alert = (await read(t, id, s.cookie)).alertas[0];
    const e = { ...env, PRODUCAO_WORKFLOW: wf } as unknown as Env;
    const note = { tipo: 'errata' as const, nota: 'O valor certo é R$ 2 milhões, não R$ 3 milhões.' };
    const r = await Promise.allSettled([postAlert(e, t, id, alert.id, s.userId, note), postAlert(e, t, id, alert.id, s.userId, note)]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect((r.find((x) => x.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ codigo: 'fechado' });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM pautas WHERE texto_id = ? AND tipo_post = 'errata'").bind(id).first('n')).toBe(1);
  });

  it('LAI cron: one text per queue message; the message creates the overdue-deadline alert', async () => {
    const { s, t, id } = await story();
    await env.DB.prepare("INSERT INTO pedidos_lai (id, tenant_id, texto_id, bloco_id, trecho, orgao, esfera, pedido, protocolo, protocolado_em, por) VALUES (?, ?, ?, 'p1', 'x', 'Prefeitura de Vila Serena', 'municipal', 'Cópia dos contratos.', '123', ?, ?)")
      .bind(crypto.randomUUID(), t, id, addDays(todayIso(), -60), s.userId).run();
    const sent: unknown[] = [];
    const { syncDeadlinesLai } = await import('../src/lib/living');
    const jobs = { ...env, MONITOR_QUEUE: { sendBatch: async (b: { body: unknown }[]) => { sent.push(...b.map((x) => x.body)); } } } as unknown as Env;
    expect(await syncDeadlinesLai(jobs)).toBeGreaterThanOrEqual(1);
    const my = sent.find((b) => (b as { textoId: string }).textoId === id);
    expect(my).toEqual({ tipo: 'lai', tenantId: t, textoId: id });
    expect(await alertsInDb(id)).toEqual([]);
    const { queue } = await import('../src/monitor/consumer');
    const m = message(my);
    await queue({ messages: [m] } as never, env as unknown as Env, {} as never);
    expect(m.acks).toBe(1);
    expect(await alertsInDb(id)).toEqual(['lai_vencido']);
  });

  it('a source re-read by the queue that stopped responding becomes an alert right away (without anyone opening the story)', async () => {
    const { t, id } = await story();
    const ev = `ef-${id.slice(0, 6)}`;
    await env.DB.prepare("INSERT INTO evidencias (id, tenant_id, texto_id, url, titulo, r2_texto, hash, hash_atual, falhas) VALUES (?, ?, ?, 'https://diario.example/edicao', 'Diário oficial', 'evidencias/y.txt', 'h1', 'h1', 2)")
      .bind(ev, t, id).run();
    const { queue } = await import('../src/monitor/consumer');
    const m = message({ tipo: 'evidencia', tenantId: t, evidenciaId: ev });
    await queue({ messages: [m] } as never, env as unknown as Env, {} as never);
    expect(m.acks).toBe(1);
    expect(await alertsInDb(id)).toEqual(['fonte_fora']);
  });
});

// ── review 2 (Codex, 03/11): optional holidays, a closing window, the next instance, package, a post that did not go out ──

describe('review 2: LAI and alerts', () => {
  it("federal body deadline skips Carnival and Corpus Christi; state and municipal don't; the person's never", () => {
    expect(expiry('2026-01-27', 20, true)).toBe('2026-02-18');   // 16 e 17/02/2026: Carnaval
    expect(expiry('2026-01-27', 20)).toBe('2026-02-16');
    const base = { prorrogado_em: null, resposta_em: null, atendeu: null, recurso_em: null, protocolado_em: '2026-05-15' };
    expect(laiStatus({ ...base, esfera: 'federal' }, '2026-05-20').prazo).toBe('2026-06-05');   // 04/06/2026: Corpus Christi
    expect(laiStatus({ ...base, esfera: 'municipal' }, '2026-05-20').prazo).toBe('2026-06-04');
  });

  it('the appeal window closes: after the end the screen says it passed; denied again, the next instance is outside the app', () => {
    const base = { esfera: 'municipal', prorrogado_em: null, recurso_em: null, protocolado_em: '2026-10-01', resposta_em: '2026-10-10', atendeu: 0 };
    expect(laiStatus(base, '2026-10-20')).toMatchObject({ recorrerAte: '2026-10-20', prazoRecursoPassou: false });
    expect(laiStatus(base, '2026-10-21')).toMatchObject({ prazoRecursoPassou: true });
    expect(laiStatus({ ...base, recurso_em: '2026-10-15', recurso_resposta_em: '2026-10-30', recurso_atendeu: 0 }, '2026-11-01'))
      .toMatchObject({ estado: 'negado', podeRecorrer: false, proximaInstanciaFora: true });
  });

  it("an appeal dated after the deadline isn't recorded; on the last day, it is; the package carries the appeal and its answer", async () => {
    const { s, t, id } = await story();
    const c = (await read(t, id, s.cookie)).lai.candidatas[0];
    const { pedidoId: requestId } = await (await req(`${ROUTE(t, id)}/lai`, { cookie: s.cookie, body: { blocoId: c.blocoId, trecho: c.trecho, orgao: c.orgao, esfera: 'municipal', pedido: `${c.modelo}os contratos.` } })).json<{ pedidoId: string }>();
    const move = (action: string, b: Item) => req(`${ROUTE(t, id)}/lai/${requestId}/${action}`, { cookie: s.cookie, body: b });
    expect((await move('protocolo', { protocolo: '123', protocoladoEm: addDays(todayIso(), -70) })).status).toBe(200);
    const p = (await read(t, id, s.cookie)).lai.pedidos[0] as LaiRequest & { prazoRecursoPassou: boolean };
    expect(p.prazoRecursoPassou).toBe(true);
    const late = await move('recurso', { texto: p.modeloRecurso, em: todayIso() });
    expect(late.status).toBe(422);
    expect((await late.json<{ code: string }>()).code).toBe('fora_do_prazo');
    expect((await move('recurso', { texto: p.modeloRecurso, em: p.recorrerAte })).status).toBe(200);
    expect((await move('resposta', { texto: 'Em grau de recurso, o pedido foi negado.', recebidaEm: todayIso(), atendeu: false })).status).toBe(200);
    const zip = unzipSync(new Uint8Array(await (await req(`${ROUTE(t, id)}/pacote`, { method: 'GET', cookie: s.cookie })).arrayBuffer()));
    const e = await read(t, id, s.cookie);
    expect(JSON.parse(strFromU8(zip['lai/pedidos.json']))[0]).toMatchObject({
      recurso_tipo: 'recurso', recurso_em: p.recorrerAte, recurso_resposta_em: todayIso(), recurso_atendeu: 0, recurso_evidencia_id: e.lai.pedidos[0].recursoEvidenciaId,
    });
  });

  it("the alert's post didn't start (the database refused the piece): the alert goes back to open, the lead is discarded, and trying again makes the post", async () => {
    const { s, t, id } = await story();
    await env.DB.prepare("INSERT INTO evidencias (id, tenant_id, texto_id, url, titulo, r2_texto, hash, hash_atual, mudou_em) VALUES (?, ?, ?, ?, 'Relatório', 'evidencias/x.txt', 'h1', 'h2', datetime('now'))")
      .bind(`ev-${id.slice(0, 6)}`, t, id, SOURCE).run();
    const alert = (await read(t, id, s.cookie)).alertas[0];
    const note = { tipo: 'errata' as const, nota: 'O valor certo é R$ 2 milhões, não R$ 3 milhões.' };
    const db = new Proxy(env.DB, { get(target, p) {
      if (p === 'prepare') return (sql: string) => { if (sql.startsWith('INSERT INTO pecas')) throw new Error('D1 fora'); return target.prepare(sql); };
      const v = Reflect.get(target, p); return typeof v === 'function' ? v.bind(target) : v;
    } });
    const broken = { ...env, DB: db, PRODUCAO_WORKFLOW: wf } as unknown as Env;
    await expect(postAlert(broken, t, id, alert.id, s.userId, note)).rejects.toThrow();
    expect((await read(t, id, s.cookie)).alertas[0]).toMatchObject({ estado: 'aberto', pecaId: null });
    const { results } = await env.DB.prepare("SELECT status FROM pautas WHERE texto_id = ? AND tipo_post = 'errata'").bind(id).all<{ status: string }>();
    expect(results.map((r) => r.status)).toEqual(['descartada']);
    const r = await postAlert({ ...env, PRODUCAO_WORKFLOW: wf } as unknown as Env, t, id, alert.id, s.userId, note);
    expect(r.pecaId).toBeTruthy();
    expect((await read(t, id, s.cookie)).alertas[0]).toMatchObject({ estado: 'resolvido', pecaId: r.pecaId });
  });
});

// ── review 3 (Codex, 03/11): reopening the alert does not override production that has started ───────────────────────

describe('review 3: alert and production', () => {
  it("someone else started the lead's production in the middle of the compensation: the alert stays with the lead (doesn't reopen)", async () => {
    const { s, t, id } = await story();
    await env.DB.prepare("INSERT INTO evidencias (id, tenant_id, texto_id, url, titulo, r2_texto, hash, hash_atual, mudou_em) VALUES (?, ?, ?, ?, 'Relatório', 'evidencias/x.txt', 'h1', 'h2', datetime('now'))")
      .bind(`ev-${id.slice(0, 6)}`, t, id, SOURCE).run();
    const alert = (await read(t, id, s.cookie)).alertas[0];
    // This request's piece fails; instead of the discard, the lead goes into production (the other person won the race).
    const db = new Proxy(env.DB, { get(target, p) {
      if (p === 'prepare') return (sql: string) => {
        if (sql.startsWith('INSERT INTO pecas')) throw new Error('D1 fora');
        if (sql.startsWith("UPDATE pautas SET status = 'descartada'")) return target.prepare("UPDATE pautas SET status = 'em_producao' WHERE id = ? AND tenant_id = ? AND status IN ('sugerida', 'aceita')");
        return target.prepare(sql);
      };
      const v = Reflect.get(target, p); return typeof v === 'function' ? v.bind(target) : v;
    } });
    await expect(postAlert({ ...env, DB: db, PRODUCAO_WORKFLOW: wf } as unknown as Env, t, id, alert.id, s.userId, { tipo: 'errata', nota: 'O valor certo é R$ 2 milhões, não R$ 3 milhões.' })).rejects.toThrow();
    const lead = await env.DB.prepare("SELECT id, status FROM pautas WHERE texto_id = ? AND tipo_post = 'errata'").bind(id).first<{ id: string; status: string }>();
    expect(lead?.status).toBe('em_producao');
    const a = await env.DB.prepare('SELECT estado, pauta_id FROM alertas WHERE id = ?').bind(alert.id).first<{ estado: string; pauta_id: string }>();
    expect(a).toEqual({ estado: 'resolvido', pauta_id: lead!.id });
  });
});
