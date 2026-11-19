// Stripe without the SDK: plain `fetch`, with `STRIPE_URL` swappable in tests. The plan always comes from Stripe's
// `price`, never from the client, and the webhook signature is checked with HMAC SHA-256 in WebCrypto over the raw body.
// Without the four secrets, billing is off and the rest of the app works the same.
import type { Env } from '../env';
import { stmtEvent } from './db';
import type { PlanoPago } from './plans';

export const TOLERANCE_WEBHOOK_S = 300;

export const billingOn = (env: Env) => !!(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET && env.STRIPE_PRECO_PAGINA && env.STRIPE_PRECO_PORTAL);

const price = (env: Env, plan: PlanoPago) => (plan === 'pagina' ? env.STRIPE_PRECO_PAGINA : env.STRIPE_PRECO_PORTAL);
export const fromPricePlan = (env: Env, amount: string | null | undefined): PlanoPago | null =>
  !amount ? null : amount === env.STRIPE_PRECO_PAGINA ? 'pagina' : amount === env.STRIPE_PRECO_PORTAL ? 'portal' : null;

async function stripe<T>(env: Env, path: string, body?: Record<string, string>): Promise<T> {
  const res = await fetch(`${env.STRIPE_URL ?? 'https://api.stripe.com'}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
    ...(body ? { body: new URLSearchParams(body) } : {}),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`stripe ${path}: ${res.status}`);
  return res.json<T>();
}

export async function createCheckout(env: Env, t: { id: string; slug: string }, plan: PlanoPago, client: string | null) {
  const back = `${env.PUBLIC_BASE_URL}/t/${t.slug}/veiculo?aba=plano`;
  const s = await stripe<{ url: string }>(env, '/v1/checkout/sessions', {
    mode: 'subscription', 'payment_method_types[0]': 'card',
    'line_items[0][price]': price(env, plan)!, 'line_items[0][quantity]': '1',
    client_reference_id: t.id, 'subscription_data[metadata][tenant]': t.id,
    success_url: back, cancel_url: back,
    ...(client ? { customer: client } : {}),
  });
  return s.url;
}

export async function createPortal(env: Env, slug: string, client: string) {
  const s = await stripe<{ url: string }>(env, '/v1/billing_portal/sessions', { customer: client, return_url: `${env.PUBLIC_BASE_URL}/t/${slug}/veiculo?aba=plano` });
  return s.url;
}

const hexOf = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

/** Constant-time comparison: `crypto.subtle.verify` on the HMAC would do the same, but the header can carry more than one `v1`. */
function equal(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function sign(secret: string, t: number, body: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hexOf(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`)));
}

/** `Stripe-Signature: t=<seconds>,v1=<hex>`, over `<t>.<raw body>`, with a 5-minute tolerance. */
export async function validSignature(secret: string, body: string, header: string | undefined, nowMs = Date.now()) {
  if (!header) return false;
  const parts = header.split(',').map((p) => p.trim().split('='));
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  const v1 = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!Number.isFinite(t) || !v1.length || Math.abs(nowMs / 1000 - t) > TOLERANCE_WEBHOOK_S) return false;
  const right = await sign(secret, t, body);
  return v1.some((v) => equal(v, right));
}

interface Signature {
  id: string; status: string; customer: string; metadata?: { tenant?: string }; current_period_end?: number;
  items?: { data?: { price?: { id?: string }; current_period_end?: number }[] };
}
interface EventRow { id: string; type: string; data: { object: Record<string, any> } }

const GRANTS = ['active', 'trialing', 'past_due', 'unpaid'];
const LATE = ['past_due', 'unpaid'];

async function tenantSignature(env: Env, id: string, marked?: string | null) {
  if (marked) {
    const t = await env.DB.prepare('SELECT id FROM tenants WHERE id = ?').bind(marked).first<{ id: string }>();
    if (t) return t.id;
  }
  return (await env.DB.prepare('SELECT tenant_id FROM assinaturas_plano WHERE stripe_subscription = ?').bind(id).first<{ tenant_id: string }>())?.tenant_id ?? null;
}

