// What the editor gained: image and support in the document, history, promotion and second read. Nothing from the model enters the document.
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blocksDoc, cleanDoc, paragraphsDoc, substackDoc, type In } from '../src/lib/doc';
import { readAsEditor, numbersMatch, suggestPromotion } from '../src/lib/writing';
import type { TextLine } from '../src/lib/desk';
import { register, req, seedMember } from './helpers';

let answer: unknown;
beforeEach(() => {
  answer = {};
  const original = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('deepseek')) return Response.json({ choices: [{ message: { content: JSON.stringify(answer) } }], usage: { prompt_tokens: 10, completion_tokens: 10 } });
    return original(input, init);
  });
});
afterEach(() => { vi.restoreAllMocks(); });

const P = ['A Câmara renovou 12 contratos de ônibus sem licitação em 2025.', 'O prefeito disse que vai rever os contratos.'];
const doc = (ps: string[]): In => ({ type: 'doc', content: ps.map((p, i) => ({ type: 'paragraph', attrs: { id: `b${i}` }, content: [{ type: 'text', text: p }] })) });

async function text() {
  const t = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO tenants (id, slug, nome, modo, marca_json, plano) VALUES (?, ?, 'Cartas', 'autoral', '{}', 'cortesia')").bind(t, `c-${t.slice(0, 8)}`).run();
  const s = await register();
  await seedMember(t, s.userId, 'editor');
  const r = await req(`/api/t/${t}/textos`, { cookie: s.cookie, body: { titulo: 'Doze contratos', texto: P.join('\n') } });
  const { texto: x } = await r.json<{ texto: { id: string } }>();
  const url = `/api/t/${t}/textos/${x.id}`;
  const save = async (d: In, version: number, extra: object = {}) => req(url, { method: 'PUT', cookie: s.cookie, body: { doc: d, versao: version, ...extra } });
  const saveOk = async (d: In, version: number, extra: object = {}) => {
    const res = await save(d, version, extra);
    expect(res.status).toBe(200);
    return (await res.json<{ texto: { versao: number } }>()).texto.versao;
  };
  return { t, s, url, id: x.id, salvarOk: saveOk };
}

describe('blank sheet', () => {
  async function outlet() {
    const t = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO tenants (id, slug, nome, modo, marca_json, plano) VALUES (?, ?, 'Cartas', 'autoral', '{}', 'cortesia')").bind(t, `folha-${t.slice(0, 8)}`).run();
    const s = await register();
    await seedMember(t, s.userId, 'editor');
    const created = async () => {
      const r = await req(`/api/t/${t}/textos`, { cookie: s.cookie, body: { branco: true } });
      expect(r.status).toBe(201);
      return (await r.json<{ texto: { id: string; titulo: string; origem: string; versao: number; doc: In } }>()).texto;
    };
    return { t, s, nova: created };
  }

  it('opens with no title or text, and the same sheet comes back while it stays empty', async () => {
    const { nova: created } = await outlet();
    const a = await created();
    expect(a).toMatchObject({ titulo: '', origem: 'escrito' });
    expect(blocksDoc(a.doc)).toEqual([]);
    expect((await created()).id).toBe(a.id);
  });

  it("saves empty; with text, the next sheet is a different one; outsiders don't inherit the sheet", async () => {
    const { t, s, nova: created } = await outlet();
    const a = await created();
    const url = `/api/t/${t}/textos/${a.id}`;
    const empty = await req(url, { method: 'PUT', cookie: s.cookie, body: { doc: { type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'b0' } }] }, versao: 1, titulo: '' } });
    expect(empty.status).toBe(200);
    expect((await created()).id).toBe(a.id);
    const full = await req(url, { method: 'PUT', cookie: s.cookie, body: { doc: doc(['Primeira linha.']), versao: 2, titulo: 'Primeira linha.' } });
    expect(full.status).toBe(200);
    expect((await full.json<{ texto: { titulo: string } }>()).texto.titulo).toBe('Primeira linha.');
    expect((await created()).id).not.toBe(a.id);
    const other = await register();
    await seedMember(t, other.userId, 'editor');
    const hers = await req(`/api/t/${t}/textos`, { cookie: other.cookie, body: { branco: true } });
    expect((await hers.json<{ texto: { id: string } }>()).texto.id).not.toBe(a.id);
  });

  it('nothing leaves it: check, promote, second read and Instagram ask for the text first', async () => {
    const { t, s, nova: created } = await outlet();
    const a = await created();
    for (const route of ['conferir', 'divulgacao', 'segunda-leitura', 'instagram']) {
      const r = await req(`/api/t/${t}/textos/${a.id}/${route}`, { cookie: s.cookie, body: {} });
      expect(r.status, route).toBe(400);
      expect((await r.json<{ erro: string; code: string }>()), route).toMatchObject({ erro: 'Escreva o texto primeiro.', code: 'texto_vazio' });
    }
  });

  it('paste still refuses empty text', async () => {
    const { t, s } = await outlet();
    expect((await req(`/api/t/${t}/textos`, { cookie: s.cookie, body: { titulo: 'x', texto: '  ' } })).status).toBe(400);
  });
});

