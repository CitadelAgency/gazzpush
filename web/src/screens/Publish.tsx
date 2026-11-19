// Publish (Phase F): the approved post. Manual account: the posting script, numbered (send the images to Instagram:
// share from the phone, with the JPEGs; on desktop, download; copy the caption; post; report back here, with the post's
// link if there is one). A step done on this visit shrinks to a line with the check. An account that posts by itself:
// the publication's progress. Posted: when it went out and the link. The screen's hand mark is the pencil loop on the
// current step's action (Share/Download first; once posted, the next post to post). The panel (`PanelPublish`) is the
// same here and in Ready to post, where it sits beside the desk (./Post).
import { useCallback, useLayoutEffect, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { api, bodyJson, ApiError, read } from "../api";
import { useShell } from "../shell/context";
import { InFolio } from "../shell/Folio";
import { IconDownload, IconCopy, IconOutside, IconPost, IconBack } from "../shell/icons";
import { FailureLoad, Parts } from "../common";
import {
  CARD_ROLE, keys, fromPostLink, formatLabel, accountName, imageName, profileInstagram, alonePosts, when, whenFuture, whoConfirms, readyStatus,
  useMembers, usePieces, readyUse, type PieceStatus,
} from "../queue";
import { t } from "../language";
import { BackPencil } from "../kit/Pencil";
import { zipFiles } from "../zip";

const route = api.t[":tenantId"].pecas[":id"];

/** Signed images for 24 h and the ready caption (at the Instagram limit). The screen and the panel ask for the same query. */
function usePackage(s: PieceStatus) {
  const { veiculo: outlet } = useShell();
  return useQuery({
    queryKey: [...keys.peca(outlet.id, s.id), "pacote", s.versao],
    queryFn: () => read(route.pacote.$get({ param: { tenantId: outlet.id, id: s.id } })),
    staleTime: 12 * 60 * 60_000,
  });
}

type Package = ReturnType<typeof usePackage>;
type TextAccount = { modo: string; nome: string | null; external_id: string | null };
const accountOf = (s: PieceStatus): TextAccount => ({ modo: s.conta_modo ?? "manual", nome: s.conta_nome, external_id: s.conta_external_id });
/** "posted today, 10:02" or the approved one's status ("approved yesterday, 18:40", "noted for…", "posting by itself"). */
const condition = (s: PieceStatus) => (s.status !== "publicada" ? readyStatus(s)
  : s.publicado_em ? t(`postado ${when(s.publicado_em)}`, `posted ${when(s.publicado_em)}`) : t("postado", "posted"));

/** `deRevisao`: the post was just approved on this screen (the person came from review). */
export default function Publish({ s, deRevisao: review }: { s: PieceStatus; deRevisao: boolean }) {
  const { veiculo: outlet, marcarPeca: markPiece } = useShell();
  const posted = s.status === "publicada";
  useLayoutEffect(() => { markPiece(posted ? "postado" : "postar"); return () => markPiece(null); }, [posted, markPiece]);
  const pkg = usePackage(s);
  const base = `/t/${outlet.slug}`;
  const headline = s.manchete ?? s.titulo;

  return (
    <div className="mx-auto max-w-[1180px] px-5 pt-4 pb-12 lg:px-12 lg:pt-6">
      {/* The way back lives in the folio: the list the post came from and, beside it, the headline. */}
      <InFolio>
        <Link to={posted ? `${base}/postados` : `${base}/postar`} viewTransition>
          <IconBack className="size-4" />{posted ? t("Postados", "Posted") : t("Prontos para postar", "Ready to post")}
        </Link>
        <span className="sep" aria-hidden="true">/</span>
        <b>{headline}</b>
      </InFolio>
      <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_420px] xl:gap-12">
        <div className="min-w-0">
          <p className="mono m-0 mb-2 text-apoio">
            <Parts partes={[formatLabel(s.formato, pkg.data?.imagens.length), accountName(accountOf(s)), condition(s)]} />
          </p>
          <h1 className="manchete m-0 max-w-[30ch] text-[24px] lg:text-[32px]">{headline}</h1>
          <Images pacote={pkg} carimbo={posted ? { texto: t("Postado", "Posted"), bate: false }
            : s.status === "aprovada" || s.status === "agendada" ? { texto: t("Aprovado", "Approved"), bate: false } : null} />
          {/* An approved carousel: the Reels also comes from here (it becomes a new post, which goes through To approve). */}
          {s.formato === "carrossel" && s.status === "aprovada" && outlet.papel !== "reporter" && (
            <p className="m-0 mt-3 flex flex-wrap items-center gap-x-3">
              <Link to={`${base}/p/${s.id}/reels`} className="btn-sec bg-papel-2 no-underline">{t("Fazer Reels", "Make a Reel")}</Link>
              <span className="ajuda">{t("Os mesmos cards em vídeo, em pé.", "The same cards as a vertical video.")}</span>
            </p>
          )}
        </div>
        <div className="mt-6 grid content-start gap-6 xl:mt-0">
          <PanelPublish s={s} deRevisao={review} />
        </div>
      </div>
    </div>
  );
}

