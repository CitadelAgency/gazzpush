// Folio (DESIGN.md §12): the line at the top of the sheet, as at the top of a newspaper page. On the left, where I am:
// the screen's name appears when the title scrolls out, and a post's screen puts the way back there (InFolio). On the
// right, what is happening (producing, source unavailable), the date and the place; the screen can swap it for
// something of its own (InFolioDir).
import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { instant, useSources, usePieces } from "../queue";
import { locale, t } from "../language";
import { PRODUCT } from "../brand";
import { localOf, type Outlet } from "../session";
import { IconAlert, RecordIcon } from "./icons";

/** The screen's name, taken from the tab title (useTitle): it works for every screen, without each one telling the shell. */
function useNameScreen() {
  const read = () => { const name = document.title.split(" · ")[0] ?? ""; return name === PRODUCT ? "" : name; };
  const [name, setName] = useState(read);
  useEffect(() => {
    const title = document.querySelector("title");
    if (!title) return;
    const eye = new MutationObserver(() => setName(read()));
    eye.observe(title, { childList: true, characterData: true, subtree: true });
    setName(read());
    return () => eye.disconnect();
  }, []);
  return name;
}

export function Folio({ veiculo: outlet }: { veiculo: Outlet }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const see = () => setScrolled(window.scrollY > 40);
    see();
    window.addEventListener("scroll", see, { passive: true });
    return () => window.removeEventListener("scroll", see);
  }, []);
  const name = useNameScreen();
  const pieces = usePieces(outlet.id);
  const sources = useSources(outlet.id);
  const drafts = (pieces.data?.pecas ?? []).filter((p) => p.status === "rascunho").sort((a, b) => instant(a.created_at) - instant(b.created_at));
  const producing = Math.max(pieces.data?.total.rascunho ?? 0, drafts.length);
  const outside = sources.data?.fontes.filter((f) => !f.ok).length ?? 0;
  const today = new Intl.DateTimeFormat(locale(), { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
  return (
    <div className="folio" data-rolou={scrolled ? "" : undefined}>
      <div className="folio-trilha" id="folio-trilha"><b className="folio-titulo" aria-hidden="true">{name}</b></div>
      <div className="folio-dir">
        <div id="folio-dir" className="contents" />
        <div className="folio-padrao">
          {producing > 0 && drafts[0] && (
            <Link to={`p/${drafts[0].id}`} viewTransition className="folio-estado mono"><RecordIcon />{t(`${producing} produzindo`, `${producing} in production`)}</Link>
          )}
          {outside > 0 && (
            <Link to="veiculo?aba=fontes" viewTransition className="folio-estado mono" data-tom="aviso">
              <IconAlert className="size-[15px]" />{outside === 1 ? t("1 fonte indisponível", "1 source unavailable") : t(`${outside} fontes indisponíveis`, `${outside} sources unavailable`)}
            </Link>
          )}
          <span className="mono">{today} · {localOf(outlet)}</span>
        </div>
      </div>
    </div>
  );
}

function useIn(id: string) {
  const [node, setIn] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => { setIn(document.getElementById(id)); }, [id]);
  return node;
}

/** The screen's way back (and whatever else it wants to say about where it is), on the folio's left side. */
export function InFolio({ children }: { children: ReactNode }) {
  const node = useIn("folio-trilha");
  return node ? createPortal(children, node) : null;
}

/** The folio's right side: what the screen puts there replaces the state, the date and the place (the queue's pager, for example). */
export function InFolioDir({ children }: { children: ReactNode }) {
  const node = useIn("folio-dir");
  return node ? createPortal(children, node) : null;
}
