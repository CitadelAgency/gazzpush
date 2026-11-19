// The Story (DESIGN.md §5): the journalist's text with the tabs Dossier · Text · Posts · After (`?aba=`). Text is the
// editor (src/story/StoryText.tsx, Tiptap, loaded only on this route); Dossier, the evidence and what each piece
// supports; Posts, the pieces that came from the text; After, the sources that changed. The AI checks, it does not write.
import { useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, read } from "../api";
import { useShell } from "../shell/context";
import { IconBack } from "../shell/icons";
import { FailureLoad, useTitle } from "../common";
import { hour, when } from "../queue";
import { t } from "../language";
import { TABS_STORY, IconState, TAB_LABEL, STATE_LABEL, STATUS_POST_LABEL, tabStory, textsKey, type TabStory } from "../onboarding/deskMarks";
import { Dossier, EvidenceName, qty, summaryDossier, route, type Claim, type DeskState, type Summary } from "../story/common";
import StoryText from "../story/StoryText";
import { OtherSide, PackageDefense, REQUEST_OTHER_SIDE, summaryOtherSide } from "../story/Shield";
import { ButtonPdf, Documents, summaryDocuments, useSendPdf } from "../story/Documents";
import { AudioButton, Recordings, summaryRecordings, useSendAudio } from "../story/Recordings";
import { TabAfter, RequestsLai, summaryLai } from "../story/Living";
import { alertFirst, Parts, type ItemPart } from "../kit/Parts";

export default function Desk() {
  const { veiculo: outlet } = useShell();
  const { id = "" } = useParams();
  const tenantId = outlet.id;
  const qc = useQueryClient();
  const key = [tenantId, "texto", id] as const;
  // While a PDF is being read or a recording transcribed (queued), the Story asks again every 2 s, on any tab: the
  // quote's mark and the checklist change in Text when the transcript is ready.
  const q = useQuery({
    queryKey: key, queryFn: () => read(route.$get({ param: { tenantId, id } })), refetchOnWindowFocus: false,
    refetchInterval: (qq) => (qq.state.data?.documentos.some((d) => d.estado === "lendo") || qq.state.data?.gravacoes.some((g) => g.estado === "lendo") ? 2000 : false),
  });
  useTitle(q.data?.texto.titulo || t("Texto", "Text"), t("Textos", "Texts"), outlet.nome);
  const editor = outlet.papel !== "reporter";
  const [params] = useSearchParams();
  const tab = tabStory(params.get("aba"));
  // Reload (version conflict, reimport): the editor mounts again with the server's text.
  const [assembly, setAssembly] = useState(0);

  const update = (d: DeskState) => {
    qc.setQueryData(key, d);
    qc.invalidateQueries({ queryKey: textsKey(tenantId) });
  };

  if (q.isPending) {
    return (
      <div aria-busy="true" className="mx-auto max-w-[1180px] px-5 pt-6 lg:px-12 lg:pt-10">
        <p role="status" className="sr-only">{t("Carregando o texto", "Loading the text")}</p>
        <div className="esqueleto h-9 w-[60%]" />
        {[0, 1, 2].map((i) => <div key={i} className="esqueleto mt-5 h-20" />)}
      </div>
    );
  }
  if (q.isError) {
    // A text that no longer exists is a fact, not a load failure: trying again does not help.
    if (q.error instanceof ApiError && q.error.status === 404) {
      return (
        <div className="mx-auto grid max-w-[880px] gap-2 px-5 pt-6 lg:px-12 lg:pt-10">
          <p className="m-0">{t("Este texto não existe mais.", "This text no longer exists.")}</p>
          <Link to={`/t/${outlet.slug}/textos`} className="link-acao justify-self-start">{t("Ver os textos", "See the texts")}</Link>
        </div>
      );
    }
    return <div className="mx-auto max-w-[880px] px-5 pt-6 lg:px-12 lg:pt-10"><FailureLoad oque={t("o texto", "the text")} tentar={() => q.refetch()} /></div>;
  }
  const { texto: text, afirmacoes: claims, evidencias: evidence } = q.data;
  const checked = text.conferidoVersao === text.versao;
  const head = (title: ReactNode, status: ReactNode = null) => (
    <>
      <Link to={`/t/${outlet.slug}/textos`} viewTransition className="link-acao inline-flex min-h-11 items-center gap-1 text-[15px]">
        <IconBack className="size-4" /> {t("Textos", "Texts")}
      </Link>
      <p className="mono m-0 mt-2 flex flex-wrap gap-x-2 text-apoio">
        <span>
          {text.origem === "docs" ? <>{t("do ", "from ")}<a href={text.docsUrl ?? "#"} target="_blank" rel="noreferrer" className="link-acao font-normal">Google Docs</a></> : text.origem === "escrito" ? t("escrito aqui", "written here") : t("colado", "pasted")}
          {" · "}{t("versão", "version")} {text.versao}{checked && text.conferidoEm ? t(` · conferido às ${hour(text.conferidoEm)}`, ` · checked at ${hour(text.conferidoEm)}`) : ""}
        </span>
        {status && <>· {status}</>}
      </p>
      {title}
      <TabsStory aba={tab} mudou={q.data.alertas.filter((a) => a.estado === "aberto").length} evidencias={evidence.length} />
    </>
  );
  const h1 = <h1 id="titulo-texto" className="titulo-tela m-0 mt-2 text-[30px] leading-[1.1] lg:text-[40px]">{text.titulo || t("Sem título", "Untitled")}</h1>;

  // With the Material alongside (a 360 px column to the left of the sheet), the container widens from 1180 px up.
  const material = tab === "texto" && params.get("material") === "aberto";
  return (
    <div className={`mx-auto max-w-[1280px] px-5 pt-5 pb-14 lg:px-12 lg:pt-8 ${material ? "min-[1180px]:max-w-[1760px]" : ""}`}>
      {tab === "texto" ? (
        <StoryText key={`${id}:${assembly}`} estado={q.data} tenantId={tenantId} id={id} slug={outlet.slug} podeEditar={editor} admin={outlet.papel === "admin"} atualizar={update} cabeca={head}
          recarregar={() => { void q.refetch().then(() => setAssembly((n) => n + 1)); }} />
      ) : (
        <>
          {head(h1)}
          <div className={`mt-6 ${tab === "dossie" ? "" : "max-w-[880px]"}`}>
            {tab === "dossie" && <TabDossier tenantId={tenantId} textoId={id} estado={q.data} editor={editor} atualizar={update} />}
            {tab === "posts" && <TabPosts tenantId={tenantId} textoId={id} slug={outlet.slug} />}
            {tab === "depois" && <TabAfter tenantId={tenantId} textoId={id} slug={outlet.slug} estado={q.data} editor={editor} atualizar={update} />}
          </div>
        </>
      )}
    </div>
  );
}