/** What Ready to post gives the panel: choosing another post without leaving the list, and knowing this one was confirmed. */
export type InList = { escolher: (id: string) => void; aoConfirmar: () => void };

/**
 * The publish panel of an approved (or already posted) post, with its queries and mutations: the script for whoever
 * posts by hand, the progress of an account that posts by itself, the posted state. On the post screen it is the column
 * beside the images. In Ready to post (`lista`) it is the sheet beside the desk: the title is the headline, "Open the
 * post" leads to its screen (all the images, the Reels) and "Post the next one" selects right there.
 */
export function PanelPublish({ s, deRevisao: review = false, lista: list }: { s: PieceStatus; deRevisao?: boolean; lista?: InList }) {
  const { veiculo: outlet } = useShell();
  const pkg = usePackage(s);
  const account = accountOf(s);
  const posted = s.status === "publicada";
  const manual = !posted && !alonePosts(s.conta_modo);
  const body = posted ? <Posted s={s} conta={account} lista={list} />
    : manual ? <PostHand s={s} pacote={pkg} lista={list} />
      : <AlonePosting s={s} conta={account} lista={list} />;
  const label = manual && <p className="mono m-0 text-[10.5px] tracking-[.1em] text-apoio uppercase">{t("Roteiro de postagem", "Posting checklist")}</p>;
  if (list) {
    return (
      <section className="roteiro" aria-labelledby="pb-titulo">
        <div>
          <div className="flex items-baseline gap-3">
            {label}
            <Link to={`/t/${outlet.slug}/p/${s.id}`} viewTransition className="link-acao ml-auto text-[14px]">{t("Abrir o post", "Open post")}</Link>
          </div>
          <h2 id="pb-titulo">{s.manchete ?? s.titulo}</h2>
          <p className="mono m-0 mt-1.5 text-apoio"><Parts partes={[formatLabel(s.formato, pkg.data?.imagens.length), condition(s), accountName(account)]} /></p>
        </div>
        {body}
      </section>
    );
  }
  if (!manual) return body;
  return (
    <>
      {review && <Approved id={s.id} />}
      <section className="roteiro" aria-labelledby="pb-titulo">
        <div>
          {label}
          <h2 id="pb-titulo">{t("Postar no Instagram", "Post to Instagram")} <span className="font-medium text-apoio">{accountName(account)}</span></h2>
        </div>
        {body}
      </section>
    </>
  );
}

