// The outlet shell (DESIGN.md §5 and §12). Desktop (≥ 1024 px): the desk (a 256 px sidebar and frame) with the paper
// sheet on top; in the sidebar, the outlet picker, "New idea" (N), "Go to…" (⌘K), the sections in 34 px rows, a card
// with what is happening (In production, First steps or Today), the Outlet group (collapsible) and the account at the
// bottom; at the top of the sheet, the folio. Mobile: a bar at the top (outlet, avatar) and navigation at the bottom
// (Ideas · Approve · + · Post · Posted), opaque, separated by a rule. The active tab in graphite.
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Navigate, Outlet, ScrollRestoration, useLocation, useNavigate, useParams } from "react-router";
import { Opening, FailureLoad, freeShortcut } from "../common";
import {
  STEPS, newOutsideWarning, barsSparkline, hour, instant, waitLine, weekLine, newMode, alonePosts, postedPerDay, firstSteps, stepLabel,
  useSources, useLeads, usePieces, readyUse, usePublications, useStatusPiece, type NewMode, type PieceQueue,
} from "../queue";
import { t } from "../language";
import GazzpushBrand from "../kit/GazzpushMark";
import { rememberOutlet, useMe } from "../session";
import NotFound from "../screens/NotFound";
import { outletParts, sections, type CtxShell, type PieceMode } from "./context";
import {
  IconApprove, IconSearch, IconRight, IconAccounts, IconTeam, IconClose, IconSources, IconIdeas, IconKit, IconMore, IconPlan, IconBrand, IconPosted, IconPost, IconRay, IconArrow, IconTexts, RecordIcon,
} from "./icons";
import SheetShortcuts from "./ShortcutsSheet";
import { Folio } from "./Folio";
import NewSheet, { type Brought } from "./NewSheet";
import { Brand, MenuAccount, SelectorOutlet, useSignOut } from "./Menus";
import Palette, { shortcutPalette } from "./Palette";


const ICONS = { "": IconIdeas, aprovar: IconApprove, postar: IconPost, postados: IconPosted } as const;
const ICONS_OUTLET = { marca: IconBrand, contas: IconAccounts, fontes: IconSources, equipe: IconTeam, kit: IconKit, plano: IconPlan, chaves: IconRay } as const;

