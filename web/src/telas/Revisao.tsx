// Revisão (rodada 4, DESIGN.md §8 e §12): o post pronto para aprovar. De 1180 px para cima, três colunas: a fila à vista,
// o palco da prova (carrossel dos cards, tiras, contador) e a coluna da conferência (validação que abre as checagens,
// manchete, frases e fontes, legenda). Abaixo disso, uma coluna na mesma ordem. O caminho de volta e o pager ficam no
// fólio da casca. A decisão é uma barra presa ao pé, no computador e no celular: Aprovar (conta e, opcional, horário) ·
// Reescrever (instrução opcional, versão n de 3) · Rejeitar (motivo); o passo abre dentro da barra, que cresce para cima.
// A marca à mão da tela é o visto no Aprovar, que se traça ao confirmar (DESIGN.md §4).
import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode, type RefObject } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router";
import { NOME_LAYOUT, NOME_LAYOUT_EN, ehConvite, normalizarCards, type Card, type CardNormal } from "../../../src/lib/cards";
import { api, corpoJson, ErroApi, ler, type Sucesso } from "../api";
import { aquecerPost } from "../aquecer";
import { t as tr } from "../idioma";
import { AprovacaoAnunciante } from "./AprovacaoAnunciante";
import { SeletorModelo } from "./Modelos";
import { useCasca } from "../casca/contexto";
import { NoFolio, NoFolioDir } from "../casca/Folio";
import { IconeAlerta, IconeCerto, IconeEditar, IconeReels, IconeSeta, IconeVoltar } from "../casca/icones";
import { FalhaCarga, Partes, atalhoLivre } from "../comum";
import {
  EDITORIA, MAX_VERSOES, PAPEL_CARD, chaves, comoPosta, fallbackDaVersao, fatosDoTexto, horarioAgendado, ilustracaoSimples, linhaValidacao, semChaveIlustracao,
  mensagemDecisao, nomeConta, notaAprovar, notaSemConta, quando, quemDecide, useContas, useMembros, usePecas, type Conta, type PecaFila, type StatusPeca,
} from "../fila";
import { NOME_ARTE, lembrarArte } from "../kit/arteVT";
import { VistoLapis } from "../kit/Lapis";
import { useMidia } from "../kit/Partes";
import { useAquecer } from "../kit/Prova";
import { veioDoTeclado } from "../movimento";
import type { PreviaPeca } from "../novo/previaEdicao";

// A edição dos cards carrega só quando abre: fora do JS da Revisão.
const EdicaoCarrossel = lazy(() => import("./EdicaoCarrossel"));

const t = api.t[":tenantId"].pecas[":id"];
type PecaCompleta = Sucesso<Awaited<ReturnType<typeof t.$get>>>;
type Fato = PecaCompleta["fatos"][number];
type CardTexto = { id?: string; papel?: string; layout?: string; titulo: string; frases?: { texto: string; fatoId: string | null }[] };
type Conteudo = { manchete?: string; legenda?: string; cards?: CardTexto[] };
type Validacao = { ok: boolean; erros?: string[]; avisos?: string[]; porCard?: Record<string, string[]>; geral?: string[]; en?: { porCard?: Record<string, string[]>; geral?: string[] } } | null;

/** A largura da tela de um post: a mesma do miolo da barra de decisão (rodada4.css), para as bordas baterem. */
const TELA = "mx-auto w-full max-w-[1264px] pt-2 lg:px-10 lg:pt-3";

/**
 * `novaVersao`: a versão mudou desde que o post foi aberto (reescrita de alguém, ou a sua, terminou; outra pessoa editou
 * os cards). `aceitarVersao`: a versão que a própria pessoa salvou na edição passa a ser a vista.
 */
export default function Revisao({ s, novaVersao, aceitarVersao, versaoAtual = s.versao }: {
  s: StatusPeca; novaVersao: "reescrita" | "edicao" | null; aceitarVersao: (v: number) => void;
  /** A versão que está no servidor; na edição, `s` fica na versão aberta e esta avisa que outra pessoa salvou. */
  versaoAtual?: number;
}) {
  const { veiculo, marcarPeca } = useCasca();
  // Antes da pintura: a lateral já marca Para aprovar no primeiro quadro (a marca de margem não passa por Ideias).
  useLayoutEffect(() => { marcarPeca("revisao"); return () => marcarPeca(null); }, [marcarPeca]);
  // A arte deste post é a que viaja de volta para a prova dele, na mesa (kit/arteVT).
  useEffect(() => { lembrarArte(s.id); }, [s.id]);
  // Peça completa (artes com URL assinada por 1 h): renova antes de expirar. A versão entra na chave: depois de uma
  // reescrita, a arte em cache é de outra versão e não serve.
  const peca = useQuery({
    queryKey: [...chaves.peca(veiculo.id, s.id), s.versao],
    queryFn: () => ler(t.$get({ param: { tenantId: veiculo.id, id: s.id } })),
    staleTime: 30 * 60_000,
    refetchInterval: 45 * 60_000,
  });
  // Imagem que não carrega com dado velho = URL assinada vencida (aparelho que dormiu): busca de novo.
  const imagemFalhou = () => { if (Date.now() - peca.dataUpdatedAt > 50 * 60_000) peca.refetch(); };
  const versao = s.formato === "reels" ? tr("Reels · do carrossel", "Reel · from the carousel")
    : tr(`${s.formato} · versão ${s.rodada} de ${MAX_VERSOES}`, `${s.formato === "carrossel" ? "carousel" : s.formato} · version ${s.rodada} of ${MAX_VERSOES}`);

  return (
    <>
      {/* No fólio da casca: o caminho de volta, o post e a versão; à direita, onde ele está na fila. */}
      <NoFolio>
        <Link to={`/t/${veiculo.slug}/aprovar`} viewTransition className="max-lg:min-h-10"><IconeVoltar className="size-4" /> {tr("Para aprovar", "To approve")}</Link>
        <span aria-hidden="true" className="sep">/</span>
        <b>{s.manchete ?? s.titulo}</b>
        <span className="mono so-largo">{versao}</span>
      </NoFolio>
      <NoFolioDir><Pager id={s.id} /></NoFolioDir>
      {peca.isError ? (
        <div className={`${TELA} grid gap-5 px-5 pb-12`}>
          <h1 className="manchete m-0 max-w-[28ch] text-[24px] lg:text-[32px]">{s.manchete ?? s.titulo}</h1>
          <FalhaCarga oque={tr("o post", "the post")}tentar={() => peca.refetch()} />
        </div>
      ) : peca.isPending ? (
        <div className={`${TELA} px-5 pb-12`}><h1 className="sr-only">{s.manchete ?? s.titulo}</h1><Esqueleto id={s.id} /></div>
      ) : (
        <Pronta s={s} peca={peca.data} versao={versao} imagemFalhou={imagemFalhou} novaVersao={novaVersao} aceitarVersao={aceitarVersao} versaoAtual={versaoAtual} />
      )}
    </>
  );
}

// ── a fila ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Os posts em revisão, na ordem de Para aprovar (mesma consulta da casca: quem espera há mais tempo primeiro), e onde este está. */
function useFila(id: string) {
  const { veiculo } = useCasca();
  const fila = (usePecas(veiculo.id).data?.pecas ?? []).filter((p) => p.status === "revisao");
  const i = fila.findIndex((p) => p.id === id);
  return { fila, i, antes: i > 0 ? fila[i - 1] : undefined, depois: i >= 0 ? fila[i + 1] : undefined };
}

/**
 * Onde este post está na fila de Para aprovar ("3 de 5") e como ir ao vizinho: setas e as teclas J (próximo) e K
 * (anterior). Mora no fólio. Só aparece quando o post está na fila e há mais de um.
 */
function Pager({ id }: { id: string }) {
  const { veiculo } = useCasca();
  const navegar = useNavigate();
  const { fila, i, antes, depois } = useFila(id);
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (!atalhoLivre(e)) return;
      const k = e.key.toLowerCase();
      const alvo = k === "j" ? depois : k === "k" ? antes : undefined;
      if (alvo) { e.preventDefault(); navegar(`/t/${veiculo.slug}/p/${alvo.id}`, { viewTransition: true }); }
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [antes, depois, navegar, veiculo.slug]);
  if (i < 0 || fila.length < 2) return null;
  const seta = "grid size-10 place-items-center rounded-btn lg:size-8";
  return (
    <nav aria-label={tr("Fila para aprovar", "Approval queue")} className="mono flex items-center gap-0.5 text-texto-forte">
      {antes
        ? <Link to={`/t/${veiculo.slug}/p/${antes.id}`} viewTransition aria-label={tr("Post anterior (K)", "Previous post (K)")} data-dica={tr("Post anterior", "Previous post")} data-tecla="K" className={`${seta} no-underline hover:bg-papel-2`}><IconeVoltar className="size-[18px]" /></Link>
        : <span aria-hidden="true" className={`${seta} text-fio-forte`}><IconeVoltar className="size-[18px]" /></span>}
      <span aria-live="polite" className="min-w-[6ch] text-center">{i + 1} {tr("de", "of")} {fila.length}</span>
      {depois
        ? <Link to={`/t/${veiculo.slug}/p/${depois.id}`} viewTransition aria-label={tr("Próximo post (J)", "Next post (J)")} data-dica={tr("Próximo post", "Next post")} data-tecla="J" className={`${seta} no-underline hover:bg-papel-2`}><IconeVoltar className="size-[18px] rotate-180" /></Link>
        : <span aria-hidden="true" className={`${seta} text-fio-forte`}><IconeVoltar className="size-[18px] rotate-180" /></span>}
    </nav>
  );
}

/** Quantas miniaturas a fila mostra de uma vez (a coluna do computador fica presa ao rolar: tem de caber na tela). */
const JANELA_FILA = 7;

