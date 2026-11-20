// The Story editor's assistant (Phase 3): the card's five actions (they record reporting, they never write text), the
// detail of code findings (arithmetic, quote, style guide), the people and institutions panel, the publishing checklist
// with the editor's signature, the Ctrl/⌘K palette and the `@` menu (dossier citation).
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router";
import { bodyJson, read } from "../api";
import { when } from "../queue";
import { t } from "../language";
import { IconState, SCREEN_LABEL, type ScreenState } from "../onboarding/deskMarks";
import { message, evidenceName, route, type Claim, type DeskState, type Evidence } from "./common";
import { PlayPassage } from "./Recordings";

export type Finding = DeskState["apontamentos"][number];
export type Person = DeskState["pessoas"][number];
export type Pending = DeskState["checklist"]["pendencias"][number];

export const MEANS: [string, () => string][] = [
  ["email", () => t("e-mail", "email")], ["telefone", () => t("telefone", "phone")], ["mensagem", () => t("mensagem (WhatsApp, rede social)", "message (WhatsApp, social media)")],
  ["pessoalmente", () => t("pessoalmente", "in person")], ["oficio", () => t("ofício ou pedido formal", "formal letter or request")], ["outro", () => t("outro meio", "other means")],
];
export const halfLabel = (m: string) => MEANS.find(([k]) => k === m)?.[1]() ?? m;
export const RISKS_OTHER_SIDE = ["acusacao_sem_condenacao", "sem_outro_lado"];
const today = () => new Date().toLocaleDateString("sv-SE");
const shortDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/** A short form for a dossier link (used on the card and in the pasted-link notice). */
export function FormLink({ tenantId, textoId: textId, inicial: initial = "", rotulo: caption, aoAdicionar: onAdd, cancelar: cancel }: {
  tenantId: string; textoId: string; inicial?: string; rotulo: string; aoAdicionar: (d: DeskState) => void; cancelar?: () => void;
}) {
  const [url, setUrl] = useState(initial);
  const id = useId();
  const add = useMutation({
    mutationFn: () => read(route.evidencias.$post({ param: { tenantId, id: textId } }, bodyJson({ url: url.trim() }))),
    onSuccess: (d) => onAdd(d),
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (url.trim()) add.mutate(); }} noValidate className="grid gap-2">
      <label className="campo">
        <span>{caption}</span>
        <input type="url" inputMode="url" className="entrada bg-branco" value={url} placeholder="https://" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoFocus
          onChange={(e) => { setUrl(e.target.value); add.reset(); }} aria-invalid={add.isError} aria-describedby={add.isError ? id : undefined} />
      </label>
      {add.isError && <p id={id} role="alert" className="m-0 text-[15px] text-terracota">{message(add.error)}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-sec bg-papel-2" disabled={add.isPending}>{add.isPending ? t("Lendo a página…", "Reading the page…") : t("Pôr no dossiê", "Add to dossier")}</button>
        {cancel && <button type="button" className="btn-sec bg-papel-2" onClick={cancel}>{t("Cancelar", "Cancel")}</button>}
      </div>
    </form>
  );
}

/** The name of whoever wrote the first opinion, from the block's `fornecedor` (deepseek, gemini, kie, deepseek+anthropic...). */
export const textName = (provider: string | null | undefined) => (provider?.startsWith("kie") ? "Kie (Gemini)" : provider?.startsWith("gemini") ? "Gemini" : "DeepSeek");

/**
 * Who checked the paragraph: two opinions, a single one (and why) or the other provider (sensitive topic). `ligar`: the
 * AI keys tab's address, only for admins, when the second opinion is off.
 */
export function OpinionsLine({ bloco: block, segunda: second, ligar: enable }: { bloco: DeskState["blocos"][number] | undefined; segunda: DeskState["segunda"]; ligar?: string | null }) {
  if (!block) return null;
  const text: ReactNode = block.aviso ? block.aviso
    : block.fornecedor?.endsWith("+anthropic") ? t(`duas opiniões: ${textName(block.fornecedor)} e Claude`, `two opinions: ${textName(block.fornecedor)} and Claude`)
      : block.fornecedor === "anthropic" ? t("conferido pelo Claude (tema que modelos chineses suavizam)", "checked by Claude (a topic Chinese models soften)")
        : second.ligada ? t("uma opinião: sem acusação nem risco, a segunda opinião não foi chamada", "one opinion: no accusation or risk, so the second opinion wasn't called")
          : <>{t("uma opinião só: a segunda opinião não está ligada neste veículo", "only one opinion: the second opinion isn't turned on for this outlet")}{enable && <>{" "}<Link className="link-acao font-sans" to={enable}>{t("Ligar a segunda opinião", "Turn on the second opinion")}</Link></>}</>;
  return <p className={`m-0 text-[14px] ${block.aviso ? "faixa-aviso py-1" : "mono text-apoio"}`}>{text}</p>;
}

