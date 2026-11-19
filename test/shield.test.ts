// Phase 4 (handoffs/2026-11-02-materia-e-editor-investigativo.md): legal shield and sources page. The other-side
// request (email through the app or copied) with the recorded time and the reply in the dossier; the Wayback copy of
// each link; the defence package with every piece, a hash manifest and an RFC 3161 timestamp that verifies; the public
// page that exposes nothing internal or from another outlet; the final "How we reported this" card; IDOR on every new
// route. The network is simulated through fetch.
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import type { Env } from '../src/env';
import { createRequest, receiveEmail } from '../src/lib/shield';
import { rootTsa, verifyTimestamp } from '../src/lib/timestamp';
import { ATTEMPTS_QUEUE, processWayback } from '../src/lib/wayback';
import { BUDGET_PACKAGE } from '../src/lib/shield';
import { browserApi } from '../src/lib/render';
import { leadStory } from '../src/lib/story';
import { loadLead } from '../src/lib/lead';
import { chooseCta } from '../src/lib/drafting';
import { register, req, seedMember } from './helpers';
import { FAKE_ROOT, timestamp } from './fake-tsa';

const SOURCE = 'https://camara.example/relatorio';
const sourceBody = 'A Câmara aprovou em 2025 a renovação de 12 contratos de ônibus sem licitação, segundo o relatório da comissão. ' +
  'O presidente da comissão declarou que as renovações seguiram o regimento. O documento lista as empresas e os valores de cada contrato.';
const html = (title: string, body: string) => `<html><head><title>${title}</title></head><body><article><h1>${title}</h1><p>${body}</p></article></body></html>`;
const P = [
  'Contratos sem concorrência',
  'A Câmara renovou 12 contratos de ônibus sem licitação em 2025.',
  'O vereador Luís Souza desviou dinheiro dos contratos.',
];
const EV_PASSAGE = 'A Câmara aprovou em 2025 a renovação de 12 contratos de ônibus sem licitação';
const INTERNAL_EXPLANATION = 'Acusa sem condenação, nota interna da conferência.';

type Item = Record<string, unknown>;
let deepseek: (block: string) => Item[];
let tsa: 'ok' | 'fora';
let wayback: (url: string) => Response;

beforeEach(() => {
  deepseek = () => [];
  tsa = 'ok';
  wayback = () => new Response(null, { status: 404 });
  const original = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('deepseek')) {
      const user: string = JSON.parse(init!.body as string).messages[1].content;
      const block = user.slice(user.lastIndexOf('[P0] ') + 5);
      return Response.json({ choices: [{ message: { content: JSON.stringify({ afirmacoes: deepseek(block) }) } }], usage: { prompt_tokens: 1000, completion_tokens: 100 } });
    }
    if (url === 'https://tsa.example/tsr') {
      if (tsa === 'fora') return new Response('fora do ar', { status: 503 });
      return new Response(await timestamp(new Uint8Array(init!.body as ArrayBuffer)));
    }
    if (url.startsWith('https://wayback.example')) return wayback(url);
    if (url === SOURCE) return new Response(html('Relatório da comissão', sourceBody), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    if (url.includes('.example')) return new Response('não achei', { status: 404 });
    return original(input, init);
  });
});
afterEach(() => vi.restoreAllMocks());

async function tenantAuthor(label = 'Cartas') {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO tenants (id, slug, nome, modo, marca_json, plano) VALUES (?, ?, ?, 'autoral', ?, 'cortesia')")
    .bind(id, `a-${id.slice(0, 8)}`, label, JSON.stringify({ nome: label, ctaUrl: 'https://autora.substack.example' })).run();
  return id;
}

/** A checked story: P1 with evidence (a literal passage from the source), P2 an accusation without conviction (open risk). */
async function story(text = P.join('\n'), label = 'Cartas') {
  const s = await register('Repórter Teste');
  const t = await tenantAuthor(label);
  await seedMember(t, s.userId, 'admin');
  const { texto: tx } = await (await req(`/api/t/${t}/textos`, { cookie: s.cookie, body: { texto: text } })).json<{ texto: { id: string } }>();
  const { evidenciaId: ev } = await (await req(`/api/t/${t}/textos/${tx.id}/evidencias`, { cookie: s.cookie, body: { url: SOURCE } })).json<{ evidenciaId: string }>();
  deepseek = (b) => b === P[1]
    ? [{ paragrafo: 0, trecho: P[1], estado: 'com_evidencia', risco: null, evidencia: ev, trecho_evidencia: EV_PASSAGE, explicacao: 'O relatório traz o número.' }]
    : b === P[2] ? [{ paragrafo: 0, trecho: P[2], estado: 'risco', risco: 'acusacao_sem_condenacao', evidencia: null, trecho_evidencia: null, explicacao: INTERNAL_EXPLANATION }] : [];
  expect((await req(`/api/t/${t}/textos/${tx.id}/conferir`, { cookie: s.cookie, body: {} })).status).toBe(200);
  return { s, t, id: tx.id, ev };
}

