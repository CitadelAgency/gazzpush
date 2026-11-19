import type { Env } from '../env';
import { newId, recordEvent } from './db';
import { DeskError, readText } from './desk';
import { nameKey, fromTextNames } from './reporting';
import { produceLead } from './produce';
import { scoreManual } from './triage';
import { fromDocUrl } from './google';
import { laiStatus } from './lai';

// Living story (Phase 7): once reported, the story keeps being watched and what changes becomes an alert in the After
// tab: a dossier source that changed or went offline (the daily monitor that already existed), a person mentioned in the
// text who appears in new news from the outlet's sources, a court case cited in the text with new activity (DataJud,
// from the CNJ) and LAI request deadlines. Each alert offers to update the text (the person edits; nothing changes by
// itself) and to generate an "Update" or "Correction" post, which is always a new post (Instagram does not swap the
// image of a published post).

export const POST_TYPES = ['atualizacao', 'errata'] as const;
export type PostType = (typeof POST_TYPES)[number];
const FAILURES_OUTSIDE = 3;

const error = (code: string, pt: string, en: string, status: 400 | 404 | 409 | 422 = 400) => new DeskError(code, pt, status, en);

export interface Alert {
  id: string; tipo: string; titulo: string; detalhe: Record<string, unknown>; estado: 'aberto' | 'resolvido' | 'ignorado';
  acao: string | null; pecaId: string | null; nota: string | null; porNome: string | null; resolvidoEm: string | null; criadoEm: string;
}

