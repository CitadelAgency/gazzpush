import type { Env } from '../env';
import { MAX_CHARS_ARTIGO, buscarArtigo, entradaModelo, urlSegura, type Artigo } from './artigo';
import { buscarComNavegador } from './navegador';
import { novoId, sha256Hex } from './db';
import { scoreManual, triarArtigo } from './triagem';
import { TransicaoInvalida } from '../kernel/estados';
import { idiomaDoVeiculo, textosConteudo } from './idiomaConteudo';

// + Nova: o operador traz a notícia (link, relato ou print) e ela vira pauta `manual` no topo das Ideias, pelo mesmo
// caminho do monitor (artigo → spans → triagem → fatos), sem o filtro de área. Idempotente pelo hash do conteúdo.

export type PedidoNova =
  | { tipo: 'link'; url: string }
  // Com `titulo`: texto importado inteiro (Google Docs, mesa revisora), título e parágrafos literais, até o limite de
  // artigo; `origem` guarda de onde veio e a revisão lida (Docs). Sem título: o relato curto do operador.
  | { tipo: 'relato'; texto: string; titulo?: string; origem?: { url: string; revisao: string | null } }
  | { tipo: 'print'; bytes: Uint8Array; mime: string }
  // Anúncio: o briefing do comércio vira pauta de publicidade, com os limites do relato.
  | { tipo: 'anuncio'; anunciante: string; briefing: string };

/** nova = pauta criada agora; existente = já estava na fila ou em produção; de_volta = já tinha saído e voltou. */
export type Situacao = 'nova' | 'existente' | 'de_volta';

export class ErroNova extends Error {
  /** `en`: a mesma mensagem em inglês (a API escolhe pelo idioma do pedido; `message` é o português). */
  constructor(readonly codigo: string, message: string, readonly status: 400 | 413 | 422 | 502 = 422, readonly en?: string) {
    super(message);
  }
}

export const RELATO_MIN = 30;
export const RELATO_MAX = 4000;
export const PRINT_MAX_BYTES = 4 * 1024 * 1024;
export const PRINT_MIMES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const ATIVAS = ['sugerida', 'aceita', 'em_producao'];
const VISAO_MODELO = '@cf/meta/llama-3.2-11b-vision-instruct';
export const ANUNCIANTE_MAX = 80;

/**
 * Relato do operador → artigo. A primeira frase vira o título (literal; cortada na palavra se passar de 140), o resto é
 * o corpo. O texto é dele: nada é reescrito, só os espaços normalizados.
 */
export async function artigoDeRelato(bruto: string, url: string, agora: Date, metodo = 'relato'): Promise<Artigo> {
  const texto = bruto.replace(/\s+/g, ' ').trim();
  const [primeira] = new Intl.Segmenter('pt-BR', { granularity: 'sentence' }).segment(texto);
  const frase = (primeira?.segment ?? texto).trim();
  let titulo: string, corpo: string;
  if (frase.length <= 140) {
    titulo = frase;
    corpo = texto.slice(frase.length).trim();
  } else {
    const corte = texto.lastIndexOf(' ', 120);
    titulo = `${texto.slice(0, corte > 40 ? corte : 120).trim()}…`;
    corpo = texto;
  }
  const entrada = entradaModelo({ titulo, texto: corpo });
  return { titulo, texto: corpo, url, publicadoEm: null, modificadoEm: null, capturadoEm: agora.toISOString(), metodo, sha256: await sha256Hex(entrada) };
}

/**
 * Texto importado inteiro (Google Docs, mesa) → artigo. Título e corpo literais; os parágrafos ficam (um por linha),
 * para a frase sem ponto final de um parágrafo não colar na do seguinte.
 */
export async function artigoDeTexto(tituloBruto: string, textoBruto: string, agora: Date, metodo: string): Promise<Artigo> {
  const titulo = tituloBruto.replace(/\s+/g, ' ').trim().slice(0, 300) || 'Sem título';
  const texto = textoBruto.replace(/[^\S\n]+/g, ' ').replace(/ *\n\s*/g, '\n').trim();
  if (texto.length < RELATO_MIN) throw new ErroNova('texto_curto', `o texto está vazio ou curto demais (mínimo de ${RELATO_MIN} caracteres)`, 400, `the text is empty or too short (minimum ${RELATO_MIN} characters)`);
  if (titulo.length + texto.length + 2 > MAX_CHARS_ARTIGO) throw new ErroNova('texto_longo', `texto longo demais (até ${MAX_CHARS_ARTIGO / 1000} mil caracteres)`, 400, `text too long (up to ${MAX_CHARS_ARTIGO / 1000} thousand characters)`);
  return { titulo, texto, url: '', publicadoEm: null, modificadoEm: null, capturadoEm: agora.toISOString(), metodo, sha256: await sha256Hex(entradaModelo({ titulo, texto })) };
}

