// A arte da prova viaja da mesa para o palco (e de volta) na troca de tela (DESIGN.md §12): a prova que foi clicada e a
// arte do palco levam o mesmo `view-transition-name`, e o navegador faz o caminho entre as duas. Só um elemento por vez
// pode ter o nome na tela, senão a transição inteira é abandonada.
export const NOME_ARTE = "arte";

let ultima: string | null = null;

/** A peça cuja arte viajou por último (a que acabou de ser aberta). Na volta para a lista, a prova dela leva o nome. */
export const lembrarArte = (id: string | null) => { ultima = id; };
export const arteLembrada = () => ultima;

/** No clique (ou Enter) numa prova: só a arte dela leva o nome. Chame antes de navegar. */
export function marcarArte(el: HTMLElement | null) {
  document.querySelectorAll<HTMLElement>("[data-arte-vt]").forEach((x) => {
    x.style.viewTransitionName = "";
    x.removeAttribute("data-arte-vt");
  });
  if (el) {
    el.style.viewTransitionName = NOME_ARTE;
    el.setAttribute("data-arte-vt", "");
  }
}
