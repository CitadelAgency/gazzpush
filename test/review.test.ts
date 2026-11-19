// Phase E: what the review screen consumes. Accounts to choose on approval, facts and the lead in the full piece, the
// expected version on decision. Includes IDOR and roles.
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { register, req, seedAccount, seedMember, seedLead, seedPiece, seedTenant, statusOf } from './helpers';

async function member(role: 'admin' | 'editor' | 'reporter' = 'editor') {
  const s = await register();
  const t = await seedTenant();
  await seedMember(t, s.userId, role);
  return { s, t };
}

describe('GET contas', () => {
  it("only the outlet's active ones, in the default account's order, without token", async () => {
    const { s, t } = await member('reporter');
    const simulated = await seedAccount(t, 'simulada');
    const manual = await seedAccount(t, 'manual');
    const removed = await seedAccount(t, 'manual');
    await env.DB.prepare("UPDATE contas_sociais SET status = 'removida', token_enc = 'segredo' WHERE id = ?").bind(removed).run();
    await env.DB.prepare("UPDATE contas_sociais SET token_enc = 'segredo', provedor_ref = 'ref' WHERE id = ?").bind(manual).run();

    const res = await req(`/api/t/${t}/contas`, { cookie: s.cookie });
    expect(res.status).toBe(200);
    const { contas: accounts } = await res.json<{ contas: Record<string, unknown>[] }>();
    expect(accounts.map((c) => c.id)).toEqual([manual, simulated]);
    expect(accounts[0]).toEqual({ id: manual, rede: 'instagram', modo: 'manual', nome: 'conta teste', external_id: null, status: 'ativa', provedor: null });
    expect(JSON.stringify(accounts)).not.toContain('segredo');
  });

  it('IDOR: accounts from another outlet → 404', async () => {
    const { s } = await member();
    const other = await seedTenant();
    await seedAccount(other);
    expect((await req(`/api/t/${other}/contas`, { cookie: s.cookie })).status).toBe(404);
  });
});

describe('GET pecas/:id: lead and facts', () => {
  it("lead's facts in its order, with source and document link", async () => {
    const { s, t } = await member('reporter');
    const { pautaId: leadId, fatos: facts } = await seedLead(t, 'em_producao');
    await env.DB.prepare("UPDATE pautas SET editoria = 'cidade', bairro = 'Centro' WHERE id = ?").bind(leadId).run();
    const piece = await seedPiece(t, leadId);

    const res = await req(`/api/t/${t}/pecas/${piece}`, { cookie: s.cookie });
    expect(res.status).toBe(200);
    const body = await res.json<{ pauta: unknown; fatos: unknown[] }>();
    expect(body.pauta).toEqual({ titulo: 'Ponte interditada', editoria: 'cidade', bairro: 'Centro', tipo_post: null, origem: 'monitor' });
    expect(body.fatos).toEqual(facts.map((f) => ({ id: f.id, tipo: f.tipo, texto: f.texto, url: 'https://exemplo.gov.br/noticia', fonte: 'Prefeitura', evidencia: null, fonteTitulo: null, print: null })));
  });

  it("a fact from another outlet cited in the lead doesn't appear", async () => {
    const { s, t } = await member();
    const other = await seedTenant();
    const { fatos: foreign } = await seedLead(other);
    const { pautaId: leadId, fatos: facts } = await seedLead(t, 'em_producao');
    await env.DB.prepare('UPDATE pautas SET fato_ids_json = ? WHERE id = ?').bind(JSON.stringify([foreign[0].id, facts[1].id]), leadId).run();
    const piece = await seedPiece(t, leadId);

    const body = await (await req(`/api/t/${t}/pecas/${piece}`, { cookie: s.cookie })).json<{ fatos: { id: string }[] }>();
    expect(body.fatos.map((f) => f.id)).toEqual([facts[1].id]);
  });
});

describe('POST revisao with expected version', () => {
  it('a version different from the displayed one → 409 and nothing changes; the same version decides', async () => {
    const { s, t } = await member('editor');
    const { pautaId: leadId } = await seedLead(t, 'em_producao');
    const account = await seedAccount(t, 'manual');
    const piece = await seedPiece(t, leadId, { versao: 2 });

    const old = await req(`/api/t/${t}/pecas/${piece}/revisao`, { cookie: s.cookie, body: { decisao: 'aprovar', contaId: account, versao: 1 } });
    expect(old.status).toBe(409);
    expect(await statusOf('pecas', piece)).toBe('revisao');
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM decisoes WHERE peca_id = ?').bind(piece).first<{ n: number }>())?.n).toBe(0);

    expect((await req(`/api/t/${t}/pecas/${piece}/revisao`, { cookie: s.cookie, body: { decisao: 'aprovar', contaId: account, versao: 'dois' } })).status).toBe(400);

    const right = await req(`/api/t/${t}/pecas/${piece}/revisao`, { cookie: s.cookie, body: { decisao: 'aprovar', contaId: account, versao: 2 } });
    expect(right.status).toBe(200);
    expect(await right.json()).toEqual({ status: 'aprovada', modo: 'manual' });
  });

  it('without version still accepted (old clients, curl)', async () => {
    const { s, t } = await member('editor');
    const { pautaId: leadId } = await seedLead(t, 'em_producao');
    const piece = await seedPiece(t, leadId);
    const res = await req(`/api/t/${t}/pecas/${piece}/revisao`, { cookie: s.cookie, body: { decisao: 'rejeitar', motivo: 'velha' } });
    expect(res.status).toBe(200);
    expect(await statusOf('pecas', piece)).toBe('rejeitada');
    expect(await statusOf('pautas', leadId)).toBe('descartada');
  });
});
