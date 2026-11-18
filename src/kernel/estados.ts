import type { Env, ProducaoParams, PublicacaoParams } from '../env';

// Enums do domínio. Ficam em código, não em CHECK do SQLite: novo status ou formato = mudar esta lista, sem migração.

export const STATUS_PECA = ['rascunho', 'revisao', 'aprovada', 'agendada', 'publicada', 'falhou', 'rejeitada'] as const;
export const STATUS_PAUTA = ['sugerida', 'aceita', 'em_producao', 'concluida', 'descartada'] as const;
export const STATUS_DOCUMENTO = ['novo', 'triado', 'descartado'] as const;
export const PAPEIS = ['admin', 'editor', 'reporter'] as const;   // ordem = poder decrescente
export const MODOS_CONTA = ['manual', 'real', 'intermediario', 'simulada'] as const;
/** O que se pede de uma pauta. O Reels (Fase 4) sai de um carrossel (POST /pecas/:id/reels), não de uma pauta. */
export const FORMATOS_DE_PAUTA = ['post', 'carrossel'] as const;
export const FORMATOS = [...FORMATOS_DE_PAUTA, 'reels'] as const;
export const DECISOES = ['aprovar', 'reescrever', 'rejeitar'] as const;
export const TIPOS_FONTE = ['rss', 'html', 'oficial', 'manual'] as const;
export const MODOS_TENANT = ['local', 'tematico', 'autoral'] as const;

export type StatusPeca = (typeof STATUS_PECA)[number];
export type StatusPauta = (typeof STATUS_PAUTA)[number];
export type StatusDocumento = (typeof STATUS_DOCUMENTO)[number];
export type Papel = (typeof PAPEIS)[number];
export type ModoConta = (typeof MODOS_CONTA)[number];
export type Formato = (typeof FORMATOS)[number];
export type TipoDecisao = (typeof DECISOES)[number];
export type ModoTenant = (typeof MODOS_TENANT)[number];

export const pertence = <T extends string>(lista: readonly T[], v: unknown): v is T => typeof v === 'string' && (lista as readonly string[]).includes(v);

/**
 * Transições válidas. Estado ausente das chaves = terminal.
 * Peça: rascunho (Workflow de produção rodando) → revisao → aprovada/agendada → publicada.
 * "reescrever" volta pra rascunho com uma rodada nova; falha em qualquer etapa automática → falhou.
 */
const TRANSICOES = {
  peca: {
    rascunho: ['revisao', 'falhou'],
    revisao: ['aprovada', 'agendada', 'rascunho', 'rejeitada'],
    aprovada: ['publicada', 'falhou'],
    agendada: ['publicada', 'falhou'],
  },
  pauta: {
    sugerida: ['aceita', 'em_producao', 'descartada'],
    aceita: ['em_producao', 'descartada'],
    em_producao: ['aceita', 'concluida', 'descartada'],   // aceita = peça falhou, pauta volta pra fila
  },
  documento: {
    novo: ['triado', 'descartado'],
  },
} as const satisfies {
  peca: Partial<Record<StatusPeca, readonly StatusPeca[]>>;
  pauta: Partial<Record<StatusPauta, readonly StatusPauta[]>>;
  documento: Partial<Record<StatusDocumento, readonly StatusDocumento[]>>;
};

type TipoEntidade = keyof typeof TRANSICOES;
type StatusDe = { peca: StatusPeca; pauta: StatusPauta; documento: StatusDocumento };

export function podeTransitar<T extends TipoEntidade>(tipo: T, de: string, para: StatusDe[T]): boolean {
  const destinos = (TRANSICOES[tipo] as Record<string, readonly string[]>)[de];
  return !!destinos?.includes(para);
}

