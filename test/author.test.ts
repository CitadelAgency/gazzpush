// Author mode (Phase 1 of docs/PRODUTO-2026-11-02.md): an outlet created from the Substack URL, triage that accepts
// every text by the author with the body's passages as facts, drafting in their voice, the author card and reading
// from Google Docs. Feed, pages, Google and DeepSeek are a simulated fetch (.example domains); Workers AI and Workflow, fakes.
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthorError, ITEMS_INITIALS, opening, fromTopicColors, startAuthor, readSubstack, substackOrigin } from '../src/lib/author';
import { loadLead, type Lead } from '../src/lib/lead';
import { MAX_PASSAGES_AUTHOR, triageArticle, passagesAuthor } from '../src/lib/triage';
import { spansEvidence } from '../src/lib/spans';
import { chooseCta, closingCaption, draftPiece, type Card } from '../src/lib/drafting';
import { varsCard } from '../src/lib/render';
import { validate } from '../src/lib/validation';
import { readDocument, paragraphsDoc } from '../src/lib/google';
import { htmlPreview, DEFAULT_COLORS } from '../web/src/onboarding/preview';
import type { MonitorMessage } from '../src/env';
import { register, req, seedMember, seedTenant } from './helpers';

const ORIGIN = 'https://autora.substack.example';
const POSTS = [1, 2, 3, 4].map((n) => `${ORIGIN}/p/texto-${n}`);
const postBody = (n: number) =>
  `Eu passei a semana ${n === 1 ? 'inteira' : 'toda'} lendo os relatórios da Câmara sobre o transporte. ` +
  'O que encontrei não é escândalo, é rotina: contratos renovados sem concorrência, ano após ano. ' +
  'Acho que isso diz mais sobre a cidade do que qualquer denúncia.';
