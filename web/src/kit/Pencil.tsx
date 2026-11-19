// The Blue pencil's hand mark (DESIGN.md §4): one per screen, on the next action. Colour from `currentColor` (blue on
// the action, green on validation, white over Approve). `desenhar` draws the stroke on mount (or when it turns true);
// without it the stroke is already dry. With prefers-reduced-motion the stroke appears finished (pencil.css). Styles
// in ./pencil.css.
import { useId, useLayoutEffect, useRef, useState } from "react";
import { underline, seen, back, type Stroke } from "./strokes";

type Props = {
  /** A different stroke per seed, always the same for the same seed. */
  seed?: number;
  /** Draws the stroke on entry; false = dry. */
  desenhar?: boolean;
  /** Stroke thickness in px. */
  larg?: number;
  className?: string;
};

// Slack for the filter region, in px: as a % of the path's box, the underline (a few px tall) lost the stroke's edge.
export const SLACK = 10;

type Geometry = (seed: number, w: number, h: number) => Stroke;

function Risk({ geo, w0, h0, seed, larg: width, desenhar: draw, className, tipo: type }:
  { geo: Geometry; w0: number; h0: number; seed: number; larg: number; desenhar?: boolean; className?: string; tipo: string }) {
  // useId brings characters that break url(#…); the filter needs a unique id per instance.
  const id = "grafite" + useId().replace(/[^a-zA-Z0-9]/g, "");
  // The stroke is generated at the box's real size (1:1). Stretching the SVG would make the animation's dash, measured in
  // screen px, cover only part of the stroke. Before measuring (server, first render) the default size applies.
  const ref = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState<[number, number]>([w0, h0]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = Math.round(el.clientWidth), h = Math.round(el.clientHeight);
      if (w > 0 && h > 0) setSize((t) => (t[0] === w && t[1] === h ? t : [w, h]));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const t = geo(seed, size[0], size[1]);
  const cls = ["lapis", `lapis-${type}`, draw && "lapis--desenhar", className].filter(Boolean).join(" ");
  return (
    <svg ref={ref} className={cls} viewBox={`0 0 ${t.w} ${t.h}`} aria-hidden="true" focusable="false">
      {/* Graphite grain: fine noise breaks up the stroke, like pencil on paper. */}
      <filter id={id} filterUnits="userSpaceOnUse" x={-SLACK} y={-SLACK} width={t.w + 2 * SLACK} height={t.h + 2 * SLACK}>
        <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves={2} seed={seed} result="n" />
        <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.2 1.25" result="a" />
        <feComposite in="SourceGraphic" in2="a" operator="in" />
      </filter>
      <path
        d={t.d}
        pathLength={1}
        fill="none"
        stroke="currentColor"
        strokeWidth={width}
        strokeLinecap="round"
        strokeLinejoin="round"
        filter={`url(#${id})`}
      />
    </svg>
  );
}

/** A pencil loop around the next action. Goes inside a parent with `position: relative` and covers the whole parent. */
export function BackPencil({ seed = 12, larg: width = 2.3, ...p }: Props) {
  return <Risk geo={back} w0={120} h0={46} seed={seed} larg={width} tipo="volta" {...p} />;
}

/** A hand check mark: on Approve (white) and on validation (green). */
export function SeenPencil({ seed = 9, larg: width = 2.4, ...p }: Props) {
  return <Risk geo={seen} w0={22} h0={20} seed={seed} larg={width} tipo="visto" {...p} />;
}

/** A pencil underline under a word. Goes inside a parent with `position: relative`, against its bottom. */
export function UnderlinePencil({ seed = 5, larg: width = 2, ...p }: Props) {
  return <Risk geo={underline} w0={120} h0={10} seed={seed} larg={width} tipo="sublinhado" {...p} />;
}
