// Phase 6 (handoffs/2026-11-02-materia-e-editor-investigativo.md): quotes against the recording. The audio in R2
// (format from the file's start), the Whisper transcript (simulated by fetch at WHISPER_URL) with each word's time, and
// each quotation checked by code against it, word by word: "matches at mm:ss" or "not found"; a transcript still in the
// queue leaves the quote open and says so; a failure stays visible. The audio plays with Range; the package carries the
// audio and the transcript; IDOR on the new routes.
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { findInRecording, mmss, wordsSpeech, processRecording } from '../src/lib/recording';
import { BusyFile } from '../src/lib/document';
import { register, req, seedMember } from './helpers';
import { fakeWav } from './fake-audio';

const P = [
  'Entrevista com o vereador',
  'O vereador Ícaro Nunes negou: "Nunca recebi um centavo das empresas de ônibus", disse ele.',
  'Ele também afirmou que "a licitação vai sair em março do ano que vem".',
];
const TEXT = P.join('\n');

/** Whisper output: each passage with its words spaced 0.4 s apart from the start. */
function whisper(passages: [number, string][]) {
  return {
    text: passages.map(([, t]) => t).join(' '),
    transcription_info: { language: 'pt', duration: 90 },
    segments: passages.map(([ini, text]) => {
      const ws = text.split(' ');
      return { start: ini, end: ini + ws.length * 0.4, text: ` ${text}`, words: ws.map((w, k) => ({ word: ` ${w}`, start: ini + k * 0.4, end: ini + k * 0.4 + 0.35 })) };
    }),
  };
}
const SPEECH: [number, string][] = [
  [0, 'Bom dia, obrigado por me receber.'],
  [72.4, 'Olha, eu nunca recebi um centavo das empresas de ônibus. Isso é mentira.'],
  [80, 'A licitação vai sair em abril do ano que vem.'],
];

