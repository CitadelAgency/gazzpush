import type { Env } from '../env';
import { buscarArtigo, entradaModelo, type Artigo } from './artigo';
import { INSTRUCOES_TRIAGEM, resolverTriagem, schemaTriagem, spansDeEvidencia, type Span, type Triagem } from './spans';
import { novoId } from './db';
import { transitar, type ModoTenant } from '../kernel/estados';
import { buscarComNavegador } from './navegador';
import { dedupeSemantico, similaridade } from './dedupe';
import { ehLimite } from './planos';
import { produzirPauta } from './produzir';

// Modelo aberto no Workers AI com JSON schema. O schema restrito + resolverTriagem são a rede de segurança;
// se o modelo ignorar o schema, a validação estoura e a fila tenta de novo.
const MODELO_TRIAGEM = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const MAX_CHARS_MODELO = 12_000;
/** Teto de peças por dia que saem sozinhas do site do veículo. */
export const MAX_AUTO_DIA = 30;

/**
 * Veículo `autoral`: quantos trechos do corpo viram fato `trecho` (a redação cita o texto do próprio autor). 60 trechos
 * cobrem um post típico do Substack inteiro (1.000 a 2.000 palavras dão de 50 a 100 frases; um span tem até 450
 * caracteres e em média ~200) e custam ~12 mil caracteres (~4 mil tokens) no prompt da redação, folgado no contexto do
 * deepseek-chat. Texto mais longo: 60 trechos espalhados por igual, na ordem, para o carrossel ver o argumento inteiro.
 */
export const MAX_TRECHOS_AUTORAL = 60;

/** Trechos do corpo (sem os do título) que viram fato `trecho`: todos até o limite; acima dele, espalhados por igual. */
export function trechosAutorais(spans: Span[], tituloLen: number, max = MAX_TRECHOS_AUTORAL): Span[] {
  const corpo = spans.filter((s) => s.inicio >= tituloLen + 2);
  if (corpo.length <= max) return corpo;
  return Array.from({ length: max }, (_, i) => corpo[Math.floor((i * corpo.length) / max)]);
}

interface Doc { id: string; url: string; status: string; fonte_id: string | null }
interface Area { municipio_ibge: string; municipio_nome: string | null; bairro: string | null }

/** Pauta pedida pelo operador (+ Nova): sem filtro de área nem de tipo, origem `manual`, no topo das Ideias. */
export interface PedidoManual {
  por: string;          // user.id da sessão
  hash: string;         // hash do documento no espaço do pedido (link:, relato:, print:, anuncio:); idempotência
  /** Anúncio: o corpo inteiro vira fato, para o preço do briefing passar pela conferência; a pauta nasce de publicidade. */
  anuncio?: { anunciante: string };
}
// Pedida por alguém: fica acima de qualquer sugestão do monitor (o score dele vai até ~115). Entre as pedidas, a do
// pedido mais recente na frente (pedir de novo renova): a fração cresce com o tempo.
export const scoreManual = (agora: Date) => 1000 + agora.getTime() / 1e11;

/**
 * Documento novo → artigo (HTML no R2) → spans → modelo com schema restrito → fatos com span + geo → pauta sugerida.
 * Nada sai daqui sem trecho literal de origem.
 */
