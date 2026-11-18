// Peças da Matéria usadas pelas abas: tipos do estado da mesa, mensagens, o dossiê, a folha de baixo do celular e o
// detalhe de uma marca (estado, explicação, evidência).
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, cabecalhoIdioma, corpoJson, ErroApi, ler, type Sucesso } from "../api";
import { IconeFechar } from "../casca/icones";
import { quando } from "../fila";
import { t } from "../idioma";
import { IconeEstado, ROTULO_ESTADO, ROTULO_RISCO, type Estado } from "../novo/mesa";

export const rota = api.t[":tenantId"].textos[":id"];
export type EstadoMesa = Sucesso<Awaited<ReturnType<typeof rota.$get>>>;
export type Afirmacao = EstadoMesa["afirmacoes"][number];
export type Evidencia = EstadoMesa["evidencias"][number];

/** Nome da evidência: o título, ou o domínio da página. */
export const nomeEvidencia = (e: Pick<Evidencia, "titulo" | "url" | "origem">) =>
  e.titulo ?? (e.origem === "link" ? new URL(e.url).hostname : e.origem === "documento" ? t("documento", "document") : e.origem === "lai" ? t("resposta de pedido de LAI", "reply to an FOI request") : t("resposta do outro lado", "reply from the other side"));

/** Nome com link para a página; a resposta do outro lado não tem endereço (só o nome, e o rótulo em mono). */
export function NomeEvidencia({ e, className = "link-acao text-[15px]" }: { e: Pick<Evidencia, "titulo" | "url" | "origem">; className?: string }) {
  if (e.origem !== "link") return <span className="grid gap-0.5"><b className="text-[15px] text-texto-forte">{nomeEvidencia(e)}</b><span className="mono text-apoio">{e.origem === "documento" ? t("página de documento do dossiê", "page of a dossier document") : e.origem === "lai" ? t("resposta de pedido de LAI", "reply to an FOI request") : t("resposta do outro lado", "reply from the other side")}</span></span>;
  return <a href={e.url} target="_blank" rel="noreferrer" className={className}>{nomeEvidencia(e)}</a>;
}

export const mensagem = (e: unknown, padrao = t("Não deu certo agora. Tente de novo.", "That didn't work right now. Try again.")) =>
  e instanceof ErroApi ? (e.status === 0 ? t("Sem conexão. Confira a internet e tente de novo.", "No connection. Check your internet and try again.") : e.message) : padrao;

/** Detalhe de uma marca: estado, categoria do risco, a frase, a explicação e a evidência com o trecho dela. */
export function DetalheMarca({ a, evidencias, curto = false }: { a: Afirmacao; evidencias: Evidencia[]; curto?: boolean }) {
  const ev = a.evidenciaId ? evidencias.find((e) => e.id === a.evidenciaId) : null;
  return (
    <div className="grid gap-3">
      {!curto && <p className="m-0 leading-snug">
        <IconeEstado estado={a.estado} className="mr-1.5 size-4" /><b className="text-texto-forte">{ROTULO_ESTADO[a.estado as Estado][0].toUpperCase() + ROTULO_ESTADO[a.estado as Estado].slice(1)}</b>
        {a.risco && <span className="text-apoio"> · {ROTULO_RISCO[a.risco] ?? a.risco}</span>}
      </p>}
      {!curto && <p className="m-0 text-[15px] text-texto">“{a.trecho}”</p>}
      {a.explicacao && <p className="m-0 text-[15px]">{a.explicacao}</p>}
      {ev && a.evidenciaTrecho ? (
        <div className="grid gap-1.5">
          <p className="mono m-0 text-apoio">{t("evidência", "evidence")}</p>
          <NomeEvidencia e={ev} />
          <span className="mono text-apoio">{ROTULO_FORCA[ev.forca]()}{ev.tipoFonte ? ` · ${ROTULO_TIPO[ev.tipoFonte]()}` : ""}</span>
          <p className="m-0 text-[15px] leading-[1.55]"><mark className="bg-verde-claro px-0.5 text-texto-forte [box-decoration-break:clone]">{a.evidenciaTrecho}</mark></p>
          {ev.mudouEm && <p className="faixa-aviso m-0 text-[14px]">{t(`A fonte mudou desde que você conferiu (${quando(ev.mudouEm)}).`, `The source changed since you checked (${quando(ev.mudouEm)}).`)}</p>}
        </div>
      ) : a.estado !== "com_evidencia" && <p className="mono m-0 text-apoio">{t("sem evidência no dossiê", "no evidence in the dossier")}</p>}
    </div>
  );
}

