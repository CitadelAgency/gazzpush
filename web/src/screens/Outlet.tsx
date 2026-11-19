// The outlet screen: Brand · Accounts · Sources · Team, one tab at a time in the URL (?aba=). The title is the part's
// name (the same as the menu); the tabs only appear on mobile, because on desktop the sidebar's Outlet group already is
// that row. Only admins change things; editors and reporters see everything read-only with the sentence at the top.
// Forms in the "Create outlet" pattern (fields without outline, a rule underneath), paper cards like the sidebar, blue
// only on the action (one save button per tab).
import type { ParamsStyle } from "../../../src/lib/style";
import { SectionModels, summaryModels, useStyles } from "./Templates";
import { SectionSponsorships, summarySponsorships, useSponsorships } from "./Sponsorships";
import { lazy, Suspense, useDeferredValue, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fileBody, bodyJson, ApiError, read } from "../api";
import { useShell } from "../shell/context";
import { FailureLoad, useTitle } from "../common";
import { MASTER, Part, useMedia, usePart } from "../kit/Parts";
import { keys, useAccounts } from "../queue";
import { t as tr } from "../language";
import { FieldsBrand, PreviewBrand, SelectorSources, SelectorLanguagePosts, useCover, useStateBrand } from "../onboarding/BrandFields";
import { fromOutletLanguage, type ContentLanguage } from "../../../src/lib/contentLanguage";
import { CATALOG_SOURCES, DEFAULT_PAIR, isPairSources, type SourcesPair } from "../../../src/lib/typography";
import { contraste, DEFAULT_COLORS, type Colors } from "../onboarding/preview";
import { localOf, type Outlet as Veic } from "../session";
import { Load, t } from "./outlet/common";

// Accounts, Sources (with Coverage) and Team load only when opened: outside the Brand's JS budget.
const Accounts = lazy(() => import("./outlet/Accounts"));
const Sources = lazy(() => import("./outlet/Sources"));
const Team = lazy(() => import("./outlet/Team"));
const Kit = lazy(() => import("./outlet/Kit"));
const Plan = lazy(() => import("./outlet/Plan"));
const Keys = lazy(() => import("./outlet/AiKeys"));

export const TABS = [
  { id: "marca", get rotulo() { return tr("Marca", "Brand"); } },
  { id: "contas", get rotulo() { return tr("Contas", "Accounts"); } },
  { id: "fontes", get rotulo() { return tr("Fontes", "Sources"); } },
  { id: "equipe", get rotulo() { return tr("Equipe", "Team"); } },
  { id: "kit", get rotulo() { return tr("Se a conta cair", "If the account goes down"); } },
  { id: "plano", get rotulo() { return tr("Plano", "Plan"); } },
  { id: "chaves", get rotulo() { return tr("Chaves de IA", "AI keys"); } },
] as const;
export type Tab = (typeof TABS)[number]["id"];
/** `?aba=` → tab; unknown or missing opens Brand. */
export const tabOf = (v: string | null): Tab => (TABS.some((a) => a.id === v) ? (v as Tab) : "marca");

export const brandKey = (tenantId: string) => [tenantId, "marca"] as const;

