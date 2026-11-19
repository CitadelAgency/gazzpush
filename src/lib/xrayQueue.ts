// X-ray on the server: reads each thumbnail with the vision model and flags what looks like third-party media. The app
// deletes nothing and does not suggest deleting: the owner decides.
import type { Env } from '../env';
import { readVision, marksInCaption, PROMPT_XRAY } from './xray';

export const XRAY_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';

/** Reasons as codes, and the caption passage as it came. */
export async function analyzeItem(env: Env, tenantId: string, itemId: string) {
  const item = await env.DB.prepare("SELECT r2_miniatura, legenda FROM raiox_itens WHERE id = ? AND tenant_id = ? AND estado = 'pendente'")
    .bind(itemId, tenantId).first<{ r2_miniatura: string; legenda: string | null }>();
  if (!item) return;
  const obj = await env.MEDIA.get(item.r2_miniatura);
  if (!obj) return record(env, tenantId, itemId, 'ilegivel', []);
  const bytes = new Uint8Array(await obj.arrayBuffer());
  const out = await env.AI.run(XRAY_MODEL, { prompt: PROMPT_XRAY, image: [...bytes], max_tokens: 60, temperature: 0 }) as { response?: unknown };
  const vision = readVision(out.response);
  const caption = marksInCaption(item.legenda ?? '').map((m) => `legenda:${m}`);
  const reasons = [...(vision ?? []), ...caption];
  return record(env, tenantId, itemId, reasons.length ? 'marcado' : vision ? 'limpo' : 'ilegivel', reasons);
}

const record = (env: Env, tenantId: string, itemId: string, state: string, reasons: string[]) =>
  env.DB.prepare("UPDATE raiox_itens SET estado = ?, motivos_json = ? WHERE id = ? AND tenant_id = ? AND estado = 'pendente'")
    .bind(state, JSON.stringify(reasons), itemId, tenantId).run().then(() => undefined);

/** Attempts used up: "não deu para ler" ("couldn't read it"), and the rest of the batch goes on. */
export const closeItem = (env: Env, tenantId: string, itemId: string) => record(env, tenantId, itemId, 'ilegivel', []);

export async function deleteRayX(env: Env, tenantId: string, batchId: string): Promise<boolean> {
  const batch = await env.DB.prepare('SELECT id FROM raiox_lotes WHERE id = ? AND tenant_id = ?').bind(batchId, tenantId).first();
  if (!batch) return false;
  for (;;) {
    const { results } = await env.DB.prepare('SELECT id, r2_miniatura FROM raiox_itens WHERE lote_id = ? AND tenant_id = ? LIMIT 500').bind(batchId, tenantId).all<{ id: string; r2_miniatura: string }>();
    if (!results.length) break;
    await env.MEDIA.delete(results.map((r) => r.r2_miniatura));
    await env.DB.batch(results.map((r) => env.DB.prepare('DELETE FROM raiox_itens WHERE id = ? AND tenant_id = ?').bind(r.id, tenantId)));
  }
  await env.DB.prepare('DELETE FROM raiox_lotes WHERE id = ? AND tenant_id = ?').bind(batchId, tenantId).run();
  return true;
}
