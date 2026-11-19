import type { Env } from '../env';
import { retractVersion } from './versions';
import { crossWithText } from './document';
import { findInRecording, mmss, transcriptsText, type InRecording } from './recording';
import { newId, recordEvent } from './db';
import { validDate, todayIso } from './lai';
import {
  MEANS_OTHER_SIDE, RISKS_OTHER_SIDE, TOPICS, DECISION_TYPES, SOURCE_TYPES, RULE_TYPES, quotesBlock, citesName, accountsBlock, circularSources,
  strengthOf, spellingsDifferent, manualInBlock, openBrand, fromTextNames, suggestedType, TOPIC_SENSITIVE,
  type Language, type Rule, type DecisionType, type SourceType, type RuleType,
} from './reporting';
import { DeskError, statesBlocks, structure, readText, linesBlocks, type TextLine } from './desk';
import { secondModel, secondOn } from './secondOpinion';
import { fromOutletKeys } from './providers';

// The Story editor's assistant (Phase 3): what the person records about their reporting on the card (it never writes
// text), what code checks without a model (arithmetic, quotes, names, style guide, sources) and the checklist that gates
// publishing.

export interface Reporting {
  id: string; blocoId: string; trecho: string; tipo: DecisionType; evidenciaId: string | null; evidenciaTrecho: string | null;
  outroLado: { quem: string; quando: string; meio: string } | null; por: string; porNome: string | null; em: string;
}

interface ReportingLine {
  id: string; bloco_id: string; trecho: string; tipo: DecisionType; evidencia_id: string | null; evidencia_trecho: string | null;
  outro_lado_quem: string | null; outro_lado_quando: string | null; outro_lado_meio: string | null; por: string; nome: string | null; created_at: string;
}

const reportingLine = (r: ReportingLine): Reporting => ({
  id: r.id, blocoId: r.bloco_id, trecho: r.trecho, tipo: r.tipo, evidenciaId: r.evidencia_id, evidenciaTrecho: r.evidencia_trecho,
  outroLado: r.outro_lado_quem ? { quem: r.outro_lado_quem, quando: r.outro_lado_quando ?? '', meio: r.outro_lado_meio ?? 'outro' } : null,
  por: r.por, porNome: r.nome, em: r.created_at,
});

/** The text's standing reporting entries (not undone), oldest to newest. */
export async function reportingDecisionsActive(env: Env, tenantId: string, textId: string): Promise<Reporting[]> {
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.bloco_id, a.trecho, a.tipo, a.evidencia_id, a.evidencia_trecho, a.outro_lado_quem, a.outro_lado_quando, a.outro_lado_meio, a.por, u.name AS nome, a.created_at
       FROM apuracoes a LEFT JOIN "user" u ON u.id = a.por
      WHERE a.tenant_id = ? AND a.texto_id = ? AND a.desfeita_em IS NULL ORDER BY a.created_at, a.rowid`,
  ).bind(tenantId, textId).all<ReportingLine>();
  return results.map(reportingLine);
}

/** The sentence's newest reporting entry (same block and same literal passage). */
export const reportingOf = (aps: Reporting[], blockId: string, passage: string) => aps.filter((a) => a.blocoId === blockId && a.trecho === passage).at(-1) ?? null;

export interface EvidenceRead {
  id: string; url: string; titulo: string | null; tipoFonte: SourceType | null; r2: string; texto: string; conferidaEm: string; mudouEm: string | null; viaNavegador: boolean; criadaEm: string;
  /** link (a page read) or reply (from the other side, by email or pasted): a reply has no page and no Wayback. */
  origem: 'link' | 'resposta' | 'documento' | 'lai'; hash: string;
  wayback: { estado: 'pendente' | 'salvo' | 'falhou'; url: string | null; em: string | null; erro: string | null } | null;
}

export async function evidenceWithText(env: Env, tenantId: string, textId: string): Promise<EvidenceRead[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, url, titulo, tipo_fonte, r2_texto, conferida_em, mudou_em, via_navegador, created_at, origem, hash, wayback_estado, wayback_url, wayback_em, wayback_erro
       FROM evidencias WHERE texto_id = ? AND tenant_id = ? ORDER BY created_at, rowid`,
  ).bind(textId, tenantId).all<{
    id: string; url: string; titulo: string | null; tipo_fonte: string | null; r2_texto: string; conferida_em: string; mudou_em: string | null; via_navegador: number; created_at: string;
    origem: string; hash: string; wayback_estado: string | null; wayback_url: string | null; wayback_em: string | null; wayback_erro: string | null;
  }>();
  return Promise.all(results.map(async (e) => ({
    id: e.id, url: e.url, titulo: e.titulo, tipoFonte: (SOURCE_TYPES as readonly string[]).includes(e.tipo_fonte ?? '') ? (e.tipo_fonte as SourceType) : null,
    r2: e.r2_texto, texto: (await env.MEDIA.get(e.r2_texto).then((x) => x?.text())) ?? '', conferidaEm: e.conferida_em, mudouEm: e.mudou_em,
    viaNavegador: e.via_navegador === 1, criadaEm: e.created_at, origem: e.origem === 'resposta' || e.origem === 'documento' || e.origem === 'lai' ? e.origem : 'link' as const, hash: e.hash,
    wayback: e.wayback_estado === 'pendente' || e.wayback_estado === 'salvo' || e.wayback_estado === 'falhou'
      ? { estado: e.wayback_estado, url: e.wayback_url, em: e.wayback_em, erro: e.wayback_erro } : null,
  })));
}

