// Sponsorship slot: period, the rule of where it does not go, the caption's fixed line, the strip on the art, inheritance in Reels, IDOR.
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Card } from '../src/lib/cards';
import { cardExtras, type BaseCard } from '../src/lib/cardHtml';
import { acceptedSponsorship, DEFAULT_PARAMS, type PieceStyle } from '../src/lib/style';
import { freezeToPiece, validateSponsorship } from '../src/lib/styles';
import { loadLead, type Lead } from '../src/lib/lead';
import { fromCaptionBody, closingCaption, sponsorshipLine, swapClosing, type Draft } from '../src/lib/drafting';
import { browserApi, prepareCards } from '../src/lib/render';
import { applyStyle } from '../src/shell/editing';
import { validate } from '../src/lib/validation';
import { register, req, seedMember, seedTenant } from './helpers';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const PERIOD = { inicio: '2026-11-01', fim: '2026-11-30' };
const INSIDE = new Date('2026-11-15T12:00:00Z');

async function member(role: 'admin' | 'editor' | 'reporter' = 'admin') {
  const s = await register();
  const t = await seedTenant();
  await seedMember(t, s.userId, role);
  return { s, t };
}

async function sponsorOf(s: { cookie: string }, t: string, body: Record<string, unknown> = {}) {
  const r = await req(`/api/t/${t}/patrocinios`, { cookie: s.cookie, body: { nome: 'Padaria Sol', ...PERIOD, ...body } });
  expect(r.status).toBe(201);
  return (await r.json<{ id: string }>()).id;
}

async function leadOf(t: string, o: { editoria?: string; tipoPost?: string } = {}) {
  const [leadId, doc, fact] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO fontes (id, tenant_id, tipo, nome) VALUES (?, ?, 'manual', 'Teste')").bind(`${t}:f`, t),
    env.DB.prepare("INSERT INTO documentos (id, tenant_id, fonte_id, url, hash_texto, status) VALUES (?, ?, ?, ?, ?, 'triado')").bind(doc, t, `${t}:f`, `https://a.example/${doc}`, doc),
    env.DB.prepare("INSERT INTO fatos (id, tenant_id, documento_id, tipo, texto, hash) VALUES (?, ?, ?, 'manchete', 'Ponte fecha', ?)").bind(fact, t, doc, fact),
    env.DB.prepare("INSERT INTO pautas (id, tenant_id, status, origem, titulo, editoria, tipo_post, fato_ids_json, documento_ids_json, score) VALUES (?, ?, 'em_producao', 'manual', 'Ponte fecha', ?, ?, ?, ?, 1)")
      .bind(leadId, t, o.editoria ?? 'cidade', o.tipoPost ?? null, JSON.stringify([fact]), JSON.stringify([doc])),
  ]);
  return { pautaId: leadId, fato: fact, pauta: await loadLead(env, t, leadId) };
}

const withStyle = (sponsorship: string | null) => ({ id: 'e', versao: 1, params: { ...DEFAULT_PARAMS, patrocinio: sponsorship } });

let htmls: string[] = [];
beforeEach(() => {
  htmls = [];
  const page = {
    on: () => {}, route: async () => {}, setContent: async (h: string) => { htmls.push(h); },
    evaluate: async (f: unknown) => (typeof f === 'function' && f.length ? { width: 1080, height: 1350, overflow: [], overlap: false, headlineLines: 2, imagesLoaded: true, badText: false, fontsReady: true, cores: [] } : undefined),
    locator: () => ({ screenshot: async () => new Uint8Array([1]) }),
  };
  vi.spyOn(browserApi, 'abrir').mockImplementation((() => Promise.resolve({ newPage: async () => page, close: async () => {} })) as never);
});
afterEach(() => vi.restoreAllMocks());

