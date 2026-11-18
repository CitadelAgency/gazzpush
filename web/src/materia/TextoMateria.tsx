// Aba Texto da Matéria (DESIGN.md §5): um editor só (Tiptap, sem modo editar e modo ler), salvamento automático
// (pausa de 1,5 s na digitação ou ao sair do parágrafo), as marcas da conferência por cima do texto e, ao lado, o
// painel com a contagem por tipo, os filtros (Todos · Sem fonte · Risco) e um cartão por marca. Clicar na marca abre o
// cartão; clicar no cartão leva à frase; F8 e Shift+F8 pulam entre as marcas abertas. O contador no canto diz
// "conferindo" e quantas marcas estão abertas. Só o parágrafo que mudou é conferido de novo, por streaming. A IA
// confere, não escreve: nada do modelo entra no documento. No celular, o painel é a folha de baixo.
// Fase 3: as ações do cartão, os apontamentos do código (conta, aspa, manual), a citação com `@`, o aviso ao colar um
// link, a paleta Ctrl/⌘K, as pessoas e instituições e o checklist de publicação que trava sem a assinatura do editor.
// O revisor de lápis azul (DESIGN.md §10): no computador o painel Marcas é a margem do texto, com cada cartão na altura do
// parágrafo e a pergunta na primeira linha; abaixo de 1180 px e no foco, a pergunta vem logo abaixo do parágrafo.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { EditorContent, useEditor, type Editor, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { blocosDoDoc, substackDoDoc, tituloDaPrimeiraLinha, type No } from "../../../src/lib/doc";
import { acharFala, notasDoTexto, type NotaViva } from "../../../src/lib/revisor";
import { cabecalhoIdioma, corpoJson, ErroApi, ler } from "../api";
import { chaves, hora } from "../fila";
import { t } from "../idioma";
import { VoltaLapis } from "../kit/Lapis";
import { Painel as PainelParte, Parte, useMidia, useParte } from "../kit/Partes";
import { IconeEstado, Marcador, ROTULO_RISCO, ROTULO_TELA, contagemMarcas, type Estado, type EstadoTela } from "../novo/mesa";
import { DetalheMarca, Dossie, Folha, blocosSemFonte, conferirEmStreaming, mensagem, resumoDossie, rota, type Afirmacao, type EstadoMesa, type Evidencia } from "./comum";
import { Apoio, IdDeBloco, Imagem, Marcas, Nota, blocosPorId, chaveMarcas, consultaArroba, consultaAspa, lugaresDasMarcas, textoComPosicoes, type EstadoMarca, type Lugar, type MarcaEditor } from "./extensoes";
import { ListaMargem, NotaSaindo, NotaTexto, NotasDoBloco, OfertaFala, chaveNota, semMovimento, useFalas, useInterruptorNotas, useNotas } from "./Revisor";
import Bancada, { type Ferramenta } from "./Bancada";
import Material, { type AcoesMaterial } from "./Material";
import { PaginaFontes } from "./Escudo";
import {
  AcoesCartao, Checklist, Comandos, DetalheApontamento, FormLink, LinhaOpinioes, MenuArroba, Pessoas, Rotulo, nomeTexto, rotuloNota,
  type Apontamento, type Comando, type Pendencia, type Pessoa,
} from "./Assistente";

type Mudanca = { antes: string | null; depois: string | null };
type EstadoBloco = { estado: "pendente" | "conferido" | "nao_conferido"; erro: string | null };
type Filtro = "todos" | "sem_fonte" | "risco";
type AbaPainel = "marcas" | "dossie" | "ferramentas";
const ESPERA_SALVAR = 1500;
const PALAVRAS_POR_MINUTO = 200;

const porId = (l: { id: string; estado: EstadoBloco["estado"]; erro: string | null }[]) => Object.fromEntries(l.map((b) => [b.id, { estado: b.estado, erro: b.erro }])) as Record<string, EstadoBloco>;

/** O que o editor desenha e o painel lista: as afirmações da conferência e os apontamentos do código. */
type Item = MarcaEditor & { aberta: boolean; afirmacao?: Afirmacao; apontamento?: Apontamento };
/** Fonte presa vale como com evidência; outra apuração que fecha a marca a deixa discreta ("resolvida"). */
const estadoTela = (a: Afirmacao): EstadoMarca =>
  a.apuracao?.tipo === "fonte" ? "com_evidencia" : a.apuracao && !a.aberta ? "resolvida" : a.incerto ? "risco" : a.estado;
const itensDe = (marcas: Afirmacao[], aps: Apontamento[]): Item[] => [
  ...marcas.map((a) => ({ id: a.id, blocoId: a.blocoId, inicio: a.inicio, fim: a.fim, trecho: a.trecho, estado: estadoTela(a), aberta: a.aberta, afirmacao: a })),
  ...aps.map((p) => ({ id: p.id, blocoId: p.blocoId, inicio: p.inicio, fim: p.fim, trecho: p.trecho, estado: p.tipo as EstadoMarca, aberta: p.tipo !== "gravacao", apontamento: p })),
];
const DO_FILTRO: Record<Exclude<Filtro, "todos">, EstadoMarca[]> = { sem_fonte: ["sem_fonte", "aspa"], risco: ["risco", "conta"] };
const noFiltro = (i: Item, f: Filtro) => f === "todos" || (i.aberta && DO_FILTRO[f].includes(i.estado));
/** Marca que chega pelo streaming (sem a apuração da pessoa): aberta pelo que o modelo disse. */
const daLinha = (a: Omit<Afirmacao, "aberta" | "apuracao" | "incerto"> & { incerto?: boolean }): Afirmacao =>
  ({ ...a, incerto: !!a.incerto, aberta: a.estado !== "com_evidencia" || !!a.incerto, apuracao: null }) as Afirmacao;
const reduzido = semMovimento;
/** A marca como o revisor lê: da conferência vale o estado do modelo; a apuração da pessoa já está em `aberta`. */
const paraRevisor = (i: Item) => ({ id: i.id, blocoId: i.blocoId, trecho: i.trecho, estado: i.afirmacao?.estado ?? i.estado, risco: i.afirmacao?.risco, aberta: i.aberta });

