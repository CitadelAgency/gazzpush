// The outlet screen: accounts (list all, turn off/on again) and sources (list all, add RSS, pause/resume), with role and IDOR.
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { register, req, seedAccount, seedMember, seedTenant } from './helpers';

async function member(role: 'admin' | 'editor' | 'reporter' = 'admin') {
  const s = await register();
  const t = await seedTenant();
  await seedMember(t, s.userId, role);
  return { s, t };
}
const json = async <T,>(res: Response) => res.json<T>();

describe('accounts: list all, and turn off/on', () => {
  it('admin turns off (status removida), it disappears from the default list and comes back with ?todas=1; turns on again', async () => {
    const { s, t } = await member('admin');
    const account = await seedAccount(t, 'manual');
    const r1 = await req(`/api/t/${t}/contas/${account}`, { method: 'PATCH', cookie: s.cookie, body: { ativo: false } });
    expect(r1.status).toBe(200);
    expect(await json(r1)).toEqual({ id: account, status: 'removida' });
    const active = await json<{ contas: { id: string }[] }>(await req(`/api/t/${t}/contas`, { cookie: s.cookie }));
    expect(active.contas).toEqual([]);
    const all = await json<{ contas: { id: string; status: string }[] }>(await req(`/api/t/${t}/contas?todas=1`, { cookie: s.cookie }));
    expect(all.contas).toEqual([expect.objectContaining({ id: account, status: 'removida' })]);
    const r2 = await req(`/api/t/${t}/contas/${account}`, { method: 'PATCH', cookie: s.cookie, body: { ativo: true } });
    expect(await json(r2)).toEqual({ id: account, status: 'ativa' });
    expect((await req(`/api/t/${t}/contas/${account}`, { method: 'PATCH', cookie: s.cookie, body: { ativo: 'sim' } })).status).toBe(400);
  });
  it("editor doesn't turn off (403); another outlet's account: 404 and nothing changes", async () => {
    const { s, t } = await member('editor');
    const account = await seedAccount(t, 'manual');
    expect((await req(`/api/t/${t}/contas/${account}`, { method: 'PATCH', cookie: s.cookie, body: { ativo: false } })).status).toBe(403);
    const other = await member('admin');
    expect((await req(`/api/t/${other.t}/contas/${account}`, { method: 'PATCH', cookie: other.s.cookie, body: { ativo: false } })).status).toBe(404);
    const row = await env.DB.prepare('SELECT status FROM contas_sociais WHERE id = ?').bind(account).first<{ status: string }>();
    expect(row?.status).toBe('ativa');
  });
});

