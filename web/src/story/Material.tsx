// Material on the side (DESIGN.md §13): the editor's source organiser. It brings into one place the text's clippings,
// the dossier's sources (links, replies, LAI), the PDFs, the recordings and the outlet's library, with a single search
// and a reader alongside. On desktop it is a column to the left of the sheet; on mobile, the bottom sheet. Save and
// insert apply to the selected passage or to the whole paragraph, and the buttons do not take focus: the source
// selection and the text cursor stay where they were. No model: the clipping is literal (the server checks it) and
// inserting puts the passage as it is, with the citation note when the source is citable. The component is memoised,
// receives only stable props and does not read the live document: typing in the editor does not redraw it ("in the
// text" comes from the saved text).
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { JSONContent } from "@tiptap/react";
import { NOTE_MAX, PASSAGE_MAX, PASSAGE_MIN, MIN_DOCUMENT_PASSAGE, double, joinSpaces, inText, termsSearch, inSourcePassage } from "../../../src/lib/clipping";
import { api, bodyJson, read, type Success } from "../api";
import { IconClose, IconBack } from "../shell/icons";
import { when } from "../queue";
import { t } from "../language";
import { Part, usePart } from "../kit/Parts";
import { FormLink, noteLabel } from "./Assistant";
import { ButtonPdf, useSendPdf } from "./Documents";
import { AudioButton, PlayPassage, mmss, useSendAudio } from "./Recordings";
import { message, evidenceName, qty, route, type DeskState, type Evidence } from "./common";

type Clipping = Success<Awaited<ReturnType<typeof route.recortes.$get>>>["recortes"][number];
type Search = Success<Awaited<ReturnType<typeof route.material.busca.$get>>>;
type Found = Search["grupos"][number]["achados"][number];
type SourceType = "evidencia" | "documento" | "gravacao";
/** Where the reader opens: the paragraph (evidence), the page (PDF), the second (recording) or a clipping's passage. */
type Target = { paragrafo?: number; pagina?: number; inicio?: number; trecho?: string };
/** What can go into the document: a source's passage (with the note when it is citable) or the person's note. */
type Passage = { origem: Clipping["origem"]; evidenciaId?: string | null; arquivoId?: string | null; pagina?: number | null; trecho: string };

/** Bridges to the editor, stable across StoryText's renders (which renders on every key). */
export type ActionsMaterial = {
  /** Puts the content where the cursor was (on mobile, closes the sheet first). */
  inserir: (content: JSONContent[]) => void;
  atualizar: (d: DeskState) => void;
  /** A new source in the dossier: stores the state and re-checks the paragraphs it may resolve. */
  aoFonte: (d: DeskState) => void;
  fechar: () => void;
};

type Props = { tenantId: string; textoId: string; estado: DeskState; podeEditar: boolean; folha: boolean; acoes: ActionsMaterial };
type Ctx = Omit<Props, "folha"> & {
  abrirFonte: (type: SourceType, id: string, target?: Target | null) => void;
  /** Inserts or only cites. A failure (network, a PDF that did not become evidence) goes up for the caller to show. */
  inserirTrecho: (x: Passage, onlyCite?: boolean) => Promise<void>;
  guardar: (x: Passage) => Promise<{ existia: boolean }>;
};

export const clippingsKey = (tenantId: string, textId: string) => [tenantId, "recortes", textId] as const;
const wordsSpeech = (s: string) => (s.match(/[\p{L}\p{N}]+/gu) ?? []).length;
/** The check only ties a quote of 3 words or more to the recording (`findInRecording`): a shorter one would become "unsourced quote". */
const SPEECH_MIN = 3;

function useWait<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const id = window.setTimeout(() => setV(value), ms); return () => window.clearTimeout(id); }, [value, ms]);
  return v;
}

const readSource = (s: string | null): { tipo: SourceType; id: string } | null => {
  const m = s?.match(/^(evidencia|documento|gravacao):(.+)$/);
  return m ? { tipo: m[1] as SourceType, id: m[2] } : null;
};

