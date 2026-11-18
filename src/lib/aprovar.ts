// Aprovar uma peça: decisão, conta e publicação, no mesmo batch da transição. Serve à rota de revisão e ao piloto.
import type { Env } from '../env';
import { novoId } from './db';
import { iniciarExecucao, transitar, type ModoConta } from '../kernel/estados';
import { carregarConta } from './publicar';
import { iniciarPublicacao } from '../workflows/publicacao';

/**
 * Statement para o batch de uma decisão: aborta (como a asserção de `transitar`) se a peça não estiver mais na versão
 * que quem decidiu viu, ou se essa versão reprovou na conferência (edição salva no meio da aprovação).
 */
export const guardaVersaoAprovavel = (env: Env, tenantId: string, pecaId: string, versao: number) => env.DB.prepare(
  `SELECT json(CASE WHEN EXISTS (SELECT 1 FROM pecas WHERE id = ? AND tenant_id = ? AND versao = ?
                                    AND COALESCE(json_extract(validacao_json, '$.ok'), 1) <> 0) THEN '1' ELSE 'versao_mudou' END)`,
).bind(pecaId, tenantId, versao);

export interface PecaAprovavel { id: string; pauta_id: string; versao: number; formato: string; validacao_ok: number | null }
export type Aprovacao =
  | { ok: true; status: 'aprovada' | 'agendada'; modo: ModoConta; workflowId?: string; pendente?: true }
  | { ok: false; erro: 'conferencia' | 'data' | 'reels_intermediario' | 'conflito' };

/** `por`: o id de quem aprovou, ou `piloto`. `extra` vai no payload da decisão. */
export async function aprovarPeca(env: Env, a: { tenantId: string; por: string; peca: PecaAprovavel; contaId?: string; agendarPara?: string; extra?: Record<string, unknown> }): Promise<Aprovacao> {
  const { tenantId, por, peca } = a;
  const pecaId = peca.id;
  // Edição que reprovou na conferência (frase sem fato, número fora da fonte, texto que não cabe): só depois de corrigir.
  if (peca.validacao_ok === 0) return { ok: false, erro: 'conferencia' };
  let agendadoPara: string | null = null;
  if (a.agendarPara) {
    const ts = Date.parse(a.agendarPara);
    if (!Number.isFinite(ts)) return { ok: false, erro: 'data' };
    agendadoPara = new Date(ts).toISOString();
  }
  const conta = await carregarConta(env, tenantId, a.contaId);
  if (peca.formato === 'reels' && conta.modo === 'intermediario') return { ok: false, erro: 'reels_intermediario' };
  const para = agendadoPara ? 'agendada' : 'aprovada';
  const comum = [
    // A versão aprovada é a que foi lida aqui, e válida: edição salva no meio (outra versão, ou reprovada) aborta.
    guardaVersaoAprovavel(env, tenantId, pecaId, peca.versao),
    env.DB.prepare('INSERT INTO decisoes (id, tenant_id, peca_id, versao, decisao, por, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(novoId(), tenantId, pecaId, peca.versao, 'aprovar', por, JSON.stringify({ contaId: conta.id, modo: conta.modo, agendarPara: agendadoPara, ...a.extra })),
    env.DB.prepare('UPDATE pecas SET conta_id = ?, agendado_para = ? WHERE id = ? AND tenant_id = ?').bind(conta.id, agendadoPara, pecaId, tenantId),
  ];
  const dados = { decisao: 'aprovar', versao: peca.versao, contaId: conta.id, modo: conta.modo, agendarPara: agendadoPara };

  const versaoMudou = (e: unknown) => String(e).includes('malformed JSON');
  if (conta.modo === 'manual') {
    try {
      const { mudou } = await transitar(env, { tipo: 'peca', id: pecaId, tenantId, para, por, dados, batch: comum });
      return mudou ? { ok: true, status: para, modo: 'manual' } : { ok: false, erro: 'conflito' };
    } catch (e) {
      if (versaoMudou(e)) return { ok: false, erro: 'conflito' };
      throw e;
    }
  }

  const n = ((await env.DB.prepare("SELECT COUNT(*) AS n FROM execucoes WHERE tenant_id = ? AND ref_id = ? AND tipo = 'publicacao'")
    .bind(tenantId, pecaId).first<{ n: number }>())?.n ?? 0) + 1;
  const execucaoId = `${pecaId}-pub-${n}`;
  const params = { tenantId, pautaId: peca.pauta_id, pecaId, contaId: conta.id, ...(agendadoPara ? { agendadoPara } : {}) };
  let mudou: boolean;
  try {
    ({ mudou } = await transitar(env, {
      tipo: 'peca', id: pecaId, tenantId, para, por, dados: { ...dados, workflowId: execucaoId },
      batch: [...comum, iniciarExecucao(env, { id: execucaoId, tenantId, tipo: 'publicacao', refTipo: 'peca', refId: pecaId, params })],
    }));
  } catch (e) {
    if (versaoMudou(e)) return { ok: false, erro: 'conflito' };
    throw e;
  }
  if (!mudou) return { ok: false, erro: 'conflito' };
  const erro = await iniciarPublicacao(env, execucaoId, params);
  return { ok: true, status: para, modo: conta.modo as ModoConta, workflowId: execucaoId, ...(erro ? { pendente: true as const } : {}) };
}
