// Step 18: pasting the site suggests name, logo, colours and fonts, and nothing is saved; copying a template between
// outlets requires admin in both and does not carry the sponsor. The code that runs in Chrome (`READ_SITE`) is tested in
// web/e2e/brand-import.spec.ts, in a real browser.
import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { contrast } from '../src/lib/contrast';
import { fromSiteColors, toHex, fromSitePair, type ReadingSite } from '../src/lib/siteReader';
import { MAX_IMPORTS_DAY, addressSite, importBrand } from '../src/lib/brandImport';
import { browserApi } from '../src/lib/render';
import { register, req, seedMember, seedTenant } from './helpers';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const SVG_BAD = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script><rect width="10" height="10"/></svg>';

const reading = (o: Partial<ReadingSite> = {}): ReadingSite => ({ nome: 'Gazeta da Orla', logos: [], svg: null, fundos: ['rgb(16, 42, 87)'], destaques: ['rgb(230, 57, 70)', 'rgb(0, 0, 0)'], fontes: ['Georgia, serif', 'Arial'], ...o });

function fakeBrowser(l: ReadingSite | Error, o: { urlFinal?: string; status?: number } = {}) {
  const close = vi.fn(async () => {});
  let route: ((r: unknown) => unknown) | undefined;
  const page = {
    route: async (_: RegExp, f: (r: unknown) => unknown) => { route = f; },
    goto: async (url: string) => {
      if (l instanceof Error) throw l;
      return { ok: () => (o.status ?? 200) < 400, url: () => url };
    },
    url: () => o.urlFinal ?? 'https://gazeta.example/',
    evaluate: async () => l,
  };
  const open = vi.spyOn(browserApi, 'abrir').mockImplementation((() => Promise.resolve({ newPage: async () => page, close: close })) as never);
  return { abrir: open, fechar: close, rotear: () => route! };
}

afterEach(() => vi.restoreAllMocks());

async function admin() {
  const t = await seedTenant();
  const s = await register('Ana Costa');
  await seedMember(t, s.userId, 'admin');
  return { t, s };
}

describe('reading the site', () => {
  it('accepts the address as the person pastes it and rejects what is neither public nor http', () => {
    expect(addressSite('gazeta.com.br')).toBe('https://gazeta.com.br/');
    expect(addressSite(' https://gazeta.com.br/x ')).toBe('https://gazeta.com.br/x');
    for (const v of ['http://localhost/', 'http://127.0.0.1/', 'http://[::1]/', 'ftp://gazeta.com.br/', 'file:///etc/passwd', 'javascript:alert(1)', 'http://intranet.local/', 'https://u:s@gazeta.com.br/', 'http://169.254.169.254/latest/', '', null, 5]) expect(addressSite(v), String(v)).toBeNull();
  });

  it('color: rgb, rgba and hex; transparent is nothing', () => {
    expect(toHex('rgb(16, 42, 87)')).toBe('#102a57');
    expect(toHex('rgba(16, 42, 87, 0.9)')).toBe('#102a57');
    expect(toHex('rgb(16 42 87)')).toBe('#102a57');
    expect(toHex('#abc')).toBe('#aabbcc');
    expect(toHex('rgba(0, 0, 0, 0)')).toBeNull();
    expect(toHex('transparent')).toBeNull();
  });

  it("dark background becomes a background with readable text; light background doesn't; the highlight is a real, readable color", () => {
    const c = fromSiteColors(reading());
    expect(c).toEqual({ fundo: '#102a57', texto: '#fffcf6', acento: '#e63946' });
    expect(contrast(c.texto!, c.fundo!)).toBeGreaterThanOrEqual(4.5);
    expect(fromSiteColors({ fundos: ['rgb(255, 255, 255)'], destaques: ['rgb(51, 51, 51)', 'rgb(230, 57, 70)'] })).toEqual({ acento: '#e63946' });
    expect(fromSiteColors({ fundos: [], destaques: ['rgb(51, 51, 51)'] })).toEqual({});
  });

  it('suggests a catalog pair by the font type of the title', () => {
    expect(fromSitePair(['Georgia, serif'])).toBe('jornal');
    expect(fromSitePair(['"Tiempos", serif'])).toBe('jornal');
    expect(fromSitePair(['"Helvetica Neue", sans-serif'])).toBe('grotesca');
    expect(fromSitePair(['Nunito, sans-serif'])).toBe('padrao');
    expect(fromSitePair([])).toBe('padrao');
  });

  it('SVG logo goes through cleaning; PNG comes as it is; JPEG is skipped; the browser always closes', async () => {
    const { fechar: close } = fakeBrowser(reading({ svg: SVG_BAD }));
    const r = await importBrand(env, 'https://gazeta.example/');
    expect(r).toMatchObject({ nome: 'Gazeta da Orla', fontes: 'jornal' });
    expect(r.logo?.tipo).toBe('image/svg+xml');
    expect(atob(r.logo!.base64)).not.toContain('script');
    expect(close).toHaveBeenCalledOnce();

    fakeBrowser(reading({ logos: ['https://gazeta.example/a.jpg', 'https://gazeta.example/b.png'] }));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (u) => String(u).endsWith('.jpg')
      ? new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), { headers: { 'content-type': 'image/jpeg' } })
      : new Response(PNG, { headers: { 'content-type': 'image/png' } }));
    expect((await importBrand(env, 'https://gazeta.example/')).logo?.tipo).toBe('image/png');
  });

  it("logo at an internal address isn't downloaded", async () => {
    fakeBrowser(reading({ logos: ['http://169.254.169.254/logo.png'] }));
    const download = vi.spyOn(globalThis, 'fetch');
    expect((await importBrand(env, 'https://gazeta.example/')).logo).toBeNull();
    expect(download).not.toHaveBeenCalled();
  });

  it('a site that redirects to an internal address is rejected; only the page and CSS load', async () => {
    const { fechar: close, rotear: route } = fakeBrowser(reading(), { urlFinal: 'http://localhost/' });
    await expect(importBrand(env, 'https://gazeta.example/')).rejects.toThrow('site_fora');
    expect(close).toHaveBeenCalledOnce();
    const request = (url: string, type: string) => {
      const r = { abort: vi.fn(), continue: vi.fn(), request: () => ({ url: () => url, resourceType: () => type }) };
      route()(r);
      return r;
    };
    expect(request('https://gazeta.example/a.css', 'stylesheet').continue).toHaveBeenCalled();
    expect(request('https://gazeta.example/materia.jpg', 'image').abort).toHaveBeenCalled();
    expect(request('http://metadata.internal/x', 'document').abort).toHaveBeenCalled();
  });
});

