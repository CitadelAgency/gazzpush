// Advertiser post: the approval link and the receipt. The advertiser approves without an account: the 32-byte token is
// the only credential, only its SHA-256 is stored, it lasts 7 days and is bound to the piece version. This approval
// does not replace the outlet's review. The GET never decides: WhatsApp opens the link to build its preview.
import type { Env } from '../env';
import { signMedia } from './crypto';
import { stmtEvent, newId, sha256Hex } from './db';
import { fromOutletLanguage, advertisingLabel, type ContentLanguage } from './contentLanguage';
import type { Draft } from './drafting';
import type { ArtRendered } from './render';

export const VALIDITY_LINK_DAYS = 7;
export const COMMENT_MAX = 1000;
const SHAPE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export type ApprovalState = 'sem_link' | 'aguardando' | 'aprovado' | 'ajuste' | 'versao_mudou' | 'expirado';

const h = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const urlLink = (env: Env, token: string) => `${env.PUBLIC_BASE_URL.replace(/\/$/, '')}/anuncio/${token}`;
const inUtc = (s: string) => new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
const sqlDate = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');

function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The piece and the advertiser, only when the lead is advertising. Otherwise null: the route answers 404. */
export async function pieceAd(env: Env, tenantId: string, pieceId: string) {
  return env.DB.prepare(
    `SELECT pc.id, pc.status, pc.versao, a.anunciante FROM pecas pc
       JOIN pautas pa ON pa.id = pc.pauta_id AND pa.tenant_id = pc.tenant_id AND pa.tipo_post = 'publicidade'
       JOIN anuncios a ON a.pauta_id = pa.id AND a.tenant_id = pa.tenant_id
      WHERE pc.id = ? AND pc.tenant_id = ?`,
  ).bind(pieceId, tenantId).first<{ id: string; status: string; versao: number; anunciante: string }>();
}

