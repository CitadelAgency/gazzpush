// Phase 3 (handoffs/2026-11-02-materia-e-editor-investigativo.md): the assistant in the editor. The card's actions
// record reporting (they never write text) and survive a re-check; attaching a source requires a literal passage; the
// checklist gates without the editor's signature; the second opinion disagrees → "uncertain"; topic routing; code
// findings; style guide, audit and IDOR on every new route. DeepSeek, Anthropic and pages are a simulated fetch.
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BATCH_CHECK, combineOpinions, checkBlocks } from '../src/lib/desk';
import { OTHER_SIDE, quotesBlock } from '../src/lib/reporting';
import { cleanDoc } from '../src/lib/doc';
import { todayIso, addDays } from '../src/lib/lai';
import { loadLead } from '../src/lib/lead';
import { leadStory } from '../src/lib/story';
import { register, req, seedMember } from './helpers';

const SOURCE = 'https://camara.example/relatorio';
const OTHER = 'https://jornal.example/materia';
const sourceBody = 'A Câmara aprovou em 2025 a renovação de 12 contratos de ônibus sem licitação, segundo o relatório da comissão. ' +
  'O presidente da comissão declarou: "Não houve irregularidade nas renovações aprovadas". O documento lista as empresas.';
const html = (title: string, body: string) => `<html><head><title>${title}</title></head><body><article><h1>${title}</h1><p>${body}</p></article></body></html>`;
const TEXT = [
  'Contratos sem concorrência',
  'A Câmara renovou 12 contratos de ônibus sem licitação em 2025.',
  'O vereador Luís Souza desviou dinheiro dos contratos.',
  'O gasto foi de R$ 10 milhões para R$ 15 milhões, alta de 40%.',
  'Segundo a comissão, "Não houve irregularidade nas renovações aprovadas". Mas ele disse: "nunca vi esse dinheiro na vida".',
].join('\n');

type Item = Record<string, unknown>;
let deepseek: (block: string) => Item[];
let anthropic: ((block: string) => Item[]) | 'fora';
const calls = { deepseek: 0, anthropic: 0 };

beforeEach(() => {
  deepseek = () => [];
  anthropic = () => [];
  calls.deepseek = 0; calls.anthropic = 0;
  const original = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    if (url.includes('deepseek')) {
      calls.deepseek++;
      const user: string = body.messages[1].content;
      const block = user.slice(user.lastIndexOf('[P0] ') + 5);
      return Response.json({ choices: [{ message: { content: JSON.stringify({ afirmacoes: deepseek(block) }) } }], usage: { prompt_tokens: 1000, completion_tokens: 100, prompt_cache_hit_tokens: 800 } });
    }
    if (url.startsWith('https://anthropic.example')) {
      calls.anthropic++;
      if (anthropic === 'fora') return new Response('{"type":"error","error":{"type":"overloaded_error","message":"x"}}', { status: 529 });
      const blockText: string = body.messages[0].content[1].text;
      const block = blockText.slice(blockText.lastIndexOf('[P0] ') + 5);
      return Response.json({
        id: 'msg_1', type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn', stop_sequence: null,
        content: [{ type: 'text', text: JSON.stringify({ afirmacoes: anthropic(block) }) }],
        usage: { input_tokens: 200, output_tokens: 300, cache_read_input_tokens: 800, cache_creation_input_tokens: 0 },
      });
    }
    if (url === SOURCE) return new Response(html('Relatório da comissão', sourceBody), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    if (url === OTHER) return new Response(html('Matéria do jornal', `Segundo camara.example/relatorio, ${sourceBody}`), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    if (url.includes('.example')) return new Response('não achei', { status: 404 });
    return original(input, init);
  });
});
afterEach(() => vi.restoreAllMocks());

const P = TEXT.split('\n');
const brand = (passage: string, state: string, extra: Item = {}): Item => ({ paragrafo: 0, trecho: passage, estado: state, risco: null, evidencia: null, trecho_evidencia: null, explicacao: 'x', ...extra });
const ACCUSATION = brand(P[2], 'risco', { risco: 'acusacao_sem_condenacao', explicacao: 'Acusa sem condenação.' });
const WITHOUT_SOURCE = brand(P[1], 'sem_fonte');

async function tenantAuthor() {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO tenants (id, slug, nome, modo, marca_json, plano) VALUES (?, ?, 'Cartas', 'autoral', ?, 'cortesia')")
    .bind(id, `a-${id.slice(0, 8)}`, JSON.stringify({ nome: 'Cartas', ctaUrl: 'https://autora.substack.example' })).run();
  return id;
}

async function story(marks: (block: string) => Item[] = (b) => (b === P[2] ? [ACCUSATION] : b === P[1] ? [WITHOUT_SOURCE] : [])) {
  const s = await register();
  const t = await tenantAuthor();
  await seedMember(t, s.userId, 'admin');
  const { texto: text } = await (await req(`/api/t/${t}/textos`, { cookie: s.cookie, body: { texto: TEXT } })).json<{ texto: { id: string } }>();
  const { evidenciaId: evidenceId } = await (await req(`/api/t/${t}/textos/${text.id}/evidencias`, { cookie: s.cookie, body: { url: SOURCE } })).json<{ evidenciaId: string }>();
  deepseek = marks;
  expect((await req(`/api/t/${t}/textos/${text.id}/conferir`, { cookie: s.cookie, body: {} })).status).toBe(200);
  return { s, t, id: text.id, ev: evidenceId };
}

