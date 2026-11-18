import type { Env } from '../env';
import { novoId, registrarEvento } from './db';
import { ErroMesa, estrutura, lerTexto } from './mesa';
import { nomesDoTexto } from './apuracao';

// LAI (Fase 7 da Matéria): para a frase sem fonte cujo dado é de órgão público, o app monta o pedido de acesso à
// informação (Lei nº 12.527/2011) e acompanha o prazo: 20 dias, prorrogáveis por mais 10 com justificativa (art. 11,
// §§ 1º e 2º), com o vencimento que cai em fim de semana ou feriado nacional passado para o dia útil seguinte. Negativa:
// recurso à autoridade superior (art. 15, 10 dias). Omissão no Executivo federal: reclamação à autoridade de
// monitoramento (Decreto nº 7.724/2012, art. 22: 10 dias, contados a partir de 30 dias do pedido); em estado e município
// vale o regulamento local (a tela avisa). O pedido sai pronto para colar no portal do órgão (Fala.BR no Executivo
// federal, o e-SIC do estado ou do município); o app não entra em portal do governo nem guarda senha. A resposta, e a
// resposta ao recurso, entram no dossiê como fonte oficial.

export const ESFERAS = ['federal', 'estadual', 'municipal'] as const;
export const PRAZO_DIAS = 20;
export const PRORROGACAO_DIAS = 10;
export const RECURSO_DIAS = 10;
export const FALABR = 'https://falabr.cgu.gov.br';

/** Primeira palavra de instituição pública (o órgão a quem pedir). Empresa, banco, igreja e partido não entram. */
const PUBLICO = /^(Ministério|Câmara|Prefeitura|Secretaria|Tribunal|Polícia|Assembleia|Assembléia|Governo|Senado|Congresso|Conselho|Defensoria|Procuradoria|Receita|Controladoria|Exército|Marinha|Força|Hospital|Escola|Departamento|Agência|Comissão|Universidade|Instituto|Fundação)$/;

const erro = (codigo: string, pt: string, en: string, status: 400 | 404 | 409 | 422 = 400) => new ErroMesa(codigo, pt, status, en);
const espacos = (s: string) => s.replace(/\s+/g, ' ').trim();
const DATA = /^\d{4}-\d{2}-\d{2}$/;
/** AAAA-MM-DD que existe no calendário (2026-02-31 não passa). */
export const dataValida = (v: unknown): v is string => typeof v === 'string' && DATA.test(v) && !Number.isNaN(Date.parse(v)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
export const hojeISO = (agora = new Date()) => new Date(agora.getTime() - 3 * 3600_000).toISOString().slice(0, 10);   // dia em Brasília
export const somarDias = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const diasEntre = (de: string, ate: string) => Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000);
const dataBr = (d: string) => d.split('-').reverse().join('/');

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher), para a Sexta-feira Santa. */
function pascoa(ano: number): string {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}
const FERIADOS_FIXOS = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'];
/**
 * Dia sem expediente: sábado, domingo, feriado nacional fixo ou Sexta-feira Santa (feriado local não entra).
 * `facultativos`: também os pontos facultativos de todo ano no Executivo federal (segunda e terça de Carnaval e Corpus
 * Christi). O ponto facultativo que o governo decreta em cada ano (a "emenda" de feriado) o app não sabe: a tela avisa.
 */
export function semExpediente(d: string, facultativos = false): boolean {
  const dia = new Date(`${d}T12:00:00Z`).getUTCDay();
  const p = pascoa(Number(d.slice(0, 4)));
  if (dia === 0 || dia === 6 || FERIADOS_FIXOS.includes(d.slice(5)) || d === somarDias(p, -2)) return true;
  return facultativos && (d === somarDias(p, -48) || d === somarDias(p, -47) || d === somarDias(p, 60));
}
/** Vencimento de `n` dias corridos a partir de `d`; caindo em dia sem expediente, passa ao primeiro dia útil seguinte. */
export function vencimento(d: string, n: number, facultativos = false): string {
  let v = somarDias(d, n);
  while (semExpediente(v, facultativos)) v = somarDias(v, 1);
  return v;
}

