import type { Env } from '../env';
import type { ModoConta } from '../kernel/estados';
import { assinarMedia, decifrarToken } from './crypto';
import type { ArteRenderizada } from './render';
import type { ArteReels } from './reels';
import type { Rascunho } from './redacao';

export interface Publicacao {
  rede: 'instagram';
  externalId: string;
  url?: string;
  simulada?: boolean;
  chamadas?: ChamadaGraph[];      // modo simulada: o que teria sido enviado. Quem grava o evento é o Workflow.
}

export interface Conta { id: string; rede: string; external_id: string | null; token_enc: string | null; modo: ModoConta; provedor: string | null; provedor_ref: string | null }

/** Uma chamada HTTP à Graph API, como seria enviada (token redigido). Em modo simulado é o que vai pro log. */
export interface ChamadaGraph { metodo: 'GET' | 'POST'; url: string; body?: Record<string, string>; resposta?: Record<string, any> }

// https://developers.facebook.com/documentation/instagram-platform/content-publishing (v26.0 em 2026-10)
const GRAPH = 'https://graph.facebook.com/v26.0';
const LIMITE_LEGENDA = 2200;
const URL_TTL_S = 60 * 60 * 2;   // Meta baixa a imagem na criação do container; 2 h cobre retries do step.
const POLL_MS = 2000;
const POLL_MAX = 30;
// Vídeo: a Meta baixa e processa o MP4 (segundos a alguns minutos). 5 s × 72 = 6 min.
const POLL_REELS_MS = 5000;
const POLL_REELS_MAX = 72;
const REELS_THUMB_OFFSET_MS = '1500';

/** Conta Instagram ativa do tenant. Com `contaId`, só ela; sem, a preferida: real > intermediario > manual > simulada. */
export async function carregarConta(env: Env, tenantId: string, contaId?: string | null): Promise<Conta> {
  const cols = 'id, rede, external_id, token_enc, modo, provedor, provedor_ref';
  const conta = contaId
    ? await env.DB.prepare(`SELECT ${cols} FROM contas_sociais WHERE id = ? AND tenant_id = ? AND rede = 'instagram' AND status = 'ativa'`).bind(contaId, tenantId).first<Conta>()
    : await env.DB.prepare(`SELECT ${cols} FROM contas_sociais WHERE tenant_id = ? AND rede = 'instagram' AND status = 'ativa'
        ORDER BY CASE modo WHEN 'real' THEN 0 WHEN 'intermediario' THEN 1 WHEN 'manual' THEN 2 ELSE 3 END, created_at LIMIT 1`).bind(tenantId).first<Conta>();
  if (!conta) throw new SemConta(
    contaId ? `conta ${contaId} não encontrada ou inativa` : 'tenant sem conta Instagram ativa',
    contaId ? `account ${contaId} not found or inactive` : 'publication has no active Instagram account',
  );
  return conta;
}

export class SemConta extends Error {
  name = 'SemConta';
  /** `en`: a mesma mensagem em inglês (a API escolhe pelo idioma do pedido; `message` é o português). */
  constructor(message: string, readonly en?: string) { super(message); }
}

/**
 * Tudo que o operador precisa pra publicar à mão: JPEGs assinados (24 h) + legenda. Também serve ao intermediário.
 * Reels: `video` é o MP4 assinado (24 h), `imagens` traz só a capa da tela e `capa` é o JPEG 9:16 publicado (null em Reels antigo).
 */
export async function pacoteDePublicacao(env: Env, tenantId: string, pecaId: string) {
  const peca = await env.DB.prepare('SELECT formato, conteudo_json, arte_r2_keys_json FROM pecas WHERE id = ? AND tenant_id = ?')
    .bind(pecaId, tenantId).first<{ formato: string; conteudo_json: string; arte_r2_keys_json: string | null }>();
  if (!peca) return null;
  if (!peca.arte_r2_keys_json) throw new Error('peça sem arte renderizada');
  const rascunho = JSON.parse(peca.conteudo_json) as Rascunho;
  const artes = JSON.parse(peca.arte_r2_keys_json) as ArteRenderizada[];
  const legenda = rascunho.legenda.length > LIMITE_LEGENDA ? `${rascunho.legenda.slice(0, LIMITE_LEGENDA - 1)}…` : rascunho.legenda;
  const imagens = await Promise.all(artes.map(async (a) => ({ papel: a.papel, jpg: await assinarMedia(env, a.jpg, 24 * 3600) })));
  const mp4 = peca.formato === 'reels' ? (artes[0] as Partial<ArteReels> | undefined)?.mp4 : undefined;
  if (peca.formato === 'reels' && !mp4) throw new Error('reels sem vídeo montado');
  const capaReels = peca.formato === 'reels' ? (artes[0] as Partial<ArteReels>).capaReels : undefined;
  return { formato: peca.formato, legenda, imagens, video: mp4 ? await assinarMedia(env, mp4, 24 * 3600) : null, capa: capaReels ? await assinarMedia(env, capaReels, 24 * 3600) : null };
}

