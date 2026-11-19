// Semantic dedupe in triage: fake in-memory embedding and Vectorize (AI and Vectorize only exist remotely). The same
// news rewritten becomes a single idea; different texts, two; an index failure does not bring triage down.
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dedupe, THRESHOLD_SEMANTIC, similarity, type DedupeIndex } from '../src/lib/dedupe';
import { triageDocument } from '../src/lib/triage';
import { eventsOf, seedTenant } from './helpers';

const body = (text: string) => `<html><head><meta property="og:title" content="${text.split('.')[0]}">
<script type="application/ld+json">${JSON.stringify({ '@type': 'NewsArticle', articleBody: text })}</script></head><body><p>${text}</p></body></html>`;
const BRIDGE = 'A Prefeitura de Guarujá interdita a ponte da Avenida Santos Dumont a partir de segunda-feira para obras de recuperação. ' +
  'As obras duram quinze dias, segundo a Secretaria de Obras, e o desvio recomendado aos motoristas é pela Avenida Puglisi, no bairro Enseada.';
const BRIDGE_REWRITE = BRIDGE.replace('segundo a Secretaria de Obras', 'informou a Secretaria de Obras');
const DAY = 'A feira livre de quinta-feira muda para a Rua Montenegro a partir desta semana, informou a Prefeitura de Guarujá. ' +
  'Segundo a Secretaria de Abastecimento, a mudança atende pedido dos moradores e vale por tempo indeterminado, com barracas desde as 5h.';
const TRIAGE = { tipo: 'acontecimento', tipo_span: 0, editoria: 'cidade', editoria_span: 0, ocorreu_em: null, data_span: null, locais: [] };

let pages: Record<string, string> = {};
let vectors: { id: string; namespace: string; values: number[]; metadata: Record<string, unknown> }[] = [];
let failIndex = false;

// A hashed bag of words in 1024 dimensions, normalised: almost identical text → cosine close to 1.
function fakeEmbed(text: string): number[] {
  const v = new Array(1024).fill(0);
  for (const w of text.toLowerCase().match(/[\p{L}\d]+/gu) ?? []) {
    let h = 0;
    for (const c of w) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    v[h % 1024] += 1;
  }
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}
const cos = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const fakeIndex: DedupeIndex = {
  query: (async (vector: number[], o: { topK: number; namespace: string }) => {
    if (failIndex) throw new Error('vectorize fora do ar');
    const matches = vectors.filter((v) => v.namespace === o.namespace).map((v) => ({ id: v.id, score: cos(vector, v.values), metadata: v.metadata }))
      .sort((a, b) => b.score - a.score).slice(0, o.topK);
    return { matches, count: matches.length };
  }) as never,
  upsert: (async (vs: typeof vectors) => {
    for (const v of vs) { vectors = vectors.filter((x) => !(x.id === v.id && x.namespace === v.namespace)); vectors.push(v); }
    return { ids: vs.map((v) => v.id), count: vs.length };
  }) as never,
};

beforeEach(() => {
  pages = {};
  vectors = [];
  failIndex = false;
  vi.spyOn(dedupe, 'embutir').mockImplementation(async (_env, text) => fakeEmbed(text));
  vi.spyOn(dedupe, 'indice').mockImplementation(() => fakeIndex);
  vi.spyOn(env.AI, 'run').mockImplementation((async () => ({ response: TRIAGE })) as never);
  const original = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url in pages) return new Response(body(pages[url]), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    return original(input, init);
  });
});
afterEach(() => vi.restoreAllMocks());

// A topical outlet without topics accepts all news: each triaged document becomes an idea.
async function outlet() {
  const t = await seedTenant();
  await env.DB.prepare("UPDATE tenants SET modo = 'tematico' WHERE id = ?").bind(t).run();
  return t;
}
async function documentOf(t: string, url: string, text: string) {
  pages[url] = text;
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO documentos (id, tenant_id, url, hash_texto) VALUES (?, ?, ?, ?)').bind(id, t, url, `url:${id}`).run();
  await triageDocument(env, t, id);
  return id;
}
const doc = (id: string) => env.DB.prepare('SELECT status, triagem, triagem_json FROM documentos WHERE id = ?').bind(id).first<{ status: string; triagem: string | null; triagem_json: string }>();
const npautas = async (t: string) => (await env.DB.prepare('SELECT COUNT(*) AS n FROM pautas WHERE tenant_id = ?').bind(t).first<{ n: number }>())!.n;

