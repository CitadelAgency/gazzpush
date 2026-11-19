// The "New idea" sheet (+ New): a link, what happened as text or a news screenshot become an idea at the top of Ideas,
// through the same path as the sources. Opens from any screen through the URL's `?nova=<tab>` (back closes it). A
// native dialog: on mobile it rises from the bottom, on desktop it sits at the top, centred. The action is a blue-pencil
// block (form). With the Google configuration on the server, the Docs tab brings a Google Docs document chosen in the Picker.
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { api, ApiError, fileBody, bodyJson, read, type Success } from "../api";
import { NEW_MODES, keys, printScale, newMessage, type NewMode } from "../queue";
import { connectGoogle, chooseDoc } from "../onboarding/google";
import { t } from "../language";
import { useMe } from "../session";
import { IconClose } from "./icons";

const route = api.t[":tenantId"].pautas;
export type Brought = Success<Awaited<ReturnType<typeof route.$post>>>;

/** Screenshot → JPEG up to 1200 px wide. Also opens formats the server does not accept (HEIC on iPhone). */
async function preparePrint(file: File): Promise<Blob> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new ApiError(400, t("imagem ilegível", "unreadable image"), "imagem_invalida");
  }
  const k = printScale(bmp.width, bmp.height);
  const screen = document.createElement("canvas");
  screen.width = Math.round(bmp.width * k);
  screen.height = Math.round(bmp.height * k);
  const g = screen.getContext("2d")!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, screen.width, screen.height);
  g.drawImage(bmp, 0, 0, screen.width, screen.height);
  bmp.close();
  return new Promise((ok, failure) => screen.toBlob((b) => (b ? ok(b) : failure(new ApiError(400, t("imagem ilegível", "unreadable image"), "imagem_invalida"))), "image/jpeg", 0.88));
}

const PENDING: Record<NewMode, string> = {
  get link() { return t("Lendo a notícia…", "Reading the story…"); },
  get texto() { return t("Lendo o relato…", "Reading your account…"); },
  get print() { return t("Lendo o print…", "Reading the screenshot…"); },
  get docs() { return t("Lendo o documento…", "Reading the document…"); },
  get anuncio() { return t("Lendo o briefing…", "Reading the brief…"); },
};
const RECONNECT = new Set(["sem_conta", "reconectar"]);

