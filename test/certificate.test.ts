// Phase 7: the certificate comes out on publication, with a verified timestamp; the authority being down does not
// affect publication, the queue retries without duplicating, and another outlet's piece does not appear. Templates and
// the kit's count, without AI.
import { env } from 'cloudflare:test';
import { unzipSync, strFromU8 } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rootTsa, verifyTimestamp } from '../src/lib/timestamp';
import { issueCertificate, failCertificate, htmlCertificate, packageCertificate, type Manifest } from '../src/lib/certificate';
import { CASE_TYPES, untilDays, modelsKit, scriptKit } from '../src/lib/kit';
import { browserApi } from '../src/lib/render';
import { recordPublication } from '../src/workflows/publishing';
import type { Env } from '../src/env';
import { register, req, seedAccount, seedMember, seedTenant } from './helpers';
import { FAKE_ROOT, timestamp } from './fake-tsa';

let tsa: 'ok' | 'fora' = 'ok';
const vars = env as unknown as Record<string, unknown>;
const before = { url: vars.TSA_URL, raiz: vars.TSA_RAIZ };

beforeEach(() => {
  tsa = 'ok';
  vars.TSA_URL = 'https://tsa.example/tsr';
  vars.TSA_RAIZ = FAKE_ROOT;
  vi.spyOn(env.MONITOR_QUEUE, 'send').mockResolvedValue(undefined as never);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (u, init) => {
    if (String(u) !== 'https://tsa.example/tsr') throw new Error(`rede: ${String(u)}`);
    if (tsa === 'fora') return new Response('fora do ar', { status: 503 });
    return new Response(await timestamp(new Uint8Array(await new Response(init?.body).arrayBuffer())), { headers: { 'content-type': 'application/timestamp-reply' } });
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vars.TSA_URL = before.url;
  vars.TSA_RAIZ = before.raiz;
});

async function published(o: { piloto?: string } = {}) {
  const t = await seedTenant();
  const s = await register('Ana Costa');
  await seedMember(t, s.userId, 'editor');
  const account = await seedAccount(t, 'manual');
  const [leadId, doc, fact, id] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const png = `artes/${t}/${id}/v1/capa.png`;
  await env.MEDIA.put(png, new Uint8Array([1, 2, 3]));
  const content = { manchete: 'Ponte interditada', legenda: 'Ponte.', visualBrief: { primary: 'Ponte vazia' }, cards: [] };
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO fontes (id, tenant_id, tipo, nome) VALUES (?, ?, 'manual', 'Teste')").bind(`${t}:f`, t),
    env.DB.prepare("INSERT INTO documentos (id, tenant_id, fonte_id, url, titulo, hash_texto, status) VALUES (?, ?, ?, 'https://a.example/1', 'Diário', 'abc123', 'triado')").bind(doc, t, `${t}:f`),
    env.DB.prepare("INSERT INTO fatos (id, tenant_id, documento_id, tipo, texto, hash) VALUES (?, ?, ?, 'manchete', 'Ponte fecha', ?)").bind(fact, t, doc, fact),
    env.DB.prepare("INSERT INTO pautas (id, tenant_id, status, origem, titulo, fato_ids_json, documento_ids_json, score) VALUES (?, ?, 'concluida', 'manual', 'Ponte', ?, ?, 1)").bind(leadId, t, JSON.stringify([fact]), JSON.stringify([doc])),
    env.DB.prepare(`INSERT INTO pecas (id, tenant_id, pauta_id, formato, status, versao, custo_usd, conteudo_json, arte_r2_keys_json, workflow_id, conta_id)
                    VALUES (?, ?, ?, 'carrossel', 'publicada', 1, 0, ?, ?, ?, ?)`)
      .bind(id, t, leadId, JSON.stringify(content), JSON.stringify([{ papel: 'capa', id: 'c1', png, jpg: `artes/${t}/${id}/v1/some.jpg`, hash: 'h' }]), `${id}-r1`, account),
    env.DB.prepare("INSERT INTO decisoes (id, tenant_id, peca_id, versao, decisao, por, payload_json) VALUES (?, ?, ?, 1, 'aprovar', ?, ?)")
      .bind(crypto.randomUUID(), t, id, o.piloto ? 'piloto' : s.userId, JSON.stringify(o.piloto ? { ligadoPor: s.userId } : {})),
    env.DB.prepare("INSERT INTO publicacoes (id, tenant_id, peca_id, conta_id, rede, modo, url, publicado_em, status) VALUES (?, ?, ?, ?, 'instagram', 'manual', 'https://instagram.com/p/x', datetime('now'), 'publicada')")
      .bind(crypto.randomUUID(), t, id, account),
  ]);
  return { t, s, id, conta: account, pautaId: leadId };
}

