// Phase 2: the outlet's site becomes a queue. An old item does not become a piece; outside the area and opinion do;
// semantic dedupe skipped; a daily cap; redelivery without a duplicate piece; author mode unchanged. Fake article fetch, model and Workflow.
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as dedupe from '../src/lib/dedupe';
import * as produceModule from '../src/lib/produce';
import { DeskError } from '../src/lib/desk';
import { fromOwnSource, MAX_AUTO_DAY, triageDocument } from '../src/lib/triage';
import { register, req, seedMember, seedTenant } from './helpers';

const SINCE = '2026-11-01T00:00:00.000Z';
const NEW = '2026-11-02T10:00:00.000Z';
const OLD = '2026-10-20T10:00:00.000Z';

function html(title: string, published: string | null) {
  const meta = published ? `<meta property="article:published_time" content="${published}">` : '';
  return `<!doctype html><html><head><title>${title}</title>${meta}<meta property="og:title" content="${title}"></head><body><article><h1>${title}</h1>
    ${Array.from({ length: 6 }, (_, i) => `<p>${title}: parágrafo ${i} com bastante texto para passar da régua mínima de extração da matéria, contando o que aconteceu, onde e quando.</p>`).join('')}
    </article></body></html>`;
}

const triage = (o: Record<string, unknown> = {}) => ({ tipo: 'acontecimento', tipo_span: 0, editoria: 'cidade', editoria_span: 0, ocorreu_em: null, data_span: null, locais: [], ...o });
let model = triage();
let production: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  model = triage();
  vi.spyOn(env.AI, 'run').mockImplementation((async () => ({ response: model })) as never);
  production = vi.spyOn(produceModule, 'produceLead').mockResolvedValue({ pecaId: 'p', workflowId: 'w', pendente: false });
});
afterEach(() => vi.restoreAllMocks());

async function scenario(o: { propria?: string | null; modo?: string } = {}) {
  const t = await seedTenant();
  if (o.modo) await env.DB.prepare('UPDATE tenants SET modo = ? WHERE id = ?').bind(o.modo, t).run();
  const source = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO fontes (id, tenant_id, tipo, nome, url, propria_desde) VALUES (?, ?, 'rss', 'Site', ?, ?)").bind(source, t, `https://site.example/${source}/feed`, o.propria === undefined ? SINCE : o.propria).run();
  return { t, fonte: source };
}

async function documentOf(c: { t: string; fonte: string }, title: string, published: string | null) {
  const id = crypto.randomUUID();
  const url = `https://site.example/${id}`;
  await env.DB.prepare("INSERT INTO documentos (id, tenant_id, fonte_id, url, hash_texto, status) VALUES (?, ?, ?, ?, ?, 'novo')").bind(id, c.t, c.fonte, url, `feed:${id}`).run();
  vi.spyOn(globalThis, 'fetch').mockImplementation((async () => new Response(html(title, published), { headers: { 'content-type': 'text/html; charset=utf-8' } })) as never);
  return id;
}

const leads = async (t: string) => (await env.DB.prepare('SELECT id, origem, titulo, status, fato_ids_json FROM pautas WHERE tenant_id = ?').bind(t).all<{ id: string; origem: string; titulo: string; status: string; fato_ids_json: string }>()).results;

describe('fromOwnSource', () => {
  it("only with both dates, and the item's date after the marker", () => {
    expect(fromOwnSource(SINCE, NEW)).toBe(true);
    expect(fromOwnSource(SINCE, OLD)).toBe(false);
    expect(fromOwnSource(SINCE, null)).toBe(false);
    expect(fromOwnSource(null, NEW)).toBe(false);
  });
});

