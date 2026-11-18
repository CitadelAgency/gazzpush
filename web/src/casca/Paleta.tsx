// Paleta de comandos (⌘K / Ctrl K): ir a qualquer seção, abrir um post pelo título, trocar de veículo ou de idioma, sair.
// É diálogo nativo (foco preso, Esc fecha, fundo escurecido) com a lista no padrão combobox: o foco fica no campo e a
// opção ativa vai em `aria-activedescendant`. Sem acento e sem maiúscula na busca. A paleta do editor da Matéria
// (também ⌘K) fica com a tecla quando o foco está no texto: este atalho só age se o evento não foi tratado antes.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { EDITORIA, rotuloFormato, usePecas, useProntos } from "../fila";
import { t } from "../idioma";
import { escolherIdioma, localDe, type Veiculo } from "../sessao";
import { partesVeiculo, secoes } from "./contexto";
import { fechaJunto } from "./dialogo";
import {
  IconeAprovar, IconeBusca, IconeContas, IconeEnter, IconeEquipe, IconeFontes, IconeIdeias, IconeKit, IconeMais, IconePlano, IconeMarca, IconePostados, IconePostar, IconeRaio, IconeTextos,
} from "./icones";

type Comando = { id: string; grupo: string; rotulo: string; dica?: string; lang?: string; busca: string; icone: ReactNode; rodar: () => void };