interface State {
  texto: { versao: number };
  blocos: { id: string }[];
  afirmacoes: { id: string; trecho: string; blocoId: string; aberta: boolean; apuracao: { tipo: string; outroLado: { quem: string; meio: string } | null } | null }[];
  evidencias: { id: string; origem: string; titulo: string; tipoFonte: string | null; wayback: { estado: string; url: string | null; erro: string | null } | null }[];
  outroLado: { emailLigado: boolean; pedidos: { id: string; meio: string; enviadoEm: string | null; registradoEm: string; erro: string | null; respostaEm: string | null; respostaEvidenciaId: string | null; vencido: boolean }[] };
  paginaFontes: { id: string; url: string; versao: number } | null;
  checklist: { pendencias: unknown[] };
}
const read = async (t: string, id: string, cookie: string) => (await req(`/api/t/${t}/textos/${id}`, { cookie })).json<State>();
const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString();
const copiedRequest = (extra: Item = {}): Item => ({
  paraNome: 'Assessoria do vereador', paraEmail: 'imprensa@vereador.example', assunto: 'Pedido de posicionamento',
  corpo: 'Bom dia. A matéria afirma que o vereador desviou dinheiro dos contratos. Ele quer se manifestar?', prazo: tomorrow(),
  meio: 'copiado', canal: 'email', enviadoEm: new Date(Date.now() - 60_000).toISOString(), ...extra,
});
const ROUTE = (t: string, id: string) => `/api/t/${t}/textos/${id}`;

describe('right-of-reply request', () => {
  it('copied: validates deadline, time and channel; the excerpt is checked letter by letter; closes the risk with who, when and how', async () => {
    const { s, t, id } = await story();
    const e0 = await read(t, id, s.cookie);
    const accusation = e0.afirmacoes.find((a) => a.trecho === P[2])!;
    expect(accusation.aberta).toBe(true);
    expect(e0.outroLado).toMatchObject({ emailLigado: false, pedidos: [] });

    for (const [extra, status] of [
      [{ prazo: new Date(Date.now() - 1000).toISOString() }, 400],
      [{ enviadoEm: tomorrow() }, 400],
      [{ canal: 'pombo' }, 400],
      [{ meio: 'email' }, 409],                                          // without Email Service: copy and send it elsewhere
      [{ blocoId: accusation.blocoId, trecho: 'O vereador desviou' }, 422], // a passage that is not in the paragraph
    ] as [Item, number][]) {
      const r = await req(`${ROUTE(t, id)}/pedidos`, { cookie: s.cookie, body: copiedRequest(extra) });
      expect(r.status, JSON.stringify(extra)).toBe(status);
    }
    expect((await read(t, id, s.cookie)).outroLado.pedidos).toHaveLength(0);

    // The chosen sentence must be in the text that was sent: a request about something else does not close its risk.
    const withoutSentence = await req(`${ROUTE(t, id)}/pedidos`, { cookie: s.cookie, body: copiedRequest({ blocoId: accusation.blocoId, trecho: P[2] }) });
    expect(withoutSentence.status).toBe(422);
    expect((await withoutSentence.json<{ code: string }>()).code).toBe('trecho_fora_do_pedido');
    const r = await req(`${ROUTE(t, id)}/pedidos`, { cookie: s.cookie, body: copiedRequest({ blocoId: accusation.blocoId, trecho: P[2], corpo: `Bom dia. A matéria afirma: "${P[2]}" Ele quer se manifestar?` }) });
    expect(r.status).toBe(201);
    const e = await r.json<State>();
    expect(e.outroLado.pedidos).toHaveLength(1);
    expect(e.outroLado.pedidos[0]).toMatchObject({ meio: 'copiado', erro: null, respostaEm: null, vencido: false });
    expect(e.outroLado.pedidos[0].enviadoEm).toBeTruthy();
    expect(e.outroLado.pedidos[0].registradoEm).toBeTruthy();
    const a = e.afirmacoes.find((x) => x.trecho === P[2])!;
    expect(a.aberta).toBe(false);
    expect(a.apuracao).toMatchObject({ tipo: 'outro_lado', outroLado: { quem: 'Assessoria do vereador', meio: 'email' } });
  });

  it('by email: goes out through the Email Service with the server time and the reply address; a failure is recorded, never lost', async () => {
    const { s, t, id } = await story();
    const sent: Item[] = [];
    let fail = false;
    const e = {
      ...env, EMAIL_REMETENTE: 'apuracao@cartas.example',
      EMAIL: { send: async (m: Item) => { if (fail) throw Object.assign(new Error('domínio não verificado'), { code: 'E_SENDER_NOT_VERIFIED' }); sent.push(m); return { messageId: 'msg-1' }; } },
    } as unknown as Env;
    const before = Date.now();
    const ok = await createRequest(e, t, id, { id: s.userId, nome: 'Repórter Teste' }, { ...copiedRequest(), meio: 'email', enviadoEm: undefined, canal: undefined });
    expect(ok.erro).toBeNull();
    expect(sent).toHaveLength(1);
    const token = (await env.DB.prepare('SELECT token, enviado_em, message_id FROM pedidos_outro_lado WHERE id = ?').bind(ok.id).first<{ token: string; enviado_em: string; message_id: string }>())!;
    expect(sent[0]).toMatchObject({ to: 'imprensa@vereador.example', subject: 'Pedido de posicionamento', replyTo: `outro-lado+${token.token}@cartas.example` });
    expect(token.message_id).toBe('msg-1');
    expect(Date.parse(token.enviado_em)).toBeGreaterThanOrEqual(before - 1000);

    fail = true;
    const bad = await createRequest(e, t, id, { id: s.userId, nome: 'Repórter Teste' }, { ...copiedRequest(), meio: 'email' });
    expect(bad.erro).toContain('E_SENDER_NOT_VERIFIED');
    const p = (await read(t, id, s.cookie)).outroLado.pedidos.find((x) => x.id === bad.id)!;
    expect(p).toMatchObject({ enviadoEm: null });
    expect(p.erro).toContain('E_SENDER_NOT_VERIFIED');
    // Failed: the sentence still has no other side recorded.
    expect((await read(t, id, s.cookie)).afirmacoes.find((x) => x.trecho === P[2])!.apuracao).toBeNull();
  });

  it('the email reply (address with the token) and the pasted one go into the dossier; an unknown token is refused', async () => {
    const { s, t, id } = await story();
    const { pedidoId: requestId } = await (await req(`${ROUTE(t, id)}/pedidos`, { cookie: s.cookie, body: copiedRequest() })).json<{ pedidoId: string }>();
    const { token } = (await env.DB.prepare('SELECT token FROM pedidos_outro_lado WHERE id = ?').bind(requestId).first<{ token: string }>())!;
    const mime = `From: Assessoria <imprensa@vereador.example>\r\nTo: outro-lado+${token}@cartas.example\r\nSubject: Re: Pedido de posicionamento\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nO vereador nega qualquer desvio e diz que as contas foram aprovadas.\r\n`;
    const message = (to: string) => {
      let refusal: string | null = null;
      return {
        m: { to: to, from: 'imprensa@vereador.example', raw: new Response(mime).body!, headers: new Headers(), rawSize: mime.length, setReject: (r: string) => { refusal = r; } },
        recusa: () => refusal,
      };
    };
    const good = message(`outro-lado+${token}@cartas.example`);
    await receiveEmail(good.m as unknown as ForwardableEmailMessage, env as unknown as Env);
    expect(good.recusa()).toBeNull();
    const e = await read(t, id, s.cookie);
    const p = e.outroLado.pedidos[0];
    expect(p.respostaEm).toBeTruthy();
    const resp = e.evidencias.find((x) => x.id === p.respostaEvidenciaId)!;
    expect(resp).toMatchObject({ origem: 'resposta', tipoFonte: 'primaria', wayback: null });
    expect(resp.titulo).toContain('Resposta de Assessoria do vereador');
    const r2 = await env.DB.prepare('SELECT r2_texto FROM evidencias WHERE id = ?').bind(resp.id).first<{ r2_texto: string }>();
    expect(await (await env.MEDIA.get(r2!.r2_texto))!.text()).toContain('O vereador nega qualquer desvio');

    const odd = message('outro-lado+000000000000000000000000@cartas.example');
    await receiveEmail(odd.m as unknown as ForwardableEmailMessage, env as unknown as Env);
    expect(odd.recusa()).toBeTruthy();

    // Pasted by hand: a future date does not count; the current one becomes evidence.
    expect((await req(`${ROUTE(t, id)}/pedidos/${requestId}/resposta`, { cookie: s.cookie, body: { texto: 'Nada a declarar.', recebidaEm: tomorrow() } })).status).toBe(400);
    const pasted = await req(`${ROUTE(t, id)}/pedidos/${requestId}/resposta`, { cookie: s.cookie, body: { texto: 'Nada a declarar.', recebidaEm: new Date().toISOString() } });
    expect(pasted.status).toBe(201);
    expect((await pasted.json<State>()).evidencias.filter((x) => x.origem === 'resposta')).toHaveLength(2);
  });
});

