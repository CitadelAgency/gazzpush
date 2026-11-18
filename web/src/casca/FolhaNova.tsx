// Folha "Nova ideia" (+ Nova): um link, o que aconteceu em texto ou o print de uma notícia viram uma ideia no topo das
// Ideias, pelo mesmo caminho das fontes. Abre de qualquer tela pelo `?nova=<aba>` da URL (voltar fecha). Diálogo
// nativo: no celular sobe de baixo, no computador fica no alto, centrada. A ação é bloco de lápis azul (formulário).
// Com a configuração do Google no servidor, a aba Docs traz um documento do Google Docs escolhido no Picker.
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { api, ErroApi, corpoArquivo, corpoJson, ler, type Sucesso } from "../api";
import { MODOS_NOVA, chaves, escalaPrint, mensagemNova, type ModoNova } from "../fila";
import { conectarGoogle, escolherDoc } from "../novo/google";
import { t } from "../idioma";
import { useMe } from "../sessao";
import { IconeFechar } from "./icones";

const rota = api.t[":tenantId"].pautas;
export type Trazida = Sucesso<Awaited<ReturnType<typeof rota.$post>>>;

/** Print → JPEG de até 1200 px de largura. Também abre formatos que o servidor não aceita (HEIC no iPhone). */
async function prepararPrint(arquivo: File): Promise<Blob> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(arquivo);
  } catch {
    throw new ErroApi(400, t("imagem ilegível", "unreadable image"), "imagem_invalida");
  }
  const k = escalaPrint(bmp.width, bmp.height);
  const tela = document.createElement("canvas");
  tela.width = Math.round(bmp.width * k);
  tela.height = Math.round(bmp.height * k);
  const g = tela.getContext("2d")!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, tela.width, tela.height);
  g.drawImage(bmp, 0, 0, tela.width, tela.height);
  bmp.close();
  return new Promise((ok, falha) => tela.toBlob((b) => (b ? ok(b) : falha(new ErroApi(400, t("imagem ilegível", "unreadable image"), "imagem_invalida"))), "image/jpeg", 0.88));
}

const PENDENTE: Record<ModoNova, string> = {
  get link() { return t("Lendo a notícia…", "Reading the story…"); },
  get texto() { return t("Lendo o relato…", "Reading your account…"); },
  get print() { return t("Lendo o print…", "Reading the screenshot…"); },
  get docs() { return t("Lendo o documento…", "Reading the document…"); },
  get anuncio() { return t("Lendo o briefing…", "Reading the brief…"); },
};
const RECONECTAR = new Set(["sem_conta", "reconectar"]);

