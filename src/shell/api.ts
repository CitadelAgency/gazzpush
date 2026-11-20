import { NARRATION_MAX_BYTES, decideWarning, narrationVersion, narrationToScreen, narrationPerId, receiveNarration } from '../lib/narration';
import { MOTIONS_REELS, STEPS_REELS, DEFAULT_PACE, type MotionReels, type ReelsStep, type ReelsPace } from '../lib/reelsHtml';
import { fromAdjustmentTarget, generateAdjustment } from '../lib/adjust';
import { MIN_SUMMARY, buildSummary } from '../lib/digest';
import { Hono, type Context } from 'hono';
import { validator } from 'hono/validator';
import { stmtEvent, newId, recordEvent } from '../lib/db';
import { generateHooks } from '../lib/angles';
import { createLink, dataReceipt, approvalState, htmlReceipt, pieceAd } from '../lib/ad';
import { generatePdf } from '../lib/pdf';
import { loadLead } from '../lib/lead';
import { MAX_ILLUSTRATIONS_CARD, illustrateCard, illustrationsCard, pieceCapUsd } from '../lib/illustrate';
import type { Draft } from '../lib/drafting';
import { signMedia, encryptToken } from '../lib/crypto';
import { KEY_MAX, KEY_MIN, checkKey, keysState, hasKey } from '../lib/providers';
import { PROVIDERS, PROVIDERS_IMAGE, PROVIDERS_SECOND, PROVIDERS_TEXT, isProvider, type Provider } from '../lib/providersTable';
import { loadAccount, packagePublication } from '../lib/publish';
import type { ArtRendered } from '../lib/render';
import {
  DECISIONS, FORMATS_LEAD, MODES_ACCOUNT, MODES_TENANT, LEAD_STATUS, PIECE_STATUS, startExecution, belongs, transition, type Transition,
} from '../kernel/states';
import { MAX_ROUNDS, productionId, startProduction } from '../workflows/production';
import { cursorPublications, sinceSql, stepProduction, statusList } from './queue';
import { NewError, PRINT_MAX_BYTES, newLead, type NewRequest } from '../lib/intake';
import { LOGO_MAX_BYTES, REFERENCE_MAX_BYTES, isJpeg, isPng, readBodyUntil, readLogo, publicBrand, mergeCtas, sanitizeSvg, validateBrand } from './brand';
import { isAdminPlatform, requireAdminPlatform, requireMember, type AppEnv } from './tenancy';
import { PERIODS_USAGE, panelUsage } from '../lib/usage';
import { texts } from './texts';
import { MAX_FAILURES_SOURCE } from '../monitor/scheduled';
import { acceptInvite, validEmail, inviteLink, inviteRole } from './invites';
import type { ProductionParams } from '../env';
import { ufSql } from '../lib/uf';
import { produceLead } from '../lib/produce';
import { SCOPE_DOCS, GoogleError, docsConnected, googleConfigured, readDocument, fromDocText, tokenGoogle, fromDocUrl } from '../lib/google';
import { AuthorError, ITEMS_INITIALS, downloadLogo, readSubstack, authorBrand, substackOrigin, type Substack } from '../lib/author';
import { applyStyle, editCards, currentIllustration, photosPrefix } from './editing';
import { approvePiece } from '../lib/approve';
import { fromAutopilotAccount } from '../lib/autopilot';
import { TimestampError } from '../lib/timestamp';
import { issueCertificate, packageCertificate } from '../lib/certificate';
import { NOTE_CASE_MAX, CASE_TYPES } from '../lib/kit';
import { validMonth, zipMonth } from '../lib/monthArchive';
import { ITEMS_PER_PAGE, CAPTION_MAX, MAX_ITEMS_BATCH, THUMBNAIL_MAX_BYTES } from '../lib/xray';
import { deleteRayX } from '../lib/xrayQueue';
import { requestCertificate } from '../workflows/publishing';
import { MAX_IMPORTS_DAY, addressSite, importBrand } from '../lib/brandImport';
import { USAGE_WARNING, PLANOS, PLANOS_PAGOS, selfHosted, initialPlan, planStatus } from '../lib/plans';
import { billingOn, createCheckout, createPortal } from '../lib/stripe';
import { archiveStyle, updateStyle, copyStyle, createStyle, listStyles, listSponsorships, sponsorshipOutlet, fromStyleStatus, validateStyle, validateSponsorship } from '../lib/styles';
import type { PieceStyle } from '../lib/style';
import { PHOTO_MAX_BYTES, takesArt, normalizeCards, type Card } from '../lib/cards';
import { previewPiece } from './piecePreview';
import { libraryMusical } from '../lib/music';
import type { ArtReels } from '../lib/reels';
import { isLanguage, language, t } from './language';
import { isLanguageContent, fromOutletLanguage, type ContentLanguage } from '../lib/contentLanguage';

/**
 * API under /api (session already required in index.ts). Tenant resources under /t/:tenantId/…, behind requireMember;
 * every query carries `AND tenant_id = ?`. Who decided (`por`) is always c.var.user.id; a `por` field in the body is ignored.
 */
const hostOf = (url: string | null) => {
  if (!url || !/^https?:\/\//.test(url)) return null;
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
};
const readJson = async <T>(c: Context<AppEnv>): Promise<Partial<T>> => (await c.req.json().catch(() => ({}))) as Partial<T>;
const PENDING = 'Workflow não confirmou o início; o cron recria em até 15 min (ou marca falha depois de 1 h).';
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
const slugify = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
// Gated Workers AI models (Llama) require accepting the licence once per account: send the prompt "agree".
const MODELS_WITH_LICENSE = new Set(['@cf/meta/llama-3.2-11b-vision-instruct', '@cf/meta/llama-3.3-70b-instruct-fp8-fast']);

// Only declares `?status=` and `?desde=` for the RPC client (hc types the query from the validator); the real validation
// is statusList and sinceSql.
const queryStatus = validator('query', (q) => ({
  status: typeof q.status === 'string' ? q.status : undefined,
  desde: typeof q.desde === 'string' ? q.desde : undefined,
}));
// `?todas=1`: the outlet screen also lists what is off or paused; the queue and the sidebar only see the active ones.
const queryAll = validator('query', (q) => ({ todas: typeof q.todas === 'string' ? q.todas : undefined }));
const SOURCE_URL_MAX = 2000;
/** Intermediaries with an adapter in src/lib/publish.ts. */
const ACTIVE_PROVIDERS = ['ayrshare'];
/** An absolute, normalised http(s) URL, or null. */
function sourceUrl(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > SOURCE_URL_MAX) return null;
  try {
    const u = new URL(v.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch { return null; }
}

export const api = new Hono<AppEnv>()

// ── user account ─────────────────────────────────────────────────────────────────────────────────────────────────

.get('/me', async (c) => {
  const u = c.get('user');
  // Main municipality for the outlet picker (name + municipality); a topical outlet has none.
  const { results } = await c.env.DB.prepare(
    `SELECT t.id, t.slug, t.nome, t.modo, t.uf, t.idioma, t.plano, m.papel,
            json_extract(t.marca_json, '$.handle') AS handle, json_extract(t.marca_json, '$.logoR2') AS logo_r2,
            (SELECT a.municipio_nome FROM tenant_areas a WHERE a.tenant_id = t.id AND a.bairro IS NULL ORDER BY a.rowid LIMIT 1) AS municipio
       FROM membros m JOIN tenants t ON t.id = m.tenant_id WHERE m.user_id = ? ORDER BY t.nome`,
  ).bind(u.id).all<{ id: string; slug: string; nome: string; modo: string; uf: string | null; idioma: ContentLanguage; plano: string; papel: string; municipio: string | null; handle: string | null; logo_r2: string | null }>();
  // @ and logo (URL signed for 1 h) for the outlet picker in the sidebar.
  const tenants = await Promise.all(results.map(async ({ logo_r2, ...t }) => ({ ...t, logo: logo_r2 ? await signMedia(c.env, logo_r2, 3600) : null })));
  // Google Docs: only with the Google configuration (otherwise null and the interface hides it). The key and project
  // number are the Picker's (public by nature, restricted to the domain in Google Cloud); the token never comes here.
  const google = googleConfigured(c.env)
    ? { conectado: await docsConnected(c.env, u.id), apiKey: c.env.GOOGLE_API_KEY!, appId: c.env.GOOGLE_PROJECT_NUMBER!, escopo: SCOPE_DOCS }
    : null;
  // The language the person chose (null: not chosen yet, and the screen follows the browser).
  const pref = await c.env.DB.prepare('SELECT idioma FROM "user" WHERE id = ?').bind(u.id).first<{ idioma: string | null }>();
  const language = isLanguage(pref?.idioma) ? pref.idioma : null;
  return c.json({ user: { id: u.id, email: u.email, name: u.name, image: u.image ?? null, idioma: language }, tenants, google, adminPlataforma: isAdminPlatform(c.env, u.id) });
})

// The person's screen language, stored on the account (it applies on any device).
.put('/me/idioma', async (c) => {
  const b = await readJson<{ idioma: unknown }>(c);
  if (!isLanguage(b.idioma)) return c.json({ erro: t(c, 'idioma: pt-BR ou en', 'idioma: pt-BR or en') }, 400);
  await c.env.DB.prepare('UPDATE "user" SET idioma = ? WHERE id = ?').bind(b.idioma, c.get('user').id).run();
  return c.json({ idioma: b.idioma });
})

// A short-lived access token for the Google Picker (the Worker renews it with the saved refresh token). 404 without the
// Google configuration; 409 with `code` when the person needs to connect (again).
.get('/google/token', async (c) => {
  if (!googleConfigured(c.env)) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  try {
    return c.json(await tokenGoogle(c.env, c.get('user').id));
  } catch (e) {
    if (e instanceof GoogleError) return c.json({ erro: t(c, e.message, e.en ?? e.message), code: e.codigo }, e.status);
    throw e;
  }
})

// Open sign-up: any signed-in user creates an outlet and becomes its admin.
// Local mode requires the municipality (IBGE + name): triage only accepts news from a city in tenant_areas.
// Author mode requires the Substack URL (`substack`): the feed becomes the source, feed and page give the name (when not
// sent), logo, colour and signature, and the 3 most recent texts become leads produced as carousels by the queue.
.post('/tenants', async (c) => {
  const b = await readJson<{ nome: string; slug: string; modo: string; uf: string; municipioIbge: string; municipioNome: string; substack: string; idioma: string }>(c);
  const mode = b.modo ?? 'local';
  if (!belongs(MODES_TENANT, mode)) return c.json({ erro: `modo: ${MODES_TENANT.join(' | ')}` }, 400);
  // Content language (posts, cards, caption and check). Without it, Portuguese.
  if (b.idioma !== undefined && !isLanguageContent(b.idioma)) return c.json({ erro: t(c, 'idioma: pt-BR ou en', 'idioma: pt-BR or en') }, 400);
  const language = fromOutletLanguage(b.idioma);
  let name = String(b.nome ?? '').trim();
  let substack: Substack | null = null;
  if (mode === 'autoral') {
    const origin = typeof b.substack === 'string' ? substackOrigin(b.substack) : null;
    if (!origin) return c.json({ erro: t(c, 'Cole o endereço do seu Substack, por exemplo https://seunome.substack.com.', 'Paste the address of your Substack, for example https://yourname.substack.com.'), code: 'substack_invalido' }, 400);
    try {
      substack = await readSubstack(origin);
    } catch (e) {
      if (!(e instanceof AuthorError)) throw e;
      return c.json({ erro: t(c, 'Não achamos os textos desse endereço. Confira se é a página do seu Substack, por exemplo https://seunome.substack.com.', "We couldn't find any posts at that address. Check that it's your Substack page, for example https://yourname.substack.com."), code: 'substack_sem_feed' }, 400);
    }
    if (!name) name = (substack.titulo ?? '').slice(0, 80).trim();
  }
  if (name.length < 2 || name.length > 80) return c.json({ erro: t(c, 'nome entre 2 e 80 caracteres', 'name must be 2 to 80 characters') }, 400);
  const slug = b.slug ?? slugify(name);
  if (!SLUG.test(slug)) return c.json({ erro: t(c, 'slug: 3 a 40 caracteres, a-z, 0-9 e hífen', 'slug: 3 to 40 characters, a-z, 0-9 and hyphen') }, 400);
  // An author outlet has no per-city coverage (like a topical one).
  const ibge = mode === 'autoral' ? null : b.municipioIbge?.trim() || null;
  const municipality = mode === 'autoral' ? null : b.municipioNome?.trim() || null;
  if (mode === 'local' && (!ibge || !/^\d{7}$/.test(ibge) || !municipality)) {
    return c.json({ erro: t(c, 'modo local exige municipioIbge (7 dígitos) e municipioNome (como aparece nas notícias)', 'local mode requires municipioIbge (7 digits) and municipioNome (as it appears in the news)') }, 400);
  }

  const id = newId();
  const userId = c.get('user').id;
  // The brand is born with the outlet's name: without a logo, the card signs with it (the render's neutral palette). Author: Substack's.
  let brand: Record<string, unknown> = { nome: name };
  if (substack) {
    const logoR2 = await downloadLogo(c.env, id, substack.imagem);
    brand = { ...authorBrand(name, substack, language), ...(logoR2 ? { logoR2 } : {}) };
  }
  try {
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO tenants (id, slug, nome, modo, uf, municipio_ibge, marca_json, idioma, plano) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, slug, name, mode, mode === 'autoral' ? null : b.uf ?? null, ibge, JSON.stringify(brand), language, initialPlan(c.env)),
      c.env.DB.prepare("INSERT INTO membros (id, tenant_id, user_id, papel) VALUES (?, ?, ?, 'admin')").bind(newId(), id, userId),
      ...(ibge && municipality
        ? [c.env.DB.prepare('INSERT INTO tenant_areas (tenant_id, municipio_ibge, municipio_nome, bairro) VALUES (?, ?, ?, NULL)').bind(id, ibge, municipality)]
        : []),
      ...(substack
        ? [c.env.DB.prepare("INSERT INTO fontes (id, tenant_id, tipo, nome, url) VALUES (?, ?, 'rss', ?, ?)").bind(newId(), id, (substack.titulo ?? name).slice(0, 80), substack.feedUrl)]
        : []),
    ]);
  } catch (e) {
    if (String(e).includes('UNIQUE')) return c.json({ erro: t(c, 'slug em uso', 'slug already in use') }, 409);
    throw e;
  }
  const urls = substack?.itens.slice(0, ITEMS_INITIALS).map((i) => i.url) ?? [];
  // The outlet already exists: the queue being down does not undo the sign-up (repeating would give "slug in use").
  // Without the message, the first posts do not go out on their own, but the feed is among the sources and the monitor
  // brings the texts in the next round.
  let texts = 0;
  if (urls.length) {
    try {
      await c.env.MONITOR_QUEUE.send({ tipo: 'autoral', tenantId: id, por: userId, urls });
      texts = urls.length;
    } catch (e) {
      await recordEvent(c.env, id, 'autoral.fila_falhou', 'tenant', id, { erro: String(e).slice(0, 300) });
    }
  }
  return c.json({ id, slug, nome: name, modo: mode, idioma: language, papel: 'admin', textos: texts }, 201);
})

// Model usage, only for the platform owner (web/src/screens/Usage.tsx). The screen asks again every 3 s.
.get('/admin/uso', requireAdminPlatform, async (c) => {
  const request = Number(c.req.query('dias'));
  return c.json(await panelUsage(c.env, PERIODS_USAGE.find((d) => d === request) ?? 1));
})

.post('/admin/ai-licenca', requireAdminPlatform, async (c) => {
  const { modelo: model } = await readJson<{ modelo: string }>(c);
  if (!model || !MODELS_WITH_LICENSE.has(model)) return c.json({ erro: t(c, 'modelo fora da lista', 'model not on the list'), modelos: [...MODELS_WITH_LICENSE] }, 400);
// The acceptance answers with error 5016 "Thank you for agreeing": it is a success, not a failure.
  try {
    const out = await c.env.AI.run(model as keyof AiModels, { prompt: 'agree' } as never) as { response?: string };
    return c.json({ modelo: model, resposta: String(out?.response ?? '').slice(0, 200) });
  } catch (e) {
    const msg = String(e);
    return c.json({ modelo: model, aceito: /agreeing|agreed/i.test(msg), resposta: msg.slice(0, 200) }, /agreeing|agreed/i.test(msg) ? 200 : 502);
  }
})

