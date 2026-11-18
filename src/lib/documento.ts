import { extractText, getDocumentProxy } from 'unpdf';
import type { Env } from '../env';
import { novoId, registrarEvento } from './db';
import { chamarTexto } from './texto';
import { ErroMesa, lerTexto } from './mesa';
import { lerNumero, nomesDoTexto, type Idioma } from './apuracao';

// Pergunte ao documento (Fase 5 da Matéria): o PDF vai para o R2, o texto de cada página para o D1 (busca por palavra
// no FTS5) e, se ligada, para o índice `redacao-documentos` do Vectorize (busca por sentido, bge-m3, um namespace por
// arquivo). A resposta do modelo só aparece com a citação conferida por código: a página existe entre as buscadas e o
// trecho está nela, letra por letra. Sem citação que confira: "não encontrei no documento", com o que foi descartado.

export const PDF_MAX_BYTES = 20 * 1024 * 1024;
export const PAGINAS_MAX = 500;
const MODELO_EMBED = '@cf/baai/bge-m3';

const erro = (codigo: string, pt: string, en: string, status: 400 | 404 | 409 | 422 | 502 = 400) => new ErroMesa(codigo, pt, status, en);
const normal = (s: string) => s.replace(/\s+/g, ' ').trim();
const sha256 = async (b: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map((x) => x.toString(16).padStart(2, '0')).join('');

/** Busca por sentido: precisa do índice (`DOCS_VETOR`) e não estar desligada (`BUSCA_VETORIAL=desligada`, o e2e). */
export const vetorLigado = (env: Env) => !!env.DOCS_VETOR && env.BUSCA_VETORIAL !== 'desligada';

// ── envio e leitura ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Recebe o PDF: confere que é PDF e o tamanho (`null`: o corpo passou do teto e a leitura parou), guarda no R2 e põe na
 * fila para ler. O mesmo arquivo de novo: o de antes; se a leitura dele falhou, ela recomeça.
 */
export async function enviarPdf(env: Env, tenantId: string, textoId: string, por: string, nomeBruto: string, bytes: ArrayBuffer | null) {
  await lerTexto(env, tenantId, textoId);
  if (!bytes || bytes.byteLength > PDF_MAX_BYTES) throw erro('grande', 'O PDF passa de 20 MB. Divida o arquivo ou mande só as páginas que importam.', 'The PDF is over 20 MB. Split the file or send only the pages that matter.', 422);
  const cabeca = new TextDecoder().decode(new Uint8Array(bytes.slice(0, 1024)));
  if (!bytes.byteLength || !cabeca.includes('%PDF-')) throw erro('nao_pdf', 'Esse arquivo não é um PDF.', "That file isn't a PDF.", 422);
  const nome = (nomeBruto || 'documento.pdf').replace(/[\\/\r\n\t]+/g, ' ').trim().slice(0, 200) || 'documento.pdf';
  const hash = await sha256(bytes);
  const ja = await env.DB.prepare('SELECT id FROM arquivos WHERE texto_id = ? AND tenant_id = ? AND sha256 = ?').bind(textoId, tenantId, hash).first<{ id: string }>();
  if (ja) {
    await enfileirarArquivo(env, tenantId, ja.id, 'arquivo', true);
    return { id: ja.id, existia: true };
  }
  const id = novoId();
  const r2 = `documentos/${tenantId}/${id}.pdf`;
  await env.MEDIA.put(r2, bytes, { httpMetadata: { contentType: 'application/pdf' } });
  await env.DB.prepare("INSERT INTO arquivos (id, tenant_id, texto_id, tipo, nome, r2, bytes, sha256, por) VALUES (?, ?, ?, 'pdf', ?, ?, ?, ?, ?)")
    .bind(id, tenantId, textoId, nome, r2, bytes.byteLength, hash, por).run();
  await enfileirarArquivo(env, tenantId, id, 'arquivo');
  await registrarEvento(env, tenantId, 'materia.documento', 'texto', textoId, { arquivoId: id, nome, bytes: bytes.byteLength, por });
  return { id, existia: false };
}

/** Ninguém está com o arquivo: sem posse, ou com a posse vencida (o consumidor que a tinha morreu). */
export const SEM_DONO = "(processando_em IS NULL OR processando_em < datetime('now', '-10 minutes'))";
/**
 * "Lendo" sem mensagem viva: a posse venceu (o consumidor morreu), ou ninguém pegou o arquivo em 10 minutos depois de ele
 * entrar na fila (a mensagem se perdeu). O arquivo que acabou de entrar na fila e espera a vez não conta.
 */
const PERDIDO = `(processando_em < datetime('now', '-10 minutes') OR (processando_em IS NULL AND (fila_em IS NULL OR fila_em < strftime('%Y-%m-%d %H:%M:%f', 'now', '-10 minutes'))))`;

/**
 * Põe o arquivo (PDF ou áudio) na fila. `deNovo` (a pessoa mandou o mesmo arquivo): o que falhou volta a "lendo", e o
 * que ficou "lendo" sem mensagem viva volta para a fila; o que está na fila ou sendo lido fica como está. Só o pedido que
 * fez a troca manda a mensagem (`fila_em` é a marca dele); a fila não aceitou: só ele grava "falhou", com o motivo, e só
 * se ninguém pegou o arquivo nesse meio-tempo.
 */
export async function enfileirarArquivo(env: Env, tenantId: string, arquivoId: string, tipo: 'arquivo' | 'gravacao', deNovo = false) {
  const marca = await env.DB.prepare(
    `UPDATE arquivos SET estado = 'lendo', erro = NULL, processando_em = NULL, fila_em = strftime('%Y-%m-%d %H:%M:%f', 'now')
      WHERE id = ? AND tenant_id = ? AND ${deNovo ? `(estado = 'falhou' OR (estado = 'lendo' AND ${PERDIDO}))` : `estado = 'lendo' AND processando_em IS NULL AND fila_em IS NULL`}
      RETURNING fila_em`,
  ).bind(arquivoId, tenantId).first<{ fila_em: string }>();
  if (!marca) return;
  try {
    await env.MONITOR_QUEUE.send({ tipo, tenantId, arquivoId });
  } catch (e) {
    await env.DB.prepare(`UPDATE arquivos SET estado = 'falhou', erro = ? WHERE id = ? AND tenant_id = ? AND estado = 'lendo' AND processando_em IS NULL AND fila_em = ?`)
      .bind(`não entrou na fila (${String((e as Error).message ?? e).slice(0, 160)}); mande o arquivo de novo`, arquivoId, tenantId, marca.fila_em).run();
  }
}

/** Outra entrega da fila está com o arquivo: esta volta para a fila depois que a posse vencer (não é "feito"). */
export class ArquivoOcupado extends Error {}

/** Condição de posse para gravar páginas e trechos: só quem ainda tem a posse escreve (quem a perdeu não apaga o do outro). */
export const COM_POSSE = "EXISTS (SELECT 1 FROM arquivos WHERE id = ? AND tenant_id = ? AND estado = 'lendo' AND processando_em = ?)";

/**
 * Cron de 15 minutos: o arquivo "lendo" que ninguém lê há mais de 90 minutos (a posse venceu, ou entrou na fila e
 * ninguém pegou) passou de todas as entregas da fila (que esperam no máximo uns 35 minutos). Fica "falhou", com o
 * motivo, e mandar de novo recomeça: nada fica "lendo" para sempre, mesmo quando a fila desistiu sem gravar a falha.
 */
export async function encerrarArquivosParados(env: Env) {
  const r = await env.DB.prepare(
    `UPDATE arquivos SET estado = 'falhou', erro = 'a leitura parou sem terminar (a fila desistiu); mande o arquivo de novo', processando_em = NULL
      WHERE estado = 'lendo' AND (processando_em < datetime('now', '-90 minutes')
        OR (processando_em IS NULL AND COALESCE(fila_em, created_at) < strftime('%Y-%m-%d %H:%M:%f', 'now', '-90 minutes')))`,
  ).run();
  return r.meta.changes ?? 0;
}

/**
 * Pega o arquivo para processar: só um consumidor por vez (entrega duplicada da fila não lê o mesmo arquivo duas
 * vezes). A posse vence em 10 minutos (o consumidor que morreu no meio não prende o arquivo). `posse` é a hora em que
 * esta entrega pegou o arquivo: o fim (pronto ou falhou) só é gravado por quem ainda tem essa posse. `null`: o arquivo
 * já terminou (ou não existe); ocupado por outra entrega: `ArquivoOcupado`.
 */
export async function pegarArquivo(env: Env, tenantId: string, arquivoId: string, tipo: 'pdf' | 'audio') {
  const a = await env.DB.prepare(
    `UPDATE arquivos SET processando_em = datetime('now') WHERE id = ? AND tenant_id = ? AND tipo = ? AND estado = 'lendo' AND ${SEM_DONO}
        RETURNING r2, processando_em AS posse`,
  ).bind(arquivoId, tenantId, tipo).first<{ r2: string; posse: string }>();
  if (a) return a;
  const agora = await env.DB.prepare('SELECT estado FROM arquivos WHERE id = ? AND tenant_id = ? AND tipo = ?').bind(arquivoId, tenantId, tipo).first<{ estado: string }>();
  if (agora?.estado === 'lendo') throw new ArquivoOcupado('outra entrega da fila está lendo este arquivo');
  return null;
}
export const soltarArquivo = (env: Env, tenantId: string, arquivoId: string, posse: string) =>
  env.DB.prepare('UPDATE arquivos SET processando_em = NULL WHERE id = ? AND tenant_id = ? AND processando_em = ?').bind(arquivoId, tenantId, posse).run();

/** Teto do texto de uma página (o D1 guarda até 2 MB por linha): passou disso, não é página de documento. */
const PAGINA_MAX_CHARS = 500_000;

/** Texto de cada página do PDF (unpdf, sem worker: a leitura corre no próprio Worker, com teto de tempo). */
export async function paginasDoPdf(bytes: Uint8Array): Promise<string[]> {
  const pdf = await getDocumentProxy(bytes);
  if (pdf.numPages > PAGINAS_MAX) throw new Error(`o PDF tem ${pdf.numPages} páginas; o teto é ${PAGINAS_MAX}`);
  const lido = await Promise.race([
    extractText(pdf, { mergePages: false }),
    new Promise<never>((_, falha) => setTimeout(() => falha(new Error('a leitura do PDF passou de 2 minutos')), 120_000)),
  ]);
  return lido.text.map((p) => p.normalize('NFC').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim());
}

/** Fila: lê as páginas, grava texto e índice de palavras, tira entidades e totais e, se ligado, indexa por sentido. */
export async function processarArquivo(env: Env, tenantId: string, arquivoId: string) {
  const a = await pegarArquivo(env, tenantId, arquivoId, 'pdf');
  if (!a) return;
  try {
    await lerArquivo(env, tenantId, arquivoId, a.r2, a.posse);
  } catch (e) {
    await soltarArquivo(env, tenantId, arquivoId, a.posse);   // a fila tenta de novo (e, na última, o consumidor grava a falha)
    throw e;
  }
}

async function lerArquivo(env: Env, tenantId: string, arquivoId: string, r2: string, posse: string) {
  // Só quem ainda tem a posse grava o fim (pronto ou falhou), e só com o arquivo ainda "lendo".
  const falhou = (motivo: string) => env.DB.prepare("UPDATE arquivos SET estado = 'falhou', erro = ?, processando_em = NULL WHERE id = ? AND tenant_id = ? AND estado = 'lendo' AND processando_em = ?").bind(motivo.slice(0, 300), arquivoId, tenantId, posse).run();
  const obj = await env.MEDIA.get(r2);
  if (!obj) { await falhou('o arquivo sumiu do armazenamento'); return; }
  let paginas: string[];
  try {
    paginas = await paginasDoPdf(new Uint8Array(await obj.arrayBuffer()));
  } catch (e) {
    await falhou(`não deu para ler o PDF (${String((e as Error).message ?? e).slice(0, 200)})`);
    return;
  }
  if (!paginas.some((p) => p.length > 0)) { await falhou('o PDF não tem texto (página escaneada como imagem?)'); return; }
  const enorme = paginas.findIndex((p) => p.length > PAGINA_MAX_CHARS);
  if (enorme >= 0) { await falhou(`a página ${enorme + 1} tem texto demais para guardar (${paginas[enorme].length} caracteres)`); return; }

  // Cada escrita confere a posse: quem a perdeu no meio (a posse venceu e outra entrega pegou) não apaga nem mistura as
  // páginas de quem está lendo agora.
  const posseBinds = [arquivoId, tenantId, posse];
  const stmts = [
    env.DB.prepare(`DELETE FROM arquivo_paginas WHERE arquivo_id = ? AND tenant_id = ? AND ${COM_POSSE}`).bind(arquivoId, tenantId, ...posseBinds),
    env.DB.prepare(`DELETE FROM arquivo_paginas_fts WHERE arquivo_id = ? AND tenant_id = ? AND ${COM_POSSE}`).bind(arquivoId, tenantId, ...posseBinds),
  ];
  paginas.forEach((texto, i) => {
    stmts.push(env.DB.prepare(`INSERT OR REPLACE INTO arquivo_paginas (tenant_id, arquivo_id, pagina, texto) SELECT ?, ?, ?, ? WHERE ${COM_POSSE}`).bind(tenantId, arquivoId, i + 1, texto, ...posseBinds));
    stmts.push(env.DB.prepare(`INSERT INTO arquivo_paginas_fts (texto, arquivo_id, tenant_id, pagina) SELECT ?, ?, ?, ? WHERE ${COM_POSSE}`).bind(texto, arquivoId, tenantId, i + 1, ...posseBinds));
  });
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));

  let vetor: 'indexado' | 'desligado' | 'falhou' = 'desligado';
  if (vetorLigado(env)) {
    try {
      const pedacos = paginas.flatMap((texto, i) => pedacosDaPagina(texto).map((p, n) => ({ id: `${arquivoId}:${i + 1}:${n}`, pagina: i + 1, texto: p })));
      for (let i = 0; i < pedacos.length; i += 50) {
        const lote = pedacos.slice(i, i + 50);
        const r = await env.AI.run(MODELO_EMBED, { text: lote.map((p) => p.texto) }) as { data: number[][] };
        await env.DOCS_VETOR!.upsert(lote.map((p, j) => ({ id: p.id, values: r.data[j], namespace: arquivoId, metadata: { pagina: p.pagina } })));
      }
      vetor = 'indexado';
    } catch (e) {
      console.error('vetor do documento', arquivoId, String(e).slice(0, 200));
      vetor = 'falhou';
    }
  }
  const entidades = entidadesDasPaginas(paginas);
  await env.DB.prepare("UPDATE arquivos SET estado = 'pronto', erro = NULL, processando_em = NULL, paginas = ?, vetor = ?, entidades_json = ?, totais_json = ? WHERE id = ? AND tenant_id = ? AND estado = 'lendo' AND processando_em = ?")
    .bind(paginas.length, vetor, JSON.stringify(entidades), JSON.stringify(totaisDasPaginas(paginas)), arquivoId, tenantId, posse).run();
}