interface State {
  texto: { versao: number };
  afirmacoes: { id: string; trecho: string; estado: string; aberta: boolean; incerto: boolean; apuracao: { id: string; tipo: string; porNome: string | null; outroLado: unknown } | null }[];
  apontamentos: { tipo: string; trecho: string; explicacao: string }[];
  pessoas: { nome: string; acusada: boolean; outroLado: { quem: string } | null; grafias: string[] }[];
  evidencias: { id: string; tipoFonte: string | null; tipoSugerido: string | null; forca: string }[];
  circulares: { de: string; para: string; motivo: string }[];
  fonteUnica: string | null;
  checklist: { pendencias: { tipo: string; trecho: string }[]; assinatura: { por: string | null } | null };
  segunda: { ligada: boolean };
  blocos: { id: string; opinioes: number; fornecedor: string | null; aviso: string | null }[];
}
const read = async (t: string, id: string, cookie: string) => (await req(`/api/t/${t}/textos/${id}`, { cookie })).json<State>();
const claim = (e: State, passage: string) => e.afirmacoes.find((a) => a.trecho === passage)!;

describe('card actions', () => {
  it('pinning a source requires a literal excerpt from the source; closes the mark, survives re-checking; undoing reopens it', async () => {
    const { s, t, id, ev } = await story();
    const a = claim(await read(t, id, s.cookie), P[1]);
    expect(a.aberta).toBe(true);

    const outside = await req(`/api/t/${t}/textos/${id}/apuracoes`, { cookie: s.cookie, body: { afirmacaoId: a.id, tipo: 'fonte', evidenciaId: ev, evidenciaTrecho: 'A Câmara renovou 12 contratos' } });
    expect(outside.status).toBe(422);
    expect((await outside.json<{ code: string }>()).code).toBe('trecho_fora');

    const ok = await req(`/api/t/${t}/textos/${id}/apuracoes`, { cookie: s.cookie, body: { afirmacaoId: a.id, tipo: 'fonte', evidenciaId: ev, evidenciaTrecho: 'renovação de 12 contratos de ônibus  sem licitação' } });
    expect(ok.status).toBe(201);
    const e1 = await ok.json<State & { apuracaoId: string }>();
    expect(claim(e1, P[1])).toMatchObject({ aberta: false, apuracao: { tipo: 'fonte', porNome: 'Pessoa' } });

    // The model checks the same sentence again: the reporting still counts.
    expect((await req(`/api/t/${t}/textos/${id}/conferir`, { cookie: s.cookie, body: { todos: true } })).status).toBe(200);
    const e2 = await read(t, id, s.cookie);
    expect(claim(e2, P[1])).toMatchObject({ aberta: false, apuracao: { id: e1.apuracaoId } });

    const des = await req(`/api/t/${t}/textos/${id}/apuracoes/${e1.apuracaoId}`, { cookie: s.cookie, method: 'DELETE' });
    expect(des.status).toBe(200);
    expect(claim(await des.json<State>(), P[1])).toMatchObject({ aberta: true, apuracao: null });
    const r = await env.DB.prepare('SELECT desfeita_em, desfeita_por FROM apuracoes WHERE id = ?').bind(e1.apuracaoId).first<{ desfeita_em: string; desfeita_por: string }>();
    expect(r?.desfeita_por).toBe(s.userId);
  });

  it('other side: only for accusations, with who, when and how; appears on the accused person', async () => {
    const { s, t, id } = await story();
    const e = await read(t, id, s.cookie);
    expect(e.pessoas.find((p) => p.nome === 'Luís Souza')).toMatchObject({ acusada: true, outroLado: null });
    const without = claim(e, P[1]);
    expect((await req(`/api/t/${t}/textos/${id}/apuracoes`, { cookie: s.cookie, body: { afirmacaoId: without.id, tipo: 'outro_lado', quem: 'Assessoria', quando: '2026-11-01', meio: 'email' } })).status).toBe(422);
    const acc = claim(e, P[2]);
    expect((await req(`/api/t/${t}/textos/${id}/apuracoes`, { cookie: s.cookie, body: { afirmacaoId: acc.id, tipo: 'outro_lado', quem: 'Luís Souza', quando: '2999-01-01', meio: 'email' } })).status).toBe(400);
    expect((await req(`/api/t/${t}/textos/${id}/apuracoes`, { cookie: s.cookie, body: { afirmacaoId: acc.id, tipo: 'outro_lado', quem: 'Luís Souza', quando: '2026-11-01', meio: 'pombo' } })).status).toBe(400);
    const ok = await (await req(`/api/t/${t}/textos/${id}/apuracoes`, { cookie: s.cookie, body: { afirmacaoId: acc.id, tipo: 'outro_lado', quem: 'Luís Souza', quando: '2026-11-01', meio: 'telefone' } })).json<State>();
    expect(claim(ok, P[2]).aberta).toBe(false);
    expect(ok.pessoas.find((p) => p.nome === 'Luís Souza')).toMatchObject({ acusada: true, outroLado: { quem: 'Luís Souza', quando: '2026-11-01', meio: 'telefone' } });
    expect(ok.checklist.pendencias.filter((p) => p.tipo === 'risco')).toEqual([]);
  });

  it('opinion becomes "afirmação minha" in the carousel; pinned source becomes a fact with the evidence of the person; ignored stays out', async () => {
    const { s, t, id, ev } = await story((b) => (b === P[2] ? [ACCUSATION] : b === P[1] ? [WITHOUT_SOURCE] : b === P[3] ? [brand('O gasto foi de R$ 10 milhões para R$ 15 milhões', 'sem_fonte')] : []));
    const e = await read(t, id, s.cookie);
    const ap = (body: Item) => req(`/api/t/${t}/textos/${id}/apuracoes`, { cookie: s.cookie, body });
    expect((await ap({ afirmacaoId: claim(e, P[1]).id, tipo: 'fonte', evidenciaId: ev, evidenciaTrecho: 'renovação de 12 contratos de ônibus sem licitação' })).status).toBe(201);
    expect((await ap({ afirmacaoId: claim(e, P[2]).id, tipo: 'ignorar' })).status).toBe(201);
    expect((await ap({ afirmacaoId: claim(e, 'O gasto foi de R$ 10 milhões para R$ 15 milhões').id, tipo: 'opiniao' })).status).toBe(201);
    // The arithmetic (40% instead of 50%) and the unsourced quote stay in the checklist: the editor signs.
    const before = await read(t, id, s.cookie);
    expect(before.checklist.pendencias.map((p) => p.tipo).sort()).toEqual(['aspa', 'conta']);
    expect((await req(`/api/t/${t}/textos/${id}/instagram`, { cookie: s.cookie, body: {} })).status).toBe(409);
    expect((await req(`/api/t/${t}/textos/${id}/assinar`, { cookie: s.cookie, body: { versao: before.texto.versao } })).status).toBe(201);

    const created: string[] = [];
    const wf = { create: async ({ id: x }: { id: string }) => { created.push(x); return { id: x }; }, get: async (x: string) => ({ id: x, status: async () => ({ status: 'running' }) }) };
    const r = await leadStory({ ...env, PRODUCAO_WORKFLOW: wf as unknown as typeof env.PRODUCAO_WORKFLOW }, t, id, s.userId);
    const lead = await loadLead(env, t, r.pautaId);
    expect(lead.fatos.map((f) => [f.tipo, f.texto, f.fonteUrl, f.evidenciaTrecho ?? null])).toEqual(expect.arrayContaining([
      ['afirmacao', P[1], SOURCE, 'renovação de 12 contratos de ônibus sem licitação'],
      ['opiniao', 'O gasto foi de R$ 10 milhões para R$ 15 milhões', 'https://autora.substack.example', null],
    ]));
    expect(lead.fatos.map((f) => f.texto)).not.toContain(P[2]);
    const signed = await env.DB.prepare('SELECT por, pendencias_json FROM assinaturas WHERE texto_id = ?').bind(id).first<{ por: string; pendencias_json: string }>();
    expect(signed?.por).toBe(s.userId);
    expect(JSON.parse(signed!.pendencias_json)).toHaveLength(2);
  });

  it('sign-off applies only to the signed version', async () => {
    const { s, t, id } = await story();
    const e = await read(t, id, s.cookie);
    expect((await req(`/api/t/${t}/textos/${id}/assinar`, { cookie: s.cookie, body: { versao: e.texto.versao + 1 } })).status).toBe(409);
    expect((await req(`/api/t/${t}/textos/${id}/assinar`, { cookie: s.cookie, body: { versao: e.texto.versao } })).status).toBe(201);
    expect((await read(t, id, s.cookie)).checklist.assinatura).toMatchObject({ por: 'Pessoa' });
    const doc = { type: 'doc', content: P.slice(1).map((p, i) => ({ type: 'paragraph', attrs: { id: `p${i}` }, content: [{ type: 'text', text: i === 0 ? `${p} Mais.` : p }] })) };
    expect((await req(`/api/t/${t}/textos/${id}`, { cookie: s.cookie, method: 'PUT', body: { doc, versao: e.texto.versao } })).status).toBe(200);
    expect((await read(t, id, s.cookie)).checklist.assinatura).toBeNull();
  });
});

