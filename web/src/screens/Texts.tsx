// Texts (author outlet): the journalist's texts on the review desk, most recent first, with the marks from the last
// check and the changed-source warning. New text opens the blank sheet; a finished text (pasted, or from Google Docs,
// with the Google configuration) is the second option.
// Parts (`?ver=`): On the desk · Style guide · Audit (the last two load only when opened).
import { lazy, Suspense, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, bodyJson, ApiError, read } from "../api";
import { useShell } from "../shell/context";
import { PanelView, usePart } from "../kit/Parts";
import { FailureLoad, useTitle } from "../common";
import { when } from "../queue";
import { t } from "../language";
import { connectGoogle, chooseDoc } from "../onboarding/google";
import { Marker, textsKey } from "../onboarding/deskMarks";
import { useMe } from "../session";

const Manual = lazy(() => import("./TextsExtras").then((m) => ({ default: m.Manual })));
const Audit = lazy(() => import("./TextsExtras").then((m) => ({ default: m.AuditLog })));
const PARTS = [
  { id: "mesa", get rotulo() { return t("Na mesa", "On the desk"); } },
  { id: "manual", get rotulo() { return t("Manual de redação", "Style guide"); } },
  { id: "auditoria", get rotulo() { return t("Auditoria", "Audit"); } },
] as const;

