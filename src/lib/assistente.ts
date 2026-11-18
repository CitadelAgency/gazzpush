import type { Env } from '../env';
import { retratarVersao } from './versoes';
import { cruzarComTexto } from './documento';
import { acharNaGravacao, mmss, transcricoesDoTexto, type NaGravacao } from './gravacao';
import { novoId, registrarEvento } from './db';
import { dataValida, hojeISO } from './lai';
import {
  MEIOS_OUTRO_LADO, RISCOS_OUTRO_LADO, TEMAS, TIPOS_DECISAO, TIPOS_FONTE, TIPOS_REGRA, aspasDoBloco, citaNome, contasDoBloco, fontesCirculares,
  forcaDe, grafiasDiferentes, manualNoBloco, marcaAberta, nomesDoTexto, tipoSugerido, TEMA_SENSIVEL,
  type Idioma, type Regra, type TipoDecisao, type TipoFonte, type TipoRegra,
} from './apuracao';
import { ErroMesa, estadosDosBlocos, estrutura, lerTexto, linhasBlocos, type LinhaTexto } from './mesa';
import { modeloSegunda, segundaLigada } from './segunda';
import { chavesDoVeiculo } from './provedores';

// Assistente do editor da Matéria (Fase 3): o que a pessoa registra de apuração no cartão (e nunca escreve texto), o
// que o código confere sem modelo (contas, aspas, nomes, manual, fontes) e o checklist que trava a publicação.

export interface Apuracao {
  id: string; blocoId: string; trecho: string; tipo: TipoDecisao; evidenciaId: string | null; evidenciaTrecho: string | null;
  outroLado: { quem: string; quando: string; meio: string } | null; por: string; porNome: string | null; em: string;
}

interface LinhaApuracao {
  id: string; bloco_id: string; trecho: string; tipo: TipoDecisao; evidencia_id: string | null; evidencia_trecho: string | null;
  outro_lado_quem: string | null; outro_lado_quando: string | null; outro_lado_meio: string | null; por: string; nome: string | null; created_at: string;
}

const apuracaoDaLinha = (r: LinhaApuracao): Apuracao => ({
  id: r.id, blocoId: r.bloco_id, trecho: r.trecho, tipo: r.tipo, evidenciaId: r.evidencia_id, evidenciaTrecho: r.evidencia_trecho,
  outroLado: r.outro_lado_quem ? { quem: r.outro_lado_quem, quando: r.outro_lado_quando ?? '', meio: r.outro_lado_meio ?? 'outro' } : null,
  por: r.por, porNome: r.nome, em: r.created_at,
});

