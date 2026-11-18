// Ideias (a fila), rodada 4 (DESIGN.md §12). Em cima, "Agora": a próxima ação num bloco só (o post que espera há mais
// tempo, com a volta de lápis em "Revisar a próxima") e, ao lado, a fila curta (os posts seguintes e o que está
// produzindo, com a etapa). Embaixo, as ideias sugeridas em lista e, de 1180 px para cima, a folha de pauta da escolhida
// ao lado: os fatos que a fonte traz, o formato e, no pé preso, Produzir e Descartar. Abaixo de 1180 px não há folha:
// cada linha traz o resumo e as ações dela. A ideia escolhida mora na URL (`?ideia=`). A marca à mão é uma só: "Revisar
// a próxima" quando há post pronto; senão, o Produzir da ideia escolhida. O repórter só traz ideias: para ele, nenhuma
// marca à mão em ação que não é dele ("Ver" no lugar de "Revisar").
import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { api, ErroApi, corpoJson, ler } from "../api";
import { useCasca } from "../casca/contexto";
import type { Trazida } from "../casca/FolhaNova";
import { IconeCerto, Registro } from "../casca/icones";
import { FalhaCarga, atalhoLivre, useTitulo } from "../comum";
import {
  EDITORIA, ETAPAS, FORMATOS, avisoNova, chaves, cidadeDoFiltro, espera, filtrarPorCidade, hora, instante, marcarVisita, motivoFalha, novaDesde, quando,
  resumoVisita, rotuloArea, rotuloFormato, useAreas, useFontes, usePautas, usePecas, useStatusPeca, visitaAnterior, type Area, type Formato, type Pauta,
  type PecaFila,
} from "../fila";
import { t } from "../idioma";
import { NOME_ARTE, arteLembrada, lembrarArte, marcarArte } from "../kit/arteVT";
import { VoltaLapis } from "../kit/Lapis";
import { useMidia, useParte } from "../kit/Partes";
import { escada, useAquecer } from "../kit/Prova";
import { aquecerPost } from "../aquecer";
import type { Veiculo } from "../sessao";
import { AvisoLimite } from "./AvisoLimite";
import vazio1x from "../assets/vazio-ideias.webp";
import vazio2x from "../assets/vazio-ideias@2x.webp";

export default function Ideias() {
  const { veiculo } = useCasca();
  useTitulo(t("Ideias", "Ideas"), veiculo.nome);
  const pautas = usePautas(veiculo.id);
  const pecas = usePecas(veiculo.id);
  const anterior = visitaAnterior(veiculo.id);
  const carregou = pautas.isSuccess && pecas.isSuccess;
  useEffect(() => { if (carregou) marcarVisita(veiculo.id); }, [carregou, veiculo.id]);
  const podeProduzir = veiculo.papel !== "reporter";
  // Voltou da folha "Nova ideia": diz o que aconteceu e marca a ideia trazida.
  const trazida = (useLocation().state as { nova?: Trazida } | null)?.nova;

  // A API já ordena: pronto para aprovar primeiro (quem espera há mais tempo à frente), depois o que está produzindo.
  const andamento = pecas.data?.pecas ?? [];
  const todas = pautas.data?.pautas ?? [];
  // Veículo com mais de uma cidade: a cidade aparece em cada ideia e há um filtro (`?cidade=<ibge>`) acima da lista.
  const cobertura = useAreas(veiculo.id, veiculo.modo === "local");
  const areas = cobertura.data?.areas ?? [];
  const varias = areas.length > 1;
  const [params] = useSearchParams();
  const pedida = params.get("cidade");
  // Sem a cobertura carregada, o filtro da URL vale como está (não vira "todas" calado); falhou, a tela diz.
  const cidade = cobertura.isSuccess ? cidadeDoFiltro(pedida, areas) : pedida && /^\d{7}$/.test(pedida) ? pedida : null;
  const lista = filtrarPorCidade(todas, cidade);
  // Uma marca à mão por tela (DESIGN.md §4): com post pronto, a volta é do "Revisar a próxima"; sem, do Produzir da ideia escolhida.
  const lapisNoProduzir = podeProduzir && !andamento.some((p) => p.status === "revisao");
  // Contado no banco (a lista para em 50 posts e 100 ideias); na primeira visita, o total de ideias da fila.
  const resumo = carregou ? resumoVisita({
    anterior,
    prontas: pecas.data.prontasDesde ?? 0,
    novas: anterior === null ? todas.length : pautas.data.novasDesde ?? 0,
  }) : null;

  const qcResumo = useQueryClient();
  const resumir = useMutation({
    mutationFn: () => ler(api.t[":tenantId"].resumo.$post({ param: { tenantId: veiculo.id } })),
    onSuccess: () => { qcResumo.invalidateQueries({ queryKey: chaves.pecas(veiculo.id) }); qcResumo.invalidateQueries({ queryKey: chaves.pautas(veiculo.id) }); },
  });
  return (
    <div className="mx-auto max-w-[1280px] px-5 pt-6 pb-14 lg:px-12 lg:pt-3">
      {/* A data e a praça moram no fólio da casca (DESIGN.md §12): aqui, só o nome da tela, o que mudou e a ação do dia. */}
      <header className="mb-6 lg:mb-8">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h1 className="titulo-tela m-0 text-[32px] lg:text-[34px]">{t("Ideias", "Ideas")}</h1>
            {resumo && (
              <p className="mt-2 mb-0 text-[15px] text-apoio" role="status">
                <strong className="font-semibold text-texto-forte">{resumo.rotulo}</strong> {resumo.texto}
              </p>
            )}
          </div>
          {veiculo.papel !== "reporter" && veiculo.modo !== "autoral" && (
            <button type="button" className="btn-tom btn-p" disabled={resumir.isPending} onClick={() => resumir.mutate()}>
              <IconeResumo />
              {resumir.isPending ? t("Resumindo…", "Summing up…") : t("Resumir o dia", "Sum up the day")}
            </button>
          )}
        </div>
        {resumir.isSuccess && <p role="status" className="m-0 mt-2 text-verde">{resumir.data.situacao === "nova" ? t("O resumo do dia está sendo produzido e vai para Para aprovar.", "The daily roundup is being made and will go to To approve.") : t("O resumo de hoje já foi feito.", "Today's roundup is already done.")}</p>}
        {resumir.isError && <p role="alert" className="faixa-aviso m-0 mt-2">{(resumir.error as Error).message}</p>}
      </header>

      <AvisoFontes tenantId={veiculo.id} />
      {cidade && cobertura.isError && (
        <p role="alert" className="faixa-aviso mt-0 mb-6">
          {t("Não carregou as cidades do veículo: a lista mostra só a cidade escolhida.", "Couldn't load the publication's cities: the list shows only the chosen city.")}{" "}
          <button type="button" onClick={() => cobertura.refetch()} className="cursor-pointer font-bold underline">{t("Tentar de novo", "Try again")}</button>{" "}
          <Link to="?" className="font-bold underline">{t("Ver todas", "See all")}</Link>
        </p>
      )}
      {trazida && !todas.some((p) => p.id === trazida.pautaId) && (
        <p role="status" className="mt-0 mb-6 flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-faixa bg-papel-2 px-3 py-2.5 text-[15px] font-bold text-texto-forte">
          {avisoNova(trazida.situacao, trazida.status, trazida.peca?.status)}
          {trazida.peca && <Link to={`p/${trazida.peca.id}`} viewTransition className="link-acao">{t("Abrir o post", "Open the post")}</Link>}
        </p>
      )}

      {pautas.isPending || pecas.isPending ? (
        <Esqueleto />
      ) : pautas.isError || pecas.isError ? (
        <FalhaCarga oque={t("as ideias", "the ideas")} tentar={() => { pautas.refetch(); pecas.refetch(); }} />
      ) : !todas.length && !andamento.length ? (
        <Vazio />
      ) : (
        <div className="grid gap-[34px] [&>*]:min-w-0">
          {andamento.length > 0 && <Agora pecas={andamento} total={pecas.data!.total} decide={podeProduzir} />}
          {lista.length > 0
            ? <Sugeridas pautas={lista} anterior={anterior} podeProduzir={podeProduzir} lapis={lapisNoProduzir} trazida={trazida} mostrarCidade={varias}
                filtro={varias && todas.length > 0 ? <FiltroCidade areas={areas} cidade={cidade} /> : null} />
            : cidade
              ? <div className="grid gap-4">{varias && <FiltroCidade areas={areas} cidade={cidade} />}<p className="m-0 text-apoio">{t(`Nenhuma ideia de ${areas.find((a) => a.ibge === cidade)?.nome ?? "lá"} na lista agora.`, `No ideas from ${areas.find((a) => a.ibge === cidade)?.nome ?? "there"} in the list right now.`)} <Link to="?" className="link-acao">{t("Ver todas", "See all")}</Link></p></div>
              : <p className="m-0 text-apoio">{t("Nenhuma ideia nova na lista. As próximas chegam com a coleta das fontes, a cada 15 minutos.", "No new ideas in the list. More arrive as the sources are checked, every 15 minutes.")}</p>}
        </div>
      )}
    </div>
  );
}

