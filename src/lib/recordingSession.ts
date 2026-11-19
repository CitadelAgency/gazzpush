// Recording in the app: the session receives slices while the person records, finishing creates the recording and the
// queue transcribes one segment at a time. Each segment is a file that decodes on its own; the time in
// `gravacao_trechos` is absolute, so the quote check does not change. A failed segment stays in view and does not hold
// the others.
import type { Env } from '../env';
import { newId, recordEvent } from './db';
import { BusyFile } from './document';
import { fromAudioFormat, transcribe } from './recording';
import { todayIso } from './lai';
import { DeskError, readText } from './desk';
import {
  SLICE_MAX_BYTES, SLICES_PER_SEGMENT, MAX_SEGMENTS, PER_SLICE_SECONDS, PER_SEGMENT_SECONDS, shiftPassages, gapsSegment, fromSegmentHome, fromSegmentWindow,
} from './segments';

const error = (code: string, pt: string, en: string, status: 400 | 404 | 409 | 422 = 400) => new DeskError(code, pt, status, en);
const sha256 = async (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b as BufferSource))].map((x) => x.toString(16).padStart(2, '0')).join('');
const FORMATS: Record<string, string> = { 'audio/webm': 'webm', 'audio/mp4': 'm4a' };
const keyPrefix = (tenantId: string, session: string) => `gravacoes/${tenantId}/${session}/`;
/** The number at the end of the path segment: `07` and `7x` are rejected. */
const whole = (s: string, max: number) => (/^(0|[1-9]\d*)$/.test(s) && Number(s) < max ? Number(s) : null);

export async function openSession(env: Env, tenantId: string, textId: string, actor: string, mimeRaw: unknown) {
  await readText(env, tenantId, textId);
  const mime = typeof mimeRaw === 'string' ? mimeRaw.split(';')[0].trim() : '';
  const ext = FORMATS[mime];
  if (!ext) throw error('nao_audio', 'mime: audio/webm ou audio/mp4', 'mime: audio/webm or audio/mp4', 422);
  const id = newId();
  await env.DB.prepare('INSERT INTO gravacao_sessoes (id, tenant_id, texto_id, por, mime, ext) VALUES (?, ?, ?, ?, ?, ?)').bind(id, tenantId, textId, actor, mime, ext).run();
  return { sessao: id, segundos: PER_SEGMENT_SECONDS, fatia: PER_SLICE_SECONDS };
}

const sessionText = (env: Env, tenantId: string, textId: string, session: string) =>
  env.DB.prepare('SELECT id, estado, mime, ext, por, created_at, arquivo_id FROM gravacao_sessoes WHERE id = ? AND tenant_id = ? AND texto_id = ?').bind(session, tenantId, textId)
    .first<{ id: string; estado: string; mime: string; ext: string; por: string; created_at: string; arquivo_id: string | null }>();

/** One slice, idempotent by number: sending it again replaces the same object. */
export async function receiveSlice(env: Env, tenantId: string, textId: string, session: string, segmentRaw: string, sliceRaw: string, bytes: Uint8Array | null) {
  const s = await sessionText(env, tenantId, textId, session);
  if (!s) throw error('nao_encontrado', 'não encontrado', 'not found', 404);
  if (s.estado !== 'gravando') throw error('encerrada', 'esta gravação já foi concluída', 'this recording is already finished', 409);
  const segment = whole(segmentRaw, MAX_SEGMENTS);
  if (segment === null) throw error('teto', 'a gravação chegou ao teto de 3 horas', 'the recording reached the 3-hour limit', 409);
  const slice = whole(sliceRaw, SLICES_PER_SEGMENT + 2);
  if (slice === null) throw error('fatia', 'número de fatia inválido', 'invalid chunk number');
  if (!bytes?.byteLength || bytes.byteLength > SLICE_MAX_BYTES) throw error('grande', 'fatia vazia ou grande demais', 'chunk is empty or too large', 422);
  // Only the first slice of each segment has a header in WebM.
  if (slice === 0 && s.ext === 'webm' && !fromAudioFormat(bytes.slice(0, 16))) throw error('nao_audio', 'isso não é áudio', "that isn't audio", 422);
  await env.MEDIA.put(`${keyPrefix(tenantId, session)}${segment}/${slice}`, bytes, { httpMetadata: { contentType: s.mime } });
  await env.DB.prepare("UPDATE gravacao_sessoes SET ultima_em = datetime('now') WHERE id = ? AND tenant_id = ?").bind(session, tenantId).run();
}

