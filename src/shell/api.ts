import { NARRACAO_MAX_BYTES, decidirAviso, narracaoDaVersao, narracaoParaTela, narracaoPorId, receberNarracao } from '../lib/narracao';
import { MOVIMENTOS_REELS, PASSOS_REELS, RITMO_PADRAO, type MovimentoReels, type PassoReels, type RitmoReels } from '../lib/reelsHtml';
import { alvoDoAjuste, gerarAjuste } from '../lib/ajuste';
import { MIN_RESUMO, montarResumo } from '../lib/resumo';
import { Hono, type Context } from 'hono';
import { validator } from 'hono/validator';
import { eventoStmt, novoId, registrarEvento } from '../lib/db';
import { gerarGanchos } from '../lib/gancho';
import { criarLink, dadosComprovante, estadoAprovacao, htmlComprovante, pecaDeAnuncio } from '../lib/anuncio';
import { gerarPdf } from '../lib/pdf';
import { carregarPauta } from '../lib/pauta';
import { MAX_ILUSTRACOES_CARD, ilustrarCard, ilustracoesDoCard, tetoPecaUsd } from '../lib/ilustrar';
import type { Rascunho } from '../lib/redacao';
import { assinarMedia, cifrarToken } from '../lib/crypto';
import { CHAVE_MAX, CHAVE_MIN, conferirChave, estadoChaves, temChave } from '../lib/provedores';
import { PROVEDORES, PROVEDORES_IMAGEM, PROVEDORES_TEXTO, ehProvedor, type Provedor } from '../lib/provedoresTabela';
import { carregarConta, pacoteDePublicacao } from '../lib/publicar';
import type { ArteRenderizada } from '../lib/render';
import {
  DECISOES, FORMATOS_DE_PAUTA, MODOS_CONTA, MODOS_TENANT, STATUS_PAUTA, STATUS_PECA, iniciarExecucao, pertence, transitar, type Transicao,
} from '../kernel/estados';
import { MAX_RODADAS, idProducao, iniciarProducao } from '../workflows/producao';
import { cursorPublicacoes, desdeSql, etapaProducao, listaDeStatus } from './fila';
import { ErroNova, PRINT_MAX_BYTES, novaPauta, type PedidoNova } from '../lib/nova';
import { LOGO_MAX_BYTES, REFERENCIA_MAX_BYTES, ehJpeg, ehPng, lerCorpoAte, lerLogo, marcaPublica, mesclarCtas, sanitizarSvg, validarMarca } from './marca';
import { ehAdminPlataforma, exigirAdminPlataforma, requireMembro, type AppEnv } from './tenancy';
import { PERIODOS_USO, painelDeUso } from '../lib/uso';
import { textos } from './textos';
import { MAX_FALHAS_FONTE } from '../monitor/scheduled';
import { aceitarConvite, emailValido, linkConvite, papelConvite } from './convites';
import type { ProducaoParams } from '../env';
import { ufSql } from '../lib/uf';
import { produzirPauta } from '../lib/produzir';
import { ESCOPO_DOCS, ErroGoogle, docsConectado, googleConfigurado, lerDocumento, textoDoDoc, tokenGoogle, urlDoDoc } from '../lib/google';
import { ErroAutoral, ITENS_INICIAIS, baixarLogo, lerSubstack, marcaAutoral, origemSubstack, type Substack } from '../lib/autoral';
import { aplicarEstilo, editarCards, ilustracaoAtual, prefixoFotos } from './edicao';
import { aprovarPeca } from '../lib/aprovar';
import { contaDoPiloto } from '../lib/piloto';
import { ErroCarimbo } from '../lib/carimbo';
import { emitirCertidao, pacoteCertidao } from '../lib/certidao';
import { NOTA_CASO_MAX, TIPOS_CASO } from '../lib/kit';
import { mesValido, zipDoMes } from '../lib/arquivoMes';
import { ITENS_POR_PAGINA, LEGENDA_MAX, MAX_ITENS_LOTE, MINIATURA_MAX_BYTES } from '../lib/raiox';
import { apagarRaioX } from '../lib/raioxFila';
import { pedirCertidao } from '../workflows/publicacao';
import { MAX_PUXADAS_DIA, enderecoDoSite, puxarMarca } from '../lib/puxarMarca';
import { AVISO_USO, PLANOS, PLANOS_PAGOS, instalacaoPropria, planoInicial, situacaoPlano } from '../lib/planos';
import { cobrancaLigada, criarCheckout, criarPortal } from '../lib/stripe';
import { arquivarEstilo, atualizarEstilo, copiarEstilo, criarEstilo, listarEstilos, listarPatrocinios, patrocinioDoVeiculo, situacaoDoEstilo, validarEstilo, validarPatrocinio } from '../lib/estilos';
import type { EstiloPeca } from '../lib/estilo';
import { FOTO_MAX_BYTES, levaArte, normalizarCards, type Card } from '../lib/cards';
import { previaDaPeca } from './previaPeca';
import { bibliotecaMusical } from '../lib/musica';
import type { ArteReels } from '../lib/reels';
import { ehIdioma, idiomaDe, t } from './idioma';
import { ehIdiomaConteudo, idiomaDoVeiculo, type IdiomaConteudo } from '../lib/idiomaConteudo';

/**
 * API sob /api (sessão já exigida em index.ts). Recursos de tenant em /t/:tenantId/…, atrás de requireMembro;
 * toda query leva `AND tenant_id = ?`. Quem decidiu (`por`) é sempre c.var.user.id; campo `por` no body é ignorado.
 */
const hostDe = (url: string | null) => {
  if (!url || !/^https?:\/\//.test(url)) return null;
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
};
const lerJson = async <T>(c: Context<AppEnv>): Promise<Partial<T>> => (await c.req.json().catch(() => ({}))) as Partial<T>;
const PENDENTE = 'Workflow não confirmou o início; o cron recria em até 15 min (ou marca falha depois de 1 h).';
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
const slugificar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
// Modelos gated do Workers AI (Llama) exigem aceitar a licença uma vez por conta: enviar o prompt "agree".
const MODELOS_COM_LICENCA = new Set(['@cf/meta/llama-3.2-11b-vision-instruct', '@cf/meta/llama-3.3-70b-instruct-fp8-fast']);

// Só declara `?status=` e `?desde=` para o cliente RPC (hc tipa a query pelo validador); a validação de verdade é
// listaDeStatus e desdeSql.
const consultaStatus = validator('query', (q) => ({
  status: typeof q.status === 'string' ? q.status : undefined,
  desde: typeof q.desde === 'string' ? q.desde : undefined,
}));
// `?todas=1`: a tela do veículo lista também o que está desligado ou pausado; a fila e a lateral só veem o ativo.
const consultaTodas = validator('query', (q) => ({ todas: typeof q.todas === 'string' ? q.todas : undefined }));
const URL_FONTE_MAX = 2000;
/** Intermediários com adaptador em src/lib/publicar.ts. */
const PROVEDORES_ATIVOS = ['ayrshare'];
/** URL http(s) absoluta e normalizada, ou null. */
function urlDeFonte(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > URL_FONTE_MAX) return null;
  try {
    const u = new URL(v.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch { return null; }
}

export const api = new Hono<AppEnv>()

// ── conta do usuário ─────────────────────────────────────────────────────────────────────────────────────────────

.get('/me', async (c) => {
  const u = c.get('user');
  // Município principal para o seletor de veículo (nome + município); temático não tem.
  const { results } = await c.env.DB.prepare(
    `SELECT t.id, t.slug, t.nome, t.modo, t.uf, t.idioma, t.plano, m.papel,
            json_extract(t.marca_json, '$.handle') AS handle, json_extract(t.marca_json, '$.logoR2') AS logo_r2,
            (SELECT a.municipio_nome FROM tenant_areas a WHERE a.tenant_id = t.id AND a.bairro IS NULL ORDER BY a.rowid LIMIT 1) AS municipio
       FROM membros m JOIN tenants t ON t.id = m.tenant_id WHERE m.user_id = ? ORDER BY t.nome`,
  ).bind(u.id).all<{ id: string; slug: string; nome: string; modo: string; uf: string | null; idioma: IdiomaConteudo; plano: string; papel: string; municipio: string | null; handle: string | null; logo_r2: string | null }>();
  // @ e logo (URL assinada por 1 h) para o seletor de veículo na lateral.
  const tenants = await Promise.all(results.map(async ({ logo_r2, ...t }) => ({ ...t, logo: logo_r2 ? await assinarMedia(c.env, logo_r2, 3600) : null })));
  // Google Docs: só com a configuração do Google (senão null e a interface esconde). A chave e o número do projeto são
  // do Picker (públicos por natureza, restritos ao domínio no Google Cloud); o token nunca vem aqui.
  const google = googleConfigurado(c.env)
    ? { conectado: await docsConectado(c.env, u.id), apiKey: c.env.GOOGLE_API_KEY!, appId: c.env.GOOGLE_PROJECT_NUMBER!, escopo: ESCOPO_DOCS }
    : null;
  // Idioma escolhido pela pessoa (null: ainda não escolheu, e a tela segue o navegador).
  const pref = await c.env.DB.prepare('SELECT idioma FROM "user" WHERE id = ?').bind(u.id).first<{ idioma: string | null }>();
  const idioma = ehIdioma(pref?.idioma) ? pref.idioma : null;
  return c.json({ user: { id: u.id, email: u.email, name: u.name, image: u.image ?? null, idioma }, tenants, google, adminPlataforma: ehAdminPlataforma(c.env, u.id) });
})

// Idioma das telas da pessoa, guardado na conta (vale em qualquer aparelho).
.put('/me/idioma', async (c) => {
  const b = await lerJson<{ idioma: unknown }>(c);
  if (!ehIdioma(b.idioma)) return c.json({ erro: t(c, 'idioma: pt-BR ou en', 'idioma: pt-BR or en') }, 400);
  await c.env.DB.prepare('UPDATE "user" SET idioma = ? WHERE id = ?').bind(b.idioma, c.get('user').id).run();
  return c.json({ idioma: b.idioma });
})

// Token de acesso de curta duração para o Google Picker (o Worker renova com o refresh token salvo). 404 sem a
// configuração do Google; 409 com `code` quando a pessoa precisa conectar (de novo).
.get('/google/token', async (c) => {
  if (!googleConfigurado(c.env)) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  try {
    return c.json(await tokenGoogle(c.env, c.get('user').id));
  } catch (e) {
    if (e instanceof ErroGoogle) return c.json({ erro: t(c, e.message, e.en ?? e.message), code: e.codigo }, e.status);
    throw e;
  }
})

// Cadastro aberto: qualquer usuário logado cria um veículo e vira admin dele.
// Modo local exige o município (IBGE + nome): a triagem só aceita notícia de cidade que está em tenant_areas.
// Modo autoral exige a URL do Substack (`substack`): o feed vira a fonte, feed e página dão nome (quando não vem),
// logo, cor e assinatura, e os 3 textos mais recentes viram pautas produzidas em carrossel pela fila.
.post('/tenants', async (c) => {
  const b = await lerJson<{ nome: string; slug: string; modo: string; uf: string; municipioIbge: string; municipioNome: string; substack: string; idioma: string }>(c);
  const modo = b.modo ?? 'local';
  if (!pertence(MODOS_TENANT, modo)) return c.json({ erro: `modo: ${MODOS_TENANT.join(' | ')}` }, 400);
  // Idioma do conteúdo (posts, cards, legenda e conferência). Sem ele, português.
  if (b.idioma !== undefined && !ehIdiomaConteudo(b.idioma)) return c.json({ erro: t(c, 'idioma: pt-BR ou en', 'idioma: pt-BR or en') }, 400);
  const idioma = idiomaDoVeiculo(b.idioma);
  let nome = String(b.nome ?? '').trim();
  let substack: Substack | null = null;
  if (modo === 'autoral') {
    const origem = typeof b.substack === 'string' ? origemSubstack(b.substack) : null;
    if (!origem) return c.json({ erro: t(c, 'Cole o endereço do seu Substack.', 'Paste the address of your Substack.'), code: 'substack_invalido' }, 400);
    try {
      substack = await lerSubstack(origem);
    } catch (e) {
      if (!(e instanceof ErroAutoral)) throw e;
      return c.json({ erro: t(c, 'Não achamos os textos desse endereço. Confira se é a página do seu Substack.', "We couldn't find any posts at that address. Check that it's your Substack page."), code: 'substack_sem_feed' }, 400);
    }
    if (!nome) nome = (substack.titulo ?? '').slice(0, 80).trim();
  }
  if (nome.length < 2 || nome.length > 80) return c.json({ erro: t(c, 'nome entre 2 e 80 caracteres', 'name must be 2 to 80 characters') }, 400);
  const slug = b.slug ?? slugificar(nome);
  if (!SLUG.test(slug)) return c.json({ erro: t(c, 'slug: 3 a 40 caracteres, a-z, 0-9 e hífen', 'slug: 3 to 40 characters, a-z, 0-9 and hyphen') }, 400);
  // Autoral não tem cobertura por cidade (como o temático).
  const ibge = modo === 'autoral' ? null : b.municipioIbge?.trim() || null;
  const municipio = modo === 'autoral' ? null : b.municipioNome?.trim() || null;
  if (modo === 'local' && (!ibge || !/^\d{7}$/.test(ibge) || !municipio)) {
    return c.json({ erro: t(c, 'modo local exige municipioIbge (7 dígitos) e municipioNome (como aparece nas notícias)', 'local mode requires municipioIbge (7 digits) and municipioNome (as it appears in the news)') }, 400);
  }

  const id = novoId();
  const userId = c.get('user').id;
  // Marca nasce com o nome do veículo: sem logo, o card assina com ele (paleta neutra do render). Autoral: a do Substack.
  let marca: Record<string, unknown> = { nome };
  if (substack) {
    const logoR2 = await baixarLogo(c.env, id, substack.imagem);
    marca = { ...marcaAutoral(nome, substack, idioma), ...(logoR2 ? { logoR2 } : {}) };
  }
  try {
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO tenants (id, slug, nome, modo, uf, municipio_ibge, marca_json, idioma, plano) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, slug, nome, modo, modo === 'autoral' ? null : b.uf ?? null, ibge, JSON.stringify(marca), idioma, planoInicial(c.env)),
      c.env.DB.prepare("INSERT INTO membros (id, tenant_id, user_id, papel) VALUES (?, ?, ?, 'admin')").bind(novoId(), id, userId),
      ...(ibge && municipio
        ? [c.env.DB.prepare('INSERT INTO tenant_areas (tenant_id, municipio_ibge, municipio_nome, bairro) VALUES (?, ?, ?, NULL)').bind(id, ibge, municipio)]
        : []),
      ...(substack
        ? [c.env.DB.prepare("INSERT INTO fontes (id, tenant_id, tipo, nome, url) VALUES (?, ?, 'rss', ?, ?)").bind(novoId(), id, (substack.titulo ?? nome).slice(0, 80), substack.feedUrl)]
        : []),
    ]);
  } catch (e) {
    if (String(e).includes('UNIQUE')) return c.json({ erro: t(c, 'slug em uso', 'slug already in use') }, 409);
    throw e;
  }
  const urls = substack?.itens.slice(0, ITENS_INICIAIS).map((i) => i.url) ?? [];
  // O veículo já existe: a fila fora do ar não desfaz o cadastro (repetir daria "slug em uso"). Sem a mensagem, os
  // primeiros posts não saem sozinhos, mas o feed está nas fontes e o monitor traz os textos na próxima rodada.
  let textos = 0;
  if (urls.length) {
    try {
      await c.env.MONITOR_QUEUE.send({ tipo: 'autoral', tenantId: id, por: userId, urls });
      textos = urls.length;
    } catch (e) {
      await registrarEvento(c.env, id, 'autoral.fila_falhou', 'tenant', id, { erro: String(e).slice(0, 300) });
    }
  }
  return c.json({ id, slug, nome, modo, idioma, papel: 'admin', textos }, 201);
})

// Consumo dos modelos, só para o dono da plataforma (web/src/telas/Uso.tsx). A tela pergunta de novo a cada 3 s.
.get('/admin/uso', exigirAdminPlataforma, async (c) => {
  const pedido = Number(c.req.query('dias'));
  return c.json(await painelDeUso(c.env, PERIODOS_USO.find((d) => d === pedido) ?? 1));
})

