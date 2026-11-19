// Phase 4: selection, fewer than 3, idempotence within the day, a card with two sources failing, source per card, outlet turned off.
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cardVars } from '../src/lib/cardHtml';
import { loadLead } from '../src/lib/lead';
import * as produceModule from '../src/lib/produce';
import { draftPiece, type Draft } from '../src/lib/drafting';
import { baseCard } from '../src/lib/render';
import { enqueueSummaries, summaryId, MAX_SUMMARY, buildSummary } from '../src/lib/digest';
import { validate } from '../src/lib/validation';
import { scheduled, CRON_SUMMARY } from '../src/monitor/scheduled';
import { register, req, seedMember, seedTenant } from './helpers';

const DAY = '2026-11-05';

async function news(t: string, title: string, o: { score?: number; tipoPost?: string; status?: string; idade?: string; fonte?: string } = {}) {
  const [lead, doc, fact] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const source = `${t}:${o.fonte ?? 'Portal'}`;
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO fontes (id, tenant_id, tipo, nome) VALUES (?, ?, 'rss', ?)").bind(source, t, o.fonte ?? 'Portal'),
    env.DB.prepare("INSERT INTO documentos (id, tenant_id, fonte_id, url, hash_texto, status) VALUES (?, ?, ?, ?, ?, 'triado')").bind(doc, t, source, `https://portal.example/${doc}`, doc),
    env.DB.prepare("INSERT INTO fatos (id, tenant_id, documento_id, tipo, texto, hash) VALUES (?, ?, ?, 'manchete', ?, ?)").bind(fact, t, doc, title, fact),
    env.DB.prepare(`INSERT INTO pautas (id, tenant_id, status, origem, titulo, fato_ids_json, documento_ids_json, score, tipo_post, created_at) VALUES (?, ?, ?, 'monitor', ?, ?, ?, ?, ?, datetime('now', ?))`)
      .bind(lead, t, o.status ?? 'sugerida', title, JSON.stringify([fact]), JSON.stringify([doc]), o.score ?? 50, o.tipoPost ?? null, o.idade ?? '-1 hour'),
  ]);
  return { pauta: lead, doc, fato: fact };
}

let production: ReturnType<typeof vi.spyOn>;
beforeEach(() => { production = vi.spyOn(produceModule, 'produceLead').mockResolvedValue({ pecaId: 'p', workflowId: 'w', pendente: false }); });
afterEach(() => vi.restoreAllMocks());

const factsLead = async (t: string, id: string) => JSON.parse((await env.DB.prepare('SELECT fato_ids_json FROM pautas WHERE id = ? AND tenant_id = ?').bind(id, t).first<{ fato_ids_json: string }>())!.fato_ids_json) as string[];

