// Ideas (the queue), round 4 (DESIGN.md §12). At the top, "Now": the next action in a single block (the post that has
// waited longest, with the pencil loop on "Review the next one") and, beside it, the short queue (the following posts
// and what is producing, with its step). Below, the suggested ideas in a list and, from 1180 px up, the chosen one's
// lead sheet beside it: the facts the source brings, the format and, in the pinned footer, Produce and Discard. Below
// 1180 px there is no sheet: each row carries its summary and its actions. The chosen idea lives in the URL
// (`?ideia=`). There is a single hand mark: "Review the next one" when a post is ready; otherwise, the chosen idea's
// Produce. A reporter only brings ideas: for them, no hand mark on an action that is not theirs ("View" instead of "Review").
import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { api, ApiError, bodyJson, read } from "../api";
import { useShell } from "../shell/context";
import type { Brought } from "../shell/NewSheet";
import { IconRight, RecordIcon } from "../shell/icons";
import { FailureLoad, freeShortcut, useTitle } from "../common";
import {
  DESK, STEPS, FORMATS, newWarning, keys, cityFilter, waitFor, filterPerCity, hour, instant, markVisit, failureReason, newSince, when,
  summaryVisit, areaLabel, formatLabel, useAreas, useSources, useLeads, usePieces, useStatusPiece, previousVisit, type Area, type Format, type Lead,
  type PieceQueue,
} from "../queue";
import { t } from "../language";
import { ART_NAME, artRemembered, rememberArt, markArt } from "../kit/artTransition";
import { BackPencil } from "../kit/Pencil";
import { useMedia, usePart } from "../kit/Parts";
import { ladder, useWarm } from "../kit/Proof";
import { warmPost } from "../warmup";
import type { Outlet } from "../session";
import { LimitWarning } from "./LimitNotice";
import vazio1x from "../assets/empty-ideas.webp";
import vazio2x from "../assets/empty-ideas@2x.webp";

export default function Ideas() {
  const { veiculo: outlet } = useShell();
  useTitle(t("Ideias", "Ideas"), outlet.nome);
  const leads = useLeads(outlet.id);
  const pieces = usePieces(outlet.id);
  const previous = previousVisit(outlet.id);
  const loaded = leads.isSuccess && pieces.isSuccess;
  useEffect(() => { if (loaded) markVisit(outlet.id); }, [loaded, outlet.id]);
  const canProduce = outlet.papel !== "reporter";
  // Came back from the "New idea" sheet: says what happened and marks the idea brought in.
  const brought = (useLocation().state as { nova?: Brought } | null)?.nova;

  // The API already sorts: ready to approve first (whoever has waited longest in front), then what is producing.
  const progress = pieces.data?.pecas ?? [];
  const all = leads.data?.pautas ?? [];
  // An outlet with more than one city: the city appears on each idea and there is a filter (`?cidade=<ibge>`) above the list.
  const coverage = useAreas(outlet.id, outlet.modo === "local");
  const areas = coverage.data?.areas ?? [];
  const several = areas.length > 1;
  const [params] = useSearchParams();
  const requested = params.get("cidade");
  // Without the coverage loaded, the URL's filter applies as is (it does not silently become "all"); if it failed, the screen says so.
  const city = coverage.isSuccess ? cityFilter(requested, areas) : requested && /^\d{7}$/.test(requested) ? requested : null;
  const list = filterPerCity(all, city);
  // One hand mark per screen (DESIGN.md §4): with a ready post, the loop belongs to "Review the next one"; without one, to the chosen idea's Produce.
  const pencilInProduce = canProduce && !progress.some((p) => p.status === "revisao");
  // Counted in the database (the list stops at 50 posts and 100 ideas); on the first visit, the queue's total of ideas.
  const summary = loaded ? summaryVisit({
    anterior: previous,
    prontas: pieces.data.prontasDesde ?? 0,
    novas: previous === null ? all.length : leads.data.novasDesde ?? 0,
  }) : null;

  const qcSummary = useQueryClient();
  const summarize = useMutation({
    mutationFn: () => read(api.t[":tenantId"].resumo.$post({ param: { tenantId: outlet.id } })),
    onSuccess: () => { qcSummary.invalidateQueries({ queryKey: keys.pecas(outlet.id) }); qcSummary.invalidateQueries({ queryKey: keys.pautas(outlet.id) }); },
  });
  return (
    <div className="mx-auto max-w-[1280px] px-5 pt-6 pb-14 lg:px-12 lg:pt-3">
      {/* The date and the place live in the shell's folio (DESIGN.md §12): here, only the screen's name, what changed and the day's action. */}
      <header className="mb-6 lg:mb-8">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h1 className="titulo-tela m-0 text-[32px] lg:text-[34px]">{t("Ideias", "Ideas")}</h1>
            {summary && (
              <p className="mt-2 mb-0 text-[15px] text-apoio" role="status">
                <strong className="font-semibold text-texto-forte">{summary.rotulo}</strong> {summary.texto}
              </p>
            )}
          </div>
          {outlet.papel !== "reporter" && outlet.modo !== "autoral" && (
            <button type="button" className="btn-tom btn-p" disabled={summarize.isPending} onClick={() => summarize.mutate()}>
              <IconSummary />
              {summarize.isPending ? t("Resumindo…", "Summing up…") : t("Resumir o dia", "Sum up the day")}
            </button>
          )}
        </div>
        {summarize.isSuccess && <p role="status" className="m-0 mt-2 text-verde">{summarize.data.situacao === "nova" ? t("O resumo do dia está sendo produzido e vai para Para aprovar.", "The daily roundup is being made and will go to To approve.") : t("O resumo de hoje já foi feito.", "Today's roundup is already done.")}</p>}
        {summarize.isError && <p role="alert" className="faixa-aviso m-0 mt-2">{(summarize.error as Error).message}</p>}
      </header>

      <SourcesWarning tenantId={outlet.id} />
      {city && coverage.isError && (
        <p role="alert" className="faixa-aviso mt-0 mb-6">
          {t("Não carregou as cidades do veículo: a lista mostra só a cidade escolhida.", "Couldn't load the publication's cities: the list shows only the chosen city.")}{" "}
          <button type="button" onClick={() => coverage.refetch()} className="cursor-pointer font-bold underline">{t("Tentar de novo", "Try again")}</button>{" "}
          <Link to="?" className="font-bold underline">{t("Ver todas", "See all")}</Link>
        </p>
      )}
      {brought && !all.some((p) => p.id === brought.pautaId) && (
        <p role="status" className="mt-0 mb-6 flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-faixa bg-papel-2 px-3 py-2.5 text-[15px] font-bold text-texto-forte">
          {newWarning(brought.situacao, brought.status, brought.peca?.status)}
          {brought.peca && <Link to={`p/${brought.peca.id}`} viewTransition className="link-acao">{t("Abrir o post", "Open the post")}</Link>}
        </p>
      )}

      {leads.isPending || pieces.isPending ? (
        <Skeleton />
      ) : leads.isError || pieces.isError ? (
        <FailureLoad oque={t("as ideias", "the ideas")} tentar={() => { leads.refetch(); pieces.refetch(); }} />
      ) : !all.length && !progress.length ? (
        <Empty />
      ) : (
        <div className="grid gap-[34px] [&>*]:min-w-0">
          {progress.length > 0 && <Now pecas={progress} total={pieces.data!.total} decide={canProduce} />}
          {list.length > 0
            ? <Suggested pautas={list} anterior={previous} podeProduzir={canProduce} lapis={pencilInProduce} trazida={brought} mostrarCidade={several}
                filtro={several && all.length > 0 ? <FilterCity areas={areas} cidade={city} /> : null} />
            : city
              ? <div className="grid gap-4">{several && <FilterCity areas={areas} cidade={city} />}<p className="m-0 text-apoio">{t(`Nenhuma ideia de ${areas.find((a) => a.ibge === city)?.nome ?? "lá"} na lista agora.`, `No ideas from ${areas.find((a) => a.ibge === city)?.nome ?? "there"} in the list right now.`)} <Link to="?" className="link-acao">{t("Ver todas", "See all")}</Link></p></div>
              : <p className="m-0 text-apoio">{t("Nenhuma ideia nova na lista. As próximas chegam com a coleta das fontes, a cada 15 minutos.", "No new ideas in the list. More arrive as the sources are checked, every 15 minutes.")}</p>}
        </div>
      )}
    </div>
  );
}

