// Contas que postam sozinhas: POST contas com modo real (Instagram direto) e intermediario (Ayrshare), segredo cifrado
// e nunca devolvido; adaptador Ayrshare com fetch falso (sucesso, 4xx → publicação falhou, chave fora de eventos).
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { carregarConta, publicar } from '../src/lib/publicar';
import { falharPublicacao } from '../src/workflows/publicacao';
import { cadastrar, req, seedMembro, seedPauta, seedPeca, seedTenant } from './helpers';

const CHAVE = crypto.randomUUID();
const TOKEN_IG = crypto.randomUUID();

async function membro(papel: 'admin' | 'editor' | 'reporter' = 'admin') {
  const s = await cadastrar();
  const t = await seedTenant();
  await seedMembro(t, s.userId, papel);
  return { s, t };
}
const contas = (t: string, cookie: string, body: unknown) => req(`/api/t/${t}/contas`, { cookie, body });
const tudoDoTenant = async (t: string) => {
  const [c, e, p] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM contas_sociais WHERE tenant_id = ?').bind(t),
    env.DB.prepare('SELECT * FROM eventos WHERE tenant_id = ?').bind(t),
    env.DB.prepare('SELECT * FROM publicacoes WHERE tenant_id = ?').bind(t),
  ]);
  return { contas: JSON.stringify(c.results), eventos: JSON.stringify(e.results), publicacoes: JSON.stringify(p.results) };
};

describe('POST contas: modos que postam sozinhos', () => {
  it('admin liga Instagram direto e Ayrshare; o segredo é cifrado e nenhuma resposta o devolve', async () => {
    const { s, t } = await membro();
    const r1 = await contas(t, s.cookie, { nome: '@direto', modo: 'real', externalId: '1'.repeat(17), token: ` ${TOKEN_IG} ` });
    expect(r1.status).toBe(201);
    const r2 = await contas(t, s.cookie, { nome: '@ayr', modo: 'intermediario', provedor: 'ayrshare', token: CHAVE, provedorRef: 'PERFIL-1' });
    expect(r2.status).toBe(201);
    const textos = [await r1.text(), await r2.text(), await (await req(`/api/t/${t}/contas?todas=1`, { cookie: s.cookie })).text()];
    for (const x of textos) { expect(x).not.toContain(TOKEN_IG); expect(x).not.toContain(CHAVE); expect(x).not.toContain('PERFIL-1'); }
    const lista = JSON.parse(textos[2]).contas as Record<string, unknown>[];
    expect(lista.map((c) => [c.nome, c.modo, c.provedor])).toEqual([['@direto', 'real', null], ['@ayr', 'intermediario', 'ayrshare']]);
    const banco = await tudoDoTenant(t);
    expect(banco.contas).not.toContain(TOKEN_IG);
    expect(banco.contas).not.toContain(CHAVE);
    const ayr = await carregarConta(env, t, JSON.parse(textos[1]).id);
    expect(ayr).toMatchObject({ modo: 'intermediario', provedor: 'ayrshare', provedor_ref: 'PERFIL-1' });
  });

  it('validação: real sem token, id não numérico; intermediário sem chave ou com provedor sem adaptador → 400', async () => {
    const { s, t } = await membro();
    for (const body of [
      { nome: '@x', modo: 'real', externalId: '1'.repeat(17) },
      { nome: '@x', modo: 'real', externalId: 'abc', token: 'x' },
      { nome: '@x', modo: 'intermediario', provedor: 'ayrshare' },
      { nome: '@x', modo: 'intermediario', provedor: 'postpeer', token: 'x' },
      { nome: '@x', modo: 'intermediario', token: 'x' },
      { nome: '@x', modo: 'intermediario', provedor: 'ayrshare', token: '   ' },
      { nome: '@x', modo: 'manual', token: 123 },
    ]) expect((await contas(t, s.cookie, body)).status, JSON.stringify(body)).toBe(400);
  });

  it('editor e repórter não ligam (403); outro veículo: 404', async () => {
    const { t } = await membro();
    for (const papel of ['editor', 'reporter'] as const) {
      const o = await cadastrar();
      await seedMembro(t, o.userId, papel);
      expect((await contas(t, o.cookie, { nome: '@x', modo: 'intermediario', provedor: 'ayrshare', token: CHAVE })).status).toBe(403);
    }
    const b = await membro();
    expect((await contas(t, b.s.cookie, { nome: '@x', modo: 'manual' })).status).toBe(404);
  });
});

