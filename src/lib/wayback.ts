import type { Env } from '../env';

/**
 * A copy of each dossier link on the Wayback Machine (Save Page Now), through the monitor queue. Without a key: the
 * public `GET /save/<url>`, which answers with the capture's address (low limit, a few per minute). With
 * `WAYBACK_ACCESS_KEY` and `WAYBACK_SECRET` (archive.org S3 keys): the SPN2 API, which returns a job and its state. A
 * failure is stored with the technical reason (HTTP 429, error:blocked…), in view in the dossier; a slow capture goes
 * back to the queue.
 */
export const baseWayback = (env: Env) => (env.WAYBACK_URL || 'https://web.archive.org').replace(/\/$/, '');

/** "20261103000211" → ISO. */
export function fromTimestampHour(ts: string): string | null {
  const m = ts.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : null;
}

/** The capture's address: `<base>/web/<timestamp>/<url>`. */
export function captureOf(location: string): { url: string; em: string } | null {
  const m = location.match(/\/web\/(\d{14})[a-z_]*\/(.+)$/);
  const at = m ? fromTimestampHour(m[1]) : null;
  return m && at ? { url: location, em: at } : null;
}

/**
 * Queue attempts (wrangler.jsonc: max_retries 3, that is, four deliveries). On the last one, a capture that has not come
 * back yet becomes "falhou" with the reason (and the try-again button), instead of going silently to the dead-letter queue.
 */
export const ATTEMPTS_QUEUE = 4;
const MAX_ATTEMPTS = ATTEMPTS_QUEUE;

type Result = 'feito' | 'pendente';

/** Processes one piece of evidence's copy. 'pendente': the capture is still running (the queue retries in a minute). */
export async function processWayback(env: Env, tenantId: string, evidenceId: string, attempt = 1): Promise<Result> {
  const ev = await env.DB.prepare("SELECT id, url, wayback_estado, wayback_job FROM evidencias WHERE id = ? AND tenant_id = ? AND origem = 'link'")
    .bind(evidenceId, tenantId).first<{ id: string; url: string; wayback_estado: string | null; wayback_job: string | null }>();
  if (!ev || ev.wayback_estado === 'salvo') return 'feito';
  const base = baseWayback(env);
  const record = (fields: { estado: string; url?: string | null; em?: string | null; job?: string | null; erro?: string | null }) => env.DB.prepare(
    'UPDATE evidencias SET wayback_estado = ?, wayback_url = ?, wayback_em = ?, wayback_job = ?, wayback_erro = ? WHERE id = ? AND tenant_id = ?',
  ).bind(fields.estado, fields.url ?? null, fields.em ?? null, fields.job ?? null, fields.erro ?? null, ev.id, tenantId).run();
  const failed = async (error: string) => { await record({ estado: 'falhou', erro: error.slice(0, 300) }); return 'feito' as const; };

  const key = env.WAYBACK_ACCESS_KEY && env.WAYBACK_SECRET ? `LOW ${env.WAYBACK_ACCESS_KEY}:${env.WAYBACK_SECRET}` : null;
  try {
    if (!key) {
      // Public: Wayback saves and redirects to the capture.
      const r = await fetch(`${base}/save/${ev.url}`, { redirect: 'manual', signal: AbortSignal.timeout(120_000) });
      const loc = r.headers.get('location') ?? r.headers.get('content-location');
      await r.body?.cancel();
      const cap = loc ? captureOf(new URL(loc, base).toString()) : null;
      if (cap) { await record({ estado: 'salvo', url: cap.url, em: cap.em }); return 'feito'; }
      if (r.status === 429 || r.status >= 500) return attempt >= MAX_ATTEMPTS ? failed(`HTTP ${r.status}`) : 'pendente';
      return failed(`HTTP ${r.status}`);
    }

    // SPN2: requests once (the job is stored) and follows its state.
    let job = ev.wayback_job;
    if (!job) {
      const r = await fetch(`${base}/save`, {
        method: 'POST', headers: { accept: 'application/json', authorization: key, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ url: ev.url, skip_first_archive: '1' }), signal: AbortSignal.timeout(30_000),
      });
      const j = await r.json<{ job_id?: string; message?: string }>().catch(() => ({} as { job_id?: string; message?: string }));
      if (r.status === 429) return attempt >= MAX_ATTEMPTS ? failed('HTTP 429') : 'pendente';
      if (!r.ok || !j.job_id) return failed(j.message ?? `HTTP ${r.status}`);
      job = j.job_id;
      await record({ estado: 'pendente', job });
    }
    for (let i = 0; i < 6; i++) {
      const r = await fetch(`${base}/save/status/${job}`, { headers: { accept: 'application/json', authorization: key }, signal: AbortSignal.timeout(20_000) });
      const s = await r.json<{ status?: string; timestamp?: string; original_url?: string; message?: string; status_ext?: string }>().catch(() => ({} as Record<string, string | undefined>));
      if (s.status === 'success' && s.timestamp) {
        await record({ estado: 'salvo', url: `${base}/web/${s.timestamp}/${s.original_url ?? ev.url}`, em: fromTimestampHour(s.timestamp), job });
        return 'feito';
      }
      if (s.status === 'error') return failed(s.status_ext ?? s.message ?? 'error');
      await new Promise((ok) => setTimeout(ok, 10_000));
    }
    return attempt >= MAX_ATTEMPTS ? failed('timeout') : 'pendente';
  } catch (e) {
    return attempt >= MAX_ATTEMPTS ? failed(String(e).slice(0, 160)) : 'pendente';
  }
}

/**
 * Puts the evidence on the Wayback queue (pending state right away, so the screen says "saving to Wayback"). If the
 * queue did not accept it: it becomes "falhou" with the reason, and the try-again button appears (nothing stays pending
 * without a job).
 */
export async function enqueueWayback(env: Env, tenantId: string, evidenceId: string) {
  await env.DB.prepare("UPDATE evidencias SET wayback_estado = 'pendente', wayback_erro = NULL, wayback_job = NULL WHERE id = ? AND tenant_id = ? AND origem = 'link'")
    .bind(evidenceId, tenantId).run();
  try {
    await env.MONITOR_QUEUE.send({ tipo: 'wayback', tenantId, evidenciaId: evidenceId });
  } catch (e) {
    await env.DB.prepare("UPDATE evidencias SET wayback_estado = 'falhou', wayback_erro = ? WHERE id = ? AND tenant_id = ?")
      .bind(`não entrou na fila (${String((e as Error).message ?? e).slice(0, 160)})`, evidenceId, tenantId).run();
  }
}
