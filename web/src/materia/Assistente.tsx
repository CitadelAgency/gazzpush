// Assistente do editor da Matéria (Fase 3): as cinco ações do cartão (registram apuração, nunca escrevem texto), o
// detalhe dos apontamentos do código (conta, aspa, manual), o painel de pessoas e instituições, o checklist de
// publicação com a assinatura do editor, a paleta Ctrl/⌘K e o menu do `@` (citação do dossiê).
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router";
import { corpoJson, ler } from "../api";
import { quando } from "../fila";
import { t } from "../idioma";
import { IconeEstado, ROTULO_TELA, type EstadoTela } from "../novo/mesa";
import { mensagem, nomeEvidencia, rota, type Afirmacao, type EstadoMesa, type Evidencia } from "./comum";
import { TocarTrecho } from "./Gravacoes";

export type Apontamento = EstadoMesa["apontamentos"][number];
export type Pessoa = EstadoMesa["pessoas"][number];
export type Pendencia = EstadoMesa["checklist"]["pendencias"][number];

export const MEIOS: [string, () => string][] = [
  ["email", () => t("e-mail", "email")], ["telefone", () => t("telefone", "phone")], ["mensagem", () => t("mensagem (WhatsApp, rede social)", "message (WhatsApp, social media)")],
  ["pessoalmente", () => t("pessoalmente", "in person")], ["oficio", () => t("ofício ou pedido formal", "formal letter or request")], ["outro", () => t("outro meio", "other means")],
];
export const rotuloMeio = (m: string) => MEIOS.find(([k]) => k === m)?.[1]() ?? m;
export const RISCOS_OUTRO_LADO = ["acusacao_sem_condenacao", "sem_outro_lado"];
const hoje = () => new Date().toLocaleDateString("sv-SE");
const dataCurta = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/** Formulário curto de link para o dossiê (usado no cartão e no aviso de link colado). */
export function FormLink({ tenantId, textoId, inicial = "", rotulo, aoAdicionar, cancelar }: {
  tenantId: string; textoId: string; inicial?: string; rotulo: string; aoAdicionar: (d: EstadoMesa) => void; cancelar?: () => void;
}) {
  const [url, setUrl] = useState(inicial);
  const id = useId();
  const add = useMutation({
    mutationFn: () => ler(rota.evidencias.$post({ param: { tenantId, id: textoId } }, corpoJson({ url: url.trim() }))),
    onSuccess: (d) => aoAdicionar(d),
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (url.trim()) add.mutate(); }} noValidate className="grid gap-2">
      <label className="campo">
        <span>{rotulo}</span>
        <input type="url" inputMode="url" className="entrada bg-branco" value={url} placeholder="https://" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoFocus
          onChange={(e) => { setUrl(e.target.value); add.reset(); }} aria-invalid={add.isError} aria-describedby={add.isError ? id : undefined} />
      </label>
      {add.isError && <p id={id} role="alert" className="m-0 text-[15px] text-terracota">{mensagem(add.error)}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-sec bg-papel-2" disabled={add.isPending}>{add.isPending ? t("Lendo a página…", "Reading the page…") : t("Pôr no dossiê", "Add to dossier")}</button>
        {cancelar && <button type="button" className="btn-sec bg-papel-2" onClick={cancelar}>{t("Cancelar", "Cancel")}</button>}
      </div>
    </form>
  );
}

/** O nome de quem escreveu a primeira opinião, pelo `fornecedor` do bloco (deepseek, gemini, deepseek+anthropic...). */
export const nomeTexto = (fornecedor: string | null | undefined) => (fornecedor?.startsWith("gemini") ? "Gemini" : "DeepSeek");

/**
 * Quem conferiu o parágrafo: duas opiniões, uma só (e por quê) ou o outro fornecedor (tema sensível). `ligar`: o endereço da
 * aba Chaves de IA, só para o admin, quando a segunda opinião está desligada.
 */
