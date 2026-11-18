import type { Env } from '../env';
import { novoId, registrarEvento } from './db';
import { acharNaGravacao } from './gravacao';
import { ErroMesa, lerTexto } from './mesa';
import {
  NOTA_MAX, RECORTES_POR_TEXTO, TRECHO_MAX, TRECHO_MIN, TRECHO_MIN_DOCUMENTO, BUSCA_MAX, acharNoTexto, dobrar, juntarEspacos, paragrafosDaFonte,
  termosDaBusca, trechoNaFonte, type Achado,
} from './recorte';

// Material ao lado: o organizador de fontes do editor. Recortes (trecho literal de uma fonte, ou anotação da pessoa) por
// texto, o texto guardado da fonte para ler ao lado, a busca única nas fontes do texto e o acervo do veículo (as fontes e
// os recortes guardados dos outros textos, para trazer sem ler, processar ou transcrever de novo). Tudo por código, sem
// modelo. A checagem literal é a de recorte.ts, a mesma que a tela usa.

const erro = (codigo: string, pt: string, en: string, status: 400 | 404 | 409 | 422 = 400) => new ErroMesa(codigo, pt, status, en);
const naoEncontrado = () => erro('nao_encontrado', 'não encontrado', 'not found', 404);

export const ORIGENS_RECORTE = ['evidencia', 'documento', 'gravacao', 'nota'] as const;
export type OrigemRecorte = (typeof ORIGENS_RECORTE)[number];

export interface Recorte {
  id: string; origem: OrigemRecorte; evidenciaId: string | null; arquivoId: string | null; pagina: number | null; inicio: number | null;
  trecho: string; nota: string | null; fonte: { nome: string | null; url: string | null };
  /** A fonte ainda está neste texto (a evidência pode ter saído do dossiê; o recorte fica). Anotação: sempre. */
  fonteExiste: boolean;
  /** Pode ir para o acervo: anotação, PDF, gravação, ou link. A resposta do outro lado e a de LAI ficam no texto delas. */
  compartilhavel: boolean;
  acervo: boolean; ordem: number; por: string; porNome: string | null; criadoEm: string;
}

interface LinhaRecorte {
  id: string; tenant_id: string; texto_id: string; origem: string; evidencia_id: string | null; arquivo_id: string | null; pagina: number | null; inicio: number | null;
  trecho: string; nota: string | null; fonte_nome: string | null; fonte_url: string | null; acervo: number; ordem: number; por: string; created_at: string;
}

