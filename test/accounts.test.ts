// Accounts that post by themselves: POST contas with real mode (Instagram direct) and intermediary (Ayrshare), the
// secret encrypted and never returned; the Ayrshare adapter with a fake fetch (success, 4xx → publication failed, key kept out of events).
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { loadAccount, publish } from '../src/lib/publish';
import { failPublication } from '../src/workflows/publishing';
import { register, req, seedMember, seedLead, seedPiece, seedTenant } from './helpers';

const KEY = 'AYR-chave-secreta-123456';
const TOKEN_IG = 'EAAG-token-secreto-987654';

async function member(role: 'admin' | 'editor' | 'reporter' = 'admin') {
  const s = await register();
  const t = await seedTenant();
  await seedMember(t, s.userId, role);
  return { s, t };
}
const accounts = (t: string, cookie: string, body: unknown) => req(`/api/t/${t}/contas`, { cookie, body });
const allTenant = async (t: string) => {
  const [c, e, p] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM contas_sociais WHERE tenant_id = ?').bind(t),
    env.DB.prepare('SELECT * FROM eventos WHERE tenant_id = ?').bind(t),
    env.DB.prepare('SELECT * FROM publicacoes WHERE tenant_id = ?').bind(t),
  ]);
  return { contas: JSON.stringify(c.results), eventos: JSON.stringify(e.results), publicacoes: JSON.stringify(p.results) };
};

describe('POST contas: modes that post on their own', () => {
  it('admin turns on direct Instagram and Ayrshare; the secret is encrypted and no response returns it', async () => {
    const { s, t } = await member();
    const r1 = await accounts(t, s.cookie, { nome: '@direto', modo: 'real', externalId: '17841400000000000', token: ` ${TOKEN_IG} ` });
    expect(r1.status).toBe(201);
    const r2 = await accounts(t, s.cookie, { nome: '@ayr', modo: 'intermediario', provedor: 'ayrshare', token: KEY, provedorRef: 'PERFIL-1' });
    expect(r2.status).toBe(201);
    const texts = [await r1.text(), await r2.text(), await (await req(`/api/t/${t}/contas?todas=1`, { cookie: s.cookie })).text()];
    for (const x of texts) { expect(x).not.toContain(TOKEN_IG); expect(x).not.toContain(KEY); expect(x).not.toContain('PERFIL-1'); }
    const list = JSON.parse(texts[2]).contas as Record<string, unknown>[];
    expect(list.map((c) => [c.nome, c.modo, c.provedor])).toEqual([['@direto', 'real', null], ['@ayr', 'intermediario', 'ayrshare']]);
    const db = await allTenant(t);
    expect(db.contas).not.toContain(TOKEN_IG);
    expect(db.contas).not.toContain(KEY);
    const ayr = await loadAccount(env, t, JSON.parse(texts[1]).id);
    expect(ayr).toMatchObject({ modo: 'intermediario', provedor: 'ayrshare', provedor_ref: 'PERFIL-1' });
  });

  it('validation: real without token, non-numeric id; intermediario without key or with a provider without adapter → 400', async () => {
    const { s, t } = await member();
    for (const body of [
      { nome: '@x', modo: 'real', externalId: '17841400000000000' },
      { nome: '@x', modo: 'real', externalId: 'abc', token: 'x' },
      { nome: '@x', modo: 'intermediario', provedor: 'ayrshare' },
      { nome: '@x', modo: 'intermediario', provedor: 'postpeer', token: 'x' },
      { nome: '@x', modo: 'intermediario', token: 'x' },
      { nome: '@x', modo: 'intermediario', provedor: 'ayrshare', token: '   ' },
      { nome: '@x', modo: 'manual', token: 123 },
    ]) expect((await accounts(t, s.cookie, body)).status, JSON.stringify(body)).toBe(400);
  });

  it("editor and reporter can't turn on (403); another outlet: 404", async () => {
    const { t } = await member();
    for (const role of ['editor', 'reporter'] as const) {
      const o = await register();
      await seedMember(t, o.userId, role);
      expect((await accounts(t, o.cookie, { nome: '@x', modo: 'intermediario', provedor: 'ayrshare', token: KEY })).status).toBe(403);
    }
    const b = await member();
    expect((await accounts(t, b.s.cookie, { nome: '@x', modo: 'manual' })).status).toBe(404);
  });
});

