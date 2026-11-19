// Phase 1: the advertiser post. A briefing becomes an advertising lead with the whole body as facts; the label comes out
// by code on the badge, in the footer and in the caption, in both languages; a price compares as a whole token; the
// advertiser approves through a link without an account, and the GET never decides; the receipt only comes from a
// published piece. Fake models and Browser Rendering.
import { env } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLink, htmlReceipt, adPage } from '../src/lib/ad';
import type { Card } from '../src/lib/cards';
import { loadLead, type Lead } from '../src/lib/lead';
import { openingAdvertising, fromCaptionBody, closingCaption, draftPiece, type Draft } from '../src/lib/drafting';
import { baseCard, browserApi, prepareCards, varsCard } from '../src/lib/render';
import { validate } from '../src/lib/validation';
import { register, ORIGIN, req, seedAccount, seedMember, seedTenant } from './helpers';

const BRIEFING = 'Promoção do Mercado Bom Preço no Guarujá. O quilo do tomate sai por R$ 19,90 até sábado. A loja fica na Rua Montenegro.';
const TRIAGE = { tipo: 'acontecimento', tipo_span: 0, editoria: 'cidade', editoria_span: 0, ocorreu_em: null, data_span: null, locais: [] };
let model: unknown = {};
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

beforeEach(() => {
  vi.spyOn(env.AI, 'run').mockImplementation((async () => ({ response: TRIAGE })) as never);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ choices: [{ message: { content: JSON.stringify(model) } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }));
  const page = { route: async () => {}, setContent: async () => {}, pdf: async () => PDF };
  vi.spyOn(browserApi, 'abrir').mockImplementation((() => Promise.resolve({ newPage: async () => page, close: async () => {} })) as never);
});
afterEach(() => vi.restoreAllMocks());

async function member(role: 'admin' | 'editor' | 'reporter' = 'editor') {
  const s = await register();
  const t = await seedTenant();
  await seedMember(t, s.userId, role);
  return { s, t };
}

const bring = (s: { cookie: string }, t: string, ad: unknown = { anunciante: 'Mercado Bom Preço', briefing: BRIEFING }) =>
  req(`/api/t/${t}/pautas`, { cookie: s.cookie, body: { anuncio: ad } });

/** A real advertising lead (through the POST) and its piece in review. */
async function piece(s: { cookie: string }, t: string, o: { status?: string; contaId?: string } = {}) {
  const { pautaId: leadId } = await (await bring(s, t, { anunciante: `Mercado ${crypto.randomUUID().slice(0, 6)}`, briefing: BRIEFING })).json<{ pautaId: string }>();
  const lead = await loadLead(env, t, leadId);
  const fact = lead.fatos[0].id;
  const id = crypto.randomUUID();
  const content: Draft = {
    manchete: 'Tomate por R$ 19,90', resumo: '', modelo: 'ia', custoUsd: 0,
    legenda: `${openingAdvertising(lead)}\n\nTomate em promoção.${closingCaption(lead)}`,
    cards: [{ id: 'c1', layout: 'capa', titulo: 'Tomate por R$ 19,90', frases: [{ texto: 'O quilo do tomate sai por R$ 19,90.', fatoId: fact }] }],
  };
  const artwork = [{ papel: 'capa', id: 'c1', layout: 'capa', png: `artes/${t}/${id}/1.png`, jpg: `artes/${t}/${id}/1.jpg`, hash: 'h', metricas: {} }];
  await env.MEDIA.put(artwork[0].jpg, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { httpMetadata: { contentType: 'image/jpeg' } });
  await env.DB.prepare(`INSERT INTO pecas (id, tenant_id, pauta_id, formato, status, versao, conteudo_json, validacao_json, arte_r2_keys_json, workflow_id, conta_id)
                        VALUES (?, ?, ?, 'post', ?, 1, ?, '{"ok":true,"erros":[],"avisos":[]}', ?, ?, ?)`)
    .bind(id, t, leadId, o.status ?? 'revisao', JSON.stringify(content), JSON.stringify(artwork), `${id}-r1`, o.contaId ?? null).run();
  return { id, pautaId: leadId, pauta: lead, conteudo: content };
}

const publicValue = (method: 'GET' | 'POST', token: string, form?: Record<string, string>) =>
  (exports as unknown as { default: { fetch: (r: Request) => Promise<Response> } }).default.fetch(new Request(`${ORIGIN}/anuncio/${token}`, {
    method: method, ...(form ? { body: new URLSearchParams(form), headers: { 'content-type': 'application/x-www-form-urlencoded' } } : {}),
  }));
