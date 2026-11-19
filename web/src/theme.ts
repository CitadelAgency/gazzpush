// Screen appearance (DESIGN.md §12): "papel" (the default; the identity is paper) or "à noite" (the desk darkens and the
// paper follows). The choice belongs to each person in this browser and never switches on by itself, not even from the
// system theme. The CSS reads it: `data-mesa="noite"` on <html> swaps the tokens (tokens.css).
import { useSyncExternalStore } from "react";

export type Desk = "papel" | "noite";
export const isDesk = (v: unknown): v is Desk => v === "papel" || v === "noite";

const KEY = "redacao:mesa";

function initial(): Desk {
  if (typeof document === "undefined") return "papel";
  try {
    const saved = localStorage.getItem(KEY);
    if (isDesk(saved)) return saved;
  } catch { /* modo privado */ }
  return "papel";
}

let current: Desk = initial();
const listeners = new Set<() => void>();

function apply() {
  if (typeof document === "undefined") return;
  if (current === "noite") document.documentElement.setAttribute("data-mesa", "noite");
  else document.documentElement.removeAttribute("data-mesa");
}
apply();

export const desk = (): Desk => current;

export function chooseDesk(created: Desk) {
  if (created === current) return;
  current = created;
  try { localStorage.setItem(KEY, created); } catch { /* modo privado */ }
  apply();
  listeners.forEach((f) => f());
}

/** The appearance in use, for whoever draws the choice (the account menu). */
export function useDesk(): Desk {
  return useSyncExternalStore((f) => { listeners.add(f); return () => listeners.delete(f); }, () => current, () => "papel");
}