/** Linhas de texto que encurtam: o resumo do dia junta as notícias numa peça só. */
function IconeResumo() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
      <path d="M5 6h14M5 10h14M5 14h9M5 18h6" />
    </svg>
  );
}

// ── agora: a próxima ação e a fila curta ────────────────────────────────────────────────────────────────────────

/** Quantos posts seguintes e quantos em produção aparecem na fila curta, ao lado da próxima ação. */
const NA_FILA = 3;

/**
 * A arte viaja até o palco da revisão e de volta (kit/arteVT): no clique, só a arte clicada leva o nome de transição; na
 * volta, a do post que foi aberto por último. `data-arte-vt` deixa o `marcarArte` tirar o nome que veio daqui.
 */
const viajar = (id: string) => (e: MouseEvent<HTMLAnchorElement>) => {
  marcarArte(e.currentTarget.querySelector<HTMLElement>("[data-arte]"));
  lembrarArte(id);
};
const nomeArte = (id: string) => (arteLembrada() === id ? { style: { viewTransitionName: NOME_ARTE }, "data-arte-vt": "" } : {});

const legendaPost = (p: PecaFila) => [EDITORIA[p.editoria ?? ""] ?? p.editoria, rotuloFormato(p.formato, p.ncards)].filter(Boolean).join(" · ");
/** "há 3 dias"; quem acabou de chegar é só "agora". */
const haQuanto = (sql: string) => { const e = espera(sql); return e === t("agora", "now") ? e : t(`há ${e}`, `${e} ago`); };

/**
 * O que pede você agora: à esquerda, o post que espera há mais tempo, num bloco só (a capa identifica; a conferência é na
 * revisão); à direita, a fila curta, com os posts seguintes e o que está produzindo. Com mais de quatro esperando, o
 * resto fica a um clique, em Para aprovar.
 */