function Material({ tenantId, textoId: textId, estado: state, podeEditar: canEdit, folha: sheet, acoes: actions }: Props) {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const source = readSource(params.get("fonte"));
  const [target, setTarget] = useState<Target | null>(null);
  const [search, setSearch] = useState("");
  const q = useWait(joinSpaces(search));
  const searching = termsSearch(q).length > 0;
  const root = useRef<HTMLElement>(null);
  const focusReader = useRef(false);
  const clippings = useQuery({ queryKey: clippingsKey(tenantId, textId), queryFn: () => read(route.recortes.$get({ param: { tenantId, id: textId } })) });
  const change = (f: (p: URLSearchParams) => void) => setParams((p) => { f(p); return p; }, { replace: true, preventScrollReset: true });
  // Opens on Clippings if there are any, otherwise on Sources: decided on arrival, so the part does not switch under whoever is in it.
  const fallback = useRef<string | null>(null);
  if (fallback.current === null && !clippings.isPending) fallback.current = clippings.data?.recortes.length ? "recortes" : "fontes";
  const [segment, openPart] = usePart("material-parte", fallback.current);

  const ctx: Ctx = {
    tenantId, textoId: textId, estado: state, podeEditar: canEdit, acoes: actions,
    abrirFonte: (type, id, a = null) => {
      focusReader.current = true;
      setTarget(a);
      change((p) => p.set("fonte", `${type}:${id}`));
    },
    async inserirTrecho(x, onlyCite = false) {
      if (x.origem === "nota") { actions.inserir([{ type: "text", text: x.trecho }]); return; }
      if (x.origem === "gravacao") {
        if (wordsSpeech(x.trecho) < SPEECH_MIN) throw new Error(t("Fala curta demais: selecione pelo menos 3 palavras, ou a conferência não acha a aspa na gravação.", "Speech too short: select at least 3 words, or the check can't find the quote in the recording."));
        actions.inserir([{ type: "text", text: `“${x.trecho}” ` }]);
        return;
      }
      let ev: Evidence | undefined;
      if (x.origem === "evidencia") ev = state.evidencias.find((e) => e.id === x.evidenciaId);
      else if (x.arquivoId && state.documentos.some((d) => d.id === x.arquivoId)) {
        // The PDF passage becomes evidence through the usual route (the whole page), and from then on it behaves like a link.
        const r = await read(route.documentos[":arquivo"].evidencia.$post({ param: { tenantId, id: textId, arquivo: x.arquivoId } }, bodyJson({ pagina: x.pagina, trecho: x.trecho })));
        const { evidenciaId: evidenceId, existia: _existed, ...created } = r;
        actions.atualizar(created as DeskState);
        ev = created.evidencias.find((e) => e.id === evidenceId);
      }
      // Without the source in the dossier (it left), the text goes in without a citation: the check will say the quote is unsourced.
      const note: JSONContent[] = ev ? [{ type: "nota", attrs: { rotulo: noteLabel(ev), evidencia: ev.id } }, { type: "text", text: " " }] : [];
      if (onlyCite) { if (note.length) actions.inserir(note); return; }
      actions.inserir([{ type: "text", text: `“${x.trecho}” ` }, ...note]);
    },
    async guardar(x) {
      const body = x.origem === "evidencia" ? { origem: x.origem, evidenciaId: x.evidenciaId, trecho: x.trecho }
        : x.origem === "documento" ? { origem: x.origem, arquivoId: x.arquivoId, pagina: x.pagina, trecho: x.trecho }
          : x.origem === "gravacao" ? { origem: x.origem, arquivoId: x.arquivoId, trecho: x.trecho } : { origem: "nota", trecho: x.trecho };
      const r = await read(route.recortes.$post({ param: { tenantId, id: textId } }, bodyJson(body)));
      qc.setQueryData(clippingsKey(tenantId, textId), { recortes: r.recortes });
      return { existia: r.existia };
    },
  };

  const back = () => {
    setTarget(null);
    change((p) => p.delete("fonte"));
    window.setTimeout(() => root.current?.focus({ preventScroll: true }), 0);
  };
  /** A hit in a clipping: opens the Clippings part and goes to the card. */
  function goToClipping(id: string) {
    setSearch("");
    openPart("recortes");
    window.setTimeout(() => {
      const el = document.getElementById(`recorte-${id}`);
      if (el) centerInMaterial(el);
      el?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
    }, 60);
  }

  const list = clippings.data?.recortes ?? [];
  const links = state.evidencias.filter((e) => e.origem !== "documento");
  const changed = links.filter((e) => e.mudouEm).length;
  const inArchive = list.filter((r) => r.acervo).length;
  const readingPdf = state.documentos.filter((d) => d.estado === "lendo").length;
  const transcribing = state.gravacoes.filter((g) => g.estado === "lendo").length;
  const part = (id: string, label: string, summary: string, content: ReactNode, tone?: "aviso") => (
    <Part id={`material-${id}`} nivel="h3" rotulo={label} resumo={summary} tom={tone} aberta={segment === id} alternar={() => openPart(segment === id ? null : id)}>{content}</Part>
  );

  let body: ReactNode;
  if (source) body = <Reader key={`${source.tipo}:${source.id}`} m={ctx} tipo={source.tipo} id={source.id} alvo={target} voltar={back} focar={focusReader} />;
  else if (searching) body = <Results m={ctx} q={q} irParaRecorte={goToClipping} />;
  else if (clippings.isPending) body = <p role="status" className="mono m-0 text-apoio">{t("carregando…", "loading…")}</p>;
  else {
    body = (
      <div>
        {clippings.isError && <p role="alert" className="faixa-erro m-0 mb-2">{t("Os recortes não carregaram.", "The clippings didn't load.")} <button type="button" className="link-acao border-0 bg-transparent p-0" onClick={() => clippings.refetch()}>{t("Tentar de novo", "Try again")}</button></p>}
        {part("recortes", t("Recortes", "Clippings"),
          list.length ? `${t(qty(list.length, "recorte", "recortes"), qty(list.length, "clipping", "clippings"))}${inArchive ? t(` · ${inArchive} no acervo`, ` · ${inArchive} in the archive`) : ""}` : t("nenhum recorte", "no clippings"),
          <Clippings m={ctx} lista={list} />)}
        {part("fontes", t("Fontes", "Sources"),
          changed ? `${t(changed === 1 ? "1 fonte mudou" : `${changed} fontes mudaram`, changed === 1 ? "1 source changed" : `${changed} sources changed`)} · ${t(qty(links.length, "fonte", "fontes"), qty(links.length, "source", "sources"))}`
            : links.length ? t(qty(links.length, "fonte", "fontes"), qty(links.length, "source", "sources")) : t("nenhuma fonte", "no sources"),
          <Sources m={ctx} links={links} />, changed ? "aviso" : undefined)}
        {part("documentos", t("Documentos", "Documents"),
          state.documentos.length ? `${t(qty(state.documentos.length, "PDF", "PDFs"), qty(state.documentos.length, "PDF", "PDFs"))}${readingPdf ? t(` · ${readingPdf} sendo lido${readingPdf > 1 ? "s" : ""}`, ` · ${readingPdf} being read`) : ""}` : t("nenhum PDF", "no PDFs"),
          <Documents m={ctx} />)}
        {part("gravacoes", t("Gravações", "Recordings"),
          state.gravacoes.length ? `${t(qty(state.gravacoes.length, "gravação", "gravações"), qty(state.gravacoes.length, "recording", "recordings"))}${transcribing ? t(` · ${transcribing} transcrevendo`, ` · ${transcribing} transcribing`) : ""}` : t("nenhuma gravação", "no recordings"),
          <Recordings m={ctx} />)}
        {part("acervo", t("Acervo do veículo", "Publication archive"), t("outros textos", "other texts"), <Archive m={ctx} />)}
      </div>
    );
  }

  return (
    <section ref={root} tabIndex={-1} data-material aria-labelledby={sheet ? undefined : "material-t"} aria-label={sheet ? t("Material", "Material") : undefined} className="grid grid-cols-[minmax(0,1fr)] content-start gap-1 outline-none">
      {/* The head stays pinned at the top of the column: search stays at hand while the list or the reader scroll. */}
      <div className={`sticky top-0 z-10 grid gap-2 bg-papel pb-3 ${sheet ? "-mx-5 px-5" : "pt-1 shadow-[0_1px_0_var(--color-fio)]"}`}>
        {!sheet && (
          <div className="flex items-center gap-2">
            <h2 id="material-t" className="mono m-0 text-[12px] font-normal tracking-[.08em] text-apoio uppercase">{t("Material", "Material")}</h2>
            <button type="button" onClick={actions.fechar} aria-label={t("Fechar o material", "Close the material")} title={t("Fechar o material", "Close the material")}
              className="-mr-2 ml-auto grid size-11 cursor-pointer place-items-center rounded-btn border-0 bg-transparent text-apoio hover:bg-papel-2 hover:text-texto-forte">
              <IconClose className="size-5" />
            </button>
          </div>
        )}
        <label className="grid gap-1">
          <span className="sr-only">{t("Procurar no material", "Search the material")}</span>
          <input id="material-busca" type="search" className="entrada bg-branco" value={search} placeholder={t("Procurar no material", "Search the material")} autoComplete="off" spellCheck={false}
            onChange={(e) => { setSearch(e.target.value); if (source) { setTarget(null); change((p) => p.delete("fonte")); } }} />
        </label>
      </div>
      {body}
    </section>
  );
}

const MaterialMemo = memo(Material);
MaterialMemo.displayName = "Material";
export default MaterialMemo;

// ── recortes ──────────────────────────────────────────────────────────────────────────────────────────────────────

const ORIGIN_LABEL: Record<Clipping["origem"], () => string> = {
  evidencia: () => t("fonte", "source"), documento: () => t("PDF", "PDF"), gravacao: () => t("gravação", "recording"), nota: () => t("anotação", "note"),
};
/** "Balanço de obras", "relatorio.pdf · p. 3", "entrevista.wav · 01:12" or "note". */
const originOf = (r: { origem: Clipping["origem"]; fonte: { nome: string | null }; pagina: number | null; inicio: number | null }) =>
  r.origem === "nota" ? ORIGIN_LABEL.nota()
    : [r.fonte.nome ?? ORIGIN_LABEL[r.origem](), r.pagina !== null ? t(`p. ${r.pagina}`, `p. ${r.pagina}`) : null, r.inicio !== null ? mmss(r.inicio) : null].filter(Boolean).join(" · ");