/** Pedaços de até ~1.000 caracteres por página, cortados em fim de frase, com um pouco de sobreposição. */
export function pedacosDaPagina(texto: string, max = 1000): string[] {
  const t = normal(texto);
  if (!t) return [];
  const frases = t.split(/(?<=[.!?;:])\s+/);
  const out: string[] = [];
  let atual = '';
  for (const f of frases) {
    if (atual && atual.length + f.length + 1 > max) { out.push(atual); atual = atual.slice(-150); }
    atual = atual ? `${atual} ${f}` : f;
    while (atual.length > max * 1.5) { out.push(atual.slice(0, max)); atual = atual.slice(max - 150); }
  }
  if (atual) out.push(atual);
  return out;
}

// ── entidades e totais (por código) ────────────────────────────────────────────────────────────────────────────

// "R$ 1.000,00" (com milhar) ou "R$ 1000" / "R$ 100,50" (sem): o número inteiro, nunca o começo dele.
const VALOR = /R\$\s?(\d{1,3}(?:\.\d{3})+(?:,\d+)?(?!\d|\.\d)|\d+(?:,\d+)?(?!\d|\.\d))(?:\s*(milh[\p{L}\p{M}]*|bilh[\p{L}\p{M}]*|mil)(?![\p{L}\p{M}]))?/giu;
const TEM_VALOR = new RegExp(VALOR.source, 'iu');   // sem /g: test() não guarda posição
const DATA = /\b(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{1,2} de (?:janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro) de \d{4})\b/gi;
const EMPRESA = /\b[\p{Lu}][\p{L}&.'’-]*(?:\s+[\p{Lu}&][\p{L}&.'’-]*)*\s+(?:Ltda\.?|S\.?\/?A\.?|ME|EPP|EIRELI)\b/gu;

