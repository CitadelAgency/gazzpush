// Phase 8: the zip reader, a model with an unreadable answer, routes without IDOR, the public page and the month's file in streaming.
import { env } from 'cloudflare:test';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { zipMonth } from '../src/lib/monthArchive';
import { POSTS_PER_PAGE } from '../src/lib/outletPage';
import { MAX_ITEMS_BATCH, findPosts, fixAccent, readVision, marksInCaption } from '../src/lib/xray';
import { analyzeItem, closeItem } from '../src/lib/xrayQueue';
import { readMediaZip, readPostsZip } from '../src/lib/xrayZip';
import { register, req, seedAccount, seedMember, seedTenant } from './helpers';

const stream = (b: Uint8Array, chunk = 64) => new ReadableStream<Uint8Array>({
  start(c) { for (let i = 0; i < b.length; i += chunk) c.enqueue(b.slice(i, i + chunk)); c.close(); },
});
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
let vision: unknown = '{"marca_dagua":false,"logo":false,"credito":false}';

beforeEach(() => {
  vision = '{"marca_dagua":false,"logo":false,"credito":false}';
  vi.spyOn(env.MONITOR_QUEUE, 'send').mockResolvedValue(undefined as never);
  vi.spyOn(env.AI, 'run').mockImplementation((async () => ({ response: vision })) as never);
});
afterEach(() => vi.restoreAllMocks());

const POSTS = (caption: string) => JSON.stringify([{ media: [{ uri: 'media/posts/202301/a.jpg', creation_timestamp: 1_672_531_200 }], title: caption }, { uri: 'media/reels/b.mp4', creation_timestamp: 1_700_000_000, title: 'Vídeo' }]);

describe('archive reader', () => {
  it('finds the post in two folder formats, with the uri from the zip root', async () => {
    for (const root of ['', 'instagram-gazeta-2026/']) {
      const zip = zipSync({
        [`${root}media/posts/202301/a.jpg`]: new Uint8Array([9, 9, 9]),
        [`${root}your_instagram_activity/content/posts_1.json`]: strToU8(POSTS('Legenda')),
        [`${root}media/reels/b.mp4`]: new Uint8Array([8, 8]),
        [`${root}media/outro/c.jpg`]: new Uint8Array([7]),
      });
      const { posts, html } = await readPostsZip(stream(zip));
      expect(html).toBe(false);
      expect(posts.map((p) => p.uri)).toEqual(['media/reels/b.mp4', 'media/posts/202301/a.jpg']);
      expect(posts[1]).toMatchObject({ legenda: 'Legenda', data: '2023-01-01T00:00:00.000Z' });
      const seen: [string, number][] = [];
      await readMediaZip(stream(zip), posts, async (p, b) => { seen.push([p.uri, b.byteLength]); });
      expect(seen.sort()).toEqual([['media/posts/202301/a.jpg', 3], ['media/reels/b.mp4', 2]]);
    }
  });

  it('HTML file is refused', async () => {
    const r = await readPostsZip(stream(zipSync({ 'index.html': strToU8('<html>'), 'media/a.jpg': new Uint8Array([1]) })));
    expect(r).toEqual({ posts: [], html: true });
  });

  it("doesn't read private messages, and broken JSON doesn't stop the rest", async () => {
    const zip = zipSync({ 'messages/inbox/x/message_1.json': strToU8(POSTS('Privada')), 'a.json': strToU8('{quebrado'), 'b.json': strToU8(POSTS('Pública')) });
    expect((await readPostsZip(stream(zip))).posts.map((p) => p.legenda)).toEqual(['Vídeo', 'Pública']);
  });

  it('broken accent is fixed; correct text stays', () => {
    expect(fixAccent('aÃ§Ã£o na ponte')).toBe('ação na ponte');
    expect(fixAccent('ação na ponte')).toBe('ação na ponte');
    expect(fixAccent('🙂 ação')).toBe('🙂 ação');
    expect(findPosts({ uri: 'a.jpg', creation_timestamp: 1, title: 'Ã©' })[0].legenda).toBe('é');
    expect(findPosts({ uri: 'https://x.example/a.jpg', creation_timestamp: 1 })).toEqual([]);
  });

  it('credit in the caption, in both languages', () => {
    expect(marksInCaption('Bela vista via @outrapagina hoje')).toEqual(['via @outrapagina']);
    expect(marksInCaption('Foto: João Silva')).toEqual(['Foto: João Silva']);
    expect(marksInCaption('Reprodução/TV')).toEqual(['Reprodução']);
    expect(marksInCaption('Photo by Jane')).toEqual(['Photo by Jane']);
    expect(marksInCaption('A ponte fecha amanhã')).toEqual([]);
  });

  it('unreadable model response becomes null', () => {
    expect(readVision('{"marca_dagua":true,"logo":false,"credito":false}')).toEqual(['marca_dagua']);
    expect(readVision('Aqui está: {"logo":true}')).toEqual(['logo']);
    expect(readVision('Não sei dizer')).toBeNull();
    expect(readVision('{"pessoas":2}')).toBeNull();
    expect(readVision('{quebrado}')).toBeNull();
  });
});