export default function Texts() {
  const { veiculo: outlet } = useShell();
  useTitle(t("Textos", "Texts"), outlet.nome);
  const tenantId = outlet.id;
  const [params] = useSearchParams();
  const see = PARTS.find((p) => p.id === params.get("ver"))?.id ?? "mesa";
  const list = useQuery({ queryKey: textsKey(tenantId), queryFn: () => read(api.t[":tenantId"].textos.$get({ param: { tenantId } })) });
  const texts = list.data?.textos ?? [];
  const reporter = outlet.papel === "reporter";
  const [ready, readyOpen] = usePart("novo", null);
  const google = useMe().data?.google ?? null;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const sheet = useMutation({
    mutationFn: () => read(api.t[":tenantId"].textos.$post({ param: { tenantId } }, bodyJson({ branco: true }))),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: textsKey(tenantId) }); navigate(`/t/${outlet.slug}/textos/${r.texto.id}`); },
  });

  return (
    <div className="mx-auto max-w-[880px] px-5 pt-6 pb-12 lg:px-12 lg:pt-10">
      <h1 className="titulo-tela m-0 text-[32px] lg:text-[44px]">{t("Textos", "Texts")}</h1>
      <p className="m-0 mt-3 max-w-[56ch] text-[17px]">
        {t("O seu texto na mesa revisora: cada afirmação conferida contra as fontes do dossiê antes de publicar. A conferência aponta, não reescreve.",
          "Your text on the review desk: every claim checked against the dossier's sources before you publish. The check points things out; it doesn't rewrite.")}
      </p>
      <nav aria-label={t("Partes de Textos", "Parts of Texts")} className="mt-6 flex gap-1 overflow-x-auto border-b border-fio pb-2">
        {PARTS.map((p) => (
          <Link key={p.id} to={p.id === "mesa" ? "?" : `?ver=${p.id}`} replace aria-current={p.id === see ? "page" : undefined}
            className={`inline-flex min-h-11 flex-none items-center rounded-btn px-3.5 text-[15px] no-underline ${p.id === see ? "bg-tinta-clara font-bold text-tinta" : "text-texto hover:bg-papel-2"}`}>{p.rotulo}</Link>
        ))}
      </nav>
      {see !== "mesa" ? (
        <Suspense fallback={<div className="esqueleto mt-8 h-40" />}>
          {see === "manual" ? <Manual tenantId={tenantId} podeEditar={!reporter} /> : <Audit tenantId={tenantId} />}
        </Suspense>
      ) : <>
      {!reporter && (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <button type="button" className="btn-tinta" onClick={() => sheet.mutate()} disabled={sheet.isPending}>{sheet.isPending ? t("Abrindo…", "Opening…") : t("Novo texto", "New text")}</button>
            <button type="button" className="btn-sec bg-papel-2" aria-expanded={ready === "colar"} aria-controls="painel-texto-pronto" onClick={() => readyOpen(ready === "colar" ? null : "colar")}>
              {google ? t("Colar ou trazer do Google Docs", "Paste or bring from Google Docs") : t("Colar um texto", "Paste a text")}
            </button>
          </div>
          {sheet.isError && <p role="alert" className="faixa-erro m-0 mt-3">{sheet.error instanceof ApiError ? sheet.error.message : t("Não deu certo agora. Tente de novo.", "That didn't work right now. Try again.")}</p>}
          <PanelView id="painel-texto-pronto" aberta={ready === "colar"} manter className="mt-4" aoAlerta={() => readyOpen("colar")}>
            <ReadyText tenantId={tenantId} slug={outlet.slug} />
          </PanelView>
        </>
      )}
      <h2 className="mono m-0 mt-8 text-[12px] tracking-[.08em] text-apoio uppercase">{t("Na mesa", "On the desk")}</h2>
      {list.isPending ? (
        <div aria-busy="true" className="mt-3 grid gap-3">
          <p role="status" className="sr-only">{t("Carregando os textos", "Loading texts")}</p>
          {[0, 1].map((i) => <div key={i} className="esqueleto h-[72px]" />)}
        </div>
      ) : list.isError ? (
        <div className="mt-3"><FailureLoad oque={t("os textos", "the texts")} tentar={() => list.refetch()} /></div>
      ) : !texts.length ? (
        <p className="m-0 mt-3 text-apoio">{reporter ? t("Nenhum texto ainda.", "No texts yet.") : t("Nenhum texto ainda. Novo texto abre uma folha em branco.", "No texts yet. New text opens a blank page.")}</p>
      ) : (
        <ul className="m-0 mt-3 grid list-none gap-3 p-0">
          {texts.map((x) => (
            <li key={x.id} className="rounded-card bg-branco px-4 py-3 shadow-curta">
              <Link to={x.id} viewTransition className="grid gap-1 no-underline">
                <b className="text-[17px] leading-snug text-texto-forte">{x.titulo || t("Sem título", "Untitled")}</b>
                <span className="mono text-apoio">
                  {x.origem === "docs" ? t("do Google Docs", "from Google Docs") : x.origem === "escrito" ? t("escrito aqui", "written here") : t("colado", "pasted")} · {when(x.atualizadoEm)}
                  {x.conferido ? "" : t(" · não conferido", " · not checked")}
                </span>
              </Link>
              {x.conferido && <p className="m-0 mt-1.5"><Marker contagem={x.marcas} /></p>}
              {x.fonteMudou && <p className="faixa-aviso m-0 mt-2 py-1.5 text-[14px]">{t("Uma fonte do dossiê mudou desde que você conferiu.", "A dossier source changed since you checked.")}</p>}
              {x.alertas > 0 && <p className="faixa-aviso m-0 mt-2 py-1.5 text-[14px]">{x.alertas === 1 ? t("1 alerta na aba Depois.", "1 alert in the After tab.") : t(`${x.alertas} alertas na aba Depois.`, `${x.alertas} alerts in the After tab.`)}</p>}
            </li>
          ))}
        </ul>
      )}
      </>}
    </div>
  );
}

