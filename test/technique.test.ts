// Step 15: the technique comes from the model, the reference follows the order brand, technique, text, and "Another
// illustration" stays tied to the card and the piece, with a per-card limit and the cost within the piece's cap.
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_ILLUSTRATIONS_CARD, illustrate, shortPrompt, promptIllustration, techniqueOf } from '../src/lib/illustrate';
import { DEFAULT_PARAMS, TECHNIQUES, DEFAULT_TECHNIQUE, type PieceStyle, type Technique } from '../src/lib/style';
import { validateStyle } from '../src/lib/styles';
import { loadLead } from '../src/lib/lead';
import { closingCaption, type Draft } from '../src/lib/drafting';
import { prepareCards } from '../src/lib/render';
import { currentIllustration, readCards } from '../src/shell/editing';
import type { Card } from '../src/lib/cards';
import { register, req, seedMember, seedTenant } from './helpers';

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0));
const SENTENCE = 'A Prefeitura do Guarujá interditou a ponte da Enseada por 15 dias para obras de recuperação';
const kie = { enviados: [] as string[], prompts: [] as string[], falha: false };

function enableKie() {
  (env as unknown as Record<string, unknown>).KIE_API_KEY = 'teste';
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (u, init) => {
    const url = String(u);
    if (kie.falha) return new Response('', { status: 500 });
    if (url.includes('file-base64-upload')) {
      kie.enviados.push(JSON.parse(String(init?.body)).base64Data);
      return Response.json({ success: true, data: { downloadUrl: 'https://cdn.example/r.png' } });
    }
    if (url.includes('createTask')) {
      kie.prompts.push(JSON.parse(String(init?.body)).input.prompt);
      return Response.json({ code: 200, data: { taskId: 't1' } });
    }
    if (url.includes('recordInfo')) return Response.json({ code: 200, data: { taskId: 't1', state: 'success', creditsConsumed: 4, resultJson: { resultUrls: ['https://cdn.example/x.png'] } } });
    return new Response(new Uint8Array(2000).fill(7));
  });
}

beforeEach(() => {
  Object.assign(kie, { enviados: [], prompts: [], falha: false });
  vi.spyOn(env.AI, 'run').mockImplementation((async (model: string) => (model.includes('flux')
    ? { image: btoa('x'.repeat(2000)) }
    : { response: '{"pessoas":0,"letras":0,"violencia":false}' })) as never);
});
afterEach(() => {
  vi.restoreAllMocks();
  delete (env as unknown as Record<string, unknown>).KIE_API_KEY;
});

const withTechnique = (r: Draft, technique: Technique): Draft => ({ ...r, estilo: { id: 'e', versao: 1, params: { ...DEFAULT_PARAMS, tecnica: technique }, marcaVisual: {} } as PieceStyle });

