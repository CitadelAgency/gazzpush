// Phase 10: the per-outlet limit, with the quota in the transition's batch, and Stripe without the SDK. The network is simulated through fetch.
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLANOS, brasiliaMonth } from '../src/lib/plans';
import { summaryId } from '../src/lib/digest';
import { todayIso } from '../src/lib/lai';
import { queue } from '../src/monitor/consumer';
import * as produceModule from '../src/lib/produce';
import { TOLERANCE_WEBHOOK_S, sign, validSignature, fromPricePlan } from '../src/lib/stripe';
import * as producao from '../src/workflows/production';
import { register, req, seedAccount, seedMember, seedLead, seedPiece, seedTenant } from './helpers';

const vars = env as unknown as Record<string, unknown>;
const SECRETS = { STRIPE_SECRET_KEY: 'sk_x', STRIPE_WEBHOOK_SECRET: 'whsec_x', STRIPE_PRECO_PAGINA: 'price_p', STRIPE_PRECO_PORTAL: 'price_q', STRIPE_URL: 'https://stripe.example' };
const before = Object.fromEntries(Object.keys(SECRETS).map((k) => [k, vars[k]]));

beforeEach(() => {
  Object.assign(vars, SECRETS);
  vi.spyOn(producao, 'startProduction').mockResolvedValue(null as never);
});
afterEach(() => {
  vi.restoreAllMocks();
  Object.assign(vars, before);
});

async function outlet(plan = 'teste') {
  const t = await seedTenant();
  await env.DB.prepare('UPDATE tenants SET plano = ? WHERE id = ?').bind(plan, t).run();
  const s = await register('Ana Costa');
  await seedMember(t, s.userId, 'admin');
  return { t, s };
}
async function lead(t: string, o: { status?: string; origem?: string } = {}) {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO pautas (id, tenant_id, status, origem, titulo, fato_ids_json, documento_ids_json, score) VALUES (?, ?, ?, ?, 'Ponte', '[]', '[]', 1)").bind(id, t, o.status ?? 'sugerida', o.origem ?? 'manual').run();
  return id;
}
const request = (t: string, p: string, cookie: string, format = 'carrossel') => req(`/api/t/${t}/pautas/${p}/produzir`, { cookie, body: { formato: format } });
const used = async (t: string, month = brasiliaMonth()) => (await env.DB.prepare('SELECT posts FROM uso WHERE tenant_id = ? AND mes = ?').bind(t, month).first<{ posts: number }>())?.posts ?? 0;
const fromStatus = async (p: string) => (await env.DB.prepare('SELECT status FROM pautas WHERE id = ?').bind(p).first<{ status: string }>())?.status;
const spend = (t: string, month: string, posts: number) => env.DB.prepare('INSERT INTO uso (tenant_id, mes, posts) VALUES (?, ?, ?) ON CONFLICT (tenant_id, mes) DO UPDATE SET posts = excluded.posts').bind(t, month, posts).run();

