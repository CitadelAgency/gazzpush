// Peça: o andamento da produção (escrever → conferir com as fontes → ilustrar → montar), acompanhado a cada 2 s pelo
// status leve (só D1). Termina na revisão (./Revisao: aprovar, reescrever, rejeitar) ou em "não deu certo" com o
// motivo. Aprovado ou postado, a tela de publicar (./Publicar); rejeitado, o resultado e o próximo para aprovar.
// O caminho de volta de cada estado fica no fólio da casca (NoFolio), não mais dentro da página.
import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { api, corpoJson, ErroApi, ler } from "../api";
import { AvisoLimite } from "./AvisoLimite";
import { useCasca } from "../casca/contexto";
import { NoFolio } from "../casca/Folio";
import { IconeCerto, IconeVoltar } from "../casca/icones";
import { FalhaCarga, useTitulo } from "../comum";
import { t as tr } from "../idioma";
import { ETAPAS, chaves, fraseTempoProducao, instante, motivoFalha, nomeConta, perfilInstagram, postaSozinho, rotuloEtapa, tempoProducao, usePecas, useProntos, type StatusPeca } from "../fila";
import { SublinhadoLapis, VoltaLapis } from "../kit/Lapis";
import NaoEncontrada from "./NaoEncontrada";
import Publicar from "./Publicar";
import Revisao from "./Revisao";

const t = api.t[":tenantId"].pecas[":id"];

/** Um componente por post: indo de um post a outro ("Revisar a próxima"), o estado (versão vista etc.) recomeça. */
export default function Peca() {
  const { peca: id = "" } = useParams();
  return <Post key={id} id={id} />;
}

