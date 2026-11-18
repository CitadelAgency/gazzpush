import { hojeISO } from './lai';
import PostalMime from 'postal-mime';
import { strToU8, zipSync } from 'fflate';
import type { Env } from '../env';
import { novoId, registrarEvento, sha256Hex } from './db';
import { ErroMesa, lerTexto } from './mesa';
import { MEIOS_OUTRO_LADO, RISCOS_OUTRO_LADO } from './apuracao';
import { analisar, forcaDaEvidencia, registrarApuracao, type Analise } from './assistente';
import { exigirChecklist, fatosDaAnalise } from './materia';
import { pedirCarimbo, ErroCarimbo } from './carimbo';
import { baseWayback } from './wayback';
import { retratarVersao } from './versoes';

export { retratarVersao };

// Escudo jurídico da Matéria (Fase 4): pedido de outro lado com prazo e hora registrada, a resposta no dossiê, o retrato
// de cada versão que importa, o pacote de defesa (zip com manifesto de hashes e carimbo de tempo RFC 3161) e a página
// de fontes pública ("Como apuramos"). A IA não entra aqui: tudo é registro e código.

export const MEIOS_PEDIDO = ['email', 'copiado'] as const;
export type MeioPedido = (typeof MEIOS_PEDIDO)[number];

const erro = (codigo: string, pt: string, en: string, status: 400 | 404 | 409 | 422 | 502 = 400) => new ErroMesa(codigo, pt, status, en);
const agora = () => new Date().toISOString();

// ── pedido de outro lado ───────────────────────────────────────────────────────────────────────────────────────

export const emailLigado = (env: Env) => !!(env.EMAIL && env.EMAIL_REMETENTE && env.EMAIL_REMETENTE.includes('@'));
const EMAIL_OK = /^[^\s@<>()]{1,64}@[^\s@<>()]+\.[^\s@<>()]{2,}$/;

export interface Pedido {
  id: string; blocoId: string | null; trecho: string | null; paraNome: string; paraEmail: string | null; assunto: string; corpo: string; prazo: string;
  meio: MeioPedido; canal: string | null; enviadoEm: string | null; registradoEm: string; erro: string | null; por: string | null; porNome: string | null;
  respostaEm: string | null; respostaEvidenciaId: string | null; vencido: boolean;
}

export async function pedidosDoTexto(env: Env, tenantId: string, textoId: string): Promise<Pedido[]> {
  const { results } = await env.DB.prepare(
    `SELECT p.*, u.name AS por_nome FROM pedidos_outro_lado p LEFT JOIN "user" u ON u.id = p.por
      WHERE p.texto_id = ? AND p.tenant_id = ? ORDER BY p.created_at, p.rowid`,
  ).bind(textoId, tenantId).all<Record<string, string | null>>();
  const ja = Date.now();
  return results.map((p) => ({
    id: p.id!, blocoId: p.bloco_id, trecho: p.trecho, paraNome: p.para_nome!, paraEmail: p.para_email, assunto: p.assunto!, corpo: p.corpo!, prazo: p.prazo!,
    meio: p.meio as MeioPedido, canal: p.canal, enviadoEm: p.enviado_em, registradoEm: p.created_at!, erro: p.erro, por: p.por, porNome: p.por_nome,
    respostaEm: p.resposta_em, respostaEvidenciaId: p.resposta_evidencia_id, vencido: !p.resposta_em && Date.parse(p.prazo!) < ja,
  }));
}

const texto = (v: unknown, min: number, max: number) => typeof v === 'string' && v.trim().length >= min && v.trim().length <= max ? v.trim() : null;

/**
 * Pede o outro lado. `meio: 'email'`: o app manda pelo Email Service (hora do servidor; a resposta volta para
 * outro-lado+token@ o domínio do remetente). `meio: 'copiado'`: a pessoa copiou e mandou por fora, e diz quando e por
 * onde (`enviadoEm`, `canal`). Se o pedido trata de uma frase (bloco e trecho literal, conferido aqui), a frase de
 * risco fica com "outro lado procurado" registrado.
 */
