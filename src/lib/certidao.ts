// Certidão de um post publicado: o manifesto (fontes, artes, aprovação, publicação), com carimbo de tempo RFC 3161. É
// emitida na publicação, porque carimbo feito depois de a conta cair não prova nada sobre a data do post.
import { strToU8, zipSync } from 'fflate';
import type { Env } from '../env';
import { pedirCarimbo } from './carimbo';
import { novoId, registrarEvento } from './db';
import { gerarPdf } from './pdf';
import { levaArte, normalizarCards } from './cards';
import type { ArteRenderizada } from './render';
import type { Rascunho } from './redacao';

export type OrigemArte =
  | { tipo: 'foto'; autor: string; origem: string }
  | { tipo: 'ilustracao'; de: 'card' | 'post'; modelo: string }
  | { tipo: 'sem_arte' };

export interface Manifesto {
  veiculo: string; idioma: string; peca: { id: string; formato: string; versao: number; manchete: string | null; legenda: string | null };
  fontes: { url: string | null; titulo: string | null; sha256: string; capturadoEm: string | null }[];
  artes: { papel: string; card: string | null; arquivos: { nome: string; sha256: string | null }[] }[];
  ilustracao: { visualBrief: string; modelo: string };
  /** Por card, de onde veio a arte. Certidão emitida antes da Etapa 17 não tem este campo. */
  origemArte?: { card: string; titulo: string; origem: OrigemArte }[];
  versoes: { versao: number; autor: string; modelo: string | null; em: string }[];
  aprovacao: { por: string; ligadoPor: string | null; versao: number | null; em: string | null };
  publicacao: { rede: string; modo: string; url: string | null; externalId: string | null; em: string | null };
  geradoEm: string;
}

const NAO_REGISTRADO = 'não registrado';