const generate = async (s: { cookie: string }, t: string, id: string) => {
  const r = await req(`/api/t/${t}/pecas/${id}/anuncio/link`, { cookie: s.cookie, body: {} });
  expect(r.status).toBe(201);
  const { url } = await r.json<{ url: string }>();
  return url.split('/anuncio/')[1];
};
const state = async (s: { cookie: string }, t: string, id: string) => (await req(`/api/t/${t}/pecas/${id}/anuncio`, { cookie: s.cookie })).json<{ estado: string; comentario: string | null; anunciante: string }>();

describe('from brief to lead', () => {
  it("turns into an advertising idea, with the body's price among the facts, and the same brief doesn't duplicate", async () => {
    const { s, t } = await member('reporter');
    const res = await bring(s, t);
    expect(res.status).toBe(201);
    const { pautaId: leadId } = await res.json<{ pautaId: string }>();
    const lead = await loadLead(env, t, leadId);
    expect(lead).toMatchObject({ tipoPost: 'publicidade', anunciante: 'Mercado Bom Preço' });
    expect(lead.fatos.map((f) => f.texto).join(' ')).toContain('R$ 19,90');
    expect(lead.fatos[0].fonteNome).toBe('briefing do anunciante');
    expect((await bring(s, t)).status).toBe(200);
    const list = await (await req(`/api/t/${t}/pautas`, { cookie: s.cookie })).json<{ pautas: Record<string, unknown>[] }>();
    expect(list.pautas).toHaveLength(1);
    expect(list.pautas[0]).toMatchObject({ tipo_post: 'publicidade', anunciante: 'Mercado Bom Preço' });
  });

  it('short brief, without advertiser, and author outlet are refused; the idea that comes back from the queue stays advertising', async () => {
    const { s, t } = await member();
    expect((await bring(s, t, { anunciante: 'x', briefing: 'curto' })).status).toBe(400);
    expect((await bring(s, t, { anunciante: '  ', briefing: BRIEFING })).status).toBe(400);
    expect((await bring(s, t, { briefing: BRIEFING })).status).toBe(400);
    const { pautaId: leadId } = await (await bring(s, t)).json<{ pautaId: string }>();
    expect((await req(`/api/t/${t}/pautas/${leadId}/descartar`, { cookie: s.cookie, body: {} })).status).toBe(200);
    const back = await (await bring(s, t)).json<{ pautaId: string; situacao: string }>();
    expect(back.situacao).toBe('de_volta');
    expect(await loadLead(env, t, back.pautaId)).toMatchObject({ tipoPost: 'publicidade', anunciante: 'Mercado Bom Preço' });
    await env.DB.prepare("UPDATE tenants SET modo = 'autoral' WHERE id = ?").bind(t).run();
    expect((await bring(s, t, { anunciante: 'Outro', briefing: `${BRIEFING} Mais.` })).status).toBe(400);
  });
});

const leadPure = (language: 'pt-BR' | 'en' = 'pt-BR'): Lead => ({
  id: 'p1', tenantId: 't', titulo: 'Tomate', resumo: null, editoria: 'cidade', municipioIbge: null, cidade: 'Guarujá', bairro: null, idioma: language,
  tipoPost: 'publicidade', anunciante: 'Mercado 24 Horas',
  fatos: [{ id: 'f1', documentoId: 'd', tipo: 'trecho', texto: 'O quilo do tomate sai por R$ 19,90 até sábado', municipioIbge: null, bairro: null, dataFato: null, fonteUrl: 'anuncio:d', fonteNome: 'briefing do anunciante' }],
  marca: { nome: 'Gazeta' }, voz: {},
});
const draft = (p: Lead, caption: string, price = '19,90'): Draft => ({
  manchete: `Tomate por R$ ${price}`, resumo: '', legenda: caption, modelo: 't', custoUsd: 0,
  cards: [{ papel: 'capa', titulo: `Tomate por R$ ${price}`, frases: [{ texto: `Sai por R$ ${price}.`, fatoId: 'f1' }] } as Card],
});