const home = (s: string) => { const p = s.split(/\s+/); return p.length > 6 ? `${p.slice(0, 6).join(" ")}…` : s; };

function Clippings({ m, lista: list }: { m: Ctx; lista: Clipping[] }) {
  // The saved text, not the live document: "in the text" changes when the text saves, never on every key.
  const saved = useMemo(() => m.estado.texto.paragrafos.map((p) => p.texto), [m.estado.texto.paragrafos]);
  return (
    <div className="grid gap-4">
      {list.length ? (
        <ul aria-label={t("Recortes", "Clippings")} className="m-0 grid list-none gap-3 p-0">
          {list.map((r, i) => <CardClipping key={r.id} m={m} r={r} primeiro={i === 0} ultimo={i === list.length - 1} jaNoTexto={inText(r.trecho, saved)} />)}
        </ul>
      ) : (
        <p className="m-0 text-apoio">
          {m.podeEditar
            ? t("Nenhum recorte ainda. Abra uma fonte, selecione o trecho e guarde; ou escreva uma anotação aqui embaixo.", "No clippings yet. Open a source, select the passage and save it; or write a note below.")
            : t("Nenhum recorte neste texto.", "No clippings in this text.")}
        </p>
      )}
      {m.podeEditar && <NewNote m={m} />}
    </div>
  );
}

const ArrowTop = () => <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4"><path d="m6 15 6-6 6 6" /></svg>;
const ArrowLow = () => <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4"><path d="m6 9 6 6 6-6" /></svg>;
const LINE_BUTTON = "inline-flex min-h-11 cursor-pointer items-center rounded-btn border-0 bg-transparent px-2 text-[14px] font-bold text-texto-forte hover:bg-papel-2 disabled:cursor-not-allowed disabled:opacity-55";

/** The clipping: the passage in quotes, the origin in mono, the note and the actions, below the cut line. */
function CardClipping({ m, r, primeiro: first, ultimo: last, jaNoTexto: alreadyInText }: { m: Ctx; r: Clipping; primeiro: boolean; ultimo: boolean; jaNoTexto: boolean }) {
  const qc = useQueryClient();
  const param = { tenantId: m.tenantId, id: m.textoId, recorte: r.id };
  const apply = (d: { recortes: Clipping[] }) => qc.setQueryData(clippingsKey(m.tenantId, m.textoId), d);
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState(r.nota ?? "");
  const change = useMutation({
    mutationFn: (body: Record<string, unknown>) => read(route.recortes[":recorte"].$patch({ param }, bodyJson(body))),
    onSuccess: (d) => { apply(d); setNoting(false); },
  });
  const remove = useMutation({ mutationFn: () => read(route.recortes[":recorte"].$delete({ param })), onSuccess: apply });
  const insert = useMutation({ mutationFn: (onlyCite: boolean) => m.inserirTrecho(r, onlyCite) });
  const busy = change.isPending || remove.isPending || insert.isPending;
  const error = change.error ?? remove.error ?? insert.error;
  const citable = (r.origem === "evidencia" || r.origem === "documento") && r.fonteExiste;
  const shortSpeech = r.origem === "gravacao" && wordsSpeech(r.trecho) < SPEECH_MIN;
  const name = home(r.trecho);
  const openInSource = () => {
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
            {originOf(r)}
            {alreadyInText && <span className="text-texto"> · {t("no texto", "in the text")}</span>}
            {/* Whoever edits sees the state on the button (aria-pressed); whoever only reads, here. */}
            {r.acervo && !m.podeEditar && <span> · {t("no acervo", "in the archive")}</span>}
          </p>
          {!r.fonteExiste && <p className="mono m-0 text-ambar">{t("a fonte saiu do dossiê: dá para inserir o trecho, não para citar", "the source left the dossier: you can insert the passage, not cite it")}</p>}
          {noting ? (
            <form className="grid gap-2 pt-1" onSubmit={(e) => { e.preventDefault(); change.mutate({ nota: note.trim() || null }); }}>
              <label className="campo">
                <span className="text-[14px]!">{t("Anotação sobre o recorte", "Note on the clipping")}</span>
                <textarea className="entrada min-h-[72px] resize-y bg-papel" value={note} maxLength={NOTE_MAX} autoFocus onChange={(e) => setNote(e.target.value)} />
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="submit" className="btn-sec bg-papel-2" disabled={change.isPending}>{change.isPending ? t("Guardando…", "Saving…") : t("Guardar", "Save")}</button>
                <button type="button" className="btn-sec" onClick={() => { setNoting(false); setNote(r.nota ?? ""); change.reset(); }}>{t("Cancelar", "Cancel")}</button>
              </div>
            </form>
          ) : r.nota && <p className="m-0 border-l-2 border-fio-forte pl-2 text-[14px] text-texto">{r.nota}</p>}
        </div>
        {/* Up and down, stacked beside the passage: the order belongs to the clipping, not to an action on it. */}
        {m.podeEditar && (
          <div className="-mt-2 grid content-start">
            <button type="button" className={`${LINE_BUTTON} w-11 justify-center px-0 text-apoio`} aria-label={t(`Subir: ${name}`, `Move up: ${name}`)} title={t("Subir", "Move up")} disabled={busy || first} onClick={() => change.mutate({ mover: "cima" })}><ArrowTop /></button>
            <button type="button" className={`${LINE_BUTTON} w-11 justify-center px-0 text-apoio`} aria-label={t(`Descer: ${name}`, `Move down: ${name}`)} title={t("Descer", "Move down")} disabled={busy || last} onClick={() => change.mutate({ mover: "baixo" })}><ArrowLow /></button>
          </div>
        )}
      </div>
      {/* The cut line: what is above is the clipping; below, what is done with it. */}
      {(m.podeEditar || (r.origem !== "nota" && r.fonteExiste)) && (
      <div className="grid gap-0.5 border-t border-dashed border-fio-forte px-1.5 py-1">
        <div className="flex flex-wrap items-center gap-1">
          {/* The buttons do not take focus on press: the text's cursor and selection stay where they were. */}
          {m.podeEditar && (
            <button type="button" className="btn-sec min-h-11 bg-papel-2 px-3 text-[14px]" onMouseDown={(e) => e.preventDefault()} disabled={busy || shortSpeech} onClick={() => insert.mutate(false)}>
              {t("Inserir", "Insert")}<span className="sr-only">: {name}</span>
            </button>
          )}
          {m.podeEditar && citable && (
            <button type="button" className={LINE_BUTTON} onMouseDown={(e) => e.preventDefault()} disabled={busy} onClick={() => insert.mutate(true)}>
              {t("Só citar", "Cite only")}<span className="sr-only">: {name}</span>
            </button>
          )}
          {r.origem !== "nota" && r.fonteExiste && <button type="button" className={LINE_BUTTON} onClick={openInSource}>{t("Abrir na fonte", "Open in source")}<span className="sr-only">: {name}</span></button>}
        </div>
        {m.podeEditar && (
          <div className="flex flex-wrap items-center">
            {!noting && <button type="button" className={`${LINE_BUTTON} font-normal`} onClick={() => { setNote(r.nota ?? ""); setNoting(true); }}>{r.nota ? t("Editar a anotação", "Edit the note") : t("Anotar", "Add a note")}<span className="sr-only">: {name}</span></button>}
            {r.compartilhavel && (
              <button type="button" className={`${LINE_BUTTON} font-normal`} aria-pressed={r.acervo} disabled={busy} onClick={() => change.mutate({ acervo: !r.acervo })}>
                {r.acervo ? t("No acervo", "In the archive") : t("Guardar no acervo", "Keep in the archive")}<span className="sr-only">: {name}</span>
              </button>
            )}
            <button type="button" className={`${LINE_BUTTON} font-normal`} disabled={busy} onClick={() => remove.mutate()}>{t("Tirar", "Remove")}<span className="sr-only">: {name}</span></button>
          </div>
        )}
        {shortSpeech && m.podeEditar && <p className="mono m-0 px-1.5 pb-1 text-apoio">{t("fala de menos de 3 palavras: a conferência não a acha na gravação", "speech under 3 words: the check can't find it in the recording")}</p>}
        {error && <p role="alert" className="faixa-erro m-1 text-[14px]">{error instanceof Error && !("status" in error) ? error.message : message(error)}</p>}
      </div>
      )}
    </li>
  );
}