.post('/admin/ai-licenca', exigirAdminPlataforma, async (c) => {
  const { modelo } = await lerJson<{ modelo: string }>(c);
  if (!modelo || !MODELOS_COM_LICENCA.has(modelo)) return c.json({ erro: t(c, 'modelo fora da lista', 'model not on the list'), modelos: [...MODELOS_COM_LICENCA] }, 400);
// O aceite responde com erro 5016 "Thank you for agreeing": é sucesso, não falha.
  try {
    const out = await c.env.AI.run(modelo as keyof AiModels, { prompt: 'agree' } as never) as { response?: string };
    return c.json({ modelo, resposta: String(out?.response ?? '').slice(0, 200) });
  } catch (e) {
    const msg = String(e);
    return c.json({ modelo, aceito: /agreeing|agreed/i.test(msg), resposta: msg.slice(0, 200) }, /agreeing|agreed/i.test(msg) ? 200 : 502);
  }
})

// ── recursos do tenant ───────────────────────────────────────────────────────────────────────────────────────────

.use('/t/:tenantId/*', requireMembro())

// Mesa revisora do veículo de autor (src/shell/textos.ts).
.route('/t/:tenantId/textos', textos)

// Fila de pautas por score. `?status=sugerida,aceita` (padrão: sugerida). Com o nome da fonte do primeiro documento,
// o número de fatos, o texto de cada fato na ordem da pauta (a folha de pauta das Ideias mostra o que a fonte traz antes
// de produzir) e, se a última peça da pauta falhou, o motivo (a pauta volta para `aceita` e a UI diz por quê).
.get('/t/:tenantId/pautas', consultaStatus, async (c) => {
  const status = listaDeStatus(c.req.query('status'), STATUS_PAUTA, ['sugerida']);
  if (!status) return c.json({ erro: t(c, `status: ${STATUS_PAUTA.join(' | ')} (separados por vírgula)`, `status: ${STATUS_PAUTA.join(' | ')} (comma-separated)`) }, 400);
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.status, p.origem, p.titulo, p.resumo, p.editoria, p.bairro, p.score, p.created_at, p.municipio_ibge, p.tipo_post,
            (SELECT an.anunciante FROM anuncios an WHERE an.pauta_id = p.id AND an.tenant_id = p.tenant_id) AS anunciante,
            (SELECT a.municipio_nome FROM tenant_areas a WHERE a.tenant_id = p.tenant_id AND a.municipio_ibge = p.municipio_ibge
              ORDER BY a.bairro IS NOT NULL LIMIT 1) AS cidade,
            json_array_length(p.fato_ids_json) AS nfatos,
            (SELECT json_group_array(texto) FROM (
               SELECT f.texto FROM json_each(p.fato_ids_json) j
                 JOIN fatos f ON f.id = j.value AND f.tenant_id = p.tenant_id
                ORDER BY j.key)) AS fatos_json,
            (SELECT fo.nome FROM documentos d JOIN fontes fo ON fo.id = d.fonte_id
              WHERE d.id = json_extract(p.documento_ids_json, '$[0]') AND d.tenant_id = p.tenant_id) AS fonte,
            (SELECT d.url FROM documentos d WHERE d.id = json_extract(p.documento_ids_json, '$[0]') AND d.tenant_id = p.tenant_id) AS documento_url,
            (SELECT CASE WHEN pc.status = 'falhou' THEN COALESCE(pc.erro, '') END FROM pecas pc
              WHERE pc.pauta_id = p.id AND pc.tenant_id = p.tenant_id ORDER BY pc.created_at DESC, pc.rowid DESC LIMIT 1) AS falhou
       FROM pautas p WHERE p.tenant_id = ? AND p.status IN (${status.map(() => '?').join(', ')})
      ORDER BY p.score DESC, p.created_at DESC LIMIT 100`,
  ).bind(c.get('tenant').id, ...status).all<{
    id: string; status: string; origem: string; titulo: string; resumo: string | null; editoria: string | null; bairro: string | null;
    score: number | null; created_at: string; nfatos: number; fatos_json: string; fonte: string | null; documento_url: string | null; falhou: string | null;
    municipio_ibge: string | null; cidade: string | null; tipo_post: string | null; anunciante: string | null;
  }>();
  // Quantas chegaram depois de `?desde=` (ms), contadas no banco: a lista acima para em 100.
  const desde = desdeSql(c.req.query('desde'));
  const novas = desde === null ? null : (await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM pautas WHERE tenant_id = ? AND status IN (${status.map(() => '?').join(', ')}) AND created_at > ?`,
  ).bind(c.get('tenant').id, ...status, desde).first<{ n: number }>())?.n ?? 0;
  // Link trazido à mão não tem fonte cadastrada: vale o site (o mesmo que o card assina).
  const pautas = results.map(({ documento_url, fatos_json, ...p }) => ({ ...p, fonte: p.fonte ?? hostDe(documento_url), fatos: JSON.parse(fatos_json) as string[] }));
  return c.json({ pautas, novasDesde: novas });
})

// + Nova: link (`{url}`), relato (`{texto}`), Google Docs (`{docs: id}`, com a configuração do Google) ou print (corpo cru PNG/JPEG/WebP) → pauta `manual` no topo das Ideias.
// Qualquer membro (repórter também traz notícia). Mesmo conteúdo → mesma ideia (`situacao`: nova, existente, de_volta).
.post('/t/:tenantId/pautas', async (c) => {
  const tipo = (c.req.header('content-type') ?? '').split(';')[0].trim().toLowerCase();
  let pedido: PedidoNova;
  if (tipo.startsWith('image/')) {
    const bytes = await lerCorpoAte(c.req.raw.body, PRINT_MAX_BYTES);
    if (!bytes) return c.json({ erro: t(c, 'print acima de 4 MB', 'screenshot over 4 MB'), code: 'imagem_grande' }, 413);
    pedido = { tipo: 'print', bytes, mime: tipo };
  } else {
    const b = await lerJson<{ url: unknown; texto: unknown; docs: unknown; anuncio: { anunciante?: unknown; briefing?: unknown } }>(c);
    if (b.anuncio !== undefined) {
      const modo = await c.env.DB.prepare('SELECT modo FROM tenants WHERE id = ?').bind(c.get('tenant').id).first<{ modo: string }>();
      if (modo?.modo === 'autoral') return c.json({ erro: t(c, 'veículo de autor não faz anúncio', "author publications don't run ads"), code: 'pedido_invalido' }, 400);
      if (typeof b.anuncio?.anunciante !== 'string' || typeof b.anuncio?.briefing !== 'string') return c.json({ erro: t(c, 'anuncio: {anunciante, briefing}', 'anuncio: {anunciante, briefing}'), code: 'pedido_invalido' }, 400);
      pedido = { tipo: 'anuncio', anunciante: b.anuncio.anunciante, briefing: b.anuncio.briefing };
    } else if (b.docs !== undefined) {
      // Google Docs (escolhido no Picker): lido aqui com o token da pessoa e trazido como relato com título e origem.
      if (!googleConfigurado(c.env)) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
      try {
        const doc = await lerDocumento(c.env, c.get('user').id, String(b.docs));
        pedido = { tipo: 'relato', titulo: doc.titulo, texto: textoDoDoc(doc), origem: { url: urlDoDoc(doc.id), revisao: doc.revisao } };
      } catch (e) {
        if (e instanceof ErroGoogle) return c.json({ erro: t(c, e.message, e.en ?? e.message), code: e.codigo }, e.status);
        throw e;
      }
    } else if (typeof b.url === 'string') pedido = { tipo: 'link', url: b.url };
    else if (typeof b.texto === 'string') pedido = { tipo: 'relato', texto: b.texto };
    else return c.json({ erro: t(c, 'mande {url}, {texto} ou a imagem do print', 'send {url}, {texto} or the screenshot image'), code: 'pedido_invalido' }, 400);
  }
  try {
    const r = await novaPauta(c.env, c.get('tenant').id, c.get('user').id, pedido);
    return c.json(r, r.situacao === 'existente' ? 200 : 201);
  } catch (e) {
    if (e instanceof ErroNova) return c.json({ erro: t(c, e.message, e.en ?? e.message), code: e.codigo }, e.status);
    throw e;
  }
})

// Tirar a ideia da fila. Só de sugerida ou aceita: pauta em produção tem peça andando e não some por aqui.
.post('/t/:tenantId/pautas/:id/descartar', requireMembro('editor'), async (c) => {
  const { motivo } = await lerJson<{ motivo: string }>(c);
  await transitar(c.env, {
    tipo: 'pauta', id: c.req.param('id'), tenantId: c.get('tenant').id, para: 'descartada', por: c.get('user').id,
    motivo: motivo?.slice(0, 500) || null, de: ['sugerida', 'aceita'],
  });
  return c.json({ status: 'descartada' as const });
})

// Pauta → peça + rodada 1 de produção. Pauta, peça e execução num batch; a instância do Workflow só depois.
.post('/t/:tenantId/pautas/:id/produzir', requireMembro('editor'), async (c) => {
  const tenantId = c.get('tenant').id;
  const { formato = 'carrossel' } = await lerJson<{ formato: string }>(c);
  if (!pertence(FORMATOS_DE_PAUTA, formato)) return c.json({ erro: `formato: ${FORMATOS_DE_PAUTA.join(' | ')}` }, 400);
  const r = await produzirPauta(c.env, tenantId, c.req.param('id'), c.get('user').id, formato);
  if (!r) return c.json({ erro: t(c, 'pauta já está em produção', 'idea is already in production') }, 409);
  if (r.pendente) return c.json({ pecaId: r.pecaId, workflowId: r.workflowId, pendente: true, aviso: PENDENTE }, 202);
  return c.json({ pecaId: r.pecaId, workflowId: r.workflowId }, 201);
})

// Peças para a fila (padrão: produzindo e em revisão), com a manchete e a capa assinada (1 h) para a miniatura.
// Em revisão vêm primeiro, a que espera há mais tempo à frente; aprovadas (Prontos para postar) também por ordem de
// chegada, com o horário anotado no lugar quando há; o resto, da mais recente. A lista para em 50; a contagem por
// situação (`total`, e `manuais` para as aprovadas que alguém posta à mão) é de todas, para os contadores não mentirem.
.get('/t/:tenantId/pecas', consultaStatus, async (c) => {
  const tenantId = c.get('tenant').id;
  const status = listaDeStatus(c.req.query('status'), STATUS_PECA, ['rascunho', 'revisao']);
  if (!status) return c.json({ erro: t(c, `status: ${STATUS_PECA.join(' | ')} (separados por vírgula)`, `status: ${STATUS_PECA.join(' | ')} (comma-separated)`) }, 400);
  const em = status.map(() => '?').join(', ');
  const [lista, contagem] = await c.env.DB.batch<Record<string, unknown>>([
    c.env.DB.prepare(
      `SELECT pc.id, pc.status, pc.formato, pc.rodada, pc.created_at, pc.updated_at, pa.titulo, pa.editoria,
              pc.agendado_para, co.modo AS conta_modo, co.nome AS conta_nome, co.external_id AS conta_external_id,
              json_extract(pc.conteudo_json, '$.manchete') AS manchete,
              json_array_length(pc.arte_r2_keys_json) AS ncards,
              json_extract(pc.arte_r2_keys_json, '$[0].jpg') AS capa_r2
         FROM pecas pc JOIN pautas pa ON pa.id = pc.pauta_id AND pa.tenant_id = pc.tenant_id
         LEFT JOIN contas_sociais co ON co.id = pc.conta_id AND co.tenant_id = pc.tenant_id
        WHERE pc.tenant_id = ? AND pc.status IN (${em})
        ORDER BY pc.status = 'revisao' DESC,
                 CASE WHEN pc.status IN ('revisao', 'aprovada', 'agendada') THEN COALESCE(datetime(pc.agendado_para), pc.updated_at) END ASC,
                 pc.updated_at DESC, pc.id
        LIMIT 50`,
    ).bind(tenantId, ...status),
    c.env.DB.prepare(
      `SELECT pc.status, COUNT(*) AS n, SUM(co.modo = 'manual') AS manuais
         FROM pecas pc LEFT JOIN contas_sociais co ON co.id = pc.conta_id AND co.tenant_id = pc.tenant_id
        WHERE pc.tenant_id = ? AND pc.status IN (${em}) GROUP BY pc.status`,
    ).bind(tenantId, ...status),
  ]);
  const linhas = lista.results as {
    id: string; status: string; formato: string; rodada: number; created_at: string; updated_at: string; titulo: string;
    editoria: string | null; manchete: string | null; ncards: number | null; capa_r2: string | null;
    agendado_para: string | null; conta_modo: string | null; conta_nome: string | null; conta_external_id: string | null;
  }[];
  const pecas = await Promise.all(linhas.map(async ({ capa_r2, ...p }) => ({
    ...p, capa: capa_r2 ? await assinarMedia(c.env, capa_r2, 3600) : null,
  })));
  const contas = contagem.results as { status: string; n: number; manuais: number | null }[];
  const total: Record<string, number> = Object.fromEntries(contas.map((r) => [r.status, r.n]));
  // Aprovadas e agendadas em conta manual: esperam alguém postar (o contador de Prontos para postar).
  const manuais = contas.filter((r) => r.status === 'aprovada' || r.status === 'agendada').reduce((n, r) => n + (r.manuais ?? 0), 0);
  // Prontas para aprovar desde `?desde=` (ms), contadas no banco: a lista para em 50.
  const desde = desdeSql(c.req.query('desde'));
  const prontas = desde === null ? null : (await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM pecas WHERE tenant_id = ? AND status = 'revisao' AND updated_at > ?",
  ).bind(tenantId, desde).first<{ n: number }>())?.n ?? 0;
  return c.json({ pecas, total, manuais, prontasDesde: prontas });
})

// Andamento leve para o polling de 2 s: só D1 (sem consultar o Workflow nem assinar arte).
.get('/t/:tenantId/pecas/:id/status', async (c) => {
  const tenantId = c.get('tenant').id;
  const id = c.req.param('id');
  const pc = await c.env.DB.prepare(
    `SELECT pc.id, pc.status, pc.formato, pc.rodada, pc.versao, pc.erro, pc.created_at, pc.updated_at, pa.titulo,
            pc.pauta_id, pa.status AS pauta_status,
            json_extract(pc.conteudo_json, '$.manchete') AS manchete, json_extract(pc.validacao_json, '$.ok') AS validacao_ok,
            (SELECT e.iniciado_em FROM execucoes e WHERE e.id = pc.workflow_id AND e.tenant_id = pc.tenant_id) AS iniciada_em,
            pc.agendado_para, co.modo AS conta_modo, co.nome AS conta_nome, co.external_id AS conta_external_id,
            pu.status AS publicacao_status, pu.url AS publicacao_url, pu.publicado_em, pu.modo AS publicacao_modo
       FROM pecas pc JOIN pautas pa ON pa.id = pc.pauta_id AND pa.tenant_id = pc.tenant_id
       LEFT JOIN contas_sociais co ON co.id = pc.conta_id AND co.tenant_id = pc.tenant_id
       -- A última tentativa de publicar (Postado: o link; falha de publicação: a tela diz que foi ao postar).
       LEFT JOIN publicacoes pu ON pu.id = (SELECT p2.id FROM publicacoes p2 WHERE p2.peca_id = pc.id AND p2.tenant_id = pc.tenant_id
                                             ORDER BY p2.created_at DESC, p2.rowid DESC LIMIT 1)
      WHERE pc.id = ? AND pc.tenant_id = ?`,
  ).bind(id, tenantId).first<{
    id: string; status: string; formato: string; rodada: number; versao: number; erro: string | null; created_at: string;
    pauta_id: string; pauta_status: string;
    updated_at: string; titulo: string; manchete: string | null; validacao_ok: number | null; iniciada_em: string | null;
    agendado_para: string | null; conta_modo: string | null; conta_nome: string | null; conta_external_id: string | null;
    publicacao_status: string | null; publicacao_url: string | null; publicado_em: string | null; publicacao_modo: string | null;
  }>();
  if (!pc) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  let andamento: ReturnType<typeof etapaProducao> | null = null;
  if (pc.status === 'rascunho') {
    const [versoes, ilustrou] = await c.env.DB.batch<{ versao?: number; ok?: number }>([
      c.env.DB.prepare('SELECT versao FROM peca_versoes WHERE peca_id = ? AND tenant_id = ? AND rodada = ?').bind(id, tenantId, pc.rodada),
      c.env.DB.prepare(`SELECT 1 AS ok FROM eventos WHERE ref_tipo = 'peca' AND ref_id = ? AND tenant_id = ?
                          AND tipo IN ('peca.ilustracao', 'peca.ilustracao_falhou') AND json_extract(payload_json, '$.versao') = ? LIMIT 1`)
        .bind(id, tenantId, pc.versao),
    ]);
    andamento = etapaProducao({
      versaoExibida: pc.versao, versoesDaRodada: versoes.results.map((v) => Number(v.versao)),
      validacaoOk: pc.validacao_ok === null ? null : pc.validacao_ok === 1, ilustrou: ilustrou.results.length > 0, reels: pc.formato === 'reels',
    });
  }
  const { validacao_ok: _ok, ...peca } = pc;
  return c.json({ ...peca, etapa: andamento?.etapa ?? null, tentativa: andamento?.tentativa ?? null });
})

