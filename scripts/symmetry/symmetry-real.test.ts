// Symmetry battery with the real model (it costs calls: `npm run symmetry`, outside `npm test`). For each pair of sides,
// the same text with the side swapped is checked by the whole pipeline (checkBlocks) and the marks per paragraph
// (state and category) must be equal. Prints the cost of each check (3 blocks).
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { checkBlocks } from '../../src/lib/desk';
import { EVIDENCE, PARAGRAPHS, PAIRS, anonymize, fill } from '../../test/symmetry-cases';

const costs: number[] = [];

async function side(tenantId: string, author: string, a: string, b: string) {
  const id = crypto.randomUUID();
  const ev = `ev${id.slice(0, 6)}`;
  await env.MEDIA.put(`evidencias/${tenantId}/${ev}.txt`, fill(EVIDENCE, a, b));
  await env.DB.batch([
    env.DB.prepare("INSERT INTO textos (id, tenant_id, titulo, paragrafos_json, origem, autor) VALUES (?, ?, 'Contratos', ?, 'colado', ?)")
      .bind(id, tenantId, JSON.stringify(PARAGRAPHS.map((p) => fill(p, a, b))), author),
    env.DB.prepare("INSERT INTO evidencias (id, tenant_id, texto_id, url, titulo, r2_texto, hash) VALUES (?, ?, ?, 'https://camara.example/r', 'Relatório', ?, 'h')")
      .bind(ev, tenantId, id, `evidencias/${tenantId}/${ev}.txt`),
  ]);
  const r = await checkBlocks(env, tenantId, id);
  costs.push(r.custoUsd);
  expect(r.falhas, 'algum bloco ficou sem conferir').toBe(0);
  const { results } = await env.DB.prepare('SELECT paragrafo, estado, risco, trecho FROM afirmacoes WHERE texto_id = ? ORDER BY paragrafo, inicio').bind(id).all<{ paragrafo: number; estado: string; risco: string | null; trecho: string }>();
  return results.map((m) => `${m.paragrafo}:${m.estado}:${m.risco ?? '-'}`).sort().join(' | ') + `  (${results.map((m) => anonymize(m.trecho, a, b)).join(' / ')})`;
}

describe('symmetry with the real model', () => {
  it.each(PAIRS)('$tema', async ({ a, b }) => {
    const tenantId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO tenants (id, slug, nome, modo) VALUES (?, ?, 'Simetria', 'autoral')").bind(tenantId, `s-${tenantId.slice(0, 8)}`).run();
    const author = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, 'Simetria', ?, 0, datetime('now'), datetime('now'))`).bind(author, `${author}@simetria.example`).run();
    const one = await side(tenantId, author, a, b);
    const other = await side(tenantId, author, b, a);
    console.log(`${a} × ${b}\n  ${one}\n  ${other}`);
    expect(other.split('  (')[0]).toBe(one.split('  (')[0]);
  });

  it('cost per check', () => {
    const media = costs.reduce((s, c) => s + c, 0) / Math.max(1, costs.length);
    console.log(`average cost per 3-paragraph check: US$ ${media.toFixed(5)} (${costs.length} checks)`);
  });
});
