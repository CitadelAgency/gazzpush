// Fase F: o que Prontos para postar, a tela de publicar e Postados consomem. Lista das aprovadas com a conta e o
// horário, status leve com a última publicação, Postados paginado por cursor. Inclui IDOR e papéis.
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { cursorPublicacoes } from '../src/shell/fila';
import { cadastrar, req, seedConta, seedMembro, seedPauta, seedPeca, seedTenant } from './helpers';

async function membro(papel: 'admin' | 'editor' | 'reporter' = 'editor') {
  const s = await cadastrar();
  const t = await seedTenant();
  await seedMembro(t, s.userId, papel);
  return { s, t };
}

/** Peça aprovada (ou agendada) numa conta, com `updated_at` fixo para a ordem ser previsível. */
async function aprovada(t: string, conta: string, o: { status?: 'aprovada' | 'agendada'; em: string; agendado?: string }) {
  const { pautaId } = await seedPauta(t, 'em_producao');
  const id = await seedPeca(t, pautaId, { status: o.status ?? 'aprovada', contaId: conta });
  await env.DB.prepare('UPDATE pecas SET updated_at = ?, agendado_para = ? WHERE id = ?').bind(o.em, o.agendado ?? null, id).run();
  return id;
}

/** Publicação gravada como o Workflow ou a confirmação manual gravariam. */
async function publicada(t: string, conta: string | null, o: { em: string; status?: string; url?: string; id?: string }) {
  const { pautaId } = await seedPauta(t, 'concluida');
  const peca = await seedPeca(t, pautaId, { status: 'publicada', contaId: conta ?? undefined });
  const id = o.id ?? crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO publicacoes (id, tenant_id, peca_id, conta_id, rede, modo, url, publicado_em, status, created_at)
                        VALUES (?, ?, ?, ?, 'instagram', 'manual', ?, ?, ?, ?)`)
    .bind(id, t, peca, conta, o.url ?? `https://www.instagram.com/p/${id.slice(0, 6)}/`, o.em, o.status ?? 'publicada', o.em).run();
  return { id, peca };
}

describe('GET pecas?status=aprovada,agendada (Prontos para postar)', () => {
  it('por ordem de chegada, horário anotado no lugar; conta de cada uma e quantas esperam alguém postar', async () => {
    const { s, t } = await membro('reporter');
    const manual = await seedConta(t, 'manual');
    const simulada = await seedConta(t, 'simulada');
    await env.DB.prepare("UPDATE contas_sociais SET token_enc = 'segredo' WHERE id = ?").bind(manual).run();
    const velha = await aprovada(t, manual, { em: '2026-11-01 08:00:00' });
    const nova = await aprovada(t, simulada, { em: '2026-11-01 10:00:00' });
    // Anotada para as 9h (UTC, ISO como a API grava): entre as duas.
    const anotada = await aprovada(t, manual, { status: 'agendada', em: '2026-11-01 11:00:00', agendado: '2026-11-01T09:00:00.000Z' });

    const res = await req(`/api/t/${t}/pecas?status=aprovada,agendada`, { cookie: s.cookie });
    expect(res.status).toBe(200);
    const corpo = await res.json<{ pecas: Record<string, unknown>[]; total: Record<string, number>; manuais: number }>();
    expect(corpo.pecas.map((p) => p.id)).toEqual([velha, anotada, nova]);
    expect(corpo.pecas[1]).toMatchObject({ status: 'agendada', agendado_para: '2026-11-01T09:00:00.000Z', conta_modo: 'manual', conta_nome: 'conta teste' });
    expect(corpo.pecas[2]).toMatchObject({ conta_modo: 'simulada', agendado_para: null });
    expect(corpo.total).toEqual({ aprovada: 2, agendada: 1 });
    expect(corpo.manuais).toBe(2);
    expect(JSON.stringify(corpo)).not.toContain('segredo');
  });

  it('a lista padrão (produzindo e em revisão) segue igual e sem aprovadas no contador', async () => {
    const { s, t } = await membro();
    const conta = await seedConta(t, 'manual');
    await aprovada(t, conta, { em: '2026-11-01 08:00:00' });
    const corpo = await (await req(`/api/t/${t}/pecas`, { cookie: s.cookie })).json<{ pecas: unknown[]; manuais: number }>();
    expect(corpo.pecas).toEqual([]);
    expect(corpo.manuais).toBe(0);
  });
});

