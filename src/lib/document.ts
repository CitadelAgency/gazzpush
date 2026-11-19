import { extractText, getDocumentProxy } from 'unpdf';
import type { Env } from '../env';
import { newId, recordEvent } from './db';
import { callText } from './textModel';
import { DeskError, readText } from './desk';
import { readNumber, fromTextNames, type Language } from './reporting';

// Ask the document (Story phase 5): the PDF goes to R2, each page's text to D1 (word search in FTS5) and, if enabled,
// to the `redacao-documentos` Vectorize index (semantic search, bge-m3, one namespace per file). The model's answer only
// shows with a citation checked by code: the page exists among those searched and the passage is on it, letter for
// letter. Without a citation that checks out: "not found in the document", with what was discarded.

export const PDF_MAX_BYTES = 20 * 1024 * 1024;
export const PAGES_MAX = 500;
const EMBED_MODEL = '@cf/baai/bge-m3';

const error = (code: string, pt: string, en: string, status: 400 | 404 | 409 | 422 | 502 = 400) => new DeskError(code, pt, status, en);
const normal = (s: string) => s.replace(/\s+/g, ' ').trim();
const sha256 = async (b: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map((x) => x.toString(16).padStart(2, '0')).join('');

/** Semantic search: needs the index (`DOCS_VETOR`) and must not be switched off (`BUSCA_VETORIAL=desligada`, the e2e). */
export const vectorOn = (env: Env) => !!env.DOCS_VETOR && env.BUSCA_VETORIAL !== 'desligada';

// ── envio e leitura ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Receives the PDF: checks that it is a PDF and its size (`null`: the body went over the cap and reading stopped),
 * stores it in R2 and queues it for reading. The same file again: the earlier one; if its reading failed, it starts over.
 */
export async function sendPdf(env: Env, tenantId: string, textId: string, actor: string, rawName: string, bytes: ArrayBuffer | null) {
  await readText(env, tenantId, textId);
  if (!bytes || bytes.byteLength > PDF_MAX_BYTES) throw error('grande', 'O PDF passa de 20 MB. Divida o arquivo ou mande só as páginas que importam.', 'The PDF is over 20 MB. Split the file or send only the pages that matter.', 422);
  const head = new TextDecoder().decode(new Uint8Array(bytes.slice(0, 1024)));
  if (!bytes.byteLength || !head.includes('%PDF-')) throw error('nao_pdf', 'Esse arquivo não é um PDF.', "That file isn't a PDF.", 422);
  const name = (rawName || 'documento.pdf').replace(/[\\/\r\n\t]+/g, ' ').trim().slice(0, 200) || 'documento.pdf';
  const hash = await sha256(bytes);
  const already = await env.DB.prepare('SELECT id FROM arquivos WHERE texto_id = ? AND tenant_id = ? AND sha256 = ?').bind(textId, tenantId, hash).first<{ id: string }>();
  if (already) {
    await enqueueFile(env, tenantId, already.id, 'arquivo', true);
    return { id: already.id, existia: true };
  }
  const id = newId();
  const r2 = `documentos/${tenantId}/${id}.pdf`;
  await env.MEDIA.put(r2, bytes, { httpMetadata: { contentType: 'application/pdf' } });
  await env.DB.prepare("INSERT INTO arquivos (id, tenant_id, texto_id, tipo, nome, r2, bytes, sha256, por) VALUES (?, ?, ?, 'pdf', ?, ?, ?, ?, ?)")
    .bind(id, tenantId, textId, name, r2, bytes.byteLength, hash, actor).run();
  await enqueueFile(env, tenantId, id, 'arquivo');
  await recordEvent(env, tenantId, 'materia.documento', 'texto', textId, { arquivoId: id, nome: name, bytes: bytes.byteLength, por: actor });
  return { id, existia: false };
}

/** Nobody holds the file: no ownership, or expired ownership (the consumer that had it died). */
export const WITHOUT_OWNER = "(processando_em IS NULL OR processando_em < datetime('now', '-10 minutes'))";
/**
 * "Lendo" without a live message: ownership expired (the consumer died), or nobody picked the file up within 10 minutes
 * of it being queued (the message was lost). A file that was just queued and is waiting its turn does not count.
 */
const LOST = `(processando_em < datetime('now', '-10 minutes') OR (processando_em IS NULL AND (fila_em IS NULL OR fila_em < strftime('%Y-%m-%d %H:%M:%f', 'now', '-10 minutes'))))`;

/**
 * Queues the file (PDF or audio). `newOf` (the person sent the same file): a failed one goes back to "lendo", and one
 * left "lendo" without a live message goes back to the queue; one queued or being read stays as is. Only the request
 * that made the switch sends the message (`fila_em` is its marker); if the queue did not accept it, only that request
 * records "falhou", with the reason, and only if nobody picked the file up in the meantime.
 */
export async function enqueueFile(env: Env, tenantId: string, fileId: string, type: 'arquivo' | 'gravacao', newOf = false) {
  const brand = await env.DB.prepare(
    `UPDATE arquivos SET estado = 'lendo', erro = NULL, processando_em = NULL, fila_em = strftime('%Y-%m-%d %H:%M:%f', 'now')
      WHERE id = ? AND tenant_id = ? AND ${newOf ? `(estado = 'falhou' OR (estado = 'lendo' AND ${LOST}))` : `estado = 'lendo' AND processando_em IS NULL AND fila_em IS NULL`}
      RETURNING fila_em`,
  ).bind(fileId, tenantId).first<{ fila_em: string }>();
  if (!brand) return;
  try {
    await env.MONITOR_QUEUE.send({ tipo: type, tenantId, arquivoId: fileId });
  } catch (e) {
    await env.DB.prepare(`UPDATE arquivos SET estado = 'falhou', erro = ? WHERE id = ? AND tenant_id = ? AND estado = 'lendo' AND processando_em IS NULL AND fila_em = ?`)
      .bind(`não entrou na fila (${String((e as Error).message ?? e).slice(0, 160)}); mande o arquivo de novo`, fileId, tenantId, brand.fila_em).run();
  }
}

/** Another queue delivery holds the file: this one goes back to the queue once ownership expires (it is not "done"). */
export class BusyFile extends Error {}

/** Ownership condition for writing pages and passages: only the current owner writes (whoever lost it does not delete the other's). */
export const WITH_LEASE = "EXISTS (SELECT 1 FROM arquivos WHERE id = ? AND tenant_id = ? AND estado = 'lendo' AND processando_em = ?)";

/**
 * 15-minute cron: a "lendo" file nobody has been reading for over 90 minutes (ownership expired, or it was queued and
 * nobody picked it up) has outlived every queue delivery (which wait about 35 minutes at most). It becomes "falhou", with
 * the reason, and sending it again starts over: nothing stays "lendo" forever, even when the queue gave up without
 * recording the failure.
 */
export async function closeFilesStopped(env: Env) {
  const r = await env.DB.prepare(
    `UPDATE arquivos SET estado = 'falhou', erro = 'a leitura parou sem terminar (a fila desistiu); mande o arquivo de novo', processando_em = NULL
      WHERE estado = 'lendo' AND (processando_em < datetime('now', '-90 minutes')
        OR (processando_em IS NULL AND COALESCE(fila_em, created_at) < strftime('%Y-%m-%d %H:%M:%f', 'now', '-90 minutes')))`,
  ).run();
  return r.meta.changes ?? 0;
}

/**
 * Takes the file for processing: only one consumer at a time (a duplicate queue delivery does not read the same file
 * twice). Ownership expires in 10 minutes (a consumer that died midway does not hold the file). `posse` is the time this
 * delivery took the file: the end (ready or failed) is only recorded by whoever still has that ownership. `null`: the
 * file already finished (or does not exist); held by another delivery: `BusyFile`.
 */
export async function takeFile(env: Env, tenantId: string, fileId: string, type: 'pdf' | 'audio') {
  const a = await env.DB.prepare(
    `UPDATE arquivos SET processando_em = datetime('now') WHERE id = ? AND tenant_id = ? AND tipo = ? AND estado = 'lendo' AND ${WITHOUT_OWNER}
        RETURNING r2, processando_em AS posse`,
  ).bind(fileId, tenantId, type).first<{ r2: string; posse: string }>();
  if (a) return a;
  const now = await env.DB.prepare('SELECT estado FROM arquivos WHERE id = ? AND tenant_id = ? AND tipo = ?').bind(fileId, tenantId, type).first<{ estado: string }>();
  if (now?.estado === 'lendo') throw new BusyFile('outra entrega da fila está lendo este arquivo');
  return null;
}
export const releaseFile = (env: Env, tenantId: string, fileId: string, lease: string) =>
  env.DB.prepare('UPDATE arquivos SET processando_em = NULL WHERE id = ? AND tenant_id = ? AND processando_em = ?').bind(fileId, tenantId, lease).run();

/** Cap on one page's text (D1 stores up to 2 MB per row): past that, it is not a document page. */
const MAX_CHARS_PAGE = 500_000;

/** Text of each PDF page (unpdf, no worker: reading runs in the Worker itself, with a time cap). */
export async function pagesPdf(bytes: Uint8Array): Promise<string[]> {
  const pdf = await getDocumentProxy(bytes);
  if (pdf.numPages > PAGES_MAX) throw new Error(`o PDF tem ${pdf.numPages} páginas; o teto é ${PAGES_MAX}`);
  const read = await Promise.race([
    extractText(pdf, { mergePages: false }),
    new Promise<never>((_, failure) => setTimeout(() => failure(new Error('a leitura do PDF passou de 2 minutos')), 120_000)),
  ]);
  return read.text.map((p) => p.normalize('NFC').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim());
}

/** Queue: reads the pages, stores text and the word index, extracts entities and totals and, if enabled, indexes semantically. */
export async function processFile(env: Env, tenantId: string, fileId: string) {
  const a = await takeFile(env, tenantId, fileId, 'pdf');
  if (!a) return;
  try {
    await readFile(env, tenantId, fileId, a.r2, a.posse);
  } catch (e) {
    await releaseFile(env, tenantId, fileId, a.posse);   // the queue retries (and, on the last attempt, the consumer records the failure)
    throw e;
  }
}

async function readFile(env: Env, tenantId: string, fileId: string, r2: string, lease: string) {
  // Only the current owner records the end (ready or failed), and only with the file still "lendo".
  const failed = (reason: string) => env.DB.prepare("UPDATE arquivos SET estado = 'falhou', erro = ?, processando_em = NULL WHERE id = ? AND tenant_id = ? AND estado = 'lendo' AND processando_em = ?").bind(reason.slice(0, 300), fileId, tenantId, lease).run();
  const obj = await env.MEDIA.get(r2);
  if (!obj) { await failed('o arquivo sumiu do armazenamento'); return; }
  let pages: string[];
  try {
    pages = await pagesPdf(new Uint8Array(await obj.arrayBuffer()));
  } catch (e) {
    await failed(`não deu para ler o PDF (${String((e as Error).message ?? e).slice(0, 200)})`);
    return;
  }
  if (!pages.some((p) => p.length > 0)) { await failed('o PDF não tem texto (página escaneada como imagem?)'); return; }
  const huge = pages.findIndex((p) => p.length > MAX_CHARS_PAGE);
  if (huge >= 0) { await failed(`a página ${huge + 1} tem texto demais para guardar (${pages[huge].length} caracteres)`); return; }

  // Each write checks ownership: whoever lost it midway (ownership expired and another delivery took it) neither deletes
  // nor mixes in the pages of whoever is reading now.
  const leaseBinds = [fileId, tenantId, lease];
  const stmts = [
    env.DB.prepare(`DELETE FROM arquivo_paginas WHERE arquivo_id = ? AND tenant_id = ? AND ${WITH_LEASE}`).bind(fileId, tenantId, ...leaseBinds),
    env.DB.prepare(`DELETE FROM arquivo_paginas_fts WHERE arquivo_id = ? AND tenant_id = ? AND ${WITH_LEASE}`).bind(fileId, tenantId, ...leaseBinds),
  ];
  pages.forEach((text, i) => {
    stmts.push(env.DB.prepare(`INSERT OR REPLACE INTO arquivo_paginas (tenant_id, arquivo_id, pagina, texto) SELECT ?, ?, ?, ? WHERE ${WITH_LEASE}`).bind(tenantId, fileId, i + 1, text, ...leaseBinds));
    stmts.push(env.DB.prepare(`INSERT INTO arquivo_paginas_fts (texto, arquivo_id, tenant_id, pagina) SELECT ?, ?, ?, ? WHERE ${WITH_LEASE}`).bind(text, fileId, tenantId, i + 1, ...leaseBinds));
  });
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));

  let vector: 'indexado' | 'desligado' | 'falhou' = 'desligado';
  if (vectorOn(env)) {
    try {
      const chunks = pages.flatMap((text, i) => chunksPage(text).map((p, n) => ({ id: `${fileId}:${i + 1}:${n}`, pagina: i + 1, texto: p })));
      for (let i = 0; i < chunks.length; i += 50) {
        const batch = chunks.slice(i, i + 50);
        const r = await env.AI.run(EMBED_MODEL, { text: batch.map((p) => p.texto) }) as { data: number[][] };
        await env.DOCS_VETOR!.upsert(batch.map((p, j) => ({ id: p.id, values: r.data[j], namespace: fileId, metadata: { pagina: p.pagina } })));
      }
      vector = 'indexado';
    } catch (e) {
      console.error('document vector', fileId, String(e).slice(0, 200));
      vector = 'falhou';
    }
  }
  const entities = entitiesPages(pages);
  await env.DB.prepare("UPDATE arquivos SET estado = 'pronto', erro = NULL, processando_em = NULL, paginas = ?, vetor = ?, entidades_json = ?, totais_json = ? WHERE id = ? AND tenant_id = ? AND estado = 'lendo' AND processando_em = ?")
    .bind(pages.length, vector, JSON.stringify(entities), JSON.stringify(totalsPages(pages)), fileId, tenantId, lease).run();
}

