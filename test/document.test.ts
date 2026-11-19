// Phase 5 (handoffs/2026-11-02-materia-e-editor-investigativo.md): ask the document. The PDF read per page; keyword
// search (FTS5) and semantic search (Vectorize, simulated); an answer only with a citation checked by code (a page among
// those read and a literal passage on it), otherwise "not found"; entities by code; the document's total crossed with
// the text; the passage that becomes evidence; IDOR on the new routes. DeepSeek is a simulated fetch.
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import { quotesOutsidePages, crossWithText, chunksPage, processFile, fromPagePassage, valuesInReal } from '../src/lib/document';
import { processRecording } from '../src/lib/recording';
import { register, req, seedMember } from './helpers';
import { pdfFake } from './fake-pdf';
import { strFromU8, unzipSync } from 'fflate';

const PAGES = [
  ['Relatório da comissão de transporte de Vila Serena', 'A Câmara aprovou em 2025 a renovação de 12 contratos de ônibus sem licitação.', 'Relator: vereador Ícaro Nunes.'],
  ['Contratos renovados', 'Viação Serena Ltda, CNPJ 98.765.432/0001-98', 'Contrato 1: R$ 20 milhões', 'Contrato 2: R$ 28 milhões', 'Total: R$ 48 milhões', 'Assinado em 12/03/2025.'],
  ['Anexo', 'A frota tem ônibus com mais de 15 anos de uso, segundo a prefeitura.'],
];
const TEXT = ['Contratos sem concorrência', 'A Câmara renovou 12 contratos de ônibus sem licitação em 2025.', 'Os contratos somam R$ 40 milhões por ano.'].join('\n');

type Citation = { pagina: number; trecho: string };
let model: ((user: string) => { encontrou: boolean; resposta: string; citacoes: Citation[] }) | 'fora';
let calls = 0;
let check: (block: string) => Record<string, unknown>[] = () => [];

