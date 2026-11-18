// Post do anunciante: o link de aprovação e o comprovante. O anunciante aprova sem conta: o token de 32 bytes é a única
// credencial, só o SHA-256 dele fica no banco, vale 7 dias e é preso à versão da peça. Essa aprovação não substitui a
// revisão do veículo. O GET nunca decide: o WhatsApp abre o link para gerar a prévia.
import type { Env } from '../env';
import { assinarMedia } from './crypto';
import { eventoStmt, novoId, sha256Hex } from './db';
import { idiomaDoVeiculo, rotuloPublicidade, type IdiomaConteudo } from './idiomaConteudo';
import type { Rascunho } from './redacao';
import type { ArteRenderizada } from './render';

export const VALIDADE_LINK_DIAS = 7;
export const COMENTARIO_MAX = 1000;
const FORMA_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export type EstadoAprovacao = 'sem_link' | 'aguardando' | 'aprovado' | 'ajuste' | 'versao_mudou' | 'expirado';

const h = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const urlLink = (env: Env, token: string) => `${env.PUBLIC_BASE_URL.replace(/\/$/, '')}/anuncio/${token}`;
const emUtc = (s: string) => new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
const dataSql = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');

function novoToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A peça e o anunciante, só se a pauta for de publicidade. Fora disso, null: a rota responde 404. */
export async function pecaDeAnuncio(env: Env, tenantId: string, pecaId: string) {
  return env.DB.prepare(
    `SELECT pc.id, pc.status, pc.versao, a.anunciante FROM pecas pc
       JOIN pautas pa ON pa.id = pc.pauta_id AND pa.tenant_id = pc.tenant_id AND pa.tipo_post = 'publicidade'
       JOIN anuncios a ON a.pauta_id = pa.id AND a.tenant_id = pa.tenant_id
      WHERE pc.id = ? AND pc.tenant_id = ?`,
  ).bind(pecaId, tenantId).first<{ id: string; status: string; versao: number; anunciante: string }>();
}