export default function TextoMateria({ estado, tenantId, id, slug, podeEditar, admin = false, atualizar, cabeca, recarregar }: {
  estado: EstadoMesa; tenantId: string; id: string; slug: string; podeEditar: boolean;
  /** Admin do veículo: os avisos de função desligada levam à aba Chaves de IA. */
  admin?: boolean;
  atualizar: (d: EstadoMesa) => void; cabeca: (titulo: ReactNode, situacao: ReactNode) => ReactNode; recarregar: () => void;
}) {
  const param = { tenantId, id };
  const qc = useQueryClient();
  const navegar = useNavigate();
  // Duas colunas só de 1180 px para cima: abaixo, com a lateral, a folha ficaria estreita demais para ler.
  const largo = useMidia("(min-width: 1180px)");
  // Foco: só a folha, sem a lateral e sem o painel. Fica na URL. As faixas de erro e o pé com a situação continuam à vista.
  const [params, setParams] = useSearchParams();
  // Material ao lado (`?material=aberto`): de 1180 px para cima, uma coluna à esquerda da folha; abaixo, a folha de baixo.
  // De 1180 a 1535 px a coluna toma o lugar do painel (as notas descem para baixo do parágrafo, como no foco); de 1536 px
  // para cima ficam as três: material, folha e a margem do revisor. Foco e Material se excluem.
  const materialAberto = params.get("material") === "aberto";
  const tresColunas = useMidia("(min-width: 1536px)");
  const colunaMaterial = largo && materialAberto;
  const foco = largo && params.get("foco") === "1" && !materialAberto;
  /** O painel Marcas · Dossiê · Ferramentas está ao lado da folha (fora do foco); sem ele, as marcas vão para a folha de baixo. */
  const largoPainel = largo && !(colunaMaterial && !tresColunas);
  const ferramenta = params.get("ferramenta");
  const abrirFerramenta = (f: string | null) => setParams((p) => {
    if (f) p.set("ferramenta", f); else p.delete("ferramenta");
    p.delete("foco");
    return p;
  }, { replace: true, preventScrollReset: true });
  const mudarFoco = (ligar: boolean) => setParams((p) => {
    if (ligar) { p.set("foco", "1"); p.delete("material"); p.delete("fonte"); } else p.delete("foco");
    return p;
  }, { replace: true, preventScrollReset: true });
  // Foco e a coluna do Material escondem a lateral do app (html[data-sem-lateral], em tokens.css).
  const semLateral = foco || colunaMaterial;
  useEffect(() => {
    if (!semLateral) return;
    document.documentElement.dataset.semLateral = "1";
    return () => { delete document.documentElement.dataset.semLateral; };
  }, [semLateral]);
  // O painel do computador mostra uma coisa de cada vez: Marcas por padrão, que é o que a pessoa veio resolver aqui.
  const abaPainel = (params.get("painel") ?? (ferramenta ? "ferramentas" : "marcas")) as AbaPainel;
  const mudarAba = (a: AbaPainel) => setParams((p) => { p.set("painel", a); return p; }, { replace: true, preventScrollReset: true });
  const irParaFerramenta = (f: Ferramenta) => {
    setParams((p) => { p.set("ferramenta", f); p.set("painel", "ferramentas"); p.delete("foco"); return p; }, { replace: true, preventScrollReset: true });
    window.setTimeout(() => document.getElementById(`parte-ferramenta-${f}`)?.scrollIntoView({ block: "center", behavior: reduzido() ? "auto" : "smooth" }), 80);
  };
  // Título que é a primeira linha foi automático: o campo fica vazio e o título acompanha o texto.
  const tituloDigitado = estado.texto.titulo === tituloDaPrimeiraLinha(estado.texto.doc as No) ? "" : estado.texto.titulo;
  const [titulo, setTitulo] = useState(tituloDigitado);
  const [marcas, setMarcas] = useState<Afirmacao[]>(estado.afirmacoes);
  const [apontamentos, setApontamentos] = useState<Apontamento[]>(estado.apontamentos);
  const [checklist, setChecklist] = useState(false);
  const [cardFontes, setCardFontes] = useState(true);
  const [comandos, setComandos] = useState(false);
  const [linkColado, setLinkColado] = useState<string | null>(null);
  const [arroba, setArroba] = useState({ ativo: 0, fechadaEm: -1 });
  const [blocos, setBlocos] = useState<Record<string, EstadoBloco>>(() => porId(estado.blocos));
  const [editados, setEditados] = useState<Set<string>>(new Set());
  const [ativa, setAtiva] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [situacao, setSituacao] = useState<"salvo" | "sujo" | "salvando" | "conflito" | "erro">("salvo");
  const [salvoEm, setSalvoEm] = useState<string | null>(null);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);
  const [conferindo, setConferindo] = useState(false);
  const [erroConferir, setErroConferir] = useState<string | null>(null);
  const [painel, setPainel] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [devolvendo, setDevolvendo] = useState<null | "confirmar" | { mudancas: Mudanca[] }>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [notasLigadas, mudarNotas] = useInterruptorNotas();
  // Quem não edita não recebe nota, oferta nem interruptor.
  const revisorAtivo = podeEditar && notasLigadas;
  const [acesas, setAcesas] = useState<Map<string, number>>(() => new Map());
  const [falaFechada, setFalaFechada] = useState(-1);
  const [bateu, setBateu] = useState(false);

  // Estado que os temporizadores e o streaming leem sem esperar render.
  const versao = useRef(estado.texto.versao);
  const salvos = useRef(new Map(blocosDoDoc(estado.texto.doc as No).map((b) => [b.id, b.texto])));
  const tituloRef = useRef(tituloDigitado);
  const tituloDoDoc = (doc: No) => tituloRef.current.replace(/\s+/g, " ").trim() || tituloDaPrimeiraLinha(doc);
  const situacaoRef = useRef(situacao);
  situacaoRef.current = situacao;
  const timer = useRef<number | undefined>(undefined);
  const emVoo = useRef<Promise<void> | null>(null);
  // A última falha de salvamento (null quando salvou): "mandar", "devolver", "assinar" e "publicar" não saem com a versão velha.
  const falhaSalvar = useRef<string | null>(null);
  const deNovo = useRef(false);
  const restaurando = useRef(false);
  const conferindoRef = useRef(false);
  const conferirDeNovo = useRef(false);
  const proximaRodada = useRef<string[] | null>(null);
  const blocosNaFila = useRef(new Set<string>());
  const marcasRef = useRef(marcas);
  marcasRef.current = marcas;
  const acesasNaRodada = useRef(0);
  const blocoDoCursor = useRef<string | null>(null);
  const vivas = useRef({ aoEscolher: (_id: string) => {}, pular: (_passo: 1 | -1) => {}, comandos: () => {}, colado: (_url: string) => {}, tecla: (_e: KeyboardEvent): boolean => false });
  const fns = useRef({ aoMudar: (_e: Editor) => {}, aoMoverCursor: (_e: Editor) => {}, salvar: async () => {} });
  /** A pessoa já pôs o cursor no texto nesta visita (o editor nasce com ele no começo, sem ninguém ter posto). */
  const cursorPosto = useRef(false);

  const ed = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2] }, bulletList: false, orderedList: false, listItem: false, listKeymap: false, code: false, codeBlock: false,
        strike: false, underline: false, horizontalRule: false, trailingNode: false,
        link: { openOnClick: false, autolink: true, protocols: ["https", "http"], HTMLAttributes: { rel: "noreferrer", target: null } },
      }),
      IdDeBloco,
      Marcas,
      Nota,
      Imagem,
      Apoio,
    ],
    content: (estado.texto.doc as No).content?.length ? (estado.texto.doc as object) : undefined,   // a folha em branco
    editable: podeEditar,
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: { role: "textbox", "aria-multiline": "true", "aria-label": t("Texto da matéria", "Story text"), "data-vazio": t("Comece a escrever.", "Start writing."), spellcheck: "true", ...(podeEditar ? {} : { "aria-readonly": "true" }) },
    },
    // Pelas funções da render mais recente (o editor é criado uma vez).
    onUpdate: ({ editor }) => fns.current.aoMudar(editor),
    onSelectionUpdate: ({ editor }) => fns.current.aoMoverCursor(editor),
    onFocus: () => { cursorPosto.current = true; },
  }, []);

  // ── salvar ────────────────────────────────────────────────────────────────────────────────────────────────────
  function blocosEditados(editor: Editor) {
    return new Set(blocosDoDoc(editor.getJSON() as No).filter((b) => salvos.current.get(b.id) !== b.texto).map((b) => b.id));
  }
  function agendar() {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { void fns.current.salvar(); }, ESPERA_SALVAR);
  }
  function aoMudar(editor: Editor) {
    if (!podeEditar || situacaoRef.current === "conflito") return;
    setEditados(blocosEditados(editor));
    setSituacao("sujo");
    agendar();
  }
  function blocoAtual(editor: Editor): string | null {
    const $p = editor.state.selection.$from;
    for (let d = $p.depth; d > 0; d--) { const n = $p.node(d); if (n.attrs.id) return n.attrs.id as string; }
    return null;
  }
  function aoMoverCursor(editor: Editor) {
    const agora = blocoAtual(editor);
    const antes = blocoDoCursor.current;
    blocoDoCursor.current = agora;
    // Saiu de um parágrafo mexido: salva já (e o parágrafo vai para a conferência), sem esperar a pausa.
    if (antes && agora !== antes && situacaoRef.current === "sujo" && blocosEditados(editor).has(antes)) {
      window.clearTimeout(timer.current);
      void salvar();
    }
  }

  async function salvar(): Promise<void> {
    if (!ed || !podeEditar || situacaoRef.current === "conflito") return;
    if (emVoo.current) { deNovo.current = true; return emVoo.current; }
    window.clearTimeout(timer.current);
    const doc = ed.getJSON() as No;
    const enviados = blocosDoDoc(doc);
    setSituacao("salvando");
    emVoo.current = (async () => {
      try {
        const d = await ler(rota.$put({ param }, corpoJson({ doc, versao: versao.current, titulo: tituloDoDoc(doc), restaurando: restaurando.current })));
        restaurando.current = false;
        versao.current = d.texto.versao;
        salvos.current = new Map(enviados.map((b) => [b.id, b.texto]));
        const pendentes = new Set(d.blocos.filter((b) => b.estado === "pendente").map((b) => b.id));
        setBlocos(porId(d.blocos));
        // Do servidor, as marcas dos blocos conferidos; dos pendentes, as que já estavam na tela (conferindo).
        setMarcas((ant) => [...d.afirmacoes, ...ant.filter((m) => pendentes.has(m.blocoId))]);
        setApontamentos(d.apontamentos);
        atualizar(d);
        const resta = blocosEditados(ed);
        setEditados(resta);
        const tituloAgora = tituloDoDoc(ed.getJSON() as No);
        setSituacao(resta.size || (tituloAgora && tituloAgora !== d.texto.titulo) ? "sujo" : "salvo");
        setSalvoEm(new Date().toISOString());
        setErroSalvar(null);
        falhaSalvar.current = null;
        if (pendentes.size) void conferir({});
      } catch (e) {
        if (e instanceof ErroApi && e.status === 409) { situacaoRef.current = "conflito"; falhaSalvar.current = e.message; setSituacao("conflito"); setErroSalvar(e.message); return; }
        const msg = mensagem(e, t("Não deu para salvar agora. O texto continua aqui; tentamos de novo na próxima pausa.", "Couldn't save right now. The text is still here; we'll try again at the next pause."));
        situacaoRef.current = "erro";
        falhaSalvar.current = msg;
        setSituacao("erro");
        setErroSalvar(msg);
      } finally {
        emVoo.current = null;
        if (deNovo.current) { deNovo.current = false; void fns.current.salvar(); }
      }
    })();
    return emVoo.current;
  }
  fns.current = { aoMudar, aoMoverCursor, salvar };

  /**
   * Antes de devolver, mandar, assinar ou publicar: o que está na tela salvo. Salvamento que falhou (ou conflito com
   * outra pessoa) interrompe a ação com o motivo: a ação não sai com a versão de antes.
   */
  async function garantirSalvo() {
    while (emVoo.current) await emVoo.current;
    if (situacaoRef.current === "sujo" || situacaoRef.current === "erro") {
      await salvar();
      while (emVoo.current) await emVoo.current;
    }
    if (situacaoRef.current === "conflito" || falhaSalvar.current) throw new Error(falhaSalvar.current ?? t("O texto não foi salvo.", "The text was not saved."));
  }

  /** Volta a um ponto do histórico: o que está na tela vai para o histórico antes, então dá para desfazer. */
  async function restaurar(doc: unknown, tituloAntigo: string) {
    await garantirSalvo();
    if (!ed) return;
    restaurando.current = true;
    tituloRef.current = tituloAntigo;
    setTitulo(tituloAntigo);
    ed.commands.setContent(doc as object, { emitUpdate: false });
    setEditados(blocosEditados(ed));
    situacaoRef.current = "sujo";
    await salvar();
    while (emVoo.current) await emVoo.current;
    if (falhaSalvar.current) throw new Error(falhaSalvar.current);
  }

  // ── conferir ──────────────────────────────────────────────────────────────────────────────────────────────────
  async function conferir(corpo: { todos?: boolean; blocos?: string[]; pular?: string[] }) {
    if (!podeEditar) return;
    if (conferindoRef.current) {
      // Parágrafos pedidos pelo nome não esperam a fila geral: uma conferência geral não refaria os que já estão conferidos.
      if (corpo.blocos) for (const b of corpo.blocos) blocosNaFila.current.add(b);
      else conferirDeNovo.current = true;
      return;
    }
    conferindoRef.current = true;
    setConferindo(true);
    setErroConferir(null);
    acesasNaRodada.current = 0;
    const vistos = new Set<string>();
    // O que falhou nesta conferência (somado às rodadas anteriores dela): a rodada seguinte não repete.
    const falharam = new Set(corpo.pular ?? []);
    try {
      await conferirEmStreaming(tenantId, id, corpo, (l) => {
        if (l.tipo === "bloco") {
          if (l.estado === "nao_conferido") falharam.add(l.blocoId);
          setBlocos((b) => ({ ...b, [l.blocoId]: { estado: l.estado, erro: l.erro } }));
          if (l.estado !== "pendente") {
            vistos.add(l.blocoId);
            acender(l.blocoId, l.afirmacoes);
            setMarcas((ant) => [...ant.filter((m) => m.blocoId !== l.blocoId), ...l.afirmacoes.map(daLinha)]);
          }
        } else if (l.tipo === "fim") {
          const pend = new Set(l.estado.blocos.filter((b) => b.estado === "pendente").map((b) => b.id));
          // O servidor confere por rodadas (um teto de blocos por pedido) e diz quantos ficaram: vem a próxima rodada,
          // que não repete o que falhou nesta (só "Conferir de novo" tenta outra vez).
          if (!corpo.blocos && (l.restantes ?? 0) > 0) proximaRodada.current = [...falharam];
          if (corpo.blocos && (l.restantes ?? 0) > 0) for (const b of corpo.blocos) if (!vistos.has(b)) blocosNaFila.current.add(b);
          setBlocos(porId(l.estado.blocos));
          setMarcas((ant) => [...l.estado.afirmacoes, ...ant.filter((m) => pend.has(m.blocoId))]);
          setApontamentos(l.estado.apontamentos);
          // A versão da tela não volta: só o que não é o texto vai para o cache (dossiê, marcas, conferência).
          if (l.estado.texto.versao >= versao.current) atualizar(l.estado);
        } else setErroConferir(l.erro);
      });
    } catch (e) {
      setErroConferir(mensagem(e));
    } finally {
      conferindoRef.current = false;
      setConferindo(false);
      if (conferirDeNovo.current) { conferirDeNovo.current = false; proximaRodada.current = null; void conferir({}); }
      else if (proximaRodada.current) { const pular = proximaRodada.current; proximaRodada.current = null; void conferir({ pular }); }
      else if (blocosNaFila.current.size) { const b = [...blocosNaFila.current]; blocosNaFila.current.clear(); void conferir({ blocos: b }); }
    }
  }

  /** A frase que estava sem fonte e voltou com evidência acende em verde claro, uma depois da outra. */
  function acender(blocoId: string, novas: Afirmacao[]) {
    if (!revisorAtivo || reduzido()) return;
    const antes = marcasRef.current.filter((m) => m.blocoId === blocoId && m.estado === "sem_fonte" && m.aberta);
    const ganhou = novas.filter((n) => n.estado === "com_evidencia" && !n.incerto && antes.some((a) => a.trecho === n.trecho));
    if (!ganhou.length) return;
    setAcesas((m) => {
      const prox = new Map(m);
      for (const a of ganhou) prox.set(a.id, Math.min(acesasNaRodada.current++, 5));
      return prox;
    });
    window.setTimeout(() => setAcesas((m) => { const prox = new Map(m); for (const a of ganhou) prox.delete(a.id); return prox; }), 3000);
  }

  /** Link novo no dossiê: guarda o estado e confere de novo só os parágrafos que ele pode resolver. */
  function aoFonte(d: EstadoMesa) {
    atualizar(d);
    const b = blocosSemFonte(d);
    if (b.length) void conferir({ blocos: b });
  }

  // ── marcas no editor ──────────────────────────────────────────────────────────────────────────────────────────
  // Outra parte da tela mudou o estado (apuração no cartão, link no dossiê, assinatura): as marcas e os apontamentos
  // vêm do servidor; as dos parágrafos ainda pendentes ficam as da tela.
  useEffect(() => {
    if (estado.texto.versao !== versao.current) return;
    const pend = new Set(estado.blocos.filter((b) => b.estado === "pendente").map((b) => b.id));
    setMarcas((ant) => [...estado.afirmacoes, ...ant.filter((m) => pend.has(m.blocoId) && !estado.afirmacoes.some((x) => x.id === m.id))]);
    setApontamentos(estado.apontamentos);
  }, [estado]);

  const itens = useMemo(() => itensDe(marcas, apontamentos), [marcas, apontamentos]);
  useEffect(() => {
    if (!ed || ed.isDestroyed) return;
    ed.view.dispatch(ed.state.tr.setMeta(chaveMarcas, { marcas: itens, ativa, acesas }));
  }, [ed, itens, ativa, acesas]);

  const lugares: Lugar[] = ed ? lugaresDasMarcas(ed.state.doc, itens) : [];
  const porMarca = useMemo(() => new Map(itens.map((m) => [m.id, m])), [itens]);
  const abertas = lugares.filter((l) => (l.marca as Item).aberta);
  const visiveis = lugares.filter((l) => noFiltro(l.marca as Item, filtro));

  function irPara(idMarca: string, focar = true) {
    if (!ed) return;
    const l = lugaresDasMarcas(ed.state.doc, itens).find((x) => x.marca.id === idMarca);
    setAtiva(idMarca);
    if (largoPainel && abaPainel !== "marcas") mudarAba("marcas");
    if (!l) return;
    ed.chain().setTextSelection({ from: l.de, to: l.ate }).run();
    if (focar) ed.commands.focus();
    const el = ed.view.domAtPos(l.de).node;
    (el instanceof HTMLElement ? el : el.parentElement)?.scrollIntoView({ block: "center", behavior: reduzido() ? "auto" : "smooth" });
  }
  /** Seleciona um pedaço de um bloco (pessoa citada, parágrafo do checklist) e rola até ele. */
  function irParaTrecho(blocoId: string, inicio: number, fim: number) {
    if (!ed) return;
    const b = blocosPorId(ed.state.doc).get(blocoId);
    if (!b) return;
    const tp = textoComPosicoes(b.no, b.pos);
    const de = tp.ini[inicio] ?? b.pos + 1, ate = tp.fim[Math.max(inicio, fim - 1)] ?? de;
    ed.chain().focus().setTextSelection({ from: de, to: ate }).run();
    const el = ed.view.domAtPos(de).node;
    (el instanceof HTMLElement ? el : el.parentElement)?.scrollIntoView({ block: "center", behavior: reduzido() ? "auto" : "smooth" });
  }
  function pular(passo: 1 | -1, f: Filtro = filtro) {
    const lista = f === "todos" ? abertasAgora() : lugaresAgora().filter((l) => noFiltro(l.marca as Item, f));
    if (!lista.length || !ed) return;
    const i = lista.findIndex((l) => l.marca.id === ativa);
    let alvo: Lugar;
    if (i < 0) {
      const cursor = ed.state.selection.from;
      alvo = passo === 1 ? lista.find((l) => l.de > cursor) ?? lista[0] : [...lista].reverse().find((l) => l.ate < cursor) ?? lista[lista.length - 1];
    } else alvo = lista[(i + passo + lista.length) % lista.length];
    irPara(alvo.marca.id);
  }
  const lugaresAgora = () => (ed ? lugaresDasMarcas(ed.state.doc, itens) : []);
  const abertasAgora = () => lugaresAgora().filter((l) => (l.marca as Item).aberta);

  // ── @: citar do dossiê ────────────────────────────────────────────────────────────────────────────────────────
  const consulta = ed && podeEditar && ed.isFocused ? consultaArroba(ed.state) : null;
  const menuAberto = consulta && consulta.de !== arroba.fechadaEm ? consulta : null;
  const norm = (x: string) => x.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const opcoesArroba = menuAberto ? estado.evidencias.filter((e) => norm(`${e.titulo ?? ""} ${e.url}`).includes(norm(menuAberto.busca))).slice(0, 8) : [];
  function citar(e: Evidencia) {
    if (!ed || !menuAberto) return;
    ed.chain().focus().deleteRange({ from: menuAberto.de, to: menuAberto.ate })
      .insertContent([{ type: "nota", attrs: { rotulo: rotuloNota(e), evidencia: e.id } }, { type: "text", text: " " }]).run();
    setArroba({ ativo: 0, fechadaEm: -1 });
  }
  /** Teclas do menu do @ dentro do editor (antes do ProseMirror): setas, Enter/Tab escolhem, Esc fecha. */
  function teclaArroba(e: KeyboardEvent): boolean {
    if (!menuAberto) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { setArroba((a) => ({ ...a, ativo: Math.max(0, Math.min(opcoesArroba.length - 1, a.ativo + (e.key === "ArrowDown" ? 1 : -1))) })); return true; }
    if ((e.key === "Enter" || e.key === "Tab") && opcoesArroba.length) { citar(opcoesArroba[Math.min(arroba.ativo, opcoesArroba.length - 1)]); return true; }
    if (e.key === "Escape") { setArroba({ ativo: 0, fechadaEm: menuAberto.de }); return true; }
    return false;
  }
  const caixaEditor = useRef<HTMLDivElement>(null);
  const posicaoMenu = (pos: number) => {
    if (!ed || !caixaEditor.current) return { topo: 0, esquerda: 0, acima: false };
    const c = ed.view.coordsAtPos(pos);
    const r = caixaEditor.current.getBoundingClientRect();
    // A largura do menu (w-[min(360px,90vw)]), para não vazar a tela. Sem lugar embaixo (pé da folha, navegação, teclado), a oferta da fala abre em cima.
    const largura = Math.min(360, window.innerWidth * .9);
    const acima = c.bottom > (window.visualViewport?.height ?? window.innerHeight) - (largo ? 200 : 300);
    return { topo: (acima ? c.top : c.bottom) - r.top + (acima ? -6 : 6), esquerda: Math.max(0, Math.min(c.left - r.left, r.width - largura)), acima };
  };
  const posMenu = menuAberto ? posicaoMenu(menuAberto.de) : { topo: 0, esquerda: 0, acima: false };

  // ── a fala da gravação ────────────────────────────────────────────────────────────────────────────────────────
  const falas = useFalas(tenantId, id, estado.gravacoes, revisorAtivo);
  const aspa = ed && revisorAtivo && falas.length && ed.isFocused && !menuAberto ? consultaAspa(ed.state) : null;
  const falaAchada = aspa && aspa.de !== falaFechada ? acharFala(aspa.digitado, falas) : null;
  /** Só o resto da fala, literal, e a aspa fechada: o que a pessoa digitou fica como está. */
  function inserirFala() {
    if (!ed || !falaAchada || !aspa) return;
    ed.view.dispatch(ed.state.tr.insertText(falaAchada.resto + aspa.fecha));
    ed.commands.focus();
  }
  /** Tab só é capturado com a oferta à vista. */
  function teclaFala(e: KeyboardEvent): boolean {
    if (!falaAchada || !aspa) return false;
    if (e.key === "Tab" && !e.shiftKey) { inserirFala(); return true; }
    if (e.key === "Escape") { setFalaFechada(aspa.de); return true; }
    return false;
  }

  // Tocar numa marca escolhe (a do celular aparece no contador, que abre a folha): o foco fica no texto.
  vivas.current = {
    aoEscolher: (m) => { setAtiva(m); if (largoPainel) { mudarAba("marcas"); window.setTimeout(() => document.getElementById(`cartao-${m}`)?.scrollIntoView({ block: "nearest" }), 30); } },
    pular: (p) => pular(p),
    comandos: () => setComandos(true),
    colado: (url) => { if (podeEditar && !estado.evidencias.some((e) => e.url === url)) setLinkColado(url); },
    tecla: (e) => teclaArroba(e) || teclaFala(e),
  };

  // Clique numa marca e F8 dentro do editor (eventos da extensão Marcas).
  useEffect(() => {
    if (!ed) return;
    const dom = ed.view.dom;
    const escolher = (e: Event) => vivas.current.aoEscolher((e as CustomEvent<string>).detail);
    const pularEv = (e: Event) => vivas.current.pular((e as CustomEvent<1 | -1>).detail);
    const cmd = () => vivas.current.comandos();
    const colado = (e: Event) => vivas.current.colado((e as CustomEvent<string>).detail);
    // O menu do @ pega as setas, Enter, Tab e Esc antes do editor.
    const tecla = (e: KeyboardEvent) => { if (vivas.current.tecla(e)) { e.preventDefault(); e.stopPropagation(); } };
    dom.addEventListener("marca-escolher", escolher);
    dom.addEventListener("marca-pular", pularEv);
    dom.addEventListener("comandos", cmd);
    dom.addEventListener("link-colado", colado);
    dom.addEventListener("keydown", tecla, true);
    return () => {
      dom.removeEventListener("marca-escolher", escolher); dom.removeEventListener("marca-pular", pularEv); dom.removeEventListener("comandos", cmd);
      dom.removeEventListener("link-colado", colado); dom.removeEventListener("keydown", tecla, true);
    };
  }, [ed]);
  // F8 e Ctrl/⌘K com o foco fora do editor (no painel, por exemplo).
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.(".ProseMirror")) return;
      if (e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); vivas.current.comandos(); return; }
      if (e.key !== "F8") return;
      e.preventDefault();
      vivas.current.pular(e.shiftKey ? -1 : 1);
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, []);
  // Sair com alteração não salva: o navegador avisa; trocar de tela salva o que der.
  useEffect(() => {
    const antes = (e: BeforeUnloadEvent) => { if (situacaoRef.current === "sujo" || situacaoRef.current === "salvando") e.preventDefault(); };
    window.addEventListener("beforeunload", antes);
    return () => { window.removeEventListener("beforeunload", antes); window.clearTimeout(timer.current); if (situacaoRef.current === "sujo") void fns.current.salvar(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── saídas ────────────────────────────────────────────────────────────────────────────────────────────────────
  const devolver = useMutation({
    mutationFn: async () => { await garantirSalvo(); return ler(rota.devolver.$post({ param }, corpoJson({ versao: versao.current }))); },
    onSuccess: (d) => { atualizar(d); setDevolvendo(null); setAviso(t(`Devolvido ao Google Docs: ${d.devolvidos === 1 ? "1 parágrafo" : `${d.devolvidos} parágrafos`}.`, `Sent back to Google Docs: ${d.devolvidos === 1 ? "1 paragraph" : `${d.devolvidos} paragraphs`}.`)); },
    onError: (e) => { if (e instanceof ErroApi && e.codigo === "mudou_no_docs") setDevolvendo({ mudancas: (e.dados as { mudancas?: Mudanca[] } | undefined)?.mudancas ?? [] }); },
  });
  const reimportar = useMutation({
    mutationFn: () => ler(rota.reimportar.$post({ param }, corpoJson({ versao: versao.current }))),
    onSuccess: (d) => { atualizar(d); recarregar(); },
  });
  const instagram = useMutation({
    mutationFn: async () => { await garantirSalvo(); return ler(rota.instagram.$post({ param }, corpoJson({ cardFontes: !!estado.paginaFontes && cardFontes }))); },
    onError: (e) => { if (e instanceof ErroApi && e.codigo === "checklist") setChecklist(true); },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: chaves.pautas(tenantId) });
      qc.invalidateQueries({ queryKey: chaves.pecas(tenantId) });
      navegar(r.pecaId ? `/t/${slug}/p/${r.pecaId}` : `/t/${slug}`);
    },
  });
  const assinar = useMutation({
    mutationFn: async () => { await garantirSalvo(); return ler(rota.assinar.$post({ param }, corpoJson({ versao: versao.current }))); },
    onSuccess: (d) => { atualizar(d); instagram.reset(); },
  });
  const pegarColado = useMutation({
    mutationFn: (url: string) => ler(rota.evidencias.$post({ param }, corpoJson({ url }))),
    onSuccess: (d) => { setLinkColado(null); aoFonte(d); },
  });
  const copiar = useMutation({
    mutationFn: async () => {
      const doc = ed!.getJSON() as No;
      const { html, texto } = substackDoDoc(tituloDoDoc(doc), doc);
      await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([texto], { type: "text/plain" }) })]);
    },
    onSuccess: () => setAviso(t("Copiado com a formatação. Cole no editor do Substack.", "Copied with formatting. Paste it into the Substack editor.")),
  });

  // ── o que a tela mostra ───────────────────────────────────────────────────────────────────────────────────────
  const listaBlocos = ed ? blocosDoDoc(ed.getJSON() as No) : [];
  const naoConferidos = listaBlocos.filter((b) => b.texto.trim() && !editados.has(b.id) && blocos[b.id]?.estado === "nao_conferido");
  // Conferido com aviso (a segunda opinião não respondeu): aparece no painel mesmo sem marca de risco no parágrafo.
  const avisosServidor = new Map(estado.blocos.filter((b) => b.aviso).map((b) => [b.id, b.aviso!]));
  const comAviso = listaBlocos.filter((b) => b.texto.trim() && !editados.has(b.id) && blocos[b.id]?.estado === "conferido" && avisosServidor.has(b.id))
    .map((b) => ({ ...b, aviso: avisosServidor.get(b.id)! }));
  const porConferir = listaBlocos.filter((b) => b.texto.trim() && (editados.has(b.id) || !blocos[b.id] || blocos[b.id].estado === "pendente")).length;
  const nPendencias = estado.checklist.pendencias.length;
  const nada = !conferindo && !editados.size && listaBlocos.every((b) => !b.texto.trim() || !blocos[b.id] || blocos[b.id].estado === "pendente") && !marcas.length;
  const ocupado = devolver.isPending || instagram.isPending || reimportar.isPending;

  // ── o revisor ─────────────────────────────────────────────────────────────────────────────────────────────────
  const alvoNotas = notasDoTexto(lugares.map((l) => paraRevisor(l.marca as Item)));
  const { vivas: notas, anuncio } = useNotas({
    ativo: revisorAtivo, alvo: alvoNotas,
    existem: new Set(listaBlocos.filter((b) => b.texto.trim()).map((b) => b.id)),
    // Sem conferência válida agora, nada muda: "sem nota" ali seria afirmar uma conferência que não rodou.
    espera: new Set(listaBlocos.filter((b) => editados.has(b.id) || blocos[b.id]?.estado !== "conferido").map((b) => b.id)),
    cursor: ed?.isFocused ? blocoAtual(ed) : null,
  });
  const notaAberta = notas.some((n) => n.fase !== "risca");
  // No computador a nota mora no cartão da margem; abaixo de 1180 px, no foco e com o Material no lugar do painel, logo abaixo do parágrafo.
  const naMargem = largoPainel && !foco;
  const hosts = useRef(new Map<string, HTMLElement>());
  const hostDaNota = (blocoId: string) => {
    let h = hosts.current.get(blocoId);
    if (!h) { h = document.createElement("div"); h.className = "nota-bloco"; hosts.current.set(blocoId, h); }
    return h;
  };
  const blocosComNota = naMargem ? [] : [...new Set(notas.map((n) => n.blocoId))];
  useEffect(() => {
    if (!ed || ed.isDestroyed) return;
    ed.view.dispatch(ed.state.tr.setMeta(chaveMarcas, { notas: blocosComNota.map((blocoId) => ({ blocoId, host: hostDaNota(blocoId) })) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ed, blocosComNota.join()]);
  /** Clicar na nota é clicar na marca: abre o cartão com as ações. Nota sem marca à vista (parágrafo mexido) leva ao parágrafo. */
  function abrirNota(n: NotaViva) {
    if (!lugaresAgora().some((l) => l.marca.id === n.marcaId)) { irParaTrecho(n.blocoId, 0, 0); return; }
    setAtiva(n.marcaId);
    if (!largoPainel) { setPainel(true); return; }
    setParams((p) => { p.set("painel", "marcas"); p.delete("foco"); return p; }, { replace: true, preventScrollReset: true });
    window.setTimeout(() => document.getElementById(`cartao-${n.marcaId}`)?.scrollIntoView({ block: "nearest" }), 60);
  }
  const palavras = listaBlocos.reduce((n, b) => n + (b.texto.match(/\S+/g)?.length ?? 0), 0);
  const minutos = Math.max(1, Math.ceil(palavras / PALAVRAS_POR_MINUTO));
  const paginaFontes = <PaginaFontes tenantId={tenantId} textoId={id} estado={estado} editor={podeEditar} versao={() => versao.current} garantirSalvo={garantirSalvo} atualizar={atualizar} abrirChecklist={() => setChecklist(true)} />;
  const bancada = podeEditar ? (
    <Bancada tenantId={tenantId} textoId={id} estado={estado} aberta={ferramenta} abrir={abrirFerramenta} garantirSalvo={garantirSalvo} irParaTrecho={irParaTrecho} restaurar={restaurar}
      inserirAspa={(s) => ed?.chain().focus().insertContent(`“${s}” `).run()}
      inserirApoio={(patrocinio, texto) => ed?.chain().focus().insertContent([{ type: "apoio", attrs: { patrocinio, texto } }, { type: "paragraph" }]).run()} />
  ) : null;

  // ── material ao lado ──────────────────────────────────────────────────────────────────────────────────────────
  // No celular a folha do Material é modal: ao fechar, o navegador devolve o foco ao texto e pode pôr o cursor no começo.
  // Por isso a seleção é guardada ao abrir, e Inserir a devolve antes de pôr o trecho.
  const selecaoAntes = useRef<{ de: number; ate: number } | null>(null);
  function abrirMaterial(o: { fonte?: string; buscar?: boolean } = {}) {
    selecaoAntes.current = ed && cursorPosto.current ? { de: ed.state.selection.from, ate: ed.state.selection.to } : null;
    setParams((p) => { p.set("material", "aberto"); p.delete("foco"); if (o.fonte) p.set("fonte", o.fonte); return p; }, { replace: true, preventScrollReset: true });
    if (o.buscar) window.setTimeout(() => document.getElementById("material-busca")?.focus(), 80);
  }
  /** `manterFonte`: no celular, inserir fecha a folha e reabrir volta ao mesmo leitor. */
  const fecharMaterial = (manterFonte = false) => setParams((p) => { p.delete("material"); if (!manterFonte) p.delete("fonte"); return p; }, { replace: true, preventScrollReset: true });
  function inserirDoMaterial(conteudo: JSONContent[]) {
    if (!ed || ed.isDestroyed || !podeEditar || !conteudo.length) return;
    // Quem abriu o texto e foi direto à fonte ainda não pôs o cursor: o trecho entra no fim do texto, não colado no começo
    // da primeira linha (onde o editor nasce).
    const noFim = (): JSONContent[] => (ed.state.doc.lastChild?.isTextblock && ed.state.doc.lastChild.textContent ? [{ type: "text", text: " " }, ...conteudo] : conteudo);
    if (largo) {
      if (cursorPosto.current) ed.chain().focus().insertContent(conteudo).run();
      else ed.chain().focus("end").insertContent(noFim()).run();
      return;
    }
    const s = selecaoAntes.current;
    fecharMaterial(true);
    // Depois que a folha fecha (o navegador devolve o foco ao texto), a seleção guardada volta e o trecho entra nela.
    window.setTimeout(() => {
      if (ed.isDestroyed) return;
      const fim = ed.state.doc.content.size;
      if (s) ed.chain().focus().setTextSelection({ from: Math.min(s.de, fim), to: Math.min(s.ate, fim) }).insertContent(conteudo).run();
      else ed.chain().focus("end").insertContent(noFim()).run();
    }, 40);
  }
  // O Material não renderiza com o texto: recebe estas pontes, que não mudam de identidade entre as teclas.
  const ponteMaterial = useRef({ inserir: inserirDoMaterial, atualizar, aoFonte, fechar: () => fecharMaterial() });
  ponteMaterial.current = { inserir: inserirDoMaterial, atualizar, aoFonte, fechar: () => fecharMaterial() };
  const acoesMaterial = useMemo<AcoesMaterial>(() => ({
    inserir: (c) => ponteMaterial.current.inserir(c), atualizar: (d) => ponteMaterial.current.atualizar(d),
    aoFonte: (d) => ponteMaterial.current.aoFonte(d), fechar: () => ponteMaterial.current.fechar(),
  }), []);
  const material = <Material tenantId={tenantId} textoId={id} estado={estado} podeEditar={podeEditar} folha={!largo} acoes={acoesMaterial} />;
  const lerAoLado = (evidenciaId: string) => abrirMaterial({ fonte: `evidencia:${evidenciaId}` });
  const botaoMaterial = { aberto: materialAberto, alternar: () => (materialAberto ? fecharMaterial() : abrirMaterial()) };

  const linhaSituacao = podeEditar ? (
    <span role="status" className="mono text-apoio">
      {situacao === "salvando" ? t("salvando…", "saving…")
        : situacao === "sujo" ? t("alterações não salvas", "unsaved changes")
          : situacao === "conflito" ? t("não salvo: outra pessoa salvou antes", "not saved: someone else saved first")
            : situacao === "erro" ? t("não salvo", "not saved")
              : salvoEm ? t(`salvo às ${hora(salvoEm)}`, `saved at ${hora(salvoEm)}`) : t("salvo", "saved")}
    </span>
  ) : null;
  const tituloVisto = titulo.trim() || listaBlocos[0]?.texto.slice(0, 120) || t("Sem título", "Untitled");
  const campoTitulo = podeEditar ? (
    <>
      <h1 id="titulo-texto" className="sr-only">{tituloVisto}</h1>
      <label className="mt-2 block">
        <span className="sr-only">{t("Título", "Title")}</span>
        {/* textarea de uma linha que cresce com o título (o título longo quebra como o h1). */}
        <textarea rows={1} value={titulo} maxLength={300} placeholder={t("Título", "Title")} autoFocus={!estado.texto.titulo}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); ed?.commands.focus("start"); } }}
          onChange={(e) => { const v = e.target.value.replace(/\s*\n\s*/g, " "); setTitulo(v); tituloRef.current = v; if (situacaoRef.current !== "conflito") { setSituacao("sujo"); agendar(); } }}
          className="titulo-tela block w-full resize-none border-0 bg-transparent p-0 text-[30px] leading-[1.1] text-texto-forte outline-offset-4 [field-sizing:content] placeholder:text-apoio lg:text-[40px]" />
      </label>
    </>
  ) : <h1 id="titulo-texto" className="titulo-tela m-0 mt-2 text-[30px] leading-[1.1] lg:text-[40px]">{tituloVisto}</h1>;

  const contagem = contagemMarcas(lugares.map((l) => l.marca).filter((m): m is Item & { estado: Estado } => ["com_evidencia", "sem_fonte", "risco"].includes(m.estado)));
  const extras = (["resolvida", "conta", "aspa", "gravacao", "manual"] as const).map((e) => [e, lugares.filter((l) => l.marca.estado === e).length] as const).filter(([, n]) => n > 0);
  const contagemTela = (
    <span className="inline-flex flex-wrap gap-x-3 gap-y-1">
      <Marcador contagem={contagem} />
      {extras.map(([e, n]) => <span key={e} className="mono inline-flex items-center gap-1 text-texto"><IconeEstado estado={e} />{n} {ROTULO_TELA[e]}</span>)}
    </span>
  );
  const blocosPorIdEstado = new Map(estado.blocos.map((b) => [b.id, b]));
  const conferirBloco = (b: string) => void conferir({ blocos: [b] });
  const irParaPessoa = (p: Pessoa) => { irParaTrecho(p.primeira.blocoId, p.primeira.inicio, p.primeira.fim); if (!largoPainel) setPainel(false); };
  const cabecaMarcas = <CabecaMarcas todas={lugares} contagemTela={contagemTela} filtro={filtro} setFiltro={setFiltro} />;
  const painelConteudo = (
    <>
      {!largoPainel && cabecaMarcas}
      <Painel lugares={visiveis} todas={lugares} ativa={ativa} porMarca={porMarca} ed={largoPainel ? ed : null} notas={notas} ordem={new Map(listaBlocos.map((b, i) => [b.id, i]))} filtro={filtro}
        abrirNota={abrirNota} irPara={(m) => { irPara(m, largoPainel); if (!largoPainel) setPainel(false); }} naoConferidos={naoConferidos} comAviso={comAviso} conferirBloco={conferirBloco} podeEditar={podeEditar}
        detalhe={(it) => it.afirmacao ? (
          <>
            <DetalheMarca a={it.afirmacao.apuracao?.tipo === "fonte" ? { ...it.afirmacao, estado: "com_evidencia", evidenciaId: it.afirmacao.apuracao.evidenciaId, evidenciaTrecho: it.afirmacao.apuracao.evidenciaTrecho } : it.afirmacao}
              evidencias={estado.evidencias} curto />
            {(it.afirmacao.estado === "risco" || it.afirmacao.incerto) && <LinhaOpinioes bloco={blocosPorIdEstado.get(it.blocoId)} segunda={estado.segunda} ligar={admin ? `/t/${slug}/veiculo?aba=chaves` : null} />}
            {podeEditar && <AcoesCartao key={it.id} a={it.afirmacao} evidencias={estado.evidencias} tenantId={tenantId} textoId={id} atualizar={atualizar} aoFonte={aoFonte} />}
          </>
        ) : it.apontamento ? <DetalheApontamento p={it.apontamento} podeEditar={podeEditar} tenantId={tenantId} textoId={id} aoAdicionar={aoFonte} /> : null} />
      <Pessoas pessoas={estado.pessoas} irPara={irParaPessoa} naFolha={!largoPainel} />
    </>
  );
  const irParaPendencia = (p: Pendencia) => {
    if (p.tipo === "paragrafo" && p.blocoId) { irParaTrecho(p.blocoId, 0, 0); return; }
    irPara(p.id, largoPainel);
    if (!largoPainel) setPainel(true);
  };
  const blocoDoCursorAgora = ed ? blocoAtual(ed) : null;
  const listaComandos: Comando[] = [
    ...(podeEditar && blocoDoCursorAgora ? [{ id: "conferir", rotulo: t("Conferir este parágrafo", "Check this paragraph"), fazer: () => conferirBloco(blocoDoCursorAgora) }] : []),
    { id: "proxima", rotulo: t("Próxima marca aberta", "Next open mark"), dica: "F8", fazer: () => pular(1, "todos") },
    { id: "sem-fonte", rotulo: t("Próxima marca sem fonte", "Next mark without a source"), fazer: () => { setFiltro("sem_fonte"); pular(1, "sem_fonte"); } },
    { id: "risco", rotulo: t("Próxima marca de risco", "Next risk mark"), fazer: () => { setFiltro("risco"); pular(1, "risco"); } },
    ...(podeEditar ? [
      { id: "citar", rotulo: t("Citar do dossiê", "Cite from the dossier"), dica: "@", fazer: () => { setArroba({ ativo: 0, fechadaEm: -1 }); ed?.chain().focus().insertContent("@").run(); } },
      { id: "link", rotulo: t("Pôr um link no dossiê", "Add a link to the dossier"), fazer: () => setLinkColado("") },
      { id: "aspas", rotulo: t("Inserir aspa da entrevista", "Insert an interview quote"), fazer: () => irParaFerramenta("aspas") },
      { id: "apoio", rotulo: t("Inserir bloco de apoio", "Insert a sponsor block"), fazer: () => irParaFerramenta("apoio") },
      { id: "divulgar", rotulo: t("Sugerir assunto e divulgação", "Suggest subject and promotion"), fazer: () => irParaFerramenta("divulgar") },
      { id: "leitura", rotulo: t("Pedir a segunda leitura", "Ask for a second read"), fazer: () => irParaFerramenta("leitura") },
      { id: "versoes", rotulo: t("Ver as versões do texto", "See the text's versions"), fazer: () => irParaFerramenta("versoes") },
    ] : []),
    ...(largo ? [{ id: "foco", rotulo: foco ? t("Sair do modo foco", "Leave focus mode") : t("Modo foco", "Focus mode"), fazer: () => mudarFoco(!foco) }] : []),
    { id: "checklist", rotulo: t("Ver o checklist de publicação", "See the publication checklist"), fazer: () => setChecklist(true) },
    { id: "material", rotulo: materialAberto ? t("Fechar o material", "Close the material") : t("Abrir o material", "Open the material"), fazer: () => (materialAberto ? fecharMaterial() : abrirMaterial()) },
    { id: "procurar-material", rotulo: t("Procurar no material", "Search the material"), fazer: () => abrirMaterial({ buscar: true }) },
    { id: "pessoas", rotulo: t("Ir para pessoas e instituições", "Go to people and institutions"), fazer: () => { if (largoPainel) mudarAba("marcas"); else setPainel(true); window.setTimeout(() => document.getElementById("pessoas-t")?.scrollIntoView({ block: "start" }), 50); } },
  ];

  // O carimbo: bate uma vez quando a prova fecha na sessão; texto aberto já fechado o mostra pronto. O aviso de uma conferência
  // pela metade (a segunda opinião não respondeu) segura o carimbo: falha não vira aprovação.
  const provaFechada = palavras > 0 && !conferindo && !porConferir && !naoConferidos.length && !comAviso.length && !abertas.length && !nPendencias;
  const fechadaAntes = useRef<boolean | null>(null);
  useLayoutEffect(() => {
    if (!ed) return;
    const antes = fechadaAntes.current;
    fechadaAntes.current = provaFechada;
    if (!provaFechada) setBateu(false);
    else if (antes === false && revisorAtivo && !reduzido()) setBateu(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ed, provaFechada]);

  return (
    // A mesma árvore com e sem a coluna do Material: abrir e fechar não remonta o editor.
    <div className={colunaMaterial ? "grid grid-cols-[360px_minmax(0,1fr)] items-start gap-8" : undefined}>
      {colunaMaterial && (
        // Um segundo documento ao lado, preso, com rolagem própria (como a coluna do Dossiê no painel). Fica abaixo do fólio
        // e acima do pé da moldura: soma --topo e --pe, como todo sticky de tela (DESIGN.md §12).
        <aside aria-labelledby="material-t" className="sticky top-[calc(var(--topo)+12px)] max-h-[calc(100dvh-var(--topo)-var(--pe)-24px)] min-w-0 self-start overflow-y-auto overscroll-contain pr-1 pb-6">{material}</aside>
      )}
      <div className={colunaMaterial ? "min-w-0" : undefined}>
      {cabeca(campoTitulo, linhaSituacao)}
      <div className={foco ? "mx-auto mt-2 grid max-w-[880px]" : largoPainel ? "mt-2 grid gap-8 min-[1180px]:grid-cols-[minmax(0,1fr)_300px] min-[1180px]:gap-8" : "mt-2 grid gap-8"}>
        <article aria-labelledby="titulo-texto" className="min-w-0">
          {/* No celular as ações ficam numa fileira que rola de lado: empilhadas, empurravam o texto para fora da tela. Na folha vazia os botões ficam desligados, e a própria fileira recebe o foco para rolar pelo teclado. */}
          <div role="group" aria-label={t("Ações do texto", "Text actions")} tabIndex={palavras ? undefined : 0} className="-mx-5 mt-2 flex items-center gap-2 overflow-x-auto px-5 py-2 [scrollbar-width:none] *:flex-none lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0 [&::-webkit-scrollbar]:hidden">
            {podeEditar && (
              <button type="button" className="btn-sec bg-papel-2" onClick={() => void conferir(porConferir || naoConferidos.length ? {} : { todos: true })} disabled={conferindo || !palavras}>
                {conferindo ? t("Conferindo…", "Checking…") : porConferir || naoConferidos.length || !palavras ? t("Conferir", "Check") : t("Conferir de novo", "Check again")}
              </button>
            )}
            {podeEditar && estado.podeDevolver && (
              <button type="button" className="btn-sec bg-papel-2" onClick={() => { setDevolvendo("confirmar"); setAviso(null); devolver.reset(); }} disabled={ocupado}>{t("Devolver ao Docs", "Send back to Docs")}</button>
            )}
            {podeEditar && (
              <button type="button" className="acao-lapis cursor-pointer border-0 bg-transparent" onClick={() => instagram.mutate()} disabled={ocupado || !palavras}>
                {/* Com nota aberta, a próxima ação é a nota: o lápis volta aqui quando ela se resolve. */}
                <span>{instagram.isPending ? t("Mandando…", "Sending…") : t("Mandar para o Instagram", "Send to Instagram")}</span>{palavras > 0 && !notaAberta && <VoltaLapis desenhar />}
              </button>
            )}
            <button type="button" className="btn-sec bg-papel-2" onClick={() => copiar.mutate()} disabled={copiar.isPending || !ed || !palavras}>{t("Copiar para o Substack", "Copy for Substack")}</button>
          </div>
          <div className="mt-2 grid gap-1">
            {podeEditar && estado.paginaFontes && (
              <label className="flex items-center gap-2 text-[15px]">
                <input type="checkbox" className="size-4" checked={cardFontes} onChange={(e) => setCardFontes(e.target.checked)} />
                {t("No Instagram, card final “Como apuramos” com o link da página de fontes", "On Instagram, a final “How we reported this” card with the sources page link")}
              </label>
            )}
          </div>

          <div aria-live="polite" className="mt-3 grid gap-2 empty:hidden">
            {aviso && <p role="status" className="m-0 text-[15px] text-verde">{aviso}</p>}
            {situacao === "conflito" && (
              <p role="alert" className="faixa-erro m-0">
                {erroSalvar}{" "}<button type="button" className="link-acao border-0 bg-transparent p-0" onClick={recarregar}>{t("Recarregar a versão nova", "Reload the new version")}</button>
              </p>
            )}
            {situacao === "erro" && erroSalvar && <p role="alert" className="faixa-erro m-0">{erroSalvar}</p>}
            {copiar.isError && <p role="alert" className="faixa-erro m-0">{t("O navegador não deixou copiar. Selecione o texto e copie à mão.", "The browser didn't allow copying. Select the text and copy it by hand.")}</p>}
            {erroConferir && <p role="alert" className="faixa-erro m-0">{erroConferir}</p>}
            {instagram.isError && <p role="alert" className="faixa-erro m-0">{mensagem(instagram.error)}</p>}
            {estado.temaSensivel && (estado.segunda.ligada
              ? <p className="mono m-0 text-apoio">{t(`tema que modelos chineses suavizam: conferido pelo Claude, não pelo ${nomeTexto(estado.provedorTexto)}`, `a topic Chinese models soften: checked by Claude, not ${nomeTexto(estado.provedorTexto)}`)}</p>
              : <p className="faixa-aviso m-0">
                  {t(`Este texto toca em tema que modelos chineses suavizam (China). O segundo fornecedor não está ligado neste veículo: a conferência foi do ${nomeTexto(estado.provedorTexto)}, com uma opinião só.`, `This text touches a topic Chinese models soften (China). The second provider isn't turned on for this outlet: the check was by ${nomeTexto(estado.provedorTexto)}, with only one opinion.`)}
                  {admin && <>{" "}<Link className="link-acao" to={`/t/${slug}/veiculo?aba=chaves`}>{t("Ligar a segunda opinião", "Turn on the second opinion")}</Link></>}
                </p>)}
            {linkColado !== null && (linkColado ? (
              <div role="status" className="grid gap-2 rounded-card bg-branco p-3 shadow-curta">
                <p className="m-0 text-[15px]">{t("Adicionar ao dossiê?", "Add to the dossier?")} <span className="mono break-all text-apoio">{linkColado}</span></p>
                {pegarColado.isError && <p role="alert" className="m-0 text-[15px] text-terracota">{mensagem(pegarColado.error)}</p>}
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-sec bg-papel-2" onClick={() => pegarColado.mutate(linkColado)} disabled={pegarColado.isPending}>{pegarColado.isPending ? t("Lendo a página…", "Reading the page…") : t("Adicionar", "Add")}</button>
                  <button type="button" className="btn-sec bg-papel-2" onClick={() => { setLinkColado(null); pegarColado.reset(); }}>{t("Agora não", "Not now")}</button>
                </div>
              </div>
            ) : (
              <div className="rounded-card bg-branco p-3 shadow-curta">
                <FormLink tenantId={tenantId} textoId={id} rotulo={t("Link para o dossiê", "Link for the dossier")} cancelar={() => setLinkColado(null)} aoAdicionar={(d) => { setLinkColado(null); aoFonte(d); }} />
              </div>
            ))}
            {estado.evidencias.some((e) => e.mudouEm) && <p className="faixa-aviso m-0">{t("Uma fonte do dossiê mudou desde que você conferiu. Abra a evidência e confira de novo.", "A dossier source changed since you checked. Open the evidence and check again.")}</p>}
          </div>

          {checklist && (
            <Checklist checklist={estado.checklist} podeEditar={podeEditar} assinar={() => assinar.mutate()} assinando={assinar.isPending} erro={assinar.error}
              irPara={irParaPendencia} fechar={() => setChecklist(false)} />
          )}
          {devolvendo === "confirmar" && (
            <section aria-labelledby="devolver-t" className="mt-4 grid gap-3 rounded-card bg-branco p-4 shadow-curta">
              <h2 id="devolver-t" className="m-0 text-[18px]">{t("Devolver ao Google Docs", "Send back to Google Docs")}</h2>
              <p className="m-0">
                {t("Só os parágrafos que mudaram na mesa são trocados no Docs. Dentro deles, negrito, itálico e links se perdem; tabelas, comentários e sugestões do Docs ficam como estão. Se alguém mexeu no Docs depois da importação, o Google recusa e nada é sobrescrito.",
                  "Only the paragraphs that changed on the desk are replaced in Docs. Inside them, bold, italics and links are lost; tables, comments and suggestions in Docs stay as they are. If someone edited the Doc after the import, Google refuses and nothing is overwritten.")}
              </p>
              {devolver.isError && !(devolver.error instanceof ErroApi && devolver.error.codigo === "mudou_no_docs") && <p role="alert" className="faixa-erro m-0">{mensagem(devolver.error)}</p>}
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-tinta" onClick={() => devolver.mutate()} disabled={devolver.isPending}>{devolver.isPending ? t("Devolvendo…", "Sending back…") : t("Devolver", "Send back")}</button>
                <button type="button" className="btn-sec bg-papel-2" onClick={() => setDevolvendo(null)}>{t("Cancelar", "Cancel")}</button>
              </div>
            </section>
          )}
          {devolvendo && typeof devolvendo === "object" && (
            <section aria-labelledby="mudou-t" role="alert" className="mt-4 grid gap-3 rounded-card bg-branco p-4 shadow-curta">
              <h2 id="mudou-t" className="m-0 text-[18px]">{t("O Docs mudou depois que você importou", "The Doc changed after you imported it")}</h2>
              <p className="m-0">{t("O Google recusou a devolução para não apagar o que mudou lá. O que mudou no Docs:", "Google refused the send-back so it wouldn't erase what changed there. What changed in Docs:")}</p>
              <ul className="m-0 grid list-none gap-2 p-0">
                {devolvendo.mudancas.length ? devolvendo.mudancas.slice(0, 8).map((m, i) => (
                  <li key={i} className="grid gap-0.5 text-[15px]">
                    {m.antes !== null && <span className="text-apoio line-through decoration-fio-forte">{m.antes}</span>}
                    {m.depois !== null && <span>{m.depois}</span>}
                    <span className="mono text-apoio">{m.antes === null ? t("parágrafo novo no Docs", "new paragraph in Docs") : m.depois === null ? t("parágrafo tirado no Docs", "paragraph removed in Docs") : t("parágrafo alterado no Docs", "paragraph changed in Docs")}</span>
                  </li>
                )) : <li className="text-apoio">{t("Mudanças de formatação ou fora do texto (o conteúdo dos parágrafos é o mesmo).", "Formatting changes or changes outside the text (the paragraphs' content is the same).")}</li>}
              </ul>
              <p className="faixa-aviso m-0">{t("Reimportar traz o texto do Docs e as edições feitas aqui na mesa se perdem.", "Reimporting brings in the text from Docs, and the edits made here on the desk are lost.")}</p>
              {reimportar.isError && <p role="alert" className="faixa-erro m-0">{mensagem(reimportar.error)}</p>}
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-sec bg-papel-2" onClick={() => reimportar.mutate()} disabled={reimportar.isPending}>{reimportar.isPending ? t("Reimportando…", "Reimporting…") : t("Reimportar do Docs", "Reimport from Docs")}</button>
                <button type="button" className="btn-sec bg-papel-2" onClick={() => setDevolvendo(null)}>{t("Cancelar", "Cancel")}</button>
              </div>
            </section>
          )}

          <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-fio pt-3">
            {nada ? <span className="mono text-apoio">{t("ainda não conferido nesta versão", "not checked yet in this version")}</span> : contagemTela}
            <span className="flex flex-wrap items-center gap-x-3">
              <button type="button" className="mono cursor-pointer border-0 bg-transparent p-0 text-apoio underline decoration-fio-forte underline-offset-3" aria-expanded={checklist} onClick={() => setChecklist((x) => !x)}>
                {estado.checklist.assinatura ? t("checklist: assinado", "checklist: signed off") : nPendencias ? t(`checklist: ${nPendencias} pendente${nPendencias > 1 ? "s" : ""}`, `checklist: ${nPendencias} open`) : t("checklist: nada pendente", "checklist: nothing open")}
              </button>
              <span className="mono text-apoio">{t("F8: próxima marca · Ctrl/⌘K: comandos · @: cita o dossiê", "F8: next mark · Ctrl/⌘K: commands · @: cites the dossier")}</span>
            </span>
          </div>
          {/* A folha do texto: branca e lisa, sem o papel quadriculado, para a leitura vir primeiro (DESIGN.md §5). */}
          <div className="folha-doc mt-3">
            {podeEditar && ed && <Ferramentas ed={ed} link={link} setLink={setLink} tenantId={tenantId} textoId={id} aspas={() => irParaFerramenta("aspas")} foco={largo ? { ligado: foco, mudar: mudarFoco } : null} notas={{ ligado: notasLigadas, mudar: mudarNotas }} material={botaoMaterial} />}
            {/* Quem só lê não tem formatação, mas lê o material ao lado. */}
            {!podeEditar && ed && (
              <div className="folha-doc-barra flex items-center justify-end">
                <BotaoMaterial {...botaoMaterial} />
              </div>
            )}
            <div ref={caixaEditor} className="editor-materia relative">
              <EditorContent editor={ed} />
              {menuAberto && <MenuArroba id="menu-arroba" opcoes={opcoesArroba} ativo={Math.min(arroba.ativo, Math.max(0, opcoesArroba.length - 1))} escolher={citar} topo={posMenu.topo} esquerda={posMenu.esquerda} />}
              {falaAchada && aspa && <OfertaFala id="oferta-fala" achada={falaAchada} inserir={inserirFala} {...posicaoMenu(aspa.de)} />}
              {blocosComNota.map((b) => createPortal(<NotasDoBloco notas={notas.filter((n) => n.blocoId === b)} abrir={abrirNota} />, hostDaNota(b), b))}
              {/* Anuncia sem tirar o foco: a nota nova e a fala encontrada. */}
              <p aria-live="polite" className="sr-only">{anuncio} {falaAchada ? t(`Fala encontrada na gravação. Tab insere, Esc dispensa.`, `Speech found in the recording. Tab inserts, Esc dismisses.`) : ""}</p>
            </div>
            {/* O pé da folha: tamanho do texto e o contador (conferindo, por conferir, marcas abertas), que abre o painel no celular. */}
            <div className="folha-doc-pe">
              <span className="mono text-apoio">
                {palavras === 1 ? t("1 palavra", "1 word") : t(`${palavras} palavras`, `${palavras} words`)}{palavras > 0 && ` · ${t(`${minutos} min de leitura`, `${minutos} min read`)}`}
              </span>
              <span role="status">{provaFechada && <span className={`carimbo carimbo-prova${bateu ? " carimbo-bate" : ""}`}>{t("Pode publicar", "Ready to publish")}</span>}</span>
            <button type="button" onClick={() => { if (!largoPainel) setPainel(true); else if (foco) mudarFoco(false); else { mudarAba("marcas"); window.setTimeout(() => document.getElementById("painel-marcas")?.focus(), 30); } }}
              className="mono inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-btn border-0 bg-transparent px-1 text-[13px] text-texto">
              <span role="status">
                {conferindo ? t("conferindo…", "checking…") : !palavras ? t("nada para conferir", "nothing to check") : porConferir ? t(`${porConferir} por conferir`, `${porConferir} to check`) : naoConferidos.length ? t(`${naoConferidos.length} não conferido${naoConferidos.length > 1 ? "s" : ""}`, `${naoConferidos.length} not checked`) : t("conferido", "checked")}
              </span>
              <span aria-hidden="true">·</span>
              <span>{abertas.length === 1 ? t("1 marca aberta", "1 open mark") : t(`${abertas.length} marcas abertas`, `${abertas.length} open marks`)}</span>
              {!largoPainel && ativa && porMarca.get(ativa) && (
                <span className="inline-flex items-center gap-1"><span aria-hidden="true">·</span><IconeEstado estado={porMarca.get(ativa)!.estado as EstadoTela} />{t("ver a marca", "see the mark")}</span>
              )}
            </button>
            </div>
          </div>
          {/* A página de fontes vem com o dossiê: em cima, ela jogava o texto uma linha para baixo. */}
          {!largoPainel && <div className="mt-8 grid gap-4">{bancada}{paginaFontes}</div>}
          {!largoPainel && <DossieAbaixo tenantId={tenantId} textoId={id} estado={estado} editor={podeEditar} atualizar={atualizar} aoFonte={aoFonte} lerAoLado={lerAoLado} />}
        </article>

        {largoPainel && !foco && (
          // Com Marcas, a coluna acompanha o texto e só a cabeça fica presa; Dossiê e Ferramentas seguem paradas ao lado.
          <aside aria-label={t("Marcas e dossiê", "Marks and dossier")} className={abaPainel === "marcas" ? "min-w-0 pb-4 lg:px-1" : "grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-6 lg:sticky lg:top-8 lg:max-h-[calc(100vh-4rem)] lg:self-start lg:overflow-y-auto lg:px-1 lg:pb-4"}>
            <div className={abaPainel === "marcas" ? "sticky top-[var(--topo)] z-10 -mx-1 mb-4 grid gap-3 bg-papel px-1 pt-3 pb-3 shadow-[0_1px_0_var(--color-fio)]" : "contents"}>
              <AbasPainel atual={abaPainel} mudar={mudarAba} marcas={abertas.length} evidencias={estado.evidencias.length} tomDossie={resumoDossie(estado).tom} ferramentas={podeEditar} />
              {abaPainel === "marcas" && cabecaMarcas}
            </div>
            <PainelParte id="painel-aba-marcas" aberta={abaPainel === "marcas"} manter className="grid grid-cols-[minmax(0,1fr)] gap-6" aoAlerta={() => mudarAba("marcas")}>{painelConteudo}</PainelParte>
            <PainelParte id="painel-aba-dossie" aberta={abaPainel === "dossie"} manter className="grid grid-cols-[minmax(0,1fr)] gap-4" aoAlerta={() => mudarAba("dossie")}>
              <Dossie tenantId={tenantId} textoId={id} estado={estado} editor={podeEditar} atualizar={atualizar} aoFonte={aoFonte} lerAoLado={lerAoLado} />
              {paginaFontes}
            </PainelParte>
            {podeEditar && <PainelParte id="painel-aba-ferramentas" aberta={abaPainel === "ferramentas"} manter className="grid grid-cols-[minmax(0,1fr)]" aoAlerta={() => mudarAba("ferramentas")}>{bancada}</PainelParte>}
          </aside>
        )}
      </div>
      </div>
      {!largoPainel && painel && <Folha titulo={t("Marcas", "Marks")} fechar={() => setPainel(false)}>{painelConteudo}</Folha>}
      {!largo && materialAberto && <Folha titulo={t("Material", "Material")} fechar={() => fecharMaterial()}>{material}</Folha>}
      {comandos && <Comandos comandos={listaComandos} fechar={() => setComandos(false)} />}
    </div>
  );
}

