import { todayIso } from './lai';
import PostalMime from 'postal-mime';
import { strToU8, zipSync } from 'fflate';
import type { Env } from '../env';
import { newId, recordEvent, sha256Hex } from './db';
import { DeskError, readText } from './desk';
import { MEANS_OTHER_SIDE, RISKS_OTHER_SIDE } from './reporting';
import { analyze, strengthEvidence, recordReporting, type Analysis } from './assistant';
import { requireChecklist, factsAnalysis } from './story';
import { requestTimestamp, TimestampError } from './timestamp';
import { baseWayback } from './wayback';
import { retractVersion } from './versions';

export { retractVersion as retratarVersao };

// The Story's legal shield (Phase 4): an other-side request with a deadline and a recorded time, the reply in the
// dossier, a snapshot of each version that matters, the defence package (a zip with a hash manifest and an RFC 3161
// timestamp) and the public sources page ("How we reported this"). No AI here: it is all records and code.

export const MEANS_REQUEST = ['email', 'copiado'] as const;
export type HalfRequest = (typeof MEANS_REQUEST)[number];

const error = (code: string, pt: string, en: string, status: 400 | 404 | 409 | 422 | 502 = 400) => new DeskError(code, pt, status, en);
const now = () => new Date().toISOString();

// ── other-side request ─────────────────────────────────────────────────────────────────────────────────────────

export const emailOn = (env: Env) => !!(env.EMAIL && env.EMAIL_REMETENTE && env.EMAIL_REMETENTE.includes('@'));
const EMAIL_OK = /^[^\s@<>()]{1,64}@[^\s@<>()]+\.[^\s@<>()]{2,}$/;

export interface RequestEntry {
  id: string; blocoId: string | null; trecho: string | null; paraNome: string; paraEmail: string | null; assunto: string; corpo: string; prazo: string;
  meio: HalfRequest; canal: string | null; enviadoEm: string | null; registradoEm: string; erro: string | null; por: string | null; porNome: string | null;
  respostaEm: string | null; respostaEvidenciaId: string | null; vencido: boolean;
}

export async function requestsText(env: Env, tenantId: string, textId: string): Promise<RequestEntry[]> {
  const { results } = await env.DB.prepare(
    `SELECT p.*, u.name AS por_nome FROM pedidos_outro_lado p LEFT JOIN "user" u ON u.id = p.por
      WHERE p.texto_id = ? AND p.tenant_id = ? ORDER BY p.created_at, p.rowid`,
  ).bind(textId, tenantId).all<Record<string, string | null>>();
  const already = Date.now();
  return results.map((p) => ({
    id: p.id!, blocoId: p.bloco_id, trecho: p.trecho, paraNome: p.para_nome!, paraEmail: p.para_email, assunto: p.assunto!, corpo: p.corpo!, prazo: p.prazo!,
    meio: p.meio as HalfRequest, canal: p.canal, enviadoEm: p.enviado_em, registradoEm: p.created_at!, erro: p.erro, por: p.por, porNome: p.por_nome,
    respostaEm: p.resposta_em, respostaEvidenciaId: p.resposta_evidencia_id, vencido: !p.resposta_em && Date.parse(p.prazo!) < already,
  }));
}

const text = (v: unknown, min: number, max: number) => typeof v === 'string' && v.trim().length >= min && v.trim().length <= max ? v.trim() : null;

/**
 * Asks the other side. `meio: 'email'`: the app sends it through Email Service (server time; the reply comes back to
 * outro-lado+token@ the sender's domain). `meio: 'copiado'`: the person copied it and sent it elsewhere, and says when and
 * through what (`enviadoEm`, `canal`). If the request concerns a sentence (block and literal passage, checked here), the
 * risky sentence gets "other side contacted" recorded.
 */