describe('triage of the own-site source', () => {
  it('new story becomes a site lead, with the body as facts, and goes to production', async () => {
    const c = await scenario();
    await triageDocument(env, c.t, await documentOf(c, 'Festival de verão em Santos', NEW));
    const [p] = await leads(c.t);
    expect(p).toMatchObject({ origem: 'site', titulo: 'Festival de verão em Santos' });
    expect(JSON.parse(p.fato_ids_json).length).toBeGreaterThan(3);
    expect(production).toHaveBeenCalledWith(env, c.t, p.id, 'sistema', 'carrossel');
  });

  it("at the plan limit, the lead stays in Ideas and triage doesn't fail", async () => {
    const c = await scenario();
    production.mockRejectedValue(new DeskError('limite_plano', 'limite', 402));
    await expect(triageDocument(env, c.t, await documentOf(c, 'Festival de verão em Santos', NEW))).resolves.not.toThrow();
    expect((await leads(c.t))[0]).toMatchObject({ origem: 'site', status: 'sugerida' });
  });

  it("old feed item doesn't become a piece: outside the area, it's discarded as always", async () => {
    const c = await scenario();
    await triageDocument(env, c.t, await documentOf(c, 'Festival do ano passado', OLD));
    expect(await leads(c.t)).toEqual([]);
    expect(production).not.toHaveBeenCalled();
  });

  it('item without a date follows the normal path', async () => {
    const c = await scenario();
    await triageDocument(env, c.t, await documentOf(c, 'Sem data nenhuma', null));
    expect(await leads(c.t)).toEqual([]);
  });

  it("the site's own opinion becomes a lead", async () => {
    const c = await scenario();
    model = triage({ tipo: 'opiniao' });
    await triageDocument(env, c.t, await documentOf(c, 'Editorial sobre a ponte', NEW));
    expect((await leads(c.t)).map((p) => p.origem)).toEqual(['site']);
  });

  it('skips the semantic dedupe; a common source still goes through it', async () => {
    const almost = vi.spyOn(dedupe, 'dedupeSemantic').mockResolvedValue({ duplicadoDe: 'outro', score: 0.99 } as never);
    const c = await scenario();
    await triageDocument(env, c.t, await documentOf(c, 'Matéria que parece cópia', NEW));
    expect(almost).not.toHaveBeenCalled();
    expect(await leads(c.t)).toHaveLength(1);
    const common = await scenario({ propria: null });
    await triageDocument(env, common.t, await documentOf(common, 'Matéria de outro site', NEW));
    expect(almost).toHaveBeenCalledTimes(1);
    expect(await leads(common.t)).toEqual([]);
  });

  it('exact dedupe still applies', async () => {
    const c = await scenario();
    const text = 'Mesma matéria em dois endereços';
    await triageDocument(env, c.t, await documentOf(c, text, NEW));
    await triageDocument(env, c.t, await documentOf(c, text, NEW));
    expect(await leads(c.t)).toHaveLength(1);
  });

  it('daily cap: passed, the lead stays in Ideas, no loss', async () => {
    const c = await scenario();
    const stmts = Array.from({ length: MAX_AUTO_DAY }, () => {
      const [pa, pc] = [crypto.randomUUID(), crypto.randomUUID()];
      return [
        env.DB.prepare("INSERT INTO pautas (id, tenant_id, status, origem, titulo, fato_ids_json, documento_ids_json, score) VALUES (?, ?, 'em_producao', 'site', 'x', '[]', '[]', 1)").bind(pa, c.t),
        env.DB.prepare("INSERT INTO pecas (id, tenant_id, pauta_id, formato, status, workflow_id) VALUES (?, ?, ?, 'carrossel', 'revisao', ?)").bind(pc, c.t, pa, pc),
      ];
    }).flat();
    await env.DB.batch(stmts);
    await triageDocument(env, c.t, await documentOf(c, 'Passou do teto', NEW));
    expect(production).not.toHaveBeenCalled();
    expect((await leads(c.t)).find((p) => p.titulo === 'Passou do teto')).toMatchObject({ status: 'sugerida', origem: 'site' });
  });

  it("queue redelivery doesn't duplicate the piece", async () => {
    const c = await scenario();
    const id = await documentOf(c, 'Entregue duas vezes', NEW);
    await triageDocument(env, c.t, id);
    await triageDocument(env, c.t, id);
    expect(await leads(c.t)).toHaveLength(1);
    expect(production).toHaveBeenCalledTimes(1);
  });

  it('author outlet stays unchanged', async () => {
    const c = await scenario({ modo: 'autoral' });
    await triageDocument(env, c.t, await documentOf(c, 'Ensaio do autor', NEW));
    expect((await leads(c.t)).map((p) => p.origem)).toEqual(['monitor']);
    expect(production).not.toHaveBeenCalled();
  });
});

describe('route', () => {
  async function admin(role: 'admin' | 'editor' = 'admin', mode?: string) {
    const c = await scenario({ propria: null, modo: mode });
    const s = await register();
    await seedMember(c.t, s.userId, role);
    return { ...c, s };
  }
  const mark = (a: { t: string; fonte: string; s: { cookie: string } }, own: boolean, source = a.fonte, t = a.t) =>
    req(`/api/t/${t}/fontes/${source}`, { cookie: a.s.cookie, method: 'PATCH', body: { propria: own } });

  it('marks and unmarks, and the GET returns the state', async () => {
    const a = await admin();
    expect((await mark(a, true)).status).toBe(200);
    const list = async () => (await (await req(`/api/t/${a.t}/fontes`, { cookie: a.s.cookie })).json<{ fontes: { id: string; propria: boolean }[] }>()).fontes.find((f) => f.id === a.fonte);
    expect(await list()).toMatchObject({ propria: true });
    const row = await env.DB.prepare('SELECT propria_desde FROM fontes WHERE id = ?').bind(a.fonte).first<{ propria_desde: string }>();
    expect(Date.now() - Date.parse(row!.propria_desde)).toBeLessThan(60_000);
    await mark(a, false);
    expect(await list()).toMatchObject({ propria: false });
  });

  it("admin only; author refuses; another outlet's source gives 404", async () => {
    expect((await mark(await admin('editor'), true)).status).toBe(403);
    expect((await mark(await admin('admin', 'autoral'), true)).status).toBe(400);
    const a = await admin();
    const b = await admin();
    expect((await mark(a, true, b.fonte)).status).toBe(404);
  });
});
