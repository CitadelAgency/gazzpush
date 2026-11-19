import { isLimit } from '../lib/plans';
import { analyzeItem, closeItem } from '../lib/xrayQueue';
import { issueCertificate, failCertificate } from '../lib/certificate';
import type { Env, MonitorMessage } from '../env';
import { newId, recordEvent, sha256Hex } from '../lib/db';
import { triageDocument } from '../lib/triage';
import { buildSummary } from '../lib/digest';
import { blocked, fetchWithBrowser } from '../lib/browser';
import { startAuthor } from '../lib/author';
import { checkEvidence } from '../lib/desk';
import { ATTEMPTS_QUEUE, processWayback } from '../lib/wayback';
import { BusyFile, WITHOUT_OWNER, processFile } from '../lib/document';
import { processRecording } from '../lib/recording';
import { closeSegment, processSegment } from '../lib/recordingSession';
import { closeNarration, processNarration } from '../lib/narration';
import { alertsPeople, queryCase, syncAlerts } from '../lib/living';

interface Source { id: string; tenant_id: string; tipo: string; url: string; etag: string | null; last_modified: string | null }

const MAX_ITEMS_PER_FETCH = 30;
export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Redacao/0.1';

// Queue consumer. 'fonte' = conditional fetch + RSS parse → new documents (each becomes a 'documento' message).
// 'documento' = full article + triage + facts + suggested lead.
export const queue: ExportedHandlerQueueHandler<Env, MonitorMessage> = async (batch, env) => {
  for (const msg of batch.messages) {
    const m = msg.body;
    try {
      if (m.tipo === 'fonte') await processSource(env, m);
      else if (m.tipo === 'resumo') await buildSummary(env, m.tenantId, m.dia).catch((e) => { if (!isLimit(e)) throw e; });   // at the plan limit, the lead stays in Ideas
      else if (m.tipo === 'autoral') await startAuthor(env, m);
      else if (m.tipo === 'evidencia') {
        // A re-read source becomes an alert on the story right away (changed, or stopped answering), without waiting for someone to open the text.
        const textId = await checkEvidence(env, m.tenantId, m.evidenciaId);
        if (textId) await syncAlerts(env, m.tenantId, textId);
      }
      else if (m.tipo === 'lai') await syncAlerts(env, m.tenantId, m.textoId);
      else if (m.tipo === 'certidao') await issueCertificate(env, m.tenantId, m.pecaId, true);
      else if (m.tipo === 'raiox') await analyzeItem(env, m.tenantId, m.itemId);
      else if (m.tipo === 'arquivo') await processFile(env, m.tenantId, m.arquivoId);
      else if (m.tipo === 'gravacao') await processRecording(env, m.tenantId, m.arquivoId);
      else if (m.tipo === 'segmento') await processSegment(env, m.tenantId, m.arquivoId, m.n);
      else if (m.tipo === 'narracao') await processNarration(env, m.tenantId, m.narracaoId);
      else if (m.tipo === 'processo') await queryCase(env, m.tenantId, m.processoId);
      else if (m.tipo === 'wayback') {
        // Capture still running: back to the queue in a minute (not an error; the "pendente" state is already on screen).
        if ((await processWayback(env, m.tenantId, m.evidenciaId, msg.attempts)) === 'pendente') { msg.retry({ delaySeconds: 60 }); continue; }
      }
      else {
        await triageDocument(env, m.tenantId, m.documentoId);
        // Living story: a person mentioned in one of the outlet's stories who appears in this document becomes an alert. On
        // failure the message goes back to the queue (the triage already done does not run again; the alert has a key and does not repeat).
        await alertsPeople(env, m.tenantId, m.documentoId);
      }
      msg.ack();
    } catch (e) {
      const ref = m.tipo === 'certidao' ? m.pecaId : m.tipo === 'raiox' ? m.itemId : m.tipo === 'fonte' ? m.fonteId : m.tipo === 'autoral' || m.tipo === 'resumo' ? m.tenantId : m.tipo === 'evidencia' || m.tipo === 'wayback' ? m.evidenciaId : m.tipo === 'arquivo' || m.tipo === 'gravacao' || m.tipo === 'segmento' ? m.arquivoId : m.tipo === 'processo' ? m.processoId : m.tipo === 'lai' ? m.textoId : m.tipo === 'narracao' ? m.narracaoId : m.documentoId;
      // Recording the failure does not bring the batch down (database unavailable): the ack or retry decision below still applies.
      await (async () => {
        if (m.tipo === 'fonte') await env.DB.prepare("UPDATE fontes SET falhas = falhas + 1, ultimo_fetch_at = datetime('now') WHERE id = ?").bind(ref).run();
        await recordEvent(env, m.tenantId, `${m.tipo}.erro`, m.tipo === 'autoral' ? 'tenant' : m.tipo === 'certidao' ? 'peca' : m.tipo, ref, { erro: String(e), tentativa: msg.attempts });
      })().catch((x) => console.error('failure record', ref, String(x)));
      // Last delivery of a Story message: the failure and its reason go where the screen reads the state (not "lendo"
      // forever), and only then does the message leave the queue. If recording the failure did not work, or the type has
      // nowhere to record it: the message goes on to the dead-letter queue (the last delivery's retry), with the error in the event.
      if (msg.attempts >= ATTEMPTS_QUEUE) {
        if (CLOSES.has(m.tipo)) {
          try { if (await closeWithFailure(env, m, String((e as Error)?.message ?? e))) { msg.ack(); continue; } }
          catch (x) { console.error('encerrarComFalha', ref, String(x)); }
        }
        // No outcome recorded here: the message goes to the dead-letter queue. A file another delivery still held stays with
        // it; if that one also died, the 15-minute cron closes it as "falhou" (encerrarArquivosParados).
        msg.retry();
      } else msg.retry({ delaySeconds: e instanceof BusyFile ? 660 : 300 });   // busy: after ownership expires
    }
  }
};

