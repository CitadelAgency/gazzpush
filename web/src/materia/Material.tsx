// Material ao lado (DESIGN.md §13): o organizador de fontes do editor. Junta num lugar só os recortes do texto, as fontes do
// dossiê (links, respostas, LAI), os PDFs, as gravações e o acervo do veículo, com uma busca única e um leitor ao lado. No
// computador é uma coluna à esquerda da folha; no celular, a folha de baixo. Guardar e inserir valem para o trecho selecionado
// ou para o parágrafo inteiro, e os botões não pegam o foco: a seleção da fonte e o cursor do texto ficam onde estavam.
// Nada de modelo: o recorte é literal (o servidor confere) e inserir põe o trecho como está, com a nota de citação quando a
// fonte é citável. O componente é memoizado, recebe só propriedades estáveis e não lê o documento vivo: digitar no editor não
// o desenha de novo ("no texto" sai do texto salvo).
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { JSONContent } from "@tiptap/react";
import { NOTA_MAX, TRECHO_MAX, TRECHO_MIN, TRECHO_MIN_DOCUMENTO, dobrar, juntarEspacos, noTexto, termosDaBusca, trechoNaFonte } from "../../../src/lib/recorte";
import { api, corpoJson, ler, type Sucesso } from "../api";
import { IconeFechar, IconeVoltar } from "../casca/icones";
import { quando } from "../fila";
import { t } from "../idioma";
import { Parte, useParte } from "../kit/Partes";
import { FormLink, rotuloNota } from "./Assistente";
import { BotaoPdf, useEnviarPdf } from "./Documentos";
import { BotaoAudio, TocarTrecho, mmss, useEnviarAudio } from "./Gravacoes";
import { mensagem, nomeEvidencia, qtd, rota, type EstadoMesa, type Evidencia } from "./comum";

type Recorte = Sucesso<Awaited<ReturnType<typeof rota.recortes.$get>>>["recortes"][number];
type Busca = Sucesso<Awaited<ReturnType<typeof rota.material.busca.$get>>>;
type Achado = Busca["grupos"][number]["achados"][number];
type TipoFonte = "evidencia" | "documento" | "gravacao";
/** Onde o leitor abre: o parágrafo (evidência), a página (PDF), o segundo (gravação) ou o trecho de um recorte. */
type Alvo = { paragrafo?: number; pagina?: number; inicio?: number; trecho?: string };
/** O que pode ir para o documento: o trecho de uma fonte (com a nota quando é citável) ou a anotação da pessoa. */
type Trecho = { origem: Recorte["origem"]; evidenciaId?: string | null; arquivoId?: string | null; pagina?: number | null; trecho: string };

/** Pontes com o editor, estáveis entre as renderizações de TextoMateria (que renderiza a cada tecla). */
export type AcoesMaterial = {
  /** Põe o conteúdo onde o cursor estava (no celular, fecha a folha antes). */
  inserir: (conteudo: JSONContent[]) => void;
  atualizar: (d: EstadoMesa) => void;
  /** Fonte nova no dossiê: guarda o estado e confere de novo os parágrafos que ela pode resolver. */
  aoFonte: (d: EstadoMesa) => void;
  fechar: () => void;
};

type Props = { tenantId: string; textoId: string; estado: EstadoMesa; podeEditar: boolean; folha: boolean; acoes: AcoesMaterial };
type Ctx = Omit<Props, "folha"> & {
  abrirFonte: (tipo: TipoFonte, id: string, alvo?: Alvo | null) => void;
  /** Insere ou só cita. Falha (rede, PDF que não virou evidência) sobe para quem chamou mostrar. */
  inserirTrecho: (x: Trecho, soCitar?: boolean) => Promise<void>;
  guardar: (x: Trecho) => Promise<{ existia: boolean }>;
};

export const chaveRecortes = (tenantId: string, textoId: string) => [tenantId, "recortes", textoId] as const;
const palavrasDaFala = (s: string) => (s.match(/[\p{L}\p{N}]+/gu) ?? []).length;
/** A conferência só liga à gravação a aspa de 3 palavras ou mais (`acharNaGravacao`): a mais curta viraria "aspa sem fonte". */
const FALA_MIN = 3;

function useEspera<T>(valor: T, ms = 300) {
  const [v, setV] = useState(valor);
  useEffect(() => { const id = window.setTimeout(() => setV(valor), ms); return () => window.clearTimeout(id); }, [valor, ms]);
  return v;
}

const lerFonte = (s: string | null): { tipo: TipoFonte; id: string } | null => {
  const m = s?.match(/^(evidencia|documento|gravacao):(.+)$/);
  return m ? { tipo: m[1] as TipoFonte, id: m[2] } : null;
};