/** Folha de baixo do celular (`<dialog>` nativo, classe .folha). */
export function Folha({ titulo, fechar, children }: { titulo: string; fechar: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current!;
    if (!d.open) d.showModal();
    return () => { if (d.open) d.close(); };
  }, []);
  return (
    <dialog ref={ref} aria-labelledby={id} className="folha" onCancel={(e) => { e.preventDefault(); fechar(); }} onClick={(e) => { if (e.target === ref.current) fechar(); }}>
      <div className="grid max-h-[80vh] gap-2 overflow-y-auto px-5 pt-5 pb-[calc(20px+env(safe-area-inset-bottom))]">
        <header className="flex items-start gap-3">
          <h2 id={id} className="mono m-0 text-[12px] tracking-[.08em] text-apoio uppercase">{titulo}</h2>
          <button type="button" onClick={fechar} aria-label={t("Fechar", "Close")} className="-mt-3 -mr-2 ml-auto grid size-11 cursor-pointer place-items-center rounded-btn text-apoio hover:bg-papel-2">
            <IconeFechar className="size-5" />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}

/** Tipo da fonte, que dá a força da evidência (nunca a linha política de quem publica). */
export const ROTULO_TIPO: Record<NonNullable<Evidencia["tipoFonte"]>, () => string> = {
  oficial: () => t("documento oficial", "official document"),
  primaria: () => t("fonte primária", "primary source"),
  materia: () => t("outra matéria", "another story"),
  anonima: () => t("fonte anônima", "anonymous source"),
};
export const ROTULO_FORCA: Record<Evidencia["forca"], () => string> = {
  forte: () => t("fonte forte", "strong source"),
  media: () => t("fonte média", "medium source"),
  fraca: () => t("fonte fraca", "weak source"),
  sem_tipo: () => t("tipo da fonte não dito", "source type not set"),
};

/**
 * Dossiê: as evidências (título com link, domínio, estado, tipo e força, Tirar), os avisos de fonte única e de fontes
 * circulares e "Acrescentar link".
 */
