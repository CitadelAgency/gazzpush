// Qual chave cada chamada de modelo usa. Ordem: a chave do veículo (aba Chaves de IA, cifrada em `chaves_ia`), depois a do
// servidor (as variáveis de sempre), e sem nenhuma a função fica desligada, com o motivo na tela. Instalação que só tem as
// variáveis do servidor segue igual. Texto e imagem têm dois provedores: vale primeiro a chave do veículo (a escolhida antes),
// depois a do servidor (a escolhida antes). A chave em claro só existe na memória do pedido: nunca em log, erro, evento,
// resposta de API ou resultado de passo do Workflow.
import type { Env } from '../env';
import { decifrarToken } from './crypto';
import { ErroMesa } from './mesa';
import { IDS_PROVEDORES, PROVEDORES, PROVEDORES_IMAGEM, PROVEDORES_TEXTO, ehProvedor, type Provedor, type ProvedorImagem, type ProvedorTexto } from './provedoresTabela';

export type OrigemChave = 'veiculo' | 'servidor';
export interface ChaveUsada<P extends Provedor = Provedor> { provedor: P; chave: string; origem: OrigemChave }
export interface ChavesVeiculo {
  texto: ChaveUsada<ProvedorTexto> | null;
  segunda: ChaveUsada<'anthropic'> | null;
  imagem: ChaveUsada<ProvedorImagem> | null;
  escolha: { texto: ProvedorTexto; imagem: ProvedorImagem };
}

const gateway = (env: Env, provedor: string) => `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.AI_GATEWAY_ID}/${provedor}`;

/** Base do Gemini: GEMINI_URL (teste), o AI Gateway (google-ai-studio) ou a API direta. */
export const baseGemini = (env: Env) => env.GEMINI_URL ? env.GEMINI_URL.replace(/\/$/, '') : env.AI_GATEWAY_ID ? gateway(env, 'google-ai-studio') : 'https://generativelanguage.googleapis.com';
/** Base do fal síncrono (fal.run): FAL_URL (teste), o AI Gateway ou a API direta. */
export const baseFal = (env: Env) => env.FAL_URL ? env.FAL_URL.replace(/\/$/, '') : env.AI_GATEWAY_ID ? gateway(env, 'fal') : 'https://fal.run';

export const chaveDoServidor = (env: Env, p: Provedor): string | null => {
  const v = (env as unknown as Record<string, unknown>)[PROVEDORES[p].variavel];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
};

const escolhaTexto = (v: unknown): ProvedorTexto => ((PROVEDORES_TEXTO as readonly string[]).includes(v as string) ? v as ProvedorTexto : 'deepseek');
const escolhaImagem = (v: unknown): ProvedorImagem => ((PROVEDORES_IMAGEM as readonly string[]).includes(v as string) ? v as ProvedorImagem : 'kie');

/**
 * As chaves do veículo, resolvidas uma vez por operação (a conferência confere vários blocos com o mesmo objeto). Veículo
 * que não existe (teste, tarefa de veículo apagado) cai nas chaves do servidor. Chave que não decifra (TOKEN_ENC_KEY trocada)
 * conta como ausente.
 */
export async function chavesDoVeiculo(env: Env, tenantId: string): Promise<ChavesVeiculo> {
  // Sem veículo (pedido de teste montado à mão): só as chaves do servidor.
  const [t, k] = tenantId ? await env.DB.batch([
    env.DB.prepare('SELECT provedor_texto, provedor_imagem FROM tenants WHERE id = ?').bind(tenantId),
    env.DB.prepare('SELECT provedor, chave_enc FROM chaves_ia WHERE tenant_id = ?').bind(tenantId),
  ]) : [{ results: [] }, { results: [] }];
  const escolha = (t.results[0] ?? {}) as { provedor_texto?: string; provedor_imagem?: string };
  const doVeiculo = new Map<Provedor, string>();
  for (const r of k.results as { provedor: string; chave_enc: string }[]) {
    if (!ehProvedor(r.provedor)) continue;
    try {
      doVeiculo.set(r.provedor, await decifrarToken(env, r.chave_enc));
    } catch {
      console.error('chave de IA do veículo não decifra', tenantId, r.provedor);
    }
  }
  function resolver<P extends Provedor>(ordem: readonly P[]): ChaveUsada<P> | null {
    for (const p of ordem) { const c = doVeiculo.get(p); if (c) return { provedor: p, chave: c, origem: 'veiculo' }; }
    for (const p of ordem) { const c = chaveDoServidor(env, p); if (c) return { provedor: p, chave: c, origem: 'servidor' }; }
    return null;
  }
  const texto = escolhaTexto(escolha.provedor_texto), imagem = escolhaImagem(escolha.provedor_imagem);
  return {
    texto: resolver([texto, ...PROVEDORES_TEXTO.filter((p) => p !== texto)]),
    segunda: resolver(['anthropic'] as const),
    imagem: resolver([imagem, ...PROVEDORES_IMAGEM.filter((p) => p !== imagem)]),
    escolha: { texto, imagem },
  };
}

/** Sem chave de texto nenhuma: a porta do post e a da conferência barram, como o limite do plano (402, a fila não perde a pauta). */
export const erroSemChaveTexto = () => new ErroMesa('sem_chave_texto',
  'Falta a chave de IA de texto deste veículo. O admin cola a chave em Veículo, na aba Chaves de IA.', 402,
  "This outlet is missing its AI text key. The admin pastes the key in Publication, under the AI keys tab.");