function Material({ tenantId, textoId, estado, podeEditar, folha, acoes }: Props) {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const fonte = lerFonte(params.get("fonte"));
  const [alvo, setAlvo] = useState<Alvo | null>(null);
  const [busca, setBusca] = useState("");
  const q = useEspera(juntarEspacos(busca));
  const procurando = termosDaBusca(q).length > 0;
  const raiz = useRef<HTMLElement>(null);
  const focarLeitor = useRef(false);
  const recortes = useQuery({ queryKey: chaveRecortes(tenantId, textoId), queryFn: () => ler(rota.recortes.$get({ param: { tenantId, id: textoId } })) });
  const mudar = (f: (p: URLSearchParams) => void) => setParams((p) => { f(p); return p; }, { replace: true, preventScrollReset: true });
  // Abre em Recortes se houver, senão em Fontes: decidido na chegada, para a parte não trocar na mão de quem está nela.
  const padrao = useRef<string | null>(null);
  if (padrao.current === null && !recortes.isPending) padrao.current = recortes.data?.recortes.length ? "recortes" : "fontes";
  const [parte, abrirParte] = useParte("material-parte", padrao.current);

  const ctx: Ctx = {
    tenantId, textoId, estado, podeEditar, acoes,
    abrirFonte: (tipo, id, a = null) => {
      focarLeitor.current = true;
      setAlvo(a);
      mudar((p) => p.set("fonte", `${tipo}:${id}`));
    },
    async inserirTrecho(x, soCitar = false) {
      if (x.origem === "nota") { acoes.inserir([{ type: "text", text: x.trecho }]); return; }
      if (x.origem === "gravacao") {
        if (palavrasDaFala(x.trecho) < FALA_MIN) throw new Error(t("Fala curta demais: selecione pelo menos 3 palavras, ou a conferência não acha a aspa na gravação.", "Speech too short: select at least 3 words, or the check can't find the quote in the recording."));
        acoes.inserir([{ type: "text", text: `“${x.trecho}” ` }]);
        return;
      }
      let ev: Evidencia | undefined;
      if (x.origem === "evidencia") ev = estado.evidencias.find((e) => e.id === x.evidenciaId);
      else if (x.arquivoId && estado.documentos.some((d) => d.id === x.arquivoId)) {
        // O trecho do PDF vira evidência pela rota de sempre (a página inteira), e daí em diante é como um link.
        const r = await ler(rota.documentos[":arquivo"].evidencia.$post({ param: { tenantId, id: textoId, arquivo: x.arquivoId } }, corpoJson({ pagina: x.pagina, trecho: x.trecho })));
        const { evidenciaId, existia: _existia, ...novo } = r;
        acoes.atualizar(novo as EstadoMesa);
        ev = novo.evidencias.find((e) => e.id === evidenciaId);
      }
      // Sem a fonte no dossiê (saiu dele), o texto entra sem citação: a conferência vai dizer que a aspa está sem fonte.
      const nota: JSONContent[] = ev ? [{ type: "nota", attrs: { rotulo: rotuloNota(ev), evidencia: ev.id } }, { type: "text", text: " " }] : [];
      if (soCitar) { if (nota.length) acoes.inserir(nota); return; }
      acoes.inserir([{ type: "text", text: `“${x.trecho}” ` }, ...nota]);
    },
    async guardar(x) {
      const corpo = x.origem === "evidencia" ? { origem: x.origem, evidenciaId: x.evidenciaId, trecho: x.trecho }
        : x.origem === "documento" ? { origem: x.origem, arquivoId: x.arquivoId, pagina: x.pagina, trecho: x.trecho }
          : x.origem === "gravacao" ? { origem: x.origem, arquivoId: x.arquivoId, trecho: x.trecho } : { origem: "nota", trecho: x.trecho };
      const r = await ler(rota.recortes.$post({ param: { tenantId, id: textoId } }, corpoJson(corpo)));
      qc.setQueryData(chaveRecortes(tenantId, textoId), { recortes: r.recortes });
      return { existia: r.existia };
    },
  };

  const voltar = () => {
    setAlvo(null);
    mudar((p) => p.delete("fonte"));
    window.setTimeout(() => raiz.current?.focus({ preventScroll: true }), 0);
  };
  /** Achado num recorte: abre a parte Recortes e leva ao cartão. */
  function irParaRecorte(id: string) {
    setBusca("");
    abrirParte("recortes");
    window.setTimeout(() => {
      const el = document.getElementById(`recorte-${id}`);
      if (el) centrarNoMaterial(el);
      el?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
    }, 60);
  }

  const lista = recortes.data?.recortes ?? [];
  const links = estado.evidencias.filter((e) => e.origem !== "documento");
  const mudaram = links.filter((e) => e.mudouEm).length;
  const noAcervo = lista.filter((r) => r.acervo).length;
  const lendoPdf = estado.documentos.filter((d) => d.estado === "lendo").length;
  const transcrevendo = estado.gravacoes.filter((g) => g.estado === "lendo").length;
  const parteDe = (id: string, rotulo: string, resumo: string, conteudo: ReactNode, tom?: "aviso") => (
    <Parte id={`material-${id}`} nivel="h3" rotulo={rotulo} resumo={resumo} tom={tom} aberta={parte === id} alternar={() => abrirParte(parte === id ? null : id)}>{conteudo}</Parte>
  );

  let corpo: ReactNode;
  if (fonte) corpo = <Leitor key={`${fonte.tipo}:${fonte.id}`} m={ctx} tipo={fonte.tipo} id={fonte.id} alvo={alvo} voltar={voltar} focar={focarLeitor} />;
  else if (procurando) corpo = <Resultados m={ctx} q={q} irParaRecorte={irParaRecorte} />;
  else if (recortes.isPending) corpo = <p role="status" className="mono m-0 text-apoio">{t("carregando…", "loading…")}</p>;
  else {
    corpo = (
      <div>
        {recortes.isError && <p role="alert" className="faixa-erro m-0 mb-2">{t("Os recortes não carregaram.", "The clippings didn't load.")} <button type="button" className="link-acao border-0 bg-transparent p-0" onClick={() => recortes.refetch()}>{t("Tentar de novo", "Try again")}</button></p>}
        {parteDe("recortes", t("Recortes", "Clippings"),
          lista.length ? `${t(qtd(lista.length, "recorte", "recortes"), qtd(lista.length, "clipping", "clippings"))}${noAcervo ? t(` · ${noAcervo} no acervo`, ` · ${noAcervo} in the archive`) : ""}` : t("nenhum recorte", "no clippings"),
          <Recortes m={ctx} lista={lista} />)}
        {parteDe("fontes", t("Fontes", "Sources"),
          mudaram ? `${t(mudaram === 1 ? "1 fonte mudou" : `${mudaram} fontes mudaram`, mudaram === 1 ? "1 source changed" : `${mudaram} sources changed`)} · ${t(qtd(links.length, "fonte", "fontes"), qtd(links.length, "source", "sources"))}`
            : links.length ? t(qtd(links.length, "fonte", "fontes"), qtd(links.length, "source", "sources")) : t("nenhuma fonte", "no sources"),
          <Fontes m={ctx} links={links} />, mudaram ? "aviso" : undefined)}
        {parteDe("documentos", t("Documentos", "Documents"),
          estado.documentos.length ? `${t(qtd(estado.documentos.length, "PDF", "PDFs"), qtd(estado.documentos.length, "PDF", "PDFs"))}${lendoPdf ? t(` · ${lendoPdf} sendo lido${lendoPdf > 1 ? "s" : ""}`, ` · ${lendoPdf} being read`) : ""}` : t("nenhum PDF", "no PDFs"),
          <Documentos m={ctx} />)}
        {parteDe("gravacoes", t("Gravações", "Recordings"),
          estado.gravacoes.length ? `${t(qtd(estado.gravacoes.length, "gravação", "gravações"), qtd(estado.gravacoes.length, "recording", "recordings"))}${transcrevendo ? t(` · ${transcrevendo} transcrevendo`, ` · ${transcrevendo} transcribing`) : ""}` : t("nenhuma gravação", "no recordings"),
          <Gravacoes m={ctx} />)}
        {parteDe("acervo", t("Acervo do veículo", "Publication archive"), t("outros textos", "other texts"), <Acervo m={ctx} />)}
      </div>
    );
  }

  return (
    <section ref={raiz} tabIndex={-1} data-material aria-labelledby={folha ? undefined : "material-t"} aria-label={folha ? t("Material", "Material") : undefined} className="grid grid-cols-[minmax(0,1fr)] content-start gap-1 outline-none">
      {/* A cabeça fica presa no alto da coluna: a busca continua à mão enquanto a lista ou o leitor rolam. */}
      <div className={`sticky top-0 z-10 grid gap-2 bg-papel pb-3 ${folha ? "-mx-5 px-5" : "pt-1 shadow-[0_1px_0_var(--color-fio)]"}`}>
        {!folha && (
          <div className="flex items-center gap-2">
            <h2 id="material-t" className="mono m-0 text-[12px] font-normal tracking-[.08em] text-apoio uppercase">{t("Material", "Material")}</h2>
            <button type="button" onClick={acoes.fechar} aria-label={t("Fechar o material", "Close the material")} title={t("Fechar o material", "Close the material")}
              className="-mr-2 ml-auto grid size-11 cursor-pointer place-items-center rounded-btn border-0 bg-transparent text-apoio hover:bg-papel-2 hover:text-texto-forte">
              <IconeFechar className="size-5" />
            </button>
          </div>
        )}
        <label className="grid gap-1">
          <span className="sr-only">{t("Procurar no material", "Search the material")}</span>
          <input id="material-busca" type="search" className="entrada bg-branco" value={busca} placeholder={t("Procurar no material", "Search the material")} autoComplete="off" spellCheck={false}
            onChange={(e) => { setBusca(e.target.value); if (fonte) { setAlvo(null); mudar((p) => p.delete("fonte")); } }} />
        </label>
      </div>
      {corpo}
    </section>
  );
}

const MaterialMemo = memo(Material);
MaterialMemo.displayName = "Material";
export default MaterialMemo;

// ── recortes ──────────────────────────────────────────────────────────────────────────────────────────────────────

const ROTULO_ORIGEM: Record<Recorte["origem"], () => string> = {
  evidencia: () => t("fonte", "source"), documento: () => t("PDF", "PDF"), gravacao: () => t("gravação", "recording"), nota: () => t("anotação", "note"),
};
/** "Balanço de obras", "relatorio.pdf · p. 3", "entrevista.wav · 01:12" ou "anotação". */
const origemDe = (r: { origem: Recorte["origem"]; fonte: { nome: string | null }; pagina: number | null; inicio: number | null }) =>
  r.origem === "nota" ? ROTULO_ORIGEM.nota()
    : [r.fonte.nome ?? ROTULO_ORIGEM[r.origem](), r.pagina !== null ? t(`p. ${r.pagina}`, `p. ${r.pagina}`) : null, r.inicio !== null ? mmss(r.inicio) : null].filter(Boolean).join(" · ");
const inicioDe = (s: string) => { const p = s.split(/\s+/); return p.length > 6 ? `${p.slice(0, 6).join(" ")}…` : s; };

function Recortes({ m, lista }: { m: Ctx; lista: Recorte[] }) {
  // O texto salvo, não o documento vivo: "no texto" muda quando o texto salva, nunca a cada tecla.
  const salvos = useMemo(() => m.estado.texto.paragrafos.map((p) => p.texto), [m.estado.texto.paragrafos]);
  return (
    <div className="grid gap-4">
      {lista.length ? (
        <ul aria-label={t("Recortes", "Clippings")} className="m-0 grid list-none gap-3 p-0">
          {lista.map((r, i) => <CartaoRecorte key={r.id} m={m} r={r} primeiro={i === 0} ultimo={i === lista.length - 1} jaNoTexto={noTexto(r.trecho, salvos)} />)}
        </ul>
      ) : (
        <p className="m-0 text-apoio">
          {m.podeEditar
            ? t("Nenhum recorte ainda. Abra uma fonte, selecione o trecho e guarde; ou escreva uma anotação aqui embaixo.", "No clippings yet. Open a source, select the passage and save it; or write a note below.")
            : t("Nenhum recorte neste texto.", "No clippings in this text.")}
        </p>
      )}
      {m.podeEditar && <NovaAnotacao m={m} />}
    </div>
  );
}

