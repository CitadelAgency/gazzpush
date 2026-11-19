// Review (round 4, DESIGN.md §8 and §12): the post ready to approve. From 1180 px up, three columns: the queue in view,
// the proof's stage (card carousel, strips, counter) and the check column (validation that opens the checks, headline,
// sentences and sources, caption). Below that, one column in the same order. The way back and the pager sit in the
// shell's folio. The decision is a bar pinned to the bottom, on desktop and mobile: Approve (account and, optionally,
// time) · Rewrite (optional instruction, version n of 3) · Reject (reason); the step opens inside the bar, which grows
// upwards. The screen's hand mark is the check on Approve, drawn on confirming (DESIGN.md §4).
import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode, type RefObject } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router";
import { LAYOUT_NAME, LAYOUT_NAME_EN, isInvite, normalizeCards, type Card, type CardNormal } from "../../../src/lib/cards";
import { api, bodyJson, ApiError, read, type Success } from "../api";
import { warmPost } from "../warmup";
import { t as tr } from "../language";
import { ApprovalAdvertiser } from "./AdvertiserApproval";
import { SelectorModel } from "./Templates";
import { useShell } from "../shell/context";
import { InFolio, InFolioDir } from "../shell/Folio";
import { IconAlert, IconRight, IconEdit, IconReels, IconArrow, IconBack } from "../shell/icons";
import { FailureLoad, Parts, freeShortcut } from "../common";
import {
  DESK, MAX_VERSIONS, CARD_ROLE, keys, asPosts, fallbackVersion, factsText, timeScheduled, simpleIllustration, validationLine, withoutKeyIllustration,
  decisionMessage, accountName, noteApprove, noteWithoutAccount, when, whoDecides, useAccounts, useMembers, usePieces, type Account, type PieceQueue, type PieceStatus,
} from "../queue";
import { ART_NAME, rememberArt } from "../kit/artTransition";
import { SeenPencil } from "../kit/Pencil";
import { useMedia } from "../kit/Parts";
import { useWarm } from "../kit/Proof";
import { cameKeyboard } from "../motion";
import type { PreviewPiece } from "../onboarding/editPreview";

// Card editing loads only when opened: outside Review's JS.
const EditCarousel = lazy(() => import("./CarouselEditor"));

const t = api.t[":tenantId"].pecas[":id"];
type CompletePiece = Success<Awaited<ReturnType<typeof t.$get>>>;
type Fact = CompletePiece["fatos"][number];
type CardText = { id?: string; papel?: string; layout?: string; titulo: string; frases?: { texto: string; fatoId: string | null }[] };
type Content = { manchete?: string; legenda?: string; cards?: CardText[] };
type Validation = { ok: boolean; erros?: string[]; avisos?: string[]; porCard?: Record<string, string[]>; geral?: string[]; en?: { porCard?: Record<string, string[]>; geral?: string[] } } | null;

/** A post screen's width: the same as the decision bar's inner part (desk.css), so the edges line up. */
const SCREEN = "mx-auto w-full max-w-[1264px] pt-2 lg:px-10 lg:pt-3";

/**
 * `novaVersao`: the version changed since the post was opened (someone's rewrite, or your own, finished; someone else
 * edited the cards). `aceitarVersao`: the version the person saved themselves while editing becomes the seen one.
 */
export default function Review({ s, novaVersao: newVersion, aceitarVersao: acceptVersion, versaoAtual: currentVersion = s.versao }: {
  s: PieceStatus; novaVersao: "reescrita" | "edicao" | null; aceitarVersao: (v: number) => void;
  /** The version on the server; while editing, `s` stays on the open version and this one warns that someone else saved. */
  versaoAtual?: number;
}) {
  const { veiculo: outlet, marcarPeca: markPiece } = useShell();
  // Before painting: the sidebar already marks To approve on the first frame (the margin mark does not pass through Ideas).
  useLayoutEffect(() => { markPiece("revisao"); return () => markPiece(null); }, [markPiece]);
  // This post's art is the one that travels back to its proof, on the desk (kit/artTransition).
  useEffect(() => { rememberArt(s.id); }, [s.id]);
  // The full piece (art with URLs signed for 1 h): renews before expiring. The version goes into the key: after a
  // rewrite, the cached art belongs to another version and is no use.
  const piece = useQuery({
    queryKey: [...keys.peca(outlet.id, s.id), s.versao],
    queryFn: () => read(t.$get({ param: { tenantId: outlet.id, id: s.id } })),
    staleTime: 30 * 60_000,
    refetchInterval: 45 * 60_000,
  });
  // An image that does not load with stale data = an expired signed URL (a device that slept): fetch again.
  const imageFailed = () => { if (Date.now() - piece.dataUpdatedAt > 50 * 60_000) piece.refetch(); };
  const version = s.formato === "reels" ? tr("Reels · do carrossel", "Reel · from the carousel")
    : tr(`${s.formato} · versão ${s.rodada} de ${MAX_VERSIONS}`, `${s.formato === "carrossel" ? "carousel" : s.formato} · version ${s.rodada} of ${MAX_VERSIONS}`);

  return (
    <>
      {/* In the shell's folio: the way back, the post and the version; on the right, where it is in the queue. */}
      <InFolio>
        <Link to={`/t/${outlet.slug}/aprovar`} viewTransition className="max-lg:min-h-10"><IconBack className="size-4" /> {tr("Para aprovar", "To approve")}</Link>
        <span aria-hidden="true" className="sep">/</span>
        <b>{s.manchete ?? s.titulo}</b>
        <span className="mono so-largo">{version}</span>
      </InFolio>
      <InFolioDir><Pager id={s.id} /></InFolioDir>
      {piece.isError ? (
        <div className={`${SCREEN} grid gap-5 px-5 pb-12`}>
          <h1 className="manchete m-0 max-w-[28ch] text-[24px] lg:text-[32px]">{s.manchete ?? s.titulo}</h1>
          <FailureLoad oque={tr("o post", "the post")}tentar={() => piece.refetch()} />
        </div>
      ) : piece.isPending ? (
        <div className={`${SCREEN} px-5 pb-12`}><h1 className="sr-only">{s.manchete ?? s.titulo}</h1><Skeleton id={s.id} /></div>
      ) : (
        <Ready s={s} peca={piece.data} versao={version} imagemFalhou={imageFailed} novaVersao={newVersion} aceitarVersao={acceptVersion} versaoAtual={currentVersion} />
      )}
    </>
  );
}

// ── a fila ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** The posts in review, in To approve's order (the same query as the shell: whoever has waited longest first), and where this one is. */
function useQueue(id: string) {
  const { veiculo: outlet } = useShell();
  const queue = (usePieces(outlet.id).data?.pecas ?? []).filter((p) => p.status === "revisao");
  const i = queue.findIndex((p) => p.id === id);
  return { fila: queue, i, antes: i > 0 ? queue[i - 1] : undefined, depois: i >= 0 ? queue[i + 1] : undefined };
}

/**
 * Where this post is in the To approve queue ("3 of 5") and how to go to the neighbour: arrows and the keys J (next)
 * and K (previous). It lives in the folio. Only appears when the post is in the queue and there is more than one.
 */
function Pager({ id }: { id: string }) {
  const { veiculo: outlet } = useShell();
  const navigate = useNavigate();
  const { fila: queue, i, antes: before, depois: after } = useQueue(id);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!freeShortcut(e)) return;
      const k = e.key.toLowerCase();
      const target = k === "j" ? after : k === "k" ? before : undefined;
      if (target) { e.preventDefault(); navigate(`/t/${outlet.slug}/p/${target.id}`, { viewTransition: true }); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [before, after, navigate, outlet.slug]);
  if (i < 0 || queue.length < 2) return null;
  const arrow = "grid size-10 place-items-center rounded-btn lg:size-8";
  return (
    <nav aria-label={tr("Fila para aprovar", "Approval queue")} className="mono flex items-center gap-0.5 text-texto-forte">
      {before
        ? <Link to={`/t/${outlet.slug}/p/${before.id}`} viewTransition aria-label={tr("Post anterior (K)", "Previous post (K)")} data-dica={tr("Post anterior", "Previous post")} data-tecla="K" className={`${arrow} no-underline hover:bg-papel-2`}><IconBack className="size-[18px]" /></Link>
        : <span aria-hidden="true" className={`${arrow} text-fio-forte`}><IconBack className="size-[18px]" /></span>}
      <span aria-live="polite" className="min-w-[6ch] text-center">{i + 1} {tr("de", "of")} {queue.length}</span>
      {after
        ? <Link to={`/t/${outlet.slug}/p/${after.id}`} viewTransition aria-label={tr("Próximo post (J)", "Next post (J)")} data-dica={tr("Próximo post", "Next post")} data-tecla="J" className={`${arrow} no-underline hover:bg-papel-2`}><IconBack className="size-[18px] rotate-180" /></Link>
        : <span aria-hidden="true" className={`${arrow} text-fio-forte`}><IconBack className="size-[18px] rotate-180" /></span>}
    </nav>
  );
}

/** How many thumbnails the queue shows at once (the desktop column stays pinned while scrolling: it must fit on screen). */
const QUEUE_WINDOW = 7;

/**
 * The queue in view: the posts in review as thumbnails, each with its number; the open one, marked. On desktop it is
 * the first column; below 1180 px, a row that scrolls sideways. A long queue shows only the open one's neighbours and
 * says how many were left out ("+4"); the total is in the folio's pager.
 */
