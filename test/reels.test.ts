// Phase 4: Reels as an animated 9:16 carousel. HyperFrames composition, music library, the Reels request from a
// carousel (editor and up, checked carousel, per-outlet isolation), the Workflow step that sends the cards to the
// Container and stores the MP4 in R2, and publishing: a manual package with the MP4 and `media_type=REELS` in real mode
// (simulated). The Container does not run in vitest: `containerReels.render` is swapped for a fake that returns a dummy MP4.
import { DEFAULT_PARAMS } from '../src/lib/style';
import { env, introspectWorkflow } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { composicaoReels, containerReels, escoparCss, splitFiles, temposReels, totalReels, type ReelsRequest } from '../src/lib/reels';
import { MANIFEST_MUSIC, libraryMusical } from '../src/lib/music';
import type { MetricsLayout } from '../src/lib/qaLayout';
import { browserApi } from '../src/lib/render';
import { packagePublication } from '../src/lib/publish';
import { failProduction } from '../src/workflows/production';
import type { Card } from '../src/lib/cards';
import { register, eventsOf, req, seedAccount, seedMember, seedLead, seedTenant, statusOf } from './helpers';

const MP4 = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);
const JPEG_COVER = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const METRICS_916: MetricsLayout = { width: 1080, height: 1920, overflow: [], overlap: false, headlineLines: 2, imagesLoaded: true, badText: false, fontsReady: true };
let requests: ReelsRequest[] = [];
let failWith = false;
/** Cards loaded in the fake browser, with the requested height; `reprovar`: which HTML comes out with overflowing text. */
let frameList: { html: string; altura: number }[] = [];
let fail: ((html: string) => boolean) | null = null;

function fakeBrowser() {
  let html = '';
  let height = 0;
  const page = {
    route: async () => {},
    setContent: async (h: string) => { html = h; frameList.push({ html: h, altura: height }); },
    evaluate: async () => (fail?.(html) ? { ...METRICS_916, overflow: ['story'] } : METRICS_916),
    locator: () => ({ screenshot: async () => JPEG_COVER }),
  };
  return Promise.resolve({ newPage: async (o: { viewport: { height: number } }) => { height = o.viewport.height; return page; }, close: async () => {} });
}

beforeEach(() => {
  requests = [];
  failWith = false;
  frameList = [];
  fail = null;
  vi.spyOn(browserApi, 'abrir').mockImplementation(fakeBrowser as never);
  vi.spyOn(containerReels, 'render').mockImplementation(async (_env, _piece, request) => {
    requests.push(request);
    return failWith ? Response.json({ erro: 'chrome caiu' }, { status: 500 }) : new Response(MP4, { headers: { 'content-type': 'video/mp4' } });
  });
});
afterEach(() => vi.restoreAllMocks());

async function member(role: 'admin' | 'editor' | 'reporter' = 'editor') {
  const s = await register();
  const t = await seedTenant();
  await seedMember(t, s.userId, role);
  return { s, t };
}

const cardsCarousel = (f1: string, f2: string): Card[] => [
  { id: 'c1', layout: 'capa', titulo: 'Ponte da Santos Dumont fecha para obras', frases: [] },
  { id: 'c2', layout: 'texto', titulo: 'A prefeitura interdita a ponte', frases: [{ texto: 'A prefeitura interdita a ponte para obras.', fatoId: f1 }] },
  { id: 'c3', layout: 'numero', titulo: '15 dias', frases: [{ texto: 'A interdição dura 15 dias.', fatoId: f2 }] },
  { id: 'convite', layout: 'convite', titulo: 'Seu bairro, com fonte.', frases: [{ texto: 'Siga a página.', fatoId: null }] },
];