export async function createRequest(env: Env, tenantId: string, textId: string, actor: { id: string; nome: string }, b: Record<string, unknown>) {
  const t = await readText(env, tenantId, textId);
  const toName = text(b.paraNome, 2, 200);
  if (!toName) throw error('para', 'Diga quem você está procurando (nome ou cargo).', 'Say who you are contacting (name or title).');
  const subject = text(b.assunto, 3, 200);
  if (!subject) throw error('assunto', 'Escreva o assunto do pedido.', 'Write the subject of the request.');
  const body = text(b.corpo, 20, 8000);
  if (!body) throw error('corpo', 'Escreva o pedido (as perguntas e o que a matéria afirma).', 'Write the request (the questions and what the story says).');
  const deadline = typeof b.prazo === 'string' ? Date.parse(b.prazo) : NaN;
  if (!Number.isFinite(deadline) || deadline <= Date.now() || deadline > Date.now() + 60 * 86_400_000) throw error('prazo', 'O prazo é uma data e hora entre agora e daqui a 60 dias.', 'The deadline is a date and time between now and 60 days from now.');
  if (!(MEANS_REQUEST as readonly unknown[]).includes(b.meio)) throw error('meio', `meio: um de ${MEANS_REQUEST.join(', ')}`, `meio: one of ${MEANS_REQUEST.join(', ')}`);
  const half = b.meio as HalfRequest;
  const toEmail = typeof b.paraEmail === 'string' && b.paraEmail.trim() ? b.paraEmail.trim() : null;
  if (toEmail && !EMAIL_OK.test(toEmail)) throw error('email', 'Esse e-mail não parece válido.', "That e-mail doesn't look valid.");

  // The sentence the request concerns: the passage must be, letter for letter, in the paragraph (checked by code).
  let blockId: string | null = null, passage: string | null = null;
  if (b.blocoId !== undefined && b.blocoId !== null) {
    const an = await analyze(env, tenantId, textId, t);
    const block = an.est.blocos.find((x) => x.id === b.blocoId);
    if (!block || typeof b.trecho !== 'string' || !b.trecho.trim() || !block.texto.includes(b.trecho)) throw error('trecho_fora', 'Esse trecho não está no parágrafo. Escolha a frase de novo.', "That passage isn't in the paragraph. Choose the sentence again.", 422);
    // The request closes the sentence's risk only if the sentence was sent: it must be, letter for letter, in the request's text.
    const joins = (s: string) => s.replace(/\s+/g, ' ').trim();
    if (!joins(body).includes(joins(b.trecho))) throw error('trecho_fora_do_pedido', 'O pedido não cita a frase escolhida. Ponha a frase no texto do pedido ou escolha "Nenhuma frase específica".', 'The request does not quote the chosen sentence. Put the sentence in the request or choose "No specific sentence".', 422);
    blockId = block.id; passage = b.trecho;
  }

  let channel: string | null = null, sentAt: string | null = null;
  if (half === 'copiado') {
    const at = typeof b.enviadoEm === 'string' ? Date.parse(b.enviadoEm) : NaN;
    if (!Number.isFinite(at) || at > Date.now() + 120_000) throw error('enviado', 'Diga quando você mandou o pedido (não pode ser no futuro).', 'Say when you sent the request (it cannot be in the future).');
    if (!(MEANS_OTHER_SIDE as readonly unknown[]).includes(b.canal)) throw error('canal', `canal: um de ${MEANS_OTHER_SIDE.join(', ')}`, `canal: one of ${MEANS_OTHER_SIDE.join(', ')}`);
    channel = b.canal as string; sentAt = new Date(at).toISOString();
  } else {
    if (!emailOn(env)) throw error('email_desligado', 'O envio por e-mail não está configurado. Copie o pedido e mande por fora.', 'Sending by e-mail is not set up. Copy the request and send it yourself.', 409);
    if (!toEmail) throw error('email', 'Diga o e-mail de quem você está procurando.', 'Give the e-mail of the person you are contacting.');
  }

  const id = newId();
  const token = [...crypto.getRandomValues(new Uint8Array(12))].map((x) => x.toString(16).padStart(2, '0')).join('');
  await env.DB.prepare(
    `INSERT INTO pedidos_outro_lado (id, tenant_id, texto_id, bloco_id, trecho, para_nome, para_email, assunto, corpo, prazo, meio, canal, enviado_em, token, por)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, tenantId, textId, blockId, passage, toName, toEmail, subject, body, new Date(deadline).toISOString(), half, channel, sentAt, token, actor.id).run();

  let failure: string | null = null;
  if (half === 'email') {
    const sender = env.EMAIL_REMETENTE!;
    const domain = sender.split('@')[1];
    const outlet = await env.DB.prepare('SELECT nome FROM tenants WHERE id = ?').bind(tenantId).first<{ nome: string }>();
    try {
      const r = await env.EMAIL!.send({
        from: { email: sender, name: `${actor.nome} · ${outlet?.nome ?? ''}`.slice(0, 120) },
        to: toEmail!,
        replyTo: `outro-lado+${token}@${domain}`,
        subject: subject,
        text: body,
      });
      sentAt = now();
      await env.DB.prepare('UPDATE pedidos_outro_lado SET enviado_em = ?, message_id = ? WHERE id = ? AND tenant_id = ?').bind(sentAt, r.messageId, id, tenantId).run();
    } catch (e) {
      failure = `${(e as { code?: string }).code ?? 'erro'}: ${String((e as Error).message ?? e).slice(0, 200)}`;
      await env.DB.prepare('UPDATE pedidos_outro_lado SET erro = ? WHERE id = ? AND tenant_id = ?').bind(failure, id, tenantId).run();
    }
  }

  // A request that went out and concerns a risky sentence: the sentence gets "other side contacted" (who, when, means).
  if (sentAt && blockId && passage) {
    const a = await env.DB.prepare('SELECT id, risco FROM afirmacoes WHERE texto_id = ? AND tenant_id = ? AND bloco_id = ? AND trecho = ?')
      .bind(textId, tenantId, blockId, passage).first<{ id: string; risco: string | null }>();
    const decided = await env.DB.prepare('SELECT 1 FROM apuracoes WHERE texto_id = ? AND tenant_id = ? AND bloco_id = ? AND trecho = ? AND desfeita_em IS NULL')
      .bind(textId, tenantId, blockId, passage).first();
    if (a && (RISKS_OTHER_SIDE as readonly (string | null)[]).includes(a.risco) && !decided) {
      await recordReporting(env, tenantId, textId, actor.id, { afirmacaoId: a.id, tipo: 'outro_lado', quem: toName, quando: todayIso(new Date(sentAt)), meio: half === 'email' ? 'email' : channel });
    }
  }
  await recordEvent(env, tenantId, 'outro_lado.pedido', 'texto', textId, { pedidoId: id, meio: half, enviadoEm: sentAt, erro: failure, por: actor.id });
  return { id, erro: failure };
}

/**
 * The other side's reply enters the dossier as evidence (origin `resposta`, primary source): the check starts seeing it
 * and the defence package carries it. By email (the address with the token) or pasted by hand by whoever received it.
 */
export async function recordAnswer(env: Env, tenantId: string, requestId: string, content: string, receivedAt: string, from: string | null) {
  const p = await env.DB.prepare('SELECT id, texto_id, para_nome FROM pedidos_outro_lado WHERE id = ? AND tenant_id = ?').bind(requestId, tenantId)
    .first<{ id: string; texto_id: string; para_nome: string }>();
  if (!p) throw error('nao_encontrado', 'não encontrado', 'not found', 404);
  const id = newId();
  const key = `evidencias/${tenantId}/${id}.txt`;
  const body = content.replace(/\r\n?/g, '\n').trim();
  await env.MEDIA.put(key, body, { httpMetadata: { contentType: 'text/plain; charset=utf-8' } });
  const hash = await sha256Hex(body);
  const data = receivedAt.slice(0, 10);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO evidencias (id, tenant_id, texto_id, url, titulo, r2_texto, hash, hash_atual, tipo_fonte, origem) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'primaria', 'resposta')`,
    ).bind(id, tenantId, p.texto_id, `resposta:${requestId}:${id}`, `Resposta de ${p.para_nome} (${data})${from ? ` · ${from}` : ''}`.slice(0, 300), key, hash, hash),
    env.DB.prepare('UPDATE pedidos_outro_lado SET resposta_em = ?, resposta_evidencia_id = ? WHERE id = ? AND tenant_id = ?').bind(receivedAt, id, requestId, tenantId),
    env.DB.prepare("UPDATE textos SET updated_at = datetime('now') WHERE id = ? AND tenant_id = ?").bind(p.texto_id, tenantId),
  ]);
  await recordEvent(env, tenantId, 'outro_lado.resposta', 'texto', p.texto_id, { pedidoId: requestId, evidenciaId: id, de: from });
  return { evidenciaId: id, textoId: p.texto_id };
}

export async function manualAnswer(env: Env, tenantId: string, textId: string, requestId: string, b: Record<string, unknown>) {
  await readText(env, tenantId, textId);
  const ok = await env.DB.prepare('SELECT 1 FROM pedidos_outro_lado WHERE id = ? AND texto_id = ? AND tenant_id = ?').bind(requestId, textId, tenantId).first();
  if (!ok) throw error('nao_encontrado', 'não encontrado', 'not found', 404);
  const content = text(b.texto, 2, 50_000);
  if (!content) throw error('resposta', 'Cole a resposta que você recebeu.', 'Paste the reply you received.');
  const at = typeof b.recebidaEm === 'string' ? Date.parse(b.recebidaEm) : NaN;
  if (!Number.isFinite(at) || at > Date.now() + 120_000) throw error('recebida', 'Diga quando a resposta chegou (não pode ser no futuro).', 'Say when the reply arrived (it cannot be in the future).');
  return recordAnswer(env, tenantId, requestId, content, new Date(at).toISOString(), null);
}

/** The Worker's `email` handler (Email Routing): outro-lado+<token>@… becomes the reply to the request. Unknown token: refused. */
export async function receiveEmail(message: ForwardableEmailMessage, env: Env) {
  const token = message.to.toLowerCase().match(/^outro-lado\+([0-9a-f]{24})@/)?.[1];
  const p = token ? await env.DB.prepare('SELECT id, tenant_id FROM pedidos_outro_lado WHERE token = ?').bind(token).first<{ id: string; tenant_id: string }>() : null;
  if (!p) { message.setReject('Endereço desconhecido.'); return; }
  const read = await PostalMime.parse(message.raw);
  const body = read.text?.trim() || (read.html ?? '').replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').trim();
  await recordAnswer(env, p.tenant_id, p.id, `${read.subject ? `Assunto: ${read.subject}\n\n` : ''}${body || '(mensagem sem texto)'}`, now(), message.from);
}

