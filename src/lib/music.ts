// Reels music library: short, assembled by the owner in R2 (the repository ships no tracks). A track only gets in with a
// recorded licence that allows commercial use on social networks: the manifest gives title, author, licence and its
// link, and a track missing those fields does not show up. How to set it up: README, "Reels music library".
import type { Env } from '../env';

/** Manifest in the MEDIA bucket: `{ "faixas": [ { id, titulo, autor, licenca, licencaUrl, arquivo } ] }`. */
export const MANIFEST_MUSIC = 'musica/biblioteca.json';

export interface Music {
  id: string;            // a-z, 0-9 and hyphen (goes in the Reels choice)
  titulo: string;
  autor: string;
  licenca: string;       // licence name, as written on the site it came from (e.g. "Pixabay Content License")
  licencaUrl: string;    // https: where to check the track's licence
  arquivo: string;       // R2 key: musica/<file>.mp3 or .m4a
  /** The owner confirms the licence allows commercial use on social networks. Without `true`, the track is left out. */
  usoComercial: true;
  /** Tracks that require credit in the caption are not included yet (the Reels caption carries no music credit). */
  exigeCredito?: false;
}

const ID = /^[a-z0-9-]{1,40}$/;
const FILE = /^musica\/[\w.-]+\.(mp3|m4a)$/;
const text = (v: unknown, max: number) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

/**
 * A manifest track that meets the rule: every field, a licence with an https link, commercial use confirmed by the
 * owner (`usoComercial: true`) and no credit requirement. The rest are left out.
 */
export function validBand(v: unknown): v is Music {
  if (!v || typeof v !== 'object') return false;
  const f = v as Record<string, unknown>;
  if (typeof f.id !== 'string' || !ID.test(f.id)) return false;
  if (!text(f.titulo, 120) || !text(f.autor, 120) || !text(f.licenca, 120)) return false;
  if (typeof f.licencaUrl !== 'string' || !/^https:\/\/\S+$/.test(f.licencaUrl)) return false;
  // The licence only counts with the owner's explicit confirmation; a track that requires credit is left out.
  if (f.usoComercial !== true || (f.exigeCredito !== undefined && f.exigeCredito !== false)) return false;
  return typeof f.arquivo === 'string' && FILE.test(f.arquivo);
}

/** The library's tracks. No manifest (or a broken one): none, and the Reels goes out without music. */
export async function libraryMusical(env: Env): Promise<Music[]> {
  const obj = await env.MEDIA.get(MANIFEST_MUSIC);
  if (!obj) return [];
  const data = await obj.json<{ faixas?: unknown }>().catch(() => null);
  const bands = Array.isArray(data?.faixas) ? data.faixas.filter(validBand) : [];
  const seen = new Set<string>();
  return bands.filter((f) => !seen.has(f.id) && seen.add(f.id));
}