/** As apurações valendo (não desfeitas) do texto, da mais antiga para a mais nova. */
export async function apuracoesAtivas(env: Env, tenantId: string, textoId: string): Promise<Apuracao[]> {
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.bloco_id, a.trecho, a.tipo, a.evidencia_id, a.evidencia_trecho, a.outro_lado_quem, a.outro_lado_quando, a.outro_lado_meio, a.por, u.name AS nome, a.created_at
       FROM apuracoes a LEFT JOIN "user" u ON u.id = a.por
      WHERE a.tenant_id = ? AND a.texto_id = ? AND a.desfeita_em IS NULL ORDER BY a.created_at, a.rowid`,
  ).bind(tenantId, textoId).all<LinhaApuracao>();
  return results.map(apuracaoDaLinha);
}

/** A apuração mais nova da frase (mesmo bloco e mesmo trecho literal). */
export const apuracaoDe = (aps: Apuracao[], blocoId: string, trecho: string) => aps.filter((a) => a.blocoId === blocoId && a.trecho === trecho).at(-1) ?? null;

export interface EvidenciaLida {
  id: string; url: string; titulo: string | null; tipoFonte: TipoFonte | null; r2: string; texto: string; conferidaEm: string; mudouEm: string | null; viaNavegador: boolean; criadaEm: string;
  /** link (página lida) ou resposta (do outro lado, por e-mail ou colada): a resposta não tem página nem Wayback. */
  origem: 'link' | 'resposta' | 'documento' | 'lai'; hash: string;
  wayback: { estado: 'pendente' | 'salvo' | 'falhou'; url: string | null; em: string | null; erro: string | null } | null;
}

export async function evidenciasComTexto(env: Env, tenantId: string, textoId: string): Promise<EvidenciaLida[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, url, titulo, tipo_fonte, r2_texto, conferida_em, mudou_em, via_navegador, created_at, origem, hash, wayback_estado, wayback_url, wayback_em, wayback_erro
       FROM evidencias WHERE texto_id = ? AND tenant_id = ? ORDER BY created_at, rowid`,
  ).bind(textoId, tenantId).all<{
    id: string; url: string; titulo: string | null; tipo_fonte: string | null; r2_texto: string; conferida_em: string; mudou_em: string | null; via_navegador: number; created_at: string;
    origem: string; hash: string; wayback_estado: string | null; wayback_url: string | null; wayback_em: string | null; wayback_erro: string | null;
  }>();
  return Promise.all(results.map(async (e) => ({
    id: e.id, url: e.url, titulo: e.titulo, tipoFonte: (TIPOS_FONTE as readonly string[]).includes(e.tipo_fonte ?? '') ? (e.tipo_fonte as TipoFonte) : null,
    r2: e.r2_texto, texto: (await env.MEDIA.get(e.r2_texto).then((x) => x?.text())) ?? '', conferidaEm: e.conferida_em, mudouEm: e.mudou_em,
    viaNavegador: e.via_navegador === 1, criadaEm: e.created_at, origem: e.origem === 'resposta' || e.origem === 'documento' || e.origem === 'lai' ? e.origem : 'link' as const, hash: e.hash,
    wayback: e.wayback_estado === 'pendente' || e.wayback_estado === 'salvo' || e.wayback_estado === 'falhou'
      ? { estado: e.wayback_estado, url: e.wayback_url, em: e.wayback_em, erro: e.wayback_erro } : null,
  })));
}

export async function regrasDoManual(env: Env, tenantId: string): Promise<(Regra & { criadaEm: string })[]> {
  const { results } = await env.DB.prepare('SELECT id, tipo, procurar, preferir, nota, created_at FROM manual_regras WHERE tenant_id = ? ORDER BY tipo, procurar')
    .bind(tenantId).all<{ id: string; tipo: TipoRegra; procurar: string; preferir: string | null; nota: string | null; created_at: string }>();
  return results.map((r) => ({ id: r.id, tipo: r.tipo, procurar: r.procurar, preferir: r.preferir, nota: r.nota, criadaEm: r.created_at }));
}

export interface Pendencia { tipo: 'risco' | 'paragrafo' | 'aspa' | 'conta'; id: string; blocoId: string | null; trecho: string; explicacao: string | null; risco?: string | null }

export interface AfirmacaoValida {
  id: string; paragrafo: number; inicio: number; fim: number; trecho: string; estado: 'com_evidencia' | 'sem_fonte' | 'risco'; risco: string | null;
  evidenciaId: string | null; evidenciaTrecho: string | null; explicacao: string | null; blocoId: string; incerto: boolean; aberta: boolean; apuracao: Apuracao | null;
}

const tr = (idioma: Idioma, pt: string, en: string) => (idioma === 'en' ? en : pt);

/**
 * Tudo o que a Matéria sabe do texto agora: blocos e o estado de cada um, as afirmações que valem (de bloco conferido
 * com o hash de agora) com a apuração da pessoa, o dossiê com a força das fontes, os apontamentos do código (contas,
 * aspas sem fonte, manual), as pessoas e instituições e o checklist de publicação.
 */