/** Órgãos públicos citados num trecho do bloco (pela lista de nomes do texto, por código). */
export function orgaosNoTrecho(texto: string, inicio: number, fim: number): string[] {
  return nomesDoTexto([{ id: 'b', texto }])
    .filter((n) => n.tipo === 'instituicao' && PUBLICO.test(n.nome.split(/\s+/)[0]) && n.mencoes.some((m) => m.inicio < fim && m.fim > inicio))
    .map((n) => n.nome);
}

/** O pedido no português do órgão (a LAI é brasileira): a base legal, o prazo, o pedido de formato aberto. */
export function modeloPedido(orgao: string, trecho: string, quem: string) {
  return [
    'Prezados,',
    '',
    `Com fundamento no art. 5º, XXXIII, da Constituição Federal e na Lei nº 12.527/2011 (Lei de Acesso à Informação), solicito a ${orgao} as seguintes informações:`,
    '',
    `Os dados que sustentam a seguinte informação: "${trecho}". Especificamente: `,
    '',
    'Peço, se possível, os dados em formato aberto (planilha). Lembro que não é preciso informar os motivos do pedido (art. 10, § 3º) e que o prazo de resposta é de até 20 dias, prorrogável por mais 10 mediante justificativa expressa (art. 11, §§ 1º e 2º). Se alguma parte for sigilosa, peço o acesso à parte não sigilosa (art. 7º, § 2º) e a indicação do fundamento legal da negativa, da possibilidade de recurso e da autoridade que o aprecia (art. 11, § 4º).',
    '',
    'Atenciosamente,',
    quem,
  ].join('\n');
}

export function modeloRecurso(p: { orgao: string; protocolo: string | null; protocolado_em: string | null; pedido: string; resposta_em: string | null; atendeu: number | null }, prazoFinal: string | null, quem: string, tipo: 'recurso' | 'reclamacao' = 'recurso') {
  const motivo = p.resposta_em && p.atendeu === 0
    ? `A resposta recebida em ${dataBr(p.resposta_em)} não atendeu o pedido.`
    : `O prazo legal de resposta (art. 11 da Lei nº 12.527/2011) terminou em ${prazoFinal ? dataBr(prazoFinal) : '—'} sem resposta.`;
  return [
    tipo === 'reclamacao'
      ? 'Reclamação à autoridade de monitoramento da Lei de Acesso à Informação (art. 22 do Decreto nº 7.724/2012, e art. 40 da Lei nº 12.527/2011), por omissão de resposta'
      : 'Recurso à autoridade hierarquicamente superior (art. 15 da Lei nº 12.527/2011)',
    '',
    `Pedido de acesso à informação dirigido a ${p.orgao}${p.protocolo ? `, protocolado sob o nº ${p.protocolo}` : ''}${p.protocolado_em ? ` em ${dataBr(p.protocolado_em)}` : ''}.`,
    '',
    motivo,
    '',
    'Reitero o pedido original:',
    '',
    p.pedido,
    '',
    'Solicito o fornecimento integral da informação ou, em caso de negativa, a indicação do fundamento legal, com o acesso à parte não sigilosa (art. 7º, § 2º, e art. 11, § 4º).',
    '',
    'Atenciosamente,',
    quem,
  ].join('\n');
}

interface Linha {
  id: string; bloco_id: string; trecho: string; orgao: string; esfera: string; pedido: string; protocolo: string | null; protocolado_em: string | null;
  prorrogado_em: string | null; resposta_em: string | null; atendeu: number | null; resposta_evidencia_id: string | null; recurso_em: string | null;
  recurso_texto: string | null; recurso_tipo: string | null; recurso_resposta_em: string | null; recurso_atendeu: number | null; recurso_evidencia_id: string | null;
  por: string; por_nome: string | null; created_at: string;
}

/** Omissão no Executivo federal: a reclamação começa 30 dias depois do pedido (Decreto nº 7.724/2012, art. 22, § 1º). */
const INICIO_RECLAMACAO_DIAS = 30;

