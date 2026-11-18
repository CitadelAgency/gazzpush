// Modelos do veículo: a seção da aba Marca e o seletor da Revisão. Modelo diz como a peça se apresenta; a marca, quem
// fala. Só catálogo: nada de hex, fonte ou texto. O admin cria, edita e arquiva; repórter só vê. A seção fica dentro do
// formulário da marca, mas salva sozinha: os botões são `type="button"` e o Enter não envia a marca.
import { MOVIMENTOS_REELS, PASSOS_REELS, type MovimentoReels, type PassoReels } from "../../../src/lib/reelsHtml";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { LAYOUTS_DE_CONTEUDO, NOME_LAYOUT, NOME_LAYOUT_EN, type LayoutConteudo } from "../../../src/lib/cards";
import { CAIXAS_TITULO, COMPOSICOES, MAX_ESTILOS, NOME_ESTILO_MAX, PALAVRAS_MAX, PAPEIS_COR, PARAMS_PADRAO, SEQUENCIA_MAX, TECNICAS, TIPOS_POST, type CaixaTitulo, type Composicao, type Estilo, type PapelCores, type ParamsEstilo, type Tecnica } from "../../../src/lib/estilo";
import { api, corpoJson, ler } from "../api";
import { FalhaCarga } from "../comum";
import { Parte, useParte, type Tom } from "../kit/Partes";
import { PreviaCard } from "../novo/PreviaCard";
import { Carga } from "./veiculo/comum";
import { chaves } from "../fila";
import { t as tr } from "../idioma";
import { EDITORIA } from "../regras";
import { usePatrocinios } from "./Patrocinios";
import { useMe } from "../sessao";

const rota = api.t[":tenantId"].estilos;
const chaveEstilos = (tenantId: string) => [tenantId, "estilos"] as const;

const NOME_COMPOSICAO = (c: Composicao): [string, string] => ({
  padrao: [tr("Padrão", "Standard"), tr("Arte inteira, texto no pé sobre a sombra.", "Full art, text at the foot over the shade.")],
  tarja: [tr("Tarja", "Band"), tr("Arte inteira, título em faixa chapada rente ao pé.", "Full art, headline in a flat band at the foot.")],
  coluna: [tr("Coluna", "Column"), tr("Arte em cima, texto em bloco chapado embaixo.", "Art on top, text in a flat block below.")],
  cartaz: [tr("Cartaz", "Poster"), tr("Só tipografia sobre a cor. Não gasta ilustração.", "Type on color only. Uses no illustration.")],
  "primeira-pagina": [tr("Primeira página", "Front page"), tr("Nome do veículo como cabeçalho de jornal, manchete em cima, arte embaixo.", "Outlet name as a newspaper masthead, headline on top, art below.")],
})[c] as [string, string];
const NOME_CAIXA = (c: CaixaTitulo) => (c === "alta" ? tr("Caixa alta", "All caps") : tr("Normal", "Sentence case"));
const NOME_PAPEL = (p: PapelCores) => ({ normal: tr("Como na marca", "As in the brand"), invertido: tr("Invertidas: fundo e texto trocados", "Inverted: background and text swapped"), acento: tr("Acento como fundo", "Accent as background") })[p];
const NOME_TIPO = (x: string) => ({ publicidade: tr("Publicidade", "Advertisement"), atualizacao: tr("Atualização", "Update"), errata: tr("Errata", "Correction"), resumo: tr("Resumo do dia", "Daily roundup") })[x] ?? x;
const nomeLayout = (l: LayoutConteudo) => tr(NOME_LAYOUT[l], NOME_LAYOUT_EN[l]);

type Rascunho = { id: string | null; nome: string; params: ParamsEstilo; editorias: string[]; tiposPost: string[]; palavras: string; padrao: boolean };
const NOVO: Rascunho = { id: null, nome: "", params: PARAMS_PADRAO, editorias: [], tiposPost: [], palavras: "", padrao: false };
const deEstilo = (e: Estilo): Rascunho => ({ id: e.id, nome: e.nome, params: e.params, editorias: e.valePara.editorias, tiposPost: e.valePara.tiposPost, palavras: e.valePara.palavras.join(", "), padrao: e.padrao });
/** `servico` existe só como rótulo antigo: a triagem não produz essa editoria. */
const EDITORIAS_MODELO = Object.keys(EDITORIA).filter((e) => e !== "servico");
const alternar = (xs: string[], x: string) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);

