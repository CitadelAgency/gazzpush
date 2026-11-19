// Make the Reels (Phase 4, DESIGN.md §5): the animated carousel in 9:16, with or without the owner's voice. The
// carousel's cards in 9:16 (each card's animated entrance runs in the preview only without "reduce motion"), optional
// music from the outlet's library (with the licence in view) and "Make the Reels". The Reels becomes a new post (reels
// format) that goes through the same path: production, To approve, Publish. Editor and up; the carousel must be in
// review or approved and checked.
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router";
import { normalizeCards, type Card } from "../../../src/lib/cards";
import { MOTIONS_REELS, STEPS_REELS, DEFAULT_PACE, REELS_PACE, timesReels, totalReels, type ReelsPace } from "../../../src/lib/reelsHtml";
import { api, bodyJson, ApiError, read, type Success } from "../api";
import { useShell } from "../shell/context";
import { IconBack } from "../shell/icons";
import { FailureLoad, useTitle } from "../common";
import { keys } from "../queue";
import { t as tr } from "../language";
import { PreviewCard } from "../onboarding/CardPreview";
import { htmlCardReels } from "../onboarding/editPreview";
import type { PreviewPiece } from "../onboarding/editPreview";
import { motionName, stepName } from "./Templates";
import NotFound from "./NotFound";
import { Part, usePart } from "../kit/Parts";
import { VoiceReels, type VoiceState } from "./ReelsVoice";

const t = api.t[":tenantId"].pecas[":id"];
type CompletePiece = Success<Awaited<ReturnType<typeof t.$get>>>;

export default function Reels() {
  const { veiculo: outlet } = useShell();
  const { peca: id = "" } = useParams();
  useTitle(tr("Fazer o Reels", "Make a Reel"), outlet.nome);
  const piece = useQuery({
    queryKey: [...keys.peca(outlet.id, id), "reels"],
    queryFn: () => read(t.$get({ param: { tenantId: outlet.id, id } })),
    staleTime: 30 * 60_000,
  });
  return (
    <div className="mx-auto max-w-[1180px] px-5 pt-2 pb-10 lg:px-12 lg:pt-3">
      <div className="mb-2 flex flex-wrap items-center gap-x-5 lg:mb-6">
        <Link to={`/t/${outlet.slug}/p/${id}`} className="-ml-1 inline-flex min-h-11 items-center gap-1 text-texto no-underline hover:underline">
          <IconBack className="size-5" /> {tr("Voltar ao carrossel", "Back to the carousel")}
        </Link>
      </div>
      {piece.isError ? (
        piece.error instanceof ApiError && piece.error.status === 404
          ? <NotFound mensagem={tr("Esse post não existe ou é de outro veículo.", "This post doesn't exist or belongs to another publication.")} />
          : <><h1 className="titulo-tela m-0 text-[28px]">{tr("Fazer o Reels", "Make a Reel")}</h1><FailureLoad oque={tr("o carrossel", "the carousel")} tentar={() => piece.refetch()} /></>
      ) : piece.isPending ? (
        <><h1 className="titulo-tela m-0 text-[28px]">{tr("Fazer o Reels", "Make a Reel")}</h1><div className="esqueleto mt-6 aspect-[9/16] w-[min(60vw,270px)]" /></>
      ) : (
        <Ready id={id} peca={piece.data} />
      )}
    </div>
  );
}

