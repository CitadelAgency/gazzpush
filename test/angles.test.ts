// Checked hook: three headlines by angle, each revalidated on a copy of the draft. DeepSeek is simulated through fetch.
// Covers a candidate that invents a number or a name, none approved, the cost added to the piece, the cap, an old
// version, IDOR and roles, and the chosen headline going through PUT cards.
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deepseekCost } from '../src/lib/deepseek';
import { checkCandidates, withHeadline, promptHook } from '../src/lib/angles';
import type { Lead } from '../src/lib/lead';
import type { Draft } from '../src/lib/drafting';
import { browserApi } from '../src/lib/render';
import { register, eventsOf, req, seedMember, seedLead, seedTenant } from './helpers';

let answer: unknown = { manchetes: [] };
const requests: { messages: { content: string }[] }[] = [];

beforeEach(() => {
  requests.length = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_u, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({ choices: [{ message: { content: JSON.stringify(answer) } }], usage: { prompt_tokens: 1000, completion_tokens: 100 } });
  });
  const page = { on: () => {}, route: async () => {}, setContent: async () => {}, evaluate: async () => ({ width: 1080, height: 1350, overflow: [], overlap: false, headlineLines: 2, imagesLoaded: true, badText: false, fontsReady: true }), locator: () => ({ screenshot: async () => new Uint8Array([1]) }) };
  vi.spyOn(browserApi, 'abrir').mockImplementation((() => Promise.resolve({ newPage: async () => page, close: async () => {} })) as never);
});
afterEach(() => vi.restoreAllMocks());

const lead: Lead = {
  id: 'p', tenantId: 't', titulo: 'Ponte', resumo: null, editoria: 'cidade', municipioIbge: null, cidade: 'Guarujá', bairro: null,
  fatos: [{ id: 'f1', documentoId: 'd', tipo: 'manchete', texto: 'Prefeitura interdita ponte da Avenida Santos Dumont por 15 dias', municipioIbge: null, bairro: null, dataFato: null, fonteUrl: 'https://exemplo.gov.br/n', fonteNome: 'Prefeitura' }],
  marca: { nome: 'Gazeta' }, voz: {},
};
const draft: Draft = {
  manchete: 'Ponte fecha', resumo: '', legenda: 'A ponte fecha.', modelo: 't', custoUsd: 0,
  cards: [
    { id: 'c1', layout: 'capa', titulo: 'Ponte fecha', frases: [] },
    { id: 'c2', layout: 'texto', titulo: 'Interdição', frases: [{ texto: 'A prefeitura interdita a ponte.', fatoId: 'f1' }] },
    { id: 'convite', layout: 'convite', titulo: 'Siga', frases: [{ texto: 'Siga a página.', fatoId: null }] },
  ],
};
const ANGLES = ['numero', 'consequencia', 'servico'] as const;