describe('Wayback of each link', () => {
  it('adding a link queues it; public capture saves the address and time; error keeps the reason; 429 retries', async () => {
    const { s, t, id, ev } = await story();
    const after = (await read(t, id, s.cookie)).evidencias.find((x) => x.id === ev)!;
    expect(after.wayback).not.toBeNull();   // pending at that moment (or already processed by the queue)

    await env.DB.prepare("UPDATE evidencias SET wayback_estado = 'pendente', wayback_url = NULL WHERE id = ?").bind(ev).run();
    wayback = (u) => (u === `https://wayback.example/save/${SOURCE}` ? new Response(null, { status: 302, headers: { location: `https://wayback.example/web/20261103101112/${SOURCE}` } }) : new Response(null, { status: 404 }));
    expect(await processWayback(env as unknown as Env, t, ev)).toBe('feito');
    expect((await read(t, id, s.cookie)).evidencias.find((x) => x.id === ev)!.wayback).toMatchObject({ estado: 'salvo', url: `https://wayback.example/web/20261103101112/${SOURCE}`, em: '2026-11-03T10:11:12Z' });

    await env.DB.prepare("UPDATE evidencias SET wayback_estado = 'pendente' WHERE id = ?").bind(ev).run();
    wayback = () => new Response(null, { status: 429 });
    expect(await processWayback(env as unknown as Env, t, ev, 1)).toBe('pendente');
    expect(await processWayback(env as unknown as Env, t, ev, 10)).toBe('feito');
    expect((await read(t, id, s.cookie)).evidencias.find((x) => x.id === ev)!.wayback).toMatchObject({ estado: 'falhou', erro: 'HTTP 429' });

    // With an S3 key: the SPN2 API (job and status).
    await env.DB.prepare("UPDATE evidencias SET wayback_estado = 'pendente', wayback_job = NULL WHERE id = ?").bind(ev).run();
    const seen: string[] = [];
    wayback = (u) => {
      seen.push(u);
      if (u === 'https://wayback.example/save') return Response.json({ url: SOURCE, job_id: 'spn2-abc' });
      if (u === 'https://wayback.example/save/status/spn2-abc') return Response.json({ status: 'success', timestamp: '20261103121314', original_url: SOURCE });
      return new Response(null, { status: 404 });
    };
    expect(await processWayback({ ...env, WAYBACK_ACCESS_KEY: 'k', WAYBACK_SECRET: 's' } as unknown as Env, t, ev)).toBe('feito');
    expect(seen).toEqual(['https://wayback.example/save', 'https://wayback.example/save/status/spn2-abc']);
    expect((await read(t, id, s.cookie)).evidencias.find((x) => x.id === ev)!.wayback).toMatchObject({ estado: 'salvo', url: `https://wayback.example/web/20261103121314/${SOURCE}` });
  });
});