export async function triarDocumento(env: Env, tenantId: string, documentoId: string) {
  const doc = await env.DB.prepare('SELECT id, url, status, fonte_id FROM documentos WHERE id = ? AND tenant_id = ?').bind(documentoId, tenantId).first<Doc>();
  if (!doc || doc.status !== 'novo') return;
  const fonte = await env.DB.prepare('SELECT f.propria_desde, t.modo FROM fontes f JOIN tenants t ON t.id = f.tenant_id WHERE f.id = ? AND f.tenant_id = ?')
    .bind(doc.fonte_id, tenantId).first<{ propria_desde: string | null; modo: ModoTenant }>();

  // 1. Artigo completo. HTML bruto e texto vão pro R2.
  const agora = new Date();
  let artigo: Artigo;
  try {
    artigo = await buscarArtigo(doc.url, agora, (html) => env.MEDIA.put(`bruto/${tenantId}/${documentoId}.html`, html, { httpMetadata: { contentType: 'text/html; charset=utf-8' } }).then(() => {}),
      (u) => buscarComNavegador(env, u));
  } catch (e) {
    await descartar(env, tenantId, documentoId, `artigo: ${String(e)}`);
    return;
  }
  await env.MEDIA.put(`texto/${tenantId}/${documentoId}.txt`, entradaModelo(artigo), { httpMetadata: { contentType: 'text/plain; charset=utf-8' } });

  // 2. Dedupe exato pelo texto (UNIQUE tenant_id + hash_texto). O link trazido à mão pelo + Nova também conta.
  // O do link só conta triado: um pedido que caiu no meio não pode calar o monitor.
  const dup = await env.DB.prepare(
    "SELECT id FROM documentos WHERE tenant_id = ? AND id != ? AND (hash_texto = ? OR (hash_texto = ? AND status = 'triado'))",
  ).bind(tenantId, documentoId, artigo.sha256, `link:${artigo.sha256}`).first<{ id: string }>();
  if (dup) {
    await transitar(env, {
      tipo: 'documento', id: documentoId, tenantId, para: 'descartado', por: 'sistema', motivo: 'duplicado', dados: { duplicadoDe: dup.id },
      batch: [env.DB.prepare("UPDATE documentos SET triagem = 'duplicado', triagem_json = ?, r2_texto = ? WHERE id = ? AND tenant_id = ?")
        .bind(JSON.stringify({ duplicadoDe: dup.id }), `texto/${tenantId}/${documentoId}.txt`, documentoId, tenantId)],
    });
    return;
  }
  // 2b. Dedupe semântico (mesma notícia em outro site), antes de pagar o modelo. Falha não derruba a triagem. A matéria
  // do próprio site não passa por ele: seria descartada como cópia da fonte que ela mesma originou.
  const site = fonte?.modo !== 'autoral' && daPropriaFonte(fonte?.propria_desde, artigo.publicadoEm);
  const quase = site ? null : await dedupeSemantico(env, tenantId, documentoId, artigo, agora);
  if (quase) {
    const dados = { duplicadoDe: quase.duplicadoDe, similaridade: quase.score, semantico: true };
    await transitar(env, {
      tipo: 'documento', id: documentoId, tenantId, para: 'descartado', por: 'sistema',
      motivo: `duplicado semântico de ${quase.duplicadoDe} (${similaridade(quase.score)})`, dados,
      batch: [env.DB.prepare("UPDATE documentos SET triagem = 'duplicado', triagem_json = ?, r2_texto = ? WHERE id = ? AND tenant_id = ?")
        .bind(JSON.stringify(dados), `texto/${tenantId}/${documentoId}.txt`, documentoId, tenantId)],
    });
    return;
  }
  const pautaId = await triarArtigo(env, tenantId, documentoId, artigo, agora, undefined, site);
  if (pautaId && site) await produzirDoSite(env, tenantId, pautaId);
}

/** A matéria é do site do veículo e saiu depois de ele ser marcado. Data, e não booleano: o feed traz dezenas de itens antigos. Sem data, caminho normal. */
export function daPropriaFonte(propriaDesde: string | null | undefined, publicadoEm: string | null | undefined) {
  if (!propriaDesde || !publicadoEm) return false;
  return Date.parse(publicadoEm) >= Date.parse(propriaDesde);
}

