import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import type { Env, PublicacaoParams } from '../env';
import { carregarConta, publicar, type Conta, type Publicacao } from '../lib/publicar';
import { eventoStmt } from '../lib/db';
import { encerrarExecucao, transitar, type Transicao } from '../kernel/estados';
import { criarInstancia } from './instancia';

/**
 * Publicação automática (conta real, intermediário ou simulada) de uma peça aprovada/agendada.
 * Curto: dorme até o horário agendado, publica, registra. Conta manual nunca chega aqui (o operador confirma pela API).
 */
export class PublicacaoWorkflow extends WorkflowEntrypoint<Env, PublicacaoParams> {
  async run(event: Readonly<WorkflowEvent<PublicacaoParams>>, step: WorkflowStep) {
    const p = event.payload;
    const execucaoId = event.instanceId;
    const env = this.env;
    try {
      if (p.agendadoPara) await step.sleepUntil('agendar', new Date(p.agendadoPara));
      const conta = await step.do('conta', () => carregarConta(env, p.tenantId, p.contaId));
      // Graph API não é idempotente: retry depois de um publish aceito duplica o post. Limite baixo de propósito.
      const pub = await step.do('publicar', { retries: { limit: 2, delay: '1 minute', backoff: 'exponential' } }, () =>
        publicar(env, { tenantId: p.tenantId, pecaId: p.pecaId, conta }));
      await step.do('registrar', () => registrarPublicacao(env, p, execucaoId, conta, pub));
      return { status: 'publicada' as const, externalId: pub.externalId, url: pub.url };
    } catch (e) {
      const motivo = String(e).slice(0, 500);
      await step.do('registrar falha', () => falharPublicacao(env, p, execucaoId, motivo));
      throw e;
    }
  }
}

/** publicacoes + peça publicada + pauta concluída + execução fechada, num batch. id da publicação = id da execução. */
export async function registrarPublicacao(env: Env, p: PublicacaoParams, execucaoId: string, conta: Pick<Conta, 'id' | 'rede' | 'modo'>, pub: Publicacao) {
  const { tenantId, pecaId } = p;
  const batch = [
    env.DB.prepare(`INSERT OR IGNORE INTO publicacoes (id, tenant_id, peca_id, conta_id, rede, modo, external_id, url, publicado_em, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 'publicada')`)
      .bind(execucaoId, tenantId, pecaId, conta.id, pub.rede, conta.modo, pub.externalId, pub.url ?? null),
    encerrarExecucao(env, execucaoId, 'concluida'),
  ];
  if (pub.chamadas) {
    batch.push(eventoStmt(env, {
      tenantId, tipo: 'peca.publicacao_simulada', refTipo: 'peca', refId: pecaId,
      payload: { contaId: conta.id, chamadas: pub.chamadas }, chave: `${execucaoId}:simulada`,
    }));
  }
  // A pauta conclui se ainda está em produção. O Reels pode sair depois de o carrossel ter sido rejeitado (pauta
  // descartada) ou ter falhado (aceita): a publicação dele vale do mesmo jeito, e a pauta fica como está.
  const pauta = await env.DB.prepare('SELECT status FROM pautas WHERE id = ? AND tenant_id = ?').bind(p.pautaId, tenantId).first<{ status: string }>();
  const ts: Transicao[] = [{ tipo: 'peca', id: pecaId, tenantId, para: 'publicada', por: 'sistema', dados: { publicacaoId: execucaoId, externalId: pub.externalId, url: pub.url ?? null, modo: conta.modo }, batch }];
  if (pauta?.status === 'em_producao') ts.push({ tipo: 'pauta', id: p.pautaId, tenantId, para: 'concluida', por: 'sistema' });
  const { mudou } = await transitar(env, ts);
  if (mudou) {
    env.METRICS.writeDataPoint({ blobs: [tenantId, 'publicada', conta.modo], doubles: [1], indexes: [tenantId] });
    // Conta simulada não publicou nada: não há o que certificar. A publicação nunca espera nem cai por causa da certidão.
    if (conta.modo !== 'simulada') await pedirCertidao(env, tenantId, pecaId);
  }
}

/** Enfileira a certidão. Fila fora do ar: fica para "Gerar certidão", e a publicação segue. */
export const pedirCertidao = (env: Env, tenantId: string, pecaId: string) =>
  env.MONITOR_QUEUE.send({ tipo: 'certidao', tenantId, pecaId }).catch((e) => console.error('certidão não enfileirada', pecaId, String(e)));

/** Peça → falhou, pauta de volta à fila, tentativa registrada em publicacoes, execução fechada. Idempotente. */
export async function falharPublicacao(env: Env, p: PublicacaoParams, execucaoId: string, motivo: string) {
  const { tenantId, pecaId } = p;
  // Execução já fechada (publicou e só a conclusão do step se perdeu, ou já falhou antes): não reescreve o desfecho.
  const exec = await env.DB.prepare('SELECT status FROM execucoes WHERE id = ? AND tenant_id = ?').bind(execucaoId, tenantId).first<{ status: string }>();
  if (exec && exec.status !== 'rodando') return;
  const conta = await env.DB.prepare('SELECT rede, modo FROM contas_sociais WHERE id = ? AND tenant_id = ?').bind(p.contaId, tenantId).first<{ rede: string; modo: string }>();
  const pauta = await env.DB.prepare('SELECT status FROM pautas WHERE id = ? AND tenant_id = ?').bind(p.pautaId, tenantId).first<{ status: string }>();
  const peca = await env.DB.prepare('SELECT formato FROM pecas WHERE id = ? AND tenant_id = ?').bind(pecaId, tenantId).first<{ formato: string }>();
  const ts: Transicao[] = [{
    tipo: 'peca', id: pecaId, tenantId, para: 'falhou', por: 'sistema', motivo,
    batch: [
      env.DB.prepare(`INSERT OR IGNORE INTO publicacoes (id, tenant_id, peca_id, conta_id, rede, modo, status, erro) VALUES (?, ?, ?, ?, ?, ?, 'falhou', ?)`)
        .bind(execucaoId, tenantId, pecaId, p.contaId, conta?.rede ?? 'instagram', conta?.modo ?? '?', motivo),
      encerrarExecucao(env, execucaoId, 'falhou', motivo),
    ],
  }];
  // O Reels não devolve a pauta à fila: quem a leva é o carrossel de origem.
  if (pauta?.status === 'em_producao' && peca?.formato !== 'reels') ts.push({ tipo: 'pauta', id: p.pautaId, tenantId, para: 'aceita', por: 'sistema', motivo });
  await transitar(env, ts);
}

/**
 * Cria a instância de publicação depois do batch da aprovação. Nunca marca falha aqui: se o create foi aceito e só a
 * resposta se perdeu, o Workflow publica de verdade. Erro = pendente; o reconciliador recria. Erro ou null.
 */
export function iniciarPublicacao(env: Env, id: string, params: PublicacaoParams): Promise<string | null> {
  return criarInstancia(env.PUBLICACAO_WORKFLOW, id, params);
}
