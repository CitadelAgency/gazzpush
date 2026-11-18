import type { Env } from '../env';
import { novoId, registrarEvento } from './db';
import { ErroMesa, lerTexto } from './mesa';
import { chaveNome, nomesDoTexto } from './apuracao';
import { produzirPauta } from './produzir';
import { scoreManual } from './triagem';
import { urlDoDoc } from './google';
import { situacaoLai } from './lai';

// Matéria viva (Fase 7): depois de apurada, a matéria continua sendo vigiada e o que muda vira alerta na aba Depois:
// fonte do dossiê que mudou ou saiu do ar (o monitor diário que já existia), pessoa citada no texto que aparece em
// notícia nova das fontes do veículo, processo judicial citado no texto com movimento novo (DataJud, do CNJ) e prazo
// de pedido de LAI. Cada alerta oferece atualizar o texto (a pessoa edita; nada muda sozinho) e gerar um post de
// "Atualização" ou "Errata", que é sempre post novo (o Instagram não troca a imagem de post publicado).

export const TIPOS_POST = ['atualizacao', 'errata'] as const;
export type TipoPost = (typeof TIPOS_POST)[number];
const FALHAS_FORA = 3;

const erro = (codigo: string, pt: string, en: string, status: 400 | 404 | 409 | 422 = 400) => new ErroMesa(codigo, pt, status, en);

export interface Alerta {
  id: string; tipo: string; titulo: string; detalhe: Record<string, unknown>; estado: 'aberto' | 'resolvido' | 'ignorado';
  acao: string | null; pecaId: string | null; nota: string | null; porNome: string | null; resolvidoEm: string | null; criadoEm: string;
}

