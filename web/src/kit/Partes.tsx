// Detalhe sob demanda (DESIGN.md §9): uma parte aberta por vez, na URL, e as outras numa linha com o resumo. De 1280 px
// para cima, `Partes` vira mestre-detalhe (a lista parada à esquerda, a parte escolhida ao lado); abaixo, acordeão.
// O painel monta na primeira abertura e depois só se esconde, e os dois desenhos usam a mesma árvore: nada do que foi
// digitado, gravado ou lido se perde ao trocar de parte nem ao cruzar 1280 px. Aviso e erro nunca ficam escondidos: `tom`
// mostra o texto inteiro na linha fechada, a tela escolhe `padrao` para a parte com alerta abrir sozinha, e um
// `role="alert"` que surge num painel escondido abre a parte dele.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useSearchParams } from "react-router";

export const MESTRE = "(min-width: 1280px)";

export const useMidia = (q: string) => useSyncExternalStore(
  (avisar) => { const m = matchMedia(q); m.addEventListener("change", avisar); return () => m.removeEventListener("change", avisar); },
  () => matchMedia(q).matches, () => false);

const NENHUMA = "nenhuma";

/** A parte aberta, na URL (`?param=`). Sem o parâmetro vale `padrao`; `abrir(null)` grava que a pessoa fechou tudo. */
export function useParte(param: string, padrao: string | null) {
  const [params, setParams] = useSearchParams();
  const v = params.get(param);
  const abrir = useCallback((id: string | null) => {
    setParams((p) => { p.set(param, id ?? NENHUMA); return p; }, { replace: true, preventScrollReset: true });
  }, [param, setParams]);
  return [v === NENHUMA ? null : v ?? padrao, abrir] as const;
}

/** Monta na primeira abertura e, depois, só esconde. `aoAlerta`: uma ação que falhou depois de a pessoa sair dali. */
export function Painel({ aberta, manter, id, className, children, aoAlerta }: { aberta: boolean; manter: boolean; id: string; className: string; children: ReactNode; aoAlerta: () => void }) {
  const vista = useRef(false);
  vista.current ||= aberta;
  const raiz = useRef<HTMLDivElement>(null);
  const avisar = useRef(aoAlerta);
  avisar.current = aoAlerta;
  useEffect(() => {
    if (aberta || !raiz.current) return;
    const ehAlerta = (n: Node) => n instanceof Element && (n.matches('[role="alert"]') || !!n.querySelector('[role="alert"]'));
    const olho = new MutationObserver((mudancas) => { if (mudancas.some((m) => [...m.addedNodes].some(ehAlerta))) avisar.current(); });
    olho.observe(raiz.current, { childList: true, subtree: true });
    return () => olho.disconnect();
  }, [aberta]);
  if (!aberta && !manter) return null;
  return <div ref={raiz} id={id} hidden={!aberta} className={className}>{vista.current ? children : null}</div>;
}

export type Tom = "aviso" | "erro";
const COR_TOM: Record<Tom, string> = { aviso: "text-ambar", erro: "text-terracota" };

type PropsLinha = {
  id: string; rotulo: string; resumo: ReactNode; aberta: boolean; alternar: () => void;
  /** Com alerta, o resumo aparece inteiro e na cor do estado, sem o corte de uma linha. */
  tom?: Tom;
  /** Ação ao lado da linha, fora do botão que abre (Copiar, por exemplo). */
  acao?: ReactNode;
  nivel?: "h2" | "h3" | "h4" | "h5";
  /** A parte aberta não fecha com o clique: sempre há uma aberta (aba Marca). */
  fixa?: boolean;
};

