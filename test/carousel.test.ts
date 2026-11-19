// Phase 3: the customisable carousel. Converting an old piece, validation per layout and of names, editing in Review
// (revalidates, blocks approval, "my claim" only in the author outlet and only in a human version, render only of the
// changed cards, 409 on concurrent editing) and per-outlet isolation in editing and in photo upload. Fake Browser Rendering.
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeCards, type Card } from '../src/lib/cards';
import { validate } from '../src/lib/validation';
import { browserApi, renderCards, varsCard, type ArtRendered } from '../src/lib/render';
import { pair } from '../src/lib/typography';
import type { Lead } from '../src/lib/lead';
import type { Draft } from '../src/lib/drafting';
import { register, req, seedAccount, seedMember, seedLead, seedTenant, statusOf } from './helpers';

// ── fake browser: counts the cards assembled ─────────────────────────────────────────────────────────────────────
let built: string[] = [];
let fail: ((html: string) => boolean) | null = null;
const METRICS_OK = { width: 1080, height: 1350, overflow: [], overlap: false, headlineLines: 1, imagesLoaded: true, badText: false, fontsReady: true };
function fakeBrowser() {
  let html = '';
  const page = {
    on: () => {}, route: async () => {},
    setContent: async (h: string) => { html = h; built.push(h); },
    evaluate: async () => (fail?.(html) ? { ...METRICS_OK, overflow: ['story'] } : METRICS_OK),
    locator: () => ({ screenshot: async () => new Uint8Array([1, 2, 3]) }),
  };
  return Promise.resolve({ newPage: async () => page, close: async () => {} });
}
beforeEach(() => { built = []; fail = null; vi.spyOn(browserApi, 'abrir').mockImplementation(fakeBrowser as never); });
afterEach(() => vi.restoreAllMocks());

const leadPure = (over: Partial<Lead> = {}): Lead => ({
  id: 'p1', tenantId: 't', titulo: 'Ponte', resumo: null, editoria: 'cidade', municipioIbge: null, cidade: 'Guarujá', bairro: null,
  fatos: [
    { id: 'f1', documentoId: 'd', tipo: 'manchete', texto: 'Prefeitura interdita ponte da Avenida Santos Dumont para obras', municipioIbge: null, bairro: null, dataFato: null, fonteUrl: 'https://exemplo.gov.br/n', fonteNome: 'Prefeitura' },
    { id: 'f2', documentoId: 'd', tipo: 'data', texto: 'A interdição começa na segunda-feira, 2 de novembro, e dura 15 dias, disse o secretário Carlos Mendes', municipioIbge: null, bairro: null, dataFato: '2026-11-02', fonteUrl: 'https://exemplo.gov.br/n', fonteNome: 'Prefeitura' },
  ],
  marca: { nome: 'Gazeta' }, voz: {}, ...over,
});
const draft = (cards: Card[]): Draft => ({ manchete: 'Ponte da Santos Dumont fecha por 15 dias', resumo: '', legenda: 'A ponte fecha.', cards, modelo: 't', custoUsd: 0 });
const COVER: Card = { id: 'c1', layout: 'capa', titulo: 'Ponte da Santos Dumont fecha', frases: [] };
const INVITE: Card = { papel: 'convite', titulo: 'Siga', frases: [{ texto: 'Siga a página.', fatoId: null }] };

describe('old piece (fixed role) converted on read', () => {
  it('capa becomes capa, o_que_aconteceu and contexto become text, convite becomes convite; ids stable by role', () => {
    const old: Card[] = [
      { papel: 'capa', titulo: 'A', frases: [] }, { papel: 'o_que_aconteceu', titulo: 'B', frases: [] },
      { papel: 'contexto', titulo: 'C', frases: [] }, { papel: 'convite', titulo: 'D', frases: [] },
    ];
    expect(normalizeCards(old).map((c) => [c.id, c.layout])).toEqual([['capa', 'capa'], ['o_que_aconteceu', 'texto'], ['contexto', 'texto'], ['convite', 'convite']]);
    // Without an id or role (new model output): the position.
    expect(normalizeCards([{ layout: 'lista', titulo: 'x', frases: [] }]).map((c) => c.id)).toEqual(['c1']);
  });

  it('the old card comes out the same: same class and same top label', () => {
    const p = leadPure();
    expect(varsCard(p, { papel: 'o_que_aconteceu', titulo: 'T', frases: [] }, 'carrossel')).toMatchObject({ SLIDE_CLASS: 'detail', EYEBROW: 'O que aconteceu' });
    expect(varsCard(p, { papel: 'contexto', titulo: 'T', frases: [] }, 'carrossel')).toMatchObject({ SLIDE_CLASS: 'context', EYEBROW: 'Contexto' });
    expect(varsCard(p, { layout: 'texto', titulo: 'T', frases: [] }, 'carrossel')).toMatchObject({ SLIDE_CLASS: 'detail', EYEBROW: 'cidade' });
    expect(varsCard(p, { layout: 'citacao', titulo: 'T', frases: [] }, 'carrossel').SLIDE_CLASS).toBe('quote');
    // A font pair with a serif title: the class goes on the card.
    expect(varsCard(leadPure({ marca: { fontes: 'jornal' } }), { papel: 'capa', titulo: 'T', frases: [] }, 'carrossel').SLIDE_CLASS).toBe('cover titulo-destaque');
    expect(pair('qualquer')).toBe('padrao');
  });

  it('old piece opens in Review with the cards and the preview', async () => {
    const { s, t } = await member('editor');
    const { pautaId: leadId, fatos: facts } = await seedLead(t, 'em_producao');
    const id = await pieceCarousel(t, leadId, oldCards(facts[0].id), { artes: true });
    const res = await req(`/api/t/${t}/pecas/${id}`, { cookie: s.cookie });
    expect(res.status).toBe(200);
    const body = await res.json<{ artes: { papel: string; id: string | null }[]; previa: { base: { marcaNome: string }; convites: unknown[] } }>();
    expect(body.artes.map((a) => a.papel)).toEqual(['capa', 'o_que_aconteceu', 'convite']);
    expect(body.previa.base.marcaNome).toBe('Veículo');
  });
});

