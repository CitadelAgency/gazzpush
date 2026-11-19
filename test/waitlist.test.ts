// Waitlist: public, without an account. It must not reveal who is already on it, store the IP, or fill up through abuse.
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { HOURLY_LIMIT, readSignup } from '../src/lib/waitlist';
import { PLANOS } from '../src/lib/plans';
import { PLANS as TABELA } from '../src/lib/plansTable';
import { req } from './helpers';

const IP = '203.0.113.7';
const register = (body: unknown, ip = IP, headers: Record<string, string> = {}, origin?: string) =>
  req('/api/lista-espera', { method: 'POST', body, origin, headers: { 'cf-connecting-ip': ip, ...headers } });
const lines = () => env.DB.prepare('SELECT * FROM lista_espera ORDER BY email').all<Record<string, string | null>>().then((r) => r.results);

beforeEach(async () => { await env.DB.prepare('DELETE FROM lista_espera').run(); });

describe('POST /api/lista-espera', () => {
  it("stores without a session, with a cleaned email, and doesn't store the IP", async () => {
    const r = await register({ email: '  Maria@Exemplo.COM ', nome: ' Maria ', plano: 'pagina' }, IP, { 'x-idioma': 'en' });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    const [l] = await lines();
    expect(l).toMatchObject({ email: 'maria@exemplo.com', nome: 'Maria', plano: 'pagina', idioma: 'en' });
    expect(JSON.stringify(l)).not.toContain(IP);
  });

  it('repeated email: same response, first signup not replaced', async () => {
    const a = await register({ email: 'a@exemplo.com', plano: 'portal' });
    const b = await register({ email: 'A@exemplo.com', plano: 'pagina' });
    expect([b.status, await b.json()]).toEqual([a.status, await a.json()]);
    expect(await lines()).toHaveLength(1);
    expect((await lines())[0].plano).toBe('portal');
  });

  it('name and plan are optional; only a paid plan gets chosen', async () => {
    await register({ email: 'a@exemplo.com', nome: '', plano: '' });
    await register({ email: 'b@exemplo.com', plano: 'cortesia' });
    await register({ email: 'c@exemplo.com', plano: 'teste' });
    expect((await lines()).map((l) => [l.nome, l.plano])).toEqual([[null, null], [null, null], [null, null]]);
  });

  it.each([['sem e-mail', {}], ['sem domínio', { email: 'a@b' }], ['com espaço', { email: 'a b@c.com' }], ['longo demais', { email: `${'a'.repeat(250)}@b.com` }], ['tipo errado', { email: 5 }], ['corpo que não é objeto', 'x']])('refuses %s', async (_, body) => {
    const r = await register(body);
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ erro: 'Confira o e-mail: ele parece incompleto.' });
    expect(await lines()).toHaveLength(0);
  });

  it("malformed JSON doesn't break the route", async () => {
    const r = await req('/api/lista-espera', { cru: { corpo: '{', tipo: 'application/json' } });
    expect(r.status).toBe(400);
  });

  it("the error message follows the screen's language", async () => {
    const r = await register({}, IP, { 'x-idioma': 'en' });
    expect(await r.json()).toEqual({ erro: 'Check the email: it looks incomplete.' });
  });

  it('honeypot filled: usual response, nothing stored', async () => {
    const r = await register({ email: 'robo@exemplo.com', site: 'https://spam.example' });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(await lines()).toHaveLength(0);
  });

  it("another origin doesn't get in", async () => {
    const r = await register({ email: 'a@exemplo.com' }, IP, {}, 'https://outro.site');
    expect(r.status).toBe(403);
    expect(await lines()).toHaveLength(0);
  });

  it('the limit is per IP, and the neighbouring IP keeps getting in', async () => {
    for (let i = 0; i < HOURLY_LIMIT; i++) expect((await register({ email: `p${i}@exemplo.com` })).status).toBe(200);
    expect((await register({ email: 'mais@exemplo.com' })).status).toBe(429);
    expect((await register({ email: 'vizinho@exemplo.com' }, '203.0.113.8')).status).toBe(200);
    expect(await lines()).toHaveLength(HOURLY_LIMIT + 1);
  });

  it('after one hour, the limit resets', async () => {
    for (let i = 0; i < HOURLY_LIMIT; i++) await register({ email: `p${i}@exemplo.com` });
    await env.DB.prepare("UPDATE lista_espera SET created_at = datetime('now', '-61 minutes')").run();
    expect((await register({ email: 'depois@exemplo.com' })).status).toBe(200);
  });
});

describe('price table', () => {
  it('planos.ts and the public page table are the same object', () => {
    expect(PLANOS).toBe(TABELA);
  });

  it('a long name is cut, not refused', () => {
    expect(readSignup({ email: 'a@exemplo.com', nome: 'x'.repeat(200) })?.nome).toHaveLength(80);
  });
});