/**
 * Publicação automática. Modo 'real': Instagram Graph API em 2 passos (container → publish); carrossel = N filhos + 1 pai.
 * Modo 'simulada': monta as mesmas chamadas e devolve em `chamadas`, não envia. Modo 'manual' nunca chega aqui (o Workflow
 * espera o operador). Modo 'intermediario': adaptador por provedor (Ayrshare; PostPeer e Zernio depois).
 * `fazerFetch` é injetável (testes); o padrão é o fetch global.
 */
export async function publicar(env: Env, input: { tenantId: string; pecaId: string; conta: Conta }, fazerFetch: typeof fetch = (...a) => fetch(...a)): Promise<Publicacao> {
  const { conta } = input;
  if (conta.modo === 'manual') throw new Error('conta em modo manual: publicação é do operador, não do Workflow');
  if (conta.modo === 'intermediario') {
    if (conta.provedor !== 'ayrshare') throw new Error(`intermediário '${conta.provedor ?? '?'}' ainda não implementado`);
    return publicarAyrshare(env, input, fazerFetch);
  }

  const pacoteOuNada = await pacoteDePublicacao(env, input.tenantId, input.pecaId);
  if (!pacoteOuNada) throw new Error(`peça ${input.pecaId} não encontrada`);
  const { formato, legenda, imagens: pacote, video, capa } = pacoteOuNada;
  const imagens = pacote.map((i) => i.jpg);   // IG exige JPEG e URL pública

  const simulada = conta.modo === 'simulada';
  const igUserId = conta.external_id ?? (simulada ? 'IG_USER_ID' : null);
  if (!igUserId) throw new Error(`conta ${conta.id} sem external_id (id da conta profissional do Instagram)`);
  const token = simulada ? 'TOKEN_REDIGIDO' : await decifrarToken(env, conta.token_enc ?? '');
  const graph = new Graph(token, simulada);

  // 1. containers filhos (carrossel), vídeo (Reels) ou único (post)
  let criacaoId: string;
  if (formato === 'reels' && video) {
    // Sem capa nem offset a Meta usa o frame 0, e o Reels antigo abre sem título: em 1,5 s o texto já entrou.
    const quadro: Record<string, string> = capa ? { cover_url: capa } : { thumb_offset: REELS_THUMB_OFFSET_MS };
    criacaoId = (await graph.post(`${igUserId}/media`, { media_type: 'REELS', video_url: video, caption: legenda, share_to_feed: 'true', ...quadro })).id;
  } else if (formato === 'carrossel' && imagens.length > 1) {
    const filhos: string[] = [];
    for (const image_url of imagens) filhos.push((await graph.post(`${igUserId}/media`, { image_url, is_carousel_item: 'true' })).id);
    criacaoId = (await graph.post(`${igUserId}/media`, { media_type: 'CAROUSEL', children: filhos.join(','), caption: legenda })).id;
  } else {
    criacaoId = (await graph.post(`${igUserId}/media`, { image_url: imagens[0], caption: legenda })).id;
  }

  // 2. container precisa estar FINISHED antes do publish (Meta baixa e processa a imagem ou o vídeo de forma assíncrona)
  const [pollMs, pollMax] = formato === 'reels' ? [POLL_REELS_MS, POLL_REELS_MAX] : [POLL_MS, POLL_MAX];
  for (let i = 0; i < pollMax; i++) {
    const st = await graph.get(`${criacaoId}`, { fields: 'status_code,status' });
    if (st.status_code === 'FINISHED') break;
    if (st.status_code === 'ERROR' || st.status_code === 'EXPIRED') throw new Error(`container ${criacaoId}: ${st.status_code} ${st.status ?? ''}`);
    if (i === pollMax - 1) throw new Error(`container ${criacaoId} não ficou pronto em ${(pollMs * pollMax) / 1000}s`);
    await new Promise((r) => setTimeout(r, pollMs));
  }

  // 3. publish → id da mídia → permalink
  const midia = await graph.post(`${igUserId}/media_publish`, { creation_id: criacaoId });
  const info = await graph.get(`${midia.id}`, { fields: 'permalink' });

  return { rede: 'instagram', externalId: midia.id, url: info.permalink, simulada, ...(simulada ? { chamadas: graph.log } : {}) };
}

/** Cliente mínimo. Em modo simulado devolve respostas plausíveis e registra cada chamada com token redigido. */
class Graph {
  readonly log: ChamadaGraph[] = [];
  private seq = 0;
  constructor(private token: string, private simulada: boolean) {}

  async post(path: string, body: Record<string, string>) { return this.call('POST', path, body); }
  async get(path: string, query: Record<string, string>) { return this.call('GET', path, query); }

