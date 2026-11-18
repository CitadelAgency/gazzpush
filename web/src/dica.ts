// Dicas (tooltips) dos botões que só têm ícone: `data-dica="Card seguinte" data-tecla="→"` no elemento, e mais nada.
// A primeira espera 450 ms, para não abrir sem querer; com uma já à vista (ou recém-fechada), a vizinha abre seca.
// Só com ponteiro fino (no toque não há hover) e no foco pelo teclado. A dica nunca é o único lugar de uma informação
// (DESIGN.md §9): o botão tem `aria-label`, e o atalho está na folha de atalhos.
const ESPERA = 450, QUENTE = 400;

let el: HTMLDivElement | null = null;
let alvoAtual: HTMLElement | null = null;
let relogio = 0, pendente = false, fechouEm = 0;

function mostrar(alvo: HTMLElement, seco: boolean) {
  pendente = false;
  const texto = alvo.dataset.dica;
  if (!alvo.isConnected || !texto) return;
  // A espera acabou: o ponteiro (ou o foco) ainda está no botão? A página pode ter rolado por baixo dele nesse meio-tempo.
  if (!seco && !alvo.matches(":hover, :focus-visible")) return;
  if (!el) {
    el = document.createElement("div");
    el.className = "dica";
    el.setAttribute("role", "tooltip");
  }
  // Dentro de uma folha aberta (camada de cima do navegador), a dica mora na folha: fora dela ficaria por baixo.
  const casa = alvo.closest<HTMLElement>("dialog[open]") ?? document.body;
  if (el.parentElement !== casa) casa.appendChild(el);   // appendChild: o `append` do Element está tipado pelo HTMLRewriter do Worker
  el.replaceChildren(Object.assign(document.createElement("span"), { textContent: texto }));
  for (const tecla of (alvo.dataset.tecla ?? "").split(" ").filter(Boolean)) {
    el.appendChild(Object.assign(document.createElement("span"), { className: "kbd", textContent: tecla }));
  }
  el.toggleAttribute("data-seco", seco);
  el.removeAttribute("data-on");
  const r = alvo.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
  const acima = r.top - h - 8 > 4;
  const x = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8));
  const y = acima ? r.top - h - 7 : r.bottom + 7;
  el.style.translate = `${Math.round(x)}px ${Math.round(y)}px`;
  el.style.setProperty("--origem", `${Math.round(r.left + r.width / 2 - x)}px ${acima ? "bottom" : "top"}`);
  void el.offsetWidth;   // o navegador registra o estado fechado antes de abrir (senão a transição não roda)
  el.setAttribute("data-on", "");
  alvoAtual = alvo;
}

function esconder(seco = false) {
  window.clearTimeout(relogio);
  pendente = false;
  if (!alvoAtual || !el) return;
  alvoAtual = null;
  fechouEm = Date.now();
  el.toggleAttribute("data-seco", seco);
  el.removeAttribute("data-on");
}

export function instalarDicas() {
  if (typeof document === "undefined") return;
  const ponteiroFino = window.matchMedia("(hover: hover) and (pointer: fine)");
  document.addEventListener("mouseover", (e) => {
    const alvo = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-dica]") : null;
    if (!alvo) { if (alvoAtual || pendente) esconder(); return; }
    if (alvo === alvoAtual || !ponteiroFino.matches) return;
    window.clearTimeout(relogio);
    if (alvoAtual || Date.now() - fechouEm < QUENTE) mostrar(alvo, true);
    else { pendente = true; relogio = window.setTimeout(() => mostrar(alvo, false), ESPERA); }
  });
  document.addEventListener("focusin", (e) => {
    if (e.target instanceof HTMLElement && e.target.matches("[data-dica]:focus-visible")) mostrar(e.target, true);
  });
  document.addEventListener("focusout", () => esconder(true));
  window.addEventListener("mousedown", () => esconder(true), true);
  window.addEventListener("keydown", () => esconder(true), true);
  // Rolou: a dica à vista some (o botão saiu de baixo dela). A que ainda está esperando continua esperando: uma rolagem
  // qualquer da tela (a fila que se ajeita, por exemplo) não cancela a dica do botão em que o ponteiro está parado.
  window.addEventListener("scroll", () => { if (alvoAtual) esconder(true); }, true);
  // O botão sumiu da tela (a lista atualizou, a tela trocou): a dica dele some junto.
  new MutationObserver(() => { if (alvoAtual && !alvoAtual.isConnected) esconder(true); }).observe(document.body, { childList: true, subtree: true });
}