const SetaCima = () => <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4"><path d="m6 15 6-6 6 6" /></svg>;
const SetaBaixo = () => <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4"><path d="m6 9 6 6 6-6" /></svg>;
const BOTAO_LINHA = "inline-flex min-h-11 cursor-pointer items-center rounded-btn border-0 bg-transparent px-2 text-[14px] font-bold text-texto-forte hover:bg-papel-2 disabled:cursor-not-allowed disabled:opacity-55";

/** O recorte: o trecho entre aspas, a origem em mono, a anotação e as ações, abaixo da linha de corte. */
function CartaoRecorte({ m, r, primeiro, ultimo, jaNoTexto }: { m: Ctx; r: Recorte; primeiro: boolean; ultimo: boolean; jaNoTexto: boolean }) {
  const qc = useQueryClient();
  const param = { tenantId: m.tenantId, id: m.textoId, recorte: r.id };
  const aplicar = (d: { recortes: Recorte[] }) => qc.setQueryData(chaveRecortes(m.tenantId, m.textoId), d);
  const [anotando, setAnotando] = useState(false);
  const [nota, setNota] = useState(r.nota ?? "");
  const mudar = useMutation({
    mutationFn: (corpo: Record<string, unknown>) => ler(rota.recortes[":recorte"].$patch({ param }, corpoJson(corpo))),
    onSuccess: (d) => { aplicar(d); setAnotando(false); },
  });
  const tirar = useMutation({ mutationFn: () => ler(rota.recortes[":recorte"].$delete({ param })), onSuccess: aplicar });
  const inserir = useMutation({ mutationFn: (soCitar: boolean) => m.inserirTrecho(r, soCitar) });
  const ocupado = mudar.isPending || tirar.isPending || inserir.isPending;
  const erro = mudar.error ?? tirar.error ?? inserir.error;
  const citavel = (r.origem === "evidencia" || r.origem === "documento") && r.fonteExiste;
  const falaCurta = r.origem === "gravacao" && palavrasDaFala(r.trecho) < FALA_MIN;
  const nome = inicioDe(r.trecho);
  const abrirNaFonte = () => {
    if (r.origem === "evidencia" && r.evidenciaId) m.abrirFonte("evidencia", r.evidenciaId, { trecho: r.trecho });
    else if (r.origem === "documento" && r.arquivoId) m.abrirFonte("documento", r.arquivoId, { pagina: r.pagina ?? 1, trecho: r.trecho });
    else if (r.origem === "gravacao" && r.arquivoId) m.abrirFonte("gravacao", r.arquivoId, { inicio: r.inicio ?? 0, trecho: r.trecho });
  };
  return (
    <li id={`recorte-${r.id}`} className="rounded-card bg-branco shadow-curta">
      <div className={`grid gap-x-1 pt-3 pb-2.5 pl-3 ${m.podeEditar ? "grid-cols-[minmax(0,1fr)_auto] pr-1" : "pr-3"}`}>
        <div className="grid content-start gap-1.5">
          <p className={`m-0 line-clamp-4 text-[15px] leading-[1.5] ${r.origem === "nota" ? "text-texto" : "text-texto-forte"}`}>{r.origem === "nota" ? r.trecho : `“${r.trecho}”`}</p>
          <p className="mono m-0 text-apoio">
            {origemDe(r)}
            {jaNoTexto && <span className="text-texto"> · {t("no texto", "in the text")}</span>}
            {/* Quem edita vê o estado no botão (aria-pressed); quem só lê, aqui. */}
            {r.acervo && !m.podeEditar && <span> · {t("no acervo", "in the archive")}</span>}
          </p>
          {!r.fonteExiste && <p className="mono m-0 text-ambar">{t("a fonte saiu do dossiê: dá para inserir o trecho, não para citar", "the source left the dossier: you can insert the passage, not cite it")}</p>}
          {anotando ? (
            <form className="grid gap-2 pt-1" onSubmit={(e) => { e.preventDefault(); mudar.mutate({ nota: nota.trim() || null }); }}>
              <label className="campo">
                <span className="text-[14px]!">{t("Anotação sobre o recorte", "Note on the clipping")}</span>
                <textarea className="entrada min-h-[72px] resize-y bg-papel" value={nota} maxLength={NOTA_MAX} autoFocus onChange={(e) => setNota(e.target.value)} />
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="submit" className="btn-sec bg-papel-2" disabled={mudar.isPending}>{mudar.isPending ? t("Guardando…", "Saving…") : t("Guardar", "Save")}</button>
                <button type="button" className="btn-sec" onClick={() => { setAnotando(false); setNota(r.nota ?? ""); mudar.reset(); }}>{t("Cancelar", "Cancel")}</button>
              </div>
            </form>
          ) : r.nota && <p className="m-0 border-l-2 border-fio-forte pl-2 text-[14px] text-texto">{r.nota}</p>}
        </div>
        {/* Subir e descer, empilhados ao lado do trecho: a ordem é do recorte, não de uma ação sobre ele. */}
        {m.podeEditar && (
          <div className="-mt-2 grid content-start">
            <button type="button" className={`${BOTAO_LINHA} w-11 justify-center px-0 text-apoio`} aria-label={t(`Subir: ${nome}`, `Move up: ${nome}`)} title={t("Subir", "Move up")} disabled={ocupado || primeiro} onClick={() => mudar.mutate({ mover: "cima" })}><SetaCima /></button>
            <button type="button" className={`${BOTAO_LINHA} w-11 justify-center px-0 text-apoio`} aria-label={t(`Descer: ${nome}`, `Move down: ${nome}`)} title={t("Descer", "Move down")} disabled={ocupado || ultimo} onClick={() => mudar.mutate({ mover: "baixo" })}><SetaBaixo /></button>
          </div>
        )}
      </div>
      {/* A linha de corte: o que está acima é o recorte; abaixo, o que se faz com ele. */}
      {(m.podeEditar || (r.origem !== "nota" && r.fonteExiste)) && (
      <div className="grid gap-0.5 border-t border-dashed border-fio-forte px-1.5 py-1">
        <div className="flex flex-wrap items-center gap-1">
          {/* Os botões não pegam o foco ao apertar: o cursor e a seleção do texto ficam onde estavam. */}
          {m.podeEditar && (
            <button type="button" className="btn-sec min-h-11 bg-papel-2 px-3 text-[14px]" onMouseDown={(e) => e.preventDefault()} disabled={ocupado || falaCurta} onClick={() => inserir.mutate(false)}>
              {t("Inserir", "Insert")}<span className="sr-only">: {nome}</span>
            </button>
          )}
          {m.podeEditar && citavel && (
            <button type="button" className={BOTAO_LINHA} onMouseDown={(e) => e.preventDefault()} disabled={ocupado} onClick={() => inserir.mutate(true)}>
              {t("Só citar", "Cite only")}<span className="sr-only">: {nome}</span>
            </button>
          )}
          {r.origem !== "nota" && r.fonteExiste && <button type="button" className={BOTAO_LINHA} onClick={abrirNaFonte}>{t("Abrir na fonte", "Open in source")}<span className="sr-only">: {nome}</span></button>}
        </div>
        {m.podeEditar && (
          <div className="flex flex-wrap items-center">
            {!anotando && <button type="button" className={`${BOTAO_LINHA} font-normal`} onClick={() => { setNota(r.nota ?? ""); setAnotando(true); }}>{r.nota ? t("Editar a anotação", "Edit the note") : t("Anotar", "Add a note")}<span className="sr-only">: {nome}</span></button>}
            {r.compartilhavel && (
              <button type="button" className={`${BOTAO_LINHA} font-normal`} aria-pressed={r.acervo} disabled={ocupado} onClick={() => mudar.mutate({ acervo: !r.acervo })}>
                {r.acervo ? t("No acervo", "In the archive") : t("Guardar no acervo", "Keep in the archive")}<span className="sr-only">: {nome}</span>
              </button>
            )}
            <button type="button" className={`${BOTAO_LINHA} font-normal`} disabled={ocupado} onClick={() => tirar.mutate()}>{t("Tirar", "Remove")}<span className="sr-only">: {nome}</span></button>
          </div>
        )}
        {falaCurta && m.podeEditar && <p className="mono m-0 px-1.5 pb-1 text-apoio">{t("fala de menos de 3 palavras: a conferência não a acha na gravação", "speech under 3 words: the check can't find it in the recording")}</p>}
        {erro && <p role="alert" className="faixa-erro m-1 text-[14px]">{erro instanceof Error && !("status" in erro) ? erro.message : mensagem(erro)}</p>}
      </div>
      )}
    </li>
  );
}

