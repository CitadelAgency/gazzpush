// Living story and LAI (Phase 7). In the After tab, the story's alerts after it was reported: a source that changed or
// went offline, a person mentioned in new news, a court case with new activity, an LAI deadline; each one offers to update
// the text (the person edits) or to generate a new Update or Correction post. In the Dossier, the LAI requests: the
// request ready to paste into the body's portal, the filing, the deadline (20 days + 10), the answer in the dossier and the appeal.
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { bodyJson, read } from "../api";
import { when } from "../queue";
import { t } from "../language";
import { usePart } from "../kit/Parts";
import { message, qty, route, type Claim, type DeskState, type Summary } from "./common";

type Alert = DeskState["alertas"][number];
type LaiRequest = DeskState["lai"]["pedidos"][number];

const brDate = (d: string) => d.split("-").reverse().join("/");
const todayLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const cnj = (n: string) => n.length === 20 ? `${n.slice(0, 7)}-${n.slice(7, 9)}.${n.slice(9, 13)}.${n.slice(13, 14)}.${n.slice(14, 16)}.${n.slice(16)}` : n;

// ── After tab ───────────────────────────────────────────────────────────────────────────────────────────────────

const FAMILIES: { id: string; tipos: string[]; titulo: () => string }[] = [
  { id: "fontes", tipos: ["fonte_mudou", "fonte_fora"], titulo: () => t("Fontes que mudaram", "Sources that changed") },
  { id: "pessoas", tipos: ["pessoa", "processo"], titulo: () => t("Pessoas e processos", "People and court cases") },
  { id: "lai", tipos: ["lai_vence", "lai_vencido"], titulo: () => t("Prazos de LAI", "FOI deadlines") },
];

export function TabAfter({ tenantId, textoId: textId, slug, estado: state, editor, atualizar: update }: {
  tenantId: string; textoId: string; slug: string; estado: DeskState; editor: boolean; atualizar: (d: DeskState) => void;
}) {
  const { alertas: alerts, processos: cases } = state;
  return (
    <div className="grid gap-8">
      {!alerts.length && (
        <p className="m-0 text-apoio">{t(
          "Nenhum alerta. O dossiê é relido todo dia; pessoas citadas no texto, processos e prazos de LAI também são acompanhados. O que mudar aparece aqui.",
          "No alerts. The dossier is reread every day; people named in the text, court cases and FOI deadlines are tracked too. Whatever changes shows up here.",
        )}</p>
      )}
      {FAMILIES.map((f) => {
        const list = alerts.filter((a) => f.tipos.includes(a.tipo));
        if (!list.length) return null;
        return (
          <section key={f.id} aria-labelledby={`depois-${f.id}`} className="grid gap-3">
            <h2 id={`depois-${f.id}`} className="mono m-0 text-[12px] tracking-[.08em] text-apoio uppercase">{f.titulo()}</h2>
            <ul className="m-0 grid list-none gap-3 p-0">
              {list.map((a) => <CardAlert key={a.id} a={a} tenantId={tenantId} textoId={textId} slug={slug} estado={state} editor={editor} atualizar={update} />)}
            </ul>
          </section>
        );
      })}
      <section aria-labelledby="depois-processos" className="grid gap-2">
        <h2 id="depois-processos" className="mono m-0 text-[12px] tracking-[.08em] text-apoio uppercase">{t("Processos citados no texto", "Court cases cited in the text")}</h2>
        {cases.lista.length ? (
          <ul className="m-0 grid list-none gap-1.5 p-0">
            {cases.lista.map((p) => (
              <li key={p.numero} className="grid gap-0.5">
                <span className="mono text-texto-forte">{cnj(p.numero)}{p.tribunal ? ` · ${p.tribunal.toUpperCase()}` : ""}</span>
                <span className="mono text-apoio">
                  {!cases.ligado ? t("acompanhamento desligado (falta a chave do DataJud)", "tracking off (the DataJud key is missing)")
                    : !p.tribunal ? t("tribunal não reconhecido pelo número", "court not recognized from the number")
                    : p.erro ? t(`a consulta falhou: ${p.erro}`, `the lookup failed: ${p.erro}`)
                    : p.ultimoMovimento ? t(`último movimento: ${p.ultimoMovimento} · ${brDate(p.ultimoMovimentoEm!.slice(0, 10))}`, `last movement: ${p.ultimoMovimento} · ${brDate(p.ultimoMovimentoEm!.slice(0, 10))}`)
                    : t("ainda não consultado (o acompanhamento roda uma vez por dia)", "not looked up yet (tracking runs once a day)")}
                </span>
              </li>
            ))}
          </ul>
        ) : <p className="m-0 text-apoio">{t("O texto não cita número de processo (no formato do CNJ, 0000000-00.0000.0.00.0000).", "The text doesn't cite a case number (in the CNJ format, 0000000-00.0000.0.00.0000).")}</p>}
      </section>
    </div>
  );
}