export function LinhaOpinioes({ bloco, segunda, ligar }: { bloco: EstadoMesa["blocos"][number] | undefined; segunda: EstadoMesa["segunda"]; ligar?: string | null }) {
  if (!bloco) return null;
  const texto: ReactNode = bloco.aviso ? bloco.aviso
    : bloco.fornecedor?.endsWith("+anthropic") ? t(`duas opiniões: ${nomeTexto(bloco.fornecedor)} e Claude`, `two opinions: ${nomeTexto(bloco.fornecedor)} and Claude`)
      : bloco.fornecedor === "anthropic" ? t("conferido pelo Claude (tema que modelos chineses suavizam)", "checked by Claude (a topic Chinese models soften)")
        : segunda.ligada ? t("uma opinião: sem acusação nem risco, a segunda opinião não foi chamada", "one opinion: no accusation or risk, so the second opinion wasn't called")
          : <>{t("uma opinião só: a segunda opinião não está ligada neste veículo", "only one opinion: the second opinion isn't turned on for this outlet")}{ligar && <>{" "}<Link className="link-acao font-sans" to={ligar}>{t("Ligar a segunda opinião", "Turn on the second opinion")}</Link></>}</>;
  return <p className={`m-0 text-[14px] ${bloco.aviso ? "faixa-aviso py-1" : "mono text-apoio"}`}>{texto}</p>;
}

/**
 * As cinco ações do cartão de uma afirmação. Registradas com quem e quando; desfazer guarda o registro. Nenhuma muda o
 * texto: a frase continua a do autor.
 */
