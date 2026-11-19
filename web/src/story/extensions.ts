// Story editor extensions (Tiptap/ProseMirror): a stable id per block and the check's marks as a layer over the text
// (decorations). A mark never enters the document: it is drawn over the sentence and follows typing (the sentence is
// found by its literal passage inside the block, starting from the checked position). A mark whose sentence changed
// disappears until the block is checked again.
import { Extension, Node, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { openQuote } from "../../../src/lib/reviewer";
import { t } from "../language";

/**
 * Drawing state: the check's three, "resolvida" (the person recorded reporting: opinion, ignore, other side) and the
 * code findings: a sum that does not add up, a quote without a source in the dossier, a quote that matches the
 * recording, the style guide.
 */
export type BrandState = "com_evidencia" | "sem_fonte" | "risco" | "resolvida" | "conta" | "aspa" | "gravacao" | "manual";
export interface EditorBrand { id: string; blocoId: string; inicio: number; fim: number; trecho: string; estado: BrandState }

const BLOCKS = ["paragraph", "heading"];
export const newIdBlock = () => `b${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

/** An id on every paragraph and subheading; a new block (Enter) or one pasted with a repeated id gets a new id. */
export const BlockId = Extension.create({
  name: "idDeBloco",
  addGlobalAttributes() {
    return [{
      types: BLOCKS,
      attributes: {
        id: {
          default: null,
          parseHTML: (el) => el.getAttribute("data-id"),
          renderHTML: (attrs) => (attrs.id ? { "data-id": attrs.id } : {}),
          keepOnSplit: false,
        },
      },
    }];
  },
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey("idDeBloco"),
      appendTransaction: (trs, _old, created) => {
        if (!trs.some((tr) => tr.docChanged)) return null;
        const seen = new Set<string>();
        const tr = created.tr;
        let changed = false;
        created.doc.descendants((n, after) => {
          if (!BLOCKS.includes(n.type.name)) return true;
          const id = n.attrs.id as string | null;
          if (!id || seen.has(id)) {
            const newId = newIdBlock();
            tr.setNodeMarkup(after, undefined, { ...n.attrs, id: newId });
            seen.add(newId);
            changed = true;
          } else seen.add(id);
          return false;
        });
        return changed ? tr.setMeta("addToHistory", false) : null;
      },
    })];
  },
});

/** The block's text as the server sees it (src/lib/doc.ts, fromInText) and, for each character, its position in the document. */
export function withPositionsText(node: PMNode, after: number): { texto: string; ini: number[]; fim: number[] } {
  let text = "";
  const ini: number[] = [], end: number[] = [];
  node.forEach((child, offset) => {
    const p = after + 1 + offset;
    if (child.isText) {
      const s = child.text ?? "";
      for (let k = 0; k < s.length; k++) { ini.push(p + k); end.push(p + k + 1); }
      text += s;
    } else {
      const s = child.type.name === "hardBreak" ? " " : child.type.name === "nota" ? String(child.attrs.rotulo ?? "") : "";
      for (let k = 0; k < s.length; k++) { ini.push(p); end.push(p + child.nodeSize); }
      text += s;
    }
  });
  return { texto: text, ini, fim: end };
}

/** Where the mark is now: the checked position if the passage is still there; otherwise the occurrence closest to it. */
export function locate(text: string, m: { inicio: number; fim: number; trecho: string }): number | null {
  if (text.slice(m.inicio, m.fim) === m.trecho) return m.inicio;
  let best: number | null = null;
  for (let i = text.indexOf(m.trecho); i >= 0; i = text.indexOf(m.trecho, i + 1)) {
    if (best === null || Math.abs(i - m.inicio) < Math.abs(best - m.inicio)) best = i;
  }
  return best;
}

export interface Place { marca: EditorBrand; de: number; ate: number }

/** The document's blocks by id, with their position. */
export function blocksPerId(doc: PMNode): Map<string, { no: PMNode; pos: number }> {
  const blocks = new Map<string, { no: PMNode; pos: number }>();
  doc.descendants((n, after) => {
    if (BLOCKS.includes(n.type.name)) { if (n.attrs.id) blocks.set(n.attrs.id as string, { no: n, pos: after }); return false; }
    return true;
  });
  return blocks;
}

/** The marks with their current position in the document, in text order (those not found are left out). */
export function placesMarks(doc: PMNode, marks: EditorBrand[]): Place[] {
  const blocks = blocksPerId(doc);
  const cache = new Map<string, ReturnType<typeof withPositionsText>>();
  const out: Place[] = [];
  for (const m of marks) {
    const b = blocks.get(m.blocoId);
    if (!b) continue;
    let tp = cache.get(m.blocoId);
    if (!tp) { tp = withPositionsText(b.no, b.pos); cache.set(m.blocoId, tp); }
    const i = locate(tp.texto, m);
    if (i === null || !m.trecho.length) continue;
    out.push({ marca: m, de: tp.ini[i], ate: tp.fim[i + m.trecho.length - 1] });
  }
  return out.sort((a, b) => a.de - b.de);
}

const LABEL: Record<BrandState, () => string> = {
  com_evidencia: () => t("com evidência", "with evidence"),
  sem_fonte: () => t("sem fonte", "no source"),
  risco: () => t("risco jurídico", "legal risk"),
  resolvida: () => t("apuração registrada", "reporting recorded"),
  conta: () => t("conta que não fecha", "math that doesn't add up"),
  aspa: () => t("aspa sem fonte", "unsourced quote"),
  gravacao: () => t("bate com a gravação", "matches the recording"),
  manual: () => t("manual de redação", "style guide"),
};
/** A light background and a straight rule underneath in the state's colour (DESIGN §5); with evidence, only a thin rule (it does not clutter). */
export const BRAND_CLASS: Record<BrandState, string> = {
  com_evidencia: "marca-ed shadow-[inset_0_-1px_0_var(--color-verde)]",
  sem_fonte: "marca-ed bg-ambar-claro shadow-[inset_0_-2px_0_var(--color-ambar)]",
  risco: "marca-ed bg-terracota-claro shadow-[inset_0_-2px_0_var(--color-terracota)]",
  resolvida: "marca-ed shadow-[inset_0_-1px_0_var(--color-fio-forte)]",
  conta: "marca-ed bg-terracota-claro shadow-[inset_0_-2px_0_var(--color-terracota)]",
  aspa: "marca-ed bg-ambar-claro shadow-[inset_0_-2px_0_var(--color-ambar)]",
  gravacao: "marca-ed shadow-[inset_0_-1px_0_var(--color-verde)]",
  manual: "marca-ed shadow-[inset_0_-1px_0_var(--color-texto)]",
};
const ICON_COLOR: Record<BrandState, string> = {
  com_evidencia: "text-verde", sem_fonte: "text-ambar", risco: "text-terracota", resolvida: "text-apoio", conta: "text-terracota", aspa: "text-ambar", gravacao: "text-verde", manual: "text-texto",
};
type Stroke = ["path", string] | ["circle", string, string];
const STROKES: Record<BrandState, Stroke[]> = {
  com_evidencia: [["path", "M3 8.5l3 3 7-7"]],
  sem_fonte: [["path", "M5.8 5.6a2.3 2.3 0 1 1 3.2 2.1c-.6.3-1 .8-1 1.5v.4"], ["circle", "8", "12.6"]],
  risco: [["path", "M8 2.5l6 11H2z"], ["path", "M8 6.5v3.2"], ["circle", "8", "11.6"]],
  resolvida: [["path", "M3 8h10"]],
  conta: [["path", "M3 6h10"], ["path", "M3 10h10"], ["path", "M11 3L5 13"]],
  aspa: [["path", "M4 5v3.5c0 1.2-.6 2.2-1.5 2.8"], ["path", "M10 5v3.5c0 1.2-.6 2.2-1.5 2.8"]],
  gravacao: [["path", "M3 7v2"], ["path", "M6 5v6"], ["path", "M9 3v10"], ["path", "M12 6v4"]],
  manual: [["path", "M3 3.5h4a1.5 1.5 0 0 1 1.5 1.5v8a1 1 0 0 0-1-1H3z"], ["path", "M13 3.5H9.5A1.5 1.5 0 0 0 8 5v8a1 1 0 0 1 1-1h4z"]],
};
const NS = "http://www.w3.org/2000/svg";

/** The icon before the mark (check, question mark, triangle) and the state's name for screen readers. */
function iconBrand(m: EditorBrand): HTMLElement {
  const s = document.createElement("span");
  s.contentEditable = "false";
  s.dataset.marca = m.id;
  s.className = `marca-icone mr-0.5 inline-block align-[-2px] ${ICON_COLOR[m.estado]}`;
  const svg = document.createElementNS(NS, "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 16 16", "aria-hidden": "true", focusable: "false", class: "inline-block size-3.5", fill: "none", stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round" })) svg.setAttribute(k, v);
  for (const tr of STROKES[m.estado]) {
    const el = document.createElementNS(NS, tr[0]);
    if (tr[0] === "path") el.setAttribute("d", tr[1]);
    else { el.setAttribute("cx", tr[1]); el.setAttribute("cy", tr[2]); el.setAttribute("r", ".5"); el.setAttribute("fill", "currentColor"); }
    svg.appendChild(el);
  }
  s.appendChild(svg);
  const sr = document.createElement("span");
  sr.className = "sr-only";
  sr.textContent = `${LABEL[m.estado]()}: `;
  s.appendChild(sr);
  return s;
}

interface MarksState { marcas: EditorBrand[]; ativa: string | null; acesas: Map<string, number>; notas: NoteInText[]; deco: DecorationSet }
export const marksKey = new PluginKey<MarksState>("marcas");
/** The note's place below the paragraph: the screen draws inside `host`, and none of this enters the document. */
export interface NoteInText { blocoId: string; host: HTMLElement }

function draw(state: EditorState, { marcas: marks, ativa: active, acesas: litMarks, notas: notes }: Omit<MarksState, "deco">): DecorationSet {
  const decos: Decoration[] = [];
  for (const l of placesMarks(state.doc, marks)) {
    const lit = litMarks.get(l.marca.id);
    const cls = `${BRAND_CLASS[l.marca.estado]}${l.marca.id === active ? " marca-ativa" : ""}${lit === undefined ? "" : " marca-acende"}`;
    decos.push(Decoration.inline(l.de, l.ate, { class: cls, "data-marca": l.marca.id, ...(lit === undefined ? {} : { style: `--acende-ordem:${lit}` }) }, { id: l.marca.id }));
    decos.push(Decoration.widget(l.de, () => iconBrand(l.marca), { side: -1, key: `${l.marca.id}:${l.marca.estado}`, ignoreSelection: true }));
  }
  if (notes.length) {
    const blocks = blocksPerId(state.doc);
    for (const n of notes) {
      const b = blocks.get(n.blocoId);
      if (b) decos.push(Decoration.widget(b.pos + b.no.nodeSize, n.host, { side: -1, key: `nota:${n.blocoId}`, ignoreSelection: true, stopEvent: () => true }));
    }
  }
  return DecorationSet.create(state.doc, decos);
}

/**
 * The screen listens to events on the editor element: `marca-escolher` (detail: the clicked mark's id), `marca-pular`
 * (detail: 1 or -1, F8 and Shift+F8), `comandos` (Ctrl/⌘K) and `link-colado` (detail: the address pasted on its own). By
 * event and not by option: Tiptap copies the options on configure, and the screen swaps the functions on every render.
 */
export const Marks = Extension.create({
  name: "marcas",
  addKeyboardShortcuts() {
    const trigger = (name: string, detail?: unknown) => { this.editor.view.dom.dispatchEvent(new CustomEvent(name, { detail })); return true; };
    return { F8: () => trigger("marca-pular", 1), "Shift-F8": () => trigger("marca-pular", -1), "Mod-k": () => trigger("comandos") };
  },
  addProseMirrorPlugins() {
    return [new Plugin<MarksState>({
      key: marksKey,
      state: {
        init: (_c, state) => ({ marcas: [], ativa: null, acesas: new Map(), notas: [], deco: DecorationSet.create(state.doc, []) }),
        apply(tr, v, _old, created) {
          const meta = tr.getMeta(marksKey) as Partial<Omit<MarksState, "deco">> | undefined;
          if (!meta && !tr.docChanged) return v;
          const next = {
            marcas: meta?.marcas ?? v.marcas, ativa: meta && "ativa" in meta ? meta.ativa ?? null : v.ativa,
            acesas: meta?.acesas ?? v.acesas, notas: meta?.notas ?? v.notas,
          };
          return { ...next, deco: draw(created, next) };
        },
      },
      props: {
        decorations: (state) => marksKey.getState(state)?.deco,
        // Pasting an address on its own: the text pastes normally (becomes a link) and the screen offers to put it in the dossier.
        handlePaste: (view, ev) => {
          const text = ev.clipboardData?.getData("text/plain")?.trim() ?? "";
          if (/^https?:\/\/\S+$/.test(text) && text.length <= 2000) view.dom.dispatchEvent(new CustomEvent("link-colado", { detail: text }));
          return false;
        },
        handleDOMEvents: {
          click: (view, ev) => {
            const target = (ev.target as HTMLElement | null)?.closest?.("[data-marca]") as HTMLElement | null;
            if (target?.dataset.marca) view.dom.dispatchEvent(new CustomEvent("marca-escolher", { detail: target.dataset.marca }));
            return false;
          },
        },
      },
    })];
  },
});

/**
 * Dossier citation (`@`): a note node in the document, the person's text, with the label in brackets and the evidence
 * id. The server stores only `rotulo` and `evidencia` (src/lib/doc.ts, cleanDoc).
 */
export const Note = Node.create({
  name: "nota",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      rotulo: { default: "", parseHTML: (el) => el.getAttribute("data-rotulo") ?? el.textContent ?? "" },
      evidencia: { default: "", parseHTML: (el) => el.getAttribute("data-nota") ?? "" },
    };
  },
  parseHTML() { return [{ tag: "span[data-nota]" }]; },
  renderHTML({ node, HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-nota": node.attrs.evidencia, "data-rotulo": node.attrs.rotulo, class: "nota-ed" }), String(node.attrs.rotulo)];
  },
  renderText({ node }) { return String(node.attrs.rotulo); },
});

/** An image in the text: a whole block, with the description required on the upload screen. Outside the check (src/lib/doc.ts). */
export const ImageFile = Node.create({
  name: "imagem",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { src: { default: "" }, alt: { default: "" } };
  },
  parseHTML() { return [{ tag: "img[data-imagem]" }]; },
  renderHTML({ HTMLAttributes }) { return ["img", mergeAttributes(HTMLAttributes, { "data-imagem": "", class: "imagem-texto" })]; },
});

/** The support block (sponsorship): the advertising label comes in its own text, and it cannot be half edited. */
export const Support = Node.create({
  name: "apoio",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      patrocinio: { default: "", parseHTML: (el) => el.getAttribute("data-apoio") ?? "" },
      texto: { default: "", parseHTML: (el) => el.textContent ?? "" },
    };
  },
  parseHTML() { return [{ tag: "div[data-apoio]" }]; },
  renderHTML({ node }) { return ["div", { "data-apoio": node.attrs.patrocinio, class: "apoio-texto" }, String(node.attrs.texto)]; },
  renderText({ node }) { return String(node.attrs.texto); },
});

/** The quote mark opened before the cursor, with what came after it in the paragraph. `de` identifies the quote while it is there. */
export function queryQuote(state: EditorState): { de: number; digitado: string; fecha: string } | null {
  const { $from, empty } = state.selection;
  if (!empty || !$from.parent.isTextblock) return null;
  const a = openQuote($from.parent.textBetween(0, $from.parentOffset, undefined, "￼"));
  return a && !a.digitado.includes("￼") ? { de: $from.start() + a.inicio, digitado: a.digitado, fecha: a.fecha } : null;
}

/** What the person typed after `@` in the paragraph (up to 40 letters, without breaking the line), and where. */
export function queryHandle(state: EditorState): { de: number; ate: number; busca: string } | null {
  const { $from, empty } = state.selection;
  if (!empty || !$from.parent.isTextblock) return null;
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
  const m = /(?:^|\s)@([^\s@￼][^@￼]{0,39}|)$/u.exec(before);
  if (!m) return null;
  const search = m[1];
  return { de: $from.pos - search.length - 1, ate: $from.pos, busca: search };
}