async function scenario(role: 'admin' | 'editor' | 'reporter' = 'editor') {
  const t = await seedTenant();
  const s = await register();
  await seedMember(t, s.userId, role);
  return { t, s };
}

const upload = async (t: string, batch: string, cookie: string, o: { legenda?: string; bytes?: Uint8Array<ArrayBuffer> } = {}) => {
  const form = new FormData();
  form.set('arquivo', new File([o.bytes ?? JPEG], 'm.jpg', { type: 'image/jpeg' }));
  form.set('data', '2024-03-01T00:00:00.000Z');
  form.set('legenda', o.legenda ?? '');
  const built = new Request('http://x', { method: 'POST', body: form });
  return req(`/api/t/${t}/raiox/${batch}/itens`, { cookie, method: 'POST', cru: { tipo: built.headers.get('content-type')!, corpo: await built.arrayBuffer() } });
};
const newBatch = async (t: string, cookie: string) => (await (await req(`/api/t/${t}/raiox`, { cookie, body: {} })).json<{ id: string }>()).id;
const readItem = (id: string) => env.DB.prepare('SELECT estado, motivos_json FROM raiox_itens WHERE id = ?').bind(id).first<{ estado: string; motivos_json: string | null }>();

describe('X-ray on the server', () => {
  it('marks, leaves clean, and the unreadable one stays visible', async () => {
    const { t, s } = await scenario();
    const batch = await newBatch(t, s.cookie);
    const [a, b, c, d] = await Promise.all(['', 'Foto: Ana', '', ''].map(async (caption) => (await (await upload(t, batch, s.cookie, { legenda: caption })).json<{ id: string }>()).id));
    await analyzeItem(env, t, a);
    expect(await readItem(a)).toMatchObject({ estado: 'limpo' });
    await analyzeItem(env, t, b);
    expect(await readItem(b)).toMatchObject({ estado: 'marcado', motivos_json: JSON.stringify(['legenda:Foto: Ana']) });
    vision = 'não sei';
    await analyzeItem(env, t, c);
    expect((await readItem(c))?.estado).toBe('ilegivel');
    await closeItem(env, t, d);
    expect((await readItem(d))?.estado).toBe('ilegivel');
    const r = await (await req(`/api/t/${t}/raiox`, { cookie: s.cookie })).json<{ lote: Record<string, number>; itens: { estado: string; miniatura: string }[] }>();
    expect(r.lote).toMatchObject({ total: 4, marcados: 1, ilegiveis: 2, pendentes: 0 });
    expect(r.itens.map((i) => i.estado).sort()).toEqual(['ilegivel', 'ilegivel', 'marcado']);
    expect(r.itens[0].miniatura).toContain('/media/');
  });

  it("processing again doesn't change the result or call the model", async () => {
    const { t, s } = await scenario();
    const batch = await newBatch(t, s.cookie);
    const { id } = await (await upload(t, batch, s.cookie)).json<{ id: string }>();
    await analyzeItem(env, t, id);
    await analyzeItem(env, t, id);
    expect(vi.mocked(env.AI.run)).toHaveBeenCalledTimes(1);
  });

  it('only JPEG, one X-ray at a time, batch cap, and deleting removes rows and thumbnails', async () => {
    const { t, s } = await scenario();
    const batch = await newBatch(t, s.cookie);
    expect((await req(`/api/t/${t}/raiox`, { cookie: s.cookie, body: {} })).status).toBe(409);
    expect((await upload(t, batch, s.cookie, { bytes: new Uint8Array([1, 2, 3, 4]) })).status).toBe(400);
    expect((await upload(t, batch, s.cookie)).status).toBe(201);
    await env.DB.prepare('UPDATE raiox_lotes SET total = ? WHERE id = ?').bind(MAX_ITEMS_BATCH, batch).run();
    expect((await upload(t, batch, s.cookie)).status).toBe(409);
    expect((await env.MEDIA.list({ prefix: `raiox/${t}/` })).objects).toHaveLength(1);
    expect((await req(`/api/t/${t}/raiox/${batch}`, { cookie: s.cookie, method: 'DELETE' })).status).toBe(200);
    expect((await env.MEDIA.list({ prefix: `raiox/${t}/` })).objects).toEqual([]);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM raiox_itens WHERE tenant_id = ?').bind(t).first('n')).toBe(0);
    expect((await (await req(`/api/t/${t}/raiox`, { cookie: s.cookie })).json<{ lote: unknown }>()).lote).toBeNull();
  });

  it("IDOR: another outlet's batch; reporter can't get in", async () => {
    const a = await scenario();
    const b = await scenario();
    const batch = await newBatch(a.t, a.s.cookie);
    expect((await upload(b.t, batch, b.s.cookie)).status).toBe(404);
    expect((await upload(a.t, batch, b.s.cookie)).status).toBe(404);
    expect((await req(`/api/t/${b.t}/raiox/${batch}`, { cookie: b.s.cookie, method: 'DELETE' })).status).toBe(404);
    expect((await (await req(`/api/t/${b.t}/raiox`, { cookie: b.s.cookie })).json<{ lote: unknown }>()).lote).toBeNull();
    const rep = await scenario('reporter');
    expect((await req(`/api/t/${rep.t}/raiox`, { cookie: rep.s.cookie })).status).toBe(403);
  });
});

