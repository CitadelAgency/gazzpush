// The proof's art travels from the desk to the stage (and back) on a screen change (DESIGN.md §12): the clicked proof
// and the stage's art carry the same `view-transition-name`, and the browser makes the path between the two. Only one
// element at a time may have the name on screen, otherwise the whole transition is abandoned.
export const ART_NAME = "arte";

let last: string | null = null;

/** The piece whose art travelled last (the one just opened). On the way back to the list, its proof carries the name. */
export const rememberArt = (id: string | null) => { last = id; };
export const artRemembered = () => last;

/** On click (or Enter) on a proof: only its art carries the name. Call before navigating. */
export function markArt(el: HTMLElement | null) {
  document.querySelectorAll<HTMLElement>("[data-arte-vt]").forEach((x) => {
    x.style.viewTransitionName = "";
    x.removeAttribute("data-arte-vt");
  });
  if (el) {
    el.style.viewTransitionName = ART_NAME;
    el.setAttribute("data-arte-vt", "");
  }
}
