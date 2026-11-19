// The Story (handoffs/2026-11-02-materia-e-editor-investigativo.md): the carousel inherits the evidence. "Send to
// Instagram" builds the lead with facts from the checked claims; an unsourced sentence does not go in; an open legal
// risk gates with the list. Pages and DeepSeek are a simulated fetch (.example domains).
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadLead } from '../src/lib/lead';
import { fromTextLink } from '../src/lib/drafting';
import { StoryError, leadStory } from '../src/lib/story';
import { register, req, seedMember } from './helpers';

export const SOURCE = 'https://camara.example/relatorio-transporte';
const sourceBody = 'A Câmara aprovou em 2025 a renovação de 12 contratos de ônibus sem licitação, segundo o relatório da comissão de transporte. ' +
  'O documento lista as empresas e os valores pagos em cada um dos contratos renovados nos últimos três anos, com as datas das votações.';
const htmlSource = `<html><head><title>Relatório da comissão de transporte</title></head><body><article><h1>Relatório da comissão</h1><p>${sourceBody}</p></article></body></html>`;
export const TEXT = [
  'Contratos sem concorrência',
  'A Câmara renovou 12 contratos de ônibus sem licitação em 2025.',
  'O vereador Fulano de Tal desviou dinheiro dos contratos.',
  'A cidade gasta mais com transporte do que com saúde.',
].join('\n');