async function publish(t: string, account: string, o: { titulo?: string; modo?: string; status?: string; tipoPost?: string; quando?: string; legenda?: string } = {}) {
  const [leadId, id] = [crypto.randomUUID(), crypto.randomUUID()];
  const jpg = `artes/${t}/${id}/v1/capa.jpg`;
  await env.MEDIA.put(jpg, new Uint8Array(2000).fill(5));
  await env.DB.batch([
    env.DB.prepare("INSERT INTO pautas (id, tenant_id, status, origem, titulo, fato_ids_json, documento_ids_json, score, tipo_post) VALUES (?, ?, 'concluida', 'manual', 'P', '[]', '[]', 1, ?)").bind(leadId, t, o.tipoPost ?? null),
    env.DB.prepare(`INSERT INTO pecas (id, tenant_id, pauta_id, formato, status, versao, custo_usd, conteudo_json, arte_r2_keys_json, workflow_id) VALUES (?, ?, ?, 'carrossel', ?, 1, 0, ?, ?, ?)`)
      .bind(id, t, leadId, o.status ?? 'publicada', JSON.stringify({ manchete: o.titulo ?? 'Ponte fecha', legenda: o.legenda ?? 'Legenda do post' }), JSON.stringify([{ papel: 'capa', png: 'x', jpg }]), `${id}-r1`),
    ...(o.status ? [] : [env.DB.prepare("INSERT INTO publicacoes (id, tenant_id, peca_id, conta_id, rede, modo, url, publicado_em, status) VALUES (?, ?, ?, ?, 'instagram', ?, 'https://instagram.com/p/x', ?, 'publicada')")
      .bind(crypto.randomUUID(), t, id, account, o.modo ?? 'manual', o.quando ?? '2026-11-03 12:00:00')]),
  ]);
  return id;
}
const page = (slug: string, q = '') => req(`/v/${slug}${q}`, { method: 'GET', origin: null });

describe('/v/:slug', () => {
  it('turned off gives 404, same as a nonexistent slug; turning it on is admin only', async () => {
    const { t, s } = await scenario('admin');
    const account = await seedAccount(t);
    await publish(t, account);
    const { slug } = (await env.DB.prepare('SELECT slug FROM tenants WHERE id = ?').bind(t).first<{ slug: string }>())!;
    expect((await page(slug)).status).toBe(404);
    expect((await page('nao-existe')).status).toBe(404);
    const editor = await register();
    await seedMember(t, editor.userId, 'editor');
    expect((await req(`/api/t/${t}/pagina-publica`, { cookie: editor.cookie, method: 'PATCH', body: { ligada: true } })).status).toBe(403);
    expect((await req(`/api/t/${t}/pagina-publica`, { cookie: s.cookie, method: 'PATCH', body: { ligada: true } })).status).toBe(200);
    expect((await page(slug)).status).toBe(200);
    expect((await req(`/api/t/${t}/pagina-publica`, { cookie: s.cookie, method: 'PATCH', body: { ligada: false } })).status).toBe(200);
    expect((await page(slug)).status).toBe(404);
  });

  it('only actually published posts from the outlet itself, with labelled advertising', async () => {
    const { t } = await scenario('admin');
    const outside = await scenario('admin');
    const account = await seedAccount(t);
    const other = await seedAccount(outside.t);
    await publish(t, account, { titulo: 'Post de verdade' });
    await publish(t, account, { titulo: 'Post simulado', modo: 'simulada' });
    await publish(t, account, { titulo: 'Rascunho guardado', status: 'revisao' });
    await publish(t, account, { titulo: 'Oferta da padaria', tipoPost: 'publicidade' });
    await publish(outside.t, other, { titulo: 'Post do outro veículo' });
    await env.DB.prepare("UPDATE tenants SET pagina_publica_em = datetime('now') WHERE id = ?").bind(t).run();
    const { slug } = (await env.DB.prepare('SELECT slug FROM tenants WHERE id = ?').bind(t).first<{ slug: string }>())!;
    const html = await (await page(slug)).text();
    expect(html).toContain('Post de verdade');
    expect(html).toContain('Publicidade');
    expect(html).not.toMatch(/Post simulado|Rascunho guardado|Post do outro veículo/);
    expect(html).toContain('/media/artes/');
  });

  it('paginates by 30 and escapes what comes from the post', async () => {
    const { t } = await scenario('admin');
    const account = await seedAccount(t);
    for (let i = 0; i < POSTS_PER_PAGE + 1; i++) await publish(t, account, { titulo: `Post ${i}`, quando: `2026-11-03 12:${String(i).padStart(2, '0')}:00`, legenda: '<script>alert(1)</script>' });
    await env.DB.prepare("UPDATE tenants SET pagina_publica_em = datetime('now') WHERE id = ?").bind(t).run();
    const { slug } = (await env.DB.prepare('SELECT slug FROM tenants WHERE id = ?').bind(t).first<{ slug: string }>())!;
    const one = await (await page(slug)).text();
    expect(one).toContain('?p=2');
    expect(one).not.toContain('<script>');
    expect(one).not.toContain('>Post 0<');
    expect(await (await page(slug, '?p=2')).text()).toContain('>Post 0<');
  });
});