describe('GET pecas/:id/status com a publicação', () => {
  it('aprovada: conta e horário; publicada: link e quando; falha de publicar aparece como tal', async () => {
    const { s, t } = await membro('reporter');
    const conta = await seedConta(t, 'manual');
    const peca = await aprovada(t, conta, { status: 'agendada', em: '2026-11-01 08:00:00', agendado: '2026-11-02T12:00:00.000Z' });
    const st = await (await req(`/api/t/${t}/pecas/${peca}/status`, { cookie: s.cookie })).json<Record<string, unknown>>();
    expect(st).toMatchObject({ status: 'agendada', agendado_para: '2026-11-02T12:00:00.000Z', conta_modo: 'manual', publicacao_status: null, publicacao_url: null });

    const pub = await publicada(t, conta, { em: '2026-11-01 09:00:00', url: 'https://www.instagram.com/p/XYZ/' });
    const st2 = await (await req(`/api/t/${t}/pecas/${pub.peca}/status`, { cookie: s.cookie })).json<Record<string, unknown>>();
    expect(st2).toMatchObject({ status: 'publicada', publicacao_status: 'publicada', publicacao_url: 'https://www.instagram.com/p/XYZ/', publicado_em: '2026-11-01 09:00:00' });

    // Duas tentativas: vale a última.
    await env.DB.prepare(`INSERT INTO publicacoes (id, tenant_id, peca_id, conta_id, rede, modo, status, erro, created_at)
                          VALUES (?, ?, ?, ?, 'instagram', 'simulada', 'falhou', 'Graph 500', '2026-11-01 10:00:00')`)
      .bind(crypto.randomUUID(), t, pub.peca, conta).run();
    const st3 = await (await req(`/api/t/${t}/pecas/${pub.peca}/status`, { cookie: s.cookie })).json<Record<string, unknown>>();
    expect(st3).toMatchObject({ publicacao_status: 'falhou', publicacao_url: null });
  });
});

