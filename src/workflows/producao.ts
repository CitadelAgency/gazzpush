import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { estiloDaPeca } from '../lib/estilos';
import { linhaOferecimento } from '../lib/redacao';
import type { Env, ProducaoParams } from '../env';
import { carregarPauta, type Pauta } from '../lib/pauta';
import { redigir, type Rascunho } from '../lib/redacao';
import { validar } from '../lib/validacao';
import { renderizarCards } from '../lib/render';
import { ilustrar, type Ilustracao } from '../lib/ilustrar';
import { eventoStmt, registrarEvento } from '../lib/db';
import { encerrarExecucao, transitar, type Transicao } from '../kernel/estados';
import { criarInstancia } from './instancia';
import { renderizarReels } from '../lib/reels';
import { bibliotecaMusical } from '../lib/musica';
import { narracaoPorId } from '../lib/narracao';
import { pilotar } from '../lib/piloto';

export const MAX_TENTATIVAS = 3;   // redações por rodada: a 2ª e a 3ª só existem se o validador reprovar
export const MAX_RODADAS = 3;      // rodadas por peça: 1 + até 2 reescritas pedidas na revisão

/**
 * Uma rodada de produção: redigir → validar (→ redigir de novo com a correção) → ilustrar → renderizar → revisão.
 * Termina com a peça em `revisao` (ou `falhou`). Revisão, aprovação e publicação acontecem fora daqui.
 *
 * Regra de replay: nenhuma escrita fora de `step.do`. Cada step é idempotente por construção:
 * - redigir: versão já gravada em peca_versoes → devolve sem chamar o modelo nem somar custo;
 * - custos: somados no mesmo batch que grava a versão/evento com chave, condicionados a `changes() = 1`;
 * - status: `transitar` é no-op quando a peça já está no destino.
 */
export class ProducaoWorkflow extends WorkflowEntrypoint<Env, ProducaoParams> {
  async run(event: Readonly<WorkflowEvent<ProducaoParams>>, step: WorkflowStep) {
    const p = event.payload;
    const execucaoId = event.instanceId;
    try {
      return await this.produzir(p, execucaoId, step);
    } catch (e) {
      const motivo = String(e).slice(0, 500);
      await step.do('registrar falha', () => falharProducao(this.env, p, execucaoId, motivo));
      throw e;
    }
  }

