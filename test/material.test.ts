// Material on the side (.work/ESPEC-material.md): the editor's source organiser. Literal clippings checked by code
// (evidence, PDF page, transcript) and notes; the source's text to read alongside; the single accent-insensitive search
// across the four types; the outlet's library (sources without repeats; bringing a link, PDF, recording and clipping
// without paying again, twice without duplicating, and the copy that does not break when the original leaves);
// isolation and role; and the inserted quote with its citation, which is born resolved. Pages, DeepSeek and Whisper
// are a simulated fetch; nothing calls a real model.
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import { processFile } from '../src/lib/document';
import { processRecording } from '../src/lib/recording';
import { findInText, double, inText, paragraphsSource, termsSearch, inSourcePassage } from '../src/lib/clipping';
import { register, eventsOf, req, seedMember, type Session } from './helpers';
import { pdfFake } from './fake-pdf';
import { fakeWav } from './fake-audio';

const SOURCE = 'https://camara.example/relatorio';
const sourceBody = 'A Câmara aprovou em 2025 a renovação de 12 contratos de ônibus sem licitação, segundo o relatório da comissão. ' +
  'O presidente da comissão declarou: "Não houve irregularidade nas renovações aprovadas". O documento lista as empresas.';
const html = (title: string, body: string) => `<html><head><title>${title}</title></head><body><article><h1>${title}</h1><p>${body}</p></article></body></html>`;
const PAGES = [
  ['Relatório da comissão de transporte de Vila Serena', 'A Câmara aprovou em 2025 a renovação de 12 contratos de ônibus sem licitação.'],
  ['Contratos renovados', 'Total: R$ 48 milhões'],
];
const SPEECH: [number, string][] = [
  [0, 'Bom dia, obrigado por me receber.'],
  [72.4, 'Olha, eu nunca recebi um centavo das empresas de ônibus. Isso é mentira.'],
  [80, 'A licitação vai sair em abril do ano que vem.'],
];
function whisper(passages: [number, string][]) {
  return {
    text: passages.map(([, t]) => t).join(' '), transcription_info: { language: 'pt', duration: 90 },
    segments: passages.map(([ini, text]) => {
      const ws = text.split(' ');
      return { start: ini, end: ini + ws.length * 0.4, text: ` ${text}`, words: ws.map((w, k) => ({ word: ` ${w}`, start: ini + k * 0.4, end: ini + k * 0.4 + 0.35 })) };
    }),
  };
}