/** A anotação da pessoa: texto dela, sem checagem e sem citação. */
function NovaAnotacao({ m }: { m: Ctx }) {
  const [texto, setTexto] = useState("");
  const guardar = useMutation({ mutationFn: () => m.guardar({ origem: "nota", trecho: texto.trim() }), onSuccess: () => setTexto("") });
  const curta = juntarEspacos(texto).length < TRECHO_MIN;
  return (
    <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); if (!curta) guardar.mutate(); }}>
      <div className="campo">
        <label htmlFor="material-anotacao" className="text-[15px] font-bold text-texto-forte">{t("Anotação", "Note")}</label>
        <textarea id="material-anotacao" className="entrada min-h-[72px] resize-y bg-branco" value={texto} maxLength={TRECHO_MAX} onChange={(e) => { setTexto(e.target.value); guardar.reset(); }}
          aria-describedby="material-anotacao-ajuda" />
        <span id="material-anotacao-ajuda" className="ajuda">{t("Um número, uma pergunta, um nome para procurar. Inserir põe o texto como está, sem aspas.", "A number, a question, a name to look up. Insert puts the text as it is, without quotes.")}</span>
      </div>
      {guardar.isError && <p role="alert" className="faixa-erro m-0">{mensagem(guardar.error)}</p>}
      <button type="submit" className="btn-sec justify-self-start bg-papel-2" disabled={guardar.isPending || curta}>{guardar.isPending ? t("Guardando…", "Saving…") : t("Guardar a anotação", "Save the note")}</button>
    </form>
  );
}

// ── fontes, documentos, gravações ─────────────────────────────────────────────────────────────────────────────────

const CARTAO_FONTE = "grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5 rounded-card border-0 bg-branco px-3 py-2.5 text-left font-[inherit] shadow-curta transition-shadow hover:shadow-eleva disabled:cursor-default disabled:hover:shadow-curta";
const SetaLer = () => <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="row-span-2 size-4 text-apoio"><path d="m9 6 6 6-6 6" /></svg>;