  private async produzir(p: ProducaoParams, execucaoId: string, step: WorkflowStep) {
    const { tenantId, pecaId, pautaId, formato, rodada } = p;
    const env = this.env;
    if (formato === 'reels') return this.produzirReels(p, execucaoId, step);

    const pauta = await step.do('carregar pauta', () => carregarPauta(env, tenantId, pautaId));
    // Base da numeração desta rodada = última versão das rodadas ANTERIORES. Não depende das versões desta rodada,
    // então dá o mesmo número mesmo num replay sem cache de steps (restart da instância): redigir acha a versão gravada.
    const base = await step.do('versao base', () => versaoBase(env, tenantId, pecaId, rodada));

    let instrucao = p.instrucao;
    let rascunho: Rascunho | null = null;
    let versao = base;
    for (let t = 1; t <= MAX_TENTATIVAS; t++) {
      versao = base + t;
      const v = versao;
      const r = await step.do(`t${t} redigir`, { retries: { limit: 2, delay: '15 seconds', backoff: 'exponential' } }, () =>
        redigirVersao(env, { tenantId, pecaId, execucaoId, rodada, versao: v, pauta, formato: formato === 'post' ? 'post' : 'carrossel', instrucao }));

      // Validador determinístico: frase sem fato, número/data/bairro fora da fonte → reprova e redige de novo.
      const validacao = await step.do(`t${t} validar`, async () => {
        const out = validar(pauta, r);
        await gravarVersaoAtual(env, p, execucaoId, r, out, v);
        return out;
      });
      if (validacao.ok) { rascunho = r; break; }
      instrucao = `Corrija: ${validacao.erros.join('; ')}`;
    }
    if (!rascunho) {
      await step.do('falhou na validacao', () => falharProducao(env, p, execucaoId, `validação reprovou ${MAX_TENTATIVAS} redações`));
      return { status: 'falhou' as const, versao };
    }
    const final = rascunho;
    const v = versao;

    // Ilustração (Kie/Grok com referência da marca → Workers AI). Falha não derruba a peça: sai com fundo flat.
    let ilustracao: Ilustracao | null = null;
    // Cartaz é só tipografia, e no resumo do dia a cena de uma notícia não representa as outras: não gastam ilustração.
    if (final.estilo?.params.composicao !== 'cartaz' && pauta.tipoPost !== 'resumo') try {
      ilustracao = await step.do('ilustrar', { retries: { limit: 1, delay: '20 seconds' } }, () =>
        ilustrarVersao(env, { tenantId, pecaId, execucaoId, versao: v, pauta, rascunho: final }));
    } catch (e) {
      const erro = String(e).slice(0, 300);
      await step.do('ilustracao falhou', () =>
        registrarEvento(env, tenantId, 'peca.ilustracao_falhou', 'peca', pecaId, { rodada, versao: v, erro }, `${pecaId}:v${v}:ilustracao_falhou`));
    }

    // Chaves no R2 por versão: re-render sobrescreve os mesmos objetos, nunca os de outra versão.
    const artes = await step.do('renderizar', { retries: { limit: 2, delay: '10 seconds' } }, () =>
      renderizarCards(env, { tenantId, pecaId, versao: v, rascunho: final, formato: formato === 'post' ? 'post' : 'carrossel', pauta, ilustracaoR2: ilustracao?.r2Key }));

    await step.do('revisao', () => concluirProducao(env, p, execucaoId, artes, v));
    await step.do('piloto', () => pilotar(env, { tenantId, pecaId, rodada, versao: v }));
    return { status: 'revisao' as const, versao: v };
  }

  /**
   * Reels (Fase 4): o texto é o do carrossel de origem, na versão que estava na tela quando o Reels foi pedido. Sem
   * modelo: copiar → conferir de novo → montar o vídeo no Container (src/lib/reels.ts) → revisão. Uma rodada só.
   */
  private async produzirReels(p: ProducaoParams, execucaoId: string, step: WorkflowStep) {
    const { tenantId, pecaId, pautaId } = p;
    const env = this.env;
    if (!p.origem) throw new Error('reels sem carrossel de origem');
    const origem = p.origem;
    const pauta = await step.do('carregar pauta', () => carregarPauta(env, tenantId, pautaId));
    const copia = await step.do('copiar o carrossel', () => copiarOrigem(env, tenantId, origem));
    const conteudo: Rascunho = { ...copia.conteudo, origem: { pecaId: origem.pecaId, versao: origem.versao }, musica: p.musica ?? null, narracao: p.narracao ?? null };

    const validacao = await step.do('validar', async () => {
      const out = validar(pauta, conteudo, { formato: 'carrossel', humano: copia.autor !== 'ia' });
      await env.DB.prepare(`INSERT OR IGNORE INTO peca_versoes (id, tenant_id, peca_id, versao, rodada, conteudo_json, autor, modelo, custo_usd, motivo)
                            VALUES (?, ?, ?, 1, 1, ?, ?, NULL, 0, ?)`)
        .bind(crypto.randomUUID(), tenantId, pecaId, JSON.stringify(conteudo), copia.autor, `reels do carrossel ${origem.pecaId} v${origem.versao}`).run();
      await gravarVersaoAtual(env, p, execucaoId, conteudo, out, 1);
      return out;
    });
    if (!validacao.ok) {
      await step.do('falhou na validacao', () => falharProducao(env, p, execucaoId, `o carrossel não passou na conferência: ${validacao.erros.join('; ')}`.slice(0, 500)));
      return { status: 'falhou' as const, versao: 1 };
    }

    // Container cheio (as 3 instâncias ocupadas, ou 429 desta) é passageiro: espera e tenta de novo, com folga.
    const artes = await step.do('montar o reels', { retries: { limit: 4, delay: '1 minute', backoff: 'exponential' }, timeout: '10 minutes' }, async () => {
      const musica = p.musica ? (await bibliotecaMusical(env)).find((m) => m.id === p.musica) ?? null : null;
      if (p.musica && !musica) throw new Error(`música ${p.musica} saiu da biblioteca`);
      const voz = p.narracao ? await narracaoPorId(env, tenantId, origem.pecaId, p.narracao) : null;
      if (p.narracao && !voz) throw new Error('a fala do Reels sumiu');
      const out = await renderizarReels(env, {
        tenantId, pecaId, versao: 1, rascunho: conteudo, pauta, musica, capa: origem.capa, ilustracaoR2: origem.ilustracao ?? undefined, hoje: origem.em, ritmo: p.ritmo, voz,
      });
      await registrarEvento(env, tenantId, 'peca.reels', 'peca', pecaId, { versao: 1, mp4: out[0].mp4, duracao: out[0].duracao, musica: out[0].musica, tempoMs: out[0].tempoMs ?? null }, `${pecaId}:v1:reels`);
      return out;
    });

    await step.do('revisao', () => concluirProducao(env, p, execucaoId, artes, 1));
    return { status: 'revisao' as const, versao: 1 };
  }
}