function Post({ id }: { id: string }) {
  const { veiculo, marcarPeca } = useCasca();
  const status = useQuery({
    queryKey: chaves.status(veiculo.id, id),
    queryFn: () => ler(t.status.$get({ param: { tenantId: veiculo.id, id } })),
    // 2 s enquanto produz; 20 s em revisão (outra pessoa pode decidir); aprovado: 3 s postando sozinho agora, 60 s
    // com horário marcado, 30 s se alguém posta à mão (outra pessoa pode confirmar); parado em estado final. Falha de
    // rede não para o acompanhamento.
    refetchInterval: (q) => intervalo(q.state.data),
    refetchIntervalInBackground: false,
  });
  const s = status.data;
  // Enquanto o status não chega, a seção da lateral já vale a da lista de onde a pessoa veio (a lista sabe o status do
  // post): a marca de margem não passa por Ideias a caminho de Para aprovar ou de Prontos para postar. Chegou o status,
  // a tela do estado (Revisão, Publicar) assume a marca.
  const nasPecas = usePecas(veiculo.id).data?.pecas.find((p) => p.id === id)?.status;
  const nosProntos = useProntos(veiculo.id).data?.pecas.find((p) => p.id === id)?.status;
  const naLista = nasPecas ?? nosProntos;
  const modoDaLista = s ? null : naLista === "revisao" ? "revisao" : naLista === "aprovada" || naLista === "agendada" ? "postar" : null;
  useLayoutEffect(() => {
    if (!modoDaLista) return;
    marcarPeca(modoDaLista);
    return () => marcarPeca(null);
  }, [modoDaLista, marcarPeca]);
  const editando = useSearchParams()[0].get("editar") === "1";
  // A versão de quando o post foi aberto em revisão: se outra chega (reescrita terminou, outra pessoa editou), a revisão
  // avisa. A que a própria pessoa salvou na edição dos cards passa a ser a vista (`aceitarVersao`), sem aviso.
  const [versaoVista, setVersaoVista] = useState<number>();
  const [rodadaVista, setRodadaVista] = useState<number>();
  useEffect(() => {
    if (s?.status === "revisao" && versaoVista === undefined) { setVersaoVista(s.versao); setRodadaVista(s.rodada); }
  }, [s, versaoVista]);
  // O acompanhamento viu o post sair (postou sozinho, ou outra pessoa confirmou): Postados e Prontos ficam velhos.
  const qc = useQueryClient();
  const publicada = s?.status === "publicada";
  useEffect(() => {
    if (!publicada) return;
    qc.invalidateQueries({ queryKey: chaves.publicacoes(veiculo.id) });
    qc.invalidateQueries({ queryKey: chaves.prontos(veiculo.id) });
  }, [publicada, qc, veiculo.id]);
  useTitulo(s ? TITULO[s.status] ?? "Post" : "Post", veiculo.nome);

  if (status.isError && !s) {
    if (status.error instanceof ErroApi && status.error.status === 404) {
      return <NaoEncontrada mensagem={tr("Esse post não existe ou é de outro veículo.", "This post doesn't exist or belongs to another publication.")} />;
    }
    return <Moldura lista={modoDaLista}><h1 className="sr-only">Post</h1><FalhaCarga oque={tr("o andamento", "the progress")} tentar={() => status.refetch()} /></Moldura>;
  }
  if (!s) return <Moldura lista={modoDaLista}><h1 className="sr-only">Post</h1><Esqueleto /></Moldura>;
  if (s.status === "revisao") {
    const mudou = versaoVista !== undefined && versaoVista !== s.versao;
    // Editando os cards, a tela fica na versão aberta: a versão nova de outra pessoa vira aviso no editor (e 409 ao
    // salvar), sem apagar o que esta pessoa digitou. Fora da edição, a tela troca de versão e avisa (`novaVersao`).
    const naTela = editando && mudou ? { ...s, versao: versaoVista, rodada: rodadaVista ?? s.rodada } : s;
    return <Revisao key={naTela.versao} s={naTela} versaoAtual={s.versao} novaVersao={mudou ? (rodadaVista !== s.rodada ? "reescrita" : "edicao") : null} aceitarVersao={setVersaoVista} />;
  }
  if (PUBLICAR.includes(s.status)) return <Publicar s={s} deRevisao={versaoVista !== undefined} />;

  const versao = [nomeFormato(s.formato), s.rodada > 1 ? tr(`nova versão (${s.rodada} de 3)`, `new version (${s.rodada} of 3)`) : null].filter(Boolean).join(" · ");
  return (
    <Moldura decidida={DECIDIDA.includes(s.status)} titulo={s.manchete ?? s.titulo} versao={versao}>
      {/* No computador o formato e a versão estão no fólio; no celular o fólio só tem lugar para o caminho de volta. */}
      <p className="mono m-0 mb-2 text-apoio lg:hidden">{versao}</p>
      <h1 className="titulo-tela m-0 max-w-[24ch] text-[28px] leading-[1.1] lg:text-[34px]">{s.manchete ?? s.titulo}</h1>
      {status.isError && (
        <p role="status" className="faixa-aviso mt-5 mb-0">{tr("Não carregou o andamento agora; tentando de novo.", "Couldn't load the progress just now; trying again.")}</p>
      )}
      {s.status === "rascunho" ? <Andamento s={s} /> : s.status === "falhou" ? <Falhou s={s} /> : <Outro status={s.status} />}
    </Moldura>
  );
}

const TITULO: Record<string, string> = {
  get rascunho() { return tr("Produzindo", "In production"); }, get revisao() { return tr("Para aprovar", "To approve"); },
  get aprovada() { return tr("Para postar", "Ready to post"); }, get agendada() { return tr("Para postar", "Ready to post"); },
  get publicada() { return tr("Postado", "Posted"); },
};
/** O formato do post na tela (o valor da API fica igual). */
const nomeFormato = (f: string) => tr(f, f === "carrossel" ? "carousel" : f === "reels" ? "Reel" : f);
const PUBLICAR = ["aprovada", "agendada", "publicada"];

function intervalo(s: StatusPeca | undefined): number | false {
  if (!s || s.status === "rascunho") return 2_000;
  if (s.status === "revisao") return 20_000;
  if (s.status === "aprovada" || s.status === "agendada") {
    if (!postaSozinho(s.conta_modo)) return 30_000;
    return s.status === "aprovada" ? 3_000 : 60_000;
  }
  return false;
}

const useIdeias = () => `/t/${useCasca().veiculo.slug}`;

/** Rejeitado na revisão: o post pertence a Para aprovar, de onde a pessoa veio. */
const DECIDIDA = ["rejeitada"];

/**
 * A tela de um post fora da revisão e do publicar. O caminho de volta fica no fólio da casca (DESIGN.md §12): a lista de
 * onde o post veio (Para aprovar para o rejeitado; a lista que já o conhece, enquanto o status não chega; senão, Ideias),
 * e, quando se sabe, a manchete, o formato e a versão.
 */
