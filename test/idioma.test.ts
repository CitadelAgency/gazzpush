import { describe, expect, it } from 'vitest';
import { validar } from '../src/lib/validacao';
import type { Pauta } from '../src/lib/pauta';
import type { Rascunho } from '../src/lib/redacao';
import { idiomaDoNavegador } from '../web/src/idioma';
import { cadastrar, req } from './helpers';

const pauta = (): Pauta => ({
  id: 'p', tenantId: 't', titulo: 'Título', resumo: null, editoria: 'cidade', municipioIbge: '3518701', cidade: 'Guarujá', bairro: null,
  fatos: [{ id: 'f1', documentoId: 'd', tipo: 'manchete', texto: 'Texto de referência', municipioIbge: null, bairro: null, dataFato: null, fonteUrl: 'https://x.example', fonteNome: 'Fonte' }],
  marca: {}, voz: {},
});

describe('idioma das telas', () => {
  it('o navegador decide quando a pessoa ainda não escolheu: português de qualquer lugar é pt-BR, o resto é inglês', () => {
    expect(idiomaDoNavegador(['pt-PT', 'en'])).toBe('pt-BR');
    expect(idiomaDoNavegador(['en-GB'])).toBe('en');
    expect(idiomaDoNavegador(['es-AR'])).toBe('en');
    expect(idiomaDoNavegador([])).toBe('pt-BR');
  });

  it('a conferência grava cada motivo de leigo também em inglês, card por card', () => {
    const r: Rascunho = {
      manchete: 'Intervalo de 30 dias', resumo: '', legenda: '', modelo: 'teste', custoUsd: 0,
      cards: [
        { papel: 'capa', titulo: 'Título do item', frases: [] },
        { papel: 'o_que_aconteceu', titulo: '', frases: [{ texto: 'Sem fonte.', fatoId: null }] },
      ],
    };
    const v = validar(pauta(), r);
    expect(v.ok).toBe(false);
    expect(Object.keys(v.en?.porCard ?? {})).toEqual(Object.keys(v.porCard ?? {}));
    for (const id of Object.keys(v.porCard ?? {})) expect(v.en!.porCard![id]).toHaveLength(v.porCard![id].length);
    expect(v.en?.geral).toHaveLength(v.geral!.length);
    expect(v.en?.geral).toContain("The number 30 in the headline or caption doesn't appear in any fact from the source.");
    expect(Object.values(v.en!.porCard!).flat()).toContain('The card has no title.');
  });

  it('a conta guarda o idioma; a API responde no idioma do cabeçalho x-idioma', async () => {
    const s = await cadastrar();
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

// ── Fase B: idioma do conteúdo do veículo ────────────────────────────────────────────────────────────────────────
const pautaEn = (over: Partial<Pauta> = {}): Pauta => ({
  id: 'p-en', tenantId: 't', titulo: 'Title', resumo: null, editoria: 'economia', municipioIbge: null, cidade: null, bairro: null, idioma: 'en',
  fatos: [
    { id: 'f1', documentoId: 'd', tipo: 'manchete', texto: 'Reference text for the English edition', municipioIbge: null, bairro: null, dataFato: '2026-11-02', fonteUrl: 'https://news.example/item', fonteNome: 'Source' },
  ],
  marca: { nome: 'Publication', handle: '@publication' }, voz: {}, ...over,
});
const rascunhoEn = (titulo: string, frase: string): Rascunho => ({
  manchete: 'Reference headline', resumo: '', legenda: 'Body text.', modelo: 'teste', custoUsd: 0,
  cards: [{ papel: 'capa', titulo: 'Reference title', frases: [] }, { layout: 'texto', titulo, frases: [{ texto: frase, fatoId: 'f1' }] }],
});

describe('veículo em inglês', () => {
  it('a conferência lê dias em inglês e não toma mês, dia ou palavra curta de título por nome', () => {
    // 2026-11-02 é segunda-feira (Monday).
    const certo = validar(pautaEn(), rascunhoEn('Date on Monday', 'The section refers to November.'));
    expect(certo.erros).toEqual([]);
    const errado = validar(pautaEn(), rascunhoEn('Date on Friday', 'The section has text.'));
    expect(errado.ok).toBe(false);
    expect(Object.values(errado.en!.porCard!).flat()).toContain('"friday" doesn\'t match the date of the facts (it was monday).');
    const nome = validar(pautaEn(), rascunhoEn('Unknown Entity', 'The section has text.'));
    expect(nome.erros.some((e) => e.includes('"Entity"'))).toBe(true);
  });

  it('o fecho da legenda, o convite padrão e o card saem em inglês; o português fica como era', async () => {
    const { fechoLegenda, corpoDaLegenda, escolherCta } = await import('../src/lib/redacao');
    const { baseDoCard } = await import('../src/lib/render');
    const { varsDoCard } = await import('../src/lib/cardHtml');
    const p = pautaEn();
    expect(escolherCta(p)).toEqual({ titulo: 'Your neighborhood, with sources.', texto: 'Follow @publication for the news up close.', legenda: 'Follow @publication.' });
    expect(fechoLegenda(p)).toBe('\n\nFollow @publication.\n\nSource: Source');
    expect(corpoDaLegenda(p, `Texto.${fechoLegenda(p)}`)).toEqual({ corpo: 'Texto.', fecho: true });
    const base = baseDoCard(p, new Date('2026-11-02T15:00:00Z'));
    expect(base).toMatchObject({ idioma: 'en', editoria: 'Economy', dataLabel: 'Event', dataValor: 'Nov 02, 2026' });
    const capa = varsDoCard(base, { layout: 'capa', titulo: 'X', frases: [] }, 'carrossel');
    expect(capa).toMatchObject({ LANG: 'en', FOOTER_LABEL: 'Source:', EYEBROW: 'Economy' });
    expect(varsDoCard(base, { layout: 'convite', titulo: 'X', frases: [] }, 'carrossel').EYEBROW).toBe('Follow');
    // Veículo sem idioma (todo veículo antigo): o card de sempre.
    const pt = baseDoCard({ ...p, idioma: undefined }, new Date('2026-11-02T15:00:00Z'));
    expect(pt).toMatchObject({ idioma: 'pt-BR', editoria: 'economia', dataLabel: 'Ocorrência' });
    expect(varsDoCard(pt, { layout: 'capa', titulo: 'X', frases: [] }, 'carrossel')).toMatchObject({ LANG: 'pt-BR', FOOTER_LABEL: 'Fonte:' });
  });

  it('a redação pede inglês ao modelo e tira um "Source:" que o modelo escreva', async () => {
    const { env } = await import('cloudflare:test');
    const { vi } = await import('vitest');
    const { redigir } = await import('../src/lib/redacao');
    let corpo = '';
    const espia = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_u, init) => {
      corpo = String(init?.body ?? '');
      const content = JSON.stringify({ manchete: 'Reference title', resumo: '', legenda: 'Body text.\nSource: invented', cards: [{ layout: 'capa', titulo: 'Reference title', frases: [{ texto: 'The section has text.', fatoId: 'f1' }] }] });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { headers: { 'content-type': 'application/json' } });
    });
    try {
      const r = await redigir(env, { pauta: pautaEn(), formato: 'post' });
      expect(JSON.parse(corpo).messages[0].content).toContain('Escreva em inglês (English)');
      expect(r.legenda).toBe('Body text.\n\nFollow @publication.\n\nSource: Source');
    } finally {
      espia.mockRestore();
    }
  });

  it('a API cria o veículo com idioma, troca na Marca e devolve em /me', async () => {
    const s = await cadastrar();
    const ruim = await req('/api/tenants', { cookie: s.cookie, body: { nome: 'Publication', modo: 'tematico', idioma: 'fr' } });
    expect(ruim.status).toBe(400);
    const r = await req('/api/tenants', { cookie: s.cookie, body: { nome: 'Publication', modo: 'tematico', idioma: 'en' } });
    expect(r.status).toBe(201);
    const v = await r.json() as { id: string; idioma: string };
    expect(v.idioma).toBe('en');
    const pt = await (await req('/api/tenants', { cookie: s.cookie, body: { nome: 'Veículo anterior', modo: 'tematico' } })).json() as { idioma: string };
    expect(pt.idioma).toBe('pt-BR');
    const me = await (await req('/api/me', { cookie: s.cookie })).json() as { tenants: { id: string; idioma: string }[] };
    expect(me.tenants.find((t) => t.id === v.id)?.idioma).toBe('en');

    const patch = await req(`/api/t/${v.id}/marca`, { method: 'PATCH', cookie: s.cookie, body: { idioma: 'pt-BR' } });
    expect(patch.status).toBe(200);
    expect(await (await req(`/api/t/${v.id}/marca`, { cookie: s.cookie })).json()).toMatchObject({ idioma: 'pt-BR' });
    expect((await req(`/api/t/${v.id}/marca`, { method: 'PATCH', cookie: s.cookie, body: { idioma: 'es' } })).status).toBe(400);
  });
});
