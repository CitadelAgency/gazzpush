import { generatePdf } from '../lib/pdf';
import { Hono, type Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { validator } from 'hono/validator';
import { newId, recordEvent } from '../lib/db';
import { GoogleError, updateDocument, googleConfigured, readDocument, fromDocText, fromDocUrl, type DocRead } from '../lib/google';
import {
  DeskError, addEvidence, checkBlocks, checkText, bodyError, statesBlocks, structure, requireBody, readText, linesBlocks, changes,
  paragraphsText, requestsReturn, removeEvidence, saveDoc, type SavedDocs, type TextOrigin,
} from '../lib/desk';
import { DocError, docWithIdsOf, cleanDoc, paragraphsDoc } from '../lib/doc';
import { NewError } from '../lib/intake';
import { StoryError, leadStory, postsStory } from '../lib/story';
import { analyze, sign, audit, createRule, undoReporting, strengthEvidence, recordReporting, fromManualRules, removeRule, fromSourceType } from '../lib/assistant';
import { requireMember, type AppEnv } from './tenancy';
import { createRequest, dataSheet, emailOn, htmlSheet, buildPackage, inArPage, requestsText, publishPage, manualAnswer, removePage } from '../lib/shield';
import { enqueueWayback } from '../lib/wayback';
import { PDF_MAX_BYTES, filesText, sendPdf, ask, toEvidencePassage, vectorOn } from '../lib/document';
import { AUDIO_MAX_BYTES, audioToPlay, sendAudio, recordingsText, transcript } from '../lib/recording';
import { openSession, finishSession, receiveSlice, sessionsOpen, trySegment } from '../lib/recordingSession';
import { SLICE_MAX_BYTES } from '../lib/segments';
import { isJpeg, isPng, readBodyUntil } from './brand';
import { signMedia } from '../lib/crypto';
import { PHOTO_MAX_BYTES } from '../lib/cards';
import { readAsEditor, suggestPromotion } from '../lib/writing';
import { saveSnapshot, readSnapshot, listHistory } from '../lib/history';
import { requirePlan } from '../lib/plans';
import { requireKeyText } from '../lib/providers';
import { alertsText, postAlert, casesText, resolveAlert } from '../lib/living';
import { progressLai, createRequestLai, laiText } from '../lib/lai';
import { archiveOutlet, changeClipping, fetchInMaterial, createClipping, pagesDocument, clippingsText, fromEvidenceText, removeClipping, bringArchive } from '../lib/material';
// `tx` and not `t`: the routes here call the text read from the database `t`.
import { language, t as tx } from './language';

/**
 * Review desk under /t/:tenantId/textos (mounted in api.ts, behind requireMember). Every query carries `tenant_id`; the
 * author and the decider come from the session. Changing the text or the dossier, or sending to Instagram, is for editors
 * and above (like producing); reporters read.
 */
const readJson = async <T>(c: Context<AppEnv>): Promise<Partial<T>> => (await c.req.json().catch(() => ({}))) as Partial<T>;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** A typed query for the Hono client (as in api.ts): only the listed keys, string or missing. */
const query = <K extends string>(...keys: K[]) => validator('query', (q) => Object.fromEntries(keys.map((k) => [k, typeof q[k] === 'string' ? q[k] : undefined])) as Record<K, string | undefined>);
/** Body read with a cap (readBodyUntil) as an ArrayBuffer; null: it went over the cap. */
const asBuffer = (b: Uint8Array | null): ArrayBuffer | null => (b ? (b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer) : null);

function error(c: Context<AppEnv>, e: unknown) {
  if (e instanceof DeskError || e instanceof GoogleError || e instanceof NewError) {
    const extra = e instanceof StoryError ? { pendencias: e.pendencias } : {};
    return c.json({ erro: tx(c, e.message, e.en ?? e.message), code: e.codigo, ...extra }, e.status as 400);
  }
  throw e;
}

/** What costs model calls requires a plan in good standing. Reading and writing the text does not. */
const withPlan = createMiddleware<AppEnv>(async (c, next) => {
  try {
    await requirePlan(c.env, c.get('tenant').id);
  } catch (e) {
    return error(c, e);
  }
  await next();
});

/** An image in the text: a one-year link, enough for Substack to fetch it on paste and for the screen to keep showing it. */
const IMAGE_TTL_S = 365 * 24 * 3600;

/** Docs snapshot stored at import: each paragraph's position and formatting, and the end of the body. */
// A paragraph as the desk stores it: whitespace (and a line break inside it) becomes one space. The Docs snapshot uses
// the same form, so sending back recognises an untouched paragraph as equal.
const normal = (p: string) => p.replace(/\s+/g, ' ').trim();
const fromDocBody = (d: DocRead) => d.paragrafos.map((p) => normal(p.texto)).filter(Boolean);
const snapshot = (d: DocRead): SavedDocs => ({
  fimAbas: d.fimAbas,
  paragrafos: d.paragrafos.map(({ texto: text, inicio: home, fim: end, estilo: style, html, aba: tab }) => ({ texto: normal(text), inicio: home, fim: end, estilo: style, html, aba: tab })),
});

/**
 * What the desk shows: the text (the editor's document, the paragraphs with Docs HTML for copying), each block's state,
 * the claims that stand in the current text (only from blocks checked with the current text's hash) with the person's
 * reporting, code findings (arithmetic, unsourced quotes, style guide), people, the dossier with source strength and the
 * publishing checklist.
 */
async function state(c: Context<AppEnv>, id: string) {
  const tenantId = c.get('tenant').id;
  const an = await analyze(c.env, tenantId, id);
  const t = an.t;
  const used = new Map<string, number>();
  for (const a of an.afirmacoes) {
    const ev = a.apuracao?.tipo === 'fonte' ? a.apuracao.evidenciaId : a.evidenciaId;
    if (ev) used.set(ev, (used.get(ev) ?? 0) + 1);
  }
  const paragraphs: string[] = JSON.parse(t.paragrafos_json);
  const docs: SavedDocs | null = t.docs_json ? JSON.parse(t.docs_json) : null;
  // A paragraph equal to the Docs one carries its formatting (bold, italic, links); the rest, plain text.
  const htmlDocs = new Map((docs?.paragrafos ?? []).map((p) => [p.texto, p.html]));
  const docsStyle = new Map((docs?.paragrafos ?? []).map((p) => [p.texto, p.estilo]));
  return {
    texto: {
      id: t.id, titulo: t.titulo, origem: t.origem as TextOrigin, versao: t.versao, conferidoVersao: t.conferido_versao, conferidoEm: t.conferido_em,
      conferenciaErro: t.conferencia_erro, docsUrl: t.docs_id ? fromDocUrl(t.docs_id) : null, pautaId: t.pauta_id, criadoEm: t.created_at, atualizadoEm: t.updated_at,
      paragrafos: paragraphs.map((p) => ({ texto: p, html: htmlDocs.get(p) ?? esc(p), estilo: docsStyle.get(p) ?? null })),
      doc: an.est.doc,
    },
    blocos: an.blocos,
    afirmacoes: an.afirmacoes.map((a) => ({
      id: a.id, paragrafo: a.paragrafo, inicio: a.inicio, fim: a.fim, trecho: a.trecho, estado: a.estado, risco: a.risco, evidenciaId: a.evidenciaId,
      evidenciaTrecho: a.evidenciaTrecho, explicacao: a.explicacao, blocoId: a.blocoId, incerto: a.incerto, aberta: a.aberta, apuracao: a.apuracao,
    })),
    apontamentos: an.apontamentos,
    pessoas: an.pessoas,
    evidencias: an.evidencias.map((e) => ({
      id: e.id, url: e.url, titulo: e.titulo, conferidaEm: e.conferidaEm, mudouEm: e.mudouEm, viaNavegador: e.viaNavegador, usada: used.get(e.id) ?? 0,
      origem: e.origem, wayback: e.wayback, ...strengthEvidence(e),
    })),
    circulares: an.circulares,
    fonteUnica: an.fonteUnica,
    checklist: { pendencias: an.pendencias, assinatura: an.assinatura },
    // Legal shield: the other-side requests, whether email goes out through the app, and the live sources page.
    outroLado: { pedidos: await requestsText(c.env, tenantId, id), emailLigado: emailOn(c.env) },
    paginaFontes: await inArPage(c.env, tenantId, id),
    // Ask the document: the PDFs, the questions and the entities; and whether semantic search is on.
    documentos: await filesText(c.env, tenantId, id),
    buscaVetorial: vectorOn(c.env),
    // Quotes against the recording: the audio files (the transcript comes from its own route).
    gravacoes: await recordingsText(c.env, tenantId, id),
    sessoesAbertas: await sessionsOpen(c.env, tenantId, id),
    // Living story: the After tab's alerts, the cited court cases (DataJud) and the LAI requests.
    alertas: await alertsText(c.env, tenantId, id),
    processos: await casesText(c.env, tenantId, id, paragraphs),
    lai: await laiText(c.env, tenantId, id, c.get('user').name ?? '', an.afirmacoes.filter((a) => a.estado === 'sem_fonte' && a.aberta).map((a) => ({
      id: a.id, blocoId: a.blocoId, trecho: a.trecho, inicio: a.inicio, fim: a.fim, textoBloco: an.est.blocos.find((b) => b.id === a.blocoId)?.texto ?? '',
    }))),
    segunda: an.segunda,
    provedorTexto: an.provedorTexto,
    temaSensivel: an.temaSensivel,
    // Send back to Docs: only text that came from there and with the Google configuration.
    podeDevolver: t.origem === 'docs' && googleConfigured(c.env),
  };
}

export const texts = new Hono<AppEnv>()

// The desk belongs to the author outlet: in the other modes, the routes do not exist.
.use('*', async (c, next) => {
  const t = await c.env.DB.prepare('SELECT modo FROM tenants WHERE id = ?').bind(c.get('tenant').id).first<{ modo: string }>();
  if (t?.modo !== 'autoral') return c.json({ erro: tx(c, 'não encontrado', 'not found') }, 404);
  await next();
})

// List: title, origin, when it changed, the marks from the last check and whether any dossier source changed.
.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT t.id, t.titulo, t.origem, t.versao, t.conferido_versao, t.updated_at,
            (SELECT COUNT(*) FROM afirmacoes a WHERE a.texto_id = t.id AND a.tenant_id = t.tenant_id AND a.estado = 'com_evidencia') AS com_evidencia,
            (SELECT COUNT(*) FROM afirmacoes a WHERE a.texto_id = t.id AND a.tenant_id = t.tenant_id AND a.estado = 'sem_fonte') AS sem_fonte,
            (SELECT COUNT(*) FROM afirmacoes a WHERE a.texto_id = t.id AND a.tenant_id = t.tenant_id AND a.estado = 'risco') AS risco,
            EXISTS (SELECT 1 FROM evidencias e WHERE e.texto_id = t.id AND e.tenant_id = t.tenant_id AND e.mudou_em IS NOT NULL) AS fonte_mudou,
            (SELECT COUNT(*) FROM alertas al WHERE al.texto_id = t.id AND al.tenant_id = t.tenant_id AND al.estado = 'aberto' AND al.tipo != 'fonte_mudou') AS alertas
       FROM textos t WHERE t.tenant_id = ? ORDER BY t.updated_at DESC, t.rowid DESC LIMIT 100`,
  ).bind(c.get('tenant').id).all<{
    id: string; titulo: string; origem: string; versao: number; conferido_versao: number | null; updated_at: string;
    com_evidencia: number; sem_fonte: number; risco: number; fonte_mudou: number; alertas: number;
  }>();
  return c.json({
    textos: results.map((t) => ({
      id: t.id, titulo: t.titulo, origem: t.origem as TextOrigin, atualizadoEm: t.updated_at, conferido: t.conferido_versao === t.versao,
      marcas: { comEvidencia: t.com_evidencia, semFonte: t.sem_fonte, risco: t.risco }, fonteMudou: t.fonte_mudou === 1, alertas: t.alertas,
    })),
  });
})

// New text: the blank sheet (`{branco: true}`), pasted (`{titulo, texto}`) or from Google Docs (`{docs: id}`, with the
// Google configuration). It does not check on its own: the person builds the dossier and asks (or saves). A blank sheet
// the person opened and left empty is the same one next time: New text does not fill the list with empty rows.
.post('/', requireMember('editor'), async (c) => {
  const tenantId = c.get('tenant').id;
  const b = await readJson<{ titulo: unknown; texto: unknown; docs: unknown; branco: unknown }>(c);
  let id: string = newId();
  try {
    if (b.branco === true) {
      const author = c.get('user').id;
      const empty = await c.env.DB.prepare(`SELECT id FROM textos WHERE tenant_id = ? AND autor = ? AND origem = 'escrito' AND titulo = '' AND paragrafos_json = '[]' LIMIT 1`)
        .bind(tenantId, author).first<{ id: string }>();
      if (empty) id = empty.id;
      else await c.env.DB.prepare(`INSERT INTO textos (id, tenant_id, titulo, paragrafos_json, origem, autor) VALUES (?, ?, '', '[]', 'escrito', ?)`).bind(id, tenantId, author).run();
    } else if (b.docs !== undefined) {
      if (!googleConfigured(c.env)) return c.json({ erro: tx(c, 'não encontrado', 'not found') }, 404);
      const d = await readDocument(c.env, c.get('user').id, String(b.docs));
      const paragraphs = fromDocBody(d);
      const e = bodyError(paragraphs, language(c));
      if (e) throw new DeskError('texto_invalido', e);
      await c.env.DB.prepare(
        `INSERT INTO textos (id, tenant_id, titulo, paragrafos_json, origem, docs_id, docs_revisao, docs_json, autor) VALUES (?, ?, ?, ?, 'docs', ?, ?, ?, ?)`,
      ).bind(id, tenantId, (d.titulo || 'Sem título').slice(0, 300), JSON.stringify(paragraphs), d.id, d.revisao, JSON.stringify(snapshot(d)), c.get('user').id).run();
    } else {
      const paragraphs = typeof b.texto === 'string' ? paragraphsText(b.texto) : [];
      const e = bodyError(paragraphs, language(c));
      if (e) return c.json({ erro: e, code: 'texto_invalido' }, 400);
      // Without a title: the first line is the title (and leaves the body, if the body goes on).
      let title = typeof b.titulo === 'string' ? b.titulo.replace(/\s+/g, ' ').trim() : '';
      if (!title) title = paragraphs.length > 1 ? paragraphs.shift()! : paragraphs[0].slice(0, 120);
      await c.env.DB.prepare('INSERT INTO textos (id, tenant_id, titulo, paragrafos_json, origem, autor) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(id, tenantId, title.slice(0, 300), JSON.stringify(paragraphs), 'colado', c.get('user').id).run();
    }
  } catch (e) {
    return error(c, e);
  }
  return c.json(await state(c, id), 201);
})

// The outlet's style guide: rules that only point things out (acronym, spelling, number, title, language). Read: every
// member; change: editors and above.
.get('/manual', async (c) => c.json({ regras: await fromManualRules(c.env, c.get('tenant').id) }))
.post('/manual', requireMember('editor'), async (c) => {
  try {
    const r = await createRule(c.env, c.get('tenant').id, c.get('user').id, await readJson<Record<string, unknown>>(c));
    return c.json({ ...r, regras: await fromManualRules(c.env, c.get('tenant').id) }, 201);
  } catch (e) {
    return error(c, e);
  }
})
.delete('/manual/:regra', requireMember('editor'), async (c) => {
  if (!(await removeRule(c.env, c.get('tenant').id, c.req.param('regra')))) return c.json({ erro: tx(c, 'não encontrado', 'not found') }, 404);
  return c.json({ regras: await fromManualRules(c.env, c.get('tenant').id) });
})

// Audit panel: marks per month, topic and person mentioned, and the ignored ones (`dias`, default 180).
.get('/auditoria', async (c) => {
  const days = Number(c.req.query('dias') ?? 180);
  return c.json(await audit(c.env, c.get('tenant').id, Number.isFinite(days) ? days : 180));
})

// Material on the side, the outlet's library: other texts' sources (without repeats) and the clippings saved to the
// library. `menos`: the open text (its sources leave the list; what it already has comes marked). Before /:id.
.get('/acervo', query('q', 'menos'), async (c) => {
  const { q, menos: less } = c.req.valid('query');
  return c.json(await archiveOutlet(c.env, c.get('tenant').id, less ?? null, q));
})

.get('/:id', async (c) => {
  try {
    return c.json(await state(c, c.req.param('id')));
  } catch (e) {
    return error(c, e);
  }
})

// Save: the editor's document (`doc`, the screen's autosave) or the list of paragraphs (`paragrafos`, the earlier way),
// with the version the person saw (409 if someone else saved first). Blocks that did not change keep their marks;
// changed ones become pending. With `doc`, the screen checks afterwards (per block, streamed); with `paragrafos`, the
// changed blocks are checked here (the check never alters the body).
.put('/:id', requireMember('editor'), async (c) => {
  const tenantId = c.get('tenant').id;
  const id = c.req.param('id');
  const b = await readJson<{ titulo: unknown; paragrafos: unknown; doc: unknown; versao: unknown; restaurando: unknown }>(c);
  if (!Number.isInteger(b.versao)) return c.json({ erro: tx(c, 'versao: inteiro', 'versao: integer') }, 400);
  const title = typeof b.titulo === 'string' && b.titulo.trim() ? b.titulo.replace(/\s+/g, ' ').trim().slice(0, 300) : null;
  let doc;
  let t;
  try {
    t = await readText(c.env, tenantId, id);
    if (b.doc !== undefined) {
      doc = cleanDoc(b.doc, newId);
      const e = bodyError(paragraphsDoc(doc), language(c), true);
      if (e) return c.json({ erro: e, code: 'texto_invalido' }, 400);
    } else {
      const e = bodyError(b.paragrafos, language(c));
      if (e) return c.json({ erro: e, code: 'texto_invalido' }, 400);
      doc = docWithIdsOf((b.paragrafos as string[]).map(normal).filter(Boolean), (await structure(t)).blocos, newId);
    }
  } catch (err) {
    if (err instanceof DocError) return c.json({ erro: tx(c, err.message, err.en), code: 'texto_invalido' }, 400);
    return error(c, err);
  }
  const created = await saveDoc(c.env, tenantId, id, doc, b.versao as number, title);
  if (created === null) {
    const current = await readText(c.env, tenantId, id);
    return c.json({ erro: tx(c, 'Outra pessoa salvou este texto antes de você. Recarregue para ver a versão nova; o que você escreveu continua na tela.', 'Someone else saved this text before you. Reload to see the new version; what you wrote is still on screen.'), code: 'versao', versao: current.versao }, 409);
  }
  await saveSnapshot(c.env, tenantId, t, c.get('user').id, b.restaurando === true);
  if (b.doc === undefined) await checkText(c.env, tenantId, id);
  return c.json(await state(c, id));
})

// Editor history: restoring is the screen putting the old document in the editor and saving with `restaurando`.
.get('/:id/historico', async (c) => {
  try {
    await readText(c.env, c.get('tenant').id, c.req.param('id'));
    return c.json({ versoes: await listHistory(c.env, c.get('tenant').id, c.req.param('id')) });
  } catch (e) {
    return error(c, e);
  }
})
.get('/:id/historico/:retrato', async (c) => {
  try {
    return c.json(await readSnapshot(c.env, c.get('tenant').id, c.req.param('id'), c.req.param('retrato')));
  } catch (e) {
    return error(c, e);
  }
})

// Material on the side: the text's clippings (a literal passage from a source, or the person's note), in order. Outside
// `estado`: saving, moving or annotating does not cost a whole analysis of the text.
.get('/:id/recortes', async (c) => {
  try {
    await readText(c.env, c.get('tenant').id, c.req.param('id'));
    return c.json({ recortes: await clippingsText(c.env, c.get('tenant').id, c.req.param('id')) });
  } catch (e) {
    return error(c, e);
  }
})
.post('/:id/recortes', requireMember('editor'), async (c) => {
  try {
    const r = await createClipping(c.env, c.get('tenant').id, c.req.param('id'), c.get('user').id, await readJson<Record<string, unknown>>(c));
    return c.json({ recortes: await clippingsText(c.env, c.get('tenant').id, c.req.param('id')), recorteId: r.id, existia: r.existia }, r.existia ? 200 : 201);
  } catch (e) {
    return error(c, e);
  }
})
.patch('/:id/recortes/:recorte', requireMember('editor'), async (c) => {
  try {
    if (!(await changeClipping(c.env, c.get('tenant').id, c.req.param('id'), c.req.param('recorte'), await readJson<Record<string, unknown>>(c)))) return c.json({ erro: tx(c, 'não encontrado', 'not found') }, 404);
    return c.json({ recortes: await clippingsText(c.env, c.get('tenant').id, c.req.param('id')) });
  } catch (e) {
    return error(c, e);
  }
})
.delete('/:id/recortes/:recorte', requireMember('editor'), async (c) => {
  try {
    if (!(await removeClipping(c.env, c.get('tenant').id, c.req.param('id'), c.req.param('recorte')))) return c.json({ erro: tx(c, 'não encontrado', 'not found') }, 404);
    return c.json({ recortes: await clippingsText(c.env, c.get('tenant').id, c.req.param('id')) });
  } catch (e) {
    return error(c, e);
  }
})

// Side reader: the evidence's stored text in paragraphs, and PDF pages in a window (`de`, `ate`; up to 10 per request).
.get('/:id/evidencias/:evidencia/texto', async (c) => {
  try {
    return c.json(await fromEvidenceText(c.env, c.get('tenant').id, c.req.param('id'), c.req.param('evidencia')));
  } catch (e) {
    return error(c, e);
  }
})
.get('/:id/documentos/:arquivo/paginas', query('de', 'ate'), async (c) => {
  try {
    const { de: from, ate: until } = c.req.valid('query');
    return c.json(await pagesDocument(c.env, c.get('tenant').id, c.req.param('id'), c.req.param('arquivo'), from, until));
  } catch (e) {
    return error(c, e);
  }
})

// A single search in the text's material: clippings, evidence, PDF pages and transcripts, accent- and case-insensitive, with caps.
.get('/:id/material/busca', query('q'), async (c) => {
  try {
    return c.json(await fetchInMaterial(c.env, c.get('tenant').id, c.req.param('id'), c.req.valid('query').q));
  } catch (e) {
    return error(c, e);
  }
})

// Bring from the library: the source (link, PDF, recording) or the clipping with its source, without reading, processing
// or transcribing again. What is already in the text comes back as is (200, `existia`). A copied link goes to the Wayback
// queue when the copy from there was not saved yet, like a new link.
.post('/:id/acervo/trazer', requireMember('editor'), async (c) => {
  const tenantId = c.get('tenant').id;
  const id = c.req.param('id');
  try {
    const r = await bringArchive(c.env, tenantId, id, c.get('user').id, await readJson<Record<string, unknown>>(c));
    if (r.wayback) await enqueueWayback(c.env, tenantId, r.wayback);
    return c.json({ ...(await state(c, id)), trazido: { tipo: r.tipo, id: r.id, existia: r.existia }, recortes: await clippingsText(c.env, tenantId, id) }, r.existia ? 200 : 201);
  } catch (e) {
    return error(c, e);
  }
})

// Help when finishing: nothing goes back into the document. Over the saved text.
.post('/:id/divulgacao', requireMember('editor'), withPlan, async (c) => {
  try {
    return c.json(await suggestPromotion(c.env, await readText(c.env, c.get('tenant').id, c.req.param('id')), language(c)));
  } catch (e) {
    return error(c, e);
  }
})
.post('/:id/segunda-leitura', requireMember('editor'), withPlan, async (c) => {
  try {
    return c.json({ notas: await readAsEditor(c.env, await readText(c.env, c.get('tenant').id, c.req.param('id')), language(c)) });
  } catch (e) {
    return error(c, e);
  }
})

// An image in the text: uploads to R2 and returns the signed link that goes into the document.
.post('/:id/imagens', requireMember('editor'), async (c) => {
  const tenantId = c.get('tenant').id;
  const id = c.req.param('id');
  try {
    await readText(c.env, tenantId, id);
  } catch (e) {
    return error(c, e);
  }
  const type = (c.req.header('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'image/jpeg' && type !== 'image/png') return c.json({ erro: tx(c, 'imagem: JPEG ou PNG', 'image: JPEG or PNG') }, 415);
  const bytes = await readBodyUntil(c.req.raw.body, PHOTO_MAX_BYTES);
  if (!bytes) return c.json({ erro: tx(c, 'imagem: até 2 MB', 'image: up to 2 MB') }, 413);
  if (!(type === 'image/png' ? isPng(bytes) : isJpeg(bytes))) return c.json({ erro: tx(c, 'o arquivo não é uma imagem válida', 'the file is not a valid image') }, 400);
  const key = `textos/${tenantId}/${id}/img-${newId()}.${type === 'image/png' ? 'png' : 'jpg'}`;
  await c.env.MEDIA.put(key, bytes, { httpMetadata: { contentType: type } });
  return c.json({ src: await signMedia(c.env, key, IMAGE_TTL_S) }, 201);
})

// Check: the blocks not yet checked in the current text (`todos`: all; `blocos`: only those). With
// `accept: application/x-ndjson`, the response is streamed, one line per finished block ({tipo: 'bloco', ...}) and the
// last with the whole state ({tipo: 'fim', estado}); without it, the whole state at the end (the earlier way).
.post('/:id/conferir', requireMember('editor'), withPlan, async (c) => {
  const tenantId = c.get('tenant').id;
  const id = c.req.param('id');
  const b = await readJson<{ todos: unknown; blocos: unknown; pular: unknown }>(c);
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 2000) : undefined);
  const options = { todos: b.todos === true, blocos: ids(b.blocos), pular: ids(b.pular) };
  try {
    requireBody(await readText(c.env, tenantId, id));
    // Without a text key, the reason goes before streaming (in the middle of it, it would become "stopped midway").
    await requireKeyText(c.env, tenantId);
    if (!(c.req.header('accept') ?? '').includes('application/x-ndjson')) {
      await checkBlocks(c.env, tenantId, id, options);
      return c.json(await state(c, id));
    }
  } catch (e) {
    return error(c, e);
  }
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const w = writable.getWriter();
  const enc = new TextEncoder();
  const line = (o: unknown) => w.write(enc.encode(`${JSON.stringify(o)}\n`));
  const task = (async () => {
    try {
      const { restantes: remaining } = await checkBlocks(c.env, tenantId, id, { ...options, aoBloco: ({ custoUsd: _c, ...r }) => line({ tipo: 'bloco', ...r }) });
      await line({ tipo: 'fim', estado: await state(c, id), restantes: remaining });
    } catch (e) {
      console.error('conferir stream', id, String(e).slice(0, 300));
      await line({ tipo: 'erro', erro: e instanceof DeskError ? tx(c, e.message, e.en ?? e.message) : tx(c, 'A conferência parou no meio. Tente de novo.', 'The check stopped halfway. Try again.') }).catch(() => {});
    } finally {
      await w.close().catch(() => {});
    }
  })();
  try { c.executionCtx.waitUntil(task); } catch { /* no execution context: reading the body holds the task */ }
  return c.body(readable, 200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' });
})

.post('/:id/evidencias', requireMember('editor'), async (c) => {
  const { url } = await readJson<{ url: unknown }>(c);
  if (typeof url !== 'string') return c.json({ erro: tx(c, 'Cole o link da evidência.', 'Paste the link to the evidence.'), code: 'url_invalida' }, 400);
  try {
    const r = await addEvidence(c.env, c.get('tenant').id, c.req.param('id'), url);
    // A Wayback Machine copy through the queue (the screen shows "saving to Wayback" until the capture comes back).
    if (!r.existia) await enqueueWayback(c.env, c.get('tenant').id, r.id);
    return c.json({ ...(await state(c, c.req.param('id'))), evidenciaId: r.id, existia: r.existia }, r.existia ? 200 : 201);
  } catch (e) {
    return error(c, e);
  }
})

.patch('/:id/evidencias/:evidencia', requireMember('editor'), async (c) => {
  const { tipoFonte: sourceType } = await readJson<{ tipoFonte: unknown }>(c);
  try {
    await readText(c.env, c.get('tenant').id, c.req.param('id'));
    if (!(await fromSourceType(c.env, c.get('tenant').id, c.req.param('id'), c.req.param('evidencia'), sourceType ?? null))) return c.json({ erro: tx(c, 'não encontrado', 'not found') }, 404);
    return c.json(await state(c, c.req.param('id')));
  } catch (e) {
    return error(c, e);
  }
})

// Card actions (they record reporting, they do not write text): fonte, outro_lado, opiniao, ignorar. Undo keeps who and when.
.post('/:id/apuracoes', requireMember('editor'), async (c) => {
  try {
    const ap = await recordReporting(c.env, c.get('tenant').id, c.req.param('id'), c.get('user').id, await readJson<Record<string, unknown>>(c));
    return c.json({ ...(await state(c, c.req.param('id'))), apuracaoId: ap.id }, 201);
  } catch (e) {
    return error(c, e);
  }
})
.delete('/:id/apuracoes/:apuracao', requireMember('editor'), async (c) => {
  try {
    await readText(c.env, c.get('tenant').id, c.req.param('id'));
    if (!(await undoReporting(c.env, c.get('tenant').id, c.req.param('id'), c.req.param('apuracao'), c.get('user').id))) return c.json({ erro: tx(c, 'não encontrado', 'not found') }, 404);
    return c.json(await state(c, c.req.param('id')));
  } catch (e) {
    return error(c, e);
  }
})

// Wayback again (the copy failed): back to the queue.
.post('/:id/evidencias/:evidencia/wayback', requireMember('editor'), async (c) => {
  try {
    await readText(c.env, c.get('tenant').id, c.req.param('id'));
    const ev = await c.env.DB.prepare("SELECT 1 FROM evidencias WHERE id = ? AND texto_id = ? AND tenant_id = ? AND origem = 'link'")
      .bind(c.req.param('evidencia'), c.req.param('id'), c.get('tenant').id).first();
    if (!ev) return c.json({ erro: tx(c, 'não encontrado', 'not found') }, 404);
    await enqueueWayback(c.env, c.get('tenant').id, c.req.param('evidencia'));
    return c.json(await state(c, c.req.param('id')));
  } catch (e) {
    return error(c, e);
  }
})

// Legal shield: the other-side request (by email through the app, or copied and sent elsewhere) and the pasted reply.
.post('/:id/pedidos', requireMember('editor'), async (c) => {
  try {
    const r = await createRequest(c.env, c.get('tenant').id, c.req.param('id'), { id: c.get('user').id, nome: c.get('user').name }, await readJson<Record<string, unknown>>(c));
    return c.json({ ...(await state(c, c.req.param('id'))), pedidoId: r.id, envioErro: r.erro }, 201);
  } catch (e) {
    return error(c, e);
  }
})
.post('/:id/pedidos/:pedido/resposta', requireMember('editor'), async (c) => {
  try {
    const r = await manualAnswer(c.env, c.get('tenant').id, c.req.param('id'), c.req.param('pedido'), await readJson<Record<string, unknown>>(c));
    return c.json({ ...(await state(c, c.req.param('id'))), evidenciaId: r.evidenciaId }, 201);
  } catch (e) {
    return error(c, e);
  }
})

// Public sources page ("How we reported this"): publish the checked version (the checklist gates it) or take it down.
.post('/:id/pagina-fontes', requireMember('editor'), async (c) => {
  const { versao: version } = await readJson<{ versao: unknown }>(c);
  try {
    await publishPage(c.env, c.get('tenant').id, c.req.param('id'), version, c.get('user').id);
    return c.json(await state(c, c.req.param('id')), 201);
  } catch (e) {
    return error(c, e);
  }
})
.delete('/:id/pagina-fontes', requireMember('editor'), async (c) => {
  try {
    if (!(await removePage(c.env, c.get('tenant').id, c.req.param('id'), c.get('user').id))) return c.json({ erro: tx(c, 'não encontrado', 'not found') }, 404);
    return c.json(await state(c, c.req.param('id')));
  } catch (e) {
    return error(c, e);
  }
})

// Sheet for the lawyer: only the sentences with a risk mark, as PDF. `?html=1` returns the HTML, without opening a browser.
.get('/:id/folha', requireMember('editor'), async (c) => {
  try {
    const f = await dataSheet(c.env, c.get('tenant').id, c.req.param('id'));
    const html = htmlSheet(f);
    if (c.req.query('html') === '1') return c.html(html);
    return new Response(await generatePdf(c.env, html), { headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="folha-advogado-v${f.versao}.pdf"`, 'cache-control': 'no-store' } });
  } catch (e) {
    return error(c, e);
  }
})

