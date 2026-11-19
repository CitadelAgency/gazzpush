// Cost per check with and without the second opinion (it costs calls: `npm run symmetry`, outside `npm test`). A
// fictional 8-paragraph story with 2 pieces of evidence is checked in full by the pipeline (checkBlocks) with the real
// DeepSeek. The second opinion is intercepted: without an Anthropic key in .dev.vars, its tokens are estimated from the
// tokens/character ratio DeepSeek measured on that same request (the prefix written to the cache on the first call and
// read on the others), the output is DeepSeek's average output per block and the price is the list price
// (src/lib/secondOpinion.ts). With ANTHROPIC_API_KEY in .dev.vars, the second opinion runs for real and the number is
// measured, not estimated.
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { Env } from '../../src/env';
import { checkBlocks } from '../../src/lib/desk';

const PARAGRAPHS = [
  'A Câmara de Vila Serena renovou 12 contratos de ônibus sem licitação em 2025, segundo o relatório da comissão de transporte.',
  'Os contratos somam R$ 48 milhões por ano. Em 2024, a mesma frota custava R$ 40 milhões, uma alta de 20%.',
  'O vereador Ícaro Nunes, relator da comissão, desviou parte do dinheiro para uma empresa da família, dizem moradores do bairro Jardim Norte.',
  'A empresa Viação Serena, que opera 9 das 14 linhas, não respondeu aos pedidos de entrevista até a publicação.',
  'Segundo a prefeitura, a renovação sem licitação foi feita por causa de uma emergência na frota, que tinha ônibus com mais de 15 anos.',
  'O Tribunal de Contas do Estado abriu uma auditoria sobre os contratos em setembro.',
  'A cidade gasta mais com transporte do que com saúde: são R$ 48 milhões contra R$ 41 milhões no orçamento deste ano.',
  'Eu acho que a Câmara deve uma explicação aos moradores que esperam ônibus por mais de uma hora.',
];
const EVIDENCE = [
  ['https://camara.example/relatorio-transporte', 'Relatório da comissão de transporte',
    'Relatório final da comissão de transporte da Câmara de Vila Serena. A Câmara aprovou em 2025 a renovação de 12 contratos de ônibus sem licitação. Valor anual dos contratos: R$ 48 milhões (em 2024, R$ 40 milhões). A Viação Serena opera 9 das 14 linhas do município. Relator: vereador Ícaro Nunes. A prefeitura alegou emergência na frota, com ônibus de mais de 15 anos.'],
  ['https://tce.example/auditoria-onibus', 'TCE abre auditoria',
    'O Tribunal de Contas do Estado instaurou em setembro auditoria sobre os contratos de transporte coletivo de Vila Serena renovados sem licitação. Orçamento municipal de 2025: transporte R$ 48 milhões; saúde R$ 41 milhões.'],
];

const SECOND = 'https://segunda.estimativa';
const PRICES: Record<string, [number, number, number, number]> = {
  'claude-opus-5-5': [4, 20, 0.2, 5],
  'claude-haiku-5-5': [0.1, 0.5, 0.01, 0.125],
};

type Measure = { custo: number; deepseek: number; segunda: number; chamadasSegunda: number; blocos: number };

