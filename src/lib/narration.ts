// The owner's voice on the Reels: the script is the cards' titles and sentences, without the CTA. The speech is
// transcribed and compared with it by code; each warning asks for a person's decision, and the transcript never goes
// into the video: the subtitle is the approved text.
import type { Env } from '../env';
import type { Card } from './cards';
import { newId } from './db';
import { compareNarration, scriptReels, type SpeechWarning } from './speech';
import { fromAudioFormat, transcribe } from './recording';
import type { Word } from './segments';

export { scriptReels as roteiroDoReels };
export const MAX_NARRATION_S = 90;
export const NARRATION_MAX_BYTES = 10 * 1024 * 1024;

export async function receiveNarration(env: Env, tenantId: string, pieceId: string, version: number, actor: string, bytes: Uint8Array) {
  const format = fromAudioFormat(bytes.slice(0, 16));
  if (!format) return null;
  const id = newId();
  const r2 = `narracoes/${tenantId}/${pieceId}/${id}.${format.ext}`;
  await env.MEDIA.put(r2, bytes, { httpMetadata: { contentType: format.mime } });
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))].map((x) => x.toString(16).padStart(2, '0')).join('');
  await env.DB.prepare('INSERT INTO narracoes (id, tenant_id, peca_id, versao, r2, bytes, sha256, mime, por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, tenantId, pieceId, version, r2, bytes.byteLength, hash, format.mime, actor).run();
  await env.MONITOR_QUEUE.send({ tipo: 'narracao', tenantId, narracaoId: id });
  return id;
}

const fail = (env: Env, tenantId: string, id: string, reason: string) =>
  env.DB.prepare("UPDATE narracoes SET estado = 'falhou', erro = ? WHERE id = ? AND tenant_id = ? AND estado = 'lendo'").bind(reason.slice(0, 300), id, tenantId).run();
export const closeNarration = fail;

/** Queue: transcribes and compares. What reaches the screen are the warnings, with the time to listen at. */
export async function processNarration(env: Env, tenantId: string, id: string) {
  const n = await env.DB.prepare(
    `SELECT n.r2, n.estado, p.conteudo_json, v.conteudo_json AS da_versao, t.idioma FROM narracoes n
       JOIN pecas p ON p.id = n.peca_id AND p.tenant_id = n.tenant_id
       JOIN tenants t ON t.id = n.tenant_id
       LEFT JOIN peca_versoes v ON v.peca_id = n.peca_id AND v.tenant_id = n.tenant_id AND v.versao = n.versao
      WHERE n.id = ? AND n.tenant_id = ?`,
  ).bind(id, tenantId).first<{ r2: string; estado: string; conteudo_json: string; da_versao: string | null; idioma: string | null }>();
  if (!n || n.estado !== 'lendo') return;
  const obj = await env.MEDIA.get(n.r2);
  if (!obj) { await fail(env, tenantId, id, 'o áudio sumiu do armazenamento'); return; }
  let output;
  try {
    output = await transcribe(env, await obj.arrayBuffer(), n.idioma === 'en' ? 'en' : 'pt-BR');
  } catch (e) {
    await fail(env, tenantId, id, `a transcrição falhou (${String((e as Error).message ?? e).slice(0, 200)})`);
    return;
  }
  const words: Word[] = (output.segments ?? []).flatMap((s) => (s.words ?? []).map((w) => ({ p: w.word, i: Math.round(w.start * 100) / 100, f: Math.round(w.end * 100) / 100 })));
  const duration = output.transcription_info?.duration ?? words.at(-1)?.f ?? 0;
  if (!words.length) { await fail(env, tenantId, id, 'a transcrição não achou fala no áudio'); return; }
  if (duration > MAX_NARRATION_S) { await fail(env, tenantId, id, `a fala tem ${Math.round(duration)} s; o teto é ${MAX_NARRATION_S} s`); return; }
  const content = JSON.parse(n.da_versao ?? n.conteudo_json) as { cards?: Card[] };
  const warnings = compareNarration(scriptReels(content.cards), words);
  await env.DB.prepare("UPDATE narracoes SET estado = 'pronto', erro = NULL, duracao = ?, palavras_json = ?, avisos_json = ? WHERE id = ? AND tenant_id = ? AND estado = 'lendo'")
    .bind(duration, JSON.stringify(words), JSON.stringify(warnings), id, tenantId).run();
}

export interface Narration { id: string; versao: number; r2: string; mime: string; sha256: string; duracao: number | null; estado: string; erro: string | null; avisos: SpeechWarning[]; palavras: Word[] }
interface Line { id: string; versao: number; r2: string; mime: string; sha256: string; duracao: number | null; estado: string; erro: string | null; avisos_json: string; palavras_json: string }
const toNarration = (l: Line): Narration => ({ id: l.id, versao: l.versao, r2: l.r2, mime: l.mime, sha256: l.sha256, duracao: l.duracao, estado: l.estado, erro: l.erro, avisos: JSON.parse(l.avisos_json), palavras: JSON.parse(l.palavras_json) });
const FIELDS = 'id, versao, r2, mime, sha256, duracao, estado, erro, avisos_json, palavras_json';

export async function narrationPerId(env: Env, tenantId: string, pieceId: string, id: string) {
  const l = await env.DB.prepare(`SELECT ${FIELDS} FROM narracoes WHERE id = ? AND tenant_id = ? AND peca_id = ?`).bind(id, tenantId, pieceId).first<Line>();
  return l ? toNarration(l) : null;
}

/** The latest take for the version on screen. */
export async function narrationVersion(env: Env, tenantId: string, pieceId: string, version: number) {
  const l = await env.DB.prepare(`SELECT ${FIELDS} FROM narracoes WHERE tenant_id = ? AND peca_id = ? AND versao = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`).bind(tenantId, pieceId, version).first<Line>();
  return l ? toNarration(l) : null;
}

/** The person listened and the take is right. "Record again" means sending another take. */
export async function decideWarning(env: Env, tenantId: string, pieceId: string, id: string, index: number) {
  const n = await narrationPerId(env, tenantId, pieceId, id);
  if (!n?.avisos[index]) return null;
  const warnings = n.avisos.map((a, i) => (i === index ? { ...a, decisao: 'fala_certa' as const } : a));
  await env.DB.prepare('UPDATE narracoes SET avisos_json = ? WHERE id = ? AND tenant_id = ?').bind(JSON.stringify(warnings), id, tenantId).run();
  return warnings;
}

/** What the screen sees: without the transcript's words. */
export const narrationToScreen = (n: Narration) => ({ id: n.id, estado: n.estado, erro: n.erro, duracao: n.duracao, avisos: n.avisos });