describe('notes by code, people and sources', () => {
  it("sum that doesn't add up, quote outside the dossier, style guide; source strength, single source and circular", async () => {
    const { s, t, id, ev } = await story((b) => (b === P[1] ? [brand(P[1], 'com_evidencia', { evidencia: 'X', trecho_evidencia: null })] : []));
    expect((await req(`/api/t/${t}/textos/manual`, { cookie: s.cookie, body: { tipo: 'grafia', procurar: 'vereador', preferir: 'parlamentar', nota: 'Teste.' } })).status).toBe(201);
    const e = await read(t, id, s.cookie);
    expect(e.apontamentos.map((a) => [a.tipo, a.trecho])).toEqual([
      ['manual', 'vereador'],
      ['conta', 'de R$ 10 milhões para R$ 15 milhões, alta de 40%'],
      ['aspa', '"nunca vi esse dinheiro na vida"'],
    ]);
    expect(e.apontamentos[1].explicacao).toBe('De 10.000.000 para 15.000.000 é alta de 50%, não de 40%.');
    expect(e.evidencias[0]).toMatchObject({ id: ev, tipoFonte: null, tipoSugerido: null, forca: 'sem_tipo' });
    const patch = await req(`/api/t/${t}/textos/${id}/evidencias/${ev}`, { cookie: s.cookie, method: 'PATCH', body: { tipoFonte: 'oficial' } });
    expect((await patch.json<State>()).evidencias[0]).toMatchObject({ tipoFonte: 'oficial', forca: 'forte' });
    expect((await req(`/api/t/${t}/textos/${id}/evidencias/${ev}`, { cookie: s.cookie, method: 'PATCH', body: { tipoFonte: 'partidaria' } })).status).toBe(400);

    const { evidenciaId: other } = await (await req(`/api/t/${t}/textos/${id}/evidencias`, { cookie: s.cookie, body: { url: OTHER } })).json<{ evidenciaId: string }>();
    const e2 = await read(t, id, s.cookie);
    expect(e2.circulares).toEqual([{ de: other, para: ev, motivo: 'cita' }]);
  });
});