async function scenario(o: { papel?: 'admin' | 'editor' | 'reporter'; status?: string; custo?: number; layout?: 'texto' | 'documento'; composicao?: 'cartaz' } = {}) {
  const t = await seedTenant();
  const s = await register();
  await seedMember(t, s.userId, o.papel ?? 'editor');
  const [leadId, doc, fact, id] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO fontes (id, tenant_id, tipo, nome) VALUES (?, ?, 'manual', 'Teste')").bind(`${t}:f`, t),
    env.DB.prepare("INSERT INTO documentos (id, tenant_id, fonte_id, url, hash_texto, status) VALUES (?, ?, ?, ?, ?, 'triado')").bind(doc, t, `${t}:f`, `https://a.example/${doc}`, doc),
    env.DB.prepare("INSERT INTO fatos (id, tenant_id, documento_id, tipo, texto, hash) VALUES (?, ?, ?, 'manchete', ?, ?)").bind(fact, t, doc, SENTENCE, fact),
    env.DB.prepare("INSERT INTO pautas (id, tenant_id, status, origem, titulo, fato_ids_json, documento_ids_json, score) VALUES (?, ?, 'em_producao', 'manual', 'Ponte', ?, ?, 1)").bind(leadId, t, JSON.stringify([fact]), JSON.stringify([doc])),
  ]);
  const lead = await loadLead(env, t, leadId);
  const content: Draft = {
    manchete: 'Ponte interditada', resumo: '', modelo: 'ia', custoUsd: 0, legenda: `Ponte.${closingCaption(lead)}`,
    visualBrief: { primary: 'Ponte vazia ao entardecer', fatoIds: [fact] },
    cards: [
      { id: 'c1', layout: 'capa', titulo: 'Ponte interditada', frases: [] },
      { id: 'c2', layout: o.layout ?? 'texto', titulo: 'Ponte da Enseada interditada', frases: [{ texto: SENTENCE, fatoId: fact }] },
      { id: 'k', layout: 'convite', titulo: 'Siga', frases: [{ texto: 'Siga a página', fatoId: null }] },
    ],
    ...(o.composicao ? { estilo: { id: 'e', versao: 1, params: { ...DEFAULT_PARAMS, composicao: o.composicao }, marcaVisual: {} } as PieceStyle } : {}),
  } as Draft;
  await env.DB.prepare(`INSERT INTO pecas (id, tenant_id, pauta_id, formato, status, versao, custo_usd, conteudo_json, validacao_json, arte_r2_keys_json, workflow_id)
                        VALUES (?, ?, ?, 'carrossel', ?, 3, ?, ?, '{"ok":true,"erros":[],"avisos":[]}', '[]', ?)`)
    .bind(id, t, leadId, o.status ?? 'revisao', o.custo ?? 0, JSON.stringify(content), `${id}-r1`).run();
  const request = (card = 'c2', body: Record<string, unknown> = {}, cookie = s.cookie, tt = t) => req(`/api/t/${tt}/pecas/${id}/cards/${card}/ilustracao`, { cookie, body: { versao: 3, ...body } });
  return { t, s, id, fato: fact, pauta: lead, conteudo: content, pedir: request };
}

describe('technique', () => {
  it('each technique goes into both prompts, and watercolor was removed', async () => {
    const { pauta: lead, conteudo: content } = await scenario();
    for (const [technique, word] of [['xilogravura', 'Xilogravura'], ['reticula', 'retícula'], ['nanquim', 'nanquim']] as const) {
      const r = withTechnique(content, technique);
      expect(promptIllustration(lead, r, lead.marca).toLowerCase()).toContain(word.toLowerCase());
      expect(shortPrompt(lead, r, lead.marca).toLowerCase()).toContain(word.toLowerCase());
    }
    for (const technique of TECHNIQUES) {
      const r = withTechnique(content, technique);
      expect(`${promptIllustration(lead, r, lead.marca)} ${shortPrompt(lead, r, lead.marca)}`).not.toMatch(/aquarela|pintura|lavagens/i);
    }
  });

  it('reference: no technique in the prompt; without an image in the brand, the default comes out', async () => {
    const { pauta: lead, conteudo: content } = await scenario();
    const r = withTechnique(content, 'referencia');
    const brand = { ...lead.marca, arteRefR2: 'marcas/x/ref.png' };
    const text = `${promptIllustration({ ...lead, marca: brand }, r, brand)} ${shortPrompt({ ...lead, marca: brand }, r, brand)}`;
    expect(text).not.toMatch(/xilogravura|retícula|nanquim/i);
    expect(techniqueOf(r, brand)).toBe('referencia');
    expect(techniqueOf(r, { ...lead.marca, arteRefR2: undefined })).toBe(DEFAULT_TECHNIQUE);
  });

  it('a piece without template stays on the default, and the template validates the technique', async () => {
    const { pauta: lead, conteudo: content } = await scenario();
    expect(DEFAULT_TECHNIQUE).toBe('reticula');
    expect(techniqueOf(content, lead.marca)).toBe('reticula');
    expect(validateStyle({ nome: 'A' })).toMatchObject({ params: { tecnica: 'reticula' } });
    expect(validateStyle({ nome: 'A', params: { tecnica: 'nanquim' } })).toMatchObject({ params: { tecnica: 'nanquim' } });
    expect(validateStyle({ nome: 'A', params: { tecnica: 'aquarela' } })).toMatchObject({ erro: 'técnica inválida' });
  });
});