const htmlPost = (n: number) => `<html><head><meta property="og:title" content="Texto ${['um', 'dois', 'três', 'quatro'][n - 1]} da autora">
<script type="application/ld+json">${JSON.stringify({ '@type': 'BlogPosting', articleBody: postBody(n) })}</script></head>
<body><h1>Texto ${n}</h1><p>${postBody(n)}</p></body></html>`;
const FEED = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel>
<title><![CDATA[Cartas da Orla]]></title><link>${ORIGIN}</link>
<image><url>https://cdn.substack.example/logo.png</url><title>Cartas da Orla</title></image>
${POSTS.map((u, i) => `<item><title>Texto ${i + 1}</title><link>${u}</link><dc:creator><![CDATA[Ana Ribeiro]]></dc:creator>
<pubDate>${new Date(Date.UTC(2026, 9, 30 - i)).toUTCString()}</pubDate></item>`).join('\n')}
</channel></rss>`;
const PAGE = `<html><head><meta name="theme-color" content="#123b5c"><meta property="og:site_name" content="Cartas da Orla"></head><body></body></html>`;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
// Triage: opinion (the monitor's news filter would discard it), no place.
const TRIAGE = { tipo: 'opiniao', tipo_span: 1, editoria: 'politica', editoria_span: 1, ocorreu_em: null, data_span: null, locais: [] };

let pages: Record<string, () => Response>;
let deepseek: { system: string; user: string }[];
let deepseekAnswer: () => object;
let authorizations: string[];
let requestsDocs: string[];

beforeEach(() => {
  deepseek = [];
  authorizations = [];
  requestsDocs = [];
  pages = {
    [`${ORIGIN}/feed`]: () => new Response(FEED, { headers: { 'content-type': 'application/rss+xml; charset=utf-8' } }),
    [ORIGIN]: () => new Response(PAGE, { headers: { 'content-type': 'text/html; charset=utf-8' } }),
    'https://cdn.substack.example/logo.png': () => new Response(PNG, { headers: { 'content-type': 'image/png' } }),
    ...Object.fromEntries(POSTS.map((u, i) => [u, () => new Response(htmlPost(i + 1), { headers: { 'content-type': 'text/html; charset=utf-8' } })])),
  };
  vi.spyOn(env.AI, 'run').mockImplementation((async () => ({ response: TRIAGE })) as never);
  const original = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('https://docs.googleapis.com/')) {
      authorizations.push(new Headers(init?.headers).get('authorization') ?? '');
      requestsDocs.push(url);
    }
    if (url.includes('deepseek')) {
      const body = JSON.parse(String(init?.body));
      deepseek.push({ system: body.messages[0].content, user: body.messages[1].content });
      return Response.json({ choices: [{ message: { content: JSON.stringify(deepseekAnswer()) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    }
    const p = pages[url.replace(/\/$/, '')] ?? pages[url] ?? (url.startsWith('https://docs.googleapis.com/') ? pages[url.split('?')[0]] : undefined);
    if (p) return p();
    if (url.includes('.example')) return new Response('não achei', { status: 404, headers: { 'content-type': 'text/html' } });
    return original(input, init);
  });
});
afterEach(() => vi.restoreAllMocks());

const line = <T>(sql: string, ...binds: unknown[]) => env.DB.prepare(sql).bind(...binds).first<T>();

async function tenantAuthor(brand: Record<string, unknown> = {}) {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO tenants (id, slug, nome, modo, marca_json, plano) VALUES (?, ?, 'Cartas da Orla', 'autoral', ?, 'cortesia')")
    .bind(id, `a-${id.slice(0, 8)}`, JSON.stringify({ nome: 'Cartas da Orla', assinatura: 'Ana Ribeiro', ctaUrl: ORIGIN, dominio: 'autora.substack.example', ...brand })).run();
  return id;
}

/** A fake production Workflow: keeps the instances created (real production is covered in flow.test.ts). */
function envWithoutProduction() {
  const created: string[] = [];
  const wf = { create: async ({ id }: { id: string }) => { created.push(id); return { id }; }, get: async (id: string) => ({ id, status: async () => ({ status: 'running' }) }) };
  return { env: { ...env, PRODUCAO_WORKFLOW: wf as unknown as typeof env.PRODUCAO_WORKFLOW }, criadas: created };
}

describe('triage in the author outlet', () => {
  it('opinion becomes a lead and each excerpt of the body becomes a literal `trecho` fact', async () => {
    const t = await tenantAuthor();
    const docId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO documentos (id, tenant_id, url, hash_texto) VALUES (?, ?, ?, ?)").bind(docId, t, POSTS[0], crypto.randomUUID()).run();
    const article = { titulo: 'Texto um da autora', texto: postBody(1), url: POSTS[0], publicadoEm: null, modificadoEm: null, capturadoEm: new Date().toISOString(), metodo: 'teste', sha256: 'abc' };
    const leadId = await triageArticle(env, t, docId, article, new Date());
    expect(leadId).toBeTruthy();
    expect(await line('SELECT status, triagem FROM documentos WHERE id = ?', docId)).toEqual({ status: 'triado', triagem: 'autoral' });
    const { results } = await env.DB.prepare('SELECT tipo, texto FROM fatos WHERE documento_id = ? ORDER BY span_inicio, tipo').bind(docId).all<{ tipo: string; texto: string }>();
    const passages = results.filter((f) => f.tipo === 'trecho').map((f) => f.texto);
    // 3 sentences in the body: the 1st is already a fact (type and section), the other two become passages; all literal from the text.
    expect(passages).toEqual([
      'O que encontrei não é escândalo, é rotina: contratos renovados sem concorrência, ano após ano.',
      'Acho que isso diz mais sobre a cidade do que qualquer denúncia.',
    ]);
    for (const f of results) expect(`${article.titulo}\n\n${article.texto}`).toContain(f.texto);
    const lead = await loadLead(env, t, leadId!);
    expect(lead.modo).toBe('autoral');
    expect(lead.fatos.map((f) => f.tipo)).toEqual(expect.arrayContaining(['manchete', 'tipo', 'trecho']));
  });

  it('the same text in a local outlet stays discarded (opinion is not news)', async () => {
    const t = await seedTenant();
    const docId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO documentos (id, tenant_id, url, hash_texto) VALUES (?, ?, ?, ?)").bind(docId, t, POSTS[0], crypto.randomUUID()).run();
    const article = { titulo: 'Texto um da autora', texto: postBody(1), url: POSTS[0], publicadoEm: null, modificadoEm: null, capturadoEm: new Date().toISOString(), metodo: 'teste', sha256: 'abc' };
    expect(await triageArticle(env, t, docId, article, new Date())).toBeNull();
    expect(await line('SELECT status FROM documentos WHERE id = ?', docId)).toEqual({ status: 'descartado' });
    expect(await line("SELECT COUNT(*) AS n FROM fatos WHERE documento_id = ? AND tipo = 'trecho'", docId)).toEqual({ n: 0 });
  });

  it(`above ${MAX_PASSAGES_AUTHOR} excerpts, spread evenly and in order`, () => {
    const text = Array.from({ length: 150 }, (_, i) => `Frase número ${i} do texto longo.`).join(' ');
    const spans = spansEvidence({ titulo: 'Título', texto: text });
    const chosen = passagesAuthor(spans, 'Título'.length);
    expect(chosen).toHaveLength(MAX_PASSAGES_AUTHOR);
    expect(chosen[0].texto).toBe('Frase número 0 do texto longo.');
    expect(chosen.at(-1)!.texto).toMatch(/Frase número 14[5-9]/);
    expect(chosen.map((s) => s.inicio)).toEqual([...chosen.map((s) => s.inicio)].sort((a, b) => a - b));
    expect(chosen.every((s) => s.inicio > 'Título'.length)).toBe(true);
  });
});

describe('create an author outlet from the Substack URL', () => {
  it('reads the feed and the page: RSS source, name, logo, color, subscription, author CTA; the 3 most recent go to the queue', async () => {
    const s = await register();
    const queue = vi.spyOn(env.MONITOR_QUEUE, 'send').mockResolvedValue(undefined as never);
    const res = await req('/api/tenants', { cookie: s.cookie, body: { modo: 'autoral', substack: 'autora.substack.example/p/texto-2' } });
    expect(res.status).toBe(201);
    const t = await res.json<{ id: string; slug: string; nome: string; modo: string; textos: number }>();
    expect(t).toMatchObject({ nome: 'Cartas da Orla', modo: 'autoral', textos: ITEMS_INITIALS });

    const row = await line<{ modo: string; municipio_ibge: string | null; marca_json: string }>('SELECT modo, municipio_ibge, marca_json FROM tenants WHERE id = ?', t.id);
    expect(row!.modo).toBe('autoral');
    expect(row!.municipio_ibge).toBeNull();
    const brand = JSON.parse(row!.marca_json);
    expect(brand).toMatchObject({
      nome: 'Cartas da Orla', dominio: 'autora.substack.example', ctaUrl: ORIGIN, assinatura: 'Ana Ribeiro',
      // #123b5c is dark: it becomes the background, with the render's light text.
      cores: { fundo: '#123b5c', texto: '#fffcf6' },
      ctas: [{ titulo: 'Leia o texto completo', texto: 'O texto inteiro está em Cartas da Orla.', legenda: 'Texto completo: {link}' }],
    });
    expect(brand.logoR2).toMatch(new RegExp(`^marcas/${t.id}/logo-.+\\.png$`));
    expect(await env.MEDIA.get(brand.logoR2)).not.toBeNull();
    expect(await line('SELECT tipo, nome, url FROM fontes WHERE tenant_id = ?', t.id)).toEqual({ tipo: 'rss', nome: 'Cartas da Orla', url: `${ORIGIN}/feed` });
    expect(await line('SELECT COUNT(*) AS n FROM tenant_areas WHERE tenant_id = ?', t.id)).toEqual({ n: 0 });
    expect(queue).toHaveBeenCalledWith({ tipo: 'autoral', tenantId: t.id, por: s.userId, urls: POSTS.slice(0, 3) });

    // The public brand already carries the signature and the domain (author card preview in the brand step).
    const pub = await (await req(`/api/t/${t.id}/marca`, { cookie: s.cookie })).json<{ marca: Record<string, unknown> }>();
    expect(pub.marca).toMatchObject({ assinatura: 'Ana Ribeiro', dominio: 'autora.substack.example', temLogo: true });
  });

  it('the queue turns the texts into manual leads, records the voice and sends them to be produced as a carousel; redelivered, not duplicated', async () => {
    const s = await register();
    const t = await tenantAuthor();
    await seedMember(t, s.userId, 'admin');
    const { env: e, criadas: created } = envWithoutProduction();
    const msg = { tipo: 'autoral' as const, tenantId: t, por: s.userId, urls: POSTS.slice(0, 3) };
    await startAuthor(e, msg);

    const { results: leads } = await env.DB.prepare("SELECT id, status, origem, titulo FROM pautas WHERE tenant_id = ? ORDER BY titulo").bind(t).all<Record<string, string>>();
    expect(leads).toHaveLength(3);
    expect(leads.every((p) => p.status === 'em_producao' && p.origem === 'manual')).toBe(true);
    const { results: pieces } = await env.DB.prepare('SELECT formato FROM pecas WHERE tenant_id = ?').bind(t).all<{ formato: string }>();
    expect(pieces.map((p) => p.formato)).toEqual(['carrossel', 'carrossel', 'carrossel']);
    expect(created).toHaveLength(3);
    const voice = JSON.parse((await line<{ voz_json: string }>('SELECT voz_json FROM tenants WHERE id = ?', t))!.voz_json);
    expect(voice.exemplos).toHaveLength(3);
    expect(voice.exemplos[0]).toMatch(/^Eu passei a semana inteira lendo os relatórios da Câmara sobre o transporte\./);

    await startAuthor(e, msg);   // reentrega
    expect((await line<{ n: number }>('SELECT COUNT(*) AS n FROM pautas WHERE tenant_id = ?', t))!.n).toBe(3);
    expect(created).toHaveLength(3);
  });

  it("failed text returns to the queue on its own; those that became leads don't repeat (neither discarded nor with changed text)", async () => {
    const s = await register();
    const t = await tenantAuthor();
    await seedMember(t, s.userId, 'admin');
    const { env: e, criadas: created } = envWithoutProduction();
    const queue = vi.spyOn(env.MONITOR_QUEUE, 'send').mockResolvedValue(undefined as never);
    const outside = pages[POSTS[2]];
    pages[POSTS[2]] = () => new Response('fora do ar', { status: 503, headers: { 'content-type': 'text/html' } });
    await startAuthor(e, { tipo: 'autoral', tenantId: t, por: s.userId, urls: POSTS.slice(0, 3) });
    expect(created).toHaveLength(2);
    expect(queue).toHaveBeenCalledTimes(1);
    const [resend, options] = queue.mock.calls[0] as [Extract<MonitorMessage, { tipo: 'autoral' }>, { delaySeconds: number }];
    expect(resend).toEqual({ tipo: 'autoral', tenantId: t, por: s.userId, urls: [POSTS[2]], tentativa: 1 });
    expect(options.delaySeconds).toBe(300);

    // Meanwhile the person discards an idea and the author edits text 1: the resend only brings text 3.
    await env.DB.prepare("UPDATE pautas SET status = 'descartada' WHERE tenant_id = ? AND id = (SELECT id FROM pautas WHERE tenant_id = ? LIMIT 1)").bind(t, t).run();
    pages[POSTS[0]] = () => new Response(htmlPost(1).replace('rotina', 'rotina antiga'), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    pages[POSTS[2]] = outside;
    await startAuthor(e, resend);
    expect((await line<{ n: number }>('SELECT COUNT(*) AS n FROM pautas WHERE tenant_id = ?', t))!.n).toBe(3);
    expect(created).toHaveLength(3);
    expect(queue).toHaveBeenCalledTimes(1);

    // After the last resend, it gives up (the feed monitor brings the text in the next round).
    pages[POSTS[3]] = () => new Response('fora do ar', { status: 503, headers: { 'content-type': 'text/html' } });
    await startAuthor(e, { tipo: 'autoral', tenantId: t, por: s.userId, urls: [POSTS[3]], tentativa: 3 });
    expect(queue).toHaveBeenCalledTimes(1);
  });

  it('queue down at signup: the outlet is created (with the feed in sources) and the response says 0 texts', async () => {
    const s = await register();
    vi.spyOn(env.MONITOR_QUEUE, 'send').mockRejectedValue(new Error('queue indisponível'));
    const res = await req('/api/tenants', { cookie: s.cookie, body: { modo: 'autoral', substack: ORIGIN, nome: 'Autora Sem Fila' } });
    expect(res.status).toBe(201);
    const body = await res.json<{ id: string; textos: number }>();
    expect(body.textos).toBe(0);
    expect(await line("SELECT COUNT(*) AS n FROM fontes WHERE tenant_id = ? AND tipo = 'rss'", body.id)).toEqual({ n: 1 });
    expect(await line("SELECT COUNT(*) AS n FROM eventos WHERE tenant_id = ? AND tipo = 'autoral.fila_falhou'", body.id)).toEqual({ n: 1 });
  });

  it("address that isn't Substack (no feed) gives an error in plain language; nothing is created", async () => {
    const s = await register();
    pages[`${ORIGIN}/feed`] = () => new Response('<html><body>não é feed</body></html>', { headers: { 'content-type': 'text/html' } });
    const res = await req('/api/tenants', { cookie: s.cookie, body: { modo: 'autoral', substack: ORIGIN, nome: 'Outra Autora' } });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'substack_sem_feed', erro: expect.stringContaining('Substack') });
    expect(await line("SELECT COUNT(*) AS n FROM tenants WHERE nome = 'Outra Autora'")).toEqual({ n: 0 });
    expect((await req('/api/tenants', { cookie: s.cookie, body: { modo: 'autoral', substack: 'http://localhost:8787' } })).status).toBe(400);
  });

  it('feed redirect: to another https host it follows; to an internal address it stops (nothing is read from there)', async () => {
    const OTHER = 'https://dominio-proprio.example';
    pages[`${ORIGIN}/feed`] = () => new Response(null, { status: 301, headers: { location: `${OTHER}/feed` } });
    pages[`${OTHER}/feed`] = () => new Response(FEED, { headers: { 'content-type': 'application/rss+xml' } });
    expect((await readSubstack(ORIGIN)).itens).toHaveLength(4);
    let internal = 0;
    pages[`${ORIGIN}/feed`] = () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:8787/feed' } });
    pages['http://127.0.0.1:8787/feed'] = () => { internal++; return new Response(FEED); };
    await expect(readSubstack(ORIGIN)).rejects.toBeInstanceOf(AuthorError);
    expect(internal).toBe(0);
  });

  it('auxiliary pieces: origin, theme color and opening', () => {
    expect(substackOrigin('fulana.substack.example/p/um-texto?utm=1')).toBe('https://fulana.substack.example');
    expect(substackOrigin('localhost')).toBeNull();
    expect(fromTopicColors('#ffd84d')).toEqual({ acento: '#ffd84d' });   // light: highlight, default background
    expect(fromTopicColors(null)).toBeUndefined();
    expect(opening('Primeira frase curta. Segunda frase também. Terceira frase que não entra porque já passou.')).toBe('Primeira frase curta. Segunda frase também. Terceira frase que não entra porque já passou.');
    expect(opening('x'.repeat(500))!.length).toBeLessThanOrEqual(301);
  });
});

const leadAuthor = (over: Partial<Lead> = {}): Lead => ({
  id: 'pauta-a', tenantId: 't', titulo: 'Contratos sem concorrência', resumo: null, editoria: 'politica', municipioIbge: null, cidade: null, bairro: null,
  fatos: [
    { id: 'f1', documentoId: 'd', tipo: 'trecho', texto: 'Eu passei a semana inteira lendo os relatórios da Câmara sobre o transporte.', municipioIbge: null, bairro: null, dataFato: null, fonteUrl: POSTS[0], fonteNome: 'Cartas da Orla' },
    { id: 'f2', documentoId: 'd', tipo: 'trecho', texto: 'O que encontrei não é escândalo, é rotina: contratos renovados sem concorrência, ano após ano.', municipioIbge: null, bairro: null, dataFato: null, fonteUrl: POSTS[0], fonteNome: 'Cartas da Orla' },
  ],
  marca: { nome: 'Cartas da Orla', assinatura: 'Ana Ribeiro', ctaUrl: ORIGIN, dominio: 'autora.substack.example', ctas: [{ titulo: 'Leia o texto completo', texto: 'O texto inteiro está em Cartas da Orla.', legenda: 'Texto completo: {link}' }] },
  voz: { exemplos: ['Eu passei a semana inteira lendo os relatórios da Câmara.'] },
  modo: 'autoral', ...over,
});

describe("drafting in the author's voice", () => {
  it('the system prompt sent to DeepSeek speaks of the author page, first person and examples; the caption closes with the text link, without "Fonte:"', async () => {
    deepseekAnswer = () => ({
      manchete: 'Contratos renovados sem concorrência, ano após ano', resumo: 'Rotina, não escândalo.',
      legenda: 'Passei a semana nos relatórios da Câmara.\n\nFonte: Cartas da Orla',
      cards: [
        { papel: 'capa', titulo: 'O problema é a rotina', frases: [] },
        { papel: 'o_que_aconteceu', titulo: 'Li os relatórios da Câmara', frases: [{ texto: 'Passei a semana lendo os relatórios do transporte.', fatoId: 'f1' }] },
        { papel: 'contexto', titulo: 'Sem concorrência', frases: [{ texto: 'Os contratos são renovados sem concorrência, ano após ano.', fatoId: 'f2' }] },
      ],
      visualBrief: { primary: 'pilha de relatórios sobre uma mesa', fatoIds: ['f1'] },
    });
    const lead = leadAuthor();
    const r = await draftPiece(env, { pauta: lead, formato: 'carrossel' });
    const { system } = deepseek[0];
    expect(system).toContain('own page on Instagram');
    expect(system).toContain('first person');
    expect(system).toContain('key ideas');
    expect(system).toContain('- Eu passei a semana inteira lendo os relatórios da Câmara.');
    expect(system).not.toContain('local news page');
    expect(system).toContain('Each sentence must cite the id of the fact');
    expect(r.legenda).toBe(`Passei a semana nos relatórios da Câmara.\n\nTexto completo: ${POSTS[0]}`);
    expect(r.cards.at(-1)).toEqual({ papel: 'convite', titulo: 'Leia o texto completo', frases: [{ texto: 'O texto inteiro está em Cartas da Orla.', fatoId: null }] });
    // The deterministic validation applies the same (the closing's link, with numbers, does not count).
    expect(validate(lead, r)).toMatchObject({ ok: true });
  });

  it('local outlet keeps the portal prompt and the "Fonte:"', async () => {
    deepseekAnswer = () => ({ manchete: 'M', resumo: 'R', legenda: 'L', cards: [{ papel: 'capa', titulo: 'T', frases: [{ texto: 'x', fatoId: 'f1' }] }] });
    const r = await draftPiece(env, { pauta: leadAuthor({ modo: 'local', marca: { nome: 'Gazeta' } }), formato: 'post' });
    expect(deepseek[0].system).toContain('a writer for a local news page');
    expect(r.legenda).toMatch(/\nFonte: Cartas da Orla$/);
  });

  it('without a configured CTA, the author outlet uses the author default CTA (never the "Seu bairro, com fonte.")', () => {
    const p = leadAuthor({ marca: { nome: 'Cartas da Orla', ctaUrl: ORIGIN } });
    expect(chooseCta(p)).toEqual({ titulo: 'Leia o texto completo', texto: 'O texto inteiro está em Cartas da Orla.', legenda: 'Texto completo: {link}' });
    // A text from Docs (no published post): the link is the Substack one.
    const docs = leadAuthor({ fatos: leadAuthor().fatos.map((f) => ({ ...f, fonteUrl: 'relato:abc' })) });
    expect(closingCaption(docs)).toBe(`\n\nTexto completo: ${ORIGIN}`);
  });
});

describe('author card', () => {
  const card = (role: Card['papel']): Card => ({ papel: role, titulo: 'Li os relatórios da Câmara', frases: [{ texto: 'Passei a semana nos relatórios.', fatoId: 'f1' }] });

  it('no date or news eyebrow; the footer signs with the author, linked to the post', () => {
    const p = leadAuthor();
    for (const role of ['capa', 'o_que_aconteceu', 'contexto'] as const) {
      expect(varsCard(p, card(role), 'carrossel')).toMatchObject({
        DATE_LABEL: '', DATE_VALUE: '', EYEBROW: 'politica', FOOTER_LABEL: '', SOURCE_NAME: 'Ana Ribeiro', SOURCE_URL: POSTS[0], DOMAIN: 'autora.substack.example',
      });
    }
    expect(varsCard(leadAuthor({ editoria: null }), card('o_que_aconteceu'), 'carrossel').EYEBROW).toBe('');
    expect(varsCard(p, card('convite'), 'carrossel')).toMatchObject({ EYEBROW: '', SOURCE_NAME: '', FOOTER_LABEL: '' });
    // Without a signature: the outlet's name.
    expect(varsCard(leadAuthor({ marca: { nome: 'Cartas da Orla' } }), card('capa'), 'carrossel').SOURCE_NAME).toBe('Cartas da Orla');
  });

  it("the local outlet card doesn't change", () => {
    const local = leadAuthor({ modo: 'local', bairro: 'Centro' });
    expect(varsCard(local, card('o_que_aconteceu'), 'carrossel', new Date('2026-11-02T15:00:00Z'))).toMatchObject({
      DATE_LABEL: 'Publicação', EYEBROW: 'O que aconteceu', FOOTER_LABEL: 'Fonte:', SOURCE_NAME: 'Cartas da Orla', SOURCE_URL: POSTS[0],
    });
    expect(varsCard(local, card('capa'), 'carrossel').EYEBROW).toBe('politica · Centro');
  });

  it('the browser preview shows the same author card', () => {
    const html = htmlPreview({ nome: 'Cartas da Orla', handle: '', cores: DEFAULT_COLORS, logo: null, local: '', autoral: { assinatura: 'Ana Ribeiro', dominio: 'autora.substack.example' } });
    expect(html).not.toContain('Publicação');
    expect(html).not.toContain('Fonte:');
    expect(html).toContain('Ana Ribeiro');
    expect(html).toContain('autora.substack.example');
    expect(htmlPreview({ nome: 'G', handle: '@g', cores: DEFAULT_COLORS, logo: null, local: 'Santos' })).toContain('Fonte:');
  });
});

describe('reading Google Docs', () => {
  const envGoogle = () => ({ ...env, GOOGLE_CLIENT_ID: 'cliente.apps.example', GOOGLE_CLIENT_SECRET: 'segredo-ficticio', GOOGLE_API_KEY: 'chave-ficticia', GOOGLE_PROJECT_NUMBER: '123456' });
  const DOC = {
    documentId: 'doc-ficticio-123', title: 'Rascunho: contratos do transporte', revisionId: 'rev-1',
    body: { content: [
      { sectionBreak: {} },
      { startIndex: 1, endIndex: 30, paragraph: { paragraphStyle: { namedStyleType: 'TITLE' }, elements: [{ textRun: { content: 'Contratos sem concorrência\n' } }] } },
      { startIndex: 30, endIndex: 31, paragraph: { elements: [{ textRun: { content: '\n' } }] } },
      { startIndex: 31, endIndex: 120, paragraph: { paragraphStyle: { namedStyleType: 'NORMAL_TEXT' }, elements: [
        { textRun: { content: 'Eu li os relatórios da Câmara ', textStyle: {} } },
        { textRun: { content: 'durante a semana', textStyle: { bold: true } } },
        { textRun: { content: '.\n', textStyle: {} } },
      ] } },
      { startIndex: 120, endIndex: 200, table: { tableRows: [] } },
    ] },
  };

  async function withGoogleAccount(o: { expira: number; refresh?: boolean; escopo?: string }) {
    const s = await register();
    await env.DB.prepare(`INSERT INTO account (id, "accountId", "providerId", "userId", "accessToken", "refreshToken", "accessTokenExpiresAt", scope, "createdAt", "updatedAt")
      VALUES (?, ?, 'google', ?, 'token-velho', ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), `g-${s.userId}`, s.userId, o.refresh === false ? null : 'refresh-ficticio', new Date(Date.now() + o.expira).toISOString(),
        o.escopo ?? 'openid,email,profile,https://www.googleapis.com/auth/drive.file', new Date().toISOString(), new Date().toISOString()).run();
    return s;
  }

  it('Docs paragraphs: text, position and style; empty ones and tables stay out', () => {
    expect(paragraphsDoc(DOC.body)).toEqual([
      { texto: 'Contratos sem concorrência', inicio: 1, fim: 30, estilo: 'TITLE', html: 'Contratos sem concorrência', aba: null },
      { texto: 'Eu li os relatórios da Câmara durante a semana.', inicio: 31, fim: 120, estilo: 'NORMAL_TEXT', html: 'Eu li os relatórios da Câmara <b>durante a semana</b>.', aba: null },
    ]);
  });

  it('expired token is renewed by Better Auth before reading; the document arrives with title and revision', async () => {
    const s = await withGoogleAccount({ expira: -60_000 });
    pages['https://oauth2.googleapis.com/token'] = () => Response.json({ access_token: 'token-novo', expires_in: 3600, token_type: 'Bearer' });
    pages[`https://docs.googleapis.com/v1/documents/${DOC.documentId}`] = () => Response.json(DOC);
    const doc = await readDocument(envGoogle(), s.userId, DOC.documentId);
    expect(doc).toMatchObject({ id: DOC.documentId, titulo: 'Rascunho: contratos do transporte', revisao: 'rev-1' });
    expect(doc.paragrafos.map((p) => p.texto)).toEqual(['Contratos sem concorrência', 'Eu li os relatórios da Câmara durante a semana.']);
    expect(authorizations).toEqual(['Bearer token-novo']);
    // The accepted text (without pending suggestions) and all tabs.
    const q = new URL(requestsDocs[0]).searchParams;
    expect(q.get('suggestionsViewMode')).toBe('PREVIEW_WITHOUT_SUGGESTIONS');
    expect(q.get('includeTabsContent')).toBe('true');
    const account = await line<{ accessToken: string }>('SELECT "accessToken" FROM account WHERE "userId" = ?', s.userId);
    expect(account!.accessToken).not.toBe('token-velho');
  });

  it('with no renewal possible, document without access and account without the scope: errors with the action', async () => {
    const expired = await withGoogleAccount({ expira: -60_000, refresh: false });
    await expect(readDocument(envGoogle(), expired.userId, DOC.documentId)).rejects.toMatchObject({ codigo: 'reconectar', message: expect.stringContaining('Conecte de novo') });

    const ok = await withGoogleAccount({ expira: 3600_000 });
    pages[`https://docs.googleapis.com/v1/documents/${DOC.documentId}`] = () => new Response('{}', { status: 403 });
    await expect(readDocument(envGoogle(), ok.userId, DOC.documentId)).rejects.toMatchObject({ codigo: 'sem_acesso', status: 404 });

    const withoutScope = await withGoogleAccount({ expira: 3600_000, escopo: 'openid,email,profile' });
    await expect(readDocument(envGoogle(), withoutScope.userId, DOC.documentId)).rejects.toMatchObject({ codigo: 'sem_conta' });
  });

  it('document with tabs and subtabs: the paragraphs of all of them, in order, each with its own tab', async () => {
    const s = await withGoogleAccount({ expira: 3600_000 });
    const body = (text: string) => ({ content: [{ startIndex: 1, endIndex: text.length + 2, paragraph: { elements: [{ textRun: { content: `${text}\n` } }] } }] });
    pages[`https://docs.googleapis.com/v1/documents/${DOC.documentId}`] = () => Response.json({
      documentId: DOC.documentId, title: 'Com abas', revisionId: 'rev-2',
      tabs: [
        { tabProperties: { tabId: 't.0' }, documentTab: { body: body('Primeira aba.') }, childTabs: [{ tabProperties: { tabId: 't.1' }, documentTab: { body: body('Subaba.') } }] },
        { tabProperties: { tabId: 't.2' }, documentTab: { body: body('Segunda aba.') } },
      ],
    });
    const doc = await readDocument(envGoogle(), s.userId, DOC.documentId);
    expect(doc.paragrafos.map((p) => [p.aba, p.texto])).toEqual([['t.0', 'Primeira aba.'], ['t.1', 'Subaba.'], ['t.2', 'Segunda aba.']]);
  });

  it('signed in with a Google account without Docs after connecting Docs with another: the account with the scope counts', async () => {
    const s = await withGoogleAccount({ expira: 3600_000 });
    const after = new Date(Date.now() + 60_000).toISOString();
    await env.DB.prepare(`INSERT INTO account (id, "accountId", "providerId", "userId", "accessToken", "accessTokenExpiresAt", scope, "createdAt", "updatedAt")
      VALUES (?, ?, 'google', ?, 'token-do-login', ?, 'openid,email,profile', ?, ?)`)
      .bind(crypto.randomUUID(), `login-${s.userId}`, s.userId, new Date(Date.now() + 3600_000).toISOString(), after, after).run();
    pages[`https://docs.googleapis.com/v1/documents/${DOC.documentId}`] = () => Response.json(DOC);
    await readDocument(envGoogle(), s.userId, DOC.documentId);
    expect(authorizations).toEqual(['Bearer token-velho']);
  });

  it("the Better Auth routes that return account tokens don't exist for the screen", async () => {
    const s = await withGoogleAccount({ expira: 3600_000 });
    for (const route of ['/api/auth/refresh-token', '/api/auth/get-access-token']) {
      const res = await req(route, { cookie: s.cookie, body: { providerId: 'google' } });
      expect(res.status, route).toBe(404);
      expect(await res.text()).not.toContain('refresh-ficticio');
    }
  });

  it('without the Google setup, the routes respond 404 and /me says google: null', async () => {
    const s = await register();
    const t = await tenantAuthor();
    await seedMember(t, s.userId, 'admin');
    expect((await req('/api/google/token', { cookie: s.cookie })).status).toBe(404);
    expect((await req(`/api/t/${t}/pautas`, { cookie: s.cookie, body: { docs: DOC.documentId } })).status).toBe(404);
    expect(await (await req('/api/me', { cookie: s.cookie })).json()).toMatchObject({ google: null });
  });
});