/** Text lines that shorten: the daily digest joins the news into a single piece. */
function IconSummary() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
      <path d="M5 6h14M5 10h14M5 14h9M5 18h6" />
    </svg>
  );
}

// ── now: the next action and the short queue ────────────────────────────────────────────────────────────────────

/** How many following posts and how many in production appear in the short queue, beside the next action. */
const IN_QUEUE = 3;

/**
 * The art travels to the review stage and back (kit/artTransition): on click, only the clicked art carries the
 * transition name; on the way back, that of the post opened last. `data-arte-vt` lets `markArt` remove the name that
 * came from here.
 */
const travel = (id: string) => (e: MouseEvent<HTMLAnchorElement>) => {
  markArt(e.currentTarget.querySelector<HTMLElement>("[data-arte]"));
  rememberArt(id);
};
const artName = (id: string) => (artRemembered() === id ? { style: { viewTransitionName: ART_NAME }, "data-arte-vt": "" } : {});

const postCaption = (p: PieceQueue) => [DESK[p.editoria ?? ""] ?? p.editoria, formatLabel(p.formato, p.ncards)].filter(Boolean).join(" · ");
/** "3 days ago"; whatever just arrived is only "now". */
const agoHowMuch = (sql: string) => { const e = waitFor(sql); return e === t("agora", "now") ? e : t(`há ${e}`, `${e} ago`); };

/**
 * What asks for you now: on the left, the post that has waited longest, in a single block (the cover identifies; the
 * check happens in review); on the right, the short queue, with the following posts and what is producing. With more
 * than four waiting, the rest is one click away, in To approve.
 */
