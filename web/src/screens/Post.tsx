// Ready to post: the approved posts, in order of arrival, on the same proof desk as To approve: each proof writes its
// wait ("waiting 14 h · approved today, 10:00"; with a noted time, it takes that place; one that posts by itself shows
// its progress). Under the title, how many there are and, when they all go to the same manual account, where to post.
// From 1180 px up the desk sits on the left and, on the right, the chosen post's panel (the same as the post screen's,
// ./Publish: the script for whoever posts by hand or the progress of one that posts by itself), without leaving the
// list: the chosen one lives in the URL (`?post=`; without the parameter, the first), its proof gets `aria-current` and
// the screen's hand mark is the pencil loop on the current step's action. Below that the proof opens the post screen and
// the loop marks "Post the next one" on the first one someone posts by hand. Empty points to To approve (or to Ideas, if
// nothing is waiting).
import { useState, type MouseEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { warmPost } from "../warmup";
import { useShell } from "../shell/context";
import { FailureLoad, useTitle } from "../common";
import { DESK, waitFor, fractionWait, accountName, alonePosts, when, formatLabel, readyStatus, usePieces, readyUse, useStatusPiece, type PieceQueue } from "../queue";
import { t } from "../language";
import { BackPencil } from "../kit/Pencil";
import { useMedia } from "../kit/Parts";
import { DeskLine, DeskSkeleton, EmptyDesk, ProofPost } from "../kit/Proof";
import { PanelPublish, type InList } from "./Publish";

/** The two-column width (the `xl` breakpoint, the same as `.postar-mesa`). */
const TWO_COLUMNS = "(min-width: 1180px)";

export default function Post() {
  const { veiculo: outlet } = useShell();
  useTitle(t("Prontos para postar", "Ready to post"), outlet.nome);
  const ready = readyUse(outlet.id);
  const list = ready.data?.pecas ?? [];
  const total = Math.max((ready.data?.total.aprovada ?? 0) + (ready.data?.total.agendada ?? 0), list.length);
  // Whoever only brings ideas does not post: the list is read-only ("View"), with no hand mark on an action that is not theirs.
  const posts = outlet.papel !== "reporter";
  const manual = list.filter((p) => !alonePosts(p.conta_modo));
  const first = posts ? manual[0]?.id : undefined;
  const qc = useQueryClient();

  const wide = useMedia(TWO_COLUMNS);
  const [params, setParams] = useSearchParams();
  // Confirmed here, the post leaves the desk, but the panel stays on it ("Posted", the link) until the person picks another.
  const [posted, setPosted] = useState<string | null>(null);
  const request = params.get("post");
  const chosen = wide && list.length ? posted ?? list.find((p) => p.id === request)?.id ?? list[0].id : undefined;
  const choose = (id: string) => {
    setPosted(null);
    setParams((p) => { p.set("post", id); return p; }, { replace: true, preventScrollReset: true });
  };
  // In two columns a plain click selects; Ctrl, ⌘, Shift and the middle button still open the post screen in another tab.
  const onClick = (id: string) => (e: MouseEvent) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    choose(id);
  };

  return (
    <div className="mx-auto max-w-[1280px] px-5 pt-6 pb-14 lg:px-12 lg:pt-3">
      <h1 className="titulo-tela m-0 text-[32px] lg:text-[34px]">{t("Prontos para postar", "Ready to post")}</h1>
      {!ready.isError && list.length > 0 && <DeskLine forte={total === 1 ? t("1 aprovado", "1 approved") : t(`${total} aprovados`, `${total} approved`)} partes={[posts && whereIfPosts(list)]} />}
      {ready.isPending ? (
        <div className="mt-8">
          <p role="status" className="sr-only">{t("Carregando os posts", "Loading posts")}</p>
          <DeskSkeleton />
        </div>
      ) : ready.isError ? (
        <div className="mt-6"><FailureLoad oque={t("os posts prontos para postar", "the posts ready to post")} tentar={() => ready.refetch()} /></div>
      ) : !list.length ? (
        <Empty />
      ) : (
        <div className="postar-mesa mt-[26px]">
          <div className="min-w-0">
            <ul className="mesa m-0 list-none p-0">
              {list.map((p, i) => <Item key={p.id} peca={p} n={i + 1} slug={outlet.slug} aquecer={() => void warmPost(qc, outlet.id, p.id)} maisAntiga={manual[0]?.updated_at ?? null}
                primeira={p.id === first} marca={!wide} posta={posts} atual={p.id === chosen} aoClicar={wide ? onClick(p.id) : undefined} />)}
            </ul>
            {total > list.length && <p className="mono m-0 mt-2 text-apoio">{t(`e mais ${total - list.length}, que aparecem conforme estes saírem`, `and ${total - list.length} more, shown as these go out`)}</p>}
          </div>
          {chosen && <Chosen key={chosen} id={chosen} lista={{ escolher: choose, aoConfirmar: () => setPosted(chosen) }} />}
        </div>
      )}
    </div>
  );
}

/**
 * "manual account: you post to @account": only when everything someone posts by hand goes to the same account (that is
 * what the list knows: each post's account). With different accounts, or only ones that post by themselves, the line
 * stays with the count.
 */
