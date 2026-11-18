// Fase 5 (handoffs/2026-11-02-materia-e-editor-investigativo.md): pergunte ao documento. O PDF lido por página; a busca
// por palavra (FTS5) e por sentido (Vectorize, simulado); a resposta só com citação conferida por código (página entre
// as lidas e trecho literal nela), senão "não encontrei"; entidades por código; o total do documento cruzado com o texto;
// o trecho que vira evidência; IDOR das rotas novas. DeepSeek é fetch simulado.
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import { aspasForaDasPaginas, cruzarComTexto, entidadesDasPaginas, pedacosDaPagina, processarArquivo, trechoDaPagina, valoresEmReais } from '../src/lib/documento';
import { processarGravacao } from '../src/lib/gravacao';
import { cadastrar, req, seedMembro } from './helpers';
import { pdfFalso } from './pdf-falso';
import { strFromU8, unzipSync } from 'fflate';

const PAGINAS = [
  ['Índice do documento', 'A primeira página identifica as colunas usadas na tabela do anexo.', 'Referência: Unicode Standard.'],
  ['Tabela de valores', 'Linha 1: R$ 20', 'Linha 2: R$ 28', 'Total: R$ 48', 'Data: 12/03/2025.'],
  ['Anexo', 'O anexo descreve a sequência das páginas e a ordem dos campos.'],
];
const TEXTO = ['Resumo da tabela', 'A primeira página descreve a tabela de valores.', 'O total da tabela é R$ 40.'].join('\n');

type Citacao = { pagina: number; trecho: string };
let modelo: ((user: string) => { encontrou: boolean; resposta: string; citacoes: Citacao[] }) | 'fora';
let chamadas = 0;
let conferencia: (bloco: string) => Record<string, unknown>[] = () => [];

