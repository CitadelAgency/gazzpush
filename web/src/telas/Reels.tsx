// Fazer o Reels (Fase 4, DESIGN.md §5): o carrossel animado em 9:16, com ou sem a voz do dono. Os cards do carrossel em 9:16 (a
// entrada animada de cada card roda na prévia só sem "reduzir movimento"), a música opcional da biblioteca do veículo
// (com a licença à vista) e "Fazer o Reels". O Reels vira um post novo (formato reels) que passa pelo mesmo caminho:
// produção, Para aprovar, Publicar. Editor para cima; o carrossel precisa estar em revisão ou aprovado e conferido.
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router";
import { normalizarCards, type Card } from "../../../src/lib/cards";
import { MOVIMENTOS_REELS, PASSOS_REELS, RITMO_PADRAO, RITMO_REELS, temposReels, totalReels, type RitmoReels } from "../../../src/lib/reelsHtml";
import { api, corpoJson, ErroApi, ler, type Sucesso } from "../api";
import { useCasca } from "../casca/contexto";
import { IconeVoltar } from "../casca/icones";
import { FalhaCarga, useTitulo } from "../comum";
import { chaves } from "../fila";
import { t as tr } from "../idioma";
import { PreviaCard } from "../novo/PreviaCard";
import { htmlCardReels } from "../novo/previaEdicao";
import type { PreviaPeca } from "../novo/previaEdicao";
import { nomeMovimento, nomePasso } from "./Modelos";
import NaoEncontrada from "./NaoEncontrada";
import { Parte, useParte } from "../kit/Partes";
import { VozReels, type EstadoVoz } from "./VozReels";

const t = api.t[":tenantId"].pecas[":id"];
type PecaCompleta = Sucesso<Awaited<ReturnType<typeof t.$get>>>;

export default function Reels() {
  const { veiculo } = useCasca();
  const { peca: id = "" } = useParams();
  useTitulo(tr("Fazer o Reels", "Make a Reel"), veiculo.nome);
  const peca = useQuery({
    queryKey: [...chaves.peca(veiculo.id, id), "reels"],
    queryFn: () => ler(t.$get({ param: { tenantId: veiculo.id, id } })),
    staleTime: 30 * 60_000,
  });
  return (
    <div className="mx-auto max-w-[1180px] px-5 pt-2 pb-10 lg:px-12 lg:pt-3">
      <div className="mb-2 flex flex-wrap items-center gap-x-5 lg:mb-6">
        <Link to={`/t/${veiculo.slug}/p/${id}`} className="-ml-1 inline-flex min-h-11 items-center gap-1 text-texto no-underline hover:underline">
          <IconeVoltar className="size-5" /> {tr("Voltar ao carrossel", "Back to the carousel")}
        </Link>
      </div>
      {peca.isError ? (
        peca.error instanceof ErroApi && peca.error.status === 404
          ? <NaoEncontrada mensagem={tr("Esse post não existe ou é de outro veículo.", "This post doesn't exist or belongs to another publication.")} />
          : <><h1 className="titulo-tela m-0 text-[28px]">{tr("Fazer o Reels", "Make a Reel")}</h1><FalhaCarga oque={tr("o carrossel", "the carousel")} tentar={() => peca.refetch()} /></>
      ) : peca.isPending ? (
        <><h1 className="titulo-tela m-0 text-[28px]">{tr("Fazer o Reels", "Make a Reel")}</h1><div className="esqueleto mt-6 aspect-[9/16] w-[min(60vw,270px)]" /></>
      ) : (
        <Pronto id={id} peca={peca.data} />
      )}
    </div>
  );
}