const cancel = (env: Env, tenantId: string, signature: string) => [
  env.DB.prepare("UPDATE assinaturas_plano SET status = 'canceled', atraso_desde = NULL, updated_at = datetime('now') WHERE tenant_id = ? AND stripe_subscription = ?").bind(tenantId, signature),
  // Only the current subscription drops the plan: cancelling an old one does not touch the new one.
  env.DB.prepare("UPDATE tenants SET plano = 'teste' WHERE id = ? AND EXISTS (SELECT 1 FROM assinaturas_plano WHERE tenant_id = ? AND stripe_subscription = ?)").bind(tenantId, tenantId, signature),
];

async function apply(env: Env, s: Signature, tenantReported?: string | null): Promise<D1PreparedStatement[]> {
  const tenantId = await tenantSignature(env, s.id, tenantReported ?? s.metadata?.tenant);
  if (!tenantId) return [stmtEvent(env, { tenantId: null, tipo: 'stripe.sem_veiculo', refTipo: 'stripe', refId: s.id, payload: { status: s.status } })];
  if (!GRANTS.includes(s.status)) return s.status === 'incomplete' ? [] : cancel(env, tenantId, s.id);
  const item = s.items?.data?.[0];
  const plan = fromPricePlan(env, item?.price?.id);
  if (!plan) return [stmtEvent(env, { tenantId, tipo: 'stripe.preco_desconhecido', refTipo: 'stripe', refId: s.id, payload: { preco: item?.price?.id ?? null } })];
  const end = s.current_period_end ?? item?.current_period_end;
  const delay = LATE.includes(s.status);
  return [
    env.DB.prepare(`INSERT INTO assinaturas_plano (tenant_id, plano, status, stripe_customer, stripe_subscription, periodo_fim, atraso_desde) VALUES (?1, ?2, ?3, ?4, ?5, ?6, CASE WHEN ?7 THEN datetime('now') END)
      ON CONFLICT (tenant_id) DO UPDATE SET plano = excluded.plano, status = excluded.status, stripe_customer = excluded.stripe_customer, stripe_subscription = excluded.stripe_subscription,
        periodo_fim = excluded.periodo_fim, atraso_desde = CASE WHEN ?7 THEN COALESCE(assinaturas_plano.atraso_desde, datetime('now')) END, updated_at = datetime('now')`)
      .bind(tenantId, plan, s.status, s.customer, s.id, end ? new Date(end * 1000).toISOString() : null, delay ? 1 : 0),
    env.DB.prepare('UPDATE tenants SET plano = ? WHERE id = ?').bind(plan, tenantId),
  ];
}

/** Idempotent through `stripe_eventos`: the id goes into the same batch as the effect. A failure fetching the subscription
 *  propagates, and Stripe retries. */
export async function processEvent(env: Env, ev: EventRow): Promise<'ok' | 'repetido'> {
  if (await env.DB.prepare('SELECT 1 AS x FROM stripe_eventos WHERE id = ?').bind(ev.id).first()) return 'repetido';
  const o = ev.data.object;
  let effect: D1PreparedStatement[] = [];
  if (ev.type === 'checkout.session.completed' && o.subscription) {
    effect = await apply(env, await stripe<Signature>(env, `/v1/subscriptions/${encodeURIComponent(o.subscription)}`), o.client_reference_id);
  } else if (ev.type === 'customer.subscription.updated') {
    effect = await apply(env, o as unknown as Signature);
  } else if (ev.type === 'customer.subscription.deleted') {
    const tenantId = await tenantSignature(env, o.id, o.metadata?.tenant);
    if (tenantId) effect = cancel(env, tenantId, o.id);
  } else if (ev.type === 'invoice.payment_failed') {
    const signature = o.subscription ?? o.parent?.subscription_details?.subscription;
    if (signature) effect = [env.DB.prepare("UPDATE assinaturas_plano SET status = 'past_due', atraso_desde = COALESCE(atraso_desde, datetime('now')), updated_at = datetime('now') WHERE stripe_subscription = ?").bind(signature)];
  }
  try {
    await env.DB.batch([env.DB.prepare('INSERT INTO stripe_eventos (id, tipo) VALUES (?, ?)').bind(ev.id, ev.type), ...effect]);
    return 'ok';
  } catch (e) {
    if (/UNIQUE/i.test(String(e))) return 'repetido';   // the same delivery at the same time
    throw e;
  }
}