describe('validation by layout and of proper names', () => {
  it('each layout has its own limits', () => {
    const v = validate(leadPure(), draft([
      COVER,
      { id: 'q', layout: 'citacao', titulo: 'Prefeitura', frases: [{ texto: 'a', fatoId: 'f1' }, { texto: 'b', fatoId: 'f1' }] },
      { id: 'n', layout: 'numero', titulo: '15 dias de obras na ponte', frases: [{ texto: 'A interdição dura 15 dias.', fatoId: 'f2' }] },
      { id: 'l', layout: 'lista', titulo: 'O que muda', frases: [{ texto: 'x'.repeat(111), fatoId: 'f1' }] },
      INVITE,
    ]));
    expect(v.ok).toBe(false);
    expect(v.erros).toEqual(expect.arrayContaining(['card citacao: mais de 1 frase', 'card numero: título longo (25)', 'card lista: menos de 2 frases']));
    expect(v.porCard?.q).toEqual(['Citação leva no máximo 1 frase; este card tem 2.']);
    expect(v.porCard?.l).toEqual(expect.arrayContaining(['Um item da lista tem 111 caracteres; cabem 110.']));
  });

  it('a name not in the facts fails, on the card; names from the facts, the outlet and the city pass; all caps is emphasis', () => {
    const ok = validate(leadPure(), draft([COVER, { id: 't', layout: 'texto', titulo: 'Obras em Guarujá', frases: [{ texto: 'Segundo Carlos Mendes, a Gazeta acompanha a obra na Avenida Santos Dumont.', fatoId: 'f2' }] }, INVITE]));
    expect(ok).toMatchObject({ ok: true });
    const wrong = validate(leadPure(), draft([COVER, { id: 't', layout: 'texto', titulo: 'Obras na ponte', frases: [{ texto: 'O vereador Joaquim Prado criticou a obra.', fatoId: 'f1' }] }, INVITE]));
    expect(wrong.ok).toBe(false);
    expect(wrong.erros).toEqual(expect.arrayContaining(['nome "Joaquim" não aparece nos fatos (texto)', 'nome "Prado" não aparece nos fatos (texto)']));
    expect(wrong.porCard?.t?.[0]).toBe('"Joaquim" não aparece em nenhum fato da fonte. Tire o nome ou prenda a frase a um fato que o cite.');
    expect(validate(leadPure(), draft([COVER, { id: 't', layout: 'texto', titulo: 'ATENÇÃO MOTORISTAS', frases: [{ texto: 'A prefeitura interdita a ponte.', fatoId: 'f1' }] }, INVITE])).ok).toBe(true);
  });

  it('"afirmação minha": accepted in the author outlet in a human version; rejected in an AI version and outside the author outlet', () => {
    const cards = [COVER, { id: 't', layout: 'texto' as const, titulo: 'O que eu penso', frases: [{ texto: 'Acho que a obra vai atrasar 30 dias.', fatoId: null, autor: true }, { texto: 'A prefeitura interdita a ponte.', fatoId: 'f1' }] }, INVITE];
    const author = leadPure({ modo: 'autoral', marca: { nome: 'Cartas', ctaUrl: 'https://cartas.example' } });
    expect(validate(author, draft(cards), { humano: true })).toMatchObject({ ok: true });
    const ai = validate(author, draft(cards));
    expect(ai.ok).toBe(false);
    expect(ai.porCard?.t?.[0]).toContain('não foi escrita por uma pessoa');
    const local = validate(leadPure(), draft(cards), { humano: true });
    expect(local.ok).toBe(false);
    expect(local.porCard?.t?.[0]).toContain('só vale em veículo de autor');
  });
});

// ── editing through the API ──────────────────────────────────────────────────────────────────────────────────────