const manifestOf = async (r2: string) => JSON.parse(await (await env.MEDIA.get(r2))!.text()) as Manifest;
const fakePdf = () => vi.spyOn(browserApi, 'abrir').mockResolvedValue({
  newPage: async () => ({ route: async () => {}, setContent: async () => {}, pdf: async () => new Uint8Array([37, 80, 68, 70]) }), close: async () => {},
} as never);

describe('manifest', () => {
  it("includes sources, art, who approved and the publication; what's missing says not registered", async () => {
    const c = await published();
    const r = await issueCertificate(env, c.t, c.id, true);
    const m = await manifestOf(r!.r2_manifesto!);
    expect(m.peca).toMatchObject({ manchete: 'Ponte interditada', versao: 1 });
    expect(m.fontes).toEqual([expect.objectContaining({ url: 'https://a.example/1', sha256: 'abc123' })]);
    expect(m.artes[0].arquivos[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(m.artes[0].arquivos[1]).toEqual({ nome: 'some.jpg', sha256: null });
    expect(m.aprovacao).toMatchObject({ por: 'Ana Costa', ligadoPor: null });
    expect(m.publicacao).toMatchObject({ modo: 'manual', url: 'https://instagram.com/p/x' });
    expect(m.ilustracao).toEqual({ visualBrief: 'Ponte vazia', modelo: 'não registrado' });
  });

  it('autopilot appears as autopilot, with who turned it on', async () => {
    const c = await published({ piloto: 'sim' });
    const r = await issueCertificate(env, c.t, c.id, true);
    expect((await manifestOf(r!.r2_manifesto!)).aprovacao).toMatchObject({ por: 'piloto', ligadoPor: 'Ana Costa' });
  });
});

describe('art origin', () => {
  const text = (title: string) => ({ titulo: title, frases: [{ texto: 'Frase', fatoId: 'x' }] });
  async function withCards(c: { t: string; id: string }, cards: unknown[], style?: unknown) {
    const current = JSON.parse((await env.DB.prepare('SELECT conteudo_json FROM pecas WHERE id = ?').bind(c.id).first<{ conteudo_json: string }>())!.conteudo_json);
    await env.DB.prepare('UPDATE pecas SET conteudo_json = ? WHERE id = ?').bind(JSON.stringify({ ...current, cards, ...(style ? { estilo: style } : {}) }), c.id).run();
  }

  it('lists, per card, photo with author and type, card illustration with provider, post illustration, and card without art', async () => {
    const c = await published();
    const key = `artes/${c.t}/${c.id}/cards/capa-1.png`;
    await env.DB.prepare("INSERT INTO eventos (tenant_id, tipo, ref_tipo, ref_id, payload_json) VALUES (?, 'peca.ilustracao_card', 'peca', ?, ?)").bind(c.t, c.id, JSON.stringify({ r2Key: key, provedor: 'kie' })).run();
    await env.DB.prepare("INSERT INTO eventos (tenant_id, tipo, ref_tipo, ref_id, payload_json) VALUES (?, 'peca.ilustracao', 'peca', ?, ?)").bind(c.t, c.id, JSON.stringify({ provedor: 'workers-ai' })).run();
    await withCards(c, [
      { ...text('Foto'), id: 'a', layout: 'manchete', imagem: `fotos/${c.t}/${c.id}/f.png`, fotoOrigem: { autor: 'Rui Lima', tipo: 'equipe' } },
      { ...text('Ilustrado'), id: 'b', layout: 'contexto', ilustracao: key },
      { ...text('Padrão'), id: 'c', layout: 'contexto' },
      { ...text('Documento'), id: 'd', layout: 'documento' },
      { ...text('Foto antiga'), id: 'e', layout: 'contexto', imagem: `fotos/${c.t}/${c.id}/g.png` },
    ]);
    const r = await issueCertificate(env, c.t, c.id, true);
    const m = await manifestOf(r!.r2_manifesto!);
    expect(m.origemArte!.map((o) => [o.card, o.origem])).toEqual([
      ['a', { tipo: 'foto', autor: 'Rui Lima', origem: 'equipe' }],
      ['b', { tipo: 'ilustracao', de: 'card', modelo: 'kie' }],
      ['c', { tipo: 'ilustracao', de: 'post', modelo: 'workers-ai' }],
      ['d', { tipo: 'sem_arte' }],
      ['e', { tipo: 'foto', autor: 'não registrado', origem: 'não registrado' }],
    ]);
    const html = htmlCertificate(m, r!);
    expect(html).toContain('Foto: foto da equipe do veículo: Rui Lima');
    expect(html).toContain('Ilustrado: ilustração gerada para este card: kie');
    expect(html).toContain('Foto antiga: foto, origem não registrada: não registrado');
  });

  it('the Cartaz composition takes no art; the standalone post lists only one card', async () => {
    const c = await published();
    await withCards(c, [{ ...text('Um'), id: 'a', layout: 'manchete' }, { ...text('Dois'), id: 'b', layout: 'contexto' }], { id: 'e', versao: 1, params: { composicao: 'cartaz' }, marcaVisual: {} });
    const m = await manifestOf((await issueCertificate(env, c.t, c.id, true))!.r2_manifesto!);
    expect(m.origemArte!.map((o) => o.origem.tipo)).toEqual(['sem_arte', 'sem_arte']);
    await env.DB.prepare('DELETE FROM certidoes WHERE peca_id = ?').bind(c.id).run();
    await env.DB.prepare("UPDATE pecas SET formato = 'post' WHERE id = ?").bind(c.id).run();
    const one = await manifestOf((await issueCertificate(env, c.t, c.id, true))!.r2_manifesto!);
    expect(one.origemArte).toHaveLength(1);
  });

  it('certificate from before Stage 17, without the field, still opens; in English it comes out in English', async () => {
    const c = await published();
    await withCards(c, [{ ...text('Capa'), id: 'a', layout: 'manchete', imagem: 'x', fotoOrigem: { autor: 'Ana', tipo: 'minha' } }]);
    const r = await issueCertificate(env, c.t, c.id, true);
    const m = await manifestOf(r!.r2_manifesto!);
    expect(htmlCertificate({ ...m, origemArte: undefined }, r!)).not.toContain('Origem da arte');
    expect(htmlCertificate({ ...m, idioma: 'en' }, r!)).toContain('Capa: photo by the author: Ana');
  });
});

describe('timestamp', () => {
  it('checks with verifyTimestamp over the manifest', async () => {
    const c = await published();
    const r = await issueCertificate(env, c.t, c.id, true);
    const [bytes, tsr] = await Promise.all([env.MEDIA.get(r!.r2_manifesto!), env.MEDIA.get(r!.r2_carimbo!)]);
    const root = rootTsa({ TSA_URL: 'https://tsa.example/tsr', TSA_RAIZ: FAKE_ROOT } as Env)!;
    const v = await verifyTimestamp(new Uint8Array(await tsr!.arrayBuffer()), new Uint8Array(await bytes!.arrayBuffer()), root);
    expect(v.ok).toBe(true);
    expect(r).toMatchObject({ erro: null, na_publicacao: 1 });
  });

  it("repeating doesn't duplicate", async () => {
    const c = await published();
    const a = await issueCertificate(env, c.t, c.id, true);
    const b = await issueCertificate(env, c.t, c.id, true);
    expect(b!.sha256).toBe(a!.sha256);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM certidoes WHERE peca_id = ?').bind(c.id).first('n')).toBe(1);
    expect((await env.MEDIA.list({ prefix: `certidoes/${c.t}/${c.id}/` })).objects).toHaveLength(2);
  });

  it('authority down: queues it; exhausted, the failure stays visible; generating later resolves and clears it', async () => {
    const c = await published();
    tsa = 'fora';
    await expect(issueCertificate(env, c.t, c.id, true)).rejects.toThrow();
    await failCertificate(env, c.t, c.id, 'falhou depois de 4 tentativas');
    const list = await (await req(`/api/t/${c.t}/publicacoes`, { cookie: c.s.cookie })).json<{ publicacoes: { certidao: string | null; certidao_erro: string | null }[] }>();
    expect(list.publicacoes[0]).toMatchObject({ certidao: null, certidao_erro: 'falhou depois de 4 tentativas' });
    expect((await req(`/api/t/${c.t}/pecas/${c.id}/certidao`, { cookie: c.s.cookie, body: {} })).status).toBe(503);
    tsa = 'ok';
    expect((await req(`/api/t/${c.t}/pecas/${c.id}/certidao`, { cookie: c.s.cookie, body: {} })).status).toBe(200);
    const end = await env.DB.prepare('SELECT erro, sha256 FROM certidoes WHERE peca_id = ?').bind(c.id).first<{ erro: string | null; sha256: string }>();
    expect(end?.erro).toBeNull();
    expect(end?.sha256).toBeTruthy();
    await failCertificate(env, c.t, c.id, 'tarde demais');
    expect(await env.DB.prepare('SELECT erro FROM certidoes WHERE peca_id = ?').bind(c.id).first('erro')).toBeNull();
  });

  it("publishing enqueues and doesn't wait: queue down doesn't break the publication", async () => {
    const c = await published();
    await env.DB.prepare("UPDATE pecas SET status = 'aprovada' WHERE id = ?").bind(c.id).run();
    const execution = crypto.randomUUID();
    vi.mocked(env.MONITOR_QUEUE.send).mockRejectedValueOnce(new Error('fila fora'));
    await recordPublication(env, { tenantId: c.t, pecaId: c.id, pautaId: c.pautaId, contaId: c.conta }, execution, { id: c.conta, rede: 'instagram', modo: 'real' }, { rede: 'instagram', externalId: 'x', simulada: false } as never);
    expect(await env.DB.prepare('SELECT status FROM pecas WHERE id = ?').bind(c.id).first('status')).toBe('publicada');
  });

  it("simulated account doesn't get a certificate", async () => {
    const c = await published();
    await env.DB.prepare("UPDATE pecas SET status = 'aprovada' WHERE id = ?").bind(c.id).run();
    await recordPublication(env, { tenantId: c.t, pecaId: c.id, pautaId: c.pautaId, contaId: c.conta }, crypto.randomUUID(), { id: c.conta, rede: 'instagram', modo: 'simulada' }, { rede: 'instagram', externalId: 'x', simulada: true } as never);
    expect(env.MONITOR_QUEUE.send).not.toHaveBeenCalled();
  });

  it('manual confirmation enqueues', async () => {
    const c = await published();
    await env.DB.prepare("UPDATE pecas SET status = 'aprovada' WHERE id = ?").bind(c.id).run();
    expect((await req(`/api/t/${c.t}/pecas/${c.id}/publicada`, { cookie: c.s.cookie, body: { url: 'https://instagram.com/p/y' } })).status).toBe(200);
    expect(env.MONITOR_QUEUE.send).toHaveBeenCalledWith({ tipo: 'certidao', tenantId: c.t, pecaId: c.id });
  });
});

describe('old post and download', () => {
  it('generated later: the document and the LEIA-ME say the timestamp is later', async () => {
    const c = await published();
    const open = fakePdf();
    expect((await req(`/api/t/${c.t}/pecas/${c.id}/certidao`, { cookie: c.s.cookie, body: {} })).status).toBe(200);
    const res = await req(`/api/t/${c.t}/pecas/${c.id}/certidao`, { cookie: c.s.cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    const zip = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(Object.keys(zip).sort()).toEqual(['LEIA-ME.txt', 'carimbo.tsr', 'certidao.pdf', 'manifesto.json']);
    expect(strFromU8(zip['LEIA-ME.txt'])).toContain('posterior à publicação');
    expect(strFromU8(zip['LEIA-ME.txt'])).toContain('openssl ts -verify');
    expect(open).toHaveBeenCalled();
  });

  it('piece under review has no certificate, and without a certificate the download gives 404', async () => {
    const c = await published();
    expect((await req(`/api/t/${c.t}/pecas/${c.id}/certidao`, { cookie: c.s.cookie })).status).toBe(404);
    await env.DB.prepare("UPDATE pecas SET status = 'revisao' WHERE id = ?").bind(c.id).run();
    expect((await req(`/api/t/${c.t}/pecas/${c.id}/certidao`, { cookie: c.s.cookie, body: {} })).status).toBe(404);
  });

  it('IDOR: piece from another outlet', async () => {
    const c = await published();
    const outside = await published();
    await issueCertificate(env, c.t, c.id, true);
    expect(await packageCertificate(env, outside.t, c.id)).toBeNull();
    expect(await issueCertificate(env, outside.t, c.id, true)).toBeNull();
    expect((await req(`/api/t/${outside.t}/pecas/${c.id}/certidao`, { cookie: outside.s.cookie })).status).toBe(404);
    expect((await req(`/api/t/${outside.t}/pecas/${c.id}/certidao`, { cookie: outside.s.cookie, body: {} })).status).toBe(404);
    expect((await req(`/api/t/${outside.t}/pecas/${c.id}/certidao`, { cookie: c.s.cookie })).status).toBe(404);
  });

  it("reporter doesn't download", async () => {
    const c = await published();
    const rep = await register();
    await seedMember(c.t, rep.userId, 'reporter');
    expect((await req(`/api/t/${c.t}/pecas/${c.id}/certidao`, { cookie: rep.cookie })).status).toBe(403);
  });
});

describe('takedown kit', () => {
  it('open case: opens, lists and closes, only within its own outlet', async () => {
    const c = await published();
    const outside = await published();
    const res = await req(`/api/t/${c.t}/kit/casos`, { cookie: c.s.cookie, body: { tipo: 'desativada', abertoEm: '2026-11-01', prazoEm: '2026-12-01', nota: 'aviso' } });
    expect(res.status).toBe(201);
    const { id } = await res.json<{ id: string }>();
    expect((await (await req(`/api/t/${c.t}/kit`, { cookie: c.s.cookie })).json<{ casos: unknown[] }>()).casos).toEqual([expect.objectContaining({ id, prazo_em: '2026-12-01' })]);
    expect((await (await req(`/api/t/${outside.t}/kit`, { cookie: outside.s.cookie })).json<{ casos: unknown[] }>()).casos).toEqual([]);
    expect((await req(`/api/t/${outside.t}/kit/casos/${id}`, { cookie: outside.s.cookie, method: 'DELETE' })).status).toBe(404);
    expect((await req(`/api/t/${c.t}/kit/casos/${id}`, { cookie: c.s.cookie, method: 'DELETE' })).status).toBe(200);
  });

  it("rejects what isn't a case", async () => {
    const c = await published();
    const request = (b: object) => req(`/api/t/${c.t}/kit/casos`, { cookie: c.s.cookie, body: b });
    expect((await request({ tipo: 'x', abertoEm: '2026-11-01' })).status).toBe(400);
    expect((await request({ tipo: 'outro', abertoEm: 'ontem' })).status).toBe(400);
    expect((await request({ tipo: 'outro', abertoEm: '2026-11-01', prazoEm: 'logo' })).status).toBe(400);
    expect((await request({ tipo: 'outro', abertoEm: '2026-11-01', nota: 'x'.repeat(501) })).status).toBe(400);
  });

  it('templates in both languages, with the warning and blank fields in view', () => {
    for (const language of ['pt-BR', 'en'] as const) {
      const m = modelsKit(language);
      expect(m.map((x) => x.id)).toEqual(['revisao', 'titularidade', 'consumidor']);
      for (const x of m) {
        expect(x.texto).toMatch(/não é orientação jurídica|not legal advice/);
        expect(x.texto).toMatch(/\[[^\]]+\]/);
      }
      expect(scriptKit(language).map((p) => p.texto).join(' ')).toMatch(/consumidor\.gov\.br/);
      expect(scriptKit(language).map((p) => p.texto).join(' ')).toMatch(/link/);
    }
    expect(CASE_TYPES).toContain('direito_autoral');
  });

  it('counts the days', () => {
    expect(untilDays('2026-11-10', '2026-11-05')).toBe(5);
    expect(untilDays('2026-11-05', '2026-11-05')).toBe(0);
    expect(untilDays('2026-11-01', '2026-11-05')).toBe(-4);
  });
});