export function Dossie({ tenantId, textoId, estado, editor, atualizar, aoFonte, emPartes = false, lerAoLado }: {
  tenantId: string; textoId: string; estado: EstadoMesa; editor: boolean; atualizar: (d: EstadoMesa) => void;
  /** Link novo com o editor montado: a tela confere por streaming. Sem ele (aba Dossiê), a conferência roda aqui e só atualiza o estado. */
  aoFonte?: (d: EstadoMesa) => void;
  /** Na aba Dossiê a linha da parte já dá o título e a contagem. */
  emPartes?: boolean;
  /** No editor: abre a evidência no leitor do Material, ao lado do texto. */
  lerAoLado?: (evidenciaId: string) => void;
}) {
  const evidencias = estado.evidencias;
  const nome = (id: string) => { const e = evidencias.find((x) => x.id === id); return e ? nomeEvidencia(e) : "?"; };
  const param = { tenantId, id: textoId };
  const tipo = useMutation({
    mutationFn: ({ evidencia, tipoFonte }: { evidencia: string; tipoFonte: string | null }) => ler(rota.evidencias[":evidencia"].$patch({ param: { ...param, evidencia } }, corpoJson({ tipoFonte }))),
    onSuccess: atualizar,
  });
  const [url, setUrl] = useState("");
  const [falta, setFalta] = useState(false);
  const acrescentar = useMutation({
    mutationFn: () => ler(rota.evidencias.$post({ param }, corpoJson({ url: url.trim() }))),
    onSuccess: (d) => {
      setUrl("");
      if (aoFonte) { aoFonte(d); return; }
      atualizar(d);
      reconferir.mutate(d);
    },
  });
  const reconferir = useMutation({ mutationFn: (d: EstadoMesa) => reconferirFontes(tenantId, textoId, blocosSemFonte(d), atualizar) });
  const tirar = useMutation({
    mutationFn: (evidencia: string) => ler(rota.evidencias[":evidencia"].$delete({ param: { ...param, evidencia } })),
    onSuccess: atualizar,
  });
  const wayback = useMutation({
    mutationFn: (evidencia: string) => ler(rota.evidencias[":evidencia"].wayback.$post({ param: { ...param, evidencia } })),
    onSuccess: atualizar,
  });
  function enviar(e: FormEvent) {
    e.preventDefault();
    if (!url.trim()) { setFalta(true); return; }
    acrescentar.mutate();
  }
  const Caixa = emPartes ? "div" : "section";
  return (
    <Caixa aria-labelledby={emPartes ? undefined : "dossie-t"} className="grid gap-3">
      {!emPartes && <h2 id="dossie-t" className="mono m-0 text-[12px] tracking-[.08em] text-apoio uppercase">{t("Dossiê", "Dossier")} · {evidencias.length === 1 ? t("1 evidência", "1 piece of evidence") : t(`${evidencias.length} evidências`, `${evidencias.length} pieces of evidence`)}</h2>}
      {evidencias.length ? (
        <ul className="m-0 grid list-none gap-2 p-0">
          {evidencias.map((e) => (
            <li key={e.id} className="grid gap-1 rounded-card bg-branco px-3 py-2.5 shadow-curta">
              <NomeEvidencia e={e} className="link-acao text-[15px] leading-snug" />
              {e.origem === "link" && <span className="mono truncate text-apoio">{new URL(e.url).hostname}</span>}
              {e.mudouEm
                ? <span className="faixa-aviso py-1 text-[14px]">{t("A fonte mudou desde que você conferiu.", "The source changed since you checked.")}</span>
                : <span className="mono text-apoio">{t(`conferida ${quando(e.conferidaEm)}`, `checked ${quando(e.conferidaEm)}`)}{e.usada ? t(` · sustenta ${e.usada === 1 ? "1 afirmação" : `${e.usada} afirmações`}`, ` · supports ${e.usada === 1 ? "1 claim" : `${e.usada} claims`}`) : ""}{e.viaNavegador ? t(" · lida pelo navegador", " · read by the browser") : ""}</span>}
              <span className="mono text-apoio">{ROTULO_FORCA[e.forca]()}</span>
              {e.wayback && <LinhaWayback w={e.wayback} tentar={editor ? () => wayback.mutate(e.id) : null} ocupado={wayback.isPending} />}
              {editor ? (
                <label className="campo mt-1">
                  <span className="text-[14px]!">{t("Tipo da fonte", "Source type")}</span>
                  <select className="entrada bg-branco" value={e.tipoFonte ?? ""} disabled={tipo.isPending} onChange={(x) => tipo.mutate({ evidencia: e.id, tipoFonte: x.target.value || null })}>
                    <option value="">{t("não dito", "not set")}</option>
                    {(Object.keys(ROTULO_TIPO) as (keyof typeof ROTULO_TIPO)[]).map((k) => <option key={k} value={k}>{ROTULO_TIPO[k]()}</option>)}
                  </select>
                  {!e.tipoFonte && e.tipoSugerido && <span className="ajuda">{t(`O endereço parece de ${ROTULO_TIPO[e.tipoSugerido]()}. Confirme acima.`, `The address looks like an ${ROTULO_TIPO[e.tipoSugerido]()}. Confirm above.`)}</span>}
                </label>
              ) : e.tipoFonte && <span className="mono text-apoio">{ROTULO_TIPO[e.tipoFonte]()}</span>}
              {/* A resposta de um pedido de LAI fica no dossiê, junto do pedido (o servidor também recusa, com o motivo). */}
              {lerAoLado ? (
                <span className="flex flex-wrap gap-x-4">
                  <button type="button" className="link-acao inline-flex min-h-11 items-center border-0 bg-transparent p-0 text-[14px] font-normal" onClick={() => lerAoLado(e.id)}
                    aria-label={t(`Ler ao lado: ${e.titulo ?? e.url}`, `Read alongside: ${e.titulo ?? e.url}`)}>{t("Ler ao lado", "Read alongside")}</button>
                  {editor && e.origem !== "lai" && (
                    <button type="button" className="link-acao inline-flex min-h-11 items-center border-0 bg-transparent p-0 text-[14px] font-normal" onClick={() => tirar.mutate(e.id)} disabled={tirar.isPending}
                      aria-label={t(`Tirar do dossiê: ${e.titulo ?? e.url}`, `Remove from dossier: ${e.titulo ?? e.url}`)}>{t("Tirar", "Remove")}</button>
                  )}
                </span>
              ) : editor && e.origem !== "lai" && (
                <button type="button" className="link-acao justify-self-start border-0 bg-transparent p-0 text-[14px] font-normal" onClick={() => tirar.mutate(e.id)} disabled={tirar.isPending}
                  aria-label={t(`Tirar do dossiê: ${e.titulo ?? e.url}`, `Remove from dossier: ${e.titulo ?? e.url}`)}>{t("Tirar", "Remove")}</button>
              )}
            </li>
          ))}
        </ul>
      ) : <p className="m-0 text-apoio">{t("Nenhuma evidência ainda. Acrescente os links que sustentam o texto: a mesa confere cada afirmação contra eles.", "No evidence yet. Add the links that support the text: the desk checks every claim against them.")}</p>}
      {tirar.isError && <p role="alert" className="faixa-erro m-0">{mensagem(tirar.error)}</p>}
      {tipo.isError && <p role="alert" className="faixa-erro m-0">{mensagem(tipo.error)}</p>}
      {wayback.isError && <p role="alert" className="faixa-erro m-0">{mensagem(wayback.error)}</p>}
      {reconferir.isError && <p role="alert" className="faixa-erro m-0">{mensagem(reconferir.error)}</p>}
      {estado.fonteUnica && <p className="faixa-aviso m-0">{t(`Todas as frases com fonte se apoiam numa fonte só: ${nome(estado.fonteUnica)}.`, `Every sourced sentence rests on a single source: ${nome(estado.fonteUnica)}.`)}</p>}
      {estado.circulares.map((c) => (
        <p key={`${c.de}-${c.para}`} className="faixa-aviso m-0">
          {c.motivo === "cita"
            ? t(`${nome(c.de)} cita ${nome(c.para)}: não são duas fontes independentes.`, `${nome(c.de)} cites ${nome(c.para)}: they aren't two independent sources.`)
            : t(`${nome(c.de)} e ${nome(c.para)} repetem o mesmo trecho: não são duas fontes independentes.`, `${nome(c.de)} and ${nome(c.para)} repeat the same passage: they aren't two independent sources.`)}
        </p>
      ))}
      {editor && (
        <form onSubmit={enviar} noValidate className="grid gap-2">
          <label className="campo">
            <span>{t("Acrescentar link", "Add link")}</span>
            <input type="url" inputMode="url" className="entrada bg-branco" value={url} placeholder="https://" autoCapitalize="none" autoCorrect="off" spellCheck={false}
              onChange={(e) => { setUrl(e.target.value); setFalta(false); acrescentar.reset(); }} aria-invalid={falta || acrescentar.isError} aria-describedby="dossie-ajuda" />
            <span id="dossie-ajuda" className={falta || acrescentar.isError ? "text-[15px] text-terracota" : "ajuda"} role={falta || acrescentar.isError ? "alert" : undefined}>
              {falta ? t("Cole o link da evidência.", "Paste the evidence link.") : acrescentar.isError ? mensagem(acrescentar.error) : t("A página é lida e salva; o dossiê é relido todo dia e avisa se a fonte mudar.", "The page is read and saved; the dossier is reread every day and warns you if the source changes.")}
            </span>
          </label>
          <button type="submit" className="btn-sec justify-self-start bg-papel-2" disabled={acrescentar.isPending}>{acrescentar.isPending ? t("Lendo a página…", "Reading the page…") : t("Acrescentar", "Add")}</button>
        </form>
      )}
    </Caixa>
  );
}