describe('validate advertising', () => {
  const p = leadPure();
  const right = `${openingAdvertising(p)}\n\nTomate em promoção.${closingCaption(p)}`;

  it("a swapped price fails, even one that would fit the right price; the right one passes, with a number in the advertiser's name", () => {
    expect(validate(p, draft(p, right)).ok).toBe(true);
    const r = validate(p, draft(p, right, '19,9'));
    expect(r.ok).toBe(false);
    expect(r.erros).toContain('número 19,9 não aparece nos fatos');
    expect(validate(p, draft(p, right, '18,90')).ok).toBe(false);
    // News keeps the usual comparison.
    expect(validate({ ...p, tipoPost: undefined, anunciante: undefined }, draft(p, 'x', '19,9')).erros).not.toContain('número 19,9 não aparece nos fatos');
  });

  it("caption without the label fails; the advertiser's name counts as known", () => {
    const r = validate(p, draft(p, 'Tomate em promoção.'));
    expect(r.ok).toBe(false);
    expect(r.erros).toContain('legenda de publicidade sem o rótulo');
    const withName = draft(p, right);
    withName.cards[0].titulo = 'Tomate no Mercado Horas';
    withName.manchete = 'Tomate no Mercado Horas';
    expect(validate(p, withName).erros.filter((e) => e.startsWith('nome'))).toEqual([]);
  });

  it('fromCaptionBody recognizes the new closing, in pt-BR and in English', () => {
    expect(fromCaptionBody(p, right)).toEqual({ corpo: `${openingAdvertising(p)}\n\nTomate em promoção.`, fecho: true });
    const en = leadPure('en');
    expect(closingCaption(en)).toContain('Advertisement: Mercado 24 Horas');
    expect(openingAdvertising(en)).toBe('Advertisement · Mercado 24 Horas');
    // The closing of a CTA the brand has since changed: recognised by the last paragraph.
    expect(fromCaptionBody(p, 'Texto.\n\nConvite antigo.\n\nPublicidade: Mercado 24 Horas')).toEqual({ corpo: 'Texto.', fecho: true });
  });
});

describe('label on the art and in the caption', () => {
  it('badge on every card and the advertiser in the footer, in both languages; the CTA also carries the badge', async () => {
    for (const [language, label] of [['pt-BR', 'Publicidade'], ['en', 'Advertisement']] as const) {
      const p = leadPure(language);
      expect(varsCard(p, { layout: 'texto', titulo: 'T', frases: [] }, 'carrossel')).toMatchObject({ FOOTER_LABEL: `${label}:`, SOURCE_NAME: 'Mercado 24 Horas' });
      expect(baseCard(p).publicidade).toEqual({ rotulo: label, anunciante: 'Mercado 24 Horas' });
      const cards = await prepareCards(env, {
        tenantId: 't', pecaId: 'x', versao: 1, formato: 'carrossel', pauta: p,
        rascunho: { manchete: 'M', resumo: '', legenda: 'L', modelo: 't', custoUsd: 0, cards: [{ id: 'c', layout: 'capa', titulo: 'T', frases: [] }, { id: 'convite', layout: 'convite', titulo: 'Siga', frases: [{ texto: 'x', fatoId: null }] }] },
      });
      for (const c of cards) expect(c.html).toContain(`<p class="selo-publi">${label}</p>`);
    }
  });

  it("drafting adds the label by code, doesn't treat the ad as a correction, and says in the prompt that it is advertising", async () => {
    const p = leadPure();
    model = { manchete: 'Tomate por R$ 19,90', resumo: '', legenda: 'Tomate em promoção. Fonte: Mercado', cards: [{ layout: 'capa', titulo: 'Tomate por R$ 19,90', frases: [{ texto: 'Sai por R$ 19,90.', fatoId: 'f1' }] }] };
    const r = await draftPiece(env, { pauta: p, formato: 'post' });
    expect(r.manchete).toBe('Tomate por R$ 19,90');
    expect(r.cards[0].titulo).toBe('Tomate por R$ 19,90');
    expect(r.legenda.startsWith('Publicidade · Mercado 24 Horas\n\nTomate em promoção.')).toBe(true);
    expect(r.legenda.endsWith('Publicidade: Mercado 24 Horas')).toBe(true);
    expect(validate(p, r).erros.filter((e) => e.includes('rótulo'))).toEqual([]);
    const body = JSON.parse(String(vi.mocked(globalThis.fetch).mock.calls[0][1]?.body));
    expect(body.messages[0].content).toContain('ADVERTISING for Mercado 24 Horas');
    expect(body.messages[0].content).not.toContain('ATUALIZAÇÃO');
  });
});

