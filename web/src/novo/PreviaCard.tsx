// Card 1080×1350 num iframe sem script, reduzido para a largura da caixa (medida 1:1, sem esticar).
import { useLayoutEffect, useRef, useState } from "react";
import { t } from "../idioma";

/** `alto`: o card em pé do Reels (1080×1920); sem ele, 1080×1350. */
export function PreviaCard({ html, titulo = t("Prévia do card com a marca escolhida", "Card preview with the chosen brand"), alto = false }: { html: string; titulo?: string; alto?: boolean }) {
  const caixa = useRef<HTMLDivElement>(null);
  const [escala, setEscala] = useState(0.3);
  useLayoutEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const medir = () => setEscala(el.clientWidth / 1080);
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="corte corte-so-lg">
      <div ref={caixa} className={`relative w-full overflow-hidden rounded-card bg-texto-forte shadow-prova ${alto ? "aspect-[9/16]" : "aspect-[4/5]"}`}>
        <iframe
          title={titulo} srcDoc={html} sandbox="allow-same-origin" tabIndex={-1}
          className="pointer-events-none absolute top-0 left-0 origin-top-left border-0"
          style={{ width: 1080, height: alto ? 1920 : 1350, transform: `scale(${escala})` }}
        />
      </div>
    </div>
  );
}