describe('POST /marca/puxar', () => {
  const importValue = (t: string, cookie: string, url: unknown = 'gazeta.example') => req(`/api/t/${t}/marca/puxar`, { cookie, body: { url } });

  it('returns the suggestion and saves nothing to the brand', async () => {
    const { t, s } = await admin();
    fakeBrowser(reading());
    const before = await env.DB.prepare('SELECT marca_json FROM tenants WHERE id = ?').bind(t).first();
    const r = await importValue(t, s.cookie);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ nome: 'Gazeta da Orla', fontes: 'jornal', cores: { fundo: '#102a57' } });
    expect(await env.DB.prepare('SELECT marca_json FROM tenants WHERE id = ?').bind(t).first()).toEqual(before);
  });

  it("address that isn't public gives 400 without opening a browser; site down gives 502 with a message", async () => {
    const { t, s } = await admin();
    const { abrir: open } = fakeBrowser(new Error('net::ERR_NAME_NOT_RESOLVED'));
    expect((await importValue(t, s.cookie, 'http://127.0.0.1/')).status).toBe(400);
    expect(open).not.toHaveBeenCalled();
    const outside = await importValue(t, s.cookie);
    expect(outside.status).toBe(502);
    expect(await outside.json()).toMatchObject({ erro: 'Não deu para ler esse site agora. Preencha à mão ou tente de novo.' });
  });

  it('the daily cap applies per outlet', async () => {
    const { t, s } = await admin();
    fakeBrowser(reading());
    await env.DB.batch(Array.from({ length: MAX_IMPORTS_DAY }, () => env.DB.prepare("INSERT INTO eventos (tenant_id, tipo, ref_tipo, ref_id) VALUES (?, 'marca.puxada', 'tenant', ?)").bind(t, t)));
    expect((await importValue(t, s.cookie)).status).toBe(429);
    const b = await admin();
    expect((await importValue(b.t, b.s.cookie)).status).toBe(200);
  });

  it('IDOR: another outlet gives 404; editor gives 403', async () => {
    const { t } = await admin();
    const outside = await register('Fora');
    expect((await importValue(t, outside.cookie)).status).toBe(404);
    const ed = await register('Ed');
    await seedMember(t, ed.userId, 'editor');
    expect((await importValue(t, ed.cookie)).status).toBe(403);
  });
});