// ── tenant resources ───────────────────────────────────────────────────────────────────────────────────────────

.use('/t/:tenantId/*', requireMember())

// The author outlet's review desk (src/shell/texts.ts).
.route('/t/:tenantId/textos', texts)

// The lead queue by score. `?status=sugerida,aceita` (default: sugerida). With the source name of the first document,
// the number of facts, each fact's text in the lead's order (the Ideas lead sheet shows what the source brings before
// producing) and, if the lead's last piece failed, the reason (the lead goes back to `aceita` and the UI says why).
.get('/t/:tenantId/pautas', queryStatus, async (c) => {
  const status = statusList(c.req.query('status'), LEAD_STATUS, ['sugerida']);
  if (!status) return c.json({ erro: t(c, `status: ${LEAD_STATUS.join(' | ')} (separados por vírgula)`, `status: ${LEAD_STATUS.join(' | ')} (comma-separated)`) }, 400);
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.status, p.origem, p.titulo, p.resumo, p.editoria, p.bairro, p.score, p.created_at, p.municipio_ibge, p.tipo_post,
            (SELECT an.anunciante FROM anuncios an WHERE an.pauta_id = p.id AND an.tenant_id = p.tenant_id) AS anunciante,
            (SELECT a.municipio_nome FROM tenant_areas a WHERE a.tenant_id = p.tenant_id AND a.municipio_ibge = p.municipio_ibge
              ORDER BY a.bairro IS NOT NULL LIMIT 1) AS cidade,
            json_array_length(p.fato_ids_json) AS nfatos,
            (SELECT json_group_array(texto) FROM (
               SELECT f.texto FROM json_each(p.fato_ids_json) j
                 JOIN fatos f ON f.id = j.value AND f.tenant_id = p.tenant_id
                ORDER BY j.key)) AS fatos_json,
            (SELECT fo.nome FROM documentos d JOIN fontes fo ON fo.id = d.fonte_id
              WHERE d.id = json_extract(p.documento_ids_json, '$[0]') AND d.tenant_id = p.tenant_id) AS fonte,
            (SELECT d.url FROM documentos d WHERE d.id = json_extract(p.documento_ids_json, '$[0]') AND d.tenant_id = p.tenant_id) AS documento_url,
            (SELECT CASE WHEN pc.status = 'falhou' THEN COALESCE(pc.erro, '') END FROM pecas pc
              WHERE pc.pauta_id = p.id AND pc.tenant_id = p.tenant_id ORDER BY pc.created_at DESC, pc.rowid DESC LIMIT 1) AS falhou
       FROM pautas p WHERE p.tenant_id = ? AND p.status IN (${status.map(() => '?').join(', ')})
      ORDER BY p.score DESC, p.created_at DESC LIMIT 100`,
  ).bind(c.get('tenant').id, ...status).all<{
    id: string; status: string; origem: string; titulo: string; resumo: string | null; editoria: string | null; bairro: string | null;
    score: number | null; created_at: string; nfatos: number; fatos_json: string; fonte: string | null; documento_url: string | null; falhou: string | null;
    municipio_ibge: string | null; cidade: string | null; tipo_post: string | null; anunciante: string | null;
  }>();
  // How many arrived after `?desde=` (ms), counted in the database: the list above stops at 100.
  const since = sinceSql(c.req.query('desde'));
  const created = since === null ? null : (await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM pautas WHERE tenant_id = ? AND status IN (${status.map(() => '?').join(', ')}) AND created_at > ?`,
  ).bind(c.get('tenant').id, ...status, since).first<{ n: number }>())?.n ?? 0;
  // A link brought by hand has no registered source: the site counts (the same one the card signs with).
  const leads = results.map(({ documento_url: document_url, fatos_json: facts_json, ...p }) => ({ ...p, fonte: p.fonte ?? hostOf(document_url), fatos: JSON.parse(facts_json) as string[] }));
  return c.json({ pautas: leads, novasDesde: created });
})

// + New: link (`{url}`), account (`{texto}`), Google Docs (`{docs: id}`, with the Google configuration) or screenshot
// (raw PNG/JPEG/WebP body) → a `manual` lead at the top of Ideas. Any member (reporters bring news too). Same content →
// same idea (`situacao`: nova, existente, de_volta).
.post('/t/:tenantId/pautas', async (c) => {
  const type = (c.req.header('content-type') ?? '').split(';')[0].trim().toLowerCase();
  let request: NewRequest;
  if (type.startsWith('image/')) {
    const bytes = await readBodyUntil(c.req.raw.body, PRINT_MAX_BYTES);
    if (!bytes) return c.json({ erro: t(c, 'print acima de 4 MB', 'screenshot over 4 MB'), code: 'imagem_grande' }, 413);
    request = { tipo: 'print', bytes, mime: type };
  } else {
    const b = await readJson<{ url: unknown; texto: unknown; docs: unknown; anuncio: { anunciante?: unknown; briefing?: unknown } }>(c);
    if (b.anuncio !== undefined) {
      const mode = await c.env.DB.prepare('SELECT modo FROM tenants WHERE id = ?').bind(c.get('tenant').id).first<{ modo: string }>();
      if (mode?.modo === 'autoral') return c.json({ erro: t(c, 'veículo de autor não faz anúncio', "author publications don't run ads"), code: 'pedido_invalido' }, 400);
      if (typeof b.anuncio?.anunciante !== 'string' || typeof b.anuncio?.briefing !== 'string') return c.json({ erro: t(c, 'anuncio: {anunciante, briefing}', 'anuncio: {anunciante, briefing}'), code: 'pedido_invalido' }, 400);
      request = { tipo: 'anuncio', anunciante: b.anuncio.anunciante, briefing: b.anuncio.briefing };
    } else if (b.docs !== undefined) {
      // Google Docs (chosen in the Picker): read here with the person's token and brought in as an account with title and origin.
      if (!googleConfigured(c.env)) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
      try {
        const doc = await readDocument(c.env, c.get('user').id, String(b.docs));
        request = { tipo: 'relato', titulo: doc.titulo, texto: fromDocText(doc), origem: { url: fromDocUrl(doc.id), revisao: doc.revisao } };
      } catch (e) {
        if (e instanceof GoogleError) return c.json({ erro: t(c, e.message, e.en ?? e.message), code: e.codigo }, e.status);
        throw e;
      }
    } else if (typeof b.url === 'string') request = { tipo: 'link', url: b.url };
    else if (typeof b.texto === 'string') request = { tipo: 'relato', texto: b.texto };
    else return c.json({ erro: t(c, 'mande {url}, {texto} ou a imagem do print', 'send {url}, {texto} or the screenshot image'), code: 'pedido_invalido' }, 400);
  }
  try {
    const r = await newLead(c.env, c.get('tenant').id, c.get('user').id, request);
    return c.json(r, r.situacao === 'existente' ? 200 : 201);
  } catch (e) {
    if (e instanceof NewError) return c.json({ erro: t(c, e.message, e.en ?? e.message), code: e.codigo }, e.status);
    throw e;
  }
})

// Take the idea out of the queue. Only from sugerida or aceita: a lead in production has a piece moving and does not disappear through here.
.post('/t/:tenantId/pautas/:id/descartar', requireMember('editor'), async (c) => {
  const { motivo: reason } = await readJson<{ motivo: string }>(c);
  await transition(c.env, {
    tipo: 'pauta', id: c.req.param('id'), tenantId: c.get('tenant').id, para: 'descartada', por: c.get('user').id,
    motivo: reason?.slice(0, 500) || null, de: ['sugerida', 'aceita'],
  });
  return c.json({ status: 'descartada' as const });
})

// Lead → piece + production round 1. Lead, piece and run in one batch; the Workflow instance only afterwards.
.post('/t/:tenantId/pautas/:id/produzir', requireMember('editor'), async (c) => {
  const tenantId = c.get('tenant').id;
  const { formato: format = 'carrossel' } = await readJson<{ formato: string }>(c);
  if (!belongs(FORMATS_LEAD, format)) return c.json({ erro: `formato: ${FORMATS_LEAD.join(' | ')}` }, 400);
  const r = await produceLead(c.env, tenantId, c.req.param('id'), c.get('user').id, format);
  if (!r) return c.json({ erro: t(c, 'pauta já está em produção', 'idea is already in production') }, 409);
  if (r.pendente) return c.json({ pecaId: r.pecaId, workflowId: r.workflowId, pendente: true, aviso: PENDING }, 202);
  return c.json({ pecaId: r.pecaId, workflowId: r.workflowId }, 201);
})

// Pieces for the queue (default: producing and in review), with the headline and the signed cover (1 h) for the
// thumbnail. In-review ones come first, the one waiting longest in front; approved ones (Ready to post) also in arrival
// order, with the noted time in place when there is one; the rest, most recent first. The list stops at 50; the count
// per status (`total`, and `manuais` for approved ones someone posts by hand) covers all of them, so the counters do not lie.
.get('/t/:tenantId/pecas', queryStatus, async (c) => {
  const tenantId = c.get('tenant').id;
  const status = statusList(c.req.query('status'), PIECE_STATUS, ['rascunho', 'revisao']);
  if (!status) return c.json({ erro: t(c, `status: ${PIECE_STATUS.join(' | ')} (separados por vírgula)`, `status: ${PIECE_STATUS.join(' | ')} (comma-separated)`) }, 400);
  const at = status.map(() => '?').join(', ');
  const [list, count] = await c.env.DB.batch<Record<string, unknown>>([
    c.env.DB.prepare(
      `SELECT pc.id, pc.status, pc.formato, pc.rodada, pc.created_at, pc.updated_at, pa.titulo, pa.editoria,
              pc.agendado_para, co.modo AS conta_modo, co.nome AS conta_nome, co.external_id AS conta_external_id,
              json_extract(pc.conteudo_json, '$.manchete') AS manchete,
              json_array_length(pc.arte_r2_keys_json) AS ncards,
              json_extract(pc.arte_r2_keys_json, '$[0].jpg') AS capa_r2
         FROM pecas pc JOIN pautas pa ON pa.id = pc.pauta_id AND pa.tenant_id = pc.tenant_id
         LEFT JOIN contas_sociais co ON co.id = pc.conta_id AND co.tenant_id = pc.tenant_id
        WHERE pc.tenant_id = ? AND pc.status IN (${at})
        ORDER BY pc.status = 'revisao' DESC,
                 CASE WHEN pc.status IN ('revisao', 'aprovada', 'agendada') THEN COALESCE(datetime(pc.agendado_para), pc.updated_at) END ASC,
                 pc.updated_at DESC, pc.id
        LIMIT 50`,
    ).bind(tenantId, ...status),
    c.env.DB.prepare(
      `SELECT pc.status, COUNT(*) AS n, SUM(co.modo = 'manual') AS manuais
         FROM pecas pc LEFT JOIN contas_sociais co ON co.id = pc.conta_id AND co.tenant_id = pc.tenant_id
        WHERE pc.tenant_id = ? AND pc.status IN (${at}) GROUP BY pc.status`,
    ).bind(tenantId, ...status),
  ]);
  const lines = list.results as {
    id: string; status: string; formato: string; rodada: number; created_at: string; updated_at: string; titulo: string;
    editoria: string | null; manchete: string | null; ncards: number | null; capa_r2: string | null;
    agendado_para: string | null; conta_modo: string | null; conta_nome: string | null; conta_external_id: string | null;
  }[];
  const pieces = await Promise.all(lines.map(async ({ capa_r2: cover_r2, ...p }) => ({
    ...p, capa: cover_r2 ? await signMedia(c.env, cover_r2, 3600) : null,
  })));
  const accounts = count.results as { status: string; n: number; manuais: number | null }[];
  const total: Record<string, number> = Object.fromEntries(accounts.map((r) => [r.status, r.n]));
  // Approved and scheduled on a manual account: waiting for someone to post (the Ready to post counter).
  const manual = accounts.filter((r) => r.status === 'aprovada' || r.status === 'agendada').reduce((n, r) => n + (r.manuais ?? 0), 0);
  // Ready to approve since `?desde=` (ms), counted in the database: the list stops at 50.
  const since = sinceSql(c.req.query('desde'));
  const ready = since === null ? null : (await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM pecas WHERE tenant_id = ? AND status = 'revisao' AND updated_at > ?",
  ).bind(tenantId, since).first<{ n: number }>())?.n ?? 0;
  return c.json({ pecas: pieces, total, manuais: manual, prontasDesde: ready });
})

// Light progress for the 2 s polling: D1 only (without querying the Workflow or signing art).
.get('/t/:tenantId/pecas/:id/status', async (c) => {
  const tenantId = c.get('tenant').id;
  const id = c.req.param('id');
  const pc = await c.env.DB.prepare(
    `SELECT pc.id, pc.status, pc.formato, pc.rodada, pc.versao, pc.erro, pc.created_at, pc.updated_at, pa.titulo,
            pc.pauta_id, pa.status AS pauta_status,
            json_extract(pc.conteudo_json, '$.manchete') AS manchete, json_extract(pc.validacao_json, '$.ok') AS validacao_ok,
            (SELECT e.iniciado_em FROM execucoes e WHERE e.id = pc.workflow_id AND e.tenant_id = pc.tenant_id) AS iniciada_em,
            pc.agendado_para, co.modo AS conta_modo, co.nome AS conta_nome, co.external_id AS conta_external_id,
            pu.status AS publicacao_status, pu.url AS publicacao_url, pu.publicado_em, pu.modo AS publicacao_modo
       FROM pecas pc JOIN pautas pa ON pa.id = pc.pauta_id AND pa.tenant_id = pc.tenant_id
       LEFT JOIN contas_sociais co ON co.id = pc.conta_id AND co.tenant_id = pc.tenant_id
       -- The last attempt to publish (Posted: the link; a publish failure: the screen says it was posting).
       LEFT JOIN publicacoes pu ON pu.id = (SELECT p2.id FROM publicacoes p2 WHERE p2.peca_id = pc.id AND p2.tenant_id = pc.tenant_id
                                             ORDER BY p2.created_at DESC, p2.rowid DESC LIMIT 1)
      WHERE pc.id = ? AND pc.tenant_id = ?`,
  ).bind(id, tenantId).first<{
    id: string; status: string; formato: string; rodada: number; versao: number; erro: string | null; created_at: string;
    pauta_id: string; pauta_status: string;
    updated_at: string; titulo: string; manchete: string | null; validacao_ok: number | null; iniciada_em: string | null;
    agendado_para: string | null; conta_modo: string | null; conta_nome: string | null; conta_external_id: string | null;
    publicacao_status: string | null; publicacao_url: string | null; publicado_em: string | null; publicacao_modo: string | null;
  }>();
  if (!pc) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  let progress: ReturnType<typeof stepProduction> | null = null;
  if (pc.status === 'rascunho') {
    const [versions, illustrated] = await c.env.DB.batch<{ versao?: number; ok?: number }>([
      c.env.DB.prepare('SELECT versao FROM peca_versoes WHERE peca_id = ? AND tenant_id = ? AND rodada = ?').bind(id, tenantId, pc.rodada),
      c.env.DB.prepare(`SELECT 1 AS ok FROM eventos WHERE ref_tipo = 'peca' AND ref_id = ? AND tenant_id = ?
                          AND tipo IN ('peca.ilustracao', 'peca.ilustracao_falhou') AND json_extract(payload_json, '$.versao') = ? LIMIT 1`)
        .bind(id, tenantId, pc.versao),
    ]);
    progress = stepProduction({
      versaoExibida: pc.versao, versoesDaRodada: versions.results.map((v) => Number(v.versao)),
      validacaoOk: pc.validacao_ok === null ? null : pc.validacao_ok === 1, ilustrou: illustrated.results.length > 0, reels: pc.formato === 'reels',
    });
  }
  const { validacao_ok: _ok, ...piece } = pc;
  return c.json({ ...piece, etapa: progress?.etapa ?? null, tentativa: progress?.tentativa ?? null });
})