function Now({ pecas: pieces, total, decide: decides }: { pecas: PieceQueue[]; total: Record<string, number>; decide: boolean }) {
  const ready = pieces.filter((p) => p.status === "revisao");
  // What is producing, from the oldest (the one that arrives first) to the newest, as in the sidebar card.
  const producing = pieces.filter((p) => p.status === "rascunho").sort((a, b) => instant(a.created_at) - instant(b.created_at));
  // Counted in the database: the list stops at 50.
  const wait = Math.max(total.revisao ?? 0, ready.length);
  const [next, ...rest] = ready;
  const following = rest.slice(0, IN_QUEUE);
  const inProduction = producing.slice(0, IN_QUEUE);
  const moreProducing = Math.max(total.rascunho ?? 0, producing.length) - inProduction.length;
  const hasQueue = following.length + inProduction.length > 0;
  return (
    <section className="agora" aria-label={t("Agora", "Now")}>
      {next ? <Next peca={next} esperam={wait} decide={decides} sozinha={!hasQueue} /> : (
        <div className="proxima">
          <span className="prova-arte shadow-[inset_0_0_0_1px_var(--color-fio-forte)]"><span aria-hidden="true" className="prova-vaga"><RecordIcon /></span></span>
          <span className="proxima-corpo">
            <span className="lat-rotulo">{t("Mesa limpa", "Clear desk")}</span>
            <h2>{decides ? t("Nada esperando a sua revisão", "Nothing waiting for your review") : t("Nada esperando aprovação", "Nothing waiting for approval")}</h2>
            <span className="mono text-apoio">{t("O que está em produção chega aqui sozinho.", "What's in production lands here on its own.")}</span>
          </span>
        </div>
      )}
      {hasQueue && (
        <div className="fila-curta">
          <div className="secao mb-1.5">
            <h2 className="m-0">{t("Na fila", "In the queue")}</h2>
            {/* A 44 px target on mobile and 30 on desktop, without fattening the title row: the negative margin gives the height back. */}
            {wait > IN_QUEUE + 1
              ? <Link to="aprovar" viewTransition className="link-acao relative z-[1] -my-4 inline-flex min-h-11 items-center tracking-[.01em] normal-case lg:-my-2 lg:min-h-[30px]">{t(`ver os ${wait}`, `see all ${wait}`)}</Link>
              : inProduction.length > 0 ? <span className="tracking-[.01em] text-apoio normal-case">{t("o que está produzindo chega aqui", "what's in production lands here")}</span> : null}
          </div>
          {following.map((p, i) => <QueueLine key={p.id} peca={p} n={i + 2} />)}
          {inProduction.map((p) => <ProductionLine key={p.id} peca={p} />)}
          {moreProducing > 0 && <p className="mono m-0 mt-1.5 text-apoio">{t(`+${moreProducing} produzindo`, `+${moreProducing} in production`)}</p>}
        </div>
      )}
    </section>
  );
}

function Next({ peca: p, esperam: wait, decide: decides, sozinha: alone }: { peca: PieceQueue; esperam: number; decide: boolean; sozinha: boolean }) {
  const { veiculo: outlet } = useShell();
  const qc = useQueryClient();
  const point = useWarm(() => void warmPost(qc, outlet.id, p.id));
  return (
    <Link to={`p/${p.id}`} viewTransition data-proxima={decides ? "" : undefined} className={`proxima ${alone ? "col-span-full" : ""}`} onClick={travel(p.id)} {...point}>
      <span data-arte="" className="prova-arte corte" data-pilha={p.formato === "carrossel" ? "" : undefined} {...artName(p.id)}>
        {p.capa ? <img src={p.capa} alt="" width={540} height={675} decoding="async" /> : <span aria-hidden="true" className="prova-vaga" />}
      </span>
      <span className="proxima-corpo">
        <span className="lat-rotulo">
          {decides ? t(`Para aprovar · ${wait} ${wait === 1 ? "espera" : "esperam"} você`, `To approve · ${wait} waiting for you`) : t("Prontos para aprovar", "Ready to approve")}
        </span>
        <h2>{p.manchete ?? p.titulo}</h2>
        <span className="mono proxima-meta">
          <span>{postCaption(p)}</span>
          <span>{t(`espera há ${waitFor(p.updated_at)}`, `waiting ${waitFor(p.updated_at)}`)}</span>
        </span>
        {decides
          ? <span className="acao-lapis -ml-[6px]"><span>{t("Revisar a próxima", "Review the next one")}</span><BackPencil desenhar /></span>
          : <span className="link-acao inline-flex min-h-11 items-center">{t("Ver", "View")}</span>}
      </span>
    </Link>
  );
}

function QueueLine({ peca: p, n }: { peca: PieceQueue; n: number }) {
  const { veiculo: outlet } = useShell();
  const qc = useQueryClient();
  const point = useWarm(() => void warmPost(qc, outlet.id, p.id));
  return (
    <Link to={`p/${p.id}`} viewTransition className="fila-linha" onClick={travel(p.id)} {...point}>
      <span aria-hidden="true" className="prova-n">{String(n).padStart(2, "0")}</span>
      <span data-arte="" className="fila-mini" data-vaga={p.capa ? undefined : ""} {...artName(p.id)}>
        {p.capa && <img src={p.capa} alt="" width={68} height={85} loading="lazy" decoding="async" />}
      </span>
      <span className="min-w-0">
        <b>{p.manchete ?? p.titulo}</b>
        <span className="mono block truncate">{postCaption(p)}</span>
      </span>
      <span className="mono">{agoHowMuch(p.updated_at)}</span>
    </Link>
  );
}

/** The post being produced: the step comes from the light status, as in the sidebar's "In production" card. */
function ProductionLine({ peca: p }: { peca: PieceQueue }) {
  const { veiculo: outlet } = useShell();
  const qc = useQueryClient();
  const status = useStatusPiece(outlet.id, p.id);
  // Left draft (became ready or failed): the lists refresh right away, without waiting for the next 5 s round.
  const finished = !!status.data && status.data.status !== "rascunho";
  useEffect(() => {
    if (!finished) return;
    qc.invalidateQueries({ queryKey: keys.pecas(outlet.id) });
    qc.invalidateQueries({ queryKey: keys.pautas(outlet.id) });
  }, [finished, qc, outlet.id]);
  const stage = status.data?.etapa ?? null;
  const step = finished ? STEPS.length : stage ? STEPS.indexOf(stage) + 1 : 0;
  return (
    <Link to={`p/${p.id}`} viewTransition className="fila-linha">
      <span aria-hidden="true" className="prova-n bg-transparent text-apoio shadow-[inset_0_0_0_1px_var(--color-fio-forte)]">··</span>
      <span aria-hidden="true" className="fila-mini" data-vaga="" />
      <span className="min-w-0">
        <b>{p.manchete ?? p.titulo}</b>
        {/* The steps in graphite (progress is not an action): finished ones solid, the current one with the running stroke. */}
        <span aria-hidden="true" className="etapas">
          {STEPS.map((e, i) => <i key={e} data-feita={finished || i < step - 1 ? "" : undefined} data-agora={!finished && i === Math.max(step - 1, 0) ? "" : undefined} />)}
        </span>
      </span>
      <span className="mono">{step ? t(`etapa ${step} de ${STEPS.length}`, `step ${step} of ${STEPS.length}`) : t("começando", "starting")}</span>
    </Link>
  );
}