describe('publicar: adaptador Ayrshare', () => {
  async function cenario() {
    const { s, t } = await membro();
    const { pautaId } = await seedPauta(t, 'em_producao');
    const pecaId = await seedPeca(t, pautaId, { status: 'aprovada' });
    const { id } = await (await contas(t, s.cookie, { nome: '@ayr', modo: 'intermediario', provedor: 'ayrshare', token: CHAVE, provedorRef: 'PERFIL-1' })).json<{ id: string }>();
    return { t, pautaId, pecaId, conta: await carregarConta(env, t, id) };
  }

  it('sucesso: POST /api/post com a chave, o perfil, a legenda e as URLs assinadas; devolve id e link', async () => {
    const { t, pecaId, conta } = await cenario();
    const chamadas: { url: string; init: RequestInit }[] = [];
    const falso = (async (url: string, init: RequestInit) => {
      chamadas.push({ url, init });
      return Response.json({ status: 'success', id: 'ayr-1', postIds: [{ platform: 'instagram', status: 'success', id: 'ig-555', postUrl: 'https://www.instagram.com/p/ABC/' }] });
    }) as unknown as typeof fetch;
    const pub = await publicar(env, { tenantId: t, pecaId, conta }, falso);
    expect(pub).toEqual({ rede: 'instagram', externalId: 'ig-555', url: 'https://www.instagram.com/p/ABC/' });
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].url).toBe('https://api.ayrshare.com/api/post');
    const h = chamadas[0].init.headers as Record<string, string>;
    expect(h.authorization).toBe(`Bearer ${CHAVE}`);
    expect(h['profile-key']).toBe('PERFIL-1');
    const body = JSON.parse(String(chamadas[0].init.body));
    expect(body).toMatchObject({ post: 'Legenda de teste', platforms: ['instagram'], idempotencyKey: `redacao-${pecaId}` });
    expect(body.mediaUrls).toHaveLength(1);
    expect(body.mediaUrls[0]).toMatch(/^http:\/\/localhost:8787\/media\/artes\/.+01-capa\.jpg\?exp=\d+&sig=/);
  });

  it('erro 4xx: publicar falha sem a chave na mensagem; a publicação fica falhou com erro; nada de chave em eventos', async () => {
    const { t, pautaId, pecaId, conta } = await cenario();
    const falso = (async () => Response.json({ status: 'error', code: 156, message: `Profile not linked (key ${CHAVE})` }, { status: 400 })) as unknown as typeof fetch;
    const erro = await publicar(env, { tenantId: t, pecaId, conta }, falso).catch((e: Error) => e);
    expect(erro).toBeInstanceOf(Error);
    expect(String(erro)).toContain('ayrshare 400');
    expect(String(erro)).not.toContain(CHAVE);
    const execucaoId = `${pecaId}-pub-1`;
    await falharPublicacao(env, { tenantId: t, pautaId, pecaId, contaId: conta.id }, execucaoId, String(erro).slice(0, 500));
    const pub = await env.DB.prepare('SELECT status, erro, modo FROM publicacoes WHERE id = ?').bind(execucaoId).first<{ status: string; erro: string; modo: string }>();
    expect(pub).toMatchObject({ status: 'falhou', modo: 'intermediario' });
    expect(pub!.erro).toContain('Profile not linked');
    const banco = await tudoDoTenant(t);
    for (const x of Object.values(banco)) expect(x).not.toContain(CHAVE);
  });

  it('chave de idempotência repetida (envio anterior aceito): falha dizendo para conferir, sem postar de novo', async () => {
    const { t, pecaId, conta } = await cenario();
    const falso = (async () => Response.json({ status: 'error', code: 137, message: 'Duplicate idempotencyKey' }, { status: 400 })) as unknown as typeof fetch;
    await expect(publicar(env, { tenantId: t, pecaId, conta }, falso)).rejects.toThrow('já foi enviada antes');
  });

  it('com Profile-Key a resposta vem por perfil (posts[].postIds): também é sucesso', async () => {
    const { t, pecaId, conta } = await cenario();
    const falso = (async () => Response.json({ status: 'success', posts: [{ status: 'success', id: 'ayr-2', profileKey: 'PERFIL-1',
      postIds: [{ platform: 'instagram', status: 'success', id: 'ig-777', postUrl: 'https://www.instagram.com/p/XYZ/' }] }] })) as unknown as typeof fetch;
    expect(await publicar(env, { tenantId: t, pecaId, conta }, falso)).toEqual({ rede: 'instagram', externalId: 'ig-777', url: 'https://www.instagram.com/p/XYZ/' });
  });

  it('200 sem o post do Instagram (status error por plataforma) também falha', async () => {
    const { t, pecaId, conta } = await cenario();
    const falso = (async () => Response.json({ status: 'success', postIds: [{ platform: 'instagram', status: 'error', message: 'Media too large' }] })) as unknown as typeof fetch;
    await expect(publicar(env, { tenantId: t, pecaId, conta }, falso)).rejects.toThrow('Media too large');
  });
});
