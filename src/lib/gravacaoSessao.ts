// Gravar no app: a sessão recebe as fatias enquanto a pessoa grava, o concluir cria a gravação e a fila transcreve um
// segmento por vez. Cada segmento é um arquivo decodificável sozinho; o tempo em `gravacao_trechos` é absoluto, e assim a
// conferência das aspas não muda. Segmento que falha fica à vista e não prende os outros.
import type { Env } from '../env';
import { novoId, registrarEvento } from './db';
import { ArquivoOcupado } from './documento';
import { formatoDoAudio, transcrever } from './gravacao';
import { hojeISO } from './lai';
import { ErroMesa, lerTexto } from './mesa';
import {
  FATIA_MAX_BYTES, FATIAS_POR_SEGMENTO, MAX_SEGMENTOS, SEGUNDOS_POR_FATIA, SEGUNDOS_POR_SEGMENTO, deslocarTrechos, faltasDoSegmento, inicioDoSegmento, janelaDoSegmento,
} from './segmentos';

const erro = (codigo: string, pt: string, en: string, status: 400 | 404 | 409 | 422 = 400) => new ErroMesa(codigo, pt, status, en);
const sha256 = async (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b as BufferSource))].map((x) => x.toString(16).padStart(2, '0')).join('');
const FORMATOS: Record<string, string> = { 'audio/webm': 'webm', 'audio/mp4': 'm4a' };
const prefixo = (tenantId: string, sessao: string) => `gravacoes/${tenantId}/${sessao}/`;
/** O número no fim do trecho do caminho: `07` e `7x` não entram. */
const inteiro = (s: string, max: number) => (/^(0|[1-9]\d*)$/.test(s) && Number(s) < max ? Number(s) : null);

export async function abrirSessao(env: Env, tenantId: string, textoId: string, por: string, mimeBruto: unknown) {
  await lerTexto(env, tenantId, textoId);
  const mime = typeof mimeBruto === 'string' ? mimeBruto.split(';')[0].trim() : '';
  const ext = FORMATOS[mime];
  if (!ext) throw erro('nao_audio', 'mime: audio/webm ou audio/mp4', 'mime: audio/webm or audio/mp4', 422);
  const id = novoId();
  await env.DB.prepare('INSERT INTO gravacao_sessoes (id, tenant_id, texto_id, por, mime, ext) VALUES (?, ?, ?, ?, ?, ?)').bind(id, tenantId, textoId, por, mime, ext).run();
  return { sessao: id, segundos: SEGUNDOS_POR_SEGMENTO, fatia: SEGUNDOS_POR_FATIA };
}

const sessaoDoTexto = (env: Env, tenantId: string, textoId: string, sessao: string) =>
  env.DB.prepare('SELECT id, estado, mime, ext, por, created_at, arquivo_id FROM gravacao_sessoes WHERE id = ? AND tenant_id = ? AND texto_id = ?').bind(sessao, tenantId, textoId)
    .first<{ id: string; estado: string; mime: string; ext: string; por: string; created_at: string; arquivo_id: string | null }>();

/** Uma fatia, idempotente pelo número: mandar de novo troca o mesmo objeto. */
export async function receberFatia(env: Env, tenantId: string, textoId: string, sessao: string, segmentoBruto: string, fatiaBruta: string, bytes: Uint8Array | null) {
  const s = await sessaoDoTexto(env, tenantId, textoId, sessao);
  if (!s) throw erro('nao_encontrado', 'não encontrado', 'not found', 404);
  if (s.estado !== 'gravando') throw erro('encerrada', 'esta gravação já foi concluída', 'this recording is already finished', 409);
  const segmento = inteiro(segmentoBruto, MAX_SEGMENTOS);
  if (segmento === null) throw erro('teto', 'a gravação chegou ao teto de 3 horas', 'the recording reached the 3-hour limit', 409);
  const fatia = inteiro(fatiaBruta, FATIAS_POR_SEGMENTO + 2);
  if (fatia === null) throw erro('fatia', 'número de fatia inválido', 'invalid chunk number');
  if (!bytes?.byteLength || bytes.byteLength > FATIA_MAX_BYTES) throw erro('grande', 'fatia vazia ou grande demais', 'chunk is empty or too large', 422);
  // Só a primeira fatia de cada segmento tem cabeçalho no WebM.
  if (fatia === 0 && s.ext === 'webm' && !formatoDoAudio(bytes.slice(0, 16))) throw erro('nao_audio', 'isso não é áudio', "that isn't audio", 422);
  await env.MEDIA.put(`${prefixo(tenantId, sessao)}${segmento}/${fatia}`, bytes, { httpMetadata: { contentType: s.mime } });
  await env.DB.prepare("UPDATE gravacao_sessoes SET ultima_em = datetime('now') WHERE id = ? AND tenant_id = ?").bind(sessao, tenantId).run();
}

