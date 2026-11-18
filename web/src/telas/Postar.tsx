// Prontos para postar: os posts aprovados, por ordem de chegada, na mesma mesa de provas de Para aprovar: cada prova
// escreve a espera ("espera há 14 h · aprovado hoje, 10:00"; com horário anotado, ele entra no lugar; quem posta
// sozinho mostra o andamento). Sob o título, quantos são e, quando vão todos para a mesma conta manual, onde se posta.
// De 1180 px para cima a mesa fica à esquerda e, à direita, o painel do post escolhido (o mesmo da tela do post,
// ./Publicar: o roteiro de quem posta à mão ou o andamento de quem posta sozinho), sem sair da lista: o escolhido mora
// na URL (`?post=`; sem o parâmetro, o primeiro), a prova dele leva `aria-current` e a marca à mão da tela é a volta de
// lápis na ação do passo da vez. Abaixo disso a prova abre a tela do post e a volta marca "Postar a próxima" no primeiro
// que alguém posta à mão. Vazio aponta para Para aprovar (ou para as Ideias, se não há nada esperando).
import { useState, type MouseEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { aquecerPost } from "../aquecer";
import { useCasca } from "../casca/contexto";
import { FalhaCarga, useTitulo } from "../comum";
import { EDITORIA, espera, fracaoEspera, nomeConta, postaSozinho, quando, rotuloFormato, situacaoPronto, usePecas, useProntos, useStatusPeca, type PecaFila } from "../fila";
import { t } from "../idioma";
import { VoltaLapis } from "../kit/Lapis";
import { useMidia } from "../kit/Partes";
import { LinhaMesa, MesaEsqueleto, MesaVazia, ProvaPost } from "../kit/Prova";
import { PainelPublicar, type NaLista } from "./Publicar";

/** A largura das duas colunas (o breakpoint `xl`, o mesmo de `.postar-mesa`). */
const DUAS_COLUNAS = "(min-width: 1180px)";

export default function Postar() {
  const { veiculo } = useCasca();
  useTitulo(t("Prontos para postar", "Ready to post"), veiculo.nome);
  const prontos = useProntos(veiculo.id);
  const lista = prontos.data?.pecas ?? [];
  const total = Math.max((prontos.data?.total.aprovada ?? 0) + (prontos.data?.total.agendada ?? 0), lista.length);
  // Quem só traz ideias não posta: a lista é de leitura ("Ver"), sem marca à mão em ação que não é dele.
  const posta = veiculo.papel !== "reporter";
  const manuais = lista.filter((p) => !postaSozinho(p.conta_modo));
  const primeira = posta ? manuais[0]?.id : undefined;
  const qc = useQueryClient();

  const largo = useMidia(DUAS_COLUNAS);
  const [params, setParams] = useSearchParams();
  // Confirmado aqui, o post sai da mesa, mas o painel fica nele ("Postado", o link) até a pessoa escolher outro.
  const [postado, setPostado] = useState<string | null>(null);
  const pedido = params.get("post");
  const escolhido = largo && lista.length ? postado ?? lista.find((p) => p.id === pedido)?.id ?? lista[0].id : undefined;
  const escolher = (id: string) => {
    setPostado(null);
    setParams((p) => { p.set("post", id); return p; }, { replace: true, preventScrollReset: true });
  };
  // Em duas colunas o clique simples escolhe; Ctrl, ⌘, Shift e o botão do meio seguem abrindo a tela do post em outra aba.
  const aoClicar = (id: string) => (e: MouseEvent) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    escolher(id);
  };

  return (
    <div className="mx-auto max-w-[1280px] px-5 pt-6 pb-14 lg:px-12 lg:pt-3">
      <h1 className="titulo-tela m-0 text-[32px] lg:text-[34px]">{t("Prontos para postar", "Ready to post")}</h1>
      {!prontos.isError && lista.length > 0 && <LinhaMesa forte={total === 1 ? t("1 aprovado", "1 approved") : t(`${total} aprovados`, `${total} approved`)} partes={[posta && ondeSePosta(lista)]} />}
      {prontos.isPending ? (
        <div className="mt-8">
          <p role="status" className="sr-only">{t("Carregando os posts", "Loading posts")}</p>
          <MesaEsqueleto />
        </div>
      ) : prontos.isError ? (
        <div className="mt-6"><FalhaCarga oque={t("os posts prontos para postar", "the posts ready to post")} tentar={() => prontos.refetch()} /></div>
      ) : !lista.length ? (
        <Vazio />
      ) : (
        <div className="postar-mesa mt-[26px]">
          <div className="min-w-0">
            <ul className="mesa m-0 list-none p-0">
              {lista.map((p, i) => <Item key={p.id} peca={p} n={i + 1} slug={veiculo.slug} aquecer={() => void aquecerPost(qc, veiculo.id, p.id)} maisAntiga={manuais[0]?.updated_at ?? null}
                primeira={p.id === primeira} marca={!largo} posta={posta} atual={p.id === escolhido} aoClicar={largo ? aoClicar(p.id) : undefined} />)}
            </ul>
            {total > lista.length && <p className="mono m-0 mt-2 text-apoio">{t(`e mais ${total - lista.length}, que aparecem conforme estes saírem`, `and ${total - lista.length} more, shown as these go out`)}</p>}
          </div>
          {escolhido && <Escolhido key={escolhido} id={escolhido} lista={{ escolher, aoConfirmar: () => setPostado(escolhido) }} />}
        </div>
      )}
    </div>
  );
}