/** O carrossel de origem do Reels: o texto da versão pedida e quem a escreveu (arte e ilustração vêm congeladas no pedido). */
export async function copiarOrigem(env: Env, tenantId: string, origem: { pecaId: string; versao: number }) {
  const v = await env.DB.prepare('SELECT conteudo_json, autor FROM peca_versoes WHERE peca_id = ? AND tenant_id = ? AND versao = ?')
    .bind(origem.pecaId, tenantId, origem.versao).first<{ conteudo_json: string; autor: string }>();
  if (!v) throw new Error(`carrossel ${origem.pecaId} v${origem.versao} não encontrado`);
  return { conteudo: JSON.parse(v.conteudo_json) as Rascunho, autor: v.autor };
}

/**
 * Step final da rodada: artes + peça em revisão + execução fechada, num batch. Cercado pela rodada: se o editor já
 * pediu reescrita (peça em outra execução), um replay deste step não pode recolocar a arte velha em revisão.
 */
export async function concluirProducao(env: Env, p: Pick<ProducaoParams, 'tenantId' | 'pecaId' | 'rodada'>, execucaoId: string, artes: unknown, versao: number) {
  const { tenantId, pecaId } = p;
  // Já concluída (o batch passou e só a conclusão do step se perdeu): a peça pode até já estar aprovada. Nada a fazer.
  if (!(await execucaoCorrente(env, p, execucaoId))) {
    await encerrarExecucao(env, execucaoId, 'concluida').run();
    return;
  }
  await transitar(env, {
    tipo: 'peca', id: pecaId, tenantId, para: 'revisao', por: 'sistema', dados: { rodada: p.rodada, versao }, exigeWorkflow: execucaoId,
    batch: [
      env.DB.prepare('UPDATE pecas SET arte_r2_keys_json = ? WHERE id = ? AND tenant_id = ? AND workflow_id = ?').bind(JSON.stringify(artes), pecaId, tenantId, execucaoId),
      encerrarExecucao(env, execucaoId, 'concluida'),
    ],
  });
  // Rodada superada (no-op acima): a execução desta instância ainda precisa fechar. Idempotente.
  await encerrarExecucao(env, execucaoId, 'concluida').run();
}