export async function analisar(env: Env, tenantId: string, textoId: string, t?: LinhaTexto) {
  t ??= await lerTexto(env, tenantId, textoId);
  const [tenant, est, linhas, aps, evs, regras, assinatura, chaves] = await Promise.all([
    env.DB.prepare('SELECT idioma FROM tenants WHERE id = ?').bind(tenantId).first<{ idioma: string | null }>(),
    estrutura(t),
    linhasBlocos(env, tenantId, textoId),
    apuracoesAtivas(env, tenantId, textoId),
    evidenciasComTexto(env, tenantId, textoId),
    regrasDoManual(env, tenantId),
    env.DB.prepare(`SELECT s.id, s.por, u.name AS nome, s.created_at, s.pendencias_json FROM assinaturas s LEFT JOIN "user" u ON u.id = s.por
                     WHERE s.tenant_id = ? AND s.texto_id = ? AND s.versao = ? ORDER BY s.created_at DESC LIMIT 1`)
      .bind(tenantId, textoId, t.versao).first<{ id: string; por: string; nome: string | null; created_at: string; pendencias_json: string }>(),
    chavesDoVeiculo(env, tenantId),
  ]);
  const idioma: Idioma = tenant?.idioma === 'en' ? 'en' : 'pt-BR';
  const { results: linhasAf } = await env.DB.prepare(
    `SELECT id, paragrafo, inicio, fim, trecho, estado, risco, evidencia_id, evidencia_trecho, explicacao, bloco_id, incerto
       FROM afirmacoes WHERE texto_id = ? AND tenant_id = ? ORDER BY paragrafo, inicio`,
  ).bind(textoId, tenantId).all<Record<string, unknown>>();

  // Texto antigo, nunca salvo pelo editor nem conferido por bloco: vale a conferência da versão (marcas pelo índice).
  const legado = !t.doc_json && !linhas.size;
  const blocos = estadosDosBlocos(est, linhas, legado && t.conferido_versao === t.versao);
  const conferidos = new Set(blocos.filter((b) => b.estado === 'conferido').map((b) => b.id));
  const afirmacoes: AfirmacaoValida[] = [];
  for (const a of linhasAf) {
    const blocoId = (a.bloco_id as string | null) ?? (legado ? est.blocos[a.paragrafo as number]?.id ?? null : null);
    if (!blocoId || !conferidos.has(blocoId)) continue;
    const base = {
      id: a.id as string, paragrafo: a.paragrafo as number, inicio: a.inicio as number, fim: a.fim as number, trecho: a.trecho as string,
      estado: a.estado as AfirmacaoValida['estado'], risco: a.risco as string | null, evidenciaId: a.evidencia_id as string | null,
      evidenciaTrecho: a.evidencia_trecho as string | null, explicacao: a.explicacao as string | null, blocoId, incerto: a.incerto === 1,
    };
    const apuracao = apuracaoDe(aps, blocoId, base.trecho);
    afirmacoes.push({ ...base, apuracao, aberta: marcaAberta(base, apuracao) });
  }

  // Apontamentos do código, bloco a bloco (o texto de agora, não o conferido: a conta errada aparece ao salvar).
  const comTexto = evs.map((e) => ({ id: e.id, texto: e.texto }));
  const apontamentos: { id: string; tipo: 'conta' | 'aspa' | 'manual' | 'gravacao'; blocoId: string; inicio: number; fim: number; trecho: string; explicacao: string; regraTipo?: string; gravacao?: NaGravacao }[] = [];
  // Aspas contra a gravação (Fase 6): a citação que não está numa fonte do dossiê é procurada, palavra por palavra, nas
  // transcrições prontas. Gravação ainda sendo transcrita: a aspa fica aberta e diz isso (nunca some calada).
  const gravs = await transcricoesDoTexto(env, tenantId, textoId);
  for (const b of est.blocos) {
    if (!b.texto.trim()) continue;
    for (const c of contasDoBloco(b.id, b.texto, idioma)) apontamentos.push({ id: `conta:${b.id}:${c.inicio}`, tipo: 'conta', ...c });
    for (const a of aspasDoBloco(b.id, b.texto, comTexto)) {
      if (a.evidenciaId) continue;
      const g = acharNaGravacao(a.citacao, gravs.prontas);
      if (g) {
        apontamentos.push({ id: `grav:${b.id}:${a.inicio}`, tipo: 'gravacao', blocoId: b.id, inicio: a.inicio, fim: a.fim, trecho: a.trecho, gravacao: g,
          explicacao: tr(idioma, `Bate com a gravação aos ${mmss(g.inicio)} (${g.nome}), palavra por palavra.`, `Matches the recording at ${mmss(g.inicio)} (${g.nome}), word for word.`) });
        continue;
      }
      apontamentos.push({ id: `aspa:${b.id}:${a.inicio}`, tipo: 'aspa', blocoId: b.id, inicio: a.inicio, fim: a.fim, trecho: a.trecho,
        explicacao: !gravs.total
          ? tr(idioma, 'Esta citação não está, letra por letra, em nenhuma fonte do dossiê.', 'This quote is not, word for word, in any dossier source.')
          : gravs.lendo
            ? tr(idioma, 'Esta citação não está em nenhuma fonte do dossiê nem nas gravações transcritas; uma gravação ainda está sendo transcrita.', 'This quote is not in any dossier source or transcribed recording; a recording is still being transcribed.')
            : tr(idioma, 'Esta citação não está, palavra por palavra, em nenhuma fonte do dossiê nem nas gravações.', 'This quote is not, word for word, in any dossier source or recording.') });
    }
    for (const m of manualNoBloco(b.id, b.texto, regras, idioma)) apontamentos.push({ id: `manual:${b.id}:${m.inicio}`, tipo: 'manual', blocoId: m.blocoId, inicio: m.inicio, fim: m.fim, trecho: m.trecho, explicacao: m.explicacao, regraTipo: m.tipo });
  }

  // Documentos do dossiê (Fase 5): o total que a frase diz contra o total (ou a soma) que o documento traz.
  const { results: docs } = await env.DB.prepare("SELECT id, nome, totais_json FROM arquivos WHERE texto_id = ? AND tenant_id = ? AND estado = 'pronto' AND totais_json IS NOT NULL")
    .bind(textoId, tenantId).all<{ id: string; nome: string; totais_json: string }>();
  if (docs.length) {
    const comDocs = docs.map((d) => ({ id: d.id, nome: d.nome, totais: JSON.parse(d.totais_json) }));
    for (const c of cruzarComTexto(est.blocos.filter((b) => b.texto.trim()), comDocs, idioma)) {
      apontamentos.push({ id: `doc:${c.blocoId}:${c.inicio}`, tipo: 'conta', blocoId: c.blocoId, inicio: c.inicio, fim: c.inicio + c.trecho.length, trecho: c.trecho, explicacao: c.explicacao });
    }
  }

  // Pessoas e instituições: menções, grafia diferente e, para quem é acusado no texto, se o outro lado foi procurado.
  const nomes = nomesDoTexto(est.blocos);
  const grafias = grafiasDiferentes(nomes);
  const acusacoes = afirmacoes.filter((a) => a.estado === 'risco' && RISCOS_OUTRO_LADO.includes(a.risco ?? ''));
  const outrosLados = aps.filter((a) => a.tipo === 'outro_lado' && a.outroLado);
  // O contato registrado numa frase vale para quem foi procurado (o nome em "quem") e, pela frase, só quando ela cita
  // uma pessoa só: numa frase que acusa duas, procurar uma não é procurar a outra.
  const soUmaNaFrase = (trecho: string, nome: string) => {
    const citadas = nomes.filter((m) => m.tipo === 'pessoa' && citaNome(trecho, m.nome));
    return citadas.length === 1 && citadas[0].nome === nome;
  };
  const pessoas = nomes.map((n) => {
    const acusada = acusacoes.some((a) => citaNome(a.trecho, n.nome));
    const procurado = outrosLados.find((o) => citaNome(o.outroLado!.quem, n.nome) || citaNome(n.nome, o.outroLado!.quem) || soUmaNaFrase(o.trecho, n.nome));
    return {
      nome: n.nome, tipo: n.tipo, mencoes: n.mencoes.length, primeira: n.mencoes[0],
      grafias: grafias.find((g) => g.includes(n.nome))?.filter((x) => x !== n.nome) ?? [],
      acusada, outroLado: procurado ? { ...procurado.outroLado!, por: procurado.porNome, em: procurado.em } : null,
    };
  });

  // Fontes: força pelo tipo, sugestão de oficial pelo endereço, fontes circulares e o texto apoiado numa fonte só.
  const circulares = fontesCirculares(evs);
  const apoios = afirmacoes.flatMap((a) => (a.apuracao?.tipo === 'fonte' ? [a.apuracao.evidenciaId] : !a.apuracao && a.estado === 'com_evidencia' && a.evidenciaId ? [a.evidenciaId] : []));
  const fonteUnica = apoios.length >= 2 && new Set(apoios).size === 1 && evs.length > 0 ? apoios[0] : null;

  // Checklist de publicação.
  const pendencias: Pendencia[] = [];
  for (const a of afirmacoes) {
    if (a.aberta && (a.estado === 'risco' || a.incerto)) pendencias.push({ tipo: 'risco', id: a.id, blocoId: a.blocoId, trecho: a.trecho, explicacao: a.explicacao, risco: a.risco });
  }
  for (const b of blocos) {
    const bloco = est.blocos.find((x) => x.id === b.id)!;
    if (b.estado !== 'conferido' && bloco.texto.trim()) {
      pendencias.push({ tipo: 'paragrafo', id: `paragrafo:${b.id}`, blocoId: b.id, trecho: bloco.texto.slice(0, 160),
        explicacao: b.erro ?? tr(idioma, 'Parágrafo ainda não conferido.', 'Paragraph not checked yet.') });
    }
  }
  for (const p of apontamentos) if (p.tipo === 'aspa' || p.tipo === 'conta') pendencias.push({ tipo: p.tipo, id: p.id, blocoId: p.blocoId, trecho: p.trecho, explicacao: p.explicacao });

  // A assinatura vale para as pendências que o editor viu ao assinar. Surgiu pendência nova na mesma versão (uma fonte
  // saiu do dossiê, uma aspa perdeu a evidência): a assinatura não cobre, e o checklist volta a pedir.
  const assinadas = assinatura ? new Set((JSON.parse(assinatura.pendencias_json) as Pendencia[]).map(chavePendencia)) : null;
  const assinaturaValida = assinatura && pendencias.every((p) => assinadas!.has(chavePendencia(p))) ? assinatura : null;
  return {
    t, idioma, est, blocos, afirmacoes, apuracoes: aps, evidencias: evs, regras, apontamentos, pessoas, circulares, fonteUnica, pendencias,
    assinatura: assinaturaValida ? { id: assinaturaValida.id, por: assinaturaValida.nome, em: assinaturaValida.created_at, pendencias: assinadas!.size } : null,
    segunda: { ligada: segundaLigada(chaves), modelo: segundaLigada(chaves) ? modeloSegunda(env) : null },
    // Quem confere o texto (DeepSeek ou Gemini), para a tela dizer o nome certo; null: sem chave de texto.
    provedorTexto: chaves.texto?.provedor ?? null,
    temaSensivel: TEMA_SENSIVEL.test(est.blocos.map((b) => b.texto).join('\n')),
  };
}
export type Analise = Awaited<ReturnType<typeof analisar>>;