function SideQueue({ id }: { id: string }) {
  const { fila: queue, i } = useQueue(id);
  const list = useRef<HTMLOListElement>(null);
  // In the mobile row, the open post stays in view (only the row scrolls, never the page).
  useEffect(() => {
    const ol = list.current;
    const el = ol?.querySelector<HTMLElement>('[aria-current="true"]');
    if (ol && el && ol.scrollWidth > ol.clientWidth) ol.scrollLeft = el.offsetLeft - (ol.clientWidth - el.offsetWidth) / 2;
  }, [i, queue.length]);
  // Outside the queue (the list has not arrived yet): the column stays there, empty, so the stage does not move.
  if (i < 0) return <div aria-hidden="true" className="max-xl:hidden" />;
  const ini = Math.max(0, Math.min(i - Math.floor(QUEUE_WINDOW / 2), queue.length - QUEUE_WINDOW));
  const seen = queue.slice(ini, ini + QUEUE_WINDOW);
  const after = queue.length - ini - seen.length;
  return (
    <nav aria-label={tr("Posts na fila", "Posts in the queue")} className="rv-fila min-w-0">
      <span aria-hidden="true" className="lat-rotulo">{tr("Fila", "Queue")}</span>
      {ini > 0 && <span aria-hidden="true" className="mono text-apoio">+{ini}</span>}
      <ol ref={list}>
        {seen.map((p, k) => <ItemQueue key={p.id} p={p} n={ini + k + 1} atual={p.id === id} />)}
      </ol>
      {after > 0 && <span aria-hidden="true" className="mono text-apoio">+{after}</span>}
    </nav>
  );
}

function ItemQueue({ p, n, atual: current }: { p: PieceQueue; n: number; atual: boolean }) {
  const { veiculo: outlet } = useShell();
  const qc = useQueryClient();
  // Pointing at the neighbour already fetches its post (src/warmup.ts): the next review opens ready.
  const point = useWarm(current ? undefined : () => void warmPost(qc, outlet.id, p.id));
  const headline = p.manchete ?? p.titulo;
  return (
    <li>
      {/* The open one stays in the list (it is where the person is), but clicking it does not change the screen. */}
      <Link to={`/t/${outlet.slug}/p/${p.id}`} viewTransition aria-current={current ? "true" : undefined} data-dica={headline}
        onClick={(e) => { if (current) e.preventDefault(); }} {...point}>
        {/* The link's name is what is seen (the number) and the headline, only for screen readers: a label apart from the visible text fails axe. */}
        <b className="prova-n">{String(n).padStart(2, "0")}</b><span className="sr-only">: {headline}</span>
        <span className="fila-mini" data-vaga={p.capa ? undefined : ""}>{p.capa && <img src={p.capa} alt="" loading="lazy" decoding="async" />}</span>
      </Link>
    </li>
  );
}

// ── the ready screen ───────────────────────────────────────────────────────────────────────────────────────────────

/** A sentence from the cards, in the order it appears: which card it is on, and the fact it is tied to. */
type Line = { texto: string; ordem: number; cardId: string; card: number; nome: string; arte: number; fato?: Fact; autor: boolean };

/** The cards' sentences (the CTA does not count: it is the outlet's). `arte`: the card's position on the stage, or -1 if it has no image of its own. */
function fromPostSentences(cards: CardNormal[], artwork: CompletePiece["artes"], facts: Fact[]): Line[] {
  const perId = new Map(facts.map((f) => [f.id, f]));
  return cards.flatMap((c, i) => {
    if (isInvite(c)) return [];
    const art = artwork.findIndex((a) => (a.id ?? a.papel) === c.id);
    const name = CARD_ROLE[c.papel ?? c.layout] ?? tr(LAYOUT_NAME[c.layout], LAYOUT_NAME_EN[c.layout]);
    return c.frases.map((f, order) => ({ texto: f.texto, ordem: order, cardId: c.id, card: (art >= 0 ? art : i) + 1, nome: name, arte: art, fato: f.fatoId ? perId.get(f.fatoId) : undefined, autor: !!f.autor }));
  });
}

function Ready({ s, peca: piece, versao: version, imagemFalhou: imageFailed, novaVersao: newVersion, aceitarVersao: acceptVersion, versaoAtual: currentVersion }: {
  s: PieceStatus; peca: CompletePiece; versao: string; imagemFalhou: () => void; novaVersao: "reescrita" | "edicao" | null; aceitarVersao: (v: number) => void; versaoAtual: number;
}) {
  const { veiculo: outlet } = useShell();
  // Card editing lives in the URL (?editar=1): saving changes the version and remounts the screen, and editing stays open
  // when the check pointed something out.
  const [params, setParams] = useSearchParams();
  const editing = params.get("editar") === "1";
  const openEdit = (yes: boolean) => setParams((p) => { if (yes) p.set("editar", "1"); else p.delete("editar"); return p; }, { replace: true });
  // Editing opens on the version on screen (the server's): the new-version warning, if there was one, has been seen.
  const editCards = () => { acceptVersion(currentVersion); openEdit(true); };
  const reels = s.formato === "reels";
  const canEdit = outlet.papel !== "reporter" && !!piece.previa && !reels;
  const canReels = outlet.papel !== "reporter" && s.formato === "carrossel";
  const content = piece.peca.conteudo as Content;
  const validation = piece.peca.validacao as Validation;
  const cards = content.cards ?? [];
  // From 1180 px up the stage stays pinned while scrolling and the template goes to the check column; the sentence box
  // over the art only exists where the stage shows one card at a time (from 1024 px up).
  const three = useMedia("(min-width: 1180px)");
  const wide = useMedia("(min-width: 1024px)");
  const [sentence, setSentence] = useState<number | null>(null);
  const [measures, setMeasures] = useState<Record<string, (Box | null)[]>>({});
  const [timestamp, setTimestamp] = useState(false);
  const goCard = useRef<((i: number, smooth?: boolean) => void) | null>(null);
  if (editing && canEdit) {
    return (
      <div className="mx-auto max-w-[1180px] px-5 pt-2 lg:px-12 lg:pt-2">
        <Suspense fallback={<p role="status" className="m-0 text-apoio">{tr("Abrindo a edição…", "Opening the editor…")}</p>}>
          <EditCarousel s={s} peca={piece} sair={() => openEdit(false)} versaoAtual={currentVersion} abrirNova={() => acceptVersion(currentVersion)}
            salvou={(v, ok) => { acceptVersion(v); if (ok) openEdit(false); }} />
        </Suspense>
      </div>
    );
  }
  const { frases: sentences, fatoIds: factIds } = factsText(cards);
  const cited = factIds.length ? piece.fatos.filter((f) => factIds.includes(f.id)) : piece.fatos.filter((f) => f.tipo !== "manchete");
  // The same passage can support more than one fact (headline, type, section): each text counts and appears once.
  const used = cited.filter((f, i) => cited.findIndex((g) => g.texto === f.texto) === i);
  const sources = [...new Set(used.map((f) => f.fonte).filter(Boolean))] as string[];
  const desk = piece.pauta?.editoria;
  // Kie skipped (no key, no reference, no credit, cap): the art came out in the default style. A warning, not an error.
  const simple = s.formato === "reels" ? null : simpleIllustration(piece.eventos, s.versao);
  // Without an illustration key: an admin turns it on in the AI keys tab.
  const enableIllustration = !!simple && outlet.papel === "admin" && withoutKeyIllustration(fallbackVersion(piece.eventos, s.versao) ?? "");
  const normal = normalizeCards(cards as Card[]);
  const lines = fromPostSentences(normal, piece.artes, piece.fatos);
  // Each sentence's box over the art, only the measured one (MeasureSentences); without a measurement, pointing at the sentence only switches the card.
  const boxes = lines.flatMap((l, n) => { const c = l.arte >= 0 ? measures[l.cardId]?.[l.ordem] : null; return c ? [{ n, arte: l.arte, ...c }] : []; });
  const preview = piece.previa as PreviewPiece | null;
  const measure = normal.filter((c) => lines.some((l) => l.cardId === c.id && l.arte >= 0));
  // Pointing at, focusing or tapping a sentence: it opens the source passage and the stage goes to its card (without sliding: it is a lookup).
  const showSentence = (n: number | null) => {
    setSentence(n);
    const l = n === null ? undefined : lines[n];
    if (l && l.arte >= 0) goCard.current?.(l.arte, false);
  };
  const model = !reels && piece.previa
    ? <SelectorModel tenantId={outlet.id} pecaId={s.id} versao={s.versao} modelo={piece.modelo} editor={canEdit} aceitarVersao={acceptVersion} />
    : null;

  return (
    // The column fills the sheet: with little content, the decision bar stays at the bottom of the screen.
    <div className="flex min-h-[calc(100dvh_-_98px)] flex-col px-5 lg:min-h-[calc(100dvh_-_var(--topo)_-_var(--pe))] lg:px-0">
      <div className={`${SCREEN} flex-1 pb-8`}>
        <div className="rv-grade">
          <SideQueue id={s.id} />
          {/* On a tall screen, the art follows the scroll: the sentences and the caption can be read with the card in view. */}
          <div className="palco-fixo min-w-0">
            {simple && (
              <p role="note" className="faixa-aviso m-0 mb-3">
                {tr("Ilustração simples", "Simple illustration")}: {simple}.
                {enableIllustration && <>{" "}<Link className="link-acao" to={`/t/${outlet.slug}/veiculo?aba=chaves`}>{tr("Colar a chave de ilustração", "Paste the illustration key")}</Link></>}
              </p>
            )}
            {reels ? <VideoReels arte={piece.artes[0]} cards={cards} comVoz={!!(content as { narracao?: string | null }).narracao} imagemFalhou={imageFailed} carimbo={timestamp} /> : (
              <Carousel artes={piece.artes} cards={cards} imagemFalhou={imageFailed} irRef={goCard} caixas={boxes} frase={sentence} carimbo={timestamp} acoes={(canEdit || canReels) && (
                // Desktop: the desk's bar (the explanations go in the tooltip and to the screen reader).
                <>
                  {canEdit && (
                    <button type="button" onClick={editCards} aria-describedby="rv-ajuda-editar" data-dica={tr("Texto, ordem, tipo de card e foto. Não gasta versão.", "Text, order, card type and photo. It doesn't use up a version.")} className="btn-papel btn-p">
                      <IconEdit className="size-4" />{tr("Editar os cards", "Edit the cards")}
                    </button>
                  )}
                  {canReels && (
                    <Link to="reels" aria-describedby="rv-ajuda-reels" data-dica={tr("Os mesmos cards em vídeo, em pé. Vira um post novo.", "The same cards as an upright video. It becomes a new post.")} className="btn-papel btn-p no-underline">
                      <IconReels className="size-4" />{tr("Fazer Reels", "Make a Reel")}
                    </Link>
                  )}
                </>
              )} />
            )}
            {/* Mobile: the actions under the carousel, with the explanation in view. A post without an image (no desk): on desktop too. */}
            <div className={reels || piece.artes.length ? "lg:hidden" : ""}>
              {canEdit && (
                <p className="m-0 mt-1 flex flex-wrap items-center gap-x-3">
                  <button type="button" onClick={editCards} className="btn-sec bg-papel-2">{tr("Editar os cards", "Edit the cards")}</button>
                  <span className="ajuda">{tr("Texto, ordem, tipo de card e foto. Não gasta versão.", "Text, order, card type and photo. It doesn't use up a version.")}</span>
                </p>
              )}
              {canReels && (
                <p className="m-0 mt-1 flex flex-wrap items-center gap-x-3">
                  <Link to="reels" className="btn-sec bg-papel-2 no-underline">{tr("Fazer Reels", "Make a Reel")}</Link>
                  <span className="ajuda">{tr("Os mesmos cards em vídeo, em pé. Vira um post novo.", "The same cards as an upright video. It becomes a new post.")}</span>
                </p>
              )}
            </div>
            {model && !three && <div className="mt-3 max-w-[404px]">{model}</div>}
            {canEdit && <p id="rv-ajuda-editar" className="sr-only">{tr("Texto, ordem, tipo de card e foto. Não gasta versão.", "Text, order, card type and photo. It doesn't use up a version.")}</p>}
            {canReels && <p id="rv-ajuda-reels" className="sr-only">{tr("Os mesmos cards em vídeo, em pé. Vira um post novo.", "The same cards as an upright video. It becomes a new post.")}</p>}
          </div>
          <div className="conf">
            <div className="empty:hidden">
              {newVersion === "reescrita" && (
                <p role="status" className="faixa-aviso m-0 mb-3">{tr(`Chegou a versão ${s.rodada} deste post enquanto ele estava aberto. Confira de novo antes de decidir.`, `Version ${s.rodada} of this post arrived while it was open. Check it again before you decide.`)}</p>
              )}
              {newVersion === "edicao" && (
                <p role="status" className="faixa-aviso m-0 mb-3">{tr("Outra pessoa editou os cards enquanto o post estava aberto. Confira de novo antes de decidir.", "Someone else edited the cards while the post was open. Check it again before you decide.")}</p>
              )}
              <ValidationLine validacao={validation} frases={sentences} fatos={factIds.length ? used.length : 0} cards={cards} editar={canEdit ? editCards : undefined} />
            </div>
            <div>
              {/* On desktop the format and version are in the folio; on mobile the folio only has room for the way back. */}
              <p className="mono m-0 mb-1 text-apoio lg:hidden">{version}</p>
              <p className="mono m-0 text-apoio">
                <Parts partes={[desk ? DESK[desk] ?? desk : null, sources.join(", "), when(s.updated_at)]} />
              </p>
              <h1 className="manchete m-0 mt-1.5 text-[24px] lg:text-[27px]">{content.manchete ?? s.manchete ?? s.titulo}</h1>
            </div>
            {(piece.pauta as { tipo_post?: string | null } | null)?.tipo_post === "publicidade" && <ApprovalAdvertiser tenantId={outlet.id} pecaId={s.id} editor={outlet.papel !== "reporter"} />}
            {lines.length > 0 && <SourcesSentences linhas={lines} materia={piece.fatos.some((f) => f.evidencia)} print={factIds.length ? used.find((f) => f.print)?.print ?? null : null} ativa={sentence} mostrar={showSentence} noPalco={!reels && piece.artes.length > 0} />}
            {/* An old post, with no sentence tied to a fact: the idea's facts stay in view, as they were. */}
            {!factIds.length && used.length > 0 && <Facts fatos={used} fontes={sources} />}
            {content.legenda && <Caption texto={content.legenda} />}
            {model && three && model}
          </div>
        </div>
      </div>
      <Bar s={s} bloqueada={validation?.ok === false} reels={reels} doSite={(piece.pauta as { origem?: string } | null)?.origem === "site"} carimbar={() => setTimestamp(true)} />
      {wide && !reels && preview && measure.length > 0 && (
        <MeasureSentences previa={preview} cards={measure} formato={s.formato === "post" ? "post" : "carrossel"} medido={(m) => setMeasures((before) => ({ ...before, ...m }))} />
      )}
    </div>
  );
}