describe('reference that guides the generator', () => {
  const illustrateWith = async (c: Awaited<ReturnType<typeof scenario>>, technique: Technique, artRefR2?: string) =>
    illustrate(env, { tenantId: c.t, pecaId: c.id, pauta: { ...c.pauta, marca: { ...c.pauta.marca, arteRefR2: artRefR2 } }, rascunho: withTechnique(c.conteudo, technique), custoAtualUsd: 0 });

  it("the brand's one comes first", async () => {
    const c = await scenario();
    enableKie();
    const key = `marcas/${c.t}/ref.png`;
    await env.MEDIA.put(key, PNG);
    const out = await illustrateWith(c, 'nanquim', key);
    expect(out).toMatchObject({ provedor: 'kie', custoUsd: 0.02 });
    expect(kie.enviados).toHaveLength(1);
    expect(kie.prompts[0]).toContain('nanquim');
  });

  it("without the brand's, the technique's in R2", async () => {
    const c = await scenario();
    enableKie();
    await env.CONFIG.delete('kie-ref:referencias/xilogravura.png');
    await env.MEDIA.put('referencias/xilogravura.png', PNG);
    try {
      expect(await illustrateWith(c, 'xilogravura')).toMatchObject({ provedor: 'kie' });
      expect(kie.enviados).toHaveLength(1);
    } finally {
      await env.MEDIA.delete('referencias/xilogravura.png');
    }
  });

  it('none at all: the text generator, with the technique written out', async () => {
    const c = await scenario();
    enableKie();
    expect(await illustrateWith(c, 'nanquim')).toMatchObject({ provedor: 'workers-ai', custoUsd: 0, fallbackDe: 'marca sem arteRefR2' });
    expect(kie.prompts).toEqual([]);
    const flux = vi.mocked(env.AI.run).mock.calls.find(([m]) => String(m).includes('flux'))!;
    expect((flux[1] as { prompt: string }).prompt).toContain('nanquim');
  });
});

describe('fal instead of Kie', () => {
  const illustrateWith = async (c: Awaited<ReturnType<typeof scenario>>, artRefR2: string) =>
    illustrate(env, { tenantId: c.t, pecaId: c.id, pauta: { ...c.pauta, marca: { ...c.pauta.marca, arteRefR2: artRefR2 } }, rascunho: withTechnique(c.conteudo, 'nanquim'), custoAtualUsd: 0 });
  const requests: { url: string; auth: string | null; corpo: string }[] = [];
  const enableFal = (qa = '{"pessoas":0,"letras":0,"violencia":false}') => {
    requests.length = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (u, init) => {
      const url = String(u);
      requests.push({ url, auth: new Headers(init?.headers).get('authorization'), corpo: String(init?.body ?? '') });
      if (url.startsWith('https://fal.example/')) return Response.json({ images: [{ url: 'https://cdn.fal.example/x.png' }] });
      return new Response(new Uint8Array(2000).fill(7));
    });
    vi.mocked(env.AI.run).mockImplementation((async (model: string) => (model.includes('flux') ? { image: btoa('x'.repeat(2000)) } : { response: qa })) as never);
  };
  const chooseFal = async (t: string) => {
    await env.DB.prepare("UPDATE tenants SET provedor_imagem = 'fal' WHERE id = ?").bind(t).run();
    (env as unknown as Record<string, unknown>).FAL_KEY = 'chave-fal-do-servidor-0000';
  };
  afterEach(() => { delete (env as unknown as Record<string, unknown>).FAL_KEY; });

  it('through the test endpoint: the same Grok, the reference in the request, the key only in the header, and the same QA', async () => {
    const c = await scenario();
    await chooseFal(c.t);
    enableFal();
    const ref = `marcas/${c.t}/ref.png`;
    await env.MEDIA.put(ref, PNG);
    const out = await illustrateWith(c, ref);
    expect(out).toMatchObject({ provedor: 'fal', custoUsd: 0.022, reutilizada: false });
    const request = requests.find((p) => p.url.startsWith('https://fal.example/'))!;
    expect(request.url).toBe('https://fal.example/xai/grok-imagine-image/edit');
    expect(request.auth).toBe('Key chave-fal-do-servidor-0000');
    const body = JSON.parse(request.corpo) as { prompt: string; image_urls: string[]; aspect_ratio: string };
    expect(body).toMatchObject({ aspect_ratio: '2:3' });
    expect(body.prompt).toContain('nanquim');
    expect(body.image_urls[0]).toMatch(/^data:image\/png;base64,/);
    expect((await env.MEDIA.head(out!.r2Key))?.customMetadata?.provedor).toBe('fal');
    const usage = await env.DB.prepare("SELECT modelo, custo_usd, chave FROM uso_modelo WHERE tenant_id = ? AND funcao = 'ilustracao'").bind(c.t).first();
    expect(usage).toMatchObject({ modelo: 'xai/grok-imagine-image/edit', custo_usd: 0.022, chave: 'servidor' });
  });

  it('an image failing QA falls back to the simple illustration, with the reason; without a key, the reason says which is missing', async () => {
    const c = await scenario();
    await chooseFal(c.t);
    enableFal('{"pessoas":2,"letras":0,"violencia":false}');
    const ref = `marcas/${c.t}/ref.png`;
    await env.MEDIA.put(ref, PNG);
    await expect(illustrateWith(c, ref)).rejects.toThrow(/QA/);   // text diffusion also fails (the same QA): error
    delete (env as unknown as Record<string, unknown>).FAL_KEY;
    enableFal();
    const without = await illustrate(env, { tenantId: c.t, pecaId: c.id, pauta: { ...c.pauta, marca: { ...c.pauta.marca, arteRefR2: ref } }, rascunho: withTechnique(c.conteudo, 'xilogravura'), custoAtualUsd: 0 });
    expect(without).toMatchObject({ provedor: 'workers-ai', fallbackDe: 'FAL_KEY ausente' });
    expect(requests.some((p) => p.url.startsWith('https://fal.example/'))).toBe(false);
  });
});