export async function fromManualRules(env: Env, tenantId: string): Promise<(Rule & { criadaEm: string })[]> {
  const { results } = await env.DB.prepare('SELECT id, tipo, procurar, preferir, nota, created_at FROM manual_regras WHERE tenant_id = ? ORDER BY tipo, procurar')
    .bind(tenantId).all<{ id: string; tipo: RuleType; procurar: string; preferir: string | null; nota: string | null; created_at: string }>();
  return results.map((r) => ({ id: r.id, tipo: r.tipo, procurar: r.procurar, preferir: r.preferir, nota: r.nota, criadaEm: r.created_at }));
}

export interface Pending { tipo: 'risco' | 'paragrafo' | 'aspa' | 'conta'; id: string; blocoId: string | null; trecho: string; explicacao: string | null; risco?: string | null }

export interface ValidClaim {
  id: string; paragrafo: number; inicio: number; fim: number; trecho: string; estado: 'com_evidencia' | 'sem_fonte' | 'risco'; risco: string | null;
  evidenciaId: string | null; evidenciaTrecho: string | null; explicacao: string | null; blocoId: string; incerto: boolean; aberta: boolean; apuracao: Reporting | null;
}

const tr = (language: Language, pt: string, en: string) => (language === 'en' ? en : pt);

/**
 * Everything the Story knows about the text now: blocks and each one's state, the claims that stand (from a block
 * checked with the current hash) with the person's reporting, the dossier with source strength, code findings
 * (arithmetic, unsourced quotes, style guide), people and institutions, and the publishing checklist.
 */