const CLOSES = new Set<MonitorMessage['tipo']>(['arquivo', 'gravacao', 'segmento', 'narracao', 'wayback', 'processo', 'certidao', 'raiox']);

/**
 * The final failure of a Story message, recorded where the screen reads the state. `true`: there is an outcome (recorded
 * now, or the file had already finished). A file another delivery is still reading (ownership within its time) stays
 * with it: `false`, no outcome from here.
 */
async function closeWithFailure(env: Env, m: MonitorMessage, error: string): Promise<boolean> {
  const reason = `falhou depois de ${ATTEMPTS_QUEUE} tentativas (${error.slice(0, 200)})`;
  if (m.tipo === 'certidao') {
    await failCertificate(env, m.tenantId, m.pecaId, reason);
  } else if (m.tipo === 'raiox') {
    await closeItem(env, m.tenantId, m.itemId);
  } else if (m.tipo === 'segmento') {
    await closeSegment(env, m.tenantId, m.arquivoId, m.n, reason);
  } else if (m.tipo === 'narracao') {
    await closeNarration(env, m.tenantId, m.narracaoId, reason);
  } else if (m.tipo === 'arquivo' || m.tipo === 'gravacao') {
    const r = await env.DB.prepare(`UPDATE arquivos SET estado = 'falhou', erro = ?, processando_em = NULL WHERE id = ? AND tenant_id = ? AND estado = 'lendo' AND ${WITHOUT_OWNER}`).bind(reason, m.arquivoId, m.tenantId).run();
    if (r.meta.changes) return true;
    const now = await env.DB.prepare('SELECT estado FROM arquivos WHERE id = ? AND tenant_id = ?').bind(m.arquivoId, m.tenantId).first<{ estado: string }>();
    return now?.estado !== 'lendo';
  } else if (m.tipo === 'wayback') {
    await env.DB.prepare("UPDATE evidencias SET wayback_estado = 'falhou', wayback_erro = ? WHERE id = ? AND tenant_id = ? AND wayback_estado = 'pendente'").bind(reason, m.evidenciaId, m.tenantId).run();
  } else if (m.tipo === 'processo') {
    await env.DB.prepare("UPDATE processos SET erro = ?, consultado_em = datetime('now') WHERE id = ? AND tenant_id = ?").bind(reason, m.processoId, m.tenantId).run();
  }
  return true;
}

