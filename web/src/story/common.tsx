// Story pieces used by the tabs: desk state types, messages, the dossier, the mobile bottom sheet and a mark's detail
// (state, explanation, evidence).
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, headerLanguage, bodyJson, ApiError, read, type Success } from "../api";
import { IconClose } from "../shell/icons";
import { when } from "../queue";
import { t } from "../language";
import { IconState, STATE_LABEL, RISK_LABEL, type State } from "../onboarding/deskMarks";

export const route = api.t[":tenantId"].textos[":id"];
export type DeskState = Success<Awaited<ReturnType<typeof route.$get>>>;
export type Claim = DeskState["afirmacoes"][number];
export type Evidence = DeskState["evidencias"][number];

/** The evidence's name: the title, or the page's domain. */
export const evidenceName = (e: Pick<Evidence, "titulo" | "url" | "origem">) =>
  e.titulo ?? (e.origem === "link" ? new URL(e.url).hostname : e.origem === "documento" ? t("documento", "document") : e.origem === "lai" ? t("resposta de pedido de LAI", "reply to an FOI request") : t("resposta do outro lado", "reply from the other side"));

/** A name linked to the page; the other side's reply has no address (only the name, and the label in mono). */
export function EvidenceName({ e, className = "link-acao text-[15px]" }: { e: Pick<Evidence, "titulo" | "url" | "origem">; className?: string }) {
  if (e.origem !== "link") return <span className="grid gap-0.5"><b className="text-[15px] text-texto-forte">{evidenceName(e)}</b><span className="mono text-apoio">{e.origem === "documento" ? t("página de documento do dossiê", "page of a dossier document") : e.origem === "lai" ? t("resposta de pedido de LAI", "reply to an FOI request") : t("resposta do outro lado", "reply from the other side")}</span></span>;
  return <a href={e.url} target="_blank" rel="noreferrer" className={className}>{evidenceName(e)}</a>;
}

export const message = (e: unknown, fallback = t("Não deu certo agora. Tente de novo.", "That didn't work right now. Try again.")) =>
  e instanceof ApiError ? (e.status === 0 ? t("Sem conexão. Confira a internet e tente de novo.", "No connection. Check your internet and try again.") : e.message) : fallback;

/** A mark's detail: state, risk category, the sentence, the explanation and the evidence with its passage. */
export function DetailBrand({ a, evidencias: evidence, curto: short = false }: { a: Claim; evidencias: Evidence[]; curto?: boolean }) {
  const ev = a.evidenciaId ? evidence.find((e) => e.id === a.evidenciaId) : null;
  return (
    <div className="grid gap-3">
      {!short && <p className="m-0 leading-snug">
        <IconState estado={a.estado} className="mr-1.5 size-4" /><b className="text-texto-forte">{STATE_LABEL[a.estado as State][0].toUpperCase() + STATE_LABEL[a.estado as State].slice(1)}</b>
        {a.risco && <span className="text-apoio"> · {RISK_LABEL[a.risco] ?? a.risco}</span>}
      </p>}
      {!short && <p className="m-0 text-[15px] text-texto">“{a.trecho}”</p>}
      {a.explicacao && <p className="m-0 text-[15px]">{a.explicacao}</p>}
      {ev && a.evidenciaTrecho ? (
        <div className="grid gap-1.5">
          <p className="mono m-0 text-apoio">{t("evidência", "evidence")}</p>
          <EvidenceName e={ev} />
          <span className="mono text-apoio">{STRENGTH_LABEL[ev.forca]()}{ev.tipoFonte ? ` · ${TYPE_LABEL[ev.tipoFonte]()}` : ""}</span>
          <p className="m-0 text-[15px] leading-[1.55]"><mark className="bg-verde-claro px-0.5 text-texto-forte [box-decoration-break:clone]">{a.evidenciaTrecho}</mark></p>
          {ev.mudouEm && <p className="faixa-aviso m-0 text-[14px]">{t(`A fonte mudou desde que você conferiu (${when(ev.mudouEm)}).`, `The source changed since you checked (${when(ev.mudouEm)}).`)}</p>}
        </div>
      ) : a.estado !== "com_evidencia" && <p className="mono m-0 text-apoio">{t("sem evidência no dossiê", "no evidence in the dossier")}</p>}
    </div>
  );
}