/** Abre e fecha o Material ao lado. Não pega o foco ao apertar: o cursor do texto fica onde estava. */
function BotaoMaterial({ aberto, alternar }: { aberto: boolean; alternar: () => void }) {
  return (
    <button type="button" aria-pressed={aberto} onMouseDown={(e) => e.preventDefault()} onClick={alternar}
      className={`inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-btn border-0 px-2 text-[15px] ${aberto ? "bg-papel-2 font-bold text-texto-forte" : "bg-transparent text-texto hover:bg-papel-2"}`}>
      {t("Material", "Material")}
    </button>
  );
}

/** Formatação permitida (parágrafo, intertítulo, negrito, itálico, citação, link), imagem, aspas da entrevista e o modo foco. */
function Ferramentas({ ed, link, setLink, tenantId, textoId, aspas, foco, notas, material }: {
  ed: Editor; link: string | null; setLink: (v: string | null) => void; tenantId: string; textoId: string; aspas: () => void;
  foco: { ligado: boolean; mudar: (ligar: boolean) => void } | null; notas: { ligado: boolean; mudar: (ligar: boolean) => void };
  material: { aberto: boolean; alternar: () => void };
}) {
  const [imagem, setImagem] = useState<File | null>(null);
  const [alt, setAlt] = useState("");
  const fecharImagem = () => { setImagem(null); setAlt(""); enviar.reset(); };
  const enviar = useMutation({
    mutationFn: async () => {
      const r = await ler(fetch(`/api/t/${encodeURIComponent(tenantId)}/textos/${encodeURIComponent(textoId)}/imagens`, { method: "POST", headers: { "content-type": imagem!.type, ...cabecalhoIdioma() }, body: imagem }));
      return (r as { src: string }).src;
    },
    onSuccess: (src) => {
      ed.chain().focus().insertContent([{ type: "imagem", attrs: { src, alt: alt.trim() } }, { type: "paragraph" }]).run();
      fecharImagem();
    },
  });
  const botao = (rotulo: string, ativo: boolean, fazer: () => void, conteudo: ReactNode = rotulo) => (
    <button type="button" aria-pressed={ativo} aria-label={rotulo} onMouseDown={(e) => e.preventDefault()} onClick={fazer}
      className={`inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-btn border-0 px-2 text-[15px] ${ativo ? "bg-papel-2 font-bold text-texto-forte" : "bg-transparent text-texto hover:bg-papel-2"}`}>{conteudo}</button>
  );
  function aplicar(e: FormEvent) {
    e.preventDefault();
    const href = (link ?? "").trim();
    if (!/^https?:\/\/\S+$/.test(href)) return;
    ed.chain().focus().extendMarkRange("link").setLink({ href }).run();
    setLink(null);
  }
  // Os botões têm 8 px de lado (não 10) e, no computador, 2 px entre eles (não 4): com o Material e a folha mais estreita
  // da rodada 4, a barra ainda cabe numa linha a 1440 (lateral e painel à vista) e nas três colunas de 1600.
  return (
    <div className="folha-doc-barra grid gap-2">
      <div role="toolbar" aria-label={t("Formatação", "Formatting")} className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none] *:flex-none lg:flex-wrap lg:gap-0.5 lg:overflow-visible [&::-webkit-scrollbar]:hidden">
        {botao(t("Parágrafo", "Paragraph"), ed.isActive("paragraph") && !ed.isActive("blockquote"), () => ed.chain().focus().setParagraph().run())}
        {botao(t("Intertítulo", "Subheading"), ed.isActive("heading", { level: 2 }), () => ed.chain().focus().toggleHeading({ level: 2 }).run())}
        {botao(t("Negrito", "Bold"), ed.isActive("bold"), () => ed.chain().focus().toggleBold().run(), <b aria-hidden="true">N</b>)}
        {botao(t("Itálico", "Italic"), ed.isActive("italic"), () => ed.chain().focus().toggleItalic().run(), <i aria-hidden="true">I</i>)}
        {botao(t("Citação", "Quote"), ed.isActive("blockquote"), () => ed.chain().focus().toggleBlockquote().run())}
        {botao(t("Link", "Link"), ed.isActive("link"), () => setLink(link === null ? String(ed.getAttributes("link").href ?? "https://") : null))}
        <label className="inline-flex min-h-11 cursor-pointer items-center rounded-btn px-2 text-[15px] text-texto hover:bg-papel-2 focus-within:outline-2 focus-within:outline-texto-forte">
          {t("Imagem", "Image")}
          <input type="file" accept="image/jpeg,image/png" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) { enviar.reset(); setImagem(f); } }} />
        </label>
        {botao(t("Aspas", "Quotes"), false, aspas)}
        <span className="flex-1" aria-hidden="true" />
        <BotaoMaterial {...material} />
        {botao(t("Notas", "Notes"), notas.ligado, () => notas.mudar(!notas.ligado))}
        {foco && botao(t("Foco", "Focus"), foco.ligado, () => foco.mudar(!foco.ligado))}
      </div>
      {imagem && (
        <form onSubmit={(e) => { e.preventDefault(); enviar.mutate(); }} className="flex flex-wrap items-end gap-2">
          <label className="campo min-w-[240px] flex-1">
            <span>{t(`Descreva a imagem (${imagem.name})`, `Describe the image (${imagem.name})`)}</span>
            <input className="entrada bg-branco" value={alt} autoFocus required maxLength={300} onChange={(e) => setAlt(e.target.value)} />
          </label>
          <button type="submit" className="btn-sec bg-papel-2" disabled={enviar.isPending}>{enviar.isPending ? t("Enviando…", "Uploading…") : t("Inserir", "Insert")}</button>
          <button type="button" className="btn-sec bg-papel-2" onClick={fecharImagem}>{t("Cancelar", "Cancel")}</button>
          {enviar.isError && <p role="alert" className="faixa-erro m-0 w-full">{mensagem(enviar.error)}</p>}
        </form>
      )}
      {link !== null && (
        <form onSubmit={aplicar} className="flex flex-wrap items-end gap-2">
          <label className="campo min-w-[240px] flex-1">
            <span>{t("Endereço do link", "Link address")}</span>
            <input type="url" inputMode="url" className="entrada bg-branco" value={link} autoFocus onChange={(e) => setLink(e.target.value)} autoCapitalize="none" spellCheck={false} />
          </label>
          <button type="submit" className="btn-sec bg-papel-2">{t("Aplicar", "Apply")}</button>
          {ed.isActive("link") && <button type="button" className="btn-sec bg-papel-2" onClick={() => { ed.chain().focus().unsetLink().run(); setLink(null); }}>{t("Tirar o link", "Remove link")}</button>}
          <button type="button" className="btn-sec bg-papel-2" onClick={() => setLink(null)}>{t("Cancelar", "Cancel")}</button>
        </form>
      )}
    </div>
  );
}