async function member(role: 'admin' | 'editor' | 'reporter' = 'editor', mode: 'local' | 'autoral' = 'local') {
  const s = await register();
  const t = await seedTenant();
  if (mode === 'autoral') await env.DB.prepare("UPDATE tenants SET modo = 'autoral' WHERE id = ?").bind(t).run();
  await seedMember(t, s.userId, role);
  return { s, t };
}

const oldCards = (factId: string): Card[] => [
  { papel: 'capa', titulo: 'Ponte da Santos Dumont fecha para obras', frases: [] },
  { papel: 'o_que_aconteceu', titulo: 'A prefeitura interdita a ponte', frases: [{ texto: 'A prefeitura interdita a ponte para obras.', fatoId: factId }] },
  { papel: 'convite', titulo: 'Seu bairro, com fonte.', frases: [{ texto: 'Siga @teste pra receber as notícias de perto.', fatoId: null }] },
];

async function pieceCarousel(t: string, leadId: string, cards: Card[], o: { artes?: boolean } = {}) {
  const id = crypto.randomUUID();
  const content = { manchete: 'Ponte da Santos Dumont fecha para obras', resumo: '', legenda: 'A ponte fecha.', cards, modelo: 'ia', custoUsd: 0 };
  const artwork = o.artes ? JSON.stringify(cards.map((c, i) => ({ papel: c.papel, png: `artes/${t}/${id}/v1/0${i + 1}.png`, jpg: `artes/${t}/${id}/v1/0${i + 1}.jpg`, metricas: {} }))) : null;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO pecas (id, tenant_id, pauta_id, formato, status, versao, rodada, conteudo_json, validacao_json, arte_r2_keys_json, workflow_id)
                    VALUES (?, ?, ?, 'carrossel', 'revisao', 1, 1, ?, '{"ok":true,"erros":[],"avisos":[]}', ?, ?)`).bind(id, t, leadId, JSON.stringify(content), artwork, `${id}-r1`),
    env.DB.prepare("INSERT INTO peca_versoes (id, tenant_id, peca_id, versao, rodada, conteudo_json, autor) VALUES (?, ?, ?, 1, 1, ?, 'ia')").bind(crypto.randomUUID(), t, id, JSON.stringify(content)),
  ]);
  return id;
}

/** The cards as the screen sends them: explicit id and layout, the old role kept. */
const asScreen = (cards: Card[]) => normalizeCards(cards).map(({ id, layout, papel: role, titulo: title, frases: sentences, imagem: image, cta }) => ({ id, layout, papel: role, titulo: title, frases: sentences, imagem: image, cta }));
const edit = (s: { cookie: string }, t: string, id: string, version: unknown, cards: unknown) =>
  req(`/api/t/${t}/pecas/${id}/cards`, { method: 'PUT', cookie: s.cookie, body: { versao: version, cards } });

describe('PUT cards: editing in Review', () => {
  it('sentence edited with a number outside the facts: saves the version, the reason stays on the card and Approve is refused until fixed', async () => {
    const { s, t } = await member('editor');
    const { pautaId: leadId, fatos: facts } = await seedLead(t, 'em_producao');
    const account = await seedAccount(t, 'manual');
    const id = await pieceCarousel(t, leadId, oldCards(facts[0].id), { artes: true });
    const cards = asScreen(oldCards(facts[0].id));
    cards[1].frases = [{ texto: 'A prefeitura interdita a ponte por 40 dias.', fatoId: facts[0].id }];

    const r1 = await edit(s, t, id, 1, cards);
    expect(r1.status).toBe(200);
    const c1 = await r1.json<{ versao: number; validacao: { ok: boolean; porCard: Record<string, string[]> }; renderizados: string[] }>();
    expect(c1.versao).toBe(2);
    expect(c1.validacao.ok).toBe(false);
    expect(c1.validacao.porCard.o_que_aconteceu).toEqual(['O número 40 não aparece em nenhum fato da fonte.']);
    expect(c1.renderizados).toEqual([]);   // reprovou: nada montado
    expect(built).toHaveLength(0);
    const version = await env.DB.prepare('SELECT autor, rodada FROM peca_versoes WHERE peca_id = ? AND versao = 2').bind(id).first<{ autor: string; rodada: number }>();
    expect(version).toEqual({ autor: s.userId, rodada: 1 });   // author = whoever saved; no round spent

    const blocked = await req(`/api/t/${t}/pecas/${id}/revisao`, { cookie: s.cookie, body: { decisao: 'aprovar', contaId: account, versao: 2 } });
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toEqual({ erro: 'a conferência apontou problema num card; corrija antes de aprovar' });

    cards[1].frases = [{ texto: 'A interdição dura 15 dias.', fatoId: facts[1].id }];
    const r2 = await edit(s, t, id, 2, cards);
    const c2 = await r2.json<{ versao: number; validacao: { ok: boolean }; renderizados: string[] }>();
    expect(c2).toMatchObject({ versao: 3, validacao: { ok: true } });
    expect(c2.renderizados).toHaveLength(3);   // an old piece, without a hash: assembles everything once
    expect((await req(`/api/t/${t}/pecas/${id}/revisao`, { cookie: s.cookie, body: { decisao: 'aprovar', contaId: account, versao: 3 } })).status).toBe(200);
    expect(await statusOf('pecas', id)).toBe('aprovada');
  });

  it('only changed cards are assembled again; the others reuse their keys', async () => {
    const { s, t } = await member('editor');
    const { pautaId: leadId, fatos: facts } = await seedLead(t, 'em_producao');
    const id = await pieceCarousel(t, leadId, oldCards(facts[0].id));
    const cards = asScreen(oldCards(facts[0].id));
    // Adds a list and changes a card's layout.
    cards.splice(2, 0, { id: 'novo-1', layout: 'lista', papel: undefined, titulo: 'O que muda', frases: [{ texto: 'Ponte interditada', fatoId: facts[0].id }, { texto: 'Obras por 15 dias', fatoId: facts[1].id }], imagem: undefined, cta: undefined });
    const r1 = await (await edit(s, t, id, 1, cards)).json<{ versao: number; renderizados: string[] }>();
    expect(r1.renderizados).toEqual(['capa', 'o_que_aconteceu', 'novo-1', 'convite']);
    const before = JSON.parse((await env.DB.prepare('SELECT arte_r2_keys_json AS a FROM pecas WHERE id = ?').bind(id).first<{ a: string }>())!.a) as ArtRendered[];
    expect(before.map((a) => a.layout)).toEqual(['capa', 'texto', 'lista', 'convite']);

    built = [];
    cards[0].titulo = 'Ponte da Santos Dumont fecha por 15 dias';
    // Reorders: the list comes before the text.
    [cards[1], cards[2]] = [cards[2], cards[1]];
    const r2 = await (await edit(s, t, id, r1.versao, cards)).json<{ renderizados: string[]; reaproveitados: string[] }>();
    expect(r2.renderizados).toEqual(['capa']);
    expect(r2.reaproveitados).toEqual(['novo-1', 'o_que_aconteceu', 'convite']);
    expect(built).toHaveLength(1);
    const after = JSON.parse((await env.DB.prepare('SELECT arte_r2_keys_json AS a FROM pecas WHERE id = ?').bind(id).first<{ a: string }>())!.a) as ArtRendered[];
    expect(after[1].jpg).toBe(before[2].jpg);
    expect(after[2].jpg).toBe(before[1].jpg);
    expect(after[0].jpg).not.toBe(before[0].jpg);
  });

  it("text that doesn't fit the card (layout QA): becomes an error on the card and nothing is assembled", async () => {
    const { s, t } = await member('editor');
    const { pautaId: leadId, fatos: facts } = await seedLead(t, 'em_producao');
    const id = await pieceCarousel(t, leadId, oldCards(facts[0].id));
    fail = (html) => html.includes('class="card detail');
    const r = await (await edit(s, t, id, 1, asScreen(oldCards(facts[0].id)))).json<{ validacao: { ok: boolean; porCard: Record<string, string[]> } }>();
    expect(r.validacao.ok).toBe(false);
    expect(r.validacao.porCard.o_que_aconteceu).toEqual(['O texto não cabe no card. Encurte o título ou as frases.']);
  });

  it('the CTA belongs to the brand: the text that comes is ignored and the editor only picks which (the caption swaps the closing)', async () => {
    const { s, t } = await member('editor');
    const ctas = [{ titulo: 'Seu bairro, com fonte.', texto: 'Checada contra a fonte.', legenda: 'Siga a página.' }, { titulo: 'Viu algo?', texto: 'Manda no direct.', legenda: 'Manda no direct.' }];
    await env.DB.prepare("UPDATE tenants SET marca_json = json_set(marca_json, '$.ctas', json(?)) WHERE id = ?").bind(JSON.stringify(ctas), t).run();
    const { pautaId: leadId, fatos: facts } = await seedLead(t, 'em_producao');
    const id = await pieceCarousel(t, leadId, oldCards(facts[0].id));
    const cards = asScreen(oldCards(facts[0].id));
    const invite = { ...cards[2], titulo: 'Inventado pelo editor', frases: [{ texto: 'Copy do editor', fatoId: null }], cta: 1 };
    const ok = await edit(s, t, id, 1, [...cards.slice(0, 2), invite]);
    expect(ok.status).toBe(200);
    const saved = JSON.parse((await env.DB.prepare('SELECT conteudo_json AS c FROM pecas WHERE id = ?').bind(id).first<{ c: string }>())!.c) as Draft;
    expect(saved.cards.at(-1)).toEqual({ id: 'convite', layout: 'convite', titulo: 'Viu algo?', frases: [{ texto: 'Manda no direct.', fatoId: null }], cta: 1 });
    expect((await edit(s, t, id, 2, [...cards.slice(0, 2), { ...invite, cta: 7 }])).status).toBe(400);
    // A carousel needs 2 to 10 cards and the CTA at the end.
    const withoutInvite = await (await edit(s, t, id, 2, cards.slice(0, 2))).json<{ validacao: { erros: string[] } }>();
    expect(withoutInvite.validacao.erros).toContain('o convite é o último card, e só um');
  });

  it('"afirmação minha" in the author outlet: accepted on edit; in a local outlet, rejected', async () => {
    for (const mode of ['autoral', 'local'] as const) {
      const { s, t } = await member('editor', mode);
      const { pautaId: leadId, fatos: facts } = await seedLead(t, 'em_producao');
      const id = await pieceCarousel(t, leadId, oldCards(facts[0].id));
      const cards = asScreen(oldCards(facts[0].id));
      cards[1].frases = [...cards[1].frases, { texto: 'Para mim a obra vai atrasar.', fatoId: null, autor: true }];
      const r = await (await edit(s, t, id, 1, cards)).json<{ validacao: { ok: boolean } }>();
      expect([mode, r.validacao.ok]).toEqual([mode, mode === 'autoral']);
    }
  });

  it('concurrent edit: whoever saves with the old version gets 409 and nothing changes', async () => {
    const { s, t } = await member('editor');
    const other = await register();
    await seedMember(t, other.userId, 'editor');
    const { pautaId: leadId, fatos: facts } = await seedLead(t, 'em_producao');
    const id = await pieceCarousel(t, leadId, oldCards(facts[0].id));
    const cards = asScreen(oldCards(facts[0].id));
    expect((await edit(other, t, id, 1, cards)).status).toBe(200);
    cards[0].titulo = 'Outra manchete da ponte';
    const late = await edit(s, t, id, 1, cards);
    expect(late.status).toBe(409);
    expect((await late.json<{ erro: string }>()).erro).toContain('outra pessoa salvou antes');
    expect((await env.DB.prepare('SELECT versao FROM pecas WHERE id = ?').bind(id).first<{ versao: number }>())?.versao).toBe(2);
    expect((await edit(s, t, id, 'dois', cards)).status).toBe(400);
  });

  it("isolation: piece from another outlet is 404; reporter doesn't edit; photo from another piece doesn't get into the card", async () => {
    const { s, t } = await member('editor');
    const { s: foreignItem, t: other } = await member('editor');
    const { pautaId: leadId, fatos: facts } = await seedLead(t, 'em_producao');
    const id = await pieceCarousel(t, leadId, oldCards(facts[0].id));
    const cards = asScreen(oldCards(facts[0].id));
    expect((await edit(foreignItem, t, id, 1, cards)).status).toBe(404);
    expect((await edit(foreignItem, other, id, 1, cards)).status).toBe(404);
    const reporter = await register();
    await seedMember(t, reporter.userId, 'reporter');
    expect((await edit(reporter, t, id, 1, cards)).status).toBe(403);

    // Photo: only for the outlet's own piece; another outlet's key (or another piece's) does not go into the card.
    expect((await req(`/api/t/${other}/pecas/${id}/fotos`, { cookie: foreignItem.cookie, cru: { tipo: 'image/png', corpo: PNG } })).status).toBe(404);
    expect((await req(`/api/t/${t}/pecas/${id}/fotos`, { cookie: foreignItem.cookie, cru: { tipo: 'image/png', corpo: PNG } })).status).toBe(404);
    expect((await req(`/api/t/${t}/pecas/${id}/fotos`, { cookie: reporter.cookie, cru: { tipo: 'image/png', corpo: PNG } })).status).toBe(403);
    await env.MEDIA.put(`fotos/${other}/${id}/x.png`, PNG);
    const foreign = await edit(s, t, id, 1, cards.map((c, i) => (i === 1 ? { ...c, imagem: `fotos/${other}/${id}/x.png` } : c)));
    expect(foreign.status).toBe(400);
  });

  it('own photo: JPEG, PNG or SVG up to 2 MB, with origin and framing; goes in as the card art', async () => {
    const { s, t } = await member('editor');
    const { pautaId: leadId, fatos: facts } = await seedLead(t, 'em_producao');
    const id = await pieceCarousel(t, leadId, oldCards(facts[0].id));
    expect((await req(`/api/t/${t}/pecas/${id}/fotos`, { cookie: s.cookie, cru: { tipo: 'image/gif', corpo: PNG } })).status).toBe(415);
    // The declared type is not enough: the bytes must be JPEG.
    expect((await req(`/api/t/${t}/pecas/${id}/fotos`, { cookie: s.cookie, cru: { tipo: 'image/jpeg', corpo: PNG } })).status).toBe(400);
    expect((await req(`/api/t/${t}/pecas/${id}/fotos`, { cookie: s.cookie, cru: { tipo: 'image/png', corpo: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]) } })).status).toBe(400);
    const large = new Uint8Array(2 * 1024 * 1024 + 10); large.set(PNG);
    expect((await req(`/api/t/${t}/pecas/${id}/fotos`, { cookie: s.cookie, cru: { tipo: 'image/png', corpo: large } })).status).toBe(413);
    // Larger than the old 512 KB cap, like a phone photo after shrinking.
    const jpeg = new Uint8Array(700 * 1024); jpeg.set([0xff, 0xd8, 0xff, 0xe0]);
    const upJpeg = await req(`/api/t/${t}/pecas/${id}/fotos`, { cookie: s.cookie, cru: { tipo: 'image/jpeg', corpo: jpeg } });
    expect(upJpeg.status).toBe(201);
    expect((await upJpeg.json<{ chave: string }>()).chave).toMatch(/\.jpg$/);
    const up = await req(`/api/t/${t}/pecas/${id}/fotos`, { cookie: s.cookie, cru: { tipo: 'image/png', corpo: PNG } });
    expect(up.status).toBe(201);
    const { chave: key, url } = await up.json<{ chave: string; url: string }>();
    expect(key.startsWith(`fotos/${t}/${id}/`)).toBe(true);
    expect(url).toContain('/media/fotos/');
    const withoutOrigin = await edit(s, t, id, 1, asScreen(oldCards(facts[0].id)).map((c, i) => (i === 1 ? { ...c, imagem: key } : c)));
    expect(withoutOrigin.status).toBe(400);
    expect((await withoutOrigin.json<{ erro: string }>()).erro).toBe('Card 2: diga quem fez a foto');
    const withOrigin = (o: unknown, focus?: unknown) => edit(s, t, id, 1, asScreen(oldCards(facts[0].id)).map((c, i) => (i === 1 ? { ...c, imagem: key, fotoOrigem: o, foco: focus } : c)));
    expect((await withOrigin({ autor: '', tipo: 'minha' })).status).toBe(400);
    expect((await withOrigin({ autor: 'x'.repeat(81), tipo: 'minha' })).status).toBe(400);
    expect((await withOrigin({ autor: 'Ana', tipo: 'agencia' })).status).toBe(400);
    expect((await withOrigin({ autor: 'Ana', tipo: 'minha' }, 'meio')).status).toBe(400);
    const cards = asScreen(oldCards(facts[0].id)).map((c, i) => (i === 1 ? { ...c, imagem: key, fotoOrigem: { autor: 'Ana Costa', tipo: 'equipe' as const }, foco: 'topo' as const } : c));
    expect((await edit(s, t, id, 1, cards)).status).toBe(200);
    expect(built.find((h) => h.includes('alt="Foto do veículo"'))).toContain('class="card detail photo');
    const body = await (await req(`/api/t/${t}/pecas/${id}`, { cookie: s.cookie })).json<{ previa: { imagens: Record<string, string> } }>();
    expect(Object.keys(body.previa.imagens)).toEqual([key]);
  });
});

describe("render without changes: doesn't open the browser", () => {
  it('all cards with the same HTML reuse the keys', async () => {
    const t = await seedTenant();
    const lead = leadPure({ tenantId: t });
    const r = draft([COVER, { id: 'c2', layout: 'texto', titulo: 'Obras', frases: [{ texto: 'A prefeitura interdita a ponte.', fatoId: 'f1' }] }, INVITE]);
    const first = await renderCards(env, { tenantId: t, pecaId: 'p', versao: 1, formato: 'carrossel', rascunho: r, pauta: lead });
    expect(built).toHaveLength(3);
    built = [];
    const open = vi.mocked(browserApi.abrir);
    open.mockClear();
    const second = await renderCards(env, { tenantId: t, pecaId: 'p', versao: 2, formato: 'carrossel', rascunho: r, pauta: lead, anteriores: first });
    expect(open).not.toHaveBeenCalled();
    expect(second.map((a) => a.jpg)).toEqual(first.map((a) => a.jpg));
  });
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);

describe('brand: font pair', () => {
  it('admin picks one of the pairs; a value outside the catalog is 400; the card uses the chosen pair', async () => {
    const { s, t } = await member('admin');
    const ok = await req(`/api/t/${t}/marca`, { method: 'PATCH', cookie: s.cookie, body: { fontes: 'jornal' } });
    expect(ok.status).toBe(200);
    expect((await ok.json<{ marca: { fontes?: string } }>()).marca.fontes).toBe('jornal');
    expect((await req(`/api/t/${t}/marca`, { method: 'PATCH', cookie: s.cookie, body: { fontes: 'comic-sans' } })).status).toBe(400);
    const brand = JSON.parse((await env.DB.prepare('SELECT marca_json AS m FROM tenants WHERE id = ?').bind(t).first<{ m: string }>())!.m);
    expect(brand.fontes).toBe('jornal');
    // The default does not appear in the response (the screen shows the default as marked).
    const fallback = await req(`/api/t/${t}/marca`, { method: 'PATCH', cookie: s.cookie, body: { fontes: 'padrao' } });
    expect((await fallback.json<{ marca: { fontes?: string } }>()).marca.fontes).toBeUndefined();

    const r = draft([COVER, { id: 'c2', layout: 'texto', titulo: 'Obras', frases: [{ texto: 'A prefeitura interdita a ponte.', fatoId: 'f1' }] }, INVITE]);
    await renderCards(env, { tenantId: t, pecaId: 'p', versao: 1, formato: 'carrossel', rascunho: r, pauta: leadPure({ tenantId: t, marca: { nome: 'G', fontes: 'grotesca' } }) });
    expect(built[0]).toContain('font-weight: 100 900');
    expect(built[0]).toContain('class="card cover titulo-destaque"');
  });
});

// ── review fixes (Codex) ─────────────────────────────────────────────────────────────────────────────────────────

describe('fixes from the Phase 3 review', () => {
  it('art keys: each assembled card has its own (the content hash goes into the key), no collision after reordering', async () => {
    const { s, t } = await member('editor');
    const { pautaId: leadId, fatos: facts } = await seedLead(t, 'em_producao');
    const id = await pieceCarousel(t, leadId, oldCards(facts[0].id));
    const cards = asScreen(oldCards(facts[0].id));
    cards.splice(2, 0, { id: 'n1', layout: 'texto', papel: undefined, titulo: 'A interdição dura 15 dias', frases: [{ texto: 'A interdição dura 15 dias.', fatoId: facts[1].id }], imagem: undefined, cta: undefined });
    const r1 = await (await edit(s, t, id, 1, cards)).json<{ versao: number }>();
    [cards[1], cards[2]] = [cards[2], cards[1]];
    cards[1].titulo = 'Interdição de 15 dias';
    await edit(s, t, id, r1.versao, cards);
    const artwork = JSON.parse((await env.DB.prepare('SELECT arte_r2_keys_json AS a FROM pecas WHERE id = ?').bind(id).first<{ a: string }>())!.a) as ArtRendered[];
    expect(new Set(artwork.map((a) => a.jpg)).size).toBe(artwork.length);
    expect(new Set(artwork.map((a) => a.png)).size).toBe(artwork.length);
    for (const a of artwork) expect(a.jpg).toContain(a.hash!.slice(0, 12));
  });

  it('Approve checks the version and the check in the same batch: version swapped or failed midway aborts', async () => {
    const { guardVersionApprovable } = await import('../src/lib/approve');
    const { t } = await member('editor');
    const { pautaId: leadId, fatos: facts } = await seedLead(t, 'em_producao');
    const id = await pieceCarousel(t, leadId, oldCards(facts[0].id));
    await expect(env.DB.batch([guardVersionApprovable(env, t, id, 1)])).resolves.toBeTruthy();
    await expect(env.DB.batch([guardVersionApprovable(env, t, id, 2)])).rejects.toThrow(/malformed JSON/);
    await expect(env.DB.batch([guardVersionApprovable(env, 'outro', id, 1)])).rejects.toThrow(/malformed JSON/);
    await env.DB.prepare(`UPDATE pecas SET validacao_json = '{"ok":false,"erros":["x"],"avisos":[]}' WHERE id = ?`).bind(id).run();
    await expect(env.DB.batch([guardVersionApprovable(env, t, id, 1)])).rejects.toThrow(/malformed JSON/);
  });

  it('old cover that gets a sentence becomes a new cover: the role goes and the sentence appears on the card', async () => {
    const { s, t } = await member('editor');
    const { pautaId: leadId, fatos: facts } = await seedLead(t, 'em_producao');
    const id = await pieceCarousel(t, leadId, oldCards(facts[0].id));
    const cards = asScreen(oldCards(facts[0].id));
    cards[0].frases = [{ texto: 'A prefeitura interdita a ponte para obras.', fatoId: facts[0].id }];
    expect((await edit(s, t, id, 1, cards)).status).toBe(200);
    const saved = JSON.parse((await env.DB.prepare('SELECT conteudo_json AS c FROM pecas WHERE id = ?').bind(id).first<{ c: string }>())!.c) as Draft;
    expect(saved.cards[0]).toMatchObject({ id: 'capa', layout: 'capa' });
    expect(saved.cards[0].papel).toBeUndefined();
    expect(built[0]).toContain('A prefeitura interdita a ponte para obras.');
  });

  it('card id that is a property name (__proto__, constructor) is refused', async () => {
    const { s, t } = await member('editor');
    const { pautaId: leadId, fatos: facts } = await seedLead(t, 'em_producao');
    const id = await pieceCarousel(t, leadId, oldCards(facts[0].id));
    for (const bad of ['constructor', 'toString', '__proto__']) {
      const cards = asScreen(oldCards(facts[0].id)).map((c, i) => (i === 1 ? { ...c, id: bad } : c));
      expect([bad, (await edit(s, t, id, 1, cards)).status]).toEqual([bad, 400]);
    }
    // In validation, the per-card map inherits nothing.
    expect(validate(leadPure(), draft([COVER, { id: 'c2', layout: 'texto', titulo: 'Obras', frases: [{ texto: 'A prefeitura interdita a ponte.', fatoId: 'f1' }] }, INVITE])).porCard?.constructor).toBeUndefined();
  });

  it("quote is literal: the fact's excerpt passes (quotes, case and final period set aside); a paraphrase fails on the card", () => {
    const citation = (text: string): Card => ({ id: 'q', layout: 'citacao', titulo: 'Carlos Mendes, secretário', frases: [{ texto: text, fatoId: 'f2' }] });
    expect(validate(leadPure(), draft([COVER, citation('“A interdição começa na segunda-feira, 2 de novembro, e dura 15 dias.”'), INVITE])).ok).toBe(true);
    const paraphrase = validate(leadPure(), draft([COVER, citation('A ponte fecha na segunda por 15 dias.'), INVITE]));
    expect(paraphrase.ok).toBe(false);
    expect(paraphrase.porCard?.q).toEqual(['A citação precisa ser o trecho exato do fato, palavra por palavra. Copie a frase do fato ou use o layout Texto.']);
  });

  it('what is not from a card gets a plain reason under `geral`: headline, caption, CTA outside the end', () => {
    const r = { ...draft([COVER, { id: 't', layout: 'texto' as const, titulo: 'Obras', frases: [{ texto: 'A prefeitura interdita a ponte.', fatoId: 'f1' }] }]), manchete: 'Ponte fecha por 40 dias', legenda: 'A ponte fecha por 40 dias.' };
    const v = validate(leadPure(), r, { formato: 'carrossel' });
    expect(v.ok).toBe(false);
    expect(v.porCard).toBeUndefined();
    expect(v.geral).toEqual(['O número 40 da manchete ou da legenda não aparece em nenhum fato da fonte.', 'O convite é o último card, e só um.']);
    expect(validate(leadPure(), draft([COVER, { id: 't', layout: 'texto', titulo: 'Obras', frases: [{ texto: 'A prefeitura interdita a ponte.', fatoId: 'f1' }] }, INVITE])).geral).toBeUndefined();
  });

  it('caption closing: recognizes the one from any CTA and the one from a CTA the brand already swapped', async () => {
    const { fromCaptionBody, closingCaption, swapClosing } = await import('../src/lib/drafting');
    const ctas = [{ titulo: 'A', texto: 'a', legenda: 'Siga a página.' }, { titulo: 'B', texto: 'b', legenda: 'Manda no direct.' }];
    const p = leadPure({ marca: { nome: 'Gazeta', ctas } });
    const body = 'A ponte fecha.';
    expect(fromCaptionBody(p, `${body}${closingCaption(p, 1)}`)).toEqual({ corpo: body, fecho: true });
    // The brand changed the CTA text after the piece was generated: the old closing still comes out.
    const old = `${body}\n\nSiga a Gazeta no feed.\n\nFonte: Prefeitura`;
    expect(fromCaptionBody(p, old)).toEqual({ corpo: body, fecho: true });
    expect(swapClosing(p, old, 1)).toBe(`${body}${closingCaption(p, 1)}`);
    // Without a recognisable closing, the caption stays as is.
    expect(swapClosing(p, 'Só o texto.', 1)).toBe('Só o texto.');
    // A number in the old closing does not count as a model number.
    const cards: Card[] = [COVER, { id: 't', layout: 'texto', titulo: 'Obras', frases: [{ texto: 'A prefeitura interdita a ponte.', fatoId: 'f1' }] }, INVITE];
    expect(validate(p, { ...draft(cards), legenda: `${body}\n\nSiga a Gazeta, 24 horas.\n\nFonte: Prefeitura` }).ok).toBe(true);
  });

  it('the preview and the edit use the illustration the current version used', async () => {
    const { s, t } = await member('editor');
    const { pautaId: leadId, fatos: facts } = await seedLead(t, 'em_producao');
    const id = await pieceCarousel(t, leadId, oldCards(facts[0].id));
    const art = `ilustracoes/${t}/${id}/v1.png`;
    const artwork = oldCards(facts[0].id).map((c, i) => ({ papel: c.papel, id: c.papel, layout: 'texto', png: `artes/${t}/${id}/v1/0${i + 1}.png`, jpg: `artes/${t}/${id}/v1/0${i + 1}.jpg`, hash: `h${i}`, arte: art, metricas: {} }));
    await env.DB.prepare('UPDATE pecas SET arte_r2_keys_json = ? WHERE id = ?').bind(JSON.stringify(artwork), id).run();
    // A newer illustration recorded later (from a round that did not become the current version) does not go in.
    await env.DB.prepare("INSERT INTO eventos (tenant_id, tipo, ref_tipo, ref_id, payload_json) VALUES (?, 'peca.ilustracao', 'peca', ?, ?)").bind(t, id, JSON.stringify({ r2Key: `ilustracoes/${t}/${id}/outra.png` })).run();
    const body = await (await req(`/api/t/${t}/pecas/${id}`, { cookie: s.cookie })).json<{ previa: { arte: string } }>();
    expect(body.previa.arte).toContain(`/media/ilustracoes/${t}/${id}/v1.png`);
  });
});