/**
 * The five actions on a claim's card. Recorded with who and when; undoing keeps the record. None changes the text: the
 * sentence stays the author's.
 */
export function ActionsCard({ a, evidencias: evidence, tenantId, textoId: textId, atualizar: update, aoFonte: onSource }: {
  a: Claim; evidencias: Evidence[]; tenantId: string; textoId: string; atualizar: (d: DeskState) => void; aoFonte: (d: DeskState) => void;
}) {
  const param = { tenantId, id: textId };
  const [shape, setShape] = useState<null | "fonte" | "link" | "outro_lado">(null);
  const [evId, setEvId] = useState(a.evidenciaId ?? evidence[0]?.id ?? "");
  const [passage, setPassage] = useState("");
  const [who, setWho] = useState("");
  const [whenWas, setWhen] = useState(today());
  const [half, setHalf] = useState("email");
  const errorId = useId();
  const record = useMutation({
    mutationFn: (body: Record<string, unknown>) => read(route.apuracoes.$post({ param }, bodyJson({ afirmacaoId: a.id, ...body }))),
    onSuccess: (d) => { update(d); setShape(null); },
  });
  const undo = useMutation({
    mutationFn: (reporting: string) => read(route.apuracoes[":apuracao"].$delete({ param: { ...param, apuracao: reporting } })),
    onSuccess: update,
  });
  const ap = a.apuracao;
  if (ap) {
    const actor = ap.porNome ?? t("alguém da equipe", "someone on the team");
    const desc = ap.tipo === "fonte" ? t(`Fonte presa por ${actor}, ${when(ap.em)}.`, `Source pinned by ${actor}, ${when(ap.em)}.`)
      : ap.tipo === "opiniao" ? t(`Afirmação sua (opinião), marcada por ${actor}, ${when(ap.em)}. Sai da conferência e vai ao carrossel como opinião do autor.`, `Your own claim (opinion), marked by ${actor}, ${when(ap.em)}. It leaves the check and goes to the carousel as the author's opinion.`)
        : ap.tipo === "ignorar" ? t(`Ignorada por ${actor}, ${when(ap.em)}.`, `Ignored by ${actor}, ${when(ap.em)}.`)
          : t(`Outro lado procurado: ${ap.outroLado?.quem}, em ${shortDate(ap.outroLado?.quando ?? "")}, por ${halfLabel(ap.outroLado?.meio ?? "")}. Registrado por ${actor}.`,
            `Other side contacted: ${ap.outroLado?.quem}, on ${shortDate(ap.outroLado?.quando ?? "")}, by ${halfLabel(ap.outroLado?.meio ?? "")}. Recorded by ${actor}.`);
    return (
      <div className="grid gap-2 border-t border-fio pt-2.5">
        <p className="m-0 text-[15px]">{desc}</p>
        {ap.tipo === "fonte" && ap.evidenciaTrecho && <p className="m-0 text-[15px] leading-[1.55]"><mark className="bg-verde-claro px-0.5 text-texto-forte">{ap.evidenciaTrecho}</mark></p>}
        {undo.isError && <p role="alert" className="faixa-erro m-0">{message(undo.error)}</p>}
        <button type="button" className="link-acao justify-self-start border-0 bg-transparent p-0 text-[15px]" onClick={() => undo.mutate(ap.id)} disabled={undo.isPending}>{t("Desfazer", "Undo")}</button>
      </div>
    );
  }
  const canOtherSide = a.estado === "risco" && RISKS_OTHER_SIDE.includes(a.risco ?? "");
  const actions: [string, () => void, boolean][] = [
    [t("Prender fonte", "Pin source"), () => setShape(shape === "fonte" ? null : "fonte"), evidence.length > 0 && a.estado !== "com_evidencia"],
    [t("Adicionar link", "Add link"), () => setShape(shape === "link" ? null : "link"), true],
    [t("Procurei o outro lado", "I contacted the other side"), () => setShape(shape === "outro_lado" ? null : "outro_lado"), canOtherSide],
    [t("É opinião", "It's opinion"), () => record.mutate({ tipo: "opiniao" }), true],
    [t("Ignorar", "Ignore"), () => record.mutate({ tipo: "ignorar" }), true],
  ];
  function send(e: FormEvent, body: Record<string, unknown>) {
    e.preventDefault();
    record.mutate(body);
  }
  return (
    <div className="grid gap-2.5 border-t border-fio pt-2.5">
      <div role="group" aria-label={t("Ações da marca", "Mark actions")} className="flex flex-wrap gap-1.5">
        {actions.filter(([, , ok]) => ok).map(([label, make]) => (
          <button key={label} type="button" className="btn-sec min-h-11 bg-papel-2 px-3 text-[14px]" onClick={() => { record.reset(); make(); }} disabled={record.isPending}>{label}</button>
        ))}
      </div>
      {shape === "fonte" && (
        <form onSubmit={(e) => send(e, { tipo: "fonte", evidenciaId: evId, evidenciaTrecho: passage })} className="grid gap-2">
          <label className="campo">
            <span>{t("Fonte do dossiê", "Dossier source")}</span>
            <select className="entrada bg-branco" value={evId} onChange={(e) => setEvId(e.target.value)}>
              {evidence.map((e) => <option key={e.id} value={e.id}>{evidenceName(e)}</option>)}
            </select>
          </label>
          <label className="campo">
            <span>{t("Trecho da fonte que sustenta a frase", "Passage from the source that supports the sentence")}</span>
            <textarea className="entrada min-h-20 bg-branco" value={passage} onChange={(e) => { setPassage(e.target.value); record.reset(); }} required
              aria-invalid={record.isError} aria-describedby={`${errorId}-a`} />
            <span id={`${errorId}-a`} className="ajuda">{t("Copie da fonte, letra por letra: o sistema confere que o trecho está lá.", "Copy it from the source, word for word: the system checks the passage is there.")}</span>
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn-sec bg-papel-2" disabled={record.isPending || !passage.trim()}>{t("Prender", "Pin")}</button>
            <button type="button" className="btn-sec bg-papel-2" onClick={() => setShape(null)}>{t("Cancelar", "Cancel")}</button>
          </div>
        </form>
      )}
      {shape === "link" && (
        <FormLink tenantId={tenantId} textoId={textId} rotulo={t("Link da fonte desta frase", "Link to this sentence's source")} cancelar={() => setShape(null)}
          aoAdicionar={(d) => { setShape(null); onSource(d); }} />
      )}
      {shape === "outro_lado" && (
        <form onSubmit={(e) => send(e, { tipo: "outro_lado", quem: who, quando: whenWas, meio: half })} className="grid gap-2">
          <label className="campo">
            <span>{t("Quem você procurou", "Who you contacted")}</span>
            <input className="entrada bg-branco" value={who} onChange={(e) => setWho(e.target.value)} required maxLength={200} placeholder={t("nome ou assessoria", "name or press office")} />
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="campo">
              <span>{t("Quando", "When")}</span>
              <input type="date" className="entrada bg-branco" value={whenWas} max={today()} onChange={(e) => setWhen(e.target.value)} required />
            </label>
            <label className="campo">
              <span>{t("Por qual meio", "By what means")}</span>
              <select className="entrada bg-branco" value={half} onChange={(e) => setHalf(e.target.value)}>
                {MEANS.map(([k, r]) => <option key={k} value={k}>{r()}</option>)}
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn-sec bg-papel-2" disabled={record.isPending || who.trim().length < 2}>{t("Registrar", "Record")}</button>
            <button type="button" className="btn-sec bg-papel-2" onClick={() => setShape(null)}>{t("Cancelar", "Cancel")}</button>
          </div>
        </form>
      )}
      {record.isError && <p role="alert" className="faixa-erro m-0">{message(record.error)}</p>}
    </div>
  );
}