export function AcoesCartao({ a, evidencias, tenantId, textoId, atualizar, aoFonte }: {
  a: Afirmacao; evidencias: Evidencia[]; tenantId: string; textoId: string; atualizar: (d: EstadoMesa) => void; aoFonte: (d: EstadoMesa) => void;
}) {
  const param = { tenantId, id: textoId };
  const [forma, setForma] = useState<null | "fonte" | "link" | "outro_lado">(null);
  const [evId, setEvId] = useState(a.evidenciaId ?? evidencias[0]?.id ?? "");
  const [trecho, setTrecho] = useState("");
  const [quem, setQuem] = useState("");
  const [quandoFoi, setQuando] = useState(hoje());
  const [meio, setMeio] = useState("email");
  const erroId = useId();
  const registrar = useMutation({
    mutationFn: (corpo: Record<string, unknown>) => ler(rota.apuracoes.$post({ param }, corpoJson({ afirmacaoId: a.id, ...corpo }))),
    onSuccess: (d) => { atualizar(d); setForma(null); },
  });
  const desfazer = useMutation({
    mutationFn: (apuracao: string) => ler(rota.apuracoes[":apuracao"].$delete({ param: { ...param, apuracao } })),
    onSuccess: atualizar,
  });
  const ap = a.apuracao;
  if (ap) {
    const por = ap.porNome ?? t("alguém da equipe", "someone on the team");
    const desc = ap.tipo === "fonte" ? t(`Fonte presa por ${por}, ${quando(ap.em)}.`, `Source pinned by ${por}, ${quando(ap.em)}.`)
      : ap.tipo === "opiniao" ? t(`Afirmação sua (opinião), marcada por ${por}, ${quando(ap.em)}. Sai da conferência e vai ao carrossel como opinião do autor.`, `Your own claim (opinion), marked by ${por}, ${quando(ap.em)}. It leaves the check and goes to the carousel as the author's opinion.`)
        : ap.tipo === "ignorar" ? t(`Ignorada por ${por}, ${quando(ap.em)}.`, `Ignored by ${por}, ${quando(ap.em)}.`)
          : t(`Outro lado procurado: ${ap.outroLado?.quem}, em ${dataCurta(ap.outroLado?.quando ?? "")}, por ${rotuloMeio(ap.outroLado?.meio ?? "")}. Registrado por ${por}.`,
            `Other side contacted: ${ap.outroLado?.quem}, on ${dataCurta(ap.outroLado?.quando ?? "")}, by ${rotuloMeio(ap.outroLado?.meio ?? "")}. Recorded by ${por}.`);
    return (
      <div className="grid gap-2 border-t border-fio pt-2.5">
        <p className="m-0 text-[15px]">{desc}</p>
        {ap.tipo === "fonte" && ap.evidenciaTrecho && <p className="m-0 text-[15px] leading-[1.55]"><mark className="bg-verde-claro px-0.5 text-texto-forte">{ap.evidenciaTrecho}</mark></p>}
        {desfazer.isError && <p role="alert" className="faixa-erro m-0">{mensagem(desfazer.error)}</p>}
        <button type="button" className="link-acao justify-self-start border-0 bg-transparent p-0 text-[15px]" onClick={() => desfazer.mutate(ap.id)} disabled={desfazer.isPending}>{t("Desfazer", "Undo")}</button>
      </div>
    );
  }
  const podeOutroLado = a.estado === "risco" && RISCOS_OUTRO_LADO.includes(a.risco ?? "");
  const acoes: [string, () => void, boolean][] = [
    [t("Prender fonte", "Pin source"), () => setForma(forma === "fonte" ? null : "fonte"), evidencias.length > 0 && a.estado !== "com_evidencia"],
    [t("Adicionar link", "Add link"), () => setForma(forma === "link" ? null : "link"), true],
    [t("Procurei o outro lado", "I contacted the other side"), () => setForma(forma === "outro_lado" ? null : "outro_lado"), podeOutroLado],
    [t("É opinião", "It's opinion"), () => registrar.mutate({ tipo: "opiniao" }), true],
    [t("Ignorar", "Ignore"), () => registrar.mutate({ tipo: "ignorar" }), true],
  ];
  function enviar(e: FormEvent, corpo: Record<string, unknown>) {
    e.preventDefault();
    registrar.mutate(corpo);
  }
  return (
    <div className="grid gap-2.5 border-t border-fio pt-2.5">
      <div role="group" aria-label={t("Ações da marca", "Mark actions")} className="flex flex-wrap gap-1.5">
        {acoes.filter(([, , ok]) => ok).map(([rotulo, fazer]) => (
          <button key={rotulo} type="button" className="btn-sec min-h-11 bg-papel-2 px-3 text-[14px]" onClick={() => { registrar.reset(); fazer(); }} disabled={registrar.isPending}>{rotulo}</button>
        ))}
      </div>
      {forma === "fonte" && (
        <form onSubmit={(e) => enviar(e, { tipo: "fonte", evidenciaId: evId, evidenciaTrecho: trecho })} className="grid gap-2">
          <label className="campo">
            <span>{t("Fonte do dossiê", "Dossier source")}</span>
            <select className="entrada bg-branco" value={evId} onChange={(e) => setEvId(e.target.value)}>
              {evidencias.map((e) => <option key={e.id} value={e.id}>{nomeEvidencia(e)}</option>)}
            </select>
          </label>
          <label className="campo">
            <span>{t("Trecho da fonte que sustenta a frase", "Passage from the source that supports the sentence")}</span>
            <textarea className="entrada min-h-20 bg-branco" value={trecho} onChange={(e) => { setTrecho(e.target.value); registrar.reset(); }} required
              aria-invalid={registrar.isError} aria-describedby={`${erroId}-a`} />
            <span id={`${erroId}-a`} className="ajuda">{t("Copie da fonte, letra por letra: o sistema confere que o trecho está lá.", "Copy it from the source, word for word: the system checks the passage is there.")}</span>
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn-sec bg-papel-2" disabled={registrar.isPending || !trecho.trim()}>{t("Prender", "Pin")}</button>
            <button type="button" className="btn-sec bg-papel-2" onClick={() => setForma(null)}>{t("Cancelar", "Cancel")}</button>
          </div>
        </form>
      )}
      {forma === "link" && (
        <FormLink tenantId={tenantId} textoId={textoId} rotulo={t("Link da fonte desta frase", "Link to this sentence's source")} cancelar={() => setForma(null)}
          aoAdicionar={(d) => { setForma(null); aoFonte(d); }} />
      )}
      {forma === "outro_lado" && (
        <form onSubmit={(e) => enviar(e, { tipo: "outro_lado", quem, quando: quandoFoi, meio })} className="grid gap-2">
          <label className="campo">
            <span>{t("Quem você procurou", "Who you contacted")}</span>
            <input className="entrada bg-branco" value={quem} onChange={(e) => setQuem(e.target.value)} required maxLength={200} placeholder={t("nome ou assessoria", "name or press office")} />
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="campo">
              <span>{t("Quando", "When")}</span>
              <input type="date" className="entrada bg-branco" value={quandoFoi} max={hoje()} onChange={(e) => setQuando(e.target.value)} required />
            </label>
            <label className="campo">
              <span>{t("Por qual meio", "By what means")}</span>
              <select className="entrada bg-branco" value={meio} onChange={(e) => setMeio(e.target.value)}>
                {MEIOS.map(([k, r]) => <option key={k} value={k}>{r()}</option>)}
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn-sec bg-papel-2" disabled={registrar.isPending || quem.trim().length < 2}>{t("Registrar", "Record")}</button>
            <button type="button" className="btn-sec bg-papel-2" onClick={() => setForma(null)}>{t("Cancelar", "Cancel")}</button>
          </div>
        </form>
      )}
      {registrar.isError && <p role="alert" className="faixa-erro m-0">{mensagem(registrar.error)}</p>}
    </div>
  );
}