function Agora({ pecas, total, decide }: { pecas: PecaFila[]; total: Record<string, number>; decide: boolean }) {
  const prontas = pecas.filter((p) => p.status === "revisao");
  // O que está produzindo, do mais antigo (o que chega primeiro) para o mais novo, como no card da lateral.
  const produzindo = pecas.filter((p) => p.status === "rascunho").sort((a, b) => instante(a.created_at) - instante(b.created_at));
  // Contado no banco: a lista para em 50.
  const esperam = Math.max(total.revisao ?? 0, prontas.length);
  const [proxima, ...resto] = prontas;
  const seguintes = resto.slice(0, NA_FILA);
  const emProducao = produzindo.slice(0, NA_FILA);
  const maisProduzindo = Math.max(total.rascunho ?? 0, produzindo.length) - emProducao.length;
  const temFila = seguintes.length + emProducao.length > 0;
  return (
    <section className="agora" aria-label={t("Agora", "Now")}>
      {proxima ? <Proxima peca={proxima} esperam={esperam} decide={decide} sozinha={!temFila} /> : (
        <div className="proxima">
          <span className="prova-arte shadow-[inset_0_0_0_1px_var(--color-fio-forte)]"><span aria-hidden="true" className="prova-vaga"><Registro /></span></span>
          <span className="proxima-corpo">
            <span className="lat-rotulo">{t("Mesa limpa", "Clear desk")}</span>
            <h2>{decide ? t("Nada esperando a sua revisão", "Nothing waiting for your review") : t("Nada esperando aprovação", "Nothing waiting for approval")}</h2>
            <span className="mono text-apoio">{t("O que está em produção chega aqui sozinho.", "What's in production lands here on its own.")}</span>
          </span>
        </div>
      )}
      {temFila && (
        <div className="fila-curta">
          <div className="secao mb-1.5">
            <h2 className="m-0">{t("Na fila", "In the queue")}</h2>
            {/* Alvo de 44 px no celular e 30 no computador, sem engordar a linha do título: a margem negativa devolve a altura. */}
            {esperam > NA_FILA + 1
              ? <Link to="aprovar" viewTransition className="link-acao relative z-[1] -my-4 inline-flex min-h-11 items-center tracking-[.01em] normal-case lg:-my-2 lg:min-h-[30px]">{t(`ver os ${esperam}`, `see all ${esperam}`)}</Link>
              : emProducao.length > 0 ? <span className="tracking-[.01em] text-apoio normal-case">{t("o que está produzindo chega aqui", "what's in production lands here")}</span> : null}
          </div>
          {seguintes.map((p, i) => <LinhaFila key={p.id} peca={p} n={i + 2} />)}
          {emProducao.map((p) => <LinhaProducao key={p.id} peca={p} />)}
          {maisProduzindo > 0 && <p className="mono m-0 mt-1.5 text-apoio">{t(`+${maisProduzindo} produzindo`, `+${maisProduzindo} in production`)}</p>}
        </div>
      )}
    </section>
  );
}

function Proxima({ peca: p, esperam, decide, sozinha }: { peca: PecaFila; esperam: number; decide: boolean; sozinha: boolean }) {
  const { veiculo } = useCasca();
  const qc = useQueryClient();
  const apontar = useAquecer(() => void aquecerPost(qc, veiculo.id, p.id));
  return (
    <Link to={`p/${p.id}`} viewTransition data-proxima={decide ? "" : undefined} className={`proxima ${sozinha ? "col-span-full" : ""}`} onClick={viajar(p.id)} {...apontar}>
      <span data-arte="" className="prova-arte corte" data-pilha={p.formato === "carrossel" ? "" : undefined} {...nomeArte(p.id)}>
        {p.capa ? <img src={p.capa} alt="" width={540} height={675} decoding="async" /> : <span aria-hidden="true" className="prova-vaga" />}
      </span>
      <span className="proxima-corpo">
        <span className="lat-rotulo">
          {decide ? t(`Para aprovar · ${esperam} ${esperam === 1 ? "espera" : "esperam"} você`, `To approve · ${esperam} waiting for you`) : t("Prontos para aprovar", "Ready to approve")}
        </span>
        <h2>{p.manchete ?? p.titulo}</h2>
        <span className="mono proxima-meta">
          <span>{legendaPost(p)}</span>
          <span>{t(`espera há ${espera(p.updated_at)}`, `waiting ${espera(p.updated_at)}`)}</span>
        </span>
        {decide
          ? <span className="acao-lapis -ml-[6px]"><span>{t("Revisar a próxima", "Review the next one")}</span><VoltaLapis desenhar /></span>
          : <span className="link-acao inline-flex min-h-11 items-center">{t("Ver", "View")}</span>}
      </span>
    </Link>
  );
}

function LinhaFila({ peca: p, n }: { peca: PecaFila; n: number }) {
  const { veiculo } = useCasca();
  const qc = useQueryClient();
  const apontar = useAquecer(() => void aquecerPost(qc, veiculo.id, p.id));
  return (
    <Link to={`p/${p.id}`} viewTransition className="fila-linha" onClick={viajar(p.id)} {...apontar}>
      <span aria-hidden="true" className="prova-n">{String(n).padStart(2, "0")}</span>
      <span data-arte="" className="fila-mini" data-vaga={p.capa ? undefined : ""} {...nomeArte(p.id)}>
        {p.capa && <img src={p.capa} alt="" width={68} height={85} loading="lazy" decoding="async" />}
      </span>
      <span className="min-w-0">
        <b>{p.manchete ?? p.titulo}</b>
        <span className="mono block truncate">{legendaPost(p)}</span>
      </span>
      <span className="mono">{haQuanto(p.updated_at)}</span>
    </Link>
  );
}

