import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { cadastrar, eventosDe, req, seedConta, seedMembro, seedPauta, seedPeca, seedTenant, statusDe, type Sessao } from './helpers';

describe('auth', () => {
  it('cadastro aberto devolve cookie httpOnly + SameSite=Lax e /api/me enxerga a sessão', async () => {
    const email = `${crypto.randomUUID().slice(0, 10)}@example.test`;
    const res = await req('/api/auth/sign-up/email', { body: { email, password: crypto.randomUUID(), name: 'Pessoa' } });
    expect(res.status).toBe(200);
    const setCookie = res.headers.getSetCookie().find((c) => c.includes('session_token'))!;
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

    const me = await req('/api/me', { cookie });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ user: { email, name: 'Pessoa' }, tenants: [] });
  });

  it('login por e-mail/senha abre sessão nova', async () => {
    const s = await cadastrar();
    const res = await req('/api/auth/sign-in/email', { body: { email: s.email, password: s.password } });
    expect(res.status).toBe(200);
    const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    expect((await req('/api/me', { cookie })).status).toBe(200);
  });

  it('sem sessão: 401 em toda a API', async () => {
    expect((await req('/api/me')).status).toBe(401);
    expect((await req('/api/tenants', { body: { nome: 'X' } })).status).toBe(401);
    expect((await req('/api/t/qualquer/pautas')).status).toBe(401);
  });

  it('CSRF: mutação com Origin de outro site → 403', async () => {
    const s = await cadastrar();
    const res = await req('/api/tenants', { cookie: s.cookie, body: { nome: 'Evil' }, origin: 'https://evil.example' });
    expect(res.status).toBe(403);
  });
});

describe('tenancy', () => {
  it('POST /api/tenants cria veículo com o usuário admin; /api/me lista', async () => {
    const s = await cadastrar();
    // modo local sem município: a triagem nunca acharia notícia da área
    expect((await req('/api/tenants', { cookie: s.cookie, body: { nome: 'Veículo Local' } })).status).toBe(400);
    const res = await req('/api/tenants', { cookie: s.cookie, body: { nome: 'Veículo Local', uf: 'SP', municipioIbge: '3518701', municipioNome: 'Guarujá' } });
    expect(res.status).toBe(201);
    const t = await res.json<{ id: string; slug: string; papel: string }>();
    expect(t).toMatchObject({ slug: 'veiculo-local', papel: 'admin' });
    const me = await (await req('/api/me', { cookie: s.cookie })).json<{ tenants: { id: string; papel: string }[] }>();
    expect(me.tenants).toEqual([expect.objectContaining({ id: t.id, papel: 'admin' })]);
    expect(await env.DB.prepare('SELECT municipio_ibge, municipio_nome, bairro FROM tenant_areas WHERE tenant_id = ?').bind(t.id).first())
      .toEqual({ municipio_ibge: '3518701', municipio_nome: 'Guarujá', bairro: null });
    // temático não precisa de área
    expect((await req('/api/tenants', { cookie: s.cookie, body: { nome: 'Tech Hoje', modo: 'tematico' } })).status).toBe(201);
    // slug único
    expect((await req('/api/tenants', { cookie: s.cookie, body: { nome: 'Outro', slug: 'veiculo-local', modo: 'tematico' } })).status).toBe(409);
  });

  it('papel: repórter lê, mas não revisa nem cadastra conta', async () => {
    const s = await cadastrar();
    const t = await seedTenant();
    await seedMembro(t, s.userId, 'reporter');
    const { pautaId } = await seedPauta(t, 'em_producao');
    const peca = await seedPeca(t, pautaId);
    expect((await req(`/api/t/${t}/pecas/${peca}`, { cookie: s.cookie })).status).toBe(200);
    expect((await req(`/api/t/${t}/pecas/${peca}/revisao`, { cookie: s.cookie, body: { decisao: 'rejeitar' } })).status).toBe(403);
    expect((await req(`/api/t/${t}/contas`, { cookie: s.cookie, body: { modo: 'manual' } })).status).toBe(403);
    expect(await statusDe('pecas', peca)).toBe('revisao');
  });
});