/** Detalhe de um apontamento do código: o que o código achou e, na aspa, o atalho para pôr a fonte no dossiê. */
export function DetalheApontamento({ p, podeEditar, tenantId, textoId, aoAdicionar }: {
  p: Apontamento; podeEditar: boolean; tenantId: string; textoId: string; aoAdicionar: (d: EstadoMesa) => void;
}) {
  const [link, setLink] = useState(false);
  return (
    <div className="grid gap-2">
      <p className="m-0 text-[15px]">{p.explicacao}</p>
      <p className="mono m-0 text-apoio">{p.tipo === "manual" ? t("só aponta: a mudança é sua", "it only points: the change is yours") : t("conferido por código, sem modelo", "checked by code, no model")}</p>
      {p.tipo === "gravacao" && p.gravacao && <TocarTrecho tenantId={tenantId} textoId={textoId} g={p.gravacao} />}
      {p.tipo === "aspa" && podeEditar && (link
        ? <FormLink tenantId={tenantId} textoId={textoId} rotulo={t("Link da fonte da citação", "Link to the quote's source")} cancelar={() => setLink(false)} aoAdicionar={(d) => { aoAdicionar(d); setLink(false); }} />
        : <button type="button" className="btn-sec min-h-11 justify-self-start bg-papel-2 px-3 text-[14px]" onClick={() => setLink(true)}>{t("Adicionar link", "Add link")}</button>)}
    </div>
  );
}

/** Pessoas e instituições do texto: menções, grafia diferente e, para quem é acusado, se o outro lado foi procurado. */
export function Pessoas({ pessoas, irPara, naFolha }: { pessoas: Pessoa[]; irPara: (p: Pessoa) => void; naFolha: boolean }) {
  const lista = [...pessoas].sort((a, b) => Number(b.acusada) - Number(a.acusada) || Number(b.grafias.length > 0) - Number(a.grafias.length > 0) || b.mencoes - a.mencoes);
  if (!lista.length && !naFolha) return null;   // no painel do computador, lista vazia só tira espaço de quem está escrevendo
  return (
    <section aria-labelledby="pessoas-t" className="grid gap-2.5">
      <h2 id="pessoas-t" className={`mono m-0 text-[12px] tracking-[.08em] text-apoio uppercase ${naFolha ? "mt-4" : ""}`}>{t("Pessoas e instituições", "People and institutions")}</h2>
      {lista.length ? (
        <ul className="m-0 grid list-none gap-1.5 p-0">
          {lista.map((p) => (
            <li key={p.nome} className="grid gap-1 rounded-card bg-branco px-3 py-2 shadow-curta">
              <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-left text-[15px] font-bold text-texto-forte underline decoration-fio-forte underline-offset-3" onClick={() => irPara(p)}>
                {p.nome}
              </button>
              <span className="mono text-apoio">
                {p.tipo === "instituicao" ? t("instituição", "institution") : t("pessoa", "person")} · {p.mencoes === 1 ? t("1 menção", "1 mention") : t(`${p.mencoes} menções`, `${p.mencoes} mentions`)}
              </span>
              {p.grafias.length > 0 && <span className="faixa-aviso py-1 text-[14px]">{t(`Grafia diferente no texto: ${p.grafias.join(", ")}.`, `Different spelling in the text: ${p.grafias.join(", ")}.`)}</span>}
              {p.acusada && (p.outroLado
                ? <span className="text-[14px] text-texto">{t(`Acusada no texto. Outro lado: ${p.outroLado.quem}, ${dataCurta(p.outroLado.quando)}, por ${rotuloMeio(p.outroLado.meio)}.`, `Accused in the text. Other side: ${p.outroLado.quem}, ${dataCurta(p.outroLado.quando)}, by ${rotuloMeio(p.outroLado.meio)}.`)}</span>
                : <span className="faixa-aviso py-1 text-[14px]">{t("Acusada no texto, sem registro de que foi procurada.", "Accused in the text, with no record of being contacted.")}</span>)}
            </li>
          ))}
        </ul>
      ) : <p className="m-0 text-apoio">{t("Nenhum nome próprio no texto ainda.", "No proper names in the text yet.")}</p>}
    </section>
  );
}

