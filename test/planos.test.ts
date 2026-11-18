// Fase 10: o limite por veículo, com a cota no batch da transição, e a Stripe sem SDK. A rede é simulada por fetch.
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLANOS, mesBrasilia } from '../src/lib/planos';
import { idResumo } from '../src/lib/resumo';
import { hojeISO } from '../src/lib/lai';
import { queue } from '../src/monitor/consumer';
import * as produzir from '../src/lib/produzir';
import { TOLERANCIA_WEBHOOK_S, assinar, assinaturaValida, planoDoPreco } from '../src/lib/stripe';
import * as producao from '../src/workflows/producao';
import { cadastrar, req, seedConta, seedMembro, seedPauta, seedPeca, seedTenant } from './helpers';

const vars = env as unknown as Record<string, unknown>;
const SEGREDOS = { STRIPE_SECRET_KEY: 'sk_x', STRIPE_WEBHOOK_SECRET: 'whsec_x', STRIPE_PRECO_PAGINA: 'price_p', STRIPE_PRECO_PORTAL: 'price_q', STRIPE_URL: 'https://stripe.example' };
const antes = Object.fromEntries(Object.keys(SEGREDOS).map((k) => [k, vars[k]]));

beforeEach(() => {
  Object.assign(vars, SEGREDOS);
  vi.spyOn(producao, 'iniciarProducao').mockResolvedValue(null as never);
});
afterEach(() => {
  vi.restoreAllMocks();
  Object.assign(vars, antes);
});

async function veiculo(plano = 'teste') {
  const t = await seedTenant();
  await env.DB.prepare('UPDATE tenants SET plano = ? WHERE id = ?').bind(plano, t).run();
  const s = await cadastrar('Administrador');
  await seedMembro(t, s.userId, 'admin');
  return { t, s };
}
async function pauta(t: string, o: { status?: string; origem?: string } = {}) {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO pautas (id, tenant_id, status, origem, titulo, fato_ids_json, documento_ids_json, score) VALUES (?, ?, ?, ?, 'Título', '[]', '[]', 1)").bind(id, t, o.status ?? 'sugerida', o.origem ?? 'manual').run();
  return id;
}
const pedir = (t: string, p: string, cookie: string, formato = 'carrossel') => req(`/api/t/${t}/pautas/${p}/produzir`, { cookie, body: { formato } });
const usados = async (t: string, mes = mesBrasilia()) => (await env.DB.prepare('SELECT posts FROM uso WHERE tenant_id = ? AND mes = ?').bind(t, mes).first<{ posts: number }>())?.posts ?? 0;
const statusDa = async (p: string) => (await env.DB.prepare('SELECT status FROM pautas WHERE id = ?').bind(p).first<{ status: string }>())?.status;
const gastar = (t: string, mes: string, posts: number) => env.DB.prepare('INSERT INTO uso (tenant_id, mes, posts) VALUES (?, ?, ?) ON CONFLICT (tenant_id, mes) DO UPDATE SET posts = excluded.posts').bind(t, mes, posts).run();