export async function analyze(env: Env, tenantId: string, textId: string, t?: TextLine) {
  t ??= await readText(env, tenantId, textId);
  const [tenant, state, lines, aps, evs, rules, signature, keys] = await Promise.all([
    env.DB.prepare('SELECT idioma FROM tenants WHERE id = ?').bind(tenantId).first<{ idioma: string | null }>(),
    structure(t),
    linesBlocks(env, tenantId, textId),
    reportingDecisionsActive(env, tenantId, textId),
    evidenceWithText(env, tenantId, textId),
    fromManualRules(env, tenantId),
    env.DB.prepare(`SELECT s.id, s.por, u.name AS nome, s.created_at, s.pendencias_json FROM assinaturas s LEFT JOIN "user" u ON u.id = s.por
                     WHERE s.tenant_id = ? AND s.texto_id = ? AND s.versao = ? ORDER BY s.created_at DESC LIMIT 1`)
      .bind(tenantId, textId, t.versao).first<{ id: string; por: string; nome: string | null; created_at: string; pendencias_json: string }>(),
    fromOutletKeys(env, tenantId),
  ]);
  const language: Language = tenant?.idioma === 'en' ? 'en' : 'pt-BR';
  const { results: linesAf } = await env.DB.prepare(
    `SELECT id, paragrafo, inicio, fim, trecho, estado, risco, evidencia_id, evidencia_trecho, explicacao, bloco_id, incerto
       FROM afirmacoes WHERE texto_id = ? AND tenant_id = ? ORDER BY paragrafo, inicio`,
  ).bind(textId, tenantId).all<Record<string, unknown>>();

  // Older text, never saved by the editor nor checked per block: the version's check applies (marks by index).
  const legacy = !t.doc_json && !lines.size;
  const blocks = statesBlocks(state, lines, legacy && t.conferido_versao === t.versao);
  const checked = new Set(blocks.filter((b) => b.estado === 'conferido').map((b) => b.id));
  const claims: ValidClaim[] = [];
  for (const a of linesAf) {
    const blockId = (a.bloco_id as string | null) ?? (legacy ? state.blocos[a.paragrafo as number]?.id ?? null : null);
    if (!blockId || !checked.has(blockId)) continue;
    const base = {
      id: a.id as string, paragrafo: a.paragrafo as number, inicio: a.inicio as number, fim: a.fim as number, trecho: a.trecho as string,
      estado: a.estado as ValidClaim['estado'], risco: a.risco as string | null, evidenciaId: a.evidencia_id as string | null,
      evidenciaTrecho: a.evidencia_trecho as string | null, explicacao: a.explicacao as string | null, blocoId: blockId, incerto: a.incerto === 1,
    };
    const reporting = reportingOf(aps, blockId, base.trecho);
    claims.push({ ...base, apuracao: reporting, aberta: openBrand(base, reporting) });
  }

  // Code findings, block by block (the current text, not the checked one: a wrong sum shows up on save).
  const withText = evs.map((e) => ({ id: e.id, texto: e.texto }));
  const findings: { id: string; tipo: 'conta' | 'aspa' | 'manual' | 'gravacao'; blocoId: string; inicio: number; fim: number; trecho: string; explicacao: string; regraTipo?: string; gravacao?: InRecording }[] = [];
  // Quotes against the recording (Phase 6): a quotation not found in a dossier source is looked up, word by word, in the
  // ready transcripts. A recording still being transcribed: the quote stays open and says so (it never goes silent).
  const recs = await transcriptsText(env, tenantId, textId);
  for (const b of state.blocos) {
    if (!b.texto.trim()) continue;
    for (const c of accountsBlock(b.id, b.texto, language)) findings.push({ id: `conta:${b.id}:${c.inicio}`, tipo: 'conta', ...c });
    for (const a of quotesBlock(b.id, b.texto, withText)) {
      if (a.evidenciaId) continue;
      const g = findInRecording(a.citacao, recs.prontas);
      if (g) {
        findings.push({ id: `grav:${b.id}:${a.inicio}`, tipo: 'gravacao', blocoId: b.id, inicio: a.inicio, fim: a.fim, trecho: a.trecho, gravacao: g,
          explicacao: tr(language, `Bate com a gravação aos ${mmss(g.inicio)} (${g.nome}), palavra por palavra.`, `Matches the recording at ${mmss(g.inicio)} (${g.nome}), word for word.`) });
        continue;
      }
      findings.push({ id: `aspa:${b.id}:${a.inicio}`, tipo: 'aspa', blocoId: b.id, inicio: a.inicio, fim: a.fim, trecho: a.trecho,
        explicacao: !recs.total
          ? tr(language, 'Esta citação não está, letra por letra, em nenhuma fonte do dossiê.', 'This quote is not, word for word, in any dossier source.')
          : recs.lendo
            ? tr(language, 'Esta citação não está em nenhuma fonte do dossiê nem nas gravações transcritas; uma gravação ainda está sendo transcrita.', 'This quote is not in any dossier source or transcribed recording; a recording is still being transcribed.')
            : tr(language, 'Esta citação não está, palavra por palavra, em nenhuma fonte do dossiê nem nas gravações.', 'This quote is not, word for word, in any dossier source or recording.') });
    }
    for (const m of manualInBlock(b.id, b.texto, rules, language)) findings.push({ id: `manual:${b.id}:${m.inicio}`, tipo: 'manual', blocoId: m.blocoId, inicio: m.inicio, fim: m.fim, trecho: m.trecho, explicacao: m.explicacao, regraTipo: m.tipo });
  }

  // Dossier documents (Phase 5): the total the sentence states against the total (or sum) the document has.
  const { results: docs } = await env.DB.prepare("SELECT id, nome, totais_json FROM arquivos WHERE texto_id = ? AND tenant_id = ? AND estado = 'pronto' AND totais_json IS NOT NULL")
    .bind(textId, tenantId).all<{ id: string; nome: string; totais_json: string }>();
  if (docs.length) {
    const withDocs = docs.map((d) => ({ id: d.id, nome: d.nome, totais: JSON.parse(d.totais_json) }));
    for (const c of crossWithText(state.blocos.filter((b) => b.texto.trim()), withDocs, language)) {
      findings.push({ id: `doc:${c.blocoId}:${c.inicio}`, tipo: 'conta', blocoId: c.blocoId, inicio: c.inicio, fim: c.inicio + c.trecho.length, trecho: c.trecho, explicacao: c.explicacao });
    }
  }

  // People and institutions: mentions, different spellings and, for whoever the text accuses, whether the other side was contacted.
  const names = fromTextNames(state.blocos);
  const spellings = spellingsDifferent(names);
  const accusations = claims.filter((a) => a.estado === 'risco' && RISKS_OTHER_SIDE.includes(a.risco ?? ''));
  const othersSides = aps.filter((a) => a.tipo === 'outro_lado' && a.outroLado);
  // A contact recorded on a sentence counts for whoever was contacted (the name in "quem") and, through the sentence,
  // only when it mentions a single person: in a sentence that accuses two, contacting one is not contacting the other.
  const onlyOneInSentence = (passage: string, name: string) => {
    const cited = names.filter((m) => m.tipo === 'pessoa' && citesName(passage, m.nome));
    return cited.length === 1 && cited[0].nome === name;
  };
  const people = names.map((n) => {
    const accused = accusations.some((a) => citesName(a.trecho, n.nome));
    const contacted = othersSides.find((o) => citesName(o.outroLado!.quem, n.nome) || citesName(n.nome, o.outroLado!.quem) || onlyOneInSentence(o.trecho, n.nome));
    return {
      nome: n.nome, tipo: n.tipo, mencoes: n.mencoes.length, primeira: n.mencoes[0],
      grafias: spellings.find((g) => g.includes(n.nome))?.filter((x) => x !== n.nome) ?? [],
      acusada: accused, outroLado: contacted ? { ...contacted.outroLado!, por: contacted.porNome, em: contacted.em } : null,
    };
  });

  // Sources: strength by type, official suggestion by address, circular sources and text resting on a single source.
  const circular = circularSources(evs);
  const supports = claims.flatMap((a) => (a.apuracao?.tipo === 'fonte' ? [a.apuracao.evidenciaId] : !a.apuracao && a.estado === 'com_evidencia' && a.evidenciaId ? [a.evidenciaId] : []));
  const uniqueSource = supports.length >= 2 && new Set(supports).size === 1 && evs.length > 0 ? supports[0] : null;

  // Publishing checklist.
  const pendingItems: Pending[] = [];
  for (const a of claims) {
    if (a.aberta && (a.estado === 'risco' || a.incerto)) pendingItems.push({ tipo: 'risco', id: a.id, blocoId: a.blocoId, trecho: a.trecho, explicacao: a.explicacao, risco: a.risco });
  }
  for (const b of blocks) {
    const block = state.blocos.find((x) => x.id === b.id)!;
    if (b.estado !== 'conferido' && block.texto.trim()) {
      pendingItems.push({ tipo: 'paragrafo', id: `paragrafo:${b.id}`, blocoId: b.id, trecho: block.texto.slice(0, 160),
        explicacao: b.erro ?? tr(language, 'Parágrafo ainda não conferido.', 'Paragraph not checked yet.') });
    }
  }
  for (const p of findings) if (p.tipo === 'aspa' || p.tipo === 'conta') pendingItems.push({ tipo: p.tipo, id: p.id, blocoId: p.blocoId, trecho: p.trecho, explicacao: p.explicacao });

  // The signature covers the open items the editor saw when signing. A new open item on the same version (a source left
  // the dossier, a quote lost its evidence): the signature does not cover it, and the checklist asks again.
  const signed = signature ? new Set((JSON.parse(signature.pendencias_json) as Pending[]).map(pendingKey)) : null;
  const validSignature = signature && pendingItems.every((p) => signed!.has(pendingKey(p))) ? signature : null;
  return {
    t, idioma: language, est: state, blocos: blocks, afirmacoes: claims, apuracoes: aps, evidencias: evs, regras: rules, apontamentos: findings, pessoas: people, circulares: circular, fonteUnica: uniqueSource, pendencias: pendingItems,
    assinatura: validSignature ? { id: validSignature.id, por: validSignature.nome, em: validSignature.created_at, pendencias: signed!.size } : null,
    segunda: { ligada: secondOn(keys), modelo: secondOn(keys) ? secondModel(env) : null },
    // Who checks the text (DeepSeek or Gemini), so the screen names the right one; null: no text key.
    provedorTexto: keys.texto?.provedor ?? null,
    temaSensivel: TOPIC_SENSITIVE.test(state.blocos.map((b) => b.texto).join('\n')),
  };
}
export type Analysis = Awaited<ReturnType<typeof analyze>>;

