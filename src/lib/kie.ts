import type { Env } from '../env';
import { PROVEDORES } from './provedoresTabela';

// Grok image-edit via Kie, com imagem de referência de estilo. A chave vem
// resolvida (a do veículo ou a do servidor, src/lib/provedores.ts). `KIE_URL` troca a base da API no teste.
export const KIE_MODEL = PROVEDORES.kie.modelo;
export const KIE_CREDITO_USD = PROVEDORES.kie.preco.creditoUsd;
export const KIE_RESERVA_USD = PROVEDORES.kie.preco.imagemUsd;   // custo típico de 1 imagem; usado quando o provedor não informa créditos
const api = (env: Env) => `${env.KIE_URL ? env.KIE_URL.replace(/\/$/, '') : 'https://api.kie.ai'}/api/v1/jobs/`;
const UPLOAD = 'https://kieai.redpandaai.co/api/file-base64-upload';
const MAX_BYTES = 25_000_000;

export interface TarefaKie {
  state: string;                 // waiting | queuing | generating | success | fail
  resultUrls: string[];
  creditsConsumed: number | null;
  failCode: string | null;
  failMsg: string | null;
}

export function b64(bytes: ArrayBuffer) {
  const u8 = new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

function httpsUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error(`kie: URL inválida ${url.hostname}`);
  return url.href;
}

async function chamar(chave: string, url: string, body?: unknown): Promise<Record<string, any>> {
  if (!chave) throw new Error('KIE_API_KEY ausente');
  // Workers não implementam redirect:'error'; 'manual' + checagem de status dá o mesmo efeito (credencial nunca segue redirect).
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    redirect: 'manual',
    headers: { authorization: `Bearer ${chave}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) { await res.body?.cancel(); throw new Error(`kie HTTP ${res.status}`); }
  const data = await res.json<Record<string, any>>();
  // jobs/* responde {code:200,...}; o upload responde {success:true,...}
  // Só o código (402 = sem crédito, lido pela revisão): a mensagem do provedor fica fora do evento e do log.
  if (!(Number(data.code) === 200 || data.success === true)) throw new Error(`kie recusou: código ${data.code ?? '?'}`);
  return data;
}

/** Tipo da referência pelos bytes (a aba Marca aceita PNG e JPEG). */
export const tipoReferencia = (bytes: ArrayBuffer) => {
  const b = new Uint8Array(bytes, 0, Math.min(3, bytes.byteLength));
  return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? { mime: 'image/jpeg', ext: 'jpg' } : { mime: 'image/png', ext: 'png' };
};

/** Sobe a imagem de referência (PNG ou JPEG ≤ 10 MB) e devolve URL https que o modelo consegue ler. */
export async function enviarReferencia(chave: string, bytes: ArrayBuffer, base: string): Promise<string> {
  if (bytes.byteLength > 10_000_000) throw new Error('referência excede 10 MB');
  const { mime, ext } = tipoReferencia(bytes);
  const data = await chamar(chave, UPLOAD, { base64Data: `data:${mime};base64,${b64(bytes)}`, uploadPath: 'images/redacao', fileName: `${base}.${ext}` });
  const url = data.data?.downloadUrl;
  if (typeof url !== 'string') throw new Error('kie: upload sem downloadUrl');
  return httpsUrl(url);
}

export async function criarTarefa(env: Env, chave: string, prompt: string, referenciaUrl: string): Promise<string> {
  if (!prompt || prompt.length > 20_000) throw new Error('prompt de imagem inválido');
  const data = await chamar(chave, `${api(env)}createTask`, { model: KIE_MODEL, input: { prompt, image_urls: [httpsUrl(referenciaUrl)], aspect_ratio: '2:3' } });
  const taskId = data.data?.taskId;
  if (typeof taskId !== 'string' || !/^[\w-]{1,200}$/.test(taskId)) throw new Error('kie: createTask sem taskId');
  return taskId;
}

export async function consultarTarefa(env: Env, chave: string, taskId: string): Promise<TarefaKie> {
  const data = await chamar(chave, `${api(env)}recordInfo?taskId=${encodeURIComponent(taskId)}`);
  const d = data.data ?? {};
  if (d.taskId !== taskId || typeof d.state !== 'string') throw new Error('kie: tarefa divergente');
  let result = d.resultJson ?? {};
  if (typeof result === 'string') result = JSON.parse(result);
  const credits = Number(d.creditsConsumed);
  return {
    state: d.state,
    resultUrls: Array.isArray(result.resultUrls) ? result.resultUrls.map(httpsUrl) : [],
    creditsConsumed: Number.isFinite(credits) && credits >= 0 ? credits : null,
    failCode: d.failCode == null ? null : String(d.failCode).slice(0, 50),
    failMsg: typeof d.failMsg === 'string' ? d.failMsg.slice(0, 500) : null,
  };
}

/** Download do CDN sem credencial e sem seguir redirect. */
export async function baixarImagem(url: string): Promise<ArrayBuffer> {
  const res = await fetch(httpsUrl(url), { redirect: 'manual', signal: AbortSignal.timeout(90_000) });
  if (!res.ok) { await res.body?.cancel(); throw new Error(`kie: download HTTP ${res.status}`); }
  if (Number(res.headers.get('content-length')) > MAX_BYTES) { await res.body?.cancel(); throw new Error('imagem excede limite'); }
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES || bytes.byteLength < 20) throw new Error('imagem com tamanho inválido');
  return bytes;
}