const SIGLAS_DE_DOCUMENTO = new Set(['CPF', 'LTDA', 'EPP', 'ME', 'SA', 'RG', 'CEP', 'UF']);

export interface Entidade { valor: string; paginas: number[] }
export interface Entidades { pessoas: Entidade[]; empresas: Entidade[]; valores: Entidade[]; datas: Entidade[] }

export function entidadesDasPaginas(paginas: string[]): Entidades {
  const juntar = (lista: { valor: string; pagina: number }[]) => {
    const m = new Map<string, Set<number>>();
    for (const x of lista) m.set(x.valor, (m.get(x.valor) ?? new Set()).add(x.pagina));
    return [...m].map(([valor, ps]) => ({ valor, paginas: [...ps].sort((a, b) => a - b) })).slice(0, 200);
  };
  const em = (re: RegExp) => juntar(paginas.flatMap((texto, i) =>
    [...texto.matchAll(re)].map((m) => ({ valor: normal(m[0]), pagina: i + 1 })),
  ));
  const empresas = em(EMPRESA);
  const nomesEmpresa = new Set(empresas.map((e) => e.valor));
  // A sigla que rotula um identificador numérico não é o nome de uma pessoa ou instituição.
  const rotuloNumerico = /\b\p{Lu}{2,8}\b(?=[ \t]*[:#]?[ \t]*\d[\d./-]{6,}\d\b)/gu;
  const pessoas = nomesDoTexto(paginas.map((texto, i) => ({
    id: `p${i + 1}`,
    texto: texto.replace(rotuloNumerico, ''),
  })))
    .filter((n) => !SIGLAS_DE_DOCUMENTO.has(n.nome) && ![...nomesEmpresa].some((e) => e.includes(n.nome)))
    .map((n) => ({ valor: n.nome, paginas: [...new Set(n.mencoes.map((x) => Number(x.blocoId.slice(1))))].sort((a, b) => a - b) }))
    .slice(0, 200);
  return { pessoas, empresas, valores: em(VALOR), datas: em(DATA) };
}

/** Valores em reais de um trecho (pt), em reais. */
export function valoresEmReais(texto: string): { trecho: string; valor: number }[] {
  return [...texto.matchAll(VALOR)].map((m) => ({ trecho: m[0], valor: lerNumero(m[1], m[2], 'pt-BR' as Idioma).valor }));
}

/** Total de cada página: a linha "total" quando houver; senão, a soma dos valores da página (com dois ou mais). */
export function totaisDasPaginas(paginas: string[]): { pagina: number; valor: number; como: 'total' | 'soma' }[] {
  const out: { pagina: number; valor: number; como: 'total' | 'soma' }[] = [];
  paginas.forEach((t, i) => {
    const linhaTotal = t.split('\n').find((l) => /\btotal\b/i.test(l) && TEM_VALOR.test(l));
    if (linhaTotal) {
      const v = valoresEmReais(linhaTotal).at(-1);
      if (v) { out.push({ pagina: i + 1, valor: v.valor, como: 'total' }); return; }
    }
    const vs = valoresEmReais(t);
    if (vs.length >= 2) out.push({ pagina: i + 1, valor: vs.reduce((s, v) => s + v.valor, 0), como: 'soma' });
  });
  return out;
}

const TOTAL_NO_TEXTO = /\b(total|ao todo|somam|soma|somados|no total|in total|totaling|totalling)\b/i;

/**
 * Cruzamento com o texto: frase que diz um total em reais e o documento traz um total (ou soma) da mesma ordem de
 * grandeza, mas outro valor. Vira apontamento de conta, com a página. Só compara o que tem palavra de total na frase.
 */
export function cruzarComTexto(
  blocos: { id: string; texto: string }[],
  docs: { id: string; nome: string; totais: { pagina: number; valor: number; como: 'total' | 'soma' }[] }[],
  idioma: Idioma = 'pt-BR',
): { blocoId: string; inicio: number; trecho: string; explicacao: string; arquivoId: string; pagina: number }[] {
  const out: { blocoId: string; inicio: number; trecho: string; explicacao: string; arquivoId: string; pagina: number }[] = [];
  const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 });
  for (const b of blocos) {
    // A frase termina em . ! ?, mas não no ponto entre dígitos (R$ 1.000,00).
    for (const f of b.texto.matchAll(/(?:[^.!?]|(?<=\d)\.(?=\d))+[.!?]?/g)) {
      if (!TOTAL_NO_TEXTO.test(f[0])) continue;
      for (const v of valoresEmReais(f[0])) {
        const todos = docs.flatMap((d) => d.totais.map((t) => ({ ...t, doc: d })));
        if (!todos.length || todos.some((t) => Math.abs(t.valor - v.valor) <= Math.max(0.01, v.valor * 0.005))) continue;
        const perto = todos.find((t) => t.valor >= v.valor / 2 && t.valor <= v.valor * 2);
        if (!perto) continue;
        const inicio = (f.index ?? 0) + f[0].indexOf(v.trecho);
        out.push({
          blocoId: b.id, inicio, trecho: v.trecho, arquivoId: perto.doc.id, pagina: perto.pagina,
          explicacao: idioma === 'en'
            ? `${perto.doc.nome}, p. ${perto.pagina}: ${perto.como === 'total' ? 'the total is' : 'the amounts add up to'} ${fmt(perto.valor)}; the text says ${fmt(v.valor)}.`
            : `${perto.doc.nome}, p. ${perto.pagina}: ${perto.como === 'total' ? 'o total é' : 'os valores somam'} ${fmt(perto.valor)}; o texto diz ${fmt(v.valor)}.`,
        });
      }
    }
  }
  return out;
}