/** A code finding's detail: what the code found and, for a quote, the shortcut to put its source in the dossier. */
export function DetailFinding({ p, podeEditar: canEdit, tenantId, textoId: textId, aoAdicionar: onAdd }: {
  p: Finding; podeEditar: boolean; tenantId: string; textoId: string; aoAdicionar: (d: DeskState) => void;
}) {
  const [link, setLink] = useState(false);
  return (
    <div className="grid gap-2">
      <p className="m-0 text-[15px]">{p.explicacao}</p>
      <p className="mono m-0 text-apoio">{p.tipo === "manual" ? t("só aponta: a mudança é sua", "it only points: the change is yours") : t("conferido por código, sem modelo", "checked by code, no model")}</p>
      {p.tipo === "gravacao" && p.gravacao && <PlayPassage tenantId={tenantId} textoId={textId} g={p.gravacao} />}
      {p.tipo === "aspa" && canEdit && (link
        ? <FormLink tenantId={tenantId} textoId={textId} rotulo={t("Link da fonte da citação", "Link to the quote's source")} cancelar={() => setLink(false)} aoAdicionar={(d) => { onAdd(d); setLink(false); }} />
        : <button type="button" className="btn-sec min-h-11 justify-self-start bg-papel-2 px-3 text-[14px]" onClick={() => setLink(true)}>{t("Adicionar link", "Add link")}</button>)}
    </div>
  );
}