/** Última versão gravada pelas rodadas anteriores a `rodada` (0 na primeira). */
export async function versaoBase(env: Env, tenantId: string, pecaId: string, rodada: number) {
  return (await env.DB.prepare('SELECT COALESCE(MAX(versao), 0) AS v FROM peca_versoes WHERE peca_id = ? AND tenant_id = ? AND rodada < ?')
    .bind(pecaId, tenantId, rodada).first<{ v: number }>())?.v ?? 0;
}

/**
 * Step `redigir`. Antes de chamar o modelo, procura a versão: se existe (step re-executado depois de gravar), devolve
 * o que está gravado sem chamar e sem somar custo. Gravar a versão e somar o custo é um batch só (atômico), e os
 * UPDATEs de custo só valem se o INSERT entrou (`changes() = 1`).
 */
export async function redigirVersao(env: Env, a: {
  tenantId: string; pecaId: string; execucaoId: string; rodada: number; versao: number; pauta: Pauta; formato: 'post' | 'carrossel'; instrucao?: string;
}): Promise<Rascunho> {
  const existente = await env.DB.prepare('SELECT conteudo_json FROM peca_versoes WHERE peca_id = ? AND versao = ? AND tenant_id = ?')
    .bind(a.pecaId, a.versao, a.tenantId).first<{ conteudo_json: string }>();
  if (existente) return JSON.parse(existente.conteudo_json) as Rascunho;

  // Reescrever mantém o modelo da versão anterior; peça nova escolhe pela pauta.
  const estilo = await estiloDaPeca(env, a.tenantId, a.pecaId, a.pauta);
  const out = await redigir(env, { pauta: a.pauta, formato: a.formato, instrucao: a.instrucao, sequencia: estilo?.params.sequencia });
  if (estilo) out.estilo = estilo;
  if (estilo?.patrocinador) out.legenda += linhaOferecimento(a.pauta, estilo.patrocinador.nome);
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO peca_versoes (id, tenant_id, peca_id, versao, rodada, conteudo_json, autor, modelo, custo_usd, motivo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), a.tenantId, a.pecaId, a.versao, a.rodada, JSON.stringify(out), 'ia', out.modelo, out.custoUsd, a.instrucao ?? null),
    ...somarCusto(env, a, out.custoUsd),
  ]);
  return out;
}

/** Step `ilustrar`. Mesma regra: evento com chave por versão; custo só soma se o evento entrou. */
export async function ilustrarVersao(env: Env, a: { tenantId: string; pecaId: string; execucaoId: string; versao: number; pauta: Pauta; rascunho: Rascunho }) {
  const row = await env.DB.prepare('SELECT custo_usd FROM pecas WHERE id = ? AND tenant_id = ?').bind(a.pecaId, a.tenantId).first<{ custo_usd: number }>();
  const out = await ilustrar(env, { tenantId: a.tenantId, pecaId: a.pecaId, pauta: a.pauta, rascunho: a.rascunho, custoAtualUsd: row?.custo_usd ?? 0 });
  if (out) {
    await env.DB.batch([
      eventoStmt(env, { tenantId: a.tenantId, tipo: 'peca.ilustracao', refTipo: 'peca', refId: a.pecaId, payload: { versao: a.versao, ...out }, chave: `${a.pecaId}:v${a.versao}:ilustracao` }),
      ...somarCusto(env, a, out.custoUsd),
    ]);
  }
  return out;
}

/** Os dois UPDATEs encadeados em `changes() = 1`: só rodam se o statement anterior do batch gravou exatamente 1 linha. */
function somarCusto(env: Env, a: { tenantId: string; pecaId: string; execucaoId: string }, custo: number) {
  return [
    env.DB.prepare('UPDATE pecas SET custo_usd = custo_usd + ? WHERE id = ? AND tenant_id = ? AND changes() = 1').bind(custo, a.pecaId, a.tenantId),
    env.DB.prepare('UPDATE execucoes SET custo_usd = custo_usd + ? WHERE id = ? AND changes() = 1').bind(custo, a.execucaoId),
  ];
}