async function createAlert(env: Env, tenantId: string, textId: string, type: string, key: string, title: string, detail: Record<string, unknown>) {
  const r = await env.DB.prepare('INSERT OR IGNORE INTO alertas (id, tenant_id, texto_id, tipo, chave, titulo, detalhe_json) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(newId(), tenantId, textId, type, key, title.slice(0, 300), JSON.stringify(detail)).run();
  return r.meta.changes > 0;
}

/**
 * Alerts computed from what is already in the database: a source that changed (the current hash), a source that has
 * not answered for days, an LAI deadline close to or past due. Idempotent (the alert key does not repeat).
 */
export async function syncAlerts(env: Env, tenantId: string, textId: string) {
  const { results: evs } = await env.DB.prepare(
    `SELECT id, url, titulo, hash_atual, mudou_em, falhas FROM evidencias WHERE texto_id = ? AND tenant_id = ? AND origem = 'link' AND (mudou_em IS NOT NULL OR falhas >= ?)`,
  ).bind(textId, tenantId, FAILURES_OUTSIDE).all<{ id: string; url: string; titulo: string | null; hash_atual: string | null; mudou_em: string | null; falhas: number }>();
  for (const e of evs) {
    const name = e.titulo ?? new URL(e.url).hostname;
    if (e.mudou_em) await createAlert(env, tenantId, textId, 'fonte_mudou', `fonte:${e.id}:${e.hash_atual}`, name, { evidenciaId: e.id, url: e.url, em: e.mudou_em });
    if (e.falhas >= FAILURES_OUTSIDE) await createAlert(env, tenantId, textId, 'fonte_fora', `fora:${e.id}`, name, { evidenciaId: e.id, url: e.url, falhas: e.falhas });
  }
  const { results: lais } = await env.DB.prepare('SELECT id, orgao, esfera, protocolo, protocolado_em, prorrogado_em, resposta_em, atendeu, recurso_em, recurso_resposta_em, recurso_atendeu FROM pedidos_lai WHERE texto_id = ? AND tenant_id = ? AND protocolado_em IS NOT NULL')
    .bind(textId, tenantId).all<{ id: string; orgao: string; esfera: string; protocolo: string | null; protocolado_em: string; prorrogado_em: string | null; resposta_em: string | null; atendeu: number | null; recurso_em: string | null; recurso_resposta_em: string | null; recurso_atendeu: number | null }>();
  for (const p of lais) {
    const s = laiStatus(p);
    if (s.vencido && !p.recurso_em) await createAlert(env, tenantId, textId, 'lai_vencido', `lai:${p.id}:vencido:${s.prazoFinal}`, p.orgao, { pedidoId: p.id, protocolo: p.protocolo, prazo: s.prazoFinal, recorrerAte: s.recorrerAte });
    else if (s.diasRestantes !== null && s.diasRestantes >= 0 && s.diasRestantes <= 3) await createAlert(env, tenantId, textId, 'lai_vence', `lai:${p.id}:vence:${s.prazoFinal}`, p.orgao, { pedidoId: p.id, protocolo: p.protocolo, prazo: s.prazoFinal });
  }
}

/**
 * Daily cron: LAI deadlines for every outlet (the alert shows in the Texts list without the story being opened). Each
 * text goes as one queue message: the cron does not run everyone's queries in a single execution (Worker limit).
 */
export async function syncDeadlinesLai(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT tenant_id, texto_id FROM pedidos_lai WHERE protocolado_em IS NOT NULL
        AND ((resposta_em IS NULL AND recurso_em IS NULL) OR (recurso_em IS NOT NULL AND recurso_resposta_em IS NULL))`,
  ).all<{ tenant_id: string; texto_id: string }>();
  for (let i = 0; i < results.length; i += 100) {
    await env.MONITOR_QUEUE.sendBatch(results.slice(i, i + 100).map((r) => ({ body: { tipo: 'lai' as const, tenantId: r.tenant_id, textoId: r.texto_id } })));
  }
  return results.length;
}

export async function alertsText(env: Env, tenantId: string, textId: string): Promise<Alert[]> {
  await syncAlerts(env, tenantId, textId);
  const { results } = await env.DB.prepare(
    `SELECT a.*, u.name AS por_nome FROM alertas a LEFT JOIN "user" u ON u.id = a.resolvido_por WHERE a.texto_id = ? AND a.tenant_id = ?
      ORDER BY CASE a.estado WHEN 'aberto' THEN 0 ELSE 1 END, a.created_at DESC, a.rowid DESC LIMIT 200`,
  ).bind(textId, tenantId).all<{ id: string; tipo: string; titulo: string; detalhe_json: string; estado: string; acao: string | null; peca_id: string | null; nota: string | null; por_nome: string | null; resolvido_em: string | null; created_at: string }>();
  return results.map((a) => ({
    id: a.id, tipo: a.tipo, titulo: a.titulo, detalhe: JSON.parse(a.detalhe_json), estado: a.estado as Alert['estado'], acao: a.acao, pecaId: a.peca_id, nota: a.nota,
    porNome: a.por_nome, resolvidoEm: a.resolvido_em, criadoEm: a.created_at,
  }));
}

// ── people mentioned in new news ────────────────────────────────────────────────────────────────────────────────

const withoutAccent = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ');

/**
 * A new document from the outlet's sources (the monitor queue): each person mentioned (a name with two or more words)
 * in the outlet's stories from the last 180 days who appears in its title or text becomes an alert on the story.
 */
export async function alertsPeople(env: Env, tenantId: string, documentId: string) {
  const doc = await env.DB.prepare('SELECT id, url, titulo, r2_texto FROM documentos WHERE id = ? AND tenant_id = ?').bind(documentId, tenantId).first<{ id: string; url: string; titulo: string | null; r2_texto: string | null }>();
  if (!doc) return 0;
  const { results: texts } = await env.DB.prepare(
    `SELECT t.id, t.paragrafos_json FROM textos t JOIN tenants n ON n.id = t.tenant_id WHERE t.tenant_id = ? AND n.modo = 'autoral' AND t.updated_at >= datetime('now', '-180 days') LIMIT 200`,
  ).bind(tenantId).all<{ id: string; paragrafos_json: string }>();
  if (!texts.length) return 0;
  const body = withoutAccent(`${doc.titulo ?? ''} ${(doc.r2_texto ? await env.MEDIA.get(doc.r2_texto).then((o) => o?.text()) : '') ?? ''}`);
  let n = 0;
  for (const t of texts) {
    const paragraphs = (JSON.parse(t.paragrafos_json) as string[]).map((text, i) => ({ id: `p${i}`, texto: text }));
    for (const p of fromTextNames(paragraphs)) {
      if (p.tipo !== 'pessoa' || p.nome.split(/\s+/).length < 2) continue;
      if (!new RegExp(`(^|[^\\p{L}])${withoutAccent(p.nome).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'u').test(body)) continue;
      if (await createAlert(env, tenantId, t.id, 'pessoa', `pessoa:${doc.id}:${nameKey(p.nome)}`, p.nome, { nome: p.nome, documentoId: doc.id, url: doc.url, titulo: doc.titulo })) n++;
    }
  }
  return n;
}

// ── actions ─────────────────────────────────────────────────────────────────────────────────────────────────────

async function readAlert(env: Env, tenantId: string, textId: string, alertId: string) {
  const a = await env.DB.prepare('SELECT id, tipo, titulo, detalhe_json, estado FROM alertas WHERE id = ? AND texto_id = ? AND tenant_id = ?').bind(alertId, textId, tenantId).first<{ id: string; tipo: string; titulo: string; detalhe_json: string; estado: string }>();
  if (!a) throw error('nao_encontrado', 'não encontrado', 'not found', 404);
  return a;
}