/** The text's people and institutions: mentions, different spellings and, for the accused, whether the other side was contacted. */
export function People({ pessoas: people, irPara: goTo, naFolha: inSheet }: { pessoas: Person[]; irPara: (p: Person) => void; naFolha: boolean }) {
  const list = [...people].sort((a, b) => Number(b.acusada) - Number(a.acusada) || Number(b.grafias.length > 0) - Number(a.grafias.length > 0) || b.mencoes - a.mencoes);
  if (!list.length && !inSheet) return null;   // in the desktop panel, an empty list only takes space away from whoever is writing
  return (
    <section aria-labelledby="pessoas-t" className="grid gap-2.5">
      <h2 id="pessoas-t" className={`mono m-0 text-[12px] tracking-[.08em] text-apoio uppercase ${inSheet ? "mt-4" : ""}`}>{t("Pessoas e instituições", "People and institutions")}</h2>
      {list.length ? (
        <ul className="m-0 grid list-none gap-1.5 p-0">
          {list.map((p) => (
            <li key={p.nome} className="grid gap-1 rounded-card bg-branco px-3 py-2 shadow-curta">
              <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-left text-[15px] font-bold text-texto-forte underline decoration-fio-forte underline-offset-3" onClick={() => goTo(p)}>
                {p.nome}
              </button>
              <span className="mono text-apoio">
                {p.tipo === "instituicao" ? t("instituição", "institution") : t("pessoa", "person")} · {p.mencoes === 1 ? t("1 menção", "1 mention") : t(`${p.mencoes} menções`, `${p.mencoes} mentions`)}
              </span>
              {p.grafias.length > 0 && <span className="faixa-aviso py-1 text-[14px]">{t(`Grafia diferente no texto: ${p.grafias.join(", ")}.`, `Different spelling in the text: ${p.grafias.join(", ")}.`)}</span>}
              {p.acusada && (p.outroLado
                ? <span className="text-[14px] text-texto">{t(`Acusada no texto. Outro lado: ${p.outroLado.quem}, ${shortDate(p.outroLado.quando)}, por ${halfLabel(p.outroLado.meio)}.`, `Accused in the text. Other side: ${p.outroLado.quem}, ${shortDate(p.outroLado.quando)}, by ${halfLabel(p.outroLado.meio)}.`)}</span>
                : <span className="faixa-aviso py-1 text-[14px]">{t("Acusada no texto, sem registro de que foi procurada.", "Accused in the text, with no record of being contacted.")}</span>)}
            </li>
          ))}
        </ul>
      ) : <p className="m-0 text-apoio">{t("Nenhum nome próprio no texto ainda.", "No proper names in the text yet.")}</p>}
    </section>
  );
}

const PENDING_LABEL: Record<Pending["tipo"], () => string> = {
  risco: () => t("risco jurídico aberto", "open legal risk"),
  paragrafo: () => t("parágrafo não conferido", "paragraph not checked"),
  aspa: () => t("aspa sem fonte", "unsourced quote"),
  conta: () => t("conta que não fecha", "math that doesn't add up"),
};
const PENDING_STATE: Record<Pending["tipo"], ScreenState> = { risco: "risco", paragrafo: "sem_fonte", aspa: "aspa", conta: "conta" };

