import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { fromPieceStyle } from '../lib/styles';
import { sponsorshipLine } from '../lib/drafting';
import type { Env, ProductionParams } from '../env';
import { loadLead, type Lead } from '../lib/lead';
import { draftPiece, type Draft } from '../lib/drafting';
import { validate } from '../lib/validation';
import { renderCards } from '../lib/render';
import { illustrate, type Illustration } from '../lib/illustrate';
import { stmtEvent, recordEvent } from '../lib/db';
import { closeExecution, transition, type Transition } from '../kernel/states';
import { createInstance } from './instance';
import { renderReels } from '../lib/reels';
import { libraryMusical } from '../lib/music';
import { narrationPerId } from '../lib/narration';
import { autopilot } from '../lib/autopilot';

export const MAX_ATTEMPTS = 3;   // drafts per round: the 2nd and 3rd only exist if the validator rejects
export const MAX_ROUNDS = 3;      // rounds per piece: 1 + up to 2 rewrites requested in review

/**
 * One production round: draft → validate (→ draft again with the correction) → illustrate → render → review.
 * Ends with the piece in `revisao` (or `falhou`). Review, approval and publishing happen outside of here.
 *
 * Replay rule: no write outside `step.do`. Each step is idempotent by construction:
 * - drafting: a version already stored in peca_versoes → returned without calling the model or adding cost;
 * - costs: added in the same batch that stores the keyed version/event, conditioned on `changes() = 1`;
 * - status: `transitar` is a no-op when the piece is already at the target.
 */
export class ProducaoWorkflow extends WorkflowEntrypoint<Env, ProductionParams> {
  async run(event: Readonly<WorkflowEvent<ProductionParams>>, step: WorkflowStep) {
    const p = event.payload;
    const executionId = event.instanceId;
    try {
      return await this.produzir(p, executionId, step);
    } catch (e) {
      const reason = String(e).slice(0, 500);
      await step.do('registrar falha', () => failProduction(this.env, p, executionId, reason));
      throw e;
    }
  }

  private async produzir(p: ProductionParams, executionId: string, step: WorkflowStep) {
    const { tenantId, pecaId: pieceId, pautaId: leadId, formato: format, rodada: round } = p;
    const env = this.env;
    if (format === 'reels') return this.produzirReels(p, executionId, step);

    const lead = await step.do('carregar pauta', () => loadLead(env, tenantId, leadId));
    // Numbering base for this round = the last version of the PREVIOUS rounds. It does not depend on this round's
    // versions, so it gives the same number even on a replay without the step cache (instance restart): drafting finds
    // the stored version.
    const base = await step.do('versao base', () => baseVersion(env, tenantId, pieceId, round));

    let instruction = p.instrucao;
    let draft: Draft | null = null;
    let version = base;
    for (let t = 1; t <= MAX_ATTEMPTS; t++) {
      version = base + t;
      const v = version;
      const r = await step.do(`t${t} redigir`, { retries: { limit: 2, delay: '15 seconds', backoff: 'exponential' } }, () =>
        draftVersion(env, { tenantId, pecaId: pieceId, execucaoId: executionId, rodada: round, versao: v, pauta: lead, formato: format === 'post' ? 'post' : 'carrossel', instrucao: instruction }));

      // Deterministic validator: a sentence without a fact, a number/date/neighbourhood outside the source → reject and draft again.
      const validation = await step.do(`t${t} validar`, async () => {
        const out = validate(lead, r);
        await currentRecordVersion(env, p, executionId, r, out, v);
        return out;
      });
      if (validation.ok) { draft = r; break; }
      instruction = `Corrija: ${validation.erros.join('; ')}`;
    }
    if (!draft) {
      await step.do('falhou na validacao', () => failProduction(env, p, executionId, `validation failed ${MAX_ATTEMPTS} drafts`));
      return { status: 'falhou' as const, versao: version };
    }
    const final = draft;
    const v = version;

    // Illustration (Kie/Grok with the brand reference → Workers AI). A failure does not bring the piece down: it goes out with a flat background.
    let illustration: Illustration | null = null;
    // Poster is type only, and in the daily digest one story's scene does not represent the others: neither spends on illustration.
    if (final.estilo?.params.composicao !== 'cartaz' && lead.tipoPost !== 'resumo') try {
      illustration = await step.do('ilustrar', { retries: { limit: 1, delay: '20 seconds' } }, () =>
        illustrateVersion(env, { tenantId, pecaId: pieceId, execucaoId: executionId, versao: v, pauta: lead, rascunho: final }));
    } catch (e) {
      const error = String(e).slice(0, 300);
      await step.do('ilustracao falhou', () =>
        recordEvent(env, tenantId, 'peca.ilustracao_falhou', 'peca', pieceId, { rodada: round, versao: v, erro: error }, `${pieceId}:v${v}:ilustracao_falhou`));
    }

    // R2 keys per version: a re-render overwrites the same objects, never another version's.
    const artwork = await step.do('renderizar', { retries: { limit: 2, delay: '10 seconds' } }, () =>
      renderCards(env, { tenantId, pecaId: pieceId, versao: v, rascunho: final, formato: format === 'post' ? 'post' : 'carrossel', pauta: lead, ilustracaoR2: illustration?.r2Key }));

    await step.do('revisao', () => finishProduction(env, p, executionId, artwork, v));
    await step.do('piloto', () => autopilot(env, { tenantId, pecaId: pieceId, rodada: round, versao: v }));
    return { status: 'revisao' as const, versao: v };
  }