/** Até `MAX_AUTO_DIA` peças por dia em Brasília. Passou disso, a pauta fica em Ideias, sem perda. */
async function produzirDoSite(env: Env, tenantId: string, pautaId: string) {
  const hoje = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM pecas pc JOIN pautas p ON p.id = pc.pauta_id AND p.tenant_id = pc.tenant_id
      WHERE pc.tenant_id = ? AND p.origem = 'site' AND date(pc.created_at, '-3 hours') = date('now', '-3 hours')`,
  ).bind(tenantId).first<{ n: number }>();
  if ((hoje?.n ?? 0) >= MAX_AUTO_DIA) return;
  try {
    await produzirPauta(env, tenantId, pautaId, 'sistema', 'carrossel');
  } catch (e) {
    if (!ehLimite(e)) throw e;   // no limite do plano, a pauta fica em Ideias
  }
}

/**
 * Artigo já extraído (e com o texto no R2) → fatos + pauta, num batch com a transição do documento.
 * Monitor: pauta só para notícia da área/tema. Pedido manual: pauta sempre (quem pediu já decidiu), origem `manual`.
 * Devolve o id da pauta criada (ou null).
 */
export async function triarArtigo(env: Env, tenantId: string, documentoId: string, artigo: Artigo, agora: Date, manual?: PedidoManual, doSite = false): Promise<string | null> {
  const tenant = await env.DB.prepare('SELECT modo, temas_json FROM tenants WHERE id = ?').bind(tenantId).first<{ modo: ModoTenant; temas_json: string }>();
  if (!tenant) throw new Error(`tenant ${tenantId} não encontrado`);
  const { results: areas } = await env.DB.prepare('SELECT municipio_ibge, municipio_nome, bairro FROM tenant_areas WHERE tenant_id = ?').bind(tenantId).all<Area>();
  const temas: string[] = JSON.parse(tenant.temas_json || '[]');

  // 3. Schema restrito ao texto: só cidades/bairros da área que aparecem literalmente, só datas presentes.
  const bairrosKv = await Promise.all([...new Set(areas.map((a) => a.municipio_ibge))].map((ibge) => env.CONFIG.get<string[]>(`bairros:${ibge}`, 'json')));
  const cidades = areas.map((a) => a.municipio_nome).filter((n): n is string => !!n);
  const bairros = [...areas.map((a) => a.bairro).filter((b): b is string => !!b), ...bairrosKv.flatMap((b) => b ?? [])];
  const entrada = entradaModelo(artigo);
  const artigoModelo = entrada.length > MAX_CHARS_MODELO ? { ...artigo, texto: artigo.texto.slice(0, MAX_CHARS_MODELO - artigo.titulo.length - 2) } : artigo;
  const { schema, spans } = schemaTriagem(artigoModelo, { cidades, bairros });

  // 4. Modelo.
  const prompt = spans.map((s) => `[${s.id}] ${s.texto}`).join('\n');
  const resp = await (env.AI.run as (m: string, i: unknown) => Promise<{ response?: unknown }>)(MODELO_TRIAGEM, {
    messages: [{ role: 'system', content: INSTRUCOES_TRIAGEM }, { role: 'user', content: prompt }],
    response_format: { type: 'json_schema', json_schema: schema },
    temperature: 0, max_tokens: 1024,
  });
  const raw = typeof resp.response === 'string' ? JSON.parse(resp.response) : resp.response;
  const triagem = resolverTriagem(raw, artigoModelo, spans);

  // 5. Decisão: é notícia? É da área / do tema? No veículo `autoral` as fontes são do próprio autor: todo texto vira
  // pauta, seja ensaio, análise, opinião ou matéria.
  const autoral = tenant.modo === 'autoral';
  // Matéria do site do veículo: quem publicou já decidiu. Sem filtro de área, opinião também vira pauta.
  const site = doSite;
  const noticia = triagem.tipo === 'acontecimento' || triagem.tipo === 'desdobramento' || triagem.tipo === 'servico';
  const emArea = tenant.modo === 'local'
    ? triagem.locais.some((l) => cidades.includes(l.cidade))
    : temas.length === 0 || (triagem.editoria !== null && temas.includes(triagem.editoria));
  const classe = autoral ? 'autoral' : site ? 'site' : !noticia ? (triagem.tipo === 'contexto' ? 'balanco' : null) : emArea ? 'noticia' : 'fora_area';
  const criaPauta = classe === 'noticia' || autoral || site || !!manual;

  // 6. Fatos: um por evidência. Texto literal do span, posição, geo quando houver.
  const localEvento = triagem.locais.find((l) => l.papel === 'evento') ?? triagem.locais[0] ?? null;
  const ibgePorNome = new Map(areas.filter((a) => a.municipio_nome).map((a) => [a.municipio_nome!, a.municipio_ibge]));
  const fatos: { id: string; tipo: string; span: Span; cidade?: string; bairro?: string | null; data?: string | null }[] = [];
  const vistos = new Set<string>();
  const add = (tipo: string, spanId: number | null, extra: Partial<(typeof fatos)[number]> = {}) => {
    if (spanId === null) return;
    const chave = `${tipo}|${spanId}|${extra.cidade ?? ''}|${extra.bairro ?? ''}`;
    if (vistos.has(chave)) return; // modelo repete o mesmo local no mesmo trecho
    vistos.add(chave);
    fatos.push({ id: novoId(), tipo, span: spans[spanId], ...extra });
  };
  add('manchete', 0);
  add('tipo', triagem.tipoSpan);
  add('editoria', triagem.editoriaSpan);
  add('data', triagem.dataSpan, { data: triagem.ocorreuEm });
  for (const l of triagem.locais) add(`local_${l.papel}`, l.spanId, { cidade: l.cidade, bairro: l.bairro });
  // Autoral e anúncio: o corpo inteiro (não só o que o modelo da triagem viu) em trechos literais, menos os que já são fato.
  if (autoral || site || manual?.anuncio) {
    const usados = new Set(fatos.map((f) => `${f.span.inicio}-${f.span.fim}`));
    for (const s of trechosAutorais(spansDeEvidencia(artigo), artigo.titulo.length)) {
      if (!usados.has(`${s.inicio}-${s.fim}`)) fatos.push({ id: novoId(), tipo: 'trecho', span: s });
    }
  }

  const stmts = fatos.map((f) => {
    const s = f.span;
    return env.DB.prepare(
      `INSERT INTO fatos (id, tenant_id, documento_id, tipo, texto, span_inicio, span_fim, hash, municipio_ibge, bairro, geo_metodo, data_fato, confianca)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(f.id, tenantId, documentoId, f.tipo, s.texto, s.inicio, s.fim, `${artigo.sha256}:${s.inicio}-${s.fim}`,
      f.cidade ? ibgePorNome.get(f.cidade) ?? null : null, f.bairro ?? null, f.cidade ? 'texto' : null, f.data ?? null, 1);
  });

  // 7. Pauta sugerida só pra notícia da área/tema (ou pedida à mão).
  let pautaId: string | null = null;
  if (criaPauta) {
    pautaId = novoId();
    const idade = artigo.publicadoEm ? (agora.getTime() - Date.parse(artigo.publicadoEm)) / 3600_000 : 48;
    const score = Math.max(0, 100 - idade) + (triagem.tipo === 'servico' ? 10 : 0) + (localEvento?.bairro ? 5 : 0);
    const resumo = spans.find((s) => s.inicio > artigo.titulo.length)?.texto ?? null;
    stmts.push(env.DB.prepare(
      `INSERT INTO pautas (id, tenant_id, status, origem, titulo, resumo, editoria, municipio_ibge, bairro, fato_ids_json, documento_ids_json, score, tipo_post)
       VALUES (?, ?, 'sugerida', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(pautaId, tenantId, manual ? 'manual' : site ? 'site' : 'monitor', artigo.titulo, resumo, triagem.editoria, localEvento ? ibgePorNome.get(localEvento.cidade) ?? null : null,
      localEvento?.bairro ?? null, JSON.stringify(fatos.map((f) => f.id)), JSON.stringify([documentoId]), manual ? scoreManual(agora) : score, manual?.anuncio ? 'publicidade' : null));
    if (manual?.anuncio) {
      stmts.push(env.DB.prepare('INSERT INTO anuncios (id, tenant_id, pauta_id, anunciante, por) VALUES (?, ?, ?, ?, ?)').bind(novoId(), tenantId, pautaId, manual.anuncio.anunciante, manual.por));
    }
  }

  stmts.push(env.DB.prepare(
    `UPDATE documentos SET triagem = ?, triagem_json = ?, titulo = ?, url_canonica = ?, publicado_em = ?, hash_texto = ?, r2_texto = ? WHERE id = ? AND tenant_id = ?`,
  ).bind(classe, JSON.stringify({ ...triagem, metodo: artigo.metodo, modelo: MODELO_TRIAGEM, truncado: artigoModelo !== artigo } satisfies Triagem & Record<string, unknown>),
    artigo.titulo, artigo.url, artigo.publicadoEm, manual?.hash ?? artigo.sha256, `texto/${tenantId}/${documentoId}.txt`, documentoId, tenantId));
  // Dedupe atômico entre o monitor e o link trazido à mão: o mesmo texto pode ter chegado pelo outro caminho enquanto o
  // modelo respondia. O monitor desiste se já há o documento do link (a fila tenta de novo e cai no duplicado); o link,
  // se o documento do monitor já virou ideia ativa. A asserção aborta o batch inteiro.
  const guarda = !manual
    ? { sql: "SELECT 1 FROM documentos WHERE tenant_id = ? AND hash_texto = ? AND id != ? AND status = 'triado'", hash: `link:${artigo.sha256}` }
    : manual.hash.startsWith('link:')
      ? { sql: `SELECT 1 FROM documentos d JOIN pautas p ON p.tenant_id = d.tenant_id AND p.status IN ('sugerida', 'aceita', 'em_producao')
                  JOIN json_each(p.documento_ids_json) j ON j.value = d.id
                 WHERE d.tenant_id = ? AND d.hash_texto = ? AND d.id != ?`, hash: artigo.sha256 }
      : null;
  if (guarda) {
    stmts.push(env.DB.prepare(`SELECT json(CASE WHEN EXISTS (${guarda.sql}) THEN 'duplicado_concorrente' ELSE '1' END)`)
      .bind(tenantId, guarda.hash, documentoId));
  }
  // Fatos, pauta, metadado e status num batch só: mensagem reentregue vê o documento fora de 'novo' e sai no início.
  const { mudou } = await transitar(env, {
    tipo: 'documento', id: documentoId, tenantId, para: classe || manual ? 'triado' : 'descartado', por: manual?.por ?? 'sistema',
    dados: { classe, tipo: triagem.tipo, editoria: triagem.editoria, pautaId, rejeitados: triagem.rejeitados, ...(manual ? { manual: true } : {}) }, batch: stmts,
  });
  env.METRICS.writeDataPoint({ blobs: [tenantId, 'documento.triado', classe ?? 'descartado', triagem.editoria ?? ''], doubles: [1], indexes: [tenantId] });
  // No-op (outro request triou antes): a pauta deste batch não foi gravada.
  return mudou ? pautaId : null;
}

async function descartar(env: Env, tenantId: string, documentoId: string, motivo: string) {
  await transitar(env, {
    tipo: 'documento', id: documentoId, tenantId, para: 'descartado', por: 'sistema', motivo,
    batch: [env.DB.prepare('UPDATE documentos SET triagem_json = ? WHERE id = ? AND tenant_id = ?').bind(JSON.stringify({ motivo }), documentoId, tenantId)],
  });
}