/**
 * Publishing checklist: what gates Instagram (and the sources page). With an open item, it only goes out with the
 * editor's signature, recorded with the version and what was open.
 */
export function Checklist({ checklist, podeEditar: canEdit, assinar: sign, assinando: signing, erro: error, irPara: goTo, fechar: dismiss }: {
  checklist: DeskState["checklist"]; podeEditar: boolean; assinar: () => void; assinando: boolean; erro: unknown; irPara: (p: Pending) => void; fechar: () => void;
}) {
  const { pendencias: pendingItems, assinatura: signature } = checklist;
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <section ref={ref} tabIndex={-1} aria-labelledby="checklist-t" className="mt-4 grid gap-3 rounded-card bg-branco p-4 shadow-curta outline-none">
      <div className="flex items-start gap-3">
        <h2 id="checklist-t" className="m-0 text-[18px]">{t("Checklist de publicação", "Publication checklist")}</h2>
        <button type="button" className="link-acao ml-auto border-0 bg-transparent p-0 text-[15px]" onClick={dismiss}>{t("Fechar", "Close")}</button>
      </div>
      {pendingItems.length ? (
        <>
          <p className="m-0">{t("Com algum destes itens aberto, a matéria não vai para o Instagram nem para a página de fontes sem a assinatura do editor.", "With any of these items open, the story doesn't go to Instagram or the sources page without the editor's sign-off.")}</p>
          <ul className="m-0 grid list-none gap-1.5 p-0">
            {pendingItems.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => goTo(p)} className="grid w-full cursor-pointer gap-0.5 rounded-btn border-0 bg-transparent px-1 py-1.5 text-left hover:bg-papel-2">
                  <span className="text-[14px]"><IconState estado={PENDING_STATE[p.tipo]} className="mr-1 size-3.5" /><b>{PENDING_LABEL[p.tipo]()}</b></span>
                  <span className="line-clamp-2 text-[15px] text-texto">“{p.trecho}”</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : <p className="m-0">{t("Nada pendente nesta versão: pode mandar.", "Nothing open in this version: you can send it.")}</p>}
      {signature ? (
        <p className="m-0 text-[15px] text-verde">{t(`Publicação assinada por ${signature.por ?? "alguém da equipe"}, ${when(signature.em)}, com ${signature.pendencias === 1 ? "1 pendência" : `${signature.pendencias} pendências`}.`, `Publication signed off by ${signature.por ?? "someone on the team"}, ${when(signature.em)}, with ${signature.pendencias === 1 ? "1 open item" : `${signature.pendencias} open items`}.`)}</p>
      ) : pendingItems.length > 0 && canEdit && (
        <div className="grid gap-2">
          <p className="faixa-aviso m-0">{t(`Assinar é assumir ${pendingItems.length === 1 ? "a pendência acima" : `as ${pendingItems.length} pendências acima`} nesta versão. Fica registrado quem assinou e quando.`, `Signing off means taking responsibility for ${pendingItems.length === 1 ? "the item above" : `the ${pendingItems.length} items above`} in this version. Who signed and when is recorded.`)}</p>
          <button type="button" className="btn-sec justify-self-start bg-papel-2" onClick={sign} disabled={signing}>{signing ? t("Assinando…", "Signing…") : t("Assinar a publicação", "Sign off the publication")}</button>
        </div>
      )}
      {!!error && <p role="alert" className="faixa-erro m-0">{message(error)}</p>}
    </section>
  );
}

export interface Command { id: string; rotulo: string; dica?: string; fazer: () => void }

