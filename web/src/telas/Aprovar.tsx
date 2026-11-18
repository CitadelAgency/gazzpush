// Para aprovar: os posts prontos esperando leitura, quem espera há mais tempo primeiro (a ordem vem da API). Sob o
// título, quantos esperam e há quanto tempo o mais antigo espera. Duas vistas, guardadas na URL (`?vista=lista`): a mesa
// de provas (kit/Prova: a capa grande, o número da fila e a espera escrita, "espera há 23 h · pronto ontem, 23:08", sobre
// uma régua proporcional ao mais antigo; o cartão inteiro abre o post e a volta de lápis marca "Revisar a próxima") e a
// lista, uma linha por post, para a fila longa. Embaixo, o que ainda está em produção, com a etapa de cada um. Vazio
// aponta para as Ideias. Mesma consulta da casca (contador) e das Ideias: nenhuma requisição a mais para a fila.
import { useQueryClient } from "@tanstack/react-query";
import type { MouseEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { aquecerPost } from "../aquecer";
import { useCasca } from "../casca/contexto";
import { IconeGrade, IconeLista } from "../casca/icones";
import { FalhaCarga, Partes, useTitulo } from "../comum";
import { EDITORIA, ETAPAS, espera, fracaoEspera, instante, quando, rotuloEtapa, rotuloFormato, usePecas, useStatusPeca, type PecaFila } from "../fila";
import { t } from "../idioma";
import { VoltaLapis } from "../kit/Lapis";
import { LinhaMesa, MesaEsqueleto, MesaVazia, ProvaPost, Regua, arteQueVolta, levarArte, useAquecer } from "../kit/Prova";

export default function Aprovar() {
  const { veiculo } = useCasca();
  useTitulo(t("Para aprovar", "To approve"), veiculo.nome);
  const pecas = usePecas(veiculo.id);
  const prontas = pecas.data?.pecas.filter((p) => p.status === "revisao") ?? [];
  const total = Math.max(pecas.data?.total.revisao ?? 0, prontas.length);
  const produzindo = pecas.data?.total.rascunho ?? 0;
  // Em produção: do mais antigo (o que chega primeiro), como no card da lateral.
  const rascunhos = (pecas.data?.pecas ?? []).filter((p) => p.status === "rascunho").sort((a, b) => instante(a.created_at) - instante(b.created_at));
  const carregou = !pecas.isPending && !pecas.isError;
  const haFila = carregou && prontas.length > 0;
  const ideias = `/t/${veiculo.slug}`;
  // Quem só traz ideias não decide: a lista é de leitura ("Ver"), sem marca à mão em ação que não é dele.
  const decide = veiculo.papel !== "reporter";
  const qc = useQueryClient();
  // Mesa ou lista: a escolha mora na URL (a mesa é o padrão e não leva parâmetro).
  const [params, setParams] = useSearchParams();
  const emLista = params.get("vista") === "lista";
  const verComo = (lista: boolean) => setParams((p) => { if (lista) p.set("vista", "lista"); else p.delete("vista"); return p; }, { replace: true, preventScrollReset: true });

  return (
    <div className="mx-auto max-w-[1280px] px-5 pt-6 pb-14 lg:px-12 lg:pt-3">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="titulo-tela m-0 text-[32px] lg:text-[34px]">{t("Para aprovar", "To approve")}</h1>
          {haFila && <LinhaMesa forte={quantosEsperam(total, decide)} partes={[haQuanto(total, prontas[0].updated_at)]} />}
        </div>
        {haFila && (
          <div className="segmento" role="group" aria-label={t("Como ver", "View as")}>
            <button type="button" aria-pressed={!emLista} onClick={() => verComo(false)}><IconeGrade className="size-[15px]" />{t("Mesa", "Desk")}</button>
            <button type="button" aria-pressed={emLista} onClick={() => verComo(true)}><IconeLista className="size-[15px]" />{t("Lista", "List")}</button>
          </div>
        )}
      </header>
      {pecas.isPending ? (
        <div className="mt-8">
          <p role="status" className="sr-only">{t("Carregando os posts", "Loading posts")}</p>
          <MesaEsqueleto />
        </div>
      ) : pecas.isError ? (
        <div className="mt-6"><FalhaCarga oque={t("os posts para aprovar", "the posts to approve")} tentar={() => pecas.refetch()} /></div>
      ) : !prontas.length ? (
        <MesaVazia rotulo={t("sem provas", "no proofs")}>
          <p className="m-0 text-[19px] text-texto-forte">{t("Nada esperando a sua aprovação.", "Nothing is waiting for your approval.")}</p>
          <p className="m-0 max-w-[52ch] text-apoio">
            {produzindo
              ? t(`${produzindo === 1 ? "1 post está" : `${produzindo} posts estão`} sendo produzido${produzindo === 1 ? "" : "s"}; aparece${produzindo === 1 ? "" : "m"} aqui quando ficar${produzindo === 1 ? "" : "em"} pronto${produzindo === 1 ? "" : "s"}.`,
                produzindo === 1 ? "1 post is in production; it shows up here when it's ready." : `${produzindo} posts are in production; they show up here when they're ready.`)
              : t("Mande produzir uma ideia: quando o post ficar pronto, ele aparece aqui para você conferir.", "Send an idea to production: when the post is ready, it shows up here for you to check.")}
          </p>
          <Link to={ideias} className="acao-lapis -ml-[6px]"><span>{t("Ver as ideias", "See the ideas")}</span><VoltaLapis desenhar /></Link>
        </MesaVazia>
      ) : (
        <>
          {emLista ? (
            <Lista prontas={prontas} slug={veiculo.slug} decide={decide} aquecer={(id) => void aquecerPost(qc, veiculo.id, id)} />
          ) : (
            <ul className="mesa m-0 mt-[26px] list-none p-0">
              {prontas.map((p, i) => <Item key={p.id} peca={p} n={i + 1} slug={veiculo.slug} maisAntiga={prontas[0].updated_at} proxima={decide && i === 0} decide={decide}
                aquecer={() => void aquecerPost(qc, veiculo.id, p.id)} />)}
            </ul>
          )}
          {total > prontas.length && <p className="mono m-0 mt-2 text-apoio">{t(`e mais ${total - prontas.length}, que aparecem conforme estes saírem`, `and ${total - prontas.length} more, shown as these go out`)}</p>}
        </>
      )}
      {carregou && rascunhos.length > 0 && <EmProducao rascunhos={rascunhos} mais={Math.max(produzindo - rascunhos.length, 0)} tenantId={veiculo.id} slug={veiculo.slug} />}
    </div>
  );
}

/** "4 esperam você". Para quem só traz ideias nada espera por ele: "4 esperam aprovação". */
function quantosEsperam(n: number, decide: boolean) {
  if (decide) return n === 1 ? t("1 espera você", "1 waiting for you") : t(`${n} esperam você`, `${n} waiting for you`);
  return n === 1 ? t("1 espera aprovação", "1 waiting for approval") : t(`${n} esperam aprovação`, `${n} waiting for approval`);
}

/** "o mais antigo espera há 3 dias" (a frase das Ideias); com um post só não há "mais antigo": "pronto ontem, 23:08", como na prova. */
function haQuanto(n: number, maisAntiga: string) {
  return n === 1
    ? t(`pronto ${quando(maisAntiga)}`, `ready ${quando(maisAntiga)}`)
    : t(`o mais antigo espera há ${espera(maisAntiga)}`, `the oldest has waited ${espera(maisAntiga)}`);
}

const acaoDe = (decide: boolean) => (decide ? t("Revisar", "Review") : t("Ver", "View"));

function Item({ peca: p, n, slug, maisAntiga, proxima, decide, aquecer }: { peca: PecaFila; n: number; slug: string; maisAntiga: string; proxima: boolean; decide: boolean; aquecer: () => void }) {
  return (
    <ProvaPost
      id={p.id} para={`/t/${slug}/p/${p.id}`} capa={p.capa} formato={p.formato} n={n}
      meta={[EDITORIA[p.editoria ?? ""] ?? p.editoria, rotuloFormato(p.formato, p.ncards), p.rodada > 1 && t(`versão ${p.rodada}`, `version ${p.rodada}`)]}
      manchete={p.manchete ?? p.titulo}
      espera={t(`espera há ${espera(p.updated_at)} · pronto ${quando(p.updated_at)}`, `waiting ${espera(p.updated_at)} · ready ${quando(p.updated_at)}`)}
      fracao={fracaoEspera(p.updated_at, maisAntiga)}
      acao={proxima ? t("Revisar a próxima", "Review the next one") : acaoDe(decide)} proxima={proxima} onApontar={aquecer}
    />
  );
}

// ── lista ───────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A fila em lista: uma linha por post, na ordem da mesa. A arte aqui só identifica (miniatura); confere-se na revisão. No
 * celular ficam o número, a miniatura, a manchete e a ação: editoria, formato e espera descem para baixo da manchete.
 */
function Lista({ prontas, slug, decide, aquecer }: { prontas: PecaFila[]; slug: string; decide: boolean; aquecer: (id: string) => void }) {
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
          {prontas.map((p, i) => <Linha key={p.id} peca={p} n={i + 1} para={`/t/${slug}/p/${p.id}`} maisAntiga={prontas[0].updated_at} decide={decide} aquecer={() => aquecer(p.id)} />)}
        </tbody>
      </table>
    </div>
  );
}