function Pronto({ id, peca }: { id: string; peca: PecaCompleta }) {
  const { veiculo } = useCasca();
  const navigate = useNavigate();
  const previa = peca.previa as (PreviaPeca & { conviteGenerico?: unknown }) | null;
  const cards = useMemo(() => normalizarCards((peca.peca.conteudo as { cards?: Card[] }).cards), [peca]);
  const validacao = peca.peca.validacao as { ok: boolean } | null;
  const status = (peca.peca as Record<string, unknown>).status as string;
  const formato = (peca.peca as Record<string, unknown>).formato as string;
  const musicas = useQuery({
    queryKey: [veiculo.id, "musicas"],
    queryFn: () => ler(api.t[":tenantId"].musicas.$get({ param: { tenantId: veiculo.id } })),
    staleTime: 10 * 60_000,
  });
  const [musica, setMusica] = useState<string | null>(null);
  const [comVoz, setComVoz] = useState(false);
  const [voz, setVoz] = useState<EstadoVoz | null>(null);
  const [ajuste, abrirAjuste] = useParte("ajuste", musicas.isError ? "musica" : "voz");
  const alternar = (id: string) => abrirAjuste(ajuste === id ? null : id);
  // O modelo do carrossel preenche; aqui vale para este Reels.
  const [ritmo, setRitmo] = useState<RitmoReels>(() => (peca.peca.conteudo as { estilo?: { params?: { reels?: RitmoReels } } }).estilo?.params?.reels ?? RITMO_PADRAO);
  const fazer = useMutation({
    mutationFn: () => ler(t.reels.$post({ param: { tenantId: veiculo.id, id } }, corpoJson({ musica, ...ritmo, ...(comVoz && voz ? { narracao: voz.id } : {}), versao: (peca.peca as Record<string, unknown>).versao as number }))),
    onSuccess: (r) => navigate(`/t/${veiculo.slug}/p/${r.pecaId}`),
  });

  const tempos = useMemo(() => temposReels(cards, ritmo.passo), [cards, ritmo.passo]);
  // Com voz, o tempo é o da fala, mais o convite depois dela.
  const segundos = Math.round((comVoz && voz?.duracao ? voz.duracao + RITMO_REELS.convite : totalReels(tempos)) * 10) / 10;
  const motivo = veiculo.papel === "reporter" ? tr("Fazer o Reels é de quem edita o veículo.", "Making a Reel is up to the publication's editors.")
    : formato !== "carrossel" ? tr("O Reels sai de um carrossel.", "A Reel is made from a carousel.")
    : status !== "revisao" && status !== "aprovada" ? tr("O Reels sai de um carrossel em revisão ou aprovado.", "A Reel is made from a carousel that is in review or approved.")
    : comVoz && !voz ? tr("Grave a voz ou envie o arquivo: o vídeo sai com ela.", "Record your voice or upload the file: the video goes out with it.")
    : comVoz && !voz?.pronta ? tr("Decida cada aviso da fala antes de fazer o Reels.", "Decide each speech warning before making the Reel.")
    : validacao?.ok === false ? tr("A conferência apontou problema num card do carrossel; corrija antes de fazer o Reels.", "The check flagged a problem on a carousel card; fix it before making the Reel.")
    : null;

  const faltaVoz = comVoz && !voz?.pronta;
  const resumoVoz = !comVoz ? tr("sem narração", "no narration")
    : !voz ? tr("com a sua voz · falta gravar", "with your voice · not recorded yet")
    : !voz.pronta ? tr("com a sua voz · decida os avisos", "with your voice · decide the warnings")
    : tr("com a sua voz · conferida", "with your voice · checked");
  const faixa = musicas.data?.musicas.find((m) => m.id === musica);
  return (
    <section aria-labelledby="rl-titulo">
      <div className="mb-5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 id="rl-titulo" className="titulo-tela m-0 text-[28px] leading-[1.1] lg:text-[36px]">{tr("Fazer o Reels", "Make a Reel")}</h1>
        <p className="mono m-0 text-apoio">{cards.length} cards · {tr(String(segundos).replace(".", ","), String(segundos))} s · 9:16 · {comVoz ? tr("com a sua voz", "with your voice") : tr("sem narração", "no narration")}</p>
      </div>
      {/* No celular a coluna de ajustes se desfaz: a barra presa do botão precisa do contêiner que começa no topo. */}
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-12">
        <div className="min-w-0">
          <p className="m-0 mb-3 max-w-[60ch]">{ritmo.movimento === "manchete"
            ? tr("Os mesmos cards do carrossel, em pé: cada um fica o tempo de ler, o título entra primeiro e as frases vêm uma a uma. A legenda é a do carrossel.", "The same cards as the carousel, upright: each stays long enough to read, the headline comes first and the sentences follow one at a time. The caption is the carousel's.")
            : ritmo.movimento === "folha"
              ? tr("Os mesmos cards do carrossel, em pé: cada um fica o tempo de ler e o seguinte entra deslizando por cima. A legenda é a do carrossel.", "The same cards as the carousel, upright: each stays long enough to read and the next slides in over it. The caption is the carousel's.")
              : tr("Os mesmos cards do carrossel, em pé: cada um fica o tempo de ler, com corte direto entre eles. A legenda é a do carrossel.", "The same cards as the carousel, upright: each stays long enough to read, with a straight cut between them. The caption is the carousel's.")}</p>
          {previa ? (
            <ol aria-label={tr("Cards do Reels, na ordem", "Reel cards, in order")} tabIndex={0}
              className="-mx-5 m-0 flex list-none snap-x snap-mandatory scroll-px-5 gap-3 overflow-x-auto px-5 pt-1 pb-3 [scrollbar-width:none] lg:mx-0 lg:px-0 [&::-webkit-scrollbar]:hidden">
              {cards.map((c, i) => (
                <li key={c.id} className="w-[min(52vw,220px)] flex-none snap-start">
                  <PreviaCard html={htmlCardReels(previa, c, i === 0, tempos[i], ritmo.movimento)} titulo={tr(`Card ${i + 1} do Reels`, `Reel card ${i + 1}`)} alto />
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
          <Parte id="rl-voz" nivel="h2" rotulo={tr("Voz", "Voice")} resumo={resumoVoz} tom={faltaVoz ? "aviso" : undefined} aberta={ajuste === "voz"} alternar={() => alternar("voz")}>
          <fieldset className="m-0 grid min-w-0 gap-1 border-0 p-0" disabled={fazer.isPending}>
            <legend className="sr-only">{tr("Voz", "Voice")}</legend>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-btn px-2 hover:bg-papel-2">
              <input type="radio" name="rl-voz" checked={!comVoz} onChange={() => setComVoz(false)} className="size-[18px] accent-[var(--color-tinta)]" />
              <span>{tr("Sem narração", "No narration")}</span>
            </label>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-btn px-2 hover:bg-papel-2">
              <input type="radio" name="rl-voz" checked={comVoz} onChange={() => setComVoz(true)} className="size-[18px] accent-[var(--color-tinta)]" />
              <span>{tr("Com a sua voz", "With your voice")}</span>
            </label>
            {comVoz && <VozReels tenantId={veiculo.id} pecaId={id} cards={cards} mudou={setVoz} />}
          </fieldset>
          </Parte>

          {!comVoz && <Parte id="rl-ritmo" nivel="h2" rotulo={tr("Ritmo", "Pace")} resumo={nomePasso(ritmo.passo)[0]} aberta={ajuste === "ritmo"} alternar={() => alternar("ritmo")}>
          <fieldset className="m-0 grid min-w-0 gap-1 border-0 p-0" disabled={fazer.isPending}>
            <legend className="sr-only">{tr("Ritmo", "Pace")}</legend>
            {PASSOS_REELS.map((p) => (
              <label key={p} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-btn px-2 hover:bg-papel-2">
                <input type="radio" name="rl-passo" checked={ritmo.passo === p} onChange={() => setRitmo({ ...ritmo, passo: p })} className="size-[18px] accent-[var(--color-tinta)]" />
                <span><b className="text-texto-forte">{nomePasso(p)[0]}</b> <span className="text-apoio">· {nomePasso(p)[1]}</span></span>
              </label>
            ))}
          </fieldset>
          </Parte>}

          <Parte id="rl-movimento" nivel="h2" rotulo={tr("Movimento", "Motion")} resumo={nomeMovimento(ritmo.movimento)[0]} aberta={ajuste === "movimento"} alternar={() => alternar("movimento")}>
          <fieldset className="m-0 grid min-w-0 gap-1 border-0 p-0" disabled={fazer.isPending}>
            <legend className="sr-only">{tr("Movimento", "Motion")}</legend>
            {MOVIMENTOS_REELS.map((m) => (
              <label key={m} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-btn px-2 hover:bg-papel-2">
                <input type="radio" name="rl-movimento" checked={ritmo.movimento === m} onChange={() => setRitmo({ ...ritmo, movimento: m })} className="size-[18px] accent-[var(--color-tinta)]" />
                <span><b className="text-texto-forte">{nomeMovimento(m)[0]}</b> <span className="text-apoio">· {nomeMovimento(m)[1]}</span></span>
              </label>
            ))}
          </fieldset>
          </Parte>

          <Parte id="rl-musica" nivel="h2" rotulo={tr("Música", "Music")} resumo={musicas.isError ? tr("não carregou", "didn't load") : faixa?.titulo ?? tr("sem música", "no music")}
            tom={musicas.isError ? "erro" : undefined} aberta={ajuste === "musica"} alternar={() => alternar("musica")}>
          <fieldset className="m-0 grid min-w-0 gap-1 border-0 p-0" disabled={fazer.isPending}>
            <legend className="sr-only">{tr("Música", "Music")}</legend>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-btn px-2 hover:bg-papel-2">
              <input type="radio" name="rl-musica" checked={musica === null} onChange={() => setMusica(null)} className="size-[18px] accent-[var(--color-tinta)]" />
              <span>{tr("Sem música", "No music")}</span>
            </label>
            {musicas.data?.musicas.map((m) => (
              <div key={m.id} className="flex min-h-11 flex-wrap items-center gap-x-3 rounded-btn px-2 hover:bg-papel-2">
                <label className="flex min-h-11 flex-1 cursor-pointer items-center gap-3">
                  <input type="radio" name="rl-musica" checked={musica === m.id} onChange={() => setMusica(m.id)} className="size-[18px] accent-[var(--color-tinta)]" />
                  <span><b className="text-texto-forte">{m.titulo}</b> <span className="text-apoio">· {m.autor}</span></span>
                </label>
                <a href={m.licencaUrl} target="_blank" rel="noreferrer" className="mono text-apoio underline underline-offset-3">{m.licenca}</a>
              </div>
            ))}
            {musicas.isError && <FalhaCarga oque={tr("a biblioteca de música", "the music library")} tentar={() => musicas.refetch()} />}
            <p className="ajuda m-0 mt-1">
              {musicas.data && !musicas.data.musicas.length
                ? tr("A biblioteca de música do veículo está vazia: o Reels sai sem música.", "The publication's music library is empty: the Reel goes out without music.")
                : tr("Só entra faixa com licença para uso comercial em rede social; o link mostra a licença.", "Only tracks licensed for commercial use on social media are included; the link shows the license.")}
            </p>
          </fieldset>
          </Parte>
          </div>

          <div className="sticky bottom-[calc(66px+env(safe-area-inset-bottom))] z-10 -mx-5 grid gap-2 border-t border-fio-forte bg-papel px-5 py-3 lg:bottom-[var(--pe)] lg:mx-0 lg:px-0 lg:pt-4">
            {motivo && <p role="note" className="faixa-aviso m-0">{motivo}</p>}
            {fazer.isError && <p role="alert" className="m-0 text-[15px] text-terracota">{(fazer.error as Error).message}</p>}
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => fazer.mutate()} disabled={!!motivo || fazer.isPending} className="btn-tinta min-w-[180px]">
                {fazer.isPending ? tr("Mandando fazer…", "Sending it off…") : tr("Fazer o Reels", "Make a Reel")}
              </button>
              <p className="ajuda m-0" role="status">
                {fazer.isPending ? tr("Abrindo o post do Reels.", "Opening the Reel's post.") : tr("Leva de 1 a 2 minutos. O Reels vira um post novo e passa por Para aprovar, como os outros.", "It takes 1 to 2 minutes. The Reel becomes a new post and goes through To approve, like the others.")}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
