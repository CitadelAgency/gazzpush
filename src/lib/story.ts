import type { Env } from '../env';
import { newId, recordEvent, sha256Hex } from './db';
import { DeskError, requireBody, readText } from './desk';
import { analyze, type Analysis, type Pending } from './assistant';
import { fromDocUrl } from './google';
import { produceLead } from './produce';
import { scoreManual } from './triage';
import { inArPage } from './shield';
import { retractVersion } from './versions';

// The Story (author outlet): the journalist reports once, and everything that goes out carries the proof with it. "Send
// to Instagram" no longer passes the whole text as an account: the lead is built with facts from the checked claims (the
// author's sentence, the evidence URL and its literal passage). An unsourced sentence does not become a fact; an open
// legal risk blocks sending, with the list of what is missing.

export type { Pending as Pendencia } from './assistant';

export class StoryError extends DeskError {
  constructor(code: string, message: string, status: 409 | 422, en: string, readonly pendencias: Pending[] = []) {
    super(code, message, status, en);
  }
}

interface Base { afirmacaoId: string; trecho: string; evidenciaId: string; evidenciaTrecho: string; url: string; titulo: string | null; r2: string }

/**
 * Story facts: the sentence with the evidence that supports it (a source attached by the person outweighs the model's)
 * and the "my own claims" (the author's opinion, without evidence). An unsourced, ignored or risky sentence does not
 * become a fact.
 */
export function factsAnalysis(an: Analysis): { comFonte: Base[]; minhas: { afirmacaoId: string; trecho: string }[] } {
  const evs = new Map(an.evidencias.map((e) => [e.id, e]));
  const withSource: Base[] = [];
  const my: { afirmacaoId: string; trecho: string }[] = [];
  for (const a of an.afirmacoes) {
    const ap = a.apuracao;
    if (ap?.tipo === 'opiniao') { my.push({ afirmacaoId: a.id, trecho: a.trecho }); continue; }
    const [evId, evPassage] = ap?.tipo === 'fonte' ? [ap.evidenciaId, ap.evidenciaTrecho] : !ap && a.estado === 'com_evidencia' && !a.incerto ? [a.evidenciaId, a.evidenciaTrecho] : [null, null];
    const e = evId ? evs.get(evId) : undefined;
    if (e && evPassage) withSource.push({ afirmacaoId: a.id, trecho: a.trecho, evidenciaId: e.id, evidenciaTrecho: evPassage, url: e.url, titulo: e.titulo, r2: e.r2 });
  }
  return { comFonte: withSource, minhas: my };
}

export type Sent = { pautaId: string; pecaId: string | null; situacao: 'nova' | 'existente' };

/**
 * Story → carousel lead. The version must be checked; an open risk gives 409 with the list; without a claim with
 * evidence, 422. The same version sent again returns the active lead (and its post). Each piece of evidence used becomes
 * a document (its URL is the fact's source); each claim, a fact with the evidence's passage.
 */
/**
 * Publishing checklist: with open items (open risk, unchecked paragraph, unsourced quote, a sum that does not add up),
 * the Story only goes out (Instagram, sources page) with the editor's signature on this version.
 */
export function requireChecklist(an: Analysis) {
  if (an.pendencias.length && !an.assinatura) {
    const n = an.pendencias.length;
    throw new StoryError('checklist', n === 1
      ? 'Falta 1 item do checklist de publicação. Resolva ou peça ao editor para assinar a publicação.'
      : `Faltam ${n} itens do checklist de publicação. Resolva ou peça ao editor para assinar a publicação.`, 409,
    n === 1 ? '1 publication checklist item is open. Resolve it or ask the editor to sign off the publication.' : `${n} publication checklist items are open. Resolve them or ask the editor to sign off the publication.`,
    an.pendencias);
  }
}