/** The text that already exists elsewhere: pasted here, or brought from Google Docs. */
function ReadyText({ tenantId, slug }: { tenantId: string; slug: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const google = useMe().data?.google ?? null;
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [missing, setMissing] = useState(false);
  const open = (id: string) => {
    qc.invalidateQueries({ queryKey: textsKey(tenantId) });
    navigate(`/t/${slug}/textos/${id}`);
  };
  const paste = useMutation({
    mutationFn: () => read(api.t[":tenantId"].textos.$post({ param: { tenantId } }, bodyJson({ titulo: title, texto: text }))),
    onSuccess: (r) => open(r.texto.id),
  });
  const docs = useMutation({
    mutationFn: async () => {
      const doc = await chooseDoc(google!);
      if (!doc) return null;
      return read(api.t[":tenantId"].textos.$post({ param: { tenantId } }, bodyJson({ docs: doc.id })));
    },
    onSuccess: (r) => { if (r) open(r.texto.id); },
  });
  const connect = useMutation({ mutationFn: () => connectGoogle(google!.escopo, location.pathname) });
  const docsError = docs.error instanceof ApiError ? docs.error : null;
  const reconnect = !!google && (!google.conectado || docsError?.codigo === "reconectar" || docsError?.codigo === "sem_conta");

  function send(e: FormEvent) {
    e.preventDefault();
    if (text.trim().length < 3) { setMissing(true); return; }
    paste.mutate();
  }

  return (
    <section aria-labelledby="texto-pronto" className="grid gap-4 rounded-card bg-papel-2/60 p-4 lg:p-6">
      <h2 id="texto-pronto" className="m-0 text-[20px]">{t("Texto pronto", "Ready-made text")}</h2>
      {google && (
        <div className="grid justify-items-start gap-2">
          {google.conectado && (
            <button type="button" className="btn-sec bg-branco" onClick={() => docs.mutate()} disabled={docs.isPending}>
              {docs.isPending ? t("Abrindo o Google Docs…", "Opening Google Docs…") : t("Trazer do Google Docs", "Bring from Google Docs")}
            </button>
          )}
          {reconnect && (
            <button type="button" className="btn-sec bg-branco" onClick={() => connect.mutate()} disabled={connect.isPending}>
              {google.conectado ? t("Conectar de novo", "Reconnect") : t("Conectar Google Docs", "Connect Google Docs")}
            </button>
          )}
          {docs.isError && <p role="alert" className="faixa-erro m-0">{docs.error instanceof ApiError ? docs.error.message : t("Não deu para abrir o Google Docs agora.", "Couldn't open Google Docs right now.")}</p>}
          <p className="ajuda m-0">{t("Ou cole o texto abaixo.", "Or paste the text below.")}</p>
        </div>
      )}
      <form onSubmit={send} noValidate className="grid gap-4">
        <label className="campo">
          <span>{t("Título", "Title")}</span>
          <input className="entrada bg-branco" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} placeholder={t("Em branco, vale a primeira linha", "If blank, the first line is used")} />
        </label>
        <label className="campo">
          <span>{t("Texto", "Text")}</span>
          <textarea className="entrada min-h-[160px] resize-y bg-branco leading-[1.5]" value={text} rows={7}
            onChange={(e) => { setText(e.target.value); setMissing(false); }} aria-invalid={missing} aria-describedby="texto-ajuda" />
          <span id="texto-ajuda" className={missing ? "text-[15px] text-terracota" : "ajuda"} role={missing ? "alert" : undefined}>
            {missing ? t("Cole o texto que você quer conferir.", "Paste the text you want to check.") : t("Um parágrafo por linha. O texto não muda sozinho: a mesa marca, você edita.", "One paragraph per line. The text never changes on its own: the desk marks, you edit.")}
          </span>
        </label>
        {paste.isError && <p role="alert" className="faixa-erro m-0">{paste.error instanceof ApiError ? paste.error.message : t("Não deu certo agora. Tente de novo.", "That didn't work right now. Try again.")}</p>}
        <button type="submit" className="btn-tinta justify-self-start" disabled={paste.isPending}>{paste.isPending ? t("Abrindo…", "Opening…") : t("Abrir na mesa", "Open on the desk")}</button>
      </form>
    </section>
  );
}