// Defence package: the zip with versions, dossier, reporting, other side, posts, the hash manifest and the timestamp.
// The header says whether the timestamp came out (without it the package goes out anyway, and the README file says why).
.get('/:id/pacote', requireMember('editor'), async (c) => {
  try {
    const p = await buildPackage(c.env, c.get('tenant').id, c.req.param('id'), c.get('user').id);
    return new Response(p.zip, {
      headers: {
        'content-type': 'application/zip', 'content-disposition': `attachment; filename="${p.nome}"`, 'cache-control': 'no-store',
        'x-carimbo': p.carimbo.ok ? `ok ${p.carimbo.em}` : 'falhou', ...(p.carimbo.erro ? { 'x-carimbo-erro': encodeURIComponent(p.carimbo.erro) } : {}),
        // Files that stayed out (vanished from storage or do not fit): the screen warns; the README file and the manifest list them.
        'x-pacote-fora': String(p.fora.length),
      },
    });
  } catch (e) {
    return error(c, e);
  }
})

// Ask the document: the PDF comes raw in the body (name in the x-nome header); reading goes to the queue.
.post('/:id/documentos', requireMember('editor'), async (c) => {
  try {
    const name = (() => { try { return decodeURIComponent(c.req.header('x-nome') ?? ''); } catch { return ''; } })();
    // The cap applies while reading the body: a file that is too big is cut midway, not loaded whole into memory.
    const r = await sendPdf(c.env, c.get('tenant').id, c.req.param('id'), c.get('user').id, name, asBuffer(await readBodyUntil(c.req.raw.body, PDF_MAX_BYTES)));
    return c.json({ ...(await state(c, c.req.param('id'))), arquivoId: r.id, existia: r.existia }, r.existia ? 200 : 201);
  } catch (e) {
    return error(c, e);
  }
})
.get('/:id/documentos/:arquivo/pdf', async (c) => {
  try {
    await readText(c.env, c.get('tenant').id, c.req.param('id'));
    const a = await c.env.DB.prepare('SELECT r2, nome FROM arquivos WHERE id = ? AND texto_id = ? AND tenant_id = ?').bind(c.req.param('arquivo'), c.req.param('id'), c.get('tenant').id).first<{ r2: string; nome: string }>();
    const obj = a ? await c.env.MEDIA.get(a.r2) : null;
    if (!a || !obj) return c.json({ erro: tx(c, 'não encontrado', 'not found') }, 404);
    return new Response(obj.body, { headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(a.nome)}`, 'cache-control': 'private, no-store' } });
  } catch (e) {
    return error(c, e);
  }
})
.post('/:id/documentos/:arquivo/perguntas', requireMember('editor'), withPlan, async (c) => {
  const { pergunta: question } = await readJson<{ pergunta: unknown }>(c);
  try {
    const r = await ask(c.env, c.get('tenant').id, c.req.param('id'), c.req.param('arquivo'), question, c.get('user').id);
    return c.json({ ...r, estado: await state(c, c.req.param('id')) }, 201);
  } catch (e) {
    return error(c, e);
  }
})
.post('/:id/documentos/:arquivo/evidencia', requireMember('editor'), async (c) => {
  try {
    const r = await toEvidencePassage(c.env, c.get('tenant').id, c.req.param('id'), c.req.param('arquivo'), await readJson<Record<string, unknown>>(c));
    return c.json({ ...(await state(c, c.req.param('id'))), evidenciaId: r.id, existia: r.existia }, r.existia ? 200 : 201);
  } catch (e) {
    return error(c, e);
  }
})

// Recording in the app: the session, the slices (raw body, idempotent by number) and finishing.
.post('/:id/gravacoes/sessao', requireMember('editor'), withPlan, async (c) => {
  try {
    const b = await readJson<{ mime: unknown }>(c);
    return c.json(await openSession(c.env, c.get('tenant').id, c.req.param('id'), c.get('user').id, b.mime), 201);
  } catch (e) {
    return error(c, e);
  }
})
.put('/:id/gravacoes/sessao/:sessao/:segmento/:fatia', requireMember('editor'), async (c) => {
  try {
    await receiveSlice(c.env, c.get('tenant').id, c.req.param('id'), c.req.param('sessao'), c.req.param('segmento'), c.req.param('fatia'), await readBodyUntil(c.req.raw.body, SLICE_MAX_BYTES));
    return c.json({ ok: true });
  } catch (e) {
    return error(c, e);
  }
})
.post('/:id/gravacoes/sessao/:sessao/concluir', requireMember('editor'), async (c) => {
  try {
    await finishSession(c.env, c.get('tenant').id, c.req.param('id'), c.req.param('sessao'));
    return c.json(await state(c, c.req.param('id')));
  } catch (e) {
    return error(c, e);
  }
})
.post('/:id/gravacoes/:arquivo/segmentos/:n/tentar', requireMember('editor'), withPlan, async (c) => {
  try {
    await trySegment(c.env, c.get('tenant').id, c.req.param('id'), c.req.param('arquivo'), c.req.param('n'));
    return c.json(await state(c, c.req.param('id')));
  } catch (e) {
    return error(c, e);
  }
})

// Quotes against the recording: the audio comes raw in the body (name in x-nome); the transcript goes to the queue.
.post('/:id/gravacoes', requireMember('editor'), withPlan, async (c) => {
  try {
    const name = (() => { try { return decodeURIComponent(c.req.header('x-nome') ?? ''); } catch { return ''; } })();
    const r = await sendAudio(c.env, c.get('tenant').id, c.req.param('id'), c.get('user').id, name, asBuffer(await readBodyUntil(c.req.raw.body, AUDIO_MAX_BYTES)));
    return c.json({ ...(await state(c, c.req.param('id'))), arquivoId: r.id, existia: r.existia }, r.existia ? 200 : 201);
  } catch (e) {
    return error(c, e);
  }
})
.get('/:id/gravacoes/:arquivo/audio', async (c) => {
  try {
    const r = await audioToPlay(c.env, c.get('tenant').id, c.req.param('id'), c.req.param('arquivo'), c.req.header('range'), Math.max(0, Number(c.req.query('t')) || 0));
    return r ?? c.json({ erro: tx(c, 'não encontrado', 'not found') }, 404);
  } catch (e) {
    return error(c, e);
  }
})
.get('/:id/gravacoes/:arquivo/transcricao', async (c) => {
  try {
    return c.json({ trechos: await transcript(c.env, c.get('tenant').id, c.req.param('id'), c.req.param('arquivo')) });
  } catch (e) {
    return error(c, e);
  }
})

// Living story: the alert becomes a new Update or Correction post (the note is the person's) or is closed (text updated, ignored).
.post('/:id/alertas/:alerta/post', requireMember('editor'), async (c) => {
  try {
    const r = await postAlert(c.env, c.get('tenant').id, c.req.param('id'), c.req.param('alerta'), c.get('user').id, await readJson<Record<string, unknown>>(c));
    return c.json({ ...r, estado: await state(c, c.req.param('id')) }, 201);
  } catch (e) {
    return error(c, e);
  }
})
.post('/:id/alertas/:alerta/resolver', requireMember('editor'), async (c) => {
  const { acao: action } = await readJson<{ acao: unknown }>(c);
  try {
    await resolveAlert(c.env, c.get('tenant').id, c.req.param('id'), c.req.param('alerta'), c.get('user').id, action);
    return c.json(await state(c, c.req.param('id')));
  } catch (e) {
    return error(c, e);
  }
})

// LAI: the request ready to paste into the body's portal; then the filing, the extension, the answer and the appeal.
.post('/:id/lai', requireMember('editor'), async (c) => {
  try {
    const r = await createRequestLai(c.env, c.get('tenant').id, c.req.param('id'), c.get('user').id, await readJson<Record<string, unknown>>(c));
    return c.json({ ...(await state(c, c.req.param('id'))), pedidoId: r.id }, 201);
  } catch (e) {
    return error(c, e);
  }
})
.post('/:id/lai/:pedido/:acao', requireMember('editor'), async (c) => {
  try {
    await progressLai(c.env, c.get('tenant').id, c.req.param('id'), c.req.param('pedido'), c.req.param('acao'), { id: c.get('user').id, nome: c.get('user').name ?? '' }, await readJson<Record<string, unknown>>(c));
    return c.json(await state(c, c.req.param('id')));
  } catch (e) {
    return error(c, e);
  }
})

// The gating checklist: the editor signs off publication of this version with the open items there were (recorded).
.post('/:id/assinar', requireMember('editor'), async (c) => {
  const { versao: version } = await readJson<{ versao: unknown }>(c);
  try {
    await sign(c.env, c.get('tenant').id, c.req.param('id'), version, c.get('user').id);
    return c.json(await state(c, c.req.param('id')), 201);
  } catch (e) {
    return error(c, e);
  }
})

.delete('/:id/evidencias/:evidencia', requireMember('editor'), async (c) => {
  try {
    const ok = await removeEvidence(c.env, c.get('tenant').id, c.req.param('id'), c.req.param('evidencia'), c.get('user').id);
    if (!ok) return c.json({ erro: tx(c, 'não encontrado', 'not found') }, 404);
    return c.json(await state(c, c.req.param('id')));
  } catch (e) {
    return error(c, e);
  }
})

// Send back to Docs: only the paragraphs changed on the desk, with writeControl.requiredRevisionId equal to the revision
// read. If Docs changed since, Google refuses and the response carries what changed there (409 `mudou_no_docs`):
// reimport or cancel.
.post('/:id/devolver', requireMember('editor'), async (c) => {
  const tenantId = c.get('tenant').id;
  const id = c.req.param('id');
  const { versao: version } = await readJson<{ versao: unknown }>(c);
  try {
    const t = await readText(c.env, tenantId, id);
    if (t.origem !== 'docs' || !t.docs_id || !t.docs_json || !googleConfigured(c.env)) return c.json({ erro: tx(c, 'não encontrado', 'not found') }, 404);
    requireBody(t);   // text emptied here does not delete the document in Google
    if (version !== undefined && version !== t.versao) return c.json({ erro: tx(c, 'O texto mudou desde que você abriu. Recarregue antes de devolver.', 'The text changed since you opened it. Reload before sending it back.'), code: 'versao', versao: t.versao }, 409);
    const docs: SavedDocs = JSON.parse(t.docs_json);
    const { pedidos: requests, trocados: swapped } = requestsReturn(docs, JSON.parse(t.paragrafos_json));
    if (!requests.length) return c.json({ ...(await state(c, id)), devolvidos: 0 });
    const userId = c.get('user').id;
    let created: string | null;
    try {
      created = await updateDocument(c.env, userId, t.docs_id, t.docs_revisao ?? '', requests);
    } catch (e) {
      if (!(e instanceof GoogleError) || e.codigo !== 'mudou_no_docs') throw e;
      const current = await readDocument(c.env, userId, t.docs_id);
      return c.json({ erro: tx(c, e.message, e.en ?? e.message), code: e.codigo, mudancas: changes(docs.paragrafos.map((p) => p.texto), fromDocBody(current)) }, 409);
    }
    // Sent back: the revision and the positions become those of the revision the send-back created. If Docs is already at
    // another one (someone edited between the send-back and this read), the snapshot stays the earlier one: the next
    // send-back is refused by Google and the screen shows what changed, instead of undoing the edit there.
    const d = await readDocument(c.env, userId, t.docs_id);
    if (created && d.revisao === created) {
      await c.env.DB.prepare('UPDATE textos SET docs_revisao = ?, docs_json = ? WHERE id = ? AND tenant_id = ?').bind(d.revisao, JSON.stringify(snapshot(d)), id, tenantId).run();
    }
    await recordEvent(c.env, tenantId, 'texto.devolvido', 'texto', id, { por: userId, paragrafos: swapped, revisao: created });
    return c.json({ ...(await state(c, id)), devolvidos: swapped });
  } catch (e) {
    return error(c, e);
  }
})

// Reimport from Docs (after a refused send-back): the text from there replaces the desk's (the screen warns that the
// desk's edits are lost) and the check runs again.
.post('/:id/reimportar', requireMember('editor'), async (c) => {
  const tenantId = c.get('tenant').id;
  const id = c.req.param('id');
  const { versao: version } = await readJson<{ versao: unknown }>(c);
  if (!Number.isInteger(version)) return c.json({ erro: tx(c, 'versao: inteiro', 'versao: integer') }, 400);
  const changed = (current: number) => c.json({ erro: tx(c, 'Outra pessoa salvou este texto enquanto isso. Recarregue antes de reimportar.', 'Someone else saved this text in the meantime. Reload before re-importing.'), code: 'versao', versao: current }, 409);
  try {
    const t = await readText(c.env, tenantId, id);
    if (t.origem !== 'docs' || !t.docs_id || !googleConfigured(c.env)) return c.json({ erro: tx(c, 'não encontrado', 'not found') }, 404);
    if (t.versao !== version) return changed(t.versao);
    const d = await readDocument(c.env, c.get('user').id, t.docs_id);
    const paragraphs = fromDocBody(d);
    const e = bodyError(paragraphs, language(c));
    if (e) throw new DeskError('texto_invalido', e);
    // The batch is a transaction: the cleanup runs before the version switch and only with the text still at the version N
    // this reimport read. Whoever moved to N+1 first (another reimport, or someone who saved) does not lose marks: here the
    // cleanup does not find version N, and neither does the switch.
    const inVersionRead = `EXISTS (SELECT 1 FROM textos WHERE id = ? AND tenant_id = ? AND versao = ?)`;
    const [, , r] = await c.env.DB.batch([
      c.env.DB.prepare(`DELETE FROM afirmacoes WHERE texto_id = ? AND tenant_id = ? AND ${inVersionRead}`).bind(id, tenantId, id, tenantId, version),
      c.env.DB.prepare(`DELETE FROM blocos WHERE texto_id = ? AND tenant_id = ? AND ${inVersionRead}`).bind(id, tenantId, id, tenantId, version),
      // The editor's document goes back to the one converted from Docs (its formatting); marks and blocks start over.
      c.env.DB.prepare(`UPDATE textos SET titulo = ?, paragrafos_json = ?, doc_json = NULL, docs_revisao = ?, docs_json = ?, versao = versao + 1, updated_at = datetime('now')
                         WHERE id = ? AND tenant_id = ? AND versao = ? RETURNING versao`)
        .bind((d.titulo || t.titulo).slice(0, 300), JSON.stringify(paragraphs), d.revisao, JSON.stringify(snapshot(d)), id, tenantId, version),
    ]);
    if (!r.results.length) return changed((await readText(c.env, tenantId, id)).versao);
    await checkText(c.env, tenantId, id);
    return c.json(await state(c, id));
  } catch (e) {
    return error(c, e);
  }
})

// The Story's Posts tab: the pieces from all the leads that came out of the text, with their status.
.get('/:id/posts', async (c) => {
  try {
    await readText(c.env, c.get('tenant').id, c.req.param('id'));
    return c.json({ posts: await postsStory(c.env, c.get('tenant').id, c.req.param('id')) });
  } catch (e) {
    return error(c, e);
  }
})

// Send to Instagram: the lead is built from the checked claims (the author's sentence + evidence), not from the whole
// text. An open checklist item without the editor's signature: 409 with the list (`pendencias`). Goes into production as a carousel.
.post('/:id/instagram', requireMember('editor'), async (c) => {
  const { cardFontes: cardSources } = await readJson<{ cardFontes: unknown }>(c);
  try {
    const r = await leadStory(c.env, c.get('tenant').id, c.req.param('id'), c.get('user').id, { cardFontes: cardSources === true });
    return c.json(r, 201);
  } catch (e) {
    return error(c, e);
  }
});