async function carousel(t: string, o: { status?: string; validacaoOk?: boolean; formato?: string } = {}) {
  const { pautaId: leadId, fatos: facts } = await seedLead(t, 'em_producao');
  const id = crypto.randomUUID();
  const cards = cardsCarousel(facts[0].id, facts[1].id);
  const content = { manchete: 'Ponte da Santos Dumont fecha para obras', resumo: '', legenda: 'A ponte fecha para obras.\n\nSiga a página.\n\nFonte: Prefeitura', cards, modelo: 'ia', custoUsd: 0 };
  const artwork = cards.map((c, i) => ({ papel: c.layout, id: c.id, layout: c.layout, png: `artes/${t}/${id}/v1/0${i + 1}.png`, jpg: `artes/${t}/${id}/v1/0${i + 1}.jpg`, hash: `h${i}`, metricas: {} }));
  const validation = o.validacaoOk === false ? '{"ok":false,"erros":["x"],"avisos":[]}' : '{"ok":true,"erros":[],"avisos":[]}';
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO pecas (id, tenant_id, pauta_id, formato, status, versao, rodada, conteudo_json, validacao_json, arte_r2_keys_json, workflow_id)
                    VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?)`).bind(id, t, leadId, o.formato ?? 'carrossel', o.status ?? 'revisao', JSON.stringify(content), validation, JSON.stringify(artwork), `${id}-r1`),
    env.DB.prepare("INSERT INTO peca_versoes (id, tenant_id, peca_id, versao, rodada, conteudo_json, autor) VALUES (?, ?, ?, 1, 1, ?, 'ia')").bind(crypto.randomUUID(), t, id, JSON.stringify(content)),
  ]);
  return { id, pautaId: leadId, fatos: facts };
}

const makeReels = (s: { cookie: string }, t: string, id: string, music: string | null = null, version = 1, pace: object = {}) =>
  req(`/api/t/${t}/pecas/${id}/reels`, { cookie: s.cookie, body: { musica: music, versao: version, ...pace } });

async function library(bands: unknown[]) {
  await env.MEDIA.put(MANIFEST_MUSIC, JSON.stringify({ faixas: bands }));
}
const BAND = { id: 'manha-calma', titulo: 'Manhã calma', autor: 'Autora Fictícia', licenca: 'Licença de teste', licencaUrl: 'https://licenca.example/manha-calma', arquivo: 'musica/manha-calma.mp3', usoComercial: true };

/** Runs the Reels production requested through the API to the end (the Container fake answers at once). */
async function produceReels(s: { cookie: string }, t: string, id: string, music: string | null = null, pace: object = {}) {
  const intro = await introspectWorkflow(env.PRODUCAO_WORKFLOW);
  try {
    await intro.modifyAll(async (m) => { await m.disableRetryDelays(); });
    const res = await makeReels(s, t, id, music, 1, pace);
    expect(res.status).toBe(201);
    const { pecaId: pieceId } = await res.json<{ pecaId: string }>();
    const [inst] = await intro.get();
    await inst.waitForStatus('complete');
    return pieceId;
  } finally {
    await intro.dispose();
  }
}

describe('HyperFrames composition', () => {
  it('each card becomes a scene with scoped CSS; a paused timeline at __timelines["reels"]; no clock or randomness', () => {
    const card = (h1: string) => `<html class="export r916"><head><style>:root { --bg: #000; } .card { height: 1350px; } .r916 .card { height: 1920px; } h1 { color: red; }</style></head><body><article class="card"><header></header><h1>${h1}</h1><div class="story"></div></article></body></html>`;
    expect(escoparCss(':root { --bg: #000; } .r916 .card { height: 1920px; } h1, h2 { margin: 0 }', 'c2').css)
      .toBe('#c2{ --bg: #000; }\n#c2 .card{ height: 1920px; }\n#c2 h1, #c2 h2{ margin: 0 }');
    const html = composicaoReels({ cards: [card('A'), card('B'), card('C'), card('D')], tempos: [3.75, 3.75, 3.75, 3.75], movimento: 'manchete' });
    expect(html).toContain('data-composition-id="reels"');
    expect(html).toContain('data-width="1080" data-height="1920" data-duration="15"');
    expect(html.match(/class="clip cena"/g)).toHaveLength(4);
    expect(html).toContain('id="c4" class="clip cena" data-start="11.25" data-duration="3.75"');
    expect(html).toContain('gsap.timeline({ paused: true })');
    expect(html).toContain('window.__timelines["reels"] = tl;');
    expect(html).not.toMatch(/Math\.random|Date\.now|new Date|fetch\(/);
    expect(html).not.toContain('<audio');
    // First frame: card 1 stays whole, and only the art moves. The others enter.
    expect(html).toContain("tl.fromTo('#c1 .art'");
    expect(html).not.toMatch(/tl\.fromTo\('#c1 (header|\.story)'/);
    expect(html).toContain("tl.fromTo('#c2 header'");
    expect(html).toContain("tl.fromTo('#c2 .story'");
    expect(composicaoReels({ cards: [card('A'), card('B')], tempos: [3.75, 3.75], movimento: 'seco', musica: 'musica.mp3' }))
      .toContain('<audio id="musica" src="musica.mp3" data-start="0" data-duration="7.5" data-volume="0.5"></audio>');
  });
});

