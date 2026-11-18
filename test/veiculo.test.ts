// Tela do veículo: contas (listar todas, desligar/religar) e fontes (listar todas, adicionar RSS, pausar/retomar),
// com papel e IDOR.
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { cadastrar, req, seedConta, seedMembro, seedTenant } from './helpers';

async function membro(papel: 'admin' | 'editor' | 'reporter' = 'admin') {
  const s = await cadastrar();
  const t = await seedTenant();
  await seedMembro(t, s.userId, papel);
  return { s, t };
}
const json = async <T,>(res: Response) => res.json<T>();

describe('contas: listar todas e desligar/religar', () => {
  it('admin desliga (status removida), some da lista padrão e volta com ?todas=1; religa', async () => {
    const { s, t } = await membro('admin');
    const conta = await seedConta(t, 'manual');
    const r1 = await req(`/api/t/${t}/contas/${conta}`, { method: 'PATCH', cookie: s.cookie, body: { ativo: false } });
    expect(r1.status).toBe(200);
    expect(await json(r1)).toEqual({ id: conta, status: 'removida' });
    const ativas = await json<{ contas: { id: string }[] }>(await req(`/api/t/${t}/contas`, { cookie: s.cookie }));
    expect(ativas.contas).toEqual([]);
    const todas = await json<{ contas: { id: string; status: string }[] }>(await req(`/api/t/${t}/contas?todas=1`, { cookie: s.cookie }));
    expect(todas.contas).toEqual([expect.objectContaining({ id: conta, status: 'removida' })]);
    const r2 = await req(`/api/t/${t}/contas/${conta}`, { method: 'PATCH', cookie: s.cookie, body: { ativo: true } });
    expect(await json(r2)).toEqual({ id: conta, status: 'ativa' });
    expect((await req(`/api/t/${t}/contas/${conta}`, { method: 'PATCH', cookie: s.cookie, body: { ativo: 'sim' } })).status).toBe(400);
  });
  it('editor não desliga (403); conta de outro veículo: 404 e nada muda', async () => {
    const { s, t } = await membro('editor');
    const conta = await seedConta(t, 'manual');
    expect((await req(`/api/t/${t}/contas/${conta}`, { method: 'PATCH', cookie: s.cookie, body: { ativo: false } })).status).toBe(403);
    const outro = await membro('admin');
    expect((await req(`/api/t/${outro.t}/contas/${conta}`, { method: 'PATCH', cookie: outro.s.cookie, body: { ativo: false } })).status).toBe(404);
    const row = await env.DB.prepare('SELECT status FROM contas_sociais WHERE id = ?').bind(conta).first<{ status: string }>();
    expect(row?.status).toBe('ativa');
  });
});