/**
 * Print de notícia → texto, por um modelo de visão. Transcrição literal pedida; o que ele ler vira o "documento" e os
 * fatos saem dele com span, como de qualquer artigo. A revisão humana confere depois (a fonte diz "print").
 */
export async function lerPrint(env: Env, bytes: Uint8Array): Promise<{ titulo: string; texto: string } | null> {
  let out: { response?: unknown };
  try {
    out = await env.AI.run(VISAO_MODELO, {
      prompt: 'A imagem deve ser a captura de tela de uma notícia em português. Transcreva o texto da notícia exatamente como ' +
        'aparece, na ordem: o título e depois o corpo. Não resuma, não traduza, não corrija e não acrescente nada. Ignore menus, ' +
        'anúncios, botões, autor, comentários e legendas de foto. Responda SOMENTE com JSON, sem comentário: ' +
        '{"noticia":true,"titulo":"...","texto":"..."}, com um parágrafo por linha no texto. Se não for notícia ou o texto não estiver legível: {"noticia":false,"titulo":"","texto":""}.',
      image: [...bytes],
      max_tokens: 2048,
      temperature: 0,
    }) as { response?: unknown };
  } catch (e) {
    throw new ErroNova('modelo_falhou', `leitura do print falhou: ${String(e).slice(0, 200)}`, 502, `reading the screenshot failed: ${String(e).slice(0, 200)}`);
  }
  const r = lerJsonDoModelo(out.response);
  if (!r || r.noticia === false) return null;
  const titulo = typeof r.titulo === 'string' ? r.titulo.replace(/\s+/g, ' ').trim() : '';
  // Parágrafos ficam: a linha fina sem ponto final não cola na frase seguinte (cada parágrafo é um trecho).
  const texto = typeof r.texto === 'string' ? r.texto.replace(/[^\S\n]+/g, ' ').replace(/ *\n\s*/g, '\n').trim() : '';
  if (!titulo || titulo.length + texto.length < 80) return null;
  return { titulo, texto };
}