export async function criarLink(env: Env, tenantId: string, peca: { id: string; versao: number }, por: string, agora = new Date()) {
  const token = novoToken();
  const expira = new Date(agora.getTime() + VALIDADE_LINK_DIAS * 86_400_000);
  await env.DB.prepare('INSERT INTO anuncio_aprovacoes (id, tenant_id, peca_id, versao, token_sha256, expira_em, por) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(novoId(), tenantId, peca.id, peca.versao, await sha256Hex(token), dataSql(expira), por).run();
  return { url: urlLink(env, token), expiraEm: expira.toISOString() };
}

/** O estado para a Revisão: a decisão da versão atual vale mais que um link novo ainda sem resposta. */
export async function estadoAprovacao(env: Env, tenantId: string, peca: { id: string; versao: number }, agora = new Date()) {
  const r = await env.DB.prepare(
    `SELECT versao, decisao, comentario, decidido_em, expira_em FROM anuncio_aprovacoes WHERE tenant_id = ? AND peca_id = ?
      ORDER BY versao = ? DESC, decidido_em IS NOT NULL DESC, created_at DESC, rowid DESC LIMIT 1`,
  ).bind(tenantId, peca.id, peca.versao).first<{ versao: number; decisao: string | null; comentario: string | null; decidido_em: string | null; expira_em: string }>();
  if (!r) return { estado: 'sem_link' as EstadoAprovacao, em: null, comentario: null };
  if (r.versao !== peca.versao) return { estado: 'versao_mudou' as EstadoAprovacao, em: null, comentario: null };
  if (r.decisao) return { estado: (r.decisao === 'aprovar' ? 'aprovado' : 'ajuste') as EstadoAprovacao, em: r.decidido_em, comentario: r.comentario };
  return { estado: (emUtc(r.expira_em) <= agora ? 'expirado' : 'aguardando') as EstadoAprovacao, em: r.expira_em, comentario: null };
}

interface LinhaToken {
  id: string; tenant_id: string; peca_id: string; versao: number; expira_em: string; decisao: string | null; comentario: string | null;
  status: string; versao_atual: number; conteudo_json: string; arte_r2_keys_json: string | null; veiculo: string; idioma: string | null; anunciante: string;
}

/** Só a linha deste token: nenhuma outra peça é alcançável a partir dele. */
async function lerToken(env: Env, token: string) {
  if (!FORMA_TOKEN.test(token)) return null;
  return env.DB.prepare(
    `SELECT a.id, a.tenant_id, a.peca_id, a.versao, a.expira_em, a.decisao, a.comentario, pc.status, pc.versao AS versao_atual, pc.conteudo_json, pc.arte_r2_keys_json,
            t.nome AS veiculo, t.idioma, an.anunciante
       FROM anuncio_aprovacoes a
       JOIN pecas pc ON pc.id = a.peca_id AND pc.tenant_id = a.tenant_id
       JOIN tenants t ON t.id = a.tenant_id
       JOIN anuncios an ON an.pauta_id = pc.pauta_id AND an.tenant_id = a.tenant_id
      WHERE a.token_sha256 = ?`,
  ).bind(await sha256Hex(token)).first<LinhaToken>();
}

const situacao = (l: LinhaToken, agora: Date) =>
  l.versao !== l.versao_atual || !['revisao', 'aprovada', 'agendada'].includes(l.status) ? 'versao_mudou' as const
    : l.decisao ? 'decidido' as const
      : emUtc(l.expira_em) <= agora ? 'expirado' as const : 'aberto' as const;

/** Cabeçalhos das duas respostas públicas: o link é uma credencial e não pode vazar nem ficar em cache ou em busca. */
export const CABECALHOS_ANUNCIO = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex' };

const textos = (en: boolean) => {
  const tr = (pt: string, ing: string) => (en ? ing : pt);
  return {
    titulo: tr('Aprovar a publicidade', 'Approve the advertisement'),
    apoio: (anunciante: string, veiculo: string) => tr(`Este é o post de ${anunciante} que ${veiculo} preparou. Confira a arte e a legenda.`, `This is the post for ${anunciante} prepared by ${veiculo}. Check the images and the caption.`),
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

const pagina = (idioma: IdiomaConteudo, titulo: string, corpo: string) => `<!DOCTYPE html>
<html lang="${idioma}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${h(titulo)}</title>
<style>
:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#F7F9FA;color:#2A2D33;font:400 17px/1.6 system-ui,sans-serif}
main{max-width:560px;margin:0 auto;padding:32px 20px 56px}h1{font-size:28px;line-height:1.2;margin:4px 0 8px;color:#15171B}h2{font-size:17px;margin:24px 0 6px;color:#15171B}
.mono{font-family:ui-monospace,monospace;font-size:13px;color:#5A5E66}.apoio{color:#5A5E66;margin:0 0 16px}
ul{list-style:none;margin:0;padding:0;display:grid;gap:12px}img{display:block;width:100%;height:auto}.legenda{white-space:pre-wrap;margin:0}
label{display:block;font-weight:700;margin:24px 0 6px;color:#15171B}textarea{display:block;width:100%;min-height:96px;padding:10px;font:inherit;border:1px solid #5A5E66;border-radius:4px;background:#fff}
.botoes{display:flex;flex-wrap:wrap;gap:12px;margin-top:16px}button{min-height:48px;padding:0 20px;font:inherit;font-weight:700;border-radius:4px;cursor:pointer}
.sim{background:#0B5CC4;border:1px solid #0B5CC4;color:#fff}.nao{background:#fff;border:1px solid #5A5E66;color:#15171B}.aviso{margin:16px 0 0;padding:10px 12px;background:#FBEFD9;color:#6B4A00;border-radius:4px}
</style></head><body><main>${corpo}</main></body></html>`;

const pecaNaPagina = async (env: Env, l: LinhaToken, en: boolean) => {
  const tx = textos(en);
  const artes = JSON.parse(l.arte_r2_keys_json ?? '[]') as ArteRenderizada[];
  const imagens = await Promise.all(artes.map(async (a, i) => `<li><img src="${h(await assinarMedia(env, a.jpg, 3600))}" alt="${h(tx.alt(i + 1))}" width="1080" height="1350"></li>`));
  const legenda = String((JSON.parse(l.conteudo_json) as Rascunho).legenda ?? '');
  return `<ul>${imagens.join('')}</ul><h2>${h(tx.legenda)}</h2><p class="legenda">${h(legenda)}</p>`;
};

/** GET público. Nunca decide. */
export async function paginaAnuncio(env: Env, token: string, o: { erro?: string } = {}, agora = new Date()): Promise<{ html: string; status: 200 | 404 }> {
  const l = await lerToken(env, token);
  if (!l) return { status: 404, html: pagina('pt-BR', textos(false).naoEncontrado, `<h1>${h(textos(false).naoEncontrado)}</h1><p class="apoio">${h(textos(false).invalido)}</p>`) };
  const idioma = idiomaDoVeiculo(l.idioma);
  const en = idioma === 'en';
  const tx = textos(en);
  const cabeca = `<p class="mono">${h(l.veiculo)} · ${h(rotuloPublicidade(idioma))}</p><h1>${h(tx.titulo)}</h1><p class="apoio">${h(tx.apoio(l.anunciante, l.veiculo))}</p>`;
  const s = situacao(l, agora);
  if (s === 'versao_mudou') return { status: 200, html: pagina(idioma, tx.titulo, `${cabeca}<p class="aviso">${h(tx.versao)}</p>`) };
  if (s === 'expirado') return { status: 200, html: pagina(idioma, tx.titulo, `${cabeca}<p class="aviso">${h(tx.expirado)}</p>`) };
  const peca = await pecaNaPagina(env, l, en);
  if (s === 'decidido') return { status: 200, html: pagina(idioma, tx.titulo, `${cabeca}<p class="aviso" role="status">${h(tx.decidido[l.decisao!])}</p>${peca}`) };
  const form = `<form method="post">
<label for="comentario">${h(tx.comentario)}</label><textarea id="comentario" name="comentario" maxlength="${COMENTARIO_MAX}"></textarea>
${o.erro ? `<p class="aviso" role="alert">${h(o.erro)}</p>` : ''}
<div class="botoes"><button class="sim" name="decisao" value="aprovar">${h(tx.aprovar)}</button><button class="nao" name="decisao" value="ajuste">${h(tx.ajuste)}</button></div></form>`;
  return { status: 200, html: pagina(idioma, tx.titulo, `${cabeca}${peca}${form}`) };
}

/** POST público. A condição fica no próprio UPDATE: dois envios ao mesmo tempo não decidem duas vezes. */
export async function decidirAnuncio(env: Env, token: string, decisao: unknown, comentarioBruto: unknown, agora = new Date()): Promise<{ html: string; status: 200 | 400 | 404 | 409 }> {
  const l = await lerToken(env, token);
  if (!l) return paginaAnuncio(env, token, {}, agora);
  const tx = textos(idiomaDoVeiculo(l.idioma) === 'en');
  const comentario = typeof comentarioBruto === 'string' ? comentarioBruto.trim().slice(0, COMENTARIO_MAX) : '';
  if (decisao !== 'aprovar' && decisao !== 'ajuste') return { ...(await paginaAnuncio(env, token, {}, agora)), status: 400 };
  if (situacao(l, agora) !== 'aberto') return { ...(await paginaAnuncio(env, token, {}, agora)), status: 409 };
  if (decisao === 'ajuste' && !comentario) return { ...(await paginaAnuncio(env, token, { erro: tx.faltaComentario }, agora)), status: 400 };
  const [r] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE anuncio_aprovacoes SET decisao = ?, comentario = ?, decidido_em = ? WHERE id = ? AND decisao IS NULL
         AND EXISTS (SELECT 1 FROM pecas WHERE id = ? AND tenant_id = ? AND versao = ?)`,
    ).bind(decisao, comentario || null, dataSql(agora), l.id, l.peca_id, l.tenant_id, l.versao),
    eventoStmt(env, { tenantId: l.tenant_id, tipo: 'anuncio.decidido', refTipo: 'peca', refId: l.peca_id, payload: { versao: l.versao, decisao }, chave: `anuncio:${l.id}` }),
  ]);
  return { ...(await paginaAnuncio(env, token, {}, agora)), status: r.meta.changes ? 200 : 409 };
}

// ── comprovante ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface DadosComprovante {
  idioma: IdiomaConteudo; veiculo: string; anunciante: string; manchete: string; publicadoEm: string | null; url: string | null;
  capa: string | null; aprovadoPor: string | null; aprovadoEm: string | null; anuncianteEm: string | null;
}

export function htmlComprovante(d: DadosComprovante) {
  const en = d.idioma === 'en';
  const tr = (pt: string, ing: string) => (en ? ing : pt);
  const data = (s: string | null) => (s ? emUtc(s).toLocaleString(en ? 'en-US' : 'pt-BR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }) : tr('não informado', 'not provided'));
  const linha = (rotulo: string, valor: string) => `<tr><th scope="row">${h(rotulo)}</th><td>${valor}</td></tr>`;
  return `<!DOCTYPE html>
<html lang="${d.idioma}"><head><meta charset="utf-8"><title>${h(tr('Comprovante de publicação', 'Proof of publication'))}</title>
<style>
*{box-sizing:border-box}body{margin:0;padding:48px;color:#2A2D33;font:400 15px/1.5 system-ui,sans-serif}h1{font-size:26px;margin:0 0 4px;color:#15171B}.apoio{color:#5A5E66;margin:0 0 24px}
table{border-collapse:collapse;width:100%;margin:0 0 24px}th,td{text-align:left;vertical-align:top;padding:8px 0;border-top:1px solid #D5D8DC}th{width:190px;font-weight:700;color:#15171B}
img{display:block;width:260px;height:auto}.nota{margin-top:24px;color:#5A5E66;font-size:13px}a{color:inherit;word-break:break-all}
</style></head><body><main>
<h1>${h(tr('Comprovante de publicação', 'Proof of publication'))}</h1><p class="apoio">${h(d.veiculo)}</p>
<table>
${linha(tr('Anunciante', 'Advertiser'), h(d.anunciante))}
${linha(tr('Manchete', 'Headline'), h(d.manchete))}
${linha(tr('Publicado em', 'Published on'), h(data(d.publicadoEm)))}
${linha('Link', d.url && /^https?:\/\//.test(d.url) ? `<a href="${h(d.url)}">${h(d.url)}</a>` : h(tr('link não informado', 'link not provided')))}
${linha(tr('Aprovado no veículo por', 'Approved at the publication by'), `${h(d.aprovadoPor ?? tr('não registrado', 'not recorded'))}${d.aprovadoEm ? `, ${h(data(d.aprovadoEm))}` : ''}`)}
${linha(tr('Aprovado pelo anunciante', 'Approved by the advertiser'), h(d.anuncianteEm ? data(d.anuncianteEm) : tr('sem aprovação pelo link', 'no approval by link')))}
</table>
${d.capa ? `<img src="${h(d.capa)}" alt="${h(tr('Capa do post', 'Post cover'))}">` : ''}
<p class="nota">${h(tr('Este documento comprova a publicação. Não é nota fiscal.', 'This document proves publication. It is not a tax invoice.'))}</p>
</main></body></html>`;
}

export async function dadosComprovante(env: Env, tenantId: string, pecaId: string): Promise<DadosComprovante | null> {
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
  ).bind(pecaId, tenantId).first<Record<string, string | null>>();
  if (!r) return null;
  const artes = JSON.parse(r.arte_r2_keys_json ?? '[]') as ArteRenderizada[];
  const obj = artes[0]?.jpg ? await env.MEDIA.get(artes[0].jpg) : null;
  let capa: string | null = null;
  if (obj) {
    const u8 = new Uint8Array(await obj.arrayBuffer());
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    capa = `data:image/jpeg;base64,${btoa(s)}`;
  }
  return {
    idioma: idiomaDoVeiculo(r.idioma), veiculo: r.veiculo!, anunciante: r.anunciante!, manchete: (JSON.parse(r.conteudo_json!) as Rascunho).manchete,
    publicadoEm: r.publicado_em, url: r.url, capa, aprovadoPor: r.aprovado_por, aprovadoEm: r.aprovado_em, anuncianteEm: r.anunciante_em,
  };
}
