// Phase 5: recording in the app. Slices upload out of order and repeated, finishing assembles the segments, the queue
// transcribes one by one with absolute time and the overlap's word stays on one side only. One segment's failure does
// not hold up the others.
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { findInRecording, transcriptsText } from '../src/lib/recording';
import { finishSessionsStopped, closeSegment, processSegment } from '../src/lib/recordingSession';
import { SLICES_PER_SEGMENT, shiftPassages, gapsSegment, fromSegmentWindow, savedUntil, segmentTime } from '../src/lib/segments';
import { register, req, seedMember } from './helpers';

const words = (ini: number, text: string) => text.split(' ').map((w, k) => ({ word: ` ${w}`, start: ini + k * 0.4, end: ini + k * 0.4 + 0.35 }));
const whisper = (ini: number, text: string) => ({ text: text, transcription_info: { duration: 121 }, segments: [{ start: ini, end: ini + 5, text: ` ${text}`, words: words(ini, text) }] });

let output: unknown | 'fora' = whisper(0, 'nada');
beforeEach(() => {
  const original = globalThis.fetch;
  // Without this, the real consumer runs alongside these tests' direct calls.
  vi.spyOn(env.MONITOR_QUEUE, 'sendBatch').mockResolvedValue(undefined as never);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === 'https://whisper.example/transcrever') return output === 'fora' ? new Response('fora', { status: 503 }) : Response.json(output);
    // The package asks the test TSA for the timestamp: without this the request went to the network and the test depended on the machine's DNS.
    if (url.includes('.example')) return new Response('não achei', { status: 404 });
    return original(input, init);
  });
});
afterEach(() => vi.restoreAllMocks());

async function story() {
  const s = await register('Repórter Teste');
  const t = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO tenants (id, slug, nome, modo, plano) VALUES (?, ?, 'Cartas', 'autoral', 'cortesia')").bind(t, `g-${t.slice(0, 8)}`).run();
  await seedMember(t, s.userId, 'admin');
  const { texto: text } = await (await req(`/api/t/${t}/textos`, { cookie: s.cookie, body: { texto: 'Entrevista com o vereador' } })).json<{ texto: { id: string } }>();
  return { s, t, id: text.id };
}
const ROUTE = (t: string, id: string) => `/api/t/${t}/textos/${id}`;
const WEBM = (brand: number) => new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, brand]);
const launch = async (t: string, id: string, cookie: string) =>
  (await (await req(`${ROUTE(t, id)}/gravacoes/sessao`, { cookie, body: { mime: 'audio/webm;codecs=opus' } })).json<{ sessao: string }>()).sessao;
const slice = (t: string, id: string, cookie: string, session: string, seg: number | string, f: number | string, body: Uint8Array<ArrayBuffer> = WEBM(Number(f))) =>
  req(`${ROUTE(t, id)}/gravacoes/sessao/${session}/${seg}/${f}`, { method: 'PUT', cookie, cru: { tipo: 'application/octet-stream', corpo: body } });
const finish = (t: string, id: string, cookie: string, session: string) => req(`${ROUTE(t, id)}/gravacoes/sessao/${session}/concluir`, { method: 'POST', cookie });

type G = { id: string; estado: string; erro: string | null; duracao: number | null; segmentos: { total: number; prontos: number; falhos: { n: number; erro: string }[]; faltas: { de: number; ate: number }[]; inicios: number[] } | null };
const recording = async (t: string, id: string, cookie: string) => (await (await req(ROUTE(t, id), { cookie })).json<{ gravacoes: G[] }>()).gravacoes[0];
const segments = (file: string) => env.DB.prepare('SELECT n, r2, estado, inicio, bytes, sha256, faltas_json FROM gravacao_segmentos WHERE arquivo_id = ? ORDER BY n').bind(file)
  .all<{ n: number; r2: string | null; estado: string; inicio: number; bytes: number; sha256: string; faltas_json: string }>().then((r) => r.results);

