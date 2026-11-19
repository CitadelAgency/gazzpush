// The Story editor (Phase 2): a document with an id per block, a check per block (only what changed), a streaming
// response, a visible "not checked" per block, and the old opened text converted. DeepSeek and pages are a simulated
// fetch (.example domains).
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { docParagraphs, inlineHtmlDocs, cleanDoc, substackDoc, type In } from '../src/lib/doc';
import { INSTRUCTIONS_CHECK } from '../src/lib/desk';
import { register, req, seedMember } from './helpers';

const SOURCE = 'https://camara.example/relatorio-transporte';
const sourceBody = 'A Câmara aprovou em 2025 a renovação de 12 contratos de ônibus sem licitação, segundo o relatório da comissão de transporte. ' +
  'O documento lista as empresas e os valores pagos em cada um dos contratos renovados nos últimos três anos.';
const htmlSource = `<html><head><title>Relatório</title></head><body><article><h1>Relatório da comissão</h1><p>${sourceBody}</p></article></body></html>`;

let calls: { system: string; user: string }[];
let answer: (user: string) => object | Response;
beforeEach(() => {
  calls = [];
  answer = () => ({ afirmacoes: [] });
  const original = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('deepseek')) {
      const body = JSON.parse(String(init?.body));
      calls.push({ system: body.messages[0].content, user: body.messages[1].content });
      const r = answer(body.messages[1].content);
      if (r instanceof Response) return r;
      return Response.json({ choices: [{ message: { content: JSON.stringify(r) } }], usage: { prompt_tokens: 1000, completion_tokens: 100 } });
    }
    if (url === SOURCE) return new Response(htmlSource, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    if (url.includes('.example')) return new Response('não achei', { status: 404 });
    return original(input, init);
  });
});
afterEach(() => vi.restoreAllMocks());

/** The paragraph the request asks to check (the end of the prompt). */
const block = (user: string) => user.split('CHECK ONLY THIS PARAGRAPH\n[P0] ')[1] ?? '';
/** Answers by marking, in each block, the sentences of this list that are in it. */
const marking = (list: { trecho: string; estado: string; risco?: string; evidencia?: string; trecho_evidencia?: string }[]) => (user: string) => ({
  afirmacoes: list.filter((a) => block(user).includes(a.trecho)).map((a) => ({ paragrafo: 0, risco: null, evidencia: null, trecho_evidencia: null, explicacao: 'x', ...a })),
});

async function tenantAuthor() {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO tenants (id, slug, nome, modo, marca_json, plano) VALUES (?, ?, 'Cartas da Orla', 'autoral', '{}', 'cortesia')").bind(id, `e-${id.slice(0, 8)}`).run();
  return id;
}

const P = ['A Câmara renovou 12 contratos de ônibus sem licitação em 2025.', 'O prefeito disse que vai rever os contratos.', 'Eu acho que isso diz muito sobre a cidade.'];
const docOf = (ps: string[], ids = ps.map((_, i) => `b${i}`)): In => ({ type: 'doc', content: ps.map((p, i) => ({ type: 'paragraph', attrs: { id: ids[i] }, content: [{ type: 'text', text: p }] })) });

type State = { texto: { versao: number; conferidoVersao: number | null; doc: In }; blocos: { id: string; estado: string; erro: string | null }[]; afirmacoes: { blocoId: string; trecho: string; estado: string; inicio: number }[] };

async function story() {
  const s = await register();
  const t = await tenantAuthor();
  await seedMember(t, s.userId, 'admin');
  const { texto: text } = await (await req(`/api/t/${t}/textos`, { cookie: s.cookie, body: { titulo: 'Contratos', texto: P.join('\n') } })).json<{ texto: { id: string; versao: number } }>();
  const { evidenciaId: evidenceId } = await (await req(`/api/t/${t}/textos/${text.id}/evidencias`, { cookie: s.cookie, body: { url: SOURCE } })).json<{ evidenciaId: string }>();
  const save = async (doc: In, version: number) => req(`/api/t/${t}/textos/${text.id}`, { method: 'PUT', cookie: s.cookie, body: { doc, versao: version, titulo: 'Contratos' } });
  const check = async (body: object = {}) => (await req(`/api/t/${t}/textos/${text.id}/conferir`, { cookie: s.cookie, body: body })).json<State>();
  return { s, t, id: text.id, evidenciaId: evidenceId, salvar: save, conferir: check };
}