/** As fatias que subiram, por segmento. */
async function fatiasDaSessao(env: Env, prefix: string) {
  const mapa = new Map<number, Map<number, { chave: string; bytes: number }>>();
  let cursor: string | undefined;
  do {
    const r = await env.MEDIA.list({ prefix, cursor });
    for (const o of r.objects) {
      const m = o.key.slice(prefix.length).match(/^(\d+)\/(\d+)$/);
      if (!m) continue;
      const seg = Number(m[1]);
      if (!mapa.has(seg)) mapa.set(seg, new Map());
      mapa.get(seg)!.set(Number(m[2]), { chave: o.key, bytes: o.size });
    }
    cursor = r.truncated ? r.cursor : undefined;
  } while (cursor);
  return mapa;
}

/** A hora em Brasília, para o nome da gravação. */
const horaDe = (iso: string) => new Date(`${iso.replace(' ', 'T')}Z`).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });

/**
 * Cria a gravação com um segmento por número recebido, e um segmento sem fatia nenhuma já como trecho perdido, à vista.
 * Só quem troca o estado para `concluindo` segue: fechar a aba, voltar e o cron podem pedir ao mesmo tempo.
 */
export async function concluirSessao(env: Env, tenantId: string, textoId: string, sessao: string) {
  const s = await sessaoDoTexto(env, tenantId, textoId, sessao);
  if (!s) throw erro('nao_encontrado', 'não encontrado', 'not found', 404);
  if (s.estado === 'concluida') return s.arquivo_id;
  const r = await env.DB.prepare("UPDATE gravacao_sessoes SET estado = 'concluindo' WHERE id = ? AND tenant_id = ? AND estado = 'gravando'").bind(sessao, tenantId).run();
  if (!r.meta.changes) return null;
  const prefix = prefixo(tenantId, sessao);
  const fatias = await fatiasDaSessao(env, prefix);
  if (!fatias.size) {
    await env.DB.prepare("UPDATE gravacao_sessoes SET estado = 'vazia' WHERE id = ? AND tenant_id = ?").bind(sessao, tenantId).run();
    return null;
  }
  const ultimo = Math.max(...fatias.keys());
  const id = novoId();
  const bytes = [...fatias.values()].reduce((soma, m) => soma + [...m.values()].reduce((x, f) => x + f.bytes, 0), 0);
  const nome = `Gravação de ${hojeISO(new Date(`${s.created_at.replace(' ', 'T')}Z`)).split('-').reverse().join('/')}, ${horaDe(s.created_at)}.${s.ext}`;
  const stmts = [
    env.DB.prepare("INSERT INTO arquivos (id, tenant_id, texto_id, tipo, nome, r2, bytes, sha256, mime, por, fila_em) VALUES (?, ?, ?, 'audio', ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%d %H:%M:%f', 'now'))")
      .bind(id, tenantId, textoId, nome, prefix, bytes, await sha256(new TextEncoder().encode(sessao)), s.mime, s.por),
    env.DB.prepare("UPDATE gravacao_sessoes SET estado = 'concluida', arquivo_id = ? WHERE id = ? AND tenant_id = ?").bind(id, sessao, tenantId),
  ];
  const fila: number[] = [];
  for (let n = 0; n <= ultimo; n++) {
    const numeros = [...(fatias.get(n)?.keys() ?? [])];
    const faltas = faltasDoSegmento(n, numeros, n === ultimo);
    const semCabecalho = !numeros.includes(0);
    if (!semCabecalho) fila.push(n);
    stmts.push(env.DB.prepare('INSERT INTO gravacao_segmentos (tenant_id, arquivo_id, n, inicio, estado, erro, faltas_json) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(tenantId, id, n, inicioDoSegmento(n), semCabecalho ? 'falhou' : 'fila', semCabecalho ? 'o começo deste trecho não chegou ao servidor' : null, JSON.stringify(faltas)));
  }
  await env.DB.batch(stmts);
  await registrarEvento(env, tenantId, 'materia.gravacao', 'texto', textoId, { arquivoId: id, nome, bytes, segmentos: ultimo + 1, por: s.por });
  await enfileirarSegmentos(env, tenantId, id, fila);
  await fecharSeTerminou(env, tenantId, id);
  return id;
}

async function enfileirarSegmentos(env: Env, tenantId: string, arquivoId: string, ns: number[]) {
  try {
    for (let i = 0; i < ns.length; i += 100) {
      await env.MONITOR_QUEUE.sendBatch(ns.slice(i, i + 100).map((n) => ({ body: { tipo: 'segmento' as const, tenantId, arquivoId, n } })));
    }
  } catch (e) {
    await env.DB.prepare("UPDATE gravacao_segmentos SET estado = 'falhou', erro = ? WHERE arquivo_id = ? AND tenant_id = ? AND estado = 'fila'")
      .bind(`não entrou na fila (${String((e as Error).message ?? e).slice(0, 160)})`, arquivoId, tenantId).run();
  }
}

/** Sessão parada há mais de 2 horas: quem fechou a aba e não voltou. Cron de 15 minutos. */
export async function concluirSessoesParadas(env: Env) {
  const { results } = await env.DB.prepare("SELECT id, tenant_id, texto_id FROM gravacao_sessoes WHERE estado = 'gravando' AND ultima_em < datetime('now', '-2 hours') LIMIT 50")
    .all<{ id: string; tenant_id: string; texto_id: string }>();
  for (const s of results) await concluirSessao(env, s.tenant_id, s.texto_id, s.id).catch((e) => console.error('concluirSessao', s.id, e));
  return results.length;
}

/** Quando nada está na fila nem sendo lido, a gravação termina: pronta se algum segmento ficou, com o resto à vista. */
async function fecharSeTerminou(env: Env, tenantId: string, arquivoId: string) {
  await env.DB.prepare(
    `UPDATE arquivos SET
        estado = CASE WHEN EXISTS (SELECT 1 FROM gravacao_segmentos s WHERE s.arquivo_id = arquivos.id AND s.estado = 'pronto') THEN 'pronto' ELSE 'falhou' END,
        erro = CASE WHEN EXISTS (SELECT 1 FROM gravacao_segmentos s WHERE s.arquivo_id = arquivos.id AND s.estado = 'pronto') THEN NULL ELSE 'nenhum trecho foi transcrito' END,
        duracao = (SELECT MAX(fim) FROM gravacao_trechos g WHERE g.arquivo_id = arquivos.id AND g.tenant_id = arquivos.tenant_id),
        processando_em = NULL
      WHERE id = ? AND tenant_id = ? AND estado = 'lendo'
        AND NOT EXISTS (SELECT 1 FROM gravacao_segmentos s WHERE s.arquivo_id = arquivos.id AND s.estado IN ('fila', 'lendo'))`,
  ).bind(arquivoId, tenantId).run();
}

/** Junta as fatias num arquivo só e apaga as fatias. Quem já foi montado (tentar de novo) só é lido. */
async function montarSegmento(env: Env, tenantId: string, arquivoId: string, n: number, seg: { r2: string | null }, a: { r2: string; mime: string | null }) {
  if (seg.r2) return (await env.MEDIA.get(seg.r2))?.arrayBuffer() ?? null;
  const fatias = [...((await fatiasDaSessao(env, a.r2)).get(n)?.entries() ?? [])].sort(([x], [y]) => x - y);
  if (!fatias.length) return null;
  const pedacos: Uint8Array[] = [];
  for (const [, f] of fatias) {
    const o = await env.MEDIA.get(f.chave);
    if (o) pedacos.push(new Uint8Array(await o.arrayBuffer()));
  }
  const junto = new Uint8Array(pedacos.reduce((s, p) => s + p.byteLength, 0));
  let i = 0;
  for (const p of pedacos) { junto.set(p, i); i += p.byteLength; }
  const ext = a.mime === 'audio/mp4' ? 'm4a' : 'webm';
  const chave = `${a.r2}${n}.${ext}`;
  await env.MEDIA.put(chave, junto, { httpMetadata: { contentType: a.mime ?? 'audio/webm' } });
  await env.DB.prepare('UPDATE gravacao_segmentos SET r2 = ?, bytes = ?, sha256 = ? WHERE arquivo_id = ? AND tenant_id = ? AND n = ?')
    .bind(chave, junto.byteLength, await sha256(junto), arquivoId, tenantId, n).run();
  await env.MEDIA.delete(fatias.map(([, f]) => f.chave));
  return junto.buffer as ArrayBuffer;
}

/** Fila: um segmento. A posse vence em 10 minutos; a entrega duplicada encontra o segmento em outro estado. */
export async function processarSegmento(env: Env, tenantId: string, arquivoId: string, n: number) {
  const seg = await env.DB.prepare(
    `UPDATE gravacao_segmentos SET estado = 'lendo', erro = NULL, processando_em = datetime('now')
      WHERE arquivo_id = ? AND tenant_id = ? AND n = ? AND (estado = 'fila' OR (estado = 'lendo' AND processando_em < datetime('now', '-10 minutes')))
      RETURNING r2, inicio`,
  ).bind(arquivoId, tenantId, n).first<{ r2: string | null; inicio: number }>();
  if (!seg) {
    const agora = await env.DB.prepare('SELECT estado FROM gravacao_segmentos WHERE arquivo_id = ? AND tenant_id = ? AND n = ?').bind(arquivoId, tenantId, n).first<{ estado: string }>();
    if (agora?.estado === 'lendo') throw new ArquivoOcupado();
    return;
  }
  const a = await env.DB.prepare('SELECT a.r2, a.mime, t.idioma FROM arquivos a JOIN tenants t ON t.id = a.tenant_id WHERE a.id = ? AND a.tenant_id = ?').bind(arquivoId, tenantId)
    .first<{ r2: string; mime: string | null; idioma: string | null }>();
  const falhar = async (motivo: string) => {
    await env.DB.prepare("UPDATE gravacao_segmentos SET estado = 'falhou', erro = ?, processando_em = NULL WHERE arquivo_id = ? AND tenant_id = ? AND n = ?").bind(motivo.slice(0, 300), arquivoId, tenantId, n).run();
    await fecharSeTerminou(env, tenantId, arquivoId);
  };
  if (!a) return;
  try {
    const bytes = await montarSegmento(env, tenantId, arquivoId, n, seg, a);
    if (!bytes) { await falhar('o áudio deste trecho sumiu do armazenamento'); return; }
    const saida = await transcrever(env, bytes, a.idioma === 'en' ? 'en' : 'pt-BR');
    const total = await env.DB.prepare('SELECT MAX(n) AS ultimo FROM gravacao_segmentos WHERE arquivo_id = ? AND tenant_id = ?').bind(arquivoId, tenantId).first<{ ultimo: number }>();
    const trechos = deslocarTrechos((saida.segments ?? []).filter((s) => s.text?.trim()), seg.inicio, janelaDoSegmento(n, total?.ultimo ?? n));
    // A numeração dos trechos segue o tempo, e a conferência lê por ela.
    const base = n * 100_000;
    await env.DB.batch([
      env.DB.prepare('DELETE FROM gravacao_trechos WHERE arquivo_id = ? AND tenant_id = ? AND n >= ? AND n < ?').bind(arquivoId, tenantId, base, base + 100_000),
      ...trechos.map((t, i) => env.DB.prepare('INSERT INTO gravacao_trechos (tenant_id, arquivo_id, n, inicio, fim, texto, palavras_json) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(tenantId, arquivoId, base + i, t.inicio, t.fim, t.texto, JSON.stringify(t.palavras))),
      env.DB.prepare("UPDATE gravacao_segmentos SET estado = 'pronto', erro = NULL, processando_em = NULL WHERE arquivo_id = ? AND tenant_id = ? AND n = ?").bind(arquivoId, tenantId, n),
      // Longa gravação na fila não é arquivo parado.
      env.DB.prepare("UPDATE arquivos SET fila_em = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = ? AND tenant_id = ? AND estado = 'lendo'").bind(arquivoId, tenantId),
    ]);
  } catch (e) {
    await falhar(`a transcrição falhou (${String((e as Error).message ?? e).slice(0, 200)})`);
    return;
  }
  await fecharSeTerminou(env, tenantId, arquivoId);
}

/** Última entrega da fila: a falha fica no segmento. */
export async function encerrarSegmento(env: Env, tenantId: string, arquivoId: string, n: number, motivo: string) {
  await env.DB.prepare("UPDATE gravacao_segmentos SET estado = 'falhou', erro = ?, processando_em = NULL WHERE arquivo_id = ? AND tenant_id = ? AND n = ? AND estado IN ('fila', 'lendo')")
    .bind(motivo.slice(0, 300), arquivoId, tenantId, n).run();
  await fecharSeTerminou(env, tenantId, arquivoId);
}

/** "Tentar de novo": só segmento que falhou e tem áudio. */
export async function tentarSegmento(env: Env, tenantId: string, textoId: string, arquivoId: string, nBruto: string) {
  const n = inteiro(nBruto, MAX_SEGMENTOS);
  const a = await env.DB.prepare("SELECT id, r2 FROM arquivos WHERE id = ? AND texto_id = ? AND tenant_id = ? AND tipo = 'audio'").bind(arquivoId, textoId, tenantId).first<{ id: string; r2: string }>();
  if (!a || n === null) throw erro('nao_encontrado', 'não encontrado', 'not found', 404);
  const seg = await env.DB.prepare('SELECT estado, r2 FROM gravacao_segmentos WHERE arquivo_id = ? AND tenant_id = ? AND n = ?').bind(arquivoId, tenantId, n).first<{ estado: string; r2: string | null }>();
  if (!seg) throw erro('nao_encontrado', 'não encontrado', 'not found', 404);
  if (seg.estado !== 'falhou') throw erro('estado', 'este trecho não falhou', "this part didn't fail", 409);
  if (!seg.r2 && !(await fatiasDaSessao(env, a.r2)).get(n)?.has(0)) throw erro('sem_audio', 'o áudio deste trecho não chegou ao servidor', "this part's audio never reached the server", 409);
  await env.DB.batch([
    env.DB.prepare("UPDATE gravacao_segmentos SET estado = 'fila', erro = NULL WHERE arquivo_id = ? AND tenant_id = ? AND n = ?").bind(arquivoId, tenantId, n),
    env.DB.prepare("UPDATE arquivos SET estado = 'lendo', erro = NULL, processando_em = NULL, fila_em = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = ? AND tenant_id = ?").bind(arquivoId, tenantId),
  ]);
  await enfileirarSegmentos(env, tenantId, arquivoId, [n]);
  await fecharSeTerminou(env, tenantId, arquivoId);
}

/** Gravações que ninguém concluiu: a tela oferece concluir. */
export async function sessoesAbertas(env: Env, tenantId: string, textoId: string) {
  const { results } = await env.DB.prepare("SELECT id, created_at FROM gravacao_sessoes WHERE tenant_id = ? AND texto_id = ? AND estado = 'gravando' ORDER BY created_at")
    .bind(tenantId, textoId).all<{ id: string; created_at: string }>();
  return results.map((s) => ({ id: s.id, criadoEm: s.created_at }));
}

export type ResumoSegmentos = { total: number; prontos: number; falhos: { n: number; inicio: number; erro: string | null }[]; faltas: { de: number; ate: number }[]; inicios: number[] };

/** O andamento de cada gravação em segmentos do texto, por arquivo. */
export async function segmentosDoTexto(env: Env, tenantId: string, textoId: string): Promise<Map<string, ResumoSegmentos>> {
  const { results } = await env.DB.prepare(
    `SELECT s.arquivo_id, s.n, s.inicio, s.estado, s.erro, s.faltas_json, s.r2 FROM gravacao_segmentos s JOIN arquivos a ON a.id = s.arquivo_id AND a.tenant_id = s.tenant_id
      WHERE s.tenant_id = ? AND a.texto_id = ? ORDER BY s.arquivo_id, s.n`,
  ).bind(tenantId, textoId).all<{ arquivo_id: string; n: number; inicio: number; estado: string; erro: string | null; faltas_json: string; r2: string | null }>();
  const mapa = new Map<string, ResumoSegmentos>();
  for (const s of results) {
    const m = mapa.get(s.arquivo_id) ?? { total: 0, prontos: 0, falhos: [], faltas: [], inicios: [] };
    m.total++;
    if (s.estado === 'pronto') m.prontos++;
    if (s.estado === 'falhou') m.falhos.push({ n: s.n, inicio: s.inicio, erro: s.erro });
    if (s.r2) m.inicios.push(s.inicio);
    m.faltas.push(...(JSON.parse(s.faltas_json) as { de: number; ate: number }[]));
    mapa.set(s.arquivo_id, m);
  }
  return mapa;
}
