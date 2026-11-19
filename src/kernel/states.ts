import type { Env, ProductionParams, PublicationParams } from '../env';

// Domain enums. They live in code, not in an SQLite CHECK: a new status or format = change this list, no migration.

export const PIECE_STATUS = ['rascunho', 'revisao', 'aprovada', 'agendada', 'publicada', 'falhou', 'rejeitada'] as const;
export const LEAD_STATUS = ['sugerida', 'aceita', 'em_producao', 'concluida', 'descartada'] as const;
export const DOCUMENT_STATUS = ['novo', 'triado', 'descartado'] as const;
export const ROLES = ['admin', 'editor', 'reporter'] as const;   // ordem = poder decrescente
export const MODES_ACCOUNT = ['manual', 'real', 'intermediario', 'simulada'] as const;
/** What a lead can be asked for. Reels (Phase 4) comes from a carousel (POST /pecas/:id/reels), not from a lead. */
export const FORMATS_LEAD = ['post', 'carrossel'] as const;
export const FORMATS = [...FORMATS_LEAD, 'reels'] as const;
export const DECISIONS = ['aprovar', 'reescrever', 'rejeitar'] as const;
export const SOURCE_TYPES = ['rss', 'html', 'oficial', 'manual'] as const;
export const MODES_TENANT = ['local', 'tematico', 'autoral'] as const;

export type PieceStatus = (typeof PIECE_STATUS)[number];
export type LeadStatus = (typeof LEAD_STATUS)[number];
export type DocumentStatus = (typeof DOCUMENT_STATUS)[number];
export type Role = (typeof ROLES)[number];
export type AccountMode = (typeof MODES_ACCOUNT)[number];
export type Format = (typeof FORMATS)[number];
export type DecisionType = (typeof DECISIONS)[number];
export type TenantMode = (typeof MODES_TENANT)[number];

export const belongs = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

/**
 * Valid transitions. A state missing from the keys = terminal.
 * Piece: rascunho (production Workflow running) → revisao → aprovada/agendada → publicada.
 * "reescrever" goes back to rascunho with a new round; a failure in any automatic step → falhou.
 */
const TRANSITIONS = {
  peca: {
    rascunho: ['revisao', 'falhou'],
    revisao: ['aprovada', 'agendada', 'rascunho', 'rejeitada'],
    aprovada: ['publicada', 'falhou'],
    agendada: ['publicada', 'falhou'],
  },
  pauta: {
    sugerida: ['aceita', 'em_producao', 'descartada'],
    aceita: ['em_producao', 'descartada'],
    em_producao: ['aceita', 'concluida', 'descartada'],   // aceita = the piece failed, the lead goes back to the queue
  },
  documento: {
    novo: ['triado', 'descartado'],
  },
} as const satisfies {
  peca: Partial<Record<PieceStatus, readonly PieceStatus[]>>;
  pauta: Partial<Record<LeadStatus, readonly LeadStatus[]>>;
  documento: Partial<Record<DocumentStatus, readonly DocumentStatus[]>>;
};

type EntityType = keyof typeof TRANSITIONS;
type Status = { peca: PieceStatus; pauta: LeadStatus; documento: DocumentStatus };

export function canTransition<T extends EntityType>(type: T, from: string, to: Status[T]): boolean {
  const targets = (TRANSITIONS[type] as Record<string, readonly string[]>)[from];
  return !!targets?.includes(to);
}

interface TransitionBase<T extends EntityType> {
  tipo: T;
  id: string;
  tenantId: string;
  para: Status[T];
  /** The session's user.id, or 'sistema' when it is a Workflow/queue. Never comes from the body. */
  por: string;
  /** A piece in falhou/rejeitada: becomes pecas.erro. Always goes in the event. */
  motivo?: string | null;
  /** Extra fields in the event payload. */
  dados?: Record<string, unknown>;
  /** Statements that must go into the same DB.batch (atomic) as the transition. Skipped if it is a no-op. */
  batch?: D1PreparedStatement[];
  /**
   * Pieces only: the transition only counts if `pecas.workflow_id` is still this one (the current run). If the piece
   * already belongs to another round, the transition is a no-op (a replayed step from a superseded round must not touch
   * the piece). The condition also goes into the UPDATE, so a round switch midway aborts the batch.
   */
  exigeWorkflow?: string;
  /**
   * Only valid when leaving one of these states (a subset of the table). Outside them → TransicaoInvalida (409). Since
   * the UPDATE is conditioned on the status read, the restriction also holds against races.
   */
  de?: readonly string[];
}
export type Transition = TransitionBase<'peca'> | TransitionBase<'pauta'> | TransitionBase<'documento'>;

export class InvalidTransition extends Error {
  /** The same message in English (the API picks by the request's language; `message` is the Portuguese one). */
  readonly en: string;
  constructor(readonly tipo: EntityType, readonly id: string, readonly de: string | null, readonly para: string, readonly concorrente = false) {
    super(de === null ? `${tipo} ${id} não encontrado` : `${tipo} ${id}: transição ${de} → ${para} ${concorrente ? 'perdeu corrida (status mudou)' : 'inválida'}`);
    this.en = de === null ? `${tipo} ${id} not found` : `${tipo} ${id}: transition ${de} → ${para} ${concorrente ? 'lost a race (status changed)' : 'is invalid'}`;
    this.name = 'TransicaoInvalida';
  }
}