// ── where the sentence is on the art ────────────────────────────────────────────────────────────────────────────

/** A sentence's box over the art, in % of the card. */
type Box = { x: number; y: number; w: number; h: number };

/** Padding of the box around the sentence, in card px (1080 × 1350): it does not touch the letters. */
const SLACK = { x: 10, y: 6 };

/**
 * The rectangle of each sentence on the card drawn in `doc` (the render's template, 1080 × 1350). It only measures with
 * the card's fonts loaded (with the fallback the line breaks would differ) and with the sentence found exactly as it is
 * in the text; otherwise, `null`: no box. List layouts have one item per sentence; the others, the sentences in
 * sequence in a paragraph.
 */
async function measureCard(doc: Document, card: CardNormal): Promise<(Box | null)[]> {
  const sheet = doc.querySelector<HTMLElement>(".card");
  if (!sheet) return [];
  sheet.getBoundingClientRect();   // the first layout is the one that requests the fonts
  await doc.fonts.ready;
  const faces = Array.from(doc.fonts);
  if (!faces.some((f) => f.status === "loaded") || faces.some((f) => f.status === "error" || f.status === "loading")) return [];
  const base = sheet.getBoundingClientRect();
  if (!base.width || !base.height) return [];
  const box = (r: DOMRect): Box | null => {
    const left = Math.max(0, r.left - base.left - SLACK.x), top = Math.max(0, r.top - base.top - SLACK.y);
    const dir = Math.min(base.width, r.right - base.left + SLACK.x), foot = Math.min(base.height, r.bottom - base.top + SLACK.y);
    if (r.width < 1 || r.height < 1 || dir <= left || foot <= top) return null;
    return { x: (left / base.width) * 100, y: (top / base.height) * 100, w: ((dir - left) / base.width) * 100, h: ((foot - top) / base.height) * 100 };
  };
  const items = doc.querySelectorAll<HTMLElement>(".story-list > li");
  if (items.length) return items.length === card.frases.length ? Array.from(items, (li) => box(li.getBoundingClientRect())) : [];
  const texts = card.frases.map((f) => f.texto);
  const node = doc.querySelector(".story-body")?.firstChild;
  // nodeType and not instanceof: the node belongs to another document (the iframe's).
  if (!node || node.nodeType !== 3 || (node as Text).data !== texts.join(" ")) return [];
  let ini = 0;
  return texts.map((tx) => {
    const r = doc.createRange();
    r.setStart(node, ini);
    r.setEnd(node, ini + tx.length);
    ini += tx.length + 1;
    return tx.trim() ? box(r.getBoundingClientRect()) : null;
  });
}

/**
 * Where each sentence is on the art, measured and not estimated: each card is drawn again in the same template as the
 * render (the card-editing preview, without the images, which do not move the text) in a hidden 1080 × 1350 iframe,
 * and the box is the sentence's rectangle there. The template is only downloaded here, after the screen is ready, and
 * the iframes leave as soon as the measurement finishes.
 */
function MeasureSentences({ previa: preview, cards, formato: format, medido: measured }: { previa: PreviewPiece; cards: CardNormal[]; formato: "post" | "carrossel"; medido: (m: Record<string, (Box | null)[]>) => void }) {
  const [pages, setPages] = useState<{ card: CardNormal; html: string }[]>([]);
  const done = useRef(0);
  useEffect(() => {
    let live = true;
    import("../onboarding/editPreview").then(({ htmlCardEdit }) => {
      if (!live) return;
      const withoutImages: PreviewPiece = { ...preview, logo: null, arte: null, imagens: {}, base: preview.base.patrocinio ? { ...preview.base, patrocinio: { ...preview.base.patrocinio, logo: null } } : preview.base };
      done.current = 0;
      setPages(cards.map((card) => ({ card, html: htmlCardEdit(withoutImages, card, format, {}) })));
    }).catch(() => { /* without the preview there is no box: the screen stays the same */ });
    return () => { live = false; };
    // The post and the version do not change with the screen mounted (Review remounts on each version): measure once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const ready = async (frame: HTMLIFrameElement, card: CardNormal) => {
    const doc = frame.contentDocument;
    const boxes = doc ? await measureCard(doc, card).catch(() => []) : [];
    measured({ [card.id]: boxes });
    done.current += 1;
    if (done.current >= pages.length) setPages([]);
  };
  if (!pages.length) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none invisible fixed top-0 left-0 size-0 overflow-hidden">
      {pages.map(({ card, html }) => (
        <iframe key={card.id} title={tr("Medida do card", "Card measurement")} srcDoc={html} sandbox="allow-same-origin" tabIndex={-1}
          onLoad={(e) => void ready(e.currentTarget, card)} className="h-[1350px] w-[1080px] max-w-none border-0" />
      ))}
    </div>
  );
}