// ── perguntas ──────────────────────────────────────────────────────────────────────────────────────────────────

/** `pedacos`: os pedaços da página (índices de `pedacosDaPagina`) que a busca por sentido achou. */
interface Pagina { pagina: number; texto: string; pedacos?: number[] }

/** Busca híbrida: palavras (FTS5, sem acento) e, se ligada, sentido (Vectorize); as duas listas somadas por posição. */
export async function buscarPaginas(env: Env, tenantId: string, arquivoId: string, pergunta: string, k = 5): Promise<{ paginas: Pagina[]; busca: 'palavra' | 'palavra+sentido'; termos: string[]; aviso: string | null }> {
  const termos = [...new Set(pergunta.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])].slice(0, 20);
  const pontos = new Map<number, number>();
  const pedacos = new Map<number, number[]>();
  if (termos.length) {
    const consulta = termos.map((t) => `"${t}"`).join(' OR ');
    const { results } = await env.DB.prepare(
      'SELECT pagina FROM arquivo_paginas_fts WHERE arquivo_paginas_fts MATCH ? AND arquivo_id = ? AND tenant_id = ? ORDER BY rank LIMIT 8',
    ).bind(consulta, arquivoId, tenantId).all<{ pagina: number }>();
    results.forEach((r, i) => pontos.set(r.pagina, (pontos.get(r.pagina) ?? 0) + 1 / (60 + i)));
  }
  let busca: 'palavra' | 'palavra+sentido' = 'palavra';
  let aviso: string | null = null;
  const a = await env.DB.prepare('SELECT vetor FROM arquivos WHERE id = ? AND tenant_id = ?').bind(arquivoId, tenantId).first<{ vetor: string | null }>();
  if (vetorLigado(env) && a?.vetor === 'indexado') {
    try {
      const r = await env.AI.run(MODELO_EMBED, { text: [pergunta] }) as { data: number[][] };
      const q = await env.DOCS_VETOR!.query(r.data[0], { topK: 8, namespace: arquivoId, returnMetadata: 'indexed' });
      q.matches.forEach((m, i) => {
        const [, pg, n] = m.id.split(':');
        const p = Number((m.metadata as { pagina?: number } | undefined)?.pagina ?? pg);
        pontos.set(p, (pontos.get(p) ?? 0) + 1 / (60 + i));
        if (Number.isInteger(Number(n))) pedacos.set(p, [...(pedacos.get(p) ?? []), Number(n)]);
      });
      busca = 'palavra+sentido';
    } catch (e) {
      console.error('busca por sentido', arquivoId, String(e).slice(0, 200));
      aviso = `a busca por sentido falhou (${String((e as Error).message ?? e).slice(0, 120)}); só a busca por palavra rodou`;
    }
  }
  const escolhidas = [...pontos].sort((x, y) => y[1] - x[1]).slice(0, k).map(([p]) => p);
  if (!escolhidas.length) return { paginas: [], busca, termos, aviso };
  const { results } = await env.DB.prepare(`SELECT pagina, texto FROM arquivo_paginas WHERE arquivo_id = ? AND tenant_id = ? AND pagina IN (${escolhidas.map(() => '?').join(',')})`)
    .bind(arquivoId, tenantId, ...escolhidas).all<Pagina>();
  return { paginas: results.sort((x, y) => escolhidas.indexOf(x.pagina) - escolhidas.indexOf(y.pagina)).map((p) => ({ ...p, pedacos: pedacos.get(p.pagina) })), busca, termos, aviso };
}