describe('editor document', () => {
  it('old text opens converted (ids p0, p1…) without rewriting the database; Docs brings subheadings, bold and links', async () => {
    const { s, t, id } = await story();
    const d = await (await req(`/api/t/${t}/textos/${id}`, { cookie: s.cookie })).json<State>();
    expect(d.texto.doc.content!.map((n) => n.attrs?.id)).toEqual(['p0', 'p1', 'p2']);
    expect(d.blocos.map((b) => b.estado)).toEqual(['pendente', 'pendente', 'pendente']);
    expect(await env.DB.prepare('SELECT doc_json FROM textos WHERE id = ?').bind(id).first('doc_json')).toBeNull();

    const doc = docParagraphs(['Título de seção', 'Leia o relatório completo.'], [
      { texto: 'Título de seção', estilo: 'HEADING_2', html: 'Título de seção' },
      { texto: 'Leia o relatório completo.', estilo: 'NORMAL_TEXT', html: 'Leia o <a href="https://camara.example/r"><b>relatório</b></a> completo.' },
    ]);
    expect(doc.content![0]).toMatchObject({ type: 'heading', attrs: { id: 'p0', level: 2 } });
    expect(doc.content![1].content).toEqual([
      { type: 'text', text: 'Leia o ' },
      { type: 'text', text: 'relatório', marks: [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://camara.example/r' } }] },
      { type: 'text', text: ' completo.' },
    ]);
    // HTML that does not match the paragraph: plain text, never swapped text.
    expect(inlineHtmlDocs('<b>outra coisa</b>', 'Leia.')).toEqual([{ type: 'text', text: 'Leia.' }]);
  });

  it('the document coming from the screen is cleaned: nodes and links outside the list go, a repeated or invalid id gets another', () => {
    let n = 0;
    const clean = cleanDoc({
      type: 'doc', content: [
        { type: 'heading', attrs: { id: 'a', level: 1 }, content: [{ type: 'text', text: 'Seção' }] },
        { type: 'paragraph', attrs: { id: 'a' }, content: [{ type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }, { type: 'bold' }, { type: 'strike' }] }] },
        { type: 'codeBlock', content: [{ type: 'text', text: 'x' }] },
        { type: 'blockquote', content: [{ type: 'paragraph', attrs: { id: '<script>' }, content: [{ type: 'text', text: 'citação' }] }] },
      ],
    }, () => `novo${++n}`);
    expect(clean).toEqual({ type: 'doc', content: [
      { type: 'heading', attrs: { id: 'a', level: 2 }, content: [{ type: 'text', text: 'Seção' }] },
      { type: 'paragraph', attrs: { id: 'novo1' }, content: [{ type: 'text', text: 'link', marks: [{ type: 'bold' }] }] },
      { type: 'blockquote', content: [{ type: 'paragraph', attrs: { id: 'novo2' }, content: [{ type: 'text', text: 'citação' }] }] },
    ] });
    expect(substackDoc('Título', clean)).toEqual({
      html: '<h1>Título</h1>\n<h2>Seção</h2>\n<p><strong>link</strong></p>\n<blockquote><p>citação</p></blockquote>',
      texto: 'Título\n\nSeção\n\nlink\n\ncitação',
    });
  });
});

