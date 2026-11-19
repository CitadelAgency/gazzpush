// Checked fit: only shortens, only with that sentence's fact; an option that invents or does not fit goes away; nothing is stored.
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fromAdjustmentTarget, checkOptions, type AdjustmentTarget } from '../src/lib/adjust';
import { loadLead, type Lead } from '../src/lib/lead';
import { closingCaption, type Draft } from '../src/lib/drafting';
import { register, req, seedMember, seedTenant } from './helpers';

const SENTENCE = 'A Prefeitura do Guarujá interditou a ponte da Enseada por 15 dias para obras de recuperação';
let model: unknown = {};

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ choices: [{ message: { content: JSON.stringify(model) } }], usage: { prompt_tokens: 100, completion_tokens: 50 } }));
});
afterEach(() => vi.restoreAllMocks());

async function scenario(o: { papel?: 'admin' | 'editor' | 'reporter'; status?: string; frases?: Draft['cards'][number]['frases']; layout?: 'texto' | 'citacao'; custo?: number } = {}) {
  const t = await seedTenant();
  const s = await register();
  await seedMember(t, s.userId, o.papel ?? 'editor');
  const [leadId, doc, fact, other, id] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO fontes (id, tenant_id, tipo, nome) VALUES (?, ?, 'manual', 'Teste')").bind(`${t}:f`, t),
    env.DB.prepare("INSERT INTO documentos (id, tenant_id, fonte_id, url, hash_texto, status) VALUES (?, ?, ?, ?, ?, 'triado')").bind(doc, t, `${t}:f`, `https://a.example/${doc}`, doc),
    env.DB.prepare("INSERT INTO fatos (id, tenant_id, documento_id, tipo, texto, hash) VALUES (?, ?, ?, 'manchete', ?, ?)").bind(fact, t, doc, SENTENCE, fact),
    env.DB.prepare("INSERT INTO fatos (id, tenant_id, documento_id, tipo, texto, hash) VALUES (?, ?, ?, 'trecho', 'O outro fato fala de 27 bombeiros', ?)").bind(other, t, doc, other),
    env.DB.prepare("INSERT INTO pautas (id, tenant_id, status, origem, titulo, fato_ids_json, documento_ids_json, score) VALUES (?, ?, 'em_producao', 'manual', 'Ponte', ?, ?, 1)").bind(leadId, t, JSON.stringify([fact, other]), JSON.stringify([doc])),
  ]);
  const lead = await loadLead(env, t, leadId);
  const content: Draft = {
    manchete: 'Ponte interditada', resumo: '', modelo: 'ia', custoUsd: 0, legenda: `Ponte.${closingCaption(lead)}`,
    cards: [
      { id: 'c1', layout: 'capa', titulo: 'Ponte interditada', frases: [] },
      { id: 'c2', layout: o.layout ?? 'texto', titulo: 'Ponte da Enseada interditada', frases: o.frases ?? [{ texto: SENTENCE, fatoId: fact }] },
      { id: 'k', layout: 'convite', titulo: 'Siga', frases: [{ texto: 'Siga a página', fatoId: null }] },
    ],
  };
  await env.DB.prepare(`INSERT INTO pecas (id, tenant_id, pauta_id, formato, status, versao, custo_usd, conteudo_json, validacao_json, arte_r2_keys_json, workflow_id)
                        VALUES (?, ?, ?, 'carrossel', ?, 3, ?, ?, '{"ok":true,"erros":[],"avisos":[]}', '[]', ?)`)
    .bind(id, t, leadId, o.status ?? 'revisao', o.custo ?? 0, JSON.stringify(content), `${id}-r1`).run();
  const request = (body: Record<string, unknown>, cookie = s.cookie, tt = t) => req(`/api/t/${tt}/pecas/${id}/ajuste`, { cookie, body: { versao: 3, cardId: 'c2', frase: 0, ...body } });
  return { t, s, id, fato: fact, outro: other, pauta: lead, conteudo: content, pedir: request };
}

