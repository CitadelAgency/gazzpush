import { ehLimite } from '../lib/planos';
import { analisarItem, encerrarItem } from '../lib/raioxFila';
import { emitirCertidao, falharCertidao } from '../lib/certidao';
import type { Env, MonitorMessage } from '../env';
import { novoId, registrarEvento, sha256Hex } from '../lib/db';
import { triarDocumento } from '../lib/triagem';
import { montarResumo } from '../lib/resumo';
import { bloqueado, buscarComNavegador } from '../lib/navegador';
import { iniciarAutoral } from '../lib/autoral';
import { conferirEvidencia } from '../lib/mesa';
import { TENTATIVAS_FILA, processarWayback } from '../lib/wayback';
import { ArquivoOcupado, SEM_DONO, processarArquivo } from '../lib/documento';
import { processarGravacao } from '../lib/gravacao';
import { encerrarSegmento, processarSegmento } from '../lib/gravacaoSessao';
import { encerrarNarracao, processarNarracao } from '../lib/narracao';
import { alertasDePessoas, consultarProcesso, sincronizarAlertas } from '../lib/viva';

interface Fonte { id: string; tenant_id: string; tipo: string; url: string; etag: string | null; last_modified: string | null }

const MAX_ITENS_POR_FETCH = 30;
export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Redacao/0.1';

// Consumidor da fila. 'fonte' = fetch condicional + parse RSS → documentos novos (cada um vira mensagem 'documento').
// 'documento' = artigo completo + triagem + fatos + pauta sugerida.
export const queue: ExportedHandlerQueueHandler<Env, MonitorMessage> = async (batch, env) => {
  for (const msg of batch.messages) {
    const m = msg.body;
    try {
      if (m.tipo === 'fonte') await processarFonte(env, m);
      else if (m.tipo === 'resumo') await montarResumo(env, m.tenantId, m.dia).catch((e) => { if (!ehLimite(e)) throw e; });   // no limite do plano, a pauta fica em Ideias
      else if (m.tipo === 'autoral') await iniciarAutoral(env, m);
      else if (m.tipo === 'evidencia') {
        // A fonte relida já vira alerta na matéria (mudou, ou parou de responder), sem esperar alguém abrir o texto.
        const textoId = await conferirEvidencia(env, m.tenantId, m.evidenciaId);
        if (textoId) await sincronizarAlertas(env, m.tenantId, textoId);
      }
      else if (m.tipo === 'lai') await sincronizarAlertas(env, m.tenantId, m.textoId);
      else if (m.tipo === 'certidao') await emitirCertidao(env, m.tenantId, m.pecaId, true);
      else if (m.tipo === 'raiox') await analisarItem(env, m.tenantId, m.itemId);
      else if (m.tipo === 'arquivo') await processarArquivo(env, m.tenantId, m.arquivoId);
      else if (m.tipo === 'gravacao') await processarGravacao(env, m.tenantId, m.arquivoId);
      else if (m.tipo === 'segmento') await processarSegmento(env, m.tenantId, m.arquivoId, m.n);
      else if (m.tipo === 'narracao') await processarNarracao(env, m.tenantId, m.narracaoId);
      else if (m.tipo === 'processo') await consultarProcesso(env, m.tenantId, m.processoId);
      else if (m.tipo === 'wayback') {
        // Captura ainda rodando: volta para a fila em um minuto (não é erro; o estado "pendente" já está na tela).
        if ((await processarWayback(env, m.tenantId, m.evidenciaId, msg.attempts)) === 'pendente') { msg.retry({ delaySeconds: 60 }); continue; }
      }
      else {
        await triarDocumento(env, m.tenantId, m.documentoId);
        // Matéria viva: pessoa citada numa matéria do veículo que aparece neste documento vira alerta. Falhou: a mensagem
        // volta para a fila (a triagem já feita não roda de novo; o alerta tem chave e não repete).
        await alertasDePessoas(env, m.tenantId, m.documentoId);
      }
      msg.ack();
    } catch (e) {
      const ref = m.tipo === 'certidao' ? m.pecaId : m.tipo === 'raiox' ? m.itemId : m.tipo === 'fonte' ? m.fonteId : m.tipo === 'autoral' || m.tipo === 'resumo' ? m.tenantId : m.tipo === 'evidencia' || m.tipo === 'wayback' ? m.evidenciaId : m.tipo === 'arquivo' || m.tipo === 'gravacao' || m.tipo === 'segmento' ? m.arquivoId : m.tipo === 'processo' ? m.processoId : m.tipo === 'lai' ? m.textoId : m.tipo === 'narracao' ? m.narracaoId : m.documentoId;
      // O registro da falha não derruba o lote (banco fora): a decisão de ack ou retry abaixo vale assim mesmo.
      await (async () => {
        if (m.tipo === 'fonte') await env.DB.prepare("UPDATE fontes SET falhas = falhas + 1, ultimo_fetch_at = datetime('now') WHERE id = ?").bind(ref).run();
        await registrarEvento(env, m.tenantId, `${m.tipo}.erro`, m.tipo === 'autoral' ? 'tenant' : m.tipo === 'certidao' ? 'peca' : m.tipo, ref, { erro: String(e), tentativa: msg.attempts });
      })().catch((x) => console.error('registro da falha', ref, String(x)));
      // Última entrega de uma mensagem da Matéria: a falha e o motivo ficam onde a tela lê o estado (não "lendo" para
      // sempre), e só então a mensagem sai da fila. Gravar a falha não deu, ou o tipo não tem onde gravar: a mensagem
      // segue para a fila morta (o retry da última entrega), com o erro registrado no evento.
      if (msg.attempts >= TENTATIVAS_FILA) {
        if (ENCERRA.has(m.tipo)) {
          try { if (await encerrarComFalha(env, m, String((e as Error)?.message ?? e))) { msg.ack(); continue; } }
          catch (x) { console.error('encerrarComFalha', ref, String(x)); }
        }
        // Sem desfecho gravado aqui: a mensagem vai para a fila morta. O arquivo que outra entrega ainda tinha fica com
        // ela; se ela também morreu, o cron de 15 minutos fecha como "falhou" (encerrarArquivosParados).
        msg.retry();
      } else msg.retry({ delaySeconds: e instanceof ArquivoOcupado ? 660 : 300 });   // ocupado: depois que a posse vence
    }
  }
};

