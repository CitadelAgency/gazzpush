// The outlet's templates: the Brand tab's section and Review's picker. A template says how the piece presents itself;
// the brand, who speaks. Catalogue only: no hex, font or text. Admins create, edit and archive; a reporter only views.
// The section sits inside the brand form, but saves by itself: the buttons are `type="button"` and Enter does not
// submit the brand.
import { MOTIONS_REELS, STEPS_REELS, type MotionReels, type ReelsStep } from "../../../src/lib/reelsHtml";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { LAYOUTS_CONTENT, LAYOUT_NAME, LAYOUT_NAME_EN, type LayoutContent } from "../../../src/lib/cards";
import { BOXES_TITLE, COMPOSITIONS, MAX_STYLES, STYLE_NAME_MAX, WORDS_MAX, ROLES_COLOR, DEFAULT_PARAMS, SEQUENCE_MAX, TECHNIQUES, POST_TYPES, type BoxTitle, type Composition, type Style, type ColorsRole, type ParamsStyle, type Technique } from "../../../src/lib/style";
import { api, bodyJson, read } from "../api";
import { FailureLoad } from "../common";
import { Part, usePart, type Tone } from "../kit/Parts";
import { PreviewCard } from "../onboarding/CardPreview";
import { Load } from "./outlet/common";
import { keys } from "../queue";
import { t as tr } from "../language";
import { DESK } from "../rules";
import { useSponsorships } from "./Sponsorships";
import { useMe } from "../session";

const route = api.t[":tenantId"].estilos;
const stylesKey = (tenantId: string) => [tenantId, "estilos"] as const;

const COMPOSITION_NAME = (c: Composition): [string, string] => ({
  padrao: [tr("Padrão", "Standard"), tr("Arte inteira, texto no pé sobre a sombra.", "Full art, text at the foot over the shade.")],
  tarja: [tr("Tarja", "Band"), tr("Arte inteira, título em faixa chapada rente ao pé.", "Full art, headline in a flat band at the foot.")],
  coluna: [tr("Coluna", "Column"), tr("Arte em cima, texto em bloco chapado embaixo.", "Art on top, text in a flat block below.")],
  cartaz: [tr("Cartaz", "Poster"), tr("Só tipografia sobre a cor. Não gasta ilustração.", "Type on color only. Uses no illustration.")],
  "primeira-pagina": [tr("Primeira página", "Front page"), tr("Nome do veículo como cabeçalho de jornal, manchete em cima, arte embaixo.", "Outlet name as a newspaper masthead, headline on top, art below.")],
})[c] as [string, string];
const BOX_NAME = (c: BoxTitle) => (c === "alta" ? tr("Caixa alta", "All caps") : tr("Normal", "Sentence case"));
const ROLE_NAME = (p: ColorsRole) => ({ normal: tr("Como na marca", "As in the brand"), invertido: tr("Invertidas: fundo e texto trocados", "Inverted: background and text swapped"), acento: tr("Acento como fundo", "Accent as background") })[p];
const TYPE_NAME = (x: string) => ({ publicidade: tr("Publicidade", "Advertisement"), atualizacao: tr("Atualização", "Update"), errata: tr("Errata", "Correction"), resumo: tr("Resumo do dia", "Daily roundup") })[x] ?? x;
const layoutName = (l: LayoutContent) => tr(LAYOUT_NAME[l], LAYOUT_NAME_EN[l]);

type Draft = { id: string | null; nome: string; params: ParamsStyle; editorias: string[]; tiposPost: string[]; palavras: string; padrao: boolean };
const NEW: Draft = { id: null, nome: "", params: DEFAULT_PARAMS, editorias: [], tiposPost: [], palavras: "", padrao: false };
const style = (e: Style): Draft => ({ id: e.id, nome: e.nome, params: e.params, editorias: e.valePara.editorias, tiposPost: e.valePara.tiposPost, palavras: e.valePara.palavras.join(", "), padrao: e.padrao });
/** `servico` exists only as an old label: triage does not produce that section. */
const DESKS_MODEL = Object.keys(DESK).filter((e) => e !== "servico");
const toggle = (xs: string[], x: string) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);

