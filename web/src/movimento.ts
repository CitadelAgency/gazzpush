// De onde veio a última ação: tecla ou ponteiro (DESIGN.md §12). O que nasce do teclado não anima: atalho, paleta e Enter
// se repetem o dia inteiro, e animação ali vira atraso. O <html> leva `data-tecla` enquanto a última ação foi do teclado,
// e o CSS (tokens.css) tira a troca de tela, a entrada de lista, a folha, o menu e o carimbo desse caso.
let tecla = false;

/** A última ação veio do teclado? Para o que decide em código (o carimbo do Aprovar, por exemplo). */
export const veioDoTeclado = () => tecla;

export function instalarMovimento() {
  if (typeof document === "undefined") return;
  const marcar = (v: boolean) => {
    if (tecla === v) return;
    tecla = v;
    document.documentElement.toggleAttribute("data-tecla", v);
  };
  window.addEventListener("keydown", () => marcar(true), true);
  window.addEventListener("pointerdown", () => marcar(false), true);
}