// Peça + artes com URL assinada (1 h) + eventos, decisões e publicações.
.get('/t/:tenantId/pecas/:id', async (c) => {
  const tenantId = c.get('tenant').id;
  const id = c.req.param('id');
  const peca = await c.env.DB.prepare('SELECT * FROM pecas WHERE id = ? AND tenant_id = ?').bind(id, tenantId).first<Record<string, unknown>>();
  if (!peca) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  const workflow = peca.workflow_id
    ? await c.env.PRODUCAO_WORKFLOW.get(peca.workflow_id as string).then((i) => i.status()).catch(() => null)
    : null;
  const artes = peca.arte_r2_keys_json
    ? await Promise.all((JSON.parse(peca.arte_r2_keys_json as string) as ArteRenderizada[]).map(async (a) => ({
        papel: a.papel, id: a.id ?? null, hash: a.hash ?? null, png: await assinarMedia(c.env, a.png, 3600), jpg: await assinarMedia(c.env, a.jpg, 3600),
        // Reels: o MP4 (a capa é o png/jpg).
        mp4: (a as Partial<ArteReels>).mp4 ? await assinarMedia(c.env, (a as ArteReels).mp4, 3600) : null,
        duracao: (a as Partial<ArteReels>).duracao ?? null,
      })))
    : [];
  const conteudoPeca = peca.conteudo_json ? (JSON.parse(peca.conteudo_json as string) as { cards?: Card[]; estilo?: EstiloPeca }) : {};
  // Em revisão (a edição do carrossel) e aprovada (a prévia em pé de Fazer o Reels).
  const previa = peca.status === 'revisao' || peca.status === 'aprovada'
    ? await previaDaPeca(c.env, tenantId, { id, pauta_id: peca.pauta_id as string }, conteudoPeca.cards ?? [], peca.arte_r2_keys_json ? JSON.parse(peca.arte_r2_keys_json as string) : [], conteudoPeca.estilo)
    : null;
  const modelo = peca.status === 'revisao' ? await situacaoDoEstilo(c.env, tenantId, conteudoPeca.estilo) : null;
  const [eventos, decisoes, publicacoes, pauta, fatos] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT id, tipo, payload_json, created_at FROM eventos WHERE tenant_id = ? AND ref_tipo = 'peca' AND ref_id = ? ORDER BY id").bind(tenantId, id),
    c.env.DB.prepare('SELECT versao, decisao, por, payload_json, created_at FROM decisoes WHERE tenant_id = ? AND peca_id = ? ORDER BY created_at').bind(tenantId, id),
    c.env.DB.prepare('SELECT id, conta_id, rede, modo, external_id, url, publicado_em, status, erro FROM publicacoes WHERE tenant_id = ? AND peca_id = ? ORDER BY created_at').bind(tenantId, id),
    c.env.DB.prepare('SELECT titulo, editoria, bairro, tipo_post, origem FROM pautas WHERE id = ? AND tenant_id = ?').bind(peca.pauta_id, tenantId),
    // Fatos da pauta, na ordem dela, com a fonte e o link do documento (revisão: "fatos usados"). Do print trazido pelo
    // + Nova, a própria imagem (o texto foi lido por um modelo: o revisor confere com ela).
    c.env.DB.prepare(
      `SELECT f.id, f.tipo, f.texto, d.url, fo.nome AS fonte, d.titulo AS fonte_titulo, f.evidencia_trecho AS evidencia, CASE WHEN d.url LIKE 'print:%' THEN d.r2_bruto END AS print_r2
         FROM pautas pa JOIN json_each(pa.fato_ids_json) j
         JOIN fatos f ON f.id = j.value AND f.tenant_id = pa.tenant_id
         LEFT JOIN documentos d ON d.id = f.documento_id AND d.tenant_id = f.tenant_id
         LEFT JOIN fontes fo ON fo.id = d.fonte_id AND fo.tenant_id = f.tenant_id
        WHERE pa.id = ? AND pa.tenant_id = ?
        ORDER BY j.key`,
    ).bind(peca.pauta_id, tenantId),
  ]);
  const json = (s: unknown) => (s ? JSON.parse(s as string) : null);
  return c.json({
    peca: { ...peca, conteudo_json: undefined, arte_r2_keys_json: undefined, validacao_json: undefined, conteudo: json(peca.conteudo_json) ?? {}, validacao: json(peca.validacao_json) },
    artes, workflow, previa, modelo,
    pauta: (pauta.results[0] ?? null) as { titulo: string; editoria: string | null; bairro: string | null } | null,
    fatos: await Promise.all((fatos.results as { id: string; tipo: string | null; texto: string; url: string | null; fonte: string | null; fonte_titulo: string | null; evidencia: string | null; print_r2: string | null }[])
      // Matéria: o trecho da evidência que sustenta a frase do autor e o título da página (a Revisão mostra por frase).
      .map(async ({ print_r2, fonte_titulo, ...f }) => ({ ...f, fonteTitulo: f.evidencia ? fonte_titulo : null, print: print_r2 ? await assinarMedia(c.env, print_r2, 3600) : null }))),
    eventos: (eventos.results as Record<string, unknown>[]).map((e) => ({ id: e.id, tipo: e.tipo, em: e.created_at, payload: json(e.payload_json) })),
    decisoes: (decisoes.results as Record<string, unknown>[]).map((d) => ({ ...d, payload_json: undefined, payload: json(d.payload_json) })),
    publicacoes: publicacoes.results,
  });
})

// Pacote pra publicar à mão (ou pra um intermediário): JPEGs assinados por 24 h + legenda pronta.
.get('/t/:tenantId/pecas/:id/pacote', async (c) => {
  const pacote = await pacoteDePublicacao(c.env, c.get('tenant').id, c.req.param('id'));
  return pacote ? c.json(pacote) : c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
})
.get('/t/:tenantId/pecas/:id/legenda.txt', async (c) => {
  const pacote = await pacoteDePublicacao(c.env, c.get('tenant').id, c.req.param('id'));
  return pacote ? c.text(pacote.legenda) : c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
})

// Biblioteca de música do Reels (src/lib/musica.ts): título, autor e licença com o link. A chave do R2 fica no servidor.
.get('/t/:tenantId/musicas', async (c) => {
  const faixas = await bibliotecaMusical(c.env);
  return c.json({ musicas: faixas.map(({ id, titulo, autor, licenca, licencaUrl }) => ({ id, titulo, autor, licenca, licencaUrl })) });
})

// Fazer o Reels de um carrossel (editor para cima): post novo no formato reels, com o texto da versão que está na tela,
// produzido pelo ProducaoWorkflow (passo do Container). A pauta não muda: quem a leva é o carrossel.
.get('/t/:tenantId/pecas/:id/narracao', async (c) => {
  const tenantId = c.get('tenant').id;
  const peca = await c.env.DB.prepare('SELECT versao FROM pecas WHERE id = ? AND tenant_id = ?').bind(c.req.param('id'), tenantId).first<{ versao: number }>();
  if (!peca) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  const n = await narracaoDaVersao(c.env, tenantId, c.req.param('id'), peca.versao);
  return c.json({ narracao: n ? narracaoParaTela(n) : null });
})
.post('/t/:tenantId/pecas/:id/narracao', requireMembro('editor'), async (c) => {
  const tenantId = c.get('tenant').id;
  const pecaId = c.req.param('id');
  const peca = await c.env.DB.prepare('SELECT status, versao, formato FROM pecas WHERE id = ? AND tenant_id = ?').bind(pecaId, tenantId).first<{ status: string; versao: number; formato: string }>();
  if (!peca) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  if (peca.formato !== 'carrossel') return c.json({ erro: t(c, 'a voz vai num Reels de carrossel', 'the voice goes on a carousel Reel') }, 400);
  if (peca.status !== 'revisao' && peca.status !== 'aprovada') return c.json({ erro: t(c, 'o Reels sai de um carrossel em revisão ou aprovado', 'a Reel is made from a carousel that is in review or approved') }, 409);
  const bytes = await lerCorpoAte(c.req.raw.body, NARRACAO_MAX_BYTES);
  if (!bytes) return c.json({ erro: t(c, 'a fala passa de 10 MB', 'the voice file is over 10 MB') }, 422);
  const id = await receberNarracao(c.env, tenantId, pecaId, peca.versao, c.get('user').id, bytes);
  if (!id) return c.json({ erro: t(c, 'esse arquivo não é um áudio que o app lê', "that file isn't audio the app reads") }, 422);
  return c.json({ id }, 201);
})
.post('/t/:tenantId/pecas/:id/narracao/:narracao/avisos/:indice', requireMembro('editor'), async (c) => {
  const avisos = await decidirAviso(c.env, c.get('tenant').id, c.req.param('id'), c.req.param('narracao'), Number(c.req.param('indice')));
  if (!avisos) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  return c.json({ avisos });
})
.get('/t/:tenantId/pecas/:id/narracao/:narracao/audio', async (c) => {
  const n = await narracaoPorId(c.env, c.get('tenant').id, c.req.param('id'), c.req.param('narracao'));
  const obj = n ? await c.env.MEDIA.get(n.r2) : null;
  if (!n || !obj) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  return new Response(obj.body, { headers: { 'content-type': n.mime, 'cache-control': 'private, no-store' } });
})
.post('/t/:tenantId/pecas/:id/reels', requireMembro('editor'), async (c) => {
  const tenantId = c.get('tenant').id;
  const origemId = c.req.param('id');
  const b = await lerJson<{ musica: unknown; versao: unknown; passo: unknown; movimento: unknown; narracao: unknown }>(c);
  if (!Number.isInteger(b.versao)) return c.json({ erro: t(c, 'versao: inteiro (a versão do carrossel que está na tela)', 'versao: integer (the carousel version on screen)') }, 400);
  if (b.passo !== undefined && !PASSOS_REELS.includes(b.passo as never)) return c.json({ erro: t(c, `passo: ${PASSOS_REELS.join(', ')}`, `pace: ${PASSOS_REELS.join(', ')}`) }, 400);
  if (b.movimento !== undefined && !MOVIMENTOS_REELS.includes(b.movimento as never)) return c.json({ erro: t(c, `movimento: ${MOVIMENTOS_REELS.join(', ')}`, `motion: ${MOVIMENTOS_REELS.join(', ')}`) }, 400);
  const origem = await c.env.DB.prepare("SELECT id, pauta_id, status, versao, formato, json_extract(validacao_json, '$.ok') AS ok, json_extract(conteudo_json, '$.estilo.params.reels') AS reels, arte_r2_keys_json FROM pecas WHERE id = ? AND tenant_id = ?")
    .bind(origemId, tenantId).first<{ id: string; pauta_id: string; status: string; versao: number; formato: string; ok: number | null; reels: string | null; arte_r2_keys_json: string | null }>();
  if (!origem) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  if (origem.formato !== 'carrossel') return c.json({ erro: t(c, 'o Reels sai de um carrossel', 'a Reel is made from a carousel') }, 400);
  if (origem.status !== 'revisao' && origem.status !== 'aprovada') return c.json({ erro: t(c, `o Reels sai de um carrossel em revisão ou aprovado; este está em ${origem.status}`, `a Reel is made from a carousel in review or approved; this one is ${origem.status}`) }, 409);
  if (origem.ok === 0) return c.json({ erro: t(c, 'a conferência apontou problema num card do carrossel; corrija antes de fazer o Reels', 'the check found a problem in a carousel card; fix it before making the Reel') }, 409);
  // A versão que a pessoa viu: se outra pessoa salvou depois, o Reels não sai de um texto que ela não leu.
  if (b.versao !== origem.versao) return c.json({ erro: t(c, `o carrossel está na versão ${origem.versao}, não na ${b.versao}: outra pessoa salvou antes; abra de novo`, `the carousel is at version ${origem.versao}, not ${b.versao}: someone else saved first; open it again`) }, 409);
  const artes = origem.arte_r2_keys_json ? (JSON.parse(origem.arte_r2_keys_json) as ArteRenderizada[]) : [];
  if (!artes.length) return c.json({ erro: t(c, 'o carrossel ainda não tem os cards montados', "the carousel's cards haven't been built yet") }, 409);
  // Pedido repetido (duplo toque, rede que reenviou): um Reels deste carrossel sendo montado basta.
  const andando = await c.env.DB.prepare(
    "SELECT ref_id FROM execucoes WHERE tenant_id = ? AND tipo = 'producao' AND status = 'rodando' AND json_extract(params_json, '$.origem.pecaId') = ? LIMIT 1",
  ).bind(tenantId, origemId).first<{ ref_id: string }>();
  if (andando) return c.json({ erro: t(c, 'já há um Reels deste carrossel sendo montado', 'a Reel of this carousel is already being built'), pecaId: andando.ref_id }, 409);
  let musica: string | null = null;
  if (b.musica !== undefined && b.musica !== null) {
    if (typeof b.musica !== 'string' || !(await bibliotecaMusical(c.env)).some((m) => m.id === b.musica)) return c.json({ erro: t(c, 'musica: uma faixa da biblioteca, ou null', 'musica: a track from the library, or null') }, 400);
    musica = b.musica;
  }
  // Com voz: a fala desta versão, transcrita, com cada aviso decidido por uma pessoa.
  let narracao: string | null = null;
  if (b.narracao !== undefined && b.narracao !== null) {
    const n = typeof b.narracao === 'string' ? await narracaoPorId(c.env, tenantId, origemId, b.narracao) : null;
    if (!n) return c.json({ erro: t(c, 'narração não encontrada', 'voice recording not found') }, 404);
    if (n.versao !== origem.versao) return c.json({ erro: t(c, 'o carrossel mudou depois da gravação; grave de novo', 'the carousel changed after the recording; record it again') }, 409);
    if (n.estado !== 'pronto') return c.json({ erro: t(c, 'a fala ainda não foi conferida', "the voice hasn't been checked yet") }, 409);
    if (n.avisos.some((a) => !a.decisao)) return c.json({ erro: t(c, 'há aviso da fala sem decisão', 'there are voice warnings without a decision') }, 409);
    narracao = n.id;
  }
  // O que a tela mandou; sem isso, o que o modelo do carrossel guardou.
  const doModelo: RitmoReels = { ...RITMO_PADRAO, ...(origem.reels ? JSON.parse(origem.reels) as RitmoReels : {}) };
  const ritmo: RitmoReels = { passo: (b.passo as PassoReels | undefined) ?? doModelo.passo, movimento: (b.movimento as MovimentoReels | undefined) ?? doModelo.movimento };
  const pecaId = novoId();
  const execucaoId = idProducao(pecaId, 1);
  // Arte e ilustração congeladas aqui, com o texto: uma edição do carrossel depois do pedido não mistura versões.
  const params: ProducaoParams = {
    tenantId, pautaId: origem.pauta_id, pecaId, formato: 'reels', rodada: 1, musica, ritmo, narracao,
    origem: {
      pecaId: origemId, versao: origem.versao, capa: { png: artes[0].png, jpg: artes[0].jpg },
      ilustracao: (await ilustracaoAtual(c.env, tenantId, origemId, artes)) ?? null, em: new Date().toISOString(),
    },
  };
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO pecas (id, tenant_id, pauta_id, formato, rodada, workflow_id) VALUES (?, ?, ?, 'reels', 1, ?)").bind(pecaId, tenantId, origem.pauta_id, execucaoId),
    iniciarExecucao(c.env, { id: execucaoId, tenantId, tipo: 'producao', refTipo: 'peca', refId: pecaId, params }),
  ]);
  await registrarEvento(c.env, tenantId, 'peca.reels_pedido', 'peca', origemId, { reels: pecaId, versao: origem.versao, musica, ritmo, narracao, por: c.get('user').id });
  const erro = await iniciarProducao(c.env, params);
  if (erro) return c.json({ pecaId, workflowId: execucaoId, pendente: true, aviso: PENDENTE }, 202);
  return c.json({ pecaId, workflowId: execucaoId }, 201);
})

// Edição do carrossel na Revisão (editor para cima): versão nova com os cards editados, revalidada; só os cards que
// mudaram são montados de novo. `versao` é a que está na tela: outra pessoa salvou antes → 409.
.put('/t/:tenantId/pecas/:id/cards', requireMembro('editor'), async (c) => {
  const b = await lerJson<{ versao: number; cards: unknown; manchete: unknown }>(c);
  const r = await editarCards(c.env, { tenantId: c.get('tenant').id, pecaId: c.req.param('id'), por: c.get('user').id, versao: b.versao, cards: b.cards, manchete: b.manchete, idioma: idiomaDe(c) });
  if (!r.ok) return c.json({ erro: r.erro }, r.status);
  return c.json({ versao: r.versao, validacao: r.validacao, renderizados: r.renderizados, reaproveitados: r.reaproveitados });
})

