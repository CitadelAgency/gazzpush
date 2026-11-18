// Busca de município na lista do IBGE (web/src/dados/municipios.ts, carregada só nesta tela).
export type Municipio = { ibge: string; nome: string; uf: string; chave: string };

const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function lerMunicipios(texto: string): Municipio[] {
  return texto.split("\n").map((l) => {
    const [ibge, nome, uf] = l.split("|");
    return { ibge, nome, uf, chave: normalizar(`${nome} ${uf}`) };
  });
}

/** Até `n` municípios com todas as palavras digitadas; quem começa pelo texto vem antes. "guaruja sp" acha Guarujá. */
export function buscarMunicipios(lista: Municipio[], texto: string, n = 8): Municipio[] {
  const q = normalizar(texto).replace(/[·,/-]/g, " ").trim();
  if (!q) return [];
  const partes = q.split(/\s+/);
  const achados = lista.filter((m) => partes.every((p) => m.chave.includes(p)));
  const comeca = achados.filter((m) => m.chave.startsWith(q) || m.chave.startsWith(partes[0]));
  return [...new Set([...comeca, ...achados])].slice(0, n);
}

export const rotuloMunicipio = (m: Pick<Municipio, "nome" | "uf">) => `${m.nome} · ${m.uf}`;
