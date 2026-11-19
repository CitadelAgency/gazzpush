// The Story's Text tab (DESIGN.md §5): a single editor (Tiptap, no edit mode and read mode), autosave (a 1.5 s pause
// in typing or on leaving the paragraph), the check's marks over the text and, beside it, the panel with the count per
// type, the filters (All · Unsourced · Risk) and one card per mark. Clicking a mark opens its card; clicking a card goes
// to the sentence; F8 and Shift+F8 jump between open marks. The counter in the corner says "checking" and how many marks
// are open. Only the paragraph that changed is checked again, by streaming. The AI checks, it does not write: nothing
// from the model enters the document. On mobile, the panel is the bottom sheet.
// Phase 3: the card's actions, code findings (arithmetic, quote, style guide), citation with `@`, the notice on pasting
// a link, the Ctrl/⌘K palette, people and institutions and the publishing checklist that gates without the editor's signature.
// The blue-pencil reviewer (DESIGN.md §10): on desktop the Marks panel is the text's margin, with each card at its
// paragraph's height and the question on the first line; below 1180 px and in focus mode, the question comes right below
// the paragraph.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { EditorContent, useEditor, type Editor, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { blocksDoc, substackDoc, fromFirstLineTitle, type In } from "../../../src/lib/doc";
import { findSpeech, notesText, type NoteLive } from "../../../src/lib/reviewer";
import { headerLanguage, bodyJson, ApiError, read } from "../api";
import { keys, hour } from "../queue";
import { t } from "../language";
import { BackPencil } from "../kit/Pencil";
import { PanelView as PainelParte, Part, useMedia, usePart } from "../kit/Parts";
import { IconState, Marker, RISK_LABEL, SCREEN_LABEL, countMarks, type State, type ScreenState } from "../onboarding/deskMarks";
import { DetailBrand, Dossier, Sheet, blocksWithoutSource, checkInStreaming, message, summaryDossier, route, type Claim, type DeskState, type Evidence } from "./common";
import { Support, BlockId, ImageFile, Marks, Note, blocksPerId, marksKey, queryHandle, queryQuote, placesMarks, withPositionsText, type BrandState, type Place, type EditorBrand } from "./extensions";
import { MarginList, NoteLeaving, NoteText, NotesBlock, OfferSpeech, noteKey, withoutMotion, useSpeeches, useToggleNotes, useNotes } from "./Reviewer";
import Bench, { type ToolId } from "./Bench";
import Material, { type ActionsMaterial } from "./Material";
import { SourcesPage } from "./Shield";
import {
  ActionsCard, Checklist, Commands, DetailFinding, FormLink, OpinionsLine, MenuHandle, People, Label, textName, noteLabel,
  type Finding, type Command, type Pending, type Person,
} from "./Assistant";

type Change = { antes: string | null; depois: string | null };
type BlockState = { estado: "pendente" | "conferido" | "nao_conferido"; erro: string | null };
type Filter = "todos" | "sem_fonte" | "risco";
type TabPanel = "marcas" | "dossie" | "ferramentas";
const WAIT_SAVE = 1500;
const WORDS_PER_MINUTE = 200;

const perId = (l: { id: string; estado: BlockState["estado"]; erro: string | null }[]) => Object.fromEntries(l.map((b) => [b.id, { estado: b.estado, erro: b.erro }])) as Record<string, BlockState>;

/** What the editor draws and the panel lists: the check's claims and the code findings. */
type Item = EditorBrand & { aberta: boolean; afirmacao?: Claim; apontamento?: Finding };
/** An attached source counts as with evidence; other reporting that closes the mark makes it discreet ("resolvida"). */
const screenState = (a: Claim): BrandState =>
  a.apuracao?.tipo === "fonte" ? "com_evidencia" : a.apuracao && !a.aberta ? "resolvida" : a.incerto ? "risco" : a.estado;
const itemsOf = (marks: Claim[], aps: Finding[]): Item[] => [
  ...marks.map((a) => ({ id: a.id, blocoId: a.blocoId, inicio: a.inicio, fim: a.fim, trecho: a.trecho, estado: screenState(a), aberta: a.aberta, afirmacao: a })),
  ...aps.map((p) => ({ id: p.id, blocoId: p.blocoId, inicio: p.inicio, fim: p.fim, trecho: p.trecho, estado: p.tipo as BrandState, aberta: p.tipo !== "gravacao", apontamento: p })),
];
const FROM_FILTER: Record<Exclude<Filter, "todos">, BrandState[]> = { sem_fonte: ["sem_fonte", "aspa"], risco: ["risco", "conta"] };
const inFilter = (i: Item, f: Filter) => f === "todos" || (i.aberta && FROM_FILTER[f].includes(i.estado));
/** A mark arriving by streaming (without the person's reporting): open per what the model said. */
const fromLine = (a: Omit<Claim, "aberta" | "apuracao" | "incerto"> & { incerto?: boolean }): Claim =>
  ({ ...a, incerto: !!a.incerto, aberta: a.estado !== "com_evidencia" || !!a.incerto, apuracao: null }) as Claim;
const reduced = withoutMotion;
/** The mark as the reviewer reads it: from the check, the model's state counts; the person's reporting is already in `aberta`. */
const toReviewer = (i: Item) => ({ id: i.id, blocoId: i.blocoId, trecho: i.trecho, estado: i.afirmacao?.estado ?? i.estado, risco: i.afirmacao?.risco, aberta: i.aberta });