const ROTULO_PENDENCIA: Record<Pendencia["tipo"], () => string> = {
  risco: () => t("risco jurídico aberto", "open legal risk"),
  paragrafo: () => t("parágrafo não conferido", "paragraph not checked"),
  aspa: () => t("aspa sem fonte", "unsourced quote"),
  conta: () => t("conta que não fecha", "math that doesn't add up"),
};
const ESTADO_PENDENCIA: Record<Pendencia["tipo"], EstadoTela> = { risco: "risco", paragrafo: "sem_fonte", aspa: "aspa", conta: "conta" };

/**
 * Checklist de publicação: o que trava o Instagram (e a página de fontes). Com pendência, só sai com a assinatura do
 * editor, registrada com a versão e o que estava pendente.
 */
export function Checklist({ checklist, podeEditar, assinar, assinando, erro, irPara, fechar }: {
  checklist: EstadoMesa["checklist"]; podeEditar: boolean; assinar: () => void; assinando: boolean; erro: unknown; irPara: (p: Pendencia) => void; fechar: () => void;
}) {
  const { pendencias, assinatura } = checklist;
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <section ref={ref} tabIndex={-1} aria-labelledby="checklist-t" className="mt-4 grid gap-3 rounded-card bg-branco p-4 shadow-curta outline-none">
      <div className="flex items-start gap-3">
        <h2 id="checklist-t" className="m-0 text-[18px]">{t("Checklist de publicação", "Publication checklist")}</h2>
        <button type="button" className="link-acao ml-auto border-0 bg-transparent p-0 text-[15px]" onClick={fechar}>{t("Fechar", "Close")}</button>
      </div>
      {pendencias.length ? (
        <>
          <p className="m-0">{t("Com algum destes itens aberto, a matéria não vai para o Instagram nem para a página de fontes sem a assinatura do editor.", "With any of these items open, the story doesn't go to Instagram or the sources page without the editor's sign-off.")}</p>
          <ul className="m-0 grid list-none gap-1.5 p-0">
            {pendencias.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => irPara(p)} className="grid w-full cursor-pointer gap-0.5 rounded-btn border-0 bg-transparent px-1 py-1.5 text-left hover:bg-papel-2">
                  <span className="text-[14px]"><IconeEstado estado={ESTADO_PENDENCIA[p.tipo]} className="mr-1 size-3.5" /><b>{ROTULO_PENDENCIA[p.tipo]()}</b></span>
                  <span className="line-clamp-2 text-[15px] text-texto">“{p.trecho}”</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : <p className="m-0">{t("Nada pendente nesta versão: pode mandar.", "Nothing open in this version: you can send it.")}</p>}
      {assinatura ? (
        <p className="m-0 text-[15px] text-verde">{t(`Publicação assinada por ${assinatura.por ?? "alguém da equipe"}, ${quando(assinatura.em)}, com ${assinatura.pendencias === 1 ? "1 pendência" : `${assinatura.pendencias} pendências`}.`, `Publication signed off by ${assinatura.por ?? "someone on the team"}, ${quando(assinatura.em)}, with ${assinatura.pendencias === 1 ? "1 open item" : `${assinatura.pendencias} open items`}.`)}</p>
      ) : pendencias.length > 0 && podeEditar && (
        <div className="grid gap-2">
          <p className="faixa-aviso m-0">{t(`Assinar é assumir ${pendencias.length === 1 ? "a pendência acima" : `as ${pendencias.length} pendências acima`} nesta versão. Fica registrado quem assinou e quando.`, `Signing off means taking responsibility for ${pendencias.length === 1 ? "the item above" : `the ${pendencias.length} items above`} in this version. Who signed and when is recorded.`)}</p>
          <button type="button" className="btn-sec justify-self-start bg-papel-2" onClick={assinar} disabled={assinando}>{assinando ? t("Assinando…", "Signing…") : t("Assinar a publicação", "Sign off the publication")}</button>
        </div>
      )}
      {!!erro && <p role="alert" className="faixa-erro m-0">{mensagem(erro)}</p>}
    </section>
  );
}

export interface Comando { id: string; rotulo: string; dica?: string; fazer: () => void }