/**
 * A fila à vista: os posts em revisão em miniatura, com o número de cada um; o aberto, marcado. No computador é a
 * primeira coluna; abaixo de 1180 px, uma fileira que rola de lado. Fila longa mostra só os vizinhos do aberto e diz
 * quantos ficaram de fora ("+4"); o total está no pager do fólio.
 */
function FilaLado({ id }: { id: string }) {
  const { fila, i } = useFila(id);
  const lista = useRef<HTMLOListElement>(null);
  // Na fileira do celular, o post aberto fica à vista (só a fileira rola, nunca a página).
  useEffect(() => {
    const ol = lista.current;
    const el = ol?.querySelector<HTMLElement>('[aria-current="true"]');
    if (ol && el && ol.scrollWidth > ol.clientWidth) ol.scrollLeft = el.offsetLeft - (ol.clientWidth - el.offsetWidth) / 2;
  }, [i, fila.length]);
  // Fora da fila (a lista ainda não chegou): a coluna continua lá, vazia, para o palco não mudar de lugar.
  if (i < 0) return <div aria-hidden="true" className="max-xl:hidden" />;
  const ini = Math.max(0, Math.min(i - Math.floor(JANELA_FILA / 2), fila.length - JANELA_FILA));
  const vistos = fila.slice(ini, ini + JANELA_FILA);
  const depois = fila.length - ini - vistos.length;
  return (
    <nav aria-label={tr("Posts na fila", "Posts in the queue")} className="rv-fila min-w-0">
      <span aria-hidden="true" className="lat-rotulo">{tr("Fila", "Queue")}</span>
      {ini > 0 && <span aria-hidden="true" className="mono text-apoio">+{ini}</span>}
      <ol ref={lista}>
        {vistos.map((p, k) => <ItemFila key={p.id} p={p} n={ini + k + 1} atual={p.id === id} />)}
      </ol>
      {depois > 0 && <span aria-hidden="true" className="mono text-apoio">+{depois}</span>}
    </nav>
  );
}

function ItemFila({ p, n, atual }: { p: PecaFila; n: number; atual: boolean }) {
  const { veiculo } = useCasca();
  const qc = useQueryClient();
  // Apontar para o vizinho já busca o post dele (src/aquecer.ts): a revisão seguinte abre pronta.
  const apontar = useAquecer(atual ? undefined : () => void aquecerPost(qc, veiculo.id, p.id));
  const manchete = p.manchete ?? p.titulo;
  return (
    <li>
      {/* O aberto continua na lista (é onde a pessoa está), mas clicar nele não troca de tela. */}
      <Link to={`/t/${veiculo.slug}/p/${p.id}`} viewTransition aria-current={atual ? "true" : undefined} data-dica={manchete}
        onClick={(e) => { if (atual) e.preventDefault(); }} {...apontar}>
        {/* O nome do link é o que se vê (o número) e a manchete, só para leitor de tela: rótulo à parte do texto visível reprova no axe. */}
        <b className="prova-n">{String(n).padStart(2, "0")}</b><span className="sr-only">: {manchete}</span>
        <span className="fila-mini" data-vaga={p.capa ? undefined : ""}>{p.capa && <img src={p.capa} alt="" loading="lazy" decoding="async" />}</span>
      </Link>
    </li>
  );
}

// ── a tela pronta ───────────────────────────────────────────────────────────────────────────────────────────────

/** Uma frase dos cards, na ordem em que aparece: em que card está, e o fato a que está presa. */
type Linha = { texto: string; ordem: number; cardId: string; card: number; nome: string; arte: number; fato?: Fato; autor: boolean };

/** As frases dos cards (o convite não conta: é do veículo). `arte`: a posição do card no palco, ou -1 se ele não tem imagem própria. */
function frasesDoPost(cards: CardNormal[], artes: PecaCompleta["artes"], fatos: Fato[]): Linha[] {
  const porId = new Map(fatos.map((f) => [f.id, f]));
  return cards.flatMap((c, i) => {
    if (ehConvite(c)) return [];
    const arte = artes.findIndex((a) => (a.id ?? a.papel) === c.id);
    const nome = PAPEL_CARD[c.papel ?? c.layout] ?? tr(NOME_LAYOUT[c.layout], NOME_LAYOUT_EN[c.layout]);
    return c.frases.map((f, ordem) => ({ texto: f.texto, ordem, cardId: c.id, card: (arte >= 0 ? arte : i) + 1, nome, arte, fato: f.fatoId ? porId.get(f.fatoId) : undefined, autor: !!f.autor }));
  });
}