/** "I updated the text" or "Ignore": closes the alert, with who and when. */
export async function resolveAlert(env: Env, tenantId: string, textId: string, alertId: string, actor: string, action: unknown) {
  await readText(env, tenantId, textId);
  const a = await readAlert(env, tenantId, textId, alertId);
  if (action !== 'texto_atualizado' && action !== 'ignorado') throw error('acao', 'Ação desconhecida.', 'Unknown action.', 422);
  if (a.estado !== 'aberto') throw error('fechado', 'Este alerta já foi tratado.', 'This alert has already been handled.', 409);
  await env.DB.prepare("UPDATE alertas SET estado = ?, acao = ?, resolvido_por = ?, resolvido_em = datetime('now') WHERE id = ? AND tenant_id = ?")
    .bind(action === 'ignorado' ? 'ignorado' : 'resolvido', action, actor, a.id, tenantId).run();
  await recordEvent(env, tenantId, 'materia.alerta', 'texto', textId, { alertaId: a.id, acao: action, por: actor });
}

/**
 * Update or Correction post from the alert: the person writes what changed (the note is theirs, it goes as the author's
 * claim) and the post comes out new, a single image, with the label on the headline. The earlier post is not touched.
 */
export async function postAlert(env: Env, tenantId: string, textId: string, alertId: string, actor: string, b: Record<string, unknown>) {
  const t = await readText(env, tenantId, textId);
  const a = await readAlert(env, tenantId, textId, alertId);
  if (a.estado !== 'aberto') throw error('fechado', 'Este alerta já foi tratado.', 'This alert has already been handled.', 409);
  const type = (POST_TYPES as readonly unknown[]).includes(b.tipo) ? (b.tipo as PostType) : null;
  if (!type) throw error('tipo', 'Escolha Atualização ou Errata.', 'Choose Update or Correction.', 422);
  const note = typeof b.nota === 'string' ? b.nota.replace(/\s+/g, ' ').trim() : '';
  if (note.length < 20 || note.length > 600) throw error('nota', 'Escreva o que mudou ou o que foi corrigido (20 a 600 caracteres).', 'Write what changed or what was corrected (20 to 600 characters).', 422);

  const leadId = newId();
  // Reserve the alert first (only one request gets past "aberto"): two simultaneous clicks do not make two posts.
  const reserved = await env.DB.prepare("UPDATE alertas SET estado = 'resolvido', acao = ?, nota = ?, pauta_id = NULL, resolvido_por = ?, resolvido_em = datetime('now') WHERE id = ? AND tenant_id = ? AND estado = 'aberto' RETURNING id")
    .bind(`post_${type}`, note, actor, a.id, tenantId).first<{ id: string }>();
  if (!reserved) throw error('fechado', 'Este alerta já foi tratado.', 'This alert has already been handled.', 409);
  try {
    return await createPostAlert(env, tenantId, textId, t, a.id, leadId, type, note, actor);
  } catch (e) {
    // The post did not go out: the alert goes back to open (the person sees the error and tries again). A lead whose
    // production never started is discarded; production that started (lead in production or done) is a real post, and
    // the alert stays. In a single transaction: the lead goes if it has not started, and the alert reopens only if the
    // lead does not exist or was just removed (someone who started production in the meantime holds the lead, and the
    // alert stays with it).
    await env.DB.batch([
      env.DB.prepare("UPDATE pautas SET status = 'descartada', updated_at = datetime('now') WHERE id = ? AND tenant_id = ? AND status IN ('sugerida', 'aceita')").bind(leadId, tenantId),
      env.DB.prepare(`UPDATE alertas SET estado = 'aberto', acao = NULL, nota = NULL, pauta_id = NULL, peca_id = NULL, resolvido_por = NULL, resolvido_em = NULL
                       WHERE id = ? AND tenant_id = ? AND (pauta_id IS NULL OR pauta_id = ?)
                         AND NOT EXISTS (SELECT 1 FROM pautas WHERE id = ? AND tenant_id = ? AND status != 'descartada')`)
        .bind(a.id, tenantId, leadId, leadId, tenantId),
    ]);
    throw e;
  }
}