describe('check per block', () => {
  it('editing a block: only it is checked again; the marks of the others stay; the prompt brings the dossier first and the block at the end', async () => {
    const { evidenciaId: evidenceId, salvar: save, conferir: check } = await story();
    answer = marking([
      { trecho: P[0], estado: 'com_evidencia', evidencia: evidenceId, trecho_evidencia: 'A Câmara aprovou em 2025 a renovação de 12 contratos de ônibus sem licitação' },
      { trecho: 'O prefeito disse que vai rever os contratos.', estado: 'sem_fonte' },
    ]);
    expect((await save(docOf(P), 1)).status).toBe(200);
    let d = await check();
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.system === INSTRUCTIONS_CHECK)).toBe(true);
    // Dossier first, the whole text after, the block at the end: the prefix is the same in all three requests.
    const prefix = (u: string) => u.slice(0, u.indexOf('CHECK ONLY THIS PARAGRAPH'));
    expect(new Set(calls.map((c) => prefix(c.user))).size).toBe(1);
    expect(calls[0].user.indexOf('DOSSIER')).toBe(0);
    expect(calls[0].user.indexOf(`[E:${evidenceId}]`)).toBeLessThan(calls[0].user.indexOf('WHOLE TEXT'));
    expect(d.blocos.map((b) => b.estado)).toEqual(['conferido', 'conferido', 'conferido']);
    expect(d.texto.conferidoVersao).toBe(d.texto.versao);
    expect(d.afirmacoes.map((a) => [a.blocoId, a.estado])).toEqual([['b0', 'com_evidencia'], ['b1', 'sem_fonte']]);

    // Writes before the mark in block b1: only b1 goes to the model; b0's mark stays.
    calls = [];
    const edited = [P[0], `Ontem, ${P[1]}`, P[2]];
    expect((await save(docOf(edited), d.texto.versao)).status).toBe(200);
    d = await check();
    expect(calls).toHaveLength(1);
    expect(block(calls[0].user)).toBe(edited[1]);
    expect(d.afirmacoes.map((a) => [a.blocoId, a.estado, a.inicio])).toEqual([['b0', 'com_evidencia', 0], ['b1', 'sem_fonte', 7]]);
  });

  it('streaming: one line per ready block and the state at the end; model down on one block = "não conferido" with the reason, the others checked', async () => {
    const { s, t, id, salvar: save } = await story();
    expect((await save(docOf(P), 1)).status).toBe(200);
    answer = (user) => (block(user) === P[1] ? new Response('fora', { status: 503 }) : block(user) === P[2] ? { recusa: 'não posso' } : { afirmacoes: [] });
    const res = await req(`/api/t/${t}/textos/${id}/conferir`, { cookie: s.cookie, body: {}, headers: { accept: 'application/x-ndjson' } });
    expect(res.headers.get('content-type')).toContain('application/x-ndjson');
    const lines = (await res.text()).trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.filter((l) => l.tipo === 'bloco').map((l) => [l.blocoId, l.estado]).sort()).toEqual([['b0', 'conferido'], ['b1', 'nao_conferido'], ['b2', 'nao_conferido']]);
    const end = lines.at(-1);
    expect(end.tipo).toBe('fim');
    const state = end.estado as State;
    expect(state.blocos.find((b) => b.id === 'b1')).toMatchObject({ estado: 'nao_conferido', erro: expect.stringMatching(/não respondeu/) });
    expect(state.blocos.find((b) => b.id === 'b2')).toMatchObject({ estado: 'nao_conferido', erro: expect.stringMatching(/formato inesperado/) });
    expect(state.texto.conferidoVersao).not.toBe(state.texto.versao);
    // Again, only those that were not checked.
    calls = [];
    answer = () => ({ afirmacoes: [] });
    const d = await (await req(`/api/t/${t}/textos/${id}/conferir`, { cookie: s.cookie, body: {} })).json<State>();
    expect(calls.map((c) => block(c.user)).sort()).toEqual([P[1], P[2]].sort());
    expect(d.blocos.every((b) => b.estado === 'conferido')).toBe(true);
  });

  it("late save (old version) gives 409 and doesn't touch the blocks; IDOR: another outlet doesn't save or check; reporter only reads", async () => {
    const { s, t, id, salvar: save } = await story();
    expect((await save(docOf(P), 1)).status).toBe(200);
    const late = await save(docOf(['Outra coisa.']), 1);
    expect(late.status).toBe(409);
    expect(await late.json()).toMatchObject({ code: 'versao', versao: 2 });
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM blocos WHERE texto_id = ?').bind(id).first('n')).toBe(3);

    const other = await register();
    const t2 = await tenantAuthor();
    await seedMember(t2, other.userId, 'admin');
    expect((await req(`/api/t/${t2}/textos/${id}`, { method: 'PUT', cookie: other.cookie, body: { doc: docOf(['x']), versao: 2 } })).status).toBe(404);
    expect((await req(`/api/t/${t2}/textos/${id}/conferir`, { cookie: other.cookie, body: {}, headers: { accept: 'application/x-ndjson' } })).status).toBe(404);
    expect((await req(`/api/t/${t}/textos/${id}/conferir`, { cookie: other.cookie, body: {} })).status).toBe(404);
    const reporter = await register();
    await seedMember(t, reporter.userId, 'reporter');
    expect((await req(`/api/t/${t}/textos/${id}`, { method: 'PUT', cookie: reporter.cookie, body: { doc: docOf(['x']), versao: 2 } })).status).toBe(403);
    expect((await req(`/api/t/${t}/textos/${id}/conferir`, { cookie: reporter.cookie, body: {}, headers: { accept: 'application/x-ndjson' } })).status).toBe(403);
    expect(await env.DB.prepare('SELECT paragrafos_json FROM textos WHERE id = ?').bind(id).first('paragrafos_json')).toBe(JSON.stringify(P));
    void s;
  });

  it('invalid document gives 400 and changes nothing', async () => {
    const { s, t, id } = await story();
    expect((await req(`/api/t/${t}/textos/${id}`, { method: 'PUT', cookie: s.cookie, body: { doc: { type: 'nada' }, versao: 1 } })).status).toBe(400);
    expect(await env.DB.prepare('SELECT versao FROM textos WHERE id = ?').bind(id).first('versao')).toBe(1);
  });
});
