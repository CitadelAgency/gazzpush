import type { Env } from '../env';
import { newId, recordEvent } from './db';
import { DeskError, structure, readText } from './desk';
import { fromTextNames } from './reporting';

// LAI (Story phase 7): for an unsourced sentence whose data belongs to a public body, the app drafts the access to
// information request (Law 12.527/2011) and tracks the deadline: 20 days, extendable by another 10 with justification
// (art. 11, §§ 1 and 2), with a due date that falls on a weekend or national holiday moved to the next working day.
// Refusal: appeal to the higher authority (art. 15, 10 days). Silence in the federal Executive: complaint to the
// monitoring authority (Decree 7.724/2012, art. 22: 10 days, counted from 30 days after the request); in states and
// municipalities the local regulation applies (the screen warns). The request comes out ready to paste into the body's
// portal (Fala.BR in the federal Executive, the state's or municipality's e-SIC); the app does not log into government
// portals or store passwords. The answer, and the answer to the appeal, go into the dossier as an official source.

export const LEVELS = ['federal', 'estadual', 'municipal'] as const;
export const DAYS_DEADLINE = 20;
export const EXTENSION_DAYS = 10;
export const APPEAL_DAYS = 10;
export const FALABR = 'https://falabr.cgu.gov.br';

/** First word of a public institution (the body to ask). Companies, banks, churches and parties do not count. */
const PUBLIC = /^(Ministério|Câmara|Prefeitura|Secretaria|Tribunal|Polícia|Assembleia|Assembléia|Governo|Senado|Congresso|Conselho|Defensoria|Procuradoria|Receita|Controladoria|Exército|Marinha|Força|Hospital|Escola|Departamento|Agência|Comissão|Universidade|Instituto|Fundação)$/;