export default function Outlet() {
  const { veiculo: outlet } = useShell();
  const [params] = useSearchParams();
  const tab = tabOf(params.get("aba"));
  const label = TABS.find((a) => a.id === tab)!.rotulo;
  useTitle(label, tr("Veículo", "Publication"), outlet.nome);
  const admin = outlet.papel === "admin";
  return (
    <div className="mx-auto max-w-[1180px] px-5 pt-6 pb-12 lg:px-12 lg:pt-3">
      <header className="grid gap-4">
        <h1 className="titulo-tela m-0 text-[32px] lg:text-[34px]">{label}</h1>
        <nav aria-label={tr("Partes do veículo", "Publication sections")} className="-mx-5 flex gap-1 overflow-x-auto px-5 lg:hidden">
          {TABS.map((a) => (
            <Link key={a.id} to={`?aba=${a.id}`} replace aria-current={a.id === tab ? "page" : undefined}
              className={`inline-flex min-h-11 flex-none items-center rounded-btn px-3.5 text-[15px] no-underline ${a.id === tab ? "bg-tinta-clara font-bold text-tinta" : "text-texto hover:bg-papel-2"}`}>
              {a.rotulo}
            </Link>
          ))}
        </nav>
        {!admin && <p role="note" className="m-0 w-fit rounded-faixa bg-papel-2 px-3 py-2 text-[15px] text-apoio">{tr("Só o admin altera. Você vê como está.", "Only the admin can change this. You see it as it is.")}</p>}
      </header>
      <div className="mt-5 lg:mt-6">
        {tab === "marca" && <Brand veiculo={outlet} admin={admin} />}
        <Suspense fallback={<Load oque={tr(`a aba ${label}`, `the ${label} tab`)} />}>
          {tab === "contas" && <Accounts veiculo={outlet} admin={admin} />}
          {tab === "fontes" && <Sources veiculo={outlet} admin={admin} />}
          {tab === "equipe" && <Team veiculo={outlet} admin={admin} />}
          {tab === "kit" && <Kit veiculo={outlet} admin={admin} />}
          {tab === "plano" && <Plan veiculo={outlet} admin={admin} />}
          {tab === "chaves" && <Keys veiculo={outlet} admin={admin} />}
        </Suspense>
      </div>
    </div>
  );
}

const saveMessage = (e: unknown) =>
  e instanceof ApiError && e.status !== 0
    ? tr(`Não salvou: ${e.message}.`, `Couldn't save: ${e.message}.`)
    : tr("Não salvou: sem conexão. Tente de novo.", "Couldn't save: no connection. Try again.");

// ── Brand ───────────────────────────────────────────────────────────────────────────────────────────────────────

type CtaText = { titulo: string; texto: string; legenda: string; acao: string };
/** An empty button = no button of its own (the render uses the title); the other three are required. */
const ctaToUpload = (c: CtaText) => (c.acao.trim() ? c : { titulo: c.titulo, texto: c.texto, legenda: c.legenda });
type WaterUiBrand = { posicao: "canto" | "rodape" | "nenhuma"; opacidade: number };
const REFERENCE_MAX = 2 * 1024 * 1024;
const STYLE_MAX = 300;
// Functions, not constants: the text comes out in the language at draw time.
const fieldsCta = (): [keyof CtaText, string, number, string][] => [
  ["titulo", tr("Título", "Title"), 80, tr("A frase grande do último card.", "The big line on the last card.")],
  ["texto", tr("Texto", "Text"), 200, tr("Uma frase de apoio embaixo do título.", "A supporting line below the title.")],
  ["legenda", tr("Fim da legenda", "Caption ending"), 300, tr("A linha que fecha a legenda no Instagram.", "The line that closes the caption on Instagram.")],
  ["acao", tr("Botão (opcional)", "Button (optional)"), 60, tr("O convite curto: \"Siga\", \"Manda no direct\". Vazio, vale o título.", "The short call to action: \"Follow\", \"Send us a DM\". Left empty, the title is used.")],
];
const positionsMd = (): [WaterUiBrand["posicao"], string, string][] => [
  ["canto", tr("Canto", "Corner"), tr("No alto, à direita, sobre a ilustração.", "Top right, over the illustration.")],
  ["rodape", tr("Rodapé", "Footer"), tr("Pequena, centrada embaixo.", "Small, centered at the bottom.")],
  ["nenhuma", tr("Nenhuma", "None"), tr("Os cards saem sem marca d'água.", "Cards go out without a watermark.")],
];

// The tab in four sections, one chosen at a time (it goes to the URL: ?secao=), with the preview of the card it
// changes. From 1280 px up (`xl`), master-detail: the fixed list of sections on the left, the chosen one's fields in
// the middle and the preview on the right (the destinations do not move when switching). Below that, an accordion: from
// 1024 to 1279 px with the preview on the right; on mobile, the preview right below the open section's fields. The whole
// state lives here: switching sections only shows and hides, nothing touched is lost; what differs from the saved one
// becomes "changed". A single "Save the brand".
export const SECTIONS_BRAND = [
  { id: "nome", get rotulo() { return tr("Nome e cores", "Name and colors"); } },
  { id: "ilustracao", get rotulo() { return tr("Ilustração", "Illustration"); } },
  { id: "convites", get rotulo() { return tr("Convite do fim", "Invite card"); } },
  { id: "marca-dagua", get rotulo() { return tr("Marca d'água", "Watermark"); } },
  { id: "modelos", get rotulo() { return tr("Modelos", "Templates"); } },
  { id: "patrocinios", get rotulo() { return tr("Patrocínios", "Sponsors"); } },
] as const;
export type SectionBrand = (typeof SECTIONS_BRAND)[number]["id"];
/** `?secao=` → section; unknown or missing opens the first. */
export const sectionOf = (v: string | null): SectionBrand => (SECTIONS_BRAND.some((s) => s.id === v) ? (v as SectionBrand) : "nome");