describe('approval link', () => {
  it("only the hash stays in the database; the GET shows the piece, with the link headers, and doesn't decide", async () => {
    const { s, t } = await member();
    const { id } = await piece(s, t);
    expect(await state(s, t, id)).toMatchObject({ estado: 'sem_link' });
    const token = await generate(s, t, id);
    expect(token).toHaveLength(43);
    const line = await env.DB.prepare('SELECT token_sha256, expira_em FROM anuncio_aprovacoes WHERE peca_id = ?').bind(id).first<{ token_sha256: string; expira_em: string }>();
    expect(line!.token_sha256).not.toBe(token);
    expect(line!.token_sha256).toMatch(/^[0-9a-f]{64}$/);
    const res = await publicValue('GET', token);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    const html = await res.text();
    expect(html).toContain('name="robots" content="noindex"');
    expect(html).toContain('Tomate em promoção.');
    expect(html).toContain('/media/artes/');
    await publicValue('GET', token);
    expect(await state(s, t, id)).toMatchObject({ estado: 'aguardando' });
  });

  it('approving counts once; an adjustment requires a comment and appears in Review', async () => {
    const { s, t } = await member();
    const { id } = await piece(s, t);
    const token = await generate(s, t, id);
    expect((await publicValue('POST', token, { decisao: 'ajuste' })).status).toBe(400);
    expect((await publicValue('POST', token, { decisao: 'outra' })).status).toBe(400);
    expect((await publicValue('POST', token, { decisao: 'ajuste', comentario: 'O preço é outro.' })).status).toBe(200);
    expect(await state(s, t, id)).toMatchObject({ estado: 'ajuste', comentario: 'O preço é outro.' });
    expect((await publicValue('POST', token, { decisao: 'aprovar' })).status).toBe(409);
    expect(await state(s, t, id)).toMatchObject({ estado: 'ajuste' });
    const other = await generate(s, t, id);
    expect((await publicValue('POST', other, { decisao: 'aprovar' })).status).toBe(200);
    expect(await (await publicValue('GET', other)).text()).toContain('Aprovado. Obrigado!');
    expect(await state(s, t, id)).toMatchObject({ estado: 'aprovado' });
  });

  it("expired token and new version don't decide, and the screen says to generate another", async () => {
    const { s, t } = await member();
    const { id } = await piece(s, t);
    const token = await generate(s, t, id);
    const after = new Date(Date.now() + 8 * 86_400_000);
    expect((await adPage(env, token, {}, after)).html).toContain('Este link venceu');
    await env.DB.prepare("UPDATE anuncio_aprovacoes SET expira_em = '2020-01-01 00:00:00' WHERE peca_id = ?").bind(id).run();
    expect((await publicValue('POST', token, { decisao: 'aprovar' })).status).toBe(409);
    expect(await state(s, t, id)).toMatchObject({ estado: 'expirado' });

    const created = await generate(s, t, id);
    await env.DB.prepare('UPDATE pecas SET versao = 2 WHERE id = ?').bind(id).run();
    const html = await (await publicValue('GET', created)).text();
    expect(html).toContain('Este post mudou');
    expect(html).not.toContain('Tomate em promoção.');
    expect((await publicValue('POST', created, { decisao: 'aprovar' })).status).toBe(409);
    expect(await state(s, t, id)).toMatchObject({ estado: 'versao_mudou' });
  });

  it("invalid token is 404; a token never shows a piece from another outlet; page in the outlet's language", async () => {
    const { s, t } = await member();
    const { s: s2, t: t2 } = await member();
    await env.DB.prepare("UPDATE tenants SET idioma = 'en' WHERE id = ?").bind(t2).run();
    const a = await piece(s, t);
    const b = await piece(s2, t2);
    expect((await publicValue('GET', 'x'.repeat(43))).status).toBe(404);
    expect((await publicValue('POST', 'curto', { decisao: 'aprovar' })).status).toBe(404);
    const html = await (await publicValue('GET', await generate(s, t, a.id))).text();
    expect(html).toContain(a.id);
    expect(html).not.toContain(b.id);
    const english = await (await publicValue('GET', await generate(s2, t2, b.id))).text();
    expect(english).toContain('<html lang="en">');
    expect(english).toContain('Ask for a change');
    expect(await createLink(env, t, { id: a.id, versao: 1 }, 'x')).toMatchObject({ url: expect.stringContaining(`${ORIGIN}/anuncio/`) });
  });

  it("IDOR and roles: another outlet 404, reporter doesn't generate, piece that isn't advertising 404", async () => {
    const { s, t } = await member();
    const { id } = await piece(s, t);
    const { s: foreign, t: other } = await member();
    for (const [session, tenant] of [[foreign, t], [foreign, other]] as const) {
      expect((await req(`/api/t/${tenant}/pecas/${id}/anuncio`, { cookie: session.cookie })).status).toBe(404);
      expect((await req(`/api/t/${tenant}/pecas/${id}/anuncio/link`, { cookie: session.cookie, body: {} })).status).toBe(404);
      expect((await req(`/api/t/${tenant}/pecas/${id}/comprovante`, { cookie: session.cookie })).status).toBe(404);
    }
    const reporter = await register();
    await seedMember(t, reporter.userId, 'reporter');
    expect((await req(`/api/t/${t}/pecas/${id}/anuncio`, { cookie: reporter.cookie })).status).toBe(200);
    expect((await req(`/api/t/${t}/pecas/${id}/anuncio/link`, { cookie: reporter.cookie, body: {} })).status).toBe(403);
    expect((await req(`/api/t/${t}/pecas/${id}/comprovante`, { cookie: reporter.cookie })).status).toBe(403);
    await env.DB.prepare("UPDATE pecas SET status = 'rejeitada' WHERE id = ?").bind(id).run();
    expect((await req(`/api/t/${t}/pecas/${id}/anuncio/link`, { cookie: s.cookie, body: {} })).status).toBe(409);
  });
});