describe('POST /pecas/:id/cards/:cardId/ilustracao', () => {
  it("generates, adds the cost, and doesn't touch the piece", async () => {
    const c = await scenario();
    enableKie();
    const key = `marcas/${c.t}/ref.png`;
    await env.MEDIA.put(key, PNG);
    await env.DB.prepare("UPDATE tenants SET marca_json = json_set(COALESCE(marca_json, '{}'), '$.arteRefR2', ?) WHERE id = ?").bind(key, c.t).run();
    const res = await c.pedir();
    expect(res.status).toBe(200);
    const b = await res.json<{ chave: string; url: string; restantes: number; custoUsd: number }>();
    expect(b.chave.startsWith(`artes/${c.t}/${c.id}/cards/c2/`)).toBe(true);
    expect(b).toMatchObject({ restantes: MAX_ILLUSTRATIONS_CARD - 1, custoUsd: 0.02 });
    expect(await env.MEDIA.head(b.chave)).toBeTruthy();
    expect(kie.prompts[0]).toContain(SENTENCE);
    const p = await env.DB.prepare('SELECT custo_usd, conteudo_json FROM pecas WHERE id = ?').bind(c.id).first<{ custo_usd: number; conteudo_json: string }>();
    expect(p!.custo_usd).toBeCloseTo(0.02);
    expect(JSON.parse(p!.conteudo_json)).toEqual(c.conteudo);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM eventos WHERE tenant_id = ? AND ref_id = ? AND tipo = 'peca.ilustracao_card'").bind(c.t, c.id).first('n')).toBe(1);
  });

  it(`up to ${MAX_ILLUSTRATIONS_CARD} per card; the other card has its own`, async () => {
    const c = await scenario();
    for (let i = 0; i < MAX_ILLUSTRATIONS_CARD; i++) expect((await c.pedir()).status).toBe(200);
    expect((await c.pedir()).status).toBe(409);
    expect((await c.pedir('c1')).status).toBe(200);
  });

  it("an image rejected by QA doesn't become an illustration or count", async () => {
    const c = await scenario();
    vi.mocked(env.AI.run).mockImplementation((async (model: string) => (model.includes('flux')
      ? { image: btoa('x'.repeat(2000)) }
      : { response: '{"pessoas":2,"letras":0,"violencia":false}' })) as never);
    expect((await c.pedir()).status).toBe(502);
    expect((await env.MEDIA.list({ prefix: `artes/${c.t}/${c.id}/cards/` })).objects).toEqual([]);
  });

  it('refuses: another outlet, reporter, outside review, old version, no art, cap', async () => {
    const c = await scenario();
    const outside = await scenario();
    expect((await c.pedir('c2', {}, c.s.cookie, outside.t)).status).toBe(404);
    expect((await outside.pedir('c2', {}, outside.s.cookie, outside.t)).status).toBe(200);
    expect((await req(`/api/t/${outside.t}/pecas/${c.id}/cards/c2/ilustracao`, { cookie: outside.s.cookie, body: { versao: 3 } })).status).toBe(404);
    expect((await (await scenario({ papel: 'reporter' })).pedir()).status).toBe(403);
    expect((await (await scenario({ status: 'aprovada' })).pedir()).status).toBe(409);
    expect((await c.pedir('c2', { versao: 2 })).status).toBe(409);
    expect((await c.pedir('k')).status).toBe(400);
    expect((await c.pedir('nada')).status).toBe(404);
    expect((await (await scenario({ layout: 'documento' })).pedir()).status).toBe(400);
    expect((await (await scenario({ composicao: 'cartaz' })).pedir()).status).toBe(400);
    expect((await (await scenario({ custo: 0.25 })).pedir()).status).toBe(409);
  });
});

