// Edição do carrossel na Revisão (Fase 3, DESIGN.md §5): personalização estruturada, não editor livre. À esquerda a
// lista dos cards (escolher, subir, descer, tirar; adicionar até 10, o convite fica no fim) e a prévia do card escolhido
// no mesmo template do render; à direita o tipo do card (layout), o título, as frases (cada uma presa a um fato da
// pauta, ou, no veículo de autor, "afirmação minha") e a foto própria. Salvar cria versão nova, confere de novo e só
// monta outra vez os cards que mudaram; o que a conferência apontar fica no próprio card e Aprovar espera a correção.
// O card escolhido fica na URL (`?card=`), e só ele mostra as ferramentas: subir, descer e tirar na linha dele, e tipo e
// imagem em linhas com um aberto por vez (`?ferramenta=`). A prova fica à vista: parada ao lado no computador e, no
// celular, na barra presa do Salvar.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { api, corpoArquivo, corpoJson, ErroApi, ler, type Sucesso } from "../api";
import { EncurtarParaCaber } from "./EncurtarParaCaber";
import { OutraIlustracao } from "./OutraIlustracao";
import { OutrasManchetes } from "./OutrasManchetes";
import { useCasca } from "../casca/contexto";
import { IconeFechar, IconeSeta } from "../casca/icones";
import { chaves, type StatusPeca } from "../fila";
import { t as tr } from "../idioma";
import { Parte, useMidia, useParte } from "../kit/Partes";
import { PreviaCard } from "../novo/PreviaCard";
import { htmlCardEdicao, type PreviaPeca } from "../novo/previaEdicao";
import { FotoIlegivel, prepararFoto } from "../novo/foto";
import {
  AUTOR_FOTO_MAX, COM_ROTULO, FOCOS, FOTO_MAX_BYTES, LAYOUTS_DE_CONTEUDO, LIMITES, LITERAIS, MAX_CARDS, MIN_CARDS, NOME_LAYOUT, NOME_LAYOUT_EN, ROTULO_MAX, TIPOS_ORIGEM_FOTO, ehConvite, levaArte, normalizarCards,
  type Card, type CardNormal, type Foco, type Frase, type LayoutConteudo, type TipoOrigemFoto,
} from "../../../src/lib/cards";

const t = api.t[":tenantId"].pecas[":id"];
type PecaCompleta = Sucesso<Awaited<ReturnType<typeof t.$get>>>;
type PreviaApi = PreviaPeca & { modo: string; conviteGenerico: { titulo: string; texto: string } };

const AUTOR = "__autor__";
const novoIdCard = () => `n${Math.random().toString(36).slice(2, 9)}`;

/** Erros da última versão salva, por card (o servidor confere; a tela só mostra). */
type PorCard = Record<string, string[]>;