export async function recortesDoTexto(env: Env, tenantId: string, textoId: string): Promise<Recorte[]> {
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.origem, r.evidencia_id, r.arquivo_id, r.pagina, r.inicio, r.trecho, r.nota, r.fonte_nome, r.fonte_url, r.acervo, r.ordem, r.por, r.created_at,
            u.name AS por_nome, e.origem AS ev_origem, a.id AS arq_id
       FROM recortes r
       LEFT JOIN "user" u ON u.id = r.por
       LEFT JOIN evidencias e ON e.id = r.evidencia_id AND e.texto_id = r.texto_id AND e.tenant_id = r.tenant_id
       LEFT JOIN arquivos a ON a.id = r.arquivo_id AND a.texto_id = r.texto_id AND a.tenant_id = r.tenant_id
      WHERE r.tenant_id = ? AND r.texto_id = ? ORDER BY r.ordem, r.created_at, r.rowid`,
  ).bind(tenantId, textoId).all<LinhaRecorte & { por_nome: string | null; ev_origem: string | null; arq_id: string | null }>();
  return results.map((r) => ({
    id: r.id, origem: r.origem as OrigemRecorte, evidenciaId: r.evidencia_id, arquivoId: r.arquivo_id, pagina: r.pagina, inicio: r.inicio,
    trecho: r.trecho, nota: r.nota, fonte: { nome: r.fonte_nome, url: r.fonte_url },
    fonteExiste: r.origem === 'nota' || (r.origem === 'evidencia' ? !!r.ev_origem : !!r.arq_id),
    compartilhavel: r.origem !== 'evidencia' || r.ev_origem === 'link' || (!r.ev_origem && !!r.fonte_url),
    acervo: r.acervo === 1, ordem: r.ordem, por: r.por, porNome: r.por_nome, criadoEm: r.created_at,
  }));
}

/** O texto de uma página ou da transcrição; null: a fonte não está no texto. */
async function textoDaFonteDoRecorte(env: Env, tenantId: string, textoId: string, origem: OrigemRecorte, b: Record<string, unknown>) {
  if (origem === 'evidencia') {
    if (typeof b.evidenciaId !== 'string') throw erro('fonte', 'evidenciaId: texto', 'evidenciaId: string');
    const e = await env.DB.prepare('SELECT id, url, titulo, origem, r2_texto FROM evidencias WHERE id = ? AND texto_id = ? AND tenant_id = ?')
      .bind(b.evidenciaId, textoId, tenantId).first<{ id: string; url: string; titulo: string | null; origem: string; r2_texto: string }>();
    if (!e) throw naoEncontrado();
    const texto = (await env.MEDIA.get(e.r2_texto).then((x) => x?.text())) ?? '';
    return { texto, evidenciaId: e.id, arquivoId: null, pagina: null, nome: e.titulo ?? e.url, url: e.origem === 'link' ? e.url : null, trechos: null };
  }
  if (typeof b.arquivoId !== 'string') throw erro('fonte', 'arquivoId: texto', 'arquivoId: string');
  const a = await env.DB.prepare('SELECT id, nome, estado FROM arquivos WHERE id = ? AND texto_id = ? AND tenant_id = ? AND tipo = ?')
    .bind(b.arquivoId, textoId, tenantId, origem === 'documento' ? 'pdf' : 'audio').first<{ id: string; nome: string; estado: string }>();
  if (!a) throw naoEncontrado();
  if (a.estado !== 'pronto') throw erro('nao_pronto', 'Essa fonte ainda não foi lida (ou a leitura falhou).', "That source hasn't been read yet (or reading failed).", 409);
  if (origem === 'documento') {
    const pagina = Number(b.pagina);
    const p = Number.isInteger(pagina) ? await env.DB.prepare('SELECT texto FROM arquivo_paginas WHERE arquivo_id = ? AND tenant_id = ? AND pagina = ?').bind(a.id, tenantId, pagina).first<{ texto: string }>() : null;
    if (!p) throw erro('pagina', 'Essa página não existe no documento.', "That page doesn't exist in the document.", 422);
    return { texto: p.texto, evidenciaId: null, arquivoId: a.id, pagina, nome: a.nome, url: null, trechos: null };
  }
  const { results } = await env.DB.prepare('SELECT inicio, fim, texto, palavras_json FROM gravacao_trechos WHERE arquivo_id = ? AND tenant_id = ? ORDER BY n')
    .bind(a.id, tenantId).all<{ inicio: number; fim: number; texto: string; palavras_json: string }>();
  // Os trechos juntos com um espaço: a seleção que pega o fim de um e o começo do outro continua literal.
  const trechos = results.map((r) => ({ ...r, texto: juntarEspacos(r.texto) })).filter((r) => r.texto);
  return { texto: trechos.map((r) => r.texto).join(' '), evidenciaId: null, arquivoId: a.id, pagina: null, nome: a.nome, url: null, trechos };
}

/** O segundo em que o trecho começa na gravação: o da palavra, se a fala bate palavra por palavra ali; senão, o do trecho. */
function inicioNaGravacao(trecho: string, trechos: { inicio: number; fim: number; texto: string; palavras_json: string }[], arquivoId: string, nome: string): number {
  let pos = 0;
  const alvo = juntarEspacos(trecho);
  const onde = trechos.map((r) => r.texto).join(' ').indexOf(alvo);
  for (const r of trechos) {
    if (onde < pos + r.texto.length + 1) {
      const g = acharNaGravacao(alvo, [{ id: arquivoId, nome, trechos: trechos.map((x) => ({ inicio: x.inicio, fim: x.fim, texto: x.texto, palavras: JSON.parse(x.palavras_json) })) }]);
      return g && g.inicio >= r.inicio - 0.5 && g.inicio <= r.fim + 0.5 ? g.inicio : r.inicio;
    }
    pos += r.texto.length + 1;
  }
  return trechos[0]?.inicio ?? 0;
}

interface NovoRecorte {
  origem: OrigemRecorte; evidenciaId: string | null; arquivoId: string | null; pagina: number | null; inicio: number | null;
  trecho: string; nota: string | null; fonteNome: string | null; fonteUrl: string | null;
}

/**
 * Grava o recorte no fim da lista. O mesmo recorte de novo (mesma fonte, mesma página, mesmo trecho) devolve o que existe
 * (o índice único decide, sem corrida); o teto de recortes por texto vale dentro do mesmo INSERT.
 */
async function inserirRecorte(env: Env, tenantId: string, textoId: string, por: string, r: NovoRecorte): Promise<{ id: string; existia: boolean }> {
  const id = novoId();
  const novo = await env.DB.prepare(
    `INSERT INTO recortes (id, tenant_id, texto_id, origem, evidencia_id, arquivo_id, pagina, inicio, trecho, nota, fonte_nome, fonte_url, ordem, por)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT MAX(ordem) FROM recortes WHERE texto_id = ? AND tenant_id = ?), 0) + 1, ?
      WHERE (SELECT COUNT(*) FROM recortes WHERE texto_id = ? AND tenant_id = ?) < ?
     ON CONFLICT DO NOTHING RETURNING id`,
  ).bind(id, tenantId, textoId, r.origem, r.evidenciaId, r.arquivoId, r.pagina, r.inicio, r.trecho, r.nota, r.fonteNome, r.fonteUrl, textoId, tenantId, por,
    textoId, tenantId, RECORTES_POR_TEXTO).first<{ id: string }>();
  if (novo) return { id, existia: false };
  const ja = await env.DB.prepare(
    `SELECT id FROM recortes WHERE texto_id = ? AND tenant_id = ? AND origem = ? AND IFNULL(evidencia_id, '') = ? AND IFNULL(arquivo_id, '') = ? AND IFNULL(pagina, -1) = ? AND trecho = ?`,
  ).bind(textoId, tenantId, r.origem, r.evidenciaId ?? '', r.arquivoId ?? '', r.pagina ?? -1, r.trecho).first<{ id: string }>();
  if (ja) return { id: ja.id, existia: true };
  throw erro('teto', `Este texto já tem ${RECORTES_POR_TEXTO} recortes. Tire os que não vai usar.`, `This text already has ${RECORTES_POR_TEXTO} clippings. Remove the ones you won't use.`, 409);
}

const notaDe = (v: unknown) => {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw erro('nota', 'nota: texto', 'nota: string');
  const n = juntarEspacos(v);
  if (n.length > NOTA_MAX) throw erro('nota', `A anotação passa de ${NOTA_MAX} caracteres.`, `The note is over ${NOTA_MAX} characters.`);
  return n || null;
};

/**
 * Guarda um recorte. De uma fonte (evidência, página de PDF, transcrição): o trecho tem de estar, letra por letra, no texto
 * guardado dela (só o espaço em branco pode diferir), senão 422. Anotação (`origem: nota`): o texto é da pessoa, sem checagem.
 */
