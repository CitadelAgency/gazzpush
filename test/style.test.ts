import { describe, expect, it } from 'vitest';
import type { Card } from '../src/lib/cards';
import { cardExtras, cardVars, type BaseCard } from '../src/lib/cardHtml';
import { contrast, hexRgb } from '../src/lib/contrast';
import { COMPOSITIONS, cssComposition, isComposition } from '../src/lib/style';
import { judgeContrast, layoutOk, type MetricsLayout } from '../src/lib/qaLayout';

const base: BaseCard = {
  autoral: false, par: 'padrao', cores: { fundo: '#1f2a24', texto: '#fffcf6', acento: '#b3e9c2' }, marcaNome: 'Gazeta <do> Guarujá',
  editoria: 'Cidade', eyebrowCapa: 'Cidade', dataLabel: 'Ocorrência', dataValor: '02 de nov.', fonteNome: 'Prefeitura', fonteUrl: 'https://a.example', ctaUrl: 'https://a.example', dominio: 'a.example',
};
const cover: Card = { id: 'c', layout: 'capa', titulo: 'T', frases: [] };
const invite: Card = { id: 'k', layout: 'convite', titulo: 'T', frases: [] };

describe('compositions', () => {
  it("the default adds no class or CSS: that keeps the old piece's hash", () => {
    expect(cardExtras({ ...base, composicao: 'padrao' }, cover)).toEqual({});
    expect(cardExtras(base, cover)).toEqual({});
    expect(cardVars({ ...base, composicao: 'padrao' }, cover, 'carrossel').SLIDE_CLASS).toBe(cardVars(base, cover, 'carrossel').SLIDE_CLASS);
    expect(cssComposition('padrao')).toBe('');
  });

  it('no gradient or hex in the CSS of the four', () => {
    for (const c of COMPOSITIONS) expect(cssComposition(c)).not.toMatch(/gradient|#[0-9a-f]{3,8}\b/i);
  });

  it("the CTA doesn't change in any composition, and the badge stays on it", () => {
    for (const composition of COMPOSITIONS) {
      expect(cardVars({ ...base, composicao: composition }, invite, 'carrossel').SLIDE_CLASS).not.toContain('comp-');
      expect(cardExtras({ ...base, composicao: composition }, invite)).toEqual({});
    }
    const withBadge = cardExtras({ ...base, composicao: 'tarja', publicidade: { rotulo: 'Publicidade', anunciante: 'X' } }, invite);
    expect(withBadge.SELO_TAG).toContain('Publicidade');
    expect(withBadge.ESTILO_CSS).not.toContain('comp-');
  });

  it('Cartaz drops the art; front page uses the escaped name, even with a logo', () => {
    expect(cardExtras({ ...base, composicao: 'cartaz' }, cover).ART_TAG).toBe('');
    expect(cardExtras({ ...base, composicao: 'primeira-pagina' }, cover).BRAND_TAG).toBe('<span class="brand-name">Gazeta &lt;do&gt; Guarujá</span>');
  });

  it('catalog rejects an unknown option', () => {
    expect(isComposition('tarja')).toBe(true);
    expect(isComposition('jornal')).toBe(false);
    expect(isComposition(null)).toBe(false);
  });
});

describe('card contrast', () => {
  it('reads the rgb from the browser and refuses transparency', () => {
    expect(hexRgb('rgb(31, 42, 36)')).toBe('#1f2a24');
    expect(hexRgb('rgba(0, 0, 0, 0.5)')).toBeNull();
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21);
  });

  it('below 4.5:1 fails, with the target and the ratio, without repeating', () => {
    const gray = { alvo: 'location', cor: 'rgb(140, 140, 140)', fundo: 'rgb(128, 128, 128)' };
    expect(judgeContrast([gray, gray, { alvo: 'H1', cor: 'rgb(255, 255, 255)', fundo: 'rgb(0, 0, 0)' }])).toEqual(['location 1.2:1']);
  });

  it('`semContraste` drops layoutOk; an old metric without the field still counts', () => {
    const m: MetricsLayout = { width: 1080, height: 1350, overflow: [], overlap: false, headlineLines: 2, imagesLoaded: true, badText: false, fontsReady: true };
    expect(layoutOk(m, 1350)).toBe(true);
    expect(layoutOk({ ...m, semContraste: ['H1 2.0:1'] }, 1350)).toBe(false);
  });
});