/** The images that go to Instagram, small: here you check what goes out, you do not read it (that was in review). */
function Images({ pacote: pkg, carimbo: timestamp }: { pacote: Package; carimbo: { texto: string; bate: boolean } | null }) {
  if (pkg.isError) return <div className="mt-5"><FailureLoad oque={t("as imagens", "the images")} tentar={() => pkg.refetch()} /></div>;
  const images = pkg.data?.imagens;
  // Reels: the upright video, stopped on the cover (here you check what goes out; playing is up to the person).
  if (pkg.data?.formato === "reels" && pkg.data.video) {
    return (
      <video src={pkg.data.video} poster={images?.[0]?.jpg} controls playsInline preload="metadata" aria-label={t("Vídeo do Reels", "Reel video")}
        className="mt-5 block aspect-[9/16] h-auto w-[min(46vw,220px)] rounded-card bg-texto-forte object-contain shadow-prova" />
    );
  }
  const several = !!images && images.length > 1;
  return (
    <div className="palco mt-5">
      {/* The state's stamp (desktop only, on the desk). It arrives already set: Review is what stamps it, at Approve. */}
      {timestamp && <span aria-hidden="true" className={`palco-carimbo carimbo ${timestamp.bate ? "carimbo-bate" : ""}`}>{timestamp.texto}</span>}
      {several && <p className="mono m-0 mb-2 text-apoio lg:mb-5">{t(`${images.length} imagens, nesta ordem no carrossel`, `${images.length} images, in carousel order`)}</p>}
      {/* On mobile the strip scrolls sideways: it takes focus so the keyboard arrows scroll it too. On desktop, the contact sheet. */}
      <ul aria-label={t("Imagens do post", "Post images")} aria-busy={!images} tabIndex={0}
        className={`-mx-5 m-0 flex list-none gap-2 overflow-x-auto px-5 pb-2 [scrollbar-width:none] lg:mx-0 lg:grid lg:gap-5 lg:overflow-visible lg:px-0 lg:pb-0 [&::-webkit-scrollbar]:hidden ${images && images.length === 1 ? "lg:mx-auto lg:max-w-[340px] lg:grid-cols-1" : "lg:grid-cols-2"}`}>
        {images
          ? images.map((im, i) => (
            <li key={im.papel + i} className="w-[min(36vw,150px)] flex-none lg:w-auto">
              <img src={im.jpg} width={1080} height={1350} loading={i > 1 ? "lazy" : undefined}
                alt={t(`Card ${i + 1} de ${images.length}: ${CARD_ROLE[im.papel] ?? im.papel}`, `Card ${i + 1} of ${images.length}: ${CARD_ROLE[im.papel] ?? im.papel}`)}
                className="block aspect-[4/5] h-auto w-full rounded-card bg-papel-2 object-cover shadow-prova" />
            </li>
          ))
          : [0, 1].map((i) => <li key={i} className="esqueleto aspect-[4/5] w-[min(36vw,150px)] flex-none lg:w-auto" />)}
      </ul>
    </div>
  );
}

/** Right after approving: the decision's outcome and, if any, the next one to review (in text: the mark belongs to posting). */
function Approved({ id }: { id: string }) {
  const { veiculo: outlet } = useShell();
  const next = usePieces(outlet.id).data?.pecas.find((p) => p.status === "revisao" && p.id !== id);
  return (
    <div role="status" className="grid justify-items-start gap-1">
      <h2 className="m-0 text-[20px] font-bold text-texto-forte">{t("Aprovado", "Approved")}</h2>
      <p className="m-0 text-[17px]">{t("Está em Prontos para postar: poste agora ou depois.", "It's in Ready to post: post it now or later.")}</p>
      {next && <Link to={`/t/${outlet.slug}/p/${next.id}`} viewTransition className="link-acao min-h-11 content-center">{t("Revisar a próxima", "Review the next one")}</Link>}
    </div>
  );
}

// ── manual account: the person posts ────────────────────────────────────────────────────────────────────────────────

/** For someone who only brings ideas: who confirms that the post went out, by name. */
function WhoConfirms() {
  const { veiculo: outlet } = useShell();
  const members = useMembers(outlet.id);
  return <p className="m-0 text-[15px] text-texto">{whoConfirms(members.data?.membros ?? [])}</p>;
}

/** Mobile (touch) with file sharing: sends straight to Instagram. On desktop, download. */
const hasTouch = () => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
const canShare = (files: File[] | undefined) => {
  if (!hasTouch() || typeof navigator.share !== "function" || typeof navigator.canShare !== "function") return false;
  // Before the files arrive, the device decides (the step's text does not switch midway); with them, the browser confirms.
  try { return !files || navigator.canShare({ files: files }); } catch { return false; }
};

/**
 * The steps the person already did on this visit, per post. Screen state only (nothing goes to the API): it says where
 * they stopped, in the list and on the post screen, and goes away on reload.
 */
const doneInVisit = new Map<string, ReadonlySet<number>>();
function useDone(id: string) {
  const [done, setDone] = useState<ReadonlySet<number>>(() => doneInVisit.get(id) ?? new Set());
  const mark = useCallback((step: number) => {
    const created = new Set(doneInVisit.get(id)).add(step);
    doneInVisit.set(id, created);
    setDone(created);
  }, [id]);
  return [done, mark] as const;
}

/**
 * A step of the script (the number comes from CSS, `.passo`). Done, it shrinks to a line with the check, and the title
 * becomes the button that opens it again (download again, for example). `estado` is the notice of what the action did:
 * it stays outside the body, to remain on screen (and for the screen reader) when the step shrinks.
 */