const ENCERRA = new Set<MonitorMessage['tipo']>(['arquivo', 'gravacao', 'segmento', 'narracao', 'wayback', 'processo', 'certidao', 'raiox']);

/**
 * A falha definitiva de uma mensagem da Matéria, gravada onde a tela lê o estado. `true`: há desfecho (gravado agora, ou
 * o arquivo já tinha terminado). O arquivo que outra entrega ainda está lendo (posse dentro do prazo) fica com ela:
 * `false`, sem desfecho daqui.
 */
async function encerrarComFalha(env: Env, m: MonitorMessage, erro: string): Promise<boolean> {
  const motivo = `falhou depois de ${TENTATIVAS_FILA} tentativas (${erro.slice(0, 200)})`;
  if (m.tipo === 'certidao') {
    await falharCertidao(env, m.tenantId, m.pecaId, motivo);
  } else if (m.tipo === 'raiox') {
    await encerrarItem(env, m.tenantId, m.itemId);
  } else if (m.tipo === 'segmento') {
    await encerrarSegmento(env, m.tenantId, m.arquivoId, m.n, motivo);
  } else if (m.tipo === 'narracao') {
    await encerrarNarracao(env, m.tenantId, m.narracaoId, motivo);
  } else if (m.tipo === 'arquivo' || m.tipo === 'gravacao') {
    const r = await env.DB.prepare(`UPDATE arquivos SET estado = 'falhou', erro = ?, processando_em = NULL WHERE id = ? AND tenant_id = ? AND estado = 'lendo' AND ${SEM_DONO}`).bind(motivo, m.arquivoId, m.tenantId).run();
    if (r.meta.changes) return true;
    const agora = await env.DB.prepare('SELECT estado FROM arquivos WHERE id = ? AND tenant_id = ?').bind(m.arquivoId, m.tenantId).first<{ estado: string }>();
    return agora?.estado !== 'lendo';
  } else if (m.tipo === 'wayback') {
    await env.DB.prepare("UPDATE evidencias SET wayback_estado = 'falhou', wayback_erro = ? WHERE id = ? AND tenant_id = ? AND wayback_estado = 'pendente'").bind(motivo, m.evidenciaId, m.tenantId).run();
  } else if (m.tipo === 'processo') {
    await env.DB.prepare("UPDATE processos SET erro = ?, consultado_em = datetime('now') WHERE id = ? AND tenant_id = ?").bind(motivo, m.processoId, m.tenantId).run();
  }
  return true;
}

