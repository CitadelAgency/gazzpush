import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { register, eventsOf, req, seedAccount, seedMember, seedLead, seedPiece, seedTenant, statusOf, type Session } from './helpers';

describe('auth', () => {
  it('open signup returns an httpOnly + SameSite=Lax cookie and /api/me sees the session', async () => {
    const email = `${crypto.randomUUID().slice(0, 10)}@teste.dev`;
    const res = await req('/api/auth/sign-up/email', { body: { email, password: 'senha-forte-123', name: 'Ana' } });
    expect(res.status).toBe(200);
    const setCookie = res.headers.getSetCookie().find((c) => c.includes('session_token'))!;
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

    const me = await req('/api/me', { cookie });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ user: { email, name: 'Ana' }, tenants: [] });
  });

  it('email/password login opens a new session', async () => {
    const s = await register();
    const res = await req('/api/auth/sign-in/email', { body: { email: s.email, password: 'senha-forte-123' } });
    expect(res.status).toBe(200);
    const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    expect((await req('/api/me', { cookie })).status).toBe(200);
  });

  it('no session: 401 across the whole API', async () => {
    expect((await req('/api/me')).status).toBe(401);
    expect((await req('/api/tenants', { body: { nome: 'X' } })).status).toBe(401);
    expect((await req('/api/t/qualquer/pautas')).status).toBe(401);
  });

  it('CSRF: mutation with Origin from another site → 403', async () => {
    const s = await register();
    const res = await req('/api/tenants', { cookie: s.cookie, body: { nome: 'Evil' }, origin: 'https://evil.example' });
    expect(res.status).toBe(403);
  });
});

describe('tenancy', () => {
  it('POST /api/tenants creates an outlet with the admin user; /api/me lists it', async () => {
    const s = await register();
    // local mode without a municipality: triage would never find news from the area
    expect((await req('/api/tenants', { cookie: s.cookie, body: { nome: 'Folha do Bairro' } })).status).toBe(400);
    const res = await req('/api/tenants', { cookie: s.cookie, body: { nome: 'Folha do Bairro', uf: 'SP', municipioIbge: '3518701', municipioNome: 'Guarujá' } });
    expect(res.status).toBe(201);
    const t = await res.json<{ id: string; slug: string; papel: string }>();
    expect(t).toMatchObject({ slug: 'folha-do-bairro', papel: 'admin' });
    const me = await (await req('/api/me', { cookie: s.cookie })).json<{ tenants: { id: string; papel: string }[] }>();
    expect(me.tenants).toEqual([expect.objectContaining({ id: t.id, papel: 'admin' })]);
    expect(await env.DB.prepare('SELECT municipio_ibge, municipio_nome, bairro FROM tenant_areas WHERE tenant_id = ?').bind(t.id).first())
      .toEqual({ municipio_ibge: '3518701', municipio_nome: 'Guarujá', bairro: null });
    // topical needs no area
    expect((await req('/api/tenants', { cookie: s.cookie, body: { nome: 'Tech Hoje', modo: 'tematico' } })).status).toBe(201);
    // unique slug
    expect((await req('/api/tenants', { cookie: s.cookie, body: { nome: 'Outro', slug: 'folha-do-bairro', modo: 'tematico' } })).status).toBe(409);
  });

  it("role: reporter reads, but doesn't review or register an account", async () => {
    const s = await register();
    const t = await seedTenant();
    await seedMember(t, s.userId, 'reporter');
    const { pautaId: leadId } = await seedLead(t, 'em_producao');
    const piece = await seedPiece(t, leadId);
    expect((await req(`/api/t/${t}/pecas/${piece}`, { cookie: s.cookie })).status).toBe(200);
    expect((await req(`/api/t/${t}/pecas/${piece}/revisao`, { cookie: s.cookie, body: { decisao: 'rejeitar' } })).status).toBe(403);
    expect((await req(`/api/t/${t}/contas`, { cookie: s.cookie, body: { modo: 'manual' } })).status).toBe(403);
    expect(await statusOf('pecas', piece)).toBe('revisao');
  });
});

