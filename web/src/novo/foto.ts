// Foto do celular antes do envio: JPEG reduzido no navegador. Redesenhar no canvas também descarta os metadados do
// arquivo, entre eles a localização. SVG e PNG que cabem no teto vão como vieram (logo com fundo transparente).
import { FOTO_MAX_BYTES } from "../../../src/lib/cards";

export const FOTO_LADO_MAX = 1620;
export const FOTO_QUALIDADE = 0.85;

/** O navegador não conseguiu abrir o arquivo (HEIC no Chrome, por exemplo). */
export class FotoIlegivel extends Error {}

export async function prepararFoto(arquivo: File): Promise<Blob> {
  if (arquivo.type === "image/svg+xml" || (arquivo.type === "image/png" && arquivo.size <= FOTO_MAX_BYTES)) return arquivo;
  const bitmap = await createImageBitmap(arquivo).catch(() => { throw new FotoIlegivel(); });
  const escala = Math.min(1, FOTO_LADO_MAX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * escala);
  canvas.height = Math.round(bitmap.height * escala);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new FotoIlegivel();
  // JPEG não tem transparência: sem este fundo, o transparente do PNG grande sairia preto.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", FOTO_QUALIDADE));
  if (!blob) throw new FotoIlegivel();
  return blob;
}