describe('fromAdjustmentTarget', () => {
  it('excluded: CTA, quote and the author line', async () => {
    const c = await scenario();
    expect(fromAdjustmentTarget(c.pauta, c.conteudo, 'k', null)).toBe('fora');
    const citation: Draft = { ...c.conteudo, cards: [{ id: 'q', layout: 'citacao', titulo: 'Prefeito', frases: [{ texto: SENTENCE, fatoId: c.fato }] }] };
    expect(fromAdjustmentTarget(c.pauta, citation, 'q', 0)).toBe('fora');
    const author: Draft = { ...c.conteudo, cards: [{ id: 'a', layout: 'texto', titulo: 'T', frases: [{ texto: 'Minha', fatoId: null, autor: true }] }] };
    expect(fromAdjustmentTarget(c.pauta, author, 'a', 0)).toBe('fora');
    expect(fromAdjustmentTarget(c.pauta, c.conteudo, 'nada', 0)).toBe('nao_encontrado');
    expect(fromAdjustmentTarget(c.pauta, c.conteudo, 'c2', 9)).toBe('nao_encontrado');
  });

  it('the sentence carries only its own fact', async () => {
    const c = await scenario();
    expect(fromAdjustmentTarget(c.pauta, c.conteudo, 'c2', 0)).toMatchObject({ indice: 0, fatos: [SENTENCE] });
  });

  it('the headline carries the facts cited in the card; card without a sentence, the ones from the lead', async () => {
    const c = await scenario();
    expect(fromAdjustmentTarget(c.pauta, c.conteudo, 'c2', null)).toMatchObject({ indice: null, fatos: [SENTENCE] });
    expect((fromAdjustmentTarget(c.pauta, c.conteudo, 'c1', null) as AdjustmentTarget).fatos).toHaveLength(2);
  });
});

describe('checkOptions', () => {
  it('only the shortest ones, that fit, with no number outside the fact', async () => {
    const c = await scenario();
    const a = fromAdjustmentTarget(c.pauta, c.conteudo, 'c2', 0) as AdjustmentTarget;
    const short = 'Prefeitura interditou a ponte da Enseada por 15 dias';
    expect(checkOptions(c.pauta, c.conteudo, 'carrossel', a, { opcoes: [short, 'Ponte fecha por 9871 dias'] })).toEqual({ opcoes: [short], reprovadas: 1 });
    expect(checkOptions(c.pauta, c.conteudo, 'carrossel', a, { opcoes: [`${SENTENCE} e mais texto`, short, short] }).opcoes).toEqual([short]);
    expect(checkOptions(c.pauta, c.conteudo, 'carrossel', a, { opcoes: 'x' })).toEqual({ opcoes: [], reprovadas: 0 });
  });
});

describe('POST ajuste', () => {
  it("returns the options, adds the cost and doesn't store the text", async () => {
    const c = await scenario();
    model = { opcoes: ['Prefeitura interditou a ponte por 15 dias', 'Ponte da Enseada fica interditada por 15 dias'] };
    const r = await c.pedir({});
    expect(r.status).toBe(200);
    const j = await r.json<{ opcoes: string[]; custoUsd: number }>();
    expect(j.opcoes).toHaveLength(2);
    expect(j.custoUsd).toBeGreaterThan(0);
    const row = await env.DB.prepare('SELECT conteudo_json, versao, custo_usd FROM pecas WHERE id = ?').bind(c.id).first<{ conteudo_json: string; versao: number; custo_usd: number }>();
    expect(row).toMatchObject({ conteudo_json: JSON.stringify(c.conteudo), versao: 3 });
    expect(row!.custo_usd).toBeCloseTo(j.custoUsd);
    const body = String(vi.mocked(globalThis.fetch).mock.calls[0][1]?.body);
    expect(body).toContain('SHORTEN TO FIT.');
    expect(body).not.toContain('27 bombeiros');
    // With the real model, "quatro" became "4" and every option fell at the check; "parcialmente" disappeared.
    expect(body).toContain('never becomes');
    expect(body).toContain('parcialmente');
  });

  it('refuses out of place: CTA, old version, published piece, cap, reporter, another outlet', async () => {
    const c = await scenario();
    expect((await c.pedir({ cardId: 'k', frase: null })).status).toBe(400);
    expect((await c.pedir({ cardId: 'zzz' })).status).toBe(404);
    expect((await c.pedir({ versao: 2 })).status).toBe(409);
    expect((await c.pedir({ versao: 'x' })).status).toBe(400);
    expect((await (await scenario({ status: 'publicada' })).pedir({})).status).toBe(409);
    expect((await (await scenario({ custo: 99 })).pedir({})).status).toBe(409);
    expect((await (await scenario({ papel: 'reporter' })).pedir({})).status).toBe(403);
    const other = await scenario();
    expect((await c.pedir({}, other.s.cookie, other.t)).status).toBe(404);
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });
});
