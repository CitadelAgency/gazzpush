import { describe, expect, it } from 'vitest';
import type { Card } from '../src/lib/cards';
import { extrasDoCard, varsDoCard, type BaseCard } from '../src/lib/cardHtml';
import { contraste, hexDeRgb } from '../src/lib/contraste';
import { COMPOSICOES, cssComposicao, ehComposicao } from '../src/lib/estilo';
import { julgarContraste, layoutOk, type MetricasLayout } from '../src/lib/qaLayout';

const base: BaseCard = {
  autoral: false, par: 'padrao', cores: { fundo: '#1f2a24', texto: '#fffcf6', acento: '#b3e9c2' }, marcaNome: 'Marca <em> HTML',
  editoria: 'Cidade', eyebrowCapa: 'Cidade', dataLabel: 'Ocorrência', dataValor: '02 de nov.', fonteNome: 'Fonte', fonteUrl: 'https://a.example', ctaUrl: 'https://a.example', dominio: 'a.example',
};
const capa: Card = { id: 'c', layout: 'capa', titulo: 'T', frases: [] };
const convite: Card = { id: 'k', layout: 'convite', titulo: 'T', frases: [] };

describe('composições', () => {
  it('padrão não acrescenta classe nem CSS: é o que mantém o hash da peça antiga', () => {
    expect(extrasDoCard({ ...base, composicao: 'padrao' }, capa)).toEqual({});
    expect(extrasDoCard(base, capa)).toEqual({});
    expect(varsDoCard({ ...base, composicao: 'padrao' }, capa, 'carrossel').SLIDE_CLASS).toBe(varsDoCard(base, capa, 'carrossel').SLIDE_CLASS);
    expect(cssComposicao('padrao')).toBe('');
  });

  it('sem gradiente nem hex no CSS das quatro', () => {
    for (const c of COMPOSICOES) expect(cssComposicao(c)).not.toMatch(/gradient|#[0-9a-f]{3,8}\b/i);
  });

  it('o convite não muda em composição nenhuma, e o selo continua nele', () => {
    for (const composicao of COMPOSICOES) {
      expect(varsDoCard({ ...base, composicao }, convite, 'carrossel').SLIDE_CLASS).not.toContain('comp-');
      expect(extrasDoCard({ ...base, composicao }, convite)).toEqual({});
    }
    const comSelo = extrasDoCard({ ...base, composicao: 'tarja', publicidade: { rotulo: 'Publicidade', anunciante: 'X' } }, convite);
    expect(comSelo.SELO_TAG).toContain('Publicidade');
    expect(comSelo.ESTILO_CSS).not.toContain('comp-');
  });

  it('cartaz tira a arte; primeira página usa o nome escapado, mesmo com logo', () => {
    expect(extrasDoCard({ ...base, composicao: 'cartaz' }, capa).ART_TAG).toBe('');
    expect(extrasDoCard({ ...base, composicao: 'primeira-pagina' }, capa).BRAND_TAG).toBe('<span class="brand-name">Marca &lt;em&gt; HTML</span>');
  });

  it('catálogo fecha opção desconhecida', () => {
    expect(ehComposicao('tarja')).toBe(true);
    expect(ehComposicao('jornal')).toBe(false);
    expect(ehComposicao(null)).toBe(false);
  });
});

describe('contraste do card', () => {
  it('lê o rgb do navegador e recusa transparência', () => {
    expect(hexDeRgb('rgb(31, 42, 36)')).toBe('#1f2a24');
    expect(hexDeRgb('rgba(0, 0, 0, 0.5)')).toBeNull();
    expect(contraste('#000000', '#ffffff')).toBeCloseTo(21);
  });

  it('abaixo de 4,5:1 reprova, com o alvo e a razão, sem repetir', () => {
    const cinza = { alvo: 'location', cor: 'rgb(140, 140, 140)', fundo: 'rgb(128, 128, 128)' };
    expect(julgarContraste([cinza, cinza, { alvo: 'H1', cor: 'rgb(255, 255, 255)', fundo: 'rgb(0, 0, 0)' }])).toEqual(['location 1.2:1']);
  });

  it('`semContraste` derruba o layoutOk; métrica antiga, sem o campo, continua valendo', () => {
    const m: MetricasLayout = { width: 1080, height: 1350, overflow: [], overlap: false, headlineLines: 2, imagesLoaded: true, badText: false, fontsReady: true };
    expect(layoutOk(m, 1350)).toBe(true);
    expect(layoutOk({ ...m, semContraste: ['H1 2.0:1'] }, 1350)).toBe(false);
  });
});