/** O que a linha fechada de uma parte diz. Com `tom`, é alerta: a parte passa à frente e abre sozinha. */
export type Resumo = { texto: string; tom?: "aviso" | "erro" };
export const qtd = (n: number, um: string, varios: string) => (n === 1 ? `1 ${um}` : `${n} ${varios}`);

export function resumoDossie(e: EstadoMesa): Resumo {
  const n = e.evidencias.length;
  const total = n ? t(qtd(n, "evidência", "evidências"), qtd(n, "piece of evidence", "pieces of evidence")) : t("nenhuma evidência", "no evidence");
  const mudaram = e.evidencias.filter((x) => x.mudouEm).length;
  if (mudaram) return { tom: "aviso", texto: `${t(mudaram === 1 ? "1 fonte mudou" : `${mudaram} fontes mudaram`, mudaram === 1 ? "1 source changed" : `${mudaram} sources changed`)} · ${total}` };
  if (e.fonteUnica) return { tom: "aviso", texto: `${t("uma fonte só", "a single source")} · ${total}` };
  if (e.circulares.length) return { tom: "aviso", texto: `${t("fontes que não são independentes", "sources that aren't independent")} · ${total}` };
  return { texto: total };
}

/** A cópia no Wayback Machine: salvando, salva (com o link e a hora) ou não salva (com o motivo e Tentar de novo). */
function LinhaWayback({ w, tentar, ocupado }: { w: NonNullable<Evidencia["wayback"]>; tentar: (() => void) | null; ocupado: boolean }) {
  if (w.estado === "pendente") return <span className="mono text-apoio">{t("salvando no Wayback Machine…", "saving to the Wayback Machine…")}</span>;
  if (w.estado === "salvo" && w.url) {
    return <span className="mono text-apoio">{t("cópia no Wayback", "Wayback copy")}{w.em ? ` · ${quando(w.em)}` : ""} · <a href={w.url} target="_blank" rel="noreferrer" className="link-acao font-normal">{t("ver a cópia", "see the copy")}</a></span>;
  }
  return (
    <span className="mono text-apoio">
      {t("o Wayback não salvou", "the Wayback didn't save it")}{w.erro ? ` (${w.erro})` : ""}
      {tentar && <> · <button type="button" className="link-acao border-0 bg-transparent p-0 font-normal" onClick={tentar} disabled={ocupado}>{t("Tentar de novo", "Try again")}</button></>}
    </span>
  );
}

