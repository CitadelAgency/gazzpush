// Tooltips for icon-only buttons: `data-dica="Card seguinte" data-tecla="→"` on the element, and nothing else.
// The first one waits 450 ms, so it does not open by accident; with one already showing (or just closed), the next one
// opens at once. Only with a fine pointer (touch has no hover) and on keyboard focus. A tooltip is never the only place
// for a piece of information (DESIGN.md §9): the button has `aria-label`, and the shortcut is in the shortcuts sheet.
const WAIT = 450, HOT = 400;

let el: HTMLDivElement | null = null;
let currentTarget: HTMLElement | null = null;
let clock = 0, pending = false, closedAt = 0;

function show(target: HTMLElement, dry: boolean) {
  pending = false;
  const text = target.dataset.dica;
  if (!target.isConnected || !text) return;
  // The wait is over: is the pointer (or focus) still on the button? The page may have scrolled under it meanwhile.
  if (!dry && !target.matches(":hover, :focus-visible")) return;
  if (!el) {
    el = document.createElement("div");
    el.className = "dica";
    el.setAttribute("role", "tooltip");
  }
  // Inside an open sheet (the browser's top layer), the tooltip lives in the sheet: outside it, it would sit underneath.
  const home = target.closest<HTMLElement>("dialog[open]") ?? document.body;
  if (el.parentElement !== home) home.appendChild(el);   // appendChild: Element's `append` is typed by the Worker's HTMLRewriter
  el.replaceChildren(Object.assign(document.createElement("span"), { textContent: text }));
  for (const key of (target.dataset.tecla ?? "").split(" ").filter(Boolean)) {
    el.appendChild(Object.assign(document.createElement("span"), { className: "kbd", textContent: key }));
  }
  el.toggleAttribute("data-seco", dry);
  el.removeAttribute("data-on");
  const r = target.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
  const above = r.top - h - 8 > 4;
  const x = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8));
  const y = above ? r.top - h - 7 : r.bottom + 7;
  el.style.translate = `${Math.round(x)}px ${Math.round(y)}px`;
  el.style.setProperty("--origem", `${Math.round(r.left + r.width / 2 - x)}px ${above ? "bottom" : "top"}`);
  void el.offsetWidth;   // the browser registers the closed state before opening (otherwise the transition does not run)
  el.setAttribute("data-on", "");
  currentTarget = target;
}

function hide(dry = false) {
  window.clearTimeout(clock);
  pending = false;
  if (!currentTarget || !el) return;
  currentTarget = null;
  closedAt = Date.now();
  el.toggleAttribute("data-seco", dry);
  el.removeAttribute("data-on");
}

export function installTips() {
  if (typeof document === "undefined") return;
  const pointerThin = window.matchMedia("(hover: hover) and (pointer: fine)");
  document.addEventListener("mouseover", (e) => {
    const target = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-dica]") : null;
    if (!target) { if (currentTarget || pending) hide(); return; }
    if (target === currentTarget || !pointerThin.matches) return;
    window.clearTimeout(clock);
    if (currentTarget || Date.now() - closedAt < HOT) show(target, true);
    else { pending = true; clock = window.setTimeout(() => show(target, false), WAIT); }
  });
  document.addEventListener("focusin", (e) => {
    if (e.target instanceof HTMLElement && e.target.matches("[data-dica]:focus-visible")) show(e.target, true);
  });
  document.addEventListener("focusout", () => hide(true));
  window.addEventListener("mousedown", () => hide(true), true);
  window.addEventListener("keydown", () => hide(true), true);
  // Scrolled: the visible tooltip goes away (the button moved out from under it). One still waiting keeps waiting: any
  // scroll of the screen (the queue settling, for example) does not cancel the tooltip of the button the pointer rests on.
  window.addEventListener("scroll", () => { if (currentTarget) hide(true); }, true);
  // The button left the screen (the list updated, the screen changed): its tooltip goes with it.
  new MutationObserver(() => { if (currentTarget && !currentTarget.isConnected) hide(true); }).observe(document.body, { childList: true, subtree: true });
}