/**
 * The open item by what it is (type, paragraph, passage and, for a risk, the risk type), not by the mark id, which
 * changes on every re-check. The same passage with another risk (it was "no other side", it became "victim or minor")
 * asks for another signature.
 */
const pendingKey = (p: Pick<Pending, 'tipo' | 'blocoId' | 'trecho' | 'risco'>) => `${p.tipo}|${p.blocoId ?? ''}|${p.trecho}|${p.tipo === 'risco' ? p.risco ?? '' : ''}`;

/** Each piece of evidence's strength, for the screen (the type the person chose, or the suggestion from the address). */
export const strengthEvidence = (e: { url: string; tipoFonte: SourceType | null }) => ({ tipoFonte: e.tipoFonte, tipoSugerido: suggestedType(e.url), forca: strengthOf(e.tipoFonte) });

// ── card actions ────────────────────────────────────────────────────────────────────────────────────────────────

const error400 = (code: string, pt: string, en: string, status: 400 | 404 | 409 | 422 = 400) => new DeskError(code, pt, status, en);

/**
 * Records the card action on a claim in the text. Attaching a source: the evidence is in this text's dossier and the
 * passage is literally in its saved text (otherwise 422). Other side: only on an accusation or other-side risk; who,
 * date (not in the future) and means. Opinion and Ignore: only who and when (the session).
 */