/** O binding devolve `response` como string (às vezes com texto em volta) ou já como objeto. */
export function lerJsonDoModelo(resp: unknown): Record<string, unknown> | null {
  if (resp && typeof resp === 'object') return resp as Record<string, unknown>;
  if (typeof resp !== 'string') return null;
  const ini = resp.indexOf('{'), fim = resp.lastIndexOf('}');
  if (ini < 0 || fim <= ini) return null;
  try {
    const v = JSON.parse(resp.slice(ini, fim + 1));
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

/** Fonte do relato e do print: uma por veículo, `manual` (fora do monitor e da saúde das fontes), nome = rótulo na peça. */
async function fonteManual(env: Env, tenantId: string, tipo: 'relato' | 'print' | 'anuncio'): Promise<string> {
  const t = await env.DB.prepare('SELECT nome, marca_json, idioma FROM tenants WHERE id = ?').bind(tenantId).first<{ nome: string; marca_json: string; idioma: string | null }>();
  const marca = JSON.parse(t?.marca_json || '{}') as { handle?: string; nome?: string };
  const quem = marca.handle || marca.nome || t?.nome || 'redação';
  // O nome sai no rodapé do card ("Fonte: …"): no idioma do veículo.
  const tx = textosConteudo(idiomaDoVeiculo(t?.idioma));
  const nome = tipo === 'relato' ? tx.relatoDe(quem) : tipo === 'anuncio' ? tx.briefingAnunciante : tx.printDeNoticia;
  const id = `${tenantId}:${tipo}`;
  // O @ pode mudar: o rótulo acompanha.
  await env.DB.prepare(
    `INSERT INTO fontes (id, tenant_id, tipo, nome, url) VALUES (?, ?, 'manual', ?, NULL)
     ON CONFLICT (id) DO UPDATE SET nome = excluded.nome`,
  ).bind(id, tenantId, nome).run();
  return id;
}

interface Achado { doc: string; docStatus: string; hash: string; pauta: string | null; pautaStatus: string | null }

/** Documentos com estes hashes e a pauta mais recente de cada um. */
async function procurar(env: Env, tenantId: string, hashes: string[]): Promise<Achado[]> {
  const { results } = await env.DB.prepare(
    `SELECT d.id AS doc, d.status AS docStatus, d.hash_texto AS hash, p.id AS pauta, p.status AS pautaStatus
       FROM documentos d
       LEFT JOIN pautas p ON p.id = (SELECT p2.id FROM pautas p2 WHERE p2.tenant_id = d.tenant_id
                                       AND EXISTS (SELECT 1 FROM json_each(p2.documento_ids_json) j WHERE j.value = d.id)
                                     ORDER BY p2.created_at DESC, p2.rowid DESC LIMIT 1)
      WHERE d.tenant_id = ? AND d.hash_texto IN (${hashes.map(() => '?').join(', ')})`,
  ).bind(tenantId, ...hashes).all<Achado>();
  return results;
}

/**
 * A ideia já tinha saído da fila (descartada ou concluída): uma cópia volta como sugerida, com os mesmos fatos. Atômico:
 * se outra ideia ativa já usa o mesmo documento (outro pedido igual chegou antes), nada é criado e volta null.
 */
async function trazerDeVolta(env: Env, tenantId: string, pautaId: string, por: string): Promise<string | null> {
  const id = novoId();
  const [r] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO pautas (id, tenant_id, status, origem, titulo, resumo, editoria, municipio_ibge, bairro, fato_ids_json, documento_ids_json, score, tipo_post)
       SELECT ?, v.tenant_id, 'sugerida', 'manual', v.titulo, v.resumo, v.editoria, v.municipio_ibge, v.bairro, v.fato_ids_json, v.documento_ids_json, ?, CASE WHEN v.tipo_post = 'publicidade' THEN 'publicidade' END
         FROM pautas v WHERE v.id = ? AND v.tenant_id = ?
          AND NOT EXISTS (SELECT 1 FROM pautas a, json_each(a.documento_ids_json) ja, json_each(v.documento_ids_json) jv
                           WHERE a.tenant_id = v.tenant_id AND a.status IN ('sugerida', 'aceita', 'em_producao') AND ja.value = jv.value)`,
    ).bind(id, scoreManual(new Date()), pautaId, tenantId),
    env.DB.prepare(
      `INSERT INTO eventos (tenant_id, tipo, ref_tipo, ref_id, payload_json)
       SELECT ?, 'pauta.de_volta', 'pauta', ?, ? WHERE EXISTS (SELECT 1 FROM pautas WHERE id = ?)`,
    ).bind(tenantId, id, JSON.stringify({ de: pautaId, por }), id),
    // O anúncio acompanha a cópia: sem ele, a ideia voltaria sem o rótulo de publicidade.
    env.DB.prepare(
      `INSERT INTO anuncios (id, tenant_id, pauta_id, anunciante, por)
       SELECT ?, a.tenant_id, ?, a.anunciante, ? FROM anuncios a WHERE a.pauta_id = ? AND a.tenant_id = ? AND EXISTS (SELECT 1 FROM pautas WHERE id = ?)`,
    ).bind(novoId(), id, por, pautaId, tenantId, id),
  ]);
  return r.meta.changes ? id : null;
}

/** Texto que o documento já tem no R2 (gravado antes do documento existir) → artigo. */
async function artigoSalvo(env: Env, tenantId: string, docId: string, metodo: string, agora: Date): Promise<Artigo | null> {
  const o = await env.MEDIA.get(`texto/${tenantId}/${docId}.txt`);
  if (!o) return null;
  const entrada = await o.text();
  const i = entrada.indexOf('\n\n');
  const titulo = i < 0 ? entrada : entrada.slice(0, i);
  const texto = i < 0 ? '' : entrada.slice(i + 2);
  return { titulo, texto, url: '', publicadoEm: null, modificadoEm: null, capturadoEm: agora.toISOString(), metodo, sha256: await sha256Hex(entrada) };
}

/** `peca`: a ideia já em produção tem post (produzindo, para aprovar, aprovado...); a tela diz onde ele está. */
type Resultado = { pautaId: string; situacao: Situacao; status: string; peca?: { id: string; status: string } | null };

/**
 * Pedido do + Nova → pauta. Mesmo conteúdo, mesma ideia: se ela está na fila ou em produção, devolve essa; se já saiu,
 * volta uma cópia. O link também casa com o que o monitor já trouxe (mesmo texto extraído).
 */
export async function novaPauta(env: Env, tenantId: string, por: string, pedido: PedidoNova): Promise<Resultado> {
  const agora = new Date();
  const id = novoId();
  let artigo: Artigo | null = null;
  let hash: string;
  let outros: string[] = [];   // hashes que também contam como "já existe" (link: o documento do monitor)
  let bruto: { chave: string; corpo: Uint8Array | string; tipo: string } | null = null;

  if (pedido.tipo === 'link') {
    const url = pedido.url.trim();
    if (url.length > 2000 || !urlSegura(url)) throw new ErroNova('url_invalida', 'link inválido: use o endereço completo da notícia (https://…)', 400, 'invalid link: use the full address of the news story (https://…)');
    let html = '';
    try {
      artigo = await buscarArtigo(url, agora, async (h) => { html = h; }, (u) => buscarComNavegador(env, u));
    } catch (e) {
      const motivo = String((e as Error).message ?? e).slice(0, 80);
      throw new ErroNova('link_ilegivel', `não deu para ler a notícia desse link (${motivo})`, 422, `couldn't read the news story from that link (${motivo})`);
    }
    hash = `link:${artigo.sha256}`;
    outros = [artigo.sha256];
    bruto = { chave: `bruto/${tenantId}/${id}.html`, corpo: html, tipo: 'text/html; charset=utf-8' };
  } else if (pedido.tipo === 'relato' && pedido.titulo !== undefined) {
    artigo = await artigoDeTexto(pedido.titulo, pedido.texto, agora, pedido.origem ? 'google_docs' : 'texto');
    hash = `relato:${artigo.sha256}`;
  } else if (pedido.tipo === 'relato') {
    const limpo = pedido.texto.replace(/\s+/g, ' ').trim();
    if (limpo.length < RELATO_MIN) throw new ErroNova('relato_curto', `escreva pelo menos ${RELATO_MIN} caracteres: o que aconteceu, onde e quando`, 400, `write at least ${RELATO_MIN} characters: what happened, where and when`);
    if (limpo.length > RELATO_MAX) throw new ErroNova('relato_longo', `até ${RELATO_MAX} caracteres`, 400, `up to ${RELATO_MAX} characters`);
    artigo = await artigoDeRelato(limpo, '', agora);
    hash = `relato:${artigo.sha256}`;
  } else if (pedido.tipo === 'anuncio') {
    const anunciante = pedido.anunciante.replace(/\s+/g, ' ').trim();
    const limpo = pedido.briefing.replace(/\s+/g, ' ').trim();
    if (!anunciante || anunciante.length > ANUNCIANTE_MAX) throw new ErroNova('anunciante_invalido', `diga o nome do anunciante, até ${ANUNCIANTE_MAX} caracteres`, 400, `give the advertiser's name, up to ${ANUNCIANTE_MAX} characters`);
    if (limpo.length < RELATO_MIN) throw new ErroNova('relato_curto', `escreva pelo menos ${RELATO_MIN} caracteres: o que o anunciante oferece, preço e validade`, 400, `write at least ${RELATO_MIN} characters: what the advertiser offers, price and dates`);
    if (limpo.length > RELATO_MAX) throw new ErroNova('relato_longo', `até ${RELATO_MAX} caracteres`, 400, `up to ${RELATO_MAX} characters`);
    artigo = await artigoDeRelato(limpo, '', agora, 'anuncio');
    hash = `anuncio:${await sha256Hex(`${anunciante}\n${artigo.sha256}`)}`;
  } else {
    const ext = PRINT_MIMES[pedido.mime];
    if (!ext) throw new ErroNova('imagem_invalida', 'mande o print como PNG, JPEG ou WebP', 400, 'send the screenshot as PNG, JPEG or WebP');
    if (!pedido.bytes.byteLength) throw new ErroNova('imagem_invalida', 'imagem vazia', 400, 'empty image');
    // O hash é da imagem: o mesmo print não paga a leitura duas vezes.
    hash = `print:${[...new Uint8Array(await crypto.subtle.digest('SHA-256', pedido.bytes as Uint8Array<ArrayBuffer>))].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
    bruto = { chave: `bruto/${tenantId}/${id}.${ext}`, corpo: pedido.bytes, tipo: pedido.mime };
  }

  const todos = [hash, ...outros];
  // Ideia ativa com o mesmo conteúdo. Pedida de novo, sobe para o topo (a lista mostra as 100 primeiras); em produção,
  // vai junto o post dela.
  const ativa = async (): Promise<Resultado | null> => {
    const a = (await procurar(env, tenantId, todos)).find((x) => x.pauta && ATIVAS.includes(x.pautaStatus!));
    if (!a) return null;
    if (a.pautaStatus === 'em_producao') {
      const peca = await env.DB.prepare('SELECT id, status FROM pecas WHERE pauta_id = ? AND tenant_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1')
        .bind(a.pauta, tenantId).first<{ id: string; status: string }>();
      return { pautaId: a.pauta!, situacao: 'existente', status: a.pautaStatus, peca };
    }
    await env.DB.prepare('UPDATE pautas SET score = MAX(COALESCE(score, 0), ?) WHERE id = ? AND tenant_id = ?').bind(scoreManual(new Date()), a.pauta, tenantId).run();
    return { pautaId: a.pauta!, situacao: 'existente', status: a.pautaStatus! };
  };

  // Já existe? Ativa → a mesma. Saiu da fila → volta. Documento do pedido ainda em 'novo' (pedido anterior caiu no meio
  // ou outro igual está em curso) → triar esse, com o texto que ele já tem.
  const pronta = await ativa();
  if (pronta) return pronta;
  // A ideia que já saiu pode ter vindo deste pedido ou, no link, do monitor (mesmo texto): volta a cópia dela.
  const achados = await procurar(env, tenantId, todos);
  const saiu = achados.find((a) => a.pauta);
  const meu = achados.find((a) => a.hash === hash);
  if (saiu) {
    const copia = await trazerDeVolta(env, tenantId, saiu.pauta!, por);
    if (copia) return { pautaId: copia, situacao: 'de_volta', status: 'sugerida' };
    const outra = await ativa();
    if (outra) return outra;
    throw new Error(`pedido ${hash}: a ideia não voltou e não há uma ativa`);
  }
  let docId: string = meu?.doc ?? id;
  // O print de um documento que já existe não é lido de novo: vale o texto gravado por quem chegou antes.
  if (pedido.tipo === 'print' && docId !== id) artigo = await artigoSalvo(env, tenantId, docId, 'print_visao', agora);
  if (pedido.tipo === 'print' && !artigo) {
    const lido = await lerPrint(env, pedido.bytes);
    if (!lido) throw new ErroNova('print_sem_noticia', 'não deu para ler uma notícia nesse print', 422, "couldn't read a news story in that screenshot");
    artigo = { titulo: lido.titulo, texto: lido.texto, url: '', publicadoEm: null, modificadoEm: null, capturadoEm: agora.toISOString(), metodo: 'print_visao', sha256: await sha256Hex(entradaModelo(lido)) };
  }
  const fonteId = pedido.tipo === 'link' ? null : await fonteManual(env, tenantId, pedido.tipo);
  const comUrl = (a: Artigo): Artigo => (pedido.tipo === 'link' ? a : { ...a, url: `${pedido.tipo}:${docId}` });
  let art = comUrl(artigo!);

  if (docId === id) {
    // Texto antes do documento: quem perder a corrida (ou retomar um pedido que caiu) lê exatamente este.
    await env.MEDIA.put(`texto/${tenantId}/${id}.txt`, entradaModelo(art), { httpMetadata: { contentType: 'text/plain; charset=utf-8' } });
    if (bruto) await env.MEDIA.put(bruto.chave, bruto.corpo, { httpMetadata: { contentType: bruto.tipo } });
    const origem = pedido.tipo === 'relato' ? pedido.origem ?? null : null;
    const r = await env.DB.prepare(
      'INSERT OR IGNORE INTO documentos (id, tenant_id, fonte_id, url, hash_texto, titulo, publicado_em, r2_bruto, origem_url, origem_revisao) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(id, tenantId, fonteId, art.url, hash, art.titulo, art.publicadoEm, bruto?.chave ?? null, origem?.url ?? null, origem?.revisao ?? null).run();
    if (!r.meta.changes) {
      // Outro pedido igual gravou o documento entre a busca e aqui: triar o dele, com o texto dele.
      docId = (await procurar(env, tenantId, [hash]))[0]?.doc ?? id;
      const salvo = pedido.tipo === 'print' ? await artigoSalvo(env, tenantId, docId, 'print_visao', agora) : null;
      art = comUrl(salvo ?? art);
    }
  }

  let pautaId: string | null = null;
  try {
    pautaId = await triarArtigo(env, tenantId, docId, art, agora, { por, hash, ...(pedido.tipo === 'anuncio' ? { anuncio: { anunciante: pedido.anunciante.replace(/\s+/g, ' ').trim() } } : {}) });
  } catch (e) {
    // Corrida: o mesmo conteúdo virou ideia por outro caminho (outro pedido igual, ou o monitor no caso do link).
    const outra = await ativa();
    if (outra) return outra;
    if (!(e instanceof TransicaoInvalida)) throw e;
  }
  if (pautaId) return { pautaId, situacao: 'nova', status: 'sugerida' };
  // No-op: o outro pedido triou e criou a pauta.
  const outra = await ativa();
  if (!outra) throw new Error(`pedido ${hash} sem pauta depois da triagem`);
  return outra;
}