export default function NewSheet({ tenantId, slug, autoral: author, modo: request, trocar: swap, fechar: dismiss, aoFecharLendo: onCloseReading }: {
  tenantId: string; slug: string; autoral: boolean; modo: NewMode; trocar: (m: NewMode) => void; fechar: () => void;
  /** The read finished with the sheet already closed: the shell notifies on the screen the person is on (with the source outlet). */
  aoFecharLendo: (r: Brought, slug: string) => void;
}) {
  const id = useId();
  const dlgState = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [advertiser, setAdvertiser] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  // Google Docs: only with the Google configuration; without it the tab does not even appear and `?nova=docs` opens on link.
  const google = useMe().data?.google ?? null;
  const modes = NEW_MODES.filter((m) => (m.valor !== "docs" || google) && (m.valor !== "anuncio" || !author));
  const mode: NewMode = (request === "docs" && !google) || (request === "anuncio" && author) ? "link" : request;
  const [doc, setDoc] = useState<{ id: string; nome: string } | null>(null);
  const [openingDocs, setOpeningDocs] = useState(false);
  const [docsError, setErrorDocs] = useState<{ texto: string; reconectar: boolean } | null>(null);
  // Going back in the browser closes the sheet even while reading: a response that arrives later must not swap the open screen.
  const open = useRef(true);
  useEffect(() => { open.current = true; return () => { open.current = false; }; }, []);

  const upload = useMutation({
    mutationFn: async (): Promise<Brought> => {
      if (mode === "print") return read(route.$post({ param: { tenantId } }, fileBody(await preparePrint(file!))));
      if (mode === "docs") return read(route.$post({ param: { tenantId } }, bodyJson({ docs: doc!.id })));
      if (mode === "anuncio") return read(route.$post({ param: { tenantId } }, bodyJson({ anuncio: { anunciante: advertiser.trim(), briefing: text } })));
      return read(route.$post({ param: { tenantId } }, bodyJson(mode === "link" ? { url: url.trim() } : { texto: text })));
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: keys.pautas(tenantId) });
      qc.invalidateQueries({ queryKey: keys.pecas(tenantId) });
      // Swaps the sheet for Ideas (back does not reopen the sheet), with the notice of what happened. Sheet already closed:
      // the open screen does not change; the notice appears on it.
      if (open.current) navigate(`/t/${slug}`, { replace: true, state: { nova: r } });
      else onCloseReading(r, slug);
    },
  });
  const pending = upload.isPending || upload.isSuccess;

  // Opens as a modal (the rest of the screen is inert) and returns focus to the opener on close.
  useEffect(() => {
    const d = dlgState.current!;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!d.open) d.showModal();
    field.current?.focus();
    return () => {
      if (d.open) d.close();
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function choose(f: File | null) {
    setFile(f);
    setPreview(f ? URL.createObjectURL(f) : null);
    setMissing(null);
    upload.reset();
  }

  /**
   * The Google Picker opens over the page: the sheet (a modal dialog, in the top layer) steps aside while it is open and
   * comes back afterwards, with the chosen document.
   */
  async function openDocs() {
    if (!google) return;
    const d = dlgState.current!;
    setErrorDocs(null);
    setMissing(null);
    upload.reset();
    setOpeningDocs(true);
    d.close();
    try {
      const chosen = await chooseDoc(google);
      if (chosen) setDoc(chosen);
    } catch (e) {
      const r = e instanceof ApiError && RECONNECT.has(e.codigo ?? "");
      setErrorDocs({ texto: r ? newMessage(e as ApiError) : e instanceof ApiError ? e.message : t("Não deu para abrir o Google Docs agora. Tente de novo.", "Couldn't open Google Docs right now. Try again."), reconectar: r });
    } finally {
      setOpeningDocs(false);
      if (open.current && !d.open) d.showModal();
    }
  }
  const connect = useMutation({ mutationFn: () => connectGoogle(google!.escopo, `${location.pathname}?nova=docs`) });

  function send(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    const empty = mode === "link" ? (!url.trim() ? t("Cole o link da notícia.", "Paste the link to the story.") : null)
      : mode === "texto" ? (text.trim().length < 30 ? t("Escreva um pouco mais: o que aconteceu, onde e quando.", "Write a little more: what happened, where and when.") : null)
        : mode === "anuncio" ? (!advertiser.trim() ? t("Diga quem é o anunciante.", "Say who the advertiser is.") : text.trim().length < 30 ? t("Cole o briefing: o que oferece, preço e validade.", "Paste the brief: what's on offer, price and dates.") : null)
        : mode === "docs" ? (!doc ? t("Escolha um documento no Google Docs.", "Choose a document in Google Docs.") : null)
        : !file ? t("Escolha o print da notícia.", "Choose the screenshot of the story.") : null;
    setMissing(empty);
    if (empty) { field.current?.focus(); return; }
    upload.mutate();
  }

  const error = missing ?? docsError?.texto ?? (upload.isError ? newMessage(upload.error instanceof ApiError ? upload.error : null) : null);
  // Access expired or missing: the action is to connect again, in the sheet itself.
  const reconnect = mode === "docs" && !!google && (!google.conectado
    || (upload.error instanceof ApiError && RECONNECT.has(upload.error.codigo ?? "")) || !!docsError?.reconectar);
  const errorId = `${id}-erro`;
  const helpId = `${id}-ajuda`;
  // With an error, the message takes the help's place (it says what to do); the help comes back when the field changes.
  const described = error ? errorId : helpId;
  const help = (text: string) => (error ? null : <span id={helpId} className="ajuda">{text}</span>);

  return (
    <dialog
      ref={dlgState} aria-labelledby={`${id}-t`} className="folha"
      onCancel={(e) => { e.preventDefault(); if (!pending) dismiss(); }}
      onClick={(e) => { if (e.target === dlgState.current && !pending) dismiss(); }}
    >
      <div className="grid gap-4 px-5 pt-5 pb-[calc(20px+env(safe-area-inset-bottom))] lg:px-7 lg:pt-6 lg:pb-7">
        <header className="flex items-start gap-3">
          <div className="grid gap-1">
            <h2 id={`${id}-t`} className="titulo-tela m-0 text-[26px]">{t("Nova ideia", "New idea")}</h2>
            <p className="m-0 text-[15px] text-apoio">{t("Traga uma notícia: ela entra no topo das Ideias.", "Bring in a story: it goes to the top of Ideas.")}</p>
          </div>
          <button type="button" onClick={dismiss} disabled={pending} aria-label={t("Fechar", "Close")}
            className="-mt-1 -mr-2 ml-auto grid size-11 flex-none cursor-pointer place-items-center rounded-btn text-apoio hover:bg-papel-2 hover:text-texto-forte">
            <IconClose className="size-5" />
          </button>
        </header>

        <form onSubmit={send} noValidate className="grid gap-4">
          <fieldset className="m-0 flex rounded-btn border-0 bg-papel-2 p-[3px]" disabled={pending}>
            <legend className="sr-only">{t("De onde vem a notícia", "Where the story comes from")}</legend>
            {modes.map((m) => (
              <label key={m.valor} className="relative flex-1 cursor-pointer rounded-[6px] px-3 py-2 text-center text-[15px] text-texto has-checked:bg-branco has-checked:font-bold has-checked:text-texto-forte has-checked:shadow-[0_1px_2px_rgb(21_23_27/.12)] has-focus-visible:outline-2 has-focus-visible:outline-texto-forte">
                <input type="radio" name={`${id}-modo`} value={m.valor} checked={mode === m.valor}
                  onChange={() => { swap(m.valor); setMissing(null); upload.reset(); }} className="sr-only" />
                {m.rotulo}
              </label>
            ))}
          </fieldset>

          {mode === "link" && (
            <label className="campo">
              <span>{t("Link da notícia", "Link to the story")}</span>
              <input ref={field} type="url" inputMode="url" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="go" placeholder="https://"
                className="entrada" value={url} onChange={(e) => { setUrl(e.target.value); setMissing(null); }}
                readOnly={pending} aria-invalid={!!error} aria-describedby={described} />
              {help(t("O texto é lido da página, como as notícias que chegam pelas fontes.", "The text is read from the page, like the stories that come in from your sources."))}
            </label>
          )}
          {mode === "texto" && (
            <label className="campo">
              <span>{t("O que aconteceu?", "What happened?")}</span>
              <textarea ref={field} rows={6} maxLength={4000} autoCapitalize="sentences" enterKeyHint="enter" className="entrada resize-y leading-[1.45]"
                value={text} onChange={(e) => { setText(e.target.value); setMissing(null); }}
                readOnly={pending} aria-invalid={!!error} aria-describedby={described} />
              {help(t("Comece por uma frase curta com o principal: ela vira o título. Depois, onde, quando e quem confirmou. No post, a fonte aparece como relato do veículo.", "Start with a short sentence with the main point: it becomes the title. Then where, when and who confirmed it. In the post, the source shows as the publication's own report."))}
            </label>
          )}
          {mode === "anuncio" && (
            <>
              <label className="campo">
                <span>{t("Anunciante", "Advertiser")}</span>
                <input ref={field} autoComplete="off" autoCapitalize="words" enterKeyHint="next" maxLength={80} className="entrada" value={advertiser}
                  onChange={(e) => { setAdvertiser(e.target.value); setMissing(null); }} readOnly={pending} aria-invalid={!!error} />
              </label>
              <label className="campo">
                <span>{t("Briefing", "Brief")}</span>
                <textarea rows={6} maxLength={4000} autoCapitalize="sentences" enterKeyHint="enter" className="entrada resize-y leading-[1.45]"
                  value={text} onChange={(e) => { setText(e.target.value); setMissing(null); }} readOnly={pending} aria-invalid={!!error} aria-describedby={described} />
                {help(t("O que o comércio oferece, preço e validade. Cada frase do post fica presa a este texto, e o post sai marcado como publicidade.", "What the business offers, price and dates. Every sentence in the post is tied to this text, and the post is labeled as an advertisement."))}
              </label>
            </>
          )}
          {mode === "print" && (
            <div className="campo">
              <span id={`${id}-print`}>{t("Print da notícia", "Screenshot of the story")}</span>
              <div className="flex flex-wrap items-center gap-4">
                {preview && <img src={preview} alt={t("Print escolhido", "Chosen screenshot")} className="max-h-[180px] w-auto max-w-[45%] rounded-card object-contain shadow-curta" />}
                <label className="btn-sec cursor-pointer bg-papel-2 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-texto-forte">
                  <input ref={field} type="file" accept="image/*" className="sr-only" disabled={pending}
                    aria-labelledby={`${id}-print`} aria-describedby={described} aria-invalid={!!error}
                    onChange={(e) => choose(e.target.files?.[0] ?? null)} />
                  {file ? t("Trocar o print", "Change the screenshot") : t("Escolher o print", "Choose the screenshot")}
                </label>
              </div>
              {help(t("Só print de notícia, com o título à vista. O texto é lido da imagem: confira na revisão.", "Only screenshots of stories, with the title visible. The text is read from the image: check it in review."))}
            </div>
          )}

          {mode === "docs" && google && (
            <div className="campo">
              <span id={`${id}-docs`}>{t("Documento do Google Docs", "Google Docs document")}</span>
              {google.conectado ? (
                <div className="flex flex-wrap items-center gap-3">
                  {doc && <b className="min-w-0 truncate text-texto-forte">{doc.nome}</b>}
                  <button ref={field as never} type="button" className="btn-sec bg-papel-2" onClick={openDocs} disabled={pending || openingDocs}
                    aria-describedby={described} aria-labelledby={`${id}-docs ${id}-docs-acao`}>
                    <span id={`${id}-docs-acao`}>{openingDocs ? t("Abrindo o Google Docs…", "Opening Google Docs…") : doc ? t("Trocar o documento", "Change the document") : t("Escolher no Google Docs", "Choose in Google Docs")}</span>
                  </button>
                </div>
              ) : null}
              {reconnect && (
                <button type="button" className="btn-sec justify-self-start bg-papel-2" onClick={() => connect.mutate()} disabled={connect.isPending}>
                  {connect.isPending ? t("Abrindo o Google…", "Opening Google…") : google.conectado ? t("Conectar de novo", "Connect again") : t("Conectar Google Docs", "Connect Google Docs")}
                </button>
              )}
              {help(google.conectado
                ? t("O texto do documento vem inteiro, com o título. O Gazzpush só enxerga os documentos que você escolher.", "The whole document comes in, with its title. Gazzpush only sees the documents you choose.")
                : t("Conecte uma vez a sua conta Google. O Gazzpush só enxerga os documentos que você escolher.", "Connect your Google account once. Gazzpush only sees the documents you choose."))}
            </div>
          )}

          {error && <p id={errorId} role="alert" className="faixa-erro m-0">{error}</p>}
          <div className="grid gap-2 lg:flex lg:items-center lg:gap-4">
            <button type="submit" className="btn-tinta w-full lg:w-auto" disabled={pending}>
              {pending ? PENDING[mode] : t("Trazer para as Ideias", "Add to Ideas")}
            </button>
            {pending && <p role="status" className="ajuda m-0">{t(`Leva alguns segundos${mode === "print" ? ", às vezes meio minuto" : ""}.`, `It takes a few seconds${mode === "print" ? ", sometimes half a minute" : ""}.`)}</p>}
          </div>
        </form>
      </div>
    </dialog>
  );
}