/** The person's note: their text, unchecked and uncited. */
function NewNote({ m }: { m: Ctx }) {
  const [text, setText] = useState("");
  const save = useMutation({ mutationFn: () => m.guardar({ origem: "nota", trecho: text.trim() }), onSuccess: () => setText("") });
  const short = joinSpaces(text).length < PASSAGE_MIN;
  return (
    <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); if (!short) save.mutate(); }}>
      <div className="campo">
        <label htmlFor="material-anotacao" className="text-[15px] font-bold text-texto-forte">{t("Anotação", "Note")}</label>
        <textarea id="material-anotacao" className="entrada min-h-[72px] resize-y bg-branco" value={text} maxLength={PASSAGE_MAX} onChange={(e) => { setText(e.target.value); save.reset(); }}
          aria-describedby="material-anotacao-ajuda" />
        <span id="material-anotacao-ajuda" className="ajuda">{t("Um número, uma pergunta, um nome para procurar. Inserir põe o texto como está, sem aspas.", "A number, a question, a name to look up. Insert puts the text as it is, without quotes.")}</span>
      </div>
      {save.isError && <p role="alert" className="faixa-erro m-0">{message(save.error)}</p>}
      <button type="submit" className="btn-sec justify-self-start bg-papel-2" disabled={save.isPending || short}>{save.isPending ? t("Guardando…", "Saving…") : t("Guardar a anotação", "Save the note")}</button>
    </form>
  );
}

// ── sources, documents, recordings ────────────────────────────────────────────────────────────────────────────────

const CARD_SOURCE = "grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5 rounded-card border-0 bg-branco px-3 py-2.5 text-left font-[inherit] shadow-curta transition-shadow hover:shadow-eleva disabled:cursor-default disabled:hover:shadow-curta";
const ArrowRead = () => <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="row-span-2 size-4 text-apoio"><path d="m9 6 6 6-6 6" /></svg>;