export async function processarFonte(env: Env, { fonteId, tenantId }: Extract<MonitorMessage, { tipo: 'fonte' }>) {
  const fonte = await env.DB.prepare('SELECT id, tenant_id, tipo, url, etag, last_modified FROM fontes WHERE id = ? AND tenant_id = ?')
    .bind(fonteId, tenantId).first<Fonte>();
  if (!fonte?.url) return;

  // Prefeituras bloqueiam UA com "bot". Identificação honesta sem a palavra.
  const headers: Record<string, string> = { 'user-agent': UA, accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/html;q=0.8, */*;q=0.5' };
  if (fonte.etag) headers['if-none-match'] = fonte.etag;
  if (fonte.last_modified) headers['if-modified-since'] = fonte.last_modified;
  const res = await fetch(fonte.url, { headers, signal: AbortSignal.timeout(20_000) });

  if (res.status === 304) {
    await env.DB.prepare("UPDATE fontes SET ultimo_fetch_at = datetime('now'), falhas = 0, via_navegador = 0 WHERE id = ?").bind(fonte.id).run();
    return;
  }
  // WAF que barra o fetch (A Tribuna, Diário do Litoral): uma tentativa pelo navegador. Falhou também → falha da fonte.
  let corpo: string;
  let viaNavegador = 0;
  if (!res.ok && bloqueado(res.status) && fonte.tipo !== 'manual') {
    await res.body?.cancel();
    const nav = await buscarComNavegador(env, fonte.url).catch((e) => { throw new Error(`HTTP ${res.status}; navegador: ${String(e)}`); });
    if (nav.status < 200 || nav.status >= 300) throw new Error(`HTTP ${res.status}; navegador: HTTP ${nav.status}`);
    corpo = nav.corpo;
    viaNavegador = 1;
  } else {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    corpo = await res.text();
  }

  // Página HTML sem feed = 1 item (a própria URL). Útil pra "últimas" de prefeitura; a triagem extrai o artigo.
  // Feeds grandes (G1 manda 100): só os mais recentes por fetch; o resto entra nas próximas rodadas se ainda for novo.
  const itens = fonte.tipo === 'rss' ? parseRss(corpo).slice(0, MAX_ITENS_POR_FETCH) : [{ url: fonte.url, titulo: null, publicadoEm: null }];
  const novos: MonitorMessage[] = [];
  for (const item of itens) {
    const id = novoId();
    // Hash provisório pela URL; a triagem troca pelo hash do texto extraído.
    const r = await env.DB.prepare(
      'INSERT OR IGNORE INTO documentos (id, tenant_id, fonte_id, url, hash_texto, titulo, publicado_em) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(id, tenantId, fonte.id, item.url, `url:${await sha256Hex(item.url)}`, item.titulo, item.publicadoEm).run();
    if (r.meta.changes) novos.push({ tipo: 'documento', tenantId, documentoId: id });
  }
  for (let i = 0; i < novos.length; i += 100) await env.MONITOR_QUEUE.sendBatch(novos.slice(i, i + 100).map((body) => ({ body })));

  // Pelo navegador não há validador confiável do response original: sem etag/last-modified (a próxima vem inteira).
  await env.DB.prepare("UPDATE fontes SET ultimo_fetch_at = datetime('now'), etag = ?, last_modified = ?, falhas = 0, via_navegador = ? WHERE id = ?")
    .bind(viaNavegador ? null : res.headers.get('etag'), viaNavegador ? null : res.headers.get('last-modified'), viaNavegador, fonte.id).run();
  env.METRICS.writeDataPoint({ blobs: [tenantId, 'fonte.fetch', fonte.id], doubles: [novos.length], indexes: [tenantId] });
}

// RSS/Atom mínimo, sem dependência. Suficiente pra prefeitura, G1 regional e blogs. Feed barrado (403/429) → Browser Rendering (src/lib/navegador.ts).
export function parseRss(xml: string) {
  const itens: { url: string; titulo: string | null; publicadoEm: string | null }[] = [];
  const blocos = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];
  for (const b of blocos) {
    const tag = (n: string) => {
      const m = b.match(new RegExp(`<${n}\\b[^>]*>([\\s\\S]*?)<\\/${n}>`, 'i'));
      return m ? decode(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').trim()) : null;
    };
    const link = tag('link') ?? b.match(/<link\b[^>]*href="([^"]+)"/i)?.[1] ?? null;
    if (!link) continue;
    const data = tag('pubDate') ?? tag('published') ?? tag('updated') ?? tag('dc:date');
    const ts = data ? Date.parse(data) : NaN;
    itens.push({ url: link, titulo: tag('title'), publicadoEm: Number.isFinite(ts) ? new Date(ts).toISOString() : null });
  }
  return itens;
}

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
