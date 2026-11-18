// Criar veículo em dois passos: (1) nome, cobertura e município → POST /api/tenants; (2) marca mínima (@, logo e
// 3 cores) com a prévia do card → PATCH /marca e POST /marca/logo. O passo 2 mora na URL (?marca=<slug>): recarregar
// não perde o veículo já criado. Marca é opcional: "Pular por agora" leva às Ideias com o nome e a paleta neutra.
// Autor: no passo 1 a URL do Substack (o servidor lê o feed e a página e põe os 3 textos mais recentes em produção);
// no passo 2 a marca já vem preenchida com o que o Substack deu, mais a assinatura do card de autor.
// Local e temático: no passo 2, colar o site preenche nome, logo, cores e fontes, e a pessoa confere antes de salvar.
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, corpoArquivo, corpoJson, ErroApi, ler } from "../api";
import { Abertura, FalhaCarga, useTitulo } from "../comum";
import { idioma, t } from "../idioma";
import MarcaGazzpush from "../kit/MarcaGazzpush";
import { CamposMarca, PreviaMarca, SeletorFontes, SeletorIdiomaPosts, useCapa, useEstadoMarca } from "../novo/CamposMarca";
import type { MarcaDoSite as Sugestao } from "../../../src/lib/puxarMarca";
import type { ParFontes } from "../../../src/lib/tipografia";
import { idiomaDoVeiculo, type IdiomaConteudo } from "../../../src/lib/idiomaConteudo";
import { CORES_PADRAO } from "../novo/previa";
import { CampoMunicipio } from "../novo/CampoMunicipio";
import type { Municipio } from "../novo/municipios";
import { localDe, useMe, type Veiculo } from "../sessao";
import vazio1x from "../assets/vazio-veiculo.webp";
import vazio2x from "../assets/vazio-veiculo@2x.webp";

export default function NovoVeiculo() {
  const me = useMe();
  const [params] = useSearchParams();
  const slugMarca = params.get("marca");

  if (me.isPending) return <Abertura />;
  if (me.isError) {
    return <main className="mx-auto max-w-[560px] px-5 pt-16"><FalhaCarga oque={t("a sua conta", "your account")} tentar={() => me.refetch()} /></main>;
  }
  if (!me.data) return <Navigate to={`/entrar?de=${encodeURIComponent("/novo")}`} replace />;

  const veiculos = me.data.tenants;
  const paraMarca = slugMarca ? veiculos.find((v) => v.slug === slugMarca) : undefined;
  if (slugMarca && (!paraMarca || paraMarca.papel !== "admin")) return <Navigate to={paraMarca ? `/t/${paraMarca.slug}` : "/novo"} replace />;

  return (
    <main id="conteudo" className="mx-auto max-w-[1180px] px-5 pt-5 pb-14 lg:px-12 lg:pt-8">
      <header className="mb-6 flex min-h-10 items-center justify-between gap-4 lg:mb-10">
        <MarcaGazzpush />
        {!paraMarca && veiculos.length > 0 && <Link to="/" className="link-acao inline-flex min-h-11 items-center text-[15px]">{t("Voltar", "Back")}</Link>}
      </header>
      {paraMarca ? <PassoMarca veiculo={paraMarca} /> : <PassoVeiculo primeiro={veiculos.length === 0} />}
    </main>
  );
}

function erroCriacao(e: unknown) {
  if (e instanceof ErroApi) {
    if (e.codigo === "substack_invalido" || e.codigo === "substack_sem_feed") return e.message;
    if (e.status === 409) return t("Já existe um veículo com esse nome. Mude o nome um pouco (por exemplo, com a cidade).", "A publication with this name already exists. Change the name a little (for example, add the city).");
    if (e.status === 400 && e.message.startsWith("slug")) return t("Use um nome com pelo menos 3 letras ou números.", "Use a name with at least 3 letters or numbers.");
    if (e.status === 0) return t("Sem conexão. Confira a internet e tente de novo.", "No connection. Check your internet and try again.");
    if (e.status === 400) return e.message;
  }
  return t("Não deu para criar o veículo agora. Tente de novo.", "Couldn't create the publication right now. Try again.");
}

