// Publicar (Fase F): o post aprovado. Conta manual: o roteiro de postagem, numerado (mandar as imagens para o Instagram:
// compartilhar do celular, com os JPEGs; no computador, baixar; copiar a legenda; postar; avisar aqui, com o link do post
// se houver). O passo feito nesta visita encolhe para uma linha com o visto. Conta que posta sozinha: o andamento da
// publicação. Postado: quando saiu e o link. A marca à mão da tela é a volta de lápis na ação do passo da vez
// (Compartilhar/Baixar primeiro; depois de postado, o próximo post para postar). O painel (`PainelPublicar`) é o mesmo
// aqui e em Prontos para postar, onde fica ao lado da mesa (./Postar).
import { useCallback, useLayoutEffect, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { api, corpoJson, ErroApi, ler } from "../api";
import { useCasca } from "../casca/contexto";
import { NoFolio } from "../casca/Folio";
import { IconeBaixar, IconeCopiar, IconeFora, IconePostar, IconeVoltar } from "../casca/icones";
import { FalhaCarga, Partes } from "../comum";
import {
  PAPEL_CARD, chaves, linkDoPost, rotuloFormato, nomeConta, nomeImagem, perfilInstagram, postaSozinho, quando, quandoFuturo, quemConfirma, situacaoPronto,
  useMembros, usePecas, useProntos, type StatusPeca,
} from "../fila";
import { t } from "../idioma";
import { VoltaLapis } from "../kit/Lapis";
import { zipar } from "../zip";

const rota = api.t[":tenantId"].pecas[":id"];

/** Imagens assinadas por 24 h e a legenda pronta (no limite do Instagram). A tela e o painel pedem a mesma consulta. */
function usePacote(s: StatusPeca) {
  const { veiculo } = useCasca();
  return useQuery({
    queryKey: [...chaves.peca(veiculo.id, s.id), "pacote", s.versao],
    queryFn: () => ler(rota.pacote.$get({ param: { tenantId: veiculo.id, id: s.id } })),
    staleTime: 12 * 60 * 60_000,
  });
}

type Pacote = ReturnType<typeof usePacote>;
type ContaTexto = { modo: string; nome: string | null; external_id: string | null };
const contaDe = (s: StatusPeca): ContaTexto => ({ modo: s.conta_modo ?? "manual", nome: s.conta_nome, external_id: s.conta_external_id });
/** "postado hoje, 10:02" ou a situação do aprovado ("aprovado ontem, 18:40", "anotado para…", "postando sozinho"). */
const situacao = (s: StatusPeca) => (s.status !== "publicada" ? situacaoPronto(s)
  : s.publicado_em ? t(`postado ${quando(s.publicado_em)}`, `posted ${quando(s.publicado_em)}`) : t("postado", "posted"));

/** `deRevisao`: o post acabou de ser aprovado nesta tela (a pessoa veio da revisão). */
export default function Publicar({ s, deRevisao }: { s: StatusPeca; deRevisao: boolean }) {
  const { veiculo, marcarPeca } = useCasca();
  const postado = s.status === "publicada";
  useLayoutEffect(() => { marcarPeca(postado ? "postado" : "postar"); return () => marcarPeca(null); }, [postado, marcarPeca]);
  const pacote = usePacote(s);
  const base = `/t/${veiculo.slug}`;
  const manchete = s.manchete ?? s.titulo;

  return (
    <div className="mx-auto max-w-[1180px] px-5 pt-4 pb-12 lg:px-12 lg:pt-6">
      {/* O caminho de volta mora no fólio: a lista de onde o post veio e, ao lado, a manchete. */}
      <NoFolio>
        <Link to={postado ? `${base}/postados` : `${base}/postar`} viewTransition>
          <IconeVoltar className="size-4" />{postado ? t("Postados", "Posted") : t("Prontos para postar", "Ready to post")}
        </Link>
        <span className="sep" aria-hidden="true">/</span>
        <b>{manchete}</b>
      </NoFolio>
      <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_420px] xl:gap-12">
        <div className="min-w-0">
          <p className="mono m-0 mb-2 text-apoio">
            <Partes partes={[rotuloFormato(s.formato, pacote.data?.imagens.length), nomeConta(contaDe(s)), situacao(s)]} />
          </p>
          <h1 className="manchete m-0 max-w-[30ch] text-[24px] lg:text-[32px]">{manchete}</h1>
          <Imagens pacote={pacote} carimbo={postado ? { texto: t("Postado", "Posted"), bate: false }
            : s.status === "aprovada" || s.status === "agendada" ? { texto: t("Aprovado", "Approved"), bate: false } : null} />
          {/* Carrossel aprovado: o Reels também sai daqui (vira um post novo, que passa por Para aprovar). */}
          {s.formato === "carrossel" && s.status === "aprovada" && veiculo.papel !== "reporter" && (
            <p className="m-0 mt-3 flex flex-wrap items-center gap-x-3">
              <Link to={`${base}/p/${s.id}/reels`} className="btn-sec bg-papel-2 no-underline">{t("Fazer Reels", "Make a Reel")}</Link>
              <span className="ajuda">{t("Os mesmos cards em vídeo, em pé.", "The same cards as a vertical video.")}</span>
            </p>
          )}
        </div>
        <div className="mt-6 grid content-start gap-6 xl:mt-0">
          <PainelPublicar s={s} deRevisao={deRevisao} />
        </div>
      </div>
    </div>
  );
}

