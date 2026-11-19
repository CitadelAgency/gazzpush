// Piece: production progress (write → check against the sources → illustrate → assemble), followed every 2 s through
// the light status (D1 only). It ends in review (./Review: approve, rewrite, reject) or in "it did not work" with the
// reason. Approved or posted, the publish screen (./Publish); rejected, the outcome and the next one to approve.
// Each state's way back sits in the shell's folio (InFolio), no longer inside the page.
import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { api, bodyJson, ApiError, read } from "../api";
import { LimitWarning } from "./LimitNotice";
import { useShell } from "../shell/context";
import { InFolio } from "../shell/Folio";
import { IconRight, IconBack } from "../shell/icons";
import { FailureLoad, useTitle } from "../common";
import { t as tr } from "../language";
import { STEPS, keys, timeProductionSentence, instant, failureReason, accountName, profileInstagram, alonePosts, stepLabel, productionTime, usePieces, readyUse, type PieceStatus } from "../queue";
import { UnderlinePencil, BackPencil } from "../kit/Pencil";
import NotFound from "./NotFound";
import Publish from "./Publish";
import Review from "./Review";

const t = api.t[":tenantId"].pecas[":id"];

/** One component per post: going from one post to another ("Review the next one"), the state (seen version etc.) starts over. */
export default function Piece() {
  const { peca: id = "" } = useParams();
  return <Post key={id} id={id} />;
}

function Post({ id }: { id: string }) {
  const { veiculo: outlet, marcarPeca: markPiece } = useShell();
  const status = useQuery({
    queryKey: keys.status(outlet.id, id),
    queryFn: () => read(t.status.$get({ param: { tenantId: outlet.id, id } })),
    // 2 s while producing; 20 s in review (someone else may decide); approved: 3 s while posting by itself, 60 s with a
    // scheduled time, 30 s if someone posts by hand (someone else may confirm); stopped in a final state. A network
    // failure does not stop the follow-up.
    refetchInterval: (q) => interval(q.state.data),
    refetchIntervalInBackground: false,
  });
  const s = status.data;
  // While the status has not arrived, the sidebar section already follows the list the person came from (the list knows
  // the post's status): the margin mark does not pass through Ideas on its way to To approve or Ready to post. Once the
  // status arrives, the state's screen (Review, Publish) takes over the mark.
  const inPieces = usePieces(outlet.id).data?.pecas.find((p) => p.id === id)?.status;
  const readyIn = readyUse(outlet.id).data?.pecas.find((p) => p.id === id)?.status;
  const inList = inPieces ?? readyIn;
  const fromListMode = s ? null : inList === "revisao" ? "revisao" : inList === "aprovada" || inList === "agendada" ? "postar" : null;
  useLayoutEffect(() => {
    if (!fromListMode) return;
    markPiece(fromListMode);
    return () => markPiece(null);
  }, [fromListMode, markPiece]);
  const editing = useSearchParams()[0].get("editar") === "1";
  // The version from when the post was opened in review: if another arrives (a rewrite finished, someone else edited),
  // review warns. The one the person saved themselves while editing the cards becomes the seen one (`aceitarVersao`), without a warning.
  const [viewVersion, setVersionView] = useState<number>();
  const [roundView, setRoundView] = useState<number>();
  useEffect(() => {
    if (s?.status === "revisao" && viewVersion === undefined) { setVersionView(s.versao); setRoundView(s.rodada); }
  }, [s, viewVersion]);
  // The follow-up saw the post go out (posted by itself, or someone else confirmed): Posted and Ready go stale.
  const qc = useQueryClient();
  const published = s?.status === "publicada";
  useEffect(() => {
    if (!published) return;
    qc.invalidateQueries({ queryKey: keys.publicacoes(outlet.id) });
    qc.invalidateQueries({ queryKey: keys.prontos(outlet.id) });
  }, [published, qc, outlet.id]);
  useTitle(s ? TITLE[s.status] ?? "Post" : "Post", outlet.nome);

  if (status.isError && !s) {
    if (status.error instanceof ApiError && status.error.status === 404) {
      return <NotFound mensagem={tr("Esse post não existe ou é de outro veículo.", "This post doesn't exist or belongs to another publication.")} />;
    }
    return <Frame lista={fromListMode}><h1 className="sr-only">Post</h1><FailureLoad oque={tr("o andamento", "the progress")} tentar={() => status.refetch()} /></Frame>;
  }
  if (!s) return <Frame lista={fromListMode}><h1 className="sr-only">Post</h1><Skeleton /></Frame>;
  if (s.status === "revisao") {
    const changed = viewVersion !== undefined && viewVersion !== s.versao;
    // While editing the cards, the screen stays on the open version: someone else's new version becomes a warning in the
    // editor (and 409 on save), without erasing what this person typed. Outside editing, the screen switches version and warns (`novaVersao`).
    const inScreen = editing && changed ? { ...s, versao: viewVersion, rodada: roundView ?? s.rodada } : s;
    return <Review key={inScreen.versao} s={inScreen} versaoAtual={s.versao} novaVersao={changed ? (roundView !== s.rodada ? "reescrita" : "edicao") : null} aceitarVersao={setVersionView} />;
  }
  if (PUBLISH.includes(s.status)) return <Publish s={s} deRevisao={viewVersion !== undefined} />;

  const version = [formatName(s.formato), s.rodada > 1 ? tr(`nova versão (${s.rodada} de 3)`, `new version (${s.rodada} of 3)`) : null].filter(Boolean).join(" · ");
  return (
    <Frame decidida={DECIDED.includes(s.status)} titulo={s.manchete ?? s.titulo} versao={version}>
      {/* On desktop the format and version are in the folio; on mobile the folio only has room for the way back. */}
      <p className="mono m-0 mb-2 text-apoio lg:hidden">{version}</p>
      <h1 className="titulo-tela m-0 max-w-[24ch] text-[28px] leading-[1.1] lg:text-[34px]">{s.manchete ?? s.titulo}</h1>
      {status.isError && (
        <p role="status" className="faixa-aviso mt-5 mb-0">{tr("Não carregou o andamento agora; tentando de novo.", "Couldn't load the progress just now; trying again.")}</p>
      )}
      {s.status === "rascunho" ? <Progress s={s} /> : s.status === "falhou" ? <Failed s={s} /> : <Other status={s.status} />}
    </Frame>
  );
}

