// Ajuste conferido: encurtar para caber, e só isso. O modelo vê apenas o fato daquela frase, e cada opção passa por
// `validar` numa cópia e por LIMITES. Nada é gravado aqui: quem grava é "Salvar e conferir", pelo caminho de sempre.
import type { Env } from '../env';
import { LIMITES, layoutDe, normalizarCards, type Card, type Layout } from './cards';
import { chamarTexto } from './texto';
import type { Pauta } from './pauta';
import type { Rascunho } from './redacao';
import { validar } from './validacao';

/** Marca o pedido para o modelo falso do e2e reconhecer. */
export const INICIO_PROMPT_AJUSTE = 'ENCURTAR PARA CABER.';

const OPCOES = 2;
// Citação e documento são literais; convite é copy do dono.
const FORA_DO_AJUSTE: readonly string[] = ['convite', 'citacao', 'documento'];

export type AlvoAjuste = { card: Card; indice: number | null; atual: string; maximo: number; fatos: string[] };

/** O que vai ser encurtado (`frase` null: o título), ou o motivo em código de ficar de fora. */
export function alvoDoAjuste(pauta: Pauta, r: Rascunho, cardId: unknown, frase: unknown): AlvoAjuste | 'nao_encontrado' | 'fora' {
  const card = normalizarCards(r.cards ?? []).find((c) => c.id === cardId);
  if (!card) return 'nao_encontrado';
  const layout = layoutDe(card) as Layout;
  if (FORA_DO_AJUSTE.includes(layout)) return 'fora';
  const lim = LIMITES[layout];
  const doFato = (id: string | null | undefined) => pauta.fatos.filter((f) => f.id === id).map((f) => f.texto);
  if (frase === null || frase === undefined) {
    const citados = (card.frases ?? []).flatMap((f) => doFato(f.fatoId));
    return { card, indice: null, atual: card.titulo, maximo: lim.titulo, fatos: citados.length ? citados : pauta.fatos.map((f) => f.texto) };
  }
  if (!Number.isInteger(frase)) return 'nao_encontrado';
  const f = (card.frases ?? [])[frase as number];
  if (!f) return 'nao_encontrado';
  if (f.autor || !f.fatoId) return 'fora';
  const resto = (card.frases ?? []).reduce((soma, x, i) => (i === frase ? soma : soma + x.texto.length), 0);
  return { card, indice: frase as number, atual: f.texto, maximo: Math.min(lim.frase ?? Infinity, Math.max(1, lim.corpo - resto)), fatos: doFato(f.fatoId) };
}

export function promptAjuste(pauta: Pauta, a: AlvoAjuste) {
  const alvo = Math.min(a.maximo, Math.max(20, Math.floor(a.atual.length * 0.8)));
  const system = [
    INICIO_PROMPT_AJUSTE,
    `Escreva em ${pauta.idioma === 'en' ? 'inglês' : 'português do Brasil'} ${OPCOES} versões mais curtas do texto, com até ${alvo} caracteres cada.`,
    'Só encurte. Mantenha o sentido e os mesmos nomes, números e datas, e use SOMENTE o fato listado.',
    'Escreva cada número como ele está no texto: "quatro" continua "quatro", nunca vira "4", e "20 horas" não vira "20h".',
    'Não tire o que limita o fato, como parcialmente, cerca de, até, segundo ou suspeito de.',
    'Não acrescente nada que não esteja no texto ou no fato. Sem adjetivos de opinião.',
    'Responda em JSON: {"opcoes":["...","..."]}.',
  ].join('\n');
  return { system, user: `Texto: ${a.atual}\nFato:\n${a.fatos.map((f) => `- ${f}`).join('\n')}` };
}

/** A cópia do rascunho com o texto novo. */
function comTexto(r: Rascunho, a: AlvoAjuste, texto: string): Rascunho {
  const cards = normalizarCards(r.cards ?? []).map((c) => {
    if (c.id !== a.card.id) return c;
    if (a.indice === null) return { ...c, titulo: texto };
    return { ...c, frases: (c.frases ?? []).map((f, i) => (i === a.indice ? { ...f, texto } : f)) };
  });
  return { ...r, cards };
}

/** Só as opções mais curtas que cabem e não trazem erro novo. */
export function conferirOpcoes(pauta: Pauta, r: Rascunho, formato: 'post' | 'carrossel', a: AlvoAjuste, brutas: unknown) {
  const lista = Array.isArray((brutas as { opcoes?: unknown })?.opcoes) ? (brutas as { opcoes: unknown[] }).opcoes : [];
  const base = new Set(validar(pauta, r, { humano: true, formato }).erros);
  const opcoes: string[] = [];
  let reprovadas = 0;
  for (const bruta of lista.slice(0, OPCOES)) {
    const texto = typeof bruta === 'string' ? bruta.replace(/\s+/g, ' ').trim() : '';
    const aprovada = texto && texto.length < a.atual.length && texto.length <= a.maximo && !opcoes.includes(texto)
      && validar(pauta, comTexto(r, a, texto), { humano: true, formato }).erros.every((e) => base.has(e));
    if (aprovada) opcoes.push(texto); else reprovadas++;
  }
  return { opcoes, reprovadas };
}

export async function gerarAjuste(env: Env, pauta: Pauta, r: Rascunho, formato: 'post' | 'carrossel', a: AlvoAjuste) {
  const { system, user } = promptAjuste(pauta, a);
  const { json, custoUsd } = await chamarTexto(env, { tenantId: pauta.tenantId, funcao: 'ajuste' }, system, user, 0.2);
  return { ...conferirOpcoes(pauta, r, formato, a, json), custoUsd };
}