describe('limit', () => {
  it("without a subscription there's nothing free: 402 in both languages and the lead stays in Ideas", async () => {
    const { t, s } = await outlet();
    const p = await lead(t);
    const r = await request(t, p, s.cookie);
    expect(r.status).toBe(402);
    expect(await r.json()).toEqual({ code: 'limite_plano', erro: 'Este veículo ainda não tem plano. Assine um para produzir posts e conferir textos.' });
    expect(await fromStatus(p)).toBe('sugerida');
    expect(await used(t)).toBe(0);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM pecas WHERE pauta_id = ?').bind(p).first('n')).toBe(0);
    const en = await req(`/api/t/${t}/pautas/${p}/produzir`, { cookie: s.cookie, body: { formato: 'post' }, headers: { 'x-idioma': 'en' } });
    expect(en.status).toBe(402);
    expect(await en.json()).toEqual({ code: 'limite_plano', erro: 'This outlet has no plan yet. Subscribe to produce posts and check texts.' });
  });

  it("what costs model use at the desk requires a plan; reading and saving the text doesn't", async () => {
    const { t, s } = await outlet();
    await env.DB.prepare("UPDATE tenants SET modo = 'autoral' WHERE id = ?").bind(t).run();
    const created = await req(`/api/t/${t}/textos`, { cookie: s.cookie, body: { titulo: 'Sem plano', texto: 'A Câmara aprovou o orçamento.' } });
    expect(created.status).toBe(201);
    const { texto: text } = await created.json<{ texto: { id: string } }>();
    for (const route of ['conferir', 'divulgacao', 'segunda-leitura']) {
      const r = await req(`/api/t/${t}/textos/${text.id}/${route}`, { cookie: s.cookie, body: {} });
      expect([route, r.status]).toEqual([route, 402]);
    }
    expect((await req(`/api/t/${t}/textos/${text.id}`, { cookie: s.cookie })).status).toBe(200);
  });

  it("two requests at the same time don't exceed the limit", async () => {
    const { t, s } = await outlet('pagina');
    await spend(t, brasiliaMonth(), PLANOS.pagina.limite - 1);
    const [a, b, c] = await Promise.all([lead(t), lead(t), lead(t)]);
    const rs = await Promise.all([a, b, c].map((p) => request(t, p, s.cookie)));
    expect(rs.map((r) => r.status).sort()).toEqual([201, 402, 402]);
    expect(await used(t)).toBe(PLANOS.pagina.limite);
  });

  it('the same lead requested twice uses only one quota', async () => {
    const { t, s } = await outlet('pagina');
    const p = await lead(t);
    const rs = await Promise.all([request(t, p, s.cookie), request(t, p, s.cookie)]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await used(t)).toBe(1);
  });

  it("a transition that didn't happen doesn't use quota", async () => {
    const { t, s } = await outlet();
    const p = await lead(t, { status: 'descartada' });
    expect((await request(t, p, s.cookie)).status).toBe(409);
    expect(await used(t)).toBe(0);
  });

  it("month rollover: the paid plan's limit counts only the month, in Brasília", async () => {
    expect(brasiliaMonth(new Date('2026-12-01T02:00:00Z'))).toBe('2026-11');
    expect(brasiliaMonth(new Date('2026-12-01T03:00:00Z'))).toBe('2026-12');
    const { t, s } = await outlet('pagina');
    await spend(t, '2020-01', PLANOS.pagina.limite);
    expect((await request(t, await lead(t), s.cookie)).status).toBe(201);
    await spend(t, brasiliaMonth(), PLANOS.pagina.limite);
    expect((await request(t, await lead(t), s.cookie)).status).toBe(402);
  });

  it("cortesia has no limit; a plan unknown in the database does not pass", async () => {
    const a = await outlet('cortesia');
    await spend(a.t, brasiliaMonth(), 100_000);
    expect((await request(a.t, await lead(a.t), a.s.cookie)).status).toBe(201);
    const b = await outlet('inventado');
    expect((await request(b.t, await lead(b.t), b.s.cookie)).status).toBe(402);
  });

  it("correction goes through outside the quota; producing again after a failure doesn't count", async () => {
    const { t, s } = await outlet();
    await spend(t, brasiliaMonth(), PLANOS.teste.limite);
    const p = await lead(t);
    await expect(produceModule.produceLead(env, t, p, s.userId, 'post', { semCota: true })).resolves.toMatchObject({ pecaId: expect.any(String) });
    expect(await used(t)).toBe(PLANOS.teste.limite);
    await env.DB.prepare("UPDATE pautas SET status = 'sugerida' WHERE id = ?").bind(p).run();
    expect((await request(t, p, s.cookie)).status).toBe(201);
    expect(await used(t)).toBe(PLANOS.teste.limite);
  });

  async function news(t: string) {
    for (let i = 0; i < 3; i++) {
      const { pautaId: leadId } = await seedLead(t);
      await env.DB.prepare("UPDATE pautas SET score = 50, created_at = datetime('now', '-1 hour') WHERE id = ?").bind(leadId).run();
    }
  }

  it('digest: the route gives 402 with the lead in Ideas; in the queue, the message goes out without error and the event stays', async () => {
    const a = await outlet();
    await spend(a.t, brasiliaMonth(), PLANOS.teste.limite);
    await news(a.t);
    expect((await req(`/api/t/${a.t}/resumo`, { cookie: a.s.cookie, body: {} })).status).toBe(402);
    expect(await fromStatus(summaryId(a.t, todayIso()))).toBe('sugerida');

    const b = await outlet();
    await spend(b.t, brasiliaMonth(), PLANOS.teste.limite);
    await news(b.t);
    const m = { body: { tipo: 'resumo', tenantId: b.t, dia: '2026-11-05' }, attempts: 1, ack: vi.fn(), retry: vi.fn() };
    await queue({ messages: [m] } as never, env, {} as never);
    expect(m.ack).toHaveBeenCalled();
    expect(m.retry).not.toHaveBeenCalled();
    expect(await fromStatus(summaryId(b.t, '2026-11-05'))).toBe('sugerida');
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM eventos WHERE tenant_id = ? AND tipo = 'uso.limite'").bind(b.t).first('n')).toBe(1);
  });

  it("rewrite doesn't count, even with the quota exhausted", async () => {
    const { t, s } = await outlet();
    await spend(t, brasiliaMonth(), PLANOS.teste.limite);
    const { pautaId: leadId } = await seedLead(t, 'em_producao');
    const account = await seedAccount(t, 'manual');
    const id = await seedPiece(t, leadId, { contaId: account });
    const r = await req(`/api/t/${t}/pecas/${id}/revisao`, { cookie: s.cookie, body: { decisao: 'reescrever', versao: 1, instrucao: 'Mais curto' } });
    expect(r.status).toBeLessThan(300);
    expect(await used(t)).toBe(PLANOS.teste.limite);
  });
});

