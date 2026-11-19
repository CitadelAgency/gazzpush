/**
 * The UI queue (Ideas and production progress). D1 reads only: nothing here queries the Workflow, so the 2 s polling
 * stays cheap.
 */

export const STEPS = ['redigir', 'validar', 'ilustrar', 'renderizar'] as const;
export type Step = (typeof STEPS)[number];

/**
 * Which step a `rascunho` piece is at, deduced from what ProducaoWorkflow already stored:
 * - no version in this round → drafting (attempt 1);
 * - a new version not yet displayed (`pecas.versao` behind the latest) → validating;
 * - the displayed version rejected → drafting again (next attempt);
 * - approved without the version's illustration event → illustrating; with it → rendering.
 */
export function stepProduction(a: {
  versaoExibida: number;
  versoesDaRodada: number[];
  validacaoOk: boolean | null;
  ilustrou: boolean;
  /** Reels: no drafting or illustrating; once checked, it is building the video. */
  reels?: boolean;
}): { etapa: Step; tentativa: number } {
  const n = a.versoesDaRodada.length;
  if (!n) return { etapa: a.reels ? 'validar' : 'redigir', tentativa: 1 };
  const last = Math.max(...a.versoesDaRodada);
  if (a.versaoExibida < last) return { etapa: 'validar', tentativa: n };
  if (a.reels) return { etapa: a.validacaoOk === null ? 'validar' : 'renderizar', tentativa: 1 };
  if (a.validacaoOk !== true) return { etapa: 'redigir', tentativa: n + 1 };
  return { etapa: a.ilustrou ? 'renderizar' : 'ilustrar', tentativa: n };
}

/** `?status=a,b` → a list validated against the enum, or null if any value does not belong. */
export function statusList<T extends string>(q: string | undefined, valid: readonly T[], fallback: readonly T[]): T[] | null {
  if (!q) return [...fallback];
  const list = [...new Set(q.split(',').map((s) => s.trim()).filter(Boolean))];
  if (!list.length || list.length > valid.length) return null;
  return list.every((s) => (valid as readonly string[]).includes(s)) ? (list as T[]) : null;
}

/** `?desde=` in milliseconds → a date in D1's column format ("YYYY-MM-DD HH:MM:SS", UTC). Invalid → null. */
export function sinceSql(q: string | undefined): string | null {
  const ms = Number(q);
  if (!q || !Number.isFinite(ms) || ms <= 0 || ms > 8.64e15) return null;
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

/** Posted cursor: "<created_at>|<id>" of the previous page's last publication. Invalid → null. */
export function cursorPublications(q: string | undefined): { em: string; id: string } | null {
  const m = /^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)\|([\w-]{1,80})$/.exec(q ?? '');
  return m ? { em: m[1], id: m[2] } : null;
}
