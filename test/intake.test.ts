// Phase D2: + New (POST pautas). A link, an account and a screenshot become a manual lead at the top, idempotent by
// content; the monitor recognises the link brought by hand. Fake triage and vision models (AI is remote), fake link
// fetch. IDOR and roles.
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { articleReport, readJsonModel } from '../src/lib/intake';
import { extractArticle } from '../src/lib/article';
import { loadLead } from '../src/lib/lead';
import { triageArticle, triageDocument } from '../src/lib/triage';
import { register, eventsOf, req, seedMember, seedLead, seedPiece, seedTenant } from './helpers';

const LINK = 'https://noticias.exemplo.com.br/2026/11/feira-muda-de-rua';
const BODY = 'A feira livre de quinta-feira muda para a Rua Montenegro a partir desta semana, informou a Prefeitura de Guarujá. ' +
  'Segundo a Secretaria de Abastecimento, a mudança atende pedido dos moradores e vale por tempo indeterminado. ' +
  'As barracas começam a montar às 5h.';
const HTML = `<html><head><meta property="og:title" content="Feira livre muda de rua no Guarujá">
<script type="application/ld+json">${JSON.stringify({ '@type': 'NewsArticle', articleBody: BODY })}</script></head>
<body><h1>Feira livre muda de rua no Guarujá</h1><p>${BODY}</p></body></html>`;
const REPORT = 'Acidente entre dois carros fecha uma faixa da Avenida Puglisi, em Santos, agora há pouco. ' +
  'Ninguém se feriu, segundo os motoristas no local.';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const PRINT = { noticia: true, titulo: 'Prefeitura abre inscrições para curso de salva-vidas', texto: 'Vagas para moradores com mais de 18 anos  \n\n As inscrições vão até sexta-feira no site da prefeitura e são gratuitas.' };

let calls: { modelo: string }[] = [];
let vision: () => unknown;
let pages: Record<string, Response | (() => Response)> = {};
// Triage: news, city section, no place (the account talks about Santos, outside the test outlet's area).
const TRIAGE = { tipo: 'acontecimento', tipo_span: 0, editoria: 'cidade', editoria_span: 0, ocorreu_em: null, data_span: null, locais: [] };

beforeEach(() => {
  calls = [];
  vision = () => JSON.stringify(PRINT);
  pages = { [LINK]: () => new Response(HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } }) };
  vi.spyOn(env.AI, 'run').mockImplementation((async (model: string) => {
    calls.push({ modelo: model });
    if (model.includes('vision')) return { response: vision() };
    return { response: TRIAGE };
  }) as never);
  const original = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const p = pages[url];
    if (p) return typeof p === 'function' ? p() : p;
    if (url.startsWith('https://noticias.exemplo.com.br/')) return new Response('não achei', { status: 404, headers: { 'content-type': 'text/html' } });
    return original(input, init);
  });
});
afterEach(() => vi.restoreAllMocks());

async function member(role: 'admin' | 'editor' | 'reporter' = 'editor') {
  const s = await register();
  const t = await seedTenant();
  await seedMember(t, s.userId, role);
  return { s, t };
}
const created = (t: string, cookie: string, body: unknown) => req(`/api/t/${t}/pautas`, { cookie, body });
const print = (t: string, cookie: string, body: Uint8Array, type = 'image/png') => req(`/api/t/${t}/pautas`, { cookie, cru: { tipo: type, corpo: body as Uint8Array<ArrayBuffer> } });
const line = <T>(sql: string, ...binds: unknown[]) => env.DB.prepare(sql).bind(...binds).first<T>();
const triages = () => calls.filter((c) => !c.modelo.includes('vision')).length;