const plano = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** "⌘K" no Mac, "Ctrl K" no resto: o atalho como a pessoa o digita. */
export const atalhoPaleta = () => (typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K");

export default function Paleta({ aberta, fechar, veiculo, veiculos, onNova, onSair }: {
  aberta: boolean; fechar: () => void; veiculo: Veiculo; veiculos: Veiculo[]; onNova: () => void; onSair: () => void;
}) {
  const dlg = useRef<HTMLDialogElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  const lista = useRef<HTMLUListElement>(null);
  const navegar = useNavigate();
  const [q, setQ] = useState("");
  const [ativo, setAtivo] = useState(0);
  const id = useId();
  const pecas = usePecas(veiculo.id);
  const prontos = useProntos(veiculo.id);

  useEffect(() => {
    const d = dlg.current;
    if (!d) return;
    if (aberta && !d.open) { setQ(""); setAtivo(0); d.showModal(); campo.current?.focus(); }
    if (!aberta && d.open) d.close();
  }, [aberta]);

  const base = `/t/${veiculo.slug}`;
  const comandos = useMemo<Comando[]>(() => {
    const c: Comando[] = [];
    const ir = (para: string) => () => navegar(para);
    const iconesSecao = { "": <IconeIdeias className="size-5" />, aprovar: <IconeAprovar className="size-5" />, postar: <IconePostar className="size-5" />, postados: <IconePostados className="size-5" /> };
    c.push({ id: "nova", grupo: t("Ações", "Actions"), rotulo: t("Nova ideia", "New idea"), dica: t("link, texto, print ou Docs", "link, text, screenshot or Docs"), busca: "nova ideia criar trazer link texto print", icone: <IconeMais className="size-5" />, rodar: onNova });
    if (veiculo.modo === "autoral") c.push({ id: "textos", grupo: t("Ir para", "Go to"), rotulo: t("Textos", "Texts"), busca: "textos mesa revisora materia", icone: <IconeTextos className="size-5" />, rodar: ir(`${base}/textos`) });
    for (const s of secoes()) c.push({ id: `sec-${s.to}`, grupo: t("Ir para", "Go to"), rotulo: s.rotulo, busca: s.rotulo, icone: iconesSecao[s.to], rodar: ir(s.to ? `${base}/${s.to}` : base) });
    const iconesVeiculo = { marca: <IconeMarca className="size-5" />, contas: <IconeContas className="size-5" />, fontes: <IconeFontes className="size-5" />, equipe: <IconeEquipe className="size-5" />, kit: <IconeKit className="size-5" />, plano: <IconePlano className="size-5" />, chaves: <IconeRaio className="size-5" /> };
    for (const p of partesVeiculo()) c.push({ id: `v-${p.aba}`, grupo: t("Ir para", "Go to"), rotulo: p.rotulo, dica: t("veículo", "publication"), busca: `${p.rotulo} veiculo publication`, icone: iconesVeiculo[p.aba], rodar: ir(`${base}/veiculo?aba=${p.aba}`) });
    for (const p of pecas.data?.pecas ?? []) {
      const nome = p.manchete ?? p.titulo;
      c.push({
        id: `p-${p.id}`, grupo: t("Posts", "Posts"), rotulo: nome,
        dica: [rotuloFormato(p.formato, p.ncards), p.status === "revisao" ? t("para aprovar", "to approve") : t("produzindo", "in production")].join(" · "),
        busca: `${nome} ${EDITORIA[p.editoria ?? ""] ?? p.editoria ?? ""} ${rotuloFormato(p.formato, p.ncards)}`,
        icone: <IconeAprovar className="size-5" />, rodar: ir(`${base}/p/${p.id}`),
      });
    }
    for (const p of prontos.data?.pecas ?? []) {
      const nome = p.manchete ?? p.titulo;
      c.push({ id: `pr-${p.id}`, grupo: t("Posts", "Posts"), rotulo: nome, dica: [rotuloFormato(p.formato, p.ncards), t("para postar", "to post")].join(" · "), busca: `${nome} ${EDITORIA[p.editoria ?? ""] ?? p.editoria ?? ""}`, icone: <IconePostar className="size-5" />, rodar: ir(`${base}/p/${p.id}`) });
    }
    for (const v of veiculos) if (v.slug !== veiculo.slug) c.push({ id: `veic-${v.slug}`, grupo: t("Veículos", "Publications"), rotulo: v.nome, dica: v.handle ?? localDe(v), busca: `${v.nome} trocar veiculo publication`, icone: <IconeRaio className="size-5" />, rodar: ir(`/t/${v.slug}`) });
    c.push({ id: "criar-veiculo", grupo: t("Veículos", "Publications"), rotulo: t("Criar outro veículo", "Create another publication"), busca: "criar novo veiculo publication", icone: <IconeMais className="size-5" />, rodar: ir("/novo") });
    c.push({ id: "pt", grupo: t("Idioma", "Language"), rotulo: "Português", lang: "pt-BR", busca: "idioma language portugues pt-br", icone: <IconeRaio className="size-5" />, rodar: () => void escolherIdioma("pt-BR", true) });
    c.push({ id: "en", grupo: t("Idioma", "Language"), rotulo: "English", lang: "en", busca: "idioma language ingles english", icone: <IconeRaio className="size-5" />, rodar: () => void escolherIdioma("en", true) });
    c.push({ id: "sair", grupo: t("Conta", "Account"), rotulo: t("Sair", "Sign out"), busca: "sair sign out logout", icone: <IconeRaio className="size-5" />, rodar: onSair });
    return c;
  }, [base, navegar, onNova, onSair, pecas.data, prontos.data, veiculo.modo, veiculo.slug, veiculos]);

  const achados = useMemo(() => {
    const termos = plano(q).split(/\s+/).filter(Boolean);
    const dentro = comandos.filter((c) => termos.every((x) => plano(`${c.rotulo} ${c.busca}`).includes(x)));
    // Sem digitar nada, os posts ficam de fora (a lista seria longa); com texto, tudo entra, no máximo 40.
    return (termos.length ? dentro : dentro.filter((c) => c.grupo !== t("Posts", "Posts") && c.grupo !== t("Idioma", "Language"))).slice(0, 40);
  }, [comandos, q]);

  useEffect(() => { setAtivo(0); }, [q]);
  useEffect(() => { lista.current?.querySelector<HTMLElement>(`[data-i="${ativo}"]`)?.scrollIntoView({ block: "nearest" }); }, [ativo]);

  const rodar = (c: Comando | undefined) => { if (!c) return; fechar(); c.rodar(); };
  const teclas = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setAtivo((i) => Math.min(achados.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setAtivo((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); rodar(achados[ativo]); }
  };

  // Grupos na ordem em que aparecem, com o índice de cada item para a navegação por seta.
  const grupos: { nome: string; itens: { c: Comando; i: number }[] }[] = [];
  achados.forEach((c, i) => {
    const g = grupos.find((x) => x.nome === c.grupo);
    if (g) g.itens.push({ c, i }); else grupos.push({ nome: c.grupo, itens: [{ c, i }] });
  });

  return (
    <dialog ref={dlg} aria-label={t("Ir para…", "Go to…")} {...fechaJunto(dlg, fechar)} onClick={(e) => { if (e.target === dlg.current) fechar(); }} className="paleta">
      <div className="paleta-campo">
        <IconeBusca className="size-5 flex-none text-apoio" />
        <input ref={campo} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={teclas} role="combobox" aria-expanded={achados.length > 0} aria-controls={achados.length ? `${id}-lista` : undefined}
          aria-activedescendant={achados[ativo] ? `${id}-${ativo}` : undefined} aria-autocomplete="list" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
          placeholder={t("Ir para uma seção, abrir um post, trocar de veículo…", "Go to a section, open a post, switch publication…")}
          aria-label={t("Ir para", "Go to")} className="paleta-entrada" />
        <span className="kbd" aria-hidden="true">esc</span>
      </div>
      {/* O que a pessoa de leitor de tela ouve a cada letra: quantos resultados, ou que não há nenhum. */}
      <p role="status" className={achados.length ? "sr-only" : "px-4 py-8 text-center text-apoio"}>
        {achados.length ? t(`${achados.length} resultado${achados.length > 1 ? "s" : ""}`, `${achados.length} result${achados.length > 1 ? "s" : ""}`) : t("Nada com esse texto.", "Nothing matches that.")}
      </p>
      {achados.length > 0 && <ul ref={lista} id={`${id}-lista`} role="listbox" aria-label={t("Comandos", "Commands")} className="paleta-lista">
        {grupos.map((g) => (
          <li key={g.nome} role="presentation">
            <p className="mono m-0 px-4 pt-3 pb-1 text-[11px] tracking-[.08em] text-apoio uppercase" aria-hidden="true">{g.nome}</p>
            <ul role="group" aria-label={g.nome} className="m-0 list-none p-0">
              {g.itens.map(({ c, i }) => (
                <li key={c.id} id={`${id}-${i}`} data-i={i} role="option" lang={c.lang} aria-selected={i === ativo}
                  onMouseMove={() => { if (i !== ativo) setAtivo(i); }} onClick={() => rodar(c)} className="paleta-item">
                  <span className="flex-none text-apoio">{c.icone}</span>
                  <span className="min-w-0 flex-1 truncate">{c.rotulo}</span>
                  {c.dica && <span className="mono flex-none text-[12px] text-apoio">{c.dica}</span>}
                  {i === ativo && <IconeEnter className="size-4 flex-none text-apoio" />}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>}
      <p className="paleta-pe mono m-0" aria-hidden="true">
        <span><span className="kbd">↑</span> <span className="kbd">↓</span> {t("mover", "move")}</span>
        <span><span className="kbd">↵</span> {t("abrir", "open")}</span>
        <span className="ml-auto">{atalhoPaleta()}</span>
      </p>
    </dialog>
  );
}