function Step({ titulo: title, feito: done = false, aberto: isOpen = false, alternar: toggle, estado: state, children }: {
  titulo: string; feito?: boolean; aberto?: boolean; alternar?: () => void; estado?: ReactNode; children: ReactNode;
}) {
  return (
    <li className="passo" data-feito={done ? "" : undefined}>
      <div>
        <h3>
          {done
            ? <button type="button" data-linha aria-expanded={isOpen} onClick={toggle}>{title}<span className="sr-only">{t(": feito", ": done")}</span></button>
            : title}
        </h3>
        {(!done || isOpen) && children}
        {state}
      </div>
    </li>
  );
}

/** The caption in the step: the first paragraph and, if there is more, "see all" (copying is the step's action). */
function CaptionPassage({ texto: text }: { texto: string }) {
  const [whole, wholeSet] = useState(false);
  const every = text.trim();
  const start = every.split("\n")[0];
  return (
    <>
      <p id="pb-legenda" className="whitespace-pre-line">{whole ? every : start}</p>
      {start !== every && (
        <button type="button" onClick={() => wholeSet((v) => !v)} aria-expanded={whole} aria-controls="pb-legenda" className="link-acao -my-2.5 min-h-11 text-[14px]">
          {whole ? t("ver menos", "show less") : t("ver inteira", "show all")}
        </button>
      )}
    </>
  );
}