describe('Reels pacing', () => {
  const text = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`).join(' ');
  const c = (n: number) => ({ layout: 'texto', titulo: '', frases: [{ texto: text(n) }] });

  it('2 s plus 0.35 s per word, between 2.5 and 7 s; CTA at 3.75 s; the step multiplies', () => {
    expect(temposReels([c(10), { layout: 'convite', titulo: text(40) }])).toEqual([5.5, 3.75]);
    expect(temposReels([c(0), c(100), c(10)])).toEqual([2.5, 7, 5.5]);
    expect(temposReels([c(10), c(10)], 0.8)).toEqual([4.4, 4.4]);
    expect(temposReels([c(10), c(10)], 1.25)).toEqual([6.875, 6.875]);
    // The carousel's cover only shows the title.
    expect(temposReels([{ layout: 'capa', titulo: text(4), frases: [{ texto: text(90) }] }, c(10)])[0]).toBe(3.4);
  });

  it('the total stays between 7.5 and 60 s, with proportional adjustment', () => {
    const short = temposReels([c(0), c(0)]);
    expect(totalReels(short)).toBe(7.5);
    expect(short).toEqual([3.75, 3.75]);
    const long = temposReels(Array.from({ length: 10 }, () => c(50)));
    expect(totalReels(long)).toBe(60);
    expect(new Set(long)).toEqual(new Set([6]));
    expect(totalReels(temposReels(Array.from({ length: 10 }, (_, i) => c(10 + i * 7)), 1.25))).toBeLessThanOrEqual(60);
  });

  const article = (body: string) => `<html><head><style>.card{}</style></head><body><article class="card"><header></header><div class="story"><h1>T</h1>${body}</div></article></body></html>`;
  const body = '<p class="story-body"><span class="frase-rl">Uma.</span> <span class="frase-rl">Duas.</span></p>';

  it('the three movements: the first frame is the same in all three, and none moves text', () => {
    for (const motion of ['seco', 'manchete', 'folha'] as const) {
      const html = composicaoReels({ cards: [article(body), article(body), article('')], tempos: [4, 5, 3], movimento: motion });
      expect(html).toContain('data-height="1920" data-duration="12"');
      expect(html).toContain("tl.fromTo('#c1 .art'");
      expect(html).not.toMatch(/tl\.fromTo\('#c1( |')(?!\.art)/);
      // A number does not count: the card's text is the same from the first to the last frame.
      expect(html).not.toMatch(/onUpdate|textContent|innerText|innerHTML|snap|TextPlugin|blur/);
    }
  });

  it('seco: only the art moves', () => {
    const html = composicaoReels({ cards: [article(body), article(body)], tempos: [4, 4], movimento: 'seco' });
    expect(html.match(/tl\.fromTo/g)).toHaveLength(2);
    expect(html).toContain('id="c1" class="clip cena" data-start="0" data-duration="4" data-track-index="0"');
  });

  it('manchete: title, then the sentences one by one; a card without a marked sentence rises whole', () => {
    const html = composicaoReels({ cards: [article(body), article(body), article('')], tempos: [4, 5, 3], movimento: 'manchete' });
    expect(html).toContain("tl.fromTo('#c2 .location, #c2 h1'");
    expect(html).toContain("tl.fromTo('#c2 .frase-rl', { opacity: 0 }, { opacity: 1, duration: 0.4, ease: 'power1.out', stagger: 0.9 }, 4.75);");
    expect(html).toContain("tl.fromTo('#c3 .story'");
    expect(html).not.toContain("'#c3 .frase-rl'");
  });

  it('folha: the next card slides over the previous one, on alternating tracks', () => {
    const html = composicaoReels({ cards: [article(body), article(body), article('')], tempos: [4, 5, 3], movimento: 'folha' });
    expect(html).toContain("tl.fromTo('#c2', { xPercent: 100 }");
    expect(html).not.toContain("tl.fromTo('#c1', ");
    expect(html).toContain('id="c1" class="clip cena" data-start="0" data-duration="4.5" data-track-index="0"');
    expect(html).toContain('id="c2" class="clip cena" data-start="4" data-duration="5.5" data-track-index="1"');
    expect(html).toContain('id="c3" class="clip cena" data-start="9" data-duration="3" data-track-index="0"');
  });
});

describe('music library', () => {
  it('only tracks with title, author, license and a https license link get in; without a manifest, none', async () => {
    expect(await libraryMusical(env)).toEqual([]);
    await library([
      BAND,
      { ...BAND, id: 'sem-licenca', licenca: '' },
      { ...BAND, id: 'link-http', licencaUrl: 'http://licenca.example' },
      { ...BAND, id: 'Fora do Padrão' },
      { ...BAND, id: 'fora-da-pasta', arquivo: 'outra/coisa.mp3' },
      { ...BAND, titulo: 'Repetida' },
      // The licence text authorises nothing by itself: only with the owner's confirmation, and without requiring credit.
      { ...BAND, id: 'sem-confirmacao', licenca: 'Uso exclusivamente não comercial', usoComercial: undefined },
      { ...BAND, id: 'confirmacao-texto', usoComercial: 'sim' },
      { ...BAND, id: 'exige-credito', exigeCredito: true },
    ]);
    expect((await libraryMusical(env)).map((f) => f.id)).toEqual(['manha-calma']);
    const { s, t } = await member('reporter');
    const r = await req(`/api/t/${t}/musicas`, { cookie: s.cookie });
    expect(r.status).toBe(200);
    // The R2 key does not go to the screen.
    expect(await r.json()).toEqual({ musicas: [{ id: 'manha-calma', titulo: 'Manhã calma', autor: 'Autora Fictícia', licenca: 'Licença de teste', licencaUrl: 'https://licenca.example/manha-calma' }] });
    const foreign = await register();
    expect((await req(`/api/t/${t}/musicas`, { cookie: foreign.cookie })).status).toBe(404);
  });
});

describe('request the Reels of a carousel', () => {
  it("editor requests; reporter doesn't; another outlet is 404; a carousel with a problem, a post, and music outside the library are refused", async () => {
    const { s, t } = await member('editor');
    const { id } = await carousel(t);
    const reporter = await register();
    await seedMember(t, reporter.userId, 'reporter');
    expect((await makeReels(reporter, t, id)).status).toBe(403);
    const { s: foreign, t: other } = await member('editor');
    expect((await makeReels(foreign, t, id)).status).toBe(404);
    expect((await makeReels(foreign, other, id)).status).toBe(404);
    expect((await makeReels(s, t, id, 'nao-existe')).status).toBe(400);
    // The version the person saw: without it, 400; another (someone saved afterwards), 409.
    expect((await req(`/api/t/${t}/pecas/${id}/reels`, { cookie: s.cookie, body: { musica: null } })).status).toBe(400);
    const old = await makeReels(s, t, id, null, 7);
    expect(old.status).toBe(409);
    expect((await old.json<{ erro: string }>()).erro).toContain('outra pessoa salvou antes');
    const bad = await carousel(t, { validacaoOk: false });
    const r409 = await makeReels(s, t, bad.id);
    expect(r409.status).toBe(409);
    expect(await r409.json()).toEqual({ erro: 'a conferência apontou problema num card do carrossel; corrija antes de fazer o Reels' });
    expect((await makeReels(s, t, (await carousel(t, { formato: 'post' })).id)).status).toBe(400);
    expect((await makeReels(s, t, (await carousel(t, { status: 'rejeitada' })).id)).status).toBe(409);
    // The reels format is not requested from a lead: only from a carousel.
    const { pautaId: leadId } = await seedLead(t, 'aceita');
    expect((await req(`/api/t/${t}/pautas/${leadId}/produzir`, { cookie: s.cookie, body: { formato: 'reels' } })).status).toBe(400);
  });

  it("the Workflow sends the 9:16 cards to the Container and writes the MP4 to R2; the Reels stays in review and the lead doesn't change", async () => {
    const { s, t } = await member('editor');
    await library([BAND]);
    await env.MEDIA.put(BAND.arquivo, new Uint8Array([1, 2, 3]));
    const { id, pautaId: leadId } = await carousel(t);
    const reels = await produceReels(s, t, id, BAND.id);

    expect(await statusOf('pecas', reels)).toBe('revisao');
    expect(await statusOf('pautas', leadId)).toBe('em_producao');
    const line = await env.DB.prepare('SELECT formato, pauta_id, conteudo_json, validacao_json, arte_r2_keys_json FROM pecas WHERE id = ?').bind(reels)
      .first<{ formato: string; pauta_id: string; conteudo_json: string; validacao_json: string; arte_r2_keys_json: string }>();
    expect(line).toMatchObject({ formato: 'reels', pauta_id: leadId });
    const content = JSON.parse(line!.conteudo_json);
    expect(content.origem).toEqual({ pecaId: id, versao: 1 });
    expect(content.musica).toBe(BAND.id);
    expect(content.legenda).toBe('A ponte fecha para obras.\n\nSiga a página.\n\nFonte: Prefeitura');
    expect(JSON.parse(line!.validacao_json).ok).toBe(true);
    const [art] = JSON.parse(line!.arte_r2_keys_json);
    expect(art).toMatchObject({ papel: 'reels', jpg: `artes/${t}/${id}/v1/01.jpg`, duracao: 18.85, musica: BAND.id, metricas: METRICS_916 });
    expect(art.mp4).toMatch(new RegExp(`^reels/${t}/${reels}/v1-[0-9a-f]{16}\\.mp4$`));
    // Real QA at 1080×1920, card by card, and the 9:16 cover beside the MP4.
    expect(frameList).toHaveLength(4);
    expect(frameList.every((q) => q.altura === 1920 && q.html.includes('class="export r916"'))).toBe(true);
    expect(art.capaReels).toBe(art.mp4.replace('.mp4', '-capa.jpg'));
    const cover = await env.MEDIA.get(art.capaReels);
    expect(cover?.httpMetadata?.contentType).toBe('image/jpeg');
    expect([...new Uint8Array(await cover!.arrayBuffer())]).toEqual([...JPEG_COVER]);
    const mp4 = await env.MEDIA.get(art.mp4);
    expect(mp4?.httpMetadata?.contentType).toBe('video/mp4');

    // The request to the Container: the composition with the 4 cards in 9:16 and the library's music, in base64.
    expect(requests).toHaveLength(1);
    expect(requests[0].duracao).toBe(18.85);
    // Only in 9:16 each sentence comes marked, and each card stays as long as its text.
    expect(requests[0].html).toContain('<span class="frase-rl">A interdição dura 15 dias.</span>');
    expect(requests[0].html).toContain('id="c2" class="clip cena" data-start="4.45" data-duration="6.2"');
    expect(requests[0].html.match(/class="clip cena"/g)).toHaveLength(4);
    expect(requests[0].html).toContain('#c1 .card{ height: 1920px; }');
    expect(requests[0].html).toContain('<audio id="musica" src="musica.mp3"');
    expect(requests[0].arquivos).toContainEqual({ nome: 'musica.mp3', base64: 'AQID' });
    expect(requests[0].html).not.toContain('data:image/');

    // The screen receives the signed video.
    const body = await (await req(`/api/t/${t}/pecas/${reels}`, { cookie: s.cookie })).json<{ artes: { mp4: string | null }[] }>();
    expect(body.artes[0].mp4).toContain(`/media/reels/${t}/${reels}/`);
  });

  it("step and movement: the screen decides; without them, the carousel template one applies; outside the catalog, 400", async () => {
    const { s, t } = await member('editor');
    const { id } = await carousel(t);
    const style = { id: 'e', versao: 1, params: { ...DEFAULT_PARAMS, reels: { passo: 1.25, movimento: 'folha' } }, marcaVisual: {} };
    await env.DB.prepare("UPDATE pecas SET conteudo_json = json_set(conteudo_json, '$.estilo', json(?)) WHERE id = ?").bind(JSON.stringify(style), id).run();
    const body = (extra: object) => req(`/api/t/${t}/pecas/${id}/reels`, { cookie: s.cookie, body: { musica: null, versao: 1, ...extra } });
    expect((await body({ passo: 2 })).status).toBe(400);
    expect((await body({ movimento: 'zoom' })).status).toBe(400);
    expect((await body({ passo: '1' })).status).toBe(400);
    await produceReels(s, t, id);
    expect(requests[0].html).toContain("{ xPercent: 100 }");
    expect(requests[0].html).toMatch(/id="c1" class="clip cena" data-start="0" data-duration="6.06[23]"/);
    await produceReels(s, t, id, null, { passo: 0.8, movimento: 'seco' });
    expect(requests[1].html).not.toContain('xPercent');
    expect(requests[1].html).toContain('id="c1" class="clip cena" data-start="0" data-duration="3.56" data-track-index="0"');
  });

  it("Container failed: the Reels fails with the reason and the carousel's lead stays where it was", async () => {
    const { s, t } = await member('editor');
    const { id, pautaId: leadId } = await carousel(t);
    failWith = true;
    const intro = await introspectWorkflow(env.PRODUCAO_WORKFLOW);
    let reels = '';
    try {
      await intro.modifyAll(async (m) => { await m.disableRetryDelays(); });
      reels = (await (await makeReels(s, t, id)).json<{ pecaId: string }>()).pecaId;
      const [inst] = await intro.get();
      await inst.waitForStatus('errored');
    } finally {
      await intro.dispose();
    }
    expect(await statusOf('pecas', reels)).toBe('falhou');
    expect(await statusOf('pautas', leadId)).toBe('em_producao');
    // The same rule on the direct path (replay of the failed step).
    await failProduction(env, { tenantId: t, pecaId: reels, pautaId: leadId, formato: 'reels' }, `${reels}-r1`, 'x');
    expect(await statusOf('pautas', leadId)).toBe('em_producao');
  });
});

describe('9:16 frame QA', () => {
  it("a card that doesn't fit upright fails production without retrying, saying which card, and nothing goes to the Container", async () => {
    const { s, t } = await member('editor');
    const { id, pautaId: leadId } = await carousel(t);
    fail = (html) => html.includes('A prefeitura interdita a ponte para obras.');
    const intro = await introspectWorkflow(env.PRODUCAO_WORKFLOW);
    let reels = '';
    try {
      reels = (await (await makeReels(s, t, id)).json<{ pecaId: string }>()).pecaId;
      const [inst] = await intro.get();
      await inst.waitForStatus('errored');
    } finally {
      await intro.dispose();
    }
    expect(await statusOf('pecas', reels)).toBe('falhou');
    expect(await statusOf('pautas', leadId)).toBe('em_producao');
    expect(requests).toHaveLength(0);
    expect(frameList).toHaveLength(2);
    const st = await (await req(`/api/t/${t}/pecas/${reels}/status`, { cookie: s.cookie })).json<{ erro: string }>();
    expect(st.erro).toMatch(/layout 9:16 rejected on card 2 \(texto\)/);
  });
});

describe('fixes from the Phase 4 review', () => {
  it('repeated images go to the Container only once, cited by name', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    const { html, arquivos: files } = splitFiles(`<img src="${png}"><img src="${png}"><img src="data:image/svg+xml;base64,PHN2Zz4="><style>@font-face{src:url(data:font/woff2;base64,d09GMg==)}</style>`);
    expect(files).toEqual([{ nome: 'a1.png', base64: 'iVBORw0KGgo=' }, { nome: 'a2.svg', base64: 'PHN2Zz4=' }]);
    expect(html).toBe('<img src="a1.png"><img src="a1.png"><img src="a2.svg"><style>@font-face{src:url(data:font/woff2;base64,d09GMg==)}</style>');
  });

  it('repeated request while a Reels of the same carousel is being assembled: 409, no second post', async () => {
    const { s, t } = await member('editor');
    const { id } = await carousel(t);
    const intro = await introspectWorkflow(env.PRODUCAO_WORKFLOW);
    try {
      // The first production stays stuck in the Container (it does not answer).
      vi.mocked(containerReels.render).mockImplementation(() => new Promise(() => {}));
      const first = await makeReels(s, t, id);
      expect(first.status).toBe(201);
      const repeated = await makeReels(s, t, id);
      expect(repeated.status).toBe(409);
      expect(await repeated.json()).toMatchObject({ erro: 'já há um Reels deste carrossel sendo montado', pecaId: (await first.json<{ pecaId: string }>()).pecaId });
      expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM pecas WHERE tenant_id = ? AND formato = 'reels'").bind(t).first<{ n: number }>())?.n).toBe(1);
    } finally {
      await intro.dispose();
    }
  });

  it('Reels art is the one from the time of the request, even if the carousel changes later', async () => {
    const { s, t } = await member('editor');
    const { id } = await carousel(t);
    const intro = await introspectWorkflow(env.PRODUCAO_WORKFLOW);
    let reels = '';
    try {
      await intro.modifyAll(async (m) => { await m.disableRetryDelays(); });
      reels = (await (await makeReels(s, t, id)).json<{ pecaId: string }>()).pecaId;
      // Someone else edits the carousel right after the request: the art now belongs to another version.
      await env.DB.prepare("UPDATE pecas SET versao = 2, arte_r2_keys_json = json_set(arte_r2_keys_json, '$[0].jpg', 'artes/outra/v2.jpg') WHERE id = ?").bind(id).run();
      const [inst] = await intro.get();
      await inst.waitForStatus('complete');
    } finally {
      await intro.dispose();
    }
    const [art] = JSON.parse((await env.DB.prepare('SELECT arte_r2_keys_json AS a FROM pecas WHERE id = ?').bind(reels).first<{ a: string }>())!.a);
    expect(art.jpg).toBe(`artes/${t}/${id}/v1/01.jpg`);
  });

  it('Reels published after the carousel is rejected: the publication stands and the lead stays discarded', async () => {
    const { s, t } = await member('editor');
    const account = await seedAccount(t, 'simulada');
    const { id, pautaId: leadId } = await carousel(t);
    const reels = await produceReels(s, t, id);
    expect((await req(`/api/t/${t}/pecas/${id}/revisao`, { cookie: s.cookie, body: { decisao: 'rejeitar', motivo: 'x', versao: 1 } })).status).toBe(200);
    expect(await statusOf('pautas', leadId)).toBe('descartada');
    const intro = await introspectWorkflow(env.PUBLICACAO_WORKFLOW);
    try {
      await intro.modifyAll(async (m) => { await m.disableSleeps(); await m.disableRetryDelays(); });
      expect((await req(`/api/t/${t}/pecas/${reels}/revisao`, { cookie: s.cookie, body: { decisao: 'aprovar', contaId: account, versao: 1 } })).status).toBe(202);
      const [inst] = await intro.get();
      await inst.waitForStatus('complete');
    } finally {
      await intro.dispose();
    }
    expect(await statusOf('pecas', reels)).toBe('publicada');
    expect(await statusOf('pautas', leadId)).toBe('descartada');
  });

  it('the signed video responds to Range (206) so the player can seek', async () => {
    const { s, t } = await member('editor');
    const { id } = await carousel(t);
    const reels = await produceReels(s, t, id);
    const body = await (await req(`/api/t/${t}/pecas/${reels}`, { cookie: s.cookie })).json<{ artes: { mp4: string }[] }>();
    const url = new URL(body.artes[0].mp4);
    const request = (headers: Record<string, string>) =>
      (exports as unknown as { default: { fetch: (r: Request) => Promise<Response> } }).default.fetch(new Request(`http://localhost${url.pathname}${url.search}`, { headers }));
    const part = await request({ range: 'bytes=4-7' });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes 4-7/${MP4.length}`);
    expect([...new Uint8Array(await part.arrayBuffer())]).toEqual([...MP4.slice(4, 8)]);
    const whole = await request({});
    expect(whole.status).toBe(200);
    expect(whole.headers.get('accept-ranges')).toBe('bytes');
  });

  it('Reels: an account through the intermediario is refused on approval; rewriting and editing the cards too', async () => {
    const { s, t } = await member('editor');
    const { id } = await carousel(t);
    const reels = await produceReels(s, t, id);
    const inter = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO contas_sociais (id, tenant_id, rede, nome, modo, provedor) VALUES (?, ?, 'instagram', 'ayr', 'intermediario', 'ayrshare')").bind(inter, t).run();
    expect((await req(`/api/t/${t}/pecas/${reels}/revisao`, { cookie: s.cookie, body: { decisao: 'aprovar', contaId: inter, versao: 1 } })).status).toBe(400);
    expect((await req(`/api/t/${t}/pecas/${reels}/revisao`, { cookie: s.cookie, body: { decisao: 'reescrever', versao: 1 } })).status).toBe(409);
    expect((await req(`/api/t/${t}/pecas/${reels}/cards`, { method: 'PUT', cookie: s.cookie, body: { versao: 1, cards: [] } })).status).toBe(400);
  });
});

describe('publish the Reels', () => {
  it('manual account: the package carries the signed MP4, the cover and the caption', async () => {
    const { s, t } = await member('editor');
    const account = await seedAccount(t, 'manual');
    const { id } = await carousel(t);
    const reels = await produceReels(s, t, id);
    expect((await req(`/api/t/${t}/pecas/${reels}/revisao`, { cookie: s.cookie, body: { decisao: 'aprovar', contaId: account, versao: 1 } })).status).toBe(200);
    const pkg = await (await req(`/api/t/${t}/pecas/${reels}/pacote`, { cookie: s.cookie })).json<{ formato: string; legenda: string; video: string; imagens: { jpg: string }[] }>();
    expect(pkg.formato).toBe('reels');
    expect(pkg.video).toContain(`/media/reels/${t}/${reels}/`);
    expect(pkg.imagens).toHaveLength(1);
    expect(pkg.legenda).toContain('A ponte fecha para obras.');
  });

  it("old Reels with no 9:16 cover: thumb_offset of 1.5 s, so the frame 0 without title isn't published", async () => {
    const { s, t } = await member('editor');
    const account = await seedAccount(t, 'simulada');
    const { id } = await carousel(t);
    const reels = await produceReels(s, t, id);
    await env.DB.prepare("UPDATE pecas SET arte_r2_keys_json = json_remove(arte_r2_keys_json, '$[0].capaReels') WHERE id = ?").bind(reels).run();
    expect((await packagePublication(env, t, reels))?.capa).toBeNull();
    const intro = await introspectWorkflow(env.PUBLICACAO_WORKFLOW);
    try {
      await intro.modifyAll(async (m) => { await m.disableSleeps(); await m.disableRetryDelays(); });
      await req(`/api/t/${t}/pecas/${reels}/revisao`, { cookie: s.cookie, body: { decisao: 'aprovar', contaId: account, versao: 1 } });
      const [inst] = await intro.get();
      await inst.waitForStatus('complete');
    } finally {
      await intro.dispose();
    }
    const simulated = (await eventsOf(reels)).find((e) => e.tipo === 'peca.publicacao_simulada')!;
    const [create] = simulated.payload.chamadas as { body: Record<string, string> }[];
    expect(create.body.thumb_offset).toBe('1500');
    expect(create.body.cover_url).toBeUndefined();
  });

  it('real account (simulated): media_type=REELS with a signed video_url, waits for the container and publishes', async () => {
    const { s, t } = await member('editor');
    const account = await seedAccount(t, 'simulada');
    const { id, pautaId: leadId } = await carousel(t);
    const reels = await produceReels(s, t, id);
    const intro = await introspectWorkflow(env.PUBLICACAO_WORKFLOW);
    try {
      await intro.modifyAll(async (m) => { await m.disableSleeps(); await m.disableRetryDelays(); });
      expect((await req(`/api/t/${t}/pecas/${reels}/revisao`, { cookie: s.cookie, body: { decisao: 'aprovar', contaId: account, versao: 1 } })).status).toBe(202);
      const [inst] = await intro.get();
      await inst.waitForStatus('complete');
    } finally {
      await intro.dispose();
    }
    expect(await statusOf('pecas', reels)).toBe('publicada');
    expect(await statusOf('pautas', leadId)).toBe('concluida');
    const simulated = (await eventsOf(reels)).find((e) => e.tipo === 'peca.publicacao_simulada')!;
    const [create, status, publish] = simulated.payload.chamadas as { url: string; body: Record<string, string> }[];
    expect(create.url).toBe('https://graph.facebook.com/v26.0/IG_USER_ID/media');
    expect(create.body).toMatchObject({ media_type: 'REELS', caption: expect.stringContaining('A ponte fecha'), share_to_feed: 'true' });
    expect(create.body.video_url).toContain(`/media/reels/${t}/${reels}/`);
    expect(create.body.image_url).toBeUndefined();
    // The 9:16 cover applies over frame 0; `thumb_offset` only in the old Reels.
    expect(create.body.cover_url).toMatch(new RegExp(`/media/reels/${t}/${reels}/v1-[0-9a-f]{16}-capa\\.jpg`));
    expect(create.body.thumb_offset).toBeUndefined();
    expect(status.body.fields).toBe('status_code,status');
    expect(publish.url).toContain('/media_publish');
  });
});

describe('Reels with voice', () => {
  async function withSpeech(sha = 'a'.repeat(64)) {
    const { s, t } = await member('editor');
    const { id } = await carousel(t);
    const nid = crypto.randomUUID();
    const r2 = `narracoes/${t}/${id}/${nid}.webm`;
    await env.MEDIA.put(r2, new Uint8Array([1, 2, 3, 4]));
    const words = 'ponte da santos dumont fecha para obras a prefeitura interdita a ponte a prefeitura interdita a ponte para obras quinze dias a interdição dura quinze dias'.split(' ')
      .map((p, k) => ({ p: ` ${p}`, i: k * 0.5, f: k * 0.5 + 0.4 }));
    await env.DB.prepare("INSERT INTO narracoes (id, tenant_id, peca_id, versao, r2, bytes, sha256, mime, duracao, palavras_json, avisos_json, estado, por) VALUES (?, ?, ?, 1, ?, 4, ?, 'audio/webm', 14, ?, '[]', 'pronto', ?)")
      .bind(nid, t, id, r2, sha, JSON.stringify(words), s.userId).run();
    return { s, t, id, nid };
  }

  it('the video follows the speech: alignment timings, voice as a named file, caption without transcript text, and the MP4 changes with the voice', async () => {
    const a = await withSpeech();
    const reels = await produceReels(a.s, a.t, a.id, null, { narracao: a.nid });
    expect(await statusOf('pecas', reels)).toBe('revisao');
    const { html, arquivos: files, duracao: duration } = requests[0];
    expect(duration).toBe(17.75);
    expect(html).toContain('<audio id="voz" src="voz.webm" data-start="0" data-duration="14" data-volume="1"></audio>');
    expect(files.map((x) => x.nome)).toContain('voz.webm');
    expect(html).toContain('id="c2" class="clip cena" data-start="3.5"');
    // The video's text is the approved one; what only the transcript has does not go in.
    expect(html).toContain('A interdição dura 15 dias.');
    expect(html).not.toContain('quinze');
    const content = await env.DB.prepare('SELECT conteudo_json, arte_r2_keys_json FROM pecas WHERE id = ?').bind(reels).first<{ conteudo_json: string; arte_r2_keys_json: string }>();
    expect(JSON.parse(content!.conteudo_json).narracao).toBe(a.nid);
    await env.DB.prepare('UPDATE narracoes SET sha256 = ? WHERE id = ?').bind('b'.repeat(64), a.nid).run();
    const other = await produceReels(a.s, a.t, a.id, null, { narracao: a.nid });
    const hash = async (p: string) => (JSON.parse((await env.DB.prepare('SELECT arte_r2_keys_json FROM pecas WHERE id = ?').bind(p).first<{ arte_r2_keys_json: string }>())!.arte_r2_keys_json)[0] as { hash: string }).hash;
    expect(await hash(other)).not.toBe(await hash(reels));
  });
});
