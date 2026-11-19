import { describe, expect, it } from 'vitest';
import { validate } from '../src/lib/validation';
import type { Lead } from '../src/lib/lead';
import type { Draft } from '../src/lib/drafting';
import { fromBrowserLanguage } from '../web/src/language';
import { register, req } from './helpers';

const lead = (): Lead => ({
  id: 'p', tenantId: 't', titulo: 'Ponte', resumo: null, editoria: 'cidade', municipioIbge: '3518701', cidade: 'Guarujá', bairro: null,
  fatos: [{ id: 'f1', documentoId: 'd', tipo: 'manchete', texto: 'Prefeitura interdita ponte', municipioIbge: null, bairro: null, dataFato: null, fonteUrl: 'https://x.example', fonteNome: 'Prefeitura' }],
  marca: {}, voz: {},
});

describe('screen language', () => {
  it("the browser decides while the person hasn't chosen: Portuguese from anywhere is pt-BR, the rest is English", () => {
    expect(fromBrowserLanguage(['pt-PT', 'en'])).toBe('pt-BR');
    expect(fromBrowserLanguage(['en-GB'])).toBe('en');
    expect(fromBrowserLanguage(['es-AR'])).toBe('en');
    expect(fromBrowserLanguage([])).toBe('pt-BR');
  });

  it('the check also records each plain reason in English, card by card', () => {
    const r: Draft = {
      manchete: 'Ponte fecha por 30 dias', resumo: '', legenda: '', modelo: 'teste', custoUsd: 0,
      cards: [
        { papel: 'capa', titulo: 'Ponte fecha', frases: [] },
        { papel: 'o_que_aconteceu', titulo: '', frases: [{ texto: 'Sem fonte.', fatoId: null }] },
      ],
    };
    const v = validate(lead(), r);
    expect(v.ok).toBe(false);
    expect(Object.keys(v.en?.porCard ?? {})).toEqual(Object.keys(v.porCard ?? {}));
    for (const id of Object.keys(v.porCard ?? {})) expect(v.en!.porCard![id]).toHaveLength(v.porCard![id].length);
    expect(v.en?.geral).toHaveLength(v.geral!.length);
    expect(v.en?.geral).toContain("The number 30 in the headline or caption doesn't appear in any fact from the source.");
    expect(Object.values(v.en!.porCard!).flat()).toContain('The card has no title.');
  });

  it('the account stores the language; the API responds in the language of the x-idioma header', async () => {
    const s = await register();
    expect(await (await req('/api/me', { cookie: s.cookie })).json()).toMatchObject({ user: { idioma: null } });

    const pt = await req('/api/me/idioma', { method: 'PUT', cookie: s.cookie, body: { idioma: 'fr' } });
    expect(pt.status).toBe(400);
    expect(await pt.json()).toEqual({ erro: 'idioma: pt-BR ou en' });
    const en = await req('/api/me/idioma', { method: 'PUT', cookie: s.cookie, body: { idioma: 'fr' }, headers: { 'x-idioma': 'en' } });
    expect(await en.json()).toEqual({ erro: 'idioma: pt-BR or en' });

    expect((await req('/api/me/idioma', { method: 'PUT', cookie: s.cookie, body: { idioma: 'en' } })).status).toBe(200);
    expect(await (await req('/api/me', { cookie: s.cookie })).json()).toMatchObject({ user: { idioma: 'en' } });
  });
});

// ── Phase B: the outlet's content language ───────────────────────────────────────────────────────────────────────
const leadEn = (over: Partial<Lead> = {}): Lead => ({
  id: 'p-en', tenantId: 't', titulo: 'Bridge', resumo: null, editoria: 'economia', municipioIbge: null, cidade: null, bairro: null, idioma: 'en',
  fatos: [
    { id: 'f1', documentoId: 'd', tipo: 'manchete', texto: 'The council closes the Harbor Bridge for repairs', municipioIbge: null, bairro: null, dataFato: '2026-11-02', fonteUrl: 'https://news.example/bridge', fonteNome: 'City News' },
  ],
  marca: { nome: 'Harbor Daily', handle: '@harbordaily' }, voz: {}, ...over,
});
const draftEn = (title: string, sentence: string): Draft => ({
  manchete: 'Harbor Bridge closes for repairs', resumo: '', legenda: 'The bridge closes.', modelo: 'teste', custoUsd: 0,
  cards: [{ papel: 'capa', titulo: 'Harbor Bridge closes', frases: [] }, { layout: 'texto', titulo: title, frases: [{ texto: sentence, fatoId: 'f1' }] }],
});

