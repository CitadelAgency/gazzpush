// Marca à mão do Lápis azul (DESIGN.md §4): uma por tela, na próxima ação. Cor por `currentColor` (azul na ação,
// verde na validação, branco sobre o Aprovar). `desenhar` traça o risco ao montar (ou quando vira true); sem ele o
// traço já está seco. Com prefers-reduced-motion o traço aparece pronto (lapis.css). Estilos em ./lapis.css.
import { useId, useLayoutEffect, useRef, useState } from "react";
import { sublinhado, visto, volta, type Traco } from "./tracos";

type Props = {
  /** Traço diferente por seed, sempre o mesmo para a mesma seed. */
  seed?: number;
  /** Traça o risco ao entrar; falso = seco. */
  desenhar?: boolean;
  /** Espessura do risco em px. */
  larg?: number;
  className?: string;
};

// Folga da região do filtro, em px: em % da caixa do path, o sublinhado (poucos px de altura) perdia a borda do risco.
export const FOLGA = 10;

type Geometria = (seed: number, w: number, h: number) => Traco;

function Risco({ geo, w0, h0, seed, larg, desenhar, className, tipo }:
  { geo: Geometria; w0: number; h0: number; seed: number; larg: number; desenhar?: boolean; className?: string; tipo: string }) {
  // useId traz caracteres que quebram url(#…); o filtro precisa de id único por instância.
  const id = "grafite" + useId().replace(/[^a-zA-Z0-9]/g, "");
  // O traço é gerado no tamanho real da caixa (1:1). Esticar o SVG faria o tracejado da animação, medido em px de
  // tela, cobrir só parte do risco. Antes de medir (servidor, primeiro render) vale o tamanho padrão.
  const ref = useRef<SVGSVGElement>(null);
  const [tam, setTam] = useState<[number, number]>([w0, h0]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => {
      const w = Math.round(el.clientWidth), h = Math.round(el.clientHeight);
      if (w > 0 && h > 0) setTam((t) => (t[0] === w && t[1] === h ? t : [w, h]));
    };
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const t = geo(seed, tam[0], tam[1]);
  const classe = ["lapis", `lapis-${tipo}`, desenhar && "lapis--desenhar", className].filter(Boolean).join(" ");
  return (
    <svg ref={ref} className={classe} viewBox={`0 0 ${t.w} ${t.h}`} aria-hidden="true" focusable="false">
      {/* Grão de grafite: ruído fino recorta o risco, como lápis em papel. */}
      <filter id={id} filterUnits="userSpaceOnUse" x={-FOLGA} y={-FOLGA} width={t.w + 2 * FOLGA} height={t.h + 2 * FOLGA}>
        <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves={2} seed={seed} result="n" />
        <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.2 1.25" result="a" />
        <feComposite in="SourceGraphic" in2="a" operator="in" />
      </filter>
      <path
        d={t.d}
        pathLength={1}
        fill="none"
        stroke="currentColor"
        strokeWidth={larg}
        strokeLinecap="round"
        strokeLinejoin="round"
        filter={`url(#${id})`}
      />
    </svg>
  );
}

/** Volta de lápis em torno da próxima ação. Vai dentro de um pai com `position: relative` e cobre o pai inteiro. */
export function VoltaLapis({ seed = 12, larg = 2.3, ...p }: Props) {
  return <Risco geo={volta} w0={120} h0={46} seed={seed} larg={larg} tipo="volta" {...p} />;
}

/** Visto à mão: no Aprovar (branco) e na validação (verde). */
export function VistoLapis({ seed = 9, larg = 2.4, ...p }: Props) {
  return <Risco geo={visto} w0={22} h0={20} seed={seed} larg={larg} tipo="visto" {...p} />;
}

/** Sublinhado de lápis sob uma palavra. Vai dentro de um pai com `position: relative`, colado na base dele. */
export function SublinhadoLapis({ seed = 5, larg = 2, ...p }: Props) {
  return <Risco geo={sublinhado} w0={120} h0={10} seed={seed} larg={larg} tipo="sublinhado" {...p} />;
}
