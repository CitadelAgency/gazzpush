// Create an outlet in two steps: (1) name, coverage and municipality → POST /api/tenants; (2) the minimal brand (@, logo
// and 3 colours) with the card preview → PATCH /marca and POST /marca/logo. Step 2 lives in the URL (?marca=<slug>):
// reloading does not lose the outlet already created. The brand is optional: "Skip for now" leads to Ideas with the
// name and the neutral palette.
// Author: in step 1 the Substack URL (the server reads the feed and the page and puts the 3 most recent texts into
// production); in step 2 the brand comes prefilled with what Substack gave, plus the author card's signature.
// Local and topical: in step 2, pasting the site fills name, logo, colours and fonts, and the person checks before saving.
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fileBody, bodyJson, ApiError, read } from "../api";
import { Opening, FailureLoad, useTitle } from "../common";
import { language, t } from "../language";
import GazzpushBrand from "../kit/GazzpushMark";
import { FieldsBrand, PreviewBrand, SelectorSources, SelectorLanguagePosts, useCover, useStateBrand } from "../onboarding/BrandFields";
import type { FromSiteBrand as Sugestao } from "../../../src/lib/brandImport";
import type { SourcesPair } from "../../../src/lib/typography";
import { fromOutletLanguage, type ContentLanguage } from "../../../src/lib/contentLanguage";
import { DEFAULT_COLORS } from "../onboarding/preview";
import { MunicipalityInput } from "../onboarding/MunicipalityField";
import type { Municipality } from "../onboarding/municipalities";
import { localOf, useMe, type Outlet } from "../session";
import vazio1x from "../assets/empty-outlet.webp";
import vazio2x from "../assets/empty-outlet@2x.webp";

export default function NewOutlet() {
  const me = useMe();
  const [params] = useSearchParams();
  const slugBrand = params.get("marca");

  if (me.isPending) return <Opening />;
  if (me.isError) {
    return <main className="mx-auto max-w-[560px] px-5 pt-16"><FailureLoad oque={t("a sua conta", "your account")} tentar={() => me.refetch()} /></main>;
  }
  if (!me.data) return <Navigate to={`/entrar?de=${encodeURIComponent("/novo")}`} replace />;

  const outlets = me.data.tenants;
  const toBrand = slugBrand ? outlets.find((v) => v.slug === slugBrand) : undefined;
  if (slugBrand && (!toBrand || toBrand.papel !== "admin")) return <Navigate to={toBrand ? `/t/${toBrand.slug}` : "/novo"} replace />;

  return (
    <main id="conteudo" className="mx-auto max-w-[1180px] px-5 pt-5 pb-14 lg:px-12 lg:pt-8">
      <header className="mb-6 flex min-h-10 items-center justify-between gap-4 lg:mb-10">
        <GazzpushBrand />
        {!toBrand && outlets.length > 0 && <Link to="/" className="link-acao inline-flex min-h-11 items-center text-[15px]">{t("Voltar", "Back")}</Link>}
      </header>
      {toBrand ? <BrandStep veiculo={toBrand} /> : <OutletStep primeiro={outlets.length === 0} />}
    </main>
  );
}

function creationError(e: unknown) {
  if (e instanceof ApiError) {
    if (e.codigo === "substack_invalido" || e.codigo === "substack_sem_feed") return e.message;
    if (e.status === 409) return t("Já existe um veículo com esse nome. Mude o nome um pouco (por exemplo, com a cidade).", "A publication with this name already exists. Change the name a little (for example, add the city).");
    if (e.status === 400 && e.message.startsWith("slug")) return t("Use um nome com pelo menos 3 letras ou números.", "Use a name with at least 3 letters or numbers.");
    if (e.status === 0) return t("Sem conexão. Confira a internet e tente de novo.", "No connection. Check your internet and try again.");
    if (e.status === 400) return e.message;
  }
  return t("Não deu para criar o veículo agora. Tente de novo.", "Couldn't create the publication right now. Try again.");
}