// ── reels ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** The "Approved" stamp, which lands on the proof when Approve succeeded (desktop only; DESIGN.md §8). */
const Timestamp = () => <span aria-hidden="true" className="carimbo palco-carimbo carimbo-bate">{tr("Aprovado", "Approved")}</span>;

/**
 * The Reels video, upright, with the browser's controls and the carousel's cover. It plays by itself, muted, in a loop,
 * only without "reduce motion"; with it, it stays on the cover until the person plays it.
 */
function VideoReels({ arte: art, cards, comVoz: withVoice, imagemFalhou: imageFailed, carimbo: timestamp }: { arte: CompletePiece["artes"][number] | undefined; cards: CardText[]; comVoz: boolean; imagemFalhou: () => void; carimbo: boolean }) {
  const [reduces, setReduces] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const video = useRef<HTMLVideoElement>(null);
  // Switched to "reduce motion" with the screen open: stops the video and the loop.
  useEffect(() => {
    const m = matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => { setReduces(m.matches); if (m.matches) video.current?.pause(); };
    m.addEventListener("change", changed);
    return () => m.removeEventListener("change", changed);
  }, []);
  const normal = normalizeCards(cards as Card[]);
  if (!art?.mp4) return <p className="faixa-aviso m-0">{tr("Este Reels ainda não tem o vídeo.", "This Reel doesn't have its video yet.")}</p>;
  const seconds = tr(String(art.duracao).replace(".", ","), String(art.duracao));
  return (
    <figure className="palco m-0 grid justify-items-center gap-2">
      <video ref={video} src={art.mp4} poster={art.jpg} controls aria-describedby="rv-reels-texto" playsInline muted={!reduces} loop={!reduces} autoPlay={!reduces} preload="metadata" onError={imageFailed}
        aria-label={tr(`Vídeo do Reels${art.duracao ? `, ${seconds} segundos` : ""}`, `Reel video${art.duracao ? `, ${seconds} seconds` : ""}`)} style={{ viewTransitionName: ART_NAME }}
        className="block aspect-[9/16] h-auto w-[min(70vw,300px)] rounded-card bg-texto-forte object-contain shadow-curta lg:w-[min(100%,340px)]" />
      {timestamp && <Timestamp />}
      <figcaption className="mono text-apoio">{tr("Reels", "Reel")} · 9:16{art.duracao ? ` · ${seconds} s` : ""} · {withVoice ? tr("com a sua voz", "with your voice") : tr("sem narração", "no narration")}</figcaption>
      {/* The video's text, in card order: whoever does not see the video reads the same as it shows. */}
      <details id="rv-reels-texto" className="max-w-[60ch]">
        <summary className="min-h-11 cursor-pointer content-center text-[15px] text-texto">{tr("Texto dos cards do vídeo", "Text of the video's cards")}</summary>
        <ol className="m-0 mt-1 grid gap-2 pl-5 text-[15px]">
          {normal.map((c) => (
            <li key={c.id}><b className="text-texto-forte">{c.titulo}</b>{c.frases.length ? ` ${c.frases.map((f) => f.texto).join(" ")}` : ""}</li>
          ))}
        </ol>
      </details>
    </figure>
  );
}

// ── carrossel ───────────────────────────────────────────────────────────────────────────────────────────────────

