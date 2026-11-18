import { ErroMesa } from './lib/mesa';
import { paginaDoVeiculo } from './lib/paginaVeiculo';
import { assinaturaValida, processarEvento } from './lib/stripe';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env, MonitorMessage } from './env';
import { scheduled } from './monitor/scheduled';
import { queue } from './monitor/consumer';
import { verificarMedia } from './lib/crypto';
import { SemConta } from './lib/publicar';
import { TransicaoInvalida } from './kernel/estados';
import { criarAuth } from './shell/auth';
import { api } from './shell/api';
import { exigirMesmaOrigem, exigirSessao, type AppEnv } from './shell/tenancy';
import { idiomaDe, t } from './shell/idioma';
import { paginaPublica, receberEmail } from './lib/escudo';
import { CABECALHOS_ANUNCIO, decidirAnuncio, paginaAnuncio } from './lib/anuncio';
import { entrarNaLista, lerCadastro } from './lib/listaEspera';
import { instalacaoPropria } from './lib/planos';

export { ProducaoWorkflow } from './workflows/producao';
export { PublicacaoWorkflow } from './workflows/publicacao';
export { ReelsContainer } from './reelsContainer';

const app = new Hono<AppEnv>();

app.get('/health', (c) => c.json({ ok: true }));

// Better Auth: cadastro, login (e-mail/senha, Google), sessão, logout. Instância por request (D1 é do request).
app.on(['GET', 'POST'], '/api/auth/*', (c) => criarAuth(c.env).handler(c.req.raw));

// Convite de equipe, lido sem sessão pela tela de criar conta (o id é aleatório; só diz e-mail, papel e veículo).
app.get('/api/convites/:id', async (c) => {
  const row = await c.env.DB.prepare(
    'SELECT c.email, c.papel, c.aceito_em, t.nome AS veiculo, t.slug FROM convites c JOIN tenants t ON t.id = c.tenant_id WHERE c.id = ?',
  ).bind(c.req.param('id')).first<{ email: string; papel: string; aceito_em: string | null; veiculo: string; slug: string }>();
  if (!row) return c.json({ erro: t(c, 'não encontrado', 'not found') }, 404);
  return c.json({ email: row.email, papel: row.papel, veiculo: row.veiculo, slug: row.slug, aceito: row.aceito_em !== null });
});

// Página de fontes pública ("Como apuramos"): sem sessão, só o retrato congelado que o editor publicou.
// Webhook da Stripe: sem sessão, e a prova é a assinatura sobre o corpo cru. Antes do middleware de /api/*.
app.post('/stripe/webhook', async (c) => {
  const segredo = c.env.STRIPE_WEBHOOK_SECRET;
  if (!segredo) return c.json({ erro: 'cobrança não configurada' }, 404);
  const corpo = await c.req.text();
  if (!(await assinaturaValida(segredo, corpo, c.req.header('stripe-signature')))) return c.json({ erro: 'assinatura inválida' }, 400);
  return c.json({ recebido: await processarEvento(c.env, JSON.parse(corpo)) });
});

app.get('/fontes/:id', async (c) => {
  const html = await paginaPublica(c.env, c.req.param('id'));
  if (!html) return c.html('<!DOCTYPE html><html lang="pt-BR"><meta charset="utf-8"><title>Página não encontrada</title><p>Esta página de fontes não existe ou saiu do ar.</p></html>', 404);
  return c.html(html, 200, { 'cache-control': 'public, max-age=300' });
});

// Página pública do veículo: desligada por padrão. Desligada ou inexistente dá a mesma resposta.
app.get('/v/:slug', async (c) => {
  const html = await paginaDoVeiculo(c.env, c.req.param('slug'), Number(c.req.query('p') ?? 1));
  if (!html) return c.html('<!DOCTYPE html><html lang="pt-BR"><meta charset="utf-8"><title>Página não encontrada</title><p>Esta página não existe ou saiu do ar.</p></html>', 404);
  return c.html(html, 200, { 'cache-control': 'no-cache' });
});