describe('where the band goes in', () => {
  it('police, advertising, correction, errata and author outlets get none', () => {
    expect(acceptedSponsorship({ editoria: 'cidade' })).toBe(true);
    expect(acceptedSponsorship({ editoria: 'policia' })).toBe(false);
    for (const postType of ['publicidade', 'atualizacao', 'errata']) expect(acceptedSponsorship({ editoria: 'cidade', tipoPost: postType })).toBe(false);
    expect(acceptedSponsorship({ editoria: 'cidade', modo: 'autoral' })).toBe(false);
  });

  it('in the period gets in; expired, not yet started, and archived do not', async () => {
    const { s, t } = await member();
    const { pauta: lead } = await leadOf(t);
    const id = await sponsorOf(s, t);
    const frozen = (now: Date) => freezeToPiece(env, t, withStyle(id), lead, now);
    expect((await frozen(INSIDE)).patrocinador).toEqual({ nome: 'Padaria Sol', logoR2: null });
    expect((await frozen(new Date('2026-11-30T23:00:00Z'))).patrocinador?.nome).toBe('Padaria Sol');
    expect((await frozen(new Date('2026-12-01T12:00:00Z'))).patrocinador).toBeUndefined();
    expect((await frozen(new Date('2026-10-31T12:00:00Z'))).patrocinador).toBeUndefined();
    await req(`/api/t/${t}/patrocinios/${id}`, { cookie: s.cookie, method: 'DELETE' });
    expect((await frozen(INSIDE)).patrocinador).toBeUndefined();
  });

  it('the police lead freezes without a sponsor', async () => {
    const { s, t } = await member();
    const { pauta: lead } = await leadOf(t, { editoria: 'policia' });
    expect((await freezeToPiece(env, t, withStyle(await sponsorOf(s, t)), lead, INSIDE)).patrocinador).toBeUndefined();
  });
});

describe('on the art', () => {
  const base = { publicidade: undefined, marcaNome: 'G', patrocinio: { rotulo: 'Publicidade', oferecimento: 'Oferecimento', nome: 'Pão <&> Cia', logo: null } } satisfies Pick<BaseCard, 'publicidade' | 'marcaNome' | 'patrocinio'>;
  const cover: Card = { id: 'c', layout: 'capa', titulo: 'T', frases: [] };

  it('marks as advertising by code, in both languages, with the name escaped', () => {
    const x = cardExtras(base, cover);
    expect(x.SPONSOR_TAG).toContain('Publicidade · Oferecimento');
    expect(x.SPONSOR_TAG).toContain('Pão &lt;&amp;&gt; Cia');
    expect(cardExtras({ ...base, patrocinio: { ...base.patrocinio, rotulo: 'Advertisement', oferecimento: 'Sponsored by' } }, cover).SPONSOR_TAG).toContain('Advertisement · Sponsored by');
  });

  it('the CTA stays out', () => {
    expect(cardExtras(base, { id: 'k', layout: 'convite', titulo: 'T', frases: [] })).toEqual({});
  });

  it('a piece with the sponsor carries the embedded logo; the Reels inherits it by the same path', async () => {
    const { t } = await member();
    const { pauta: lead } = await leadOf(t);
    const logoR2 = `patrocinios/${t}/logo.png`;
    await env.MEDIA.put(logoR2, PNG, { httpMetadata: { contentType: 'image/png' } });
    const style: PieceStyle = { ...withStyle('p'), marcaVisual: {}, patrocinador: { nome: 'Padaria Sol', logoR2 } };
    const draft: Draft = { manchete: 'M', resumo: '', legenda: 'L', modelo: 'ia', custoUsd: 0, cards: [{ id: 'c1', layout: 'capa', titulo: 'T', frases: [] }], estilo: style };
    const [card] = await prepareCards(env, { tenantId: t, pecaId: 'p', versao: 1, formato: 'carrossel', pauta: lead, rascunho: draft });
    expect(card.html).toContain('class="selo-publi faixa-oferece"');
    expect(card.html).toContain('src="data:image/png;base64,');
    const [reels] = await prepareCards(env, { tenantId: t, pecaId: 'p', versao: 1, formato: 'carrossel', pauta: lead, rascunho: draft, quadro: 'r916' });
    expect(reels.html).toContain('faixa-oferece');
  });
});

