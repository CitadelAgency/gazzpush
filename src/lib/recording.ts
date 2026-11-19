import { Buffer } from 'node:buffer';
import type { Env } from '../env';
import { newId, recordEvent } from './db';
import { segmentsText } from './recordingSession';
import { DeskError, readText } from './desk';
import { WITH_LEASE, enqueueFile, takeFile, releaseFile } from './document';
import type { Language } from './reporting';
import { segmentTime } from './segments';

// Quotes against the recording (Story phase 6): the interview audio goes to R2, the queue transcribes it with Workers AI
// Whisper (words with timings) and each quotation in the text is looked up in the transcript by code, word by word
// (without punctuation, capitals or accents, which speech does not have): found, "matches the recording at mm:ss", with
// the playable passage; not found, it stays "quote not checked". The transcript is never summarised or corrected by the
// model.

export const AUDIO_MAX_BYTES = 25 * 1024 * 1024;
const WHISPER_MODEL = '@cf/openai/whisper-large-v3-turbo';

const error = (code: string, pt: string, en: string, status: 400 | 404 | 409 | 422 | 502 = 400) => new DeskError(code, pt, status, en);
const sha256 = async (b: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map((x) => x.toString(16).padStart(2, '0')).join('');

/** The format from the start of the file (not from the name or the content-type, which the browser makes up). */
export function fromAudioFormat(b: Uint8Array): { mime: string; ext: string } | null {
  const txt = (i: number, n: number) => String.fromCharCode(...b.slice(i, i + n));
  if (b.length < 12) return null;
  if (txt(0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe6) === 0xe2)) return { mime: 'audio/mpeg', ext: 'mp3' };
  if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return { mime: 'audio/aac', ext: 'aac' };
  if (txt(4, 4) === 'ftyp') return { mime: 'audio/mp4', ext: 'm4a' };
  if (txt(0, 4) === 'RIFF' && txt(8, 4) === 'WAVE') return { mime: 'audio/wav', ext: 'wav' };
  if (txt(0, 4) === 'OggS') return { mime: 'audio/ogg', ext: 'ogg' };
  if (txt(0, 4) === 'fLaC') return { mime: 'audio/flac', ext: 'flac' };
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { mime: 'audio/webm', ext: 'webm' };
  return null;
}

/**
 * Receives the audio: checks format and size (`null`: the body went over the cap and reading stopped), stores it in R2
 * and queues it for transcription. The same file: the earlier one; if its transcription failed (Whisper down), it starts
 * over.
 */
export async function sendAudio(env: Env, tenantId: string, textId: string, actor: string, rawName: string, bytes: ArrayBuffer | null) {
  await readText(env, tenantId, textId);
  if (!bytes || bytes.byteLength > AUDIO_MAX_BYTES) throw error('grande', 'O áudio passa de 25 MB. Corte o trecho da entrevista que importa ou grave em qualidade menor.', 'The audio is over 25 MB. Cut the part of the interview that matters or record at a lower quality.', 422);
  const format = fromAudioFormat(new Uint8Array(bytes.slice(0, 16)));
  if (!format) throw error('nao_audio', 'Esse arquivo não é um áudio que o app lê (MP3, M4A, WAV, OGG, FLAC ou WebM).', "That file isn't audio the app reads (MP3, M4A, WAV, OGG, FLAC or WebM).", 422);
  const name = (rawName || `gravacao.${format.ext}`).replace(/[\\/\r\n\t]+/g, ' ').trim().slice(0, 200) || `gravacao.${format.ext}`;
  const hash = await sha256(bytes);
  const already = await env.DB.prepare('SELECT id FROM arquivos WHERE texto_id = ? AND tenant_id = ? AND sha256 = ?').bind(textId, tenantId, hash).first<{ id: string }>();
  if (already) {
    await enqueueFile(env, tenantId, already.id, 'gravacao', true);
    return { id: already.id, existia: true };
  }
  const id = newId();
  const r2 = `gravacoes/${tenantId}/${id}.${format.ext}`;
  await env.MEDIA.put(r2, bytes, { httpMetadata: { contentType: format.mime } });
  await env.DB.prepare("INSERT INTO arquivos (id, tenant_id, texto_id, tipo, nome, r2, bytes, sha256, mime, por) VALUES (?, ?, ?, 'audio', ?, ?, ?, ?, ?, ?)")
    .bind(id, tenantId, textId, name, r2, bytes.byteLength, hash, format.mime, actor).run();
  await enqueueFile(env, tenantId, id, 'gravacao');
  await recordEvent(env, tenantId, 'materia.gravacao', 'texto', textId, { arquivoId: id, nome: name, bytes: bytes.byteLength, por: actor });
  return { id, existia: false };
}