describe('limite', () => {
  it('sem assinatura não há nada grátis: 402 nos dois idiomas e a pauta fica em Ideias', async () => {
    const { t, s } = await veiculo();
    const p = await pauta(t);
    const r = await pedir(t, p, s.cookie);
    expect(r.status).toBe(402);
    expect(await r.json()).toEqual({ code: 'limite_plano', erro: 'Este veículo ainda não tem plano. Assine um para produzir posts e conferir textos.' });
    expect(await statusDa(p)).toBe('sugerida');
    expect(await usados(t)).toBe(0);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM pecas WHERE pauta_id = ?').bind(p).first('n')).toBe(0);
    const en = await req(`/api/t/${t}/pautas/${p}/produzir`, { cookie: s.cookie, body: { formato: 'post' }, headers: { 'x-idioma': 'en' } });
    expect(en.status).toBe(402);
    expect(await en.json()).toEqual({ code: 'limite_plano', erro: 'This outlet has no plan yet. Subscribe to produce posts and check texts.' });
  });

  it('o que custa modelo na mesa pede plano; ler e salvar o texto, não', async () => {
    const { t, s } = await veiculo();
    await env.DB.prepare("UPDATE tenants SET modo = 'autoral' WHERE id = ?").bind(t).run();
    const criado = await req(`/api/t/${t}/textos`, { cookie: s.cookie, body: { titulo: 'Sem plano', texto: 'Parágrafo para conferência.' } });
    expect(criado.status).toBe(201);
    const { texto } = await criado.json<{ texto: { id: string } }>();
    for (const rota of ['conferir', 'divulgacao', 'segunda-leitura']) {
      const r = await req(`/api/t/${t}/textos/${texto.id}/${rota}`, { cookie: s.cookie, body: {} });
      expect([rota, r.status]).toEqual([rota, 402]);
    }
    expect((await req(`/api/t/${t}/textos/${texto.id}`, { cookie: s.cookie })).status).toBe(200);
  });

  it('dois pedidos ao mesmo tempo não passam do limite', async () => {
    const { t, s } = await veiculo('pagina');
    await gastar(t, mesBrasilia(), PLANOS.pagina.limite - 1);
    const [a, b, c] = await Promise.all([pauta(t), pauta(t), pauta(t)]);
    const rs = await Promise.all([a, b, c].map((p) => pedir(t, p, s.cookie)));
    expect(rs.map((r) => r.status).sort()).toEqual([201, 402, 402]);
    expect(await usados(t)).toBe(PLANOS.pagina.limite);
  });

  it('a mesma pauta pedida duas vezes gasta uma cota só', async () => {
    const { t, s } = await veiculo('pagina');
    const p = await pauta(t);
    const rs = await Promise.all([pedir(t, p, s.cookie), pedir(t, p, s.cookie)]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await usados(t)).toBe(1);
  });

  it('transição que não aconteceu não gasta cota', async () => {
    const { t, s } = await veiculo();
    const p = await pauta(t, { status: 'descartada' });
    expect((await pedir(t, p, s.cookie)).status).toBe(409);
    expect(await usados(t)).toBe(0);
  });

  it('virada de mês: o limite do plano pago conta só o mês, em Brasília', async () => {
    expect(mesBrasilia(new Date('2026-12-01T02:00:00Z'))).toBe('2026-11');
    expect(mesBrasilia(new Date('2026-12-01T03:00:00Z'))).toBe('2026-12');
    const { t, s } = await veiculo('pagina');
    await gastar(t, '2020-01', PLANOS.pagina.limite);
    expect((await pedir(t, await pauta(t), s.cookie)).status).toBe(201);
    await gastar(t, mesBrasilia(), PLANOS.pagina.limite);
    expect((await pedir(t, await pauta(t), s.cookie)).status).toBe(402);
  });

  it('cortesia não tem limite; plano desconhecido no banco não passa', async () => {
    const a = await veiculo('cortesia');
    await gastar(a.t, mesBrasilia(), 100_000);
    expect((await pedir(a.t, await pauta(a.t), a.s.cookie)).status).toBe(201);
    const b = await veiculo('inventado');
    expect((await pedir(b.t, await pauta(b.t), b.s.cookie)).status).toBe(402);
  });

  it('correção passa fora da cota; produzir de novo depois de falha não conta', async () => {
    const { t, s } = await veiculo();
    await gastar(t, mesBrasilia(), PLANOS.teste.limite);
    const p = await pauta(t);
    await expect(produzir.produzirPauta(env, t, p, s.userId, 'post', { semCota: true })).resolves.toMatchObject({ pecaId: expect.any(String) });
    expect(await usados(t)).toBe(PLANOS.teste.limite);
    await env.DB.prepare("UPDATE pautas SET status = 'sugerida' WHERE id = ?").bind(p).run();
    expect((await pedir(t, p, s.cookie)).status).toBe(201);
    expect(await usados(t)).toBe(PLANOS.teste.limite);
  });

  async function noticias(t: string) {
    for (let i = 0; i < 3; i++) {
      const { pautaId } = await seedPauta(t);
      await env.DB.prepare("UPDATE pautas SET score = 50, created_at = datetime('now', '-1 hour') WHERE id = ?").bind(pautaId).run();
    }
  }

  it('resumo: a rota dá 402 com a pauta em Ideias; na fila, a mensagem sai sem erro e fica o evento', async () => {
    const a = await veiculo();
    await gastar(a.t, mesBrasilia(), PLANOS.teste.limite);
    await noticias(a.t);
    expect((await req(`/api/t/${a.t}/resumo`, { cookie: a.s.cookie, body: {} })).status).toBe(402);
    expect(await statusDa(idResumo(a.t, hojeISO()))).toBe('sugerida');

    const b = await veiculo();
    await gastar(b.t, mesBrasilia(), PLANOS.teste.limite);
    await noticias(b.t);
    const m = { body: { tipo: 'resumo', tenantId: b.t, dia: '2026-11-05' }, attempts: 1, ack: vi.fn(), retry: vi.fn() };
    await queue({ messages: [m] } as never, env, {} as never);
    expect(m.ack).toHaveBeenCalled();
    expect(m.retry).not.toHaveBeenCalled();
    expect(await statusDa(idResumo(b.t, '2026-11-05'))).toBe('sugerida');
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM eventos WHERE tenant_id = ? AND tipo = 'uso.limite'").bind(b.t).first('n')).toBe(1);
  });

  it('reescrita não conta, mesmo com a cota esgotada', async () => {
    const { t, s } = await veiculo();
    await gastar(t, mesBrasilia(), PLANOS.teste.limite);
    const { pautaId } = await seedPauta(t, 'em_producao');
    const conta = await seedConta(t, 'manual');
    const id = await seedPeca(t, pautaId, { contaId: conta });
    const r = await req(`/api/t/${t}/pecas/${id}/revisao`, { cookie: s.cookie, body: { decisao: 'reescrever', versao: 1, instrucao: 'Mais curto' } });
    expect(r.status).toBeLessThan(300);
    expect(await usados(t)).toBe(PLANOS.teste.limite);
  });
});

