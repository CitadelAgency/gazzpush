// Detail on demand (DESIGN.md §9): one part open at a time, in the URL, and the others in a row with their summary. From
// 1280 px up, `Partes` becomes master-detail (the list fixed on the left, the chosen part beside it); below, an
// accordion. The panel mounts on first open and afterwards only hides, and both layouts use the same tree: nothing
// typed, recorded or read is lost when switching parts or crossing 1280 px. Warnings and errors are never hidden: `tom`
// shows the whole text on the closed row, the screen picks `padrao` so the part with an alert opens by itself, and a
// `role="alert"` that appears in a hidden panel opens its part.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useSearchParams } from "react-router";

export const MASTER = "(min-width: 1280px)";

export const useMedia = (q: string) => useSyncExternalStore(
  (warn) => { const m = matchMedia(q); m.addEventListener("change", warn); return () => m.removeEventListener("change", warn); },
  () => matchMedia(q).matches, () => false);

const NONE = "nenhuma";

/** The open part, in the URL (`?param=`). Without the parameter `padrao` applies; `abrir(null)` records that the person closed everything. */
export function usePart(param: string, fallback: string | null) {
  const [params, setParams] = useSearchParams();
  const v = params.get(param);
  const open = useCallback((id: string | null) => {
    setParams((p) => { p.set(param, id ?? NONE); return p; }, { replace: true, preventScrollReset: true });
  }, [param, setParams]);
  return [v === NONE ? null : v ?? fallback, open] as const;
}

/** Mounts on first open and afterwards only hides. `aoAlerta`: an action that failed after the person left. */
export function PanelView({ aberta: isOpen, manter: keep, id, className, children, aoAlerta: onAlert }: { aberta: boolean; manter: boolean; id: string; className: string; children: ReactNode; aoAlerta: () => void }) {
  const view = useRef(false);
  view.current ||= isOpen;
  const root = useRef<HTMLDivElement>(null);
  const warn = useRef(onAlert);
  warn.current = onAlert;
  useEffect(() => {
    if (isOpen || !root.current) return;
    const isAlert = (n: Node) => n instanceof Element && (n.matches('[role="alert"]') || !!n.querySelector('[role="alert"]'));
    const eye = new MutationObserver((changes) => { if (changes.some((m) => [...m.addedNodes].some(isAlert))) warn.current(); });
    eye.observe(root.current, { childList: true, subtree: true });
    return () => eye.disconnect();
  }, [isOpen]);
  if (!isOpen && !keep) return null;
  return <div ref={root} id={id} hidden={!isOpen} className={className}>{view.current ? children : null}</div>;
}

export type Tone = "aviso" | "erro";
const TONE_COLOR: Record<Tone, string> = { aviso: "text-ambar", erro: "text-terracota" };

type PropsLine = {
  id: string; rotulo: string; resumo: ReactNode; aberta: boolean; alternar: () => void;
  /** With an alert, the summary shows whole and in the state's colour, without the one-line cut. */
  tom?: Tone;
  /** An action beside the row, outside the button that opens it (Copy, for example). */
  acao?: ReactNode;
  nivel?: "h2" | "h3" | "h4" | "h5";
  /** The open part does not close on click: there is always one open (Brand tab). */
  fixa?: boolean;
};

