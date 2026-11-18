import { Buffer } from 'node:buffer';
import type { Env } from '../env';
import { novoId, registrarEvento } from './db';
import { segmentosDoTexto } from './gravacaoSessao';
import { ErroMesa, lerTexto } from './mesa';
import { COM_POSSE, enfileirarArquivo, pegarArquivo, soltarArquivo } from './documento';
import type { Idioma } from './apuracao';
import { segmentoDoTempo } from './segmentos';

// Aspas contra a gravação (Fase 6 da Matéria): o áudio da entrevista vai para o R2, a fila transcreve com o Whisper do
// Workers AI (palavras com o tempo) e cada citação entre aspas do texto é procurada na transcrição por código, palavra
// por palavra (sem pontuação, maiúsculas nem acentos, que a fala não tem): achou, "bate com a gravação aos mm:ss", com
// o trecho tocável; não achou, segue "aspa não conferida". A transcrição nunca é resumida nem corrigida pelo modelo.

export const AUDIO_MAX_BYTES = 25 * 1024 * 1024;
const MODELO_WHISPER = '@cf/openai/whisper-large-v3-turbo';

const erro = (codigo: string, pt: string, en: string, status: 400 | 404 | 409 | 422 | 502 = 400) => new ErroMesa(codigo, pt, status, en);
const sha256 = async (b: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map((x) => x.toString(16).padStart(2, '0')).join('');

/** O formato pelo começo do arquivo (não pelo nome nem pelo content-type, que o navegador inventa). */
export function formatoDoAudio(b: Uint8Array): { mime: string; ext: string } | null {
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
 * Recebe o áudio: confere formato e tamanho (`null`: o corpo passou do teto e a leitura parou), guarda no R2 e põe na
 * fila para transcrever. O mesmo arquivo: o de antes; se a transcrição dele falhou (o Whisper fora do ar), ela recomeça.
 */
export async function enviarAudio(env: Env, tenantId: string, textoId: string, por: string, nomeBruto: string, bytes: ArrayBuffer | null) {
  await lerTexto(env, tenantId, textoId);
  if (!bytes || bytes.byteLength > AUDIO_MAX_BYTES) throw erro('grande', 'O áudio passa de 25 MB. Corte o trecho da entrevista que importa ou grave em qualidade menor.', 'The audio is over 25 MB. Cut the part of the interview that matters or record at a lower quality.', 422);
  const formato = formatoDoAudio(new Uint8Array(bytes.slice(0, 16)));
  if (!formato) throw erro('nao_audio', 'Esse arquivo não é um áudio que o app lê (MP3, M4A, WAV, OGG, FLAC ou WebM).', "That file isn't audio the app reads (MP3, M4A, WAV, OGG, FLAC or WebM).", 422);
  const nome = (nomeBruto || `gravacao.${formato.ext}`).replace(/[\\/\r\n\t]+/g, ' ').trim().slice(0, 200) || `gravacao.${formato.ext}`;
  const hash = await sha256(bytes);
  const ja = await env.DB.prepare('SELECT id FROM arquivos WHERE texto_id = ? AND tenant_id = ? AND sha256 = ?').bind(textoId, tenantId, hash).first<{ id: string }>();
  if (ja) {
    await enfileirarArquivo(env, tenantId, ja.id, 'gravacao', true);
    return { id: ja.id, existia: true };
  }
  const id = novoId();
  const r2 = `gravacoes/${tenantId}/${id}.${formato.ext}`;
  await env.MEDIA.put(r2, bytes, { httpMetadata: { contentType: formato.mime } });
  await env.DB.prepare("INSERT INTO arquivos (id, tenant_id, texto_id, tipo, nome, r2, bytes, sha256, mime, por) VALUES (?, ?, ?, 'audio', ?, ?, ?, ?, ?, ?)")
    .bind(id, tenantId, textoId, nome, r2, bytes.byteLength, hash, formato.mime, por).run();
  await enfileirarArquivo(env, tenantId, id, 'gravacao');
  await registrarEvento(env, tenantId, 'materia.gravacao', 'texto', textoId, { arquivoId: id, nome, bytes: bytes.byteLength, por });
  return { id, existia: false };
}

export interface SaidaWhisper {
  text?: string;
  transcription_info?: { language?: string; duration?: number };
  segments?: { start: number; end: number; text: string; words?: { word: string; start: number; end: number }[] }[];
}

/** O Whisper do Workers AI; `WHISPER_URL` (só teste) troca por um servidor falso com a mesma resposta. */
export async function transcrever(env: Env, bytes: ArrayBuffer, idioma: Idioma): Promise<SaidaWhisper> {
  const entrada = { audio: Buffer.from(bytes).toString('base64'), language: idioma === 'en' ? 'en' : 'pt', vad_filter: true };
  if (env.WHISPER_URL) {
    const r = await fetch(env.WHISPER_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(entrada) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json<SaidaWhisper>();
  }
  return (await env.AI.run(MODELO_WHISPER as Parameters<Ai['run']>[0], entrada as never)) as SaidaWhisper;
}

/**
 * Fila: transcreve e grava os trechos com o tempo de cada palavra. Falha fica com o motivo, à vista (mandar o mesmo
 * áudio de novo tenta outra vez). Um consumidor por vez (a posse do arquivo); erro fora da transcrição volta para a fila
 * e, na última tentativa, o consumidor grava a falha.
 */
export async function processarGravacao(env: Env, tenantId: string, arquivoId: string) {
  const posse = await pegarArquivo(env, tenantId, arquivoId, 'audio');
  if (!posse) return;
  try {
    await transcreverArquivo(env, tenantId, arquivoId, posse.r2, posse.posse);
  } catch (e) {
    await soltarArquivo(env, tenantId, arquivoId, posse.posse);
    throw e;
  }
}

async function transcreverArquivo(env: Env, tenantId: string, arquivoId: string, r2: string, dono: string) {
  const t = await env.DB.prepare('SELECT idioma FROM tenants WHERE id = ?').bind(tenantId).first<{ idioma: string | null }>();
  const a = { r2, idioma: t?.idioma ?? null };
  // Só quem ainda tem a posse, com o arquivo ainda "lendo": a entrega atrasada não troca um "pronto" por "falhou".
  const falhou = (motivo: string) => env.DB.prepare("UPDATE arquivos SET estado = 'falhou', erro = ?, processando_em = NULL WHERE id = ? AND tenant_id = ? AND estado = 'lendo' AND processando_em = ?").bind(motivo.slice(0, 300), arquivoId, tenantId, dono).run();
  const obj = await env.MEDIA.get(a.r2);
  if (!obj) { await falhou('o arquivo sumiu do armazenamento'); return; }
  let saida: SaidaWhisper;
  try {
    saida = await transcrever(env, await obj.arrayBuffer(), a.idioma === 'en' ? 'en' : 'pt-BR');
  } catch (e) {
    await falhou(`a transcrição falhou (${String((e as Error).message ?? e).slice(0, 200)})`);
    return;
  }
  const segmentos = (saida.segments ?? []).filter((s) => s.text?.trim());
  if (!segmentos.length) { await falhou('a transcrição não achou fala no áudio'); return; }
  // O lote é uma transação, e cada escrita confere a posse: quem a perdeu não apaga os trechos de quem está lendo agora.
  const posse = [arquivoId, tenantId, dono];
  const stmts = [env.DB.prepare(`DELETE FROM gravacao_trechos WHERE arquivo_id = ? AND tenant_id = ? AND ${COM_POSSE}`).bind(arquivoId, tenantId, ...posse)];
  segmentos.forEach((s, n) => {
    const palavras = (s.words ?? []).map((w) => ({ p: w.word, i: Math.round(w.start * 100) / 100, f: Math.round(w.end * 100) / 100 }));
    stmts.push(env.DB.prepare(`INSERT INTO gravacao_trechos (tenant_id, arquivo_id, n, inicio, fim, texto, palavras_json) SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${COM_POSSE}`)
      .bind(tenantId, arquivoId, n, s.start, s.end, s.text.trim().normalize('NFC'), JSON.stringify(palavras), ...posse));
  });
  const duracao = saida.transcription_info?.duration ?? segmentos.at(-1)!.end;
  stmts.push(env.DB.prepare("UPDATE arquivos SET estado = 'pronto', erro = NULL, processando_em = NULL, duracao = ? WHERE id = ? AND tenant_id = ? AND estado = 'lendo' AND processando_em = ?").bind(duracao, arquivoId, tenantId, dono));
  await env.DB.batch(stmts);
}

// ── conferência das aspas ───────────────────────────────────────────────────────────────────────────────────────

/** Palavras como a fala tem: sem pontuação, maiúsculas nem acentos. */
export const palavrasDaFala = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

export interface Transcricao { id: string; nome: string; segmentada?: boolean; trechos: { inicio: number; fim: number; texto: string; palavras: { p: string; i: number; f: number }[] }[] }
interface Token { w: string; i: number; f: number }

/** As palavras da transcrição com o tempo (da palavra, ou do trecho quando o modelo não deu o tempo da palavra). */
function tokens(t: Transcricao): Token[] {
  const out: Token[] = [];
  for (const tr of t.trechos) {
    if (tr.palavras.length) {
      for (const w of tr.palavras) for (const p of palavrasDaFala(w.p)) out.push({ w: p, i: w.i, f: w.f });
    } else {
      for (const p of palavrasDaFala(tr.texto)) out.push({ w: p, i: tr.inicio, f: tr.fim });
    }
  }
  return out;
}

export interface NaGravacao { arquivoId: string; nome: string; inicio: number; fim: number; segmentada?: boolean }

/** Onde a citação está, palavra por palavra, em alguma gravação (a primeira vez que aparece). Três palavras ou mais. */
export function acharNaGravacao(citacao: string, transcricoes: Transcricao[]): NaGravacao | null {
  const q = palavrasDaFala(citacao);
  if (q.length < 3) return null;
  for (const t of transcricoes) {
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

/** As gravações prontas do texto, com os trechos (para conferir as aspas) e quantas ainda estão sendo transcritas. */
export async function transcricoesDoTexto(env: Env, tenantId: string, textoId: string): Promise<{ prontas: Transcricao[]; lendo: number; total: number }> {
  const { results: arqs } = await env.DB.prepare("SELECT id, nome, estado, r2 FROM arquivos WHERE texto_id = ? AND tenant_id = ? AND tipo = 'audio' ORDER BY created_at, rowid")
    .bind(textoId, tenantId).all<{ id: string; nome: string; estado: string; r2: string }>();
  const prontas = arqs.filter((a) => a.estado === 'pronto');
  const out: Transcricao[] = [];
  if (prontas.length) {
    // Junta com arquivos (tenant, texto, áudio pronto) em vez de um parâmetro por gravação: o D1 aceita até 100 por consulta.
    const { results } = await env.DB.prepare(
      `SELECT g.arquivo_id, g.inicio, g.fim, g.texto, g.palavras_json FROM gravacao_trechos g
         JOIN arquivos a ON a.id = g.arquivo_id AND a.tenant_id = g.tenant_id
        WHERE g.tenant_id = ? AND a.texto_id = ? AND a.tipo = 'audio' AND a.estado = 'pronto' ORDER BY g.arquivo_id, g.n`,
    ).bind(tenantId, textoId).all<{ arquivo_id: string; inicio: number; fim: number; texto: string; palavras_json: string }>();
    for (const a of prontas) {
      out.push({ id: a.id, nome: a.nome, ...(a.r2.endsWith('/') ? { segmentada: true } : {}), trechos: results.filter((r) => r.arquivo_id === a.id).map((r) => ({ inicio: r.inicio, fim: r.fim, texto: r.texto, palavras: JSON.parse(r.palavras_json) })) });
    }
  }
  return { prontas: out, lendo: arqs.filter((a) => a.estado === 'lendo').length, total: arqs.length };
}

/** As gravações do texto para a tela (sem a transcrição, que vem por rota própria quando a pessoa abre). */
export async function gravacoesDoTexto(env: Env, tenantId: string, textoId: string) {
  const { results } = await env.DB.prepare("SELECT id, nome, bytes, estado, erro, duracao, created_at FROM arquivos WHERE texto_id = ? AND tenant_id = ? AND tipo = 'audio' ORDER BY created_at, rowid")
    .bind(textoId, tenantId).all<{ id: string; nome: string; bytes: number; estado: string; erro: string | null; duracao: number | null; created_at: string }>();
  const segmentos = await segmentosDoTexto(env, tenantId, textoId);
  return results.map((a) => ({ id: a.id, nome: a.nome, bytes: a.bytes, estado: a.estado as 'lendo' | 'pronto' | 'falhou', erro: a.erro, duracao: a.duracao, criadoEm: a.created_at, segmentos: segmentos.get(a.id) ?? null }));
}

/** A transcrição inteira de uma gravação, trecho a trecho com o tempo. */
export async function transcricao(env: Env, tenantId: string, textoId: string, arquivoId: string) {
  await lerTexto(env, tenantId, textoId);
  const a = await env.DB.prepare("SELECT id FROM arquivos WHERE id = ? AND texto_id = ? AND tenant_id = ? AND tipo = 'audio'").bind(arquivoId, textoId, tenantId).first<{ id: string }>();
  if (!a) throw erro('nao_encontrado', 'não encontrado', 'not found', 404);
  const { results } = await env.DB.prepare('SELECT inicio, fim, texto FROM gravacao_trechos WHERE arquivo_id = ? AND tenant_id = ? ORDER BY n').bind(arquivoId, tenantId).all<{ inicio: number; fim: number; texto: string }>();
  return results;
}

/** O áudio para tocar, com Range (o navegador pula para o minuto da citação). */
export async function audioParaTocar(env: Env, tenantId: string, textoId: string, arquivoId: string, range: string | undefined, tempo = 0) {
  await lerTexto(env, tenantId, textoId);
  const a = await env.DB.prepare("SELECT r2, nome, mime, bytes FROM arquivos WHERE id = ? AND texto_id = ? AND tenant_id = ? AND tipo = 'audio'")
    .bind(arquivoId, textoId, tenantId).first<{ r2: string; nome: string; mime: string | null; bytes: number }>();
  if (!a) return null;
  // Gravação em segmentos: o trecho que tem o tempo pedido. WebM de MediaRecorder não pula para o minuto num arquivo longo.
  let inicio: number | null = null;
  if (a.r2.endsWith('/')) {
    const seg = await env.DB.prepare('SELECT r2, inicio, bytes FROM gravacao_segmentos WHERE arquivo_id = ? AND tenant_id = ? AND r2 IS NOT NULL AND n <= ? ORDER BY n DESC LIMIT 1')
      .bind(arquivoId, tenantId, segmentoDoTempo(tempo)).first<{ r2: string; inicio: number; bytes: number }>();
    if (!seg) return null;
    a.r2 = seg.r2;
    a.bytes = seg.bytes;
    inicio = seg.inicio;
  }
  const cab: Record<string, string> = { ...(inicio === null ? {} : { 'x-inicio': String(inicio) }), 'content-type': a.mime ?? 'application/octet-stream', 'accept-ranges': 'bytes', 'cache-control': 'private, no-store', 'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(a.nome)}` };
  const m = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (m && (m[1] || m[2])) {
    const ini = m[1] ? Number(m[1]) : Math.max(0, a.bytes - Number(m[2]));
    const fim = m[1] && m[2] ? Math.min(Number(m[2]), a.bytes - 1) : a.bytes - 1;
    if (ini >= a.bytes || fim < ini) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${a.bytes}` } });
    const obj = await env.MEDIA.get(a.r2, { range: { offset: ini, length: fim - ini + 1 } });
    if (!obj) return null;
    return new Response(obj.body, { status: 206, headers: { ...cab, 'content-range': `bytes ${ini}-${fim}/${a.bytes}`, 'content-length': String(fim - ini + 1) } });
  }
  const obj = await env.MEDIA.get(a.r2);
  if (!obj) return null;
  return new Response(obj.body, { headers: { ...cab, 'content-length': String(a.bytes) } });
}