export async function criarPedido(env: Env, tenantId: string, textoId: string, por: { id: string; nome: string }, b: Record<string, unknown>) {
  const t = await lerTexto(env, tenantId, textoId);
  const paraNome = texto(b.paraNome, 2, 200);
  if (!paraNome) throw erro('para', 'Diga quem você está procurando (nome ou cargo).', 'Say who you are contacting (name or title).');
  const assunto = texto(b.assunto, 3, 200);
  if (!assunto) throw erro('assunto', 'Escreva o assunto do pedido.', 'Write the subject of the request.');
  const corpo = texto(b.corpo, 20, 8000);
  if (!corpo) throw erro('corpo', 'Escreva o pedido (as perguntas e o que a matéria afirma).', 'Write the request (the questions and what the story says).');
  const prazo = typeof b.prazo === 'string' ? Date.parse(b.prazo) : NaN;
  if (!Number.isFinite(prazo) || prazo <= Date.now() || prazo > Date.now() + 60 * 86_400_000) throw erro('prazo', 'O prazo é uma data e hora entre agora e daqui a 60 dias.', 'The deadline is a date and time between now and 60 days from now.');
  if (!(MEIOS_PEDIDO as readonly unknown[]).includes(b.meio)) throw erro('meio', `meio: um de ${MEIOS_PEDIDO.join(', ')}`, `meio: one of ${MEIOS_PEDIDO.join(', ')}`);
  const meio = b.meio as MeioPedido;
  const paraEmail = typeof b.paraEmail === 'string' && b.paraEmail.trim() ? b.paraEmail.trim() : null;
  if (paraEmail && !EMAIL_OK.test(paraEmail)) throw erro('email', 'Esse e-mail não parece válido.', "That e-mail doesn't look valid.");

  // A frase de que o pedido trata: o trecho tem de estar, letra por letra, no parágrafo (conferido por código).
  let blocoId: string | null = null, trecho: string | null = null;
  if (b.blocoId !== undefined && b.blocoId !== null) {
    const an = await analisar(env, tenantId, textoId, t);
    const bloco = an.est.blocos.find((x) => x.id === b.blocoId);
    if (!bloco || typeof b.trecho !== 'string' || !b.trecho.trim() || !bloco.texto.includes(b.trecho)) throw erro('trecho_fora', 'Esse trecho não está no parágrafo. Escolha a frase de novo.', "That passage isn't in the paragraph. Choose the sentence again.", 422);
    // O pedido fecha o risco da frase só se a frase foi mandada: ela tem de estar, letra por letra, no texto do pedido.
    const junta = (s: string) => s.replace(/\s+/g, ' ').trim();
    if (!junta(corpo).includes(junta(b.trecho))) throw erro('trecho_fora_do_pedido', 'O pedido não cita a frase escolhida. Ponha a frase no texto do pedido ou escolha "Nenhuma frase específica".', 'The request does not quote the chosen sentence. Put the sentence in the request or choose "No specific sentence".', 422);
    blocoId = bloco.id; trecho = b.trecho;
  }

  let canal: string | null = null, enviadoEm: string | null = null;
  if (meio === 'copiado') {
    const em = typeof b.enviadoEm === 'string' ? Date.parse(b.enviadoEm) : NaN;
    if (!Number.isFinite(em) || em > Date.now() + 120_000) throw erro('enviado', 'Diga quando você mandou o pedido (não pode ser no futuro).', 'Say when you sent the request (it cannot be in the future).');
    if (!(MEIOS_OUTRO_LADO as readonly unknown[]).includes(b.canal)) throw erro('canal', `canal: um de ${MEIOS_OUTRO_LADO.join(', ')}`, `canal: one of ${MEIOS_OUTRO_LADO.join(', ')}`);
    canal = b.canal as string; enviadoEm = new Date(em).toISOString();
  } else {
    if (!emailLigado(env)) throw erro('email_desligado', 'O envio por e-mail não está configurado. Copie o pedido e mande por fora.', 'Sending by e-mail is not set up. Copy the request and send it yourself.', 409);
    if (!paraEmail) throw erro('email', 'Diga o e-mail de quem você está procurando.', 'Give the e-mail of the person you are contacting.');
  }

  const id = novoId();
  const token = [...crypto.getRandomValues(new Uint8Array(12))].map((x) => x.toString(16).padStart(2, '0')).join('');
  await env.DB.prepare(
    `INSERT INTO pedidos_outro_lado (id, tenant_id, texto_id, bloco_id, trecho, para_nome, para_email, assunto, corpo, prazo, meio, canal, enviado_em, token, por)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, tenantId, textoId, blocoId, trecho, paraNome, paraEmail, assunto, corpo, new Date(prazo).toISOString(), meio, canal, enviadoEm, token, por.id).run();

  let falha: string | null = null;
  if (meio === 'email') {
    const remetente = env.EMAIL_REMETENTE!;
    const dominio = remetente.split('@')[1];
    const veiculo = await env.DB.prepare('SELECT nome FROM tenants WHERE id = ?').bind(tenantId).first<{ nome: string }>();
    try {
      const r = await env.EMAIL!.send({
        from: { email: remetente, name: `${por.nome} · ${veiculo?.nome ?? ''}`.slice(0, 120) },
        to: paraEmail!,
        replyTo: `outro-lado+${token}@${dominio}`,
        subject: assunto,
        text: corpo,
      });
      enviadoEm = agora();
      await env.DB.prepare('UPDATE pedidos_outro_lado SET enviado_em = ?, message_id = ? WHERE id = ? AND tenant_id = ?').bind(enviadoEm, r.messageId, id, tenantId).run();
    } catch (e) {
      falha = `${(e as { code?: string }).code ?? 'erro'}: ${String((e as Error).message ?? e).slice(0, 200)}`;
      await env.DB.prepare('UPDATE pedidos_outro_lado SET erro = ? WHERE id = ? AND tenant_id = ?').bind(falha, id, tenantId).run();
    }
  }

  // Pedido que saiu e trata de uma frase de risco: a frase fica com "outro lado procurado" (quem, quando, meio).
  if (enviadoEm && blocoId && trecho) {
    const a = await env.DB.prepare('SELECT id, risco FROM afirmacoes WHERE texto_id = ? AND tenant_id = ? AND bloco_id = ? AND trecho = ?')
      .bind(textoId, tenantId, blocoId, trecho).first<{ id: string; risco: string | null }>();
    const decidida = await env.DB.prepare('SELECT 1 FROM apuracoes WHERE texto_id = ? AND tenant_id = ? AND bloco_id = ? AND trecho = ? AND desfeita_em IS NULL')
      .bind(textoId, tenantId, blocoId, trecho).first();
    if (a && (RISCOS_OUTRO_LADO as readonly (string | null)[]).includes(a.risco) && !decidida) {
      await registrarApuracao(env, tenantId, textoId, por.id, { afirmacaoId: a.id, tipo: 'outro_lado', quem: paraNome, quando: hojeISO(new Date(enviadoEm)), meio: meio === 'email' ? 'email' : canal });
    }
  }
  await registrarEvento(env, tenantId, 'outro_lado.pedido', 'texto', textoId, { pedidoId: id, meio, enviadoEm, erro: falha, por: por.id });
  return { id, erro: falha };
}

/**
 * A resposta do outro lado entra no dossiê como evidência (origem `resposta`, fonte primária): a conferência passa a
 * vê-la e o pacote de defesa a leva. Por e-mail (o endereço com o token) ou colada à mão por quem recebeu.
 */
export async function registrarResposta(env: Env, tenantId: string, pedidoId: string, conteudo: string, recebidaEm: string, de: string | null) {
  const p = await env.DB.prepare('SELECT id, texto_id, para_nome FROM pedidos_outro_lado WHERE id = ? AND tenant_id = ?').bind(pedidoId, tenantId)
    .first<{ id: string; texto_id: string; para_nome: string }>();
  if (!p) throw erro('nao_encontrado', 'não encontrado', 'not found', 404);
  const id = novoId();
  const chave = `evidencias/${tenantId}/${id}.txt`;
  const corpo = conteudo.replace(/\r\n?/g, '\n').trim();
  await env.MEDIA.put(chave, corpo, { httpMetadata: { contentType: 'text/plain; charset=utf-8' } });
  const hash = await sha256Hex(corpo);
  const data = recebidaEm.slice(0, 10);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO evidencias (id, tenant_id, texto_id, url, titulo, r2_texto, hash, hash_atual, tipo_fonte, origem) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'primaria', 'resposta')`,
    ).bind(id, tenantId, p.texto_id, `resposta:${pedidoId}:${id}`, `Resposta de ${p.para_nome} (${data})${de ? ` · ${de}` : ''}`.slice(0, 300), chave, hash, hash),
    env.DB.prepare('UPDATE pedidos_outro_lado SET resposta_em = ?, resposta_evidencia_id = ? WHERE id = ? AND tenant_id = ?').bind(recebidaEm, id, pedidoId, tenantId),
    env.DB.prepare("UPDATE textos SET updated_at = datetime('now') WHERE id = ? AND tenant_id = ?").bind(p.texto_id, tenantId),
  ]);
  await registrarEvento(env, tenantId, 'outro_lado.resposta', 'texto', p.texto_id, { pedidoId, evidenciaId: id, de });
  return { evidenciaId: id, textoId: p.texto_id };
}