async function criarAlerta(env: Env, tenantId: string, textoId: string, tipo: string, chave: string, titulo: string, detalhe: Record<string, unknown>) {
  const r = await env.DB.prepare('INSERT OR IGNORE INTO alertas (id, tenant_id, texto_id, tipo, chave, titulo, detalhe_json) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(novoId(), tenantId, textoId, tipo, chave, titulo.slice(0, 300), JSON.stringify(detalhe)).run();
  return r.meta.changes > 0;
}

/**
 * Os alertas que se calculam do que já está no banco: fonte que mudou (o hash de agora), fonte que não responde há
 * dias, prazo de LAI perto de vencer ou vencido. Idempotente (a chave do alerta não repete).
 */
export async function sincronizarAlertas(env: Env, tenantId: string, textoId: string) {
  const { results: evs } = await env.DB.prepare(
    `SELECT id, url, titulo, hash_atual, mudou_em, falhas FROM evidencias WHERE texto_id = ? AND tenant_id = ? AND origem = 'link' AND (mudou_em IS NOT NULL OR falhas >= ?)`,
  ).bind(textoId, tenantId, FALHAS_FORA).all<{ id: string; url: string; titulo: string | null; hash_atual: string | null; mudou_em: string | null; falhas: number }>();
  for (const e of evs) {
    const nome = e.titulo ?? new URL(e.url).hostname;
    if (e.mudou_em) await criarAlerta(env, tenantId, textoId, 'fonte_mudou', `fonte:${e.id}:${e.hash_atual}`, nome, { evidenciaId: e.id, url: e.url, em: e.mudou_em });
    if (e.falhas >= FALHAS_FORA) await criarAlerta(env, tenantId, textoId, 'fonte_fora', `fora:${e.id}`, nome, { evidenciaId: e.id, url: e.url, falhas: e.falhas });
  }
  const { results: lais } = await env.DB.prepare('SELECT id, orgao, esfera, protocolo, protocolado_em, prorrogado_em, resposta_em, atendeu, recurso_em, recurso_resposta_em, recurso_atendeu FROM pedidos_lai WHERE texto_id = ? AND tenant_id = ? AND protocolado_em IS NOT NULL')
    .bind(textoId, tenantId).all<{ id: string; orgao: string; esfera: string; protocolo: string | null; protocolado_em: string; prorrogado_em: string | null; resposta_em: string | null; atendeu: number | null; recurso_em: string | null; recurso_resposta_em: string | null; recurso_atendeu: number | null }>();
  for (const p of lais) {
    const s = situacaoLai(p);
    if (s.vencido && !p.recurso_em) await criarAlerta(env, tenantId, textoId, 'lai_vencido', `lai:${p.id}:vencido:${s.prazoFinal}`, p.orgao, { pedidoId: p.id, protocolo: p.protocolo, prazo: s.prazoFinal, recorrerAte: s.recorrerAte });
    else if (s.diasRestantes !== null && s.diasRestantes >= 0 && s.diasRestantes <= 3) await criarAlerta(env, tenantId, textoId, 'lai_vence', `lai:${p.id}:vence:${s.prazoFinal}`, p.orgao, { pedidoId: p.id, protocolo: p.protocolo, prazo: s.prazoFinal });
  }
}

/**
 * Cron diário: os prazos de LAI de todos os veículos (o alerta aparece na lista de Textos sem a matéria ser aberta).
 * Cada texto vai como uma mensagem da fila: o cron não faz as consultas de todos numa execução só (teto do Worker).
 */
export async function sincronizarPrazosLai(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT tenant_id, texto_id FROM pedidos_lai WHERE protocolado_em IS NOT NULL
        AND ((resposta_em IS NULL AND recurso_em IS NULL) OR (recurso_em IS NOT NULL AND recurso_resposta_em IS NULL))`,
  ).all<{ tenant_id: string; texto_id: string }>();
  for (let i = 0; i < results.length; i += 100) {
    await env.MONITOR_QUEUE.sendBatch(results.slice(i, i + 100).map((r) => ({ body: { tipo: 'lai' as const, tenantId: r.tenant_id, textoId: r.texto_id } })));
  }
  return results.length;
}

export async function alertasDoTexto(env: Env, tenantId: string, textoId: string): Promise<Alerta[]> {
  await sincronizarAlertas(env, tenantId, textoId);
  const { results } = await env.DB.prepare(
    `SELECT a.*, u.name AS por_nome FROM alertas a LEFT JOIN "user" u ON u.id = a.resolvido_por WHERE a.texto_id = ? AND a.tenant_id = ?
      ORDER BY CASE a.estado WHEN 'aberto' THEN 0 ELSE 1 END, a.created_at DESC, a.rowid DESC LIMIT 200`,
  ).bind(textoId, tenantId).all<{ id: string; tipo: string; titulo: string; detalhe_json: string; estado: string; acao: string | null; peca_id: string | null; nota: string | null; por_nome: string | null; resolvido_em: string | null; created_at: string }>();
  return results.map((a) => ({
    id: a.id, tipo: a.tipo, titulo: a.titulo, detalhe: JSON.parse(a.detalhe_json), estado: a.estado as Alerta['estado'], acao: a.acao, pecaId: a.peca_id, nota: a.nota,
    porNome: a.por_nome, resolvidoEm: a.resolvido_em, criadoEm: a.created_at,
  }));
}

// ── pessoas citadas em notícia nova ─────────────────────────────────────────────────────────────────────────────

const semAcento = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ');

/**
 * Documento novo das fontes do veículo (a fila do monitor): cada pessoa citada (nome com duas palavras ou mais) nas
 * matérias do veículo dos últimos 180 dias que aparece no título ou no texto dele vira alerta na matéria.
 */
export async function alertasDePessoas(env: Env, tenantId: string, documentoId: string) {
  const doc = await env.DB.prepare('SELECT id, url, titulo, r2_texto FROM documentos WHERE id = ? AND tenant_id = ?').bind(documentoId, tenantId).first<{ id: string; url: string; titulo: string | null; r2_texto: string | null }>();
  if (!doc) return 0;
  const { results: textos } = await env.DB.prepare(
    `SELECT t.id, t.paragrafos_json FROM textos t JOIN tenants n ON n.id = t.tenant_id WHERE t.tenant_id = ? AND n.modo = 'autoral' AND t.updated_at >= datetime('now', '-180 days') LIMIT 200`,
  ).bind(tenantId).all<{ id: string; paragrafos_json: string }>();
  if (!textos.length) return 0;
  const corpo = semAcento(`${doc.titulo ?? ''} ${(doc.r2_texto ? await env.MEDIA.get(doc.r2_texto).then((o) => o?.text()) : '') ?? ''}`);
  let n = 0;
  for (const t of textos) {
    const paragrafos = (JSON.parse(t.paragrafos_json) as string[]).map((texto, i) => ({ id: `p${i}`, texto }));
    for (const p of nomesDoTexto(paragrafos)) {
      if (p.tipo !== 'pessoa' || p.nome.split(/\s+/).length < 2) continue;
      if (!new RegExp(`(^|[^\\p{L}])${semAcento(p.nome).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'u').test(corpo)) continue;
      if (await criarAlerta(env, tenantId, t.id, 'pessoa', `pessoa:${doc.id}:${chaveNome(p.nome)}`, p.nome, { nome: p.nome, documentoId: doc.id, url: doc.url, titulo: doc.titulo })) n++;
    }
  }
  return n;
}

