// Review desk (Phase 2 of docs/PRODUTO-2026-11-02.md): the journalist's text checked against the dossier. The AI
// checks, it does not write; evidence only counts with the literal passage in the stored text; the daily cron warns of
// a changed source; sending back to Docs swaps only what changed and Google refuses if the document changed since.
// Pages, Google and DeepSeek are a simulated fetch (.example domains).
import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkEvidence, checkText, enqueueDossier, requestsReturn, resolveCheck, INSTRUCTIONS_CHECK } from '../src/lib/desk';
import { texts } from '../src/shell/texts';
import type { AppEnv } from '../src/shell/tenancy';
import { register, req, seedMember, seedTenant } from './helpers';

const SOURCE = 'https://camara.example/relatorio-transporte';
const sourceBody = (n: number) =>
  `A Câmara aprovou em 2025 a renovação de ${n} contratos de ônibus sem licitação, segundo o relatório da comissão de transporte. ` +
  'O documento lista as empresas e os valores pagos em cada um dos contratos renovados nos últimos três anos, com as datas das votações.';
const htmlSource = (n: number) => `<html><head><title>Relatório da comissão de transporte</title></head><body><article><h1>Relatório da comissão</h1><p>${sourceBody(n)}</p></article></body></html>`;
const TEXT = [
  'Contratos sem concorrência',
  'A Câmara renovou 12 contratos de ônibus sem licitação em 2025.',
  'O vereador Fulano de Tal desviou dinheiro dos contratos.',
  'A cidade gasta mais com transporte do que com saúde.',
  'Eu acho que isso diz muito sobre a cidade.',
].join('\n');

let pages: Record<string, () => Response>;
let deepseekAnswer: () => object;
let deepseek: { system: string; user: string }[];
let batches: { url: string; corpo: { requests: unknown[]; writeControl: { requiredRevisionId: string } } }[];