const TITLE: Record<string, string> = {
  get rascunho() { return tr("Produzindo", "In production"); }, get revisao() { return tr("Para aprovar", "To approve"); },
  get aprovada() { return tr("Para postar", "Ready to post"); }, get agendada() { return tr("Para postar", "Ready to post"); },
  get publicada() { return tr("Postado", "Posted"); },
};
/** The post's format on screen (the API value stays the same). */
const formatName = (f: string) => tr(f, f === "carrossel" ? "carousel" : f === "reels" ? "Reel" : f);
const PUBLISH = ["aprovada", "agendada", "publicada"];

function interval(s: PieceStatus | undefined): number | false {
  if (!s || s.status === "rascunho") return 2_000;
  if (s.status === "revisao") return 20_000;
  if (s.status === "aprovada" || s.status === "agendada") {
    if (!alonePosts(s.conta_modo)) return 30_000;
    return s.status === "aprovada" ? 3_000 : 60_000;
  }
  return false;
}

const useIdeas = () => `/t/${useShell().veiculo.slug}`;

/** Rejected in review: the post belongs to To approve, where the person came from. */
const DECIDED = ["rejeitada"];

/**
 * A post's screen outside review and publish. The way back sits in the shell's folio (DESIGN.md §12): the list the
 * post came from (To approve for a rejected one; the list that already knows it, while the status has not arrived;
 * otherwise, Ideas), and, when known, the headline, the format and the version.
 */
