// Rule 6 of the customisation handoff: an old piece keeps coming out the same. The card's hash is the SHA-256 of the
// HTML, and only with an equal hash is the stored art reused. The values below were generated at commit 81f457d, before
// any new option in the template: if one of them changes, every old piece in review generates new art on its next edit.
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { Card } from '../src/lib/cards';
import type { Lead } from '../src/lib/lead';
import type { Draft } from '../src/lib/drafting';
import { prepareCards } from '../src/lib/render';

const lead = (over: Partial<Lead> = {}): Lead => ({
  id: 'p1', tenantId: 't', titulo: 'Ponte', resumo: null, editoria: 'cidade', municipioIbge: null, cidade: 'Guarujá', bairro: 'Centro',
  fatos: [{ id: 'f1', documentoId: 'd', tipo: 'manchete', texto: 'Prefeitura interdita ponte', municipioIbge: null, bairro: null, dataFato: '2026-11-02', fonteUrl: 'https://exemplo.gov.br/n', fonteNome: 'Prefeitura' }],
  marca: { nome: 'Gazeta', handle: '@gazeta', cores: { fundo: '#102030', texto: '#fafafa', acento: '#ffcc00' }, fontes: 'jornal' }, voz: {}, ...over,
});

const sentence = (text: string) => ({ texto: text, fatoId: 'f1' });
const CARDS: Card[] = [
  { id: 'c1', layout: 'capa', titulo: 'Ponte fecha para obras', frases: [] },
  { id: 'c2', layout: 'texto', titulo: 'O que muda', frases: [sentence('A prefeitura interdita a ponte.')] },
  { id: 'c3', layout: 'citacao', titulo: 'Secretário', frases: [sentence('A obra é urgente.')] },
  { id: 'c4', layout: 'numero', titulo: '15 dias', frases: [sentence('A interdição dura 15 dias.')] },
  { id: 'c5', layout: 'lista', titulo: 'Desvios', frases: [sentence('Rua A'), sentence('Rua B')] },
  { id: 'c6', papel: 'contexto', titulo: 'Contexto', frases: [sentence('A ponte é de 1970.')] },
  { id: 'c7', layout: 'capa', titulo: 'Com foto', frases: [], imagem: 'fotos/t/p/foto.png' },
  { id: 'convite', layout: 'convite', titulo: 'Siga', frases: [{ texto: 'Siga a página.', fatoId: null }] },
];
const draft: Draft = { manchete: 'Ponte', resumo: '', legenda: 'A ponte fecha.', cards: CARDS, modelo: 't', custoUsd: 0 };

const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
/** The Windows checkout's CRLF does not enter the comparison: what matters is the HTML's content. */
const hashes = async (p: Lead) => {
  await env.MEDIA.put('fotos/t/p/foto.png', new Uint8Array([1, 2, 3]), { httpMetadata: { contentType: 'image/png' } });
  const cards = await prepareCards(env, { tenantId: 't', pecaId: 'x', versao: 1, formato: 'carrossel', rascunho: draft, pauta: p, hoje: '2026-11-05T12:00:00.000Z' });
  return Promise.all(cards.map((c) => sha(c.html.replace(/\r\n/g, '\n'))));
};

describe('piece without template comes out byte for byte as before', () => {
  it('local outlet', async () => {
    expect(await hashes(lead())).toEqual(GOLDEN_LOCAL);
  });
  it('author outlet, in English', async () => {
    expect(await hashes(lead({ modo: 'autoral', idioma: 'en' }))).toEqual(GOLDEN_AUTHOR);
  });
});

const GOLDEN_LOCAL = [
  '566ee86bb17e36803721c9b7927fe3308357b2cc5fca0dcc65651d4f7ddaa03a',
  'b3f96efa7c4df25cd8f3f81b005d3c69f17bde69d4120beb1e6e47ce89bcf8b4',
  'fa4ed80990f5aa2e0ff3e1d7fd60a8a4df86eac1d9cfd7d525bd2c651e225dca',
  '91d401ba22cf56f8d2d714042cb0601c745d40df5a631fee3a31c98067a1401a',
  'a59edb9c3106360fecf09e1dd832cfbd3bad35b704fe4875a0ec9e2596925ffa',
  '538da5a8f32d5878eeac4f7e6e0ba0bbd52f4f6eb19279acca6e6adb458d24d3',
  '835df4a900f12be1afa909f5b8a5ad2ccc415aa2693dbcc76387bce3602d9278',
  'bee64688740bedb89fff5fee210af0344c8e2625828c6996bf9f08311fddbd12',
];
const GOLDEN_AUTHOR = [
  'c21271f2fe18fcaf1f9bdbb1c11885b79350fafa15d94ab333a41c0ce9966acc',
  'b91d795aa2535d9f5de84df3f8adebe30c140625f485ee42d4d3afdb7053841d',
  '60a58cc5f608c43e9ce8d2d595c1b016d1b5012cb386f84f4182a6cfd9776e27',
  '421d5e955269e2eff5f2f44f615f2a28dc1e485f1b3c4657e676504096e678cc',
  'cee485859802105d522b688a65ddb12522e930d5eb468b1fb9f841dbb9b474a1',
  '0f5570079f1be2e62dddd20f9d95884fb9bebe71ec28fcc43409bec7217611d6',
  'a537eba590ec609e679b8e6ca0b703d40cdc934c48b66f8b15c3890eeb15ba0f',
  'a24b80eff4d76afe93791b05ac5f6194c09d62e9d9f8194b510877de239582d3',
];
