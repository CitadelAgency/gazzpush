// Folha de atalhos do teclado (DESIGN.md §12): abre com ? ou pelo menu da conta. Lista o que existe hoje, por tela.
// Atalho de uma tecla só vale com o foco no conteúdo e fora de campo de texto; a letra abre o passo, quem decide é o botão.
import { useEffect, useRef, type ReactNode } from "react";
import { t } from "../idioma";
import { fechaJunto } from "./dialogo";
import { IconeFechar } from "./icones";
import { atalhoPaleta } from "./Paleta";

const Tecla = ({ children }: { children: ReactNode }) => <span className="kbd">{children}</span>;

function Grupo({ titulo, linhas }: { titulo: string; linhas: [string, string[]][] }) {
  return (
    <section>
      <h3 className="lat-rotulo m-0 mb-1.5 font-normal">{titulo}</h3>
      <ul className="m-0 grid list-none p-0">
        {linhas.map(([oque, teclas]) => (
          <li key={oque} className="flex min-h-[30px] items-center justify-between gap-3 text-[14px]">
            <span>{oque}</span>
            <span className="flex flex-none gap-1">{teclas.map((k) => <Tecla key={k}>{k}</Tecla>)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function FolhaAtalhos({ aberta, fechar, autoral }: { aberta: boolean; fechar: () => void; autoral: boolean }) {
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dlg.current;
    if (!d) return;
    if (aberta && !d.open) d.showModal();
    if (!aberta && d.open) d.close();
  }, [aberta]);
  return (
    <dialog ref={dlg} aria-labelledby="atalhos-titulo" {...fechaJunto(dlg, fechar)} onClick={(e) => { if (e.target === dlg.current) fechar(); }} className="folha">
      <div className="flex items-center justify-between gap-3 px-6 pt-5 pb-1">
        <h2 id="atalhos-titulo" className="m-0 text-[22px] tracking-[-.02em]">{t("Atalhos do teclado", "Keyboard shortcuts")}</h2>
        <button type="button" onClick={fechar} aria-label={t("Fechar", "Close")} data-dica={t("Fechar", "Close")} data-tecla="Esc"
          className="grid size-11 cursor-pointer place-items-center rounded-btn text-apoio hover:bg-papel-2 hover:text-texto-forte">
          <IconeFechar className="size-5" />
        </button>
      </div>
      <div className="grid gap-x-7 gap-y-5 px-6 pt-3 pb-6 sm:grid-cols-2">
        <Grupo titulo={t("Em qualquer tela", "Anywhere")} linhas={[
          [t("Ir para…", "Go to…"), atalhoPaleta().split(" ")],
          [t("Nova ideia", "New idea"), ["N"]],
          [t("Estes atalhos", "These shortcuts"), ["?"]],
        ]} />
        <Grupo titulo={t("Ideias", "Ideas")} linhas={[
          [t("Ideia seguinte, anterior", "Next, previous idea"), ["J", "K"]],
          [t("Ir para o Produzir", "Go to Produce"), ["P"]],
          [t("Post ou carrossel", "Post or carousel"), ["1", "2"]],
          [t("Abrir o Descartar", "Open Discard"), ["X"]],
        ]} />
        <Grupo titulo={t("Revisão de um post", "Reviewing a post")} linhas={[
          [t("Abrir o Aprovar", "Open Approve"), ["A"]],
          [t("Reescrever, rejeitar", "Rewrite, reject"), ["E", "X"]],
          [t("Card anterior, seguinte", "Previous, next card"), ["←", "→"]],
          [t("Post seguinte, anterior", "Next, previous post"), ["J", "K"]],
        ]} />
        {autoral && (
          <Grupo titulo={t("No texto", "In a text")} linhas={[
            [t("Comandos do editor", "Editor commands"), atalhoPaleta().split(" ")],
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
