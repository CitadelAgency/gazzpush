import { cardExtras, type BaseCard } from '../src/lib/cardHtml';
import type { Card } from '../src/lib/cards';

export const baseCard = (): BaseCard => ({
  autoral: false, idioma: 'pt-BR', par: 'padrao', cores: { fundo: '#111111', texto: '#ffffff', acento: '#ffcc00' }, marcaNome: 'Gazeta', editoria: 'Cidade', eyebrowCapa: 'Cidade',
  dataLabel: 'Publicação', dataValor: '05 de nov. de 2026', fonteNome: 'Prefeitura', fonteUrl: 'https://prefeitura.example', ctaUrl: 'https://gazeta.example', dominio: 'gazeta.example',
} as BaseCard);
export const extrasCard = (b: BaseCard, c: Card) => cardExtras(b, c);