// Post do anunciante: o estado da aprovação (Revisão), o link que o editor copia e o comprovante da peça publicada.
.get('/t/:tenantId/pecas/:id/anuncio', async (c) => {
  const tenantId = c.get('tenant').id;
  const peca = await pecaDeAnuncio(c.env, tenantId, c.req.param('id'));
  if (!peca) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  return c.json({ anunciante: peca.anunciante, ...(await estadoAprovacao(c.env, tenantId, peca)) });
})
.post('/t/:tenantId/pecas/:id/anuncio/link', requireMembro('editor'), async (c) => {
  const tenantId = c.get('tenant').id;
  const peca = await pecaDeAnuncio(c.env, tenantId, c.req.param('id'));
  if (!peca) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  if (!['revisao', 'aprovada', 'agendada'].includes(peca.status)) return c.json({ erro: t(c, `peça em ${peca.status}: não dá para pedir aprovação`, `post is ${peca.status}: approval can't be requested`) }, 409);
  return c.json(await criarLink(c.env, tenantId, peca, c.get('user').id), 201);
})
.put('/t/:tenantId/pecas/:id/estilo', requireMembro('editor'), async (c) => {
  const b = await lerJson<{ versao?: unknown; estiloId?: unknown }>(c);
  const r = await aplicarEstilo(c.env, { tenantId: c.get('tenant').id, pecaId: c.req.param('id'), por: c.get('user').id, versao: b.versao, estiloId: b.estiloId ?? null, idioma: idiomaDe(c) });
  if (!r.ok) return c.json({ erro: r.erro }, r.status);
  return c.json(r);
})
.get('/t/:tenantId/pecas/:id/comprovante', requireMembro('editor'), async (c) => {
  const id = c.req.param('id');
  const dados = await dadosComprovante(c.env, c.get('tenant').id, id);
  if (!dados) return c.json({ erro: t(c, 'o comprovante sai de um anúncio publicado', 'the proof comes from a published ad') }, 404);
  const html = htmlComprovante(dados);
  if (c.req.query('html') === '1') return c.html(html);
  const pdf = await gerarPdf(c.env, html);
  return new Response(pdf, { headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="comprovante-${id.slice(0, 8)}.pdf"`, 'cache-control': 'no-store' } });
})

// Gancho conferido (editor para cima): três manchetes por ângulo, cada uma revalidada numa cópia. Nada é gravado; a
// escolhida vai pelo PUT cards. O custo entra na peça e no teto dela.
.post('/t/:tenantId/pecas/:id/ajuste', requireMembro('editor'), async (c) => {
  const tenantId = c.get('tenant').id;
  const pecaId = c.req.param('id');
  const b = await lerJson<{ versao: unknown; cardId: unknown; frase: unknown }>(c);
  if (!Number.isInteger(b.versao)) return c.json({ erro: t(c, 'versao: inteiro (a versão que está na tela)', 'versao: integer (the version on screen)') }, 400);
  const peca = await c.env.DB.prepare('SELECT status, versao, formato, pauta_id, conteudo_json, custo_usd FROM pecas WHERE id = ? AND tenant_id = ?')
    .bind(pecaId, tenantId).first<{ status: string; versao: number; formato: string; pauta_id: string; conteudo_json: string; custo_usd: number }>();
  if (!peca) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  if (peca.formato !== 'post' && peca.formato !== 'carrossel') return c.json({ erro: t(c, 'ajuste só para post e carrossel', 'shortening is only for posts and carousels') }, 400);
  if (peca.status !== 'revisao') return c.json({ erro: t(c, `peça em ${peca.status}, não em revisão`, `post is ${peca.status}, not in review`) }, 409);
  if (b.versao !== peca.versao) return c.json({ erro: t(c, `peça na versão ${peca.versao}, não na ${b.versao}: outra pessoa salvou antes`, `post is at version ${peca.versao}, not ${b.versao}: someone else saved first`) }, 409);
  if (peca.custo_usd >= tetoPecaUsd(c.env)) return c.json({ erro: t(c, 'esta peça chegou ao teto de custo; encurte à mão', 'this post reached its cost cap; shorten it by hand') }, 409);
  const pauta = await carregarPauta(c.env, tenantId, peca.pauta_id);
  const rascunho = JSON.parse(peca.conteudo_json) as Rascunho;
  const alvo = alvoDoAjuste(pauta, rascunho, b.cardId, b.frase);
  if (alvo === 'nao_encontrado') return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  if (alvo === 'fora') return c.json({ erro: t(c, 'este texto não se encurta aqui: citação, convite e afirmação do autor ficam como estão', "this text can't be shortened here: quotes, invite cards and the author's own claims stay as they are") }, 400);
  let saida: Awaited<ReturnType<typeof gerarAjuste>>;
  try {
    saida = await gerarAjuste(c.env, pauta, rascunho, peca.formato, alvo);
  } catch {
    return c.json({ erro: t(c, 'não deu para encurtar agora; tente de novo', "couldn't shorten it right now; try again") }, 502);
  }
  await c.env.DB.batch([
    eventoStmt(c.env, { tenantId, tipo: 'peca.ajuste', refTipo: 'peca', refId: pecaId, payload: { versao: peca.versao, cardId: alvo.card.id, frase: alvo.indice, aprovadas: saida.opcoes.length, reprovadas: saida.reprovadas, custoUsd: saida.custoUsd, por: c.get('user').id } }),
    c.env.DB.prepare('UPDATE pecas SET custo_usd = custo_usd + ? WHERE id = ? AND tenant_id = ?').bind(saida.custoUsd, pecaId, tenantId),
  ]);
  return c.json({ opcoes: saida.opcoes, reprovadas: saida.reprovadas, custoUsd: saida.custoUsd });
})
// Outra ilustração para um card (editor para cima): nada é gravado na peça. A escolhida vai pelo PUT cards, e o custo entra
// na peça e no teto dela.
.post('/t/:tenantId/pecas/:id/cards/:cardId/ilustracao', requireMembro('editor'), async (c) => {
  const tenantId = c.get('tenant').id;
  const pecaId = c.req.param('id');
  const b = await lerJson<{ versao: unknown }>(c);
  if (!Number.isInteger(b.versao)) return c.json({ erro: t(c, 'versao: inteiro (a versão que está na tela)', 'versao: integer (the version on screen)') }, 400);
  const peca = await c.env.DB.prepare('SELECT status, versao, formato, pauta_id, conteudo_json, custo_usd FROM pecas WHERE id = ? AND tenant_id = ?')
    .bind(pecaId, tenantId).first<{ status: string; versao: number; formato: string; pauta_id: string; conteudo_json: string; custo_usd: number }>();
  if (!peca) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  if (peca.formato !== 'post' && peca.formato !== 'carrossel') return c.json({ erro: t(c, 'ilustração por card só para post e carrossel', 'card illustrations are only for posts and carousels') }, 400);
  if (peca.status !== 'revisao') return c.json({ erro: t(c, `peça em ${peca.status}, não em revisão`, `post is ${peca.status}, not in review`) }, 409);
  if (b.versao !== peca.versao) return c.json({ erro: t(c, `peça na versão ${peca.versao}, não na ${b.versao}: outra pessoa salvou antes`, `post is at version ${peca.versao}, not ${b.versao}: someone else saved first`) }, 409);
  const rascunho = JSON.parse(peca.conteudo_json) as Rascunho;
  const card = normalizarCards(rascunho.cards).find((x) => x.id === c.req.param('cardId'));
  if (!card) return c.json({ erro: t(c, 'salve o card antes de pedir outra ilustração', 'save the card before asking for another illustration') }, 404);
  if (!levaArte(card, rascunho.estilo?.params.composicao)) return c.json({ erro: t(c, 'este card não leva ilustração', "this card doesn't use an illustration") }, 400);
  if (peca.custo_usd >= tetoPecaUsd(c.env)) return c.json({ erro: t(c, 'esta peça chegou ao teto de custo; suba uma foto', 'this post reached its cost cap; upload a photo') }, 409);
  const feitas = await ilustracoesDoCard(c.env, tenantId, pecaId, card.id);
  if (feitas >= MAX_ILUSTRACOES_CARD) return c.json({ erro: t(c, `este card já teve ${MAX_ILUSTRACOES_CARD} ilustrações; suba uma foto`, `this card already had ${MAX_ILUSTRACOES_CARD} illustrations; upload a photo`) }, 409);
  const pauta = await carregarPauta(c.env, tenantId, peca.pauta_id);
  let nova: Awaited<ReturnType<typeof ilustrarCard>>;
  try {
    nova = await ilustrarCard(c.env, { tenantId, pecaId, pauta, rascunho, card, custoAtualUsd: peca.custo_usd });
  } catch {
    return c.json({ erro: t(c, 'nenhuma ilustração passou na conferência; tente de novo', 'no illustration passed the check; try again') }, 502);
  }
  await c.env.DB.batch([
    eventoStmt(c.env, { tenantId, tipo: 'peca.ilustracao_card', refTipo: 'peca', refId: pecaId, payload: { versao: peca.versao, cardId: card.id, r2Key: nova.r2Key, provedor: nova.provedor, custoUsd: nova.custoUsd, ...(nova.fallbackDe ? { fallbackDe: nova.fallbackDe } : {}) } }),
    c.env.DB.prepare('UPDATE pecas SET custo_usd = custo_usd + ? WHERE id = ? AND tenant_id = ?').bind(nova.custoUsd, pecaId, tenantId),
  ]);
  return c.json({ chave: nova.r2Key, url: await assinarMedia(c.env, nova.r2Key, 3600), restantes: MAX_ILUSTRACOES_CARD - feitas - 1, custoUsd: nova.custoUsd });
})
.post('/t/:tenantId/pecas/:id/ganchos', requireMembro('editor'), async (c) => {
  const tenantId = c.get('tenant').id;
  const pecaId = c.req.param('id');
  const b = await lerJson<{ versao: unknown }>(c);
  if (!Number.isInteger(b.versao)) return c.json({ erro: t(c, 'versao: inteiro (a versão que está na tela)', 'versao: integer (the version on screen)') }, 400);
  const peca = await c.env.DB.prepare('SELECT status, versao, formato, pauta_id, conteudo_json, custo_usd FROM pecas WHERE id = ? AND tenant_id = ?')
    .bind(pecaId, tenantId).first<{ status: string; versao: number; formato: string; pauta_id: string; conteudo_json: string; custo_usd: number }>();
  if (!peca) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  if (peca.formato !== 'post' && peca.formato !== 'carrossel') return c.json({ erro: t(c, 'manchetes só para post e carrossel', 'headlines are only for posts and carousels') }, 400);
  if (peca.status !== 'revisao') return c.json({ erro: t(c, `peça em ${peca.status}, não em revisão`, `post is ${peca.status}, not in review`) }, 409);
  if (b.versao !== peca.versao) return c.json({ erro: t(c, `peça na versão ${peca.versao}, não na ${b.versao}: outra pessoa salvou antes`, `post is at version ${peca.versao}, not ${b.versao}: someone else saved first`) }, 409);
  if (peca.custo_usd >= tetoPecaUsd(c.env)) return c.json({ erro: t(c, 'esta peça chegou ao teto de custo; escreva a manchete à mão', 'this post reached its cost cap; write the headline by hand') }, 409);
  const pauta = await carregarPauta(c.env, tenantId, peca.pauta_id);
  const rascunho = JSON.parse(peca.conteudo_json) as Rascunho;
  let saida: Awaited<ReturnType<typeof gerarGanchos>>;
  try {
    saida = await gerarGanchos(c.env, pauta, rascunho, peca.formato);
  } catch {
    return c.json({ erro: t(c, 'não deu para gerar as manchetes agora; tente de novo', "couldn't generate the headlines right now; try again") }, 502);
  }
  await c.env.DB.batch([
    eventoStmt(c.env, { tenantId, tipo: 'peca.ganchos', refTipo: 'peca', refId: pecaId, payload: { versao: peca.versao, aprovadas: saida.opcoes.length, reprovadas: saida.reprovadas, custoUsd: saida.custoUsd, por: c.get('user').id } }),
    c.env.DB.prepare('UPDATE pecas SET custo_usd = custo_usd + ? WHERE id = ? AND tenant_id = ?').bind(saida.custoUsd, pecaId, tenantId),
  ]);
  return c.json({ opcoes: saida.opcoes, reprovadas: saida.reprovadas, custoUsd: saida.custoUsd });
})

// Foto própria para um card (editor para cima): JPEG (a do celular, já reduzida na web), PNG ou SVG, até 2 MB, no corpo cru.
// Fica sob a peça (fotos/<veículo>/<peça>/…): o card só aceita foto subida para ela. Nada de buscar imagem na web.
.post('/t/:tenantId/pecas/:id/fotos', requireMembro('editor'), async (c) => {
  const tenantId = c.get('tenant').id;
  const pecaId = c.req.param('id');
  const peca = await c.env.DB.prepare('SELECT status FROM pecas WHERE id = ? AND tenant_id = ?').bind(pecaId, tenantId).first<{ status: string }>();
  if (!peca) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  if (peca.status !== 'revisao') return c.json({ erro: t(c, `peça em ${peca.status}, não em revisão`, `post is ${peca.status}, not in review`) }, 409);
  const tipo = (c.req.header('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (tipo !== 'image/jpeg' && tipo !== 'image/png' && tipo !== 'image/svg+xml') return c.json({ erro: t(c, 'foto: JPEG, PNG ou SVG', 'photo: JPEG, PNG or SVG') }, 415);
  if (Number(c.req.header('content-length') ?? 0) > FOTO_MAX_BYTES) return c.json({ erro: t(c, 'foto: até 2 MB', 'photo: up to 2 MB') }, 413);
  const bytes = await lerCorpoAte(c.req.raw.body, FOTO_MAX_BYTES);
  if (!bytes) return c.json({ erro: t(c, 'foto: até 2 MB', 'photo: up to 2 MB') }, 413);
  let corpo: Uint8Array | string = bytes;
  if (tipo === 'image/png' && !ehPng(bytes)) return c.json({ erro: t(c, 'arquivo não é PNG', 'file is not a PNG') }, 400);
  if (tipo === 'image/jpeg' && !ehJpeg(bytes)) return c.json({ erro: t(c, 'arquivo não é JPEG', 'file is not a JPEG') }, 400);
  if (tipo === 'image/svg+xml') {
    const limpo = sanitizarSvg(new TextDecoder().decode(bytes));
    if (!limpo) return c.json({ erro: t(c, 'SVG inválido ou sem desenho', 'invalid SVG or no drawing') }, 400);
    corpo = limpo;
  }
  const chave = `${prefixoFotos(tenantId, pecaId)}${novoId()}.${({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/svg+xml': 'svg' })[tipo]}`;
  await c.env.MEDIA.put(chave, corpo, { httpMetadata: { contentType: tipo } });
  return c.json({ chave, url: await assinarMedia(c.env, chave, 3600) }, 201);
})

/**
 * Revisão humana: grava `decisoes` e transita no mesmo batch.
 * aprovar   → conta manual: peça aprovada/agendada e para aí (operador confirma em /publicada);
 *             outra conta: cria PublicacaoWorkflow.
 * reescrever → rodada seguinte de ProducaoWorkflow com a instrução.
 * rejeitar  → peça rejeitada, pauta descartada.
 */
.post('/t/:tenantId/pecas/:id/revisao', requireMembro('editor'), async (c) => {
  const tenantId = c.get('tenant').id;
  const por = c.get('user').id;
  const b = await lerJson<{ decisao: string; agendarPara: string; contaId: string; instrucao: string; motivo: string; versao: number }>(c);
  if (!pertence(DECISOES, b.decisao)) return c.json({ erro: `decisao: ${DECISOES.join(' | ')}` }, 400);
  if (b.versao !== undefined && !Number.isInteger(b.versao)) return c.json({ erro: t(c, 'versao: inteiro', 'versao: integer') }, 400);
  const decisao = b.decisao;
  const pecaId = c.req.param('id');
  const peca = await c.env.DB.prepare("SELECT id, pauta_id, status, versao, rodada, formato, json_extract(validacao_json, '$.ok') AS validacao_ok FROM pecas WHERE id = ? AND tenant_id = ?")
    .bind(pecaId, tenantId).first<{ id: string; pauta_id: string; status: string; versao: number; rodada: number; formato: string; validacao_ok: number | null }>();
  if (!peca) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  if (peca.status !== 'revisao') return c.json({ erro: t(c, `peça em ${peca.status}, não em revisão`, `post is ${peca.status}, not in review`) }, 409);
  // Quem decide manda a versão que viu: se outra chegou (reescrita concluída no meio), a decisão não vale para ela.
  if (b.versao !== undefined && b.versao !== peca.versao) return c.json({ erro: t(c, `peça na versão ${peca.versao}, não na ${b.versao}`, `post is at version ${peca.versao}, not ${b.versao}`) }, 409);

  const registrar = (payload: Record<string, unknown>) =>
    c.env.DB.prepare('INSERT INTO decisoes (id, tenant_id, peca_id, versao, decisao, por, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(novoId(), tenantId, pecaId, peca.versao, decisao, por, JSON.stringify(payload));
  const conflito = () => c.json({ erro: t(c, 'peça mudou de estado durante a revisão', 'post changed state during review') }, 409);

  if (decisao === 'rejeitar') {
    const motivo = b.motivo?.slice(0, 500) ?? null;
    const ts: Transicao[] = [{ tipo: 'peca', id: pecaId, tenantId, para: 'rejeitada', por, motivo, dados: { decisao, versao: peca.versao }, batch: [registrar({ motivo })] }];
    const pauta = await c.env.DB.prepare('SELECT status FROM pautas WHERE id = ? AND tenant_id = ?').bind(peca.pauta_id, tenantId).first<{ status: string }>();
    // Rejeitar o Reels não descarta a pauta: ela segue com o carrossel de origem.
    if (pauta?.status === 'em_producao' && peca.formato !== 'reels') ts.push({ tipo: 'pauta', id: peca.pauta_id, tenantId, para: 'descartada', por, motivo });
    const { mudou } = await transitar(c.env, ts);
    return mudou ? c.json({ status: 'rejeitada' }) : conflito();
  }

  if (decisao === 'reescrever') {
    if (peca.formato === 'reels') return c.json({ erro: t(c, 'o Reels não se reescreve: corrija o carrossel e faça outro Reels', "a Reel can't be rewritten: fix the carousel and make another Reel") }, 409);
    if (peca.rodada >= MAX_RODADAS) return c.json({ erro: t(c, `limite de ${MAX_RODADAS} rodadas; aprove ou rejeite`, `limit of ${MAX_RODADAS} rounds; approve or reject`) }, 409);
    const rodada = peca.rodada + 1;
    const execucaoId = idProducao(pecaId, rodada);
    const instrucao = b.instrucao?.trim().slice(0, 1000) || undefined;
    const params = { tenantId, pautaId: peca.pauta_id, pecaId, formato: peca.formato as ProducaoParams['formato'], rodada, ...(instrucao ? { instrucao } : {}) };
    const { mudou } = await transitar(c.env, {
      tipo: 'peca', id: pecaId, tenantId, para: 'rascunho', por, dados: { decisao, versao: peca.versao, rodada, instrucao: instrucao ?? null },
      batch: [
        registrar({ instrucao: instrucao ?? null }),
        c.env.DB.prepare('UPDATE pecas SET rodada = ?, workflow_id = ? WHERE id = ? AND tenant_id = ?').bind(rodada, execucaoId, pecaId, tenantId),
        iniciarExecucao(c.env, { id: execucaoId, tenantId, tipo: 'producao', refTipo: 'peca', refId: pecaId, params }),
      ],
    });
    if (!mudou) return conflito();
    const erro = await iniciarProducao(c.env, params);
    if (erro) return c.json({ status: 'rascunho', rodada, workflowId: execucaoId, pendente: true, aviso: PENDENTE }, 202);
    return c.json({ status: 'rascunho', rodada, workflowId: execucaoId }, 202);
  }

// aprovar
  const r = await aprovarPeca(c.env, { tenantId, por, peca, contaId: b.contaId, agendarPara: b.agendarPara });
  if (!r.ok) {
    if (r.erro === 'conferencia') return c.json({ erro: t(c, 'a conferência apontou problema num card; corrija antes de aprovar', 'the check found a problem in a card; fix it before approving') }, 409);
    if (r.erro === 'data') return c.json({ erro: t(c, 'agendarPara: data ISO inválida', 'agendarPara: invalid ISO date') }, 400);
    if (r.erro === 'reels_intermediario') return c.json({ erro: t(c, 'o Reels ainda não sai pelo intermediário: escolha a conta manual ou a conexão direta', "Reels can't go out through the posting service yet: choose the manual account or the direct connection") }, 400);
    return conflito();
  }
  if (r.modo === 'manual') return c.json({ status: r.status, modo: 'manual' });
  if (r.pendente) return c.json({ status: r.status, modo: r.modo, workflowId: r.workflowId, pendente: true, aviso: PENDENTE }, 202);
  return c.json({ status: r.status, modo: r.modo, workflowId: r.workflowId }, 202);
})

// Conta manual: o operador publicou pelo celular e confirma com a URL (ou id) do post. Sem Workflow.
.post('/t/:tenantId/pecas/:id/publicada', requireMembro('editor'), async (c) => {
  const tenantId = c.get('tenant').id;
  const por = c.get('user').id;
  const b = await lerJson<{ url: string; externalId: string }>(c);
  if (b.url && !/^https?:\/\//.test(b.url)) return c.json({ erro: t(c, 'url deve ser http(s)', 'url must be http(s)') }, 400);
  const pecaId = c.req.param('id');
  const peca = await c.env.DB.prepare('SELECT status, pauta_id, conta_id FROM pecas WHERE id = ? AND tenant_id = ?')
    .bind(pecaId, tenantId).first<{ status: string; pauta_id: string; conta_id: string | null }>();
  if (!peca) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  if (peca.status !== 'aprovada' && peca.status !== 'agendada') return c.json({ erro: t(c, `peça em ${peca.status}; só aprovada/agendada aceita confirmação`, `post is ${peca.status}; only approved or scheduled posts accept confirmation`) }, 409);
  const conta = peca.conta_id
    ? await c.env.DB.prepare('SELECT id, rede, modo FROM contas_sociais WHERE id = ? AND tenant_id = ?').bind(peca.conta_id, tenantId).first<{ id: string; rede: string; modo: string }>()
    : null;
  if (conta?.modo !== 'manual') return c.json({ erro: t(c, 'peça aprovada em conta automática; a publicação é do Workflow', 'post approved on an automatic account; the Workflow does the posting') }, 409);

  const publicacaoId = novoId();
  const externalId = b.externalId ?? b.url ?? null;
  const ts: Transicao[] = [{
    tipo: 'peca', id: pecaId, tenantId, para: 'publicada', por, dados: { publicacaoId, url: b.url ?? null, externalId, modo: 'manual' },
    batch: [c.env.DB.prepare(`INSERT INTO publicacoes (id, tenant_id, peca_id, conta_id, rede, modo, external_id, url, publicado_em, status)
                              VALUES (?, ?, ?, ?, ?, 'manual', ?, ?, datetime('now'), 'publicada')`)
      .bind(publicacaoId, tenantId, pecaId, conta.id, conta.rede, externalId, b.url ?? null)],
  }];
  const pauta = await c.env.DB.prepare('SELECT status FROM pautas WHERE id = ? AND tenant_id = ?').bind(peca.pauta_id, tenantId).first<{ status: string }>();
  if (pauta?.status === 'em_producao') ts.push({ tipo: 'pauta', id: peca.pauta_id, tenantId, para: 'concluida', por });
  const { mudou } = await transitar(c.env, ts);
  if (!mudou) return c.json({ erro: t(c, 'peça já publicada', 'post already published') }, 409);
  await pedirCertidao(c.env, tenantId, pecaId);
  return c.json({ status: 'publicada', publicacaoId });
})

// Certidão de um post publicado. Gerar aqui é para peça que não ganhou na publicação: o documento diz que o carimbo veio depois.
.get('/t/:tenantId/pecas/:id/certidao', requireMembro('editor'), async (c) => {
  const p = await pacoteCertidao(c.env, c.get('tenant').id, c.req.param('id'));
  if (!p) return c.json({ erro: t(c, 'esta peça ainda não tem certidão', "this post doesn't have a certificate yet") }, 404);
  return new Response(p.zip, { headers: { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${p.nome}"`, 'cache-control': 'no-store' } });
})
.post('/t/:tenantId/pecas/:id/certidao', requireMembro('editor'), async (c) => {
  try {
    const r = await emitirCertidao(c.env, c.get('tenant').id, c.req.param('id'), false);
    if (!r) return c.json({ erro: t(c, 'só post publicado tem certidão', 'only a published post has a certificate') }, 404);
    return c.json({ id: r.id, carimboEm: r.carimbo_em, naPublicacao: !!r.na_publicacao });
  } catch (e) {
    if (e instanceof ErroCarimbo) return c.json({ erro: t(c, 'a autoridade de carimbo não respondeu; tente de novo mais tarde', "the timestamp authority didn't answer; try again later") }, 503);
    throw e;
  }
})

// Kit "Se a conta cair": o caso aberto, com os dias contados na tela, e as certidões do mês.
.get('/t/:tenantId/kit', async (c) => {
  const tenantId = c.get('tenant').id;
  const [casos, certidoes] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT id, tipo, aberto_em, prazo_em, nota FROM kit_casos WHERE tenant_id = ? ORDER BY aberto_em DESC, id').bind(tenantId),
    c.env.DB.prepare(`SELECT ce.peca_id, ce.carimbo_em, ce.erro, ce.na_publicacao, json_extract(pc.conteudo_json, '$.manchete') AS manchete
                        FROM certidoes ce JOIN pecas pc ON pc.id = ce.peca_id AND pc.tenant_id = ce.tenant_id
                       WHERE ce.tenant_id = ? AND ce.created_at >= strftime('%Y-%m-01', 'now') ORDER BY ce.created_at DESC`).bind(tenantId),
  ]);
  const tenant = await c.env.DB.prepare('SELECT slug, pagina_publica_em FROM tenants WHERE id = ?').bind(tenantId).first<{ slug: string; pagina_publica_em: string | null }>();
  return c.json({
    paginaPublica: { ligada: !!tenant?.pagina_publica_em, url: `${c.env.PUBLIC_BASE_URL.replace(/\/$/, '')}/v/${tenant?.slug ?? ''}` },
    casos: casos.results as { id: string; tipo: string; aberto_em: string; prazo_em: string | null; nota: string | null }[],
    certidoes: certidoes.results as { peca_id: string; carimbo_em: string | null; erro: string | null; na_publicacao: number; manchete: string | null }[],
  });
})
// Baixar o mês: em streaming, porque um mês pode passar da memória do Worker.
.get('/t/:tenantId/kit/mes', requireMembro('editor'), async (c) => {
  const mes = c.req.query('mes') ?? new Date().toISOString().slice(0, 7);
  if (!mesValido(mes)) return c.json({ erro: t(c, 'mes: AAAA-MM', 'mes: YYYY-MM') }, 400);
  const { corpo, pronto } = await zipDoMes(c.env, c.get('tenant').id, mes);
  c.executionCtx.waitUntil(pronto);
  return new Response(corpo, { headers: { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="arquivo-${mes}.zip"`, 'cache-control': 'no-store' } });
})
.patch('/t/:tenantId/pagina-publica', requireMembro('admin'), async (c) => {
  const b = await lerJson<{ ligada: unknown }>(c);
  if (typeof b.ligada !== 'boolean') return c.json({ erro: 'ligada: true | false' }, 400);
  await c.env.DB.prepare("UPDATE tenants SET pagina_publica_em = CASE WHEN ? THEN datetime('now') END WHERE id = ?").bind(b.ligada ? 1 : 0, c.get('tenant').id).run();
  return c.json({ ligada: b.ligada });
})

// Raio-X dos posts antigos: um por veículo. O navegador lê o zip e sobe só a miniatura e a legenda de cada post.
.get('/t/:tenantId/raiox', requireMembro('editor'), async (c) => {
  const tenantId = c.get('tenant').id;
  const lote = await c.env.DB.prepare(`SELECT l.id, l.total, l.created_at,
      (SELECT COUNT(*) FROM raiox_itens i WHERE i.lote_id = l.id AND i.tenant_id = l.tenant_id AND i.estado = 'marcado') AS marcados,
      (SELECT COUNT(*) FROM raiox_itens i WHERE i.lote_id = l.id AND i.tenant_id = l.tenant_id AND i.estado = 'ilegivel') AS ilegiveis,
      (SELECT COUNT(*) FROM raiox_itens i WHERE i.lote_id = l.id AND i.tenant_id = l.tenant_id AND i.estado = 'pendente') AS pendentes
    FROM raiox_lotes l WHERE l.tenant_id = ? ORDER BY l.created_at DESC LIMIT 1`).bind(tenantId).first<{ id: string; total: number; created_at: string; marcados: number; ilegiveis: number; pendentes: number }>();
  if (!lote) return c.json({ lote: null, itens: [], proxima: null });
  const pagina = Math.max(0, Number(c.req.query('pagina') ?? 0) || 0);
  const { results } = await c.env.DB.prepare(`SELECT id, data, legenda, r2_miniatura, estado, motivos_json FROM raiox_itens
      WHERE tenant_id = ? AND lote_id = ? AND estado IN ('marcado', 'ilegivel') ORDER BY data DESC, id LIMIT ? OFFSET ?`)
    .bind(tenantId, lote.id, ITENS_POR_PAGINA + 1, pagina * ITENS_POR_PAGINA).all<{ id: string; data: string | null; legenda: string | null; r2_miniatura: string; estado: string; motivos_json: string | null }>();
  const itens = await Promise.all(results.slice(0, ITENS_POR_PAGINA).map(async ({ r2_miniatura, motivos_json, ...i }) => ({ ...i, miniatura: await assinarMedia(c.env, r2_miniatura, 3600), motivos: JSON.parse(motivos_json ?? '[]') as string[] })));
  return c.json({ lote, itens, proxima: results.length > ITENS_POR_PAGINA ? pagina + 1 : null });
})
.post('/t/:tenantId/raiox', requireMembro('editor'), async (c) => {
  const tenantId = c.get('tenant').id;
  const existe = await c.env.DB.prepare('SELECT id FROM raiox_lotes WHERE tenant_id = ? LIMIT 1').bind(tenantId).first();
  if (existe) return c.json({ erro: t(c, 'apague o raio-X anterior antes de fazer outro', 'delete the previous review before making another') }, 409);
  const id = novoId();
  await c.env.DB.prepare('INSERT INTO raiox_lotes (id, tenant_id, por) VALUES (?, ?, ?)').bind(id, tenantId, c.get('user').id).run();
  return c.json({ id }, 201);
})
.post('/t/:tenantId/raiox/:lote/itens', requireMembro('editor'), async (c) => {
  const tenantId = c.get('tenant').id;
  const loteId = c.req.param('lote');
  if (Number(c.req.header('content-length') ?? 0) > MINIATURA_MAX_BYTES + 8192) return c.json({ erro: t(c, 'miniatura grande demais', 'thumbnail too large') }, 413);
  const form = await c.req.parseBody().catch(() => null);
  const arquivo = form?.arquivo;
  if (!(arquivo instanceof File) || arquivo.size > MINIATURA_MAX_BYTES) return c.json({ erro: t(c, 'arquivo: JPEG de até 256 KB', 'arquivo: JPEG up to 256 KB') }, 400);
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  if (!ehJpeg(bytes)) return c.json({ erro: t(c, 'arquivo: JPEG de até 256 KB', 'arquivo: JPEG up to 256 KB') }, 400);
  const data = typeof form?.data === 'string' && Number.isFinite(Date.parse(form.data)) ? new Date(form.data).toISOString() : null;
  const legenda = typeof form?.legenda === 'string' ? form.legenda.slice(0, LEGENDA_MAX) : '';
  // O teto vale na conta do lote, num UPDATE só. Lote de outro veículo não existe aqui.
  const lote = await c.env.DB.prepare('UPDATE raiox_lotes SET total = total + 1 WHERE id = ? AND tenant_id = ? AND total < ? RETURNING total').bind(loteId, tenantId, MAX_ITENS_LOTE).first<{ total: number }>();
  if (!lote) {
    const existe = await c.env.DB.prepare('SELECT id FROM raiox_lotes WHERE id = ? AND tenant_id = ?').bind(loteId, tenantId).first();
    return existe ? c.json({ erro: t(c, `até ${MAX_ITENS_LOTE} posts por raio-X`, `up to ${MAX_ITENS_LOTE} posts per review`) }, 409) : c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  }
  const id = novoId();
  const chave = `raiox/${tenantId}/${loteId}/${id}.jpg`;
  await c.env.MEDIA.put(chave, bytes, { httpMetadata: { contentType: 'image/jpeg' } });
  await c.env.DB.prepare('INSERT INTO raiox_itens (id, tenant_id, lote_id, data, legenda, r2_miniatura) VALUES (?, ?, ?, ?, ?, ?)').bind(id, tenantId, loteId, data, legenda, chave).run();
  await c.env.MONITOR_QUEUE.send({ tipo: 'raiox', tenantId, itemId: id });
  return c.json({ id }, 201);
})
.delete('/t/:tenantId/raiox/:lote', requireMembro('editor'), async (c) => {
  if (!(await apagarRaioX(c.env, c.get('tenant').id, c.req.param('lote')))) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  return c.json({ ok: true });
})
.post('/t/:tenantId/kit/casos', requireMembro('editor'), async (c) => {
  const b = await lerJson<{ tipo: unknown; abertoEm: unknown; prazoEm: unknown; nota: unknown }>(c);
  const data = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v));
  if (!pertence(TIPOS_CASO, b.tipo)) return c.json({ erro: t(c, 'tipo do caso inválido', 'invalid case type') }, 400);
  if (!data(b.abertoEm)) return c.json({ erro: t(c, 'abertoEm: data AAAA-MM-DD', 'abertoEm: date YYYY-MM-DD') }, 400);
  if (b.prazoEm !== null && b.prazoEm !== undefined && !data(b.prazoEm)) return c.json({ erro: t(c, 'prazoEm: data AAAA-MM-DD', 'prazoEm: date YYYY-MM-DD') }, 400);
  if (b.nota !== null && b.nota !== undefined && (typeof b.nota !== 'string' || b.nota.length > NOTA_CASO_MAX)) return c.json({ erro: t(c, `nota: até ${NOTA_CASO_MAX} caracteres`, `note: up to ${NOTA_CASO_MAX} characters`) }, 400);
  const id = novoId();
  await c.env.DB.prepare('INSERT INTO kit_casos (id, tenant_id, tipo, aberto_em, prazo_em, nota, por) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, c.get('tenant').id, b.tipo, b.abertoEm, b.prazoEm ?? null, (b.nota as string | null | undefined) ?? null, c.get('user').id).run();
  return c.json({ id }, 201);
})
.delete('/t/:tenantId/kit/casos/:id', requireMembro('editor'), async (c) => {
  const r = await c.env.DB.prepare('DELETE FROM kit_casos WHERE id = ? AND tenant_id = ?').bind(c.req.param('id'), c.get('tenant').id).run();
  if (!r.meta.changes) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  return c.json({ ok: true });
})

// Postados: o que saiu, da mais recente, 20 por página. `?antes=` é o `proximo` da página anterior. Capa assinada (1 h).
.get('/t/:tenantId/publicacoes', validator('query', (q) => ({ antes: typeof q.antes === 'string' ? q.antes : undefined })), async (c) => {
  const tenantId = c.get('tenant').id;
  const q = c.req.query('antes');
  const antes = cursorPublicacoes(q);
  if (q && !antes) return c.json({ erro: t(c, 'antes: use o `proximo` da página anterior', 'antes: use `proximo` from the previous page') }, 400);
  const POR_PAGINA = 20;
  const { results } = await c.env.DB.prepare(
    `SELECT pu.id, pu.peca_id, pu.url, pu.modo, pu.publicado_em, pu.created_at, pc.formato, pa.titulo, pa.tipo_post,
            co.nome AS conta_nome, co.external_id AS conta_external_id,
            json_extract(pc.conteudo_json, '$.manchete') AS manchete,
            json_array_length(pc.arte_r2_keys_json) AS ncards,
            json_extract(pc.arte_r2_keys_json, '$[0].jpg') AS capa_r2,
            EXISTS (SELECT 1 FROM decisoes d WHERE d.tenant_id = pu.tenant_id AND d.peca_id = pu.peca_id AND d.decisao = 'aprovar' AND d.por = 'piloto') AS piloto,
            ce.sha256 AS certidao, ce.erro AS certidao_erro
       FROM publicacoes pu
       JOIN pecas pc ON pc.id = pu.peca_id AND pc.tenant_id = pu.tenant_id
       JOIN pautas pa ON pa.id = pc.pauta_id AND pa.tenant_id = pc.tenant_id
       LEFT JOIN contas_sociais co ON co.id = pu.conta_id AND co.tenant_id = pu.tenant_id
       LEFT JOIN certidoes ce ON ce.peca_id = pu.peca_id AND ce.tenant_id = pu.tenant_id AND ce.versao = pc.versao
      WHERE pu.tenant_id = ? AND pu.status = 'publicada'
        ${antes ? 'AND (pu.created_at < ? OR (pu.created_at = ? AND pu.id < ?))' : ''}
      ORDER BY pu.created_at DESC, pu.id DESC
      LIMIT ${POR_PAGINA + 1}`,
  ).bind(tenantId, ...(antes ? [antes.em, antes.em, antes.id] : [])).all<{
    id: string; peca_id: string; url: string | null; modo: string; publicado_em: string | null; created_at: string; formato: string;
    titulo: string; tipo_post: string | null; conta_nome: string | null; conta_external_id: string | null; manchete: string | null; ncards: number | null; capa_r2: string | null; piloto: number; certidao: string | null; certidao_erro: string | null;
  }>();
  const pagina = results.slice(0, POR_PAGINA);
  const ultima = pagina.at(-1);
  const publicacoes = await Promise.all(pagina.map(async ({ capa_r2, created_at: _c, ...p }) => ({
    ...p, capa: capa_r2 ? await assinarMedia(c.env, capa_r2, 3600) : null,
  })));
  return c.json({ publicacoes, proximo: results.length > POR_PAGINA && ultima ? `${ultima.created_at}|${ultima.id}` : null });
})

// Contas ativas para escolher na aprovação (`?todas=1` traz também as desligadas, para a tela do veículo). Com o nome
// do provedor (intermediário); sem token nem referência do provedor.
.get('/t/:tenantId/contas', consultaTodas, async (c) => {
  const todas = c.req.query('todas') === '1';
  const { results } = await c.env.DB.prepare(
    `SELECT id, rede, modo, nome, external_id, status, provedor FROM contas_sociais WHERE tenant_id = ? AND (status = 'ativa' OR ?)
      ORDER BY status = 'ativa' DESC, CASE modo WHEN 'real' THEN 0 WHEN 'intermediario' THEN 1 WHEN 'manual' THEN 2 ELSE 3 END, created_at`,
  ).bind(c.get('tenant').id, todas ? 1 : 0).all<{ id: string; rede: string; modo: string; nome: string | null; external_id: string | null; status: string; provedor: string | null }>();
  return c.json({ contas: results });
})

// Desligar ou religar uma conta (só admin). Desligada = status 'removida': sai da escolha na aprovação e o publicador
// recusa ("conta não está mais ativa"); peça já aprovada para ela continua válida até alguém trocar a conta.
.patch('/t/:tenantId/contas/:id', requireMembro('admin'), async (c) => {
  const tenantId = c.get('tenant').id;
  const b = await lerJson<{ ativo?: boolean; propria?: boolean }>(c);
  // "Este é o site do veículo": vale para o que sair daqui em diante. Veículo autoral já lê tudo o que é dele.
  if (typeof b.propria === 'boolean') {
    const modo = await c.env.DB.prepare('SELECT modo FROM tenants WHERE id = ?').bind(tenantId).first<{ modo: string }>();
    if (modo?.modo === 'autoral') return c.json({ erro: t(c, 'veículo autoral não tem site próprio como fonte', "an author outlet doesn't mark its own site as a source") }, 400);
    const row = await c.env.DB.prepare("UPDATE fontes SET propria_desde = ? WHERE id = ? AND tenant_id = ? AND tipo != 'manual' RETURNING id, propria_desde")
      .bind(b.propria ? new Date().toISOString() : null, c.req.param('id'), tenantId).first<{ id: string; propria_desde: string | null }>();
    if (!row) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
    return c.json({ id: row.id, propria: !!row.propria_desde });
  }
  if (typeof b.ativo !== 'boolean') return c.json({ erro: 'ativo: true | false' }, 400);
  const status = b.ativo ? 'ativa' : 'removida';
  const row = await c.env.DB.prepare('UPDATE contas_sociais SET status = ? WHERE id = ? AND tenant_id = ? RETURNING id, status')
    .bind(status, c.req.param('id'), tenantId).first<{ id: string; status: string }>();
  if (!row) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  return c.json(row);
})

// Conta de rede social (só admin do tenant). Token entra em claro no body (HTTPS) e é cifrado antes de tocar o D1.
.post('/t/:tenantId/contas', requireMembro('admin'), async (c) => {
  const tenantId = c.get('tenant').id;
  const b = await lerJson<{ rede: string; externalId: string; nome: string; token: string; tokenExpiraEm: string; modo: string; provedor: string; provedorRef: string }>(c);
  const modo = b.modo ?? 'manual';   // padrão: sem app Meta; o operador publica pelo celular
  if (!pertence(MODOS_CONTA, modo)) return c.json({ erro: `modo: ${MODOS_CONTA.join(' | ')}` }, 400);
  if ((b.rede ?? 'instagram') !== 'instagram') return c.json({ erro: t(c, 'só instagram por enquanto', 'only instagram for now') }, 400);
  if (b.token !== undefined && (typeof b.token !== 'string' || !b.token.trim() || b.token.length > 4000)) return c.json({ erro: t(c, 'token: texto até 4000 caracteres', 'token: text up to 4000 characters') }, 400);
  if (modo === 'real' && (!b.token || !b.externalId)) return c.json({ erro: t(c, 'conta real exige token e externalId (id da conta profissional do IG)', 'a real account requires token and externalId (the IG professional account id)') }, 400);
  if (modo === 'real' && !/^\d{5,30}$/.test(String(b.externalId))) return c.json({ erro: t(c, 'externalId: só números (id da conta profissional do IG)', 'externalId: digits only (the IG professional account id)') }, 400);
  if (modo === 'intermediario' && !b.provedor) return c.json({ erro: t(c, 'conta intermediária exige provedor (ayrshare, postpeer, zernio...)', 'a posting service account requires provedor (ayrshare, postpeer, zernio...)') }, 400);
  // Só a Ayrshare tem adaptador; PostPeer e Zernio entram depois (decisão em HANDOFF.md).
  if (modo === 'intermediario' && !PROVEDORES_ATIVOS.includes(b.provedor!)) return c.json({ erro: t(c, `provedor: ${PROVEDORES_ATIVOS.join(' | ')} (os outros ainda não)`, `provedor: ${PROVEDORES_ATIVOS.join(' | ')} (the others not yet)`) }, 400);
  if (modo === 'intermediario' && !b.token) return c.json({ erro: t(c, 'conta intermediária exige a chave da API do provedor (token)', "a posting service account requires the provider's API key (token)") }, 400);
  if (b.provedorRef !== undefined && (typeof b.provedorRef !== 'string' || b.provedorRef.length > 200)) return c.json({ erro: t(c, 'provedorRef: até 200 caracteres', 'provedorRef: up to 200 characters') }, 400);
  const id = novoId();
  await c.env.DB.prepare('INSERT INTO contas_sociais (id, tenant_id, rede, external_id, nome, token_enc, token_expira_em, modo, provedor, provedor_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, tenantId, 'instagram', b.externalId ?? null, b.nome ?? null, b.token ? await cifrarToken(c.env, b.token.trim()) : null, b.tokenExpiraEm ?? null, modo,
      modo === 'intermediario' ? b.provedor! : null, modo === 'intermediario' ? b.provedorRef?.trim() || null : null).run();
  return c.json({ id, modo }, 201);
})

// A marca como a UI vê (qualquer membro): nome, @, cores e o logo assinado por 1 h. Para a aba Marca da tela do veículo.
.get('/t/:tenantId/marca', async (c) => {
  const tenantId = c.get('tenant').id;
  const row = await c.env.DB.prepare('SELECT marca_json, idioma FROM tenants WHERE id = ?').bind(tenantId).first<{ marca_json: string; idioma: string | null }>();
  const { logoR2, arteRefR2 } = JSON.parse(row?.marca_json || '{}') as { logoR2?: string; arteRefR2?: string };
  return c.json({ marca: {
    ...marcaPublica(row?.marca_json),
    logo: logoR2 ? await assinarMedia(c.env, logoR2, 3600) : null,
    referencia: arteRefR2 ? await assinarMedia(c.env, arteRefR2, 3600) : null,
  }, idioma: idiomaDoVeiculo(row?.idioma) });
})

// Modelos do veículo: todo membro vê; só o admin cria, edita e arquiva.
.get('/t/:tenantId/estilos', async (c) => c.json({ estilos: await listarEstilos(c.env, c.get('tenant').id) }))
.post('/t/:tenantId/estilos', requireMembro('admin'), async (c) => {
  const v = validarEstilo(await lerJson<unknown>(c), idiomaDe(c));
  if ('erro' in v) return c.json({ erro: v.erro }, 400);
  if (v.params.patrocinio && !(await patrocinioDoVeiculo(c.env, c.get('tenant').id, v.params.patrocinio))) return c.json({ erro: t(c, 'patrocinador não encontrado', 'sponsor not found') }, 404);
  const r = await criarEstilo(c.env, c.get('tenant').id, v, c.get('user').id, idiomaDe(c));
  if ('erro' in r) return c.json({ erro: r.erro }, 409);
  return c.json(r, 201);
})
// Plano do veículo (só admin): o uso, a comparação e, com a cobrança configurada, assinar e gerenciar.
.get('/t/:tenantId/plano', requireMembro('admin'), async (c) => {
  const s = await situacaoPlano(c.env, c.get('tenant').id);
  return c.json({
    plano: s.plano, limite: s.limite, periodo: s.periodo, usados: s.usados, bloqueado: s.bloqueado, avisoEm: AVISO_USO,
    assinatura: s.assinatura ? { status: s.assinatura.status, periodoFim: s.assinatura.periodo_fim, atrasoDesde: s.assinatura.atraso_desde, gerenciavel: !!s.assinatura.stripe_customer } : null,
    cobranca: cobrancaLigada(c.env), planos: PLANOS_PAGOS.map((id) => ({ id, precoReais: PLANOS[id].precoReais, limite: PLANOS[id].limite })),
    instalacaoPropria: instalacaoPropria(c.env),
  });
})
.post('/t/:tenantId/assinatura/checkout', requireMembro('admin'), async (c) => {
  const { plano } = await lerJson<{ plano?: unknown }>(c);
  if (!pertence(PLANOS_PAGOS, plano)) return c.json({ erro: `plano: ${PLANOS_PAGOS.join(' | ')}` }, 400);
  if (!cobrancaLigada(c.env)) return c.json({ erro: t(c, 'A cobrança ainda não está configurada.', 'Billing is not set up yet.') }, 503);
  const s = await situacaoPlano(c.env, c.get('tenant').id);
  if (s.assinatura && s.assinatura.status !== 'canceled') return c.json({ erro: t(c, 'Este veículo já tem assinatura. Troque de plano em Gerenciar.', 'This outlet already has a subscription. Change plans in Manage.') }, 409);
  try {
    return c.json({ url: await criarCheckout(c.env, c.get('tenant'), plano, s.assinatura?.stripe_customer ?? null) });
  } catch {
    return c.json({ erro: t(c, 'A Stripe não respondeu. Tente de novo.', "Stripe didn't respond. Try again.") }, 502);
  }
})
.post('/t/:tenantId/assinatura/portal', requireMembro('admin'), async (c) => {
  if (!cobrancaLigada(c.env)) return c.json({ erro: t(c, 'A cobrança ainda não está configurada.', 'Billing is not set up yet.') }, 503);
  const s = await situacaoPlano(c.env, c.get('tenant').id);
  if (!s.assinatura?.stripe_customer) return c.json({ erro: t(c, 'Este veículo não tem assinatura.', 'This outlet has no subscription.') }, 404);
  try {
    return c.json({ url: await criarPortal(c.env, c.get('tenant').slug, s.assinatura.stripe_customer) });
  } catch {
    return c.json({ erro: t(c, 'A Stripe não respondeu. Tente de novo.', "Stripe didn't respond. Try again.") }, 502);
  }
})
// Chaves de IA do veículo (só admin; web/src/telas/veiculo/Chaves.tsx). O GET diz o estado de cada provedor sem a chave; o PUT
// confere a chave com o provedor antes de guardar (cifrada), e chave recusada ou não conferida não é guardada.
.get('/t/:tenantId/chaves-ia', requireMembro('admin'), async (c) => c.json(await estadoChaves(c.env, c.get('tenant').id)))
.put('/t/:tenantId/chaves-ia/:provedor', requireMembro('admin'), async (c) => {
  const tenantId = c.get('tenant').id;
  const p = c.req.param('provedor');
  if (!ehProvedor(p)) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  const { chave } = await lerJson<{ chave?: unknown }>(c);
  const limpa = typeof chave === 'string' ? chave.trim() : '';
  if (limpa.length < CHAVE_MIN || limpa.length > CHAVE_MAX || /\s/.test(limpa)) {
    return c.json({ erro: t(c, 'Confira a chave: ela parece incompleta. Copie de novo, inteira, da página do provedor.', "Check the key: it looks incomplete. Copy it again, whole, from the provider's page."), code: 'chave_invalida' }, 400);
  }
  const nome = PROVEDORES[p].nome;
  const conferida = await conferirChave(c.env, p, limpa);
  if (conferida === 'recusada') {
    return c.json({ erro: t(c, `O ${nome} recusou essa chave. Confira se ela foi copiada inteira e se ainda está ativa.`, `${nome} refused this key. Check that it was copied whole and is still active.`), code: 'chave_recusada' }, 422);
  }
  if (conferida === 'sem_resposta') {
    return c.json({ erro: t(c, `O ${nome} não respondeu agora, e a chave não foi salva. Tente de novo em instantes.`, `${nome} didn't respond right now, and the key wasn't saved. Try again in a moment.`), code: 'provedor_sem_resposta' }, 502);
  }
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO chaves_ia (tenant_id, provedor, chave_enc, final, salva_por) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (tenant_id, provedor) DO UPDATE SET chave_enc = excluded.chave_enc, final = excluded.final, salva_por = excluded.salva_por, salva_em = datetime('now')`)
      .bind(tenantId, p, await cifrarToken(c.env, limpa), limpa.slice(-4), c.get('user').id),
    eventoStmt(c.env, { tenantId, tipo: 'chave_ia.salva', refTipo: 'tenant', refId: tenantId, payload: { provedor: p, por: c.get('user').id } }),
  ]);
  return c.json(await estadoChaves(c.env, tenantId));
})
.delete('/t/:tenantId/chaves-ia/:provedor', requireMembro('admin'), async (c) => {
  const tenantId = c.get('tenant').id;
  const p = c.req.param('provedor');
  if (!ehProvedor(p)) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM chaves_ia WHERE tenant_id = ? AND provedor = ?').bind(tenantId, p),
    eventoStmt(c.env, { tenantId, tipo: 'chave_ia.removida', refTipo: 'tenant', refId: tenantId, payload: { provedor: p, por: c.get('user').id } }),
  ]);
  return c.json(await estadoChaves(c.env, tenantId));
})
// A escolha de texto (DeepSeek ou Gemini) e de ilustração (Kie ou fal). Só provedor com chave (do veículo ou do servidor).
.patch('/t/:tenantId/chaves-ia', requireMembro('admin'), async (c) => {
  const tenantId = c.get('tenant').id;
  const b = await lerJson<{ texto?: unknown; imagem?: unknown }>(c);
  if (b.texto !== undefined && !pertence(PROVEDORES_TEXTO, b.texto)) return c.json({ erro: `texto: ${PROVEDORES_TEXTO.join(' | ')}` }, 400);
  if (b.imagem !== undefined && !pertence(PROVEDORES_IMAGEM, b.imagem)) return c.json({ erro: `imagem: ${PROVEDORES_IMAGEM.join(' | ')}` }, 400);
  for (const p of [b.texto, b.imagem].filter((x) => x !== undefined) as Provedor[]) {
    if (!(await temChave(c.env, tenantId, p))) {
      return c.json({ erro: t(c, `Salve a chave do ${PROVEDORES[p].nome} antes de escolher.`, `Save the ${PROVEDORES[p].nome} key before choosing it.`), code: 'sem_chave' }, 409);
    }
  }
  await c.env.DB.prepare('UPDATE tenants SET provedor_texto = COALESCE(?, provedor_texto), provedor_imagem = COALESCE(?, provedor_imagem) WHERE id = ?')
    .bind(b.texto ?? null, b.imagem ?? null, tenantId).run();
  return c.json(await estadoChaves(c.env, tenantId));
})
.post('/t/:tenantId/estilos/copiar', requireMembro('admin'), async (c) => {
  const b = await lerJson<{ origem?: unknown; estiloId?: unknown }>(c);
  const destino = c.get('tenant').id;
  if (typeof b.origem !== 'string' || typeof b.estiloId !== 'string') return c.json({ erro: t(c, 'origem e estiloId são obrigatórios', 'origem and estiloId are required') }, 400);
  const membro = await c.env.DB.prepare('SELECT papel FROM membros WHERE tenant_id = ? AND user_id = ?').bind(b.origem, c.get('user').id).first<{ papel: string }>();
  if (!membro) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  if (membro.papel !== 'admin') return c.json({ erro: t(c, 'exige papel admin nos dois veículos', 'requires the admin role in both outlets') }, 403);
  if (b.origem === destino) return c.json({ erro: t(c, 'escolha outro veículo', 'choose another outlet') }, 400);
  const r = await copiarEstilo(c.env, b.origem, b.estiloId, destino, c.get('user').id, idiomaDe(c));
  if (!r) return c.json({ erro: t(c, 'modelo não encontrado', 'template not found') }, 404);
  if ('erro' in r) return c.json({ erro: r.erro }, 409);
  return c.json(r, 201);
})
.put('/t/:tenantId/estilos/:id', requireMembro('admin'), async (c) => {
  const v = validarEstilo(await lerJson<unknown>(c), idiomaDe(c));
  if ('erro' in v) return c.json({ erro: v.erro }, 400);
  if (v.params.patrocinio && !(await patrocinioDoVeiculo(c.env, c.get('tenant').id, v.params.patrocinio))) return c.json({ erro: t(c, 'patrocinador não encontrado', 'sponsor not found') }, 404);
  const r = await atualizarEstilo(c.env, c.get('tenant').id, c.req.param('id'), v, idiomaDe(c));
  if (!r) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  if ('erro' in r) return c.json({ erro: r.erro }, 409);
  return c.json(r);
})
// Patrocinadores: todo membro vê; só o admin cadastra, sobe o logo e arquiva.
.get('/t/:tenantId/patrocinios', async (c) => c.json({ patrocinios: await listarPatrocinios(c.env, c.get('tenant').id) }))
.post('/t/:tenantId/patrocinios', requireMembro('admin'), async (c) => {
  const v = validarPatrocinio(await lerJson<unknown>(c), idiomaDe(c));
  if ('erro' in v) return c.json({ erro: v.erro }, 400);
  const id = novoId();
  await c.env.DB.prepare('INSERT INTO patrocinios (id, tenant_id, nome, inicio, fim, por) VALUES (?, ?, ?, ?, ?, ?)').bind(id, c.get('tenant').id, v.nome, v.inicio, v.fim, c.get('user').id).run();
  return c.json({ id }, 201);
})
.post('/t/:tenantId/patrocinios/:id/logo', requireMembro('admin'), async (c) => {
  const tenantId = c.get('tenant').id;
  const id = c.req.param('id');
  if (!(await patrocinioDoVeiculo(c.env, tenantId, id))) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  const l = await lerLogo(c.req.raw, idiomaDe(c));
  if ('erro' in l) return c.json({ erro: l.erro }, l.status);
  const key = `patrocinios/${tenantId}/logo-${novoId()}.${l.ext}`;
  await c.env.MEDIA.put(key, l.corpo, { httpMetadata: { contentType: l.tipo } });
  await c.env.DB.prepare('UPDATE patrocinios SET logo_r2 = ? WHERE id = ? AND tenant_id = ?').bind(key, id, tenantId).run();
  return c.json({ ok: true }, 201);
})
.delete('/t/:tenantId/patrocinios/:id', requireMembro('admin'), async (c) => {
  const r = await c.env.DB.prepare("UPDATE patrocinios SET arquivado_em = datetime('now') WHERE id = ? AND tenant_id = ? AND arquivado_em IS NULL").bind(c.req.param('id'), c.get('tenant').id).run();
  if (!r.meta.changes) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  return c.json({ ok: true });
})
.delete('/t/:tenantId/estilos/:id', requireMembro('admin'), async (c) => {
  if (!(await arquivarEstilo(c.env, c.get('tenant').id, c.req.param('id')))) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  return c.json({ ok: true });
})

// Marca (só admin): nome, @, 3 cores, estilo da ilustração, textos dos convites e marca d'água, por merge-patch em
// marca_json. Os convites chegam só com os textos; o resto de cada um (destaques, telefone) fica como está.
.patch('/t/:tenantId/marca', requireMembro('admin'), async (c) => {
  const tenantId = c.get('tenant').id;
  const corpo = await lerJson<Record<string, unknown>>(c);
  // Idioma dos posts: coluna do veículo, não da marca. Vale para o que for produzido daqui em diante.
  const { idioma: novoIdioma, ...resto } = corpo;
  if (novoIdioma !== undefined && !ehIdiomaConteudo(novoIdioma)) return c.json({ erro: t(c, 'idioma: pt-BR ou en', 'idioma: pt-BR or en') }, 400);
  const v = validarMarca(resto, idiomaDe(c));
  if ('erro' in v) return c.json({ erro: v.erro }, 400);
  if (novoIdioma !== undefined) await c.env.DB.prepare('UPDATE tenants SET idioma = ? WHERE id = ?').bind(novoIdioma, tenantId).run();
  if (v.ctas) {
    const atual = await c.env.DB.prepare("SELECT json_extract(marca_json, '$.ctas') AS ctas FROM tenants WHERE id = ?").bind(tenantId).first<{ ctas: string | null }>();
    const ctas = mesclarCtas(atual?.ctas ? JSON.parse(atual.ctas) : [], v.ctas, idiomaDe(c));
    if ('erro' in ctas) return c.json({ erro: ctas.erro }, 400);
    (v.patch as Record<string, unknown>).ctas = ctas;   // array: json_patch troca inteiro
  }
  const row = await c.env.DB.prepare('UPDATE tenants SET marca_json = json_patch(marca_json, ?) WHERE id = ? RETURNING marca_json, idioma')
    .bind(JSON.stringify(v.patch), tenantId).first<{ marca_json: string; idioma: string | null }>();
  return c.json({ marca: marcaPublica(row?.marca_json), ...(novoIdioma !== undefined ? { idioma: idiomaDoVeiculo(row?.idioma) } : {}) });
})

// Colar o site no veículo novo: devolve a sugestão, e nada é salvo aqui. A pessoa confere e salva pelas rotas de sempre.
.post('/t/:tenantId/marca/puxar', requireMembro('admin'), async (c) => {
  const tenantId = c.get('tenant').id;
  const url = enderecoDoSite((await lerJson<{ url?: unknown }>(c)).url);
  if (!url) return c.json({ erro: t(c, 'Cole o endereço público do site.', 'Paste the public address of the site.') }, 400);
  const feitas = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM eventos WHERE tenant_id = ? AND tipo = 'marca.puxada' AND created_at > datetime('now', '-1 day')").bind(tenantId).first<{ n: number }>();
  if ((feitas?.n ?? 0) >= MAX_PUXADAS_DIA) return c.json({ erro: t(c, 'Este veículo já leu sites demais hoje. Preencha à mão ou tente amanhã.', 'This outlet read too many sites today. Fill it in by hand or try tomorrow.') }, 429);
  await registrarEvento(c.env, tenantId, 'marca.puxada', 'tenant', tenantId, { url });
  try {
    return c.json(await puxarMarca(c.env, url));
  } catch {
    return c.json({ erro: t(c, 'Não deu para ler esse site agora. Preencha à mão ou tente de novo.', "Couldn't read that site right now. Fill it in by hand or try again.") }, 502);
  }
})
// Logo (só admin): PNG ou SVG até 512 KB no corpo cru. SVG passa pela lista branca (sanitizarSvg) antes do R2.
.post('/t/:tenantId/marca/logo', requireMembro('admin'), async (c) => {
  const tenantId = c.get('tenant').id;
  const l = await lerLogo(c.req.raw, idiomaDe(c));
  if ('erro' in l) return c.json({ erro: l.erro }, l.status);
  // Chave nova a cada envio, e a antiga fica: uma produção em andamento guardou a chave da marca no passo
  // "carregar pauta" e o render lê esse arquivo depois (apagar faria a peça falhar em todas as tentativas).
  const key = `marcas/${tenantId}/logo-${novoId()}.${l.ext}`;
  await c.env.MEDIA.put(key, l.corpo, { httpMetadata: { contentType: l.tipo } });
  const row = await c.env.DB.prepare('UPDATE tenants SET marca_json = json_patch(marca_json, ?) WHERE id = ? RETURNING marca_json')
    .bind(JSON.stringify({ logoR2: key }), tenantId).first<{ marca_json: string }>();
  return c.json({ marca: marcaPublica(row?.marca_json) }, 201);
})

// Imagem de referência da ilustração (só admin): PNG ou JPEG até 2 MB no corpo cru. Chave nova a cada envio (a
// produção em andamento guardou a antiga). O Kie usa como referência de técnica e paleta.
.post('/t/:tenantId/marca/referencia', requireMembro('admin'), async (c) => {
  const tenantId = c.get('tenant').id;
  const tipo = (c.req.header('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (tipo !== 'image/png' && tipo !== 'image/jpeg') return c.json({ erro: t(c, 'referência: PNG ou JPEG', 'reference: PNG or JPEG') }, 415);
  if (Number(c.req.header('content-length') ?? 0) > REFERENCIA_MAX_BYTES) return c.json({ erro: t(c, 'referência: até 2 MB', 'reference: up to 2 MB') }, 413);
  const bytes = await lerCorpoAte(c.req.raw.body, REFERENCIA_MAX_BYTES);
  if (!bytes) return c.json({ erro: t(c, 'referência: até 2 MB', 'reference: up to 2 MB') }, 413);
  if (tipo === 'image/png' ? !ehPng(bytes) : !ehJpeg(bytes)) return c.json({ erro: t(c, `arquivo não é ${tipo === 'image/png' ? 'PNG' : 'JPEG'}`, `file is not a ${tipo === 'image/png' ? 'PNG' : 'JPEG'}`) }, 400);
  const key = `marcas/${tenantId}/referencia-${novoId()}.${tipo === 'image/png' ? 'png' : 'jpg'}`;
  await c.env.MEDIA.put(key, bytes, { httpMetadata: { contentType: tipo } });
  const row = await c.env.DB.prepare('UPDATE tenants SET marca_json = json_patch(marca_json, ?) WHERE id = ? RETURNING marca_json')
    .bind(JSON.stringify({ arteRefR2: key }), tenantId).first<{ marca_json: string }>();
  return c.json({ marca: marcaPublica(row?.marca_json) }, 201);
})

// Aceitar um convite de equipe (quem recebeu o link, depois de criar a conta ou entrar com o e-mail convidado).
// 403 se a conta é de outro e-mail; idempotente.
.post('/convites/:id/aceitar', async (c) => {
  const u = c.get('user');
  const r = await aceitarConvite(c.env.DB, c.req.param('id'), u.id, u.email);
  if (!r.ok) return c.json({ erro: r.motivo === 'outro_email' ? t(c, 'o convite é para outro e-mail', 'the invite is for another email') : t(c, 'não encontrado', 'not found') }, r.motivo === 'outro_email' ? 403 : 404);
  return c.json({ slug: r.slug, papel: r.papel, jaEra: r.jaEra });
})

// Equipe: membros do veículo (qualquer membro vê) e, para o admin, os convites pendentes com o link para mandar à mão.
.get('/t/:tenantId/membros', async (c) => {
  const tenantId = c.get('tenant').id;
  const admin = c.get('tenant').papel === 'admin';
  const [membros, convites] = await c.env.DB.batch<Record<string, unknown>>([
    c.env.DB.prepare(
      `SELECT m.id, m.papel, m.created_at, u.name AS nome, u.email FROM membros m JOIN "user" u ON u.id = m.user_id
        WHERE m.tenant_id = ? ORDER BY CASE m.papel WHEN 'admin' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, u.name`,
    ).bind(tenantId),
    c.env.DB.prepare(admin
      ? 'SELECT id, email, papel, created_at FROM convites WHERE tenant_id = ? AND aceito_em IS NULL ORDER BY created_at DESC'
      : 'SELECT id, email, papel, created_at FROM convites WHERE 0 AND tenant_id = ?').bind(tenantId),
  ]);
  return c.json({
    membros: membros.results as { id: string; papel: string; created_at: string; nome: string; email: string }[],
    convites: (convites.results as { id: string; email: string; papel: string; created_at: string }[]).map((cv) => ({ ...cv, link: linkConvite(cv.id) })),
  });
})

// Convidar por e-mail (só admin). Quem já tem conta vira membro na hora; quem não tem fica em `convites` até criar a
// conta (hook do Better Auth). Convidar o mesmo e-mail de novo só atualiza o papel do convite pendente.
.post('/t/:tenantId/convites', requireMembro('admin'), async (c) => {
  const tenantId = c.get('tenant').id;
  const b = await lerJson<{ email: string; papel: string }>(c);
  const email = emailValido(b.email);
  if (!email) return c.json({ erro: t(c, 'email inválido', 'invalid email') }, 400);
  const papel = papelConvite(b.papel);
  if (!papel) return c.json({ erro: 'papel: editor | reporter' }, 400);
  const usuario = await c.env.DB.prepare('SELECT id, name FROM "user" WHERE lower(email) = ?').bind(email).first<{ id: string; name: string }>();
  if (usuario) {
    const ja = await c.env.DB.prepare('SELECT papel FROM membros WHERE tenant_id = ? AND user_id = ?').bind(tenantId, usuario.id).first<{ papel: string }>();
    if (ja) return c.json({ erro: t(c, `já é ${ja.papel} deste veículo`, `already a member of this publication as ${ja.papel}`) }, 409);
    const id = novoId();
    await c.env.DB.prepare('INSERT INTO membros (id, tenant_id, user_id, papel) VALUES (?, ?, ?, ?)').bind(id, tenantId, usuario.id, papel).run();
    return c.json({ membro: { id, papel, nome: usuario.name, email }, convite: null }, 201);
  }
  const id = novoId();
  const row = await c.env.DB.prepare(
    `INSERT INTO convites (id, tenant_id, email, papel, criado_por) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, email) DO UPDATE SET papel = excluded.papel, aceito_em = NULL
       RETURNING id, email, papel`,
  ).bind(id, tenantId, email, papel, c.get('user').id).first<{ id: string; email: string; papel: string }>();
  return c.json({ membro: null, convite: { ...row!, link: linkConvite(row!.id) } }, 201);
})

// Cancelar um convite pendente (só admin).
.delete('/t/:tenantId/convites/:id', requireMembro('admin'), async (c) => {
  const r = await c.env.DB.prepare('DELETE FROM convites WHERE id = ? AND tenant_id = ? AND aceito_em IS NULL RETURNING id')
    .bind(c.req.param('id'), c.get('tenant').id).first<{ id: string }>();
  if (!r) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  return c.json({ id: r.id });
})

// Saúde das fontes para a lateral: ativa e sem falha desde a última coleta = ok. Fonte manual (relato) não entra.
// `?todas=1` traz também as pausadas (tela do veículo).
.get('/t/:tenantId/fontes', consultaTodas, async (c) => {
  const todas = c.req.query('todas') === '1';
  const { results } = await c.env.DB.prepare(
    "SELECT id, nome, url, ativo, falhas, ultimo_fetch_at, intervalo_min, via_navegador, propria_desde FROM fontes WHERE tenant_id = ? AND (ativo = 1 OR ?) AND tipo != 'manual' ORDER BY ativo DESC, nome LIMIT 100",
  ).bind(c.get('tenant').id, todas ? 1 : 0).all<{ id: string; nome: string; url: string | null; ativo: number; falhas: number; ultimo_fetch_at: string | null; propria_desde: string | null; intervalo_min: number; via_navegador: number }>();
  // `intervaloMin`: a fonte vence `intervalo_min` depois da última coleta e entra no próximo cron (a cada 15 min).
  // `coletavel`: ativa e sem MAX_FALHAS_FONTE falhas seguidas (o cron desiste); fora disso não conta para a próxima coleta.
  const fontes = results.map((f) => ({
    id: f.id, nome: f.nome, url: f.url, ativo: f.ativo === 1, ok: f.falhas === 0, coletadaEm: f.ultimo_fetch_at, intervaloMin: f.intervalo_min,
    coletavel: f.ativo === 1 && f.falhas < MAX_FALHAS_FONTE,
    // A última coleta boa precisou do Browser Rendering (o site barra o fetch comum).
    viaNavegador: f.via_navegador === 1,
    propria: !!f.propria_desde,
  }));
  const coletaEm = fontes.map((f) => f.coletadaEm).filter((d): d is string => !!d).sort().at(-1) ?? null;
  const tenant = await c.env.DB.prepare('SELECT resumo_ligado, piloto_ligado_em, piloto_por_dia FROM tenants WHERE id = ?').bind(c.get('tenant').id).first<{ resumo_ligado: number; piloto_ligado_em: string | null; piloto_por_dia: number }>();
  const contaSozinha = !!(await contaDoPiloto(c.env, c.get('tenant').id));
  return c.json({ fontes, coletaEm, resumoLigado: tenant?.resumo_ligado === 1, piloto: { ligado: !!tenant?.piloto_ligado_em, porDia: tenant?.piloto_por_dia ?? 6, contaSozinha } });
})

// Resumo do dia: o admin liga o cron das 18h; o editor pede na hora, pela mesma função.
.patch('/t/:tenantId/piloto', requireMembro('admin'), async (c) => {
  const tenantId = c.get('tenant').id;
  const por = c.get('user').id;
  const b = await lerJson<{ ligado: unknown }>(c);
  if (typeof b.ligado !== 'boolean') return c.json({ erro: 'ligado: true | false' }, 400);
  const tenant = await c.env.DB.prepare('SELECT modo FROM tenants WHERE id = ?').bind(tenantId).first<{ modo: string }>();
  if (tenant?.modo === 'autoral') return c.json({ erro: t(c, 'veículo autoral não tem piloto', "an author outlet doesn't have autopilot") }, 400);
  if (b.ligado && !(await contaDoPiloto(c.env, tenantId))) return c.json({ erro: t(c, 'o piloto exige uma conta que poste sozinha', 'autopilot needs an account that posts on its own') }, 409);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE tenants SET piloto_ligado_em = CASE WHEN ? THEN COALESCE(piloto_ligado_em, datetime('now')) END, piloto_ligado_por = CASE WHEN ? THEN ? END WHERE id = ?")
      .bind(b.ligado ? 1 : 0, b.ligado ? 1 : 0, por, tenantId),
    eventoStmt(c.env, { tenantId, tipo: b.ligado ? 'piloto.ligado' : 'piloto.desligado', refTipo: 'tenant', refId: tenantId, payload: { por } }),
  ]);
  return c.json({ ligado: b.ligado });
})
.patch('/t/:tenantId/resumo', requireMembro('admin'), async (c) => {
  const b = await lerJson<{ ligado?: unknown }>(c);
  if (typeof b.ligado !== 'boolean') return c.json({ erro: 'ligado: true | false' }, 400);
  await c.env.DB.prepare("UPDATE tenants SET resumo_ligado = ? WHERE id = ? AND modo != 'autoral'").bind(b.ligado ? 1 : 0, c.get('tenant').id).run();
  return c.json({ ligado: b.ligado });
})
.post('/t/:tenantId/resumo', requireMembro('editor'), async (c) => {
  const r = await montarResumo(c.env, c.get('tenant').id, undefined, c.get('user').id);
  if (r.situacao === 'poucas') return c.json({ ...r, erro: t(c, `Só ${r.encontradas} notícias nas últimas 24 horas. O resumo precisa de ${MIN_RESUMO}.`, `Only ${r.encontradas} stories in the last 24 hours. The roundup needs ${MIN_RESUMO}.`) }, 409);
  return c.json(r, r.situacao === 'nova' ? 201 : 200);
})

// Fonte RSS nova (só admin). Idempotente por (tenant, url): a mesma URL devolve a fonte que já existe (200), sem
// duplicar. A coleta só entra no próximo cron.
.post('/t/:tenantId/fontes', requireMembro('admin'), async (c) => {
  const tenantId = c.get('tenant').id;
  const b = await lerJson<{ nome: string; url: string }>(c);
  const nome = String(b.nome ?? '').trim();
  if (nome.length < 2 || nome.length > 80) return c.json({ erro: t(c, 'nome entre 2 e 80 caracteres', 'name must be 2 to 80 characters') }, 400);
  const url = urlDeFonte(b.url);
  if (!url) return c.json({ erro: t(c, 'url: endereço http(s) completo do feed', 'url: the full http(s) address of the feed') }, 400);
  // Índice único (tenant_id, url): dois pedidos ao mesmo tempo não criam duas fontes; quem perde recebe a existente.
  const id = novoId();
  const nova = await c.env.DB.prepare("INSERT INTO fontes (id, tenant_id, tipo, nome, url) VALUES (?, ?, 'rss', ?, ?) ON CONFLICT (tenant_id, url) DO NOTHING RETURNING id")
    .bind(id, tenantId, nome, url).first<{ id: string }>();
  if (nova) return c.json({ id, nome, url, ativo: true, existia: false }, 201);
  const existente = (await c.env.DB.prepare('SELECT id, nome, url, ativo FROM fontes WHERE tenant_id = ? AND url = ?').bind(tenantId, url)
    .first<{ id: string; nome: string; url: string; ativo: number }>())!;
  return c.json({ id: existente.id, nome: existente.nome, url: existente.url, ativo: existente.ativo === 1, existia: true });
})

// Pausar ou retomar uma fonte (só admin). Retomar zera as falhas: a fonte volta para a fila do cron.
.patch('/t/:tenantId/fontes/:id', requireMembro('admin'), async (c) => {
  const tenantId = c.get('tenant').id;
  const b = await lerJson<{ ativo?: boolean; propria?: boolean }>(c);
  // "Este é o site do veículo": vale para o que sair daqui em diante. Veículo autoral já lê tudo o que é dele.
  if (typeof b.propria === 'boolean') {
    const modo = await c.env.DB.prepare('SELECT modo FROM tenants WHERE id = ?').bind(tenantId).first<{ modo: string }>();
    if (modo?.modo === 'autoral') return c.json({ erro: t(c, 'veículo autoral não tem site próprio como fonte', "an author outlet doesn't mark its own site as a source") }, 400);
    const row = await c.env.DB.prepare("UPDATE fontes SET propria_desde = ? WHERE id = ? AND tenant_id = ? AND tipo != 'manual' RETURNING id, propria_desde")
      .bind(b.propria ? new Date().toISOString() : null, c.req.param('id'), tenantId).first<{ id: string; propria_desde: string | null }>();
    if (!row) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
    return c.json({ id: row.id, propria: !!row.propria_desde });
  }
  if (typeof b.ativo !== 'boolean') return c.json({ erro: 'ativo: true | false' }, 400);
  const row = await c.env.DB.prepare(`UPDATE fontes SET ativo = ?, falhas = CASE WHEN ? THEN 0 ELSE falhas END WHERE id = ? AND tenant_id = ? AND tipo != 'manual' RETURNING id, ativo`)
    .bind(b.ativo ? 1 : 0, b.ativo ? 1 : 0, c.req.param('id'), tenantId).first<{ id: string; ativo: number }>();
  if (!row) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  return c.json({ id: row.id, ativo: row.ativo === 1 });
})

// Cobertura (veículo local): os municípios de tenant_areas, na ordem em que entraram. A triagem só aceita notícia
// dessas cidades. Qualquer membro vê; só o admin acrescenta ou tira.
.get('/t/:tenantId/areas', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT municipio_ibge AS ibge, MAX(municipio_nome) AS nome FROM tenant_areas WHERE tenant_id = ?
      GROUP BY municipio_ibge ORDER BY MIN(rowid)`,
  ).bind(c.get('tenant').id).all<{ ibge: string; nome: string | null }>();
  return c.json({ areas: results });
})

// Acrescentar um município (só admin, só veículo local). Idempotente por (tenant, município): de novo devolve 200.
.post('/t/:tenantId/areas', requireMembro('admin'), async (c) => {
  const tenantId = c.get('tenant').id;
  const b = await lerJson<{ municipioIbge: string; municipioNome: string }>(c);
  const ibge = typeof b.municipioIbge === 'string' ? b.municipioIbge.trim() : '';
  const nome = typeof b.municipioNome === 'string' ? b.municipioNome.trim() : '';
  if (!/^\d{7}$/.test(ibge)) return c.json({ erro: t(c, 'municipioIbge: código IBGE de 7 dígitos', 'municipioIbge: 7-digit IBGE code') }, 400);
  if (nome.length < 2 || nome.length > 80) return c.json({ erro: t(c, 'municipioNome: entre 2 e 80 caracteres (como aparece nas notícias)', 'municipioNome: 2 to 80 characters (as it appears in the news)') }, 400);
  const tenant = await c.env.DB.prepare('SELECT modo FROM tenants WHERE id = ?').bind(tenantId).first<{ modo: string }>();
  if (tenant?.modo !== 'local') return c.json({ erro: t(c, `veículo ${tenant?.modo === 'autoral' ? 'de autor' : 'temático'} não tem cobertura por cidade`, `${tenant?.modo === 'autoral' ? 'author' : 'topic-based'} publications have no city coverage`) }, 409);
  // Um statement só: dois pedidos iguais ao mesmo tempo não duplicam (o PK com bairro NULL não impede).
  const r = await c.env.DB.prepare(
    `INSERT INTO tenant_areas (tenant_id, municipio_ibge, municipio_nome, bairro)
       SELECT ?, ?, ?, NULL WHERE NOT EXISTS (SELECT 1 FROM tenant_areas WHERE tenant_id = ? AND municipio_ibge = ?)`,
  ).bind(tenantId, ibge, nome, tenantId, ibge).run();
  return c.json({ ibge, nome, existia: !r.meta.changes }, r.meta.changes ? 201 : 200);
})

// Tirar um município (só admin). A última cidade não sai (409): veículo local sem cidade não recebe nenhuma notícia.
.delete('/t/:tenantId/areas/:ibge', requireMembro('admin'), async (c) => {
  const tenantId = c.get('tenant').id;
  const ibge = c.req.param('ibge');
  // Num batch (transação): tirar e, se o principal (seletor, fallback da pauta) deixou de ser coberto, passar a
  // primeira cidade que ficou a principal, com a UF. Duas remoções ao mesmo tempo não deixam principal descoberto.
  const primeira = `(SELECT municipio_ibge FROM tenant_areas WHERE tenant_id = ? ORDER BY rowid LIMIT 1)`;
  const [r] = await c.env.DB.batch([
    c.env.DB.prepare(
      `DELETE FROM tenant_areas WHERE tenant_id = ? AND municipio_ibge = ?
         AND (SELECT COUNT(DISTINCT municipio_ibge) FROM tenant_areas WHERE tenant_id = ?) > 1 RETURNING municipio_ibge`,
    ).bind(tenantId, ibge, tenantId),
    c.env.DB.prepare(
      `UPDATE tenants SET municipio_ibge = ${primeira}, uf = ${ufSql(primeira)}
        WHERE id = ? AND modo = 'local' AND municipio_ibge NOT IN (SELECT municipio_ibge FROM tenant_areas WHERE tenant_id = ?)`,
    ).bind(tenantId, tenantId, tenantId, tenantId),
  ]);
  if (r.results.length) return c.json({ ibge });
  const existe = await c.env.DB.prepare('SELECT 1 AS ok FROM tenant_areas WHERE tenant_id = ? AND municipio_ibge = ? LIMIT 1').bind(tenantId, ibge).first();
  return existe ? c.json({ erro: t(c, 'a última cidade não sai: o veículo precisa cobrir pelo menos uma', "the last city can't be removed: the publication must cover at least one") }, 409) : c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
})

// Log do tenant por cursor: polling da UI pede `?desde=<último id visto>`.
.get('/t/:tenantId/eventos', async (c) => {
  const desde = Math.max(0, Number(c.req.query('desde') ?? 0) || 0);
  const limite = Math.min(500, Math.max(1, Number(c.req.query('limite') ?? 100) || 100));
  const { results } = await c.env.DB.prepare('SELECT id, tipo, ref_tipo, ref_id, payload_json, created_at FROM eventos WHERE tenant_id = ? AND id > ? ORDER BY id LIMIT ?')
    .bind(c.get('tenant').id, desde, limite).all<{ id: number; tipo: string; ref_tipo: string; ref_id: string; payload_json: string | null; created_at: string }>();
  return c.json({
    eventos: results.map((e) => ({ id: e.id, tipo: e.tipo, refTipo: e.ref_tipo, refId: e.ref_id, em: e.created_at, payload: e.payload_json ? JSON.parse(e.payload_json) : null })),
    cursor: results.at(-1)?.id ?? desde,
  });
});

/** Tipo da API para o cliente RPC da UI (`hc<AppType>`, só `import type`). */
export type AppType = typeof api;