async function check(tenantId: string, author: string, e: Env): Promise<Measure> {
  const id = crypto.randomUUID();
  const stmts = [env.DB.prepare("INSERT INTO textos (id, tenant_id, titulo, paragrafos_json, origem, autor) VALUES (?, ?, 'Ônibus', ?, 'colado', ?)")
    .bind(id, tenantId, JSON.stringify(PARAGRAPHS), author)];
  for (const [url, title, text] of EVIDENCE) {
    const ev = crypto.randomUUID();
    await env.MEDIA.put(`evidencias/${tenantId}/${ev}.txt`, text);
    stmts.push(env.DB.prepare('INSERT INTO evidencias (id, tenant_id, texto_id, url, titulo, r2_texto, hash) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(ev, tenantId, id, url, title, `evidencias/${tenantId}/${ev}.txt`, ev));
  }
  await env.DB.batch(stmts);

  // Tokens/character ratio and output per block, measured on DeepSeek; the second opinion uses the same.
  let ds = { chars: 0, entrada: 0, saida: 0, n: 0, custo: 0 };
  let seg = { custo: 0, n: 0, prefixoEscrito: false };
  const original = globalThis.fetch;
  const model = e.SEGUNDA_MODELO ?? 'claude-opus-5-5';
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith(SECOND)) {
      const body = JSON.parse(String(init?.body)) as { system: string; messages: { content: { text: string }[] }[] };
      const ratio = ds.entrada / Math.max(1, ds.chars);
      const prefix = Math.round((body.system.length + body.messages[0].content[0].text.length) * ratio);
      const block = Math.round(body.messages[0].content[1].text.length * ratio);
      const output = Math.round(ds.saida / Math.max(1, ds.n));
      const written = seg.prefixoEscrito ? 0 : prefix;
      seg.prefixoEscrito = true;
      const [foot, ps, pl, pw] = PRICES[model];
      seg.custo += (block * foot + output * ps + (prefix - written) * pl + written * pw) / 1e6;
      seg.n++;
      return Response.json({
        id: 'msg_estimativa', type: 'message', role: 'assistant', model: model, stop_reason: 'end_turn', stop_sequence: null,
        content: [{ type: 'text', text: JSON.stringify({ afirmacoes: [] }) }],
        usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      });
    }
    const res = await original(input, init);
    if (init?.body && /chat\/completions/.test(url)) {
      const body = JSON.parse(String(init.body)) as { messages: { content: string }[] };
      const u = (await res.clone().json() as { usage?: { prompt_tokens: number; completion_tokens: number } }).usage;
      if (u) ds = { ...ds, chars: ds.chars + body.messages.reduce((s, m) => s + m.content.length, 0), entrada: ds.entrada + u.prompt_tokens, saida: ds.saida + u.completion_tokens, n: ds.n + 1 };
    }
    return res;
  }) as typeof fetch;
  try {
    const r = await checkBlocks(e, tenantId, id);
    expect(r.falhas, 'algum bloco ficou sem conferir').toBe(0);
    ds.custo = r.custoUsd;
    return { custo: r.custoUsd + seg.custo, deepseek: r.custoUsd, segunda: seg.custo, chamadasSegunda: seg.n, blocos: ds.n };
  } finally {
    globalThis.fetch = original;
  }
}

describe('cost per check', () => {
  it('without and with the second opinion (Opus 5.5 and Haiku 5.5)', async () => {
    const tenantId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO tenants (id, slug, nome, modo) VALUES (?, ?, 'Custo', 'autoral')").bind(tenantId, `c-${tenantId.slice(0, 8)}`).run();
    const author = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, 'Custo', ?, 0, datetime('now'), datetime('now'))`).bind(author, `${author}@custo.example`).run();
    const base = env as unknown as Env;
    const without = await check(tenantId, author, { ...base, ANTHROPIC_API_KEY: undefined });
    const real = !!base.ANTHROPIC_API_KEY;
    const lines = [`sem a segunda opinião: US$ ${without.custo.toFixed(5)} (${without.blocos} chamadas ao DeepSeek, 8 parágrafos)`];
    for (const model of ['claude-opus-5-5', 'claude-haiku-5-5']) {
      const e = real ? { ...base, SEGUNDA_MODELO: model } : { ...base, ANTHROPIC_API_KEY: 'estimativa', SEGUNDA_URL: SECOND, SEGUNDA_MODELO: model };
      const m = await check(tenantId, author, e);
      lines.push(real ? `com a segunda opinião (${model}, medida): US$ ${m.custo.toFixed(5)}`
        : `com a segunda opinião (${model}, estimada): US$ ${m.custo.toFixed(5)} = DeepSeek ${m.deepseek.toFixed(5)} + segunda ${m.segunda.toFixed(5)} (${m.chamadasSegunda} chamadas)`);
    }
    console.log(lines.join('\n'));
  });
});
