import type { Env } from '../env';
import { b64, baixarImagem, tipoReferencia } from './kie';
import { baseFal } from './provedores';
import { PROVEDORES } from './provedoresTabela';

// O mesmo Grok Imagine edit da Kie, no fal: prompt e imagem de referência de estilo, retrato 2:3. Pela API síncrona (fal.run),
// que é o caminho que o AI Gateway documenta; a referência vai como data URI (o fal aceita no lugar da URL). `FAL_URL` troca o
// endereço no teste. A chave vem resolvida (src/lib/provedores.ts) e só vai no cabeçalho.
export const FAL_MODELO = PROVEDORES.fal.modelo;
export const FAL_IMAGEM_USD = PROVEDORES.fal.preco.imagemUsd;

export async function gerarComFal(env: Env, chave: string, prompt: string, referencia: ArrayBuffer): Promise<Uint8Array> {
  if (!prompt || prompt.length > 20_000) throw new Error('prompt de imagem inválido');
  if (referencia.byteLength > 10_000_000) throw new Error('referência excede 10 MB');
  const res = await fetch(`${baseFal(env)}/${FAL_MODELO}`, {
    method: 'POST',
    redirect: 'manual',
    headers: { authorization: `Key ${chave}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt, image_urls: [`data:${tipoReferencia(referencia).mime};base64,${b64(referencia)}`],
      aspect_ratio: '2:3', num_images: 1, output_format: 'png',
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) { await res.body?.cancel(); throw new Error(`fal HTTP ${res.status}`); }
  const data = await res.json<{ images?: { url?: unknown }[] }>();
  const urls = (data.images ?? []).map((i) => i?.url).filter((u): u is string => typeof u === 'string');
  if (urls.length !== 1) throw new Error(`fal devolveu ${urls.length} imagens`);
  return new Uint8Array(await baixarImagem(urls[0]));
}
