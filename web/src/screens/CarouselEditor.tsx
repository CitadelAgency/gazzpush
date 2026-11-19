// Editing the carousel in Review (Phase 3, DESIGN.md §5): structured customisation, not a free editor. On the left the
// list of cards (select, move up, move down, remove; add up to 10, the CTA stays at the end) and the preview of the
// chosen card in the same template as the render; on the right the card type (layout), the title, the sentences (each
// tied to a fact of the lead, or, in the author outlet, "my claim") and an own photo. Saving creates a new version,
// checks again and only rebuilds the cards that changed; whatever the check points out stays on the card itself and
// Approve waits for the fix. The chosen card lives in the URL (`?card=`), and only it shows the tools: up, down and
// remove on its row, and type and image in rows with one open at a time (`?ferramenta=`). The proof stays in view:
// still beside it on desktop and, on mobile, in Save's pinned bar.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { api, fileBody, bodyJson, ApiError, read, type Success } from "../api";
import { ShortenToFit } from "./ShortenToFit";
import { OtherIllustration } from "./OtherIllustration";
import { OtherHeadlines } from "./OtherHeadlines";
import { useShell } from "../shell/context";
import { IconClose, IconArrow } from "../shell/icons";
import { keys, type PieceStatus } from "../queue";
import { t as tr } from "../language";
import { Part, useMedia, usePart } from "../kit/Parts";
import { PreviewCard } from "../onboarding/CardPreview";
import { htmlCardEdit, type PreviewPiece } from "../onboarding/editPreview";
import { PhotoIllegible, preparePhoto } from "../onboarding/photo";
import {
  AUTHOR_PHOTO_MAX, WITH_LABEL, FOCUSES, PHOTO_MAX_BYTES, LAYOUTS_CONTENT, LIMITS, LITERAL, MAX_CARDS, MIN_CARDS, LAYOUT_NAME, LAYOUT_NAME_EN, LABEL_MAX, ORIGIN_PHOTO_TYPES, isInvite, takesArt, normalizeCards,
  type Card, type CardNormal, type Focus, type Sentence, type LayoutContent, type OriginPhotoType,
} from "../../../src/lib/cards";

const t = api.t[":tenantId"].pecas[":id"];
type CompletePiece = Success<Awaited<ReturnType<typeof t.$get>>>;
type PreviewApi = PreviewPiece & { modo: string; conviteGenerico: { titulo: string; texto: string } };

const AUTHOR = "__autor__";
const newIdCard = () => `n${Math.random().toString(36).slice(2, 9)}`;

/** Errors of the last saved version, per card (the server checks; the screen only shows). */
type PerCard = Record<string, string[]>;

