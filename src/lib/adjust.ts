// Checked adjustment: shorten to fit, and nothing else. The model only sees that sentence's fact, and each option goes
// through `validate` on a copy and through LIMITS. Nothing is saved here: "Save and check" saves, by the usual path.
import type { Env } from '../env';
import { LIMITS, layoutOf, normalizeCards, type Card, type Layout } from './cards';
import { callText } from './textModel';
import type { Lead } from './lead';
import type { Draft } from './drafting';
import { validate } from './validation';

/** Marks the request so the e2e fake model recognises it. */
export const PROMPT_ADJUSTMENT_HOME = 'SHORTEN TO FIT.';

const OPTIONS = 2;
// Quotes and documents are literal; the CTA is the owner's copy.
const OUTSIDE_ADJUSTMENT: readonly string[] = ['convite', 'citacao', 'documento'];

export type AdjustmentTarget = { card: Card; indice: number | null; atual: string; maximo: number; fatos: string[] };

/** What will be shortened (`frase` null: the title), or the coded reason it is left out. */
export function fromAdjustmentTarget(lead: Lead, r: Draft, cardId: unknown, sentence: unknown): AdjustmentTarget | 'nao_encontrado' | 'fora' {
  const card = normalizeCards(r.cards ?? []).find((c) => c.id === cardId);
  if (!card) return 'nao_encontrado';
  const layout = layoutOf(card) as Layout;
  if (OUTSIDE_ADJUSTMENT.includes(layout)) return 'fora';
  const lim = LIMITS[layout];
  const fromFact = (id: string | null | undefined) => lead.fatos.filter((f) => f.id === id).map((f) => f.texto);
  if (sentence === null || sentence === undefined) {
    const cited = (card.frases ?? []).flatMap((f) => fromFact(f.fatoId));
    return { card, indice: null, atual: card.titulo, maximo: lim.titulo, fatos: cited.length ? cited : lead.fatos.map((f) => f.texto) };
  }
  if (!Number.isInteger(sentence)) return 'nao_encontrado';
  const f = (card.frases ?? [])[sentence as number];
  if (!f) return 'nao_encontrado';
  if (f.autor || !f.fatoId) return 'fora';
  const rest = (card.frases ?? []).reduce((sum, x, i) => (i === sentence ? sum : sum + x.texto.length), 0);
  return { card, indice: sentence as number, atual: f.texto, maximo: Math.min(lim.frase ?? Infinity, Math.max(1, lim.corpo - rest)), fatos: fromFact(f.fatoId) };
}

export function promptAdjustment(lead: Lead, a: AdjustmentTarget) {
  const target = Math.min(a.maximo, Math.max(20, Math.floor(a.atual.length * 0.8)));
  const system = [
    PROMPT_ADJUSTMENT_HOME,
    `Write in ${lead.idioma === 'en' ? 'English' : 'Brazilian Portuguese'} ${OPTIONS} shorter versions of the text, up to ${target} characters each.`,
    'Only shorten. Keep the meaning and the same names, numbers and dates, and use ONLY the fact listed.',
    'Write each number as it is in the text: "quatro" stays "quatro", never becomes "4", and "20 horas" does not become "20h".',
    'Do not remove what limits the fact, such as parcialmente, cerca de, até, segundo or suspeito de.',
    'Add nothing that is not in the text or in the fact. No opinion adjectives.',
    'Respond in JSON: {"opcoes":["...","..."]}.',
  ].join('\n');
  return { system, user: `Text: ${a.atual}\nFact:\n${a.fatos.map((f) => `- ${f}`).join('\n')}` };
}

/** The copy of the draft with the new text. */
function withText(r: Draft, a: AdjustmentTarget, text: string): Draft {
  const cards = normalizeCards(r.cards ?? []).map((c) => {
    if (c.id !== a.card.id) return c;
    if (a.indice === null) return { ...c, titulo: text };
    return { ...c, frases: (c.frases ?? []).map((f, i) => (i === a.indice ? { ...f, texto: text } : f)) };
  });
  return { ...r, cards };
}

/** Only the shorter options that fit and bring no new error. */
export function checkOptions(lead: Lead, r: Draft, format: 'post' | 'carrossel', a: AdjustmentTarget, raw: unknown) {
  const list = Array.isArray((raw as { opcoes?: unknown })?.opcoes) ? (raw as { opcoes: unknown[] }).opcoes : [];
  const base = new Set(validate(lead, r, { humano: true, formato: format }).erros);
  const options: string[] = [];
  let failed = 0;
  for (const rawValue of list.slice(0, OPTIONS)) {
    const text = typeof rawValue === 'string' ? rawValue.replace(/\s+/g, ' ').trim() : '';
    const approved = text && text.length < a.atual.length && text.length <= a.maximo && !options.includes(text)
      && validate(lead, withText(r, a, text), { humano: true, formato: format }).erros.every((e) => base.has(e));
    if (approved) options.push(text); else failed++;
  }
  return { opcoes: options, reprovadas: failed };
}

export async function generateAdjustment(env: Env, lead: Lead, r: Draft, format: 'post' | 'carrossel', a: AdjustmentTarget) {
  const { system, user } = promptAdjustment(lead, a);
  const { json, custoUsd: costUsd } = await callText(env, { tenantId: lead.tenantId, funcao: 'ajuste' }, system, user, 0.2);
  return { ...checkOptions(lead, r, format, a, json), custoUsd: costUsd };
}
