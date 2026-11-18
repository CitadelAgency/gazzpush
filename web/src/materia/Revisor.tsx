// O revisor de lápis azul no editor (DESIGN.md §10): a nota de cada parágrafo, o ciclo dela na tela, a margem do computador, a
// oferta da fala e o interruptor. As regras moram em src/lib/revisor.ts; aqui só o que depende de navegador.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueries } from "@tanstack/react-query";
import type { Editor } from "@tiptap/react";
import { reconciliarNotas, type FalaAchada, type Nota, type NotaViva, type TrechoFala } from "../../../src/lib/revisor";
import { ler } from "../api";
import { t } from "../idioma";
import { SublinhadoLapis } from "../kit/Lapis";
import { mmss } from "./Gravacoes";
import { rota, type EstadoMesa } from "./comum";

const CHAVE_INTERRUPTOR = "redacao:revisor";
// Risco (300 ms), a pausa para ler e a saída curta: o mesmo tempo de .nota-sai em tokens.css.
const RISCA_MS = 920;
const NASCE_MS = 750;

export const semMovimento = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Ligado por padrão e guardado neste navegador: é a saída para quem quer escrever sem nada se mexendo. */
export function useInterruptorNotas() {
  const [ligado, setLigado] = useState(() => {
    try { return localStorage.getItem(CHAVE_INTERRUPTOR) !== "desligado"; } catch { return true; }
  });
  const mudar = (v: boolean) => {
    setLigado(v);
    try { localStorage.setItem(CHAVE_INTERRUPTOR, v ? "ligado" : "desligado"); } catch { /* sem armazenamento, vale até fechar a tela */ }
  };
  return [ligado, mudar] as const;
}

export const chaveNota = (n: NotaViva) => `${n.blocoId}:${n.chave}:${n.fase === "risca" ? "riscada" : "viva"}`;

/** As notas na tela: a cada mudança do que as marcas pedem, `reconciliarNotas` diz o que fica, se risca ou nasce. */
export function useNotas({ ativo, alvo, existem, espera, cursor }: { ativo: boolean; alvo: Nota[]; existem: Set<string>; espera: Set<string>; cursor: string | null }) {
  const [vivas, setVivas] = useState<NotaViva[]>([]);
  const [anuncio, setAnuncio] = useState("");
  const atual = useRef<NotaViva[]>([]);
  const abrindo = useRef(true);
  const relogios = useRef(new Map<string, number>());
  const lista = (s: Set<string>) => [...s].join(" ");
  const trocar = (r: NotaViva[]) => { atual.current = r; setVivas(r); };

  useLayoutEffect(() => {
    if (!ativo) {
      abrindo.current = true;
      if (atual.current.length) trocar([]);
      return;
    }
    const sessao = !abrindo.current;
    abrindo.current = false;
    const antes = atual.current;
    const r = reconciliarNotas(antes, alvo, { existem, espera, cursor, sessao, animar: sessao && !semMovimento() });
    if (JSON.stringify(r) === JSON.stringify(antes)) return;
    trocar(r);
    if (!sessao) return;
    const tinha = new Set(antes.map(chaveNota));
    const novas = r.filter((n) => n.fase !== "risca" && !tinha.has(chaveNota(n)));
    if (novas.length) setAnuncio(novas.map((n) => t(`Nova nota: ${n.pt}`, `New note: ${n.en}`)).join(" "));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ativo, alvo.map((n) => `${n.blocoId}|${n.chave}|${n.marcaId}`).join(), lista(existem), lista(espera), cursor]);

  useEffect(() => {
    for (const n of vivas) {
      const k = chaveNota(n);
      if (n.fase === "pronta" || relogios.current.has(k)) continue;
      relogios.current.set(k, window.setTimeout(() => {
        relogios.current.delete(k);
        trocar(n.fase === "risca" ? atual.current.filter((x) => chaveNota(x) !== k) : atual.current.map((x) => (chaveNota(x) === k ? { ...x, fase: "pronta" as const } : x)));
      }, n.fase === "risca" ? RISCA_MS : NASCE_MS));
    }
  }, [vivas]);
  useEffect(() => () => {
    for (const r of relogios.current.values()) window.clearTimeout(r);
    relogios.current.clear();
  }, []);

  return { vivas, anuncio };
}