/** Chunks of up to ~1,000 characters per page, cut at sentence ends, with a little overlap. */
export function chunksPage(text: string, max = 1000): string[] {
  const t = normal(text);
  if (!t) return [];
  const sentences = t.split(/(?<=[.!?;:])\s+/);
  const out: string[] = [];
  let current = '';
  for (const f of sentences) {
    if (current && current.length + f.length + 1 > max) { out.push(current); current = current.slice(-150); }
    current = current ? `${current} ${f}` : f;
    while (current.length > max * 1.5) { out.push(current.slice(0, max)); current = current.slice(max - 150); }
  }
  if (current) out.push(current);
  return out;
}

// ── entities and totals (by code) ──────────────────────────────────────────────────────────────────────────────

/** A CNPJ with the right check digits. */
export function validCnpj(c: string): boolean {
  const d = c.replace(/\D/g, '');
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const dv = (n: number) => {
    const weights = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = weights.reduce((acc, p, i) => acc + p * Number(d[i]), 0) % 11;
    return s < 2 ? 0 : 11 - s;
  };
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
}

// "R$ 1.000,00" (with thousands) or "R$ 1000" / "R$ 100,50" (without): the whole number, never its beginning.
const VALUE = /R\$\s?(\d{1,3}(?:\.\d{3})+(?:,\d+)?(?!\d|\.\d)|\d+(?:,\d+)?(?!\d|\.\d))(?:\s*(milh[\p{L}\p{M}]*|bilh[\p{L}\p{M}]*|mil)(?![\p{L}\p{M}]))?/giu;
const HAS_VALUE = new RegExp(VALUE.source, 'iu');   // no /g: test() keeps no position
const DATE = /\b(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{1,2} de (?:janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro) de \d{4})\b/gi;
const CNPJ = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
const COMPANY = /\b[\p{Lu}][\p{L}&.'’-]*(?:\s+[\p{Lu}&][\p{L}&.'’-]*)*\s+(?:Ltda\.?|S\.?\/?A\.?|ME|EPP|EIRELI)\b/gu;

