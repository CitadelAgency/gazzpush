import type { Env } from '../env';
import { MAX_CHARS_ARTICLE, fetchArticle, inputModel, safeUrl, type Article } from './article';
import { fetchWithBrowser } from './browser';
import { newId, sha256Hex } from './db';
import { scoreManual, triageArticle } from './triage';
import { InvalidTransition } from '../kernel/states';
import { fromOutletLanguage, textsContent } from './contentLanguage';

// + New: the operator brings in a story (link, account or screenshot) and it becomes a `manual` lead at the top of Ideas,
// through the same path as the monitor (article → spans → triage → facts), without the area filter. Idempotent by the
// content hash.

export type NewRequest =
  | { tipo: 'link'; url: string }
  // With `titulo`: a whole imported text (Google Docs, review desk), title and paragraphs verbatim, up to the article
  // limit; `origem` stores where it came from and the revision read (Docs). Without a title: the operator's short account.
  | { tipo: 'relato'; texto: string; titulo?: string; origem?: { url: string; revisao: string | null } }
  | { tipo: 'print'; bytes: Uint8Array; mime: string }
  // Ad: the business's briefing becomes an advertising lead, with the account's limits.
  | { tipo: 'anuncio'; anunciante: string; briefing: string };

/** nova = lead created now; existente = already in the queue or in production; de_volta = had left and came back. */
export type Status = 'nova' | 'existente' | 'de_volta';

export class NewError extends Error {
  /** `en`: the same message in English (the API picks by the request's language; `message` is the Portuguese one). */
  constructor(readonly codigo: string, message: string, readonly status: 400 | 413 | 422 | 502 = 422, readonly en?: string) {
    super(message);
  }
}

export const REPORT_MIN = 30;
export const REPORT_MAX = 4000;
export const PRINT_MAX_BYTES = 4 * 1024 * 1024;
export const PRINT_MIMES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const ACTIVE = ['sugerida', 'aceita', 'em_producao'];
const VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';
export const ADVERTISER_MAX = 80;

/**
 * Operator's account → article. The first sentence becomes the title (verbatim; cut at a word if longer than 140), the
 * rest is the body. The text is theirs: nothing is rewritten, only whitespace is normalised.
 */
export async function articleReport(raw: string, url: string, now: Date, method = 'relato'): Promise<Article> {
  const text = raw.replace(/\s+/g, ' ').trim();
  const [first] = new Intl.Segmenter('pt-BR', { granularity: 'sentence' }).segment(text);
  const sentence = (first?.segment ?? text).trim();
  let title: string, body: string;
  if (sentence.length <= 140) {
    title = sentence;
    body = text.slice(sentence.length).trim();
  } else {
    const cut = text.lastIndexOf(' ', 120);
    title = `${text.slice(0, cut > 40 ? cut : 120).trim()}…`;
    body = text;
  }
  const input = inputModel({ titulo: title, texto: body });
  return { titulo: title, texto: body, url, publicadoEm: null, modificadoEm: null, capturadoEm: now.toISOString(), metodo: method, sha256: await sha256Hex(input) };
}

/**
 * A whole imported text (Google Docs, desk) → article. Title and body verbatim; paragraphs are kept (one per line), so a
 * paragraph's sentence without a full stop does not merge with the next one.
 */
export async function articleText(rawTitle: string, rawText: string, now: Date, method: string): Promise<Article> {
  const title = rawTitle.replace(/\s+/g, ' ').trim().slice(0, 300) || 'Sem título';
  const text = rawText.replace(/[^\S\n]+/g, ' ').replace(/ *\n\s*/g, '\n').trim();
  if (text.length < REPORT_MIN) throw new NewError('texto_curto', `o texto está vazio ou curto demais (mínimo de ${REPORT_MIN} caracteres)`, 400, `the text is empty or too short (minimum ${REPORT_MIN} characters)`);
  if (title.length + text.length + 2 > MAX_CHARS_ARTICLE) throw new NewError('texto_longo', `texto longo demais (até ${MAX_CHARS_ARTICLE / 1000} mil caracteres)`, 400, `text too long (up to ${MAX_CHARS_ARTICLE / 1000} thousand characters)`);
  return { titulo: title, texto: text, url: '', publicadoEm: null, modificadoEm: null, capturadoEm: now.toISOString(), metodo: method, sha256: await sha256Hex(inputModel({ titulo: title, texto: text })) };
}