beforeEach(() => {
  deepseek = [];
  batches = [];
  pages = { [SOURCE]: () => new Response(htmlSource(12), { headers: { 'content-type': 'text/html; charset=utf-8' } }) };
  deepseekAnswer = () => ({ afirmacoes: [] });
  const original = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('deepseek')) {
      const body = JSON.parse(String(init?.body));
      deepseek.push({ system: body.messages[0].content, user: body.messages[1].content });
      return Response.json({ choices: [{ message: { content: JSON.stringify(deepseekAnswer()) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    }
    if (url.endsWith(':batchUpdate')) batches.push({ url, corpo: JSON.parse(String(init?.body)) });
    const p = pages[url] ?? pages[url.split('?')[0]];
    if (p) return p();
    if (url.includes('.example') || url.includes('googleapis.com')) return new Response('não achei', { status: 404, headers: { 'content-type': 'text/html' } });
    return original(input, init);
  });
});
afterEach(() => vi.restoreAllMocks());

const line = <T>(sql: string, ...binds: unknown[]) => env.DB.prepare(sql).bind(...binds).first<T>();

async function tenantAuthor() {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO tenants (id, slug, nome, modo, marca_json, plano) VALUES (?, ?, 'Cartas da Orla', 'autoral', ?, 'cortesia')")
    .bind(id, `m-${id.slice(0, 8)}`, JSON.stringify({ nome: 'Cartas da Orla', assinatura: 'Ana Ribeiro' })).run();
  return id;
}

async function readyDesk() {
  const s = await register();
  const t = await tenantAuthor();
  await seedMember(t, s.userId, 'admin');
  const res = await req(`/api/t/${t}/textos`, { cookie: s.cookie, body: { texto: TEXT } });
  expect(res.status).toBe(201);
  const { texto: text } = await res.json<{ texto: { id: string; titulo: string; versao: number } }>();
  return { s, t, id: text.id, texto: text };
}

/** What the model answers: three claims, one with the evidence's literal passage, one with an invented passage, one risk. */
const threeMarks = (evidence: string) => ({
  afirmacoes: [
    { paragrafo: 0, trecho: 'A Câmara renovou 12 contratos de ônibus sem licitação em 2025.', estado: 'com_evidencia', risco: null, evidencia: `E:${evidence}`,
      trecho_evidencia: 'A Câmara aprovou em 2025 a renovação de 12 contratos de ônibus sem licitação', explicacao: 'O relatório da comissão traz o número.' },
    { paragrafo: 2, trecho: 'A cidade gasta mais com transporte do que com saúde.', estado: 'com_evidencia', risco: null, evidencia: evidence,
      trecho_evidencia: 'O transporte custa mais que a saúde', explicacao: 'O relatório compara os gastos.' },
    { paragrafo: 1, trecho: 'O vereador Fulano de Tal desviou dinheiro dos contratos.', estado: 'risco', risco: 'acusacao_sem_condenacao', evidencia: null,
      trecho_evidencia: null, explicacao: 'Acusa pessoa identificada de crime sem condenação nem fonte oficial.' },
  ],
});

describe('check', () => {
  it("three marks: evidence only with the literal excerpt in the saved text; an invented excerpt falls back to no source; the body doesn't change", async () => {
    const { s, t, id } = await readyDesk();
    const ev = await req(`/api/t/${t}/textos/${id}/evidencias`, { cookie: s.cookie, body: { url: SOURCE } });
    expect(ev.status).toBe(201);
    const { evidenciaId: evidenceId } = await ev.json<{ evidenciaId: string }>();
    deepseekAnswer = () => threeMarks(evidenceId);

    const res = await req(`/api/t/${t}/textos/${id}/conferir`, { cookie: s.cookie, body: {} });
    expect(res.status).toBe(200);
    const d = await res.json<{ texto: { paragrafos: { texto: string }[]; conferidoVersao: number; versao: number }; afirmacoes: Record<string, unknown>[] }>();
    expect(d.afirmacoes.map((a) => [a.paragrafo, a.estado])).toEqual([[0, 'com_evidencia'], [1, 'risco'], [2, 'sem_fonte']]);
    expect(d.afirmacoes[0]).toMatchObject({ evidenciaId: evidenceId, evidenciaTrecho: expect.stringContaining('renovação de 12 contratos'), inicio: 0 });
    expect(d.afirmacoes[2]).toMatchObject({ evidenciaId: null, evidenciaTrecho: null, explicacao: 'O trecho citado como evidência não está no texto salvo da fonte.' });
    expect(d.afirmacoes[1]).toMatchObject({ risco: 'acusacao_sem_condenacao' });
    // The check does not write: the body is the pasted one (the first line became the title).
    expect(d.texto.paragrafos.map((p) => p.texto)).toEqual(TEXT.split('\n').slice(1));
    expect(d.texto.conferidoVersao).toBe(d.texto.versao);
    // The prompt says to check without writing and carries the dossier with the evidence's stored text.
    expect(deepseek[0].system).toBe(INSTRUCTIONS_CHECK);
    expect(deepseek[0].system).toMatch(/never rewrite the text, never suggest a new sentence/);
    expect(deepseek[0].user).toContain(`[E:${evidenceId}]`);
    expect(deepseek[0].user).toContain('renovação de 12 contratos');
  });

  it('model response validated: an excerpt outside the paragraph goes, overlap goes, a risk without a category becomes no source', () => {
    const ps = ['A Câmara renovou 12 contratos em 2025.', 'Outro parágrafo com um fato.'];
    const saved = new Map([['e1', 'Relatório: a Câmara renovou 12 contratos em 2025, diz a comissão.']]);
    const r = resolveCheck({ afirmacoes: [
      { paragrafo: 0, trecho: 'renovou 12 contratos', estado: 'com_evidencia', evidencia: 'e1', trecho_evidencia: 'a Câmara renovou 12 contratos em 2025', explicacao: 'ok' },
      { paragrafo: 0, trecho: '12 contratos em 2025', estado: 'sem_fonte' },
      { paragrafo: 1, trecho: 'frase que não está lá', estado: 'sem_fonte' },
      { paragrafo: 1, trecho: 'um fato', estado: 'risco', risco: 'inventada' },
      { paragrafo: 9, trecho: 'qualquer', estado: 'sem_fonte' },
    ] }, ps, saved);
    expect(r.map((a) => [a.paragrafo, a.trecho, a.estado, a.evidenciaId])).toEqual([
      [0, 'renovou 12 contratos', 'com_evidencia', 'e1'],
      [1, 'um fato', 'sem_fonte', null],
    ]);
    expect(() => resolveCheck({ outra: 1 }, ps, saved)).toThrow();
    // Truly literal: the same passage with other spacing (or joining paragraphs) is not a citation.
    const loose = resolveCheck({ afirmacoes: [
      { paragrafo: 0, trecho: 'renovou 12 contratos', estado: 'com_evidencia', evidencia: 'e1', trecho_evidencia: 'a Câmara  renovou 12\ncontratos em 2025' },
    ] }, ps, saved);
    expect(loose.map((a) => [a.estado, a.evidenciaId])).toEqual([['sem_fonte', null]]);
  });

  it('saving with an old version gives 409 and changes nothing; saving with the right one checks the new version', async () => {
    const { s, t, id, texto: text } = await readyDesk();
    const ok = await req(`/api/t/${t}/textos/${id}`, { method: 'PUT', cookie: s.cookie, body: { versao: text.versao, paragrafos: ['Um parágrafo novo.'] } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ texto: { versao: text.versao + 1, conferidoVersao: text.versao + 1 } });
    const old = await req(`/api/t/${t}/textos/${id}`, { method: 'PUT', cookie: s.cookie, body: { versao: text.versao, paragrafos: ['Outra coisa.'] } });
    expect(old.status).toBe(409);
    expect(await old.json()).toMatchObject({ code: 'versao', versao: text.versao + 1 });
    expect(JSON.parse((await line<{ p: string }>('SELECT paragrafos_json AS p FROM textos WHERE id = ?', id))!.p)).toEqual(['Um parágrafo novo.']);
  });

  it("a refused save and an old check that failed don't erase the new version's marks", async () => {
    const { s, t, id, texto: text } = await readyDesk();
    deepseekAnswer = () => ({ afirmacoes: [{ paragrafo: 0, trecho: 'Um parágrafo novo', estado: 'sem_fonte', explicacao: 'x' }] });
    await req(`/api/t/${t}/textos/${id}`, { method: 'PUT', cookie: s.cookie, body: { versao: text.versao, paragrafos: ['Um parágrafo novo.'] } });
    const marks = () => line<{ n: number }>('SELECT COUNT(*) AS n FROM afirmacoes WHERE texto_id = ?', id);
    expect(await marks()).toEqual({ n: 1 });
    // A late PUT of version 1: 409 and version 2's mark stays.
    expect((await req(`/api/t/${t}/textos/${id}`, { method: 'PUT', cookie: s.cookie, body: { versao: text.versao, paragrafos: ['Atrasado.'] } })).status).toBe(409);
    expect(await marks()).toEqual({ n: 1 });
    // A check that reads the block and fails after a save changed its text: the error does not touch the new block
    // (the result only counts for the hash that was checked).
    vi.mocked(globalThis.fetch).mockImplementationOnce(async () => {
      await env.DB.prepare("UPDATE blocos SET hash = 'de-outro-salvamento' WHERE texto_id = ?").bind(id).run();
      return new Response('fora', { status: 503 });
    });
    expect(await checkText(env, t, id, true)).toEqual({ ok: false });
    expect(await line('SELECT hash, estado, erro FROM blocos WHERE texto_id = ?', id)).toEqual({ hash: 'de-outro-salvamento', estado: 'conferido', erro: null });
    expect(await marks()).toEqual({ n: 1 });
  });
});

describe('monitored dossier', () => {
  it('the daily cron enqueues the evidence; a changed page marks "mudou" with a single event; back to the original, the warning goes away', async () => {
    const { s, t, id } = await readyDesk();
    const { evidenciaId: evidenceId } = await (await req(`/api/t/${t}/textos/${id}/evidencias`, { cookie: s.cookie, body: { url: SOURCE } })).json<{ evidenciaId: string }>();
    await env.DB.prepare("UPDATE evidencias SET conferida_em = datetime('now', '-2 days') WHERE id = ?").bind(evidenceId).run();
    const queue = vi.spyOn(env.MONITOR_QUEUE, 'sendBatch').mockResolvedValue(undefined as never);
    expect(await enqueueDossier(env)).toBeGreaterThanOrEqual(1);
    const bodies = queue.mock.calls.flatMap(([msgs]) => [...msgs].map((m) => m.body));
    expect(bodies).toContainEqual({ tipo: 'evidencia', tenantId: t, evidenciaId: evidenceId });

    pages[SOURCE] = () => new Response(htmlSource(13), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    await checkEvidence(env, t, evidenceId);
    await checkEvidence(env, t, evidenceId);
    expect((await line<{ mudou_em: string | null }>('SELECT mudou_em FROM evidencias WHERE id = ?', evidenceId))!.mudou_em).toBeTruthy();
    expect(await line("SELECT COUNT(*) AS n FROM eventos WHERE tipo = 'evidencia.mudou' AND ref_id = ?", id)).toEqual({ n: 1 });
    const list = await (await req(`/api/t/${t}/textos`, { cookie: s.cookie })).json<{ textos: { id: string; fonteMudou: boolean }[] }>();
    expect(list.textos.find((x) => x.id === id)?.fonteMudou).toBe(true);

    pages[SOURCE] = () => new Response(htmlSource(12), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    await checkEvidence(env, t, evidenceId);
    expect((await line<{ mudou_em: string | null }>('SELECT mudou_em FROM evidencias WHERE id = ?', evidenceId))!.mudou_em).toBeNull();
  });

  it('removing the evidence: what it supported is left without a source', async () => {
    const { s, t, id } = await readyDesk();
    const { evidenciaId: evidenceId } = await (await req(`/api/t/${t}/textos/${id}/evidencias`, { cookie: s.cookie, body: { url: SOURCE } })).json<{ evidenciaId: string }>();
    deepseekAnswer = () => threeMarks(evidenceId);
    await req(`/api/t/${t}/textos/${id}/conferir`, { cookie: s.cookie, body: {} });
    const d = await (await req(`/api/t/${t}/textos/${id}/evidencias/${evidenceId}`, { method: 'DELETE', cookie: s.cookie })).json<{ afirmacoes: { estado: string; evidenciaId: string | null }[]; evidencias: unknown[] }>();
    expect(d.evidencias).toHaveLength(0);
    expect(d.afirmacoes.map((a) => a.estado)).toEqual(['sem_fonte', 'risco', 'sem_fonte']);
    expect(d.afirmacoes.every((a) => a.evidenciaId === null)).toBe(true);
  });
});

describe('isolation per outlet', () => {
  it("a text from one outlet doesn't appear or open in another; an outlet that isn't author has no Texts; reporter only reads", async () => {
    const { t, id } = await readyDesk();
    const other = await register();
    const t2 = await tenantAuthor();
    await seedMember(t2, other.userId, 'admin');
    expect((await (await req(`/api/t/${t2}/textos`, { cookie: other.cookie })).json<{ textos: unknown[] }>()).textos).toEqual([]);
    expect((await req(`/api/t/${t2}/textos/${id}`, { cookie: other.cookie })).status).toBe(404);
    expect((await req(`/api/t/${t2}/textos/${id}/conferir`, { cookie: other.cookie, body: {} })).status).toBe(404);
    expect((await req(`/api/t/${t2}/textos/${id}/evidencias`, { cookie: other.cookie, body: { url: SOURCE } })).status).toBe(404);
    expect((await req(`/api/t/${t}/textos/${id}`, { cookie: other.cookie })).status).toBe(404);

    const local = await seedTenant();
    await seedMember(local, other.userId, 'admin');
    expect((await req(`/api/t/${local}/textos`, { cookie: other.cookie })).status).toBe(404);

    const reporter = await register();
    await seedMember(t, reporter.userId, 'reporter');
    expect((await req(`/api/t/${t}/textos/${id}`, { cookie: reporter.cookie })).status).toBe(200);
    expect((await req(`/api/t/${t}/textos/${id}/conferir`, { cookie: reporter.cookie, body: {} })).status).toBe(403);
  });
});

describe('return to Google Docs', () => {
  const DOC_ID = 'doc-ficticio-mesa-1';
  const envGoogle = { ...env, GOOGLE_CLIENT_ID: 'cliente.apps.example', GOOGLE_CLIENT_SECRET: 'segredo-ficticio', GOOGLE_API_KEY: 'chave-ficticia', GOOGLE_PROJECT_NUMBER: '123456' };
  const pair = (home: number, text: string, style = 'NORMAL_TEXT') => ({ startIndex: home, endIndex: home + text.length + 1, paragraph: { paragraphStyle: { namedStyleType: style }, elements: [{ textRun: { content: `${text}\n` } }] } });
  function docBody(texts: string[]) {
    let i = 1;
    return { content: [{ sectionBreak: {} }, ...texts.map((x, k) => { const p = pair(i, x, k === 0 ? 'TITLE' : 'NORMAL_TEXT'); i = p.endIndex; return p; })] };
  }
  const ORIGINAL = ['Contratos sem concorrência', 'A Câmara renovou 12 contratos.', 'Ninguém foi ouvido.'];

  /** The app as the API builds it: session and outlet already resolved, the desk's sub-app with the Google env. */
  function app(userId: string) {
    return new Hono<AppEnv>()
      .use('/t/:tenantId/*', async (c, next) => {
        c.set('user', { id: userId } as never);
        c.set('tenant', { id: c.req.param('tenantId')!, slug: 's', nome: 'n', papel: 'admin' });
        await next();
      })
      .route('/t/:tenantId/textos', texts);
  }
  const call = (a: ReturnType<typeof app>, path: string, method = 'POST', body?: unknown) =>
    a.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, envGoogle);

  async function fromDocsText() {
    const s = await register();
    const t = await tenantAuthor();
    await env.DB.prepare(`INSERT INTO account (id, "accountId", "providerId", "userId", "accessToken", "accessTokenExpiresAt", scope, "createdAt", "updatedAt")
      VALUES (?, ?, 'google', ?, 'token-ficticio', ?, 'openid,email,profile,https://www.googleapis.com/auth/drive.file', ?, ?)`)
      .bind(crypto.randomUUID(), `g-${s.userId}`, s.userId, new Date(Date.now() + 3600_000).toISOString(), new Date().toISOString(), new Date().toISOString()).run();
    let review = 'rev-1', current = ORIGINAL;
    pages[`https://docs.googleapis.com/v1/documents/${DOC_ID}`] = () => Response.json({ documentId: DOC_ID, title: 'Rascunho', revisionId: review, body: docBody(current) });
    const a = app(s.userId);
    const res = await call(a, `/t/${t}/textos`, 'POST', { docs: DOC_ID });
    expect(res.status).toBe(201);
    const d = await res.json<{ texto: { id: string; versao: number; paragrafos: { texto: string }[] }; podeDevolver: boolean }>();
    return { a, t, d, mudarDocs: (r: string, x: string[]) => { review = r; current = x; } };
  }

  it('only the edited paragraph goes, with the read revision; afterwards the revision and the positions become the new ones', async () => {
    const { a, t, d, mudarDocs: changeDocs } = await fromDocsText();
    expect(d.podeDevolver).toBe(true);
    expect(d.texto.paragrafos.map((p) => p.texto)).toEqual(ORIGINAL);
    const edited = [ORIGINAL[0], 'A Câmara renovou 12 contratos sem licitação.', ORIGINAL[2]];
    expect((await call(a, `/t/${t}/textos/${d.texto.id}`, 'PUT', { versao: d.texto.versao, paragrafos: edited })).status).toBe(200);

    pages[`https://docs.googleapis.com/v1/documents/${DOC_ID}:batchUpdate`] = () => {
      changeDocs('rev-2', edited);
      return Response.json({ documentId: DOC_ID, writeControl: { requiredRevisionId: 'rev-2' } });
    };
    const res = await call(a, `/t/${t}/textos/${d.texto.id}/devolver`, 'POST', {});
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ devolvidos: 1 });
    expect(batches).toHaveLength(1);
    expect(batches[0].corpo.writeControl).toEqual({ requiredRevisionId: 'rev-1' });
    // Docs paragraph 2: starts at 28 (1 + 26 + 1) and ends before the break.
    const home = 1 + ORIGINAL[0].length + 1;
    expect(batches[0].corpo.requests).toEqual([
      { deleteContentRange: { range: { startIndex: home, endIndex: home + ORIGINAL[1].length } } },
      { insertText: { location: { index: home }, text: edited[1] } },
    ]);
    expect(await line('SELECT docs_revisao FROM textos WHERE id = ?', d.texto.id)).toEqual({ docs_revisao: 'rev-2' });
  });

  it("someone edits the Doc right after the return: the snapshot doesn't become the one there, and the next return is refused", async () => {
    const { a, t, d, mudarDocs: changeDocs } = await fromDocsText();
    const edited = [ORIGINAL[0], 'Editado na mesa.', ORIGINAL[2]];
    await call(a, `/t/${t}/textos/${d.texto.id}`, 'PUT', { versao: d.texto.versao, paragrafos: edited });
    pages[`https://docs.googleapis.com/v1/documents/${DOC_ID}:batchUpdate`] = () => {
      // Sending back creates rev-2; before the read, someone else edits in Docs (rev-3).
      changeDocs('rev-3', [...edited, 'Escrito no Docs logo depois.']);
      return Response.json({ documentId: DOC_ID, writeControl: { requiredRevisionId: 'rev-2' } });
    };
    expect((await call(a, `/t/${t}/textos/${d.texto.id}/devolver`, 'POST', {})).status).toBe(200);
    expect(await line('SELECT docs_revisao FROM textos WHERE id = ?', d.texto.id)).toEqual({ docs_revisao: 'rev-1' });
  });

  it('the Doc changed after the import: Google refuses, nothing is written, and the response carries what changed there', async () => {
    const { a, t, d, mudarDocs: changeDocs } = await fromDocsText();
    await call(a, `/t/${t}/textos/${d.texto.id}`, 'PUT', { versao: d.texto.versao, paragrafos: [ORIGINAL[0], 'Editado na mesa.', ORIGINAL[2]] });
    changeDocs('rev-9', [ORIGINAL[0], ORIGINAL[1], 'Ninguém foi ouvido até sexta.', 'Parágrafo novo no Docs.']);
    pages[`https://docs.googleapis.com/v1/documents/${DOC_ID}:batchUpdate`] = () =>
      Response.json({ error: { code: 400, message: 'The required revision ID rev-1 does not match the latest revision.', status: 'FAILED_PRECONDITION' } }, { status: 400 });
    const res = await call(a, `/t/${t}/textos/${d.texto.id}/devolver`, 'POST', {});
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: 'mudou_no_docs',
      mudancas: [{ antes: 'Ninguém foi ouvido.', depois: 'Ninguém foi ouvido até sexta.' }, { antes: null, depois: 'Parágrafo novo no Docs.' }],
    });
    expect(await line('SELECT docs_revisao FROM textos WHERE id = ?', d.texto.id)).toEqual({ docs_revisao: 'rev-1' });

    // Reimporting brings the text from there (the desk's edits are lost) with the new revision.
    const version = (await line<{ versao: number }>('SELECT versao FROM textos WHERE id = ?', d.texto.id))!.versao;
    // With the old version (someone else saved meanwhile): 409 and nothing changes.
    const old = await call(a, `/t/${t}/textos/${d.texto.id}/reimportar`, 'POST', { versao: version - 1 });
    expect(old.status).toBe(409);
    expect(await old.json()).toMatchObject({ code: 'versao', versao: version });
    const r = await call(a, `/t/${t}/textos/${d.texto.id}/reimportar`, 'POST', { versao: version });
    expect(r.status).toBe(200);
    expect((await r.json<{ texto: { paragrafos: { texto: string }[] } }>()).texto.paragrafos.map((p) => p.texto)).toEqual(
      [ORIGINAL[0], ORIGINAL[1], 'Ninguém foi ouvido até sexta.', 'Parágrafo novo no Docs.']);
    expect(await line('SELECT docs_revisao FROM textos WHERE id = ?', d.texto.id)).toEqual({ docs_revisao: 'rev-9' });
  });

  it("requests per tab: each request carries the paragraph's tabId; added at the end and removed from the end of the tab", () => {
    const docs = {
      fimAbas: { 't.0': 40, 't.1': 30 },
      paragrafos: [
        { texto: 'Um', inicio: 1, fim: 4, estilo: null, html: 'Um', aba: 't.0' },
        { texto: 'Dois', inicio: 4, fim: 40, estilo: null, html: 'Dois', aba: 't.0' },
        { texto: 'Três', inicio: 1, fim: 30, estilo: null, html: 'Três', aba: 't.1' },
      ],
    };
    const { pedidos: requests, trocados: swapped } = requestsReturn(docs, ['Um', 'Dois mudado', 'Três', 'Quatro']);
    expect(swapped).toBe(2);
    expect(requests).toEqual([
      { deleteContentRange: { range: { startIndex: 4, endIndex: 39, tabId: 't.0' } } },
      { insertText: { location: { index: 4, tabId: 't.0' }, text: 'Dois mudado' } },
      { insertText: { location: { index: 29, tabId: 't.1' }, text: '\nQuatro' } },
    ]);
    // Removing the last one in the tab: takes the break before it; alone in the tab, the empty paragraph stays (the final break does not go).
    expect(requestsReturn(docs, ['Um', 'Três']).pedidos).toEqual([{ deleteContentRange: { range: { startIndex: 3, endIndex: 39, tabId: 't.0' } } }]);
    expect(requestsReturn(docs, ['Um', 'Dois']).pedidos).toEqual([{ deleteContentRange: { range: { startIndex: 1, endIndex: 29, tabId: 't.1' } } }]);
  });
});
