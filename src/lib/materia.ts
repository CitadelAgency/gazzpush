import type { Env } from '../env';
import { novoId, registrarEvento, sha256Hex } from './db';
import { ErroMesa, exigirCorpo, lerTexto } from './mesa';
import { analisar, type Analise, type Pendencia } from './assistente';
import { urlDoDoc } from './google';
import { produzirPauta } from './produzir';
import { scoreManual } from './triagem';
import { paginaNoAr } from './escudo';
import { retratarVersao } from './versoes';

// A Matéria (veículo autoral): o jornalista apura uma vez, e tudo o que sai leva a prova junto. "Mandar para o
// Instagram" não passa mais o texto inteiro como relato: a pauta é montada com fatos vindos das afirmações conferidas
// (a frase do autor, a URL da evidência e o trecho literal dela). Frase sem fonte não vira fato; risco jurídico aberto
// trava o envio, com a lista do que falta.

export type { Pendencia } from './assistente';

export class ErroMateria extends ErroMesa {
  constructor(codigo: string, message: string, status: 409 | 422, en: string, readonly pendencias: Pendencia[] = []) {
    super(codigo, message, status, en);
  }
}

interface Base { afirmacaoId: string; trecho: string; evidenciaId: string; evidenciaTrecho: string; url: string; titulo: string | null; r2: string }

/**
 * Fatos da Matéria: a frase com a evidência que a sustenta (a fonte presa pela pessoa vale mais que a do modelo) e as
 * "afirmações minhas" (opinião do autor, sem evidência). Frase sem fonte, ignorada ou com risco não vira fato.
 */
export function fatosDaAnalise(an: Analise): { comFonte: Base[]; minhas: { afirmacaoId: string; trecho: string }[] } {
  const evs = new Map(an.evidencias.map((e) => [e.id, e]));
  const comFonte: Base[] = [];
  const minhas: { afirmacaoId: string; trecho: string }[] = [];
  for (const a of an.afirmacoes) {
    const ap = a.apuracao;
    if (ap?.tipo === 'opiniao') { minhas.push({ afirmacaoId: a.id, trecho: a.trecho }); continue; }
    const [evId, evTrecho] = ap?.tipo === 'fonte' ? [ap.evidenciaId, ap.evidenciaTrecho] : !ap && a.estado === 'com_evidencia' && !a.incerto ? [a.evidenciaId, a.evidenciaTrecho] : [null, null];
    const e = evId ? evs.get(evId) : undefined;
    if (e && evTrecho) comFonte.push({ afirmacaoId: a.id, trecho: a.trecho, evidenciaId: e.id, evidenciaTrecho: evTrecho, url: e.url, titulo: e.titulo, r2: e.r2 });
  }
  return { comFonte, minhas };
}

export type Enviada = { pautaId: string; pecaId: string | null; situacao: 'nova' | 'existente' };

/**
 * Matéria → pauta do carrossel. A versão precisa estar conferida; risco aberto dá 409 com a lista; sem afirmação com
 * evidência, 422. A mesma versão mandada de novo devolve a pauta ativa (e o post dela). Cada evidência usada vira um
 * documento (a URL dela é a fonte do fato); cada afirmação, um fato com o trecho da evidência.
 */
/**
 * Checklist de publicação: com pendência (risco aberto, parágrafo não conferido, aspa sem fonte, conta que não fecha),
 * a Matéria só sai (Instagram, página de fontes) com a assinatura do editor nesta versão.
 */
export function exigirChecklist(an: Analise) {
  if (an.pendencias.length && !an.assinatura) {
    const n = an.pendencias.length;
    throw new ErroMateria('checklist', n === 1
      ? 'Falta 1 item do checklist de publicação. Resolva ou peça ao editor para assinar a publicação.'
      : `Faltam ${n} itens do checklist de publicação. Resolva ou peça ao editor para assinar a publicação.`, 409,
    n === 1 ? '1 publication checklist item is open. Resolve it or ask the editor to sign off the publication.' : `${n} publication checklist items are open. Resolve them or ask the editor to sign off the publication.`,
    an.pendencias);
  }
}