/** The mobile bottom sheet (native `<dialog>`, class .folha). */
export function Sheet({ titulo: title, fechar: dismiss, children }: { titulo: string; fechar: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current!;
    if (!d.open) d.showModal();
    return () => { if (d.open) d.close(); };
  }, []);
  return (
    <dialog ref={ref} aria-labelledby={id} className="folha" onCancel={(e) => { e.preventDefault(); dismiss(); }} onClick={(e) => { if (e.target === ref.current) dismiss(); }}>
      <div className="grid max-h-[80vh] gap-2 overflow-y-auto px-5 pt-5 pb-[calc(20px+env(safe-area-inset-bottom))]">
        <header className="flex items-start gap-3">
          <h2 id={id} className="mono m-0 text-[12px] tracking-[.08em] text-apoio uppercase">{title}</h2>
          <button type="button" onClick={dismiss} aria-label={t("Fechar", "Close")} className="-mt-3 -mr-2 ml-auto grid size-11 cursor-pointer place-items-center rounded-btn text-apoio hover:bg-papel-2">
            <IconClose className="size-5" />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}

/** The source type, which gives the evidence's strength (never the publisher's political line). */
export const TYPE_LABEL: Record<NonNullable<Evidence["tipoFonte"]>, () => string> = {
  oficial: () => t("documento oficial", "official document"),
  primaria: () => t("fonte primária", "primary source"),
  materia: () => t("outra matéria", "another story"),
  anonima: () => t("fonte anônima", "anonymous source"),
};
export const STRENGTH_LABEL: Record<Evidence["forca"], () => string> = {
  forte: () => t("fonte forte", "strong source"),
  media: () => t("fonte média", "medium source"),
  fraca: () => t("fonte fraca", "weak source"),
  sem_tipo: () => t("tipo da fonte não dito", "source type not set"),
};

/**
 * Dossier: the evidence (title with link, domain, state, type and strength, Remove), the single-source and
 * circular-source warnings and "Add link".
 */