function Pronta({ s, peca, versao, imagemFalhou, novaVersao, aceitarVersao, versaoAtual }: {
  s: StatusPeca; peca: PecaCompleta; versao: string; imagemFalhou: () => void; novaVersao: "reescrita" | "edicao" | null; aceitarVersao: (v: number) => void; versaoAtual: number;
}) {
  const { veiculo } = useCasca();
  // A edição dos cards fica na URL (?editar=1): salvar troca a versão e remonta a tela, e a edição continua aberta
  // quando a conferência apontou algo.
  const [params, setParams] = useSearchParams();
  const editando = params.get("editar") === "1";
  const abrirEdicao = (sim: boolean) => setParams((p) => { if (sim) p.set("editar", "1"); else p.delete("editar"); return p; }, { replace: true });
  // A edição abre na versão que está na tela (a do servidor): o aviso de versão nova, se havia, já foi visto.
  const editarCards = () => { aceitarVersao(versaoAtual); abrirEdicao(true); };
  const reels = s.formato === "reels";
  const podeEditar = veiculo.papel !== "reporter" && !!peca.previa && !reels;
  const podeReels = veiculo.papel !== "reporter" && s.formato === "carrossel";
  const conteudo = peca.peca.conteudo as Conteudo;
  const validacao = peca.peca.validacao as Validacao;
  const cards = conteudo.cards ?? [];
  // De 1180 px para cima o palco fica preso ao rolar e o modelo vai para a coluna da conferência; a caixa da frase sobre a
  // arte só existe onde o palco mostra um card por vez (de 1024 px para cima).
  const tres = useMidia("(min-width: 1180px)");
  const largo = useMidia("(min-width: 1024px)");
  const [frase, setFrase] = useState<number | null>(null);
  const [medidas, setMedidas] = useState<Record<string, (Caixa | null)[]>>({});
  const [carimbo, setCarimbo] = useState(false);
  const irCard = useRef<((i: number, suave?: boolean) => void) | null>(null);
  if (editando && podeEditar) {
    return (
      <div className="mx-auto max-w-[1180px] px-5 pt-2 lg:px-12 lg:pt-2">
        <Suspense fallback={<p role="status" className="m-0 text-apoio">{tr("Abrindo a edição…", "Opening the editor…")}</p>}>
          <EdicaoCarrossel s={s} peca={peca} sair={() => abrirEdicao(false)} versaoAtual={versaoAtual} abrirNova={() => aceitarVersao(versaoAtual)}
            salvou={(v, ok) => { aceitarVersao(v); if (ok) abrirEdicao(false); }} />
        </Suspense>
      </div>
    );
  }
  const { frases, fatoIds } = fatosDoTexto(cards);
  const citados = fatoIds.length ? peca.fatos.filter((f) => fatoIds.includes(f.id)) : peca.fatos.filter((f) => f.tipo !== "manchete");
  // O mesmo trecho pode sustentar mais de um fato (manchete, tipo, editoria): cada texto conta e aparece uma vez.
  const usados = citados.filter((f, i) => citados.findIndex((g) => g.texto === f.texto) === i);
  const fontes = [...new Set(usados.map((f) => f.fonte).filter(Boolean))] as string[];
  const editoria = peca.pauta?.editoria;
  // Kie pulado (sem chave, sem referência, sem crédito, teto): a arte saiu no estilo padrão. Aviso, não erro.
  const simples = s.formato === "reels" ? null : ilustracaoSimples(peca.eventos, s.versao);
  // Sem chave de ilustração: o admin liga na aba Chaves de IA.
  const ligarIlustracao = !!simples && veiculo.papel === "admin" && semChaveIlustracao(fallbackDaVersao(peca.eventos, s.versao) ?? "");
  const normais = normalizarCards(cards as Card[]);
  const linhas = frasesDoPost(normais, peca.artes, peca.fatos);
  // A caixa de cada frase sobre a arte, só a que foi medida (MedidaFrases); sem medida, apontar a frase só troca o card.
  const caixas = linhas.flatMap((l, n) => { const c = l.arte >= 0 ? medidas[l.cardId]?.[l.ordem] : null; return c ? [{ n, arte: l.arte, ...c }] : []; });
  const previa = peca.previa as PreviaPeca | null;
  const aMedir = normais.filter((c) => linhas.some((l) => l.cardId === c.id && l.arte >= 0));
  // Apontar, focar ou tocar numa frase: ela abre o trecho da fonte e o palco vai ao card dela (sem deslizar: é consulta).
  const mostrarFrase = (n: number | null) => {
    setFrase(n);
    const l = n === null ? undefined : linhas[n];
    if (l && l.arte >= 0) irCard.current?.(l.arte, false);
  };
  const modelo = !reels && peca.previa
    ? <SeletorModelo tenantId={veiculo.id} pecaId={s.id} versao={s.versao} modelo={peca.modelo} editor={podeEditar} aceitarVersao={aceitarVersao} />
    : null;

  return (
    // A coluna enche a folha: com pouco conteúdo, a barra de decisão continua no pé da tela.
    <div className="flex min-h-[calc(100dvh_-_98px)] flex-col px-5 lg:min-h-[calc(100dvh_-_var(--topo)_-_var(--pe))] lg:px-0">
      <div className={`${TELA} flex-1 pb-8`}>
        <div className="rv-grade">
          <FilaLado id={s.id} />
          {/* Em tela alta, a arte acompanha a rolagem: dá para ler as frases e a legenda com o card à vista. */}
          <div className="palco-fixo min-w-0">
            {simples && (
              <p role="note" className="faixa-aviso m-0 mb-3">
                {tr("Ilustração simples", "Simple illustration")}: {simples}.
                {ligarIlustracao && <>{" "}<Link className="link-acao" to={`/t/${veiculo.slug}/veiculo?aba=chaves`}>{tr("Colar a chave de ilustração", "Paste the illustration key")}</Link></>}
              </p>
            )}
            {reels ? <VideoReels arte={peca.artes[0]} cards={cards} comVoz={!!(conteudo as { narracao?: string | null }).narracao} imagemFalhou={imagemFalhou} carimbo={carimbo} /> : (
              <Carrossel artes={peca.artes} cards={cards} imagemFalhou={imagemFalhou} irRef={irCard} caixas={caixas} frase={frase} carimbo={carimbo} acoes={(podeEditar || podeReels) && (
                // Computador: a barra da mesa (as explicações vão na dica e para o leitor de tela).
                <>
                  {podeEditar && (
                    <button type="button" onClick={editarCards} aria-describedby="rv-ajuda-editar" data-dica={tr("Texto, ordem, tipo de card e foto. Não gasta versão.", "Text, order, card type and photo. It doesn't use up a version.")} className="btn-papel btn-p">
                      <IconeEditar className="size-4" />{tr("Editar os cards", "Edit the cards")}
                    </button>
                  )}
                  {podeReels && (
                    <Link to="reels" aria-describedby="rv-ajuda-reels" data-dica={tr("Os mesmos cards em vídeo, em pé. Vira um post novo.", "The same cards as an upright video. It becomes a new post.")} className="btn-papel btn-p no-underline">
                      <IconeReels className="size-4" />{tr("Fazer Reels", "Make a Reel")}
                    </Link>
                  )}
                </>
              )} />
            )}
            {/* Celular: as ações sob o carrossel, com a explicação à vista. Post sem imagem (sem a mesa): também no computador. */}
            <div className={reels || peca.artes.length ? "lg:hidden" : ""}>
              {podeEditar && (
                <p className="m-0 mt-1 flex flex-wrap items-center gap-x-3">
                  <button type="button" onClick={editarCards} className="btn-sec bg-papel-2">{tr("Editar os cards", "Edit the cards")}</button>
                  <span className="ajuda">{tr("Texto, ordem, tipo de card e foto. Não gasta versão.", "Text, order, card type and photo. It doesn't use up a version.")}</span>
                </p>
              )}
              {podeReels && (
                <p className="m-0 mt-1 flex flex-wrap items-center gap-x-3">
                  <Link to="reels" className="btn-sec bg-papel-2 no-underline">{tr("Fazer Reels", "Make a Reel")}</Link>
                  <span className="ajuda">{tr("Os mesmos cards em vídeo, em pé. Vira um post novo.", "The same cards as an upright video. It becomes a new post.")}</span>
                </p>
              )}
            </div>
            {modelo && !tres && <div className="mt-3 max-w-[404px]">{modelo}</div>}
            {podeEditar && <p id="rv-ajuda-editar" className="sr-only">{tr("Texto, ordem, tipo de card e foto. Não gasta versão.", "Text, order, card type and photo. It doesn't use up a version.")}</p>}
            {podeReels && <p id="rv-ajuda-reels" className="sr-only">{tr("Os mesmos cards em vídeo, em pé. Vira um post novo.", "The same cards as an upright video. It becomes a new post.")}</p>}
          </div>
          <div className="conf">
            <div className="empty:hidden">
              {novaVersao === "reescrita" && (
                <p role="status" className="faixa-aviso m-0 mb-3">{tr(`Chegou a versão ${s.rodada} deste post enquanto ele estava aberto. Confira de novo antes de decidir.`, `Version ${s.rodada} of this post arrived while it was open. Check it again before you decide.`)}</p>
              )}
              {novaVersao === "edicao" && (
                <p role="status" className="faixa-aviso m-0 mb-3">{tr("Outra pessoa editou os cards enquanto o post estava aberto. Confira de novo antes de decidir.", "Someone else edited the cards while the post was open. Check it again before you decide.")}</p>
              )}
              <ValidacaoLinha validacao={validacao} frases={frases} fatos={fatoIds.length ? usados.length : 0} cards={cards} editar={podeEditar ? editarCards : undefined} />
            </div>
            <div>
              {/* No computador o formato e a versão estão no fólio; no celular o fólio só tem lugar para o caminho de volta. */}
              <p className="mono m-0 mb-1 text-apoio lg:hidden">{versao}</p>
              <p className="mono m-0 text-apoio">
                <Partes partes={[editoria ? EDITORIA[editoria] ?? editoria : null, fontes.join(", "), quando(s.updated_at)]} />
              </p>
              <h1 className="manchete m-0 mt-1.5 text-[24px] lg:text-[27px]">{conteudo.manchete ?? s.manchete ?? s.titulo}</h1>
            </div>
            {(peca.pauta as { tipo_post?: string | null } | null)?.tipo_post === "publicidade" && <AprovacaoAnunciante tenantId={veiculo.id} pecaId={s.id} editor={veiculo.papel !== "reporter"} />}
            {linhas.length > 0 && <FrasesFontes linhas={linhas} materia={peca.fatos.some((f) => f.evidencia)} print={fatoIds.length ? usados.find((f) => f.print)?.print ?? null : null} ativa={frase} mostrar={mostrarFrase} noPalco={!reels && peca.artes.length > 0} />}
            {/* Post antigo, sem frase presa a fato: os fatos da ideia continuam à vista, como eram. */}
            {!fatoIds.length && usados.length > 0 && <Fatos fatos={usados} fontes={fontes} />}
            {conteudo.legenda && <Legenda texto={conteudo.legenda} />}
            {modelo && tres && modelo}
          </div>
        </div>
      </div>
      <Barra s={s} bloqueada={validacao?.ok === false} reels={reels} doSite={(peca.pauta as { origem?: string } | null)?.origem === "site"} carimbar={() => setCarimbo(true)} />
      {largo && !reels && previa && aMedir.length > 0 && (
        <MedidaFrases previa={previa} cards={aMedir} formato={s.formato === "post" ? "post" : "carrossel"} medido={(m) => setMedidas((antes) => ({ ...antes, ...m }))} />
      )}
    </div>
  );
}

// ── onde a frase está na arte ───────────────────────────────────────────────────────────────────────────────────

/** A caixa de uma frase sobre a arte, em % do card. */
type Caixa = { x: number; y: number; w: number; h: number };

/** Folga da caixa em volta da frase, em px do card (1080 × 1350): ela não encosta nas letras. */
const FOLGA = { x: 10, y: 6 };

/**
 * O retângulo de cada frase no card desenhado em `doc` (o template do render, 1080 × 1350). Só mede com as fontes do
 * card carregadas (com a de reserva a quebra de linha seria outra) e com a frase achada tal como está no texto; no
 * resto, `null`: sem caixa. Layouts de lista têm um item por frase; os outros, as frases em sequência num parágrafo.
 */
async function medirCard(doc: Document, card: CardNormal): Promise<(Caixa | null)[]> {
  const folha = doc.querySelector<HTMLElement>(".card");
  if (!folha) return [];
  folha.getBoundingClientRect();   // o primeiro layout é o que pede as fontes
  await doc.fonts.ready;
  const faces = Array.from(doc.fonts);
  if (!faces.some((f) => f.status === "loaded") || faces.some((f) => f.status === "error" || f.status === "loading")) return [];
  const base = folha.getBoundingClientRect();
  if (!base.width || !base.height) return [];
  const caixa = (r: DOMRect): Caixa | null => {
    const esq = Math.max(0, r.left - base.left - FOLGA.x), topo = Math.max(0, r.top - base.top - FOLGA.y);
    const dir = Math.min(base.width, r.right - base.left + FOLGA.x), pe = Math.min(base.height, r.bottom - base.top + FOLGA.y);
    if (r.width < 1 || r.height < 1 || dir <= esq || pe <= topo) return null;
    return { x: (esq / base.width) * 100, y: (topo / base.height) * 100, w: ((dir - esq) / base.width) * 100, h: ((pe - topo) / base.height) * 100 };
  };
  const itens = doc.querySelectorAll<HTMLElement>(".story-list > li");
  if (itens.length) return itens.length === card.frases.length ? Array.from(itens, (li) => caixa(li.getBoundingClientRect())) : [];
  const textos = card.frases.map((f) => f.texto);
  const no = doc.querySelector(".story-body")?.firstChild;
  // nodeType e não instanceof: o nó é de outro documento (o do iframe).
  if (!no || no.nodeType !== 3 || (no as Text).data !== textos.join(" ")) return [];
  let ini = 0;
  return textos.map((tx) => {
    const r = doc.createRange();
    r.setStart(no, ini);
    r.setEnd(no, ini + tx.length);
    ini += tx.length + 1;
    return tx.trim() ? caixa(r.getBoundingClientRect()) : null;
  });
}

/**
 * Onde cada frase está na arte, medido e não estimado: cada card é desenhado de novo no mesmo template do render (a
 * prévia da edição dos cards, sem as imagens, que não mudam o lugar do texto) num iframe escondido de 1080 × 1350, e a
 * caixa é o retângulo da frase ali. O template só é baixado aqui, depois de a tela estar pronta, e os iframes saem
 * assim que a medida termina.
 */