describe('IDOR: membro de A não enxerga nada de B', () => {
  let a: Sessao;
  let tA: string, tB: string;
  let pautaB: string, pecaB: string, pecaB2: string;

  beforeAll(async () => {
    a = await cadastrar('A');
    const b = await cadastrar('B');
    tA = await seedTenant('A');
    tB = await seedTenant('B');
    await seedMembro(tA, a.userId, 'admin');
    await seedMembro(tB, b.userId, 'admin');
    await seedConta(tB, 'manual');
    pautaB = (await seedPauta(tB)).pautaId;
    const pautaB2 = (await seedPauta(tB, 'em_producao')).pautaId;
    pecaB = await seedPeca(tB, pautaB2, { status: 'revisao' });
    pecaB2 = await seedPeca(tB, pautaB2, { status: 'aprovada', contaId: await seedConta(tB, 'manual') });
  });

  const rotas = () => [
    ['GET', `pautas`],
    ['POST', `pautas/${pautaB}/produzir`, { formato: 'post' }],
    ['GET', `pecas/${pecaB}`],
    ['GET', `pecas/${pecaB}/pacote`],
    ['GET', `pecas/${pecaB}/legenda.txt`],
    ['POST', `pecas/${pecaB}/revisao`, { decisao: 'rejeitar' }],
    ['POST', `pecas/${pecaB2}/publicada`, { url: 'https://instagram.com/p/x' }],
    ['POST', `contas`, { modo: 'manual' }],
    ['GET', `eventos`],
  ] as const;

  it('pelo tenant de B no path: 404 em tudo', async () => {
    for (const [method, rota, body] of rotas()) {
      const res = await req(`/api/t/${tB}/${rota}`, { method, cookie: a.cookie, body });
      expect(res.status, `${method} ${rota}`).toBe(404);
    }
  });

  it('pelo próprio tenant no path com id de recurso de B: 404', async () => {
    for (const [method, rota, body] of rotas().filter(([, r]) => r !== 'pautas' && r !== 'contas' && r !== 'eventos')) {
      const res = await req(`/api/t/${tA}/${rota}`, { method, cookie: a.cookie, body });
      expect(res.status, `${method} ${rota}`).toBe(404);
    }
  });

  it('nada de B mudou', async () => {
    expect(await statusDe('pautas', pautaB)).toBe('sugerida');
    expect(await statusDe('pecas', pecaB)).toBe('revisao');
    expect(await statusDe('pecas', pecaB2)).toBe('aprovada');
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM contas_sociais WHERE tenant_id = ?').bind(tB).first<{ n: number }>();
    expect(n?.n).toBe(2);
  });
});

describe('por = usuário da sessão', () => {
  it('campo por no body é ignorado: decisão e evento levam o id da sessão', async () => {
    const s = await cadastrar();
    const t = await seedTenant();
    await seedMembro(t, s.userId, 'editor');
    const { pautaId } = await seedPauta(t, 'em_producao');
    const peca = await seedPeca(t, pautaId);
    const res = await req(`/api/t/${t}/pecas/${peca}/revisao`, { cookie: s.cookie, body: { decisao: 'rejeitar', motivo: 'fora da pauta', por: 'falsificado' } });
    expect(res.status).toBe(200);
    const d = await env.DB.prepare('SELECT por FROM decisoes WHERE peca_id = ?').bind(peca).first<{ por: string }>();
    expect(d?.por).toBe(s.userId);
    const evs = await eventosDe(peca);
    expect(evs.map((e) => e.payload.por)).toEqual([s.userId]);
    expect((await eventosDe(pautaId)).map((e) => [e.tipo, e.payload.por])).toEqual([['pauta.descartada', s.userId]]);
  });
});

describe('admin da plataforma', () => {
  it('e-mail não dá acesso (cadastro não verifica e-mail); só user.id em ADMIN_USER_IDS', async () => {
    const s = await cadastrar();
    const res = await req('/api/admin/ai-licenca', { cookie: s.cookie, body: { modelo: 'x' } });
    expect(res.status).toBe(404);
  });
});