export default function EdicaoCarrossel({ s, peca, sair, salvou, versaoAtual, abrirNova }: {
  s: StatusPeca; peca: PecaCompleta; sair: () => void; salvou: (versao: number, ok: boolean) => void;
  /** A versão no servidor: maior que `s.versao` = outra pessoa salvou enquanto esta editava. */
  versaoAtual: number; abrirNova: () => void;
}) {
  const { veiculo } = useCasca();
  const qc = useQueryClient();
  const previa = peca.previa as PreviaApi | null;
  const formato = s.formato === "post" ? "post" : "carrossel";
  const conteudo = peca.peca.conteudo as { cards?: Card[] };
  const validacao = peca.peca.validacao as { ok: boolean; porCard?: PorCard; geral?: string[]; en?: { porCard?: PorCard; geral?: string[] } } | null;
  const [cards, setCards] = useState<CardNormal[]>(() => normalizarCards(conteudo.cards));
  const primeiroComErro = cards.findIndex((c) => validacao?.porCard?.[c.id]?.length);
  const [params, setParams] = useSearchParams();
  const pedido = cards.findIndex((c) => c.id === params.get("card"));
  const atual = pedido >= 0 ? pedido : Math.max(0, primeiroComErro);
  // Trocar de card fecha a ferramenta aberta: ela era do card de antes.
  const escolher = (id: string) => setParams((p) => { p.set("card", id); p.delete("ferramenta"); return p; }, { replace: true, preventScrollReset: true });
  // Voltou da conferência com erro: abre no card apontado, mesmo que a URL diga outro.
  useEffect(() => {
    if (primeiroComErro >= 0 && !validacao?.porCard?.[cards[atual]?.id]?.length) escolher(cards[primeiroComErro].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [mudou, setMudou] = useState(false);
  /** Manchete escolhida em "Ver outras manchetes": a da fila acompanha a capa. */
  const [manchete, setManchete] = useState<string | null>(null);
  const [imagens, setImagens] = useState<Record<string, string>>({});
  const autoral = previa?.modo === "autoral";
  const fatos = peca.fatos;
  const porCard: PorCard = mudou ? {} : tr(validacao?.porCard, validacao?.en?.porCard ?? validacao?.porCard) ?? {};
  const geral = mudou ? [] : tr(validacao?.geral, validacao?.en?.geral ?? validacao?.geral) ?? [];
  const [subindoFoto, setSubindoFoto] = useState(false);
  const outraVersao = versaoAtual > s.versao;

  const card = cards[atual] ?? cards[0];
  // "Não cabe" do QA, nos dois idiomas: é o aviso gravado que acende o Encurtar no título.
  const naoCabe = (validacao?.porCard?.[card.id] ?? []).some((m) => /não cabe|doesn't fit/.test(m));
  const mexer = (f: (lista: CardNormal[]) => CardNormal[]) => { setCards((l) => f(l.map((c) => ({ ...c, frases: [...c.frases] })))); setMudou(true); };
  const trocar = (patch: Partial<CardNormal>) => mexer((l) => l.map((c, i) => (i === atual ? { ...c, ...patch } : c)));
  // A foto vai para o card em que foi escolhida, mesmo que a pessoa tenha passado para outro durante o envio.
  const porId = (id: string, patch: Partial<CardNormal>) => mexer((l) => l.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const salvar = useMutation({
    mutationFn: () => ler(t.cards.$put({ param: { tenantId: veiculo.id, id: s.id } }, corpoJson({
      versao: s.versao,
      cards: cards.map(({ id, layout, papel, titulo, frases, imagem, ilustracao, foco, fotoOrigem, cta }) => ({ id, layout, papel, titulo, frases, imagem: imagem ?? null, ilustracao: ilustracao ?? null, foco: foco ?? null, fotoOrigem: fotoOrigem ?? null, cta: cta ?? null })),
      ...(manchete ? { manchete } : {}),
    }))),
    onSuccess: (r) => {
      salvou(r.versao, r.validacao.ok);
      qc.invalidateQueries({ queryKey: chaves.status(veiculo.id, s.id) });
      qc.invalidateQueries({ queryKey: chaves.pecas(veiculo.id) });
    },
  });
  const conflito = salvar.error instanceof ErroApi && salvar.error.status === 409;
  // Foto subida agora precisa dizer quem fez (o servidor confere; aqui é para não deixar a pessoa salvar à toa).
  const semOrigem = cards.findIndex((c) => c.imagem && imagens[c.imagem] && !c.fotoOrigem?.autor.trim());
  const [ferramenta, abrirFerramenta] = useParte("ferramenta", semOrigem === atual ? "imagem" : null);
  const [previaGrande, abrirPrevia] = useParte("previa", null);
  const largo = useMidia("(min-width: 1024px)");

  const html = useMemo(() => (previa && card ? htmlCardEdicao(previa, card, formato, imagens) : ""), [previa, card, formato, imagens]);
  if (!previa || !card) return <p className="faixa-erro m-0">{tr("Não deu para abrir a edição deste post agora.", "Couldn't open the editor for this post right now.")}</p>;
  const nomeLayout = (l: CardNormal["layout"]) => tr(NOME_LAYOUT[l], NOME_LAYOUT_EN[l]);

  const convite = ehConvite(card);
  const qtdConteudo = cards.filter((c) => !ehConvite(c)).length;
  const podeAdicionar = formato === "carrossel" && cards.length < MAX_CARDS;
  const adicionar = () => {
    const fim = cards.findIndex((c) => ehConvite(c));
    const pos = fim < 0 ? cards.length : fim;
    const novo = novoIdCard();
    mexer((l) => [...l.slice(0, pos), { id: novo, layout: "texto", titulo: "", frases: [{ texto: "", fatoId: fatos[0]?.id ?? null }] }, ...l.slice(pos)]);
    escolher(novo);
  };
  const mover = (de: number, para: number) => {
    mexer((l) => { const c = [...l]; [c[de], c[para]] = [c[para], c[de]]; return c; });
    // O card movido continua aberto: sem isto, a seleção ficava na posição e passava para o vizinho.
    const id = cards[de]?.id;
    if (id) setParams((p) => { p.set("card", id); return p; }, { replace: true, preventScrollReset: true });
  };
  const tirar = (i: number) => { const antes = cards[Math.max(0, i - 1)]?.id; mexer((l) => l.filter((_, j) => j !== i)); if (antes) escolher(antes); };
  const ultimoMovel = cards.length - 1 - (cards.length && ehConvite(cards[cards.length - 1]) ? 1 : 0);

  return (
    <section aria-labelledby="ed-titulo" className="pb-10">
      <div className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 id="ed-titulo" className="titulo-tela m-0 text-[28px] leading-[1.1] lg:text-[36px]">{tr("Editar os cards", "Edit the cards")}</h1>
        <p className="mono m-0 text-apoio">{cards.length} {cards.length === 1 ? "card" : "cards"} · {tr("editar não gasta versão de Reescrever", "editing doesn't use up a Rewrite version")}</p>
        <button type="button" onClick={sair} className="btn-sec ml-auto">{tr("Fechar a edição", "Close the editor")}</button>
      </div>

      {outraVersao && !salvar.isPending && (
        <div role="alert" className="faixa-erro mb-4">
          {tr("Outra pessoa salvou uma versão nova deste post enquanto você editava; salvar daqui vai ser recusado.", "Someone else saved a new version of this post while you were editing; saving from here will be refused.")}{" "}
          <button type="button" className="font-bold underline underline-offset-3" onClick={abrirNova}>{tr("Abrir a versão nova", "Open the new version")}</button>{" "}
          {tr("(as suas mudanças daqui se perdem).", "(your changes here will be lost).")}
        </div>
      )}
      {geral.length > 0 && (
        <div role="alert" className="faixa-erro mb-4">
          <b>{tr("A conferência apontou", "The check flagged")}</b>
          <ul className="m-0 mt-1 pl-5">{geral.map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}

      {/* Enquanto salva, nada muda: o que vai para o servidor é o que está na tela. */}
      <fieldset disabled={salvar.isPending} className="m-0 min-w-0 border-0 p-0 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)] lg:gap-10">
        {/* A partir de 1280 px, a lista e a prova lado a lado, paradas ao rolar; entre 1024 e 1279, só a prova fica parada. */}
        <div className="grid min-w-0 grid-cols-1 content-start gap-4 lg:flex lg:flex-col min-[1280px]:sticky min-[1280px]:top-[calc(var(--topo)+24px)] min-[1280px]:grid min-[1280px]:grid-cols-[minmax(0,1fr)_300px] min-[1280px]:self-start">
          <div className="grid min-w-0 grid-cols-1 content-start gap-4">
          <ol aria-label={tr("Cards do post", "Post cards")}className="m-0 grid min-w-0 grid-cols-1 list-none gap-1 p-0">
            {cards.map((c, i) => {
              const erros = porCard[c.id]?.length ?? 0;
              return (
                <li key={c.id} className={`flex min-h-12 flex-wrap items-center gap-1 rounded-btn pr-1 ${i === atual ? "bg-papel-2" : ""}`}>
                  <button type="button" onClick={() => escolher(c.id)} aria-current={i === atual ? "true" : undefined}
                    className="flex min-h-12 min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-btn px-2 text-left min-[1280px]:basis-full">
                    <span className="mono w-5 flex-none text-apoio">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate ${i === atual ? "font-bold text-texto-forte" : "text-texto"}`}>{c.titulo || tr("Sem título", "Untitled")}</span>
                      <span className="mono block text-apoio">{nomeLayout(c.layout)}{c.imagem ? tr(" · foto própria", " · own photo") : ""}</span>
                    </span>
                    {erros > 0 && <span className="mono flex-none rounded-faixa bg-terracota-claro px-2 py-0.5 text-terracota">{tr("corrigir", "fix")}</span>}
                  </button>
                  {formato === "carrossel" && !ehConvite(c) && i === atual && (
                    <span className="ml-auto flex gap-1">
                      <button type="button" onClick={() => mover(i, i - 1)} disabled={i === 0} aria-label={tr(`Subir o card ${i + 1}`, `Move card ${i + 1} up`)}
                        className="grid size-11 cursor-pointer place-items-center rounded-btn hover:bg-papel disabled:cursor-default disabled:text-fio-forte"><IconeSeta className="size-5 rotate-180" /></button>
                      <button type="button" onClick={() => mover(i, i + 1)} disabled={i >= ultimoMovel} aria-label={tr(`Descer o card ${i + 1}`, `Move card ${i + 1} down`)}
                        className="grid size-11 cursor-pointer place-items-center rounded-btn hover:bg-papel disabled:cursor-default disabled:text-fio-forte"><IconeSeta className="size-5" /></button>
                      <button type="button" onClick={() => tirar(i)} disabled={cards.length <= MIN_CARDS || qtdConteudo <= 1} aria-label={tr(`Tirar o card ${i + 1}`, `Remove card ${i + 1}`)}
                        className="grid size-11 cursor-pointer place-items-center rounded-btn text-terracota hover:bg-papel disabled:cursor-default disabled:text-fio-forte"><IconeFechar className="size-5" /></button>
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
          {formato === "carrossel" && (
            <p className="m-0 flex flex-wrap items-center gap-3">
              <button type="button" onClick={adicionar} disabled={!podeAdicionar} className="btn-sec bg-papel-2">{tr("Adicionar card", "Add card")}</button>
              <span className="ajuda">{podeAdicionar ? tr(`Até ${MAX_CARDS} cards; o convite fica sempre no fim.`, `Up to ${MAX_CARDS} cards; the invite card always stays at the end.`) : tr(`O Instagram aceita até ${MAX_CARDS} cards.`, `Instagram accepts up to ${MAX_CARDS} cards.`)}</span>
            </p>
          )}
          </div>
          {largo && (
            <figure className="sticky top-[calc(var(--topo)+24px)] m-0 grid gap-2 self-start min-[1280px]:static">
              <figcaption className="mono text-apoio">{tr(`Prévia do card ${atual + 1} · como vai sair`, `Preview of card ${atual + 1} · how it will look`)}</figcaption>
              <div className="w-[min(100%,300px)]">
                <PreviaCard html={html} titulo={tr(`Prévia do card ${atual + 1}`, `Preview of card ${atual + 1}`)} />
              </div>
            </figure>
          )}
        </div>

        <div className="mt-6 grid min-w-0 grid-cols-1 content-start gap-5 lg:mt-0">
          <h2 className="secao m-0 border-t border-fio-forte">Card {atual + 1} · {nomeLayout(card.layout)}</h2>
          {porCard[card.id]?.length ? (
            <div role="alert" className="faixa-erro">
              <b>{tr("A conferência apontou", "The check flagged")}</b>
              <ul className="m-0 mt-1 pl-5">{porCard[card.id].map((e) => <li key={e}>{e}</li>)}</ul>
            </div>
          ) : null}

          {convite ? (
            <CampoConvite previa={previa} card={card} escolher={(cta) => {
              const c = cta === null ? previa.conviteGenerico : previa.convites.find((x) => x.indice === cta)!;
              trocar({ cta: cta ?? undefined, titulo: c.titulo, frases: [{ texto: c.texto, fatoId: null }] });
            }} />
          ) : (
            <>
              {formato === "carrossel" && (
                <Parte id="ed-tipo" rotulo={tr("Tipo do card", "Card type")} resumo={nomeLayout(card.layout)} nivel="h3" aberta={ferramenta === "tipo"} alternar={() => abrirFerramenta(ferramenta === "tipo" ? null : "tipo")}>
                  <fieldset className="m-0 grid gap-1 border-0 p-0">
                    <legend className="sr-only">{tr("Tipo do card", "Card type")}</legend>
                    <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                      {LAYOUTS_DE_CONTEUDO.map((l) => (
                        <label key={l} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-btn px-2 hover:bg-papel-2">
                          <input type="radio" name="ed-layout" value={l} checked={card.layout === l}
                            onChange={() => trocar({ layout: l as LayoutConteudo, papel: undefined })} className="size-[18px] accent-[var(--color-tinta)]" />
                          <span>{nomeLayout(l)}</span>
                        </label>
                      ))}
                    </div>
                    <p className="ajuda m-0">{AJUDA_LAYOUT()[card.layout as LayoutConteudo]}</p>
                  </fieldset>
                </Parte>
              )}
              <Contado rotulo={card.layout === "numero" ? tr("Número em destaque", "Featured number") : card.layout === "documento" ? tr("Documento ou órgão", "Document or agency") : card.layout === "citacao" ? tr("De quem é a fala", "Who said it") : tr("Título", "Title")}valor={card.titulo} max={LIMITES[card.layout].titulo}>
                <input id="ed-titulo-card" className="entrada" value={card.titulo} onChange={(e) => trocar({ titulo: e.target.value })}
                  maxLength={300} autoCapitalize="sentences" enterKeyHint="next" aria-describedby="ed-titulo-card-conta" />
              </Contado>
              {card.layout === "capa" && <OutrasManchetes tenantId={veiculo.id} pecaId={s.id} versao={s.versao} desatualizada={mudou} escolher={(titulo) => { trocar({ titulo }); setManchete(titulo); }} />}
              {/* A capa antiga com frase passa a ser a capa nova (o papel antigo não leva frase). */}
              {/* O card voltou dizendo que não cabe: o título também se encurta. */}
              {naoCabe && card.layout !== "citacao" && card.layout !== "documento" && <EncurtarParaCaber key={`${card.id}-t`} tenantId={veiculo.id} pecaId={s.id} versao={s.versao} cardId={card.id} frase={null} desatualizada={mudou} escolher={(titulo) => trocar({ titulo })} />}
              <Frases card={card} fatos={fatos} autoral={autoral} mudar={(frases) => trocar(card.papel === "capa" ? { frases, papel: undefined } : { frases })}
                encurtar={(i) => <EncurtarParaCaber key={`${card.id}-${i}`} tenantId={veiculo.id} pecaId={s.id} versao={s.versao} cardId={card.id} frase={i} desatualizada={mudou}
                  escolher={(texto) => trocar({ frases: card.frases.map((x, j) => (j === i ? { ...x, texto } : x)) })} />} />
              <Parte id="ed-imagem" rotulo={tr("Imagem do card", "Card image")} nivel="h3" aberta={ferramenta === "imagem"} alternar={() => abrirFerramenta(ferramenta === "imagem" ? null : "imagem")}
                tom={semOrigem === atual ? "aviso" : undefined}
                resumo={semOrigem === atual ? tr("diga quem fez a foto", "say who took the photo") : card.imagem ? tr("foto enviada", "photo uploaded") : card.ilustracao ? tr("ilustração nova", "new illustration") : levaArte(card, previa.base.composicao) ? tr("ilustração do post", "the post's illustration") : tr("sem imagem", "no image")}>
                <Foto tenantId={veiculo.id} pecaId={s.id} card={card} imagens={{ ...previa.imagens, ...imagens }} ocupado={setSubindoFoto}
                  subiu={(cardId, chave, url) => { setImagens((m) => ({ ...m, [chave]: url })); porId(cardId, { imagem: chave, foco: undefined, fotoOrigem: undefined }); }}
                  mudar={trocar} tirar={() => trocar({ imagem: undefined, foco: undefined, fotoOrigem: undefined })} />
                {!card.imagem && levaArte(card, previa.base.composicao) && (
                  <OutraIlustracao key={`${card.id}-i`} tenantId={veiculo.id} pecaId={s.id} versao={s.versao} cardId={card.id} atual={card.ilustracao ?? null}
                    gerou={(cardId, chave, url) => { setImagens((m) => ({ ...m, [chave]: url })); porId(cardId, { ilustracao: chave }); }}
                    voltar={() => trocar({ ilustracao: undefined })} />
                )}
              </Parte>
            </>
          )}

          {/* Salvar sempre à vista, preso no pé da tela (a Revisão não tem a navegação de baixo). No celular, a prova vem aqui. */}
          <div className="sticky bottom-[var(--pe)] z-10 -mx-5 grid gap-2 border-t border-fio-forte bg-papel px-5 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] lg:mx-0 lg:px-0">
            {conflito && (
              <div role="alert" className="faixa-erro">
                {tr("Outra pessoa salvou este post antes de você.", "Someone else saved this post before you.")}{" "}
                <button type="button" className="font-bold underline underline-offset-3"
                  onClick={() => { abrirNova(); qc.invalidateQueries({ queryKey: chaves.status(veiculo.id, s.id) }); }}>
                  {tr("Abrir a versão nova", "Open the new version")}
                </button>{" "}{tr("(as suas mudanças daqui se perdem).", "(your changes here will be lost).")}
              </div>
            )}
            {salvar.isError && !conflito && <p role="alert" className="m-0 text-[15px] text-terracota">{(salvar.error as Error).message}</p>}
            <div className="flex flex-wrap items-end gap-3">
              {!largo && (
                <div className={`flex-none ${previaGrande ? "w-[200px]" : "w-[72px]"}`}>
                  <PreviaCard html={html} titulo={tr(`Prévia do card ${atual + 1}`, `Preview of card ${atual + 1}`)} />
                </div>
              )}
              <div className="flex min-w-0 flex-[1_1_180px] flex-wrap items-center gap-x-3 gap-y-1">
                <button type="button" onClick={() => salvar.mutate()} disabled={salvar.isPending || !mudou || subindoFoto || semOrigem >= 0} className="btn-tinta min-w-[180px]">
                  {salvar.isPending ? tr("Salvando e conferindo…", "Saving and checking…") : tr("Salvar e conferir", "Save and check")}
                </button>
                {!largo && <button type="button" className="btn-sec" aria-pressed={!!previaGrande} onClick={() => abrirPrevia(previaGrande ? null : "grande")}>{previaGrande ? tr("Prévia menor", "Smaller preview") : tr("Prévia maior", "Larger preview")}</button>}
                <p className="ajuda m-0" role="status">
                {salvar.isPending ? tr("Conferindo com os fatos e montando os cards que mudaram.", "Checking against the facts and rebuilding the cards that changed.")
                  : subindoFoto ? tr("Esperando a foto terminar de subir.", "Waiting for the photo to finish uploading.")
                  : semOrigem >= 0 ? tr(`Diga quem fez a foto do card ${semOrigem + 1}.`, `Say who took the photo on card ${semOrigem + 1}.`)
                  : mudou ? tr("Alterações não salvas.", "Unsaved changes.") : tr("Nada mudou desde a última versão.", "Nothing has changed since the last version.")}
                </p>
              </div>
            </div>
          </div>
        </div>
      </fieldset>
    </section>
  );
}

const AJUDA_LAYOUT = (): Record<LayoutConteudo, string> => ({
  capa: tr("A manchete do post, grande. No carrossel, sem frases.", "The post's headline, large. In a carousel, no sentences."),
  texto: tr("Título e uma ou duas frases.", "A title and one or two sentences."),
  citacao: tr("Uma fala literal da fonte, entre aspas; no título, de quem é a fala.", "A word-for-word quote from the source, in quotation marks; in the title, who said it."),
  numero: tr("Um número grande no título (até 16 caracteres, ex.: 15 dias) e uma frase que o explica.", "A large number in the title (up to 16 characters, e.g.: 15 days) and a sentence that explains it."),
  lista: tr("Título e de 2 a 4 itens curtos.", "A title and 2 to 4 short items."),
  documento: tr("Nome do documento e um trecho copiado do fato, palavra por palavra. Sai em tipo, sem imagem do papel.", "The document's name and a passage copied word for word from the fact. Set in type, with no image of the paper."),
  comparacao: tr("Título e dois lados, cada um com rótulo e valor.", "A title and two sides, each with a label and a value."),
  linha_do_tempo: tr("Título e de 2 a 4 momentos, cada um com a data no rótulo.", "A title and 2 to 4 moments, each with the date in the label."),
});

function Contado({ rotulo, valor, max, children }: { rotulo: string; valor: string; max: number; children: ReactNode }) {
  const passou = valor.length > max;
  return (
    <label className="campo">
      <span className="flex items-baseline justify-between gap-3">{rotulo}
        <span id="ed-titulo-card-conta" className={`mono font-normal ${passou ? "text-terracota" : "text-apoio"}`}>{tr(`${valor.length} de ${max}`, `${valor.length} of ${max}`)}</span>
      </span>
      {children}
    </label>
  );
}

function Frases({ card, fatos, autoral, mudar, encurtar }: { card: CardNormal; fatos: PecaCompleta["fatos"]; autoral: boolean; mudar: (f: Frase[]) => void; encurtar: (frase: number, texto: string) => ReactNode }) {
  const lim = LIMITES[card.layout];
  const set = (i: number, f: Partial<Frase>) => mudar(card.frases.map((x, j) => (j === i ? { ...x, ...f } : x)));
  const nome = card.layout === "lista" ? tr("Item", "Item") : card.layout === "citacao" ? tr("Fala", "Quote") : card.layout === "documento" ? tr("Trecho", "Passage") : card.layout === "comparacao" ? tr("Valor", "Value") : card.layout === "linha_do_tempo" ? tr("Momento", "Moment") : tr("Frase", "Sentence");
  if (card.layout === "capa" && !card.frases.length) {
    return (
      <p className="m-0 flex flex-wrap items-center gap-3">
        <button type="button" className="btn-sec" onClick={() => mudar([{ texto: "", fatoId: fatos[0]?.id ?? null }])}>{tr("Pôr uma frase na capa", "Add a sentence to the cover")}</button>
        <span className="ajuda">{tr("No carrossel a capa costuma ter só a manchete.", "In a carousel the cover usually has only the headline.")}</span>
      </p>
    );
  }
  return (
    <fieldset className="m-0 grid gap-4 border-0 p-0">
      <legend className="mb-1 p-0 text-[15px] font-bold text-texto-forte">{card.layout === "lista" ? tr("Itens", "Items") : tr("Frases", "Sentences")} <span className="mono font-normal text-apoio">{tr(`até ${lim.frasesMax}`, `up to ${lim.frasesMax}`)}</span></legend>
      {card.frases.map((f, i) => {
        const valor = f.autor ? AUTOR : f.fatoId ?? "";
        const idBase = `ed-${card.id}-f${i}`;
        return (
          <div key={i} className="grid gap-2 bg-papel-2 px-3 py-3 rounded-faixa">
            {COM_ROTULO.includes(card.layout) && (
              <label className="campo">
                <span>{card.layout === "linha_do_tempo" ? tr("Data", "Date") : tr("Rótulo", "Label")} {i + 1}</span>
                <input className="entrada bg-papel" value={f.rotulo ?? ""} maxLength={ROTULO_MAX} onChange={(e) => set(i, { rotulo: e.target.value })} />
              </label>
            )}
            <label className="campo">
              <span>{nome} {i + 1}</span>
              <textarea id={idBase} className="entrada resize-y bg-papel" rows={2} value={f.texto} maxLength={600} autoCapitalize="sentences"
                onChange={(e) => set(i, { texto: e.target.value })} />
            </label>
            <label className="campo">
              <span className="text-[14px]">{tr("Presa a", "Tied to")}</span>
              <select className="entrada bg-papel" value={valor} aria-describedby={`${idBase}-trecho`}
                onChange={(e) => set(i, e.target.value === AUTOR ? { autor: true, fatoId: null } : { autor: undefined, fatoId: e.target.value || null })}>
                <option value="">{tr("Nenhum fato (a conferência vai recusar)", "No fact (the check will refuse it)")}</option>
                {fatos.map((x, n) => <option key={x.id} value={x.id}>{tr("Fato", "Fact")} {n + 1}: {x.texto.slice(0, 80)}{x.texto.length > 80 ? "…" : ""}</option>)}
                {autoral && <option value={AUTOR}>{tr("Afirmação minha (eu sou a fonte)", "My own claim (I am the source)")}</option>}
              </select>
              <span id={`${idBase}-trecho`} className="ajuda">
                {f.autor ? tr("Você responde por esta frase; ela não passa pela conferência de números e nomes.", "You answer for this sentence; it skips the check of numbers and names.")
                  : fatos.find((x) => x.id === f.fatoId) ? `${tr("Trecho", "Excerpt")}: “${fatos.find((x) => x.id === f.fatoId)!.texto}”${fatos.find((x) => x.id === f.fatoId)!.fonte ? ` · ${fatos.find((x) => x.id === f.fatoId)!.fonte}` : ""}`
                  : tr("Escolha o fato da fonte que sustenta a frase.", "Choose the fact from the source that supports the sentence.")}
              </span>
            </label>
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
              {!LITERAIS.includes(card.layout) && !f.autor && f.fatoId && <div className="min-w-0 flex-1">{encurtar(i, f.texto)}</div>}
              <button type="button" className="link-acao min-h-11 text-[15px] text-terracota"
                onClick={() => mudar(card.frases.filter((_, j) => j !== i))}>{tr("Tirar", "Remove")} {nome.toLowerCase()} {i + 1}</button>
            </div>
          </div>
        );
      })}
      {card.frases.length < lim.frasesMax && (
        <button type="button" className="btn-sec justify-self-start" onClick={() => mudar([...card.frases, { texto: "", fatoId: fatos[0]?.id ?? null }])}>
          {tr("Acrescentar", "Add")} {nome.toLowerCase()}
        </button>
      )}
    </fieldset>
  );
}

const NOME_FOCO = (): Record<Foco, string> => ({ centro: tr("Centro", "Center"), topo: tr("Topo", "Top"), base: tr("Base", "Bottom"), esquerda: tr("Esquerda", "Left"), direita: tr("Direita", "Right") });
const NOME_ORIGEM = (): Record<TipoOrigemFoto, string> => ({ minha: tr("Foto minha", "My own photo"), equipe: tr("Da equipe do veículo", "From the publication's team"), autorizada: tr("De terceiro, com autorização", "From someone else, with permission") });

function Foto({ tenantId, pecaId, card, imagens, subiu, mudar, tirar, ocupado }: {
  tenantId: string; pecaId: string; card: CardNormal; imagens: Record<string, string>;
  subiu: (cardId: string, chave: string, url: string) => void; mudar: (patch: Partial<CardNormal>) => void; tirar: () => void; ocupado: (sim: boolean) => void;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const campo = useRef<HTMLInputElement>(null);
  const enviar = useMutation({
    mutationFn: async ({ arquivo }: { arquivo: File; cardId: string }) => {
      const pronta = await prepararFoto(arquivo);
      if (pronta.size > FOTO_MAX_BYTES) throw new Error(tr("A foto pode ter até 2 MB.", "The photo can be up to 2 MB."));
      return ler(t.fotos.$post({ param: { tenantId, id: pecaId } }, corpoArquivo(pronta)));
    },
    onSuccess: (r, { cardId }) => { setErro(null); subiu(cardId, r.chave, r.url); },
    onError: (e) => setErro(e instanceof FotoIlegivel ? tr("O navegador não abriu esse arquivo. Mande em JPEG ou PNG.", "The browser couldn't open that file. Send it as JPEG or PNG.") : (e as Error).message),
  });
  useEffect(() => { ocupado(enviar.isPending); }, [enviar.isPending, ocupado]);
  const subindoAqui = enviar.isPending && enviar.variables?.cardId === card.id;
  const escolher = (arquivo: File | undefined) => {
    setErro(null);
    if (!arquivo) return;
    enviar.mutate({ arquivo, cardId: card.id });
  };
  const url = card.imagem ? imagens[card.imagem] : null;
  return (
    <div className="grid gap-2">
      <span className="text-[15px] font-bold text-texto-forte" id="ed-foto-rotulo">{tr("Foto própria", "Own photo")}</span>
      <div className="flex flex-wrap items-center gap-3">
        {url && <img src={url} alt="" className="h-14 w-11 rounded-card bg-papel-2 object-cover" />}
        <label className="btn-sec bg-papel-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-3 has-[:focus-visible]:outline-texto-forte">
          {subindoAqui ? tr("Subindo…", "Uploading…") : card.imagem ? tr("Trocar a foto", "Change the photo") : tr("Subir foto", "Upload photo")}
          <input ref={campo} type="file" accept="image/*" className="sr-only" aria-labelledby="ed-foto-rotulo" aria-describedby="ed-foto-ajuda"
            disabled={enviar.isPending} onChange={(e) => { escolher(e.target.files?.[0]); if (campo.current) campo.current.value = ""; }} />
        </label>
        {card.imagem && <button type="button" className="btn-sec" onClick={tirar}>{tr("Tirar a foto", "Remove the photo")}</button>}
      </div>
      <p id="ed-foto-ajuda" className={`m-0 ${erro ? "text-[15px] text-terracota" : "ajuda"}`} role={erro ? "alert" : undefined}>
        {erro ?? tr("Só foto sua (ou que você pode usar), no lugar da ilustração deste card. A do celular serve: o app reduz antes de enviar e tira a localização.", "Only your own photo (or one you're allowed to use), in place of this card's illustration. A phone photo works: the app shrinks it before sending and removes the location.")}
      </p>
      {card.imagem && (
        <>
          <fieldset className="m-0 grid gap-1 border-0 p-0">
            <legend className="mb-1 p-0 text-[15px] font-bold text-texto-forte">{tr("Enquadramento", "Framing")}</legend>
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
              {FOCOS.map((f) => (
                <label key={f} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-btn px-2 hover:bg-papel-2">
                  <input type="radio" name="ed-foco" value={f} checked={(card.foco ?? "centro") === f} onChange={() => mudar({ foco: f })} className="size-[18px] accent-[var(--color-tinta)]" />
                  <span>{NOME_FOCO()[f]}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="campo">
            <span>{tr("Quem fez a foto", "Who took the photo")}</span>
            <input className="entrada" value={card.fotoOrigem?.autor ?? ""} maxLength={AUTOR_FOTO_MAX} autoCapitalize="words"
              onChange={(e) => mudar({ fotoOrigem: { autor: e.target.value, tipo: card.fotoOrigem?.tipo ?? "minha" } })} />
          </label>
          <label className="campo">
            <span>{tr("De quem é o direito", "Who holds the rights")}</span>
            <select className="entrada" value={card.fotoOrigem?.tipo ?? "minha"} onChange={(e) => mudar({ fotoOrigem: { autor: card.fotoOrigem?.autor ?? "", tipo: e.target.value as TipoOrigemFoto } })}>
              {TIPOS_ORIGEM_FOTO.map((o) => <option key={o} value={o}>{NOME_ORIGEM()[o]}</option>)}
            </select>
            <span className="ajuda">{tr("Fica guardado na peça, como declaração sua. Não aparece no card.", "It's kept with the post, as your statement. It doesn't appear on the card.")}</span>
          </label>
        </>
      )}
    </div>
  );
}

function CampoConvite({ previa, card, escolher }: { previa: PreviaApi; card: CardNormal; escolher: (cta: number | null) => void }) {
  const atual = card.cta ?? (previa.convitePadrao >= 0 ? previa.convitePadrao : null);
  return (
    <div className="grid gap-3">
      <p className="m-0">{tr("O convite é o texto do veículo, o mesmo em todo post; o texto dele muda na aba Marca. Aqui você escolhe qual entra.", "The invite card is the publication's text, the same on every post; you change its text in the Brand tab. Here you choose which one goes in.")}</p>
      {previa.convites.length > 1 ? (
        <fieldset className="m-0 grid gap-1 border-0 p-0">
          <legend className="mb-1 p-0 text-[15px] font-bold text-texto-forte">{tr("Qual convite", "Which invite card")}</legend>
          {previa.convites.map((c) => (
            <label key={c.indice} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-btn px-2 hover:bg-papel-2">
              <input type="radio" name="ed-convite" checked={atual === c.indice} onChange={() => escolher(c.indice)} className="size-[18px] accent-[var(--color-tinta)]" />
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