function MedidaFrases({ previa, cards, formato, medido }: { previa: PreviaPeca; cards: CardNormal[]; formato: "post" | "carrossel"; medido: (m: Record<string, (Caixa | null)[]>) => void }) {
  const [paginas, setPaginas] = useState<{ card: CardNormal; html: string }[]>([]);
  const feitos = useRef(0);
  useEffect(() => {
    let vivo = true;
    import("../novo/previaEdicao").then(({ htmlCardEdicao }) => {
      if (!vivo) return;
      const semImagens: PreviaPeca = { ...previa, logo: null, arte: null, imagens: {}, base: previa.base.patrocinio ? { ...previa.base, patrocinio: { ...previa.base.patrocinio, logo: null } } : previa.base };
      feitos.current = 0;
      setPaginas(cards.map((card) => ({ card, html: htmlCardEdicao(semImagens, card, formato, {}) })));
    }).catch(() => { /* sem a prévia não há caixa: a tela segue igual */ });
    return () => { vivo = false; };
    // O post e a versão não mudam com a tela montada (a Revisão remonta a cada versão): mede uma vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const pronto = async (quadro: HTMLIFrameElement, card: CardNormal) => {
    const doc = quadro.contentDocument;
    const caixas = doc ? await medirCard(doc, card).catch(() => []) : [];
    medido({ [card.id]: caixas });
    feitos.current += 1;
    if (feitos.current >= paginas.length) setPaginas([]);
  };
  if (!paginas.length) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none invisible fixed top-0 left-0 size-0 overflow-hidden">
      {paginas.map(({ card, html }) => (
        <iframe key={card.id} title={tr("Medida do card", "Card measurement")} srcDoc={html} sandbox="allow-same-origin" tabIndex={-1}
          onLoad={(e) => void pronto(e.currentTarget, card)} className="h-[1350px] w-[1080px] max-w-none border-0" />
      ))}
    </div>
  );
}

// ── reels ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** O carimbo "Aprovado", que bate na prova quando o Aprovar deu certo (só no computador; DESIGN.md §8). */
const Carimbo = () => <span aria-hidden="true" className="carimbo palco-carimbo carimbo-bate">{tr("Aprovado", "Approved")}</span>;

/**
 * O vídeo do Reels, em pé, com os controles do navegador e a capa do carrossel. Toca sozinho e mudo, em laço, só sem
 * "reduzir movimento"; com ele, fica parado na capa até a pessoa tocar.
 */
function VideoReels({ arte, cards, comVoz, imagemFalhou, carimbo }: { arte: PecaCompleta["artes"][number] | undefined; cards: CardTexto[]; comVoz: boolean; imagemFalhou: () => void; carimbo: boolean }) {
  const [reduz, setReduz] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const video = useRef<HTMLVideoElement>(null);
  // Passou a "reduzir movimento" com a tela aberta: para o vídeo e o laço.
  useEffect(() => {
    const m = matchMedia("(prefers-reduced-motion: reduce)");
    const mudou = () => { setReduz(m.matches); if (m.matches) video.current?.pause(); };
    m.addEventListener("change", mudou);
    return () => m.removeEventListener("change", mudou);
  }, []);
  const normais = normalizarCards(cards as Card[]);
  if (!arte?.mp4) return <p className="faixa-aviso m-0">{tr("Este Reels ainda não tem o vídeo.", "This Reel doesn't have its video yet.")}</p>;
  const segundos = tr(String(arte.duracao).replace(".", ","), String(arte.duracao));
  return (
    <figure className="palco m-0 grid justify-items-center gap-2">
      <video ref={video} src={arte.mp4} poster={arte.jpg} controls aria-describedby="rv-reels-texto" playsInline muted={!reduz} loop={!reduz} autoPlay={!reduz} preload="metadata" onError={imagemFalhou}
        aria-label={tr(`Vídeo do Reels${arte.duracao ? `, ${segundos} segundos` : ""}`, `Reel video${arte.duracao ? `, ${segundos} seconds` : ""}`)} style={{ viewTransitionName: NOME_ARTE }}
        className="block aspect-[9/16] h-auto w-[min(70vw,300px)] rounded-card bg-texto-forte object-contain shadow-curta lg:w-[min(100%,340px)]" />
      {carimbo && <Carimbo />}
      <figcaption className="mono text-apoio">{tr("Reels", "Reel")} · 9:16{arte.duracao ? ` · ${segundos} s` : ""} · {comVoz ? tr("com a sua voz", "with your voice") : tr("sem narração", "no narration")}</figcaption>
      {/* O texto do vídeo, na ordem dos cards: quem não vê o vídeo lê o mesmo que ele mostra. */}
      <details id="rv-reels-texto" className="max-w-[60ch]">
        <summary className="min-h-11 cursor-pointer content-center text-[15px] text-texto">{tr("Texto dos cards do vídeo", "Text of the video's cards")}</summary>
        <ol className="m-0 mt-1 grid gap-2 pl-5 text-[15px]">
          {normais.map((c) => (
            <li key={c.id}><b className="text-texto-forte">{c.titulo}</b>{c.frases.length ? ` ${c.frases.map((f) => f.texto).join(" ")}` : ""}</li>
          ))}
        </ol>
      </details>
    </figure>
  );
}

// ── carrossel ───────────────────────────────────────────────────────────────────────────────────────────────────