/**
 * News screenshot → text, through a vision model. A literal transcription is requested; what it reads becomes the
 * "document" and the facts come from it with spans, as from any article. Human review checks it later (the source says
 * "print").
 */
export async function readPrint(env: Env, bytes: Uint8Array): Promise<{ titulo: string; texto: string } | null> {
  let out: { response?: unknown };
  try {
    out = await env.AI.run(VISION_MODEL, {
      prompt: 'The image must be a screenshot of a news story in Portuguese. Transcribe the text of the news story exactly as it ' +
        'appears, in order: the title and then the body. Do not summarise, do not translate (keep the original language), do not correct and do not add anything. Ignore menus, ' +
        'ads, buttons, author, comments and photo captions. Respond ONLY with JSON, no comment: ' +
        '{"noticia":true,"titulo":"...","texto":"..."}, with one paragraph per line in the text. If it is not news or the text is not legible: {"noticia":false,"titulo":"","texto":""}.',
      image: [...bytes],
      max_tokens: 2048,
      temperature: 0,
    }) as { response?: unknown };
  } catch (e) {
    throw new NewError('modelo_falhou', `leitura do print falhou: ${String(e).slice(0, 200)}`, 502, `reading the screenshot failed: ${String(e).slice(0, 200)}`);
  }
  const r = readJsonModel(out.response);
  if (!r || r.noticia === false) return null;
  const title = typeof r.titulo === 'string' ? r.titulo.replace(/\s+/g, ' ').trim() : '';
  // Paragraphs are kept: a subheading line without a full stop does not merge with the next sentence (each paragraph is a passage).
  const text = typeof r.texto === 'string' ? r.texto.replace(/[^\S\n]+/g, ' ').replace(/ *\n\s*/g, '\n').trim() : '';
  if (!title || title.length + text.length < 80) return null;
  return { titulo: title, texto: text };
}