export async function criarRecorte(env: Env, tenantId: string, textoId: string, por: string, b: Record<string, unknown>): Promise<{ id: string; existia: boolean }> {
  await lerTexto(env, tenantId, textoId);
  if (!(ORIGENS_RECORTE as readonly unknown[]).includes(b.origem)) throw erro('origem', `origem: um de ${ORIGENS_RECORTE.join(', ')}`, `origem: one of ${ORIGENS_RECORTE.join(', ')}`);
  const origem = b.origem as OrigemRecorte;
  const trecho = typeof b.trecho === 'string' ? juntarEspacos(b.trecho) : '';
  // Na anotação própria, o texto é o trecho; a nota sobre o recorte só existe no recorte de uma fonte.
  if (origem === 'nota') {
    if (!trecho || trecho.length > TRECHO_MAX) throw erro('trecho', `Escreva a anotação (até ${TRECHO_MAX} caracteres).`, `Write the note (up to ${TRECHO_MAX} characters).`);
    return inserirRecorte(env, tenantId, textoId, por, { origem, evidenciaId: null, arquivoId: null, pagina: null, inicio: null, trecho, nota: null, fonteNome: null, fonteUrl: null });
  }
  const nota = notaDe(b.nota);
  const min = origem === 'documento' ? TRECHO_MIN_DOCUMENTO : TRECHO_MIN;
  if (trecho.length < min || trecho.length > TRECHO_MAX) {
    throw erro('trecho', `Selecione um trecho de ${min} a ${TRECHO_MAX} caracteres na fonte.`, `Select a passage of ${min} to ${TRECHO_MAX} characters in the source.`);
  }
  const f = await textoDaFonteDoRecorte(env, tenantId, textoId, origem, b);
  if (!trechoNaFonte(f.texto, trecho)) {
    throw erro('trecho_fora', 'Esse trecho não está, letra por letra, no texto guardado da fonte. Selecione de novo no leitor.', "That passage is not, word for word, in the source's saved text. Select it again in the reader.", 422);
  }
  const inicio = f.trechos ? inicioNaGravacao(trecho, f.trechos, f.arquivoId!, f.nome) : null;
  return inserirRecorte(env, tenantId, textoId, por, { origem, evidenciaId: f.evidenciaId, arquivoId: f.arquivoId, pagina: f.pagina, inicio, trecho, nota, fonteNome: f.nome.slice(0, 300), fonteUrl: f.url });
}

/**
 * Anotação (`nota`), acervo (`acervo`), mover (`mover`: cima | baixo, ou `posicao`, a partir de 0). O trecho de uma fonte
 * não muda (é literal); o texto de uma anotação própria muda (`trecho`). false: o recorte não é deste texto.
 */
export async function alterarRecorte(env: Env, tenantId: string, textoId: string, recorteId: string, b: Record<string, unknown>): Promise<boolean> {
  await lerTexto(env, tenantId, textoId);
  const r = (await recortesDoTexto(env, tenantId, textoId)).find((x) => x.id === recorteId);
  if (!r) return false;
  const sets: string[] = [];
  const binds: unknown[] = [];
  if ('nota' in b) { sets.push('nota = ?'); binds.push(notaDe(b.nota)); }
  if ('trecho' in b) {
    if (r.origem !== 'nota') throw erro('trecho_literal', 'O trecho de uma fonte não muda. Guarde outro recorte.', "A source passage can't change. Save another clipping.", 422);
    const trecho = typeof b.trecho === 'string' ? juntarEspacos(b.trecho) : '';
    if (!trecho || trecho.length > TRECHO_MAX) throw erro('trecho', `Escreva a anotação (até ${TRECHO_MAX} caracteres).`, `Write the note (up to ${TRECHO_MAX} characters).`);
    sets.push('trecho = ?'); binds.push(trecho);
  }
  if ('acervo' in b) {
    if (typeof b.acervo !== 'boolean') throw erro('acervo', 'acervo: verdadeiro ou falso', 'acervo: true or false');
    if (b.acervo && !r.compartilhavel) {
      throw erro('nao_compartilhavel', 'Este recorte vem de uma resposta que fica neste texto. Para usar em outro, guarde como anotação.', 'This clipping comes from a reply that stays in this text. To use it elsewhere, save it as a note.', 422);
    }
    sets.push('acervo = ?'); binds.push(b.acervo ? 1 : 0);
  }
  const mover = b.mover === 'cima' || b.mover === 'baixo' ? b.mover : null;
  const posicao = Number.isInteger(b.posicao) && (b.posicao as number) >= 0 ? (b.posicao as number) : null;
  if ((b.mover !== undefined && !mover) || (b.posicao !== undefined && posicao === null)) throw erro('mover', 'mover: cima ou baixo; posicao: inteiro a partir de 0', 'mover: cima or baixo; posicao: integer from 0');
  if (!sets.length && !mover && posicao === null) throw erro('nada', 'Diga o que mudar: nota, acervo, mover ou posicao.', 'Say what to change: nota, acervo, mover or posicao.');
  const stmts: D1PreparedStatement[] = [];
  if (sets.length) stmts.push(env.DB.prepare(`UPDATE recortes SET ${sets.join(', ')} WHERE id = ? AND texto_id = ? AND tenant_id = ?`).bind(...binds, recorteId, textoId, tenantId));
  if (mover || posicao !== null) {
    // A ordem nova da lista inteira (até 200), numerada de 1 em diante: subir o primeiro ou descer o último não muda nada.
    const ids = (await recortesDoTexto(env, tenantId, textoId)).map((x) => x.id);
    const de = ids.indexOf(recorteId);
    const para = Math.max(0, Math.min(ids.length - 1, mover === 'cima' ? de - 1 : mover === 'baixo' ? de + 1 : posicao!));
    ids.splice(de, 1);
    ids.splice(para, 0, recorteId);
    stmts.push(...ids.map((id, i) => env.DB.prepare('UPDATE recortes SET ordem = ? WHERE id = ? AND texto_id = ? AND tenant_id = ?').bind(i + 1, id, textoId, tenantId)));
  }
  try {
    await env.DB.batch(stmts);
  } catch (e) {
    if (String(e).includes('UNIQUE')) throw erro('existe', 'Já há uma anotação igual neste texto.', 'There is already an identical note in this text.', 409);
    throw e;
  }
  return true;
}

export async function tirarRecorte(env: Env, tenantId: string, textoId: string, recorteId: string): Promise<boolean> {
  await lerTexto(env, tenantId, textoId);
  const r = await env.DB.prepare('DELETE FROM recortes WHERE id = ? AND texto_id = ? AND tenant_id = ? RETURNING id').bind(recorteId, textoId, tenantId).first();
  return !!r;
}

// ── leitor ao lado ─────────────────────────────────────────────────────────────────────────────────────────────────

