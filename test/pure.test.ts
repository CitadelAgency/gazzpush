import { describe, expect, it } from 'vitest';
import { parseRss } from '../src/monitor/consumer';
import { validate } from '../src/lib/validation';
import { chooseCta, closingCaption, type Draft } from '../src/lib/drafting';
import { resolveTriage, schemaTriage, spansEvidence } from '../src/lib/spans';
import { inputModel } from '../src/lib/article';
import { formatDate } from '../src/lib/render';
import type { Lead } from '../src/lib/lead';
import { ARTICLE, ATOM, RSS_CITY_HALL } from './fixtures';

describe('parseRss', () => {
  it('city hall RSS: CDATA, entities, ISO date; item without link ignored', () => {
    const items = parseRss(RSS_CITY_HALL);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ url: 'https://www.guaruja.sp.gov.br/ponte-santos-dumont-interditada/', publicadoEm: '2026-10-30T14:05:00.000Z' });
    expect(items[0].titulo).toContain('Ponte da Santos Dumont será interditada para obras');
    expect(items[1]).toEqual({ url: 'https://www.guaruja.sp.gov.br/vacinacao-sabado/', titulo: 'Vacinação contra gripe & covid no sábado', publicadoEm: null });
  });

  it('Atom: link by href, updated as date', () => {
    expect(parseRss(ATOM)).toEqual([{ url: 'https://blog.exemplo.com.br/feira-muda', titulo: 'Feira livre muda de rua em Vicente de Carvalho', publicadoEm: '2026-10-29T12:30:00.000Z' }]);
  });
});

const lead = (over: Partial<Lead> = {}): Lead => ({
  id: 'pauta-1', tenantId: 't', titulo: 'Ponte interditada', resumo: null, editoria: 'cidade', municipioIbge: '3518701', cidade: 'Guarujá', bairro: null,
  fatos: [
    { id: 'f1', documentoId: 'd', tipo: 'manchete', texto: 'Prefeitura interdita ponte da Avenida Santos Dumont', municipioIbge: null, bairro: null, dataFato: null, fonteUrl: 'https://x.gov.br', fonteNome: 'Prefeitura' },
    { id: 'f2', documentoId: 'd', tipo: 'data', texto: 'As obras duram 15 dias a partir de 2 de novembro', municipioIbge: null, bairro: null, dataFato: '2026-11-02', fonteUrl: 'https://x.gov.br', fonteNome: 'Prefeitura' },
  ],
  marca: {}, voz: {}, ...over,
});
const draft = (over: Partial<Draft> = {}): Draft => ({
  manchete: 'Ponte da Santos Dumont fecha por 15 dias', resumo: 'Obras na ponte.', legenda: 'A ponte fecha.',
  cards: [
    { papel: 'capa', titulo: 'Ponte da Santos Dumont fecha por 15 dias', frases: [] },
    { papel: 'o_que_aconteceu', titulo: 'Obras começam na segunda', frases: [{ texto: 'A prefeitura interdita a ponte.', fatoId: 'f1' }] },
  ],
  modelo: 'teste', custoUsd: 0, ...over,
});

describe('validate', () => {
  it('draft tied to the facts passes', () => {
    expect(validate(lead(), draft())).toEqual({ ok: true, erros: [], avisos: [] });
  });

  it('number outside the facts, sentence without a fact, and a nonexistent fatoId are refused', () => {
    const r = draft({
      manchete: 'Ponte fecha por 30 dias',
      cards: [
        { papel: 'capa', titulo: 'Ponte fecha', frases: [] },
        { papel: 'o_que_aconteceu', titulo: 'Obras na ponte', frases: [{ texto: 'Sem fonte.', fatoId: null }, { texto: 'Inventado.', fatoId: 'f9' }] },
      ],
    });
    const v = validate(lead(), r);
    expect(v.ok).toBe(false);
    expect(v.erros).toEqual(expect.arrayContaining([
      'número 30 não aparece nos fatos', 'frase sem fato (o_que_aconteceu): "Sem fonte."', 'fatoId inexistente f9 (o_que_aconteceu)',
    ]));
  });

  it("weekday that doesn't match the fact's date fails (2/11/2026 is a Monday)", () => {
    expect(validate(lead(), draft({ resumo: 'Obras começam na segunda-feira.' })).ok).toBe(true);
    expect(validate(lead(), draft({ resumo: 'Obras começam na quarta-feira.' })).erros).toContain('dia "quarta-feira" não bate com data dos fatos (segunda)');
  });

  it("template limits: title equal to the role's name, and long body", () => {
    const v = validate(lead(), draft({ cards: [{ papel: 'capa', titulo: 'Ponte', frases: [] }, { papel: 'contexto', titulo: 'Contexto', frases: [{ texto: 'a'.repeat(281), fatoId: 'f1' }] }] }));
    expect(v.erros).toEqual(expect.arrayContaining(['card contexto: título é o nome do papel, não uma manchete', 'card contexto: corpo longo (281 > 280)']));
  });

  it("CTA (the owner's copy) doesn't need a fact", () => {
    const r = draft();
    r.cards.push({ papel: 'convite', titulo: 'Siga a página', frases: [{ texto: 'Siga.', fatoId: null }] });
    expect(validate(lead(), r).ok).toBe(true);
  });

  it('no sentence tied to a fact fails, even with a clean headline and caption (was "Validação ok · 0 frases, 0 fatos")', () => {
    const v = validate(lead(), draft({ cards: [{ papel: 'capa', titulo: 'Ponte da Santos Dumont fecha por 15 dias', frases: [] }] }));
    expect(v.ok).toBe(false);
    expect(v.erros).toEqual(['nenhuma frase com fonte: os cards precisam de frases presas a um fato']);
    // Post: the cover is the single image and carries the sentences; with one tied to a fact, it passes.
    expect(validate(lead(), draft({ cards: [{ papel: 'capa', titulo: 'Ponte da Santos Dumont fecha por 15 dias', frases: [{ texto: 'A prefeitura interdita a ponte.', fatoId: 'f1' }] }] })).ok).toBe(true);
  });

  it("the caption closing and the CTA belong to the system: a number in the outlet's or source's name doesn't fail (Fadell case)", () => {
    const p = lead({ marca: { nome: 'Gazeta do Bairro 2' }, fatos: lead().fatos.map((f) => ({ ...f, fonteNome: 'relato de Gazeta do Bairro 2' })) });
    const closing = closingCaption(p);
    expect(closing).toBe('\n\nSiga Gazeta do Bairro 2.\n\nFonte: relato de Gazeta do Bairro 2');
    const r = draft({ legenda: `A ponte fecha.${closing}` });
    r.cards.push({ papel: 'convite', titulo: 'Seu bairro, com fonte.', frases: [{ texto: 'Siga Gazeta do Bairro 2 pra receber as notícias de perto.', fatoId: null }] });
    expect(validate(p, r)).toEqual({ ok: true, erros: [], avisos: [] });
    // A number the model wrote in the caption still gets caught.
    expect(validate(p, draft({ legenda: `Ponte fecha por 30 dias.${closing}` })).erros).toEqual(['número 30 não aparece nos fatos']);
  });

  it('body and sentence limits apply to the post cover', () => {
    const v = validate(lead(), draft({ cards: [{ papel: 'capa', titulo: 'Ponte', frases: [{ texto: 'a', fatoId: 'f1' }, { texto: 'b', fatoId: 'f1' }, { texto: 'c', fatoId: 'f2' }] }] }));
    expect(v.erros).toEqual(['card capa: mais de 2 frases']);
  });
});