// ── filter by city ──────────────────────────────────────────────────────────────────────────────────────────────

function FilterCity({ areas, cidade: city }: { areas: Area[]; cidade: string | null }) {
  return (
    <nav aria-label={t("Cidade", "City")} className="flex flex-wrap items-center gap-1.5">
      <Link to="?" replace preventScrollReset aria-current={city === null ? "page" : undefined} className="chip">{t("Todas", "All")}</Link>
      {areas.map((a) => (
        <Link key={a.ibge} to={`?cidade=${a.ibge}`} replace preventScrollReset aria-current={city === a.ibge ? "page" : undefined} className="chip">
          {areaLabel(a)}
        </Link>
      ))}
    </nav>
  );
}

// ── suggested ideas: the list and the lead sheet ────────────────────────────────────────────────────────────────

/** From 1180 px up the chosen idea opens in the lead sheet, beside the list (desk.css hides the sheet below that). */
const WITH_SHEET = "(min-width: 1180px)";
/** Without a new idea, how many stay in view before "More ideas": with the sheet beside it, the list follows its height. */
const VIEW = { lista: 6, coluna: 3 };

const originOf = (p: Lead) =>
  p.origem === "manual" ? t("trazida pela equipe", "brought in by the team") : p.origem === "site" ? t("do seu site", "from your site") : p.origem === "resumo" ? t("resumo do dia", "daily roundup") : null;
const deskOf = (p: Lead) => DESK[p.editoria ?? ""] ?? p.editoria;
const twoDigits = (n: number) => String(n).padStart(2, "0");

/** What each format produces: the one-line help (below 1180 px) and the description of each sheet button come from here. */
const THAT_PRODUCES: Record<Format, () => string> = {
  post: () => t("1 imagem com a manchete e 1 ou 2 frases", "1 image with the headline and 1 or 2 sentences"),
  carrossel: () => t("4 cards (capa, o que aconteceu, contexto, convite)", "4 cards (cover, what happened, context, invite card)"),
};

/** What can be done with an idea. The state lives in the list (Suggested): the row and the lead sheet show the same. */
type ActionsIdea = {
  formato: Format; trocarFormato: (f: Format) => void;
  produzir: () => void; produzindo: boolean;
  confirmando: boolean; pedirDescarte: () => void; cancelarDescarte: () => void; descartar: () => void; descartando: boolean;
  erro: Error | null; ocupado: boolean;
};