/** Teto do texto de cada página no pedido ao modelo. */
const PAGINA_NO_PROMPT = 8000;

/**
 * O pedaço da página que vai ao modelo: a página inteira, se cabe; senão, janelas em volta dos pedaços que a busca por
 * sentido achou (primeiro) e de onde as palavras da pergunta aparecem (o trecho certo pode estar no fim de uma página
 * longa, sem nenhuma palavra da pergunta), juntas com "[…]". Com pedaços, o texto vai com os espaços juntos (como o
 * pedaço foi indexado); a conferência das citações não conta espaços.
 */
export function trechoDaPagina(bruto: string, termos: string[], max = PAGINA_NO_PROMPT, pedacos: number[] = []): string {
  if (bruto.length <= max) return bruto;
  const texto = pedacos.length ? normal(bruto) : bruto;
  if (texto.length <= max) return texto;
  // Sem acento e em minúsculas, letra por letra (mesmo comprimento: as posições valem no texto original).
  const plano = [...texto].map((ch) => (ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase() || ch)[0]).join('');
  const dosPedacos = pedacos.length ? (() => { const ps = pedacosDaPagina(bruto); return pedacos.map((n) => ps[n] ? texto.indexOf(ps[n]) + Math.floor(ps[n].length / 2) : -1).filter((i) => i >= 0); })() : [];
  const dosTermos = termos.flatMap((t) => { const out: number[] = []; let i = plano.indexOf(t); while (i >= 0 && out.length < 20) { out.push(i); i = plano.indexOf(t, i + t.length); } return out; });
  if (!dosPedacos.length && !dosTermos.length) return texto.slice(0, max);
  const raio = 1200;
  // Janelas das palavras juntas entre si; as do sentido, cada uma inteira à parte (não viram a ponta de uma janela
  // longa de palavras, que o teto cortaria antes de chegar nelas).
  const juntar = (ps: number[]) => ps.sort((a, b) => a - b).reduce<[number, number][]>((js, p) => {
    const [de, ate] = [Math.max(0, p - raio), Math.min(texto.length, p + raio)];
    const ultima = js.at(-1);
    if (ultima && de <= ultima[1]) ultima[1] = Math.max(ultima[1], ate); else js.push([de, ate]);
    return js;
  }, []);
  // O que a busca por sentido achou entra primeiro no teto; depois as palavras; na saída, na ordem da página.
  let resto = max;
  const escolhidas = [...juntar(dosPedacos), ...juntar(dosTermos)].flatMap(([de, ate]) => {
    if (resto <= 0) return [];
    const fim = Math.min(ate, de + resto);
    resto -= fim - de;
    return [[de, fim] as [number, number]];
  }).sort((a, b) => a[0] - b[0]);
  const cabem = escolhidas.reduce<[number, number][]>((js, [de, ate]) => {
    const ultima = js.at(-1);
    if (ultima && de <= ultima[1]) ultima[1] = Math.max(ultima[1], ate); else js.push([de, ate]);
    return js;
  }, []);
  let saida = '', usado = 0;
  for (const [de, ate] of cabem) {
    const parte = texto.slice(de, Math.min(ate, de + (max - usado)));
    if (!parte) break;
    saida += `${saida ? '\n[…]\n' : de > 0 ? '[…]\n' : ''}${parte}`;
    usado += parte.length;
    if (usado >= max) break;
  }
  return saida;
}

