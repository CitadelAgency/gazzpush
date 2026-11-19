// Command palette (⌘K / Ctrl K): go to any section, open a post by title, switch outlet or language, sign out. A native
// dialog (focus trapped, Esc closes, dimmed background) with the list in the combobox pattern: focus stays in the field
// and the active option goes in `aria-activedescendant`. Search ignores accents and case. The Story editor's palette
// (also ⌘K) keeps the key when focus is in the text: this shortcut only acts if the event was not handled before.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { DESK, formatLabel, usePieces, readyUse } from "../queue";
import { t } from "../language";
import { chooseLanguage, localOf, type Outlet } from "../session";
import { outletParts, sections } from "./context";
import { closesTogether } from "./dialog";
import {
  IconApprove, IconSearch, IconAccounts, IconEnter, IconTeam, IconSources, IconIdeas, IconKit, IconMore, IconPlan, IconBrand, IconPosted, IconPost, IconRay, IconTexts,
} from "./icons";

type Command = { id: string; grupo: string; rotulo: string; dica?: string; lang?: string; busca: string; icone: ReactNode; rodar: () => void };

const plan = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** "⌘K" on Mac, "Ctrl K" elsewhere: the shortcut the way the person types it. */
export const shortcutPalette = () => (typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K");

export default function Palette({ aberta: isOpen, fechar: dismiss, veiculo: outlet, veiculos: outlets, onNova: newOn, onSair: onSignOut }: {
  aberta: boolean; fechar: () => void; veiculo: Outlet; veiculos: Outlet[]; onNova: () => void; onSair: () => void;
}) {
  const dlg = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [active, activeSet] = useState(0);
  const id = useId();
  const pieces = usePieces(outlet.id);
  const ready = readyUse(outlet.id);

  useEffect(() => {
    const d = dlg.current;
    if (!d) return;
    if (isOpen && !d.open) { setQ(""); activeSet(0); d.showModal(); field.current?.focus(); }
    if (!isOpen && d.open) d.close();
  }, [isOpen]);

  const base = `/t/${outlet.slug}`;
  const commands = useMemo<Command[]>(() => {
    const c: Command[] = [];
    const go = (to: string) => () => navigate(to);
    const iconsSection = { "": <IconIdeas className="size-5" />, aprovar: <IconApprove className="size-5" />, postar: <IconPost className="size-5" />, postados: <IconPosted className="size-5" /> };
    c.push({ id: "nova", grupo: t("Ações", "Actions"), rotulo: t("Nova ideia", "New idea"), dica: t("link, texto, print ou Docs", "link, text, screenshot or Docs"), busca: "nova ideia criar trazer link texto print", icone: <IconMore className="size-5" />, rodar: newOn });
    if (outlet.modo === "autoral") c.push({ id: "textos", grupo: t("Ir para", "Go to"), rotulo: t("Textos", "Texts"), busca: "textos mesa revisora materia", icone: <IconTexts className="size-5" />, rodar: go(`${base}/textos`) });
    for (const s of sections()) c.push({ id: `sec-${s.to}`, grupo: t("Ir para", "Go to"), rotulo: s.rotulo, busca: s.rotulo, icone: iconsSection[s.to], rodar: go(s.to ? `${base}/${s.to}` : base) });
    const iconsOutlet = { marca: <IconBrand className="size-5" />, contas: <IconAccounts className="size-5" />, fontes: <IconSources className="size-5" />, equipe: <IconTeam className="size-5" />, kit: <IconKit className="size-5" />, plano: <IconPlan className="size-5" />, chaves: <IconRay className="size-5" /> };
    for (const p of outletParts()) c.push({ id: `v-${p.aba}`, grupo: t("Ir para", "Go to"), rotulo: p.rotulo, dica: t("veículo", "publication"), busca: `${p.rotulo} veiculo publication`, icone: iconsOutlet[p.aba], rodar: go(`${base}/veiculo?aba=${p.aba}`) });
    for (const p of pieces.data?.pecas ?? []) {
      const name = p.manchete ?? p.titulo;
      c.push({
        id: `p-${p.id}`, grupo: t("Posts", "Posts"), rotulo: name,
        dica: [formatLabel(p.formato, p.ncards), p.status === "revisao" ? t("para aprovar", "to approve") : t("produzindo", "in production")].join(" · "),
        busca: `${name} ${DESK[p.editoria ?? ""] ?? p.editoria ?? ""} ${formatLabel(p.formato, p.ncards)}`,
        icone: <IconApprove className="size-5" />, rodar: go(`${base}/p/${p.id}`),
      });
    }
    for (const p of ready.data?.pecas ?? []) {
      const name = p.manchete ?? p.titulo;
      c.push({ id: `pr-${p.id}`, grupo: t("Posts", "Posts"), rotulo: name, dica: [formatLabel(p.formato, p.ncards), t("para postar", "to post")].join(" · "), busca: `${name} ${DESK[p.editoria ?? ""] ?? p.editoria ?? ""}`, icone: <IconPost className="size-5" />, rodar: go(`${base}/p/${p.id}`) });
    }
    for (const v of outlets) if (v.slug !== outlet.slug) c.push({ id: `veic-${v.slug}`, grupo: t("Veículos", "Publications"), rotulo: v.nome, dica: v.handle ?? localOf(v), busca: `${v.nome} trocar veiculo publication`, icone: <IconRay className="size-5" />, rodar: go(`/t/${v.slug}`) });
    c.push({ id: "criar-veiculo", grupo: t("Veículos", "Publications"), rotulo: t("Criar outro veículo", "Create another publication"), busca: "criar novo veiculo publication", icone: <IconMore className="size-5" />, rodar: go("/novo") });
    c.push({ id: "pt", grupo: t("Idioma", "Language"), rotulo: "Português", lang: "pt-BR", busca: "idioma language portugues pt-br", icone: <IconRay className="size-5" />, rodar: () => void chooseLanguage("pt-BR", true) });
    c.push({ id: "en", grupo: t("Idioma", "Language"), rotulo: "English", lang: "en", busca: "idioma language ingles english", icone: <IconRay className="size-5" />, rodar: () => void chooseLanguage("en", true) });
    c.push({ id: "sair", grupo: t("Conta", "Account"), rotulo: t("Sair", "Sign out"), busca: "sair sign out logout", icone: <IconRay className="size-5" />, rodar: onSignOut });
    return c;
  }, [base, navigate, newOn, onSignOut, pieces.data, ready.data, outlet.modo, outlet.slug, outlets]);

  const findings = useMemo(() => {
    const terms = plan(q).split(/\s+/).filter(Boolean);
    const inside = commands.filter((c) => terms.every((x) => plan(`${c.rotulo} ${c.busca}`).includes(x)));
    // Without typing anything, posts are left out (the list would be long); with text, everything comes in, at most 40.
    return (terms.length ? inside : inside.filter((c) => c.grupo !== t("Posts", "Posts") && c.grupo !== t("Idioma", "Language"))).slice(0, 40);
  }, [commands, q]);

  useEffect(() => { activeSet(0); }, [q]);
  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [active]);

  const run = (c: Command | undefined) => { if (!c) return; dismiss(); c.rodar(); };
  const keys = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); activeSet((i) => Math.min(findings.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); activeSet((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); run(findings[active]); }
  };

  // Groups in the order they appear, with each item's index for arrow navigation.
  const groups: { nome: string; itens: { c: Command; i: number }[] }[] = [];
  findings.forEach((c, i) => {
    const g = groups.find((x) => x.nome === c.grupo);
    if (g) g.itens.push({ c, i }); else groups.push({ nome: c.grupo, itens: [{ c, i }] });
  });

  return (
    <dialog ref={dlg} aria-label={t("Ir para…", "Go to…")} {...closesTogether(dlg, dismiss)} onClick={(e) => { if (e.target === dlg.current) dismiss(); }} className="paleta">
      <div className="paleta-campo">
        <IconSearch className="size-5 flex-none text-apoio" />
        <input ref={field} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={keys} role="combobox" aria-expanded={findings.length > 0} aria-controls={findings.length ? `${id}-lista` : undefined}
          aria-activedescendant={findings[active] ? `${id}-${active}` : undefined} aria-autocomplete="list" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
          placeholder={t("Ir para uma seção, abrir um post, trocar de veículo…", "Go to a section, open a post, switch publication…")}
          aria-label={t("Ir para", "Go to")} className="paleta-entrada" />
        <span className="kbd" aria-hidden="true">esc</span>
      </div>
      {/* What a screen reader user hears on each letter: how many results, or that there are none. */}
      <p role="status" className={findings.length ? "sr-only" : "px-4 py-8 text-center text-apoio"}>
        {findings.length ? t(`${findings.length} resultado${findings.length > 1 ? "s" : ""}`, `${findings.length} result${findings.length > 1 ? "s" : ""}`) : t("Nada com esse texto.", "Nothing matches that.")}
      </p>
      {findings.length > 0 && <ul ref={list} id={`${id}-lista`} role="listbox" aria-label={t("Comandos", "Commands")} className="paleta-lista">
        {groups.map((g) => (
          <li key={g.nome} role="presentation">
            <p className="mono m-0 px-4 pt-3 pb-1 text-[11px] tracking-[.08em] text-apoio uppercase" aria-hidden="true">{g.nome}</p>
            <ul role="group" aria-label={g.nome} className="m-0 list-none p-0">
              {g.itens.map(({ c, i }) => (
                <li key={c.id} id={`${id}-${i}`} data-i={i} role="option" lang={c.lang} aria-selected={i === active}
                  onMouseMove={() => { if (i !== active) activeSet(i); }} onClick={() => run(c)} className="paleta-item">
                  <span className="flex-none text-apoio">{c.icone}</span>
                  <span className="min-w-0 flex-1 truncate">{c.rotulo}</span>
                  {c.dica && <span className="mono flex-none text-[12px] text-apoio">{c.dica}</span>}
                  {i === active && <IconEnter className="size-4 flex-none text-apoio" />}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>}
      <p className="paleta-pe mono m-0" aria-hidden="true">
        <span><span className="kbd">↑</span> <span className="kbd">↓</span> {t("mover", "move")}</span>
        <span><span className="kbd">↵</span> {t("abrir", "open")}</span>
        <span className="ml-auto">{shortcutPalette()}</span>
      </p>
    </dialog>
  );
}
