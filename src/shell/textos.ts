import { gerarPdf } from '../lib/pdf';
import { Hono, type Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { validator } from 'hono/validator';
import { novoId, registrarEvento } from '../lib/db';
import { ErroGoogle, atualizarDocumento, googleConfigurado, lerDocumento, textoDoDoc, urlDoDoc, type DocLido } from '../lib/google';
import {
  ErroMesa, acrescentarEvidencia, conferirBlocos, conferirTexto, erroCorpo, estadosDosBlocos, estrutura, exigirCorpo, lerTexto, linhasBlocos, mudancas,
  paragrafosDeTexto, pedidosDevolucao, removerEvidencia, salvarDoc, type DocsSalvo, type OrigemTexto,
} from '../lib/mesa';
import { ErroDoc, docComIdsDe, limparDoc, paragrafosDoDoc } from '../lib/doc';
import { ErroNova } from '../lib/nova';
import { ErroMateria, pautaDaMateria, postsDaMateria } from '../lib/materia';
import { analisar, assinar, auditoria, criarRegra, desfazerApuracao, forcaDaEvidencia, registrarApuracao, regrasDoManual, removerRegra, tipoDaFonte } from '../lib/assistente';
import { requireMembro, type AppEnv } from './tenancy';
import { criarPedido, dadosFolha, emailLigado, htmlFolha, montarPacote, paginaNoAr, pedidosDoTexto, publicarPagina, respostaManual, retirarPagina } from '../lib/escudo';
import { enfileirarWayback } from '../lib/wayback';
import { PDF_MAX_BYTES, arquivosDoTexto, enviarPdf, perguntar, trechoParaEvidencia, vetorLigado } from '../lib/documento';
import { AUDIO_MAX_BYTES, audioParaTocar, enviarAudio, gravacoesDoTexto, transcricao } from '../lib/gravacao';
import { abrirSessao, concluirSessao, receberFatia, sessoesAbertas, tentarSegmento } from '../lib/gravacaoSessao';
import { FATIA_MAX_BYTES } from '../lib/segmentos';
import { ehJpeg, ehPng, lerCorpoAte } from './marca';
import { assinarMedia } from '../lib/crypto';
import { FOTO_MAX_BYTES } from '../lib/cards';
import { lerComoEditor, sugerirDivulgacao } from '../lib/escrita';
import { guardarRetrato, lerRetrato, listarHistorico } from '../lib/historico';
import { exigirPlano } from '../lib/planos';
import { exigirChaveTexto } from '../lib/provedores';
import { alertasDoTexto, postDoAlerta, processosDoTexto, resolverAlerta } from '../lib/viva';
import { andamentoLai, criarPedidoLai, laiDoTexto } from '../lib/lai';
import { acervoDoVeiculo, alterarRecorte, buscarNoMaterial, criarRecorte, paginasDoDocumento, recortesDoTexto, textoDaEvidencia, tirarRecorte, trazerDoAcervo } from '../lib/material';
// `tx` e não `t`: as rotas daqui chamam de `t` o texto lido do banco.
import { idiomaDe, t as tx } from './idioma';

/**
 * Mesa revisora sob /t/:tenantId/textos (montada em api.ts, atrás de requireMembro). Toda query leva `tenant_id`; o
 * autor e quem decide vêm da sessão. Mudar o texto, o dossiê ou mandar para o Instagram é de editor para cima (como
 * produzir); o repórter lê.
 */
const lerJson = async <T>(c: Context<AppEnv>): Promise<Partial<T>> => (await c.req.json().catch(() => ({}))) as Partial<T>;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Consulta tipada para o cliente do Hono (como em api.ts): só as chaves listadas, texto ou ausente. */
const consulta = <K extends string>(...chaves: K[]) => validator('query', (q) => Object.fromEntries(chaves.map((k) => [k, typeof q[k] === 'string' ? q[k] : undefined])) as Record<K, string | undefined>);
/** Corpo lido com teto (lerCorpoAte) como ArrayBuffer; null: passou do teto. */
const comoBuffer = (b: Uint8Array | null): ArrayBuffer | null => (b ? (b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer) : null);

function erro(c: Context<AppEnv>, e: unknown) {
  if (e instanceof ErroMesa || e instanceof ErroGoogle || e instanceof ErroNova) {
    const extra = e instanceof ErroMateria ? { pendencias: e.pendencias } : {};
    return c.json({ erro: tx(c, e.message, e.en ?? e.message), code: e.codigo, ...extra }, e.status as 400);
  }
  throw e;
}

/** O que custa modelo pede plano em dia. Ler e escrever o texto não. */
const comPlano = createMiddleware<AppEnv>(async (c, next) => {
  try {
    await exigirPlano(c.env, c.get('tenant').id);
  } catch (e) {
    return erro(c, e);
  }
  await next();
});

/** Imagem no texto: um ano de link, o bastante para o Substack buscar ao colar e a tela seguir mostrando. */
const IMAGEM_TTL_S = 365 * 24 * 3600;

/** Snapshot do Docs guardado na importação: posição e formatação de cada parágrafo, e o fim do corpo. */
// Parágrafo como a mesa guarda: espaços (e a quebra de linha dentro dele) viram um espaço. O snapshot do Docs usa a
// mesma forma, para a devolução reconhecer como igual o parágrafo que ninguém tocou.
const normal = (p: string) => p.replace(/\s+/g, ' ').trim();
const corpoDoDoc = (d: DocLido) => d.paragrafos.map((p) => normal(p.texto)).filter(Boolean);
const snapshot = (d: DocLido): DocsSalvo => ({
  fimAbas: d.fimAbas,
  paragrafos: d.paragrafos.map(({ texto, inicio, fim, estilo, html, aba }) => ({ texto: normal(texto), inicio, fim, estilo, html, aba })),
});

/**
 * O que a mesa mostra: o texto (documento do editor, os parágrafos com o HTML do Docs para copiar), o estado de cada
 * bloco, as afirmações que valem no texto atual (só de bloco conferido com o hash do texto de agora) com a apuração da
 * pessoa, os apontamentos do código (contas, aspas sem fonte, manual), as pessoas, o dossiê com a força das fontes e o
 * checklist de publicação.
 */
async function estado(c: Context<AppEnv>, id: string) {
  const tenantId = c.get('tenant').id;
  const an = await analisar(c.env, tenantId, id);
  const t = an.t;
  const usadas = new Map<string, number>();
  for (const a of an.afirmacoes) {
    const ev = a.apuracao?.tipo === 'fonte' ? a.apuracao.evidenciaId : a.evidenciaId;
    if (ev) usadas.set(ev, (usadas.get(ev) ?? 0) + 1);
  }
  const paragrafos: string[] = JSON.parse(t.paragrafos_json);
  const docs: DocsSalvo | null = t.docs_json ? JSON.parse(t.docs_json) : null;
  // Parágrafo igual ao do Docs leva a formatação de lá (negrito, itálico, links); o resto, o texto puro.
  const htmlDocs = new Map((docs?.paragrafos ?? []).map((p) => [p.texto, p.html]));
  const estiloDocs = new Map((docs?.paragrafos ?? []).map((p) => [p.texto, p.estilo]));
  return {
    texto: {
      id: t.id, titulo: t.titulo, origem: t.origem as OrigemTexto, versao: t.versao, conferidoVersao: t.conferido_versao, conferidoEm: t.conferido_em,
      conferenciaErro: t.conferencia_erro, docsUrl: t.docs_id ? urlDoDoc(t.docs_id) : null, pautaId: t.pauta_id, criadoEm: t.created_at, atualizadoEm: t.updated_at,
      paragrafos: paragrafos.map((p) => ({ texto: p, html: htmlDocs.get(p) ?? esc(p), estilo: estiloDocs.get(p) ?? null })),
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
      id: e.id, url: e.url, titulo: e.titulo, conferidaEm: e.conferidaEm, mudouEm: e.mudouEm, viaNavegador: e.viaNavegador, usada: usadas.get(e.id) ?? 0,
      origem: e.origem, wayback: e.wayback, ...forcaDaEvidencia(e),
    })),
    circulares: an.circulares,
    fonteUnica: an.fonteUnica,
    checklist: { pendencias: an.pendencias, assinatura: an.assinatura },
    // Escudo jurídico: os pedidos de outro lado, se o e-mail sai pelo app e a página de fontes no ar.
    outroLado: { pedidos: await pedidosDoTexto(c.env, tenantId, id), emailLigado: emailLigado(c.env) },
    paginaFontes: await paginaNoAr(c.env, tenantId, id),
    // Pergunte ao documento: os PDFs, as perguntas e as entidades; e se a busca por sentido está ligada.
    documentos: await arquivosDoTexto(c.env, tenantId, id),
    buscaVetorial: vetorLigado(c.env),
    // Aspas contra a gravação: os áudios (a transcrição vem por rota própria).
    gravacoes: await gravacoesDoTexto(c.env, tenantId, id),
    sessoesAbertas: await sessoesAbertas(c.env, tenantId, id),
    // Matéria viva: os alertas da aba Depois, os processos citados (DataJud) e os pedidos de LAI.
    alertas: await alertasDoTexto(c.env, tenantId, id),
    processos: await processosDoTexto(c.env, tenantId, id, paragrafos),
    lai: await laiDoTexto(c.env, tenantId, id, c.get('user').name ?? '', an.afirmacoes.filter((a) => a.estado === 'sem_fonte' && a.aberta).map((a) => ({
      id: a.id, blocoId: a.blocoId, trecho: a.trecho, inicio: a.inicio, fim: a.fim, textoBloco: an.est.blocos.find((b) => b.id === a.blocoId)?.texto ?? '',
    }))),
    segunda: an.segunda,
    provedorTexto: an.provedorTexto,
    temaSensivel: an.temaSensivel,
    // Devolver ao Docs: só texto vindo de lá e com a configuração do Google.
    podeDevolver: t.origem === 'docs' && googleConfigurado(c.env),
  };
}