export default function Shell() {
  const { veiculo: slug } = useParams();
  const local = useLocation();
  const me = useMe();
  const outlet = me.data?.tenants.find((t) => t.slug === slug);
  const output = useSignOut();
  const navigate = useNavigate();
  const sheet = newMode(new URLSearchParams(local.search).get("nova"));
  const [pieceMode, markPiece] = useState<PieceMode>(null);
  const review = pieceMode === "revisao";
  // The + New read that finished with the sheet closed: the notice stays on screen until "View" or close, with the outlet
  // the read started in (the person may have switched outlets meanwhile).
  const [broughtOutside, setBroughtOutside] = useState<{ r: Brought; slug: string } | null>(null);
  useEffect(() => { if (outlet) rememberOutlet(outlet.slug); }, [outlet]);
  // The screen changed: focus goes to the start of the new content (the clicked link left with the old screen), without scrolling.
  const content = useRef<HTMLElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    content.current?.focus({ preventScroll: true });
  }, [local.pathname]);

  // ⌘K / Ctrl K opens the command palette. The Story editor's palette uses the same key and answers first (it calls
  // preventDefault): here only what nobody handled counts.
  const [palette, setPalette] = useState(false);
  // On a text's desk (/textos/:id) ⌘K belongs to the Story editor, even with focus outside the text (the panel, the body).
  const inDesk = /\/textos\/[^/]+$/.test(local.pathname);
  const inDeskRef = useRef(inDesk);
  inDeskRef.current = inDesk;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "k" || inDeskRef.current) return;
      e.preventDefault();
      setPalette((v) => !v);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  // N opens New idea and ? opens the shortcuts sheet: a single key, with focus on the content and outside a field (§6.12).
  const [shortcuts, setShortcuts] = useState(false);
  const openNewRef = useRef<() => void>(() => {});
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!freeShortcut(e) || inDeskRef.current) return;
      if (e.key === "?") { e.preventDefault(); setShortcuts(true); }
      else if (e.key.toLowerCase() === "n" && !e.shiftKey) { e.preventDefault(); openNewRef.current(); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  if (me.isPending) return <Opening />;
  if (me.isError) {
    return <main className="mx-auto max-w-[560px] px-5 pt-16"><FailureLoad oque={t("a sua conta", "your account")} tentar={() => me.refetch()} /></main>;
  }
  if (!me.data) return <Navigate to={`/entrar?de=${encodeURIComponent(local.pathname)}`} replace />;
  if (!outlet) return <NotFound mensagem={t("Esse veículo não existe ou você não faz parte dele.", "This publication doesn't exist or you're not part of it.")} />;

  const ctx: CtxShell = { veiculo: outlet, me: me.data, marcarPeca: markPiece };
  // + New: the sheet lives in the URL (`?nova=<tab>`) over the current screen. Whoever opened it from here goes back in
  // history on close; whoever arrived with `?nova` in the URL only loses the parameter.
  const newOpen = () => { setBroughtOutside(null); navigate({ pathname: local.pathname, search: "?nova=link" }, { state: { folha: true } }); };
  openNewRef.current = newOpen;
  const newWith = (m: NewMode | null) => {
    const b = new URLSearchParams(local.search);
    if (m) b.set("nova", m); else b.delete("nova");
    return { pathname: local.pathname, search: b.size ? `?${b}` : "" };
  };
  const swapTab = (m: NewMode) => navigate(newWith(m), { replace: true, state: local.state });
  const newClose = () => ((local.state as { folha?: boolean } | null)?.folha ? navigate(-1) : navigate(newWith(null), { replace: true }));
  return (
    <div data-casca className="min-h-dvh lg:pl-64">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-btn focus:bg-papel focus:px-4 focus:py-3 focus:font-bold">
        {t("Pular para o conteúdo", "Skip to content")}
      </a>
      <Sidebar ctx={ctx} modoPeca={pieceMode} onSair={() => output.mutate()} onNova={newOpen} onPaleta={() => setPalette(true)} onAtalhos={() => setShortcuts(true)} />
      {/* The sheet's frame (desktop only): fixed and hollow, it paints the desk around it and draws the paper edge. */}
      <div aria-hidden="true" className="moldura" />
      <header className="fixed inset-x-0 top-0 z-30 flex h-[58px] items-center gap-2 bg-papel pr-3 pl-3 shadow-fio lg:hidden">
        <Brand veiculo={outlet} className="size-8 text-[15px]" />
        <SelectorOutlet veiculo={outlet} veiculos={me.data.tenants} />
        <MenuAccount me={me.data} onSair={() => output.mutate()} partes textos={outlet.modo === "autoral"} />
      </header>
      {output.isError && (
        <div role="alert" className="faixa-erro fixed inset-x-3 top-[66px] z-40 flex flex-wrap items-baseline gap-x-2 shadow-curta lg:top-4 lg:right-6 lg:left-[280px]">
          <span>{t("Não deu para sair agora; você continua conectado.", "Couldn't sign out right now; you're still signed in.")}</span>
          <button type="button" onClick={() => output.mutate()} className="cursor-pointer font-bold underline underline-offset-3">{t("Tentar de novo", "Try again")}</button>
        </div>
      )}
      {broughtOutside && (
        <p role="status" className="fixed inset-x-3 bottom-[calc(78px+env(safe-area-inset-bottom))] z-40 m-0 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-faixa bg-papel-2 py-1.5 pr-1 pl-3 text-[15px] font-bold text-texto-forte shadow-curta lg:right-6 lg:bottom-6 lg:left-auto lg:max-w-[560px]">
          <span className="py-1">{newOutsideWarning(broughtOutside.r)}{broughtOutside.slug !== outlet.slug ? ` (${me.data.tenants.find((t) => t.slug === broughtOutside.slug)?.nome ?? t("outro veículo", "another publication")})` : ""}</span>
          <Link to={`/t/${broughtOutside.slug}${broughtOutside.r.peca ? `/p/${broughtOutside.r.peca.id}` : ""}`} state={{ nova: broughtOutside.r }} viewTransition onClick={() => setBroughtOutside(null)}
            className="link-acao inline-flex min-h-9 items-center">{t("Ver", "View")}</Link>
          <button type="button" onClick={() => setBroughtOutside(null)} aria-label={t("Fechar aviso", "Close notice")}
            className="ml-auto grid size-9 cursor-pointer place-items-center rounded-btn text-apoio hover:bg-papel hover:text-texto-forte">
            <IconClose className="size-5" />
          </button>
        </p>
      )}
      <main id="conteudo" ref={content} tabIndex={-1} className={`folha-mesa pt-[58px] outline-none lg:pt-2 lg:pr-2 lg:pb-2 ${review ? "" : "pb-[calc(76px+env(safe-area-inset-bottom))]"}`}>
        <Folio veiculo={outlet} />
        {/* Only the inner part swaps on a screen change (view-transition-name): the desk, the frame and the folio stay still. */}
        <div id="miolo">
          {/* In the page flow, at the top: pinned to the bottom of the screen, it covered the buttons of whoever is setting up the outlet. */}
          {outlet.plano === "teste" && (
            <p role="status" className="faixa-aviso m-0 flex flex-wrap items-center gap-x-3 rounded-none px-5 lg:px-12">
              <span>{t("Este veículo ainda não tem plano. Assine para produzir posts e conferir textos.", "This outlet has no plan yet. Subscribe to produce posts and check texts.")}</span>
              {outlet.papel === "admin" && <Link to={`/t/${outlet.slug}/veiculo?aba=plano`} className="link-acao inline-flex min-h-9 items-center">{t("Ver os planos", "See the plans")}</Link>}
            </p>
          )}
          <Outlet context={ctx} />
        </div>
      </main>
      <ScrollRestoration />
      {!review && <NavLow tenantId={outlet.id} papel={outlet.papel} modoPeca={pieceMode} onNova={newOpen} />}
      {sheet && (
        <NewSheet tenantId={outlet.id} slug={outlet.slug} autoral={outlet.modo === "autoral"} modo={sheet} trocar={swapTab} fechar={newClose} aoFecharLendo={(r, slug) => setBroughtOutside({ r, slug })} />
      )}
      <Palette aberta={palette} fechar={() => setPalette(false)} veiculo={outlet} veiculos={me.data.tenants} onNova={newOpen} onSair={() => output.mutate()} />
      <SheetShortcuts aberta={shortcuts} fechar={() => setShortcuts(false)} autoral={outlet.modo === "autoral"} />
    </div>
  );
}

