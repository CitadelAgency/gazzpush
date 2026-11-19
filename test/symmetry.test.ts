// The symmetry battery with recorded answers (the real-model one is scripts/symmetry/symmetry-real.test.ts, which costs
// a call): for each pair of sides (government and opposition, parties, religions, gender, race, police and social
// movement, rural), the same text with the side swapped goes through the whole pipeline (prompt, call, literal passage,
// storage) and must come out with the same marks, categories and degree, and the request to the model must be the same
// with the names swapped.
import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkBlocks } from '../src/lib/desk';
import { EVIDENCE, PARAGRAPHS, PAIRS, ANSWERS, anonymize, fill } from './symmetry-cases';
import { register } from './helpers';

afterEach(() => vi.restoreAllMocks());

async function side(tenantId: string, author: string, a: string, b: string) {
  const id = crypto.randomUUID();
  const ps = PARAGRAPHS.map((p) => fill(p, a, b));
  const ev = `ev-${id.slice(0, 8)}`;
  await env.MEDIA.put(`evidencias/${tenantId}/${ev}.txt`, fill(EVIDENCE, a, b));
  await env.DB.batch([
    env.DB.prepare("INSERT INTO textos (id, tenant_id, titulo, paragrafos_json, origem, autor) VALUES (?, ?, 'Contratos', ?, 'colado', ?)").bind(id, tenantId, JSON.stringify(ps), author),
    env.DB.prepare("INSERT INTO evidencias (id, tenant_id, texto_id, url, titulo, r2_texto, hash) VALUES (?, ?, ?, 'https://camara.example/r', 'Relatório', ?, 'h')")
      .bind(ev, tenantId, id, `evidencias/${tenantId}/${ev}.txt`),
  ]);
  const requests: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_i, init) => {
    const user = JSON.parse(String(init?.body)).messages[1].content as string;
    requests.push(anonymize(user.replaceAll(ev, 'ev'), a, b));
    const n = ps.findIndex((p) => user.endsWith(`[P0] ${p}`));
    // Each text field filled on its own (capitalising the start of a sentence applies per field).
    const answer = (ANSWERS[n] ?? []).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) =>
      [k, k === 'evidencia' && v ? ev : typeof v === 'string' ? fill(v, a, b) : v])));
    return Response.json({ choices: [{ message: { content: JSON.stringify({ afirmacoes: answer }) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
  });
  await checkBlocks(env, tenantId, id);
  vi.restoreAllMocks();
  const { results } = await env.DB.prepare('SELECT paragrafo, trecho, estado, risco, evidencia_trecho, inicio, fim FROM afirmacoes WHERE texto_id = ? ORDER BY paragrafo, inicio').bind(id).all<Record<string, unknown>>();
  return {
    marcas: results.map((r): Record<string, unknown> => ({ ...r, trecho: anonymize(String(r.trecho), a, b), evidencia_trecho: r.evidencia_trecho ? anonymize(String(r.evidencia_trecho), a, b) : null, inicio: undefined, fim: undefined })),
    pedidos: requests.sort(),
  };
}

describe('check symmetry', () => {
  it.each(PAIRS)('$tema: sides swapped, same marks, categories and degree; the request to the model is the same', async ({ a, b }) => {
    const tenantId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO tenants (id, slug, nome, modo, plano) VALUES (?, ?, 'Simetria', 'autoral', 'cortesia')").bind(tenantId, `s-${tenantId.slice(0, 8)}`).run();
    const { userId } = await register();
    const one = await side(tenantId, userId, a, b);
    const other = await side(tenantId, userId, b, a);
    expect(one.marcas.map((m) => [m.paragrafo, m.estado, m.risco])).toEqual([[0, 'risco', 'acusacao_sem_condenacao'], [1, 'com_evidencia', null]]);
    expect(other.marcas).toEqual(one.marcas);
    expect(other.pedidos).toEqual(one.pedidos);
  });
});