/**
 * "conta manual: você posta em @conta": só quando tudo o que alguém posta à mão vai para a mesma conta (é o que a lista
 * sabe: a conta de cada post). Com contas diferentes, ou só com quem posta sozinho, a linha fica na contagem.
 */
function ondeSePosta(lista: PecaFila[]) {
  const contas = new Set(lista.filter((p) => p.conta_modo === "manual").map((p) => nomeConta({ modo: "manual", nome: p.conta_nome, external_id: p.conta_external_id })));
  const [conta] = contas;
  return contas.size === 1 && t(`conta manual: você posta em ${conta}`, `manual account: you post on ${conta}`);
}

/** O post escolhido na mesa: o status dele (o mesmo pedido da tela do post, já aquecido ao apontar a prova) e o painel de publicar. */
function Escolhido({ id, lista }: { id: string; lista: NaLista }) {
  const { veiculo } = useCasca();
  const status = useStatusPeca(veiculo.id, id);
  if (status.data) return <PainelPublicar s={status.data} lista={lista} />;
  return (
    <section className="roteiro" aria-label={t("Roteiro de postagem", "Posting checklist")} aria-busy={status.isPending}>
      {status.isError ? <FalhaCarga oque={t("o andamento", "the progress")} tentar={() => status.refetch()} /> : (
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

function Vazio() {
  const { veiculo } = useCasca();
  const aprovar = usePecas(veiculo.id).data?.total.revisao ?? 0;
  const base = `/t/${veiculo.slug}`;
  return (
    <MesaVazia rotulo={t("sem provas", "no proofs")}>
      <p className="m-0 text-[19px] text-texto-forte">{t("Nada para postar agora.", "Nothing to post right now.")}</p>
      <p className="m-0 max-w-[52ch] text-apoio">
        {aprovar
          ? t(`${aprovar === 1 ? "1 post espera" : `${aprovar} posts esperam`} a sua aprovação: aprovados, eles vêm para cá com as imagens e a legenda prontas.`,
            `${aprovar === 1 ? "1 post is waiting" : `${aprovar} posts are waiting`} for your approval: once approved, they come here with the images and caption ready.`)
          : t("Quando você aprovar um post, ele vem para cá com as imagens e a legenda prontas para o Instagram.",
            "When you approve a post, it comes here with the images and caption ready for Instagram.")}
      </p>
      {aprovar ? (
        <Link to={`${base}/aprovar`} viewTransition className="acao-lapis -ml-[6px]"><span>{t("Ver Para aprovar", "See To approve")}</span><VoltaLapis desenhar /></Link>
      ) : (
        <Link to={base} viewTransition className="acao-lapis -ml-[6px]"><span>{t("Ver as ideias", "See the ideas")}</span><VoltaLapis desenhar /></Link>
      )}
    </MesaVazia>
  );
}

/** Aprovado em conta manual sem horário anotado: espera alguém postar. Com horário (ainda que vencido: "era para…") ou postando sozinho, a frase é a de `situacaoPronto`. */
const semHorario = (p: PecaFila) => !postaSozinho(p.conta_modo) && !p.agendado_para;
function esperaPronto(p: PecaFila, agora = new Date()) {
  return semHorario(p)
    ? t(`espera há ${espera(p.updated_at, agora)} · aprovado ${quando(p.updated_at, agora)}`, `waiting ${espera(p.updated_at, agora)} · approved ${quando(p.updated_at, agora)}`)
    : situacaoPronto(p, agora);
}

/**
 * `primeira`: o primeiro que alguém posta à mão ("Postar a próxima"). `marca`: a volta de lápis fica nela (uma coluna); em
 * duas colunas a marca é do roteiro, e a prova é a escolhida (`atual`) ou escolhe no clique (`aoClicar`).
 */
function Item({ peca: p, n, slug, maisAntiga, primeira, marca, posta, aquecer, atual, aoClicar }: {
  peca: PecaFila; n: number; slug: string; maisAntiga: string | null; primeira: boolean; marca: boolean; posta: boolean; aquecer: () => void;
  atual: boolean; aoClicar?: (e: MouseEvent) => void;
}) {
  const sozinho = postaSozinho(p.conta_modo);
  const conta = p.conta_modo ? nomeConta({ modo: p.conta_modo, nome: p.conta_nome, external_id: p.conta_external_id }) : null;
  const aMao = semHorario(p);
  return (
    <ProvaPost
      para={`/t/${slug}/p/${p.id}`} capa={p.capa} formato={p.formato} n={n}
      meta={[EDITORIA[p.editoria ?? ""] ?? p.editoria, rotuloFormato(p.formato, p.ncards), conta]}
      manchete={p.manchete ?? p.titulo}
      espera={esperaPronto(p)}
      fracao={aMao && maisAntiga ? fracaoEspera(p.updated_at, maisAntiga) : null}
      acao={primeira ? t("Postar a próxima", "Post the next one") : sozinho ? t("Acompanhar", "Track") : posta ? t("Postar", "Post") : t("Ver", "View")} proxima={primeira && marca} onApontar={aquecer}
      atual={atual} aoClicar={aoClicar}
    />
  );
}