/** O post que está sendo produzido: a etapa vem do status leve, como no card "Em produção" da lateral. */
function LinhaProducao({ peca: p }: { peca: PecaFila }) {
  const { veiculo } = useCasca();
  const qc = useQueryClient();
  const status = useStatusPeca(veiculo.id, p.id);
  // Saiu do rascunho (ficou pronto ou falhou): as listas se atualizam já, sem esperar a próxima volta de 5 s.
  const acabou = !!status.data && status.data.status !== "rascunho";
  useEffect(() => {
    if (!acabou) return;
    qc.invalidateQueries({ queryKey: chaves.pecas(veiculo.id) });
    qc.invalidateQueries({ queryKey: chaves.pautas(veiculo.id) });
  }, [acabou, qc, veiculo.id]);
  const etapa = status.data?.etapa ?? null;
  const passo = acabou ? ETAPAS.length : etapa ? ETAPAS.indexOf(etapa) + 1 : 0;
  return (
    <Link to={`p/${p.id}`} viewTransition className="fila-linha">
      <span aria-hidden="true" className="prova-n bg-transparent text-apoio shadow-[inset_0_0_0_1px_var(--color-fio-forte)]">··</span>
      <span aria-hidden="true" className="fila-mini" data-vaga="" />
      <span className="min-w-0">
        <b>{p.manchete ?? p.titulo}</b>
        {/* As etapas em grafite (andamento não é ação): as feitas cheias, a de agora com o traço que corre. */}
        <span aria-hidden="true" className="etapas">
          {ETAPAS.map((e, i) => <i key={e} data-feita={acabou || i < passo - 1 ? "" : undefined} data-agora={!acabou && i === Math.max(passo - 1, 0) ? "" : undefined} />)}
        </span>
      </span>
      <span className="mono">{passo ? t(`etapa ${passo} de ${ETAPAS.length}`, `step ${passo} of ${ETAPAS.length}`) : t("começando", "starting")}</span>
    </Link>
  );
}

// ── filtro por cidade ───────────────────────────────────────────────────────────────────────────────────────────

function FiltroCidade({ areas, cidade }: { areas: Area[]; cidade: string | null }) {
  return (
    <nav aria-label={t("Cidade", "City")} className="flex flex-wrap items-center gap-1.5">
      <Link to="?" replace preventScrollReset aria-current={cidade === null ? "page" : undefined} className="chip">{t("Todas", "All")}</Link>
      {areas.map((a) => (
        <Link key={a.ibge} to={`?cidade=${a.ibge}`} replace preventScrollReset aria-current={cidade === a.ibge ? "page" : undefined} className="chip">
          {rotuloArea(a)}
        </Link>
      ))}
    </nav>
  );
}

// ── ideias sugeridas: a lista e a folha de pauta ────────────────────────────────────────────────────────────────

/** De 1180 px para cima a ideia escolhida abre na folha de pauta, ao lado da lista (rodada4.css esconde a folha abaixo disso). */
const COM_FOLHA = "(min-width: 1180px)";
/** Sem ideia nova, quantas ficam à vista antes de "Mais ideias": com a folha ao lado, a lista acompanha a altura dela. */
const A_VISTA = { lista: 6, coluna: 3 };

const origemDe = (p: Pauta) =>
  p.origem === "manual" ? t("trazida pela equipe", "brought in by the team") : p.origem === "site" ? t("do seu site", "from your site") : p.origem === "resumo" ? t("resumo do dia", "daily roundup") : null;
const editoriaDe = (p: Pauta) => EDITORIA[p.editoria ?? ""] ?? p.editoria;
const doisDigitos = (n: number) => String(n).padStart(2, "0");

/** O que cada formato produz: a ajuda de uma linha (abaixo de 1180 px) e a descrição de cada botão da folha saem daqui. */
const O_QUE_PRODUZ: Record<Formato, () => string> = {
  post: () => t("1 imagem com a manchete e 1 ou 2 frases", "1 image with the headline and 1 or 2 sentences"),
  carrossel: () => t("4 cards (capa, o que aconteceu, contexto, convite)", "4 cards (cover, what happened, context, invite card)"),
};

/** O que dá para fazer com uma ideia. O estado mora na lista (Sugeridas): a linha e a folha de pauta mostram o mesmo. */
type AcoesIdeia = {
  formato: Formato; trocarFormato: (f: Formato) => void;
  produzir: () => void; produzindo: boolean;
  confirmando: boolean; pedirDescarte: () => void; cancelarDescarte: () => void; descartar: () => void; descartando: boolean;
  erro: Error | null; ocupado: boolean;
};