describe('publish: Ayrshare adapter', () => {
  async function scenario() {
    const { s, t } = await member();
    const { pautaId: leadId } = await seedLead(t, 'em_producao');
    const pieceId = await seedPiece(t, leadId, { status: 'aprovada' });
    const { id } = await (await accounts(t, s.cookie, { nome: '@ayr', modo: 'intermediario', provedor: 'ayrshare', token: KEY, provedorRef: 'PERFIL-1' })).json<{ id: string }>();
    return { t, pautaId: leadId, pecaId: pieceId, conta: await loadAccount(env, t, id) };
  }

  it('success: POST /api/post with the key, the profile, the caption and the signed URLs; returns id and link', async () => {
    const { t, pecaId: pieceId, conta: account } = await scenario();
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Response.json({ status: 'success', id: 'ayr-1', postIds: [{ platform: 'instagram', status: 'success', id: 'ig-555', postUrl: 'https://www.instagram.com/p/ABC/' }] });
    }) as unknown as typeof fetch;
    const pub = await publish(env, { tenantId: t, pecaId: pieceId, conta: account }, fake);
    expect(pub).toEqual({ rede: 'instagram', externalId: 'ig-555', url: 'https://www.instagram.com/p/ABC/' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.ayrshare.com/api/post');
    const h = calls[0].init.headers as Record<string, string>;
    expect(h.authorization).toBe(`Bearer ${KEY}`);
    expect(h['profile-key']).toBe('PERFIL-1');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({ post: 'Legenda de teste', platforms: ['instagram'], idempotencyKey: `redacao-${pieceId}` });
    expect(body.mediaUrls).toHaveLength(1);
    expect(body.mediaUrls[0]).toMatch(/^http:\/\/localhost:8787\/media\/artes\/.+01-capa\.jpg\?exp=\d+&sig=/);
  });

  it('4xx error: publish fails without the key in the message; the publication stays failed with an error; no key in events', async () => {
    const { t, pautaId: leadId, pecaId: pieceId, conta: account } = await scenario();
    const fake = (async () => Response.json({ status: 'error', code: 156, message: `Profile not linked (key ${KEY})` }, { status: 400 })) as unknown as typeof fetch;
    const error = await publish(env, { tenantId: t, pecaId: pieceId, conta: account }, fake).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain('ayrshare 400');
    expect(String(error)).not.toContain(KEY);
    const executionId = `${pieceId}-pub-1`;
    await failPublication(env, { tenantId: t, pautaId: leadId, pecaId: pieceId, contaId: account.id }, executionId, String(error).slice(0, 500));
    const pub = await env.DB.prepare('SELECT status, erro, modo FROM publicacoes WHERE id = ?').bind(executionId).first<{ status: string; erro: string; modo: string }>();
    expect(pub).toMatchObject({ status: 'falhou', modo: 'intermediario' });
    expect(pub!.erro).toContain('Profile not linked');
    const db = await allTenant(t);
    for (const x of Object.values(db)) expect(x).not.toContain(KEY);
  });

  it('repeated idempotency key (earlier send accepted): fails asking to check, without posting again', async () => {
    const { t, pecaId: pieceId, conta: account } = await scenario();
    const fake = (async () => Response.json({ status: 'error', code: 137, message: 'Duplicate idempotencyKey' }, { status: 400 })) as unknown as typeof fetch;
    await expect(publish(env, { tenantId: t, pecaId: pieceId, conta: account }, fake)).rejects.toThrow('was already sent before');
  });

  it('with Profile-Key the response comes per profile (posts[].postIds): also a success', async () => {
    const { t, pecaId: pieceId, conta: account } = await scenario();
    const fake = (async () => Response.json({ status: 'success', posts: [{ status: 'success', id: 'ayr-2', profileKey: 'PERFIL-1',
      postIds: [{ platform: 'instagram', status: 'success', id: 'ig-777', postUrl: 'https://www.instagram.com/p/XYZ/' }] }] })) as unknown as typeof fetch;
    expect(await publish(env, { tenantId: t, pecaId: pieceId, conta: account }, fake)).toEqual({ rede: 'instagram', externalId: 'ig-777', url: 'https://www.instagram.com/p/XYZ/' });
  });

  it('200 without the Instagram post (error status per platform) also fails', async () => {
    const { t, pecaId: pieceId, conta: account } = await scenario();
    const fake = (async () => Response.json({ status: 'success', postIds: [{ platform: 'instagram', status: 'error', message: 'Media too large' }] })) as unknown as typeof fetch;
    await expect(publish(env, { tenantId: t, pecaId: pieceId, conta: account }, fake)).rejects.toThrow('Media too large');
  });
});
