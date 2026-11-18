// Os campos da marca mínima (@, logo, 3 cores) com o aviso de contraste, e a prévia do card em componente à parte
// (`useCapa` monta o HTML, `PreviaMarca` o mostra). Servem ao passo 2 do "Criar veículo" e à aba Marca da tela do
// veículo; cada tela põe o título, a prévia e os botões onde quer.
import { type ReactNode, useDeferredValue, useEffect, useState } from "react";
import { t } from "../idioma";
import type { Veiculo } from "../sessao";
import { CORES_PADRAO, contraste, htmlPrevia, type Cores } from "./previa";
import type { MarcaDagua } from "../../../src/lib/marcaDagua";
import { CATALOGO_FONTES, PARES_FONTES, type ParFontes } from "../../../src/lib/tipografia";
import type { ParamsEstilo } from "../../../src/lib/estilo";
import type { IdiomaConteudo } from "../../../src/lib/idiomaConteudo";
import { PreviaCard } from "./PreviaCard";

export const LOGO_MAX = 512 * 1024;

export type LogoNovo = { arquivo: File; url: string };
export type EstadoMarca = { handle: string; cores: Cores; logo: LogoNovo | null; assinatura: string };

export function useEstadoMarca(inicial?: Partial<Pick<EstadoMarca, "handle" | "cores" | "assinatura">>) {
  const [handle, setHandle] = useState(inicial?.handle ?? "");
  const [cores, setCores] = useState<Cores>(inicial?.cores ?? CORES_PADRAO);
  // Só o veículo de autor usa: quem assina o rodapé do card.
  const [assinatura, setAssinatura] = useState(inicial?.assinatura ?? "");
  const [logo, setLogo] = useState<LogoNovo | null>(null);
  const [erroLogo, setErroLogo] = useState<string | null>(null);

  function escolherLogo(arquivo: File | undefined) {
    setErroLogo(null);
    if (!arquivo) return;
    if (arquivo.type !== "image/png" && arquivo.type !== "image/svg+xml") { setErroLogo(t("O logo precisa ser PNG ou SVG.", "The logo must be a PNG or SVG.")); return; }
    if (arquivo.size > LOGO_MAX) { setErroLogo(t("O logo pode ter até 512 KB.", "The logo can be up to 512 KB.")); return; }
    const leitor = new FileReader();
    leitor.onload = () => setLogo({ arquivo, url: String(leitor.result) });
    leitor.readAsDataURL(arquivo);
  }
  /** Volta ao que veio do servidor (depois de salvar ou ao recarregar a marca). */
  function repor(m: Partial<Pick<EstadoMarca, "handle" | "cores" | "assinatura">>) {
    setHandle(m.handle ?? "");
    setCores(m.cores ?? CORES_PADRAO);
    setAssinatura(m.assinatura ?? "");
    setLogo(null);
    setErroLogo(null);
  }
  return { handle, setHandle, cores, setCores, assinatura, setAssinatura, logo, setLogo, erroLogo, escolherLogo, repor };
}
export type Marca = ReturnType<typeof useEstadoMarca>;

type VeiculoPrevia = Pick<Veiculo, "nome" | "municipio" | "modo" | "uf">;

/**
 * HTML da capa de exemplo com a marca do formulário (adiado: digitar no @ não refaz o iframe a cada tecla). `arte`: a
 * imagem no lugar da ilustração.
 */
export function useCapa(veiculo: VeiculoPrevia, m: Marca, o: { estilo?: ParamsEstilo | null; logoAtual?: string | null; marcaDagua?: MarcaDagua; arte?: string | null; dominio?: string | null; fontes?: ParFontes; idioma?: IdiomaConteudo } = {}) {
  const logo = m.logo?.url ?? o.logoAtual ?? null;
  const p = useDeferredValue({ cores: m.cores, handle: m.handle, logo, marcaDagua: o.marcaDagua, arte: o.arte ?? null, assinatura: m.assinatura, dominio: o.dominio ?? undefined, fontes: o.fontes, idioma: o.idioma });
  const [html, setHtml] = useState("");
  useEffect(() => {
    setHtml(htmlPrevia({
      nome: veiculo.nome, handle: p.handle ? `@${p.handle.replace(/^@/, "")}` : "",
      cores: p.cores, logo: p.logo, local: veiculo.municipio ?? "", marcaDagua: p.marcaDagua, arte: p.arte,
      // Veículo de autor: o card de autor do render (sem data, assinatura no rodapé).
      autoral: veiculo.modo === "autoral" ? { assinatura: p.assinatura, dominio: p.dominio } : undefined,
      fontes: p.fontes, idioma: p.idioma, estilo: o.estilo,
    }));
  }, [p, veiculo, o.estilo]);
  return html;
}

