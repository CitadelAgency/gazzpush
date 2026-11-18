// A prova: o post como folha sobre a mesa (DESIGN.md §8). O cartão serve às quatro listas (Para aprovar, Prontos para
// postar, Postados e o trilho das Ideias): a arte em 4:5 com o número da fila e o formato, a legenda em mono, a
// manchete, a régua de espera e a ação. O cartão inteiro é o link (o nome acessível termina na ação, como as linhas
// antigas). A marca à mão fica na próxima ação: a volta de lápis e as marcas de corte sempre à mostra; as outras ações
// levam a seta. A arte da prova aberta viaja até o palco do post e de volta (kit/arteVT).
import { useEffect, useRef, type CSSProperties, type FocusEvent, type MouseEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { IconeCarrossel, IconeImagem, IconeIr, IconeReels } from "../casca/icones";
import { Partes } from "../comum";
import { t } from "../idioma";
import { NOME_ARTE, arteLembrada, lembrarArte, marcarArte } from "./arteVT";
import { VoltaLapis } from "./Lapis";

/**
 * Quem aponta para uma prova (ou foca nela) pede, sem pressa (90 ms de intenção), o que a tela do post vai precisar
 * (src/aquecer.ts): ao abrir, a revisão já está pronta. Sem a função, não faz nada.
 */
export function useAquecer(aquecer?: () => void) {
  const espera = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(espera.current), []);
  if (!aquecer) return {};
  const agendar = () => { clearTimeout(espera.current); espera.current = setTimeout(aquecer, 90); };
  const cancelar = () => clearTimeout(espera.current);
  return {
    onPointerEnter: agendar,
    onPointerLeave: cancelar,
    onFocus: (e: FocusEvent<HTMLElement>) => { if (e.currentTarget.matches(":focus-visible")) agendar(); },
    onBlur: cancelar,
  };
}

/**
 * "espera há 5 dias · pronto 31/10": no celular as duas metades ficam uma por linha, sem o ponto pendurado no fim da linha
 * (a frase inteira continua no texto da prova, que é o que os testes e o leitor de tela leem).
 */
function partirEspera(texto: string): ReactNode {
  const [primeira, ...resto] = texto.split(" · ");
  if (!resto.length) return texto;
  return <>{primeira}<span className="sep"> · </span><span>{resto.join(" · ")}</span></>;
}

/** Posição na escada de entrada: só as primeiras sobem uma a uma; o resto entra junto. */
export const escada = (i: number) => ({ "--i": Math.min(i, 8) }) as CSSProperties;

export function IconeFormato({ formato, className }: { formato: string; className?: string }) {
  const Icone = formato === "carrossel" ? IconeCarrossel : formato === "reels" ? IconeReels : IconeImagem;
  return <Icone className={className ?? "size-3.5"} />;
}

/**
 * Viagem da arte, na ida (kit/arteVT): no clique (ou Enter) que abre o post nesta aba, só esta arte leva o nome da
 * transição, e o post fica lembrado para a volta. Clique que abre outra aba (Ctrl, ⌘, Shift, Alt, botão do meio) não
 * marca nada: a tela não vai trocar.
 */
export function levarArte(e: MouseEvent, id: string, arte: HTMLElement | null) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  marcarArte(arte);
  lembrarArte(id);
}

/**
 * Viagem da arte, na volta: a arte do post aberto por último (só ela) já nasce com o nome da transição. O
 * `data-arte-vt` é o mesmo que o `marcarArte` põe: no clique seguinte, em outra prova, ele tira o nome desta (dois
 * elementos com o mesmo nome na tela e a transição inteira é abandonada).
 */
export const arteQueVolta = (id: string | undefined) =>
  (id && arteLembrada() === id ? { "data-arte-vt": "", style: { viewTransitionName: NOME_ARTE } as CSSProperties } : {});

/**
 * A arte da prova: a capa em 4:5 (ou o papel hachurado, enquanto não há capa). Decorativa; o carrossel leva uma folha
 * atrás. Com `id` (o post), ela recebe a viagem de volta do palco quando esse foi o último post aberto.
 */
export function ArteProva({ capa, formato, vaga, id }: { capa: string | null; formato: string; vaga?: ReactNode; id?: string }) {
  return (
    <span className="prova-arte corte" data-pilha={formato === "carrossel" ? "" : undefined} {...arteQueVolta(id)}>
      {capa ? (
        <img src={capa} alt="" width={540} height={675} loading="lazy" decoding="async" />
      ) : (
        <span aria-hidden="true" className="prova-vaga">{vaga}</span>
      )}
    </span>
  );
}

