// Aparência das telas (DESIGN.md §12): "papel" (o padrão; a identidade é papel) ou "à noite" (a mesa escurece e o papel
// acompanha). A escolha é de cada pessoa neste navegador e nunca liga sozinha, nem pelo tema do sistema. Quem lê é o CSS:
// `data-mesa="noite"` no <html> troca os tokens (tokens.css).
import { useSyncExternalStore } from "react";

export type Mesa = "papel" | "noite";
export const ehMesa = (v: unknown): v is Mesa => v === "papel" || v === "noite";

const CHAVE = "redacao:mesa";

function inicial(): Mesa {
  if (typeof document === "undefined") return "papel";
  try {
    const salva = localStorage.getItem(CHAVE);
    if (ehMesa(salva)) return salva;
  } catch { /* modo privado */ }
  return "papel";
}

let atual: Mesa = inicial();
const ouvintes = new Set<() => void>();

function aplicar() {
  if (typeof document === "undefined") return;
  if (atual === "noite") document.documentElement.setAttribute("data-mesa", "noite");
  else document.documentElement.removeAttribute("data-mesa");
}
aplicar();

export const mesa = (): Mesa => atual;

export function escolherMesa(nova: Mesa) {
  if (nova === atual) return;
  atual = nova;
  try { localStorage.setItem(CHAVE, nova); } catch { /* modo privado */ }
  aplicar();
  ouvintes.forEach((f) => f());
}

/** A aparência em uso, para quem desenha a escolha (o menu da conta). */
export function useMesa(): Mesa {
  return useSyncExternalStore((f) => { ouvintes.add(f); return () => ouvintes.delete(f); }, () => atual, () => "papel");
}
