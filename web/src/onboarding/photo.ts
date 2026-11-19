// A phone photo before upload: a JPEG shrunk in the browser. Redrawing on the canvas also drops the file's metadata,
// location among them. SVG and PNG that fit under the cap go as they came (a logo with a transparent background).
import { PHOTO_MAX_BYTES } from "../../../src/lib/cards";

export const PHOTO_SIDE_MAX = 1620;
export const PHOTO_QUALITY = 0.85;

/** The browser could not open the file (HEIC in Chrome, for example). */
export class PhotoIllegible extends Error {}

export async function preparePhoto(file: File): Promise<Blob> {
  if (file.type === "image/svg+xml" || (file.type === "image/png" && file.size <= PHOTO_MAX_BYTES)) return file;
  const bitmap = await createImageBitmap(file).catch(() => { throw new PhotoIllegible(); });
  const scale = Math.min(1, PHOTO_SIDE_MAX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new PhotoIllegible();
  // JPEG has no transparency: without this background, the large PNG's transparent area would come out black.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", PHOTO_QUALITY));
  if (!blob) throw new PhotoIllegible();
  return blob;
}