// Aprovação do anunciante: sem sessão, com o token do link. O GET nunca decide (o WhatsApp abre o link para a prévia).
app.get('/anuncio/:token', async (c) => {
  const r = await paginaAnuncio(c.env, c.req.param('token'));
  return c.html(r.html, r.status, CABECALHOS_ANUNCIO);
});
app.post('/anuncio/:token', async (c) => {
  const form = await c.req.parseBody().catch(() => ({} as Record<string, unknown>));
  const r = await decidirAnuncio(c.env, c.req.param('token'), form.decisao, form.comentario);
  return c.html(r.html, r.status, CABECALHOS_ANUNCIO);
});

// Instalação própria: a "/" sem sessão vai a /entrar, e não à lista de espera (web/src/telas/Inicio.tsx). Pública, antes da sessão.
app.get('/api/instalacao', (c) => c.json({ propria: instalacaoPropria(c.env) }));

// Lista de espera: pública, antes da sessão. O campo `site` é isca: robô que preenche recebe a resposta de sempre.
app.post('/api/lista-espera', exigirMesmaOrigem, async (c) => {
  const corpo = await c.req.json<{ site?: unknown }>().catch(() => null);
  if (corpo?.site) return c.json({ ok: true });
  const cadastro = lerCadastro(corpo);
  if (!cadastro) return c.json({ erro: t(c, 'Confira o e-mail: ele parece incompleto.', 'Check the email: it looks incomplete.') }, 400);
  const entrou = await entrarNaLista(c.env, cadastro, idiomaDe(c), c.req.header('cf-connecting-ip') ?? '');
  if (!entrou) return c.json({ erro: t(c, 'Muitos cadastros seguidos desta conexão. Tente de novo em uma hora.', 'Too many sign-ups in a row from this connection. Try again in an hour.') }, 429);
  return c.json({ ok: true });
});

// Resto da API: mesma origem em mutação + sessão obrigatória. Tenancy fica nas rotas /api/t/:tenantId/*.
app.use('/api/*', exigirMesmaOrigem, exigirSessao);
app.route('/api', api);

// Arte no R2. Só com URL assinada (assinarMedia): Instagram baixa daqui ao criar o container; o painel usa a mesma coisa.
app.get('/media/*', async (c) => {
  const key = decodeURIComponent(c.req.path.replace(/^\/media\//, ''));
  if (!(await verificarMedia(c.env, key, c.req.query('exp'), c.req.query('sig')))) return c.json({ erro: t(c, 'assinatura inválida ou expirada', 'invalid or expired signature') }, 403);
  // Range (o player de vídeo pede pedaços para pular no tempo): 206 com Content-Range.
  const pedido = c.req.header('range');
  const obj = await c.env.MEDIA.get(key, pedido ? { range: c.req.raw.headers } : undefined).catch(() => undefined);
  if (obj === undefined) return new Response(null, { status: 416, headers: { 'accept-ranges': 'bytes' } });
  if (!obj) return c.notFound();
  const headers: Record<string, string> = {
    'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream', 'cache-control': 'private, max-age=3600', 'accept-ranges': 'bytes',
  };
  const faixa = obj.range as { offset?: number; length?: number } | undefined;
  if (pedido && faixa && faixa.offset !== undefined && faixa.length !== undefined) {
    headers['content-range'] = `bytes ${faixa.offset}-${faixa.offset + faixa.length - 1}/${obj.size}`;
    headers['content-length'] = String(faixa.length);
    return new Response(obj.body, { status: 206, headers });
  }
  return new Response(obj.body, { headers });
});

app.onError((e, c) => {
  if (e instanceof ErroMesa && e.status === 402) return c.json({ erro: t(c, e.message, e.en ?? e.message), code: e.codigo }, 402);
  if (e instanceof TransicaoInvalida) return c.json({ erro: e.de === null ? t(c, 'não encontrado', 'not found') : t(c, e.message, e.en) }, e.de === null ? 404 : 409);
  if (e instanceof SemConta) return c.json({ erro: t(c, e.message, e.en ?? e.message) }, 409);
  if (e instanceof HTTPException) return e.getResponse();
  console.error(e);
  return c.json({ erro: t(c, 'erro interno', 'internal error') }, 500);
});

// E-mail que chega (Email Routing): a resposta a um pedido de outro lado (outro-lado+token@…) entra no dossiê.
export default { fetch: app.fetch, scheduled, queue, email: receberEmail } satisfies ExportedHandler<Env, MonitorMessage>;