describe('public sources page', () => {
  it('the checklist locks; once published, it shows sentence, excerpt and source, and nothing internal or from another outlet; taking it down gives 404', async () => {
    const { s, t, id } = await story();
    // Another outlet with its own sentence: nothing of it may leak.
    const other = await story(`${P[0]}\nA prefeitura de Outra Cidade comprou 7 ambulâncias em 2025.\n${P[2]}`, 'Outro Veículo');
    await req(`${ROUTE(t, id)}/pedidos`, { cookie: s.cookie, body: copiedRequest() });
    const e = await read(t, id, s.cookie);

    const locked = await req(`${ROUTE(t, id)}/pagina-fontes`, { cookie: s.cookie, body: { versao: e.texto.versao } });
    expect(locked.status).toBe(409);
    expect((await locked.json<{ code: string }>()).code).toBe('checklist');
    expect((await req(`${ROUTE(t, id)}/pagina-fontes`, { cookie: s.cookie, body: { versao: e.texto.versao + 1 } })).status).toBe(409);

    expect((await req(`${ROUTE(t, id)}/assinar`, { cookie: s.cookie, body: { versao: e.texto.versao } })).status).toBe(201);
    const pub = await req(`${ROUTE(t, id)}/pagina-fontes`, { cookie: s.cookie, body: { versao: e.texto.versao } });
    expect(pub.status).toBe(201);
    const page = (await pub.json<State>()).paginaFontes!;
    expect(page.url).toBe(`http://localhost:8787/fontes/${page.id}`);

    const publicValue = await req(`/fontes/${page.id}`, { method: 'GET', origin: null });
    expect(publicValue.status).toBe(200);
    const body = await publicValue.text();
    expect(body).toContain(P[1]);
    expect(body).toContain(EV_PASSAGE);
    expect(body).toContain(SOURCE);
    for (const internal of [P[2], INTERNAL_EXPLANATION, 'Assessoria do vereador', 'Pedido de posicionamento', 'resposta:', 'Repórter Teste', 'Outra Cidade', 'ambulâncias', t, id]) {
      expect(body, internal).not.toContain(internal);
    }
    // The other outlet does not reach this one's page through the API (IDOR), and its page mixes in nothing from here.
    expect((await req(`${ROUTE(t, id)}/pagina-fontes`, { method: 'DELETE', cookie: other.s.cookie })).status).toBe(404);

    expect((await req(`${ROUTE(t, id)}/pagina-fontes`, { method: 'DELETE', cookie: s.cookie })).status).toBe(200);
    expect((await req(`/fontes/${page.id}`, { method: 'GET', origin: null })).status).toBe(404);
    expect((await req('/fontes/nao-existe', { method: 'GET', origin: null })).status).toBe(404);
  });

  it('final card "Como apuramos": only with the page live; the CTA becomes its link', async () => {
    const { s, t, id } = await story();
    const wf = { create: async ({ id: i }: { id: string }) => ({ id: i }), get: async (i: string) => ({ id: i, status: async () => ({ status: 'running' }) }) };
    const e = { ...env, PRODUCAO_WORKFLOW: wf } as unknown as Env;
    const v = (await read(t, id, s.cookie)).texto.versao;
    await req(`${ROUTE(t, id)}/assinar`, { cookie: s.cookie, body: { versao: v } });
    await expect(leadStory(e, t, id, s.userId, { cardFontes: true })).rejects.toMatchObject({ codigo: 'sem_pagina', status: 409 });
    const page = (await (await req(`${ROUTE(t, id)}/pagina-fontes`, { cookie: s.cookie, body: { versao: v } })).json<State>()).paginaFontes!;
    const r = await leadStory(e, t, id, s.userId, { cardFontes: true });
    const lead = await loadLead(env as unknown as Env, t, r.pautaId);
    expect(lead.fontesUrl).toBe(page.url);
    const cta = chooseCta(lead);
    expect(cta.titulo).toBe('Como apuramos');
    expect(cta.texto).toContain(page.url.replace(/^https?:\/\//, ''));
    expect(cta.legenda).toContain(page.url);
  });
});

describe('defence package', () => {
  it('has all the pieces, the manifest hashes match and the timestamp verifies (and stops verifying if the manifest changes)', async () => {
    const { s, t, id, ev } = await story();
    await env.DB.prepare("UPDATE evidencias SET wayback_estado = 'salvo', wayback_url = ?, wayback_em = '2026-11-03T10:11:12Z' WHERE id = ?")
      .bind(`https://wayback.example/web/20261103101112/${SOURCE}`, ev).run();
    wayback = (u) => (u === `https://wayback.example/web/20261103101112id_/${SOURCE}` ? new Response(html('Relatório (Wayback)', sourceBody)) : new Response(null, { status: 404 }));
    const { pedidoId: requestId } = await (await req(`${ROUTE(t, id)}/pedidos`, { cookie: s.cookie, body: copiedRequest() })).json<{ pedidoId: string }>();
    await req(`${ROUTE(t, id)}/pedidos/${requestId}/resposta`, { cookie: s.cookie, body: { texto: 'O vereador nega.', recebidaEm: new Date().toISOString() } });
    const v = (await read(t, id, s.cookie)).texto.versao;
    await req(`${ROUTE(t, id)}/assinar`, { cookie: s.cookie, body: { versao: v } });
    await req(`${ROUTE(t, id)}/pagina-fontes`, { cookie: s.cookie, body: { versao: v } });
    // An approved Story post (version 1, approved by the person).
    const wf = { create: async ({ id: i }: { id: string }) => ({ id: i }), get: async (i: string) => ({ id: i, status: async () => ({ status: 'running' }) }) };
    const sent = await leadStory({ ...env, PRODUCAO_WORKFLOW: wf } as unknown as Env, t, id, s.userId);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO peca_versoes (id, tenant_id, peca_id, versao, rodada, conteudo_json, autor) VALUES (?, ?, ?, 1, 1, ?, 'ia')").bind(crypto.randomUUID(), t, sent.pecaId, JSON.stringify({ manchete: 'Contratos sem licitação' })),
      env.DB.prepare("INSERT INTO decisoes (id, tenant_id, peca_id, versao, decisao, por) VALUES (?, ?, ?, 1, 'aprovar', ?)").bind(crypto.randomUUID(), t, sent.pecaId, s.userId),
    ]);
    // The art as the render stores it (ArtRendered: png and jpg in R2; the jpg is what went to Instagram); the second
    // one vanished from storage.
    const png = `cards/${t}/${sent.pecaId}/c1.png`;
    await env.MEDIA.put(png, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
    await env.MEDIA.put(png.replace('.png', '.jpg'), new Uint8Array([0xff, 0xd8, 0xff, 9]));
    await env.DB.prepare('UPDATE pecas SET arte_r2_keys_json = ? WHERE id = ?').bind(JSON.stringify([
      { papel: 'capa', png, jpg: png.replace('.png', '.jpg'), metricas: {} },
      { papel: 'fato', png: `cards/${t}/${sent.pecaId}/sumiu.png`, jpg: 'x.jpg', metricas: {} },
    ]), sent.pecaId).run();

    const r = await req(`${ROUTE(t, id)}/pacote`, { method: 'GET', cookie: s.cookie });
    expect(r.status).toBe(200);
    expect(r.headers.get('x-pacote-fora')).toBe('2');
    expect(r.headers.get('content-type')).toBe('application/zip');
    expect(r.headers.get('content-disposition')).toMatch(/^attachment; filename="pacote-defesa-.+-v\d+-\d{4}-\d{2}-\d{2}\.zip"$/);
    expect(r.headers.get('x-carimbo')).toMatch(/^ok /);
    const zip = unzipSync(new Uint8Array(await r.arrayBuffer()));
    const names = Object.keys(zip);
    for (const expected of ['LEIA-ME.txt', 'manifesto.json', 'manifesto.json.tsr', 'texto/atual.txt', 'texto/atual.json', 'dossie/evidencias.json', 'apuracao/marcas.json',
      'apuracao/decisoes.json', 'apuracao/assinaturas.json', 'apuracao/checklist.json', 'outro-lado/pedidos.json', `posts/${sent.pecaId}.json`, 'pagina-de-fontes.json']) {
      expect(names, expected).toContain(expected);
    }
    expect(names.some((n) => /^texto\/versoes\/v\d+\.json$/.test(n))).toBe(true);
    expect(names.some((n) => /^dossie\/01-.+\.txt$/.test(n))).toBe(true);
    expect(names.some((n) => /^dossie\/01-.+\.wayback\.html$/.test(n))).toBe(true);
    expect(strFromU8(zip['texto/atual.txt'])).toContain(P[2]);
    const dossier = JSON.parse(strFromU8(zip['dossie/evidencias.json'])) as { origem: string; sha256DoTexto: string; wayback: { estado: string } | null }[];
    expect(dossier.map((d) => d.origem).sort()).toEqual(['link', 'resposta']);
    expect(JSON.parse(strFromU8(zip['outro-lado/pedidos.json']))[0]).toMatchObject({ paraNome: 'Assessoria do vereador', meio: 'copiado' });
    expect(JSON.parse(strFromU8(zip[`posts/${sent.pecaId}.json`]))).toMatchObject({ versaoAprovada: 1, aprovadoPor: 'Repórter Teste', conteudo: { manchete: 'Contratos sem licitação' }, artes: [`posts/${sent.pecaId}/card-1.jpg`, `posts/${sent.pecaId}/card-1.png`] });
    expect([...zip[`posts/${sent.pecaId}/card-1.png`]]).toEqual([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    expect([...zip[`posts/${sent.pecaId}/card-1.jpg`]]).toEqual([0xff, 0xd8, 0xff, 9]);
    // What was missing does not disappear silently: the manifest and the README say which and why.
    expect(JSON.parse(strFromU8(zip['manifesto.json'])).foraDoPacote).toEqual([
      { arquivo: `posts/${sent.pecaId}/card-2.jpg`, motivo: 'ausente', bytes: null, sha256: null },
      { arquivo: `posts/${sent.pecaId}/card-2.png`, motivo: 'ausente', bytes: null, sha256: null },
    ]);
    expect(strFromU8(zip['LEIA-ME.txt'])).toContain(`FORA DO PACOTE (2)`);

    // Manifest: each file with the right SHA-256; the timestamp covers the manifest.
    const manifest = JSON.parse(strFromU8(zip['manifesto.json'])) as { arquivos: { caminho: string; sha256: string }[] };
    expect(manifest.arquivos.map((a) => a.caminho)).not.toContain('manifesto.json');
    for (const a of manifest.arquivos) {
      const d = new Uint8Array(await crypto.subtle.digest('SHA-256', zip[a.caminho]));
      expect([...d].map((x) => x.toString(16).padStart(2, '0')).join(''), a.caminho).toBe(a.sha256);
    }
    expect(manifest.arquivos.length).toBe(names.length - 3);   // menos o manifesto, o carimbo e o LEIA-ME
    const root = rootTsa({ TSA_URL: 'https://tsa.example/tsr', TSA_RAIZ: FAKE_ROOT } as Env)!;
    expect((await verifyTimestamp(zip['manifesto.json.tsr'], zip['manifesto.json'], root)).ok).toBe(true);
    const touched = zip['manifesto.json'].slice(); touched[10] ^= 1;
    expect((await verifyTimestamp(zip['manifesto.json.tsr'], touched, root)).ok).toBe(false);
    expect(strFromU8(zip['LEIA-ME.txt'])).toContain('openssl ts -verify -data manifesto.json -in manifesto.json.tsr');
    const reg = await env.DB.prepare('SELECT manifesto_sha256, carimbo_em, carimbo_erro FROM pacotes_defesa WHERE texto_id = ?').bind(id).first<{ manifesto_sha256: string; carimbo_em: string; carimbo_erro: string | null }>();
    expect(reg).toMatchObject({ carimbo_erro: null });
    expect(reg!.carimbo_em).toBeTruthy();
  });

  it('TSA down: the package goes out anyway and says it has no timestamp, and why', async () => {
    const { s, t, id } = await story();
    tsa = 'fora';
    const r = await req(`${ROUTE(t, id)}/pacote`, { method: 'GET', cookie: s.cookie });
    expect(r.status).toBe(200);
    expect(r.headers.get('x-carimbo')).toBe('falhou');
    expect(decodeURIComponent(r.headers.get('x-carimbo-erro')!)).toContain('503');
    const zip = unzipSync(new Uint8Array(await r.arrayBuffer()));
    expect(Object.keys(zip)).not.toContain('manifesto.json.tsr');
    expect(strFromU8(zip['LEIA-ME.txt'])).toContain('SEM CARIMBO DE TEMPO');
  });
});

describe('sheet for the lawyer', () => {
  const sheet = (t: string, id: string, cookie: string) => req(`${ROUTE(t, id)}/folha?html=1`, { cookie });

  it("clips only the risk sentence, with its type, without the model's note, and says it is not a legal opinion", async () => {
    const { s, t, id } = await story();
    const r = await sheet(t, id, s.cookie);
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain(P[2]);
    expect(html).not.toContain(P[1]);
    expect(html).toContain('acusação sem condenação nem fonte oficial');
    expect(html).not.toContain(INTERNAL_EXPLANATION);
    expect(html).toContain('Sem evidência registrada.');
    expect(html).toContain('Sem registro de contato.');
    expect(html).toMatch(/Versão \d+, gerada em/);
    expect(html).toMatch(/[0-9a-f]{64}/);
    expect(html).toContain('Não é parecer jurídico');
  });

  it("the risk sentence's evidence comes out with the literal excerpt and the link; an excerpt not in the source doesn't get in", async () => {
    const { s, t, id, ev } = await story();
    await env.DB.prepare("UPDATE afirmacoes SET evidencia_id = ?, evidencia_trecho = ? WHERE texto_id = ? AND estado = 'risco'").bind(ev, EV_PASSAGE, id).run();
    const html = await (await sheet(t, id, s.cookie)).text();
    expect(html).toContain(EV_PASSAGE);
    expect(html).toContain(`href="${SOURCE}"`);
    const { r2_texto: r2_text } = (await env.DB.prepare('SELECT r2_texto FROM evidencias WHERE id = ?').bind(ev).first<{ r2_texto: string }>())!;
    await env.MEDIA.put(r2_text, 'Outro conteúdo, sem a frase.');
    const without = await (await sheet(t, id, s.cookie)).text();
    expect(without).not.toContain(EV_PASSAGE);
    expect(without).toContain('Sem evidência registrada.');
  });

  it('right of reply with and without an answer, one line only per request', async () => {
    const { s, t, id } = await story();
    const e = await read(t, id, s.cookie);
    const accusation = e.afirmacoes.find((a) => a.trecho === P[2])!;
    const { pedidoId: requestId } = await (await req(`${ROUTE(t, id)}/pedidos`, { cookie: s.cookie, body: copiedRequest({ blocoId: accusation.blocoId, trecho: P[2], corpo: `Bom dia. A matéria afirma: "${P[2]}" Ele quer se manifestar?` }) })).json<{ pedidoId: string }>();
    const without = await (await sheet(t, id, s.cookie)).text();
    expect(without).toContain('Procurado: Assessoria do vereador');
    expect(without.match(/Procurado:/g)).toHaveLength(1);
    expect(without).toContain('Sem resposta registrada.');
    await req(`${ROUTE(t, id)}/pedidos/${requestId}/resposta`, { cookie: s.cookie, body: { texto: 'O vereador nega.', recebidaEm: new Date().toISOString() } });
    const withValue = await (await sheet(t, id, s.cookie)).text();
    expect(withValue).toMatch(/Resposta em /);
    expect(withValue).toContain('O vereador nega.');
    expect(withValue).not.toContain('Sem resposta registrada.');
  });

  it('an unchecked version responds 409 with the request to check', async () => {
    const { s, t, id } = await story();
    await env.DB.prepare('UPDATE textos SET conferido_versao = NULL WHERE id = ?').bind(id).run();
    const r = await req(`${ROUTE(t, id)}/folha`, { cookie: s.cookie });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ code: 'nao_conferido', erro: 'Confira esta versão antes de gerar a folha.' });
  });

  it('without risk, the sheet says so; in English for an English outlet', async () => {
    const { s, t, id } = await story();
    await env.DB.prepare("DELETE FROM afirmacoes WHERE texto_id = ? AND estado = 'risco'").bind(id).run();
    expect(await (await sheet(t, id, s.cookie)).text()).toContain('não marcou nenhuma frase de risco');
    await env.DB.prepare("UPDATE tenants SET idioma = 'en' WHERE id = ?").bind(t).run();
    const ing = await (await sheet(t, id, s.cookie)).text();
    expect(ing).toContain('The check of this version marked no risky sentence.');
    expect(ing).toContain('<html lang="en">');
    expect(ing).toContain('It is not a legal opinion.');
  });

  it('the risk comes out in English, and the right of reply too', async () => {
    const { s, t, id } = await story();
    await env.DB.prepare("UPDATE tenants SET idioma = 'en' WHERE id = ?").bind(t).run();
    const html = await (await sheet(t, id, s.cookie)).text();
    expect(html).toContain('accusation with no conviction or official source');
    expect(html).toContain('No contact recorded.');
  });

  it('the PDF comes out through the browser, with the version name', async () => {
    const { s, t, id } = await story();
    const pdf = new Uint8Array([37, 80, 68, 70]);
    const page = { route: async () => {}, setContent: async () => {}, pdf: async () => pdf };
    const open = vi.spyOn(browserApi, 'abrir').mockImplementation((() => Promise.resolve({ newPage: async () => page, close: async () => {} })) as never);
    const r = await req(`${ROUTE(t, id)}/folha`, { cookie: s.cookie });
    open.mockRestore();
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/pdf');
    expect(r.headers.get('content-disposition')).toMatch(/folha-advogado-v\d+\.pdf/);
  });

  it('IDOR: another outlet gives 404; reporter gives 403', async () => {
    const a = await story();
    const b = await story();
    expect((await sheet(a.t, a.id, b.s.cookie)).status).toBe(404);
    expect((await sheet(b.t, a.id, b.s.cookie)).status).toBe(404);
    const rep = await register('Repórter');
    await seedMember(a.t, rep.userId, 'reporter');
    expect((await sheet(a.t, a.id, rep.cookie)).status).toBe(403);
  });
});

describe('IDOR and role on the new routes', () => {
  it("another outlet can't reach it (404, without revealing it exists); reporter doesn't write or download the package (403); a request for another text gives 404", async () => {
    const a = await story();
    const b = await story();
    const { pedidoId: requestId } = await (await req(`${ROUTE(a.t, a.id)}/pedidos`, { cookie: a.s.cookie, body: copiedRequest() })).json<{ pedidoId: string }>();
    const v = (await read(a.t, a.id, a.s.cookie)).texto.versao;
    const routes: [string, string, unknown?][] = [
      ['POST', `${ROUTE(a.t, a.id)}/pedidos`, copiedRequest()],
      ['POST', `${ROUTE(a.t, a.id)}/pedidos/${requestId}/resposta`, { texto: 'x y', recebidaEm: new Date().toISOString() }],
      ['POST', `${ROUTE(a.t, a.id)}/pagina-fontes`, { versao: v }],
      ['DELETE', `${ROUTE(a.t, a.id)}/pagina-fontes`],
      ['GET', `${ROUTE(a.t, a.id)}/pacote`],
      ['POST', `${ROUTE(a.t, a.id)}/evidencias/${a.ev}/wayback`, {}],
    ];
    for (const [method, path, body] of routes) {
      expect((await req(path, { method, cookie: b.s.cookie, body })).status, `${method} ${path}`).toBe(404);
    }
    // Outlet B's routes with A's ids: 404.
    expect((await req(`${ROUTE(b.t, b.id)}/pedidos/${requestId}/resposta`, { cookie: b.s.cookie, body: { texto: 'x y', recebidaEm: new Date().toISOString() } })).status).toBe(404);
    expect((await req(`${ROUTE(b.t, a.id)}/pacote`, { method: 'GET', cookie: b.s.cookie })).status).toBe(404);
    expect((await req(`${ROUTE(b.t, b.id)}/evidencias/${a.ev}/wayback`, { cookie: b.s.cookie, body: {} })).status).toBe(404);

    // Outlet A's reporter: reads the desk, but does not request the other side, publish or download the package.
    const rep = await register('Repórter Só');
    await seedMember(a.t, rep.userId, 'reporter');
    expect((await req(ROUTE(a.t, a.id), { cookie: rep.cookie })).status).toBe(200);
    for (const [method, path, body] of routes) {
      expect((await req(path, { method, cookie: rep.cookie, body })).status, `repórter ${method} ${path}`).toBe(403);
    }
  });
});

// ── review (Codex, 03/11): Wayback without a queue and on the last attempt; a large PDF outside the package ─────────────

describe('review: Wayback and package', () => {
  it('the queue did not accept the Wayback copy: "falhou" with the reason and the retry button, never "salvando" forever', async () => {
    const { s, t, id } = await story();
    const ev = (await read(t, id, s.cookie)).evidencias[0].id;
    const { enqueueWayback } = await import('../src/lib/wayback');
    await enqueueWayback({ ...env, MONITOR_QUEUE: { send: async () => { throw new Error('fila fora'); } } } as unknown as Env, t, ev);
    expect((await read(t, id, s.cookie)).evidencias[0].wayback).toMatchObject({ estado: 'falhou', erro: expect.stringContaining('não entrou na fila') });
  });

  it('Wayback stays busy until the queue\'s last delivery: the capture stays "falhou" with the reason (not silently sent to the dead-letter queue)', async () => {
    const { s, t, id } = await story();
    const ev = (await read(t, id, s.cookie)).evidencias[0].id;
    await env.DB.prepare("UPDATE evidencias SET wayback_estado = 'pendente' WHERE id = ?").bind(ev).run();
    wayback = () => new Response('ocupado', { status: 429 });
    expect(await processWayback(env as unknown as Env, t, ev, 1)).toBe('pendente');
    expect(await processWayback(env as unknown as Env, t, ev, ATTEMPTS_QUEUE)).toBe('feito');
    expect((await read(t, id, s.cookie)).evidencias[0].wayback).toMatchObject({ estado: 'falhou', erro: 'HTTP 429' });
  });

  it("a PDF that doesn't fit in the package's memory stays out, listed with the upload's SHA-256", async () => {
    const { s, t, id } = await story();
    const large = `documentos/${t}/grande.pdf`;
    await env.MEDIA.put(large, new Uint8Array(BUDGET_PACKAGE + 1));
    await env.DB.prepare("INSERT INTO arquivos (id, tenant_id, texto_id, tipo, nome, r2, bytes, sha256, estado, por) VALUES (?, ?, ?, 'pdf', 'grande.pdf', ?, ?, 'abc123', 'pronto', ?)")
      .bind(crypto.randomUUID(), t, id, large, BUDGET_PACKAGE + 1, s.userId).run();
    const r = await req(`${ROUTE(t, id)}/pacote`, { method: 'GET', cookie: s.cookie });
    expect(r.headers.get('x-pacote-fora')).toBe('1');
    const zip = unzipSync(new Uint8Array(await r.arrayBuffer()));
    expect(Object.keys(zip).some((n) => n.endsWith('grande.pdf'))).toBe(false);
    expect(JSON.parse(strFromU8(zip['manifesto.json'])).foraDoPacote).toEqual([{ arquivo: 'dossie/documentos/01-grande.pdf', motivo: 'grande', bytes: BUDGET_PACKAGE + 1, sha256: 'abc123' }]);
  });
});

// ── review 2 (Codex, 03/11): the Wayback copy read up to the cap, without the whole body in memory ───────────────────

describe('review 2: Wayback copy in the package', () => {
  it("a copy larger than the cap (without declared size): reading stops at the cap and it stays out, listed; with a declared size, it isn't even read", async () => {
    const { s, t, id, ev } = await story();
    await env.DB.prepare("UPDATE evidencias SET wayback_estado = 'salvo', wayback_url = ? WHERE id = ?").bind(`https://wayback.example/web/20261103101112/${SOURCE}`, ev).run();
    let readItems = 0;
    const chunk = new Uint8Array(1024 * 1024);
    wayback = (u) => (u.includes('id_/') ? new Response(new ReadableStream<Uint8Array>({
      pull(c) { readItems += chunk.byteLength; if (readItems > BUDGET_PACKAGE * 2) c.close(); else c.enqueue(chunk); },
    })) : new Response(null, { status: 404 }));
    const r = await req(`${ROUTE(t, id)}/pacote`, { method: 'GET', cookie: s.cookie });
    expect(r.headers.get('x-pacote-fora')).toBe('1');
    expect(readItems).toBeLessThan(BUDGET_PACKAGE + 8 * chunk.byteLength);   // stopped near the cap, did not read the 80 MB
    const zip = unzipSync(new Uint8Array(await r.arrayBuffer()));
    expect(Object.keys(zip).some((n) => n.endsWith('.wayback.html'))).toBe(false);
    expect(JSON.parse(strFromU8(zip['manifesto.json'])).foraDoPacote).toEqual([{ arquivo: expect.stringMatching(/^dossie\/01-.*\.wayback\.html$/), motivo: 'grande', bytes: null, sha256: null }]);

    readItems = 0;
    wayback = (u) => (u.includes('id_/') ? new Response(new ReadableStream<Uint8Array>({ pull(c) { readItems += 1; c.enqueue(chunk); } }), { headers: { 'content-length': String(BUDGET_PACKAGE + 1) } }) : new Response(null, { status: 404 }));
    const r2 = await req(`${ROUTE(t, id)}/pacote`, { method: 'GET', cookie: s.cookie });
    const zip2 = unzipSync(new Uint8Array(await r2.arrayBuffer()));
    expect(JSON.parse(strFromU8(zip2['manifesto.json'])).foraDoPacote).toEqual([{ arquivo: expect.stringMatching(/wayback\.html$/), motivo: 'grande', bytes: BUDGET_PACKAGE + 1, sha256: null }]);
    expect(readItems).toBeLessThanOrEqual(2);
  });
});

// ── review 3 (Codex, 03/11): a Wayback copy that drops midway returns the budget ───────────────────────────────────

describe('review 3: package budget', () => {
  it('the Wayback copy drops mid-read: what was counted from it comes back, and the PDF that fits gets in', async () => {
    const { s, t, id, ev } = await story();
    await env.DB.prepare("UPDATE evidencias SET wayback_estado = 'salvo', wayback_url = ? WHERE id = ?").bind(`https://wayback.example/web/20261103101112/${SOURCE}`, ev).run();
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    wayback = (u) => (u.includes('id_/') ? new Response(new ReadableStream<Uint8Array>({
      pull(c) { if (sent++ >= 30) c.error(new Error('conexão caiu')); else c.enqueue(chunk); },
    })) : new Response(null, { status: 404 }));
    const pdf = `documentos/${t}/medio.pdf`;
    await env.MEDIA.put(pdf, new Uint8Array(15 * 1024 * 1024));
    await env.DB.prepare("INSERT INTO arquivos (id, tenant_id, texto_id, tipo, nome, r2, bytes, sha256, estado, por) VALUES (?, ?, ?, 'pdf', 'medio.pdf', ?, ?, 'abc', 'pronto', ?)")
      .bind(crypto.randomUUID(), t, id, pdf, 15 * 1024 * 1024, s.userId).run();
    const r = await req(`${ROUTE(t, id)}/pacote`, { method: 'GET', cookie: s.cookie });
    expect(r.headers.get('x-pacote-fora')).toBe('0');
    const zip = unzipSync(new Uint8Array(await r.arrayBuffer()));
    expect(zip['dossie/documentos/01-medio.pdf']?.byteLength).toBe(15 * 1024 * 1024);
    const evs = JSON.parse(strFromU8(zip['dossie/evidencias.json'])) as { copiaDoWayback: string | null }[];
    expect(evs[0].copiaDoWayback).toMatch(/^não baixada: .*conexão caiu/);
  });
});