describe('check of the candidates', () => {
  it('number and name outside the facts, long title and repeated one are dropped; the good one stays', () => {
    const { opcoes: options, reprovadas: failed } = checkCandidates(lead, draft, 'carrossel', {
      manchetes: [
        { angulo: 'numero', titulo: 'Ponte fecha por 15 dias' },
        { angulo: 'consequencia', titulo: 'Ponte fecha por 30 dias' },
        { angulo: 'servico', titulo: 'Secretário Fulano fecha a ponte' },
      ],
    }, ANGLES);
    expect(options).toEqual([{ angulo: 'numero', titulo: 'Ponte fecha por 15 dias' }]);
    expect(failed).toBe(2);
    expect(checkCandidates(lead, draft, 'carrossel', { manchetes: [{ angulo: 'numero', titulo: 'x'.repeat(91) }] }, ANGLES).opcoes).toEqual([]);
    expect(checkCandidates(lead, draft, 'carrossel', { manchetes: [{ angulo: 'numero', titulo: 'Igual' }, { angulo: 'servico', titulo: 'Igual' }] }, ANGLES).opcoes).toHaveLength(1);
    expect(checkCandidates(lead, draft, 'carrossel', 'lixo', ANGLES)).toEqual({ opcoes: [], reprovadas: 0 });
  });

  it("an error the version already had doesn't fail the headline", () => {
    const bad: Draft = { ...draft, legenda: 'Fecha por 99 dias.' };
    expect(checkCandidates(lead, bad, 'carrossel', { manchetes: [{ angulo: 'numero', titulo: 'Ponte fecha por 15 dias' }] }, ANGLES).opcoes).toHaveLength(1);
  });

  it("the copy swaps headline and cover and doesn't touch the original; the angles change in the author outlet", () => {
    const copy = withHeadline(draft, 'Nova')!;
    expect(copy.manchete).toBe('Nova');
    expect(copy.cards[0].titulo).toBe('Nova');
    expect(draft.cards[0].titulo).toBe('Ponte fecha');
    expect(withHeadline({ ...draft, cards: [draft.cards[1]] }, 'Nova')).toBeNull();
    expect(promptHook(lead, 'x').angulos).toEqual(ANGLES);
    expect(promptHook({ ...lead, modo: 'autoral' }, 'x').angulos).toEqual(['tese', 'exemplo', 'pergunta']);
    expect(promptHook({ ...lead, idioma: 'en' }, 'x').system).toContain('in English');
  });
});

async function member(role: 'admin' | 'editor' | 'reporter' = 'editor') {
  const s = await register();
  const t = await seedTenant();
  await seedMember(t, s.userId, role);
  return { s, t };
}

