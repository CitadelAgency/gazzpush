// Certificate for a published post: the manifest (sources, art, approval, publication), with an RFC 3161 timestamp. It
// is issued at publication, because a timestamp made after the account goes down proves nothing about the post's date.
import { strToU8, zipSync } from 'fflate';
import type { Env } from '../env';
import { requestTimestamp } from './timestamp';
import { newId, recordEvent } from './db';
import { generatePdf } from './pdf';
import { takesArt, normalizeCards } from './cards';
import type { ArtRendered } from './render';
import type { Draft } from './drafting';

export type ArtOrigin =
  | { tipo: 'foto'; autor: string; origem: string }
  | { tipo: 'ilustracao'; de: 'card' | 'post'; modelo: string }
  | { tipo: 'sem_arte' };

export interface Manifest {
  veiculo: string; idioma: string; peca: { id: string; formato: string; versao: number; manchete: string | null; legenda: string | null };
  fontes: { url: string | null; titulo: string | null; sha256: string; capturadoEm: string | null }[];
  artes: { papel: string; card: string | null; arquivos: { nome: string; sha256: string | null }[] }[];
  ilustracao: { visualBrief: string; modelo: string };
  /** Per card, where the art came from. Certificates issued before Stage 17 lack this field. */
  origemArte?: { card: string; titulo: string; origem: ArtOrigin }[];
  versoes: { versao: number; autor: string; modelo: string | null; em: string }[];
  aprovacao: { por: string; ligadoPor: string | null; versao: number | null; em: string | null };
  publicacao: { rede: string; modo: string; url: string | null; externalId: string | null; em: string | null };
  geradoEm: string;
}

const NOT_RECORDED = 'não registrado';

