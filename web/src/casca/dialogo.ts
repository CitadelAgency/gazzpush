// Um <dialog> modal cujo "aberto" mora no estado do React (a paleta, a folha de atalhos). O Esc fecha o diálogo na hora,
// mas o `close` só chega uns 20 ms depois e o `cancel` nem sempre é disparado. Nesse intervalo o estado ainda diz
// "aberto", e a tecla que reabre (⌘K, ?) se perde. Por isso o Esc muda o estado na própria tecla, e o `close` atrasado
// só vale se o diálogo continua fechado: se a pessoa já reabriu, ele é do fechamento anterior e fecharia de novo.
import type { KeyboardEvent, RefObject } from "react";

export const fechaJunto = (dlg: RefObject<HTMLDialogElement | null>, fechar: () => void) => ({
  onClose: () => { if (!dlg.current?.open) fechar(); },
  onCancel: () => fechar(),
  onKeyDown: (e: KeyboardEvent) => { if (e.key === "Escape") fechar(); },
});