describe('second opinion and topic drift', () => {
  const withSecond = () => ({ ...env, ANTHROPIC_API_KEY: 'sk-teste', SEGUNDA_URL: 'https://anthropic.example' });

  it('without the key: one opinion only, and the state says so', async () => {
    const { s, t, id } = await story();
    const e = await read(t, id, s.cookie);
    expect(e.segunda.ligada).toBe(false);
    expect(e.blocos.every((b) => b.opinioes === 1)).toBe(true);
    expect(calls.anthropic).toBe(0);
  });

  it('accusation gets a second opinion; disagreement becomes an "incerto" risk; excerpt not in the paragraph drops out', async () => {
    const { s, t, id } = await story();
    anthropic = (b) => (b === P[2] ? [brand(P[2], 'sem_fonte'), brand('trecho inventado que não existe', 'risco', { risco: 'acusacao_sem_condenacao' })] : []);
    calls.deepseek = 0;
    await checkBlocks(withSecond(), t, id, { todos: true });
    // Only the paragraphs with an accusation ("desviou", "irregularidade") went to the second opinion.
    expect(calls.anthropic).toBe(2);
    const e = await read(t, id, s.cookie);
    expect(claim(e, P[2])).toMatchObject({ estado: 'risco', incerto: true, aberta: true });
    expect(e.afirmacoes.some((a) => a.trecho === 'trecho inventado que não existe')).toBe(false);
    expect(e.blocos.find((b) => b.id === 'p1')).toMatchObject({ opinioes: 2, fornecedor: 'deepseek+anthropic', aviso: null });
    const h = await env.DB.prepare("SELECT temas_json, pessoas_json, incerto FROM marcas_historico WHERE texto_id = ? AND trecho = ? AND fornecedor = 'deepseek+anthropic'").bind(id, P[2]).first<{ temas_json: string; pessoas_json: string; incerto: number }>();
    expect(h).toEqual({ temas_json: '["politica"]', pessoas_json: '["Luís Souza"]', incerto: 1 });
  });

  it('second opinion down: the block stays checked with the one-opinion warning', async () => {
    const { s, t, id } = await story();
    anthropic = 'fora';
    await checkBlocks(withSecond(), t, id, { todos: true });
    const e = await read(t, id, s.cookie);
    expect(e.blocos.find((b) => b.id === 'p1')).toMatchObject({ opinioes: 1, fornecedor: 'deepseek', aviso: 'A segunda opinião não respondeu: este parágrafo teve uma opinião só.' });
    expect(claim(e, P[2]).incerto).toBe(false);
  });

  it('topic that Chinese models soften goes entirely to the other provider', async () => {
    const { s, t, id } = await story();
    const doc = { type: 'doc', content: [...P.slice(1), 'O governo chinês pressiona Taiwan.'].map((p, i) => ({ type: 'paragraph', attrs: { id: `p${i}` }, content: [{ type: 'text', text: p }] })) };
    const e0 = await read(t, id, s.cookie);
    expect((await req(`/api/t/${t}/textos/${id}`, { cookie: s.cookie, method: 'PUT', body: { doc, versao: e0.texto.versao } })).status).toBe(200);
    calls.deepseek = 0;
    anthropic = (b) => (b.includes('Taiwan') ? [brand('O governo chinês pressiona Taiwan.', 'sem_fonte')] : []);
    await checkBlocks(withSecond(), t, id, { todos: true });
    expect(calls.deepseek).toBe(0);
    const e = await read(t, id, s.cookie);
    expect(e.blocos.every((b) => b.fornecedor === 'anthropic')).toBe(true);
    expect(claim(e, 'O governo chinês pressiona Taiwan.').estado).toBe('sem_fonte');
  });
});

