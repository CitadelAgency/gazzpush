import type { Env } from '../env';
import { entradaModelo, type Artigo } from './artigo';
import { registrarEvento } from './db';

/**
 * Dedupe semântico (complementa o hash exato): a mesma notícia reescrita por outro site não vira duas ideias.
 * Embedding bge-m3 (1024 dims, igual ao índice `redacao-dedupe`), namespace = tenant. Só descarta quando o vizinho
 * mais parecido (cosseno ≥ 0,92) é um documento triado ou com ideia viva, dos últimos 3 dias, do mesmo veículo.
 * Qualquer falha do AI ou do Vectorize vira evento `dedupe.falha` e a triagem segue sem esta etapa.
 */
export const LIMIAR_SEMANTICO = 0.92;
export const JANELA_DIAS = 3;
export const MAX_CHARS_EMBED = 8000;
const MODELO_EMBED = '@cf/baai/bge-m3';
const DIMENSOES = 1024;

async function embutirReal(env: Env, texto: string): Promise<number[]> {
  const out = await (env.AI.run as (m: string, i: unknown) => Promise<{ data?: number[][] }>)(MODELO_EMBED, { text: [texto] });
  const v = out?.data?.[0];
  if (!Array.isArray(v) || v.length !== DIMENSOES) throw new Error(`embedding inválido (${Array.isArray(v) ? v.length : typeof v})`);
  return v;
}

export type IndiceDedupe = Pick<VectorizeIndex, 'query' | 'upsert'>;

/** Injetáveis: AI e Vectorize não existem no vitest (os testes trocam por fakes em memória). */
export const dedupe = {
  embutir: embutirReal,
  indice: (env: Env): IndiceDedupe => env.DEDUPE,
};

export type ResultadoDedupe = { duplicadoDe: string; score: number } | null;

/**
 * Procura um documento quase igual; se não há, grava o vetor deste (id = documentoId). Devolve o duplicado ou null.
 * Nunca lança: falha vira `dedupe.falha` e null.
 */
export async function dedupeSemantico(env: Env, tenantId: string, documentoId: string, artigo: Pick<Artigo, 'titulo' | 'texto'>, agora = new Date()): Promise<ResultadoDedupe> {
  try {
    const vetor = await dedupe.embutir(env, entradaModelo(artigo).slice(0, MAX_CHARS_EMBED));
    const indice = dedupe.indice(env);
    const { matches } = await indice.query(vetor, { topK: 3, namespace: tenantId, returnMetadata: 'all' });
    const candidatos = matches
      .filter((m) => m.id !== documentoId && m.score >= LIMIAR_SEMANTICO)
      .sort((a, b) => b.score - a.score);
    for (const m of candidatos) {
      const outro = typeof m.metadata?.documentoId === 'string' ? m.metadata.documentoId : m.id;
      // O estado vem do D1 (o metadado do vetor envelhece): triado ou com ideia viva, nos últimos 3 dias, deste veículo.
      const vivo = await env.DB.prepare(
        `SELECT 1 AS ok FROM documentos d
          WHERE d.id = ? AND d.tenant_id = ? AND d.id != ?
            AND ((d.status = 'triado' AND d.capturado_em >= datetime(?, '-${JANELA_DIAS} days'))
              OR EXISTS (SELECT 1 FROM pautas p JOIN json_each(p.documento_ids_json) j ON j.value = d.id
                          WHERE p.tenant_id = d.tenant_id AND p.status != 'descartada' AND p.created_at >= datetime(?, '-${JANELA_DIAS} days')))`,
      ).bind(outro, tenantId, documentoId, sqlDe(agora), sqlDe(agora)).first();
      if (vivo) return { duplicadoDe: outro, score: m.score };
    }
    await indice.upsert([{ id: documentoId, values: vetor, namespace: tenantId, metadata: { tenantId, documentoId, criadoEm: agora.toISOString() } }]);
    return null;
  } catch (e) {
    await registrarEvento(env, tenantId, 'dedupe.falha', 'documento', documentoId, { erro: String(e).slice(0, 300) }).catch(() => {});
    return null;
  }
}

const sqlDe = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');

/** "0,93": a similaridade no motivo do descarte, com vírgula. */
export const similaridade = (score: number) => (Math.floor(score * 100) / 100).toFixed(2).replace('.', ',');
