// Phase F: what Ready to post, the publish screen and Posted consume. The list of approved posts with account and time,
// the light status with the last publication, Posted paginated by cursor. Includes IDOR and roles.
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { cursorPublications } from '../src/shell/queue';
import { register, req, seedAccount, seedMember, seedLead, seedPiece, seedTenant } from './helpers';

async function member(role: 'admin' | 'editor' | 'reporter' = 'editor') {
  const s = await register();
  const t = await seedTenant();
  await seedMember(t, s.userId, role);
  return { s, t };
}

/** An approved (or scheduled) piece on an account, with a fixed `updated_at` so the order is predictable. */
async function approved(t: string, account: string, o: { status?: 'aprovada' | 'agendada'; em: string; agendado?: string }) {
  const { pautaId: leadId } = await seedLead(t, 'em_producao');
  const id = await seedPiece(t, leadId, { status: o.status ?? 'aprovada', contaId: account });
  await env.DB.prepare('UPDATE pecas SET updated_at = ?, agendado_para = ? WHERE id = ?').bind(o.em, o.agendado ?? null, id).run();
  return id;
}

/** A publication recorded as the Workflow or the manual confirmation would record it. */
async function published(t: string, account: string | null, o: { em: string; status?: string; url?: string; id?: string }) {
  const { pautaId: leadId } = await seedLead(t, 'concluida');
  const piece = await seedPiece(t, leadId, { status: 'publicada', contaId: account ?? undefined });
  const id = o.id ?? crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO publicacoes (id, tenant_id, peca_id, conta_id, rede, modo, url, publicado_em, status, created_at)
                        VALUES (?, ?, ?, ?, 'instagram', 'manual', ?, ?, ?, ?)`)
    .bind(id, t, piece, account, o.url ?? `https://www.instagram.com/p/${id.slice(0, 6)}/`, o.em, o.status ?? 'publicada', o.em).run();
  return { id, peca: piece };
}

describe('GET pecas?status=aprovada,agendada (Ready to post)', () => {
  it('in arrival order, time noted in place; count of each and how many are waiting for someone to post', async () => {
    const { s, t } = await member('reporter');
    const manual = await seedAccount(t, 'manual');
    const simulated = await seedAccount(t, 'simulada');
    await env.DB.prepare("UPDATE contas_sociais SET token_enc = 'segredo' WHERE id = ?").bind(manual).run();
    const old = await approved(t, manual, { em: '2026-11-01 08:00:00' });
    const created = await approved(t, simulated, { em: '2026-11-01 10:00:00' });
    // Noted for 9am (UTC, ISO as the API stores it): between the two.
    const noted = await approved(t, manual, { status: 'agendada', em: '2026-11-01 11:00:00', agendado: '2026-11-01T09:00:00.000Z' });

    const res = await req(`/api/t/${t}/pecas?status=aprovada,agendada`, { cookie: s.cookie });
    expect(res.status).toBe(200);
    const body = await res.json<{ pecas: Record<string, unknown>[]; total: Record<string, number>; manuais: number }>();
    expect(body.pecas.map((p) => p.id)).toEqual([old, noted, created]);
    expect(body.pecas[1]).toMatchObject({ status: 'agendada', agendado_para: '2026-11-01T09:00:00.000Z', conta_modo: 'manual', conta_nome: 'conta teste' });
    expect(body.pecas[2]).toMatchObject({ conta_modo: 'simulada', agendado_para: null });
    expect(body.total).toEqual({ aprovada: 2, agendada: 1 });
    expect(body.manuais).toBe(2);
    expect(JSON.stringify(body)).not.toContain('segredo');
  });

  it('the default list (in production and in review) stays the same, and without aprovadas in the counter', async () => {
    const { s, t } = await member();
    const account = await seedAccount(t, 'manual');
    await approved(t, account, { em: '2026-11-01 08:00:00' });
    const body = await (await req(`/api/t/${t}/pecas`, { cookie: s.cookie })).json<{ pecas: unknown[]; manuais: number }>();
    expect(body.pecas).toEqual([]);
    expect(body.manuais).toBe(0);
  });
});

describe('GET pecas/:id/status with the publication', () => {
  it('aprovada: account and time; publicada: link and when; a publish failure shows as such', async () => {
    const { s, t } = await member('reporter');
    const account = await seedAccount(t, 'manual');
    const piece = await approved(t, account, { status: 'agendada', em: '2026-11-01 08:00:00', agendado: '2026-11-02T12:00:00.000Z' });
    const st = await (await req(`/api/t/${t}/pecas/${piece}/status`, { cookie: s.cookie })).json<Record<string, unknown>>();
    expect(st).toMatchObject({ status: 'agendada', agendado_para: '2026-11-02T12:00:00.000Z', conta_modo: 'manual', publicacao_status: null, publicacao_url: null });

    const pub = await published(t, account, { em: '2026-11-01 09:00:00', url: 'https://www.instagram.com/p/XYZ/' });
    const st2 = await (await req(`/api/t/${t}/pecas/${pub.peca}/status`, { cookie: s.cookie })).json<Record<string, unknown>>();
    expect(st2).toMatchObject({ status: 'publicada', publicacao_status: 'publicada', publicacao_url: 'https://www.instagram.com/p/XYZ/', publicado_em: '2026-11-01 09:00:00' });

    // Two attempts: the last one counts.
    await env.DB.prepare(`INSERT INTO publicacoes (id, tenant_id, peca_id, conta_id, rede, modo, status, erro, created_at)
                          VALUES (?, ?, ?, ?, 'instagram', 'simulada', 'falhou', 'Graph 500', '2026-11-01 10:00:00')`)
      .bind(crypto.randomUUID(), t, pub.peca, account).run();
    const st3 = await (await req(`/api/t/${t}/pecas/${pub.peca}/status`, { cookie: s.cookie })).json<Record<string, unknown>>();
    expect(st3).toMatchObject({ publicacao_status: 'falhou', publicacao_url: null });
  });
});