describe('chooseCta', () => {
  it("same lead → same CTA (a rewrite doesn't swap the CTA); without config → generic from the handle", () => {
    const ctas = [1, 2, 3].map((i) => ({ titulo: `T${i}`, texto: `x${i}`, legenda: `L${i}` }));
    const p = lead({ marca: { ctas, handle: '@pagina' } });
    expect(chooseCta(p)).toEqual(chooseCta({ ...p }));
    expect(ctas).toContainEqual(chooseCta(p));
    expect(chooseCta(lead({ marca: { handle: '@pagina' } })).legenda).toBe('Siga @pagina.');
  });
});

describe('spans and triage', () => {
  it('spans cover title and body with exact offsets in the model input', () => {
    const spans = spansEvidence(ARTICLE);
    const input = inputModel(ARTICLE);
    expect(spans[0].texto).toBe(ARTICLE.titulo);
    expect(spans.length).toBe(4);
    for (const s of spans) expect(input.slice(s.inicio, s.fim)).toBe(s.texto);
  });

  it('schema only offers city, neighbourhood and date that literally exist in the text', () => {
    const r = schemaTriage(ARTICLE, { cidades: ['Guarujá', 'Bertioga'], bairros: ['Enseada', 'Pitangueiras'] });
    expect(r.cidadesCandidatas).toEqual(['Guarujá']);
    expect(r.bairrosCandidatos).toEqual(['Enseada']);
    expect(r.datasCandidatas).toEqual(['2026-11-02']);
  });

  const valid = { tipo: 'servico', tipo_span: 1, editoria: 'transito', editoria_span: 3, ocorreu_em: null, data_span: null, locais: [{ cidade: 'Guarujá', bairro: null, papel: 'evento', span: 1 }] };

  it('accepts a response tied to the spans', () => {
    const t = resolveTriage(valid, ARTICLE);
    expect(t).toMatchObject({ tipo: 'servico', editoria: 'transito', locais: [{ cidade: 'Guarujá', bairro: null, papel: 'evento', spanId: 1 }], rejeitados: [] });
  });

  it('rejects a nonexistent span id, an extra key, and a date outside the text', () => {
    expect(() => resolveTriage({ ...valid, tipo_span: 99 }, ARTICLE)).toThrow('span_id_invalido');
    expect(() => resolveTriage({ ...valid, extra: 1 }, ARTICLE)).toThrow('triagem_chaves_invalidas');
    expect(() => resolveTriage({ ...valid, ocorreu_em: '2026-11-02', data_span: null }, ARTICLE)).toThrow('data_sem_span');
  });

  it('a city or neighbourhood not in the quoted excerpt is discarded, not invented', () => {
    const t = resolveTriage({ ...valid, locais: [{ cidade: 'Guarujá', bairro: null, papel: 'evento', span: 2 }, { cidade: 'Guarujá', bairro: 'Enseada', papel: 'evento', span: 1 }] }, ARTICLE);
    expect(t.locais).toEqual([expect.objectContaining({ cidade: 'Guarujá', bairro: null, spanId: 1 })]);
    expect(t.rejeitados).toEqual([{ indice: 0, motivo: 'cidade_ausente_do_trecho' }, { indice: 1, motivo: 'bairro_ausente_do_trecho' }]);
  });
});

describe('formatDate', () => {
  it('a date with only the day comes out on the same day, not the previous one (São Paulo time zone)', () => {
    expect(formatDate('2026-11-01')).toMatch(/^01 de nov\.? de 2026$/);
  });
  it('an instant with a time is converted to São Paulo', () => {
    expect(formatDate('2026-11-01T02:00:00Z')).toMatch(/^31 de out\.? de 2026$/);
  });
});
