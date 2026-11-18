// Textos (veículo de autor): os textos do jornalista na mesa revisora, do mais recente, com as marcas da última
// conferência e o aviso de fonte que mudou. Novo texto abre a folha em branco; texto pronto (colado, ou do Google Docs,
// com a configuração do Google) é a segunda opção.
// Partes (`?ver=`): Na mesa · Manual de redação · Auditoria (as duas últimas carregam só quando abertas).
import { lazy, Suspense, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, corpoJson, ErroApi, ler } from "../api";
import { useCasca } from "../casca/contexto";
import { Painel, useParte } from "../kit/Partes";
import { FalhaCarga, useTitulo } from "../comum";
import { quando } from "../fila";
import { t } from "../idioma";
import { conectarGoogle, escolherDoc } from "../novo/google";
import { Marcador, chaveTextos } from "../novo/mesa";
import { useMe } from "../sessao";

const Manual = lazy(() => import("./TextosExtras").then((m) => ({ default: m.Manual })));
const Auditoria = lazy(() => import("./TextosExtras").then((m) => ({ default: m.Auditoria })));
const PARTES = [
  { id: "mesa", get rotulo() { return t("Na mesa", "On the desk"); } },
  { id: "manual", get rotulo() { return t("Manual de redação", "Style guide"); } },
  { id: "auditoria", get rotulo() { return t("Auditoria", "Audit"); } },
] as const;

