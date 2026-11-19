// Phase 6: the owner's voice. The comparison with the script by code (numbers spelled out, a swapped name, speech
// outside the script, pt and en), the per-card timings with the proportional fallback, the caption with approved text
// only and the routes, with IDOR.
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compareNarration, startsParts, scriptReels, timesNarration, tokensSpeech, tokensScript, type ScriptPart } from '../src/lib/speech';
import { processNarration } from '../src/lib/narration';
import { compositionReels } from '../src/lib/reelsHtml';
import type { Word } from '../src/lib/segments';
import { register, req, seedMember, seedLead, seedTenant } from './helpers';

const speech = (text: string, ini = 0, step = 0.4): Word[] => text.split(' ').map((p, k) => ({ p: ` ${p}`, i: ini + k * step, f: ini + k * step + 0.35 }));
const part = (text: string, card = 0, sentence: number | null = 0): ScriptPart => ({ card, frase: sentence, texto: text });
const warnings = (script: string, spoken: string) => compareNarration([part(script)], speech(spoken));

describe('tokens and numbers', () => {
  it('a spelled-out number becomes digits, in pt and en', () => {
    expect(tokensSpeech(speech('foram vinte e cinco casas')).map((t) => t.w)).toEqual(['foram', '25', 'casas']);
    expect(tokensSpeech(speech('custou mil e duzentos reais')).map((t) => t.w)).toEqual(['custou', '1200', 'reais']);
    expect(tokensSpeech(speech('dois mil e vinte e seis')).map((t) => t.w)).toEqual(['2026']);
    expect(tokensSpeech(speech('twenty five houses')).map((t) => t.w)).toEqual(['25', 'houses']);
    expect(tokensSpeech(speech('three hundred and two')).map((t) => t.w)).toEqual(['302']);
    expect(tokensSpeech(speech('dois vírgula cinco metros')).map((t) => t.w)).toEqual(['2.5', 'metros']);
    expect(tokensScript([part('R$ 1.200 e 2,5%')]).map((t) => t.w)).toEqual(['r', '1200', 'e', '2.5']);
    // "um" on its own is an article.
    expect(tokensSpeech(speech('um centavo')).map((t) => t.w)).toEqual(['um', 'centavo']);
  });

  it('a proper name is the capital in the middle of the sentence, not the one at the start', () => {
    const t = tokensScript([part('A prefeitura de Santos fechou a ponte. Moradores de Bertioga reclamam.')]);
    expect(t.filter((x) => x.nome).map((x) => x.bruto)).toEqual(['Santos', 'Bertioga']);
  });
});

describe('compareNarration', () => {
  it('no warning when it matches, with a spelled-out number on one side only', () => {
    expect(warnings('A obra custa 12 milhões em Santos', 'a obra custa doze milhões em santos')).toEqual([]);
    expect(warnings('The bridge closes for 15 days in Boston', 'the bridge closes for fifteen days in boston')).toEqual([]);
  });

  it('swapped and missing number, with the time to listen', () => {
    expect(warnings('A obra custa 12 milhões', 'a obra custa vinte milhões')).toEqual([{ tipo: 'numero', motivo: 'trocado', esperado: '12', inicio: expect.closeTo(1.2, 5), decisao: null }]);
    expect(warnings('A obra custa 12 milhões', 'a obra custa milhões')).toEqual([expect.objectContaining({ tipo: 'numero', motivo: 'ausente', esperado: '12' })]);
    expect(warnings('The work costs 12 million', 'the work costs twenty million')).toEqual([expect.objectContaining({ tipo: 'numero', motivo: 'trocado' })]);
  });

  it('swapped name and speech outside the script', () => {
    expect(warnings('O prefeito de Santos falou', 'o prefeito de santana falou')).toEqual([expect.objectContaining({ tipo: 'nome', motivo: 'trocado', esperado: 'Santos' })]);
    const outside = warnings('A ponte fecha amanhã', 'a ponte fecha amanhã e agora uma conversa qualquer que entrou aqui na gravação');
    expect(outside).toEqual([expect.objectContaining({ tipo: 'fora', motivo: 'extra', esperado: null })]);
  });

  it("the warning doesn't include any word from the transcript", () => {
    expect(JSON.stringify(warnings('A obra custa 12 milhões em Santos', 'a obra custa vinte milhões em santana'))).not.toMatch(/vinte|santana/);
  });
});