describe('POST pautas: report', () => {
  it('becomes a suggested manual lead, outside the area too, with the source "relato de @…" and at the top of Ideas', async () => {
    const { s, t } = await member();
    await seedLead(t);   // one from the monitor, to see the order
    const res = await created(t, s.cookie, { texto: `  ${REPORT}  ` });
    expect(res.status).toBe(201);
    const { pautaId: leadId, situacao: status } = await res.json<{ pautaId: string; situacao: string }>();
    expect(status).toBe('nova');

    const p = await line<Record<string, unknown>>('SELECT * FROM pautas WHERE id = ?', leadId);
    expect(p!.score).toBeGreaterThan(1000);
    expect(p).toMatchObject({ status: 'sugerida', origem: 'manual', titulo: 'Acidente entre dois carros fecha uma faixa da Avenida Puglisi, em Santos, agora há pouco.' });
    const docId = JSON.parse(p!.documento_ids_json as string)[0];
    const doc = await line<Record<string, string>>('SELECT * FROM documentos WHERE id = ?', docId);
    // Santos is not in the area: the monitor would discard it (fora_area); requested by hand it becomes a lead anyway.
    expect(doc).toMatchObject({ status: 'triado', triagem: 'fora_area', url: `relato:${docId}` });
    expect(doc!.hash_texto).toMatch(/^relato:[0-9a-f]{64}$/);
    expect(await env.MEDIA.get(`texto/${t}/${docId}.txt`).then((o) => o?.text())).toContain('Ninguém se feriu');
    const source = await line<{ nome: string; tipo: string }>('SELECT nome, tipo FROM fontes WHERE id = ?', doc!.fonte_id);
    expect(source).toEqual({ nome: 'relato de @teste', tipo: 'manual' });
    // Whoever requested stays in the document's event.
    const [ev] = (await eventsOf(docId)).filter((e) => e.tipo === 'documento.triado');
    expect(ev.payload).toMatchObject({ por: s.userId, manual: true, pautaId: leadId });

    const { pautas: leads } = await (await req(`/api/t/${t}/pautas`, { cookie: s.cookie })).json<{ pautas: Record<string, unknown>[] }>();
    expect(leads[0]).toMatchObject({ id: leadId, origem: 'manual', fonte: 'relato de @teste', nfatos: 3 });
    // The account's source does not appear in the sources' health.
    const { fontes: sources } = await (await req(`/api/t/${t}/fontes`, { cookie: s.cookie })).json<{ fontes: { nome: string }[] }>();
    expect(sources.map((f) => f.nome)).not.toContain('relato de @teste');
  });

  it('same text (spaces aside) returns the same idea without calling the model again; discarded, it returns a copy', async () => {
    const { s, t } = await member();
    const first = await (await created(t, s.cookie, { texto: REPORT })).json<{ pautaId: string }>();
    const res = await created(t, s.cookie, { texto: REPORT.replace(/ /g, '  ') });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pautaId: first.pautaId, situacao: 'existente', status: 'sugerida' });
    expect(triages()).toBe(1);

    await req(`/api/t/${t}/pautas/${first.pautaId}/descartar`, { cookie: s.cookie, body: {} });
    const back = await created(t, s.cookie, { texto: REPORT });
    expect(back.status).toBe(201);
    const { pautaId: leadId, situacao: status } = await back.json<{ pautaId: string; situacao: string }>();
    expect(status).toBe('de_volta');
    expect(leadId).not.toBe(first.pautaId);
    const [old, copy] = await Promise.all([first.pautaId, leadId].map((id) => line<Record<string, unknown>>('SELECT * FROM pautas WHERE id = ?', id)));
    expect(copy!.score).toBeGreaterThan(1000);
    expect(copy).toMatchObject({ status: 'sugerida', origem: 'manual', fato_ids_json: old!.fato_ids_json, documento_ids_json: old!.documento_ids_json });
    expect(triages()).toBe(1);
    expect((await eventsOf(leadId)).map((e) => e.tipo)).toEqual(['pauta.de_volta']);
  });

  it('idea already in production: returns the same one, with its post and its status', async () => {
    const { s, t } = await member();
    const { pautaId: leadId } = await (await created(t, s.cookie, { texto: REPORT })).json<{ pautaId: string }>();
    await env.DB.prepare("UPDATE pautas SET status = 'em_producao' WHERE id = ?").bind(leadId).run();
    expect(await (await created(t, s.cookie, { texto: REPORT })).json()).toEqual({ pautaId: leadId, situacao: 'existente', status: 'em_producao', peca: null });
    const piece = await seedPiece(t, leadId, { status: 'aprovada' });
    expect(await (await created(t, s.cookie, { texto: REPORT })).json()).toEqual({ pautaId: leadId, situacao: 'existente', status: 'em_producao', peca: { id: piece, status: 'aprovada' } });
  });

  it('identical requests at the same time: one idea only', async () => {
    const { s, t } = await member();
    const rs = await Promise.all([0, 1, 2].map(() => created(t, s.cookie, { texto: REPORT })));
    expect(rs.every((r) => r.ok)).toBe(true);
    const ids = new Set(await Promise.all(rs.map((r) => r.json<{ pautaId: string }>().then((b) => b.pautaId))));
    expect(ids.size).toBe(1);
    expect((await line<{ n: number }>("SELECT COUNT(*) AS n FROM pautas WHERE tenant_id = ? AND origem = 'manual'", t))!.n).toBe(1);
  });

  it('short, long or no body → 400', async () => {
    const { s, t } = await member();
    expect((await created(t, s.cookie, { texto: 'Acidente agora.' })).status).toBe(400);
    expect((await created(t, s.cookie, { texto: 'x '.repeat(2100) })).status).toBe(400);
    const r = await created(t, s.cookie, { outra: 1 });
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ code: 'pedido_invalido' });
    expect(triages()).toBe(0);
  });

  it('title: the first sentence; an enormous sentence is cut at a word and the body stays whole', async () => {
    const short = await articleReport('Ponte fecha amanhã. Desvio pela Avenida Puglisi.', 'relato:x', new Date());
    expect([short.titulo, short.texto]).toEqual(['Ponte fecha amanhã.', 'Desvio pela Avenida Puglisi.']);
    const long = 'Moradores do bairro Enseada relatam ' + 'falta de água desde cedo '.repeat(10) + 'e pedem resposta.';
    const a = await articleReport(long, 'relato:x', new Date());
    expect(a.titulo.length).toBeLessThanOrEqual(121);
    expect(a.titulo.endsWith('…')).toBe(true);
    expect(a.texto).toBe(long);
  });
});