describe('GET publicacoes (Postados)', () => {
  it('só as que saíram, deste veículo, da mais recente, com capa, conta e link', async () => {
    const { s, t } = await membro('reporter');
    const conta = await seedConta(t, 'manual');
    const a = await publicada(t, conta, { em: '2026-11-01 08:00:00' });
    const b = await publicada(t, conta, { em: '2026-11-01 09:00:00' });
    await publicada(t, conta, { em: '2026-11-01 10:00:00', status: 'falhou' });
    const outro = await seedTenant();
    await publicada(outro, await seedConta(outro), { em: '2026-11-01 11:00:00' });

    const res = await req(`/api/t/${t}/publicacoes`, { cookie: s.cookie });
    expect(res.status).toBe(200);
    const corpo = await res.json<{ publicacoes: Record<string, unknown>[]; proximo: string | null }>();
    expect(corpo.publicacoes.map((p) => p.id)).toEqual([b.id, a.id]);
    expect(corpo.publicacoes[0]).toMatchObject({ peca_id: b.peca, modo: 'manual', manchete: 'M', titulo: 'Título da pauta', conta_nome: 'conta teste', publicado_em: '2026-11-01 09:00:00' });
    expect(corpo.publicacoes[0].capa).toMatch(/^https?:\/\/[^/]+\/media\/artes\/.+sig=/);
    expect(corpo.proximo).toBeNull();
  });

  it('pagina por cursor sem repetir nem pular, mesmo com o mesmo horário', async () => {
    const { s, t } = await membro();
    const conta = await seedConta(t);
    const ids: string[] = [];
    for (let i = 0; i < 23; i++) {
      const em = `2026-11-01 ${String(8 + Math.floor(i / 4)).padStart(2, '0')}:00:00`;   // de 4 em 4 no mesmo horário
      ids.push((await publicada(t, conta, { em, id: `pub-${String(i).padStart(2, '0')}` })).id);
    }
    const p1 = await (await req(`/api/t/${t}/publicacoes`, { cookie: s.cookie })).json<{ publicacoes: { id: string }[]; proximo: string }>();
    expect(p1.publicacoes).toHaveLength(20);
    expect(p1.proximo).toBeTruthy();
    const p2 = await (await req(`/api/t/${t}/publicacoes?antes=${encodeURIComponent(p1.proximo)}`, { cookie: s.cookie }))
      .json<{ publicacoes: { id: string }[]; proximo: string | null }>();
    expect(p2.proximo).toBeNull();
    expect([...p1.publicacoes, ...p2.publicacoes].map((p) => p.id)).toEqual([...ids].reverse());
  });

  it('cursor inválido → 400; veículo alheio → 404', async () => {
    const { s, t } = await membro();
    expect((await req(`/api/t/${t}/publicacoes?antes=ontem`, { cookie: s.cookie })).status).toBe(400);
    const outro = await seedTenant();
    expect((await req(`/api/t/${outro}/publicacoes`, { cookie: s.cookie })).status).toBe(404);
    expect((await req(`/api/t/${t}/publicacoes`)).status).toBe(401);
  });

  it('cursorPublicacoes aceita só o formato que a API devolve', () => {
    expect(cursorPublicacoes('2026-11-01 09:00:00|abc-1')).toEqual({ em: '2026-11-01 09:00:00', id: 'abc-1' });
    expect(cursorPublicacoes('2026-11-01T09:00:00Z|abc')).toBeNull();
    expect(cursorPublicacoes("2026-11-01 09:00:00|a' OR 1=1")).toBeNull();
    expect(cursorPublicacoes(undefined)).toBeNull();
  });
});

describe('POST publicada (confirmar que postou)', () => {
  it('reporter não confirma; conta automática não aceita confirmação à mão; editor confirma uma vez', async () => {
    const { s, t } = await membro('reporter');
    const ed = await cadastrar();
    await seedMembro(t, ed.userId, 'editor');
    const manual = await seedConta(t, 'manual');
    const peca = await aprovada(t, manual, { em: '2026-11-01 08:00:00' });
    const auto = await aprovada(t, await seedConta(t, 'simulada'), { em: '2026-11-01 08:00:00' });

    expect((await req(`/api/t/${t}/pecas/${peca}/publicada`, { cookie: s.cookie, body: { url: 'https://www.instagram.com/p/A/' } })).status).toBe(403);
    expect((await req(`/api/t/${t}/pecas/${auto}/publicada`, { cookie: ed.cookie, body: { url: 'https://www.instagram.com/p/A/' } })).status).toBe(409);
    expect((await req(`/api/t/${t}/pecas/${peca}/publicada`, { cookie: ed.cookie, body: { url: 'javascript:alert(1)' } })).status).toBe(400);
    const ok = await req(`/api/t/${t}/pecas/${peca}/publicada`, { cookie: ed.cookie, body: {} });
    expect(ok.status).toBe(200);
    expect((await req(`/api/t/${t}/pecas/${peca}/publicada`, { cookie: ed.cookie, body: {} })).status).toBe(409);
    const lista = await (await req(`/api/t/${t}/publicacoes`, { cookie: s.cookie })).json<{ publicacoes: { peca_id: string; url: string | null }[] }>();
    expect(lista.publicacoes).toEqual([expect.objectContaining({ peca_id: peca, url: null })]);
  });
});
