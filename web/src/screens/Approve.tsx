// To approve: the finished posts waiting to be read, whoever has waited longest first (the order comes from the API).
// Under the title, how many are waiting and how long the oldest has waited. Two views, kept in the URL
// (`?vista=lista`): the proof desk (kit/Proof: the large cover, the queue number and the written wait, "waiting 23 h ·
// ready yesterday, 23:08", over a bar proportional to the oldest; the whole card opens the post and the pencil loop
// marks "Review the next one") and the list, one row per post, for a long queue. Below, what is still in production,
// with each one's step. Empty points to Ideas. The same query as the shell (counter) and Ideas: no extra request for the queue.
import { useQueryClient } from "@tanstack/react-query";
import type { MouseEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { warmPost } from "../warmup";
import { useShell } from "../shell/context";
import { IconGrid, IconList } from "../shell/icons";
import { FailureLoad, Parts, useTitle } from "../common";
import { DESK, STEPS, waitFor, fractionWait, instant, when, stepLabel, formatLabel, usePieces, useStatusPiece, type PieceQueue } from "../queue";
import { t } from "../language";
import { BackPencil } from "../kit/Pencil";
import { DeskLine, DeskSkeleton, EmptyDesk, ProofPost, Ruler, artThatBack, takeArt, useWarm } from "../kit/Proof";

export default function Approve() {
  const { veiculo: outlet } = useShell();
  useTitle(t("Para aprovar", "To approve"), outlet.nome);
  const pieces = usePieces(outlet.id);
  const ready = pieces.data?.pecas.filter((p) => p.status === "revisao") ?? [];
  const total = Math.max(pieces.data?.total.revisao ?? 0, ready.length);
  const producing = pieces.data?.total.rascunho ?? 0;
  // In production: from the oldest (the one that arrives first), as in the sidebar card.
  const drafts = (pieces.data?.pecas ?? []).filter((p) => p.status === "rascunho").sort((a, b) => instant(a.created_at) - instant(b.created_at));
  const loaded = !pieces.isPending && !pieces.isError;
  const agoQueue = loaded && ready.length > 0;
  const ideas = `/t/${outlet.slug}`;
  // Whoever only brings ideas does not decide: the list is read-only ("View"), with no hand mark on an action that is not theirs.
  const decides = outlet.papel !== "reporter";
  const qc = useQueryClient();
  // Desk or list: the choice lives in the URL (the desk is the default and takes no parameter).
  const [params, setParams] = useSearchParams();
  const inList = params.get("vista") === "lista";
  const seeAs = (list: boolean) => setParams((p) => { if (list) p.set("vista", "lista"); else p.delete("vista"); return p; }, { replace: true, preventScrollReset: true });

  return (
    <div className="mx-auto max-w-[1280px] px-5 pt-6 pb-14 lg:px-12 lg:pt-3">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="titulo-tela m-0 text-[32px] lg:text-[34px]">{t("Para aprovar", "To approve")}</h1>
          {agoQueue && <DeskLine forte={howManyWait(total, decides)} partes={[agoHowMuch(total, ready[0].updated_at)]} />}
        </div>
        {agoQueue && (
          <div className="segmento" role="group" aria-label={t("Como ver", "View as")}>
            <button type="button" aria-pressed={!inList} onClick={() => seeAs(false)}><IconGrid className="size-[15px]" />{t("Mesa", "Desk")}</button>
            <button type="button" aria-pressed={inList} onClick={() => seeAs(true)}><IconList className="size-[15px]" />{t("Lista", "List")}</button>
          </div>
        )}
      </header>
      {pieces.isPending ? (
        <div className="mt-8">
          <p role="status" className="sr-only">{t("Carregando os posts", "Loading posts")}</p>
          <DeskSkeleton />
        </div>
      ) : pieces.isError ? (
        <div className="mt-6"><FailureLoad oque={t("os posts para aprovar", "the posts to approve")} tentar={() => pieces.refetch()} /></div>
      ) : !ready.length ? (
        <EmptyDesk rotulo={t("sem provas", "no proofs")}>
          <p className="m-0 text-[19px] text-texto-forte">{t("Nada esperando a sua aprovação.", "Nothing is waiting for your approval.")}</p>
          <p className="m-0 max-w-[52ch] text-apoio">
            {producing
              ? t(`${producing === 1 ? "1 post está" : `${producing} posts estão`} sendo produzido${producing === 1 ? "" : "s"}; aparece${producing === 1 ? "" : "m"} aqui quando ficar${producing === 1 ? "" : "em"} pronto${producing === 1 ? "" : "s"}.`,
                producing === 1 ? "1 post is in production; it shows up here when it's ready." : `${producing} posts are in production; they show up here when they're ready.`)
              : t("Mande produzir uma ideia: quando o post ficar pronto, ele aparece aqui para você conferir.", "Send an idea to production: when the post is ready, it shows up here for you to check.")}
          </p>
          <Link to={ideas} className="acao-lapis -ml-[6px]"><span>{t("Ver as ideias", "See the ideas")}</span><BackPencil desenhar /></Link>
        </EmptyDesk>
      ) : (
        <>
          {inList ? (
            <List prontas={ready} slug={outlet.slug} decide={decides} aquecer={(id) => void warmPost(qc, outlet.id, id)} />
          ) : (
            <ul className="mesa m-0 mt-[26px] list-none p-0">
              {ready.map((p, i) => <Item key={p.id} peca={p} n={i + 1} slug={outlet.slug} maisAntiga={ready[0].updated_at} proxima={decides && i === 0} decide={decides}
                aquecer={() => void warmPost(qc, outlet.id, p.id)} />)}
            </ul>
          )}
          {total > ready.length && <p className="mono m-0 mt-2 text-apoio">{t(`e mais ${total - ready.length}, que aparecem conforme estes saírem`, `and ${total - ready.length} more, shown as these go out`)}</p>}
        </>
      )}
      {loaded && drafts.length > 0 && <InProduction rascunhos={drafts} mais={Math.max(producing - drafts.length, 0)} tenantId={outlet.id} slug={outlet.slug} />}
    </div>
  );
}

/** "4 waiting for you". For someone who only brings ideas nothing waits for them: "4 waiting for approval". */
function howManyWait(n: number, decides: boolean) {
  if (decides) return n === 1 ? t("1 espera você", "1 waiting for you") : t(`${n} esperam você`, `${n} waiting for you`);
  return n === 1 ? t("1 espera aprovação", "1 waiting for approval") : t(`${n} esperam aprovação`, `${n} waiting for approval`);
}

/** "the oldest has waited 3 days" (Ideas' sentence); with a single post there is no "oldest": "ready yesterday, 23:08", as on the proof. */
function agoHowMuch(n: number, oldest: string) {
  return n === 1
    ? t(`pronto ${when(oldest)}`, `ready ${when(oldest)}`)
    : t(`o mais antigo espera há ${waitFor(oldest)}`, `the oldest has waited ${waitFor(oldest)}`);
}

const actionOf = (decides: boolean) => (decides ? t("Revisar", "Review") : t("Ver", "View"));

function Item({ peca: p, n, slug, maisAntiga: oldest, proxima: next, decide: decides, aquecer: warm }: { peca: PieceQueue; n: number; slug: string; maisAntiga: string; proxima: boolean; decide: boolean; aquecer: () => void }) {
  return (
    <ProofPost
      id={p.id} para={`/t/${slug}/p/${p.id}`} capa={p.capa} formato={p.formato} n={n}
      meta={[DESK[p.editoria ?? ""] ?? p.editoria, formatLabel(p.formato, p.ncards), p.rodada > 1 && t(`versão ${p.rodada}`, `version ${p.rodada}`)]}
      manchete={p.manchete ?? p.titulo}
      espera={t(`espera há ${waitFor(p.updated_at)} · pronto ${when(p.updated_at)}`, `waiting ${waitFor(p.updated_at)} · ready ${when(p.updated_at)}`)}
      fracao={fractionWait(p.updated_at, oldest)}
      acao={next ? t("Revisar a próxima", "Review the next one") : actionOf(decides)} proxima={next} onApontar={warm}
    />
  );
}

// ── lista ───────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The queue as a list: one row per post, in the desk's order. The art here only identifies (thumbnail); checking
 * happens in review. On mobile the number, the thumbnail, the headline and the action stay: section, format and wait
 * move below the headline.
 */
function List({ prontas: ready, slug, decide: decides, aquecer: warm }: { prontas: PieceQueue[]; slug: string; decide: boolean; aquecer: (id: string) => void }) {
  return (
    <div className="tabela-rola mt-6">
      <table className="tabela">
        <caption className="sr-only">{t("Posts para aprovar, quem espera há mais tempo primeiro", "Posts to approve, longest wait first")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("Nº", "No.")}</th>
            <th scope="col"><span className="sr-only">{t("Capa", "Cover")}</span></th>
            <th scope="col">{t("Manchete", "Headline")}</th>
            <th scope="col" className="so-largo">{t("Editoria", "Section")}</th>
            <th scope="col" className="so-largo">{t("Formato", "Format")}</th>
            <th scope="col" className="so-largo">{t("Espera", "Wait")}</th>
            <th scope="col"><span className="sr-only">{t("Ação", "Action")}</span></th>
          </tr>
        </thead>
        <tbody>
          {ready.map((p, i) => <Line key={p.id} peca={p} n={i + 1} para={`/t/${slug}/p/${p.id}`} maisAntiga={ready[0].updated_at} decide={decides} aquecer={() => warm(p.id)} />)}
        </tbody>
      </table>
    </div>
  );
}

function Line({ peca: p, n, para: to, maisAntiga: oldest, decide: decides, aquecer: warm }: { peca: PieceQueue; n: number; para: string; maisAntiga: string; decide: boolean; aquecer: () => void }) {
  const point = useWarm(warm);
  const headline = p.manchete ?? p.titulo;
  const desk = DESK[p.editoria ?? ""] ?? p.editoria;
  const format = [formatLabel(p.formato, p.ncards), p.rodada > 1 && t(`versão ${p.rodada}`, `version ${p.rodada}`)];
  // The art that travels to the post's stage is this row's thumbnail (kit/artTransition).
  const open = (e: MouseEvent<HTMLAnchorElement>) => takeArt(e, p.id, e.currentTarget.closest("tr")?.querySelector<HTMLElement>(".fila-mini") ?? null);
  return (
    <tr>
      <td><span className="prova-n">{String(n).padStart(2, "0")}</span></td>
      <td>
        <span className="fila-mini" data-vaga={p.capa ? undefined : ""} {...artThatBack(p.id)}>
          {p.capa && <img src={p.capa} alt="" width={68} height={85} loading="lazy" decoding="async" />}
        </span>
      </td>
      <td>
        <Link to={to} viewTransition {...point} onClick={open} className="font-semibold text-texto-forte no-underline hover:underline hover:decoration-fio-forte hover:underline-offset-4">{headline}</Link>
        {/* On mobile the three back columns disappear: what they say comes here, on one line. */}
        <span className="mono mt-0.5 block text-apoio lg:hidden">
          <Parts partes={[desk, ...format, t(`espera há ${waitFor(p.updated_at)}`, `waiting ${waitFor(p.updated_at)}`)]} />
        </span>
      </td>
      <td className="mono so-largo">{desk}</td>
      <td className="mono so-largo"><Parts partes={format} /></td>
      <td className="mono so-largo">
        <span className="flex items-center gap-2.5"><span className="w-24 flex-none"><Ruler fracao={fractionWait(p.updated_at, oldest)} /></span>{waitFor(p.updated_at)}</span>
      </td>
      <td className="text-right">
        <Link to={to} viewTransition {...point} onClick={open} className="link-acao inline-flex min-h-11 items-center">
          {actionOf(decides)}<span className="sr-only">: {headline}</span>
        </Link>
      </td>
    </tr>
  );
}

// ── in production ───────────────────────────────────────────────────────────────────────────────────────────────

/** What is still being made and arrives at this desk by itself: one row per post, with its current step, leading to the post. */
function InProduction({ rascunhos: drafts, mais: more, tenantId, slug }: { rascunhos: PieceQueue[]; mais: number; tenantId: string; slug: string }) {
  const several = drafts.length + more > 1;
  return (
    <section aria-labelledby="ap-producao" className="mt-10">
      <h2 id="ap-producao" className="secao m-0 mb-2">
        {t("Em produção", "In production")}
        <span className="text-apoio tracking-[.01em] normal-case">
          {several ? t("chegam aqui quando ficarem prontos", "they show up here when they're ready") : t("chega aqui quando ficar pronto", "it shows up here when it's ready")}
        </span>
      </h2>
      {drafts.map((p) => <ProductionLine key={p.id} peca={p} tenantId={tenantId} para={`/t/${slug}/p/${p.id}`} />)}
      {more > 0 && <p className="mono m-0 mt-2 text-apoio">{t(`e mais ${more} produzindo`, `and ${more} more in production`)}</p>}
    </section>
  );
}

/** A post being produced: the still-blank proof, the headline, the four steps and "step 2 of 4 · checking each sentence against the sources". Follows every 5 s (the same query as the sidebar card). */
function ProductionLine({ peca: p, tenantId, para: to }: { peca: PieceQueue; tenantId: string; para: string }) {
  const stage = useStatusPiece(tenantId, p.id).data?.etapa ?? null;
  const step = stage ? STEPS.indexOf(stage) + 1 : 0;
  return (
    <Link to={to} viewTransition className="fila-linha max-lg:gap-y-1">
      {/* No queue number and no art yet: the place of both stays marked. */}
      <span aria-hidden="true" className="prova-n bg-transparent text-apoio shadow-[inset_0_0_0_1px_var(--color-fio-forte)]">··</span>
      <span aria-hidden="true" className="fila-mini" data-vaga="" />
      <span className="min-w-0">
        <b>{p.manchete ?? p.titulo}</b>
        {/* The steps in graphite (progress is not an action): finished ones solid, the current one with the running stroke. */}
        <span aria-hidden="true" className="etapas">
          {STEPS.map((e, i) => <i key={e} data-feita={i < step - 1 ? "" : undefined} data-agora={i === Math.max(step - 1, 0) ? "" : undefined} />)}
        </span>
      </span>
      {/* On mobile the step moves below the headline, instead of squeezing the row. */}
      <span className="mono max-lg:col-start-3 max-lg:whitespace-normal">
        {stage
          ? t(`etapa ${step} de ${STEPS.length} · ${stepLabel(stage, p.formato).toLocaleLowerCase()}`, `step ${step} of ${STEPS.length} · ${stepLabel(stage, p.formato).toLocaleLowerCase()}`)
          : t("começando", "starting")}
      </span>
    </Link>
  );
}