describe('sources: add RSS, pause/resume, list all', () => {
  it('admin adds (201), the same URL returns the existing one (200) without duplicating; bad URL and short name: 400', async () => {
    const { s, t } = await member('admin');
    const r1 = await req(`/api/t/${t}/fontes`, { cookie: s.cookie, body: { nome: 'Diário', url: ' https://diario.example/feed.xml ' } });
    expect(r1.status).toBe(201);
    const f = await json<{ id: string; url: string; existia: boolean }>(r1);
    expect(f).toMatchObject({ url: 'https://diario.example/feed.xml', ativo: true, existia: false });
    const r2 = await req(`/api/t/${t}/fontes`, { cookie: s.cookie, body: { nome: 'Outro nome', url: 'https://diario.example/feed.xml' } });
    expect(r2.status).toBe(200);
    expect(await json(r2)).toMatchObject({ id: f.id, nome: 'Diário', existia: true });
    // Two identical requests at the same time: a single source (unique index + ON CONFLICT).
    const url2 = 'https://corrida.example/feed';
    const [c1, c2] = await Promise.all([
      req(`/api/t/${t}/fontes`, { cookie: s.cookie, body: { nome: 'Corrida A', url: url2 } }),
      req(`/api/t/${t}/fontes`, { cookie: s.cookie, body: { nome: 'Corrida B', url: url2 } }),
    ]);
    expect([c1.status, c2.status].sort()).toEqual([200, 201]);
    expect((await json<{ id: string }>(c1)).id).toBe((await json<{ id: string }>(c2)).id);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM fontes WHERE tenant_id = ?').bind(t).first<{ n: number }>();
    expect(n?.n).toBe(2);
    const type = await env.DB.prepare('SELECT tipo, intervalo_min FROM fontes WHERE id = ?').bind(f.id).first<{ tipo: string; intervalo_min: number }>();
    expect(type).toEqual({ tipo: 'rss', intervalo_min: 30 });
    for (const body of [{ nome: 'X', url: 'https://a.b/c' }, { nome: 'Feed', url: 'ftp://a.b/c' }, { nome: 'Feed', url: 'javascript:alert(1)' }, { nome: 'Feed', url: 'diario.example' }, { nome: 'Feed' }]) {
      expect((await req(`/api/t/${t}/fontes`, { cookie: s.cookie, body })).status, JSON.stringify(body)).toBe(400);
    }
  });
  it('pausing removes it from the default list (stays in ?todas=1 as not collectable); resuming resets the failures', async () => {
    const { s, t } = await member('admin');
    const { id } = await json<{ id: string }>(await req(`/api/t/${t}/fontes`, { cookie: s.cookie, body: { nome: 'Diário', url: 'https://d.example/f' } }));
    await env.DB.prepare('UPDATE fontes SET falhas = 10 WHERE id = ?').bind(id).run();
    const p = await req(`/api/t/${t}/fontes/${id}`, { method: 'PATCH', cookie: s.cookie, body: { ativo: false } });
    expect(await json(p)).toEqual({ id, ativo: false });
    const fallback = await json<{ fontes: unknown[] }>(await req(`/api/t/${t}/fontes`, { cookie: s.cookie }));
    expect(fallback.fontes).toEqual([]);
    const all = await json<{ fontes: { id: string; ativo: boolean; coletavel: boolean; url: string }[] }>(await req(`/api/t/${t}/fontes?todas=1`, { cookie: s.cookie }));
    expect(all.fontes).toEqual([expect.objectContaining({ id, ativo: false, coletavel: false, url: 'https://d.example/f' })]);
    const r = await req(`/api/t/${t}/fontes/${id}`, { method: 'PATCH', cookie: s.cookie, body: { ativo: true } });
    expect(await json(r)).toEqual({ id, ativo: true });
    const row = await env.DB.prepare('SELECT ativo, falhas FROM fontes WHERE id = ?').bind(id).first<{ ativo: number; falhas: number }>();
    expect(row).toEqual({ ativo: 1, falhas: 0 });
  });
  it("editor and reporter can't add or pause (403); another outlet's source: 404; the manual one (report) can't be paused", async () => {
    const admin = await member('admin');
    const { id } = await json<{ id: string }>(await req(`/api/t/${admin.t}/fontes`, { cookie: admin.s.cookie, body: { nome: 'Diário', url: 'https://d.example/f' } }));
    for (const role of ['editor', 'reporter'] as const) {
      const other = await register();
      await seedMember(admin.t, other.userId, role);
      expect((await req(`/api/t/${admin.t}/fontes`, { cookie: other.cookie, body: { nome: 'Feed', url: 'https://x.example/f' } })).status).toBe(403);
      expect((await req(`/api/t/${admin.t}/fontes/${id}`, { method: 'PATCH', cookie: other.cookie, body: { ativo: false } })).status).toBe(403);
    }
    const b = await member('admin');
    expect((await req(`/api/t/${b.t}/fontes/${id}`, { method: 'PATCH', cookie: b.s.cookie, body: { ativo: false } })).status).toBe(404);
    const manual = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO fontes (id, tenant_id, tipo, nome) VALUES (?, ?, 'manual', 'Relato')").bind(manual, admin.t).run();
    expect((await req(`/api/t/${admin.t}/fontes/${manual}`, { method: 'PATCH', cookie: admin.s.cookie, body: { ativo: false } })).status).toBe(404);
    expect((await env.DB.prepare('SELECT ativo FROM fontes WHERE id = ?').bind(id).first<{ ativo: number }>())?.ativo).toBe(1);
  });
});

