// The minimal brand fields (@, logo, 3 colours) with the contrast warning, and the card preview as a separate component
// (`useCover` builds the HTML, `PreviewBrand` shows it). They serve step 2 of "Create outlet" and the outlet screen's Brand
// tab; each screen puts the title, the preview and the buttons where it wants.
import { type ReactNode, useDeferredValue, useEffect, useState } from "react";
import { t } from "../language";
import type { Outlet } from "../session";
import { DEFAULT_COLORS, contraste, htmlPreview, type Colors } from "./preview";
import type { WaterBrand } from "../../../src/lib/watermark";
import { CATALOG_SOURCES, SOURCES_PAIRS, type SourcesPair } from "../../../src/lib/typography";
import type { ParamsStyle } from "../../../src/lib/style";
import type { ContentLanguage } from "../../../src/lib/contentLanguage";
import { PreviewCard } from "./CardPreview";

export const LOGO_MAX = 512 * 1024;

export type NewLogo = { arquivo: File; url: string };
export type BrandState = { handle: string; cores: Colors; logo: NewLogo | null; assinatura: string };

export function useStateBrand(initial?: Partial<Pick<BrandState, "handle" | "cores" | "assinatura">>) {
  const [handle, setHandle] = useState(initial?.handle ?? "");
  const [colors, setColors] = useState<Colors>(initial?.cores ?? DEFAULT_COLORS);
  // Only the author outlet uses it: who signs the card footer.
  const [signature, setSignature] = useState(initial?.assinatura ?? "");
  const [logo, setLogo] = useState<NewLogo | null>(null);
  const [logoError, setErrorLogo] = useState<string | null>(null);

  function chooseLogo(file: File | undefined) {
    setErrorLogo(null);
    if (!file) return;
    if (file.type !== "image/png" && file.type !== "image/svg+xml") { setErrorLogo(t("O logo precisa ser PNG ou SVG.", "The logo must be a PNG or SVG.")); return; }
    if (file.size > LOGO_MAX) { setErrorLogo(t("O logo pode ter até 512 KB.", "The logo can be up to 512 KB.")); return; }
    const reader = new FileReader();
    reader.onload = () => setLogo({ arquivo: file, url: String(reader.result) });
    reader.readAsDataURL(file);
  }
  /** Goes back to what came from the server (after saving or when reloading the brand). */
  function restore(m: Partial<Pick<BrandState, "handle" | "cores" | "assinatura">>) {
    setHandle(m.handle ?? "");
    setColors(m.cores ?? DEFAULT_COLORS);
    setSignature(m.assinatura ?? "");
    setLogo(null);
    setErrorLogo(null);
  }
  return { handle, setHandle, cores: colors, setCores: setColors, assinatura: signature, setAssinatura: setSignature, logo, setLogo, erroLogo: logoError, escolherLogo: chooseLogo, repor: restore };
}
export type Brand = ReturnType<typeof useStateBrand>;

type OutletPreview = Pick<Outlet, "nome" | "municipio" | "modo" | "uf">;

/**
 * HTML of the sample cover with the form's brand (debounced: typing in the @ does not redo the iframe on every key).
 * `arte`: the image in place of the illustration.
 */
export function useCover(outlet: OutletPreview, m: Brand, o: { estilo?: ParamsStyle | null; logoAtual?: string | null; marcaDagua?: WaterBrand; arte?: string | null; dominio?: string | null; fontes?: SourcesPair; idioma?: ContentLanguage } = {}) {
  const logo = m.logo?.url ?? o.logoAtual ?? null;
  const p = useDeferredValue({ cores: m.cores, handle: m.handle, logo, marcaDagua: o.marcaDagua, arte: o.arte ?? null, assinatura: m.assinatura, dominio: o.dominio ?? undefined, fontes: o.fontes, idioma: o.idioma });
  const [html, setHtml] = useState("");
  useEffect(() => {
    setHtml(htmlPreview({
      nome: outlet.nome, handle: p.handle ? `@${p.handle.replace(/^@/, "")}` : "",
      cores: p.cores, logo: p.logo, local: outlet.municipio ?? "", marcaDagua: p.marcaDagua, arte: p.arte,
      // Author outlet: the render's author card (no date, signature in the footer).
      autoral: outlet.modo === "autoral" ? { assinatura: p.assinatura, dominio: p.dominio } : undefined,
      fontes: p.fontes, idioma: p.idioma, estilo: o.estilo,
    }));
  }, [p, outlet, o.estilo]);
  return html;
}