describe('GET publicacoes (Posted)', () => {
  it('only the ones that went out, from this outlet, most recent first, with cover, account and link', async () => {
    const { s, t } = await member('reporter');
    const account = await seedAccount(t, 'manual');
    const a = await published(t, account, { em: '2026-11-01 08:00:00' });
    const b = await published(t, account, { em: '2026-11-01 09:00:00' });
    await published(t, account, { em: '2026-11-01 10:00:00', status: 'falhou' });
    const other = await seedTenant();
    await published(other, await seedAccount(other), { em: '2026-11-01 11:00:00' });

    const res = await req(`/api/t/${t}/publicacoes`, { cookie: s.cookie });
    expect(res.status).toBe(200);
    const body = await res.json<{ publicacoes: Record<string, unknown>[]; proximo: string | null }>();
    expect(body.publicacoes.map((p) => p.id)).toEqual([b.id, a.id]);
    expect(body.publicacoes[0]).toMatchObject({ peca_id: b.peca, modo: 'manual', manchete: 'M', titulo: 'Ponte interditada', conta_nome: 'conta teste', publicado_em: '2026-11-01 09:00:00' });
    expect(body.publicacoes[0].capa).toMatch(/^https?:\/\/[^/]+\/media\/artes\/.+sig=/);
    expect(body.proximo).toBeNull();
  });

  it('paginates by cursor without repeating or skipping, even with the same time', async () => {
    const { s, t } = await member();
    const account = await seedAccount(t);
    const ids: string[] = [];
    for (let i = 0; i < 23; i++) {
      const at = `2026-11-01 ${String(8 + Math.floor(i / 4)).padStart(2, '0')}:00:00`;   // 4 at a time at the same time
      ids.push((await published(t, account, { em: at, id: `pub-${String(i).padStart(2, '0')}` })).id);
    }
    const p1 = await (await req(`/api/t/${t}/publicacoes`, { cookie: s.cookie })).json<{ publicacoes: { id: string }[]; proximo: string }>();
    expect(p1.publicacoes).toHaveLength(20);
    expect(p1.proximo).toBeTruthy();
    const p2 = await (await req(`/api/t/${t}/publicacoes?antes=${encodeURIComponent(p1.proximo)}`, { cookie: s.cookie }))
      .json<{ publicacoes: { id: string }[]; proximo: string | null }>();
    expect(p2.proximo).toBeNull();
    expect([...p1.publicacoes, ...p2.publicacoes].map((p) => p.id)).toEqual([...ids].reverse());
  });

  it('invalid cursor → 400; another outlet → 404', async () => {
    const { s, t } = await member();
    expect((await req(`/api/t/${t}/publicacoes?antes=ontem`, { cookie: s.cookie })).status).toBe(400);
    const other = await seedTenant();
    expect((await req(`/api/t/${other}/publicacoes`, { cookie: s.cookie })).status).toBe(404);
    expect((await req(`/api/t/${t}/publicacoes`)).status).toBe(401);
  });

  it('cursorPublications accepts only the format the API returns', () => {
    expect(cursorPublications('2026-11-01 09:00:00|abc-1')).toEqual({ em: '2026-11-01 09:00:00', id: 'abc-1' });
    expect(cursorPublications('2026-11-01T09:00:00Z|abc')).toBeNull();
    expect(cursorPublications("2026-11-01 09:00:00|a' OR 1=1")).toBeNull();
    expect(cursorPublications(undefined)).toBeNull();
  });
});

describe('POST publicada (confirm that it was posted)', () => {
  it("reporter doesn't confirm; an automatic account doesn't accept a manual confirmation; editor confirms once", async () => {
    const { s, t } = await member('reporter');
    const ed = await register();
    await seedMember(t, ed.userId, 'editor');
    const manual = await seedAccount(t, 'manual');
    const piece = await approved(t, manual, { em: '2026-11-01 08:00:00' });
    const auto = await approved(t, await seedAccount(t, 'simulada'), { em: '2026-11-01 08:00:00' });

    expect((await req(`/api/t/${t}/pecas/${piece}/publicada`, { cookie: s.cookie, body: { url: 'https://www.instagram.com/p/A/' } })).status).toBe(403);
    expect((await req(`/api/t/${t}/pecas/${auto}/publicada`, { cookie: ed.cookie, body: { url: 'https://www.instagram.com/p/A/' } })).status).toBe(409);
    expect((await req(`/api/t/${t}/pecas/${piece}/publicada`, { cookie: ed.cookie, body: { url: 'javascript:alert(1)' } })).status).toBe(400);
    const ok = await req(`/api/t/${t}/pecas/${piece}/publicada`, { cookie: ed.cookie, body: {} });
    expect(ok.status).toBe(200);
    expect((await req(`/api/t/${t}/pecas/${piece}/publicada`, { cookie: ed.cookie, body: {} })).status).toBe(409);
    const list = await (await req(`/api/t/${t}/publicacoes`, { cookie: s.cookie })).json<{ publicacoes: { peca_id: string; url: string | null }[] }>();
    expect(list.publicacoes).toEqual([expect.objectContaining({ peca_id: piece, url: null })]);
  });
});