beforeEach(() => {
  modelo = () => ({ encontrou: false, resposta: '', citacoes: [] });
  chamadas = 0;
  conferencia = () => [];
  const original = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('deepseek')) {
      const corpo = JSON.parse(init!.body as string) as { messages: { content: string }[] };
      if (!corpo.messages[0].content.startsWith('PERGUNTA AO DOCUMENTO')) {
        const user = corpo.messages[1].content;
        const afirmacoes = conferencia(user.slice(user.lastIndexOf('[P0] ') + 5));
        return Response.json({ choices: [{ message: { content: JSON.stringify({ afirmacoes }) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
      }
      chamadas++;
      if (modelo === 'fora') return new Response('fora', { status: 503 });
      return Response.json({ choices: [{ message: { content: JSON.stringify(modelo(corpo.messages[1].content)) } }], usage: { prompt_tokens: 1000, completion_tokens: 100 } });
    }
    if (url.includes('.example')) return new Response('não achei', { status: 404 });
    return original(input, init);
  });
});
afterEach(() => vi.restoreAllMocks());

async function materia() {
  const s = await cadastrar('Repórter');
  const t = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO tenants (id, slug, nome, modo, plano) VALUES (?, ?, 'Publicação', 'autoral', 'cortesia')").bind(t, `d-${t.slice(0, 8)}`).run();
  await seedMembro(t, s.userId, 'admin');
  const { texto } = await (await req(`/api/t/${t}/textos`, { cookie: s.cookie, body: { texto: TEXTO } })).json<{ texto: { id: string } }>();
  return { s, t, id: texto.id };
}
const ROTA = (t: string, id: string) => `/api/t/${t}/textos/${id}`;
const enviar = (t: string, id: string, cookie: string, bytes: Uint8Array<ArrayBuffer>, nome = 'relatório.pdf') =>
  req(`${ROTA(t, id)}/documentos`, { cookie, cru: { tipo: 'application/pdf', corpo: bytes }, headers: { 'x-nome': encodeURIComponent(nome) } });

interface Doc {
  id: string; nome: string; estado: string; erro: string | null; paginas: number | null; vetor: string | null;
  entidades: { pessoas: { valor: string }[]; empresas: { valor: string; paginas: number[] }[]; valores: { valor: string }[]; datas: { valor: string }[] } | null;
  perguntas: { pergunta: string; resposta: string | null; citacoes: Citacao[]; descartadas: number; encontrou: boolean; busca: string; situacao: string; aviso: string | null }[];
}
interface Estado { texto: { versao: number }; documentos: Doc[]; evidencias: { id: string; origem: string; titulo: string }[]; apontamentos: { tipo: string; trecho: string; explicacao: string }[]; checklist: { pendencias: { tipo: string }[] } }
const ler = async (t: string, id: string, cookie: string) => (await req(ROTA(t, id), { cookie })).json<Estado>();

/** Envia e lê (a fila roda processarArquivo; aqui chamado direto para o teste não depender do tempo da fila). */
async function documentoLido(t: string, id: string, cookie: string, e: Env = env as unknown as Env, paginas = PAGINAS) {
  const r = await enviar(t, id, cookie, pdfFalso(paginas));
  expect(r.status).toBe(201);
  const { arquivoId } = await r.json<{ arquivoId: string }>();
  await processarArquivo(e, t, arquivoId);
  return arquivoId;
}

describe('envio e leitura do PDF', () => {
  it('ignora rótulos de campos numéricos ao identificar nomes', () => {
    const { pessoas } = entidadesDasPaginas(['REF: 001-002-003\nIBGE']);
    expect(pessoas.map((p) => p.valor)).toEqual(['IBGE']);
  });

  it('só PDF; grande demais dá 422; o mesmo arquivo de novo é o de antes; lê páginas, entidades e totais', async () => {
    const { s, t, id } = await materia();
    expect((await enviar(t, id, s.cookie, new TextEncoder().encode('não sou pdf'))).status).toBe(422);
    const grande = new Uint8Array(20 * 1024 * 1024 + 1); grande.set(new TextEncoder().encode('%PDF-1.4'));
    expect((await enviar(t, id, s.cookie, grande)).status).toBe(422);

    const arq = await documentoLido(t, id, s.cookie);
    const de2 = await enviar(t, id, s.cookie, pdfFalso(PAGINAS));
    expect(de2.status).toBe(200);
    expect((await de2.json<{ arquivoId: string; existia: boolean }>())).toMatchObject({ arquivoId: arq, existia: true });

    const d = (await ler(t, id, s.cookie)).documentos[0];
    expect(d).toMatchObject({ nome: 'relatório.pdf', estado: 'pronto', paginas: 3, vetor: 'desligado', erro: null });
    expect(d.entidades!.empresas).toEqual([]);
    expect(d.entidades!.valores.map((v) => v.valor)).toEqual(['R$ 20', 'R$ 28', 'R$ 48']);
    expect(d.entidades!.datas.map((v) => v.valor)).toEqual(['12/03/2025']);
    expect(d.entidades!.pessoas.map((p) => p.valor)).toContain('Unicode Standard');

    await env.DB.prepare("UPDATE arquivos SET entidades_json = json_set(entidades_json, '$.campo_antigo', 'legado') WHERE id = ?").bind(arq).run();
    const relido = (await ler(t, id, s.cookie)).documentos[0];
    expect(Object.keys(relido.entidades!).sort()).toEqual(['datas', 'empresas', 'pessoas', 'valores']);
  });

  it('PDF sem texto ou quebrado: falhou, com o motivo à vista', async () => {
    const { s, t, id } = await materia();
    await documentoLido(t, id, s.cookie, env as unknown as Env, [[]]);
    const quebrado = await enviar(t, id, s.cookie, new TextEncoder().encode('%PDF-1.4 quebrado sem objetos'));
    await processarArquivo(env as unknown as Env, t, (await quebrado.json<{ arquivoId: string }>()).arquivoId);
    const docs = (await ler(t, id, s.cookie)).documentos;
    expect(docs.map((d) => d.estado)).toEqual(['falhou', 'falhou']);
    expect(docs[0].erro).toContain('não tem texto');
    expect(docs[1].erro).toContain('não deu para ler');
  });
});

describe('pergunta ao documento', () => {
  it('a resposta só aparece com citação literal da página lida; o resto é descartado e vira "não encontrei"', async () => {
    const { s, t, id } = await materia();
    const arq = await documentoLido(t, id, s.cookie);
    const perguntar = (pergunta: string) => req(`${ROTA(t, id)}/documentos/${arq}/perguntas`, { cookie: s.cookie, body: { pergunta } });

    // Boa: página buscada e trecho literal (com espaços diferentes) → resposta com a citação.
    modelo = (user) => {
      expect(user).toContain('[p. 2]');
      return { encontrou: true, resposta: 'O total da tabela é R$ 48.', citacoes: [{ pagina: 2, trecho: 'Total:  R$ 48' }, { pagina: 2, trecho: 'Total geral de R$ 50' }, { pagina: 9, trecho: 'Linha 1: R$ 20' }] };
    };
    const boa = await (await perguntar('Qual o total da tabela?')).json<{ resposta: string; citacoes: Citacao[]; descartadas: unknown[]; encontrou: boolean; busca: string }>();
    expect(boa).toMatchObject({ encontrou: true, resposta: 'O total da tabela é R$ 48.', citacoes: [{ pagina: 2, trecho: 'Total:  R$ 48' }], busca: 'palavra' });
    expect(boa.descartadas).toHaveLength(2);

    // O modelo "acha", mas nenhuma citação confere: sem resposta (nunca a resposta sem prova), e a tela diz que a
    // resposta do modelo foi descartada (não é o mesmo que o documento não ter a informação).
    modelo = () => ({ encontrou: true, resposta: 'A tabela tem colunas extras.', citacoes: [{ pagina: 1, trecho: 'A tabela tem quatro colunas extras.' }] });
    const ruim = await (await perguntar('Quais são as colunas da tabela?')).json<{ resposta: string | null; encontrou: boolean; descartadas: unknown[]; situacao: string }>();
    expect(ruim).toMatchObject({ encontrou: false, resposta: null, situacao: 'invalida' });
    expect(ruim.descartadas).toHaveLength(1);

    // Uma citação boa não libera aspas inventadas na resposta: o trecho entre aspas tem de estar na página lida.
    modelo = () => ({ encontrou: true, resposta: 'O total é R$ 48, e o relatório conclui: "faltou uma coluna".', citacoes: [{ pagina: 2, trecho: 'Total:  R$ 48' }] });
    const aspa = await (await perguntar('Qual o total da tabela?')).json<{ resposta: string | null; situacao: string; descartadas: { trecho: string; motivo: string }[] }>();
    expect(aspa).toMatchObject({ resposta: null, situacao: 'invalida' });
    expect(aspa.descartadas).toContainEqual(expect.objectContaining({ trecho: 'faltou uma coluna', motivo: 'resposta' }));

    // Formato fora do combinado ({} em vez de encontrou/citacoes): inválida, não "não encontrei".
    modelo = () => ({}) as never;
    expect((await (await perguntar('Qual o total da tabela?')).json<{ situacao: string }>()).situacao).toBe('invalida');

    // Pergunta sem nenhuma palavra no documento: nem chama o modelo.
    const antes = chamadas;
    const nada = await (await perguntar('Qual algoritmo criptográfico?')).json<{ encontrou: boolean }>();
    expect(nada.encontrou).toBe(false);
    expect(chamadas).toBe(antes);

    // Modelo fora: 502 dizendo que ficou sem resposta conferida (nada some calado).
    modelo = 'fora';
    const fora = await perguntar('Qual o total da tabela?');
    expect(fora.status).toBe(502);
    expect((await fora.json<{ code: string }>()).code).toBe('modelo');

    // A tentativa que falhou também fica no histórico (e no pacote de defesa), com a situação.
    const d = (await ler(t, id, s.cookie)).documentos[0];
    expect(d.perguntas.map((p) => p.situacao)).toEqual(['falhou', 'nao_encontrou', 'invalida', 'invalida', 'invalida', 'respondida']);   // mais recente primeiro
    expect(d.perguntas.map((p) => p.encontrou)).toEqual([false, false, false, false, false, true]);
  });

  it('busca por sentido que falha: a pergunta registra o aviso (só a busca por palavra rodou), não um "não achei" calado', async () => {
    const { s, t, id } = await materia();
    const ok = {
      ...env, BUSCA_VETORIAL: undefined,
      AI: { run: async (_m: string, { text }: { text: string[] }) => ({ data: text.map(() => Array(1024).fill(0.01)) }) },
      DOCS_VETOR: { upsert: async () => ({ mutationId: 'm' }), query: async () => { throw new Error('Vectorize 503'); } },
    } as unknown as Env;
    const arq = await documentoLido(t, id, s.cookie, ok);
    const { perguntar } = await import('../src/lib/documento');
    const r = await perguntar(ok, t, id, arq, 'ordenação alfabética', s.userId);
    expect(r.busca).toBe('palavra');
    expect(r.aviso).toContain('Vectorize 503');
    expect((await ler(t, id, s.cookie)).documentos[0].perguntas[0].aviso).toContain('busca por sentido falhou');
  });

  it('valores sem ponto de milhar e frases com ponto de milhar; página longa vai ao modelo em volta das palavras buscadas', () => {
    expect(valoresEmReais('custou R$ 1000 ao todo').map((v) => v.valor)).toEqual([1000]);
    expect(valoresEmReais('R$ 1.000,00 e R$ 100,50').map((v) => v.valor)).toEqual([1000, 100.5]);
    // "R$ 1.000,00." é uma frase só: o cruzamento compara mil reais (e o documento traz dois mil).
    const c = cruzarComTexto([{ id: 'b1', texto: 'O total é R$ 1.000,00. O resto é outra frase.' }], [{ id: 'd', nome: 'Relatório', totais: [{ pagina: 1, valor: 2000, como: 'total' }] }]);
    expect(c).toHaveLength(1);
    expect(c[0].trecho).toBe('R$ 1.000,00');
    const longa = `${'Introdução sem nada. '.repeat(800)}O campo numérico contém R$ 9 milhões.${' Anexo.'.repeat(500)}`;
    const trecho = trechoDaPagina(longa, ['numerico']);
    expect(trecho.length).toBeLessThanOrEqual(8000 + 20);
    expect(trecho).toContain('O campo numérico contém R$ 9 milhões.');
    expect(trecho.startsWith('[…]')).toBe(true);
    expect(aspasForaDasPaginas('Diz: "contém R$ 9 milhões" e "frase que não existe"', [{ pagina: 1, texto: longa }])).toEqual(['frase que não existe']);
  });

  it('busca por sentido: com o índice, os pedaços entram no namespace do arquivo e a busca soma as duas', async () => {
    const { s, t, id } = await materia();
    const vetores: { id: string; namespace?: string }[] = [];
    const consultas: { namespace?: string }[] = [];
    const e = {
      ...env, BUSCA_VETORIAL: undefined,
      AI: { run: async (_m: string, { text }: { text: string[] }) => ({ data: text.map(() => Array(1024).fill(0.01)) }) },
      DOCS_VETOR: {
        upsert: async (vs: { id: string; namespace?: string }[]) => { vetores.push(...vs); return { mutationId: 'm' }; },
        query: async (_v: number[], o: { namespace?: string }) => { consultas.push(o); return { matches: [{ id: 'x:3:0', score: 0.9, metadata: { pagina: 3 } }], count: 1 }; },
      },
    } as unknown as Env;
    const arq = await documentoLido(t, id, s.cookie, e);
    expect(vetores.length).toBeGreaterThanOrEqual(3);
    expect(new Set(vetores.map((v) => v.namespace))).toEqual(new Set([arq]));
    const { perguntar } = await import('../src/lib/documento');
    modelo = (user) => ({ encontrou: user.includes('[p. 3]'), resposta: 'O anexo descreve a sequência.', citacoes: [{ pagina: 3, trecho: 'O anexo descreve a sequência das páginas' }] });
    const r = await perguntar(e, t, id, arq, 'ordenação alfabética', s.userId);
    expect(r).toMatchObject({ encontrou: true, busca: 'palavra+sentido' });
    expect(consultas[0].namespace).toBe(arq);
  });

  it('o trecho citado vira evidência (trecho literal conferido); o total do documento cruza com o texto', async () => {
    const { s, t, id } = await materia();
    const arq = await documentoLido(t, id, s.cookie);
    const virar = (body: unknown) => req(`${ROTA(t, id)}/documentos/${arq}/evidencia`, { cookie: s.cookie, body });
    expect((await virar({ pagina: 2, trecho: 'Total: R$ 50' })).status).toBe(422);
    expect((await virar({ pagina: 7, trecho: 'Total: R$ 48' })).status).toBe(422);
    const ok = await virar({ pagina: 2, trecho: 'Total: R$ 48' });
    expect(ok.status).toBe(201);
    const e = await ok.json<Estado & { evidenciaId: string }>();
    expect(e.evidencias.find((x) => x.id === e.evidenciaId)).toMatchObject({ origem: 'documento', titulo: 'relatório.pdf, p. 2' });
    expect((await virar({ pagina: 2, trecho: 'Linha 1: R$ 20' })).status).toBe(200);   // a mesma página: a evidência de antes

    // O texto diz que a tabela soma R$ 40; o documento traz total de R$ 48 (p. 2).
    const ap = e.apontamentos.find((x) => x.tipo === 'conta' && x.trecho === 'R$ 40');
    expect(ap?.explicacao).toContain('relatório.pdf, p. 2');
    expect(e.checklist.pendencias.some((p) => p.tipo === 'conta')).toBe(true);
  });
});

describe('pacote de defesa', () => {
  it('leva o PDF original e as perguntas feitas a ele, com as citações e o que foi descartado', async () => {
    const { s, t, id } = await materia();
    const arq = await documentoLido(t, id, s.cookie);
    modelo = () => ({ encontrou: true, resposta: 'R$ 48.', citacoes: [{ pagina: 2, trecho: 'Total: R$ 48' }, { pagina: 2, trecho: 'Total: R$ 99' }] });
    await req(`${ROTA(t, id)}/documentos/${arq}/perguntas`, { cookie: s.cookie, body: { pergunta: 'Qual o total da tabela?' } });
    // Pergunta que o modelo não respondeu: no pacote, com a situação (não parece "não achei no documento").
    modelo = 'fora';
    await req(`${ROTA(t, id)}/documentos/${arq}/perguntas`, { cookie: s.cookie, body: { pergunta: 'Qual o total de 2024?' } });
    const r = await req(`${ROTA(t, id)}/pacote`, { method: 'GET', cookie: s.cookie });
    expect(r.status).toBe(200);
    const zip = unzipSync(new Uint8Array(await r.arrayBuffer()));
    const pdf = Object.keys(zip).find((n) => n.startsWith('dossie/documentos/') && n.endsWith('.pdf'));
    expect(pdf).toBe('dossie/documentos/01-relatorio.pdf');
    expect(strFromU8(zip[pdf!].slice(0, 5))).toBe('%PDF-');
    const docs = JSON.parse(strFromU8(zip['dossie/documentos/documentos.json'])) as { nome: string; sha256: string; perguntas: { pergunta: string; citacoes: Citacao[]; descartadas: unknown[] }[] }[];
    expect(docs[0]).toMatchObject({ nome: 'relatório.pdf', perguntas: [
      { pergunta: 'Qual o total da tabela?', situacao: 'respondida', citacoes: [{ pagina: 2, trecho: 'Total: R$ 48' }] },
      { pergunta: 'Qual o total de 2024?', situacao: 'falhou', resposta: null },
    ] });
    expect(docs[0].perguntas[0].descartadas).toHaveLength(1);
    const manifesto = JSON.parse(strFromU8(zip['manifesto.json'])) as { arquivos: Record<string, string> } | Record<string, unknown>;
    expect(JSON.stringify(manifesto)).toContain(pdf!);
  });
});

describe('página de fontes pública', () => {
  it('a frase sustentada por página de documento mostra o trecho e o documento, sem link nem id interno', async () => {
    const { s, t, id } = await materia();
    const arq = await documentoLido(t, id, s.cookie);
    const LINHA = 'A primeira página identifica as colunas usadas na tabela do anexo.';
    const { evidenciaId: ev } = await (await req(`${ROTA(t, id)}/documentos/${arq}/evidencia`, { cookie: s.cookie, body: { pagina: 1, trecho: LINHA } })).json<{ evidenciaId: string }>();
    const frase = TEXTO.split('\n')[1];
    conferencia = (b) => (b === frase ? [{ paragrafo: 0, trecho: frase, estado: 'com_evidencia', risco: null, evidencia: ev, trecho_evidencia: LINHA, explicacao: 'O relatório traz o número.' }] : []);
    expect((await req(`${ROTA(t, id)}/conferir`, { cookie: s.cookie, body: {} })).status).toBe(200);
    const { texto } = await ler(t, id, s.cookie);
    expect((await req(`${ROTA(t, id)}/assinar`, { cookie: s.cookie, body: { versao: texto.versao } })).status).toBe(201);
    const pub = await req(`${ROTA(t, id)}/pagina-fontes`, { cookie: s.cookie, body: { versao: texto.versao } });
    expect(pub.status).toBe(201);
    const { paginaFontes } = await pub.json<{ paginaFontes: { id: string } }>();
    const corpo = await (await req(`/fontes/${paginaFontes.id}`, { method: 'GET', origin: null })).text();
    expect(corpo).toContain(frase);
    expect(corpo).toContain(LINHA);
    expect(corpo).toContain('relatório.pdf, p. 1');
    for (const interno of ['documento:', arq, 'href="documento']) expect(corpo, interno).not.toContain(interno);
  });
});

describe('IDOR e papel nas rotas novas', () => {
  it('outro veículo não alcança (404); repórter não envia, não pergunta, não vira evidência (403)', async () => {
    const a = await materia();
    const b = await materia();
    const arq = await documentoLido(a.t, a.id, a.s.cookie);
    const rotas: [string, string, unknown?, Uint8Array<ArrayBuffer>?][] = [
      ['POST', `${ROTA(a.t, a.id)}/documentos`, undefined, pdfFalso([['Outro documento qualquer']])],
      ['POST', `${ROTA(a.t, a.id)}/documentos/${arq}/perguntas`, { pergunta: 'Qual o total?' }],
      ['POST', `${ROTA(a.t, a.id)}/documentos/${arq}/evidencia`, { pagina: 2, trecho: 'Total: R$ 48' }],
      ['GET', `${ROTA(a.t, a.id)}/documentos/${arq}/pdf`],
    ];
    const pedir = (method: string, path: string, cookie: string, body?: unknown, pdf?: Uint8Array<ArrayBuffer>) =>
      req(path, { method, cookie, ...(pdf ? { cru: { tipo: 'application/pdf', corpo: pdf } } : body !== undefined ? { body } : {}) });
    for (const [m, p, body, pdf] of rotas) expect((await pedir(m, p, b.s.cookie, body, pdf)).status, `${m} ${p}`).toBe(404);
    // Arquivo do veículo A pelas rotas do texto do veículo B: 404.
    expect((await req(`${ROTA(b.t, b.id)}/documentos/${arq}/perguntas`, { cookie: b.s.cookie, body: { pergunta: 'Qual o total?' } })).status).toBe(404);
    expect((await req(`${ROTA(b.t, b.id)}/documentos/${arq}/pdf`, { method: 'GET', cookie: b.s.cookie })).status).toBe(404);

    const rep = await cadastrar('Repórter Só');
    await seedMembro(a.t, rep.userId, 'reporter');
    for (const [m, p, body, pdf] of rotas.slice(0, 3)) expect((await pedir(m, p, rep.cookie, body, pdf)).status, `repórter ${m} ${p}`).toBe(403);
    expect((await req(`${ROTA(a.t, a.id)}/documentos/${arq}/pdf`, { method: 'GET', cookie: rep.cookie })).status).toBe(200);
  });
});

// ── revisão 2 (Codex, 03/11): o pedaço que a busca por sentido achou vai ao modelo; aspas simples na resposta ──────────

describe('revisão 2: o trecho certo e as aspas simples', () => {
  it('página longa: o pedaço achado pela busca por sentido (sem nenhuma palavra da pergunta) entra no pedido', () => {
    const longa = `${'Introdução sem nada de novo. '.repeat(400)}A elevação foi de 20% no período.${' Anexo técnico.'.repeat(400)}`;
    const ps = pedacosDaPagina(longa);
    const n = ps.findIndex((p) => p.includes('elevação foi de 20%'));
    expect(n).toBeGreaterThan(0);
    expect(trechoDaPagina(longa, ['aumento'])).not.toContain('elevação foi de 20%');
    const t = trechoDaPagina(longa, ['aumento'], 8000, [n]);
    expect(t).toContain('A elevação foi de 20% no período.');
    expect(t.length).toBeLessThanOrEqual(8000 + 20);
    // Palavras da pergunta a cada 1.000 caracteres do começo até perto do pedaço: a janela delas não engole o teto.
    const comPalavras = `${Array.from({ length: 12 }, () => `${'Texto sem nada. '.repeat(60)}O aumento consta. `).join('')}A elevação foi de 20% no período.${' Fim.'.repeat(800)}`;
    const m = pedacosDaPagina(comPalavras).findIndex((p) => p.includes('elevação foi de 20%'));
    const t2 = trechoDaPagina(comPalavras, ['aumento'], 8000, [m]);
    expect(t2).toContain('A elevação foi de 20% no período.');
    expect(t2).toContain('O aumento consta.');
    expect(t2.length).toBeLessThanOrEqual(8000 + 40);
  });

  it('citação inventada entre aspas simples tipográficas na resposta também é pega', () => {
    const paginas = [{ pagina: 1, texto: 'O relatório conclui que a coluna está presente.' }];
    expect(aspasForaDasPaginas('O relatório conclui: ‘faltou uma coluna’.', paginas)).toEqual(['faltou uma coluna']);
    expect(aspasForaDasPaginas('O relatório diz ‘a coluna está presente’.', paginas)).toEqual([]);
    expect(aspasForaDasPaginas('A d’água não é citação.', paginas)).toEqual([]);
    expect(aspasForaDasPaginas("O relatório conclui: 'faltou uma coluna'.", paginas)).toEqual(['faltou uma coluna']);
    expect(aspasForaDasPaginas("A caixa d'água e o pau d'arco não são citação.", paginas)).toEqual([]);
  });
});