function alertTitle(a: Alert): string {
  const d = a.detalhe as Record<string, string | number | null | undefined>;
  switch (a.tipo) {
    case "fonte_mudou": return t(`A página mudou: ${a.titulo}`, `The page changed: ${a.titulo}`);
    case "fonte_fora": return t(`A fonte não responde: ${a.titulo}`, `The source isn't responding: ${a.titulo}`);
    case "pessoa": return t(`${a.titulo} aparece em notícia nova`, `${a.titulo} shows up in a new story`);
    case "processo": return t(`Processo ${cnj(String(d.numero))}: movimento novo`, `Case ${cnj(String(d.numero))}: new movement`);
    case "lai_vence": return t(`O prazo do pedido de LAI a ${a.titulo} vence em ${brDate(String(d.prazo))}`, `The FOI request to ${a.titulo} is due on ${brDate(String(d.prazo))}`);
    default: return t(`O prazo do pedido de LAI a ${a.titulo} venceu em ${brDate(String(d.prazo))}`, `The FOI request to ${a.titulo} was due on ${brDate(String(d.prazo))}`);
  }
}

function CardAlert({ a, tenantId, textoId: textId, slug, estado: state, editor, atualizar: update }: {
  a: Alert; tenantId: string; textoId: string; slug: string; estado: DeskState; editor: boolean; atualizar: (d: DeskState) => void;
}) {
  const param = { tenantId, id: textId, alerta: a.id };
  const d = a.detalhe as Record<string, string | number | null | undefined>;
  const [post, setPost] = useState<"atualizacao" | "errata" | null>(null);
  const [note, setNote] = useState("");
  const resolve = useMutation({
    mutationFn: (action: "texto_atualizado" | "ignorado") => read(route.alertas[":alerta"].resolver.$post({ param }, bodyJson({ acao: action }))),
    onSuccess: update,
  });
  const generate = useMutation({
    mutationFn: () => read(route.alertas[":alerta"].post.$post({ param }, bodyJson({ tipo: post, nota: note }))),
    onSuccess: (r) => { update(r.estado); setPost(null); setNote(""); },
  });
  const sentences = a.tipo === "fonte_mudou" || a.tipo === "fonte_fora" ? state.afirmacoes.filter((x: Claim) => x.evidenciaId === d.evidenciaId) : [];
  const send = (e: FormEvent) => { e.preventDefault(); if (note.trim().length >= 20) generate.mutate(); };
  const closed = a.estado !== "aberto";
  return (
    <li className={`grid gap-1.5 rounded-card px-4 py-3 shadow-curta ${closed ? "bg-papel-2" : "bg-branco"}`}>
      <b className="text-[15px] text-texto-forte">{alertTitle(a)}</b>
      {a.tipo === "fonte_mudou" && <span className="faixa-aviso py-1 text-[14px]">{t(`A página mudou ${when(String(d.em))}.`, `The page changed ${when(String(d.em))}.`)}</span>}
      {a.tipo === "fonte_fora" && <span className="faixa-aviso py-1 text-[14px]">{t(`${d.falhas} tentativas seguidas sem resposta.`, `${d.falhas} attempts in a row with no response.`)}</span>}
      {(a.tipo === "fonte_mudou" || a.tipo === "fonte_fora") && <a href={String(d.url)} target="_blank" rel="noreferrer" className="link-acao justify-self-start text-[15px]">{a.titulo}</a>}
      {sentences.length > 0 && <p className="m-0 text-[15px]">{t("Sustentava: ", "It supported: ")}{sentences.map((x) => `“${x.trecho}”`).join(" · ")}</p>}
      {a.tipo === "pessoa" && <a href={String(d.url)} target="_blank" rel="noreferrer" className="link-acao justify-self-start text-[15px]">{String(d.titulo ?? d.url)}</a>}
      {a.tipo === "processo" && <span className="mono text-texto">{String(d.movimento)} · {brDate(String(d.em).slice(0, 10))}{d.tribunal ? ` · ${String(d.tribunal).toUpperCase()}` : ""}</span>}
      {a.tipo === "lai_vencido" && d.recorrerAte && <span className="faixa-aviso py-1 text-[14px]">{t(`Sem resposta no prazo: dá para recorrer até ${brDate(String(d.recorrerAte))} (art. 15 da Lei 12.527/2011).`, `No reply in time: you can appeal until ${brDate(String(d.recorrerAte))} (art. 15 of Law 12,527/2011).`)}</span>}
      <span className="mono text-apoio">{t(`alerta de ${when(a.criadoEm)}`, `alert from ${when(a.criadoEm)}`)}</span>

      {closed ? (
        <span className="mono text-texto">
          {a.acao === "ignorado" ? t(`ignorado por ${a.porNome ?? "—"} · ${when(a.resolvidoEm!)}`, `ignored by ${a.porNome ?? "—"} · ${when(a.resolvidoEm!)}`)
            : a.acao === "texto_atualizado" ? t(`texto atualizado, registrado por ${a.porNome ?? "—"} · ${when(a.resolvidoEm!)}`, `text updated, recorded by ${a.porNome ?? "—"} · ${when(a.resolvidoEm!)}`)
            : <>{a.acao === "post_errata" ? t("post de errata criado", "correction post created") : t("post de atualização criado", "update post created")}{t(` por ${a.porNome ?? "—"} · ${when(a.resolvidoEm!)}`, ` by ${a.porNome ?? "—"} · ${when(a.resolvidoEm!)}`)}{a.pecaId && <> · <Link to={`/t/${slug}/p/${a.pecaId}`} className="link-acao font-normal">{t("ver o post", "see the post")}</Link></>}</>}
        </span>
      ) : editor && (post ? (
        <form onSubmit={send} className="grid gap-2 rounded-card bg-papel-2 px-3 py-3">
          <label className="campo">
            <span>{post === "errata" ? t("O que foi corrigido", "What was corrected") : t("O que mudou", "What changed")}</span>
            <textarea className="entrada min-h-24 bg-branco" value={note} maxLength={600} onChange={(e) => { setNote(e.target.value); generate.reset(); }} />
          </label>
          <span className="ajuda">{t("Em uma ou duas frases, com as suas palavras: é o que o post diz. O post de antes não muda (o Instagram não troca a imagem); este sai novo, com o rótulo na manchete.", "In one or two sentences, in your own words: it's what the post says. The earlier post doesn't change (Instagram doesn't swap the image); this one is new, with the label in the headline.")}</span>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn-sec bg-branco" disabled={generate.isPending || note.trim().length < 20}>{generate.isPending ? t("Criando…", "Creating…") : post === "errata" ? t("Criar o post de errata", "Create the correction post") : t("Criar o post de atualização", "Create the update post")}</button>
            <button type="button" className="btn-sec bg-branco" onClick={() => setPost(null)}>{t("Cancelar", "Cancel")}</button>
          </div>
          {generate.isError && <p role="alert" className="faixa-erro m-0">{message(generate.error)}</p>}
        </form>
      ) : (
        <div className="flex flex-wrap gap-2 pt-1">
          <Link to="?" className="btn-sec bg-papel-2 no-underline">{t("Abrir o texto", "Open the text")}</Link>
          <button type="button" className="btn-sec bg-papel-2" onClick={() => resolve.mutate("texto_atualizado")} disabled={resolve.isPending}>{t("Atualizei o texto", "I updated the text")}</button>
          <button type="button" className="btn-sec bg-papel-2" onClick={() => setPost("atualizacao")}>{t("Post de atualização", "Update post")}</button>
          <button type="button" className="btn-sec bg-papel-2" onClick={() => setPost("errata")}>{t("Post de errata", "Correction post")}</button>
          <button type="button" className="link-acao border-0 bg-transparent p-0 text-[14px] font-normal" onClick={() => resolve.mutate("ignorado")} disabled={resolve.isPending}>{t("Ignorar", "Ignore")}</button>
        </div>
      ))}
      {resolve.isError && <p role="alert" className="faixa-erro m-0">{message(resolve.error)}</p>}
    </li>
  );
}