function Frame({ children, decidida: decided = false, lista: list = null, titulo: title, versao: version }: {
  children: ReactNode; decidida?: boolean; lista?: "revisao" | "postar" | null; titulo?: string; versao?: string;
}) {
  const ideas = useIdeas();
  const { marcarPeca: markPiece } = useShell();
  useLayoutEffect(() => {
    if (!decided) return;
    markPiece("decidida");
    return () => markPiece(null);
  }, [decided, markPiece]);
  const back = decided || list === "revisao" ? { para: `${ideas}/aprovar`, rotulo: tr("Para aprovar", "To approve") }
    : list === "postar" ? { para: `${ideas}/postar`, rotulo: tr("Prontos para postar", "Ready to post") }
    : { para: ideas, rotulo: tr("Ideias", "Ideas") };
  return (
    <div className="mx-auto max-w-[880px] px-5 pt-5 pb-12 lg:px-12 lg:pt-3">
      <InFolio>
        <Link to={back.para} viewTransition className="max-lg:min-h-10"><IconBack className="size-4" /> {back.rotulo}</Link>
        {title && <><span aria-hidden="true" className="sep">/</span><b>{title}</b></>}
        {version && <span className="mono so-largo">{version}</span>}
      </InFolio>
      {children}
    </div>
  );
}

// ── produzindo ──────────────────────────────────────────────────────────────────────────────────────────────────

function Progress({ s }: { s: PieceStatus }) {
  const { veiculo: outlet } = useShell();
  // The outlet's history = the posts ready to approve (the same query as the shell): the measured time goes into the sentence.
  const history = usePieces(outlet.id).data?.pecas ?? [];
  // The Reels neither writes nor draws: it checks the carousel's text and assembles the video.
  const steps = s.formato === "reels" ? STEPS.filter((e) => e === "validar" || e === "renderizar") : STEPS;
  const current = Math.max(0, steps.indexOf(s.etapa ?? steps[0]));
  const home = s.iniciada_em ?? s.created_at;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, []);
  const seg = Math.max(0, Math.round((now - instant(home)) / 1000));
  const time = seg < 60 ? `${seg} s` : `${Math.floor(seg / 60)} min ${String(seg % 60).padStart(2, "0")} s`;
  const currentLabel = stepLabel(steps[current], s.formato);
  const attempt = s.etapa === "redigir" && (s.tentativa ?? 1) > 1 ? tr(` (tentativa ${s.tentativa} de 3)`, ` (attempt ${s.tentativa} of 3)`) : "";

  return (
    <section aria-labelledby="andamento" className="mt-8">
      <h2 id="andamento" className="secao m-0 mb-4">{tr("Produzindo", "In production")} <span className="text-apoio normal-case">{time}</span></h2>
      <p className="sr-only" role="status" aria-live="polite">{tr("Agora", "Now")}: {currentLabel}{attempt}.</p>
      <ol className="m-0 grid list-none gap-1 p-0">
        {steps.map((e, i) => {
          const done = i < current;
          const nowHere = i === current;
          return (
            <li key={e} className={`flex min-h-12 items-center gap-3 border-b border-fio text-[17px] last:border-b-0 ${nowHere ? "font-bold text-texto-forte" : done ? "text-texto" : "text-apoio"}`}>
              <span aria-hidden="true" className="grid size-6 flex-none place-items-center">
                {done ? <IconRight className="size-5 text-texto-forte" /> : <span className={`size-2 rounded-full ${nowHere ? "bg-texto-forte" : "bg-fio-forte"}`} />}
              </span>
              <span className="relative">
                {stepLabel(e, s.formato)}{nowHere ? attempt : ""}
                {/* A graphite stroke (not an action: neutral) that draws again at each step. */}
                {nowHere && <UnderlinePencil key={`${e}-${s.tentativa}`} desenhar seed={i + 3} className="text-texto-forte" />}
              </span>
              <span className="sr-only">{done ? tr(": feito", ": done") : nowHere ? tr(": agora", ": now") : tr(": a seguir", ": next")}</span>
            </li>
          );
        })}
      </ol>
      <p className="mt-6 mb-0 max-w-[56ch] text-apoio">
        {timeProductionSentence(productionTime(history))} {tr("Pode sair desta tela: o post continua sendo feito e aparece nas Ideias, em andamento.", "You can leave this screen: the post keeps being made and shows up in Ideas, in progress.")}
      </p>
      <Link to={useIdeas()} className="link-acao mt-3 inline-block">{tr("Voltar às Ideias", "Back to Ideas")}</Link>
    </section>
  );
}