function PassoVeiculo({ primeiro }: { primeiro: boolean }) {
  useTitulo(primeiro ? t("Crie o seu veículo", "Create your publication") : t("Novo veículo", "New publication"));
  const qc = useQueryClient();
  const navegar = useNavigate();
  const [modo, setModo] = useState<"local" | "tematico" | "autoral">("local");
  const [municipio, setMunicipio] = useState<Municipio | null>(null);
  const [faltaMunicipio, setFaltaMunicipio] = useState(false);
  const [substack, setSubstack] = useState("");
  // Idioma dos posts: começa no idioma da tela de quem cria.
  const [idiomaPosts, setIdiomaPosts] = useState<IdiomaConteudo>(idioma());
  const [faltaSubstack, setFaltaSubstack] = useState(false);
  const campoSubstack = useRef<HTMLInputElement>(null);

  const criar = useMutation({
    mutationFn: (nome: string) => ler(api.tenants.$post({}, corpoJson({
      // Português é o padrão do servidor: só manda o idioma quando é outro.
      ...(idiomaPosts !== "pt-BR" ? { idioma: idiomaPosts } : {}),
      ...(modo === "local" && municipio
        ? { nome, modo, uf: municipio.uf, municipioIbge: municipio.ibge, municipioNome: municipio.nome }
        : modo === "autoral" ? { nome, modo, substack: substack.trim() } : { nome, modo }),
    }))),
    onSuccess: async (t) => {
      await qc.invalidateQueries({ queryKey: ["me"] });
      navegar(`/novo?marca=${encodeURIComponent(t.slug)}`, { replace: true });
    },
    // O erro do Substack é do campo: o foco vai para ele, o digitado fica.
    onError: (e) => { if (e instanceof ErroApi && e.codigo?.startsWith("substack_")) campoSubstack.current?.focus(); },
  });
  const erroSubstack = criar.error instanceof ErroApi && criar.error.codigo?.startsWith("substack_") ? criar.error.message : null;

  function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (modo === "local" && !municipio) { setFaltaMunicipio(true); return; }
    if (modo === "autoral" && !substack.trim()) { setFaltaSubstack(true); campoSubstack.current?.focus(); return; }
    criar.mutate(String(new FormData(e.currentTarget).get("nome") ?? "").trim());
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,520px)_1fr] lg:gap-20">
      {primeiro && (
        <img src={vazio1x} srcSet={`${vazio1x} 1x, ${vazio2x} 2x`} width={419} height={254} alt=""
          className="h-auto w-[180px] sm:w-[400px] lg:order-2 lg:mt-24 lg:justify-self-center" />
      )}
      <form onSubmit={enviar} className="grid content-start gap-5 lg:order-1">
        <div className="grid gap-2">
          <p className="mono m-0 text-apoio">{t("Passo 1 de 2 · veículo", "Step 1 of 2 · publication")}</p>
          <h1 className="titulo-tela m-0 text-[32px] lg:text-[48px]">{primeiro ? t("Crie o seu veículo", "Create your publication") : t("Novo veículo", "New publication")}</h1>
          <p className="m-0 max-w-[46ch] text-[17px]">
            {primeiro
              ? t("O veículo é a página ou o portal que vai publicar. Dá para criar outros depois.", "The publication is the page or news site that will post. You can create others later.")
              : t("Cada veículo tem as suas ideias, a sua marca e as suas contas.", "Each publication has its own ideas, brand and accounts.")}
          </p>
          {/* Boas-vindas sem tela a mais: o mapa até o primeiro post, só na primeira vez. */}
          {primeiro && <p className="mono m-0 text-apoio">{t("Até o primeiro post: o veículo e a cidade · a marca e o @ · a primeira ideia", "Before your first post: the publication and the city · the brand and the @ · the first idea")}</p>}
        </div>

        <label className="campo">
          <span>{t("Nome do veículo", "Publication name")}</span>
          <input name="nome" className="entrada" required={modo !== "autoral"} minLength={2} maxLength={80} autoComplete="organization" autoCapitalize="words" enterKeyHint="next"
            placeholder={modo === "autoral" ? t("Nome da publicação", "Publication name") : t("Nome do veículo", "Newsroom name")} aria-describedby={modo === "autoral" ? "nome-ajuda" : undefined} />
          {modo === "autoral" && <span id="nome-ajuda" className="ajuda">{t("Em branco, vale o nome da sua publicação no Substack.", "Leave it blank to use your Substack publication's name.")}</span>}
        </label>

        <fieldset className="m-0 grid gap-2 border-0 p-0">
          <legend className="mb-2 p-0 text-[15px] font-bold text-texto-forte">{t("O que ele cobre", "What it covers")}</legend>
          {([
            ["local", t("Uma cidade", "A city"), t("Notícia de um município: trânsito, serviço, polícia, obra.", "News from one city: traffic, public services, police, construction.")],
            ["tematico", t("Um tema", "A topic"), t("Entretenimento, tecnologia, esporte: sem filtro de lugar.", "Entertainment, technology, sports: no location filter.")],
            ["autoral", t("Autor", "Author"), t("Os seus textos do Substack e do Google Docs, no Instagram na sua voz.", "Your writing from Substack and Google Docs, on Instagram in your voice.")],
          ] as const).map(([valor, rotulo, ajuda]) => (
            <label key={valor} className={`flex cursor-pointer items-start gap-3 rounded-btn px-3 py-3 ${modo === valor ? "bg-papel-2" : "hover:bg-papel-2/60"}`}>
              <input type="radio" name="modo" value={valor} checked={modo === valor} onChange={() => setModo(valor)} className="mt-1 size-[18px] accent-texto-forte" />
              <span className="grid">
                <b className="text-texto-forte">{rotulo}</b>
                <span className="ajuda">{ajuda}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <SeletorIdiomaPosts valor={idiomaPosts} mudar={setIdiomaPosts} />

        {modo === "local" && (
          <CampoMunicipio
            valor={municipio}
            onMudar={(m) => { setMunicipio(m); setFaltaMunicipio(false); }}
            erro={faltaMunicipio ? t("Escolha o município na lista.", "Choose the city from the list.") : undefined}
          />
        )}

        {modo === "autoral" && (
          <label className="campo">
            <span>{t("Endereço do seu Substack", "Your Substack address")}</span>
            <input ref={campoSubstack} type="text" inputMode="url" className="entrada" value={substack} placeholder="https://"
              autoComplete="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="go"
              onChange={(e) => { setSubstack(e.target.value); setFaltaSubstack(false); if (erroSubstack) criar.reset(); }}
              aria-invalid={faltaSubstack || !!erroSubstack} aria-describedby="substack-ajuda" />
            {faltaSubstack || erroSubstack ? (
              <span id="substack-ajuda" role="alert" className="text-[15px] text-terracota">{erroSubstack ?? t("Cole o endereço do seu Substack.", "Paste your Substack address.")}</span>
            ) : (
              <span id="substack-ajuda" className="ajuda">{t("Lemos os textos publicados, o nome, o logo e a cor. Os 3 mais recentes já viram posts.", "We read your published pieces, name, logo and color. The 3 most recent become posts right away.")}</span>
            )}
          </label>
        )}

        {criar.isError && !erroSubstack && <p role="alert" className="faixa-erro m-0">{erroCriacao(criar.error)}</p>}
        {/* Presa ao pé: a ação fica à vista com a lista de opções inteira acima dela. */}
        <div className="sticky bottom-0 z-10 -mx-5 border-t border-fio bg-papel px-5 py-3 lg:mx-0 lg:px-0">
          <button type="submit" className="btn-tinta" disabled={criar.isPending}>
            {criar.isPending ? (modo === "autoral" ? t("Lendo o seu Substack…", "Reading your Substack…") : t("Criando…", "Creating…")) : t("Continuar", "Continue")}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Colar o site preenche os campos do passo: nada é salvo aqui, a pessoa confere e salva. */
function PuxarDoSite({ veiculo, aplicar }: { veiculo: Veiculo; aplicar: (r: Sugestao) => void }) {
  const [site, setSite] = useState("");
  const puxar = useMutation({
    mutationFn: () => ler(api.t[":tenantId"].marca.puxar.$post({ param: { tenantId: veiculo.id } }, corpoJson({ url: site }))),
    onSuccess: aplicar,
  });
  const ir = () => { if (site.trim() && !puxar.isPending) puxar.mutate(); };
  return (
    <div className="grid gap-2">
      <label className="campo">
        <span>{t("Já tem site? Cole o endereço", "Already have a site? Paste the address")}</span>
        <input type="text" inputMode="url" className="entrada" value={site} placeholder="https://" autoComplete="url" autoCapitalize="none" autoCorrect="off" spellCheck={false}
          onChange={(e) => setSite(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); ir(); } }} aria-describedby="site-ajuda" />
        <span id="site-ajuda" className="ajuda">{t("Lemos o nome, o logo, as cores e o tipo de letra. Foto de matéria não entra.", "We read the name, logo, colors and type of lettering. Article photos stay out.")}</span>
      </label>
      <button type="button" className="btn-sec justify-self-start" onClick={ir} disabled={puxar.isPending || !site.trim()}>{puxar.isPending ? t("Lendo o site…", "Reading the site…") : t("Preencher com o site", "Fill in from the site")}</button>
      {puxar.isError && <p role="alert" className="faixa-erro m-0">{puxar.error instanceof ErroApi && puxar.error.status !== 0 ? puxar.error.message : t("Sem conexão. Confira a internet e tente de novo.", "No connection. Check your internet and try again.")}</p>}
      {puxar.isSuccess && (
        <p role="status" className="m-0 text-[15px] text-texto-forte">
          {puxar.data.logo ? t("Pronto. Confira tudo abaixo antes de salvar.", "Done. Check everything below before saving.") : t("Pronto, menos o logo: não achamos um PNG ou SVG. Confira tudo abaixo e escolha o arquivo.", "Done, except the logo: we didn't find a PNG or SVG. Check everything below and choose the file.")}
        </p>
      )}
    </div>
  );
}

function arquivoDoLogo(l: NonNullable<Sugestao["logo"]>) {
  const bytes = Uint8Array.from(atob(l.base64), (c) => c.charCodeAt(0));
  return { arquivo: new File([bytes], l.tipo === "image/png" ? "logo.png" : "logo.svg", { type: l.tipo }), url: `data:${l.tipo};base64,${l.base64}` };
}

function PassoMarca({ veiculo }: { veiculo: Veiculo }) {
  useTitulo(t("Marca", "Brand"), veiculo.nome);
  const navegar = useNavigate();
  const qc = useQueryClient();
  const m = useEstadoMarca();
  const autoral = veiculo.modo === "autoral";
  // Autor: a marca já veio do Substack (nome, logo, cor, assinatura); o passo mostra e deixa mudar.
  const marca = useQuery({
    queryKey: [veiculo.id, "marca"], enabled: autoral, staleTime: Infinity,
    queryFn: () => ler(api.t[":tenantId"].marca.$get({ param: { tenantId: veiculo.id } })),
  });
  const dados = marca.data?.marca;
  const { repor } = m;
  // Uma vez, quando a marca chega (staleTime infinito: recarga de fundo não apaga o que a pessoa mudou).
  useEffect(() => {
    if (dados) repor({ handle: dados.handle ?? "", cores: { ...CORES_PADRAO, ...dados.cores }, assinatura: dados.assinatura ?? "" });
  }, [dados]);
  // Só depois de colar o site: nome e fontes não são campos deste passo sem ele.
  const [doSite, setDoSite] = useState<{ nome: string; fontes: ParFontes } | null>(null);
  const previa = useMemo(() => (doSite?.nome ? { ...veiculo, nome: doSite.nome } : veiculo), [veiculo, doSite?.nome]);
  const capa = useCapa(previa, m, { logoAtual: dados?.logo ?? null, dominio: dados?.dominio ?? null, idioma: idiomaDoVeiculo(veiculo.idioma), fontes: doSite?.fontes });
  function aplicar(r: Sugestao) {
    m.setCores({ ...m.cores, ...r.cores });
    if (r.logo) m.setLogo(arquivoDoLogo(r.logo));
    setDoSite({ nome: r.nome ?? veiculo.nome, fontes: r.fontes });
  }
  const ideias = `/t/${veiculo.slug}`;
  // Um @, uma conta: salvar o @ sem conta ativa liga a conta manual com esse @ (Aprovar não fica desligado no 1º post).
  // Consulta inline, com a mesma chave de `chaves.contas` (web/src/fila.ts): importar a fila traria o pedaço inteiro
  // para uma tela que já carrega a lista do IBGE.
  const chaveContas = [veiculo.id, "contas"] as const;
  const contas = useQuery({ queryKey: chaveContas, queryFn: () => ler(api.t[":tenantId"].contas.$get({ param: { tenantId: veiculo.id }, query: { todas: undefined } })) });
  const semConta = contas.isSuccess && contas.data.contas.length === 0;

  const salvar = useMutation({
    mutationFn: async () => {
      const param = { tenantId: veiculo.id };
      await ler(api.t[":tenantId"].marca.$patch({ param }, corpoJson(autoral ? { handle: m.handle, cores: m.cores, assinatura: m.assinatura } : { handle: m.handle, cores: m.cores, ...(doSite ?? {}) })));
      if (m.logo) await ler(api.t[":tenantId"].marca.logo.$post({ param }, corpoArquivo(m.logo.arquivo)));
      // Lê as contas aqui (a consulta da tela pode estar pendente ou ter falhado): com @ e nenhuma ativa, liga a manual.
      const handle = m.handle.trim().replace(/^@/, "");
      if (handle) {
        const ativas = (await ler(api.t[":tenantId"].contas.$get({ param, query: { todas: undefined } }))).contas;
        if (!ativas.length) {
          await ler(api.t[":tenantId"].contas.$post({ param }, corpoJson({ nome: `@${handle}`, modo: "manual" })));
          qc.invalidateQueries({ queryKey: chaveContas });
        }
      }
    },
    // A aba Marca usa a mesma chave (staleTime infinito): sem isso, abriria com a marca de antes de salvar.
    onSuccess: () => { qc.invalidateQueries({ queryKey: [veiculo.id, "marca"] }); navegar(ideias, { replace: true }); },
  });

  return (
    // Um grid só: no celular a prévia vem logo depois das cores (quem escolhe cor vê o card mudar); no computador ela
    // ocupa a coluna da direita, fixa ao rolar.
    <form onSubmit={(e) => { e.preventDefault(); salvar.mutate(); }}
      className="grid content-start gap-6 lg:grid-cols-[minmax(0,520px)_minmax(0,380px)] lg:justify-between lg:gap-x-16 [&>*]:lg:col-start-1">
        <div className="grid gap-2">
          <p className="mono m-0 text-apoio">{t("Passo 2 de 2 · marca", "Step 2 of 2 · brand")}</p>
          <h1 className="titulo-tela m-0 text-[32px] lg:text-[48px]">{t(`A cara do ${veiculo.nome}`, `The look of ${veiculo.nome}`)}</h1>
          <p className="m-0 max-w-[46ch] text-[17px]">
            {autoral
              ? t("Trouxemos do seu Substack o que deu: confira. Enquanto isso, os seus textos mais recentes já estão virando posts nas Ideias.", "We brought in what we could from your Substack: check it. Meanwhile, your most recent pieces are already becoming posts in Ideas.")
              : t("É o que assina cada card. Dá para mudar depois; se pular, os cards saem com o nome do veículo e cores neutras.", "This is what signs every card. You can change it later; if you skip, cards use the publication's name and neutral colors.")}
          </p>
        </div>

        {!autoral && <PuxarDoSite veiculo={veiculo} aplicar={aplicar} />}
        {doSite && (
          <>
            <label className="campo">
              <span>{t("Nome nos cards", "Name on the cards")}</span>
              <input className="entrada" value={doSite.nome} minLength={2} maxLength={80} required autoComplete="organization" onChange={(e) => setDoSite({ ...doSite, nome: e.target.value })} />
            </label>
            <SeletorFontes valor={doSite.fontes} mudar={(fontes) => setDoSite({ ...doSite, fontes })} />
          </>
        )}
        <CamposMarca m={m} semConta={semConta} autoral={autoral} logoAtual={dados?.logo ?? null} />
        <PreviaMarca html={capa} legenda={t(`Prévia da marca · ${localDe(veiculo) || "card"}`, `Brand preview · ${localDe(veiculo) || "card"}`)}
          className="lg:sticky lg:top-8 lg:col-start-2! lg:row-span-10 lg:row-start-1 lg:self-start" />

        {salvar.isError && (
          <p role="alert" className="faixa-erro m-0">
            {salvar.error instanceof ErroApi && salvar.error.status !== 0 ? t(`Não salvou: ${salvar.error.message}.`, `Couldn't save: ${salvar.error.message}.`) : t("Não salvou: sem conexão. Tente de novo.", "Couldn't save: no connection. Try again.")}
          </p>
        )}
        <div className="sticky bottom-0 z-10 -mx-5 border-t border-fio bg-papel px-5 py-3 lg:mx-0 lg:px-0 flex flex-wrap items-center gap-3">
          <button type="submit" className="btn-tinta" disabled={salvar.isPending}>
            {salvar.isPending ? t("Salvando…", "Saving…") : t("Salvar e ir para as Ideias", "Save and go to Ideas")}
          </button>
          <Link to={ideias} replace className="btn-sec no-underline">{t("Pular por agora", "Skip for now")}</Link>
        </div>
    </form>
  );
}