describe('IDOR: member of A sees nothing of B', () => {
  let a: Session;
  let t: string, tB: string;
  let leadB: string, pieceB: string, pieceB2: string;

  beforeAll(async () => {
    a = await register('A');
    const b = await register('B');
    t = await seedTenant('A');
    tB = await seedTenant('B');
    await seedMember(t, a.userId, 'admin');
    await seedMember(tB, b.userId, 'admin');
    await seedAccount(tB, 'manual');
    leadB = (await seedLead(tB)).pautaId;
    const leadB2 = (await seedLead(tB, 'em_producao')).pautaId;
    pieceB = await seedPiece(tB, leadB2, { status: 'revisao' });
    pieceB2 = await seedPiece(tB, leadB2, { status: 'aprovada', contaId: await seedAccount(tB, 'manual') });
  });

  const routes = () => [
    ['GET', `pautas`],
    ['POST', `pautas/${leadB}/produzir`, { formato: 'post' }],
    ['GET', `pecas/${pieceB}`],
    ['GET', `pecas/${pieceB}/pacote`],
    ['GET', `pecas/${pieceB}/legenda.txt`],
    ['POST', `pecas/${pieceB}/revisao`, { decisao: 'rejeitar' }],
    ['POST', `pecas/${pieceB2}/publicada`, { url: 'https://instagram.com/p/x' }],
    ['POST', `contas`, { modo: 'manual' }],
    ['GET', `eventos`],
  ] as const;

  it("via B's tenant in the path: 404 on everything", async () => {
    for (const [method, route, body] of routes()) {
      const res = await req(`/api/t/${tB}/${route}`, { method, cookie: a.cookie, body });
      expect(res.status, `${method} ${route}`).toBe(404);
    }
  });

  it("via own tenant in the path with B's resource id: 404", async () => {
    for (const [method, route, body] of routes().filter(([, r]) => r !== 'pautas' && r !== 'contas' && r !== 'eventos')) {
      const res = await req(`/api/t/${t}/${route}`, { method, cookie: a.cookie, body });
      expect(res.status, `${method} ${route}`).toBe(404);
    }
  });

  it('nothing of B changed', async () => {
    expect(await statusOf('pautas', leadB)).toBe('sugerida');
    expect(await statusOf('pecas', pieceB)).toBe('revisao');
    expect(await statusOf('pecas', pieceB2)).toBe('aprovada');
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM contas_sociais WHERE tenant_id = ?').bind(tB).first<{ n: number }>();
    expect(n?.n).toBe(2);
  });
});

describe('por = session user', () => {
  it('por field in the body is ignored: decision and event carry the session id', async () => {
    const s = await register();
    const t = await seedTenant();
    await seedMember(t, s.userId, 'editor');
    const { pautaId: leadId } = await seedLead(t, 'em_producao');
    const piece = await seedPiece(t, leadId);
    const res = await req(`/api/t/${t}/pecas/${piece}/revisao`, { cookie: s.cookie, body: { decisao: 'rejeitar', motivo: 'fora da pauta', por: 'falsificado' } });
    expect(res.status).toBe(200);
    const d = await env.DB.prepare('SELECT por FROM decisoes WHERE peca_id = ?').bind(piece).first<{ por: string }>();
    expect(d?.por).toBe(s.userId);
    const evs = await eventsOf(piece);
    expect(evs.map((e) => e.payload.por)).toEqual([s.userId]);
    expect((await eventsOf(leadId)).map((e) => [e.tipo, e.payload.por])).toEqual([['pauta.descartada', s.userId]]);
  });
});

describe('platform admin', () => {
  it("email doesn't grant access (signup doesn't verify email); only user.id in ADMIN_USER_IDS", async () => {
    const s = await register();
    const res = await req('/api/admin/ai-licenca', { cookie: s.cookie, body: { modelo: 'x' } });
    expect(res.status).toBe(404);
  });
});