  /**
   * Reels (Phase 4): the text is the source carousel's, at the version that was on screen when the Reels was requested.
   * No model: copy → check again → build the video in the Container (src/lib/reels.ts) → review. A single round.
   */
  private async produzirReels(p: ProductionParams, executionId: string, step: WorkflowStep) {
    const { tenantId, pecaId: pieceId, pautaId: leadId } = p;
    const env = this.env;
    if (!p.origem) throw new Error('reels without a source carousel');
    const origin = p.origem;
    const lead = await step.do('carregar pauta', () => loadLead(env, tenantId, leadId));
    const copy = await step.do('copiar o carrossel', () => copyOrigin(env, tenantId, origin));
    const content: Draft = { ...copy.conteudo, origem: { pecaId: origin.pecaId, versao: origin.versao }, musica: p.musica ?? null, narracao: p.narracao ?? null };

    const validation = await step.do('validar', async () => {
      const out = validate(lead, content, { formato: 'carrossel', humano: copy.autor !== 'ia' });
      await env.DB.prepare(`INSERT OR IGNORE INTO peca_versoes (id, tenant_id, peca_id, versao, rodada, conteudo_json, autor, modelo, custo_usd, motivo)
                            VALUES (?, ?, ?, 1, 1, ?, ?, NULL, 0, ?)`)
        .bind(crypto.randomUUID(), tenantId, pieceId, JSON.stringify(content), copy.autor, `reels do carrossel ${origin.pecaId} v${origin.versao}`).run();
      await currentRecordVersion(env, p, executionId, content, out, 1);
      return out;
    });
    if (!validation.ok) {
      await step.do('falhou na validacao', () => failProduction(env, p, executionId, `the carousel did not pass the check: ${validation.erros.join('; ')}`.slice(0, 500)));
      return { status: 'falhou' as const, versao: 1 };
    }

    // A full Container (all 3 instances busy, or this one's 429) is transient: wait and try again, with slack.
    const artwork = await step.do('montar o reels', { retries: { limit: 4, delay: '1 minute', backoff: 'exponential' }, timeout: '10 minutes' }, async () => {
      const music = p.musica ? (await libraryMusical(env)).find((m) => m.id === p.musica) ?? null : null;
      if (p.musica && !music) throw new Error(`music track ${p.musica} left the library`);
      const voice = p.narracao ? await narrationPerId(env, tenantId, origin.pecaId, p.narracao) : null;
      if (p.narracao && !voice) throw new Error('the Reels voice disappeared');
      const out = await renderReels(env, {
        tenantId, pecaId: pieceId, versao: 1, rascunho: content, pauta: lead, musica: music, capa: origin.capa, ilustracaoR2: origin.ilustracao ?? undefined, hoje: origin.em, ritmo: p.ritmo, voz: voice,
      });
      await recordEvent(env, tenantId, 'peca.reels', 'peca', pieceId, { versao: 1, mp4: out[0].mp4, duracao: out[0].duracao, musica: out[0].musica, tempoMs: out[0].tempoMs ?? null }, `${pieceId}:v1:reels`);
      return out;
    });

    await step.do('revisao', () => finishProduction(env, p, executionId, artwork, 1));
    return { status: 'revisao' as const, versao: 1 };
  }
}