/** O que Prontos para postar dá ao painel: escolher outro post sem sair da lista, e saber que este foi confirmado. */
export type NaLista = { escolher: (id: string) => void; aoConfirmar: () => void };

/**
 * O painel de publicação de um post aprovado (ou já postado), com as consultas e mutações dele: o roteiro de quem posta
 * à mão, o andamento da conta que posta sozinha, o postado. Na tela do post é a coluna ao lado das imagens. Em Prontos
 * para postar (`lista`) é a folha ao lado da mesa: o título é a manchete, "Abrir o post" leva à tela dele (as imagens
 * todas, o Reels) e "Postar a próxima" escolhe ali mesmo.
 */
export function PainelPublicar({ s, deRevisao = false, lista }: { s: StatusPeca; deRevisao?: boolean; lista?: NaLista }) {
  const { veiculo } = useCasca();
  const pacote = usePacote(s);
  const conta = contaDe(s);
  const postado = s.status === "publicada";
  const manual = !postado && !postaSozinho(s.conta_modo);
  const corpo = postado ? <Postado s={s} conta={conta} lista={lista} />
    : manual ? <PostarAMao s={s} pacote={pacote} lista={lista} />
      : <PostandoSozinho s={s} conta={conta} lista={lista} />;
  const rotulo = manual && <p className="mono m-0 text-[10.5px] tracking-[.1em] text-apoio uppercase">{t("Roteiro de postagem", "Posting checklist")}</p>;
  if (lista) {
    return (
      <section className="roteiro" aria-labelledby="pb-titulo">
        <div>
          <div className="flex items-baseline gap-3">
            {rotulo}
            <Link to={`/t/${veiculo.slug}/p/${s.id}`} viewTransition className="link-acao ml-auto text-[14px]">{t("Abrir o post", "Open post")}</Link>
          </div>
          <h2 id="pb-titulo">{s.manchete ?? s.titulo}</h2>
          <p className="mono m-0 mt-1.5 text-apoio"><Partes partes={[rotuloFormato(s.formato, pacote.data?.imagens.length), situacao(s), nomeConta(conta)]} /></p>
        </div>
        {corpo}
      </section>
    );
  }
  if (!manual) return corpo;
  return (
    <>
      {deRevisao && <Aprovado id={s.id} />}
      <section className="roteiro" aria-labelledby="pb-titulo">
        <div>
          {rotulo}
          <h2 id="pb-titulo">{t("Postar no Instagram", "Post to Instagram")} <span className="font-medium text-apoio">{nomeConta(conta)}</span></h2>
        </div>
        {corpo}
      </section>
    </>
  );
}