describe('buildSummary', () => {
  it('picks the 5 with the best score, only news from the last 24 hours', async () => {
    const t = await seedTenant();
    const good = await Promise.all(Array.from({ length: 6 }, (_, i) => news(t, `Notícia ${i}`, { score: 90 - i })));
    const outside = await Promise.all([
      news(t, 'Publi', { score: 999, tipoPost: 'publicidade' }), news(t, 'Errata', { score: 999, tipoPost: 'errata' }), news(t, 'Atualização', { score: 999, tipoPost: 'atualizacao' }),
      news(t, 'Velha', { score: 999, idade: '-2 days' }), news(t, 'Descartada', { score: 999, status: 'descartada' }),
    ]);
    const r = await buildSummary(env, t, DAY);
    expect(r).toMatchObject({ situacao: 'nova', pautaId: summaryId(t, DAY) });
    const facts = await factsLead(t, summaryId(t, DAY));
    expect(facts).toHaveLength(MAX_SUMMARY);
    expect(facts.sort()).toEqual(good.slice(0, 5).map((b) => b.fato).sort());
    for (const f of outside) expect(facts).not.toContain(f.fato);
    const p = await env.DB.prepare('SELECT origem, tipo_post, titulo FROM pautas WHERE id = ?').bind(summaryId(t, DAY)).first();
    expect(p).toEqual({ origem: 'resumo', tipo_post: 'resumo', titulo: 'Resumo do dia' });
    expect(production).toHaveBeenCalledWith(env, t, summaryId(t, DAY), 'sistema', 'carrossel');
  });

  it("fewer than 3 doesn't go out", async () => {
    const t = await seedTenant();
    await news(t, 'Uma'); await news(t, 'Duas');
    expect(await buildSummary(env, t, DAY)).toEqual({ situacao: 'poucas', encontradas: 2 });
    expect(production).not.toHaveBeenCalled();
    expect(await env.DB.prepare('SELECT 1 AS x FROM pautas WHERE id = ?').bind(summaryId(t, DAY)).first()).toBeNull();
  });

  it("the same day doesn't generate two, and yesterday's digest doesn't go into today's", async () => {
    const t = await seedTenant();
    for (const n of ['A', 'B', 'C']) await news(t, n);
    await buildSummary(env, t, DAY);
    expect(await buildSummary(env, t, DAY)).toEqual({ situacao: 'ja_existe', pautaId: summaryId(t, DAY) });
    expect(production).toHaveBeenCalledTimes(1);
    await buildSummary(env, t, '2026-11-06');
    const facts = await factsLead(t, summaryId(t, '2026-11-06'));
    expect(facts).toHaveLength(3);
  });
});

describe('the carousel', () => {
  async function summary() {
    const t = await seedTenant();
    const [a, b, c] = [await news(t, 'Ponte fecha', { fonte: 'Prefeitura' }), await news(t, 'Praia limpa', { fonte: 'Cetesb' }), await news(t, 'Festa na orla', { fonte: 'Prefeitura' })];
    await buildSummary(env, t, DAY);
    return { t, a, b, c, pauta: await loadLead(env, t, summaryId(t, DAY)) };
  }
  const draft = (cards: Draft['cards']): Draft => ({ manchete: 'Resumo', resumo: '', legenda: 'Texto.', modelo: 'ia', custoUsd: 0, cards });

  it('a card with facts from two news items fails, with a message on the card', async () => {
    const { a, b, pauta: lead } = await summary();
    const v = validate(lead, draft([
      { id: 'c1', layout: 'capa', titulo: 'Resumo', frases: [] },
      { id: 'c2', layout: 'texto', titulo: 'Ponte fecha', frases: [{ texto: 'Ponte fecha', fatoId: a.fato }, { texto: 'Praia limpa', fatoId: b.fato }] },
    ]), { formato: 'carrossel' });
    expect(v.ok).toBe(false);
    expect(v.porCard?.c2?.join(' ')).toContain('duas notícias');
    expect(v.en?.porCard?.c2?.join(' ')).toContain('two stories');
  });

  it("each card shows its source; the cover says several; the date is today's", async () => {
    const { a, b, pauta: lead } = await summary();
    const base = baseCard(lead, new Date('2026-11-05T15:00:00Z'));
    const card = (id: string, fact: string, text: string) => ({ id, layout: 'texto' as const, titulo: text, frases: [{ texto: text, fatoId: fact }] });
    expect(cardVars(base, card('c2', a.fato, 'Ponte fecha'), 'carrossel')).toMatchObject({ SOURCE_NAME: 'Prefeitura', SOURCE_URL: expect.stringContaining('portal.example') });
    expect(cardVars(base, card('c3', b.fato, 'Praia limpa'), 'carrossel').SOURCE_NAME).toBe('Cetesb');
    expect(cardVars(base, { id: 'c1', layout: 'capa', titulo: 'R', frases: [] }, 'carrossel').SOURCE_NAME).toBe('várias fontes');
    expect(base.dataValor).toContain('nov');
    expect(base.dataLabel).toBe('Publicação');
    // The preview receives only `base` and the same result comes out of the same function.
    expect(JSON.parse(JSON.stringify(base)).fontesPorFato[b.fato].nome).toBe('Cetesb');
  });

  it('the prompt groups the facts by news item', async () => {
    const { pauta: lead } = await summary();
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ manchete: 'M', resumo: '', legenda: 'L', cards: [{ layout: 'capa', titulo: 'T', frases: [] }] }) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    await draftPiece(env, { pauta: lead, formato: 'carrossel' });
    const body = String(fetch.mock.calls[0][1]?.body);
    expect(body).toContain('Story 1:');
    expect(body).toContain('Story 3:');
    expect(body).toContain('one card per story');
  });
});