const techniqueName = (x: Technique): [string, string] => ({
  xilogravura: [tr("Xilogravura", "Woodcut"), tr("Talhos, massas chapadas e contorno grosso.", "Carved marks, flat masses and a thick outline.")],
  reticula: [tr("Retícula", "Halftone"), tr("Pontos de impressão aparentes, em duas tintas.", "Visible print dots, in two inks.")],
  nanquim: [tr("Nanquim", "Ink"), tr("Traço preto e sombra em hachura.", "Black line and hatched shading.")],
  referencia: [tr("Só a imagem da marca", "Brand image only"), tr("Segue a imagem de referência da aba Marca. Sem ela, sai em retícula.", "Follows the reference image in the Brand tab. Without one, it comes out in halftone.")],
})[x] as [string, string];
export const stepName = (p: ReelsStep): [string, string] => (p === 0.8 ? [tr("Mais rápido", "Faster"), tr("Para quem já conhece o assunto.", "For readers who know the story.")] : p === 1 ? [tr("Normal", "Normal"), tr("O tempo de ler cada card.", "Time to read each card.")] : [tr("Mais calmo", "Slower"), tr("Sobra tempo em cada card.", "Extra time on each card.")]);
export const motionName = (m: MotionReels): [string, string] => (m === "manchete" ? [tr("Manchete", "Headline"), tr("Título, depois as frases, uma a uma.", "Headline, then the sentences, one at a time.")] : m === "folha" ? [tr("Folha", "Sheet"), tr("O card seguinte entra deslizando.", "The next card slides in.")] : [tr("Seco", "Cut"), tr("Corte direto entre os cards.", "A straight cut between cards.")]);

function Radios<T extends string | number>({ rotulo: caption, nome: displayName, opcoes: options, valor: value, mudar: change, texto: text, className = "" }: { rotulo: string; nome: string; opcoes: readonly T[]; valor: T; mudar: (v: T) => void; texto: (v: T) => [string, string?]; className?: string }) {
  return (
    <div role="radiogroup" aria-label={caption} className={`grid gap-1 ${className}`}>
      <span className="text-[15px] font-bold text-texto-forte">{caption}</span>
      {options.map((v) => {
        const [title, help] = text(v);
        return (
          <label key={v} className={`flex cursor-pointer items-start gap-3 rounded-btn px-3 py-2 ${value === v ? "bg-papel-2" : "hover:bg-papel-2/60"}`}>
            <input type="radio" name={displayName} value={v} checked={value === v} onChange={() => change(v)} className="mt-1 size-[18px] accent-texto-forte" />
            <span className="grid"><b className="text-texto-forte">{title}</b>{help && <span className="ajuda">{help}</span>}</span>
          </label>
        );
      })}
    </div>
  );
}