describe('POST pautas: link', () => {
  it("reads the news through the monitor's path; the source is the site; the monitor later recognizes the same text", async () => {
    const { s, t } = await member();
    const res = await created(t, s.cookie, { url: LINK });
    expect(res.status).toBe(201);
    const { pautaId: leadId } = await res.json<{ pautaId: string }>();
    const p = await line<Record<string, string>>('SELECT * FROM pautas WHERE id = ?', leadId);
    expect(p).toMatchObject({ origem: 'manual', titulo: 'Feira livre muda de rua no Guarujá' });
    const doc = await line<Record<string, string | null>>('SELECT * FROM documentos WHERE id = ?', JSON.parse(p!.documento_ids_json)[0]);
    expect(doc).toMatchObject({ url: LINK, fonte_id: null, status: 'triado' });
    expect(doc!.hash_texto).toMatch(/^link:[0-9a-f]{64}$/);
    expect(await env.MEDIA.get(doc!.r2_bruto!)).not.toBeNull();
    const { pautas: leads } = await (await req(`/api/t/${t}/pautas`, { cookie: s.cookie })).json<{ pautas: Record<string, unknown>[] }>();
    expect(leads[0]).toMatchObject({ id: leadId, fonte: 'noticias.exemplo.com.br' });

    // The feed brings the same story: the monitor's new document becomes a duplicate, without a new lead.
    const monitorDoc = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO documentos (id, tenant_id, url, hash_texto) VALUES (?, ?, ?, 'url:x')").bind(monitorDoc, t, LINK).run();
    await triageDocument(env, t, monitorDoc);
    expect(await line('SELECT status, triagem FROM documentos WHERE id = ?', monitorDoc)).toEqual({ status: 'descartado', triagem: 'duplicado' });
    expect((await line<{ n: number }>('SELECT COUNT(*) AS n FROM pautas WHERE tenant_id = ?', t))!.n).toBe(1);
  });

  it('news the monitor already suggested → the same idea', async () => {
    const { s, t } = await member();
    const monitorDoc = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO documentos (id, tenant_id, url, hash_texto) VALUES (?, ?, ?, 'url:y')").bind(monitorDoc, t, LINK).run();
    // The monitor of a topical outlet without topics accepts everything: a monitor lead.
    await env.DB.prepare("UPDATE tenants SET modo = 'tematico' WHERE id = ?").bind(t).run();
    await triageDocument(env, t, monitorDoc);
    const fromMonitor = await line<{ id: string }>("SELECT id FROM pautas WHERE tenant_id = ? AND origem = 'monitor'", t);
    expect(fromMonitor).not.toBeNull();
    const res = await created(t, s.cookie, { url: LINK });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pautaId: fromMonitor!.id, situacao: 'existente', status: 'sugerida' });
    // Requested again, it moves to the top (the list shows the first 100).
    expect((await line<{ score: number }>('SELECT score FROM pautas WHERE id = ?', fromMonitor!.id))!.score).toBeGreaterThan(1000);
  });

  it('monitor news that already left the list: the link brings its copy back, without a new document', async () => {
    const { s, t } = await member();
    const monitorDoc = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO documentos (id, tenant_id, url, hash_texto) VALUES (?, ?, ?, 'url:w')").bind(monitorDoc, t, LINK).run();
    await env.DB.prepare("UPDATE tenants SET modo = 'tematico' WHERE id = ?").bind(t).run();
    await triageDocument(env, t, monitorDoc);
    const fromMonitor = (await line<{ id: string }>("SELECT id FROM pautas WHERE tenant_id = ?", t))!.id;
    await req(`/api/t/${t}/pautas/${fromMonitor}/descartar`, { cookie: s.cookie, body: {} });
    const before = triages();
    const r = await (await created(t, s.cookie, { url: LINK })).json<{ pautaId: string; situacao: string }>();
    expect(r.situacao).toBe('de_volta');
    expect(await line('SELECT documento_ids_json, origem FROM pautas WHERE id = ?', r.pautaId)).toEqual({ documento_ids_json: JSON.stringify([monitorDoc]), origem: 'manual' });
    expect((await line<{ n: number }>('SELECT COUNT(*) AS n FROM documentos WHERE tenant_id = ?', t))!.n).toBe(1);
    expect(triages()).toBe(before);
  });

  it('an idea requested again goes ahead of the other requested ones', async () => {
    const { s, t } = await member();
    const a = await (await created(t, s.cookie, { texto: REPORT })).json<{ pautaId: string }>();
    await new Promise((ok) => setTimeout(ok, 5));
    const b = await (await created(t, s.cookie, { texto: `${REPORT} Outro detalhe do relato.` })).json<{ pautaId: string }>();
    const order = async () => (await (await req(`/api/t/${t}/pautas`, { cookie: s.cookie })).json<{ pautas: { id: string }[] }>()).pautas.map((p) => p.id);
    expect(await order()).toEqual([b.pautaId, a.pautaId]);
    await new Promise((ok) => setTimeout(ok, 5));
    await created(t, s.cookie, { texto: REPORT });
    expect(await order()).toEqual([a.pautaId, b.pautaId]);
  });

  it("invalid link → 400; page that doesn't respond or isn't news → 422, nothing recorded", async () => {
    const { s, t } = await member();
    for (const url of ['javascript:alert(1)', 'http://localhost:8787/x', 'http://10.0.0.1/a', 'notícia', '']) {
      const r = await created(t, s.cookie, { url });
      expect(r.status, url).toBe(400);
      expect(await r.json()).toMatchObject({ code: 'url_invalida' });
    }
    const r404 = await created(t, s.cookie, { url: 'https://noticias.exemplo.com.br/nao-existe' });
    expect(r404.status).toBe(422);
    expect(await r404.json()).toMatchObject({ code: 'link_ilegivel' });
    pages['https://noticias.exemplo.com.br/curta'] = new Response('<html><head><title>Oi</title></head><body><p>curto</p></body></html>', { headers: { 'content-type': 'text/html' } });
    expect((await created(t, s.cookie, { url: 'https://noticias.exemplo.com.br/curta' })).status).toBe(422);
    expect((await line<{ n: number }>('SELECT COUNT(*) AS n FROM documentos WHERE tenant_id = ?', t))!.n).toBe(0);
    expect(triages()).toBe(0);
  });
});