describe('team: members and invites', () => {
  it("whoever already has an account becomes a member right away; whoever doesn't stays in invites with the link; the list shows both (invites only for admin)", async () => {
    const { s, t } = await member('admin');
    const existing = await register('Ana');
    const r1 = await req(`/api/t/${t}/convites`, { cookie: s.cookie, body: { email: existing.email.toUpperCase(), papel: 'editor' } });
    expect(r1.status).toBe(201);
    expect(await json(r1)).toEqual({ membro: expect.objectContaining({ papel: 'editor', nome: 'Ana', email: existing.email }), convite: null });
    // Again: already a member.
    expect((await req(`/api/t/${t}/convites`, { cookie: s.cookie, body: { email: existing.email, papel: 'reporter' } })).status).toBe(409);

    const r2 = await req(`/api/t/${t}/convites`, { cookie: s.cookie, body: { email: 'Nova.Pessoa@Teste.dev', papel: 'reporter' } });
    expect(r2.status).toBe(201);
    const { convite: invite } = await json<{ convite: { id: string; email: string; papel: string; link: string } }>(r2);
    expect(invite).toMatchObject({ email: 'nova.pessoa@teste.dev', papel: 'reporter', link: `/entrar?convite=${invite.id}` });
    // The same email again only changes the pending invite's role, without duplicating.
    const r3 = await req(`/api/t/${t}/convites`, { cookie: s.cookie, body: { email: 'nova.pessoa@teste.dev', papel: 'editor' } });
    expect((await json<{ convite: { id: string; papel: string } }>(r3)).convite).toMatchObject({ id: invite.id, papel: 'editor' });

    const list = await json<{ membros: { email: string; papel: string }[]; convites: { id: string }[] }>(await req(`/api/t/${t}/membros`, { cookie: s.cookie }));
    expect(list.membros.map((m) => [m.email, m.papel])).toEqual([[s.email, 'admin'], [existing.email, 'editor']]);
    expect(list.convites.map((c) => c.id)).toEqual([invite.id]);
    // An editor sees the members, not the invites.
    const fromEditor = await json<{ membros: unknown[]; convites: unknown[] }>(await req(`/api/t/${t}/membros`, { cookie: existing.cookie }));
    expect(fromEditor.membros).toHaveLength(2);
    expect(fromEditor.convites).toEqual([]);
    // Without a session, the invite gives email, role and outlet (for the create-account screen).
    const pub = await req(`/api/convites/${invite.id}`, { cookie: undefined });
    expect(pub.status).toBe(200);
    expect(await json(pub)).toMatchObject({ email: 'nova.pessoa@teste.dev', papel: 'editor', slug: expect.any(String), aceito: false });
    expect((await req('/api/convites/nao-existe', {})).status).toBe(404);
    // Cancelar.
    expect((await req(`/api/t/${t}/convites/${invite.id}`, { method: 'DELETE', cookie: s.cookie })).status).toBe(200);
    expect((await req(`/api/convites/${invite.id}`, {})).status).toBe(404);
  });
  it("accepting requires a session, the link's id and the same email: registering the invited email alone gives no access", async () => {
    const a = await member('admin');
    const b = await member('admin');
    const email = `${crypto.randomUUID().slice(0, 8)}@teste.dev`;
    const { convite: ca } = await json<{ convite: { id: string } }>(await req(`/api/t/${a.t}/convites`, { cookie: a.s.cookie, body: { email, papel: 'editor' } }));
    const { convite: cb } = await json<{ convite: { id: string } }>(await req(`/api/t/${b.t}/convites`, { cookie: b.s.cookie, body: { email: email.toUpperCase(), papel: 'reporter' } }));
    // Sign-up with the invited email, without the link: no outlet.
    const created = await register('Convidada', email);
    let me = await json<{ tenants: { id: string; papel: string }[] }>(await req('/api/me', { cookie: created.cookie }));
    expect(me.tenants).toEqual([]);
    // No session: 401. With the link and the right email: joins with the invite's role; again is idempotent.
    expect((await req(`/api/convites/${ca.id}/aceitar`, { method: 'POST', body: {} })).status).toBe(401);
    const r1 = await req(`/api/convites/${ca.id}/aceitar`, { method: 'POST', cookie: created.cookie, body: {} });
    expect(r1.status).toBe(200);
    expect(await json(r1)).toMatchObject({ papel: 'editor', jaEra: false, slug: expect.any(String) });
    expect(await json(await req(`/api/convites/${ca.id}/aceitar`, { method: 'POST', cookie: created.cookie, body: {} }))).toMatchObject({ papel: 'editor', jaEra: true });
    // Another account with the link: 403 and nothing changes.
    const intruder = await register('Intrusa');
    expect((await req(`/api/convites/${cb.id}/aceitar`, { method: 'POST', cookie: intruder.cookie, body: {} })).status).toBe(403);
    expect((await json<{ tenants: unknown[] }>(await req('/api/me', { cookie: intruder.cookie }))).tenants).toEqual([]);
    expect((await json<{ tenants: unknown[] }>(await req('/api/me', { cookie: created.cookie }))).tenants).toHaveLength(1);
    // The second invite (another outlet), accepted by the invitee: two outlets; the invite leaves the pending ones.
    await req(`/api/convites/${cb.id}/aceitar`, { method: 'POST', cookie: created.cookie, body: {} });
    me = await json(await req('/api/me', { cookie: created.cookie }));
    expect(me.tenants.map((t) => [t.id, t.papel]).sort()).toEqual([[a.t, 'editor'], [b.t, 'reporter']].sort());
    const list = await json<{ convites: unknown[] }>(await req(`/api/t/${a.t}/membros`, { cookie: a.s.cookie }));
    expect(list.convites).toEqual([]);
    expect((await req(`/api/convites/${ca.id}`, {})).status).toBe(200);
    expect(await json(await req(`/api/convites/${ca.id}`, {}))).toMatchObject({ aceito: true });
    expect((await req('/api/convites/nao-existe/aceitar', { method: 'POST', cookie: created.cookie, body: {} })).status).toBe(404);
  });
  it("validates email and role (400); editor can't invite (403); IDOR on cancel (404)", async () => {
    const { s, t } = await member('admin');
    for (const body of [{ email: 'x', papel: 'editor' }, { email: 'a@b.c', papel: 'editor' }, { email: 'a@b.com', papel: 'admin' }, { papel: 'editor' }]) {
      expect((await req(`/api/t/${t}/convites`, { cookie: s.cookie, body })).status, JSON.stringify(body)).toBe(400);
    }
    const editor = await member('editor');
    expect((await req(`/api/t/${editor.t}/convites`, { cookie: editor.s.cookie, body: { email: 'a@b.com', papel: 'reporter' } })).status).toBe(403);
    const { convite: invite } = await json<{ convite: { id: string } }>(await req(`/api/t/${t}/convites`, { cookie: s.cookie, body: { email: 'c@d.com', papel: 'reporter' } }));
    const other = await member('admin');
    expect((await req(`/api/t/${other.t}/convites/${invite.id}`, { method: 'DELETE', cookie: other.s.cookie })).status).toBe(404);
    expect((await req(`/api/convites/${invite.id}`, {})).status).toBe(200);
  });
});
