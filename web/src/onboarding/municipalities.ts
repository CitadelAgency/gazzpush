// Municipality search in the IBGE list (web/src/data/municipalities.ts, loaded only on this screen).
export type Municipality = { ibge: string; nome: string; uf: string; chave: string };

const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function readMunicipalities(text: string): Municipality[] {
  return text.split("\n").map((l) => {
    const [ibge, name, uf] = l.split("|");
    return { ibge, nome: name, uf, chave: normalize(`${name} ${uf}`) };
  });
}

/** Up to `n` municipalities with all typed words; those starting with the text come first. "guaruja sp" finds Guarujá. */
export function fetchMunicipalities(list: Municipality[], text: string, n = 8): Municipality[] {
  const q = normalize(text).replace(/[·,/-]/g, " ").trim();
  if (!q) return [];
  const parts = q.split(/\s+/);
  const findings = list.filter((m) => parts.every((p) => m.chave.includes(p)));
  const starts = findings.filter((m) => m.chave.startsWith(q) || m.chave.startsWith(parts[0]));
  return [...new Set([...starts, ...findings])].slice(0, n);
}

export const municipalityLabel = (m: Pick<Municipality, "nome" | "uf">) => `${m.nome} · ${m.uf}`;
