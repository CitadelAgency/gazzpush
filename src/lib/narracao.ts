// A voz do dono no Reels: o roteiro são os títulos e as frases dos cards, sem o convite. A fala é transcrita e comparada com
// ele por código; cada aviso pede uma decisão de pessoa, e a transcrição nunca vai para o vídeo: a legenda é o texto aprovado.
import type { Env } from '../env';
import type { Card } from './cards';
import { novoId } from './db';
import { compararNarracao, roteiroDoReels, type AvisoFala } from './fala';
import { formatoDoAudio, transcrever } from './gravacao';
import type { Palavra } from './segmentos';

export { roteiroDoReels };
export const MAX_NARRACAO_S = 90;
export const NARRACAO_MAX_BYTES = 10 * 1024 * 1024;

export async function receberNarracao(env: Env, tenantId: string, pecaId: string, versao: number, por: string, bytes: Uint8Array) {
  const formato = formatoDoAudio(bytes.slice(0, 16));
  if (!formato) return null;
  const id = novoId();
  const r2 = `narracoes/${tenantId}/${pecaId}/${id}.${formato.ext}`;
  await env.MEDIA.put(r2, bytes, { httpMetadata: { contentType: formato.mime } });
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))].map((x) => x.toString(16).padStart(2, '0')).join('');
  await env.DB.prepare('INSERT INTO narracoes (id, tenant_id, peca_id, versao, r2, bytes, sha256, mime, por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, tenantId, pecaId, versao, r2, bytes.byteLength, hash, formato.mime, por).run();
  await env.MONITOR_QUEUE.send({ tipo: 'narracao', tenantId, narracaoId: id });
  return id;
}

const falhar = (env: Env, tenantId: string, id: string, motivo: string) =>
  env.DB.prepare("UPDATE narracoes SET estado = 'falhou', erro = ? WHERE id = ? AND tenant_id = ? AND estado = 'lendo'").bind(motivo.slice(0, 300), id, tenantId).run();
export const encerrarNarracao = falhar;

/** Fila: transcreve e compara. O que vai para a tela são os avisos, com o tempo para ouvir. */
export async function processarNarracao(env: Env, tenantId: string, id: string) {
  const n = await env.DB.prepare(
    `SELECT n.r2, n.estado, p.conteudo_json, v.conteudo_json AS da_versao, t.idioma FROM narracoes n
       JOIN pecas p ON p.id = n.peca_id AND p.tenant_id = n.tenant_id
       JOIN tenants t ON t.id = n.tenant_id
       LEFT JOIN peca_versoes v ON v.peca_id = n.peca_id AND v.tenant_id = n.tenant_id AND v.versao = n.versao
      WHERE n.id = ? AND n.tenant_id = ?`,
  ).bind(id, tenantId).first<{ r2: string; estado: string; conteudo_json: string; da_versao: string | null; idioma: string | null }>();
  if (!n || n.estado !== 'lendo') return;
  const obj = await env.MEDIA.get(n.r2);
  if (!obj) { await falhar(env, tenantId, id, 'o áudio sumiu do armazenamento'); return; }
  let saida;
  try {
    saida = await transcrever(env, await obj.arrayBuffer(), n.idioma === 'en' ? 'en' : 'pt-BR');
  } catch (e) {
    await falhar(env, tenantId, id, `a transcrição falhou (${String((e as Error).message ?? e).slice(0, 200)})`);
    return;
  }
  const palavras: Palavra[] = (saida.segments ?? []).flatMap((s) => (s.words ?? []).map((w) => ({ p: w.word, i: Math.round(w.start * 100) / 100, f: Math.round(w.end * 100) / 100 })));
  const duracao = saida.transcription_info?.duration ?? palavras.at(-1)?.f ?? 0;
  if (!palavras.length) { await falhar(env, tenantId, id, 'a transcrição não achou fala no áudio'); return; }
  if (duracao > MAX_NARRACAO_S) { await falhar(env, tenantId, id, `a fala tem ${Math.round(duracao)} s; o teto é ${MAX_NARRACAO_S} s`); return; }
  const conteudo = JSON.parse(n.da_versao ?? n.conteudo_json) as { cards?: Card[] };
  const avisos = compararNarracao(roteiroDoReels(conteudo.cards), palavras);
  await env.DB.prepare("UPDATE narracoes SET estado = 'pronto', erro = NULL, duracao = ?, palavras_json = ?, avisos_json = ? WHERE id = ? AND tenant_id = ? AND estado = 'lendo'")
    .bind(duracao, JSON.stringify(palavras), JSON.stringify(avisos), id, tenantId).run();
}

export interface Narracao { id: string; versao: number; r2: string; mime: string; sha256: string; duracao: number | null; estado: string; erro: string | null; avisos: AvisoFala[]; palavras: Palavra[] }
interface Linha { id: string; versao: number; r2: string; mime: string; sha256: string; duracao: number | null; estado: string; erro: string | null; avisos_json: string; palavras_json: string }
const paraNarracao = (l: Linha): Narracao => ({ id: l.id, versao: l.versao, r2: l.r2, mime: l.mime, sha256: l.sha256, duracao: l.duracao, estado: l.estado, erro: l.erro, avisos: JSON.parse(l.avisos_json), palavras: JSON.parse(l.palavras_json) });
const CAMPOS = 'id, versao, r2, mime, sha256, duracao, estado, erro, avisos_json, palavras_json';

export async function narracaoPorId(env: Env, tenantId: string, pecaId: string, id: string) {
  const l = await env.DB.prepare(`SELECT ${CAMPOS} FROM narracoes WHERE id = ? AND tenant_id = ? AND peca_id = ?`).bind(id, tenantId, pecaId).first<Linha>();
  return l ? paraNarracao(l) : null;
}

/** A última fala da versão que está na tela. */
export async function narracaoDaVersao(env: Env, tenantId: string, pecaId: string, versao: number) {
  const l = await env.DB.prepare(`SELECT ${CAMPOS} FROM narracoes WHERE tenant_id = ? AND peca_id = ? AND versao = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`).bind(tenantId, pecaId, versao).first<Linha>();
  return l ? paraNarracao(l) : null;
}

/** A pessoa ouviu e a fala está certa. "Gravar de novo" é mandar outra fala. */
export async function decidirAviso(env: Env, tenantId: string, pecaId: string, id: string, indice: number) {
  const n = await narracaoPorId(env, tenantId, pecaId, id);
  if (!n?.avisos[indice]) return null;
  const avisos = n.avisos.map((a, i) => (i === indice ? { ...a, decisao: 'fala_certa' as const } : a));
  await env.DB.prepare('UPDATE narracoes SET avisos_json = ? WHERE id = ? AND tenant_id = ?').bind(JSON.stringify(avisos), id, tenantId).run();
  return avisos;
}

/** O que a tela vê: sem as palavras da transcrição. */
export const narracaoParaTela = (n: Narracao) => ({ id: n.id, estado: n.estado, erro: n.erro, duracao: n.duracao, avisos: n.avisos });