/** The Reels' source carousel: the requested version's text and who wrote it (art and illustration come frozen in the request). */
export async function copyOrigin(env: Env, tenantId: string, from: { pecaId: string; versao: number }) {
  const v = await env.DB.prepare('SELECT conteudo_json, autor FROM peca_versoes WHERE peca_id = ? AND tenant_id = ? AND versao = ?')
    .bind(from.pecaId, tenantId, from.versao).first<{ conteudo_json: string; autor: string }>();
  if (!v) throw new Error(`carousel ${from.pecaId} v${from.versao} not found`);
  return { conteudo: JSON.parse(v.conteudo_json) as Draft, autor: v.autor };
}

/**
 * The round's final step: art + piece in review + run closed, in one batch. Fenced by the round: if the editor already
 * asked for a rewrite (the piece in another run), a replay of this step must not put the old art back in review.
 */
export async function finishProduction(env: Env, p: Pick<ProductionParams, 'tenantId' | 'pecaId' | 'rodada'>, executionId: string, artwork: unknown, version: number) {
  const { tenantId, pecaId: pieceId } = p;
  // Already done (the batch went through and only the step's completion was lost): the piece may even be approved. Nothing to do.
  if (!(await executionCurrent(env, p, executionId))) {
    await closeExecution(env, executionId, 'concluida').run();
    return;
  }
  await transition(env, {
    tipo: 'peca', id: pieceId, tenantId, para: 'revisao', por: 'sistema', dados: { rodada: p.rodada, versao: version }, exigeWorkflow: executionId,
    batch: [
      env.DB.prepare('UPDATE pecas SET arte_r2_keys_json = ? WHERE id = ? AND tenant_id = ? AND workflow_id = ?').bind(JSON.stringify(artwork), pieceId, tenantId, executionId),
      closeExecution(env, executionId, 'concluida'),
    ],
  });
  // Superseded round (no-op above): this instance's run still needs closing. Idempotent.
  await closeExecution(env, executionId, 'concluida').run();
}

/** The last version stored by the rounds before `rodada` (0 in the first). */
export async function baseVersion(env: Env, tenantId: string, pieceId: string, round: number) {
  return (await env.DB.prepare('SELECT COALESCE(MAX(versao), 0) AS v FROM peca_versoes WHERE peca_id = ? AND tenant_id = ? AND rodada < ?')
    .bind(pieceId, tenantId, round).first<{ v: number }>())?.v ?? 0;
}

/**
 * The `redigir` step. Before calling the model, looks for the version: if it exists (the step re-ran after storing), it
 * returns what is stored without calling or adding cost. Storing the version and adding the cost is a single batch
 * (atomic), and the cost UPDATEs only apply if the INSERT went in (`changes() = 1`).
 */
export async function draftVersion(env: Env, a: {
  tenantId: string; pecaId: string; execucaoId: string; rodada: number; versao: number; pauta: Lead; formato: 'post' | 'carrossel'; instrucao?: string;
}): Promise<Draft> {
  const existing = await env.DB.prepare('SELECT conteudo_json FROM peca_versoes WHERE peca_id = ? AND versao = ? AND tenant_id = ?')
    .bind(a.pecaId, a.versao, a.tenantId).first<{ conteudo_json: string }>();
  if (existing) return JSON.parse(existing.conteudo_json) as Draft;

  // A rewrite keeps the previous version's template; a new piece chooses by its lead.
  const style = await fromPieceStyle(env, a.tenantId, a.pecaId, a.pauta);
  const out = await draftPiece(env, { pauta: a.pauta, formato: a.formato, instrucao: a.instrucao, sequencia: style?.params.sequencia });
  if (style) out.estilo = style;
  if (style?.patrocinador) out.legenda += sponsorshipLine(a.pauta, style.patrocinador.nome);
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO peca_versoes (id, tenant_id, peca_id, versao, rodada, conteudo_json, autor, modelo, custo_usd, motivo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), a.tenantId, a.pecaId, a.versao, a.rodada, JSON.stringify(out), 'ia', out.modelo, out.custoUsd, a.instrucao ?? null),
    ...addCost(env, a, out.custoUsd),
  ]);
  return out;
}

/** The `ilustrar` step. Same rule: an event keyed per version; the cost only adds if the event went in. */
export async function illustrateVersion(env: Env, a: { tenantId: string; pecaId: string; execucaoId: string; versao: number; pauta: Lead; rascunho: Draft }) {
  const row = await env.DB.prepare('SELECT custo_usd FROM pecas WHERE id = ? AND tenant_id = ?').bind(a.pecaId, a.tenantId).first<{ custo_usd: number }>();
  const out = await illustrate(env, { tenantId: a.tenantId, pecaId: a.pecaId, pauta: a.pauta, rascunho: a.rascunho, custoAtualUsd: row?.custo_usd ?? 0 });
  if (out) {
    await env.DB.batch([
      stmtEvent(env, { tenantId: a.tenantId, tipo: 'peca.ilustracao', refTipo: 'peca', refId: a.pecaId, payload: { versao: a.versao, ...out }, chave: `${a.pecaId}:v${a.versao}:ilustracao` }),
      ...addCost(env, a, out.custoUsd),
    ]);
  }
  return out;
}