export function Dossier({ tenantId, textoId: textId, estado: state, editor, atualizar: update, aoFonte: onSource, emPartes: inParts = false, lerAoLado: readOnSide }: {
  tenantId: string; textoId: string; estado: DeskState; editor: boolean; atualizar: (d: DeskState) => void;
  /** A new link with the editor mounted: the screen checks by streaming. Without it (Dossier tab), the check runs here and only updates the state. */
  aoFonte?: (d: DeskState) => void;
  /** On the Dossier tab the part's row already gives the title and the count. */
  emPartes?: boolean;
  /** In the editor: opens the evidence in the Material reader, next to the text. */
  lerAoLado?: (evidenceId: string) => void;
}) {
  const evidence = state.evidencias;
  const name = (id: string) => { const e = evidence.find((x) => x.id === id); return e ? evidenceName(e) : "?"; };
  const param = { tenantId, id: textId };
  const type = useMutation({
    mutationFn: ({ evidencia: item, tipoFonte: sourceType }: { evidencia: string; tipoFonte: string | null }) => read(route.evidencias[":evidencia"].$patch({ param: { ...param, evidencia: item } }, bodyJson({ tipoFonte: sourceType }))),
    onSuccess: update,
  });
  const [url, setUrl] = useState("");
  const [missing, setMissing] = useState(false);
  const add = useMutation({
    mutationFn: () => read(route.evidencias.$post({ param }, bodyJson({ url: url.trim() }))),
    onSuccess: (d) => {
      setUrl("");
      if (onSource) { onSource(d); return; }
      update(d);
      recheck.mutate(d);
    },
  });
  const recheck = useMutation({ mutationFn: (d: DeskState) => recheckSources(tenantId, textId, blocksWithoutSource(d), update) });
  const remove = useMutation({
    mutationFn: (item: string) => read(route.evidencias[":evidencia"].$delete({ param: { ...param, evidencia: item } })),
    onSuccess: update,
  });
  const wayback = useMutation({
    mutationFn: (item: string) => read(route.evidencias[":evidencia"].wayback.$post({ param: { ...param, evidencia: item } })),
    onSuccess: update,
  });
  function send(e: FormEvent) {
    e.preventDefault();
    if (!url.trim()) { setMissing(true); return; }
    add.mutate();
  }
  const Box = inParts ? "div" : "section";
  return (
    <Box aria-labelledby={inParts ? undefined : "dossie-t"} className="grid gap-3">
      {!inParts && <h2 id="dossie-t" className="mono m-0 text-[12px] tracking-[.08em] text-apoio uppercase">{t("Dossiê", "Dossier")} · {evidence.length === 1 ? t("1 evidência", "1 piece of evidence") : t(`${evidence.length} evidências`, `${evidence.length} pieces of evidence`)}</h2>}
      {evidence.length ? (
        <ul className="m-0 grid list-none gap-2 p-0">
          {evidence.map((e) => (
            <li key={e.id} className="grid gap-1 rounded-card bg-branco px-3 py-2.5 shadow-curta">
              <EvidenceName e={e} className="link-acao text-[15px] leading-snug" />
              {e.origem === "link" && <span className="mono truncate text-apoio">{new URL(e.url).hostname}</span>}
              {e.mudouEm
                ? <span className="faixa-aviso py-1 text-[14px]">{t("A fonte mudou desde que você conferiu.", "The source changed since you checked.")}</span>
                : <span className="mono text-apoio">{t(`conferida ${when(e.conferidaEm)}`, `checked ${when(e.conferidaEm)}`)}{e.usada ? t(` · sustenta ${e.usada === 1 ? "1 afirmação" : `${e.usada} afirmações`}`, ` · supports ${e.usada === 1 ? "1 claim" : `${e.usada} claims`}`) : ""}{e.viaNavegador ? t(" · lida pelo navegador", " · read by the browser") : ""}</span>}
              <span className="mono text-apoio">{STRENGTH_LABEL[e.forca]()}</span>
              {e.wayback && <WaybackLine w={e.wayback} tentar={editor ? () => wayback.mutate(e.id) : null} ocupado={wayback.isPending} />}
              {editor ? (
                <label className="campo mt-1">
                  <span className="text-[14px]!">{t("Tipo da fonte", "Source type")}</span>
                  <select className="entrada bg-branco" value={e.tipoFonte ?? ""} disabled={type.isPending} onChange={(x) => type.mutate({ evidencia: e.id, tipoFonte: x.target.value || null })}>
                    <option value="">{t("não dito", "not set")}</option>
                    {(Object.keys(TYPE_LABEL) as (keyof typeof TYPE_LABEL)[]).map((k) => <option key={k} value={k}>{TYPE_LABEL[k]()}</option>)}
                  </select>
                  {!e.tipoFonte && e.tipoSugerido && <span className="ajuda">{t(`O endereço parece de ${TYPE_LABEL[e.tipoSugerido]()}. Confirme acima.`, `The address looks like an ${TYPE_LABEL[e.tipoSugerido]()}. Confirm above.`)}</span>}
                </label>
              ) : e.tipoFonte && <span className="mono text-apoio">{TYPE_LABEL[e.tipoFonte]()}</span>}
              {/* The answer to an LAI request stays in the dossier, with the request (the server refuses too, with the reason). */}
              {readOnSide ? (
                <span className="flex flex-wrap gap-x-4">
                  <button type="button" className="link-acao inline-flex min-h-11 items-center border-0 bg-transparent p-0 text-[14px] font-normal" onClick={() => readOnSide(e.id)}
                    aria-label={t(`Ler ao lado: ${e.titulo ?? e.url}`, `Read alongside: ${e.titulo ?? e.url}`)}>{t("Ler ao lado", "Read alongside")}</button>
                  {editor && e.origem !== "lai" && (
                    <button type="button" className="link-acao inline-flex min-h-11 items-center border-0 bg-transparent p-0 text-[14px] font-normal" onClick={() => remove.mutate(e.id)} disabled={remove.isPending}
                      aria-label={t(`Tirar do dossiê: ${e.titulo ?? e.url}`, `Remove from dossier: ${e.titulo ?? e.url}`)}>{t("Tirar", "Remove")}</button>
                  )}
                </span>
              ) : editor && e.origem !== "lai" && (
                <button type="button" className="link-acao justify-self-start border-0 bg-transparent p-0 text-[14px] font-normal" onClick={() => remove.mutate(e.id)} disabled={remove.isPending}
                  aria-label={t(`Tirar do dossiê: ${e.titulo ?? e.url}`, `Remove from dossier: ${e.titulo ?? e.url}`)}>{t("Tirar", "Remove")}</button>
              )}
            </li>
          ))}
        </ul>
      ) : <p className="m-0 text-apoio">{t("Nenhuma evidência ainda. Acrescente os links que sustentam o texto: a mesa confere cada afirmação contra eles.", "No evidence yet. Add the links that support the text: the desk checks every claim against them.")}</p>}
      {remove.isError && <p role="alert" className="faixa-erro m-0">{message(remove.error)}</p>}
      {type.isError && <p role="alert" className="faixa-erro m-0">{message(type.error)}</p>}
      {wayback.isError && <p role="alert" className="faixa-erro m-0">{message(wayback.error)}</p>}
      {recheck.isError && <p role="alert" className="faixa-erro m-0">{message(recheck.error)}</p>}
      {state.fonteUnica && <p className="faixa-aviso m-0">{t(`Todas as frases com fonte se apoiam numa fonte só: ${name(state.fonteUnica)}.`, `Every sourced sentence rests on a single source: ${name(state.fonteUnica)}.`)}</p>}
      {state.circulares.map((c) => (
        <p key={`${c.de}-${c.para}`} className="faixa-aviso m-0">
          {c.motivo === "cita"
            ? t(`${name(c.de)} cita ${name(c.para)}: não são duas fontes independentes.`, `${name(c.de)} cites ${name(c.para)}: they aren't two independent sources.`)
            : t(`${name(c.de)} e ${name(c.para)} repetem o mesmo trecho: não são duas fontes independentes.`, `${name(c.de)} and ${name(c.para)} repeat the same passage: they aren't two independent sources.`)}
        </p>
      ))}
      {editor && (
        <form onSubmit={send} noValidate className="grid gap-2">
          <label className="campo">
            <span>{t("Acrescentar link", "Add link")}</span>
            <input type="url" inputMode="url" className="entrada bg-branco" value={url} placeholder="https://" autoCapitalize="none" autoCorrect="off" spellCheck={false}
              onChange={(e) => { setUrl(e.target.value); setMissing(false); add.reset(); }} aria-invalid={missing || add.isError} aria-describedby="dossie-ajuda" />
            <span id="dossie-ajuda" className={missing || add.isError ? "text-[15px] text-terracota" : "ajuda"} role={missing || add.isError ? "alert" : undefined}>
              {missing ? t("Cole o link da evidência.", "Paste the evidence link.") : add.isError ? message(add.error) : t("A página é lida e salva; o dossiê é relido todo dia e avisa se a fonte mudar.", "The page is read and saved; the dossier is reread every day and warns you if the source changes.")}
            </span>
          </label>
          <button type="submit" className="btn-sec justify-self-start bg-papel-2" disabled={add.isPending}>{add.isPending ? t("Lendo a página…", "Reading the page…") : t("Acrescentar", "Add")}</button>
        </form>
      )}
    </Box>
  );
}