describe('o que está pronto segue', () => {
  it('com a cota esgotada e o pagamento atrasado, a peça em revisão é aprovada', async () => {
    const { t, s } = await veiculo('pagina');
    await gastar(t, mesBrasilia(), PLANOS.pagina.limite);
    await env.DB.prepare("INSERT INTO assinaturas_plano (tenant_id, plano, status, atraso_desde) VALUES (?, 'pagina', 'past_due', datetime('now', '-30 days'))").bind(t).run();
    const { pautaId } = await seedPauta(t, 'em_producao');
    const conta = await seedConta(t, 'manual');
    const id = await seedPeca(t, pautaId);
    const r = await req(`/api/t/${t}/pecas/${id}/revisao`, { cookie: s.cookie, body: { decisao: 'aprovar', contaId: conta, versao: 1 } });
    expect(r.status).toBe(200);
    expect((await env.DB.prepare('SELECT status FROM pecas WHERE id = ?').bind(id).first<{ status: string }>())?.status).toBe('aprovada');
  });
});

describe('atraso', () => {
  it('atrasado há mais de 7 dias para post novo com mensagem própria; até 7 dias segue', async () => {
    const { t, s } = await veiculo('pagina');
    await env.DB.prepare("INSERT INTO assinaturas_plano (tenant_id, plano, status, stripe_customer, stripe_subscription, atraso_desde) VALUES (?, 'pagina', 'past_due', 'c', 'sub', datetime('now', '-6 days'))").bind(t).run();
    expect((await pedir(t, await pauta(t), s.cookie)).status).toBe(201);
    await env.DB.prepare("UPDATE assinaturas_plano SET atraso_desde = datetime('now', '-8 days') WHERE tenant_id = ?").bind(t).run();
    const r = await pedir(t, await pauta(t), s.cookie);
    expect(r.status).toBe(402);
    expect(await r.json()).toMatchObject({ code: 'pagamento_atrasado' });
  });
});

