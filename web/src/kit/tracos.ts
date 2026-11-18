// Geometria dos traços de lápis (DESIGN.md §4): volta, visto e sublinhado. Funções puras e determinísticas por seed,
// para o mesmo traço sair igual no servidor, no teste e no navegador. Portado de design/direcoes/_base/arte.js.
// w e h são o tamanho real em px: o componente desenha 1:1, sem esticar o SVG (esticado, o tracejado da animação
// é medido em px de tela e não cobre o risco inteiro).

export type Traco = { d: string; w: number; h: number };

/** Gerador pseudoaleatório (mulberry32): mesma seed, mesma sequência. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const n1 = (v: number) => v.toFixed(1);

/** Volta em torno de uma palavra: elipse que não fecha certo (passa do ponto de partida e abre um pouco). A seed
 *  muda a forma do gesto (onde começa, quanto passa do ponto, inclinação, achatamento), não só o tremor. */
export function volta(seed = 12, w = 120, h = 46): Traco {
  const r = rng(seed), cx = w / 2, cy = h / 2, pts: string[] = [];
  const ini = -2.75 + r() * 0.5, passa = 0.35 + r() * 0.45, fase = r() * 6;
  const giro = ((r() - 0.5) * 4 * Math.PI) / 180, achata = 0.92 + r() * 0.1, abre = 0.008 + r() * 0.012;
  const rx = w / 2 - 4, ry = (h / 2 - 4) * achata, cg = Math.cos(giro), sg = Math.sin(giro);
  for (let a = ini, fim = ini + Math.PI * 2 + passa; a <= fim; a += 0.1) {
    const k = 1 + (a - ini) * abre + Math.sin(a * 3 + fase) * 0.025;
    const x = Math.cos(a) * rx * k, y = Math.sin(a) * ry * k * (1 - (a - ini) * 0.01);
    pts.push(n1(cx + x * cg - y * sg) + "," + n1(cy + x * sg + y * cg));
  }
  return { d: "M" + pts.join("L"), w, h };
}

/** Visto rápido: perna curta descendo, perna longa subindo. Desenhado em 25×23 e escalado para w×h; a seed só mexe
 *  ±0,6 nos pontos de controle. */
export function visto(seed = 9, w = 25, h = 23): Traco {
  const r = rng(seed), j = () => (r() - 0.5) * 1.2, sx = w / 25, sy = h / 23;
  const p = [3 + j(), 13 + j(), 5 + j(), 14 + j(), 7 + j(), 16.5 + j(), 9, 20, 12 + j(), 13 + j(), 16 + j(), 7.5 + j(), 22 + j(), 3 + j()];
  const [x0, y0, a, b, c, d, x1, y1, e, f, g, hh, x2, y2] = p.map((v, i) => n1(v * (i % 2 ? sy : sx)));
  return { d: `M${x0},${y0} C${a},${b} ${c},${d} ${x1},${y1} C${e},${f} ${g},${hh} ${x2},${y2}`, w, h };
}

/** Sublinhado à mão: um risco só, levemente curvo, da largura da palavra, que sobe um pouco no fim. */
export function sublinhado(seed = 5, w = 120, h = 10): Traco {
  const r = rng(seed), y0 = h * (0.62 + r() * 0.12), y1 = h * (0.4 + r() * 0.12);
  const meio = h * (0.5 + (r() - 0.5) * 0.3), ini = 1 + r() * 2, fim = w - 1 - r() * 2;
  return { d: `M${n1(ini)},${n1(y0)} Q${n1(w * (0.45 + r() * 0.1))},${n1(meio)} ${n1(fim)},${n1(y1)}`, w, h };
}
