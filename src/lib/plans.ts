// Pricing per outlet. The limits count posts, and there is a single door: `produceLead`. New posts and carousels
// count; rewrites, Reels, corrections and producing again after a failure do not. Hook, adjustment and another
// illustration are not posts: their cost falls under the piece's cap. Courtesy has no limit because it is database data,
// with no special case in the callers.
import type { Env } from '../env';
import { DeskError } from './desk';
import { PLANS, type Plan } from './plansTable';

export { PLANS as PLANOS, PLANS_PAID as PLANOS_PAGOS, type Plan as Plano, type PaidPlan as PlanoPago } from './plansTable';
export const DELAY_DAYS = 7;
export const USAGE_WARNING = 0.8;

export const isPlan = (v: unknown): v is Plan => typeof v === 'string' && Object.hasOwn(PLANS, v);

/**
 * Self-hosted install (`INSTALACAO_PROPRIA=1`): whoever installs the app for themselves has no billing. A new outlet is
 * born on `cortesia`. An explicit variable, not the absence of Stripe: gazzpush.com is also without Stripe and must not
 * hand out unlimited outlets.
 */
export const selfHosted = (env: Env) => env.INSTALACAO_PROPRIA === '1';
/** The plan an outlet is born with. */
export const initialPlan = (env: Env): Plan => (selfHosted(env) ? 'cortesia' : 'teste');

/** Calendar month in Brasília: `YYYY-MM`. */
export const brasiliaMonth = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).format(d).slice(0, 7);

const IN_MONTH = 'SELECT COALESCE((SELECT posts FROM uso WHERE tenant_id = ?1 AND mes = ?2), 0)';
const TOTAL_IN = 'SELECT COALESCE(SUM(posts), 0) FROM uso WHERE tenant_id = ?1';
const fits = Object.entries(PLANS)
  .map(([id, p]) => `WHEN '${id}' THEN ${p.limite === null ? '1' : `(${p.periodo === 'mes' ? IN_MONTH : TOTAL_IN}) < ${p.limite}`}`).join(' ');

/**
 * Goes into the transition batch: over the limit or with overdue payment, `json()` fails and the whole batch rolls back.
 * The same pattern as `guardVersionApprovable`. The batch is a transaction, so two simultaneous requests do not pass the
 * limit.
 */
export const guardQuota = (env: Env, tenantId: string, month: string) => env.DB.prepare(
  `SELECT json(CASE WHEN (SELECT CASE plano ${fits} ELSE 0 END FROM tenants WHERE id = ?1)
                     AND NOT EXISTS (SELECT 1 FROM assinaturas_plano WHERE tenant_id = ?1 AND atraso_desde <= datetime('now', '-${DELAY_DAYS} days'))
                    THEN '1' ELSE 'limite_plano' END)`,
).bind(tenantId, month);

export const addPost = (env: Env, tenantId: string, month: string) => env.DB.prepare(
  'INSERT INTO uso (tenant_id, mes, posts) VALUES (?, ?, 1) ON CONFLICT (tenant_id, mes) DO UPDATE SET posts = posts + 1',
).bind(tenantId, month);

export async function planStatus(env: Env, tenantId: string, month = brasiliaMonth()) {
  const [t, a, u] = await Promise.all([
    env.DB.prepare('SELECT plano FROM tenants WHERE id = ?').bind(tenantId).first<{ plano: string }>(),
    env.DB.prepare(`SELECT plano, status, stripe_customer, stripe_subscription, periodo_fim, atraso_desde, atraso_desde <= datetime('now', '-${DELAY_DAYS} days') AS vencido FROM assinaturas_plano WHERE tenant_id = ?`)
      .bind(tenantId).first<{ plano: string; status: string; stripe_customer: string | null; stripe_subscription: string | null; periodo_fim: string | null; atraso_desde: string | null; vencido: number | null }>(),
    env.DB.prepare('SELECT COALESCE(SUM(posts), 0) AS total, COALESCE(SUM(CASE WHEN mes = ? THEN posts END), 0) AS doMes FROM uso WHERE tenant_id = ?').bind(month, tenantId).first<{ total: number; doMes: number }>(),
  ]);
  const plan: Plan = isPlan(t?.plano) ? t.plano : 'teste';
  const p = PLANS[plan];
  return {
    plano: plan, limite: p.limite as number | null, periodo: p.periodo as 'mes' | 'total',
    usados: p.periodo === 'total' ? u?.total ?? 0 : u?.doMes ?? 0,
    assinatura: a ?? null, bloqueado: !!a?.vencido,
  };
}
export type PlanStatus = Awaited<ReturnType<typeof planStatus>>;

/** Why the guard blocked, in both languages. The API answers 402. */
export function limitError(s: PlanStatus): DeskError {
  if (s.bloqueado) return new DeskError('pagamento_atrasado', `O pagamento está atrasado há mais de ${DELAY_DAYS} dias. Acerte no plano do veículo para voltar a produzir.`, 402, `The payment is more than ${DELAY_DAYS} days late. Sort it out in the outlet's plan to produce again.`);
  if (s.limite === 0) return new DeskError('limite_plano', 'Este veículo ainda não tem plano. Assine um para produzir posts e conferir textos.', 402, 'This outlet has no plan yet. Subscribe to produce posts and check texts.');
  return new DeskError('limite_plano', `Este veículo já usou os ${s.limite} posts do mês. O que está pronto continua podendo ser aprovado e publicado.`, 402, `This outlet already used its ${s.limite} posts for the month. What is ready can still be approved and published.`);
}

/** What costs model calls outside the post door (check, transcribe, ask a document) requires a plan in good standing. */
export async function requirePlan(env: Env, tenantId: string) {
  const s = await planStatus(env, tenantId);
  if (s.bloqueado || s.limite === 0) throw limitError(s);
}

export const isLimit = (e: unknown) => e instanceof DeskError && e.status === 402;