/** As imagens que vão para o Instagram, pequenas: aqui se confere o que sai, não se lê (isso foi na revisão). */
function Imagens({ pacote, carimbo }: { pacote: Pacote; carimbo: { texto: string; bate: boolean } | null }) {
  if (pacote.isError) return <div className="mt-5"><FalhaCarga oque={t("as imagens", "the images")} tentar={() => pacote.refetch()} /></div>;
  const imagens = pacote.data?.imagens;
  // Reels: o vídeo em pé, parado na capa (aqui se confere o que sai; tocar é com a pessoa).
  if (pacote.data?.formato === "reels" && pacote.data.video) {
    return (
      <video src={pacote.data.video} poster={imagens?.[0]?.jpg} controls playsInline preload="metadata" aria-label={t("Vídeo do Reels", "Reel video")}
        className="mt-5 block aspect-[9/16] h-auto w-[min(46vw,220px)] rounded-card bg-texto-forte object-contain shadow-prova" />
    );
  }
  const varias = !!imagens && imagens.length > 1;
  return (
    <div className="palco mt-5">
      {/* O carimbo do estado (só no computador, na mesa). Chega já assentado: quem bate é a Revisão, na hora do Aprovar. */}
      {carimbo && <span aria-hidden="true" className={`palco-carimbo carimbo ${carimbo.bate ? "carimbo-bate" : ""}`}>{carimbo.texto}</span>}
      {varias && <p className="mono m-0 mb-2 text-apoio lg:mb-5">{t(`${imagens.length} imagens, nesta ordem no carrossel`, `${imagens.length} images, in carousel order`)}</p>}
      {/* No celular a faixa rola de lado: recebe foco para as setas do teclado também rolarem. No computador, a folha de contato. */}
      <ul aria-label={t("Imagens do post", "Post images")} aria-busy={!imagens} tabIndex={0}
        className={`-mx-5 m-0 flex list-none gap-2 overflow-x-auto px-5 pb-2 [scrollbar-width:none] lg:mx-0 lg:grid lg:gap-5 lg:overflow-visible lg:px-0 lg:pb-0 [&::-webkit-scrollbar]:hidden ${imagens && imagens.length === 1 ? "lg:mx-auto lg:max-w-[340px] lg:grid-cols-1" : "lg:grid-cols-2"}`}>
        {imagens
          ? imagens.map((im, i) => (
            <li key={im.papel + i} className="w-[min(36vw,150px)] flex-none lg:w-auto">
              <img src={im.jpg} width={1080} height={1350} loading={i > 1 ? "lazy" : undefined}
                alt={t(`Card ${i + 1} de ${imagens.length}: ${PAPEL_CARD[im.papel] ?? im.papel}`, `Card ${i + 1} of ${imagens.length}: ${PAPEL_CARD[im.papel] ?? im.papel}`)}
                className="block aspect-[4/5] h-auto w-full rounded-card bg-papel-2 object-cover shadow-prova" />
            </li>
          ))
          : [0, 1].map((i) => <li key={i} className="esqueleto aspect-[4/5] w-[min(36vw,150px)] flex-none lg:w-auto" />)}
      </ul>
    </div>
  );
}

/** Logo depois de aprovar: o resultado da decisão e, se houver, o próximo para revisar (em texto: a marca é do postar). */
function Aprovado({ id }: { id: string }) {
  const { veiculo } = useCasca();
  const proxima = usePecas(veiculo.id).data?.pecas.find((p) => p.status === "revisao" && p.id !== id);
  return (
    <div role="status" className="grid justify-items-start gap-1">
      <h2 className="m-0 text-[20px] font-bold text-texto-forte">{t("Aprovado", "Approved")}</h2>
      <p className="m-0 text-[17px]">{t("Está em Prontos para postar: poste agora ou depois.", "It's in Ready to post: post it now or later.")}</p>
      {proxima && <Link to={`/t/${veiculo.slug}/p/${proxima.id}`} viewTransition className="link-acao min-h-11 content-center">{t("Revisar a próxima", "Review the next one")}</Link>}
    </div>
  );
}

// ── conta manual: a pessoa posta ────────────────────────────────────────────────────────────────────────────────

/** Para quem só traz ideias: quem confirma que o post saiu, pelo nome. */
function QuemConfirma() {
  const { veiculo } = useCasca();
  const membros = useMembros(veiculo.id);
  return <p className="m-0 text-[15px] text-texto">{quemConfirma(membros.data?.membros ?? [])}</p>;
}

/** Celular (toque) com compartilhar de arquivos: manda direto para o Instagram. No computador, baixar. */
const temToque = () => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
const podeCompartilhar = (arquivos: File[] | undefined) => {
  if (!temToque() || typeof navigator.share !== "function" || typeof navigator.canShare !== "function") return false;
  // Antes de os arquivos chegarem, vale o aparelho (o texto do passo não troca no meio); com eles, o navegador confirma.
  try { return !arquivos || navigator.canShare({ files: arquivos }); } catch { return false; }
};

/**
 * Os passos que a pessoa já fez nesta visita, por post. É só estado de tela (nada vai para a API): diz onde ela parou,
 * na lista e na tela do post, e some ao recarregar.
 */
const feitosNaVisita = new Map<string, ReadonlySet<number>>();
function useFeitos(id: string) {
  const [feitos, setFeitos] = useState<ReadonlySet<number>>(() => feitosNaVisita.get(id) ?? new Set());
  const marcar = useCallback((passo: number) => {
    const novo = new Set(feitosNaVisita.get(id)).add(passo);
    feitosNaVisita.set(id, novo);
    setFeitos(novo);
  }, [id]);
  return [feitos, marcar] as const;
}