describe('what is ready goes ahead', () => {
  it('with the quota exhausted and payment late, the piece under review is approved', async () => {
    const { t, s } = await outlet('pagina');
    await spend(t, brasiliaMonth(), PLANOS.pagina.limite);
    await env.DB.prepare("INSERT INTO assinaturas_plano (tenant_id, plano, status, atraso_desde) VALUES (?, 'pagina', 'past_due', datetime('now', '-30 days'))").bind(t).run();
    const { pautaId: leadId } = await seedLead(t, 'em_producao');
    const account = await seedAccount(t, 'manual');
    const id = await seedPiece(t, leadId);
    const r = await req(`/api/t/${t}/pecas/${id}/revisao`, { cookie: s.cookie, body: { decisao: 'aprovar', contaId: account, versao: 1 } });
    expect(r.status).toBe(200);
    expect((await env.DB.prepare('SELECT status FROM pecas WHERE id = ?').bind(id).first<{ status: string }>())?.status).toBe('aprovada');
  });
});

describe('late payment', () => {
  it('more than 7 days late, new posts stop, with its own message; up to 7 days, they continue', async () => {
    const { t, s } = await outlet('pagina');
    await env.DB.prepare("INSERT INTO assinaturas_plano (tenant_id, plano, status, stripe_customer, stripe_subscription, atraso_desde) VALUES (?, 'pagina', 'past_due', 'c', 'sub', datetime('now', '-6 days'))").bind(t).run();
    expect((await request(t, await lead(t), s.cookie)).status).toBe(201);
    await env.DB.prepare("UPDATE assinaturas_plano SET atraso_desde = datetime('now', '-8 days') WHERE tenant_id = ?").bind(t).run();
    const r = await request(t, await lead(t), s.cookie);
    expect(r.status).toBe(402);
    expect(await r.json()).toMatchObject({ code: 'pagamento_atrasado' });
  });
});