async function sha256Of(env: Env, key: string): Promise<string | null> {
  const obj = await env.MEDIA.get(key);
  if (!obj) return null;
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', await obj.arrayBuffer()));
  return [...d].map((x) => x.toString(16).padStart(2, '0')).join('');
}
const sha256Text = async (s: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", s as Uint8Array<ArrayBuffer>))].map((x) => x.toString(16).padStart(2, '0')).join('');

interface PieceLine {
  id: string; pauta_id: string; status: string; formato: string; versao: number; conteudo_json: string | null; arte_r2_keys_json: string | null;
  veiculo: string; idioma: string; fato_ids_json: string;
}

async function readPiece(env: Env, tenantId: string, pieceId: string) {
  return env.DB.prepare(
    `SELECT pc.id, pc.pauta_id, pc.status, pc.formato, pc.versao, pc.conteudo_json, pc.arte_r2_keys_json, t.nome AS veiculo, t.idioma, pa.fato_ids_json
       FROM pecas pc JOIN tenants t ON t.id = pc.tenant_id JOIN pautas pa ON pa.id = pc.pauta_id AND pa.tenant_id = pc.tenant_id
      WHERE pc.id = ? AND pc.tenant_id = ?`,
  ).bind(pieceId, tenantId).first<PieceLine>();
}

export async function buildManifest(env: Env, tenantId: string, p: PieceLine): Promise<Manifest> {
  const content = (p.conteudo_json ? JSON.parse(p.conteudo_json) : {}) as Partial<Draft>;
  const [sources, versions, decision, publication, illustration, fromCard] = await Promise.all([
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
  const artwork = (p.arte_r2_keys_json ? JSON.parse(p.arte_r2_keys_json) : []) as (ArtRendered & { mp4?: string })[];
  const enabledBy = decision?.por === 'piloto' ? (JSON.parse(decision.payload_json ?? '{}') as { ligadoPor?: string }).ligadoPor ?? null : null;
  const enabledName = enabledBy ? (await env.DB.prepare('SELECT name FROM user WHERE id = ?').bind(enabledBy).first<{ name: string }>())?.name ?? enabledBy : null;
  const prov = (illustration?.payload_json ? JSON.parse(illustration.payload_json) : {}) as { provedor?: string; modelo?: string };
  const providers = new Map(fromCard.results.map((e) => JSON.parse(e.payload_json) as { r2Key: string; provedor: string }).map((e) => [e.r2Key, e.provedor]));
  const composition = content.estilo?.params.composicao;
  const cardsPost = normalizeCards(content.cards);
  const artOrigin = (p.formato === 'post' ? cardsPost.slice(0, 1) : cardsPost).map((card) => {
    const origin: ArtOrigin = !takesArt(card, composition) ? { tipo: 'sem_arte' }
      : card.imagem ? { tipo: 'foto', autor: card.fotoOrigem?.autor ?? NOT_RECORDED, origem: card.fotoOrigem?.tipo ?? NOT_RECORDED }
        : card.ilustracao ? { tipo: 'ilustracao', de: 'card', modelo: providers.get(card.ilustracao) ?? NOT_RECORDED }
          : { tipo: 'ilustracao', de: 'post', modelo: prov.modelo ?? prov.provedor ?? NOT_RECORDED };
    return { card: card.id, titulo: card.titulo, origem: origin };
  });
  return {
    veiculo: p.veiculo, idioma: p.idioma,
    peca: { id: p.id, formato: p.formato, versao: p.versao, manchete: content.manchete ?? null, legenda: content.legenda ?? null },
    fontes: sources.results.map((f) => ({ url: f.url, titulo: f.titulo, sha256: f.hash_texto, capturadoEm: f.capturado_em })),
    artes: await Promise.all(artwork.map(async (a) => ({
      papel: a.papel, card: a.id ?? null,
      arquivos: await Promise.all([a.png, a.jpg, a.mp4].filter((k): k is string => !!k).map(async (name) => ({ nome: name.split('/').pop()!, sha256: await sha256Of(env, name) }))),
    }))),
    ilustracao: { visualBrief: content.visualBrief?.primary ?? NOT_RECORDED, modelo: prov.modelo ?? prov.provedor ?? NOT_RECORDED },
    origemArte: artOrigin,
    versoes: versions.results.map((v) => ({ versao: v.versao, autor: v.autor, modelo: v.modelo, em: v.created_at })),
    aprovacao: { por: decision ? (decision.por === 'piloto' ? 'piloto' : decision.name ?? decision.por) : NOT_RECORDED, ligadoPor: enabledName, versao: decision?.versao ?? null, em: decision?.created_at ?? null },
    publicacao: { rede: publication?.rede ?? NOT_RECORDED, modo: publication?.modo ?? NOT_RECORDED, url: publication?.url ?? null, externalId: publication?.external_id ?? null, em: publication?.publicado_em ?? null },
    geradoEm: new Date().toISOString(),
  };
}

export interface CertificateLine {
  id: string; peca_id: string; versao: number; sha256: string | null; r2_manifesto: string | null; r2_carimbo: string | null;
  carimbo_em: string | null; tsa: string | null; erro: string | null; na_publicacao: number; created_at: string;
}

const line = (env: Env, tenantId: string, pieceId: string, version: number) =>
  env.DB.prepare('SELECT * FROM certidoes WHERE tenant_id = ? AND peca_id = ? AND versao = ?').bind(tenantId, pieceId, version).first<CertificateLine>();

/**
 * Issues the certificate for the published version. Repeating does not duplicate: there is one row per piece and
 * version, and one that already has a timestamp comes back as is. Authority down: throws, and the queue retries; publishing
 * never waits for this.
 */
export async function issueCertificate(env: Env, tenantId: string, pieceId: string, inPublication: boolean): Promise<CertificateLine | null> {
  const p = await readPiece(env, tenantId, pieceId);
  if (!p || p.status !== 'publicada') return null;
  const existing = await line(env, tenantId, pieceId, p.versao);
  if (existing?.sha256) return existing;
  const manifest = await buildManifest(env, tenantId, p);
  const bytes = strToU8(JSON.stringify(manifest, null, 2));
  const c = await requestTimestamp(env, bytes);
  const sha = await sha256Text(bytes);
  const id = existing?.id ?? newId();
  const base = `certidoes/${tenantId}/${pieceId}/v${p.versao}`;
  await Promise.all([
    env.MEDIA.put(`${base}-${id}.json`, bytes, { httpMetadata: { contentType: 'application/json' } }),
    env.MEDIA.put(`${base}-${id}.tsr`, c.tsr, { httpMetadata: { contentType: 'application/timestamp-reply' } }),
  ]);
  // A certificate started at publication and finished later stays `na_publicacao`, and the failure goes away.
  await env.DB.prepare(`INSERT INTO certidoes (id, tenant_id, peca_id, versao, sha256, r2_manifesto, r2_carimbo, carimbo_em, tsa, erro, na_publicacao) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
    ON CONFLICT (peca_id, versao) DO UPDATE SET sha256 = excluded.sha256, r2_manifesto = excluded.r2_manifesto, r2_carimbo = excluded.r2_carimbo, carimbo_em = excluded.carimbo_em, tsa = excluded.tsa, erro = NULL`)
    .bind(id, tenantId, pieceId, p.versao, sha, `${base}-${id}.json`, `${base}-${id}.tsr`, c.em, c.tsa, inPublication ? 1 : 0).run();
  await recordEvent(env, tenantId, 'peca.certidao', 'peca', pieceId, { versao: p.versao, sha256: sha, carimboEm: c.em }, `${pieceId}:v${p.versao}:certidao`);
  return line(env, tenantId, pieceId, p.versao);
}

/** Attempts exhausted: the failure stays visible on the piece, and "Generate certificate" tries again. */
export async function failCertificate(env: Env, tenantId: string, pieceId: string, error: string) {
  const p = await env.DB.prepare('SELECT versao FROM pecas WHERE id = ? AND tenant_id = ?').bind(pieceId, tenantId).first<{ versao: number }>();
  if (!p) return;
  await env.DB.prepare(`INSERT INTO certidoes (id, tenant_id, peca_id, versao, erro) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (peca_id, versao) DO UPDATE SET erro = excluded.erro WHERE certidoes.sha256 IS NULL`).bind(newId(), tenantId, pieceId, p.versao, error.slice(0, 300)).run();
}

const h = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function htmlCertificate(m: Manifest, c: Pick<CertificateLine, 'sha256' | 'carimbo_em' | 'tsa' | 'na_publicacao'>) {
  const en = m.idioma === 'en';
  const tr = (pt: string, ing: string) => (en ? ing : pt);
  const nr = (s: string | null) => (s === NOT_RECORDED ? tr('não registrado', 'not recorded') : s ?? tr('não registrado', 'not recorded'));
  const row = (label: string, value: string) => `<tr><th scope="row">${h(label)}</th><td>${h(value)}</td></tr>`;
  const origins = m.origemArte ?? [];
  const photoName: Record<string, string> = { minha: tr('foto do autor', 'photo by the author'), equipe: tr('foto da equipe do veículo', 'photo by the team'), autorizada: tr('foto de terceiro, com autorização', 'third-party photo, with permission') };
  const textOrigin = (o: ArtOrigin) => o.tipo === 'sem_arte' ? tr('sem arte', 'no artwork')
    : o.tipo === 'foto' ? `${photoName[o.origem] ?? tr('foto, origem não registrada', 'photo, origin not recorded')}: ${nr(o.autor)}`
      : `${o.de === 'card' ? tr('ilustração gerada para este card', 'illustration generated for this card') : tr('ilustração gerada para o post', 'illustration generated for the post')}: ${nr(o.modelo)}`;
  const who = m.aprovacao.por === 'piloto'
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
${row(tr('Manchete', 'Headline'), m.peca.manchete ?? '')}
${row(tr('Versão', 'Version'), String(m.peca.versao))}
${row(tr('Aprovado por', 'Approved by'), who)}
${row(tr('Aprovado em', 'Approved on'), nr(m.aprovacao.em))}
${row(tr('Publicado em', 'Published on'), nr(m.publicacao.em))}
${row(tr('Link', 'Link'), m.publicacao.url ?? tr('não informado', 'not provided'))}
${row(tr('Carimbo de tempo', 'Timestamp'), `${c.carimbo_em ?? ''} (${c.tsa ?? ''})`)}
${row(tr('Ilustração', 'Illustration'), `${nr(m.ilustracao.modelo)}: ${nr(m.ilustracao.visualBrief)}`)}
</table>
<h2>${h(tr('Fontes', 'Sources'))}</h2>
${m.fontes.length ? `<ul>${m.fontes.map((f) => `<li>${h(f.titulo ?? f.url)}${f.url ? ` (${h(f.url)})` : ''}, ${h(f.capturadoEm)} <span class="h">${h(f.sha256)}</span></li>`).join('')}</ul>` : `<p>${h(tr('Nenhuma fonte registrada.', 'No source recorded.'))}</p>`}
<h2>${h(tr('Artes', 'Artwork'))}</h2>
<ul>${m.artes.flatMap((a) => a.arquivos.map((x) => `<li>${h(a.papel)} · ${h(x.nome)} <span class="h">${h(x.sha256 ?? tr('arquivo não encontrado', 'file not found'))}</span></li>`)).join('')}</ul>
${origins.length ? `<h2>${h(tr('Origem da arte, por card', 'Artwork origin, by card'))}</h2>
<ul>${origins.map((o) => `<li>${h(o.titulo || o.card)}: ${h(textOrigin(o.origem))}</li>`).join('')}</ul>` : ''}
<p class="nota">SHA-256 ${h(tr('do manifesto', 'of the manifest'))}: <span class="h">${h(c.sha256)}</span></p>
<p class="nota">${h(tr('Esta certidão registra o que o app guardou sobre o post. Não é documento oficial nem orientação jurídica.', 'This certificate records what the app stored about the post. It is not an official document or legal advice.'))}</p>
</main></body></html>`;
}

function readmeMe(m: Manifest, c: CertificateLine) {
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

/** The certificate zip, or null without a ready certificate. */
export async function packageCertificate(env: Env, tenantId: string, pieceId: string): Promise<{ zip: Uint8Array<ArrayBuffer>; nome: string } | null> {
  const p = await env.DB.prepare('SELECT versao FROM pecas WHERE id = ? AND tenant_id = ?').bind(pieceId, tenantId).first<{ versao: number }>();
  if (!p) return null;
  const c = await line(env, tenantId, pieceId, p.versao);
  if (!c?.r2_manifesto || !c.r2_carimbo) return null;
  const [manifest, timestamp] = await Promise.all([env.MEDIA.get(c.r2_manifesto), env.MEDIA.get(c.r2_carimbo)]);
  if (!manifest || !timestamp) return null;
  const bytes = new Uint8Array(await manifest.arrayBuffer());
  const m = JSON.parse(new TextDecoder().decode(bytes)) as Manifest;
  const pdf = await generatePdf(env, htmlCertificate(m, c));
  const zip = zipSync({
    'certidao.pdf': [pdf, { level: 0 }],
    'manifesto.json': bytes,
    'carimbo.tsr': new Uint8Array(await timestamp.arrayBuffer()),
    'LEIA-ME.txt': strToU8(readmeMe(m, c)),
  });
  return { zip: zip as Uint8Array<ArrayBuffer>, nome: `certidao-${pieceId.slice(0, 8)}-v${p.versao}.zip` };
}