function Sources({ m, links }: { m: Ctx; links: Evidence[] }) {
  const [adding, setAdding] = useState(false);
  const used = (id: string) => m.estado.afirmacoes.filter((a) => (a.apuracao?.tipo === "fonte" ? a.apuracao.evidenciaId === id : !a.apuracao && a.estado === "com_evidencia" && a.evidenciaId === id)).length;
  return (
    <div className="grid gap-3">
      {links.length ? (
        <ul className="m-0 grid list-none gap-2 p-0">
          {links.map((e) => {
            const n = used(e.id);
            return (
              <li key={e.id}>
                <button type="button" className={CARD_SOURCE} onClick={() => m.abrirFonte("evidencia", e.id)}>
                  <b className="min-w-0 text-[15px] leading-snug text-texto-forte">{evidenceName(e)}</b>
                  <ArrowRead />
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
      {m.podeEditar && (adding
        ? <FormLink tenantId={m.tenantId} textoId={m.textoId} rotulo={t("Link para o dossiê", "Link for the dossier")} cancelar={() => setAdding(false)} aoAdicionar={(d) => { setAdding(false); m.acoes.aoFonte(d); }} />
        : <button type="button" className="btn-sec justify-self-start bg-papel-2" onClick={() => setAdding(true)}>{t("Acrescentar link", "Add link")}</button>)}
    </div>
  );
}

function Documents({ m }: { m: Ctx }) {
  const send = useSendPdf(m.tenantId, m.textoId, m.acoes.atualizar);
  return (
    <div className="grid gap-3">
      {m.estado.documentos.length ? (
        <ul className="m-0 grid list-none gap-2 p-0">
          {m.estado.documentos.map((d) => (
            <li key={d.id}>
              <button type="button" className={CARD_SOURCE} disabled={d.estado !== "pronto"} onClick={() => m.abrirFonte("documento", d.id)}>
                <b className="min-w-0 text-[15px] leading-snug break-words text-texto-forte">{d.nome}</b>
                {d.estado === "pronto" ? <ArrowRead /> : <span />}
                <span className={`mono min-w-0 ${d.estado === "falhou" ? "text-terracota" : "text-apoio"}`}>
                  {d.estado === "lendo" ? t("lendo o PDF…", "reading the PDF…") : d.estado === "falhou" ? t("não deu para ler este PDF", "this PDF couldn't be read") : d.paginas === 1 ? t("1 página", "1 page") : t(`${d.paginas} páginas`, `${d.paginas} pages`)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="m-0 text-apoio">{t("Nenhum PDF neste texto. Envie o relatório, o contrato ou o processo: cada página fica para ler e recortar.", "No PDFs in this text. Upload the report, contract or court record: every page is ready to read and clip.")}</p>}
      {m.podeEditar && <ButtonPdf enviar={send} />}
      {send.isError && <p role="alert" className="faixa-erro m-0">{message(send.error)}</p>}
    </div>
  );
}

function Recordings({ m }: { m: Ctx }) {
  const send = useSendAudio(m.tenantId, m.textoId, m.acoes.atualizar);
  return (
    <div className="grid gap-3">
      {m.estado.gravacoes.length ? (
        <ul className="m-0 grid list-none gap-2 p-0">
          {m.estado.gravacoes.map((g) => (
            <li key={g.id}>
              <button type="button" className={CARD_SOURCE} disabled={g.estado !== "pronto"} onClick={() => m.abrirFonte("gravacao", g.id)}>
                <b className="min-w-0 text-[15px] leading-snug break-words text-texto-forte">{g.nome}</b>
                {g.estado === "pronto" ? <ArrowRead /> : <span />}
                <span className={`mono min-w-0 ${g.estado === "falhou" ? "text-terracota" : "text-apoio"}`}>
                  {g.estado === "lendo" ? t("transcrevendo…", "transcribing…") : g.estado === "falhou" ? t("a transcrição falhou", "the transcription failed") : t(`${mmss(g.duracao ?? 0)} de áudio`, `${mmss(g.duracao ?? 0)} of audio`)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="m-0 text-apoio">{t("Nenhuma gravação neste texto. Envie o áudio da entrevista: a fala transcrita fica para ler, recortar e inserir entre aspas.", "No recordings in this text. Upload the interview audio: the transcribed speech is ready to read, clip and insert as a quote.")}</p>}
      {m.podeEditar && <AudioButton enviar={send} />}
      {send.isError && <p role="alert" className="faixa-erro m-0">{message(send.error)}</p>}
    </div>
  );
}

// ── single search ─────────────────────────────────────────────────────────────────────────────────────────────────

/** The passage with painted bands: the search hit (graphite, bold) and what supports a claim (light green). */
function Painted({ texto: text, achados: findings = [], sustenta: supports = [] }: { texto: string; achados?: [number, number][]; sustenta?: [number, number][] }) {
  if (!findings.length && !supports.length) return <>{text}</>;
  const cuts = [...new Set([0, text.length, ...findings.flat(), ...supports.flat()])].filter((x) => x >= 0 && x <= text.length).sort((a, b) => a - b);
  const inside = (fs: [number, number][], i: number) => fs.some(([a, b]) => a <= i && i < b);
  return (
    <>
      {cuts.slice(0, -1).map((from, k) => {
        const until = cuts[k + 1];
        const chunk = text.slice(from, until);
        const v = inside(supports, from), a = inside(findings, from);
        if (!v && !a) return <span key={from}>{chunk}</span>;
        return <mark key={from} className={`px-px text-texto-forte [box-decoration-break:clone] ${v ? "bg-verde-claro" : "bg-papel-3"} ${a ? "font-bold" : ""}`}>{chunk}</mark>;
      })}
    </>
  );
}

/** Where each searched word appears (without accents or case: `dobrar` keeps the length, positions are valid in the original). */
function bandsOf(text: string, terms: string[]): [number, number][] {
  if (!terms.length) return [];
  const plan = double(text);
  const out: [number, number][] = [];
  for (const x of terms) for (let i = plan.indexOf(x); i >= 0; i = plan.indexOf(x, i + x.length)) out.push([i, i + x.length]);
  return out;
}
/**
 * The highlight of what supports a claim, paragraph by paragraph. The passage pointed to may run from one paragraph
 * into the next (the page title and the first sentence, for example): it searches the whole text, with paragraphs joined
 * by a space (as the server joins them), and splits the hit between them.
 */
function highlightsSource(paragraphs: string[], passages: string[]): [number, number][][] {
  const out = paragraphs.map((): [number, number][] => []);
  const starts: number[] = [];
  let after = 0;
  for (const p of paragraphs) { starts.push(after); after += p.length + 1; }
  const all = paragraphs.join(" ");
  for (const raw of new Set(passages)) {
    const x = joinSpaces(raw);
    if (x.length < PASSAGE_MIN) continue;
    for (let a = all.indexOf(x); a >= 0; a = all.indexOf(x, a + x.length)) {
      const b = a + x.length;
      paragraphs.forEach((p, i) => {
        const from = Math.max(a, starts[i]), until = Math.min(b, starts[i] + p.length);
        if (from < until) out[i].push([from - starts[i], until - starts[i]]);
      });
    }
  }
  return out;
}

function Results({ m, q, irParaRecorte: goToClipping }: { m: Ctx; q: string; irParaRecorte: (id: string) => void }) {
  const r = useQuery({
    queryKey: [m.tenantId, "material-busca", m.textoId, q], staleTime: 15_000, placeholderData: keepPreviousData,
    queryFn: () => read(route.material.busca.$get({ param: { tenantId: m.tenantId, id: m.textoId }, query: { q } })),
  });
  if (r.isPending) return <p role="status" className="mono m-0 text-apoio">{t("procurando…", "searching…")}</p>;
  if (r.isError) return <p role="alert" className="faixa-erro m-0">{message(r.error)}</p>;
  const groupLabel = (type: string) => (type === "recortes" ? t("recortes", "clippings") : type === "evidencia" ? t("fonte", "source") : type === "documento" ? "PDF" : t("gravação", "recording"));
  const open = (type: string, id: string | null, a: Found) => {
    if (type === "recortes") { if (a.recorteId) goToClipping(a.recorteId); return; }
    if (!id) return;
    m.abrirFonte(type as SourceType, id, { paragrafo: a.paragrafo, pagina: a.pagina, inicio: a.inicio });
  };
  const where = (a: Found) => (a.pagina !== undefined ? t(`p. ${a.pagina}`, `p. ${a.pagina}`) : a.inicio !== undefined ? mmss(a.inicio) : a.paragrafo !== undefined ? t(`parágrafo ${a.paragrafo + 1}`, `paragraph ${a.paragrafo + 1}`) : "");
  const total = r.data.grupos.reduce((n, g) => n + g.achados.length, 0);
  return (
    // The previous search's list stays in view while the new one arrives, dimmed: the two cannot be confused.
    <div aria-busy={r.isFetching} className={`grid gap-4 pt-2 transition-opacity ${r.isPlaceholderData ? "opacity-55" : ""}`}>
      <p role="status" className="mono m-0 text-apoio">{total ? t(qty(total, "achado", "achados"), qty(total, "match", "matches")) : t("nada achado", "nothing found")}</p>
      {!total && <p className="m-0 text-apoio">{t("Nada com essas palavras no material. A busca procura todas as palavras no mesmo parágrafo, página ou trecho da fala.", "Nothing with those words in the material. The search looks for all the words in the same paragraph, page or stretch of speech.")}</p>}
      {r.data.cortado && <p className="faixa-aviso m-0 text-[14px]">{t("A busca parou no teto e mostra só o começo. Use mais palavras para achar o resto.", "The search hit its limit and shows only the start. Use more words to find the rest.")}</p>}
      {r.data.grupos.map((g) => (
        <section key={`${g.tipo}:${g.id}`} aria-label={`${groupLabel(g.tipo)}: ${g.nome ?? ""}`} className="grid gap-2">
          <h3 className="m-0 grid gap-0.5 text-[15px] leading-snug">
            <span className="mono font-normal text-apoio">{groupLabel(g.tipo)}</span>
            {g.nome && <span className="text-texto-forte">{g.nome}</span>}
          </h3>
          <ul className="m-0 grid list-none gap-2 p-0">
            {g.achados.map((a, i) => (
              <li key={i}>
                <button type="button" className="grid w-full cursor-pointer gap-1 rounded-card border-0 bg-branco px-3 py-2.5 text-left font-[inherit] text-[14px] leading-[1.5] text-texto shadow-curta transition-shadow hover:shadow-eleva" onClick={() => open(g.tipo, g.id, a)}>
                  <span><Painted texto={a.trecho} achados={a.marcas} /></span>
                  {where(a) && <span className="mono text-apoio">{where(a)}</span>}
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

// ── side reader ───────────────────────────────────────────────────────────────────────────────────────────────────

type Warning = { texto: string; erro: boolean } | null;
/** A reader paragraph (or speech passage): the text, the highlights and the actions, which apply to a selection inside it or to all of it. */
type ItemReader = { chave: string; texto: string; rotulo: string; alvo: boolean; grifos: [number, number][]; fonte: Omit<Passage, "trecho">; extra?: ReactNode };

function Reader({ m, tipo: type, id, alvo: target, voltar: back, focar: focusOn }: { m: Ctx; tipo: SourceType; id: string; alvo: Target | null; voltar: () => void; focar: { current: boolean } }) {
  const [search, setSearch] = useState("");
  const terms = termsSearch(search);
  const [warning, setWarning] = useState<Warning>(null);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!focusOn.current) return;
    focusOn.current = false;
    title.current?.focus({ preventScroll: true });
  }, [focusOn]);
  const ev = type === "evidencia" ? m.estado.evidencias.find((e) => e.id === id) : undefined;
  const doc = type === "documento" ? m.estado.documentos.find((d) => d.id === id) : undefined;
  const rec = type === "gravacao" ? m.estado.gravacoes.find((g) => g.id === id) : undefined;
  const name = ev ? evidenceName(ev) : doc?.nome ?? rec?.nome ?? t("Fonte", "Source");
  const urlPdf = `/api/t/${encodeURIComponent(m.tenantId)}/textos/${encodeURIComponent(m.textoId)}/documentos/${encodeURIComponent(id)}/pdf`;
  const original = ev?.origem === "link" ? ev.url : doc ? urlPdf : null;
  const meta = ev ? (ev.origem === "link" ? new URL(ev.url).hostname : ev.origem === "lai" ? t("resposta de LAI", "FOI reply") : ev.origem === "documento" ? t("página de PDF", "PDF page") : t("resposta do outro lado", "reply from the other side"))
    : doc ? (doc.paginas === 1 ? t("PDF · 1 página", "PDF · 1 page") : t(`PDF · ${doc.paginas ?? 0} páginas`, `PDF · ${doc.paginas ?? 0} pages`)) : rec ? t(`gravação · ${mmss(rec.duracao ?? 0)}`, `recording · ${mmss(rec.duracao ?? 0)}`) : "";
  const vanished = type === "evidencia" ? !ev : type === "documento" ? !doc : !rec;
  return (
    <div className="grid gap-3 pt-1">
      <button type="button" className="link-acao inline-flex min-h-11 items-center gap-1 justify-self-start border-0 bg-transparent p-0 text-[15px]" onClick={back}>
        <IconBack className="size-4" /> {t("Voltar ao material", "Back to the material")}
      </button>
      <div className="grid gap-1">
        <h3 ref={title} tabIndex={-1} className="m-0 text-[19px] leading-snug font-bold outline-none">{name}</h3>
        <p className="mono m-0 flex flex-wrap gap-x-2 text-apoio">
          <span>{meta}</span>
          {ev?.mudouEm && <span className="text-ambar">{t("· a fonte mudou desde que você conferiu", "· the source changed since you checked")}</span>}
          {original && <span aria-hidden="true">·</span>}
          {original && <a href={original} target="_blank" rel="noreferrer" className="link-acao font-normal">{ev ? t("abrir o original", "open the original") : t("abrir o PDF", "open the PDF")}</a>}
        </p>
      </div>
      {vanished ? <p className="faixa-aviso m-0">{t("Esta fonte não está mais no texto: saiu do dossiê.", "This source is no longer in the text: it left the dossier.")}</p> : (
        <>
          <label className="grid">
            <span className="sr-only">{t("Procurar nesta fonte", "Search this source")}</span>
            <input type="search" className="entrada min-h-11 bg-papel-2 py-2 text-[15px]" value={search} placeholder={t("Procurar nesta fonte", "Search this source")} autoComplete="off" spellCheck={false} onChange={(e) => setSearch(e.target.value)} />
          </label>
          {m.podeEditar && <p className="ajuda m-0">{t("Selecione um pedaço para guardar ou inserir só ele; sem seleção, vale o parágrafo inteiro.", "Select a part to save or insert only that; with no selection, the whole paragraph counts.")}</p>}
          <p aria-live="polite" className="m-0 empty:hidden">{warning && <span className={warning.erro ? "faixa-erro block" : "mono text-verde"}>{warning.texto}</span>}</p>
          {type === "evidencia" && ev && <EvidenceBody m={m} ev={ev} alvo={target} termos={terms} avisar={setWarning} />}
          {type === "documento" && doc && <DocumentBody m={m} id={id} alvo={target} termos={terms} avisar={setWarning} />}
          {type === "gravacao" && rec && <RecordingBody m={m} id={id} segmentada={!!rec.segmentos} alvo={target} termos={terms} avisar={setWarning} />}
        </>
      )}
    </div>
  );
}

/** The target's paragraph (the search hit, the open clipping) goes to the middle of the column when the text arrives. */
function useScrollOnTarget(ready: boolean) {
  const done = useRef(false);
  useEffect(() => {
    if (!ready || done.current) return;
    done.current = true;
    window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>("[data-material] [data-alvo]");
      if (el) centerInMaterial(el);
    }, 30);
  }, [ready]);
}

/** Centres the element only inside the box that scrolls the Material (the column or the bottom sheet). `scrollIntoView`
 *  would also scroll the page, and the text would move while the source beside it is being read. */
function centerInMaterial(el: HTMLElement) {
  let box = el.parentElement;
  while (box && !(/(auto|scroll)/.test(getComputedStyle(box).overflowY) && box.scrollHeight > box.clientHeight)) box = box.parentElement;
  if (!box) return;
  const r = el.getBoundingClientRect(), c = box.getBoundingClientRect();
  box.scrollTop += r.top - c.top - (c.height - r.height) / 2;
}

const fromPassageIndex = (paragraphs: string[], passage?: string) => {
  if (!passage) return -1;
  const x = joinSpaces(passage);
  const i = paragraphs.findIndex((p) => p.includes(x));
  return i >= 0 ? i : paragraphs.findIndex((p) => p.includes(x.slice(0, 40)));
};

function EvidenceBody({ m, ev, alvo: target, termos: terms, avisar: warn }: { m: Ctx; ev: Evidence; alvo: Target | null; termos: string[]; avisar: (a: Warning) => void }) {
  const q = useQuery({
    queryKey: [m.tenantId, "evidencia-texto", m.textoId, ev.id], staleTime: 60_000,
    queryFn: () => read(route.evidencias[":evidencia"].texto.$get({ param: { tenantId: m.tenantId, id: m.textoId, evidencia: ev.id } })),
  });
  // What already supports a claim in the text: the evidence passage the model (or the person, when attaching the source) pointed to.
  const supports = m.estado.afirmacoes.flatMap((a) => (a.apuracao?.tipo === "fonte" ? (a.apuracao.evidenciaId === ev.id && a.apuracao.evidenciaTrecho ? [a.apuracao.evidenciaTrecho] : [])
    : !a.apuracao && a.estado === "com_evidencia" && a.evidenciaId === ev.id && a.evidenciaTrecho ? [a.evidenciaTrecho] : []));
  useScrollOnTarget(q.isSuccess);
  if (q.isPending) return <Skeleton />;
  if (q.isError) return <p role="alert" className="faixa-erro m-0">{message(q.error)}</p>;
  const ps = q.data.paragrafos;
  const ialvo = target?.paragrafo ?? fromPassageIndex(ps, target?.trecho);
  const highlights = highlightsSource(ps, supports);
  const items: ItemReader[] = ps.map((p, i) => ({
    chave: String(i), texto: p, rotulo: t(`parágrafo ${i + 1}`, `paragraph ${i + 1}`), alvo: i === ialvo, grifos: highlights[i],
    fonte: { origem: "evidencia", evidenciaId: ev.id },
  }));
  if (!items.length) return <p className="m-0 text-apoio">{t("A página guardada desta fonte não tem texto para ler.", "This source's saved page has no text to read.")}</p>;
  return <ReaderList m={m} itens={items} termos={terms} avisar={warn} minimo={PASSAGE_MIN} />;
}

function DocumentBody({ m, id, alvo: target, termos: terms, avisar: warn }: { m: Ctx; id: string; alvo: Target | null; termos: string[]; avisar: (a: Warning) => void }) {
  const start = Math.max(1, target?.pagina ?? 1);
  const q = useInfiniteQuery({
    queryKey: [m.tenantId, "documento-paginas", m.textoId, id, start], initialPageParam: start, staleTime: 60_000,
    queryFn: ({ pageParam }) => read(route.documentos[":arquivo"].paginas.$get({ param: { tenantId: m.tenantId, id: m.textoId, arquivo: id }, query: { de: String(pageParam), ate: undefined } })),
    getNextPageParam: (u) => u.proxima ?? undefined,
  });
  // The page passages that support a claim come from the evidence taken from this PDF (the whole page becomes evidence).
  const supports = m.estado.afirmacoes.flatMap((a) => {
    const evId = a.apuracao?.tipo === "fonte" ? a.apuracao.evidenciaId : !a.apuracao && a.estado === "com_evidencia" ? a.evidenciaId : null;
    const passage = a.apuracao?.tipo === "fonte" ? a.apuracao.evidenciaTrecho : a.evidenciaTrecho;
    return evId && passage && m.estado.evidencias.some((e) => e.id === evId && e.origem === "documento") ? [passage] : [];
  });
  useScrollOnTarget(q.isSuccess);
  if (q.isPending) return <Skeleton />;
  if (q.isError) return <p role="alert" className="faixa-erro m-0">{message(q.error)}</p>;
  const pages = q.data.pages.flatMap((pg) => pg.paginas);
  const total = q.data.pages[0]?.total ?? 0;
  return (
    <div className="grid gap-4">
      {start > 1 && <p className="mono m-0 text-apoio">{t(`a partir da p. ${start} de ${total}`, `from p. ${start} of ${total}`)}</p>}
      {pages.map((pg) => {
        const ialvo = target && pg.pagina === target.pagina ? (target.paragrafo ?? fromPassageIndex(pg.paragrafos, target.trecho)) : -1;
        const highlights = highlightsSource(pg.paragrafos, supports);
        const items: ItemReader[] = pg.paragrafos.map((p, i) => ({
          chave: `${pg.pagina}:${i}`, texto: p, rotulo: t(`p. ${pg.pagina}, parágrafo ${i + 1}`, `p. ${pg.pagina}, paragraph ${i + 1}`), alvo: i === ialvo, grifos: highlights[i],
          fonte: { origem: "documento", arquivoId: id, pagina: pg.pagina },
        }));
        return (
          <section key={pg.pagina} aria-label={t(`Página ${pg.pagina}`, `Page ${pg.pagina}`)} className="grid gap-2">
            <h4 className="secao m-0 font-normal">{t(`p. ${pg.pagina}`, `p. ${pg.pagina}`)}<span className="normal-case">{t(`de ${total}`, `of ${total}`)}</span></h4>
            {items.length ? <ReaderList m={m} itens={items} termos={terms} avisar={warn} minimo={MIN_DOCUMENT_PASSAGE} />
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

function RecordingBody({ m, id, segmentada: segmented, alvo: target, termos: terms, avisar: warn }: { m: Ctx; id: string; segmentada: boolean; alvo: Target | null; termos: string[]; avisar: (a: Warning) => void }) {
  const q = useQuery({
    queryKey: [m.tenantId, "transcricao", id], staleTime: Infinity,
    queryFn: () => read(route.gravacoes[":arquivo"].transcricao.$get({ param: { tenantId: m.tenantId, id: m.textoId, arquivo: id } })),
  });
  // The text's quotes the check tied to this recording: their speech is highlighted in the passage.
  const supports = m.estado.apontamentos.flatMap((p) => (p.tipo === "gravacao" && p.gravacao?.arquivoId === id ? [p.trecho.replace(/^[“"«]\s*|\s*[”"»]$/g, "")] : []));
  useScrollOnTarget(q.isSuccess);
  if (q.isPending) return <Skeleton />;
  if (q.isError) return <p role="alert" className="faixa-erro m-0">{message(q.error)}</p>;
  const passages = q.data.trechos;
  // The speech passage the requested second falls in (the last one that starts before it).
  let ialvo = -1;
  if (target?.inicio !== undefined) passages.forEach((x, i) => { if (x.inicio <= target.inicio! + 0.01) ialvo = i; });
  const texts = passages.map((x) => joinSpaces(x.texto));
  const highlights = highlightsSource(texts, supports);
  const items: ItemReader[] = passages.map((x, i) => ({
    chave: String(x.inicio), texto: texts[i], rotulo: mmss(x.inicio), alvo: i === ialvo, grifos: highlights[i],
    fonte: { origem: "gravacao", arquivoId: id },
    extra: <PlayPassage tenantId={m.tenantId} textoId={m.textoId} g={{ arquivoId: id, inicio: x.inicio, fim: x.fim, segmentada: segmented }} />,
  }));
  if (!items.length) return <p className="m-0 text-apoio">{t("A transcrição veio vazia.", "The transcript came back empty.")}</p>;
  return <ReaderList m={m} itens={items} termos={terms} avisar={warn} minimo={PASSAGE_MIN} fala />;
}

const Skeleton = () => (
  <div aria-busy="true" className="grid gap-2">
    <p role="status" className="sr-only">{t("Carregando a fonte", "Loading the source")}</p>
    {[0, 1, 2].map((i) => <div key={i} className="esqueleto h-16" />)}
  </div>
);

/** The selection counts if it lies wholly inside the paragraph; otherwise, the whole paragraph. */
function passageOf(button: HTMLElement, whole: string) {
  const p = button.closest("li")?.querySelector("[data-trecho]");
  const s = window.getSelection();
  if (!p || !s || s.isCollapsed || !p.contains(s.anchorNode) || !p.contains(s.focusNode)) return { trecho: whole, selecao: false };
  return { trecho: joinSpaces(s.toString()), selecao: true };
}

function ReaderList({ m, itens: items, termos: terms, avisar: warn, minimo: min, fala: speech = false }: { m: Ctx; itens: ItemReader[]; termos: string[]; avisar: (a: Warning) => void; minimo: number; fala?: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  // Search in this source: the paragraphs with all the words remain, as in the single search.
  const seen = terms.length ? items.filter((x) => { const d = double(x.texto); return terms.every((tt) => d.includes(tt)); }) : items;
  async function act(button: HTMLElement, x: ItemReader, action: "guardar" | "inserir") {
    const { trecho: passage } = passageOf(button, x.texto);
    if (passage.length < min) { warn({ erro: true, texto: t(`Selecione pelo menos ${min} caracteres.`, `Select at least ${min} characters.`) }); return; }
    if (action === "guardar" && passage.length > PASSAGE_MAX) { warn({ erro: true, texto: t(`Trecho longo demais: selecione até ${PASSAGE_MAX} caracteres.`, `Passage too long: select up to ${PASSAGE_MAX} characters.`) }); return; }
    // A selection that leaves the paragraph is not accepted by the server: warn before asking.
    if (!inSourcePassage(x.texto, passage)) { warn({ erro: true, texto: t("Selecione dentro de um parágrafo só.", "Select within a single paragraph.") }); return; }
    setBusy(`${x.chave}:${action}`);
    warn(null);
    try {
      if (action === "guardar") {
        const r = await m.guardar({ ...x.fonte, trecho: passage });
        warn({ erro: false, texto: r.existia ? t("Esse trecho já estava nos recortes.", "That passage was already in the clippings.") : t("Guardado nos recortes.", "Saved to the clippings.") });
      } else await m.inserirTrecho({ ...x.fonte, trecho: passage });
    } catch (e) {
      warn({ erro: true, texto: e instanceof Error && !("status" in e) ? e.message : message(e) });
    } finally {
      setBusy(null);
    }
  }
  if (!seen.length) return <p className="m-0 text-apoio">{t("Nada com essas palavras nesta fonte.", "Nothing with those words in this source.")}</p>;
  return (
    <>
      {terms.length > 0 && <p className="mono m-0 text-apoio">{t(`${seen.length} de ${items.length} ${speech ? "trechos" : "parágrafos"}`, `${seen.length} of ${items.length} ${speech ? "stretches" : "paragraphs"}`)}</p>}
      {/* A fonte é lida como a folha do texto: papel branco e liso. */}
      <ol className="m-0 grid list-none gap-0 rounded-card bg-branco px-3 py-1 shadow-curta">
        {seen.map((x) => (
          <li key={x.chave} data-alvo={x.alvo || undefined} className={`grid gap-1 border-t border-fio py-2.5 first:border-t-0 ${x.alvo ? "-mx-2 rounded-card bg-papel-2 px-2" : ""}`}>
            {speech && <span className="mono text-apoio">{x.rotulo}</span>}
            <p data-trecho className="m-0 text-[15px] leading-[1.6] text-texto">
              <Painted texto={x.texto} achados={bandsOf(x.texto, terms)} sustenta={x.grifos} />
            </p>
            {(m.podeEditar || x.extra) && (
              <div className="-ml-2 flex flex-wrap items-center gap-1">
                {x.extra}
                {m.podeEditar && (
                  <>
                    {/* They do not take focus on press: the selection made in the paragraph and the text cursor stay where they were. */}
                    <button type="button" className={LINE_BUTTON} onMouseDown={(e) => e.preventDefault()} disabled={!!busy} onClick={(e) => void act(e.currentTarget, x, "guardar")}>
                      {busy === `${x.chave}:guardar` ? t("Guardando…", "Saving…") : t("Guardar recorte", "Save clipping")}<span className="sr-only"> ({x.rotulo})</span>
                    </button>
                    <button type="button" className={LINE_BUTTON} onMouseDown={(e) => e.preventDefault()} disabled={!!busy} onClick={(e) => void act(e.currentTarget, x, "inserir")}>
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

// ── outlet library ────────────────────────────────────────────────────────────────────────────────────────────────

function Archive({ m }: { m: Ctx }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const q = useWait(joinSpaces(search));
  const [done, setDone] = useState<{ id: string; existia: boolean } | null>(null);
  const key = [m.tenantId, "acervo", m.textoId] as const;
  // Only loads when the part opens (the panel mounts on first open).
  const r = useQuery({
    queryKey: [...key, q], placeholderData: keepPreviousData,
    queryFn: () => read(api.t[":tenantId"].textos.acervo.$get({ param: { tenantId: m.tenantId }, query: { q, menos: m.textoId } })),
  });
  const bring = useMutation({
    mutationFn: (b: { tipo: "link" | "documento" | "gravacao" | "recorte"; id: string }) => read(route.acervo.trazer.$post({ param: { tenantId: m.tenantId, id: m.textoId } }, bodyJson(b))),
    onSuccess: (d, b) => {
      const { trazido: brought, recortes: clippings, ...state } = d;
      m.acoes.aoFonte(state as DeskState);
      qc.setQueryData(clippingsKey(m.tenantId, m.textoId), { recortes: clippings });
      void qc.invalidateQueries({ queryKey: key });
      setDone({ id: b.id, existia: brought.existia });
    },
  });
  const owner = (x: { texto: { titulo: string }; em: string }) => t(`de “${x.texto.titulo}” · ${when(x.em)}`, `from “${x.texto.titulo}” · ${when(x.em)}`);
  const bringButton = (type: "link" | "documento" | "gravacao" | "recorte", id: string, alreadyInText: boolean, label: string, name: string) => {
    if (done?.id === id) return <p role="status" className="mono m-0 text-verde">{done.existia ? t("já estava neste texto", "already in this text") : type === "recorte" ? t("trazido para os recortes", "brought to the clippings") : t("trazido: está nas fontes deste texto", "brought: it's in this text's sources")}</p>;
    if (alreadyInText) return <p className="mono m-0 text-apoio">{t("já está neste texto", "already in this text")}</p>;
    if (!m.podeEditar) return null;
    return (
      <button type="button" className="btn-sec min-h-11 justify-self-start bg-papel-2 px-3 text-[14px]" disabled={bring.isPending} onClick={() => bring.mutate({ tipo: type, id })}>
        {bring.isPending && bring.variables?.id === id ? t("Trazendo…", "Bringing…") : label}<span className="sr-only">: {name}</span>
      </button>
    );
  };
  return (
    <div className="grid gap-3">
      <p className="ajuda m-0">{t("As fontes e os recortes guardados nos outros textos do veículo. Trazer copia o que já foi lido, sem ler, processar ou transcrever de novo.", "Sources and saved clippings from the outlet's other texts. Bringing copies what was already read, without reading, processing or transcribing again.")}</p>
      <label className="campo">
        <span className="text-[14px]!">{t("Procurar no acervo", "Search the archive")}</span>
        <input type="search" className="entrada bg-branco" value={search} autoComplete="off" spellCheck={false} onChange={(e) => setSearch(e.target.value)} />
      </label>
      {r.isPending ? <p role="status" className="mono m-0 text-apoio">{t("carregando…", "loading…")}</p>
        : r.isError ? <p role="alert" className="faixa-erro m-0">{message(r.error)} <button type="button" className="link-acao border-0 bg-transparent p-0" onClick={() => r.refetch()}>{t("Tentar de novo", "Try again")}</button></p>
          : (
            <div aria-busy={r.isFetching} className="grid gap-4">
              {bring.isError && <p role="alert" className="faixa-erro m-0">{message(bring.error)}</p>}
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
                        <span className="mono text-apoio">{owner(f)}</span>
                        {bringButton(f.tipo, f.id, f.jaNoTexto, t("Trazer para este texto", "Bring to this text"), f.nome)}
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
                          <p className="mono m-0 text-apoio">{originOf(x)}</p>
                          {x.nota && <p className="m-0 border-l-2 border-fio-forte pl-2 text-[14px] text-texto">{x.nota}</p>}
                        </div>
                        <div className="grid gap-1 border-t border-dashed border-fio-forte px-3 py-2">
                          <span className="mono text-apoio">{owner(x)}</span>
                          {bringButton("recorte", x.id, x.jaNoTexto, t("Trazer", "Bring"), home(x.trecho))}
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