function Moldura({ children, decidida = false, lista = null, titulo, versao }: {
  children: ReactNode; decidida?: boolean; lista?: "revisao" | "postar" | null; titulo?: string; versao?: string;
}) {
  const ideias = useIdeias();
  const { marcarPeca } = useCasca();
  useLayoutEffect(() => {
    if (!decidida) return;
    marcarPeca("decidida");
    return () => marcarPeca(null);
  }, [decidida, marcarPeca]);
  const volta = decidida || lista === "revisao" ? { para: `${ideias}/aprovar`, rotulo: tr("Para aprovar", "To approve") }
    : lista === "postar" ? { para: `${ideias}/postar`, rotulo: tr("Prontos para postar", "Ready to post") }
    : { para: ideias, rotulo: tr("Ideias", "Ideas") };
  return (
    <div className="mx-auto max-w-[880px] px-5 pt-5 pb-12 lg:px-12 lg:pt-3">
      <NoFolio>
        <Link to={volta.para} viewTransition className="max-lg:min-h-10"><IconeVoltar className="size-4" /> {volta.rotulo}</Link>
        {titulo && <><span aria-hidden="true" className="sep">/</span><b>{titulo}</b></>}
        {versao && <span className="mono so-largo">{versao}</span>}
      </NoFolio>
      {children}
    </div>
  );
}

// ── produzindo ──────────────────────────────────────────────────────────────────────────────────────────────────

function Andamento({ s }: { s: StatusPeca }) {
  const { veiculo } = useCasca();
  // Histórico do veículo = os posts prontos para aprovar (mesma consulta da casca): o tempo medido entra na frase.
  const historico = usePecas(veiculo.id).data?.pecas ?? [];
  // O Reels não escreve nem desenha: confere o texto do carrossel e monta o vídeo.
  const etapas = s.formato === "reels" ? ETAPAS.filter((e) => e === "validar" || e === "renderizar") : ETAPAS;
  const atual = Math.max(0, etapas.indexOf(s.etapa ?? etapas[0]));
  const inicio = s.iniciada_em ?? s.created_at;
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => { const i = setInterval(() => setAgora(Date.now()), 1000); return () => clearInterval(i); }, []);
  const seg = Math.max(0, Math.round((agora - instante(inicio)) / 1000));
  const tempo = seg < 60 ? `${seg} s` : `${Math.floor(seg / 60)} min ${String(seg % 60).padStart(2, "0")} s`;
  const rotuloAtual = rotuloEtapa(etapas[atual], s.formato);
  const tentativa = s.etapa === "redigir" && (s.tentativa ?? 1) > 1 ? tr(` (tentativa ${s.tentativa} de 3)`, ` (attempt ${s.tentativa} of 3)`) : "";

  return (
    <section aria-labelledby="andamento" className="mt-8">
      <h2 id="andamento" className="secao m-0 mb-4">{tr("Produzindo", "In production")} <span className="text-apoio normal-case">{tempo}</span></h2>
      <p className="sr-only" role="status" aria-live="polite">{tr("Agora", "Now")}: {rotuloAtual}{tentativa}.</p>
      <ol className="m-0 grid list-none gap-1 p-0">
        {etapas.map((e, i) => {
          const feita = i < atual;
          const agoraAqui = i === atual;
          return (
            <li key={e} className={`flex min-h-12 items-center gap-3 border-b border-fio text-[17px] last:border-b-0 ${agoraAqui ? "font-bold text-texto-forte" : feita ? "text-texto" : "text-apoio"}`}>
              <span aria-hidden="true" className="grid size-6 flex-none place-items-center">
                {feita ? <IconeCerto className="size-5 text-texto-forte" /> : <span className={`size-2 rounded-full ${agoraAqui ? "bg-texto-forte" : "bg-fio-forte"}`} />}
              </span>
              <span className="relative">
                {rotuloEtapa(e, s.formato)}{agoraAqui ? tentativa : ""}
                {/* Traço de grafite (não é ação: neutro) que se desenha de novo a cada etapa. */}
                {agoraAqui && <SublinhadoLapis key={`${e}-${s.tentativa}`} desenhar seed={i + 3} className="text-texto-forte" />}
              </span>
              <span className="sr-only">{feita ? tr(": feito", ": done") : agoraAqui ? tr(": agora", ": now") : tr(": a seguir", ": next")}</span>
            </li>
          );
        })}
      </ol>
      <p className="mt-6 mb-0 max-w-[56ch] text-apoio">
        {fraseTempoProducao(tempoProducao(historico))} {tr("Pode sair desta tela: o post continua sendo feito e aparece nas Ideias, em andamento.", "You can leave this screen: the post keeps being made and shows up in Ideas, in progress.")}
      </p>
      <Link to={useIdeias()} className="link-acao mt-3 inline-block">{tr("Voltar às Ideias", "Back to Ideas")}</Link>
    </section>
  );
}