describe('webhook signature', () => {
  const body = '{"id":"evt_1"}';
  it('valid, invalid and outside tolerance', async () => {
    const now = 1_800_000_000_000;
    const t = now / 1000;
    const v1 = await sign('whsec_x', t, body);
    expect(await validSignature('whsec_x', body, `t=${t},v1=${v1}`, now)).toBe(true);
    expect(await validSignature('whsec_x', body, `t=${t},v1=velha,v1=${v1}`, now)).toBe(true);
    expect(await validSignature('whsec_x', `${body} `, `t=${t},v1=${v1}`, now)).toBe(false);
    expect(await validSignature('outro', body, `t=${t},v1=${v1}`, now)).toBe(false);
    expect(await validSignature('whsec_x', body, undefined, now)).toBe(false);
    expect(await validSignature('whsec_x', body, 'lixo', now)).toBe(false);
    const old = t - TOLERANCE_WEBHOOK_S - 1;
    expect(await validSignature('whsec_x', body, `t=${old},v1=${await sign('whsec_x', old, body)}`, now)).toBe(false);
    const limit = t - TOLERANCE_WEBHOOK_S;
    expect(await validSignature('whsec_x', body, `t=${limit},v1=${await sign('whsec_x', limit, body)}`, now)).toBe(true);
  });
});