// ── LAI (in the Dossier) ────────────────────────────────────────────────────────────────────────────────────────

const STATE_LAI_LABEL: Record<LaiRequest["estado"], () => string> = {
  rascunho: () => t("pronto para protocolar", "ready to file"),
  protocolado: () => t("protocolado", "filed"),
  prorrogado: () => t("prorrogado", "extended"),
  vencido: () => t("prazo vencido sem resposta", "deadline passed with no reply"),
  respondido: () => t("respondido", "answered"),
  negado: () => t("respondido sem atender", "answered without meeting the request"),
  recurso: () => t("em recurso", "under appeal"),
};

/** O prazo mais urgente diz a linha: vencido, janela de recurso aberta, prazo perto. */
export function summaryLai(e: DeskState): Summary {
  const { pedidos: requests, candidatas: candidates } = e.lai;
  const total = requests.length ? t(qty(requests.length, "pedido", "pedidos"), qty(requests.length, "request", "requests")) : t("nenhum pedido", "no requests");
  const passed = requests.filter((p) => p.estado === "vencido" || p.prazoRecursoPassou).length;
  if (passed) return { tom: "erro", texto: `${t(passed === 1 ? "1 com prazo vencido" : `${passed} com prazo vencido`, passed === 1 ? "1 past its deadline" : `${passed} past their deadline`)} · ${total}` };
  const appeal = requests.find((p) => p.podeRecorrer && p.recorrerAte);
  if (appeal) return { tom: "aviso", texto: `${t(`dá para recorrer até ${brDate(appeal.recorrerAte!)}`, `you can appeal until ${brDate(appeal.recorrerAte!)}`)} · ${total}` };
  // Refused on appeal: the next step is outside the app, and the deadline runs (10 days from notice, except when the rule is local).
  const denied = requests.find((p) => p.proximaInstanciaFora);
  if (denied) return { tom: "aviso", texto: `${denied.regraLocal
    ? t("negado de novo · próxima instância fora do app", "denied again · next level outside the app")
    : t("negado · 10 dias da ciência para a próxima instância", "denied · 10 days from notice for the next level")} · ${total}` };
  const near = requests.filter((p) => !p.respostaEm && p.diasRestantes !== null && p.diasRestantes <= 5).sort((a, b) => a.diasRestantes! - b.diasRestantes!)[0];
  if (near) {
    const d = near.diasRestantes!;
    return { tom: "aviso", texto: `${d <= 0 ? t("o prazo vence hoje", "the deadline is today") : d === 1 ? t("falta 1 dia para o prazo", "1 day to the deadline") : t(`faltam ${d} dias para o prazo`, `${d} days to the deadline`)} · ${total}` };
  }
  if (!requests.length && candidates.length) return { texto: `${total} · ${t(candidates.length === 1 ? "1 frase pode virar pedido" : `${candidates.length} frases podem virar pedido`, candidates.length === 1 ? "1 sentence can become a request" : `${candidates.length} sentences can become requests`)}` };
  return { texto: total };
}

