// The proof: the post as a sheet on the desk (DESIGN.md §8). The card serves the four lists (To approve, Ready to post,
// Posted and the Ideas rail): the art in 4:5 with the queue number and the format, the caption in mono, the headline,
// the wait bar and the action. The whole card is the link (the accessible name ends with the action, like the old rows).
// The hand mark sits on the next action: the pencil loop and the crop marks always showing; the other actions get the
// arrow. The open proof's art travels to the post's stage and back (kit/artTransition).
import { useEffect, useRef, type CSSProperties, type FocusEvent, type MouseEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { IconCarousel, IconImage, IconGo, IconReels } from "../shell/icons";
import { Parts } from "../common";
import { t } from "../language";
import { ART_NAME, artRemembered, rememberArt, markArt } from "./artTransition";
import { BackPencil } from "./Pencil";

/**
 * Whoever points at a proof (or focuses it) requests, unhurried (90 ms of intent), what the post screen will need
 * (src/warmup.ts): on open, review is already ready. Without the function, it does nothing.
 */
export function useWarm(warm?: () => void) {
  const wait = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(wait.current), []);
  if (!warm) return {};
  const schedule = () => { clearTimeout(wait.current); wait.current = setTimeout(warm, 90); };
  const cancel = () => clearTimeout(wait.current);
  return {
    onPointerEnter: schedule,
    onPointerLeave: cancel,
    onFocus: (e: FocusEvent<HTMLElement>) => { if (e.currentTarget.matches(":focus-visible")) schedule(); },
    onBlur: cancel,
  };
}

/**
 * "waiting 5 days · ready 31/10": on mobile the two halves go one per line, without the dot hanging at the end of the
 * line (the whole sentence stays in the proof's text, which is what tests and screen readers read).
 */
function splitWait(text: string): ReactNode {
  const [first, ...rest] = text.split(" · ");
  if (!rest.length) return text;
  return <>{first}<span className="sep"> · </span><span>{rest.join(" · ")}</span></>;
}

/** Position on the entrance stair: only the first ones rise one by one; the rest enter together. */
export const ladder = (i: number) => ({ "--i": Math.min(i, 8) }) as CSSProperties;

export function IconFormat({ formato: format, className }: { formato: string; className?: string }) {
  const Icon = format === "carrossel" ? IconCarousel : format === "reels" ? IconReels : IconImage;
  return <Icon className={className ?? "size-3.5"} />;
}

/**
 * The art's journey, outbound (kit/artTransition): on the click (or Enter) that opens the post in this tab, only this
 * art carries the transition name, and the post is remembered for the way back. A click that opens another tab (Ctrl,
 * ⌘, Shift, Alt, middle button) marks nothing: the screen will not change.
 */
export function takeArt(e: MouseEvent, id: string, art: HTMLElement | null) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  markArt(art);
  rememberArt(id);
}

/**
 * The art's journey, on the way back: the art of the last opened post (only it) is born with the transition name. The
 * `data-arte-vt` is the same one `markArt` sets: on the next click, on another proof, it removes this one's name (two
 * elements with the same name on screen and the whole transition is abandoned).
 */
export const artThatBack = (id: string | undefined) =>
  (id && artRemembered() === id ? { "data-arte-vt": "", style: { viewTransitionName: ART_NAME } as CSSProperties } : {});

/**
 * The proof's art: the cover in 4:5 (or the hatched paper, while there is no cover). Decorative; a carousel carries a
 * sheet behind it. With `id` (the post), it receives the journey back from the stage when that was the last post opened.
 */
export function ArtProof({ capa: cover, formato: format, vaga: slot, id }: { capa: string | null; formato: string; vaga?: ReactNode; id?: string }) {
  return (
    <span className="prova-arte corte" data-pilha={format === "carrossel" ? "" : undefined} {...artThatBack(id)}>
      {cover ? (
        <img src={cover} alt="" width={540} height={675} loading="lazy" decoding="async" />
      ) : (
        <span aria-hidden="true" className="prova-vaga">{slot}</span>
      )}
    </span>
  );
}

/** Wait bar: the filled part is this proof's wait relative to the oldest in the queue (0 to 1). */
export function Ruler({ fracao: fraction }: { fracao: number }) {
  return <span aria-hidden="true" className="regua"><i style={{ width: `${Math.round(Math.max(0.04, Math.min(1, fraction)) * 100)}%` }} /></span>;
}