interface TransicaoBase<T extends TipoEntidade> {
  tipo: T;
  id: string;
  tenantId: string;
  para: StatusDe[T];
  /** user.id da sessão, ou 'sistema' quando é um Workflow/fila. Nunca vem do body. */
  por: string;
  /** Peça em falhou/rejeitada: vira pecas.erro. Sempre vai no evento. */
  motivo?: string | null;
  /** Campos extras no payload do evento. */
  dados?: Record<string, unknown>;
  /** Statements que precisam entrar no mesmo DB.batch (atômico) que a transição. Pulados se ela for no-op. */
  batch?: D1PreparedStatement[];
  /**
   * Só peça: a transição só vale se `pecas.workflow_id` ainda for este (execução corrente). Se a peça já pertence a
   * outra rodada, a transição é no-op (step replayado de rodada superada não pode mexer na peça). A condição também
   * entra no UPDATE, então uma troca de rodada no meio do caminho aborta o batch.
   */
  exigeWorkflow?: string;
  /**
   * Só vale saindo de um destes estados (subconjunto da tabela). Fora deles → TransicaoInvalida (409). Como o UPDATE
   * é condicionado ao status lido, a restrição também vale contra corrida.
   */
  de?: readonly string[];
}
export type Transicao = TransicaoBase<'peca'> | TransicaoBase<'pauta'> | TransicaoBase<'documento'>;

export class TransicaoInvalida extends Error {
  /** A mesma mensagem em inglês (a API escolhe pelo idioma do pedido; `message` é o português). */
  readonly en: string;
  constructor(readonly tipo: TipoEntidade, readonly id: string, readonly de: string | null, readonly para: string, readonly concorrente = false) {
    super(de === null ? `${tipo} ${id} não encontrado` : `${tipo} ${id}: transição ${de} → ${para} ${concorrente ? 'perdeu corrida (status mudou)' : 'inválida'}`);
    this.en = de === null ? `${tipo} ${id} not found` : `${tipo} ${id}: transition ${de} → ${para} ${concorrente ? 'lost a race (status changed)' : 'is invalid'}`;
    this.name = 'TransicaoInvalida';
  }
}

const TABELA: Record<TipoEntidade, string> = { peca: 'pecas', pauta: 'pautas', documento: 'documentos' };
// Erro de propósito quando o UPDATE condicional não pegou linha: aborta o batch inteiro (D1 batch = transação).
const MARCA_CONFLITO = 'transicao_conflito';
const ASSERT_UMA_LINHA = `SELECT json(CASE WHEN changes() = 1 THEN '1' ELSE '${MARCA_CONFLITO}' END)`;

/**
 * Único lugar do código que escreve `status` de peça, pauta ou documento.
 * Para cada transição: lê o status atual, valida contra TRANSICOES e monta, no mesmo DB.batch, o UPDATE condicional
 * (`AND status = <lido>`), uma asserção que aborta tudo se outro request mudou o status no meio, e o evento.
 *
 * Idempotente: se a entidade já está em `para`, a transição é no-op (nada é escrito, nem o `batch` dela). É isso que
 * deixa um step de Workflow re-executado depois de um commit bem-sucedido passar sem duplicar evento.
 * Retorna `mudou: false` quando todas as transições eram no-op.
 */