export async function respostaManual(env: Env, tenantId: string, textoId: string, pedidoId: string, b: Record<string, unknown>) {
  await lerTexto(env, tenantId, textoId);
  const ok = await env.DB.prepare('SELECT 1 FROM pedidos_outro_lado WHERE id = ? AND texto_id = ? AND tenant_id = ?').bind(pedidoId, textoId, tenantId).first();
  if (!ok) throw erro('nao_encontrado', 'não encontrado', 'not found', 404);
  const conteudo = texto(b.texto, 2, 50_000);
  if (!conteudo) throw erro('resposta', 'Cole a resposta que você recebeu.', 'Paste the reply you received.');
  const em = typeof b.recebidaEm === 'string' ? Date.parse(b.recebidaEm) : NaN;
  if (!Number.isFinite(em) || em > Date.now() + 120_000) throw erro('recebida', 'Diga quando a resposta chegou (não pode ser no futuro).', 'Say when the reply arrived (it cannot be in the future).');
  return registrarResposta(env, tenantId, pedidoId, conteudo, new Date(em).toISOString(), null);
}

/** Handler `email` do Worker (Email Routing): outro-lado+<token>@… vira a resposta do pedido. Token desconhecido: recusa. */
export async function receberEmail(message: ForwardableEmailMessage, env: Env) {
  const token = message.to.toLowerCase().match(/^outro-lado\+([0-9a-f]{24})@/)?.[1];
  const p = token ? await env.DB.prepare('SELECT id, tenant_id FROM pedidos_outro_lado WHERE token = ?').bind(token).first<{ id: string; tenant_id: string }>() : null;
  if (!p) { message.setReject('Endereço desconhecido.'); return; }
  const lido = await PostalMime.parse(message.raw);
  const corpo = lido.text?.trim() || (lido.html ?? '').replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').trim();
  await registrarResposta(env, p.tenant_id, p.id, `${lido.subject ? `Assunto: ${lido.subject}\n\n` : ''}${corpo || '(mensagem sem texto)'}`, agora(), message.from);
}

// ── página de fontes pública ───────────────────────────────────────────────────────────────────────────────────

export interface ConteudoPagina {
  veiculo: string; idioma: 'pt-BR' | 'en'; titulo: string; versao: number; publicadaEm: string; conferidaEm: string | null;
  frases: { texto: string; fonte: number; trecho: string }[];
  opinioes: string[];
  fontes: { n: number; titulo: string; url: string; wayback: string | null; tipo: string | null }[];
}

/** O que vai a público: só frase com fonte (o trecho literal), opinião marcada e a lista de fontes com link e Wayback. */
export function conteudoDaPagina(an: Analise, veiculo: string, idioma: 'pt-BR' | 'en'): ConteudoPagina {
  const { comFonte, minhas } = fatosDaAnalise(an);
  const evs = new Map(an.evidencias.map((e) => [e.id, e]));
  const ordem: string[] = [];
  const frases: ConteudoPagina['frases'] = [];
  for (const f of comFonte) {
    const e = evs.get(f.evidenciaId);
    if (!e || e.origem === 'resposta') continue;   // a resposta do outro lado não vai a público
    if (!ordem.includes(e.id)) ordem.push(e.id);
    frases.push({ texto: f.trecho, fonte: ordem.indexOf(e.id) + 1, trecho: f.evidenciaTrecho });
  }
  return {
    veiculo, idioma, titulo: an.t.titulo, versao: an.t.versao, publicadaEm: agora(), conferidaEm: an.t.conferido_em,
    frases, opinioes: minhas.map((m) => m.trecho),
    fontes: ordem.map((id, i) => {
      const e = evs.get(id)!;
      return { n: i + 1, titulo: e.titulo ?? new URL(e.url).hostname, url: e.origem === 'link' ? e.url : '', wayback: e.wayback?.estado === 'salvo' ? e.wayback.url : null, tipo: forcaDaEvidencia(e).tipoFonte };
    }),
  };
}

export const urlPagina = (env: Env, id: string) => `${env.PUBLIC_BASE_URL.replace(/\/$/, '')}/fontes/${id}`;

export async function paginaNoAr(env: Env, tenantId: string, textoId: string) {
  const p = await env.DB.prepare(
    `SELECT p.id, p.versao, p.created_at, u.name AS por FROM paginas_fontes p LEFT JOIN "user" u ON u.id = p.por
      WHERE p.texto_id = ? AND p.tenant_id = ? AND p.retirada_em IS NULL ORDER BY p.created_at DESC, p.rowid DESC LIMIT 1`,
  ).bind(textoId, tenantId).first<{ id: string; versao: number; created_at: string; por: string | null }>();
  return p ? { id: p.id, url: urlPagina(env, p.id), versao: p.versao, em: p.created_at, por: p.por } : null;
}

/** Publica a página da versão conferida (o checklist trava como no Instagram). Publicar de novo tira a anterior do ar. */
export async function publicarPagina(env: Env, tenantId: string, textoId: string, versao: unknown, por: string) {
  const t = await lerTexto(env, tenantId, textoId);
  if (versao !== t.versao) throw erro('versao', 'O texto mudou desde que você abriu. Recarregue e publique de novo.', 'The text changed since you opened it. Reload and publish again.', 409);
  if (t.conferido_versao !== t.versao) throw erro('nao_conferido', 'Confira esta versão antes de publicar a página de fontes.', 'Check this version before publishing the sources page.', 409);
  const an = await analisar(env, tenantId, textoId, t);
  exigirChecklist(an);
  const tenant = await env.DB.prepare('SELECT nome, idioma FROM tenants WHERE id = ?').bind(tenantId).first<{ nome: string; idioma: string | null }>();
  const conteudo = conteudoDaPagina(an, tenant?.nome ?? '', tenant?.idioma === 'en' ? 'en' : 'pt-BR');
  if (!conteudo.frases.length) throw erro('sem_fatos', 'Nenhuma frase do texto tem fonte no dossiê: a página de fontes ficaria vazia.', 'No sentence in the text has a source in the dossier: the sources page would be empty.', 422);
  const id = [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(36).padStart(2, '0')).join('').slice(0, 26);
  await env.DB.batch([
    env.DB.prepare("UPDATE paginas_fontes SET retirada_em = datetime('now'), retirada_por = ? WHERE texto_id = ? AND tenant_id = ? AND retirada_em IS NULL").bind(por, textoId, tenantId),
    env.DB.prepare('INSERT INTO paginas_fontes (id, tenant_id, texto_id, versao, conteudo_json, por) VALUES (?, ?, ?, ?, ?, ?)').bind(id, tenantId, textoId, t.versao, JSON.stringify(conteudo), por),
  ]);
  await retratarVersao(env, tenantId, t, 'pagina_fontes');
  await registrarEvento(env, tenantId, 'materia.pagina_fontes', 'texto', textoId, { por, paginaId: id, versao: t.versao, assinada: an.assinatura?.id ?? null });
  return { id, url: urlPagina(env, id) };
}

