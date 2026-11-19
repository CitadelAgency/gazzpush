import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { sanitizeSvg } from '../src/shell/brand';
import { waterTagBrand } from '../src/lib/watermark';
import { preencherTemplate } from '../src/lib/render';
import template from '../src/templates/card.html';
import { register, req, seedMember, seedTenant } from './helpers';

const PNG_1PX = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (ch) => ch.charCodeAt(0));

const SVG_MALICIOUS = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10" onload="alert(1)">
  <script>alert(2)</script>
  <defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/></linearGradient></defs>
  <foreignObject><div xmlns="http://www.w3.org/1999/xhtml" onclick="alert(3)">x</div></foreignObject>
  <a href="javascript:alert(4)"><rect width="5" height="5"/></a>
  <use xlink:href="https://evil.example/x.svg#a"/>
  <image href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="/>
  <circle r="2" fill="url(#g)" style="stroke:url(https://evil.example/t)"/>
  <style>@import url(https://evil.example/x.css);</style>
  <g title="&quot; onmouseover=&quot;alert(5)"><path d="M0 0L5 5" fill="#123456"/></g>
</svg>`;

async function admin() {
  const s = await register();
  const t = await seedTenant();
  await seedMember(t, s.userId, 'admin');
  return { s, t };
}
const brandOf = async (t: string) =>
  JSON.parse((await env.DB.prepare('SELECT marca_json FROM tenants WHERE id = ?').bind(t).first<{ marca_json: string }>())!.marca_json);

describe('GET /marca', () => {
  it('any member reads name, @, colors and the signed logo; no R2 keys; non-member: 404', async () => {
    const { s, t } = await admin();
    await env.DB.prepare('UPDATE tenants SET marca_json = ? WHERE id = ?')
      .bind(JSON.stringify({ nome: 'Veículo', handle: '@v', cores: { fundo: '#000000' }, logoR2: 'marcas/x/logo-1.png', ctas: [{ titulo: 'x' }], arteRefR2: 'ref' }), t).run();
    const reporter = await register();
    await seedMember(t, reporter.userId, 'reporter');
    const res = await req(`/api/t/${t}/marca`, { cookie: reporter.cookie });
    expect(res.status).toBe(200);
    const { marca: brand } = await res.json<{ marca: Record<string, unknown> }>();
    expect(brand).toMatchObject({ nome: 'Veículo', handle: '@v', cores: { fundo: '#000000' }, temLogo: true, temReferencia: true });
    expect(String(brand.logo)).toMatch(/\/media\/marcas\/x\/logo-1\.png\?/);
    // From the CTAs, only the editable texts; no R2 key.
    expect(brand.ctas).toEqual([{ titulo: 'x', texto: '', legenda: '', acao: '' }]);
    expect(JSON.stringify(brand)).not.toMatch(/arteRefR2|logoR2|telefone|destaques/);
    const other = await register();
    expect((await req(`/api/t/${t}/marca`, { cookie: other.cookie })).status).toBe(404);
  });
});

describe('PATCH /marca', () => {
  it('admin writes @ and 3 colors by merge, without touching the rest of the brand', async () => {
    const { s, t } = await admin();
    await env.DB.prepare('UPDATE tenants SET marca_json = ? WHERE id = ?')
      .bind(JSON.stringify({ nome: 'Veículo', ctas: [{ titulo: 'x' }], arteRefR2: 'ref', cores: { fundo: '#000000' } }), t).run();
    const res = await req(`/api/t/${t}/marca`, {
      method: 'PATCH', cookie: s.cookie,
      body: { handle: '@folha.bairro', cores: { texto: '#FFFFFF', acento: '#0b5cc4' }, arteRefR2: 'hack', logoR2: 'marcas/outro/logo.png' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ marca: { nome: 'Veículo', handle: '@folha.bairro', cores: { fundo: '#000000', texto: '#ffffff', acento: '#0b5cc4' }, temLogo: false, temReferencia: true,
      estiloArte: null, ctas: [{ titulo: 'x', texto: '', legenda: '', acao: '' }], marcaDagua: { posicao: 'nenhuma', opacidade: 0.4 } } });
    const m = await brandOf(t);
    expect(m.ctas).toEqual([{ titulo: 'x' }]);
    expect(m.arteRefR2).toBe('ref');
    expect(m.logoR2).toBeUndefined();
  });

  it('validates hex, handle and name; empty @ deletes', async () => {
    const { s, t } = await admin();
    const patch = (body: unknown) => req(`/api/t/${t}/marca`, { method: 'PATCH', cookie: s.cookie, body });
    expect((await patch({ cores: { fundo: 'red' } })).status).toBe(400);
    expect((await patch({ cores: { fundo: '#12345' } })).status).toBe(400);
    expect((await patch({ handle: 'com espaço' })).status).toBe(400);
    expect((await patch({ nome: 'x' })).status).toBe(400);
    expect((await patch({ handle: 'ok_1' })).status).toBe(200);
    expect((await brandOf(t)).handle).toBe('@ok_1');
    expect((await patch({ handle: '' })).status).toBe(200);
    expect((await brandOf(t)).handle).toBeUndefined();
  });

  it("editor doesn't change the brand (403); non-member: 404", async () => {
    const s = await register();
    const t = await seedTenant();
    await seedMember(t, s.userId, 'editor');
    expect((await req(`/api/t/${t}/marca`, { method: 'PATCH', cookie: s.cookie, body: { handle: 'x' } })).status).toBe(403);
    expect((await req(`/api/t/${t}/marca/logo`, { cookie: s.cookie, cru: { tipo: 'image/png', corpo: PNG_1PX } })).status).toBe(403);
    const { s: other } = await admin();
    expect((await req(`/api/t/${t}/marca`, { method: 'PATCH', cookie: other.cookie, body: { handle: 'x' } })).status).toBe(404);
    expect((await req(`/api/t/${t}/marca/logo`, { cookie: other.cookie, cru: { tipo: 'image/png', corpo: PNG_1PX } })).status).toBe(404);
    expect((await brandOf(t)).handle).toBe('@teste');
  });

  it('CSRF: PATCH with Origin from another site → 403', async () => {
    const { s, t } = await admin();
    const res = await req(`/api/t/${t}/marca`, { method: 'PATCH', cookie: s.cookie, body: { handle: 'x' }, origin: 'https://evil.example' });
    expect(res.status).toBe(403);
  });
});

describe('POST /marca/logo', () => {
  it('PNG goes to marcas/<tenant>/logo-<id>.png and writes logoR2', async () => {
    const { s, t } = await admin();
    const res = await req(`/api/t/${t}/marca/logo`, { cookie: s.cookie, cru: { tipo: 'image/png', corpo: PNG_1PX } });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ marca: { temLogo: true } });
    const key: string = (await brandOf(t)).logoR2;
    expect(key.startsWith(`marcas/${t}/logo-`) && key.endsWith('.png')).toBe(true);
    const obj = await env.MEDIA.get(key);
    expect(obj?.httpMetadata?.contentType).toBe('image/png');
    expect(new Uint8Array(await obj!.arrayBuffer())).toEqual(PNG_1PX);
  });

  it('malicious SVG: script, on*, foreignObject, external href and external url() are removed; the drawing stays', async () => {
    const { s, t } = await admin();
    // There was a PNG before. It stays in R2: a production in progress stored that key and the render will read it.
    await req(`/api/t/${t}/marca/logo`, { cookie: s.cookie, cru: { tipo: 'image/png', corpo: PNG_1PX } });
    const old: string = (await brandOf(t)).logoR2;
    const res = await req(`/api/t/${t}/marca/logo`, { cookie: s.cookie, cru: { tipo: 'image/svg+xml; charset=utf-8', corpo: SVG_MALICIOUS } });
    expect(res.status).toBe(201);
    expect(await env.MEDIA.head(old)).not.toBeNull();
    const key: string = (await brandOf(t)).logoR2;
    expect(key !== old && key.startsWith(`marcas/${t}/logo-`) && key.endsWith('.svg')).toBe(true);
    const obj = await env.MEDIA.get(key);
    expect(obj?.httpMetadata?.contentType).toBe('image/svg+xml');
    const svg = await obj!.text();
    expect(svg).not.toMatch(/script|onload|onclick|onmouseover="|foreignObject|evil\.example|javascript:|data:|@import|<a[\s>]|<image/i);
    expect(svg).toContain('<path d="M0 0L5 5" fill="#123456">');
    expect(svg).toContain('fill="url(#g)"');
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  });

  it('refuses wrong format, fake PNG, SVG with DOCTYPE and a file over 512 KB', async () => {
    const { s, t } = await admin();
    const logo = (type: string, body: BodyInit) => req(`/api/t/${t}/marca/logo`, { cookie: s.cookie, cru: { tipo: type, corpo: body } });
    expect((await logo('image/jpeg', PNG_1PX)).status).toBe(415);
    expect((await logo('image/png', new TextEncoder().encode('<svg></svg>'))).status).toBe(400);
    expect((await logo('image/svg+xml', '<!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>')).status).toBe(400);
    expect((await logo('image/svg+xml', '<html><body>oi</body></html>')).status).toBe(400);
    const large = new Uint8Array(512 * 1024 + 1);
    large.set(PNG_1PX);
    expect((await logo('image/png', large)).status).toBe(413);
    // Without Content-Length (a streamed body): the limit applies during the read, not after gathering everything.
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(ctl) {
        if (sent >= 4 * 1024 * 1024) return ctl.close();
        sent += 64 * 1024;
        ctl.enqueue(new Uint8Array(64 * 1024));
      },
    });
    expect((await logo('image/png', stream)).status).toBe(413);
    expect(sent).toBeLessThan(4 * 1024 * 1024);
    expect((await brandOf(t)).logoR2).toBeUndefined();
  });
});

describe('sanitizeSvg', () => {
  it('adds xmlns when missing and returns null without a drawing', () => {
    expect(sanitizeSvg('<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>')).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"></rect></svg>');
    expect(sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"></svg>')).toBeNull();
    expect(sanitizeSvg('não é xml')).toBeNull();
  });

  it('local url() with space or quotes stays; external is removed, including in <style>', () => {
    const svg = (body: string) => sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/>${body}</svg>`)!;
    expect(svg('<rect fill="url( #g)"/>')).toContain('fill="url( #g)"');
    expect(svg(`<rect fill='url( "#g" )'/>`)).toContain('fill="url( &quot;#g&quot; )"');
    expect(svg('<style>.a{fill:url("#g")}</style>')).toContain('<style>');
    expect(svg('<rect fill="url( https://evil.example/x)"/>')).not.toContain('evil');
    expect(svg('<rect fill="url(#g) url(https://evil.example/x)"/>')).not.toContain('evil');
    expect(svg('<style>.a{fill:url( "https://evil.example/x")}</style>')).not.toContain('evil');
  });
});