/** Paleta Ctrl/⌘K: os comandos do editor, filtrados pelo que a pessoa digita. Enter roda o primeiro. */
export function Comandos({ comandos, fechar }: { comandos: Comando[]; fechar: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busca, setBusca] = useState("");
  const [i, setI] = useState(0);
  const titulo = useId();
  useEffect(() => {
    const d = ref.current!;
    if (!d.open) d.showModal();
    return () => { if (d.open) d.close(); };
  }, []);
  const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const lista = comandos.filter((c) => norm(c.rotulo).includes(norm(busca)));
  const rodar = (c: Comando | undefined) => { if (!c) return; fechar(); c.fazer(); };
  return (
    <dialog ref={ref} aria-labelledby={titulo} className="comandos" onCancel={(e) => { e.preventDefault(); fechar(); }} onClick={(e) => { if (e.target === ref.current) fechar(); }}>
      <div className="grid gap-2 p-4">
        <h2 id={titulo} className="mono m-0 text-[12px] tracking-[.08em] text-apoio uppercase">{t("Comandos", "Commands")}</h2>
        <input className="entrada bg-branco" autoFocus value={busca} aria-label={t("Procurar comando", "Search commands")} role="combobox" aria-expanded="true" aria-controls={`${titulo}-l`}
          aria-activedescendant={lista[i] ? `${titulo}-${lista[i].id}` : undefined}
          onChange={(e) => { setBusca(e.target.value); setI(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => Math.min(x + 1, lista.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => Math.max(x - 1, 0)); }
            else if (e.key === "Enter") { e.preventDefault(); rodar(lista[i]); }
          }} />
        <ul id={`${titulo}-l`} role="listbox" aria-label={t("Comandos", "Commands")} className="m-0 grid list-none gap-0.5 p-0">
          {lista.map((c, k) => (
            <li key={c.id} id={`${titulo}-${c.id}`} role="option" aria-selected={k === i} onMouseDown={(e) => e.preventDefault()} onClick={() => rodar(c)}
              className={`flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-btn px-2.5 text-[15px] ${k === i ? "bg-papel-2 font-bold text-texto-forte" : "text-texto"}`}>
              <span>{c.rotulo}</span>{c.dica && <span className="mono text-[12px] font-normal text-apoio">{c.dica}</span>}
            </li>
          ))}
          {!lista.length && <li className="px-2.5 py-2 text-apoio">{t("Nenhum comando com esse nome.", "No command with that name.")}</li>}
        </ul>
      </div>
    </dialog>
  );
}

/** Menu do `@`: as evidências do dossiê que batem com o que a pessoa digitou. Teclas no editor (setas, Enter, Esc). */
export function MenuArroba({ opcoes, ativo, escolher, topo, esquerda, id }: {
  opcoes: Evidencia[]; ativo: number; escolher: (e: Evidencia) => void; topo: number; esquerda: number; id: string;
}) {
  return (
    <div className="absolute z-20 w-[min(360px,90vw)] rounded-card bg-branco p-1.5 shadow-curta" style={{ top: topo, left: esquerda }}>
      <p className="mono m-0 px-2 pt-1 pb-1.5 text-[12px] text-apoio">{t("citar do dossiê", "cite from the dossier")}</p>
      <ul id={id} role="listbox" aria-label={t("Citar do dossiê", "Cite from the dossier")} className="m-0 grid list-none gap-0.5 p-0">
        {opcoes.length ? opcoes.map((e, k) => (
          <li key={e.id} id={`${id}-${e.id}`} role="option" aria-selected={k === ativo} onMouseDown={(ev) => { ev.preventDefault(); escolher(e); }}
            className={`grid min-h-11 cursor-pointer content-center rounded-btn px-2 text-[15px] ${k === ativo ? "bg-papel-2 font-bold text-texto-forte" : "text-texto"}`}>
            <span className="truncate">{nomeEvidencia(e)}</span>
            <span className="mono truncate text-[12px] font-normal text-apoio">{e.origem === "link" ? new URL(e.url).hostname : e.origem === "documento" ? t("documento", "document") : e.origem === "lai" ? t("resposta de LAI", "FOI reply") : t("resposta do outro lado", "reply from the other side")}</span>
          </li>
        )) : <li className="px-2 py-2 text-[15px] text-apoio">{t("Nada no dossiê com esse nome.", "Nothing in the dossier by that name.")}</li>}
      </ul>
    </div>
  );
}

/** Rótulo da nota de citação: o título curto da evidência entre colchetes. */
export const rotuloNota = (e: Evidencia) => {
  const base = nomeEvidencia(e).replace(/\s+/g, " ").trim();
  return `[${base.length > 40 ? `${base.slice(0, 39)}…` : base}]`;
};

export const Rotulo = ({ estado, children }: { estado: EstadoTela; children?: ReactNode }) => (
  <span className="text-[14px] leading-snug"><IconeEstado estado={estado} className="mr-1 size-3.5" /><b className="text-texto-forte">{ROTULO_TELA[estado]}</b>{children}</span>
);