function PostHand({ s, pacote: pkg, lista: inList }: { s: PieceStatus; pacote: Package; lista?: InList }) {
  const { veiculo: outlet } = useShell();
  const images = pkg.data?.imagens;
  // Reels: the file is the MP4 (just one), in place of the images.
  const video = pkg.data?.formato === "reels" ? pkg.data.video : null;
  // The JPEGs (or the MP4) in memory before the tap: share must be called right in the gesture, without waiting for a download.
  const files = useQuery({
    queryKey: [...keys.peca(outlet.id, s.id), "arquivos", s.versao],
    enabled: !!images,
    staleTime: Infinity,
    queryFn: async () => {
      if (video) {
        const res = await fetch(video);
        if (!res.ok) throw new ApiError(res.status, "video");
        return [new File([await res.blob()], imageName(outlet.nome, 0, "reels").replace(/.jpg$/, ".mp4"), { type: "video/mp4" })];
      }
      return Promise.all(images!.map(async (im, i) => {
        const res = await fetch(im.jpg);
        if (!res.ok) throw new ApiError(res.status, "imagem");
        return new File([await res.blob()], imageName(outlet.nome, i, CARD_ROLE[im.papel] ?? im.papel), { type: "image/jpeg" });
      }));
    },
  });
  const [upload, setUpload] = useState<"compartilhou" | "baixou" | "falhou" | null>(null);
  const [duplicate, setCopy] = useState<"ok" | "falhou" | null>(null);
  const [channel, setChannel] = useState(false);
  const [done, mark] = useDone(s.id);
  // A done step the person opened again (one at a time); redone, it shrinks again.
  const [reopened, setReopened] = useState<number | null>(null);
  const list = files.data;
  const shares = canShare(list);
  const withoutImages = pkg.isError || files.isError;
  const n = images?.length ?? 0;
  const caption = pkg.data?.legenda ?? "";
  const account = accountName(accountOf(s));
  const profile = profileInstagram(account);
  // The hand mark sits on the current step's action: the first one the person has not done yet. With all three done, it
  // is time to confirm (a blue-pencil block, no loop). In the list, whoever only brings ideas does not post: no mark on an action that is not theirs.
  const fromTurn = [1, 2, 3].find((i) => !done.has(i)) ?? 4;
  const brand = !(inList && outlet.papel === "reporter");
  const turn = (i: number) => brand && fromTurn === i;
  const className = (i: number) => (turn(i) ? "acao-lapis -ml-[6px] cursor-pointer disabled:cursor-progress disabled:text-apoio" : "btn-tom btn-p no-underline");
  const finish = (i: number) => { mark(i); setReopened((r) => (r === i ? null : r)); };
  const fromStep = (i: number) => ({ feito: done.has(i), aberto: reopened === i, alternar: () => setReopened((r) => (r === i ? null : i)) });

  const copy = async () => {
    try { await navigator.clipboard.writeText(caption); setCopy("ok"); finish(2); } catch { setCopy("falhou"); }
  };
  const share = () => {
    if (!list) return;
    // Both in the same gesture (Safari refuses to share after an await): the caption goes copied.
    void copy();
    navigator.share({ files: list }).then(() => { setUpload("compartilhou"); finish(1); }, (e: unknown) => {
      if ((e as Error)?.name !== "AbortError") setUpload("falhou");
    });
  };
  const download = async () => {
    if (!list) return;
    const file = list.length === 1 ? list[0] : new Blob([zipFiles(await Promise.all(
      list.map(async (f) => ({ nome: f.name, dados: new Uint8Array(await f.arrayBuffer()) })),
    )) as BlobPart], { type: "application/zip" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(file);
    a.download = list.length === 1 ? list[0].name : `${imageName(outlet.nome, 0, "").replace(/-1\.jpg$/, "")}-post.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
    setUpload("baixou");
    finish(1);
  };

  // WhatsApp channel, no API: on mobile, the same share; on desktop, the caption copied and the files downloaded.
  const toChannel = () => {
    setChannel(true);
    if (shares) { share(); return; }
    void copy();
    void download();
  };

  const label = !list
    ? (withoutImages ? (video ? t("Vídeo indisponível", "Video unavailable") : t("Imagens indisponíveis", "Images unavailable")) : video ? t("Preparando o vídeo…", "Preparing the video…") : t("Preparando as imagens…", "Preparing the images…"))
    : shares ? t("Compartilhar no Instagram", "Share to Instagram") : video ? t("Baixar o vídeo", "Download the video") : n > 1 ? t(`Baixar as ${n} imagens`, `Download the ${n} images`) : t("Baixar a imagem", "Download the image");
  const send = video ? (shares ? t("Mande o vídeo", "Send the video") : t("Baixe o vídeo", "Download the video"))
    : n === 1 ? (shares ? t("Mande a imagem", "Send the image") : t("Baixe a imagem", "Download the image"))
      : shares ? t("Mande as imagens", "Send the images") : t("Baixe as imagens", "Download the images");
  const where = profile ? account : t("o Instagram", "Instagram");

  return (
    <>
      {s.status === "agendada" && s.agendado_para && (
        <p className="m-0 text-[15px]">{t("Horário anotado: ", "Time noted: ")}<b className="text-texto-forte">{whenFuture(s.agendado_para)}</b> <span className="text-apoio">{t("· só um lembrete", "· just a reminder")}</span></p>
      )}
      <ol className="passos">
        <Step titulo={send} {...fromStep(1)} estado={(
          <p role="status" className={upload ? undefined : "sr-only"}>
            {upload === "compartilhou" ? t(`${video ? "Vídeo enviado" : "Imagens enviadas"}${duplicate === "ok" ? " e legenda copiada" : ""}: no Instagram, cole a legenda e publique.`,
              `${video ? "Video sent" : "Images sent"}${duplicate === "ok" ? " and caption copied" : ""}: in Instagram, paste the caption and publish.`)
              : upload === "baixou" ? (video ? t("Vídeo baixado. Confira a pasta de downloads.", "Video downloaded. Check your downloads folder.") : t("Imagens baixadas. Confira a pasta de downloads.", "Images downloaded. Check your downloads folder."))
              : upload === "falhou" ? t("Não deu para compartilhar. Baixe as imagens e poste pelo Instagram.", "Couldn't share. Download the images and post them on Instagram.") : ""}
          </p>
        )}>
          <p id="pb-ajuda-1">
            {video
              ? shares
                ? t("Abre o compartilhar do celular: escolha Instagram e depois Reels. A legenda fica copiada: no Instagram, toque no campo da legenda e cole.",
                  "Opens your phone's share menu: choose Instagram, then Reels. The caption is copied: in Instagram, tap the caption field and paste.")
                : t("No computador não dá para mandar direto: baixe o MP4 e poste pelo celular ou pelo Instagram no navegador, como Reels.",
                  "You can't send it straight from a computer: download the MP4 and post it as a Reel from your phone or from Instagram in the browser.")
              : shares
              ? t("Abre o compartilhar do celular: escolha Instagram e depois Feed. A legenda fica copiada: no Instagram, toque no campo da legenda e cole.",
                "Opens your phone's share menu: choose Instagram, then Feed. The caption is copied: in Instagram, tap the caption field and paste.")
              : n > 1
                ? t("No computador não dá para mandar direto: as imagens vêm num arquivo .zip, na ordem do carrossel. Poste pelo celular ou pelo Instagram no navegador.",
                  "You can't send them straight from a computer: the images come in a .zip file, in carousel order. Post them from your phone or from Instagram in the browser.")
                : t("No computador não dá para mandar direto: baixe e poste pelo celular ou pelo Instagram no navegador.",
                  "You can't send it straight from a computer: download it and post it from your phone or from Instagram in the browser.")}
          </p>
          <button type="button" onClick={shares ? share : download} disabled={!list} aria-describedby="pb-ajuda-1" className={className(1)}>
            {!turn(1) && (shares ? <IconPost className="size-4" /> : <IconDownload className="size-4" />)}
            <span>{label}</span>{turn(1) && list && <BackPencil desenhar />}
          </button>
          {/* On the post screen, the package failure already shows in place of the images; in the list, it is here. */}
          {pkg.isError
            ? inList && <FailureLoad oque={t("as imagens", "the images")} tentar={() => pkg.refetch()} />
            : files.isError && <FailureLoad oque={video ? t("o vídeo para enviar", "the video to send") : t("as imagens para enviar", "the images to send")} tentar={() => files.refetch()} />}
          {shares && list && (
            <button type="button" onClick={download} className="link-acao min-h-11 text-[15px]">{video ? t("ou baixar o vídeo", "or download the video") : t("ou baixar as imagens", "or download the images")}</button>
          )}
        </Step>
        <Step titulo={t("Copie a legenda", "Copy the caption")} {...fromStep(2)} estado={(
          <p role="status" className={duplicate === "falhou" ? "text-terracota" : "sr-only"}>
            {duplicate === "ok" ? t("Legenda copiada.", "Caption copied.") : duplicate === "falhou" ? t("Não deu para copiar a legenda.", "Couldn't copy the caption.") : ""}
          </p>
        )}>
          {pkg.data ? <CaptionPassage texto={caption} /> : !pkg.isError && <div className="esqueleto h-16 w-full" />}
          <button type="button" onClick={copy} disabled={!pkg.data} className={className(2)}>
            {!turn(2) && <IconCopy className="size-4" />}
            <span>{t("Copiar a legenda", "Copy the caption")}</span>{turn(2) && pkg.data && <BackPencil desenhar />}
          </button>
        </Step>
        <Step titulo={t("Poste no Instagram", "Post on Instagram")} {...fromStep(3)}>
          <p>
            {shares ? t("No Instagram, cole a legenda e publique.", "In Instagram, paste the caption and publish.")
              : video ? t(`Abra ${where}, escolha o vídeo como Reels e cole a legenda.`, `Open ${where}, pick the video as a Reel and paste the caption.`)
                : n > 1 ? t(`Abra ${where}, escolha as imagens na ordem e cole a legenda.`, `Open ${where}, pick the images in order and paste the caption.`)
                  : t(`Abra ${where}, escolha a imagem e cole a legenda.`, `Open ${where}, pick the image and paste the caption.`)}
          </p>
          <a href={profile ?? "https://www.instagram.com/"} target="_blank" rel="noopener noreferrer" onClick={() => finish(3)} className={className(3)}>
            {!turn(3) && <IconOutside className="size-4" />}
            <span>{t("Abrir o Instagram", "Open Instagram")}<span className="sr-only">{t(" (abre em outra aba)", " (opens in a new tab)")}</span></span>{turn(3) && <BackPencil desenhar />}
          </a>
        </Step>
        <Step titulo={t("Avise que postou", "Confirm you posted")}>
          <Confirm s={s} aoConfirmar={inList?.aoConfirmar} />
        </Step>
      </ol>
      <div className="grid justify-items-start gap-1.5 border-t border-fio pt-3.5">
        <button type="button" className="btn-tom btn-p" disabled={!list} onClick={toChannel}>{t("Mandar para o Canal", "Send to the Channel")}</button>
        <p role="status" className="ajuda m-0">{channel
          ? (shares ? t("No compartilhar, escolha o WhatsApp e o seu Canal. A legenda fica copiada.", "In the share menu, choose WhatsApp and your Channel. The caption is copied.") : t("Baixado, e a legenda copiada. Abra o seu Canal no WhatsApp e mande.", "Downloaded, and the caption copied. Open your Channel in WhatsApp and send."))
          : t("Canal de WhatsApp é sem API: você manda, sem sair do seu fluxo.", "WhatsApp Channels have no API: you send it yourself.")}</p>
      </div>
    </>
  );
}

function Confirm({ s, aoConfirmar: onConfirm }: { s: PieceStatus; aoConfirmar?: () => void }) {
  const { veiculo: outlet } = useShell();
  const qc = useQueryClient();
  const [link, setLink] = useState("");
  const [linkError, setErrorLink] = useState<string | null>(null);
  const confirm = useMutation({
    mutationFn: (url: string | null) => read(route.publicada.$post({ param: { tenantId: outlet.id, id: s.id } }, bodyJson(url ? { url } : {}))),
    onSuccess: () => onConfirm?.(),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: keys.status(outlet.id, s.id) });
      qc.invalidateQueries({ queryKey: keys.prontos(outlet.id) });
      qc.invalidateQueries({ queryKey: keys.publicacoes(outlet.id) });
    },
  });
  if (outlet.papel === "reporter") return <WhoConfirms />;
  const send = (e: FormEvent) => {
    e.preventDefault();
    const r = fromPostLink(link);
    if ("erro" in r) { setErrorLink(r.erro); return; }
    confirm.mutate(r.url);
  };
  const busy = confirm.isPending || confirm.isSuccess;
  return (
    <form onSubmit={send} noValidate className="grid w-full gap-2">
      <label htmlFor="pb-link" className="text-[14px] font-semibold text-texto-forte">{t("Link do post", "Post link")} <span className="font-normal text-apoio">{t("(opcional)", "(optional)")}</span></label>
      {/* The field and the blue-pencil block on the same line when they fit; in the narrow column, the button moves down. */}
      <div className="flex flex-wrap gap-2">
        <input id="pb-link" type="url" inputMode="url" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="go" value={link} placeholder="https://www.instagram.com/p/…"
          onChange={(e) => { setLink(e.target.value); setErrorLink(null); }}
          aria-invalid={!!linkError} aria-describedby="pb-link-ajuda" className="entrada w-auto min-w-0 flex-[1_1_150px]" />
        <button type="submit" disabled={busy} className="btn-tinta">{busy ? t("Confirmando…", "Confirming…") : t("Confirmar que postei", "Confirm I posted")}</button>
      </div>
      <p id="pb-link-ajuda" className={linkError ? "text-terracota" : undefined}>
        {linkError ?? t("No Instagram, toque nos três pontos do post e em Copiar link. Sem o link também vale.",
          "In Instagram, tap the three dots on the post, then Copy link. It's fine without the link too.")}
      </p>
      {confirm.isError && (
        <p role="alert" className="text-[15px] text-terracota">
          {confirm.error instanceof ApiError && confirm.error.status === 409
            ? t("Este post mudou: outra pessoa já confirmou ou ele foi postado sozinho. A tela foi atualizada.",
              "This post changed: someone else already confirmed it, or it was posted automatically. The screen was updated.")
            : confirm.error instanceof ApiError && confirm.error.status === 0
              ? t("Sem conexão. Confira a internet e tente de novo.", "No connection. Check your internet and try again.")
              : t("Não deu para confirmar agora. Tente de novo.", "Couldn't confirm right now. Try again.")}
        </p>
      )}
    </form>
  );
}

// ── account that posts by itself ────────────────────────────────────────────────────────────────────────────────

/** In the list's sheet the state's title sits below the headline (h3, smaller); on the post screen it is the column's title. */
function StateTitle({ id, lista: list, children }: { id: string; lista?: InList; children: ReactNode }) {
  return list
    ? <h3 id={id} className="m-0 text-[17px] font-bold text-texto-forte">{children}</h3>
    : <h2 id={id} className="m-0 text-[20px] font-bold text-texto-forte">{children}</h2>;
}

function AlonePosting({ s, conta: account, lista: list }: { s: PieceStatus; conta: TextAccount; lista?: InList }) {
  const future = s.status === "agendada" && s.agendado_para && new Date(s.agendado_para).getTime() > Date.now();
  return (
    <section aria-labelledby="pb-sozinho" className="grid justify-items-start gap-3">
      <div role="status" aria-live="polite">
        <StateTitle id="pb-sozinho" lista={list}>
          {account.modo === "simulada"
            ? (future ? t("Simulação marcada", "Simulation scheduled") : t("Simulando a postagem", "Simulating the post"))
            : future ? t("Marcado para postar sozinho", "Scheduled to post automatically") : t("Postando sozinho", "Posting automatically")}
        </StateTitle>
        <p className="m-0 mt-1 text-[17px]">
          {future
            ? t(`Sai ${whenFuture(s.agendado_para!)} em ${accountName(account)}.`, `Goes out ${whenFuture(s.agendado_para!)} on ${accountName(account)}.`)
            : t(`Enviando para ${accountName(account)}. Costuma levar menos de um minuto.`, `Sending to ${accountName(account)}. It usually takes less than a minute.`)}
        </p>
        <p className="m-0 mt-1 text-apoio">
          {account.modo === "simulada" ? t("Conta de teste: nada sai de verdade.", "Test account: nothing is really posted.") : t("Não precisa fazer nada; quando sair, ele aparece em Postados.", "You don't need to do anything; once it's out, it shows up in Posted.")}{" "}
          {t("Pode sair desta tela: o envio continua.", "You can leave this screen: sending continues.")}
        </p>
      </div>
      <NextToPost id={s.id} lista={list} />
    </section>
  );
}

// ── postado ─────────────────────────────────────────────────────────────────────────────────────────────────────

function Posted({ s, conta: account, lista: list }: { s: PieceStatus; conta: TextAccount; lista?: InList }) {
  const url = s.publicacao_url && /^https?:\/\//.test(s.publicacao_url) ? s.publicacao_url : null;
  const test = (s.publicacao_modo ?? account.modo) === "simulada";
  return (
    <section aria-labelledby="pb-postado" className="grid justify-items-start gap-3">
      <div role="status">
        <StateTitle id="pb-postado" lista={list}>{test ? t("Simulação concluída", "Simulation complete") : t("Postado", "Posted")}</StateTitle>
        <p className="m-0 mt-1 text-[17px]">
          {test
            ? t(`Conta de teste ${accountName(account)}: nada saiu de verdade, e o post não tem link.`, `Test account ${accountName(account)}: nothing was really posted, and the post has no link.`)
            : t(`Saiu em ${accountName(account)}${s.publicado_em ? `, ${when(s.publicado_em)}` : ""}.`, `Posted on ${accountName(account)}${s.publicado_em ? `, ${when(s.publicado_em)}` : ""}.`)}
        </p>
      </div>
      {url && !test && (
        <a href={url} target="_blank" rel="noopener noreferrer" className="link-acao min-h-11 content-center">
          {t("Ver no Instagram", "View on Instagram")}<span className="sr-only">{t(" (abre em outra aba)", " (opens in a new tab)")}</span>
        </a>
      )}
      {!url && !test && <p className="m-0 text-apoio">{t("Sem o link do post: foi confirmado sem ele.", "No post link: it was confirmed without one.")}</p>}
      <NextToPost id={s.id} lista={list} />
    </section>
  );
}

/** The next action: the next approved post waiting for someone to post it; with none, Ideas. */
function NextToPost({ id, lista: list }: { id: string; lista?: InList }) {
  const { veiculo: outlet } = useShell();
  const next = readyUse(outlet.id).data?.pecas.find((p) => p.id !== id && !alonePosts(p.conta_modo));
  const ideas = `/t/${outlet.slug}`;
  // In the list, the next one is chosen right there (Ideas are in the sidebar); whoever only brings ideas does not post.
  if (list) {
    return next && outlet.papel !== "reporter" ? (
      <button type="button" onClick={() => list.escolher(next.id)} className="acao-lapis -ml-[6px] cursor-pointer"><span>{t("Postar a próxima", "Post the next one")}</span><BackPencil desenhar /></button>
    ) : null;
  }
  return next ? (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      <Link to={`${ideas}/p/${next.id}`} viewTransition className="acao-lapis -ml-[6px]"><span>{t("Postar a próxima", "Post the next one")}</span><BackPencil desenhar /></Link>
      <Link to={ideas} viewTransition className="link-acao">{t("Voltar às Ideias", "Back to Ideas")}</Link>
    </div>
  ) : (
    <Link to={ideas} viewTransition className="acao-lapis -ml-[6px]"><span>{t("Voltar às Ideias", "Back to Ideas")}</span><BackPencil desenhar /></Link>
  );
}