/**
 * A pendência pelo que ela é (tipo, parágrafo, trecho e, no risco, o tipo do risco), não pelo id da marca, que muda a
 * cada reconferência. O mesmo trecho com outro risco (era "sem outro lado", virou "vítima ou menor") pede outra assinatura.
 */
const chavePendencia = (p: Pick<Pendencia, 'tipo' | 'blocoId' | 'trecho' | 'risco'>) => `${p.tipo}|${p.blocoId ?? ''}|${p.trecho}|${p.tipo === 'risco' ? p.risco ?? '' : ''}`;

/** A força de cada evidência, para a tela (o tipo escolhido pela pessoa, ou a sugestão pelo endereço). */
export const forcaDaEvidencia = (e: { url: string; tipoFonte: TipoFonte | null }) => ({ tipoFonte: e.tipoFonte, tipoSugerido: tipoSugerido(e.url), forca: forcaDe(e.tipoFonte) });

// ── ações do cartão ─────────────────────────────────────────────────────────────────────────────────────────────

const erro400 = (codigo: string, pt: string, en: string, status: 400 | 404 | 409 | 422 = 400) => new ErroMesa(codigo, pt, status, en);

/**
 * Registra a ação do cartão sobre uma afirmação do texto. Prender fonte: a evidência é do dossiê deste texto e o trecho
 * está literalmente no texto salvo dela (senão 422). Outro lado: só em risco de acusação ou de outro lado; quem, data
 * (não futura) e meio. Opinião e Ignorar: só quem e quando (a sessão).
 */