export async function recordReporting(env: Env, tenantId: string, textId: string, actor: string, b: Record<string, unknown>): Promise<Reporting> {
  await readText(env, tenantId, textId);
  if (typeof b.afirmacaoId !== 'string') throw error400('afirmacao', 'afirmacaoId: texto', 'afirmacaoId: string');
  const a = await env.DB.prepare('SELECT bloco_id, paragrafo, trecho, estado, risco FROM afirmacoes WHERE id = ? AND texto_id = ? AND tenant_id = ?')
    .bind(b.afirmacaoId, textId, tenantId).first<{ bloco_id: string | null; paragrafo: number; trecho: string; estado: string; risco: string | null }>();
  if (!a) throw error400('nao_encontrado', 'não encontrado', 'not found', 404);
  if (!(DECISION_TYPES as readonly unknown[]).includes(b.tipo)) throw error400('tipo', `tipo: um de ${DECISION_TYPES.join(', ')}`, `tipo: one of ${DECISION_TYPES.join(', ')}`);
  const type = b.tipo as DecisionType;
  let evidenceId: string | null = null, evidencePassage: string | null = null, who: string | null = null, when: string | null = null, half: string | null = null;
  if (type === 'fonte') {
    if (typeof b.evidenciaId !== 'string' || typeof b.evidenciaTrecho !== 'string') throw error400('fonte', 'Escolha a fonte e cole o trecho dela que sustenta a frase.', 'Choose the source and paste the passage from it that supports the sentence.');
    const ev = await env.DB.prepare('SELECT r2_texto FROM evidencias WHERE id = ? AND texto_id = ? AND tenant_id = ?').bind(b.evidenciaId, textId, tenantId).first<{ r2_texto: string }>();
    if (!ev) throw error400('nao_encontrado', 'não encontrado', 'not found', 404);
    const passage = b.evidenciaTrecho.trim();
    const saved = (await env.MEDIA.get(ev.r2_texto).then((x) => x?.text())) ?? '';
    // Literal: the passage as it is in the source's saved text (spaces collapsed on both sides, nothing else).
    const joins = (s: string) => s.replace(/\s+/g, ' ');
    if (passage.length < 3 || passage.length > 2000 || !joins(saved).includes(joins(passage))) {
      throw error400('trecho_fora', 'Esse trecho não está, letra por letra, no texto salvo da fonte. Copie da fonte e cole de novo.', "That passage is not, word for word, in the source's saved text. Copy it from the source and paste again.", 422);
    }
    evidenceId = b.evidenciaId;
    evidencePassage = passage;
  } else if (type === 'outro_lado') {
    if (a.estado !== 'risco' || !RISKS_OTHER_SIDE.includes(a.risco ?? '')) throw error400('outro_lado', 'Outro lado vale para acusação e para frase sem o outro lado.', 'The other side applies to accusations and to sentences without the other side.', 422);
    who = typeof b.quem === 'string' ? b.quem.replace(/\s+/g, ' ').trim() : '';
    when = typeof b.quando === 'string' ? b.quando : '';
    half = typeof b.meio === 'string' ? b.meio : '';
    if (who.length < 2 || who.length > 200) throw error400('quem', 'Diga quem você procurou (nome ou assessoria).', 'Say who you contacted (name or press office).');
    // Up to today in the product's time zone (Brasília); the date must exist in the calendar.
    if (!validDate(when) || when > todayIso()) throw error400('quando', 'Diga quando procurou (uma data até hoje).', 'Say when you made contact (a date up to today).');
    if (!(MEANS_OTHER_SIDE as readonly string[]).includes(half)) throw error400('meio', `meio: um de ${MEANS_OTHER_SIDE.join(', ')}`, `meio: one of ${MEANS_OTHER_SIDE.join(', ')}`);
  }
  const id = newId();
  await env.DB.prepare(
    `INSERT INTO apuracoes (id, tenant_id, texto_id, bloco_id, trecho, tipo, evidencia_id, evidencia_trecho, outro_lado_quem, outro_lado_quando, outro_lado_meio, por)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, tenantId, textId, a.bloco_id ?? `p${a.paragrafo}`, a.trecho, type, evidenceId, evidencePassage, who, when, half, actor).run();
  await recordEvent(env, tenantId, `apuracao.${type}`, 'texto', textId, { apuracaoId: id, por: actor, trecho: a.trecho.slice(0, 200) });
  return (await reportingDecisionsActive(env, tenantId, textId)).find((x) => x.id === id)!;
}

/** Undoes the action (does not delete: records who and when). */
export async function undoReporting(env: Env, tenantId: string, textId: string, reportingId: string, actor: string): Promise<boolean> {
  const r = await env.DB.prepare("UPDATE apuracoes SET desfeita_em = datetime('now'), desfeita_por = ? WHERE id = ? AND texto_id = ? AND tenant_id = ? AND desfeita_em IS NULL")
    .bind(actor, reportingId, textId, tenantId).run();
  if (!r.meta.changes) return false;
  await recordEvent(env, tenantId, 'apuracao.desfeita', 'texto', textId, { apuracaoId: reportingId, por: actor });
  return true;
}

export async function fromSourceType(env: Env, tenantId: string, textId: string, evidenceId: string, type: unknown): Promise<boolean> {
  if (type !== null && !(SOURCE_TYPES as readonly unknown[]).includes(type)) throw error400('tipo', `tipoFonte: um de ${SOURCE_TYPES.join(', ')}`, `tipoFonte: one of ${SOURCE_TYPES.join(', ')}`);
  const r = await env.DB.prepare('UPDATE evidencias SET tipo_fonte = ? WHERE id = ? AND texto_id = ? AND tenant_id = ?').bind(type, evidenceId, textId, tenantId).run();
  return r.meta.changes > 0;
}

// ── checklist ───────────────────────────────────────────────────────────────────────────────────────────────────

/** The editor signs off publication of this version with the open items there were (recorded). */
export async function sign(env: Env, tenantId: string, textId: string, version: unknown, actor: string) {
  const t = await readText(env, tenantId, textId);
  if (version !== t.versao) throw error400('versao', 'O texto mudou desde que você abriu. Recarregue antes de assinar.', 'The text changed since you opened it. Reload before signing.', 409);
  const an = await analyze(env, tenantId, textId, t);
  const id = newId();
  await env.DB.prepare('INSERT INTO assinaturas (id, tenant_id, texto_id, versao, por, pendencias_json) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, tenantId, textId, t.versao, actor, JSON.stringify(an.pendencias)).run();
  await retractVersion(env, tenantId, t, 'assinatura');
  await recordEvent(env, tenantId, 'materia.assinada', 'texto', textId, { por: actor, versao: t.versao, pendencias: an.pendencias.length });
  return { id, pendencias: an.pendencias.length };
}

// ── style guide ─────────────────────────────────────────────────────────────────────────────────────────────────

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

export async function createRule(env: Env, tenantId: string, actor: string, b: Record<string, unknown>) {
  if (!(RULE_TYPES as readonly unknown[]).includes(b.tipo)) throw error400('tipo', `tipo: um de ${RULE_TYPES.join(', ')}`, `tipo: one of ${RULE_TYPES.join(', ')}`);
  const search = clean(b.procurar, 80);
  const prefer = clean(b.preferir, 80) || null;
  const note = clean(b.nota, 200) || null;
  if (!search) throw error400('procurar', 'Diga a forma que o manual pede para evitar.', 'Say the form the style guide asks to avoid.');
  if (prefer === search) throw error400('preferir', 'A forma do manual é igual à que se quer evitar.', 'The preferred form is the same as the one to avoid.');
  const id = newId();
  const r = await env.DB.prepare('INSERT INTO manual_regras (id, tenant_id, tipo, procurar, preferir, nota, por) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (tenant_id, procurar) DO NOTHING RETURNING id')
    .bind(id, tenantId, b.tipo, search, prefer, note, actor).first<{ id: string }>();
  if (!r) throw error400('existe', 'Já há uma regra para essa forma.', 'There is already a rule for that form.', 409);
  return { id };
}

export async function removeRule(env: Env, tenantId: string, id: string): Promise<boolean> {
  const r = await env.DB.prepare('DELETE FROM manual_regras WHERE id = ? AND tenant_id = ?').bind(id, tenantId).run();
  return r.meta.changes > 0;
}

// ── auditoria ───────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The outlet's audit panel: marks per month, per topic (the axes of the symmetry battery) and per person mentioned, and
 * the ignored ones with who and when. The same sentence checked again in the same month counts once.
 */
export async function audit(env: Env, tenantId: string, days = 180) {
  const since = `-${Math.max(1, Math.min(730, Math.floor(days)))} days`;
  const unique = "COUNT(DISTINCT h.texto_id || '|' || h.trecho || '|' || h.estado)";
  const [months, topics, people, ignored] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare(`SELECT strftime('%Y-%m', h.created_at) AS mes, h.estado, h.incerto, ${unique} AS n FROM marcas_historico h
                     WHERE h.tenant_id = ? AND h.created_at >= datetime('now', ?) GROUP BY mes, h.estado, h.incerto ORDER BY mes`).bind(tenantId, since),
    env.DB.prepare(`SELECT j.value AS tema, h.estado, ${unique} AS n FROM marcas_historico h, json_each(h.temas_json) j
                     WHERE h.tenant_id = ? AND h.created_at >= datetime('now', ?) GROUP BY tema, h.estado`).bind(tenantId, since),
    env.DB.prepare(`SELECT j.value AS nome, h.estado, ${unique} AS n FROM marcas_historico h, json_each(h.pessoas_json) j
                     WHERE h.tenant_id = ? AND h.created_at >= datetime('now', ?) GROUP BY nome, h.estado`).bind(tenantId, since),
    env.DB.prepare(`SELECT a.id, a.trecho, a.created_at, a.desfeita_em, u.name AS por, t.titulo, t.id AS texto_id FROM apuracoes a
                      JOIN textos t ON t.id = a.texto_id AND t.tenant_id = a.tenant_id LEFT JOIN "user" u ON u.id = a.por
                     WHERE a.tenant_id = ? AND a.tipo = 'ignorar' AND a.created_at >= datetime('now', ?) ORDER BY a.created_at DESC LIMIT 100`).bind(tenantId, since),
  ]);
  type Account = { com_evidencia: number; sem_fonte: number; risco: number; incerto: number };
  const zero = (): Account => ({ com_evidencia: 0, sem_fonte: 0, risco: 0, incerto: 0 });
  const add = (c: Account, state: string, uncertain: unknown, n: number) => {
    if (state === 'com_evidencia' || state === 'sem_fonte' || state === 'risco') c[state] += n;
    if (uncertain === 1) c.incerto += n;
  };
  const perMonth = new Map<string, Account>();
  for (const r of months.results) { const c = perMonth.get(r.mes as string) ?? zero(); add(c, r.estado as string, r.incerto, Number(r.n)); perMonth.set(r.mes as string, c); }
  const perTopic = new Map<string, Account>(TOPICS.map((x) => [x.id, zero()]));
  for (const r of topics.results) { const c = perTopic.get(r.tema as string); if (c) add(c, r.estado as string, 0, Number(r.n)); }
  const perPerson = new Map<string, Account>();
  for (const r of people.results) { const c = perPerson.get(r.nome as string) ?? zero(); add(c, r.estado as string, 0, Number(r.n)); perPerson.set(r.nome as string, c); }
  const total = (c: Account) => c.com_evidencia + c.sem_fonte + c.risco;
  return {
    meses: [...perMonth].map(([month, c]) => ({ mes: month, ...c })),
    temas: TOPICS.map((x) => ({ id: x.id, pt: x.pt, en: x.en, ...perTopic.get(x.id)! })),
    pessoas: [...perPerson].map(([name, c]) => ({ nome: name, ...c })).sort((a, b) => total(b) - total(a) || a.nome.localeCompare(b.nome)).slice(0, 30),
    ignoradas: ignored.results.map((r) => ({
      id: r.id as string, trecho: r.trecho as string, em: r.created_at as string, desfeitaEm: r.desfeita_em as string | null,
      por: r.por as string | null, textoId: r.texto_id as string, titulo: r.titulo as string,
    })),
  };
}