/** A prévia em si: legenda em mono, o card reduzido e, embaixo, o que mais a tela quiser dizer. */
export function PreviaMarca({ html, legenda, className = "", children }: { html: string; legenda: string; className?: string; children?: ReactNode }) {
  return (
    <figure className={`m-0 grid content-start gap-3 ${className}`}>
      <figcaption className="mono text-apoio">{legenda}</figcaption>
      <div className="w-[min(100%,240px)] sm:w-[min(100%,340px)] lg:w-full">
        {html && <PreviaCard html={html} />}
      </div>
      {children}
    </figure>
  );
}

/**
 * Os campos em si. `logoAtual` é o logo já salvo (URL assinada), mostrado até escolherem outro. Em `somenteLeitura`
 * tudo fica desabilitado (quem não é admin vê a marca, não a muda).
 */
export function CamposMarca({ m, logoAtual = null, somenteLeitura = false, semConta = false, autoral = false }:
  { m: Marca; logoAtual?: string | null; somenteLeitura?: boolean; semConta?: boolean; autoral?: boolean }) {
  const razao = contraste(m.cores.texto, m.cores.fundo);
  const logoUrl = m.logo?.url ?? logoAtual;
  const ro = somenteLeitura;
  return (
    <>
      {autoral && (
        <label className="campo">
          <span>{t("Assinatura", "Byline")}</span>
          <input
            className="entrada" value={m.assinatura} onChange={(e) => m.setAssinatura(e.target.value)} placeholder={t("Seu nome, como assina os textos", "Your name, as you sign your texts")}
            disabled={ro} autoComplete="name" autoCapitalize="words" enterKeyHint="next" maxLength={60} aria-describedby="assinatura-ajuda"
          />
          <span id="assinatura-ajuda" className="ajuda">{t("No rodapé de cada card, no lugar da fonte, ligada ao seu texto. Em branco, assina com o nome do veículo.", "In the footer of each card, in place of the source, linked to your text. Left blank, it is signed with the publication's name.")}</span>
        </label>
      )}
      <label className="campo">
        <span>{t("@ no Instagram", "Instagram @")}</span>
        <input
          className="entrada" value={m.handle} onChange={(e) => m.setHandle(e.target.value.trim())} placeholder="@" disabled={ro}
          autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="done" maxLength={31} pattern="@?[A-Za-z0-9._]{1,30}" aria-describedby="handle-ajuda"
        />
        <span id="handle-ajuda" className="ajuda">
          {t("Aparece no rodapé de cada card. Letras, números, ponto e sublinhado (_).", "Shown in the footer of each card. Letters, numbers, periods and underscores (_).")}
          {semConta && t(" Sem conta ligada, este @ vira a conta em que você posta: Aprovar não publica, o post fica em Prontos para postar e você posta pelo celular. Postagem automática é opção em Veículo › Contas.",
            " With no account connected, this @ becomes the account you post to: Approve doesn't publish, the post waits in Ready to post and you post from your phone. Automatic posting is an option in Publication › Accounts.")}
        </span>
      </label>

      <div className="grid gap-2">
        <span className="text-[15px] font-bold text-texto-forte" id="logo-rotulo">{t("Logo", "Logo")}</span>
        <div className="flex flex-wrap items-center gap-3">
          {logoUrl && <img src={logoUrl} alt="" className="h-12 w-auto max-w-[140px] rounded-card bg-papel-2 object-contain p-1" />}
          {!ro && (
            <label className="btn-sec bg-papel-2">
              {logoUrl ? t("Trocar arquivo", "Change file") : t("Escolher arquivo", "Choose file")}
              <input type="file" accept="image/png,image/svg+xml" className="sr-only" aria-labelledby="logo-rotulo"
                aria-describedby="logo-ajuda" onChange={(e) => m.escolherLogo(e.target.files?.[0])} />
            </label>
          )}
          {m.logo && <button type="button" className="btn-sec" onClick={() => m.setLogo(null)}>{t("Tirar", "Remove")}</button>}
        </div>
        <p id="logo-ajuda" className={`m-0 ${m.erroLogo ? "text-[15px] text-terracota" : "ajuda"}`} role={m.erroLogo ? "alert" : undefined}>
          {m.erroLogo ?? (m.logo ? m.logo.arquivo.name
            : ro ? (logoAtual ? t("Logo atual.", "Current logo.") : t("Sem logo: os cards saem com o nome do veículo.", "No logo: cards go out with the publication's name."))
            : t(`${logoAtual ? "" : "Sem logo ainda. "}PNG ou SVG, até 512 KB. Fundo transparente fica melhor.`,
              `${logoAtual ? "" : "No logo yet. "}PNG or SVG, up to 512 KB. A transparent background works best.`))}
        </p>
      </div>

      <fieldset className="m-0 grid gap-3 border-0 p-0" disabled={ro}>
        <legend className="mb-2 p-0 text-[15px] font-bold text-texto-forte">{t("Cores do card", "Card colors")}</legend>
        <div className="grid grid-cols-3 gap-3">
          {([["fundo", t("Fundo", "Background")], ["texto", t("Texto", "Text")], ["acento", t("Destaque", "Accent")]] as const).map(([k, rotulo]) => (
            <label key={k} className={`grid justify-items-start gap-1.5 ${ro ? "" : "cursor-pointer"}`}>
              <span className="text-[15px]">{rotulo}</span>
              <input type="color" value={m.cores[k]} onChange={(e) => m.setCores((c) => ({ ...c, [k]: e.target.value }))}
                className={`h-11 w-full max-w-[120px] rounded-btn border-0 bg-papel-2 p-1 ${ro ? "" : "cursor-pointer"}`} />
              <span className="mono text-apoio">{m.cores[k]}</span>
            </label>
          ))}
        </div>
        {razao < 4.5 && (
          <p role="status" className="faixa-aviso m-0">
            {t(
              `Texto (${m.cores.texto}) sobre Fundo (${m.cores.fundo}): contraste de ${razao.toFixed(1).replace(".", ",")}:1. Nos cards sem ilustração o texto fica sobre o Fundo; para ler bem no celular, o mínimo é 4,5:1. Escureça o Fundo ou clareie o Texto.`,
              `Text (${m.cores.texto}) on Background (${m.cores.fundo}): contrast of ${razao.toFixed(1)}:1. On cards without an illustration the text sits on the Background; to read well on a phone, the minimum is 4.5:1. Darken the Background or lighten the Text.`,
            )}
          </p>
        )}
      </fieldset>
    </>
  );
}