/** As três partes do painel do computador. A contagem fica à vista, e o Dossiê com aviso muda de cor mesmo fechado. */
function AbasPainel({ atual, mudar, marcas, evidencias, tomDossie, ferramentas }: {
  atual: AbaPainel; mudar: (a: AbaPainel) => void; marcas: number; evidencias: number; tomDossie?: "aviso" | "erro"; ferramentas: boolean;
}) {
  const aba = (id: AbaPainel, rotulo: string, n?: number, tom?: "aviso" | "erro") => (
    <button type="button" aria-pressed={atual === id} aria-controls={`painel-aba-${id}`} onClick={() => mudar(id)}
      className={`inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-btn border-0 px-2 text-[15px] ${atual === id ? "bg-branco font-bold text-texto-forte shadow-fio" : "bg-transparent text-texto hover:text-texto-forte"}`}>
      {rotulo}{n !== undefined && <span className={`mono text-[13px] ${tom === "erro" ? "text-terracota" : tom === "aviso" ? "text-ambar" : "text-apoio"}`}>{n}</span>}
    </button>
  );
  return (
    <div role="group" aria-label={t("Partes do painel", "Panel sections")} className="flex gap-0.5 rounded-btn bg-papel-2 p-0.5">
      {aba("marcas", t("Marcas", "Marks"), marcas)}
      {aba("dossie", t("Dossiê", "Dossier"), evidencias, tomDossie)}
      {ferramentas && aba("ferramentas", t("Ferramentas", "Tools"))}
    </div>
  );
}