describe('fontes: adicionar RSS, pausar/retomar, listar todas', () => {
  it('admin adiciona (201), a mesma URL devolve a existente (200) sem duplicar; URL ruim e nome curto: 400', async () => {
    const { s, t } = await membro('admin');
    const r1 = await req(`/api/t/${t}/fontes`, { cookie: s.cookie, body: { nome: 'Diário', url: ' https://diario.example/feed.xml ' } });
    expect(r1.status).toBe(201);
    const f = await json<{ id: string; url: string; existia: boolean }>(r1);
    expect(f).toMatchObject({ url: 'https://diario.example/feed.xml', ativo: true, existia: false });
    const r2 = await req(`/api/t/${t}/fontes`, { cookie: s.cookie, body: { nome: 'Outro nome', url: 'https://diario.example/feed.xml' } });
    expect(r2.status).toBe(200);
    expect(await json(r2)).toMatchObject({ id: f.id, nome: 'Diário', existia: true });
    // Dois pedidos iguais ao mesmo tempo: uma fonte só (índice único + ON CONFLICT).
    const url2 = 'https://corrida.example/feed';
    const [c1, c2] = await Promise.all([
      req(`/api/t/${t}/fontes`, { cookie: s.cookie, body: { nome: 'Corrida A', url: url2 } }),
      req(`/api/t/${t}/fontes`, { cookie: s.cookie, body: { nome: 'Corrida B', url: url2 } }),
    ]);
    expect([c1.status, c2.status].sort()).toEqual([200, 201]);
    expect((await json<{ id: string }>(c1)).id).toBe((await json<{ id: string }>(c2)).id);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM fontes WHERE tenant_id = ?').bind(t).first<{ n: number }>();
    expect(n?.n).toBe(2);
    const tipo = await env.DB.prepare('SELECT tipo, intervalo_min FROM fontes WHERE id = ?').bind(f.id).first<{ tipo: string; intervalo_min: number }>();
    expect(tipo).toEqual({ tipo: 'rss', intervalo_min: 30 });
    for (const body of [{ nome: 'X', url: 'https://a.b/c' }, { nome: 'Feed', url: 'ftp://a.b/c' }, { nome: 'Feed', url: 'javascript:alert(1)' }, { nome: 'Feed', url: 'diario.example' }, { nome: 'Feed' }]) {
      expect((await req(`/api/t/${t}/fontes`, { cookie: s.cookie, body })).status, JSON.stringify(body)).toBe(400);
    }
  });
  it('pausar tira da lista padrão (fica em ?todas=1 como não coletável); retomar zera as falhas', async () => {
    const { s, t } = await membro('admin');
    const { id } = await json<{ id: string }>(await req(`/api/t/${t}/fontes`, { cookie: s.cookie, body: { nome: 'Diário', url: 'https://d.example/f' } }));
    await env.DB.prepare('UPDATE fontes SET falhas = 10 WHERE id = ?').bind(id).run();
    const p = await req(`/api/t/${t}/fontes/${id}`, { method: 'PATCH', cookie: s.cookie, body: { ativo: false } });
    expect(await json(p)).toEqual({ id, ativo: false });
    const padrao = await json<{ fontes: unknown[] }>(await req(`/api/t/${t}/fontes`, { cookie: s.cookie }));
    expect(padrao.fontes).toEqual([]);
    const todas = await json<{ fontes: { id: string; ativo: boolean; coletavel: boolean; url: string }[] }>(await req(`/api/t/${t}/fontes?todas=1`, { cookie: s.cookie }));
    expect(todas.fontes).toEqual([expect.objectContaining({ id, ativo: false, coletavel: false, url: 'https://d.example/f' })]);
    const r = await req(`/api/t/${t}/fontes/${id}`, { method: 'PATCH', cookie: s.cookie, body: { ativo: true } });
    expect(await json(r)).toEqual({ id, ativo: true });
    const row = await env.DB.prepare('SELECT ativo, falhas FROM fontes WHERE id = ?').bind(id).first<{ ativo: number; falhas: number }>();
    expect(row).toEqual({ ativo: 1, falhas: 0 });
  });
  it('editor e repórter não adicionam nem pausam (403); fonte de outro veículo: 404; a manual (relato) não pausa', async () => {
    const admin = await membro('admin');
    const { id } = await json<{ id: string }>(await req(`/api/t/${admin.t}/fontes`, { cookie: admin.s.cookie, body: { nome: 'Diário', url: 'https://d.example/f' } }));
    for (const papel of ['editor', 'reporter'] as const) {
      const outro = await cadastrar();
      await seedMembro(admin.t, outro.userId, papel);
      expect((await req(`/api/t/${admin.t}/fontes`, { cookie: outro.cookie, body: { nome: 'Feed', url: 'https://x.example/f' } })).status).toBe(403);
      expect((await req(`/api/t/${admin.t}/fontes/${id}`, { method: 'PATCH', cookie: outro.cookie, body: { ativo: false } })).status).toBe(403);
    }
    const b = await membro('admin');
    expect((await req(`/api/t/${b.t}/fontes/${id}`, { method: 'PATCH', cookie: b.s.cookie, body: { ativo: false } })).status).toBe(404);
    const manual = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO fontes (id, tenant_id, tipo, nome) VALUES (?, ?, 'manual', 'Relato')").bind(manual, admin.t).run();
    expect((await req(`/api/t/${admin.t}/fontes/${manual}`, { method: 'PATCH', cookie: admin.s.cookie, body: { ativo: false } })).status).toBe(404);
    expect((await env.DB.prepare('SELECT ativo FROM fontes WHERE id = ?').bind(id).first<{ ativo: number }>())?.ativo).toBe(1);
  });
});