async function createPostAlert(env: Env, tenantId: string, textId: string, t: Awaited<ReturnType<typeof readText>>, alertId: string, leadId: string, type: PostType, note: string, actor: string) {
  const brand = await env.DB.prepare('SELECT marca_json FROM tenants WHERE id = ?').bind(tenantId).first<{ marca_json: string | null }>();
  const authorUrl = t.docs_id ? fromDocUrl(t.docs_id) : (JSON.parse(brand?.marca_json ?? '{}') as { ctaUrl?: string }).ctaUrl ?? env.PUBLIC_BASE_URL;
  const docAuthor = newId();
  const factId = newId();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO documentos (id, tenant_id, fonte_id, url, hash_texto, titulo, r2_texto, status, triagem) VALUES (?, ?, NULL, ?, ?, ?, NULL, 'triado', 'autoral')`)
      .bind(docAuthor, tenantId, authorUrl, `correcao:${leadId}:autor`, t.titulo),
    env.DB.prepare(`INSERT INTO fatos (id, tenant_id, documento_id, tipo, texto, hash, confianca) VALUES (?, ?, ?, 'opiniao', ?, ?, 1)`)
      .bind(factId, tenantId, docAuthor, note, `correcao:${leadId}:nota`),
    env.DB.prepare(
      `INSERT INTO pautas (id, tenant_id, status, origem, titulo, resumo, fato_ids_json, documento_ids_json, score, texto_id, texto_versao, tipo_post)
       VALUES (?, ?, 'sugerida', 'manual', ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(leadId, tenantId, t.titulo, note, JSON.stringify([factId]), JSON.stringify([docAuthor]), scoreManual(new Date()), textId, t.versao, type),
    env.DB.prepare('UPDATE alertas SET pauta_id = ? WHERE id = ? AND tenant_id = ?').bind(leadId, alertId, tenantId),
  ]);
  const pieceId = (await produceLead(env, tenantId, leadId, actor, 'post', { semCota: true }))?.pecaId ?? null;   // a correction always goes out
  await env.DB.prepare('UPDATE alertas SET peca_id = ? WHERE id = ? AND tenant_id = ?').bind(pieceId, alertId, tenantId).run();
  await recordEvent(env, tenantId, 'materia.correcao', 'texto', textId, { alertaId: alertId, tipo: type, pautaId: leadId, pecaId: pieceId, por: actor });
  return { pautaId: leadId, pecaId: pieceId };
}

// ── processos (DataJud) ─────────────────────────────────────────────────────────────────────────────────────────

// CNJ unified number (Res. 65/2008): NNNNNNN-DD.AAAA.J.TR.OOOO. Only the masked format counts (a bare 20-digit number
// is something else), and the check digit must match (modulo 97).
const CNJ = /\b(\d{7})-(\d{2})\.(\d{4})\.(\d)\.(\d{2})\.(\d{4})\b/g;
const UFS = ['ac', 'al', 'ap', 'am', 'ba', 'ce', 'dft', 'es', 'go', 'ma', 'mt', 'ms', 'mg', 'pa', 'pb', 'pr', 'pe', 'pi', 'rj', 'rn', 'rs', 'ro', 'rr', 'sc', 'se', 'sp', 'to'];

export function digitCnjOk(n: string) {
  const [num, dv, year, j, tr, orig] = [n.slice(0, 7), n.slice(7, 9), n.slice(9, 13), n.slice(13, 14), n.slice(14, 16), n.slice(16, 20)];
  return 98n - (BigInt(`${num}${year}${j}${tr}${orig}00`) % 97n) === BigInt(dv);
}

/** The court's DataJud alias from the J.TR segment of the number (table from the DataJud wiki and CNJ Res. 65/2008). */
export function dataJudCourt(n: string): string | null {
  const j = n.slice(13, 14), tr = Number(n.slice(14, 16));
  if (tr === 0) return ({ '3': 'stj', '5': 'tst', '6': 'tse', '7': 'stm' } as Record<string, string>)[j] ?? null;
  if (j === '4' && tr <= 6) return `trf${tr}`;
  if (j === '5' && tr <= 24) return `trt${tr}`;
  if (j === '8' && tr <= 27) return `tj${UFS[tr - 1]}`;
  // In the Electoral courts the DF is tre-df (in the TJ it is tjdft).
  if (j === '6' && tr <= 27) return `tre-${UFS[tr - 1] === 'dft' ? 'df' : UFS[tr - 1]}`;
  if (j === '7') return 'stm';
  if (j === '9') return ({ 13: 'tjmmg', 21: 'tjmrs', 26: 'tjmsp' } as Record<number, string>)[tr] ?? null;
  return null;
}

/** Case numbers in the text (digits only), without repeats and with the right check digit. */
export function casesInText(paragraphs: string[]): string[] {
  const out = new Set<string>();
  for (const p of paragraphs) for (const m of p.matchAll(CNJ)) { const n = m.slice(1).join(''); if (digitCnjOk(n)) out.add(n); }
  return [...out];
}

