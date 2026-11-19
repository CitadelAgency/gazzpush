// A 1080×1350 card in a script-free iframe, reduced to the box's width (measured 1:1, without stretching).
import { useLayoutEffect, useRef, useState } from "react";
import { t } from "../language";

/** `alto`: the upright Reels card (1080×1920); without it, 1080×1350. */
export function PreviewCard({ html, titulo: title = t("Prévia do card com a marca escolhida", "Card preview with the chosen brand"), alto: high = false }: { html: string; titulo?: string; alto?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setScale(el.clientWidth / 1080);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="corte corte-so-lg">
      <div ref={box} className={`relative w-full overflow-hidden rounded-card bg-texto-forte shadow-prova ${high ? "aspect-[9/16]" : "aspect-[4/5]"}`}>
        <iframe
          title={title} srcDoc={html} sandbox="allow-same-origin" tabIndex={-1}
          className="pointer-events-none absolute top-0 left-0 origin-top-left border-0"
          style={{ width: 1080, height: high ? 1920 : 1350, transform: `scale(${scale})` }}
        />
      </div>
    </div>
  );
}
