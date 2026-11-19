// Checked hook: three cover headlines from different angles, tied to the lead's facts. The model suggests and the code
// checks: each candidate goes into a copy of the draft and only shows up if it brings no new error in `validate` and fits
// `LIMITS.capa.titulo`. Nothing is saved here: the chosen one follows the `Save and check` path.
import type { Env } from '../env';
import { LIMITS, layoutOf } from './cards';
import { callText } from './textModel';
import type { Lead } from './lead';
import type { Draft } from './drafting';
import { validate } from './validation';

export const ANGLES_NEWS = ['numero', 'consequencia', 'servico'] as const;
export const ANGLES_AUTHOR = ['tese', 'exemplo', 'pergunta'] as const;
export type Angle = (typeof ANGLES_NEWS)[number] | (typeof ANGLES_AUTHOR)[number];

const REQUEST: Record<Angle, string> = {
  numero: 'numero: open with the strongest number or data point in the facts; if the facts have no number, with the strongest concrete data point',
  consequencia: 'consequencia: what changes for the people who live in the city',
  servico: 'servico: what the person needs to know or do',
  tese: 'tese: the central idea the author argues for',
  exemplo: 'exemplo: the strongest example in the text',
  pergunta: 'pergunta: the question the text answers',
};

/** Marks the request so the e2e fake model recognises it. */
export const PROMPT_HOOK_HOME = 'COVER HEADLINES.';

export interface OptionHook { angulo: Angle; titulo: string }

export function promptHook(lead: Lead, current: string) {
  const angles = lead.modo === 'autoral' ? ANGLES_AUTHOR : ANGLES_NEWS;
  const system = [
    PROMPT_HOOK_HOME,
    `Write in ${lead.idioma === 'en' ? 'English' : 'Brazilian Portuguese'} three headlines for the cover of a post, one per angle.`,
    `Angles: ${angles.map((a) => REQUEST[a]).join('; ')}.`,
    `Each headline has up to ${LIMITS.capa.titulo} characters and uses ONLY the facts listed.`,
    'Do not invent names, numbers, dates, places, causes or consequences. No opinion adjectives and no angle label in the text.',
    'Respond in JSON: {"manchetes":[{"angulo":"...","titulo":"..."}]}.',
  ].join('\n');
  const facts = lead.fatos.map((f) => `- ${f.texto}`).join('\n');
  return { system, user: `Lead: ${lead.titulo}\nCurrent headline: ${current}\nFacts:\n${facts}`, angulos: angles };
}

/** Copies the draft with the new headline on the cover. Without a cover card, returns null. */
export function withHeadline(r: Draft, title: string): Draft | null {
  const i = (r.cards ?? []).findIndex((c) => layoutOf(c) === 'capa');
  if (i < 0) return null;
  return { ...r, manchete: title, cards: r.cards.map((c, j) => (j === i ? { ...c, titulo: title } : c)) };
}

/** Only the candidates that bring no new error: a problem the version already had is not the headline's fault. */
export function checkCandidates(lead: Lead, r: Draft, format: 'post' | 'carrossel', raw: unknown, angles: readonly Angle[]) {
  const list = Array.isArray((raw as { manchetes?: unknown })?.manchetes) ? (raw as { manchetes: unknown[] }).manchetes : [];
  const base = new Set(validate(lead, r, { humano: true, formato: format }).erros);
  const options: OptionHook[] = [];
  let failed = 0;
  for (const rawValue of list.slice(0, angles.length)) {
    const b = rawValue as { angulo?: unknown; titulo?: unknown };
    const title = typeof b?.titulo === 'string' ? b.titulo.replace(/\s+/g, ' ').trim() : '';
    const copy = title && title.length <= LIMITS.capa.titulo ? withHeadline(r, title) : null;
    const approved = copy && validate(lead, copy, { humano: true, formato: format }).erros.every((e) => base.has(e));
    if (!approved || options.some((o) => o.titulo === title)) { failed++; continue; }
    options.push({ angulo: angles.includes(b.angulo as Angle) ? (b.angulo as Angle) : angles[options.length], titulo: title });
  }
  return { opcoes: options, reprovadas: failed };
}

export async function generateHooks(env: Env, lead: Lead, r: Draft, format: 'post' | 'carrossel') {
  const { system, user, angulos: angles } = promptHook(lead, r.manchete);
  const { json, custoUsd: costUsd } = await callText(env, { tenantId: lead.tenantId, funcao: 'gancho' }, system, user, 0.4);
  return { ...checkCandidates(lead, r, format, json, angles), custoUsd: costUsd };
}