function OutletStep({ primeiro: first }: { primeiro: boolean }) {
  useTitle(first ? t("Crie o seu veículo", "Create your publication") : t("Novo veículo", "New publication"));
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"local" | "tematico" | "autoral">("local");
  const [municipality, setMunicipality] = useState<Municipality | null>(null);
  const [missingMunicipality, setMissingMunicipality] = useState(false);
  const [substack, setSubstack] = useState("");
  // Post language: starts in the creator's screen language.
  const [postsLanguage, setLanguagePosts] = useState<ContentLanguage>(language());
  const [missingSubstack, setMissingSubstack] = useState(false);
  const substackField = useRef<HTMLInputElement>(null);

  const create = useMutation({
    mutationFn: (name: string) => read(api.tenants.$post({}, bodyJson({
      // Portuguese is the server's default: only send the language when it is another.
      ...(postsLanguage !== "pt-BR" ? { idioma: postsLanguage } : {}),
      ...(mode === "local" && municipality
        ? { nome: name, modo: mode, uf: municipality.uf, municipioIbge: municipality.ibge, municipioNome: municipality.nome }
        : mode === "autoral" ? { nome: name, modo: mode, substack: substack.trim() } : { nome: name, modo: mode }),
    }))),
    onSuccess: async (t) => {
      await qc.invalidateQueries({ queryKey: ["me"] });
      navigate(`/novo?marca=${encodeURIComponent(t.slug)}`, { replace: true });
    },
    // The Substack error belongs to the field: focus goes to it, what was typed stays.
    onError: (e) => { if (e instanceof ApiError && e.codigo?.startsWith("substack_")) substackField.current?.focus(); },
  });
  const substackError = create.error instanceof ApiError && create.error.codigo?.startsWith("substack_") ? create.error.message : null;

  function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (mode === "local" && !municipality) { setMissingMunicipality(true); return; }
    if (mode === "autoral" && !substack.trim()) { setMissingSubstack(true); substackField.current?.focus(); return; }
    create.mutate(String(new FormData(e.currentTarget).get("nome") ?? "").trim());
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,520px)_1fr] lg:gap-20">
      {first && (
        <img src={vazio1x} srcSet={`${vazio1x} 1x, ${vazio2x} 2x`} width={419} height={254} alt=""
          className="h-auto w-[180px] sm:w-[400px] lg:order-2 lg:mt-24 lg:justify-self-center" />
      )}
      <form onSubmit={send} className="grid content-start gap-5 lg:order-1">
        <div className="grid gap-2">
          <p className="mono m-0 text-apoio">{t("Passo 1 de 2 · veículo", "Step 1 of 2 · publication")}</p>
          <h1 className="titulo-tela m-0 text-[32px] lg:text-[48px]">{first ? t("Crie o seu veículo", "Create your publication") : t("Novo veículo", "New publication")}</h1>
          <p className="m-0 max-w-[46ch] text-[17px]">
            {first
              ? t("O veículo é a página ou o portal que vai publicar. Dá para criar outros depois.", "The publication is the page or news site that will post. You can create others later.")
              : t("Cada veículo tem as suas ideias, a sua marca e as suas contas.", "Each publication has its own ideas, brand and accounts.")}
          </p>
          {/* A welcome without an extra screen: the map to the first post, only the first time. */}
          {first && <p className="mono m-0 text-apoio">{t("Até o primeiro post: o veículo e a cidade · a marca e o @ · a primeira ideia", "Before your first post: the publication and the city · the brand and the @ · the first idea")}</p>}
        </div>

        <label className="campo">
          <span>{t("Nome do veículo", "Publication name")}</span>
          <input name="nome" className="entrada" required={mode !== "autoral"} minLength={2} maxLength={80} autoComplete="organization" autoCapitalize="words" enterKeyHint="next"
            placeholder={mode === "autoral" ? t("Ex.: Cartas da Orla", "E.g. Shoreline Letters") : t("Ex.: Gazeta da Orla", "E.g. Shoreline Gazette")} aria-describedby={mode === "autoral" ? "nome-ajuda" : undefined} />
          {mode === "autoral" && <span id="nome-ajuda" className="ajuda">{t("Em branco, vale o nome da sua publicação no Substack.", "Leave it blank to use your Substack publication's name.")}</span>}
        </label>

        <fieldset className="m-0 grid gap-2 border-0 p-0">
          <legend className="mb-2 p-0 text-[15px] font-bold text-texto-forte">{t("O que ele cobre", "What it covers")}</legend>
          {([
            ["local", t("Uma cidade", "A city"), t("Notícia de um município: trânsito, serviço, polícia, obra.", "News from one city: traffic, public services, police, construction.")],
            ["tematico", t("Um tema", "A topic"), t("Entretenimento, tecnologia, esporte: sem filtro de lugar.", "Entertainment, technology, sports: no location filter.")],
            ["autoral", t("Autor", "Author"), t("Os seus textos do Substack e do Google Docs, no Instagram na sua voz.", "Your writing from Substack and Google Docs, on Instagram in your voice.")],
          ] as const).map(([value, caption, help]) => (
            <label key={value} className={`flex cursor-pointer items-start gap-3 rounded-btn px-3 py-3 ${mode === value ? "bg-papel-2" : "hover:bg-papel-2/60"}`}>
              <input type="radio" name="modo" value={value} checked={mode === value} onChange={() => setMode(value)} className="mt-1 size-[18px] accent-texto-forte" />
              <span className="grid">
                <b className="text-texto-forte">{caption}</b>
                <span className="ajuda">{help}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <SelectorLanguagePosts valor={postsLanguage} mudar={setLanguagePosts} />

        {mode === "local" && (
          <MunicipalityInput
            valor={municipality}
            onMudar={(m) => { setMunicipality(m); setMissingMunicipality(false); }}
            erro={missingMunicipality ? t("Escolha o município na lista.", "Choose the city from the list.") : undefined}
          />
        )}

        {mode === "autoral" && (
          <label className="campo">
            <span>{t("Endereço do seu Substack", "Your Substack address")}</span>
            <input ref={substackField} type="text" inputMode="url" className="entrada" value={substack} placeholder={t("https://seunome.substack.com", "https://yourname.substack.com")}
              autoComplete="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="go"
              onChange={(e) => { setSubstack(e.target.value); setMissingSubstack(false); if (substackError) create.reset(); }}
              aria-invalid={missingSubstack || !!substackError} aria-describedby="substack-ajuda" />
            {missingSubstack || substackError ? (
              <span id="substack-ajuda" role="alert" className="text-[15px] text-terracota">{substackError ?? t("Cole o endereço do seu Substack.", "Paste your Substack address.")}</span>
            ) : (
              <span id="substack-ajuda" className="ajuda">{t("Lemos os textos publicados, o nome, o logo e a cor. Os 3 mais recentes já viram posts.", "We read your published pieces, name, logo and color. The 3 most recent become posts right away.")}</span>
            )}
          </label>
        )}

        {create.isError && !substackError && <p role="alert" className="faixa-erro m-0">{creationError(create.error)}</p>}
        {/* Pinned to the bottom: the action stays in view with the whole option list above it. */}
        <div className="sticky bottom-0 z-10 -mx-5 border-t border-fio bg-papel px-5 py-3 lg:mx-0 lg:px-0">
          <button type="submit" className="btn-tinta" disabled={create.isPending}>
            {create.isPending ? (mode === "autoral" ? t("Lendo o seu Substack…", "Reading your Substack…") : t("Criando…", "Creating…")) : t("Continuar", "Continue")}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Pasting the site fills the step's fields: nothing is saved here, the person checks and saves. */
function ImportSite({ veiculo: outlet, aplicar: apply }: { veiculo: Outlet; aplicar: (r: Sugestao) => void }) {
  const [site, setSite] = useState("");
  const importValue = useMutation({
    mutationFn: () => read(api.t[":tenantId"].marca.puxar.$post({ param: { tenantId: outlet.id } }, bodyJson({ url: site }))),
    onSuccess: apply,
  });
  const go = () => { if (site.trim() && !importValue.isPending) importValue.mutate(); };
  return (
    <div className="grid gap-2">
      <label className="campo">
        <span>{t("Já tem site? Cole o endereço", "Already have a site? Paste the address")}</span>
        <input type="text" inputMode="url" className="entrada" value={site} placeholder={t("gazetadaorla.com.br", "shorelinegazette.com")} autoComplete="url" autoCapitalize="none" autoCorrect="off" spellCheck={false}
          onChange={(e) => setSite(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); go(); } }} aria-describedby="site-ajuda" />
        <span id="site-ajuda" className="ajuda">{t("Lemos o nome, o logo, as cores e o tipo de letra. Foto de matéria não entra.", "We read the name, logo, colors and type of lettering. Article photos stay out.")}</span>
      </label>
      <button type="button" className="btn-sec justify-self-start" onClick={go} disabled={importValue.isPending || !site.trim()}>{importValue.isPending ? t("Lendo o site…", "Reading the site…") : t("Preencher com o site", "Fill in from the site")}</button>
      {importValue.isError && <p role="alert" className="faixa-erro m-0">{importValue.error instanceof ApiError && importValue.error.status !== 0 ? importValue.error.message : t("Sem conexão. Confira a internet e tente de novo.", "No connection. Check your internet and try again.")}</p>}
      {importValue.isSuccess && (
        <p role="status" className="m-0 text-[15px] text-texto-forte">
          {importValue.data.logo ? t("Pronto. Confira tudo abaixo antes de salvar.", "Done. Check everything below before saving.") : t("Pronto, menos o logo: não achamos um PNG ou SVG. Confira tudo abaixo e escolha o arquivo.", "Done, except the logo: we didn't find a PNG or SVG. Check everything below and choose the file.")}
        </p>
      )}
    </div>
  );
}

function fromLogoFile(l: NonNullable<Sugestao["logo"]>) {
  const bytes = Uint8Array.from(atob(l.base64), (c) => c.charCodeAt(0));
  return { arquivo: new File([bytes], l.tipo === "image/png" ? "logo.png" : "logo.svg", { type: l.tipo }), url: `data:${l.tipo};base64,${l.base64}` };
}

function BrandStep({ veiculo: outlet }: { veiculo: Outlet }) {
  useTitle(t("Marca", "Brand"), outlet.nome);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const m = useStateBrand();
  const author = outlet.modo === "autoral";
  // Author: the brand already came from Substack (name, logo, color, signature); the step shows them and lets them change.
  const brand = useQuery({
    queryKey: [outlet.id, "marca"], enabled: author, staleTime: Infinity,
    queryFn: () => read(api.t[":tenantId"].marca.$get({ param: { tenantId: outlet.id } })),
  });
  const data = brand.data?.marca;
  const { repor: restore } = m;
  // Once, when the brand arrives (infinite staleTime: a background reload does not erase what the person changed).
  useEffect(() => {
    if (data) restore({ handle: data.handle ?? "", cores: { ...DEFAULT_COLORS, ...data.cores }, assinatura: data.assinatura ?? "" });
  }, [data]);
  // Only after pasting the site: name and fonts are not fields of this step without it.
  const [fromSite, setSite] = useState<{ nome: string; fontes: SourcesPair } | null>(null);
  const preview = useMemo(() => (fromSite?.nome ? { ...outlet, nome: fromSite.nome } : outlet), [outlet, fromSite?.nome]);
  const cover = useCover(preview, m, { logoAtual: data?.logo ?? null, dominio: data?.dominio ?? null, idioma: fromOutletLanguage(outlet.idioma), fontes: fromSite?.fontes });
  function apply(r: Sugestao) {
    m.setCores({ ...m.cores, ...r.cores });
    if (r.logo) m.setLogo(fromLogoFile(r.logo));
    setSite({ nome: r.nome ?? outlet.nome, fontes: r.fontes });
  }
  const ideas = `/t/${outlet.slug}`;
  // One @, one account: saving the @ without an active account turns on the manual account with that @ (Approve is not
  // off on the 1st post). An inline query, with the same key as `chaves.contas` (web/src/queue.ts): importing the queue
  // would bring the whole chunk to a screen that already loads the IBGE list.
  const accountsKey = [outlet.id, "contas"] as const;
  const accounts = useQuery({ queryKey: accountsKey, queryFn: () => read(api.t[":tenantId"].contas.$get({ param: { tenantId: outlet.id }, query: { todas: undefined } })) });
  const withoutAccount = accounts.isSuccess && accounts.data.contas.length === 0;

  const save = useMutation({
    mutationFn: async () => {
      const param = { tenantId: outlet.id };
      await read(api.t[":tenantId"].marca.$patch({ param }, bodyJson(author ? { handle: m.handle, cores: m.cores, assinatura: m.assinatura } : { handle: m.handle, cores: m.cores, ...(fromSite ?? {}) })));
      if (m.logo) await read(api.t[":tenantId"].marca.logo.$post({ param }, fileBody(m.logo.arquivo)));
      // Reads the accounts here (the screen's query may be pending or have failed): with an @ and none active, turns on the manual one.
      const handle = m.handle.trim().replace(/^@/, "");
      if (handle) {
        const active = (await read(api.t[":tenantId"].contas.$get({ param, query: { todas: undefined } }))).contas;
        if (!active.length) {
          await read(api.t[":tenantId"].contas.$post({ param }, bodyJson({ nome: `@${handle}`, modo: "manual" })));
          qc.invalidateQueries({ queryKey: accountsKey });
        }
      }
    },
    // The Brand tab uses the same key (infinite staleTime): without this, it would open with the brand from before saving.
    onSuccess: () => { qc.invalidateQueries({ queryKey: [outlet.id, "marca"] }); navigate(ideas, { replace: true }); },
  });

  return (
    // A single grid: on mobile the preview comes right after the colours (whoever picks a colour sees the card change); on
    // desktop it takes the right column, fixed while scrolling.
    <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }}
      className="grid content-start gap-6 lg:grid-cols-[minmax(0,520px)_minmax(0,380px)] lg:justify-between lg:gap-x-16 [&>*]:lg:col-start-1">
        <div className="grid gap-2">
          <p className="mono m-0 text-apoio">{t("Passo 2 de 2 · marca", "Step 2 of 2 · brand")}</p>
          <h1 className="titulo-tela m-0 text-[32px] lg:text-[48px]">{t(`A cara do ${outlet.nome}`, `The look of ${outlet.nome}`)}</h1>
          <p className="m-0 max-w-[46ch] text-[17px]">
            {author
              ? t("Trouxemos do seu Substack o que deu: confira. Enquanto isso, os seus textos mais recentes já estão virando posts nas Ideias.", "We brought in what we could from your Substack: check it. Meanwhile, your most recent pieces are already becoming posts in Ideas.")
              : t("É o que assina cada card. Dá para mudar depois; se pular, os cards saem com o nome do veículo e cores neutras.", "This is what signs every card. You can change it later; if you skip, cards use the publication's name and neutral colors.")}
          </p>
        </div>

        {!author && <ImportSite veiculo={outlet} aplicar={apply} />}
        {fromSite && (
          <>
            <label className="campo">
              <span>{t("Nome nos cards", "Name on the cards")}</span>
              <input className="entrada" value={fromSite.nome} minLength={2} maxLength={80} required autoComplete="organization" onChange={(e) => setSite({ ...fromSite, nome: e.target.value })} />
            </label>
            <SelectorSources valor={fromSite.fontes} mudar={(sources) => setSite({ ...fromSite, fontes: sources })} />
          </>
        )}
        <FieldsBrand m={m} semConta={withoutAccount} autoral={author} logoAtual={data?.logo ?? null} />
        <PreviewBrand html={cover} legenda={t(`Prévia de exemplo · ${localOf(outlet) || "card"}`, `Sample preview · ${localOf(outlet) || "card"}`)}
          className="lg:sticky lg:top-8 lg:col-start-2! lg:row-span-10 lg:row-start-1 lg:self-start" />

        {save.isError && (
          <p role="alert" className="faixa-erro m-0">
            {save.error instanceof ApiError && save.error.status !== 0 ? t(`Não salvou: ${save.error.message}.`, `Couldn't save: ${save.error.message}.`) : t("Não salvou: sem conexão. Tente de novo.", "Couldn't save: no connection. Try again.")}
          </p>
        )}
        <div className="sticky bottom-0 z-10 -mx-5 border-t border-fio bg-papel px-5 py-3 lg:mx-0 lg:px-0 flex flex-wrap items-center gap-3">
          <button type="submit" className="btn-tinta" disabled={save.isPending}>
            {save.isPending ? t("Salvando…", "Saving…") : t("Salvar e ir para as Ideias", "Save and go to Ideas")}
          </button>
          <Link to={ideas} replace className="btn-sec no-underline">{t("Pular por agora", "Skip for now")}</Link>
        </div>
    </form>
  );
}