/** The accordion row: a row-sized button (≥ 44 px), state in `aria-expanded`, a summary when closed. */
function PartLine({ id, rotulo: label, resumo: summary, aberta: isOpen, alternar: toggle, tom: tone, acao: action, nivel: level = "h3", fixa: fixed = false }: PropsLine) {
  const btn = useRef<HTMLButtonElement>(null);
  const clicked = useRef(false);
  // Closing the part above pushes this one off screen: the clicked row comes back close to the finger.
  useEffect(() => {
    if (!clicked.current) return;
    clicked.current = false;
    btn.current?.scrollIntoView({ block: "nearest" });
  }, [isOpen]);
  const H = level;
  return (
    <div className="flex items-center gap-2">
      <H className="m-0 min-w-0 flex-1 text-[17px]">
        <button ref={btn} type="button" id={`parte-${id}`} aria-expanded={isOpen} aria-controls={isOpen ? `painel-${id}` : undefined} onClick={() => { clicked.current = true; toggle(); }}
          className={`group flex min-h-14 w-full scroll-mt-20 scroll-mb-24 items-center gap-3 border-0 bg-transparent px-0 py-2.5 text-left font-[inherit] text-[17px] ${isOpen && fixed ? "cursor-default" : "cursor-pointer"}`}>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-4">
            <span className={`flex-none font-bold text-texto-forte ${isOpen ? "" : "group-hover:underline group-hover:decoration-fio-forte group-hover:underline-offset-4"}`}>{label}</span>
            {!isOpen && <span className={`mono min-w-0 text-[14px] font-normal sm:ml-auto ${tone ? `${TONE_COLOR[tone]} sm:text-right` : "truncate text-apoio"}`}>{summary}</span>}
          </span>
          {/* A still arrow (no rotation): only the hint that the row opens; the state is in aria-expanded. */}
          {!(isOpen && fixed) && <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4 flex-none text-apoio"><path d={isOpen ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} /></svg>}
        </button>
      </H>
      {action}
    </div>
  );
}

const PART_CLASS = "border-t border-fio first:border-t-0";
const PANEL_CLASS = "grid grid-cols-[minmax(0,1fr)] gap-5 pt-1 pb-7";

type PropsPart = PropsLine & {
  children: ReactNode;
  /** `false`: unmounts on close, for the screen that keeps the state above. */
  manter?: boolean;
};

/** A standalone part: the row and the panel. */
export function Part({ children, manter: keep = true, ...line }: PropsPart) {
  const { id, aberta: open, alternar: toggle } = line;
  return (
    <section aria-labelledby={`parte-${id}`} className={PART_CLASS}>
      <PartLine {...line} />
      <PanelView id={`painel-${id}`} aberta={open} manter={keep} className={PANEL_CLASS} aoAlerta={() => { if (!open) toggle(); }}>{children}</PanelView>
    </section>
  );
}

/** `acao`: an empty part becomes a row with its action; in master-detail, it sits at the end of the panel. */
export type ItemPart = { id: string; rotulo: string; resumo: ReactNode; tom?: Tone; acao?: ReactNode; conteudo: ReactNode };

/** Alerts first: errors, then warnings, then the rest, in the order they came. */
export const alertFirst = <T extends { tom?: Tone }>(items: T[]) => {
  const weight = (i: T) => (i.tom === "erro" ? 0 : i.tom === "aviso" ? 1 : 2);
  return [...items].sort((a, b) => weight(a) - weight(b));
};

/** The screen split into parts. `padrao`: the one that opens by itself (the one with an alert, or the next action); `null`, all closed. */
export function Parts({ itens: items, padrao: fallback, rotulo: label, param = "parte" }: { itens: ItemPart[]; padrao: string | null; rotulo: string; param?: string }) {
  // The default applies on arrival: the part does not close under whoever is in it when its alert resolves.
  const [initial, initialSet] = useState(fallback);
  const [requested, launch] = usePart(param, initial);
  const [params] = useSearchParams();
  const chose = params.has(param);
  const master = useMedia(MASTER);
  // An alert that arrives later (a query that failed last, for example) opens the part, unless the person already chose.
  const withAlert = items.filter((i) => i.tom).map((i) => i.id).join(" ");
  const seen = useRef(withAlert);
  useEffect(() => {
    const before = seen.current.split(" ");
    seen.current = withAlert;
    const created = withAlert.split(" ").find((id) => id && !before.includes(id));
    if (created && !chose) initialSet(created);
  }, [withAlert, chose]);
  const exists = (id: string | null) => items.some((i) => i.id === id);
  // A part that left the screen (or an old address) falls back to the default; in master-detail, there is always one chosen.
  const open = exists(requested) ? requested : master ? (exists(fallback) ? fallback : items[0]?.id ?? null) : requested === null ? null : fallback;
  // A single tree for both layouts: crossing 1280 px neither unmounts the panel nor loses a draft or a recording.
  return (
    <div className={master ? "grid grid-cols-[260px_minmax(0,1fr)] items-start gap-x-10" : undefined}>
      {/* The list stays still: choosing a part only swaps the panel. Selection in papel-2 and bold, no blue. */}
      {master && (
        <ul aria-label={label} className="sticky top-[calc(var(--topo)+32px)] m-0 grid list-none gap-1 p-0">
          {items.map((i) => {
            const current = i.id === open;
            return (
              <li key={i.id}>
                <button type="button" aria-current={current ? "true" : undefined} aria-expanded={current} aria-controls={`painel-${i.id}`} onClick={() => launch(i.id)}
                  className={`grid min-h-11 w-full grid-cols-[minmax(0,1fr)] gap-0.5 rounded-btn border-0 px-3 py-2.5 text-left font-[inherit] ${current ? "cursor-default bg-papel-2" : "cursor-pointer bg-transparent hover:bg-papel-2/60"}`}>
                  <span className={`text-[16px] text-texto-forte ${current ? "font-bold" : ""}`}>{i.rotulo}</span>
                  <span className={`mono min-w-0 text-[13px] [overflow-wrap:anywhere] ${i.tom ? TONE_COLOR[i.tom] : "text-apoio"}`}>{i.resumo}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className={master ? "grid min-w-0 grid-cols-[minmax(0,1fr)]" : undefined}>
        {items.map((i) => {
          const current = open === i.id;
          return (
            <section key={i.id} hidden={master && !current} aria-labelledby={master ? `titulo-${i.id}` : `parte-${i.id}`} className={master ? undefined : PART_CLASS}>
              {!master && <PartLine id={i.id} rotulo={i.rotulo} resumo={i.resumo} tom={i.tom} acao={i.acao} nivel="h2" aberta={current} alternar={() => launch(current ? null : i.id)} />}
              <PanelView id={`painel-${i.id}`} aberta={current} manter aoAlerta={() => launch(i.id)} className={master ? "grid grid-cols-[minmax(0,1fr)] content-start gap-4" : PANEL_CLASS}>
                {master && <h2 id={`titulo-${i.id}`} className="m-0 text-[22px]">{i.rotulo}</h2>}
                {i.conteudo}
                {master && i.acao && <div className="justify-self-start">{i.acao}</div>}
              </PanelView>
            </section>
          );
        })}
      </div>
    </div>
  );
}