/** O texto guardado da evidência em parágrafos (`paragrafosDaFonte`): é dele que o recorte sai e contra ele que é conferido. */
export async function textoDaEvidencia(env: Env, tenantId: string, textoId: string, evidenciaId: string) {
  await lerTexto(env, tenantId, textoId);
  const e = await env.DB.prepare('SELECT id, url, titulo, origem, r2_texto, conferida_em, mudou_em FROM evidencias WHERE id = ? AND texto_id = ? AND tenant_id = ?')
    .bind(evidenciaId, textoId, tenantId).first<{ id: string; url: string; titulo: string | null; origem: string; r2_texto: string; conferida_em: string; mudou_em: string | null }>();
  if (!e) throw naoEncontrado();
  const texto = await env.MEDIA.get(e.r2_texto).then((x) => x?.text());
  if (texto === undefined) throw erro('texto_sumiu', 'O texto guardado desta fonte sumiu do armazenamento.', "This source's saved text is missing from storage.", 404);
  return {
    id: e.id, titulo: e.titulo, origem: e.origem as 'link' | 'resposta' | 'documento' | 'lai',
    // Só o link tem página original para abrir (a resposta e o trecho de PDF têm endereço interno).
    url: e.origem === 'link' ? e.url : null,
    conferidaEm: e.conferida_em, mudouEm: e.mudou_em, paragrafos: paragrafosDaFonte(texto),
  };
}

export const PAGINAS_POR_PEDIDO = 10;
const CARACTERES_POR_PEDIDO = 200_000;

/**
 * O texto das páginas do PDF, de `de` até `ate` (no máximo 10 páginas e 200 mil caracteres por pedido; a primeira página
 * da janela vem sempre). `proxima`: a página em que a próxima janela começa, ou null no fim.
 */
export async function paginasDoDocumento(env: Env, tenantId: string, textoId: string, arquivoId: string, deBruto: unknown, ateBruto: unknown) {
  await lerTexto(env, tenantId, textoId);
  const a = await env.DB.prepare("SELECT id, nome, estado, paginas FROM arquivos WHERE id = ? AND texto_id = ? AND tenant_id = ? AND tipo = 'pdf'")
    .bind(arquivoId, textoId, tenantId).first<{ id: string; nome: string; estado: string; paginas: number | null }>();
  if (!a) throw naoEncontrado();
  if (a.estado !== 'pronto') throw erro('nao_pronto', 'O documento ainda não foi lido (ou a leitura falhou).', "The document hasn't been read yet (or reading failed).", 409);
  const de = deBruto === undefined || deBruto === '' ? 1 : Number(deBruto);
  const ateQuer = ateBruto === undefined || ateBruto === '' ? de + PAGINAS_POR_PEDIDO - 1 : Number(ateBruto);
  if (!Number.isInteger(de) || de < 1 || !Number.isInteger(ateQuer) || ateQuer < de) throw erro('paginas', 'de e ate: páginas a partir de 1, com ate depois de de', 'de and ate: pages from 1, with ate after de');
  const ate = Math.min(ateQuer, de + PAGINAS_POR_PEDIDO - 1);
  const { results } = await env.DB.prepare('SELECT pagina, texto FROM arquivo_paginas WHERE arquivo_id = ? AND tenant_id = ? AND pagina BETWEEN ? AND ? ORDER BY pagina')
    .bind(a.id, tenantId, de, ate).all<{ pagina: number; texto: string }>();
  const paginas: { pagina: number; paragrafos: string[] }[] = [];
  let usados = 0;
  for (const p of results) {
    if (paginas.length && usados + p.texto.length > CARACTERES_POR_PEDIDO) break;
    usados += p.texto.length;
    paginas.push({ pagina: p.pagina, paragrafos: paragrafosDaFonte(p.texto) });
  }
  const ultima = paginas.at(-1)?.pagina ?? ate;
  const total = a.paginas ?? 0;
  return { arquivoId: a.id, nome: a.nome, total, paginas, proxima: ultima < total ? ultima + 1 : null };
}

// ── busca única ────────────────────────────────────────────────────────────────────────────────────────────────────

const ACHADOS_POR_FONTE = 5;
const ACHADOS_TOTAL = 60;
/** Por pedido (a tela pede com espera na digitação): até 40 evidências e 3 MB do R2; o resto fica de fora e a resposta diz. */
const EVIDENCIAS_NA_BUSCA = 40;
const BYTES_DO_R2_NA_BUSCA = 3_000_000;
const PAGINAS_NA_BUSCA = 40;
const TRECHOS_NA_BUSCA = 5_000;

export type TipoAchado = 'recortes' | 'evidencia' | 'documento' | 'gravacao';
export interface GrupoBusca {
  tipo: TipoAchado;
  /** Evidência ou arquivo; nos recortes, null (cada achado diz o recorte). */
  id: string | null;
  nome: string | null;
  achados: (Achado & { paragrafo?: number; pagina?: number; inicio?: number; recorteId?: string })[];
  /** Havia mais achados nesta fonte do que o teto por fonte. */
  mais: boolean;
}

/**
 * Busca única, sem acento e sem caixa, em tudo o que o texto tem: recortes, evidências (parágrafo a parágrafo, com o mesmo
 * índice do leitor), páginas de PDF (FTS5, por começo de palavra; o achado sai do parágrafo da página) e transcrições
 * (trecho com o segundo). Todas as palavras têm de estar no mesmo parágrafo, página ou trecho. Tetos por fonte, no total e
 * na leitura do R2: `cortado` diz quando algum valeu.
 */