let deepseekAnswer: () => object;
beforeEach(() => {
  deepseekAnswer = () => ({ afirmacoes: [] });
  const original = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('deepseek')) return Response.json({ choices: [{ message: { content: JSON.stringify(deepseekAnswer()) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    if (url === SOURCE) return new Response(htmlSource, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    if (url.includes('.example')) return new Response('não achei', { status: 404 });
    return original(input, init);
  });
});
afterEach(() => vi.restoreAllMocks());

async function tenantAuthor() {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO tenants (id, slug, nome, modo, marca_json, plano) VALUES (?, ?, 'Cartas da Orla', 'autoral', ?, 'cortesia')")
    .bind(id, `m-${id.slice(0, 8)}`, JSON.stringify({ nome: 'Cartas da Orla', assinatura: 'Ana Ribeiro', ctaUrl: 'https://autora.substack.example' })).run();
  return id;
}

/** A pasted text, one evidence item in the dossier and the check with the given marks. */
async function checkedStory(marks: (ev: string) => object) {
  const s = await register();
  const t = await tenantAuthor();
  await seedMember(t, s.userId, 'admin');
  const { texto: text } = await (await req(`/api/t/${t}/textos`, { cookie: s.cookie, body: { texto: TEXT } })).json<{ texto: { id: string } }>();
  const { evidenciaId: evidenceId } = await (await req(`/api/t/${t}/textos/${text.id}/evidencias`, { cookie: s.cookie, body: { url: SOURCE } })).json<{ evidenciaId: string }>();
  deepseekAnswer = () => marks(evidenceId);
  expect((await req(`/api/t/${t}/textos/${text.id}/conferir`, { cookie: s.cookie, body: {} })).status).toBe(200);
  return { s, t, id: text.id, evidenciaId: evidenceId };
}

const withEvidence = (ev: string) => ({ paragrafo: 0, trecho: 'A Câmara renovou 12 contratos de ônibus sem licitação em 2025.', estado: 'com_evidencia', risco: null,
  evidencia: ev, trecho_evidencia: 'A Câmara aprovou em 2025 a renovação de 12 contratos de ônibus sem licitação', explicacao: 'O relatório traz o número.' });
const withoutSource = { paragrafo: 2, trecho: 'A cidade gasta mais com transporte do que com saúde.', estado: 'sem_fonte', risco: null, evidencia: null, trecho_evidencia: null, explicacao: 'Nada no dossiê.' };
const risk = { paragrafo: 1, trecho: 'O vereador Fulano de Tal desviou dinheiro dos contratos.', estado: 'risco', risco: 'acusacao_sem_condenacao', evidencia: null, trecho_evidencia: null, explicacao: 'Acusa sem condenação.' };

/** A fake production Workflow: keeps the instances (real production is covered in flow.test.ts). */
function envWithoutProduction() {
  const created: string[] = [];
  const wf = { create: async ({ id }: { id: string }) => { created.push(id); return { id }; }, get: async (id: string) => ({ id, status: async () => ({ status: 'running' }) }) };
  return { env: { ...env, PRODUCAO_WORKFLOW: wf as unknown as typeof env.PRODUCAO_WORKFLOW }, criadas: created };
}

describe('Send to Instagram (Story)', () => {
  it("the lead's facts come from claims with evidence; a sentence without a source doesn't get in; the text link is not evidence", async () => {
    const { t, s, id, evidenciaId: evidenceId } = await checkedStory((ev) => ({ afirmacoes: [withEvidence(ev), withoutSource] }));
    const { env: e, criadas: created } = envWithoutProduction();
    const r = await leadStory(e, t, id, s.userId);
    expect(r.situacao).toBe('nova');
    expect(r.pecaId).toBeTruthy();
    expect(created).toHaveLength(1);

    const lead = await loadLead(env, t, r.pautaId);
    expect(lead.fatos).toHaveLength(1);
    expect(lead.fatos[0]).toMatchObject({
      tipo: 'afirmacao', texto: 'A Câmara renovou 12 contratos de ônibus sem licitação em 2025.', fonteUrl: SOURCE,
      evidenciaTrecho: 'A Câmara aprovou em 2025 a renovação de 12 contratos de ônibus sem licitação',
    });
    expect(lead.fatos.map((f) => f.texto)).not.toContain(withoutSource.trecho);
    // The carousel's call to action leads to the author's text (brand), never to the evidence's page.
    expect(fromTextLink(lead)).toBe('https://autora.substack.example');
    const on = await env.DB.prepare('SELECT texto_id, texto_versao FROM pautas WHERE id = ?').bind(r.pautaId).first<{ texto_id: string; texto_versao: number }>();
    expect(on).toEqual({ texto_id: id, texto_versao: 1 });
    const fact = await env.DB.prepare('SELECT evidencia_id FROM fatos WHERE id = ?').bind(lead.fatos[0].id).first<{ evidencia_id: string }>();
    expect(fact?.evidencia_id).toBe(evidenceId);

    // Review receives, per fact, the evidence's passage and the page's title.
    const piece = await (await req(`/api/t/${t}/pecas/${r.pecaId}`, { cookie: s.cookie })).json<{ fatos: Record<string, unknown>[] }>();
    expect(piece.fatos).toEqual([expect.objectContaining({ texto: lead.fatos[0].texto, url: SOURCE, evidencia: lead.fatos[0].evidenciaTrecho, fonteTitulo: 'Relatório da comissão' })]);

    // The same version again: the same lead, without creating another.
    const from = await leadStory(e, t, id, s.userId);
    expect(from).toMatchObject({ pautaId: r.pautaId, pecaId: r.pecaId, situacao: 'existente' });

    // Posts tab: the lead's piece tied to the text.
    const posts = await (await req(`/api/t/${t}/textos/${id}/posts`, { cookie: s.cookie })).json<{ posts: { id: string; formato: string; status: string }[] }>();
    expect(posts.posts).toEqual([expect.objectContaining({ id: r.pecaId, formato: 'carrossel', status: 'rascunho' })]);
  });

  it("open legal risk: 409 from the checklist with the list of what's missing, and nothing is created", async () => {
    const { t, s, id } = await checkedStory((ev) => ({ afirmacoes: [withEvidence(ev), risk] }));
    const res = await req(`/api/t/${t}/textos/${id}/instagram`, { cookie: s.cookie, body: {} });
    expect(res.status).toBe(409);
    const b = await res.json<{ code: string; pendencias: { trecho: string; risco: string }[] }>();
    expect(b.code).toBe('checklist');
    expect(b.pendencias).toEqual([expect.objectContaining({ trecho: risk.trecho, risco: 'acusacao_sem_condenacao' })]);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM pautas WHERE tenant_id = ?').bind(t).first('n')).toBe(0);
  });

  it('no claim with evidence: 422; unchecked paragraph: 409 from the checklist', async () => {
    const { t, s, id } = await checkedStory(() => ({ afirmacoes: [withoutSource] }));
    await expect(leadStory(env, t, id, s.userId)).rejects.toMatchObject({ codigo: 'sem_fatos', status: 422 });
    await env.DB.prepare("UPDATE blocos SET estado = 'nao_conferido', erro = 'modelo fora' WHERE texto_id = ? AND bloco_id = 'p1'").bind(id).run();
    const err = await leadStory(env, t, id, s.userId).catch((x) => x);
    expect(err).toBeInstanceOf(StoryError);
    expect(err).toMatchObject({ codigo: 'checklist', status: 409, pendencias: [expect.objectContaining({ tipo: 'paragrafo', blocoId: 'p1', explicacao: 'modelo fora' })] });
  });

  it("IDOR: posts and sending of one outlet can't reach another outlet's text; reporter doesn't send", async () => {
    const { t, id } = await checkedStory((ev) => ({ afirmacoes: [withEvidence(ev)] }));
    const other = await register();
    const t2 = await tenantAuthor();
    await seedMember(t2, other.userId, 'admin');
    expect((await req(`/api/t/${t2}/textos/${id}/posts`, { cookie: other.cookie })).status).toBe(404);
    expect((await req(`/api/t/${t2}/textos/${id}/instagram`, { cookie: other.cookie, body: {} })).status).toBe(404);
    expect((await req(`/api/t/${t}/textos/${id}/posts`, { cookie: other.cookie })).status).toBe(404);
    const reporter = await register();
    await seedMember(t, reporter.userId, 'reporter');
    expect((await req(`/api/t/${t}/textos/${id}/posts`, { cookie: reporter.cookie })).status).toBe(200);
    expect((await req(`/api/t/${t}/textos/${id}/instagram`, { cookie: reporter.cookie, body: {} })).status).toBe(403);
  });
});

// ── review (Codex, 03/11): the lead is the version's and the reporting's; a failure restarts; double send; many facts ────────

describe("review: the Story's lead", () => {
  it('reporting changed in the same version (sentence became opinion): sending builds another lead; the earlier one stays', async () => {
    const { t, s, id } = await checkedStory((ev) => ({ afirmacoes: [withEvidence(ev), withoutSource] }));
    const { env: e } = envWithoutProduction();
    const a = await leadStory(e, t, id, s.userId);
    const state = await (await req(`/api/t/${t}/textos/${id}`, { cookie: s.cookie })).json<{ afirmacoes: { id: string; trecho: string }[] }>();
    const sf = state.afirmacoes.find((x) => x.trecho === withoutSource.trecho)!;
    expect((await req(`/api/t/${t}/textos/${id}/apuracoes`, { cookie: s.cookie, body: { afirmacaoId: sf.id, tipo: 'opiniao' } })).status).toBe(201);
    const b = await leadStory(e, t, id, s.userId);
    expect(b.situacao).toBe('nova');
    expect(b.pautaId).not.toBe(a.pautaId);
    expect((await loadLead(env, t, b.pautaId)).fatos.map((f) => f.tipo).sort()).toEqual(['afirmacao', 'opiniao']);
    expect((await loadLead(env, t, a.pautaId)).fatos.map((f) => f.tipo)).toEqual(['afirmacao']);
  });

  it('evidence removed from the dossier after the post: its saved text stays in storage (the post relies on it)', async () => {
    const { t, s, id, evidenciaId: evidenceId } = await checkedStory((ev) => ({ afirmacoes: [withEvidence(ev)] }));
    const { env: e } = envWithoutProduction();
    await leadStory(e, t, id, s.userId);
    const { r2_texto: r2_text } = (await env.DB.prepare('SELECT r2_texto FROM evidencias WHERE id = ?').bind(evidenceId).first<{ r2_texto: string }>())!;
    expect((await req(`/api/t/${t}/textos/${id}/evidencias/${evidenceId}`, { cookie: s.cookie, method: 'DELETE' })).status).toBe(200);
    expect(await env.MEDIA.head(r2_text)).not.toBeNull();
    // Without the source, the sentence no longer goes to the carousel.
    await expect(leadStory(e, t, id, s.userId)).rejects.toMatchObject({ codigo: 'sem_fatos' });
  });

  it('production failed (lead back to aceita): sending again starts another production', async () => {
    const { t, s, id } = await checkedStory((ev) => ({ afirmacoes: [withEvidence(ev)] }));
    const { env: e, criadas: created } = envWithoutProduction();
    const a = await leadStory(e, t, id, s.userId);
    await env.DB.batch([
      env.DB.prepare("UPDATE pecas SET status = 'falhou' WHERE id = ?").bind(a.pecaId),
      env.DB.prepare("UPDATE pautas SET status = 'aceita' WHERE id = ?").bind(a.pautaId),
    ]);
    const b = await leadStory(e, t, id, s.userId);
    expect(b).toMatchObject({ pautaId: a.pautaId, situacao: 'existente' });
    expect(b.pecaId).not.toBe(a.pecaId);
    expect(created).toHaveLength(2);
  });

  it('two sends at the same time: one lead only', async () => {
    const { t, s, id } = await checkedStory((ev) => ({ afirmacoes: [withEvidence(ev)] }));
    const { env: e } = envWithoutProduction();
    const [a, b] = await Promise.all([leadStory(e, t, id, s.userId), leadStory(e, t, id, s.userId)]);
    expect(a.pautaId).toBe(b.pautaId);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM pautas WHERE texto_id = ?').bind(id).first('n')).toBe(1);
  });

  it('card "Como apuramos" with the page live from another version: 409, publish the current one', async () => {
    const { t, s, id } = await checkedStory((ev) => ({ afirmacoes: [withEvidence(ev)] }));
    await env.DB.prepare("INSERT INTO paginas_fontes (id, tenant_id, texto_id, versao, conteudo_json, por) VALUES (?, ?, ?, 0, '{}', ?)").bind(crypto.randomUUID(), t, id, s.userId).run();
    await expect(leadStory(envWithoutProduction().env, t, id, s.userId, { cardFontes: true })).rejects.toMatchObject({ codigo: 'pagina_antiga', status: 409 });
  });

  it('lead with more than 100 facts loads (the list goes as a single parameter)', async () => {
    const t = await tenantAuthor();
    const doc = crypto.randomUUID();
    const facts = Array.from({ length: 120 }, () => crypto.randomUUID());
    await env.DB.batch([
      env.DB.prepare("INSERT INTO documentos (id, tenant_id, url, hash_texto, status, triagem) VALUES (?, ?, 'https://fonte.example/a', ?, 'triado', 'autoral')").bind(doc, t, `h-${doc}`),
      ...facts.map((f, i) => env.DB.prepare("INSERT INTO fatos (id, tenant_id, documento_id, tipo, texto, hash, confianca) VALUES (?, ?, ?, 'afirmacao', ?, ?, 1)").bind(f, t, doc, `Fato número ${i}.`, `h-${f}`)),
      env.DB.prepare("INSERT INTO pautas (id, tenant_id, status, origem, titulo, fato_ids_json, documento_ids_json, score) VALUES (?, ?, 'sugerida', 'manual', 'Muitos fatos', ?, ?, 1)")
        .bind(`p-${doc}`, t, JSON.stringify(facts), JSON.stringify([doc])),
    ]);
    expect((await loadLead(env, t, `p-${doc}`)).fatos).toHaveLength(120);
  });
});

// ── review 2 (Codex, 03/11): a lead created before the key (migration 0016) ───────────────────────────────────────────

describe('review 2: old lead', () => {
  it('lead with the same version and the same facts, created before the key: is reused (no new production)', async () => {
    const { t, s, id } = await checkedStory((ev) => ({ afirmacoes: [withEvidence(ev)] }));
    const { env: e, criadas: created } = envWithoutProduction();
    const a = await leadStory(e, t, id, s.userId);
    await env.DB.prepare('UPDATE pautas SET materia_chave = NULL WHERE id = ?').bind(a.pautaId).run();   // as it was after the migration
    const b = await leadStory(e, t, id, s.userId);
    expect(b).toMatchObject({ pautaId: a.pautaId, situacao: 'existente' });
    expect(created).toHaveLength(1);
  });

  it('old lead with other facts (the reporting changed): stays as it is, and sending builds another', async () => {
    const { t, s, id } = await checkedStory((ev) => ({ afirmacoes: [withEvidence(ev), withoutSource] }));
    const { env: e } = envWithoutProduction();
    const a = await leadStory(e, t, id, s.userId);
    await env.DB.prepare('UPDATE pautas SET materia_chave = NULL WHERE id = ?').bind(a.pautaId).run();
    const state = await (await req(`/api/t/${t}/textos/${id}`, { cookie: s.cookie })).json<{ afirmacoes: { id: string; trecho: string }[] }>();
    const sf = state.afirmacoes.find((x) => x.trecho === withoutSource.trecho)!;
    expect((await req(`/api/t/${t}/textos/${id}/apuracoes`, { cookie: s.cookie, body: { afirmacaoId: sf.id, tipo: 'opiniao' } })).status).toBe(201);
    const b = await leadStory(e, t, id, s.userId);
    expect(b.situacao).toBe('nova');
    expect(b.pautaId).not.toBe(a.pautaId);
    expect(await env.DB.prepare('SELECT materia_chave FROM pautas WHERE id = ?').bind(a.pautaId).first('materia_chave')).toBeNull();
  });
});