/**
 * What waits for you in each section: posts to approve (the same query as Ideas) and approved ones someone posts by hand
 * (those that post by themselves wait for nobody). They go away on approving and on posting. A reporter only brings
 * ideas: for them nothing "waits", and the counter (which is the next action) does not appear.
 */
function useWaiting(tenantId: string, role: string): Record<string, number> {
  const approve = usePieces(tenantId).data?.total.revisao ?? 0;
  const post = readyUse(tenantId).data?.manuais ?? 0;
  return role === "reporter" ? {} : { aprovar: approve, postar: post };
}
const WAITING: Record<string, string> = {
  get aprovar() { return t("para aprovar", "to approve"); },
  get postar() { return t("para postar", "to post"); },
};

const SECTION_POST: Record<string, string> = { revisao: "aprovar", decidida: "aprovar", postar: "postar", postado: "postados" };
/** A post's screen marks the section it is in (PieceMode); outside it, the route counts. */
const useSectionPiece = (mode: PieceMode) => (/\/t\/[^/]+\/p\//.test(useLocation().pathname) ? (mode ? SECTION_POST[mode] : "") : null);

/** Counter of what waits for you (blue pencil: it is the next action). Never a total: Ideas and Posted have none. */
function Counter({ n, oque: what }: { n: number; oque: string }) {
  if (!n) return null;
  return <b className="selo">{n}<span className="sr-only"> {what}</span></b>;
}

// A single label system in the sidebar: every group that is not the main navigation (Outlet and the cards) gets
// upper-case mono; the picker and the account are proper names, in sans. The main navigation has no label.
const LABEL = "lat-rotulo m-0";
const CARD = "mt-3 rounded-faixa bg-branco p-3 shadow-curta";
const GROUP_KEY = "redacao:lateral-veiculo";

/**
 * Desktop sidebar (DESIGN.md §5 and §12): outlet (logo, name, @), "New idea" (N), "Go to…" (⌘K), the flow's sections with
 * what waits for you, a card with what is happening (In production; until the first post goes out, First steps;
 * otherwise, Today), the Outlet group (collapsible; the Sources row gives the collection status) and the account at the
 * bottom. The only solid blue thing is the next action: the counter of what waits for you, or "New idea" for someone who
 * only brings ideas (reporter).
 */
function Sidebar({ ctx: { veiculo: outlet, me }, modoPeca: pieceMode, onSair: onSignOut, onNova: newOn, onPaleta: onPalette, onAtalhos: onShortcuts }: { ctx: CtxShell; modoPeca: PieceMode; onSair: () => void; onNova: () => void; onPaleta: () => void; onAtalhos: () => void }) {
  const waiting = useWaiting(outlet.id, outlet.papel);
  // The Outlet group collapses, and the choice stays in this browser. With one of its parts open on screen, it does not close.
  const [openGroup, openSetGroup] = useState(() => { try { return localStorage.getItem(GROUP_KEY) !== "fechado"; } catch { return true; } });
  const toggleGroup = () => openSetGroup((v) => { try { localStorage.setItem(GROUP_KEY, v ? "fechado" : "aberto"); } catch { /* modo privado */ } return !v; });
  const local = useLocation();
  const inScreenOutlet = /\/veiculo$/.test(local.pathname);
  const tabOutlet = inScreenOutlet ? (new URLSearchParams(local.search).get("aba") ?? "marca") : null;
  const leads = useLeads(outlet.id);
  const pieces = usePieces(outlet.id);
  const ready = readyUse(outlet.id);
  const publications = usePublications(outlet.id);
  const sectionPiece = useSectionPiece(pieceMode);
  const marked = (to: string, active: boolean) => !inScreenOutlet && (sectionPiece === null ? active : to === sectionPiece);
  const created = leads.data?.novasDesde ?? 0;
  const reporter = outlet.papel === "reporter";
  // In production: the oldest post in draft; the others become "+n producing" (the API's total counts when the list stops at 50).
  const drafts = (pieces.data?.pecas ?? []).filter((p) => p.status === "rascunho").sort((a, b) => instant(a.created_at) - instant(b.created_at));
  const producing = drafts[0];
  const moreProducing = Math.max(pieces.data?.total.rascunho ?? 0, drafts.length) - 1;
  const loaded = leads.isSuccess && pieces.isSuccess && ready.isSuccess && publications.isSuccess;
  // Today's week needs all 7 days: while the oldest loaded publication is still from this week and there are more pages,
  // fetch the next one (up to 5 pages, 100 posts; beyond that the week is counted up to there).
  const published = publications.data?.pages.flatMap((pg) => pg.publicacoes) ?? [];
  const moreOldLoaded = published[published.length - 1]?.publicado_em ?? null;
  // A page that failed is not requested again in a loop: the week stays counted up to there (Posted has the try-again).
  const incompleteWeek = !!publications.hasNextPage && !publications.isFetchingNextPage && !publications.isFetchNextPageError && (publications.data?.pages.length ?? 0) < 5
    && !!moreOldLoaded && instant(moreOldLoaded) > Date.now() - 7 * 864e5;
  useEffect(() => { if (incompleteWeek) publications.fetchNextPage(); }, [incompleteWeek, publications]);
  const steps = loaded
    ? firstSteps({
        ideias: leads.data.pautas.length, posts: Object.values(pieces.data.total).reduce((a, b) => a + b, 0),
        prontos: ready.data.pecas.length, postados: publications.data.pages[0]?.publicacoes.length ?? 0,
      })
    : null;
  return (
    <aside data-lateral aria-label={t("Veículo e seções", "Publication and sections")} className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col overflow-y-auto bg-mesa px-3 lg:flex">
      {/* The top stays pinned: on a short screen the sidebar scrolls under it, and the outlet and New idea stay in place. */}
      <div className="sticky top-0 z-10 -mx-3 grid gap-2 bg-mesa px-3 pt-2.5 pb-2">
        <SelectorOutlet veiculo={outlet} veiculos={me.tenants} lateral />
        <button type="button" onClick={newOn} aria-haspopup="dialog" aria-keyshortcuts="N"
          className={`flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-btn pr-2 pl-2.5 text-[14px] font-semibold transition-[background-color,box-shadow,scale] duration-150 ${reporter ? "bg-tinta text-sobre-tinta" : "bg-branco text-tinta shadow-curta hover:shadow-eleva"}`}>
          <IconMore className="size-[18px]" /> {t("Nova ideia", "New idea")}
          <span aria-hidden="true" className={`kbd ml-auto ${reporter ? "bg-transparent text-sobre-tinta shadow-[0_0_0_1px_rgb(255_255_255/.35)]" : ""}`}>N</span>
        </button>
        {/* Go anywhere: sections, posts by title, outlets (⌘K). It looks like a field so the shortcut stays visible. */}
        <button type="button" onClick={onPalette} aria-haspopup="dialog" aria-keyshortcuts="Control+K Meta+K"
          className="flex min-h-[34px] w-full cursor-pointer items-center gap-2 rounded-btn bg-papel-3 pr-2 pl-2.5 text-[14px] text-apoio shadow-[inset_0_-1px_0_var(--color-fio)] transition-[background-color,color,scale] duration-150 hover:bg-branco hover:text-texto-forte">
          <IconSearch className="size-4" /> {t("Ir para…", "Go to…")}
          <span aria-hidden="true" className="kbd ml-auto">{shortcutPalette()}</span>
        </button>
      </div>
      <nav aria-label={t("Seções", "Sections")} className="grid gap-px pt-1.5">
        {/* Author outlet: Texts (review desk) opens the Flow; the section stays marked inside a text. */}
        {outlet.modo === "autoral" && (
          <NavLink to="textos" viewTransition className={({ isActive }) => `lat-item ${marked("textos", isActive) ? "lat-ativa" : ""}`}>
            {({ isActive }) => (
              <>
                {marked("textos", isActive) && <span aria-hidden="true" className="marca-margem" />}
                <IconTexts className="size-[18px]" />
                <span className="min-w-0 flex-1 truncate">{t("Textos", "Texts")}</span>
              </>
            )}
          </NavLink>
        )}
        {sections().map(({ to, rotulo: label }) => {
          const Icon = ICONS[to];
          return (
            <NavLink key={to} to={to} end viewTransition className={({ isActive }) => `lat-item ${marked(to, isActive) ? "lat-ativa" : ""}`}>
              {({ isActive }) => (
                <>
                  {marked(to, isActive) && <span aria-hidden="true" className="marca-margem" />}
                  <Icon className="size-[18px]" />
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  {to === "" && created > 0 && <span className="mono flex-none text-[11px] text-apoio">{t(`${created} nova${created > 1 ? "s" : ""}`, `${created} new`)}</span>}
                  {WAITING[to] && <span className="flex-none"><Counter n={waiting[to] ?? 0} oque={WAITING[to]} /></span>}
                </>
              )}
            </NavLink>
          );
        })}
      </nav>
      {steps ? (
        <section aria-labelledby="lt-passos" className={CARD}>
          <h2 id="lt-passos" className={`${LABEL} mb-2.5 flex items-baseline justify-between font-normal`}>
            {t("Primeiros passos", "Getting started")} <span className="normal-case tracking-normal">{steps.filter((p) => p.feito).length} {t("de", "of")} {steps.length}</span>
          </h2>
          <ol className="m-0 grid list-none gap-2 p-0 text-[13.5px]">
            {steps.map((p, i) => {
              const next = !p.feito && steps.slice(0, i).every((x) => x.feito);
              const to = p.id === "aprovado" ? (waiting.aprovar ? "aprovar" : "") : p.id === "postado" ? "postar" : "";
              return (
                <li key={p.id} className={`flex items-center gap-2 ${p.feito ? "text-apoio" : next ? "font-bold text-texto-forte" : "text-apoio"}`}>
                  <span aria-hidden="true" className={`grid size-[18px] flex-none place-items-center rounded-full text-[11px] ${p.feito ? "bg-verde-claro text-verde" : next ? "bg-tinta text-sobre-tinta" : "bg-papel-2 text-apoio"}`}>
                    {p.feito ? <IconRight className="size-3" /> : i + 1}
                  </span>
                  {next && p.id === "ideia" ? (
                    <button type="button" onClick={newOn} className="link-acao cursor-pointer">{p.rotulo}</button>
                  ) : next ? (
                    <Link to={to} viewTransition className="link-acao">{p.rotulo}</Link>
                  ) : (
                    <span className={p.feito ? "line-through decoration-fio-forte" : ""}>{p.rotulo}</span>
                  )}
                  <span className="sr-only">{p.feito ? t(", feito", ", done") : next ? t(", próximo passo", ", next step") : ""}</span>
                </li>
              );
            })}
          </ol>
        </section>
      ) : producing ? (
        <InProduction tenantId={outlet.id} peca={producing} mais={moreProducing} />
      ) : null}
      {loaded && !steps && !producing && (
        <Today
          publicados={publications.data.pages.flatMap((pg) => pg.publicacoes).filter((p) => p.modo !== "simulada").map((p) => p.publicado_em)}
          aprovar={reporter ? null : { n: waiting.aprovar ?? 0, maisAntigo: pieces.data.pecas.find((p) => p.status === "revisao")?.updated_at ?? null }}
          postar={reporter ? null : (() => {
            const manual = ready.data.pecas.find((p) => !alonePosts(p.conta_modo));
            return { n: waiting.postar ?? 0, maisAntigo: manual?.updated_at ?? null, anotado: manual?.agendado_para ?? null };
          })()} />
      )}
      {/* The Outlet group: collapses so the sidebar fits on a short screen. The Sources row gives the collection status. */}
      <button type="button" data-linha onClick={toggleGroup} aria-expanded={openGroup || inScreenOutlet} aria-controls="lt-veiculo"
        className={`${LABEL} mt-3.5 flex min-h-[30px] w-full cursor-pointer items-center justify-between rounded-faixa pr-2 pl-2.5 hover:bg-papel-3 hover:text-texto-forte active:bg-aperto`}>
        {t("Veículo", "Publication")}
        <IconArrow className={`size-3.5 transition-transform duration-200 ${openGroup || inScreenOutlet ? "" : "-rotate-90"}`} />
      </button>
      <nav id="lt-veiculo" aria-label={t("Veículo", "Publication")} hidden={!(openGroup || inScreenOutlet)} className="grid gap-px pb-3">
        {outletParts().map(({ aba: tab, rotulo: label }) => {
          const Icon = ICONS_OUTLET[tab];
          const active = tabOutlet === tab;
          return (
            <Link key={tab} to={`veiculo?aba=${tab}`} viewTransition aria-current={active ? "page" : undefined} className={`lat-item ${active ? "lat-ativa" : ""}`}>
              {active && <span aria-hidden="true" className="marca-margem" />}
              <Icon className="size-[18px]" />
              <span className="min-w-0 flex-1 truncate">{label}</span>
              {tab === "fontes" && <SourcesState tenantId={outlet.id} />}
            </Link>
          );
        })}
      </nav>
      {/* The account stays pinned at the bottom: on a short screen the sidebar scrolls under it, and the menu stays at hand. */}
      <div className="sticky bottom-0 z-10 -mx-3 mt-auto bg-mesa px-3 pt-2 pb-2.5">
        <GazzpushBrand className="mb-2 ml-2 w-32" />
        <MenuAccount me={me} onSair={onSignOut} papel={outlet.papel} onAtalhos={onShortcuts} />
      </div>
    </aside>
  );
}

/** The post being produced right now: step, step out of 4 and what comes next. Follows every 5 s. */
function InProduction({ tenantId, peca: piece, mais: more }: { tenantId: string; peca: PieceQueue; mais: number }) {
  const status = useStatusPiece(tenantId, piece.id);
  const stage = status.data?.etapa ?? null;
  const step = stage ? STEPS.indexOf(stage) + 1 : 0;
  return (
    <section aria-labelledby="lt-producao" className={CARD}>
      <h2 id="lt-producao" className={`${LABEL} mb-2 flex items-center justify-between gap-2 font-normal`}>
        {t("Em produção", "In production")}
        <RecordIcon className="text-texto-forte" />
      </h2>
      <p className="m-0 line-clamp-2 text-[13.5px] leading-[1.3] font-semibold text-texto-forte">{piece.manchete ?? piece.titulo}</p>
      {/* The steps in graphite (progress is not an action): finished ones solid, the current one with the running stroke. */}
      <span aria-hidden="true" className="etapas mt-2.5">
        {STEPS.map((e, i) => <i key={e} data-feita={i < step - 1 ? "" : undefined} data-agora={i === Math.max(step - 1, 0) ? "" : undefined} />)}
      </span>
      <p className="mono m-0 mt-2 text-[11px] text-apoio">{stage ? `${stepLabel(stage, piece.formato)} · ${step} ${t("de", "of")} ${STEPS.length}` : t("começando", "starting")}</p>
      <p className="m-0 mt-2 flex items-baseline justify-between text-[13px] text-apoio">
        <span>{t("depois: Para aprovar", "next: To approve")}</span>
        <Link to={`p/${piece.id}`} viewTransition className="link-acao text-[13px]">{t("Acompanhar", "Follow")}</Link>
      </p>
      {more > 0 && (
        <p className="m-0 mt-1.5 text-[13px]">
          <Link to="" viewTransition className="link-acao text-[13px]">{t(`+${more} produzindo`, `+${more} in production`)}</Link>
        </p>
      )}
    </section>
  );
}

type QueueItem = { n: number; maisAntigo: string | null; anotado?: string | null };

/**
 * Today, in place of the progress card when nothing is producing and there are no First steps: the week in seven bars
 * (today marked) with "today n · week n", and, below, how much waits in each queue and how long the oldest has been
 * waiting (a noted time takes the wait's place). It is the context the sidebar counter lacks. Pace, not a total: it
 * reads the Posted pages already loaded (20 per page), without simulated ones (nothing really went out). For a reporter
 * nothing waits, and the queues do not appear. The next collection lives in the Sources row.
 */
function Today({ publicados: published, aprovar: approve, postar: post }: { publicados: (string | null)[]; aprovar: QueueItem | null; postar: QueueItem | null }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  const perDay = postedPerDay(published, now);
  // The size of a word, next to the number (it fits in the 256 px sidebar without breaking the line). A 4 px gap: the
  // seven days read one by one, even when all are stubs.
  const W = 60, H = 20;
  const bars = barsSparkline(perDay, W, H, 4);
  const queues = [
    approve && waitLine({ ...approve, oque: t("para aprovar", "to approve") }, now),
    post && waitLine({ ...post, oque: t("para postar", "to post") }, now),
  ].filter((x): x is string => !!x);
  return (
    <section aria-labelledby="lt-hoje" className={CARD}>
      <h2 id="lt-hoje" className={`${LABEL} mb-2.5 font-normal`}>{t("Hoje", "Today")}</h2>
      <div className="flex items-end gap-3">
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true" className="block flex-none overflow-visible">
          <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} stroke="var(--color-fio-forte)" strokeWidth="1" />
          {bars.map((b, i) => { const h = Math.max(b.h, 3); return <rect key={i} x={b.x} y={H - h} width={b.w} height={h} rx="1" fill={i === bars.length - 1 ? "var(--color-texto-forte)" : "var(--color-fio-forte)"} />; })}
        </svg>
        <p className="mono m-0 text-[11px] whitespace-nowrap text-apoio">{weekLine(perDay)}</p>
      </div>
      {queues.length > 0 && (
        <>
          <p className={`${LABEL} mt-3 mb-1.5 border-t border-fio pt-2.5`}>{t("esperam · o mais antigo", "waiting · oldest")}</p>
          <ul className="m-0 grid list-none gap-1 p-0">
            {queues.map((f) => {
              // "4 to approve · 23 h ago": what waits on the left, how long on the right.
              const [what, ...rest] = f.split(" · ");
              return (
                <li key={f} className="mono flex items-baseline justify-between gap-2 text-[11px] text-apoio">
                  <span className="text-texto-forte">{what}<span className="sr-only"> · </span></span>
                  <span className="whitespace-nowrap">{rest.join(" · ")}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

/**
 * The sources' status, on the Outlet group's own Sources row: "collected 08:37" when all is well or "1 unavailable" in
 * amber. The Sources tab has the detail; the sidebar does not grow with the number of feeds. A load failure does not
 * become a fact (DESIGN.md §6.8): "did not load", and the tab has the try-again.
 */
function SourcesState({ tenantId }: { tenantId: string }) {
  const sources = useSources(tenantId);
  if (sources.isPending || (sources.isSuccess && !sources.data.fontes.length)) return null;
  const outside = sources.data?.fontes.filter((f) => !f.ok).length ?? 0;
  return (
    <span className="mono flex-none text-[11px] text-apoio">
      <span className="sr-only">: </span>
      {sources.isError ? t("não carregou", "didn't load") : outside > 0 ? <span className="text-ambar">{outside === 1 ? t("1 indisponível", "1 unavailable") : t(`${outside} indisponíveis`, `${outside} unavailable`)}</span> : sources.data.coletaEm ? t(`coleta ${hour(sources.data.coletaEm)}`, `fetched ${hour(sources.data.coletaEm)}`) : ""}
    </span>
  );
}

function NavLow({ tenantId, papel: role, modoPeca: pieceMode, onNova: newOn }: { tenantId: string; papel: string; modoPeca: PieceMode; onNova: () => void }) {
  const waiting = useWaiting(tenantId, role);
  const sectionPiece = useSectionPiece(pieceMode);
  const item = (active: boolean) =>
    `relative flex flex-col items-center justify-center gap-0.5 text-[12px] no-underline ${active
      ? "font-bold text-texto-forte after:absolute after:bottom-1.5 after:h-0.5 after:w-9 after:rounded-[1px] after:bg-texto-forte"
      : "text-apoio"}`;
  const [ideas, ...rest] = sections();
  const link = ({ to, curto: short }: ReturnType<typeof sections>[number]) => {
    const Icon = ICONS[to];
    return (
      <NavLink key={to} to={to} end viewTransition className={({ isActive }) => item(sectionPiece === null ? isActive : to === sectionPiece)}>
        <span className="relative grid h-8 place-items-center">
          <Icon />
          {WAITING[to] && waiting[to] > 0 && (
            <b className="absolute -top-1 -right-3 min-w-[18px] rounded-full bg-texto-forte px-1 text-center text-[11px] leading-[18px] text-papel">
              {waiting[to]}<span className="sr-only"> {WAITING[to]}</span>
            </b>
          )}
        </span>
        {short}
      </NavLink>
    );
  };
  return (
    <nav aria-label={t("Seções", "Sections")} className="fixed inset-x-0 bottom-0 z-30 grid h-[calc(66px+env(safe-area-inset-bottom))] grid-cols-5 bg-papel pb-[env(safe-area-inset-bottom)] shadow-[0_-1px_0_var(--color-fio-forte)] lg:hidden">
      {link(ideas)}
      {link(rest[0])}
      <button type="button" onClick={newOn} aria-haspopup="dialog" className={`${item(false)} cursor-pointer text-tinta`}>
        <span className="grid h-8 w-11 place-items-center rounded-btn bg-tinta-clara text-tinta"><IconMore /></span>
        <span className="text-tinta">{t("Nova", "New")}</span>
      </button>
      {rest.slice(1).map(link)}
    </nav>
  );
}
