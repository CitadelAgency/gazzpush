// Raio-X no servidor: lê cada miniatura com o modelo de visão e marca o que parece mídia de terceiro. O app não apaga nada
// e não sugere apagar: quem decide é o dono.
import type { Env } from '../env';
import { lerVisao, marcasNaLegenda, PROMPT_RAIOX } from './raiox';

export const MODELO_RAIOX = '@cf/meta/llama-3.2-11b-vision-instruct';

/** Motivos em códigos, e o trecho da legenda como veio. */
export async function analisarItem(env: Env, tenantId: string, itemId: string) {
  const item = await env.DB.prepare("SELECT r2_miniatura, legenda FROM raiox_itens WHERE id = ? AND tenant_id = ? AND estado = 'pendente'")
    .bind(itemId, tenantId).first<{ r2_miniatura: string; legenda: string | null }>();
  if (!item) return;
  const obj = await env.MEDIA.get(item.r2_miniatura);
  if (!obj) return gravar(env, tenantId, itemId, 'ilegivel', []);
  const bytes = new Uint8Array(await obj.arrayBuffer());
  const out = await env.AI.run(MODELO_RAIOX, { prompt: PROMPT_RAIOX, image: [...bytes], max_tokens: 60, temperature: 0 }) as { response?: unknown };
  const visao = lerVisao(out.response);
  const legenda = marcasNaLegenda(item.legenda ?? '').map((m) => `legenda:${m}`);
  const motivos = [...(visao ?? []), ...legenda];
  return gravar(env, tenantId, itemId, motivos.length ? 'marcado' : visao ? 'limpo' : 'ilegivel', motivos);
}

const gravar = (env: Env, tenantId: string, itemId: string, estado: string, motivos: string[]) =>
  env.DB.prepare("UPDATE raiox_itens SET estado = ?, motivos_json = ? WHERE id = ? AND tenant_id = ? AND estado = 'pendente'")
    .bind(estado, JSON.stringify(motivos), itemId, tenantId).run().then(() => undefined);

/** Tentativas esgotadas: "não deu para ler", e o resto do lote segue. */
export const encerrarItem = (env: Env, tenantId: string, itemId: string) => gravar(env, tenantId, itemId, 'ilegivel', []);

export async function apagarRaioX(env: Env, tenantId: string, loteId: string): Promise<boolean> {
  const lote = await env.DB.prepare('SELECT id FROM raiox_lotes WHERE id = ? AND tenant_id = ?').bind(loteId, tenantId).first();
  if (!lote) return false;
  for (;;) {
    const { results } = await env.DB.prepare('SELECT id, r2_miniatura FROM raiox_itens WHERE lote_id = ? AND tenant_id = ? LIMIT 500').bind(loteId, tenantId).all<{ id: string; r2_miniatura: string }>();
    if (!results.length) break;
    await env.MEDIA.delete(results.map((r) => r.r2_miniatura));
    await env.DB.batch(results.map((r) => env.DB.prepare('DELETE FROM raiox_itens WHERE id = ? AND tenant_id = ?').bind(r.id, tenantId)));
  }
  await env.DB.prepare('DELETE FROM raiox_lotes WHERE id = ? AND tenant_id = ?').bind(loteId, tenantId).run();
  return true;
}
