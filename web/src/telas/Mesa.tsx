// A Matéria (DESIGN.md §5): o texto do jornalista com abas Dossiê · Texto · Posts · Depois (`?aba=`). Texto é o editor
// (src/materia/TextoMateria.tsx, Tiptap, carregado só nesta rota); Dossiê, as evidências e o que cada uma sustenta;
// Posts, as peças que saíram do texto; Depois, as fontes que mudaram. A IA confere, não escreve.
import { useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ErroApi, ler } from "../api";
import { useCasca } from "../casca/contexto";
import { IconeVoltar } from "../casca/icones";
import { FalhaCarga, useTitulo } from "../comum";
import { hora, quando } from "../fila";
import { t } from "../idioma";
import { ABAS_MATERIA, IconeEstado, ROTULO_ABA, ROTULO_ESTADO, ROTULO_STATUS_POST, abaMateria, chaveTextos, type AbaMateria } from "../novo/mesa";
import { Dossie, NomeEvidencia, qtd, resumoDossie, rota, type Afirmacao, type EstadoMesa, type Resumo } from "../materia/comum";
import TextoMateria from "../materia/TextoMateria";
import { OutroLado, PacoteDefesa, PEDIR_OUTRO_LADO, resumoOutroLado } from "../materia/Escudo";
import { BotaoPdf, Documentos, resumoDocumentos, useEnviarPdf } from "../materia/Documentos";
import { BotaoAudio, Gravacoes, resumoGravacoes, useEnviarAudio } from "../materia/Gravacoes";
import { AbaDepois, PedidosLai, resumoLai } from "../materia/Viva";
import { alertaPrimeiro, Partes, type ItemParte } from "../kit/Partes";

export default function Mesa() {
  const { veiculo } = useCasca();
  const { id = "" } = useParams();
  const tenantId = veiculo.id;
  const qc = useQueryClient();
  const chave = [tenantId, "texto", id] as const;
  // Enquanto um PDF está sendo lido ou uma gravação transcrita (na fila), a Matéria pergunta de novo a cada 2 s, em
  // qualquer aba: a marca da aspa e o checklist mudam no Texto quando a transcrição fica pronta.
  const q = useQuery({
    queryKey: chave, queryFn: () => ler(rota.$get({ param: { tenantId, id } })), refetchOnWindowFocus: false,
    refetchInterval: (qq) => (qq.state.data?.documentos.some((d) => d.estado === "lendo") || qq.state.data?.gravacoes.some((g) => g.estado === "lendo") ? 2000 : false),
  });
  useTitulo(q.data?.texto.titulo || t("Texto", "Text"), t("Textos", "Texts"), veiculo.nome);
  const editor = veiculo.papel !== "reporter";
  const [params] = useSearchParams();
  const aba = abaMateria(params.get("aba"));
  // Recarregar (conflito de versão, reimportação): o editor monta de novo com o texto do servidor.
  const [montagem, setMontagem] = useState(0);

  const atualizar = (d: EstadoMesa) => {
    qc.setQueryData(chave, d);
    qc.invalidateQueries({ queryKey: chaveTextos(tenantId) });
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
    // Texto que não existe mais é fato, não falha de carga: tentar de novo não adianta.
    if (q.error instanceof ErroApi && q.error.status === 404) {
      return (
        <div className="mx-auto grid max-w-[880px] gap-2 px-5 pt-6 lg:px-12 lg:pt-10">
          <p className="m-0">{t("Este texto não existe mais.", "This text no longer exists.")}</p>
          <Link to={`/t/${veiculo.slug}/textos`} className="link-acao justify-self-start">{t("Ver os textos", "See the texts")}</Link>
        </div>
      );
    }
    return <div className="mx-auto max-w-[880px] px-5 pt-6 lg:px-12 lg:pt-10"><FalhaCarga oque={t("o texto", "the text")} tentar={() => q.refetch()} /></div>;
  }
  const { texto, afirmacoes, evidencias } = q.data;
  const conferido = texto.conferidoVersao === texto.versao;
  const cabeca = (titulo: ReactNode, situacao: ReactNode = null) => (
    <>
      <Link to={`/t/${veiculo.slug}/textos`} viewTransition className="link-acao inline-flex min-h-11 items-center gap-1 text-[15px]">
        <IconeVoltar className="size-4" /> {t("Textos", "Texts")}
      </Link>
      <p className="mono m-0 mt-2 flex flex-wrap gap-x-2 text-apoio">
        <span>
          {texto.origem === "docs" ? <>{t("do ", "from ")}<a href={texto.docsUrl ?? "#"} target="_blank" rel="noreferrer" className="link-acao font-normal">Google Docs</a></> : texto.origem === "escrito" ? t("escrito aqui", "written here") : t("colado", "pasted")}
          {" · "}{t("versão", "version")} {texto.versao}{conferido && texto.conferidoEm ? t(` · conferido às ${hora(texto.conferidoEm)}`, ` · checked at ${hora(texto.conferidoEm)}`) : ""}
        </span>
        {situacao && <>· {situacao}</>}
      </p>
      {titulo}
      <AbasMateria aba={aba} mudou={q.data.alertas.filter((a) => a.estado === "aberto").length} evidencias={evidencias.length} />
    </>
  );
  const h1 = <h1 id="titulo-texto" className="titulo-tela m-0 mt-2 text-[30px] leading-[1.1] lg:text-[40px]">{texto.titulo || t("Sem título", "Untitled")}</h1>;

  // Com o Material ao lado (coluna de 360 px à esquerda da folha), o contêiner se alarga de 1180 px para cima.
  const material = aba === "texto" && params.get("material") === "aberto";
  return (
    <div className={`mx-auto max-w-[1280px] px-5 pt-5 pb-14 lg:px-12 lg:pt-8 ${material ? "min-[1180px]:max-w-[1760px]" : ""}`}>
      {aba === "texto" ? (
        <TextoMateria key={`${id}:${montagem}`} estado={q.data} tenantId={tenantId} id={id} slug={veiculo.slug} podeEditar={editor} admin={veiculo.papel === "admin"} atualizar={atualizar} cabeca={cabeca}
          recarregar={() => { void q.refetch().then(() => setMontagem((n) => n + 1)); }} />
      ) : (
        <>
          {cabeca(h1)}
          <div className={`mt-6 ${aba === "dossie" ? "" : "max-w-[880px]"}`}>
            {aba === "dossie" && <AbaDossie tenantId={tenantId} textoId={id} estado={q.data} editor={editor} atualizar={atualizar} />}
            {aba === "posts" && <AbaPosts tenantId={tenantId} textoId={id} slug={veiculo.slug} />}
            {aba === "depois" && <AbaDepois tenantId={tenantId} textoId={id} slug={veiculo.slug} estado={q.data} editor={editor} atualizar={atualizar} />}
          </div>
        </>
      )}
    </div>
  );
}

