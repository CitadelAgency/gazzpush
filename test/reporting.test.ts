import { describe, expect, it } from 'vitest';
import {
  quotesBlock, accountsBlock, circularSources, strengthOf, spellingsDifferent, readNumber, manualInBlock, openBrand, fromTextNames, topicsOf, suggestedType,
  ACCUSATION, TOPIC_SENSITIVE,
} from '../src/lib/reporting';

describe('numbers by code', () => {
  it('reads numbers in pt and en, with decimal places and multiplier', () => {
    expect(readNumber('1.234,5', 'mil', 'pt-BR')).toEqual({ valor: 1_234_500, casas: 1, mult: 1000 });
    expect(readNumber('1,234.5', 'million', 'en')).toEqual({ valor: 1_234_500_000, casas: 1, mult: 1e6 });
    expect(readNumber('12', undefined, 'pt-BR')).toEqual({ valor: 12, casas: 0, mult: 1 });
  });

  it("a variation that doesn't add up becomes a note with the right math; one that adds up doesn't", () => {
    const [a] = accountsBlock('b1', 'O gasto foi de 10 para 15 milhões, alta de 40%.');
    expect(a.trecho).toBe('de 10 para 15 milhões, alta de 40%');
    expect(a.explicacao).toBe('De 10.000.000 para 15.000.000 é alta de 50%, não de 40%.');
    const [b] = accountsBlock('b1', 'O gasto foi de R$ 10 milhões para R$ 15 milhões, alta de 40%.');
    expect(b.explicacao).toBe('De 10.000.000 para 15.000.000 é alta de 50%, não de 40%.');
    expect(accountsBlock('b1', 'O gasto foi de R$ 10 milhões para R$ 15 milhões, alta de 50%.')).toEqual([]);
    expect(accountsBlock('b1', 'A frota caiu 20%, de 50 para 40 ônibus.')).toEqual([]);
    expect(accountsBlock('b1', 'A frota cresceu 20%, de 50 para 40 ônibus.')[0].explicacao).toBe('De 50 para 40 é queda de 20%, não cresceu.');
    // Arredondamento: 12,5% aceita 12,45 a 12,55.
    expect(accountsBlock('b1', 'De 8 para 9, aumento de 12,5%.')).toEqual([]);
    expect(accountsBlock('b1', 'De 8 para 9, aumento de 14%.')).toHaveLength(1);
    // A pair of years is not a basis for arithmetic.
    expect(accountsBlock('b1', 'De 2020 para 2024, alta de 30% nas queixas.')).toEqual([]);
  });

  it('part of the whole, and sum', () => {
    expect(accountsBlock('b1', 'Foram 12 dos 40 contratos (30%).')).toEqual([]);
    expect(accountsBlock('b1', 'Foram 12 dos 40 contratos (25%).')[0].explicacao).toBe('12 de 40 é 30%, não 25%.');
    expect(accountsBlock('b1', 'Os lotes custaram 3, 4 e 5 milhões, somando 12 milhões.')).toEqual([]);
    expect(accountsBlock('b1', 'Os lotes custaram 3, 4 e 5, somando 13.')[0].explicacao).toBe('A soma dá 12, não 13.');
  });

  it('in English', () => {
    expect(accountsBlock('b1', 'Spending went from 10 to 15, a rise of 40%.', 'en')[0].explicacao).toBe('From 10 to 15 is a rise of 50%, not 40%.');
    expect(accountsBlock('b1', '12 of the 40 contracts (30%) were renewed.', 'en')).toEqual([]);
  });
});