async function carousel(t: string, o: { status?: string; formato?: string; custo?: number } = {}) {
  const { pautaId: leadId, fatos: facts } = await seedLead(t, 'em_producao');
  const id = crypto.randomUUID();
  const content = {
    manchete: 'Ponte fecha', resumo: '', legenda: 'A ponte fecha.', modelo: 'ia', custoUsd: 0,
    cards: [
      { id: 'c1', layout: 'capa', titulo: 'Ponte fecha', frases: [] },
      { id: 'c2', layout: 'texto', titulo: 'Interdição', frases: [{ texto: 'A prefeitura interdita a ponte.', fatoId: facts[0].id }] },
      { id: 'convite', layout: 'convite', titulo: 'Siga', frases: [{ texto: 'Siga a página.', fatoId: null }] },
    ],
  };
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO pecas (id, tenant_id, pauta_id, formato, status, versao, rodada, custo_usd, conteudo_json, validacao_json, arte_r2_keys_json, workflow_id)
                    VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, '{"ok":true,"erros":[],"avisos":[]}', '[]', ?)`).bind(id, t, leadId, o.formato ?? 'carrossel', o.status ?? 'revisao', o.custo ?? 0, JSON.stringify(content), `${id}-r1`),
    env.DB.prepare("INSERT INTO peca_versoes (id, tenant_id, peca_id, versao, rodada, conteudo_json, autor) VALUES (?, ?, ?, 1, 1, ?, 'ia')").bind(crypto.randomUUID(), t, id, JSON.stringify(content)),
  ]);
  return { id, conteudo: content };
}

const request = (s: { cookie: string }, t: string, id: string, version: unknown = 1) => req(`/api/t/${t}/pecas/${id}/ganchos`, { cookie: s.cookie, body: { versao: version } });
const costOf = async (id: string) => (await env.DB.prepare('SELECT custo_usd AS c FROM pecas WHERE id = ?').bind(id).first<{ c: number }>())!.c;

describe('POST ganchos', () => {
  it("returns only the approved ones, adds the cost to the piece, records the event and doesn't store the text", async () => {
    const { s, t } = await member();
    const { id } = await carousel(t);
    answer = { manchetes: [{ angulo: 'numero', titulo: 'Ponte fecha por 15 dias' }, { angulo: 'consequencia', titulo: 'Ponte fecha por 40 dias' }] };
    const res = await request(s, t, id);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ opcoes: [{ angulo: 'numero', titulo: 'Ponte fecha por 15 dias' }], reprovadas: 1 });
    expect(requests).toHaveLength(1);
    expect(requests[0].messages[0].content).toContain('COVER HEADLINES.');
    expect(requests[0].messages[1].content).toContain('Prefeitura interdita ponte');
    const cost = deepseekCost({ entrada: 1000, saida: 100 });
    expect(await costOf(id)).toBeCloseTo(cost, 9);
    const event = (await eventsOf(id)).find((e) => e.tipo === 'peca.ganchos')!;
    expect(event.payload).toMatchObject({ versao: 1, aprovadas: 1, reprovadas: 1 });
    const saved = JSON.parse((await env.DB.prepare('SELECT conteudo_json AS c FROM pecas WHERE id = ?').bind(id).first<{ c: string }>())!.c);
    expect(saved.manchete).toBe('Ponte fecha');
  });

  it('none approved: empty list, and the cost counts the same way', async () => {
    const { s, t } = await member();
    const { id } = await carousel(t);
    answer = { manchetes: [{ angulo: 'numero', titulo: 'Ponte fecha por 40 dias' }] };
    expect(await (await request(s, t, id)).json()).toMatchObject({ opcoes: [], reprovadas: 1 });
    expect(await costOf(id)).toBeGreaterThan(0);
  });

  it('old version 409, no version 400, outside review 409, Reels 400, cost cap 409; without calling the model', async () => {
    const { s, t } = await member();
    const { id } = await carousel(t);
    expect((await request(s, t, id, 9)).status).toBe(409);
    expect((await request(s, t, id, 'x')).status).toBe(400);
    expect((await request(s, t, (await carousel(t, { status: 'aprovada' })).id)).status).toBe(409);
    expect((await request(s, t, (await carousel(t, { formato: 'reels' })).id)).status).toBe(400);
    const face = await request(s, t, (await carousel(t, { custo: 0.25 })).id);
    expect(face.status).toBe(409);
    expect((await face.json<{ erro: string }>()).erro).toContain('teto');
    expect(requests).toHaveLength(0);
  });

  it('IDOR and roles: another outlet is 404; reporter is 403', async () => {
    const { s, t } = await member();
    const { id } = await carousel(t);
    const { s: foreign, t: other } = await member();
    expect((await request(foreign, t, id)).status).toBe(404);
    expect((await request(foreign, other, id)).status).toBe(404);
    const reporter = await register();
    await seedMember(t, reporter.userId, 'reporter');
    expect((await request(reporter, t, id)).status).toBe(403);
    expect(requests).toHaveLength(0);
  });
});

describe('PUT cards with headline', () => {
  it('the chosen headline goes with the cover and goes through the check', async () => {
    const { s, t } = await member();
    const { id, conteudo: content } = await carousel(t);
    const cards = content.cards.map((c, i) => (i === 0 ? { ...c, titulo: 'Ponte fecha por 15 dias' } : c));
    const res = await req(`/api/t/${t}/pecas/${id}/cards`, { method: 'PUT', cookie: s.cookie, body: { versao: 1, cards, manchete: 'Ponte fecha por 15 dias' } });
    expect(res.status).toBe(200);
    const saved = JSON.parse((await env.DB.prepare('SELECT conteudo_json AS c FROM pecas WHERE id = ?').bind(id).first<{ c: string }>())!.c);
    expect(saved.manchete).toBe('Ponte fecha por 15 dias');
    expect((await req(`/api/t/${t}/pecas/${id}/cards`, { method: 'PUT', cookie: s.cookie, body: { versao: 2, cards, manchete: 7 } })).status).toBe(400);
    const invented = await (await req(`/api/t/${t}/pecas/${id}/cards`, { method: 'PUT', cookie: s.cookie, body: { versao: 2, cards, manchete: 'Ponte fecha por 99 dias' } })).json<{ validacao: { ok: boolean } }>();
    expect(invented.validacao.ok).toBe(false);
  });
});