// `lg` (≥ 1024 px): the preview goes to the right column; `xl` (≥ 1280 px): master-detail. A single preview in the DOM.
const LG = "(min-width: 1024px)";

/** Text as the server stores it (spaces collapsed, trimmed): compare with the saved one without reporting a false difference. */
const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const ctaChanged = (a: CtaText, b: Partial<CtaText> | undefined) => fieldsCta().some(([k]) => clean(a[k]) !== clean(b?.[k]));
/** "A", "A e B", "A, B e C". */
const inList = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")}${tr(" e ", " and ")}${xs[xs.length - 1]}`);
const Changed = () => <span className="text-texto-forte">{tr("alterado", "changed")}</span>;

function Brand({ veiculo: outlet, admin }: { veiculo: Veic; admin: boolean }) {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const sectionId = sectionOf(params.get("secao"));
  const open = (s: SectionBrand) => setParams((p) => {
    p.set("aba", "marca"); p.set("secao", s);
    if (s !== "modelos") { p.delete("modelo"); p.delete("grupo"); p.delete("previa"); }
    return p;
  }, { replace: true });
  const wide = useMedia(LG);
  const master = useMedia(MASTER);
  const [letter, openLetter] = usePart("letra", null);
  // Only reloads when this screen says so (after saving): a background reload would erase what is being edited.
  const brand = useQuery({
    queryKey: brandKey(outlet.id),
    queryFn: () => read(t.marca.$get({ param: { tenantId: outlet.id } })),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const m = useStateBrand();
  // Author outlet: the author card's signature goes into Name and colours.
  const author = outlet.modo === "autoral";
  const [artStyle, setStyleArt] = useState("");
  const [ctas, setCtas] = useState<CtaText[]>([]);
  const [openInvite, openSetInvite] = useState(0);
  const [watermark, setBrandWater] = useState<WaterUiBrand>({ posicao: "nenhuma", opacidade: 0.4 });
  const [sources, setSources] = useState<SourcesPair>(DEFAULT_PAIR);
  const [postsLanguage, setLanguagePosts] = useState<ContentLanguage>("pt-BR");
  const savedLanguage = fromOutletLanguage(brand.data?.idioma);
  const [reference, setReference] = useState<{ arquivo: File; url: string } | null>(null);
  const [referenceError, setErrorReference] = useState<string | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  const data = brand.data?.marca;
  // One @, one account: saving the @ without an active account turns on the manual account with that @.
  const accounts = useAccounts(outlet.id);
  const withoutAccount = admin && accounts.isSuccess && accounts.data.contas.length === 0;
  // The form starts from what is saved: on first load and after saving (the data changes).
  useEffect(() => {
    if (!data) return;
    m.repor({ handle: data.handle ?? "", cores: { ...DEFAULT_COLORS, ...(data.cores as Partial<Colors>) }, assinatura: data.assinatura ?? "" });
    setStyleArt(data.estiloArte ?? "");
    setCtas(data.ctas);
    setBrandWater(data.marcaDagua as WaterUiBrand);
    setSources(isPairSources(data.fontes) ? data.fontes : DEFAULT_PAIR);
    setLanguagePosts(savedLanguage);
    setReference(null);
    setErrorReference(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // What differs from the saved one, per section (a new logo and reference count). Only for whoever can save.
  const savedColors = { ...DEFAULT_COLORS, ...(data?.cores as Partial<Colors> | undefined) };
  const ctasSaved = (data?.ctas ?? []) as Partial<CtaText>[];
  const savedMd = data?.marcaDagua as WaterUiBrand | undefined;
  const changedSections: Record<SectionBrand, boolean> = !admin || !data ? { nome: false, ilustracao: false, convites: false, "marca-dagua": false, modelos: false, patrocinios: false } : {
    modelos: false, patrocinios: false,
    nome: !!m.logo || m.handle.replace(/^@/, "") !== (data.handle ?? "").replace(/^@/, "")
      || (author && m.assinatura.trim() !== (data.assinatura ?? ""))
      || sources !== (isPairSources(data.fontes) ? data.fontes : DEFAULT_PAIR)
      || postsLanguage !== savedLanguage
      || (["fundo", "texto", "acento"] as const).some((k) => m.cores[k].toLowerCase() !== savedColors[k].toLowerCase()),
    ilustracao: !!reference || clean(artStyle) !== clean(data.estiloArte),
    convites: ctas.some((c, i) => ctaChanged(c, ctasSaved[i])),
    "marca-dagua": !!savedMd && (watermark.posicao !== savedMd.posicao || Math.round(watermark.opacidade * 100) !== Math.round(savedMd.opacidade * 100)),
  };
  const changed = SECTIONS_BRAND.filter((s) => changedSections[s.id]).map((s) => s.rotulo);
  // Reloading or closing with a pending change: the browser asks first.
  const pending = changed.length > 0;
  useEffect(() => {
    if (!pending) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, [pending]);

  // Preview: the cover (with the reference in place of the illustration, in the Illustration section) and, in the CTA
  // section, the last card, whose template only loads when that section opens (the screen's JS budget).
  const logoUrl = m.logo?.url ?? data?.logo ?? null;
  const refUrl = reference?.url ?? data?.referencia ?? null;
  const [previewStyle, setStylePreview] = useState<ParamsStyle | null>(null);
  const stylesOutlet = useStyles(outlet.id);
  const sponsorshipsOutlet = useSponsorships(outlet.id);
  const cover = useCover(outlet, m, { estilo: sectionId === "modelos" ? previewStyle : null, logoAtual: data?.logo ?? null, marcaDagua: watermark, arte: sectionId === "ilustracao" ? refUrl : null, dominio: data?.dominio ?? null, fontes: sources, idioma: postsLanguage });
  const [modInvite, setModInvite] = useState<typeof import("../onboarding/ctaPreview") | null>(null);
  useEffect(() => {
    if (sectionId === "convites" && !modInvite) import("../onboarding/ctaPreview").then(setModInvite, () => {});
  }, [sectionId, modInvite]);
  const invite = useDeferredValue(ctas[openInvite] ?? null);
  const colors = useDeferredValue(m.cores);
  const handle = m.handle ? `@${m.handle.replace(/^@/, "")}` : "";
  const htmlInvite = useMemo(() => (modInvite && invite
    ? modInvite.htmlPreviewInvite({ nome: outlet.nome, handle, cores: colors, logo: logoUrl, convite: invite, fontes: sources, idioma: postsLanguage }) : ""), [modInvite, invite, colors, handle, logoUrl, outlet.nome, sources, postsLanguage]);

  function chooseReference(file: File | undefined) {
    setErrorReference(null);
    if (!file) return;
    if (file.type !== "image/png" && file.type !== "image/jpeg") { setErrorReference(tr("A referência precisa ser PNG ou JPEG.", "The reference must be a PNG or JPEG.")); return; }
    if (file.size > REFERENCE_MAX) { setErrorReference(tr("A referência pode ter até 2 MB.", "The reference can be up to 2 MB.")); return; }
    setReference({ arquivo: file, url: URL.createObjectURL(file) });
  }

  const save = useMutation({
    mutationFn: async () => {
      const param = { tenantId: outlet.id };
      await read(t.marca.$patch({ param }, bodyJson({
        handle: m.handle, cores: m.cores, estiloArte: artStyle, marcaDagua: watermark, fontes: sources, idioma: postsLanguage, ...(author ? { assinatura: m.assinatura } : {}), ...(ctas.length ? { ctas: ctas.map(ctaToUpload) } : {}),
      })));
      if (m.logo) await read(t.marca.logo.$post({ param }, fileBody(m.logo.arquivo)));
      if (reference) await read(t.marca.referencia.$post({ param }, fileBody(reference.arquivo)));
      // Reads the accounts here (the screen's query may be pending or have failed): with an @ and none active, turns on the manual one.
      const h = m.handle.trim().replace(/^@/, "");
      if (h && admin) {
        const active = (await read(t.contas.$get({ param, query: { todas: undefined } }))).contas;
        if (!active.length) await read(t.contas.$post({ param }, bodyJson({ nome: `@${h}`, modo: "manual" })));
      }
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: brandKey(outlet.id) }), qc.invalidateQueries({ queryKey: ["me"] }), qc.invalidateQueries({ queryKey: keys.contas(outlet.id) }),
      ]);
    },
  });

  if (brand.isPending) return <Load oque={tr("a marca", "the brand")} />;
  if (brand.isError) return <FailureLoad oque={tr("a marca", "the brand")} tentar={() => brand.refetch()} />;
  // Required fields of a closed CTA do not go through browser validation (they are not on screen): check here and open
  // the missing CTA, instead of sending and coming back with a server error.
  function send(e: FormEvent) {
    e.preventDefault();
    const i = ctas.findIndex((c) => !c.titulo.trim() || !c.texto.trim() || !c.legenda.trim());
    if (i >= 0) {
      open("convites");
      openSetInvite(i);
      setMissing(tr(`Convite ${i + 1}: preencha Título, Texto e Fim da legenda.`, `Invite ${i + 1}: fill in Title, Text and Caption ending.`));
      return;
    }
    setMissing(null);
    save.mutate();
  }
  const ro = !admin;
  const changeCta = (i: number, k: keyof CtaText, v: string) => setCtas((cs) => cs.map((c, j) => (j === i ? { ...c, [k]: v } : c)));
  const withoutReference = data ? !data.temReferencia && !reference : false;
  const local = localOf(outlet) || "card";
  const contrastLow = contraste(m.cores.texto, m.cores.fundo) < 4.5;

  // Each section's summary (on the accordion's closed row and on the list item): "changed" first, so the `truncate` cut
  // never takes that word; warnings in amber.
  const summaries: Record<SectionBrand, ReactNode> = {
    modelos: summaryModels(stylesOutlet.data?.estilos.length),
    patrocinios: summarySponsorships(sponsorshipsOutlet.data?.patrocinios.length),
    nome: (
      <>
        <span aria-hidden="true" className="mr-2 inline-flex gap-1 align-[-1px]">
          {(["fundo", "texto", "acento"] as const).map((k) => <i key={k} className="inline-block size-3 rounded-full ring-1 ring-fio-forte" style={{ background: m.cores[k] }} />)}
        </span>
        {[handle || tr("sem @", "no @"), logoUrl ? tr("logo", "logo") : tr("sem logo", "no logo"), tr("3 cores", "3 colors"), tr(CATALOG_SOURCES[sources].nome, CATALOG_SOURCES[sources].nomeEn), postsLanguage === "en" ? tr("posts em inglês", "posts in English") : tr("posts em português", "posts in Portuguese")].join(" · ")}
        {contrastLow && <>{" · "}<span className="text-ambar">{tr("contraste baixo", "low contrast")}</span></>}
      </>
    ),
    ilustracao: (
      <>
        {artStyle.trim() ? `“${artStyle.trim()}”` : tr("sem estilo definido", "no style set")}{" · "}
        {withoutReference ? <span className="text-ambar">{tr("sem imagem de referência", "no reference image")}</span> : tr("com imagem", "with image")}
      </>
    ),
    convites: ctas.length
      ? tr(`${ctas.length} ${ctas.length === 1 ? "convite" : "convites"}`, `${ctas.length} ${ctas.length === 1 ? "invite" : "invites"}`)
      : tr("sem convite", "no invite"),
    "marca-dagua": watermark.posicao === "nenhuma" ? tr("nenhuma", "none")
      : `${watermark.posicao === "canto" ? tr("canto", "corner") : tr("rodapé", "footer")} ·${Math.round(watermark.opacidade * 100)} %`,
  };
  const summary = (s: SectionBrand) => (changedSections[s] ? <><Changed />{" · "}{summaries[s]}</> : summaries[s]);

  const openCta = ctas[openInvite];
  const preview = sectionId === "convites" && openCta ? (
    <PreviewBrand html={htmlInvite} legenda={tr(`Convite ${openInvite + 1} · último card · conversa de exemplo`, `Invite ${openInvite + 1} · last card · sample conversation`)}>
      <p className="ajuda m-0 max-w-[46ch]">{tr("Fim da legenda: ", "Caption ending: ")}{openCta.legenda || tr("vazio", "empty")}</p>
    </PreviewBrand>
  ) : sectionId === "convites" ? (
    <PreviewBrand html={cover} legenda={tr(`Sem convite · prévia da capa · ${local}`, `No invite · cover preview · ${local}`)} />
  ) : sectionId === "ilustracao" ? (
    <PreviewBrand html={cover} legenda={refUrl
      ? tr("Referência no lugar da ilustração · ela orienta o estilo, não sai no post", "Reference in place of the illustration · it guides the style and isn't posted")
      : tr("Sem ilustração: fundo liso da marca", "No illustration: plain brand background")}>
      <p className="ajuda m-0 max-w-[46ch]">{artStyle.trim() ? tr(`Estilo: “${artStyle.trim()}”`, `Style: “${artStyle.trim()}”`) : tr("Sem estilo definido: o estilo sai das cores.", "No style set: the style comes from the colors.")}</p>
    </PreviewBrand>
  ) : sectionId === "modelos" ? (
    <PreviewBrand html={cover} legenda={previewStyle ? tr("Prévia do modelo aberto", "Preview of the open template") : tr("Abra um modelo para ver a prévia dele", "Open a template to preview it")} />
  ) : (
    <PreviewBrand html={cover} legenda={tr(`Prévia de exemplo · ${local}`, `Sample preview · ${local}`)} />
  );

  // Each section's fields, the same in the accordion and in the master-detail panel.
  const fields: Record<SectionBrand, () => ReactNode> = {
    modelos: () => <SectionModels tenantId={outlet.id} admin={admin} mudouPrevia={setStylePreview} previaCelular={wide ? null : cover} />,
    patrocinios: () => <SectionSponsorships tenantId={outlet.id} admin={admin} />,
    nome: () => (
      <>
        <FieldsBrand m={m} logoAtual={data?.logo ?? null} somenteLeitura={ro} semConta={withoutAccount} autoral={author} />
        <Part id="letra" nivel="h4" rotulo={tr("Letra e idioma", "Type and language")} aberta={letter === "aberta"} alternar={() => openLetter(letter === "aberta" ? null : "aberta")}
          resumo={`${tr(CATALOG_SOURCES[sources].nome, CATALOG_SOURCES[sources].nomeEn)} · ${postsLanguage === "en" ? "English" : "Português"}`}>
          <SelectorSources valor={sources} mudar={setSources} somenteLeitura={ro} />
          <SelectorLanguagePosts valor={postsLanguage} mudar={setLanguagePosts} somenteLeitura={ro} />
        </Part>
      </>
    ),
    ilustracao: () => (
      <>
        {withoutReference && <p role="note" className="faixa-aviso m-0">{tr("Sem imagem de referência: as ilustrações saem no estilo padrão.", "No reference image: illustrations use the default style.")}</p>}
        <fieldset disabled={ro} className="m-0 grid min-w-0 gap-5 border-0 p-0">
          <legend className="sr-only">{tr("Estilo da ilustração", "Illustration style")}</legend>
          <label className="campo">
            <span>{tr("Estilo em uma frase", "Style in one sentence")}</span>
            <textarea className="entrada min-h-[96px] resize-y py-2" value={artStyle} maxLength={STYLE_MAX} rows={3} autoCapitalize="sentences" enterKeyHint="enter"
              onChange={(e) => setStyleArt(e.target.value)} aria-describedby="estilo-ajuda" />
            <span id="estilo-ajuda" className="ajuda">
              {tr("Ex.: “tons de areia e azul do mar, traço solto”. Vazio, o estilo sai das cores.", "E.g. “sand and sea-blue tones, loose strokes”. Left empty, the style comes from the colors.")} {artStyle.length}/{STYLE_MAX}
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
                    onChange={(e) => chooseReference(e.target.files?.[0])} />
                </label>
              )}
              {reference && <button type="button" className="btn-sec" onClick={() => setReference(null)}>{tr("Tirar", "Remove")}</button>}
            </div>
            <p id="ref-ajuda" className={`m-0 ${referenceError ? "text-[15px] text-terracota" : "ajuda"}`} role={referenceError ? "alert" : undefined}>
              {referenceError ?? (reference ? reference.arquivo.name
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
          {ctas.map((c, i) => (i === openInvite ? (
            <fieldset key={i} disabled={ro} className="m-0 grid min-w-0 gap-3 rounded-btn bg-papel p-4 shadow-curta">
              <legend className="float-left mb-1 w-full p-0 text-[15px] font-bold text-texto-forte">{tr(`Convite ${i + 1}`, `Invite ${i + 1}`)}</legend>
              {fieldsCta().map(([k, caption, max, help]) => (
                <label key={k} className="campo">
                  <span>{caption}</span>
                  <input className="entrada" value={c[k] ?? ""} maxLength={max} required={k !== "acao"} autoCapitalize="sentences" enterKeyHint="next" onChange={(e) => changeCta(i, k, e.target.value)}
                    aria-describedby={`cta-${i}-${k}`} />
                  <span id={`cta-${i}-${k}`} className="ajuda">{help}</span>
                </label>
              ))}
            </fieldset>
          ) : (
            <button key={i} type="button" aria-expanded={false} onClick={() => openSetInvite(i)}
              className="flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-btn border-0 bg-papel px-4 py-2 text-left font-[inherit] shadow-curta hover:bg-papel-2/60">
              <b className="flex-none text-[15px] text-texto-forte">{tr(`Convite ${i + 1}`, `Invite ${i + 1}`)}</b>
              <span className="min-w-0 truncate text-[15px] text-apoio">
                {admin && ctaChanged(c, ctasSaved[i]) && <><Changed />{" · "}</>}{c.titulo || tr("sem título", "no title")}
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
          {positionsMd().map(([v, caption, help]) => (
            <label key={v} className={`flex items-start gap-3 rounded-btn px-3 py-2 ${ro ? "" : "cursor-pointer"} ${watermark.posicao === v ? "bg-papel-2" : "hover:bg-papel-2/60"}`}>
              <input type="radio" name="marca-dagua" value={v} checked={watermark.posicao === v} onChange={() => setBrandWater((md) => ({ ...md, posicao: v }))}
                className="mt-1 size-[18px] accent-texto-forte" />
              <span className="grid"><b className="text-texto-forte">{caption}</b><span className="ajuda">{help}</span></span>
            </label>
          ))}
        </div>
        <label className="grid gap-1.5">
          <span className="flex items-baseline justify-between text-[15px] font-bold text-texto-forte">
            {tr("Visibilidade", "Visibility")} <span className="mono font-normal text-apoio">{Math.round(watermark.opacidade * 100)}%</span>
          </span>
          <input type="range" min={20} max={80} step={5} value={Math.round(watermark.opacidade * 100)} disabled={ro || watermark.posicao === "nenhuma"}
            onChange={(e) => setBrandWater((md) => ({ ...md, opacidade: Number(e.target.value) / 100 }))} className="w-full max-w-[320px] accent-texto-forte" />
        </label>
      </fieldset>
    ),
  };

  const head = (
    <div className="grid gap-1">
      <h2 id="marca-titulo" className="m-0 text-[22px]">{tr(`A cara do ${outlet.nome}`, `The look of ${outlet.nome}`)}</h2>
      <p className="m-0 max-w-[52ch] text-apoio">{tr("É o que assina cada card: o @, o logo, as cores, a ilustração e o convite do fim. Vale para os próximos posts; os já feitos não mudam.", "It's what signs every card: the @, the logo, the colors, the illustration and the invite card. It applies to upcoming posts; posts already made don't change.")}</p>
    </div>
  );
  const bar = admin && (
    <div className="sticky bottom-[calc(66px+env(safe-area-inset-bottom))] z-10 -mx-5 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-fio bg-papel px-5 py-3 lg:bottom-[var(--pe)] lg:mx-0 lg:px-0 lg:pt-4 lg:pb-4">
      <button type="submit" className="btn-tinta" disabled={save.isPending}>{save.isPending ? tr("Salvando…", "Saving…") : tr("Salvar a marca", "Save the brand")}</button>
      {save.isSuccess && !save.isPending && !missing && !pending && <p role="status" className="m-0 text-[15px] text-verde">{tr("Salvo.", "Saved.")}</p>}
      {pending && !save.isPending && <p className="m-0 text-[15px] text-apoio">{tr(`Alterações não salvas em ${inList(changed)}.`, `Unsaved changes in ${inList(changed)}.`)}</p>}
      {missing && <p role="alert" className="faixa-erro m-0">{missing}</p>}
      {save.isError && !missing && <p role="alert" className="faixa-erro m-0">{saveMessage(save.error)}</p>}
    </div>
  );

  if (master) {
    const label = SECTIONS_BRAND.find((s) => s.id === sectionId)!.rotulo;
    return (
      <form onSubmit={send} aria-labelledby="marca-titulo"
        className="grid grid-cols-[220px_minmax(360px,480px)_minmax(300px,380px)] content-start justify-between gap-x-8 gap-y-6">
        <div className="col-span-full">{head}</div>
        {/* The list stays still: choosing a section only swaps the middle panel. Selection in papel-2 and bold, no blue (the
            active-section blue already belongs to the sidebar). */}
        <ul aria-label={tr("Seções da marca", "Brand sections")} className="sticky top-[calc(var(--topo)+32px)] m-0 grid list-none gap-1 self-start p-0">
          {SECTIONS_BRAND.map((s) => {
            const current = s.id === sectionId;
            return (
              <li key={s.id}>
                <button type="button" aria-current={current ? "true" : undefined} aria-controls="painel-secao" onClick={() => open(s.id)}
                  className={`grid min-h-11 w-full grid-cols-[minmax(0,1fr)] gap-0.5 rounded-btn border-0 px-3 py-2.5 text-left font-[inherit] ${current ? "cursor-default bg-papel-2" : "cursor-pointer bg-transparent hover:bg-papel-2/60"}`}>
                  <span className={`text-[16px] text-texto-forte ${current ? "font-bold" : ""}`}>{s.rotulo}</span>
                  <span className="mono min-w-0 text-[13px] text-apoio [overflow-wrap:anywhere]">{summary(s.id)}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-5">
          <section id="painel-secao" aria-labelledby="painel-titulo" className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-5 pb-2">
            <h3 id="painel-titulo" className="m-0 text-[17px] font-bold text-texto-forte">{label}</h3>
            {fields[sectionId]()}
          </section>
          {sectionId !== "modelos" && sectionId !== "patrocinios" && bar}
        </div>
        <div className="sticky top-[calc(var(--topo)+32px)] self-start">{preview}</div>
      </form>
    );
  }

  // On mobile, the open template carries the preview in Save's pinned bar.
  const previewHere = (s: SectionBrand) => !wide && sectionId === s && !(s === "modelos" && previewStyle) && preview;
  return (
    <form onSubmit={send} aria-labelledby="marca-titulo"
      className="grid grid-cols-[minmax(0,1fr)] content-start gap-6 lg:grid-cols-[minmax(0,520px)_minmax(0,380px)] lg:justify-between lg:gap-x-16">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-5">
        {/* With a template open, the sentence goes away: the form moves up and Save's pinned bar fits above the fold. */}
        <div className={previewStyle ? "sr-only" : undefined}>{head}</div>
        <div>
          {SECTIONS_BRAND.map((s) => (
            <Part key={s.id} id={s.id} rotulo={s.rotulo} resumo={summary(s.id)} aberta={sectionId === s.id} alternar={() => open(s.id)} fixa manter={false}>
              {fields[s.id]()}
              {previewHere(s.id)}
            </Part>
          ))}
        </div>
        {sectionId !== "modelos" && sectionId !== "patrocinios" && bar}
      </div>

      {wide && <div className="sticky top-[calc(var(--topo)+32px)] self-start">{preview}</div>}
    </form>
  );
}