export async function buscarNoMaterial(env: Env, tenantId: string, textoId: string, q: unknown) {
  await lerTexto(env, tenantId, textoId);
  const consulta = typeof q === 'string' ? juntarEspacos(q).slice(0, BUSCA_MAX) : '';
  const termos = termosDaBusca(consulta);
  if (!termos.length) throw erro('busca', 'Escreva pelo menos duas letras para procurar.', 'Type at least two letters to search.');
  const grupos: GrupoBusca[] = [];
  let total = 0, cortado = false;
  const grupo = (g: Omit<GrupoBusca, 'achados' | 'mais'>) => {
    const novo: GrupoBusca = { ...g, achados: [], mais: false };
    return {
      add:(a: GrupoBusca['achados'][number]) => {
        if (novo.achados.length >= ACHADOS_POR_FONTE) { novo.mais = true; return; }
        if (total >= ACHADOS_TOTAL) { cortado = true; return; }
        novo.achados.push(a); total++;
      },
      fim: () => { if (novo.achados.length) grupos.push(novo); if (novo.mais) cortado = true; },
    };
  };

  // Recortes: o trecho, ou a anotação da pessoa sobre ele.
  const g0 = grupo({ tipo: 'recortes', id: null, nome: null });
  for (const r of await recortesDoTexto(env, tenantId, textoId)) {
    const a = acharNoTexto(r.trecho, termos) ?? (r.nota ? acharNoTexto(r.nota, termos) : null);
    if (a) g0.add({ ...a, recorteId: r.id });
  }
  g0.fim();

  // Evidências: o texto guardado no R2, lido aqui com teto (a busca não pode carregar o dossiê inteiro a cada tecla).
  const { results: evs } = await env.DB.prepare('SELECT id, url, titulo, r2_texto FROM evidencias WHERE texto_id = ? AND tenant_id = ? ORDER BY created_at, rowid LIMIT ?')
    .bind(textoId, tenantId, EVIDENCIAS_NA_BUSCA + 1).all<{ id: string; url: string; titulo: string | null; r2_texto: string }>();
  if (evs.length > EVIDENCIAS_NA_BUSCA) cortado = true;
  let lidos = 0;
  for (const e of evs.slice(0, EVIDENCIAS_NA_BUSCA)) {
    if (lidos >= BYTES_DO_R2_NA_BUSCA) { cortado = true; break; }
    const texto = (await env.MEDIA.get(e.r2_texto).then((x) => x?.text())) ?? '';
    lidos += texto.length;
    const g = grupo({ tipo: 'evidencia', id: e.id, nome: e.titulo ?? e.url });
    paragrafosDaFonte(texto).forEach((p, i) => { const a = acharNoTexto(p, termos); if (a) g.add({ ...a, paragrafo: i }); });
    g.fim();
  }

  const { results: arqs } = await env.DB.prepare("SELECT id, tipo, nome FROM arquivos WHERE texto_id = ? AND tenant_id = ? AND estado = 'pronto' ORDER BY created_at, rowid")
    .bind(textoId, tenantId).all<{ id: string; tipo: string; nome: string }>();
  const nomes = new Map(arqs.map((a) => [a.id, a.nome]));

  // PDFs: as páginas que o índice de palavras acha (todas as palavras, por começo de palavra, sem acento).
  if (arqs.some((a) => a.tipo === 'pdf')) {
    const fts = termos.map((t) => `"${t.replace(/"/g, '')}"*`).join(' ');
    let paginas: { arquivo_id: string; pagina: number; texto: string }[] = [];
    try {
      ({ results: paginas } = await env.DB.prepare(
        `SELECT arquivo_id, pagina, texto FROM arquivo_paginas_fts WHERE arquivo_paginas_fts MATCH ? AND tenant_id = ?
            AND arquivo_id IN (SELECT id FROM arquivos WHERE texto_id = ? AND tenant_id = ? AND tipo = 'pdf' AND estado = 'pronto') ORDER BY rank LIMIT ?`,
      ).bind(fts, tenantId, textoId, tenantId, PAGINAS_NA_BUSCA + 1).all<{ arquivo_id: string; pagina: number; texto: string }>());
    } catch (e) {
      // Consulta que o FTS5 não entende (só pontuação): sem achado nos PDFs, o resto da busca vale.
      console.error('busca no material: fts', String(e).slice(0, 200));
    }
    if (paginas.length > PAGINAS_NA_BUSCA) cortado = true;
    const porArquivo = new Map<string, { pagina: number; texto: string }[]>();
    for (const p of paginas.slice(0, PAGINAS_NA_BUSCA)) porArquivo.set(p.arquivo_id, [...(porArquivo.get(p.arquivo_id) ?? []), p]);
    for (const [arquivoId, ps] of porArquivo) {
      const g = grupo({ tipo: 'documento', id: arquivoId, nome: nomes.get(arquivoId) ?? null });
      for (const p of ps.sort((x, y) => x.pagina - y.pagina)) {
        paragrafosDaFonte(p.texto).forEach((par, i) => { const a = acharNoTexto(par, termos); if (a) g.add({ ...a, pagina: p.pagina, paragrafo: i }); });
      }
      g.fim();
    }
  }

  // Transcrições: cada trecho, com o segundo em que começa.
  if (arqs.some((a) => a.tipo === 'audio')) {
    const { results: trechos } = await env.DB.prepare(
      `SELECT g.arquivo_id, g.inicio, g.texto FROM gravacao_trechos g JOIN arquivos a ON a.id = g.arquivo_id AND a.tenant_id = g.tenant_id
        WHERE g.tenant_id = ? AND a.texto_id = ? AND a.tipo = 'audio' AND a.estado = 'pronto' ORDER BY a.created_at, g.arquivo_id, g.n LIMIT ?`,
    ).bind(tenantId, textoId, TRECHOS_NA_BUSCA + 1).all<{ arquivo_id: string; inicio: number; texto: string }>();
    if (trechos.length > TRECHOS_NA_BUSCA) cortado = true;
    let atual: ReturnType<typeof grupo> | null = null, de = '';
    for (const t of trechos.slice(0, TRECHOS_NA_BUSCA)) {
      if (t.arquivo_id !== de) { atual?.fim(); atual = grupo({ tipo: 'gravacao', id: t.arquivo_id, nome: nomes.get(t.arquivo_id) ?? null }); de = t.arquivo_id; }
      const a = acharNoTexto(juntarEspacos(t.texto), termos);
      if (a) atual!.add({ ...a, inicio: t.inicio });
    }
    atual?.fim();
  }
  return { q: consulta, termos, grupos, cortado };
}

// ── acervo do veículo ──────────────────────────────────────────────────────────────────────────────────────────────

const ACERVO_LINHAS = 2_000;
const ACERVO_MAX = 100;

export interface FonteAcervo {
  tipo: 'link' | 'documento' | 'gravacao'; id: string; nome: string; url: string | null;
  /** De que texto veio (o uso mais recente) e quando entrou nele. */
  texto: { id: string; titulo: string }; em: string;
  /** Em quantos textos do veículo esta fonte está (o mesmo endereço, o mesmo arquivo). */
  textos: number;
  /** Já está no texto `menos` (trazer devolve a que existe). */
  jaNoTexto: boolean;
  paginas: number | null; duracao: number | null;
}

/**
 * O acervo do veículo: as fontes dos outros textos (links pelo endereço, PDFs e gravações pelo sha256, sem repetir: vale o
 * uso mais recente) e os recortes guardados no acervo. Só o que pode ser trazido: link, PDF lido, gravação transcrita
 * inteira (sem segmento por montar). `q` filtra sem acento e sem caixa; `cortado` diz quando o teto valeu.
 */