/** Régua de espera: a parte cheia é a espera desta prova em relação à mais antiga da fila (0 a 1). */
export function Regua({ fracao }: { fracao: number }) {
  return <span aria-hidden="true" className="regua"><i style={{ width: `${Math.round(Math.max(0.04, Math.min(1, fracao)) * 100)}%` }} /></span>;
}

/**
 * `id` é o post da prova: com ele, a arte viaja até o palco do post no clique e de volta (kit/arteVT); sem ele, a prova só
 * abre o link. A próxima ação leva a volta de lápis; as outras, a seta (que anda 3 px ao apontar, `.acao-seta`).
 * `atual` marca a prova escolhida numa lista que tem painel ao lado (`aria-current="true"`). `aoClicar` vem antes de
 * tudo no clique: se der `preventDefault` (a lista escolhe em vez de abrir), o link não navega e a arte não viaja.
 */
export function ProvaPost({ id, para, capa, formato, n, meta, manchete, espera, fracao, acao, proxima, onApontar, atual, aoClicar }: {
  id?: string; para: string; capa: string | null; formato: string; n: number;
  meta: (string | null | false)[]; manchete: string; espera: string; fracao: number | null; acao: string; proxima: boolean; onApontar?: () => void;
  atual?: boolean; aoClicar?: (e: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const apontar = useAquecer(onApontar);
  return (
    <li className="prova-li entra" style={escada(n - 1)}>
      <Link to={para} viewTransition data-proxima={proxima ? "" : undefined} aria-current={atual ? "true" : undefined} className="prova" {...apontar}
        onClick={(e) => {
          aoClicar?.(e);
          if (id) levarArte(e, id, e.currentTarget.querySelector<HTMLElement>(".prova-arte"));
        }}>
        <ArteProva capa={capa} formato={formato} id={id} />
        <span className="prova-corpo">
          <span className="mono prova-meta">
            <span aria-hidden="true" className="prova-n">{String(n).padStart(2, "0")}</span>
            <span><Partes partes={meta} /></span>
          </span>
          <span className="prova-manchete">{manchete}</span>
          {fracao !== null && <Regua fracao={fracao} />}
          <span className="mono prova-espera text-apoio">{partirEspera(espera)}</span>
          <span className={`acao ${proxima ? "acao-lapis -ml-[6px] w-fit" : "acao-seta"}`}>
            <span>{acao}</span>{proxima ? <VoltaLapis desenhar /> : <IconeIr className="size-[15px]" />}
          </span>
        </span>
      </Link>
    </li>
  );
}

/**
 * A linha sob o título de uma mesa: o número que importa em grafite e o resto em apoio ("4 esperam você · o mais antigo
 * espera há 3 dias"). Cada parte fica inteira na linha, e o ponto fica com a parte de antes.
 */
export function LinhaMesa({ forte, partes }: { forte: string; partes: (string | null | false | undefined)[] }) {
  const resto = partes.filter(Boolean);
  return (
    <p className="m-0 mt-1.5 text-[15px] text-apoio">
      <span className="whitespace-nowrap"><b className="font-semibold text-texto-forte">{forte}</b>{resto.length > 0 && <span className="sep"> ·</span>}</span>
      {resto.length > 0 && <>{" "}<Partes partes={resto} /></>}
    </p>
  );
}

/** Quatro provas em branco enquanto a lista carrega: a mesma grade, para a tela não pular. */
export function MesaEsqueleto({ n = 4 }: { n?: number }) {
  return (
    <ul className="mesa m-0 list-none p-0" aria-busy="true">
      {Array.from({ length: n }, (_, i) => (
        <li key={i} className="prova-esq grid gap-3.5">
          <span className="prova-arte esqueleto" style={{ animationDelay: `${i * 120}ms` }} />
          <span className="grid gap-2"><span className="esqueleto h-3 w-24" /><span className="esqueleto h-5 w-[88%]" /><span className="esqueleto h-5 w-[60%]" /></span>
        </li>
      ))}
    </ul>
  );
}

/** Lista vazia: uma prova em branco, tracejada, com as marcas de corte, ao lado do texto. */
export function MesaVazia({ children, rotulo }: { children: ReactNode; rotulo?: string }) {
  return (
    <section className="mt-8 grid items-center gap-8 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-12">
      <div className="folha-vazia corte" aria-hidden="true">
        <span className="mono text-[11px] tracking-[.08em] uppercase">{rotulo ?? t("mesa vazia", "empty desk")}</span>
      </div>
      <div className="grid justify-items-start gap-3">{children}</div>
    </section>
  );
}