export async function processSource(env: Env, { fonteId: sourceId, tenantId }: Extract<MonitorMessage, { tipo: 'fonte' }>) {
  const source = await env.DB.prepare('SELECT id, tenant_id, tipo, url, etag, last_modified FROM fontes WHERE id = ? AND tenant_id = ?')
    .bind(sourceId, tenantId).first<Source>();
  if (!source?.url) return;

  // City halls block user agents with "bot". Honest identification without the word.
  const headers: Record<string, string> = { 'user-agent': UA, accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/html;q=0.8, */*;q=0.5' };
  if (source.etag) headers['if-none-match'] = source.etag;
  if (source.last_modified) headers['if-modified-since'] = source.last_modified;
  const res = await fetch(source.url, { headers, signal: AbortSignal.timeout(20_000) });

  if (res.status === 304) {
    await env.DB.prepare("UPDATE fontes SET ultimo_fetch_at = datetime('now'), falhas = 0, via_navegador = 0 WHERE id = ?").bind(source.id).run();
    return;
  }
  // A WAF that blocks fetch (A Tribuna, Diário do Litoral): one attempt through the browser. If that also fails → source failure.
  let content: string;
  let viaBrowser = 0;
  if (!res.ok && blocked(res.status) && source.tipo !== 'manual') {
    await res.body?.cancel();
    const nav = await fetchWithBrowser(env, source.url).catch((e) => { throw new Error(`HTTP ${res.status}; navegador: ${String(e)}`); });
    if (nav.status < 200 || nav.status >= 300) throw new Error(`HTTP ${res.status}; navegador: HTTP ${nav.status}`);
    content = nav.corpo;
    viaBrowser = 1;
  } else {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    content = await res.text();
  }

  // An HTML page without a feed = 1 item (the URL itself). Useful for a city hall's "latest" page; triage extracts the article.
  // Big feeds (G1 sends 100): only the most recent per fetch; the rest comes in later rounds if still new.
  const items = source.tipo === 'rss' ? parseRss(content).slice(0, MAX_ITEMS_PER_FETCH) : [{ url: source.url, titulo: null, publicadoEm: null }];
  const created: MonitorMessage[] = [];
  for (const item of items) {
    const id = newId();
    // Provisional hash from the URL; triage replaces it with the extracted text's hash.
    const r = await env.DB.prepare(
      'INSERT OR IGNORE INTO documentos (id, tenant_id, fonte_id, url, hash_texto, titulo, publicado_em) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(id, tenantId, source.id, item.url, `url:${await sha256Hex(item.url)}`, item.titulo, item.publicadoEm).run();
    if (r.meta.changes) created.push({ tipo: 'documento', tenantId, documentoId: id });
  }
  for (let i = 0; i < created.length; i += 100) await env.MONITOR_QUEUE.sendBatch(created.slice(i, i + 100).map((body) => ({ body })));

  // Through the browser there is no reliable validator from the original response: no etag/last-modified (the next one comes whole).
  await env.DB.prepare("UPDATE fontes SET ultimo_fetch_at = datetime('now'), etag = ?, last_modified = ?, falhas = 0, via_navegador = ? WHERE id = ?")
    .bind(viaBrowser ? null : res.headers.get('etag'), viaBrowser ? null : res.headers.get('last-modified'), viaBrowser, source.id).run();
  env.METRICS.writeDataPoint({ blobs: [tenantId, 'fonte.fetch', source.id], doubles: [created.length], indexes: [tenantId] });
}

// Minimal RSS/Atom, no dependency. Enough for city halls, regional G1 and blogs. A blocked feed (403/429) → Browser Rendering (src/lib/browser.ts).
export function parseRss(xml: string) {
  const items: { url: string; titulo: string | null; publicadoEm: string | null }[] = [];
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];
  for (const b of blocks) {
    const tag = (n: string) => {
      const m = b.match(new RegExp(`<${n}\\b[^>]*>([\\s\\S]*?)<\\/${n}>`, 'i'));
      return m ? decode(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').trim()) : null;
    };
    const link = tag('link') ?? b.match(/<link\b[^>]*href="([^"]+)"/i)?.[1] ?? null;
    if (!link) continue;
    const data = tag('pubDate') ?? tag('published') ?? tag('updated') ?? tag('dc:date');
    const ts = data ? Date.parse(data) : NaN;
    items.push({ url: link, titulo: tag('title'), publicadoEm: Number.isFinite(ts) ? new Date(ts).toISOString() : null });
  }
  return items;
}

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