describe('proof', () => {
  async function published(s: { cookie: string; userId: string }, t: string, url: string | null) {
    const account = await seedAccount(t);
    const { id } = await piece(s, t, { status: 'publicada', contaId: account });
    await env.DB.batch([
      env.DB.prepare("INSERT INTO decisoes (id, tenant_id, peca_id, versao, decisao, por) VALUES (?, ?, ?, 1, 'aprovar', ?)").bind(crypto.randomUUID(), t, id, s.userId),
      env.DB.prepare("INSERT INTO publicacoes (id, tenant_id, peca_id, conta_id, rede, modo, url, publicado_em, status) VALUES (?, ?, ?, ?, 'instagram', 'manual', ?, '2026-11-05 12:00:00', 'publicada')").bind(crypto.randomUUID(), t, id, account, url),
    ]);
    return id;
  }

  it('only for published pieces; carries advertiser, date, link, who approved and cover, and says it is not a tax invoice (nota fiscal)', async () => {
    const { s, t } = await member();
    const notLeft = await piece(s, t);
    expect((await req(`/api/t/${t}/pecas/${notLeft.id}/comprovante`, { cookie: s.cookie })).status).toBe(404);
    const id = await published(s, t, 'https://www.instagram.com/p/ABC/');
    const res = await req(`/api/t/${t}/pecas/${id}/comprovante?html=1`, { cookie: s.cookie });
    expect(res.status).toBe(200);
    const html = await res.text();
    for (const passage of ['Comprovante de publicação', 'Tomate por R$ 19,90', 'https://www.instagram.com/p/ABC/', 'Pessoa', 'data:image/jpeg;base64,', 'Não é nota fiscal', 'sem aprovação pelo link']) expect(html).toContain(passage);
    const pdf = await req(`/api/t/${t}/pecas/${id}/comprovante`, { cookie: s.cookie });
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    expect([...new Uint8Array(await pdf.arrayBuffer())]).toEqual([...PDF]);
  });

  it('manual account without URL says link not informed; in English', async () => {
    const { s, t } = await member();
    const id = await published(s, t, null);
    expect(await (await req(`/api/t/${t}/pecas/${id}/comprovante?html=1`, { cookie: s.cookie })).text()).toContain('link não informado');
    const en = htmlReceipt({ idioma: 'en', veiculo: 'V', anunciante: 'A', manchete: 'M', publicadoEm: null, url: 'javascript:alert(1)', capa: null, aprovadoPor: null, aprovadoEm: null, anuncianteEm: null });
    expect(en).toContain('link not provided');
    expect(en).toContain('It is not a tax invoice.');
    expect(en).not.toContain('javascript:');
  });
});