describe('assinatura do webhook', () => {
  const corpo = '{"id":"evt_1"}';
  it('válida, inválida e fora da tolerância', async () => {
    const agora = 1_800_000_000_000;
    const t = agora / 1000;
    const v1 = await assinar('whsec_x', t, corpo);
    expect(await assinaturaValida('whsec_x', corpo, `t=${t},v1=${v1}`, agora)).toBe(true);
    expect(await assinaturaValida('whsec_x', corpo, `t=${t},v1=velha,v1=${v1}`, agora)).toBe(true);
    expect(await assinaturaValida('whsec_x', `${corpo} `, `t=${t},v1=${v1}`, agora)).toBe(false);
    expect(await assinaturaValida('outro', corpo, `t=${t},v1=${v1}`, agora)).toBe(false);
    expect(await assinaturaValida('whsec_x', corpo, undefined, agora)).toBe(false);
    expect(await assinaturaValida('whsec_x', corpo, 'lixo', agora)).toBe(false);
    const velho = t - TOLERANCIA_WEBHOOK_S - 1;
    expect(await assinaturaValida('whsec_x', corpo, `t=${velho},v1=${await assinar('whsec_x', velho, corpo)}`, agora)).toBe(false);
    const limite = t - TOLERANCIA_WEBHOOK_S;
    expect(await assinaturaValida('whsec_x', corpo, `t=${limite},v1=${await assinar('whsec_x', limite, corpo)}`, agora)).toBe(true);
  });
});