function Fontes({ m, links }: { m: Ctx; links: Evidencia[] }) {
  const [acrescentando, setAcrescentando] = useState(false);
  const usadas = (id: string) => m.estado.afirmacoes.filter((a) => (a.apuracao?.tipo === "fonte" ? a.apuracao.evidenciaId === id : !a.apuracao && a.estado === "com_evidencia" && a.evidenciaId === id)).length;
  return (
    <div className="grid gap-3">
      {links.length ? (
        <ul className="m-0 grid list-none gap-2 p-0">
          {links.map((e) => {
            const n = usadas(e.id);
            return (
              <li key={e.id}>
                <button type="button" className={CARTAO_FONTE} onClick={() => m.abrirFonte("evidencia", e.id)}>
                  <b className="min-w-0 text-[15px] leading-snug text-texto-forte">{nomeEvidencia(e)}</b>
                  <SetaLer />
                  <span className="mono min-w-0 text-apoio [overflow-wrap:anywhere]">
                    {e.origem === "link" ? new URL(e.url).hostname : e.origem === "lai" ? t("resposta de LAI", "FOI reply") : t("resposta do outro lado", "reply from the other side")}
                    {n ? t(` · sustenta ${n === 1 ? "1 afirmação" : `${n} afirmações`}`, ` · supports ${n === 1 ? "1 claim" : `${n} claims`}`) : ""}
                  </span>
                  {e.mudouEm && <span className="mono col-span-2 text-ambar">{t("a fonte mudou desde que você conferiu", "the source changed since you checked")}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      ) : <p className="m-0 text-apoio">{t("Nenhuma fonte no dossiê. Cole um link no texto ou acrescente aqui: a página é lida, guardada e fica para ler ao lado.", "No sources in the dossier. Paste a link in the text or add it here: the page is read, saved and ready to read alongside.")}</p>}
      {m.podeEditar && (acrescentando
        ? <FormLink tenantId={m.tenantId} textoId={m.textoId} rotulo={t("Link para o dossiê", "Link for the dossier")} cancelar={() => setAcrescentando(false)} aoAdicionar={(d) => { setAcrescentando(false); m.acoes.aoFonte(d); }} />
        : <button type="button" className="btn-sec justify-self-start bg-papel-2" onClick={() => setAcrescentando(true)}>{t("Acrescentar link", "Add link")}</button>)}
    </div>
  );
}

function Documentos({ m }: { m: Ctx }) {
  const enviar = useEnviarPdf(m.tenantId, m.textoId, m.acoes.atualizar);
  return (
    <div className="grid gap-3">
      {m.estado.documentos.length ? (
        <ul className="m-0 grid list-none gap-2 p-0">
          {m.estado.documentos.map((d) => (
            <li key={d.id}>
              <button type="button" className={CARTAO_FONTE} disabled={d.estado !== "pronto"} onClick={() => m.abrirFonte("documento", d.id)}>
                <b className="min-w-0 text-[15px] leading-snug break-words text-texto-forte">{d.nome}</b>
                {d.estado === "pronto" ? <SetaLer /> : <span />}
                <span className={`mono min-w-0 ${d.estado === "falhou" ? "text-terracota" : "text-apoio"}`}>
                  {d.estado === "lendo" ? t("lendo o PDF…", "reading the PDF…") : d.estado === "falhou" ? t("não deu para ler este PDF", "this PDF couldn't be read") : d.paginas === 1 ? t("1 página", "1 page") : t(`${d.paginas} páginas`, `${d.paginas} pages`)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="m-0 text-apoio">{t("Nenhum PDF neste texto. Envie o relatório, o contrato ou o processo: cada página fica para ler e recortar.", "No PDFs in this text. Upload the report, contract or court record: every page is ready to read and clip.")}</p>}
      {m.podeEditar && <BotaoPdf enviar={enviar} />}
      {enviar.isError && <p role="alert" className="faixa-erro m-0">{mensagem(enviar.error)}</p>}
    </div>
  );
}

function Gravacoes({ m }: { m: Ctx }) {
  const enviar = useEnviarAudio(m.tenantId, m.textoId, m.acoes.atualizar);
  return (
    <div className="grid gap-3">
      {m.estado.gravacoes.length ? (
        <ul className="m-0 grid list-none gap-2 p-0">
          {m.estado.gravacoes.map((g) => (
            <li key={g.id}>
              <button type="button" className={CARTAO_FONTE} disabled={g.estado !== "pronto"} onClick={() => m.abrirFonte("gravacao", g.id)}>
                <b className="min-w-0 text-[15px] leading-snug break-words text-texto-forte">{g.nome}</b>
                {g.estado === "pronto" ? <SetaLer /> : <span />}
                <span className={`mono min-w-0 ${g.estado === "falhou" ? "text-terracota" : "text-apoio"}`}>
                  {g.estado === "lendo" ? t("transcrevendo…", "transcribing…") : g.estado === "falhou" ? t("a transcrição falhou", "the transcription failed") : t(`${mmss(g.duracao ?? 0)} de áudio`, `${mmss(g.duracao ?? 0)} of audio`)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="m-0 text-apoio">{t("Nenhuma gravação neste texto. Envie o áudio da entrevista: a fala transcrita fica para ler, recortar e inserir entre aspas.", "No recordings in this text. Upload the interview audio: the transcribed speech is ready to read, clip and insert as a quote.")}</p>}
      {m.podeEditar && <BotaoAudio enviar={enviar} />}
      {enviar.isError && <p role="alert" className="faixa-erro m-0">{mensagem(enviar.error)}</p>}
    </div>
  );
}

// ── busca única ───────────────────────────────────────────────────────────────────────────────────────────────────

/** O trecho com as faixas pintadas: o achado da busca (grafite, em negrito) e o que sustenta afirmação (verde claro). */
function Pintado({ texto, achados = [], sustenta = [] }: { texto: string; achados?: [number, number][]; sustenta?: [number, number][] }) {
  if (!achados.length && !sustenta.length) return <>{texto}</>;
  const cortes = [...new Set([0, texto.length, ...achados.flat(), ...sustenta.flat()])].filter((x) => x >= 0 && x <= texto.length).sort((a, b) => a - b);
  const dentro = (fs: [number, number][], i: number) => fs.some(([a, b]) => a <= i && i < b);
  return (
    <>
      {cortes.slice(0, -1).map((de, k) => {
        const ate = cortes[k + 1];
        const pedaco = texto.slice(de, ate);
        const v = dentro(sustenta, de), a = dentro(achados, de);
        if (!v && !a) return <span key={de}>{pedaco}</span>;
        return <mark key={de} className={`px-px text-texto-forte [box-decoration-break:clone] ${v ? "bg-verde-claro" : "bg-papel-3"} ${a ? "font-bold" : ""}`}>{pedaco}</mark>;
      })}
    </>
  );
}

/** Onde cada palavra procurada aparece (sem acento e sem caixa: `dobrar` mantém o comprimento, as posições valem no original). */
function faixasDe(texto: string, termos: string[]): [number, number][] {
  if (!termos.length) return [];
  const plano = dobrar(texto);
  const out: [number, number][] = [];
  for (const x of termos) for (let i = plano.indexOf(x); i >= 0; i = plano.indexOf(x, i + x.length)) out.push([i, i + x.length]);
  return out;
}
/**
 * O grifo do que sustenta afirmação, parágrafo a parágrafo. O trecho apontado pode passar de um parágrafo para o outro (o
 * título da página e a primeira frase, por exemplo): procura no texto inteiro, com os parágrafos juntos por um espaço (como
 * o servidor junta), e reparte o achado entre eles.
 */
function grifosDaFonte(paragrafos: string[], trechos: string[]): [number, number][][] {
  const out = paragrafos.map((): [number, number][] => []);
  const inicios: number[] = [];
  let pos = 0;
  for (const p of paragrafos) { inicios.push(pos); pos += p.length + 1; }
  const todo = paragrafos.join(" ");
  for (const bruto of new Set(trechos)) {
    const x = juntarEspacos(bruto);
    if (x.length < TRECHO_MIN) continue;
    for (let a = todo.indexOf(x); a >= 0; a = todo.indexOf(x, a + x.length)) {
      const b = a + x.length;
      paragrafos.forEach((p, i) => {
        const de = Math.max(a, inicios[i]), ate = Math.min(b, inicios[i] + p.length);
        if (de < ate) out[i].push([de - inicios[i], ate - inicios[i]]);
      });
    }
  }
  return out;
}

function Resultados({ m, q, irParaRecorte }: { m: Ctx; q: string; irParaRecorte: (id: string) => void }) {
  const r = useQuery({
    queryKey: [m.tenantId, "material-busca", m.textoId, q], staleTime: 15_000, placeholderData: keepPreviousData,
    queryFn: () => ler(rota.material.busca.$get({ param: { tenantId: m.tenantId, id: m.textoId }, query: { q } })),
  });
  if (r.isPending) return <p role="status" className="mono m-0 text-apoio">{t("procurando…", "searching…")}</p>;
  if (r.isError) return <p role="alert" className="faixa-erro m-0">{mensagem(r.error)}</p>;
  const rotuloGrupo = (tipo: string) => (tipo === "recortes" ? t("recortes", "clippings") : tipo === "evidencia" ? t("fonte", "source") : tipo === "documento" ? "PDF" : t("gravação", "recording"));
  const abrir = (tipo: string, id: string | null, a: Achado) => {
    if (tipo === "recortes") { if (a.recorteId) irParaRecorte(a.recorteId); return; }
    if (!id) return;
    m.abrirFonte(tipo as TipoFonte, id, { paragrafo: a.paragrafo, pagina: a.pagina, inicio: a.inicio });
  };
  const onde = (a: Achado) => (a.pagina !== undefined ? t(`p. ${a.pagina}`, `p. ${a.pagina}`) : a.inicio !== undefined ? mmss(a.inicio) : a.paragrafo !== undefined ? t(`parágrafo ${a.paragrafo + 1}`, `paragraph ${a.paragrafo + 1}`) : "");
  const total = r.data.grupos.reduce((n, g) => n + g.achados.length, 0);
  return (
    // A lista da busca anterior fica à vista enquanto a nova chega, apagada: não dá para confundir as duas.
    <div aria-busy={r.isFetching} className={`grid gap-4 pt-2 transition-opacity ${r.isPlaceholderData ? "opacity-55" : ""}`}>
      <p role="status" className="mono m-0 text-apoio">{total ? t(qtd(total, "achado", "achados"), qtd(total, "match", "matches")) : t("nada achado", "nothing found")}</p>
      {!total && <p className="m-0 text-apoio">{t("Nada com essas palavras no material. A busca procura todas as palavras no mesmo parágrafo, página ou trecho da fala.", "Nothing with those words in the material. The search looks for all the words in the same paragraph, page or stretch of speech.")}</p>}
      {r.data.cortado && <p className="faixa-aviso m-0 text-[14px]">{t("A busca parou no teto e mostra só o começo. Use mais palavras para achar o resto.", "The search hit its limit and shows only the start. Use more words to find the rest.")}</p>}
      {r.data.grupos.map((g) => (
        <section key={`${g.tipo}:${g.id}`} aria-label={`${rotuloGrupo(g.tipo)}: ${g.nome ?? ""}`} className="grid gap-2">
          <h3 className="m-0 grid gap-0.5 text-[15px] leading-snug">
            <span className="mono font-normal text-apoio">{rotuloGrupo(g.tipo)}</span>
            {g.nome && <span className="text-texto-forte">{g.nome}</span>}
          </h3>
          <ul className="m-0 grid list-none gap-2 p-0">
            {g.achados.map((a, i) => (
              <li key={i}>
                <button type="button" className="grid w-full cursor-pointer gap-1 rounded-card border-0 bg-branco px-3 py-2.5 text-left font-[inherit] text-[14px] leading-[1.5] text-texto shadow-curta transition-shadow hover:shadow-eleva" onClick={() => abrir(g.tipo, g.id, a)}>
                  <span><Pintado texto={a.trecho} achados={a.marcas} /></span>
                  {onde(a) && <span className="mono text-apoio">{onde(a)}</span>}
                </button>
              </li>
            ))}
          </ul>
          {g.mais && <p className="mono m-0 text-apoio">{t("há mais nesta fonte: abra o leitor e procure nela", "there's more in this source: open the reader and search it")}</p>}
        </section>
      ))}
    </div>
  );
}

// ── leitor ao lado ────────────────────────────────────────────────────────────────────────────────────────────────

type Aviso = { texto: string; erro: boolean } | null;
/** Um parágrafo (ou trecho da fala) do leitor: o texto, os grifos e as ações, que valem para a seleção dentro dele ou para ele inteiro. */
type ItemLeitor = { chave: string; texto: string; rotulo: string; alvo: boolean; grifos: [number, number][]; fonte: Omit<Trecho, "trecho">; extra?: ReactNode };

function Leitor({ m, tipo, id, alvo, voltar, focar }: { m: Ctx; tipo: TipoFonte; id: string; alvo: Alvo | null; voltar: () => void; focar: { current: boolean } }) {
  const [busca, setBusca] = useState("");
  const termos = termosDaBusca(busca);
  const [aviso, setAviso] = useState<Aviso>(null);
  const titulo = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!focar.current) return;
    focar.current = false;
    titulo.current?.focus({ preventScroll: true });
  }, [focar]);
  const ev = tipo === "evidencia" ? m.estado.evidencias.find((e) => e.id === id) : undefined;
  const doc = tipo === "documento" ? m.estado.documentos.find((d) => d.id === id) : undefined;
  const grav = tipo === "gravacao" ? m.estado.gravacoes.find((g) => g.id === id) : undefined;
  const nome = ev ? nomeEvidencia(ev) : doc?.nome ?? grav?.nome ?? t("Fonte", "Source");
  const urlPdf = `/api/t/${encodeURIComponent(m.tenantId)}/textos/${encodeURIComponent(m.textoId)}/documentos/${encodeURIComponent(id)}/pdf`;
  const original = ev?.origem === "link" ? ev.url : doc ? urlPdf : null;
  const meta = ev ? (ev.origem === "link" ? new URL(ev.url).hostname : ev.origem === "lai" ? t("resposta de LAI", "FOI reply") : ev.origem === "documento" ? t("página de PDF", "PDF page") : t("resposta do outro lado", "reply from the other side"))
    : doc ? (doc.paginas === 1 ? t("PDF · 1 página", "PDF · 1 page") : t(`PDF · ${doc.paginas ?? 0} páginas`, `PDF · ${doc.paginas ?? 0} pages`)) : grav ? t(`gravação · ${mmss(grav.duracao ?? 0)}`, `recording · ${mmss(grav.duracao ?? 0)}`) : "";
  const sumiu = tipo === "evidencia" ? !ev : tipo === "documento" ? !doc : !grav;
  return (
    <div className="grid gap-3 pt-1">
      <button type="button" className="link-acao inline-flex min-h-11 items-center gap-1 justify-self-start border-0 bg-transparent p-0 text-[15px]" onClick={voltar}>
        <IconeVoltar className="size-4" /> {t("Voltar ao material", "Back to the material")}
      </button>
      <div className="grid gap-1">
        <h3 ref={titulo} tabIndex={-1} className="m-0 text-[19px] leading-snug font-bold outline-none">{nome}</h3>
        <p className="mono m-0 flex flex-wrap gap-x-2 text-apoio">
          <span>{meta}</span>
          {ev?.mudouEm && <span className="text-ambar">{t("· a fonte mudou desde que você conferiu", "· the source changed since you checked")}</span>}
          {original && <span aria-hidden="true">·</span>}
          {original && <a href={original} target="_blank" rel="noreferrer" className="link-acao font-normal">{ev ? t("abrir o original", "open the original") : t("abrir o PDF", "open the PDF")}</a>}
        </p>
      </div>
      {sumiu ? <p className="faixa-aviso m-0">{t("Esta fonte não está mais no texto: saiu do dossiê.", "This source is no longer in the text: it left the dossier.")}</p> : (
        <>
          <label className="grid">
            <span className="sr-only">{t("Procurar nesta fonte", "Search this source")}</span>
            <input type="search" className="entrada min-h-11 bg-papel-2 py-2 text-[15px]" value={busca} placeholder={t("Procurar nesta fonte", "Search this source")} autoComplete="off" spellCheck={false} onChange={(e) => setBusca(e.target.value)} />
          </label>
          {m.podeEditar && <p className="ajuda m-0">{t("Selecione um pedaço para guardar ou inserir só ele; sem seleção, vale o parágrafo inteiro.", "Select a part to save or insert only that; with no selection, the whole paragraph counts.")}</p>}
          <p aria-live="polite" className="m-0 empty:hidden">{aviso && <span className={aviso.erro ? "faixa-erro block" : "mono text-verde"}>{aviso.texto}</span>}</p>
          {tipo === "evidencia" && ev && <CorpoEvidencia m={m} ev={ev} alvo={alvo} termos={termos} avisar={setAviso} />}
          {tipo === "documento" && doc && <CorpoDocumento m={m} id={id} alvo={alvo} termos={termos} avisar={setAviso} />}
          {tipo === "gravacao" && grav && <CorpoGravacao m={m} id={id} segmentada={!!grav.segmentos} alvo={alvo} termos={termos} avisar={setAviso} />}
        </>
      )}
    </div>
  );
}

/** O parágrafo do alvo (o achado da busca, o recorte aberto) vai para o meio da coluna quando o texto chega. */
function useRolarAoAlvo(pronto: boolean) {
  const feito = useRef(false);
  useEffect(() => {
    if (!pronto || feito.current) return;
    feito.current = true;
    window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>("[data-material] [data-alvo]");
      if (el) centrarNoMaterial(el);
    }, 30);
  }, [pronto]);
}

/** Centra o elemento só dentro da caixa que rola o Material (a coluna ou a folha de baixo). `scrollIntoView` rolaria
 *  também a página, e o texto sairia do lugar enquanto se lê a fonte ao lado. */
function centrarNoMaterial(el: HTMLElement) {
  let caixa = el.parentElement;
  while (caixa && !(/(auto|scroll)/.test(getComputedStyle(caixa).overflowY) && caixa.scrollHeight > caixa.clientHeight)) caixa = caixa.parentElement;
  if (!caixa) return;
  const r = el.getBoundingClientRect(), c = caixa.getBoundingClientRect();
  caixa.scrollTop += r.top - c.top - (c.height - r.height) / 2;
}

const indiceDoTrecho = (paragrafos: string[], trecho?: string) => {
  if (!trecho) return -1;
  const x = juntarEspacos(trecho);
  const i = paragrafos.findIndex((p) => p.includes(x));
  return i >= 0 ? i : paragrafos.findIndex((p) => p.includes(x.slice(0, 40)));
};

function CorpoEvidencia({ m, ev, alvo, termos, avisar }: { m: Ctx; ev: Evidencia; alvo: Alvo | null; termos: string[]; avisar: (a: Aviso) => void }) {
  const q = useQuery({
    queryKey: [m.tenantId, "evidencia-texto", m.textoId, ev.id], staleTime: 60_000,
    queryFn: () => ler(rota.evidencias[":evidencia"].texto.$get({ param: { tenantId: m.tenantId, id: m.textoId, evidencia: ev.id } })),
  });
  // O que já sustenta afirmação do texto: o trecho da evidência que o modelo (ou a pessoa, ao prender a fonte) apontou.
  const sustenta = m.estado.afirmacoes.flatMap((a) => (a.apuracao?.tipo === "fonte" ? (a.apuracao.evidenciaId === ev.id && a.apuracao.evidenciaTrecho ? [a.apuracao.evidenciaTrecho] : [])
    : !a.apuracao && a.estado === "com_evidencia" && a.evidenciaId === ev.id && a.evidenciaTrecho ? [a.evidenciaTrecho] : []));
  useRolarAoAlvo(q.isSuccess);
  if (q.isPending) return <Esqueleto />;
  if (q.isError) return <p role="alert" className="faixa-erro m-0">{mensagem(q.error)}</p>;
  const ps = q.data.paragrafos;
  const ialvo = alvo?.paragrafo ?? indiceDoTrecho(ps, alvo?.trecho);
  const grifos = grifosDaFonte(ps, sustenta);
  const itens: ItemLeitor[] = ps.map((p, i) => ({
    chave: String(i), texto: p, rotulo: t(`parágrafo ${i + 1}`, `paragraph ${i + 1}`), alvo: i === ialvo, grifos: grifos[i],
    fonte: { origem: "evidencia", evidenciaId: ev.id },
  }));
  if (!itens.length) return <p className="m-0 text-apoio">{t("A página guardada desta fonte não tem texto para ler.", "This source's saved page has no text to read.")}</p>;
  return <ListaLeitor m={m} itens={itens} termos={termos} avisar={avisar} minimo={TRECHO_MIN} />;
}

function CorpoDocumento({ m, id, alvo, termos, avisar }: { m: Ctx; id: string; alvo: Alvo | null; termos: string[]; avisar: (a: Aviso) => void }) {
  const inicio = Math.max(1, alvo?.pagina ?? 1);
  const q = useInfiniteQuery({
    queryKey: [m.tenantId, "documento-paginas", m.textoId, id, inicio], initialPageParam: inicio, staleTime: 60_000,
    queryFn: ({ pageParam }) => ler(rota.documentos[":arquivo"].paginas.$get({ param: { tenantId: m.tenantId, id: m.textoId, arquivo: id }, query: { de: String(pageParam), ate: undefined } })),
    getNextPageParam: (u) => u.proxima ?? undefined,
  });
  // Os trechos de página que sustentam afirmação vêm das evidências tiradas deste PDF (a página inteira vira evidência).
  const sustenta = m.estado.afirmacoes.flatMap((a) => {
    const evId = a.apuracao?.tipo === "fonte" ? a.apuracao.evidenciaId : !a.apuracao && a.estado === "com_evidencia" ? a.evidenciaId : null;
    const trecho = a.apuracao?.tipo === "fonte" ? a.apuracao.evidenciaTrecho : a.evidenciaTrecho;
    return evId && trecho && m.estado.evidencias.some((e) => e.id === evId && e.origem === "documento") ? [trecho] : [];
  });
  useRolarAoAlvo(q.isSuccess);
  if (q.isPending) return <Esqueleto />;
  if (q.isError) return <p role="alert" className="faixa-erro m-0">{mensagem(q.error)}</p>;
  const paginas = q.data.pages.flatMap((pg) => pg.paginas);
  const total = q.data.pages[0]?.total ?? 0;
  return (
    <div className="grid gap-4">
      {inicio > 1 && <p className="mono m-0 text-apoio">{t(`a partir da p. ${inicio} de ${total}`, `from p. ${inicio} of ${total}`)}</p>}
      {paginas.map((pg) => {
        const ialvo = alvo && pg.pagina === alvo.pagina ? (alvo.paragrafo ?? indiceDoTrecho(pg.paragrafos, alvo.trecho)) : -1;
        const grifos = grifosDaFonte(pg.paragrafos, sustenta);
        const itens: ItemLeitor[] = pg.paragrafos.map((p, i) => ({
          chave: `${pg.pagina}:${i}`, texto: p, rotulo: t(`p. ${pg.pagina}, parágrafo ${i + 1}`, `p. ${pg.pagina}, paragraph ${i + 1}`), alvo: i === ialvo, grifos: grifos[i],
          fonte: { origem: "documento", arquivoId: id, pagina: pg.pagina },
        }));
        return (
          <section key={pg.pagina} aria-label={t(`Página ${pg.pagina}`, `Page ${pg.pagina}`)} className="grid gap-2">
            <h4 className="secao m-0 font-normal">{t(`p. ${pg.pagina}`, `p. ${pg.pagina}`)}<span className="normal-case">{t(`de ${total}`, `of ${total}`)}</span></h4>
            {itens.length ? <ListaLeitor m={m} itens={itens} termos={termos} avisar={avisar} minimo={TRECHO_MIN_DOCUMENTO} />
              : <p className="mono m-0 text-apoio">{t("página sem texto", "page with no text")}</p>}
          </section>
        );
      })}
      {q.hasNextPage && (
        <button type="button" className="btn-sec justify-self-start bg-papel-2" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
          {q.isFetchingNextPage ? t("carregando…", "loading…") : t("Mais páginas", "More pages")}
        </button>
      )}
      {q.isFetchNextPageError && <p role="alert" className="faixa-erro m-0">{t("As páginas seguintes não carregaram. Tente de novo.", "The next pages didn't load. Try again.")}</p>}
    </div>
  );
}

function CorpoGravacao({ m, id, segmentada, alvo, termos, avisar }: { m: Ctx; id: string; segmentada: boolean; alvo: Alvo | null; termos: string[]; avisar: (a: Aviso) => void }) {
  const q = useQuery({
    queryKey: [m.tenantId, "transcricao", id], staleTime: Infinity,
    queryFn: () => ler(rota.gravacoes[":arquivo"].transcricao.$get({ param: { tenantId: m.tenantId, id: m.textoId, arquivo: id } })),
  });
  // As aspas do texto que a conferência ligou a esta gravação: a fala delas fica grifada no trecho.
  const sustenta = m.estado.apontamentos.flatMap((p) => (p.tipo === "gravacao" && p.gravacao?.arquivoId === id ? [p.trecho.replace(/^[“"«]\s*|\s*[”"»]$/g, "")] : []));
  useRolarAoAlvo(q.isSuccess);
  if (q.isPending) return <Esqueleto />;
  if (q.isError) return <p role="alert" className="faixa-erro m-0">{mensagem(q.error)}</p>;
  const trechos = q.data.trechos;
  // O trecho da fala em que o segundo pedido cai (o último que começa antes dele).
  let ialvo = -1;
  if (alvo?.inicio !== undefined) trechos.forEach((x, i) => { if (x.inicio <= alvo.inicio! + 0.01) ialvo = i; });
  const textos = trechos.map((x) => juntarEspacos(x.texto));
  const grifos = grifosDaFonte(textos, sustenta);
  const itens: ItemLeitor[] = trechos.map((x, i) => ({
    chave: String(x.inicio), texto: textos[i], rotulo: mmss(x.inicio), alvo: i === ialvo, grifos: grifos[i],
    fonte: { origem: "gravacao", arquivoId: id },
    extra: <TocarTrecho tenantId={m.tenantId} textoId={m.textoId} g={{ arquivoId: id, inicio: x.inicio, fim: x.fim, segmentada }} />,
  }));
  if (!itens.length) return <p className="m-0 text-apoio">{t("A transcrição veio vazia.", "The transcript came back empty.")}</p>;
  return <ListaLeitor m={m} itens={itens} termos={termos} avisar={avisar} minimo={TRECHO_MIN} fala />;
}

const Esqueleto = () => (
  <div aria-busy="true" className="grid gap-2">
    <p role="status" className="sr-only">{t("Carregando a fonte", "Loading the source")}</p>
    {[0, 1, 2].map((i) => <div key={i} className="esqueleto h-16" />)}
  </div>
);

/** A seleção vale se está inteira dentro do parágrafo; senão, o parágrafo inteiro. */
function trechoDe(botao: HTMLElement, inteiro: string) {
  const p = botao.closest("li")?.querySelector("[data-trecho]");
  const s = window.getSelection();
  if (!p || !s || s.isCollapsed || !p.contains(s.anchorNode) || !p.contains(s.focusNode)) return { trecho: inteiro, selecao: false };
  return { trecho: juntarEspacos(s.toString()), selecao: true };
}

function ListaLeitor({ m, itens, termos, avisar, minimo, fala = false }: { m: Ctx; itens: ItemLeitor[]; termos: string[]; avisar: (a: Aviso) => void; minimo: number; fala?: boolean }) {
  const [ocupado, setOcupado] = useState<string | null>(null);
  // Procurar nesta fonte: ficam os parágrafos com todas as palavras, como na busca única.
  const vistos = termos.length ? itens.filter((x) => { const d = dobrar(x.texto); return termos.every((tt) => d.includes(tt)); }) : itens;
  async function agir(botao: HTMLElement, x: ItemLeitor, acao: "guardar" | "inserir") {
    const { trecho } = trechoDe(botao, x.texto);
    if (trecho.length < minimo) { avisar({ erro: true, texto: t(`Selecione pelo menos ${minimo} caracteres.`, `Select at least ${minimo} characters.`) }); return; }
    if (acao === "guardar" && trecho.length > TRECHO_MAX) { avisar({ erro: true, texto: t(`Trecho longo demais: selecione até ${TRECHO_MAX} caracteres.`, `Passage too long: select up to ${TRECHO_MAX} characters.`) }); return; }
    // A seleção que sai do parágrafo não é aceita pelo servidor: avisa antes de pedir.
    if (!trechoNaFonte(x.texto, trecho)) { avisar({ erro: true, texto: t("Selecione dentro de um parágrafo só.", "Select within a single paragraph.") }); return; }
    setOcupado(`${x.chave}:${acao}`);
    avisar(null);
    try {
      if (acao === "guardar") {
        const r = await m.guardar({ ...x.fonte, trecho });
        avisar({ erro: false, texto: r.existia ? t("Esse trecho já estava nos recortes.", "That passage was already in the clippings.") : t("Guardado nos recortes.", "Saved to the clippings.") });
      } else await m.inserirTrecho({ ...x.fonte, trecho });
    } catch (e) {
      avisar({ erro: true, texto: e instanceof Error && !("status" in e) ? e.message : mensagem(e) });
    } finally {
      setOcupado(null);
    }
  }
  if (!vistos.length) return <p className="m-0 text-apoio">{t("Nada com essas palavras nesta fonte.", "Nothing with those words in this source.")}</p>;
  return (
    <>
      {termos.length > 0 && <p className="mono m-0 text-apoio">{t(`${vistos.length} de ${itens.length} ${fala ? "trechos" : "parágrafos"}`, `${vistos.length} of ${itens.length} ${fala ? "stretches" : "paragraphs"}`)}</p>}
      {/* A fonte é lida como a folha do texto: papel branco e liso. */}
      <ol className="m-0 grid list-none gap-0 rounded-card bg-branco px-3 py-1 shadow-curta">
        {vistos.map((x) => (
          <li key={x.chave} data-alvo={x.alvo || undefined} className={`grid gap-1 border-t border-fio py-2.5 first:border-t-0 ${x.alvo ? "-mx-2 rounded-card bg-papel-2 px-2" : ""}`}>
            {fala && <span className="mono text-apoio">{x.rotulo}</span>}
            <p data-trecho className="m-0 text-[15px] leading-[1.6] text-texto">
              <Pintado texto={x.texto} achados={faixasDe(x.texto, termos)} sustenta={x.grifos} />
            </p>
            {(m.podeEditar || x.extra) && (
              <div className="-ml-2 flex flex-wrap items-center gap-1">
                {x.extra}
                {m.podeEditar && (
                  <>
                    {/* Não pegam o foco ao apertar: a seleção feita no parágrafo e o cursor do texto ficam onde estavam. */}
                    <button type="button" className={BOTAO_LINHA} onMouseDown={(e) => e.preventDefault()} disabled={!!ocupado} onClick={(e) => void agir(e.currentTarget, x, "guardar")}>
                      {ocupado === `${x.chave}:guardar` ? t("Guardando…", "Saving…") : t("Guardar recorte", "Save clipping")}<span className="sr-only"> ({x.rotulo})</span>
                    </button>
                    <button type="button" className={BOTAO_LINHA} onMouseDown={(e) => e.preventDefault()} disabled={!!ocupado} onClick={(e) => void agir(e.currentTarget, x, "inserir")}>
                      {t("Inserir", "Insert")}<span className="sr-only"> ({x.rotulo})</span>
                    </button>
                  </>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
    </>
  );
}

// ── acervo do veículo ─────────────────────────────────────────────────────────────────────────────────────────────

function Acervo({ m }: { m: Ctx }) {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const q = useEspera(juntarEspacos(busca));
  const [feito, setFeito] = useState<{ id: string; existia: boolean } | null>(null);
  const chave = [m.tenantId, "acervo", m.textoId] as const;
  // Só carrega quando a parte abre (o painel monta na primeira abertura).
  const r = useQuery({
    queryKey: [...chave, q], placeholderData: keepPreviousData,
    queryFn: () => ler(api.t[":tenantId"].textos.acervo.$get({ param: { tenantId: m.tenantId }, query: { q, menos: m.textoId } })),
  });
  const trazer = useMutation({
    mutationFn: (b: { tipo: "link" | "documento" | "gravacao" | "recorte"; id: string }) => ler(rota.acervo.trazer.$post({ param: { tenantId: m.tenantId, id: m.textoId } }, corpoJson(b))),
    onSuccess: (d, b) => {
      const { trazido, recortes, ...estado } = d;
      m.acoes.aoFonte(estado as EstadoMesa);
      qc.setQueryData(chaveRecortes(m.tenantId, m.textoId), { recortes });
      void qc.invalidateQueries({ queryKey: chave });
      setFeito({ id: b.id, existia: trazido.existia });
    },
  });
  const dono = (x: { texto: { titulo: string }; em: string }) => t(`de “${x.texto.titulo}” · ${quando(x.em)}`, `from “${x.texto.titulo}” · ${quando(x.em)}`);
  const botaoTrazer = (tipo: "link" | "documento" | "gravacao" | "recorte", id: string, jaNoTexto: boolean, rotulo: string, nome: string) => {
    if (feito?.id === id) return <p role="status" className="mono m-0 text-verde">{feito.existia ? t("já estava neste texto", "already in this text") : tipo === "recorte" ? t("trazido para os recortes", "brought to the clippings") : t("trazido: está nas fontes deste texto", "brought: it's in this text's sources")}</p>;
    if (jaNoTexto) return <p className="mono m-0 text-apoio">{t("já está neste texto", "already in this text")}</p>;
    if (!m.podeEditar) return null;
    return (
      <button type="button" className="btn-sec min-h-11 justify-self-start bg-papel-2 px-3 text-[14px]" disabled={trazer.isPending} onClick={() => trazer.mutate({ tipo, id })}>
        {trazer.isPending && trazer.variables?.id === id ? t("Trazendo…", "Bringing…") : rotulo}<span className="sr-only">: {nome}</span>
      </button>
    );
  };
  return (
    <div className="grid gap-3">
      <p className="ajuda m-0">{t("As fontes e os recortes guardados nos outros textos do veículo. Trazer copia o que já foi lido, sem ler, processar ou transcrever de novo.", "Sources and saved clippings from the outlet's other texts. Bringing copies what was already read, without reading, processing or transcribing again.")}</p>
      <label className="campo">
        <span className="text-[14px]!">{t("Procurar no acervo", "Search the archive")}</span>
        <input type="search" className="entrada bg-branco" value={busca} autoComplete="off" spellCheck={false} onChange={(e) => setBusca(e.target.value)} />
      </label>
      {r.isPending ? <p role="status" className="mono m-0 text-apoio">{t("carregando…", "loading…")}</p>
        : r.isError ? <p role="alert" className="faixa-erro m-0">{mensagem(r.error)} <button type="button" className="link-acao border-0 bg-transparent p-0" onClick={() => r.refetch()}>{t("Tentar de novo", "Try again")}</button></p>
          : (
            <div aria-busy={r.isFetching} className="grid gap-4">
              {trazer.isError && <p role="alert" className="faixa-erro m-0">{mensagem(trazer.error)}</p>}
              {r.data.cortado && <p className="faixa-aviso m-0 text-[14px]">{t("O acervo mostra os 100 mais recentes. Procure para achar o resto.", "The archive shows the 100 most recent. Search to find the rest.")}</p>}
              {!r.data.fontes.length && !r.data.recortes.length && (
                <p className="m-0 text-apoio">{q ? t("Nada no acervo com essas palavras.", "Nothing in the archive with those words.") : t("O acervo está vazio. As fontes dos outros textos aparecem aqui, e os recortes que alguém guardar no acervo.", "The archive is empty. Sources from other texts show up here, and the clippings someone keeps in the archive.")}</p>
              )}
              {r.data.fontes.length > 0 && (
                <section aria-labelledby="acervo-fontes-t" className="grid gap-2">
                  <h4 id="acervo-fontes-t" className="mono m-0 text-[12px] font-normal tracking-[.08em] text-apoio uppercase">{t("Fontes", "Sources")} · {r.data.fontes.length}</h4>
                  <ul className="m-0 grid list-none gap-2 p-0">
                    {r.data.fontes.map((f) => (
                      <li key={`${f.tipo}:${f.id}`} className="grid gap-1 rounded-card bg-branco px-3 py-2.5 shadow-curta">
                        <b className="text-[15px] leading-snug break-words text-texto-forte">{f.nome}</b>
                        <span className="mono text-apoio">
                          {f.tipo === "link" && f.url ? new URL(f.url).hostname : f.tipo === "documento" ? (f.paginas === 1 ? t("PDF · 1 página", "PDF · 1 page") : t(`PDF · ${f.paginas ?? 0} páginas`, `PDF · ${f.paginas ?? 0} pages`)) : t(`gravação · ${mmss(f.duracao ?? 0)}`, `recording · ${mmss(f.duracao ?? 0)}`)}
                          {f.textos > 1 ? t(` · em ${f.textos} textos`, ` · in ${f.textos} texts`) : ""}
                        </span>
                        <span className="mono text-apoio">{dono(f)}</span>
                        {botaoTrazer(f.tipo, f.id, f.jaNoTexto, t("Trazer para este texto", "Bring to this text"), f.nome)}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {r.data.recortes.length > 0 && (
                <section aria-labelledby="acervo-recortes-t" className="grid gap-2">
                  <h4 id="acervo-recortes-t" className="mono m-0 text-[12px] font-normal tracking-[.08em] text-apoio uppercase">{t("Recortes", "Clippings")} · {r.data.recortes.length}</h4>
                  <ul className="m-0 grid list-none gap-2 p-0">
                    {r.data.recortes.map((x) => (
                      <li key={x.id} className="rounded-card bg-branco shadow-curta">
                        <div className="grid gap-1.5 px-3 pt-3 pb-2.5">
                          <p className="m-0 line-clamp-4 text-[15px] leading-[1.5] text-texto-forte">{x.origem === "nota" ? x.trecho : `“${x.trecho}”`}</p>
                          <p className="mono m-0 text-apoio">{origemDe(x)}</p>
                          {x.nota && <p className="m-0 border-l-2 border-fio-forte pl-2 text-[14px] text-texto">{x.nota}</p>}
                        </div>
                        <div className="grid gap-1 border-t border-dashed border-fio-forte px-3 py-2">
                          <span className="mono text-apoio">{dono(x)}</span>
                          {botaoTrazer("recorte", x.id, x.jaNoTexto, t("Trazer", "Bring"), inicioDe(x.trecho))}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
    </div>
  );
}