function Linha({ peca: p, n, para, maisAntiga, decide, aquecer }: { peca: PecaFila; n: number; para: string; maisAntiga: string; decide: boolean; aquecer: () => void }) {
  const apontar = useAquecer(aquecer);
  const manchete = p.manchete ?? p.titulo;
  const editoria = EDITORIA[p.editoria ?? ""] ?? p.editoria;
  const formato = [rotuloFormato(p.formato, p.ncards), p.rodada > 1 && t(`versão ${p.rodada}`, `version ${p.rodada}`)];
  // A arte que viaja até o palco do post é a miniatura desta linha (kit/arteVT).
  const abrir = (e: MouseEvent<HTMLAnchorElement>) => levarArte(e, p.id, e.currentTarget.closest("tr")?.querySelector<HTMLElement>(".fila-mini") ?? null);
  return (
    <tr>
      <td><span className="prova-n">{String(n).padStart(2, "0")}</span></td>
      <td>
        <span className="fila-mini" data-vaga={p.capa ? undefined : ""} {...arteQueVolta(p.id)}>
          {p.capa && <img src={p.capa} alt="" width={68} height={85} loading="lazy" decoding="async" />}
        </span>
      </td>
      <td>
        <Link to={para} viewTransition {...apontar} onClick={abrir} className="font-semibold text-texto-forte no-underline hover:underline hover:decoration-fio-forte hover:underline-offset-4">{manchete}</Link>
        {/* No celular as três colunas de trás somem: o que elas dizem vem aqui, numa linha. */}
        <span className="mono mt-0.5 block text-apoio lg:hidden">
          <Partes partes={[editoria, ...formato, t(`espera há ${espera(p.updated_at)}`, `waiting ${espera(p.updated_at)}`)]} />
        </span>
      </td>
      <td className="mono so-largo">{editoria}</td>
      <td className="mono so-largo"><Partes partes={formato} /></td>
      <td className="mono so-largo">
        <span className="flex items-center gap-2.5"><span className="w-24 flex-none"><Regua fracao={fracaoEspera(p.updated_at, maisAntiga)} /></span>{espera(p.updated_at)}</span>
      </td>
      <td className="text-right">
        <Link to={para} viewTransition {...apontar} onClick={abrir} className="link-acao inline-flex min-h-11 items-center">
          {acaoDe(decide)}<span className="sr-only">: {manchete}</span>
        </Link>
      </td>
    </tr>
  );
}