describe('webhook', () => {
  const signature = (t: string, o: Record<string, unknown> = {}) => ({ id: `sub_${t}`, status: 'active', customer: `cus_${t}`, metadata: { tenant: t }, current_period_end: 1_800_000_000, items: { data: [{ price: { id: 'price_p' } }] }, ...o });
  async function send(type: string, object: unknown, id: string = crypto.randomUUID()) {
    const body = JSON.stringify({ id, type, data: { object } });
    const t = Math.floor(Date.now() / 1000);
    return req('/stripe/webhook', { origin: null, cru: { tipo: 'application/json', corpo: body }, headers: { 'stripe-signature': `t=${t},v1=${await sign('whsec_x', t, body)}` } });
  }
  const plan = async (t: string) => (await env.DB.prepare('SELECT plano FROM tenants WHERE id = ?').bind(t).first<{ plano: string }>())?.plano;
  const signatureOf = (t: string) => env.DB.prepare('SELECT * FROM assinaturas_plano WHERE tenant_id = ?').bind(t).first<Record<string, unknown>>();

  it('without a valid signature gives 400 and changes nothing; without a secret, 404', async () => {
    const { t } = await outlet();
    const body = JSON.stringify({ id: 'e', type: 'customer.subscription.updated', data: { object: signature(t) } });
    const r = await req('/stripe/webhook', { origin: null, cru: { tipo: 'application/json', corpo: body }, headers: { 'stripe-signature': `t=${Math.floor(Date.now() / 1000)},v1=errada` } });
    expect(r.status).toBe(400);
    expect(await plan(t)).toBe('teste');
    vars.STRIPE_WEBHOOK_SECRET = undefined;
    expect((await req('/stripe/webhook', { origin: null, cru: { tipo: 'application/json', corpo: body } })).status).toBe(404);
  });

  it('checkout completed: the plan comes from the Stripe price, fetched from the subscription, never from the request', async () => {
    const { t } = await outlet();
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json(signature(t, { items: { data: [{ price: { id: 'price_q' } }] } })));
    expect((await send('checkout.session.completed', { client_reference_id: t, subscription: `sub_${t}`, customer: `cus_${t}`, metadata: { plano: 'pagina' } })).status).toBe(200);
    expect(String(fetch.mock.calls[0][0])).toBe(`https://stripe.example/v1/subscriptions/sub_${t}`);
    expect(await plan(t)).toBe('portal');
    expect(await signatureOf(t)).toMatchObject({ plano: 'portal', status: 'active', stripe_customer: `cus_${t}`, stripe_subscription: `sub_${t}`, periodo_fim: '2027-01-15T08:00:00.000Z', atraso_desde: null });
  });

  it('Stripe down returns 500, without marking the event, and the retry resolves it', async () => {
    const { t } = await outlet();
    const fakeFetch = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => new Response('fora', { status: 503 }));
    const id = crypto.randomUUID();
    const object = { client_reference_id: t, subscription: `sub_${t}` };
    expect((await send('checkout.session.completed', object, id)).status).toBe(500);
    fakeFetch.mockImplementationOnce(async () => Response.json(signature(t)));
    expect((await send('checkout.session.completed', object, id)).status).toBe(200);
    expect(await plan(t)).toBe('pagina');
  });

  it('repeated event has no effect', async () => {
    const { t } = await outlet();
    const id = crypto.randomUUID();
    await send('customer.subscription.updated', signature(t), id);
    await env.DB.prepare("UPDATE tenants SET plano = 'portal' WHERE id = ?").bind(t).run();
    const r = await send('customer.subscription.updated', signature(t), id);
    expect(await r.json()).toEqual({ recebido: 'repetido' });
    expect(await plan(t)).toBe('portal');
  });

  it("plan changed; unknown price doesn't change the plan and leaves an event", async () => {
    const { t } = await outlet();
    await send('customer.subscription.updated', signature(t));
    await send('customer.subscription.updated', signature(t, { items: { data: [{ price: { id: 'price_q' } }] } }));
    expect(await plan(t)).toBe('portal');
    await send('customer.subscription.updated', signature(t, { items: { data: [{ price: { id: 'price_outro' } }] } }));
    expect(await plan(t)).toBe('portal');
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM eventos WHERE tenant_id = ? AND tipo = 'stripe.preco_desconhecido'").bind(t).first('n')).toBe(1);
    expect(fromPricePlan(env, 'price_p')).toBe('pagina');
    expect(fromPricePlan(env, null)).toBeNull();
  });

  it("incomplete subscription doesn't grant a plan", async () => {
    const { t } = await outlet();
    await send('customer.subscription.updated', signature(t, { status: 'incomplete' }));
    expect(await plan(t)).toBe('teste');
  });

  it("cancellation returns to teste; cancelling an old subscription does not touch the current one", async () => {
    const { t } = await outlet();
    await send('customer.subscription.updated', signature(t));
    await send('customer.subscription.deleted', signature(t, { id: 'sub_antiga' }));
    expect(await plan(t)).toBe('pagina');
    await send('customer.subscription.deleted', signature(t));
    expect(await plan(t)).toBe('teste');
    expect(await signatureOf(t)).toMatchObject({ status: 'canceled', atraso_desde: null });
  });

  it('failed charge marks the delay once; going back to active clears it', async () => {
    const { t } = await outlet();
    await send('customer.subscription.updated', signature(t));
    await send('invoice.payment_failed', { subscription: `sub_${t}` });
    const a = await signatureOf(t);
    expect(a).toMatchObject({ status: 'past_due' });
    expect(a?.atraso_desde).toBeTruthy();
    await env.DB.prepare("UPDATE assinaturas_plano SET atraso_desde = '2026-01-01 00:00:00' WHERE tenant_id = ?").bind(t).run();
    await send('invoice.payment_failed', { parent: { subscription_details: { subscription: `sub_${t}` } } });
    expect((await signatureOf(t))?.atraso_desde).toBe('2026-01-01 00:00:00');
    await send('customer.subscription.updated', signature(t, { status: 'past_due' }));
    expect((await signatureOf(t))?.atraso_desde).toBe('2026-01-01 00:00:00');
    await send('customer.subscription.updated', signature(t));
    expect((await signatureOf(t))?.atraso_desde).toBeNull();
  });

  it("subscription for an outlet that doesn't exist doesn't break the webhook", async () => {
    const r = await send('customer.subscription.updated', signature('nao-existe'));
    expect(r.status).toBe(200);
  });
});

