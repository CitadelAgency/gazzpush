// Preço por veículo. Os limites contam posts, e a porta é uma só: `produzirPauta`. Post e carrossel novos contam; reescrita, Reels,
// correção e produzir de novo depois de falha não contam. Gancho, ajuste e outra ilustração não são post: o custo deles fica no
// teto da peça. Cortesia não tem limite por ser dado do banco, sem caso especial em quem chama.
import type { Env } from '../env';
import { ErroMesa } from './mesa';
import { PLANOS, type Plano } from './planosTabela';

export { PLANOS, PLANOS_PAGOS, type Plano, type PlanoPago } from './planosTabela';
export const DIAS_ATRASO = 7;
export const AVISO_USO = 0.8;

export const ehPlano = (v: unknown): v is Plano => typeof v === 'string' && Object.hasOwn(PLANOS, v);

/**
 * Instalação própria (`INSTALACAO_PROPRIA=1`): quem instala o app para si não tem cobrança. Veículo novo nasce em `cortesia`.
 * Variável explícita, e não a falta da Stripe: o gazzpush.com também está sem Stripe e não pode dar veículo sem limite.
 */
export const instalacaoPropria = (env: Env) => env.INSTALACAO_PROPRIA === '1';
/** O plano com que o veículo nasce. */
export const planoInicial = (env: Env): Plano => (instalacaoPropria(env) ? 'cortesia' : 'teste');

/** Mês do calendário em Brasília: `AAAA-MM`. */
export const mesBrasilia = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).format(d).slice(0, 7);

const NO_MES = 'SELECT COALESCE((SELECT posts FROM uso WHERE tenant_id = ?1 AND mes = ?2), 0)';
const NO_TOTAL = 'SELECT COALESCE(SUM(posts), 0) FROM uso WHERE tenant_id = ?1';
const cabe = Object.entries(PLANOS)
  .map(([id, p]) => `WHEN '${id}' THEN ${p.limite === null ? '1' : `(${p.periodo === 'mes' ? NO_MES : NO_TOTAL}) < ${p.limite}`}`).join(' ');

/**
 * Vai no batch da transição: acima do limite ou com pagamento atrasado, `json()` falha e o batch inteiro volta. O mesmo padrão de
 * `guardaVersaoAprovavel`. O batch é uma transação, então dois pedidos ao mesmo tempo não passam do limite.
 */
export const guardaCota = (env: Env, tenantId: string, mes: string) => env.DB.prepare(
  `SELECT json(CASE WHEN (SELECT CASE plano ${cabe} ELSE 0 END FROM tenants WHERE id = ?1)
                     AND NOT EXISTS (SELECT 1 FROM assinaturas_plano WHERE tenant_id = ?1 AND atraso_desde <= datetime('now', '-${DIAS_ATRASO} days'))
                    THEN '1' ELSE 'limite_plano' END)`,
).bind(tenantId, mes);

export const somarPost = (env: Env, tenantId: string, mes: string) => env.DB.prepare(
  'INSERT INTO uso (tenant_id, mes, posts) VALUES (?, ?, 1) ON CONFLICT (tenant_id, mes) DO UPDATE SET posts = posts + 1',
).bind(tenantId, mes);

export async function situacaoPlano(env: Env, tenantId: string, mes = mesBrasilia()) {
  const [t, a, u] = await Promise.all([
    env.DB.prepare('SELECT plano FROM tenants WHERE id = ?').bind(tenantId).first<{ plano: string }>(),
    env.DB.prepare(`SELECT plano, status, stripe_customer, stripe_subscription, periodo_fim, atraso_desde, atraso_desde <= datetime('now', '-${DIAS_ATRASO} days') AS vencido FROM assinaturas_plano WHERE tenant_id = ?`)
      .bind(tenantId).first<{ plano: string; status: string; stripe_customer: string | null; stripe_subscription: string | null; periodo_fim: string | null; atraso_desde: string | null; vencido: number | null }>(),
    env.DB.prepare('SELECT COALESCE(SUM(posts), 0) AS total, COALESCE(SUM(CASE WHEN mes = ? THEN posts END), 0) AS doMes FROM uso WHERE tenant_id = ?').bind(mes, tenantId).first<{ total: number; doMes: number }>(),
  ]);
  const plano: Plano = ehPlano(t?.plano) ? t.plano : 'teste';
  const p = PLANOS[plano];
  return {
    plano, limite: p.limite as number | null, periodo: p.periodo as 'mes' | 'total',
    usados: p.periodo === 'total' ? u?.total ?? 0 : u?.doMes ?? 0,
    assinatura: a ?? null, bloqueado: !!a?.vencido,
  };
}
export type SituacaoPlano = Awaited<ReturnType<typeof situacaoPlano>>;

/** O motivo de a guarda ter barrado, nos dois idiomas. A API responde 402. */
export function erroLimite(s: SituacaoPlano): ErroMesa {
  if (s.bloqueado) return new ErroMesa('pagamento_atrasado', `O pagamento está atrasado há mais de ${DIAS_ATRASO} dias. Acerte no plano do veículo para voltar a produzir.`, 402, `The payment is more than ${DIAS_ATRASO} days late. Sort it out in the outlet's plan to produce again.`);
  if (s.limite === 0) return new ErroMesa('limite_plano', 'Este veículo ainda não tem plano. Assine um para produzir posts e conferir textos.', 402, 'This outlet has no plan yet. Subscribe to produce posts and check texts.');
  return new ErroMesa('limite_plano', `Este veículo já usou os ${s.limite} posts do mês. O que está pronto continua podendo ser aprovado e publicado.`, 402, `This outlet already used its ${s.limite} posts for the month. What is ready can still be approved and published.`);
}

/** O que custa modelo fora da porta do post (conferir, transcrever, perguntar ao documento) pede plano em dia. */
export async function exigirPlano(env: Env, tenantId: string) {
  const s = await situacaoPlano(env, tenantId);
  if (s.bloqueado || s.limite === 0) throw erroLimite(s);
}

export const ehLimite = (e: unknown) => e instanceof ErroMesa && e.status === 402;