/** Prazo e situação de um pedido, de hoje. */
export function situacaoLai(
  p: Pick<Linha, 'esfera' | 'protocolado_em' | 'prorrogado_em' | 'resposta_em' | 'atendeu' | 'recurso_em'> & Partial<Pick<Linha, 'recurso_resposta_em' | 'recurso_atendeu'>>,
  hoje = hojeISO(),
) {
  // O prazo do órgão federal passa também os pontos facultativos de todo ano (o órgão não trabalha neles). O prazo da
  // pessoa (o recurso) não: na dúvida, a data mais cedo, para ninguém perder o prazo contando com um dia que não vale.
  const federal = p.esfera === 'federal';
  const prazo = p.protocolado_em ? vencimento(p.protocolado_em, PRAZO_DIAS, federal) : null;
  const prazoFinal = p.protocolado_em && p.prorrogado_em ? vencimento(p.protocolado_em, PRAZO_DIAS + PRORROGACAO_DIAS, federal) : prazo;
  const respondido = !!p.resposta_em;
  const vencido = !!prazoFinal && !respondido && hoje > prazoFinal;
  const diasRestantes = prazoFinal && !respondido ? diasEntre(hoje, prazoFinal) : null;
  // Negativa: recurso (art. 15), 10 dias da ciência da resposta. Omissão: no Executivo federal, reclamação (Decreto nº
  // 7.724/2012, art. 22), 10 dias contados a partir do 30º dia do pedido; em estado e município, o recurso do art. 15
  // contado do vencimento (o regulamento local pode dizer outra coisa: a tela avisa).
  const reclamacao = !respondido && p.esfera === 'federal';
  const tipoRecurso: 'recurso' | 'reclamacao' = reclamacao ? 'reclamacao' : 'recurso';
  const recorrerDe = !p.recurso_em && (vencido || (respondido && p.atendeu === 0))
    ? (respondido ? p.resposta_em! : reclamacao ? somarDias(p.protocolado_em!, INICIO_RECLAMACAO_DIAS) : somarDias(prazoFinal!, 1))
    : null;
  const recorrerAte = recorrerDe ? vencimento(recorrerDe, RECURSO_DIAS) : null;
  // Aberta a janela, o recurso pode ser registrado; depois do fim, só o que foi protocolado até o último dia (a tela diz
  // que o prazo passou, e a data do recurso não pode ser depois dele).
  const podeRecorrer = !!recorrerDe && hoje >= recorrerDe;
  const prazoRecursoPassou = !!recorrerAte && hoje > recorrerAte;
  const respostaRecurso = !!p.recurso_resposta_em;
  const estado = p.recurso_em
    ? (respostaRecurso ? (p.recurso_atendeu === 0 ? 'negado' : 'respondido') : 'recurso')
    : respondido ? (p.atendeu === 0 ? 'negado' : 'respondido') : vencido ? 'vencido' : p.protocolado_em ? (p.prorrogado_em ? 'prorrogado' : 'protocolado') : 'rascunho';
  return {
    prazo, prazoFinal, vencido, diasRestantes, podeRecorrer, prazoRecursoPassou, recorrerDe, recorrerAte, tipoRecurso, regraLocal: !federal,
    // A resposta ao recurso (ou à reclamação) negou: a instância seguinte é com a pessoa, fora do app. No Executivo
    // federal (Decreto 7.724/2012): recurso negado vai à autoridade máxima do órgão (art. 21, parágrafo único) e depois
    // à CGU (art. 23); reclamação sem resultado vai direto à CGU (art. 23). Em 10 dias da ciência.
    proximaInstanciaFora: !!p.recurso_em && !!p.recurso_resposta_em && p.recurso_atendeu === 0,
    estado: estado as 'rascunho' | 'protocolado' | 'prorrogado' | 'vencido' | 'respondido' | 'negado' | 'recurso',
  };
}

