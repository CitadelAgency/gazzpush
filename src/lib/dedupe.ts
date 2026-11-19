import type { Env } from '../env';
import { inputModel, type Article } from './article';
import { recordEvent } from './db';

/**
 * Semantic dedupe (complements the exact hash): the same news rewritten by another site does not become two ideas.
 * bge-m3 embedding (1024 dims, matching the `redacao-dedupe` index), namespace = tenant. It only discards when the
 * closest neighbour (cosine ≥ 0.92) is a document that was triaged or has a live idea, from the last 3 days, in the same
 * outlet. Any AI or Vectorize failure becomes a `dedupe.falha` event and triage carries on without this step.
 */
export const THRESHOLD_SEMANTIC = 0.92;
export const DAYS_WINDOW = 3;
export const MAX_CHARS_EMBED = 8000;
const EMBED_MODEL = '@cf/baai/bge-m3';
const DIMENSIONS = 1024;

async function embedReal(env: Env, text: string): Promise<number[]> {
  const out = await (env.AI.run as (m: string, i: unknown) => Promise<{ data?: number[][] }>)(EMBED_MODEL, { text: [text] });
  const v = out?.data?.[0];
  if (!Array.isArray(v) || v.length !== DIMENSIONS) throw new Error(`invalid embedding (${Array.isArray(v) ? v.length : typeof v})`);
  return v;
}

export type DedupeIndex = Pick<VectorizeIndex, 'query' | 'upsert'>;

/** Injectable: AI and Vectorize do not exist in vitest (tests swap them for in-memory fakes). */
export const dedupe = {
  embutir: embedReal,
  indice: (env: Env): DedupeIndex => env.DEDUPE,
};

export type ResultDedupe = { duplicadoDe: string; score: number } | null;

/**
 * Looks for a near-identical document; if there is none, stores this one's vector (id = documentoId). Returns the
 * duplicate or null. Never throws: a failure becomes `dedupe.falha` and null.
 */
export async function dedupeSemantic(env: Env, tenantId: string, documentId: string, article: Pick<Article, 'titulo' | 'texto'>, now = new Date()): Promise<ResultDedupe> {
  try {
    const vector = await dedupe.embutir(env, inputModel(article).slice(0, MAX_CHARS_EMBED));
    const index = dedupe.indice(env);
    const { matches } = await index.query(vector, { topK: 3, namespace: tenantId, returnMetadata: 'all' });
    const candidates = matches
      .filter((m) => m.id !== documentId && m.score >= THRESHOLD_SEMANTIC)
      .sort((a, b) => b.score - a.score);
    for (const m of candidates) {
      const other = typeof m.metadata?.documentoId === 'string' ? m.metadata.documentoId : m.id;
      // The state comes from D1 (vector metadata goes stale): triaged or with a live idea, in the last 3 days, in this outlet.
      const live = await env.DB.prepare(
        `SELECT 1 AS ok FROM documentos d
          WHERE d.id = ? AND d.tenant_id = ? AND d.id != ?
            AND ((d.status = 'triado' AND d.capturado_em >= datetime(?, '-${DAYS_WINDOW} days'))
              OR EXISTS (SELECT 1 FROM pautas p JOIN json_each(p.documento_ids_json) j ON j.value = d.id
                          WHERE p.tenant_id = d.tenant_id AND p.status != 'descartada' AND p.created_at >= datetime(?, '-${DAYS_WINDOW} days')))`,
      ).bind(other, tenantId, documentId, sqlOf(now), sqlOf(now)).first();
      if (live) return { duplicadoDe: other, score: m.score };
    }
    await index.upsert([{ id: documentId, values: vector, namespace: tenantId, metadata: { tenantId, documentoId: documentId, criadoEm: now.toISOString() } }]);
    return null;
  } catch (e) {
    await recordEvent(env, tenantId, 'dedupe.falha', 'documento', documentId, { erro: String(e).slice(0, 300) }).catch(() => {});
    return null;
  }
}

const sqlOf = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');

/** "0,93": the similarity in the discard reason, with a decimal comma. */
export const similarity = (score: number) => (Math.floor(score * 100) / 100).toFixed(2).replace('.', ',');