export async function registrarApuracao(env: Env, tenantId: string, textoId: string, por: string, b: Record<string, unknown>): Promise<Apuracao> {
  await lerTexto(env, tenantId, textoId);
  if (typeof b.afirmacaoId !== 'string') throw erro400('afirmacao', 'afirmacaoId: texto', 'afirmacaoId: string');
  const a = await env.DB.prepare('SELECT bloco_id, paragrafo, trecho, estado, risco FROM afirmacoes WHERE id = ? AND texto_id = ? AND tenant_id = ?')
    .bind(b.afirmacaoId, textoId, tenantId).first<{ bloco_id: string | null; paragrafo: number; trecho: string; estado: string; risco: string | null }>();
  if (!a) throw erro400('nao_encontrado', 'não encontrado', 'not found', 404);
  if (!(TIPOS_DECISAO as readonly unknown[]).includes(b.tipo)) throw erro400('tipo', `tipo: um de ${TIPOS_DECISAO.join(', ')}`, `tipo: one of ${TIPOS_DECISAO.join(', ')}`);
  const tipo = b.tipo as TipoDecisao;
  let evidenciaId: string | null = null, evidenciaTrecho: string | null = null, quem: string | null = null, quando: string | null = null, meio: string | null = null;
  if (tipo === 'fonte') {
    if (typeof b.evidenciaId !== 'string' || typeof b.evidenciaTrecho !== 'string') throw erro400('fonte', 'Escolha a fonte e cole o trecho dela que sustenta a frase.', 'Choose the source and paste the passage from it that supports the sentence.');
    const ev = await env.DB.prepare('SELECT r2_texto FROM evidencias WHERE id = ? AND texto_id = ? AND tenant_id = ?').bind(b.evidenciaId, textoId, tenantId).first<{ r2_texto: string }>();
    if (!ev) throw erro400('nao_encontrado', 'não encontrado', 'not found', 404);
    const trecho = b.evidenciaTrecho.trim();
    const salvo = (await env.MEDIA.get(ev.r2_texto).then((x) => x?.text())) ?? '';
    // Literal: o trecho como está no texto salvo da fonte (espaços juntos dos dois lados, nada mais).
    const junta = (s: string) => s.replace(/\s+/g, ' ');
    if (trecho.length < 3 || trecho.length > 2000 || !junta(salvo).includes(junta(trecho))) {
      throw erro400('trecho_fora', 'Esse trecho não está, letra por letra, no texto salvo da fonte. Copie da fonte e cole de novo.', "That passage is not, word for word, in the source's saved text. Copy it from the source and paste again.", 422);
    }
    evidenciaId = b.evidenciaId;
    evidenciaTrecho = trecho;
  } else if (tipo === 'outro_lado') {
    if (a.estado !== 'risco' || !RISCOS_OUTRO_LADO.includes(a.risco ?? '')) throw erro400('outro_lado', 'Outro lado vale para acusação e para frase sem o outro lado.', 'The other side applies to accusations and to sentences without the other side.', 422);
    quem = typeof b.quem === 'string' ? b.quem.replace(/\s+/g, ' ').trim() : '';
    quando = typeof b.quando === 'string' ? b.quando : '';
    meio = typeof b.meio === 'string' ? b.meio : '';
    if (quem.length < 2 || quem.length > 200) throw erro400('quem', 'Diga quem você procurou (nome ou assessoria).', 'Say who you contacted (name or press office).');
    // Até hoje no fuso do produto (Brasília); a data tem de existir no calendário.
    if (!dataValida(quando) || quando > hojeISO()) throw erro400('quando', 'Diga quando procurou (uma data até hoje).', 'Say when you made contact (a date up to today).');
    if (!(MEIOS_OUTRO_LADO as readonly string[]).includes(meio)) throw erro400('meio', `meio: um de ${MEIOS_OUTRO_LADO.join(', ')}`, `meio: one of ${MEIOS_OUTRO_LADO.join(', ')}`);
  }
  const id = novoId();
  await env.DB.prepare(
    `INSERT INTO apuracoes (id, tenant_id, texto_id, bloco_id, trecho, tipo, evidencia_id, evidencia_trecho, outro_lado_quem, outro_lado_quando, outro_lado_meio, por)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, tenantId, textoId, a.bloco_id ?? `p${a.paragrafo}`, a.trecho, tipo, evidenciaId, evidenciaTrecho, quem, quando, meio, por).run();
  await registrarEvento(env, tenantId, `apuracao.${tipo}`, 'texto', textoId, { apuracaoId: id, por, trecho: a.trecho.slice(0, 200) });
  return (await apuracoesAtivas(env, tenantId, textoId)).find((x) => x.id === id)!;
}

/** Desfaz a ação (não apaga: grava quem e quando). */
export async function desfazerApuracao(env: Env, tenantId: string, textoId: string, apuracaoId: string, por: string): Promise<boolean> {
  const r = await env.DB.prepare("UPDATE apuracoes SET desfeita_em = datetime('now'), desfeita_por = ? WHERE id = ? AND texto_id = ? AND tenant_id = ? AND desfeita_em IS NULL")
    .bind(por, apuracaoId, textoId, tenantId).run();
  if (!r.meta.changes) return false;
  await registrarEvento(env, tenantId, 'apuracao.desfeita', 'texto', textoId, { apuracaoId, por });
  return true;
}

export async function tipoDaFonte(env: Env, tenantId: string, textoId: string, evidenciaId: string, tipo: unknown): Promise<boolean> {
  if (tipo !== null && !(TIPOS_FONTE as readonly unknown[]).includes(tipo)) throw erro400('tipo', `tipoFonte: um de ${TIPOS_FONTE.join(', ')}`, `tipoFonte: one of ${TIPOS_FONTE.join(', ')}`);
  const r = await env.DB.prepare('UPDATE evidencias SET tipo_fonte = ? WHERE id = ? AND texto_id = ? AND tenant_id = ?').bind(tipo, evidenciaId, textoId, tenantId).run();
  return r.meta.changes > 0;
}

// ── checklist ───────────────────────────────────────────────────────────────────────────────────────────────────

/** O editor assina a publicação desta versão com as pendências que havia (registradas). */
export async function assinar(env: Env, tenantId: string, textoId: string, versao: unknown, por: string) {
  const t = await lerTexto(env, tenantId, textoId);
  if (versao !== t.versao) throw erro400('versao', 'O texto mudou desde que você abriu. Recarregue antes de assinar.', 'The text changed since you opened it. Reload before signing.', 409);
  const an = await analisar(env, tenantId, textoId, t);
  const id = novoId();
  await env.DB.prepare('INSERT INTO assinaturas (id, tenant_id, texto_id, versao, por, pendencias_json) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, tenantId, textoId, t.versao, por, JSON.stringify(an.pendencias)).run();
  await retratarVersao(env, tenantId, t, 'assinatura');
  await registrarEvento(env, tenantId, 'materia.assinada', 'texto', textoId, { por, versao: t.versao, pendencias: an.pendencias.length });
  return { id, pendencias: an.pendencias.length };
}

// ── manual de redação ───────────────────────────────────────────────────────────────────────────────────────────

const limpa = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

export async function criarRegra(env: Env, tenantId: string, por: string, b: Record<string, unknown>) {
  if (!(TIPOS_REGRA as readonly unknown[]).includes(b.tipo)) throw erro400('tipo', `tipo: um de ${TIPOS_REGRA.join(', ')}`, `tipo: one of ${TIPOS_REGRA.join(', ')}`);
  const procurar = limpa(b.procurar, 80);
  const preferir = limpa(b.preferir, 80) || null;
  const nota = limpa(b.nota, 200) || null;
  if (!procurar) throw erro400('procurar', 'Diga a forma que o manual pede para evitar.', 'Say the form the style guide asks to avoid.');
  if (preferir === procurar) throw erro400('preferir', 'A forma do manual é igual à que se quer evitar.', 'The preferred form is the same as the one to avoid.');
  const id = novoId();
  const r = await env.DB.prepare('INSERT INTO manual_regras (id, tenant_id, tipo, procurar, preferir, nota, por) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (tenant_id, procurar) DO NOTHING RETURNING id')
    .bind(id, tenantId, b.tipo, procurar, preferir, nota, por).first<{ id: string }>();
  if (!r) throw erro400('existe', 'Já há uma regra para essa forma.', 'There is already a rule for that form.', 409);
  return { id };
}

export async function removerRegra(env: Env, tenantId: string, id: string): Promise<boolean> {
  const r = await env.DB.prepare('DELETE FROM manual_regras WHERE id = ? AND tenant_id = ?').bind(id, tenantId).run();
  return r.meta.changes > 0;
}

// ── auditoria ───────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Painel de auditoria do veículo: marcas por mês, por tema (os eixos da bateria de simetria) e por pessoa citada, e as
 * ignoradas com quem e quando. A mesma frase conferida de novo no mesmo mês conta uma vez.
 */
export async function auditoria(env: Env, tenantId: string, dias = 180) {
  const desde = `-${Math.max(1, Math.min(730, Math.floor(dias)))} days`;
  const unica = "COUNT(DISTINCT h.texto_id || '|' || h.trecho || '|' || h.estado)";
  const [meses, temas, pessoas, ignoradas] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare(`SELECT strftime('%Y-%m', h.created_at) AS mes, h.estado, h.incerto, ${unica} AS n FROM marcas_historico h
                     WHERE h.tenant_id = ? AND h.created_at >= datetime('now', ?) GROUP BY mes, h.estado, h.incerto ORDER BY mes`).bind(tenantId, desde),
    env.DB.prepare(`SELECT j.value AS tema, h.estado, ${unica} AS n FROM marcas_historico h, json_each(h.temas_json) j
                     WHERE h.tenant_id = ? AND h.created_at >= datetime('now', ?) GROUP BY tema, h.estado`).bind(tenantId, desde),
    env.DB.prepare(`SELECT j.value AS nome, h.estado, ${unica} AS n FROM marcas_historico h, json_each(h.pessoas_json) j
                     WHERE h.tenant_id = ? AND h.created_at >= datetime('now', ?) GROUP BY nome, h.estado`).bind(tenantId, desde),
    env.DB.prepare(`SELECT a.id, a.trecho, a.created_at, a.desfeita_em, u.name AS por, t.titulo, t.id AS texto_id FROM apuracoes a
                      JOIN textos t ON t.id = a.texto_id AND t.tenant_id = a.tenant_id LEFT JOIN "user" u ON u.id = a.por
                     WHERE a.tenant_id = ? AND a.tipo = 'ignorar' AND a.created_at >= datetime('now', ?) ORDER BY a.created_at DESC LIMIT 100`).bind(tenantId, desde),
  ]);
  type Conta = { com_evidencia: number; sem_fonte: number; risco: number; incerto: number };
  const zero = (): Conta => ({ com_evidencia: 0, sem_fonte: 0, risco: 0, incerto: 0 });
  const somar = (c: Conta, estado: string, incerto: unknown, n: number) => {
    if (estado === 'com_evidencia' || estado === 'sem_fonte' || estado === 'risco') c[estado] += n;
    if (incerto === 1) c.incerto += n;
  };
  const porMes = new Map<string, Conta>();
  for (const r of meses.results) { const c = porMes.get(r.mes as string) ?? zero(); somar(c, r.estado as string, r.incerto, Number(r.n)); porMes.set(r.mes as string, c); }
  const porTema = new Map<string, Conta>(TEMAS.map((x) => [x.id, zero()]));
  for (const r of temas.results) { const c = porTema.get(r.tema as string); if (c) somar(c, r.estado as string, 0, Number(r.n)); }
  const porPessoa = new Map<string, Conta>();
  for (const r of pessoas.results) { const c = porPessoa.get(r.nome as string) ?? zero(); somar(c, r.estado as string, 0, Number(r.n)); porPessoa.set(r.nome as string, c); }
  const total = (c: Conta) => c.com_evidencia + c.sem_fonte + c.risco;
  return {
    meses: [...porMes].map(([mes, c]) => ({ mes, ...c })),
    temas: TEMAS.map((x) => ({ id: x.id, pt: x.pt, en: x.en, ...porTema.get(x.id)! })),
    pessoas: [...porPessoa].map(([nome, c]) => ({ nome, ...c })).sort((a, b) => total(b) - total(a) || a.nome.localeCompare(b.nome)).slice(0, 30),
    ignoradas: ignoradas.results.map((r) => ({
      id: r.id as string, trecho: r.trecho as string, em: r.created_at as string, desfeitaEm: r.desfeita_em as string | null,
      por: r.por as string | null, textoId: r.texto_id as string, titulo: r.titulo as string,
    })),
  };
}