// ── ações ───────────────────────────────────────────────────────────────────────────────────────────────────────

async function lerAlerta(env: Env, tenantId: string, textoId: string, alertaId: string) {
  const a = await env.DB.prepare('SELECT id, tipo, titulo, detalhe_json, estado FROM alertas WHERE id = ? AND texto_id = ? AND tenant_id = ?').bind(alertaId, textoId, tenantId).first<{ id: string; tipo: string; titulo: string; detalhe_json: string; estado: string }>();
  if (!a) throw erro('nao_encontrado', 'não encontrado', 'not found', 404);
  return a;
}

/** "Atualizei o texto" ou "Ignorar": fecha o alerta, com quem e quando. */
export async function resolverAlerta(env: Env, tenantId: string, textoId: string, alertaId: string, por: string, acao: unknown) {
  await lerTexto(env, tenantId, textoId);
  const a = await lerAlerta(env, tenantId, textoId, alertaId);
  if (acao !== 'texto_atualizado' && acao !== 'ignorado') throw erro('acao', 'Ação desconhecida.', 'Unknown action.', 422);
  if (a.estado !== 'aberto') throw erro('fechado', 'Este alerta já foi tratado.', 'This alert has already been handled.', 409);
  await env.DB.prepare("UPDATE alertas SET estado = ?, acao = ?, resolvido_por = ?, resolvido_em = datetime('now') WHERE id = ? AND tenant_id = ?")
    .bind(acao === 'ignorado' ? 'ignorado' : 'resolvido', acao, por, a.id, tenantId).run();
  await registrarEvento(env, tenantId, 'materia.alerta', 'texto', textoId, { alertaId: a.id, acao, por });
}

/**
 * Post de Atualização ou Errata a partir do alerta: a pessoa escreve o que mudou (a nota é dela, vai como afirmação
 * do autor) e o post sai novo, uma imagem só, com o rótulo na manchete. O post de antes não é tocado.
 */