export const textos = new Hono<AppEnv>()

// A mesa é do veículo de autor: nos outros modos, as rotas não existem.
.use('*', async (c, next) => {
  const t = await c.env.DB.prepare('SELECT modo FROM tenants WHERE id = ?').bind(c.get('tenant').id).first<{ modo: string }>();
  if (t?.modo !== 'autoral') return c.json({ erro: tx(c, 'não encontrado', 'not found') }, 404);
  await next();
})

// Lista: título, origem, quando mudou, as marcas da última conferência e se alguma fonte do dossiê mudou.
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
      id: t.id, titulo: t.titulo, origem: t.origem as OrigemTexto, atualizadoEm: t.updated_at, conferido: t.conferido_versao === t.versao,
      marcas: { comEvidencia: t.com_evidencia, semFonte: t.sem_fonte, risco: t.risco }, fonteMudou: t.fonte_mudou === 1, alertas: t.alertas,
    })),
  });
})

// Texto novo: a folha em branco (`{branco: true}`), colado (`{titulo, texto}`) ou do Google Docs (`{docs: id}`, com a
// configuração do Google). Não confere sozinho: a pessoa monta o dossiê e pede (ou salva). A folha em branco que a pessoa
// abriu e deixou sem nada é a mesma da próxima vez: Novo texto não enche a lista de linhas vazias.
.post('/', requireMembro('editor'), async (c) => {
  const tenantId = c.get('tenant').id;
  const b = await lerJson<{ titulo: unknown; texto: unknown; docs: unknown; branco: unknown }>(c);
  let id: string = novoId();
  try {
    if (b.branco === true) {
      const autor = c.get('user').id;
      const vazia = await c.env.DB.prepare(`SELECT id FROM textos WHERE tenant_id = ? AND autor = ? AND origem = 'escrito' AND titulo = '' AND paragrafos_json = '[]' LIMIT 1`)
        .bind(tenantId, autor).first<{ id: string }>();
      if (vazia) id = vazia.id;
      else await c.env.DB.prepare(`INSERT INTO textos (id, tenant_id, titulo, paragrafos_json, origem, autor) VALUES (?, ?, '', '[]', 'escrito', ?)`).bind(id, tenantId, autor).run();
    } else if (b.docs !== undefined) {
      if (!googleConfigurado(c.env)) return c.json({ erro: tx(c, 'não encontrado', 'not found') }, 404);
      const d = await lerDocumento(c.env, c.get('user').id, String(b.docs));
      const paragrafos = corpoDoDoc(d);
      const e = erroCorpo(paragrafos, idiomaDe(c));
      if (e) throw new ErroMesa('texto_invalido', e);
      await c.env.DB.prepare(
        `INSERT INTO textos (id, tenant_id, titulo, paragrafos_json, origem, docs_id, docs_revisao, docs_json, autor) VALUES (?, ?, ?, ?, 'docs', ?, ?, ?, ?)`,
      ).bind(id, tenantId, (d.titulo || 'Sem título').slice(0, 300), JSON.stringify(paragrafos), d.id, d.revisao, JSON.stringify(snapshot(d)), c.get('user').id).run();
    } else {
      const paragrafos = typeof b.texto === 'string' ? paragrafosDeTexto(b.texto) : [];
      const e = erroCorpo(paragrafos, idiomaDe(c));
      if (e) return c.json({ erro: e, code: 'texto_invalido' }, 400);
      // Sem título: a primeira linha é o título (e sai do corpo, se o corpo continuar).
      let titulo = typeof b.titulo === 'string' ? b.titulo.replace(/\s+/g, ' ').trim() : '';
      if (!titulo) titulo = paragrafos.length > 1 ? paragrafos.shift()! : paragrafos[0].slice(0, 120);
      await c.env.DB.prepare('INSERT INTO textos (id, tenant_id, titulo, paragrafos_json, origem, autor) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(id, tenantId, titulo.slice(0, 300), JSON.stringify(paragrafos), 'colado', c.get('user').id).run();
    }
  } catch (e) {
    return erro(c, e);
  }
  return c.json(await estado(c, id), 201);
})

// Manual de redação do veículo: regras que só apontam (sigla, grafia, número, cargo, linguagem). Ler: todo membro;
// mudar: editor para cima.
.get('/manual', async (c) => c.json({ regras: await regrasDoManual(c.env, c.get('tenant').id) }))
.post('/manual', requireMembro('editor'), async (c) => {
  try {
    const r = await criarRegra(c.env, c.get('tenant').id, c.get('user').id, await lerJson<Record<string, unknown>>(c));
    return c.json({ ...r, regras: await regrasDoManual(c.env, c.get('tenant').id) }, 201);
  } catch (e) {
    return erro(c, e);
  }
})
.delete('/manual/:regra', requireMembro('editor'), async (c) => {
  if (!(await removerRegra(c.env, c.get('tenant').id, c.req.param('regra')))) return c.json({ erro: tx(c, 'não encontrado', 'not found') }, 404);
  return c.json({ regras: await regrasDoManual(c.env, c.get('tenant').id) });
})

// Painel de auditoria: marcas por mês, tema e pessoa citada, e as ignoradas (`dias`, padrão 180).
.get('/auditoria', async (c) => {
  const dias = Number(c.req.query('dias') ?? 180);
  return c.json(await auditoria(c.env, c.get('tenant').id, Number.isFinite(dias) ? dias : 180));
})

// Material ao lado, acervo do veículo: as fontes dos outros textos (sem repetir) e os recortes guardados no acervo.
// `menos`: o texto aberto (as fontes dele saem da lista; o que ele já tem vem marcado). Antes de /:id.
.get('/acervo', consulta('q', 'menos'), async (c) => {
  const { q, menos } = c.req.valid('query');
  return c.json(await acervoDoVeiculo(c.env, c.get('tenant').id, menos ?? null, q));
})

.get('/:id', async (c) => {
  try {
    return c.json(await estado(c, c.req.param('id')));
  } catch (e) {
    return erro(c, e);
  }
})

// Salvar: o documento do editor (`doc`, salvamento automático da tela) ou a lista de parágrafos (`paragrafos`, o jeito
// de antes), com a versão que a pessoa viu (409 se outra pessoa salvou antes). Os blocos que não mudaram guardam as
// marcas; os mudados ficam pendentes. Com `doc`, a tela confere depois (por bloco, em streaming); com `paragrafos`,
// confere aqui os blocos que mudaram (a conferência nunca altera o corpo).
.put('/:id', requireMembro('editor'), async (c) => {
  const tenantId = c.get('tenant').id;
  const id = c.req.param('id');
  const b = await lerJson<{ titulo: unknown; paragrafos: unknown; doc: unknown; versao: unknown; restaurando: unknown }>(c);
  if (!Number.isInteger(b.versao)) return c.json({ erro: tx(c, 'versao: inteiro', 'versao: integer') }, 400);
  const titulo = typeof b.titulo === 'string' && b.titulo.trim() ? b.titulo.replace(/\s+/g, ' ').trim().slice(0, 300) : null;
  let doc;
  let t;
  try {
    t = await lerTexto(c.env, tenantId, id);
    if (b.doc !== undefined) {
      doc = limparDoc(b.doc, novoId);
      const e = erroCorpo(paragrafosDoDoc(doc), idiomaDe(c), true);
      if (e) return c.json({ erro: e, code: 'texto_invalido' }, 400);
    } else {
      const e = erroCorpo(b.paragrafos, idiomaDe(c));
      if (e) return c.json({ erro: e, code: 'texto_invalido' }, 400);
      doc = docComIdsDe((b.paragrafos as string[]).map(normal).filter(Boolean), (await estrutura(t)).blocos, novoId);
    }
  } catch (err) {
    if (err instanceof ErroDoc) return c.json({ erro: tx(c, err.message, err.en), code: 'texto_invalido' }, 400);
    return erro(c, err);
  }
  const nova = await salvarDoc(c.env, tenantId, id, doc, b.versao as number, titulo);
  if (nova === null) {
    const atual = await lerTexto(c.env, tenantId, id);
    return c.json({ erro: tx(c, 'Outra pessoa salvou este texto antes de você. Recarregue para ver a versão nova; o que você escreveu continua na tela.', 'Someone else saved this text before you. Reload to see the new version; what you wrote is still on screen.'), code: 'versao', versao: atual.versao }, 409);
  }
  await guardarRetrato(c.env, tenantId, t, c.get('user').id, b.restaurando === true);
  if (b.doc === undefined) await conferirTexto(c.env, tenantId, id);
  return c.json(await estado(c, id));
})

// Histórico do editor: restaurar é a tela pondo o documento antigo no editor e salvando com `restaurando`.
.get('/:id/historico', async (c) => {
  try {
    await lerTexto(c.env, c.get('tenant').id, c.req.param('id'));
    return c.json({ versoes: await listarHistorico(c.env, c.get('tenant').id, c.req.param('id')) });
  } catch (e) {
    return erro(c, e);
  }
})
.get('/:id/historico/:retrato', async (c) => {
  try {
    return c.json(await lerRetrato(c.env, c.get('tenant').id, c.req.param('id'), c.req.param('retrato')));
  } catch (e) {
    return erro(c, e);
  }
})

// Material ao lado: os recortes do texto (trecho literal de uma fonte, ou anotação da pessoa), na ordem. Fora do `estado`:
// guardar, mover ou anotar não custa uma análise inteira do texto.
.get('/:id/recortes', async (c) => {
  try {
    await lerTexto(c.env, c.get('tenant').id, c.req.param('id'));
    return c.json({ recortes: await recortesDoTexto(c.env, c.get('tenant').id, c.req.param('id')) });
  } catch (e) {
    return erro(c, e);
  }
})
.post('/:id/recortes', requireMembro('editor'), async (c) => {
  try {
    const r = await criarRecorte(c.env, c.get('tenant').id, c.req.param('id'), c.get('user').id, await lerJson<Record<string, unknown>>(c));
    return c.json({ recortes: await recortesDoTexto(c.env, c.get('tenant').id, c.req.param('id')), recorteId: r.id, existia: r.existia }, r.existia ? 200 : 201);
  } catch (e) {
    return erro(c, e);
  }
})
.patch('/:id/recortes/:recorte', requireMembro('editor'), async (c) => {
  try {
    if (!(await alterarRecorte(c.env, c.get('tenant').id, c.req.param('id'), c.req.param('recorte'), await lerJson<Record<string, unknown>>(c)))) return c.json({ erro: tx(c, 'não encontrado', 'not found') }, 404);
    return c.json({ recortes: await recortesDoTexto(c.env, c.get('tenant').id, c.req.param('id')) });
  } catch (e) {
    return erro(c, e);
  }
})
.delete('/:id/recortes/:recorte', requireMembro('editor'), async (c) => {
  try {
    if (!(await tirarRecorte(c.env, c.get('tenant').id, c.req.param('id'), c.req.param('recorte')))) return c.json({ erro: tx(c, 'não encontrado', 'not found') }, 404);
    return c.json({ recortes: await recortesDoTexto(c.env, c.get('tenant').id, c.req.param('id')) });
  } catch (e) {
    return erro(c, e);
  }
})

// Leitor ao lado: o texto guardado da evidência em parágrafos, e as páginas do PDF em janela (`de`, `ate`; até 10 por pedido).
.get('/:id/evidencias/:evidencia/texto', async (c) => {
  try {
    return c.json(await textoDaEvidencia(c.env, c.get('tenant').id, c.req.param('id'), c.req.param('evidencia')));
  } catch (e) {
    return erro(c, e);
  }
})
.get('/:id/documentos/:arquivo/paginas', consulta('de', 'ate'), async (c) => {
  try {
    const { de, ate } = c.req.valid('query');
    return c.json(await paginasDoDocumento(c.env, c.get('tenant').id, c.req.param('id'), c.req.param('arquivo'), de, ate));
  } catch (e) {
    return erro(c, e);
  }
})

// Busca única no material do texto: recortes, evidências, páginas de PDF e transcrições, sem acento e sem caixa, com tetos.
.get('/:id/material/busca', consulta('q'), async (c) => {
  try {
    return c.json(await buscarNoMaterial(c.env, c.get('tenant').id, c.req.param('id'), c.req.valid('query').q));
  } catch (e) {
    return erro(c, e);
  }
})

// Trazer do acervo: a fonte (link, PDF, gravação) ou o recorte com a fonte dele, sem ler, processar ou transcrever de novo.
// O que já está no texto volta como está (200, `existia`). O link copiado vai para a fila do Wayback quando a cópia de lá
// ainda não foi salva, como o link novo.
.post('/:id/acervo/trazer', requireMembro('editor'), async (c) => {
  const tenantId = c.get('tenant').id;
  const id = c.req.param('id');
  try {
    const r = await trazerDoAcervo(c.env, tenantId, id, c.get('user').id, await lerJson<Record<string, unknown>>(c));
    if (r.wayback) await enfileirarWayback(c.env, tenantId, r.wayback);
    return c.json({ ...(await estado(c, id)), trazido: { tipo: r.tipo, id: r.id, existia: r.existia }, recortes: await recortesDoTexto(c.env, tenantId, id) }, r.existia ? 200 : 201);
  } catch (e) {
    return erro(c, e);
  }
})

// Ajuda ao terminar: nada volta para o documento. Sobre o texto salvo.
.post('/:id/divulgacao', requireMembro('editor'), comPlano, async (c) => {
  try {
    return c.json(await sugerirDivulgacao(c.env, await lerTexto(c.env, c.get('tenant').id, c.req.param('id')), idiomaDe(c)));
  } catch (e) {
    return erro(c, e);
  }
})
.post('/:id/segunda-leitura', requireMembro('editor'), comPlano, async (c) => {
  try {
    return c.json({ notas: await lerComoEditor(c.env, await lerTexto(c.env, c.get('tenant').id, c.req.param('id')), idiomaDe(c)) });
  } catch (e) {
    return erro(c, e);
  }
})

// Imagem no texto: sobe para o R2 e devolve o link assinado que entra no documento.
.post('/:id/imagens', requireMembro('editor'), async (c) => {
  const tenantId = c.get('tenant').id;
  const id = c.req.param('id');
  try {
    await lerTexto(c.env, tenantId, id);
  } catch (e) {
    return erro(c, e);
  }
  const tipo = (c.req.header('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (tipo !== 'image/jpeg' && tipo !== 'image/png') return c.json({ erro: tx(c, 'imagem: JPEG ou PNG', 'image: JPEG or PNG') }, 415);
  const bytes = await lerCorpoAte(c.req.raw.body, FOTO_MAX_BYTES);
  if (!bytes) return c.json({ erro: tx(c, 'imagem: até 2 MB', 'image: up to 2 MB') }, 413);
  if (!(tipo === 'image/png' ? ehPng(bytes) : ehJpeg(bytes))) return c.json({ erro: tx(c, 'o arquivo não é uma imagem válida', 'the file is not a valid image') }, 400);
  const key = `textos/${tenantId}/${id}/img-${novoId()}.${tipo === 'image/png' ? 'png' : 'jpg'}`;
  await c.env.MEDIA.put(key, bytes, { httpMetadata: { contentType: tipo } });
  return c.json({ src: await assinarMedia(c.env, key, IMAGEM_TTL_S) }, 201);
})

// Conferir: os blocos que ainda não foram conferidos no texto atual (`todos`: todos; `blocos`: só esses). Com
// `accept: application/x-ndjson`, a resposta vem por streaming, uma linha por bloco pronto ({tipo: 'bloco', ...}) e
// a última com o estado inteiro ({tipo: 'fim', estado}); sem ele, o estado inteiro no fim (o jeito de antes).
.post('/:id/conferir', requireMembro('editor'), comPlano, async (c) => {
  const tenantId = c.get('tenant').id;
  const id = c.req.param('id');
  const b = await lerJson<{ todos: unknown; blocos: unknown; pular: unknown }>(c);
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 2000) : undefined);
  const opcoes = { todos: b.todos === true, blocos: ids(b.blocos), pular: ids(b.pular) };
  try {
    exigirCorpo(await lerTexto(c.env, tenantId, id));
    // Sem chave de texto, o motivo vai antes do streaming (no meio dele viraria "parou no meio").
    await exigirChaveTexto(c.env, tenantId);
    if (!(c.req.header('accept') ?? '').includes('application/x-ndjson')) {
      await conferirBlocos(c.env, tenantId, id, opcoes);
      return c.json(await estado(c, id));
    }
  } catch (e) {
    return erro(c, e);
  }
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const w = writable.getWriter();
  const enc = new TextEncoder();
  const linha = (o: unknown) => w.write(enc.encode(`${JSON.stringify(o)}\n`));
  const tarefa = (async () => {
    try {
      const { restantes } = await conferirBlocos(c.env, tenantId, id, { ...opcoes, aoBloco: ({ custoUsd: _c, ...r }) => linha({ tipo: 'bloco', ...r }) });
      await linha({ tipo: 'fim', estado: await estado(c, id), restantes });
    } catch (e) {
      console.error('conferir stream', id, String(e).slice(0, 300));
      await linha({ tipo: 'erro', erro: e instanceof ErroMesa ? tx(c, e.message, e.en ?? e.message) : tx(c, 'A conferência parou no meio. Tente de novo.', 'The check stopped halfway. Try again.') }).catch(() => {});
    } finally {
      await w.close().catch(() => {});
    }
  })();
  try { c.executionCtx.waitUntil(tarefa); } catch { /* sem contexto de execução: a leitura do corpo segura a tarefa */ }
  return c.body(readable, 200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' });
})

.post('/:id/evidencias', requireMembro('editor'), async (c) => {
  const { url } = await lerJson<{ url: unknown }>(c);
  if (typeof url !== 'string') return c.json({ erro: tx(c, 'Cole o link da evidência.', 'Paste the link to the evidence.'), code: 'url_invalida' }, 400);
  try {
    const r = await acrescentarEvidencia(c.env, c.get('tenant').id, c.req.param('id'), url);
    // Cópia no Wayback Machine pela fila (a tela mostra "salvando no Wayback" até a captura voltar).
    if (!r.existia) await enfileirarWayback(c.env, c.get('tenant').id, r.id);
    return c.json({ ...(await estado(c, c.req.param('id'))), evidenciaId: r.id, existia: r.existia }, r.existia ? 200 : 201);
  } catch (e) {
    return erro(c, e);
  }
})

.patch('/:id/evidencias/:evidencia', requireMembro('editor'), async (c) => {
  const { tipoFonte } = await lerJson<{ tipoFonte: unknown }>(c);
  try {
    await lerTexto(c.env, c.get('tenant').id, c.req.param('id'));
    if (!(await tipoDaFonte(c.env, c.get('tenant').id, c.req.param('id'), c.req.param('evidencia'), tipoFonte ?? null))) return c.json({ erro: tx(c, 'não encontrado', 'not found') }, 404);
    return c.json(await estado(c, c.req.param('id')));
  } catch (e) {
    return erro(c, e);
  }
})

// Ações do cartão (registram apuração, não escrevem texto): fonte, outro_lado, opiniao, ignorar. Desfazer guarda quem e quando.
.post('/:id/apuracoes', requireMembro('editor'), async (c) => {
  try {
    const ap = await registrarApuracao(c.env, c.get('tenant').id, c.req.param('id'), c.get('user').id, await lerJson<Record<string, unknown>>(c));
    return c.json({ ...(await estado(c, c.req.param('id'))), apuracaoId: ap.id }, 201);
  } catch (e) {
    return erro(c, e);
  }
})
.delete('/:id/apuracoes/:apuracao', requireMembro('editor'), async (c) => {
  try {
    await lerTexto(c.env, c.get('tenant').id, c.req.param('id'));
    if (!(await desfazerApuracao(c.env, c.get('tenant').id, c.req.param('id'), c.req.param('apuracao'), c.get('user').id))) return c.json({ erro: tx(c, 'não encontrado', 'not found') }, 404);
    return c.json(await estado(c, c.req.param('id')));
  } catch (e) {
    return erro(c, e);
  }
})

// Wayback de novo (a cópia falhou): volta para a fila.
.post('/:id/evidencias/:evidencia/wayback', requireMembro('editor'), async (c) => {
  try {
    await lerTexto(c.env, c.get('tenant').id, c.req.param('id'));
    const ev = await c.env.DB.prepare("SELECT 1 FROM evidencias WHERE id = ? AND texto_id = ? AND tenant_id = ? AND origem = 'link'")
      .bind(c.req.param('evidencia'), c.req.param('id'), c.get('tenant').id).first();
    if (!ev) return c.json({ erro: tx(c, 'não encontrado', 'not found') }, 404);
    await enfileirarWayback(c.env, c.get('tenant').id, c.req.param('evidencia'));
    return c.json(await estado(c, c.req.param('id')));
  } catch (e) {
    return erro(c, e);
  }
})

// Escudo jurídico: pedido de outro lado (por e-mail pelo app, ou copiado e mandado por fora) e a resposta colada.
.post('/:id/pedidos', requireMembro('editor'), async (c) => {
  try {
    const r = await criarPedido(c.env, c.get('tenant').id, c.req.param('id'), { id: c.get('user').id, nome: c.get('user').name }, await lerJson<Record<string, unknown>>(c));
    return c.json({ ...(await estado(c, c.req.param('id'))), pedidoId: r.id, envioErro: r.erro }, 201);
  } catch (e) {
    return erro(c, e);
  }
})
.post('/:id/pedidos/:pedido/resposta', requireMembro('editor'), async (c) => {
  try {
    const r = await respostaManual(c.env, c.get('tenant').id, c.req.param('id'), c.req.param('pedido'), await lerJson<Record<string, unknown>>(c));
    return c.json({ ...(await estado(c, c.req.param('id'))), evidenciaId: r.evidenciaId }, 201);
  } catch (e) {
    return erro(c, e);
  }
})

// Página de fontes pública ("Como apuramos"): publicar a versão conferida (o checklist trava) ou tirar do ar.
.post('/:id/pagina-fontes', requireMembro('editor'), async (c) => {
  const { versao } = await lerJson<{ versao: unknown }>(c);
  try {
    await publicarPagina(c.env, c.get('tenant').id, c.req.param('id'), versao, c.get('user').id);
    return c.json(await estado(c, c.req.param('id')), 201);
  } catch (e) {
    return erro(c, e);
  }
})
.delete('/:id/pagina-fontes', requireMembro('editor'), async (c) => {
  try {
    if (!(await retirarPagina(c.env, c.get('tenant').id, c.req.param('id'), c.get('user').id))) return c.json({ erro: tx(c, 'não encontrado', 'not found') }, 404);
    return c.json(await estado(c, c.req.param('id')));
  } catch (e) {
    return erro(c, e);
  }
})

// Folha para o advogado: só as frases com marca de risco, em PDF. `?html=1` devolve o HTML, sem abrir navegador.
.get('/:id/folha', requireMembro('editor'), async (c) => {
  try {
    const f = await dadosFolha(c.env, c.get('tenant').id, c.req.param('id'));
    const html = htmlFolha(f);
    if (c.req.query('html') === '1') return c.html(html);
    return new Response(await gerarPdf(c.env, html), { headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="folha-advogado-v${f.versao}.pdf"`, 'cache-control': 'no-store' } });
  } catch (e) {
    return erro(c, e);
  }
})

// Pacote de defesa: o zip com versões, dossiê, apuração, outro lado, posts, manifesto de hashes e carimbo de tempo.
// O cabeçalho diz se o carimbo saiu (sem ele o pacote sai assim mesmo, e o LEIA-ME diz por quê).
.get('/:id/pacote', requireMembro('editor'), async (c) => {
  try {
    const p = await montarPacote(c.env, c.get('tenant').id, c.req.param('id'), c.get('user').id);
    return new Response(p.zip, {
      headers: {
        'content-type': 'application/zip', 'content-disposition': `attachment; filename="${p.nome}"`, 'cache-control': 'no-store',
        'x-carimbo': p.carimbo.ok ? `ok ${p.carimbo.em}` : 'falhou', ...(p.carimbo.erro ? { 'x-carimbo-erro': encodeURIComponent(p.carimbo.erro) } : {}),
        // Arquivos que ficaram fora (sumiram do armazenamento ou não cabem): a tela avisa; o LEIA-ME e o manifesto listam.
        'x-pacote-fora': String(p.fora.length),
      },
    });
  } catch (e) {
    return erro(c, e);
  }
})

// Pergunte ao documento: o PDF entra cru no corpo (nome no cabeçalho x-nome); a leitura vai para a fila.
.post('/:id/documentos', requireMembro('editor'), async (c) => {
  try {
    const nome = (() => { try { return decodeURIComponent(c.req.header('x-nome') ?? ''); } catch { return ''; } })();
    // O teto vale durante a leitura do corpo: arquivo grande demais é cortado no meio, não carregado inteiro na memória.
    const r = await enviarPdf(c.env, c.get('tenant').id, c.req.param('id'), c.get('user').id, nome, comoBuffer(await lerCorpoAte(c.req.raw.body, PDF_MAX_BYTES)));
    return c.json({ ...(await estado(c, c.req.param('id'))), arquivoId: r.id, existia: r.existia }, r.existia ? 200 : 201);
  } catch (e) {
    return erro(c, e);
  }
})
.get('/:id/documentos/:arquivo/pdf', async (c) => {
  try {
    await lerTexto(c.env, c.get('tenant').id, c.req.param('id'));
    const a = await c.env.DB.prepare('SELECT r2, nome FROM arquivos WHERE id = ? AND texto_id = ? AND tenant_id = ?').bind(c.req.param('arquivo'), c.req.param('id'), c.get('tenant').id).first<{ r2: string; nome: string }>();
    const obj = a ? await c.env.MEDIA.get(a.r2) : null;
    if (!a || !obj) return c.json({ erro: tx(c, 'não encontrado', 'not found') }, 404);
    return new Response(obj.body, { headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(a.nome)}`, 'cache-control': 'private, no-store' } });
  } catch (e) {
    return erro(c, e);
  }
})
.post('/:id/documentos/:arquivo/perguntas', requireMembro('editor'), comPlano, async (c) => {
  const { pergunta } = await lerJson<{ pergunta: unknown }>(c);
  try {
    const r = await perguntar(c.env, c.get('tenant').id, c.req.param('id'), c.req.param('arquivo'), pergunta, c.get('user').id);
    return c.json({ ...r, estado: await estado(c, c.req.param('id')) }, 201);
  } catch (e) {
    return erro(c, e);
  }
})
.post('/:id/documentos/:arquivo/evidencia', requireMembro('editor'), async (c) => {
  try {
    const r = await trechoParaEvidencia(c.env, c.get('tenant').id, c.req.param('id'), c.req.param('arquivo'), await lerJson<Record<string, unknown>>(c));
    return c.json({ ...(await estado(c, c.req.param('id'))), evidenciaId: r.id, existia: r.existia }, r.existia ? 200 : 201);
  } catch (e) {
    return erro(c, e);
  }
})

// Gravar no app: a sessão, as fatias (corpo cru, idempotente pelo número) e o concluir.
.post('/:id/gravacoes/sessao', requireMembro('editor'), comPlano, async (c) => {
  try {
    const b = await lerJson<{ mime: unknown }>(c);
    return c.json(await abrirSessao(c.env, c.get('tenant').id, c.req.param('id'), c.get('user').id, b.mime), 201);
  } catch (e) {
    return erro(c, e);
  }
})
.put('/:id/gravacoes/sessao/:sessao/:segmento/:fatia', requireMembro('editor'), async (c) => {
  try {
    await receberFatia(c.env, c.get('tenant').id, c.req.param('id'), c.req.param('sessao'), c.req.param('segmento'), c.req.param('fatia'), await lerCorpoAte(c.req.raw.body, FATIA_MAX_BYTES));
    return c.json({ ok: true });
  } catch (e) {
    return erro(c, e);
  }
})
.post('/:id/gravacoes/sessao/:sessao/concluir', requireMembro('editor'), async (c) => {
  try {
    await concluirSessao(c.env, c.get('tenant').id, c.req.param('id'), c.req.param('sessao'));
    return c.json(await estado(c, c.req.param('id')));
  } catch (e) {
    return erro(c, e);
  }
})
.post('/:id/gravacoes/:arquivo/segmentos/:n/tentar', requireMembro('editor'), comPlano, async (c) => {
  try {
    await tentarSegmento(c.env, c.get('tenant').id, c.req.param('id'), c.req.param('arquivo'), c.req.param('n'));
    return c.json(await estado(c, c.req.param('id')));
  } catch (e) {
    return erro(c, e);
  }
})

// Aspas contra a gravação: o áudio entra cru no corpo (nome em x-nome); a transcrição vai para a fila.
.post('/:id/gravacoes', requireMembro('editor'), comPlano, async (c) => {
  try {
    const nome = (() => { try { return decodeURIComponent(c.req.header('x-nome') ?? ''); } catch { return ''; } })();
    const r = await enviarAudio(c.env, c.get('tenant').id, c.req.param('id'), c.get('user').id, nome, comoBuffer(await lerCorpoAte(c.req.raw.body, AUDIO_MAX_BYTES)));
    return c.json({ ...(await estado(c, c.req.param('id'))), arquivoId: r.id, existia: r.existia }, r.existia ? 200 : 201);
  } catch (e) {
    return erro(c, e);
  }
})
.get('/:id/gravacoes/:arquivo/audio', async (c) => {
  try {
    const r = await audioParaTocar(c.env, c.get('tenant').id, c.req.param('id'), c.req.param('arquivo'), c.req.header('range'), Math.max(0, Number(c.req.query('t')) || 0));
    return r ?? c.json({ erro: tx(c, 'não encontrado', 'not found') }, 404);
  } catch (e) {
    return erro(c, e);
  }
})
.get('/:id/gravacoes/:arquivo/transcricao', async (c) => {
  try {
    return c.json({ trechos: await transcricao(c.env, c.get('tenant').id, c.req.param('id'), c.req.param('arquivo')) });
  } catch (e) {
    return erro(c, e);
  }
})

// Matéria viva: o alerta vira post novo de Atualização ou Errata (a nota é da pessoa) ou é fechado (texto atualizado, ignorado).
.post('/:id/alertas/:alerta/post', requireMembro('editor'), async (c) => {
  try {
    const r = await postDoAlerta(c.env, c.get('tenant').id, c.req.param('id'), c.req.param('alerta'), c.get('user').id, await lerJson<Record<string, unknown>>(c));
    return c.json({ ...r, estado: await estado(c, c.req.param('id')) }, 201);
  } catch (e) {
    return erro(c, e);
  }
})
.post('/:id/alertas/:alerta/resolver', requireMembro('editor'), async (c) => {
  const { acao } = await lerJson<{ acao: unknown }>(c);
  try {
    await resolverAlerta(c.env, c.get('tenant').id, c.req.param('id'), c.req.param('alerta'), c.get('user').id, acao);
    return c.json(await estado(c, c.req.param('id')));
  } catch (e) {
    return erro(c, e);
  }
})

// LAI: o pedido pronto para colar no portal do órgão; depois o protocolo, a prorrogação, a resposta e o recurso.
.post('/:id/lai', requireMembro('editor'), async (c) => {
  try {
    const r = await criarPedidoLai(c.env, c.get('tenant').id, c.req.param('id'), c.get('user').id, await lerJson<Record<string, unknown>>(c));
    return c.json({ ...(await estado(c, c.req.param('id'))), pedidoId: r.id }, 201);
  } catch (e) {
    return erro(c, e);
  }
})
.post('/:id/lai/:pedido/:acao', requireMembro('editor'), async (c) => {
  try {
    await andamentoLai(c.env, c.get('tenant').id, c.req.param('id'), c.req.param('pedido'), c.req.param('acao'), { id: c.get('user').id, nome: c.get('user').name ?? '' }, await lerJson<Record<string, unknown>>(c));
    return c.json(await estado(c, c.req.param('id')));
  } catch (e) {
    return erro(c, e);
  }
})

// Checklist que trava: o editor assina a publicação desta versão com as pendências que havia (registradas).
.post('/:id/assinar', requireMembro('editor'), async (c) => {
  const { versao } = await lerJson<{ versao: unknown }>(c);
  try {
    await assinar(c.env, c.get('tenant').id, c.req.param('id'), versao, c.get('user').id);
    return c.json(await estado(c, c.req.param('id')), 201);
  } catch (e) {
    return erro(c, e);
  }
})

.delete('/:id/evidencias/:evidencia', requireMembro('editor'), async (c) => {
  try {
    const ok = await removerEvidencia(c.env, c.get('tenant').id, c.req.param('id'), c.req.param('evidencia'), c.get('user').id);
    if (!ok) return c.json({ erro: tx(c, 'não encontrado', 'not found') }, 404);
    return c.json(await estado(c, c.req.param('id')));
  } catch (e) {
    return erro(c, e);
  }
})

// Devolver ao Docs: só os parágrafos alterados na mesa, com writeControl.requiredRevisionId igual à revisão lida. Se o
// Docs mudou depois, o Google recusa e a resposta traz o que mudou lá (409 `mudou_no_docs`): reimportar ou cancelar.
.post('/:id/devolver', requireMembro('editor'), async (c) => {
  const tenantId = c.get('tenant').id;
  const id = c.req.param('id');
  const { versao } = await lerJson<{ versao: unknown }>(c);
  try {
    const t = await lerTexto(c.env, tenantId, id);
    if (t.origem !== 'docs' || !t.docs_id || !t.docs_json || !googleConfigurado(c.env)) return c.json({ erro: tx(c, 'não encontrado', 'not found') }, 404);
    exigirCorpo(t);   // texto esvaziado aqui não apaga o documento no Google
    if (versao !== undefined && versao !== t.versao) return c.json({ erro: tx(c, 'O texto mudou desde que você abriu. Recarregue antes de devolver.', 'The text changed since you opened it. Reload before sending it back.'), code: 'versao', versao: t.versao }, 409);
    const docs: DocsSalvo = JSON.parse(t.docs_json);
    const { pedidos, trocados } = pedidosDevolucao(docs, JSON.parse(t.paragrafos_json));
    if (!pedidos.length) return c.json({ ...(await estado(c, id)), devolvidos: 0 });
    const userId = c.get('user').id;
    let nova: string | null;
    try {
      nova = await atualizarDocumento(c.env, userId, t.docs_id, t.docs_revisao ?? '', pedidos);
    } catch (e) {
      if (!(e instanceof ErroGoogle) || e.codigo !== 'mudou_no_docs') throw e;
      const atual = await lerDocumento(c.env, userId, t.docs_id);
      return c.json({ erro: tx(c, e.message, e.en ?? e.message), code: e.codigo, mudancas: mudancas(docs.paragrafos.map((p) => p.texto), corpoDoDoc(atual)) }, 409);
    }
    // Devolvido: a revisão e as posições passam a ser as da revisão que a devolução criou. Se o Docs já está em outra
    // (alguém editou entre a devolução e esta leitura), o snapshot fica o de antes: a próxima devolução é recusada pelo
    // Google e a tela mostra o que mudou, em vez de desfazer a edição de lá.
    const d = await lerDocumento(c.env, userId, t.docs_id);
    if (nova && d.revisao === nova) {
      await c.env.DB.prepare('UPDATE textos SET docs_revisao = ?, docs_json = ? WHERE id = ? AND tenant_id = ?').bind(d.revisao, JSON.stringify(snapshot(d)), id, tenantId).run();
    }
    await registrarEvento(c.env, tenantId, 'texto.devolvido', 'texto', id, { por: userId, paragrafos: trocados, revisao: nova });
    return c.json({ ...(await estado(c, id)), devolvidos: trocados });
  } catch (e) {
    return erro(c, e);
  }
})

// Reimportar do Docs (depois de uma devolução recusada): o texto de lá substitui o da mesa (a tela avisa que as edições
// da mesa se perdem) e a conferência roda de novo.
.post('/:id/reimportar', requireMembro('editor'), async (c) => {
  const tenantId = c.get('tenant').id;
  const id = c.req.param('id');
  const { versao } = await lerJson<{ versao: unknown }>(c);
  if (!Number.isInteger(versao)) return c.json({ erro: tx(c, 'versao: inteiro', 'versao: integer') }, 400);
  const mudou = (atual: number) => c.json({ erro: tx(c, 'Outra pessoa salvou este texto enquanto isso. Recarregue antes de reimportar.', 'Someone else saved this text in the meantime. Reload before re-importing.'), code: 'versao', versao: atual }, 409);
  try {
    const t = await lerTexto(c.env, tenantId, id);
    if (t.origem !== 'docs' || !t.docs_id || !googleConfigurado(c.env)) return c.json({ erro: tx(c, 'não encontrado', 'not found') }, 404);
    if (t.versao !== versao) return mudou(t.versao);
    const d = await lerDocumento(c.env, c.get('user').id, t.docs_id);
    const paragrafos = corpoDoDoc(d);
    const e = erroCorpo(paragrafos, idiomaDe(c));
    if (e) throw new ErroMesa('texto_invalido', e);
    // O lote é uma transação: a limpeza roda antes da troca de versão e só com o texto ainda na versão N que esta
    // reimportação leu. Quem passou para N+1 antes (outra reimportação, ou alguém que salvou) não perde as marcas: aqui a
    // limpeza não acha a versão N, e a troca também não.
    const naVersaoLida = `EXISTS (SELECT 1 FROM textos WHERE id = ? AND tenant_id = ? AND versao = ?)`;
    const [, , r] = await c.env.DB.batch([
      c.env.DB.prepare(`DELETE FROM afirmacoes WHERE texto_id = ? AND tenant_id = ? AND ${naVersaoLida}`).bind(id, tenantId, id, tenantId, versao),
      c.env.DB.prepare(`DELETE FROM blocos WHERE texto_id = ? AND tenant_id = ? AND ${naVersaoLida}`).bind(id, tenantId, id, tenantId, versao),
      // O documento do editor volta a ser o convertido do Docs (formatação de lá); as marcas e os blocos recomeçam.
      c.env.DB.prepare(`UPDATE textos SET titulo = ?, paragrafos_json = ?, doc_json = NULL, docs_revisao = ?, docs_json = ?, versao = versao + 1, updated_at = datetime('now')
                         WHERE id = ? AND tenant_id = ? AND versao = ? RETURNING versao`)
        .bind((d.titulo || t.titulo).slice(0, 300), JSON.stringify(paragrafos), d.revisao, JSON.stringify(snapshot(d)), id, tenantId, versao),
    ]);
    if (!r.results.length) return mudou((await lerTexto(c.env, tenantId, id)).versao);
    await conferirTexto(c.env, tenantId, id);
    return c.json(await estado(c, id));
  } catch (e) {
    return erro(c, e);
  }
})

// Aba Posts da Matéria: as peças de todas as pautas que saíram do texto, com o status.
.get('/:id/posts', async (c) => {
  try {
    await lerTexto(c.env, c.get('tenant').id, c.req.param('id'));
    return c.json({ posts: await postsDaMateria(c.env, c.get('tenant').id, c.req.param('id')) });
  } catch (e) {
    return erro(c, e);
  }
})

// Mandar para o Instagram: a pauta é montada com as afirmações conferidas (frase do autor + evidência), não com o
// texto inteiro. Pendência do checklist sem a assinatura do editor: 409 com a lista (`pendencias`). Entra em produção em carrossel.
.post('/:id/instagram', requireMembro('editor'), async (c) => {
  const { cardFontes } = await lerJson<{ cardFontes: unknown }>(c);
  try {
    const r = await pautaDaMateria(c.env, c.get('tenant').id, c.req.param('id'), c.get('user').id, { cardFontes: cardFontes === true });
    return c.json(r, 201);
  } catch (e) {
    return erro(c, e);
  }
});
