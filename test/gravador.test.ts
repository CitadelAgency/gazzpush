// Fase 5: gravar no app. As fatias sobem fora de ordem e repetidas, o concluir monta os segmentos, a fila transcreve um por
// um com o tempo absoluto e a palavra da sobreposição fica de um lado só. Falha de um segmento não prende os outros.
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { acharNaGravacao, transcricoesDoTexto } from '../src/lib/gravacao';
import { concluirSessoesParadas, encerrarSegmento, processarSegmento } from '../src/lib/gravacaoSessao';
import { FATIAS_POR_SEGMENTO, deslocarTrechos, faltasDoSegmento, janelaDoSegmento, salvoAte, segmentoDoTempo } from '../src/lib/segmentos';
import { cadastrar, req, seedMembro } from './helpers';

const palavras = (ini: number, texto: string) => texto.split(' ').map((w, k) => ({ word: ` ${w}`, start: ini + k * 0.4, end: ini + k * 0.4 + 0.35 }));
const whisper = (ini: number, texto: string) => ({ text: texto, transcription_info: { duration: 121 }, segments: [{ start: ini, end: ini + 5, text: ` ${texto}`, words: palavras(ini, texto) }] });

let saida: unknown | 'fora' = whisper(0, 'nada');
beforeEach(() => {
  const original = globalThis.fetch;
  // Sem isso, o consumidor de verdade corre junto com as chamadas diretas destes testes.
  vi.spyOn(env.MONITOR_QUEUE, 'sendBatch').mockResolvedValue(undefined as never);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === 'https://whisper.example/transcrever') return saida === 'fora' ? new Response('fora', { status: 503 }) : Response.json(saida);
    // O pacote pede o carimbo à TSA de teste: sem isto o pedido ia para a rede e o teste dependia do DNS da máquina.
    if (url.includes('.example')) return new Response('não achei', { status: 404 });
    return original(input, init);
  });
});
afterEach(() => vi.restoreAllMocks());

async function materia() {
  const s = await cadastrar('Repórter');
  const t = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO tenants (id, slug, nome, modo, plano) VALUES (?, ?, 'Publicação', 'autoral', 'cortesia')").bind(t, `g-${t.slice(0, 8)}`).run();
  await seedMembro(t, s.userId, 'admin');
  const { texto } = await (await req(`/api/t/${t}/textos`, { cookie: s.cookie, body: { texto: 'Gravação do texto' } })).json<{ texto: { id: string } }>();
  return { s, t, id: texto.id };
}
const ROTA = (t: string, id: string) => `/api/t/${t}/textos/${id}`;
const WEBM = (marca: number) => new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, marca]);
const abrir = async (t: string, id: string, cookie: string) =>
  (await (await req(`${ROTA(t, id)}/gravacoes/sessao`, { cookie, body: { mime: 'audio/webm;codecs=opus' } })).json<{ sessao: string }>()).sessao;
const fatia = (t: string, id: string, cookie: string, sessao: string, seg: number | string, f: number | string, corpo: Uint8Array<ArrayBuffer> = WEBM(Number(f))) =>
  req(`${ROTA(t, id)}/gravacoes/sessao/${sessao}/${seg}/${f}`, { method: 'PUT', cookie, cru: { tipo: 'application/octet-stream', corpo } });
const concluir = (t: string, id: string, cookie: string, sessao: string) => req(`${ROTA(t, id)}/gravacoes/sessao/${sessao}/concluir`, { method: 'POST', cookie });

type G = { id: string; estado: string; erro: string | null; duracao: number | null; segmentos: { total: number; prontos: number; falhos: { n: number; erro: string }[]; faltas: { de: number; ate: number }[]; inicios: number[] } | null };
const gravacao = async (t: string, id: string, cookie: string) => (await (await req(ROTA(t, id), { cookie })).json<{ gravacoes: G[] }>()).gravacoes[0];
const segmentos = (arquivo: string) => env.DB.prepare('SELECT n, r2, estado, inicio, bytes, sha256, faltas_json FROM gravacao_segmentos WHERE arquivo_id = ? ORDER BY n').bind(arquivo)
  .all<{ n: number; r2: string | null; estado: string; inicio: number; bytes: number; sha256: string; faltas_json: string }>().then((r) => r.results);