function Carrossel({ artes, cards, imagemFalhou, acoes, irRef, caixas, frase, carimbo }: {
  artes: PecaCompleta["artes"]; cards: CardTexto[]; imagemFalhou: () => void; acoes?: ReactNode;
  /** Para quem está fora levar o palco a um card (apontar uma frase). */
  irRef: RefObject<((i: number, suave?: boolean) => void) | null>;
  /** As caixas medidas das frases (`n`: a frase; `arte`: o card) e a frase apontada agora. */
  caixas: ({ n: number; arte: number } & Caixa)[]; frase: number | null; carimbo: boolean;
}) {
  const trilho = useRef<HTMLUListElement>(null);
  const [atual, setAtual] = useState(0);
  const pedido = useRef<number | null>(null);
  /** Marca a conferência de onde a faixa parou, para quando pode não vir rolagem nenhuma que a faça. */
  const conferir = useRef<() => void>(() => {});
  const n = artes.length;
  // Onde a faixa para ao mostrar o card i. No fim da faixa a rolagem trava: com a tela larga (tablet), os últimos
  // cards param no mesmo lugar, e "o card à vista" não basta para saber qual é o atual.
  const parada = (el: HTMLElement, i: number) => {
    const li = el.children[i] as HTMLElement | undefined;
    const base = (el.firstElementChild as HTMLElement).offsetLeft;
    return Math.min((li?.offsetLeft ?? 0) - base, el.scrollWidth - el.clientWidth);
  };
  // O atual, quando a rolagem assenta: o card pedido (pontos, setas) se a faixa parou onde ele para; senão (arrastar,
  // teclado) o último quando a faixa chegou ao fim, ou o card cuja parada está mais perto.
  useEffect(() => {
    const el = trilho.current;
    if (!el || n < 2) return;
    let espera: ReturnType<typeof setTimeout> | undefined;
    const assentou = () => {
      const p = pedido.current;
      pedido.current = null;
      if (p !== null && Math.abs(parada(el, p) - el.scrollLeft) <= 2) return setAtual(p);
      if (el.scrollLeft >= el.scrollWidth - el.clientWidth - 2) return setAtual(n - 1);
      let melhor = 0;
      for (let i = 1; i < n; i++) if (Math.abs(parada(el, i) - el.scrollLeft) < Math.abs(parada(el, melhor) - el.scrollLeft)) melhor = i;
      setAtual(melhor);
    };
    const marcar = () => { clearTimeout(espera); espera = setTimeout(assentou, 120); };
    // O navegador que avisa o fim da rolagem (scrollend) dispensa o palpite. Nos outros, 120 ms sem rolar valem por
    // "parou": acerta onde a rolagem avisa a cada quadro e erra onde um deslize pedido só avisa na saída e na chegada
    // (o card atual voltava ao de antes no meio do caminho, e a seta de voltar se desligava com ele).
    const avisaFim = "onscrollend" in window;
    const rolou = () => { if (avisaFim) clearTimeout(espera); else marcar(); };
    const parou = () => { clearTimeout(espera); assentou(); };
    conferir.current = marcar;
    el.addEventListener("scroll", rolou, { passive: true });
    if (avisaFim) el.addEventListener("scrollend", parou);
    return () => { el.removeEventListener("scroll", rolou); el.removeEventListener("scrollend", parou); clearTimeout(espera); conferir.current = () => {}; };
  }, [n]);

  // `suave: false` troca de card sem deslizar (apontar uma frase é consulta, não navegação).
  const ir = (i: number, suave = true) => {
    const el = trilho.current;
    if (!el || i < 0 || i >= n) return;
    setAtual(i);
    const noLugar = Math.abs(parada(el, i) - el.scrollLeft) <= 2;
    // A faixa já está onde o card para e nenhum pedido está a caminho: nada rola (e nenhuma rolagem viria dar baixa no pedido).
    if (noLugar && pedido.current === null) return;
    pedido.current = i;
    const desliza = suave && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: parada(el, i), behavior: desliza ? "smooth" : "auto" });
    // "No lugar" não é "parada": com um pedido a caminho de outro card (→ e ← em seguida, a faixa ainda no ponto de
    // partida; → → ←, ela de passagem pela parada), este toma o lugar daquele, que senão terminaria no card de antes e
    // levaria o atual junto. Pode ser que nada role daqui em diante: a baixa do pedido fica marcada sem esperar a rolagem.
    if (noLugar) conferir.current();
  };
  // ← e → passam os cards em qualquer lugar da tela (fora de campo de texto): a revisão é feita de olho na arte.
  const irAgora = useRef(ir);
  irAgora.current = ir;
  irRef.current = ir;
  const atualAgora = useRef(atual);
  atualAgora.current = atual;
  useEffect(() => {
    if (n < 2) return;
    const tecla = (e: KeyboardEvent) => {
      if (!atalhoLivre(e, true)) return;
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); irAgora.current(atualAgora.current + (e.key === "ArrowRight" ? 1 : -1)); }
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [n]);
  // A prova muda de largura (janela, ou a barra de decisão que abriu um passo): o card atual continua no lugar.
  useEffect(() => {
    const el = trilho.current;
    if (!el || n < 2) return;
    const ro = new ResizeObserver(() => { const alvo = parada(el, atualAgora.current); if (pedido.current === null && Math.abs(el.scrollLeft - alvo) > 2) el.scrollLeft = alvo; });
    ro.observe(el);
    return () => ro.disconnect();
  }, [n]);
  const papel = (i: number) => PAPEL_CARD[artes[i]?.papel] ?? artes[i]?.papel ?? "";
  const normais = normalizarCards(cards as Card[]);
  const titulo = (i: number) => normais.find((c) => c.id === (artes[i]?.id ?? artes[i]?.papel))?.titulo;

  if (!n) return <p className="faixa-aviso m-0">{tr("Este post ainda não tem imagens.", "This post doesn't have images yet.")}</p>;
  const seta = "grid size-11 cursor-pointer place-items-center rounded-btn text-texto-forte hover:bg-papel-3 disabled:cursor-default disabled:text-fio-forte disabled:hover:bg-transparent";
  return (
    <section aria-label={tr("Imagens do post", "Post images")} className="palco min-w-0">
      {/* Barra da mesa (só no computador): a cota da prova, como na margem de uma prova de gráfica, e as ações do post. */}
      <div className="palco-topo">
        <p className="mono m-0" aria-hidden="true">{tr("prova", "proof")} · 4:5 · 1080 × 1350 px</p>
        <div className="palco-acoes">{acoes}</div>
      </div>
      <div className="palco-arte corte">
        {/* Rolagem lateral com encaixe: arrastar no celular; a faixa recebe foco e as setas do teclado rolam. No computador cada card ocupa a prova inteira. */}
        <ul ref={trilho} tabIndex={0} aria-label={n > 1 ? tr(`${n} cards; arraste para o lado`, `${n} cards; swipe sideways`) : tr("Imagem do post", "Post image")}
          className="relative -mx-5 m-0 flex list-none snap-x snap-mandatory scroll-px-5 gap-3 overflow-x-auto px-5 pt-1 pb-3 [scrollbar-width:none] lg:mx-0 lg:scroll-px-0 lg:gap-4 lg:p-0 [&::-webkit-scrollbar]:hidden">
          {artes.map((a, i) => (
            <li key={a.papel + i} className={`relative flex-none snap-start ${n > 1 ? "w-[min(64vw,320px)] lg:w-full" : "w-[min(82vw,400px)] lg:w-full"}`}>
              {/* Só a arte à vista leva o nome da viagem (kit/arteVT): um elemento por vez com ele na tela. */}
              <img src={a.jpg} width={1080} height={1350} loading={i > 1 ? "lazy" : undefined} onError={imagemFalhou}
                alt={`${tr(`Card ${i + 1} de ${n}`, `Card ${i + 1} of ${n}`)}: ${papel(i)}${titulo(i) ? `. ${titulo(i)}` : ""}`} style={i === atual ? { viewTransitionName: NOME_ARTE } : undefined}
                className="block aspect-[4/5] h-auto w-full rounded-card bg-papel object-cover shadow-prova" />
              {caixas.filter((c) => c.arte === i).map((c) => (
                <i key={c.n} aria-hidden="true" className="chamada" data-on={c.n === frase ? "" : undefined}
                  style={{ "--x": `${c.x}%`, "--y": `${c.y}%`, "--w": `${c.w}%`, "--h": `${c.h}%` } as CSSProperties}><b>{c.n + 1}</b></i>
              ))}
            </li>
          ))}
        </ul>
        {carimbo && <Carimbo />}
      </div>
      {n > 1 && (
        <div className="palco-baixo">
          <p className="mono m-0 text-texto [grid-area:n]" aria-live="polite">{atual + 1} / {n} · {papel(atual)}</p>
          {/* Tiras de prova: a capa de cada card, a atual levantada e com o fio de grafite em volta. */}
          <div className="tiras [grid-area:tiras]">
            {artes.map((a, i) => (
              <button key={a.papel + i} type="button" onClick={() => ir(i)} aria-label={`Card ${i + 1}: ${papel(i)}`} aria-current={i === atual ? "true" : undefined} className="tira">
                <img src={a.jpg} alt="" loading="lazy" decoding="async" />
              </button>
            ))}
          </div>
          <div className="flex [grid-area:setas]">
            <button type="button" onClick={() => ir(atual - 1)} disabled={atual === 0} aria-label={tr("Card anterior", "Previous card")} data-dica={tr("Card anterior", "Previous card")} data-tecla="←" className={seta}>
              <IconeVoltar className="size-5" />
            </button>
            <button type="button" onClick={() => ir(atual + 1)} disabled={atual === n - 1} aria-label={tr("Próximo card", "Next card")} data-dica={tr("Próximo card", "Next card")} data-tecla="→" className={seta}>
              <IconeVoltar className="size-5 rotate-180" />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ── conferência ─────────────────────────────────────────────────────────────────────────────────────────────────

const CHECAGENS = () => [
  tr("Cada frase dos cards aponta para um fato da fonte.", "Each sentence on the cards points to a fact from the source."),
  tr("Todo número do texto aparece nos fatos.", "Every number in the text appears in the facts."),
  tr("O dia da semana citado bate com a data dos fatos.", "The day of the week mentioned matches the date in the facts."),
  tr("Manchete com até 90 caracteres; os textos cabem nos cards.", "Headline of up to 90 characters; the text fits on the cards."),
];

/**
 * "Validação ok" abre as checagens (DESIGN.md §7). Aviso fica à vista, em âmbar; nunca recolhido. Edição que reprovou:
 * o motivo de cada card, em linguagem de leigo, e o caminho para corrigir.
 */
function ValidacaoLinha({ validacao, frases, fatos, cards, editar }: { validacao: Validacao; frases: number; fatos: number; cards: CardTexto[]; editar?: () => void }) {
  if (!validacao) return null;
  const avisos = validacao.avisos ?? [];
  if (!validacao.ok) {
    const normais = normalizarCards(cards as Card[]);
    const porCard = Object.entries(tr(validacao.porCard, validacao.en?.porCard ?? validacao.porCard) ?? {});
    const geral = tr(validacao.geral, validacao.en?.geral ?? validacao.geral) ?? [];
    return (
      <div className="faixa-erro" role="alert">
        <b>{tr(`A conferência apontou problemas${porCard.length ? " nos cards" : ""}`, `The check found problems${porCard.length ? " on the cards" : ""}`)}</b>
        <ul className="m-0 mt-1 pl-5">
          {geral.map((m) => <li key={m}>{m}</li>)}
          {porCard.length || geral.length
            ? porCard.flatMap(([id, motivos]) => {
                const i = normais.findIndex((c) => c.id === id);
                return motivos.map((m) => <li key={id + m}>Card {i + 1}{i >= 0 ? ` (${tr(NOME_LAYOUT[normais[i].layout], NOME_LAYOUT_EN[normais[i].layout])})` : ""}: {m}</li>);
              })
            : (validacao.erros ?? []).map((e) => <li key={e}>{e}</li>)}
        </ul>
        {editar && <button type="button" onClick={editar} className="mt-1 min-h-11 font-bold underline underline-offset-3">{tr("Corrigir nos cards", "Fix it on the cards")}</button>}
      </div>
    );
  }
  return (
    <div className="grid gap-2">
      <details className="group">
        <summary className="conf-validacao min-h-11 list-none leading-[1.3] [&::-webkit-details-marker]:hidden">
          <VistoLapis className="text-verde" seed={4} />
          <span><b>{tr("Validação ok", "Check passed")}</b> · {linhaValidacao(frases, fatos, avisos.length)}</span>
          <IconeSeta className="ml-auto size-4 flex-none transition-transform group-open:rotate-180" />
        </summary>
        <div className="px-3 pt-2.5">
          <ul className="fatos">{CHECAGENS().map((c) => <li key={c}><IconeCerto className="size-3.5" /><span>{c}</span></li>)}</ul>
          <p className="ajuda m-0 mt-2">{tr("Conferência automática, sem IA. Não substitui a sua leitura.", "Automatic check, no AI. It doesn't replace your own reading.")}</p>
        </div>
      </details>
      {avisos.map((a) => <p key={a} className="faixa-aviso m-0">{tr("Aviso", "Warning")}: {a}</p>)}
    </div>
  );
}

const ehLink = (url: string | null | undefined): url is string => !!url && /^https?:\/\//.test(url);

/** A fonte de um fato: o nome com o link (abre em outra aba) ou, sem link, só o nome; `null` quando o fato não diz de onde veio. */
function fonteDoFato(fato: Fato): ReactNode {
  if (ehLink(fato.url)) {
    return (
      <a href={fato.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
        {fato.fonteTitulo ?? fato.fonte ?? new URL(fato.url).hostname}<span className="sr-only">{tr(" (abre em outra aba)", " (opens in a new tab)")}</span>
      </a>
    );
  }
  return fato.fonte ?? null;
}

/**
 * Frases e fontes: cada frase dos cards com o fato a que está presa, a fonte (com o link) e, ao apontar, focar ou tocar,
 * o trecho que a sustenta. Apontar leva o palco ao card da frase e, onde ela foi medida, marca a frase na arte. Entra
 * no lugar de "Fatos usados" e de "De onde veio cada frase" (posts da Matéria: o trecho literal da página do dossiê, ou
 * "afirmação do autor"). Post vindo de print (+ Nova): o aviso com a imagem, uma vez só.
 */
function FrasesFontes({ linhas, materia, print, ativa, mostrar, noPalco }: {
  linhas: Linha[]; materia: boolean; print: string | null; ativa: number | null; mostrar: (n: number | null) => void; noPalco: boolean;
}) {
  return (
    <section aria-labelledby="rv-frases" className="grid gap-2">
      <div className="secao">
        <h2 id="rv-frases" className="m-0">{tr("Frases e fontes", "Sentences and sources")}</h2>
        {noPalco && <span aria-hidden="true" className="hidden [@media(hover:hover)]:inline">{tr("aponte para ver na arte", "point to see it on the art")}</span>}
      </div>
      {print && (
        <p className="faixa-aviso m-0">
          {tr("O texto destes fatos foi lido de um print por um modelo. Confira com a imagem antes de aprovar.", "The text of these facts was read from a screenshot by a model. Check it against the image before you approve.")}{" "}
          <a href={print} target="_blank" rel="noopener noreferrer" className="font-bold underline underline-offset-3">
            {tr("Ver o print", "See the screenshot")}<span className="sr-only">{tr(" (abre em outra aba)", " (opens in a new tab)")}</span>
          </a>
        </p>
      )}
      {/* A lista inteira responde ao ponteiro; o botão de cada frase é o caminho do teclado e do leitor de tela. */}
      <ol className="frases" onMouseLeave={() => mostrar(null)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) mostrar(null); }}>
        {linhas.map((l, n) => {
          const f = l.fato;
          // Post da Matéria: sem o trecho da página do dossiê, a frase é do autor (com ou sem fato).
          const doAutor = materia ? !f?.evidencia : !f && l.autor;
          return (
            <li key={n} className="frase" data-on={n === ativa ? "" : undefined} onMouseEnter={() => mostrar(n)} onFocus={() => mostrar(n)} onClick={() => mostrar(n)}>
              <span aria-hidden="true" className="frase-n">{n + 1}</span>
              <button type="button" data-linha aria-describedby={`rv-frase-${n}`} className="cursor-pointer text-left"><q>{l.texto}</q></button>
              <span id={`rv-frase-${n}`} className="frase-fonte">
                {doAutor ? (
                  <span className="estado text-apoio"><span>{tr("sem evidência: afirmação do autor", "no evidence: the author's own claim")}{f && ehLink(f.url) ? <> · {fonteDoFato(f)}</> : null}</span></span>
                ) : f ? (
                  <span className="estado estado-ok"><IconeCerto className="size-[13px]" /><span>{tr("presa a", "tied to")}: {fonteDoFato(f) ?? tr("um fato da ideia", "a fact from the idea")}</span></span>
                ) : (
                  <span className="estado estado-aviso"><IconeAlerta className="size-[13px]" /><span>{tr("sem fato da fonte", "no fact from the source")}</span></span>
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

/** Legenda em 3 linhas com "ver inteira" e "copiar" (revisão e publicar). */
export function Legenda({ texto, id = "rv-legenda" }: { texto: string; id?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [inteira, setInteira] = useState(false);
  const [corta, setCorta] = useState(false);
  const [copia, setCopia] = useState<"ok" | "falhou" | null>(null);
  // "ver inteira" só quando as 3 linhas cortam o texto de verdade.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || inteira) return;
    const medir = () => setCorta(el.scrollHeight > el.clientHeight + 1);
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, [inteira, texto]);
  useEffect(() => {
    if (!copia) return;
    const i = setTimeout(() => setCopia(null), 2500);
    return () => clearTimeout(i);
  }, [copia]);
  const copiar = async () => {
    try { await navigator.clipboard.writeText(texto); setCopia("ok"); } catch { setCopia("falhou"); }
  };
  return (
    <section aria-labelledby={id}>
      <div className="mb-2 flex items-baseline justify-between gap-3 border-t border-fio-forte pt-2.5">
        <h2 id={id} className="mono m-0 text-[11.5px] font-normal tracking-[.08em] uppercase">{tr("Legenda", "Caption")}</h2>
        <button type="button" onClick={copiar} className="link-acao -my-3 inline-flex min-h-11 min-w-11 items-center justify-center text-[15px]">
          {copia === "ok" ? tr("copiada", "copied") : tr("copiar", "copy")}
        </button>
      </div>
      <p role="status" className="sr-only">{copia === "ok" ? tr("Legenda copiada.", "Caption copied.") : copia === "falhou" ? tr("Não deu para copiar a legenda.", "Couldn't copy the caption.") : ""}</p>
      <p ref={ref} id={`${id}-texto`} className={`m-0 whitespace-pre-line ${inteira ? "" : "line-clamp-3"}`}>{texto}</p>
      {(corta || inteira) && (
        <button type="button" onClick={() => setInteira((v) => !v)} aria-expanded={inteira} aria-controls={`${id}-texto`}
          className="link-acao mt-1 min-h-11 text-[15px]">
          {inteira ? tr("ver menos", "show less") : tr("ver inteira", "show all")}
        </button>
      )}
    </section>
  );
}

/** Os fatos da ideia, para o post antigo em que nenhuma frase está presa a um fato (aí "Frases e fontes" não os mostra). */
function Fatos({ fatos, fontes }: { fatos: Fato[]; fontes: string[] }) {
  // Post vindo de print (+ Nova): o texto foi lido da imagem por um modelo; a imagem fica a um toque, uma vez só.
  const print = fatos.find((f) => f.print)?.print;
  return (
    <details className="group">
      <summary className="secao m-0 min-h-11 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        {tr("Fatos usados", "Facts used")}
        <span className="flex items-center gap-1 text-apoio normal-case">
          {fatos.length}{fontes.length ? ` · ${fontes.join(", ")}` : ""}
          <IconeSeta className="size-4 transition-transform group-open:rotate-180" />
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
        {fatos.map((f) => (
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

// ── barra de decisão ────────────────────────────────────────────────────────────────────────────────────────────

type Passo = "inicio" | "aprovar" | "reescrever" | "rejeitar";
/** `ir`: aprovado, abre o próximo da fila. `ponteiro`: a decisão veio do ponteiro (aí o carimbo bate antes de a tela seguir). */
type Decisao = { corpo: Record<string, unknown>; ir: boolean; ponteiro: boolean };

/** Sem conta do Instagram: a saída (Veículo › Contas) para o admin, e a quem pedir para os outros. */
function SemConta() {
  const { veiculo } = useCasca();
  const membros = useMembros(veiculo.id);
  const admins = (membros.data?.membros ?? []).filter((m) => m.papel === "admin").map((m) => m.nome);
  return (
    <>
      {notaSemConta({ admin: veiculo.papel === "admin", admins })}{" "}
      <Link to={`/t/${veiculo.slug}/veiculo?aba=contas`} className="link-acao">{tr("Veículo › Contas", "Publication › Accounts")}</Link>.
    </>
  );
}

/** A tecla do atalho, dentro do botão (só no computador; o nome do botão continua sendo só o texto). */
const Tecla = ({ k }: { k: string }) => <span aria-hidden="true" className="kbd max-lg:hidden">{k}</span>;

/** Quanto o carimbo "Aprovado" fica na prova antes de a tela seguir (a batida leva 200 ms). */
const CARIMBO_MS = 400;

/**
 * A decisão, presa ao pé da folha (o padrão "barra presa" do §9). À esquerda, no computador, a frase fixa do que o
 * Aprovar faz e as dicas de atalho; à direita, Rejeitar, Reescrever e Aprovar. O passo abre dentro da barra, que cresce
 * para cima, e os seus botões ficam onde estavam os três: uma decisão à vista de cada vez. Na revisão a casca tira a
 * navegação de baixo do celular, então a barra desce até o pé da tela.
 */
function Barra({ s, bloqueada, reels = false, doSite = false, carimbar }: { s: StatusPeca; bloqueada: boolean; reels?: boolean; doSite?: boolean; carimbar: () => void }) {
  const { veiculo } = useCasca();
  const navegar = useNavigate();
  const pecas = usePecas(veiculo.id);
  const todas = useContas(veiculo.id);
  // O Reels ainda não sai pelo intermediário: essas contas não aparecem para ele (nem como padrão).
  const contas = reels && todas.data ? { ...todas, data: { ...todas.data, contas: todas.data.contas.filter((c) => c.modo !== "intermediario") } } : todas;
  const reescrever = !reels;
  const membros = useMembros(veiculo.id);
  const qc = useQueryClient();
  const [passo, setPasso] = useState<Passo>("inicio");
  const botoes = { aprovar: useRef<HTMLButtonElement>(null), reescrever: useRef<HTMLButtonElement>(null), rejeitar: useRef<HTMLButtonElement>(null) };
  const voltou = useRef<Exclude<Passo, "inicio"> | null>(null);
  const fila = (pecas.data?.pecas ?? []).filter((p) => p.status === "revisao");
  // Decidido: o status deste post muda (a tela segue por ele) e as listas ficam velhas.
  const atualizar = () => {
    qc.invalidateQueries({ queryKey: chaves.status(veiculo.id, s.id) });
    qc.invalidateQueries({ queryKey: chaves.pecas(veiculo.id) });
    qc.invalidateQueries({ queryKey: chaves.prontos(veiculo.id) });
    qc.invalidateQueries({ queryKey: chaves.pautas(veiculo.id) });
  };
  // A pessoa saiu desta tela (a resposta ainda vinha, ou o carimbo ainda estava na prova): as listas atualizam do mesmo
  // jeito, na hora, mas ninguém a leva para outro post.
  const naTela = useRef(true);
  const espera = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const atualizarAgora = useRef(atualizar);
  atualizarAgora.current = atualizar;
  useEffect(() => {
    naTela.current = true;
    return () => {
      naTela.current = false;
      if (espera.current !== undefined) { clearTimeout(espera.current); espera.current = undefined; atualizarAgora.current(); }
    };
  }, []);
  const seguir = (ir: boolean) => {
    atualizar();
    if (!ir || !naTela.current) return;
    const proximo = fila[fila.findIndex((p) => p.id === s.id) + 1] ?? fila.find((p) => p.id !== s.id);
    navegar(proximo ? `/t/${veiculo.slug}/p/${proximo.id}` : `/t/${veiculo.slug}/aprovar`);
  };
  const decidir = useMutation({
    // Manda a versão que está na tela: se outra chegou no meio, a API recusa (409) em vez de decidir às cegas.
    mutationFn: ({ corpo }: Decisao) =>
      ler(t.revisao.$post({ param: { tenantId: veiculo.id, id: s.id } }, corpoJson({ ...corpo, versao: s.versao }))),
    onSuccess: (_r, { corpo, ir, ponteiro }) => {
      // Aprovado com o ponteiro, no computador (onde o carimbo aparece) e com movimento: o carimbo bate na prova e só
      // então a tela segue. Pelo teclado, ou com menos movimento, segue na hora (DESIGN.md §12).
      const bate = naTela.current && corpo.decisao === "aprovar" && ponteiro && matchMedia("(min-width: 1024px)").matches && !matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!bate) return seguir(ir);
      carimbar();
      espera.current = setTimeout(() => { espera.current = undefined; seguir(ir); }, CARIMBO_MS);
    },
    onError: (e) => {
      if (e instanceof ErroApi && e.status === 409) {
        qc.invalidateQueries({ queryKey: chaves.status(veiculo.id, s.id) });
        qc.invalidateQueries({ queryKey: chaves.contas(veiculo.id) });
      }
    },
  });
  const enviar = (corpo: Record<string, unknown>, ir = false) => decidir.mutate({ corpo, ir, ponteiro: !veioDoTeclado() });
  const abrir = (p: Exclude<Passo, "inicio">) => { decidir.reset(); setPasso(p); };
  const voltar = () => { if (passo !== "inicio") voltou.current = passo; decidir.reset(); setPasso("inicio"); };
  // Ao cancelar, o foco volta ao botão que abriu o passo.
  useEffect(() => {
    if (passo === "inicio" && voltou.current) { botoes[voltou.current].current?.focus(); voltou.current = null; }
  });
  const ocupado = decidir.isPending || decidir.isSuccess;
  const padrao = contas.data?.contas[0];
  const semConta = contas.isSuccess && !padrao;
  const aprovarBarrado = semConta || bloqueada;
  // Matéria do site, conferida, com uma conta só: não há o que escolher, aprova aqui e abre o próximo. O atalho A só abre.
  const umToque = doSite && !bloqueada && contas.data?.contas.length === 1;
  // A, E e X abrem o passo (aprovar, reescrever, rejeitar), fora de campo de texto: quem confere leva a mão ao teclado,
  // não ao mouse. Abrir o passo não decide nada: a decisão continua sendo o botão do passo.
  const podeDecidir = veiculo.papel !== "reporter" && passo === "inicio";
  useEffect(() => {
    if (!podeDecidir) return;
    const tecla = (e: KeyboardEvent) => {
      if (!atalhoLivre(e)) return;
      const k = e.key.toLowerCase();
      if (k === "a" && !aprovarBarrado) { e.preventDefault(); abrir("aprovar"); }
      else if (k === "e" && reescrever) { e.preventDefault(); abrir("reescrever"); }
      else if (k === "x") { e.preventDefault(); abrir("rejeitar"); }
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  });

  // A frase fixa (o que o Aprovar faz, ou por que ele espera) e as dicas de atalho. No celular a frase só aparece quando
  // é trava (conferência, sem conta) ou quando o Aprovar decide num toque só: no resto, o passo diz a conta e a hora.
  // No computador ela cede a largura aos botões (quebra em duas linhas) em vez de empurrá-los para a linha de baixo.
  const nota = (
    <div className={`decisao-nota lg:min-w-[260px] lg:flex-1 ${bloqueada || semConta || umToque ? "grid" : ""}`}>
      <p id="rv-nota-aprovar">
        {bloqueada ? <span className="text-terracota">{tr("Aprovar espera: corrija os cards que a conferência apontou e salve de novo.", "Approval is on hold: fix the cards the check flagged and save again.")}</span>
          : contas.isSuccess ? (padrao ? notaAprovar(padrao) : <SemConta />) : contas.isError ? tr("Aprovar: você escolhe a conta no próximo passo.", "Approve: you choose the account in the next step.") : ""}
      </p>
      <div aria-hidden="true" className="dicas">
        <span><span className="kbd">←</span><span className="kbd">→</span> {tr("cards", "cards")}</span>
        {fila.length > 1 && <span><span className="kbd">J</span><span className="kbd">K</span> {tr("fila", "queue")}</span>}
      </div>
    </div>
  );

  let corpo: ReactNode;
  if (veiculo.papel === "reporter") {
    corpo = <p className="m-0 text-[15px]">{quemDecide(membros.data?.membros ?? [])}</p>;
  } else if (passo === "aprovar") {
    corpo = <PassoAprovar contas={contas} ocupado={ocupado} voltar={voltar} enviar={(c) => enviar({ decisao: "aprovar", ...c })} erro={decidir.error} nota={nota} />;
  } else if (passo === "reescrever") {
    corpo = <PassoReescrever rodada={s.rodada} ocupado={ocupado} voltar={voltar} enviar={(instrucao) => enviar({ decisao: "reescrever", instrucao })} erro={decidir.error} nota={nota} />;
  } else if (passo === "rejeitar") {
    corpo = <PassoRejeitar ocupado={ocupado} voltar={voltar} enviar={(motivo) => enviar({ decisao: "rejeitar", motivo })} erro={decidir.error} nota={nota} />;
  } else {
    corpo = (
      <>
        <div className="decisao-linha">
          {nota}
          <div className="decisao-botoes flex-wrap">
            <button ref={botoes.rejeitar} type="button" onClick={() => abrir("rejeitar")} aria-keyshortcuts="X" className="btn-sec px-3 text-terracota max-lg:-ml-2">{tr("Rejeitar", "Reject")}<Tecla k="X" /></button>
            {reescrever && <button ref={botoes.reescrever} type="button" onClick={() => abrir("reescrever")} aria-keyshortcuts="E" className="btn-sec px-3">{tr("Reescrever", "Rewrite")}<Tecla k="E" /></button>}
            <button ref={botoes.aprovar} type="button" onClick={() => abrir("aprovar")} disabled={aprovarBarrado}
              aria-describedby="rv-nota-aprovar" aria-keyshortcuts="A" className="btn-tinta disabled:cursor-not-allowed">
              <VistoLapis className="text-sobre-tinta" seed={9} /> {tr("Aprovar", "Approve")}<Tecla k="A" />
            </button>
            {umToque && (
              <button type="button" onClick={() => enviar({ decisao: "aprovar", contaId: padrao!.id }, true)} disabled={ocupado} className="btn-tinta max-lg:basis-full">
                <VistoLapis className="text-sobre-tinta" seed={9} /> {ocupado ? tr("Aprovando…", "Approving…") : tr("Aprovar e ir para a próxima", "Approve and go to the next")}
              </button>
            )}
          </div>
        </div>
        {umToque && decidir.isError && <p role="alert" className="faixa-erro m-0">{(decidir.error as Error).message}</p>}
      </>
    );
  }

  return (
    <aside aria-label={tr("Decisão", "Decision")}onKeyDown={(e) => { if (e.key === "Escape" && passo !== "inicio" && !ocupado) voltar(); }} className="barra-decisao bottom-[var(--pe)]">
      {/* Passo alto em tela baixa: a barra nunca passa do alto da tela (rola por dentro só nesse caso). */}
      <div className="max-h-[calc(100dvh_-_var(--topo)_-_96px)] overflow-y-auto pb-[calc(8px+env(safe-area-inset-bottom))] lg:pb-2.5">{corpo}</div>
    </aside>
  );
}

type PropsPasso = { ocupado: boolean; voltar: () => void; erro: Error | null; nota: ReactNode };

/** O pé de um passo aberto: a frase fixa à esquerda (computador) e, à direita, Cancelar e a decisão, onde estavam os três botões. */
function PePasso({ ocupado, voltar, nota, children }: Omit<PropsPasso, "erro"> & { children?: ReactNode }) {
  return (
    <div className="decisao-linha">
      {nota}
      <div className="decisao-botoes">
        <button type="button" onClick={voltar} disabled={ocupado} className="btn-sec">{tr("Cancelar", "Cancel")}</button>
        {children}
      </div>
    </div>
  );
}

const ErroPasso = ({ erro }: { erro: Error | null }) => (erro ? <p role="alert" className="m-0 text-[15px] text-terracota">{mensagemDecisao(erro as ErroApi)}</p> : null);

/** Foca o elemento ao abrir o passo (título, ou o campo quando ele é obrigatório). */
function useFocarAoAbrir<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return ref;
}

/** Motivos prontos: cada um entra no campo, junto do que já estiver escrito, e sai com outro toque. */
function Motivos({ motivos, valor, mudar }: { motivos: string[]; valor: string; mudar: (v: string) => void }) {
  const partes = valor.split(";").map((p) => p.trim()).filter(Boolean);
  return (
    <div role="group" aria-label={tr("Motivos prontos", "Ready-made reasons")} className="flex flex-wrap gap-1.5">
      {motivos.map((m) => {
        const posto = partes.includes(m);
        return <button key={m} type="button" aria-pressed={posto} onClick={() => mudar((posto ? partes.filter((p) => p !== m) : [...partes, m]).join("; "))} className="chip">{m}</button>;
      })}
    </div>
  );
}

function PassoAprovar({ contas, enviar, ...p }: PropsPasso & { contas: ReturnType<typeof useContas>; enviar: (c: { contaId: string; agendarPara?: string }) => void }) {
  const titulo = useFocarAoAbrir<HTMLHeadingElement>();
  const lista = contas.data?.contas ?? [];
  const [contaId, setContaId] = useState<string | undefined>(undefined);
  const [agendar, setAgendar] = useState(false);
  const [horario, setHorario] = useState("");
  const [traco, setTraco] = useState(0);
  const [erroHorario, setErroHorario] = useState(false);
  const conta: Conta | undefined = lista.find((c) => c.id === contaId) ?? lista[0];
  const manual = conta?.modo === "manual";

  const confirmar = (e: FormEvent) => {
    e.preventDefault();
    if (!conta) return;
    const agendarPara = agendar ? horarioAgendado(horario) : null;
    if (agendar && !agendarPara) { setErroHorario(true); return; }
    setTraco((n) => n + 1);
    enviar({ contaId: conta.id, ...(agendarPara ? { agendarPara } : {}) });
  };

  return (
    <form onSubmit={confirmar} className="grid gap-3" noValidate>
      <div className="decisao-passo">
        <h2 ref={titulo} tabIndex={-1} className="m-0 text-[18px] font-bold text-texto-forte">{tr("Aprovar este post", "Approve this post")}</h2>
        {contas.isPending ? (
          <p className="m-0 text-apoio" role="status">{tr("Carregando as contas…", "Loading the accounts…")}</p>
        ) : contas.isError ? (
          <FalhaCarga oque={tr("as contas", "the accounts")} tentar={() => contas.refetch()} />
        ) : !lista.length ? (
          <p className="m-0"><SemConta /></p>
        ) : (
          <>
            {lista.length > 1 ? (
              <fieldset className="m-0 grid gap-1 border-0 p-0">
                <legend className="mb-1 p-0 text-[15px] font-bold text-texto-forte">{tr("Onde postar", "Where to post")}</legend>
                {lista.map((c) => (
                  <label key={c.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-btn px-2 hover:bg-papel-2">
                    <input type="radio" name="conta" value={c.id} checked={c.id === conta?.id} onChange={() => setContaId(c.id)} className="size-[18px] accent-[var(--color-tinta)]" />
                    <span><b className="text-texto-forte">{nomeConta(c)}</b> <span className="text-apoio">· {comoPosta(c.modo, c.provedor)}</span></span>
                  </label>
                ))}
              </fieldset>
            ) : (
              <p className="m-0">{tr("Em", "On")} <b className="text-texto-forte">{nomeConta(lista[0])}</b> <span className="text-apoio">· {comoPosta(lista[0].modo, lista[0].provedor)}</span></p>
            )}
            <fieldset className="m-0 grid gap-1 border-0 p-0">
              <legend className="mb-1 p-0 text-[15px] font-bold text-texto-forte">{tr("Quando", "When")}</legend>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-btn px-2 hover:bg-papel-2">
                <input type="radio" name="quando" checked={!agendar} onChange={() => setAgendar(false)} className="size-[18px] accent-[var(--color-tinta)]" />
                <span>{manual ? tr("Sem horário", "No set time") : tr("Agora", "Now")} <span className="text-apoio">· {manual ? tr("você posta quando puder", "you post when you can") : tr("posta logo depois de aprovar", "posts right after you approve")}</span></span>
              </label>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-btn px-2 hover:bg-papel-2">
                <input type="radio" name="quando" checked={agendar} onChange={() => setAgendar(true)} className="size-[18px] accent-[var(--color-tinta)]" />
                <span>{manual ? tr("Anotar horário", "Note a time") : tr("Marcar horário", "Schedule a time")} <span className="text-apoio">· {manual ? tr("só um lembrete: você posta à mão", "just a reminder: you post it by hand") : tr("posta sozinho na hora", "posts on its own at that time")}</span></span>
              </label>
              {agendar && (
                <label className="campo mt-1 pl-2">
                  <span className="sr-only">{tr("Dia e hora", "Date and time")}</span>
                  <input type="datetime-local" value={horario} onChange={(e) => { setHorario(e.target.value); setErroHorario(false); }}
                    aria-invalid={erroHorario} aria-describedby={erroHorario ? "rv-horario-erro" : undefined} className="entrada" />
                  {erroHorario && <span id="rv-horario-erro" className="text-[14px] text-terracota">{tr("Escolha um dia e hora daqui para a frente.", "Choose a date and time in the future.")}</span>}
                </label>
              )}
            </fieldset>
          </>
        )}
        <ErroPasso erro={p.erro} />
      </div>
      <PePasso {...p}>
        <button type="submit" disabled={p.ocupado || !conta} className="btn-tinta">
          <VistoLapis key={traco} desenhar={traco > 0} className="text-sobre-tinta" seed={9} /> {p.ocupado ? tr("Aprovando…", "Approving…") : tr("Aprovar", "Approve")}
        </button>
      </PePasso>
    </form>
  );
}

function PassoReescrever({ rodada, enviar, ...p }: PropsPasso & { rodada: number; enviar: (instrucao: string) => void }) {
  const titulo = useFocarAoAbrir<HTMLHeadingElement>();
  const [instrucao, setInstrucao] = useState("");
  const esgotou = rodada >= MAX_VERSOES;
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (!esgotou) enviar(instrucao.trim()); }} className="grid gap-3">
      <div className="decisao-passo">
        <h2 ref={titulo} tabIndex={-1} className="m-0 flex items-baseline gap-3 text-[18px] font-bold text-texto-forte">
          {tr("Reescrever", "Rewrite")} {!esgotou && <span className="mono font-normal text-apoio">{tr(`cria a versão ${rodada + 1} de ${MAX_VERSOES}`, `creates version ${rodada + 1} of ${MAX_VERSOES}`)}</span>}
        </h2>
        {esgotou ? (
          <p className="m-0">{tr(`Já são ${MAX_VERSOES} versões deste post. Aprove ou rejeite esta.`, `This post already has ${MAX_VERSOES} versions. Approve or reject this one.`)}</p>
        ) : (
          <>
            <div className="campo">
              <label htmlFor="rv-instrucao" className="text-[15px] font-bold text-texto-forte">{tr("O que mudar?", "What should change?")} <span className="font-normal text-apoio">{tr("(opcional)", "(optional)")}</span></label>
              <Motivos motivos={[tr("Mais curto", "Shorter"), tr("Outro ângulo", "Another angle"), tr("Tom mais sóbrio", "A more sober tone"), tr("Trocar a manchete", "Change the headline")]}
                valor={instrucao} mudar={(v) => setInstrucao(v.slice(0, 1000))} />
              <textarea id="rv-instrucao" value={instrucao} onChange={(e) => setInstrucao(e.target.value)} maxLength={1000} rows={2} autoCapitalize="sentences" enterKeyHint="enter"
                placeholder={tr("Ex.: manchete mais curta; dizer o horário da liberação", "E.g.: a shorter headline; say what time it reopens")} className="entrada resize-y" />
            </div>
            <p className="ajuda m-0">{tr("O texto é escrito de novo e conferido com as fontes. Leva 1 ou 2 minutos.", "The text is written again and checked against the sources. It takes 1 or 2 minutes.")}</p>
          </>
        )}
        <ErroPasso erro={p.erro} />
      </div>
      <PePasso {...p}>
        {!esgotou && <button type="submit" disabled={p.ocupado} className="btn-tinta">{p.ocupado ? tr("Enviando…", "Sending…") : tr("Reescrever", "Rewrite")}</button>}
      </PePasso>
    </form>
  );
}

function PassoRejeitar({ enviar, ...p }: PropsPasso & { enviar: (motivo: string) => void }) {
  const campo = useFocarAoAbrir<HTMLTextAreaElement>();
  const [motivo, setMotivo] = useState("");
  const [faltou, setFaltou] = useState(false);
  const enviarMotivo = (e: FormEvent) => {
    e.preventDefault();
    if (motivo.trim().length < 3) { setFaltou(true); campo.current?.focus(); return; }
    enviar(motivo.trim());
  };
  return (
    <form onSubmit={enviarMotivo} className="grid gap-3" noValidate>
      <div className="decisao-passo">
        <h2 className="m-0 text-[18px] font-bold text-texto-forte">{tr("Rejeitar este post", "Reject this post")}</h2>
        <div className="campo">
          <label htmlFor="rv-motivo" className="text-[15px] font-bold text-texto-forte">{tr("Por quê?", "Why?")}</label>
          <Motivos motivos={[tr("Não é notícia para nós", "Not news for us"), tr("Já demos", "We already ran it"), tr("Fonte fraca", "Weak source")]}
            valor={motivo} mudar={(v) => { setMotivo(v.slice(0, 500)); setFaltou(false); }} />
          <textarea ref={campo} id="rv-motivo" value={motivo} onChange={(e) => { setMotivo(e.target.value); setFaltou(false); }} maxLength={500} rows={2} required autoCapitalize="sentences" enterKeyHint="enter"
            aria-invalid={faltou} aria-describedby="rv-motivo-ajuda" placeholder={tr("Ex.: notícia velha; fora da nossa área", "E.g.: old news; outside our area")} className="entrada resize-y" />
        </div>
        <p id="rv-motivo-ajuda" className={`m-0 text-[14px] ${faltou ? "text-terracota" : "text-apoio"}`}>
          {faltou ? tr("Escreva o motivo (uma frase basta).", "Write the reason (one sentence is enough).") : tr("A ideia sai da lista e o motivo fica registrado.", "The idea leaves the list and the reason is recorded.")}
        </p>
        <ErroPasso erro={p.erro} />
      </div>
      <PePasso {...p}>
        <button type="submit" disabled={p.ocupado} className="btn-tinta bg-terracota">{p.ocupado ? tr("Rejeitando…", "Rejecting…") : tr("Rejeitar", "Reject")}</button>
      </PePasso>
    </form>
  );
}

function Esqueleto({ id }: { id: string }) {
  return (
    <div aria-busy="true" className="rv-grade">
      <p role="status" className="sr-only">{tr("Carregando o post", "Loading the post")}</p>
      <FilaLado id={id} />
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