describe('style guide, audit and IDOR on the new routes', () => {
  it("style guide: editor registers, reporter reads and doesn't change, duplicate 409", async () => {
    const { s, t } = await story();
    const r = await req(`/api/t/${t}/textos/manual`, { cookie: s.cookie, body: { tipo: 'sigla', procurar: 'Pm', preferir: 'PM' } });
    expect(r.status).toBe(201);
    const { id: rule } = await r.json<{ id: string }>();
    expect((await req(`/api/t/${t}/textos/manual`, { cookie: s.cookie, body: { tipo: 'sigla', procurar: 'Pm', preferir: 'PM' } })).status).toBe(409);
    expect((await req(`/api/t/${t}/textos/manual`, { cookie: s.cookie, body: { tipo: 'cor', procurar: 'x' } })).status).toBe(400);
    const rep = await register();
    await seedMember(t, rep.userId, 'reporter');
    expect((await (await req(`/api/t/${t}/textos/manual`, { cookie: rep.cookie })).json<{ regras: unknown[] }>()).regras).toHaveLength(1);
    expect((await req(`/api/t/${t}/textos/manual`, { cookie: rep.cookie, body: { tipo: 'sigla', procurar: 'Pf' } })).status).toBe(403);
    expect((await req(`/api/t/${t}/textos/manual/${rule}`, { cookie: rep.cookie, method: 'DELETE' })).status).toBe(403);
    expect((await req(`/api/t/${t}/textos/manual/${rule}`, { cookie: s.cookie, method: 'DELETE' })).status).toBe(200);
  });

  it('audit: marks by topic and person, and the ignored ones with who', async () => {
    const { s, t, id } = await story();
    const e = await read(t, id, s.cookie);
    await req(`/api/t/${t}/textos/${id}/apuracoes`, { cookie: s.cookie, body: { afirmacaoId: claim(e, P[1]).id, tipo: 'ignorar' } });
    const a = await (await req(`/api/t/${t}/textos/auditoria`, { cookie: s.cookie })).json<{
      temas: { id: string; risco: number }[]; pessoas: { nome: string; risco: number }[]; ignoradas: { trecho: string; por: string }[]; meses: { risco: number }[];
    }>();
    expect(a.temas.find((x) => x.id === 'politica')?.risco).toBe(1);
    expect(a.pessoas).toEqual([expect.objectContaining({ nome: 'Luís Souza', risco: 1 })]);
    expect(a.ignoradas).toEqual([expect.objectContaining({ trecho: P[1], por: 'Pessoa' })]);
    expect(a.meses[0].risco).toBe(1);
  });

  it("IDOR: another outlet can't reach reporting, sources, sign-off, style guide or audit; reporter doesn't change", async () => {
    const { s, t, id, ev } = await story();
    const e = await read(t, id, s.cookie);
    const acc = claim(e, P[2]);
    const { apuracaoId: reportingId } = await (await req(`/api/t/${t}/textos/${id}/apuracoes`, { cookie: s.cookie, body: { afirmacaoId: acc.id, tipo: 'ignorar' } })).json<{ apuracaoId: string }>();
    const { id: rule } = await (await req(`/api/t/${t}/textos/manual`, { cookie: s.cookie, body: { tipo: 'grafia', procurar: 'presidenta', preferir: 'presidente' } })).json<{ id: string }>();

    const other = await register();
    const t2 = await tenantAuthor();
    await seedMember(t2, other.userId, 'admin');
    const c = other.cookie;
    expect((await req(`/api/t/${t2}/textos/${id}/apuracoes`, { cookie: c, body: { afirmacaoId: acc.id, tipo: 'ignorar' } })).status).toBe(404);
    expect((await req(`/api/t/${t2}/textos/${id}/apuracoes/${reportingId}`, { cookie: c, method: 'DELETE' })).status).toBe(404);
    expect((await req(`/api/t/${t2}/textos/${id}/evidencias/${ev}`, { cookie: c, method: 'PATCH', body: { tipoFonte: 'anonima' } })).status).toBe(404);
    expect((await req(`/api/t/${t2}/textos/${id}/assinar`, { cookie: c, body: { versao: e.texto.versao } })).status).toBe(404);
    expect((await req(`/api/t/${t2}/textos/manual/${rule}`, { cookie: c, method: 'DELETE' })).status).toBe(404);
    expect((await (await req(`/api/t/${t2}/textos/manual`, { cookie: c })).json<{ regras: unknown[] }>()).regras).toEqual([]);
    expect((await (await req(`/api/t/${t2}/textos/auditoria`, { cookie: c })).json<{ ignoradas: unknown[]; pessoas: unknown[] }>())).toMatchObject({ ignoradas: [], pessoas: [] });
    // Without being a member of the owning outlet: it does not even get there.
    expect((await req(`/api/t/${t}/textos/${id}/apuracoes`, { cookie: c, body: { afirmacaoId: acc.id, tipo: 'ignorar' } })).status).toBe(404);
    // A claim from another text through the right text: 404.
    const { s: s3, t: t3, id: id3 } = await story();
    expect((await req(`/api/t/${t3}/textos/${id3}/apuracoes`, { cookie: s3.cookie, body: { afirmacaoId: acc.id, tipo: 'ignorar' } })).status).toBe(404);
    // Evidence from another text when attaching a source: 404.
    const a3 = claim(await read(t3, id3, s3.cookie), P[1]);
    expect((await req(`/api/t/${t3}/textos/${id3}/apuracoes`, { cookie: s3.cookie, body: { afirmacaoId: a3.id, tipo: 'fonte', evidenciaId: ev, evidenciaTrecho: 'renovação de 12 contratos' } })).status).toBe(404);

    const rep = await register();
    await seedMember(t, rep.userId, 'reporter');
    expect((await req(`/api/t/${t}/textos/${id}/apuracoes`, { cookie: rep.cookie, body: { afirmacaoId: acc.id, tipo: 'ignorar' } })).status).toBe(403);
    expect((await req(`/api/t/${t}/textos/${id}/apuracoes/${reportingId}`, { cookie: rep.cookie, method: 'DELETE' })).status).toBe(403);
    expect((await req(`/api/t/${t}/textos/${id}/assinar`, { cookie: rep.cookie, body: { versao: e.texto.versao } })).status).toBe(403);
    expect((await req(`/api/t/${t}/textos/${id}/evidencias/${ev}`, { cookie: rep.cookie, method: 'PATCH', body: { tipoFonte: 'anonima' } })).status).toBe(403);
    expect((await req(`/api/t/${t}/textos/auditoria`, { cookie: rep.cookie })).status).toBe(200);
  });
});

// ── review (Codex, 03/11): the defects found in phases 2 and 3 ─────────────────────────────────────────────────

const docOf = (ps: string[]) => ({ type: 'doc', content: ps.map((p, i) => ({ type: 'paragraph', attrs: { id: `p${i}` }, content: p ? [{ type: 'text', text: p }] : [] })) });
const save = async (t: string, id: string, cookie: string, ps: string[]) => {
  const { texto: text } = await read(t, id, cookie);
  const r = await req(`/api/t/${t}/textos/${id}`, { cookie, method: 'PUT', body: { doc: docOf(ps), versao: text.versao } });
  expect(r.status).toBe(200);
  return r.json<Omit<State, 'blocos'> & { blocos: { id: string; estado: string; fornecedor: string | null }[] }>();
};

