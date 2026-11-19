// Small pieces several screens use: tab title, load failure, opening.
import { useEffect } from "react";
import { t } from "./language";
import GazzpushBrand from "./kit/GazzpushMark";
import { PRODUCT } from "./brand";

export function useTitle(...parts: (string | undefined)[]) {
  const title = [...parts.filter(Boolean), PRODUCT].join(" · ");
  useEffect(() => { document.title = title; }, [title]);
}

/** "a · b · c" metadata where each part stays whole on one line ("há 6 h" does not break at the "h") and the dot stays
 *  with the part before it: a line never starts with "·". */
export function Parts({ partes: parts }: { partes: (string | null | undefined | false)[] }) {
  const list = parts.filter(Boolean);
  return <>{list.map((x, i) => <span key={i}><span className="whitespace-nowrap">{x}{i < list.length - 1 && <span className="sep"> ·</span>}</span>{i < list.length - 1 && " "}</span>)}</>;
}

/** A load failure never becomes a fact (DESIGN.md §6.8): it says what did not load and offers to try again. */
export function FailureLoad({ oque: what, tentar: attempt }: { oque: string; tentar: () => void }) {
  return (
    <div role="alert" className="faixa-erro flex flex-wrap items-baseline gap-x-2">
      <span>{t(`Não carregou ${what}.`, `Couldn't load ${what}.`)}</span>
      <button type="button" onClick={attempt} className="cursor-pointer font-bold underline underline-offset-3">{t("Tentar de novo", "Try again")}</button>
    </div>
  );
}

/** While the session has not arrived: the paper and the product name, without a layout jump. */
export function Opening() {
  return (
    <div className="grid min-h-dvh place-items-center" aria-busy="true">
      <p><GazzpushBrand /><span className="sr-only">{t(": carregando", ": loading")}</span></p>
    </div>
  );
}

/** Is focus somewhere the person types (field, text area, select, editor)? A single-key shortcut only works outside it. */
export function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

/**
 * A single-key shortcut (A, E, X, J, K, ← →, DESIGN.md §6.12). It works when nobody handled the event, without
 * Ctrl/⌘/Alt, outside a text field, with no dialog or menu open and with focus on the screen's content (or loose on the
 * page body): never with focus on the sidebar, a menu or a sheet. It is what WCAG 2.1.4 asks for: the shortcut only acts
 * where the person is. `repetir`: a held key keeps working (the card arrows); the others work once per press.
 */
export function freeShortcut(e: KeyboardEvent, repeat = false): boolean {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || (e.repeat && !repeat) || typing(e.target)) return false;
  if (document.querySelector("dialog[open], [role='menu']")) return false;
  const target = e.target;
  return target === document.body || (target instanceof Element && !!target.closest("#conteudo"));
}
