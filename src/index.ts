import { DeskError } from './lib/desk';
import { fromOutletPage } from './lib/outletPage';
import { validSignature, processEvent } from './lib/stripe';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env, MonitorMessage } from './env';
import { scheduled } from './monitor/scheduled';
import { queue } from './monitor/consumer';
import { verifyMedia } from './lib/crypto';
import { WithoutAccount } from './lib/publish';
import { InvalidTransition } from './kernel/states';
import { createAuth } from './shell/auth';
import { api } from './shell/api';
import { requireSameOrigin, requireSession, type AppEnv } from './shell/tenancy';
import { language, t } from './shell/language';
import { publicPage, receiveEmail } from './lib/shield';
import { HEADERS_AD, decideAd, adPage } from './lib/ad';
import { signInInList, readSignup } from './lib/waitlist';
import { selfHosted } from './lib/plans';

export { ProducaoWorkflow } from './workflows/production';
export { PublicacaoWorkflow } from './workflows/publishing';
export { ReelsContainer } from './reelsContainer';

const app = new Hono<AppEnv>();

app.get('/health', (c) => c.json({ ok: true }));

// Better Auth: sign-up, sign-in (email/password, Google), session, sign-out. One instance per request (D1 belongs to the request).
app.on(['GET', 'POST'], '/api/auth/*', (c) => createAuth(c.env).handler(c.req.raw));

// Team invite, read without a session by the sign-up screen (the id is random; it only reveals email, role and outlet).
app.get('/api/convites/:id', async (c) => {
  const row = await c.env.DB.prepare(
    'SELECT c.email, c.papel, c.aceito_em, t.nome AS veiculo, t.slug FROM convites c JOIN tenants t ON t.id = c.tenant_id WHERE c.id = ?',
  ).bind(c.req.param('id')).first<{ email: string; papel: string; aceito_em: string | null; veiculo: string; slug: string }>();
  if (!row) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  return c.json({ email: row.email, papel: row.papel, veiculo: row.veiculo, slug: row.slug, aceito: row.aceito_em !== null });
});

// Public sources page ("How we reported this"): no session, only the frozen snapshot the editor published.
// Stripe webhook: no session, and the proof is the signature over the raw body. Before the /api/* middleware.
app.post('/stripe/webhook', async (c) => {
  const secret = c.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return c.json({ erro: 'cobrança não configurada' }, 404);
  const body = await c.req.text();
  if (!(await validSignature(secret, body, c.req.header('stripe-signature')))) return c.json({ erro: 'assinatura inválida' }, 400);
  return c.json({ recebido: await processEvent(c.env, JSON.parse(body)) });
});

app.get('/fontes/:id', async (c) => {
  const html = await publicPage(c.env, c.req.param('id'));
  if (!html) return c.html('<!DOCTYPE html><html lang="pt-BR"><meta charset="utf-8"><title>Página não encontrada</title><p>Esta página de fontes não existe ou saiu do ar.</p></html>', 404);
  return c.html(html, 200, { 'cache-control': 'public, max-age=300' });
});

// The outlet's public page: off by default. Off or nonexistent gives the same response.
app.get('/v/:slug', async (c) => {
  const html = await fromOutletPage(c.env, c.req.param('slug'), Number(c.req.query('p') ?? 1));
  if (!html) return c.html('<!DOCTYPE html><html lang="pt-BR"><meta charset="utf-8"><title>Página não encontrada</title><p>Esta página não existe ou saiu do ar.</p></html>', 404);
  return c.html(html, 200, { 'cache-control': 'no-cache' });
});

// Advertiser approval: no session, with the link's token. The GET never decides (WhatsApp opens the link for the preview).
app.get('/anuncio/:token', async (c) => {
  const r = await adPage(c.env, c.req.param('token'));
  return c.html(r.html, r.status, HEADERS_AD);
});
app.post('/anuncio/:token', async (c) => {
  const form = await c.req.parseBody().catch(() => ({} as Record<string, unknown>));
  const r = await decideAd(c.env, c.req.param('token'), form.decisao, form.comentario);
  return c.html(r.html, r.status, HEADERS_AD);
});

// Self-hosted install: "/" without a session goes to /entrar, not to the waitlist (web/src/screens/Home.tsx). Public, before the session.
app.get('/api/instalacao', (c) => c.json({ propria: selfHosted(c.env) }));

// Waitlist: public, before the session. The `site` field is a honeypot: a bot that fills it gets the usual response.
app.post('/api/lista-espera', requireSameOrigin, async (c) => {
  const body = await c.req.json<{ site?: unknown }>().catch(() => null);
  if (body?.site) return c.json({ ok: true });
  const signup = readSignup(body);
  if (!signup) return c.json({ erro: t(c, 'Confira o e-mail: ele parece incompleto.', 'Check the email: it looks incomplete.') }, 400);
  const entered = await signInInList(c.env, signup, language(c), c.req.header('cf-connecting-ip') ?? '');
  if (!entered) return c.json({ erro: t(c, 'Muitos cadastros seguidos desta conexão. Tente de novo em uma hora.', 'Too many sign-ups in a row from this connection. Try again in an hour.') }, 429);
  return c.json({ ok: true });
});

// Rest of the API: same origin on mutations + required session. Tenancy lives in the /api/t/:tenantId/* routes.
app.use('/api/*', requireSameOrigin, requireSession);
app.route('/api', api);

// Art in R2. Only with a signed URL (signMedia): Instagram downloads from here when creating the container; the dashboard uses the same.
app.get('/media/*', async (c) => {
  const key = decodeURIComponent(c.req.path.replace(/^\/media\//, ''));
  if (!(await verifyMedia(c.env, key, c.req.query('exp'), c.req.query('sig')))) return c.json({ erro: t(c, 'assinatura inválida ou expirada', 'invalid or expired signature') }, 403);
  // Range (the video player requests chunks to seek): 206 with Content-Range.
  const request = c.req.header('range');
  const obj = await c.env.MEDIA.get(key, request ? { range: c.req.raw.headers } : undefined).catch(() => undefined);
  if (obj === undefined) return new Response(null, { status: 416, headers: { 'accept-ranges': 'bytes' } });
  if (!obj) return c.notFound();
  const headers: Record<string, string> = {
    'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream', 'cache-control': 'private, max-age=3600', 'accept-ranges': 'bytes',
  };
  const band = obj.range as { offset?: number; length?: number } | undefined;
  if (request && band && band.offset !== undefined && band.length !== undefined) {
    headers['content-range'] = `bytes ${band.offset}-${band.offset + band.length - 1}/${obj.size}`;
    headers['content-length'] = String(band.length);
    return new Response(obj.body, { status: 206, headers });
  }
  return new Response(obj.body, { headers });
});

app.onError((e, c) => {
  if (e instanceof DeskError && e.status === 402) return c.json({ erro: t(c, e.message, e.en ?? e.message), code: e.codigo }, 402);
  if (e instanceof InvalidTransition) return c.json({ erro: e.de === null ? t(c, 'não encontrado', 'not found') : t(c, e.message, e.en) }, e.de === null ? 404 : 409);
  if (e instanceof WithoutAccount) return c.json({ erro: t(c, e.message, e.en ?? e.message) }, 409);
  if (e instanceof HTTPException) return e.getResponse();
  console.error(e);
  return c.json({ erro: t(c, 'erro interno', 'internal error') }, 500);
});

// Incoming email (Email Routing): the reply to an other-side request (outro-lado+token@…) enters the dossier.
export default { fetch: app.fetch, scheduled, queue, email: receiveEmail } satisfies ExportedHandler<Env, MonitorMessage>;