describe('review: sign-off, pinned source, other side and dates', () => {
  it('the sign-off covers only the pending items the editor saw; a new pending item in the same version needs another sign-off', async () => {
    const { s, t, id, ev } = await story();
    const e0 = await read(t, id, s.cookie);
    expect(e0.checklist.pendencias.map((p) => p.tipo).sort()).toEqual(['aspa', 'conta', 'risco']);
    expect((await req(`/api/t/${t}/textos/${id}/assinar`, { cookie: s.cookie, body: { versao: e0.texto.versao } })).status).toBe(201);
    expect((await read(t, id, s.cookie)).checklist.assinatura).not.toBeNull();
    // The source leaves the dossier: the commission's quote loses its evidence and becomes an open item nobody signed.
    expect((await req(`/api/t/${t}/textos/${id}/evidencias/${ev}`, { cookie: s.cookie, method: 'DELETE' })).status).toBe(200);
    const e1 = await read(t, id, s.cookie);
    expect(e1.texto.versao).toBe(e0.texto.versao);
    expect(e1.checklist.pendencias.filter((p) => p.tipo === 'aspa')).toHaveLength(2);
    expect(e1.checklist.assinatura).toBeNull();
    await expect(leadStory(env, t, id, s.userId)).rejects.toMatchObject({ codigo: 'checklist', status: 409 });
  });

  it('pinned source and evidence removed from the dossier: the reporting becomes undone (with who and when) and the mark reopens', async () => {
    const { s, t, id, ev } = await story();
    const a = claim(await read(t, id, s.cookie), P[1]);
    const pinned = await req(`/api/t/${t}/textos/${id}/apuracoes`, { cookie: s.cookie, body: { afirmacaoId: a.id, tipo: 'fonte', evidenciaId: ev, evidenciaTrecho: 'renovação de 12 contratos de ônibus sem licitação' } });
    expect(pinned.status).toBe(201);
    expect(claim(await read(t, id, s.cookie), P[1]).aberta).toBe(false);
    expect((await req(`/api/t/${t}/textos/${id}/evidencias/${ev}`, { cookie: s.cookie, method: 'DELETE' })).status).toBe(200);
    expect(claim(await read(t, id, s.cookie), P[1])).toMatchObject({ apuracao: null, aberta: true });
    const ap = await env.DB.prepare("SELECT evidencia_id, evidencia_trecho, desfeita_em, desfeita_por FROM apuracoes WHERE texto_id = ? AND tipo = 'fonte'").bind(id).first<Record<string, string | null>>();
    expect(ap).toMatchObject({ evidencia_id: null, evidencia_trecho: 'renovação de 12 contratos de ônibus sem licitação', desfeita_por: s.userId });
    expect(ap!.desfeita_em).toBeTruthy();
  });

  it("contact recorded in a sentence that accuses two people doesn't count for whoever wasn't contacted", async () => {
    const { s, t, id } = await story();
    const two = 'O vereador Luís Souza desviou dinheiro dos contratos com a vereadora Aurora Vale.';
    deepseek = (b) => (b === two ? [brand(two, 'risco', { risco: 'acusacao_sem_condenacao' })] : []);
    await save(t, id, s.cookie, [P[1], two, P[3], P[4]]);
    await req(`/api/t/${t}/textos/${id}/conferir`, { cookie: s.cookie, body: {} });
    const a = claim(await read(t, id, s.cookie), two);
    const contact = (who: string) => req(`/api/t/${t}/textos/${id}/apuracoes`, { cookie: s.cookie, body: { afirmacaoId: a.id, tipo: 'outro_lado', quem: who, quando: todayIso(), meio: 'email' } });
    expect((await contact('Assessoria da Câmara')).status).toBe(201);
    const p1 = (await read(t, id, s.cookie)).pessoas;
    expect(p1.filter((p) => p.acusada).map((p) => [p.nome, p.outroLado])).toEqual([['Luís Souza', null], ['Aurora Vale', null]]);
    expect((await contact('Luís Souza')).status).toBe(201);
    const p2 = (await read(t, id, s.cookie)).pessoas;
    expect(p2.find((p) => p.nome === 'Luís Souza')!.outroLado).toMatchObject({ quem: 'Luís Souza' });
    expect(p2.find((p) => p.nome === 'Aurora Vale')!.outroLado).toBeNull();
  });

  it("contact date: in the future (Brasília time zone) or one that doesn't exist on the calendar doesn't pass", async () => {
    const { s, t, id } = await story();
    const a = claim(await read(t, id, s.cookie), P[2]);
    for (const when of [addDays(todayIso(), 1), '2026-02-31', '03/11/2026']) {
      const r = await req(`/api/t/${t}/textos/${id}/apuracoes`, { cookie: s.cookie, body: { afirmacaoId: a.id, tipo: 'outro_lado', quem: 'Assessoria', quando: when, meio: 'email' } });
      expect(r.status, when).toBe(400);
      expect((await r.json<{ code: string }>()).code).toBe('quando');
    }
  });

  it('quotes: short speech is checked; a loose word in quotes is a highlight; a long quotation gets in too', () => {
    const ev = [{ id: 'e1', texto: 'Ele respondeu: eu vi. E saiu.' }];
    expect(quotesBlock('b', 'Ele disse: “Eu vi.” E chamou o caso de "laranja".', ev).map((a) => [a.citacao, a.evidenciaId])).toEqual([['Eu vi', null]]);
    expect(quotesBlock('b', 'Ele disse: “eu vi.”', ev).map((a) => a.evidenciaId)).toEqual(['e1']);
    const long = Array.from({ length: 200 }, (_, i) => `palavra${i}`).join(' ');
    expect(quotesBlock('b', `Leu: "${long}".`, [])).toHaveLength(1);
  });

  it("second opinion that splits the sentence into a safe piece and a risky one: the risk doesn't disappear", () => {
    const sentence = { paragrafo: 0, inicio: 0, fim: 60, trecho: 'x', estado: 'com_evidencia' as const, risco: null, evidenciaId: 'e', evidenciaTrecho: 'y', explicacao: 'ok', incerto: false };
    const safe = { ...sentence, fim: 30, explicacao: 'seguro' };
    const danger = { ...sentence, inicio: 30, estado: 'risco' as const, risco: 'acusacao_sem_condenacao' as const, explicacao: 'acusa' };
    const r = combineOpinions([sentence], [safe, danger], 'discordam');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ estado: 'risco', risco: 'acusacao_sem_condenacao', incerto: true });
  });
});