function Suggested({ pautas: leads, anterior: previous, podeProduzir: canProduce, lapis: pencil, trazida: brought, mostrarCidade: showCity, filtro: filter }:
  { pautas: Lead[]; anterior: number | null; podeProduzir: boolean; lapis: boolean; trazida?: Brought; mostrarCidade: boolean; filtro: ReactNode }) {
  const { veiculo: outlet } = useShell();
  const navigate = useNavigate();
  const local = useLocation();
  const qc = useQueryClient();
  const withSheet = useMedia(WITH_SHEET);
  const created = previous === null ? [] : leads.filter((p) => newSince(p.created_at, previous));
  const seen = previous === null ? leads : leads.filter((p) => !newSince(p.created_at, previous));
  // In view, only what asks for a decision now: the new ones or, with none new, the first in the list. The rest sits in a row with the count.
  // It applies on arrival: changing the window width does not move an idea between lists.
  const view = useRef(withSheet ? VIEW.lista : VIEW.coluna).current;
  const openItems = created.length ? created : seen.slice(0, view);
  const closed = created.length ? seen : seen.slice(view);
  const failures = closed.filter((p) => p.falhou !== null).length;
  // The chosen idea lives in the URL (`?ideia=`). Chosen in a closed part, a failure or an idea just brought in: the part opens.
  const [params, setParams] = useSearchParams();
  const requested = params.get("ideia");
  const [more, openMore] = usePart("ideias", failures || closed.some((p) => p.id === brought?.pautaId || p.id === requested) ? "todas" : null);
  const open = more === "todas";
  const visible = open ? [...openItems, ...closed] : openItems;
  // Without a parameter, the first (or the one just brought in): the next action never falls into a closed part.
  const chosen = visible.find((p) => p.id === requested) ?? visible.find((p) => p.id === brought?.pautaId) ?? visible[0];

  // Each idea's format and discard step live here, above the row and the sheet: crossing 1180 px loses nothing.
  const [formats, setFormats] = useState<Record<string, Format>>({});
  const [confirming, setConfirming] = useState<string | null>(null);
  const choose = (id: string) => {
    setConfirming(null);
    setParams((p) => { p.set("ideia", id); return p; }, { replace: true, preventScrollReset: true, state: local.state });
  };
  const update = () => Promise.all([
    qc.invalidateQueries({ queryKey: keys.pautas(outlet.id) }),
    qc.invalidateQueries({ queryKey: keys.pecas(outlet.id) }),
  ]);
  const produce = useMutation({
    mutationFn: (v: { id: string; formato: Format }) => read(api.t[":tenantId"].pautas[":id"].produzir.$post({ param: { tenantId: outlet.id, id: v.id } }, bodyJson({ formato: v.formato }))),
    onSuccess: (r) => { update(); navigate(`p/${r.pecaId}`); },
    onError: (e) => { if (e instanceof ApiError && e.status === 409) update(); },
  });
  const discard = useMutation({
    mutationFn: (id: string) => read(api.t[":tenantId"].pautas[":id"].descartar.$post({ param: { tenantId: outlet.id, id } }, bodyJson({}))),
    onSuccess: (_r, id) => {
      // With the sheet, the choice passes to the neighbour (the one below; at the end of the list, the one above), to discard in sequence without going back to the top.
      const i = visible.findIndex((p) => p.id === id);
      const neighbor = visible[i + 1] ?? visible[i - 1];
      if (withSheet && chosen?.id === id && neighbor) choose(neighbor.id); else setConfirming((c) => (c === id ? null : c));
      update();
    },
    onError: (e) => { if (e instanceof ApiError && e.status === 409) update(); },
  });
  const format = (id: string) => formats[id] ?? "carrossel";
  const actionsOf = (p: Lead): ActionsIdea => ({
    formato: format(p.id),
    trocarFormato: (f) => setFormats((m) => ({ ...m, [p.id]: f })),
    produzir: () => produce.mutate({ id: p.id, formato: format(p.id) }),
    produzindo: produce.isPending && produce.variables.id === p.id,
    confirmando: confirming === p.id,
    pedirDescarte: () => setConfirming(p.id),
    cancelarDescarte: () => { setConfirming(null); discard.reset(); },
    descartar: () => discard.mutate(p.id),
    descartando: discard.isPending && discard.variables === p.id,
    erro: (produce.variables?.id === p.id ? produce.error : null) ?? (discard.variables === p.id ? discard.error : null),
    ocupado: produce.isPending || discard.isPending || produce.isSuccess,
  });

  // Single-key shortcuts (DESIGN.md §6.12), only where the lead sheet exists: J/K and ↓/↑ move through the list, 1 and 2
  // switch the format, P moves focus to Produce and X opens the discard step (the key opens; the button decides, with Enter).
  const produceButton = useRef<HTMLButtonElement>(null);
  const shortcut = useRef<(e: KeyboardEvent) => void>(() => {});
  shortcut.current = (e) => {
    if (!withSheet || !chosen || e.shiftKey) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const step = k === "j" || k === "ArrowDown" ? 1 : k === "k" || k === "ArrowUp" ? -1 : 0;
    if (step) {
      if (!freeShortcut(e, true)) return;
      const neighbor = visible[visible.findIndex((p) => p.id === chosen.id) + step];
      if (!neighbor) return;   // at the end of the list, the arrow goes back to scrolling the page
      e.preventDefault();
      choose(neighbor.id);
      document.getElementById(`pauta-${neighbor.id}`)?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (!canProduce || !["p", "x", "1", "2"].includes(k) || !freeShortcut(e)) return;
    e.preventDefault();
    if (k === "p") produceButton.current?.focus();
    else if (k === "x") setConfirming(chosen.id);
    else setFormats((m) => ({ ...m, [chosen.id]: FORMATS[k === "1" ? 0 : 1].valor }));
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => shortcut.current(e);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const sources = useSources(outlet.id);
  const nSources = sources.data?.fontes.length ?? 0;
  const group = created.length
    ? { id: "novas", titulo: t("Ideias novas", "New ideas"), lado: t(`${created.length} desde a última visita`, `${created.length} since your last visit`) }
    : {
        id: "vistas", titulo: t("Ideias sugeridas", "Suggested ideas"),
        lado: nSources ? [
          t(`de ${nSources} ${nSources === 1 ? "fonte" : "fontes"}`, `from ${nSources} ${nSources === 1 ? "source" : "sources"}`),
          sources.data?.coletaEm ? t(`coleta ${hour(sources.data.coletaEm)}`, `fetched ${hour(sources.data.coletaEm)}`) : null,
        ].filter(Boolean).join(" · ") : "",
      };
  let n = 0;
  const line = (p: Lead) => {
    n += 1;
    const current = p.id === chosen?.id;
    return <LeadLine key={p.id} pauta={p} numero={n} nova={newSince(p.created_at, previous)} atual={current} comFolha={withSheet} escolher={() => choose(p.id)}
      acoes={actionsOf(p)} podeProduzir={canProduce} lapis={pencil && current} mostrarCidade={showCity}
      aviso={p.id === brought?.pautaId ? newWarning(brought.situacao, brought.status) : undefined} />;
  };
  const count = closed.length === 1 ? t("1 ideia", "1 idea") : t(`${closed.length} ideias`, `${closed.length} ideas`);
  return (
    <section aria-labelledby={`grupo-${group.id}`}>
      <h2 id={`grupo-${group.id}`} className="secao m-0">{group.titulo} <span className="tracking-[.01em] text-apoio normal-case">{group.lado}</span></h2>
      {/* The list's bar: the city filter on the left; on the right, the shortcuts (where the sheet exists) or what each format produces. */}
      <div className="barra-lista">
        <div>{filter}</div>
        {canProduce && !withSheet && <p id="formato-ajuda" className="ajuda m-0 max-w-[62ch]">{FORMATS.map((f) => `${f.rotulo}: ${THAT_PRODUCES[f.valor]()}`).join(" · ")}</p>}
        <p className="dicas m-0">
          <span><span className="kbd">J</span><span className="kbd">K</span> {t("andar", "move")}</span>
          {canProduce && (
            <>
              <span><span className="kbd">P</span> {t("produzir", "produce")}</span>
              <span><span className="kbd">1</span><span className="kbd">2</span> {t("formato", "format")}</span>
              <span><span className="kbd">X</span> {t("descartar", "discard")}</span>
            </>
          )}
        </p>
      </div>
      <div className="pauta-mesa">
        <div className="min-w-0">
          <ol className="pauta-lista">{openItems.map(line)}</ol>
          {closed.length > 0 && (
            <>
              <h2 className="m-0">
                <button type="button" data-linha className="parte-linha" aria-expanded={open} aria-controls={open ? "ideias-vistas" : undefined} onClick={() => openMore(open ? null : "todas")}>
                  <span>{created.length ? t("Já vistas", "Already seen") : t("Mais ideias", "More ideas")}</span>
                  <span className={`mono ${failures ? "text-terracota" : ""}`}>
                    {failures ? t(`${count} · ${failures === 1 ? "1 falhou" : `${failures} falharam`}`, `${count} · ${failures} failed`) : count} · {open ? t("recolher", "hide") : t("mostrar", "show")}
                  </span>
                </button>
              </h2>
              {open && <ol id="ideias-vistas" className="pauta-lista">{closed.map(line)}</ol>}
            </>
          )}
        </div>
        {withSheet && chosen && (
          <SheetLead pauta={chosen} numero={visible.indexOf(chosen) + 1} acoes={actionsOf(chosen)} podeProduzir={canProduce} lapis={pencil} mostrarCidade={showCity}
            refProduzir={produceButton} />
        )}
      </div>
    </section>
  );
}

const Advertising = ({ pauta: p }: { pauta: Lead }) => (
  <p className="m-0"><span className="carimbo">{t("Publicidade", "Advertisement")}</span>{p.anunciante ? <span className="mono ml-3 text-apoio">{p.anunciante}</span> : null}</p>
);
const Failed = ({ motivo: reason }: { motivo: string }) => (
  <p className="m-0 text-[15px] text-terracota">
    {t(`A última tentativa não deu certo: ${failureReason(reason).replace(/\.$/, "").toLowerCase()}. Dá para produzir de novo.`,
      `The last attempt didn't work: ${failureReason(reason).replace(/\.$/, "").toLowerCase()}. You can produce it again.`)}
  </p>
);

/**
 * An idea in the list: queue number, headline, time and the caption in mono. Where the lead sheet exists, the whole row
 * selects the idea (the title button covers the row); below 1180 px, the row carries its summary and its actions.
 */
function LeadLine({ pauta: p, numero: number, nova: created, atual: current, comFolha: withSheet, escolher: choose, acoes: actions, podeProduzir: canProduce, lapis: pencil, aviso: warning, mostrarCidade: showCity }: {
  pauta: Lead; numero: number; nova: boolean; atual: boolean; comFolha: boolean; escolher: () => void; acoes: ActionsIdea; podeProduzir: boolean; lapis: boolean;
  aviso?: string; mostrarCidade: boolean;
}) {
  const id = useId();
  const titleId = `${id}-t`;
  // The idea brought in by the "New idea" sheet: says what happened to it and scrolls to it if it is off screen (on
  // mobile, the posts in progress come first).
  const item = useRef<HTMLLIElement>(null);
  const brought = !!warning;
  useEffect(() => {
    const r = item.current?.getBoundingClientRect();
    if (brought && r && (r.top < 70 || r.top > innerHeight - 160)) item.current!.scrollIntoView({ block: "center" });
  }, [brought]);
  const headline = <>{created && <span aria-hidden="true" className="nova-pt" />}{p.titulo}</>;
  return (
    <li ref={item} id={`pauta-${p.id}`} style={ladder(number - 1)} aria-current={withSheet && current ? "true" : undefined}
      className="pauta-linha entra scroll-mt-[calc(var(--topo)+12px)] scroll-mb-4">
      <span aria-hidden="true" className="prova-n mt-0.5">{twoDigits(number)}</span>
      <h3 id={titleId}>
        {withSheet ? <button type="button" data-linha aria-controls="folha-pauta" onClick={choose}>{headline}</button> : headline}
      </h3>
      <span className="mono hora">{when(p.created_at)}</span>
      <span className="mono meta">
        <span>
          {[originOf(p), deskOf(p), p.fonte, showCity ? p.cidade : null, p.bairro, t(`${p.nfatos} ${p.nfatos === 1 ? "fato" : "fatos"}`, `${p.nfatos} ${p.nfatos === 1 ? "fact" : "facts"}`)]
            .filter(Boolean).join(" · ")}
        </span>
        {/* With the sheet, the whole reason is in it; the row only marks which idea failed. */}
        {withSheet && p.falhou !== null && <span className="text-terracota">{t("a produção falhou", "production failed")}</span>}
      </span>
      {(warning || p.tipo_post === "publicidade") && (
        <div className="grid justify-items-start gap-1.5 pt-0.5 [grid-column:2/-1]">
          {warning && <p role="status" className="m-0 text-[14.5px] font-bold text-texto-forte">{warning}</p>}
          {p.tipo_post === "publicidade" && <Advertising pauta={p} />}
        </div>
      )}
      {!withSheet && (p.resumo || p.falhou !== null || canProduce) && (
        <div className="pauta-cel">
          {p.resumo && <p className="m-0 line-clamp-3 max-w-[70ch] text-[15.5px] text-texto">{p.resumo}</p>}
          {p.falhou !== null && <Failed motivo={p.falhou} />}
          {canProduce && <Actions acoes={actions} tituloId={titleId} lapis={pencil} />}
        </div>
      )}
    </li>
  );
}

/**
 * The chosen idea's lead sheet: what the source brings, before producing. The footer stays pinned to the end of the
 * visible area, so Produce is always in view.
 */
function SheetLead({ pauta: p, numero: number, acoes: actions, podeProduzir: canProduce, lapis: pencil, mostrarCidade: showCity, refProduzir: refProduce }: {
  pauta: Lead; numero: number; acoes: ActionsIdea; podeProduzir: boolean; lapis: boolean; mostrarCidade: boolean; refProduzir: RefObject<HTMLButtonElement | null>;
}) {
  const id = useId();
  const titleId = `${id}-t`;
  return (
    <section id="folha-pauta" className="folha-pauta" aria-label={t("Folha de pauta", "Story sheet")}>
      <p className="mono folha-pauta-topo m-0">
        <span>{[t(`Pauta ${twoDigits(number)}`, `Story ${twoDigits(number)}`), deskOf(p), showCity ? p.cidade : null, p.bairro, when(p.created_at)].filter(Boolean).join(" · ")}</span>
        {p.fonte && <span>{p.fonte}</span>}
      </p>
      {p.tipo_post === "publicidade" && <Advertising pauta={p} />}
      <h2 id={titleId}>{p.titulo}</h2>
      {p.resumo && <p className="resumo">{p.resumo}</p>}
      {p.falhou !== null && <Failed motivo={p.falhou} />}
      {p.fatos.length > 0 && (
        <div className="grid gap-2">
          <h3 className="lat-rotulo m-0 font-normal">{t("Fatos que a fonte traz", "Facts from the source")}</h3>
          {/* The size goes on the icon: its default utility (22 px) would beat the `.fatos` rule, which is in the components layer. */}
          <ul className="fatos">{p.fatos.map((f, i) => <li key={i}><IconRight className="size-3.5" /><span>{f}</span></li>)}</ul>
        </div>
      )}
      {canProduce && (
        <div className="grid gap-2">
          <h3 id={`${id}-f`} className="lat-rotulo m-0 font-normal">{t("Formato", "Format")}</h3>
          <div className="formato" role="group" aria-labelledby={`${id}-f`}>
            {FORMATS.map((f, i) => (
              <button key={f.valor} type="button" aria-pressed={actions.formato === f.valor} aria-keyshortcuts={String(i + 1)} onClick={() => actions.trocarFormato(f.valor)}>
                <span className="mini" aria-hidden="true">{Array.from({ length: f.valor === "carrossel" ? 4 : 1 }, (_, j) => <i key={j} />)}</span>
                <span><b className="first-letter:uppercase">{f.rotulo}</b><span className="mono block">{THAT_PRODUCES[f.valor]()}</span></span>
              </button>
            ))}
          </div>
        </div>
      )}
      {canProduce && <Actions acoes={actions} tituloId={titleId} lapis={pencil} naFolha refProduzir={refProduce} />}
    </section>
  );
}

/**
 * An idea's Produce, format and Discard: in the lead sheet's footer (with the keys in view; the format sits above, on
 * the sheet) or on the row itself, below 1180 px. Discard asks for confirmation: the step opens with focus on "Remove".
 */
function Actions({ acoes: a, tituloId: titleId, lapis: pencil, naFolha: inSheet = false, refProduzir: refProduce }: { acoes: ActionsIdea; tituloId: string; lapis: boolean; naFolha?: boolean; refProduzir?: RefObject<HTMLButtonElement | null> }) {
  const { veiculo: outlet } = useShell();
  const remove = useRef<HTMLButtonElement>(null);
  const open = useRef<HTMLButtonElement>(null);
  const back = useRef(false);
  // Cancel returns focus to "Discard"; after removing, it is loose on the page, and the shortcuts keep working.
  useEffect(() => {
    if (a.confirmando) remove.current?.focus();
    else if (back.current) open.current?.focus();
    back.current = false;
  }, [a.confirmando]);
  const box = inSheet ? "folha-pauta-pe flex-wrap" : "flex flex-wrap items-center gap-2";
  // In the pinned footer the notice comes above (the buttons do not move); on the row, below.
  const error = a.erro && <div className={inSheet ? "order-first w-full" : "w-full"}><ErrorText e={a.erro} veiculo={outlet} /></div>;
  const high = inSheet ? "min-h-9" : "min-h-11";

  if (a.confirmando) {
    const cancel = () => { back.current = true; a.cancelarDescarte(); };
    return (
      <div className={box} role="group" aria-label={t("Descartar ideia", "Discard idea")} onKeyDown={(e) => { if (e.key === "Escape") cancel(); }}>
        <span className={inSheet ? "mr-auto text-[15px]" : "w-full text-[15px]"}>{t("Tirar esta ideia da lista?", "Remove this idea from the list?")}</span>
        {/* A held Enter does not confirm: whoever opened the step with the keyboard decides with a new press. */}
        <button ref={remove} type="button" className={`${high} cursor-pointer rounded-btn px-3 font-bold text-terracota hover:bg-terracota-claro disabled:cursor-not-allowed disabled:opacity-55 ${inSheet ? "" : "-ml-3"}`}
          disabled={a.ocupado} onKeyDown={(e) => { if (e.repeat) e.preventDefault(); }} onClick={a.descartar} aria-describedby={titleId}>
          {a.descartando ? t("Tirando…", "Removing…") : t("Tirar", "Remove")}
        </button>
        <button type="button" className={`${high} cursor-pointer rounded-btn px-3 text-texto-forte hover:bg-papel-2`} onClick={cancel}>
          {t("Cancelar", "Cancel")}
        </button>
        {error}
      </div>
    );
  }
  const label = a.produzindo ? t("Começando…", "Starting…") : t("Produzir", "Produce");
  return (
    <div className={box}>
      {pencil ? (
        <button ref={refProduce} type="button" className={`acao-lapis cursor-pointer ${inSheet ? "mr-2" : "-ml-[6px]"}`} disabled={a.ocupado} onClick={a.produzir} aria-describedby={titleId} aria-keyshortcuts={inSheet ? "P" : undefined}>
          <span>{label}</span><BackPencil desenhar />
        </button>
      ) : (
        <button ref={refProduce} type="button" className="btn-clara" disabled={a.ocupado} onClick={a.produzir} aria-describedby={titleId} aria-keyshortcuts={inSheet ? "P" : undefined}>
          {label}{inSheet && <span aria-hidden="true" className="kbd">P</span>}
        </button>
      )}
      {inSheet ? <span className="mono">{t("leva de 1 a 2 minutos", "takes 1 to 2 minutes")}</span> : (
        <div className="segmento" role="group" aria-label={t("Formato", "Format")} aria-describedby="formato-ajuda">
          {FORMATS.map((f) => <button key={f.valor} type="button" aria-pressed={a.formato === f.valor} onClick={() => a.trocarFormato(f.valor)}>{f.rotulo}</button>)}
        </div>
      )}
      {/* The name ("Discard idea") comes from the content, not from aria-label: with the key in view, the label would not match the text (WCAG 2.5.3). */}
      <button ref={open} type="button" disabled={a.ocupado} onClick={a.pedirDescarte} aria-describedby={titleId} aria-keyshortcuts={inSheet ? "X" : undefined}
        className={`${high} inline-flex cursor-pointer items-center rounded-btn px-[13px] text-[14px] font-semibold text-terracota hover:bg-terracota-claro disabled:cursor-not-allowed disabled:opacity-55 ${inSheet ? "" : "ml-auto"}`}>
        {t("Descartar", "Discard")}<span className="sr-only"> {t("ideia", "idea")}</span>{inSheet && <span aria-hidden="true" className="kbd ml-2">X</span>}
      </button>
      {error}
    </div>
  );
}

function ErrorText({ e, veiculo: outlet }: { e: Error; veiculo: Outlet }) {
  if (e instanceof ApiError && e.status === 402) return <LimitWarning mensagem={e.message} veiculo={outlet} codigo={e.codigo} />;
  const msg = e instanceof ApiError
    ? e.status === 0 ? t("Sem conexão. Confira a internet e tente de novo.", "No connection. Check your internet and try again.")
      : e.status === 409 ? t("Essa ideia já mudou: alguém começou a produzir ou tirou da lista. A lista foi atualizada.", "This idea already changed: someone started producing it or removed it from the list. The list was updated.")
        : e.status === 403 ? t("Só quem edita o veículo pode fazer isso.", "Only people who edit the publication can do this.")
          : t("Não deu certo agora. Tente de novo.", "That didn't work right now. Try again.")
    : t("Não deu certo agora. Tente de novo.", "That didn't work right now. Try again.");
  return <p role="alert" className="m-0 w-full text-[15px] text-terracota">{msg}</p>;
}

// ── sources on mobile (on desktop, source health lives in the folio and the sidebar) ────────────────────────────

function SourcesWarning({ tenantId }: { tenantId: string }) {
  const sources = useSources(tenantId);
  const outside = sources.data?.fontes.filter((f) => !f.ok) ?? [];
  if (!outside.length) return null;
  return (
    <details className="faixa-aviso mb-6 lg:hidden">
      <summary className="-my-2 flex min-h-11 cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="size-2 flex-none rounded-full bg-ambar" />
        <span>{outside.length === 1 ? t("1 fonte indisponível", "1 source unavailable") : t(`${outside.length} fontes indisponíveis`, `${outside.length} sources unavailable`)}</span>
        <span className="ml-auto font-bold underline underline-offset-3">{t("detalhes", "details")}</span>
      </summary>
      <ul className="m-0 mt-2 list-none p-0 text-[14px]">
        {outside.map((f) => (
          <li key={f.id}>{f.nome}: {t(`a última coleta não respondeu${f.coletadaEm ? ` (${when(f.coletadaEm)})` : ""}. As outras seguem trazendo notícia.`,
            `the last check got no response${f.coletadaEm ? ` (${when(f.coletadaEm)})` : ""}. The others keep bringing in news.`)}</li>
        ))}
      </ul>
    </details>
  );
}

// ── vazio e carga ───────────────────────────────────────────────────────────────────────────────────────────────

function Empty() {
  const { pathname } = useLocation();
  return (
    <section aria-labelledby="vazio" className="grid justify-items-start gap-5 py-2 lg:grid-cols-[400px_1fr] lg:items-center lg:gap-14 lg:py-6">
      <img src={vazio1x} srcSet={`${vazio1x} 1x, ${vazio2x} 2x`} width={436} height={259} alt="" className="h-auto w-[180px] sm:w-[400px]" />
      <div className="grid justify-items-start gap-2">
        <h2 id="vazio" className="manchete m-0 text-[24px] lg:text-[32px]">{t("Nenhuma ideia por enquanto", "No ideas yet")}</h2>
        <p className="m-0 max-w-[50ch]">
          {t("Quando chegar notícia da sua área pelas fontes, ela aparece aqui, da mais relevante para a menos. Se você já tem uma notícia em mãos, comece por ela.",
            "When news from your area comes in through the sources, it shows up here, most relevant first. If you already have a story in hand, start with it.")}
        </p>
        <Link to={{ pathname, search: "?nova=link" }} state={{ folha: true }} className="acao-lapis mt-2 -ml-[6px]">
          <span>{t("Nova ideia", "New idea")}</span>
          <BackPencil desenhar />
        </Link>
      </div>
    </section>
  );
}

/** The screen's same grid while loading: list rows and, where it exists, the lead sheet. */
function Skeleton() {
  return (
    <div aria-busy="true" className="grid gap-6">
      <p role="status" className="sr-only">{t("Carregando as ideias", "Loading ideas")}</p>
      <div className="esqueleto h-3 w-40" />
      <div className="pauta-mesa">
        <div className="pauta-lista">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="pauta-linha">
              <div className="esqueleto h-5 w-7" />
              <div className="grid gap-2">
                <div className="esqueleto h-5 w-[min(34ch,90%)]" />
                <div className="esqueleto h-3 w-[min(44ch,70%)]" />
              </div>
              <div className="esqueleto h-3 w-10" />
            </div>
          ))}
        </div>
        <div className="esqueleto hidden h-[420px] xl:block" />
      </div>
    </div>
  );
}