/** A linha do acordeão: botão do tamanho da linha (≥ 44 px), estado em `aria-expanded`, resumo quando fechada. */
function LinhaParte({ id, rotulo, resumo, aberta, alternar, tom, acao, nivel = "h3", fixa = false }: PropsLinha) {
  const botao = useRef<HTMLButtonElement>(null);
  const clicou = useRef(false);
  // Fechar a parte de cima empurra esta para fora da tela: a linha clicada volta para perto do dedo.
  useEffect(() => {
    if (!clicou.current) return;
    clicou.current = false;
    botao.current?.scrollIntoView({ block: "nearest" });
  }, [aberta]);
  const H = nivel;
  return (
    <div className="flex items-center gap-2">
      <H className="m-0 min-w-0 flex-1 text-[17px]">
        <button ref={botao} type="button" id={`parte-${id}`} aria-expanded={aberta} aria-controls={aberta ? `painel-${id}` : undefined} onClick={() => { clicou.current = true; alternar(); }}
          className={`group flex min-h-14 w-full scroll-mt-20 scroll-mb-24 items-center gap-3 border-0 bg-transparent px-0 py-2.5 text-left font-[inherit] text-[17px] ${aberta && fixa ? "cursor-default" : "cursor-pointer"}`}>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-4">
            <span className={`flex-none font-bold text-texto-forte ${aberta ? "" : "group-hover:underline group-hover:decoration-fio-forte group-hover:underline-offset-4"}`}>{rotulo}</span>
            {!aberta && <span className={`mono min-w-0 text-[14px] font-normal sm:ml-auto ${tom ? `${COR_TOM[tom]} sm:text-right` : "truncate text-apoio"}`}>{resumo}</span>}
          </span>
          {/* Seta parada (sem girar): só a pista de que a linha abre; o estado está no aria-expanded. */}
          {!(aberta && fixa) && <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4 flex-none text-apoio"><path d={aberta ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} /></svg>}
        </button>
      </H>
      {acao}
    </div>
  );
}

const CLASSE_PARTE = "border-t border-fio first:border-t-0";
const CLASSE_PAINEL = "grid grid-cols-[minmax(0,1fr)] gap-5 pt-1 pb-7";

type PropsParte = PropsLinha & {
  children: ReactNode;
  /** `false`: desmonta ao fechar, para a tela que guarda o estado acima. */
  manter?: boolean;
};

/** Uma parte solta: a linha e o painel. */
export function Parte({ children, manter = true, ...linha }: PropsParte) {
  const { id, aberta, alternar } = linha;
  return (
    <section aria-labelledby={`parte-${id}`} className={CLASSE_PARTE}>
      <LinhaParte {...linha} />
      <Painel id={`painel-${id}`} aberta={aberta} manter={manter} className={CLASSE_PAINEL} aoAlerta={() => { if (!aberta) alternar(); }}>{children}</Painel>
    </section>
  );
}

/** `acao`: parte vazia vira uma linha com a sua ação; no mestre-detalhe, ela fica no fim do painel. */
export type ItemParte = { id: string; rotulo: string; resumo: ReactNode; tom?: Tom; acao?: ReactNode; conteudo: ReactNode };

/** Com alerta primeiro: erro, depois aviso, depois o resto, na ordem em que vieram. */
export const alertaPrimeiro = <T extends { tom?: Tom }>(itens: T[]) => {
  const peso = (i: T) => (i.tom === "erro" ? 0 : i.tom === "aviso" ? 1 : 2);
  return [...itens].sort((a, b) => peso(a) - peso(b));
};

/** A tela dividida em partes. `padrao`: a que abre sozinha (a que tem alerta, ou a próxima ação); `null`, todas fechadas. */
export function Partes({ itens, padrao, rotulo, param = "parte" }: { itens: ItemParte[]; padrao: string | null; rotulo: string; param?: string }) {
  // O padrão vale para a chegada: a parte não fecha na mão de quem está nela quando o alerta dali se resolve.
  const [inicial, setInicial] = useState(padrao);
  const [pedida, abrir] = useParte(param, inicial);
  const [params] = useSearchParams();
  const escolheu = params.has(param);
  const mestre = useMidia(MESTRE);
  // Alerta que chega depois (consulta que falhou por último, por exemplo) abre a parte, a menos que a pessoa já tenha escolhido.
  const comAlerta = itens.filter((i) => i.tom).map((i) => i.id).join(" ");
  const vistos = useRef(comAlerta);
  useEffect(() => {
    const antes = vistos.current.split(" ");
    vistos.current = comAlerta;
    const novo = comAlerta.split(" ").find((id) => id && !antes.includes(id));
    if (novo && !escolheu) setInicial(novo);
  }, [comAlerta, escolheu]);
  const existe = (id: string | null) => itens.some((i) => i.id === id);
  // Parte que sumiu da tela (ou endereço antigo) cai no padrão; no mestre-detalhe, sempre há uma escolhida.
  const aberta = existe(pedida) ? pedida : mestre ? (existe(padrao) ? padrao : itens[0]?.id ?? null) : pedida === null ? null : padrao;
  // Uma árvore só para os dois desenhos: cruzar 1280 px não desmonta o painel nem perde rascunho ou gravação.
  return (
    <div className={mestre ? "grid grid-cols-[260px_minmax(0,1fr)] items-start gap-x-10" : undefined}>
      {/* A lista fica parada: escolher uma parte troca só o painel. Seleção em papel-2 e negrito, sem azul. */}
      {mestre && (
        <ul aria-label={rotulo} className="sticky top-[calc(var(--topo)+32px)] m-0 grid list-none gap-1 p-0">
          {itens.map((i) => {
            const atual = i.id === aberta;
            return (
              <li key={i.id}>
                <button type="button" aria-current={atual ? "true" : undefined} aria-expanded={atual} aria-controls={`painel-${i.id}`} onClick={() => abrir(i.id)}
                  className={`grid min-h-11 w-full grid-cols-[minmax(0,1fr)] gap-0.5 rounded-btn border-0 px-3 py-2.5 text-left font-[inherit] ${atual ? "cursor-default bg-papel-2" : "cursor-pointer bg-transparent hover:bg-papel-2/60"}`}>
                  <span className={`text-[16px] text-texto-forte ${atual ? "font-bold" : ""}`}>{i.rotulo}</span>
                  <span className={`mono min-w-0 text-[13px] [overflow-wrap:anywhere] ${i.tom ? COR_TOM[i.tom] : "text-apoio"}`}>{i.resumo}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className={mestre ? "grid min-w-0 grid-cols-[minmax(0,1fr)]" : undefined}>
        {itens.map((i) => {
          const atual = aberta === i.id;
          return (
            <section key={i.id} hidden={mestre && !atual} aria-labelledby={mestre ? `titulo-${i.id}` : `parte-${i.id}`} className={mestre ? undefined : CLASSE_PARTE}>
              {!mestre && <LinhaParte id={i.id} rotulo={i.rotulo} resumo={i.resumo} tom={i.tom} acao={i.acao} nivel="h2" aberta={atual} alternar={() => abrir(atual ? null : i.id)} />}
              <Painel id={`painel-${i.id}`} aberta={atual} manter aoAlerta={() => abrir(i.id)} className={mestre ? "grid grid-cols-[minmax(0,1fr)] content-start gap-4" : CLASSE_PAINEL}>
                {mestre && <h2 id={`titulo-${i.id}`} className="m-0 text-[22px]">{i.rotulo}</h2>}
                {i.conteudo}
                {mestre && i.acao && <div className="justify-self-start">{i.acao}</div>}
              </Painel>
            </section>
          );
        })}
      </div>
    </div>
  );
}
