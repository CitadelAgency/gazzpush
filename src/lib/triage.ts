import type { Env } from '../env';
import { fetchArticle, inputModel, type Article } from './article';
import { INSTRUCTIONS_TRIAGE, resolveTriage, schemaTriage, spansEvidence, type Span, type Triage } from './spans';
import { newId } from './db';
import { transition, type TenantMode } from '../kernel/states';
import { fetchWithBrowser } from './browser';
import { dedupeSemantic, similarity } from './dedupe';
import { isLimit } from './plans';
import { produceLead } from './produce';

// Open model on Workers AI with a JSON schema. The constrained schema + resolveTriage are the safety net; if the model
// ignores the schema, validation fails and the queue retries.
const TRIAGE_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const MAX_CHARS_MODEL = 12_000;
/** Cap on pieces per day that go out on their own from the outlet's site. */
export const MAX_AUTO_DAY = 30;

/**
 * `autoral` outlet: how many body passages become `trecho` facts (drafting quotes the author's own text). 60 passages
 * cover a typical whole Substack post (1,000 to 2,000 words give 50 to 100 sentences; a span has up to 450 characters,
 * ~200 on average) and cost ~12k characters (~4k tokens) in the drafting prompt, well within deepseek-flash's context.
 * Longer text: 60 passages spread evenly, in order, so the carousel sees the whole argument.
 */
export const MAX_PASSAGES_AUTHOR = 60;

/** Body passages (not the title's) that become `trecho` facts: all of them up to the limit; above it, spread evenly. */
export function passagesAuthor(spans: Span[], lenTitle: number, max = MAX_PASSAGES_AUTHOR): Span[] {
  const body = spans.filter((s) => s.inicio >= lenTitle + 2);
  if (body.length <= max) return body;
  return Array.from({ length: max }, (_, i) => body[Math.floor((i * body.length) / max)]);
}

interface Doc { id: string; url: string; status: string; fonte_id: string | null }
interface Area { municipio_ibge: string; municipio_nome: string | null; bairro: string | null }

/** Lead requested by the operator (+ New): no area or type filter, origin `manual`, at the top of Ideas. */
export interface ManualRequest {
  por: string;          // the session's user.id
  hash: string;         // document hash in the request's namespace (link:, relato:, print:, anuncio:); idempotency
  /** Ad: the whole body becomes facts, so the briefing's price goes through the check; the lead is born as advertising. */
  anuncio?: { anunciante: string };
}
// Requested by someone: ranks above any monitor suggestion (its score goes up to ~115). Among requests, the most recent
// one first (requesting again renews it): the fraction grows with time.
export const scoreManual = (now: Date) => 1000 + now.getTime() / 1e11;

/**
 * New document → article (HTML in R2) → spans → model with a constrained schema → facts with span + geo → suggested lead.
 * Nothing leaves here without a literal source passage.
 */