  private async call(metodo: 'GET' | 'POST', path: string, params: Record<string, string>): Promise<Record<string, any>> {
    const url = `${GRAPH}/${path}`;
    if (this.simulada) {
      const resposta = this.fingir(path, params);
      this.log.push({ metodo, url, body: params, resposta });
      return resposta;
    }
    const form = new URLSearchParams({ ...params, access_token: this.token });
    const res = metodo === 'GET'
      ? await fetch(`${url}?${form}`, { signal: AbortSignal.timeout(30_000) })
      : await fetch(url, { method: 'POST', body: form, signal: AbortSignal.timeout(30_000) });
    const data = await res.json<Record<string, any>>().catch((): Record<string, any> => ({}));
    if (!res.ok || data.error) throw new Error(`graph ${metodo} ${path} → ${res.status}: ${JSON.stringify(data.error ?? data).slice(0, 400)}`);
    return data;
  }

  private fingir(path: string, params: Record<string, string>): Record<string, any> {
    this.seq++;
    if (path.endsWith('/media_publish')) return { id: `sim_media_${params.creation_id}` };
    if (path.endsWith('/media')) return { id: `sim_container_${this.seq}` };
    if (params.fields?.includes('status_code')) return { status_code: 'FINISHED', id: path };
    if (params.fields?.includes('permalink')) return { permalink: `https://www.instagram.com/p/SIMULADO_${path.replace(/\W/g, '').slice(-8)}/`, id: path };
    return { id: path };
  }
}

// ── intermediário: Ayrshare ─────────────────────────────────────────────────────────────────────────────────────
// https://www.ayrshare.com/docs/apis/post/post — POST /api/post com a chave da API (Bearer) e o perfil do cliente
// (`Profile-Key` = provedor_ref). A Ayrshare baixa as imagens das URLs assinadas (24 h) e publica com o app dela.
const AYRSHARE = 'https://api.ayrshare.com/api/post';

async function publicarAyrshare(env: Env, input: { tenantId: string; pecaId: string; conta: Conta }, fazerFetch: typeof fetch): Promise<Publicacao> {
  const { conta } = input;
  const pacote = await pacoteDePublicacao(env, input.tenantId, input.pecaId);
  if (!pacote) throw new Error(`peça ${input.pecaId} não encontrada`);
  if (!conta.token_enc) throw new Error(`conta ${conta.id} sem chave da API do Ayrshare`);
  if (pacote.formato === 'reels') throw new Error('o Reels ainda não sai pelo intermediário: use a conta manual ou a conexão direta');
  const chave = await decifrarToken(env, conta.token_enc);
  const imagens = pacote.formato === 'carrossel' ? pacote.imagens : pacote.imagens.slice(0, 1);
  const headers: Record<string, string> = { authorization: `Bearer ${chave}`, 'content-type': 'application/json' };
  if (conta.provedor_ref) headers['profile-key'] = conta.provedor_ref;
  const res = await fazerFetch(AYRSHARE, {
    method: 'POST', headers, signal: AbortSignal.timeout(60_000),
    // Chave de idempotência = a peça: se a resposta de um envio aceito se perder, a retentativa do Workflow não posta
    // de novo (a Ayrshare recusa a chave repetida).
    body: JSON.stringify({ post: pacote.legenda, platforms: ['instagram'], mediaUrls: imagens.map((i) => i.jpg), idempotencyKey: `redacao-${input.pecaId}` }),
  });
  const data = await res.json<Record<string, any>>().catch((): Record<string, any> => ({}));
  // Com Profile-Key a resposta vem por perfil (`posts[].postIds`); sem, `postIds` fica na raiz. Os dois formatos valem.
  const postIds = [data, ...(Array.isArray(data.posts) ? data.posts : [])].flatMap((d: Record<string, any>) => (Array.isArray(d?.postIds) ? d.postIds : []));
  const ig = postIds.find((p: Record<string, any>) => p?.platform === 'instagram') as Record<string, any> | undefined;
  // A mensagem de erro vem só do que a Ayrshare devolveu (nunca da chave nem dos headers).
  if (!res.ok || data.status === 'error' || !ig || ig.status === 'error') {
    const msg = String(data.message ?? ig?.message ?? data.errors?.[0]?.message ?? '').replace(chave, '[chave]').slice(0, 300);
    // Chave repetida: um envio anterior desta peça foi aceito. Não é falha de postagem nova; o post pode já estar lá.
    if (/idempoten/i.test(msg)) throw new Error(`ayrshare: esta peça já foi enviada antes (chave de idempotência repetida); confira no Instagram antes de tentar de novo`);
    throw new Error(`ayrshare ${res.status}: ${msg || 'sem detalhe'}`);
  }
  const externalId = String(ig.id ?? data.id ?? '');
  if (!externalId) throw new Error('ayrshare: resposta sem id do post');
  const url = typeof ig.postUrl === 'string' && /^https:\/\//.test(ig.postUrl) ? ig.postUrl : undefined;
  return { rede: 'instagram', externalId, ...(url ? { url } : {}) };
}