describe('document: image and support text', () => {
  const ok = { type: 'imagem', attrs: { src: 'https://gazzpush.com/media/x.png?sig=1', alt: 'Ônibus na orla' } };
  const support = { type: 'apoio', attrs: { patrocinio: 'p1', texto: 'Publicidade. Esta edição tem o apoio de Padaria.' } };
  const clean = (content: unknown[]) => cleanDoc({ type: 'doc', content }, () => 'novo');

  it('pass through cleaning and stay out of the check blocks', () => {
    const d = clean([...doc(['Um parágrafo.']).content!, ok, support]);
    expect(d.content!.map((n) => n.type)).toEqual(['paragraph', 'imagem', 'apoio']);
    expect(blocksDoc(d)).toHaveLength(1);
    expect(paragraphsDoc(d)).toEqual(['Um parágrafo.']);
  });

  it("image with an address that isn't http disappears; empty support text too", () => {
    const d = clean([{ ...ok, attrs: { src: 'javascript:alert(1)', alt: 'x' } }, { type: 'apoio', attrs: { texto: '  ' } }, ...doc(['Fica.']).content!]);
    expect(d.content!.map((n) => n.type)).toEqual(['paragraph']);
  });

  it("extra attribute doesn't get in", () => {
    expect(clean([{ ...ok, attrs: { ...ok.attrs, onerror: 'x' } }]).content![0].attrs).toEqual(ok.attrs);
  });

  it('Substack receives the image with description and support text, escaped', () => {
    const { html, texto: text } = substackDoc('T', { type: 'doc', content: [{ type: 'imagem', attrs: { src: 'https://x.dev/a.png', alt: 'a"b' } }, { type: 'apoio', attrs: { texto: 'Apoio <b>' } }] });
    expect(html).toContain('<img src="https://x.dev/a.png" alt="a&quot;b">');
    expect(html).toContain('<em>Apoio &lt;b&gt;</em>');
    expect(text).toContain('Apoio <b>');
  });

  it('saved via the route, comes back the same', async () => {
    const { s, url, salvarOk: saveOk } = await text();
    const d: In = { type: 'doc', content: [...doc(P).content!, ok, support] };
    await saveOk(d, 1);
    const e = await (await req(url, { cookie: s.cookie })).json<{ texto: { doc: In } }>();
    expect(e.texto.doc.content!.map((n) => n.type)).toEqual(['paragraph', 'paragraph', 'imagem', 'apoio']);
  });
});