let output: unknown | 'fora';
let requests: { audio: string; language: string }[] = [];
beforeEach(() => {
  output = whisper(SPEECH);
  requests = [];
  const original = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === 'https://whisper.example/transcrever') {
      requests.push(JSON.parse(init!.body as string));
      return output === 'fora' ? new Response('fora', { status: 503 }) : Response.json(output);
    }
    if (url.includes('deepseek')) return Response.json({ choices: [{ message: { content: '{"afirmacoes":[]}' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
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
  const { texto: text } = await (await req(`/api/t/${t}/textos`, { cookie: s.cookie, body: { texto: TEXT } })).json<{ texto: { id: string } }>();
  return { s, t, id: text.id };
}
const ROUTE = (t: string, id: string) => `/api/t/${t}/textos/${id}`;
const send = (t: string, id: string, cookie: string, bytes: Uint8Array<ArrayBuffer>, name = 'entrevista.wav') =>
  req(`${ROUTE(t, id)}/gravacoes`, { cookie, cru: { tipo: 'audio/wav', corpo: bytes }, headers: { 'x-nome': encodeURIComponent(name) } });

interface Recording { id: string; nome: string; estado: string; erro: string | null; duracao: number | null }
interface Finding { id: string; tipo: string; trecho: string; explicacao: string; gravacao?: { arquivoId: string; nome: string; inicio: number; fim: number } }
interface State { gravacoes: Recording[]; apontamentos: Finding[]; checklist: { pendencias: { tipo: string; trecho: string }[] } }
const read = async (t: string, id: string, cookie: string) => (await req(ROUTE(t, id), { cookie })).json<State>();

async function recordingRead(t: string, id: string, cookie: string, bytes = fakeWav()) {
  const r = await send(t, id, cookie, bytes);
  expect(r.status).toBe(201);
  const { arquivoId: fileId } = await r.json<{ arquivoId: string }>();
  await processRecording(env as never, t, fileId);
  return fileId;
}

describe('check by code', () => {
  it("word by word, without punctuation, capitals or accents; the time is the first word's", () => {
    const tr = [{ id: 'a1', nome: 'e.wav', trechos: whisper(SPEECH).segments.map((s) => ({ inicio: s.start, fim: s.end, texto: s.text, palavras: s.words.map((w) => ({ p: w.word, i: w.start, f: w.end })) })) }];
    expect(wordsSpeech('Nunca recebi, um "centavo"!')).toEqual(['nunca', 'recebi', 'um', 'centavo']);
    const g = findInRecording('NUNCA recebi um centavo das empresas de onibus', tr);
    expect(g).toMatchObject({ arquivoId: 'a1', nome: 'e.wav' });
    expect(g!.inicio).toBeCloseTo(73.2, 5);
    expect(mmss(g!.inicio)).toBe('01:13');
    expect(findInRecording('a licitação vai sair em março do ano que vem', tr)).toBeNull();   // one different word
    expect(findInRecording('nunca recebi', tr)).toBeNull();                                      // too short to count
    expect(mmss(3725)).toBe('1:02:05');
  });
});

describe('upload and transcription', () => {
  it("audio only; too big gives 422; the same file is the earlier one; transcribes in the outlet's language and keeps the time", async () => {
    const { s, t, id } = await story();
    const notAudio = await req(`${ROUTE(t, id)}/gravacoes`, { cookie: s.cookie, cru: { tipo: 'audio/mpeg', corpo: new TextEncoder().encode('isto não é um áudio, é texto puro') } });
    expect(notAudio.status).toBe(422);
    expect((await notAudio.json<{ code: string }>()).code).toBe('nao_audio');
    const large = new Uint8Array(25 * 1024 * 1024 + 1);
    large.set(fakeWav().slice(0, 44));
    expect((await send(t, id, s.cookie, large)).status).toBe(422);

    const file = await recordingRead(t, id, s.cookie);
    expect(requests).toHaveLength(1);
    expect(requests[0].language).toBe('pt');
    expect(atob(requests[0].audio).slice(0, 4)).toBe('RIFF');   // the audio goes whole, in base64
    const de2 = await send(t, id, s.cookie, fakeWav());
    expect(de2.status).toBe(200);
    expect(await de2.json<{ arquivoId: string; existia: boolean }>()).toMatchObject({ arquivoId: file, existia: true });
    const e = await read(t, id, s.cookie);
    expect(e.gravacoes).toEqual([expect.objectContaining({ id: file, nome: 'entrevista.wav', estado: 'pronto', erro: null, duracao: 90 })]);

    const tr = await (await req(`${ROUTE(t, id)}/gravacoes/${file}/transcricao`, { cookie: s.cookie })).json<{ trechos: { inicio: number; texto: string }[] }>();
    expect(tr.trechos.map((x) => x.texto)).toEqual(SPEECH.map(([, f]) => f));
    expect(tr.trechos[1].inicio).toBe(72.4);
  });

  it('a quote found in the recording matches the minute; one not found stays open on the checklist', async () => {
    const { s, t, id } = await story();
    // Before the transcript: the quote stays open and says the recording is still queued (it does not vanish silently).
    const r = await send(t, id, s.cookie, fakeWav());
    const { arquivoId: fileId } = await r.json<{ arquivoId: string }>();
    const before = await read(t, id, s.cookie);
    expect(before.apontamentos.filter((p) => p.tipo === 'aspa').map((p) => p.explicacao)).toEqual([expect.stringContaining('ainda está sendo transcrita'), expect.stringContaining('ainda está sendo transcrita')]);
    expect(before.checklist.pendencias.filter((p) => p.tipo === 'aspa')).toHaveLength(2);

    await processRecording(env as never, t, fileId);
    const e = await read(t, id, s.cookie);
    const matches = e.apontamentos.find((p) => p.tipo === 'gravacao');
    expect(matches).toMatchObject({ trecho: '"Nunca recebi um centavo das empresas de ônibus"', gravacao: { arquivoId: fileId, nome: 'entrevista.wav' } });
    expect(matches!.explicacao).toBe('Bate com a gravação aos 01:13 (entrevista.wav), palavra por palavra.');
    const not = e.apontamentos.filter((p) => p.tipo === 'aspa');
    expect(not).toHaveLength(1);
    expect(not[0].trecho).toContain('março');
    expect(not[0].explicacao).toContain('nem nas gravações');
    expect(e.checklist.pendencias.filter((p) => p.tipo === 'aspa').map((p) => p.trecho)).toEqual([not[0].trecho]);
  });

  it('Whisper down or no speech: the recording is "falhou" with the reason, and the quote stays open', async () => {
    const { s, t, id } = await story();
    output = 'fora';
    const a = await recordingRead(t, id, s.cookie);
    output = { text: '', segments: [] };
    const b = await recordingRead(t, id, s.cookie, fakeWav(1, 1));
    const e = await read(t, id, s.cookie);
    expect(e.gravacoes.find((g) => g.id === a)).toMatchObject({ estado: 'falhou', erro: 'a transcrição falhou (HTTP 503)' });
    expect(e.gravacoes.find((g) => g.id === b)).toMatchObject({ estado: 'falhou', erro: 'a transcrição não achou fala no áudio' });
    expect(e.apontamentos.filter((p) => p.tipo === 'aspa')).toHaveLength(2);
    expect(e.apontamentos.some((p) => p.tipo === 'gravacao')).toBe(false);
  });
});

describe('the audio plays and goes into the package', () => {
  it('Range returns just the piece (206); without Range, the whole file; the package carries the audio and the transcript', async () => {
    const { s, t, id } = await story();
    const file = await recordingRead(t, id, s.cookie);
    const part = await req(`${ROUTE(t, id)}/gravacoes/${file}/audio`, { method: 'GET', cookie: s.cookie, headers: { range: 'bytes=0-11' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes 0-11/${8044}`);
    const chunk = new Uint8Array(await part.arrayBuffer());
    expect(chunk.byteLength).toBe(12);
    expect(String.fromCharCode(...chunk.slice(0, 4), ...chunk.slice(8, 12))).toBe('RIFFWAVE');
    const all = await req(`${ROUTE(t, id)}/gravacoes/${file}/audio`, { method: 'GET', cookie: s.cookie });
    expect(all.status).toBe(200);
    expect(all.headers.get('content-type')).toBe('audio/wav');
    expect((await all.arrayBuffer()).byteLength).toBe(8044);
    expect((await req(`${ROUTE(t, id)}/gravacoes/${file}/audio`, { method: 'GET', cookie: s.cookie, headers: { range: 'bytes=9000-' } })).status).toBe(416);

    const zip = unzipSync(new Uint8Array(await (await req(`${ROUTE(t, id)}/pacote`, { method: 'GET', cookie: s.cookie })).arrayBuffer()));
    expect(Object.keys(zip)).toContain('dossie/gravacoes/01-entrevista.wav');
    const tr = JSON.parse(strFromU8(zip['dossie/gravacoes/01-entrevista.transcricao.json'])) as { nome: string; trechos: { inicio: number; texto: string; palavras: unknown[] }[] };
    expect(tr.nome).toBe('entrevista.wav');
    expect(tr.trechos[1]).toMatchObject({ inicio: 72.4, texto: SPEECH[1][1] });
    expect(tr.trechos[1].palavras.length).toBeGreaterThan(5);
    expect(Object.keys(zip).some((n) => n.startsWith('dossie/documentos/'))).toBe(false);   // the audio does not become a "document"
  });
});

describe('IDOR and role on the new routes', () => {
  it("another outlet can't reach it (404); reporter listens and reads, but doesn't upload (403)", async () => {
    const a = await story();
    const b = await story();
    const file = await recordingRead(a.t, a.id, a.s.cookie);
    const routes: [string, string][] = [['GET', `${ROUTE(a.t, a.id)}/gravacoes/${file}/audio`], ['GET', `${ROUTE(a.t, a.id)}/gravacoes/${file}/transcricao`]];
    for (const [m, p] of routes) expect((await req(p, { method: m, cookie: b.s.cookie })).status, `${m} ${p}`).toBe(404);
    expect((await send(a.t, a.id, b.s.cookie, fakeWav(1, 2))).status).toBe(404);
    // Outlet A's file through outlet B's text routes: 404.
    for (const p of [`${ROUTE(b.t, b.id)}/gravacoes/${file}/audio`, `${ROUTE(b.t, b.id)}/gravacoes/${file}/transcricao`]) expect((await req(p, { method: 'GET', cookie: b.s.cookie })).status, p).toBe(404);

    const rep = await register('Repórter Só');
    await seedMember(a.t, rep.userId, 'reporter');
    expect((await send(a.t, a.id, rep.cookie, fakeWav(1, 3))).status).toBe(403);
    expect((await req(`${ROUTE(a.t, a.id)}/gravacoes/${file}/transcricao`, { cookie: rep.cookie })).status).toBe(200);
    expect((await req(`${ROUTE(a.t, a.id)}/gravacoes/${file}/audio`, { method: 'GET', cookie: rep.cookie })).status).toBe(200);
  });
});

// ── review (Codex, 03/11): a failure that restarts, duplicate delivery, queue down, upload cap, last attempt ──

describe('review: the recording in the queue', () => {
  it('Whisper failed: sending the same audio again restarts the transcription (it doesn\'t return the earlier "falhou")', async () => {
    const { s, t, id } = await story();
    output = 'fora';
    const r = await send(t, id, s.cookie, fakeWav());
    const { arquivoId: fileId } = await r.json<{ arquivoId: string }>();
    await processRecording(env, t, fileId);
    expect((await read(t, id, s.cookie)).gravacoes[0]).toMatchObject({ estado: 'falhou' });
    output = whisper(SPEECH);
    const from = await send(t, id, s.cookie, fakeWav());
    expect(from.status).toBe(200);
    expect((await read(t, id, s.cookie)).gravacoes[0]).toMatchObject({ estado: 'lendo', erro: null });
    await processRecording(env, t, fileId);
    expect((await read(t, id, s.cookie)).gravacoes[0]).toMatchObject({ estado: 'pronto' });
  });

  it('duplicate queue delivery: one transcription only (the other goes back to the queue, busy), and the late one doesn\'t swap "pronto" for "falhou"', async () => {
    const { s, t, id } = await story();
    const { arquivoId: fileId } = await (await send(t, id, s.cookie, fakeWav())).json<{ arquivoId: string }>();
    const r = await Promise.allSettled([processRecording(env, t, fileId), processRecording(env, t, fileId)]);
    expect(r.map((x) => x.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect((r.find((x) => x.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(BusyFile);
    expect(requests).toHaveLength(1);
    expect((await read(t, id, s.cookie)).gravacoes[0].estado).toBe('pronto');
    // A failure that arrives later (the old message) does not touch the ready file.
    output = 'fora';
    await processRecording(env, t, fileId);
    expect((await read(t, id, s.cookie)).gravacoes[0].estado).toBe('pronto');
  });

  it('the queue did not accept the file: it stays "falhou" with the reason (never "transcrevendo" forever)', async () => {
    const { s, t, id } = await story();
    const { sendAudio } = await import('../src/lib/recording');
    const withoutQueue = { ...env, MONITOR_QUEUE: { send: async () => { throw new Error('fila fora'); } } } as unknown as typeof env;
    const b = fakeWav();
    await sendAudio(withoutQueue, t, id, s.userId, 'entrevista.wav', b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
    expect((await read(t, id, s.cookie)).gravacoes[0]).toMatchObject({ estado: 'falhou', erro: expect.stringContaining('não entrou na fila') });
  });

  it('error outside the transcription (storage down) up to the last attempt: the file stays "falhou", with the reason', async () => {
    const { s, t, id } = await story();
    const { arquivoId: fileId } = await (await send(t, id, s.cookie, fakeWav())).json<{ arquivoId: string }>();
    const { queue } = await import('../src/monitor/consumer');
    const r2Outside = { ...env, MEDIA: { ...env.MEDIA, get: async () => { throw new Error('R2 fora'); } } } as unknown as typeof env;
    const msg = (attempts: number) => {
      const m = { body: { tipo: 'gravacao', tenantId: t, arquivoId: fileId }, attempts, acks: 0, retries: 0, ack() { m.acks++; }, retry() { m.retries++; } };
      return m;
    };
    const first = msg(1);
    await queue({ messages: [first] } as never, r2Outside, {} as never);
    expect(first.retries).toBe(1);
    expect((await read(t, id, s.cookie)).gravacoes[0].estado).toBe('lendo');
    const last = msg(4);
    await queue({ messages: [last] } as never, r2Outside, {} as never);
    expect(last.acks).toBe(1);
    expect((await read(t, id, s.cookie)).gravacoes[0]).toMatchObject({ estado: 'falhou', erro: expect.stringContaining('R2 fora') });
  });

  it('audio above 25 MB: 422 without storing anything', async () => {
    const { s, t, id } = await story();
    const large = new Uint8Array(25 * 1024 * 1024 + 1);
    large.set(fakeWav().slice(0, 44));
    const r = await send(t, id, s.cookie, large);
    expect(r.status).toBe(422);
    expect((await r.json<{ code: string }>()).code).toBe('grande');
    expect((await read(t, id, s.cookie)).gravacoes).toHaveLength(0);
  });
});

// ── review 2 (Codex, 03/11): a held lease is not "done"; a dead owner; the last delivery only goes out with the failure recorded ──

describe('review: file ownership', () => {
  const msg = (body: unknown, attempts: number) => {
    const m = { body, attempts, acks: 0, retries: [] as unknown[], ack() { m.acks++; }, retry(o?: unknown) { m.retries.push(o ?? null); } };
    return m;
  };
  const state = async (fileId: string) => env.DB.prepare('SELECT estado, erro, processando_em FROM arquivos WHERE id = ?').bind(fileId).first<{ estado: string; erro: string | null; processando_em: string | null }>();

  it('another delivery holds the file: this one goes back to the queue after the claim expires (not confirmed as done)', async () => {
    const { s, t, id } = await story();
    const { arquivoId: fileId } = await (await send(t, id, s.cookie, fakeWav())).json<{ arquivoId: string }>();
    await env.DB.prepare("UPDATE arquivos SET processando_em = datetime('now') WHERE id = ?").bind(fileId).run();
    const { queue } = await import('../src/monitor/consumer');
    const m = msg({ tipo: 'gravacao', tenantId: t, arquivoId: fileId }, 1);
    await queue({ messages: [m] } as never, env, {} as never);
    expect(m.acks).toBe(0);
    expect(m.retries).toEqual([{ delaySeconds: 660 }]);
    expect(requests).toHaveLength(0);
  });

  it('the consumer died holding the claim: the next delivery, after the claim expires, transcribes', async () => {
    const { s, t, id } = await story();
    const { arquivoId: fileId } = await (await send(t, id, s.cookie, fakeWav())).json<{ arquivoId: string }>();
    await env.DB.prepare("UPDATE arquivos SET processando_em = datetime('now', '-11 minutes') WHERE id = ?").bind(fileId).run();
    await processRecording(env, t, fileId);
    expect((await state(fileId))?.estado).toBe('pronto');
  });

  it('sending again the audio that stayed "lendo" with nobody reading it (the message was lost): it goes back to the queue', async () => {
    const { s, t, id } = await story();
    const sent: unknown[] = [];
    const thatGuardQueue = { ...env, MONITOR_QUEUE: { send: async (b: unknown) => { sent.push(b); } } } as unknown as typeof env;
    const { sendAudio } = await import('../src/lib/recording');
    const b = fakeWav();
    const ab = () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    const { id: fileId } = await sendAudio(thatGuardQueue, t, id, s.userId, 'entrevista.wav', ab());
    expect(sent).toHaveLength(1);
    // Someone is reading (lease within its time): resending does not send another message.
    await env.DB.prepare("UPDATE arquivos SET processando_em = datetime('now') WHERE id = ?").bind(fileId).run();
    await sendAudio(thatGuardQueue, t, id, s.userId, 'entrevista.wav', ab());
    expect(sent).toHaveLength(1);
    // The lease expired (the consumer died): resending queues it again.
    await env.DB.prepare("UPDATE arquivos SET processando_em = datetime('now', '-11 minutes') WHERE id = ?").bind(fileId).run();
    await sendAudio(thatGuardQueue, t, id, s.userId, 'entrevista.wav', ab());
    expect(sent).toHaveLength(2);
    expect((await state(fileId))?.processando_em).toBeNull();
  });

  it('two resends of the failed audio at the same time: one message only, and the queue down on the loser doesn\'t mark "falhou"', async () => {
    const { s, t, id } = await story();
    const { arquivoId: fileId } = await (await send(t, id, s.cookie, fakeWav())).json<{ arquivoId: string }>();
    await env.DB.prepare("UPDATE arquivos SET estado = 'falhou', erro = 'whisper fora' WHERE id = ?").bind(fileId).run();
    const { enqueueFile } = await import('../src/lib/document');
    let n = 0;
    const queue = { ...env, MONITOR_QUEUE: { send: async () => { n++; } } } as unknown as typeof env;
    await Promise.all([enqueueFile(queue, t, fileId, 'gravacao', true), enqueueFile(queue, t, fileId, 'gravacao', true)]);
    expect(n).toBe(1);
    // The first consumer already took the file; a late send the queue refuses does not change its state.
    await env.DB.prepare("UPDATE arquivos SET processando_em = datetime('now') WHERE id = ?").bind(fileId).run();
    await enqueueFile({ ...env, MONITOR_QUEUE: { send: async () => { throw new Error('fila fora'); } } } as unknown as typeof env, t, fileId, 'gravacao');
    expect((await state(fileId))?.estado).toBe('lendo');
  });

  it("last delivery: the failure only leaves the queue recorded; if it can't be recorded, or the type has nowhere to record, it goes to the dead-letter queue", async () => {
    const { s, t, id } = await story();
    const { arquivoId: fileId } = await (await send(t, id, s.cookie, fakeWav())).json<{ arquivoId: string }>();
    const { queue } = await import('../src/monitor/consumer');
    // R2 down and the database refusing to record the failure (only the "failed" UPDATE).
    const db = new Proxy(env.DB, { get(target, p) {
      if (p === 'prepare') return (sql: string) => { if (sql.includes("estado = 'falhou'")) throw new Error('D1 fora'); return target.prepare(sql); };
      const v = Reflect.get(target, p); return typeof v === 'function' ? v.bind(target) : v;
    } });
    const broken = { ...env, DB: db, MEDIA: { ...env.MEDIA, get: async () => { throw new Error('R2 fora'); } } } as unknown as typeof env;
    const m = msg({ tipo: 'gravacao', tenantId: t, arquivoId: fileId }, 4);
    await queue({ messages: [m] } as never, broken, {} as never);
    expect(m.acks).toBe(0);
    expect(m.retries).toHaveLength(1);
    // A monitor document (no screen state to record): the last delivery goes to the dead-letter queue, it does not vanish.
    const d = msg({ tipo: 'documento', tenantId: t, documentoId: 'nao-existe' }, 4);
    await queue({ messages: [d] } as never, { ...env, DB: { prepare() { throw new Error('D1 fora'); } } } as unknown as typeof env, {} as never);
    expect(d.acks).toBe(0);
    expect(d.retries).toHaveLength(1);
  });
});

// ── review 3 (Codex, 03/11): initial send and resend; last delivery with a live lease; whoever lost the lease; cron ──────

describe('review 3: the claim and the outcome', () => {
  const msg = (body: unknown, attempts: number) => {
    const m = { body, attempts, acks: 0, retries: [] as unknown[], ack() { m.acks++; }, retry(o?: unknown) { m.retries.push(o ?? null); } };
    return m;
  };
  const state = async (fileId: string) => env.DB.prepare('SELECT estado, erro FROM arquivos WHERE id = ?').bind(fileId).first<{ estado: string; erro: string | null }>();

  it("the initial send that arrives after the resend doesn't send another message or step on its reservation", async () => {
    const { s, t, id } = await story();
    const { arquivoId: fileId } = await (await send(t, id, s.cookie, fakeWav())).json<{ arquivoId: string }>();
    // The file already has a send's reservation (fila_em): the late initial send does not send again.
    const { enqueueFile } = await import('../src/lib/document');
    let n = 0;
    await enqueueFile({ ...env, MONITOR_QUEUE: { send: async () => { n++; throw new Error('fila fora'); } } } as unknown as typeof env, t, fileId, 'gravacao');
    expect(n).toBe(0);
    expect((await state(fileId))?.estado).toBe('lendo');
  });

  it("last delivery with another delivery still owning the file: doesn't leave the queue as done (goes to the dead-letter queue)", async () => {
    const { s, t, id } = await story();
    const { arquivoId: fileId } = await (await send(t, id, s.cookie, fakeWav())).json<{ arquivoId: string }>();
    await env.DB.prepare("UPDATE arquivos SET processando_em = datetime('now') WHERE id = ?").bind(fileId).run();
    const { queue } = await import('../src/monitor/consumer');
    const m = msg({ tipo: 'gravacao', tenantId: t, arquivoId: fileId }, 4);
    await queue({ messages: [m] } as never, env, {} as never);
    expect(m.acks).toBe(0);
    expect(m.retries).toEqual([null]);
    expect((await state(fileId))?.estado).toBe('lendo');
  });

  it('every-15-minute cron: a "lendo" file nobody has read for over 90 minutes becomes "falhou", with the reason', async () => {
    const { s, t, id } = await story();
    const { arquivoId: old } = await (await send(t, id, s.cookie, fakeWav())).json<{ arquivoId: string }>();
    await env.DB.prepare("UPDATE arquivos SET processando_em = datetime('now', '-2 hours') WHERE id = ?").bind(old).run();
    const other = fakeWav(); other[100] ^= 1;
    const { arquivoId: created } = await (await send(t, id, s.cookie, other)).json<{ arquivoId: string }>();
    const { closeFilesStopped } = await import('../src/lib/document');
    expect(await closeFilesStopped(env)).toBeGreaterThanOrEqual(1);
    expect(await state(old)).toMatchObject({ estado: 'falhou', erro: expect.stringContaining('mande o arquivo de novo') });
    expect((await state(created))?.estado).toBe('lendo');
  });

  it("whoever lost the claim mid-transcription doesn't delete or write the excerpts of whoever took the file later", async () => {
    const { s, t, id } = await story();
    const { arquivoId: fileId } = await (await send(t, id, s.cookie, fakeWav())).json<{ arquivoId: string }>();
    const media = {
      ...env.MEDIA,
      get: async (k: string) => {
        // While A reads the audio, its lease expires and B takes the file and records a passage.
        await env.DB.batch([
          env.DB.prepare("UPDATE arquivos SET processando_em = '2099-01-01 00:00:00' WHERE id = ?").bind(fileId),
          env.DB.prepare("INSERT INTO gravacao_trechos (tenant_id, arquivo_id, n, inicio, fim, texto, palavras_json) VALUES (?, ?, 0, 0, 1, 'trecho de B', '[]')").bind(t, fileId),
        ]);
        return env.MEDIA.get(k);
      },
    };
    await processRecording({ ...env, MEDIA: media } as unknown as typeof env, t, fileId);
    const { results } = await env.DB.prepare('SELECT texto FROM gravacao_trechos WHERE arquivo_id = ?').bind(fileId).all<{ texto: string }>();
    expect(results.map((r) => r.texto)).toEqual(['trecho de B']);
    expect((await state(fileId))?.estado).toBe('lendo');
  });
});