/** Os pedidos de LAI do texto, com prazo e situação, e as frases sem fonte que citam órgão público (candidatas). */
export async function laiDoTexto(env: Env, tenantId: string, textoId: string, quem: string, frasesSemFonte: { id: string; blocoId: string; trecho: string; inicio: number; fim: number; textoBloco: string }[]) {
  const { results } = await env.DB.prepare(
    `SELECT l.*, u.name AS por_nome FROM pedidos_lai l LEFT JOIN "user" u ON u.id = l.por WHERE l.texto_id = ? AND l.tenant_id = ? ORDER BY l.created_at, l.rowid`,
  ).bind(textoId, tenantId).all<Linha>();
  const pedidos = results.map((p) => {
    const s = situacaoLai(p);
    return {
      id: p.id, blocoId: p.bloco_id, trecho: p.trecho, orgao: p.orgao, esfera: p.esfera, pedido: p.pedido, protocolo: p.protocolo, protocoladoEm: p.protocolado_em,
      prorrogadoEm: p.prorrogado_em, respostaEm: p.resposta_em, atendeu: p.atendeu === null ? null : p.atendeu === 1, respostaEvidenciaId: p.resposta_evidencia_id,
      recursoEm: p.recurso_em, recursoTexto: p.recurso_texto, recursoTipo: p.recurso_tipo, recursoRespostaEm: p.recurso_resposta_em,
      recursoAtendeu: p.recurso_atendeu === null ? null : p.recurso_atendeu === 1, recursoEvidenciaId: p.recurso_evidencia_id,
      porNome: p.por_nome, criadoEm: p.created_at, ...s,
      modeloRecurso: s.recorrerDe ? modeloRecurso(p, s.prazoFinal, quem, s.tipoRecurso) : null,
    };
  });
  const jaPedidas = new Set(results.map((p) => `${p.bloco_id}:${espacos(p.trecho)}`));
  const candidatas = frasesSemFonte.flatMap((f) => {
    const orgaos = orgaosNoTrecho(f.textoBloco, f.inicio, f.fim);
    return orgaos.length && !jaPedidas.has(`${f.blocoId}:${espacos(f.trecho)}`) ? [{ afirmacaoId: f.id, blocoId: f.blocoId, trecho: f.trecho, orgao: orgaos[0], modelo: modeloPedido(orgaos[0], f.trecho, quem) }] : [];
  });
  return { pedidos, candidatas, portal: FALABR };
}