// ── the Story's tabs ────────────────────────────────────────────────────────────────────────────────────────────

function TabsStory({ aba: tab, mudou: changed, evidencias: evidence }: { aba: TabStory; mudou: number; evidencias: number }) {
  const account: Partial<Record<TabStory, string>> = { dossie: String(evidence), depois: changed ? String(changed) : "" };
  return (
    <nav aria-label={t("Partes da matéria", "Parts of the story")} className="mt-4 flex gap-1 overflow-x-auto border-b border-fio pb-2">
      {TABS_STORY.map((a) => (
        <Link key={a} to={a === "texto" ? "?" : `?aba=${a}`} replace aria-current={a === tab ? "page" : undefined}
          className={`inline-flex min-h-11 flex-none items-center gap-1.5 rounded-btn px-3.5 text-[15px] no-underline ${a === tab ? "bg-tinta-clara font-bold text-tinta" : "text-texto hover:bg-papel-2"}`}>
          {TAB_LABEL[a]}
          {account[a] ? <span className="mono text-[13px] text-apoio">{account[a]}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

/** Dossier: an index with each part's status, one open at a time. What is expiring or unanswered comes first and opens by itself; an empty part is a row with its action. */
function TabDossier({ tenantId, textoId: textId, estado: state, editor, atualizar: update }: {
  tenantId: string; textoId: string; estado: DeskState; editor: boolean; atualizar: (d: DeskState) => void;
}) {
  // The source the person attached counts in place of the model's; ignored and opinion do not count.
  const supports = (a: Claim) => (a.apuracao?.tipo === "fonte" ? { ev: a.apuracao.evidenciaId, trecho: a.apuracao.evidenciaTrecho }
    : !a.apuracao && a.estado === "com_evidencia" ? { ev: a.evidenciaId, trecho: a.evidenciaTrecho } : null);
  const used = state.evidencias.map((e) => ({ e, frases: state.afirmacoes.flatMap((a) => { const s = supports(a); return s?.ev === e.id ? [{ ...a, evidenciaTrecho: s.trecho }] : []; }) }))
    .filter((x) => x.frases.length);
  const sendPdf = useSendPdf(tenantId, textId, update);
  const sendAudio = useSendAudio(tenantId, textId, update);
  const [recording, setRecording] = useState<string | null>(null);
  const [packageWarning, setWarningPackage] = useState<Summary | null>(null);
  const [params, setParams] = useSearchParams();
  const props = { tenantId, textoId: textId, estado: state, editor, atualizar: update };
  const item = (id: string, label: string, r: Summary, content: ReactNode, action?: ReactNode): ItemPart => ({ id, rotulo: label, resumo: r.texto, tom: r.tom, conteudo: content, acao: action });
  const requestOtherSide = () => setParams((p) => { p.set("parte", "outro-lado"); p.set("pedir", REQUEST_OTHER_SIDE); return p; }, { replace: true, preventScrollReset: true });
  const sentences = used.reduce((n, x) => n + x.frases.length, 0);
  const items = alertFirst([
    item("dossie", t("Dossiê", "Dossier"), summaryDossier(state), <Dossier {...props} emPartes />),
    item("documentos", t("Documentos", "Documents"), summaryDocuments(state, sendPdf.error), <Documents {...props} enviar={sendPdf} />,
      editor && !state.documentos.length ? <ButtonPdf enviar={sendPdf} /> : undefined),
    item("gravacoes", t("Gravações", "Recordings"), summaryRecordings(state, sendAudio.error, recording), <Recordings {...props} enviar={sendAudio} avisar={setRecording} />,
      editor && !state.gravacoes.length ? <AudioButton enviar={sendAudio} /> : undefined),
    item("lai", t("Pedidos de LAI", "FOI requests (LAI)"), summaryLai(state), <RequestsLai {...props} />),
    item("outro-lado", t("Outro lado", "Other side"), summaryOtherSide(state), <OtherSide {...props} />,
      editor && !state.outroLado.pedidos.length && params.get("pedir") !== REQUEST_OTHER_SIDE
        ? <button type="button" className="btn-sec flex-none bg-papel-2" onClick={requestOtherSide}>{t("Pedir o outro lado", "Ask the other side")}</button> : undefined),
    ...(used.length ? [item("sustenta", t("O que cada fonte sustenta", "What each source supports"), { texto: t(`${qty(used.length, "fonte", "fontes")} · ${qty(sentences, "frase", "frases")}`, `${qty(used.length, "source", "sources")} · ${qty(sentences, "sentence", "sentences")}`) }, (
      <ul className="m-0 grid list-none gap-3 p-0">
        {used.map(({ e, frases: theirs }) => (
          <li key={e.id} className="grid gap-2 rounded-card bg-branco px-4 py-3 shadow-curta">
            <EvidenceName e={e} />
            {theirs.map((a) => (
              <div key={a.id} className="grid gap-1 border-t border-fio pt-2">
                <p className="m-0 flex items-start gap-1.5 text-[15px]"><IconState estado="com_evidencia" className="mt-1 size-3.5" /><span><span className="sr-only">{STATE_LABEL.com_evidencia}: </span>“{a.trecho}”</span></p>
                <p className="m-0 text-[15px] leading-[1.55]"><mark className="bg-verde-claro px-0.5 text-texto-forte [box-decoration-break:clone]">{a.evidenciaTrecho}</mark></p>
              </div>
            ))}
          </li>
        ))}
      </ul>
    ))] : []),
    item("pacote", t("Pacote de defesa", "Defense package"), packageWarning ?? { texto: t("zip com carimbo de tempo", "zip with a timestamp") }, <PackageDefense tenantId={tenantId} textoId={textId} editor={editor} avisar={setWarningPackage} />),
  ]);
  return <Parts itens={items} padrao={items[0].id} rotulo={t("Partes do dossiê", "Parts of the dossier")} />;
}

/** Posts: the pieces from the leads that came from the text, with their status and the link to the piece. */
function TabPosts({ tenantId, textoId: textId, slug }: { tenantId: string; textoId: string; slug: string }) {
  const q = useQuery({ queryKey: [tenantId, "texto", textId, "posts"], queryFn: () => read(route.posts.$get({ param: { tenantId, id: textId } })) });
  if (q.isPending) return <div aria-busy="true"><p role="status" className="sr-only">{t("Carregando os posts", "Loading the posts")}</p><div className="esqueleto h-[72px]" /></div>;
  if (q.isError) return <FailureLoad oque={t("os posts", "the posts")} tentar={() => q.refetch()} />;
  const posts = q.data.posts;
  if (!posts.length) {
    return <p className="m-0 text-apoio">{t("Nenhum post ainda. Em Texto, “Mandar para o Instagram” monta o carrossel só com as frases conferidas, cada uma com a evidência dela.", "No posts yet. In Text, “Send to Instagram” builds the carousel only from checked sentences, each with its evidence.")}</p>;
  }
  return (
    <section aria-labelledby="posts-t" className="grid gap-3">
      <h2 id="posts-t" className="mono m-0 text-[12px] tracking-[.08em] text-apoio uppercase">{posts.length === 1 ? t("1 post", "1 post") : t(`${posts.length} posts`, `${posts.length} posts`)}</h2>
      <ul className="m-0 grid list-none gap-3 p-0">
        {posts.map((p) => (
          <li key={p.id} className="rounded-card bg-branco px-4 py-3 shadow-curta">
            <Link to={`/t/${slug}/p/${p.id}`} viewTransition className="grid gap-1 no-underline">
              <b className="text-[17px] leading-snug text-texto-forte">{p.manchete ?? p.titulo}</b>
              <span className="mono text-apoio">
                {p.formato === "reels" ? "Reels" : p.formato === "carrossel" ? t("carrossel", "carousel") : "post"} · {STATUS_POST_LABEL[p.status] ?? p.status} · {when(p.atualizadoEm)}
                {p.versaoTexto ? t(` · da versão ${p.versaoTexto} do texto`, ` · from version ${p.versaoTexto} of the text`) : ""}
              </span>
            </Link>
            {p.url && <a href={p.url} target="_blank" rel="noreferrer" className="link-acao mt-1 inline-flex min-h-11 items-center text-[15px]">{t("Ver no Instagram", "See on Instagram")}</a>}
          </li>
        ))}
      </ul>
    </section>
  );
}