export async function postDoAlerta(env: Env, tenantId: string, textoId: string, alertaId: string, por: string, b: Record<string, unknown>) {
  const t = await lerTexto(env, tenantId, textoId);
  const a = await lerAlerta(env, tenantId, textoId, alertaId);
  if (a.estado !== 'aberto') throw erro('fechado', 'Este alerta já foi tratado.', 'This alert has already been handled.', 409);
  const tipo = (TIPOS_POST as readonly unknown[]).includes(b.tipo) ? (b.tipo as TipoPost) : null;
  if (!tipo) throw erro('tipo', 'Escolha Atualização ou Errata.', 'Choose Update or Correction.', 422);
  const nota = typeof b.nota === 'string' ? b.nota.replace(/\s+/g, ' ').trim() : '';
  if (nota.length < 20 || nota.length > 600) throw erro('nota', 'Escreva o que mudou ou o que foi corrigido (20 a 600 caracteres).', 'Write what changed or what was corrected (20 to 600 characters).', 422);

  const pautaId = novoId();
  // Reserva o alerta primeiro (só um pedido passa do "aberto"): dois cliques ao mesmo tempo não fazem dois posts.
  const reservado = await env.DB.prepare("UPDATE alertas SET estado = 'resolvido', acao = ?, nota = ?, pauta_id = NULL, resolvido_por = ?, resolvido_em = datetime('now') WHERE id = ? AND tenant_id = ? AND estado = 'aberto' RETURNING id")
    .bind(`post_${tipo}`, nota, por, a.id, tenantId).first<{ id: string }>();
  if (!reservado) throw erro('fechado', 'Este alerta já foi tratado.', 'This alert has already been handled.', 409);
  try {
    return await criarPostDoAlerta(env, tenantId, textoId, t, a.id, pautaId, tipo, nota, por);
  } catch (e) {
    // Não saiu o post: o alerta volta a aberto (a pessoa vê o erro e tenta de novo). A pauta que ficou sem produção
    // começar é descartada; produção que começou (pauta em produção ou concluída) é post de verdade, e o alerta fica.
    // Numa transação só: a pauta sai se ainda não começou, e o alerta reabre só se ela não existe ou acabou de sair
    // (alguém que começou a produção nesse meio-tempo segura a pauta, e o alerta fica com ela).
    await env.DB.batch([
      env.DB.prepare("UPDATE pautas SET status = 'descartada', updated_at = datetime('now') WHERE id = ? AND tenant_id = ? AND status IN ('sugerida', 'aceita')").bind(pautaId, tenantId),
      env.DB.prepare(`UPDATE alertas SET estado = 'aberto', acao = NULL, nota = NULL, pauta_id = NULL, peca_id = NULL, resolvido_por = NULL, resolvido_em = NULL
                       WHERE id = ? AND tenant_id = ? AND (pauta_id IS NULL OR pauta_id = ?)
                         AND NOT EXISTS (SELECT 1 FROM pautas WHERE id = ? AND tenant_id = ? AND status != 'descartada')`)
        .bind(a.id, tenantId, pautaId, pautaId, tenantId),
    ]);
    throw e;
  }
}

async function criarPostDoAlerta(env: Env, tenantId: string, textoId: string, t: Awaited<ReturnType<typeof lerTexto>>, alertaId: string, pautaId: string, tipo: TipoPost, nota: string, por: string) {
  const marca = await env.DB.prepare('SELECT marca_json FROM tenants WHERE id = ?').bind(tenantId).first<{ marca_json: string | null }>();
  const urlAutor = t.docs_id ? urlDoDoc(t.docs_id) : (JSON.parse(marca?.marca_json ?? '{}') as { ctaUrl?: string }).ctaUrl ?? env.PUBLIC_BASE_URL;
  const docAutor = novoId();
  const fatoId = novoId();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO documentos (id, tenant_id, fonte_id, url, hash_texto, titulo, r2_texto, status, triagem) VALUES (?, ?, NULL, ?, ?, ?, NULL, 'triado', 'autoral')`)
      .bind(docAutor, tenantId, urlAutor, `correcao:${pautaId}:autor`, t.titulo),
    env.DB.prepare(`INSERT INTO fatos (id, tenant_id, documento_id, tipo, texto, hash, confianca) VALUES (?, ?, ?, 'opiniao', ?, ?, 1)`)
      .bind(fatoId, tenantId, docAutor, nota, `correcao:${pautaId}:nota`),
    env.DB.prepare(
      `INSERT INTO pautas (id, tenant_id, status, origem, titulo, resumo, fato_ids_json, documento_ids_json, score, texto_id, texto_versao, tipo_post)
       VALUES (?, ?, 'sugerida', 'manual', ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(pautaId, tenantId, t.titulo, nota, JSON.stringify([fatoId]), JSON.stringify([docAutor]), scoreManual(new Date()), textoId, t.versao, tipo),
    env.DB.prepare('UPDATE alertas SET pauta_id = ? WHERE id = ? AND tenant_id = ?').bind(pautaId, alertaId, tenantId),
  ]);
  const pecaId = (await produzirPauta(env, tenantId, pautaId, por, 'post', { semCota: true }))?.pecaId ?? null;   // errata sempre sai
  await env.DB.prepare('UPDATE alertas SET peca_id = ? WHERE id = ? AND tenant_id = ?').bind(pecaId, alertaId, tenantId).run();
  await registrarEvento(env, tenantId, 'materia.correcao', 'texto', textoId, { alertaId, tipo, pautaId, pecaId, por });
  return { pautaId, pecaId };
}