export async function retirarPagina(env: Env, tenantId: string, textoId: string, por: string): Promise<boolean> {
  await lerTexto(env, tenantId, textoId);
  const r = await env.DB.prepare("UPDATE paginas_fontes SET retirada_em = datetime('now'), retirada_por = ? WHERE texto_id = ? AND tenant_id = ? AND retirada_em IS NULL")
    .bind(por, textoId, tenantId).run();
  if (r.meta.changes) await registrarEvento(env, tenantId, 'materia.pagina_fontes.retirada', 'texto', textoId, { por });
  return r.meta.changes > 0;
}

const h = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const linkSeguro = (u: string) => (/^https?:\/\//i.test(u) ? h(u) : '#');

const TIPO_PUBLICO: Record<string, [string, string]> = {
  oficial: ['documento oficial', 'official document'], primaria: ['fonte primária', 'primary source'],
  materia: ['outra reportagem', 'another story'], anonima: ['fonte anônima', 'anonymous source'],
};

/** A página pública (HTML do Worker, sem o app): leitura, sem nada interno. */
export function htmlDaPagina(c: ConteudoPagina): string {
  const en = c.idioma === 'en';
  const tr = (pt: string, ing: string) => (en ? ing : pt);
  const data = (iso: string) => new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`).toLocaleDateString(en ? 'en-US' : 'pt-BR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
  const frases = c.frases.map((f) => `<li><p class="frase">${h(f.texto)} <a class="ref" href="#fonte-${f.fonte}" aria-label="${tr('fonte', 'source')} ${f.fonte}">[${f.fonte}]</a></p><p class="trecho"><span class="rot">${tr('o que a fonte diz', 'what the source says')}</span> “${h(f.trecho)}”</p></li>`).join('');
  const opinioes = c.opinioes.length ? `<section aria-labelledby="op"><h2 id="op">${tr('Opinião do autor', "The author's opinion")}</h2><p class="apoio">${tr('Estas frases são opinião de quem escreve, não fato apurado.', 'These sentences are the writer’s opinion, not reported fact.')}</p><ul>${c.opinioes.map((o) => `<li>${h(o)}</li>`).join('')}</ul></section>` : '';
  const fontes = c.fontes.map((f) => `<li id="fonte-${f.n}"><span class="n">[${f.n}]</span> ${f.url ? `<a href="${linkSeguro(f.url)}" rel="noopener">${h(f.titulo)}</a>` : `${h(f.titulo)} <span class="mono">${tr('documento', 'document')}</span>`}${f.tipo && TIPO_PUBLICO[f.tipo] ? ` <span class="mono">${tr(...TIPO_PUBLICO[f.tipo])}</span>` : ''}${f.wayback ? ` · <a href="${linkSeguro(f.wayback)}" rel="noopener">${tr('cópia no Wayback Machine', 'copy on the Wayback Machine')}</a>` : ''}</li>`).join('');
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
<section aria-labelledby="fr"><h2 id="fr">${tr('Frases e fontes', 'Sentences and sources')}</h2><ol>${frases}</ol></section>
${opinioes}
<section aria-labelledby="fo"><h2 id="fo">${tr('Fontes', 'Sources')}</h2><ol>${fontes}</ol></section>
<footer>${h(tr('Frase sem fonte no dossiê não aparece aqui. Viu um erro? Escreva para o veículo.', 'A sentence without a source in the dossier does not appear here. Spotted an error? Write to the outlet.'))}</footer>
</main></body></html>`;
}

export async function paginaPublica(env: Env, id: string): Promise<string | null> {
  if (!/^[a-z0-9]{10,40}$/.test(id)) return null;
  const p = await env.DB.prepare('SELECT conteudo_json FROM paginas_fontes WHERE id = ? AND retirada_em IS NULL').bind(id).first<{ conteudo_json: string }>();
  return p ? htmlDaPagina(JSON.parse(p.conteudo_json) as ConteudoPagina) : null;
}

// ── folha para o advogado ───────────────────────────────────────────────────

/** A folha é curta: a resposta inteira fica no pacote de defesa. */
const RESPOSTA_FOLHA_MAX = 600;

const NOME_RISCO: Record<string, [string, string]> = {
  acusacao_sem_condenacao: ['acusação sem condenação nem fonte oficial', 'accusation with no conviction or official source'],
  vitima_ou_menor: ['nome de vítima ou de menor de idade', 'name of a victim or a minor'],
  sem_outro_lado: ['acusação sem registro de que o citado foi procurado', 'accusation with no record that the person named was asked for comment'],
};

export interface ItemFolha {
  trecho: string; risco: string;
  evidencias: { titulo: string; url: string | null; trecho: string }[];
  outroLado: { para: string; meio: string; em: string | null; prazo: string | null; resposta: string | null; respostaTexto: string | null }[];
}
export interface Folha { idioma: 'pt-BR' | 'en'; veiculo: string; titulo: string; versao: number; sha256: string; geradaEm: string; itens: ItemFolha[] }

/**
 * Recorte da conferência para quem vai ler com olho jurídico: só as frases com marca de risco, o tipo do risco, a evidência
 * e o outro lado. A nota do modelo não entra, e nada é reescrito nem sugerido. Evidência só com trecho que está mesmo na fonte.
 */
export async function dadosFolha(env: Env, tenantId: string, textoId: string): Promise<Folha> {
  const t = await lerTexto(env, tenantId, textoId);
  if (t.conferido_versao !== t.versao) throw erro('nao_conferido', 'Confira esta versão antes de gerar a folha.', 'Check this version before making the sheet.', 409);
  const an = await analisar(env, tenantId, textoId, t);
  const pedidos = await pedidosDoTexto(env, tenantId, textoId);
  const tenant = await env.DB.prepare('SELECT nome FROM tenants WHERE id = ?').bind(tenantId).first<{ nome: string }>();
  const en = an.idioma === 'en';
  const fonte = (id: string | null) => an.evidencias.find((e) => e.id === id) ?? null;
  const itens: ItemFolha[] = an.afirmacoes.filter((a) => a.estado === 'risco').map((a) => {
    const achadas = [[a.evidenciaId, a.evidenciaTrecho], [a.apuracao?.evidenciaId ?? null, a.apuracao?.evidenciaTrecho ?? null]] as const;
    const evidencias = achadas.flatMap(([id, trecho]) => {
      const e = fonte(id);
      return e && trecho && e.texto.includes(trecho) ? [{ titulo: e.titulo ?? e.url, url: e.url || null, trecho }] : [];
    });
    const dele = pedidos.filter((p) => p.blocoId === a.blocoId && (!p.trecho || p.trecho === a.trecho || a.trecho.includes(p.trecho)));
    // O pedido já fecha a apuração com quem, quando e meio: a apuração só entra quando o contato foi registrado à mão, sem pedido.
    const registrado = !dele.length && a.apuracao?.outroLado ? [{ para: a.apuracao.outroLado.quem, meio: a.apuracao.outroLado.meio, em: a.apuracao.outroLado.quando, prazo: null, resposta: null, respostaTexto: null }] : [];
    return {
      trecho: a.trecho, risco: (NOME_RISCO[a.risco ?? ''] ?? [a.risco ?? '', a.risco ?? ''])[en ? 1 : 0],
      evidencias: [...new Map(evidencias.map((x) => [`${x.url}|${x.trecho}`, x])).values()],
      outroLado: [...dele.map((p) => ({ para: p.paraNome, meio: p.canal ?? p.meio, em: p.enviadoEm, prazo: p.prazo, resposta: p.respostaEm, respostaTexto: fonte(p.respostaEvidenciaId)?.texto.slice(0, RESPOSTA_FOLHA_MAX) ?? null })), ...registrado],
    };
  });
  const conteudo = `${t.titulo}\n\n${(JSON.parse(t.paragrafos_json) as string[]).join('\n\n')}\n`;
  return { idioma: an.idioma, veiculo: tenant?.nome ?? '', titulo: t.titulo, versao: t.versao, sha256: await sha256Bytes(strToU8(conteudo)), geradaEm: agora(), itens };
}

export function htmlFolha(f: Folha): string {
  const en = f.idioma === 'en';
  const tr = (pt: string, ing: string) => (en ? ing : pt);
  const data = (s: string | null) => (s ? new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`).toLocaleDateString(en ? 'en-US' : 'pt-BR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' }) : tr('sem data', 'no date'));
  const itens = f.itens.map((i) => `<li><p class="frase">${h(i.trecho)}</p>
<p class="rot">${h(tr('Risco', 'Risk'))}</p><p>${h(i.risco)}</p>
<p class="rot">${h(tr('Evidência', 'Evidence'))}</p>${i.evidencias.length
    ? i.evidencias.map((e) => `<p class="trecho">${h(e.trecho)}</p><p class="ref">${h(e.titulo)}${e.url ? ` · ${e.url.startsWith('http') ? `<a href="${linkSeguro(e.url)}">${h(e.url)}</a>` : h(e.url)}` : ''}</p>`).join('')
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
${f.itens.length ? `<ol>${itens}</ol>` : `<p>${h(tr('A conferência desta versão não marcou nenhuma frase de risco.', 'The check of this version marked no risky sentence.'))}</p>`}
<p class="nota">${h(tr('Recorte da conferência automática, com o texto como está. Não é parecer jurídico.', 'An excerpt of the automatic check, with the text as it stands. It is not a legal opinion.'))}</p>
</main></body></html>`;
}

// ── pacote de defesa ───────────────────────────────────────────────────────────────────────────────────────────

const json = (v: unknown) => strToU8(`${JSON.stringify(v, null, 2)}\n`);
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'texto';
async function sha256Bytes(b: Uint8Array) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer));
  return [...d].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export interface Pacote { zip: Uint8Array<ArrayBuffer>; nome: string; id: string; carimbo: { ok: boolean; em: string | null; erro: string | null }; arquivos: string[]; fora: ForaDoPacote[] }

/** Arquivo que devia estar no pacote e não está: sumiu do armazenamento, ou é grande demais para caber na memória. */
export interface ForaDoPacote { arquivo: string; motivo: 'ausente' | 'grande'; bytes: number | null; sha256: string | null }

/**
 * Teto dos arquivos binários (PDFs, áudios, artes, cópias do Wayback) num pacote: o Worker tem 128 MB, e o zip é
 * montado na memória (os originais mais o zip). O que passa disso fica fora, listado no manifesto com o SHA-256 guardado
 * no envio e o caminho para baixar à parte, e a tela avisa.
 */
export const ORCAMENTO_PACOTE = 40 * 1024 * 1024;

/**
 * Pacote de defesa (zip): versões do texto, dossiê (o texto salvo de cada fonte, hashes, a cópia do Wayback), marcas e
 * apurações, assinaturas, pedidos de outro lado com respostas, posts aprovados com versão e data, a página de fontes,
 * o manifesto com o SHA-256 de cada arquivo e o carimbo de tempo RFC 3161 do manifesto. Sem carimbo (TSA fora do ar),
 * o pacote sai assim mesmo e diz por quê, no LEIA-ME e na tela.
 */
export async function montarPacote(env: Env, tenantId: string, textoId: string, por: string): Promise<Pacote> {
  const t = await lerTexto(env, tenantId, textoId);
  await retratarVersao(env, tenantId, t, 'pacote');
  const an = await analisar(env, tenantId, textoId, t);
  const tenant = await env.DB.prepare('SELECT nome, slug FROM tenants WHERE id = ?').bind(tenantId).first<{ nome: string; slug: string }>();
  const quem = await env.DB.prepare('SELECT name FROM "user" WHERE id = ?').bind(por).first<{ name: string }>();
  const arquivos: Record<string, Uint8Array> = {};
  // Binários entram pelo orçamento; o que não entra fica listado (nunca some calado).
  const fora: ForaDoPacote[] = [];
  let usado = 0;
  const cabe = (bytes: number) => usado + bytes <= ORCAMENTO_PACOTE;
  const incluir = async (caminho: string, chave: string, sha256: string | null = null): Promise<boolean> => {
    const cab = await env.MEDIA.head(chave);
    if (!cab) { fora.push({ arquivo: caminho, motivo: 'ausente', bytes: null, sha256 }); return false; }
    if (!cabe(cab.size)) { fora.push({ arquivo: caminho, motivo: 'grande', bytes: cab.size, sha256 }); return false; }
    const obj = await env.MEDIA.get(chave);
    if (!obj) { fora.push({ arquivo: caminho, motivo: 'ausente', bytes: null, sha256 }); return false; }
    arquivos[caminho] = new Uint8Array(await obj.arrayBuffer());
    usado += arquivos[caminho].byteLength;
    return true;
  };
  // Corpo de tamanho desconhecido (a cópia do Wayback): lido em pedaços, contando no orçamento a cada pedaço; passou
  // do teto, a leitura para ali (nunca o corpo inteiro na memória antes de saber o tamanho).
  const lerNoOrcamento = async (corpo: ReadableStream<Uint8Array> | null): Promise<Uint8Array | null> => {
    if (!corpo) return new Uint8Array();
    const leitor = corpo.getReader();
    const partes: Uint8Array[] = [];
    let lido = 0;
    try {
      for (;;) {
        const { done, value } = await leitor.read();
        if (done) break;
        lido += value.byteLength;
        usado += value.byteLength;
        if (usado > ORCAMENTO_PACOTE) { usado -= lido; await leitor.cancel(); return null; }
        partes.push(value);
      }
    } catch (e) {
      usado -= lido;   // a cópia não entrou: o que foi contado dela volta para o orçamento
      throw e;
    }
    const out = new Uint8Array(lido);
    let i = 0;
    for (const p of partes) { out.set(p, i); i += p.byteLength; }
    return out;
  };

  // Texto: o atual e cada versão retratada.
  const paragrafos: string[] = JSON.parse(t.paragrafos_json);
  arquivos['texto/atual.txt'] = strToU8(`${t.titulo}\n\n${paragrafos.join('\n\n')}\n`);
  arquivos['texto/atual.json'] = json({ id: t.id, titulo: t.titulo, versao: t.versao, conferidaVersao: t.conferido_versao, conferidaEm: t.conferido_em, origem: t.origem, criadoEm: t.created_at, atualizadoEm: t.updated_at, doc: an.est.doc });
  const { results: versoes } = await env.DB.prepare('SELECT versao, titulo, paragrafos_json, motivo, created_at FROM texto_versoes WHERE texto_id = ? AND tenant_id = ? ORDER BY versao')
    .bind(textoId, tenantId).all<{ versao: number; titulo: string; paragrafos_json: string; motivo: string; created_at: string }>();
  for (const v of versoes) arquivos[`texto/versoes/v${v.versao}.json`] = json({ versao: v.versao, titulo: v.titulo, paragrafos: JSON.parse(v.paragrafos_json), retratadaEm: v.created_at, motivo: v.motivo });

  // Dossiê: o texto salvo de cada fonte (é contra ele que a conferência roda) e a cópia do Wayback quando houver.
  const dossie: Record<string, unknown>[] = [];
  await Promise.all(an.evidencias.map(async (e, i) => {
    const n = String(i + 1).padStart(2, '0');
    const base = `dossie/${n}-${slug(e.titulo ?? e.url)}`;
    arquivos[`${base}.txt`] = strToU8(e.texto);
    let copia: string | null = null;
    if (e.wayback?.estado === 'salvo' && e.wayback.url) {
      const ts = e.wayback.url.match(/\/web\/(\d{14})/)?.[1];
      try {
        const r = await fetch(`${baseWayback(env)}/web/${ts}id_/${e.url}`, { signal: AbortSignal.timeout(20_000) });
        if (!r.ok) { await r.body?.cancel(); throw new Error(`HTTP ${r.status}`); }
        const declarado = Number(r.headers.get('content-length') ?? NaN);
        const html = Number.isFinite(declarado) && !cabe(declarado) ? (await r.body?.cancel(), null) : await lerNoOrcamento(r.body);
        if (!html) {
          fora.push({ arquivo: `${base}.wayback.html`, motivo: 'grande', bytes: Number.isFinite(declarado) ? declarado : null, sha256: null });
          throw new Error('grande demais para o pacote');
        }
        arquivos[`${base}.wayback.html`] = html;
        copia = `${base}.wayback.html`;
      } catch (x) {
        copia = `não baixada: ${String(x).slice(0, 120)}`;
      }
    }
    dossie[i] = {
      arquivo: `${base}.txt`, id: e.id, origem: e.origem, url: e.url, titulo: e.titulo, sha256DoTexto: e.hash, acrescentadaEm: e.criadaEm, lidaEm: e.conferidaEm,
      mudouEm: e.mudouEm, lidaPeloNavegador: e.viaNavegador, ...forcaDaEvidencia(e), wayback: e.wayback, copiaDoWayback: copia,
    };
  }));
  arquivos['dossie/evidencias.json'] = json(dossie);

  // Apuração: marcas da última conferência, decisões (com quem e quando), assinaturas e o checklist de agora.
  arquivos['apuracao/marcas.json'] = json(an.afirmacoes.map((a) => ({
    paragrafo: a.paragrafo, trecho: a.trecho, estado: a.estado, risco: a.risco, incerto: a.incerto, explicacao: a.explicacao,
    evidenciaId: a.evidenciaId, trechoDaEvidencia: a.evidenciaTrecho, apuracao: a.apuracao,
  })));
  const { results: decisoes } = await env.DB.prepare(
    `SELECT a.*, u.name AS por_nome, d.name AS desfeita_por_nome FROM apuracoes a LEFT JOIN "user" u ON u.id = a.por LEFT JOIN "user" d ON d.id = a.desfeita_por
      WHERE a.texto_id = ? AND a.tenant_id = ? ORDER BY a.created_at, a.rowid`,
  ).bind(textoId, tenantId).all<Record<string, unknown>>();
  arquivos['apuracao/decisoes.json'] = json(decisoes.map(({ tenant_id: _t, ...d }) => d));
  const { results: assinaturas } = await env.DB.prepare(
    `SELECT s.versao, s.pendencias_json, s.created_at, u.name AS por FROM assinaturas s LEFT JOIN "user" u ON u.id = s.por WHERE s.texto_id = ? AND s.tenant_id = ? ORDER BY s.created_at`,
  ).bind(textoId, tenantId).all<{ versao: number; pendencias_json: string; created_at: string; por: string | null }>();
  arquivos['apuracao/assinaturas.json'] = json(assinaturas.map((s) => ({ versao: s.versao, por: s.por, em: s.created_at, pendencias: JSON.parse(s.pendencias_json) })));
  arquivos['apuracao/checklist.json'] = json({ versao: t.versao, pendencias: an.pendencias, assinatura: an.assinatura });

  // Outro lado: cada pedido com o texto mandado, a hora e a resposta (o texto dela está no dossiê).
  const pedidos = await pedidosDoTexto(env, tenantId, textoId);
  arquivos['outro-lado/pedidos.json'] = json(pedidos.map((p) => ({
    ...p, respostaArquivo: p.respostaEvidenciaId ? (dossie.find((d) => d.id === p.respostaEvidenciaId)?.arquivo ?? null) : null,
  })));

  // Posts aprovados: a versão aprovada, quem aprovou e quando, a versão do texto de onde saiu e a publicação.
  const { results: aprovados } = await env.DB.prepare(
    `SELECT pe.id, pe.formato, pe.status, pa.texto_versao, d.versao, d.created_at AS aprovado_em, u.name AS aprovado_por, v.conteudo_json, pe.arte_r2_keys_json
       FROM pecas pe JOIN pautas pa ON pa.id = pe.pauta_id AND pa.tenant_id = pe.tenant_id
       JOIN decisoes d ON d.peca_id = pe.id AND d.tenant_id = pe.tenant_id AND d.decisao = 'aprovar'
       LEFT JOIN peca_versoes v ON v.peca_id = pe.id AND v.versao = d.versao
       LEFT JOIN "user" u ON u.id = d.por
      WHERE pa.texto_id = ? AND pe.tenant_id = ? ORDER BY d.created_at`,
  ).bind(textoId, tenantId).all<{ id: string; formato: string; status: string; texto_versao: number | null; versao: number; aprovado_em: string; aprovado_por: string | null; conteudo_json: string | null; arte_r2_keys_json: string | null }>();
  for (const p of aprovados) {
    const { results: pubs } = await env.DB.prepare('SELECT rede, modo, url, publicado_em, status FROM publicacoes WHERE peca_id = ? AND tenant_id = ? ORDER BY created_at').bind(p.id, tenantId).all();
    // A arte gravada é uma lista de ArteRenderizada ({ png, jpg, mp4? }); peça antiga pode ter só a chave. O JPG é o
    // que foi para o Instagram; o PNG é o original da renderização.
    const artes: string[] = [];
    for (const [i, a] of (JSON.parse(p.arte_r2_keys_json ?? '[]') as (string | { png?: string; jpg?: string; mp4?: string })[]).entries()) {
      const chaves = typeof a === 'string' ? [a] : [a.mp4, a.jpg, a.png].filter((x): x is string => typeof x === 'string');
      for (const chave of chaves) {
        const nome = chave.endsWith('.mp4') ? `posts/${p.id}/reels.mp4` : `posts/${p.id}/card-${i + 1}.${chave.split('.').pop() ?? 'png'}`;
        if (await incluir(nome, chave)) artes.push(nome);
      }
    }
    arquivos[`posts/${p.id}.json`] = json({
      id: p.id, formato: p.formato, status: p.status, versaoAprovada: p.versao, aprovadoEm: p.aprovado_em, aprovadoPor: p.aprovado_por,
      daVersaoDoTexto: p.texto_versao, conteudo: p.conteudo_json ? JSON.parse(p.conteudo_json) : null, artes, publicacoes: pubs,
    });
  }

  // Documentos (PDF) com as perguntas feitas a eles: o arquivo original e o que foi respondido, com as citações.
  const { results: arqs } = await env.DB.prepare("SELECT id, nome, r2, sha256, paginas, estado, created_at FROM arquivos WHERE texto_id = ? AND tenant_id = ? AND tipo = 'pdf' ORDER BY created_at")
    .bind(textoId, tenantId).all<{ id: string; nome: string; r2: string; sha256: string; paginas: number | null; estado: string; created_at: string }>();
  for (const [i, a] of arqs.entries()) {
    await incluir(`dossie/documentos/${String(i + 1).padStart(2, '0')}-${slug(a.nome.replace(/\.pdf$/i, ''))}.pdf`, a.r2, a.sha256);
  }
  if (arqs.length) {
    const { results: pergs } = await env.DB.prepare('SELECT arquivo_id, pergunta, resposta, citacoes_json, descartadas_json, encontrou, busca, situacao, aviso, created_at FROM perguntas WHERE texto_id = ? AND tenant_id = ? ORDER BY created_at')
      .bind(textoId, tenantId).all<{ arquivo_id: string; pergunta: string; resposta: string | null; citacoes_json: string; descartadas_json: string; encontrou: number; busca: string; situacao: string | null; aviso: string | null; created_at: string }>();
    arquivos['dossie/documentos/documentos.json'] = json(arqs.map((a) => ({
      id: a.id, nome: a.nome, sha256: a.sha256, paginas: a.paginas, estado: a.estado, enviadoEm: a.created_at,
      // situacao: respondida, nao_encontrou, invalida (citação que não confere) ou falhou (o modelo não respondeu).
      perguntas: pergs.filter((p) => p.arquivo_id === a.id).map((p) => ({ pergunta: p.pergunta, situacao: p.situacao, aviso: p.aviso, resposta: p.resposta, citacoes: JSON.parse(p.citacoes_json), descartadas: JSON.parse(p.descartadas_json), em: p.created_at, busca: p.busca })),
    })));
  }

  // Gravações: o áudio original e a transcrição como o Whisper devolveu, trecho a trecho com o tempo de cada palavra.
  const { results: gravs } = await env.DB.prepare("SELECT id, nome, r2, sha256, mime, duracao, estado, erro, created_at FROM arquivos WHERE texto_id = ? AND tenant_id = ? AND tipo = 'audio' ORDER BY created_at")
    .bind(textoId, tenantId).all<{ id: string; nome: string; r2: string; sha256: string; mime: string | null; duracao: number | null; estado: string; erro: string | null; created_at: string }>();
  for (const [i, g] of gravs.entries()) {
    const base = `dossie/gravacoes/${String(i + 1).padStart(2, '0')}-${slug(g.nome.replace(/\.[a-z0-9]{2,4}$/i, ''))}`;
    // Gravação feita no app: um arquivo por segmento, cada um com o próprio hash.
    if (g.r2.endsWith('/')) {
      const { results: partes } = await env.DB.prepare('SELECT n, r2, sha256 FROM gravacao_segmentos WHERE arquivo_id = ? AND tenant_id = ? AND r2 IS NOT NULL ORDER BY n')
        .bind(g.id, tenantId).all<{ n: number; r2: string; sha256: string | null }>();
      for (const p of partes) await incluir(`${base}/parte-${String(p.n + 1).padStart(2, '0')}.${p.r2.split('.').pop()}`, p.r2, p.sha256);
    } else await incluir(`${base}.${g.r2.split('.').pop()}`, g.r2, g.sha256);
    const { results: trechos } = await env.DB.prepare('SELECT inicio, fim, texto, palavras_json FROM gravacao_trechos WHERE arquivo_id = ? AND tenant_id = ? ORDER BY n')
      .bind(g.id, tenantId).all<{ inicio: number; fim: number; texto: string; palavras_json: string }>();
    arquivos[`${base}.transcricao.json`] = json({
      id: g.id, nome: g.nome, sha256: g.sha256, formato: g.mime, duracaoSegundos: g.duracao, estado: g.estado, erro: g.erro, enviadoEm: g.created_at,
      modelo: '@cf/openai/whisper-large-v3-turbo', trechos: trechos.map((t) => ({ inicio: t.inicio, fim: t.fim, texto: t.texto, palavras: JSON.parse(t.palavras_json) })),
    });
  }

  // Matéria viva: os pedidos de LAI (com protocolo, prazos, resposta e recurso) e os alertas com o que foi feito.
  const { results: lais } = await env.DB.prepare(`SELECT id, trecho, orgao, esfera, pedido, protocolo, protocolado_em, prorrogado_em, resposta_em, atendeu, resposta_evidencia_id,
      recurso_tipo, recurso_em, recurso_texto, recurso_resposta_em, recurso_atendeu, recurso_evidencia_id, por, created_at FROM pedidos_lai WHERE texto_id = ? AND tenant_id = ? ORDER BY created_at`)
    .bind(textoId, tenantId).all<Record<string, unknown>>();
  if (lais.length) arquivos['lai/pedidos.json'] = json(lais);
  const { results: alertas } = await env.DB.prepare('SELECT id, tipo, titulo, detalhe_json, estado, acao, nota, pauta_id, peca_id, resolvido_por, resolvido_em, created_at FROM alertas WHERE texto_id = ? AND tenant_id = ? ORDER BY created_at')
    .bind(textoId, tenantId).all<{ detalhe_json: string } & Record<string, unknown>>();
  if (alertas.length) arquivos['depois/alertas.json'] = json(alertas.map(({ detalhe_json, ...a }) => ({ ...a, detalhe: JSON.parse(detalhe_json) })));

  // Página de fontes: cada publicação (a no ar e as retiradas), com o conteúdo congelado.
  const { results: paginas } = await env.DB.prepare('SELECT id, versao, conteudo_json, created_at, retirada_em FROM paginas_fontes WHERE texto_id = ? AND tenant_id = ? ORDER BY created_at')
    .bind(textoId, tenantId).all<{ id: string; versao: number; conteudo_json: string; created_at: string; retirada_em: string | null }>();
  if (paginas.length) arquivos['pagina-de-fontes.json'] = json(paginas.map((p) => ({ url: urlPagina(env, p.id), versao: p.versao, publicadaEm: p.created_at, retiradaEm: p.retirada_em, conteudo: JSON.parse(p.conteudo_json) })));

  // Manifesto: o hash de cada arquivo. O carimbo vale para o manifesto, e o manifesto prende cada arquivo.
  const geradoEm = agora();
  const lista = await Promise.all(Object.keys(arquivos).sort().map(async (caminho) => ({ caminho, sha256: await sha256Bytes(arquivos[caminho]), bytes: arquivos[caminho].byteLength })));
  // Fora do pacote: o caminho que o arquivo teria, o motivo e o SHA-256 guardado no envio (PDF e áudio), que prende o
  // original baixado à parte a este manifesto.
  const manifesto = json({ veiculo: tenant?.nome ?? null, texto: { id: t.id, titulo: t.titulo, versao: t.versao }, geradoEm, geradoPor: quem?.name ?? por, arquivos: lista, foraDoPacote: fora });
  arquivos['manifesto.json'] = manifesto;
  const manifestoSha = await sha256Bytes(manifesto);

  const id = novoId();
  let carimbo: Pacote['carimbo'] = { ok: false, em: null, erro: null };
  let chaveCarimbo: string | null = null;
  try {
    const c = await pedirCarimbo(env, manifesto);
    arquivos['manifesto.json.tsr'] = c.tsr;
    chaveCarimbo = `pacotes/${tenantId}/${id}.tsr`;
    await env.MEDIA.put(chaveCarimbo, c.tsr, { httpMetadata: { contentType: 'application/timestamp-reply' } });
    carimbo = { ok: true, em: c.em, erro: null };
  } catch (e) {
    carimbo = { ok: false, em: null, erro: e instanceof ErroCarimbo ? e.message : String(e).slice(0, 200) };
  }
  arquivos['LEIA-ME.txt'] = strToU8(leiaMe(t.titulo, geradoEm, manifestoSha, carimbo, env.TSA_URL, fora));
  await env.DB.prepare('INSERT INTO pacotes_defesa (id, tenant_id, texto_id, versao, manifesto_sha256, carimbo_r2, carimbo_em, carimbo_erro, por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, tenantId, textoId, t.versao, manifestoSha, chaveCarimbo, carimbo.em, carimbo.erro, por).run();
  await registrarEvento(env, tenantId, 'materia.pacote_defesa', 'texto', textoId, { por, pacoteId: id, manifesto: manifestoSha, carimbo: carimbo.ok, erro: carimbo.erro, fora: fora.length });

  // zipSync devolve um array novo, dono do buffer inteiro. Mídia já comprimida entra sem recompressão.
  const zip = zipSync(Object.fromEntries(Object.entries(arquivos).map(([k, v]) => [k, [v, { level: /\.(png|jpe?g|webp|mp4|mp3|m4a|ogg|webm|flac|pdf)$/.test(k) ? 0 : 6 }]])));
  const nome = `pacote-defesa-${slug(tenant?.slug ?? '')}-${slug(t.titulo)}-v${t.versao}-${geradoEm.slice(0, 10)}.zip`;
  return { zip: zip as Uint8Array<ArrayBuffer>, nome, id, carimbo, arquivos: Object.keys(arquivos).sort(), fora };
}

function leiaMe(titulo: string, geradoEm: string, manifestoSha: string, carimbo: Pacote['carimbo'], tsa: string | undefined, fora: ForaDoPacote[]) {
  const faltam = fora.length ? `

FORA DO PACOTE (${fora.length}): listados em manifesto.json, "foraDoPacote", com o SHA-256 guardado no envio.
${fora.map((f) => `- ${f.arquivo}: ${f.motivo === 'ausente' ? 'o arquivo não está mais no armazenamento' : `grande demais para caber no pacote (${f.bytes} bytes); baixe pelo app`}`).join('\n')}` : '';
  const verificar = carimbo.ok ? `Carimbo de tempo (RFC 3161): manifesto.json.tsr, hora da autoridade ${carimbo.em}.
Autoridade: ${tsa || 'FreeTSA (https://freetsa.org)'}.

Para conferir sem o app (OpenSSL):
  1. Baixe o certificado da autoridade e o da raiz (FreeTSA: https://freetsa.org/files/tsa.crt e https://freetsa.org/files/cacert.pem).
  2. openssl ts -verify -data manifesto.json -in manifesto.json.tsr -CAfile cacert.pem -untrusted tsa.crt
     Deve responder "Verification: OK". Para ver a hora: openssl ts -reply -in manifesto.json.tsr -text
  3. Cada arquivo do pacote tem o SHA-256 no manifesto. Confira com: sha256sum <arquivo> (ou certutil -hashfile <arquivo> SHA256).
Se um arquivo mudar, o hash dele deixa de bater com o manifesto; se o manifesto mudar, o carimbo deixa de conferir.`
    : `SEM CARIMBO DE TEMPO: ${carimbo.erro ?? 'a autoridade não respondeu'}.
O manifesto e os hashes estão aqui, mas sem a prova de hora de terceiros. Gere o pacote de novo quando a autoridade voltar.`;
  return `Pacote de defesa: ${titulo}
Gerado em ${geradoEm}. SHA-256 do manifesto: ${manifestoSha}

O que tem aqui:
- texto/: o texto atual e cada versão retratada (conferência, assinatura, envio ao Instagram, página de fontes, pacote).
- dossie/: cada fonte com o texto salvo quando entrou no dossiê (é contra ele que a conferência roda), o hash, a
  cópia do Wayback Machine quando houver, e as respostas do outro lado.
- apuracao/: as marcas da última conferência, as decisões de cada frase (quem e quando), as assinaturas e o checklist.
- outro-lado/: os pedidos de outro lado, com o texto mandado, a hora (do servidor, quando saiu pelo app; dita pela
  pessoa, quando ela copiou e mandou por fora), o prazo e a resposta.
- posts/: os posts aprovados, com a versão aprovada, quem aprovou e quando, e a publicação.
- pagina-de-fontes.json: a página "Como apuramos", quando publicada.
- manifesto.json: o SHA-256 de cada arquivo acima.${faltam}

${verificar}
`;
}
