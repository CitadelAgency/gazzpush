// Idioma das telas: português do Brasil ou inglês, escolhido por pessoa. O texto fica no próprio lugar, em par:
// `t("Aprovar", "Approve")`. Começa pela escolha salva neste navegador, depois pelo idioma do navegador; a conta guarda a
// escolha (GET /api/me traz, PUT /api/me/idioma grava) e a casca aplica quando a sessão chega.
import { useSyncExternalStore } from "react";

export type Idioma = "pt-BR" | "en";
export const IDIOMAS: readonly Idioma[] = ["pt-BR", "en"];
export const ehIdioma = (v: unknown): v is Idioma => v === "pt-BR" || v === "en";

const CHAVE = "redacao:idioma";

/** Do navegador: português de qualquer lugar fica pt-BR; qualquer outro idioma, inglês. */
export function idiomaDoNavegador(langs: readonly string[] = typeof navigator === "undefined" ? [] : navigator.languages ?? [navigator.language]): Idioma {
  const primeiro = langs.find(Boolean)?.toLowerCase();
  if (!primeiro) return "pt-BR";
  return primeiro.startsWith("pt") ? "pt-BR" : "en";
}

function inicial(): Idioma {
  // Fora do navegador (testes do Worker, que importam as regras da tela): português, como antes.
  if (typeof document === "undefined") return "pt-BR";
  try {
    const salvo = localStorage.getItem(CHAVE);
    if (ehIdioma(salvo)) return salvo;
  } catch { /* modo privado */ }
  return idiomaDoNavegador();
}

let atual: Idioma = inicial();
const ouvintes = new Set<() => void>();
if (typeof document !== "undefined") document.documentElement.lang = atual;

/** O idioma em uso agora. */
export const idioma = (): Idioma => atual;
/** Locale para `Intl` e `toLocale*`. */
export const locale = (): string => (atual === "en" ? "en-US" : "pt-BR");
/** O texto no idioma em uso: `t("Salvar", "Save")`. Funciona fora de componente (a troca remonta as telas). */
export const t = <T,>(pt: T, en: T): T => (atual === "en" ? en : pt);

export function mudarIdioma(novo: Idioma) {
  if (novo === atual) return;
  atual = novo;
  try { localStorage.setItem(CHAVE, novo); } catch { /* modo privado */ }
  document.documentElement.lang = novo;
  ouvintes.forEach((f) => f());
}

const assinar = (f: () => void) => { ouvintes.add(f); return () => { ouvintes.delete(f); }; };
/** Para a raiz: re-renderiza (e remonta as telas) quando o idioma muda. */
export const useIdioma = () => useSyncExternalStore(assinar, idioma, idioma);