/** Novo pedido: a frase (literal no parágrafo), o órgão, a esfera e o texto do pedido (a pessoa edita o modelo). */
export async function criarPedidoLai(env: Env, tenantId: string, textoId: string, por: string, b: Record<string, unknown>) {
  const t = await lerTexto(env, tenantId, textoId);
  const orgao = typeof b.orgao === 'string' ? espacos(b.orgao) : '';
  const pedido = typeof b.pedido === 'string' ? b.pedido.trim() : '';
  const esfera = typeof b.esfera === 'string' && (ESFERAS as readonly string[]).includes(b.esfera) ? b.esfera : null;
  if (orgao.length < 3 || orgao.length > 200) throw erro('orgao', 'Diga a qual órgão o pedido vai (3 a 200 caracteres).', 'Say which agency the request goes to (3 to 200 characters).', 422);
  if (!esfera) throw erro('esfera', 'Escolha a esfera: federal, estadual ou municipal.', 'Choose the level: federal, state or municipal.', 422);
  if (pedido.length < 40 || pedido.length > 8000) throw erro('pedido', 'O pedido precisa dizer o que você quer (40 a 8000 caracteres).', 'The request must say what you want (40 to 8000 characters).', 422);
  const blocoId = typeof b.blocoId === 'string' ? b.blocoId : '';
  const trecho = typeof b.trecho === 'string' ? espacos(b.trecho) : '';
  const bloco = (await estrutura(t)).blocos.find((x) => x.id === blocoId);
  if (!bloco || trecho.length < 8 || !espacos(bloco.texto).includes(trecho)) {
    throw erro('trecho_fora', 'Essa frase não está, letra por letra, no parágrafo. Escolha de novo a frase do texto.', "That sentence isn't, word for word, in the paragraph. Pick the sentence from the text again.", 422);
  }
  const id = novoId();
  await env.DB.prepare('INSERT INTO pedidos_lai (id, tenant_id, texto_id, bloco_id, trecho, orgao, esfera, pedido, por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, tenantId, textoId, blocoId, trecho, orgao, esfera, pedido, por).run();
  await registrarEvento(env, tenantId, 'materia.lai', 'texto', textoId, { pedidoId: id, orgao, esfera, por });
  return { id };
}

/** Os passos do pedido: protocolo (com a data), prorrogação, resposta (vai para o dossiê) e recurso. */
export async function andamentoLai(env: Env, tenantId: string, textoId: string, pedidoId: string, acao: string, por: { id: string; nome: string }, b: Record<string, unknown>) {
  await lerTexto(env, tenantId, textoId);
  const p = await env.DB.prepare('SELECT * FROM pedidos_lai WHERE id = ? AND texto_id = ? AND tenant_id = ?').bind(pedidoId, textoId, tenantId).first<Linha>();
  if (!p) throw erro('nao_encontrado', 'não encontrado', 'not found', 404);
  const data = (v: unknown, campo: string) => {
    if (!dataValida(v)) throw erro(campo, 'Data inválida (AAAA-MM-DD).', 'Invalid date (YYYY-MM-DD).', 422);
    if (v > hojeISO()) throw erro(campo, 'A data não pode ser no futuro.', "The date can't be in the future.", 422);
    return v;
  };
  if (acao === 'protocolo') {
    const protocolo = typeof b.protocolo === 'string' ? espacos(b.protocolo) : '';
    if (protocolo.length < 3 || protocolo.length > 80) throw erro('protocolo', 'Informe o número do protocolo que o portal deu (3 a 80 caracteres).', 'Enter the protocol number the portal gave you (3 to 80 characters).', 422);
    const em = data(b.protocoladoEm, 'protocoladoEm');
    await env.DB.prepare('UPDATE pedidos_lai SET protocolo = ?, protocolado_em = ? WHERE id = ? AND tenant_id = ?').bind(protocolo, em, p.id, tenantId).run();
  } else if (acao === 'prorrogacao') {
    if (!p.protocolado_em) throw erro('sem_protocolo', 'Registre o protocolo antes.', 'Record the protocol first.', 409);
    const em = data(b.em, 'em');
    if (em < p.protocolado_em) throw erro('em', 'A prorrogação não pode ser antes do protocolo.', "The extension can't be before the protocol.", 422);
    await env.DB.prepare('UPDATE pedidos_lai SET prorrogado_em = ? WHERE id = ? AND tenant_id = ?').bind(em, p.id, tenantId).run();
  } else if (acao === 'resposta') {
    if (!p.protocolado_em) throw erro('sem_protocolo', 'Registre o protocolo antes.', 'Record the protocol first.', 409);
    // Depois do recurso (ou da reclamação), a resposta é a dele: outra data, outro "atendeu", outra evidência.
    const doRecurso = !!p.recurso_em;
    if (doRecurso ? p.recurso_resposta_em : p.resposta_em) {
      throw erro('ja_respondido', doRecurso ? 'A resposta ao recurso já foi registrada.' : 'A resposta já foi registrada. Se ela não atendeu, prepare o recurso.', doRecurso ? 'The reply to the appeal has already been recorded.' : 'The reply has already been recorded. If it did not meet the request, prepare the appeal.', 409);
    }
    const texto = typeof b.texto === 'string' ? b.texto.trim() : '';
    if (texto.length < 10 || texto.length > 20000) throw erro('texto', 'Cole a resposta do órgão (10 a 20000 caracteres).', "Paste the agency's reply (10 to 20000 characters).", 422);
    const em = data(b.recebidaEm, 'recebidaEm');
    if (em < (doRecurso ? p.recurso_em! : p.protocolado_em)) throw erro('recebidaEm', doRecurso ? 'A resposta não pode ser antes do recurso.' : 'A resposta não pode ser antes do protocolo.', doRecurso ? "The reply can't be before the appeal." : "The reply can't be before the protocol.", 422);
    const atendeu = b.atendeu === true ? 1 : b.atendeu === false ? 0 : null;
    if (atendeu === null) throw erro('atendeu', 'Diga se a resposta atendeu o pedido.', 'Say whether the reply met the request.', 422);
    // A resposta entra no dossiê como fonte oficial (sem link: é o texto que o órgão mandou).
    const evId = novoId();
    const chave = `evidencias/${tenantId}/${evId}.txt`;
    await env.MEDIA.put(chave, texto, { httpMetadata: { contentType: 'text/plain; charset=utf-8' } });
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto)))].map((x) => x.toString(16).padStart(2, '0')).join('');
    await env.DB.batch([
      env.DB.prepare("INSERT INTO evidencias (id, tenant_id, texto_id, url, titulo, r2_texto, hash, hash_atual, origem, tipo_fonte) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'lai', 'oficial')")
        .bind(evId, tenantId, textoId, doRecurso ? `lai:${p.id}:recurso` : `lai:${p.id}`,
          `${doRecurso ? `Resposta ${p.recurso_tipo === 'reclamacao' ? 'à reclamação' : 'ao recurso'}` : 'Resposta'} de ${p.orgao} (LAI${p.protocolo ? ` nº ${p.protocolo}` : ''}, ${dataBr(em)})`.slice(0, 300), chave, hash, hash),
      doRecurso
        ? env.DB.prepare('UPDATE pedidos_lai SET recurso_resposta_em = ?, recurso_atendeu = ?, recurso_evidencia_id = ? WHERE id = ? AND tenant_id = ?').bind(em, atendeu, evId, p.id, tenantId)
        : env.DB.prepare('UPDATE pedidos_lai SET resposta_em = ?, atendeu = ?, resposta_evidencia_id = ? WHERE id = ? AND tenant_id = ?').bind(em, atendeu, evId, p.id, tenantId),
      env.DB.prepare("UPDATE textos SET updated_at = datetime('now') WHERE id = ? AND tenant_id = ?").bind(textoId, tenantId),
    ]);
  } else if (acao === 'recurso') {
    const s = situacaoLai(p);
    if (!s.recorrerDe) throw erro('sem_recurso', 'O recurso cabe quando o prazo vence sem resposta ou a resposta não atende o pedido.', 'An appeal applies when the deadline passes with no reply or the reply does not meet the request.', 409);
    if (!s.podeRecorrer) throw erro('cedo', `A reclamação por falta de resposta só pode ser apresentada a partir de ${dataBr(s.recorrerDe)} (30 dias do pedido, Decreto nº 7.724/2012, art. 22).`, `The complaint for lack of reply can only be filed from ${s.recorrerDe} (30 days after the request).`, 409);
    const texto = typeof b.texto === 'string' ? b.texto.trim() : '';
    if (texto.length < 40 || texto.length > 8000) throw erro('texto', 'O recurso precisa do texto (40 a 8000 caracteres).', 'The appeal needs its text (40 to 8000 characters).', 422);
    const em = data(b.em, 'em');
    if (em < s.recorrerDe) throw erro('em', `A data do recurso não pode ser antes de ${dataBr(s.recorrerDe)}.`, `The appeal date can't be before ${s.recorrerDe}.`, 422);
    if (em > s.recorrerAte!) throw erro('fora_do_prazo', `O prazo terminou em ${dataBr(s.recorrerAte!)}: o recurso protocolado depois disso pode ser recusado pelo órgão, e o app não registra.`, `The deadline ended on ${s.recorrerAte}: an appeal filed after it may be rejected by the agency, and the app doesn't record it.`, 422);
    await env.DB.prepare('UPDATE pedidos_lai SET recurso_em = ?, recurso_texto = ?, recurso_tipo = ? WHERE id = ? AND tenant_id = ?').bind(em, texto, s.tipoRecurso, p.id, tenantId).run();
  } else {
    throw erro('acao', 'Ação desconhecida.', 'Unknown action.', 404);
  }
  await registrarEvento(env, tenantId, `materia.lai.${acao}`, 'texto', textoId, { pedidoId: p.id, por: por.id });
}