/**
 * Peça → falhou, pauta volta pra fila (aceita) se ainda estava em produção, execução fechada. Idempotente.
 * Só age se esta execução ainda está aberta e ainda é a da peça: execução que já concluiu (peça em revisão ou
 * aprovada) ou rodada superada por reescrita não derrubam a peça, só fecham a própria execução.
 */
export async function falharProducao(env: Env, p: Pick<ProducaoParams, 'tenantId' | 'pecaId' | 'pautaId'> & { formato?: ProducaoParams['formato'] }, execucaoId: string, motivo: string) {
  if (!(await execucaoCorrente(env, p, execucaoId))) {
    await encerrarExecucao(env, execucaoId, 'falhou', motivo).run();
    return;
  }
  const pauta = await env.DB.prepare('SELECT status FROM pautas WHERE id = ? AND tenant_id = ?').bind(p.pautaId, p.tenantId).first<{ status: string }>();
  const ts: Transicao[] = [{
    tipo: 'peca', id: p.pecaId, tenantId: p.tenantId, para: 'falhou', por: 'sistema', motivo, exigeWorkflow: execucaoId,
    batch: [encerrarExecucao(env, execucaoId, 'falhou', motivo)],
  }];
  // O Reels não mexe na pauta: quem a leva é o carrossel de origem (que pode estar em revisão).
  if (pauta?.status === 'em_producao' && p.formato !== 'reels') ts.push({ tipo: 'pauta', id: p.pautaId, tenantId: p.tenantId, para: 'aceita', por: 'sistema', motivo });
  await transitar(env, ts);
}

/** Execução aberta (`rodando`) e ainda dona da peça (`pecas.workflow_id`). Fora disso, a instância não mexe na peça. */
async function execucaoCorrente(env: Env, p: Pick<ProducaoParams, 'tenantId' | 'pecaId'>, execucaoId: string) {
  const r = await env.DB.prepare(
    "SELECT 1 AS ok FROM execucoes e JOIN pecas pc ON pc.id = e.ref_id WHERE e.id = ? AND e.status = 'rodando' AND pc.id = ? AND pc.tenant_id = ? AND pc.workflow_id = ?",
  ).bind(execucaoId, p.pecaId, p.tenantId, execucaoId).first<{ ok: number }>();
  return !!r;
}

/**
 * Step `validar`: grava a versão exibida. Só com a peça em produção (`rascunho`), dona desta execução e execução
 * aberta: restart de instância antiga ou já concluída (peça em revisão/aprovada) não troca o texto aprovado.
 */
export async function gravarVersaoAtual(env: Env, p: Pick<ProducaoParams, 'tenantId' | 'pecaId'>, execucaoId: string, r: Rascunho, validacao: unknown, versao: number) {
  await env.DB.prepare(
    `UPDATE pecas SET conteudo_json = ?, validacao_json = ?, versao = ?, updated_at = datetime('now')
     WHERE id = ? AND tenant_id = ? AND workflow_id = ? AND status = 'rascunho'
       AND EXISTS (SELECT 1 FROM execucoes WHERE id = ? AND status = 'rodando')`,
  ).bind(JSON.stringify(r), JSON.stringify(validacao), versao, p.pecaId, p.tenantId, execucaoId, execucaoId).run();
}

export const idProducao = (pecaId: string, rodada: number) => `${pecaId}-r${rodada}`;

/**
 * Cria a instância da rodada. Chamar DEPOIS do batch que gravou peça/execução (create não entra no batch do D1).
 * Erro = início pendente (a execução fica `rodando` e o reconciliador recria). Devolve a mensagem de erro ou null.
 */
export function iniciarProducao(env: Env, params: ProducaoParams): Promise<string | null> {
  return criarInstancia(env.PRODUCAO_WORKFLOW, idProducao(params.pecaId, params.rodada), params);
}