/** The Ctrl/⌘K palette: the editor's commands, filtered by what the person types. Enter runs the first. */
export function Commands({ comandos: commands, fechar: dismiss }: { comandos: Command[]; fechar: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [search, setSearch] = useState("");
  const [i, setI] = useState(0);
  const title = useId();
  useEffect(() => {
    const d = ref.current!;
    if (!d.open) d.showModal();
    return () => { if (d.open) d.close(); };
  }, []);
  const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const list = commands.filter((c) => norm(c.rotulo).includes(norm(search)));
  const run = (c: Command | undefined) => { if (!c) return; dismiss(); c.fazer(); };
  return (
    <dialog ref={ref} aria-labelledby={title} className="comandos" onCancel={(e) => { e.preventDefault(); dismiss(); }} onClick={(e) => { if (e.target === ref.current) dismiss(); }}>
      <div className="grid gap-2 p-4">
        <h2 id={title} className="mono m-0 text-[12px] tracking-[.08em] text-apoio uppercase">{t("Comandos", "Commands")}</h2>
        <input className="entrada bg-branco" autoFocus value={search} aria-label={t("Procurar comando", "Search commands")} role="combobox" aria-expanded="true" aria-controls={`${title}-l`}
          aria-activedescendant={list[i] ? `${title}-${list[i].id}` : undefined}
          onChange={(e) => { setSearch(e.target.value); setI(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => Math.min(x + 1, list.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => Math.max(x - 1, 0)); }
            else if (e.key === "Enter") { e.preventDefault(); run(list[i]); }
          }} />
        <ul id={`${title}-l`} role="listbox" aria-label={t("Comandos", "Commands")} className="m-0 grid list-none gap-0.5 p-0">
          {list.map((c, k) => (
            <li key={c.id} id={`${title}-${c.id}`} role="option" aria-selected={k === i} onMouseDown={(e) => e.preventDefault()} onClick={() => run(c)}
              className={`flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-btn px-2.5 text-[15px] ${k === i ? "bg-papel-2 font-bold text-texto-forte" : "text-texto"}`}>
              <span>{c.rotulo}</span>{c.dica && <span className="mono text-[12px] font-normal text-apoio">{c.dica}</span>}
            </li>
          ))}
          {!list.length && <li className="px-2.5 py-2 text-apoio">{t("Nenhum comando com esse nome.", "No command with that name.")}</li>}
        </ul>
      </div>
    </dialog>
  );
}

/** The `@` menu: the dossier evidence that matches what the person typed. Keys in the editor (arrows, Enter, Esc). */
export function MenuHandle({ opcoes: options, ativo: active, escolher: choose, topo: upper, esquerda: left, id }: {
  opcoes: Evidence[]; ativo: number; escolher: (e: Evidence) => void; topo: number; esquerda: number; id: string;
}) {
  return (
    <div className="absolute z-20 w-[min(360px,90vw)] rounded-card bg-branco p-1.5 shadow-curta" style={{ top: upper, left: left }}>
      <p className="mono m-0 px-2 pt-1 pb-1.5 text-[12px] text-apoio">{t("citar do dossiê", "cite from the dossier")}</p>
      <ul id={id} role="listbox" aria-label={t("Citar do dossiê", "Cite from the dossier")} className="m-0 grid list-none gap-0.5 p-0">
        {options.length ? options.map((e, k) => (
          <li key={e.id} id={`${id}-${e.id}`} role="option" aria-selected={k === active} onMouseDown={(ev) => { ev.preventDefault(); choose(e); }}
            className={`grid min-h-11 cursor-pointer content-center rounded-btn px-2 text-[15px] ${k === active ? "bg-papel-2 font-bold text-texto-forte" : "text-texto"}`}>
            <span className="truncate">{evidenceName(e)}</span>
            <span className="mono truncate text-[12px] font-normal text-apoio">{e.origem === "link" ? new URL(e.url).hostname : e.origem === "documento" ? t("documento", "document") : e.origem === "lai" ? t("resposta de LAI", "FOI reply") : t("resposta do outro lado", "reply from the other side")}</span>
          </li>
        )) : <li className="px-2 py-2 text-[15px] text-apoio">{t("Nada no dossiê com esse nome.", "Nothing in the dossier by that name.")}</li>}
      </ul>
    </div>
  );
}

/** The citation note's label: the evidence's short title in brackets. */
export const noteLabel = (e: Evidence) => {
  const base = evidenceName(e).replace(/\s+/g, " ").trim();
  return `[${base.length > 40 ? `${base.slice(0, 39)}…` : base}]`;
};

export const Label = ({ estado: state, children }: { estado: ScreenState; children?: ReactNode }) => (
  <span className="text-[14px] leading-snug"><IconState estado={state} className="mr-1 size-3.5" /><b className="text-texto-forte">{SCREEN_LABEL[state]}</b>{children}</span>
);