/** Contagem e filtros: no computador ficam presos no topo da coluna; no celular, no alto da folha. */
function CabecaMarcas({ todas, contagemTela, filtro, setFiltro }: { todas: Lugar[]; contagemTela: ReactNode; filtro: Filtro; setFiltro: (f: Filtro) => void }) {
  if (!todas.length) return null;   // sem marca, contagem e filtros zerados só ocupam lugar
  const conta = (f: Filtro) => todas.filter((l) => noFiltro(l.marca as Item, f)).length;
  const filtros: [Filtro, string, number][] = [
    ["todos", t("Todos", "All"), todas.length],
    ["sem_fonte", t("Sem fonte", "No source"), conta("sem_fonte")],
    ["risco", t("Risco", "Risk"), conta("risco")],
  ];
  return (
    <div className="grid gap-3">
      {contagemTela}
      <div role="group" aria-label={t("Filtrar as marcas", "Filter the marks")} className="flex flex-wrap gap-1">
        {filtros.map(([f, rotulo, n]) => (
          <button key={f} type="button" aria-pressed={filtro === f} onClick={() => setFiltro(f)}
            className={`inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-btn border-0 px-3 text-[15px] ${filtro === f ? "bg-papel-2 font-bold text-texto-forte" : "bg-transparent text-texto hover:bg-papel-2"}`}>
            {rotulo}<span className="mono text-[13px] text-apoio">{n}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Um cartão por marca (o escolhido abre o detalhe e as ações), com a nota do revisor na primeira linha, e os parágrafos não
 * conferidos. Com `ed`, é a margem do computador: cada item na altura do seu parágrafo. Sem ele, a lista da folha do celular.
 */
function Painel({ lugares, todas, ativa, porMarca, ed, notas, ordem, filtro, abrirNota, irPara, naoConferidos, comAviso, conferirBloco, podeEditar, detalhe }: {
  lugares: Lugar[]; todas: Lugar[]; ativa: string | null; porMarca: Map<string, Item>; ed: Editor | null; notas: NotaViva[]; ordem: Map<string, number>; filtro: Filtro;
  abrirNota: (n: NotaViva) => void; irPara: (id: string) => void; naoConferidos: { id: string; texto: string }[]; comAviso: { id: string; texto: string; aviso: string }[];
  conferirBloco: (id: string) => void; podeEditar: boolean; detalhe: (i: Item) => ReactNode;
}) {
  const margem = !!ed;
  const lugar = margem ? "absolute inset-x-0 scroll-mt-48" : "";
  // Nota cuja marca não está à vista (o parágrafo foi mexido, ou a marca mudou) fica sozinha na altura dele: nada pisca.
  const comMarca = new Set(todas.map((l) => l.marca.id));
  const notaDe = new Map(notas.filter((n) => n.fase !== "risca" && comMarca.has(n.marcaId)).map((n) => [n.marcaId, n]));
  const soltas = notas.filter((n) => n.fase === "risca" || !comMarca.has(n.marcaId));
  const linhaDe = (b: string, peso: number) => (ordem.get(b) ?? ordem.size) * 10 + peso;
  const alerta = (b: { id: string; texto: string }, classe: string, frase: ReactNode, chave: string) => ({
    chave, peso: margem ? linhaDe(b.id, 0) : -1, no: (
      <li key={chave} data-bloco={b.id} className={`${lugar} ${classe} grid gap-1.5 text-[15px]`}>
        <span>{frase} “{b.texto.slice(0, 90)}{b.texto.length > 90 ? "…" : ""}”</span>
        {podeEditar && <button type="button" className="link-acao justify-self-start border-0 bg-transparent p-0 text-[15px]" onClick={() => conferirBloco(b.id)}>{t("Conferir de novo", "Check again")}</button>}
      </li>
    ),
  });
  const entradas: { chave: string; peso: number; no: ReactNode }[] = [
    ...naoConferidos.map((b) => alerta(b, "faixa-erro", <><b>{t("Parágrafo não conferido", "Paragraph not checked")}</b>:</>, `erro-${b.id}`)),
    ...comAviso.map((b) => alerta(b, "faixa-aviso", b.aviso, `aviso-${b.id}`)),
    ...soltas.map((n) => ({
      chave: chaveNota(n), peso: linhaDe(n.blocoId, 1), no: (
        <li key={chaveNota(n)} data-bloco={n.blocoId} className={`${lugar} rounded-card bg-branco px-3 shadow-curta`}>
          {n.fase === "risca" ? <NotaSaindo nota={n} /> : <button type="button" className="nota-botao w-full" onClick={() => abrirNota(n)}><NotaTexto nota={n} /></button>}
        </li>
      ),
    })),
    ...lugares.flatMap(({ marca }) => {
      const it = porMarca.get(marca.id);
      if (!it) return [];
      const escolhida = ativa === marca.id;
      const a = it.afirmacao;
      const nota = notaDe.get(marca.id);
      return [{
        chave: marca.id, peso: linhaDe(marca.blocoId, 2), no: (
          <li key={marca.id} id={`cartao-${marca.id}`} data-bloco={marca.blocoId} className={`${lugar} rounded-card bg-branco shadow-curta ${escolhida ? "outline-2 outline-texto-forte" : ""}`}>
            <button type="button" aria-pressed={escolhida} onClick={() => irPara(marca.id)}
              className="grid w-full cursor-pointer gap-1 rounded-card border-0 bg-transparent px-3 py-2.5 text-left">
              {nota && <NotaTexto nota={nota} />}
              <Rotulo estado={it.estado as EstadoTela}>
                {a?.risco ? <span className="text-apoio"> · {ROTULO_RISCO[a.risco] ?? a.risco}</span> : null}
                {a?.incerto && a.aberta ? <span className="text-apoio"> · {t("incerto, confira", "uncertain, check it")}</span> : null}
              </Rotulo>
              <span className="line-clamp-2 text-[15px] text-texto">{/^[“"«]/.test(it.trecho) ? it.trecho : `“${it.trecho}”`}</span>
            </button>
            {escolhida && <div className="grid gap-2.5 border-t border-fio px-3 pt-2.5 pb-3">{detalhe(it)}</div>}
          </li>
        ),
      }];
    }),
  ];
  // Estável: dentro do mesmo parágrafo, os cartões seguem a ordem do texto.
  const itens = entradas.map((e, i) => [e, i] as const).sort(([a, i], [b, j]) => a.peso - b.peso || i - j).map(([e]) => e);
  const nos = itens.map((e) => e.no);
  return (
    <section id="painel-marcas" tabIndex={-1} aria-labelledby="marcas-t" className="grid gap-3 outline-none">
      {/* O título à vista é o da aba, ou o da folha no celular. */}
      <h2 id="marcas-t" className="sr-only">{t("Marcas", "Marks")}</h2>
      {itens.length > 0 && (ed ? <ListaMargem ed={ed} chaves={itens.map((e) => e.chave).join(" ")}>{nos}</ListaMargem> : <ul className="m-0 grid list-none gap-2 p-0">{nos}</ul>)}
      {!lugares.length && <p className="m-0 text-apoio">{filtro === "todos" ? t("Nenhuma marca. Depois da conferência, cada afirmação de fato aparece aqui.", "No marks. After the check, every factual claim shows up here.") : t("Nenhuma marca aberta deste tipo.", "No open marks of this kind.")}</p>}
    </section>
  );
}

/** No celular o dossiê vem depois do texto: uma linha com a contagem, que abre sozinha se houver aviso. */
function DossieAbaixo(props: { tenantId: string; textoId: string; estado: EstadoMesa; editor: boolean; atualizar: (d: EstadoMesa) => void; aoFonte: (d: EstadoMesa) => void; lerAoLado: (evidenciaId: string) => void }) {
  const r = resumoDossie(props.estado);
  const [aberto, abrir] = useParte("dossie", useRef(r.tom ? "aberto" : null).current);
  return (
    <div className="mt-8">
      <Parte id="dossie-texto" nivel="h2" rotulo={t("Dossiê", "Dossier")} resumo={r.texto} tom={r.tom} aberta={aberto === "aberto"} alternar={() => abrir(aberto === "aberto" ? null : "aberto")}>
        <Dossie {...props} emPartes />
      </Parte>
    </div>
  );
}