export async function createLink(env: Env, tenantId: string, piece: { id: string; versao: number }, actor: string, now = new Date()) {
  const token = newToken();
  const expires = new Date(now.getTime() + VALIDITY_LINK_DAYS * 86_400_000);
  await env.DB.prepare('INSERT INTO anuncio_aprovacoes (id, tenant_id, peca_id, versao, token_sha256, expira_em, por) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(newId(), tenantId, piece.id, piece.versao, await sha256Hex(token), sqlDate(expires), actor).run();
  return { url: urlLink(env, token), expiraEm: expires.toISOString() };
}

/** The state for Review: the decision on the current version outweighs a newer link not yet answered. */
export async function approvalState(env: Env, tenantId: string, piece: { id: string; versao: number }, now = new Date()) {
  const r = await env.DB.prepare(
    `SELECT versao, decisao, comentario, decidido_em, expira_em FROM anuncio_aprovacoes WHERE tenant_id = ? AND peca_id = ?
      ORDER BY versao = ? DESC, decidido_em IS NOT NULL DESC, created_at DESC, rowid DESC LIMIT 1`,
  ).bind(tenantId, piece.id, piece.versao).first<{ versao: number; decisao: string | null; comentario: string | null; decidido_em: string | null; expira_em: string }>();
  if (!r) return { estado: 'sem_link' as ApprovalState, em: null, comentario: null };
  if (r.versao !== piece.versao) return { estado: 'versao_mudou' as ApprovalState, em: null, comentario: null };
  if (r.decisao) return { estado: (r.decisao === 'aprovar' ? 'aprovado' : 'ajuste') as ApprovalState, em: r.decidido_em, comentario: r.comentario };
  return { estado: (inUtc(r.expira_em) <= now ? 'expirado' : 'aguardando') as ApprovalState, em: r.expira_em, comentario: null };
}

interface TokenLine {
  id: string; tenant_id: string; peca_id: string; versao: number; expira_em: string; decisao: string | null; comentario: string | null;
  status: string; versao_atual: number; conteudo_json: string; arte_r2_keys_json: string | null; veiculo: string; idioma: string | null; anunciante: string;
}

/** Only this token's row: no other piece is reachable from it. */
async function readToken(env: Env, token: string) {
  if (!SHAPE_TOKEN.test(token)) return null;
  return env.DB.prepare(
    `SELECT a.id, a.tenant_id, a.peca_id, a.versao, a.expira_em, a.decisao, a.comentario, pc.status, pc.versao AS versao_atual, pc.conteudo_json, pc.arte_r2_keys_json,
            t.nome AS veiculo, t.idioma, an.anunciante
       FROM anuncio_aprovacoes a
       JOIN pecas pc ON pc.id = a.peca_id AND pc.tenant_id = a.tenant_id
       JOIN tenants t ON t.id = a.tenant_id
       JOIN anuncios an ON an.pauta_id = pc.pauta_id AND an.tenant_id = a.tenant_id
      WHERE a.token_sha256 = ?`,
  ).bind(await sha256Hex(token)).first<TokenLine>();
}

const state = (l: TokenLine, now: Date) =>
  l.versao !== l.versao_atual || !['revisao', 'aprovada', 'agendada'].includes(l.status) ? 'versao_mudou' as const
    : l.decisao ? 'decidido' as const
      : inUtc(l.expira_em) <= now ? 'expirado' as const : 'aberto' as const;

/** Headers for both public responses: the link is a credential and must not leak, be cached or be indexed. */
export const HEADERS_AD = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex' };

const texts = (en: boolean) => {
  const tr = (pt: string, ing: string) => (en ? ing : pt);
  return {
    titulo: tr('Aprovar a publicidade', 'Approve the advertisement'),
    apoio: (advertiser: string, outlet: string) => tr(`Este é o post de ${advertiser} que ${outlet} preparou. Confira a arte e a legenda.`, `This is the post for ${advertiser} prepared by ${outlet}. Check the images and the caption.`),
    legenda: tr('Legenda', 'Caption'),
    comentario: tr('O que precisa mudar', 'What needs to change'),
    aprovar: tr('Aprovar', 'Approve'),
    ajuste: tr('Pedir ajuste', 'Ask for a change'),
    faltaComentario: tr('Escreva o que precisa mudar.', 'Write what needs to change.'),
    decidido: { aprovar: tr('Aprovado. Obrigado!', 'Approved. Thank you!'), ajuste: tr('Pedido de ajuste enviado.', 'Change request sent.') } as Record<string, string>,
    versao: tr('Este post mudou depois que o link foi gerado. Peça um link novo ao veículo.', 'This post changed after the link was created. Ask the publication for a new link.'),
    expirado: tr('Este link venceu. Peça um link novo ao veículo.', 'This link has expired. Ask the publication for a new link.'),
    invalido: tr('Este link não existe.', "This link doesn't exist."),
    naoEncontrado: tr('Link não encontrado', 'Link not found'),
    alt: (n: number) => tr(`Arte ${n} do post`, `Post image ${n}`),
  };
};

const page = (language: ContentLanguage, title: string, body: string) => `<!DOCTYPE html>
<html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${h(title)}</title>
<style>
:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#F7F9FA;color:#2A2D33;font:400 17px/1.6 system-ui,sans-serif}
main{max-width:560px;margin:0 auto;padding:32px 20px 56px}h1{font-size:28px;line-height:1.2;margin:4px 0 8px;color:#15171B}h2{font-size:17px;margin:24px 0 6px;color:#15171B}
.mono{font-family:ui-monospace,monospace;font-size:13px;color:#5A5E66}.apoio{color:#5A5E66;margin:0 0 16px}
ul{list-style:none;margin:0;padding:0;display:grid;gap:12px}img{display:block;width:100%;height:auto}.legenda{white-space:pre-wrap;margin:0}
label{display:block;font-weight:700;margin:24px 0 6px;color:#15171B}textarea{display:block;width:100%;min-height:96px;padding:10px;font:inherit;border:1px solid #5A5E66;border-radius:4px;background:#fff}
.botoes{display:flex;flex-wrap:wrap;gap:12px;margin-top:16px}button{min-height:48px;padding:0 20px;font:inherit;font-weight:700;border-radius:4px;cursor:pointer}
.sim{background:#0B5CC4;border:1px solid #0B5CC4;color:#fff}.nao{background:#fff;border:1px solid #5A5E66;color:#15171B}.aviso{margin:16px 0 0;padding:10px 12px;background:#FBEFD9;color:#6B4A00;border-radius:4px}
</style></head><body><main>${body}</main></body></html>`;

const pieceInPage = async (env: Env, l: TokenLine, en: boolean) => {
  const tx = texts(en);
  const artwork = JSON.parse(l.arte_r2_keys_json ?? '[]') as ArtRendered[];
  const images = await Promise.all(artwork.map(async (a, i) => `<li><img src="${h(await signMedia(env, a.jpg, 3600))}" alt="${h(tx.alt(i + 1))}" width="1080" height="1350"></li>`));
  const caption = String((JSON.parse(l.conteudo_json) as Draft).legenda ?? '');
  return `<ul>${images.join('')}</ul><h2>${h(tx.legenda)}</h2><p class="legenda">${h(caption)}</p>`;
};

/** Public GET. Never decides. */
export async function adPage(env: Env, token: string, o: { erro?: string } = {}, now = new Date()): Promise<{ html: string; status: 200 | 404 }> {
  const l = await readToken(env, token);
  if (!l) return { status: 404, html: page('pt-BR', texts(false).naoEncontrado, `<h1>${h(texts(false).naoEncontrado)}</h1><p class="apoio">${h(texts(false).invalido)}</p>`) };
  const language = fromOutletLanguage(l.idioma);
  const en = language === 'en';
  const tx = texts(en);
  const head = `<p class="mono">${h(l.veiculo)} · ${h(advertisingLabel(language))}</p><h1>${h(tx.titulo)}</h1><p class="apoio">${h(tx.apoio(l.anunciante, l.veiculo))}</p>`;
  const s = state(l, now);
  if (s === 'versao_mudou') return { status: 200, html: page(language, tx.titulo, `${head}<p class="aviso">${h(tx.versao)}</p>`) };
  if (s === 'expirado') return { status: 200, html: page(language, tx.titulo, `${head}<p class="aviso">${h(tx.expirado)}</p>`) };
  const piece = await pieceInPage(env, l, en);
  if (s === 'decidido') return { status: 200, html: page(language, tx.titulo, `${head}<p class="aviso" role="status">${h(tx.decidido[l.decisao!])}</p>${piece}`) };
  const form = `<form method="post">
<label for="comentario">${h(tx.comentario)}</label><textarea id="comentario" name="comentario" maxlength="${COMMENT_MAX}"></textarea>
${o.erro ? `<p class="aviso" role="alert">${h(o.erro)}</p>` : ''}
<div class="botoes"><button class="sim" name="decisao" value="aprovar">${h(tx.aprovar)}</button><button class="nao" name="decisao" value="ajuste">${h(tx.ajuste)}</button></div></form>`;
  return { status: 200, html: page(language, tx.titulo, `${head}${piece}${form}`) };
}

/** Public POST. The condition lives in the UPDATE itself: two simultaneous submissions do not decide twice. */
export async function decideAd(env: Env, token: string, decision: unknown, commentRaw: unknown, now = new Date()): Promise<{ html: string; status: 200 | 400 | 404 | 409 }> {
  const l = await readToken(env, token);
  if (!l) return adPage(env, token, {}, now);
  const tx = texts(fromOutletLanguage(l.idioma) === 'en');
  const comment = typeof commentRaw === 'string' ? commentRaw.trim().slice(0, COMMENT_MAX) : '';
  if (decision !== 'aprovar' && decision !== 'ajuste') return { ...(await adPage(env, token, {}, now)), status: 400 };
  if (state(l, now) !== 'aberto') return { ...(await adPage(env, token, {}, now)), status: 409 };
  if (decision === 'ajuste' && !comment) return { ...(await adPage(env, token, { erro: tx.faltaComentario }, now)), status: 400 };
  const [r] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE anuncio_aprovacoes SET decisao = ?, comentario = ?, decidido_em = ? WHERE id = ? AND decisao IS NULL
         AND EXISTS (SELECT 1 FROM pecas WHERE id = ? AND tenant_id = ? AND versao = ?)`,
    ).bind(decision, comment || null, sqlDate(now), l.id, l.peca_id, l.tenant_id, l.versao),
    stmtEvent(env, { tenantId: l.tenant_id, tipo: 'anuncio.decidido', refTipo: 'peca', refId: l.peca_id, payload: { versao: l.versao, decisao: decision }, chave: `anuncio:${l.id}` }),
  ]);
  return { ...(await adPage(env, token, {}, now)), status: r.meta.changes ? 200 : 409 };
}

// ── comprovante ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface DataReceipt {
  idioma: ContentLanguage; veiculo: string; anunciante: string; manchete: string; publicadoEm: string | null; url: string | null;
  capa: string | null; aprovadoPor: string | null; aprovadoEm: string | null; anuncianteEm: string | null;
}

export function htmlReceipt(d: DataReceipt) {
  const en = d.idioma === 'en';
  const tr = (pt: string, ing: string) => (en ? ing : pt);
  const data = (s: string | null) => (s ? inUtc(s).toLocaleString(en ? 'en-US' : 'pt-BR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }) : tr('não informado', 'not provided'));
  const line = (label: string, value: string) => `<tr><th scope="row">${h(label)}</th><td>${value}</td></tr>`;
  return `<!DOCTYPE html>
<html lang="${d.idioma}"><head><meta charset="utf-8"><title>${h(tr('Comprovante de publicação', 'Proof of publication'))}</title>
<style>
*{box-sizing:border-box}body{margin:0;padding:48px;color:#2A2D33;font:400 15px/1.5 system-ui,sans-serif}h1{font-size:26px;margin:0 0 4px;color:#15171B}.apoio{color:#5A5E66;margin:0 0 24px}
table{border-collapse:collapse;width:100%;margin:0 0 24px}th,td{text-align:left;vertical-align:top;padding:8px 0;border-top:1px solid #D5D8DC}th{width:190px;font-weight:700;color:#15171B}
img{display:block;width:260px;height:auto}.nota{margin-top:24px;color:#5A5E66;font-size:13px}a{color:inherit;word-break:break-all}
</style></head><body><main>
<h1>${h(tr('Comprovante de publicação', 'Proof of publication'))}</h1><p class="apoio">${h(d.veiculo)}</p>
<table>
${line(tr('Anunciante', 'Advertiser'), h(d.anunciante))}
${line(tr('Manchete', 'Headline'), h(d.manchete))}
${line(tr('Publicado em', 'Published on'), h(data(d.publicadoEm)))}
${line('Link', d.url && /^https?:\/\//.test(d.url) ? `<a href="${h(d.url)}">${h(d.url)}</a>` : h(tr('link não informado', 'link not provided')))}
${line(tr('Aprovado no veículo por', 'Approved at the publication by'), `${h(d.aprovadoPor ?? tr('não registrado', 'not recorded'))}${d.aprovadoEm ? `, ${h(data(d.aprovadoEm))}` : ''}`)}
${line(tr('Aprovado pelo anunciante', 'Approved by the advertiser'), h(d.anuncianteEm ? data(d.anuncianteEm) : tr('sem aprovação pelo link', 'no approval by link')))}
</table>
${d.capa ? `<img src="${h(d.capa)}" alt="${h(tr('Capa do post', 'Post cover'))}">` : ''}
<p class="nota">${h(tr('Este documento comprova a publicação. Não é nota fiscal.', 'This document proves publication. It is not a tax invoice.'))}</p>
</main></body></html>`;
}

export async function dataReceipt(env: Env, tenantId: string, pieceId: string): Promise<DataReceipt | null> {
  const r = await env.DB.prepare(
    `SELECT pc.conteudo_json, pc.arte_r2_keys_json, t.nome AS veiculo, t.idioma, a.anunciante, pu.publicado_em, pu.url,
            (SELECT COALESCE(u.name, d.por) FROM decisoes d LEFT JOIN user u ON u.id = d.por WHERE d.peca_id = pc.id AND d.tenant_id = pc.tenant_id AND d.decisao = 'aprovar' ORDER BY d.created_at DESC LIMIT 1) AS aprovado_por,
            (SELECT d.created_at FROM decisoes d WHERE d.peca_id = pc.id AND d.tenant_id = pc.tenant_id AND d.decisao = 'aprovar' ORDER BY d.created_at DESC LIMIT 1) AS aprovado_em,
            (SELECT ap.decidido_em FROM anuncio_aprovacoes ap WHERE ap.peca_id = pc.id AND ap.tenant_id = pc.tenant_id AND ap.decisao = 'aprovar' AND ap.versao = pc.versao ORDER BY ap.decidido_em DESC LIMIT 1) AS anunciante_em
       FROM pecas pc
       JOIN tenants t ON t.id = pc.tenant_id
       JOIN anuncios a ON a.pauta_id = pc.pauta_id AND a.tenant_id = pc.tenant_id
       JOIN publicacoes pu ON pu.peca_id = pc.id AND pu.tenant_id = pc.tenant_id AND pu.status = 'publicada'
      WHERE pc.id = ? AND pc.tenant_id = ? AND pc.status = 'publicada'
      ORDER BY pu.created_at DESC LIMIT 1`,
  ).bind(pieceId, tenantId).first<Record<string, string | null>>();
  if (!r) return null;
  const artwork = JSON.parse(r.arte_r2_keys_json ?? '[]') as ArtRendered[];
  const obj = artwork[0]?.jpg ? await env.MEDIA.get(artwork[0].jpg) : null;
  let cover: string | null = null;
  if (obj) {
    const u8 = new Uint8Array(await obj.arrayBuffer());
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    cover = `data:image/jpeg;base64,${btoa(s)}`;
  }
  return {
    idioma: fromOutletLanguage(r.idioma), veiculo: r.veiculo!, anunciante: r.anunciante!, manchete: (JSON.parse(r.conteudo_json!) as Draft).manchete,
    publicadoEm: r.publicado_em, url: r.url, capa: cover, aprovadoPor: r.aprovado_por, aprovadoEm: r.aprovado_em, anuncianteEm: r.anunciante_em,
  };
}
