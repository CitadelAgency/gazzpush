// Keyboard shortcuts sheet (DESIGN.md §12): opens with ? or from the account menu. Lists what exists today, per screen.
// A single-key shortcut only works with focus on the content and outside a text field; the key opens the step, the button decides.
import { useEffect, useRef, type ReactNode } from "react";
import { t } from "../language";
import { closesTogether } from "./dialog";
import { IconClose } from "./icons";
import { shortcutPalette } from "./Palette";

const Key = ({ children }: { children: ReactNode }) => <span className="kbd">{children}</span>;

function Group({ titulo: title, linhas: lines }: { titulo: string; linhas: [string, string[]][] }) {
  return (
    <section>
      <h3 className="lat-rotulo m-0 mb-1.5 font-normal">{title}</h3>
      <ul className="m-0 grid list-none p-0">
        {lines.map(([what, keys]) => (
          <li key={what} className="flex min-h-[30px] items-center justify-between gap-3 text-[14px]">
            <span>{what}</span>
            <span className="flex flex-none gap-1">{keys.map((k) => <Key key={k}>{k}</Key>)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function SheetShortcuts({ aberta: isOpen, fechar: dismiss, autoral: author }: { aberta: boolean; fechar: () => void; autoral: boolean }) {
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dlg.current;
    if (!d) return;
    if (isOpen && !d.open) d.showModal();
    if (!isOpen && d.open) d.close();
  }, [isOpen]);
  return (
    <dialog ref={dlg} aria-labelledby="atalhos-titulo" {...closesTogether(dlg, dismiss)} onClick={(e) => { if (e.target === dlg.current) dismiss(); }} className="folha">
      <div className="flex items-center justify-between gap-3 px-6 pt-5 pb-1">
        <h2 id="atalhos-titulo" className="m-0 text-[22px] tracking-[-.02em]">{t("Atalhos do teclado", "Keyboard shortcuts")}</h2>
        <button type="button" onClick={dismiss} aria-label={t("Fechar", "Close")} data-dica={t("Fechar", "Close")} data-tecla="Esc"
          className="grid size-11 cursor-pointer place-items-center rounded-btn text-apoio hover:bg-papel-2 hover:text-texto-forte">
          <IconClose className="size-5" />
        </button>
      </div>
      <div className="grid gap-x-7 gap-y-5 px-6 pt-3 pb-6 sm:grid-cols-2">
        <Group titulo={t("Em qualquer tela", "Anywhere")} linhas={[
          [t("Ir para…", "Go to…"), shortcutPalette().split(" ")],
          [t("Nova ideia", "New idea"), ["N"]],
          [t("Estes atalhos", "These shortcuts"), ["?"]],
        ]} />
        <Group titulo={t("Ideias", "Ideas")} linhas={[
          [t("Ideia seguinte, anterior", "Next, previous idea"), ["J", "K"]],
          [t("Ir para o Produzir", "Go to Produce"), ["P"]],
          [t("Post ou carrossel", "Post or carousel"), ["1", "2"]],
          [t("Abrir o Descartar", "Open Discard"), ["X"]],
        ]} />
        <Group titulo={t("Revisão de um post", "Reviewing a post")} linhas={[
          [t("Abrir o Aprovar", "Open Approve"), ["A"]],
          [t("Reescrever, rejeitar", "Rewrite, reject"), ["E", "X"]],
          [t("Card anterior, seguinte", "Previous, next card"), ["←", "→"]],
          [t("Post seguinte, anterior", "Next, previous post"), ["J", "K"]],
        ]} />
        {author && (
          <Group titulo={t("No texto", "In a text")} linhas={[
            [t("Comandos do editor", "Editor commands"), shortcutPalette().split(" ")],
            [t("Próxima marca, anterior", "Next, previous mark"), ["F8", "⇧ F8"]],
            [t("Citar o dossiê", "Cite the dossier"), ["@"]],
          ]} />
        )}
        <p className="ajuda m-0 self-start">
          {t("Atalho de uma tecla só vale com o foco no conteúdo, fora de campo de texto. A letra abre o passo; quem decide é o botão.",
            "Single-key shortcuts only work with focus on the content, outside text fields. The letter opens the step; the button decides.")}
        </p>
      </div>
    </dialog>
  );
}