const TABLE: Record<EntityType, string> = { peca: 'pecas', pauta: 'pautas', documento: 'documentos' };
// A deliberate error when the conditional UPDATE matched no row: it aborts the whole batch (D1 batch = transaction).
const CONFLICT_BRAND = 'transicao_conflito';
const ASSERT_ONE_LINE = `SELECT json(CASE WHEN changes() = 1 THEN '1' ELSE '${CONFLICT_BRAND}' END)`;

/**
 * The only place in the code that writes the `status` of a piece, lead or document.
 * For each transition: reads the current status, validates it against TRANSICOES and builds, in the same DB.batch, the
 * conditional UPDATE (`AND status = <read>`), an assertion that aborts everything if another request changed the status
 * midway, and the event.
 *
 * Idempotent: if the entity is already in `para`, the transition is a no-op (nothing is written, not even its `batch`).
 * That is what lets a Workflow step re-run after a successful commit pass without duplicating the event.
 * Returns `mudou: false` when every transition was a no-op.
 */
export async function transition(env: Env, transitions: Transition | Transition[]): Promise<{ mudou: boolean }> {
  const list = Array.isArray(transitions) ? transitions : [transitions];
  const stmts: D1PreparedStatement[] = [];
  const extras: D1PreparedStatement[] = [];
  const read: { t: Transition; de: string }[] = [];

  for (const t of list) {
    const table = TABLE[t.tipo];
    const cols = t.tipo === 'peca' ? 'status, workflow_id' : 'status';
    const current = await env.DB.prepare(`SELECT ${cols} FROM ${table} WHERE id = ? AND tenant_id = ?`).bind(t.id, t.tenantId).first<{ status: string; workflow_id?: string | null }>();
    if (!current) throw new InvalidTransition(t.tipo, t.id, null, t.para);
    if (current.status === t.para) continue;
    if (t.exigeWorkflow && current.workflow_id !== t.exigeWorkflow) continue;   // rodada superada
    if (!canTransition(t.tipo, current.status, t.para as never) || (t.de && !t.de.includes(current.status))) throw new InvalidTransition(t.tipo, t.id, current.status, t.para);
    read.push({ t, de: current.status });

    stmts.push(
      t.tipo === 'peca'
        ? env.DB.prepare(`UPDATE pecas SET status = ?, erro = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ? AND status = ?${t.exigeWorkflow ? ' AND workflow_id = ?' : ''}`)
            .bind(t.para, t.para === 'falhou' || t.para === 'rejeitada' ? (t.motivo ?? null)?.slice(0, 500) ?? null : null, t.id, t.tenantId, current.status, ...(t.exigeWorkflow ? [t.exigeWorkflow] : []))
        : t.tipo === 'pauta'
          ? env.DB.prepare(`UPDATE pautas SET status = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ? AND status = ?`)
              .bind(t.para, t.id, t.tenantId, current.status)
          : env.DB.prepare(`UPDATE documentos SET status = ? WHERE id = ? AND tenant_id = ? AND status = ?`)
              .bind(t.para, t.id, t.tenantId, current.status),
      env.DB.prepare(ASSERT_ONE_LINE),
      env.DB.prepare('INSERT INTO eventos (tenant_id, tipo, ref_tipo, ref_id, payload_json) VALUES (?, ?, ?, ?, ?)')
        .bind(t.tenantId, `${t.tipo}.${t.para}`, t.tipo, t.id, JSON.stringify({ de: current.status, para: t.para, por: t.por, ...(t.motivo ? { motivo: t.motivo } : {}), ...t.dados })),
    );
    extras.push(...(t.batch ?? []));
  }
  if (!stmts.length) return { mudou: false };

  try {
    await env.DB.batch([...stmts, ...extras]);
  } catch (e) {
    if (!String(e).includes('malformed JSON')) throw e;
    // The assertion fired: someone changed the status between the SELECT and the batch. Report which.
    for (const { t, de: from } of read) {
      const now = await env.DB.prepare(`SELECT status FROM ${TABLE[t.tipo]} WHERE id = ? AND tenant_id = ?`).bind(t.id, t.tenantId).first<{ status: string }>();
      if (now?.status !== from) throw new InvalidTransition(t.tipo, t.id, now?.status ?? null, t.para, true);
    }
    throw e;
  }
  return { mudou: true };
}

// Runs (Workflow instances). They also have a status; it is also only written here.

export type ExecutionType = 'producao' | 'publicacao';

/**
 * Stores the run with the `create` params, in the same batch as the transition that triggers it. The Workflow instance
 * is created after the batch; if the request dies between the two, `reconciliarExecucoes` recreates it with these params.
 */
export function startExecution(env: Env, e: { id: string; tenantId: string; refTipo: 'peca'; refId: string } & (
  { tipo: 'producao'; params: ProductionParams } | { tipo: 'publicacao'; params: PublicationParams }
)) {
  return env.DB.prepare('INSERT INTO execucoes (id, tenant_id, tipo, ref_tipo, ref_id, params_json) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(e.id, e.tenantId, e.tipo, e.refTipo, e.refId, JSON.stringify(e.params));
}

/** Only closes an open run: re-running the closing step changes neither the time nor the outcome. */
export function closeExecution(env: Env, id: string, status: 'concluida' | 'falhou', error: string | null = null) {
  return env.DB.prepare("UPDATE execucoes SET status = ?, erro = ?, terminado_em = datetime('now') WHERE id = ? AND status = 'rodando'")
    .bind(status, error?.slice(0, 500) ?? null, id);
}