const nomeTecnica = (x: Tecnica): [string, string] => ({
  xilogravura: [tr("Xilogravura", "Woodcut"), tr("Talhos, massas chapadas e contorno grosso.", "Carved marks, flat masses and a thick outline.")],
  reticula: [tr("Retícula", "Halftone"), tr("Pontos de impressão aparentes, em duas tintas.", "Visible print dots, in two inks.")],
  nanquim: [tr("Nanquim", "Ink"), tr("Traço preto e sombra em hachura.", "Black line and hatched shading.")],
  referencia: [tr("Só a imagem da marca", "Brand image only"), tr("Segue a imagem de referência da aba Marca. Sem ela, sai em retícula.", "Follows the reference image in the Brand tab. Without one, it comes out in halftone.")],
})[x] as [string, string];
export const nomePasso = (p: PassoReels): [string, string] => (p === 0.8 ? [tr("Mais rápido", "Faster"), tr("Para quem já conhece o assunto.", "For readers who know the story.")] : p === 1 ? [tr("Normal", "Normal"), tr("O tempo de ler cada card.", "Time to read each card.")] : [tr("Mais calmo", "Slower"), tr("Sobra tempo em cada card.", "Extra time on each card.")]);
export const nomeMovimento = (m: MovimentoReels): [string, string] => (m === "manchete" ? [tr("Manchete", "Headline"), tr("Título, depois as frases, uma a uma.", "Headline, then the sentences, one at a time.")] : m === "folha" ? [tr("Folha", "Sheet"), tr("O card seguinte entra deslizando.", "The next card slides in.")] : [tr("Seco", "Cut"), tr("Corte direto entre os cards.", "A straight cut between cards.")]);

function Radios<T extends string | number>({ rotulo, nome, opcoes, valor, mudar, texto, className = "" }: { rotulo: string; nome: string; opcoes: readonly T[]; valor: T; mudar: (v: T) => void; texto: (v: T) => [string, string?]; className?: string }) {
  return (
    <div role="radiogroup" aria-label={rotulo} className={`grid gap-1 ${className}`}>
      <span className="text-[15px] font-bold text-texto-forte">{rotulo}</span>
      {opcoes.map((v) => {
        const [titulo, ajuda] = texto(v);
        return (
          <label key={v} className={`flex cursor-pointer items-start gap-3 rounded-btn px-3 py-2 ${valor === v ? "bg-papel-2" : "hover:bg-papel-2/60"}`}>
            <input type="radio" name={nome} value={v} checked={valor === v} onChange={() => mudar(v)} className="mt-1 size-[18px] accent-texto-forte" />
            <span className="grid"><b className="text-texto-forte">{titulo}</b>{ajuda && <span className="ajuda">{ajuda}</span>}</span>
          </label>
        );
      })}
    </div>
  );
}