/**
 * Conferência por streaming (NDJSON): uma linha por bloco pronto e a última com o estado inteiro. Resposta JSON (sem
 * streaming) vale como a linha final.
 */
export type LinhaConferencia =
  | { tipo: "bloco"; blocoId: string; hash: string; estado: "pendente" | "conferido" | "nao_conferido"; erro: string | null; afirmacoes: Afirmacao[] }
  | { tipo: "fim"; estado: EstadoMesa; restantes?: number }
  | { tipo: "erro"; erro: string };

/** Os parágrafos que uma fonte nova pode resolver: os que têm marca sem fonte aberta. */
export const blocosSemFonte = (d: EstadoMesa) => [...new Set(d.afirmacoes.filter((a) => a.estado === "sem_fonte" && a.aberta).map((a) => a.blocoId))];

/** Sem o editor montado: confere os parágrafos pedidos e atualiza o estado no fim, sem animação. A falha sobe; o link já está salvo. */
export async function reconferirFontes(tenantId: string, id: string, blocos: string[], atualizar: (d: EstadoMesa) => void) {
  let fila = blocos;
  while (fila.length) {
    const vistos = new Set<string>();
    let restantes = 0;
    await conferirEmStreaming(tenantId, id, { blocos: fila }, (l) => {
      if (l.tipo === "bloco") vistos.add(l.blocoId);
      else if (l.tipo === "erro") throw new ErroApi(500, l.erro);
      else { atualizar(l.estado); restantes = l.restantes ?? 0; }
    });
    fila = restantes ? fila.filter((b) => !vistos.has(b)) : [];
  }
}

export async function conferirEmStreaming(tenantId: string, id: string, corpo: { todos?: boolean; blocos?: string[]; pular?: string[] }, aoLinha: (l: LinhaConferencia) => void) {
  let res: Response;
  try {
    res = await fetch(`/api/t/${encodeURIComponent(tenantId)}/textos/${encodeURIComponent(id)}/conferir`, {
      method: "POST", headers: { "content-type": "application/json", accept: "application/x-ndjson", ...cabecalhoIdioma() },
      body: JSON.stringify(corpo),
    });
  } catch {
    throw new ErroApi(0, t("Sem conexão com o servidor.", "No connection to the server."));
  }
  if (!res.ok) {
    const b = (await res.json().catch(() => null)) as { erro?: string; code?: string } | null;
    throw new ErroApi(res.status, b?.erro ?? `Erro ${res.status}`, b?.code, b);
  }
  if (!(res.headers.get("content-type") ?? "").includes("ndjson") || !res.body) {
    aoLinha({ tipo: "fim", estado: (await res.json()) as EstadoMesa });
    return;
  }
  const leitor = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let resto = "";
  for (;;) {
    const { value, done } = await leitor.read();
    if (value) resto += value;
    let i: number;
    while ((i = resto.indexOf("\n")) >= 0) {
      const l = resto.slice(0, i).trim();
      resto = resto.slice(i + 1);
      if (l) aoLinha(JSON.parse(l) as LinhaConferencia);
    }
    if (done) break;
  }
  if (resto.trim()) aoLinha(JSON.parse(resto) as LinhaConferencia);
}