export async function triageDocument(env: Env, tenantId: string, documentId: string) {
  const doc = await env.DB.prepare('SELECT id, url, status, fonte_id FROM documentos WHERE id = ? AND tenant_id = ?').bind(documentId, tenantId).first<Doc>();
  if (!doc || doc.status !== 'novo') return;
  const source = await env.DB.prepare('SELECT f.propria_desde, t.modo FROM fontes f JOIN tenants t ON t.id = f.tenant_id WHERE f.id = ? AND f.tenant_id = ?')
    .bind(doc.fonte_id, tenantId).first<{ propria_desde: string | null; modo: TenantMode }>();

  // 1. Full article. Raw HTML and text go to R2.
  const now = new Date();
  let article: Article;
  try {
    article = await fetchArticle(doc.url, now, (html) => env.MEDIA.put(`bruto/${tenantId}/${documentId}.html`, html, { httpMetadata: { contentType: 'text/html; charset=utf-8' } }).then(() => {}),
      (u) => fetchWithBrowser(env, u));
  } catch (e) {
    await discard(env, tenantId, documentId, `artigo: ${String(e)}`);
    return;
  }
  await env.MEDIA.put(`texto/${tenantId}/${documentId}.txt`, inputModel(article), { httpMetadata: { contentType: 'text/plain; charset=utf-8' } });

  // 2. Exact dedupe by text (UNIQUE tenant_id + hash_texto). A link brought by hand through + New also counts.
  // The link's only counts once triaged: a request that failed midway must not silence the monitor.
  const dup = await env.DB.prepare(
    "SELECT id FROM documentos WHERE tenant_id = ? AND id != ? AND (hash_texto = ? OR (hash_texto = ? AND status = 'triado'))",
  ).bind(tenantId, documentId, article.sha256, `link:${article.sha256}`).first<{ id: string }>();
  if (dup) {
    await transition(env, {
      tipo: 'documento', id: documentId, tenantId, para: 'descartado', por: 'sistema', motivo: 'duplicado', dados: { duplicadoDe: dup.id },
      batch: [env.DB.prepare("UPDATE documentos SET triagem = 'duplicado', triagem_json = ?, r2_texto = ? WHERE id = ? AND tenant_id = ?")
        .bind(JSON.stringify({ duplicadoDe: dup.id }), `texto/${tenantId}/${documentId}.txt`, documentId, tenantId)],
    });
    return;
  }
  // 2b. Semantic dedupe (the same news on another site), before paying for the model. A failure does not bring triage
  // down. A story from the outlet's own site skips it: it would be discarded as a copy of the source it originated.
  const site = source?.modo !== 'autoral' && fromOwnSource(source?.propria_desde, article.publicadoEm);
  const almost = site ? null : await dedupeSemantic(env, tenantId, documentId, article, now);
  if (almost) {
    const data = { duplicadoDe: almost.duplicadoDe, similaridade: almost.score, semantico: true };
    await transition(env, {
      tipo: 'documento', id: documentId, tenantId, para: 'descartado', por: 'sistema',
      motivo: `duplicado semântico de ${almost.duplicadoDe} (${similarity(almost.score)})`, dados: data,
      batch: [env.DB.prepare("UPDATE documentos SET triagem = 'duplicado', triagem_json = ?, r2_texto = ? WHERE id = ? AND tenant_id = ?")
        .bind(JSON.stringify(data), `texto/${tenantId}/${documentId}.txt`, documentId, tenantId)],
    });
    return;
  }
  const leadId = await triageArticle(env, tenantId, documentId, article, now, undefined, site);
  if (leadId && site) await produceSite(env, tenantId, leadId);
}

/** The story is from the outlet's site and came out after the site was marked. A date, not a boolean: the feed carries
 *  dozens of old items. Without a date, the normal path. */
export function fromOwnSource(ownSince: string | null | undefined, publishedAt: string | null | undefined) {
  if (!ownSince || !publishedAt) return false;
  return Date.parse(publishedAt) >= Date.parse(ownSince);
}