const ACRONYMS_DOCUMENT = new Set(['CNPJ', 'CPF', 'LTDA', 'EPP', 'ME', 'SA', 'RG', 'CEP', 'UF']);

export interface Entity { valor: string; paginas: number[] }
export interface Entities { pessoas: Entity[]; empresas: Entity[]; cnpjs: Entity[]; valores: Entity[]; datas: Entity[] }

export function entitiesPages(pages: string[]): Entities {
  const join = (list: { valor: string; pagina: number }[]) => {
    const m = new Map<string, Set<number>>();
    for (const x of list) m.set(x.valor, (m.get(x.valor) ?? new Set()).add(x.pagina));
    return [...m].map(([value, ps]) => ({ valor: value, paginas: [...ps].sort((a, b) => a - b) })).slice(0, 200);
  };
  const at = (re: RegExp, filter: (s: string) => boolean = () => true) => join(pages.flatMap((t, i) => [...t.matchAll(re)].map((m) => normal(m[0])).filter(filter).map((value) => ({ valor: value, pagina: i + 1 }))));
  const companies = at(COMPANY);
  const companyNames = new Set(companies.map((e) => e.valor));
  const people = fromTextNames(pages.map((text, i) => ({ id: `p${i + 1}`, texto: text })))
    .filter((n) => !ACRONYMS_DOCUMENT.has(n.nome) && ![...companyNames].some((e) => e.includes(n.nome)))
    .map((n) => ({ valor: n.nome, paginas: [...new Set(n.mencoes.map((x) => Number(x.blocoId.slice(1))))].sort((a, b) => a - b) }))
    .slice(0, 200);
  return { pessoas: people, empresas: companies, cnpjs: at(CNPJ, validCnpj), valores: at(VALUE), datas: at(DATE) };
}