export async function acervoDoVeiculo(env: Env, tenantId: string, menos: string | null, q: unknown) {
  const termos = typeof q === 'string' ? termosDaBusca(q.slice(0, BUSCA_MAX)) : [];
  const casa = (...campos: (string | null | undefined)[]) => { const t = dobrar(campos.filter(Boolean).join(' ')); return termos.every((x) => t.includes(x)); };
  const [links, arqs, recs, recsNoTexto] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare(`SELECT e.id, e.url, e.titulo, e.texto_id, t.titulo AS texto_titulo, e.created_at FROM evidencias e JOIN textos t ON t.id = e.texto_id AND t.tenant_id = e.tenant_id
                     WHERE e.tenant_id = ? AND e.origem = 'link' ORDER BY e.created_at DESC, e.rowid DESC LIMIT ?`).bind(tenantId, ACERVO_LINHAS),
    env.DB.prepare(`SELECT a.id, a.tipo, a.nome, a.sha256, a.paginas, a.duracao, a.texto_id, t.titulo AS texto_titulo, a.created_at FROM arquivos a JOIN textos t ON t.id = a.texto_id AND t.tenant_id = a.tenant_id
                     WHERE a.tenant_id = ? AND a.estado = 'pronto' AND a.tipo IN ('pdf', 'audio')
                       AND NOT EXISTS (SELECT 1 FROM gravacao_segmentos s WHERE s.arquivo_id = a.id AND s.tenant_id = a.tenant_id AND s.r2 IS NULL)
                     ORDER BY a.created_at DESC, a.rowid DESC LIMIT ?`).bind(tenantId, ACERVO_LINHAS),
    env.DB.prepare(`SELECT r.id, r.origem, r.trecho, r.nota, r.fonte_nome, r.fonte_url, r.pagina, r.inicio, r.texto_id, t.titulo AS texto_titulo, r.created_at
                      FROM recortes r JOIN textos t ON t.id = r.texto_id AND t.tenant_id = r.tenant_id
                     WHERE r.tenant_id = ? AND r.acervo = 1 ORDER BY r.created_at DESC, r.rowid DESC LIMIT ?`).bind(tenantId, ACERVO_LINHAS),
    env.DB.prepare('SELECT origem, trecho FROM recortes WHERE tenant_id = ? AND texto_id = ?').bind(tenantId, menos ?? ''),
  ]);
  let cortado = links.results.length >= ACERVO_LINHAS || arqs.results.length >= ACERVO_LINHAS || recs.results.length >= ACERVO_LINHAS;
  const fontes: FonteAcervo[] = [];
  // Quantos textos usam cada fonte, e se o texto de agora já tem: pela linha de cada texto, antes de juntar.
  const usos = new Map<string, Set<string>>();
  const chave = (r: Record<string, unknown>) => (r.url !== undefined ? `link:${r.url}` : `${r.tipo}:${r.sha256}`);
  for (const r of [...links.results, ...arqs.results]) usos.set(chave(r), (usos.get(chave(r)) ?? new Set()).add(r.texto_id as string));
  const vistas = new Set<string>();
  for (const r of [...links.results, ...arqs.results]) {
    const k = chave(r);
    if (r.texto_id === menos || vistas.has(k)) continue;
    vistas.add(k);
    const link = r.url !== undefined;
    const nome = link ? ((r.titulo as string | null) ?? (r.url as string)) : (r.nome as string);
    if (!casa(nome, link ? (r.url as string) : null, r.texto_titulo as string)) continue;
    fontes.push({
      tipo: link ? 'link' : r.tipo === 'pdf' ? 'documento' : 'gravacao', id: r.id as string, nome, url: link ? (r.url as string) : null,
      texto: { id: r.texto_id as string, titulo: r.texto_titulo as string }, em: r.created_at as string,
      textos: usos.get(k)!.size, jaNoTexto: !!menos && usos.get(k)!.has(menos),
      paginas: link ? null : (r.paginas as number | null), duracao: link ? null : (r.duracao as number | null),
    });
  }
  fontes.sort((a, b) => (a.em < b.em ? 1 : a.em > b.em ? -1 : 0));
  const noTexto = new Set(recsNoTexto.results.map((r) => `${r.origem}|${r.trecho}`));
  const recortes = recs.results.filter((r) => casa(r.trecho as string, r.nota as string | null, r.fonte_nome as string | null, r.texto_titulo as string)).map((r) => ({
    id: r.id as string, origem: r.origem as OrigemRecorte, trecho: r.trecho as string, nota: r.nota as string | null,
    fonte: { nome: r.fonte_nome as string | null, url: r.fonte_url as string | null }, pagina: r.pagina as number | null, inicio: r.inicio as number | null,
    texto: { id: r.texto_id as string, titulo: r.texto_titulo as string }, em: r.created_at as string,
    jaNoTexto: r.texto_id === menos || noTexto.has(`${r.origem}|${r.trecho}`),
  }));
  if (fontes.length > ACERVO_MAX || recortes.length > ACERVO_MAX) cortado = true;
  return { fontes: fontes.slice(0, ACERVO_MAX), recortes: recortes.slice(0, ACERVO_MAX), cortado };
}

export const TIPOS_TRAZER = ['link', 'documento', 'gravacao', 'recorte'] as const;
export type TipoTrazer = (typeof TIPOS_TRAZER)[number];

const fonteSumiu = () => erro('fonte_sumiu', 'A fonte deste item não está mais no acervo.', "This item's source is no longer in the archive.", 409);

/**
 * Link do acervo para este texto, sem ler a página de novo: linha nova em `evidencias` e o texto guardado copiado para uma
 * chave nova no R2. Copiar, não compartilhar: `removerEvidencia` apaga o objeto do R2 da evidência que sai, e a chave
 * compartilhada quebraria o outro texto. A cópia mantém o hash e a data da leitura original (o cron de "fonte mudou" compara
 * com o texto que foi lido, quando foi lido) e o tipo da fonte; a cópia do Wayback vem junto só se já foi salva (senão a
 * rota põe na fila, como no link novo). O mesmo endereço já no texto: devolve o que existe.
 */