// ── não deu certo e outros estados ──────────────────────────────────────────────────────────────────────────────

function Falhou({ s }: { s: StatusPeca }) {
  const ideias = useIdeias();
  const { veiculo } = useCasca();
  const navegar = useNavigate();
  const qc = useQueryClient();
  // A ideia volta para a lista quando a produção falha; daqui dá para produzir de novo, no mesmo formato.
  // O Reels não volta da ideia: pede-se de novo no carrossel.
  const reels = s.formato === "reels";
  const deNovo = !reels && veiculo.papel !== "reporter" && (s.pauta_status === "aceita" || s.pauta_status === "sugerida");
  // A falha foi ao publicar (o PublicacaoWorkflow gravou a tentativa), não na produção.
  const aoPostar = s.publicacao_status === "falhou";
  // Ao postar, o resultado é incerto: a próxima ação é conferir no perfil, não produzir de novo (duplicaria o post).
  const perfil = aoPostar ? perfilInstagram(nomeConta({ modo: s.conta_modo ?? "", nome: s.conta_nome, external_id: s.conta_external_id })) : null;
  const produzir = useMutation({
    mutationFn: () => ler(api.t[":tenantId"].pautas[":id"].produzir.$post({ param: { tenantId: veiculo.id, id: s.pauta_id } }, corpoJson({ formato: s.formato }))),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: chaves.pautas(veiculo.id) });
      qc.invalidateQueries({ queryKey: chaves.pecas(veiculo.id) });
      navegar(`${ideias}/p/${r.pecaId}`);
    },
  });
  return (
    <section aria-labelledby="falhou" className="mt-8 grid justify-items-start gap-4">
      <div role="alert" className="faixa-erro w-full">
        <h2 id="falhou" className="m-0 text-[17px] text-terracota">{aoPostar ? tr("Não deu para confirmar a postagem", "Couldn't confirm the post went out") : tr("Não deu certo", "It didn't work")}</h2>
        <p className="m-0 mt-1">
          {/* A falha pode vir depois de o Instagram aceitar (ex.: ao buscar o link): o post pode ter saído. */}
          {aoPostar ? tr("A postagem automática parou no meio e o post pode ter saído mesmo assim. Confira no Instagram antes de tentar de novo.", "Automatic posting stopped halfway and the post may have gone out anyway. Check on Instagram before you try again.") : motivoFalha(s.erro)}
          {deNovo ? (aoPostar ? tr(" Se não saiu, a ideia voltou para a lista e dá para produzir de novo.", " If it didn't go out, the idea is back on the list and you can produce it again.") : tr(" A ideia voltou para a lista e dá para produzir de novo.", " The idea is back on the list and you can produce it again.")) : ""}
          {reels && !aoPostar ? tr(" Para tentar de novo, abra o carrossel e use Fazer Reels.", " To try again, open the carousel and use Make a Reel.") : ""}
        </p>
      </div>
      {s.erro && (
        <details className="text-apoio">
          <summary className="cursor-pointer text-[14px]">{tr("Detalhe técnico", "Technical detail")}</summary>
          <p className="mono m-0 mt-2 break-words">{s.erro}</p>
        </details>
      )}
      {perfil && (
        <a href={perfil} target="_blank" rel="noopener noreferrer" className="acao-lapis -ml-[6px]">
          <span>{tr("Conferir no Instagram", "Check on Instagram")}<span className="sr-only">{tr(" (abre em outra aba)", " (opens in a new tab)")}</span></span><VoltaLapis desenhar />
        </a>
      )}
      {deNovo ? (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {perfil ? (
            <button type="button" className="link-acao min-h-11" disabled={produzir.isPending || produzir.isSuccess} onClick={() => produzir.mutate()}>
              {produzir.isPending ? tr("Começando…", "Starting…") : tr("Não saiu: produzir de novo", "It didn't go out: produce again")}
            </button>
          ) : (
            <button type="button" className="acao-lapis -ml-[6px] cursor-pointer" disabled={produzir.isPending || produzir.isSuccess} onClick={() => produzir.mutate()}>
              <span>{produzir.isPending ? tr("Começando…", "Starting…") : tr(`Produzir de novo (${s.formato})`, `Produce again (${nomeFormato(s.formato)})`)}</span><VoltaLapis desenhar />
            </button>
          )}
          <Link to={ideias} className="link-acao">{tr("Voltar às Ideias", "Back to Ideas")}</Link>
          {produzir.error instanceof ErroApi && produzir.error.status === 402 && <AvisoLimite mensagem={produzir.error.message} veiculo={veiculo} codigo={produzir.error.codigo} />}
          {produzir.isError && !(produzir.error instanceof ErroApi && produzir.error.status === 402) && (
            <p role="alert" className="m-0 w-full text-[15px] text-terracota">
              {produzir.error instanceof ErroApi && produzir.error.status === 409
                ? tr("Essa ideia já mudou: alguém começou a produzir ou tirou da lista. Confira nas Ideias.", "This idea has already changed: someone started producing it or took it off the list. Check Ideas.")
                : tr("Não deu para começar agora. Tente de novo.", "Couldn't start right now. Try again.")}
            </p>
          )}
        </div>
      ) : perfil ? (
        <Link to={ideias} className="link-acao">{tr("Voltar às Ideias", "Back to Ideas")}</Link>
      ) : (
        <Link to={ideias} className="acao-lapis -ml-[6px]"><span>{tr("Voltar às Ideias", "Back to Ideas")}</span><VoltaLapis desenhar /></Link>
      )}
    </section>
  );
}