/** Amounts in reais in a passage (pt), in reais. */
export function valuesInReal(text: string): { trecho: string; valor: number }[] {
  return [...text.matchAll(VALUE)].map((m) => ({ trecho: m[0], valor: readNumber(m[1], m[2], 'pt-BR' as Language).valor }));
}

/** Each page's total: the "total" line when there is one; otherwise, the sum of the page's amounts (with two or more). */
export function totalsPages(pages: string[]): { pagina: number; valor: number; como: 'total' | 'soma' }[] {
  const out: { pagina: number; valor: number; como: 'total' | 'soma' }[] = [];
  pages.forEach((t, i) => {
    const totalLine = t.split('\n').find((l) => /\btotal\b/i.test(l) && HAS_VALUE.test(l));
    if (totalLine) {
      const v = valuesInReal(totalLine).at(-1);
      if (v) { out.push({ pagina: i + 1, valor: v.valor, como: 'total' }); return; }
    }
    const vs = valuesInReal(t);
    if (vs.length >= 2) out.push({ pagina: i + 1, valor: vs.reduce((s, v) => s + v.valor, 0), como: 'soma' });
  });
  return out;
}

const IN_TEXT_TOTAL = /\b(total|ao todo|somam|soma|somados|no total|in total|totaling|totalling)\b/i;