describe('webhook', () => {
  const assinatura = (t: string, o: Record<string, unknown> = {}) => ({ id: `sub_${t}`, status: 'active', customer: `cus_${t}`, metadata: { tenant: t }, current_period_end: 1_800_000_000, items: { data: [{ price: { id: 'price_p' } }] }, ...o });
  async function enviar(type: string, object: unknown, id: string = crypto.randomUUID()) {
    const corpo = JSON.stringify({ id, type, data: { object } });
    const t = Math.floor(Date.now() / 1000);
    return req('/stripe/webhook', { origin: null, cru: { tipo: 'application/json', corpo }, headers: { 'stripe-signature': `t=${t},v1=${await assinar('whsec_x', t, corpo)}` } });
  }
  const planoDe = async (t: string) => (await env.DB.prepare('SELECT plano FROM tenants WHERE id = ?').bind(t).first<{ plano: string }>())?.plano;
  const assinaturaDe = (t: string) => env.DB.prepare('SELECT * FROM assinaturas_plano WHERE tenant_id = ?').bind(t).first<Record<string, unknown>>();

  it('sem assinatura válida dá 400 e não muda nada; sem segredo, 404', async () => {
    const { t } = await veiculo();
    const corpo = JSON.stringify({ id: 'e', type: 'customer.subscription.updated', data: { object: assinatura(t) } });
    const r = await req('/stripe/webhook', { origin: null, cru: { tipo: 'application/json', corpo }, headers: { 'stripe-signature': `t=${Math.floor(Date.now() / 1000)},v1=errada` } });
    expect(r.status).toBe(400);
    expect(await planoDe(t)).toBe('teste');
    vars.STRIPE_WEBHOOK_SECRET = undefined;
    expect((await req('/stripe/webhook', { origin: null, cru: { tipo: 'application/json', corpo } })).status).toBe(404);
  });

  it('checkout concluído: o plano vem do price da Stripe, buscado na assinatura, nunca do pedido', async () => {
    const { t } = await veiculo();
    const buscar = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json(assinatura(t, { items: { data: [{ price: { id: 'price_q' } }] } })));
    expect((await enviar('checkout.session.completed', { client_reference_id: t, subscription: `sub_${t}`, customer: `cus_${t}`, metadata: { plano: 'pagina' } })).status).toBe(200);
    expect(String(buscar.mock.calls[0][0])).toBe(`https://stripe.example/v1/subscriptions/sub_${t}`);
    expect(await planoDe(t)).toBe('portal');
    expect(await assinaturaDe(t)).toMatchObject({ plano: 'portal', status: 'active', stripe_customer: `cus_${t}`, stripe_subscription: `sub_${t}`, periodo_fim: '2027-01-15T08:00:00.000Z', atraso_desde: null });
  });

  it('a Stripe fora do ar sobe 500, sem marcar o evento, e a repetição resolve', async () => {
    const { t } = await veiculo();
    const fetchFalso = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => new Response('fora', { status: 503 }));
    const id = crypto.randomUUID();
    const objeto = { client_reference_id: t, subscription: `sub_${t}` };
    expect((await enviar('checkout.session.completed', objeto, id)).status).toBe(500);
    fetchFalso.mockImplementationOnce(async () => Response.json(assinatura(t)));
    expect((await enviar('checkout.session.completed', objeto, id)).status).toBe(200);
    expect(await planoDe(t)).toBe('pagina');
  });

  it('evento repetido não tem efeito', async () => {
    const { t } = await veiculo();
    const id = crypto.randomUUID();
    await enviar('customer.subscription.updated', assinatura(t), id);
    await env.DB.prepare("UPDATE tenants SET plano = 'portal' WHERE id = ?").bind(t).run();
    const r = await enviar('customer.subscription.updated', assinatura(t), id);
    expect(await r.json()).toEqual({ recebido: 'repetido' });
    expect(await planoDe(t)).toBe('portal');
  });

  it('plano trocado; price desconhecido não muda o plano e deixa evento', async () => {
    const { t } = await veiculo();
    await enviar('customer.subscription.updated', assinatura(t));
    await enviar('customer.subscription.updated', assinatura(t, { items: { data: [{ price: { id: 'price_q' } }] } }));
    expect(await planoDe(t)).toBe('portal');
    await enviar('customer.subscription.updated', assinatura(t, { items: { data: [{ price: { id: 'price_outro' } }] } }));
    expect(await planoDe(t)).toBe('portal');
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM eventos WHERE tenant_id = ? AND tipo = 'stripe.preco_desconhecido'").bind(t).first('n')).toBe(1);
    expect(planoDoPreco(env, 'price_p')).toBe('pagina');
    expect(planoDoPreco(env, null)).toBeNull();
  });

  it('assinatura incompleta não dá plano', async () => {
    const { t } = await veiculo();
    await enviar('customer.subscription.updated', assinatura(t, { status: 'incomplete' }));
    expect(await planoDe(t)).toBe('teste');
  });

  it('cancelamento volta para teste; cancelar uma assinatura antiga não mexe na atual', async () => {
    const { t } = await veiculo();
    await enviar('customer.subscription.updated', assinatura(t));
    await enviar('customer.subscription.deleted', assinatura(t, { id: 'sub_antiga' }));
    expect(await planoDe(t)).toBe('pagina');
    await enviar('customer.subscription.deleted', assinatura(t));
    expect(await planoDe(t)).toBe('teste');
    expect(await assinaturaDe(t)).toMatchObject({ status: 'canceled', atraso_desde: null });
  });

  it('cobrança falha marca o atraso uma vez; voltar a active limpa', async () => {
    const { t } = await veiculo();
    await enviar('customer.subscription.updated', assinatura(t));
    await enviar('invoice.payment_failed', { subscription: `sub_${t}` });
    const a = await assinaturaDe(t);
    expect(a).toMatchObject({ status: 'past_due' });
    expect(a?.atraso_desde).toBeTruthy();
    await env.DB.prepare("UPDATE assinaturas_plano SET atraso_desde = '2026-01-01 00:00:00' WHERE tenant_id = ?").bind(t).run();
    await enviar('invoice.payment_failed', { parent: { subscription_details: { subscription: `sub_${t}` } } });
    expect((await assinaturaDe(t))?.atraso_desde).toBe('2026-01-01 00:00:00');
    await enviar('customer.subscription.updated', assinatura(t, { status: 'past_due' }));
    expect((await assinaturaDe(t))?.atraso_desde).toBe('2026-01-01 00:00:00');
    await enviar('customer.subscription.updated', assinatura(t));
    expect((await assinaturaDe(t))?.atraso_desde).toBeNull();
  });

  it('assinatura de veículo que não existe não quebra o webhook', async () => {
    const r = await enviar('customer.subscription.updated', assinatura('nao-existe'));
    expect(r.status).toBe(200);
  });
});