describe('quotes, names, style guide and sources', () => {
  it('a quote is checked only when it appears literally in the dossier', () => {
    const evs = [{ id: 'e1', texto: 'Ele disse:   "Não houve desvio de recursos"  na sessão.' }];
    const [a, b] = quotesBlock('b1', '“Não houve desvio de recursos.” E depois: “nunca recebi um centavo”.', evs);
    expect(a).toMatchObject({ evidenciaId: 'e1', citacao: 'Não houve desvio de recursos', inicio: 0 });
    expect(b.evidenciaId).toBeNull();
  });

  it('names without the sentence-start word, acronym as institution, different spelling', () => {
    const names = fromTextNames([
      { id: 'p0', texto: 'Segundo Luís Souza, o Ministério Público e o PT não responderam.' },
      { id: 'p1', texto: 'Procurado, Luis Sousa negou. Maria da Silva confirmou.' },
    ]);
    expect(names.map((n) => [n.nome, n.tipo])).toEqual([
      ['Luís Souza', 'pessoa'], ['Ministério Público', 'instituicao'], ['PT', 'instituicao'], ['Luis Sousa', 'pessoa'], ['Maria da Silva', 'pessoa'],
    ]);
    expect(names[0].mencoes[0]).toEqual({ blocoId: 'p0', inicio: 8, fim: 18 });
    expect(spellingsDifferent(names)).toEqual([['Luís Souza', 'Luis Sousa']]);
  });

  it('style guide points at a whole word; acronym respects capitals', () => {
    const rules = [
      { id: 'r1', tipo: 'grafia' as const, procurar: 'presidenta', preferir: 'presidente', nota: null },
      { id: 'r2', tipo: 'sigla' as const, procurar: 'Pm', preferir: 'PM', nota: 'Sigla em maiúsculas.' },
    ];
    const r = manualInBlock('b1', 'A Presidenta falou com a PM e com a Pm. Presidentas não.', rules);
    expect(r.map((x) => [x.trecho, x.explicacao])).toEqual([['Presidenta', 'O manual pede “presidente”.'], ['Pm', 'O manual pede “PM”. Sigla em maiúsculas.']]);
  });

  it('strength by source type and official suggestion by address', () => {
    expect(suggestedType('https://www.camara.leg.br/x')).toBe('oficial');
    expect(suggestedType('https://dados.gov.br/a')).toBe('oficial');
    expect(suggestedType('https://jornal.com.br/a')).toBeNull();
    expect([strengthOf('oficial'), strengthOf('primaria'), strengthOf('materia'), strengthOf('anonima'), strengthOf(null)]).toEqual(['forte', 'forte', 'media', 'fraca', 'sem_tipo']);
  });

  it('circular sources: one cites the other, or they repeat 25 words', () => {
    const base = Array.from({ length: 30 }, (_, i) => `palavra${i}`).join(' ');
    const r = circularSources([
      { id: 'a', url: 'https://www.orgao.gov.br/nota/123', texto: 'Nota oficial.' },
      { id: 'b', url: 'https://jornal.com/x', texto: 'Segundo orgao.gov.br/nota/123, houve gasto.' },
      { id: 'c', url: 'https://outro.com/y', texto: `Texto ${base} fim.` },
      { id: 'd', url: 'https://mais.com/z', texto: `Outro ${base} final.` },
    ]);
    expect(r).toEqual([{ de: 'b', para: 'a', motivo: 'cita' }, { de: 'd', para: 'c', motivo: 'repete' }]);
  });

  it('topics, accusation and sensitive topic', () => {
    expect(topicsOf('O vereador do PT e a igreja evangélica')).toEqual(['politica', 'religiao']);
    expect(ACCUSATION.test('é acusado de desvio')).toBe(true);
    expect(ACCUSATION.test('a ponte foi inaugurada')).toBe(false);
    expect(TOPIC_SENSITIVE.test('O governo chinês e Taiwan')).toBe(true);
    expect(TOPIC_SENSITIVE.test('A Câmara aprovou')).toBe(false);
  });

  it('open mark depending on the decision', () => {
    expect(openBrand({ estado: 'sem_fonte', risco: null })).toBe(true);
    expect(openBrand({ estado: 'com_evidencia', risco: null })).toBe(false);
    expect(openBrand({ estado: 'com_evidencia', risco: null, incerto: 1 })).toBe(true);
    expect(openBrand({ estado: 'risco', risco: 'sem_outro_lado' }, { tipo: 'outro_lado' })).toBe(false);
    expect(openBrand({ estado: 'risco', risco: 'vitima_ou_menor' }, { tipo: 'outro_lado' })).toBe(true);
    expect(openBrand({ estado: 'risco', risco: 'vitima_ou_menor' }, { tipo: 'ignorar' })).toBe(false);
  });
});
