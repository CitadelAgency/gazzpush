// The blue-pencil reviewer in the editor (DESIGN.md §10): each paragraph's note, its cycle on screen, the desktop margin,
// the speech offer and the switch. The rules live in src/lib/reviewer.ts; here only what depends on the browser.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueries } from "@tanstack/react-query";
import type { Editor } from "@tiptap/react";
import { reconcileNotes, type SpeechFound, type Note, type NoteLive, type SpeechPassage } from "../../../src/lib/reviewer";
import { read } from "../api";
import { t } from "../language";
import { UnderlinePencil } from "../kit/Pencil";
import { mmss } from "./Recordings";
import { route, type DeskState } from "./common";

const TOGGLE_KEY = "redacao:revisor";
// Strike (300 ms), the pause to read and the short exit: the same timing as .nota-sai in tokens.css.
const STRIKES_MS = 920;
const BORN_MS = 750;

export const withoutMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** On by default and stored in this browser: it is the way out for whoever wants to write with nothing moving. */
export function useToggleNotes() {
  const [on, setOn] = useState(() => {
    try { return localStorage.getItem(TOGGLE_KEY) !== "desligado"; } catch { return true; }
  });
  const change = (v: boolean) => {
    setOn(v);
    try { localStorage.setItem(TOGGLE_KEY, v ? "ligado" : "desligado"); } catch { /* without storage, it lasts until the screen closes */ }
  };
  return [on, change] as const;
}

export const noteKey = (n: NoteLive) => `${n.blocoId}:${n.chave}:${n.fase === "risca" ? "riscada" : "viva"}`;

/** The notes on screen: on each change of what the marks ask for, `reconcileNotes` says what stays, gets struck through or is born. */
export function useNotes({ ativo: active, alvo: target, existem: exist, espera: wait, cursor }: { ativo: boolean; alvo: Note[]; existem: Set<string>; espera: Set<string>; cursor: string | null }) {
  const [live, setLive] = useState<NoteLive[]>([]);
  const [ad, setAd] = useState("");
  const current = useRef<NoteLive[]>([]);
  const opening = useRef(true);
  const clocks = useRef(new Map<string, number>());
  const list = (s: Set<string>) => [...s].join(" ");
  const swap = (r: NoteLive[]) => { current.current = r; setLive(r); };

  useLayoutEffect(() => {
    if (!active) {
      opening.current = true;
      if (current.current.length) swap([]);
      return;
    }
    const session = !opening.current;
    opening.current = false;
    const before = current.current;
    const r = reconcileNotes(before, target, { existem: exist, espera: wait, cursor, sessao: session, animar: session && !withoutMotion() });
    if (JSON.stringify(r) === JSON.stringify(before)) return;
    swap(r);
    if (!session) return;
    const had = new Set(before.map(noteKey));
    const created = r.filter((n) => n.fase !== "risca" && !had.has(noteKey(n)));
    if (created.length) setAd(created.map((n) => t(`Nova nota: ${n.pt}`, `New note: ${n.en}`)).join(" "));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, target.map((n) => `${n.blocoId}|${n.chave}|${n.marcaId}`).join(), list(exist), list(wait), cursor]);

  useEffect(() => {
    for (const n of live) {
      const k = noteKey(n);
      if (n.fase === "pronta" || clocks.current.has(k)) continue;
      clocks.current.set(k, window.setTimeout(() => {
        clocks.current.delete(k);
        swap(n.fase === "risca" ? current.current.filter((x) => noteKey(x) !== k) : current.current.map((x) => (noteKey(x) === k ? { ...x, fase: "pronta" as const } : x)));
      }, n.fase === "risca" ? STRIKES_MS : BORN_MS));
    }
  }, [live]);
  useEffect(() => () => {
    for (const r of clocks.current.values()) window.clearTimeout(r);
    clocks.current.clear();
  }, []);

  return { vivas: live, anuncio: ad };
}

