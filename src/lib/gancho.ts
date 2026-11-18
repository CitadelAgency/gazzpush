// Gancho conferido: três manchetes de ângulos diferentes para a capa, presas aos fatos da pauta. O modelo sugere e o
// código confere: cada candidata entra numa cópia do rascunho e só aparece se não trouxer erro novo em `validar` e couber
// em `LIMITES.capa.titulo`. Nada é gravado aqui: a escolhida segue o caminho de `Salvar e conferir`.
import type { Env } from '../env';
import { LIMITES, layoutDe } from './cards';
import { chamarTexto } from './texto';
import type { Pauta } from './pauta';
import type { Rascunho } from './redacao';
import { validar } from './validacao';

export const ANGULOS_NOTICIA = ['numero', 'consequencia', 'servico'] as const;
export const ANGULOS_AUTORAL = ['tese', 'exemplo', 'pergunta'] as const;
export type Angulo = (typeof ANGULOS_NOTICIA)[number] | (typeof ANGULOS_AUTORAL)[number];

const PEDIDO: Record<Angulo, string> = {
  numero: 'numero: abre com o número ou dado mais forte dos fatos; sem número nos fatos, com o dado concreto mais forte',
  consequencia: 'consequencia: o que muda para quem mora na cidade',
  servico: 'servico: o que a pessoa precisa saber ou fazer',
  tese: 'tese: a ideia central que o autor defende',
  exemplo: 'exemplo: o exemplo mais forte do texto',
  pergunta: 'pergunta: a pergunta que o texto responde',
};

/** Marca o pedido para o modelo falso do e2e reconhecer. */
export const INICIO_PROMPT_GANCHO = 'MANCHETES DE CAPA.';

export interface OpcaoGancho { angulo: Angulo; titulo: string }

export function promptGancho(pauta: Pauta, atual: string) {
  const angulos = pauta.modo === 'autoral' ? ANGULOS_AUTORAL : ANGULOS_NOTICIA;
  const system = [
    INICIO_PROMPT_GANCHO,
    `Escreva em ${pauta.idioma === 'en' ? 'inglês' : 'português do Brasil'} três manchetes para a capa de um post, uma por ângulo.`,
    `Ângulos: ${angulos.map((a) => PEDIDO[a]).join('; ')}.`,
    `Cada manchete tem até ${LIMITES.capa.titulo} caracteres e usa SOMENTE os fatos listados.`,
    'Não invente nomes, números, datas, locais, causas ou consequências. Sem adjetivos de opinião e sem rótulo de ângulo no texto.',
    'Responda em JSON: {"manchetes":[{"angulo":"...","titulo":"..."}]}.',
  ].join('\n');
  const fatos = pauta.fatos.map((f) => `- ${f.texto}`).join('\n');
  return { system, user: `Pauta: ${pauta.titulo}\nManchete atual: ${atual}\nFatos:\n${fatos}`, angulos };
}

/** Copia o rascunho com a manchete nova na capa. Sem card de capa, devolve null. */
export function comManchete(r: Rascunho, titulo: string): Rascunho | null {
  const i = (r.cards ?? []).findIndex((c) => layoutDe(c) === 'capa');
  if (i < 0) return null;
  return { ...r, manchete: titulo, cards: r.cards.map((c, j) => (j === i ? { ...c, titulo } : c)) };
}

/** Só as candidatas que não trazem erro novo: um problema que a versão já tinha não é culpa da manchete. */
export function conferirCandidatas(pauta: Pauta, r: Rascunho, formato: 'post' | 'carrossel', brutas: unknown, angulos: readonly Angulo[]) {
  const lista = Array.isArray((brutas as { manchetes?: unknown })?.manchetes) ? (brutas as { manchetes: unknown[] }).manchetes : [];
  const base = new Set(validar(pauta, r, { humano: true, formato }).erros);
  const opcoes: OpcaoGancho[] = [];
  let reprovadas = 0;
  for (const bruta of lista.slice(0, angulos.length)) {
    const b = bruta as { angulo?: unknown; titulo?: unknown };
    const titulo = typeof b?.titulo === 'string' ? b.titulo.replace(/\s+/g, ' ').trim() : '';
    const copia = titulo && titulo.length <= LIMITES.capa.titulo ? comManchete(r, titulo) : null;
    const aprovada = copia && validar(pauta, copia, { humano: true, formato }).erros.every((e) => base.has(e));
    if (!aprovada || opcoes.some((o) => o.titulo === titulo)) { reprovadas++; continue; }
    opcoes.push({ angulo: angulos.includes(b.angulo as Angulo) ? (b.angulo as Angulo) : angulos[opcoes.length], titulo });
  }
  return { opcoes, reprovadas };
}

export async function gerarGanchos(env: Env, pauta: Pauta, r: Rascunho, formato: 'post' | 'carrossel') {
  const { system, user, angulos } = promptGancho(pauta, r.manchete);
  const { json, custoUsd } = await chamarTexto(env, { tenantId: pauta.tenantId, funcao: 'gancho' }, system, user, 0.4);
  return { ...conferirCandidatas(pauta, r, formato, json, angulos), custoUsd };
}