describe('review: save and check', () => {
  it('emptied paragraph loses its marks (the deleted sentence no longer counts)', async () => {
    const { s, t, id } = await story();
    expect(claim(await read(t, id, s.cookie), P[2])).toBeTruthy();
    await save(t, id, s.cookie, [P[1], '', P[3], P[4]]);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM afirmacoes WHERE texto_id = ? AND bloco_id = 'p1'").bind(id).first<{ n: number }>();
    expect(n!.n).toBe(0);
    expect((await read(t, id, s.cookie)).afirmacoes.some((a) => a.trecho === P[2])).toBe(false);
  });

  it('the other-side paragraph changes or goes: the accusations go back to "por conferir"', async () => {
    const { s, t, id } = await story();
    const otherSide = 'Procurado, o vereador não respondeu até a publicação.';
    await save(t, id, s.cookie, [P[1], P[2], P[3], P[4], otherSide]);
    await req(`/api/t/${t}/textos/${id}/conferir`, { cookie: s.cookie, body: {} });
    const e = await save(t, id, s.cookie, [P[1], P[2], P[3], P[4]]);
    const state = (b: string) => e.blocos.find((x) => x.id === b)!.estado;
    expect(state('p1')).toBe('pendente');      // "desviou": an accusation, goes back to the check
    expect(state('p0')).toBe('conferido');     // no accusation: stays
  });

  it('sensitive topic appears later: the paragraphs DeepSeek checked go back to the other provider', async () => {
    const { s, t, id } = await story();
    await save(t, id, s.cookie, [P[1], P[2], P[3], P[4], 'O governo chinês pressiona Taiwan.']);
    calls.deepseek = 0;
    anthropic = () => [];
    await checkBlocks({ ...env, ANTHROPIC_API_KEY: 'sk-teste', SEGUNDA_URL: 'https://anthropic.example' }, t, id);
    expect(calls.deepseek).toBe(0);
    expect((await read(t, id, s.cookie)).blocos.every((b) => b.fornecedor === 'anthropic')).toBe(true);
  });

  it('long text: the check runs in rounds (cap of blocks per request) and finishes', async () => {
    const s = await register();
    const t = await tenantAuthor();
    await seedMember(t, s.userId, 'admin');
    const lines = ['Muitos parágrafos', ...Array.from({ length: BATCH_CHECK + 10 }, (_, i) => `Parágrafo número ${i} do texto longo.`)];
    const { texto: text } = await (await req(`/api/t/${t}/textos`, { cookie: s.cookie, body: { texto: lines.join('\n') } })).json<{ texto: { id: string } }>();
    deepseek = () => [];
    const r1 = await checkBlocks(env, t, text.id);
    expect(r1).toMatchObject({ blocos: BATCH_CHECK, restantes: 10 });
    const r2 = await checkBlocks(env, t, text.id);
    expect(r2).toMatchObject({ blocos: 10, restantes: 0 });
  });

  it("subheading inside a quote becomes a paragraph of the quote: the text isn't lost on save", () => {
    const doc = cleanDoc({ type: 'doc', content: [
      { type: 'paragraph', attrs: { id: 'a' }, content: [{ type: 'text', text: 'Antes.' }] },
      { type: 'blockquote', content: [{ type: 'heading', attrs: { id: 'b', level: 2 }, content: [{ type: 'text', text: 'Fala destacada' }] }] },
    ] }, () => crypto.randomUUID());
    expect(doc.content![1]).toEqual({ type: 'blockquote', content: [{ type: 'paragraph', attrs: { id: 'b' }, content: [{ type: 'text', text: 'Fala destacada' }] }] });
  });
});

// ── review 2 (Codex, 03/11): rounds that do not repeat failures, another kind of risk, the other side by the person, quotes, citation ──