describe('contas puras', () => {
  it('a emenda fica no meio da sobreposição, e cada palavra conta de um lado só', () => {
    expect(janelaDoSegmento(0, 2)).toEqual({ de: 0, ate: 120.5 });
    expect(janelaDoSegmento(1, 2)).toEqual({ de: 120.5, ate: 240.5 });
    expect(janelaDoSegmento(2, 2).ate).toBe(Infinity);
    expect(segmentoDoTempo(120.4)).toBe(0);
    expect(segmentoDoTempo(120.6)).toBe(1);
    const fala = [{ start: 119, end: 121, text: ' bem na emenda', words: [{ word: ' bem', start: 119.8, end: 120.1 }, { word: ' na', start: 120.2, end: 120.4 }, { word: ' emenda', start: 120.6, end: 121 }] }];
    expect(deslocarTrechos(fala, 0, janelaDoSegmento(0, 1))).toEqual([expect.objectContaining({ texto: 'bem na', inicio: 119.8, fim: 120.4 })]);
    const seguinte = [{ start: 0, end: 1, text: ' na emenda', words: [{ word: ' na', start: 0.2, end: 0.4 }, { word: ' emenda', start: 0.6, end: 1 }] }];
    expect(deslocarTrechos(seguinte, 120, janelaDoSegmento(1, 1))).toEqual([expect.objectContaining({ texto: 'emenda', inicio: 120.6 })]);
  });

  it('trecho sem tempo de palavra vale pelo começo', () => {
    expect(deslocarTrechos([{ start: 10, end: 12, text: ' oi ' }], 240, { de: 240.5, ate: 360.5 })).toEqual([{ inicio: 250, fim: 252, texto: 'oi', palavras: [] }]);
    expect(deslocarTrechos([{ start: 0.1, end: 2, text: ' oi' }], 240, { de: 240.5, ate: 360.5 })).toEqual([]);
  });

  it('fatia ausente vira trecho perdido com o tempo; falta só na sobreposição não é perda', () => {
    const tudo = Array.from({ length: FATIAS_POR_SEGMENTO }, (_, i) => i);
    expect(faltasDoSegmento(0, tudo, false)).toEqual([]);
    expect(faltasDoSegmento(6, tudo.filter((f) => f !== 6 && f !== 7), false)).toEqual([{ de: 750, ate: 760 }]);
    expect(faltasDoSegmento(0, tudo.filter((f) => f !== FATIAS_POR_SEGMENTO - 1), false)).toEqual([]);
    expect(faltasDoSegmento(1, [], false)).toEqual([{ de: 120, ate: 240 }]);
    // O último segmento termina na última fatia que chegou.
    expect(faltasDoSegmento(2, [0, 1, 3], true)).toEqual([{ de: 250, ate: 255 }]);
  });

  it('Salvo até só anda sem buraco', () => {
    expect(salvoAte(new Set())).toBe(0);
    expect(salvoAte(new Set(['0/0', '0/1', '0/3']))).toBe(10);
    expect(salvoAte(new Set(['0/0', '0/1']), 10, 5)).toBe(10);
    expect(salvoAte(new Set(['0/0', '0/1', '1/0']), 10, 5)).toBe(15);
  });
});

