import type { Env } from '../env';
import { b64, downloadImage, referenceType } from './kie';
import { baseFal } from './providers';
import { PROVIDERS } from './providersTable';

// The same Grok Imagine edit as Kie, on fal: prompt plus a style reference image, 2:3 portrait. Uses the synchronous API
// (fal.run), the path the AI Gateway documents; the reference goes as a data URI (fal accepts it in place of a URL).
// `FAL_URL` swaps the address in tests. The key arrives resolved (src/lib/providers.ts) and only goes in the header.
export const FAL_MODEL = PROVIDERS.fal.modelo;
export const FAL_IMAGE_USD = PROVIDERS.fal.preco.imagemUsd;

export async function generateWithFal(env: Env, key: string, prompt: string, reference: ArrayBuffer): Promise<Uint8Array> {
  if (!prompt || prompt.length > 20_000) throw new Error('invalid image prompt');
  if (reference.byteLength > 10_000_000) throw new Error('reference exceeds 10 MB');
  const res = await fetch(`${baseFal(env)}/${FAL_MODEL}`, {
    method: 'POST',
    redirect: 'manual',
    headers: { authorization: `Key ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt, image_urls: [`data:${referenceType(reference).mime};base64,${b64(reference)}`],
      aspect_ratio: '2:3', num_images: 1, output_format: 'png',
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) { await res.body?.cancel(); throw new Error(`fal HTTP ${res.status}`); }
  const data = await res.json<{ images?: { url?: unknown }[] }>();
  const urls = (data.images ?? []).map((i) => i?.url).filter((u): u is string => typeof u === 'string');
  if (urls.length !== 1) throw new Error(`fal returned ${urls.length} images`);
  return new Uint8Array(await downloadImage(urls[0]));
}