export default function StoryText({ estado: state, tenantId, id, slug, podeEditar: canEdit, admin = false, atualizar: update, cabeca: head, recarregar: reload }: {
  estado: DeskState; tenantId: string; id: string; slug: string; podeEditar: boolean;
  /** Outlet admin: the feature-off notices lead to the AI keys tab. */
  admin?: boolean;
  atualizar: (d: DeskState) => void; cabeca: (title: ReactNode, status: ReactNode) => ReactNode; recarregar: () => void;
}) {
  const param = { tenantId, id };
  const qc = useQueryClient();
  const navigate = useNavigate();
  // Two columns only from 1180 px up: below that, with the sidebar, the sheet would be too narrow to read.
  const wide = useMedia("(min-width: 1180px)");
  // Focus: only the sheet, without the sidebar and without the panel. It lives in the URL. The error strips and the status footer stay in view.
  const [params, setParams] = useSearchParams();
  // Material on the side (`?material=aberto`): from 1180 px up, a column to the left of the sheet; below, the bottom
  // sheet. From 1180 to 1535 px the column takes the panel's place (notes move below the paragraph, as in focus); from
  // 1536 px up all three stay: material, sheet and the reviewer's margin. Focus and Material exclude each other.
  const materialOpen = params.get("material") === "aberto";
  const threeColumns = useMedia("(min-width: 1536px)");
  const columnMaterial = wide && materialOpen;
  const focus = wide && params.get("foco") === "1" && !materialOpen;
  /** The Marks · Dossier · Tools panel is beside the sheet (outside focus); without it, the marks go to the bottom sheet. */
  const widePanel = wide && !(columnMaterial && !threeColumns);
  const tool = params.get("ferramenta");
  const openTool = (f: string | null) => setParams((p) => {
    if (f) p.set("ferramenta", f); else p.delete("ferramenta");
    p.delete("foco");
    return p;
  }, { replace: true, preventScrollReset: true });
  const changeFocus = (enable: boolean) => setParams((p) => {
    if (enable) { p.set("foco", "1"); p.delete("material"); p.delete("fonte"); } else p.delete("foco");
    return p;
  }, { replace: true, preventScrollReset: true });
  // Focus and the Material column hide the app sidebar (html[data-sem-lateral], in tokens.css).
  const withoutSidebar = focus || columnMaterial;
  useEffect(() => {
    if (!withoutSidebar) return;
    document.documentElement.dataset.semLateral = "1";
    return () => { delete document.documentElement.dataset.semLateral; };
  }, [withoutSidebar]);
  // The desktop panel shows one thing at a time: Marks by default, which is what the person came here to resolve.
  const tabPanel = (params.get("painel") ?? (tool ? "ferramentas" : "marcas")) as TabPanel;
  const changeTab = (a: TabPanel) => setParams((p) => { p.set("painel", a); return p; }, { replace: true, preventScrollReset: true });
  const goToTool = (f: ToolId) => {
    setParams((p) => { p.set("ferramenta", f); p.set("painel", "ferramentas"); p.delete("foco"); return p; }, { replace: true, preventScrollReset: true });
    window.setTimeout(() => document.getElementById(`parte-ferramenta-${f}`)?.scrollIntoView({ block: "center", behavior: reduced() ? "auto" : "smooth" }), 80);
  };
  // A title that is the first line was automatic: the field stays empty and the title follows the text.
  const typedTitle = state.texto.titulo === fromFirstLineTitle(state.texto.doc as In) ? "" : state.texto.titulo;
  const [title, setTitle] = useState(typedTitle);
  const [marks, setMarks] = useState<Claim[]>(state.afirmacoes);
  const [findings, setFindings] = useState<Finding[]>(state.apontamentos);
  const [checklist, setChecklist] = useState(false);
  const [cardSources, setCardSources] = useState(true);
  const [commands, setCommands] = useState(false);
  const [pastedLink, setLinkPasted] = useState<string | null>(null);
  const [handle, setHandle] = useState({ ativo: 0, fechadaEm: -1 });
  const [blocks, setBlocks] = useState<Record<string, BlockState>>(() => perId(state.blocos));
  const [edited, setEdited] = useState<Set<string>>(new Set());
  const [active, activeSet] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("todos");
  const [status, setStatus] = useState<"salvo" | "sujo" | "salvando" | "conflito" | "erro">("salvo");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveError, setErrorSave] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setErrorCheck] = useState<string | null>(null);
  const [panel, setPanel] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [returning, setReturning] = useState<null | "confirmar" | { mudancas: Change[] }>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [notesOn, changeNotes] = useToggleNotes();
  // Whoever does not edit gets no note, offer or switch.
  const activeReviewer = canEdit && notesOn;
  const [lit, setLit] = useState<Map<string, number>>(() => new Map());
  const [closedSpeech, closedSetSpeech] = useState(-1);
  const [matched, setMatched] = useState(false);

  // State the timers and the streaming read without waiting for a render.
  const version = useRef(state.texto.versao);
  const saved = useRef(new Map(blocksDoc(state.texto.doc as In).map((b) => [b.id, b.texto])));
  const refTitle = useRef(typedTitle);
  const fromDocTitle = (doc: In) => refTitle.current.replace(/\s+/g, " ").trim() || fromFirstLineTitle(doc);
  const refStatus = useRef(status);
  refStatus.current = status;
  const timer = useRef<number | undefined>(undefined);
  const inFlight = useRef<Promise<void> | null>(null);
  // The last save failure (null once saved): "send", "send back", "sign" and "publish" do not go out with the old version.
  const failureSave = useRef<string | null>(null);
  const newOf = useRef(false);
  const restoring = useRef(false);
  const checkingRef = useRef(false);
  const newCheckOf = useRef(false);
  const nextRound = useRef<string[] | null>(null);
  const blocksInQueue = useRef(new Set<string>());
  const marksRef = useRef(marks);
  marksRef.current = marks;
  const litInRound = useRef(0);
  const fromCursorBlock = useRef<string | null>(null);
  const live = useRef({ aoEscolher: (_id: string) => {}, pular: (_step: 1 | -1) => {}, comandos: () => {}, colado: (_url: string) => {}, tecla: (_e: KeyboardEvent): boolean => false });
  const fns = useRef({ aoMudar: (_e: Editor) => {}, aoMoverCursor: (_e: Editor) => {}, salvar: async () => {} });
  /** The person has already put the cursor in the text on this visit (the editor is born with it at the start, without anyone putting it there). */
  const cursorPosted = useRef(false);

  const ed = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2] }, bulletList: false, orderedList: false, listItem: false, listKeymap: false, code: false, codeBlock: false,
        strike: false, underline: false, horizontalRule: false, trailingNode: false,
        link: { openOnClick: false, autolink: true, protocols: ["https", "http"], HTMLAttributes: { rel: "noreferrer", target: null } },
      }),
      BlockId,
      Marks,
      Note,
      ImageFile,
      Support,
    ],
    content: (state.texto.doc as In).content?.length ? (state.texto.doc as object) : undefined,   // the blank sheet
    editable: canEdit,
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: { role: "textbox", "aria-multiline": "true", "aria-label": t("Texto da matéria", "Story text"), "data-vazio": t("Comece a escrever.", "Start writing."), spellcheck: "true", ...(canEdit ? {} : { "aria-readonly": "true" }) },
    },
    // Through the most recent render's functions (the editor is created once).
    onUpdate: ({ editor }) => fns.current.aoMudar(editor),
    onSelectionUpdate: ({ editor }) => fns.current.aoMoverCursor(editor),
    onFocus: () => { cursorPosted.current = true; },
  }, []);

  // ── salvar ────────────────────────────────────────────────────────────────────────────────────────────────────
  function blocksEdited(editor: Editor) {
    return new Set(blocksDoc(editor.getJSON() as In).filter((b) => saved.current.get(b.id) !== b.texto).map((b) => b.id));
  }
  function schedule() {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { void fns.current.salvar(); }, WAIT_SAVE);
  }
  function onChange(editor: Editor) {
    if (!canEdit || refStatus.current === "conflito") return;
    setEdited(blocksEdited(editor));
    setStatus("sujo");
    schedule();
  }
  function currentBlock(editor: Editor): string | null {
    const $p = editor.state.selection.$from;
    for (let d = $p.depth; d > 0; d--) { const n = $p.node(d); if (n.attrs.id) return n.attrs.id as string; }
    return null;
  }
  function onMoveCursor(editor: Editor) {
    const now = currentBlock(editor);
    const before = fromCursorBlock.current;
    fromCursorBlock.current = now;
    // Left an edited paragraph: save now (and the paragraph goes to the check), without waiting for the pause.
    if (before && now !== before && refStatus.current === "sujo" && blocksEdited(editor).has(before)) {
      window.clearTimeout(timer.current);
      void save();
    }
  }

  async function save(): Promise<void> {
    if (!ed || !canEdit || refStatus.current === "conflito") return;
    if (inFlight.current) { newOf.current = true; return inFlight.current; }
    window.clearTimeout(timer.current);
    const doc = ed.getJSON() as In;
    const sent = blocksDoc(doc);
    setStatus("salvando");
    inFlight.current = (async () => {
      try {
        const d = await read(route.$put({ param }, bodyJson({ doc, versao: version.current, titulo: fromDocTitle(doc), restaurando: restoring.current })));
        restoring.current = false;
        version.current = d.texto.versao;
        saved.current = new Map(sent.map((b) => [b.id, b.texto]));
        const pending = new Set(d.blocos.filter((b) => b.estado === "pendente").map((b) => b.id));
        setBlocks(perId(d.blocos));
        // From the server, the marks of checked blocks; for pending ones, those already on screen (checking).
        setMarks((prev) => [...d.afirmacoes, ...prev.filter((m) => pending.has(m.blocoId))]);
        setFindings(d.apontamentos);
        update(d);
        const remains = blocksEdited(ed);
        setEdited(remains);
        const nowTitle = fromDocTitle(ed.getJSON() as In);
        setStatus(remains.size || (nowTitle && nowTitle !== d.texto.titulo) ? "sujo" : "salvo");
        setSavedAt(new Date().toISOString());
        setErrorSave(null);
        failureSave.current = null;
        if (pending.size) void check({});
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) { refStatus.current = "conflito"; failureSave.current = e.message; setStatus("conflito"); setErrorSave(e.message); return; }
        const msg = message(e, t("Não deu para salvar agora. O texto continua aqui; tentamos de novo na próxima pausa.", "Couldn't save right now. The text is still here; we'll try again at the next pause."));
        refStatus.current = "erro";
        failureSave.current = msg;
        setStatus("erro");
        setErrorSave(msg);
      } finally {
        inFlight.current = null;
        if (newOf.current) { newOf.current = false; void fns.current.salvar(); }
      }
    })();
    return inFlight.current;
  }
  fns.current = { aoMudar: onChange, aoMoverCursor: onMoveCursor, salvar: save };

  /**
   * Before sending back, sending, signing or publishing: what is on screen, saved. A failed save (or a conflict with
   * someone else) stops the action with the reason: the action does not go out with the earlier version.
   */
  async function savedEnsure() {
    while (inFlight.current) await inFlight.current;
    if (refStatus.current === "sujo" || refStatus.current === "erro") {
      await save();
      while (inFlight.current) await inFlight.current;
    }
    if (refStatus.current === "conflito" || failureSave.current) throw new Error(failureSave.current ?? t("O texto não foi salvo.", "The text was not saved."));
  }

  /** Goes back to a point in history: what is on screen goes to history first, so it can be undone. */
  async function restore(doc: unknown, oldTitle: string) {
    await savedEnsure();
    if (!ed) return;
    restoring.current = true;
    refTitle.current = oldTitle;
    setTitle(oldTitle);
    ed.commands.setContent(doc as object, { emitUpdate: false });
    setEdited(blocksEdited(ed));
    refStatus.current = "sujo";
    await save();
    while (inFlight.current) await inFlight.current;
    if (failureSave.current) throw new Error(failureSave.current);
  }

  // ── conferir ──────────────────────────────────────────────────────────────────────────────────────────────────
  async function check(body: { todos?: boolean; blocos?: string[]; pular?: string[] }) {
    if (!canEdit) return;
    if (checkingRef.current) {
      // Paragraphs requested by name do not wait for the general queue: a general check would not redo those already checked.
      if (body.blocos) for (const b of body.blocos) blocksInQueue.current.add(b);
      else newCheckOf.current = true;
      return;
    }
    checkingRef.current = true;
    setChecking(true);
    setErrorCheck(null);
    litInRound.current = 0;
    const seen = new Set<string>();
    // What failed in this check (added to its earlier rounds): the next round does not repeat it.
    const failed = new Set(body.pular ?? []);
    try {
      await checkInStreaming(tenantId, id, body, (l) => {
        if (l.tipo === "bloco") {
          if (l.estado === "nao_conferido") failed.add(l.blocoId);
          setBlocks((b) => ({ ...b, [l.blocoId]: { estado: l.estado, erro: l.erro } }));
          if (l.estado !== "pendente") {
            seen.add(l.blocoId);
            light(l.blocoId, l.afirmacoes);
            setMarks((prev) => [...prev.filter((m) => m.blocoId !== l.blocoId), ...l.afirmacoes.map(fromLine)]);
          }
        } else if (l.tipo === "fim") {
          const pending = new Set(l.estado.blocos.filter((b) => b.estado === "pendente").map((b) => b.id));
          // The server checks in rounds (a cap of blocks per request) and says how many are left: the next round comes, which
          // does not repeat what failed in this one (only "Check again" tries once more).
          if (!body.blocos && (l.restantes ?? 0) > 0) nextRound.current = [...failed];
          if (body.blocos && (l.restantes ?? 0) > 0) for (const b of body.blocos) if (!seen.has(b)) blocksInQueue.current.add(b);
          setBlocks(perId(l.estado.blocos));
          setMarks((prev) => [...l.estado.afirmacoes, ...prev.filter((m) => pending.has(m.blocoId))]);
          setFindings(l.estado.apontamentos);
          // The screen's version does not come back: only what is not the text goes to the cache (dossier, marks, check).
          if (l.estado.texto.versao >= version.current) update(l.estado);
        } else setErrorCheck(l.erro);
      });
    } catch (e) {
      setErrorCheck(message(e));
    } finally {
      checkingRef.current = false;
      setChecking(false);
      if (newCheckOf.current) { newCheckOf.current = false; nextRound.current = null; void check({}); }
      else if (nextRound.current) { const skip = nextRound.current; nextRound.current = null; void check({ pular: skip }); }
      else if (blocksInQueue.current.size) { const b = [...blocksInQueue.current]; blocksInQueue.current.clear(); void check({ blocos: b }); }
    }
  }

  /** A sentence that was unsourced and came back with evidence lights up in light green, one after the other. */
  function light(blockId: string, created: Claim[]) {
    if (!activeReviewer || reduced()) return;
    const before = marksRef.current.filter((m) => m.blocoId === blockId && m.estado === "sem_fonte" && m.aberta);
    const won = created.filter((n) => n.estado === "com_evidencia" && !n.incerto && before.some((a) => a.trecho === n.trecho));
    if (!won.length) return;
    setLit((m) => {
      const next = new Map(m);
      for (const a of won) next.set(a.id, Math.min(litInRound.current++, 5));
      return next;
    });
    window.setTimeout(() => setLit((m) => { const next = new Map(m); for (const a of won) next.delete(a.id); return next; }), 3000);
  }

  /** A new link in the dossier: stores the state and re-checks only the paragraphs it may resolve. */
  function onSource(d: DeskState) {
    update(d);
    const b = blocksWithoutSource(d);
    if (b.length) void check({ blocos: b });
  }

  // ── marks in the editor ───────────────────────────────────────────────────────────────────────────────────────
  // Another part of the screen changed the state (reporting on the card, a link in the dossier, a signature): marks and
  // findings come from the server; those of still-pending paragraphs stay the screen's.
  useEffect(() => {
    if (state.texto.versao !== version.current) return;
    const pending = new Set(state.blocos.filter((b) => b.estado === "pendente").map((b) => b.id));
    setMarks((prev) => [...state.afirmacoes, ...prev.filter((m) => pending.has(m.blocoId) && !state.afirmacoes.some((x) => x.id === m.id))]);
    setFindings(state.apontamentos);
  }, [state]);

  const items = useMemo(() => itemsOf(marks, findings), [marks, findings]);
  useEffect(() => {
    if (!ed || ed.isDestroyed) return;
    ed.view.dispatch(ed.state.tr.setMeta(marksKey, { marcas: items, ativa: active, acesas: lit }));
  }, [ed, items, active, lit]);

  const places: Place[] = ed ? placesMarks(ed.state.doc, items) : [];
  const perBrand = useMemo(() => new Map(items.map((m) => [m.id, m])), [items]);
  const open = places.filter((l) => (l.marca as Item).aberta);
  const visible = places.filter((l) => inFilter(l.marca as Item, filter));

  function goTo(brandId: string, focusOn = true) {
    if (!ed) return;
    const l = placesMarks(ed.state.doc, items).find((x) => x.marca.id === brandId);
    activeSet(brandId);
    if (widePanel && tabPanel !== "marcas") changeTab("marcas");
    if (!l) return;
    ed.chain().setTextSelection({ from: l.de, to: l.ate }).run();
    if (focusOn) ed.commands.focus();
    const el = ed.view.domAtPos(l.de).node;
    (el instanceof HTMLElement ? el : el.parentElement)?.scrollIntoView({ block: "center", behavior: reduced() ? "auto" : "smooth" });
  }
  /** Selects a piece of a block (a person mentioned, a checklist paragraph) and scrolls to it. */
  function goToPassage(blockId: string, home: number, end: number) {
    if (!ed) return;
    const b = blocksPerId(ed.state.doc).get(blockId);
    if (!b) return;
    const tp = withPositionsText(b.no, b.pos);
    const from = tp.ini[home] ?? b.pos + 1, until = tp.fim[Math.max(home, end - 1)] ?? from;
    ed.chain().focus().setTextSelection({ from: from, to: until }).run();
    const el = ed.view.domAtPos(from).node;
    (el instanceof HTMLElement ? el : el.parentElement)?.scrollIntoView({ block: "center", behavior: reduced() ? "auto" : "smooth" });
  }
  function skip(step: 1 | -1, f: Filter = filter) {
    const list = f === "todos" ? openNow() : placesNow().filter((l) => inFilter(l.marca as Item, f));
    if (!list.length || !ed) return;
    const i = list.findIndex((l) => l.marca.id === active);
    let target: Place;
    if (i < 0) {
      const cursor = ed.state.selection.from;
      target = step === 1 ? list.find((l) => l.de > cursor) ?? list[0] : [...list].reverse().find((l) => l.ate < cursor) ?? list[list.length - 1];
    } else target = list[(i + step + list.length) % list.length];
    goTo(target.marca.id);
  }
  const placesNow = () => (ed ? placesMarks(ed.state.doc, items) : []);
  const openNow = () => placesNow().filter((l) => (l.marca as Item).aberta);

  // ── @: cite from the dossier ──────────────────────────────────────────────────────────────────────────────────
  const query = ed && canEdit && ed.isFocused ? queryHandle(ed.state) : null;
  const openMenu = query && query.de !== handle.fechadaEm ? query : null;
  const norm = (x: string) => x.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const optionsHandle = openMenu ? state.evidencias.filter((e) => norm(`${e.titulo ?? ""} ${e.url}`).includes(norm(openMenu.busca))).slice(0, 8) : [];
  function cite(e: Evidence) {
    if (!ed || !openMenu) return;
    ed.chain().focus().deleteRange({ from: openMenu.de, to: openMenu.ate })
      .insertContent([{ type: "nota", attrs: { rotulo: noteLabel(e), evidencia: e.id } }, { type: "text", text: " " }]).run();
    setHandle({ ativo: 0, fechadaEm: -1 });
  }
  /** Keys for the @ menu inside the editor (before ProseMirror): arrows, Enter/Tab choose, Esc closes. */
  function keyHandle(e: KeyboardEvent): boolean {
    if (!openMenu) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { setHandle((a) => ({ ...a, ativo: Math.max(0, Math.min(optionsHandle.length - 1, a.ativo + (e.key === "ArrowDown" ? 1 : -1))) })); return true; }
    if ((e.key === "Enter" || e.key === "Tab") && optionsHandle.length) { cite(optionsHandle[Math.min(handle.ativo, optionsHandle.length - 1)]); return true; }
    if (e.key === "Escape") { setHandle({ ativo: 0, fechadaEm: openMenu.de }); return true; }
    return false;
  }
  const boxEditor = useRef<HTMLDivElement>(null);
  const positionMenu = (after: number) => {
    if (!ed || !boxEditor.current) return { topo: 0, esquerda: 0, acima: false };
    const c = ed.view.coordsAtPos(after);
    const r = boxEditor.current.getBoundingClientRect();
    // The menu's width (w-[min(360px,90vw)]), so it does not overflow the screen. Without room below (sheet footer,
// navigation, keyboard), the speech offer opens above.
    const width = Math.min(360, window.innerWidth * .9);
    const above = c.bottom > (window.visualViewport?.height ?? window.innerHeight) - (wide ? 200 : 300);
    return { topo: (above ? c.top : c.bottom) - r.top + (above ? -6 : 6), esquerda: Math.max(0, Math.min(c.left - r.left, r.width - width)), acima: above };
  };
  const afterMenu = openMenu ? positionMenu(openMenu.de) : { topo: 0, esquerda: 0, acima: false };

  // ── speech from the recording ─────────────────────────────────────────────────────────────────────────────────
  const speeches = useSpeeches(tenantId, id, state.gravacoes, activeReviewer);
  const quote = ed && activeReviewer && speeches.length && ed.isFocused && !openMenu ? queryQuote(ed.state) : null;
  const speechFound = quote && quote.de !== closedSpeech ? findSpeech(quote.digitado, speeches) : null;
  /** Only the rest of the speech, literal, and the closing quote mark: what the person typed stays as is. */
  function insertSpeech() {
    if (!ed || !speechFound || !quote) return;
    ed.view.dispatch(ed.state.tr.insertText(speechFound.resto + quote.fecha));
    ed.commands.focus();
  }
  /** Tab is only captured with the offer in view. */
  function keySpeech(e: KeyboardEvent): boolean {
    if (!speechFound || !quote) return false;
    if (e.key === "Tab" && !e.shiftKey) { insertSpeech(); return true; }
    if (e.key === "Escape") { closedSetSpeech(quote.de); return true; }
    return false;
  }

  // Tapping a mark selects it (on mobile it shows in the counter, which opens the sheet): focus stays in the text.
  live.current = {
    aoEscolher: (m) => { activeSet(m); if (widePanel) { changeTab("marcas"); window.setTimeout(() => document.getElementById(`cartao-${m}`)?.scrollIntoView({ block: "nearest" }), 30); } },
    pular: (p) => skip(p),
    comandos: () => setCommands(true),
    colado: (url) => { if (canEdit && !state.evidencias.some((e) => e.url === url)) setLinkPasted(url); },
    tecla: (e) => keyHandle(e) || keySpeech(e),
  };

  // A click on a mark and F8 inside the editor (events from the Marks extension).
  useEffect(() => {
    if (!ed) return;
    const dom = ed.view.dom;
    const choose = (e: Event) => live.current.aoEscolher((e as CustomEvent<string>).detail);
    const skipEv = (e: Event) => live.current.pular((e as CustomEvent<1 | -1>).detail);
    const cmd = () => live.current.comandos();
    const pasted = (e: Event) => live.current.colado((e as CustomEvent<string>).detail);
    // The @ menu takes the arrows, Enter, Tab and Esc before the editor does.
    const key = (e: KeyboardEvent) => { if (live.current.tecla(e)) { e.preventDefault(); e.stopPropagation(); } };
    dom.addEventListener("marca-escolher", choose);
    dom.addEventListener("marca-pular", skipEv);
    dom.addEventListener("comandos", cmd);
    dom.addEventListener("link-colado", pasted);
    dom.addEventListener("keydown", key, true);
    return () => {
      dom.removeEventListener("marca-escolher", choose); dom.removeEventListener("marca-pular", skipEv); dom.removeEventListener("comandos", cmd);
      dom.removeEventListener("link-colado", pasted); dom.removeEventListener("keydown", key, true);
    };
  }, [ed]);
  // F8 and Ctrl/⌘K with focus outside the editor (in the panel, for example).
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.(".ProseMirror")) return;
      if (e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); live.current.comandos(); return; }
      if (e.key !== "F8") return;
      e.preventDefault();
      live.current.pular(e.shiftKey ? -1 : 1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  // Leaving with unsaved changes: the browser warns; changing screens saves whatever it can.
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => { if (refStatus.current === "sujo" || refStatus.current === "salvando") e.preventDefault(); };
    window.addEventListener("beforeunload", before);
    return () => { window.removeEventListener("beforeunload", before); window.clearTimeout(timer.current); if (refStatus.current === "sujo") void fns.current.salvar(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── outputs ───────────────────────────────────────────────────────────────────────────────────────────────────
  const returnValue = useMutation({
    mutationFn: async () => { await savedEnsure(); return read(route.devolver.$post({ param }, bodyJson({ versao: version.current }))); },
    onSuccess: (d) => { update(d); setReturning(null); setWarning(t(`Devolvido ao Google Docs: ${d.devolvidos === 1 ? "1 parágrafo" : `${d.devolvidos} parágrafos`}.`, `Sent back to Google Docs: ${d.devolvidos === 1 ? "1 paragraph" : `${d.devolvidos} paragraphs`}.`)); },
    onError: (e) => { if (e instanceof ApiError && e.codigo === "mudou_no_docs") setReturning({ mudancas: (e.dados as { mudancas?: Change[] } | undefined)?.mudancas ?? [] }); },
  });
  const reimport = useMutation({
    mutationFn: () => read(route.reimportar.$post({ param }, bodyJson({ versao: version.current }))),
    onSuccess: (d) => { update(d); reload(); },
  });
  const instagram = useMutation({
    mutationFn: async () => { await savedEnsure(); return read(route.instagram.$post({ param }, bodyJson({ cardFontes: !!state.paginaFontes && cardSources }))); },
    onError: (e) => { if (e instanceof ApiError && e.codigo === "checklist") setChecklist(true); },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: keys.pautas(tenantId) });
      qc.invalidateQueries({ queryKey: keys.pecas(tenantId) });
      navigate(r.pecaId ? `/t/${slug}/p/${r.pecaId}` : `/t/${slug}`);
    },
  });
  const sign = useMutation({
    mutationFn: async () => { await savedEnsure(); return read(route.assinar.$post({ param }, bodyJson({ versao: version.current }))); },
    onSuccess: (d) => { update(d); instagram.reset(); },
  });
  const takePasted = useMutation({
    mutationFn: (url: string) => read(route.evidencias.$post({ param }, bodyJson({ url }))),
    onSuccess: (d) => { setLinkPasted(null); onSource(d); },
  });
  const copy = useMutation({
    mutationFn: async () => {
      const doc = ed!.getJSON() as In;
      const { html, texto: text } = substackDoc(fromDocTitle(doc), doc);
      await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) })]);
    },
    onSuccess: () => setWarning(t("Copiado com a formatação. Cole no editor do Substack.", "Copied with formatting. Paste it into the Substack editor.")),
  });

  // ── what the screen shows ─────────────────────────────────────────────────────────────────────────────────────
  const blocksList = ed ? blocksDoc(ed.getJSON() as In) : [];
  const notChecked = blocksList.filter((b) => b.texto.trim() && !edited.has(b.id) && blocks[b.id]?.estado === "nao_conferido");
  // Checked with a warning (the second opinion did not answer): it appears in the panel even without a risk mark in the paragraph.
  const serverWarnings = new Map(state.blocos.filter((b) => b.aviso).map((b) => [b.id, b.aviso!]));
  const withWarning = blocksList.filter((b) => b.texto.trim() && !edited.has(b.id) && blocks[b.id]?.estado === "conferido" && serverWarnings.has(b.id))
    .map((b) => ({ ...b, aviso: serverWarnings.get(b.id)! }));
  const perCheck = blocksList.filter((b) => b.texto.trim() && (edited.has(b.id) || !blocks[b.id] || blocks[b.id].estado === "pendente")).length;
  const nPendingItems = state.checklist.pendencias.length;
  const nothing = !checking && !edited.size && blocksList.every((b) => !b.texto.trim() || !blocks[b.id] || blocks[b.id].estado === "pendente") && !marks.length;
  const busy = returnValue.isPending || instagram.isPending || reimport.isPending;

  // ── o revisor ─────────────────────────────────────────────────────────────────────────────────────────────────
  const notesTarget = notesText(places.map((l) => toReviewer(l.marca as Item)));
  const { vivas: notes, anuncio: ad } = useNotes({
    ativo: activeReviewer, alvo: notesTarget,
    existem: new Set(blocksList.filter((b) => b.texto.trim()).map((b) => b.id)),
    // Without a valid check right now, nothing changes: "no note" there would claim a check that did not run.
    espera: new Set(blocksList.filter((b) => edited.has(b.id) || blocks[b.id]?.estado !== "conferido").map((b) => b.id)),
    cursor: ed?.isFocused ? currentBlock(ed) : null,
  });
  const noteOpen = notes.some((n) => n.fase !== "risca");
  // On desktop the note lives on the margin card; below 1180 px, in focus and with the Material in the panel's place, right below the paragraph.
  const inMargin = widePanel && !focus;
  const hosts = useRef(new Map<string, HTMLElement>());
  const hostNote = (blockId: string) => {
    let h = hosts.current.get(blockId);
    if (!h) { h = document.createElement("div"); h.className = "nota-bloco"; hosts.current.set(blockId, h); }
    return h;
  };
  const blocksWithNote = inMargin ? [] : [...new Set(notes.map((n) => n.blocoId))];
  useEffect(() => {
    if (!ed || ed.isDestroyed) return;
    ed.view.dispatch(ed.state.tr.setMeta(marksKey, { notas: blocksWithNote.map((blockId) => ({ blocoId: blockId, host: hostNote(blockId) })) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ed, blocksWithNote.join()]);
  /** Clicking the note is clicking the mark: opens the card with the actions. A note without a visible mark (edited paragraph) leads to the paragraph. */
  function openNote(n: NoteLive) {
    if (!placesNow().some((l) => l.marca.id === n.marcaId)) { goToPassage(n.blocoId, 0, 0); return; }
    activeSet(n.marcaId);
    if (!widePanel) { setPanel(true); return; }
    setParams((p) => { p.set("painel", "marcas"); p.delete("foco"); return p; }, { replace: true, preventScrollReset: true });
    window.setTimeout(() => document.getElementById(`cartao-${n.marcaId}`)?.scrollIntoView({ block: "nearest" }), 60);
  }
  const words = blocksList.reduce((n, b) => n + (b.texto.match(/\S+/g)?.length ?? 0), 0);
  const minutes = Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
  const sourcesPage = <SourcesPage tenantId={tenantId} textoId={id} estado={state} editor={canEdit} versao={() => version.current} garantirSalvo={savedEnsure} atualizar={update} abrirChecklist={() => setChecklist(true)} />;
  const bench = canEdit ? (
    <Bench tenantId={tenantId} textoId={id} estado={state} aberta={tool} abrir={openTool} garantirSalvo={savedEnsure} irParaTrecho={goToPassage} restaurar={restore}
      inserirAspa={(s) => ed?.chain().focus().insertContent(`“${s}” `).run()}
      inserirApoio={(sponsorship, text) => ed?.chain().focus().insertContent([{ type: "apoio", attrs: { patrocinio: sponsorship, texto: text } }, { type: "paragraph" }]).run()} />
  ) : null;

  // ── material on the side ──────────────────────────────────────────────────────────────────────────────────────
  // On mobile the Material sheet is modal: on close, the browser returns focus to the text and may put the cursor at the
  // start. So the selection is stored on open, and Insert restores it before placing the passage.
  const selectionBefore = useRef<{ de: number; ate: number } | null>(null);
  function openMaterial(o: { fonte?: string; buscar?: boolean } = {}) {
    selectionBefore.current = ed && cursorPosted.current ? { de: ed.state.selection.from, ate: ed.state.selection.to } : null;
    setParams((p) => { p.set("material", "aberto"); p.delete("foco"); if (o.fonte) p.set("fonte", o.fonte); return p; }, { replace: true, preventScrollReset: true });
    if (o.buscar) window.setTimeout(() => document.getElementById("material-busca")?.focus(), 80);
  }
  /** `keepSource`: on mobile, inserting closes the sheet and reopening returns to the same reader. */
  const closeMaterial = (keepSource = false) => setParams((p) => { p.delete("material"); if (!keepSource) p.delete("fonte"); return p; }, { replace: true, preventScrollReset: true });
  function insertMaterial(content: JSONContent[]) {
    if (!ed || ed.isDestroyed || !canEdit || !content.length) return;
    // Whoever opened the text and went straight to the source has not placed the cursor yet: the passage goes in at the end
    // of the text, not stuck to the start of the first line (where the editor is born).
    const inEnd = (): JSONContent[] => (ed.state.doc.lastChild?.isTextblock && ed.state.doc.lastChild.textContent ? [{ type: "text", text: " " }, ...content] : content);
    if (wide) {
      if (cursorPosted.current) ed.chain().focus().insertContent(content).run();
      else ed.chain().focus("end").insertContent(inEnd()).run();
      return;
    }
    const s = selectionBefore.current;
    closeMaterial(true);
    // After the sheet closes (the browser returns focus to the text), the stored selection comes back and the passage goes into it.
    window.setTimeout(() => {
      if (ed.isDestroyed) return;
      const end = ed.state.doc.content.size;
      if (s) ed.chain().focus().setTextSelection({ from: Math.min(s.de, end), to: Math.min(s.ate, end) }).insertContent(content).run();
      else ed.chain().focus("end").insertContent(inEnd()).run();
    }, 40);
  }
  // The Material does not render with the text: it receives these bridges, which keep their identity across keystrokes.
  const bridgeMaterial = useRef({ inserir: insertMaterial, atualizar: update, aoFonte: onSource, fechar: () => closeMaterial() });
  bridgeMaterial.current = { inserir: insertMaterial, atualizar: update, aoFonte: onSource, fechar: () => closeMaterial() };
  const actionsMaterial = useMemo<ActionsMaterial>(() => ({
    inserir: (c) => bridgeMaterial.current.inserir(c), atualizar: (d) => bridgeMaterial.current.atualizar(d),
    aoFonte: (d) => bridgeMaterial.current.aoFonte(d), fechar: () => bridgeMaterial.current.fechar(),
  }), []);
  const material = <Material tenantId={tenantId} textoId={id} estado={state} podeEditar={canEdit} folha={!wide} acoes={actionsMaterial} />;
  const readOnSide = (evidenceId: string) => openMaterial({ fonte: `evidencia:${evidenceId}` });
  const materialButton = { aberto: materialOpen, alternar: () => (materialOpen ? closeMaterial() : openMaterial()) };

  const statusLine = canEdit ? (
    <span role="status" className="mono text-apoio">
      {status === "salvando" ? t("salvando…", "saving…")
        : status === "sujo" ? t("alterações não salvas", "unsaved changes")
          : status === "conflito" ? t("não salvo: outra pessoa salvou antes", "not saved: someone else saved first")
            : status === "erro" ? t("não salvo", "not saved")
              : savedAt ? t(`salvo às ${hour(savedAt)}`, `saved at ${hour(savedAt)}`) : t("salvo", "saved")}
    </span>
  ) : null;
  const seenTitle = title.trim() || blocksList[0]?.texto.slice(0, 120) || t("Sem título", "Untitled");
  const titleField = canEdit ? (
    <>
      <h1 id="titulo-texto" className="sr-only">{seenTitle}</h1>
      <label className="mt-2 block">
        <span className="sr-only">{t("Título", "Title")}</span>
        {/* A one-line textarea that grows with the title (a long title wraps like the h1). */}
        <textarea rows={1} value={title} maxLength={300} placeholder={t("Título", "Title")} autoFocus={!state.texto.titulo}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); ed?.commands.focus("start"); } }}
          onChange={(e) => { const v = e.target.value.replace(/\s*\n\s*/g, " "); setTitle(v); refTitle.current = v; if (refStatus.current !== "conflito") { setStatus("sujo"); schedule(); } }}
          className="titulo-tela block w-full resize-none border-0 bg-transparent p-0 text-[30px] leading-[1.1] text-texto-forte outline-offset-4 [field-sizing:content] placeholder:text-apoio lg:text-[40px]" />
      </label>
    </>
  ) : <h1 id="titulo-texto" className="titulo-tela m-0 mt-2 text-[30px] leading-[1.1] lg:text-[40px]">{seenTitle}</h1>;

  const count = countMarks(places.map((l) => l.marca).filter((m): m is Item & { estado: State } => ["com_evidencia", "sem_fonte", "risco"].includes(m.estado)));
  const extras = (["resolvida", "conta", "aspa", "gravacao", "manual"] as const).map((e) => [e, places.filter((l) => l.marca.estado === e).length] as const).filter(([, n]) => n > 0);
  const countScreen = (
    <span className="inline-flex flex-wrap gap-x-3 gap-y-1">
      <Marker contagem={count} />
      {extras.map(([e, n]) => <span key={e} className="mono inline-flex items-center gap-1 text-texto"><IconState estado={e} />{n} {SCREEN_LABEL[e]}</span>)}
    </span>
  );
  const blocksPerIdState = new Map(state.blocos.map((b) => [b.id, b]));
  const checkBlock = (b: string) => void check({ blocos: [b] });
  const goToPerson = (p: Person) => { goToPassage(p.primeira.blocoId, p.primeira.inicio, p.primeira.fim); if (!widePanel) setPanel(false); };
  const headMarks = <HeadMarks todas={places} contagemTela={countScreen} filtro={filter} setFiltro={setFilter} />;
  const panelContent = (
    <>
      {!widePanel && headMarks}
      <Panel lugares={visible} todas={places} ativa={active} porMarca={perBrand} ed={widePanel ? ed : null} notas={notes} ordem={new Map(blocksList.map((b, i) => [b.id, i]))} filtro={filter}
        abrirNota={openNote} irPara={(m) => { goTo(m, widePanel); if (!widePanel) setPanel(false); }} naoConferidos={notChecked} comAviso={withWarning} conferirBloco={checkBlock} podeEditar={canEdit}
        detalhe={(it) => it.afirmacao ? (
          <>
            <DetailBrand a={it.afirmacao.apuracao?.tipo === "fonte" ? { ...it.afirmacao, estado: "com_evidencia", evidenciaId: it.afirmacao.apuracao.evidenciaId, evidenciaTrecho: it.afirmacao.apuracao.evidenciaTrecho } : it.afirmacao}
              evidencias={state.evidencias} curto />
            {(it.afirmacao.estado === "risco" || it.afirmacao.incerto) && <OpinionsLine bloco={blocksPerIdState.get(it.blocoId)} segunda={state.segunda} ligar={admin ? `/t/${slug}/veiculo?aba=chaves` : null} />}
            {canEdit && <ActionsCard key={it.id} a={it.afirmacao} evidencias={state.evidencias} tenantId={tenantId} textoId={id} atualizar={update} aoFonte={onSource} />}
          </>
        ) : it.apontamento ? <DetailFinding p={it.apontamento} podeEditar={canEdit} tenantId={tenantId} textoId={id} aoAdicionar={onSource} /> : null} />
      <People pessoas={state.pessoas} irPara={goToPerson} naFolha={!widePanel} />
    </>
  );
  const goToPending = (p: Pending) => {
    if (p.tipo === "paragrafo" && p.blocoId) { goToPassage(p.blocoId, 0, 0); return; }
    goTo(p.id, widePanel);
    if (!widePanel) setPanel(true);
  };
  const fromCursorNowBlock = ed ? currentBlock(ed) : null;
  const commandsList: Command[] = [
    ...(canEdit && fromCursorNowBlock ? [{ id: "conferir", rotulo: t("Conferir este parágrafo", "Check this paragraph"), fazer: () => checkBlock(fromCursorNowBlock) }] : []),
    { id: "proxima", rotulo: t("Próxima marca aberta", "Next open mark"), dica: "F8", fazer: () => skip(1, "todos") },
    { id: "sem-fonte", rotulo: t("Próxima marca sem fonte", "Next mark without a source"), fazer: () => { setFilter("sem_fonte"); skip(1, "sem_fonte"); } },
    { id: "risco", rotulo: t("Próxima marca de risco", "Next risk mark"), fazer: () => { setFilter("risco"); skip(1, "risco"); } },
    ...(canEdit ? [
      { id: "citar", rotulo: t("Citar do dossiê", "Cite from the dossier"), dica: "@", fazer: () => { setHandle({ ativo: 0, fechadaEm: -1 }); ed?.chain().focus().insertContent("@").run(); } },
      { id: "link", rotulo: t("Pôr um link no dossiê", "Add a link to the dossier"), fazer: () => setLinkPasted("") },
      { id: "aspas", rotulo: t("Inserir aspa da entrevista", "Insert an interview quote"), fazer: () => goToTool("aspas") },
      { id: "apoio", rotulo: t("Inserir bloco de apoio", "Insert a sponsor block"), fazer: () => goToTool("apoio") },
      { id: "divulgar", rotulo: t("Sugerir assunto e divulgação", "Suggest subject and promotion"), fazer: () => goToTool("divulgar") },
      { id: "leitura", rotulo: t("Pedir a segunda leitura", "Ask for a second read"), fazer: () => goToTool("leitura") },
      { id: "versoes", rotulo: t("Ver as versões do texto", "See the text's versions"), fazer: () => goToTool("versoes") },
    ] : []),
    ...(wide ? [{ id: "foco", rotulo: focus ? t("Sair do modo foco", "Leave focus mode") : t("Modo foco", "Focus mode"), fazer: () => changeFocus(!focus) }] : []),
    { id: "checklist", rotulo: t("Ver o checklist de publicação", "See the publication checklist"), fazer: () => setChecklist(true) },
    { id: "material", rotulo: materialOpen ? t("Fechar o material", "Close the material") : t("Abrir o material", "Open the material"), fazer: () => (materialOpen ? closeMaterial() : openMaterial()) },
    { id: "procurar-material", rotulo: t("Procurar no material", "Search the material"), fazer: () => openMaterial({ buscar: true }) },
    { id: "pessoas", rotulo: t("Ir para pessoas e instituições", "Go to people and institutions"), fazer: () => { if (widePanel) changeTab("marcas"); else setPanel(true); window.setTimeout(() => document.getElementById("pessoas-t")?.scrollIntoView({ block: "start" }), 50); } },
  ];

  // The stamp: it lands once when the proof closes in the session; a text opened already closed shows it finished. A
  // half-done check's warning (the second opinion did not answer) holds the stamp: a failure does not become approval.
  const closedProof = words > 0 && !checking && !perCheck && !notChecked.length && !withWarning.length && !open.length && !nPendingItems;
  const closedBefore = useRef<boolean | null>(null);
  useLayoutEffect(() => {
    if (!ed) return;
    const before = closedBefore.current;
    closedBefore.current = closedProof;
    if (!closedProof) setMatched(false);
    else if (before === false && activeReviewer && !reduced()) setMatched(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ed, closedProof]);

  return (
    // The same tree with and without the Material column: opening and closing does not remount the editor.
    <div className={columnMaterial ? "grid grid-cols-[360px_minmax(0,1fr)] items-start gap-8" : undefined}>
      {columnMaterial && (
        // A second document alongside, pinned, with its own scroll (like the Dossier column in the panel). It sits below the
        // folio and above the frame's footer: it adds --topo and --pe, like every sticky element on screen (DESIGN.md §12).
        <aside aria-labelledby="material-t" className="sticky top-[calc(var(--topo)+12px)] max-h-[calc(100dvh-var(--topo)-var(--pe)-24px)] min-w-0 self-start overflow-y-auto overscroll-contain pr-1 pb-6">{material}</aside>
      )}
      <div className={columnMaterial ? "min-w-0" : undefined}>
      {head(titleField, statusLine)}
      <div className={focus ? "mx-auto mt-2 grid max-w-[880px]" : widePanel ? "mt-2 grid gap-8 min-[1180px]:grid-cols-[minmax(0,1fr)_300px] min-[1180px]:gap-8" : "mt-2 grid gap-8"}>
        <article aria-labelledby="titulo-texto" className="min-w-0">
          {/* On mobile the actions sit in a row that scrolls sideways: stacked, they pushed the text off screen. On the blank sheet the buttons are off, and the row itself takes focus so it can be scrolled by keyboard. */}
          <div role="group" aria-label={t("Ações do texto", "Text actions")} tabIndex={words ? undefined : 0} className="-mx-5 mt-2 flex items-center gap-2 overflow-x-auto px-5 py-2 [scrollbar-width:none] *:flex-none lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0 [&::-webkit-scrollbar]:hidden">
            {canEdit && (
              <button type="button" className="btn-sec bg-papel-2" onClick={() => void check(perCheck || notChecked.length ? {} : { todos: true })} disabled={checking || !words}>
                {checking ? t("Conferindo…", "Checking…") : perCheck || notChecked.length || !words ? t("Conferir", "Check") : t("Conferir de novo", "Check again")}
              </button>
            )}
            {canEdit && state.podeDevolver && (
              <button type="button" className="btn-sec bg-papel-2" onClick={() => { setReturning("confirmar"); setWarning(null); returnValue.reset(); }} disabled={busy}>{t("Devolver ao Docs", "Send back to Docs")}</button>
            )}
            {canEdit && (
              <button type="button" className="acao-lapis cursor-pointer border-0 bg-transparent" onClick={() => instagram.mutate()} disabled={busy || !words}>
                {/* With a note open, the next action is the note: the pencil comes back here when it resolves. */}
                <span>{instagram.isPending ? t("Mandando…", "Sending…") : t("Mandar para o Instagram", "Send to Instagram")}</span>{words > 0 && !noteOpen && <BackPencil desenhar />}
              </button>
            )}
            <button type="button" className="btn-sec bg-papel-2" onClick={() => copy.mutate()} disabled={copy.isPending || !ed || !words}>{t("Copiar para o Substack", "Copy for Substack")}</button>
          </div>
          <div className="mt-2 grid gap-1">
            {canEdit && state.paginaFontes && (
              <label className="flex items-center gap-2 text-[15px]">
                <input type="checkbox" className="size-4" checked={cardSources} onChange={(e) => setCardSources(e.target.checked)} />
                {t("No Instagram, card final “Como apuramos” com o link da página de fontes", "On Instagram, a final “How we reported this” card with the sources page link")}
              </label>
            )}
          </div>

          <div aria-live="polite" className="mt-3 grid gap-2 empty:hidden">
            {warning && <p role="status" className="m-0 text-[15px] text-verde">{warning}</p>}
            {status === "conflito" && (
              <p role="alert" className="faixa-erro m-0">
                {saveError}{" "}<button type="button" className="link-acao border-0 bg-transparent p-0" onClick={reload}>{t("Recarregar a versão nova", "Reload the new version")}</button>
              </p>
            )}
            {status === "erro" && saveError && <p role="alert" className="faixa-erro m-0">{saveError}</p>}
            {copy.isError && <p role="alert" className="faixa-erro m-0">{t("O navegador não deixou copiar. Selecione o texto e copie à mão.", "The browser didn't allow copying. Select the text and copy it by hand.")}</p>}
            {checkError && <p role="alert" className="faixa-erro m-0">{checkError}</p>}
            {instagram.isError && <p role="alert" className="faixa-erro m-0">{message(instagram.error)}</p>}
            {state.temaSensivel && (state.segunda.ligada
              ? <p className="mono m-0 text-apoio">{t(`tema que modelos chineses suavizam: conferido pelo Claude, não pelo ${textName(state.provedorTexto)}`, `a topic Chinese models soften: checked by Claude, not ${textName(state.provedorTexto)}`)}</p>
              : <p className="faixa-aviso m-0">
                  {t(`Este texto toca em tema que modelos chineses suavizam (China). O segundo fornecedor não está ligado neste veículo: a conferência foi do ${textName(state.provedorTexto)}, com uma opinião só.`, `This text touches a topic Chinese models soften (China). The second provider isn't turned on for this outlet: the check was by ${textName(state.provedorTexto)}, with only one opinion.`)}
                  {admin && <>{" "}<Link className="link-acao" to={`/t/${slug}/veiculo?aba=chaves`}>{t("Ligar a segunda opinião", "Turn on the second opinion")}</Link></>}
                </p>)}
            {pastedLink !== null && (pastedLink ? (
              <div role="status" className="grid gap-2 rounded-card bg-branco p-3 shadow-curta">
                <p className="m-0 text-[15px]">{t("Adicionar ao dossiê?", "Add to the dossier?")} <span className="mono break-all text-apoio">{pastedLink}</span></p>
                {takePasted.isError && <p role="alert" className="m-0 text-[15px] text-terracota">{message(takePasted.error)}</p>}
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-sec bg-papel-2" onClick={() => takePasted.mutate(pastedLink)} disabled={takePasted.isPending}>{takePasted.isPending ? t("Lendo a página…", "Reading the page…") : t("Adicionar", "Add")}</button>
                  <button type="button" className="btn-sec bg-papel-2" onClick={() => { setLinkPasted(null); takePasted.reset(); }}>{t("Agora não", "Not now")}</button>
                </div>
              </div>
            ) : (
              <div className="rounded-card bg-branco p-3 shadow-curta">
                <FormLink tenantId={tenantId} textoId={id} rotulo={t("Link para o dossiê", "Link for the dossier")} cancelar={() => setLinkPasted(null)} aoAdicionar={(d) => { setLinkPasted(null); onSource(d); }} />
              </div>
            ))}
            {state.evidencias.some((e) => e.mudouEm) && <p className="faixa-aviso m-0">{t("Uma fonte do dossiê mudou desde que você conferiu. Abra a evidência e confira de novo.", "A dossier source changed since you checked. Open the evidence and check again.")}</p>}
          </div>

          {checklist && (
            <Checklist checklist={state.checklist} podeEditar={canEdit} assinar={() => sign.mutate()} assinando={sign.isPending} erro={sign.error}
              irPara={goToPending} fechar={() => setChecklist(false)} />
          )}
          {returning === "confirmar" && (
            <section aria-labelledby="devolver-t" className="mt-4 grid gap-3 rounded-card bg-branco p-4 shadow-curta">
              <h2 id="devolver-t" className="m-0 text-[18px]">{t("Devolver ao Google Docs", "Send back to Google Docs")}</h2>
              <p className="m-0">
                {t("Só os parágrafos que mudaram na mesa são trocados no Docs. Dentro deles, negrito, itálico e links se perdem; tabelas, comentários e sugestões do Docs ficam como estão. Se alguém mexeu no Docs depois da importação, o Google recusa e nada é sobrescrito.",
                  "Only the paragraphs that changed on the desk are replaced in Docs. Inside them, bold, italics and links are lost; tables, comments and suggestions in Docs stay as they are. If someone edited the Doc after the import, Google refuses and nothing is overwritten.")}
              </p>
              {returnValue.isError && !(returnValue.error instanceof ApiError && returnValue.error.codigo === "mudou_no_docs") && <p role="alert" className="faixa-erro m-0">{message(returnValue.error)}</p>}
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-tinta" onClick={() => returnValue.mutate()} disabled={returnValue.isPending}>{returnValue.isPending ? t("Devolvendo…", "Sending back…") : t("Devolver", "Send back")}</button>
                <button type="button" className="btn-sec bg-papel-2" onClick={() => setReturning(null)}>{t("Cancelar", "Cancel")}</button>
              </div>
            </section>
          )}
          {returning && typeof returning === "object" && (
            <section aria-labelledby="mudou-t" role="alert" className="mt-4 grid gap-3 rounded-card bg-branco p-4 shadow-curta">
              <h2 id="mudou-t" className="m-0 text-[18px]">{t("O Docs mudou depois que você importou", "The Doc changed after you imported it")}</h2>
              <p className="m-0">{t("O Google recusou a devolução para não apagar o que mudou lá. O que mudou no Docs:", "Google refused the send-back so it wouldn't erase what changed there. What changed in Docs:")}</p>
              <ul className="m-0 grid list-none gap-2 p-0">
                {returning.mudancas.length ? returning.mudancas.slice(0, 8).map((m, i) => (
                  <li key={i} className="grid gap-0.5 text-[15px]">
                    {m.antes !== null && <span className="text-apoio line-through decoration-fio-forte">{m.antes}</span>}
                    {m.depois !== null && <span>{m.depois}</span>}
                    <span className="mono text-apoio">{m.antes === null ? t("parágrafo novo no Docs", "new paragraph in Docs") : m.depois === null ? t("parágrafo tirado no Docs", "paragraph removed in Docs") : t("parágrafo alterado no Docs", "paragraph changed in Docs")}</span>
                  </li>
                )) : <li className="text-apoio">{t("Mudanças de formatação ou fora do texto (o conteúdo dos parágrafos é o mesmo).", "Formatting changes or changes outside the text (the paragraphs' content is the same).")}</li>}
              </ul>
              <p className="faixa-aviso m-0">{t("Reimportar traz o texto do Docs e as edições feitas aqui na mesa se perdem.", "Reimporting brings in the text from Docs, and the edits made here on the desk are lost.")}</p>
              {reimport.isError && <p role="alert" className="faixa-erro m-0">{message(reimport.error)}</p>}
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-sec bg-papel-2" onClick={() => reimport.mutate()} disabled={reimport.isPending}>{reimport.isPending ? t("Reimportando…", "Reimporting…") : t("Reimportar do Docs", "Reimport from Docs")}</button>
                <button type="button" className="btn-sec bg-papel-2" onClick={() => setReturning(null)}>{t("Cancelar", "Cancel")}</button>
              </div>
            </section>
          )}

          <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-fio pt-3">
            {nothing ? <span className="mono text-apoio">{t("ainda não conferido nesta versão", "not checked yet in this version")}</span> : countScreen}
            <span className="flex flex-wrap items-center gap-x-3">
              <button type="button" className="mono cursor-pointer border-0 bg-transparent p-0 text-apoio underline decoration-fio-forte underline-offset-3" aria-expanded={checklist} onClick={() => setChecklist((x) => !x)}>
                {state.checklist.assinatura ? t("checklist: assinado", "checklist: signed off") : nPendingItems ? t(`checklist: ${nPendingItems} pendente${nPendingItems > 1 ? "s" : ""}`, `checklist: ${nPendingItems} open`) : t("checklist: nada pendente", "checklist: nothing open")}
              </button>
              <span className="mono text-apoio">{t("F8: próxima marca · Ctrl/⌘K: comandos · @: cita o dossiê", "F8: next mark · Ctrl/⌘K: commands · @: cites the dossier")}</span>
            </span>
          </div>
          {/* The text's sheet: white and plain, without the grid paper, so reading comes first (DESIGN.md §5). */}
          <div className="folha-doc mt-3">
            {canEdit && ed && <Tools ed={ed} link={link} setLink={setLink} tenantId={tenantId} textoId={id} aspas={() => goToTool("aspas")} foco={wide ? { ligado: focus, mudar: changeFocus } : null} notas={{ ligado: notesOn, mudar: changeNotes }} material={materialButton} />}
            {/* Whoever only reads has no formatting, but reads the material alongside. */}
            {!canEdit && ed && (
              <div className="folha-doc-barra flex items-center justify-end">
                <MaterialButton {...materialButton} />
              </div>
            )}
            <div ref={boxEditor} className="editor-materia relative">
              <EditorContent editor={ed} />
              {openMenu && <MenuHandle id="menu-arroba" opcoes={optionsHandle} ativo={Math.min(handle.ativo, Math.max(0, optionsHandle.length - 1))} escolher={cite} topo={afterMenu.topo} esquerda={afterMenu.esquerda} />}
              {speechFound && quote && <OfferSpeech id="oferta-fala" achada={speechFound} inserir={insertSpeech} {...positionMenu(quote.de)} />}
              {blocksWithNote.map((b) => createPortal(<NotesBlock notas={notes.filter((n) => n.blocoId === b)} abrir={openNote} />, hostNote(b), b))}
              {/* Announces without taking focus: the new note and the passage found. */}
              <p aria-live="polite" className="sr-only">{ad} {speechFound ? t(`Fala encontrada na gravação. Tab insere, Esc dispensa.`, `Speech found in the recording. Tab inserts, Esc dismisses.`) : ""}</p>
            </div>
            {/* The sheet's footer: text size and the counter (checking, to check, open marks), which opens the panel on mobile. */}
            <div className="folha-doc-pe">
              <span className="mono text-apoio">
                {words === 1 ? t("1 palavra", "1 word") : t(`${words} palavras`, `${words} words`)}{words > 0 && ` · ${t(`${minutes} min de leitura`, `${minutes} min read`)}`}
              </span>
              <span role="status">{closedProof && <span className={`carimbo carimbo-prova${matched ? " carimbo-bate" : ""}`}>{t("Pode publicar", "Ready to publish")}</span>}</span>
            <button type="button" onClick={() => { if (!widePanel) setPanel(true); else if (focus) changeFocus(false); else { changeTab("marcas"); window.setTimeout(() => document.getElementById("painel-marcas")?.focus(), 30); } }}
              className="mono inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-btn border-0 bg-transparent px-1 text-[13px] text-texto">
              <span role="status">
                {checking ? t("conferindo…", "checking…") : !words ? t("nada para conferir", "nothing to check") : perCheck ? t(`${perCheck} por conferir`, `${perCheck} to check`) : notChecked.length ? t(`${notChecked.length} não conferido${notChecked.length > 1 ? "s" : ""}`, `${notChecked.length} not checked`) : t("conferido", "checked")}
              </span>
              <span aria-hidden="true">·</span>
              <span>{open.length === 1 ? t("1 marca aberta", "1 open mark") : t(`${open.length} marcas abertas`, `${open.length} open marks`)}</span>
              {!widePanel && active && perBrand.get(active) && (
                <span className="inline-flex items-center gap-1"><span aria-hidden="true">·</span><IconState estado={perBrand.get(active)!.estado as ScreenState} />{t("ver a marca", "see the mark")}</span>
              )}
            </button>
            </div>
          </div>
          {/* The sources page comes with the dossier: at the top, it pushed the text down a line. */}
          {!widePanel && <div className="mt-8 grid gap-4">{bench}{sourcesPage}</div>}
          {!widePanel && <DossierBelow tenantId={tenantId} textoId={id} estado={state} editor={canEdit} atualizar={update} aoFonte={onSource} lerAoLado={readOnSide} />}
        </article>

        {widePanel && !focus && (
          // With Marks, the column follows the text and only the head stays pinned; Dossier and Tools stay still alongside.
          <aside aria-label={t("Marcas e dossiê", "Marks and dossier")} className={tabPanel === "marcas" ? "min-w-0 pb-4 lg:px-1" : "grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-6 lg:sticky lg:top-8 lg:max-h-[calc(100vh-4rem)] lg:self-start lg:overflow-y-auto lg:px-1 lg:pb-4"}>
            <div className={tabPanel === "marcas" ? "sticky top-[var(--topo)] z-10 -mx-1 mb-4 grid gap-3 bg-papel px-1 pt-3 pb-3 shadow-[0_1px_0_var(--color-fio)]" : "contents"}>
              <TabsPanel atual={tabPanel} mudar={changeTab} marcas={open.length} evidencias={state.evidencias.length} tomDossie={summaryDossier(state).tom} ferramentas={canEdit} />
              {tabPanel === "marcas" && headMarks}
            </div>
            <PainelParte id="painel-aba-marcas" aberta={tabPanel === "marcas"} manter className="grid grid-cols-[minmax(0,1fr)] gap-6" aoAlerta={() => changeTab("marcas")}>{panelContent}</PainelParte>
            <PainelParte id="painel-aba-dossie" aberta={tabPanel === "dossie"} manter className="grid grid-cols-[minmax(0,1fr)] gap-4" aoAlerta={() => changeTab("dossie")}>
              <Dossier tenantId={tenantId} textoId={id} estado={state} editor={canEdit} atualizar={update} aoFonte={onSource} lerAoLado={readOnSide} />
              {sourcesPage}
            </PainelParte>
            {canEdit && <PainelParte id="painel-aba-ferramentas" aberta={tabPanel === "ferramentas"} manter className="grid grid-cols-[minmax(0,1fr)]" aoAlerta={() => changeTab("ferramentas")}>{bench}</PainelParte>}
          </aside>
        )}
      </div>
      </div>
      {!widePanel && panel && <Sheet titulo={t("Marcas", "Marks")} fechar={() => setPanel(false)}>{panelContent}</Sheet>}
      {!wide && materialOpen && <Sheet titulo={t("Material", "Material")} fechar={() => closeMaterial()}>{material}</Sheet>}
      {commands && <Commands comandos={commandsList} fechar={() => setCommands(false)} />}
    </div>
  );
}