export default function Textos() {
  const { veiculo } = useCasca();
  useTitulo(t("Textos", "Texts"), veiculo.nome);
  const tenantId = veiculo.id;
  const [params] = useSearchParams();
  const ver = PARTES.find((p) => p.id === params.get("ver"))?.id ?? "mesa";
  const lista = useQuery({ queryKey: chaveTextos(tenantId), queryFn: () => ler(api.t[":tenantId"].textos.$get({ param: { tenantId } })) });
  const textos = lista.data?.textos ?? [];
  const reporter = veiculo.papel === "reporter";
  const [pronto, abrirPronto] = useParte("novo", null);
  const google = useMe().data?.google ?? null;
  const navegar = useNavigate();
  const qc = useQueryClient();
  const folha = useMutation({
    mutationFn: () => ler(api.t[":tenantId"].textos.$post({ param: { tenantId } }, corpoJson({ branco: true }))),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: chaveTextos(tenantId) }); navegar(`/t/${veiculo.slug}/textos/${r.texto.id}`); },
  });

  return (
    <div className="mx-auto max-w-[880px] px-5 pt-6 pb-12 lg:px-12 lg:pt-10">
      <h1 className="titulo-tela m-0 text-[32px] lg:text-[44px]">{t("Textos", "Texts")}</h1>
      <p className="m-0 mt-3 max-w-[56ch] text-[17px]">
        {t("O seu texto na mesa revisora: cada afirmação conferida contra as fontes do dossiê antes de publicar. A conferência aponta, não reescreve.",
          "Your text on the review desk: every claim checked against the dossier's sources before you publish. The check points things out; it doesn't rewrite.")}
      </p>
      <nav aria-label={t("Partes de Textos", "Parts of Texts")} className="mt-6 flex gap-1 overflow-x-auto border-b border-fio pb-2">
        {PARTES.map((p) => (
          <Link key={p.id} to={p.id === "mesa" ? "?" : `?ver=${p.id}`} replace aria-current={p.id === ver ? "page" : undefined}
            className={`inline-flex min-h-11 flex-none items-center rounded-btn px-3.5 text-[15px] no-underline ${p.id === ver ? "bg-tinta-clara font-bold text-tinta" : "text-texto hover:bg-papel-2"}`}>{p.rotulo}</Link>
        ))}
      </nav>
      {ver !== "mesa" ? (
        <Suspense fallback={<div className="esqueleto mt-8 h-40" />}>
          {ver === "manual" ? <Manual tenantId={tenantId} podeEditar={!reporter} /> : <Auditoria tenantId={tenantId} />}
        </Suspense>
      ) : <>
      {!reporter && (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <button type="button" className="btn-tinta" onClick={() => folha.mutate()} disabled={folha.isPending}>{folha.isPending ? t("Abrindo…", "Opening…") : t("Novo texto", "New text")}</button>
            <button type="button" className="btn-sec bg-papel-2" aria-expanded={pronto === "colar"} aria-controls="painel-texto-pronto" onClick={() => abrirPronto(pronto === "colar" ? null : "colar")}>
              {google ? t("Colar ou trazer do Google Docs", "Paste or bring from Google Docs") : t("Colar um texto", "Paste a text")}
            </button>
          </div>
          {folha.isError && <p role="alert" className="faixa-erro m-0 mt-3">{folha.error instanceof ErroApi ? folha.error.message : t("Não deu certo agora. Tente de novo.", "That didn't work right now. Try again.")}</p>}
          <Painel id="painel-texto-pronto" aberta={pronto === "colar"} manter className="mt-4" aoAlerta={() => abrirPronto("colar")}>
            <TextoPronto tenantId={tenantId} slug={veiculo.slug} />
          </Painel>
        </>
      )}
      <h2 className="mono m-0 mt-8 text-[12px] tracking-[.08em] text-apoio uppercase">{t("Na mesa", "On the desk")}</h2>
      {lista.isPending ? (
        <div aria-busy="true" className="mt-3 grid gap-3">
          <p role="status" className="sr-only">{t("Carregando os textos", "Loading texts")}</p>
          {[0, 1].map((i) => <div key={i} className="esqueleto h-[72px]" />)}
        </div>
      ) : lista.isError ? (
        <div className="mt-3"><FalhaCarga oque={t("os textos", "the texts")} tentar={() => lista.refetch()} /></div>
      ) : !textos.length ? (
        <p className="m-0 mt-3 text-apoio">{reporter ? t("Nenhum texto ainda.", "No texts yet.") : t("Nenhum texto ainda. Novo texto abre uma folha em branco.", "No texts yet. New text opens a blank page.")}</p>
      ) : (
        <ul className="m-0 mt-3 grid list-none gap-3 p-0">
          {textos.map((x) => (
            <li key={x.id} className="rounded-card bg-branco px-4 py-3 shadow-curta">
              <Link to={x.id} viewTransition className="grid gap-1 no-underline">
                <b className="text-[17px] leading-snug text-texto-forte">{x.titulo || t("Sem título", "Untitled")}</b>
                <span className="mono text-apoio">
                  {x.origem === "docs" ? t("do Google Docs", "from Google Docs") : x.origem === "escrito" ? t("escrito aqui", "written here") : t("colado", "pasted")} · {quando(x.atualizadoEm)}
                  {x.conferido ? "" : t(" · não conferido", " · not checked")}
                </span>
              </Link>
              {x.conferido && <p className="m-0 mt-1.5"><Marcador contagem={x.marcas} /></p>}
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

/** O texto que já existe em outro lugar: colado aqui, ou trazido do Google Docs. */
function TextoPronto({ tenantId, slug }: { tenantId: string; slug: string }) {
  const navegar = useNavigate();
  const qc = useQueryClient();
  const google = useMe().data?.google ?? null;
  const [titulo, setTitulo] = useState("");
  const [texto, setTexto] = useState("");
  const [falta, setFalta] = useState(false);
  const abrir = (id: string) => {
    qc.invalidateQueries({ queryKey: chaveTextos(tenantId) });
    navegar(`/t/${slug}/textos/${id}`);
  };
  const colar = useMutation({
    mutationFn: () => ler(api.t[":tenantId"].textos.$post({ param: { tenantId } }, corpoJson({ titulo, texto }))),
    onSuccess: (r) => abrir(r.texto.id),
  });
  const docs = useMutation({
    mutationFn: async () => {
      const doc = await escolherDoc(google!);
      if (!doc) return null;
      return ler(api.t[":tenantId"].textos.$post({ param: { tenantId } }, corpoJson({ docs: doc.id })));
    },
    onSuccess: (r) => { if (r) abrir(r.texto.id); },
  });
  const conectar = useMutation({ mutationFn: () => conectarGoogle(google!.escopo, location.pathname) });
  const erroDocs = docs.error instanceof ErroApi ? docs.error : null;
  const reconectar = !!google && (!google.conectado || erroDocs?.codigo === "reconectar" || erroDocs?.codigo === "sem_conta");

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (texto.trim().length < 3) { setFalta(true); return; }
    colar.mutate();
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
          {reconectar && (
            <button type="button" className="btn-sec bg-branco" onClick={() => conectar.mutate()} disabled={conectar.isPending}>
              {google.conectado ? t("Conectar de novo", "Reconnect") : t("Conectar Google Docs", "Connect Google Docs")}
            </button>
          )}
          {docs.isError && <p role="alert" className="faixa-erro m-0">{docs.error instanceof ErroApi ? docs.error.message : t("Não deu para abrir o Google Docs agora.", "Couldn't open Google Docs right now.")}</p>}
          <p className="ajuda m-0">{t("Ou cole o texto abaixo.", "Or paste the text below.")}</p>
        </div>
      )}
      <form onSubmit={enviar} noValidate className="grid gap-4">
        <label className="campo">
          <span>{t("Título", "Title")}</span>
          <input className="entrada bg-branco" value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={300} placeholder={t("Em branco, vale a primeira linha", "If blank, the first line is used")} />
        </label>
        <label className="campo">
          <span>{t("Texto", "Text")}</span>
          <textarea className="entrada min-h-[160px] resize-y bg-branco leading-[1.5]" value={texto} rows={7}
            onChange={(e) => { setTexto(e.target.value); setFalta(false); }} aria-invalid={falta} aria-describedby="texto-ajuda" />
          <span id="texto-ajuda" className={falta ? "text-[15px] text-terracota" : "ajuda"} role={falta ? "alert" : undefined}>
            {falta ? t("Cole o texto que você quer conferir.", "Paste the text you want to check.") : t("Um parágrafo por linha. O texto não muda sozinho: a mesa marca, você edita.", "One paragraph per line. The text never changes on its own: the desk marks, you edit.")}
          </span>
        </label>
        {colar.isError && <p role="alert" className="faixa-erro m-0">{colar.error instanceof ErroApi ? colar.error.message : t("Não deu certo agora. Tente de novo.", "That didn't work right now. Try again.")}</p>}
        <button type="submit" className="btn-tinta justify-self-start" disabled={colar.isPending}>{colar.isPending ? t("Abrindo…", "Opening…") : t("Abrir na mesa", "Open on the desk")}</button>
      </form>
    </section>
  );
}
