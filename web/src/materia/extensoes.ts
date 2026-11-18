// Extensões do editor da Matéria (Tiptap/ProseMirror): id estável por bloco e as marcas da conferência como camada por
// cima do texto (decorations). A marca nunca entra no documento: ela é desenhada sobre a frase e acompanha a
// digitação (a frase é achada pelo trecho literal dentro do bloco, a partir da posição conferida). Marca cuja frase
// mudou some até o bloco ser conferido de novo.
import { Extension, Node, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { aspaAberta } from "../../../src/lib/revisor";
import { t } from "../idioma";

/**
 * Estado do desenho: os três da conferência, "resolvida" (a pessoa registrou apuração: opinião, ignorar, outro lado) e
 * os apontamentos do código: conta que não fecha, aspa sem fonte no dossiê, aspa que bate com a gravação, manual de redação.
 */
export type EstadoMarca = "com_evidencia" | "sem_fonte" | "risco" | "resolvida" | "conta" | "aspa" | "gravacao" | "manual";
export interface MarcaEditor { id: string; blocoId: string; inicio: number; fim: number; trecho: string; estado: EstadoMarca }

const BLOCOS = ["paragraph", "heading"];
export const novoIdBloco = () => `b${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

/** Id em todo parágrafo e intertítulo; bloco novo (Enter) ou colado com id repetido ganha um id novo. */
export const IdDeBloco = Extension.create({
  name: "idDeBloco",
  addGlobalAttributes() {
    return [{
      types: BLOCOS,
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
      appendTransaction: (trs, _velho, novo) => {
        if (!trs.some((tr) => tr.docChanged)) return null;
        const vistos = new Set<string>();
        const tr = novo.tr;
        let mudou = false;
        novo.doc.descendants((n, pos) => {
          if (!BLOCOS.includes(n.type.name)) return true;
          const id = n.attrs.id as string | null;
          if (!id || vistos.has(id)) {
            const novoId = novoIdBloco();
            tr.setNodeMarkup(pos, undefined, { ...n.attrs, id: novoId });
            vistos.add(novoId);
            mudou = true;
          } else vistos.add(id);
          return false;
        });
        return mudou ? tr.setMeta("addToHistory", false) : null;
      },
    })];
  },
});

/** Texto do bloco como o servidor vê (src/lib/doc.ts, textoDoNo) e, para cada caractere, a posição no documento. */
export function textoComPosicoes(no: PMNode, pos: number): { texto: string; ini: number[]; fim: number[] } {
  let texto = "";
  const ini: number[] = [], fim: number[] = [];
  no.forEach((filho, offset) => {
    const p = pos + 1 + offset;
    if (filho.isText) {
      const s = filho.text ?? "";
      for (let k = 0; k < s.length; k++) { ini.push(p + k); fim.push(p + k + 1); }
      texto += s;
    } else {
      const s = filho.type.name === "hardBreak" ? " " : filho.type.name === "nota" ? String(filho.attrs.rotulo ?? "") : "";
      for (let k = 0; k < s.length; k++) { ini.push(p); fim.push(p + filho.nodeSize); }
      texto += s;
    }
  });
  return { texto, ini, fim };
}

/** Onde a marca está agora: a posição conferida se o trecho ainda está lá; senão a ocorrência mais perto dela. */
export function localizar(texto: string, m: { inicio: number; fim: number; trecho: string }): number | null {
  if (texto.slice(m.inicio, m.fim) === m.trecho) return m.inicio;
  let melhor: number | null = null;
  for (let i = texto.indexOf(m.trecho); i >= 0; i = texto.indexOf(m.trecho, i + 1)) {
    if (melhor === null || Math.abs(i - m.inicio) < Math.abs(melhor - m.inicio)) melhor = i;
  }
  return melhor;
}

export interface Lugar { marca: MarcaEditor; de: number; ate: number }

/** Blocos do documento por id, com a posição. */
export function blocosPorId(doc: PMNode): Map<string, { no: PMNode; pos: number }> {
  const blocos = new Map<string, { no: PMNode; pos: number }>();
  doc.descendants((n, pos) => {
    if (BLOCOS.includes(n.type.name)) { if (n.attrs.id) blocos.set(n.attrs.id as string, { no: n, pos }); return false; }
    return true;
  });
  return blocos;
}

/** As marcas com a posição atual no documento, na ordem do texto (as que não se acham ficam de fora). */
export function lugaresDasMarcas(doc: PMNode, marcas: MarcaEditor[]): Lugar[] {
  const blocos = blocosPorId(doc);
  const cache = new Map<string, ReturnType<typeof textoComPosicoes>>();
  const out: Lugar[] = [];
  for (const m of marcas) {
    const b = blocos.get(m.blocoId);
    if (!b) continue;
    let tp = cache.get(m.blocoId);
    if (!tp) { tp = textoComPosicoes(b.no, b.pos); cache.set(m.blocoId, tp); }
    const i = localizar(tp.texto, m);
    if (i === null || !m.trecho.length) continue;
    out.push({ marca: m, de: tp.ini[i], ate: tp.fim[i + m.trecho.length - 1] });
  }
  return out.sort((a, b) => a.de - b.de);
}

const ROTULO: Record<EstadoMarca, () => string> = {
  com_evidencia: () => t("com evidência", "with evidence"),
  sem_fonte: () => t("sem fonte", "no source"),
  risco: () => t("risco jurídico", "legal risk"),
  resolvida: () => t("apuração registrada", "reporting recorded"),
  conta: () => t("conta que não fecha", "math that doesn't add up"),
  aspa: () => t("aspa sem fonte", "unsourced quote"),
  gravacao: () => t("bate com a gravação", "matches the recording"),
  manual: () => t("manual de redação", "style guide"),
};
/** Fundo claro e fio reto embaixo na cor do estado (DESIGN §5); com evidência, só um fio fino (não polui). */
export const CLASSE_MARCA: Record<EstadoMarca, string> = {
  com_evidencia: "marca-ed shadow-[inset_0_-1px_0_var(--color-verde)]",
  sem_fonte: "marca-ed bg-ambar-claro shadow-[inset_0_-2px_0_var(--color-ambar)]",
  risco: "marca-ed bg-terracota-claro shadow-[inset_0_-2px_0_var(--color-terracota)]",
  resolvida: "marca-ed shadow-[inset_0_-1px_0_var(--color-fio-forte)]",
  conta: "marca-ed bg-terracota-claro shadow-[inset_0_-2px_0_var(--color-terracota)]",
  aspa: "marca-ed bg-ambar-claro shadow-[inset_0_-2px_0_var(--color-ambar)]",
  gravacao: "marca-ed shadow-[inset_0_-1px_0_var(--color-verde)]",
  manual: "marca-ed shadow-[inset_0_-1px_0_var(--color-texto)]",
};
const COR_ICONE: Record<EstadoMarca, string> = {
  com_evidencia: "text-verde", sem_fonte: "text-ambar", risco: "text-terracota", resolvida: "text-apoio", conta: "text-terracota", aspa: "text-ambar", gravacao: "text-verde", manual: "text-texto",
};
type Traco = ["path", string] | ["circle", string, string];
const TRACOS: Record<EstadoMarca, Traco[]> = {
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

/** Ícone antes da marca (visto, interrogação, triângulo) e o nome do estado para leitor de tela. */
function iconeDaMarca(m: MarcaEditor): HTMLElement {
  const s = document.createElement("span");
  s.contentEditable = "false";
  s.dataset.marca = m.id;
  s.className = `marca-icone mr-0.5 inline-block align-[-2px] ${COR_ICONE[m.estado]}`;
  const svg = document.createElementNS(NS, "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 16 16", "aria-hidden": "true", focusable: "false", class: "inline-block size-3.5", fill: "none", stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round" })) svg.setAttribute(k, v);
  for (const tr of TRACOS[m.estado]) {
    const el = document.createElementNS(NS, tr[0]);
    if (tr[0] === "path") el.setAttribute("d", tr[1]);
    else { el.setAttribute("cx", tr[1]); el.setAttribute("cy", tr[2]); el.setAttribute("r", ".5"); el.setAttribute("fill", "currentColor"); }
    svg.appendChild(el);
  }
  s.appendChild(svg);
  const sr = document.createElement("span");
  sr.className = "sr-only";
  sr.textContent = `${ROTULO[m.estado]()}: `;
  s.appendChild(sr);
  return s;
}

interface EstadoMarcas { marcas: MarcaEditor[]; ativa: string | null; acesas: Map<string, number>; notas: NotaNoTexto[]; deco: DecorationSet }
export const chaveMarcas = new PluginKey<EstadoMarcas>("marcas");
/** Lugar da nota abaixo do parágrafo: a tela desenha dentro de `host`, e nada disso entra no documento. */
export interface NotaNoTexto { blocoId: string; host: HTMLElement }

function desenhar(state: EditorState, { marcas, ativa, acesas, notas }: Omit<EstadoMarcas, "deco">): DecorationSet {
  const decos: Decoration[] = [];
  for (const l of lugaresDasMarcas(state.doc, marcas)) {
    const acesa = acesas.get(l.marca.id);
    const cls = `${CLASSE_MARCA[l.marca.estado]}${l.marca.id === ativa ? " marca-ativa" : ""}${acesa === undefined ? "" : " marca-acende"}`;
    decos.push(Decoration.inline(l.de, l.ate, { class: cls, "data-marca": l.marca.id, ...(acesa === undefined ? {} : { style: `--acende-ordem:${acesa}` }) }, { id: l.marca.id }));
    decos.push(Decoration.widget(l.de, () => iconeDaMarca(l.marca), { side: -1, key: `${l.marca.id}:${l.marca.estado}`, ignoreSelection: true }));
  }
  if (notas.length) {
    const blocos = blocosPorId(state.doc);
    for (const n of notas) {
      const b = blocos.get(n.blocoId);
      if (b) decos.push(Decoration.widget(b.pos + b.no.nodeSize, n.host, { side: -1, key: `nota:${n.blocoId}`, ignoreSelection: true, stopEvent: () => true }));
    }
  }
  return DecorationSet.create(state.doc, decos);
}

/**
 * A tela ouve eventos no elemento do editor: `marca-escolher` (detail: id da marca clicada), `marca-pular` (detail: 1
 * ou -1, F8 e Shift+F8), `comandos` (Ctrl/⌘K) e `link-colado` (detail: o endereço colado sozinho). Por evento e não por
 * opção: o Tiptap copia as opções ao configurar, e a tela troca as funções a cada render.
 */
export const Marcas = Extension.create({
  name: "marcas",
  addKeyboardShortcuts() {
    const disparar = (nome: string, detail?: unknown) => { this.editor.view.dom.dispatchEvent(new CustomEvent(nome, { detail })); return true; };
    return { F8: () => disparar("marca-pular", 1), "Shift-F8": () => disparar("marca-pular", -1), "Mod-k": () => disparar("comandos") };
  },
  addProseMirrorPlugins() {
    return [new Plugin<EstadoMarcas>({
      key: chaveMarcas,
      state: {
        init: (_c, state) => ({ marcas: [], ativa: null, acesas: new Map(), notas: [], deco: DecorationSet.create(state.doc, []) }),
        apply(tr, v, _velho, novo) {
          const meta = tr.getMeta(chaveMarcas) as Partial<Omit<EstadoMarcas, "deco">> | undefined;
          if (!meta && !tr.docChanged) return v;
          const prox = {
            marcas: meta?.marcas ?? v.marcas, ativa: meta && "ativa" in meta ? meta.ativa ?? null : v.ativa,
            acesas: meta?.acesas ?? v.acesas, notas: meta?.notas ?? v.notas,
          };
          return { ...prox, deco: desenhar(novo, prox) };
        },
      },
      props: {
        decorations: (state) => chaveMarcas.getState(state)?.deco,
        // Colar um endereço sozinho: o texto cola normal (vira link) e a tela oferece pôr no dossiê.
        handlePaste: (view, ev) => {
          const texto = ev.clipboardData?.getData("text/plain")?.trim() ?? "";
          if (/^https?:\/\/\S+$/.test(texto) && texto.length <= 2000) view.dom.dispatchEvent(new CustomEvent("link-colado", { detail: texto }));
          return false;
        },
        handleDOMEvents: {
          click: (view, ev) => {
            const alvo = (ev.target as HTMLElement | null)?.closest?.("[data-marca]") as HTMLElement | null;
            if (alvo?.dataset.marca) view.dom.dispatchEvent(new CustomEvent("marca-escolher", { detail: alvo.dataset.marca }));
            return false;
          },
        },
      },
    })];
  },
});

/**
 * Citação do dossiê (`@`): um nó de nota no documento, texto da pessoa, com o rótulo entre colchetes e o id da
 * evidência. O servidor guarda só `rotulo` e `evidencia` (src/lib/doc.ts, limparDoc).
 */
export const Nota = Node.create({
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

/** Imagem do texto: bloco inteiro, com a descrição obrigatória na tela de envio. Fora da conferência (src/lib/doc.ts). */
export const Imagem = Node.create({
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

/** Bloco de apoio (patrocínio): o rótulo de publicidade vem no próprio texto, e ele não se edita pela metade. */
export const Apoio = Node.create({
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

/** A aspa aberta antes do cursor, com o que veio depois dela no parágrafo. `de` identifica a aspa enquanto ela está lá. */
export function consultaAspa(state: EditorState): { de: number; digitado: string; fecha: string } | null {
  const { $from, empty } = state.selection;
  if (!empty || !$from.parent.isTextblock) return null;
  const a = aspaAberta($from.parent.textBetween(0, $from.parentOffset, undefined, "￼"));
  return a && !a.digitado.includes("￼") ? { de: $from.start() + a.inicio, digitado: a.digitado, fecha: a.fecha } : null;
}

/** O que a pessoa digitou depois de `@` no parágrafo (até 40 letras, sem quebrar a linha), e onde. */
export function consultaArroba(state: EditorState): { de: number; ate: number; busca: string } | null {
  const { $from, empty } = state.selection;
  if (!empty || !$from.parent.isTextblock) return null;
  const antes = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
  const m = /(?:^|\s)@([^\s@￼][^@￼]{0,39}|)$/u.exec(antes);
  if (!m) return null;
  const busca = m[1];
  return { de: $from.pos - busca.length - 1, ate: $from.pos, busca };
}