/** The two UPDATEs chained on `changes() = 1`: they only run if the batch's previous statement wrote exactly 1 row. */
function addCost(env: Env, a: { tenantId: string; pecaId: string; execucaoId: string }, cost: number) {
  return [
    env.DB.prepare('UPDATE pecas SET custo_usd = custo_usd + ? WHERE id = ? AND tenant_id = ? AND changes() = 1').bind(cost, a.pecaId, a.tenantId),
    env.DB.prepare('UPDATE execucoes SET custo_usd = custo_usd + ? WHERE id = ? AND changes() = 1').bind(cost, a.execucaoId),
  ];
}

/**
 * Piece → falhou, the lead goes back to the queue (aceita) if it was still in production, run closed. Idempotent.
 * Only acts if this run is still open and still the piece's: a run that already finished (piece in review or approved)
 * or a round superseded by a rewrite does not bring the piece down, it only closes its own run.
 */
export async function failProduction(env: Env, p: Pick<ProductionParams, 'tenantId' | 'pecaId' | 'pautaId'> & { formato?: ProductionParams['formato'] }, executionId: string, reason: string) {
  if (!(await executionCurrent(env, p, executionId))) {
    await closeExecution(env, executionId, 'falhou', reason).run();
    return;
  }
  const lead = await env.DB.prepare('SELECT status FROM pautas WHERE id = ? AND tenant_id = ?').bind(p.pautaId, p.tenantId).first<{ status: string }>();
  const ts: Transition[] = [{
    tipo: 'peca', id: p.pecaId, tenantId: p.tenantId, para: 'falhou', por: 'sistema', motivo: reason, exigeWorkflow: executionId,
    batch: [closeExecution(env, executionId, 'falhou', reason)],
  }];
  // A Reels does not touch the lead: its source carousel holds it (and may be in review).
  if (lead?.status === 'em_producao' && p.formato !== 'reels') ts.push({ tipo: 'pauta', id: p.pautaId, tenantId: p.tenantId, para: 'aceita', por: 'sistema', motivo: reason });
  await transition(env, ts);
}

/** An open run (`rodando`) that still owns the piece (`pecas.workflow_id`). Otherwise, the instance does not touch the piece. */
async function executionCurrent(env: Env, p: Pick<ProductionParams, 'tenantId' | 'pecaId'>, executionId: string) {
  const r = await env.DB.prepare(
    "SELECT 1 AS ok FROM execucoes e JOIN pecas pc ON pc.id = e.ref_id WHERE e.id = ? AND e.status = 'rodando' AND pc.id = ? AND pc.tenant_id = ? AND pc.workflow_id = ?",
  ).bind(executionId, p.pecaId, p.tenantId, executionId).first<{ ok: number }>();
  return !!r;
}

/**
 * The `validar` step: stores the displayed version. Only with the piece in production (`rascunho`), owned by this run and
 * with the run open: restarting an old or already finished instance (piece in review/approved) does not swap the
 * approved text.
 */
export async function currentRecordVersion(env: Env, p: Pick<ProductionParams, 'tenantId' | 'pecaId'>, executionId: string, r: Draft, validation: unknown, version: number) {
  await env.DB.prepare(
    `UPDATE pecas SET conteudo_json = ?, validacao_json = ?, versao = ?, updated_at = datetime('now')
     WHERE id = ? AND tenant_id = ? AND workflow_id = ? AND status = 'rascunho'
       AND EXISTS (SELECT 1 FROM execucoes WHERE id = ? AND status = 'rodando')`,
  ).bind(JSON.stringify(r), JSON.stringify(validation), version, p.pecaId, p.tenantId, executionId, executionId).run();
}

export const productionId = (pieceId: string, round: number) => `${pieceId}-r${round}`;

/**
 * Creates the round's instance. Call AFTER the batch that stored the piece/run (create is not part of the D1 batch).
 * Error = pending start (the run stays `rodando` and the reconciler recreates it). Returns the error message or null.
 */
export function startProduction(env: Env, params: ProductionParams): Promise<string | null> {
  return createInstance(env.PRODUCAO_WORKFLOW, productionId(params.pecaId, params.rodada), params);
}