/**
 * O par de fontes dos cards (catálogo curto, src/lib/tipografia.ts): é do veículo, não do card. Cada opção mostra o
 * nome nas próprias fontes do par; a prévia ao lado muda junto.
 */
/**
 * Idioma dos posts do veículo: cards, legenda, convite padrão e conferência. Não muda as telas (cada pessoa escolhe as
 * suas no menu da conta) nem o que já foi produzido; vale para o que sair daqui em diante.
 */
export function SeletorIdiomaPosts({ valor, mudar, somenteLeitura = false }: { valor: IdiomaConteudo; mudar: (i: IdiomaConteudo) => void; somenteLeitura?: boolean }) {
  return (
    <fieldset className="m-0 grid gap-1 border-0 p-0" disabled={somenteLeitura} aria-describedby="idioma-posts-ajuda">
      <legend className="mb-2 p-0 text-[15px] font-bold text-texto-forte">{t("Idioma dos posts", "Post language")}</legend>
      {([["pt-BR", "Português"], ["en", "English"]] as const).map(([valorIdioma, nome]) => (
        <label key={valorIdioma} className={`flex min-h-12 items-center gap-3 rounded-btn px-2 ${somenteLeitura ? "" : "cursor-pointer hover:bg-papel-2"}`}>
          <input type="radio" name="idioma-posts" value={valorIdioma} checked={valor === valorIdioma} onChange={() => mudar(valorIdioma)} className="size-[18px] flex-none accent-[var(--color-tinta)]" />
          <b lang={valorIdioma} className="text-texto-forte">{nome}</b>
        </label>
      ))}
      <span id="idioma-posts-ajuda" className="ajuda">{t("Cards, legenda e conferência saem neste idioma. Vale para os próximos posts.", "Cards, caption and check come out in this language. It applies to the next posts.")}</span>
    </fieldset>
  );
}

export function SeletorFontes({ valor, mudar, somenteLeitura = false }: { valor: ParFontes; mudar: (p: ParFontes) => void; somenteLeitura?: boolean }) {
  return (
    <fieldset className="m-0 grid gap-1 border-0 p-0" disabled={somenteLeitura}>
      <legend className="mb-2 p-0 text-[15px] font-bold text-texto-forte">{t("Fontes do card", "Card fonts")}</legend>
      {PARES_FONTES.map((par) => {
        const def = CATALOGO_FONTES[par];
        return (
          <label key={par} className={`flex min-h-12 items-center gap-3 rounded-btn px-2 ${somenteLeitura ? "" : "cursor-pointer hover:bg-papel-2"}`}>
            <input type="radio" name="fontes-card" value={par} checked={valor === par} onChange={() => mudar(par)} className="size-[18px] flex-none accent-[var(--color-tinta)]" />
            <span className="grid">
              <b className="text-texto-forte">{t(def.nome, def.nomeEn)}{par === "padrao" ? <span className="font-normal text-apoio">{t(" · padrão", " · default")}</span> : null}</b>
              <span className="text-[14px] text-apoio">{t(def.descricao, def.descricaoEn)}</span>
            </span>
          </label>
        );
      })}
      <p className="ajuda m-0">{t("Vale para todos os cards dos próximos posts, e para os que você editar.", "Applies to every card in upcoming posts, and to the ones you edit.")}</p>
    </fieldset>
  );
}
