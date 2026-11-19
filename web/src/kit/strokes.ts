// Geometry of the pencil strokes (DESIGN.md §4): loop, check and underline. Pure functions, deterministic per seed, so
// the same stroke comes out the same on the server, in tests and in the browser. Ported from design/direcoes/_base/arte.js.
// w and h are the real size in px: the component draws 1:1, without stretching the SVG (stretched, the animation's dash
// is measured in screen px and does not cover the whole stroke).

export type Stroke = { d: string; w: number; h: number };

/** Pseudo-random generator (mulberry32): same seed, same sequence. */
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

/** A loop around a word: an ellipse that does not close exactly (it overshoots the starting point and opens a little).
 *  The seed changes the gesture's shape (where it starts, how far it overshoots, tilt, flattening), not only the tremor. */
export function back(seed = 12, w = 120, h = 46): Stroke {
  const r = rng(seed), cx = w / 2, cy = h / 2, pts: string[] = [];
  const ini = -2.75 + r() * 0.5, passes = 0.35 + r() * 0.45, phase = r() * 6;
  const turn = ((r() - 0.5) * 4 * Math.PI) / 180, flatten = 0.92 + r() * 0.1, opens = 0.008 + r() * 0.012;
  const rx = w / 2 - 4, ry = (h / 2 - 4) * flatten, cg = Math.cos(turn), sg = Math.sin(turn);
  for (let a = ini, end = ini + Math.PI * 2 + passes; a <= end; a += 0.1) {
    const k = 1 + (a - ini) * opens + Math.sin(a * 3 + phase) * 0.025;
    const x = Math.cos(a) * rx * k, y = Math.sin(a) * ry * k * (1 - (a - ini) * 0.01);
    pts.push(n1(cx + x * cg - y * sg) + "," + n1(cy + x * sg + y * cg));
  }
  return { d: "M" + pts.join("L"), w, h };
}

/** A quick check mark: a short leg going down, a long leg going up. Drawn at 25×23 and scaled to w×h; the seed only
 *  moves the control points by ±0.6. */
export function seen(seed = 9, w = 25, h = 23): Stroke {
  const r = rng(seed), j = () => (r() - 0.5) * 1.2, sx = w / 25, sy = h / 23;
  const p = [3 + j(), 13 + j(), 5 + j(), 14 + j(), 7 + j(), 16.5 + j(), 9, 20, 12 + j(), 13 + j(), 16 + j(), 7.5 + j(), 22 + j(), 3 + j()];
  const [x0, y0, a, b, c, d, x1, y1, e, f, g, hh, x2, y2] = p.map((v, i) => n1(v * (i % 2 ? sy : sx)));
  return { d: `M${x0},${y0} C${a},${b} ${c},${d} ${x1},${y1} C${e},${f} ${g},${hh} ${x2},${y2}`, w, h };
}

/** A hand underline: a single stroke, slightly curved, the word's width, rising a little at the end. */
export function underline(seed = 5, w = 120, h = 10): Stroke {
  const r = rng(seed), y0 = h * (0.62 + r() * 0.12), y1 = h * (0.4 + r() * 0.12);
  const half = h * (0.5 + (r() - 0.5) * 0.3), ini = 1 + r() * 2, end = w - 1 - r() * 2;
  return { d: `M${n1(ini)},${n1(y0)} Q${n1(w * (0.45 + r() * 0.1))},${n1(half)} ${n1(end)},${n1(y1)}`, w, h };
}