function Carousel({ artes: artwork, cards, imagemFalhou: imageFailed, acoes: actions, irRef: goRef, caixas: boxes, frase: sentence, carimbo: timestamp }: {
  artes: CompletePiece["artes"]; cards: CardText[]; imagemFalhou: () => void; acoes?: ReactNode;
  /** For someone outside to bring the stage to a card (pointing at a sentence). */
  irRef: RefObject<((i: number, smooth?: boolean) => void) | null>;
  /** The measured boxes of the sentences (`n`: the sentence; `arte`: the card) and the sentence now pointed at. */
  caixas: ({ n: number; arte: number } & Box)[]; frase: number | null; carimbo: boolean;
}) {
  const rail = useRef<HTMLUListElement>(null);
  const [current, currentSet] = useState(0);
  const request = useRef<number | null>(null);
  /** Marks the check of where the strip stopped, for when no scroll may come to trigger it. */
  const check = useRef<() => void>(() => {});
  const n = artwork.length;
  // Where the strip stops when showing card i. At the end of the strip the scroll locks: with a wide screen (tablet), the
  // last cards stop in the same place, and "the card in view" is not enough to know which is current.
  const snapPoint = (el: HTMLElement, i: number) => {
    const li = el.children[i] as HTMLElement | undefined;
    const base = (el.firstElementChild as HTMLElement).offsetLeft;
    return Math.min((li?.offsetLeft ?? 0) - base, el.scrollWidth - el.clientWidth);
  };
  // The current one, when the scroll settles: the requested card (dots, arrows) if the strip stopped where it stops;
  // otherwise (drag, keyboard) the last one when the strip reached the end, or the card whose stop is closest.
  useEffect(() => {
    const el = rail.current;
    if (!el || n < 2) return;
    let wait: ReturnType<typeof setTimeout> | undefined;
    const settled = () => {
      const p = request.current;
      request.current = null;
      if (p !== null && Math.abs(snapPoint(el, p) - el.scrollLeft) <= 2) return currentSet(p);
      if (el.scrollLeft >= el.scrollWidth - el.clientWidth - 2) return currentSet(n - 1);
      let best = 0;
      for (let i = 1; i < n; i++) if (Math.abs(snapPoint(el, i) - el.scrollLeft) < Math.abs(snapPoint(el, best) - el.scrollLeft)) best = i;
      currentSet(best);
    };
    const mark = () => { clearTimeout(wait); wait = setTimeout(settled, 120); };
    // A browser that reports the end of scrolling (scrollend) needs no guess. In the others, 120 ms without scrolling count
    // as "stopped": right where scrolling reports every frame and wrong where a requested slide only reports on leaving
    // and arriving (the current card went back to the previous one midway, and the back arrow switched off with it).
    const warnsEnd = "onscrollend" in window;
    const scrolled = () => { if (warnsEnd) clearTimeout(wait); else mark(); };
    const stopped = () => { clearTimeout(wait); settled(); };
    check.current = mark;
    el.addEventListener("scroll", scrolled, { passive: true });
    if (warnsEnd) el.addEventListener("scrollend", stopped);
    return () => { el.removeEventListener("scroll", scrolled); el.removeEventListener("scrollend", stopped); clearTimeout(wait); check.current = () => {}; };
  }, [n]);

  // `suave: false` switches cards without sliding (pointing at a sentence is a lookup, not navigation).
  const go = (i: number, smooth = true) => {
    const el = rail.current;
    if (!el || i < 0 || i >= n) return;
    currentSet(i);
    const inPlace = Math.abs(snapPoint(el, i) - el.scrollLeft) <= 2;
    // The strip is already where the card stops and no request is on its way: nothing scrolls (and no scroll would come to clear the request).
    if (inPlace && request.current === null) return;
    request.current = i;
    const slides = smooth && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: snapPoint(el, i), behavior: slides ? "smooth" : "auto" });
    // "In place" is not "stopped": with a request on its way to another card (→ then ←, the strip still at the starting
    // point; → → ←, passing through the stop), this one takes that one's place, which would otherwise end on the previous
    // card and take the current one with it. Nothing may scroll from here on: the request is cleared without waiting for the scroll.
    if (inPlace) check.current();
  };
  // ← and → move through the cards anywhere on the screen (outside a text field): review is done with an eye on the art.
  const goNow = useRef(go);
  goNow.current = go;
  goRef.current = go;
  const currentNow = useRef(current);
  currentNow.current = current;
  useEffect(() => {
    if (n < 2) return;
    const key = (e: KeyboardEvent) => {
      if (!freeShortcut(e, true)) return;
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); goNow.current(currentNow.current + (e.key === "ArrowRight" ? 1 : -1)); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [n]);
  // The proof changes width (window, or the decision bar that opened a step): the current card stays in place.
  useEffect(() => {
    const el = rail.current;
    if (!el || n < 2) return;
    const ro = new ResizeObserver(() => { const target = snapPoint(el, currentNow.current); if (request.current === null && Math.abs(el.scrollLeft - target) > 2) el.scrollLeft = target; });
    ro.observe(el);
    return () => ro.disconnect();
  }, [n]);
  const role = (i: number) => CARD_ROLE[artwork[i]?.papel] ?? artwork[i]?.papel ?? "";
  const normal = normalizeCards(cards as Card[]);
  const title = (i: number) => normal.find((c) => c.id === (artwork[i]?.id ?? artwork[i]?.papel))?.titulo;

  if (!n) return <p className="faixa-aviso m-0">{tr("Este post ainda não tem imagens.", "This post doesn't have images yet.")}</p>;
  const arrow = "grid size-11 cursor-pointer place-items-center rounded-btn text-texto-forte hover:bg-papel-3 disabled:cursor-default disabled:text-fio-forte disabled:hover:bg-transparent";
  return (
    <section aria-label={tr("Imagens do post", "Post images")} className="palco min-w-0">
      {/* The desk's bar (desktop only): the proof's mark, as in a print proof's margin, and the post's actions. */}
      <div className="palco-topo">
        <p className="mono m-0" aria-hidden="true">{tr("prova", "proof")} · 4:5 · 1080 × 1350 px</p>
        <div className="palco-acoes">{actions}</div>
      </div>
      <div className="palco-arte corte">
        {/* Side scrolling with snap: drag on mobile; the strip takes focus and the arrow keys scroll it. On desktop each card takes the whole proof. */}
        <ul ref={rail} tabIndex={0} aria-label={n > 1 ? tr(`${n} cards; arraste para o lado`, `${n} cards; swipe sideways`) : tr("Imagem do post", "Post image")}
          className="relative -mx-5 m-0 flex list-none snap-x snap-mandatory scroll-px-5 gap-3 overflow-x-auto px-5 pt-1 pb-3 [scrollbar-width:none] lg:mx-0 lg:scroll-px-0 lg:gap-4 lg:p-0 [&::-webkit-scrollbar]:hidden">
          {artwork.map((a, i) => (
            <li key={a.papel + i} className={`relative flex-none snap-start ${n > 1 ? "w-[min(64vw,320px)] lg:w-full" : "w-[min(82vw,400px)] lg:w-full"}`}>
              {/* Only the art in view carries the journey's name (kit/artTransition): one element at a time with it on screen. */}
              <img src={a.jpg} width={1080} height={1350} loading={i > 1 ? "lazy" : undefined} onError={imageFailed}
                alt={`${tr(`Card ${i + 1} de ${n}`, `Card ${i + 1} of ${n}`)}: ${role(i)}${title(i) ? `. ${title(i)}` : ""}`} style={i === current ? { viewTransitionName: ART_NAME } : undefined}
                className="block aspect-[4/5] h-auto w-full rounded-card bg-papel object-cover shadow-prova" />
              {boxes.filter((c) => c.arte === i).map((c) => (
                <i key={c.n} aria-hidden="true" className="chamada" data-on={c.n === sentence ? "" : undefined}
                  style={{ "--x": `${c.x}%`, "--y": `${c.y}%`, "--w": `${c.w}%`, "--h": `${c.h}%` } as CSSProperties}><b>{c.n + 1}</b></i>
              ))}
            </li>
          ))}
        </ul>
        {timestamp && <Timestamp />}
      </div>
      {n > 1 && (
        <div className="palco-baixo">
          <p className="mono m-0 text-texto [grid-area:n]" aria-live="polite">{current + 1} / {n} · {role(current)}</p>
          {/* Proof strips: each card's cover, the current one raised and with the graphite rule around it. */}
          <div className="tiras [grid-area:tiras]">
            {artwork.map((a, i) => (
              <button key={a.papel + i} type="button" onClick={() => go(i)} aria-label={`Card ${i + 1}: ${role(i)}`} aria-current={i === current ? "true" : undefined} className="tira">
                <img src={a.jpg} alt="" loading="lazy" decoding="async" />
              </button>
            ))}
          </div>
          <div className="flex [grid-area:setas]">
            <button type="button" onClick={() => go(current - 1)} disabled={current === 0} aria-label={tr("Card anterior", "Previous card")} data-dica={tr("Card anterior", "Previous card")} data-tecla="←" className={arrow}>
              <IconBack className="size-5" />
            </button>
            <button type="button" onClick={() => go(current + 1)} disabled={current === n - 1} aria-label={tr("Próximo card", "Next card")} data-dica={tr("Próximo card", "Next card")} data-tecla="→" className={arrow}>
              <IconBack className="size-5 rotate-180" />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ── check ───────────────────────────────────────────────────────────────────────────────────────────────────────

const CHECKS = () => [
  tr("Cada frase dos cards aponta para um fato da fonte.", "Each sentence on the cards points to a fact from the source."),
  tr("Todo número do texto aparece nos fatos.", "Every number in the text appears in the facts."),
  tr("O dia da semana citado bate com a data dos fatos.", "The day of the week mentioned matches the date in the facts."),
  tr("Manchete com até 90 caracteres; os textos cabem nos cards.", "Headline of up to 90 characters; the text fits on the cards."),
];

/**
 * "Validation ok" opens the checks (DESIGN.md §7). A warning stays in view, in amber; never collapsed. An edit that
 * failed: each card's reason, in plain language, and the way to fix it.
 */
function ValidationLine({ validacao: validation, frases: sentences, fatos: facts, cards, editar: edit }: { validacao: Validation; frases: number; fatos: number; cards: CardText[]; editar?: () => void }) {
  if (!validation) return null;
  const warnings = validation.avisos ?? [];
  if (!validation.ok) {
    const normal = normalizeCards(cards as Card[]);
    const perCard = Object.entries(tr(validation.porCard, validation.en?.porCard ?? validation.porCard) ?? {});
    const general = tr(validation.geral, validation.en?.geral ?? validation.geral) ?? [];
    return (
      <div className="faixa-erro" role="alert">
        <b>{tr(`A conferência apontou problemas${perCard.length ? " nos cards" : ""}`, `The check found problems${perCard.length ? " on the cards" : ""}`)}</b>
        <ul className="m-0 mt-1 pl-5">
          {general.map((m) => <li key={m}>{m}</li>)}
          {perCard.length || general.length
            ? perCard.flatMap(([id, reasons]) => {
                const i = normal.findIndex((c) => c.id === id);
                return reasons.map((m) => <li key={id + m}>Card {i + 1}{i >= 0 ? ` (${tr(LAYOUT_NAME[normal[i].layout], LAYOUT_NAME_EN[normal[i].layout])})` : ""}: {m}</li>);
              })
            : (validation.erros ?? []).map((e) => <li key={e}>{e}</li>)}
        </ul>
        {edit && <button type="button" onClick={edit} className="mt-1 min-h-11 font-bold underline underline-offset-3">{tr("Corrigir nos cards", "Fix it on the cards")}</button>}
      </div>
    );
  }
  return (
    <div className="grid gap-2">
      <details className="group">
        <summary className="conf-validacao min-h-11 list-none leading-[1.3] [&::-webkit-details-marker]:hidden">
          <SeenPencil className="text-verde" seed={4} />
          <span><b>{tr("Validação ok", "Check passed")}</b> · {validationLine(sentences, facts, warnings.length)}</span>
          <IconArrow className="ml-auto size-4 flex-none transition-transform group-open:rotate-180" />
        </summary>
        <div className="px-3 pt-2.5">
          <ul className="fatos">{CHECKS().map((c) => <li key={c}><IconRight className="size-3.5" /><span>{c}</span></li>)}</ul>
          <p className="ajuda m-0 mt-2">{tr("Conferência automática, sem IA. Não substitui a sua leitura.", "Automatic check, no AI. It doesn't replace your own reading.")}</p>
        </div>
      </details>
      {warnings.map((a) => <p key={a} className="faixa-aviso m-0">{tr("Aviso", "Warning")}: {a}</p>)}
    </div>
  );
}

const isLink = (url: string | null | undefined): url is string => !!url && /^https?:\/\//.test(url);

/** A fact's source: the name with the link (opens in another tab) or, without a link, just the name; `null` when the fact does not say where it came from. */
function fromFactSource(fact: Fact): ReactNode {
  if (isLink(fact.url)) {
    return (
      <a href={fact.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
        {fact.fonteTitulo ?? fact.fonte ?? new URL(fact.url).hostname}<span className="sr-only">{tr(" (abre em outra aba)", " (opens in a new tab)")}</span>
      </a>
    );
  }
  return fact.fonte ?? null;
}

/**
 * Sentences and sources: each card sentence with the fact it is tied to, the source (with the link) and, on pointing,
 * focusing or tapping, the passage that supports it. Pointing brings the stage to the sentence's card and, where it was
 * measured, marks the sentence on the art. It replaces "Facts used" and "Where each sentence came from" (Story posts:
 * the literal passage from the dossier's page, or "author's claim"). A post from a screenshot (+ New): the notice with
 * the image, once only.
 */
function SourcesSentences({ linhas: lines, materia: story, print, ativa: active, mostrar: show, noPalco: inStage }: {
  linhas: Line[]; materia: boolean; print: string | null; ativa: number | null; mostrar: (n: number | null) => void; noPalco: boolean;
}) {
  return (
    <section aria-labelledby="rv-frases" className="grid gap-2">
      <div className="secao">
        <h2 id="rv-frases" className="m-0">{tr("Frases e fontes", "Sentences and sources")}</h2>
        {inStage && <span aria-hidden="true" className="hidden [@media(hover:hover)]:inline">{tr("aponte para ver na arte", "point to see it on the art")}</span>}
      </div>
      {print && (
        <p className="faixa-aviso m-0">
          {tr("O texto destes fatos foi lido de um print por um modelo. Confira com a imagem antes de aprovar.", "The text of these facts was read from a screenshot by a model. Check it against the image before you approve.")}{" "}
          <a href={print} target="_blank" rel="noopener noreferrer" className="font-bold underline underline-offset-3">
            {tr("Ver o print", "See the screenshot")}<span className="sr-only">{tr(" (abre em outra aba)", " (opens in a new tab)")}</span>
          </a>
        </p>
      )}
      {/* The whole list responds to the pointer; each sentence's button is the path for keyboard and screen reader. */}
      <ol className="frases" onMouseLeave={() => show(null)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) show(null); }}>
        {lines.map((l, n) => {
          const f = l.fato;
          // A Story post: without the passage from the dossier's page, the sentence is the author's (with or without a fact).
          const fromAuthor = story ? !f?.evidencia : !f && l.autor;
          return (
            <li key={n} className="frase" data-on={n === active ? "" : undefined} onMouseEnter={() => show(n)} onFocus={() => show(n)} onClick={() => show(n)}>
              <span aria-hidden="true" className="frase-n">{n + 1}</span>
              <button type="button" data-linha aria-describedby={`rv-frase-${n}`} className="cursor-pointer text-left"><q>{l.texto}</q></button>
              <span id={`rv-frase-${n}`} className="frase-fonte">
                {fromAuthor ? (
                  <span className="estado text-apoio"><span>{tr("sem evidência: afirmação do autor", "no evidence: the author's own claim")}{f && isLink(f.url) ? <> · {fromFactSource(f)}</> : null}</span></span>
                ) : f ? (
                  <span className="estado estado-ok"><IconRight className="size-[13px]" /><span>{tr("presa a", "tied to")}: {fromFactSource(f) ?? tr("um fato da ideia", "a fact from the idea")}</span></span>
                ) : (
                  <span className="estado estado-aviso"><IconAlert className="size-[13px]" /><span>{tr("sem fato da fonte", "no fact from the source")}</span></span>
                )}
                {f && f.evidencia ? (
                  <>
                    <span className="trecho bg-transparent px-0 py-0 text-texto">{f.texto}</span>
                    <span className="trecho"><span className="sr-only">{tr("Evidência: ", "Evidence: ")}</span>{f.evidencia}</span>
                  </>
                ) : f ? <span className="trecho">{f.texto}</span> : null}
                <span className="mono text-apoio">{tr(`no card ${l.card}`, `on card ${l.card}`)} · {l.nome}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** A 3-line caption with "see all" and "copy" (review and publish). */
export function Caption({ texto: text, id = "rv-legenda" }: { texto: string; id?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [whole, wholeSet] = useState(false);
  const [cuts, setCuts] = useState(false);
  const [duplicate, setCopy] = useState<"ok" | "falhou" | null>(null);
  // "see all" only when the 3 lines really cut the text.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || whole) return;
    const measure = () => setCuts(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [whole, text]);
  useEffect(() => {
    if (!duplicate) return;
    const i = setTimeout(() => setCopy(null), 2500);
    return () => clearTimeout(i);
  }, [duplicate]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopy("ok"); } catch { setCopy("falhou"); }
  };
  return (
    <section aria-labelledby={id}>
      <div className="mb-2 flex items-baseline justify-between gap-3 border-t border-fio-forte pt-2.5">
        <h2 id={id} className="mono m-0 text-[11.5px] font-normal tracking-[.08em] uppercase">{tr("Legenda", "Caption")}</h2>
        <button type="button" onClick={copy} className="link-acao -my-3 inline-flex min-h-11 min-w-11 items-center justify-center text-[15px]">
          {duplicate === "ok" ? tr("copiada", "copied") : tr("copiar", "copy")}
        </button>
      </div>
      <p role="status" className="sr-only">{duplicate === "ok" ? tr("Legenda copiada.", "Caption copied.") : duplicate === "falhou" ? tr("Não deu para copiar a legenda.", "Couldn't copy the caption.") : ""}</p>
      <p ref={ref} id={`${id}-texto`} className={`m-0 whitespace-pre-line ${whole ? "" : "line-clamp-3"}`}>{text}</p>
      {(cuts || whole) && (
        <button type="button" onClick={() => wholeSet((v) => !v)} aria-expanded={whole} aria-controls={`${id}-texto`}
          className="link-acao mt-1 min-h-11 text-[15px]">
          {whole ? tr("ver menos", "show less") : tr("ver inteira", "show all")}
        </button>
      )}
    </section>
  );
}

/** The idea's facts, for the old post where no sentence is tied to a fact (then "Sentences and sources" does not show them). */
function Facts({ fatos: facts, fontes: sources }: { fatos: Fact[]; fontes: string[] }) {
  // A post from a screenshot (+ New): the text was read from the image by a model; the image is one tap away, once only.
  const print = facts.find((f) => f.print)?.print;
  return (
    <details className="group">
      <summary className="secao m-0 min-h-11 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        {tr("Fatos usados", "Facts used")}
        <span className="flex items-center gap-1 text-apoio normal-case">
          {facts.length}{sources.length ? ` · ${sources.join(", ")}` : ""}
          <IconArrow className="size-4 transition-transform group-open:rotate-180" />
        </span>
      </summary>
      {print && (
        <p className="faixa-aviso m-0 mt-2">
          {tr("O texto destes fatos foi lido de um print por um modelo. Confira com a imagem antes de aprovar.", "The text of these facts was read from a screenshot by a model. Check it against the image before you approve.")}{" "}
          <a href={print} target="_blank" rel="noopener noreferrer" className="font-bold underline underline-offset-3">
            {tr("Ver o print", "See the screenshot")}<span className="sr-only">{tr(" (abre em outra aba)", " (opens in a new tab)")}</span>
          </a>
        </p>
      )}
      <ol className="m-0 mt-2 grid list-none gap-4 p-0">
        {facts.map((f) => (
          <li key={f.id}>
            <p className="m-0">{f.texto}</p>
            {f.url && /^https?:\/\//.test(f.url) ? (
              <a href={f.url} target="_blank" rel="noopener noreferrer" className="mono link-acao -mb-2 inline-flex min-h-11 items-center font-normal">
                {f.fonte ?? new URL(f.url).hostname}<span className="sr-only">{tr(" (abre em outra aba)", " (opens in a new tab)")}</span>
              </a>
            ) : f.fonte ? <span className="mono text-apoio">{f.fonte}</span> : null}
          </li>
        ))}
      </ol>
    </details>
  );
}

// ── decision bar ────────────────────────────────────────────────────────────────────────────────────────────────

type Step = "inicio" | "aprovar" | "reescrever" | "rejeitar";
/** `ir`: approved, opens the next in the queue. `ponteiro`: the decision came from the pointer (then the stamp lands before the screen moves on). */
type Decision = { corpo: Record<string, unknown>; ir: boolean; ponteiro: boolean };

/** Without an Instagram account: the way out (Outlet › Accounts) for admins, and whom to ask for the others. */
function WithoutAccount() {
  const { veiculo: outlet } = useShell();
  const members = useMembers(outlet.id);
  const admins = (members.data?.membros ?? []).filter((m) => m.papel === "admin").map((m) => m.nome);
  return (
    <>
      {noteWithoutAccount({ admin: outlet.papel === "admin", admins })}{" "}
      <Link to={`/t/${outlet.slug}/veiculo?aba=contas`} className="link-acao">{tr("Veículo › Contas", "Publication › Accounts")}</Link>.
    </>
  );
}

/** The shortcut key, inside the button (desktop only; the button's name stays only the text). */
const Key = ({ k }: { k: string }) => <span aria-hidden="true" className="kbd max-lg:hidden">{k}</span>;

/** How long the "Approved" stamp stays on the proof before the screen moves on (the landing takes 200 ms). */
const TIMESTAMP_MS = 400;

/**
 * The decision, pinned to the sheet's bottom (§9's "pinned bar" pattern). On the left, on desktop, the fixed sentence
 * of what Approve does and the shortcut hints; on the right, Reject, Rewrite and Approve. The step opens inside the bar,
 * which grows upwards, and its buttons sit where the three were: one decision in view at a time. In review the shell
 * removes the mobile bottom navigation, so the bar goes down to the bottom of the screen.
 */
function Bar({ s, bloqueada: blocked, reels = false, doSite: fromSite = false, carimbar: timestamp }: { s: PieceStatus; bloqueada: boolean; reels?: boolean; doSite?: boolean; carimbar: () => void }) {
  const { veiculo: outlet } = useShell();
  const navigate = useNavigate();
  const pieces = usePieces(outlet.id);
  const all = useAccounts(outlet.id);
  // Reels does not go out through the intermediary yet: those accounts do not appear for it (not even as default).
  const accounts = reels && all.data ? { ...all, data: { ...all.data, contas: all.data.contas.filter((c) => c.modo !== "intermediario") } } : all;
  const rewrite = !reels;
  const members = useMembers(outlet.id);
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>("inicio");
  const buttons = { aprovar: useRef<HTMLButtonElement>(null), reescrever: useRef<HTMLButtonElement>(null), rejeitar: useRef<HTMLButtonElement>(null) };
  const returned = useRef<Exclude<Step, "inicio"> | null>(null);
  const queue = (pieces.data?.pecas ?? []).filter((p) => p.status === "revisao");
  // Decided: this post's status changes (the screen follows it) and the lists go stale.
  const update = () => {
    qc.invalidateQueries({ queryKey: keys.status(outlet.id, s.id) });
    qc.invalidateQueries({ queryKey: keys.pecas(outlet.id) });
    qc.invalidateQueries({ queryKey: keys.prontos(outlet.id) });
    qc.invalidateQueries({ queryKey: keys.pautas(outlet.id) });
  };
  // The person left this screen (the answer was still coming, or the stamp was still on the proof): the lists refresh
  // the same way, right away, but nobody takes them to another post.
  const inScreen = useRef(true);
  const wait = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const updateNow = useRef(update);
  updateNow.current = update;
  useEffect(() => {
    inScreen.current = true;
    return () => {
      inScreen.current = false;
      if (wait.current !== undefined) { clearTimeout(wait.current); wait.current = undefined; updateNow.current(); }
    };
  }, []);
  const follow = (go: boolean) => {
    update();
    if (!go || !inScreen.current) return;
    const next = queue[queue.findIndex((p) => p.id === s.id) + 1] ?? queue.find((p) => p.id !== s.id);
    navigate(next ? `/t/${outlet.slug}/p/${next.id}` : `/t/${outlet.slug}/aprovar`);
  };
  const decision = useMutation({
    // Sends the version on screen: if another arrived meanwhile, the API refuses (409) instead of deciding blindly.
    mutationFn: ({ corpo: body }: Decision) =>
      read(t.revisao.$post({ param: { tenantId: outlet.id, id: s.id } }, bodyJson({ ...body, versao: s.versao }))),
    onSuccess: (_r, { corpo: body, ir: go, ponteiro: pointer }) => {
      // Approved with the pointer, on desktop (where the stamp appears) and with motion: the stamp lands on the proof and
      // only then the screen moves on. By keyboard, or with reduced motion, it moves on at once (DESIGN.md §12).
      const matches = inScreen.current && body.decisao === "aprovar" && pointer && matchMedia("(min-width: 1024px)").matches && !matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!matches) return follow(go);
      timestamp();
      wait.current = setTimeout(() => { wait.current = undefined; follow(go); }, TIMESTAMP_MS);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) {
        qc.invalidateQueries({ queryKey: keys.status(outlet.id, s.id) });
        qc.invalidateQueries({ queryKey: keys.contas(outlet.id) });
      }
    },
  });
  const send = (body: Record<string, unknown>, go = false) => decision.mutate({ corpo: body, ir: go, ponteiro: !cameKeyboard() });
  const open = (p: Exclude<Step, "inicio">) => { decision.reset(); setStep(p); };
  const back = () => { if (step !== "inicio") returned.current = step; decision.reset(); setStep("inicio"); };
  // On cancel, focus returns to the button that opened the step.
  useEffect(() => {
    if (step === "inicio" && returned.current) { buttons[returned.current].current?.focus(); returned.current = null; }
  });
  const busy = decision.isPending || decision.isSuccess;
  const fallback = accounts.data?.contas[0];
  const withoutAccount = accounts.isSuccess && !fallback;
  const approveBlocked = withoutAccount || blocked;
  // A story from the site, checked, with a single account: there is nothing to choose, it approves here and opens the next. The A shortcut only opens.
  const oneTouch = fromSite && !blocked && accounts.data?.contas.length === 1;
  // A, E and X open the step (approve, rewrite, reject), outside a text field: whoever checks keeps a hand on the
  // keyboard, not on the mouse. Opening the step decides nothing: the decision is still the step's button.
  const canDecide = outlet.papel !== "reporter" && step === "inicio";
  useEffect(() => {
    if (!canDecide) return;
    const key = (e: KeyboardEvent) => {
      if (!freeShortcut(e)) return;
      const k = e.key.toLowerCase();
      if (k === "a" && !approveBlocked) { e.preventDefault(); open("aprovar"); }
      else if (k === "e" && rewrite) { e.preventDefault(); open("reescrever"); }
      else if (k === "x") { e.preventDefault(); open("rejeitar"); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  // The fixed sentence (what Approve does, or why it waits) and the shortcut hints. On mobile the sentence only appears
  // when it is a block (check, no account) or when Approve decides in a single tap: otherwise, the step states the
  // account and the time. On desktop it yields its width to the buttons (wrapping onto two lines) instead of pushing
  // them to the next line.
  const note = (
    <div className={`decisao-nota lg:min-w-[260px] lg:flex-1 ${blocked || withoutAccount || oneTouch ? "grid" : ""}`}>
      <p id="rv-nota-aprovar">
        {blocked ? <span className="text-terracota">{tr("Aprovar espera: corrija os cards que a conferência apontou e salve de novo.", "Approval is on hold: fix the cards the check flagged and save again.")}</span>
          : accounts.isSuccess ? (fallback ? noteApprove(fallback) : <WithoutAccount />) : accounts.isError ? tr("Aprovar: você escolhe a conta no próximo passo.", "Approve: you choose the account in the next step.") : ""}
      </p>
      <div aria-hidden="true" className="dicas">
        <span><span className="kbd">←</span><span className="kbd">→</span> {tr("cards", "cards")}</span>
        {queue.length > 1 && <span><span className="kbd">J</span><span className="kbd">K</span> {tr("fila", "queue")}</span>}
      </div>
    </div>
  );

  let body: ReactNode;
  if (outlet.papel === "reporter") {
    body = <p className="m-0 text-[15px]">{whoDecides(members.data?.membros ?? [])}</p>;
  } else if (step === "aprovar") {
    body = <ApproveStep contas={accounts} ocupado={busy} voltar={back} enviar={(c) => send({ decisao: "aprovar", ...c })} erro={decision.error} nota={note} />;
  } else if (step === "reescrever") {
    body = <RewriteStep rodada={s.rodada} ocupado={busy} voltar={back} enviar={(instruction) => send({ decisao: "reescrever", instrucao: instruction })} erro={decision.error} nota={note} />;
  } else if (step === "rejeitar") {
    body = <RejectStep ocupado={busy} voltar={back} enviar={(reason) => send({ decisao: "rejeitar", motivo: reason })} erro={decision.error} nota={note} />;
  } else {
    body = (
      <>
        <div className="decisao-linha">
          {note}
          <div className="decisao-botoes flex-wrap">
            <button ref={buttons.rejeitar} type="button" onClick={() => open("rejeitar")} aria-keyshortcuts="X" className="btn-sec px-3 text-terracota max-lg:-ml-2">{tr("Rejeitar", "Reject")}<Key k="X" /></button>
            {rewrite && <button ref={buttons.reescrever} type="button" onClick={() => open("reescrever")} aria-keyshortcuts="E" className="btn-sec px-3">{tr("Reescrever", "Rewrite")}<Key k="E" /></button>}
            <button ref={buttons.aprovar} type="button" onClick={() => open("aprovar")} disabled={approveBlocked}
              aria-describedby="rv-nota-aprovar" aria-keyshortcuts="A" className="btn-tinta disabled:cursor-not-allowed">
              <SeenPencil className="text-sobre-tinta" seed={9} /> {tr("Aprovar", "Approve")}<Key k="A" />
            </button>
            {oneTouch && (
              <button type="button" onClick={() => send({ decisao: "aprovar", contaId: fallback!.id }, true)} disabled={busy} className="btn-tinta max-lg:basis-full">
                <SeenPencil className="text-sobre-tinta" seed={9} /> {busy ? tr("Aprovando…", "Approving…") : tr("Aprovar e ir para a próxima", "Approve and go to the next")}
              </button>
            )}
          </div>
        </div>
        {oneTouch && decision.isError && <p role="alert" className="faixa-erro m-0">{(decision.error as Error).message}</p>}
      </>
    );
  }

  return (
    <aside aria-label={tr("Decisão", "Decision")}onKeyDown={(e) => { if (e.key === "Escape" && step !== "inicio" && !busy) back(); }} className="barra-decisao bottom-[var(--pe)]">
      {/* A tall step on a short screen: the bar never goes past the top of the screen (it scrolls inside only in that case). */}
      <div className="max-h-[calc(100dvh_-_var(--topo)_-_96px)] overflow-y-auto pb-[calc(8px+env(safe-area-inset-bottom))] lg:pb-2.5">{body}</div>
    </aside>
  );
}

type PropsStep = { ocupado: boolean; voltar: () => void; erro: Error | null; nota: ReactNode };

/** An open step's footer: the fixed sentence on the left (desktop) and, on the right, Cancel and the decision, where the three buttons were. */
function FootStep({ ocupado: busy, voltar: back, nota: note, children }: Omit<PropsStep, "erro"> & { children?: ReactNode }) {
  return (
    <div className="decisao-linha">
      {note}
      <div className="decisao-botoes">
        <button type="button" onClick={back} disabled={busy} className="btn-sec">{tr("Cancelar", "Cancel")}</button>
        {children}
      </div>
    </div>
  );
}

const StepError = ({ erro: error }: { erro: Error | null }) => (error ? <p role="alert" className="m-0 text-[15px] text-terracota">{decisionMessage(error as ApiError)}</p> : null);

/** Focuses the element when the step opens (the title, or the field when it is required). */
function useFocusOnOpen<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return ref;
}

/** Ready-made reasons: each goes into the field, alongside whatever is already written, and leaves with another tap. */
function Reasons({ motivos: reasons, valor: value, mudar: change }: { motivos: string[]; valor: string; mudar: (v: string) => void }) {
  const parts = value.split(";").map((p) => p.trim()).filter(Boolean);
  return (
    <div role="group" aria-label={tr("Motivos prontos", "Ready-made reasons")} className="flex flex-wrap gap-1.5">
      {reasons.map((m) => {
        const posted = parts.includes(m);
        return <button key={m} type="button" aria-pressed={posted} onClick={() => change((posted ? parts.filter((p) => p !== m) : [...parts, m]).join("; "))} className="chip">{m}</button>;
      })}
    </div>
  );
}

function ApproveStep({ contas: accounts, enviar: send, ...p }: PropsStep & { contas: ReturnType<typeof useAccounts>; enviar: (c: { contaId: string; agendarPara?: string }) => void }) {
  const title = useFocusOnOpen<HTMLHeadingElement>();
  const list = accounts.data?.contas ?? [];
  const [accountId, setAccountId] = useState<string | undefined>(undefined);
  const [schedule, setSchedule] = useState(false);
  const [time, setTime] = useState("");
  const [stroke, setStroke] = useState(0);
  const [timeError, setErrorTime] = useState(false);
  const account: Account | undefined = list.find((c) => c.id === accountId) ?? list[0];
  const manual = account?.modo === "manual";

  const confirm = (e: FormEvent) => {
    e.preventDefault();
    if (!account) return;
    const scheduleTo = schedule ? timeScheduled(time) : null;
    if (schedule && !scheduleTo) { setErrorTime(true); return; }
    setStroke((n) => n + 1);
    send({ contaId: account.id, ...(scheduleTo ? { agendarPara: scheduleTo } : {}) });
  };

  return (
    <form onSubmit={confirm} className="grid gap-3" noValidate>
      <div className="decisao-passo">
        <h2 ref={title} tabIndex={-1} className="m-0 text-[18px] font-bold text-texto-forte">{tr("Aprovar este post", "Approve this post")}</h2>
        {accounts.isPending ? (
          <p className="m-0 text-apoio" role="status">{tr("Carregando as contas…", "Loading the accounts…")}</p>
        ) : accounts.isError ? (
          <FailureLoad oque={tr("as contas", "the accounts")} tentar={() => accounts.refetch()} />
        ) : !list.length ? (
          <p className="m-0"><WithoutAccount /></p>
        ) : (
          <>
            {list.length > 1 ? (
              <fieldset className="m-0 grid gap-1 border-0 p-0">
                <legend className="mb-1 p-0 text-[15px] font-bold text-texto-forte">{tr("Onde postar", "Where to post")}</legend>
                {list.map((c) => (
                  <label key={c.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-btn px-2 hover:bg-papel-2">
                    <input type="radio" name="conta" value={c.id} checked={c.id === account?.id} onChange={() => setAccountId(c.id)} className="size-[18px] accent-[var(--color-tinta)]" />
                    <span><b className="text-texto-forte">{accountName(c)}</b> <span className="text-apoio">· {asPosts(c.modo, c.provedor)}</span></span>
                  </label>
                ))}
              </fieldset>
            ) : (
              <p className="m-0">{tr("Em", "On")} <b className="text-texto-forte">{accountName(list[0])}</b> <span className="text-apoio">· {asPosts(list[0].modo, list[0].provedor)}</span></p>
            )}
            <fieldset className="m-0 grid gap-1 border-0 p-0">
              <legend className="mb-1 p-0 text-[15px] font-bold text-texto-forte">{tr("Quando", "When")}</legend>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-btn px-2 hover:bg-papel-2">
                <input type="radio" name="quando" checked={!schedule} onChange={() => setSchedule(false)} className="size-[18px] accent-[var(--color-tinta)]" />
                <span>{manual ? tr("Sem horário", "No set time") : tr("Agora", "Now")} <span className="text-apoio">· {manual ? tr("você posta quando puder", "you post when you can") : tr("posta logo depois de aprovar", "posts right after you approve")}</span></span>
              </label>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-btn px-2 hover:bg-papel-2">
                <input type="radio" name="quando" checked={schedule} onChange={() => setSchedule(true)} className="size-[18px] accent-[var(--color-tinta)]" />
                <span>{manual ? tr("Anotar horário", "Note a time") : tr("Marcar horário", "Schedule a time")} <span className="text-apoio">· {manual ? tr("só um lembrete: você posta à mão", "just a reminder: you post it by hand") : tr("posta sozinho na hora", "posts on its own at that time")}</span></span>
              </label>
              {schedule && (
                <label className="campo mt-1 pl-2">
                  <span className="sr-only">{tr("Dia e hora", "Date and time")}</span>
                  <input type="datetime-local" value={time} onChange={(e) => { setTime(e.target.value); setErrorTime(false); }}
                    aria-invalid={timeError} aria-describedby={timeError ? "rv-horario-erro" : undefined} className="entrada" />
                  {timeError && <span id="rv-horario-erro" className="text-[14px] text-terracota">{tr("Escolha um dia e hora daqui para a frente.", "Choose a date and time in the future.")}</span>}
                </label>
              )}
            </fieldset>
          </>
        )}
        <StepError erro={p.erro} />
      </div>
      <FootStep {...p}>
        <button type="submit" disabled={p.ocupado || !account} className="btn-tinta">
          <SeenPencil key={stroke} desenhar={stroke > 0} className="text-sobre-tinta" seed={9} /> {p.ocupado ? tr("Aprovando…", "Approving…") : tr("Aprovar", "Approve")}
        </button>
      </FootStep>
    </form>
  );
}

function RewriteStep({ rodada: round, enviar: send, ...p }: PropsStep & { rodada: number; enviar: (instruction: string) => void }) {
  const title = useFocusOnOpen<HTMLHeadingElement>();
  const [instruction, setInstruction] = useState("");
  const exhausted = round >= MAX_VERSIONS;
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (!exhausted) send(instruction.trim()); }} className="grid gap-3">
      <div className="decisao-passo">
        <h2 ref={title} tabIndex={-1} className="m-0 flex items-baseline gap-3 text-[18px] font-bold text-texto-forte">
          {tr("Reescrever", "Rewrite")} {!exhausted && <span className="mono font-normal text-apoio">{tr(`cria a versão ${round + 1} de ${MAX_VERSIONS}`, `creates version ${round + 1} of ${MAX_VERSIONS}`)}</span>}
        </h2>
        {exhausted ? (
          <p className="m-0">{tr(`Já são ${MAX_VERSIONS} versões deste post. Aprove ou rejeite esta.`, `This post already has ${MAX_VERSIONS} versions. Approve or reject this one.`)}</p>
        ) : (
          <>
            <div className="campo">
              <label htmlFor="rv-instrucao" className="text-[15px] font-bold text-texto-forte">{tr("O que mudar?", "What should change?")} <span className="font-normal text-apoio">{tr("(opcional)", "(optional)")}</span></label>
              <Reasons motivos={[tr("Mais curto", "Shorter"), tr("Outro ângulo", "Another angle"), tr("Tom mais sóbrio", "A more sober tone"), tr("Trocar a manchete", "Change the headline")]}
                valor={instruction} mudar={(v) => setInstruction(v.slice(0, 1000))} />
              <textarea id="rv-instrucao" value={instruction} onChange={(e) => setInstruction(e.target.value)} maxLength={1000} rows={2} autoCapitalize="sentences" enterKeyHint="enter"
                placeholder={tr("Ex.: manchete mais curta; dizer o horário da liberação", "E.g.: a shorter headline; say what time it reopens")} className="entrada resize-y" />
            </div>
            <p className="ajuda m-0">{tr("O texto é escrito de novo e conferido com as fontes. Leva 1 ou 2 minutos.", "The text is written again and checked against the sources. It takes 1 or 2 minutes.")}</p>
          </>
        )}
        <StepError erro={p.erro} />
      </div>
      <FootStep {...p}>
        {!exhausted && <button type="submit" disabled={p.ocupado} className="btn-tinta">{p.ocupado ? tr("Enviando…", "Sending…") : tr("Reescrever", "Rewrite")}</button>}
      </FootStep>
    </form>
  );
}

function RejectStep({ enviar: send, ...p }: PropsStep & { enviar: (reason: string) => void }) {
  const field = useFocusOnOpen<HTMLTextAreaElement>();
  const [reason, setReason] = useState("");
  const [missed, setMissed] = useState(false);
  const sendReason = (e: FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 3) { setMissed(true); field.current?.focus(); return; }
    send(reason.trim());
  };
  return (
    <form onSubmit={sendReason} className="grid gap-3" noValidate>
      <div className="decisao-passo">
        <h2 className="m-0 text-[18px] font-bold text-texto-forte">{tr("Rejeitar este post", "Reject this post")}</h2>
        <div className="campo">
          <label htmlFor="rv-motivo" className="text-[15px] font-bold text-texto-forte">{tr("Por quê?", "Why?")}</label>
          <Reasons motivos={[tr("Não é notícia para nós", "Not news for us"), tr("Já demos", "We already ran it"), tr("Fonte fraca", "Weak source")]}
            valor={reason} mudar={(v) => { setReason(v.slice(0, 500)); setMissed(false); }} />
          <textarea ref={field} id="rv-motivo" value={reason} onChange={(e) => { setReason(e.target.value); setMissed(false); }} maxLength={500} rows={2} required autoCapitalize="sentences" enterKeyHint="enter"
            aria-invalid={missed} aria-describedby="rv-motivo-ajuda" placeholder={tr("Ex.: notícia velha; fora da nossa área", "E.g.: old news; outside our area")} className="entrada resize-y" />
        </div>
        <p id="rv-motivo-ajuda" className={`m-0 text-[14px] ${missed ? "text-terracota" : "text-apoio"}`}>
          {missed ? tr("Escreva o motivo (uma frase basta).", "Write the reason (one sentence is enough).") : tr("A ideia sai da lista e o motivo fica registrado.", "The idea leaves the list and the reason is recorded.")}
        </p>
        <StepError erro={p.erro} />
      </div>
      <FootStep {...p}>
        <button type="submit" disabled={p.ocupado} className="btn-tinta bg-terracota">{p.ocupado ? tr("Rejeitando…", "Rejecting…") : tr("Rejeitar", "Reject")}</button>
      </FootStep>
    </form>
  );
}

function Skeleton({ id }: { id: string }) {
  return (
    <div aria-busy="true" className="rv-grade">
      <p role="status" className="sr-only">{tr("Carregando o post", "Loading the post")}</p>
      <SideQueue id={id} />
      <div className="flex gap-3 overflow-hidden">
        {[0, 1].map((i) => <div key={i} className="esqueleto aspect-[4/5] w-[min(64vw,320px)] flex-none lg:w-[min(82%,480px)]" />)}
      </div>
      <div className="grid content-start gap-3">
        <div className="esqueleto h-10 w-64" />
        <div className="esqueleto h-3 w-40" />
        <div className="esqueleto h-8 w-[90%]" />
        <div className="esqueleto h-8 w-[70%]" />
        <div className="esqueleto mt-4 h-20 w-full" />
      </div>
    </div>
  );
}
