// Peças pequenas que várias telas usam: título da aba, falha de carga, abertura.
import { useEffect } from "react";
import { t } from "./idioma";
import MarcaGazzpush from "./kit/MarcaGazzpush";
import { PRODUTO } from "./marca";

export function useTitulo(...partes: (string | undefined)[]) {
  const titulo = [...partes.filter(Boolean), PRODUTO].join(" · ");
  useEffect(() => { document.title = titulo; }, [titulo]);
}

/** Metadado "a · b · c" em que cada parte fica inteira na mesma linha ("há 6 h" não quebra no "h") e o ponto fica com
 *  a parte de antes: a linha nunca começa por "·". */
export function Partes({ partes }: { partes: (string | null | undefined | false)[] }) {
  const lista = partes.filter(Boolean);
  return <>{lista.map((x, i) => <span key={i}><span className="whitespace-nowrap">{x}{i < lista.length - 1 && <span className="sep"> ·</span>}</span>{i < lista.length - 1 && " "}</span>)}</>;
}

/** Falha de carga nunca vira fato (DESIGN.md §6.8): diz o que não carregou e oferece tentar de novo. */
export function FalhaCarga({ oque, tentar }: { oque: string; tentar: () => void }) {
  return (
    <div role="alert" className="faixa-erro flex flex-wrap items-baseline gap-x-2">
      <span>{t(`Não carregou ${oque}.`, `Couldn't load ${oque}.`)}</span>
      <button type="button" onClick={tentar} className="cursor-pointer font-bold underline underline-offset-3">{t("Tentar de novo", "Try again")}</button>
    </div>
  );
}

/** Enquanto a sessão não chega: o papel e o nome do produto, sem pular layout. */
export function Abertura() {
  return (
    <div className="grid min-h-dvh place-items-center" aria-busy="true">
      <p><MarcaGazzpush /><span className="sr-only">{t(": carregando", ": loading")}</span></p>
    </div>
  );
}

/** O foco está num lugar onde a pessoa digita (campo, área de texto, seleção, editor)? Atalho de uma tecla só vale fora dele. */
export function digitando(alvo: EventTarget | null): boolean {
  return alvo instanceof HTMLElement && (alvo.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName));
}

/**
 * Atalho de uma tecla só (A, E, X, J, K, ← →, DESIGN.md §6.12). Vale quando ninguém tratou o evento, sem Ctrl/⌘/Alt, fora
 * de campo de texto, sem diálogo ou menu aberto e com o foco no conteúdo da tela (ou solto no corpo da página): nunca com
 * o foco na lateral, num menu ou numa folha. É o que a WCAG 2.1.4 pede: o atalho só age onde a pessoa está.
 * `repetir`: a tecla segurada continua valendo (as setas dos cards); as outras valem uma vez por toque.
 */
export function atalhoLivre(e: KeyboardEvent, repetir = false): boolean {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || (e.repeat && !repetir) || digitando(e.target)) return false;
  if (document.querySelector("dialog[open], [role='menu']")) return false;
  const alvo = e.target;
  return alvo === document.body || (alvo instanceof Element && !!alvo.closest("#conteudo"));
}