/**
 * Cross-check with the text: a sentence that states a total in reais while the document has a total (or sum) of the
 * same order of magnitude but a different value. It becomes an arithmetic finding, with the page. It only compares when
 * the sentence has a word for total.
 */
export function crossWithText(
  blocks: { id: string; texto: string }[],
  docs: { id: string; nome: string; totais: { pagina: number; valor: number; como: 'total' | 'soma' }[] }[],
  language: Language = 'pt-BR',
): { blocoId: string; inicio: number; trecho: string; explicacao: string; arquivoId: string; pagina: number }[] {
  const out: { blocoId: string; inicio: number; trecho: string; explicacao: string; arquivoId: string; pagina: number }[] = [];
  const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 });
  for (const b of blocks) {
    // A sentence ends in . ! ?, but not at a dot between digits (R$ 1.000,00).
    for (const f of b.texto.matchAll(/(?:[^.!?]|(?<=\d)\.(?=\d))+[.!?]?/g)) {
      if (!IN_TEXT_TOTAL.test(f[0])) continue;
      for (const v of valuesInReal(f[0])) {
        const all = docs.flatMap((d) => d.totais.map((t) => ({ ...t, doc: d })));
        if (!all.length || all.some((t) => Math.abs(t.valor - v.valor) <= Math.max(0.01, v.valor * 0.005))) continue;
        const near = all.find((t) => t.valor >= v.valor / 2 && t.valor <= v.valor * 2);
        if (!near) continue;
        const home = (f.index ?? 0) + f[0].indexOf(v.trecho);
        out.push({
          blocoId: b.id, inicio: home, trecho: v.trecho, arquivoId: near.doc.id, pagina: near.pagina,
          explicacao: language === 'en'
            ? `${near.doc.nome}, p. ${near.pagina}: ${near.como === 'total' ? 'the total is' : 'the amounts add up to'} ${fmt(near.valor)}; the text says ${fmt(v.valor)}.`
            : `${near.doc.nome}, p. ${near.pagina}: ${near.como === 'total' ? 'o total é' : 'os valores somam'} ${fmt(near.valor)}; o texto diz ${fmt(v.valor)}.`,
        });
      }
    }
  }
  return out;
}

// ── perguntas ──────────────────────────────────────────────────────────────────────────────────────────────────

/** `pedacos`: the page chunks (indices from `chunksPage`) that semantic search found. */
interface Page { pagina: number; texto: string; pedacos?: number[] }

/** Hybrid search: words (FTS5, accent-insensitive) and, if enabled, meaning (Vectorize); the two lists merged by rank. */
export async function fetchPages(env: Env, tenantId: string, fileId: string, question: string, k = 5): Promise<{ paginas: Page[]; busca: 'palavra' | 'palavra+sentido'; termos: string[]; aviso: string | null }> {
  const terms = [...new Set(question.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])].slice(0, 20);
  const points = new Map<number, number>();
  const chunks = new Map<number, number[]>();
  if (terms.length) {
    const query = terms.map((t) => `"${t}"`).join(' OR ');
    const { results } = await env.DB.prepare(
      'SELECT pagina FROM arquivo_paginas_fts WHERE arquivo_paginas_fts MATCH ? AND arquivo_id = ? AND tenant_id = ? ORDER BY rank LIMIT 8',
    ).bind(query, fileId, tenantId).all<{ pagina: number }>();
    results.forEach((r, i) => points.set(r.pagina, (points.get(r.pagina) ?? 0) + 1 / (60 + i)));
  }
  let search: 'palavra' | 'palavra+sentido' = 'palavra';
  let warning: string | null = null;
  const a = await env.DB.prepare('SELECT vetor FROM arquivos WHERE id = ? AND tenant_id = ?').bind(fileId, tenantId).first<{ vetor: string | null }>();
  if (vectorOn(env) && a?.vetor === 'indexado') {
    try {
      const r = await env.AI.run(EMBED_MODEL, { text: [question] }) as { data: number[][] };
      const q = await env.DOCS_VETOR!.query(r.data[0], { topK: 8, namespace: fileId, returnMetadata: 'indexed' });
      q.matches.forEach((m, i) => {
        const [, pg, n] = m.id.split(':');
        const p = Number((m.metadata as { pagina?: number } | undefined)?.pagina ?? pg);
        points.set(p, (points.get(p) ?? 0) + 1 / (60 + i));
        if (Number.isInteger(Number(n))) chunks.set(p, [...(chunks.get(p) ?? []), Number(n)]);
      });
      search = 'palavra+sentido';
    } catch (e) {
      console.error('busca por sentido', fileId, String(e).slice(0, 200));
      warning = `a busca por sentido falhou (${String((e as Error).message ?? e).slice(0, 120)}); só a busca por palavra rodou`;
    }
  }
  const chosen = [...points].sort((x, y) => y[1] - x[1]).slice(0, k).map(([p]) => p);
  if (!chosen.length) return { paginas: [], busca: search, termos: terms, aviso: warning };
  const { results } = await env.DB.prepare(`SELECT pagina, texto FROM arquivo_paginas WHERE arquivo_id = ? AND tenant_id = ? AND pagina IN (${chosen.map(() => '?').join(',')})`)
    .bind(fileId, tenantId, ...chosen).all<Page>();
  return { paginas: results.sort((x, y) => chosen.indexOf(x.pagina) - chosen.indexOf(y.pagina)).map((p) => ({ ...p, pedacos: chunks.get(p.pagina) })), busca: search, termos: terms, aviso: warning };
}