describe('cron and routes', () => {
  it('only enqueues whoever turned it on, and author outlets are left out', async () => {
    const [on, off, author] = [await seedTenant(), await seedTenant(), await seedTenant()];
    await env.DB.prepare('UPDATE tenants SET resumo_ligado = 1 WHERE id IN (?, ?)').bind(on, author).run();
    await env.DB.prepare("UPDATE tenants SET modo = 'autoral' WHERE id = ?").bind(author).run();
    const upload = vi.spyOn(env.MONITOR_QUEUE, 'sendBatch').mockResolvedValue(undefined as never);
    await scheduled({ cron: CRON_SUMMARY } as ScheduledController, env, {} as ExecutionContext);
    const targets = upload.mock.calls.flatMap((c) => [...c[0]]).map((m) => (m.body as { tenantId: string }).tenantId);
    expect(targets).toContain(on);
    expect(targets).not.toContain(off);
    expect(targets).not.toContain(author);
    upload.mockClear();
    await enqueueSummaries(env, DAY);
    expect((upload.mock.calls[0][0] as unknown as { body: unknown }[]).find((m) => (m.body as { tenantId: string }).tenantId === on)?.body).toEqual({ tipo: 'resumo', tenantId: on, dia: DAY });
  });

  it("the button: editor requests, a few get 409 with the sentence, again doesn't duplicate; reporter doesn't request", async () => {
    const t = await seedTenant();
    const s = await register();
    await seedMember(t, s.userId, 'editor');
    const r0 = await req(`/api/t/${t}/resumo`, { cookie: s.cookie, method: 'POST' });
    expect(r0.status).toBe(409);
    expect((await r0.json<{ erro: string }>()).erro).toContain('Só 0 notícias');
    for (const n of ['A', 'B', 'C']) await news(t, n);
    expect((await req(`/api/t/${t}/resumo`, { cookie: s.cookie, method: 'POST' })).status).toBe(201);
    expect((await req(`/api/t/${t}/resumo`, { cookie: s.cookie, method: 'POST' })).status).toBe(200);
    const o = await register();
    await seedMember(t, o.userId, 'reporter');
    expect((await req(`/api/t/${t}/resumo`, { cookie: o.cookie, method: 'POST' })).status).toBe(403);
  });

  it("turning it on is admin's, and the GET of the sources returns the state; another outlet gives 404", async () => {
    const t = await seedTenant();
    const a = await register();
    await seedMember(t, a.userId, 'admin');
    expect((await req(`/api/t/${t}/resumo`, { cookie: a.cookie, method: 'PATCH', body: { ligado: true } })).status).toBe(200);
    expect((await (await req(`/api/t/${t}/fontes`, { cookie: a.cookie })).json<{ resumoLigado: boolean }>()).resumoLigado).toBe(true);
    const e = await register();
    await seedMember(t, e.userId, 'editor');
    expect((await req(`/api/t/${t}/resumo`, { cookie: e.cookie, method: 'PATCH', body: { ligado: false } })).status).toBe(403);
    const outside = await register();
    expect((await req(`/api/t/${t}/resumo`, { cookie: outside.cookie, method: 'POST' })).status).toBe(404);
  });
});