/** The slices that were uploaded, per segment. */
async function slicesSession(env: Env, prefix: string) {
  const map = new Map<number, Map<number, { chave: string; bytes: number }>>();
  let cursor: string | undefined;
  do {
    const r = await env.MEDIA.list({ prefix, cursor });
    for (const o of r.objects) {
      const m = o.key.slice(prefix.length).match(/^(\d+)\/(\d+)$/);
      if (!m) continue;
      const seg = Number(m[1]);
      if (!map.has(seg)) map.set(seg, new Map());
      map.get(seg)!.set(Number(m[2]), { chave: o.key, bytes: o.size });
    }
    cursor = r.truncated ? r.cursor : undefined;
  } while (cursor);
  return map;
}

/** The time in Brasília, for the recording's name. */
const hour = (iso: string) => new Date(`${iso.replace(' ', 'T')}Z`).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });

/**
 * Creates the recording with one segment per number received, and a segment with no slices already as a lost passage,
 * in view. Only whoever switches the state to `concluindo` carries on: closing the tab, coming back and the cron can
 * all ask at the same time.
 */
export async function finishSession(env: Env, tenantId: string, textId: string, session: string) {
  const s = await sessionText(env, tenantId, textId, session);
  if (!s) throw error('nao_encontrado', 'não encontrado', 'not found', 404);
  if (s.estado === 'concluida') return s.arquivo_id;
  const r = await env.DB.prepare("UPDATE gravacao_sessoes SET estado = 'concluindo' WHERE id = ? AND tenant_id = ? AND estado = 'gravando'").bind(session, tenantId).run();
  if (!r.meta.changes) return null;
  const prefix = keyPrefix(tenantId, session);
  const slices = await slicesSession(env, prefix);
  if (!slices.size) {
    await env.DB.prepare("UPDATE gravacao_sessoes SET estado = 'vazia' WHERE id = ? AND tenant_id = ?").bind(session, tenantId).run();
    return null;
  }
  const last = Math.max(...slices.keys());
  const id = newId();
  const bytes = [...slices.values()].reduce((sum, m) => sum + [...m.values()].reduce((x, f) => x + f.bytes, 0), 0);
  const name = `Gravação de ${todayIso(new Date(`${s.created_at.replace(' ', 'T')}Z`)).split('-').reverse().join('/')}, ${hour(s.created_at)}.${s.ext}`;
  const stmts = [
    env.DB.prepare("INSERT INTO arquivos (id, tenant_id, texto_id, tipo, nome, r2, bytes, sha256, mime, por, fila_em) VALUES (?, ?, ?, 'audio', ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%d %H:%M:%f', 'now'))")
      .bind(id, tenantId, textId, name, prefix, bytes, await sha256(new TextEncoder().encode(session)), s.mime, s.por),
    env.DB.prepare("UPDATE gravacao_sessoes SET estado = 'concluida', arquivo_id = ? WHERE id = ? AND tenant_id = ?").bind(id, session, tenantId),
  ];
  const queue: number[] = [];
  for (let n = 0; n <= last; n++) {
    const numbers = [...(slices.get(n)?.keys() ?? [])];
    const gaps = gapsSegment(n, numbers, n === last);
    const withoutHeader = !numbers.includes(0);
    if (!withoutHeader) queue.push(n);
    stmts.push(env.DB.prepare('INSERT INTO gravacao_segmentos (tenant_id, arquivo_id, n, inicio, estado, erro, faltas_json) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(tenantId, id, n, fromSegmentHome(n), withoutHeader ? 'falhou' : 'fila', withoutHeader ? 'o começo deste trecho não chegou ao servidor' : null, JSON.stringify(gaps)));
  }
  await env.DB.batch(stmts);
  await recordEvent(env, tenantId, 'materia.gravacao', 'texto', textId, { arquivoId: id, nome: name, bytes, segmentos: last + 1, por: s.por });
  await enqueueSegments(env, tenantId, id, queue);
  await closeIfFinished(env, tenantId, id);
  return id;
}

async function enqueueSegments(env: Env, tenantId: string, fileId: string, ns: number[]) {
  try {
    for (let i = 0; i < ns.length; i += 100) {
      await env.MONITOR_QUEUE.sendBatch(ns.slice(i, i + 100).map((n) => ({ body: { tipo: 'segmento' as const, tenantId, arquivoId: fileId, n } })));
    }
  } catch (e) {
    await env.DB.prepare("UPDATE gravacao_segmentos SET estado = 'falhou', erro = ? WHERE arquivo_id = ? AND tenant_id = ? AND estado = 'fila'")
      .bind(`não entrou na fila (${String((e as Error).message ?? e).slice(0, 160)})`, fileId, tenantId).run();
  }
}

/** A session idle for over 2 hours: someone who closed the tab and did not come back. 15-minute cron. */
export async function finishSessionsStopped(env: Env) {
  const { results } = await env.DB.prepare("SELECT id, tenant_id, texto_id FROM gravacao_sessoes WHERE estado = 'gravando' AND ultima_em < datetime('now', '-2 hours') LIMIT 50")
    .all<{ id: string; tenant_id: string; texto_id: string }>();
  for (const s of results) await finishSession(env, s.tenant_id, s.texto_id, s.id).catch((e) => console.error('concluirSessao', s.id, e));
  return results.length;
}

/** When nothing is queued or being read, the recording finishes: ready if any segment remained, with the rest in view. */
async function closeIfFinished(env: Env, tenantId: string, fileId: string) {
  await env.DB.prepare(
    `UPDATE arquivos SET
        estado = CASE WHEN EXISTS (SELECT 1 FROM gravacao_segmentos s WHERE s.arquivo_id = arquivos.id AND s.estado = 'pronto') THEN 'pronto' ELSE 'falhou' END,
        erro = CASE WHEN EXISTS (SELECT 1 FROM gravacao_segmentos s WHERE s.arquivo_id = arquivos.id AND s.estado = 'pronto') THEN NULL ELSE 'nenhum trecho foi transcrito' END,
        duracao = (SELECT MAX(fim) FROM gravacao_trechos g WHERE g.arquivo_id = arquivos.id AND g.tenant_id = arquivos.tenant_id),
        processando_em = NULL
      WHERE id = ? AND tenant_id = ? AND estado = 'lendo'
        AND NOT EXISTS (SELECT 1 FROM gravacao_segmentos s WHERE s.arquivo_id = arquivos.id AND s.estado IN ('fila', 'lendo'))`,
  ).bind(fileId, tenantId).run();
}

/** Joins the slices into a single file and deletes them. One already assembled (trying again) is only read. */
async function buildSegment(env: Env, tenantId: string, fileId: string, n: number, seg: { r2: string | null }, a: { r2: string; mime: string | null }) {
  if (seg.r2) return (await env.MEDIA.get(seg.r2))?.arrayBuffer() ?? null;
  const slices = [...((await slicesSession(env, a.r2)).get(n)?.entries() ?? [])].sort(([x], [y]) => x - y);
  if (!slices.length) return null;
  const chunks: Uint8Array[] = [];
  for (const [, f] of slices) {
    const o = await env.MEDIA.get(f.chave);
    if (o) chunks.push(new Uint8Array(await o.arrayBuffer()));
  }
  const together = new Uint8Array(chunks.reduce((s, p) => s + p.byteLength, 0));
  let i = 0;
  for (const p of chunks) { together.set(p, i); i += p.byteLength; }
  const ext = a.mime === 'audio/mp4' ? 'm4a' : 'webm';
  const key = `${a.r2}${n}.${ext}`;
  await env.MEDIA.put(key, together, { httpMetadata: { contentType: a.mime ?? 'audio/webm' } });
  await env.DB.prepare('UPDATE gravacao_segmentos SET r2 = ?, bytes = ?, sha256 = ? WHERE arquivo_id = ? AND tenant_id = ? AND n = ?')
    .bind(key, together.byteLength, await sha256(together), fileId, tenantId, n).run();
  await env.MEDIA.delete(slices.map(([, f]) => f.chave));
  return together.buffer as ArrayBuffer;
}

/** Queue: one segment. Ownership expires in 10 minutes; a duplicate delivery finds the segment in another state. */
export async function processSegment(env: Env, tenantId: string, fileId: string, n: number) {
  const seg = await env.DB.prepare(
    `UPDATE gravacao_segmentos SET estado = 'lendo', erro = NULL, processando_em = datetime('now')
      WHERE arquivo_id = ? AND tenant_id = ? AND n = ? AND (estado = 'fila' OR (estado = 'lendo' AND processando_em < datetime('now', '-10 minutes')))
      RETURNING r2, inicio`,
  ).bind(fileId, tenantId, n).first<{ r2: string | null; inicio: number }>();
  if (!seg) {
    const now = await env.DB.prepare('SELECT estado FROM gravacao_segmentos WHERE arquivo_id = ? AND tenant_id = ? AND n = ?').bind(fileId, tenantId, n).first<{ estado: string }>();
    if (now?.estado === 'lendo') throw new BusyFile();
    return;
  }
  const a = await env.DB.prepare('SELECT a.r2, a.mime, t.idioma FROM arquivos a JOIN tenants t ON t.id = a.tenant_id WHERE a.id = ? AND a.tenant_id = ?').bind(fileId, tenantId)
    .first<{ r2: string; mime: string | null; idioma: string | null }>();
  const fail = async (reason: string) => {
    await env.DB.prepare("UPDATE gravacao_segmentos SET estado = 'falhou', erro = ?, processando_em = NULL WHERE arquivo_id = ? AND tenant_id = ? AND n = ?").bind(reason.slice(0, 300), fileId, tenantId, n).run();
    await closeIfFinished(env, tenantId, fileId);
  };
  if (!a) return;
  try {
    const bytes = await buildSegment(env, tenantId, fileId, n, seg, a);
    if (!bytes) { await fail('o áudio deste trecho sumiu do armazenamento'); return; }
    const output = await transcribe(env, bytes, a.idioma === 'en' ? 'en' : 'pt-BR');
    const total = await env.DB.prepare('SELECT MAX(n) AS ultimo FROM gravacao_segmentos WHERE arquivo_id = ? AND tenant_id = ?').bind(fileId, tenantId).first<{ ultimo: number }>();
    const passages = shiftPassages((output.segments ?? []).filter((s) => s.text?.trim()), seg.inicio, fromSegmentWindow(n, total?.ultimo ?? n));
    // Passage numbering follows time, and the check reads by it.
    const base = n * 100_000;
    await env.DB.batch([
      env.DB.prepare('DELETE FROM gravacao_trechos WHERE arquivo_id = ? AND tenant_id = ? AND n >= ? AND n < ?').bind(fileId, tenantId, base, base + 100_000),
      ...passages.map((t, i) => env.DB.prepare('INSERT INTO gravacao_trechos (tenant_id, arquivo_id, n, inicio, fim, texto, palavras_json) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(tenantId, fileId, base + i, t.inicio, t.fim, t.texto, JSON.stringify(t.palavras))),
      env.DB.prepare("UPDATE gravacao_segmentos SET estado = 'pronto', erro = NULL, processando_em = NULL WHERE arquivo_id = ? AND tenant_id = ? AND n = ?").bind(fileId, tenantId, n),
      // A long recording in the queue is not a stalled file.
      env.DB.prepare("UPDATE arquivos SET fila_em = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = ? AND tenant_id = ? AND estado = 'lendo'").bind(fileId, tenantId),
    ]);
  } catch (e) {
    await fail(`a transcrição falhou (${String((e as Error).message ?? e).slice(0, 200)})`);
    return;
  }
  await closeIfFinished(env, tenantId, fileId);
}

/** The queue's last delivery: the failure stays on the segment. */
export async function closeSegment(env: Env, tenantId: string, fileId: string, n: number, reason: string) {
  await env.DB.prepare("UPDATE gravacao_segmentos SET estado = 'falhou', erro = ?, processando_em = NULL WHERE arquivo_id = ? AND tenant_id = ? AND n = ? AND estado IN ('fila', 'lendo')")
    .bind(reason.slice(0, 300), fileId, tenantId, n).run();
  await closeIfFinished(env, tenantId, fileId);
}

/** "Try again": only a segment that failed and has audio. */
export async function trySegment(env: Env, tenantId: string, textId: string, fileId: string, nRaw: string) {
  const n = whole(nRaw, MAX_SEGMENTS);
  const a = await env.DB.prepare("SELECT id, r2 FROM arquivos WHERE id = ? AND texto_id = ? AND tenant_id = ? AND tipo = 'audio'").bind(fileId, textId, tenantId).first<{ id: string; r2: string }>();
  if (!a || n === null) throw error('nao_encontrado', 'não encontrado', 'not found', 404);
  const seg = await env.DB.prepare('SELECT estado, r2 FROM gravacao_segmentos WHERE arquivo_id = ? AND tenant_id = ? AND n = ?').bind(fileId, tenantId, n).first<{ estado: string; r2: string | null }>();
  if (!seg) throw error('nao_encontrado', 'não encontrado', 'not found', 404);
  if (seg.estado !== 'falhou') throw error('estado', 'este trecho não falhou', "this part didn't fail", 409);
  if (!seg.r2 && !(await slicesSession(env, a.r2)).get(n)?.has(0)) throw error('sem_audio', 'o áudio deste trecho não chegou ao servidor', "this part's audio never reached the server", 409);
  await env.DB.batch([
    env.DB.prepare("UPDATE gravacao_segmentos SET estado = 'fila', erro = NULL WHERE arquivo_id = ? AND tenant_id = ? AND n = ?").bind(fileId, tenantId, n),
    env.DB.prepare("UPDATE arquivos SET estado = 'lendo', erro = NULL, processando_em = NULL, fila_em = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = ? AND tenant_id = ?").bind(fileId, tenantId),
  ]);
  await enqueueSegments(env, tenantId, fileId, [n]);
  await closeIfFinished(env, tenantId, fileId);
}

/** Recordings nobody finished: the screen offers to finish them. */
export async function sessionsOpen(env: Env, tenantId: string, textId: string) {
  const { results } = await env.DB.prepare("SELECT id, created_at FROM gravacao_sessoes WHERE tenant_id = ? AND texto_id = ? AND estado = 'gravando' ORDER BY created_at")
    .bind(tenantId, textId).all<{ id: string; created_at: string }>();
  return results.map((s) => ({ id: s.id, criadoEm: s.created_at }));
}

export type SummarySegments = { total: number; prontos: number; falhos: { n: number; inicio: number; erro: string | null }[]; faltas: { de: number; ate: number }[]; inicios: number[] };

/** The progress of each of the text's segmented recordings, per file. */
export async function segmentsText(env: Env, tenantId: string, textId: string): Promise<Map<string, SummarySegments>> {
  const { results } = await env.DB.prepare(
    `SELECT s.arquivo_id, s.n, s.inicio, s.estado, s.erro, s.faltas_json, s.r2 FROM gravacao_segmentos s JOIN arquivos a ON a.id = s.arquivo_id AND a.tenant_id = s.tenant_id
      WHERE s.tenant_id = ? AND a.texto_id = ? ORDER BY s.arquivo_id, s.n`,
  ).bind(tenantId, textId).all<{ arquivo_id: string; n: number; inicio: number; estado: string; erro: string | null; faltas_json: string; r2: string | null }>();
  const map = new Map<string, SummarySegments>();
  for (const s of results) {
    const m = map.get(s.arquivo_id) ?? { total: 0, prontos: 0, falhos: [], faltas: [], inicios: [] };
    m.total++;
    if (s.estado === 'pronto') m.prontos++;
    if (s.estado === 'falhou') m.falhos.push({ n: s.n, inicio: s.inicio, erro: s.erro });
    if (s.r2) m.inicios.push(s.inicio);
    m.faltas.push(...(JSON.parse(s.faltas_json) as { de: number; ate: number }[]));
    map.set(s.arquivo_id, m);
  }
  return map;
}