/**
 * Um passo do roteiro (o número vem do CSS, `.passo`). Feito, encolhe para uma linha com o visto, e o título vira o
 * botão que o abre de novo (baixar outra vez, por exemplo). `estado` é o aviso do que a ação fez: fica fora do miolo,
 * para continuar na tela (e no leitor de tela) quando o passo encolhe.
 */
function Passo({ titulo, feito = false, aberto = false, alternar, estado, children }: {
  titulo: string; feito?: boolean; aberto?: boolean; alternar?: () => void; estado?: ReactNode; children: ReactNode;
}) {
  return (
    <li className="passo" data-feito={feito ? "" : undefined}>
      <div>
        <h3>
          {feito
            ? <button type="button" data-linha aria-expanded={aberto} onClick={alternar}>{titulo}<span className="sr-only">{t(": feito", ": done")}</span></button>
            : titulo}
        </h3>
        {(!feito || aberto) && children}
        {estado}
      </div>
    </li>
  );
}

/** A legenda no passo: o primeiro parágrafo e, havendo mais, "ver inteira" (copiar é a ação do passo). */
function TrechoLegenda({ texto }: { texto: string }) {
  const [inteira, setInteira] = useState(false);
  const toda = texto.trim();
  const comeco = toda.split("\n")[0];
  return (
    <>
      <p id="pb-legenda" className="whitespace-pre-line">{inteira ? toda : comeco}</p>
      {comeco !== toda && (
        <button type="button" onClick={() => setInteira((v) => !v)} aria-expanded={inteira} aria-controls="pb-legenda" className="link-acao -my-2.5 min-h-11 text-[14px]">
          {inteira ? t("ver menos", "show less") : t("ver inteira", "show all")}
        </button>
      )}
    </>
  );
}