/** What a part's closed row says. With `tom`, it is an alert: the part moves ahead and opens by itself. */
export type Summary = { texto: string; tom?: "aviso" | "erro" };
export const qty = (n: number, one: string, several: string) => (n === 1 ? `1 ${one}` : `${n} ${several}`);

export function summaryDossier(e: DeskState): Summary {
  const n = e.evidencias.length;
  const total = n ? t(qty(n, "evidência", "evidências"), qty(n, "piece of evidence", "pieces of evidence")) : t("nenhuma evidência", "no evidence");
  const changed = e.evidencias.filter((x) => x.mudouEm).length;
  if (changed) return { tom: "aviso", texto: `${t(changed === 1 ? "1 fonte mudou" : `${changed} fontes mudaram`, changed === 1 ? "1 source changed" : `${changed} sources changed`)} · ${total}` };
  if (e.fonteUnica) return { tom: "aviso", texto: `${t("uma fonte só", "a single source")} · ${total}` };
  if (e.circulares.length) return { tom: "aviso", texto: `${t("fontes que não são independentes", "sources that aren't independent")} · ${total}` };
  return { texto: total };
}

/** The Wayback Machine copy: saving, saved (with the link and time) or not saved (with the reason and Try again). */
function WaybackLine({ w, tentar: attempt, ocupado: busy }: { w: NonNullable<Evidence["wayback"]>; tentar: (() => void) | null; ocupado: boolean }) {
  if (w.estado === "pendente") return <span className="mono text-apoio">{t("salvando no Wayback Machine…", "saving to the Wayback Machine…")}</span>;
  if (w.estado === "salvo" && w.url) {
    return <span className="mono text-apoio">{t("cópia no Wayback", "Wayback copy")}{w.em ? ` · ${when(w.em)}` : ""} · <a href={w.url} target="_blank" rel="noreferrer" className="link-acao font-normal">{t("ver a cópia", "see the copy")}</a></span>;
  }
  return (
    <span className="mono text-apoio">
      {t("o Wayback não salvou", "the Wayback didn't save it")}{w.erro ? ` (${w.erro})` : ""}
      {attempt && <> · <button type="button" className="link-acao border-0 bg-transparent p-0 font-normal" onClick={attempt} disabled={busy}>{t("Tentar de novo", "Try again")}</button></>}
    </span>
  );
}