describe('the card with its own illustration', () => {
  it('only accepts a key from this piece, which must exist', async () => {
    const c = await scenario();
    const key = `artes/${c.t}/${c.id}/cards/c2/um`;
    await env.MEDIA.put(key, PNG);
    const read = (illustration: string) => readCards(env, c.pauta, c.t, c.id, [{ id: 'c2', layout: 'texto', titulo: 'T', frases: [], ilustracao: illustration }]);
    expect(await read(key)).toMatchObject([{ ilustracao: key }]);
    expect(await read(`artes/${c.t}/outra/cards/c2/um`)).toContain('ilustração gerada para esta peça');
    expect(await read(`artes/${c.t}/${c.id}/cards/../ilustracao-x`)).toContain('ilustração gerada para esta peça');
    expect(await read(`artes/${c.t}/${c.id}/cards/c2/dois`)).toContain('não encontrada');
  });

  it("photo beats the card's illustration, which beats the piece's; the piece's remains the current one", async () => {
    const c = await scenario();
    const hers = `artes/${c.t}/${c.id}/ilustracao-p`;
    const fromCard = `artes/${c.t}/${c.id}/cards/c2/um`;
    const photo = `fotos/${c.t}/${c.id}/f`;
    const bytes = (n: number) => new Uint8Array(40).fill(n);
    await Promise.all([env.MEDIA.put(hers, bytes(1)), env.MEDIA.put(fromCard, bytes(2)), env.MEDIA.put(photo, bytes(3))]);
    const cards: Card[] = [
      { id: 'a', layout: 'texto', titulo: 'A', frases: [] },
      { id: 'b', layout: 'texto', titulo: 'B', frases: [], ilustracao: fromCard },
      { id: 'c', layout: 'texto', titulo: 'C', frases: [], ilustracao: fromCard, imagem: photo },
    ];
    const ready = await prepareCards(env, { tenantId: c.t, pecaId: c.id, versao: 1, formato: 'carrossel', rascunho: { ...c.conteudo, cards }, pauta: c.pauta, ilustracaoR2: hers });
    const b64 = (n: number) => btoa(String.fromCharCode(...bytes(n)));
    expect(ready[0].html).toContain(b64(1));
    expect(ready[1].html).toContain(b64(2));
    expect(ready[1].html).not.toContain(b64(1));
    expect(ready[2].html).toContain(b64(3));
    expect(ready[2].html).not.toContain(b64(2));
    // Even with every card having its own illustration, the piece's is not lost: removing the card's goes back to it.
    const only = await prepareCards(env, { tenantId: c.t, pecaId: c.id, versao: 1, formato: 'post', rascunho: { ...c.conteudo, cards: [cards[1]] }, pauta: c.pauta, ilustracaoR2: hers });
    const artwork = only.map((p, i) => ({ hash: p.hash, arte: p.arte, png: `p${i}`, jpg: `j${i}`, papel: 'capa' }));
    expect(await currentIllustration(env, c.t, c.id, artwork as never)).toBe(hers);
  });
});