describe('new outlet', () => {
  it('is born with the name in the brand and /api/me carries the municipality', async () => {
    const s = await register();
    const res = await req('/api/tenants', { cookie: s.cookie, body: { nome: 'Gazeta da Orla', uf: 'SP', municipioIbge: '3518701', municipioNome: 'Guarujá' } });
    const t = await res.json<{ id: string }>();
    expect((await brandOf(t.id)).nome).toBe('Gazeta da Orla');
    const me = await (await req('/api/me', { cookie: s.cookie })).json<{ tenants: unknown[] }>();
    expect(me.tenants).toEqual([expect.objectContaining({ id: t.id, municipio: 'Guarujá', uf: 'SP', modo: 'local', handle: null, logo: null })]);
  });

  it('/api/me carries the @ and the signed logo URL after the minimal brand', async () => {
    const s = await register();
    const res = await req('/api/tenants', { cookie: s.cookie, body: { nome: 'Gazeta da Enseada', uf: 'SP', municipioIbge: '3518701', municipioNome: 'Guarujá' } });
    expect(res.status).toBe(201);
    const t = await res.json<{ id: string }>();
    expect((await req(`/api/t/${t.id}/marca`, { method: 'PATCH', cookie: s.cookie, body: { handle: '@gazeta' } })).status).toBe(200);
    expect((await req(`/api/t/${t.id}/marca/logo`, { cookie: s.cookie, cru: { tipo: 'image/svg+xml', corpo: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>' } })).status).toBe(201);
    const me = await (await req('/api/me', { cookie: s.cookie })).json<{ tenants: { handle: string | null; logo: string | null }[] }>();
    expect(me.tenants[0].handle).toBe('@gazeta');
    expect(me.tenants[0].logo).toMatch(/\/media\/marcas\/.*logo-.*\.svg\?/);
  });
});

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const CTAS = [
  { titulo: 'Seu bairro, com fonte.', texto: 'Notícia checada.', legenda: 'Siga.', acao: 'Siga', edicao: 'No feed', destaques: { titulo: 'O que', itens: ['a', 'b'] }, telefone: { titulo: 'T', status: 'S', mensagens: [] } },
  { titulo: 'Viu algo?', texto: 'Manda no direct.', legenda: 'Manda.', acao: 'Manda no direct' },
];

describe('full brand: style, CTAs, watermark', () => {
  it('admin writes style, CTA texts (highlights and phone stay) and watermark; GET returns them', async () => {
    const { s, t } = await admin();
    await env.DB.prepare('UPDATE tenants SET marca_json = ? WHERE id = ?').bind(JSON.stringify({ nome: 'Veículo', ctas: CTAS }), t).run();
    const ctas = [
      { titulo: '  Seu bairro,   com fonte! ', texto: 'Checada contra a fonte.', legenda: 'Siga a página.', acao: 'Siga já' },
      { titulo: 'Viu algo no bairro?', texto: 'Manda no direct.', legenda: 'Manda no direct.', acao: 'Manda' },
    ];
    const res = await req(`/api/t/${t}/marca`, {
      method: 'PATCH', cookie: s.cookie,
      body: { estiloArte: ' traço   leve, tons de areia ', ctas, marcaDagua: { posicao: 'canto', opacidade: 0.355 } },
    });
    expect(res.status).toBe(200);
    const m = await brandOf(t);
    expect(m.estiloArte).toBe('traço leve, tons de areia');
    expect(m.marcaDagua).toEqual({ posicao: 'canto', opacidade: 0.36 });
    expect(m.ctas[0]).toMatchObject({ titulo: 'Seu bairro, com fonte!', acao: 'Siga já', edicao: 'No feed', destaques: CTAS[0].destaques, telefone: CTAS[0].telefone });
    expect(m.ctas[1]).toEqual({ titulo: 'Viu algo no bairro?', texto: 'Manda no direct.', legenda: 'Manda no direct.', acao: 'Manda' });
    const { marca: brand } = await (await req(`/api/t/${t}/marca`, { cookie: s.cookie })).json<{ marca: Record<string, unknown> }>();
    expect(brand).toMatchObject({ estiloArte: 'traço leve, tons de areia', marcaDagua: { posicao: 'canto', opacidade: 0.36 }, referencia: null });
    expect((brand.ctas as unknown[])[0]).toEqual({ titulo: 'Seu bairro, com fonte!', texto: 'Checada contra a fonte.', legenda: 'Siga a página.', acao: 'Siga já' });
    // Estilo vazio apaga.
    await req(`/api/t/${t}/marca`, { method: 'PATCH', cookie: s.cookie, body: { estiloArte: '' } });
    expect((await brandOf(t)).estiloArte).toBeUndefined();
  });

  it('validates: long style, position and opacity out of range, empty or long CTA, different quantity → 400', async () => {
    const { s, t } = await admin();
    await env.DB.prepare('UPDATE tenants SET marca_json = ? WHERE id = ?').bind(JSON.stringify({ nome: 'Veículo', ctas: CTAS }), t).run();
    const ok = { titulo: 'a', texto: 'b', legenda: 'c', acao: 'd' };
    for (const body of [
      { estiloArte: 'x'.repeat(301) }, { estiloArte: 3 },
      { marcaDagua: { posicao: 'meio', opacidade: 0.5 } }, { marcaDagua: { posicao: 'canto', opacidade: 0.9 } },
      { marcaDagua: { posicao: 'canto', opacidade: 0.1 } }, { marcaDagua: { posicao: 'canto', opacidade: '0.5' } }, { marcaDagua: null },
      { ctas: [ok] }, { ctas: [ok, { ...ok, titulo: '  ' }] }, { ctas: [ok, { ...ok, legenda: 'Notícias 24 horas. Siga.' }] },
      { ctas: [ok, { ...ok, texto: 'Toda sexta-feira no feed.' }] }, { ctas: [ok, { ...ok, acao: 'x'.repeat(61) }] }, { ctas: [ok, { titulo: 'a' }] }, { ctas: 'x' },
    ]) {
      expect((await req(`/api/t/${t}/marca`, { method: 'PATCH', cookie: s.cookie, body })).status, JSON.stringify(body).slice(0, 80)).toBe(400);
    }
    expect((await brandOf(t)).ctas).toEqual(CTAS);
  });

  it('CTA button is optional: empty removes the button (the render uses the title); the rest of the CTA stays', async () => {
    const { s, t } = await admin();
    await env.DB.prepare('UPDATE tenants SET marca_json = ? WHERE id = ?').bind(JSON.stringify({ nome: 'Veículo', ctas: CTAS }), t).run();
    const res = await req(`/api/t/${t}/marca`, {
      method: 'PATCH', cookie: s.cookie,
      body: { ctas: [{ titulo: 'Seu bairro', texto: 'Checada.', legenda: 'Siga.', acao: '' }, { titulo: 'Viu algo?', texto: 'Manda.', legenda: 'Manda.' }] },
    });
    expect(res.status).toBe(200);
    const m = await brandOf(t);
    expect(m.ctas[0]).not.toHaveProperty('acao');
    expect(m.ctas[0]).toMatchObject({ titulo: 'Seu bairro', telefone: CTAS[0].telefone });
    expect(m.ctas[1]).toEqual({ titulo: 'Viu algo?', texto: 'Manda.', legenda: 'Manda.' });
    // Changing only the colour with CTAs without a button remains possible.
    expect((await req(`/api/t/${t}/marca`, { method: 'PATCH', cookie: s.cookie, body: { cores: { fundo: '#111111' } } })).status).toBe(200);
  });

  it('reference: PNG or JPEG up to 2 MB goes to marcas/<tenant>/referencia-<id>; editor 403; another outlet 404', async () => {
    const { s, t } = await admin();
    const r1 = await req(`/api/t/${t}/marca/referencia`, { cookie: s.cookie, cru: { tipo: 'image/jpeg', corpo: JPEG } });
    expect(r1.status).toBe(201);
    expect(await r1.json()).toMatchObject({ marca: { temReferencia: true } });
    const key: string = (await brandOf(t)).arteRefR2;
    expect(key.startsWith(`marcas/${t}/referencia-`) && key.endsWith('.jpg')).toBe(true);
    expect((await env.MEDIA.get(key))?.httpMetadata?.contentType).toBe('image/jpeg');
    const r2 = await req(`/api/t/${t}/marca/referencia`, { cookie: s.cookie, cru: { tipo: 'image/png', corpo: PNG_1PX } });
    expect(r2.status).toBe(201);
    const key2: string = (await brandOf(t)).arteRefR2;
    expect(key2).not.toBe(key);
    expect(key2.endsWith('.png')).toBe(true);
    const { marca: brand } = await (await req(`/api/t/${t}/marca`, { cookie: s.cookie })).json<{ marca: { referencia: string } }>();
    expect(brand.referencia).toMatch(/\/media\/marcas\/.+\/referencia-.+\.png\?/);
    expect((await req(`/api/t/${t}/marca/referencia`, { cookie: s.cookie, cru: { tipo: 'image/png', corpo: JPEG } })).status).toBe(400);
    expect((await req(`/api/t/${t}/marca/referencia`, { cookie: s.cookie, cru: { tipo: 'image/webp', corpo: JPEG } })).status).toBe(415);
    const large = new Uint8Array(2 * 1024 * 1024 + 10); large.set(JPEG);
    expect((await req(`/api/t/${t}/marca/referencia`, { cookie: s.cookie, cru: { tipo: 'image/jpeg', corpo: large } })).status).toBe(413);
    const editor = await register();
    await seedMember(t, editor.userId, 'editor');
    expect((await req(`/api/t/${t}/marca/referencia`, { cookie: editor.cookie, cru: { tipo: 'image/jpeg', corpo: JPEG } })).status).toBe(403);
    const other = await admin();
    expect((await req(`/api/t/${t}/marca/referencia`, { cookie: other.s.cookie, cru: { tipo: 'image/jpeg', corpo: JPEG } })).status).toBe(404);
    expect((await req(`/api/t/${t}/marca`, { method: 'PATCH', cookie: editor.cookie, body: { estiloArte: 'x' } })).status).toBe(403);
    expect((await brandOf(t)).arteRefR2).toBe(key2);
  });
});

describe('render: watermark in the HTML of the card (no Browser)', () => {
  const vars = {
    FONT_BODY: '', FONT_DISPLAY: '', COLOR_BG: '#000000', COLOR_INK: '#ffffff', COLOR_ACCENT: '#ff8a3d', ART_POSITION: '50', ART_POSITION_Y: '50', SLIDE_CLASS: 'cover',
    BRAND_NAME: 'Veículo', DATE_LABEL: 'Publicação', DATE_VALUE: '1 nov', EYEBROW: 'Cidade', HEADLINE: 'Manchete', BODY_TEXT: '',
    FOOTER_LABEL: 'Fonte:', SOURCE_NAME: 'G1', SOURCE_URL: 'https://g1.globo.com', CTA_URL: '#', DOMAIN: '@veiculo',
  };
  const raw = (wm: string) => ({ ART_TAG: '<div class="art art-flat"></div>', BRAND_TAG: '<span class="brand-name">V</span>', WATERMARK: wm });
  it('semi-transparent logo in the corner; without logo, the @ in the footer; none, nothing', () => {
    const withLogo = preencherTemplate(template, vars, raw(waterTagBrand({ posicao: 'canto', opacidade: 0.3 }, { logo: 'data:image/png;base64,AAA', handle: '@v' })));
    expect(withLogo).toContain('<div class="marca-dagua canto" style="opacity:0.30" aria-hidden="true"><img src="data:image/png;base64,AAA" alt=""></div>');
    const withoutLogo = preencherTemplate(template, vars, raw(waterTagBrand({ posicao: 'rodape', opacidade: 0.6 }, { logo: null, handle: '@v<x>' })));
    expect(withoutLogo).toContain('<div class="marca-dagua rodape" style="opacity:0.60" aria-hidden="true"><span>@v&lt;x&gt;</span></div>');
    const nothing = preencherTemplate(template, vars, raw(waterTagBrand({ posicao: 'nenhuma', opacidade: 0.5 }, { logo: 'x', handle: '@v' })));
    expect(nothing).not.toContain('class="marca-dagua');
    expect(nothing).not.toContain('{{');
    // No configuration = none (today's cards do not change); an opacity outside the range is clamped to it.
    expect(waterTagBrand(undefined, { logo: 'x' })).toBe('');
    expect(waterTagBrand({ posicao: 'canto', opacidade: 5 }, { logo: null, nome: 'V' })).toContain('opacity:0.80');
    expect(waterTagBrand({ posicao: 'canto', opacidade: 0.5 }, { logo: null })).toBe('');
  });
  it('the template asks for the watermark and the CTA card hides it', () => {
    expect(template).toContain('{{WATERMARK}}');
    expect(template).toMatch(/\.promo \.marca-dagua \{ display: none; \}/);
  });
});