function whereIfPosts(list: PieceQueue[]) {
  const accounts = new Set(list.filter((p) => p.conta_modo === "manual").map((p) => accountName({ modo: "manual", nome: p.conta_nome, external_id: p.conta_external_id })));
  const [account] = accounts;
  return accounts.size === 1 && t(`conta manual: você posta em ${account}`, `manual account: you post on ${account}`);
}

/** The post chosen on the desk: its status (the same request as the post screen's, already warmed when pointing at the proof) and the publish panel. */
function Chosen({ id, lista: list }: { id: string; lista: InList }) {
  const { veiculo: outlet } = useShell();
  const status = useStatusPiece(outlet.id, id);
  if (status.data) return <PanelPublish s={status.data} lista={list} />;
  return (
    <section className="roteiro" aria-label={t("Roteiro de postagem", "Posting checklist")} aria-busy={status.isPending}>
      {status.isError ? <FailureLoad oque={t("o andamento", "the progress")} tentar={() => status.refetch()} /> : (
        <>
          <p role="status" className="sr-only">{t("Carregando o andamento", "Loading the progress")}</p>
          <div className="esqueleto h-3 w-36" />
          <div className="esqueleto h-6 w-[min(24ch,90%)]" />
          <div className="esqueleto h-28 w-full" />
        </>
      )}
    </section>
  );
}

function Empty() {
  const { veiculo: outlet } = useShell();
  const approve = usePieces(outlet.id).data?.total.revisao ?? 0;
  const base = `/t/${outlet.slug}`;
  return (
    <EmptyDesk rotulo={t("sem provas", "no proofs")}>
      <p className="m-0 text-[19px] text-texto-forte">{t("Nada para postar agora.", "Nothing to post right now.")}</p>
      <p className="m-0 max-w-[52ch] text-apoio">
        {approve
          ? t(`${approve === 1 ? "1 post espera" : `${approve} posts esperam`} a sua aprovação: aprovados, eles vêm para cá com as imagens e a legenda prontas.`,
            `${approve === 1 ? "1 post is waiting" : `${approve} posts are waiting`} for your approval: once approved, they come here with the images and caption ready.`)
          : t("Quando você aprovar um post, ele vem para cá com as imagens e a legenda prontas para o Instagram.",
            "When you approve a post, it comes here with the images and caption ready for Instagram.")}
      </p>
      {approve ? (
        <Link to={`${base}/aprovar`} viewTransition className="acao-lapis -ml-[6px]"><span>{t("Ver Para aprovar", "See To approve")}</span><BackPencil desenhar /></Link>
      ) : (
        <Link to={base} viewTransition className="acao-lapis -ml-[6px]"><span>{t("Ver as ideias", "See the ideas")}</span><BackPencil desenhar /></Link>
      )}
    </EmptyDesk>
  );
}

/** Approved on a manual account with no noted time: waits for someone to post. With a time (even past: "was due…") or posting by itself, the sentence is `readyStatus`'s. */
const withoutTime = (p: PieceQueue) => !alonePosts(p.conta_modo) && !p.agendado_para;
function readyWait(p: PieceQueue, now = new Date()) {
  return withoutTime(p)
    ? t(`espera há ${waitFor(p.updated_at, now)} · aprovado ${when(p.updated_at, now)}`, `waiting ${waitFor(p.updated_at, now)} · approved ${when(p.updated_at, now)}`)
    : readyStatus(p, now);
}

/**
 * `primeira`: the first one someone posts by hand ("Post the next one"). `marca`: the pencil loop sits on it (one
 * column); in two columns the mark belongs to the script, and the proof is the chosen one (`atual`) or selects on click
 * (`aoClicar`).
 */
function Item({ peca: p, n, slug, maisAntiga: oldest, primeira: first, marca: brand, posta: posts, aquecer: warm, atual: current, aoClicar: onClick }: {
  peca: PieceQueue; n: number; slug: string; maisAntiga: string | null; primeira: boolean; marca: boolean; posta: boolean; aquecer: () => void;
  atual: boolean; aoClicar?: (e: MouseEvent) => void;
}) {
  const alone = alonePosts(p.conta_modo);
  const account = p.conta_modo ? accountName({ modo: p.conta_modo, nome: p.conta_nome, external_id: p.conta_external_id }) : null;
  const hand = withoutTime(p);
  return (
    <ProofPost
      para={`/t/${slug}/p/${p.id}`} capa={p.capa} formato={p.formato} n={n}
      meta={[DESK[p.editoria ?? ""] ?? p.editoria, formatLabel(p.formato, p.ncards), account]}
      manchete={p.manchete ?? p.titulo}
      espera={readyWait(p)}
      fracao={hand && oldest ? fractionWait(p.updated_at, oldest) : null}
      acao={first ? t("Postar a próxima", "Post the next one") : alone ? t("Acompanhar", "Track") : posts ? t("Postar", "Post") : t("Ver", "View")} proxima={first && brand} onApontar={warm}
      atual={current} aoClicar={onClick}
    />
  );
}