async function trazerLink(env: Env, tenantId: string, textoId: string, evidenciaId: string): Promise<{ id: string; existia: boolean; wayback: boolean }> {
  const e = await env.DB.prepare("SELECT * FROM evidencias WHERE id = ? AND tenant_id = ? AND origem = 'link'").bind(evidenciaId, tenantId).first<Record<string, unknown>>();
  if (!e) throw naoEncontrado();
  const porUrl = () => env.DB.prepare('SELECT id FROM evidencias WHERE texto_id = ? AND tenant_id = ? AND url = ?').bind(textoId, tenantId, e.url).first<{ id: string }>();
  const ja = await porUrl();
  if (ja) return { id: ja.id, existia: true, wayback: false };
  const texto = await env.MEDIA.get(e.r2_texto as string).then((x) => x?.text());
  if (texto === undefined) throw fonteSumiu();
  const id = novoId();
  const chave = `evidencias/${tenantId}/${id}.txt`;
  await env.MEDIA.put(chave, texto, { httpMetadata: { contentType: 'text/plain; charset=utf-8' } });
  const salvo = e.wayback_estado === 'salvo';
  const r = await env.DB.prepare(
    `INSERT INTO evidencias (id, tenant_id, texto_id, url, titulo, r2_texto, hash, hash_atual, via_navegador, conferida_em, mudou_em, falhas, tipo_fonte, origem,
                             wayback_estado, wayback_url, wayback_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'link', ?, ?, ?) ON CONFLICT (texto_id, url) DO NOTHING RETURNING id`,
  ).bind(id, tenantId, textoId, e.url, e.titulo, chave, e.hash, e.hash_atual, e.via_navegador, e.conferida_em, e.mudou_em, e.falhas, e.tipo_fonte,
    salvo ? 'salvo' : null, salvo ? e.wayback_url : null, salvo ? e.wayback_em : null).first<{ id: string }>();
  if (!r) {
    await env.MEDIA.delete(chave);
    return { id: (await porUrl())!.id, existia: true, wayback: false };
  }
  return { id, existia: false, wayback: !salvo };
}

/**
 * PDF ou gravação do acervo para este texto, sem processar de novo: linha nova em `arquivos` (pronta) com as páginas e o
 * índice de palavras, ou os trechos e os segmentos da transcrição, copiados no D1. O arquivo no R2 é compartilhado: nenhum
 * caminho apaga arquivo de PDF ou de áudio (não há remoção de arquivo do dossiê; a sessão de gravação só apaga as fatias,
 * que a gravação pronta e montada não tem mais, por isso o acervo só oferece gravação sem segmento por montar). Quem for
 * apagar um dia confere antes se outra linha usa o mesmo `r2` (como `removerEvidencia` faz com `documentos`). A busca
 * por sentido da cópia fica desligada (o índice é por arquivo); a busca por palavra vale. O mesmo arquivo já no texto:
 * devolve o que existe.
 */