describe('history', () => {
  const versions = async (s: { cookie: string }, url: string) => (await (await req(`${url}/historico`, { cookie: s.cookie })).json<{ versoes: { id: string; versao: number; por: string }[] }>()).versoes;

  it('keeps the earlier text, one every 10 minutes', async () => {
    const { s, url, id, salvarOk: saveOk } = await text();
    expect(await versions(s, url)).toEqual([]);
    const v2 = await saveOk(doc(['Primeira mudança.']), 1);
    const v3 = await saveOk(doc(['Segunda mudança.']), v2);
    expect((await versions(s, url)).map((v) => v.versao)).toEqual([1]);
    await env.DB.prepare("UPDATE textos_historico SET created_at = datetime('now', '-11 minutes') WHERE texto_id = ?").bind(id).run();
    await saveOk(doc(['Terceira mudança.']), v3);
    expect((await versions(s, url)).map((v) => v.versao)).toEqual([3, 1]);
  });

  it('restore keeps the current one within the 10 minutes, and the snapshot carries the document', async () => {
    const { s, url, salvarOk: saveOk } = await text();
    const v2 = await saveOk(doc(['Primeira mudança.']), 1);
    const [snapshot] = await versions(s, url);
    const r = await (await req(`${url}/historico/${snapshot.id}`, { cookie: s.cookie })).json<{ doc: In; titulo: string }>();
    expect(paragraphsDoc(r.doc)).toEqual(P);
    expect(r.titulo).toBe('Doze contratos');
    await saveOk(r.doc, v2, { restaurando: true });
    expect((await versions(s, url)).map((v) => v.versao)).toEqual([2, 1]);
    const e = await (await req(url, { cookie: s.cookie })).json<{ texto: { doc: In } }>();
    expect(paragraphsDoc(e.texto.doc)).toEqual(P);
  });

  it("a save refused for an old version doesn't become a snapshot", async () => {
    const { s, url, salvarOk: saveOk } = await text();
    await saveOk(doc(['Primeira mudança.']), 1);
    expect((await req(url, { method: 'PUT', cookie: s.cookie, body: { doc: doc(['Velho.']), versao: 1, restaurando: true } })).status).toBe(409);
    expect(await versions(s, url)).toHaveLength(1);
  });

  it('keeps only the 30 newest', async () => {
    const { s, url, salvarOk: saveOk } = await text();
    let v = 1;
    for (let i = 0; i < 32; i++) v = await saveOk(doc([`Mudança ${i}.`]), v, { restaurando: true });
    const list = await versions(s, url);
    expect(list).toHaveLength(30);
    expect(list[0].versao).toBe(32);
  }, 30_000);   // 32 saves, each with its own batch in D1

  it("another outlet can't reach the history", async () => {
    const a = await text();
    await a.salvarOk(doc(['Primeira mudança.']), 1);
    const [snapshot] = await versions(a.s, a.url);
    const b = await text();
    expect((await req(`${b.url}/historico/${snapshot.id}`, { cookie: b.s.cookie })).status).toBe(404);
    expect((await req(`/api/t/${a.t}/textos/${a.id}/historico`, { cookie: b.s.cookie })).status).toBe(404);
  });
});

describe('promotion', () => {
  it("a number that isn't in the text drops the suggestion", () => {
    expect(numbersMatch('12 contratos em 2025', P[0])).toBe(true);
    expect(numbersMatch('15 contratos', P[0])).toBe(false);
    expect(numbersMatch('sem número', P[0])).toBe(true);
  });

  it('returns topics and message without touching the text', async () => {
    const { s, url } = await text();
    answer = { assuntos: ['12 contratos sem licitação', 'R$ 40 milhões sem licitação', 'A Câmara e os ônibus'], mensagem: 'A Câmara renovou 12 contratos.' };
    const r = await req(`${url}/divulgacao`, { cookie: s.cookie, body: {} });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ assuntos: ['12 contratos sem licitação', 'A Câmara e os ônibus'], mensagem: 'A Câmara renovou 12 contratos.' });
    const e = await (await req(url, { cookie: s.cookie })).json<{ texto: { versao: number } }>();
    expect(e.texto.versao).toBe(1);
  });

  it('a malformed model response becomes an empty list, no error', async () => {
    const { s, url } = await text();
    answer = { assuntos: 'x', mensagem: 5 };
    expect(await (await req(`${url}/divulgacao`, { cookie: s.cookie, body: {} })).json()).toEqual({ assuntos: [], mensagem: null });
  });
});