/** Opens and closes the Material on the side. It does not take focus on press: the text cursor stays where it was. */
function MaterialButton({ aberto: isOpen, alternar: toggle }: { aberto: boolean; alternar: () => void }) {
  return (
    <button type="button" aria-pressed={isOpen} onMouseDown={(e) => e.preventDefault()} onClick={toggle}
      className={`inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-btn border-0 px-2 text-[15px] ${isOpen ? "bg-papel-2 font-bold text-texto-forte" : "bg-transparent text-texto hover:bg-papel-2"}`}>
      {t("Material", "Material")}
    </button>
  );
}

/** Allowed formatting (paragraph, subheading, bold, italic, quote, link), image, interview quotes and focus mode. */
function Tools({ ed, link, setLink, tenantId, textoId: textId, aspas: quotes, foco: focused, notas: notes, material }: {
  ed: Editor; link: string | null; setLink: (v: string | null) => void; tenantId: string; textoId: string; aspas: () => void;
  foco: { ligado: boolean; mudar: (enable: boolean) => void } | null; notas: { ligado: boolean; mudar: (enable: boolean) => void };
  material: { aberto: boolean; alternar: () => void };
}) {
  const [image, setImage] = useState<File | null>(null);
  const [alt, setAlt] = useState("");
  const closeImage = () => { setImage(null); setAlt(""); send.reset(); };
  const send = useMutation({
    mutationFn: async () => {
      const r = await read(fetch(`/api/t/${encodeURIComponent(tenantId)}/textos/${encodeURIComponent(textId)}/imagens`, { method: "POST", headers: { "content-type": image!.type, ...headerLanguage() }, body: image }));
      return (r as { src: string }).src;
    },
    onSuccess: (src) => {
      ed.chain().focus().insertContent([{ type: "imagem", attrs: { src, alt: alt.trim() } }, { type: "paragraph" }]).run();
      closeImage();
    },
  });
  const btn = (label: string, active: boolean, make: () => void, content: ReactNode = label) => (
    <button type="button" aria-pressed={active} aria-label={label} onMouseDown={(e) => e.preventDefault()} onClick={make}
      className={`inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-btn border-0 px-2 text-[15px] ${active ? "bg-papel-2 font-bold text-texto-forte" : "bg-transparent text-texto hover:bg-papel-2"}`}>{content}</button>
  );
  function apply(e: FormEvent) {
    e.preventDefault();
    const href = (link ?? "").trim();
    if (!/^https?:\/\/\S+$/.test(href)) return;
    ed.chain().focus().extendMarkRange("link").setLink({ href }).run();
    setLink(null);
  }
  // The buttons are 8 px wide (not 10) and, on desktop, 2 px apart (not 4): with the Material and round 4's narrower
  // sheet, the bar still fits on one line at 1440 (sidebar and panel in view) and in the three columns at 1600.
  return (
    <div className="folha-doc-barra grid gap-2">
      <div role="toolbar" aria-label={t("Formatação", "Formatting")} className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none] *:flex-none lg:flex-wrap lg:gap-0.5 lg:overflow-visible [&::-webkit-scrollbar]:hidden">
        {btn(t("Parágrafo", "Paragraph"), ed.isActive("paragraph") && !ed.isActive("blockquote"), () => ed.chain().focus().setParagraph().run())}
        {btn(t("Intertítulo", "Subheading"), ed.isActive("heading", { level: 2 }), () => ed.chain().focus().toggleHeading({ level: 2 }).run())}
        {btn(t("Negrito", "Bold"), ed.isActive("bold"), () => ed.chain().focus().toggleBold().run(), <b aria-hidden="true">N</b>)}
        {btn(t("Itálico", "Italic"), ed.isActive("italic"), () => ed.chain().focus().toggleItalic().run(), <i aria-hidden="true">I</i>)}
        {btn(t("Citação", "Quote"), ed.isActive("blockquote"), () => ed.chain().focus().toggleBlockquote().run())}
        {btn(t("Link", "Link"), ed.isActive("link"), () => setLink(link === null ? String(ed.getAttributes("link").href ?? "https://") : null))}
        <label className="inline-flex min-h-11 cursor-pointer items-center rounded-btn px-2 text-[15px] text-texto hover:bg-papel-2 focus-within:outline-2 focus-within:outline-texto-forte">
          {t("Imagem", "Image")}
          <input type="file" accept="image/jpeg,image/png" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) { send.reset(); setImage(f); } }} />
        </label>
        {btn(t("Aspas", "Quotes"), false, quotes)}
        <span className="flex-1" aria-hidden="true" />
        <MaterialButton {...material} />
        {btn(t("Notas", "Notes"), notes.ligado, () => notes.mudar(!notes.ligado))}
        {focused && btn(t("Foco", "Focus"), focused.ligado, () => focused.mudar(!focused.ligado))}
      </div>
      {image && (
        <form onSubmit={(e) => { e.preventDefault(); send.mutate(); }} className="flex flex-wrap items-end gap-2">
          <label className="campo min-w-[240px] flex-1">
            <span>{t(`Descreva a imagem (${image.name})`, `Describe the image (${image.name})`)}</span>
            <input className="entrada bg-branco" value={alt} autoFocus required maxLength={300} onChange={(e) => setAlt(e.target.value)} />
          </label>
          <button type="submit" className="btn-sec bg-papel-2" disabled={send.isPending}>{send.isPending ? t("Enviando…", "Uploading…") : t("Inserir", "Insert")}</button>
          <button type="button" className="btn-sec bg-papel-2" onClick={closeImage}>{t("Cancelar", "Cancel")}</button>
          {send.isError && <p role="alert" className="faixa-erro m-0 w-full">{message(send.error)}</p>}
        </form>
      )}
      {link !== null && (
        <form onSubmit={apply} className="flex flex-wrap items-end gap-2">
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

/** The desktop panel's three parts. The count stays in view, and a Dossier with a warning changes colour even closed. */
function TabsPanel({ atual: current, mudar: change, marcas: marks, evidencias: evidence, tomDossie: toneDossier, ferramentas: tools }: {
  atual: TabPanel; mudar: (a: TabPanel) => void; marcas: number; evidencias: number; tomDossie?: "aviso" | "erro"; ferramentas: boolean;
}) {
  const tab = (id: TabPanel, label: string, n?: number, tone?: "aviso" | "erro") => (
    <button type="button" aria-pressed={current === id} aria-controls={`painel-aba-${id}`} onClick={() => change(id)}
      className={`inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-btn border-0 px-2 text-[15px] ${current === id ? "bg-branco font-bold text-texto-forte shadow-fio" : "bg-transparent text-texto hover:text-texto-forte"}`}>
      {label}{n !== undefined && <span className={`mono text-[13px] ${tone === "erro" ? "text-terracota" : tone === "aviso" ? "text-ambar" : "text-apoio"}`}>{n}</span>}
    </button>
  );
  return (
    <div role="group" aria-label={t("Partes do painel", "Panel sections")} className="flex gap-0.5 rounded-btn bg-papel-2 p-0.5">
      {tab("marcas", t("Marcas", "Marks"), marks)}
      {tab("dossie", t("Dossiê", "Dossier"), evidence, toneDossier)}
      {tools && tab("ferramentas", t("Ferramentas", "Tools"))}
    </div>
  );
}

/** Count and filters: on desktop they stay pinned at the top of the column; on mobile, at the top of the sheet. */
function HeadMarks({ todas: all, contagemTela: countScreen, filtro: filter, setFiltro: setFilter }: { todas: Place[]; contagemTela: ReactNode; filtro: Filter; setFiltro: (f: Filter) => void }) {
  if (!all.length) return null;   // with no marks, a zeroed count and filters only take up space
  const account = (f: Filter) => all.filter((l) => inFilter(l.marca as Item, f)).length;
  const filters: [Filter, string, number][] = [
    ["todos", t("Todos", "All"), all.length],
    ["sem_fonte", t("Sem fonte", "No source"), account("sem_fonte")],
    ["risco", t("Risco", "Risk"), account("risco")],
  ];
  return (
    <div className="grid gap-3">
      {countScreen}
      <div role="group" aria-label={t("Filtrar as marcas", "Filter the marks")} className="flex flex-wrap gap-1">
        {filters.map(([f, label, n]) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}
            className={`inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-btn border-0 px-3 text-[15px] ${filter === f ? "bg-papel-2 font-bold text-texto-forte" : "bg-transparent text-texto hover:bg-papel-2"}`}>
            {label}<span className="mono text-[13px] text-apoio">{n}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * One card per mark (the selected one opens the detail and the actions), with the reviewer's note on the first line, and
 * the unchecked paragraphs. With `ed`, it is the desktop margin: each item at its paragraph's height. Without it, the
 * mobile sheet's list.
 */
function Panel({ lugares: places, todas: all, ativa: active, porMarca: perBrand, ed, notas: notes, ordem: order, filtro: filter, abrirNota: openNote, irPara: goTo, naoConferidos: notChecked, comAviso: withWarning, conferirBloco: checkBlock, podeEditar: canEdit, detalhe: detail }: {
  lugares: Place[]; todas: Place[]; ativa: string | null; porMarca: Map<string, Item>; ed: Editor | null; notas: NoteLive[]; ordem: Map<string, number>; filtro: Filter;
  abrirNota: (n: NoteLive) => void; irPara: (id: string) => void; naoConferidos: { id: string; texto: string }[]; comAviso: { id: string; texto: string; aviso: string }[];
  conferirBloco: (id: string) => void; podeEditar: boolean; detalhe: (i: Item) => ReactNode;
}) {
  const margin = !!ed;
  const place = margin ? "absolute inset-x-0 scroll-mt-48" : "";
  // A note whose mark is not in view (the paragraph was edited, or the mark changed) sits alone at its height: nothing flickers.
  const withBrand = new Set(all.map((l) => l.marca.id));
  const noteOf = new Map(notes.filter((n) => n.fase !== "risca" && withBrand.has(n.marcaId)).map((n) => [n.marcaId, n]));
  const loose = notes.filter((n) => n.fase === "risca" || !withBrand.has(n.marcaId));
  const line = (b: string, weight: number) => (order.get(b) ?? order.size) * 10 + weight;
  const alert = (b: { id: string; texto: string }, className: string, sentence: ReactNode, key: string) => ({
    chave: key, peso: margin ? line(b.id, 0) : -1, no: (
      <li key={key} data-bloco={b.id} className={`${place} ${className} grid gap-1.5 text-[15px]`}>
        <span>{sentence} “{b.texto.slice(0, 90)}{b.texto.length > 90 ? "…" : ""}”</span>
        {canEdit && <button type="button" className="link-acao justify-self-start border-0 bg-transparent p-0 text-[15px]" onClick={() => checkBlock(b.id)}>{t("Conferir de novo", "Check again")}</button>}
      </li>
    ),
  });
  const inputs: { chave: string; peso: number; no: ReactNode }[] = [
    ...notChecked.map((b) => alert(b, "faixa-erro", <><b>{t("Parágrafo não conferido", "Paragraph not checked")}</b>:</>, `erro-${b.id}`)),
    ...withWarning.map((b) => alert(b, "faixa-aviso", b.aviso, `aviso-${b.id}`)),
    ...loose.map((n) => ({
      chave: noteKey(n), peso: line(n.blocoId, 1), no: (
        <li key={noteKey(n)} data-bloco={n.blocoId} className={`${place} rounded-card bg-branco px-3 shadow-curta`}>
          {n.fase === "risca" ? <NoteLeaving nota={n} /> : <button type="button" className="nota-botao w-full" onClick={() => openNote(n)}><NoteText nota={n} /></button>}
        </li>
      ),
    })),
    ...places.flatMap(({ marca: brand }) => {
      const it = perBrand.get(brand.id);
      if (!it) return [];
      const chosen = active === brand.id;
      const a = it.afirmacao;
      const note = noteOf.get(brand.id);
      return [{
        chave: brand.id, peso: line(brand.blocoId, 2), no: (
          <li key={brand.id} id={`cartao-${brand.id}`} data-bloco={brand.blocoId} className={`${place} rounded-card bg-branco shadow-curta ${chosen ? "outline-2 outline-texto-forte" : ""}`}>
            <button type="button" aria-pressed={chosen} onClick={() => goTo(brand.id)}
              className="grid w-full cursor-pointer gap-1 rounded-card border-0 bg-transparent px-3 py-2.5 text-left">
              {note && <NoteText nota={note} />}
              <Label estado={it.estado as ScreenState}>
                {a?.risco ? <span className="text-apoio"> · {RISK_LABEL[a.risco] ?? a.risco}</span> : null}
                {a?.incerto && a.aberta ? <span className="text-apoio"> · {t("incerto, confira", "uncertain, check it")}</span> : null}
              </Label>
              <span className="line-clamp-2 text-[15px] text-texto">{/^[“"«]/.test(it.trecho) ? it.trecho : `“${it.trecho}”`}</span>
            </button>
            {chosen && <div className="grid gap-2.5 border-t border-fio px-3 pt-2.5 pb-3">{detail(it)}</div>}
          </li>
        ),
      }];
    }),
  ];
  // Stable: within the same paragraph, cards follow text order.
  const items = inputs.map((e, i) => [e, i] as const).sort(([a, i], [b, j]) => a.peso - b.peso || i - j).map(([e]) => e);
  const nodes = items.map((e) => e.no);
  return (
    <section id="painel-marcas" tabIndex={-1} aria-labelledby="marcas-t" className="grid gap-3 outline-none">
      {/* The visible title is the tab's, or the sheet's on mobile. */}
      <h2 id="marcas-t" className="sr-only">{t("Marcas", "Marks")}</h2>
      {items.length > 0 && (ed ? <MarginList ed={ed} chaves={items.map((e) => e.chave).join(" ")}>{nodes}</MarginList> : <ul className="m-0 grid list-none gap-2 p-0">{nodes}</ul>)}
      {!places.length && <p className="m-0 text-apoio">{filter === "todos" ? t("Nenhuma marca. Depois da conferência, cada afirmação de fato aparece aqui.", "No marks. After the check, every factual claim shows up here.") : t("Nenhuma marca aberta deste tipo.", "No open marks of this kind.")}</p>}
    </section>
  );
}

/** On mobile the dossier comes after the text: one row with the count, which opens by itself if there is a warning. */
function DossierBelow(props: { tenantId: string; textoId: string; estado: DeskState; editor: boolean; atualizar: (d: DeskState) => void; aoFonte: (d: DeskState) => void; lerAoLado: (evidenceId: string) => void }) {
  const r = summaryDossier(props.estado);
  const [isOpen, open] = usePart("dossie", useRef(r.tom ? "aberto" : null).current);
  return (
    <div className="mt-8">
      <Part id="dossie-texto" nivel="h2" rotulo={t("Dossiê", "Dossier")} resumo={r.texto} tom={r.tom} aberta={isOpen === "aberto"} alternar={() => open(isOpen === "aberto" ? null : "aberto")}>
        <Dossier {...props} emPartes />
      </Part>
    </div>
  );
}