const semente = (s: string) => ([...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 997) + 1;

/** A pergunta, com o sublinhado de lápis e, ao sair, o risco por cima. */
export function NotaTexto({ nota }: { nota: NotaViva }) {
  const seed = semente(nota.blocoId + nota.chave);
  return (
    <span data-nota={nota.chave} className={`nota-revisor nota-${nota.fase}`}>
      <span className="nota-revisor-texto">
        {t(nota.pt, nota.en)}
        <SublinhadoLapis seed={seed} larg={1.6} desenhar={nota.fase === "nasce"} />
        {nota.fase === "risca" && <SublinhadoLapis className="lapis-risco" seed={seed + 1} larg={1.8} desenhar />}
      </span>
    </span>
  );
}

/** A nota riscada no lugar: fica o tempo de ler e fecha o espaço dela ao sair. */
export const NotaSaindo = ({ nota }: { nota: NotaViva }) => <span className="nota-sai"><span className="nota-sai-miolo"><NotaTexto nota={nota} /></span></span>;

/** Abaixo do parágrafo (celular e modo foco). Mora num widget do editor, então não entra no documento. */
export function NotasDoBloco({ notas, abrir }: { notas: NotaViva[]; abrir: (n: NotaViva) => void }) {
  return notas.map((n) => (n.fase === "risca"
    ? <NotaSaindo key={chaveNota(n)} nota={n} />
    : <button key={chaveNota(n)} type="button" className="nota-botao" onMouseDown={(e) => e.preventDefault()} onClick={() => abrir(n)}><NotaTexto nota={n} /></button>));
}

/**
 * A coluna como margem: cada cartão na altura do seu parágrafo, e o que colidiria desce até caber. A coluna rola com a página,
 * sem rolagem própria. As posições vão direto no elemento: medir e mover aqui não renderiza de novo, e a digitação não sente.
 */
export function ListaMargem({ ed, chaves, children }: { ed: Editor; chaves: string; children: ReactNode }) {
  const lista = useRef<HTMLUListElement>(null);
  const alinhar = useRef(() => {});
  alinhar.current = () => {
    const ul = lista.current;
    if (!ul || ul.offsetParent === null) return;   // parte escondida: mede ao abrir
    const base = ul.getBoundingClientRect().top;
    let fim = 0;
    for (const li of [...ul.children] as HTMLElement[]) {
      const bloco = li.dataset.bloco ? ed.view.dom.querySelector(`[data-id="${CSS.escape(li.dataset.bloco)}"]`) : null;
      const y = Math.round(Math.max(bloco ? bloco.getBoundingClientRect().top - base : fim, fim));
      li.style.top = `${y}px`;
      fim = y + li.offsetHeight + 8;
    }
    ul.style.minHeight = `${fim}px`;
  };
  useLayoutEffect(() => alinhar.current());
  useEffect(() => {
    const olho = new ResizeObserver(() => alinhar.current());
    olho.observe(ed.view.dom);
    for (const li of lista.current?.children ?? []) olho.observe(li);
    void document.fonts?.ready.then(() => alinhar.current());
    return () => olho.disconnect();
  }, [ed, chaves]);
  return <ul ref={lista} className="relative m-0 list-none p-0">{children}</ul>;
}

/** As transcrições prontas do texto: só se houver gravação pronta, e uma vez por texto (mesma consulta da parte Aspas). */
export function useFalas(tenantId: string, textoId: string, gravacoes: EstadoMesa["gravacoes"], ativo: boolean): TrechoFala[] {
  const prontas = gravacoes.filter((g) => g.estado === "pronto");
  const consultas = useQueries({
    queries: prontas.map((g) => ({
      queryKey: [tenantId, "transcricao", g.id],
      enabled: ativo, staleTime: Infinity,
      queryFn: () => ler(rota.gravacoes[":arquivo"].transcricao.$get({ param: { tenantId, id: textoId, arquivo: g.id } })),
    })),
  });
  const versao = consultas.map((c) => c.dataUpdatedAt).join();
  return useMemo(
    () => consultas.flatMap((c, i) => (c.data?.trechos ?? []).map((tr) => ({ gravacao: prontas[i].id, nome: prontas[i].nome, inicio: tr.inicio, texto: tr.texto }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [versao],
  );
}

/** A oferta da fala, no padrão do menu do `@`: Tab ou clique insere, Esc dispensa (teclas em TextoMateria). */
export function OfertaFala({ achada, inserir, topo, esquerda, acima, id }: { achada: FalaAchada; inserir: () => void; topo: number; esquerda: number; acima: boolean; id: string }) {
  const { trecho } = achada;
  return (
    <div className="absolute z-20 w-[min(360px,90vw)] rounded-card bg-branco p-1.5 shadow-curta" style={{ top: topo, left: esquerda, transform: acima ? "translateY(-100%)" : undefined }}>
      <p className="mono m-0 px-2 pt-1 pb-1.5 text-[12px] text-apoio">{t("fala da gravação · Tab insere · Esc dispensa", "from the recording · Tab inserts · Esc dismisses")}</p>
      <ul id={id} role="listbox" aria-label={t("Fala da gravação", "Speech from the recording")} className="m-0 grid list-none gap-0.5 p-0">
        <li id={`${id}-fala`} role="option" aria-selected="true" onMouseDown={(e) => { e.preventDefault(); inserir(); }} className="grid min-h-11 cursor-pointer content-center gap-0.5 rounded-btn bg-papel-2 px-2 py-1.5 text-[15px] text-texto-forte">
          <span className="mono truncate text-[12px] text-apoio">{mmss(trecho.inicio)} · {trecho.nome}</span>
          <span className="line-clamp-3">{trecho.texto.trim()}</span>
        </li>
      </ul>
    </div>
  );
}