// ── abas da Matéria ─────────────────────────────────────────────────────────────────────────────────────────────

function AbasMateria({ aba, mudou, evidencias }: { aba: AbaMateria; mudou: number; evidencias: number }) {
  const conta: Partial<Record<AbaMateria, string>> = { dossie: String(evidencias), depois: mudou ? String(mudou) : "" };
  return (
    <nav aria-label={t("Partes da matéria", "Parts of the story")} className="mt-4 flex gap-1 overflow-x-auto border-b border-fio pb-2">
      {ABAS_MATERIA.map((a) => (
        <Link key={a} to={a === "texto" ? "?" : `?aba=${a}`} replace aria-current={a === aba ? "page" : undefined}
          className={`inline-flex min-h-11 flex-none items-center gap-1.5 rounded-btn px-3.5 text-[15px] no-underline ${a === aba ? "bg-tinta-clara font-bold text-tinta" : "text-texto hover:bg-papel-2"}`}>
          {ROTULO_ABA[a]}
          {conta[a] ? <span className="mono text-[13px] text-apoio">{conta[a]}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

/** Dossiê: um índice com a situação de cada parte, uma aberta por vez. O que está vencendo ou sem resposta vem primeiro e abre sozinho; parte vazia é uma linha com a sua ação. */
function AbaDossie({ tenantId, textoId, estado, editor, atualizar }: {
  tenantId: string; textoId: string; estado: EstadoMesa; editor: boolean; atualizar: (d: EstadoMesa) => void;
}) {
  // A fonte presa pela pessoa vale no lugar da do modelo; ignorada e opinião não contam.
  const sustenta = (a: Afirmacao) => (a.apuracao?.tipo === "fonte" ? { ev: a.apuracao.evidenciaId, trecho: a.apuracao.evidenciaTrecho }
    : !a.apuracao && a.estado === "com_evidencia" ? { ev: a.evidenciaId, trecho: a.evidenciaTrecho } : null);
  const usadas = estado.evidencias.map((e) => ({ e, frases: estado.afirmacoes.flatMap((a) => { const s = sustenta(a); return s?.ev === e.id ? [{ ...a, evidenciaTrecho: s.trecho }] : []; }) }))
    .filter((x) => x.frases.length);
  const enviarPdf = useEnviarPdf(tenantId, textoId, atualizar);
  const enviarAudio = useEnviarAudio(tenantId, textoId, atualizar);
  const [gravando, setGravando] = useState<string | null>(null);
  const [avisoPacote, setAvisoPacote] = useState<Resumo | null>(null);
  const [params, setParams] = useSearchParams();
  const props = { tenantId, textoId, estado, editor, atualizar };
  const item = (id: string, rotulo: string, r: Resumo, conteudo: ReactNode, acao?: ReactNode): ItemParte => ({ id, rotulo, resumo: r.texto, tom: r.tom, conteudo, acao });
  const pedirOutroLado = () => setParams((p) => { p.set("parte", "outro-lado"); p.set("pedir", PEDIR_OUTRO_LADO); return p; }, { replace: true, preventScrollReset: true });
  const frases = usadas.reduce((n, x) => n + x.frases.length, 0);
  const itens = alertaPrimeiro([
    item("dossie", t("Dossiê", "Dossier"), resumoDossie(estado), <Dossie {...props} emPartes />),
    item("documentos", t("Documentos", "Documents"), resumoDocumentos(estado, enviarPdf.error), <Documentos {...props} enviar={enviarPdf} />,
      editor && !estado.documentos.length ? <BotaoPdf enviar={enviarPdf} /> : undefined),
    item("gravacoes", t("Gravações", "Recordings"), resumoGravacoes(estado, enviarAudio.error, gravando), <Gravacoes {...props} enviar={enviarAudio} avisar={setGravando} />,
      editor && !estado.gravacoes.length ? <BotaoAudio enviar={enviarAudio} /> : undefined),
    item("lai", t("Pedidos de LAI", "FOI requests (LAI)"), resumoLai(estado), <PedidosLai {...props} />),
    item("outro-lado", t("Outro lado", "Other side"), resumoOutroLado(estado), <OutroLado {...props} />,
      editor && !estado.outroLado.pedidos.length && params.get("pedir") !== PEDIR_OUTRO_LADO
        ? <button type="button" className="btn-sec flex-none bg-papel-2" onClick={pedirOutroLado}>{t("Pedir o outro lado", "Ask the other side")}</button> : undefined),
    ...(usadas.length ? [item("sustenta", t("O que cada fonte sustenta", "What each source supports"), { texto: t(`${qtd(usadas.length, "fonte", "fontes")} · ${qtd(frases, "frase", "frases")}`, `${qtd(usadas.length, "source", "sources")} · ${qtd(frases, "sentence", "sentences")}`) }, (
      <ul className="m-0 grid list-none gap-3 p-0">
        {usadas.map(({ e, frases: delas }) => (
          <li key={e.id} className="grid gap-2 rounded-card bg-branco px-4 py-3 shadow-curta">
            <NomeEvidencia e={e} />
            {delas.map((a) => (
              <div key={a.id} className="grid gap-1 border-t border-fio pt-2">
                <p className="m-0 flex items-start gap-1.5 text-[15px]"><IconeEstado estado="com_evidencia" className="mt-1 size-3.5" /><span><span className="sr-only">{ROTULO_ESTADO.com_evidencia}: </span>“{a.trecho}”</span></p>
                <p className="m-0 text-[15px] leading-[1.55]"><mark className="bg-verde-claro px-0.5 text-texto-forte [box-decoration-break:clone]">{a.evidenciaTrecho}</mark></p>
              </div>
            ))}
          </li>
        ))}
      </ul>
    ))] : []),
    item("pacote", t("Pacote de defesa", "Defense package"), avisoPacote ?? { texto: t("zip com carimbo de tempo", "zip with a timestamp") }, <PacoteDefesa tenantId={tenantId} textoId={textoId} editor={editor} avisar={setAvisoPacote} />),
  ]);
  return <Partes itens={itens} padrao={itens[0].id} rotulo={t("Partes do dossiê", "Parts of the dossier")} />;
}

/** Posts: as peças das pautas que saíram do texto, com o status e o link para a peça. */
function AbaPosts({ tenantId, textoId, slug }: { tenantId: string; textoId: string; slug: string }) {
  const q = useQuery({ queryKey: [tenantId, "texto", textoId, "posts"], queryFn: () => ler(rota.posts.$get({ param: { tenantId, id: textoId } })) });
  if (q.isPending) return <div aria-busy="true"><p role="status" className="sr-only">{t("Carregando os posts", "Loading the posts")}</p><div className="esqueleto h-[72px]" /></div>;
  if (q.isError) return <FalhaCarga oque={t("os posts", "the posts")} tentar={() => q.refetch()} />;
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
                {p.formato === "reels" ? "Reels" : p.formato === "carrossel" ? t("carrossel", "carousel") : "post"} · {ROTULO_STATUS_POST[p.status] ?? p.status} · {quando(p.atualizadoEm)}
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