describe('POST pautas: screenshot', () => {
  it("the text read becomes the news; the image stays in R2; the same screenshot isn't read again", async () => {
    const { s, t } = await member();
    const res = await print(t, s.cookie, PNG);
    expect(res.status).toBe(201);
    const { pautaId: leadId } = await res.json<{ pautaId: string }>();
    const p = await line<Record<string, string>>('SELECT * FROM pautas WHERE id = ?', leadId);
    expect(p).toMatchObject({ origem: 'manual', titulo: PRINT.titulo });
    const doc = await line<Record<string, string>>('SELECT * FROM documentos WHERE id = ?', JSON.parse(p!.documento_ids_json)[0]);
    expect(doc!.hash_texto).toMatch(/^print:[0-9a-f]{64}$/);
    expect(doc!.url).toBe(`print:${doc!.id}`);
    expect(new Uint8Array(await (await env.MEDIA.get(doc!.r2_bruto))!.arrayBuffer())).toEqual(PNG);
    expect(await line('SELECT nome FROM fontes WHERE id = ?', doc!.fonte_id)).toEqual({ nome: 'print de notícia' });
    // One paragraph per line: a thin line without a full stop does not stick to the next sentence.
    expect(await env.MEDIA.get(`texto/${t}/${doc!.id}.txt`).then((o) => o?.text())).toBe(`${PRINT.titulo}\n\nVagas para moradores com mais de 18 anos\nAs inscrições vão até sexta-feira no site da prefeitura e são gratuitas.`);
    expect(calls.map((c) => c.modelo.includes('vision'))).toEqual([true, false]);

    const new_of = await print(t, s.cookie, PNG);
    expect(await new_of.json()).toEqual({ pautaId: leadId, situacao: 'existente', status: 'sugerida' });
    expect(calls).toHaveLength(2);
  });

  it('the model responds with text around the JSON', () => {
    expect(readJsonModel('Claro! Aqui está:\n```json\n{"noticia":true,"titulo":"A","texto":"B"}\n```')).toEqual({ noticia: true, titulo: 'A', texto: 'B' });
    expect(readJsonModel('não consigo')).toBeNull();
    expect(readJsonModel({ noticia: false })).toEqual({ noticia: false });
  });

  it('no readable news → 422 and nothing recorded; wrong format → 400; too big → 413', async () => {
    const { s, t } = await member();
    vision = () => '{"noticia":false,"titulo":"","texto":""}';
    const r = await print(t, s.cookie, PNG);
    expect(r.status).toBe(422);
    expect(await r.json()).toMatchObject({ code: 'print_sem_noticia' });
    vision = () => 'Desculpe, não consigo ler.';
    expect((await print(t, s.cookie, PNG)).status).toBe(422);
    expect((await line<{ n: number }>('SELECT COUNT(*) AS n FROM documentos WHERE tenant_id = ?', t))!.n).toBe(0);
    expect((await print(t, s.cookie, PNG, 'image/gif')).status).toBe(400);
    expect((await print(t, s.cookie, new Uint8Array(4 * 1024 * 1024 + 1))).status).toBe(413);
  });
});

