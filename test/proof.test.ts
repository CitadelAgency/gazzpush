// Step 14: proof cards. A document is a literal passage, highlighted and typeset; comparison and timeline have a label,
// and the label goes through the number and date checks. An old card comes out the same: test/legacy-hash.test.ts.
import { describe, expect, it } from 'vitest';
import { baseCard, extrasCard } from './proof-support';
import { WITH_LABEL, LAYOUTS, LAYOUTS_CONTENT, LIMITS, LAYOUT_NAME, LAYOUT_NAME_EN, LABEL_MAX, DESCRIPTION_LAYOUT, type Card, type Layout } from '../src/lib/cards';
import { tagList, cardVars } from '../src/lib/cardHtml';
import { timesReels } from '../src/lib/reelsHtml';
import { scriptReels } from '../src/lib/speech';
import { validate } from '../src/lib/validation';
import type { Lead } from '../src/lib/lead';
import type { Draft } from '../src/lib/drafting';

const FACT = 'A Prefeitura pagou R$ 12 mil à empresa em 2024 e R$ 30 mil em 2025, segundo o Diário Oficial.';
const lead = {
  id: 'p', tenantId: 't', titulo: 'x', idioma: 'pt-BR', modo: 'local', cidade: 'Guarujá', bairro: null, editoria: null, tipoPost: null,
  marca: { nome: 'Gazeta', handle: '@gazeta', cores: { fundo: '#111111', texto: '#ffffff', acento: '#ffcc00' } },
  fatos: [{ id: 'f1', tipo: 'trecho', texto: FACT, fonteUrl: 'https://diario.example/1', fonteNome: 'Diário Oficial', dataFato: null, bairro: null }],
} as unknown as Lead;

const draft = (card: Card): Draft => ({
  manchete: 'Pagamentos da Prefeitura', resumo: '', modelo: 'ia', custoUsd: 0, legenda: 'Pagamentos.\n\nFonte: Diário Oficial',
  cards: [{ id: 'c', layout: 'capa', titulo: 'Pagamentos da Prefeitura', frases: [] }, card, { id: 'k', layout: 'convite', titulo: 'Siga', frases: [{ texto: 'Siga a página.', fatoId: null }] }],
} as unknown as Draft);
const errors = (card: Card) => validate(lead, draft(card), { humano: true, formato: 'carrossel' }).erros;
const f = (text: string, label?: string) => ({ texto: text, fatoId: 'f1', ...(label ? { rotulo: label } : {}) });

describe('catalog', () => {
  it('the three layouts have a limit, a name in both languages and a description', () => {
    for (const l of ['documento', 'comparacao', 'linha_do_tempo'] as const) {
      expect(LAYOUTS_CONTENT).toContain(l);
      expect(LIMITS[l].titulo).toBeGreaterThan(0);
      expect(LAYOUT_NAME[l]).toBeTruthy();
      expect(LAYOUT_NAME_EN[l]).toBeTruthy();
      expect(DESCRIPTION_LAYOUT[l]).toContain(l);
    }
    expect(LAYOUTS.filter((l: Layout) => LIMITS[l] === undefined)).toEqual([]);
  });
});

describe('document', () => {
  const card = (text: string): Card => ({ id: 'd', layout: 'documento', titulo: 'Diário Oficial', frases: [f(text)] });

  it('the excerpt must be literal, as in the quote', () => {
    expect(errors(card('A Prefeitura pagou R$ 12 mil à empresa em 2024'))).toEqual([]);
    expect(errors(card('A Prefeitura pagou R$ 12 mil à empresa'))).toEqual([]);
    expect(errors(card('A Prefeitura pagou 12 mil para a empresa'))).toContainEqual(expect.stringContaining('citação não literal'));
  });

  it("comes out as type, without art, with the source and the date of the sentence's fact", () => {
    const b = { ...baseCard(), fatosDoDocumento: { f1: { nome: 'Diário Oficial', url: 'https://diario.example/1', data: '03 de mar. de 2025' } }, rotuloDataFato: 'Ocorrência' };
    const c = card('A Prefeitura pagou');
    const v = cardVars(b, c, 'carrossel');
    expect(v).toMatchObject({ SOURCE_NAME: 'Diário Oficial', SOURCE_URL: 'https://diario.example/1', DATE_VALUE: '03 de mar. de 2025', DATE_LABEL: 'Ocorrência' });
    expect(v.SLIDE_CLASS).toContain('paper');
    const e = extrasCard(b, c);
    expect(e.ART_TAG).toBe('');
    expect(e.ESTILO_CSS).toContain('box-decoration-break');
    expect(e.ESTILO_CSS).not.toMatch(/blur|wavy/);
  });

  it("the same map doesn't change the source of a card from another layout", () => {
    const b = { ...baseCard(), fatosDoDocumento: { f1: { nome: 'Outra', url: 'https://outra.example', data: 'x' } } };
    const v = cardVars(b, { id: 't', layout: 'texto', titulo: 'T', frases: [f('Frase')] }, 'carrossel');
    expect(v.SOURCE_NAME).toBe(baseCard().fonteNome);
    expect(v.DATE_VALUE).toBe(baseCard().dataValor);
  });
});

describe('comparison and timeline', () => {
  const compares = (a?: string, b?: string): Card => ({ id: 'v', layout: 'comparacao', titulo: 'Quanto a Prefeitura pagou', frases: [f('R$ 12 mil', a), f('R$ 30 mil', b)] });

  it('label is required and has a cap', () => {
    expect(WITH_LABEL).toEqual(['comparacao', 'linha_do_tempo']);
    expect(errors(compares('2024', '2025'))).toEqual([]);
    expect(errors(compares('2024'))).toContainEqual(expect.stringContaining('sem rótulo'));
    expect(errors(compares('2024', 'x'.repeat(LABEL_MAX + 1)))).toContainEqual(expect.stringContaining('rótulo longo'));
  });

  it('the label goes through the number check', () => {
    expect(errors(compares('2024', '2031'))).toContainEqual('número 2031 não aparece nos fatos');
  });

  it('the sentence limit applies', () => {
    expect(errors({ id: 't', layout: 'linha_do_tempo', titulo: 'Os pagamentos', frases: [f('R$ 12 mil', '2024')] }).join(' ')).toMatch(/frases|frase/);
  });

  it('the HTML carries the label and value escaped, and the running body stays empty', () => {
    const c = compares('2024 <b>', '2025');
    expect(tagList(c)).toBe('<ul class="story-list"><li><span class="rotulo">2024 &lt;b&gt;</span><span>R$ 12 mil</span></li><li><span class="rotulo">2025</span><span>R$ 30 mil</span></li></ul>');
    expect(cardVars(baseCard(), c, 'carrossel').BODY_TEXT).toBe('');
  });

  it('list still comes out without a label, byte for byte', () => {
    expect(tagList({ id: 'l', layout: 'lista', titulo: 'T', frases: [f('Um'), f('Dois')] })).toBe('<ul class="story-list"><li>Um</li><li>Dois</li></ul>');
  });

  it('the Reels counts the label in the timing and in the script', () => {
    const c = { layout: 'comparacao', titulo: '', frases: [{ texto: 'um dois', rotulo: 'três quatro' }] };
    const t = { layout: 'texto', titulo: '', frases: [{ texto: 'um dois' }] };
    expect(timesReels([c, t, t])).toEqual([3.4, 2.7, 2.7]);
    expect(scriptReels([compares('2024', '2025')]).map((p) => p.texto)).toEqual(['Quanto a Prefeitura pagou', '2024: R$ 12 mil', '2025: R$ 30 mil']);
  });
});