describe('subscription routes', () => {
  it('without the secrets the tab says so, and the routes respond 503; the limit still applies', async () => {
    const { t, s } = await outlet();
    vars.STRIPE_SECRET_KEY = undefined;
    const p = await (await req(`/api/t/${t}/plano`, { cookie: s.cookie })).json<{ cobranca: boolean; plano: string; limite: number; usados: number }>();
    expect(p).toMatchObject({ cobranca: false, plano: 'teste', limite: 0, usados: 0 });
    expect((await req(`/api/t/${t}/assinatura/checkout`, { cookie: s.cookie, body: { plano: 'pagina' } })).status).toBe(503);
    expect((await req(`/api/t/${t}/assinatura/portal`, { cookie: s.cookie, body: {} })).status).toBe(503);
  });

  it('checkout: subscription, card, the outlet in client_reference_id and the price coming from the server', async () => {
    const { t, s } = await outlet();
    const f = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ url: 'https://checkout.example/x' }));
    const r = await req(`/api/t/${t}/assinatura/checkout`, { cookie: s.cookie, body: { plano: 'portal', price: 'price_de_graca' } });
    expect(await r.json()).toEqual({ url: 'https://checkout.example/x' });
    expect(String(f.mock.calls[0][0])).toBe('https://stripe.example/v1/checkout/sessions');
    const body = f.mock.calls[0][1]!.body as URLSearchParams;
    expect(body.get('mode')).toBe('subscription');
    expect(body.get('client_reference_id')).toBe(t);
    expect(body.get('line_items[0][price]')).toBe('price_q');
    expect(body.get('payment_method_types[0]')).toBe('card');
    expect((await req(`/api/t/${t}/assinatura/checkout`, { cookie: s.cookie, body: { plano: 'cortesia' } })).status).toBe(400);
  });

  it("an existing subscriber goes to Manage; the portal uses the outlet's customer; Stripe down gives 502", async () => {
    const { t, s } = await outlet('pagina');
    expect((await req(`/api/t/${t}/assinatura/portal`, { cookie: s.cookie, body: {} })).status).toBe(404);
    await env.DB.prepare("INSERT INTO assinaturas_plano (tenant_id, plano, status, stripe_customer, stripe_subscription) VALUES (?, 'pagina', 'active', 'cus_a', 'sub_a')").bind(t).run();
    expect((await req(`/api/t/${t}/assinatura/checkout`, { cookie: s.cookie, body: { plano: 'portal' } })).status).toBe(409);
    const f = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => Response.json({ url: 'https://portal.example/x' }));
    expect(await (await req(`/api/t/${t}/assinatura/portal`, { cookie: s.cookie, body: {} })).json()).toEqual({ url: 'https://portal.example/x' });
    expect((f.mock.calls[0][1]!.body as URLSearchParams).get('customer')).toBe('cus_a');
    f.mockImplementationOnce(async () => new Response('fora', { status: 500 }));
    expect((await req(`/api/t/${t}/assinatura/portal`, { cookie: s.cookie, body: {} })).status).toBe(502);
  });

  it('IDOR and admin only', async () => {
    const { t, s } = await outlet();
    const outside = await register('Fora');
    const ed = await register('Ed');
    await seedMember(t, ed.userId, 'editor');
    const routes: [string, unknown?][] = [['plano'], ['assinatura/checkout', { plano: 'pagina' }], ['assinatura/portal', {}]];
    for (const [route, body] of routes) {
      expect((await req(`/api/t/${t}/${route}`, { cookie: outside.cookie, body })).status, route).toBe(404);
      expect((await req(`/api/t/${t}/${route}`, { cookie: ed.cookie, body })).status, route).toBe(403);
    }
    expect((await req(`/api/t/${t}/plano`, { cookie: s.cookie })).status).toBe(200);
  });
});