export function RequestsLai({ tenantId, textoId: textId, estado: state, editor, atualizar: update }: {
  tenantId: string; textoId: string; estado: DeskState; editor: boolean; atualizar: (d: DeskState) => void;
}) {
  const { pedidos: requests, candidatas: candidates, portal } = state.lai;
  // The form only opens on request, and in the URL (`?lai=0`), separate from the other side's `?pedir=`: one does not close the other.
  const [request, openRequest] = usePart("lai", null);
  const n = request === null ? null : Number(request);
  const chosen = n !== null && candidates[n] ? n : null;
  return (
    <div className="grid gap-3">
      {requests.length ? (
        <ul className="m-0 grid list-none gap-3 p-0">
          {requests.map((p) => <CardLai key={p.id} p={p} tenantId={tenantId} textoId={textId} portal={portal} editor={editor} atualizar={update} />)}
        </ul>
      ) : <p className="m-0 text-apoio">{t("Nenhum pedido de acesso à informação. Frase sem fonte com dado de órgão público pode virar pedido pela Lei 12.527/2011.", "No access-to-information request. A sentence with no source and data from a public body can become a request under Brazil's Law 12,527/2011.")}</p>}
      {editor && candidates.length > 0 && (chosen === null ? (
        <div className="grid gap-1.5">
          <span className="text-[15px] font-bold text-texto-forte">{t("Frases sem fonte com dado de órgão público", "Sentences with no source and data from a public body")}</span>
          <ul className="m-0 grid list-none gap-1.5 p-0">
            {candidates.map((c, i) => (
              <li key={`${c.blocoId}:${c.trecho}`} className="grid gap-1 border-t border-fio pt-2">
                <span className="text-[15px]">“{c.trecho}”</span>
                <button type="button" className="btn-sec justify-self-start bg-papel-2" onClick={() => openRequest(String(i))}>{t(`Pedir por LAI a ${c.orgao}`, `File an FOI request with ${c.orgao}`)}</button>
              </li>
            ))}
          </ul>
        </div>
      ) : <FormLai c={candidates[chosen]} tenantId={tenantId} textoId={textId} pronto={(d) => { update(d); openRequest(null); }} cancelar={() => openRequest(null)} />)}
    </div>
  );
}