describe('POST pautas: access', () => {
  it("reporter also brings news; whoever isn't from the outlet gets 404 and nothing is recorded; Origin from another site, 403", async () => {
    const { s, t } = await member('reporter');
    expect((await created(t, s.cookie, { texto: REPORT })).status).toBe(201);

    const intruder = await register();
    const other = await seedTenant();
    await seedMember(other, intruder.userId, 'admin');
    const r = await created(t, intruder.cookie, { texto: `${REPORT} Outro detalhe.` });
    expect(r.status).toBe(404);
    expect((await line<{ n: number }>("SELECT COUNT(*) AS n FROM pautas WHERE tenant_id = ? AND origem = 'manual'", t))!.n).toBe(1);

    const csrf = await req(`/api/t/${t}/pautas`, { cookie: s.cookie, body: { texto: `${REPORT} Mais.` }, origin: 'https://evil.example' });
    expect(csrf.status).toBe(403);
    expect((await line<{ n: number }>("SELECT COUNT(*) AS n FROM pautas WHERE tenant_id = ? AND origem = 'manual'", t))!.n).toBe(1);
  });
});

describe('POST pautas: races (Codex review)', () => {
  it('identical screenshots at the same time, with different readings: one idea, and the facts are in the stored text', async () => {
    const { s, t } = await member();
    let n = 0;
    vision = () => JSON.stringify({ ...PRINT, texto: `${PRINT.texto} Leitura ${++n} do modelo.` });
    const rs = await Promise.all([0, 1, 2].map(() => print(t, s.cookie, PNG)));
    expect(rs.every((r) => r.ok)).toBe(true);
    const ids = new Set(await Promise.all(rs.map((r) => r.json<{ pautaId: string }>().then((b) => b.pautaId))));
    expect(ids.size).toBe(1);
    const p = await line<{ fato_ids_json: string; documento_ids_json: string }>('SELECT fato_ids_json, documento_ids_json FROM pautas WHERE id = ?', [...ids][0]);
    const docId = JSON.parse(p!.documento_ids_json)[0];
    const text = (await (await env.MEDIA.get(`texto/${t}/${docId}.txt`))!.text());
    const { results } = await env.DB.prepare('SELECT texto, span_inicio, span_fim FROM fatos WHERE documento_id = ?').bind(docId).all<{ texto: string; span_inicio: number; span_fim: number }>();
    expect(results.length).toBeGreaterThan(0);
    for (const f of results) expect(text.slice(f.span_inicio, f.span_fim)).toBe(f.texto);
  });

  it('the same discarded idea requested several times at once comes back only once', async () => {
    const { s, t } = await member();
    const { pautaId: leadId } = await (await created(t, s.cookie, { texto: REPORT })).json<{ pautaId: string }>();
    await req(`/api/t/${t}/pautas/${leadId}/descartar`, { cookie: s.cookie, body: {} });
    const rs = await Promise.all([0, 1, 2].map(() => created(t, s.cookie, { texto: REPORT }).then((r) => r.json<{ pautaId: string; situacao: string }>())));
    expect(new Set(rs.map((r) => r.pautaId)).size).toBe(1);
    expect(rs.map((r) => r.situacao).sort()).toEqual(['de_volta', 'existente', 'existente']);
    expect((await line<{ n: number }>("SELECT COUNT(*) AS n FROM pautas WHERE tenant_id = ? AND status = 'sugerida'", t))!.n).toBe(1);
  });

  it('monitor and link with the same text at the same time: the batch of whoever arrives later aborts', async () => {
    const { s, t } = await member();
    const art = { ...(await articleReport(BODY, LINK, new Date())), url: LINK };
    // The link brought by hand already stored the document while the monitor was triaging its own.
    await env.DB.prepare("INSERT INTO documentos (id, tenant_id, url, hash_texto, status) VALUES (?, ?, ?, ?, 'triado')").bind(crypto.randomUUID(), t, LINK, `link:${art.sha256}`).run();
    const monitorDoc = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO documentos (id, tenant_id, url, hash_texto) VALUES (?, ?, ?, 'url:z')").bind(monitorDoc, t, LINK).run();
    await env.DB.prepare("UPDATE tenants SET modo = 'tematico' WHERE id = ?").bind(t).run();
    await expect(triageArticle(env, t, monitorDoc, art, new Date())).rejects.toThrow();
    expect(await line('SELECT status FROM documentos WHERE id = ?', monitorDoc)).toEqual({ status: 'novo' });

    // The other way round: the monitor's document became an active idea while the link was being triaged.
    const t2 = await seedTenant();
    const mDoc = crypto.randomUUID(), lDoc = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO documentos (id, tenant_id, url, hash_texto, status) VALUES (?, ?, ?, ?, 'triado')").bind(mDoc, t2, LINK, art.sha256),
      env.DB.prepare("INSERT INTO pautas (id, tenant_id, status, origem, titulo, documento_ids_json) VALUES (?, ?, 'sugerida', 'monitor', 'x', ?)").bind(crypto.randomUUID(), t2, JSON.stringify([mDoc])),
      env.DB.prepare('INSERT INTO documentos (id, tenant_id, url, hash_texto) VALUES (?, ?, ?, ?)').bind(lDoc, t2, LINK, `link:${art.sha256}`),
    ]);
    await expect(triageArticle(env, t2, lDoc, art, new Date(), { por: s.userId, hash: `link:${art.sha256}` })).rejects.toThrow();
    expect((await line<{ n: number }>('SELECT COUNT(*) AS n FROM pautas WHERE tenant_id = ?', t2))!.n).toBe(1);
  });
});