// ── public sources page ────────────────────────────────────────────────────────────────────────────────────────

export interface ContentPage {
  veiculo: string; idioma: 'pt-BR' | 'en'; titulo: string; versao: number; publicadaEm: string; conferidaEm: string | null;
  frases: { texto: string; fonte: number; trecho: string }[];
  opinioes: string[];
  fontes: { n: number; titulo: string; url: string; wayback: string | null; tipo: string | null }[];
}

/** What goes public: only sourced sentences (the literal passage), marked opinion and the source list with links and Wayback. */
export function contentPage(an: Analysis, outlet: string, language: 'pt-BR' | 'en'): ContentPage {
  const { comFonte: withSource, minhas: my } = factsAnalysis(an);
  const evs = new Map(an.evidencias.map((e) => [e.id, e]));
  const order: string[] = [];
  const sentences: ContentPage['frases'] = [];
  for (const f of withSource) {
    const e = evs.get(f.evidenciaId);
    if (!e || e.origem === 'resposta') continue;   // the other side's reply does not go public
    if (!order.includes(e.id)) order.push(e.id);
    sentences.push({ texto: f.trecho, fonte: order.indexOf(e.id) + 1, trecho: f.evidenciaTrecho });
  }
  return {
    veiculo: outlet, idioma: language, titulo: an.t.titulo, versao: an.t.versao, publicadaEm: now(), conferidaEm: an.t.conferido_em,
    frases: sentences, opinioes: my.map((m) => m.trecho),
    fontes: order.map((id, i) => {
      const e = evs.get(id)!;
      return { n: i + 1, titulo: e.titulo ?? new URL(e.url).hostname, url: e.origem === 'link' ? e.url : '', wayback: e.wayback?.estado === 'salvo' ? e.wayback.url : null, tipo: strengthEvidence(e).tipoFonte };
    }),
  };
}

export const pageUrl = (env: Env, id: string) => `${env.PUBLIC_BASE_URL.replace(/\/$/, '')}/fontes/${id}`;

export async function inArPage(env: Env, tenantId: string, textId: string) {
  const p = await env.DB.prepare(
    `SELECT p.id, p.versao, p.created_at, u.name AS por FROM paginas_fontes p LEFT JOIN "user" u ON u.id = p.por
      WHERE p.texto_id = ? AND p.tenant_id = ? AND p.retirada_em IS NULL ORDER BY p.created_at DESC, p.rowid DESC LIMIT 1`,
  ).bind(textId, tenantId).first<{ id: string; versao: number; created_at: string; por: string | null }>();
  return p ? { id: p.id, url: pageUrl(env, p.id), versao: p.versao, em: p.created_at, por: p.por } : null;
}

/** Publishes the page for the checked version (the checklist gates it as for Instagram). Publishing again takes the previous one down. */
export async function publishPage(env: Env, tenantId: string, textId: string, version: unknown, actor: string) {
  const t = await readText(env, tenantId, textId);
  if (version !== t.versao) throw error('versao', 'O texto mudou desde que você abriu. Recarregue e publique de novo.', 'The text changed since you opened it. Reload and publish again.', 409);
  if (t.conferido_versao !== t.versao) throw error('nao_conferido', 'Confira esta versão antes de publicar a página de fontes.', 'Check this version before publishing the sources page.', 409);
  const an = await analyze(env, tenantId, textId, t);
  requireChecklist(an);
  const tenant = await env.DB.prepare('SELECT nome, idioma FROM tenants WHERE id = ?').bind(tenantId).first<{ nome: string; idioma: string | null }>();
  const content = contentPage(an, tenant?.nome ?? '', tenant?.idioma === 'en' ? 'en' : 'pt-BR');
  if (!content.frases.length) throw error('sem_fatos', 'Nenhuma frase do texto tem fonte no dossiê: a página de fontes ficaria vazia.', 'No sentence in the text has a source in the dossier: the sources page would be empty.', 422);
  const id = [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(36).padStart(2, '0')).join('').slice(0, 26);
  await env.DB.batch([
    env.DB.prepare("UPDATE paginas_fontes SET retirada_em = datetime('now'), retirada_por = ? WHERE texto_id = ? AND tenant_id = ? AND retirada_em IS NULL").bind(actor, textId, tenantId),
    env.DB.prepare('INSERT INTO paginas_fontes (id, tenant_id, texto_id, versao, conteudo_json, por) VALUES (?, ?, ?, ?, ?, ?)').bind(id, tenantId, textId, t.versao, JSON.stringify(content), actor),
  ]);
  await retractVersion(env, tenantId, t, 'pagina_fontes');
  await recordEvent(env, tenantId, 'materia.pagina_fontes', 'texto', textId, { por: actor, paginaId: id, versao: t.versao, assinada: an.assinatura?.id ?? null });
  return { id, url: pageUrl(env, id) };
}

export async function removePage(env: Env, tenantId: string, textId: string, actor: string): Promise<boolean> {
  await readText(env, tenantId, textId);
  const r = await env.DB.prepare("UPDATE paginas_fontes SET retirada_em = datetime('now'), retirada_por = ? WHERE texto_id = ? AND tenant_id = ? AND retirada_em IS NULL")
    .bind(actor, textId, tenantId).run();
  if (r.meta.changes) await recordEvent(env, tenantId, 'materia.pagina_fontes.retirada', 'texto', textId, { por: actor });
  return r.meta.changes > 0;
}