describe('fatias e sessão', () => {
  it('fora de ordem e repetidas: o segmento sai na ordem certa, com hash, e as fatias somem', async () => {
    const { s, t, id } = await materia();
    const sessao = await abrir(t, id, s.cookie);
    for (const f of [2, 0, 1, 1, 0]) expect((await fatia(t, id, s.cookie, sessao, 0, f)).status).toBe(200);
    expect((await gravacao(t, id, s.cookie))).toBeUndefined();   // a linha só nasce no concluir
    expect((await req(ROTA(t, id), { cookie: s.cookie }).then((r) => r.json<{ sessoesAbertas: { id: string }[] }>())).sessoesAbertas.map((x) => x.id)).toEqual([sessao]);
    expect((await concluir(t, id, s.cookie, sessao)).status).toBe(200);
    const g = await gravacao(t, id, s.cookie);
    expect(g).toMatchObject({ estado: 'lendo', segmentos: { total: 1, prontos: 0 } });
    saida = whisper(1, 'bom dia a todos');
    await processarSegmento(env, t, g.id, 0);
    const [seg] = await segmentos(g.id);
    expect(seg).toMatchObject({ estado: 'pronto', r2: `gravacoes/${t}/${sessao}/0.webm`, bytes: 17 * 3 });
    const obj = await env.MEDIA.get(seg.r2!);
    const b = new Uint8Array(await obj!.arrayBuffer());
    expect([b[16], b[33], b[50]]).toEqual([0, 1, 2]);
    expect(seg.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await env.MEDIA.list({ prefix: `gravacoes/${t}/${sessao}/0/` })).objects).toHaveLength(0);
    expect(await gravacao(t, id, s.cookie)).toMatchObject({ estado: 'pronto', duracao: expect.closeTo(2.55, 2), segmentos: { prontos: 1 } });
    // Depois de concluída, nada entra, e concluir de novo é o mesmo.
    expect((await fatia(t, id, s.cookie, sessao, 0, 3)).status).toBe(409);
    expect((await concluir(t, id, s.cookie, sessao)).status).toBe(200);
    expect((await segmentos(g.id))).toHaveLength(1);
  });

  it('recusa formato, número, corpo vazio e o teto de 3 horas', async () => {
    const { s, t, id } = await materia();
    expect((await req(`${ROTA(t, id)}/gravacoes/sessao`, { cookie: s.cookie, body: { mime: 'video/mp4' } })).status).toBe(422);
    const sessao = await abrir(t, id, s.cookie);
    expect((await fatia(t, id, s.cookie, sessao, 0, 0, new TextEncoder().encode('isto não é um áudio, é texto') as Uint8Array<ArrayBuffer>)).status).toBe(422);
    expect((await fatia(t, id, s.cookie, sessao, 0, 'x')).status).toBe(400);
    expect((await fatia(t, id, s.cookie, sessao, 0, 1, new Uint8Array(0))).status).toBe(422);
    expect((await fatia(t, id, s.cookie, sessao, 0, 1, new Uint8Array(257 * 1024))).status).toBe(422);
    expect((await fatia(t, id, s.cookie, sessao, 90, 0)).status).toBe(409);
    expect((await fatia(t, id, s.cookie, sessao, 89, 0)).status).toBe(200);
  });

  it('IDOR: outro veículo, outro texto, repórter e veículo fora do modo autoral', async () => {
    const { s, t, id } = await materia();
    const sessao = await abrir(t, id, s.cookie);
    await fatia(t, id, s.cookie, sessao, 0, 0);
    const outro = await materia();
    expect((await fatia(t, id, outro.s.cookie, sessao, 0, 0)).status).toBe(404);
    expect((await fatia(outro.t, outro.id, outro.s.cookie, sessao, 0, 0)).status).toBe(404);
    expect((await concluir(outro.t, outro.id, outro.s.cookie, sessao)).status).toBe(404);
    const { texto } = await (await req(`/api/t/${t}/textos`, { cookie: s.cookie, body: { texto: 'Outro texto' } })).json<{ texto: { id: string } }>();
    expect((await fatia(t, texto.id, s.cookie, sessao, 0, 0)).status).toBe(404);
    expect((await concluir(t, id, s.cookie, sessao)).status).toBe(200);
    const g = await gravacao(t, id, s.cookie);
    expect((await req(`${ROTA(outro.t, outro.id)}/gravacoes/${g.id}/audio?t=0`, { cookie: outro.s.cookie })).status).toBe(404);
    expect((await req(`${ROTA(outro.t, outro.id)}/gravacoes/${g.id}/segmentos/0/tentar`, { method: 'POST', cookie: outro.s.cookie })).status).toBe(404);
    const rep = await cadastrar('Só repórter');
    await seedMembro(t, rep.userId, 'reporter');
    expect((await req(`${ROTA(t, id)}/gravacoes/sessao`, { cookie: rep.cookie, body: { mime: 'audio/webm' } })).status).toBe(403);
    expect((await fatia(t, id, rep.cookie, sessao, 0, 1)).status).toBe(403);
    expect((await concluir(t, id, rep.cookie, sessao)).status).toBe(403);
  });

  it('o cron conclui a sessão parada há mais de 2 horas; a recente e a vazia não viram gravação', async () => {
    const { s, t, id } = await materia();
    const parada = await abrir(t, id, s.cookie);
    await fatia(t, id, s.cookie, parada, 0, 0);
    const recente = await abrir(t, id, s.cookie);
    await fatia(t, id, s.cookie, recente, 0, 0);
    const vazia = await abrir(t, id, s.cookie);
    await env.DB.prepare("UPDATE gravacao_sessoes SET ultima_em = datetime('now', '-3 hours') WHERE id IN (?, ?)").bind(parada, vazia).run();
    expect(await concluirSessoesParadas(env)).toBeGreaterThanOrEqual(2);
    const estados = await env.DB.prepare('SELECT id, estado FROM gravacao_sessoes WHERE id IN (?, ?, ?)').bind(parada, recente, vazia).all<{ id: string; estado: string }>();
    expect(Object.fromEntries(estados.results.map((x) => [x.id, x.estado]))).toEqual({ [parada]: 'concluida', [recente]: 'gravando', [vazia]: 'vazia' });
    expect((await gravacao(t, id, s.cookie)).segmentos?.total).toBe(1);
  });
});