export async function pautaDaMateria(env: Env, tenantId: string, textoId: string, por: string, opcoes: { cardFontes?: boolean } = {}): Promise<Enviada> {
  const t = await lerTexto(env, tenantId, textoId);
  exigirCorpo(t);
  const an = await analisar(env, tenantId, textoId, t);
  exigirChecklist(an);
  // Card final "Como apuramos": só com a página de fontes no ar.
  let fontesUrl: string | null = null;
  if (opcoes.cardFontes) {
    const pagina = await paginaNoAr(env, tenantId, textoId);
    if (!pagina) throw new ErroMateria('sem_pagina', 'Publique a página de fontes antes de pôr o card "Como apuramos" no carrossel.', 409, 'Publish the sources page before adding the "How we reported this" card to the carousel.');
    // O card leva às fontes desta versão: página de outra versão no ar apontaria para o texto de antes.
    if (pagina.versao !== t.versao) throw new ErroMateria('pagina_antiga', `A página de fontes no ar é da versão ${pagina.versao}. Publique a versão atual antes de pôr o card "Como apuramos" no carrossel.`, 409, `The live sources page is from version ${pagina.versao}. Publish the current version before adding the "How we reported this" card to the carousel.`);
    fontesUrl = pagina.url;
  }
  await retratarVersao(env, tenantId, t, 'instagram');

  const { comFonte: base, minhas } = fatosDaAnalise(an);
  // A identidade da pauta: a versão do texto e o estado da apuração (frase, evidência e trecho de cada fato; as
  // afirmações minhas). Tirar uma fonte, ignorar uma frase ou marcar opinião muda a chave e o envio monta outra pauta.
  const chave = await sha256Hex(JSON.stringify({ v: t.versao, f: base.map((b) => [b.trecho, b.evidenciaId, b.evidenciaTrecho]), m: minhas.map((m) => m.trecho) }));

  // A mesma versão, com a mesma apuração, já virou pauta e ela segue ativa: devolve essa (e o post dela). A produção
  // que falhou (pauta de volta a aceita, peça em falhou) começa de novo.
  const existente = async () => {
    const ativa = await env.DB.prepare(
      `SELECT id, status FROM pautas WHERE tenant_id = ? AND texto_id = ? AND materia_chave = ? AND status IN ('sugerida', 'aceita', 'em_producao')
        ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    ).bind(tenantId, textoId, chave).first<{ id: string; status: string }>();
    if (!ativa) return null;
    if (fontesUrl) await env.DB.prepare('UPDATE pautas SET fontes_url = ? WHERE id = ? AND tenant_id = ?').bind(fontesUrl, ativa.id, tenantId).run();
    const ultima = await env.DB.prepare('SELECT id, status FROM pecas WHERE pauta_id = ? AND tenant_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1')
      .bind(ativa.id, tenantId).first<{ id: string; status: string }>();
    let pecaId = ultima?.id ?? null;
    if (!ultima || (ultima.status === 'falhou' && ativa.status !== 'em_producao')) {
      pecaId = (await produzirPauta(env, tenantId, ativa.id, por, 'carrossel'))?.pecaId ?? await ultimaPeca(env, tenantId, ativa.id);
    }
    return { pautaId: ativa.id, pecaId, situacao: 'existente' as const };
  };
  await adotarPautaAntiga(env, tenantId, textoId, t.versao, chave, base, minhas);
  const ja = await existente();
  if (ja) return ja;

  if (!base.length) {
    throw new ErroMateria('sem_fatos', 'Nenhuma afirmação do texto tem evidência no dossiê. Acrescente as fontes e confira de novo: frase sem fonte não vai para o carrossel.', 422,
      'No claim in the text has evidence in the dossier. Add the sources and check again: a sentence without a source does not go into the carousel.');
  }

  const pautaId = novoId();
  // Um documento por evidência usada (a fonte do fato é a URL dela; o texto salvo é o mesmo do dossiê).
  const docs = new Map<string, string>();
  for (const b of base) if (!docs.has(b.evidenciaId)) docs.set(b.evidenciaId, novoId());
  const porEvidencia = new Map(base.map((b) => [b.evidenciaId, b]));
  const fatos = base.map((b) => ({ id: novoId(), ...b }));
  // "Afirmação minha": a fonte é o próprio autor (o texto no Docs ou o endereço do veículo).
  const marca = await env.DB.prepare('SELECT marca_json FROM tenants WHERE id = ?').bind(tenantId).first<{ marca_json: string | null }>();
  const urlAutor = t.docs_id ? urlDoDoc(t.docs_id) : (JSON.parse(marca?.marca_json ?? '{}') as { ctaUrl?: string }).ctaUrl ?? env.PUBLIC_BASE_URL;
  const docAutor = minhas.length ? novoId() : null;
  const opinioes = minhas.map((m) => ({ id: novoId(), ...m }));
  const stmts = [
    ...(docAutor ? [env.DB.prepare(
      `INSERT INTO documentos (id, tenant_id, fonte_id, url, hash_texto, titulo, r2_texto, status, triagem) VALUES (?, ?, NULL, ?, ?, ?, NULL, 'triado', 'autoral')`,
    ).bind(docAutor, tenantId, urlAutor, `materia:${pautaId}:autor`, t.titulo)] : []),
    ...opinioes.map((f) => env.DB.prepare(
      `INSERT INTO fatos (id, tenant_id, documento_id, tipo, texto, hash, confianca) VALUES (?, ?, ?, 'opiniao', ?, ?, 1)`,
    ).bind(f.id, tenantId, docAutor, f.trecho, `materia:${pautaId}:${f.afirmacaoId}`)),
    ...[...docs].map(([evId, docId]) => {
      const e = porEvidencia.get(evId)!;
      return env.DB.prepare(
        `INSERT INTO documentos (id, tenant_id, fonte_id, url, hash_texto, titulo, r2_texto, status, triagem) VALUES (?, ?, NULL, ?, ?, ?, ?, 'triado', 'autoral')`,
      ).bind(docId, tenantId, e.url, `materia:${pautaId}:${evId}`, e.titulo, e.r2);
    }),
    ...fatos.map((f) => env.DB.prepare(
      `INSERT INTO fatos (id, tenant_id, documento_id, tipo, texto, hash, evidencia_id, evidencia_trecho, confianca) VALUES (?, ?, ?, 'afirmacao', ?, ?, ?, ?, 1)`,
    ).bind(f.id, tenantId, docs.get(f.evidenciaId), f.trecho, `materia:${pautaId}:${f.afirmacaoId}`, f.evidenciaId, f.evidenciaTrecho)),
    env.DB.prepare(
      `INSERT INTO pautas (id, tenant_id, status, origem, titulo, resumo, fato_ids_json, documento_ids_json, score, texto_id, texto_versao, fontes_url, materia_chave)
       VALUES (?, ?, 'sugerida', 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(pautaId, tenantId, t.titulo, fatos[0].trecho, JSON.stringify([...fatos, ...opinioes].map((f) => f.id)), JSON.stringify([...docs.values(), ...(docAutor ? [docAutor] : [])]), scoreManual(new Date()), textoId, t.versao, fontesUrl, chave),
    env.DB.prepare('UPDATE textos SET pauta_id = ? WHERE id = ? AND tenant_id = ?').bind(pautaId, textoId, tenantId),
  ];
  try {
    await env.DB.batch(stmts);
  } catch (e) {
    // Dois envios ao mesmo tempo: o índice único deixa entrar um; o outro devolve a pauta que entrou.
    if (!/UNIQUE/i.test(String(e))) throw e;
    const vencedora = await existente();
    if (!vencedora) throw e;
    return vencedora;
  }
  await registrarEvento(env, tenantId, 'materia.instagram', 'texto', textoId, { por, pautaId, versao: t.versao, fatos: fatos.length, minhas: opinioes.length, assinada: an.assinatura?.id ?? null });
  const pecaId = (await produzirPauta(env, tenantId, pautaId, por, 'carrossel'))?.pecaId ?? await ultimaPeca(env, tenantId, pautaId);
  return { pautaId, pecaId, situacao: 'nova' };
}

/**
 * Pauta da Matéria criada antes da chave (migração 0016, `materia_chave` nula): se é da mesma versão e tem exatamente os
 * mesmos fatos (frase, evidência e trecho; as afirmações minhas), ganha a chave e volta a ser a pauta reaproveitada.
 * Fatos diferentes: fica como está, e o envio monta outra.
 */
async function adotarPautaAntiga(env: Env, tenantId: string, textoId: string, versao: number, chave: string,
  base: { trecho: string; evidenciaId: string; evidenciaTrecho: string }[], minhas: { trecho: string }[]) {
  const { results: antigas } = await env.DB.prepare(
    `SELECT id, fato_ids_json FROM pautas WHERE tenant_id = ? AND texto_id = ? AND texto_versao = ? AND materia_chave IS NULL AND tipo_post IS NULL
        AND status IN ('sugerida', 'aceita', 'em_producao') ORDER BY created_at DESC, rowid DESC LIMIT 5`,
  ).bind(tenantId, textoId, versao).all<{ id: string; fato_ids_json: string }>();
  if (!antigas.length) return;
  const assinatura = (fs: string[][]) => JSON.stringify(fs.map((f) => JSON.stringify(f)).sort());
  const queremos = assinatura([...base.map((b) => ['afirmacao', b.trecho, b.evidenciaId, b.evidenciaTrecho]), ...minhas.map((m) => ['opiniao', m.trecho, '', ''])]);
  for (const p of antigas) {
    const { results: fatos } = await env.DB.prepare(
      'SELECT tipo, texto, evidencia_id, evidencia_trecho FROM fatos WHERE tenant_id = ? AND id IN (SELECT value FROM json_each(?))',
    ).bind(tenantId, p.fato_ids_json).all<{ tipo: string; texto: string; evidencia_id: string | null; evidencia_trecho: string | null }>();
    if (assinatura(fatos.map((f) => [f.tipo, f.texto, f.evidencia_id ?? '', f.evidencia_trecho ?? ''])) !== queremos) continue;
    // Outro envio pode ter dado a chave a outra pauta nesse meio-tempo: o índice único recusa, e vale a que já tem.
    await env.DB.prepare('UPDATE pautas SET materia_chave = ? WHERE id = ? AND tenant_id = ? AND materia_chave IS NULL').bind(chave, p.id, tenantId).run()
      .catch((e) => { if (!/UNIQUE/i.test(String(e))) throw e; });
    return;
  }
}

async function ultimaPeca(env: Env, tenantId: string, pautaId: string): Promise<string | null> {
  const p = await env.DB.prepare('SELECT id FROM pecas WHERE pauta_id = ? AND tenant_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1')
    .bind(pautaId, tenantId).first<{ id: string }>();
  return p?.id ?? null;
}

/** Aba Posts: as peças de todas as pautas do texto, com o status e o link publicado. */
export async function postsDaMateria(env: Env, tenantId: string, textoId: string) {
  const { results } = await env.DB.prepare(
    `SELECT pe.id, pe.formato, pe.status, pe.created_at, pe.updated_at, pe.conteudo_json, pa.titulo, pa.texto_versao,
            (SELECT pu.url FROM publicacoes pu WHERE pu.peca_id = pe.id AND pu.tenant_id = pe.tenant_id AND pu.status = 'publicada' ORDER BY pu.created_at DESC LIMIT 1) AS url
       FROM pautas pa JOIN pecas pe ON pe.pauta_id = pa.id AND pe.tenant_id = pa.tenant_id
      WHERE pa.tenant_id = ? AND pa.texto_id = ?
      ORDER BY pe.created_at DESC, pe.rowid DESC LIMIT 100`,
  ).bind(tenantId, textoId).all<{ id: string; formato: string; status: string; created_at: string; updated_at: string; conteudo_json: string; titulo: string; texto_versao: number | null; url: string | null }>();
  return results.map((p) => {
    const c = JSON.parse(p.conteudo_json || '{}') as { manchete?: string };
    return { id: p.id, formato: p.formato, status: p.status, criadoEm: p.created_at, atualizadoEm: p.updated_at, manchete: c.manchete ?? null, titulo: p.titulo, versaoTexto: p.texto_versao, url: p.url };
  });
}