const SITUACAO: Record<string, [string, string]> = {
  get rejeitada(): [string, string] { return [tr("Rejeitado", "Rejected"), tr("A ideia saiu da lista.", "The idea left the list.")]; },
};

/** Rejeitado (ou outro estado sem tela própria): o resultado e a próxima ação. */
function Outro({ status }: { status: string }) {
  const ideias = useIdeias();
  const { veiculo } = useCasca();
  const { peca: id = "" } = useParams();
  const proxima = usePecas(veiculo.id).data?.pecas.find((p) => p.status === "revisao" && p.id !== id);
  const [titulo, texto] = SITUACAO[status] ?? [tr("Fora da produção", "Out of production"), tr("Este post já saiu da produção.", "This post has already left production.")];
  return (
    <section aria-labelledby="situacao" className="mt-8 grid justify-items-start gap-4">
      <div role="status">
        <h2 id="situacao" className="m-0 text-[20px] font-bold text-texto-forte">{titulo}</h2>
        <p className="m-0 mt-1 text-[17px]">{texto}</p>
      </div>
      {proxima ? (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Link to={`${ideias}/p/${proxima.id}`} className="acao-lapis -ml-[6px]"><span>{tr("Revisar a próxima", "Review the next one")}</span><VoltaLapis desenhar /></Link>
          <Link to={ideias} className="link-acao">{tr("Voltar às Ideias", "Back to Ideas")}</Link>
        </div>
      ) : (
        <Link to={ideias} className="acao-lapis -ml-[6px]"><span>{tr("Voltar às Ideias", "Back to Ideas")}</span><VoltaLapis desenhar /></Link>
      )}
    </section>
  );
}

function Esqueleto() {
  return (
    <div aria-busy="true" className="grid gap-3">
      <p role="status" className="sr-only">{tr("Carregando o andamento", "Loading the progress")}</p>
      <div className="esqueleto h-3 w-24" />
      <div className="esqueleto h-9 w-[min(24ch,90%)]" />
      <div className="mt-6 grid gap-3">{[0, 1, 2, 3].map((i) => <div key={i} className="esqueleto h-8 w-[min(40ch,85%)]" />)}</div>
    </div>
  );
}