describe('in the caption', () => {
  const lead = { id: 'p', fatos: [{ fonteNome: 'Prefeitura', fonteUrl: 'https://a.example' }], marca: { ctas: [{ titulo: 'T', texto: 'X', legenda: 'Siga.' }] } } as unknown as Lead;
  const caption = `Texto do post.${closingCaption(lead)}${sponsorshipLine(lead, 'Padaria Sol')}`;

  it('fromCaptionBody recognizes the line only with the right name', () => {
    expect(fromCaptionBody(lead, caption, 'Padaria Sol')).toEqual({ corpo: 'Texto do post.', fecho: true });
    expect(fromCaptionBody(lead, caption, 'Outra').corpo).toContain('Oferecimento');
    expect(fromCaptionBody(lead, caption).corpo).toContain('Oferecimento');
  });

  it('swapClosing adds, removes and keeps the line', () => {
    const without = `Texto do post.${closingCaption(lead)}`;
    expect(swapClosing(lead, without, null, { para: 'Padaria Sol' })).toBe(caption);
    expect(swapClosing(lead, caption, null, { de: 'Padaria Sol' })).toBe(without);
    expect(swapClosing(lead, caption, null, { de: 'Padaria Sol', para: 'Padaria Sol' })).toBe(caption);
    expect(swapClosing(lead, 'Texto sem fecho.', null)).toBe('Texto sem fecho.');
  });

  it("a number in the sponsor's name doesn't fail, because the line belongs to the system", async () => {
    const { t } = await member();
    const { pauta: p, fato: fact } = await leadOf(t);
    const style: PieceStyle = { ...withStyle('p'), marcaVisual: {}, patrocinador: { nome: 'Padaria 24 Horas', logoR2: null } };
    const r: Draft = {
      manchete: 'Ponte fecha', resumo: '', modelo: 'ia', custoUsd: 0, estilo: style,
      legenda: `Ponte fecha.${closingCaption(p)}${sponsorshipLine(p, 'Padaria 24 Horas')}`,
      cards: [{ id: 'c1', layout: 'capa', titulo: 'Ponte fecha', frases: [{ texto: 'Ponte fecha', fatoId: fact }] }],
    };
    expect(validate(p, r, { formato: 'post' }).ok).toBe(true);
    const { estilo: _, ...withoutStyle } = r;
    expect(validate(p, withoutStyle, { formato: 'post' }).ok).toBe(false);
  });

  it('applying the template adds the line, and switching to no template removes it', async () => {
    const { s, t } = await member();
    const { pautaId: leadId, fato: fact, pauta: p } = await leadOf(t);
    const sp = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    const sponsor = await sponsorOf(s, t, { inicio: sp, fim: sp });
    const r = await req(`/api/t/${t}/estilos`, { cookie: s.cookie, body: { nome: 'Patrocinado', params: { patrocinio: sponsor } } });
    const styleId = (await r.json<{ id: string }>()).id;
    const pieceId = crypto.randomUUID();
    const content: Draft = { manchete: 'Ponte fecha', resumo: '', modelo: 'ia', custoUsd: 0, legenda: `Ponte fecha.${closingCaption(p)}`, cards: [{ id: 'c1', layout: 'capa', titulo: 'Ponte fecha', frases: [{ texto: 'Ponte fecha', fatoId: fact }] }] };
    await env.DB.prepare(`INSERT INTO pecas (id, tenant_id, pauta_id, formato, status, versao, conteudo_json, validacao_json, arte_r2_keys_json, workflow_id) VALUES (?, ?, ?, 'post', 'revisao', 1, ?, '{"ok":true,"erros":[],"avisos":[]}', '[]', ?)`)
      .bind(pieceId, t, leadId, JSON.stringify(content), `${pieceId}-r1`).run();
    await env.DB.prepare("INSERT INTO peca_versoes (id, tenant_id, peca_id, versao, rodada, conteudo_json, autor) VALUES (?, ?, ?, 1, 1, ?, 'ia')").bind(crypto.randomUUID(), t, pieceId, JSON.stringify(content)).run();
    const current = async () => JSON.parse((await env.DB.prepare('SELECT conteudo_json FROM pecas WHERE id = ?').bind(pieceId).first<{ conteudo_json: string }>())!.conteudo_json) as Draft;

    expect(await applyStyle(env, { tenantId: t, pecaId: pieceId, por: s.userId, versao: 1, estiloId: styleId })).toMatchObject({ ok: true, renderizados: ['c1'] });
    expect((await current()).legenda.endsWith('Oferecimento: Padaria Sol')).toBe(true);
    expect(htmls[0]).toContain('faixa-oferece');
    await applyStyle(env, { tenantId: t, pecaId: pieceId, por: s.userId, versao: 2, estiloId: null });
    expect((await current()).legenda).toBe(content.legenda);
  });
});