// ── em produção ─────────────────────────────────────────────────────────────────────────────────────────────────

/** O que ainda está sendo feito e chega a esta mesa sozinho: uma linha por post, com a etapa de agora, que leva ao post. */
function EmProducao({ rascunhos, mais, tenantId, slug }: { rascunhos: PecaFila[]; mais: number; tenantId: string; slug: string }) {
  const varios = rascunhos.length + mais > 1;
  return (
    <section aria-labelledby="ap-producao" className="mt-10">
      <h2 id="ap-producao" className="secao m-0 mb-2">
        {t("Em produção", "In production")}
        <span className="text-apoio tracking-[.01em] normal-case">
          {varios ? t("chegam aqui quando ficarem prontos", "they show up here when they're ready") : t("chega aqui quando ficar pronto", "it shows up here when it's ready")}
        </span>
      </h2>
      {rascunhos.map((p) => <LinhaProducao key={p.id} peca={p} tenantId={tenantId} para={`/t/${slug}/p/${p.id}`} />)}
      {mais > 0 && <p className="mono m-0 mt-2 text-apoio">{t(`e mais ${mais} produzindo`, `and ${mais} more in production`)}</p>}
    </section>
  );
}

/** Um post produzindo: a prova ainda em branco, a manchete, as quatro etapas e "etapa 2 de 4 · conferir cada frase com as fontes". Acompanha a cada 5 s (a mesma consulta do card da lateral). */
function LinhaProducao({ peca: p, tenantId, para }: { peca: PecaFila; tenantId: string; para: string }) {
  const etapa = useStatusPeca(tenantId, p.id).data?.etapa ?? null;
  const passo = etapa ? ETAPAS.indexOf(etapa) + 1 : 0;
  return (
    <Link to={para} viewTransition className="fila-linha max-lg:gap-y-1">
      {/* Ainda sem número na fila e sem arte: o lugar dos dois fica marcado. */}
      <span aria-hidden="true" className="prova-n bg-transparent text-apoio shadow-[inset_0_0_0_1px_var(--color-fio-forte)]">··</span>
      <span aria-hidden="true" className="fila-mini" data-vaga="" />
      <span className="min-w-0">
        <b>{p.manchete ?? p.titulo}</b>
        {/* As etapas em grafite (andamento não é ação): as feitas cheias, a de agora com o traço que corre. */}
        <span aria-hidden="true" className="etapas">
          {ETAPAS.map((e, i) => <i key={e} data-feita={i < passo - 1 ? "" : undefined} data-agora={i === Math.max(passo - 1, 0) ? "" : undefined} />)}
        </span>
      </span>
      {/* No celular a etapa desce para baixo da manchete, em vez de espremer a linha. */}
      <span className="mono max-lg:col-start-3 max-lg:whitespace-normal">
        {etapa
          ? t(`etapa ${passo} de ${ETAPAS.length} · ${rotuloEtapa(etapa, p.formato).toLocaleLowerCase()}`, `step ${passo} of ${ETAPAS.length} · ${rotuloEtapa(etapa, p.formato).toLocaleLowerCase()}`)
          : t("começando", "starting")}
      </span>
    </Link>
  );
}