describe('monitor and a request that fell midway', () => {
  it("the link's document still new doesn't silence the monitor", async () => {
    const { t } = await member();
    await env.DB.prepare("UPDATE tenants SET modo = 'tematico' WHERE id = ?").bind(t).run();
    // The manual request died after storing the document: it stays in 'novo' with the link's final hash.
    const real = await extractArticle(HTML, LINK);
    await env.DB.prepare('INSERT INTO documentos (id, tenant_id, url, hash_texto) VALUES (?, ?, ?, ?)').bind(crypto.randomUUID(), t, LINK, `link:${real.sha256}`).run();
    const monitorDoc = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO documentos (id, tenant_id, url, hash_texto) VALUES (?, ?, ?, 'url:m')").bind(monitorDoc, t, LINK).run();
    await triageDocument(env, t, monitorDoc);
    expect(await line('SELECT status, triagem FROM documentos WHERE id = ?', monitorDoc)).toEqual({ status: 'triado', triagem: 'noticia' });
    expect((await line<{ n: number }>("SELECT COUNT(*) AS n FROM pautas WHERE tenant_id = ? AND origem = 'monitor'", t))!.n).toBe(1);
  });
});

describe('brought-in idea: review and production', () => {
  it("the review brings the screenshot image (signed) with the facts; the link doesn't", async () => {
    const { s, t } = await member();
    const { pautaId: leadId } = await (await print(t, s.cookie, PNG)).json<{ pautaId: string }>();
    const piece = await seedPiece(t, leadId);
    const { fatos: facts } = await (await req(`/api/t/${t}/pecas/${piece}`, { cookie: s.cookie })).json<{ fatos: { print: string | null; fonte: string }[] }>();
    expect(facts.length).toBeGreaterThan(0);
    for (const f of facts) {
      expect(f.fonte).toBe('print de notícia');
      expect(f.print).toMatch(/^.*\/media\/bruto\/.+\.png\?exp=\d+&sig=/);
    }
    const image = await req(new URL(facts[0].print!).pathname + new URL(facts[0].print!).search, { cookie: s.cookie });
    expect(image.status).toBe(200);

    const { pautaId: fromLink } = await (await created(t, s.cookie, { url: LINK })).json<{ pautaId: string }>();
    const other = await seedPiece(t, fromLink);
    const r = await (await req(`/api/t/${t}/pecas/${other}`, { cookie: s.cookie })).json<{ fatos: { print: string | null }[] }>();
    expect(r.fatos.every((f) => f.print === null)).toBe(true);
  });

  it("report from outside the area without an identified city doesn't inherit the outlet's city in production", async () => {
    const { s, t } = await member();
    const { pautaId: leadId } = await (await created(t, s.cookie, { texto: REPORT })).json<{ pautaId: string }>();
    expect((await loadLead(env, t, leadId)).cidade).toBeNull();
    // The monitor's one without a municipality keeps the outlet's.
    const { pautaId: fromMonitor } = await seedLead(t);
    expect((await loadLead(env, t, fromMonitor)).cidade).toBe('Guarujá');
  });
});