describe('review 2: check and sign-off', () => {
  it('rounds: the next one doesn\'t repeat the failed paragraphs and finishes; "Conferir de novo" tries again', async () => {
    const s = await register();
    const t = await tenantAuthor();
    await seedMember(t, s.userId, 'admin');
    const lines = ['Texto longo', ...Array.from({ length: BATCH_CHECK }, (_, i) => `Falha número ${i} no fornecedor.`), 'O último parágrafo do texto.'];
    const { texto: text } = await (await req(`/api/t/${t}/textos`, { cookie: s.cookie, body: { texto: lines.join('\n') } })).json<{ texto: { id: string } }>();
    deepseek = (b) => { if (b.startsWith('Falha')) throw new Error('fornecedor fora'); return []; };
    const failed: string[] = [];
    const onBlock = (r: { blocoId: string; estado: string }) => { if (r.estado === 'nao_conferido') failed.push(r.blocoId); };
    const r1 = await checkBlocks(env, t, text.id, { aoBloco: onBlock });
    expect(r1).toMatchObject({ blocos: BATCH_CHECK, falhas: BATCH_CHECK, restantes: 1 });
    const r2 = await checkBlocks(env, t, text.id, { pular: failed, aoBloco: onBlock });
    expect(r2).toMatchObject({ blocos: 1, falhas: 0, restantes: 0 });
    expect(await checkBlocks(env, t, text.id, { pular: failed })).toMatchObject({ blocos: 0, restantes: 0 });
    // An earlier failure this check has not tried yet (outside the list): it goes into the round.
    expect(await checkBlocks(env, t, text.id, { pular: failed.slice(1) })).toMatchObject({ blocos: 1, restantes: 0 });
    // The person's request (without continuing) retries what failed.
    deepseek = () => [];
    expect(await checkBlocks(env, t, text.id)).toMatchObject({ blocos: BATCH_CHECK, falhas: 0 });
  });

  it("the same excerpt rechecked with another type of risk: the sign-off doesn't cover it and the checklist asks again", async () => {
    const { s, t, id } = await story();
    const e0 = await read(t, id, s.cookie);
    expect((await req(`/api/t/${t}/textos/${id}/assinar`, { cookie: s.cookie, body: { versao: e0.texto.versao } })).status).toBe(201);
    expect((await read(t, id, s.cookie)).checklist.assinatura).not.toBeNull();
    deepseek = (b) => (b === P[2] ? [brand(P[2], 'risco', { risco: 'vitima_ou_menor', explicacao: 'Expõe vítima.' })] : b === P[1] ? [WITHOUT_SOURCE] : []);
    expect((await req(`/api/t/${t}/textos/${id}/conferir`, { cookie: s.cookie, body: { todos: true } })).status).toBe(200);
    const e1 = await read(t, id, s.cookie);
    expect(e1.texto.versao).toBe(e0.texto.versao);
    expect(e1.checklist.assinatura).toBeNull();
  });

  it('second opinion with two risks of different types on the same wide mark: both stay in the explanation', () => {
    const sentence = { paragrafo: 0, inicio: 0, fim: 80, trecho: 'x', estado: 'sem_fonte' as const, risco: null, evidenciaId: null, evidenciaTrecho: null, explicacao: 'sem fonte', incerto: false };
    const accuses = { ...sentence, fim: 30, estado: 'risco' as const, risco: 'acusacao_sem_condenacao' as const, explicacao: 'acusa' };
    const victim = { ...sentence, inicio: 40, estado: 'risco' as const, risco: 'vitima_ou_menor' as const, explicacao: 'expõe vítima' };
    const r = combineOpinions([sentence], [accuses, victim], 'discordam');
    expect(r).toHaveLength(1);
    // The category is the most serious one: "I reached the other side" does not close the mark that also exposes the victim.
    expect(r[0]).toMatchObject({ estado: 'risco', risco: 'vitima_ou_menor', incerto: true });
    expect(r[0].explicacao).toContain('acusa');
    expect(r[0].explicacao).toContain('expõe vítima');
  });

  it('a paragraph that cites the accused person came out (without a reply word): the accusation goes back to "por conferir"', async () => {
    const { s, t, id } = await story();
    const context = 'Luís Souza estava em viagem na semana da votação.';
    await save(t, id, s.cookie, [P[1], P[2], P[3], P[4], context]);
    await req(`/api/t/${t}/textos/${id}/conferir`, { cookie: s.cookie, body: {} });
    const e = await save(t, id, s.cookie, [P[1], P[2], P[3], P[4]]);
    const state = (b: string) => e.blocos.find((x) => x.id === b)!.estado;
    expect(state('p1')).toBe('pendente');
    expect(state('p0')).toBe('conferido');
    expect(OTHER_SIDE.test('Aurora Vale disse à reportagem que desconhece o contrato.')).toBe(true);
  });

  it("single-word quotes: with punctuation inside or after a verb of saying, it's speech (checked); the highlighted word isn't", () => {
    const ids = (t: string) => quotesBlock('b', t, []).map((a) => a.citacao);
    expect(ids('O laudo concluiu: “Superfaturamento.”')).toEqual(['Superfaturamento']);
    expect(ids('Ele respondeu “Sim” e saiu.')).toEqual(['Sim']);
    expect(ids('E chamou o caso de "laranja".')).toEqual([]);
    expect(ids('“Sim”, respondeu Aurora.')).toEqual(['Sim']);
    expect(ids('“Superfaturamento” — concluiu o laudo.')).toEqual(['Superfaturamento']);
  });

  it("quote inside a quote (or list) in the editor document: becomes a paragraph, and the text doesn't vanish on save", () => {
    const doc = cleanDoc({ type: 'doc', content: [
      { type: 'paragraph', attrs: { id: 'a' }, content: [{ type: 'text', text: 'Antes.' }] },
      { type: 'blockquote', content: [{ type: 'blockquote', content: [{ type: 'paragraph', attrs: { id: 'b' }, content: [{ type: 'text', text: 'Fala aninhada' }] }] }] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', attrs: { id: 'c' }, content: [{ type: 'text', text: 'Item da lista' }] }] }] },
    ] }, () => 'novo');
    expect(doc.content![1]).toEqual({ type: 'blockquote', content: [{ type: 'paragraph', attrs: { id: 'b' }, content: [{ type: 'text', text: 'Fala aninhada' }] }] });
    expect(doc.content![2]).toEqual({ type: 'paragraph', attrs: { id: 'c' }, content: [{ type: 'text', text: 'Item da lista' }] });
  });
});