describe('rotas da assinatura', () => {
  it('sem os segredos a aba diz, e as rotas respondem 503; o limite segue valendo', async () => {
    const { t, s } = await veiculo();
    vars.STRIPE_SECRET_KEY = undefined;
    const p = await (await req(`/api/t/${t}/plano`, { cookie: s.cookie })).json<{ cobranca: boolean; plano: string; limite: number; usados: number }>();
    expect(p).toMatchObject({ cobranca: false, plano: 'teste', limite: 0, usados: 0 });
    expect((await req(`/api/t/${t}/assinatura/checkout`, { cookie: s.cookie, body: { plano: 'pagina' } })).status).toBe(503);
    expect((await req(`/api/t/${t}/assinatura/portal`, { cookie: s.cookie, body: {} })).status).toBe(503);
  });

  it('checkout: subscription, cartão, o veículo em client_reference_id e o price vindo do servidor', async () => {
    const { t, s } = await veiculo();
    const f = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ url: 'https://checkout.example/x' }));
    const r = await req(`/api/t/${t}/assinatura/checkout`, { cookie: s.cookie, body: { plano: 'portal', price: 'price_de_graca' } });
    expect(await r.json()).toEqual({ url: 'https://checkout.example/x' });
    expect(String(f.mock.calls[0][0])).toBe('https://stripe.example/v1/checkout/sessions');
    const corpo = f.mock.calls[0][1]!.body as URLSearchParams;
    expect(corpo.get('mode')).toBe('subscription');
    expect(corpo.get('client_reference_id')).toBe(t);
    expect(corpo.get('line_items[0][price]')).toBe('price_q');
    expect(corpo.get('payment_method_types[0]')).toBe('card');
    expect((await req(`/api/t/${t}/assinatura/checkout`, { cookie: s.cookie, body: { plano: 'cortesia' } })).status).toBe(400);
  });

  it('já assinante vai para Gerenciar; o portal usa o cliente do veículo; Stripe fora dá 502', async () => {
    const { t, s } = await veiculo('pagina');
    expect((await req(`/api/t/${t}/assinatura/portal`, { cookie: s.cookie, body: {} })).status).toBe(404);
    await env.DB.prepare("INSERT INTO assinaturas_plano (tenant_id, plano, status, stripe_customer, stripe_subscription) VALUES (?, 'pagina', 'active', 'cus_a', 'sub_a')").bind(t).run();
    expect((await req(`/api/t/${t}/assinatura/checkout`, { cookie: s.cookie, body: { plano: 'portal' } })).status).toBe(409);
    const f = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => Response.json({ url: 'https://portal.example/x' }));
    expect(await (await req(`/api/t/${t}/assinatura/portal`, { cookie: s.cookie, body: {} })).json()).toEqual({ url: 'https://portal.example/x' });
    expect((f.mock.calls[0][1]!.body as URLSearchParams).get('customer')).toBe('cus_a');
    f.mockImplementationOnce(async () => new Response('fora', { status: 500 }));
    expect((await req(`/api/t/${t}/assinatura/portal`, { cookie: s.cookie, body: {} })).status).toBe(502);
  });

  it('IDOR e só admin', async () => {
    const { t, s } = await veiculo();
    const fora = await cadastrar('Fora');
    const ed = await cadastrar('Ed');
    await seedMembro(t, ed.userId, 'editor');
    const rotas: [string, unknown?][] = [['plano'], ['assinatura/checkout', { plano: 'pagina' }], ['assinatura/portal', {}]];
    for (const [rota, body] of rotas) {
      expect((await req(`/api/t/${t}/${rota}`, { cookie: fora.cookie, body })).status, rota).toBe(404);
      expect((await req(`/api/t/${t}/${rota}`, { cookie: ed.cookie, body })).status, rota).toBe(403);
    }
    expect((await req(`/api/t/${t}/plano`, { cookie: s.cookie })).status).toBe(200);
  });
});