describe('equipe: membros e convites', () => {
  it('quem já tem conta vira membro na hora; quem não tem fica em convites com o link; a lista mostra os dois (convites só para admin)', async () => {
    const { s, t } = await membro('admin');
    const existente = await cadastrar('Pessoa');
    const r1 = await req(`/api/t/${t}/convites`, { cookie: s.cookie, body: { email: existente.email.toUpperCase(), papel: 'editor' } });
    expect(r1.status).toBe(201);
    expect(await json(r1)).toEqual({ membro: expect.objectContaining({ papel: 'editor', nome: 'Pessoa', email: existente.email }), convite: null });
    // De novo: já é membro.
    expect((await req(`/api/t/${t}/convites`, { cookie: s.cookie, body: { email: existente.email, papel: 'reporter' } })).status).toBe(409);

    const r2 = await req(`/api/t/${t}/convites`, { cookie: s.cookie, body: { email: 'Contato.Novo@Example.Test', papel: 'reporter' } });
    expect(r2.status).toBe(201);
    const { convite } = await json<{ convite: { id: string; email: string; papel: string; link: string } }>(r2);
    expect(convite).toMatchObject({ email: 'contato.novo@example.test', papel: 'reporter', link: `/entrar?convite=${convite.id}` });
    // O mesmo e-mail de novo só muda o papel do convite pendente, sem duplicar.
    const r3 = await req(`/api/t/${t}/convites`, { cookie: s.cookie, body: { email: 'contato.novo@example.test', papel: 'editor' } });
    expect((await json<{ convite: { id: string; papel: string } }>(r3)).convite).toMatchObject({ id: convite.id, papel: 'editor' });

    const lista = await json<{ membros: { email: string; papel: string }[]; convites: { id: string }[] }>(await req(`/api/t/${t}/membros`, { cookie: s.cookie }));
    expect(lista.membros.map((m) => [m.email, m.papel])).toEqual([[s.email, 'admin'], [existente.email, 'editor']]);
    expect(lista.convites.map((c) => c.id)).toEqual([convite.id]);
    // Editor vê os membros, não os convites.
    const doEditor = await json<{ membros: unknown[]; convites: unknown[] }>(await req(`/api/t/${t}/membros`, { cookie: existente.cookie }));
    expect(doEditor.membros).toHaveLength(2);
    expect(doEditor.convites).toEqual([]);
    // Sem sessão, o convite diz e-mail, papel e veículo (para a tela de criar conta).
    const pub = await req(`/api/convites/${convite.id}`, { cookie: undefined });
    expect(pub.status).toBe(200);
    expect(await json(pub)).toMatchObject({ email: 'contato.novo@example.test', papel: 'editor', slug: expect.any(String), aceito: false });
    expect((await req('/api/convites/nao-existe', {})).status).toBe(404);
    // Cancelar.
    expect((await req(`/api/t/${t}/convites/${convite.id}`, { method: 'DELETE', cookie: s.cookie })).status).toBe(200);
    expect((await req(`/api/convites/${convite.id}`, {})).status).toBe(404);
  });
  it('aceitar exige sessão, o id do link e o e-mail igual: só registrar o e-mail convidado não dá acesso', async () => {
    const a = await membro('admin');
    const b = await membro('admin');
    const email = `${crypto.randomUUID().slice(0, 8)}@example.test`;
    const { convite: ca } = await json<{ convite: { id: string } }>(await req(`/api/t/${a.t}/convites`, { cookie: a.s.cookie, body: { email, papel: 'editor' } }));
    const { convite: cb } = await json<{ convite: { id: string } }>(await req(`/api/t/${b.t}/convites`, { cookie: b.s.cookie, body: { email: email.toUpperCase(), papel: 'reporter' } }));
    // Cadastro com o e-mail convidado, sem o link: nenhum veículo.
    const nova = await cadastrar('Convidada', email);
    let me = await json<{ tenants: { id: string; papel: string }[] }>(await req('/api/me', { cookie: nova.cookie }));
    expect(me.tenants).toEqual([]);
    // Sem sessão: 401. Com o link e o e-mail certo: entra com o papel do convite; de novo é idempotente.
    expect((await req(`/api/convites/${ca.id}/aceitar`, { method: 'POST', body: {} })).status).toBe(401);
    const r1 = await req(`/api/convites/${ca.id}/aceitar`, { method: 'POST', cookie: nova.cookie, body: {} });
    expect(r1.status).toBe(200);
    expect(await json(r1)).toMatchObject({ papel: 'editor', jaEra: false, slug: expect.any(String) });
    expect(await json(await req(`/api/convites/${ca.id}/aceitar`, { method: 'POST', cookie: nova.cookie, body: {} }))).toMatchObject({ papel: 'editor', jaEra: true });
    // Outra conta com o link: 403 e nada muda.
    const intrusa = await cadastrar('Intrusa');
    expect((await req(`/api/convites/${cb.id}/aceitar`, { method: 'POST', cookie: intrusa.cookie, body: {} })).status).toBe(403);
    expect((await json<{ tenants: unknown[] }>(await req('/api/me', { cookie: intrusa.cookie }))).tenants).toEqual([]);
    expect((await json<{ tenants: unknown[] }>(await req('/api/me', { cookie: nova.cookie }))).tenants).toHaveLength(1);
    // O segundo convite (outro veículo), aceito pela convidada: dois veículos; o convite some dos pendentes.
    await req(`/api/convites/${cb.id}/aceitar`, { method: 'POST', cookie: nova.cookie, body: {} });
    me = await json(await req('/api/me', { cookie: nova.cookie }));
    expect(me.tenants.map((t) => [t.id, t.papel]).sort()).toEqual([[a.t, 'editor'], [b.t, 'reporter']].sort());
    const lista = await json<{ convites: unknown[] }>(await req(`/api/t/${a.t}/membros`, { cookie: a.s.cookie }));
    expect(lista.convites).toEqual([]);
    expect((await req(`/api/convites/${ca.id}`, {})).status).toBe(200);
    expect(await json(await req(`/api/convites/${ca.id}`, {}))).toMatchObject({ aceito: true });
    expect((await req('/api/convites/nao-existe/aceitar', { method: 'POST', cookie: nova.cookie, body: {} })).status).toBe(404);
  });
  it('valida e-mail e papel (400); editor não convida (403); IDOR no cancelar (404)', async () => {
    const { s, t } = await membro('admin');
    for (const body of [{ email: 'x', papel: 'editor' }, { email: 'a@b.c', papel: 'editor' }, { email: 'a@example.test', papel: 'admin' }, { papel: 'editor' }]) {
      expect((await req(`/api/t/${t}/convites`, { cookie: s.cookie, body })).status, JSON.stringify(body)).toBe(400);
    }
    const editor = await membro('editor');
    expect((await req(`/api/t/${editor.t}/convites`, { cookie: editor.s.cookie, body: { email: 'a@example.test', papel: 'reporter' } })).status).toBe(403);
    const { convite } = await json<{ convite: { id: string } }>(await req(`/api/t/${t}/convites`, { cookie: s.cookie, body: { email: 'c@example.test', papel: 'reporter' } }));
    const outro = await membro('admin');
    expect((await req(`/api/t/${outro.t}/convites/${convite.id}`, { method: 'DELETE', cookie: outro.s.cookie })).status).toBe(404);
    expect((await req(`/api/convites/${convite.id}`, {})).status).toBe(200);
  });
});