/**
 * Trechos entre aspas na resposta do modelo (duas palavras ou mais; aspas duplas, angulares ou simples tipográficas):
 * cada um tem de estar, literalmente, numa página lida.
 */
export function aspasForaDasPaginas(resposta: string, paginas: Pagina[]): string[] {
  const textos = paginas.map((p) => normal(p.texto));
  // Aspas simples retas só fora de palavra (o apóstrofo de "d'água" não abre citação).
  return [...resposta.matchAll(/[“"«]([^”"»“]+)[”"»]|‘([^‘’]+)’|(?<![\p{L}\p{N}])'([^'\n]+)'(?![\p{L}\p{N}])/gu)].map((m) => [m[0], m[1] ?? m[2] ?? m[3]] as const)
    .map((m) => m[1].trim().replace(/[.,;:!?…]+$/, ''))
    .filter((c) => c.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length >= 2)
    .filter((c) => !textos.some((t) => t.includes(normal(c))));
}

const SISTEMA = `PERGUNTA AO DOCUMENTO. Você lê páginas de um documento e responde a pergunta de um jornalista só com o que está nelas.
Responda em JSON: {"encontrou": true|false, "resposta": "uma ou duas frases, no idioma da pergunta", "citacoes": [{"pagina": número, "trecho": "cópia literal de um trecho da página"}]}.
Regras: cada citação é uma cópia exata, caractere por caractere, de um trecho de até 300 caracteres da página indicada; não resuma nem corrija o trecho. Se as páginas não respondem, "encontrou": false, "resposta": "" e "citacoes": []. Não use conhecimento de fora do documento.`;

export interface Citacao { pagina: number; trecho: string }

/** Confere cada citação: página entre as lidas e trecho literal nela (espaços normalizados). */
export function conferirCitacoes(citacoes: unknown, paginas: Pagina[]): { boas: Citacao[]; descartadas: (Citacao & { motivo: string })[] } {
  const boas: Citacao[] = [];
  const descartadas: (Citacao & { motivo: string })[] = [];
  for (const c of Array.isArray(citacoes) ? citacoes : []) {
    const pagina = Number((c as Citacao)?.pagina);
    const trecho = typeof (c as Citacao)?.trecho === 'string' ? (c as Citacao).trecho.trim() : '';
    if (!trecho) continue;
    const p = paginas.find((x) => x.pagina === pagina);
    if (!p) { descartadas.push({ pagina, trecho, motivo: 'pagina' }); continue; }
    if (trecho.length < 8 || !normal(p.texto).includes(normal(trecho))) { descartadas.push({ pagina, trecho, motivo: 'trecho' }); continue; }
    if (!boas.some((b) => b.pagina === pagina && b.trecho === trecho)) boas.push({ pagina, trecho });
  }
  return { boas, descartadas };
}

export async function perguntar(env: Env, tenantId: string, textoId: string, arquivoId: string, perguntaBruta: unknown, por: string) {
  await lerTexto(env, tenantId, textoId);
  const a = await env.DB.prepare('SELECT id, nome, estado FROM arquivos WHERE id = ? AND texto_id = ? AND tenant_id = ?').bind(arquivoId, textoId, tenantId).first<{ id: string; nome: string; estado: string }>();
  if (!a) throw erro('nao_encontrado', 'não encontrado', 'not found', 404);
  if (a.estado !== 'pronto') throw erro('nao_pronto', 'O documento ainda não foi lido (ou a leitura falhou).', "The document hasn't been read yet (or reading failed).", 409);
  const pergunta = typeof perguntaBruta === 'string' ? normal(perguntaBruta) : '';
  if (pergunta.length < 3 || pergunta.length > 500) throw erro('pergunta', 'Escreva a pergunta (até 500 caracteres).', 'Write the question (up to 500 characters).');

  const { paginas, busca, termos, aviso } = await buscarPaginas(env, tenantId, arquivoId, pergunta);
  let resposta: string | null = null, boas: Citacao[] = [], descartadas: (Citacao & { motivo: string })[] = [], custo = 0;
  // respondida | nao_encontrou | invalida (o modelo citou o que não está nas páginas, ou fugiu do formato) | falhou.
  let situacao: SituacaoPergunta = 'nao_encontrou';
  const id = novoId();
  const gravar = () => env.DB.prepare(
    'INSERT INTO perguntas (id, tenant_id, texto_id, arquivo_id, pergunta, resposta, citacoes_json, descartadas_json, encontrou, busca, custo_usd, por, situacao, aviso) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(id, tenantId, textoId, arquivoId, pergunta, resposta, JSON.stringify(resposta ? boas : []), JSON.stringify(descartadas), resposta ? 1 : 0, busca, custo, por, situacao, aviso).run();
  if (paginas.length) {
    const user = `${paginas.map((p) => `[p. ${p.pagina}]\n${trechoDaPagina(p.texto, termos, PAGINA_NO_PROMPT, p.pedacos)}`).join('\n\n')}\n\nPERGUNTA: ${pergunta}`;
    let r: Awaited<ReturnType<typeof chamarTexto>>;
    try {
      r = await chamarTexto(env, { tenantId, funcao: 'pergunta_documento' }, SISTEMA, user);
    } catch (e) {
      console.error('pergunta ao documento', arquivoId, String(e).slice(0, 200));
      // A tentativa fica no histórico (e no pacote de defesa), com a falha.
      situacao = 'falhou';
      await gravar();
      if (e instanceof ErroMesa && e.codigo === 'sem_chave_texto') throw e;
      throw erro('modelo', 'O modelo não respondeu agora: a pergunta ficou sem resposta conferida. Tente de novo.', "The model didn't respond: the question has no checked answer. Try again.", 502);
    }
    custo = r.custoUsd;
    const j = (r.json ?? {}) as { encontrou?: unknown; resposta?: unknown; citacoes?: unknown };
    ({ boas, descartadas } = conferirCitacoes(j.citacoes, paginas));
    if (typeof j.encontrou !== 'boolean' || !Array.isArray(j.citacoes)) situacao = 'invalida';
    else if (j.encontrou === true && boas.length && typeof j.resposta === 'string' && j.resposta.trim()) {
      // A resposta também é do modelo: trecho entre aspas nela tem de estar, letra por letra, numa página lida.
      const inventadas = aspasForaDasPaginas(j.resposta, paginas);
      if (inventadas.length) {
        situacao = 'invalida';
        descartadas.push(...inventadas.map((trecho) => ({ pagina: 0, trecho, motivo: 'resposta' })));
      } else {
        resposta = j.resposta.trim().slice(0, 600);
        situacao = 'respondida';
      }
    } else if (j.encontrou === true) situacao = 'invalida';   // disse que achou, mas nenhuma citação conferiu
  }
  await gravar();
  return { id, pergunta, resposta, citacoes: resposta ? boas : [], descartadas, encontrou: !!resposta, busca, situacao, aviso };
}

export type SituacaoPergunta = 'respondida' | 'nao_encontrou' | 'invalida' | 'falhou';

// ── listas e o trecho que vira evidência ───────────────────────────────────────────────────────────────────────

function lerEntidades(json: string | null): Entidades | null {
  if (!json) return null;
  const { pessoas, empresas, valores, datas } = JSON.parse(json) as Entidades;
  return { pessoas, empresas, valores, datas };
}

export async function arquivosDoTexto(env: Env, tenantId: string, textoId: string) {
  const { results } = await env.DB.prepare(
    `SELECT id, tipo, nome, bytes, estado, erro, paginas, vetor, entidades_json, created_at FROM arquivos WHERE texto_id = ? AND tenant_id = ? AND tipo = 'pdf' ORDER BY created_at, rowid`,
  ).bind(textoId, tenantId).all<{ id: string; tipo: string; nome: string; bytes: number; estado: string; erro: string | null; paginas: number | null; vetor: string | null; entidades_json: string | null; created_at: string }>();
  const { results: ps } = await env.DB.prepare(
    `SELECT id, arquivo_id, pergunta, resposta, citacoes_json, descartadas_json, encontrou, busca, situacao, aviso, created_at FROM perguntas WHERE texto_id = ? AND tenant_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 100`,
  ).bind(textoId, tenantId).all<{ id: string; arquivo_id: string; pergunta: string; resposta: string | null; citacoes_json: string; descartadas_json: string; encontrou: number; busca: string; situacao: string | null; aviso: string | null; created_at: string }>();
  return results.map((a) => ({
    id: a.id, nome: a.nome, bytes: a.bytes, estado: a.estado as 'lendo' | 'pronto' | 'falhou', erro: a.erro, paginas: a.paginas, vetor: a.vetor, criadoEm: a.created_at,
    entidades: lerEntidades(a.entidades_json),
    perguntas: ps.filter((p) => p.arquivo_id === a.id).map((p) => ({
      id: p.id, pergunta: p.pergunta, resposta: p.resposta, citacoes: JSON.parse(p.citacoes_json) as Citacao[], descartadas: (JSON.parse(p.descartadas_json) as unknown[]).length,
      encontrou: p.encontrou === 1, busca: p.busca, em: p.created_at,
      situacao: (p.situacao ?? (p.encontrou === 1 ? 'respondida' : 'nao_encontrou')) as SituacaoPergunta, aviso: p.aviso,
    })),
  }));
}

/** O trecho citado vira evidência: a página inteira entra no dossiê (a conferência cita dela), presa ao arquivo. */
export async function trechoParaEvidencia(env: Env, tenantId: string, textoId: string, arquivoId: string, b: Record<string, unknown>) {
  await lerTexto(env, tenantId, textoId);
  const a = await env.DB.prepare('SELECT nome FROM arquivos WHERE id = ? AND texto_id = ? AND tenant_id = ?').bind(arquivoId, textoId, tenantId).first<{ nome: string }>();
  if (!a) throw erro('nao_encontrado', 'não encontrado', 'not found', 404);
  const pagina = Number(b.pagina);
  const p = Number.isInteger(pagina) ? await env.DB.prepare('SELECT texto FROM arquivo_paginas WHERE arquivo_id = ? AND tenant_id = ? AND pagina = ?').bind(arquivoId, tenantId, pagina).first<{ texto: string }>() : null;
  if (!p) throw erro('pagina', 'Essa página não existe no documento.', "That page doesn't exist in the document.", 422);
  if (typeof b.trecho !== 'string' || b.trecho.trim().length < 8 || !normal(p.texto).includes(normal(b.trecho))) {
    throw erro('trecho_fora', 'Esse trecho não está na página. Copie de novo do documento.', "That passage isn't on the page. Copy it again from the document.", 422);
  }
  const url = `documento:${arquivoId}#p${pagina}`;
  const ja = await env.DB.prepare('SELECT id FROM evidencias WHERE texto_id = ? AND tenant_id = ? AND url = ?').bind(textoId, tenantId, url).first<{ id: string }>();
  if (ja) return { id: ja.id, existia: true };
  const id = novoId();
  const chave = `evidencias/${tenantId}/${id}.txt`;
  await env.MEDIA.put(chave, p.texto, { httpMetadata: { contentType: 'text/plain; charset=utf-8' } });
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(p.texto)))].map((x) => x.toString(16).padStart(2, '0')).join('');
  await env.DB.batch([
    env.DB.prepare("INSERT INTO evidencias (id, tenant_id, texto_id, url, titulo, r2_texto, hash, hash_atual, origem) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'documento')")
      .bind(id, tenantId, textoId, url, `${a.nome}, p. ${pagina}`.slice(0, 300), chave, hash, hash),
    env.DB.prepare("UPDATE textos SET updated_at = datetime('now') WHERE id = ? AND tenant_id = ?").bind(textoId, tenantId),
  ]);
  return { id, existia: false };
}