async function trazerArquivo(env: Env, tenantId: string, textoId: string, arquivoId: string, tipo: 'pdf' | 'audio', por: string): Promise<{ id: string; existia: boolean }> {
  const a = await env.DB.prepare(
    `SELECT id, sha256 FROM arquivos a WHERE id = ? AND tenant_id = ? AND tipo = ? AND estado = 'pronto'
        AND NOT EXISTS (SELECT 1 FROM gravacao_segmentos s WHERE s.arquivo_id = a.id AND s.tenant_id = a.tenant_id AND s.r2 IS NULL)`,
  ).bind(arquivoId, tenantId, tipo).first<{ id: string; sha256: string }>();
  if (!a) throw naoEncontrado();
  const porSha = () => env.DB.prepare('SELECT id FROM arquivos WHERE texto_id = ? AND tenant_id = ? AND sha256 = ?').bind(textoId, tenantId, a.sha256).first<{ id: string }>();
  const ja = await porSha();
  if (ja) return { id: ja.id, existia: true };
  const id = novoId();
  // As cópias de páginas, trechos e segmentos só valem com a linha nova gravada (o lote é uma transação; se outro pedido
  // trouxe o mesmo arquivo antes, o INSERT não acontece e nada é copiado).
  const minha = 'EXISTS (SELECT 1 FROM arquivos WHERE id = ? AND texto_id = ? AND tenant_id = ?)';
  const deMim = [id, textoId, tenantId];
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO arquivos (id, tenant_id, texto_id, tipo, nome, r2, bytes, sha256, estado, paginas, vetor, entidades_json, totais_json, mime, duracao, por)
       SELECT ?, tenant_id, ?, tipo, nome, r2, bytes, sha256, 'pronto', paginas, CASE WHEN tipo = 'pdf' THEN 'desligado' ELSE vetor END, entidades_json, totais_json, mime, duracao, ?
         FROM arquivos WHERE id = ? AND tenant_id = ? ON CONFLICT DO NOTHING`,
    ).bind(id, textoId, por, a.id, tenantId),
    ...(tipo === 'pdf' ? [
      env.DB.prepare(`INSERT INTO arquivo_paginas (tenant_id, arquivo_id, pagina, texto) SELECT tenant_id, ?, pagina, texto FROM arquivo_paginas WHERE arquivo_id = ? AND tenant_id = ? AND ${minha}`)
        .bind(id, a.id, tenantId, ...deMim),
      env.DB.prepare(`INSERT INTO arquivo_paginas_fts (texto, arquivo_id, tenant_id, pagina) SELECT texto, ?, tenant_id, pagina FROM arquivo_paginas WHERE arquivo_id = ? AND tenant_id = ? AND ${minha}`)
        .bind(id, a.id, tenantId, ...deMim),
    ] : [
      env.DB.prepare(`INSERT INTO gravacao_trechos (tenant_id, arquivo_id, n, inicio, fim, texto, palavras_json) SELECT tenant_id, ?, n, inicio, fim, texto, palavras_json FROM gravacao_trechos WHERE arquivo_id = ? AND tenant_id = ? AND ${minha}`)
        .bind(id, a.id, tenantId, ...deMim),
      env.DB.prepare(`INSERT INTO gravacao_segmentos (tenant_id, arquivo_id, n, r2, inicio, bytes, sha256, estado, erro, faltas_json)
                      SELECT tenant_id, ?, n, r2, inicio, bytes, sha256, estado, erro, faltas_json FROM gravacao_segmentos WHERE arquivo_id = ? AND tenant_id = ? AND ${minha}`)
        .bind(id, a.id, tenantId, ...deMim),
    ]),
  ]);
  const meu = await env.DB.prepare('SELECT 1 AS x FROM arquivos WHERE id = ? AND tenant_id = ?').bind(id, tenantId).first();
  if (!meu) return { id: (await porSha())!.id, existia: true };
  return { id, existia: false };
}

/**
 * Traz para este texto uma fonte do acervo (`tipo`: link, documento, gravacao; `id`: a evidência ou o arquivo no outro texto)
 * ou um recorte do acervo (`tipo: recorte`), com a fonte dele. Idempotente: o que já está no texto volta como está
 * (`existia`). `wayback`: a evidência copiada precisa ir para a fila do Wayback (a rota manda).
 */
export async function trazerDoAcervo(env: Env, tenantId: string, textoId: string, por: string, b: Record<string, unknown>): Promise<{ tipo: TipoTrazer; id: string; existia: boolean; wayback: string | null }> {
  await lerTexto(env, tenantId, textoId);
  if (!(TIPOS_TRAZER as readonly unknown[]).includes(b.tipo)) throw erro('tipo', `tipo: um de ${TIPOS_TRAZER.join(', ')}`, `tipo: one of ${TIPOS_TRAZER.join(', ')}`);
  if (typeof b.id !== 'string') throw erro('id', 'id: texto', 'id: string');
  const tipo = b.tipo as TipoTrazer;
  let r: { id: string; existia: boolean; wayback: string | null };
  if (tipo === 'link') {
    const l = await trazerLink(env, tenantId, textoId, b.id);
    r = { id: l.id, existia: l.existia, wayback: l.wayback ? l.id : null };
  } else if (tipo === 'documento' || tipo === 'gravacao') {
    r = { ...(await trazerArquivo(env, tenantId, textoId, b.id, tipo === 'documento' ? 'pdf' : 'audio', por)), wayback: null };
  } else {
    r = await trazerRecorte(env, tenantId, textoId, por, b.id);
  }
  if (!r.existia) {
    await env.DB.prepare("UPDATE textos SET updated_at = datetime('now') WHERE id = ? AND tenant_id = ?").bind(textoId, tenantId).run();
    // Como `materia.documento` e `apuracao.*`: o que entra no dossiê vindo de outro texto fica no registro, com a origem.
    await registrarEvento(env, tenantId, 'material.trazido', 'texto', textoId, { tipo, de: b.id, para: r.id, por });
  }
  return { tipo, ...r };
}

async function trazerRecorte(env: Env, tenantId: string, textoId: string, por: string, recorteId: string): Promise<{ id: string; existia: boolean; wayback: string | null }> {
  const s = await env.DB.prepare('SELECT * FROM recortes WHERE id = ? AND tenant_id = ? AND acervo = 1').bind(recorteId, tenantId).first<LinhaRecorte>();
  if (!s) throw naoEncontrado();
  if (s.texto_id === textoId) return { id: s.id, existia: true, wayback: null };
  let evidenciaId: string | null = null, arquivoId: string | null = null, wayback: string | null = null;
  if (s.origem === 'evidencia') {
    // A evidência de origem; se saiu do dossiê de lá, o mesmo endereço em outro texto do veículo.
    const ev = await env.DB.prepare('SELECT id, origem FROM evidencias WHERE id = ? AND tenant_id = ?').bind(s.evidencia_id, tenantId).first<{ id: string; origem: string }>()
      ?? (s.fonte_url ? await env.DB.prepare("SELECT id, origem FROM evidencias WHERE tenant_id = ? AND origem = 'link' AND url = ? ORDER BY created_at DESC LIMIT 1")
        .bind(tenantId, s.fonte_url).first<{ id: string; origem: string }>() : null);
    if (!ev) throw fonteSumiu();
    if (ev.origem !== 'link') throw erro('nao_compartilhavel', 'Este recorte vem de uma resposta que fica no texto dela.', 'This clipping comes from a reply that stays in its own text.', 422);
    // O recorte continua literal na fonte para a qual vai apontar: a que este texto já tem com o mesmo endereço (pode ter
    // sido lida em outro dia, com outro texto) ou a cópia da de lá. Confere antes de trazer: recusar não deixa nada pela metade.
    const alvo = await env.DB.prepare(
      `SELECT COALESCE((SELECT d.r2_texto FROM evidencias d WHERE d.texto_id = ? AND d.tenant_id = o.tenant_id AND d.url = o.url), o.r2_texto) AS r2
         FROM evidencias o WHERE o.id = ? AND o.tenant_id = ?`,
    ).bind(textoId, ev.id, tenantId).first<{ r2: string }>();
    const guardado = alvo ? await env.MEDIA.get(alvo.r2).then((x) => x?.text()) : undefined;
    if (guardado === undefined) throw fonteSumiu();
    if (!trechoNaFonte(guardado, s.trecho)) {
      throw erro('trecho_fora', 'Esse trecho não está mais, letra por letra, no texto guardado desta fonte. Traga a fonte e recorte de novo no leitor.',
        "That passage is no longer, word for word, in this source's saved text. Bring the source and clip it again in the reader.", 422);
    }
    const l = await trazerLink(env, tenantId, textoId, ev.id);
    evidenciaId = l.id;
    wayback = l.wayback ? l.id : null;
  } else if (s.origem === 'documento' || s.origem === 'gravacao') {
    try {
      arquivoId = (await trazerArquivo(env, tenantId, textoId, s.arquivo_id ?? '', s.origem === 'documento' ? 'pdf' : 'audio', por)).id;
    } catch (e) {
      if (e instanceof ErroMesa && e.codigo === 'nao_encontrado') throw fonteSumiu();
      throw e;
    }
  }
  const r = await inserirRecorte(env, tenantId, textoId, por, {
    origem: s.origem as OrigemRecorte, evidenciaId, arquivoId, pagina: s.pagina, inicio: s.inicio, trecho: s.trecho, nota: s.nota, fonteNome: s.fonte_nome, fonteUrl: s.fonte_url,
  });
  return { ...r, wayback };
}