function PostarAMao({ s, pacote, lista: naLista }: { s: StatusPeca; pacote: Pacote; lista?: NaLista }) {
  const { veiculo } = useCasca();
  const imagens = pacote.data?.imagens;
  // Reels: o arquivo é o MP4 (um só), no lugar das imagens.
  const video = pacote.data?.formato === "reels" ? pacote.data.video : null;
  // Os JPEGs (ou o MP4) em memória antes do toque: o compartilhar precisa ser chamado direto no gesto, sem esperar download.
  const arquivos = useQuery({
    queryKey: [...chaves.peca(veiculo.id, s.id), "arquivos", s.versao],
    enabled: !!imagens,
    staleTime: Infinity,
    queryFn: async () => {
      if (video) {
        const res = await fetch(video);
        if (!res.ok) throw new ErroApi(res.status, "video");
        return [new File([await res.blob()], nomeImagem(veiculo.nome, 0, "reels").replace(/.jpg$/, ".mp4"), { type: "video/mp4" })];
      }
      return Promise.all(imagens!.map(async (im, i) => {
        const res = await fetch(im.jpg);
        if (!res.ok) throw new ErroApi(res.status, "imagem");
        return new File([await res.blob()], nomeImagem(veiculo.nome, i, PAPEL_CARD[im.papel] ?? im.papel), { type: "image/jpeg" });
      }));
    },
  });
  const [envio, setEnvio] = useState<"compartilhou" | "baixou" | "falhou" | null>(null);
  const [copia, setCopia] = useState<"ok" | "falhou" | null>(null);
  const [canal, setCanal] = useState(false);
  const [feitos, marcar] = useFeitos(s.id);
  // Passo feito que a pessoa abriu de novo (um por vez); refeito, encolhe outra vez.
  const [reaberto, setReaberto] = useState<number | null>(null);
  const lista = arquivos.data;
  const compartilha = podeCompartilhar(lista);
  const semImagens = pacote.isError || arquivos.isError;
  const n = imagens?.length ?? 0;
  const legenda = pacote.data?.legenda ?? "";
  const conta = nomeConta(contaDe(s));
  const perfil = perfilInstagram(conta);
  // A marca à mão fica na ação do passo da vez: o primeiro que a pessoa ainda não fez. Feitos os três, a vez é de
  // confirmar (bloco de lápis azul, sem volta). Na lista, quem só traz ideias não posta: sem marca em ação que não é dele.
  const daVez = [1, 2, 3].find((i) => !feitos.has(i)) ?? 4;
  const marca = !(naLista && veiculo.papel === "reporter");
  const vez = (i: number) => marca && daVez === i;
  const classe = (i: number) => (vez(i) ? "acao-lapis -ml-[6px] cursor-pointer disabled:cursor-progress disabled:text-apoio" : "btn-tom btn-p no-underline");
  const concluir = (i: number) => { marcar(i); setReaberto((r) => (r === i ? null : r)); };
  const doPasso = (i: number) => ({ feito: feitos.has(i), aberto: reaberto === i, alternar: () => setReaberto((r) => (r === i ? null : i)) });

  const copiar = async () => {
    try { await navigator.clipboard.writeText(legenda); setCopia("ok"); concluir(2); } catch { setCopia("falhou"); }
  };
  const compartilhar = () => {
    if (!lista) return;
    // Os dois no mesmo gesto (o Safari recusa compartilhar depois de um await): a legenda vai copiada.
    void copiar();
    navigator.share({ files: lista }).then(() => { setEnvio("compartilhou"); concluir(1); }, (e: unknown) => {
      if ((e as Error)?.name !== "AbortError") setEnvio("falhou");
    });
  };
  const baixar = async () => {
    if (!lista) return;
    const arquivo = lista.length === 1 ? lista[0] : new Blob([zipar(await Promise.all(
      lista.map(async (f) => ({ nome: f.name, dados: new Uint8Array(await f.arrayBuffer()) })),
    )) as BlobPart], { type: "application/zip" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(arquivo);
    a.download = lista.length === 1 ? lista[0].name : `${nomeImagem(veiculo.nome, 0, "").replace(/-1\.jpg$/, "")}-post.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
    setEnvio("baixou");
    concluir(1);
  };

  // Canal de WhatsApp, sem API: no celular, o mesmo compartilhar; no computador, a legenda copiada e os arquivos baixados.
  const paraCanal = () => {
    setCanal(true);
    if (compartilha) { compartilhar(); return; }
    void copiar();
    void baixar();
  };

  const rotulo = !lista
    ? (semImagens ? (video ? t("Vídeo indisponível", "Video unavailable") : t("Imagens indisponíveis", "Images unavailable")) : video ? t("Preparando o vídeo…", "Preparing the video…") : t("Preparando as imagens…", "Preparing the images…"))
    : compartilha ? t("Compartilhar no Instagram", "Share to Instagram") : video ? t("Baixar o vídeo", "Download the video") : n > 1 ? t(`Baixar as ${n} imagens`, `Download the ${n} images`) : t("Baixar a imagem", "Download the image");
  const mandar = video ? (compartilha ? t("Mande o vídeo", "Send the video") : t("Baixe o vídeo", "Download the video"))
    : n === 1 ? (compartilha ? t("Mande a imagem", "Send the image") : t("Baixe a imagem", "Download the image"))
      : compartilha ? t("Mande as imagens", "Send the images") : t("Baixe as imagens", "Download the images");
  const onde = perfil ? conta : t("o Instagram", "Instagram");

  return (
    <>
      {s.status === "agendada" && s.agendado_para && (
        <p className="m-0 text-[15px]">{t("Horário anotado: ", "Time noted: ")}<b className="text-texto-forte">{quandoFuturo(s.agendado_para)}</b> <span className="text-apoio">{t("· só um lembrete", "· just a reminder")}</span></p>
      )}
      <ol className="passos">
        <Passo titulo={mandar} {...doPasso(1)} estado={(
          <p role="status" className={envio ? undefined : "sr-only"}>
            {envio === "compartilhou" ? t(`${video ? "Vídeo enviado" : "Imagens enviadas"}${copia === "ok" ? " e legenda copiada" : ""}: no Instagram, cole a legenda e publique.`,
              `${video ? "Video sent" : "Images sent"}${copia === "ok" ? " and caption copied" : ""}: in Instagram, paste the caption and publish.`)
              : envio === "baixou" ? (video ? t("Vídeo baixado. Confira a pasta de downloads.", "Video downloaded. Check your downloads folder.") : t("Imagens baixadas. Confira a pasta de downloads.", "Images downloaded. Check your downloads folder."))
              : envio === "falhou" ? t("Não deu para compartilhar. Baixe as imagens e poste pelo Instagram.", "Couldn't share. Download the images and post them on Instagram.") : ""}
          </p>
        )}>
          <p id="pb-ajuda-1">
            {video
              ? compartilha
                ? t("Abre o compartilhar do celular: escolha Instagram e depois Reels. A legenda fica copiada: no Instagram, toque no campo da legenda e cole.",
                  "Opens your phone's share menu: choose Instagram, then Reels. The caption is copied: in Instagram, tap the caption field and paste.")
                : t("No computador não dá para mandar direto: baixe o MP4 e poste pelo celular ou pelo Instagram no navegador, como Reels.",
                  "You can't send it straight from a computer: download the MP4 and post it as a Reel from your phone or from Instagram in the browser.")
              : compartilha
              ? t("Abre o compartilhar do celular: escolha Instagram e depois Feed. A legenda fica copiada: no Instagram, toque no campo da legenda e cole.",
                "Opens your phone's share menu: choose Instagram, then Feed. The caption is copied: in Instagram, tap the caption field and paste.")
              : n > 1
                ? t("No computador não dá para mandar direto: as imagens vêm num arquivo .zip, na ordem do carrossel. Poste pelo celular ou pelo Instagram no navegador.",
                  "You can't send them straight from a computer: the images come in a .zip file, in carousel order. Post them from your phone or from Instagram in the browser.")
                : t("No computador não dá para mandar direto: baixe e poste pelo celular ou pelo Instagram no navegador.",
                  "You can't send it straight from a computer: download it and post it from your phone or from Instagram in the browser.")}
          </p>
          <button type="button" onClick={compartilha ? compartilhar : baixar} disabled={!lista} aria-describedby="pb-ajuda-1" className={classe(1)}>
            {!vez(1) && (compartilha ? <IconePostar className="size-4" /> : <IconeBaixar className="size-4" />)}
            <span>{rotulo}</span>{vez(1) && lista && <VoltaLapis desenhar />}
          </button>
          {/* Na tela do post, a falha do pacote já aparece no lugar das imagens; na lista, é aqui. */}
          {pacote.isError
            ? naLista && <FalhaCarga oque={t("as imagens", "the images")} tentar={() => pacote.refetch()} />
            : arquivos.isError && <FalhaCarga oque={video ? t("o vídeo para enviar", "the video to send") : t("as imagens para enviar", "the images to send")} tentar={() => arquivos.refetch()} />}
          {compartilha && lista && (
            <button type="button" onClick={baixar} className="link-acao min-h-11 text-[15px]">{video ? t("ou baixar o vídeo", "or download the video") : t("ou baixar as imagens", "or download the images")}</button>
          )}
        </Passo>
        <Passo titulo={t("Copie a legenda", "Copy the caption")} {...doPasso(2)} estado={(
          <p role="status" className={copia === "falhou" ? "text-terracota" : "sr-only"}>
            {copia === "ok" ? t("Legenda copiada.", "Caption copied.") : copia === "falhou" ? t("Não deu para copiar a legenda.", "Couldn't copy the caption.") : ""}
          </p>
        )}>
          {pacote.data ? <TrechoLegenda texto={legenda} /> : !pacote.isError && <div className="esqueleto h-16 w-full" />}
          <button type="button" onClick={copiar} disabled={!pacote.data} className={classe(2)}>
            {!vez(2) && <IconeCopiar className="size-4" />}
            <span>{t("Copiar a legenda", "Copy the caption")}</span>{vez(2) && pacote.data && <VoltaLapis desenhar />}
          </button>
        </Passo>
        <Passo titulo={t("Poste no Instagram", "Post on Instagram")} {...doPasso(3)}>
          <p>
            {compartilha ? t("No Instagram, cole a legenda e publique.", "In Instagram, paste the caption and publish.")
              : video ? t(`Abra ${onde}, escolha o vídeo como Reels e cole a legenda.`, `Open ${onde}, pick the video as a Reel and paste the caption.`)
                : n > 1 ? t(`Abra ${onde}, escolha as imagens na ordem e cole a legenda.`, `Open ${onde}, pick the images in order and paste the caption.`)
                  : t(`Abra ${onde}, escolha a imagem e cole a legenda.`, `Open ${onde}, pick the image and paste the caption.`)}
          </p>
          <a href={perfil ?? "https://www.instagram.com/"} target="_blank" rel="noopener noreferrer" onClick={() => concluir(3)} className={classe(3)}>
            {!vez(3) && <IconeFora className="size-4" />}
            <span>{t("Abrir o Instagram", "Open Instagram")}<span className="sr-only">{t(" (abre em outra aba)", " (opens in a new tab)")}</span></span>{vez(3) && <VoltaLapis desenhar />}
          </a>
        </Passo>
        <Passo titulo={t("Avise que postou", "Confirm you posted")}>
          <Confirmar s={s} aoConfirmar={naLista?.aoConfirmar} />
        </Passo>
      </ol>
      <div className="grid justify-items-start gap-1.5 border-t border-fio pt-3.5">
        <button type="button" className="btn-tom btn-p" disabled={!lista} onClick={paraCanal}>{t("Mandar para o Canal", "Send to the Channel")}</button>
        <p role="status" className="ajuda m-0">{canal
          ? (compartilha ? t("No compartilhar, escolha o WhatsApp e o seu Canal. A legenda fica copiada.", "In the share menu, choose WhatsApp and your Channel. The caption is copied.") : t("Baixado, e a legenda copiada. Abra o seu Canal no WhatsApp e mande.", "Downloaded, and the caption copied. Open your Channel in WhatsApp and send."))
          : t("Canal de WhatsApp é sem API: você manda, sem sair do seu fluxo.", "WhatsApp Channels have no API: you send it yourself.")}</p>
      </div>
    </>
  );
}

function Confirmar({ s, aoConfirmar }: { s: StatusPeca; aoConfirmar?: () => void }) {
  const { veiculo } = useCasca();
  const qc = useQueryClient();
  const [link, setLink] = useState("");
  const [erroLink, setErroLink] = useState<string | null>(null);
  const confirmar = useMutation({
    mutationFn: (url: string | null) => ler(rota.publicada.$post({ param: { tenantId: veiculo.id, id: s.id } }, corpoJson(url ? { url } : {}))),
    onSuccess: () => aoConfirmar?.(),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: chaves.status(veiculo.id, s.id) });
      qc.invalidateQueries({ queryKey: chaves.prontos(veiculo.id) });
      qc.invalidateQueries({ queryKey: chaves.publicacoes(veiculo.id) });
    },
  });
  if (veiculo.papel === "reporter") return <QuemConfirma />;
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const r = linkDoPost(link);
    if ("erro" in r) { setErroLink(r.erro); return; }
    confirmar.mutate(r.url);
  };
  const ocupado = confirmar.isPending || confirmar.isSuccess;
  return (
    <form onSubmit={enviar} noValidate className="grid w-full gap-2">
      <label htmlFor="pb-link" className="text-[14px] font-semibold text-texto-forte">{t("Link do post", "Post link")} <span className="font-normal text-apoio">{t("(opcional)", "(optional)")}</span></label>
      {/* O campo e o bloco de lápis azul na mesma linha quando cabem; na coluna estreita, o botão desce. */}
      <div className="flex flex-wrap gap-2">
        <input id="pb-link" type="url" inputMode="url" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="go" value={link} placeholder="https://www.instagram.com/p/…"
          onChange={(e) => { setLink(e.target.value); setErroLink(null); }}
          aria-invalid={!!erroLink} aria-describedby="pb-link-ajuda" className="entrada w-auto min-w-0 flex-[1_1_150px]" />
        <button type="submit" disabled={ocupado} className="btn-tinta">{ocupado ? t("Confirmando…", "Confirming…") : t("Confirmar que postei", "Confirm I posted")}</button>
      </div>
      <p id="pb-link-ajuda" className={erroLink ? "text-terracota" : undefined}>
        {erroLink ?? t("No Instagram, toque nos três pontos do post e em Copiar link. Sem o link também vale.",
          "In Instagram, tap the three dots on the post, then Copy link. It's fine without the link too.")}
      </p>
      {confirmar.isError && (
        <p role="alert" className="text-[15px] text-terracota">
          {confirmar.error instanceof ErroApi && confirmar.error.status === 409
            ? t("Este post mudou: outra pessoa já confirmou ou ele foi postado sozinho. A tela foi atualizada.",
              "This post changed: someone else already confirmed it, or it was posted automatically. The screen was updated.")
            : confirmar.error instanceof ErroApi && confirmar.error.status === 0
              ? t("Sem conexão. Confira a internet e tente de novo.", "No connection. Check your internet and try again.")
              : t("Não deu para confirmar agora. Tente de novo.", "Couldn't confirm right now. Try again.")}
        </p>
      )}
    </form>
  );
}

// ── conta que posta sozinha ─────────────────────────────────────────────────────────────────────────────────────

/** Na folha da lista o título do estado fica abaixo da manchete (h3, menor); na tela do post é o título da coluna. */
function TituloEstado({ id, lista, children }: { id: string; lista?: NaLista; children: ReactNode }) {
  return lista
    ? <h3 id={id} className="m-0 text-[17px] font-bold text-texto-forte">{children}</h3>
    : <h2 id={id} className="m-0 text-[20px] font-bold text-texto-forte">{children}</h2>;
}

function PostandoSozinho({ s, conta, lista }: { s: StatusPeca; conta: ContaTexto; lista?: NaLista }) {
  const futuro = s.status === "agendada" && s.agendado_para && new Date(s.agendado_para).getTime() > Date.now();
  return (
    <section aria-labelledby="pb-sozinho" className="grid justify-items-start gap-3">
      <div role="status" aria-live="polite">
        <TituloEstado id="pb-sozinho" lista={lista}>
          {conta.modo === "simulada"
            ? (futuro ? t("Simulação marcada", "Simulation scheduled") : t("Simulando a postagem", "Simulating the post"))
            : futuro ? t("Marcado para postar sozinho", "Scheduled to post automatically") : t("Postando sozinho", "Posting automatically")}
        </TituloEstado>
        <p className="m-0 mt-1 text-[17px]">
          {futuro
            ? t(`Sai ${quandoFuturo(s.agendado_para!)} em ${nomeConta(conta)}.`, `Goes out ${quandoFuturo(s.agendado_para!)} on ${nomeConta(conta)}.`)
            : t(`Enviando para ${nomeConta(conta)}. Costuma levar menos de um minuto.`, `Sending to ${nomeConta(conta)}. It usually takes less than a minute.`)}
        </p>
        <p className="m-0 mt-1 text-apoio">
          {conta.modo === "simulada" ? t("Conta de teste: nada sai de verdade.", "Test account: nothing is really posted.") : t("Não precisa fazer nada; quando sair, ele aparece em Postados.", "You don't need to do anything; once it's out, it shows up in Posted.")}{" "}
          {t("Pode sair desta tela: o envio continua.", "You can leave this screen: sending continues.")}
        </p>
      </div>
      <ProximaParaPostar id={s.id} lista={lista} />
    </section>
  );
}

// ── postado ─────────────────────────────────────────────────────────────────────────────────────────────────────

function Postado({ s, conta, lista }: { s: StatusPeca; conta: ContaTexto; lista?: NaLista }) {
  const url = s.publicacao_url && /^https?:\/\//.test(s.publicacao_url) ? s.publicacao_url : null;
  const teste = (s.publicacao_modo ?? conta.modo) === "simulada";
  return (
    <section aria-labelledby="pb-postado" className="grid justify-items-start gap-3">
      <div role="status">
        <TituloEstado id="pb-postado" lista={lista}>{teste ? t("Simulação concluída", "Simulation complete") : t("Postado", "Posted")}</TituloEstado>
        <p className="m-0 mt-1 text-[17px]">
          {teste
            ? t(`Conta de teste ${nomeConta(conta)}: nada saiu de verdade, e o post não tem link.`, `Test account ${nomeConta(conta)}: nothing was really posted, and the post has no link.`)
            : t(`Saiu em ${nomeConta(conta)}${s.publicado_em ? `, ${quando(s.publicado_em)}` : ""}.`, `Posted on ${nomeConta(conta)}${s.publicado_em ? `, ${quando(s.publicado_em)}` : ""}.`)}
        </p>
      </div>
      {url && !teste && (
        <a href={url} target="_blank" rel="noopener noreferrer" className="link-acao min-h-11 content-center">
          {t("Ver no Instagram", "View on Instagram")}<span className="sr-only">{t(" (abre em outra aba)", " (opens in a new tab)")}</span>
        </a>
      )}
      {!url && !teste && <p className="m-0 text-apoio">{t("Sem o link do post: foi confirmado sem ele.", "No post link: it was confirmed without one.")}</p>}
      <ProximaParaPostar id={s.id} lista={lista} />
    </section>
  );
}

/** A próxima ação: o próximo aprovado que espera alguém postar; sem nenhum, as Ideias. */
function ProximaParaPostar({ id, lista }: { id: string; lista?: NaLista }) {
  const { veiculo } = useCasca();
  const proxima = useProntos(veiculo.id).data?.pecas.find((p) => p.id !== id && !postaSozinho(p.conta_modo));
  const ideias = `/t/${veiculo.slug}`;
  // Na lista, a próxima se escolhe ali mesmo (as Ideias estão na lateral); quem só traz ideias não posta.
  if (lista) {
    return proxima && veiculo.papel !== "reporter" ? (
      <button type="button" onClick={() => lista.escolher(proxima.id)} className="acao-lapis -ml-[6px] cursor-pointer"><span>{t("Postar a próxima", "Post the next one")}</span><VoltaLapis desenhar /></button>
    ) : null;
  }
  return proxima ? (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      <Link to={`${ideias}/p/${proxima.id}`} viewTransition className="acao-lapis -ml-[6px]"><span>{t("Postar a próxima", "Post the next one")}</span><VoltaLapis desenhar /></Link>
      <Link to={ideias} viewTransition className="link-acao">{t("Voltar às Ideias", "Back to Ideas")}</Link>
    </div>
  ) : (
    <Link to={ideias} viewTransition className="acao-lapis -ml-[6px]"><span>{t("Voltar às Ideias", "Back to Ideas")}</span><VoltaLapis desenhar /></Link>
  );
}
