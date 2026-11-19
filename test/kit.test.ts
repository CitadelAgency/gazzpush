// The Phase B kit (web/src/kit): deterministic pencil strokes and accessible components.
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SLACK, UnderlinePencil, SeenPencil, BackPencil } from '../web/src/kit/Pencil';
import { underline, seen, back, type Stroke } from '../web/src/kit/strokes';

const points = (t: Stroke) => [...t.d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => [Number(m[1]), Number(m[2])]);

describe('strokes', () => {
  it('same seed, same stroke; different seed, different stroke', () => {
    for (const f of [back, seen, underline]) {
      expect(f(7).d).toBe(f(7).d);
      expect(f(7).d).not.toBe(f(8).d);
    }
  });

  it('the stroke fits in the viewBox box (with 10% margin)', () => {
    for (const seed of [1, 2, 3, 12, 99, 12345]) {
      for (const t of [back(seed), seen(seed), underline(seed)]) {
        for (const [x, y] of points(t)) {
          expect(x).toBeGreaterThanOrEqual(-t.w * 0.1);
          expect(x).toBeLessThanOrEqual(t.w * 1.1);
          expect(y).toBeGreaterThanOrEqual(-t.h * 0.1);
          expect(y).toBeLessThanOrEqual(t.h * 1.1);
        }
      }
    }
  });

  it("the loop passes the starting point but doesn't close on top of it", () => {
    const p = points(back(12));
    const [x0, y0] = p[0], [x1, y1] = p[p.length - 1];
    // goes further than one full turn (final angle past the initial one) and ends close, not at the same point
    expect(p.length).toBeGreaterThan(50);
    const dist = Math.hypot(x1 - x0, y1 - y0);
    expect(dist).toBeGreaterThan(2);
    expect(dist).toBeLessThan(back(12).w / 2);
  });
});

describe('components', () => {
  it('are decorative: aria-hidden, no focus, inherited color', () => {
    for (const C of [BackPencil, SeenPencil, UnderlinePencil]) {
      const html = renderToStaticMarkup(h(C));
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain('focusable="false"');
      expect(html).toContain('stroke="currentColor"');
      expect(html).toContain('pathLength="1"');
    }
  });

  it('dry by default; drawing turns on the animation class', () => {
    expect(renderToStaticMarkup(h(BackPencil))).not.toContain('lapis--desenhar');
    expect(renderToStaticMarkup(h(BackPencil, { desenhar: true }))).toContain('lapis--desenhar');
    expect(renderToStaticMarkup(h(SeenPencil, { className: 'x' }))).toMatch(/class="lapis lapis-visto x"/);
  });

  it('each instance has its own graphite filter, and the path points to it', () => {
    const html = renderToStaticMarkup(h('div', null, h(BackPencil), h(BackPencil), h(SeenPencil)));
    const ids = [...html.matchAll(/<filter id="([^"]+)"/g)].map((m) => m[1]);
    const refs = [...html.matchAll(/filter="url\(#([^)]+)\)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    expect(refs).toEqual(ids);
    for (const id of ids) expect(id).toMatch(/^[a-zA-Z0-9]+$/);
  });

  it('the filter region covers the whole stroke, even on the short underline', () => {
    for (const [C, t, width] of [[BackPencil, back(12), 2.3], [SeenPencil, seen(9, 22, 20), 2.4], [UnderlinePencil, underline(5), 2]] as const) {
      const html = renderToStaticMarkup(h(C));
      const m = html.match(/<filter[^>]*filterUnits="userSpaceOnUse" x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"/);
      expect(m).not.toBeNull();
      const [x, y, w, hh] = m!.slice(1).map(Number);
      // slack of at least 3× the thickness on each side, beyond the stroke's extreme points
      const ps = points(t), xs = ps.map((p) => p[0]), ys = ps.map((p) => p[1]);
      expect(x).toBeLessThanOrEqual(Math.min(...xs) - 3 * width);
      expect(y).toBeLessThanOrEqual(Math.min(...ys) - 3 * width);
      expect(x + w).toBeGreaterThanOrEqual(Math.max(...xs) + 3 * width);
      expect(y + hh).toBeGreaterThanOrEqual(Math.max(...ys) + 3 * width);
      expect(SLACK).toBeGreaterThanOrEqual(3 * width);
    }
  });
});
