// Where the last action came from: key or pointer (DESIGN.md §12). What comes from the keyboard does not animate:
// shortcuts, the palette and Enter repeat all day, and animation there becomes delay. <html> carries `data-tecla` while
// the last action was from the keyboard, and the CSS (tokens.css) drops the screen swap, list entrance, sheet, menu and
// stamp in that case.
let key = false;

/** Did the last action come from the keyboard? For what decides in code (the Approve stamp, for example). */
export const cameKeyboard = () => key;

export function installMotion() {
  if (typeof document === "undefined") return;
  const mark = (v: boolean) => {
    if (key === v) return;
    key = v;
    document.documentElement.toggleAttribute("data-tecla", v);
  };
  window.addEventListener("keydown", () => mark(true), true);
  window.addEventListener("pointerdown", () => mark(false), true);
}