function Marks({ rotulo: caption, opcoes: options, marcadas: marked, mudar: change, texto: text }: { rotulo: string; opcoes: readonly string[]; marcadas: string[]; mudar: (xs: string[]) => void; texto: (v: string) => string }) {
  return (
    <fieldset className="m-0 grid gap-1 border-0 p-0">
      <legend className="p-0 text-[15px] font-bold text-texto-forte">{caption}</legend>
      <div className="flex flex-wrap gap-x-4">
        {options.map((v) => (
          <label key={v} className="flex min-h-11 cursor-pointer items-center gap-2">
            <input type="checkbox" checked={marked.includes(v)} onChange={() => change(toggle(marked, v))} className="size-[18px] accent-texto-forte" />
            {text(v)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const Subtitle = ({ children }: { children: string }) => <h4 className="mono m-0 mt-2 text-[12px] font-normal tracking-[.08em] text-apoio uppercase">{children}</h4>;
const orList = (xs: string[], empty: string) => (xs.length ? xs.join(", ") : empty);

/** The form in groups, one open at a time (`?grupo=`): "what the template is like" and, separately, "when it applies". Closed, each group states the current choice. */
function Form({ tenantId, inicial: initial, fechar: dismiss, mudouPrevia: changedPreview, previaCelular: previewPhone }: { tenantId: string; inicial: Draft; fechar: () => void; mudouPrevia: (p: ParamsStyle | null) => void; previaCelular: string | null }) {
  const qc = useQueryClient();
  const [r, setR] = useState(initial);
  const params = (p: Partial<ParamsStyle>) => setR((x) => ({ ...x, params: { ...x.params, ...p } }));
  useEffect(() => { changedPreview(r.params); }, [r.params, changedPreview]);
  const sponsorships = useSponsorships(tenantId).data?.patrocinios ?? [];
  const words = [...new Set(r.palavras.split(",").map((p) => p.trim()).filter(Boolean))];
  const [group, openGroup] = usePart("grupo", null);
  const [largePreview, openPreview] = usePart("previa", null);
  // An invalid field: stays in view and focused, even if it was in a closed group.
  const [invalid, invalidSet] = useState<"nome" | "palavras" | null>(null);
  const nameField = useRef<HTMLInputElement>(null);
  const wordsField = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (invalid === "nome") nameField.current?.focus();
    if (invalid === "palavras" && group === "palavras") wordsField.current?.focus();
  }, [invalid, group]);
  const save = useMutation({
    mutationFn: () => {
      const body = { nome: r.nome, params: r.params, padrao: r.padrao, valePara: { editorias: r.editorias, tiposPost: r.tiposPost, palavras: words } };
      return r.id ? read(route[":id"].$put({ param: { tenantId, id: r.id } }, bodyJson(body))) : read(route.$post({ param: { tenantId } }, bodyJson(body)));
    },
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: stylesKey(tenantId) }); dismiss(); },
  });
  function trySave() {
    if (!r.nome.trim()) { invalidSet("nome"); return; }
    if (words.length > WORDS_MAX) { invalidSet("palavras"); openGroup("palavras"); return; }
    invalidSet(null);
    save.mutate();
  }
  const line = (id: string, label: string, summary: string, content: ReactNode, tone?: Tone) => (
    <Part id={`modelo-${id}`} rotulo={label} resumo={summary} tom={tone} nivel="h5" aberta={group === id} alternar={() => openGroup(group === id ? null : id)}>{content}</Part>
  );
  const sponsor = sponsorships.find((p) => p.id === r.params.patrocinio);
  const withoutTitle = "[&>span:first-child]:sr-only";
  return (
    <div className="grid gap-3 border-t border-fio pt-4" onKeyDown={(e) => { if (e.key === "Enter" && e.target instanceof HTMLInputElement) e.preventDefault(); }}>
      <label className="campo">
        <span>{tr("Nome do modelo", "Template name")}</span>
        <input ref={nameField} className="entrada" maxLength={STYLE_NAME_MAX} autoComplete="off" value={r.nome} aria-invalid={invalid === "nome" ? true : undefined} aria-describedby={invalid === "nome" ? "m-nome-erro" : undefined}
          onChange={(e) => { setR({ ...r, nome: e.target.value }); if (invalid === "nome") invalidSet(null); }} />
        {invalid === "nome" && <span id="m-nome-erro" role="alert" className="text-[15px] text-terracota">{tr("Dê um nome ao modelo.", "Give the template a name.")}</span>}
      </label>
      <section aria-label={tr("Como o modelo é", "How the template looks")}>
        <Subtitle>{tr("Como o modelo é", "How it looks")}</Subtitle>
        {line("composicao", tr("Composição", "Composition"), COMPOSITION_NAME(r.params.composicao)[0],
          <Radios className={withoutTitle} rotulo={tr("Composição", "Composition")} nome="m-composicao" opcoes={COMPOSITIONS} valor={r.params.composicao} mudar={(composition) => params({ composicao: composition })} texto={COMPOSITION_NAME} />)}
        {r.params.composicao !== "cartaz" && line("tecnica", tr("Técnica da ilustração", "Illustration technique"), techniqueName(r.params.tecnica)[0],
          <Radios className={withoutTitle} rotulo={tr("Técnica da ilustração", "Illustration technique")} nome="m-tecnica" opcoes={TECHNIQUES} valor={r.params.tecnica} mudar={(technique) => params({ tecnica: technique })} texto={techniqueName} />)}
        {line("titulo", tr("Título", "Headline"), BOX_NAME(r.params.caixaTitulo),
          <Radios className={withoutTitle} rotulo={tr("Título", "Headline")} nome="m-caixa" opcoes={BOXES_TITLE} valor={r.params.caixaTitulo} mudar={(boxTitle) => params({ caixaTitulo: boxTitle })} texto={(c) => [BOX_NAME(c)]} />)}
        {line("cores", tr("Cores", "Colors"), ROLE_NAME(r.params.papelCores),
          <Radios className={withoutTitle} rotulo={tr("Cores", "Colors")} nome="m-papel" opcoes={ROLES_COLOR} valor={r.params.papelCores} mudar={(colorsRole) => params({ papelCores: colorsRole })} texto={(p) => [ROLE_NAME(p)]} />)}
        {line("reels", "Reels", `${stepName(r.params.reels.passo)[0]} · ${motionName(r.params.reels.movimento)[0]}`, (
          <>
            <Radios rotulo={tr("Ritmo do Reels", "Reel pace")} nome="m-passo" opcoes={STEPS_REELS} valor={r.params.reels.passo} mudar={(step) => params({ reels: { ...r.params.reels, passo: step } })} texto={stepName} />
            <Radios rotulo={tr("Movimento do Reels", "Reel motion")} nome="m-movimento" opcoes={MOTIONS_REELS} valor={r.params.reels.movimento} mudar={(motion) => params({ reels: { ...r.params.reels, movimento: motion } })} texto={motionName} />
          </>
        ))}
        {line("sequencia", tr("Sequência sugerida", "Suggested sequence"), orList(r.params.sequencia.map(layoutName), tr("nenhuma", "none")), (
          <div className="grid gap-1.5">
            <span className="ajuda">{tr(`Depois da capa, até ${SEQUENCE_MAX} cards. O redator troca se o conteúdo não servir.`, `After the cover, up to ${SEQUENCE_MAX} cards. The writer changes it if the content doesn't fit.`)}</span>
            {r.params.sequencia.length > 0 && (
              <ol className="m-0 flex list-none flex-wrap gap-2 p-0">
                {r.params.sequencia.map((l, i) => (
                  <li key={`${l}-${i}`}>
                    <button type="button" className="btn-sec" aria-label={tr(`Tirar ${layoutName(l)}, posição ${i + 1}`, `Remove ${layoutName(l)}, position ${i + 1}`)} onClick={() => params({ sequencia: r.params.sequencia.filter((_, j) => j !== i) })}>{layoutName(l)} ×</button>
                  </li>
                ))}
              </ol>
            )}
            <select className="entrada" aria-label={tr("Acrescentar card à sequência", "Add a card to the sequence")} value="" disabled={r.params.sequencia.length >= SEQUENCE_MAX}
              onChange={(e) => { if (e.target.value) params({ sequencia: [...r.params.sequencia, e.target.value as LayoutContent] }); }}>
              <option value="">{tr("Acrescentar card…", "Add a card…")}</option>
              {LAYOUTS_CONTENT.map((l) => <option key={l} value={l}>{layoutName(l)}</option>)}
            </select>
          </div>
        ))}
        {sponsorships.length > 0 && line("patrocinio", tr("Patrocinador na arte", "Sponsor on the art"), sponsor?.nome ?? tr("sem patrocinador", "no sponsor"), (
          <label className="campo">
            <span className="sr-only">{tr("Patrocinador na arte", "Sponsor on the art")}</span>
            <select className="entrada" value={r.params.patrocinio ?? ""} onChange={(e) => params({ patrocinio: e.target.value || null })} aria-describedby="m-patro-ajuda">
              <option value="">{tr("Sem patrocinador", "No sponsor")}</option>
              {sponsorships.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
            <span id="m-patro-ajuda" className="ajuda">{tr("Só dentro do período. Polícia, publicidade, correção e errata ficam sem faixa.", "Only within the period. Police, ads, updates and corrections carry no band.")}</span>
          </label>
        ))}
      </section>
      <section aria-label={tr("Quando ele vale", "When it applies")}>
        <Subtitle>{tr("Quando ele vale", "When it applies")}</Subtitle>
        {line("editorias", tr("Editorias", "Sections"), orList(r.editorias.map((e) => DESK[e]), tr("nenhuma", "none")),
          <Marks rotulo={tr("Vale para as editorias", "Applies to sections")} opcoes={DESKS_MODEL} marcadas={r.editorias} mudar={(desks) => setR({ ...r, editorias: desks })} texto={(e) => DESK[e]} />)}
        {line("tipos", tr("Tipos de post", "Post types"), orList(r.tiposPost.map(TYPE_NAME), tr("nenhum", "none")),
          <Marks rotulo={tr("Vale para os tipos de post", "Applies to post types")} opcoes={POST_TYPES} marcadas={r.tiposPost} mudar={(postTypes) => setR({ ...r, tiposPost: postTypes })} texto={TYPE_NAME} />)}
        {line("palavras", tr("Palavras", "Words"), orList(words, tr("nenhuma", "none")), (
          <label className="campo">
            <span>{tr("Vale para as palavras", "Applies to words")}</span>
            <input ref={wordsField} className="entrada" autoComplete="off" value={r.palavras} aria-invalid={invalid === "palavras" ? true : undefined} aria-describedby="m-palavras-ajuda"
              onChange={(e) => { setR({ ...r, palavras: e.target.value }); if (invalid === "palavras") invalidSet(null); }} />
            <span id="m-palavras-ajuda" role={invalid === "palavras" ? "alert" : undefined} className={invalid === "palavras" ? "text-[15px] text-terracota" : "ajuda"}>{tr(`Até ${WORDS_MAX}, separadas por vírgula, buscadas no título e no resumo: vaga, urgente.`, `Up to ${WORDS_MAX}, separated by commas, searched in the headline and summary: job, breaking.`)}</span>
          </label>
        ), words.length > WORDS_MAX ? "erro" : undefined)}
        <label className="flex min-h-11 cursor-pointer items-center gap-2 border-t border-fio pt-2">
          <input type="checkbox" checked={r.padrao} onChange={() => setR({ ...r, padrao: !r.padrao })} className="size-[18px] accent-texto-forte" />
          {tr("Usar quando nenhum outro modelo servir", "Use when no other template fits")}
        </label>
      </section>
      {/* Save always in view: pinned above the mobile navigation and at the bottom of the desktop screen. On mobile, the preview comes here. */}
      <div className="sticky bottom-[calc(66px+env(safe-area-inset-bottom))] z-10 -mx-5 flex items-end gap-3 border-t border-fio bg-papel px-5 py-3 lg:bottom-[var(--pe)] lg:mx-0 lg:px-0">
        {previewPhone !== null && <div className={`flex-none ${largePreview ? "w-[200px]" : "w-[72px]"}`}><PreviewCard html={previewPhone} titulo={tr("Prévia do modelo aberto", "Preview of the open template")} /></div>}
        <div className="grid min-w-0 flex-1 gap-2">
          {save.isError && <p role="alert" className="faixa-erro m-0">{(save.error as Error).message}</p>}
          <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1">
            <button type="button" className="btn-tinta" disabled={save.isPending} onClick={trySave}>{tr("Salvar o modelo", "Save template")}</button>
            <button type="button" className="btn-sec" onClick={dismiss}>{tr("Cancelar", "Cancel")}</button>
            {previewPhone !== null && <button type="button" className="btn-sec" aria-pressed={!!largePreview} onClick={() => openPreview(largePreview ? null : "grande")}>{largePreview ? tr("Prévia menor", "Smaller preview") : tr("Prévia maior", "Larger preview")}</button>}
          </p>
        </div>
      </div>
    </div>
  );
}

export const summaryModels = (n: number | undefined) => (n === undefined ? "" : n ? tr(`${n} de ${MAX_STYLES}`, `${n} of ${MAX_STYLES}`) : tr("nenhum", "none"));

/** `mudouPrevia`: the open template's parameters, for the tab's preview; `null`, with no template open. */
/** Another outlet where the person is also an admin: copies the template with a new id, unlinked and without the sponsor. */
function CopyModel({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const others = (useMe().data?.tenants ?? []).filter((v) => v.id !== tenantId && v.papel === "admin");
  const [origin, setOrigin] = useState("");
  const [styleId, setStyleId] = useState("");
  const fromOrigin = useQuery({ queryKey: stylesKey(origin), enabled: !!origin, queryFn: () => read(route.$get({ param: { tenantId: origin } })) });
  const copy = useMutation({
    mutationFn: () => read(route.copiar.$post({ param: { tenantId } }, bodyJson({ origem: origin, estiloId: styleId }))),
    onSuccess: () => { setStyleId(""); qc.invalidateQueries({ queryKey: stylesKey(tenantId) }); },
  });
  if (!others.length) return null;
  return (
    <div className="grid gap-2 border-t border-fio pt-4">
      <span className="text-[15px] font-bold text-texto-forte">{tr("Copiar de outro veículo", "Copy from another outlet")}</span>
      <span className="ajuda">{tr("A cópia não fica ligada à original, e o patrocinador não vem junto.", "The copy isn't tied to the original, and the sponsor stays behind.")}</span>
      <label className="campo">
        <span>{tr("Veículo de origem", "Source outlet")}</span>
        <select className="entrada" value={origin} onChange={(e) => { setOrigin(e.target.value); setStyleId(""); copy.reset(); }}>
          <option value="">{tr("Escolha…", "Choose…")}</option>
          {others.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
        </select>
      </label>
      {fromOrigin.data && (
        <label className="campo">
          <span>{tr("Modelo a copiar", "Template to copy")}</span>
          <select className="entrada" value={styleId} onChange={(e) => { setStyleId(e.target.value); copy.reset(); }}>
            <option value="">{fromOrigin.data.estilos.length ? tr("Escolha…", "Choose…") : tr("Este veículo não tem modelo", "This outlet has no template")}</option>
            {fromOrigin.data.estilos.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
        </label>
      )}
      <button type="button" className="btn-sec justify-self-start" disabled={!styleId || copy.isPending} onClick={() => copy.mutate()}>{copy.isPending ? tr("Copiando…", "Copying…") : tr("Copiar este modelo", "Copy this template")}</button>
      {copy.isError && <p role="alert" className="faixa-erro m-0">{copy.error.message}</p>}
      {copy.isSuccess && <p role="status" className="m-0 text-[15px] text-texto-forte">{tr("Modelo copiado.", "Template copied.")}</p>}
    </div>
  );
}

export function SectionModels({ tenantId, admin, mudouPrevia: changedPreview, previaCelular: previewPhone = null }: { tenantId: string; admin: boolean; mudouPrevia: (p: ParamsStyle | null) => void; previaCelular?: string | null }) {
  const qc = useQueryClient();
  const list = useStyles(tenantId);
  // The open template lives in the URL (`?modelo=`): reloading returns to the same template.
  const [params, setParams] = useSearchParams();
  const openId = params.get("modelo");
  const launch = (id: string | null) => setParams((p) => {
    if (id) p.set("modelo", id); else { p.delete("modelo"); p.delete("grupo"); p.delete("previa"); }
    return p;
  }, { replace: true, preventScrollReset: true });
  const archive = useMutation({
    mutationFn: (id: string) => read(route[":id"].$delete({ param: { tenantId, id } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: stylesKey(tenantId) }),
  });
  useEffect(() => () => changedPreview(null), [changedPreview]);
  const close = () => { launch(null); changedPreview(null); };
  if (list.isPending) return <Load oque={tr("os modelos", "the templates")} />;
  if (list.isError) return <FailureLoad oque={tr("os modelos", "the templates")} tentar={() => list.refetch()} />;
  const styles = list.data.estilos;
  const existing = styles.find((e) => e.id === openId);
  const open = !admin ? null : openId === "novo" ? NEW : existing ? style(existing) : null;
  if (open) return <Form key={open.id ?? "novo"} tenantId={tenantId} inicial={open} fechar={close} mudouPrevia={changedPreview} previaCelular={previewPhone} />;
  return (
    <div className="grid gap-4">
      <p className="ajuda m-0">{tr("A peça nasce no modelo certo: tipo de post, palavras, editoria e, por fim, o padrão. Quem revisa troca em um toque. A peça guarda uma cópia, e mudar o modelo depois não muda o que já nasceu.", "A post starts in the right template: post type, words, section and, last, the default. The reviewer can switch in one tap. The post keeps a copy, so changing the template later doesn't change what's already made.")}</p>
      {styles.length === 0 && <p className="m-0">{tr("Nenhum modelo ainda. Sem modelo, os posts saem no visual de sempre.", "No templates yet. Without one, posts come out in the usual look.")}</p>}
      {styles.length > 0 && (
        <ul aria-label={tr("Modelos do veículo", "Outlet templates")} className="m-0 grid list-none gap-0 p-0">
          {styles.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-fio py-2.5 first:border-t-0">
              <span className="grid min-w-0 flex-1">
                <b className="text-texto-forte">{e.nome}</b>
                <span className="mono text-[13px] text-apoio">{[COMPOSITION_NAME(e.params.composicao)[0], e.padrao && tr("padrão", "default")].filter(Boolean).join(" · ")}</span>
              </span>
              {admin && (
                <span className="flex gap-2">
                  <button type="button" className="btn-sec" onClick={() => launch(e.id)} aria-label={tr(`Editar ${e.nome}`, `Edit ${e.nome}`)}>{tr("Editar", "Edit")}</button>
                  <button type="button" className="btn-sec" disabled={archive.isPending} onClick={() => archive.mutate(e.id)} aria-label={tr(`Arquivar ${e.nome}`, `Archive ${e.nome}`)}>{tr("Arquivar", "Archive")}</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {archive.isError && <p role="alert" className="faixa-erro m-0">{(archive.error as Error).message}</p>}
      {admin && (
        styles.length < MAX_STYLES
          ? <p className="m-0"><button type="button" className="btn-sec" onClick={() => launch("novo")}>{tr("Novo modelo", "New template")}</button></p>
          : <p className="ajuda m-0">{tr(`Até ${MAX_STYLES} modelos por veículo. Arquive um para criar outro.`, `Up to ${MAX_STYLES} templates per outlet. Archive one to create another.`)}</p>
      )}
      {admin && <CopyModel tenantId={tenantId} />}
    </div>
  );
}

export const useStyles = (tenantId: string) => useQuery({ queryKey: stylesKey(tenantId), queryFn: () => read(route.$get({ param: { tenantId } })) });

type Status = { id: string | null; modeloMudou: boolean; marcaMudou: boolean };

/** In Review, next to Edit the cards: swaps the piece's template. A reporter only views. */
export function SelectorModel({ tenantId, pecaId: pieceId, versao: version, modelo: model, editor, aceitarVersao: acceptVersion }: {
  tenantId: string; pecaId: string; versao: number; modelo: Status | null; editor: boolean; aceitarVersao: (v: number) => void;
}) {
  const qc = useQueryClient();
  const list = useStyles(tenantId);
  const fieldId = useId();
  const apply = useMutation({
    mutationFn: (styleId: string | null) => read(api.t[":tenantId"].pecas[":id"].estilo.$put({ param: { tenantId, id: pieceId } }, bodyJson({ versao: version, estiloId: styleId }))),
    onSuccess: async (r) => {
      acceptVersion(r.versao);
      await qc.invalidateQueries({ queryKey: keys.peca(tenantId, pieceId) });
    },
  });
  const styles = list.data?.estilos ?? [];
  if (!model || (!styles.length && !model.id)) return null;
  const changed = model.modeloMudou || model.marcaMudou;
  return (
    <div className="grid gap-2">
      <div className="campo">
        <label htmlFor={fieldId} className="text-[15px] font-bold text-texto-forte">{tr("Modelo", "Template")}</label>
        <select id={fieldId} className="entrada" value={model.id ?? ""} disabled={!editor || apply.isPending} onChange={(e) => apply.mutate(e.target.value || null)}>
          <option value="">{tr("Sem modelo", "No template")}</option>
          {model.id && !styles.some((e) => e.id === model.id) && <option value={model.id}>{tr("Modelo arquivado", "Archived template")}</option>}
          {styles.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
        </select>
      </div>
      {changed && (
        <p className="faixa-aviso m-0 flex flex-wrap items-center gap-3">
          {model.modeloMudou ? tr("Modelo mudou.", "Template changed.") : tr("A marca mudou.", "The brand changed.")}
          {editor && <button type="button" className="btn-sec bg-papel" disabled={apply.isPending} onClick={() => apply.mutate(model.id)}>{tr("Aplicar", "Apply")}</button>}
        </p>
      )}
      {apply.isError && <p role="alert" className="faixa-erro m-0">{(apply.error as Error).message}</p>}
    </div>
  );
}

export type { Style as Estilo };