export async function exigirChaveTexto(env: Env, tenantId: string) {
  const chaves = await chavesDoVeiculo(env, tenantId);
  if (!chaves.texto) throw erroSemChaveTexto();
  return chaves;
}

// ── conferir uma chave antes de guardar ───────────────────────────────────────────────────────────────────────────────

export type ResultadoConferencia = 'aceita' | 'recusada' | 'sem_resposta';

/**
 * Uma chamada que não gera nada (a lista de modelos, o saldo) para saber se o provedor aceita a chave. 401 e 403 (no Gemini,
 * também 400, que é como a Google responde chave inválida) são recusa; outra falha é "sem resposta", e a chave não é guardada
 * nos dois casos. A resposta do provedor não sai daqui: pode ecoar a chave.
 */
export async function conferirChave(env: Env, p: Provedor, chave: string): Promise<ResultadoConferencia> {
  const pedido = pedidoDeConferencia(env, p, chave);
  let res: Response;
  try {
    res = await fetch(pedido.url, { headers: pedido.headers, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
  } catch {
    return 'sem_resposta';
  }
  const corpo = await res.text().catch(() => '');
  if (pedido.recusa.includes(res.status)) return 'recusada';
  if (p === 'kie' && res.ok) {
    // A Kie responde 200 com o código no corpo.
    const codigo = Number((() => { try { return (JSON.parse(corpo) as { code?: unknown }).code; } catch { return NaN; } })());
    return codigo === 200 ? 'aceita' : codigo === 401 || codigo === 403 ? 'recusada' : 'sem_resposta';
  }
  return res.ok || pedido.aceita.includes(res.status) ? 'aceita' : 'sem_resposta';
}

// Pedido sem custo. fal não tem rota pública de conferir chave: o status de um pedido que não existe responde 404 com a chave
// aceita e 401/403 com a recusada.
function pedidoDeConferencia(env: Env, p: Provedor, chave: string): { url: string; headers: Record<string, string>; recusa: number[]; aceita: number[] } {
  switch (p) {
    case 'deepseek':
      return { url: env.DEEPSEEK_URL ? env.DEEPSEEK_URL.replace(/\/chat\/completions$/, '/models') : 'https://api.deepseek.com/models', headers: { authorization: `Bearer ${chave}` }, recusa: [401, 403], aceita: [] };
    case 'gemini':
      return { url: `${env.GEMINI_URL ? env.GEMINI_URL.replace(/\/$/, '') : 'https://generativelanguage.googleapis.com'}/v1beta/models?pageSize=1`, headers: { 'x-goog-api-key': chave }, recusa: [400, 401, 403], aceita: [] };
    case 'anthropic':
      return { url: `${env.SEGUNDA_URL ? env.SEGUNDA_URL.replace(/\/$/, '') : 'https://api.anthropic.com'}/v1/models?limit=1`, headers: { 'x-api-key': chave, 'anthropic-version': '2023-06-01' }, recusa: [401, 403], aceita: [] };
    case 'kie':
      return { url: `${env.KIE_URL ? env.KIE_URL.replace(/\/$/, '') : 'https://api.kie.ai'}/api/v1/chat/credit`, headers: { authorization: `Bearer ${chave}` }, recusa: [401, 403], aceita: [] };
    case 'fal':
      return {
        url: `${env.FAL_URL ? env.FAL_URL.replace(/\/$/, '') : 'https://queue.fal.run'}/${PROVEDORES.fal.modelo.split('/').slice(0, 2).join('/')}/requests/00000000-0000-0000-0000-000000000000/status`,
        headers: { authorization: `Key ${chave}` }, recusa: [401, 403], aceita: [404],
      };
  }
}

// ── a aba Chaves de IA ────────────────────────────────────────────────────────────────────────────────────────────────

/** Menor chave aceita: abaixo disso, os 4 últimos caracteres diriam demais sobre ela. */
export const CHAVE_MIN = 16;
export const CHAVE_MAX = 400;

/**
 * O que a aba mostra: de cada provedor, se o veículo tem chave (os 4 últimos e quando salvou) e se o servidor tem; a escolha
 * de texto e de imagem; e o que está em uso agora para cada função. A chave nunca sai daqui.
 */
export async function estadoChaves(env: Env, tenantId: string) {
  const [{ results }, chaves] = await Promise.all([
    env.DB.prepare('SELECT provedor, final, salva_em FROM chaves_ia WHERE tenant_id = ?').bind(tenantId).all<{ provedor: string; final: string; salva_em: string }>(),
    chavesDoVeiculo(env, tenantId),
  ]);
  const emUso = <P extends Provedor>(c: ChaveUsada<P> | null) => (c ? { provedor: c.provedor, origem: c.origem } : null);
  return {
    provedores: IDS_PROVEDORES.map((id) => {
      const v = results.find((r) => r.provedor === id);
      return { id, veiculo: v ? { final: v.final, salvaEm: v.salva_em } : null, servidor: !!chaveDoServidor(env, id) };
    }),
    escolha: chaves.escolha,
    emUso: { texto: emUso(chaves.texto), segunda: emUso(chaves.segunda), imagem: emUso(chaves.imagem) },
  };
}
export type EstadoChaves = Awaited<ReturnType<typeof estadoChaves>>;

/** O veículo tem como usar o provedor (a chave dele ou a do servidor)? A escolha de texto e de imagem pede isso. */
export async function temChave(env: Env, tenantId: string, p: Provedor) {
  if (chaveDoServidor(env, p)) return true;
  return !!(await env.DB.prepare('SELECT 1 AS x FROM chaves_ia WHERE tenant_id = ? AND provedor = ?').bind(tenantId, p).first());
}