function Ready({ id, peca: piece }: { id: string; peca: CompletePiece }) {
  const { veiculo: outlet } = useShell();
  const navigate = useNavigate();
  const preview = piece.previa as (PreviewPiece & { conviteGenerico?: unknown }) | null;
  const cards = useMemo(() => normalizeCards((piece.peca.conteudo as { cards?: Card[] }).cards), [piece]);
  const validation = piece.peca.validacao as { ok: boolean } | null;
  const status = (piece.peca as Record<string, unknown>).status as string;
  const format = (piece.peca as Record<string, unknown>).formato as string;
  const tracks = useQuery({
    queryKey: [outlet.id, "musicas"],
    queryFn: () => read(api.t[":tenantId"].musicas.$get({ param: { tenantId: outlet.id } })),
    staleTime: 10 * 60_000,
  });
  const [music, setMusic] = useState<string | null>(null);
  const [withVoice, setWithVoice] = useState(false);
  const [voice, setVoice] = useState<VoiceState | null>(null);
  const [adjustment, openAdjustment] = usePart("ajuste", tracks.isError ? "musica" : "voz");
  const toggle = (id: string) => openAdjustment(adjustment === id ? null : id);
  // The carousel's template fills it in; here it applies to this Reels.
  const [pace, setPace] = useState<ReelsPace>(() => (piece.peca.conteudo as { estilo?: { params?: { reels?: ReelsPace } } }).estilo?.params?.reels ?? DEFAULT_PACE);
  const make = useMutation({
    mutationFn: () => read(t.reels.$post({ param: { tenantId: outlet.id, id } }, bodyJson({ musica: music, ...pace, ...(withVoice && voice ? { narracao: voice.id } : {}), versao: (piece.peca as Record<string, unknown>).versao as number }))),
    onSuccess: (r) => navigate(`/t/${outlet.slug}/p/${r.pecaId}`),
  });

  const times = useMemo(() => timesReels(cards, pace.passo), [cards, pace.passo]);
  // With voice, the length is the speech's, plus the CTA after it.
  const seconds = Math.round((withVoice && voice?.duracao ? voice.duracao + REELS_PACE.convite : totalReels(times)) * 10) / 10;
  const reason = outlet.papel === "reporter" ? tr("Fazer o Reels é de quem edita o veículo.", "Making a Reel is up to the publication's editors.")
    : format !== "carrossel" ? tr("O Reels sai de um carrossel.", "A Reel is made from a carousel.")
    : status !== "revisao" && status !== "aprovada" ? tr("O Reels sai de um carrossel em revisão ou aprovado.", "A Reel is made from a carousel that is in review or approved.")
    : withVoice && !voice ? tr("Grave a voz ou envie o arquivo: o vídeo sai com ela.", "Record your voice or upload the file: the video goes out with it.")
    : withVoice && !voice?.pronta ? tr("Decida cada aviso da fala antes de fazer o Reels.", "Decide each speech warning before making the Reel.")
    : validation?.ok === false ? tr("A conferência apontou problema num card do carrossel; corrija antes de fazer o Reels.", "The check flagged a problem on a carousel card; fix it before making the Reel.")
    : null;

  const missingVoice = withVoice && !voice?.pronta;
  const summaryVoice = !withVoice ? tr("sem narração", "no narration")
    : !voice ? tr("com a sua voz · falta gravar", "with your voice · not recorded yet")
    : !voice.pronta ? tr("com a sua voz · decida os avisos", "with your voice · decide the warnings")
    : tr("com a sua voz · conferida", "with your voice · checked");
  const band = tracks.data?.musicas.find((m) => m.id === music);
  return (
    <section aria-labelledby="rl-titulo">
      <div className="mb-5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 id="rl-titulo" className="titulo-tela m-0 text-[28px] leading-[1.1] lg:text-[36px]">{tr("Fazer o Reels", "Make a Reel")}</h1>
        <p className="mono m-0 text-apoio">{cards.length} cards · {tr(String(seconds).replace(".", ","), String(seconds))} s · 9:16 · {withVoice ? tr("com a sua voz", "with your voice") : tr("sem narração", "no narration")}</p>
      </div>
      {/* On mobile the settings column dissolves: the button's pinned bar needs the container that starts at the top. */}
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-12">
        <div className="min-w-0">
          <p className="m-0 mb-3 max-w-[60ch]">{pace.movimento === "manchete"
            ? tr("Os mesmos cards do carrossel, em pé: cada um fica o tempo de ler, o título entra primeiro e as frases vêm uma a uma. A legenda é a do carrossel.", "The same cards as the carousel, upright: each stays long enough to read, the headline comes first and the sentences follow one at a time. The caption is the carousel's.")
            : pace.movimento === "folha"
              ? tr("Os mesmos cards do carrossel, em pé: cada um fica o tempo de ler e o seguinte entra deslizando por cima. A legenda é a do carrossel.", "The same cards as the carousel, upright: each stays long enough to read and the next slides in over it. The caption is the carousel's.")
              : tr("Os mesmos cards do carrossel, em pé: cada um fica o tempo de ler, com corte direto entre eles. A legenda é a do carrossel.", "The same cards as the carousel, upright: each stays long enough to read, with a straight cut between them. The caption is the carousel's.")}</p>
          {preview ? (
            <ol aria-label={tr("Cards do Reels, na ordem", "Reel cards, in order")} tabIndex={0}
              className="-mx-5 m-0 flex list-none snap-x snap-mandatory scroll-px-5 gap-3 overflow-x-auto px-5 pt-1 pb-3 [scrollbar-width:none] lg:mx-0 lg:px-0 [&::-webkit-scrollbar]:hidden">
              {cards.map((c, i) => (
                <li key={c.id} className="w-[min(52vw,220px)] flex-none snap-start">
                  <PreviewCard html={htmlCardReels(preview, c, i === 0, times[i], pace.movimento)} titulo={tr(`Card ${i + 1} do Reels`, `Reel card ${i + 1}`)} alto />
                  <p className="mono m-0 mt-1 text-apoio">{i + 1} · {c.titulo || tr("Sem título", "Untitled")}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="faixa-aviso m-0">{tr("A prévia em pé só aparece com o carrossel em revisão ou aprovado.", "The upright preview only shows when the carousel is in review or approved.")}</p>
          )}
        </div>

        <div className="min-w-0 max-lg:contents lg:grid lg:content-start lg:gap-2">
          <div className="mt-4 min-w-0 lg:mt-0">
          <Part id="rl-voz" nivel="h2" rotulo={tr("Voz", "Voice")} resumo={summaryVoice} tom={missingVoice ? "aviso" : undefined} aberta={adjustment === "voz"} alternar={() => toggle("voz")}>
          <fieldset className="m-0 grid min-w-0 gap-1 border-0 p-0" disabled={make.isPending}>
            <legend className="sr-only">{tr("Voz", "Voice")}</legend>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-btn px-2 hover:bg-papel-2">
              <input type="radio" name="rl-voz" checked={!withVoice} onChange={() => setWithVoice(false)} className="size-[18px] accent-[var(--color-tinta)]" />
              <span>{tr("Sem narração", "No narration")}</span>
            </label>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-btn px-2 hover:bg-papel-2">
              <input type="radio" name="rl-voz" checked={withVoice} onChange={() => setWithVoice(true)} className="size-[18px] accent-[var(--color-tinta)]" />
              <span>{tr("Com a sua voz", "With your voice")}</span>
            </label>
            {withVoice && <VoiceReels tenantId={outlet.id} pecaId={id} cards={cards} mudou={setVoice} />}
          </fieldset>
          </Part>

          {!withVoice && <Part id="rl-ritmo" nivel="h2" rotulo={tr("Ritmo", "Pace")} resumo={stepName(pace.passo)[0]} aberta={adjustment === "ritmo"} alternar={() => toggle("ritmo")}>
          <fieldset className="m-0 grid min-w-0 gap-1 border-0 p-0" disabled={make.isPending}>
            <legend className="sr-only">{tr("Ritmo", "Pace")}</legend>
            {STEPS_REELS.map((p) => (
              <label key={p} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-btn px-2 hover:bg-papel-2">
                <input type="radio" name="rl-passo" checked={pace.passo === p} onChange={() => setPace({ ...pace, passo: p })} className="size-[18px] accent-[var(--color-tinta)]" />
                <span><b className="text-texto-forte">{stepName(p)[0]}</b> <span className="text-apoio">· {stepName(p)[1]}</span></span>
              </label>
            ))}
          </fieldset>
          </Part>}

          <Part id="rl-movimento" nivel="h2" rotulo={tr("Movimento", "Motion")} resumo={motionName(pace.movimento)[0]} aberta={adjustment === "movimento"} alternar={() => toggle("movimento")}>
          <fieldset className="m-0 grid min-w-0 gap-1 border-0 p-0" disabled={make.isPending}>
            <legend className="sr-only">{tr("Movimento", "Motion")}</legend>
            {MOTIONS_REELS.map((m) => (
              <label key={m} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-btn px-2 hover:bg-papel-2">
                <input type="radio" name="rl-movimento" checked={pace.movimento === m} onChange={() => setPace({ ...pace, movimento: m })} className="size-[18px] accent-[var(--color-tinta)]" />
                <span><b className="text-texto-forte">{motionName(m)[0]}</b> <span className="text-apoio">· {motionName(m)[1]}</span></span>
              </label>
            ))}
          </fieldset>
          </Part>

          <Part id="rl-musica" nivel="h2" rotulo={tr("Música", "Music")} resumo={tracks.isError ? tr("não carregou", "didn't load") : band?.titulo ?? tr("sem música", "no music")}
            tom={tracks.isError ? "erro" : undefined} aberta={adjustment === "musica"} alternar={() => toggle("musica")}>
          <fieldset className="m-0 grid min-w-0 gap-1 border-0 p-0" disabled={make.isPending}>
            <legend className="sr-only">{tr("Música", "Music")}</legend>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-btn px-2 hover:bg-papel-2">
              <input type="radio" name="rl-musica" checked={music === null} onChange={() => setMusic(null)} className="size-[18px] accent-[var(--color-tinta)]" />
              <span>{tr("Sem música", "No music")}</span>
            </label>
            {tracks.data?.musicas.map((m) => (
              <div key={m.id} className="flex min-h-11 flex-wrap items-center gap-x-3 rounded-btn px-2 hover:bg-papel-2">
                <label className="flex min-h-11 flex-1 cursor-pointer items-center gap-3">
                  <input type="radio" name="rl-musica" checked={music === m.id} onChange={() => setMusic(m.id)} className="size-[18px] accent-[var(--color-tinta)]" />
                  <span><b className="text-texto-forte">{m.titulo}</b> <span className="text-apoio">· {m.autor}</span></span>
                </label>
                <a href={m.licencaUrl} target="_blank" rel="noreferrer" className="mono text-apoio underline underline-offset-3">{m.licenca}</a>
              </div>
            ))}
            {tracks.isError && <FailureLoad oque={tr("a biblioteca de música", "the music library")} tentar={() => tracks.refetch()} />}
            <p className="ajuda m-0 mt-1">
              {tracks.data && !tracks.data.musicas.length
                ? tr("A biblioteca de música do veículo está vazia: o Reels sai sem música.", "The publication's music library is empty: the Reel goes out without music.")
                : tr("Só entra faixa com licença para uso comercial em rede social; o link mostra a licença.", "Only tracks licensed for commercial use on social media are included; the link shows the license.")}
            </p>
          </fieldset>
          </Part>
          </div>

          <div className="sticky bottom-[calc(66px+env(safe-area-inset-bottom))] z-10 -mx-5 grid gap-2 border-t border-fio-forte bg-papel px-5 py-3 lg:bottom-[var(--pe)] lg:mx-0 lg:px-0 lg:pt-4">
            {reason && <p role="note" className="faixa-aviso m-0">{reason}</p>}
            {make.isError && <p role="alert" className="m-0 text-[15px] text-terracota">{(make.error as Error).message}</p>}
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => make.mutate()} disabled={!!reason || make.isPending} className="btn-tinta min-w-[180px]">
                {make.isPending ? tr("Mandando fazer…", "Sending it off…") : tr("Fazer o Reels", "Make a Reel")}
              </button>
              <p className="ajuda m-0" role="status">
                {make.isPending ? tr("Abrindo o post do Reels.", "Opening the Reel's post.") : tr("Leva de 1 a 2 minutos. O Reels vira um post novo e passa por Para aprovar, como os outros.", "It takes 1 to 2 minutes. The Reel becomes a new post and goes through To approve, like the others.")}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