describe('pure math', () => {
  it('the splice sits in the middle of the overlap, and each word counts on one side only', () => {
    expect(fromSegmentWindow(0, 2)).toEqual({ de: 0, ate: 120.5 });
    expect(fromSegmentWindow(1, 2)).toEqual({ de: 120.5, ate: 240.5 });
    expect(fromSegmentWindow(2, 2).ate).toBe(Infinity);
    expect(segmentTime(120.4)).toBe(0);
    expect(segmentTime(120.6)).toBe(1);
    const speech = [{ start: 119, end: 121, text: ' bem na emenda', words: [{ word: ' bem', start: 119.8, end: 120.1 }, { word: ' na', start: 120.2, end: 120.4 }, { word: ' emenda', start: 120.6, end: 121 }] }];
    expect(shiftPassages(speech, 0, fromSegmentWindow(0, 1))).toEqual([expect.objectContaining({ texto: 'bem na', inicio: 119.8, fim: 120.4 })]);
    const next = [{ start: 0, end: 1, text: ' na emenda', words: [{ word: ' na', start: 0.2, end: 0.4 }, { word: ' emenda', start: 0.6, end: 1 }] }];
    expect(shiftPassages(next, 120, fromSegmentWindow(1, 1))).toEqual([expect.objectContaining({ texto: 'emenda', inicio: 120.6 })]);
  });

  it('an excerpt without word timing counts from its start', () => {
    expect(shiftPassages([{ start: 10, end: 12, text: ' oi ' }], 240, { de: 240.5, ate: 360.5 })).toEqual([{ inicio: 250, fim: 252, texto: 'oi', palavras: [] }]);
    expect(shiftPassages([{ start: 0.1, end: 2, text: ' oi' }], 240, { de: 240.5, ate: 360.5 })).toEqual([]);
  });

  it("a missing slice becomes a lost excerpt with its time; missing only in the overlap isn't a loss", () => {
    const all = Array.from({ length: SLICES_PER_SEGMENT }, (_, i) => i);
    expect(gapsSegment(0, all, false)).toEqual([]);
    expect(gapsSegment(6, all.filter((f) => f !== 6 && f !== 7), false)).toEqual([{ de: 750, ate: 760 }]);
    expect(gapsSegment(0, all.filter((f) => f !== SLICES_PER_SEGMENT - 1), false)).toEqual([]);
    expect(gapsSegment(1, [], false)).toEqual([{ de: 120, ate: 240 }]);
    // The last segment ends at the last slice that arrived.
    expect(gapsSegment(2, [0, 1, 3], true)).toEqual([{ de: 250, ate: 255 }]);
  });

  it('saved-up-to only advances without gaps', () => {
    expect(savedUntil(new Set())).toBe(0);
    expect(savedUntil(new Set(['0/0', '0/1', '0/3']))).toBe(10);
    expect(savedUntil(new Set(['0/0', '0/1']), 10, 5)).toBe(10);
    expect(savedUntil(new Set(['0/0', '0/1', '1/0']), 10, 5)).toBe(15);
  });
});