// ── processos (DataJud) ─────────────────────────────────────────────────────────────────────────────────────────

// Número único do CNJ (Res. 65/2008): NNNNNNN-DD.AAAA.J.TR.OOOO. Só o formato com a máscara conta (número solto de
// 20 dígitos é outra coisa), e o dígito verificador tem de bater (módulo 97).
const CNJ = /\b(\d{7})-(\d{2})\.(\d{4})\.(\d)\.(\d{2})\.(\d{4})\b/g;
const UFS = ['ac', 'al', 'ap', 'am', 'ba', 'ce', 'dft', 'es', 'go', 'ma', 'mt', 'ms', 'mg', 'pa', 'pb', 'pr', 'pe', 'pi', 'rj', 'rn', 'rs', 'ro', 'rr', 'sc', 'se', 'sp', 'to'];

export function digitoCnjOk(n: string) {
  const [num, dv, ano, j, tr, orig] = [n.slice(0, 7), n.slice(7, 9), n.slice(9, 13), n.slice(13, 14), n.slice(14, 16), n.slice(16, 20)];
  return 98n - (BigInt(`${num}${ano}${j}${tr}${orig}00`) % 97n) === BigInt(dv);
}

/** O alias do tribunal no DataJud pelo segmento J.TR do número (tabela do wiki do DataJud e da Res. CNJ 65/2008). */
export function tribunalDataJud(n: string): string | null {
  const j = n.slice(13, 14), tr = Number(n.slice(14, 16));
  if (tr === 0) return ({ '3': 'stj', '5': 'tst', '6': 'tse', '7': 'stm' } as Record<string, string>)[j] ?? null;
  if (j === '4' && tr <= 6) return `trf${tr}`;
  if (j === '5' && tr <= 24) return `trt${tr}`;
  if (j === '8' && tr <= 27) return `tj${UFS[tr - 1]}`;
  // Na Justiça Eleitoral o DF é tre-df (no TJ é tjdft).
  if (j === '6' && tr <= 27) return `tre-${UFS[tr - 1] === 'dft' ? 'df' : UFS[tr - 1]}`;
  if (j === '7') return 'stm';
  if (j === '9') return ({ 13: 'tjmmg', 21: 'tjmrs', 26: 'tjmsp' } as Record<number, string>)[tr] ?? null;
  return null;
}

/** Números de processo no texto (só dígitos), sem repetir e com o dígito verificador certo. */
export function processosNoTexto(paragrafos: string[]): string[] {
  const out = new Set<string>();
  for (const p of paragrafos) for (const m of p.matchAll(CNJ)) { const n = m.slice(1).join(''); if (digitoCnjOk(n)) out.add(n); }
  return [...out];
}

export const dataJudLigado = (env: Env) => !!env.DATAJUD_API_KEY;

/** Os processos do texto como estão agora (cria a linha dos números novos; o cron consulta). */
export async function processosDoTexto(env: Env, tenantId: string, textoId: string, paragrafos: string[]) {
  const numeros = processosNoTexto(paragrafos);
  if (numeros.length) {
    await env.DB.batch(numeros.map((n) => env.DB.prepare('INSERT OR IGNORE INTO processos (id, tenant_id, texto_id, numero, tribunal) VALUES (?, ?, ?, ?, ?)').bind(novoId(), tenantId, textoId, n, tribunalDataJud(n))));
  }
  const { results } = await env.DB.prepare('SELECT numero, tribunal, ultimo_movimento, ultimo_movimento_em, consultado_em, erro FROM processos WHERE texto_id = ? AND tenant_id = ? ORDER BY created_at')
    .bind(textoId, tenantId).all<{ numero: string; tribunal: string | null; ultimo_movimento: string | null; ultimo_movimento_em: string | null; consultado_em: string | null; erro: string | null }>();
  return {
    ligado: dataJudLigado(env),
    lista: results.filter((p) => numeros.includes(p.numero)).map((p) => ({ numero: p.numero, tribunal: p.tribunal, ultimoMovimento: p.ultimo_movimento, ultimoMovimentoEm: p.ultimo_movimento_em, consultadoEm: p.consultado_em, erro: p.erro })),
  };
}