const h = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const safeLink = (u: string) => (/^https?:\/\//i.test(u) ? h(u) : '#');

const PUBLIC_TYPE: Record<string, [string, string]> = {
  oficial: ['documento oficial', 'official document'], primaria: ['fonte primária', 'primary source'],
  materia: ['outra reportagem', 'another story'], anonima: ['fonte anônima', 'anonymous source'],
};

/** The public page (Worker HTML, without the app): reading only, nothing internal. */
export function htmlPage(c: ContentPage): string {
  const en = c.idioma === 'en';
  const tr = (pt: string, ing: string) => (en ? ing : pt);
  const data = (iso: string) => new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`).toLocaleDateString(en ? 'en-US' : 'pt-BR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
  const sentences = c.frases.map((f) => `<li><p class="frase">${h(f.texto)} <a class="ref" href="#fonte-${f.fonte}" aria-label="${tr('fonte', 'source')} ${f.fonte}">[${f.fonte}]</a></p><p class="trecho"><span class="rot">${tr('o que a fonte diz', 'what the source says')}</span> “${h(f.trecho)}”</p></li>`).join('');
  const opinions = c.opinioes.length ? `<section aria-labelledby="op"><h2 id="op">${tr('Opinião do autor', "The author's opinion")}</h2><p class="apoio">${tr('Estas frases são opinião de quem escreve, não fato apurado.', 'These sentences are the writer’s opinion, not reported fact.')}</p><ul>${c.opinioes.map((o) => `<li>${h(o)}</li>`).join('')}</ul></section>` : '';
  const sources = c.fontes.map((f) => `<li id="fonte-${f.n}"><span class="n">[${f.n}]</span> ${f.url ? `<a href="${safeLink(f.url)}" rel="noopener">${h(f.titulo)}</a>` : `${h(f.titulo)} <span class="mono">${tr('documento', 'document')}</span>`}${f.tipo && PUBLIC_TYPE[f.tipo] ? ` <span class="mono">${tr(...PUBLIC_TYPE[f.tipo])}</span>` : ''}${f.wayback ? ` · <a href="${safeLink(f.wayback)}" rel="noopener">${tr('cópia no Wayback Machine', 'copy on the Wayback Machine')}</a>` : ''}</li>`).join('');
  return `<!DOCTYPE html>
<html lang="${en ? 'en' : 'pt-BR'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${h(tr('Como apuramos', 'How we reported this'))}: ${h(c.titulo)}</title>
<style>
:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#F7F9FA;color:#2A2D33;font:400 17px/1.6 "Atkinson Hyperlegible Next",system-ui,sans-serif}
main{max-width:680px;margin:0 auto;padding:40px 20px 64px}h1{font-size:30px;line-height:1.2;margin:4px 0 8px;color:#15171B}h2{font-size:19px;margin:36px 0 10px;color:#15171B}
.mono{font-family:"Fragment Mono",ui-monospace,monospace;font-size:13px;letter-spacing:.02em;color:#5A5E66}.apoio{color:#5A5E66;margin:0 0 12px}
ul,ol{list-style:none;margin:0;padding:0}li{margin:0 0 14px}.frase{margin:0 0 6px;color:#15171B}.trecho{margin:0;background:#E0F0E6;padding:8px 12px;border-radius:4px;font-size:15px}
.rot{display:block;font-family:"Fragment Mono",ui-monospace,monospace;font-size:12px;color:#17663F;text-transform:uppercase;letter-spacing:.06em}
a{color:#0B5CC4;text-underline-offset:2px}.n{font-family:"Fragment Mono",ui-monospace,monospace;color:#5A5E66}
section{border-top:1px solid rgb(21 23 27 / .11);margin-top:28px}footer{margin-top:40px;color:#5A5E66;font-size:14px}
</style></head><body><main>
<p class="mono">${h(c.veiculo)} · ${h(tr('Como apuramos', 'How we reported this'))}</p>
<h1>${h(c.titulo)}</h1>
<p class="apoio">${h(tr(`De onde veio cada frase com fonte deste texto, com o trecho literal da fonte. Publicada em ${data(c.publicadaEm)}, da versão ${c.versao}.`, `Where each sourced sentence in this piece came from, with the source's literal passage. Published on ${data(c.publicadaEm)}, from version ${c.versao}.`))}</p>
<section aria-labelledby="fr"><h2 id="fr">${tr('Frases e fontes', 'Sentences and sources')}</h2><ol>${sentences}</ol></section>
${opinions}
<section aria-labelledby="fo"><h2 id="fo">${tr('Fontes', 'Sources')}</h2><ol>${sources}</ol></section>
<footer>${h(tr('Frase sem fonte no dossiê não aparece aqui. Viu um erro? Escreva para o veículo.', 'A sentence without a source in the dossier does not appear here. Spotted an error? Write to the outlet.'))}</footer>
</main></body></html>`;
}

export async function publicPage(env: Env, id: string): Promise<string | null> {
  if (!/^[a-z0-9]{10,40}$/.test(id)) return null;
  const p = await env.DB.prepare('SELECT conteudo_json FROM paginas_fontes WHERE id = ? AND retirada_em IS NULL').bind(id).first<{ conteudo_json: string }>();
  return p ? htmlPage(JSON.parse(p.conteudo_json) as ContentPage) : null;
}

// ── sheet for the lawyer ────────────────────────────────────────────────────

/** The sheet is short: the full reply stays in the defence package. */
const SHEET_ANSWER_MAX = 600;

const RISK_NAME: Record<string, [string, string]> = {
  acusacao_sem_condenacao: ['acusação sem condenação nem fonte oficial', 'accusation with no conviction or official source'],
  vitima_ou_menor: ['nome de vítima ou de menor de idade', 'name of a victim or a minor'],
  sem_outro_lado: ['acusação sem registro de que o citado foi procurado', 'accusation with no record that the person named was asked for comment'],
};

export interface ItemSheet {
  trecho: string; risco: string;
  evidencias: { titulo: string; url: string | null; trecho: string }[];
  outroLado: { para: string; meio: string; em: string | null; prazo: string | null; resposta: string | null; respostaTexto: string | null }[];
}
export interface Sheet { idioma: 'pt-BR' | 'en'; veiculo: string; titulo: string; versao: number; sha256: string; geradaEm: string; itens: ItemSheet[] }

/**
 * An extract of the check for someone reading with a legal eye: only the sentences with a risk mark, the risk type, the
 * evidence and the other side. The model's note does not go in, and nothing is rewritten or suggested. Evidence only
 * with a passage that really is in the source.
 */
export async function dataSheet(env: Env, tenantId: string, textId: string): Promise<Sheet> {
  const t = await readText(env, tenantId, textId);
  if (t.conferido_versao !== t.versao) throw error('nao_conferido', 'Confira esta versão antes de gerar a folha.', 'Check this version before making the sheet.', 409);
  const an = await analyze(env, tenantId, textId, t);
  const requests = await requestsText(env, tenantId, textId);
  const tenant = await env.DB.prepare('SELECT nome FROM tenants WHERE id = ?').bind(tenantId).first<{ nome: string }>();
  const en = an.idioma === 'en';
  const source = (id: string | null) => an.evidencias.find((e) => e.id === id) ?? null;
  const items: ItemSheet[] = an.afirmacoes.filter((a) => a.estado === 'risco').map((a) => {
    const found = [[a.evidenciaId, a.evidenciaTrecho], [a.apuracao?.evidenciaId ?? null, a.apuracao?.evidenciaTrecho ?? null]] as const;
    const evidence = found.flatMap(([id, passage]) => {
      const e = source(id);
      return e && passage && e.texto.includes(passage) ? [{ titulo: e.titulo ?? e.url, url: e.url || null, trecho: passage }] : [];
    });
    const his = requests.filter((p) => p.blocoId === a.blocoId && (!p.trecho || p.trecho === a.trecho || a.trecho.includes(p.trecho)));
    // The request already closes the reporting with who, when and means: a reporting entry only goes in when the contact was recorded by hand, without a request.
    const recorded = !his.length && a.apuracao?.outroLado ? [{ para: a.apuracao.outroLado.quem, meio: a.apuracao.outroLado.meio, em: a.apuracao.outroLado.quando, prazo: null, resposta: null, respostaTexto: null }] : [];
    return {
      trecho: a.trecho, risco: (RISK_NAME[a.risco ?? ''] ?? [a.risco ?? '', a.risco ?? ''])[en ? 1 : 0],
      evidencias: [...new Map(evidence.map((x) => [`${x.url}|${x.trecho}`, x])).values()],
      outroLado: [...his.map((p) => ({ para: p.paraNome, meio: p.canal ?? p.meio, em: p.enviadoEm, prazo: p.prazo, resposta: p.respostaEm, respostaTexto: source(p.respostaEvidenciaId)?.texto.slice(0, SHEET_ANSWER_MAX) ?? null })), ...recorded],
    };
  });
  const content = `${t.titulo}\n\n${(JSON.parse(t.paragrafos_json) as string[]).join('\n\n')}\n`;
  return { idioma: an.idioma, veiculo: tenant?.nome ?? '', titulo: t.titulo, versao: t.versao, sha256: await sha256Bytes(strToU8(content)), geradaEm: now(), itens: items };
}

export function htmlSheet(f: Sheet): string {
  const en = f.idioma === 'en';
  const tr = (pt: string, ing: string) => (en ? ing : pt);
  const data = (s: string | null) => (s ? new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`).toLocaleDateString(en ? 'en-US' : 'pt-BR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' }) : tr('sem data', 'no date'));
  const items = f.itens.map((i) => `<li><p class="frase">${h(i.trecho)}</p>
<p class="rot">${h(tr('Risco', 'Risk'))}</p><p>${h(i.risco)}</p>
<p class="rot">${h(tr('Evidência', 'Evidence'))}</p>${i.evidencias.length
    ? i.evidencias.map((e) => `<p class="trecho">${h(e.trecho)}</p><p class="ref">${h(e.titulo)}${e.url ? ` · ${e.url.startsWith('http') ? `<a href="${safeLink(e.url)}">${h(e.url)}</a>` : h(e.url)}` : ''}</p>`).join('')
    : `<p>${h(tr('Sem evidência registrada.', 'No evidence recorded.'))}</p>`}
<p class="rot">${h(tr('Outro lado', 'Other side'))}</p>${i.outroLado.length
    ? i.outroLado.map((o) => `<p>${h(tr(`Procurado: ${o.para}, por ${o.meio}, em ${data(o.em)}.`, `Contacted: ${o.para}, by ${o.meio}, on ${data(o.em)}.`))} ${o.resposta ? h(tr(`Resposta em ${data(o.resposta)}${o.respostaTexto ? `: ${o.respostaTexto}` : ''}.`, `Reply on ${data(o.resposta)}${o.respostaTexto ? `: ${o.respostaTexto}` : ''}.`)) : h(tr('Sem resposta registrada.', 'No reply recorded.'))}</p>`).join('')
    : `<p>${h(tr('Sem registro de contato.', 'No contact recorded.'))}</p>`}</li>`).join('\n');
  return `<!DOCTYPE html>
<html lang="${f.idioma}"><head><meta charset="utf-8"><title>${h(tr('Folha para o advogado', 'Sheet for the lawyer'))}</title>
<style>
*{box-sizing:border-box}body{margin:0;padding:44px;color:#2A2D33;font:400 14px/1.5 system-ui,sans-serif}h1{font-size:24px;line-height:1.2;margin:0 0 4px;color:#15171B}p{margin:0 0 6px}.apoio{color:#5A5E66}
ol{margin:20px 0 0;padding:0;list-style:none}li{border-top:1px solid #D5D8DC;padding:12px 0;break-inside:avoid}.frase{font-size:15px;font-weight:700;color:#15171B}.rot{margin:8px 0 2px;font:12px ui-monospace,monospace;text-transform:uppercase;letter-spacing:.06em;color:#5A5E66}
.trecho{background:#EEF0F2;padding:6px 10px}.ref{color:#5A5E66;font-size:13px}a{color:inherit;word-break:break-all}.h{font:12px ui-monospace,monospace;word-break:break-all}.nota{margin-top:18px;color:#5A5E66;font-size:13px}
</style></head><body><main>
<h1>${h(tr('Folha para o advogado', 'Sheet for the lawyer'))}</h1>
<p class="apoio">${h(f.veiculo)} · ${h(f.titulo)}</p>
<p class="apoio">${h(tr(`Versão ${f.versao}, gerada em ${data(f.geradaEm)}.`, `Version ${f.versao}, made on ${data(f.geradaEm)}.`))} SHA-256 ${h(tr('do conteúdo', 'of the content'))}: <span class="h">${h(f.sha256)}</span></p>
${f.itens.length ? `<ol>${items}</ol>` : `<p>${h(tr('A conferência desta versão não marcou nenhuma frase de risco.', 'The check of this version marked no risky sentence.'))}</p>`}
<p class="nota">${h(tr('Recorte da conferência automática, com o texto como está. Não é parecer jurídico.', 'An excerpt of the automatic check, with the text as it stands. It is not a legal opinion.'))}</p>
</main></body></html>`;
}

// ── defence package ────────────────────────────────────────────────────────────────────────────────────────────

const json = (v: unknown) => strToU8(`${JSON.stringify(v, null, 2)}\n`);
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'texto';
async function sha256Bytes(b: Uint8Array) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer));
  return [...d].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export interface Package { zip: Uint8Array<ArrayBuffer>; nome: string; id: string; carimbo: { ok: boolean; em: string | null; erro: string | null }; arquivos: string[]; fora: OutsidePackage[] }

/** A file that should be in the package and is not: it vanished from storage, or it is too big to fit in memory. */
export interface OutsidePackage { arquivo: string; motivo: 'ausente' | 'grande'; bytes: number | null; sha256: string | null }

/**
 * Cap on binary files (PDFs, audio, art, Wayback copies) in a package: the Worker has 128 MB, and the zip is built in
 * memory (the originals plus the zip). Whatever exceeds it stays out, listed in the manifest with the SHA-256 stored at
 * upload and the path to download it separately, and the screen warns.
 */
export const BUDGET_PACKAGE = 40 * 1024 * 1024;

/**
 * Defence package (zip): text versions, dossier (each source's saved text, hashes, the Wayback copy), marks and
 * reporting, signatures, other-side requests with replies, approved posts with version and date, the sources page, the
 * manifest with each file's SHA-256 and the manifest's RFC 3161 timestamp. Without a timestamp (TSA down), the package
 * goes out anyway and says why, in the README file and on screen.
 */
export async function buildPackage(env: Env, tenantId: string, textId: string, actor: string): Promise<Package> {
  const t = await readText(env, tenantId, textId);
  await retractVersion(env, tenantId, t, 'pacote');
  const an = await analyze(env, tenantId, textId, t);
  const tenant = await env.DB.prepare('SELECT nome, slug FROM tenants WHERE id = ?').bind(tenantId).first<{ nome: string; slug: string }>();
  const who = await env.DB.prepare('SELECT name FROM "user" WHERE id = ?').bind(actor).first<{ name: string }>();
  const fileList: Record<string, Uint8Array> = {};
  // Binaries go in by budget; what does not fit stays listed (it never vanishes silently).
  const outside: OutsidePackage[] = [];
  let used = 0;
  const fits = (bytes: number) => used + bytes <= BUDGET_PACKAGE;
  const include = async (path: string, key: string, sha256: string | null = null): Promise<boolean> => {
    const header = await env.MEDIA.head(key);
    if (!header) { outside.push({ arquivo: path, motivo: 'ausente', bytes: null, sha256 }); return false; }
    if (!fits(header.size)) { outside.push({ arquivo: path, motivo: 'grande', bytes: header.size, sha256 }); return false; }
    const obj = await env.MEDIA.get(key);
    if (!obj) { outside.push({ arquivo: path, motivo: 'ausente', bytes: null, sha256 }); return false; }
    fileList[path] = new Uint8Array(await obj.arrayBuffer());
    used += fileList[path].byteLength;
    return true;
  };
  // A body of unknown size (the Wayback copy): read in chunks, counted against the budget on each chunk; past the cap,
  // reading stops there (never the whole body in memory before knowing its size).
  const readInBudget = async (body: ReadableStream<Uint8Array> | null): Promise<Uint8Array | null> => {
    if (!body) return new Uint8Array();
    const reader = body.getReader();
    const parts: Uint8Array[] = [];
    let read = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        read += value.byteLength;
        used += value.byteLength;
        if (used > BUDGET_PACKAGE) { used -= read; await reader.cancel(); return null; }
        parts.push(value);
      }
    } catch (e) {
      used -= read;   // the copy did not fit: what was counted for it goes back to the budget
      throw e;
    }
    const out = new Uint8Array(read);
    let i = 0;
    for (const p of parts) { out.set(p, i); i += p.byteLength; }
    return out;
  };

  // Text: the current one and each snapshotted version.
  const paragraphs: string[] = JSON.parse(t.paragrafos_json);
  fileList['texto/atual.txt'] = strToU8(`${t.titulo}\n\n${paragraphs.join('\n\n')}\n`);
  fileList['texto/atual.json'] = json({ id: t.id, titulo: t.titulo, versao: t.versao, conferidaVersao: t.conferido_versao, conferidaEm: t.conferido_em, origem: t.origem, criadoEm: t.created_at, atualizadoEm: t.updated_at, doc: an.est.doc });
  const { results: versions } = await env.DB.prepare('SELECT versao, titulo, paragrafos_json, motivo, created_at FROM texto_versoes WHERE texto_id = ? AND tenant_id = ? ORDER BY versao')
    .bind(textId, tenantId).all<{ versao: number; titulo: string; paragrafos_json: string; motivo: string; created_at: string }>();
  for (const v of versions) fileList[`texto/versoes/v${v.versao}.json`] = json({ versao: v.versao, titulo: v.titulo, paragrafos: JSON.parse(v.paragrafos_json), retratadaEm: v.created_at, motivo: v.motivo });

  // Dossier: each source's saved text (the check runs against it) and the Wayback copy when there is one.
  const dossier: Record<string, unknown>[] = [];
  await Promise.all(an.evidencias.map(async (e, i) => {
    const n = String(i + 1).padStart(2, '0');
    const base = `dossie/${n}-${slug(e.titulo ?? e.url)}`;
    fileList[`${base}.txt`] = strToU8(e.texto);
    let copy: string | null = null;
    if (e.wayback?.estado === 'salvo' && e.wayback.url) {
      const ts = e.wayback.url.match(/\/web\/(\d{14})/)?.[1];
      try {
        const r = await fetch(`${baseWayback(env)}/web/${ts}id_/${e.url}`, { signal: AbortSignal.timeout(20_000) });
        if (!r.ok) { await r.body?.cancel(); throw new Error(`HTTP ${r.status}`); }
        const declared = Number(r.headers.get('content-length') ?? NaN);
        const html = Number.isFinite(declared) && !fits(declared) ? (await r.body?.cancel(), null) : await readInBudget(r.body);
        if (!html) {
          outside.push({ arquivo: `${base}.wayback.html`, motivo: 'grande', bytes: Number.isFinite(declared) ? declared : null, sha256: null });
          throw new Error('grande demais para o pacote');
        }
        fileList[`${base}.wayback.html`] = html;
        copy = `${base}.wayback.html`;
      } catch (x) {
        copy = `não baixada: ${String(x).slice(0, 120)}`;
      }
    }
    dossier[i] = {
      arquivo: `${base}.txt`, id: e.id, origem: e.origem, url: e.url, titulo: e.titulo, sha256DoTexto: e.hash, acrescentadaEm: e.criadaEm, lidaEm: e.conferidaEm,
      mudouEm: e.mudouEm, lidaPeloNavegador: e.viaNavegador, ...strengthEvidence(e), wayback: e.wayback, copiaDoWayback: copy,
    };
  }));
  fileList['dossie/evidencias.json'] = json(dossier);

  // Reporting: marks from the last check, decisions (with who and when), signatures and the current checklist.
  fileList['apuracao/marcas.json'] = json(an.afirmacoes.map((a) => ({
    paragrafo: a.paragrafo, trecho: a.trecho, estado: a.estado, risco: a.risco, incerto: a.incerto, explicacao: a.explicacao,
    evidenciaId: a.evidenciaId, trechoDaEvidencia: a.evidenciaTrecho, apuracao: a.apuracao,
  })));
  const { results: decisions } = await env.DB.prepare(
    `SELECT a.*, u.name AS por_nome, d.name AS desfeita_por_nome FROM apuracoes a LEFT JOIN "user" u ON u.id = a.por LEFT JOIN "user" d ON d.id = a.desfeita_por
      WHERE a.texto_id = ? AND a.tenant_id = ? ORDER BY a.created_at, a.rowid`,
  ).bind(textId, tenantId).all<Record<string, unknown>>();
  fileList['apuracao/decisoes.json'] = json(decisions.map(({ tenant_id: _t, ...d }) => d));
  const { results: signatures } = await env.DB.prepare(
    `SELECT s.versao, s.pendencias_json, s.created_at, u.name AS por FROM assinaturas s LEFT JOIN "user" u ON u.id = s.por WHERE s.texto_id = ? AND s.tenant_id = ? ORDER BY s.created_at`,
  ).bind(textId, tenantId).all<{ versao: number; pendencias_json: string; created_at: string; por: string | null }>();
  fileList['apuracao/assinaturas.json'] = json(signatures.map((s) => ({ versao: s.versao, por: s.por, em: s.created_at, pendencias: JSON.parse(s.pendencias_json) })));
  fileList['apuracao/checklist.json'] = json({ versao: t.versao, pendencias: an.pendencias, assinatura: an.assinatura });

  // Other side: each request with the text sent, the time and the reply (its text is in the dossier).
  const requests = await requestsText(env, tenantId, textId);
  fileList['outro-lado/pedidos.json'] = json(requests.map((p) => ({
    ...p, respostaArquivo: p.respostaEvidenciaId ? (dossier.find((d) => d.id === p.respostaEvidenciaId)?.arquivo ?? null) : null,
  })));

  // Approved posts: the approved version, who approved and when, the text version it came from and the publication.
  const { results: approved } = await env.DB.prepare(
    `SELECT pe.id, pe.formato, pe.status, pa.texto_versao, d.versao, d.created_at AS aprovado_em, u.name AS aprovado_por, v.conteudo_json, pe.arte_r2_keys_json
       FROM pecas pe JOIN pautas pa ON pa.id = pe.pauta_id AND pa.tenant_id = pe.tenant_id
       JOIN decisoes d ON d.peca_id = pe.id AND d.tenant_id = pe.tenant_id AND d.decisao = 'aprovar'
       LEFT JOIN peca_versoes v ON v.peca_id = pe.id AND v.versao = d.versao
       LEFT JOIN "user" u ON u.id = d.por
      WHERE pa.texto_id = ? AND pe.tenant_id = ? ORDER BY d.created_at`,
  ).bind(textId, tenantId).all<{ id: string; formato: string; status: string; texto_versao: number | null; versao: number; aprovado_em: string; aprovado_por: string | null; conteudo_json: string | null; arte_r2_keys_json: string | null }>();
  for (const p of approved) {
    const { results: pubs } = await env.DB.prepare('SELECT rede, modo, url, publicado_em, status FROM publicacoes WHERE peca_id = ? AND tenant_id = ? ORDER BY created_at').bind(p.id, tenantId).all();
    // The stored art is a list of ArtRendered ({ png, jpg, mp4? }); an old piece may only have the key. The JPG is
    // what went to Instagram; the PNG is the render's original.
    const artwork: string[] = [];
    for (const [i, a] of (JSON.parse(p.arte_r2_keys_json ?? '[]') as (string | { png?: string; jpg?: string; mp4?: string })[]).entries()) {
      const keys = typeof a === 'string' ? [a] : [a.mp4, a.jpg, a.png].filter((x): x is string => typeof x === 'string');
      for (const key of keys) {
        const name = key.endsWith('.mp4') ? `posts/${p.id}/reels.mp4` : `posts/${p.id}/card-${i + 1}.${key.split('.').pop() ?? 'png'}`;
        if (await include(name, key)) artwork.push(name);
      }
    }
    fileList[`posts/${p.id}.json`] = json({
      id: p.id, formato: p.formato, status: p.status, versaoAprovada: p.versao, aprovadoEm: p.aprovado_em, aprovadoPor: p.aprovado_por,
      daVersaoDoTexto: p.texto_versao, conteudo: p.conteudo_json ? JSON.parse(p.conteudo_json) : null, artes: artwork, publicacoes: pubs,
    });
  }

  // Documents (PDF) with the questions asked of them: the original file and what was answered, with the citations.
  const { results: files } = await env.DB.prepare("SELECT id, nome, r2, sha256, paginas, estado, created_at FROM arquivos WHERE texto_id = ? AND tenant_id = ? AND tipo = 'pdf' ORDER BY created_at")
    .bind(textId, tenantId).all<{ id: string; nome: string; r2: string; sha256: string; paginas: number | null; estado: string; created_at: string }>();
  for (const [i, a] of files.entries()) {
    await include(`dossie/documentos/${String(i + 1).padStart(2, '0')}-${slug(a.nome.replace(/\.pdf$/i, ''))}.pdf`, a.r2, a.sha256);
  }
  if (files.length) {
    const { results: questions } = await env.DB.prepare('SELECT arquivo_id, pergunta, resposta, citacoes_json, descartadas_json, encontrou, busca, situacao, aviso, created_at FROM perguntas WHERE texto_id = ? AND tenant_id = ? ORDER BY created_at')
      .bind(textId, tenantId).all<{ arquivo_id: string; pergunta: string; resposta: string | null; citacoes_json: string; descartadas_json: string; encontrou: number; busca: string; situacao: string | null; aviso: string | null; created_at: string }>();
    fileList['dossie/documentos/documentos.json'] = json(files.map((a) => ({
      id: a.id, nome: a.nome, sha256: a.sha256, paginas: a.paginas, estado: a.estado, enviadoEm: a.created_at,
      // situacao: respondida, nao_encontrou, invalida (a citation that does not check out) or falhou (the model did not answer).
      perguntas: questions.filter((p) => p.arquivo_id === a.id).map((p) => ({ pergunta: p.pergunta, situacao: p.situacao, aviso: p.aviso, resposta: p.resposta, citacoes: JSON.parse(p.citacoes_json), descartadas: JSON.parse(p.descartadas_json), em: p.created_at, busca: p.busca })),
    })));
  }

  // Recordings: the original audio and the transcript as Whisper returned it, passage by passage with each word's time.
  const { results: recs } = await env.DB.prepare("SELECT id, nome, r2, sha256, mime, duracao, estado, erro, created_at FROM arquivos WHERE texto_id = ? AND tenant_id = ? AND tipo = 'audio' ORDER BY created_at")
    .bind(textId, tenantId).all<{ id: string; nome: string; r2: string; sha256: string; mime: string | null; duracao: number | null; estado: string; erro: string | null; created_at: string }>();
  for (const [i, g] of recs.entries()) {
    const base = `dossie/gravacoes/${String(i + 1).padStart(2, '0')}-${slug(g.nome.replace(/\.[a-z0-9]{2,4}$/i, ''))}`;
    // A recording made in the app: one file per segment, each with its own hash.
    if (g.r2.endsWith('/')) {
      const { results: parts } = await env.DB.prepare('SELECT n, r2, sha256 FROM gravacao_segmentos WHERE arquivo_id = ? AND tenant_id = ? AND r2 IS NOT NULL ORDER BY n')
        .bind(g.id, tenantId).all<{ n: number; r2: string; sha256: string | null }>();
      for (const p of parts) await include(`${base}/parte-${String(p.n + 1).padStart(2, '0')}.${p.r2.split('.').pop()}`, p.r2, p.sha256);
    } else await include(`${base}.${g.r2.split('.').pop()}`, g.r2, g.sha256);
    const { results: passages } = await env.DB.prepare('SELECT inicio, fim, texto, palavras_json FROM gravacao_trechos WHERE arquivo_id = ? AND tenant_id = ? ORDER BY n')
      .bind(g.id, tenantId).all<{ inicio: number; fim: number; texto: string; palavras_json: string }>();
    fileList[`${base}.transcricao.json`] = json({
      id: g.id, nome: g.nome, sha256: g.sha256, formato: g.mime, duracaoSegundos: g.duracao, estado: g.estado, erro: g.erro, enviadoEm: g.created_at,
      modelo: '@cf/openai/whisper-large-v3-turbo', trechos: passages.map((t) => ({ inicio: t.inicio, fim: t.fim, texto: t.texto, palavras: JSON.parse(t.palavras_json) })),
    });
  }

  // Living story: the LAI requests (with filing, deadlines, answer and appeal) and the alerts with what was done.
  const { results: lais } = await env.DB.prepare(`SELECT id, trecho, orgao, esfera, pedido, protocolo, protocolado_em, prorrogado_em, resposta_em, atendeu, resposta_evidencia_id,
      recurso_tipo, recurso_em, recurso_texto, recurso_resposta_em, recurso_atendeu, recurso_evidencia_id, por, created_at FROM pedidos_lai WHERE texto_id = ? AND tenant_id = ? ORDER BY created_at`)
    .bind(textId, tenantId).all<Record<string, unknown>>();
  if (lais.length) fileList['lai/pedidos.json'] = json(lais);
  const { results: alerts } = await env.DB.prepare('SELECT id, tipo, titulo, detalhe_json, estado, acao, nota, pauta_id, peca_id, resolvido_por, resolvido_em, created_at FROM alertas WHERE texto_id = ? AND tenant_id = ? ORDER BY created_at')
    .bind(textId, tenantId).all<{ detalhe_json: string } & Record<string, unknown>>();
  if (alerts.length) fileList['depois/alertas.json'] = json(alerts.map(({ detalhe_json: detail_json, ...a }) => ({ ...a, detalhe: JSON.parse(detail_json) })));

  // Sources page: each publication (the live one and those taken down), with the frozen content.
  const { results: pages } = await env.DB.prepare('SELECT id, versao, conteudo_json, created_at, retirada_em FROM paginas_fontes WHERE texto_id = ? AND tenant_id = ? ORDER BY created_at')
    .bind(textId, tenantId).all<{ id: string; versao: number; conteudo_json: string; created_at: string; retirada_em: string | null }>();
  if (pages.length) fileList['pagina-de-fontes.json'] = json(pages.map((p) => ({ url: pageUrl(env, p.id), versao: p.versao, publicadaEm: p.created_at, retiradaEm: p.retirada_em, conteudo: JSON.parse(p.conteudo_json) })));

  // Manifest: each file's hash. The timestamp covers the manifest, and the manifest binds each file.
  const generatedAt = now();
  const list = await Promise.all(Object.keys(fileList).sort().map(async (path) => ({ caminho: path, sha256: await sha256Bytes(fileList[path]), bytes: fileList[path].byteLength })));
  // Outside the package: the path the file would have, the reason and the SHA-256 stored at upload (PDF and audio), which
  // binds the separately downloaded original to this manifest.
  const manifest = json({ veiculo: tenant?.nome ?? null, texto: { id: t.id, titulo: t.titulo, versao: t.versao }, geradoEm: generatedAt, geradoPor: who?.name ?? actor, arquivos: list, foraDoPacote: outside });
  fileList['manifesto.json'] = manifest;
  const manifestSha = await sha256Bytes(manifest);

  const id = newId();
  let timestamp: Package['carimbo'] = { ok: false, em: null, erro: null };
  let timestampKey: string | null = null;
  try {
    const c = await requestTimestamp(env, manifest);
    fileList['manifesto.json.tsr'] = c.tsr;
    timestampKey = `pacotes/${tenantId}/${id}.tsr`;
    await env.MEDIA.put(timestampKey, c.tsr, { httpMetadata: { contentType: 'application/timestamp-reply' } });
    timestamp = { ok: true, em: c.em, erro: null };
  } catch (e) {
    timestamp = { ok: false, em: null, erro: e instanceof TimestampError ? e.message : String(e).slice(0, 200) };
  }
  fileList['LEIA-ME.txt'] = strToU8(readmeMe(t.titulo, generatedAt, manifestSha, timestamp, env.TSA_URL, outside));
  await env.DB.prepare('INSERT INTO pacotes_defesa (id, tenant_id, texto_id, versao, manifesto_sha256, carimbo_r2, carimbo_em, carimbo_erro, por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, tenantId, textId, t.versao, manifestSha, timestampKey, timestamp.em, timestamp.erro, actor).run();
  await recordEvent(env, tenantId, 'materia.pacote_defesa', 'texto', textId, { por: actor, pacoteId: id, manifesto: manifestSha, carimbo: timestamp.ok, erro: timestamp.erro, fora: outside.length });

  // zipSync returns a new array that owns the whole buffer. Already compressed media goes in without recompression.
  const zip = zipSync(Object.fromEntries(Object.entries(fileList).map(([k, v]) => [k, [v, { level: /\.(png|jpe?g|webp|mp4|mp3|m4a|ogg|webm|flac|pdf)$/.test(k) ? 0 : 6 }]])));
  const name = `pacote-defesa-${slug(tenant?.slug ?? '')}-${slug(t.titulo)}-v${t.versao}-${generatedAt.slice(0, 10)}.zip`;
  return { zip: zip as Uint8Array<ArrayBuffer>, nome: name, id, carimbo: timestamp, arquivos: Object.keys(fileList).sort(), fora: outside };
}

function readmeMe(title: string, generatedAt: string, manifestSha: string, timestamp: Package['carimbo'], tsa: string | undefined, outside: OutsidePackage[]) {
  const missing = outside.length ? `

FORA DO PACOTE (${outside.length}): listados em manifesto.json, "foraDoPacote", com o SHA-256 guardado no envio.
${outside.map((f) => `- ${f.arquivo}: ${f.motivo === 'ausente' ? 'o arquivo não está mais no armazenamento' : `grande demais para caber no pacote (${f.bytes} bytes); baixe pelo app`}`).join('\n')}` : '';
  const verify = timestamp.ok ? `Carimbo de tempo (RFC 3161): manifesto.json.tsr, hora da autoridade ${timestamp.em}.
Autoridade: ${tsa || 'FreeTSA (https://freetsa.org)'}.

Para conferir sem o app (OpenSSL):
  1. Baixe o certificado da autoridade e o da raiz (FreeTSA: https://freetsa.org/files/tsa.crt e https://freetsa.org/files/cacert.pem).
  2. openssl ts -verify -data manifesto.json -in manifesto.json.tsr -CAfile cacert.pem -untrusted tsa.crt
     Deve responder "Verification: OK". Para ver a hora: openssl ts -reply -in manifesto.json.tsr -text
  3. Cada arquivo do pacote tem o SHA-256 no manifesto. Confira com: sha256sum <arquivo> (ou certutil -hashfile <arquivo> SHA256).
Se um arquivo mudar, o hash dele deixa de bater com o manifesto; se o manifesto mudar, o carimbo deixa de conferir.`
    : `SEM CARIMBO DE TEMPO: ${timestamp.erro ?? 'a autoridade não respondeu'}.
O manifesto e os hashes estão aqui, mas sem a prova de hora de terceiros. Gere o pacote de novo quando a autoridade voltar.`;
  return `Pacote de defesa: ${title}
Gerado em ${generatedAt}. SHA-256 do manifesto: ${manifestSha}

O que tem aqui:
- texto/: o texto atual e cada versão retratada (conferência, assinatura, envio ao Instagram, página de fontes, pacote).
- dossie/: cada fonte com o texto salvo quando entrou no dossiê (é contra ele que a conferência roda), o hash, a
  cópia do Wayback Machine quando houver, e as respostas do outro lado.
- apuracao/: as marcas da última conferência, as decisões de cada frase (quem e quando), as assinaturas e o checklist.
- outro-lado/: os pedidos de outro lado, com o texto mandado, a hora (do servidor, quando saiu pelo app; dita pela
  pessoa, quando ela copiou e mandou por fora), o prazo e a resposta.
- posts/: os posts aprovados, com a versão aprovada, quem aprovou e quando, e a publicação.
- pagina-de-fontes.json: a página "Como apuramos", quando publicada.
- manifesto.json: o SHA-256 de cada arquivo acima.${missing}

${verify}
`;
}