function FormLai({ c, tenantId, textoId: textId, pronto: ready, cancelar: cancel }: {
  c: DeskState["lai"]["candidatas"][number]; tenantId: string; textoId: string; pronto: (d: DeskState) => void; cancelar: () => void;
}) {
  const [agency, setAgency] = useState(c.orgao);
  const [level, setLevel] = useState<"federal" | "estadual" | "municipal">(/^Prefeitura|^Câmara Municipal|^Secretaria Municipal/.test(c.orgao) ? "municipal" : "estadual");
  const [request, setRequest] = useState(c.modelo);
  const create = useMutation({
    mutationFn: () => read(route.lai.$post({ param: { tenantId, id: textId } }, bodyJson({ blocoId: c.blocoId, trecho: c.trecho, orgao: agency, esfera: level, pedido: request }))),
    onSuccess: ready,
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="grid gap-3 rounded-card bg-papel-2 px-4 py-4">
      <p className="m-0 text-[15px]">“{c.trecho}”</p>
      <label className="campo"><span>{t("Órgão", "Agency")}</span><input className="entrada bg-branco" value={agency} maxLength={200} onChange={(e) => setAgency(e.target.value)} /></label>
      <label className="campo">
        <span>{t("Esfera", "Level")}</span>
        <select className="entrada bg-branco" value={level} onChange={(e) => setLevel(e.target.value as typeof level)}>
          <option value="federal">{t("federal", "federal")}</option>
          <option value="estadual">{t("estadual", "state")}</option>
          <option value="municipal">{t("municipal", "municipal")}</option>
        </select>
      </label>
      <label className="campo">
        <span>{t("O pedido (em português, como vai para o órgão)", "The request (in Portuguese, as it goes to the agency)")}</span>
        <textarea className="entrada min-h-64 bg-branco" value={request} maxLength={8000} onChange={(e) => setRequest(e.target.value)} />
      </label>
      <span className="ajuda">{t("Complete depois de “Especificamente:” com o que você quer (período, valores, contratos). O app não entra no portal: você cola o pedido lá e registra o protocolo aqui.", "Complete after “Especificamente:” with what you want (period, amounts, contracts). The app doesn't log into the portal: you paste the request there and record the protocol here.")}</span>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-sec bg-branco" disabled={create.isPending}>{t("Preparar o pedido", "Prepare the request")}</button>
        <button type="button" className="btn-sec bg-branco" onClick={cancel}>{t("Cancelar", "Cancel")}</button>
      </div>
      {create.isError && <p role="alert" className="faixa-erro m-0">{message(create.error)}</p>}
    </form>
  );
}

function CardLai({ p, tenantId, textoId: textId, portal, editor, atualizar: update }: {
  p: LaiRequest; tenantId: string; textoId: string; portal: string; editor: boolean; atualizar: (d: DeskState) => void;
}) {
  const param = { tenantId, id: textId, pedido: p.id };
  const [step, setStep] = useState<"protocolo" | "prorrogacao" | "resposta" | "recurso" | null>(null);
  const [protocol, setProtocol] = useState("");
  const [data, setData] = useState(todayLocal());
  const [text, setText] = useState("");
  const [met, setMet] = useState<"sim" | "nao">("sim");
  const [copied, setCopied] = useState<string | null>(null);
  const move = useMutation({
    mutationFn: () => {
      const body = step === "protocolo" ? { protocolo: protocol, protocoladoEm: data } : step === "prorrogacao" ? { em: data }
        : step === "resposta" ? { texto: text, recebidaEm: data, atendeu: met === "sim" } : { texto: text, em: data };
      return read(route.lai[":pedido"][":acao"].$post({ param: { ...param, acao: step! } }, bodyJson(body)));
    },
    onSuccess: (d) => { update(d); setStep(null); setText(""); setProtocol(""); },
  });
  const copy = async (which: string, s: string) => { await navigator.clipboard.writeText(s).then(() => setCopied(which), () => setCopied(null)); };
  const open = (q: typeof step) => { setStep(q); setData(todayLocal()); setText(q === "recurso" ? p.modeloRecurso ?? "" : ""); move.reset(); };
  const warning = p.estado === "vencido" || p.estado === "negado";
  const complaint = p.tipoRecurso === "reclamacao";
  // On appeal, the answer that arrives is the appeal's (or the complaint's).
  const fromAppealAnswer = p.estado === "recurso";
  return (
    <li className="grid gap-1.5 rounded-card bg-branco px-4 py-3 shadow-curta">
      <b className="text-[15px] text-texto-forte">{p.orgao} <span className="mono font-normal text-apoio">· {p.esfera === "federal" ? t("federal", "federal") : p.esfera === "estadual" ? t("estadual", "state") : t("municipal", "municipal")}</span></b>
      <span className="text-[15px] text-apoio">“{p.trecho}”</span>
      <span className={`mono ${warning ? "text-terracota" : p.estado === "respondido" ? "text-verde" : "text-texto"}`}>
        {STATE_LAI_LABEL[p.estado]()}
        {p.protocolo ? t(` · protocolo ${p.protocolo}`, ` · protocol ${p.protocolo}`) : ""}
        {p.protocoladoEm ? t(` · em ${brDate(p.protocoladoEm)}`, ` · on ${brDate(p.protocoladoEm)}`) : ""}
      </span>
      {p.prazoFinal && !p.respostaEm && (
        <span className="mono text-texto">
          {t(`prazo: ${brDate(p.prazoFinal)}`, `due: ${brDate(p.prazoFinal)}`)}
          {p.prorrogadoEm ? t(" (20 dias + 10 de prorrogação)", " (20 days + 10 extension)") : t(" (20 dias; o órgão pode prorrogar por mais 10)", " (20 days; the agency may extend by 10 more)")}
          {p.diasRestantes !== null && p.diasRestantes >= 0 ? t(` · faltam ${p.diasRestantes} dias`, ` · ${p.diasRestantes} days left`) : ""}
        </span>
      )}
      {p.respostaEm && <span className="mono text-texto">{t(`resposta em ${brDate(p.respostaEm)}: está no dossiê`, `reply on ${brDate(p.respostaEm)}: it's in the dossier`)}</span>}
      {p.recorrerAte && !p.recursoEm && (p.prazoRecursoPassou
        ? <span className="faixa-erro py-1 text-[14px]">{t(`O prazo para ${complaint ? "reclamar" : "recorrer"} terminou em ${brDate(p.recorrerAte)}. Se você protocolou a tempo, registre com a data do protocolo.`, `The deadline to ${complaint ? "complain" : "appeal"} ended on ${brDate(p.recorrerAte)}. If you filed in time, record it with the filing date.`)}</span>
        : p.podeRecorrer
        ? <span className="faixa-aviso py-1 text-[14px]">{complaint
          ? t(`Dá para reclamar até ${brDate(p.recorrerAte)} à autoridade de monitoramento da LAI do órgão (Decreto nº 7.724/2012, art. 22).`, `You can file a complaint until ${brDate(p.recorrerAte)} with the agency's access-to-information monitoring authority (Decree 7,724/2012, art. 22).`)
          : t(`Dá para recorrer até ${brDate(p.recorrerAte)} à autoridade acima de quem respondeu (art. 15).`, `You can appeal until ${brDate(p.recorrerAte)} to the authority above whoever answered (art. 15).`)}</span>
        : p.recorrerDe && <span className="faixa-aviso py-1 text-[14px]">{t(`Sem resposta no Executivo federal, a reclamação abre em ${brDate(p.recorrerDe)} (30 dias do pedido) e vai até ${brDate(p.recorrerAte)}.`, `With no reply from the federal Executive, the complaint opens on ${brDate(p.recorrerDe)} (30 days after the request) and runs until ${brDate(p.recorrerAte)}.`)}</span>)}
      {p.regraLocal && p.protocoladoEm && !p.respostaEm && <span className="mono text-apoio">{t("estado e município têm regulamento próprio da LAI: confira o prazo e a quem recorrer", "states and municipalities have their own access-to-information rules: check the deadline and whom to appeal to")}</span>}
      {!p.regraLocal && p.protocoladoEm && !p.respostaEm && <span className="mono text-apoio">{t("o prazo conta Carnaval e Corpus Christi; ponto facultativo decretado no ano não entra: confira", "the deadline skips Carnival and Corpus Christi; one-off holidays decreed each year aren't counted: check")}</span>}
      {p.recursoEm && <span className="mono text-texto">{p.recursoTipo === "reclamacao" ? t(`reclamação protocolada em ${brDate(p.recursoEm)}`, `complaint filed on ${brDate(p.recursoEm)}`) : t(`recurso protocolado em ${brDate(p.recursoEm)}`, `appeal filed on ${brDate(p.recursoEm)}`)}</span>}
      {p.proximaInstanciaFora && <span className="faixa-aviso py-1 text-[14px]">{p.regraLocal
        ? t("Negado de novo: a instância seguinte segue o regulamento do estado ou do município, fora do app.", "Denied again: the next level follows the state or city rules, outside the app.")
        : p.recursoTipo === "reclamacao"
          ? t("A reclamação não resolveu: dá para recorrer à CGU em 10 dias da ciência (Decreto 7.724/2012, art. 23), pelo Fala.BR. O app não acompanha essa etapa.", "The complaint didn't resolve it: you can appeal to the CGU within 10 days of notice (Decree 7,724/2012, art. 23), through Fala.BR. The app doesn't track this step.")
          : t("Recurso negado: dá para recorrer à autoridade máxima do órgão em 10 dias da ciência (Decreto 7.724/2012, art. 21, parágrafo único) e, se negar de novo, à CGU (art. 23). O app não acompanha essas etapas.", "Appeal denied: you can appeal to the agency's highest authority within 10 days of notice (Decree 7,724/2012, art. 21, sole paragraph) and, if denied again, to the CGU (art. 23). The app doesn't track these steps.")}</span>}
      {p.recursoRespostaEm && <span className="mono text-texto">{t(`resposta ${p.recursoTipo === "reclamacao" ? "à reclamação" : "ao recurso"} em ${brDate(p.recursoRespostaEm)}: está no dossiê`, `reply to the ${p.recursoTipo === "reclamacao" ? "complaint" : "appeal"} on ${brDate(p.recursoRespostaEm)}: it's in the dossier`)}</span>}

      {p.estado === "rascunho" && (
        <details className="text-[15px]">
          <summary className="link-acao w-fit cursor-pointer font-normal">{t("Ver o pedido", "See the request")}</summary>
          <pre className="mt-2 whitespace-pre-wrap rounded-card bg-papel-2 px-3 py-2 font-[inherit] text-[15px]">{p.pedido}</pre>
        </details>
      )}
      {editor && !step && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {p.estado === "rascunho" && <>
            <button type="button" className="btn-sec bg-papel-2" onClick={() => void copy("pedido", p.pedido)}>{copied === "pedido" ? t("Pedido copiado", "Request copied") : t("Copiar o pedido", "Copy the request")}</button>
            {p.esfera === "federal" && <a href={portal} target="_blank" rel="noreferrer" className="link-acao text-[14px] font-normal">{t("abrir o Fala.BR", "open Fala.BR")}</a>}
            <button type="button" className="btn-sec bg-papel-2" onClick={() => open("protocolo")}>{t("Registrar o protocolo", "Record the protocol")}</button>
          </>}
          {(p.estado === "protocolado" || p.estado === "vencido") && !p.prorrogadoEm && <button type="button" className="btn-sec bg-papel-2" onClick={() => open("prorrogacao")}>{t("O órgão prorrogou", "The agency extended it")}</button>}
          {(p.estado === "protocolado" || p.estado === "prorrogado" || p.estado === "vencido") && <button type="button" className="btn-sec bg-papel-2" onClick={() => open("resposta")}>{t("Registrar a resposta", "Record the reply")}</button>}
          {fromAppealAnswer && <button type="button" className="btn-sec bg-papel-2" onClick={() => open("resposta")}>{p.recursoTipo === "reclamacao" ? t("Registrar a resposta à reclamação", "Record the reply to the complaint") : t("Registrar a resposta ao recurso", "Record the reply to the appeal")}</button>}
          {p.podeRecorrer && <button type="button" className="btn-sec bg-papel-2" onClick={() => open("recurso")}>{complaint ? t("Preparar a reclamação", "Prepare the complaint") : t("Preparar o recurso", "Prepare the appeal")}</button>}
        </div>
      )}
      {editor && step && (
        <form onSubmit={(e) => { e.preventDefault(); move.mutate(); }} className="grid gap-2 rounded-card bg-papel-2 px-3 py-3">
          {step === "protocolo" && <label className="campo"><span>{t("Número do protocolo", "Protocol number")}</span><input className="entrada bg-branco" value={protocol} maxLength={80} onChange={(e) => setProtocol(e.target.value)} /></label>}
          {(step === "resposta" || step === "recurso") && (
            <label className="campo">
              <span>{step === "resposta" ? t("A resposta do órgão, como chegou", "The agency's reply, as it arrived") : complaint ? t("A reclamação (em português, como vai para o órgão)", "The complaint (in Portuguese, as it goes to the agency)") : t("O recurso (em português, como vai para o órgão)", "The appeal (in Portuguese, as it goes to the agency)")}</span>
              <textarea className="entrada min-h-40 bg-branco" value={text} maxLength={step === "resposta" ? 20000 : 8000} onChange={(e) => setText(e.target.value)} />
            </label>
          )}
          {step === "resposta" && (
            <fieldset className="m-0 flex flex-wrap gap-x-4 gap-y-1 border-0 p-0">
              <legend className="mb-1 text-[15px] font-bold text-texto-forte">{t("A resposta atendeu o pedido?", "Did the reply meet the request?")}</legend>
              <label className="inline-flex min-h-11 items-center gap-2"><input type="radio" name={`atendeu-${p.id}`} checked={met === "sim"} onChange={() => setMet("sim")} />{t("Sim", "Yes")}</label>
              <label className="inline-flex min-h-11 items-center gap-2"><input type="radio" name={`atendeu-${p.id}`} checked={met === "nao"} onChange={() => setMet("nao")} />{t("Não (abre o recurso)", "No (opens the appeal)")}</label>
            </fieldset>
          )}
          <label className="campo">
            <span>{step === "protocolo" ? t("Data do protocolo", "Filing date") : step === "prorrogacao" ? t("Data em que o órgão prorrogou", "Date the agency extended it") : step === "resposta" ? t("Data da resposta", "Reply date") : t("Data em que você protocolou o recurso", "Date you filed the appeal")}</span>
            <input type="date" className="entrada bg-branco" value={data} max={todayLocal()} onChange={(e) => setData(e.target.value)} />
          </label>
          {step === "recurso" && <button type="button" className="btn-sec justify-self-start bg-branco" onClick={() => void copy("recurso", text)}>{copied === "recurso" ? t("Texto copiado", "Text copied") : complaint ? t("Copiar a reclamação", "Copy the complaint") : t("Copiar o recurso", "Copy the appeal")}</button>}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn-sec bg-branco" disabled={move.isPending}>{step === "recurso" ? (complaint ? t("Registrar a reclamação", "Record the complaint") : t("Registrar o recurso", "Record the appeal")) : t("Registrar", "Record")}</button>
            <button type="button" className="btn-sec bg-branco" onClick={() => setStep(null)}>{t("Cancelar", "Cancel")}</button>
          </div>
          {move.isError && <p role="alert" className="faixa-erro m-0">{message(move.error)}</p>}
        </form>
      )}
    </li>
  );
}