beforeEach(() => {
  model = () => ({ encontrou: false, resposta: '', citacoes: [] });
  calls = 0;
  check = () => [];
  const original = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('deepseek')) {
      const body = JSON.parse(init!.body as string) as { messages: { content: string }[] };
      if (!body.messages[0].content.startsWith('ASK THE DOCUMENT')) {
        const user = body.messages[1].content;
        const claims = check(user.slice(user.lastIndexOf('[P0] ') + 5));
        return Response.json({ choices: [{ message: { content: JSON.stringify({ afirmacoes: claims }) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
      }
      calls++;
      if (model === 'fora') return new Response('fora', { status: 503 });
      return Response.json({ choices: [{ message: { content: JSON.stringify(model(body.messages[1].content)) } }], usage: { prompt_tokens: 1000, completion_tokens: 100 } });
    }
    if (url.includes('.example')) return new Response('não achei', { status: 404 });
    return original(input, init);
  });
});
afterEach(() => vi.restoreAllMocks());

async function story() {
  const s = await register('Repórter Teste');
  const t = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO tenants (id, slug, nome, modo, plano) VALUES (?, ?, 'Cartas', 'autoral', 'cortesia')").bind(t, `d-${t.slice(0, 8)}`).run();
  await seedMember(t, s.userId, 'admin');
  const { texto: text } = await (await req(`/api/t/${t}/textos`, { cookie: s.cookie, body: { texto: TEXT } })).json<{ texto: { id: string } }>();
  return { s, t, id: text.id };
}
const ROUTE = (t: string, id: string) => `/api/t/${t}/textos/${id}`;
const send = (t: string, id: string, cookie: string, bytes: Uint8Array<ArrayBuffer>, name = 'relatório.pdf') =>
  req(`${ROUTE(t, id)}/documentos`, { cookie, cru: { tipo: 'application/pdf', corpo: bytes }, headers: { 'x-nome': encodeURIComponent(name) } });

interface Doc {
  id: string; nome: string; estado: string; erro: string | null; paginas: number | null; vetor: string | null;
  entidades: { pessoas: { valor: string }[]; empresas: { valor: string; paginas: number[] }[]; cnpjs: { valor: string }[]; valores: { valor: string }[]; datas: { valor: string }[] } | null;
  perguntas: { pergunta: string; resposta: string | null; citacoes: Citation[]; descartadas: number; encontrou: boolean; busca: string; situacao: string; aviso: string | null }[];
}
interface State { texto: { versao: number }; documentos: Doc[]; evidencias: { id: string; origem: string; titulo: string }[]; apontamentos: { tipo: string; trecho: string; explicacao: string }[]; checklist: { pendencias: { tipo: string }[] } }
const read = async (t: string, id: string, cookie: string) => (await req(ROUTE(t, id), { cookie })).json<State>();

/** Uploads and reads (the queue runs processFile; called directly here so the test does not depend on queue timing). */
async function documentRead(t: string, id: string, cookie: string, e: Env = env as unknown as Env, pages = PAGES) {
  const r = await send(t, id, cookie, pdfFake(pages));
  expect(r.status).toBe(201);
  const { arquivoId: fileId } = await r.json<{ arquivoId: string }>();
  await processFile(e, t, fileId);
  return fileId;
}

describe('PDF upload and reading', () => {
  it('PDF only; too big gives 422; the same file again is the earlier one; reads pages, entities and totals', async () => {
    const { s, t, id } = await story();
    expect((await send(t, id, s.cookie, new TextEncoder().encode('não sou pdf'))).status).toBe(422);
    const large = new Uint8Array(20 * 1024 * 1024 + 1); large.set(new TextEncoder().encode('%PDF-1.4'));
    expect((await send(t, id, s.cookie, large)).status).toBe(422);

    const file = await documentRead(t, id, s.cookie);
    const de2 = await send(t, id, s.cookie, pdfFake(PAGES));
    expect(de2.status).toBe(200);
    expect((await de2.json<{ arquivoId: string; existia: boolean }>())).toMatchObject({ arquivoId: file, existia: true });

    const d = (await read(t, id, s.cookie)).documentos[0];
    expect(d).toMatchObject({ nome: 'relatório.pdf', estado: 'pronto', paginas: 3, vetor: 'desligado', erro: null });
    expect(d.entidades!.empresas).toEqual([{ valor: 'Viação Serena Ltda', paginas: [2] }]);
    expect(d.entidades!.cnpjs.map((c) => c.valor)).toEqual(['98.765.432/0001-98']);
    expect(d.entidades!.valores.map((v) => v.valor)).toEqual(['R$ 20 milhões', 'R$ 28 milhões', 'R$ 48 milhões']);
    expect(d.entidades!.datas.map((v) => v.valor)).toEqual(['12/03/2025']);
    expect(d.entidades!.pessoas.map((p) => p.valor)).toContain('Ícaro Nunes');
  });

  it('PDF without text or broken: failed, with the reason in view', async () => {
    const { s, t, id } = await story();
    await documentRead(t, id, s.cookie, env as unknown as Env, [[]]);
    const broken = await send(t, id, s.cookie, new TextEncoder().encode('%PDF-1.4 quebrado sem objetos'));
    await processFile(env as unknown as Env, t, (await broken.json<{ arquivoId: string }>()).arquivoId);
    const docs = (await read(t, id, s.cookie)).documentos;
    expect(docs.map((d) => d.estado)).toEqual(['falhou', 'falhou']);
    expect(docs[0].erro).toContain('não tem texto');
    expect(docs[1].erro).toContain('não deu para ler');
  });
});

describe('question to the document', () => {
  it('the answer only appears with a literal citation from the page read; the rest is discarded and becomes "não encontrei"', async () => {
    const { s, t, id } = await story();
    const file = await documentRead(t, id, s.cookie);
    const ask = (question: string) => req(`${ROUTE(t, id)}/documentos/${file}/perguntas`, { cookie: s.cookie, body: { pergunta: question } });

    // Good: a searched page and a literal passage (with different spacing) → an answer with the citation.
    model = (user) => {
      expect(user).toContain('[p. 2]');
      return { encontrou: true, resposta: 'Os contratos somam R$ 48 milhões.', citacoes: [{ pagina: 2, trecho: 'Total:  R$ 48 milhões' }, { pagina: 2, trecho: 'Total geral de R$ 50 milhões' }, { pagina: 9, trecho: 'Contrato 1: R$ 20 milhões' }] };
    };
    const good = await (await ask('Qual o total dos contratos?')).json<{ resposta: string; citacoes: Citation[]; descartadas: unknown[]; encontrou: boolean; busca: string }>();
    expect(good).toMatchObject({ encontrou: true, resposta: 'Os contratos somam R$ 48 milhões.', citacoes: [{ pagina: 2, trecho: 'Total:  R$ 48 milhões' }], busca: 'palavra' });
    expect(good.descartadas).toHaveLength(2);

    // The model "finds" it, but no citation checks out: no answer (never an answer without proof), and the screen says the
    // model's answer was discarded (which is not the same as the document not having the information).
    model = () => ({ encontrou: true, resposta: 'O prefeito assinou o contrato.', citacoes: [{ pagina: 1, trecho: 'O prefeito assinou o contrato em 2024.' }] });
    const bad = await (await ask('Quem assinou o contrato?')).json<{ resposta: string | null; encontrou: boolean; descartadas: unknown[]; situacao: string }>();
    expect(bad).toMatchObject({ encontrou: false, resposta: null, situacao: 'invalida' });
    expect(bad.descartadas).toHaveLength(1);

    // One good citation does not license invented quotes in the answer: the quoted passage must be on the page read.
    model = () => ({ encontrou: true, resposta: 'O total é R$ 48 milhões, e o relatório conclui: "houve desvio de recursos".', citacoes: [{ pagina: 2, trecho: 'Total:  R$ 48 milhões' }] });
    const quote = await (await ask('Qual o total dos contratos?')).json<{ resposta: string | null; situacao: string; descartadas: { trecho: string; motivo: string }[] }>();
    expect(quote).toMatchObject({ resposta: null, situacao: 'invalida' });
    expect(quote.descartadas).toContainEqual(expect.objectContaining({ trecho: 'houve desvio de recursos', motivo: 'resposta' }));

    // Out-of-contract format ({} instead of encontrou/citacoes): invalid, not "not found".
    model = () => ({}) as never;
    expect((await (await ask('Qual o total dos contratos?')).json<{ situacao: string }>()).situacao).toBe('invalida');

    // A question with no word in the document: the model is not even called.
    const before = calls;
    const nothing = await (await ask('Qual a cor do helicóptero?')).json<{ encontrou: boolean }>();
    expect(nothing.encontrou).toBe(false);
    expect(calls).toBe(before);

    // Model down: 502 saying there was no checked answer (nothing vanishes silently).
    model = 'fora';
    const outside = await ask('Qual o total dos contratos?');
    expect(outside.status).toBe(502);
    expect((await outside.json<{ code: string }>()).code).toBe('modelo');

    // The failed attempt also stays in the history (and in the defence package), with its status.
    const d = (await read(t, id, s.cookie)).documentos[0];
    expect(d.perguntas.map((p) => p.situacao)).toEqual(['falhou', 'nao_encontrou', 'invalida', 'invalida', 'invalida', 'respondida']);   // mais recente primeiro
    expect(d.perguntas.map((p) => p.encontrou)).toEqual([false, false, false, false, false, true]);
  });

  it('semantic search failure: the question records the warning (only the keyword search ran), not a silent "não achei"', async () => {
    const { s, t, id } = await story();
    const ok = {
      ...env, BUSCA_VETORIAL: undefined,
      AI: { run: async (_m: string, { text }: { text: string[] }) => ({ data: text.map(() => Array(1024).fill(0.01)) }) },
      DOCS_VETOR: { upsert: async () => ({ mutationId: 'm' }), query: async () => { throw new Error('Vectorize 503'); } },
    } as unknown as Env;
    const file = await documentRead(t, id, s.cookie, ok);
    const { ask } = await import('../src/lib/document');
    const r = await ask(ok, t, id, file, 'idade dos veículos', s.userId);
    expect(r.busca).toBe('palavra');
    expect(r.aviso).toContain('Vectorize 503');
    expect((await read(t, id, s.cookie)).documentos[0].perguntas[0].aviso).toContain('busca por sentido falhou');
  });

  it('values without thousands separator and sentences with one; a long page goes to the model around the searched words', () => {
    expect(valuesInReal('custou R$ 1000 ao todo').map((v) => v.valor)).toEqual([1000]);
    expect(valuesInReal('R$ 1.000,00 e R$ 100,50').map((v) => v.valor)).toEqual([1000, 100.5]);
    // "R$ 1.000,00." is a single sentence: the crossing compares a thousand reais (and the document has two thousand).
    const c = crossWithText([{ id: 'b1', texto: 'O total é R$ 1.000,00. O resto é outra frase.' }], [{ id: 'd', nome: 'Relatório', totais: [{ pagina: 1, valor: 2000, como: 'total' }] }]);
    expect(c).toHaveLength(1);
    expect(c[0].trecho).toBe('R$ 1.000,00');
    const long = `${'Introdução sem nada. '.repeat(800)}O contrato da merenda custou R$ 9 milhões.${' Anexo.'.repeat(500)}`;
    const passage = fromPagePassage(long, ['merenda']);
    expect(passage.length).toBeLessThanOrEqual(8000 + 20);
    expect(passage).toContain('O contrato da merenda custou R$ 9 milhões.');
    expect(passage.startsWith('[…]')).toBe(true);
    expect(quotesOutsidePages('Diz: "custou R$ 9 milhões" e "frase que não existe"', [{ pagina: 1, texto: long }])).toEqual(['frase que não existe']);
  });

  it('semantic search: with the index, the pieces enter the file namespace and the search adds both', async () => {
    const { s, t, id } = await story();
    const vectors: { id: string; namespace?: string }[] = [];
    const queries: { namespace?: string }[] = [];
    const e = {
      ...env, BUSCA_VETORIAL: undefined,
      AI: { run: async (_m: string, { text }: { text: string[] }) => ({ data: text.map(() => Array(1024).fill(0.01)) }) },
      DOCS_VETOR: {
        upsert: async (vs: { id: string; namespace?: string }[]) => { vectors.push(...vs); return { mutationId: 'm' }; },
        query: async (_v: number[], o: { namespace?: string }) => { queries.push(o); return { matches: [{ id: 'x:3:0', score: 0.9, metadata: { pagina: 3 } }], count: 1 }; },
      },
    } as unknown as Env;
    const file = await documentRead(t, id, s.cookie, e);
    expect(vectors.length).toBeGreaterThanOrEqual(3);
    expect(new Set(vectors.map((v) => v.namespace))).toEqual(new Set([file]));
    const { ask } = await import('../src/lib/document');
    model = (user) => ({ encontrou: user.includes('[p. 3]'), resposta: 'A frota é velha.', citacoes: [{ pagina: 3, trecho: 'A frota tem ônibus com mais de 15 anos de uso' }] });
    const r = await ask(e, t, id, file, 'idade dos veículos', s.userId);
    expect(r).toMatchObject({ encontrou: true, busca: 'palavra+sentido' });
    expect(queries[0].namespace).toBe(file);
  });

  it('the cited excerpt becomes evidence (literal excerpt checked); the document total cross-checks with the text', async () => {
    const { s, t, id } = await story();
    const file = await documentRead(t, id, s.cookie);
    const become = (body: unknown) => req(`${ROUTE(t, id)}/documentos/${file}/evidencia`, { cookie: s.cookie, body });
    expect((await become({ pagina: 2, trecho: 'Total: R$ 50 milhões' })).status).toBe(422);
    expect((await become({ pagina: 7, trecho: 'Total: R$ 48 milhões' })).status).toBe(422);
    const ok = await become({ pagina: 2, trecho: 'Total: R$ 48 milhões' });
    expect(ok.status).toBe(201);
    const e = await ok.json<State & { evidenciaId: string }>();
    expect(e.evidencias.find((x) => x.id === e.evidenciaId)).toMatchObject({ origem: 'documento', titulo: 'relatório.pdf, p. 2' });
    expect((await become({ pagina: 2, trecho: 'Contrato 1: R$ 20 milhões' })).status).toBe(200);   // the same page: the earlier evidence

    // The text says the contracts add up to R$ 40 million; the document has a total of R$ 48 million (p. 2).
    const ap = e.apontamentos.find((x) => x.tipo === 'conta' && x.trecho === 'R$ 40 milhões');
    expect(ap?.explicacao).toContain('relatório.pdf, p. 2');
    expect(e.checklist.pendencias.some((p) => p.tipo === 'conta')).toBe(true);
  });
});

describe('defence package', () => {
  it('carries the original PDF and the questions asked of it, with the citations and what was discarded', async () => {
    const { s, t, id } = await story();
    const file = await documentRead(t, id, s.cookie);
    model = () => ({ encontrou: true, resposta: 'R$ 48 milhões.', citacoes: [{ pagina: 2, trecho: 'Total: R$ 48 milhões' }, { pagina: 2, trecho: 'Total: R$ 99 milhões' }] });
    await req(`${ROUTE(t, id)}/documentos/${file}/perguntas`, { cookie: s.cookie, body: { pergunta: 'Qual o total dos contratos?' } });
    // A question the model did not answer: in the package, with its status (it does not look like "not found in the document").
    model = 'fora';
    await req(`${ROUTE(t, id)}/documentos/${file}/perguntas`, { cookie: s.cookie, body: { pergunta: 'Qual o total de 2024?' } });
    const r = await req(`${ROUTE(t, id)}/pacote`, { method: 'GET', cookie: s.cookie });
    expect(r.status).toBe(200);
    const zip = unzipSync(new Uint8Array(await r.arrayBuffer()));
    const pdf = Object.keys(zip).find((n) => n.startsWith('dossie/documentos/') && n.endsWith('.pdf'));
    expect(pdf).toBe('dossie/documentos/01-relatorio.pdf');
    expect(strFromU8(zip[pdf!].slice(0, 5))).toBe('%PDF-');
    const docs = JSON.parse(strFromU8(zip['dossie/documentos/documentos.json'])) as { nome: string; sha256: string; perguntas: { pergunta: string; citacoes: Citation[]; descartadas: unknown[] }[] }[];
    expect(docs[0]).toMatchObject({ nome: 'relatório.pdf', perguntas: [
      { pergunta: 'Qual o total dos contratos?', situacao: 'respondida', citacoes: [{ pagina: 2, trecho: 'Total: R$ 48 milhões' }] },
      { pergunta: 'Qual o total de 2024?', situacao: 'falhou', resposta: null },
    ] });
    expect(docs[0].perguntas[0].descartadas).toHaveLength(1);
    const manifest = JSON.parse(strFromU8(zip['manifesto.json'])) as { arquivos: Record<string, string> } | Record<string, unknown>;
    expect(JSON.stringify(manifest)).toContain(pdf!);
  });
});

describe('public sources page', () => {
  it('a sentence backed by a document page shows the excerpt and the document, with no link or internal id', async () => {
    const { s, t, id } = await story();
    const file = await documentRead(t, id, s.cookie);
    const LINE = 'A Câmara aprovou em 2025 a renovação de 12 contratos de ônibus sem licitação.';
    const { evidenciaId: ev } = await (await req(`${ROUTE(t, id)}/documentos/${file}/evidencia`, { cookie: s.cookie, body: { pagina: 1, trecho: LINE } })).json<{ evidenciaId: string }>();
    const sentence = TEXT.split('\n')[1];
    check = (b) => (b === sentence ? [{ paragrafo: 0, trecho: sentence, estado: 'com_evidencia', risco: null, evidencia: ev, trecho_evidencia: LINE, explicacao: 'O relatório traz o número.' }] : []);
    expect((await req(`${ROUTE(t, id)}/conferir`, { cookie: s.cookie, body: {} })).status).toBe(200);
    const { texto: text } = await read(t, id, s.cookie);
    expect((await req(`${ROUTE(t, id)}/assinar`, { cookie: s.cookie, body: { versao: text.versao } })).status).toBe(201);
    const pub = await req(`${ROUTE(t, id)}/pagina-fontes`, { cookie: s.cookie, body: { versao: text.versao } });
    expect(pub.status).toBe(201);
    const { paginaFontes: sourcesPage } = await pub.json<{ paginaFontes: { id: string } }>();
    const body = await (await req(`/fontes/${sourcesPage.id}`, { method: 'GET', origin: null })).text();
    expect(body).toContain(sentence);
    expect(body).toContain(LINE);
    expect(body).toContain('relatório.pdf, p. 1');
    for (const internal of ['documento:', file, 'href="documento']) expect(body, internal).not.toContain(internal);
  });
});

describe('IDOR and role on the new routes', () => {
  it("another outlet can't reach it (404); reporter doesn't send, doesn't ask, doesn't become evidence (403)", async () => {
    const a = await story();
    const b = await story();
    const file = await documentRead(a.t, a.id, a.s.cookie);
    const routes: [string, string, unknown?, Uint8Array<ArrayBuffer>?][] = [
      ['POST', `${ROUTE(a.t, a.id)}/documentos`, undefined, pdfFake([['Outro documento qualquer']])],
      ['POST', `${ROUTE(a.t, a.id)}/documentos/${file}/perguntas`, { pergunta: 'Qual o total?' }],
      ['POST', `${ROUTE(a.t, a.id)}/documentos/${file}/evidencia`, { pagina: 2, trecho: 'Total: R$ 48 milhões' }],
      ['GET', `${ROUTE(a.t, a.id)}/documentos/${file}/pdf`],
    ];
    const request = (method: string, path: string, cookie: string, body?: unknown, pdf?: Uint8Array<ArrayBuffer>) =>
      req(path, { method, cookie, ...(pdf ? { cru: { tipo: 'application/pdf', corpo: pdf } } : body !== undefined ? { body } : {}) });
    for (const [m, p, body, pdf] of routes) expect((await request(m, p, b.s.cookie, body, pdf)).status, `${m} ${p}`).toBe(404);
    // Outlet A's file through outlet B's text routes: 404.
    expect((await req(`${ROUTE(b.t, b.id)}/documentos/${file}/perguntas`, { cookie: b.s.cookie, body: { pergunta: 'Qual o total?' } })).status).toBe(404);
    expect((await req(`${ROUTE(b.t, b.id)}/documentos/${file}/pdf`, { method: 'GET', cookie: b.s.cookie })).status).toBe(404);

    const rep = await register('Repórter Só');
    await seedMember(a.t, rep.userId, 'reporter');
    for (const [m, p, body, pdf] of routes.slice(0, 3)) expect((await request(m, p, rep.cookie, body, pdf)).status, `repórter ${m} ${p}`).toBe(403);
    expect((await req(`${ROUTE(a.t, a.id)}/documentos/${file}/pdf`, { method: 'GET', cookie: rep.cookie })).status).toBe(200);
  });
});

// ── review 2 (Codex, 03/11): the chunk semantic search found goes to the model; single quotes in the answer ──────────

describe('review 2: the right excerpt and the single quotes', () => {
  it('long page: the piece found by semantic search (with no word from the question) goes into the request', () => {
    const long = `${'Introdução sem nada de novo. '.repeat(400)}A elevação foi de 20% no período.${' Anexo técnico.'.repeat(400)}`;
    const ps = chunksPage(long);
    const n = ps.findIndex((p) => p.includes('elevação foi de 20%'));
    expect(n).toBeGreaterThan(0);
    expect(fromPagePassage(long, ['aumento'])).not.toContain('elevação foi de 20%');
    const t = fromPagePassage(long, ['aumento'], 8000, [n]);
    expect(t).toContain('A elevação foi de 20% no período.');
    expect(t.length).toBeLessThanOrEqual(8000 + 20);
    // The question's words every 1,000 characters from the start to near the chunk: their window does not swallow the cap.
    const withWords = `${Array.from({ length: 12 }, () => `${'Texto sem nada. '.repeat(60)}O aumento consta. `).join('')}A elevação foi de 20% no período.${' Fim.'.repeat(800)}`;
    const m = chunksPage(withWords).findIndex((p) => p.includes('elevação foi de 20%'));
    const t2 = fromPagePassage(withWords, ['aumento'], 8000, [m]);
    expect(t2).toContain('A elevação foi de 20% no período.');
    expect(t2).toContain('O aumento consta.');
    expect(t2.length).toBeLessThanOrEqual(8000 + 40);
  });

  it('an invented quote between typographic single quotes in the answer is also caught', () => {
    const pages = [{ pagina: 1, texto: 'O relatório conclui que houve aumento de custos.' }];
    expect(quotesOutsidePages('O relatório conclui: ‘houve desvio de verba’.', pages)).toEqual(['houve desvio de verba']);
    expect(quotesOutsidePages('O relatório diz ‘houve aumento de custos’.', pages)).toEqual([]);
    expect(quotesOutsidePages('A d’água não é citação.', pages)).toEqual([]);
    expect(quotesOutsidePages("O relatório conclui: 'houve desvio de verba'.", pages)).toEqual(['houve desvio de verba']);
    expect(quotesOutsidePages("A caixa d'água e o pau d'arco não são citação.", pages)).toEqual([]);
  });
});