function Marcas({ rotulo, opcoes, marcadas, mudar, texto }: { rotulo: string; opcoes: readonly string[]; marcadas: string[]; mudar: (xs: string[]) => void; texto: (v: string) => string }) {
  return (
    <fieldset className="m-0 grid gap-1 border-0 p-0">
      <legend className="p-0 text-[15px] font-bold text-texto-forte">{rotulo}</legend>
      <div className="flex flex-wrap gap-x-4">
        {opcoes.map((v) => (
          <label key={v} className="flex min-h-11 cursor-pointer items-center gap-2">
            <input type="checkbox" checked={marcadas.includes(v)} onChange={() => mudar(alternar(marcadas, v))} className="size-[18px] accent-texto-forte" />
            {texto(v)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const Subtitulo = ({ children }: { children: string }) => <h4 className="mono m-0 mt-2 text-[12px] font-normal tracking-[.08em] text-apoio uppercase">{children}</h4>;
const listaOu = (xs: string[], vazio: string) => (xs.length ? xs.join(", ") : vazio);

/** O formulário em grupos, um aberto por vez (`?grupo=`): "como o modelo é" e, à parte, "quando ele vale". Fechado, cada grupo diz a escolha atual. */
function Formulario({ tenantId, inicial, fechar, mudouPrevia, previaCelular }: { tenantId: string; inicial: Rascunho; fechar: () => void; mudouPrevia: (p: ParamsEstilo | null) => void; previaCelular: string | null }) {
  const qc = useQueryClient();
  const [r, setR] = useState(inicial);
  const params = (p: Partial<ParamsEstilo>) => setR((x) => ({ ...x, params: { ...x.params, ...p } }));
  useEffect(() => { mudouPrevia(r.params); }, [r.params, mudouPrevia]);
  const patrocinios = usePatrocinios(tenantId).data?.patrocinios ?? [];
  const palavras = [...new Set(r.palavras.split(",").map((p) => p.trim()).filter(Boolean))];
  const [grupo, abrirGrupo] = useParte("grupo", null);
  const [previaGrande, abrirPrevia] = useParte("previa", null);
  // Campo inválido: fica à vista e com o foco, mesmo se estava num grupo fechado.
  const [invalido, setInvalido] = useState<"nome" | "palavras" | null>(null);
  const campoNome = useRef<HTMLInputElement>(null);
  const campoPalavras = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (invalido === "nome") campoNome.current?.focus();
    if (invalido === "palavras" && grupo === "palavras") campoPalavras.current?.focus();
  }, [invalido, grupo]);
  const salvar = useMutation({
    mutationFn: () => {
      const corpo = { nome: r.nome, params: r.params, padrao: r.padrao, valePara: { editorias: r.editorias, tiposPost: r.tiposPost, palavras } };
      return r.id ? ler(rota[":id"].$put({ param: { tenantId, id: r.id } }, corpoJson(corpo))) : ler(rota.$post({ param: { tenantId } }, corpoJson(corpo)));
    },
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: chaveEstilos(tenantId) }); fechar(); },
  });
  function tentarSalvar() {
    if (!r.nome.trim()) { setInvalido("nome"); return; }
    if (palavras.length > PALAVRAS_MAX) { setInvalido("palavras"); abrirGrupo("palavras"); return; }
    setInvalido(null);
    salvar.mutate();
  }
  const linha = (id: string, rotulo: string, resumo: string, conteudo: ReactNode, tom?: Tom) => (
    <Parte id={`modelo-${id}`} rotulo={rotulo} resumo={resumo} tom={tom} nivel="h5" aberta={grupo === id} alternar={() => abrirGrupo(grupo === id ? null : id)}>{conteudo}</Parte>
  );
  const patrocinador = patrocinios.find((p) => p.id === r.params.patrocinio);
  const semTitulo = "[&>span:first-child]:sr-only";
  return (
    <div className="grid gap-3 border-t border-fio pt-4" onKeyDown={(e) => { if (e.key === "Enter" && e.target instanceof HTMLInputElement) e.preventDefault(); }}>
      <label className="campo">
        <span>{tr("Nome do modelo", "Template name")}</span>
        <input ref={campoNome} className="entrada" maxLength={NOME_ESTILO_MAX} autoComplete="off" value={r.nome} aria-invalid={invalido === "nome" ? true : undefined} aria-describedby={invalido === "nome" ? "m-nome-erro" : undefined}
          onChange={(e) => { setR({ ...r, nome: e.target.value }); if (invalido === "nome") setInvalido(null); }} />
        {invalido === "nome" && <span id="m-nome-erro" role="alert" className="text-[15px] text-terracota">{tr("Dê um nome ao modelo.", "Give the template a name.")}</span>}
      </label>
      <section aria-label={tr("Como o modelo é", "How the template looks")}>
        <Subtitulo>{tr("Como o modelo é", "How it looks")}</Subtitulo>
        {linha("composicao", tr("Composição", "Composition"), NOME_COMPOSICAO(r.params.composicao)[0],
          <Radios className={semTitulo} rotulo={tr("Composição", "Composition")} nome="m-composicao" opcoes={COMPOSICOES} valor={r.params.composicao} mudar={(composicao) => params({ composicao })} texto={NOME_COMPOSICAO} />)}
        {r.params.composicao !== "cartaz" && linha("tecnica", tr("Técnica da ilustração", "Illustration technique"), nomeTecnica(r.params.tecnica)[0],
          <Radios className={semTitulo} rotulo={tr("Técnica da ilustração", "Illustration technique")} nome="m-tecnica" opcoes={TECNICAS} valor={r.params.tecnica} mudar={(tecnica) => params({ tecnica })} texto={nomeTecnica} />)}
        {linha("titulo", tr("Título", "Headline"), NOME_CAIXA(r.params.caixaTitulo),
          <Radios className={semTitulo} rotulo={tr("Título", "Headline")} nome="m-caixa" opcoes={CAIXAS_TITULO} valor={r.params.caixaTitulo} mudar={(caixaTitulo) => params({ caixaTitulo })} texto={(c) => [NOME_CAIXA(c)]} />)}
        {linha("cores", tr("Cores", "Colors"), NOME_PAPEL(r.params.papelCores),
          <Radios className={semTitulo} rotulo={tr("Cores", "Colors")} nome="m-papel" opcoes={PAPEIS_COR} valor={r.params.papelCores} mudar={(papelCores) => params({ papelCores })} texto={(p) => [NOME_PAPEL(p)]} />)}
        {linha("reels", "Reels", `${nomePasso(r.params.reels.passo)[0]} · ${nomeMovimento(r.params.reels.movimento)[0]}`, (
          <>
            <Radios rotulo={tr("Ritmo do Reels", "Reel pace")} nome="m-passo" opcoes={PASSOS_REELS} valor={r.params.reels.passo} mudar={(passo) => params({ reels: { ...r.params.reels, passo } })} texto={nomePasso} />
            <Radios rotulo={tr("Movimento do Reels", "Reel motion")} nome="m-movimento" opcoes={MOVIMENTOS_REELS} valor={r.params.reels.movimento} mudar={(movimento) => params({ reels: { ...r.params.reels, movimento } })} texto={nomeMovimento} />
          </>
        ))}
        {linha("sequencia", tr("Sequência sugerida", "Suggested sequence"), listaOu(r.params.sequencia.map(nomeLayout), tr("nenhuma", "none")), (
          <div className="grid gap-1.5">
            <span className="ajuda">{tr(`Depois da capa, até ${SEQUENCIA_MAX} cards. O redator troca se o conteúdo não servir.`, `After the cover, up to ${SEQUENCIA_MAX} cards. The writer changes it if the content doesn't fit.`)}</span>
            {r.params.sequencia.length > 0 && (
              <ol className="m-0 flex list-none flex-wrap gap-2 p-0">
                {r.params.sequencia.map((l, i) => (
                  <li key={`${l}-${i}`}>
                    <button type="button" className="btn-sec" aria-label={tr(`Tirar ${nomeLayout(l)}, posição ${i + 1}`, `Remove ${nomeLayout(l)}, position ${i + 1}`)} onClick={() => params({ sequencia: r.params.sequencia.filter((_, j) => j !== i) })}>{nomeLayout(l)} ×</button>
                  </li>
                ))}
              </ol>
            )}
            <select className="entrada" aria-label={tr("Acrescentar card à sequência", "Add a card to the sequence")} value="" disabled={r.params.sequencia.length >= SEQUENCIA_MAX}
              onChange={(e) => { if (e.target.value) params({ sequencia: [...r.params.sequencia, e.target.value as LayoutConteudo] }); }}>
              <option value="">{tr("Acrescentar card…", "Add a card…")}</option>
              {LAYOUTS_DE_CONTEUDO.map((l) => <option key={l} value={l}>{nomeLayout(l)}</option>)}
            </select>
          </div>
        ))}
        {patrocinios.length > 0 && linha("patrocinio", tr("Patrocinador na arte", "Sponsor on the art"), patrocinador?.nome ?? tr("sem patrocinador", "no sponsor"), (
          <label className="campo">
            <span className="sr-only">{tr("Patrocinador na arte", "Sponsor on the art")}</span>
            <select className="entrada" value={r.params.patrocinio ?? ""} onChange={(e) => params({ patrocinio: e.target.value || null })} aria-describedby="m-patro-ajuda">
              <option value="">{tr("Sem patrocinador", "No sponsor")}</option>
              {patrocinios.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
            <span id="m-patro-ajuda" className="ajuda">{tr("Só dentro do período. Polícia, publicidade, correção e errata ficam sem faixa.", "Only within the period. Police, ads, updates and corrections carry no band.")}</span>
          </label>
        ))}
      </section>
      <section aria-label={tr("Quando ele vale", "When it applies")}>
        <Subtitulo>{tr("Quando ele vale", "When it applies")}</Subtitulo>
        {linha("editorias", tr("Editorias", "Sections"), listaOu(r.editorias.map((e) => EDITORIA[e]), tr("nenhuma", "none")),
          <Marcas rotulo={tr("Vale para as editorias", "Applies to sections")} opcoes={EDITORIAS_MODELO} marcadas={r.editorias} mudar={(editorias) => setR({ ...r, editorias })} texto={(e) => EDITORIA[e]} />)}
        {linha("tipos", tr("Tipos de post", "Post types"), listaOu(r.tiposPost.map(NOME_TIPO), tr("nenhum", "none")),
          <Marcas rotulo={tr("Vale para os tipos de post", "Applies to post types")} opcoes={TIPOS_POST} marcadas={r.tiposPost} mudar={(tiposPost) => setR({ ...r, tiposPost })} texto={NOME_TIPO} />)}
        {linha("palavras", tr("Palavras", "Words"), listaOu(palavras, tr("nenhuma", "none")), (
          <label className="campo">
            <span>{tr("Vale para as palavras", "Applies to words")}</span>
            <input ref={campoPalavras} className="entrada" autoComplete="off" value={r.palavras} aria-invalid={invalido === "palavras" ? true : undefined} aria-describedby="m-palavras-ajuda"
              onChange={(e) => { setR({ ...r, palavras: e.target.value }); if (invalido === "palavras") setInvalido(null); }} />
            <span id="m-palavras-ajuda" role={invalido === "palavras" ? "alert" : undefined} className={invalido === "palavras" ? "text-[15px] text-terracota" : "ajuda"}>{tr(`Até ${PALAVRAS_MAX}, separadas por vírgula, buscadas no título e no resumo: vaga, urgente.`, `Up to ${PALAVRAS_MAX}, separated by commas, searched in the headline and summary: job, breaking.`)}</span>
          </label>
        ), palavras.length > PALAVRAS_MAX ? "erro" : undefined)}
        <label className="flex min-h-11 cursor-pointer items-center gap-2 border-t border-fio pt-2">
          <input type="checkbox" checked={r.padrao} onChange={() => setR({ ...r, padrao: !r.padrao })} className="size-[18px] accent-texto-forte" />
          {tr("Usar quando nenhum outro modelo servir", "Use when no other template fits")}
        </label>
      </section>
      {/* Salvar sempre à vista: presa acima da navegação do celular e no pé da tela do computador. No celular, a prévia vem aqui. */}
      <div className="sticky bottom-[calc(66px+env(safe-area-inset-bottom))] z-10 -mx-5 flex items-end gap-3 border-t border-fio bg-papel px-5 py-3 lg:bottom-[var(--pe)] lg:mx-0 lg:px-0">
        {previaCelular !== null && <div className={`flex-none ${previaGrande ? "w-[200px]" : "w-[72px]"}`}><PreviaCard html={previaCelular} titulo={tr("Prévia do modelo aberto", "Preview of the open template")} /></div>}
        <div className="grid min-w-0 flex-1 gap-2">
          {salvar.isError && <p role="alert" className="faixa-erro m-0">{(salvar.error as Error).message}</p>}
          <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1">
            <button type="button" className="btn-tinta" disabled={salvar.isPending} onClick={tentarSalvar}>{tr("Salvar o modelo", "Save template")}</button>
            <button type="button" className="btn-sec" onClick={fechar}>{tr("Cancelar", "Cancel")}</button>
            {previaCelular !== null && <button type="button" className="btn-sec" aria-pressed={!!previaGrande} onClick={() => abrirPrevia(previaGrande ? null : "grande")}>{previaGrande ? tr("Prévia menor", "Smaller preview") : tr("Prévia maior", "Larger preview")}</button>}
          </p>
        </div>
      </div>
    </div>
  );
}

export const resumoModelos = (n: number | undefined) => (n === undefined ? "" : n ? tr(`${n} de ${MAX_ESTILOS}`, `${n} of ${MAX_ESTILOS}`) : tr("nenhum", "none"));

/** `mudouPrevia`: os parâmetros do modelo aberto, para a prévia da aba; `null`, sem modelo aberto. */
/** Outro veículo em que a pessoa também é admin: copia o modelo com id novo, sem vínculo e sem o patrocinador. */
function CopiarModelo({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const outros = (useMe().data?.tenants ?? []).filter((v) => v.id !== tenantId && v.papel === "admin");
  const [origem, setOrigem] = useState("");
  const [estiloId, setEstiloId] = useState("");
  const daOrigem = useQuery({ queryKey: chaveEstilos(origem), enabled: !!origem, queryFn: () => ler(rota.$get({ param: { tenantId: origem } })) });
  const copiar = useMutation({
    mutationFn: () => ler(rota.copiar.$post({ param: { tenantId } }, corpoJson({ origem, estiloId }))),
    onSuccess: () => { setEstiloId(""); qc.invalidateQueries({ queryKey: chaveEstilos(tenantId) }); },
  });
  if (!outros.length) return null;
  return (
    <div className="grid gap-2 border-t border-fio pt-4">
      <span className="text-[15px] font-bold text-texto-forte">{tr("Copiar de outro veículo", "Copy from another outlet")}</span>
      <span className="ajuda">{tr("A cópia não fica ligada à original, e o patrocinador não vem junto.", "The copy isn't tied to the original, and the sponsor stays behind.")}</span>
      <label className="campo">
        <span>{tr("Veículo de origem", "Source outlet")}</span>
        <select className="entrada" value={origem} onChange={(e) => { setOrigem(e.target.value); setEstiloId(""); copiar.reset(); }}>
          <option value="">{tr("Escolha…", "Choose…")}</option>
          {outros.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
        </select>
      </label>
      {daOrigem.data && (
        <label className="campo">
          <span>{tr("Modelo a copiar", "Template to copy")}</span>
          <select className="entrada" value={estiloId} onChange={(e) => { setEstiloId(e.target.value); copiar.reset(); }}>
            <option value="">{daOrigem.data.estilos.length ? tr("Escolha…", "Choose…") : tr("Este veículo não tem modelo", "This outlet has no template")}</option>
            {daOrigem.data.estilos.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
        </label>
      )}
      <button type="button" className="btn-sec justify-self-start" disabled={!estiloId || copiar.isPending} onClick={() => copiar.mutate()}>{copiar.isPending ? tr("Copiando…", "Copying…") : tr("Copiar este modelo", "Copy this template")}</button>
      {copiar.isError && <p role="alert" className="faixa-erro m-0">{copiar.error.message}</p>}
      {copiar.isSuccess && <p role="status" className="m-0 text-[15px] text-texto-forte">{tr("Modelo copiado.", "Template copied.")}</p>}
    </div>
  );
}

export function SecaoModelos({ tenantId, admin, mudouPrevia, previaCelular = null }: { tenantId: string; admin: boolean; mudouPrevia: (p: ParamsEstilo | null) => void; previaCelular?: string | null }) {
  const qc = useQueryClient();
  const lista = useEstilos(tenantId);
  // O modelo aberto fica na URL (`?modelo=`): recarregar volta ao mesmo modelo.
  const [params, setParams] = useSearchParams();
  const idAberto = params.get("modelo");
  const abrir = (id: string | null) => setParams((p) => {
    if (id) p.set("modelo", id); else { p.delete("modelo"); p.delete("grupo"); p.delete("previa"); }
    return p;
  }, { replace: true, preventScrollReset: true });
  const arquivar = useMutation({
    mutationFn: (id: string) => ler(rota[":id"].$delete({ param: { tenantId, id } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: chaveEstilos(tenantId) }),
  });
  useEffect(() => () => mudouPrevia(null), [mudouPrevia]);
  const fechar = () => { abrir(null); mudouPrevia(null); };
  if (lista.isPending) return <Carga oque={tr("os modelos", "the templates")} />;
  if (lista.isError) return <FalhaCarga oque={tr("os modelos", "the templates")} tentar={() => lista.refetch()} />;
  const estilos = lista.data.estilos;
  const existente = estilos.find((e) => e.id === idAberto);
  const aberto = !admin ? null : idAberto === "novo" ? NOVO : existente ? deEstilo(existente) : null;
  if (aberto) return <Formulario key={aberto.id ?? "novo"} tenantId={tenantId} inicial={aberto} fechar={fechar} mudouPrevia={mudouPrevia} previaCelular={previaCelular} />;
  return (
    <div className="grid gap-4">
      <p className="ajuda m-0">{tr("A peça nasce no modelo certo: tipo de post, palavras, editoria e, por fim, o padrão. Quem revisa troca em um toque. A peça guarda uma cópia, e mudar o modelo depois não muda o que já nasceu.", "A post starts in the right template: post type, words, section and, last, the default. The reviewer can switch in one tap. The post keeps a copy, so changing the template later doesn't change what's already made.")}</p>
      {estilos.length === 0 && <p className="m-0">{tr("Nenhum modelo ainda. Sem modelo, os posts saem no visual de sempre.", "No templates yet. Without one, posts come out in the usual look.")}</p>}
      {estilos.length > 0 && (
        <ul aria-label={tr("Modelos do veículo", "Outlet templates")} className="m-0 grid list-none gap-0 p-0">
          {estilos.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-fio py-2.5 first:border-t-0">
              <span className="grid min-w-0 flex-1">
                <b className="text-texto-forte">{e.nome}</b>
                <span className="mono text-[13px] text-apoio">{[NOME_COMPOSICAO(e.params.composicao)[0], e.padrao && tr("padrão", "default")].filter(Boolean).join(" · ")}</span>
              </span>
              {admin && (
                <span className="flex gap-2">
                  <button type="button" className="btn-sec" onClick={() => abrir(e.id)} aria-label={tr(`Editar ${e.nome}`, `Edit ${e.nome}`)}>{tr("Editar", "Edit")}</button>
                  <button type="button" className="btn-sec" disabled={arquivar.isPending} onClick={() => arquivar.mutate(e.id)} aria-label={tr(`Arquivar ${e.nome}`, `Archive ${e.nome}`)}>{tr("Arquivar", "Archive")}</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {arquivar.isError && <p role="alert" className="faixa-erro m-0">{(arquivar.error as Error).message}</p>}
      {admin && (
        estilos.length < MAX_ESTILOS
          ? <p className="m-0"><button type="button" className="btn-sec" onClick={() => abrir("novo")}>{tr("Novo modelo", "New template")}</button></p>
          : <p className="ajuda m-0">{tr(`Até ${MAX_ESTILOS} modelos por veículo. Arquive um para criar outro.`, `Up to ${MAX_ESTILOS} templates per outlet. Archive one to create another.`)}</p>
      )}
      {admin && <CopiarModelo tenantId={tenantId} />}
    </div>
  );
}

export const useEstilos = (tenantId: string) => useQuery({ queryKey: chaveEstilos(tenantId), queryFn: () => ler(rota.$get({ param: { tenantId } })) });

type Situacao = { id: string | null; modeloMudou: boolean; marcaMudou: boolean };

/** Na Revisão, junto de Editar os cards: troca o modelo da peça. Repórter só vê. */
export function SeletorModelo({ tenantId, pecaId, versao, modelo, editor, aceitarVersao }: {
  tenantId: string; pecaId: string; versao: number; modelo: Situacao | null; editor: boolean; aceitarVersao: (v: number) => void;
}) {
  const qc = useQueryClient();
  const lista = useEstilos(tenantId);
  const idCampo = useId();
  const aplicar = useMutation({
    mutationFn: (estiloId: string | null) => ler(api.t[":tenantId"].pecas[":id"].estilo.$put({ param: { tenantId, id: pecaId } }, corpoJson({ versao, estiloId }))),
    onSuccess: async (r) => {
      aceitarVersao(r.versao);
      await qc.invalidateQueries({ queryKey: chaves.peca(tenantId, pecaId) });
    },
  });
  const estilos = lista.data?.estilos ?? [];
  if (!modelo || (!estilos.length && !modelo.id)) return null;
  const mudou = modelo.modeloMudou || modelo.marcaMudou;
  return (
    <div className="grid gap-2">
      <div className="campo">
        <label htmlFor={idCampo} className="text-[15px] font-bold text-texto-forte">{tr("Modelo", "Template")}</label>
        <select id={idCampo} className="entrada" value={modelo.id ?? ""} disabled={!editor || aplicar.isPending} onChange={(e) => aplicar.mutate(e.target.value || null)}>
          <option value="">{tr("Sem modelo", "No template")}</option>
          {modelo.id && !estilos.some((e) => e.id === modelo.id) && <option value={modelo.id}>{tr("Modelo arquivado", "Archived template")}</option>}
          {estilos.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
        </select>
      </div>
      {mudou && (
        <p className="faixa-aviso m-0 flex flex-wrap items-center gap-3">
          {modelo.modeloMudou ? tr("Modelo mudou.", "Template changed.") : tr("A marca mudou.", "The brand changed.")}
          {editor && <button type="button" className="btn-sec bg-papel" disabled={aplicar.isPending} onClick={() => aplicar.mutate(modelo.id)}>{tr("Aplicar", "Apply")}</button>}
        </p>
      )}
      {aplicar.isError && <p role="alert" className="faixa-erro m-0">{(aplicar.error as Error).message}</p>}
    </div>
  );
}

export type { Estilo };