/** The binding returns `response` as a string (sometimes with text around it) or already as an object. */
export function readJsonModel(resp: unknown): Record<string, unknown> | null {
  if (resp && typeof resp === 'object') return resp as Record<string, unknown>;
  if (typeof resp !== 'string') return null;
  const ini = resp.indexOf('{'), end = resp.lastIndexOf('}');
  if (ini < 0 || end <= ini) return null;
  try {
    const v = JSON.parse(resp.slice(ini, end + 1));
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

/** Source for accounts and screenshots: one per outlet, `manual` (outside the monitor and source health), name = label on the piece. */
async function manualSource(env: Env, tenantId: string, type: 'relato' | 'print' | 'anuncio'): Promise<string> {
  const t = await env.DB.prepare('SELECT nome, marca_json, idioma FROM tenants WHERE id = ?').bind(tenantId).first<{ nome: string; marca_json: string; idioma: string | null }>();
  const brand = JSON.parse(t?.marca_json || '{}') as { handle?: string; nome?: string };
  const who = brand.handle || brand.nome || t?.nome || 'redação';
  // The name appears in the card footer ("Source: …"): in the outlet's language.
  const tx = textsContent(fromOutletLanguage(t?.idioma));
  const name = type === 'relato' ? tx.relatoDe(who) : type === 'anuncio' ? tx.briefingAnunciante : tx.printDeNoticia;
  const id = `${tenantId}:${type}`;
  // The @ can change: the label follows it.
  await env.DB.prepare(
    `INSERT INTO fontes (id, tenant_id, tipo, nome, url) VALUES (?, ?, 'manual', ?, NULL)
     ON CONFLICT (id) DO UPDATE SET nome = excluded.nome`,
  ).bind(id, tenantId, name).run();
  return id;
}

interface Found { doc: string; docStatus: string; hash: string; pauta: string | null; pautaStatus: string | null }

/** Documents with these hashes and each one's most recent lead. */
async function search(env: Env, tenantId: string, hashes: string[]): Promise<Found[]> {
  const { results } = await env.DB.prepare(
    `SELECT d.id AS doc, d.status AS docStatus, d.hash_texto AS hash, p.id AS pauta, p.status AS pautaStatus
       FROM documentos d
       LEFT JOIN pautas p ON p.id = (SELECT p2.id FROM pautas p2 WHERE p2.tenant_id = d.tenant_id
                                       AND EXISTS (SELECT 1 FROM json_each(p2.documento_ids_json) j WHERE j.value = d.id)
                                     ORDER BY p2.created_at DESC, p2.rowid DESC LIMIT 1)
      WHERE d.tenant_id = ? AND d.hash_texto IN (${hashes.map(() => '?').join(', ')})`,
  ).bind(tenantId, ...hashes).all<Found>();
  return results;
}

/**
 * The idea had already left the queue (discarded or done): a copy comes back as suggested, with the same facts. Atomic:
 * if another active idea already uses the same document (an identical request arrived first), nothing is created and
 * null is returned.
 */
async function bringBack(env: Env, tenantId: string, leadId: string, actor: string): Promise<string | null> {
  const id = newId();
  const [r] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO pautas (id, tenant_id, status, origem, titulo, resumo, editoria, municipio_ibge, bairro, fato_ids_json, documento_ids_json, score, tipo_post)
       SELECT ?, v.tenant_id, 'sugerida', 'manual', v.titulo, v.resumo, v.editoria, v.municipio_ibge, v.bairro, v.fato_ids_json, v.documento_ids_json, ?, CASE WHEN v.tipo_post = 'publicidade' THEN 'publicidade' END
         FROM pautas v WHERE v.id = ? AND v.tenant_id = ?
          AND NOT EXISTS (SELECT 1 FROM pautas a, json_each(a.documento_ids_json) ja, json_each(v.documento_ids_json) jv
                           WHERE a.tenant_id = v.tenant_id AND a.status IN ('sugerida', 'aceita', 'em_producao') AND ja.value = jv.value)`,
    ).bind(id, scoreManual(new Date()), leadId, tenantId),
    env.DB.prepare(
      `INSERT INTO eventos (tenant_id, tipo, ref_tipo, ref_id, payload_json)
       SELECT ?, 'pauta.de_volta', 'pauta', ?, ? WHERE EXISTS (SELECT 1 FROM pautas WHERE id = ?)`,
    ).bind(tenantId, id, JSON.stringify({ de: leadId, por: actor }), id),
    // The ad goes with the copy: without it, the idea would come back without the advertising label.
    env.DB.prepare(
      `INSERT INTO anuncios (id, tenant_id, pauta_id, anunciante, por)
       SELECT ?, a.tenant_id, ?, a.anunciante, ? FROM anuncios a WHERE a.pauta_id = ? AND a.tenant_id = ? AND EXISTS (SELECT 1 FROM pautas WHERE id = ?)`,
    ).bind(newId(), id, actor, leadId, tenantId, id),
  ]);
  return r.meta.changes ? id : null;
}

/** Text the document already has in R2 (stored before the document existed) → article. */
async function savedArticle(env: Env, tenantId: string, docId: string, method: string, now: Date): Promise<Article | null> {
  const o = await env.MEDIA.get(`texto/${tenantId}/${docId}.txt`);
  if (!o) return null;
  const input = await o.text();
  const i = input.indexOf('\n\n');
  const title = i < 0 ? input : input.slice(0, i);
  const text = i < 0 ? '' : input.slice(i + 2);
  return { titulo: title, texto: text, url: '', publicadoEm: null, modificadoEm: null, capturadoEm: now.toISOString(), metodo: method, sha256: await sha256Hex(input) };
}

/** `peca`: an idea already in production has a post (producing, to approve, approved...); the screen says where it is. */
type Result = { pautaId: string; situacao: Status; status: string; peca?: { id: string; status: string } | null };

/**
 * + New request → lead. Same content, same idea: if it is in the queue or in production, that one is returned; if it
 * already left, a copy comes back. A link also matches what the monitor already brought (the same extracted text).
 */
export async function newLead(env: Env, tenantId: string, actor: string, request: NewRequest): Promise<Result> {
  const now = new Date();
  const id = newId();
  let article: Article | null = null;
  let hash: string;
  let others: string[] = [];   // hashes that also count as "already exists" (link: the monitor's document)
  let raw: { chave: string; corpo: Uint8Array | string; tipo: string } | null = null;

  if (request.tipo === 'link') {
    const url = request.url.trim();
    if (url.length > 2000 || !safeUrl(url)) throw new NewError('url_invalida', 'link inválido: use o endereço completo da notícia (https://…)', 400, 'invalid link: use the full address of the news story (https://…)');
    let html = '';
    try {
      article = await fetchArticle(url, now, async (h) => { html = h; }, (u) => fetchWithBrowser(env, u));
    } catch (e) {
      const reason = String((e as Error).message ?? e).slice(0, 80);
      throw new NewError('link_ilegivel', `não deu para ler a notícia desse link (${reason})`, 422, `couldn't read the news story from that link (${reason})`);
    }
    hash = `link:${article.sha256}`;
    others = [article.sha256];
    raw = { chave: `bruto/${tenantId}/${id}.html`, corpo: html, tipo: 'text/html; charset=utf-8' };
  } else if (request.tipo === 'relato' && request.titulo !== undefined) {
    article = await articleText(request.titulo, request.texto, now, request.origem ? 'google_docs' : 'texto');
    hash = `relato:${article.sha256}`;
  } else if (request.tipo === 'relato') {
    const clean = request.texto.replace(/\s+/g, ' ').trim();
    if (clean.length < REPORT_MIN) throw new NewError('relato_curto', `escreva pelo menos ${REPORT_MIN} caracteres: o que aconteceu, onde e quando`, 400, `write at least ${REPORT_MIN} characters: what happened, where and when`);
    if (clean.length > REPORT_MAX) throw new NewError('relato_longo', `até ${REPORT_MAX} caracteres`, 400, `up to ${REPORT_MAX} characters`);
    article = await articleReport(clean, '', now);
    hash = `relato:${article.sha256}`;
  } else if (request.tipo === 'anuncio') {
    const advertiser = request.anunciante.replace(/\s+/g, ' ').trim();
    const clean = request.briefing.replace(/\s+/g, ' ').trim();
    if (!advertiser || advertiser.length > ADVERTISER_MAX) throw new NewError('anunciante_invalido', `diga o nome do anunciante, até ${ADVERTISER_MAX} caracteres`, 400, `give the advertiser's name, up to ${ADVERTISER_MAX} characters`);
    if (clean.length < REPORT_MIN) throw new NewError('relato_curto', `escreva pelo menos ${REPORT_MIN} caracteres: o que o anunciante oferece, preço e validade`, 400, `write at least ${REPORT_MIN} characters: what the advertiser offers, price and dates`);
    if (clean.length > REPORT_MAX) throw new NewError('relato_longo', `até ${REPORT_MAX} caracteres`, 400, `up to ${REPORT_MAX} characters`);
    article = await articleReport(clean, '', now, 'anuncio');
    hash = `anuncio:${await sha256Hex(`${advertiser}\n${article.sha256}`)}`;
  } else {
    const ext = PRINT_MIMES[request.mime];
    if (!ext) throw new NewError('imagem_invalida', 'mande o print como PNG, JPEG ou WebP', 400, 'send the screenshot as PNG, JPEG or WebP');
    if (!request.bytes.byteLength) throw new NewError('imagem_invalida', 'imagem vazia', 400, 'empty image');
    // The hash is the image's: the same screenshot does not pay for reading twice.
    hash = `print:${[...new Uint8Array(await crypto.subtle.digest('SHA-256', request.bytes as Uint8Array<ArrayBuffer>))].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
    raw = { chave: `bruto/${tenantId}/${id}.${ext}`, corpo: request.bytes, tipo: request.mime };
  }

  const all = [hash, ...others];
  // An active idea with the same content. Requested again, it moves to the top (the list shows the first 100); in
  // production, its post comes along.
  const active = async (): Promise<Result | null> => {
    const a = (await search(env, tenantId, all)).find((x) => x.pauta && ACTIVE.includes(x.pautaStatus!));
    if (!a) return null;
    if (a.pautaStatus === 'em_producao') {
      const piece = await env.DB.prepare('SELECT id, status FROM pecas WHERE pauta_id = ? AND tenant_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1')
        .bind(a.pauta, tenantId).first<{ id: string; status: string }>();
      return { pautaId: a.pauta!, situacao: 'existente', status: a.pautaStatus, peca: piece };
    }
    await env.DB.prepare('UPDATE pautas SET score = MAX(COALESCE(score, 0), ?) WHERE id = ? AND tenant_id = ?').bind(scoreManual(new Date()), a.pauta, tenantId).run();
    return { pautaId: a.pauta!, situacao: 'existente', status: a.pautaStatus! };
  };

  // Already exists? Active → the same one. Left the queue → comes back. The request's document still in 'novo' (an
  // earlier request failed midway, or an identical one is in progress) → triage that one, with the text it already has.
  const ready = await active();
  if (ready) return ready;
  // The idea that left may have come from this request or, for a link, from the monitor (same text): its copy comes back.
  const findings = await search(env, tenantId, all);
  const left = findings.find((a) => a.pauta);
  const my = findings.find((a) => a.hash === hash);
  if (left) {
    const copy = await bringBack(env, tenantId, left.pauta!, actor);
    if (copy) return { pautaId: copy, situacao: 'de_volta', status: 'sugerida' };
    const other = await active();
    if (other) return other;
    throw new Error(`request ${hash}: the idea did not come back and there is no active one`);
  }
  let docId: string = my?.doc ?? id;
  // The screenshot of a document that already exists is not read again: the text stored by whoever arrived first counts.
  if (request.tipo === 'print' && docId !== id) article = await savedArticle(env, tenantId, docId, 'print_visao', now);
  if (request.tipo === 'print' && !article) {
    const read = await readPrint(env, request.bytes);
    if (!read) throw new NewError('print_sem_noticia', 'não deu para ler uma notícia nesse print', 422, "couldn't read a news story in that screenshot");
    article = { titulo: read.titulo, texto: read.texto, url: '', publicadoEm: null, modificadoEm: null, capturadoEm: now.toISOString(), metodo: 'print_visao', sha256: await sha256Hex(inputModel(read)) };
  }
  const sourceId = request.tipo === 'link' ? null : await manualSource(env, tenantId, request.tipo);
  const withUrl = (a: Article): Article => (request.tipo === 'link' ? a : { ...a, url: `${request.tipo}:${docId}` });
  let art = withUrl(article!);

  if (docId === id) {
    // Text before the document: whoever loses the race (or resumes a request that failed) reads exactly this.
    await env.MEDIA.put(`texto/${tenantId}/${id}.txt`, inputModel(art), { httpMetadata: { contentType: 'text/plain; charset=utf-8' } });
    if (raw) await env.MEDIA.put(raw.chave, raw.corpo, { httpMetadata: { contentType: raw.tipo } });
    const origin = request.tipo === 'relato' ? request.origem ?? null : null;
    const r = await env.DB.prepare(
      'INSERT OR IGNORE INTO documentos (id, tenant_id, fonte_id, url, hash_texto, titulo, publicado_em, r2_bruto, origem_url, origem_revisao) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(id, tenantId, sourceId, art.url, hash, art.titulo, art.publicadoEm, raw?.chave ?? null, origin?.url ?? null, origin?.revisao ?? null).run();
    if (!r.meta.changes) {
      // Another identical request stored the document between the lookup and here: triage theirs, with their text.
      docId = (await search(env, tenantId, [hash]))[0]?.doc ?? id;
      const saved = request.tipo === 'print' ? await savedArticle(env, tenantId, docId, 'print_visao', now) : null;
      art = withUrl(saved ?? art);
    }
  }

  let leadId: string | null = null;
  try {
    leadId = await triageArticle(env, tenantId, docId, art, now, { por: actor, hash, ...(request.tipo === 'anuncio' ? { anuncio: { anunciante: request.anunciante.replace(/\s+/g, ' ').trim() } } : {}) });
  } catch (e) {
    // Race: the same content became an idea by another path (another identical request, or the monitor for a link).
    const other = await active();
    if (other) return other;
    if (!(e instanceof InvalidTransition)) throw e;
  }
  if (leadId) return { pautaId: leadId, situacao: 'nova', status: 'sugerida' };
  // No-op: the other request was triaged and created the lead.
  const other = await active();
  if (!other) throw new Error(`request ${hash} has no lead after triage`);
  return other;
}