// Piece + art with signed URLs (1 h) + events, decisions and publications.
.get('/t/:tenantId/pecas/:id', async (c) => {
  const tenantId = c.get('tenant').id;
  const id = c.req.param('id');
  const piece = await c.env.DB.prepare('SELECT * FROM pecas WHERE id = ? AND tenant_id = ?').bind(id, tenantId).first<Record<string, unknown>>();
  if (!piece) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  const workflow = piece.workflow_id
    ? await c.env.PRODUCAO_WORKFLOW.get(piece.workflow_id as string).then((i) => i.status()).catch(() => null)
    : null;
  const artwork = piece.arte_r2_keys_json
    ? await Promise.all((JSON.parse(piece.arte_r2_keys_json as string) as ArtRendered[]).map(async (a) => ({
        papel: a.papel, id: a.id ?? null, hash: a.hash ?? null, png: await signMedia(c.env, a.png, 3600), jpg: await signMedia(c.env, a.jpg, 3600),
        // Reels: the MP4 (the cover is the png/jpg).
        mp4: (a as Partial<ArtReels>).mp4 ? await signMedia(c.env, (a as ArtReels).mp4, 3600) : null,
        duracao: (a as Partial<ArtReels>).duracao ?? null,
      })))
    : [];
  const contentPiece = piece.conteudo_json ? (JSON.parse(piece.conteudo_json as string) as { cards?: Card[]; estilo?: PieceStyle }) : {};
  // In review (carousel editing) and approved (the standing preview of Make the Reels).
  const preview = piece.status === 'revisao' || piece.status === 'aprovada'
    ? await previewPiece(c.env, tenantId, { id, pauta_id: piece.pauta_id as string }, contentPiece.cards ?? [], piece.arte_r2_keys_json ? JSON.parse(piece.arte_r2_keys_json as string) : [], contentPiece.estilo)
    : null;
  const model = piece.status === 'revisao' ? await fromStyleStatus(c.env, tenantId, contentPiece.estilo) : null;
  const [events, decisions, publications, lead, facts] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT id, tipo, payload_json, created_at FROM eventos WHERE tenant_id = ? AND ref_tipo = 'peca' AND ref_id = ? ORDER BY id").bind(tenantId, id),
    c.env.DB.prepare('SELECT versao, decisao, por, payload_json, created_at FROM decisoes WHERE tenant_id = ? AND peca_id = ? ORDER BY created_at').bind(tenantId, id),
    c.env.DB.prepare('SELECT id, conta_id, rede, modo, external_id, url, publicado_em, status, erro FROM publicacoes WHERE tenant_id = ? AND peca_id = ? ORDER BY created_at').bind(tenantId, id),
    c.env.DB.prepare('SELECT titulo, editoria, bairro, tipo_post, origem FROM pautas WHERE id = ? AND tenant_id = ?').bind(piece.pauta_id, tenantId),
    // The lead's facts, in its order, with the source and the document's link (review: "facts used"). For a screenshot
    // brought through + New, the image itself (the text was read by a model: the reviewer checks against it).
    c.env.DB.prepare(
      `SELECT f.id, f.tipo, f.texto, d.url, fo.nome AS fonte, d.titulo AS fonte_titulo, f.evidencia_trecho AS evidencia, CASE WHEN d.url LIKE 'print:%' THEN d.r2_bruto END AS print_r2
         FROM pautas pa JOIN json_each(pa.fato_ids_json) j
         JOIN fatos f ON f.id = j.value AND f.tenant_id = pa.tenant_id
         LEFT JOIN documentos d ON d.id = f.documento_id AND d.tenant_id = f.tenant_id
         LEFT JOIN fontes fo ON fo.id = d.fonte_id AND fo.tenant_id = f.tenant_id
        WHERE pa.id = ? AND pa.tenant_id = ?
        ORDER BY j.key`,
    ).bind(piece.pauta_id, tenantId),
  ]);
  const json = (s: unknown) => (s ? JSON.parse(s as string) : null);
  return c.json({
    peca: { ...piece, conteudo_json: undefined, arte_r2_keys_json: undefined, validacao_json: undefined, conteudo: json(piece.conteudo_json) ?? {}, validacao: json(piece.validacao_json) },
    artes: artwork, workflow, previa: preview, modelo: model,
    pauta: (lead.results[0] ?? null) as { titulo: string; editoria: string | null; bairro: string | null } | null,
    fatos: await Promise.all((facts.results as { id: string; tipo: string | null; texto: string; url: string | null; fonte: string | null; fonte_titulo: string | null; evidencia: string | null; print_r2: string | null }[])
      // Story: the evidence passage that supports the author's sentence and the page title (Review shows it per sentence).
      .map(async ({ print_r2, fonte_titulo: title_source, ...f }) => ({ ...f, fonteTitulo: f.evidencia ? title_source : null, print: print_r2 ? await signMedia(c.env, print_r2, 3600) : null }))),
    eventos: (events.results as Record<string, unknown>[]).map((e) => ({ id: e.id, tipo: e.tipo, em: e.created_at, payload: json(e.payload_json) })),
    decisoes: (decisions.results as Record<string, unknown>[]).map((d) => ({ ...d, payload_json: undefined, payload: json(d.payload_json) })),
    publicacoes: publications.results,
  });
})

// Package to publish by hand (or for an intermediary): JPEGs signed for 24 h + a ready caption.
.get('/t/:tenantId/pecas/:id/pacote', async (c) => {
  const pkg = await packagePublication(c.env, c.get('tenant').id, c.req.param('id'));
  return pkg ? c.json(pkg) : c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
})
.get('/t/:tenantId/pecas/:id/legenda.txt', async (c) => {
  const pkg = await packagePublication(c.env, c.get('tenant').id, c.req.param('id'));
  return pkg ? c.text(pkg.legenda) : c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
})

// Reels music library (src/lib/music.ts): title, author and licence with its link. The R2 key stays on the server.
.get('/t/:tenantId/musicas', async (c) => {
  const bands = await libraryMusical(c.env);
  return c.json({ musicas: bands.map(({ id, titulo: title, autor: author, licenca: license, licencaUrl: licenseUrl }) => ({ id, titulo: title, autor: author, licenca: license, licencaUrl: licenseUrl })) });
})

// Make the Reels from a carousel (editors and above): a new post in the reels format, with the text of the version on
// screen, produced by ProducaoWorkflow (the Container step). The lead does not change: the carousel holds it.
.get('/t/:tenantId/pecas/:id/narracao', async (c) => {
  const tenantId = c.get('tenant').id;
  const piece = await c.env.DB.prepare('SELECT versao FROM pecas WHERE id = ? AND tenant_id = ?').bind(c.req.param('id'), tenantId).first<{ versao: number }>();
  if (!piece) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  const n = await narrationVersion(c.env, tenantId, c.req.param('id'), piece.versao);
  return c.json({ narracao: n ? narrationToScreen(n) : null });
})
.post('/t/:tenantId/pecas/:id/narracao', requireMember('editor'), async (c) => {
  const tenantId = c.get('tenant').id;
  const pieceId = c.req.param('id');
  const piece = await c.env.DB.prepare('SELECT status, versao, formato FROM pecas WHERE id = ? AND tenant_id = ?').bind(pieceId, tenantId).first<{ status: string; versao: number; formato: string }>();
  if (!piece) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  if (piece.formato !== 'carrossel') return c.json({ erro: t(c, 'a voz vai num Reels de carrossel', 'the voice goes on a carousel Reel') }, 400);
  if (piece.status !== 'revisao' && piece.status !== 'aprovada') return c.json({ erro: t(c, 'o Reels sai de um carrossel em revisão ou aprovado', 'a Reel is made from a carousel that is in review or approved') }, 409);
  const bytes = await readBodyUntil(c.req.raw.body, NARRATION_MAX_BYTES);
  if (!bytes) return c.json({ erro: t(c, 'a fala passa de 10 MB', 'the voice file is over 10 MB') }, 422);
  const id = await receiveNarration(c.env, tenantId, pieceId, piece.versao, c.get('user').id, bytes);
  if (!id) return c.json({ erro: t(c, 'esse arquivo não é um áudio que o app lê', "that file isn't audio the app reads") }, 422);
  return c.json({ id }, 201);
})
.post('/t/:tenantId/pecas/:id/narracao/:narracao/avisos/:indice', requireMember('editor'), async (c) => {
  const warnings = await decideWarning(c.env, c.get('tenant').id, c.req.param('id'), c.req.param('narracao'), Number(c.req.param('indice')));
  if (!warnings) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  return c.json({ avisos: warnings });
})
.get('/t/:tenantId/pecas/:id/narracao/:narracao/audio', async (c) => {
  const n = await narrationPerId(c.env, c.get('tenant').id, c.req.param('id'), c.req.param('narracao'));
  const obj = n ? await c.env.MEDIA.get(n.r2) : null;
  if (!n || !obj) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  return new Response(obj.body, { headers: { 'content-type': n.mime, 'cache-control': 'private, no-store' } });
})
.post('/t/:tenantId/pecas/:id/reels', requireMember('editor'), async (c) => {
  const tenantId = c.get('tenant').id;
  const originId = c.req.param('id');
  const b = await readJson<{ musica: unknown; versao: unknown; passo: unknown; movimento: unknown; narracao: unknown }>(c);
  if (!Number.isInteger(b.versao)) return c.json({ erro: t(c, 'versao: inteiro (a versão do carrossel que está na tela)', 'versao: integer (the carousel version on screen)') }, 400);
  if (b.passo !== undefined && !STEPS_REELS.includes(b.passo as never)) return c.json({ erro: t(c, `passo: ${STEPS_REELS.join(', ')}`, `pace: ${STEPS_REELS.join(', ')}`) }, 400);
  if (b.movimento !== undefined && !MOTIONS_REELS.includes(b.movimento as never)) return c.json({ erro: t(c, `movimento: ${MOTIONS_REELS.join(', ')}`, `motion: ${MOTIONS_REELS.join(', ')}`) }, 400);
  const origin = await c.env.DB.prepare("SELECT id, pauta_id, status, versao, formato, json_extract(validacao_json, '$.ok') AS ok, json_extract(conteudo_json, '$.estilo.params.reels') AS reels, arte_r2_keys_json FROM pecas WHERE id = ? AND tenant_id = ?")
    .bind(originId, tenantId).first<{ id: string; pauta_id: string; status: string; versao: number; formato: string; ok: number | null; reels: string | null; arte_r2_keys_json: string | null }>();
  if (!origin) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  if (origin.formato !== 'carrossel') return c.json({ erro: t(c, 'o Reels sai de um carrossel', 'a Reel is made from a carousel') }, 400);
  if (origin.status !== 'revisao' && origin.status !== 'aprovada') return c.json({ erro: t(c, `o Reels sai de um carrossel em revisão ou aprovado; este está em ${origin.status}`, `a Reel is made from a carousel in review or approved; this one is ${origin.status}`) }, 409);
  if (origin.ok === 0) return c.json({ erro: t(c, 'a conferência apontou problema num card do carrossel; corrija antes de fazer o Reels', 'the check found a problem in a carousel card; fix it before making the Reel') }, 409);
  // The version the person saw: if someone else saved afterwards, the Reels does not come from a text they did not read.
  if (b.versao !== origin.versao) return c.json({ erro: t(c, `o carrossel está na versão ${origin.versao}, não na ${b.versao}: outra pessoa salvou antes; abra de novo`, `the carousel is at version ${origin.versao}, not ${b.versao}: someone else saved first; open it again`) }, 409);
  const artwork = origin.arte_r2_keys_json ? (JSON.parse(origin.arte_r2_keys_json) as ArtRendered[]) : [];
  if (!artwork.length) return c.json({ erro: t(c, 'o carrossel ainda não tem os cards montados', "the carousel's cards haven't been built yet") }, 409);
  // A repeated request (double tap, a network resend): one Reels of this carousel being built is enough.
  const moving = await c.env.DB.prepare(
    "SELECT ref_id FROM execucoes WHERE tenant_id = ? AND tipo = 'producao' AND status = 'rodando' AND json_extract(params_json, '$.origem.pecaId') = ? LIMIT 1",
  ).bind(tenantId, originId).first<{ ref_id: string }>();
  if (moving) return c.json({ erro: t(c, 'já há um Reels deste carrossel sendo montado', 'a Reel of this carousel is already being built'), pecaId: moving.ref_id }, 409);
  let music: string | null = null;
  if (b.musica !== undefined && b.musica !== null) {
    if (typeof b.musica !== 'string' || !(await libraryMusical(c.env)).some((m) => m.id === b.musica)) return c.json({ erro: t(c, 'musica: uma faixa da biblioteca, ou null', 'musica: a track from the library, or null') }, 400);
    music = b.musica;
  }
  // With voice: this version's take, transcribed, with each warning decided by a person.
  let narration: string | null = null;
  if (b.narracao !== undefined && b.narracao !== null) {
    const n = typeof b.narracao === 'string' ? await narrationPerId(c.env, tenantId, originId, b.narracao) : null;
    if (!n) return c.json({ erro: t(c, 'narração não encontrada', 'voice recording not found') }, 404);
    if (n.versao !== origin.versao) return c.json({ erro: t(c, 'o carrossel mudou depois da gravação; grave de novo', 'the carousel changed after the recording; record it again') }, 409);
    if (n.estado !== 'pronto') return c.json({ erro: t(c, 'a fala ainda não foi conferida', "the voice hasn't been checked yet") }, 409);
    if (n.avisos.some((a) => !a.decisao)) return c.json({ erro: t(c, 'há aviso da fala sem decisão', 'there are voice warnings without a decision') }, 409);
    narration = n.id;
  }
  // What the screen sent; without it, what the carousel's template stored.
  const fromModel: ReelsPace = { ...DEFAULT_PACE, ...(origin.reels ? JSON.parse(origin.reels) as ReelsPace : {}) };
  const pace: ReelsPace = { passo: (b.passo as ReelsStep | undefined) ?? fromModel.passo, movimento: (b.movimento as MotionReels | undefined) ?? fromModel.movimento };
  const pieceId = newId();
  const executionId = productionId(pieceId, 1);
  // Art and illustration frozen here, with the text: a carousel edit after the request does not mix versions.
  const params: ProductionParams = {
    tenantId, pautaId: origin.pauta_id, pecaId: pieceId, formato: 'reels', rodada: 1, musica: music, ritmo: pace, narracao: narration,
    origem: {
      pecaId: originId, versao: origin.versao, capa: { png: artwork[0].png, jpg: artwork[0].jpg },
      ilustracao: (await currentIllustration(c.env, tenantId, originId, artwork)) ?? null, em: new Date().toISOString(),
    },
  };
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO pecas (id, tenant_id, pauta_id, formato, rodada, workflow_id) VALUES (?, ?, ?, 'reels', 1, ?)").bind(pieceId, tenantId, origin.pauta_id, executionId),
    startExecution(c.env, { id: executionId, tenantId, tipo: 'producao', refTipo: 'peca', refId: pieceId, params }),
  ]);
  await recordEvent(c.env, tenantId, 'peca.reels_pedido', 'peca', originId, { reels: pieceId, versao: origin.versao, musica: music, ritmo: pace, narracao: narration, por: c.get('user').id });
  const error = await startProduction(c.env, params);
  if (error) return c.json({ pecaId: pieceId, workflowId: executionId, pendente: true, aviso: PENDING }, 202);
  return c.json({ pecaId: pieceId, workflowId: executionId }, 201);
})

// Carousel editing in Review (editors and above): a new version with the edited cards, revalidated; only the cards that
// changed are built again. `versao` is the one on screen: someone else saved first → 409.
.put('/t/:tenantId/pecas/:id/cards', requireMember('editor'), async (c) => {
  const b = await readJson<{ versao: number; cards: unknown; manchete: unknown }>(c);
  const r = await editCards(c.env, { tenantId: c.get('tenant').id, pecaId: c.req.param('id'), por: c.get('user').id, versao: b.versao, cards: b.cards, manchete: b.manchete, idioma: language(c) });
  if (!r.ok) return c.json({ erro: r.erro }, r.status);
  return c.json({ versao: r.versao, validacao: r.validacao, renderizados: r.renderizados, reaproveitados: r.reaproveitados });
})

