// Kit da Fase B (web/src/kit): traços de lápis determinísticos e componentes acessíveis.
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FOLGA, SublinhadoLapis, VistoLapis, VoltaLapis } from '../web/src/kit/Lapis';
import { sublinhado, visto, volta, type Traco } from '../web/src/kit/tracos';

const pontos = (t: Traco) => [...t.d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => [Number(m[1]), Number(m[2])]);

describe('traços', () => {
  it('mesma seed, mesmo traço; seed diferente, traço diferente', () => {
    for (const f of [volta, visto, sublinhado]) {
      expect(f(7).d).toBe(f(7).d);
      expect(f(7).d).not.toBe(f(8).d);
    }
  });

  it('o traço cabe na caixa do viewBox (com folga de 10%)', () => {
    for (const seed of [1, 2, 3, 12, 99, 12345]) {
      for (const t of [volta(seed), visto(seed), sublinhado(seed)]) {
        for (const [x, y] of pontos(t)) {
          expect(x).toBeGreaterThanOrEqual(-t.w * 0.1);
          expect(x).toBeLessThanOrEqual(t.w * 1.1);
          expect(y).toBeGreaterThanOrEqual(-t.h * 0.1);
          expect(y).toBeLessThanOrEqual(t.h * 1.1);
        }
      }
    }
  });

  it('a volta passa do ponto de partida, mas não fecha em cima dele', () => {
    const p = pontos(volta(12));
    const [x0, y0] = p[0], [x1, y1] = p[p.length - 1];
    // anda mais que uma volta inteira (ângulo final além do inicial) e termina perto, não no mesmo ponto
    expect(p.length).toBeGreaterThan(50);
    const dist = Math.hypot(x1 - x0, y1 - y0);
    expect(dist).toBeGreaterThan(2);
    expect(dist).toBeLessThan(volta(12).w / 2);
  });
});

describe('componentes', () => {
  it('são decorativos: aria-hidden, sem foco, cor herdada', () => {
    for (const C of [VoltaLapis, VistoLapis, SublinhadoLapis]) {
      const html = renderToStaticMarkup(h(C));
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain('focusable="false"');
      expect(html).toContain('stroke="currentColor"');
      expect(html).toContain('pathLength="1"');
    }
  });

  it('seco por padrão; desenhar liga a classe de animação', () => {
    expect(renderToStaticMarkup(h(VoltaLapis))).not.toContain('lapis--desenhar');
    expect(renderToStaticMarkup(h(VoltaLapis, { desenhar: true }))).toContain('lapis--desenhar');
    expect(renderToStaticMarkup(h(VistoLapis, { className: 'x' }))).toMatch(/class="lapis lapis-visto x"/);
  });

  it('cada instância tem o seu filtro de grafite, e o path aponta para ele', () => {
    const html = renderToStaticMarkup(h('div', null, h(VoltaLapis), h(VoltaLapis), h(VistoLapis)));
    const ids = [...html.matchAll(/<filter id="([^"]+)"/g)].map((m) => m[1]);
    const refs = [...html.matchAll(/filter="url\(#([^)]+)\)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    expect(refs).toEqual(ids);
    for (const id of ids) expect(id).toMatch(/^[a-zA-Z0-9]+$/);
  });

  it('a região do filtro cobre o risco inteiro, mesmo no sublinhado baixinho', () => {
    for (const [C, t, larg] of [[VoltaLapis, volta(12), 2.3], [VistoLapis, visto(9, 22, 20), 2.4], [SublinhadoLapis, sublinhado(5), 2]] as const) {
      const html = renderToStaticMarkup(h(C));
      const m = html.match(/<filter[^>]*filterUnits="userSpaceOnUse" x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"/);
      expect(m).not.toBeNull();
      const [x, y, w, hh] = m!.slice(1).map(Number);
      // folga de pelo menos 3× a espessura em cada lado, além dos pontos extremos do traço
      const ps = pontos(t), xs = ps.map((p) => p[0]), ys = ps.map((p) => p[1]);
      expect(x).toBeLessThanOrEqual(Math.min(...xs) - 3 * larg);
      expect(y).toBeLessThanOrEqual(Math.min(...ys) - 3 * larg);
      expect(x + w).toBeGreaterThanOrEqual(Math.max(...xs) + 3 * larg);
      expect(y + hh).toBeGreaterThanOrEqual(Math.max(...ys) + 3 * larg);
      expect(FOLGA).toBeGreaterThanOrEqual(3 * larg);
    }
  });
});