/** Up to `MAX_AUTO_DAY` pieces per day in Brasília time. Beyond that, the lead stays in Ideas, with no loss. */
async function produceSite(env: Env, tenantId: string, leadId: string) {
  const today = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM pecas pc JOIN pautas p ON p.id = pc.pauta_id AND p.tenant_id = pc.tenant_id
      WHERE pc.tenant_id = ? AND p.origem = 'site' AND date(pc.created_at, '-3 hours') = date('now', '-3 hours')`,
  ).bind(tenantId).first<{ n: number }>();
  if ((today?.n ?? 0) >= MAX_AUTO_DAY) return;
  try {
    await produceLead(env, tenantId, leadId, 'sistema', 'carrossel');
  } catch (e) {
    if (!isLimit(e)) throw e;   // at the plan limit, the lead stays in Ideas
  }
}

/**
 * Article already extracted (with its text in R2) → facts + lead, in one batch with the document's transition.
 * Monitor: a lead only for news in the area/topic. Manual request: always a lead (the requester already decided),
 * origin `manual`. Returns the id of the lead created (or null).
 */
export async function triageArticle(env: Env, tenantId: string, documentId: string, article: Article, now: Date, manual?: ManualRequest, fromSite = false): Promise<string | null> {
  const tenant = await env.DB.prepare('SELECT modo, temas_json FROM tenants WHERE id = ?').bind(tenantId).first<{ modo: TenantMode; temas_json: string }>();
  if (!tenant) throw new Error(`tenant ${tenantId} not found`);
  const { results: areas } = await env.DB.prepare('SELECT municipio_ibge, municipio_nome, bairro FROM tenant_areas WHERE tenant_id = ?').bind(tenantId).all<Area>();
  const topics: string[] = JSON.parse(tenant.temas_json || '[]');

  // 3. Schema constrained to the text: only cities/neighbourhoods of the area that appear literally, only dates present.
  const neighborhoodsKv = await Promise.all([...new Set(areas.map((a) => a.municipio_ibge))].map((ibge) => env.CONFIG.get<string[]>(`bairros:${ibge}`, 'json')));
  const cities = areas.map((a) => a.municipio_nome).filter((n): n is string => !!n);
  const neighborhoods = [...areas.map((a) => a.bairro).filter((b): b is string => !!b), ...neighborhoodsKv.flatMap((b) => b ?? [])];
  const input = inputModel(article);
  const articleModel = input.length > MAX_CHARS_MODEL ? { ...article, texto: article.texto.slice(0, MAX_CHARS_MODEL - article.titulo.length - 2) } : article;
  const { schema, spans } = schemaTriage(articleModel, { cidades: cities, bairros: neighborhoods });

  // 4. Modelo.
  const prompt = spans.map((s) => `[${s.id}] ${s.texto}`).join('\n');
  const resp = await (env.AI.run as (m: string, i: unknown) => Promise<{ response?: unknown }>)(TRIAGE_MODEL, {
    messages: [{ role: 'system', content: INSTRUCTIONS_TRIAGE }, { role: 'user', content: prompt }],
    response_format: { type: 'json_schema', json_schema: schema },
    temperature: 0, max_tokens: 1024,
  });
  const raw = typeof resp.response === 'string' ? JSON.parse(resp.response) : resp.response;
  const triage = resolveTriage(raw, articleModel, spans);

  // 5. Decision: is it news? Is it in the area / topic? In an `autoral` outlet the sources are the author's own: every
  // text becomes a lead, whether essay, analysis, opinion or story.
  const author = tenant.modo === 'autoral';
  // A story from the outlet's site: the publisher already decided. No area filter; opinion also becomes a lead.
  const site = fromSite;
  const news = triage.tipo === 'acontecimento' || triage.tipo === 'desdobramento' || triage.tipo === 'servico';
  const inArea = tenant.modo === 'local'
    ? triage.locais.some((l) => cities.includes(l.cidade))
    : topics.length === 0 || (triage.editoria !== null && topics.includes(triage.editoria));
  const className = author ? 'autoral' : site ? 'site' : !news ? (triage.tipo === 'contexto' ? 'balanco' : null) : inArea ? 'noticia' : 'fora_area';
  const createsLead = className === 'noticia' || author || site || !!manual;

  // 6. Facts: one per piece of evidence. The span's literal text, position, geo when there is one.
  const localEvent = triage.locais.find((l) => l.papel === 'evento') ?? triage.locais[0] ?? null;
  const ibgePerName = new Map(areas.filter((a) => a.municipio_nome).map((a) => [a.municipio_nome!, a.municipio_ibge]));
  const facts: { id: string; tipo: string; span: Span; cidade?: string; bairro?: string | null; data?: string | null }[] = [];
  const seen = new Set<string>();
  const add = (type: string, spanId: number | null, extra: Partial<(typeof facts)[number]> = {}) => {
    if (spanId === null) return;
    const key = `${type}|${spanId}|${extra.cidade ?? ''}|${extra.bairro ?? ''}`;
    if (seen.has(key)) return; // the model repeats the same place in the same passage
    seen.add(key);
    facts.push({ id: newId(), tipo: type, span: spans[spanId], ...extra });
  };
  add('manchete', 0);
  add('tipo', triage.tipoSpan);
  add('editoria', triage.editoriaSpan);
  add('data', triage.dataSpan, { data: triage.ocorreuEm });
  for (const l of triage.locais) add(`local_${l.papel}`, l.spanId, { cidade: l.cidade, bairro: l.bairro });
  // Author and ad: the whole body (not only what the triage model saw) as literal passages, minus those already facts.
  if (author || site || manual?.anuncio) {
    const used = new Set(facts.map((f) => `${f.span.inicio}-${f.span.fim}`));
    for (const s of passagesAuthor(spansEvidence(article), article.titulo.length)) {
      if (!used.has(`${s.inicio}-${s.fim}`)) facts.push({ id: newId(), tipo: 'trecho', span: s });
    }
  }

  const stmts = facts.map((f) => {
    const s = f.span;
    return env.DB.prepare(
      `INSERT INTO fatos (id, tenant_id, documento_id, tipo, texto, span_inicio, span_fim, hash, municipio_ibge, bairro, geo_metodo, data_fato, confianca)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(f.id, tenantId, documentId, f.tipo, s.texto, s.inicio, s.fim, `${article.sha256}:${s.inicio}-${s.fim}`,
      f.cidade ? ibgePerName.get(f.cidade) ?? null : null, f.bairro ?? null, f.cidade ? 'texto' : null, f.data ?? null, 1);
  });

  // 7. A suggested lead only for news in the area/topic (or requested by hand).
  let leadId: string | null = null;
  if (createsLead) {
    leadId = newId();
    const age = article.publicadoEm ? (now.getTime() - Date.parse(article.publicadoEm)) / 3600_000 : 48;
    const score = Math.max(0, 100 - age) + (triage.tipo === 'servico' ? 10 : 0) + (localEvent?.bairro ? 5 : 0);
    const summary = spans.find((s) => s.inicio > article.titulo.length)?.texto ?? null;
    stmts.push(env.DB.prepare(
      `INSERT INTO pautas (id, tenant_id, status, origem, titulo, resumo, editoria, municipio_ibge, bairro, fato_ids_json, documento_ids_json, score, tipo_post)
       VALUES (?, ?, 'sugerida', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(leadId, tenantId, manual ? 'manual' : site ? 'site' : 'monitor', article.titulo, summary, triage.editoria, localEvent ? ibgePerName.get(localEvent.cidade) ?? null : null,
      localEvent?.bairro ?? null, JSON.stringify(facts.map((f) => f.id)), JSON.stringify([documentId]), manual ? scoreManual(now) : score, manual?.anuncio ? 'publicidade' : null));
    if (manual?.anuncio) {
      stmts.push(env.DB.prepare('INSERT INTO anuncios (id, tenant_id, pauta_id, anunciante, por) VALUES (?, ?, ?, ?, ?)').bind(newId(), tenantId, leadId, manual.anuncio.anunciante, manual.por));
    }
  }

  stmts.push(env.DB.prepare(
    `UPDATE documentos SET triagem = ?, triagem_json = ?, titulo = ?, url_canonica = ?, publicado_em = ?, hash_texto = ?, r2_texto = ? WHERE id = ? AND tenant_id = ?`,
  ).bind(className, JSON.stringify({ ...triage, metodo: article.metodo, modelo: TRIAGE_MODEL, truncado: articleModel !== article } satisfies Triage & Record<string, unknown>),
    article.titulo, article.url, article.publicadoEm, manual?.hash ?? article.sha256, `texto/${tenantId}/${documentId}.txt`, documentId, tenantId));
  // Atomic dedupe between the monitor and a hand-brought link: the same text may have arrived by the other path while
  // the model was answering. The monitor gives up if the link's document already exists (the queue retries and lands on
  // the duplicate); the link gives up if the monitor's document already became an active idea. The assertion aborts the
  // whole batch.
  const guard = !manual
    ? { sql: "SELECT 1 FROM documentos WHERE tenant_id = ? AND hash_texto = ? AND id != ? AND status = 'triado'", hash: `link:${article.sha256}` }
    : manual.hash.startsWith('link:')
      ? { sql: `SELECT 1 FROM documentos d JOIN pautas p ON p.tenant_id = d.tenant_id AND p.status IN ('sugerida', 'aceita', 'em_producao')
                  JOIN json_each(p.documento_ids_json) j ON j.value = d.id
                 WHERE d.tenant_id = ? AND d.hash_texto = ? AND d.id != ?`, hash: article.sha256 }
      : null;
  if (guard) {
    stmts.push(env.DB.prepare(`SELECT json(CASE WHEN EXISTS (${guard.sql}) THEN 'duplicado_concorrente' ELSE '1' END)`)
      .bind(tenantId, guard.hash, documentId));
  }
  // Facts, lead, metadata and status in one batch: a redelivered message sees the document outside 'novo' and exits early.
  const { mudou: changed } = await transition(env, {
    tipo: 'documento', id: documentId, tenantId, para: className || manual ? 'triado' : 'descartado', por: manual?.por ?? 'sistema',
    dados: { classe: className, tipo: triage.tipo, editoria: triage.editoria, pautaId: leadId, rejeitados: triage.rejeitados, ...(manual ? { manual: true } : {}) }, batch: stmts,
  });
  env.METRICS.writeDataPoint({ blobs: [tenantId, 'documento.triado', className ?? 'descartado', triage.editoria ?? ''], doubles: [1], indexes: [tenantId] });
  // No-op (another request triaged first): this batch's lead was not written.
  return changed ? leadId : null;
}

async function discard(env: Env, tenantId: string, documentId: string, reason: string) {
  await transition(env, {
    tipo: 'documento', id: documentId, tenantId, para: 'descartado', por: 'sistema', motivo: reason,
    batch: [env.DB.prepare('UPDATE documentos SET triagem_json = ? WHERE id = ? AND tenant_id = ?').bind(JSON.stringify({ motivo: reason }), documentId, tenantId)],
  });
}
