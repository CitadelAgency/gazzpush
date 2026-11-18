import type { Env } from '../env';

/**
 * Cópia de cada link do dossiê no Wayback Machine (Save Page Now), pela fila do monitor. Sem chave: o `GET /save/<url>`
 * público, que responde com o endereço da captura (limite baixo, poucas por minuto). Com `WAYBACK_ACCESS_KEY` e
 * `WAYBACK_SECRET` (chaves S3 do archive.org): a API SPN2, que devolve um job e o estado dele. A falha fica gravada com
 * o motivo técnico (HTTP 429, error:blocked…), à vista no dossiê; captura que demora volta para a fila.
 */
export const baseWayback = (env: Env) => (env.WAYBACK_URL || 'https://web.archive.org').replace(/\/$/, '');

/** "20261103000211" → ISO. */
export function horaDoTimestamp(ts: string): string | null {
  const m = ts.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : null;
}

/** Endereço da captura: `<base>/web/<timestamp>/<url>`. */
export function capturaDe(location: string): { url: string; em: string } | null {
  const m = location.match(/\/web\/(\d{14})[a-z_]*\/(.+)$/);
  const em = m ? horaDoTimestamp(m[1]) : null;
  return m && em ? { url: location, em } : null;
}

/**
 * Tentativas da fila (wrangler.jsonc: max_retries 3, ou seja, quatro entregas). Na última, a captura que ainda não
 * voltou fica "falhou" com o motivo (e o botão de tentar de novo), em vez de ir calada para a fila de mensagens mortas.
 */
export const TENTATIVAS_FILA = 4;
const MAX_TENTATIVAS = TENTATIVAS_FILA;

type Resultado = 'feito' | 'pendente';

/** Processa a cópia de uma evidência. 'pendente': a captura ainda roda (a fila tenta de novo em um minuto). */
export async function processarWayback(env: Env, tenantId: string, evidenciaId: string, tentativa = 1): Promise<Resultado> {
  const ev = await env.DB.prepare("SELECT id, url, wayback_estado, wayback_job FROM evidencias WHERE id = ? AND tenant_id = ? AND origem = 'link'")
    .bind(evidenciaId, tenantId).first<{ id: string; url: string; wayback_estado: string | null; wayback_job: string | null }>();
  if (!ev || ev.wayback_estado === 'salvo') return 'feito';
  const base = baseWayback(env);
  const gravar = (campos: { estado: string; url?: string | null; em?: string | null; job?: string | null; erro?: string | null }) => env.DB.prepare(
    'UPDATE evidencias SET wayback_estado = ?, wayback_url = ?, wayback_em = ?, wayback_job = ?, wayback_erro = ? WHERE id = ? AND tenant_id = ?',
  ).bind(campos.estado, campos.url ?? null, campos.em ?? null, campos.job ?? null, campos.erro ?? null, ev.id, tenantId).run();
  const falhou = async (erro: string) => { await gravar({ estado: 'falhou', erro: erro.slice(0, 300) }); return 'feito' as const; };

  const chave = env.WAYBACK_ACCESS_KEY && env.WAYBACK_SECRET ? `LOW ${env.WAYBACK_ACCESS_KEY}:${env.WAYBACK_SECRET}` : null;
  try {
    if (!chave) {
      // Público: o Wayback salva e redireciona para a captura.
      const r = await fetch(`${base}/save/${ev.url}`, { redirect: 'manual', signal: AbortSignal.timeout(120_000) });
      const loc = r.headers.get('location') ?? r.headers.get('content-location');
      await r.body?.cancel();
      const cap = loc ? capturaDe(new URL(loc, base).toString()) : null;
      if (cap) { await gravar({ estado: 'salvo', url: cap.url, em: cap.em }); return 'feito'; }
      if (r.status === 429 || r.status >= 500) return tentativa >= MAX_TENTATIVAS ? falhou(`HTTP ${r.status}`) : 'pendente';
      return falhou(`HTTP ${r.status}`);
    }

    // SPN2: pede uma vez (o job fica gravado) e acompanha o estado.
    let job = ev.wayback_job;
    if (!job) {
      const r = await fetch(`${base}/save`, {
        method: 'POST', headers: { accept: 'application/json', authorization: chave, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ url: ev.url, skip_first_archive: '1' }), signal: AbortSignal.timeout(30_000),
      });
      const j = await r.json<{ job_id?: string; message?: string }>().catch(() => ({} as { job_id?: string; message?: string }));
      if (r.status === 429) return tentativa >= MAX_TENTATIVAS ? falhou('HTTP 429') : 'pendente';
      if (!r.ok || !j.job_id) return falhou(j.message ?? `HTTP ${r.status}`);
      job = j.job_id;
      await gravar({ estado: 'pendente', job });
    }
    for (let i = 0; i < 6; i++) {
      const r = await fetch(`${base}/save/status/${job}`, { headers: { accept: 'application/json', authorization: chave }, signal: AbortSignal.timeout(20_000) });
      const s = await r.json<{ status?: string; timestamp?: string; original_url?: string; message?: string; status_ext?: string }>().catch(() => ({} as Record<string, string | undefined>));
      if (s.status === 'success' && s.timestamp) {
        await gravar({ estado: 'salvo', url: `${base}/web/${s.timestamp}/${s.original_url ?? ev.url}`, em: horaDoTimestamp(s.timestamp), job });
        return 'feito';
      }
      if (s.status === 'error') return falhou(s.status_ext ?? s.message ?? 'error');
      await new Promise((ok) => setTimeout(ok, 10_000));
    }
    return tentativa >= MAX_TENTATIVAS ? falhou('timeout') : 'pendente';
  } catch (e) {
    return tentativa >= MAX_TENTATIVAS ? falhou(String(e).slice(0, 160)) : 'pendente';
  }
}

/**
 * Põe a evidência na fila do Wayback (estado pendente na hora, para a tela dizer "salvando no Wayback"). A fila não
 * aceitou: fica "falhou" com o motivo, e o botão de tentar de novo aparece (nada fica pendente sem tarefa).
 */
export async function enfileirarWayback(env: Env, tenantId: string, evidenciaId: string) {
  await env.DB.prepare("UPDATE evidencias SET wayback_estado = 'pendente', wayback_erro = NULL, wayback_job = NULL WHERE id = ? AND tenant_id = ? AND origem = 'link'")
    .bind(evidenciaId, tenantId).run();
  try {
    await env.MONITOR_QUEUE.send({ tipo: 'wayback', tenantId, evidenciaId });
  } catch (e) {
    await env.DB.prepare("UPDATE evidencias SET wayback_estado = 'falhou', wayback_erro = ? WHERE id = ? AND tenant_id = ?")
      .bind(`não entrou na fila (${String((e as Error).message ?? e).slice(0, 160)})`, evidenciaId, tenantId).run();
  }
}