describe('English outlet', () => {
  it("the check reads days in English and doesn't take a month, day or short title word as a name", () => {
    // 2026-11-02 is a Monday (segunda-feira).
    const right = validate(leadEn(), draftEn('Repairs start on Monday', 'The council closes the bridge in November.'));
    expect(right.erros).toEqual([]);
    const wrong = validate(leadEn(), draftEn('Repairs start on Friday', 'The council closes the bridge.'));
    expect(wrong.ok).toBe(false);
    expect(Object.values(wrong.en!.porCard!).flat()).toContain('"friday" doesn\'t match the date of the facts (it was monday).');
    const name = validate(leadEn(), draftEn('Mayor Smith closes it', 'The council closes the bridge.'));
    expect(name.erros.some((e) => e.includes('"Smith"'))).toBe(true);
  });

  it('the caption closing, default CTA and card come out in English; the Portuguese stays as it was', async () => {
    const { closingCaption, fromCaptionBody, chooseCta } = await import('../src/lib/drafting');
    const { baseCard } = await import('../src/lib/render');
    const { cardVars: varsCard } = await import('../src/lib/cardHtml');
    const p = leadEn();
    expect(chooseCta(p)).toEqual({ titulo: 'Your neighborhood, with sources.', texto: 'Follow @harbordaily for the news up close.', legenda: 'Follow @harbordaily.' });
    expect(closingCaption(p)).toBe('\n\nFollow @harbordaily.\n\nSource: City News');
    expect(fromCaptionBody(p, `Texto.${closingCaption(p)}`)).toEqual({ corpo: 'Texto.', fecho: true });
    const base = baseCard(p, new Date('2026-11-02T15:00:00Z'));
    expect(base).toMatchObject({ idioma: 'en', editoria: 'Economy', dataLabel: 'Event', dataValor: 'Nov 02, 2026' });
    const cover = varsCard(base, { layout: 'capa', titulo: 'X', frases: [] }, 'carrossel');
    expect(cover).toMatchObject({ LANG: 'en', FOOTER_LABEL: 'Source:', EYEBROW: 'Economy' });
    expect(varsCard(base, { layout: 'convite', titulo: 'X', frases: [] }, 'carrossel').EYEBROW).toBe('Follow');
    // An outlet without a language (every old outlet): the usual card.
    const pt = baseCard({ ...p, idioma: undefined }, new Date('2026-11-02T15:00:00Z'));
    expect(pt).toMatchObject({ idioma: 'pt-BR', editoria: 'economia', dataLabel: 'Ocorrência' });
    expect(varsCard(pt, { layout: 'capa', titulo: 'X', frases: [] }, 'carrossel')).toMatchObject({ LANG: 'pt-BR', FOOTER_LABEL: 'Fonte:' });
  });

  it('drafting asks the model for English and removes a "Source:" the model writes', async () => {
    const { env } = await import('cloudflare:test');
    const { vi: seen } = await import('vitest');
    const { draftPiece: draft } = await import('../src/lib/drafting');
    let body = '';
    const spy = seen.spyOn(globalThis, 'fetch').mockImplementation(async (_u, init) => {
      body = String(init?.body ?? '');
      const content = JSON.stringify({ manchete: 'Harbor Bridge closes', resumo: '', legenda: 'The bridge closes.\nSource: invented', cards: [{ layout: 'capa', titulo: 'Harbor Bridge closes', frases: [{ texto: 'The council closes the bridge.', fatoId: 'f1' }] }] });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { headers: { 'content-type': 'application/json' } });
    });
    try {
      const r = await draft(env, { pauta: leadEn(), formato: 'post' });
      expect(JSON.parse(body).messages[0].content).toContain('Write in English: headline');
      expect(r.legenda).toBe('The bridge closes.\n\nFollow @harbordaily.\n\nSource: City News');
    } finally {
      spy.mockRestore();
    }
  });

  it('the API creates the outlet with language, changes it on the Brand and returns it in /me', async () => {
    const s = await register();
    const bad = await req('/api/tenants', { cookie: s.cookie, body: { nome: 'Harbor Daily', modo: 'tematico', idioma: 'fr' } });
    expect(bad.status).toBe(400);
    const r = await req('/api/tenants', { cookie: s.cookie, body: { nome: 'Harbor Daily', modo: 'tematico', idioma: 'en' } });
    expect(r.status).toBe(201);
    const v = await r.json() as { id: string; idioma: string };
    expect(v.idioma).toBe('en');
    const pt = await (await req('/api/tenants', { cookie: s.cookie, body: { nome: 'Gazeta Antiga', modo: 'tematico' } })).json() as { idioma: string };
    expect(pt.idioma).toBe('pt-BR');
    const me = await (await req('/api/me', { cookie: s.cookie })).json() as { tenants: { id: string; idioma: string }[] };
    expect(me.tenants.find((t) => t.id === v.id)?.idioma).toBe('en');

    const patch = await req(`/api/t/${v.id}/marca`, { method: 'PATCH', cookie: s.cookie, body: { idioma: 'pt-BR' } });
    expect(patch.status).toBe(200);
    expect(await (await req(`/api/t/${v.id}/marca`, { cookie: s.cookie })).json()).toMatchObject({ idioma: 'pt-BR' });
    expect((await req(`/api/t/${v.id}/marca`, { method: 'PATCH', cookie: s.cookie, body: { idioma: 'es' } })).status).toBe(400);
  });
});