describe('timings with voice', () => {
  const parts = [part('Ponte fecha', 0, null), part('Obra dura quinze dias', 1, null), part('A prefeitura informou hoje', 1, 0), part('Moradores reclamam muito', 2, 0)];

  it('start of each card and of each sentence from the alignment', () => {
    const words = [...speech('ponte fecha', 0), ...speech('obra dura quinze dias', 3), ...speech('a prefeitura informou hoje', 6), ...speech('moradores reclamam muito', 12)];
    const r = timesNarration(parts, words, 15, 4, 3.75);
    expect(r.tempos).toEqual([3, 9, 3, 3.75]);
    expect(r.frases[1]).toEqual([6]);
    expect(r.frases[2]).toEqual([12]);
  });

  it('without alignment, proportional to the words', () => {
    expect(startsParts(parts, speech('nada disso foi dito'), 26)).toEqual([0, 4, 12, 20]);
    expect(timesNarration(parts, [], 26, 3, 3.75).tempos).toEqual([4, 16, 6]);
  });

  it('a part without alignment falls between its neighbours', () => {
    const words = [...speech('ponte fecha', 0), ...speech('moradores reclamam muito', 20)];
    expect(startsParts(parts, words, 26)).toEqual([0, 4, 12, 20]);
    expect(startsParts(parts, [...speech('ponte fecha', 0), ...speech('a prefeitura informou hoje', 10)], 20)).toEqual([0, 3.333, 10, 15.714]);
  });

  it('the script has no CTA, and the cover only has the title', () => {
    const r = scriptReels([
      { id: 'c', layout: 'capa', titulo: 'Título', frases: [{ texto: 'Oculta', fatoId: null }] },
      { id: 't', layout: 'texto', titulo: 'Dois', frases: [{ texto: 'Frase', fatoId: 'f' }] },
      { id: 'k', layout: 'convite', titulo: 'Siga', frases: [{ texto: 'Siga a página', fatoId: null }] },
    ]);
    expect(r).toEqual([{ card: 0, frase: null, texto: 'Título' }, { card: 1, frase: null, texto: 'Dois' }, { card: 1, frase: 0, texto: 'Frase' }]);
  });
});

describe('composition with voice', () => {
  const article = (body: string) => `<html><head><style>.card{}</style></head><body><article class="card"><header></header><div class="story"><h1>T</h1>${body}</div></article></body></html>`;
  const body = '<p class="story-body"><span class="frase-rl">Texto aprovado.</span> <span class="frase-rl">Outra frase.</span></p>';

  it('voice at volume 1, music at 0.15; the caption is the approved sentence, at the moment of speech, across the three movements', () => {
    for (const motion of ['seco', 'manchete', 'folha'] as const) {
      const html = compositionReels({ cards: [article(body), article(body)], tempos: [4, 6], movimento: motion, musica: 'musica.mp3', voz: { arquivo: 'voz.webm', duracao: 10, frases: [[], [5, 7.5]] } });
      expect(html).toContain('<audio id="voz" src="voz.webm" data-start="0" data-duration="10" data-volume="1"></audio>');
      expect(html).toContain('<audio id="musica" src="musica.mp3" data-start="0" data-duration="10" data-volume="0.15"></audio>');
      expect(html).toContain("tl.fromTo('#c2 .frase-rl:nth-of-type(1), #c2 .story-list li:nth-child(1)', { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'power1.out' }, 5);");
      expect(html).toContain("}, 7.5);");
      expect(html).not.toMatch(/tl\.fromTo\('#c1( |')(?!\.art)/);
    }
    const without = compositionReels({ cards: [article(body)], tempos: [4], movimento: 'seco', musica: 'musica.mp3' });
    expect(without).toContain('data-volume="0.5"');
    expect(without).not.toContain('id="voz"');
  });
});

