// Biblioteca de música do Reels: curta, montada pelo dono no R2 (o repositório não traz faixa nenhuma). Só entra faixa
// com licença registrada que permita uso comercial em rede social: o manifesto diz título, autor, licença e o link
// dela, e a faixa sem esses campos não aparece. Como montar: README, "Biblioteca de música do Reels".
import type { Env } from '../env';

/** Manifesto no bucket MEDIA: `{ "faixas": [ { id, titulo, autor, licenca, licencaUrl, arquivo } ] }`. */
export const MANIFESTO_MUSICA = 'musica/biblioteca.json';

export interface Musica {
  id: string;            // a-z, 0-9 e hífen (vai na escolha do Reels)
  titulo: string;
  autor: string;
  licenca: string;       // nome da licença, como está no site de onde veio (ex.: "Pixabay Content License")
  licencaUrl: string;    // https: onde conferir a licença da faixa
  arquivo: string;       // chave no R2: musica/<arquivo>.mp3 ou .m4a
  /** O dono confirma que a licença permite uso comercial em rede social. Sem `true`, a faixa não entra. */
  usoComercial: true;
  /** Faixa que exige crédito na legenda ainda não entra (a legenda do Reels não leva crédito de música). */
  exigeCredito?: false;
}

const ID = /^[a-z0-9-]{1,40}$/;
const ARQUIVO = /^musica\/[\w.-]+\.(mp3|m4a)$/;
const texto = (v: unknown, max: number) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

/**
 * Faixa do manifesto que cumpre a regra: todos os campos, licença com link https, uso comercial confirmado pelo dono
 * (`usoComercial: true`) e sem exigência de crédito. As outras ficam de fora.
 */
export function faixaValida(v: unknown): v is Musica {
  if (!v || typeof v !== 'object') return false;
  const f = v as Record<string, unknown>;
  if (typeof f.id !== 'string' || !ID.test(f.id)) return false;
  if (!texto(f.titulo, 120) || !texto(f.autor, 120) || !texto(f.licenca, 120)) return false;
  if (typeof f.licencaUrl !== 'string' || !/^https:\/\/\S+$/.test(f.licencaUrl)) return false;
  // A licença só vale com a confirmação explícita do dono; faixa que exige crédito fica de fora.
  if (f.usoComercial !== true || (f.exigeCredito !== undefined && f.exigeCredito !== false)) return false;
  return typeof f.arquivo === 'string' && ARQUIVO.test(f.arquivo);
}

/** As faixas da biblioteca. Sem manifesto (ou manifesto quebrado): nenhuma, e o Reels sai sem música. */
export async function bibliotecaMusical(env: Env): Promise<Musica[]> {
  const obj = await env.MEDIA.get(MANIFESTO_MUSICA);
  if (!obj) return [];
  const dados = await obj.json<{ faixas?: unknown }>().catch(() => null);
  const faixas = Array.isArray(dados?.faixas) ? dados.faixas.filter(faixaValida) : [];
  const vistos = new Set<string>();
  return faixas.filter((f) => !vistos.has(f.id) && vistos.add(f.id));
}
