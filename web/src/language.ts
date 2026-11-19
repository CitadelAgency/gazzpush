// Screen language: Brazilian Portuguese or English, chosen per person. The text stays in place, as a pair:
// `t("Aprovar", "Approve")`. It starts from the choice saved in this browser, then the browser's language; the account
// stores the choice (GET /api/me brings it, PUT /api/me/idioma saves it) and the shell applies it when the session arrives.
import { useSyncExternalStore } from "react";

export type Language = "pt-BR" | "en";
export const LANGUAGES: readonly Language[] = ["pt-BR", "en"];
export const isLanguage = (v: unknown): v is Language => v === "pt-BR" || v === "en";

const KEY = "redacao:idioma";

/** From the browser: Portuguese from anywhere becomes pt-BR; any other language, English. */
export function fromBrowserLanguage(langs: readonly string[] = typeof navigator === "undefined" ? [] : navigator.languages ?? [navigator.language]): Language {
  const first = langs.find(Boolean)?.toLowerCase();
  if (!first) return "pt-BR";
  return first.startsWith("pt") ? "pt-BR" : "en";
}

function initial(): Language {
  // Outside the browser (Worker tests, which import the screen's rules): Portuguese, as before.
  if (typeof document === "undefined") return "pt-BR";
  try {
    const saved = localStorage.getItem(KEY);
    if (isLanguage(saved)) return saved;
  } catch { /* modo privado */ }
  return fromBrowserLanguage();
}

let current: Language = initial();
const listeners = new Set<() => void>();
if (typeof document !== "undefined") document.documentElement.lang = current;

/** The language in use now. */
export const language = (): Language => current;
/** Locale for `Intl` and `toLocale*`. */
export const locale = (): string => (current === "en" ? "en-US" : "pt-BR");
/** The text in the language in use: `t("Salvar", "Save")`. Works outside components (switching remounts the screens). */
export const t = <T,>(pt: T, en: T): T => (current === "en" ? en : pt);

export function changeLanguage(created: Language) {
  if (created === current) return;
  current = created;
  try { localStorage.setItem(KEY, created); } catch { /* modo privado */ }
  document.documentElement.lang = created;
  listeners.forEach((f) => f());
}

const sign = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
/** For the root: re-renders (and remounts the screens) when the language changes. */
export const useLanguage = () => useSyncExternalStore(sign, language, language);