// Advertiser post: the approval state (Review), the link the editor copies and the receipt of the published piece.
.get('/t/:tenantId/pecas/:id/anuncio', async (c) => {
  const tenantId = c.get('tenant').id;
  const piece = await pieceAd(c.env, tenantId, c.req.param('id'));
  if (!piece) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  return c.json({ anunciante: piece.anunciante, ...(await approvalState(c.env, tenantId, piece)) });
})
.post('/t/:tenantId/pecas/:id/anuncio/link', requireMember('editor'), async (c) => {
  const tenantId = c.get('tenant').id;
  const piece = await pieceAd(c.env, tenantId, c.req.param('id'));
  if (!piece) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  if (!['revisao', 'aprovada', 'agendada'].includes(piece.status)) return c.json({ erro: t(c, `peça em ${piece.status}: não dá para pedir aprovação`, `post is ${piece.status}: approval can't be requested`) }, 409);
  return c.json(await createLink(c.env, tenantId, piece, c.get('user').id), 201);
})
.put('/t/:tenantId/pecas/:id/estilo', requireMember('editor'), async (c) => {
  const b = await readJson<{ versao?: unknown; estiloId?: unknown }>(c);
  const r = await applyStyle(c.env, { tenantId: c.get('tenant').id, pecaId: c.req.param('id'), por: c.get('user').id, versao: b.versao, estiloId: b.estiloId ?? null, idioma: language(c) });
  if (!r.ok) return c.json({ erro: r.erro }, r.status);
  return c.json(r);
})
.get('/t/:tenantId/pecas/:id/comprovante', requireMember('editor'), async (c) => {
  const id = c.req.param('id');
  const data = await dataReceipt(c.env, c.get('tenant').id, id);
  if (!data) return c.json({ erro: t(c, 'o comprovante sai de um anúncio publicado', 'the proof comes from a published ad') }, 404);
  const html = htmlReceipt(data);
  if (c.req.query('html') === '1') return c.html(html);
  const pdf = await generatePdf(c.env, html);
  return new Response(pdf, { headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="comprovante-${id.slice(0, 8)}.pdf"`, 'cache-control': 'no-store' } });
})

// Checked hook (editors and above): three headlines by angle, each revalidated on a copy. Nothing is stored; the chosen
// one goes through PUT cards. The cost goes on the piece and its cap.
.post('/t/:tenantId/pecas/:id/ajuste', requireMember('editor'), async (c) => {
  const tenantId = c.get('tenant').id;
  const pieceId = c.req.param('id');
  const b = await readJson<{ versao: unknown; cardId: unknown; frase: unknown }>(c);
  if (!Number.isInteger(b.versao)) return c.json({ erro: t(c, 'versao: inteiro (a versão que está na tela)', 'versao: integer (the version on screen)') }, 400);
  const piece = await c.env.DB.prepare('SELECT status, versao, formato, pauta_id, conteudo_json, custo_usd FROM pecas WHERE id = ? AND tenant_id = ?')
    .bind(pieceId, tenantId).first<{ status: string; versao: number; formato: string; pauta_id: string; conteudo_json: string; custo_usd: number }>();
  if (!piece) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  if (piece.formato !== 'post' && piece.formato !== 'carrossel') return c.json({ erro: t(c, 'ajuste só para post e carrossel', 'shortening is only for posts and carousels') }, 400);
  if (piece.status !== 'revisao') return c.json({ erro: t(c, `peça em ${piece.status}, não em revisão`, `post is ${piece.status}, not in review`) }, 409);
  if (b.versao !== piece.versao) return c.json({ erro: t(c, `peça na versão ${piece.versao}, não na ${b.versao}: outra pessoa salvou antes`, `post is at version ${piece.versao}, not ${b.versao}: someone else saved first`) }, 409);
  if (piece.custo_usd >= pieceCapUsd(c.env)) return c.json({ erro: t(c, 'esta peça chegou ao teto de custo; encurte à mão', 'this post reached its cost cap; shorten it by hand') }, 409);
  const lead = await loadLead(c.env, tenantId, piece.pauta_id);
  const draft = JSON.parse(piece.conteudo_json) as Draft;
  const target = fromAdjustmentTarget(lead, draft, b.cardId, b.frase);
  if (target === 'nao_encontrado') return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  if (target === 'fora') return c.json({ erro: t(c, 'este texto não se encurta aqui: citação, convite e afirmação do autor ficam como estão', "this text can't be shortened here: quotes, invite cards and the author's own claims stay as they are") }, 400);
  let output: Awaited<ReturnType<typeof generateAdjustment>>;
  try {
    output = await generateAdjustment(c.env, lead, draft, piece.formato, target);
  } catch {
    return c.json({ erro: t(c, 'não deu para encurtar agora; tente de novo', "couldn't shorten it right now; try again") }, 502);
  }
  await c.env.DB.batch([
    stmtEvent(c.env, { tenantId, tipo: 'peca.ajuste', refTipo: 'peca', refId: pieceId, payload: { versao: piece.versao, cardId: target.card.id, frase: target.indice, aprovadas: output.opcoes.length, reprovadas: output.reprovadas, custoUsd: output.custoUsd, por: c.get('user').id } }),
    c.env.DB.prepare('UPDATE pecas SET custo_usd = custo_usd + ? WHERE id = ? AND tenant_id = ?').bind(output.custoUsd, pieceId, tenantId),
  ]);
  return c.json({ opcoes: output.opcoes, reprovadas: output.reprovadas, custoUsd: output.custoUsd });
})
// Another illustration for a card (editors and above): nothing is stored on the piece. The chosen one goes through PUT
// cards, and the cost goes on the piece and its cap.
.post('/t/:tenantId/pecas/:id/cards/:cardId/ilustracao', requireMember('editor'), async (c) => {
  const tenantId = c.get('tenant').id;
  const pieceId = c.req.param('id');
  const b = await readJson<{ versao: unknown }>(c);
  if (!Number.isInteger(b.versao)) return c.json({ erro: t(c, 'versao: inteiro (a versão que está na tela)', 'versao: integer (the version on screen)') }, 400);
  const piece = await c.env.DB.prepare('SELECT status, versao, formato, pauta_id, conteudo_json, custo_usd FROM pecas WHERE id = ? AND tenant_id = ?')
    .bind(pieceId, tenantId).first<{ status: string; versao: number; formato: string; pauta_id: string; conteudo_json: string; custo_usd: number }>();
  if (!piece) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  if (piece.formato !== 'post' && piece.formato !== 'carrossel') return c.json({ erro: t(c, 'ilustração por card só para post e carrossel', 'card illustrations are only for posts and carousels') }, 400);
  if (piece.status !== 'revisao') return c.json({ erro: t(c, `peça em ${piece.status}, não em revisão`, `post is ${piece.status}, not in review`) }, 409);
  if (b.versao !== piece.versao) return c.json({ erro: t(c, `peça na versão ${piece.versao}, não na ${b.versao}: outra pessoa salvou antes`, `post is at version ${piece.versao}, not ${b.versao}: someone else saved first`) }, 409);
  const draft = JSON.parse(piece.conteudo_json) as Draft;
  const card = normalizeCards(draft.cards).find((x) => x.id === c.req.param('cardId'));
  if (!card) return c.json({ erro: t(c, 'salve o card antes de pedir outra ilustração', 'save the card before asking for another illustration') }, 404);
  if (!takesArt(card, draft.estilo?.params.composicao)) return c.json({ erro: t(c, 'este card não leva ilustração', "this card doesn't use an illustration") }, 400);
  if (piece.custo_usd >= pieceCapUsd(c.env)) return c.json({ erro: t(c, 'esta peça chegou ao teto de custo; suba uma foto', 'this post reached its cost cap; upload a photo') }, 409);
  const done = await illustrationsCard(c.env, tenantId, pieceId, card.id);
  if (done >= MAX_ILLUSTRATIONS_CARD) return c.json({ erro: t(c, `este card já teve ${MAX_ILLUSTRATIONS_CARD} ilustrações; suba uma foto`, `this card already had ${MAX_ILLUSTRATIONS_CARD} illustrations; upload a photo`) }, 409);
  const lead = await loadLead(c.env, tenantId, piece.pauta_id);
  let created: Awaited<ReturnType<typeof illustrateCard>>;
  try {
    created = await illustrateCard(c.env, { tenantId, pecaId: pieceId, pauta: lead, rascunho: draft, card, custoAtualUsd: piece.custo_usd });
  } catch {
    return c.json({ erro: t(c, 'nenhuma ilustração passou na conferência; tente de novo', 'no illustration passed the check; try again') }, 502);
  }
  await c.env.DB.batch([
    stmtEvent(c.env, { tenantId, tipo: 'peca.ilustracao_card', refTipo: 'peca', refId: pieceId, payload: { versao: piece.versao, cardId: card.id, r2Key: created.r2Key, provedor: created.provedor, custoUsd: created.custoUsd, ...(created.fallbackDe ? { fallbackDe: created.fallbackDe } : {}) } }),
    c.env.DB.prepare('UPDATE pecas SET custo_usd = custo_usd + ? WHERE id = ? AND tenant_id = ?').bind(created.custoUsd, pieceId, tenantId),
  ]);
  return c.json({ chave: created.r2Key, url: await signMedia(c.env, created.r2Key, 3600), restantes: MAX_ILLUSTRATIONS_CARD - done - 1, custoUsd: created.custoUsd });
})
.post('/t/:tenantId/pecas/:id/ganchos', requireMember('editor'), async (c) => {
  const tenantId = c.get('tenant').id;
  const pieceId = c.req.param('id');
  const b = await readJson<{ versao: unknown }>(c);
  if (!Number.isInteger(b.versao)) return c.json({ erro: t(c, 'versao: inteiro (a versão que está na tela)', 'versao: integer (the version on screen)') }, 400);
  const piece = await c.env.DB.prepare('SELECT status, versao, formato, pauta_id, conteudo_json, custo_usd FROM pecas WHERE id = ? AND tenant_id = ?')
    .bind(pieceId, tenantId).first<{ status: string; versao: number; formato: string; pauta_id: string; conteudo_json: string; custo_usd: number }>();
  if (!piece) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  if (piece.formato !== 'post' && piece.formato !== 'carrossel') return c.json({ erro: t(c, 'manchetes só para post e carrossel', 'headlines are only for posts and carousels') }, 400);
  if (piece.status !== 'revisao') return c.json({ erro: t(c, `peça em ${piece.status}, não em revisão`, `post is ${piece.status}, not in review`) }, 409);
  if (b.versao !== piece.versao) return c.json({ erro: t(c, `peça na versão ${piece.versao}, não na ${b.versao}: outra pessoa salvou antes`, `post is at version ${piece.versao}, not ${b.versao}: someone else saved first`) }, 409);
  if (piece.custo_usd >= pieceCapUsd(c.env)) return c.json({ erro: t(c, 'esta peça chegou ao teto de custo; escreva a manchete à mão', 'this post reached its cost cap; write the headline by hand') }, 409);
  const lead = await loadLead(c.env, tenantId, piece.pauta_id);
  const draft = JSON.parse(piece.conteudo_json) as Draft;
  let output: Awaited<ReturnType<typeof generateHooks>>;
  try {
    output = await generateHooks(c.env, lead, draft, piece.formato);
  } catch {
    return c.json({ erro: t(c, 'não deu para gerar as manchetes agora; tente de novo', "couldn't generate the headlines right now; try again") }, 502);
  }
  await c.env.DB.batch([
    stmtEvent(c.env, { tenantId, tipo: 'peca.ganchos', refTipo: 'peca', refId: pieceId, payload: { versao: piece.versao, aprovadas: output.opcoes.length, reprovadas: output.reprovadas, custoUsd: output.custoUsd, por: c.get('user').id } }),
    c.env.DB.prepare('UPDATE pecas SET custo_usd = custo_usd + ? WHERE id = ? AND tenant_id = ?').bind(output.custoUsd, pieceId, tenantId),
  ]);
  return c.json({ opcoes: output.opcoes, reprovadas: output.reprovadas, custoUsd: output.custoUsd });
})

// An own photo for a card (editors and above): JPEG (the phone's, already shrunk on the web), PNG or SVG, up to 2 MB, in
// the raw body. It lives under the piece (fotos/<outlet>/<piece>/…): the card only accepts a photo uploaded for it. No
// fetching images from the web.
.post('/t/:tenantId/pecas/:id/fotos', requireMember('editor'), async (c) => {
  const tenantId = c.get('tenant').id;
  const pieceId = c.req.param('id');
  const piece = await c.env.DB.prepare('SELECT status FROM pecas WHERE id = ? AND tenant_id = ?').bind(pieceId, tenantId).first<{ status: string }>();
  if (!piece) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  if (piece.status !== 'revisao') return c.json({ erro: t(c, `peça em ${piece.status}, não em revisão`, `post is ${piece.status}, not in review`) }, 409);
  const type = (c.req.header('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'image/jpeg' && type !== 'image/png' && type !== 'image/svg+xml') return c.json({ erro: t(c, 'foto: JPEG, PNG ou SVG', 'photo: JPEG, PNG or SVG') }, 415);
  if (Number(c.req.header('content-length') ?? 0) > PHOTO_MAX_BYTES) return c.json({ erro: t(c, 'foto: até 2 MB', 'photo: up to 2 MB') }, 413);
  const bytes = await readBodyUntil(c.req.raw.body, PHOTO_MAX_BYTES);
  if (!bytes) return c.json({ erro: t(c, 'foto: até 2 MB', 'photo: up to 2 MB') }, 413);
  let body: Uint8Array | string = bytes;
  if (type === 'image/png' && !isPng(bytes)) return c.json({ erro: t(c, 'arquivo não é PNG', 'file is not a PNG') }, 400);
  if (type === 'image/jpeg' && !isJpeg(bytes)) return c.json({ erro: t(c, 'arquivo não é JPEG', 'file is not a JPEG') }, 400);
  if (type === 'image/svg+xml') {
    const clean = sanitizeSvg(new TextDecoder().decode(bytes));
    if (!clean) return c.json({ erro: t(c, 'SVG inválido ou sem desenho', 'invalid SVG or no drawing') }, 400);
    body = clean;
  }
  const key = `${photosPrefix(tenantId, pieceId)}${newId()}.${({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/svg+xml': 'svg' })[type]}`;
  await c.env.MEDIA.put(key, body, { httpMetadata: { contentType: type } });
  return c.json({ chave: key, url: await signMedia(c.env, key, 3600) }, 201);
})

/**
 * Human review: stores `decisoes` and transitions in the same batch.
 * aprovar    → manual account: piece approved/scheduled and it stops there (the operator confirms at /publicada);
 *              another account: creates PublicacaoWorkflow.
 * reescrever → the next ProducaoWorkflow round with the instruction.
 * rejeitar   → piece rejected, lead discarded.
 */
.post('/t/:tenantId/pecas/:id/revisao', requireMember('editor'), async (c) => {
  const tenantId = c.get('tenant').id;
  const actor = c.get('user').id;
  const b = await readJson<{ decisao: string; agendarPara: string; contaId: string; instrucao: string; motivo: string; versao: number }>(c);
  if (!belongs(DECISIONS, b.decisao)) return c.json({ erro: `decisao: ${DECISIONS.join(' | ')}` }, 400);
  if (b.versao !== undefined && !Number.isInteger(b.versao)) return c.json({ erro: t(c, 'versao: inteiro', 'versao: integer') }, 400);
  const decision = b.decisao;
  const pieceId = c.req.param('id');
  const piece = await c.env.DB.prepare("SELECT id, pauta_id, status, versao, rodada, formato, json_extract(validacao_json, '$.ok') AS validacao_ok FROM pecas WHERE id = ? AND tenant_id = ?")
    .bind(pieceId, tenantId).first<{ id: string; pauta_id: string; status: string; versao: number; rodada: number; formato: string; validacao_ok: number | null }>();
  if (!piece) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  if (piece.status !== 'revisao') return c.json({ erro: t(c, `peça em ${piece.status}, não em revisão`, `post is ${piece.status}, not in review`) }, 409);
  // The decider sends the version they saw: if another one arrived (a rewrite finished midway), the decision does not apply to it.
  if (b.versao !== undefined && b.versao !== piece.versao) return c.json({ erro: t(c, `peça na versão ${piece.versao}, não na ${b.versao}`, `post is at version ${piece.versao}, not ${b.versao}`) }, 409);

  const record = (payload: Record<string, unknown>) =>
    c.env.DB.prepare('INSERT INTO decisoes (id, tenant_id, peca_id, versao, decisao, por, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(newId(), tenantId, pieceId, piece.versao, decision, actor, JSON.stringify(payload));
  const conflict = () => c.json({ erro: t(c, 'peça mudou de estado durante a revisão', 'post changed state during review') }, 409);

  if (decision === 'rejeitar') {
    const reason = b.motivo?.slice(0, 500) ?? null;
    const ts: Transition[] = [{ tipo: 'peca', id: pieceId, tenantId, para: 'rejeitada', por: actor, motivo: reason, dados: { decisao: decision, versao: piece.versao }, batch: [record({ motivo: reason })] }];
    const lead = await c.env.DB.prepare('SELECT status FROM pautas WHERE id = ? AND tenant_id = ?').bind(piece.pauta_id, tenantId).first<{ status: string }>();
    // Rejecting the Reels does not discard the lead: it carries on with the source carousel.
    if (lead?.status === 'em_producao' && piece.formato !== 'reels') ts.push({ tipo: 'pauta', id: piece.pauta_id, tenantId, para: 'descartada', por: actor, motivo: reason });
    const { mudou: changed } = await transition(c.env, ts);
    return changed ? c.json({ status: 'rejeitada' }) : conflict();
  }

  if (decision === 'reescrever') {
    if (piece.formato === 'reels') return c.json({ erro: t(c, 'o Reels não se reescreve: corrija o carrossel e faça outro Reels', "a Reel can't be rewritten: fix the carousel and make another Reel") }, 409);
    if (piece.rodada >= MAX_ROUNDS) return c.json({ erro: t(c, `limite de ${MAX_ROUNDS} rodadas; aprove ou rejeite`, `limit of ${MAX_ROUNDS} rounds; approve or reject`) }, 409);
    const round = piece.rodada + 1;
    const executionId = productionId(pieceId, round);
    const instruction = b.instrucao?.trim().slice(0, 1000) || undefined;
    const params = { tenantId, pautaId: piece.pauta_id, pecaId: pieceId, formato: piece.formato as ProductionParams['formato'], rodada: round, ...(instruction ? { instrucao: instruction } : {}) };
    const { mudou: changed } = await transition(c.env, {
      tipo: 'peca', id: pieceId, tenantId, para: 'rascunho', por: actor, dados: { decisao: decision, versao: piece.versao, rodada: round, instrucao: instruction ?? null },
      batch: [
        record({ instrucao: instruction ?? null }),
        c.env.DB.prepare('UPDATE pecas SET rodada = ?, workflow_id = ? WHERE id = ? AND tenant_id = ?').bind(round, executionId, pieceId, tenantId),
        startExecution(c.env, { id: executionId, tenantId, tipo: 'producao', refTipo: 'peca', refId: pieceId, params }),
      ],
    });
    if (!changed) return conflict();
    const error = await startProduction(c.env, params);
    if (error) return c.json({ status: 'rascunho', rodada: round, workflowId: executionId, pendente: true, aviso: PENDING }, 202);
    return c.json({ status: 'rascunho', rodada: round, workflowId: executionId }, 202);
  }

// aprovar
  const r = await approvePiece(c.env, { tenantId, por: actor, peca: piece, contaId: b.contaId, agendarPara: b.agendarPara });
  if (!r.ok) {
    if (r.erro === 'conferencia') return c.json({ erro: t(c, 'a conferência apontou problema num card; corrija antes de aprovar', 'the check found a problem in a card; fix it before approving') }, 409);
    if (r.erro === 'data') return c.json({ erro: t(c, 'agendarPara: data ISO inválida', 'agendarPara: invalid ISO date') }, 400);
    if (r.erro === 'reels_intermediario') return c.json({ erro: t(c, 'o Reels ainda não sai pelo intermediário: escolha a conta manual ou a conexão direta', "Reels can't go out through the posting service yet: choose the manual account or the direct connection") }, 400);
    return conflict();
  }
  if (r.modo === 'manual') return c.json({ status: r.status, modo: 'manual' });
  if (r.pendente) return c.json({ status: r.status, modo: r.modo, workflowId: r.workflowId, pendente: true, aviso: PENDING }, 202);
  return c.json({ status: r.status, modo: r.modo, workflowId: r.workflowId }, 202);
})

// Manual account: the operator published from the phone and confirms with the post's URL (or id). No Workflow.
.post('/t/:tenantId/pecas/:id/publicada', requireMember('editor'), async (c) => {
  const tenantId = c.get('tenant').id;
  const actor = c.get('user').id;
  const b = await readJson<{ url: string; externalId: string }>(c);
  if (b.url && !/^https?:\/\//.test(b.url)) return c.json({ erro: t(c, 'url deve ser http(s)', 'url must be http(s)') }, 400);
  const pieceId = c.req.param('id');
  const piece = await c.env.DB.prepare('SELECT status, pauta_id, conta_id FROM pecas WHERE id = ? AND tenant_id = ?')
    .bind(pieceId, tenantId).first<{ status: string; pauta_id: string; conta_id: string | null }>();
  if (!piece) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  if (piece.status !== 'aprovada' && piece.status !== 'agendada') return c.json({ erro: t(c, `peça em ${piece.status}; só aprovada/agendada aceita confirmação`, `post is ${piece.status}; only approved or scheduled posts accept confirmation`) }, 409);
  const account = piece.conta_id
    ? await c.env.DB.prepare('SELECT id, rede, modo FROM contas_sociais WHERE id = ? AND tenant_id = ?').bind(piece.conta_id, tenantId).first<{ id: string; rede: string; modo: string }>()
    : null;
  if (account?.modo !== 'manual') return c.json({ erro: t(c, 'peça aprovada em conta automática; a publicação é do Workflow', 'post approved on an automatic account; the Workflow does the posting') }, 409);

  const publicationId = newId();
  const externalId = b.externalId ?? b.url ?? null;
  const ts: Transition[] = [{
    tipo: 'peca', id: pieceId, tenantId, para: 'publicada', por: actor, dados: { publicacaoId: publicationId, url: b.url ?? null, externalId, modo: 'manual' },
    batch: [c.env.DB.prepare(`INSERT INTO publicacoes (id, tenant_id, peca_id, conta_id, rede, modo, external_id, url, publicado_em, status)
                              VALUES (?, ?, ?, ?, ?, 'manual', ?, ?, datetime('now'), 'publicada')`)
      .bind(publicationId, tenantId, pieceId, account.id, account.rede, externalId, b.url ?? null)],
  }];
  const lead = await c.env.DB.prepare('SELECT status FROM pautas WHERE id = ? AND tenant_id = ?').bind(piece.pauta_id, tenantId).first<{ status: string }>();
  if (lead?.status === 'em_producao') ts.push({ tipo: 'pauta', id: piece.pauta_id, tenantId, para: 'concluida', por: actor });
  const { mudou: changed } = await transition(c.env, ts);
  if (!changed) return c.json({ erro: t(c, 'peça já publicada', 'post already published') }, 409);
  await requestCertificate(c.env, tenantId, pieceId);
  return c.json({ status: 'publicada', publicacaoId: publicationId });
})

// Certificate for a published post. Generating it here is for a piece that did not get one at publication: the document says the timestamp came later.
.get('/t/:tenantId/pecas/:id/certidao', requireMember('editor'), async (c) => {
  const p = await packageCertificate(c.env, c.get('tenant').id, c.req.param('id'));
  if (!p) return c.json({ erro: t(c, 'esta peça ainda não tem certidão', "this post doesn't have a certificate yet") }, 404);
  return new Response(p.zip, { headers: { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${p.nome}"`, 'cache-control': 'no-store' } });
})
.post('/t/:tenantId/pecas/:id/certidao', requireMember('editor'), async (c) => {
  try {
    const r = await issueCertificate(c.env, c.get('tenant').id, c.req.param('id'), false);
    if (!r) return c.json({ erro: t(c, 'só post publicado tem certidão', 'only a published post has a certificate') }, 404);
    return c.json({ id: r.id, carimboEm: r.carimbo_em, naPublicacao: !!r.na_publicacao });
  } catch (e) {
    if (e instanceof TimestampError) return c.json({ erro: t(c, 'a autoridade de carimbo não respondeu; tente de novo mais tarde', "the timestamp authority didn't answer; try again later") }, 503);
    throw e;
  }
})

// "If the account goes down" kit: the open case, with the days counted on screen, and the month's certificates.
.get('/t/:tenantId/kit', async (c) => {
  const tenantId = c.get('tenant').id;
  const [cases, certificates] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT id, tipo, aberto_em, prazo_em, nota FROM kit_casos WHERE tenant_id = ? ORDER BY aberto_em DESC, id').bind(tenantId),
    c.env.DB.prepare(`SELECT ce.peca_id, ce.carimbo_em, ce.erro, ce.na_publicacao, json_extract(pc.conteudo_json, '$.manchete') AS manchete
                        FROM certidoes ce JOIN pecas pc ON pc.id = ce.peca_id AND pc.tenant_id = ce.tenant_id
                       WHERE ce.tenant_id = ? AND ce.created_at >= strftime('%Y-%m-01', 'now') ORDER BY ce.created_at DESC`).bind(tenantId),
  ]);
  const tenant = await c.env.DB.prepare('SELECT slug, pagina_publica_em FROM tenants WHERE id = ?').bind(tenantId).first<{ slug: string; pagina_publica_em: string | null }>();
  return c.json({
    paginaPublica: { ligada: !!tenant?.pagina_publica_em, url: `${c.env.PUBLIC_BASE_URL.replace(/\/$/, '')}/v/${tenant?.slug ?? ''}` },
    casos: cases.results as { id: string; tipo: string; aberto_em: string; prazo_em: string | null; nota: string | null }[],
    certidoes: certificates.results as { peca_id: string; carimbo_em: string | null; erro: string | null; na_publicacao: number; manchete: string | null }[],
  });
})
// Download the month: streamed, because a month can exceed the Worker's memory.
.get('/t/:tenantId/kit/mes', requireMember('editor'), async (c) => {
  const month = c.req.query('mes') ?? new Date().toISOString().slice(0, 7);
  if (!validMonth(month)) return c.json({ erro: t(c, 'mes: AAAA-MM', 'mes: YYYY-MM') }, 400);
  const { corpo: body, pronto: ready } = await zipMonth(c.env, c.get('tenant').id, month);
  c.executionCtx.waitUntil(ready);
  return new Response(body, { headers: { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="arquivo-${month}.zip"`, 'cache-control': 'no-store' } });
})
.patch('/t/:tenantId/pagina-publica', requireMember('admin'), async (c) => {
  const b = await readJson<{ ligada: unknown }>(c);
  if (typeof b.ligada !== 'boolean') return c.json({ erro: 'ligada: true | false' }, 400);
  await c.env.DB.prepare("UPDATE tenants SET pagina_publica_em = CASE WHEN ? THEN datetime('now') END WHERE id = ?").bind(b.ligada ? 1 : 0, c.get('tenant').id).run();
  return c.json({ ligada: b.ligada });
})

// X-ray of old posts: one per outlet. The browser reads the zip and uploads only each post's thumbnail and caption.
.get('/t/:tenantId/raiox', requireMember('editor'), async (c) => {
  const tenantId = c.get('tenant').id;
  const batch = await c.env.DB.prepare(`SELECT l.id, l.total, l.created_at,
      (SELECT COUNT(*) FROM raiox_itens i WHERE i.lote_id = l.id AND i.tenant_id = l.tenant_id AND i.estado = 'marcado') AS marcados,
      (SELECT COUNT(*) FROM raiox_itens i WHERE i.lote_id = l.id AND i.tenant_id = l.tenant_id AND i.estado = 'ilegivel') AS ilegiveis,
      (SELECT COUNT(*) FROM raiox_itens i WHERE i.lote_id = l.id AND i.tenant_id = l.tenant_id AND i.estado = 'pendente') AS pendentes
    FROM raiox_lotes l WHERE l.tenant_id = ? ORDER BY l.created_at DESC LIMIT 1`).bind(tenantId).first<{ id: string; total: number; created_at: string; marcados: number; ilegiveis: number; pendentes: number }>();
  if (!batch) return c.json({ lote: null, itens: [], proxima: null });
  const page = Math.max(0, Number(c.req.query('pagina') ?? 0) || 0);
  const { results } = await c.env.DB.prepare(`SELECT id, data, legenda, r2_miniatura, estado, motivos_json FROM raiox_itens
      WHERE tenant_id = ? AND lote_id = ? AND estado IN ('marcado', 'ilegivel') ORDER BY data DESC, id LIMIT ? OFFSET ?`)
    .bind(tenantId, batch.id, ITEMS_PER_PAGE + 1, page * ITEMS_PER_PAGE).all<{ id: string; data: string | null; legenda: string | null; r2_miniatura: string; estado: string; motivos_json: string | null }>();
  const items = await Promise.all(results.slice(0, ITEMS_PER_PAGE).map(async ({ r2_miniatura: r2_thumbnail, motivos_json: reasons_json, ...i }) => ({ ...i, miniatura: await signMedia(c.env, r2_thumbnail, 3600), motivos: JSON.parse(reasons_json ?? '[]') as string[] })));
  return c.json({ lote: batch, itens: items, proxima: results.length > ITEMS_PER_PAGE ? page + 1 : null });
})
.post('/t/:tenantId/raiox', requireMember('editor'), async (c) => {
  const tenantId = c.get('tenant').id;
  const exists = await c.env.DB.prepare('SELECT id FROM raiox_lotes WHERE tenant_id = ? LIMIT 1').bind(tenantId).first();
  if (exists) return c.json({ erro: t(c, 'apague o raio-X anterior antes de fazer outro', 'delete the previous review before making another') }, 409);
  const id = newId();
  await c.env.DB.prepare('INSERT INTO raiox_lotes (id, tenant_id, por) VALUES (?, ?, ?)').bind(id, tenantId, c.get('user').id).run();
  return c.json({ id }, 201);
})
.post('/t/:tenantId/raiox/:lote/itens', requireMember('editor'), async (c) => {
  const tenantId = c.get('tenant').id;
  const batchId = c.req.param('lote');
  if (Number(c.req.header('content-length') ?? 0) > THUMBNAIL_MAX_BYTES + 8192) return c.json({ erro: t(c, 'miniatura grande demais', 'thumbnail too large') }, 413);
  const form = await c.req.parseBody().catch(() => null);
  const file = form?.arquivo;
  if (!(file instanceof File) || file.size > THUMBNAIL_MAX_BYTES) return c.json({ erro: t(c, 'arquivo: JPEG de até 256 KB', 'arquivo: JPEG up to 256 KB') }, 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isJpeg(bytes)) return c.json({ erro: t(c, 'arquivo: JPEG de até 256 KB', 'arquivo: JPEG up to 256 KB') }, 400);
  const data = typeof form?.data === 'string' && Number.isFinite(Date.parse(form.data)) ? new Date(form.data).toISOString() : null;
  const caption = typeof form?.legenda === 'string' ? form.legenda.slice(0, CAPTION_MAX) : '';
  // The cap applies to the batch's count, in a single UPDATE. Another outlet's batch does not exist here.
  const batch = await c.env.DB.prepare('UPDATE raiox_lotes SET total = total + 1 WHERE id = ? AND tenant_id = ? AND total < ? RETURNING total').bind(batchId, tenantId, MAX_ITEMS_BATCH).first<{ total: number }>();
  if (!batch) {
    const exists = await c.env.DB.prepare('SELECT id FROM raiox_lotes WHERE id = ? AND tenant_id = ?').bind(batchId, tenantId).first();
    return exists ? c.json({ erro: t(c, `até ${MAX_ITEMS_BATCH} posts por raio-X`, `up to ${MAX_ITEMS_BATCH} posts per review`) }, 409) : c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  }
  const id = newId();
  const key = `raiox/${tenantId}/${batchId}/${id}.jpg`;
  await c.env.MEDIA.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' } });
  await c.env.DB.prepare('INSERT INTO raiox_itens (id, tenant_id, lote_id, data, legenda, r2_miniatura) VALUES (?, ?, ?, ?, ?, ?)').bind(id, tenantId, batchId, data, caption, key).run();
  await c.env.MONITOR_QUEUE.send({ tipo: 'raiox', tenantId, itemId: id });
  return c.json({ id }, 201);
})
.delete('/t/:tenantId/raiox/:lote', requireMember('editor'), async (c) => {
  if (!(await deleteRayX(c.env, c.get('tenant').id, c.req.param('lote')))) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  return c.json({ ok: true });
})
.post('/t/:tenantId/kit/casos', requireMember('editor'), async (c) => {
  const b = await readJson<{ tipo: unknown; abertoEm: unknown; prazoEm: unknown; nota: unknown }>(c);
  const data = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v));
  if (!belongs(CASE_TYPES, b.tipo)) return c.json({ erro: t(c, 'tipo do caso inválido', 'invalid case type') }, 400);
  if (!data(b.abertoEm)) return c.json({ erro: t(c, 'abertoEm: data AAAA-MM-DD', 'abertoEm: date YYYY-MM-DD') }, 400);
  if (b.prazoEm !== null && b.prazoEm !== undefined && !data(b.prazoEm)) return c.json({ erro: t(c, 'prazoEm: data AAAA-MM-DD', 'prazoEm: date YYYY-MM-DD') }, 400);
  if (b.nota !== null && b.nota !== undefined && (typeof b.nota !== 'string' || b.nota.length > NOTE_CASE_MAX)) return c.json({ erro: t(c, `nota: até ${NOTE_CASE_MAX} caracteres`, `note: up to ${NOTE_CASE_MAX} characters`) }, 400);
  const id = newId();
  await c.env.DB.prepare('INSERT INTO kit_casos (id, tenant_id, tipo, aberto_em, prazo_em, nota, por) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, c.get('tenant').id, b.tipo, b.abertoEm, b.prazoEm ?? null, (b.nota as string | null | undefined) ?? null, c.get('user').id).run();
  return c.json({ id }, 201);
})
.delete('/t/:tenantId/kit/casos/:id', requireMember('editor'), async (c) => {
  const r = await c.env.DB.prepare('DELETE FROM kit_casos WHERE id = ? AND tenant_id = ?').bind(c.req.param('id'), c.get('tenant').id).run();
  if (!r.meta.changes) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  return c.json({ ok: true });
})

// Posted: what went out, most recent first, 20 per page. `?antes=` is the previous page's `proximo`. Signed cover (1 h).
.get('/t/:tenantId/publicacoes', validator('query', (q) => ({ antes: typeof q.antes === 'string' ? q.antes : undefined })), async (c) => {
  const tenantId = c.get('tenant').id;
  const q = c.req.query('antes');
  const before = cursorPublications(q);
  if (q && !before) return c.json({ erro: t(c, 'antes: use o `proximo` da página anterior', 'antes: use `proximo` from the previous page') }, 400);
  const PER_PAGE = 20;
  const { results } = await c.env.DB.prepare(
    `SELECT pu.id, pu.peca_id, pu.url, pu.modo, pu.publicado_em, pu.created_at, pc.formato, pa.titulo, pa.tipo_post,
            co.nome AS conta_nome, co.external_id AS conta_external_id,
            json_extract(pc.conteudo_json, '$.manchete') AS manchete,
            json_array_length(pc.arte_r2_keys_json) AS ncards,
            json_extract(pc.arte_r2_keys_json, '$[0].jpg') AS capa_r2,
            EXISTS (SELECT 1 FROM decisoes d WHERE d.tenant_id = pu.tenant_id AND d.peca_id = pu.peca_id AND d.decisao = 'aprovar' AND d.por = 'piloto') AS piloto,
            ce.sha256 AS certidao, ce.erro AS certidao_erro
       FROM publicacoes pu
       JOIN pecas pc ON pc.id = pu.peca_id AND pc.tenant_id = pu.tenant_id
       JOIN pautas pa ON pa.id = pc.pauta_id AND pa.tenant_id = pc.tenant_id
       LEFT JOIN contas_sociais co ON co.id = pu.conta_id AND co.tenant_id = pu.tenant_id
       LEFT JOIN certidoes ce ON ce.peca_id = pu.peca_id AND ce.tenant_id = pu.tenant_id AND ce.versao = pc.versao
      WHERE pu.tenant_id = ? AND pu.status = 'publicada'
        ${before ? 'AND (pu.created_at < ? OR (pu.created_at = ? AND pu.id < ?))' : ''}
      ORDER BY pu.created_at DESC, pu.id DESC
      LIMIT ${PER_PAGE + 1}`,
  ).bind(tenantId, ...(before ? [before.em, before.em, before.id] : [])).all<{
    id: string; peca_id: string; url: string | null; modo: string; publicado_em: string | null; created_at: string; formato: string;
    titulo: string; tipo_post: string | null; conta_nome: string | null; conta_external_id: string | null; manchete: string | null; ncards: number | null; capa_r2: string | null; piloto: number; certidao: string | null; certidao_erro: string | null;
  }>();
  const page = results.slice(0, PER_PAGE);
  const last = page.at(-1);
  const publications = await Promise.all(page.map(async ({ capa_r2: cover_r2, created_at: _c, ...p }) => ({
    ...p, capa: cover_r2 ? await signMedia(c.env, cover_r2, 3600) : null,
  })));
  return c.json({ publicacoes: publications, proximo: results.length > PER_PAGE && last ? `${last.created_at}|${last.id}` : null });
})

// Active accounts to choose from at approval (`?todas=1` also brings disabled ones, for the outlet screen). With the
// provider's name (intermediary); without the token or the provider reference.
.get('/t/:tenantId/contas', queryAll, async (c) => {
  const all = c.req.query('todas') === '1';
  const { results } = await c.env.DB.prepare(
    `SELECT id, rede, modo, nome, external_id, status, provedor FROM contas_sociais WHERE tenant_id = ? AND (status = 'ativa' OR ?)
      ORDER BY status = 'ativa' DESC, CASE modo WHEN 'real' THEN 0 WHEN 'intermediario' THEN 1 WHEN 'manual' THEN 2 ELSE 3 END, created_at`,
  ).bind(c.get('tenant').id, all ? 1 : 0).all<{ id: string; rede: string; modo: string; nome: string | null; external_id: string | null; status: string; provedor: string | null }>();
  return c.json({ contas: results });
})

// Disable or re-enable an account (admins only). Disabled = status 'removida': it leaves the approval choice and the
// publisher refuses ("account no longer active"); a piece already approved for it stays valid until someone swaps the account.
.patch('/t/:tenantId/contas/:id', requireMember('admin'), async (c) => {
  const tenantId = c.get('tenant').id;
  const b = await readJson<{ ativo?: boolean; propria?: boolean }>(c);
  // "This is the outlet's site": it applies to what comes out from now on. An author outlet already reads everything of its own.
  if (typeof b.propria === 'boolean') {
    const mode = await c.env.DB.prepare('SELECT modo FROM tenants WHERE id = ?').bind(tenantId).first<{ modo: string }>();
    if (mode?.modo === 'autoral') return c.json({ erro: t(c, 'veículo autoral não tem site próprio como fonte', "an author outlet doesn't mark its own site as a source") }, 400);
    const row = await c.env.DB.prepare("UPDATE fontes SET propria_desde = ? WHERE id = ? AND tenant_id = ? AND tipo != 'manual' RETURNING id, propria_desde")
      .bind(b.propria ? new Date().toISOString() : null, c.req.param('id'), tenantId).first<{ id: string; propria_desde: string | null }>();
    if (!row) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
    return c.json({ id: row.id, propria: !!row.propria_desde });
  }
  if (typeof b.ativo !== 'boolean') return c.json({ erro: 'ativo: true | false' }, 400);
  const status = b.ativo ? 'ativa' : 'removida';
  const row = await c.env.DB.prepare('UPDATE contas_sociais SET status = ? WHERE id = ? AND tenant_id = ? RETURNING id, status')
    .bind(status, c.req.param('id'), tenantId).first<{ id: string; status: string }>();
  if (!row) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  return c.json(row);
})

// Social network account (tenant admins only). The token comes in plaintext in the body (HTTPS) and is encrypted before touching D1.
.post('/t/:tenantId/contas', requireMember('admin'), async (c) => {
  const tenantId = c.get('tenant').id;
  const b = await readJson<{ rede: string; externalId: string; nome: string; token: string; tokenExpiraEm: string; modo: string; provedor: string; provedorRef: string }>(c);
  const mode = b.modo ?? 'manual';   // default: no Meta app; the operator publishes from the phone
  if (!belongs(MODES_ACCOUNT, mode)) return c.json({ erro: `modo: ${MODES_ACCOUNT.join(' | ')}` }, 400);
  if ((b.rede ?? 'instagram') !== 'instagram') return c.json({ erro: t(c, 'só instagram por enquanto', 'only instagram for now') }, 400);
  if (b.token !== undefined && (typeof b.token !== 'string' || !b.token.trim() || b.token.length > 4000)) return c.json({ erro: t(c, 'token: texto até 4000 caracteres', 'token: text up to 4000 characters') }, 400);
  if (mode === 'real' && (!b.token || !b.externalId)) return c.json({ erro: t(c, 'conta real exige token e externalId (id da conta profissional do IG)', 'a real account requires token and externalId (the IG professional account id)') }, 400);
  if (mode === 'real' && !/^\d{5,30}$/.test(String(b.externalId))) return c.json({ erro: t(c, 'externalId: só números (id da conta profissional do IG)', 'externalId: digits only (the IG professional account id)') }, 400);
  if (mode === 'intermediario' && !b.provedor) return c.json({ erro: t(c, 'conta intermediária exige provedor (ayrshare, postpeer, zernio...)', 'a posting service account requires provedor (ayrshare, postpeer, zernio...)') }, 400);
  // Only Ayrshare has an adapter; PostPeer and Zernio come later (decision in HANDOFF.md).
  if (mode === 'intermediario' && !ACTIVE_PROVIDERS.includes(b.provedor!)) return c.json({ erro: t(c, `provedor: ${ACTIVE_PROVIDERS.join(' | ')} (os outros ainda não)`, `provedor: ${ACTIVE_PROVIDERS.join(' | ')} (the others not yet)`) }, 400);
  if (mode === 'intermediario' && !b.token) return c.json({ erro: t(c, 'conta intermediária exige a chave da API do provedor (token)', "a posting service account requires the provider's API key (token)") }, 400);
  if (b.provedorRef !== undefined && (typeof b.provedorRef !== 'string' || b.provedorRef.length > 200)) return c.json({ erro: t(c, 'provedorRef: até 200 caracteres', 'provedorRef: up to 200 characters') }, 400);
  const id = newId();
  await c.env.DB.prepare('INSERT INTO contas_sociais (id, tenant_id, rede, external_id, nome, token_enc, token_expira_em, modo, provedor, provedor_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, tenantId, 'instagram', b.externalId ?? null, b.nome ?? null, b.token ? await encryptToken(c.env, b.token.trim()) : null, b.tokenExpiraEm ?? null, mode,
      mode === 'intermediario' ? b.provedor! : null, mode === 'intermediario' ? b.provedorRef?.trim() || null : null).run();
  return c.json({ id, modo: mode }, 201);
})

// The brand as the UI sees it (any member): name, @, colours and the logo signed for 1 h. For the Brand tab of the outlet screen.
.get('/t/:tenantId/marca', async (c) => {
  const tenantId = c.get('tenant').id;
  const row = await c.env.DB.prepare('SELECT marca_json, idioma FROM tenants WHERE id = ?').bind(tenantId).first<{ marca_json: string; idioma: string | null }>();
  const { logoR2, arteRefR2: artRefR2 } = JSON.parse(row?.marca_json || '{}') as { logoR2?: string; arteRefR2?: string };
  return c.json({ marca: {
    ...publicBrand(row?.marca_json),
    logo: logoR2 ? await signMedia(c.env, logoR2, 3600) : null,
    referencia: artRefR2 ? await signMedia(c.env, artRefR2, 3600) : null,
  }, idioma: fromOutletLanguage(row?.idioma) });
})

// The outlet's templates: every member sees them; only admins create, edit and archive.
.get('/t/:tenantId/estilos', async (c) => c.json({ estilos: await listStyles(c.env, c.get('tenant').id) }))
.post('/t/:tenantId/estilos', requireMember('admin'), async (c) => {
  const v = validateStyle(await readJson<unknown>(c), language(c));
  if ('erro' in v) return c.json({ erro: v.erro }, 400);
  if (v.params.patrocinio && !(await sponsorshipOutlet(c.env, c.get('tenant').id, v.params.patrocinio))) return c.json({ erro: t(c, 'patrocinador não encontrado', 'sponsor not found') }, 404);
  const r = await createStyle(c.env, c.get('tenant').id, v, c.get('user').id, language(c));
  if ('erro' in r) return c.json({ erro: r.erro }, 409);
  return c.json(r, 201);
})
// The outlet's plan (admins only): usage, the comparison and, with billing configured, subscribing and managing.
.get('/t/:tenantId/plano', requireMember('admin'), async (c) => {
  const s = await planStatus(c.env, c.get('tenant').id);
  return c.json({
    plano: s.plano, limite: s.limite, periodo: s.periodo, usados: s.usados, bloqueado: s.bloqueado, avisoEm: USAGE_WARNING,
    assinatura: s.assinatura ? { status: s.assinatura.status, periodoFim: s.assinatura.periodo_fim, atrasoDesde: s.assinatura.atraso_desde, gerenciavel: !!s.assinatura.stripe_customer } : null,
    cobranca: billingOn(c.env), planos: PLANOS_PAGOS.map((id) => ({ id, precoReais: PLANOS[id].precoReais, limite: PLANOS[id].limite })),
    instalacaoPropria: selfHosted(c.env),
  });
})
.post('/t/:tenantId/assinatura/checkout', requireMember('admin'), async (c) => {
  const { plano: plan } = await readJson<{ plano?: unknown }>(c);
  if (!belongs(PLANOS_PAGOS, plan)) return c.json({ erro: `plano: ${PLANOS_PAGOS.join(' | ')}` }, 400);
  if (!billingOn(c.env)) return c.json({ erro: t(c, 'A cobrança ainda não está configurada.', 'Billing is not set up yet.') }, 503);
  const s = await planStatus(c.env, c.get('tenant').id);
  if (s.assinatura && s.assinatura.status !== 'canceled') return c.json({ erro: t(c, 'Este veículo já tem assinatura. Troque de plano em Gerenciar.', 'This outlet already has a subscription. Change plans in Manage.') }, 409);
  try {
    return c.json({ url: await createCheckout(c.env, c.get('tenant'), plan, s.assinatura?.stripe_customer ?? null) });
  } catch {
    return c.json({ erro: t(c, 'A Stripe não respondeu. Tente de novo.', "Stripe didn't respond. Try again.") }, 502);
  }
})
.post('/t/:tenantId/assinatura/portal', requireMember('admin'), async (c) => {
  if (!billingOn(c.env)) return c.json({ erro: t(c, 'A cobrança ainda não está configurada.', 'Billing is not set up yet.') }, 503);
  const s = await planStatus(c.env, c.get('tenant').id);
  if (!s.assinatura?.stripe_customer) return c.json({ erro: t(c, 'Este veículo não tem assinatura.', 'This outlet has no subscription.') }, 404);
  try {
    return c.json({ url: await createPortal(c.env, c.get('tenant').slug, s.assinatura.stripe_customer) });
  } catch {
    return c.json({ erro: t(c, 'A Stripe não respondeu. Tente de novo.', "Stripe didn't respond. Try again.") }, 502);
  }
})
// The outlet's AI keys (admins only; web/src/screens/outlet/AiKeys.tsx). GET gives each provider's state without the
// key; PUT checks the key with the provider before storing it (encrypted), and a rejected or unchecked key is not stored.
.get('/t/:tenantId/chaves-ia', requireMember('admin'), async (c) => c.json(await keysState(c.env, c.get('tenant').id)))
.put('/t/:tenantId/chaves-ia/:provedor', requireMember('admin'), async (c) => {
  const tenantId = c.get('tenant').id;
  const p = c.req.param('provedor');
  if (!isProvider(p)) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  const { chave: key } = await readJson<{ chave?: unknown }>(c);
  const clean = typeof key === 'string' ? key.trim() : '';
  if (clean.length < KEY_MIN || clean.length > KEY_MAX || /\s/.test(clean)) {
    return c.json({ erro: t(c, 'Confira a chave: ela parece incompleta. Copie de novo, inteira, da página do provedor.', "Check the key: it looks incomplete. Copy it again, whole, from the provider's page."), code: 'chave_invalida' }, 400);
  }
  const name = PROVIDERS[p].nome;
  const checked = await checkKey(c.env, p, clean);
  if (checked === 'recusada') {
    return c.json({ erro: t(c, `O ${name} recusou essa chave. Confira se ela foi copiada inteira e se ainda está ativa.`, `${name} refused this key. Check that it was copied whole and is still active.`), code: 'chave_recusada' }, 422);
  }
  if (checked === 'sem_resposta') {
    return c.json({ erro: t(c, `O ${name} não respondeu agora, e a chave não foi salva. Tente de novo em instantes.`, `${name} didn't respond right now, and the key wasn't saved. Try again in a moment.`), code: 'provedor_sem_resposta' }, 502);
  }
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO chaves_ia (tenant_id, provedor, chave_enc, final, salva_por) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (tenant_id, provedor) DO UPDATE SET chave_enc = excluded.chave_enc, final = excluded.final, salva_por = excluded.salva_por, salva_em = datetime('now')`)
      .bind(tenantId, p, await encryptToken(c.env, clean), clean.slice(-4), c.get('user').id),
    stmtEvent(c.env, { tenantId, tipo: 'chave_ia.salva', refTipo: 'tenant', refId: tenantId, payload: { provedor: p, por: c.get('user').id } }),
  ]);
  return c.json(await keysState(c.env, tenantId));
})
.delete('/t/:tenantId/chaves-ia/:provedor', requireMember('admin'), async (c) => {
  const tenantId = c.get('tenant').id;
  const p = c.req.param('provedor');
  if (!isProvider(p)) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM chaves_ia WHERE tenant_id = ? AND provedor = ?').bind(tenantId, p),
    stmtEvent(c.env, { tenantId, tipo: 'chave_ia.removida', refTipo: 'tenant', refId: tenantId, payload: { provedor: p, por: c.get('user').id } }),
  ]);
  return c.json(await keysState(c.env, tenantId));
})
// The text (DeepSeek, Gemini or Kie), second-opinion (Anthropic or Kie) and illustration (Kie or fal) choices.
// Only a provider with a key (the outlet's or the server's) can be chosen.
.patch('/t/:tenantId/chaves-ia', requireMember('admin'), async (c) => {
  const tenantId = c.get('tenant').id;
  const b = await readJson<{ texto?: unknown; segunda?: unknown; imagem?: unknown }>(c);
  if (b.texto !== undefined && !belongs(PROVIDERS_TEXT, b.texto)) return c.json({ erro: `texto: ${PROVIDERS_TEXT.join(' | ')}` }, 400);
  if (b.segunda !== undefined && !belongs(PROVIDERS_SECOND, b.segunda)) return c.json({ erro: `segunda: ${PROVIDERS_SECOND.join(' | ')}` }, 400);
  if (b.imagem !== undefined && !belongs(PROVIDERS_IMAGE, b.imagem)) return c.json({ erro: `imagem: ${PROVIDERS_IMAGE.join(' | ')}` }, 400);
  const required = [b.texto, b.segunda === 'kie' ? 'kie' : undefined, b.imagem].filter((x) => x !== undefined) as Provider[];
  for (const p of new Set(required)) {
    if (!(await hasKey(c.env, tenantId, p))) {
      return c.json({ erro: t(c, `Salve a chave do ${PROVIDERS[p].nome} antes de escolher.`, `Save the ${PROVIDERS[p].nome} key before choosing it.`), code: 'sem_chave' }, 409);
    }
  }
  await c.env.DB.prepare('UPDATE tenants SET provedor_texto = COALESCE(?, provedor_texto), provedor_segunda = COALESCE(?, provedor_segunda), provedor_imagem = COALESCE(?, provedor_imagem) WHERE id = ?')
    .bind(b.texto ?? null, b.segunda ?? null, b.imagem ?? null, tenantId).run();
  return c.json(await keysState(c.env, tenantId));
})
.post('/t/:tenantId/estilos/copiar', requireMember('admin'), async (c) => {
  const b = await readJson<{ origem?: unknown; estiloId?: unknown }>(c);
  const target = c.get('tenant').id;
  if (typeof b.origem !== 'string' || typeof b.estiloId !== 'string') return c.json({ erro: t(c, 'origem e estiloId são obrigatórios', 'origem and estiloId are required') }, 400);
  const member = await c.env.DB.prepare('SELECT papel FROM membros WHERE tenant_id = ? AND user_id = ?').bind(b.origem, c.get('user').id).first<{ papel: string }>();
  if (!member) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  if (member.papel !== 'admin') return c.json({ erro: t(c, 'exige papel admin nos dois veículos', 'requires the admin role in both outlets') }, 403);
  if (b.origem === target) return c.json({ erro: t(c, 'escolha outro veículo', 'choose another outlet') }, 400);
  const r = await copyStyle(c.env, b.origem, b.estiloId, target, c.get('user').id, language(c));
  if (!r) return c.json({ erro: t(c, 'modelo não encontrado', 'template not found') }, 404);
  if ('erro' in r) return c.json({ erro: r.erro }, 409);
  return c.json(r, 201);
})
.put('/t/:tenantId/estilos/:id', requireMember('admin'), async (c) => {
  const v = validateStyle(await readJson<unknown>(c), language(c));
  if ('erro' in v) return c.json({ erro: v.erro }, 400);
  if (v.params.patrocinio && !(await sponsorshipOutlet(c.env, c.get('tenant').id, v.params.patrocinio))) return c.json({ erro: t(c, 'patrocinador não encontrado', 'sponsor not found') }, 404);
  const r = await updateStyle(c.env, c.get('tenant').id, c.req.param('id'), v, language(c));
  if (!r) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  if ('erro' in r) return c.json({ erro: r.erro }, 409);
  return c.json(r);
})
// Sponsors: every member sees them; only admins register, upload the logo and archive.
.get('/t/:tenantId/patrocinios', async (c) => c.json({ patrocinios: await listSponsorships(c.env, c.get('tenant').id) }))
.post('/t/:tenantId/patrocinios', requireMember('admin'), async (c) => {
  const v = validateSponsorship(await readJson<unknown>(c), language(c));
  if ('erro' in v) return c.json({ erro: v.erro }, 400);
  const id = newId();
  await c.env.DB.prepare('INSERT INTO patrocinios (id, tenant_id, nome, inicio, fim, por) VALUES (?, ?, ?, ?, ?, ?)').bind(id, c.get('tenant').id, v.nome, v.inicio, v.fim, c.get('user').id).run();
  return c.json({ id }, 201);
})
.post('/t/:tenantId/patrocinios/:id/logo', requireMember('admin'), async (c) => {
  const tenantId = c.get('tenant').id;
  const id = c.req.param('id');
  if (!(await sponsorshipOutlet(c.env, tenantId, id))) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  const l = await readLogo(c.req.raw, language(c));
  if ('erro' in l) return c.json({ erro: l.erro }, l.status);
  const key = `patrocinios/${tenantId}/logo-${newId()}.${l.ext}`;
  await c.env.MEDIA.put(key, l.corpo, { httpMetadata: { contentType: l.tipo } });
  await c.env.DB.prepare('UPDATE patrocinios SET logo_r2 = ? WHERE id = ? AND tenant_id = ?').bind(key, id, tenantId).run();
  return c.json({ ok: true }, 201);
})
.delete('/t/:tenantId/patrocinios/:id', requireMember('admin'), async (c) => {
  const r = await c.env.DB.prepare("UPDATE patrocinios SET arquivado_em = datetime('now') WHERE id = ? AND tenant_id = ? AND arquivado_em IS NULL").bind(c.req.param('id'), c.get('tenant').id).run();
  if (!r.meta.changes) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  return c.json({ ok: true });
})
.delete('/t/:tenantId/estilos/:id', requireMember('admin'), async (c) => {
  if (!(await archiveStyle(c.env, c.get('tenant').id, c.req.param('id')))) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  return c.json({ ok: true });
})

// Brand (admins only): name, @, 3 colours, illustration style, CTA texts and watermark, by merge-patch on marca_json.
// CTAs arrive with only their texts; the rest of each one (highlights, phone) stays as is.
.patch('/t/:tenantId/marca', requireMember('admin'), async (c) => {
  const tenantId = c.get('tenant').id;
  const body = await readJson<Record<string, unknown>>(c);
  // Post language: a column of the outlet, not of the brand. It applies to what is produced from now on.
  const { idioma: newLanguage, ...rest } = body;
  if (newLanguage !== undefined && !isLanguageContent(newLanguage)) return c.json({ erro: t(c, 'idioma: pt-BR ou en', 'idioma: pt-BR or en') }, 400);
  const v = validateBrand(rest, language(c));
  if ('erro' in v) return c.json({ erro: v.erro }, 400);
  if (newLanguage !== undefined) await c.env.DB.prepare('UPDATE tenants SET idioma = ? WHERE id = ?').bind(newLanguage, tenantId).run();
  if (v.ctas) {
    const current = await c.env.DB.prepare("SELECT json_extract(marca_json, '$.ctas') AS ctas FROM tenants WHERE id = ?").bind(tenantId).first<{ ctas: string | null }>();
    const ctas = mergeCtas(current?.ctas ? JSON.parse(current.ctas) : [], v.ctas, language(c));
    if ('erro' in ctas) return c.json({ erro: ctas.erro }, 400);
    (v.patch as Record<string, unknown>).ctas = ctas;   // array: json_patch troca inteiro
  }
  const row = await c.env.DB.prepare('UPDATE tenants SET marca_json = json_patch(marca_json, ?) WHERE id = ? RETURNING marca_json, idioma')
    .bind(JSON.stringify(v.patch), tenantId).first<{ marca_json: string; idioma: string | null }>();
  return c.json({ marca: publicBrand(row?.marca_json), ...(newLanguage !== undefined ? { idioma: fromOutletLanguage(row?.idioma) } : {}) });
})

// Paste the site into a new outlet: returns the suggestion, and nothing is saved here. The person checks and saves through the usual routes.
.post('/t/:tenantId/marca/puxar', requireMember('admin'), async (c) => {
  const tenantId = c.get('tenant').id;
  const url = addressSite((await readJson<{ url?: unknown }>(c)).url);
  if (!url) return c.json({ erro: t(c, 'Cole o endereço público do site, como gazeta.com.br.', 'Paste the public address of the site, like gazette.com.') }, 400);
  const done = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM eventos WHERE tenant_id = ? AND tipo = 'marca.puxada' AND created_at > datetime('now', '-1 day')").bind(tenantId).first<{ n: number }>();
  if ((done?.n ?? 0) >= MAX_IMPORTS_DAY) return c.json({ erro: t(c, 'Este veículo já leu sites demais hoje. Preencha à mão ou tente amanhã.', 'This outlet read too many sites today. Fill it in by hand or try tomorrow.') }, 429);
  await recordEvent(c.env, tenantId, 'marca.puxada', 'tenant', tenantId, { url });
  try {
    return c.json(await importBrand(c.env, url));
  } catch {
    return c.json({ erro: t(c, 'Não deu para ler esse site agora. Preencha à mão ou tente de novo.', "Couldn't read that site right now. Fill it in by hand or try again.") }, 502);
  }
})
// Logo (admins only): PNG or SVG up to 512 KB in the raw body. SVG goes through the allowlist (sanitizarSvg) before R2.
.post('/t/:tenantId/marca/logo', requireMember('admin'), async (c) => {
  const tenantId = c.get('tenant').id;
  const l = await readLogo(c.req.raw, language(c));
  if ('erro' in l) return c.json({ erro: l.erro }, l.status);
  // A new key on every upload, and the old one stays: a production in progress stored the brand's key in the
  // "load lead" step and the render reads that file later (deleting it would make the piece fail on every attempt).
  const key = `marcas/${tenantId}/logo-${newId()}.${l.ext}`;
  await c.env.MEDIA.put(key, l.corpo, { httpMetadata: { contentType: l.tipo } });
  const row = await c.env.DB.prepare('UPDATE tenants SET marca_json = json_patch(marca_json, ?) WHERE id = ? RETURNING marca_json')
    .bind(JSON.stringify({ logoR2: key }), tenantId).first<{ marca_json: string }>();
  return c.json({ marca: publicBrand(row?.marca_json) }, 201);
})

// The illustration reference image (admins only): PNG or JPEG up to 2 MB in the raw body. A new key on every upload (a
// production in progress stored the old one). Kie uses it as a reference for technique and palette.
.post('/t/:tenantId/marca/referencia', requireMember('admin'), async (c) => {
  const tenantId = c.get('tenant').id;
  const type = (c.req.header('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'image/png' && type !== 'image/jpeg') return c.json({ erro: t(c, 'referência: PNG ou JPEG', 'reference: PNG or JPEG') }, 415);
  if (Number(c.req.header('content-length') ?? 0) > REFERENCE_MAX_BYTES) return c.json({ erro: t(c, 'referência: até 2 MB', 'reference: up to 2 MB') }, 413);
  const bytes = await readBodyUntil(c.req.raw.body, REFERENCE_MAX_BYTES);
  if (!bytes) return c.json({ erro: t(c, 'referência: até 2 MB', 'reference: up to 2 MB') }, 413);
  if (type === 'image/png' ? !isPng(bytes) : !isJpeg(bytes)) return c.json({ erro: t(c, `arquivo não é ${type === 'image/png' ? 'PNG' : 'JPEG'}`, `file is not a ${type === 'image/png' ? 'PNG' : 'JPEG'}`) }, 400);
  const key = `marcas/${tenantId}/referencia-${newId()}.${type === 'image/png' ? 'png' : 'jpg'}`;
  await c.env.MEDIA.put(key, bytes, { httpMetadata: { contentType: type } });
  const row = await c.env.DB.prepare('UPDATE tenants SET marca_json = json_patch(marca_json, ?) WHERE id = ? RETURNING marca_json')
    .bind(JSON.stringify({ arteRefR2: key }), tenantId).first<{ marca_json: string }>();
  return c.json({ marca: publicBrand(row?.marca_json) }, 201);
})

// Accept a team invite (whoever received the link, after creating the account or signing in with the invited email).
// 403 if the account has another email; idempotent.
.post('/convites/:id/aceitar', async (c) => {
  const u = c.get('user');
  const r = await acceptInvite(c.env.DB, c.req.param('id'), u.id, u.email);
  if (!r.ok) return c.json({ erro: r.motivo === 'outro_email' ? t(c, 'o convite é para outro e-mail', 'the invite is for another email') : t(c, 'não encontrado', 'not found') }, r.motivo === 'outro_email' ? 403 : 404);
  return c.json({ slug: r.slug, papel: r.papel, jaEra: r.jaEra });
})

// Team: the outlet's members (any member sees them) and, for admins, the pending invites with the link to send by hand.
.get('/t/:tenantId/membros', async (c) => {
  const tenantId = c.get('tenant').id;
  const admin = c.get('tenant').papel === 'admin';
  const [members, invites] = await c.env.DB.batch<Record<string, unknown>>([
    c.env.DB.prepare(
      `SELECT m.id, m.papel, m.created_at, u.name AS nome, u.email FROM membros m JOIN "user" u ON u.id = m.user_id
        WHERE m.tenant_id = ? ORDER BY CASE m.papel WHEN 'admin' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, u.name`,
    ).bind(tenantId),
    c.env.DB.prepare(admin
      ? 'SELECT id, email, papel, created_at FROM convites WHERE tenant_id = ? AND aceito_em IS NULL ORDER BY created_at DESC'
      : 'SELECT id, email, papel, created_at FROM convites WHERE 0 AND tenant_id = ?').bind(tenantId),
  ]);
  return c.json({
    membros: members.results as { id: string; papel: string; created_at: string; nome: string; email: string }[],
    convites: (invites.results as { id: string; email: string; papel: string; created_at: string }[]).map((cv) => ({ ...cv, link: inviteLink(cv.id) })),
  });
})

// Invite by email (admins only). Whoever already has an account becomes a member right away; whoever does not stays in
// `convites` until creating the account (Better Auth hook). Inviting the same email again only updates the pending invite's role.
.post('/t/:tenantId/convites', requireMember('admin'), async (c) => {
  const tenantId = c.get('tenant').id;
  const b = await readJson<{ email: string; papel: string }>(c);
  const email = validEmail(b.email);
  if (!email) return c.json({ erro: t(c, 'email inválido', 'invalid email') }, 400);
  const role = inviteRole(b.papel);
  if (!role) return c.json({ erro: 'papel: editor | reporter' }, 400);
  const user = await c.env.DB.prepare('SELECT id, name FROM "user" WHERE lower(email) = ?').bind(email).first<{ id: string; name: string }>();
  if (user) {
    const already = await c.env.DB.prepare('SELECT papel FROM membros WHERE tenant_id = ? AND user_id = ?').bind(tenantId, user.id).first<{ papel: string }>();
    if (already) return c.json({ erro: t(c, `já é ${already.papel} deste veículo`, `already a member of this publication as ${already.papel}`) }, 409);
    const id = newId();
    await c.env.DB.prepare('INSERT INTO membros (id, tenant_id, user_id, papel) VALUES (?, ?, ?, ?)').bind(id, tenantId, user.id, role).run();
    return c.json({ membro: { id, papel: role, nome: user.name, email }, convite: null }, 201);
  }
  const id = newId();
  const row = await c.env.DB.prepare(
    `INSERT INTO convites (id, tenant_id, email, papel, criado_por) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, email) DO UPDATE SET papel = excluded.papel, aceito_em = NULL
       RETURNING id, email, papel`,
  ).bind(id, tenantId, email, role, c.get('user').id).first<{ id: string; email: string; papel: string }>();
  return c.json({ membro: null, convite: { ...row!, link: inviteLink(row!.id) } }, 201);
})

// Cancel a pending invite (admins only).
.delete('/t/:tenantId/convites/:id', requireMember('admin'), async (c) => {
  const r = await c.env.DB.prepare('DELETE FROM convites WHERE id = ? AND tenant_id = ? AND aceito_em IS NULL RETURNING id')
    .bind(c.req.param('id'), c.get('tenant').id).first<{ id: string }>();
  if (!r) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  return c.json({ id: r.id });
})

// Source health for the sidebar: active and without a failure since the last collection = ok. A manual source (account)
// does not count. `?todas=1` also brings paused ones (outlet screen).
.get('/t/:tenantId/fontes', queryAll, async (c) => {
  const all = c.req.query('todas') === '1';
  const { results } = await c.env.DB.prepare(
    "SELECT id, nome, url, ativo, falhas, ultimo_fetch_at, intervalo_min, via_navegador, propria_desde FROM fontes WHERE tenant_id = ? AND (ativo = 1 OR ?) AND tipo != 'manual' ORDER BY ativo DESC, nome LIMIT 100",
  ).bind(c.get('tenant').id, all ? 1 : 0).all<{ id: string; nome: string; url: string | null; ativo: number; falhas: number; ultimo_fetch_at: string | null; propria_desde: string | null; intervalo_min: number; via_navegador: number }>();
  // `intervaloMin`: the source is due `intervalo_min` after the last collection and goes into the next cron (every 15 min).
  // `coletavel`: active and without MAX_FAILURES_SOURCE consecutive failures (the cron gives up); otherwise it does not count for the next collection.
  const sources = results.map((f) => ({
    id: f.id, nome: f.nome, url: f.url, ativo: f.ativo === 1, ok: f.falhas === 0, coletadaEm: f.ultimo_fetch_at, intervaloMin: f.intervalo_min,
    coletavel: f.ativo === 1 && f.falhas < MAX_FAILURES_SOURCE,
    // The last good fetch needed Browser Rendering (the site blocks a plain fetch).
    viaNavegador: f.via_navegador === 1,
    propria: !!f.propria_desde,
  }));
  const collectionAt = sources.map((f) => f.coletadaEm).filter((d): d is string => !!d).sort().at(-1) ?? null;
  const tenant = await c.env.DB.prepare('SELECT resumo_ligado, piloto_ligado_em, piloto_por_dia FROM tenants WHERE id = ?').bind(c.get('tenant').id).first<{ resumo_ligado: number; piloto_ligado_em: string | null; piloto_por_dia: number }>();
  const soloAccount = !!(await fromAutopilotAccount(c.env, c.get('tenant').id));
  return c.json({ fontes: sources, coletaEm: collectionAt, resumoLigado: tenant?.resumo_ligado === 1, piloto: { ligado: !!tenant?.piloto_ligado_em, porDia: tenant?.piloto_por_dia ?? 6, contaSozinha: soloAccount } });
})

// Daily digest: admins turn on the 18:00 cron; editors ask for it on the spot, through the same function.
.patch('/t/:tenantId/piloto', requireMember('admin'), async (c) => {
  const tenantId = c.get('tenant').id;
  const actor = c.get('user').id;
  const b = await readJson<{ ligado: unknown }>(c);
  if (typeof b.ligado !== 'boolean') return c.json({ erro: 'ligado: true | false' }, 400);
  const tenant = await c.env.DB.prepare('SELECT modo FROM tenants WHERE id = ?').bind(tenantId).first<{ modo: string }>();
  if (tenant?.modo === 'autoral') return c.json({ erro: t(c, 'veículo autoral não tem piloto', "an author outlet doesn't have autopilot") }, 400);
  if (b.ligado && !(await fromAutopilotAccount(c.env, tenantId))) return c.json({ erro: t(c, 'o piloto exige uma conta que poste sozinha', 'autopilot needs an account that posts on its own') }, 409);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE tenants SET piloto_ligado_em = CASE WHEN ? THEN COALESCE(piloto_ligado_em, datetime('now')) END, piloto_ligado_por = CASE WHEN ? THEN ? END WHERE id = ?")
      .bind(b.ligado ? 1 : 0, b.ligado ? 1 : 0, actor, tenantId),
    stmtEvent(c.env, { tenantId, tipo: b.ligado ? 'piloto.ligado' : 'piloto.desligado', refTipo: 'tenant', refId: tenantId, payload: { por: actor } }),
  ]);
  return c.json({ ligado: b.ligado });
})
.patch('/t/:tenantId/resumo', requireMember('admin'), async (c) => {
  const b = await readJson<{ ligado?: unknown }>(c);
  if (typeof b.ligado !== 'boolean') return c.json({ erro: 'ligado: true | false' }, 400);
  await c.env.DB.prepare("UPDATE tenants SET resumo_ligado = ? WHERE id = ? AND modo != 'autoral'").bind(b.ligado ? 1 : 0, c.get('tenant').id).run();
  return c.json({ ligado: b.ligado });
})
.post('/t/:tenantId/resumo', requireMember('editor'), async (c) => {
  const r = await buildSummary(c.env, c.get('tenant').id, undefined, c.get('user').id);
  if (r.situacao === 'poucas') return c.json({ ...r, erro: t(c, `Só ${r.encontradas} notícias nas últimas 24 horas. O resumo precisa de ${MIN_SUMMARY}.`, `Only ${r.encontradas} stories in the last 24 hours. The roundup needs ${MIN_SUMMARY}.`) }, 409);
  return c.json(r, r.situacao === 'nova' ? 201 : 200);
})

// A new RSS source (admins only). Idempotent by (tenant, url): the same URL returns the existing source (200), without
// duplicating. Collection only starts in the next cron.
.post('/t/:tenantId/fontes', requireMember('admin'), async (c) => {
  const tenantId = c.get('tenant').id;
  const b = await readJson<{ nome: string; url: string }>(c);
  const name = String(b.nome ?? '').trim();
  if (name.length < 2 || name.length > 80) return c.json({ erro: t(c, 'nome entre 2 e 80 caracteres', 'name must be 2 to 80 characters') }, 400);
  const url = sourceUrl(b.url);
  if (!url) return c.json({ erro: t(c, 'url: endereço http(s) completo do feed', 'url: the full http(s) address of the feed') }, 400);
  // Unique index (tenant_id, url): two simultaneous requests do not create two sources; the loser receives the existing one.
  const id = newId();
  const created = await c.env.DB.prepare("INSERT INTO fontes (id, tenant_id, tipo, nome, url) VALUES (?, ?, 'rss', ?, ?) ON CONFLICT (tenant_id, url) DO NOTHING RETURNING id")
    .bind(id, tenantId, name, url).first<{ id: string }>();
  if (created) return c.json({ id, nome: name, url, ativo: true, existia: false }, 201);
  const existing = (await c.env.DB.prepare('SELECT id, nome, url, ativo FROM fontes WHERE tenant_id = ? AND url = ?').bind(tenantId, url)
    .first<{ id: string; nome: string; url: string; ativo: number }>())!;
  return c.json({ id: existing.id, nome: existing.nome, url: existing.url, ativo: existing.ativo === 1, existia: true });
})

// Pause or resume a source (admins only). Resuming resets the failures: the source goes back to the cron queue.
.patch('/t/:tenantId/fontes/:id', requireMember('admin'), async (c) => {
  const tenantId = c.get('tenant').id;
  const b = await readJson<{ ativo?: boolean; propria?: boolean }>(c);
  // "This is the outlet's site": it applies to what comes out from now on. An author outlet already reads everything of its own.
  if (typeof b.propria === 'boolean') {
    const mode = await c.env.DB.prepare('SELECT modo FROM tenants WHERE id = ?').bind(tenantId).first<{ modo: string }>();
    if (mode?.modo === 'autoral') return c.json({ erro: t(c, 'veículo autoral não tem site próprio como fonte', "an author outlet doesn't mark its own site as a source") }, 400);
    const row = await c.env.DB.prepare("UPDATE fontes SET propria_desde = ? WHERE id = ? AND tenant_id = ? AND tipo != 'manual' RETURNING id, propria_desde")
      .bind(b.propria ? new Date().toISOString() : null, c.req.param('id'), tenantId).first<{ id: string; propria_desde: string | null }>();
    if (!row) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
    return c.json({ id: row.id, propria: !!row.propria_desde });
  }
  if (typeof b.ativo !== 'boolean') return c.json({ erro: 'ativo: true | false' }, 400);
  const row = await c.env.DB.prepare(`UPDATE fontes SET ativo = ?, falhas = CASE WHEN ? THEN 0 ELSE falhas END WHERE id = ? AND tenant_id = ? AND tipo != 'manual' RETURNING id, ativo`)
    .bind(b.ativo ? 1 : 0, b.ativo ? 1 : 0, c.req.param('id'), tenantId).first<{ id: string; ativo: number }>();
  if (!row) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  return c.json({ id: row.id, ativo: row.ativo === 1 });
})

// Coverage (local outlet): the municipalities in tenant_areas, in the order they were added. Triage only accepts news
// from these cities. Any member sees them; only admins add or remove.
.get('/t/:tenantId/areas', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT municipio_ibge AS ibge, MAX(municipio_nome) AS nome FROM tenant_areas WHERE tenant_id = ?
      GROUP BY municipio_ibge ORDER BY MIN(rowid)`,
  ).bind(c.get('tenant').id).all<{ ibge: string; nome: string | null }>();
  return c.json({ areas: results });
})

// Add a municipality (admins only, local outlets only). Idempotent by (tenant, municipality): again returns 200.
.post('/t/:tenantId/areas', requireMember('admin'), async (c) => {
  const tenantId = c.get('tenant').id;
  const b = await readJson<{ municipioIbge: string; municipioNome: string }>(c);
  const ibge = typeof b.municipioIbge === 'string' ? b.municipioIbge.trim() : '';
  const name = typeof b.municipioNome === 'string' ? b.municipioNome.trim() : '';
  if (!/^\d{7}$/.test(ibge)) return c.json({ erro: t(c, 'municipioIbge: código IBGE de 7 dígitos', 'municipioIbge: 7-digit IBGE code') }, 400);
  if (name.length < 2 || name.length > 80) return c.json({ erro: t(c, 'municipioNome: entre 2 e 80 caracteres (como aparece nas notícias)', 'municipioNome: 2 to 80 characters (as it appears in the news)') }, 400);
  const tenant = await c.env.DB.prepare('SELECT modo FROM tenants WHERE id = ?').bind(tenantId).first<{ modo: string }>();
  if (tenant?.modo !== 'local') return c.json({ erro: t(c, `veículo ${tenant?.modo === 'autoral' ? 'de autor' : 'temático'} não tem cobertura por cidade`, `${tenant?.modo === 'autoral' ? 'author' : 'topic-based'} publications have no city coverage`) }, 409);
  // A single statement: two identical simultaneous requests do not duplicate (the PK with a NULL neighbourhood does not prevent it).
  const r = await c.env.DB.prepare(
    `INSERT INTO tenant_areas (tenant_id, municipio_ibge, municipio_nome, bairro)
       SELECT ?, ?, ?, NULL WHERE NOT EXISTS (SELECT 1 FROM tenant_areas WHERE tenant_id = ? AND municipio_ibge = ?)`,
  ).bind(tenantId, ibge, name, tenantId, ibge).run();
  return c.json({ ibge, nome: name, existia: !r.meta.changes }, r.meta.changes ? 201 : 200);
})

// Remove a municipality (admins only). The last city cannot leave (409): a local outlet without a city receives no news.
.delete('/t/:tenantId/areas/:ibge', requireMember('admin'), async (c) => {
  const tenantId = c.get('tenant').id;
  const ibge = c.req.param('ibge');
  // In one batch (transaction): remove and, if the main one (picker, the lead's fallback) is no longer covered, make the
  // first remaining city the main one, with its state. Two simultaneous removals do not leave the main one uncovered.
  const first = `(SELECT municipio_ibge FROM tenant_areas WHERE tenant_id = ? ORDER BY rowid LIMIT 1)`;
  const [r] = await c.env.DB.batch([
    c.env.DB.prepare(
      `DELETE FROM tenant_areas WHERE tenant_id = ? AND municipio_ibge = ?
         AND (SELECT COUNT(DISTINCT municipio_ibge) FROM tenant_areas WHERE tenant_id = ?) > 1 RETURNING municipio_ibge`,
    ).bind(tenantId, ibge, tenantId),
    c.env.DB.prepare(
      `UPDATE tenants SET municipio_ibge = ${first}, uf = ${ufSql(first)}
        WHERE id = ? AND modo = 'local' AND municipio_ibge NOT IN (SELECT municipio_ibge FROM tenant_areas WHERE tenant_id = ?)`,
    ).bind(tenantId, tenantId, tenantId, tenantId),
  ]);
  if (r.results.length) return c.json({ ibge });
  const exists = await c.env.DB.prepare('SELECT 1 AS ok FROM tenant_areas WHERE tenant_id = ? AND municipio_ibge = ? LIMIT 1').bind(tenantId, ibge).first();
  return exists ? c.json({ erro: t(c, 'a última cidade não sai: o veículo precisa cobrir pelo menos uma', "the last city can't be removed: the publication must cover at least one") }, 409) : c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
})

// The tenant's log by cursor: the UI's polling asks `?desde=<last id seen>`.
.get('/t/:tenantId/eventos', async (c) => {
  const since = Math.max(0, Number(c.req.query('desde') ?? 0) || 0);
  const limit = Math.min(500, Math.max(1, Number(c.req.query('limite') ?? 100) || 100));
  const { results } = await c.env.DB.prepare('SELECT id, tipo, ref_tipo, ref_id, payload_json, created_at FROM eventos WHERE tenant_id = ? AND id > ? ORDER BY id LIMIT ?')
    .bind(c.get('tenant').id, since, limit).all<{ id: number; tipo: string; ref_tipo: string; ref_id: string; payload_json: string | null; created_at: string }>();
  return c.json({
    eventos: results.map((e) => ({ id: e.id, tipo: e.tipo, refTipo: e.ref_tipo, refId: e.ref_id, em: e.created_at, payload: e.payload_json ? JSON.parse(e.payload_json) : null })),
    cursor: results.at(-1)?.id ?? since,
  });
});

/** The API type for the UI's RPC client (`hc<AppType>`, `import type` only). */
export type AppType = typeof api;