export interface OutputWhisper {
  text?: string;
  transcription_info?: { language?: string; duration?: number };
  segments?: { start: number; end: number; text: string; words?: { word: string; start: number; end: number }[] }[];
}

/** Workers AI Whisper; `WHISPER_URL` (tests only) swaps it for a fake server with the same response. */
export async function transcribe(env: Env, bytes: ArrayBuffer, language: Language): Promise<OutputWhisper> {
  const input = { audio: Buffer.from(bytes).toString('base64'), language: language === 'en' ? 'en' : 'pt', vad_filter: true };
  if (env.WHISPER_URL) {
    const r = await fetch(env.WHISPER_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json<OutputWhisper>();
  }
  return (await env.AI.run(WHISPER_MODEL as Parameters<Ai['run']>[0], input as never)) as OutputWhisper;
}

/**
 * Queue: transcribes and stores the passages with each word's timing. A failure keeps its reason, in view (sending the
 * same audio again tries once more). One consumer at a time (ownership of the file); an error outside transcription goes
 * back to the queue and, on the last attempt, the consumer records the failure.
 */
export async function processRecording(env: Env, tenantId: string, fileId: string) {
  const lease = await takeFile(env, tenantId, fileId, 'audio');
  if (!lease) return;
  try {
    await transcribeFile(env, tenantId, fileId, lease.r2, lease.posse);
  } catch (e) {
    await releaseFile(env, tenantId, fileId, lease.posse);
    throw e;
  }
}

async function transcribeFile(env: Env, tenantId: string, fileId: string, r2: string, owner: string) {
  const t = await env.DB.prepare('SELECT idioma FROM tenants WHERE id = ?').bind(tenantId).first<{ idioma: string | null }>();
  const a = { r2, idioma: t?.idioma ?? null };
  // Only the current owner, with the file still "lendo": a late delivery does not swap a "pronto" for "falhou".
  const failed = (reason: string) => env.DB.prepare("UPDATE arquivos SET estado = 'falhou', erro = ?, processando_em = NULL WHERE id = ? AND tenant_id = ? AND estado = 'lendo' AND processando_em = ?").bind(reason.slice(0, 300), fileId, tenantId, owner).run();
  const obj = await env.MEDIA.get(a.r2);
  if (!obj) { await failed('o arquivo sumiu do armazenamento'); return; }
  let output: OutputWhisper;
  try {
    output = await transcribe(env, await obj.arrayBuffer(), a.idioma === 'en' ? 'en' : 'pt-BR');
  } catch (e) {
    await failed(`a transcrição falhou (${String((e as Error).message ?? e).slice(0, 200)})`);
    return;
  }
  const segments = (output.segments ?? []).filter((s) => s.text?.trim());
  if (!segments.length) { await failed('a transcrição não achou fala no áudio'); return; }
  // The batch is a transaction, and each write checks ownership: whoever lost it does not delete the passages of whoever is reading now.
  const lease = [fileId, tenantId, owner];
  const stmts = [env.DB.prepare(`DELETE FROM gravacao_trechos WHERE arquivo_id = ? AND tenant_id = ? AND ${WITH_LEASE}`).bind(fileId, tenantId, ...lease)];
  segments.forEach((s, n) => {
    const words = (s.words ?? []).map((w) => ({ p: w.word, i: Math.round(w.start * 100) / 100, f: Math.round(w.end * 100) / 100 }));
    stmts.push(env.DB.prepare(`INSERT INTO gravacao_trechos (tenant_id, arquivo_id, n, inicio, fim, texto, palavras_json) SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${WITH_LEASE}`)
      .bind(tenantId, fileId, n, s.start, s.end, s.text.trim().normalize('NFC'), JSON.stringify(words), ...lease));
  });
  const duration = output.transcription_info?.duration ?? segments.at(-1)!.end;
  stmts.push(env.DB.prepare("UPDATE arquivos SET estado = 'pronto', erro = NULL, processando_em = NULL, duracao = ? WHERE id = ? AND tenant_id = ? AND estado = 'lendo' AND processando_em = ?").bind(duration, fileId, tenantId, owner));
  await env.DB.batch(stmts);
}

// ── checking the quotes ─────────────────────────────────────────────────────────────────────────────────────────

/** Words as speech has them: without punctuation, capitals or accents. */
export const wordsSpeech = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

export interface Transcript { id: string; nome: string; segmentada?: boolean; trechos: { inicio: number; fim: number; texto: string; palavras: { p: string; i: number; f: number }[] }[] }
interface Token { w: string; i: number; f: number }

/** The transcript's words with timings (the word's, or the passage's when the model did not give the word's). */
function tokens(t: Transcript): Token[] {
  const out: Token[] = [];
  for (const tr of t.trechos) {
    if (tr.palavras.length) {
      for (const w of tr.palavras) for (const p of wordsSpeech(w.p)) out.push({ w: p, i: w.i, f: w.f });
    } else {
      for (const p of wordsSpeech(tr.texto)) out.push({ w: p, i: tr.inicio, f: tr.fim });
    }
  }
  return out;
}

export interface InRecording { arquivoId: string; nome: string; inicio: number; fim: number; segmentada?: boolean }

/** Where the quotation is, word by word, in some recording (the first time it appears). Three words or more. */
export function findInRecording(citation: string, transcripts: Transcript[]): InRecording | null {
  const q = wordsSpeech(citation);
  if (q.length < 3) return null;
  for (const t of transcripts) {
    const ts = tokens(t);
    for (let i = 0; i + q.length <= ts.length; i++) {
      if (ts[i].w !== q[0]) continue;
      let k = 1;
      while (k < q.length && ts[i + k].w === q[k]) k++;
      if (k === q.length) return { arquivoId: t.id, nome: t.nome, inicio: ts[i].i, fim: ts[i + q.length - 1].f, ...(t.segmentada ? { segmentada: true } : {}) };
    }
  }
  return null;
}

/** 192.4 → "03:12"; 3725 → "1:02:05". */
export function mmss(seg: number) {
  const s = Math.max(0, Math.floor(seg));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${String(m).padStart(2, '0')}:${ss}`;
}

/** The text's ready recordings, with their passages (to check quotes) and how many are still being transcribed. */
export async function transcriptsText(env: Env, tenantId: string, textId: string): Promise<{ prontas: Transcript[]; lendo: number; total: number }> {
  const { results: files } = await env.DB.prepare("SELECT id, nome, estado, r2 FROM arquivos WHERE texto_id = ? AND tenant_id = ? AND tipo = 'audio' ORDER BY created_at, rowid")
    .bind(textId, tenantId).all<{ id: string; nome: string; estado: string; r2: string }>();
  const ready = files.filter((a) => a.estado === 'pronto');
  const out: Transcript[] = [];
  if (ready.length) {
    // Joins with arquivos (tenant, text, ready audio) instead of one parameter per recording: D1 accepts up to 100 per query.
    const { results } = await env.DB.prepare(
      `SELECT g.arquivo_id, g.inicio, g.fim, g.texto, g.palavras_json FROM gravacao_trechos g
         JOIN arquivos a ON a.id = g.arquivo_id AND a.tenant_id = g.tenant_id
        WHERE g.tenant_id = ? AND a.texto_id = ? AND a.tipo = 'audio' AND a.estado = 'pronto' ORDER BY g.arquivo_id, g.n`,
    ).bind(tenantId, textId).all<{ arquivo_id: string; inicio: number; fim: number; texto: string; palavras_json: string }>();
    for (const a of ready) {
      out.push({ id: a.id, nome: a.nome, ...(a.r2.endsWith('/') ? { segmentada: true } : {}), trechos: results.filter((r) => r.arquivo_id === a.id).map((r) => ({ inicio: r.inicio, fim: r.fim, texto: r.texto, palavras: JSON.parse(r.palavras_json) })) });
    }
  }
  return { prontas: out, lendo: files.filter((a) => a.estado === 'lendo').length, total: files.length };
}

/** The text's recordings for the screen (without the transcript, which comes from its own route when the person opens it). */
export async function recordingsText(env: Env, tenantId: string, textId: string) {
  const { results } = await env.DB.prepare("SELECT id, nome, bytes, estado, erro, duracao, created_at FROM arquivos WHERE texto_id = ? AND tenant_id = ? AND tipo = 'audio' ORDER BY created_at, rowid")
    .bind(textId, tenantId).all<{ id: string; nome: string; bytes: number; estado: string; erro: string | null; duracao: number | null; created_at: string }>();
  const segments = await segmentsText(env, tenantId, textId);
  return results.map((a) => ({ id: a.id, nome: a.nome, bytes: a.bytes, estado: a.estado as 'lendo' | 'pronto' | 'falhou', erro: a.erro, duracao: a.duracao, criadoEm: a.created_at, segmentos: segments.get(a.id) ?? null }));
}

/** A recording's whole transcript, passage by passage with timings. */
export async function transcript(env: Env, tenantId: string, textId: string, fileId: string) {
  await readText(env, tenantId, textId);
  const a = await env.DB.prepare("SELECT id FROM arquivos WHERE id = ? AND texto_id = ? AND tenant_id = ? AND tipo = 'audio'").bind(fileId, textId, tenantId).first<{ id: string }>();
  if (!a) throw error('nao_encontrado', 'não encontrado', 'not found', 404);
  const { results } = await env.DB.prepare('SELECT inicio, fim, texto FROM gravacao_trechos WHERE arquivo_id = ? AND tenant_id = ? ORDER BY n').bind(fileId, tenantId).all<{ inicio: number; fim: number; texto: string }>();
  return results;
}

/** The audio to play, with Range (the browser jumps to the quote's minute). */
export async function audioToPlay(env: Env, tenantId: string, textId: string, fileId: string, range: string | undefined, time = 0) {
  await readText(env, tenantId, textId);
  const a = await env.DB.prepare("SELECT r2, nome, mime, bytes FROM arquivos WHERE id = ? AND texto_id = ? AND tenant_id = ? AND tipo = 'audio'")
    .bind(fileId, textId, tenantId).first<{ r2: string; nome: string; mime: string | null; bytes: number }>();
  if (!a) return null;
  // Recording in segments: the passage that has the requested time. MediaRecorder WebM cannot seek to a minute in a long file.
  let home: number | null = null;
  if (a.r2.endsWith('/')) {
    const seg = await env.DB.prepare('SELECT r2, inicio, bytes FROM gravacao_segmentos WHERE arquivo_id = ? AND tenant_id = ? AND r2 IS NOT NULL AND n <= ? ORDER BY n DESC LIMIT 1')
      .bind(fileId, tenantId, segmentTime(time)).first<{ r2: string; inicio: number; bytes: number }>();
    if (!seg) return null;
    a.r2 = seg.r2;
    a.bytes = seg.bytes;
    home = seg.inicio;
  }
  const header: Record<string, string> = { ...(home === null ? {} : { 'x-inicio': String(home) }), 'content-type': a.mime ?? 'application/octet-stream', 'accept-ranges': 'bytes', 'cache-control': 'private, no-store', 'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(a.nome)}` };
  const m = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (m && (m[1] || m[2])) {
    const ini = m[1] ? Number(m[1]) : Math.max(0, a.bytes - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(Number(m[2]), a.bytes - 1) : a.bytes - 1;
    if (ini >= a.bytes || end < ini) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${a.bytes}` } });
    const obj = await env.MEDIA.get(a.r2, { range: { offset: ini, length: end - ini + 1 } });
    if (!obj) return null;
    return new Response(obj.body, { status: 206, headers: { ...header, 'content-range': `bytes ${ini}-${end}/${a.bytes}`, 'content-length': String(end - ini + 1) } });
  }
  const obj = await env.MEDIA.get(a.r2);
  if (!obj) return null;
  return new Response(obj.body, { headers: { ...header, 'content-length': String(a.bytes) } });
}