describe('slices and session', () => {
  it('out of order and repeated: the segment comes out in the right order, with hash, and the slices disappear', async () => {
    const { s, t, id } = await story();
    const session = await launch(t, id, s.cookie);
    for (const f of [2, 0, 1, 1, 0]) expect((await slice(t, id, s.cookie, session, 0, f)).status).toBe(200);
    expect((await recording(t, id, s.cookie))).toBeUndefined();   // the row is only born on finish
    expect((await req(ROUTE(t, id), { cookie: s.cookie }).then((r) => r.json<{ sessoesAbertas: { id: string }[] }>())).sessoesAbertas.map((x) => x.id)).toEqual([session]);
    expect((await finish(t, id, s.cookie, session)).status).toBe(200);
    const g = await recording(t, id, s.cookie);
    expect(g).toMatchObject({ estado: 'lendo', segmentos: { total: 1, prontos: 0 } });
    output = whisper(1, 'bom dia a todos');
    await processSegment(env, t, g.id, 0);
    const [seg] = await segments(g.id);
    expect(seg).toMatchObject({ estado: 'pronto', r2: `gravacoes/${t}/${session}/0.webm`, bytes: 17 * 3 });
    const obj = await env.MEDIA.get(seg.r2!);
    const b = new Uint8Array(await obj!.arrayBuffer());
    expect([b[16], b[33], b[50]]).toEqual([0, 1, 2]);
    expect(seg.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await env.MEDIA.list({ prefix: `gravacoes/${t}/${session}/0/` })).objects).toHaveLength(0);
    expect(await recording(t, id, s.cookie)).toMatchObject({ estado: 'pronto', duracao: expect.closeTo(2.55, 2), segmentos: { prontos: 1 } });
    // Once finished, nothing goes in, and finishing again is the same.
    expect((await slice(t, id, s.cookie, session, 0, 3)).status).toBe(409);
    expect((await finish(t, id, s.cookie, session)).status).toBe(200);
    expect((await segments(g.id))).toHaveLength(1);
  });

  it('refuses format, number, empty body and the 3-hour cap', async () => {
    const { s, t, id } = await story();
    expect((await req(`${ROUTE(t, id)}/gravacoes/sessao`, { cookie: s.cookie, body: { mime: 'video/mp4' } })).status).toBe(422);
    const session = await launch(t, id, s.cookie);
    expect((await slice(t, id, s.cookie, session, 0, 0, new TextEncoder().encode('isto não é um áudio, é texto') as Uint8Array<ArrayBuffer>)).status).toBe(422);
    expect((await slice(t, id, s.cookie, session, 0, 'x')).status).toBe(400);
    expect((await slice(t, id, s.cookie, session, 0, 1, new Uint8Array(0))).status).toBe(422);
    expect((await slice(t, id, s.cookie, session, 0, 1, new Uint8Array(257 * 1024))).status).toBe(422);
    expect((await slice(t, id, s.cookie, session, 90, 0)).status).toBe(409);
    expect((await slice(t, id, s.cookie, session, 89, 0)).status).toBe(200);
  });

  it('IDOR: another outlet, another text, reporter, and an outlet outside author mode', async () => {
    const { s, t, id } = await story();
    const session = await launch(t, id, s.cookie);
    await slice(t, id, s.cookie, session, 0, 0);
    const other = await story();
    expect((await slice(t, id, other.s.cookie, session, 0, 0)).status).toBe(404);
    expect((await slice(other.t, other.id, other.s.cookie, session, 0, 0)).status).toBe(404);
    expect((await finish(other.t, other.id, other.s.cookie, session)).status).toBe(404);
    const { texto: text } = await (await req(`/api/t/${t}/textos`, { cookie: s.cookie, body: { texto: 'Outro texto' } })).json<{ texto: { id: string } }>();
    expect((await slice(t, text.id, s.cookie, session, 0, 0)).status).toBe(404);
    expect((await finish(t, id, s.cookie, session)).status).toBe(200);
    const g = await recording(t, id, s.cookie);
    expect((await req(`${ROUTE(other.t, other.id)}/gravacoes/${g.id}/audio?t=0`, { cookie: other.s.cookie })).status).toBe(404);
    expect((await req(`${ROUTE(other.t, other.id)}/gravacoes/${g.id}/segmentos/0/tentar`, { method: 'POST', cookie: other.s.cookie })).status).toBe(404);
    const rep = await register('Só repórter');
    await seedMember(t, rep.userId, 'reporter');
    expect((await req(`${ROUTE(t, id)}/gravacoes/sessao`, { cookie: rep.cookie, body: { mime: 'audio/webm' } })).status).toBe(403);
    expect((await slice(t, id, rep.cookie, session, 0, 1)).status).toBe(403);
    expect((await finish(t, id, rep.cookie, session)).status).toBe(403);
  });

  it("the cron closes a session idle for more than 2 hours; a recent one and an empty one don't become a recording", async () => {
    const { s, t, id } = await story();
    const stopped = await launch(t, id, s.cookie);
    await slice(t, id, s.cookie, stopped, 0, 0);
    const recent = await launch(t, id, s.cookie);
    await slice(t, id, s.cookie, recent, 0, 0);
    const empty = await launch(t, id, s.cookie);
    await env.DB.prepare("UPDATE gravacao_sessoes SET ultima_em = datetime('now', '-3 hours') WHERE id IN (?, ?)").bind(stopped, empty).run();
    expect(await finishSessionsStopped(env)).toBeGreaterThanOrEqual(2);
    const states = await env.DB.prepare('SELECT id, estado FROM gravacao_sessoes WHERE id IN (?, ?, ?)').bind(stopped, recent, empty).all<{ id: string; estado: string }>();
    expect(Object.fromEntries(states.results.map((x) => [x.id, x.estado]))).toEqual({ [stopped]: 'concluida', [recent]: 'gravando', [empty]: 'vazia' });
    expect((await recording(t, id, s.cookie)).segmentos?.total).toBe(1);
  });
});

