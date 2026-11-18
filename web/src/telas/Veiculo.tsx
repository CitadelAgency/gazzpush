// Tela do veículo: Marca · Contas · Fontes · Equipe, uma aba por vez na URL (?aba=). O título é o nome da parte (o
// mesmo do menu); as abas só aparecem no celular, porque no computador o grupo Veículo da lateral já é essa fila.
// Só o admin altera; editor e repórter veem tudo em leitura com a frase no alto. Formulários no padrão do "Criar veículo" (campos sem contorno,
// fio embaixo), cards de papel como a lateral, azul só na ação (um botão de salvar por aba).
import type { ParamsEstilo } from "../../../src/lib/estilo";
import { SecaoModelos, resumoModelos, useEstilos } from "./Modelos";
import { SecaoPatrocinios, resumoPatrocinios, usePatrocinios } from "./Patrocinios";
import { lazy, Suspense, useDeferredValue, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { corpoArquivo, corpoJson, ErroApi, ler } from "../api";
import { useCasca } from "../casca/contexto";
import { FalhaCarga, useTitulo } from "../comum";
import { MESTRE, Parte, useMidia, useParte } from "../kit/Partes";
import { chaves, useContas } from "../fila";
import { t as tr } from "../idioma";
import { CamposMarca, PreviaMarca, SeletorFontes, SeletorIdiomaPosts, useCapa, useEstadoMarca } from "../novo/CamposMarca";
import { idiomaDoVeiculo, type IdiomaConteudo } from "../../../src/lib/idiomaConteudo";
import { CATALOGO_FONTES, PAR_PADRAO, ehParFontes, type ParFontes } from "../../../src/lib/tipografia";
import { contraste, CORES_PADRAO, type Cores } from "../novo/previa";
import { localDe, type Veiculo as Veic } from "../sessao";
import { Carga, t } from "./veiculo/comum";

// Contas, Fontes (com a Cobertura) e Equipe carregam só quando abrem: fora do orçamento de JS da Marca.
const Contas = lazy(() => import("./veiculo/Contas"));
const Fontes = lazy(() => import("./veiculo/Fontes"));
const Equipe = lazy(() => import("./veiculo/Equipe"));
const Kit = lazy(() => import("./veiculo/Kit"));
const Plano = lazy(() => import("./veiculo/Plano"));
const Chaves = lazy(() => import("./veiculo/Chaves"));

export const ABAS = [
  { id: "marca", get rotulo() { return tr("Marca", "Brand"); } },
  { id: "contas", get rotulo() { return tr("Contas", "Accounts"); } },
  { id: "fontes", get rotulo() { return tr("Fontes", "Sources"); } },
  { id: "equipe", get rotulo() { return tr("Equipe", "Team"); } },
  { id: "kit", get rotulo() { return tr("Se a conta cair", "If the account goes down"); } },
  { id: "plano", get rotulo() { return tr("Plano", "Plan"); } },
  { id: "chaves", get rotulo() { return tr("Chaves de IA", "AI keys"); } },
] as const;
export type Aba = (typeof ABAS)[number]["id"];
/** `?aba=` → aba; desconhecida ou ausente abre a Marca. */
export const abaDe = (v: string | null): Aba => (ABAS.some((a) => a.id === v) ? (v as Aba) : "marca");

export const chaveMarca = (tenantId: string) => [tenantId, "marca"] as const;

export default function Veiculo() {
  const { veiculo } = useCasca();
  const [params] = useSearchParams();
  const aba = abaDe(params.get("aba"));
  const rotulo = ABAS.find((a) => a.id === aba)!.rotulo;
  useTitulo(rotulo, tr("Veículo", "Publication"), veiculo.nome);
  const admin = veiculo.papel === "admin";
  return (
    <div className="mx-auto max-w-[1180px] px-5 pt-6 pb-12 lg:px-12 lg:pt-3">
      <header className="grid gap-4">
        <h1 className="titulo-tela m-0 text-[32px] lg:text-[34px]">{rotulo}</h1>
        <nav aria-label={tr("Partes do veículo", "Publication sections")} className="-mx-5 flex gap-1 overflow-x-auto px-5 lg:hidden">
          {ABAS.map((a) => (
            <Link key={a.id} to={`?aba=${a.id}`} replace aria-current={a.id === aba ? "page" : undefined}
              className={`inline-flex min-h-11 flex-none items-center rounded-btn px-3.5 text-[15px] no-underline ${a.id === aba ? "bg-tinta-clara font-bold text-tinta" : "text-texto hover:bg-papel-2"}`}>
              {a.rotulo}
            </Link>
          ))}
        </nav>
        {!admin && <p role="note" className="m-0 w-fit rounded-faixa bg-papel-2 px-3 py-2 text-[15px] text-apoio">{tr("Só o admin altera. Você vê como está.", "Only the admin can change this. You see it as it is.")}</p>}
      </header>
      <div className="mt-5 lg:mt-6">
        {aba === "marca" && <Marca veiculo={veiculo} admin={admin} />}
        <Suspense fallback={<Carga oque={tr(`a aba ${rotulo}`, `the ${rotulo} tab`)} />}>
          {aba === "contas" && <Contas veiculo={veiculo} admin={admin} />}
          {aba === "fontes" && <Fontes veiculo={veiculo} admin={admin} />}
          {aba === "equipe" && <Equipe veiculo={veiculo} admin={admin} />}
          {aba === "kit" && <Kit veiculo={veiculo} admin={admin} />}
          {aba === "plano" && <Plano veiculo={veiculo} admin={admin} />}
          {aba === "chaves" && <Chaves veiculo={veiculo} admin={admin} />}
        </Suspense>
      </div>
    </div>
  );
}

const mensagemSalvar = (e: unknown) =>
  e instanceof ErroApi && e.status !== 0
    ? tr(`Não salvou: ${e.message}.`, `Couldn't save: ${e.message}.`)
    : tr("Não salvou: sem conexão. Tente de novo.", "Couldn't save: no connection. Try again.");

// ── Marca ───────────────────────────────────────────────────────────────────────────────────────────────────────

type CtaTexto = { titulo: string; texto: string; legenda: string; acao: string };
/** Botão vazio = sem botão próprio (o render usa o título); os outros três são obrigatórios. */
const ctaParaEnvio = (c: CtaTexto) => (c.acao.trim() ? c : { titulo: c.titulo, texto: c.texto, legenda: c.legenda });
type MarcaDaguaUi = { posicao: "canto" | "rodape" | "nenhuma"; opacidade: number };
const REFERENCIA_MAX = 2 * 1024 * 1024;
const ESTILO_MAX = 300;
// Funções, não constantes: o texto sai no idioma da hora de desenhar.
const camposCta = (): [keyof CtaTexto, string, number, string][] => [
  ["titulo", tr("Título", "Title"), 80, tr("A frase grande do último card.", "The big line on the last card.")],
  ["texto", tr("Texto", "Text"), 200, tr("Uma frase de apoio embaixo do título.", "A supporting line below the title.")],
  ["legenda", tr("Fim da legenda", "Caption ending"), 300, tr("A linha que fecha a legenda no Instagram.", "The line that closes the caption on Instagram.")],
  ["acao", tr("Botão (opcional)", "Button (optional)"), 60, tr("O convite curto: \"Siga\", \"Manda no direct\". Vazio, vale o título.", "The short call to action: \"Follow\", \"Send us a DM\". Left empty, the title is used.")],
];
const posicoesMd = (): [MarcaDaguaUi["posicao"], string, string][] => [
  ["canto", tr("Canto", "Corner"), tr("No alto, à direita, sobre a ilustração.", "Top right, over the illustration.")],
  ["rodape", tr("Rodapé", "Footer"), tr("Pequena, centrada embaixo.", "Small, centered at the bottom.")],
  ["nenhuma", tr("Nenhuma", "None"), tr("Os cards saem sem marca d'água.", "Cards go out without a watermark.")],
];

// A aba em quatro seções, uma escolhida por vez (vai para a URL: ?secao=), com a prévia do card que ela altera. De
// 1280 px para cima (`xl`), mestre-detalhe: a lista fixa das seções à esquerda, os campos da escolhida no meio e a
// prévia à direita (os destinos não mudam de lugar ao trocar). Abaixo disso, acordeão: de 1024 a 1279 px com a prévia
// à direita; no celular, a prévia logo abaixo dos campos da seção aberta. O estado inteiro fica aqui: trocar de seção
// só mostra e esconde, nada do que foi mexido se perde; o que difere do salvo vira "alterado". Um "Salvar a marca" só.
export const SECOES_MARCA = [
  { id: "nome", get rotulo() { return tr("Nome e cores", "Name and colors"); } },
  { id: "ilustracao", get rotulo() { return tr("Ilustração", "Illustration"); } },
  { id: "convites", get rotulo() { return tr("Convite do fim", "Invite card"); } },
  { id: "marca-dagua", get rotulo() { return tr("Marca d'água", "Watermark"); } },
  { id: "modelos", get rotulo() { return tr("Modelos", "Templates"); } },
  { id: "patrocinios", get rotulo() { return tr("Patrocínios", "Sponsors"); } },
] as const;
export type SecaoMarca = (typeof SECOES_MARCA)[number]["id"];
/** `?secao=` → seção; desconhecida ou ausente abre a primeira. */
export const secaoDe = (v: string | null): SecaoMarca => (SECOES_MARCA.some((s) => s.id === v) ? (v as SecaoMarca) : "nome");

// `lg` (≥ 1024 px): a prévia vai para a coluna da direita; `xl` (≥ 1280 px): mestre-detalhe. Uma prévia só no DOM.
const LG = "(min-width: 1024px)";

/** Texto como o servidor grava (espaços colapsados, sem pontas): comparar com o salvo sem acusar diferença falsa. */
const limpo = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const ctaMudou = (a: CtaTexto, b: Partial<CtaTexto> | undefined) => camposCta().some(([k]) => limpo(a[k]) !== limpo(b?.[k]));
/** "A", "A e B", "A, B e C". */
const emLista = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")}${tr(" e ", " and ")}${xs[xs.length - 1]}`);
const Alterado = () => <span className="text-texto-forte">{tr("alterado", "changed")}</span>;

function Marca({ veiculo, admin }: { veiculo: Veic; admin: boolean }) {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const secao = secaoDe(params.get("secao"));
  const abrir = (s: SecaoMarca) => setParams((p) => {
    p.set("aba", "marca"); p.set("secao", s);
    if (s !== "modelos") { p.delete("modelo"); p.delete("grupo"); p.delete("previa"); }
    return p;
  }, { replace: true });
  const largo = useMidia(LG);
  const mestre = useMidia(MESTRE);
  const [letra, abrirLetra] = useParte("letra", null);
  // Só recarrega quando esta tela manda (depois de salvar): uma recarga de fundo apagaria o que está sendo editado.
  const marca = useQuery({
    queryKey: chaveMarca(veiculo.id),
    queryFn: () => ler(t.marca.$get({ param: { tenantId: veiculo.id } })),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const m = useEstadoMarca();
  // Veículo de autor: a assinatura do card de autor entra em Nome e cores.
  const autoral = veiculo.modo === "autoral";
  const [estiloArte, setEstiloArte] = useState("");
  const [ctas, setCtas] = useState<CtaTexto[]>([]);
  const [conviteAberto, setConviteAberto] = useState(0);
  const [marcaDagua, setMarcaDagua] = useState<MarcaDaguaUi>({ posicao: "nenhuma", opacidade: 0.4 });
  const [fontes, setFontes] = useState<ParFontes>(PAR_PADRAO);
  const [idiomaPosts, setIdiomaPosts] = useState<IdiomaConteudo>("pt-BR");
  const idiomaSalvo = idiomaDoVeiculo(marca.data?.idioma);
  const [referencia, setReferencia] = useState<{ arquivo: File; url: string } | null>(null);
  const [erroReferencia, setErroReferencia] = useState<string | null>(null);
  const [falta, setFalta] = useState<string | null>(null);
  const dados = marca.data?.marca;
  // Um @, uma conta: salvar o @ sem conta ativa liga a conta manual com esse @.
  const contas = useContas(veiculo.id);
  const semConta = admin && contas.isSuccess && contas.data.contas.length === 0;
  // O formulário parte do que está salvo: na primeira carga e depois de salvar (o dado muda).
  useEffect(() => {
    if (!dados) return;
    m.repor({ handle: dados.handle ?? "", cores: { ...CORES_PADRAO, ...(dados.cores as Partial<Cores>) }, assinatura: dados.assinatura ?? "" });
    setEstiloArte(dados.estiloArte ?? "");
    setCtas(dados.ctas);
    setMarcaDagua(dados.marcaDagua as MarcaDaguaUi);
    setFontes(ehParFontes(dados.fontes) ? dados.fontes : PAR_PADRAO);
    setIdiomaPosts(idiomaSalvo);
    setReferencia(null);
    setErroReferencia(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dados]);

  // O que difere do salvo, por seção (logo e referência novos contam). Só para quem pode salvar.
  const coresSalvas = { ...CORES_PADRAO, ...(dados?.cores as Partial<Cores> | undefined) };
  const ctasSalvos = (dados?.ctas ?? []) as Partial<CtaTexto>[];
  const mdSalva = dados?.marcaDagua as MarcaDaguaUi | undefined;
  const alterada: Record<SecaoMarca, boolean> = !admin || !dados ? { nome: false, ilustracao: false, convites: false, "marca-dagua": false, modelos: false, patrocinios: false } : {
    modelos: false, patrocinios: false,
    nome: !!m.logo || m.handle.replace(/^@/, "") !== (dados.handle ?? "").replace(/^@/, "")
      || (autoral && m.assinatura.trim() !== (dados.assinatura ?? ""))
      || fontes !== (ehParFontes(dados.fontes) ? dados.fontes : PAR_PADRAO)
      || idiomaPosts !== idiomaSalvo
      || (["fundo", "texto", "acento"] as const).some((k) => m.cores[k].toLowerCase() !== coresSalvas[k].toLowerCase()),
    ilustracao: !!referencia || limpo(estiloArte) !== limpo(dados.estiloArte),
    convites: ctas.some((c, i) => ctaMudou(c, ctasSalvos[i])),
    "marca-dagua": !!mdSalva && (marcaDagua.posicao !== mdSalva.posicao || Math.round(marcaDagua.opacidade * 100) !== Math.round(mdSalva.opacidade * 100)),
  };
  const alteradas = SECOES_MARCA.filter((s) => alterada[s.id]).map((s) => s.rotulo);
  // Recarregar ou fechar com alteração pendente: o navegador pergunta antes.
  const pendente = alteradas.length > 0;
  useEffect(() => {
    if (!pendente) return;
    const avisar = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    addEventListener("beforeunload", avisar);
    return () => removeEventListener("beforeunload", avisar);
  }, [pendente]);

  // Prévia: a capa (com a referência no lugar da ilustração, na seção Ilustração) e, na seção do convite, o último card,
  // cujo template só carrega quando ela abre (orçamento de JS da tela).
  const logoUrl = m.logo?.url ?? dados?.logo ?? null;
  const refUrl = referencia?.url ?? dados?.referencia ?? null;
  const [estiloPrevia, setEstiloPrevia] = useState<ParamsEstilo | null>(null);
  const estilosDoVeiculo = useEstilos(veiculo.id);
  const patrociniosDoVeiculo = usePatrocinios(veiculo.id);
  const capa = useCapa(veiculo, m, { estilo: secao === "modelos" ? estiloPrevia : null, logoAtual: dados?.logo ?? null, marcaDagua, arte: secao === "ilustracao" ? refUrl : null, dominio: dados?.dominio ?? null, fontes, idioma: idiomaPosts });
  const [modConvite, setModConvite] = useState<typeof import("../novo/previaConvite") | null>(null);
  useEffect(() => {
    if (secao === "convites" && !modConvite) import("../novo/previaConvite").then(setModConvite, () => {});
  }, [secao, modConvite]);
  const convite = useDeferredValue(ctas[conviteAberto] ?? null);
  const cores = useDeferredValue(m.cores);
  const handle = m.handle ? `@${m.handle.replace(/^@/, "")}` : "";
  const htmlConvite = useMemo(() => (modConvite && convite
    ? modConvite.htmlPreviaConvite({ nome: veiculo.nome, handle, cores, logo: logoUrl, convite, fontes, idioma: idiomaPosts }) : ""), [modConvite, convite, cores, handle, logoUrl, veiculo.nome, fontes, idiomaPosts]);

  function escolherReferencia(arquivo: File | undefined) {
    setErroReferencia(null);
    if (!arquivo) return;
    if (arquivo.type !== "image/png" && arquivo.type !== "image/jpeg") { setErroReferencia(tr("A referência precisa ser PNG ou JPEG.", "The reference must be a PNG or JPEG.")); return; }
    if (arquivo.size > REFERENCIA_MAX) { setErroReferencia(tr("A referência pode ter até 2 MB.", "The reference can be up to 2 MB.")); return; }
    setReferencia({ arquivo, url: URL.createObjectURL(arquivo) });
  }

  const salvar = useMutation({
    mutationFn: async () => {
      const param = { tenantId: veiculo.id };
      await ler(t.marca.$patch({ param }, corpoJson({
        handle: m.handle, cores: m.cores, estiloArte, marcaDagua, fontes, idioma: idiomaPosts, ...(autoral ? { assinatura: m.assinatura } : {}), ...(ctas.length ? { ctas: ctas.map(ctaParaEnvio) } : {}),
      })));
      if (m.logo) await ler(t.marca.logo.$post({ param }, corpoArquivo(m.logo.arquivo)));
      if (referencia) await ler(t.marca.referencia.$post({ param }, corpoArquivo(referencia.arquivo)));
      // Lê as contas aqui (a consulta da tela pode estar pendente ou ter falhado): com @ e nenhuma ativa, liga a manual.
      const h = m.handle.trim().replace(/^@/, "");
      if (h && admin) {
        const ativas = (await ler(t.contas.$get({ param, query: { todas: undefined } }))).contas;
        if (!ativas.length) await ler(t.contas.$post({ param }, corpoJson({ nome: `@${h}`, modo: "manual" })));
      }
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: chaveMarca(veiculo.id) }), qc.invalidateQueries({ queryKey: ["me"] }), qc.invalidateQueries({ queryKey: chaves.contas(veiculo.id) }),
      ]);
    },
  });

  if (marca.isPending) return <Carga oque={tr("a marca", "the brand")} />;
  if (marca.isError) return <FalhaCarga oque={tr("a marca", "the brand")} tentar={() => marca.refetch()} />;
  // Campos obrigatórios de um convite fechado não passam pela validação do navegador (não estão na tela): confere
  // aqui e abre o convite que falta, em vez de mandar e voltar com erro do servidor.
  function enviar(e: FormEvent) {
    e.preventDefault();
    const i = ctas.findIndex((c) => !c.titulo.trim() || !c.texto.trim() || !c.legenda.trim());
    if (i >= 0) {
      abrir("convites");
      setConviteAberto(i);
      setFalta(tr(`Convite ${i + 1}: preencha Título, Texto e Fim da legenda.`, `Invite ${i + 1}: fill in Title, Text and Caption ending.`));
      return;
    }
    setFalta(null);
    salvar.mutate();
  }
  const ro = !admin;
  const mudarCta = (i: number, k: keyof CtaTexto, v: string) => setCtas((cs) => cs.map((c, j) => (j === i ? { ...c, [k]: v } : c)));
  const semReferencia = dados ? !dados.temReferencia && !referencia : false;
  const local = localDe(veiculo) || "card";
  const contrasteBaixo = contraste(m.cores.texto, m.cores.fundo) < 4.5;

  // Resumo de cada seção (na linha fechada do acordeão e no item da lista): "alterado" primeiro, para o corte do
  // `truncate` nunca levar essa palavra; os avisos em âmbar.
  const resumos: Record<SecaoMarca, ReactNode> = {
    modelos: resumoModelos(estilosDoVeiculo.data?.estilos.length),
    patrocinios: resumoPatrocinios(patrociniosDoVeiculo.data?.patrocinios.length),
    nome: (
      <>
        <span aria-hidden="true" className="mr-2 inline-flex gap-1 align-[-1px]">
          {(["fundo", "texto", "acento"] as const).map((k) => <i key={k} className="inline-block size-3 rounded-full ring-1 ring-fio-forte" style={{ background: m.cores[k] }} />)}
        </span>
        {[handle || tr("sem @", "no @"), logoUrl ? tr("logo", "logo") : tr("sem logo", "no logo"), tr("3 cores", "3 colors"), tr(CATALOGO_FONTES[fontes].nome, CATALOGO_FONTES[fontes].nomeEn), idiomaPosts === "en" ? tr("posts em inglês", "posts in English") : tr("posts em português", "posts in Portuguese")].join(" · ")}
        {contrasteBaixo && <>{" · "}<span className="text-ambar">{tr("contraste baixo", "low contrast")}</span></>}
      </>
    ),
    ilustracao: (
      <>
        {estiloArte.trim() ? `“${estiloArte.trim()}”` : tr("sem estilo definido", "no style set")}{" · "}
        {semReferencia ? <span className="text-ambar">{tr("sem imagem de referência", "no reference image")}</span> : tr("com imagem", "with image")}
      </>
    ),
    convites: ctas.length
      ? tr(`${ctas.length} ${ctas.length === 1 ? "convite" : "convites"}`, `${ctas.length} ${ctas.length === 1 ? "invite" : "invites"}`)
      : tr("sem convite", "no invite"),
    "marca-dagua": marcaDagua.posicao === "nenhuma" ? tr("nenhuma", "none")
      : `${marcaDagua.posicao === "canto" ? tr("canto", "corner") : tr("rodapé", "footer")} ·${Math.round(marcaDagua.opacidade * 100)} %`,
  };
  const resumo = (s: SecaoMarca) => (alterada[s] ? <><Alterado />{" · "}{resumos[s]}</> : resumos[s]);

  const ctaAberto = ctas[conviteAberto];
  const previa = secao === "convites" && ctaAberto ? (
    <PreviaMarca html={htmlConvite} legenda={tr(`Convite ${conviteAberto + 1} · último card`, `Invite ${conviteAberto + 1} · last card`)}>
      <p className="ajuda m-0 max-w-[46ch]">{tr("Fim da legenda: ", "Caption ending: ")}{ctaAberto.legenda || tr("vazio", "empty")}</p>
    </PreviaMarca>
  ) : secao === "convites" ? (
    <PreviaMarca html={capa} legenda={tr(`Sem convite · prévia da capa · ${local}`, `No invite · cover preview · ${local}`)} />
  ) : secao === "ilustracao" ? (
    <PreviaMarca html={capa} legenda={refUrl
      ? tr("Referência no lugar da ilustração · ela orienta o estilo, não sai no post", "Reference in place of the illustration · it guides the style and isn't posted")
      : tr("Sem ilustração: fundo liso da marca", "No illustration: plain brand background")}>
      <p className="ajuda m-0 max-w-[46ch]">{estiloArte.trim() ? tr(`Estilo: “${estiloArte.trim()}”`, `Style: “${estiloArte.trim()}”`) : tr("Sem estilo definido: o estilo sai das cores.", "No style set: the style comes from the colors.")}</p>
    </PreviaMarca>
  ) : secao === "modelos" ? (
    <PreviaMarca html={capa} legenda={estiloPrevia ? tr("Prévia do modelo aberto", "Preview of the open template") : tr("Abra um modelo para ver a prévia dele", "Open a template to preview it")} />
  ) : (
    <PreviaMarca html={capa} legenda={tr(`Prévia da marca · ${local}`, `Brand preview · ${local}`)} />
  );

  // Os campos de cada seção, os mesmos no acordeão e no painel do mestre-detalhe.
  const campos: Record<SecaoMarca, () => ReactNode> = {
    modelos: () => <SecaoModelos tenantId={veiculo.id} admin={admin} mudouPrevia={setEstiloPrevia} previaCelular={largo ? null : capa} />,
    patrocinios: () => <SecaoPatrocinios tenantId={veiculo.id} admin={admin} />,
    nome: () => (
      <>
        <CamposMarca m={m} logoAtual={dados?.logo ?? null} somenteLeitura={ro} semConta={semConta} autoral={autoral} />
        <Parte id="letra" nivel="h4" rotulo={tr("Letra e idioma", "Type and language")} aberta={letra === "aberta"} alternar={() => abrirLetra(letra === "aberta" ? null : "aberta")}
          resumo={`${tr(CATALOGO_FONTES[fontes].nome, CATALOGO_FONTES[fontes].nomeEn)} · ${idiomaPosts === "en" ? "English" : "Português"}`}>
          <SeletorFontes valor={fontes} mudar={setFontes} somenteLeitura={ro} />
          <SeletorIdiomaPosts valor={idiomaPosts} mudar={setIdiomaPosts} somenteLeitura={ro} />
        </Parte>
      </>
    ),
    ilustracao: () => (
      <>
        {semReferencia && <p role="note" className="faixa-aviso m-0">{tr("Sem imagem de referência: as ilustrações saem no estilo padrão.", "No reference image: illustrations use the default style.")}</p>}
        <fieldset disabled={ro} className="m-0 grid min-w-0 gap-5 border-0 p-0">
          <legend className="sr-only">{tr("Estilo da ilustração", "Illustration style")}</legend>
          <label className="campo">
            <span>{tr("Estilo em uma frase", "Style in one sentence")}</span>
            <textarea className="entrada min-h-[96px] resize-y py-2" value={estiloArte} maxLength={ESTILO_MAX} rows={3} autoCapitalize="sentences" enterKeyHint="enter"
              onChange={(e) => setEstiloArte(e.target.value)} aria-describedby="estilo-ajuda" />
            <span id="estilo-ajuda" className="ajuda">
              {tr("Ex.: “tons de areia e azul do mar, traço solto”. Vazio, o estilo sai das cores.", "E.g. “sand and sea-blue tones, loose strokes”. Left empty, the style comes from the colors.")} {estiloArte.length}/{ESTILO_MAX}
            </span>
          </label>
          <div className="grid gap-2">
            <span className="text-[15px] font-bold text-texto-forte" id="ref-rotulo">{tr("Imagem de referência", "Reference image")}</span>
            <div className="flex flex-wrap items-center gap-3">
              {refUrl && <img src={refUrl} alt={tr("Imagem de referência atual", "Current reference image")} className="h-20 w-20 rounded-card bg-papel-2 object-cover" />}
              {!ro && (
                <label className="btn-sec bg-papel-2">
                  {refUrl ? tr("Trocar imagem", "Change image") : tr("Escolher imagem", "Choose image")}
                  <input type="file" accept="image/png,image/jpeg" className="sr-only" aria-labelledby="ref-rotulo" aria-describedby="ref-ajuda"
                    onChange={(e) => escolherReferencia(e.target.files?.[0])} />
                </label>
              )}
              {referencia && <button type="button" className="btn-sec" onClick={() => setReferencia(null)}>{tr("Tirar", "Remove")}</button>}
            </div>
            <p id="ref-ajuda" className={`m-0 ${erroReferencia ? "text-[15px] text-terracota" : "ajuda"}`} role={erroReferencia ? "alert" : undefined}>
              {erroReferencia ?? (referencia ? referencia.arquivo.name
                : tr("Uma ilustração no estilo que você quer: a técnica e a paleta servem de modelo. PNG ou JPEG, até 2 MB, sem pessoas nem texto.",
                  "An illustration in the style you want: its technique and palette serve as the model. PNG or JPEG, up to 2 MB, with no people or text."))}
            </p>
          </div>
        </fieldset>
      </>
    ),
    convites: () => (ctas.length ? (
      <>
        <p className="m-0 text-[14px] text-apoio">{tr("O último card de cada post convida a seguir. Cada post usa um destes, em rodízio. Sem números nem dia da semana: a checagem de fatos recusaria o post.", "The last card of each post invites people to follow. Each post uses one of these, in rotation. No numbers or weekdays: the fact check would reject the post.")}</p>
        <div className="grid gap-2">
          {ctas.map((c, i) => (i === conviteAberto ? (
            <fieldset key={i} disabled={ro} className="m-0 grid min-w-0 gap-3 rounded-btn bg-papel p-4 shadow-curta">
              <legend className="float-left mb-1 w-full p-0 text-[15px] font-bold text-texto-forte">{tr(`Convite ${i + 1}`, `Invite ${i + 1}`)}</legend>
              {camposCta().map(([k, rotulo, max, ajuda]) => (
                <label key={k} className="campo">
                  <span>{rotulo}</span>
                  <input className="entrada" value={c[k] ?? ""} maxLength={max} required={k !== "acao"} autoCapitalize="sentences" enterKeyHint="next" onChange={(e) => mudarCta(i, k, e.target.value)}
                    aria-describedby={`cta-${i}-${k}`} />
                  <span id={`cta-${i}-${k}`} className="ajuda">{ajuda}</span>
                </label>
              ))}
            </fieldset>
          ) : (
            <button key={i} type="button" aria-expanded={false} onClick={() => setConviteAberto(i)}
              className="flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-btn border-0 bg-papel px-4 py-2 text-left font-[inherit] shadow-curta hover:bg-papel-2/60">
              <b className="flex-none text-[15px] text-texto-forte">{tr(`Convite ${i + 1}`, `Invite ${i + 1}`)}</b>
              <span className="min-w-0 truncate text-[15px] text-apoio">
                {admin && ctaMudou(c, ctasSalvos[i]) && <><Alterado />{" · "}</>}{c.titulo || tr("sem título", "no title")}
              </span>
            </button>
          )))}
        </div>
      </>
    ) : (
      <p className="m-0 text-apoio">{tr("Este veículo ainda não tem textos de convite: o último card sai sem convite.", "This publication has no invite texts yet: the last card goes out without an invite.")}</p>
    )),
    "marca-dagua": () => (
      <fieldset disabled={ro} className="m-0 grid min-w-0 gap-3 border-0 p-0">
        <legend className="sr-only">{tr("Marca d'água", "Watermark")}</legend>
        <p className="m-0 text-[14px] text-apoio">{tr("O logo (ou o @, sem logo) por cima dos cards, meio transparente. A prévia mostra.", "The logo (or the @, if there's no logo) over the cards, semi-transparent. The preview shows it.")}</p>
        <div role="radiogroup" aria-label={tr("Posição da marca d'água", "Watermark position")} className="grid gap-1">
          {posicoesMd().map(([v, rotulo, ajuda]) => (
            <label key={v} className={`flex items-start gap-3 rounded-btn px-3 py-2 ${ro ? "" : "cursor-pointer"} ${marcaDagua.posicao === v ? "bg-papel-2" : "hover:bg-papel-2/60"}`}>
              <input type="radio" name="marca-dagua" value={v} checked={marcaDagua.posicao === v} onChange={() => setMarcaDagua((md) => ({ ...md, posicao: v }))}
                className="mt-1 size-[18px] accent-texto-forte" />
              <span className="grid"><b className="text-texto-forte">{rotulo}</b><span className="ajuda">{ajuda}</span></span>
            </label>
          ))}
        </div>
        <label className="grid gap-1.5">
          <span className="flex items-baseline justify-between text-[15px] font-bold text-texto-forte">
            {tr("Visibilidade", "Visibility")} <span className="mono font-normal text-apoio">{Math.round(marcaDagua.opacidade * 100)}%</span>
          </span>
          <input type="range" min={20} max={80} step={5} value={Math.round(marcaDagua.opacidade * 100)} disabled={ro || marcaDagua.posicao === "nenhuma"}
            onChange={(e) => setMarcaDagua((md) => ({ ...md, opacidade: Number(e.target.value) / 100 }))} className="w-full max-w-[320px] accent-texto-forte" />
        </label>
      </fieldset>
    ),
  };

  const cabeca = (
    <div className="grid gap-1">
      <h2 id="marca-titulo" className="m-0 text-[22px]">{tr(`A cara do ${veiculo.nome}`, `The look of ${veiculo.nome}`)}</h2>
      <p className="m-0 max-w-[52ch] text-apoio">{tr("É o que assina cada card: o @, o logo, as cores, a ilustração e o convite do fim. Vale para os próximos posts; os já feitos não mudam.", "It's what signs every card: the @, the logo, the colors, the illustration and the invite card. It applies to upcoming posts; posts already made don't change.")}</p>
    </div>
  );
  const barra = admin && (
    <div className="sticky bottom-[calc(66px+env(safe-area-inset-bottom))] z-10 -mx-5 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-fio bg-papel px-5 py-3 lg:bottom-[var(--pe)] lg:mx-0 lg:px-0 lg:pt-4 lg:pb-4">
      <button type="submit" className="btn-tinta" disabled={salvar.isPending}>{salvar.isPending ? tr("Salvando…", "Saving…") : tr("Salvar a marca", "Save the brand")}</button>
      {salvar.isSuccess && !salvar.isPending && !falta && !pendente && <p role="status" className="m-0 text-[15px] text-verde">{tr("Salvo.", "Saved.")}</p>}
      {pendente && !salvar.isPending && <p className="m-0 text-[15px] text-apoio">{tr(`Alterações não salvas em ${emLista(alteradas)}.`, `Unsaved changes in ${emLista(alteradas)}.`)}</p>}
      {falta && <p role="alert" className="faixa-erro m-0">{falta}</p>}
      {salvar.isError && !falta && <p role="alert" className="faixa-erro m-0">{mensagemSalvar(salvar.error)}</p>}
    </div>
  );

  if (mestre) {
    const rotulo = SECOES_MARCA.find((s) => s.id === secao)!.rotulo;
    return (
      <form onSubmit={enviar} aria-labelledby="marca-titulo"
        className="grid grid-cols-[220px_minmax(360px,480px)_minmax(300px,380px)] content-start justify-between gap-x-8 gap-y-6">
        <div className="col-span-full">{cabeca}</div>
        {/* A lista fica parada: escolher uma seção troca só o painel do meio. Seleção em papel-2 e negrito, sem azul (o
            azul de seção ativa já é da lateral). */}
        <ul aria-label={tr("Seções da marca", "Brand sections")} className="sticky top-[calc(var(--topo)+32px)] m-0 grid list-none gap-1 self-start p-0">
          {SECOES_MARCA.map((s) => {
            const atual = s.id === secao;
            return (
              <li key={s.id}>
                <button type="button" aria-current={atual ? "true" : undefined} aria-controls="painel-secao" onClick={() => abrir(s.id)}
                  className={`grid min-h-11 w-full grid-cols-[minmax(0,1fr)] gap-0.5 rounded-btn border-0 px-3 py-2.5 text-left font-[inherit] ${atual ? "cursor-default bg-papel-2" : "cursor-pointer bg-transparent hover:bg-papel-2/60"}`}>
                  <span className={`text-[16px] text-texto-forte ${atual ? "font-bold" : ""}`}>{s.rotulo}</span>
                  <span className="mono min-w-0 text-[13px] text-apoio [overflow-wrap:anywhere]">{resumo(s.id)}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-5">
          <section id="painel-secao" aria-labelledby="painel-titulo" className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-5 pb-2">
            <h3 id="painel-titulo" className="m-0 text-[17px] font-bold text-texto-forte">{rotulo}</h3>
            {campos[secao]()}
          </section>
          {secao !== "modelos" && secao !== "patrocinios" && barra}
        </div>
        <div className="sticky top-[calc(var(--topo)+32px)] self-start">{previa}</div>
      </form>
    );
  }

  // No celular, o modelo aberto leva a prévia na barra presa do Salvar.
  const previaAqui = (s: SecaoMarca) => !largo && secao === s && !(s === "modelos" && estiloPrevia) && previa;
  return (
    <form onSubmit={enviar} aria-labelledby="marca-titulo"
      className="grid grid-cols-[minmax(0,1fr)] content-start gap-6 lg:grid-cols-[minmax(0,520px)_minmax(0,380px)] lg:justify-between lg:gap-x-16">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-5">
        {/* Com um modelo aberto, a frase sai: sobe o formulário e a barra presa do Salvar cabe na primeira dobra. */}
        <div className={estiloPrevia ? "sr-only" : undefined}>{cabeca}</div>
        <div>
          {SECOES_MARCA.map((s) => (
            <Parte key={s.id} id={s.id} rotulo={s.rotulo} resumo={resumo(s.id)} aberta={secao === s.id} alternar={() => abrir(s.id)} fixa manter={false}>
              {campos[s.id]()}
              {previaAqui(s.id)}
            </Parte>
          ))}
        </div>
        {secao !== "modelos" && secao !== "patrocinios" && barra}
      </div>

      {largo && <div className="sticky top-[calc(var(--topo)+32px)] self-start">{previa}</div>}
    </form>
  );
}