describe('copy template', () => {
  const PARAMS = { composicao: 'tarja', tecnica: 'nanquim', caixaTitulo: 'normal', papelCores: 'normal', sequencia: ['numero'], reels: { passo: 0.8, movimento: 'folha' } };

  async function twoOutlets() {
    const { t: origin, s } = await admin();
    const target = await seedTenant();
    await seedMember(target, s.userId, 'admin');
    const pat = { id: crypto.randomUUID() };
    await env.DB.prepare("INSERT INTO patrocinios (id, tenant_id, nome, inicio, fim, por) VALUES (?, ?, 'Padaria', '2026-01-01', '2030-01-01', ?)").bind(pat.id, origin, s.userId).run();
    const r = await req(`/api/t/${origin}/estilos`, { cookie: s.cookie, body: { nome: 'Plantão', padrao: true, valePara: { editorias: ['policia'], palavras: ['urgente'] }, params: { ...PARAMS, patrocinio: pat.id } } });
    expect(r.status).toBe(201);
    return { origem: origin, destino: target, s, estiloId: (await r.json<{ id: string }>()).id };
  }
  const copyText = (target: string, cookie: string, body: unknown) => req(`/api/t/${target}/estilos/copiar`, { cookie, body: body });

  it("copies name, vale_para and params, with a new id, without default and without sponsor; changing the original doesn't change the copy", async () => {
    const { origem: origin, destino: target, s, estiloId: styleId } = await twoOutlets();
    const r = await copyText(target, s.cookie, { origem: origin, estiloId: styleId });
    expect(r.status).toBe(201);
    const { id } = await r.json<{ id: string }>();
    expect(id).not.toBe(styleId);
    const copy = await env.DB.prepare('SELECT tenant_id, nome, padrao, vale_para_json, params_json FROM estilos WHERE id = ?').bind(id).first<{ tenant_id: string; nome: string; padrao: number; vale_para_json: string; params_json: string }>();
    expect(copy).toMatchObject({ tenant_id: target, nome: 'Plantão', padrao: 0 });
    expect(JSON.parse(copy!.vale_para_json)).toMatchObject({ editorias: ['policia'], palavras: ['urgente'] });
    const params = JSON.parse(copy!.params_json);
    expect(params).toMatchObject({ composicao: 'tarja', tecnica: 'nanquim', sequencia: ['numero'] });
    expect(params.patrocinio ?? null).toBeNull();
    await env.DB.prepare("UPDATE estilos SET nome = 'Outro' WHERE id = ?").bind(styleId).run();
    expect((await env.DB.prepare('SELECT nome FROM estilos WHERE id = ?').bind(id).first<{ nome: string }>())?.nome).toBe('Plantão');
  });

  it('duplicate name gives 409; the same outlet gives 400; archived template or one from another outlet gives 404', async () => {
    const { origem: origin, destino: target, s, estiloId: styleId } = await twoOutlets();
    expect((await copyText(target, s.cookie, { origem: origin, estiloId: styleId })).status).toBe(201);
    expect((await copyText(target, s.cookie, { origem: origin, estiloId: styleId })).status).toBe(409);
    expect((await copyText(origin, s.cookie, { origem: origin, estiloId: styleId })).status).toBe(400);
    const thirdParty = await twoOutlets();
    expect((await copyText(target, s.cookie, { origem: origin, estiloId: thirdParty.estiloId })).status).toBe(404);
    await env.DB.prepare("UPDATE estilos SET arquivado_em = datetime('now') WHERE id = ?").bind(styleId).run();
    expect((await copyText(target, s.cookie, { origem: origin, estiloId: styleId })).status).toBe(404);
  });

  it("IDOR: whoever isn't a member of the source gets 404, without knowing whether the template exists; whoever isn't admin at the source gets 403", async () => {
    const a = await twoOutlets();
    const b = await admin();
    expect((await copyText(b.t, b.s.cookie, { origem: a.origem, estiloId: a.estiloId })).status).toBe(404);
    expect((await copyText(b.t, b.s.cookie, { origem: a.origem, estiloId: 'nao-existe' })).status).toBe(404);
    await seedMember(a.origem, b.s.userId, 'editor');
    expect((await copyText(b.t, b.s.cookie, { origem: a.origem, estiloId: a.estiloId })).status).toBe(403);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM estilos WHERE tenant_id = ?').bind(b.t).first('n')).toBe(0);
  });

  it("whoever isn't admin at the destination gets 403; outside the destination, 404", async () => {
    const a = await twoOutlets();
    const ed = await register('Ed');
    await seedMember(a.destino, ed.userId, 'editor');
    await seedMember(a.origem, ed.userId, 'admin');
    expect((await copyText(a.destino, ed.cookie, { origem: a.origem, estiloId: a.estiloId })).status).toBe(403);
    const outside = await register('Fora');
    expect((await copyText(a.destino, outside.cookie, { origem: a.origem, estiloId: a.estiloId })).status).toBe(404);
  });
});