/** The preview itself: the caption in mono, the reduced card and, below, whatever else the screen wants to say. */
export function PreviewBrand({ html, legenda: caption, className = "", children }: { html: string; legenda: string; className?: string; children?: ReactNode }) {
  return (
    <figure className={`m-0 grid content-start gap-3 ${className}`}>
      <figcaption className="mono text-apoio">{caption}</figcaption>
      <div className="w-[min(100%,240px)] sm:w-[min(100%,340px)] lg:w-full">
        {html && <PreviewCard html={html} />}
      </div>
      {children}
    </figure>
  );
}

/**
 * The fields themselves. `logoAtual` is the logo already saved (signed URL), shown until another is chosen. With
 * `somenteLeitura` everything is disabled (a non-admin sees the brand, does not change it).
 */
export function FieldsBrand({ m, logoAtual: currentLogo = null, somenteLeitura: readOnly = false, semConta: withoutAccount = false, autoral: author = false }:
  { m: Brand; logoAtual?: string | null; somenteLeitura?: boolean; semConta?: boolean; autoral?: boolean }) {
  const ratio = contraste(m.cores.texto, m.cores.fundo);
  const logoUrl = m.logo?.url ?? currentLogo;
  const ro = readOnly;
  return (
    <>
      {author && (
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
          className="entrada" value={m.handle} onChange={(e) => m.setHandle(e.target.value.trim())} placeholder={t("@seuveiculo", "@yourpublication")} disabled={ro}
          autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="done" maxLength={31} pattern="@?[A-Za-z0-9._]{1,30}" aria-describedby="handle-ajuda"
        />
        <span id="handle-ajuda" className="ajuda">
          {t("Aparece no rodapé de cada card. Letras, números, ponto e sublinhado (_).", "Shown in the footer of each card. Letters, numbers, periods and underscores (_).")}
          {withoutAccount && t(" Sem conta ligada, este @ vira a conta em que você posta: Aprovar não publica, o post fica em Prontos para postar e você posta pelo celular. Postagem automática é opção em Veículo › Contas.",
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
            : ro ? (currentLogo ? t("Logo atual.", "Current logo.") : t("Sem logo: os cards saem com o nome do veículo.", "No logo: cards go out with the publication's name."))
            : t(`${currentLogo ? "" : "Sem logo ainda. "}PNG ou SVG, até 512 KB. Fundo transparente fica melhor.`,
              `${currentLogo ? "" : "No logo yet. "}PNG or SVG, up to 512 KB. A transparent background works best.`))}
        </p>
      </div>

      <fieldset className="m-0 grid gap-3 border-0 p-0" disabled={ro}>
        <legend className="mb-2 p-0 text-[15px] font-bold text-texto-forte">{t("Cores do card", "Card colors")}</legend>
        <div className="grid grid-cols-3 gap-3">
          {([["fundo", t("Fundo", "Background")], ["texto", t("Texto", "Text")], ["acento", t("Destaque", "Accent")]] as const).map(([k, caption]) => (
            <label key={k} className={`grid justify-items-start gap-1.5 ${ro ? "" : "cursor-pointer"}`}>
              <span className="text-[15px]">{caption}</span>
              <input type="color" value={m.cores[k]} onChange={(e) => m.setCores((c) => ({ ...c, [k]: e.target.value }))}
                className={`h-11 w-full max-w-[120px] rounded-btn border-0 bg-papel-2 p-1 ${ro ? "" : "cursor-pointer"}`} />
              <span className="mono text-apoio">{m.cores[k]}</span>
            </label>
          ))}
        </div>
        {ratio < 4.5 && (
          <p role="status" className="faixa-aviso m-0">
            {t(
              `Texto (${m.cores.texto}) sobre Fundo (${m.cores.fundo}): contraste de ${ratio.toFixed(1).replace(".", ",")}:1. Nos cards sem ilustração o texto fica sobre o Fundo; para ler bem no celular, o mínimo é 4,5:1. Escureça o Fundo ou clareie o Texto.`,
              `Text (${m.cores.texto}) on Background (${m.cores.fundo}): contrast of ${ratio.toFixed(1)}:1. On cards without an illustration the text sits on the Background; to read well on a phone, the minimum is 4.5:1. Darken the Background or lighten the Text.`,
            )}
          </p>
        )}
      </fieldset>
    </>
  );
}

/**
 * The cards' font pair (short catalogue, src/lib/typography.ts): it belongs to the outlet, not to the card. Each option
 * shows its name in the pair's own fonts; the preview beside it changes along.
 */
/**
 * The outlet's post language: cards, caption, default CTA and check. It changes neither the screens (each person
 * chooses theirs in the account menu) nor what was already produced; it applies to what comes out from now on.
 */
export function SelectorLanguagePosts({ valor: value, mudar: change, somenteLeitura: readOnly = false }: { valor: ContentLanguage; mudar: (i: ContentLanguage) => void; somenteLeitura?: boolean }) {
  return (
    <fieldset className="m-0 grid gap-1 border-0 p-0" disabled={readOnly} aria-describedby="idioma-posts-ajuda">
      <legend className="mb-2 p-0 text-[15px] font-bold text-texto-forte">{t("Idioma dos posts", "Post language")}</legend>
      {([["pt-BR", "Português"], ["en", "English"]] as const).map(([languageValue, name]) => (
        <label key={languageValue} className={`flex min-h-12 items-center gap-3 rounded-btn px-2 ${readOnly ? "" : "cursor-pointer hover:bg-papel-2"}`}>
          <input type="radio" name="idioma-posts" value={languageValue} checked={value === languageValue} onChange={() => change(languageValue)} className="size-[18px] flex-none accent-[var(--color-tinta)]" />
          <b lang={languageValue} className="text-texto-forte">{name}</b>
        </label>
      ))}
      <span id="idioma-posts-ajuda" className="ajuda">{t("Cards, legenda e conferência saem neste idioma. Vale para os próximos posts.", "Cards, caption and check come out in this language. It applies to the next posts.")}</span>
    </fieldset>
  );
}

export function SelectorSources({ valor: value, mudar: change, somenteLeitura: readOnly = false }: { valor: SourcesPair; mudar: (p: SourcesPair) => void; somenteLeitura?: boolean }) {
  return (
    <fieldset className="m-0 grid gap-1 border-0 p-0" disabled={readOnly}>
      <legend className="mb-2 p-0 text-[15px] font-bold text-texto-forte">{t("Fontes do card", "Card fonts")}</legend>
      {SOURCES_PAIRS.map((pair) => {
        const def = CATALOG_SOURCES[pair];
        return (
          <label key={pair} className={`flex min-h-12 items-center gap-3 rounded-btn px-2 ${readOnly ? "" : "cursor-pointer hover:bg-papel-2"}`}>
            <input type="radio" name="fontes-card" value={pair} checked={value === pair} onChange={() => change(pair)} className="size-[18px] flex-none accent-[var(--color-tinta)]" />
            <span className="grid">
              <b className="text-texto-forte">{t(def.nome, def.nomeEn)}{pair === "padrao" ? <span className="font-normal text-apoio">{t(" · padrão", " · default")}</span> : null}</b>
              <span className="text-[14px] text-apoio">{t(def.descricao, def.descricaoEn)}</span>
            </span>
          </label>
        );
      })}
      <p className="ajuda m-0">{t("Vale para todos os cards dos próximos posts, e para os que você editar.", "Applies to every card in upcoming posts, and to the ones you edit.")}</p>
    </fieldset>
  );
}
