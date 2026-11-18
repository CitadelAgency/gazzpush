// Stripe sem SDK: `fetch` direto, com `STRIPE_URL` trocável em teste. O plano vem sempre do `price` da Stripe, nunca do cliente, e a
// assinatura do webhook é conferida com HMAC SHA-256 em WebCrypto sobre o corpo cru. Sem os quatro segredos, a cobrança fica
// desligada e o resto do app segue igual.
import type { Env } from '../env';
import { eventoStmt } from './db';
import type { PlanoPago } from './planos';

export const TOLERANCIA_WEBHOOK_S = 300;

export const cobrancaLigada = (env: Env) => !!(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET && env.STRIPE_PRECO_PAGINA && env.STRIPE_PRECO_PORTAL);

const precoDe = (env: Env, plano: PlanoPago) => (plano === 'pagina' ? env.STRIPE_PRECO_PAGINA : env.STRIPE_PRECO_PORTAL);
export const planoDoPreco = (env: Env, preco: string | null | undefined): PlanoPago | null =>
  !preco ? null : preco === env.STRIPE_PRECO_PAGINA ? 'pagina' : preco === env.STRIPE_PRECO_PORTAL ? 'portal' : null;

async function stripe<T>(env: Env, caminho: string, corpo?: Record<string, string>): Promise<T> {
  const res = await fetch(`${env.STRIPE_URL ?? 'https://api.stripe.com'}${caminho}`, {
    method: corpo ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, ...(corpo ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
    ...(corpo ? { body: new URLSearchParams(corpo) } : {}),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`stripe ${caminho}: ${res.status}`);
  return res.json<T>();
}

export async function criarCheckout(env: Env, t: { id: string; slug: string }, plano: PlanoPago, cliente: string | null) {
  const volta = `${env.PUBLIC_BASE_URL}/t/${t.slug}/veiculo?aba=plano`;
  const s = await stripe<{ url: string }>(env, '/v1/checkout/sessions', {
    mode: 'subscription', 'payment_method_types[0]': 'card',
    'line_items[0][price]': precoDe(env, plano)!, 'line_items[0][quantity]': '1',
    client_reference_id: t.id, 'subscription_data[metadata][tenant]': t.id,
    success_url: volta, cancel_url: volta,
    ...(cliente ? { customer: cliente } : {}),
  });
  return s.url;
}

export async function criarPortal(env: Env, slug: string, cliente: string) {
  const s = await stripe<{ url: string }>(env, '/v1/billing_portal/sessions', { customer: cliente, return_url: `${env.PUBLIC_BASE_URL}/t/${slug}/veiculo?aba=plano` });
  return s.url;
}

const hexDe = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

/** Comparação em tempo constante: `crypto.subtle.verify` do HMAC faria o mesmo, mas o cabeçalho pode trazer mais de um `v1`. */
function iguais(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function assinar(segredo: string, t: number, corpo: string) {
  const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hexDe(await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(`${t}.${corpo}`)));
}

/** `Stripe-Signature: t=<segundos>,v1=<hex>`, sobre `<t>.<corpo cru>`, com tolerância de 5 minutos. */
export async function assinaturaValida(segredo: string, corpo: string, cabecalho: string | undefined, agoraMs = Date.now()) {
  if (!cabecalho) return false;
  const partes = cabecalho.split(',').map((p) => p.trim().split('='));
  const t = Number(partes.find(([k]) => k === 't')?.[1]);
  const v1 = partes.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!Number.isFinite(t) || !v1.length || Math.abs(agoraMs / 1000 - t) > TOLERANCIA_WEBHOOK_S) return false;
  const certa = await assinar(segredo, t, corpo);
  return v1.some((v) => iguais(v, certa));
}

interface Assinatura {
  id: string; status: string; customer: string; metadata?: { tenant?: string }; current_period_end?: number;
  items?: { data?: { price?: { id?: string }; current_period_end?: number }[] };
}
interface Evento { id: string; type: string; data: { object: Record<string, any> } }

const CONCEDE = ['active', 'trialing', 'past_due', 'unpaid'];
const ATRASADA = ['past_due', 'unpaid'];

async function tenantDaAssinatura(env: Env, id: string, marcado?: string | null) {
  if (marcado) {
    const t = await env.DB.prepare('SELECT id FROM tenants WHERE id = ?').bind(marcado).first<{ id: string }>();
    if (t) return t.id;
  }
  return (await env.DB.prepare('SELECT tenant_id FROM assinaturas_plano WHERE stripe_subscription = ?').bind(id).first<{ tenant_id: string }>())?.tenant_id ?? null;
}

const cancelar = (env: Env, tenantId: string, assinatura: string) => [
  env.DB.prepare("UPDATE assinaturas_plano SET status = 'canceled', atraso_desde = NULL, updated_at = datetime('now') WHERE tenant_id = ? AND stripe_subscription = ?").bind(tenantId, assinatura),
  // Só a assinatura em vigor derruba o plano: o cancelamento de uma antiga não mexe na nova.
  env.DB.prepare("UPDATE tenants SET plano = 'teste' WHERE id = ? AND EXISTS (SELECT 1 FROM assinaturas_plano WHERE tenant_id = ? AND stripe_subscription = ?)").bind(tenantId, tenantId, assinatura),
];

async function aplicar(env: Env, s: Assinatura, tenantInformado?: string | null): Promise<D1PreparedStatement[]> {
  const tenantId = await tenantDaAssinatura(env, s.id, tenantInformado ?? s.metadata?.tenant);
  if (!tenantId) return [eventoStmt(env, { tenantId: null, tipo: 'stripe.sem_veiculo', refTipo: 'stripe', refId: s.id, payload: { status: s.status } })];
  if (!CONCEDE.includes(s.status)) return s.status === 'incomplete' ? [] : cancelar(env, tenantId, s.id);
  const item = s.items?.data?.[0];
  const plano = planoDoPreco(env, item?.price?.id);
  if (!plano) return [eventoStmt(env, { tenantId, tipo: 'stripe.preco_desconhecido', refTipo: 'stripe', refId: s.id, payload: { preco: item?.price?.id ?? null } })];
  const fim = s.current_period_end ?? item?.current_period_end;
  const atraso = ATRASADA.includes(s.status);
  return [
    env.DB.prepare(`INSERT INTO assinaturas_plano (tenant_id, plano, status, stripe_customer, stripe_subscription, periodo_fim, atraso_desde) VALUES (?1, ?2, ?3, ?4, ?5, ?6, CASE WHEN ?7 THEN datetime('now') END)
      ON CONFLICT (tenant_id) DO UPDATE SET plano = excluded.plano, status = excluded.status, stripe_customer = excluded.stripe_customer, stripe_subscription = excluded.stripe_subscription,
        periodo_fim = excluded.periodo_fim, atraso_desde = CASE WHEN ?7 THEN COALESCE(assinaturas_plano.atraso_desde, datetime('now')) END, updated_at = datetime('now')`)
      .bind(tenantId, plano, s.status, s.customer, s.id, fim ? new Date(fim * 1000).toISOString() : null, atraso ? 1 : 0),
    env.DB.prepare('UPDATE tenants SET plano = ? WHERE id = ?').bind(plano, tenantId),
  ];
}

/** Idempotente por `stripe_eventos`: o id entra no mesmo batch do efeito. Falha ao buscar a assinatura sobe, e a Stripe repete. */
export async function processarEvento(env: Env, ev: Evento): Promise<'ok' | 'repetido'> {
  if (await env.DB.prepare('SELECT 1 AS x FROM stripe_eventos WHERE id = ?').bind(ev.id).first()) return 'repetido';
  const o = ev.data.object;
  let efeito: D1PreparedStatement[] = [];
  if (ev.type === 'checkout.session.completed' && o.subscription) {
    efeito = await aplicar(env, await stripe<Assinatura>(env, `/v1/subscriptions/${encodeURIComponent(o.subscription)}`), o.client_reference_id);
  } else if (ev.type === 'customer.subscription.updated') {
    efeito = await aplicar(env, o as unknown as Assinatura);
  } else if (ev.type === 'customer.subscription.deleted') {
    const tenantId = await tenantDaAssinatura(env, o.id, o.metadata?.tenant);
    if (tenantId) efeito = cancelar(env, tenantId, o.id);
  } else if (ev.type === 'invoice.payment_failed') {
    const assinatura = o.subscription ?? o.parent?.subscription_details?.subscription;
    if (assinatura) efeito = [env.DB.prepare("UPDATE assinaturas_plano SET status = 'past_due', atraso_desde = COALESCE(atraso_desde, datetime('now')), updated_at = datetime('now') WHERE stripe_subscription = ?").bind(assinatura)];
  }
  try {
    await env.DB.batch([env.DB.prepare('INSERT INTO stripe_eventos (id, tipo) VALUES (?, ?)').bind(ev.id, ev.type), ...efeito]);
    return 'ok';
  } catch (e) {
    if (/UNIQUE/i.test(String(e))) return 'repetido';   // a mesma entrega ao mesmo tempo
    throw e;
  }
}