const seedValue = (s: string) => ([...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 997) + 1;

/** The question, with the pencil underline and, on exit, the strike over it. */
export function NoteText({ nota: note }: { nota: NoteLive }) {
  const seed = seedValue(note.blocoId + note.chave);
  return (
    <span data-nota={note.chave} className={`nota-revisor nota-${note.fase}`}>
      <span className="nota-revisor-texto">
        {t(note.pt, note.en)}
        <UnderlinePencil seed={seed} larg={1.6} desenhar={note.fase === "nasce"} />
        {note.fase === "risca" && <UnderlinePencil className="lapis-risco" seed={seed + 1} larg={1.8} desenhar />}
      </span>
    </span>
  );
}

/** The struck-through note in place: it stays long enough to read and closes its space on exit. */
export const NoteLeaving = ({ nota: note }: { nota: NoteLive }) => <span className="nota-sai"><span className="nota-sai-miolo"><NoteText nota={note} /></span></span>;

/** Below the paragraph (mobile and focus mode). It lives in an editor widget, so it does not enter the document. */
export function NotesBlock({ notas: notes, abrir: launch }: { notas: NoteLive[]; abrir: (n: NoteLive) => void }) {
  return notes.map((n) => (n.fase === "risca"
    ? <NoteLeaving key={noteKey(n)} nota={n} />
    : <button key={noteKey(n)} type="button" className="nota-botao" onMouseDown={(e) => e.preventDefault()} onClick={() => launch(n)}><NoteText nota={n} /></button>));
}

/**
 * The column as a margin: each card at its paragraph's height, and what would collide moves down until it fits. The
 * column scrolls with the page, with no scroll of its own. Positions go straight onto the element: measuring and moving
 * here does not re-render, and typing does not feel it.
 */
export function MarginList({ ed, chaves: keys, children }: { ed: Editor; chaves: string; children: ReactNode }) {
  const list = useRef<HTMLUListElement>(null);
  const align = useRef(() => {});
  align.current = () => {
    const ul = list.current;
    if (!ul || ul.offsetParent === null) return;   // hidden part: measures on open
    const base = ul.getBoundingClientRect().top;
    let end = 0;
    for (const li of [...ul.children] as HTMLElement[]) {
      const block = li.dataset.bloco ? ed.view.dom.querySelector(`[data-id="${CSS.escape(li.dataset.bloco)}"]`) : null;
      const y = Math.round(Math.max(block ? block.getBoundingClientRect().top - base : end, end));
      li.style.top = `${y}px`;
      end = y + li.offsetHeight + 8;
    }
    ul.style.minHeight = `${end}px`;
  };
  useLayoutEffect(() => align.current());
  useEffect(() => {
    const eye = new ResizeObserver(() => align.current());
    eye.observe(ed.view.dom);
    for (const li of list.current?.children ?? []) eye.observe(li);
    void document.fonts?.ready.then(() => align.current());
    return () => eye.disconnect();
  }, [ed, keys]);
  return <ul ref={list} className="relative m-0 list-none p-0">{children}</ul>;
}

/** The text's ready transcripts: only if there is a ready recording, and once per text (the same query as the Quotes part). */
export function useSpeeches(tenantId: string, textId: string, recordings: DeskState["gravacoes"], active: boolean): SpeechPassage[] {
  const ready = recordings.filter((g) => g.estado === "pronto");
  const queries = useQueries({
    queries: ready.map((g) => ({
      queryKey: [tenantId, "transcricao", g.id],
      enabled: active, staleTime: Infinity,
      queryFn: () => read(route.gravacoes[":arquivo"].transcricao.$get({ param: { tenantId, id: textId, arquivo: g.id } })),
    })),
  });
  const version = queries.map((c) => c.dataUpdatedAt).join();
  return useMemo(
    () => queries.flatMap((c, i) => (c.data?.trechos ?? []).map((tr) => ({ gravacao: ready[i].id, nome: ready[i].nome, inicio: tr.inicio, texto: tr.texto }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version],
  );
}

/** The speech offer, in the `@` menu's pattern: Tab or click inserts, Esc dismisses (keys in StoryText). */
export function OfferSpeech({ achada: found, inserir: insert, topo: upper, esquerda: left, acima: above, id }: { achada: SpeechFound; inserir: () => void; topo: number; esquerda: number; acima: boolean; id: string }) {
  const { trecho: passage } = found;
  return (
    <div className="absolute z-20 w-[min(360px,90vw)] rounded-card bg-branco p-1.5 shadow-curta" style={{ top: upper, left: left, transform: above ? "translateY(-100%)" : undefined }}>
      <p className="mono m-0 px-2 pt-1 pb-1.5 text-[12px] text-apoio">{t("fala da gravação · Tab insere · Esc dispensa", "from the recording · Tab inserts · Esc dismisses")}</p>
      <ul id={id} role="listbox" aria-label={t("Fala da gravação", "Speech from the recording")} className="m-0 grid list-none gap-0.5 p-0">
        <li id={`${id}-fala`} role="option" aria-selected="true" onMouseDown={(e) => { e.preventDefault(); insert(); }} className="grid min-h-11 cursor-pointer content-center gap-0.5 rounded-btn bg-papel-2 px-2 py-1.5 text-[15px] text-texto-forte">
          <span className="mono truncate text-[12px] text-apoio">{mmss(passage.inicio)} · {passage.nome}</span>
          <span className="line-clamp-3">{passage.texto.trim()}</span>
        </li>
      </ul>
    </div>
  );
}