async function sha256De(env: Env, chave: string): Promise<string | null> {
  const obj = await env.MEDIA.get(chave);
  if (!obj) return null;
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', await obj.arrayBuffer()));
  return [...d].map((x) => x.toString(16).padStart(2, '0')).join('');
}
const sha256Texto = async (s: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", s as Uint8Array<ArrayBuffer>))].map((x) => x.toString(16).padStart(2, '0')).join('');

interface LinhaPeca {
  id: string; pauta_id: string; status: string; formato: string; versao: number; conteudo_json: string | null; arte_r2_keys_json: string | null;
  veiculo: string; idioma: string; fato_ids_json: string;
}

async function lerPeca(env: Env, tenantId: string, pecaId: string) {
  return env.DB.prepare(
    `SELECT pc.id, pc.pauta_id, pc.status, pc.formato, pc.versao, pc.conteudo_json, pc.arte_r2_keys_json, t.nome AS veiculo, t.idioma, pa.fato_ids_json
       FROM pecas pc JOIN tenants t ON t.id = pc.tenant_id JOIN pautas pa ON pa.id = pc.pauta_id AND pa.tenant_id = pc.tenant_id
      WHERE pc.id = ? AND pc.tenant_id = ?`,
  ).bind(pecaId, tenantId).first<LinhaPeca>();
}

export async function montarManifesto(env: Env, tenantId: string, p: LinhaPeca): Promise<Manifesto> {
  const conteudo = (p.conteudo_json ? JSON.parse(p.conteudo_json) : {}) as Partial<Rascunho>;
  const [fontes, versoes, decisao, publicacao, ilustracao, doCard] = await Promise.all([
    env.DB.prepare(`SELECT DISTINCT d.url, d.titulo, d.hash_texto, d.capturado_em FROM fatos f JOIN documentos d ON d.id = f.documento_id AND d.tenant_id = f.tenant_id
                     WHERE f.tenant_id = ? AND f.id IN (SELECT value FROM json_each(?)) ORDER BY d.capturado_em`)
      .bind(tenantId, p.fato_ids_json).all<{ url: string | null; titulo: string | null; hash_texto: string; capturado_em: string | null }>(),
    env.DB.prepare('SELECT versao, autor, modelo, created_at FROM peca_versoes WHERE peca_id = ? AND tenant_id = ? ORDER BY versao').bind(p.id, tenantId).all<{ versao: number; autor: string; modelo: string | null; created_at: string }>(),
    env.DB.prepare(`SELECT d.por, d.versao, d.created_at, d.payload_json, u.name FROM decisoes d LEFT JOIN user u ON u.id = d.por
                     WHERE d.peca_id = ? AND d.tenant_id = ? AND d.decisao = 'aprovar' ORDER BY d.created_at DESC LIMIT 1`).bind(p.id, tenantId)
      .first<{ por: string; versao: number; created_at: string; payload_json: string | null; name: string | null }>(),
    env.DB.prepare("SELECT rede, modo, url, external_id, publicado_em FROM publicacoes WHERE peca_id = ? AND tenant_id = ? AND status = 'publicada' ORDER BY created_at DESC LIMIT 1")
      .bind(p.id, tenantId).first<{ rede: string; modo: string; url: string | null; external_id: string | null; publicado_em: string | null }>(),
    env.DB.prepare("SELECT payload_json FROM eventos WHERE tenant_id = ? AND ref_id = ? AND tipo = 'peca.ilustracao' ORDER BY id DESC LIMIT 1").bind(tenantId, p.id).first<{ payload_json: string | null }>(),
    env.DB.prepare("SELECT payload_json FROM eventos WHERE tenant_id = ? AND ref_id = ? AND tipo = 'peca.ilustracao_card'").bind(tenantId, p.id).all<{ payload_json: string }>(),
  ]);
  const artes = (p.arte_r2_keys_json ? JSON.parse(p.arte_r2_keys_json) : []) as (ArteRenderizada & { mp4?: string })[];
  const ligadoPor = decisao?.por === 'piloto' ? (JSON.parse(decisao.payload_json ?? '{}') as { ligadoPor?: string }).ligadoPor ?? null : null;
  const nomeLigou = ligadoPor ? (await env.DB.prepare('SELECT name FROM user WHERE id = ?').bind(ligadoPor).first<{ name: string }>())?.name ?? ligadoPor : null;
  const prov = (ilustracao?.payload_json ? JSON.parse(ilustracao.payload_json) : {}) as { provedor?: string; modelo?: string };
  const provedores = new Map(doCard.results.map((e) => JSON.parse(e.payload_json) as { r2Key: string; provedor: string }).map((e) => [e.r2Key, e.provedor]));
  const composicao = conteudo.estilo?.params.composicao;
  const cardsDoPost = normalizarCards(conteudo.cards);
  const origemArte = (p.formato === 'post' ? cardsDoPost.slice(0, 1) : cardsDoPost).map((card) => {
    const origem: OrigemArte = !levaArte(card, composicao) ? { tipo: 'sem_arte' }
      : card.imagem ? { tipo: 'foto', autor: card.fotoOrigem?.autor ?? NAO_REGISTRADO, origem: card.fotoOrigem?.tipo ?? NAO_REGISTRADO }
        : card.ilustracao ? { tipo: 'ilustracao', de: 'card', modelo: provedores.get(card.ilustracao) ?? NAO_REGISTRADO }
          : { tipo: 'ilustracao', de: 'post', modelo: prov.modelo ?? prov.provedor ?? NAO_REGISTRADO };
    return { card: card.id, titulo: card.titulo, origem };
  });
  return {
    veiculo: p.veiculo, idioma: p.idioma,
    peca: { id: p.id, formato: p.formato, versao: p.versao, manchete: conteudo.manchete ?? null, legenda: conteudo.legenda ?? null },
    fontes: fontes.results.map((f) => ({ url: f.url, titulo: f.titulo, sha256: f.hash_texto, capturadoEm: f.capturado_em })),
    artes: await Promise.all(artes.map(async (a) => ({
      papel: a.papel, card: a.id ?? null,
      arquivos: await Promise.all([a.png, a.jpg, a.mp4].filter((k): k is string => !!k).map(async (nome) => ({ nome: nome.split('/').pop()!, sha256: await sha256De(env, nome) }))),
    }))),
    ilustracao: { visualBrief: conteudo.visualBrief?.primary ?? NAO_REGISTRADO, modelo: prov.modelo ?? prov.provedor ?? NAO_REGISTRADO },
    origemArte,
    versoes: versoes.results.map((v) => ({ versao: v.versao, autor: v.autor, modelo: v.modelo, em: v.created_at })),
    aprovacao: { por: decisao ? (decisao.por === 'piloto' ? 'piloto' : decisao.name ?? decisao.por) : NAO_REGISTRADO, ligadoPor: nomeLigou, versao: decisao?.versao ?? null, em: decisao?.created_at ?? null },
    publicacao: { rede: publicacao?.rede ?? NAO_REGISTRADO, modo: publicacao?.modo ?? NAO_REGISTRADO, url: publicacao?.url ?? null, externalId: publicacao?.external_id ?? null, em: publicacao?.publicado_em ?? null },
    geradoEm: new Date().toISOString(),
  };
}

export interface LinhaCertidao {
  id: string; peca_id: string; versao: number; sha256: string | null; r2_manifesto: string | null; r2_carimbo: string | null;
  carimbo_em: string | null; tsa: string | null; erro: string | null; na_publicacao: number; created_at: string;
}

const linhaDe = (env: Env, tenantId: string, pecaId: string, versao: number) =>
  env.DB.prepare('SELECT * FROM certidoes WHERE tenant_id = ? AND peca_id = ? AND versao = ?').bind(tenantId, pecaId, versao).first<LinhaCertidao>();

/**
 * Emite a certidão da versão publicada. Repetir não duplica: a linha é uma por peça e versão, e a que já tem carimbo
 * volta como está. Autoridade fora do ar: lança, e a fila tenta de novo; a publicação nunca espera por isso.
 */
export async function emitirCertidao(env: Env, tenantId: string, pecaId: string, naPublicacao: boolean): Promise<LinhaCertidao | null> {
  const p = await lerPeca(env, tenantId, pecaId);
  if (!p || p.status !== 'publicada') return null;
  const existente = await linhaDe(env, tenantId, pecaId, p.versao);
  if (existente?.sha256) return existente;
  const manifesto = await montarManifesto(env, tenantId, p);
  const bytes = strToU8(JSON.stringify(manifesto, null, 2));
  const c = await pedirCarimbo(env, bytes);
  const sha = await sha256Texto(bytes);
  const id = existente?.id ?? novoId();
  const base = `certidoes/${tenantId}/${pecaId}/v${p.versao}`;
  await Promise.all([
    env.MEDIA.put(`${base}-${id}.json`, bytes, { httpMetadata: { contentType: 'application/json' } }),
    env.MEDIA.put(`${base}-${id}.tsr`, c.tsr, { httpMetadata: { contentType: 'application/timestamp-reply' } }),
  ]);
  // Quem começou na publicação e só depois saiu continua `na_publicacao`, e a falha some.
  await env.DB.prepare(`INSERT INTO certidoes (id, tenant_id, peca_id, versao, sha256, r2_manifesto, r2_carimbo, carimbo_em, tsa, erro, na_publicacao) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
    ON CONFLICT (peca_id, versao) DO UPDATE SET sha256 = excluded.sha256, r2_manifesto = excluded.r2_manifesto, r2_carimbo = excluded.r2_carimbo, carimbo_em = excluded.carimbo_em, tsa = excluded.tsa, erro = NULL`)
    .bind(id, tenantId, pecaId, p.versao, sha, `${base}-${id}.json`, `${base}-${id}.tsr`, c.em, c.tsa, naPublicacao ? 1 : 0).run();
  await registrarEvento(env, tenantId, 'peca.certidao', 'peca', pecaId, { versao: p.versao, sha256: sha, carimboEm: c.em }, `${pecaId}:v${p.versao}:certidao`);
  return linhaDe(env, tenantId, pecaId, p.versao);
}

/** Tentativas esgotadas: a falha fica à vista na peça, e "Gerar certidão" tenta de novo. */
export async function falharCertidao(env: Env, tenantId: string, pecaId: string, erro: string) {
  const p = await env.DB.prepare('SELECT versao FROM pecas WHERE id = ? AND tenant_id = ?').bind(pecaId, tenantId).first<{ versao: number }>();
  if (!p) return;
  await env.DB.prepare(`INSERT INTO certidoes (id, tenant_id, peca_id, versao, erro) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (peca_id, versao) DO UPDATE SET erro = excluded.erro WHERE certidoes.sha256 IS NULL`).bind(novoId(), tenantId, pecaId, p.versao, erro.slice(0, 300)).run();
}

const h = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function htmlCertidao(m: Manifesto, c: Pick<LinhaCertidao, 'sha256' | 'carimbo_em' | 'tsa' | 'na_publicacao'>) {
  const en = m.idioma === 'en';
  const tr = (pt: string, ing: string) => (en ? ing : pt);
  const nr = (s: string | null) => (s === NAO_REGISTRADO ? tr('não registrado', 'not recorded') : s ?? tr('não registrado', 'not recorded'));
  const linha = (rotulo: string, valor: string) => `<tr><th scope="row">${h(rotulo)}</th><td>${h(valor)}</td></tr>`;
  const origens = m.origemArte ?? [];
  const nomeFoto: Record<string, string> = { minha: tr('foto do autor', 'photo by the author'), equipe: tr('foto da equipe do veículo', 'photo by the team'), autorizada: tr('foto de terceiro, com autorização', 'third-party photo, with permission') };
  const origemTexto = (o: OrigemArte) => o.tipo === 'sem_arte' ? tr('sem arte', 'no artwork')
    : o.tipo === 'foto' ? `${nomeFoto[o.origem] ?? tr('foto, origem não registrada', 'photo, origin not recorded')}: ${nr(o.autor)}`
      : `${o.de === 'card' ? tr('ilustração gerada para este card', 'illustration generated for this card') : tr('ilustração gerada para o post', 'illustration generated for the post')}: ${nr(o.modelo)}`;
  const quem = m.aprovacao.por === 'piloto'
    ? tr(`Piloto automático, ligado por ${m.aprovacao.ligadoPor ?? 'não registrado'}`, `Autopilot, turned on by ${m.aprovacao.ligadoPor ?? 'not recorded'}`)
    : nr(m.aprovacao.por);
  return `<!DOCTYPE html>
<html lang="${h(m.idioma)}"><head><meta charset="utf-8"><title>${h(tr('Certidão de publicação', 'Publication certificate'))}</title>
<style>
*{box-sizing:border-box}body{margin:0;padding:48px;color:#2A2D33;font:400 14px/1.5 system-ui,sans-serif}h1{font-size:26px;margin:0 0 4px;color:#15171B}h2{font-size:16px;margin:24px 0 6px;color:#15171B}.apoio{color:#5A5E66;margin:0 0 20px}
table{border-collapse:collapse;width:100%}th,td{text-align:left;vertical-align:top;padding:6px 0;border-top:1px solid #D5D8DC}th{width:190px;font-weight:700;color:#15171B}.h{font:12px ui-monospace,monospace;word-break:break-all}.nota{margin-top:20px;color:#5A5E66;font-size:13px}
ul{margin:0;padding-left:18px}
</style></head><body><main>
<h1>${h(tr('Certidão de publicação', 'Publication certificate'))}</h1><p class="apoio">${h(m.veiculo)}</p>
${c.na_publicacao ? '' : `<p><strong>${h(tr('O carimbo de tempo desta certidão é posterior à publicação.', 'The timestamp on this certificate is later than the publication.'))}</strong></p>`}
<table>
${linha(tr('Manchete', 'Headline'), m.peca.manchete ?? '')}
${linha(tr('Versão', 'Version'), String(m.peca.versao))}
${linha(tr('Aprovado por', 'Approved by'), quem)}
${linha(tr('Aprovado em', 'Approved on'), nr(m.aprovacao.em))}
${linha(tr('Publicado em', 'Published on'), nr(m.publicacao.em))}
${linha(tr('Link', 'Link'), m.publicacao.url ?? tr('não informado', 'not provided'))}
${linha(tr('Carimbo de tempo', 'Timestamp'), `${c.carimbo_em ?? ''} (${c.tsa ?? ''})`)}
${linha(tr('Ilustração', 'Illustration'), `${nr(m.ilustracao.modelo)}: ${nr(m.ilustracao.visualBrief)}`)}
</table>
<h2>${h(tr('Fontes', 'Sources'))}</h2>
${m.fontes.length ? `<ul>${m.fontes.map((f) => `<li>${h(f.titulo ?? f.url)}${f.url ? ` (${h(f.url)})` : ''}, ${h(f.capturadoEm)} <span class="h">${h(f.sha256)}</span></li>`).join('')}</ul>` : `<p>${h(tr('Nenhuma fonte registrada.', 'No source recorded.'))}</p>`}
<h2>${h(tr('Artes', 'Artwork'))}</h2>
<ul>${m.artes.flatMap((a) => a.arquivos.map((x) => `<li>${h(a.papel)} · ${h(x.nome)} <span class="h">${h(x.sha256 ?? tr('arquivo não encontrado', 'file not found'))}</span></li>`)).join('')}</ul>
${origens.length ? `<h2>${h(tr('Origem da arte, por card', 'Artwork origin, by card'))}</h2>
<ul>${origens.map((o) => `<li>${h(o.titulo || o.card)}: ${h(origemTexto(o.origem))}</li>`).join('')}</ul>` : ''}
<p class="nota">SHA-256 ${h(tr('do manifesto', 'of the manifest'))}: <span class="h">${h(c.sha256)}</span></p>
<p class="nota">${h(tr('Esta certidão registra o que o app guardou sobre o post. Não é documento oficial nem orientação jurídica.', 'This certificate records what the app stored about the post. It is not an official document or legal advice.'))}</p>
</main></body></html>`;
}

function leiaMe(m: Manifesto, c: LinhaCertidao) {
  return `Certidão de publicação: ${m.peca.manchete ?? m.peca.id}
${m.veiculo}. SHA-256 do manifesto: ${c.sha256}
${c.na_publicacao ? '' : '\nO carimbo de tempo desta certidão é posterior à publicação.\n'}
O que tem aqui:
- certidao.pdf: a certidão legível.
- manifesto.json: fontes, artes, origem da arte por card, aprovação e publicação, com os SHA-256.
- carimbo.tsr: o carimbo de tempo RFC 3161 do manifesto, hora da autoridade ${c.carimbo_em}.

Para conferir sem o app (OpenSSL):
  1. Baixe o certificado da autoridade e o da raiz (FreeTSA: https://freetsa.org/files/tsa.crt e https://freetsa.org/files/cacert.pem).
  2. openssl ts -verify -data manifesto.json -in carimbo.tsr -CAfile cacert.pem -untrusted tsa.crt
     Deve responder "Verification: OK". Para ver a hora: openssl ts -reply -in carimbo.tsr -text
Se o manifesto mudar, o carimbo deixa de conferir.
`;
}

/** O zip da certidão, ou null sem certidão pronta. */
export async function pacoteCertidao(env: Env, tenantId: string, pecaId: string): Promise<{ zip: Uint8Array<ArrayBuffer>; nome: string } | null> {
  const p = await env.DB.prepare('SELECT versao FROM pecas WHERE id = ? AND tenant_id = ?').bind(pecaId, tenantId).first<{ versao: number }>();
  if (!p) return null;
  const c = await linhaDe(env, tenantId, pecaId, p.versao);
  if (!c?.r2_manifesto || !c.r2_carimbo) return null;
  const [manifesto, carimbo] = await Promise.all([env.MEDIA.get(c.r2_manifesto), env.MEDIA.get(c.r2_carimbo)]);
  if (!manifesto || !carimbo) return null;
  const bytes = new Uint8Array(await manifesto.arrayBuffer());
  const m = JSON.parse(new TextDecoder().decode(bytes)) as Manifesto;
  const pdf = await gerarPdf(env, htmlCertidao(m, c));
  const zip = zipSync({
    'certidao.pdf': [pdf, { level: 0 }],
    'manifesto.json': bytes,
    'carimbo.tsr': new Uint8Array(await carimbo.arrayBuffer()),
    'LEIA-ME.txt': strToU8(leiaMe(m, c)),
  });
  return { zip: zip as Uint8Array<ArrayBuffer>, nome: `certidao-${pecaId.slice(0, 8)}-v${p.versao}.zip` };
}