/** Cron diário: processos de matérias dos últimos 180 dias, consultados há mais de 20 h, vão para a fila. */
export async function enfileirarProcessos(env: Env) {
  if (!dataJudLigado(env)) return 0;
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.tenant_id FROM processos p JOIN textos t ON t.id = p.texto_id AND t.tenant_id = p.tenant_id
      WHERE p.tribunal IS NOT NULL AND t.updated_at >= datetime('now', '-180 days') AND (p.consultado_em IS NULL OR p.consultado_em <= datetime('now', '-20 hours'))
      ORDER BY p.consultado_em LIMIT 500`,
  ).all<{ id: string; tenant_id: string }>();
  for (let i = 0; i < results.length; i += 100) {
    await env.MONITOR_QUEUE.sendBatch(results.slice(i, i + 100).map((p) => ({ body: { tipo: 'processo' as const, tenantId: p.tenant_id, processoId: p.id } })));
  }
  return results.length;
}

interface Movimento { nome?: string; dataHora?: string }

/**
 * Consulta o processo no DataJud (API pública do CNJ; a chave é a pública do wiki, em DATAJUD_API_KEY). A primeira
 * consulta só guarda o último movimento; movimento mais novo depois disso vira alerta na matéria.
 */
export async function consultarProcesso(env: Env, tenantId: string, processoId: string) {
  const p = await env.DB.prepare('SELECT id, texto_id, numero, tribunal, ultimo_movimento_em FROM processos WHERE id = ? AND tenant_id = ?').bind(processoId, tenantId)
    .first<{ id: string; texto_id: string; numero: string; tribunal: string | null; ultimo_movimento_em: string | null }>();
  if (!p?.tribunal || !dataJudLigado(env)) return;
  const base = env.DATAJUD_URL ?? 'https://api-publica.datajud.cnj.jus.br';
  let movs: Movimento[];
  try {
    const r = await fetch(`${base}/api_publica_${p.tribunal}/_search`, {
      method: 'POST', signal: AbortSignal.timeout(20_000),
      headers: { 'content-type': 'application/json', authorization: `APIKey ${env.DATAJUD_API_KEY}` },
      body: JSON.stringify({ query: { match: { numeroProcesso: p.numero } }, size: 10 }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json<{ hits?: { hits?: { _source?: { movimentos?: Movimento[] } }[] } }>();
    movs = (j.hits?.hits ?? []).flatMap((h) => h._source?.movimentos ?? []).filter((m) => m.dataHora && m.nome);
  } catch (e) {
    await env.DB.prepare("UPDATE processos SET erro = ?, consultado_em = datetime('now') WHERE id = ? AND tenant_id = ?").bind(String((e as Error).message ?? e).slice(0, 200), p.id, tenantId).run();
    return;
  }
  const ultimo = movs.sort((a, b) => Date.parse(b.dataHora!) - Date.parse(a.dataHora!))[0];
  if (!ultimo) {
    await env.DB.prepare("UPDATE processos SET erro = ?, consultado_em = datetime('now') WHERE id = ? AND tenant_id = ?").bind('o DataJud não achou o processo (ou ele é sigiloso)', p.id, tenantId).run();
    return;
  }
  const novo = !!p.ultimo_movimento_em && Date.parse(ultimo.dataHora!) > Date.parse(p.ultimo_movimento_em);
  // O alerta antes do avanço: se gravar o alerta falhar, a fila tenta de novo e o movimento ainda conta como novo (a
  // chave do alerta impede a repetição).
  if (novo) {
    await criarAlerta(env, tenantId, p.texto_id, 'processo', `processo:${p.numero}:${ultimo.dataHora}`, p.numero, { numero: p.numero, tribunal: p.tribunal, movimento: ultimo.nome, em: ultimo.dataHora });
  }
  await env.DB.prepare("UPDATE processos SET ultimo_movimento = ?, ultimo_movimento_em = ?, erro = NULL, consultado_em = datetime('now') WHERE id = ? AND tenant_id = ?")
    .bind(ultimo.nome, ultimo.dataHora, p.id, tenantId).run();
}