function Sugeridas({ pautas, anterior, podeProduzir, lapis, trazida, mostrarCidade, filtro }:
  { pautas: Pauta[]; anterior: number | null; podeProduzir: boolean; lapis: boolean; trazida?: Trazida; mostrarCidade: boolean; filtro: ReactNode }) {
  const { veiculo } = useCasca();
  const navegar = useNavigate();
  const local = useLocation();
  const qc = useQueryClient();
  const comFolha = useMidia(COM_FOLHA);
  const novas = anterior === null ? [] : pautas.filter((p) => novaDesde(p.created_at, anterior));
  const vistas = anterior === null ? pautas : pautas.filter((p) => !novaDesde(p.created_at, anterior));
  // À vista, só o que pede decisão agora: as novas ou, sem nenhuma nova, as primeiras da lista. O resto fica numa linha com a contagem.
  // Vale na chegada: mudar a largura da janela não troca uma ideia de lista.
  const aVista = useRef(comFolha ? A_VISTA.lista : A_VISTA.coluna).current;
  const abertas = novas.length ? novas : vistas.slice(0, aVista);
  const fechadas = novas.length ? vistas : vistas.slice(aVista);
  const falhas = fechadas.filter((p) => p.falhou !== null).length;
  // A ideia escolhida mora na URL (`?ideia=`). Escolhida numa parte fechada, falha ou ideia trazida agora: a parte abre.
  const [params, setParams] = useSearchParams();
  const pedida = params.get("ideia");
  const [mais, abrirMais] = useParte("ideias", falhas || fechadas.some((p) => p.id === trazida?.pautaId || p.id === pedida) ? "todas" : null);
  const aberta = mais === "todas";
  const visiveis = aberta ? [...abertas, ...fechadas] : abertas;
  // Sem parâmetro, a primeira (ou a que acabou de ser trazida): a próxima ação nunca cai numa parte fechada.
  const escolhida = visiveis.find((p) => p.id === pedida) ?? visiveis.find((p) => p.id === trazida?.pautaId) ?? visiveis[0];

  // Formato e passo de descartar de cada ideia ficam aqui, acima da linha e da folha: cruzar 1180 px não perde nada.
  const [formatos, setFormatos] = useState<Record<string, Formato>>({});
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const escolher = (id: string) => {
    setConfirmando(null);
    setParams((p) => { p.set("ideia", id); return p; }, { replace: true, preventScrollReset: true, state: local.state });
  };
  const atualizar = () => Promise.all([
    qc.invalidateQueries({ queryKey: chaves.pautas(veiculo.id) }),
    qc.invalidateQueries({ queryKey: chaves.pecas(veiculo.id) }),
  ]);
  const produzir = useMutation({
    mutationFn: (v: { id: string; formato: Formato }) => ler(api.t[":tenantId"].pautas[":id"].produzir.$post({ param: { tenantId: veiculo.id, id: v.id } }, corpoJson({ formato: v.formato }))),
    onSuccess: (r) => { atualizar(); navegar(`p/${r.pecaId}`); },
    onError: (e) => { if (e instanceof ErroApi && e.status === 409) atualizar(); },
  });
  const descartar = useMutation({
    mutationFn: (id: string) => ler(api.t[":tenantId"].pautas[":id"].descartar.$post({ param: { tenantId: veiculo.id, id } }, corpoJson({}))),
    onSuccess: (_r, id) => {
      // Com a folha, a escolha passa para a vizinha (a de baixo; no fim da lista, a de cima), para descartar em sequência sem voltar ao topo.
      const i = visiveis.findIndex((p) => p.id === id);
      const vizinha = visiveis[i + 1] ?? visiveis[i - 1];
      if (comFolha && escolhida?.id === id && vizinha) escolher(vizinha.id); else setConfirmando((c) => (c === id ? null : c));
      atualizar();
    },
    onError: (e) => { if (e instanceof ErroApi && e.status === 409) atualizar(); },
  });
  const formatoDe = (id: string) => formatos[id] ?? "carrossel";
  const acoesDe = (p: Pauta): AcoesIdeia => ({
    formato: formatoDe(p.id),
    trocarFormato: (f) => setFormatos((m) => ({ ...m, [p.id]: f })),
    produzir: () => produzir.mutate({ id: p.id, formato: formatoDe(p.id) }),
    produzindo: produzir.isPending && produzir.variables.id === p.id,
    confirmando: confirmando === p.id,
    pedirDescarte: () => setConfirmando(p.id),
    cancelarDescarte: () => { setConfirmando(null); descartar.reset(); },
    descartar: () => descartar.mutate(p.id),
    descartando: descartar.isPending && descartar.variables === p.id,
    erro: (produzir.variables?.id === p.id ? produzir.error : null) ?? (descartar.variables === p.id ? descartar.error : null),
    ocupado: produzir.isPending || descartar.isPending || produzir.isSuccess,
  });

  // Atalhos de uma tecla (DESIGN.md §6.12), só onde há a folha de pauta: J/K e ↓/↑ andam na lista, 1 e 2 trocam o formato,
  // P leva o foco ao Produzir e X abre o passo de descartar (a letra abre; quem decide é o botão, com Enter).
  const botaoProduzir = useRef<HTMLButtonElement>(null);
  const atalho = useRef<(e: KeyboardEvent) => void>(() => {});
  atalho.current = (e) => {
    if (!comFolha || !escolhida || e.shiftKey) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const passo = k === "j" || k === "ArrowDown" ? 1 : k === "k" || k === "ArrowUp" ? -1 : 0;
    if (passo) {
      if (!atalhoLivre(e, true)) return;
      const vizinha = visiveis[visiveis.findIndex((p) => p.id === escolhida.id) + passo];
      if (!vizinha) return;   // no fim da lista, a seta volta a rolar a página
      e.preventDefault();
      escolher(vizinha.id);
      document.getElementById(`pauta-${vizinha.id}`)?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (!podeProduzir || !["p", "x", "1", "2"].includes(k) || !atalhoLivre(e)) return;
    e.preventDefault();
    if (k === "p") botaoProduzir.current?.focus();
    else if (k === "x") setConfirmando(escolhida.id);
    else setFormatos((m) => ({ ...m, [escolhida.id]: FORMATOS[k === "1" ? 0 : 1].valor }));
  };
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => atalho.current(e);
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, []);

  const fontes = useFontes(veiculo.id);
  const nFontes = fontes.data?.fontes.length ?? 0;
  const grupo = novas.length
    ? { id: "novas", titulo: t("Ideias novas", "New ideas"), lado: t(`${novas.length} desde a última visita`, `${novas.length} since your last visit`) }
    : {
        id: "vistas", titulo: t("Ideias sugeridas", "Suggested ideas"),
        lado: nFontes ? [
          t(`de ${nFontes} ${nFontes === 1 ? "fonte" : "fontes"}`, `from ${nFontes} ${nFontes === 1 ? "source" : "sources"}`),
          fontes.data?.coletaEm ? t(`coleta ${hora(fontes.data.coletaEm)}`, `fetched ${hora(fontes.data.coletaEm)}`) : null,
        ].filter(Boolean).join(" · ") : "",
      };
  let n = 0;
  const linha = (p: Pauta) => {
    n += 1;
    const atual = p.id === escolhida?.id;
    return <LinhaPauta key={p.id} pauta={p} numero={n} nova={novaDesde(p.created_at, anterior)} atual={atual} comFolha={comFolha} escolher={() => escolher(p.id)}
      acoes={acoesDe(p)} podeProduzir={podeProduzir} lapis={lapis && atual} mostrarCidade={mostrarCidade}
      aviso={p.id === trazida?.pautaId ? avisoNova(trazida.situacao, trazida.status) : undefined} />;
  };
  const contagem = fechadas.length === 1 ? t("1 ideia", "1 idea") : t(`${fechadas.length} ideias`, `${fechadas.length} ideas`);
  return (
    <section aria-labelledby={`grupo-${grupo.id}`}>
      <h2 id={`grupo-${grupo.id}`} className="secao m-0">{grupo.titulo} <span className="tracking-[.01em] text-apoio normal-case">{grupo.lado}</span></h2>
      {/* A barra da lista: o filtro por cidade à esquerda; à direita, os atalhos (onde há a folha) ou o que cada formato produz. */}
      <div className="barra-lista">
        <div>{filtro}</div>
        {podeProduzir && !comFolha && <p id="formato-ajuda" className="ajuda m-0 max-w-[62ch]">{FORMATOS.map((f) => `${f.rotulo}: ${O_QUE_PRODUZ[f.valor]()}`).join(" · ")}</p>}
        <p className="dicas m-0">
          <span><span className="kbd">J</span><span className="kbd">K</span> {t("andar", "move")}</span>
          {podeProduzir && (
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
          <ol className="pauta-lista">{abertas.map(linha)}</ol>
          {fechadas.length > 0 && (
            <>
              <h2 className="m-0">
                <button type="button" data-linha className="parte-linha" aria-expanded={aberta} aria-controls={aberta ? "ideias-vistas" : undefined} onClick={() => abrirMais(aberta ? null : "todas")}>
                  <span>{novas.length ? t("Já vistas", "Already seen") : t("Mais ideias", "More ideas")}</span>
                  <span className={`mono ${falhas ? "text-terracota" : ""}`}>
                    {falhas ? t(`${contagem} · ${falhas === 1 ? "1 falhou" : `${falhas} falharam`}`, `${contagem} · ${falhas} failed`) : contagem} · {aberta ? t("recolher", "hide") : t("mostrar", "show")}
                  </span>
                </button>
              </h2>
              {aberta && <ol id="ideias-vistas" className="pauta-lista">{fechadas.map(linha)}</ol>}
            </>
          )}
        </div>
        {comFolha && escolhida && (
          <FolhaPauta pauta={escolhida} numero={visiveis.indexOf(escolhida) + 1} acoes={acoesDe(escolhida)} podeProduzir={podeProduzir} lapis={lapis} mostrarCidade={mostrarCidade}
            refProduzir={botaoProduzir} />
        )}
      </div>
    </section>
  );
}

const Publicidade = ({ pauta: p }: { pauta: Pauta }) => (
  <p className="m-0"><span className="carimbo">{t("Publicidade", "Advertisement")}</span>{p.anunciante ? <span className="mono ml-3 text-apoio">{p.anunciante}</span> : null}</p>
);
const Falhou = ({ motivo }: { motivo: string }) => (
  <p className="m-0 text-[15px] text-terracota">
    {t(`A última tentativa não deu certo: ${motivoFalha(motivo).replace(/\.$/, "").toLowerCase()}. Dá para produzir de novo.`,
      `The last attempt didn't work: ${motivoFalha(motivo).replace(/\.$/, "").toLowerCase()}. You can produce it again.`)}
  </p>
);

/**
 * Uma ideia na lista: número da fila, manchete, hora e a legenda em mono. Onde há a folha de pauta, a linha inteira
 * escolhe a ideia (o botão do título cobre a linha); abaixo de 1180 px, a linha traz o resumo e as ações dela.
 */
function LinhaPauta({ pauta: p, numero, nova, atual, comFolha, escolher, acoes, podeProduzir, lapis, aviso, mostrarCidade }: {
  pauta: Pauta; numero: number; nova: boolean; atual: boolean; comFolha: boolean; escolher: () => void; acoes: AcoesIdeia; podeProduzir: boolean; lapis: boolean;
  aviso?: string; mostrarCidade: boolean;
}) {
  const id = useId();
  const tituloId = `${id}-t`;
  // A ideia trazida pela folha "Nova ideia": diz o que aconteceu nela e rola até ela se estiver fora da tela (no
  // celular, os posts em andamento vêm antes).
  const item = useRef<HTMLLIElement>(null);
  const trazida = !!aviso;
  useEffect(() => {
    const r = item.current?.getBoundingClientRect();
    if (trazida && r && (r.top < 70 || r.top > innerHeight - 160)) item.current!.scrollIntoView({ block: "center" });
  }, [trazida]);
  const manchete = <>{nova && <span aria-hidden="true" className="nova-pt" />}{p.titulo}</>;
  return (
    <li ref={item} id={`pauta-${p.id}`} style={escada(numero - 1)} aria-current={comFolha && atual ? "true" : undefined}
      className="pauta-linha entra scroll-mt-[calc(var(--topo)+12px)] scroll-mb-4">
      <span aria-hidden="true" className="prova-n mt-0.5">{doisDigitos(numero)}</span>
      <h3 id={tituloId}>
        {comFolha ? <button type="button" data-linha aria-controls="folha-pauta" onClick={escolher}>{manchete}</button> : manchete}
      </h3>
      <span className="mono hora">{quando(p.created_at)}</span>
      <span className="mono meta">
        <span>
          {[origemDe(p), editoriaDe(p), p.fonte, mostrarCidade ? p.cidade : null, p.bairro, t(`${p.nfatos} ${p.nfatos === 1 ? "fato" : "fatos"}`, `${p.nfatos} ${p.nfatos === 1 ? "fact" : "facts"}`)]
            .filter(Boolean).join(" · ")}
        </span>
        {/* Com a folha, o motivo inteiro está nela; a linha só marca qual ideia falhou. */}
        {comFolha && p.falhou !== null && <span className="text-terracota">{t("a produção falhou", "production failed")}</span>}
      </span>
      {(aviso || p.tipo_post === "publicidade") && (
        <div className="grid justify-items-start gap-1.5 pt-0.5 [grid-column:2/-1]">
          {aviso && <p role="status" className="m-0 text-[14.5px] font-bold text-texto-forte">{aviso}</p>}
          {p.tipo_post === "publicidade" && <Publicidade pauta={p} />}
        </div>
      )}
      {!comFolha && (p.resumo || p.falhou !== null || podeProduzir) && (
        <div className="pauta-cel">
          {p.resumo && <p className="m-0 line-clamp-3 max-w-[70ch] text-[15.5px] text-texto">{p.resumo}</p>}
          {p.falhou !== null && <Falhou motivo={p.falhou} />}
          {podeProduzir && <Acoes acoes={acoes} tituloId={tituloId} lapis={lapis} />}
        </div>
      )}
    </li>
  );
}

/**
 * A folha de pauta da ideia escolhida: o que a fonte traz, antes de produzir. O pé fica preso ao fim da área visível,
 * para o Produzir estar sempre à vista.
 */
function FolhaPauta({ pauta: p, numero, acoes, podeProduzir, lapis, mostrarCidade, refProduzir }: {
  pauta: Pauta; numero: number; acoes: AcoesIdeia; podeProduzir: boolean; lapis: boolean; mostrarCidade: boolean; refProduzir: RefObject<HTMLButtonElement | null>;
}) {
  const id = useId();
  const tituloId = `${id}-t`;
  return (
    <section id="folha-pauta" className="folha-pauta" aria-label={t("Folha de pauta", "Story sheet")}>
      <p className="mono folha-pauta-topo m-0">
        <span>{[t(`Pauta ${doisDigitos(numero)}`, `Story ${doisDigitos(numero)}`), editoriaDe(p), mostrarCidade ? p.cidade : null, p.bairro, quando(p.created_at)].filter(Boolean).join(" · ")}</span>
        {p.fonte && <span>{p.fonte}</span>}
      </p>
      {p.tipo_post === "publicidade" && <Publicidade pauta={p} />}
      <h2 id={tituloId}>{p.titulo}</h2>
      {p.resumo && <p className="resumo">{p.resumo}</p>}
      {p.falhou !== null && <Falhou motivo={p.falhou} />}
      {p.fatos.length > 0 && (
        <div className="grid gap-2">
          <h3 className="lat-rotulo m-0 font-normal">{t("Fatos que a fonte traz", "Facts from the source")}</h3>
          {/* O tamanho vai no ícone: o utilitário padrão dele (22 px) venceria a regra de `.fatos`, que está na camada de componentes. */}
          <ul className="fatos">{p.fatos.map((f, i) => <li key={i}><IconeCerto className="size-3.5" /><span>{f}</span></li>)}</ul>
        </div>
      )}
      {podeProduzir && (
        <div className="grid gap-2">
          <h3 id={`${id}-f`} className="lat-rotulo m-0 font-normal">{t("Formato", "Format")}</h3>
          <div className="formato" role="group" aria-labelledby={`${id}-f`}>
            {FORMATOS.map((f, i) => (
              <button key={f.valor} type="button" aria-pressed={acoes.formato === f.valor} aria-keyshortcuts={String(i + 1)} onClick={() => acoes.trocarFormato(f.valor)}>
                <span className="mini" aria-hidden="true">{Array.from({ length: f.valor === "carrossel" ? 4 : 1 }, (_, j) => <i key={j} />)}</span>
                <span><b className="first-letter:uppercase">{f.rotulo}</b><span className="mono block">{O_QUE_PRODUZ[f.valor]()}</span></span>
              </button>
            ))}
          </div>
        </div>
      )}
      {podeProduzir && <Acoes acoes={acoes} tituloId={tituloId} lapis={lapis} naFolha refProduzir={refProduzir} />}
    </section>
  );
}

/**
 * Produzir, o formato e Descartar de uma ideia: no pé da folha de pauta (com as teclas à vista; o formato fica acima,
 * na folha) ou na própria linha, abaixo de 1180 px. Descartar pede confirmação: o passo abre com o foco em "Tirar".
 */
function Acoes({ acoes: a, tituloId, lapis, naFolha = false, refProduzir }: { acoes: AcoesIdeia; tituloId: string; lapis: boolean; naFolha?: boolean; refProduzir?: RefObject<HTMLButtonElement | null> }) {
  const { veiculo } = useCasca();
  const tirar = useRef<HTMLButtonElement>(null);
  const abrir = useRef<HTMLButtonElement>(null);
  const voltar = useRef(false);
  // Cancelar devolve o foco a "Descartar"; depois de tirar, ele fica solto na página, e os atalhos seguem valendo.
  useEffect(() => {
    if (a.confirmando) tirar.current?.focus();
    else if (voltar.current) abrir.current?.focus();
    voltar.current = false;
  }, [a.confirmando]);
  const caixa = naFolha ? "folha-pauta-pe flex-wrap" : "flex flex-wrap items-center gap-2";
  // No pé preso o aviso vem em cima (os botões não saem do lugar); na linha, embaixo.
  const erro = a.erro && <div className={naFolha ? "order-first w-full" : "w-full"}><Erro e={a.erro} veiculo={veiculo} /></div>;
  const alto = naFolha ? "min-h-9" : "min-h-11";

  if (a.confirmando) {
    const cancelar = () => { voltar.current = true; a.cancelarDescarte(); };
    return (
      <div className={caixa} role="group" aria-label={t("Descartar ideia", "Discard idea")} onKeyDown={(e) => { if (e.key === "Escape") cancelar(); }}>
        <span className={naFolha ? "mr-auto text-[15px]" : "w-full text-[15px]"}>{t("Tirar esta ideia da lista?", "Remove this idea from the list?")}</span>
        {/* Enter segurado não confirma: quem abriu o passo com o teclado decide com um toque novo. */}
        <button ref={tirar} type="button" className={`${alto} cursor-pointer rounded-btn px-3 font-bold text-terracota hover:bg-terracota-claro disabled:cursor-not-allowed disabled:opacity-55 ${naFolha ? "" : "-ml-3"}`}
          disabled={a.ocupado} onKeyDown={(e) => { if (e.repeat) e.preventDefault(); }} onClick={a.descartar} aria-describedby={tituloId}>
          {a.descartando ? t("Tirando…", "Removing…") : t("Tirar", "Remove")}
        </button>
        <button type="button" className={`${alto} cursor-pointer rounded-btn px-3 text-texto-forte hover:bg-papel-2`} onClick={cancelar}>
          {t("Cancelar", "Cancel")}
        </button>
        {erro}
      </div>
    );
  }
  const rotulo = a.produzindo ? t("Começando…", "Starting…") : t("Produzir", "Produce");
  return (
    <div className={caixa}>
      {lapis ? (
        <button ref={refProduzir} type="button" className={`acao-lapis cursor-pointer ${naFolha ? "mr-2" : "-ml-[6px]"}`} disabled={a.ocupado} onClick={a.produzir} aria-describedby={tituloId} aria-keyshortcuts={naFolha ? "P" : undefined}>
          <span>{rotulo}</span><VoltaLapis desenhar />
        </button>
      ) : (
        <button ref={refProduzir} type="button" className="btn-clara" disabled={a.ocupado} onClick={a.produzir} aria-describedby={tituloId} aria-keyshortcuts={naFolha ? "P" : undefined}>
          {rotulo}{naFolha && <span aria-hidden="true" className="kbd">P</span>}
        </button>
      )}
      {naFolha ? <span className="mono">{t("leva de 1 a 2 minutos", "takes 1 to 2 minutes")}</span> : (
        <div className="segmento" role="group" aria-label={t("Formato", "Format")} aria-describedby="formato-ajuda">
          {FORMATOS.map((f) => <button key={f.valor} type="button" aria-pressed={a.formato === f.valor} onClick={() => a.trocarFormato(f.valor)}>{f.rotulo}</button>)}
        </div>
      )}
      {/* O nome ("Descartar ideia") sai do conteúdo, não de aria-label: com a tecla à vista, o rótulo não bateria com o texto (WCAG 2.5.3). */}
      <button ref={abrir} type="button" disabled={a.ocupado} onClick={a.pedirDescarte} aria-describedby={tituloId} aria-keyshortcuts={naFolha ? "X" : undefined}
        className={`${alto} inline-flex cursor-pointer items-center rounded-btn px-[13px] text-[14px] font-semibold text-terracota hover:bg-terracota-claro disabled:cursor-not-allowed disabled:opacity-55 ${naFolha ? "" : "ml-auto"}`}>
        {t("Descartar", "Discard")}<span className="sr-only"> {t("ideia", "idea")}</span>{naFolha && <span aria-hidden="true" className="kbd ml-2">X</span>}
      </button>
      {erro}
    </div>
  );
}

function Erro({ e, veiculo }: { e: Error; veiculo: Veiculo }) {
  if (e instanceof ErroApi && e.status === 402) return <AvisoLimite mensagem={e.message} veiculo={veiculo} codigo={e.codigo} />;
  const msg = e instanceof ErroApi
    ? e.status === 0 ? t("Sem conexão. Confira a internet e tente de novo.", "No connection. Check your internet and try again.")
      : e.status === 409 ? t("Essa ideia já mudou: alguém começou a produzir ou tirou da lista. A lista foi atualizada.", "This idea already changed: someone started producing it or removed it from the list. The list was updated.")
        : e.status === 403 ? t("Só quem edita o veículo pode fazer isso.", "Only people who edit the publication can do this.")
          : t("Não deu certo agora. Tente de novo.", "That didn't work right now. Try again.")
    : t("Não deu certo agora. Tente de novo.", "That didn't work right now. Try again.");
  return <p role="alert" className="m-0 w-full text-[15px] text-terracota">{msg}</p>;
}

// ── fontes no celular (no computador, a saúde das fontes mora no fólio e na lateral) ────────────────────────────

function AvisoFontes({ tenantId }: { tenantId: string }) {
  const fontes = useFontes(tenantId);
  const fora = fontes.data?.fontes.filter((f) => !f.ok) ?? [];
  if (!fora.length) return null;
  return (
    <details className="faixa-aviso mb-6 lg:hidden">
      <summary className="-my-2 flex min-h-11 cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="size-2 flex-none rounded-full bg-ambar" />
        <span>{fora.length === 1 ? t("1 fonte indisponível", "1 source unavailable") : t(`${fora.length} fontes indisponíveis`, `${fora.length} sources unavailable`)}</span>
        <span className="ml-auto font-bold underline underline-offset-3">{t("detalhes", "details")}</span>
      </summary>
      <ul className="m-0 mt-2 list-none p-0 text-[14px]">
        {fora.map((f) => (
          <li key={f.id}>{f.nome}: {t(`a última coleta não respondeu${f.coletadaEm ? ` (${quando(f.coletadaEm)})` : ""}. As outras seguem trazendo notícia.`,
            `the last check got no response${f.coletadaEm ? ` (${quando(f.coletadaEm)})` : ""}. The others keep bringing in news.`)}</li>
        ))}
      </ul>
    </details>
  );
}

// ── vazio e carga ───────────────────────────────────────────────────────────────────────────────────────────────

function Vazio() {
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
          <VoltaLapis desenhar />
        </Link>
      </div>
    </section>
  );
}

/** A mesma grade da tela enquanto carrega: linhas da lista e, onde ela existe, a folha de pauta. */
function Esqueleto() {
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