export async function leadStory(env: Env, tenantId: string, textId: string, actor: string, options: { cardFontes?: boolean } = {}): Promise<Sent> {
  const t = await readText(env, tenantId, textId);
  requireBody(t);
  const an = await analyze(env, tenantId, textId, t);
  requireChecklist(an);
  // Final "How we reported this" card: only with the sources page live.
  let sourcesUrl: string | null = null;
  if (options.cardFontes) {
    const page = await inArPage(env, tenantId, textId);
    if (!page) throw new StoryError('sem_pagina', 'Publique a página de fontes antes de pôr o card "Como apuramos" no carrossel.', 409, 'Publish the sources page before adding the "How we reported this" card to the carousel.');
    // The card leads to this version's sources: another version's page being live would point to the earlier text.
    if (page.versao !== t.versao) throw new StoryError('pagina_antiga', `A página de fontes no ar é da versão ${page.versao}. Publique a versão atual antes de pôr o card "Como apuramos" no carrossel.`, 409, `The live sources page is from version ${page.versao}. Publish the current version before adding the "How we reported this" card to the carousel.`);
    sourcesUrl = page.url;
  }
  await retractVersion(env, tenantId, t, 'instagram');

  const { comFonte: base, minhas: my } = factsAnalysis(an);
  // The lead's identity: the text version and the reporting state (each fact's sentence, evidence and passage; the own
  // claims). Removing a source, ignoring a sentence or marking an opinion changes the key and sending builds another lead.
  const key = await sha256Hex(JSON.stringify({ v: t.versao, f: base.map((b) => [b.trecho, b.evidenciaId, b.evidenciaTrecho]), m: my.map((m) => m.trecho) }));

  // The same version, with the same reporting, already became a lead and it is still active: return it (and its post).
  // A production that failed (lead back to accepted, piece failed) starts again.
  const existing = async () => {
    const active = await env.DB.prepare(
      `SELECT id, status FROM pautas WHERE tenant_id = ? AND texto_id = ? AND materia_chave = ? AND status IN ('sugerida', 'aceita', 'em_producao')
        ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    ).bind(tenantId, textId, key).first<{ id: string; status: string }>();
    if (!active) return null;
    if (sourcesUrl) await env.DB.prepare('UPDATE pautas SET fontes_url = ? WHERE id = ? AND tenant_id = ?').bind(sourcesUrl, active.id, tenantId).run();
    const last = await env.DB.prepare('SELECT id, status FROM pecas WHERE pauta_id = ? AND tenant_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1')
      .bind(active.id, tenantId).first<{ id: string; status: string }>();
    let pieceId = last?.id ?? null;
    if (!last || (last.status === 'falhou' && active.status !== 'em_producao')) {
      pieceId = (await produceLead(env, tenantId, active.id, actor, 'carrossel'))?.pecaId ?? await lastPiece(env, tenantId, active.id);
    }
    return { pautaId: active.id, pecaId: pieceId, situacao: 'existente' as const };
  };
  await oldAdoptLead(env, tenantId, textId, t.versao, key, base, my);
  const already = await existing();
  if (already) return already;

  if (!base.length) {
    throw new StoryError('sem_fatos', 'Nenhuma afirmação do texto tem evidência no dossiê. Acrescente as fontes e confira de novo: frase sem fonte não vai para o carrossel.', 422,
      'No claim in the text has evidence in the dossier. Add the sources and check again: a sentence without a source does not go into the carousel.');
  }

  const leadId = newId();
  // One document per piece of evidence used (the fact's source is its URL; the saved text is the same as the dossier's).
  const docs = new Map<string, string>();
  for (const b of base) if (!docs.has(b.evidenciaId)) docs.set(b.evidenciaId, newId());
  const perEvidence = new Map(base.map((b) => [b.evidenciaId, b]));
  const facts = base.map((b) => ({ id: newId(), ...b }));
  // "My own claim": the source is the author themselves (the text in Docs or the outlet's address).
  const brand = await env.DB.prepare('SELECT marca_json FROM tenants WHERE id = ?').bind(tenantId).first<{ marca_json: string | null }>();
  const authorUrl = t.docs_id ? fromDocUrl(t.docs_id) : (JSON.parse(brand?.marca_json ?? '{}') as { ctaUrl?: string }).ctaUrl ?? env.PUBLIC_BASE_URL;
  const docAuthor = my.length ? newId() : null;
  const opinions = my.map((m) => ({ id: newId(), ...m }));
  const stmts = [
    ...(docAuthor ? [env.DB.prepare(
      `INSERT INTO documentos (id, tenant_id, fonte_id, url, hash_texto, titulo, r2_texto, status, triagem) VALUES (?, ?, NULL, ?, ?, ?, NULL, 'triado', 'autoral')`,
    ).bind(docAuthor, tenantId, authorUrl, `materia:${leadId}:autor`, t.titulo)] : []),
    ...opinions.map((f) => env.DB.prepare(
      `INSERT INTO fatos (id, tenant_id, documento_id, tipo, texto, hash, confianca) VALUES (?, ?, ?, 'opiniao', ?, ?, 1)`,
    ).bind(f.id, tenantId, docAuthor, f.trecho, `materia:${leadId}:${f.afirmacaoId}`)),
    ...[...docs].map(([evId, docId]) => {
      const e = perEvidence.get(evId)!;
      return env.DB.prepare(
        `INSERT INTO documentos (id, tenant_id, fonte_id, url, hash_texto, titulo, r2_texto, status, triagem) VALUES (?, ?, NULL, ?, ?, ?, ?, 'triado', 'autoral')`,
      ).bind(docId, tenantId, e.url, `materia:${leadId}:${evId}`, e.titulo, e.r2);
    }),
    ...facts.map((f) => env.DB.prepare(
      `INSERT INTO fatos (id, tenant_id, documento_id, tipo, texto, hash, evidencia_id, evidencia_trecho, confianca) VALUES (?, ?, ?, 'afirmacao', ?, ?, ?, ?, 1)`,
    ).bind(f.id, tenantId, docs.get(f.evidenciaId), f.trecho, `materia:${leadId}:${f.afirmacaoId}`, f.evidenciaId, f.evidenciaTrecho)),
    env.DB.prepare(
      `INSERT INTO pautas (id, tenant_id, status, origem, titulo, resumo, fato_ids_json, documento_ids_json, score, texto_id, texto_versao, fontes_url, materia_chave)
       VALUES (?, ?, 'sugerida', 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(leadId, tenantId, t.titulo, facts[0].trecho, JSON.stringify([...facts, ...opinions].map((f) => f.id)), JSON.stringify([...docs.values(), ...(docAuthor ? [docAuthor] : [])]), scoreManual(new Date()), textId, t.versao, sourcesUrl, key),
    env.DB.prepare('UPDATE textos SET pauta_id = ? WHERE id = ? AND tenant_id = ?').bind(leadId, textId, tenantId),
  ];
  try {
    await env.DB.batch(stmts);
  } catch (e) {
    // Two sends at the same time: the unique index lets one in; the other returns the lead that got in.
    if (!/UNIQUE/i.test(String(e))) throw e;
    const winner = await existing();
    if (!winner) throw e;
    return winner;
  }
  await recordEvent(env, tenantId, 'materia.instagram', 'texto', textId, { por: actor, pautaId: leadId, versao: t.versao, fatos: facts.length, minhas: opinions.length, assinada: an.assinatura?.id ?? null });
  const pieceId = (await produceLead(env, tenantId, leadId, actor, 'carrossel'))?.pecaId ?? await lastPiece(env, tenantId, leadId);
  return { pautaId: leadId, pecaId: pieceId, situacao: 'nova' };
}

/**
 * A Story lead created before the key existed (migration 0016, `materia_chave` null): if it is from the same version and
 * has exactly the same facts (sentence, evidence and passage; the own claims), it gets the key and becomes the reused
 * lead again. Different facts: it stays as is, and sending builds another.
 */
async function oldAdoptLead(env: Env, tenantId: string, textId: string, version: number, key: string,
  base: { trecho: string; evidenciaId: string; evidenciaTrecho: string }[], my: { trecho: string }[]) {
  const { results: old } = await env.DB.prepare(
    `SELECT id, fato_ids_json FROM pautas WHERE tenant_id = ? AND texto_id = ? AND texto_versao = ? AND materia_chave IS NULL AND tipo_post IS NULL
        AND status IN ('sugerida', 'aceita', 'em_producao') ORDER BY created_at DESC, rowid DESC LIMIT 5`,
  ).bind(tenantId, textId, version).all<{ id: string; fato_ids_json: string }>();
  if (!old.length) return;
  const signature = (fs: string[][]) => JSON.stringify(fs.map((f) => JSON.stringify(f)).sort());
  const want = signature([...base.map((b) => ['afirmacao', b.trecho, b.evidenciaId, b.evidenciaTrecho]), ...my.map((m) => ['opiniao', m.trecho, '', ''])]);
  for (const p of old) {
    const { results: facts } = await env.DB.prepare(
      'SELECT tipo, texto, evidencia_id, evidencia_trecho FROM fatos WHERE tenant_id = ? AND id IN (SELECT value FROM json_each(?))',
    ).bind(tenantId, p.fato_ids_json).all<{ tipo: string; texto: string; evidencia_id: string | null; evidencia_trecho: string | null }>();
    if (signature(facts.map((f) => [f.tipo, f.texto, f.evidencia_id ?? '', f.evidencia_trecho ?? ''])) !== want) continue;
    // Another send may have given the key to another lead in the meantime: the unique index rejects it, and the one that has it counts.
    await env.DB.prepare('UPDATE pautas SET materia_chave = ? WHERE id = ? AND tenant_id = ? AND materia_chave IS NULL').bind(key, p.id, tenantId).run()
      .catch((e) => { if (!/UNIQUE/i.test(String(e))) throw e; });
    return;
  }
}

async function lastPiece(env: Env, tenantId: string, leadId: string): Promise<string | null> {
  const p = await env.DB.prepare('SELECT id FROM pecas WHERE pauta_id = ? AND tenant_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1')
    .bind(leadId, tenantId).first<{ id: string }>();
  return p?.id ?? null;
}

/** Posts tab: the pieces from all of the text's leads, with status and published link. */
export async function postsStory(env: Env, tenantId: string, textId: string) {
  const { results } = await env.DB.prepare(
    `SELECT pe.id, pe.formato, pe.status, pe.created_at, pe.updated_at, pe.conteudo_json, pa.titulo, pa.texto_versao,
            (SELECT pu.url FROM publicacoes pu WHERE pu.peca_id = pe.id AND pu.tenant_id = pe.tenant_id AND pu.status = 'publicada' ORDER BY pu.created_at DESC LIMIT 1) AS url
       FROM pautas pa JOIN pecas pe ON pe.pauta_id = pa.id AND pe.tenant_id = pa.tenant_id
      WHERE pa.tenant_id = ? AND pa.texto_id = ?
      ORDER BY pe.created_at DESC, pe.rowid DESC LIMIT 100`,
  ).bind(tenantId, textId).all<{ id: string; formato: string; status: string; created_at: string; updated_at: string; conteudo_json: string; titulo: string; texto_versao: number | null; url: string | null }>();
  return results.map((p) => {
    const c = JSON.parse(p.conteudo_json || '{}') as { manchete?: string };
    return { id: p.id, formato: p.formato, status: p.status, criadoEm: p.created_at, atualizadoEm: p.updated_at, manchete: c.manchete ?? null, titulo: p.titulo, versaoTexto: p.texto_versao, url: p.url };
  });
}