/** Cap on each page's text in the request to the model. */
const IN_PROMPT_PAGE = 8000;

/**
 * The part of the page that goes to the model: the whole page, if it fits; otherwise, windows around the chunks
 * semantic search found (first) and around where the question's words appear (the right passage may be at the end of a
 * long page, with none of the question's words), joined with "[…]". With chunks, the text goes with spaces collapsed (as
 * the chunk was indexed); the citation check ignores spaces.
 */
export function fromPagePassage(raw: string, terms: string[], max = IN_PROMPT_PAGE, chunks: number[] = []): string {
  if (raw.length <= max) return raw;
  const text = chunks.length ? normal(raw) : raw;
  if (text.length <= max) return text;
  // Unaccented and lower case, letter by letter (the same length: positions are valid in the original text).
  const plan = [...text].map((ch) => (ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase() || ch)[0]).join('');
  const fromChunks = chunks.length ? (() => { const ps = chunksPage(raw); return chunks.map((n) => ps[n] ? text.indexOf(ps[n]) + Math.floor(ps[n].length / 2) : -1).filter((i) => i >= 0); })() : [];
  const fromTerms = terms.flatMap((t) => { const out: number[] = []; let i = plan.indexOf(t); while (i >= 0 && out.length < 20) { out.push(i); i = plan.indexOf(t, i + t.length); } return out; });
  if (!fromChunks.length && !fromTerms.length) return text.slice(0, max);
  const ray = 1200;
  // Word windows merge with each other; semantic ones each stay whole on their own (they do not become the tail of a
  // long word window, which the cap would cut before reaching them).
  const join = (ps: number[]) => ps.sort((a, b) => a - b).reduce<[number, number][]>((js, p) => {
    const [from, until] = [Math.max(0, p - ray), Math.min(text.length, p + ray)];
    const last = js.at(-1);
    if (last && from <= last[1]) last[1] = Math.max(last[1], until); else js.push([from, until]);
    return js;
  }, []);
  // What semantic search found goes into the cap first; then the words; on output, in page order.
  let rest = max;
  const chosen = [...join(fromChunks), ...join(fromTerms)].flatMap(([from, until]) => {
    if (rest <= 0) return [];
    const end = Math.min(until, from + rest);
    rest -= end - from;
    return [[from, end] as [number, number]];
  }).sort((a, b) => a[0] - b[0]);
  const fit = chosen.reduce<[number, number][]>((js, [from, until]) => {
    const last = js.at(-1);
    if (last && from <= last[1]) last[1] = Math.max(last[1], until); else js.push([from, until]);
    return js;
  }, []);
  let output = '', used = 0;
  for (const [from, until] of fit) {
    const part = text.slice(from, Math.min(until, from + (max - used)));
    if (!part) break;
    output += `${output ? '\n[…]\n' : from > 0 ? '[…]\n' : ''}${part}`;
    used += part.length;
    if (used >= max) break;
  }
  return output;
}

/**
 * Quoted passages in the model's answer (two words or more; double, angle or typographic single quotes): each one must
 * be, literally, on a page that was read.
 */