// ── it did not work and other states ────────────────────────────────────────────────────────────────────────────

function Failed({ s }: { s: PieceStatus }) {
  const ideas = useIdeas();
  const { veiculo: outlet } = useShell();
  const navigate = useNavigate();
  const qc = useQueryClient();
  // The idea goes back to the list when production fails; from here it can be produced again, in the same format.
  // The Reels does not go back to the idea: it is requested again from the carousel.
  const reels = s.formato === "reels";
  const newOf = !reels && outlet.papel !== "reporter" && (s.pauta_status === "aceita" || s.pauta_status === "sugerida");
  // The failure was in publishing (PublicacaoWorkflow recorded the attempt), not in production.
  const onPost = s.publicacao_status === "falhou";
  // When posting, the outcome is uncertain: the next action is to check the profile, not to produce again (it would duplicate the post).
  const profile = onPost ? profileInstagram(accountName({ modo: s.conta_modo ?? "", nome: s.conta_nome, external_id: s.conta_external_id })) : null;
  const produce = useMutation({
    mutationFn: () => read(api.t[":tenantId"].pautas[":id"].produzir.$post({ param: { tenantId: outlet.id, id: s.pauta_id } }, bodyJson({ formato: s.formato }))),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: keys.pautas(outlet.id) });
      qc.invalidateQueries({ queryKey: keys.pecas(outlet.id) });
      navigate(`${ideas}/p/${r.pecaId}`);
    },
  });
  return (
    <section aria-labelledby="falhou" className="mt-8 grid justify-items-start gap-4">
      <div role="alert" className="faixa-erro w-full">
        <h2 id="falhou" className="m-0 text-[17px] text-terracota">{onPost ? tr("Não deu para confirmar a postagem", "Couldn't confirm the post went out") : tr("Não deu certo", "It didn't work")}</h2>
        <p className="m-0 mt-1">
          {/* The failure may come after Instagram accepted (e.g. when fetching the link): the post may have gone out. */}
          {onPost ? tr("A postagem automática parou no meio e o post pode ter saído mesmo assim. Confira no Instagram antes de tentar de novo.", "Automatic posting stopped halfway and the post may have gone out anyway. Check on Instagram before you try again.") : failureReason(s.erro)}
          {newOf ? (onPost ? tr(" Se não saiu, a ideia voltou para a lista e dá para produzir de novo.", " If it didn't go out, the idea is back on the list and you can produce it again.") : tr(" A ideia voltou para a lista e dá para produzir de novo.", " The idea is back on the list and you can produce it again.")) : ""}
          {reels && !onPost ? tr(" Para tentar de novo, abra o carrossel e use Fazer Reels.", " To try again, open the carousel and use Make a Reel.") : ""}
        </p>
      </div>
      {s.erro && (
        <details className="text-apoio">
          <summary className="cursor-pointer text-[14px]">{tr("Detalhe técnico", "Technical detail")}</summary>
          <p className="mono m-0 mt-2 break-words">{s.erro}</p>
        </details>
      )}
      {profile && (
        <a href={profile} target="_blank" rel="noopener noreferrer" className="acao-lapis -ml-[6px]">
          <span>{tr("Conferir no Instagram", "Check on Instagram")}<span className="sr-only">{tr(" (abre em outra aba)", " (opens in a new tab)")}</span></span><BackPencil desenhar />
        </a>
      )}
      {newOf ? (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {profile ? (
            <button type="button" className="link-acao min-h-11" disabled={produce.isPending || produce.isSuccess} onClick={() => produce.mutate()}>
              {produce.isPending ? tr("Começando…", "Starting…") : tr("Não saiu: produzir de novo", "It didn't go out: produce again")}
            </button>
          ) : (
            <button type="button" className="acao-lapis -ml-[6px] cursor-pointer" disabled={produce.isPending || produce.isSuccess} onClick={() => produce.mutate()}>
              <span>{produce.isPending ? tr("Começando…", "Starting…") : tr(`Produzir de novo (${s.formato})`, `Produce again (${formatName(s.formato)})`)}</span><BackPencil desenhar />
            </button>
          )}
          <Link to={ideas} className="link-acao">{tr("Voltar às Ideias", "Back to Ideas")}</Link>
          {produce.error instanceof ApiError && produce.error.status === 402 && <LimitWarning mensagem={produce.error.message} veiculo={outlet} codigo={produce.error.codigo} />}
          {produce.isError && !(produce.error instanceof ApiError && produce.error.status === 402) && (
            <p role="alert" className="m-0 w-full text-[15px] text-terracota">
              {produce.error instanceof ApiError && produce.error.status === 409
                ? tr("Essa ideia já mudou: alguém começou a produzir ou tirou da lista. Confira nas Ideias.", "This idea has already changed: someone started producing it or took it off the list. Check Ideas.")
                : tr("Não deu para começar agora. Tente de novo.", "Couldn't start right now. Try again.")}
            </p>
          )}
        </div>
      ) : profile ? (
        <Link to={ideas} className="link-acao">{tr("Voltar às Ideias", "Back to Ideas")}</Link>
      ) : (
        <Link to={ideas} className="acao-lapis -ml-[6px]"><span>{tr("Voltar às Ideias", "Back to Ideas")}</span><BackPencil desenhar /></Link>
      )}
    </section>
  );
}