export const dataJudEnabled = (env: Env) => !!env.DATAJUD_API_KEY;

/** The text's cases as they are now (creates rows for new numbers; the cron queries them). */
export async function casesText(env: Env, tenantId: string, textId: string, paragraphs: string[]) {
  const numbers = casesInText(paragraphs);
  if (numbers.length) {
    await env.DB.batch(numbers.map((n) => env.DB.prepare('INSERT OR IGNORE INTO processos (id, tenant_id, texto_id, numero, tribunal) VALUES (?, ?, ?, ?, ?)').bind(newId(), tenantId, textId, n, dataJudCourt(n))));
  }
  const { results } = await env.DB.prepare('SELECT numero, tribunal, ultimo_movimento, ultimo_movimento_em, consultado_em, erro FROM processos WHERE texto_id = ? AND tenant_id = ? ORDER BY created_at')
    .bind(textId, tenantId).all<{ numero: string; tribunal: string | null; ultimo_movimento: string | null; ultimo_movimento_em: string | null; consultado_em: string | null; erro: string | null }>();
  return {
    ligado: dataJudEnabled(env),
    lista: results.filter((p) => numbers.includes(p.numero)).map((p) => ({ numero: p.numero, tribunal: p.tribunal, ultimoMovimento: p.ultimo_movimento, ultimoMovimentoEm: p.ultimo_movimento_em, consultadoEm: p.consultado_em, erro: p.erro })),
  };
}

/** Daily cron: cases from stories of the last 180 days, queried more than 20 h ago, go to the queue. */
export async function enqueueCases(env: Env) {
  if (!dataJudEnabled(env)) return 0;
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

interface Motion { nome?: string; dataHora?: string }

/**
 * Queries the case on DataJud (the CNJ's public API; the key is the public one from the wiki, in DATAJUD_API_KEY). The
 * first query only stores the latest movement; a newer movement after that becomes an alert on the story.
 */
export async function queryCase(env: Env, tenantId: string, caseId: string) {
  const p = await env.DB.prepare('SELECT id, texto_id, numero, tribunal, ultimo_movimento_em FROM processos WHERE id = ? AND tenant_id = ?').bind(caseId, tenantId)
    .first<{ id: string; texto_id: string; numero: string; tribunal: string | null; ultimo_movimento_em: string | null }>();
  if (!p?.tribunal || !dataJudEnabled(env)) return;
  const base = env.DATAJUD_URL ?? 'https://api-publica.datajud.cnj.jus.br';
  let motions: Motion[];
  try {
    const r = await fetch(`${base}/api_publica_${p.tribunal}/_search`, {
      method: 'POST', signal: AbortSignal.timeout(20_000),
      headers: { 'content-type': 'application/json', authorization: `APIKey ${env.DATAJUD_API_KEY}` },
      body: JSON.stringify({ query: { match: { numeroProcesso: p.numero } }, size: 10 }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json<{ hits?: { hits?: { _source?: { movimentos?: Motion[] } }[] } }>();
    motions = (j.hits?.hits ?? []).flatMap((h) => h._source?.movimentos ?? []).filter((m) => m.dataHora && m.nome);
  } catch (e) {
    await env.DB.prepare("UPDATE processos SET erro = ?, consultado_em = datetime('now') WHERE id = ? AND tenant_id = ?").bind(String((e as Error).message ?? e).slice(0, 200), p.id, tenantId).run();
    return;
  }
  const last = motions.sort((a, b) => Date.parse(b.dataHora!) - Date.parse(a.dataHora!))[0];
  if (!last) {
    await env.DB.prepare("UPDATE processos SET erro = ?, consultado_em = datetime('now') WHERE id = ? AND tenant_id = ?").bind('o DataJud não achou o processo (ou ele é sigiloso)', p.id, tenantId).run();
    return;
  }
  const created = !!p.ultimo_movimento_em && Date.parse(last.dataHora!) > Date.parse(p.ultimo_movimento_em);
  // The alert before the advance: if storing the alert fails, the queue retries and the movement still counts as new
  // (the alert key prevents repeats).
  if (created) {
    await createAlert(env, tenantId, p.texto_id, 'processo', `processo:${p.numero}:${last.dataHora}`, p.numero, { numero: p.numero, tribunal: p.tribunal, movimento: last.nome, em: last.dataHora });
  }
  await env.DB.prepare("UPDATE processos SET ultimo_movimento = ?, ultimo_movimento_em = ?, erro = NULL, consultado_em = datetime('now') WHERE id = ? AND tenant_id = ?")
    .bind(last.nome, last.dataHora, p.id, tenantId).run();
}