describe('Download the month', () => {
  it('streaming zip, intact, only the month and only the outlet', async () => {
    const { t, s } = await scenario();
    const account = await seedAccount(t);
    const inside = await publish(t, account, { legenda: 'No mês', quando: '2026-11-03 12:00:00' });
    await publish(t, account, { legenda: 'Fora do mês', quando: '2026-10-03 12:00:00' });
    await publish(t, account, { legenda: 'Simulada', modo: 'simulada', quando: '2026-11-04 12:00:00' });
    await env.MEDIA.put(`certidoes/${t}/m.json`, strToU8('{}'));
    await env.MEDIA.put(`certidoes/${t}/m.tsr`, new Uint8Array([1]));
    await env.DB.prepare('INSERT INTO certidoes (id, tenant_id, peca_id, versao, sha256, r2_manifesto, r2_carimbo) VALUES (?, ?, ?, 1, ?, ?, ?)').bind(crypto.randomUUID(), t, inside, 'x', `certidoes/${t}/m.json`, `certidoes/${t}/m.tsr`).run();
    const res = await req(`/api/t/${t}/kit/mes?mes=2026-11`, { cookie: s.cookie });
    expect(res.status).toBe(200);
    const zip = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(Object.keys(zip).sort()).toEqual([
      '001-2026-11-03/card-01.jpg', '001-2026-11-03/certidao/carimbo.tsr', '001-2026-11-03/certidao/manifesto.json',
      '001-2026-11-03/legenda.txt', '001-2026-11-03/link.txt', 'LEIA-ME.txt',
    ]);
    expect(new TextDecoder().decode(zip['001-2026-11-03/legenda.txt'])).toBe('No mês');
    expect(zip['001-2026-11-03/card-01.jpg']).toEqual(new Uint8Array(2000).fill(5));
  });

  it('delivered in chunks, without waiting for the end', async () => {
    const { t } = await scenario();
    const account = await seedAccount(t);
    await publish(t, account, { quando: '2026-11-03 12:00:00' });
    const { corpo: body, pronto: ready } = await zipMonth(env, t, '2026-11');
    const reader = body.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    for (;;) { if ((await reader.read()).done) break; }
    await ready;
  });

  it("invalid month gives 400; another outlet doesn't see it; reporter can't download", async () => {
    const a = await scenario();
    const b = await scenario();
    const account = await seedAccount(a.t);
    await publish(a.t, account, { quando: '2026-11-03 12:00:00' });
    expect((await req(`/api/t/${a.t}/kit/mes?mes=2026-13`, { cookie: a.s.cookie })).status).toBe(400);
    const zip = unzipSync(new Uint8Array(await (await req(`/api/t/${b.t}/kit/mes?mes=2026-11`, { cookie: b.s.cookie })).arrayBuffer()));
    expect(Object.keys(zip)).toEqual(['LEIA-ME.txt']);
    expect((await req(`/api/t/${a.t}/kit/mes?mes=2026-11`, { cookie: b.s.cookie })).status).toBe(404);
    const rep = await scenario('reporter');
    expect((await req(`/api/t/${rep.t}/kit/mes`, { cookie: rep.s.cookie })).status).toBe(403);
  });
});