const STATUS: Record<string, [string, string]> = {
  get rejeitada(): [string, string] { return [tr("Rejeitado", "Rejected"), tr("A ideia saiu da lista.", "The idea left the list.")]; },
};

/** Rejected (or another state without its own screen): the outcome and the next action. */
function Other({ status }: { status: string }) {
  const ideas = useIdeas();
  const { veiculo: outlet } = useShell();
  const { peca: id = "" } = useParams();
  const next = usePieces(outlet.id).data?.pecas.find((p) => p.status === "revisao" && p.id !== id);
  const [title, text] = STATUS[status] ?? [tr("Fora da produção", "Out of production"), tr("Este post já saiu da produção.", "This post has already left production.")];
  return (
    <section aria-labelledby="situacao" className="mt-8 grid justify-items-start gap-4">
      <div role="status">
        <h2 id="situacao" className="m-0 text-[20px] font-bold text-texto-forte">{title}</h2>
        <p className="m-0 mt-1 text-[17px]">{text}</p>
      </div>
      {next ? (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Link to={`${ideas}/p/${next.id}`} className="acao-lapis -ml-[6px]"><span>{tr("Revisar a próxima", "Review the next one")}</span><BackPencil desenhar /></Link>
          <Link to={ideas} className="link-acao">{tr("Voltar às Ideias", "Back to Ideas")}</Link>
        </div>
      ) : (
        <Link to={ideas} className="acao-lapis -ml-[6px]"><span>{tr("Voltar às Ideias", "Back to Ideas")}</span><BackPencil desenhar /></Link>
      )}
    </section>
  );
}

function Skeleton() {
  return (
    <div aria-busy="true" className="grid gap-3">
      <p role="status" className="sr-only">{tr("Carregando o andamento", "Loading the progress")}</p>
      <div className="esqueleto h-3 w-24" />
      <div className="esqueleto h-9 w-[min(24ch,90%)]" />
      <div className="mt-6 grid gap-3">{[0, 1, 2, 3].map((i) => <div key={i} className="esqueleto h-8 w-[min(40ch,85%)]" />)}</div>
    </div>
  );
}