describe('transcrição por segmento', () => {
  async function duasPartes() {
    const m = await materia();
    const sessao = await abrir(m.t, m.id, m.s.cookie);
    await fatia(m.t, m.id, m.s.cookie, sessao, 0, 0);
    await fatia(m.t, m.id, m.s.cookie, sessao, 1, 0);
    await concluir(m.t, m.id, m.s.cookie, sessao);
    return { ...m, sessao, arquivo: (await gravacao(m.t, m.id, m.s.cookie)).id };
  }

  it('tempo absoluto, sobreposição sem repetir e citação achada na emenda', async () => {
    const { s, t, id, arquivo } = await duasPartes();
    saida = whisper(118.6, 'eu nunca recebi um centavo');
    await processarSegmento(env, t, arquivo, 0);
    expect((await gravacao(t, id, s.cookie)).estado).toBe('lendo');
    saida = whisper(0.2, 'centavo das empresas de ônibus');
    await processarSegmento(env, t, arquivo, 1);
    expect(await gravacao(t, id, s.cookie)).toMatchObject({ estado: 'pronto', segmentos: { total: 2, prontos: 2 } });
    const { prontas } = await transcricoesDoTexto(env, t, id);
    const fala = prontas[0].trechos.flatMap((x) => x.palavras.map((w) => w.p.trim()));
    expect(fala.join(' ')).toBe('eu nunca recebi um centavo das empresas de ônibus');
    const g = acharNaGravacao('recebi um centavo das empresas', prontas);
    expect(g).toMatchObject({ arquivoId: arquivo, segmentada: true });
    expect(g!.inicio).toBeCloseTo(119.4, 2);
  });

  it('a falha de um segmento não prende os outros; tentar de novo refaz só ele', async () => {
    const { s, t, id, arquivo } = await duasPartes();
    saida = 'fora';
    await processarSegmento(env, t, arquivo, 0);
    saida = whisper(1, 'segunda parte da fala');
    await processarSegmento(env, t, arquivo, 1);
    const g = await gravacao(t, id, s.cookie);
    expect(g).toMatchObject({ estado: 'pronto', segmentos: { prontos: 1, falhos: [{ n: 0, erro: expect.stringContaining('transcrição falhou') }] } });
    expect((await req(`${ROTA(t, id)}/gravacoes/${arquivo}/segmentos/1/tentar`, { method: 'POST', cookie: s.cookie })).status).toBe(409);
    expect((await req(`${ROTA(t, id)}/gravacoes/${arquivo}/segmentos/0/tentar`, { method: 'POST', cookie: s.cookie })).status).toBe(200);
    expect((await gravacao(t, id, s.cookie)).estado).toBe('lendo');
    saida = whisper(1, 'primeira parte da fala');
    await processarSegmento(env, t, arquivo, 0);
    const depois = await gravacao(t, id, s.cookie);
    expect(depois).toMatchObject({ estado: 'pronto', segmentos: { prontos: 2, falhos: [] } });
    const { prontas } = await transcricoesDoTexto(env, t, id);
    expect(prontas[0].trechos.map((x) => x.texto)).toEqual(['primeira parte da fala', 'segunda parte da fala']);
  });

  it('todas falham: a gravação falha com motivo; a última entrega da fila grava a falha no segmento', async () => {
    const { s, t, id, arquivo } = await duasPartes();
    saida = 'fora';
    await processarSegmento(env, t, arquivo, 0);
    await encerrarSegmento(env, t, arquivo, 1, 'falhou depois de 5 tentativas');
    expect(await gravacao(t, id, s.cookie)).toMatchObject({ estado: 'falhou', erro: 'nenhum trecho foi transcrito' });
  });

  it('segmento sem a primeira fatia fica à vista como perdido, e não há o que tentar de novo', async () => {
    const { s, t, id } = await materia();
    const sessao = await abrir(t, id, s.cookie);
    await fatia(t, id, s.cookie, sessao, 0, 0);
    await fatia(t, id, s.cookie, sessao, 2, 0);
    await concluir(t, id, s.cookie, sessao);
    const g = await gravacao(t, id, s.cookie);
    expect(g.segmentos).toMatchObject({ total: 3, falhos: [{ n: 1 }] });
    expect(g.segmentos!.faltas).toContainEqual({ de: 120, ate: 240 });
    expect((await req(`${ROTA(t, id)}/gravacoes/${g.id}/segmentos/1/tentar`, { method: 'POST', cookie: s.cookie })).status).toBe(409);
  });

  it('o áudio vem pelo tempo, com o começo do trecho; o pacote leva um arquivo por segmento', async () => {
    const { s, t, id, arquivo } = await duasPartes();
    saida = whisper(1, 'parte falada aqui');
    await processarSegmento(env, t, arquivo, 0);
    await processarSegmento(env, t, arquivo, 1);
    const a = await req(`${ROTA(t, id)}/gravacoes/${arquivo}/audio?t=130`, { cookie: s.cookie });
    expect(a.status).toBe(200);
    expect(a.headers.get('x-inicio')).toBe('120');
    expect(a.headers.get('content-type')).toBe('audio/webm');
    expect((await a.arrayBuffer()).byteLength).toBe(17);
    const r = await req(`${ROTA(t, id)}/gravacoes/${arquivo}/audio?t=0`, { cookie: s.cookie, headers: { range: 'bytes=0-3' } });
    expect(r.status).toBe(206);
    expect(r.headers.get('x-inicio')).toBe('0');
    const zip = unzipSync(new Uint8Array(await (await req(`${ROTA(t, id)}/pacote`, { method: 'GET', cookie: s.cookie })).arrayBuffer()));
    const nomes = Object.keys(zip).filter((k) => k.includes('dossie/gravacoes'));
    expect(nomes.filter((k) => /parte-0[12]\.webm$/.test(k))).toHaveLength(2);
    const tr = nomes.find((k) => k.endsWith('.transcricao.json'))!;
    expect(strFromU8(zip[tr])).toContain('parte falada aqui');
  });
});