/**
 * Check by streaming (NDJSON): one line per finished block and the last with the whole state. A JSON response (no
 * streaming) counts as the final line.
 */
export type CheckLine =
  | { tipo: "bloco"; blocoId: string; hash: string; estado: "pendente" | "conferido" | "nao_conferido"; erro: string | null; afirmacoes: Claim[] }
  | { tipo: "fim"; estado: DeskState; restantes?: number }
  | { tipo: "erro"; erro: string };

/** The paragraphs a new source may resolve: those with an open unsourced mark. */
export const blocksWithoutSource = (d: DeskState) => [...new Set(d.afirmacoes.filter((a) => a.estado === "sem_fonte" && a.aberta).map((a) => a.blocoId))];

/** Without the editor mounted: checks the requested paragraphs and updates the state at the end, without animation. The failure goes up; the link is already saved. */
export async function recheckSources(tenantId: string, id: string, blocks: string[], update: (d: DeskState) => void) {
  let queue = blocks;
  while (queue.length) {
    const seen = new Set<string>();
    let remaining = 0;
    await checkInStreaming(tenantId, id, { blocos: queue }, (l) => {
      if (l.tipo === "bloco") seen.add(l.blocoId);
      else if (l.tipo === "erro") throw new ApiError(500, l.erro);
      else { update(l.estado); remaining = l.restantes ?? 0; }
    });
    queue = remaining ? queue.filter((b) => !seen.has(b)) : [];
  }
}

export async function checkInStreaming(tenantId: string, id: string, body: { todos?: boolean; blocos?: string[]; pular?: string[] }, onLine: (l: CheckLine) => void) {
  let res: Response;
  try {
    res = await fetch(`/api/t/${encodeURIComponent(tenantId)}/textos/${encodeURIComponent(id)}/conferir`, {
      method: "POST", headers: { "content-type": "application/json", accept: "application/x-ndjson", ...headerLanguage() },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, t("Sem conexão com o servidor.", "No connection to the server."));
  }
  if (!res.ok) {
    const b = (await res.json().catch(() => null)) as { erro?: string; code?: string } | null;
    throw new ApiError(res.status, b?.erro ?? `Erro ${res.status}`, b?.code, b);
  }
  if (!(res.headers.get("content-type") ?? "").includes("ndjson") || !res.body) {
    onLine({ tipo: "fim", estado: (await res.json()) as DeskState });
    return;
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let rest = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) rest += value;
    let i: number;
    while ((i = rest.indexOf("\n")) >= 0) {
      const l = rest.slice(0, i).trim();
      rest = rest.slice(i + 1);
      if (l) onLine(JSON.parse(l) as CheckLine);
    }
    if (done) break;
  }
  if (rest.trim()) onLine(JSON.parse(rest) as CheckLine);
}