describe('routes', () => {
  const WAV = new Uint8Array([...new TextEncoder().encode('RIFF'), 0, 0, 0, 0, ...new TextEncoder().encode('WAVE'), 1, 2, 3, 4, 5, 6, 7, 8]);
  let output: unknown;
  beforeEach(() => {
    vi.spyOn(env.MONITOR_QUEUE, 'send').mockResolvedValue(undefined as never);
    const original = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return url === 'https://whisper.example/transcrever' ? Response.json(output) : original(input, init);
    });
  });
  afterEach(() => vi.restoreAllMocks());
  const whisper = (text: string, duration = 20) => ({ transcription_info: { duration }, segments: [{ start: 0, end: 5, text: text, words: speech(text).map((w) => ({ word: w.p, start: w.i, end: w.f })) }] });

  async function scenario(role: 'editor' | 'reporter' = 'editor') {
    const s = await register();
    const t = await seedTenant();
    await seedMember(t, s.userId, role);
    const { pautaId: leadId, fatos: facts } = await seedLead(t, 'em_producao');
    const id = crypto.randomUUID();
    const content = { manchete: 'Ponte', resumo: '', legenda: 'x', cards: [{ id: 'c1', layout: 'capa', titulo: 'Ponte fecha', frases: [] }, { id: 'c2', layout: 'texto', titulo: 'Obra dura 15 dias', frases: [{ texto: 'A prefeitura de Santos informou.', fatoId: facts[0].id }] }] };
    await env.DB.prepare(`INSERT INTO pecas (id, tenant_id, pauta_id, formato, status, versao, conteudo_json, validacao_json, arte_r2_keys_json, workflow_id) VALUES (?, ?, ?, 'carrossel', 'revisao', 1, ?, '{"ok":true}', '[{"png":"a.png","jpg":"a.jpg"}]', ?)`)
      .bind(id, t, leadId, JSON.stringify(content), `${id}-r1`).run();
    return { s, t, id };
  }
  const upload = (c: { s: { cookie: string }; t: string; id: string }, body: Uint8Array<ArrayBuffer> = WAV) => req(`/api/t/${c.t}/pecas/${c.id}/narracao`, { cookie: c.s.cookie, cru: { tipo: 'audio/wav', corpo: body } });
  const read = async (c: { s: { cookie: string }; t: string; id: string }) => (await (await req(`/api/t/${c.t}/pecas/${c.id}/narracao`, { cookie: c.s.cookie })).json<{ narracao: { id: string; estado: string; erro: string | null; avisos: { decisao: string | null }[] } }>()).narracao;
  const request = (c: { s: { cookie: string }; t: string; id: string }, narration: string) => req(`/api/t/${c.t}/pecas/${c.id}/reels`, { cookie: c.s.cookie, body: { musica: null, versao: 1, narracao: narration } });

  it('a warning without a sure decision holds the Reels; the screen never receives the transcript', async () => {
    const c = await scenario();
    const { id } = await (await upload(c)).json<{ id: string }>();
    expect((await read(c)).estado).toBe('lendo');
    expect((await request(c, id)).status).toBe(409);
    output = whisper('ponte fecha obra dura vinte dias a prefeitura de santos informou');
    await processNarration(env, c.t, id);
    const n = await read(c);
    expect(n).toMatchObject({ estado: 'pronto', avisos: [{ tipo: 'numero', motivo: 'trocado', esperado: '15' }] });
    expect(JSON.stringify(n)).not.toContain('vinte');
    expect((await request(c, id)).status).toBe(409);
    const d = await req(`/api/t/${c.t}/pecas/${c.id}/narracao/${id}/avisos/0`, { cookie: c.s.cookie, body: { decisao: 'fala_certa' } });
    expect(d.status).toBe(200);
    expect((await read(c)).avisos[0].decisao).toBe('fala_certa');
    expect((await req(`/api/t/${c.t}/pecas/${c.id}/narracao/${id}/avisos/9`, { cookie: c.s.cookie, body: {} })).status).toBe(404);
  });

  it("the 90 s cap, empty speech and a file that isn't audio are shown", async () => {
    const c = await scenario();
    expect((await upload(c, new TextEncoder().encode('isto é texto, não áudio') as Uint8Array<ArrayBuffer>)).status).toBe(422);
    const { id } = await (await upload(c)).json<{ id: string }>();
    output = whisper('ponte fecha', 120);
    await processNarration(env, c.t, id);
    expect(await read(c)).toMatchObject({ estado: 'falhou', erro: expect.stringContaining('90 s') });
    const b = await (await upload(c, new Uint8Array([...WAV, 9]))).json<{ id: string }>();
    output = { segments: [] };
    await processNarration(env, c.t, b.id);
    expect(await read(c)).toMatchObject({ estado: 'falhou', erro: expect.stringContaining('não achou fala') });
  });

  it('carousel changed after the recording: record again', async () => {
    const c = await scenario();
    const { id } = await (await upload(c)).json<{ id: string }>();
    output = whisper('ponte fecha obra dura quinze dias a prefeitura de santos informou');
    await processNarration(env, c.t, id);
    await env.DB.prepare('UPDATE pecas SET versao = 2 WHERE id = ?').bind(c.id).run();
    expect((await req(`/api/t/${c.t}/pecas/${c.id}/reels`, { cookie: c.s.cookie, body: { musica: null, versao: 2, narracao: id } })).status).toBe(409);
  });

  it('IDOR and role', async () => {
    const c = await scenario();
    const { id } = await (await upload(c)).json<{ id: string }>();
    const other = await scenario();
    const route = `/api/t/${other.t}/pecas/${c.id}/narracao`;
    expect((await req(route, { cookie: other.s.cookie })).status).toBe(404);
    expect((await req(route, { cookie: other.s.cookie, cru: { tipo: 'audio/wav', corpo: WAV } })).status).toBe(404);
    expect((await req(`/api/t/${c.t}/pecas/${c.id}/narracao`, { cookie: other.s.cookie })).status).toBe(404);
    expect((await req(`${route}/${id}/audio`, { cookie: other.s.cookie })).status).toBe(404);
    expect((await req(`/api/t/${other.t}/pecas/${other.id}/narracao/${id}/audio`, { cookie: other.s.cookie })).status).toBe(404);
    expect((await req(`/api/t/${other.t}/pecas/${other.id}/narracao/${id}/avisos/0`, { cookie: other.s.cookie, body: {} })).status).toBe(404);
    expect((await request(other, id)).status).toBe(404);
    const rep = await scenario('reporter');
    expect((await upload(rep)).status).toBe(403);
  });
});