export default function EditCarousel({ s, peca: piece, sair: signOut, salvou: saved, versaoAtual: currentVersion, abrirNova: newOpen }: {
  s: PieceStatus; peca: CompletePiece; sair: () => void; salvou: (version: number, ok: boolean) => void;
  /** The version on the server: greater than `s.versao` = someone else saved while this person was editing. */
  versaoAtual: number; abrirNova: () => void;
}) {
  const { veiculo: outlet } = useShell();
  const qc = useQueryClient();
  const preview = piece.previa as PreviewApi | null;
  const format = s.formato === "post" ? "post" : "carrossel";
  const content = piece.peca.conteudo as { cards?: Card[] };
  const validation = piece.peca.validacao as { ok: boolean; porCard?: PerCard; geral?: string[]; en?: { porCard?: PerCard; geral?: string[] } } | null;
  const [cards, setCards] = useState<CardNormal[]>(() => normalizeCards(content.cards));
  const firstWithError = cards.findIndex((c) => validation?.porCard?.[c.id]?.length);
  const [params, setParams] = useSearchParams();
  const request = cards.findIndex((c) => c.id === params.get("card"));
  const current = request >= 0 ? request : Math.max(0, firstWithError);
  // Switching cards closes the open tool: it belonged to the previous card.
  const choose = (id: string) => setParams((p) => { p.set("card", id); p.delete("ferramenta"); return p; }, { replace: true, preventScrollReset: true });
  // Came back from the check with an error: opens on the card pointed to, even if the URL says another.
  useEffect(() => {
    if (firstWithError >= 0 && !validation?.porCard?.[cards[current]?.id]?.length) choose(cards[firstWithError].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [changed, setChanged] = useState(false);
  /** Headline chosen in "See other headlines": the queue's follows the cover. */
  const [headline, setHeadline] = useState<string | null>(null);
  const [images, setImages] = useState<Record<string, string>>({});
  const author = preview?.modo === "autoral";
  const facts = piece.fatos;
  const perCard: PerCard = changed ? {} : tr(validation?.porCard, validation?.en?.porCard ?? validation?.porCard) ?? {};
  const general = changed ? [] : tr(validation?.geral, validation?.en?.geral ?? validation?.geral) ?? [];
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const otherVersion = currentVersion > s.versao;

  const card = cards[current] ?? cards[0];
  // QA's "does not fit", in both languages: it is the stored warning that lights up Shorten on the title.
  const notFits = (validation?.porCard?.[card.id] ?? []).some((m) => /não cabe|doesn't fit/.test(m));
  const touch = (f: (list: CardNormal[]) => CardNormal[]) => { setCards((l) => f(l.map((c) => ({ ...c, frases: [...c.frases] })))); setChanged(true); };
  const swap = (patch: Partial<CardNormal>) => touch((l) => l.map((c, i) => (i === current ? { ...c, ...patch } : c)));
  // The photo goes to the card it was chosen for, even if the person moved to another during the upload.
  const perId = (id: string, patch: Partial<CardNormal>) => touch((l) => l.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const save = useMutation({
    mutationFn: () => read(t.cards.$put({ param: { tenantId: outlet.id, id: s.id } }, bodyJson({
      versao: s.versao,
      cards: cards.map(({ id, layout, papel: role, titulo: title, frases: sentences, imagem: image, ilustracao: illustration, foco: focus, fotoOrigem: photoOrigin, cta }) => ({ id, layout, papel: role, titulo: title, frases: sentences, imagem: image ?? null, ilustracao: illustration ?? null, foco: focus ?? null, fotoOrigem: photoOrigin ?? null, cta: cta ?? null })),
      ...(headline ? { manchete: headline } : {}),
    }))),
    onSuccess: (r) => {
      saved(r.versao, r.validacao.ok);
      qc.invalidateQueries({ queryKey: keys.status(outlet.id, s.id) });
      qc.invalidateQueries({ queryKey: keys.pecas(outlet.id) });
    },
  });
  const conflict = save.error instanceof ApiError && save.error.status === 409;
  // A photo just uploaded must say who took it (the server checks; this is so the person does not save in vain).
  const withoutOrigin = cards.findIndex((c) => c.imagem && images[c.imagem] && !c.fotoOrigem?.autor.trim());
  const [tool, openTool] = usePart("ferramenta", withoutOrigin === current ? "imagem" : null);
  const [largePreview, openPreview] = usePart("previa", null);
  const wide = useMedia("(min-width: 1024px)");

  const html = useMemo(() => (preview && card ? htmlCardEdit(preview, card, format, images) : ""), [preview, card, format, images]);
  if (!preview || !card) return <p className="faixa-erro m-0">{tr("Não deu para abrir a edição deste post agora.", "Couldn't open the editor for this post right now.")}</p>;
  const layoutName = (l: CardNormal["layout"]) => tr(LAYOUT_NAME[l], LAYOUT_NAME_EN[l]);

  const invite = isInvite(card);
  const contentQty = cards.filter((c) => !isInvite(c)).length;
  const canAdd = format === "carrossel" && cards.length < MAX_CARDS;
  const add = () => {
    const end = cards.findIndex((c) => isInvite(c));
    const after = end < 0 ? cards.length : end;
    const created = newIdCard();
    touch((l) => [...l.slice(0, after), { id: created, layout: "texto", titulo: "", frases: [{ texto: "", fatoId: facts[0]?.id ?? null }] }, ...l.slice(after)]);
    choose(created);
  };
  const move = (from: number, to: number) => {
    touch((l) => { const c = [...l]; [c[from], c[to]] = [c[to], c[from]]; return c; });
    // The moved card stays open: without this, the selection stayed at the position and passed to the neighbour.
    const id = cards[from]?.id;
    if (id) setParams((p) => { p.set("card", id); return p; }, { replace: true, preventScrollReset: true });
  };
  const remove = (i: number) => { const before = cards[Math.max(0, i - 1)]?.id; touch((l) => l.filter((_, j) => j !== i)); if (before) choose(before); };
  const lastMobile = cards.length - 1 - (cards.length && isInvite(cards[cards.length - 1]) ? 1 : 0);

  return (
    <section aria-labelledby="ed-titulo" className="pb-10">
      <div className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 id="ed-titulo" className="titulo-tela m-0 text-[28px] leading-[1.1] lg:text-[36px]">{tr("Editar os cards", "Edit the cards")}</h1>
        <p className="mono m-0 text-apoio">{cards.length} {cards.length === 1 ? "card" : "cards"} · {tr("editar não gasta versão de Reescrever", "editing doesn't use up a Rewrite version")}</p>
        <button type="button" onClick={signOut} className="btn-sec ml-auto">{tr("Fechar a edição", "Close the editor")}</button>
      </div>

      {otherVersion && !save.isPending && (
        <div role="alert" className="faixa-erro mb-4">
          {tr("Outra pessoa salvou uma versão nova deste post enquanto você editava; salvar daqui vai ser recusado.", "Someone else saved a new version of this post while you were editing; saving from here will be refused.")}{" "}
          <button type="button" className="font-bold underline underline-offset-3" onClick={newOpen}>{tr("Abrir a versão nova", "Open the new version")}</button>{" "}
          {tr("(as suas mudanças daqui se perdem).", "(your changes here will be lost).")}
        </div>
      )}
      {general.length > 0 && (
        <div role="alert" className="faixa-erro mb-4">
          <b>{tr("A conferência apontou", "The check flagged")}</b>
          <ul className="m-0 mt-1 pl-5">{general.map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}

      {/* While saving, nothing changes: what goes to the server is what is on screen. */}
      <fieldset disabled={save.isPending} className="m-0 min-w-0 border-0 p-0 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)] lg:gap-10">
        {/* From 1280 px, the list and the proof side by side, still while scrolling; between 1024 and 1279, only the proof stays still. */}
        <div className="grid min-w-0 grid-cols-1 content-start gap-4 lg:flex lg:flex-col min-[1280px]:sticky min-[1280px]:top-[calc(var(--topo)+24px)] min-[1280px]:grid min-[1280px]:grid-cols-[minmax(0,1fr)_300px] min-[1280px]:self-start">
          <div className="grid min-w-0 grid-cols-1 content-start gap-4">
          <ol aria-label={tr("Cards do post", "Post cards")}className="m-0 grid min-w-0 grid-cols-1 list-none gap-1 p-0">
            {cards.map((c, i) => {
              const errors = perCard[c.id]?.length ?? 0;
              return (
                <li key={c.id} className={`flex min-h-12 flex-wrap items-center gap-1 rounded-btn pr-1 ${i === current ? "bg-papel-2" : ""}`}>
                  <button type="button" onClick={() => choose(c.id)} aria-current={i === current ? "true" : undefined}
                    className="flex min-h-12 min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-btn px-2 text-left min-[1280px]:basis-full">
                    <span className="mono w-5 flex-none text-apoio">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate ${i === current ? "font-bold text-texto-forte" : "text-texto"}`}>{c.titulo || tr("Sem título", "Untitled")}</span>
                      <span className="mono block text-apoio">{layoutName(c.layout)}{c.imagem ? tr(" · foto própria", " · own photo") : ""}</span>
                    </span>
                    {errors > 0 && <span className="mono flex-none rounded-faixa bg-terracota-claro px-2 py-0.5 text-terracota">{tr("corrigir", "fix")}</span>}
                  </button>
                  {format === "carrossel" && !isInvite(c) && i === current && (
                    <span className="ml-auto flex gap-1">
                      <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={tr(`Subir o card ${i + 1}`, `Move card ${i + 1} up`)}
                        className="grid size-11 cursor-pointer place-items-center rounded-btn hover:bg-papel disabled:cursor-default disabled:text-fio-forte"><IconArrow className="size-5 rotate-180" /></button>
                      <button type="button" onClick={() => move(i, i + 1)} disabled={i >= lastMobile} aria-label={tr(`Descer o card ${i + 1}`, `Move card ${i + 1} down`)}
                        className="grid size-11 cursor-pointer place-items-center rounded-btn hover:bg-papel disabled:cursor-default disabled:text-fio-forte"><IconArrow className="size-5" /></button>
                      <button type="button" onClick={() => remove(i)} disabled={cards.length <= MIN_CARDS || contentQty <= 1} aria-label={tr(`Tirar o card ${i + 1}`, `Remove card ${i + 1}`)}
                        className="grid size-11 cursor-pointer place-items-center rounded-btn text-terracota hover:bg-papel disabled:cursor-default disabled:text-fio-forte"><IconClose className="size-5" /></button>
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
          {format === "carrossel" && (
            <p className="m-0 flex flex-wrap items-center gap-3">
              <button type="button" onClick={add} disabled={!canAdd} className="btn-sec bg-papel-2">{tr("Adicionar card", "Add card")}</button>
              <span className="ajuda">{canAdd ? tr(`Até ${MAX_CARDS} cards; o convite fica sempre no fim.`, `Up to ${MAX_CARDS} cards; the invite card always stays at the end.`) : tr(`O Instagram aceita até ${MAX_CARDS} cards.`, `Instagram accepts up to ${MAX_CARDS} cards.`)}</span>
            </p>
          )}
          </div>
          {wide && (
            <figure className="sticky top-[calc(var(--topo)+24px)] m-0 grid gap-2 self-start min-[1280px]:static">
              <figcaption className="mono text-apoio">{tr(`Prévia do card ${current + 1} · como vai sair`, `Preview of card ${current + 1} · how it will look`)}</figcaption>
              <div className="w-[min(100%,300px)]">
                <PreviewCard html={html} titulo={tr(`Prévia do card ${current + 1}`, `Preview of card ${current + 1}`)} />
              </div>
            </figure>
          )}
        </div>

        <div className="mt-6 grid min-w-0 grid-cols-1 content-start gap-5 lg:mt-0">
          <h2 className="secao m-0 border-t border-fio-forte">Card {current + 1} · {layoutName(card.layout)}</h2>
          {perCard[card.id]?.length ? (
            <div role="alert" className="faixa-erro">
              <b>{tr("A conferência apontou", "The check flagged")}</b>
              <ul className="m-0 mt-1 pl-5">{perCard[card.id].map((e) => <li key={e}>{e}</li>)}</ul>
            </div>
          ) : null}

          {invite ? (
            <InviteField previa={preview} card={card} escolher={(cta) => {
              const c = cta === null ? preview.conviteGenerico : preview.convites.find((x) => x.indice === cta)!;
              swap({ cta: cta ?? undefined, titulo: c.titulo, frases: [{ texto: c.texto, fatoId: null }] });
            }} />
          ) : (
            <>
              {format === "carrossel" && (
                <Part id="ed-tipo" rotulo={tr("Tipo do card", "Card type")} resumo={layoutName(card.layout)} nivel="h3" aberta={tool === "tipo"} alternar={() => openTool(tool === "tipo" ? null : "tipo")}>
                  <fieldset className="m-0 grid gap-1 border-0 p-0">
                    <legend className="sr-only">{tr("Tipo do card", "Card type")}</legend>
                    <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                      {LAYOUTS_CONTENT.map((l) => (
                        <label key={l} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-btn px-2 hover:bg-papel-2">
                          <input type="radio" name="ed-layout" value={l} checked={card.layout === l}
                            onChange={() => swap({ layout: l as LayoutContent, papel: undefined })} className="size-[18px] accent-[var(--color-tinta)]" />
                          <span>{layoutName(l)}</span>
                        </label>
                      ))}
                    </div>
                    <p className="ajuda m-0">{HELP_LAYOUT()[card.layout as LayoutContent]}</p>
                  </fieldset>
                </Part>
              )}
              <Counted rotulo={card.layout === "numero" ? tr("Número em destaque", "Featured number") : card.layout === "documento" ? tr("Documento ou órgão", "Document or agency") : card.layout === "citacao" ? tr("De quem é a fala", "Who said it") : tr("Título", "Title")}valor={card.titulo} max={LIMITS[card.layout].titulo}>
                <input id="ed-titulo-card" className="entrada" value={card.titulo} onChange={(e) => swap({ titulo: e.target.value })}
                  maxLength={300} autoCapitalize="sentences" enterKeyHint="next" aria-describedby="ed-titulo-card-conta" />
              </Counted>
              {card.layout === "capa" && <OtherHeadlines tenantId={outlet.id} pecaId={s.id} versao={s.versao} desatualizada={changed} escolher={(title) => { swap({ titulo: title }); setHeadline(title); }} />}
              {/* The old cover with a sentence becomes the new cover (the old paper takes no sentence). */}
              {/* The card came back saying it does not fit: the title shortens too. */}
              {notFits && card.layout !== "citacao" && card.layout !== "documento" && <ShortenToFit key={`${card.id}-t`} tenantId={outlet.id} pecaId={s.id} versao={s.versao} cardId={card.id} frase={null} desatualizada={changed} escolher={(title) => swap({ titulo: title })} />}
              <Sentences card={card} fatos={facts} autoral={author} mudar={(sentences) => swap(card.papel === "capa" ? { frases: sentences, papel: undefined } : { frases: sentences })}
                encurtar={(i) => <ShortenToFit key={`${card.id}-${i}`} tenantId={outlet.id} pecaId={s.id} versao={s.versao} cardId={card.id} frase={i} desatualizada={changed}
                  escolher={(text) => swap({ frases: card.frases.map((x, j) => (j === i ? { ...x, texto: text } : x)) })} />} />
              <Part id="ed-imagem" rotulo={tr("Imagem do card", "Card image")} nivel="h3" aberta={tool === "imagem"} alternar={() => openTool(tool === "imagem" ? null : "imagem")}
                tom={withoutOrigin === current ? "aviso" : undefined}
                resumo={withoutOrigin === current ? tr("diga quem fez a foto", "say who took the photo") : card.imagem ? tr("foto enviada", "photo uploaded") : card.ilustracao ? tr("ilustração nova", "new illustration") : takesArt(card, preview.base.composicao) ? tr("ilustração do post", "the post's illustration") : tr("sem imagem", "no image")}>
                <Photo tenantId={outlet.id} pecaId={s.id} card={card} imagens={{ ...preview.imagens, ...images }} ocupado={setUploadingPhoto}
                  subiu={(cardId, key, url) => { setImages((m) => ({ ...m, [key]: url })); perId(cardId, { imagem: key, foco: undefined, fotoOrigem: undefined }); }}
                  mudar={swap} tirar={() => swap({ imagem: undefined, foco: undefined, fotoOrigem: undefined })} />
                {!card.imagem && takesArt(card, preview.base.composicao) && (
                  <OtherIllustration key={`${card.id}-i`} tenantId={outlet.id} pecaId={s.id} versao={s.versao} cardId={card.id} atual={card.ilustracao ?? null}
                    gerou={(cardId, key, url) => { setImages((m) => ({ ...m, [key]: url })); perId(cardId, { ilustracao: key }); }}
                    voltar={() => swap({ ilustracao: undefined })} />
                )}
              </Part>
            </>
          )}

          {/* Save always in view, pinned to the bottom of the screen (Review has no bottom navigation). On mobile, the proof comes here. */}
          <div className="sticky bottom-[var(--pe)] z-10 -mx-5 grid gap-2 border-t border-fio-forte bg-papel px-5 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] lg:mx-0 lg:px-0">
            {conflict && (
              <div role="alert" className="faixa-erro">
                {tr("Outra pessoa salvou este post antes de você.", "Someone else saved this post before you.")}{" "}
                <button type="button" className="font-bold underline underline-offset-3"
                  onClick={() => { newOpen(); qc.invalidateQueries({ queryKey: keys.status(outlet.id, s.id) }); }}>
                  {tr("Abrir a versão nova", "Open the new version")}
                </button>{" "}{tr("(as suas mudanças daqui se perdem).", "(your changes here will be lost).")}
              </div>
            )}
            {save.isError && !conflict && <p role="alert" className="m-0 text-[15px] text-terracota">{(save.error as Error).message}</p>}
            <div className="flex flex-wrap items-end gap-3">
              {!wide && (
                <div className={`flex-none ${largePreview ? "w-[200px]" : "w-[72px]"}`}>
                  <PreviewCard html={html} titulo={tr(`Prévia do card ${current + 1}`, `Preview of card ${current + 1}`)} />
                </div>
              )}
              <div className="flex min-w-0 flex-[1_1_180px] flex-wrap items-center gap-x-3 gap-y-1">
                <button type="button" onClick={() => save.mutate()} disabled={save.isPending || !changed || uploadingPhoto || withoutOrigin >= 0} className="btn-tinta min-w-[180px]">
                  {save.isPending ? tr("Salvando e conferindo…", "Saving and checking…") : tr("Salvar e conferir", "Save and check")}
                </button>
                {!wide && <button type="button" className="btn-sec" aria-pressed={!!largePreview} onClick={() => openPreview(largePreview ? null : "grande")}>{largePreview ? tr("Prévia menor", "Smaller preview") : tr("Prévia maior", "Larger preview")}</button>}
                <p className="ajuda m-0" role="status">
                {save.isPending ? tr("Conferindo com os fatos e montando os cards que mudaram.", "Checking against the facts and rebuilding the cards that changed.")
                  : uploadingPhoto ? tr("Esperando a foto terminar de subir.", "Waiting for the photo to finish uploading.")
                  : withoutOrigin >= 0 ? tr(`Diga quem fez a foto do card ${withoutOrigin + 1}.`, `Say who took the photo on card ${withoutOrigin + 1}.`)
                  : changed ? tr("Alterações não salvas.", "Unsaved changes.") : tr("Nada mudou desde a última versão.", "Nothing has changed since the last version.")}
                </p>
              </div>
            </div>
          </div>
        </div>
      </fieldset>
    </section>
  );
}

const HELP_LAYOUT = (): Record<LayoutContent, string> => ({
  capa: tr("A manchete do post, grande. No carrossel, sem frases.", "The post's headline, large. In a carousel, no sentences."),
  texto: tr("Título e uma ou duas frases.", "A title and one or two sentences."),
  citacao: tr("Uma fala literal da fonte, entre aspas; no título, de quem é a fala.", "A word-for-word quote from the source, in quotation marks; in the title, who said it."),
  numero: tr("Um número grande no título (até 16 caracteres, ex.: 15 dias) e uma frase que o explica.", "A large number in the title (up to 16 characters, e.g.: 15 days) and a sentence that explains it."),
  lista: tr("Título e de 2 a 4 itens curtos.", "A title and 2 to 4 short items."),
  documento: tr("Nome do documento e um trecho copiado do fato, palavra por palavra. Sai em tipo, sem imagem do papel.", "The document's name and a passage copied word for word from the fact. Set in type, with no image of the paper."),
  comparacao: tr("Título e dois lados, cada um com rótulo e valor.", "A title and two sides, each with a label and a value."),
  linha_do_tempo: tr("Título e de 2 a 4 momentos, cada um com a data no rótulo.", "A title and 2 to 4 moments, each with the date in the label."),
});

function Counted({ rotulo: caption, valor: value, max, children }: { rotulo: string; valor: string; max: number; children: ReactNode }) {
  const passed = value.length > max;
  return (
    <label className="campo">
      <span className="flex items-baseline justify-between gap-3">{caption}
        <span id="ed-titulo-card-conta" className={`mono font-normal ${passed ? "text-terracota" : "text-apoio"}`}>{tr(`${value.length} de ${max}`, `${value.length} of ${max}`)}</span>
      </span>
      {children}
    </label>
  );
}

function Sentences({ card, fatos: facts, autoral: author, mudar: change, encurtar: shorten }: { card: CardNormal; fatos: CompletePiece["fatos"]; autoral: boolean; mudar: (f: Sentence[]) => void; encurtar: (sentence: number, text: string) => ReactNode }) {
  const lim = LIMITS[card.layout];
  const set = (i: number, f: Partial<Sentence>) => change(card.frases.map((x, j) => (j === i ? { ...x, ...f } : x)));
  const name = card.layout === "lista" ? tr("Item", "Item") : card.layout === "citacao" ? tr("Fala", "Quote") : card.layout === "documento" ? tr("Trecho", "Passage") : card.layout === "comparacao" ? tr("Valor", "Value") : card.layout === "linha_do_tempo" ? tr("Momento", "Moment") : tr("Frase", "Sentence");
  if (card.layout === "capa" && !card.frases.length) {
    return (
      <p className="m-0 flex flex-wrap items-center gap-3">
        <button type="button" className="btn-sec" onClick={() => change([{ texto: "", fatoId: facts[0]?.id ?? null }])}>{tr("Pôr uma frase na capa", "Add a sentence to the cover")}</button>
        <span className="ajuda">{tr("No carrossel a capa costuma ter só a manchete.", "In a carousel the cover usually has only the headline.")}</span>
      </p>
    );
  }
  return (
    <fieldset className="m-0 grid gap-4 border-0 p-0">
      <legend className="mb-1 p-0 text-[15px] font-bold text-texto-forte">{card.layout === "lista" ? tr("Itens", "Items") : tr("Frases", "Sentences")} <span className="mono font-normal text-apoio">{tr(`até ${lim.frasesMax}`, `up to ${lim.frasesMax}`)}</span></legend>
      {card.frases.map((f, i) => {
        const value = f.autor ? AUTHOR : f.fatoId ?? "";
        const idBase = `ed-${card.id}-f${i}`;
        return (
          <div key={i} className="grid gap-2 bg-papel-2 px-3 py-3 rounded-faixa">
            {WITH_LABEL.includes(card.layout) && (
              <label className="campo">
                <span>{card.layout === "linha_do_tempo" ? tr("Data", "Date") : tr("Rótulo", "Label")} {i + 1}</span>
                <input className="entrada bg-papel" value={f.rotulo ?? ""} maxLength={LABEL_MAX} onChange={(e) => set(i, { rotulo: e.target.value })} />
              </label>
            )}
            <label className="campo">
              <span>{name} {i + 1}</span>
              <textarea id={idBase} className="entrada resize-y bg-papel" rows={2} value={f.texto} maxLength={600} autoCapitalize="sentences"
                onChange={(e) => set(i, { texto: e.target.value })} />
            </label>
            <label className="campo">
              <span className="text-[14px]">{tr("Presa a", "Tied to")}</span>
              <select className="entrada bg-papel" value={value} aria-describedby={`${idBase}-trecho`}
                onChange={(e) => set(i, e.target.value === AUTHOR ? { autor: true, fatoId: null } : { autor: undefined, fatoId: e.target.value || null })}>
                <option value="">{tr("Nenhum fato (a conferência vai recusar)", "No fact (the check will refuse it)")}</option>
                {facts.map((x, n) => <option key={x.id} value={x.id}>{tr("Fato", "Fact")} {n + 1}: {x.texto.slice(0, 80)}{x.texto.length > 80 ? "…" : ""}</option>)}
                {author && <option value={AUTHOR}>{tr("Afirmação minha (eu sou a fonte)", "My own claim (I am the source)")}</option>}
              </select>
              <span id={`${idBase}-trecho`} className="ajuda">
                {f.autor ? tr("Você responde por esta frase; ela não passa pela conferência de números e nomes.", "You answer for this sentence; it skips the check of numbers and names.")
                  : facts.find((x) => x.id === f.fatoId) ? `${tr("Trecho", "Excerpt")}: “${facts.find((x) => x.id === f.fatoId)!.texto}”${facts.find((x) => x.id === f.fatoId)!.fonte ? ` · ${facts.find((x) => x.id === f.fatoId)!.fonte}` : ""}`
                  : tr("Escolha o fato da fonte que sustenta a frase.", "Choose the fact from the source that supports the sentence.")}
              </span>
            </label>
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
              {!LITERAL.includes(card.layout) && !f.autor && f.fatoId && <div className="min-w-0 flex-1">{shorten(i, f.texto)}</div>}
              <button type="button" className="link-acao min-h-11 text-[15px] text-terracota"
                onClick={() => change(card.frases.filter((_, j) => j !== i))}>{tr("Tirar", "Remove")} {name.toLowerCase()} {i + 1}</button>
            </div>
          </div>
        );
      })}
      {card.frases.length < lim.frasesMax && (
        <button type="button" className="btn-sec justify-self-start" onClick={() => change([...card.frases, { texto: "", fatoId: facts[0]?.id ?? null }])}>
          {tr("Acrescentar", "Add")} {name.toLowerCase()}
        </button>
      )}
    </fieldset>
  );
}

const FOCUS_NAME = (): Record<Focus, string> => ({ centro: tr("Centro", "Center"), topo: tr("Topo", "Top"), base: tr("Base", "Bottom"), esquerda: tr("Esquerda", "Left"), direita: tr("Direita", "Right") });
const ORIGIN_NAME = (): Record<OriginPhotoType, string> => ({ minha: tr("Foto minha", "My own photo"), equipe: tr("Da equipe do veículo", "From the publication's team"), autorizada: tr("De terceiro, com autorização", "From someone else, with permission") });

function Photo({ tenantId, pecaId: pieceId, card, imagens: images, subiu: uploaded, mudar: change, tirar: remove, ocupado: busy }: {
  tenantId: string; pecaId: string; card: CardNormal; imagens: Record<string, string>;
  subiu: (cardId: string, key: string, url: string) => void; mudar: (patch: Partial<CardNormal>) => void; tirar: () => void; ocupado: (yes: boolean) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const send = useMutation({
    mutationFn: async ({ arquivo: file }: { arquivo: File; cardId: string }) => {
      const ready = await preparePhoto(file);
      if (ready.size > PHOTO_MAX_BYTES) throw new Error(tr("A foto pode ter até 2 MB.", "The photo can be up to 2 MB."));
      return read(t.fotos.$post({ param: { tenantId, id: pieceId } }, fileBody(ready)));
    },
    onSuccess: (r, { cardId }) => { setError(null); uploaded(cardId, r.chave, r.url); },
    onError: (e) => setError(e instanceof PhotoIllegible ? tr("O navegador não abriu esse arquivo. Mande em JPEG ou PNG.", "The browser couldn't open that file. Send it as JPEG or PNG.") : (e as Error).message),
  });
  useEffect(() => { busy(send.isPending); }, [send.isPending, busy]);
  const uploadingHere = send.isPending && send.variables?.cardId === card.id;
  const choose = (file: File | undefined) => {
    setError(null);
    if (!file) return;
    send.mutate({ arquivo: file, cardId: card.id });
  };
  const url = card.imagem ? images[card.imagem] : null;
  return (
    <div className="grid gap-2">
      <span className="text-[15px] font-bold text-texto-forte" id="ed-foto-rotulo">{tr("Foto própria", "Own photo")}</span>
      <div className="flex flex-wrap items-center gap-3">
        {url && <img src={url} alt="" className="h-14 w-11 rounded-card bg-papel-2 object-cover" />}
        <label className="btn-sec bg-papel-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-3 has-[:focus-visible]:outline-texto-forte">
          {uploadingHere ? tr("Subindo…", "Uploading…") : card.imagem ? tr("Trocar a foto", "Change the photo") : tr("Subir foto", "Upload photo")}
          <input ref={field} type="file" accept="image/*" className="sr-only" aria-labelledby="ed-foto-rotulo" aria-describedby="ed-foto-ajuda"
            disabled={send.isPending} onChange={(e) => { choose(e.target.files?.[0]); if (field.current) field.current.value = ""; }} />
        </label>
        {card.imagem && <button type="button" className="btn-sec" onClick={remove}>{tr("Tirar a foto", "Remove the photo")}</button>}
      </div>
      <p id="ed-foto-ajuda" className={`m-0 ${error ? "text-[15px] text-terracota" : "ajuda"}`} role={error ? "alert" : undefined}>
        {error ?? tr("Só foto sua (ou que você pode usar), no lugar da ilustração deste card. A do celular serve: o app reduz antes de enviar e tira a localização.", "Only your own photo (or one you're allowed to use), in place of this card's illustration. A phone photo works: the app shrinks it before sending and removes the location.")}
      </p>
      {card.imagem && (
        <>
          <fieldset className="m-0 grid gap-1 border-0 p-0">
            <legend className="mb-1 p-0 text-[15px] font-bold text-texto-forte">{tr("Enquadramento", "Framing")}</legend>
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
              {FOCUSES.map((f) => (
                <label key={f} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-btn px-2 hover:bg-papel-2">
                  <input type="radio" name="ed-foco" value={f} checked={(card.foco ?? "centro") === f} onChange={() => change({ foco: f })} className="size-[18px] accent-[var(--color-tinta)]" />
                  <span>{FOCUS_NAME()[f]}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="campo">
            <span>{tr("Quem fez a foto", "Who took the photo")}</span>
            <input className="entrada" value={card.fotoOrigem?.autor ?? ""} maxLength={AUTHOR_PHOTO_MAX} autoCapitalize="words"
              onChange={(e) => change({ fotoOrigem: { autor: e.target.value, tipo: card.fotoOrigem?.tipo ?? "minha" } })} />
          </label>
          <label className="campo">
            <span>{tr("De quem é o direito", "Who holds the rights")}</span>
            <select className="entrada" value={card.fotoOrigem?.tipo ?? "minha"} onChange={(e) => change({ fotoOrigem: { autor: card.fotoOrigem?.autor ?? "", tipo: e.target.value as OriginPhotoType } })}>
              {ORIGIN_PHOTO_TYPES.map((o) => <option key={o} value={o}>{ORIGIN_NAME()[o]}</option>)}
            </select>
            <span className="ajuda">{tr("Fica guardado na peça, como declaração sua. Não aparece no card.", "It's kept with the post, as your statement. It doesn't appear on the card.")}</span>
          </label>
        </>
      )}
    </div>
  );
}

function InviteField({ previa: preview, card, escolher: choose }: { previa: PreviewApi; card: CardNormal; escolher: (cta: number | null) => void }) {
  const current = card.cta ?? (preview.convitePadrao >= 0 ? preview.convitePadrao : null);
  return (
    <div className="grid gap-3">
      <p className="m-0">{tr("O convite é o texto do veículo, o mesmo em todo post; o texto dele muda na aba Marca. Aqui você escolhe qual entra.", "The invite card is the publication's text, the same on every post; you change its text in the Brand tab. Here you choose which one goes in.")}</p>
      {preview.convites.length > 1 ? (
        <fieldset className="m-0 grid gap-1 border-0 p-0">
          <legend className="mb-1 p-0 text-[15px] font-bold text-texto-forte">{tr("Qual convite", "Which invite card")}</legend>
          {preview.convites.map((c) => (
            <label key={c.indice} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-btn px-2 hover:bg-papel-2">
              <input type="radio" name="ed-convite" checked={current === c.indice} onChange={() => choose(c.indice)} className="size-[18px] accent-[var(--color-tinta)]" />
              <span><b className="text-texto-forte">{c.titulo}</b> <span className="text-apoio">· {c.texto}</span></span>
            </label>
          ))}
        </fieldset>
      ) : (
        <p className="mono m-0 text-apoio">{tr("O veículo tem um convite só", "The publication has only one invite card")}: {card.titulo}</p>
      )}
    </div>
  );
}