describe('routes', () => {
  it('validates name and period', () => {
    expect(validateSponsorship({ nome: '', ...PERIOD })).toHaveProperty('erro');
    expect(validateSponsorship({ nome: 'X', inicio: 'ontem', fim: '2026-11-30' })).toHaveProperty('erro');
    expect(validateSponsorship({ nome: 'X', inicio: '2026-12-01', fim: '2026-11-30' })).toHaveProperty('erro');
    expect(validateSponsorship({ nome: ' X  Y ', ...PERIOD })).toEqual({ nome: 'X Y', ...PERIOD });
  });

  it("the logo goes through brand validation, with the outlet's key", async () => {
    const { s, t } = await member();
    const id = await sponsorOf(s, t);
    const upload = (body: BodyInit, type: string) => req(`/api/t/${t}/patrocinios/${id}/logo`, { cookie: s.cookie, cru: { tipo: type, corpo: body } });
    expect((await upload(new Uint8Array([1, 2, 3]), 'image/png')).status).toBe(400);
    expect((await upload('x', 'image/gif')).status).toBe(415);
    expect((await upload('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'image/svg+xml')).status).toBe(400);
    expect((await upload(PNG, 'image/png')).status).toBe(201);
    const row = await env.DB.prepare('SELECT logo_r2 FROM patrocinios WHERE id = ?').bind(id).first<{ logo_r2: string }>();
    expect(row?.logo_r2.startsWith(`patrocinios/${t}/`)).toBe(true);
  });

  it('roles: editor and reporter can only view', async () => {
    const { s, t } = await member();
    const id = await sponsorOf(s, t);
    for (const role of ['editor', 'reporter'] as const) {
      const o = await register();
      await seedMember(t, o.userId, role);
      expect((await req(`/api/t/${t}/patrocinios`, { cookie: o.cookie })).status).toBe(200);
      expect((await req(`/api/t/${t}/patrocinios`, { cookie: o.cookie, body: { nome: 'Z', ...PERIOD } })).status).toBe(403);
      expect((await req(`/api/t/${t}/patrocinios/${id}`, { cookie: o.cookie, method: 'DELETE' })).status).toBe(403);
    }
  });

  it("IDOR: another outlet's sponsor can't be archived, receive a logo or enter a template", async () => {
    const a = await member();
    const b = await member();
    const id = await sponsorOf(a.s, a.t);
    expect((await req(`/api/t/${b.t}/patrocinios/${id}`, { cookie: b.s.cookie, method: 'DELETE' })).status).toBe(404);
    expect((await req(`/api/t/${b.t}/patrocinios/${id}/logo`, { cookie: b.s.cookie, cru: { tipo: 'image/png', corpo: PNG } })).status).toBe(404);
    expect((await req(`/api/t/${b.t}/estilos`, { cookie: b.s.cookie, body: { nome: 'X', params: { patrocinio: id } } })).status).toBe(404);
    expect((await req(`/api/t/${a.t}/patrocinios`, { cookie: b.s.cookie })).status).toBe(404);
    // Another outlet's id does not count when freezing either.
    const { pauta: lead } = await leadOf(b.t);
    expect((await freezeToPiece(env, b.t, withStyle(id), lead, INSIDE)).patrocinador).toBeUndefined();
  });
});