export async function transitar(env: Env, transicoes: Transicao | Transicao[]): Promise<{ mudou: boolean }> {
  const lista = Array.isArray(transicoes) ? transicoes : [transicoes];
  const stmts: D1PreparedStatement[] = [];
  const extras: D1PreparedStatement[] = [];
  const lidos: { t: Transicao; de: string }[] = [];

  for (const t of lista) {
    const tabela = TABELA[t.tipo];
    const cols = t.tipo === 'peca' ? 'status, workflow_id' : 'status';
    const atual = await env.DB.prepare(`SELECT ${cols} FROM ${tabela} WHERE id = ? AND tenant_id = ?`).bind(t.id, t.tenantId).first<{ status: string; workflow_id?: string | null }>();
    if (!atual) throw new TransicaoInvalida(t.tipo, t.id, null, t.para);
    if (atual.status === t.para) continue;
    if (t.exigeWorkflow && atual.workflow_id !== t.exigeWorkflow) continue;   // rodada superada
    if (!podeTransitar(t.tipo, atual.status, t.para as never) || (t.de && !t.de.includes(atual.status))) throw new TransicaoInvalida(t.tipo, t.id, atual.status, t.para);
    lidos.push({ t, de: atual.status });

    stmts.push(
      t.tipo === 'peca'
        ? env.DB.prepare(`UPDATE pecas SET status = ?, erro = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ? AND status = ?${t.exigeWorkflow ? ' AND workflow_id = ?' : ''}`)
            .bind(t.para, t.para === 'falhou' || t.para === 'rejeitada' ? (t.motivo ?? null)?.slice(0, 500) ?? null : null, t.id, t.tenantId, atual.status, ...(t.exigeWorkflow ? [t.exigeWorkflow] : []))
        : t.tipo === 'pauta'
          ? env.DB.prepare(`UPDATE pautas SET status = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ? AND status = ?`)
              .bind(t.para, t.id, t.tenantId, atual.status)
          : env.DB.prepare(`UPDATE documentos SET status = ? WHERE id = ? AND tenant_id = ? AND status = ?`)
              .bind(t.para, t.id, t.tenantId, atual.status),
      env.DB.prepare(ASSERT_UMA_LINHA),
      env.DB.prepare('INSERT INTO eventos (tenant_id, tipo, ref_tipo, ref_id, payload_json) VALUES (?, ?, ?, ?, ?)')
        .bind(t.tenantId, `${t.tipo}.${t.para}`, t.tipo, t.id, JSON.stringify({ de: atual.status, para: t.para, por: t.por, ...(t.motivo ? { motivo: t.motivo } : {}), ...t.dados })),
    );
    extras.push(...(t.batch ?? []));
  }
  if (!stmts.length) return { mudou: false };

  try {
    await env.DB.batch([...stmts, ...extras]);
  } catch (e) {
    if (!String(e).includes('malformed JSON')) throw e;
    // A asserção disparou: alguém mudou o status entre o SELECT e o batch. Reporta qual.
    for (const { t, de } of lidos) {
      const agora = await env.DB.prepare(`SELECT status FROM ${TABELA[t.tipo]} WHERE id = ? AND tenant_id = ?`).bind(t.id, t.tenantId).first<{ status: string }>();
      if (agora?.status !== de) throw new TransicaoInvalida(t.tipo, t.id, agora?.status ?? null, t.para, true);
    }
    throw e;
  }
  return { mudou: true };
}

// Execuções (instâncias de Workflow). Também têm status; também só se escreve aqui.

export type TipoExecucao = 'producao' | 'publicacao';

/**
 * Grava a execução com os params do `create`, no mesmo batch da transição que a motiva. A instância do Workflow é
 * criada depois do batch; se o request morrer entre os dois, `reconciliarExecucoes` recria com estes params.
 */
export function iniciarExecucao(env: Env, e: { id: string; tenantId: string; refTipo: 'peca'; refId: string } & (
  { tipo: 'producao'; params: ProducaoParams } | { tipo: 'publicacao'; params: PublicacaoParams }
)) {
  return env.DB.prepare('INSERT INTO execucoes (id, tenant_id, tipo, ref_tipo, ref_id, params_json) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(e.id, e.tenantId, e.tipo, e.refTipo, e.refId, JSON.stringify(e.params));
}

/** Só fecha execução aberta: re-executar o step de encerramento não muda o horário nem o desfecho. */
export function encerrarExecucao(env: Env, id: string, status: 'concluida' | 'falhou', erro: string | null = null) {
  return env.DB.prepare("UPDATE execucoes SET status = ?, erro = ?, terminado_em = datetime('now') WHERE id = ? AND status = 'rodando'")
    .bind(status, erro?.slice(0, 500) ?? null, id);
}