describe('semantic dedupe', () => {
  it('the same news rewritten on another site: the second is discarded as a semantic duplicate; one idea only', async () => {
    const t = await outlet();
    const a = await documentOf(t, 'https://g1.example.com/ponte', BRIDGE);
    const b = await documentOf(t, 'https://tribuna.example.com/ponte', BRIDGE_REWRITE);
    expect((await doc(a))?.status).toBe('triado');
    const db = await doc(b);
    expect(db).toMatchObject({ status: 'descartado', triagem: 'duplicado' });
    expect(JSON.parse(db!.triagem_json)).toMatchObject({ duplicadoDe: a, semantico: true });
    expect(await npautas(t)).toBe(1);
    const ev = JSON.stringify(await eventsOf(b));
    expect(ev).toMatch(new RegExp(`duplicado semântico de ${a} \\(0,9\\d\\)`));
    // Only the first went to the index, in the outlet's namespace, with the combined metadata.
    expect(vectors.map((v) => [v.id, v.namespace])).toEqual([[a, t]]);
    expect(vectors[0].metadata).toMatchObject({ tenantId: t, documentoId: a, criadoEm: expect.any(String) });
    // The triage model was not paid for the duplicate.
    expect(vi.mocked(env.AI.run).mock.calls).toHaveLength(1);
  });

  it('different texts: both triaged, two ideas, two vectors', async () => {
    const t = await outlet();
    const a = await documentOf(t, 'https://g1.example.com/ponte', BRIDGE);
    const b = await documentOf(t, 'https://g1.example.com/feira', DAY);
    expect([(await doc(a))?.status, (await doc(b))?.status]).toEqual(['triado', 'triado']);
    expect(await npautas(t)).toBe(2);
    expect(vectors.map((v) => v.id).sort()).toEqual([a, b].sort());
    expect(cos(fakeEmbed(BRIDGE), fakeEmbed(DAY))).toBeLessThan(THRESHOLD_SEMANTIC);
  });

  it("old neighbour (more than 3 days) or discarded doesn't count; another outlet doesn't either", async () => {
    const t = await outlet();
    const a = await documentOf(t, 'https://g1.example.com/ponte', BRIDGE);
    await env.DB.prepare("UPDATE documentos SET capturado_em = datetime('now', '-4 days') WHERE id = ?").bind(a).run();
    await env.DB.prepare("UPDATE pautas SET created_at = datetime('now', '-4 days') WHERE tenant_id = ?").bind(t).run();
    const b = await documentOf(t, 'https://tribuna.example.com/ponte', BRIDGE_REWRITE);
    expect((await doc(b))?.status).toBe('triado');
    const other = await outlet();
    const c = await documentOf(other, 'https://g1.example.com/ponte-2', BRIDGE);
    expect((await doc(c))?.status).toBe('triado');
  });

  it("discarded idea doesn't hold the new news; recently triaged document without a safe idea", async () => {
    const t = await outlet();
    const a = await documentOf(t, 'https://g1.example.com/ponte', BRIDGE);
    await env.DB.prepare("UPDATE pautas SET status = 'descartada' WHERE tenant_id = ?").bind(t).run();
    // Still triaged and recent: it holds.
    const b = await documentOf(t, 'https://tribuna.example.com/ponte', BRIDGE_REWRITE);
    expect((await doc(b))?.status).toBe('descartado');
    // A discarded document and a discarded lead: it no longer holds.
    await env.DB.prepare("UPDATE documentos SET status = 'descartado' WHERE id = ?").bind(a).run();
    const c = await documentOf(t, 'https://outro.example.com/ponte', BRIDGE.replace('quinze dias', '15 dias'));
    expect((await doc(c))?.status).toBe('triado');
  });

  it('Vectorize (or embedding) failure: triage goes on without semantic dedupe and records dedupe.falha', async () => {
    const t = await outlet();
    failIndex = true;
    const a = await documentOf(t, 'https://g1.example.com/ponte', BRIDGE);
    expect((await doc(a))?.status).toBe('triado');
    expect(await npautas(t)).toBe(1);
    const ev = await eventsOf(a);
    expect(ev.find((e) => e.tipo === 'dedupe.falha')?.payload).toEqual({ erro: expect.stringContaining('vectorize fora do ar') });
    vi.mocked(dedupe.embutir).mockRejectedValueOnce(new Error('AI 5xx'));
    failIndex = false;
    const b = await documentOf(t, 'https://g1.example.com/feira', DAY);
    expect((await doc(b))?.status).toBe('triado');
    expect((await eventsOf(b)).some((e) => e.tipo === 'dedupe.falha')).toBe(true);
  });

  it('similarity in the reason: two decimal places, comma, without rounding up', () => {
    expect(similarity(0.9271)).toBe('0,92');
    expect(similarity(0.999)).toBe('0,99');
  });
});