export function quotesOutsidePages(answer: string, pages: Page[]): string[] {
  const texts = pages.map((p) => normal(p.texto));
  // Straight single quotes only outside a word (the apostrophe in "d'água" does not open a quotation).
  return [...answer.matchAll(/[“"«]([^”"»“]+)[”"»]|‘([^‘’]+)’|(?<![\p{L}\p{N}])'([^'\n]+)'(?![\p{L}\p{N}])/gu)].map((m) => [m[0], m[1] ?? m[2] ?? m[3]] as const)
    .map((m) => m[1].trim().replace(/[.,;:!?…]+$/, ''))
    .filter((c) => c.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length >= 2)
    .filter((c) => !texts.some((t) => t.includes(normal(c))));
}

const SYSTEM = `ASK THE DOCUMENT. You read the pages of a document and answer a journalist's question only with what is on them.
Respond in JSON: {"encontrou": true|false, "resposta": "one or two sentences, in the language of the question", "citacoes": [{"pagina": number, "trecho": "literal copy of a passage from the page"}]}.
Rules: each citation is an exact copy, character by character, of a passage of up to 300 characters from the indicated page; do not summarise or correct the passage. If the pages do not answer, "encontrou": false, "resposta": "" and "citacoes": []. Do not use knowledge from outside the document.`;

export interface Citation { pagina: number; trecho: string }

/** Checks each citation: a page among those read and the passage literally on it (whitespace normalised). */
export function checkCitations(citations: unknown, pages: Page[]): { boas: Citation[]; descartadas: (Citation & { motivo: string })[] } {
  const good: Citation[] = [];
  const discarded: (Citation & { motivo: string })[] = [];
  for (const c of Array.isArray(citations) ? citations : []) {
    const page = Number((c as Citation)?.pagina);
    const passage = typeof (c as Citation)?.trecho === 'string' ? (c as Citation).trecho.trim() : '';
    if (!passage) continue;
    const p = pages.find((x) => x.pagina === page);
    if (!p) { discarded.push({ pagina: page, trecho: passage, motivo: 'pagina' }); continue; }
    if (passage.length < 8 || !normal(p.texto).includes(normal(passage))) { discarded.push({ pagina: page, trecho: passage, motivo: 'trecho' }); continue; }
    if (!good.some((b) => b.pagina === page && b.trecho === passage)) good.push({ pagina: page, trecho: passage });
  }
  return { boas: good, descartadas: discarded };
}

export async function ask(env: Env, tenantId: string, textId: string, fileId: string, rawQuestion: unknown, actor: string) {
  await readText(env, tenantId, textId);
  const a = await env.DB.prepare('SELECT id, nome, estado FROM arquivos WHERE id = ? AND texto_id = ? AND tenant_id = ?').bind(fileId, textId, tenantId).first<{ id: string; nome: string; estado: string }>();
  if (!a) throw error('nao_encontrado', 'não encontrado', 'not found', 404);
  if (a.estado !== 'pronto') throw error('nao_pronto', 'O documento ainda não foi lido (ou a leitura falhou).', "The document hasn't been read yet (or reading failed).", 409);
  const question = typeof rawQuestion === 'string' ? normal(rawQuestion) : '';
  if (question.length < 3 || question.length > 500) throw error('pergunta', 'Escreva a pergunta (até 500 caracteres).', 'Write the question (up to 500 characters).');

  const { paginas: pages, busca: search, termos: terms, aviso: warning } = await fetchPages(env, tenantId, fileId, question);
  let answer: string | null = null, good: Citation[] = [], discarded: (Citation & { motivo: string })[] = [], cost = 0;
  // respondida | nao_encontrou | invalida (the model cited what is not on the pages, or broke the format) | falhou.
  let status: QuestionStatus = 'nao_encontrou';
  const id = newId();
  const record = () => env.DB.prepare(
    'INSERT INTO perguntas (id, tenant_id, texto_id, arquivo_id, pergunta, resposta, citacoes_json, descartadas_json, encontrou, busca, custo_usd, por, situacao, aviso) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(id, tenantId, textId, fileId, question, answer, JSON.stringify(answer ? good : []), JSON.stringify(discarded), answer ? 1 : 0, search, cost, actor, status, warning).run();
  if (pages.length) {
    const user = `${pages.map((p) => `[p. ${p.pagina}]\n${fromPagePassage(p.texto, terms, IN_PROMPT_PAGE, p.pedacos)}`).join('\n\n')}\n\nQUESTION: ${question}`;
    let r: Awaited<ReturnType<typeof callText>>;
    try {
      r = await callText(env, { tenantId, funcao: 'pergunta_documento' }, SYSTEM, user);
    } catch (e) {
      console.error('pergunta ao documento', fileId, String(e).slice(0, 200));
      // The attempt stays in the history (and in the defence package), with the failure.
      status = 'falhou';
      await record();
      if (e instanceof DeskError && e.codigo === 'sem_chave_texto') throw e;
      throw error('modelo', 'O modelo não respondeu agora: a pergunta ficou sem resposta conferida. Tente de novo.', "The model didn't respond: the question has no checked answer. Try again.", 502);
    }
    cost = r.custoUsd;
    const j = (r.json ?? {}) as { encontrou?: unknown; resposta?: unknown; citacoes?: unknown };
    ({ boas: good, descartadas: discarded } = checkCitations(j.citacoes, pages));
    if (typeof j.encontrou !== 'boolean' || !Array.isArray(j.citacoes)) status = 'invalida';
    else if (j.encontrou === true && good.length && typeof j.resposta === 'string' && j.resposta.trim()) {
      // The answer is the model's too: a quoted passage in it must be, letter for letter, on a page that was read.
      const invented = quotesOutsidePages(j.resposta, pages);
      if (invented.length) {
        status = 'invalida';
        discarded.push(...invented.map((passage) => ({ pagina: 0, trecho: passage, motivo: 'resposta' })));
      } else {
        answer = j.resposta.trim().slice(0, 600);
        status = 'respondida';
      }
    } else if (j.encontrou === true) status = 'invalida';   // said it found it, but no citation checked out
  }
  await record();
  return { id, pergunta: question, resposta: answer, citacoes: answer ? good : [], descartadas: discarded, encontrou: !!answer, busca: search, situacao: status, aviso: warning };
}

export type QuestionStatus = 'respondida' | 'nao_encontrou' | 'invalida' | 'falhou';

// ── lists and the passage that becomes evidence ────────────────────────────────────────────────────────────────

export async function filesText(env: Env, tenantId: string, textId: string) {
  const { results } = await env.DB.prepare(
    `SELECT id, tipo, nome, bytes, estado, erro, paginas, vetor, entidades_json, created_at FROM arquivos WHERE texto_id = ? AND tenant_id = ? AND tipo = 'pdf' ORDER BY created_at, rowid`,
  ).bind(textId, tenantId).all<{ id: string; tipo: string; nome: string; bytes: number; estado: string; erro: string | null; paginas: number | null; vetor: string | null; entidades_json: string | null; created_at: string }>();
  const { results: ps } = await env.DB.prepare(
    `SELECT id, arquivo_id, pergunta, resposta, citacoes_json, descartadas_json, encontrou, busca, situacao, aviso, created_at FROM perguntas WHERE texto_id = ? AND tenant_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 100`,
  ).bind(textId, tenantId).all<{ id: string; arquivo_id: string; pergunta: string; resposta: string | null; citacoes_json: string; descartadas_json: string; encontrou: number; busca: string; situacao: string | null; aviso: string | null; created_at: string }>();
  return results.map((a) => ({
    id: a.id, nome: a.nome, bytes: a.bytes, estado: a.estado as 'lendo' | 'pronto' | 'falhou', erro: a.erro, paginas: a.paginas, vetor: a.vetor, criadoEm: a.created_at,
    entidades: a.entidades_json ? (JSON.parse(a.entidades_json) as Entities) : null,
    perguntas: ps.filter((p) => p.arquivo_id === a.id).map((p) => ({
      id: p.id, pergunta: p.pergunta, resposta: p.resposta, citacoes: JSON.parse(p.citacoes_json) as Citation[], descartadas: (JSON.parse(p.descartadas_json) as unknown[]).length,
      encontrou: p.encontrou === 1, busca: p.busca, em: p.created_at,
      situacao: (p.situacao ?? (p.encontrou === 1 ? 'respondida' : 'nao_encontrou')) as QuestionStatus, aviso: p.aviso,
    })),
  }));
}

/** The cited passage becomes evidence: the whole page goes into the dossier (the check cites from it), tied to the file. */
export async function toEvidencePassage(env: Env, tenantId: string, textId: string, fileId: string, b: Record<string, unknown>) {
  await readText(env, tenantId, textId);
  const a = await env.DB.prepare('SELECT nome FROM arquivos WHERE id = ? AND texto_id = ? AND tenant_id = ?').bind(fileId, textId, tenantId).first<{ nome: string }>();
  if (!a) throw error('nao_encontrado', 'não encontrado', 'not found', 404);
  const page = Number(b.pagina);
  const p = Number.isInteger(page) ? await env.DB.prepare('SELECT texto FROM arquivo_paginas WHERE arquivo_id = ? AND tenant_id = ? AND pagina = ?').bind(fileId, tenantId, page).first<{ texto: string }>() : null;
  if (!p) throw error('pagina', 'Essa página não existe no documento.', "That page doesn't exist in the document.", 422);
  if (typeof b.trecho !== 'string' || b.trecho.trim().length < 8 || !normal(p.texto).includes(normal(b.trecho))) {
    throw error('trecho_fora', 'Esse trecho não está na página. Copie de novo do documento.', "That passage isn't on the page. Copy it again from the document.", 422);
  }
  const url = `documento:${fileId}#p${page}`;
  const already = await env.DB.prepare('SELECT id FROM evidencias WHERE texto_id = ? AND tenant_id = ? AND url = ?').bind(textId, tenantId, url).first<{ id: string }>();
  if (already) return { id: already.id, existia: true };
  const id = newId();
  const key = `evidencias/${tenantId}/${id}.txt`;
  await env.MEDIA.put(key, p.texto, { httpMetadata: { contentType: 'text/plain; charset=utf-8' } });
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(p.texto)))].map((x) => x.toString(16).padStart(2, '0')).join('');
  await env.DB.batch([
    env.DB.prepare("INSERT INTO evidencias (id, tenant_id, texto_id, url, titulo, r2_texto, hash, hash_atual, origem) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'documento')")
      .bind(id, tenantId, textId, url, `${a.nome}, p. ${page}`.slice(0, 300), key, hash, hash),
    env.DB.prepare("UPDATE textos SET updated_at = datetime('now') WHERE id = ? AND tenant_id = ?").bind(textId, tenantId),
  ]);
  return { id, existia: false };
}