describe('transcription per segment', () => {
  async function twoParts() {
    const m = await story();
    const session = await launch(m.t, m.id, m.s.cookie);
    await slice(m.t, m.id, m.s.cookie, session, 0, 0);
    await slice(m.t, m.id, m.s.cookie, session, 1, 0);
    await finish(m.t, m.id, m.s.cookie, session);
    return { ...m, sessao: session, arquivo: (await recording(m.t, m.id, m.s.cookie)).id };
  }

  it('absolute time, overlap without repeats, and a quote found at the splice', async () => {
    const { s, t, id, arquivo: file } = await twoParts();
    output = whisper(118.6, 'eu nunca recebi um centavo');
    await processSegment(env, t, file, 0);
    expect((await recording(t, id, s.cookie)).estado).toBe('lendo');
    output = whisper(0.2, 'centavo das empresas de ônibus');
    await processSegment(env, t, file, 1);
    expect(await recording(t, id, s.cookie)).toMatchObject({ estado: 'pronto', segmentos: { total: 2, prontos: 2 } });
    const { prontas: ready } = await transcriptsText(env, t, id);
    const speech = ready[0].trechos.flatMap((x) => x.palavras.map((w) => w.p.trim()));
    expect(speech.join(' ')).toBe('eu nunca recebi um centavo das empresas de ônibus');
    const g = findInRecording('recebi um centavo das empresas', ready);
    expect(g).toMatchObject({ arquivoId: file, segmentada: true });
    expect(g!.inicio).toBeCloseTo(119.4, 2);
  });

  it("one segment's failure doesn't hold the others; retrying redoes only it", async () => {
    const { s, t, id, arquivo: file } = await twoParts();
    output = 'fora';
    await processSegment(env, t, file, 0);
    output = whisper(1, 'segunda parte da fala');
    await processSegment(env, t, file, 1);
    const g = await recording(t, id, s.cookie);
    expect(g).toMatchObject({ estado: 'pronto', segmentos: { prontos: 1, falhos: [{ n: 0, erro: expect.stringContaining('transcrição falhou') }] } });
    expect((await req(`${ROUTE(t, id)}/gravacoes/${file}/segmentos/1/tentar`, { method: 'POST', cookie: s.cookie })).status).toBe(409);
    expect((await req(`${ROUTE(t, id)}/gravacoes/${file}/segmentos/0/tentar`, { method: 'POST', cookie: s.cookie })).status).toBe(200);
    expect((await recording(t, id, s.cookie)).estado).toBe('lendo');
    output = whisper(1, 'primeira parte da fala');
    await processSegment(env, t, file, 0);
    const after = await recording(t, id, s.cookie);
    expect(after).toMatchObject({ estado: 'pronto', segmentos: { prontos: 2, falhos: [] } });
    const { prontas: ready } = await transcriptsText(env, t, id);
    expect(ready[0].trechos.map((x) => x.texto)).toEqual(['primeira parte da fala', 'segunda parte da fala']);
  });

  it("all fail: the recording fails with a reason; the queue's last delivery records the failure on the segment", async () => {
    const { s, t, id, arquivo: file } = await twoParts();
    output = 'fora';
    await processSegment(env, t, file, 0);
    await closeSegment(env, t, file, 1, 'falhou depois de 5 tentativas');
    expect(await recording(t, id, s.cookie)).toMatchObject({ estado: 'falhou', erro: 'nenhum trecho foi transcrito' });
  });

  it('a segment without its first slice shows as lost, and there is nothing to retry', async () => {
    const { s, t, id } = await story();
    const session = await launch(t, id, s.cookie);
    await slice(t, id, s.cookie, session, 0, 0);
    await slice(t, id, s.cookie, session, 2, 0);
    await finish(t, id, s.cookie, session);
    const g = await recording(t, id, s.cookie);
    expect(g.segmentos).toMatchObject({ total: 3, falhos: [{ n: 1 }] });
    expect(g.segmentos!.faltas).toContainEqual({ de: 120, ate: 240 });
    expect((await req(`${ROUTE(t, id)}/gravacoes/${g.id}/segmentos/1/tentar`, { method: 'POST', cookie: s.cookie })).status).toBe(409);
  });

  it('the audio comes by time, with the start of the excerpt; the package carries one file per segment', async () => {
    const { s, t, id, arquivo: file } = await twoParts();
    output = whisper(1, 'parte falada aqui');
    await processSegment(env, t, file, 0);
    await processSegment(env, t, file, 1);
    const a = await req(`${ROUTE(t, id)}/gravacoes/${file}/audio?t=130`, { cookie: s.cookie });
    expect(a.status).toBe(200);
    expect(a.headers.get('x-inicio')).toBe('120');
    expect(a.headers.get('content-type')).toBe('audio/webm');
    expect((await a.arrayBuffer()).byteLength).toBe(17);
    const r = await req(`${ROUTE(t, id)}/gravacoes/${file}/audio?t=0`, { cookie: s.cookie, headers: { range: 'bytes=0-3' } });
    expect(r.status).toBe(206);
    expect(r.headers.get('x-inicio')).toBe('0');
    const zip = unzipSync(new Uint8Array(await (await req(`${ROUTE(t, id)}/pacote`, { method: 'GET', cookie: s.cookie })).arrayBuffer()));
    const names = Object.keys(zip).filter((k) => k.includes('dossie/gravacoes'));
    expect(names.filter((k) => /parte-0[12]\.webm$/.test(k))).toHaveLength(2);
    const tr = names.find((k) => k.endsWith('.transcricao.json'))!;
    expect(strFromU8(zip[tr])).toContain('parte falada aqui');
  });
});