export default function FolhaNova({ tenantId, slug, autoral, modo: pedido, trocar, fechar, aoFecharLendo }: {
  tenantId: string; slug: string; autoral: boolean; modo: ModoNova; trocar: (m: ModoNova) => void; fechar: () => void;
  /** A leitura terminou com a folha já fechada: a casca avisa na tela em que a pessoa está (com o veículo de origem). */
  aoFecharLendo: (r: Trazida, slug: string) => void;
}) {
  const id = useId();
  const dialogo = useRef<HTMLDialogElement>(null);
  const campo = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const navegar = useNavigate();
  const qc = useQueryClient();
  const [url, setUrl] = useState("");
  const [texto, setTexto] = useState("");
  const [anunciante, setAnunciante] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [previa, setPrevia] = useState<string | null>(null);
  const [falta, setFalta] = useState<string | null>(null);
  // Google Docs: só com a configuração do Google; sem ela a aba nem aparece e `?nova=docs` abre no link.
  const google = useMe().data?.google ?? null;
  const modos = MODOS_NOVA.filter((m) => (m.valor !== "docs" || google) && (m.valor !== "anuncio" || !autoral));
  const modo: ModoNova = (pedido === "docs" && !google) || (pedido === "anuncio" && autoral) ? "link" : pedido;
  const [doc, setDoc] = useState<{ id: string; nome: string } | null>(null);
  const [abrindoDocs, setAbrindoDocs] = useState(false);
  const [erroDocs, setErroDocs] = useState<{ texto: string; reconectar: boolean } | null>(null);
  // Voltar no navegador fecha a folha mesmo lendo: a resposta que chegar depois não pode trocar a tela que está aberta.
  const aberta = useRef(true);
  useEffect(() => { aberta.current = true; return () => { aberta.current = false; }; }, []);

  const envio = useMutation({
    mutationFn: async (): Promise<Trazida> => {
      if (modo === "print") return ler(rota.$post({ param: { tenantId } }, corpoArquivo(await prepararPrint(arquivo!))));
      if (modo === "docs") return ler(rota.$post({ param: { tenantId } }, corpoJson({ docs: doc!.id })));
      if (modo === "anuncio") return ler(rota.$post({ param: { tenantId } }, corpoJson({ anuncio: { anunciante: anunciante.trim(), briefing: texto } })));
      return ler(rota.$post({ param: { tenantId } }, corpoJson(modo === "link" ? { url: url.trim() } : { texto })));
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: chaves.pautas(tenantId) });
      qc.invalidateQueries({ queryKey: chaves.pecas(tenantId) });
      // Troca a folha pelas Ideias (voltar não reabre a folha), com o aviso do que aconteceu. Folha já fechada: a
      // tela aberta não troca; o aviso aparece nela.
      if (aberta.current) navegar(`/t/${slug}`, { replace: true, state: { nova: r } });
      else aoFecharLendo(r, slug);
    },
  });
  const pendente = envio.isPending || envio.isSuccess;

  // Abre como modal (o resto da tela fica inerte) e devolve o foco a quem abriu ao fechar.
  useEffect(() => {
    const d = dialogo.current!;
    const antes = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!d.open) d.showModal();
    campo.current?.focus();
    return () => {
      if (d.open) d.close();
      if (antes?.isConnected) antes.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => () => { if (previa) URL.revokeObjectURL(previa); }, [previa]);

  function escolher(f: File | null) {
    setArquivo(f);
    setPrevia(f ? URL.createObjectURL(f) : null);
    setFalta(null);
    envio.reset();
  }

  /**
   * O Picker do Google abre por cima da página: a folha (diálogo modal, na camada de cima) sai da frente enquanto ele
   * está aberto e volta depois, com o documento escolhido.
   */
  async function abrirDocs() {
    if (!google) return;
    const d = dialogo.current!;
    setErroDocs(null);
    setFalta(null);
    envio.reset();
    setAbrindoDocs(true);
    d.close();
    try {
      const escolhido = await escolherDoc(google);
      if (escolhido) setDoc(escolhido);
    } catch (e) {
      const r = e instanceof ErroApi && RECONECTAR.has(e.codigo ?? "");
      setErroDocs({ texto: r ? mensagemNova(e as ErroApi) : e instanceof ErroApi ? e.message : t("Não deu para abrir o Google Docs agora. Tente de novo.", "Couldn't open Google Docs right now. Try again."), reconectar: r });
    } finally {
      setAbrindoDocs(false);
      if (aberta.current && !d.open) d.showModal();
    }
  }
  const conectar = useMutation({ mutationFn: () => conectarGoogle(google!.escopo, `${location.pathname}?nova=docs`) });

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (pendente) return;
    const vazio = modo === "link" ? (!url.trim() ? t("Cole o link da notícia.", "Paste the link to the story.") : null)
      : modo === "texto" ? (texto.trim().length < 30 ? t("Escreva um pouco mais: o que aconteceu, onde e quando.", "Write a little more: what happened, where and when.") : null)
        : modo === "anuncio" ? (!anunciante.trim() ? t("Diga quem é o anunciante.", "Say who the advertiser is.") : texto.trim().length < 30 ? t("Cole o briefing: o que oferece, preço e validade.", "Paste the brief: what's on offer, price and dates.") : null)
        : modo === "docs" ? (!doc ? t("Escolha um documento no Google Docs.", "Choose a document in Google Docs.") : null)
        : !arquivo ? t("Escolha o print da notícia.", "Choose the screenshot of the story.") : null;
    setFalta(vazio);
    if (vazio) { campo.current?.focus(); return; }
    envio.mutate();
  }

  const erro = falta ?? erroDocs?.texto ?? (envio.isError ? mensagemNova(envio.error instanceof ErroApi ? envio.error : null) : null);
  // Acesso vencido ou ausente: a ação é conectar de novo, na própria folha.
  const reconectar = modo === "docs" && !!google && (!google.conectado
    || (envio.error instanceof ErroApi && RECONECTAR.has(envio.error.codigo ?? "")) || !!erroDocs?.reconectar);
  const erroId = `${id}-erro`;
  const ajudaId = `${id}-ajuda`;
  // Com erro, a mensagem toma o lugar da ajuda (diz o que fazer); a ajuda volta quando o campo muda.
  const descrito = erro ? erroId : ajudaId;
  const ajuda = (texto: string) => (erro ? null : <span id={ajudaId} className="ajuda">{texto}</span>);

  return (
    <dialog
      ref={dialogo} aria-labelledby={`${id}-t`} className="folha"
      onCancel={(e) => { e.preventDefault(); if (!pendente) fechar(); }}
      onClick={(e) => { if (e.target === dialogo.current && !pendente) fechar(); }}
    >
      <div className="grid gap-4 px-5 pt-5 pb-[calc(20px+env(safe-area-inset-bottom))] lg:px-7 lg:pt-6 lg:pb-7">
        <header className="flex items-start gap-3">
          <div className="grid gap-1">
            <h2 id={`${id}-t`} className="titulo-tela m-0 text-[26px]">{t("Nova ideia", "New idea")}</h2>
            <p className="m-0 text-[15px] text-apoio">{t("Traga uma notícia: ela entra no topo das Ideias.", "Bring in a story: it goes to the top of Ideas.")}</p>
          </div>
          <button type="button" onClick={fechar} disabled={pendente} aria-label={t("Fechar", "Close")}
            className="-mt-1 -mr-2 ml-auto grid size-11 flex-none cursor-pointer place-items-center rounded-btn text-apoio hover:bg-papel-2 hover:text-texto-forte">
            <IconeFechar className="size-5" />
          </button>
        </header>

        <form onSubmit={enviar} noValidate className="grid gap-4">
          <fieldset className="m-0 flex rounded-btn border-0 bg-papel-2 p-[3px]" disabled={pendente}>
            <legend className="sr-only">{t("De onde vem a notícia", "Where the story comes from")}</legend>
            {modos.map((m) => (
              <label key={m.valor} className="relative flex-1 cursor-pointer rounded-[6px] px-3 py-2 text-center text-[15px] text-texto has-checked:bg-branco has-checked:font-bold has-checked:text-texto-forte has-checked:shadow-[0_1px_2px_rgb(21_23_27/.12)] has-focus-visible:outline-2 has-focus-visible:outline-texto-forte">
                <input type="radio" name={`${id}-modo`} value={m.valor} checked={modo === m.valor}
                  onChange={() => { trocar(m.valor); setFalta(null); envio.reset(); }} className="sr-only" />
                {m.rotulo}
              </label>
            ))}
          </fieldset>

          {modo === "link" && (
            <label className="campo">
              <span>{t("Link da notícia", "Link to the story")}</span>
              <input ref={campo} type="url" inputMode="url" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="go" placeholder="https://"
                className="entrada" value={url} onChange={(e) => { setUrl(e.target.value); setFalta(null); }}
                readOnly={pendente} aria-invalid={!!erro} aria-describedby={descrito} />
              {ajuda(t("O texto é lido da página, como as notícias que chegam pelas fontes.", "The text is read from the page, like the stories that come in from your sources."))}
            </label>
          )}
          {modo === "texto" && (
            <label className="campo">
              <span>{t("O que aconteceu?", "What happened?")}</span>
              <textarea ref={campo} rows={6} maxLength={4000} autoCapitalize="sentences" enterKeyHint="enter" className="entrada resize-y leading-[1.45]"
                value={texto} onChange={(e) => { setTexto(e.target.value); setFalta(null); }}
                readOnly={pendente} aria-invalid={!!erro} aria-describedby={descrito} />
              {ajuda(t("Comece por uma frase curta com o principal: ela vira o título. Depois, onde, quando e quem confirmou. No post, a fonte aparece como relato do veículo.", "Start with a short sentence with the main point: it becomes the title. Then where, when and who confirmed it. In the post, the source shows as the publication's own report."))}
            </label>
          )}
          {modo === "anuncio" && (
            <>
              <label className="campo">
                <span>{t("Anunciante", "Advertiser")}</span>
                <input ref={campo} autoComplete="off" autoCapitalize="words" enterKeyHint="next" maxLength={80} className="entrada" value={anunciante}
                  onChange={(e) => { setAnunciante(e.target.value); setFalta(null); }} readOnly={pendente} aria-invalid={!!erro} />
              </label>
              <label className="campo">
                <span>{t("Briefing", "Brief")}</span>
                <textarea rows={6} maxLength={4000} autoCapitalize="sentences" enterKeyHint="enter" className="entrada resize-y leading-[1.45]"
                  value={texto} onChange={(e) => { setTexto(e.target.value); setFalta(null); }} readOnly={pendente} aria-invalid={!!erro} aria-describedby={descrito} />
                {ajuda(t("O que o comércio oferece, preço e validade. Cada frase do post fica presa a este texto, e o post sai marcado como publicidade.", "What the business offers, price and dates. Every sentence in the post is tied to this text, and the post is labeled as an advertisement."))}
              </label>
            </>
          )}
          {modo === "print" && (
            <div className="campo">
              <span id={`${id}-print`}>{t("Print da notícia", "Screenshot of the story")}</span>
              <div className="flex flex-wrap items-center gap-4">
                {previa && <img src={previa} alt={t("Print escolhido", "Chosen screenshot")} className="max-h-[180px] w-auto max-w-[45%] rounded-card object-contain shadow-curta" />}
                <label className="btn-sec cursor-pointer bg-papel-2 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-texto-forte">
                  <input ref={campo} type="file" accept="image/*" className="sr-only" disabled={pendente}
                    aria-labelledby={`${id}-print`} aria-describedby={descrito} aria-invalid={!!erro}
                    onChange={(e) => escolher(e.target.files?.[0] ?? null)} />
                  {arquivo ? t("Trocar o print", "Change the screenshot") : t("Escolher o print", "Choose the screenshot")}
                </label>
              </div>
              {ajuda(t("Só print de notícia, com o título à vista. O texto é lido da imagem: confira na revisão.", "Only screenshots of stories, with the title visible. The text is read from the image: check it in review."))}
            </div>
          )}

          {modo === "docs" && google && (
            <div className="campo">
              <span id={`${id}-docs`}>{t("Documento do Google Docs", "Google Docs document")}</span>
              {google.conectado ? (
                <div className="flex flex-wrap items-center gap-3">
                  {doc && <b className="min-w-0 truncate text-texto-forte">{doc.nome}</b>}
                  <button ref={campo as never} type="button" className="btn-sec bg-papel-2" onClick={abrirDocs} disabled={pendente || abrindoDocs}
                    aria-describedby={descrito} aria-labelledby={`${id}-docs ${id}-docs-acao`}>
                    <span id={`${id}-docs-acao`}>{abrindoDocs ? t("Abrindo o Google Docs…", "Opening Google Docs…") : doc ? t("Trocar o documento", "Change the document") : t("Escolher no Google Docs", "Choose in Google Docs")}</span>
                  </button>
                </div>
              ) : null}
              {reconectar && (
                <button type="button" className="btn-sec justify-self-start bg-papel-2" onClick={() => conectar.mutate()} disabled={conectar.isPending}>
                  {conectar.isPending ? t("Abrindo o Google…", "Opening Google…") : google.conectado ? t("Conectar de novo", "Connect again") : t("Conectar Google Docs", "Connect Google Docs")}
                </button>
              )}
              {ajuda(google.conectado
                ? t("O texto do documento vem inteiro, com o título. O Gazzpush só enxerga os documentos que você escolher.", "The whole document comes in, with its title. Gazzpush only sees the documents you choose.")
                : t("Conecte uma vez a sua conta Google. O Gazzpush só enxerga os documentos que você escolher.", "Connect your Google account once. Gazzpush only sees the documents you choose."))}
            </div>
          )}

          {erro && <p id={erroId} role="alert" className="faixa-erro m-0">{erro}</p>}
          <div className="grid gap-2 lg:flex lg:items-center lg:gap-4">
            <button type="submit" className="btn-tinta w-full lg:w-auto" disabled={pendente}>
              {pendente ? PENDENTE[modo] : t("Trazer para as Ideias", "Add to Ideas")}
            </button>
            {pendente && <p role="status" className="ajuda m-0">{t(`Leva alguns segundos${modo === "print" ? ", às vezes meio minuto" : ""}.`, `It takes a few seconds${modo === "print" ? ", sometimes half a minute" : ""}.`)}</p>}
          </div>
        </form>
      </div>
    </dialog>
  );
}