describe('sensitive topic', () => {
  it("goes to the second provider with the request's format, not the check's", async () => {
    const bodies: { output_config: { format: { schema: { required: string[] } } } }[] = [];
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      expect(url).toContain('anthropic.example');
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      const content = body.output_config.format.schema.required.includes('notas') ? { notas: [] } : { assuntos: ['Xinjiang na pauta'], mensagem: 'Sobre Xinjiang.' };
      return Response.json({ id: 'm', type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn', stop_sequence: null, content: [{ type: 'text', text: JSON.stringify(content) }], usage: { input_tokens: 1, output_tokens: 1 } });
    });
    const withValue = { ...env, ANTHROPIC_API_KEY: 'sk-teste', SEGUNDA_URL: 'https://anthropic.example' };
    const t = { titulo: 'Xinjiang', doc_json: JSON.stringify(doc(['O governo falou sobre Xinjiang.'])), paragrafos_json: '["O governo falou sobre Xinjiang."]', docs_json: null } as unknown as TextLine;
    expect(await suggestPromotion(withValue, t, 'pt-BR')).toEqual({ assuntos: ['Xinjiang na pauta'], mensagem: 'Sobre Xinjiang.' });
    expect(await readAsEditor(withValue, t, 'pt-BR')).toEqual([]);
    expect(bodies.map((c) => c.output_config.format.schema.required[0])).toEqual(['assuntos', 'notas']);
  });
});

describe('second read', () => {
  it('only what points at the text stays, at the exact place', async () => {
    const { s, url } = await text();
    answer = { notas: [
      { tipo: 'pergunta', trecho: 'vai rever os contratos', nota: 'Quando?' },
      { tipo: 'sobra', trecho: 'frase que não existe', nota: 'Inventada.' },
      { tipo: 'desconhecido', trecho: 'A Câmara renovou', nota: 'Tipo errado.' },
      { tipo: 'clareza', trecho: 'A Câmara renovou', nota: '  ' },
    ] };
    const { notas: notes } = await (await req(`${url}/segunda-leitura`, { cookie: s.cookie, body: {} })).json<{ notas: { tipo: string; inicio: number; fim: number; trecho: string; blocoId: string }[] }>();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ tipo: 'pergunta', trecho: 'vai rever os contratos', nota: 'Quando?' });
    expect(P[1].slice(notes[0].inicio, notes[0].fim)).toBe('vai rever os contratos');
  });

  it("reporter doesn't ask", async () => {
    const { t, url } = await text();
    const r = await register();
    await seedMember(t, r.userId, 'reporter');
    expect((await req(`${url}/segunda-leitura`, { cookie: r.cookie, body: {} })).status).toBe(403);
  });
});

describe('image in the text', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const send = (url: string, cookie: string, body: BodyInit, type: string) => req(`${url}/imagens`, { cookie, cru: { tipo: type, corpo: body } });

  it('uploads PNG and returns the signed link', async () => {
    const { s, url } = await text();
    const r = await send(url, s.cookie, PNG, 'image/png');
    expect(r.status).toBe(201);
    const { src } = await r.json<{ src: string }>();
    expect(src).toMatch(/\/media\/textos\/.+\.png\?exp=\d+&sig=/);
    const downloaded = await req(src.replace(/^https?:\/\/[^/]+/, ''), {});
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get('content-type')).toBe('image/png');
  });

  it('refuses SVG, a file pretending to be PNG, and anything over the cap', async () => {
    const { s, url } = await text();
    expect((await send(url, s.cookie, '<svg/>', 'image/svg+xml')).status).toBe(415);
    expect((await send(url, s.cookie, 'nao sou png', 'image/png')).status).toBe(400);
    expect((await send(url, s.cookie, new Uint8Array(2 * 1024 * 1024 + 1), 'image/png')).status).toBe(413);
  });
});