/**
 * `id` is the proof's post: with it, the art travels to the post's stage on click and back (kit/artTransition); without
 * it, the proof only opens the link. The next action gets the pencil loop; the others, the arrow (which moves 3 px on
 * hover, `.acao-seta`). `atual` marks the chosen proof in a list with a panel beside it (`aria-current="true"`).
 * `aoClicar` comes before everything on click: if it calls `preventDefault` (the list selects instead of opening), the
 * link does not navigate and the art does not travel.
 */
export function ProofPost({ id, para: to, capa: cover, formato: format, n, meta, manchete: headline, espera: wait, fracao: fraction, acao: action, proxima: next, onApontar: onPoint, atual: current, aoClicar: onClick }: {
  id?: string; para: string; capa: string | null; formato: string; n: number;
  meta: (string | null | false)[]; manchete: string; espera: string; fracao: number | null; acao: string; proxima: boolean; onApontar?: () => void;
  atual?: boolean; aoClicar?: (e: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const point = useWarm(onPoint);
  return (
    <li className="prova-li entra" style={ladder(n - 1)}>
      <Link to={to} viewTransition data-proxima={next ? "" : undefined} aria-current={current ? "true" : undefined} className="prova" {...point}
        onClick={(e) => {
          onClick?.(e);
          if (id) takeArt(e, id, e.currentTarget.querySelector<HTMLElement>(".prova-arte"));
        }}>
        <ArtProof capa={cover} formato={format} id={id} />
        <span className="prova-corpo">
          <span className="mono prova-meta">
            <span aria-hidden="true" className="prova-n">{String(n).padStart(2, "0")}</span>
            <span><Parts partes={meta} /></span>
          </span>
          <span className="prova-manchete">{headline}</span>
          {fraction !== null && <Ruler fracao={fraction} />}
          <span className="mono prova-espera text-apoio">{splitWait(wait)}</span>
          <span className={`acao ${next ? "acao-lapis -ml-[6px] w-fit" : "acao-seta"}`}>
            <span>{action}</span>{next ? <BackPencil desenhar /> : <IconGo className="size-[15px]" />}
          </span>
        </span>
      </Link>
    </li>
  );
}

/**
 * The line under a desk's title: the number that matters in graphite and the rest in support ("4 waiting for you · the
 * oldest has waited 3 days"). Each part stays whole on the line, and the dot stays with the part before it.
 */
export function DeskLine({ forte: strong, partes: parts }: { forte: string; partes: (string | null | false | undefined)[] }) {
  const rest = parts.filter(Boolean);
  return (
    <p className="m-0 mt-1.5 text-[15px] text-apoio">
      <span className="whitespace-nowrap"><b className="font-semibold text-texto-forte">{strong}</b>{rest.length > 0 && <span className="sep"> ·</span>}</span>
      {rest.length > 0 && <>{" "}<Parts partes={rest} /></>}
    </p>
  );
}

/** Four blank proofs while the list loads: the same grid, so the screen does not jump. */
export function DeskSkeleton({ n = 4 }: { n?: number }) {
  return (
    <ul className="mesa m-0 list-none p-0" aria-busy="true">
      {Array.from({ length: n }, (_, i) => (
        <li key={i} className="prova-esq grid gap-3.5">
          <span className="prova-arte esqueleto" style={{ animationDelay: `${i * 120}ms` }} />
          <span className="grid gap-2"><span className="esqueleto h-3 w-24" /><span className="esqueleto h-5 w-[88%]" /><span className="esqueleto h-5 w-[60%]" /></span>
        </li>
      ))}
    </ul>
  );
}

/** An empty list: a blank, dashed proof with the crop marks, next to the text. */
export function EmptyDesk({ children, rotulo: label }: { children: ReactNode; rotulo?: string }) {
  return (
    <section className="mt-8 grid items-center gap-8 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-12">
      <div className="folha-vazia corte" aria-hidden="true">
        <span className="mono text-[11px] tracking-[.08em] uppercase">{label ?? t("mesa vazia", "empty desk")}</span>
      </div>
      <div className="grid justify-items-start gap-3">{children}</div>
    </section>
  );
}