beforeEach(() => {
  const original = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === 'https://whisper.example/transcrever') return Response.json(whisper(SPEECH));
    if (url.includes('deepseek')) return Response.json({ choices: [{ message: { content: '{"afirmacoes":[]}' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
    if (url === SOURCE) return new Response(html('Relatório da comissão', sourceBody), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    if (url.includes('.example')) return new Response('não achei', { status: 404 });
    return original(input, init);
  });
});
afterEach(() => vi.restoreAllMocks());

const AND = env as unknown as Env;
const ROUTE = (t: string, id: string) => `/api/t/${t}/textos/${id}`;

async function outlet() {
  const s = await register('Repórter Teste');
  const t = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO tenants (id, slug, nome, modo, plano) VALUES (?, ?, 'Cartas', 'autoral', 'cortesia')").bind(t, `m-${t.slice(0, 8)}`).run();
  await seedMember(t, s.userId, 'admin');
  return { s, t };
}
async function newText(t: string, s: Session, text = 'Contratos sem concorrência\nA Câmara renovou 12 contratos de ônibus sem licitação em 2025.') {
  const r = await req(`/api/t/${t}/textos`, { cookie: s.cookie, body: { texto: text } });
  expect(r.status).toBe(201);
  return (await r.json<{ texto: { id: string } }>()).texto.id;
}
async function withLink(t: string, id: string, s: Session) {
  const r = await req(`${ROUTE(t, id)}/evidencias`, { cookie: s.cookie, body: { url: SOURCE } });
  expect(r.status).toBe(201);
  return (await r.json<{ evidenciaId: string }>()).evidenciaId;
}
async function withPdf(t: string, id: string, s: Session) {
  const r = await req(`${ROUTE(t, id)}/documentos`, { cookie: s.cookie, cru: { tipo: 'application/pdf', corpo: pdfFake(PAGES) }, headers: { 'x-nome': encodeURIComponent('relatório.pdf') } });
  const { arquivoId: fileId } = await r.json<{ arquivoId: string }>();
  await processFile(AND, t, fileId);
  return fileId;
}
async function withRecording(t: string, id: string, s: Session) {
  const r = await req(`${ROUTE(t, id)}/gravacoes`, { cookie: s.cookie, cru: { tipo: 'audio/wav', corpo: fakeWav() }, headers: { 'x-nome': encodeURIComponent('entrevista.wav') } });
  const { arquivoId: fileId } = await r.json<{ arquivoId: string }>();
  await processRecording(AND, t, fileId);
  return fileId;
}

interface Clipping {
  id: string; origem: string; evidenciaId: string | null; arquivoId: string | null; pagina: number | null; inicio: number | null; trecho: string; nota: string | null;
  fonte: { nome: string | null; url: string | null }; fonteExiste: boolean; compartilhavel: boolean; acervo: boolean; ordem: number; porNome: string | null;
}
type List = { recortes: Clipping[]; recorteId: string; existia: boolean };
const store = (t: string, id: string, cookie: string, body: Record<string, unknown>) => req(`${ROUTE(t, id)}/recortes`, { cookie, body });
const listAll = async (t: string, id: string, cookie: string) => (await (await req(`${ROUTE(t, id)}/recortes`, { cookie })).json<{ recortes: Clipping[] }>()).recortes;
const change = (t: string, id: string, cookie: string, clipping: string, body: Record<string, unknown>) => req(`${ROUTE(t, id)}/recortes/${clipping}`, { cookie, method: 'PATCH', body });

describe('literal check (recorte.ts, the same as the screen)', () => {
  it('only whitespace may differ; accent, case and a swapped word may not', () => {
    const source = 'Título\n\nA Câmara  aprovou\nem 2025 a renovação.';
    expect(inSourcePassage(source, 'Câmara aprovou em 2025')).toBe(true);
    expect(inSourcePassage(source, '  Câmara aprovou\n\nem   2025 ')).toBe(true);
    expect(inSourcePassage(source, 'Camara aprovou')).toBe(false);
    expect(inSourcePassage(source, 'câmara aprovou')).toBe(false);
    expect(inSourcePassage(source, 'aprovou em 2024')).toBe(false);
    expect(inSourcePassage(source, 'em')).toBe(false);   // curto demais
    expect(inText('renovou 12  contratos', ['A Câmara', 'renovou 12 contratos de ônibus'])).toBe(true);
    expect(inText('renovou 13 contratos', ['renovou 12 contratos'])).toBe(false);
  });

  it('reader paragraphs: a blank line separates, a long one is cut at a sentence end, and each one passes the check', () => {
    const sentence = (i: number) => `Esta é a frase número ${i} do corpo da página, com algum texto para encher a linha.`;
    const body = Array.from({ length: 40 }, (_, i) => sentence(i)).join(' ');
    const source = `Manchete\n\n${body}\n\n\nÚltimo   parágrafo.`;
    const ps = paragraphsSource(source);
    expect(ps[0]).toBe('Manchete');
    expect(ps.at(-1)).toBe('Último parágrafo.');
    expect(ps.length).toBeGreaterThan(4);
    for (const p of ps) {
      expect(p.length).toBeLessThanOrEqual(900);
      expect(inSourcePassage(source, p)).toBe(true);
    }
    expect(ps.slice(1, -1).join(' ')).toBe(body);   // nothing is lost in the cut
  });

  it('search: without accents or case, all the words, positions in the original text', () => {
    expect(double('Licitação ÔNIBUS 🚌 já')).toHaveLength('Licitação ÔNIBUS 🚌 já'.length);
    const terms = termsSearch('LICITACAO onibus');
    expect(terms).toEqual(['licitacao', 'onibus']);
    const a = findInText('Contratos de ônibus sem licitação em 2025.', terms)!;
    expect(a.marcas.map(([i, f]) => a.trecho.slice(i, f))).toEqual(['ônibus', 'licitação']);
    expect(findInText('Contratos de ônibus.', terms)).toBeNull();
    const long = findInText(`${'palavra '.repeat(60)}licitação ${'outra '.repeat(60)}`, ['licitacao'])!;
    expect(long.trecho.startsWith('…') && long.trecho.endsWith('…')).toBe(true);
    expect(long.trecho.slice(...long.marcas[0])).toBe('licitação');
  });
});

describe('clippings', () => {
  it('evidence clippings: literal with different spaces; outside the source is 422; repeated is the same; note, move, library and remove', async () => {
    const { s, t } = await outlet();
    const id = await newText(t, s);
    const ev = await withLink(t, id, s);

    const r1 = await store(t, id, s.cookie, { origem: 'evidencia', evidenciaId: ev, trecho: 'renovação de 12\n   contratos de ônibus', nota: '  número da  comissão ' });
    expect(r1.status).toBe(201);
    const b1 = await r1.json<List>();
    expect(b1.recortes).toHaveLength(1);
    expect(b1.recortes[0]).toMatchObject({
      origem: 'evidencia', evidenciaId: ev, trecho: 'renovação de 12 contratos de ônibus', nota: 'número da comissão',
      fonte: { nome: 'Relatório da comissão', url: SOURCE }, fonteExiste: true, compartilhavel: true, acervo: false, porNome: 'Repórter Teste',
    });
    // The same again: the earlier one, without a new row.
    const de2 = await store(t, id, s.cookie, { origem: 'evidencia', evidenciaId: ev, trecho: 'renovação de 12 contratos de ônibus' });
    expect(de2.status).toBe(200);
    expect(await de2.json<List>()).toMatchObject({ recorteId: b1.recorteId, existia: true });

    const outside = await store(t, id, s.cookie, { origem: 'evidencia', evidenciaId: ev, trecho: 'renovação de 13 contratos de ônibus' });
    expect(outside.status).toBe(422);
    expect(await outside.json()).toMatchObject({ code: 'trecho_fora' });
    expect((await store(t, id, s.cookie, { origem: 'evidencia', evidenciaId: ev, trecho: 'A câmara aprovou' })).status).toBe(422);   // caixa conta
    expect((await store(t, id, s.cookie, { origem: 'evidencia', evidenciaId: ev, trecho: 'x'.repeat(2001) })).status).toBe(400);
    expect((await store(t, id, s.cookie, { origem: 'evidencia', evidenciaId: 'outra', trecho: 'renovação de 12' })).status).toBe(404);
    expect((await store(t, id, s.cookie, { origem: 'mural', trecho: 'renovação' })).status).toBe(400);
    expect((await store(t, id, s.cookie, { origem: 'nota', trecho: 'oi', nota: 'x'.repeat(501) })).status).toBe(201);   // the note's passage is the text
    expect((await store(t, id, s.cookie, { origem: 'evidencia', evidenciaId: ev, trecho: 'renovação de 12', nota: 'x'.repeat(501) })).status).toBe(400);

    // An own note: the person's text, unchecked.
    const n = await store(t, id, s.cookie, { origem: 'nota', trecho: 'Ligar para a assessoria da Câmara na segunda.' });
    expect(n.status).toBe(201);
    const nId = (await n.json<List>()).recorteId;
    let list = await listAll(t, id, s.cookie);
    expect(list.map((r) => r.trecho)).toEqual(['renovação de 12 contratos de ônibus', 'oi', 'Ligar para a assessoria da Câmara na segunda.']);
    const [a, b, c] = list.map((r) => r.id);

    // Move: moving the first one up changes nothing; down; to a position.
    expect((await change(t, id, s.cookie, a, { mover: 'cima' })).status).toBe(200);
    expect((await listAll(t, id, s.cookie)).map((r) => r.id)).toEqual([a, b, c]);
    await change(t, id, s.cookie, a, { mover: 'baixo' });
    expect((await listAll(t, id, s.cookie)).map((r) => r.id)).toEqual([b, a, c]);
    const after = await change(t, id, s.cookie, c, { posicao: 0 });
    expect((await after.json<{ recortes: Clipping[] }>()).recortes.map((r) => r.id)).toEqual([c, b, a]);
    expect((await change(t, id, s.cookie, c, { mover: 'lado' })).status).toBe(400);
    expect((await change(t, id, s.cookie, c, {})).status).toBe(400);

    // Note, library and the own note's text; a source's passage does not change.
    await change(t, id, s.cookie, a, { nota: 'conferir com o PDF', acervo: true });
    await change(t, id, s.cookie, nId, { trecho: 'Ligar para a assessoria na terça.' });
    expect((await change(t, id, s.cookie, a, { trecho: 'outra coisa' })).status).toBe(422);
    list = await listAll(t, id, s.cookie);
    expect(list.find((r) => r.id === a)).toMatchObject({ nota: 'conferir com o PDF', acervo: true });
    expect(list.find((r) => r.id === nId)!.trecho).toBe('Ligar para a assessoria na terça.');
    await change(t, id, s.cookie, a, { nota: null, acervo: false });
    expect((await listAll(t, id, s.cookie)).find((r) => r.id === a)).toMatchObject({ nota: null, acervo: false });

    // Remove; removing again is 404.
    const del = await req(`${ROUTE(t, id)}/recortes/${b}`, { cookie: s.cookie, method: 'DELETE' });
    expect((await del.json<{ recortes: Clipping[] }>()).recortes.map((r) => r.id)).toEqual([c, a]);
    expect((await req(`${ROUTE(t, id)}/recortes/${b}`, { cookie: s.cookie, method: 'DELETE' })).status).toBe(404);

    // The evidence leaves the dossier: the clipping stays, with the source's snapshot, and says the source is no longer in the text.
    await req(`${ROUTE(t, id)}/evidencias/${ev}`, { cookie: s.cookie, method: 'DELETE' });
    expect((await listAll(t, id, s.cookie)).find((r) => r.id === a)).toMatchObject({ fonteExiste: false, fonte: { nome: 'Relatório da comissão', url: SOURCE }, compartilhavel: true });
  });

  it('PDF clippings (page, at least 8 characters) and recording clippings (the second of speech); an unread source is 409', async () => {
    const { s, t } = await outlet();
    const id = await newText(t, s);
    const pdf = await withPdf(t, id, s);
    const rec = await withRecording(t, id, s);

    const p = await store(t, id, s.cookie, { origem: 'documento', arquivoId: pdf, pagina: 1, trecho: 'renovação de 12 contratos de ônibus sem licitação' });
    expect(p.status).toBe(201);
    expect((await p.json<List>()).recortes[0]).toMatchObject({ origem: 'documento', arquivoId: pdf, pagina: 1, fonte: { nome: 'relatório.pdf', url: null }, fonteExiste: true });
    expect((await store(t, id, s.cookie, { origem: 'documento', arquivoId: pdf, pagina: 2, trecho: 'renovação de 12 contratos' })).status).toBe(422);   // another page
    expect((await store(t, id, s.cookie, { origem: 'documento', arquivoId: pdf, pagina: 9, trecho: 'renovação de 12 contratos' })).status).toBe(422);
    expect((await store(t, id, s.cookie, { origem: 'documento', arquivoId: pdf, pagina: 2, trecho: 'R$ 48' })).status).toBe(400);   // short so it becomes evidence

    const g = await store(t, id, s.cookie, { origem: 'gravacao', arquivoId: rec, trecho: 'eu nunca recebi um centavo das empresas de ônibus.' });
    expect(g.status).toBe(201);
    const rg = (await g.json<List>()).recortes.find((r) => r.origem === 'gravacao')!;
    expect(rg).toMatchObject({ arquivoId: rec, fonte: { nome: 'entrevista.wav' } });
    expect(rg.inicio).toBeCloseTo(72.8, 5);   // a palavra "eu"
    // A selection that takes the end of one passage and the start of the next stays literal; the second is the one with the word "Isso".
    const together = await store(t, id, s.cookie, { origem: 'gravacao', arquivoId: rec, trecho: 'Isso é mentira. A licitação' });
    expect((await together.json<List>()).recortes.at(-1)!.inicio).toBeCloseTo(76.4, 5);
    // Two words: the speech is not searched word by word (findInRecording asks for three); the passage's start counts.
    const short = await store(t, id, s.cookie, { origem: 'gravacao', arquivoId: rec, trecho: 'Bom dia' });
    expect((await short.json<List>()).recortes.at(-1)!.inicio).toBe(0);
    expect((await store(t, id, s.cookie, { origem: 'gravacao', arquivoId: rec, trecho: 'eu sempre recebi um centavo' })).status).toBe(422);
    expect((await store(t, id, s.cookie, { origem: 'documento', arquivoId: rec, pagina: 1, trecho: 'renovação de 12 contratos' })).status).toBe(404);   // tipo errado

    // Still reading: 409.
    await env.DB.prepare("UPDATE arquivos SET estado = 'lendo' WHERE id = ?").bind(pdf).run();
    expect((await store(t, id, s.cookie, { origem: 'documento', arquivoId: pdf, pagina: 1, trecho: 'Relatório da comissão' })).status).toBe(409);
  }, 15_000);   // reads a PDF and transcribes a recording

  it('cap of 200 per text', async () => {
    const { s, t } = await outlet();
    const id = await newText(t, s);
    await env.DB.batch(Array.from({ length: 200 }, (_, i) => env.DB.prepare("INSERT INTO recortes (id, tenant_id, texto_id, origem, trecho, ordem, por) VALUES (?, ?, ?, 'nota', ?, ?, ?)")
      .bind(crypto.randomUUID(), t, id, `nota ${i}`, i + 1, s.userId)));
    const r = await store(t, id, s.cookie, { origem: 'nota', trecho: 'mais uma' });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ code: 'teto' });
    expect((await store(t, id, s.cookie, { origem: 'nota', trecho: 'nota 3' })).status).toBe(200);   // the one that exists still comes back
  });
});

describe('reader beside', () => {
  it('evidence text in paragraphs (the clipping comes out of it) and PDF pages in a window', async () => {
    const { s, t } = await outlet();
    const id = await newText(t, s);
    const ev = await withLink(t, id, s);
    const r = await req(`${ROUTE(t, id)}/evidencias/${ev}/texto`, { cookie: s.cookie });
    expect(r.status).toBe(200);
    const e = await r.json<{ id: string; titulo: string; url: string | null; origem: string; paragrafos: string[] }>();
    expect(e).toMatchObject({ id: ev, titulo: 'Relatório da comissão', url: SOURCE, origem: 'link' });
    const p = e.paragrafos.find((x) => x.includes('renovação de 12 contratos'))!;
    expect(p).toBeTruthy();
    // The whole paragraph ("Save clipping" without a selection) passes the server's check.
    expect((await store(t, id, s.cookie, { origem: 'evidencia', evidenciaId: ev, trecho: p })).status).toBe(201);
    expect((await req(`${ROUTE(t, id)}/evidencias/nao-existe/texto`, { cookie: s.cookie })).status).toBe(404);

    const pdf = await withPdf(t, id, s);
    const j = await (await req(`${ROUTE(t, id)}/documentos/${pdf}/paginas`, { cookie: s.cookie })).json<{ nome: string; total: number; paginas: { pagina: number; paragrafos: string[] }[]; proxima: number | null }>();
    expect(j).toMatchObject({ nome: 'relatório.pdf', total: 2, proxima: null });
    expect(j.paginas.map((x) => x.pagina)).toEqual([1, 2]);
    expect(j.paginas[1].paragrafos.join(' ')).toContain('Total: R$ 48 milhões');
    const so2 = await (await req(`${ROUTE(t, id)}/documentos/${pdf}/paginas?de=2&ate=50`, { cookie: s.cookie })).json<{ paginas: { pagina: number }[]; proxima: number | null }>();
    expect(so2.paginas.map((x) => x.pagina)).toEqual([2]);
    const so1 = await (await req(`${ROUTE(t, id)}/documentos/${pdf}/paginas?de=1&ate=1`, { cookie: s.cookie })).json<{ paginas: { pagina: number }[]; proxima: number | null }>();
    expect(so1).toMatchObject({ paginas: [{ pagina: 1 }], proxima: 2 });
    expect((await req(`${ROUTE(t, id)}/documentos/${pdf}/paginas?de=0`, { cookie: s.cookie })).status).toBe(400);
    expect((await req(`${ROUTE(t, id)}/documentos/${pdf}/paginas?de=3&ate=2`, { cookie: s.cookie })).status).toBe(400);
  });
});

type Search = { grupos: { tipo: string; id: string | null; nome: string | null; achados: { trecho: string; marcas: [number, number][]; paragrafo?: number; pagina?: number; inicio?: number; recorteId?: string }[]; mais: boolean }[]; cortado: boolean };
const load = async (t: string, id: string, cookie: string, q: string) => (await req(`${ROUTE(t, id)}/material/busca?q=${encodeURIComponent(q)}`, { cookie })).json<Search>();

describe('single search', () => {
  it('across the four types, without accents or case, with the position of each hit; too short is 400', async () => {
    const { s, t } = await outlet();
    const id = await newText(t, s);
    const ev = await withLink(t, id, s);
    const pdf = await withPdf(t, id, s);
    const recording = await withRecording(t, id, s);
    const rec = (await (await store(t, id, s.cookie, { origem: 'nota', trecho: 'Pedir o edital da LICITAÇÃO à prefeitura.' })).json<List>()).recorteId;

    const b = await load(t, id, s.cookie, 'licitacao');
    expect(b.cortado).toBe(false);
    expect(b.grupos.map((g) => g.tipo)).toEqual(['recortes', 'evidencia', 'documento', 'gravacao']);
    const [gr, ge, gd, gg] = b.grupos;
    expect(gr.achados[0].recorteId).toBe(rec);
    expect(ge).toMatchObject({ id: ev, nome: 'Relatório da comissão' });
    expect(gd).toMatchObject({ id: pdf, nome: 'relatório.pdf' });
    expect(gd.achados[0].pagina).toBe(1);
    expect(gg).toMatchObject({ id: recording, nome: 'entrevista.wav' });
    expect(gg.achados[0].inicio).toBe(80);
    for (const g of b.grupos) for (const a of g.achados) expect(double(a.trecho.slice(...a.marcas[0]))).toBe('licitacao');
    // The paragraph found is the same as the reader's.
    const reader = await (await req(`${ROUTE(t, id)}/evidencias/${ev}/texto`, { cookie: s.cookie })).json<{ paragrafos: string[] }>();
    expect(reader.paragrafos[ge.achados[0].paragrafo!]).toContain('licitação');

    // All words in the same piece: "ônibus" and "licitação" are together in the evidence and in the PDF, not in the recording.
    expect((await load(t, id, s.cookie, 'ONIBUS licitação')).grupos.map((g) => g.tipo)).toEqual(['evidencia', 'documento']);
    expect((await load(t, id, s.cookie, 'mentira')).grupos.map((g) => g.tipo)).toEqual(['gravacao']);
    expect((await load(t, id, s.cookie, 'nada disso existe')).grupos).toEqual([]);
    expect((await req(`${ROUTE(t, id)}/material/busca?q=a`, { cookie: s.cookie })).status).toBe(400);
    expect((await req(`${ROUTE(t, id)}/material/busca`, { cookie: s.cookie })).status).toBe(400);
    // Punctuation only: FTS5 does not understand it, the search does not crash.
    expect((await req(`${ROUTE(t, id)}/material/busca?q=${encodeURIComponent('"" **')}`, { cookie: s.cookie })).status).toBe(200);
  });
});

type Archive = {
  fontes: { tipo: string; id: string; nome: string; url: string | null; texto: { id: string; titulo: string }; textos: number; jaNoTexto: boolean }[];
  recortes: { id: string; trecho: string; texto: { id: string }; jaNoTexto: boolean }[]; cortado: boolean;
};
const archive = async (t: string, cookie: string, less: string, q = '') => (await req(`/api/t/${t}/textos/acervo?menos=${less}&q=${encodeURIComponent(q)}`, { cookie })).json<Archive>();
const bring = (t: string, id: string, cookie: string, type: string, from: string) => req(`${ROUTE(t, id)}/acervo/trazer`, { cookie, body: { tipo: type, id: from } });
const count = async (table: string, textId: string) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE texto_id = ?`).bind(textId).first<{ n: number }>())!.n;

describe('outlet library', () => {
  it("list without repeats; brings link, PDF, recording and clipping without reading again; twice doesn't duplicate; the copy doesn't break when the original goes", async () => {
    const { s, t } = await outlet();
    const a = await newText(t, s, 'Texto A\nA Câmara renovou os contratos.');
    const c = await newText(t, s, 'Texto C\nOutra matéria sobre a Câmara.');
    const b = await newText(t, s, 'Texto B\nA matéria nova.');
    const ev = await withLink(t, a, s);
    await withLink(t, c, s);   // the same address in another text
    const pdf = await withPdf(t, a, s);
    const recA = await withRecording(t, a, s);
    const rec = (await (await store(t, a, s.cookie, { origem: 'evidencia', evidenciaId: ev, trecho: 'renovação de 12 contratos de ônibus' })).json<List>()).recorteId;
    const note = (await (await store(t, a, s.cookie, { origem: 'nota', trecho: 'A assessoria atende de manhã.' })).json<List>()).recorteId;
    await change(t, a, s.cookie, rec, { acervo: true });
    await change(t, a, s.cookie, note, { acervo: true });

    const read = await archive(t, s.cookie, b);
    expect(read.fontes.filter((f) => f.tipo === 'link')).toHaveLength(1);   // the same address, once
    expect(read.fontes.find((f) => f.tipo === 'link')).toMatchObject({ url: SOURCE, textos: 2, jaNoTexto: false });
    expect(read.fontes.find((f) => f.tipo === 'documento')).toMatchObject({ id: pdf, nome: 'relatório.pdf', texto: { id: a, titulo: 'Texto A' } });
    expect(read.fontes.find((f) => f.tipo === 'gravacao')).toMatchObject({ id: recA });
    expect(read.recortes.map((r) => r.id).sort()).toEqual([rec, note].sort());
    expect((await archive(t, s.cookie, b, 'ASSESSORIA')).recortes.map((r) => r.id)).toEqual([note]);
    expect((await archive(t, s.cookie, b, 'relatorio pdf')).fontes.map((f) => f.tipo)).toEqual(['documento']);
    // From text A, its sources leave the list (the link comes from text C, and says A already has it).
    expect((await archive(t, s.cookie, a)).fontes.map((f) => [f.tipo, f.jaNoTexto])).toEqual([['link', true]]);

    // No reading, processing or transcribing again: fetch is not called during the bring.
    const fetches = vi.mocked(globalThis.fetch).mock.calls.length;
    const link = read.fontes.find((f) => f.tipo === 'link')!;
    const t1 = await bring(t, b, s.cookie, 'link', link.id);
    expect(t1.status).toBe(201);
    const j1 = await t1.json<{ trazido: { tipo: string; id: string; existia: boolean }; evidencias: { id: string; url: string }[] }>();
    expect(j1.evidencias).toEqual([expect.objectContaining({ id: j1.trazido.id, url: SOURCE })]);
    expect((await bring(t, b, s.cookie, 'documento', pdf)).status).toBe(201);
    expect((await bring(t, b, s.cookie, 'gravacao', recA)).status).toBe(201);
    const tr = await bring(t, b, s.cookie, 'recorte', rec);
    expect(tr.status).toBe(201);
    const jr = await tr.json<{ trazido: { id: string }; recortes: Clipping[] }>();
    expect(jr.recortes).toEqual([expect.objectContaining({ id: jr.trazido.id, evidenciaId: j1.trazido.id, trecho: 'renovação de 12 contratos de ônibus', acervo: false, fonteExiste: true })]);
    expect((await bring(t, b, s.cookie, 'recorte', note)).status).toBe(201);
    const url = (u: unknown) => (typeof u === 'string' ? u : u instanceof URL ? u.href : (u as Request).url);
    expect(vi.mocked(globalThis.fetch).mock.calls.slice(fetches).map(([u]) => url(u)).filter((u) => !u.includes('wayback'))).toEqual([]);

    // Twice: what is already in the text, without a new row.
    for (const [type, from] of [['link', link.id], ['documento', pdf], ['gravacao', recA], ['recorte', rec], ['recorte', note]]) {
      const r = await bring(t, b, s.cookie, type, from);
      expect(r.status).toBe(200);
      expect((await r.json<{ trazido: { existia: boolean } }>()).trazido.existia).toBe(true);
    }
    expect([await count('evidencias', b), await count('arquivos', b), await count('recortes', b)]).toEqual([1, 2, 2]);
    expect((await archive(t, s.cookie, b)).fontes.every((f) => f.jaNoTexto)).toBe(true);
    expect((await eventsOf(b)).filter((e) => e.tipo === 'material.trazido')).toHaveLength(5);

    // The link's copy: a new key in R2, the same text, the same read (hash and date) for the "source changed" cron. The
    // copied read is the brought evidence's, and the library shows the address by the most recent one: here text C's,
    // read after A's (its date is only A's when both reads fall in the same second).
    const [orig, source, copy] = await Promise.all([ev, link.id, j1.trazido.id].map((x) => env.DB.prepare('SELECT r2_texto, hash, conferida_em FROM evidencias WHERE id = ?').bind(x).first<{ r2_texto: string; hash: string; conferida_em: string }>()));
    expect(copy!.r2_texto).not.toBe(orig!.r2_texto);
    expect(copy!.r2_texto).not.toBe(source!.r2_texto);
    expect([copy!.hash, copy!.conferida_em]).toEqual([source!.hash, source!.conferida_em]);
    // The brought PDF and recording: ready, without semantic search, with pages, word index and transcript.
    const docB = (await (await req(ROUTE(t, b), { cookie: s.cookie })).json<{ documentos: { id: string; estado: string; vetor: string; paginas: number }[]; gravacoes: { id: string; estado: string }[] }>());
    expect(docB.documentos).toEqual([expect.objectContaining({ estado: 'pronto', vetor: 'desligado', paginas: 2 })]);
    expect(docB.gravacoes).toEqual([expect.objectContaining({ estado: 'pronto' })]);
    expect((await load(t, b, s.cookie, 'licitacao')).grupos.map((g) => g.tipo)).toEqual(['evidencia', 'documento', 'gravacao']);
    const tr2 = await (await req(`${ROUTE(t, b)}/gravacoes/${docB.gravacoes[0].id}/transcricao`, { cookie: s.cookie })).json<{ trechos: unknown[] }>();
    expect(tr2.trechos).toHaveLength(3);
    expect((await req(`${ROUTE(t, b)}/gravacoes/${docB.gravacoes[0].id}/audio`, { cookie: s.cookie })).status).toBe(200);

    // The original leaves A's dossier: the copy in B keeps reading (the R2 object is another).
    expect((await req(`${ROUTE(t, a)}/evidencias/${ev}`, { cookie: s.cookie, method: 'DELETE' })).status).toBe(200);
    expect(await env.MEDIA.get(orig!.r2_texto)).toBeNull();
    const readB = await req(`${ROUTE(t, b)}/evidencias/${j1.trazido.id}/texto`, { cookie: s.cookie });
    expect(readB.status).toBe(200);
    expect((await readB.json<{ paragrafos: string[] }>()).paragrafos.join(' ')).toContain('renovação de 12 contratos');
    // And A's clipping, whose evidence left, still comes to a new text through the address (from text C).
    const d = await newText(t, s, 'Texto D\nMais uma.');
    const td = await bring(t, d, s.cookie, 'recorte', rec);
    expect(td.status).toBe(201);
    expect((await td.json<{ recortes: Clipping[] }>()).recortes[0]).toMatchObject({ fonteExiste: true, fonte: { url: SOURCE } });
    // Text E already has the same address, but with another stored text (read on another day): the passage is not literal
    // in the source the clipping would point to, and it does not come.
    const e = await newText(t, s, 'Texto E\nOutra ainda.');
    const evAnd = await withLink(t, e, s);
    const r2And = (await env.DB.prepare('SELECT r2_texto FROM evidencias WHERE id = ?').bind(evAnd).first<{ r2_texto: string }>())!.r2_texto;
    await env.MEDIA.put(r2And, 'A página mudou e agora fala de outra coisa.');
    const te = await bring(t, e, s.cookie, 'recorte', rec);
    expect(te.status).toBe(422);
    expect((await te.json<{ code: string }>()).code).toBe('trecho_fora');
    expect(await count('recortes', e)).toBe(0);
  }, 20_000);   // five texts, a PDF and a recording read, and the whole state on each bring

  it("reply clipping doesn't go to the library; what isn't from the library doesn't come", async () => {
    const { s, t } = await outlet();
    const a = await newText(t, s);
    const b = await newText(t, s, 'Outro texto\nCorpo.');
    const ev = crypto.randomUUID();
    await env.MEDIA.put(`evidencias/${t}/${ev}.txt`, 'Resposta da assessoria: o contrato foi assinado em março.');
    await env.DB.prepare("INSERT INTO evidencias (id, tenant_id, texto_id, url, titulo, r2_texto, hash, hash_atual, origem) VALUES (?, ?, ?, ?, 'Assessoria', ?, 'h', 'h', 'resposta')")
      .bind(ev, t, a, `resposta:${ev}`, `evidencias/${t}/${ev}.txt`).run();
    const r = (await (await store(t, a, s.cookie, { origem: 'evidencia', evidenciaId: ev, trecho: 'o contrato foi assinado em março' })).json<List>());
    expect(r.recortes[0]).toMatchObject({ compartilhavel: false, fonte: { nome: 'Assessoria', url: null } });
    const node = await change(t, a, s.cookie, r.recorteId, { acervo: true });
    expect(node.status).toBe(422);
    expect(await node.json()).toMatchObject({ code: 'nao_compartilhavel' });
    expect((await bring(t, b, s.cookie, 'recorte', r.recorteId)).status).toBe(404);   // not in the library
    expect((await bring(t, b, s.cookie, 'link', ev)).status).toBe(404);              // a reply is not a link
    expect((await bring(t, b, s.cookie, 'pasta', ev)).status).toBe(400);
  });
});

describe('isolation and role', () => {
  it("another outlet can't read or fetch; reporter reads and doesn't change", async () => {
    const { s, t } = await outlet();
    const id = await newText(t, s);
    const ev = await withLink(t, id, s);
    const pdf = await withPdf(t, id, s);
    const rec = (await (await store(t, id, s.cookie, { origem: 'evidencia', evidenciaId: ev, trecho: 'renovação de 12 contratos de ônibus' })).json<List>()).recorteId;
    await change(t, id, s.cookie, rec, { acervo: true });

    // Another outlet, with the same outside user: the routes of that text are 404.
    const other = await outlet();
    const my = await newText(other.t, other.s);
    for (const path of [`/recortes`, `/evidencias/${ev}/texto`, `/documentos/${pdf}/paginas`, `/material/busca?q=licitacao`]) {
      expect((await req(`${ROUTE(t, id)}${path}`, { cookie: other.s.cookie })).status).toBe(404);
    }
    expect((await store(t, id, other.s.cookie, { origem: 'nota', trecho: 'invasão' })).status).toBe(404);
    expect((await change(t, id, other.s.cookie, rec, { nota: 'x' })).status).toBe(404);
    expect((await req(`${ROUTE(t, id)}/recortes/${rec}`, { cookie: other.s.cookie, method: 'DELETE' })).status).toBe(404);
    expect((await req(`/api/t/${t}/textos/acervo`, { cookie: other.s.cookie })).status).toBe(404);
    // In their outlet: the library does not show ours, does not bring it, does not accept our source in a clipping, and does not touch our clipping.
    const his = await archive(other.t, other.s.cookie, my);
    expect([his.fontes, his.recortes]).toEqual([[], []]);
    for (const [type, from] of [['link', ev], ['documento', pdf], ['recorte', rec]]) expect((await bring(other.t, my, other.s.cookie, type, from)).status).toBe(404);
    expect((await store(other.t, my, other.s.cookie, { origem: 'evidencia', evidenciaId: ev, trecho: 'renovação de 12 contratos' })).status).toBe(404);
    expect((await change(other.t, my, other.s.cookie, rec, { nota: 'x' })).status).toBe(404);
    expect((await req(`${ROUTE(other.t, my)}/evidencias/${ev}/texto`, { cookie: other.s.cookie })).status).toBe(404);
    // In the same outlet, another text's evidence does not serve this one's clipping.
    const sibling = await newText(t, s, 'Irmão\nCorpo.');
    expect((await store(t, sibling, s.cookie, { origem: 'evidencia', evidenciaId: ev, trecho: 'renovação de 12 contratos' })).status).toBe(404);
    expect((await change(t, sibling, s.cookie, rec, { nota: 'x' })).status).toBe(404);

    // Reporter: reads the material and the library; saving, changing, removing and bringing are for editors and up.
    const rep = await register('Repórter');
    await seedMember(t, rep.userId, 'reporter');
    expect((await req(`${ROUTE(t, id)}/recortes`, { cookie: rep.cookie })).status).toBe(200);
    expect((await req(`${ROUTE(t, id)}/material/busca?q=licitacao`, { cookie: rep.cookie })).status).toBe(200);
    expect((await req(`${ROUTE(t, id)}/evidencias/${ev}/texto`, { cookie: rep.cookie })).status).toBe(200);
    expect((await req(`/api/t/${t}/textos/acervo?menos=${sibling}`, { cookie: rep.cookie })).status).toBe(200);
    expect((await store(t, id, rep.cookie, { origem: 'nota', trecho: 'oi' })).status).toBe(403);
    expect((await change(t, id, rep.cookie, rec, { nota: 'x' })).status).toBe(403);
    expect((await req(`${ROUTE(t, id)}/recortes/${rec}`, { cookie: rep.cookie, method: 'DELETE' })).status).toBe(403);
    expect((await bring(t, sibling, rep.cookie, 'recorte', rec)).status).toBe(403);
    expect(await count('recortes', id)).toBe(1);
  }, 15_000);   // two outlets and a read PDF; ~30 requests
});

type In = { type: string; attrs?: Record<string, unknown>; content?: In[]; text?: string };
type TextState = { texto: { versao: number; doc: In }; evidencias: { id: string; titulo: string }[]; apontamentos: { tipo: string; blocoId: string; trecho: string }[] };

describe('the quote inserted with the citation is born resolved', () => {
  it('“trecho” and the citation note, as the screen inserts them: no quote note without a source; the recording links to the minute', async () => {
    const { s, t } = await outlet();
    const id = await newText(t, s);
    const ev = await withLink(t, id, s);
    await withRecording(t, id, s);
    // The stored passage (with spaces joined by the server), and one with straight quotes inside, taken from the reader.
    const reader = await (await req(`${ROUTE(t, id)}/evidencias/${ev}/texto`, { cookie: s.cookie })).json<{ paragrafos: string[] }>();
    const withQuotes = reader.paragrafos.find((p) => p.includes('declarou'))!.match(/O presidente[^.]+aprovadas"/)![0];
    const recs: Clipping[] = [];
    for (const [origin, passage, extra] of [
      ['evidencia', 'renovação de 12\n contratos de ônibus sem licitação', { evidenciaId: ev }],
      ['evidencia', withQuotes, { evidenciaId: ev }],
      ['gravacao', 'eu nunca recebi um centavo das empresas de ônibus', { arquivoId: (await env.DB.prepare("SELECT id FROM arquivos WHERE texto_id = ? AND tipo = 'audio'").bind(id).first<{ id: string }>())!.id }],
    ] as const) {
      const r = await store(t, id, s.cookie, { origem: origin, trecho: passage, ...extra });
      expect(r.status).toBe(201);
      recs.push((await r.json<List>()).recortes.at(-1)!);
    }
    let state = await (await req(ROUTE(t, id), { cookie: s.cookie })).json<TextState>();
    const label = `[${state.evidencias[0].titulo}]`;   // the screen's noteLabel: the short title in brackets
    // Insert from evidence: the passage in curly quotes, a space, the citation note (and the space `citar` puts after it).
    const withCitation = (passage: string): In[] => [{ type: 'text', text: `“${passage}” ` }, { type: 'nota', attrs: { rotulo: label, evidencia: ev } }, { type: 'text', text: ' ' }];
    const doc = (extra: In[][]) => ({
      type: 'doc', content: [
        { type: 'paragraph', attrs: { id: 'p0' }, content: [{ type: 'text', text: 'Contratos sem concorrência' }] },
        { type: 'paragraph', attrs: { id: 'p1' }, content: [{ type: 'text', text: 'Segundo o relatório, ' }, ...withCitation(recs[0].trecho), { type: 'text', text: 'diz o documento.' }] },
        { type: 'paragraph', attrs: { id: 'p2' }, content: [...withCitation(recs[1].trecho)] },
        // Insert from a recording: the speech in quotes, like inserirAspa.
        { type: 'paragraph', attrs: { id: 'p3' }, content: [{ type: 'text', text: `O vereador negou: “${recs[2].trecho}” ` }] },
        ...extra.map((content, i) => ({ type: 'paragraph', attrs: { id: `x${i}` }, content })),
      ],
    });
    const save = async (extra: In[][]) => {
      const r = await req(ROUTE(t, id), { cookie: s.cookie, method: 'PUT', body: { doc: doc(extra), versao: state.texto.versao } });
      expect(r.status).toBe(200);
      state = await r.json<TextState>();
    };
    await save([]);
    expect(state.texto.doc.content![1].content!.some((n) => n.type === 'nota')).toBe(true);   // the note went through the document cleanup
    expect(state.apontamentos.filter((a) => a.tipo === 'aspa')).toEqual([]);
    expect(state.apontamentos.filter((a) => a.tipo === 'gravacao').map((a) => a.blocoId)).toEqual(['p3']);

    // The test is sensitive: the same quote with one letter changed opens the finding.
    await save([withCitation(recs[0].trecho.replace('12', '13'))]);
    expect(state.apontamentos.filter((a) => a.tipo === 'aspa').map((a) => a.blocoId)).toEqual(['x0']);
  });
});