const error = (code: string, pt: string, en: string, status: 400 | 404 | 409 | 422 = 400) => new DeskError(code, pt, status, en);
const spaces = (s: string) => s.replace(/\s+/g, ' ').trim();
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** YYYY-MM-DD that exists in the calendar (2026-02-31 fails). */
export const validDate = (v: unknown): v is string => typeof v === 'string' && DATE.test(v) && !Number.isNaN(Date.parse(v)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
export const todayIso = (now = new Date()) => new Date(now.getTime() - 3 * 3600_000).toISOString().slice(0, 10);   // day in Brasília
export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const betweenDays = (from: string, until: string) => Math.round((Date.parse(`${until}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
const brDate = (d: string) => d.split('-').reverse().join('/');

/** Easter Sunday (Meeus/Jones/Butcher algorithm), for Good Friday. */
function easter(year: number): string {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
const HOLIDAYS_FIXED = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'];
/**
 * A day without office hours: Saturday, Sunday, a fixed national holiday or Good Friday (local holidays do not count).
 * `facultativos`: also the optional days off the federal Executive has every year (Carnival Monday and Tuesday, and
 * Corpus Christi). The optional day off the government decrees each year (the holiday "bridge") the app cannot know:
 * the screen warns.
 */
export function withoutMasthead(d: string, optional = false): boolean {
  const day = new Date(`${d}T12:00:00Z`).getUTCDay();
  const p = easter(Number(d.slice(0, 4)));
  if (day === 0 || day === 6 || HOLIDAYS_FIXED.includes(d.slice(5)) || d === addDays(p, -2)) return true;
  return optional && (d === addDays(p, -48) || d === addDays(p, -47) || d === addDays(p, 60));
}
/** Due date `n` calendar days after `d`; if it falls on a day without office hours, it moves to the next working day. */
export function expiry(d: string, n: number, optional = false): string {
  let v = addDays(d, n);
  while (withoutMasthead(v, optional)) v = addDays(v, 1);
  return v;
}

/** Public bodies mentioned in a passage of the block (by the text's list of names, by code). */
export function agenciesInPassage(text: string, home: number, end: number): string[] {
  return fromTextNames([{ id: 'b', texto: text }])
    .filter((n) => n.tipo === 'instituicao' && PUBLIC.test(n.nome.split(/\s+/)[0]) && n.mencoes.some((m) => m.inicio < end && m.fim > home))
    .map((n) => n.nome);
}

/** The request in the body's Portuguese (LAI is Brazilian): legal basis, deadline, request for an open format. */
export function requestModel(agency: string, passage: string, who: string) {
  return [
    'Prezados,',
    '',
    `Com fundamento no art. 5º, XXXIII, da Constituição Federal e na Lei nº 12.527/2011 (Lei de Acesso à Informação), solicito a ${agency} as seguintes informações:`,
    '',
    `Os dados que sustentam a seguinte informação: "${passage}". Especificamente: `,
    '',
    'Peço, se possível, os dados em formato aberto (planilha). Lembro que não é preciso informar os motivos do pedido (art. 10, § 3º) e que o prazo de resposta é de até 20 dias, prorrogável por mais 10 mediante justificativa expressa (art. 11, §§ 1º e 2º). Se alguma parte for sigilosa, peço o acesso à parte não sigilosa (art. 7º, § 2º) e a indicação do fundamento legal da negativa, da possibilidade de recurso e da autoridade que o aprecia (art. 11, § 4º).',
    '',
    'Atenciosamente,',
    who,
  ].join('\n');
}

export function appealModel(p: { orgao: string; protocolo: string | null; protocolado_em: string | null; pedido: string; resposta_em: string | null; atendeu: number | null }, finalDeadline: string | null, who: string, type: 'recurso' | 'reclamacao' = 'recurso') {
  const reason = p.resposta_em && p.atendeu === 0
    ? `A resposta recebida em ${brDate(p.resposta_em)} não atendeu o pedido.`
    : `O prazo legal de resposta (art. 11 da Lei nº 12.527/2011) terminou em ${finalDeadline ? brDate(finalDeadline) : '—'} sem resposta.`;
  return [
    type === 'reclamacao'
      ? 'Reclamação à autoridade de monitoramento da Lei de Acesso à Informação (art. 22 do Decreto nº 7.724/2012, e art. 40 da Lei nº 12.527/2011), por omissão de resposta'
      : 'Recurso à autoridade hierarquicamente superior (art. 15 da Lei nº 12.527/2011)',
    '',
    `Pedido de acesso à informação dirigido a ${p.orgao}${p.protocolo ? `, protocolado sob o nº ${p.protocolo}` : ''}${p.protocolado_em ? ` em ${brDate(p.protocolado_em)}` : ''}.`,
    '',
    reason,
    '',
    'Reitero o pedido original:',
    '',
    p.pedido,
    '',
    'Solicito o fornecimento integral da informação ou, em caso de negativa, a indicação do fundamento legal, com o acesso à parte não sigilosa (art. 7º, § 2º, e art. 11, § 4º).',
    '',
    'Atenciosamente,',
    who,
  ].join('\n');
}

interface Line {
  id: string; bloco_id: string; trecho: string; orgao: string; esfera: string; pedido: string; protocolo: string | null; protocolado_em: string | null;
  prorrogado_em: string | null; resposta_em: string | null; atendeu: number | null; resposta_evidencia_id: string | null; recurso_em: string | null;
  recurso_texto: string | null; recurso_tipo: string | null; recurso_resposta_em: string | null; recurso_atendeu: number | null; recurso_evidencia_id: string | null;
  por: string; por_nome: string | null; created_at: string;
}

/** Silence in the federal Executive: the complaint starts 30 days after the request (Decree 7.724/2012, art. 22, § 1). */
const COMPLAINT_DAYS_HOME = 30;

/** Deadline and status of a request, as of today. */
export function laiStatus(
  p: Pick<Line, 'esfera' | 'protocolado_em' | 'prorrogado_em' | 'resposta_em' | 'atendeu' | 'recurso_em'> & Partial<Pick<Line, 'recurso_resposta_em' | 'recurso_atendeu'>>,
  today = todayIso(),
) {
  // The federal body's deadline also skips the yearly optional days off (the body does not work on them). The person's
  // deadline (the appeal) does not: when in doubt, the earlier date, so nobody misses a deadline counting on a day that
  // does not count.
  const federal = p.esfera === 'federal';
  const deadline = p.protocolado_em ? expiry(p.protocolado_em, DAYS_DEADLINE, federal) : null;
  const finalDeadline = p.protocolado_em && p.prorrogado_em ? expiry(p.protocolado_em, DAYS_DEADLINE + EXTENSION_DAYS, federal) : deadline;
  const answered = !!p.resposta_em;
  const overdue = !!finalDeadline && !answered && today > finalDeadline;
  const remainingDays = finalDeadline && !answered ? betweenDays(today, finalDeadline) : null;
  // Refusal: appeal (art. 15), 10 days from notice of the answer. Silence: in the federal Executive, a complaint (Decree
  // 7.724/2012, art. 22), 10 days counted from the 30th day after the request; in states and municipalities, the art. 15
  // appeal counted from the due date (the local regulation may say otherwise: the screen warns).
  const complaint = !answered && p.esfera === 'federal';
  const appealType: 'recurso' | 'reclamacao' = complaint ? 'reclamacao' : 'recurso';
  const appealOf = !p.recurso_em && (overdue || (answered && p.atendeu === 0))
    ? (answered ? p.resposta_em! : complaint ? addDays(p.protocolado_em!, COMPLAINT_DAYS_HOME) : addDays(finalDeadline!, 1))
    : null;
  const appealUntil = appealOf ? expiry(appealOf, APPEAL_DAYS) : null;
  // Once the window opens, the appeal can be recorded; after it ends, only what was filed by the last day (the screen says
  // the deadline passed, and the appeal date cannot be after it).
  const canAppeal = !!appealOf && today >= appealOf;
  const appealDeadlinePassed = !!appealUntil && today > appealUntil;
  const appealAnswer = !!p.recurso_resposta_em;
  const state = p.recurso_em
    ? (appealAnswer ? (p.recurso_atendeu === 0 ? 'negado' : 'respondido') : 'recurso')
    : answered ? (p.atendeu === 0 ? 'negado' : 'respondido') : overdue ? 'vencido' : p.protocolado_em ? (p.prorrogado_em ? 'prorrogado' : 'protocolado') : 'rascunho';
  return {
    prazo: deadline, prazoFinal: finalDeadline, vencido: overdue, diasRestantes: remainingDays, podeRecorrer: canAppeal, prazoRecursoPassou: appealDeadlinePassed, recorrerDe: appealOf, recorrerAte: appealUntil, tipoRecurso: appealType, regraLocal: !federal,
    // The answer to the appeal (or complaint) was a refusal: the next instance is up to the person, outside the app. In
    // the federal Executive (Decree 7.724/2012): a refused appeal goes to the body's highest authority (art. 21, sole
    // paragraph) and then to the CGU (art. 23); a complaint without result goes straight to the CGU (art. 23). Within 10
    // days of notice.
    proximaInstanciaFora: !!p.recurso_em && !!p.recurso_resposta_em && p.recurso_atendeu === 0,
    estado: state as 'rascunho' | 'protocolado' | 'prorrogado' | 'vencido' | 'respondido' | 'negado' | 'recurso',
  };
}

/** The text's LAI requests, with deadline and status, and the unsourced sentences that mention a public body (candidates). */
export async function laiText(env: Env, tenantId: string, textId: string, who: string, withoutSourceSentences: { id: string; blocoId: string; trecho: string; inicio: number; fim: number; textoBloco: string }[]) {
  const { results } = await env.DB.prepare(
    `SELECT l.*, u.name AS por_nome FROM pedidos_lai l LEFT JOIN "user" u ON u.id = l.por WHERE l.texto_id = ? AND l.tenant_id = ? ORDER BY l.created_at, l.rowid`,
  ).bind(textId, tenantId).all<Line>();
  const requests = results.map((p) => {
    const s = laiStatus(p);
    return {
      id: p.id, blocoId: p.bloco_id, trecho: p.trecho, orgao: p.orgao, esfera: p.esfera, pedido: p.pedido, protocolo: p.protocolo, protocoladoEm: p.protocolado_em,
      prorrogadoEm: p.prorrogado_em, respostaEm: p.resposta_em, atendeu: p.atendeu === null ? null : p.atendeu === 1, respostaEvidenciaId: p.resposta_evidencia_id,
      recursoEm: p.recurso_em, recursoTexto: p.recurso_texto, recursoTipo: p.recurso_tipo, recursoRespostaEm: p.recurso_resposta_em,
      recursoAtendeu: p.recurso_atendeu === null ? null : p.recurso_atendeu === 1, recursoEvidenciaId: p.recurso_evidencia_id,
      porNome: p.por_nome, criadoEm: p.created_at, ...s,
      modeloRecurso: s.recorrerDe ? appealModel(p, s.prazoFinal, who, s.tipoRecurso) : null,
    };
  });
  const alreadyRequested = new Set(results.map((p) => `${p.bloco_id}:${spaces(p.trecho)}`));
  const candidates = withoutSourceSentences.flatMap((f) => {
    const agencies = agenciesInPassage(f.textoBloco, f.inicio, f.fim);
    return agencies.length && !alreadyRequested.has(`${f.blocoId}:${spaces(f.trecho)}`) ? [{ afirmacaoId: f.id, blocoId: f.blocoId, trecho: f.trecho, orgao: agencies[0], modelo: requestModel(agencies[0], f.trecho, who) }] : [];
  });
  return { pedidos: requests, candidatas: candidates, portal: FALABR };
}

/** New FOI request: the phrase (verbatim in the paragraph), the agency, the level and the request text (the person edits the template). */
export async function createRequestLai(env: Env, tenantId: string, textId: string, actor: string, b: Record<string, unknown>) {
  const t = await readText(env, tenantId, textId);
  const agency = typeof b.orgao === 'string' ? spaces(b.orgao) : '';
  const request = typeof b.pedido === 'string' ? b.pedido.trim() : '';
  const level = typeof b.esfera === 'string' && (LEVELS as readonly string[]).includes(b.esfera) ? b.esfera : null;
  if (agency.length < 3 || agency.length > 200) throw error('orgao', 'Diga a qual órgão o pedido vai (3 a 200 caracteres).', 'Say which agency the request goes to (3 to 200 characters).', 422);
  if (!level) throw error('esfera', 'Escolha a esfera: federal, estadual ou municipal.', 'Choose the level: federal, state or municipal.', 422);
  if (request.length < 40 || request.length > 8000) throw error('pedido', 'O pedido precisa dizer o que você quer (40 a 8000 caracteres).', 'The request must say what you want (40 to 8000 characters).', 422);
  const blockId = typeof b.blocoId === 'string' ? b.blocoId : '';
  const passage = typeof b.trecho === 'string' ? spaces(b.trecho) : '';
  const block = (await structure(t)).blocos.find((x) => x.id === blockId);
  if (!block || passage.length < 8 || !spaces(block.texto).includes(passage)) {
    throw error('trecho_fora', 'Essa frase não está, letra por letra, no parágrafo. Escolha de novo a frase do texto.', "That sentence isn't, word for word, in the paragraph. Pick the sentence from the text again.", 422);
  }
  const id = newId();
  await env.DB.prepare('INSERT INTO pedidos_lai (id, tenant_id, texto_id, bloco_id, trecho, orgao, esfera, pedido, por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, tenantId, textId, blockId, passage, agency, level, request, actor).run();
  await recordEvent(env, tenantId, 'materia.lai', 'texto', textId, { pedidoId: id, orgao: agency, esfera: level, por: actor });
  return { id };
}

/** The request's steps: filing (with the date), extension, answer (goes to the dossier) and appeal. */
export async function progressLai(env: Env, tenantId: string, textId: string, requestId: string, action: string, actor: { id: string; nome: string }, b: Record<string, unknown>) {
  await readText(env, tenantId, textId);
  const p = await env.DB.prepare('SELECT * FROM pedidos_lai WHERE id = ? AND texto_id = ? AND tenant_id = ?').bind(requestId, textId, tenantId).first<Line>();
  if (!p) throw error('nao_encontrado', 'não encontrado', 'not found', 404);
  const data = (v: unknown, field: string) => {
    if (!validDate(v)) throw error(field, 'Data inválida (AAAA-MM-DD).', 'Invalid date (YYYY-MM-DD).', 422);
    if (v > todayIso()) throw error(field, 'A data não pode ser no futuro.', "The date can't be in the future.", 422);
    return v;
  };
  if (action === 'protocolo') {
    const protocol = typeof b.protocolo === 'string' ? spaces(b.protocolo) : '';
    if (protocol.length < 3 || protocol.length > 80) throw error('protocolo', 'Informe o número do protocolo que o portal deu (3 a 80 caracteres).', 'Enter the protocol number the portal gave you (3 to 80 characters).', 422);
    const at = data(b.protocoladoEm, 'protocoladoEm');
    await env.DB.prepare('UPDATE pedidos_lai SET protocolo = ?, protocolado_em = ? WHERE id = ? AND tenant_id = ?').bind(protocol, at, p.id, tenantId).run();
  } else if (action === 'prorrogacao') {
    if (!p.protocolado_em) throw error('sem_protocolo', 'Registre o protocolo antes.', 'Record the protocol first.', 409);
    const at = data(b.em, 'em');
    if (at < p.protocolado_em) throw error('em', 'A prorrogação não pode ser antes do protocolo.', "The extension can't be before the protocol.", 422);
    await env.DB.prepare('UPDATE pedidos_lai SET prorrogado_em = ? WHERE id = ? AND tenant_id = ?').bind(at, p.id, tenantId).run();
  } else if (action === 'resposta') {
    if (!p.protocolado_em) throw error('sem_protocolo', 'Registre o protocolo antes.', 'Record the protocol first.', 409);
    // After the appeal (or complaint), the answer is its own: another date, another "granted", another piece of evidence.
    const fromAppeal = !!p.recurso_em;
    if (fromAppeal ? p.recurso_resposta_em : p.resposta_em) {
      throw error('ja_respondido', fromAppeal ? 'A resposta ao recurso já foi registrada.' : 'A resposta já foi registrada. Se ela não atendeu, prepare o recurso.', fromAppeal ? 'The reply to the appeal has already been recorded.' : 'The reply has already been recorded. If it did not meet the request, prepare the appeal.', 409);
    }
    const text = typeof b.texto === 'string' ? b.texto.trim() : '';
    if (text.length < 10 || text.length > 20000) throw error('texto', 'Cole a resposta do órgão (10 a 20000 caracteres).', "Paste the agency's reply (10 to 20000 characters).", 422);
    const at = data(b.recebidaEm, 'recebidaEm');
    if (at < (fromAppeal ? p.recurso_em! : p.protocolado_em)) throw error('recebidaEm', fromAppeal ? 'A resposta não pode ser antes do recurso.' : 'A resposta não pode ser antes do protocolo.', fromAppeal ? "The reply can't be before the appeal." : "The reply can't be before the protocol.", 422);
    const met = b.atendeu === true ? 1 : b.atendeu === false ? 0 : null;
    if (met === null) throw error('atendeu', 'Diga se a resposta atendeu o pedido.', 'Say whether the reply met the request.', 422);
    // The answer goes into the dossier as an official source (no link: it is the text the body sent).
    const evId = newId();
    const key = `evidencias/${tenantId}/${evId}.txt`;
    await env.MEDIA.put(key, text, { httpMetadata: { contentType: 'text/plain; charset=utf-8' } });
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map((x) => x.toString(16).padStart(2, '0')).join('');
    await env.DB.batch([
      env.DB.prepare("INSERT INTO evidencias (id, tenant_id, texto_id, url, titulo, r2_texto, hash, hash_atual, origem, tipo_fonte) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'lai', 'oficial')")
        .bind(evId, tenantId, textId, fromAppeal ? `lai:${p.id}:recurso` : `lai:${p.id}`,
          `${fromAppeal ? `Resposta ${p.recurso_tipo === 'reclamacao' ? 'à reclamação' : 'ao recurso'}` : 'Resposta'} de ${p.orgao} (LAI${p.protocolo ? ` nº ${p.protocolo}` : ''}, ${brDate(at)})`.slice(0, 300), key, hash, hash),
      fromAppeal
        ? env.DB.prepare('UPDATE pedidos_lai SET recurso_resposta_em = ?, recurso_atendeu = ?, recurso_evidencia_id = ? WHERE id = ? AND tenant_id = ?').bind(at, met, evId, p.id, tenantId)
        : env.DB.prepare('UPDATE pedidos_lai SET resposta_em = ?, atendeu = ?, resposta_evidencia_id = ? WHERE id = ? AND tenant_id = ?').bind(at, met, evId, p.id, tenantId),
      env.DB.prepare("UPDATE textos SET updated_at = datetime('now') WHERE id = ? AND tenant_id = ?").bind(textId, tenantId),
    ]);
  } else if (action === 'recurso') {
    const s = laiStatus(p);
    if (!s.recorrerDe) throw error('sem_recurso', 'O recurso cabe quando o prazo vence sem resposta ou a resposta não atende o pedido.', 'An appeal applies when the deadline passes with no reply or the reply does not meet the request.', 409);
    if (!s.podeRecorrer) throw error('cedo', `A reclamação por falta de resposta só pode ser apresentada a partir de ${brDate(s.recorrerDe)} (30 dias do pedido, Decreto nº 7.724/2012, art. 22).`, `The complaint for lack of reply can only be filed from ${s.recorrerDe} (30 days after the request).`, 409);
    const text = typeof b.texto === 'string' ? b.texto.trim() : '';
    if (text.length < 40 || text.length > 8000) throw error('texto', 'O recurso precisa do texto (40 a 8000 caracteres).', 'The appeal needs its text (40 to 8000 characters).', 422);
    const at = data(b.em, 'em');
    if (at < s.recorrerDe) throw error('em', `A data do recurso não pode ser antes de ${brDate(s.recorrerDe)}.`, `The appeal date can't be before ${s.recorrerDe}.`, 422);
    if (at > s.recorrerAte!) throw error('fora_do_prazo', `O prazo terminou em ${brDate(s.recorrerAte!)}: o recurso protocolado depois disso pode ser recusado pelo órgão, e o app não registra.`, `The deadline ended on ${s.recorrerAte}: an appeal filed after it may be rejected by the agency, and the app doesn't record it.`, 422);
    await env.DB.prepare('UPDATE pedidos_lai SET recurso_em = ?, recurso_texto = ?, recurso_tipo = ? WHERE id = ? AND tenant_id = ?').bind(at, text, s.tipoRecurso, p.id, tenantId).run();
  } else {
    throw error('acao', 'Ação desconhecida.', 'Unknown action.', 404);
  }
  await recordEvent(env, tenantId, `materia.lai.${action}`, 'texto', textId, { pedidoId: p.id, por: actor.id });
}
