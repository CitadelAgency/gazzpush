// The Story's legal shield (Phase 4): the other-side request (by email through the app or copied and sent elsewhere,
// with the time recorded and the deadline), the reply that enters the dossier, the defence package (a zip with a
// timestamp) and the public sources page. The request's text is a fixed template the person edits: nothing here is
// written by AI.
import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { headerLanguage, bodyJson, ApiError, read } from "../api";
import { useShell } from "../shell/context";
import { when, whenFuture } from "../queue";
import { t } from "../language";
import { MEANS, RISKS_OTHER_SIDE, halfLabel } from "./Assistant";
import { usePart } from "../kit/Parts";
import { message, qty, route, type DeskState, type Summary } from "./common";

type RequestEntry = DeskState["outroLado"]["pedidos"][number];

/** "2026-11-05T18:00" in the device's time zone (the value of the <input type="datetime-local">). */
const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const iso = (v: string) => new Date(v).toISOString();

/** The request in the outlet's language (content goes out in the publisher's language). */
function requestModel(o: { en: boolean; quem: string; nome: string; veiculo: string; titulo: string; trecho: string | null; prazo: string }) {
  const deadline = new Date(o.prazo).toLocaleString(o.en ? "en-US" : "pt-BR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  if (o.en) {
    return `Hello${o.quem ? `, ${o.quem}` : ""}.\n\nI'm ${o.nome}, from ${o.veiculo}. I'm working on a story titled "${o.titulo}".${o.trecho ? ` It states:\n\n"${o.trecho}"` : ""}\n\nI'd like to hear your side. Could you reply by ${deadline}? You can simply answer this e-mail.\n\nThank you,\n${o.nome}`;
  }
  return `Olá${o.quem ? `, ${o.quem}` : ""}.\n\nSou ${o.nome}, do ${o.veiculo}. Estou fazendo uma reportagem com o título "${o.titulo}".${o.trecho ? ` O texto afirma:\n\n"${o.trecho}"` : ""}\n\nGostaria de ouvir o seu lado. Pode responder até ${deadline}? Pode responder a este e-mail mesmo.\n\nObrigado,\n${o.nome}`;
}

export const REQUEST_OTHER_SIDE = "outro-lado";

/** The row says what has no reply; a risky sentence without a request is an alert, even with the list empty. */
export function summaryOtherSide(e: DeskState): Summary {
  const { pedidos: requests } = e.outroLado;
  const total = requests.length ? t(qty(requests.length, "pedido", "pedidos"), qty(requests.length, "request", "requests")) : t("nenhum pedido", "no requests");
  const notLeft = requests.filter((p) => p.erro && !p.respostaEm).length;
  if (notLeft) return { tom: "erro", texto: `${t(notLeft === 1 ? "1 e-mail não saiu" : `${notLeft} e-mails não saíram`, notLeft === 1 ? "1 e-mail didn't go out" : `${notLeft} e-mails didn't go out`)} · ${total}` };
  const overdue = requests.filter((p) => p.vencido && !p.respostaEm).length;
  if (overdue) return { tom: "aviso", texto: `${t(overdue === 1 ? "1 sem resposta no prazo" : `${overdue} sem resposta no prazo`, `${overdue} with no reply in time`)} · ${total}` };
  const risks = requests.length ? 0 : e.afirmacoes.filter((a) => a.estado === "risco" && RISKS_OTHER_SIDE.includes(a.risco ?? "")).length;
  if (risks) return { tom: "aviso", texto: `${t(risks === 1 ? "1 frase de risco sem outro lado" : `${risks} frases de risco sem outro lado`, risks === 1 ? "1 risky sentence with no other side" : `${risks} risky sentences with no other side`)}` };
  const waiting = requests.filter((p) => !p.respostaEm).sort((a, b) => a.prazo.localeCompare(b.prazo))[0];
  return { texto: waiting ? `${t(`esperando resposta até ${whenFuture(waiting.prazo)}`, `waiting for a reply until ${whenFuture(waiting.prazo)}`)} · ${total}` : total };
}

/** Other side: the requests (to whom, when sent, deadline, reply) and the request form, which only opens on request. */
export function OtherSide({ tenantId, textoId: textId, estado: state, editor, atualizar: update }: {
  tenantId: string; textoId: string; estado: DeskState; editor: boolean; atualizar: (d: DeskState) => void;
}) {
  const { pedidos: requests, emailLigado: emailOn } = state.outroLado;
  const [request, openRequest] = usePart("pedir", null);
  const asking = request === REQUEST_OTHER_SIDE;
  return (
    <div className="grid gap-3">
      {requests.length ? (
        <ul className="m-0 grid list-none gap-2 p-0">
          {requests.map((p) => <CardRequest key={p.id} p={p} tenantId={tenantId} textoId={textId} editor={editor} atualizar={update} />)}
        </ul>
      ) : <p className="m-0 text-apoio">{t("Nenhum pedido de outro lado ainda. Quem é acusado no texto tem direito de responder antes de publicar.", "No request to the other side yet. Anyone accused in the text has the right to respond before publication.")}</p>}
      {editor && (asking
        ? <FormRequest tenantId={tenantId} textoId={textId} estado={state} emailLigado={emailOn} pronto={(d) => { update(d); openRequest(null); }} cancelar={() => openRequest(null)} />
        : requests.length > 0 && <button type="button" className="btn-sec justify-self-start bg-papel-2" onClick={() => openRequest(REQUEST_OTHER_SIDE)}>{t("Pedir o outro lado", "Ask the other side")}</button>)}
    </div>
  );
}

function CardRequest({ p, tenantId, textoId: textId, editor, atualizar: update }: { p: RequestEntry; tenantId: string; textoId: string; editor: boolean; atualizar: (d: DeskState) => void }) {
  const [answering, setAnswering] = useState(false);
  const [answer, setAnswer] = useState("");
  const [arrived, setArrived] = useState(local(new Date()));
  const [copied, setCopied] = useState(false);
  const record = useMutation({
    mutationFn: () => read(route.pedidos[":pedido"].resposta.$post({ param: { tenantId, id: textId, pedido: p.id } }, bodyJson({ texto: answer, recebidaEm: iso(arrived) }))),
    onSuccess: (d) => { update(d); setAnswering(false); setAnswer(""); },
  });
  const copy = async () => { await navigator.clipboard.writeText(`${p.assunto}\n\n${p.corpo}`).then(() => setCopied(true), () => setCopied(false)); };
  const upload = p.meio === "email"
    ? (p.enviadoEm ? t(`mandado por e-mail pelo app, ${when(p.enviadoEm)} (hora do servidor)`, `sent by e-mail from the app, ${when(p.enviadoEm)} (server time)`) : null)
    : t(`mandado por fora (${halfLabel(p.canal ?? "outro")}), ${when(p.enviadoEm!)}, segundo ${p.porNome ?? "quem registrou"}; registrado ${when(p.registradoEm)}`,
      `sent outside the app (${halfLabel(p.canal ?? "outro")}), ${when(p.enviadoEm!)}, according to ${p.porNome ?? "whoever recorded it"}; recorded ${when(p.registradoEm)}`);
  return (
    <li className="grid gap-1.5 rounded-card bg-branco px-3 py-2.5 shadow-curta">
      <b className="text-[15px] text-texto-forte">{p.paraNome}{p.paraEmail && <span className="mono font-normal text-apoio"> · {p.paraEmail}</span>}</b>
      <span className="text-[15px]">{p.assunto}</span>
      {p.trecho && <span className="text-[14px] text-apoio">“{p.trecho}”</span>}
      {upload && <span className="mono text-apoio">{upload}</span>}
      <span className="mono text-apoio">{t(`prazo: ${whenFuture(p.prazo)}`, `deadline: ${whenFuture(p.prazo)}`)}</span>
      {p.erro && (
        <p role="alert" className="faixa-erro m-0 text-[14px]">
          {t(`O e-mail não saiu (${p.erro}). Copie o pedido e mande por fora.`, `The e-mail didn't go out (${p.erro}). Copy the request and send it yourself.`)}{" "}
          <button type="button" className="link-acao border-0 bg-transparent p-0" onClick={() => void copy()}>{copied ? t("Copiado", "Copied") : t("Copiar o pedido", "Copy the request")}</button>
        </p>
      )}
      {p.respostaEm
        ? <span className="mono text-verde">{t(`respondeu ${when(p.respostaEm)}; a resposta está no dossiê`, `replied ${when(p.respostaEm)}; the reply is in the dossier`)}</span>
        : p.vencido && <p className="faixa-aviso m-0 py-1 text-[14px]">{t("Prazo vencido, sem resposta. Registre isso no texto.", "Deadline passed with no reply. Say so in the text.")}</p>}
      {editor && !answering && (
        <button type="button" className="link-acao justify-self-start border-0 bg-transparent p-0 text-[14px] font-normal" onClick={() => setAnswering(true)}>
          {p.respostaEm ? t("Registrar outra resposta", "Record another reply") : t("Registrar resposta", "Record reply")}<span className="sr-only">{t(` de ${p.paraNome}`, ` from ${p.paraNome}`)}</span>
        </button>
      )}
      {answering && (
        <form className="mt-1 grid gap-2" onSubmit={(e) => { e.preventDefault(); if (answer.trim()) record.mutate(); }}>
          <label className="campo">
            <span className="text-[14px]!">{t("A resposta, como chegou", "The reply, as it arrived")}</span>
            <textarea className="entrada min-h-28 bg-branco py-2" value={answer} onChange={(e) => setAnswer(e.target.value)} required />
          </label>
          <label className="campo">
            <span className="text-[14px]!">{t("Quando chegou", "When it arrived")}</span>
            <input type="datetime-local" className="entrada bg-branco" value={arrived} max={local(new Date())} onChange={(e) => setArrived(e.target.value)} required />
          </label>
          {record.isError && <p role="alert" className="m-0 text-[15px] text-terracota">{message(record.error)}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn-sec bg-papel-2" disabled={record.isPending || !answer.trim()}>{t("Pôr no dossiê", "Add to the dossier")}</button>
            <button type="button" className="btn-sec" onClick={() => setAnswering(false)}>{t("Cancelar", "Cancel")}</button>
          </div>
        </form>
      )}
    </li>
  );
}

function FormRequest({ tenantId, textoId: textId, estado: state, emailLigado: emailOn, pronto: ready, cancelar: cancel }: {
  tenantId: string; textoId: string; estado: DeskState; emailLigado: boolean; pronto: (d: DeskState) => void; cancelar: () => void;
}) {
  const { me, veiculo: outlet } = useShell();
  const en = outlet.idioma === "en";
  const risks = state.afirmacoes.filter((a) => a.estado === "risco" && RISKS_OTHER_SIDE.includes(a.risco ?? ""));
  const [sentence, setSentence] = useState(risks[0]?.id ?? "");
  const [who, setWho] = useState("");
  const [email, setEmail] = useState("");
  const [deadline, setDeadline] = useState(local(new Date(Date.now() + 48 * 3_600_000)));
  const [subject, setSubject] = useState(en ? `Request for comment: ${state.texto.titulo}` : `Pedido de posicionamento: ${state.texto.titulo}`);
  const [body, setBody] = useState<string | null>(null);   // null: the template follows the fields until the person edits
  const [outside, setOutside] = useState(false);
  const [channel, setChannel] = useState("email");
  const [sentAt, setSentAt] = useState(local(new Date()));
  const [copied, setCopied] = useState<boolean | null>(null);
  const a = risks.find((x) => x.id === sentence) ?? null;
  const text = body ?? requestModel({ en, quem: who.trim(), nome: me.user.name, veiculo: outlet.nome, titulo: state.texto.titulo, trecho: a?.trecho ?? null, prazo: deadline });
  const baseBody = { paraNome: who, paraEmail: email || undefined, assunto: subject, corpo: text, prazo: deadline ? iso(deadline) : "", ...(a ? { blocoId: a.blocoId, trecho: a.trecho } : {}) };
  const send = useMutation({
    mutationFn: (half: "email" | "copiado") => read(route.pedidos.$post({ param: { tenantId, id: textId } },
      bodyJson(half === "email" ? { ...baseBody, meio: half } : { ...baseBody, meio: half, canal: channel, enviadoEm: iso(sentAt) }))),
    onSuccess: ready,
  });
  const copy = () => navigator.clipboard.writeText(`${subject}\n\n${text}`).then(() => { setCopied(true); setOutside(true); }, () => { setCopied(false); setOutside(true); });
  const missing = !who.trim() || !subject.trim() || !text.trim() || !deadline;
  return (
    <form className="grid gap-3 rounded-card bg-papel-2/60 p-4" onSubmit={(e: FormEvent) => { e.preventDefault(); if (!missing && emailOn) send.mutate("email"); }}>
      <h3 className="m-0 text-[17px]">{t("Pedir o outro lado", "Ask the other side")}</h3>
      {risks.length > 0 && (
        <label className="campo">
          <span>{t("Sobre qual frase", "About which sentence")}</span>
          <select className="entrada bg-branco" value={sentence} onChange={(e) => setSentence(e.target.value)}>
            {risks.map((r) => <option key={r.id} value={r.id}>{r.trecho.length > 90 ? `${r.trecho.slice(0, 90)}…` : r.trecho}</option>)}
            <option value="">{t("Nenhuma frase específica", "No specific sentence")}</option>
          </select>
        </label>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="campo">
          <span>{t("Quem você está procurando", "Who you are contacting")}</span>
          <input className="entrada bg-branco" value={who} maxLength={200} onChange={(e) => setWho(e.target.value)} required />
        </label>
        <label className="campo">
          <span>{emailOn ? t("E-mail", "E-mail") : t("E-mail (opcional)", "E-mail (optional)")}</span>
          <input type="email" className="entrada bg-branco" value={email} autoCapitalize="none" spellCheck={false} onChange={(e) => setEmail(e.target.value)} />
        </label>
      </div>
      <label className="campo">
        <span>{t("Prazo para responder", "Deadline to reply")}</span>
        <input type="datetime-local" className="entrada bg-branco" value={deadline} min={local(new Date())} onChange={(e) => setDeadline(e.target.value)} required />
      </label>
      <label className="campo">
        <span>{t("Assunto", "Subject")}</span>
        <input className="entrada bg-branco" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} required />
      </label>
      <label className="campo">
        <span>{t("O pedido", "The request")}</span>
        <textarea className="entrada min-h-56 bg-branco py-2 leading-[1.5]" value={text} onChange={(e) => setBody(e.target.value)} required />
        <span className="ajuda">{t("Um modelo para você ajustar. Diga o que o texto afirma e dê um prazo razoável.", "A template for you to adjust. Say what the text states and give a reasonable deadline.")}</span>
      </label>
      {!emailOn && <p className="mono m-0 text-apoio">{t("o envio por e-mail não está configurado neste veículo: copie e mande por fora", "sending by e-mail isn't set up for this outlet: copy it and send it yourself")}</p>}
      {outside && (
        <fieldset className="grid gap-3 border-0 p-0">
          <legend className="mb-2 text-[15px]">{copied === false ? t("O navegador não deixou copiar: selecione o texto acima. Depois de mandar, diga quando e por onde.", "The browser didn't allow copying: select the text above. After sending it, say when and how.") : t("Copiado. Depois de mandar, diga quando e por onde.", "Copied. After sending it, say when and how.")}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="campo">
              <span>{t("Por onde mandou", "How you sent it")}</span>
              <select className="entrada bg-branco" value={channel} onChange={(e) => setChannel(e.target.value)}>{MEANS.map(([k, r]) => <option key={k} value={k}>{r()}</option>)}</select>
            </label>
            <label className="campo">
              <span>{t("Quando mandou", "When you sent it")}</span>
              <input type="datetime-local" className="entrada bg-branco" value={sentAt} max={local(new Date())} onChange={(e) => setSentAt(e.target.value)} required />
            </label>
          </div>
        </fieldset>
      )}
      {send.isError && <p role="alert" className="m-0 text-[15px] text-terracota">{message(send.error)}</p>}
      <div className="flex flex-wrap gap-2">
        {emailOn && <button type="submit" className="btn-sec bg-branco" disabled={send.isPending || missing || !email.trim()}>{send.isPending ? t("Mandando…", "Sending…") : t("Mandar por e-mail", "Send by e-mail")}</button>}
        {outside
          ? <button type="button" className="btn-sec bg-branco" disabled={send.isPending || missing} onClick={() => send.mutate("copiado")}>{t("Registrar o envio", "Record that it was sent")}</button>
          : <button type="button" className="btn-sec bg-branco" disabled={missing} onClick={() => void copy()}>{t("Copiar e mandar por fora", "Copy and send it yourself")}</button>}
        <button type="button" className="btn-sec" onClick={cancel}>{t("Cancelar", "Cancel")}</button>
      </div>
    </form>
  );
}

/** What was missing from the last package, for the part's row; `null` when it came complete. */
export function summaryPackage(p: { carimbo: string | null; fora: number }): Summary | null {
  const missing = [
    ...(p.carimbo ? [] : [t("baixado sem carimbo de tempo", "downloaded without a timestamp")]),
    ...(p.fora > 0 ? [t(p.fora === 1 ? "1 arquivo fora" : `${p.fora} arquivos fora`, p.fora === 1 ? "1 file left out" : `${p.fora} files left out`)] : []),
  ];
  return missing.length ? { tom: "aviso", texto: missing.join(" · ") } : null;
}

/** Defence package: downloads the zip and says whether it came with a timestamp (or why not). */
export function PackageDefense({ tenantId, textoId: textId, editor, avisar: warn }: { tenantId: string; textoId: string; editor: boolean; avisar?: (r: Summary | null) => void }) {
  const [done, setDone] = useState<{ carimbo: string | null; erro: string | null; nome: string; fora: number } | null>(null);
  const download = useMutation({
    mutationFn: async () => {
      let res: Response;
      try {
        res = await fetch(`/api/t/${encodeURIComponent(tenantId)}/textos/${encodeURIComponent(textId)}/pacote`, { headers: headerLanguage() });
      } catch {
        throw new ApiError(0, t("Sem conexão com o servidor.", "No connection to the server."));
      }
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { erro?: string; code?: string } | null;
        throw new ApiError(res.status, b?.erro ?? `Erro ${res.status}`, b?.code, b);
      }
      const name = res.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "pacote-defesa.zip";
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url; link.download = name;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      const c = res.headers.get("x-carimbo") ?? "";
      const error = res.headers.get("x-carimbo-erro");
      return { carimbo: c.startsWith("ok ") ? c.slice(3) : null, erro: error ? decodeURIComponent(error) : null, nome: name, fora: Number(res.headers.get("x-pacote-fora") ?? 0) };
    },
    onSuccess: (r) => { setDone(r); warn?.(summaryPackage(r)); },
  });
  return (
    <div className="grid gap-3">
      <p className="m-0 max-w-[60ch] text-[15px]">{t("Um zip com as versões do texto, o dossiê (com as cópias do Wayback), as decisões de cada frase, os pedidos de outro lado e as respostas, os posts aprovados e um manifesto com o hash de cada arquivo, carimbado com a hora de uma autoridade de carimbo de tempo. Serve para provar o que você sabia, e quando.",
        "A zip with the text's versions, the dossier (with the Wayback copies), the decisions on each sentence, the requests to the other side and the replies, the approved posts and a manifest with each file's hash, stamped with the time of a timestamp authority. It proves what you knew, and when.")}</p>
      {editor
        ? <button type="button" className="btn-sec justify-self-start bg-papel-2" onClick={() => download.mutate()} disabled={download.isPending}>{download.isPending ? t("Montando o pacote…", "Building the package…") : t("Baixar o pacote de defesa", "Download the defense package")}</button>
        : <p className="mono m-0 text-apoio">{t("só o editor baixa o pacote", "only the editor downloads the package")}</p>}
      {editor && <SheetLawyer tenantId={tenantId} textoId={textId} />}
      <div aria-live="polite" className="grid gap-2 empty:hidden">
        {download.isError && <p role="alert" className="faixa-erro m-0">{message(download.error)}</p>}
        {done && (done.carimbo
          ? <p role="status" className="m-0 text-[15px] text-verde">{t(`Pacote baixado (${done.nome}), com carimbo de tempo de ${new Date(done.carimbo).toLocaleString("pt-BR")}.`, `Package downloaded (${done.nome}), with a timestamp from ${new Date(done.carimbo).toLocaleString("en-US")}.`)}</p>
          : <p role="status" className="faixa-aviso m-0">{t(`Pacote baixado sem carimbo de tempo: ${done.erro ?? "a autoridade não respondeu"}. Baixe de novo mais tarde para ter a prova da hora.`, `Package downloaded without a timestamp: ${done.erro ?? "the authority didn't respond"}. Download it again later to get proof of the time.`)}</p>)}
        {done && done.fora > 0 && <p className="faixa-aviso m-0">{t(`${done.fora === 1 ? "1 arquivo ficou" : `${done.fora} arquivos ficaram`} fora do pacote (sumiu do armazenamento ou é grande demais). O LEIA-ME e o manifesto dizem quais, com o hash de cada um.`, `${done.fora === 1 ? "1 file was" : `${done.fora} files were`} left out of the package (missing from storage or too large). The README and the manifest list them, with each file's hash.`)}</p>}
      </div>
    </div>
  );
}

/** Sheet for the lawyer: only the risky sentences, as PDF. Text not yet checked: the message asks for the check. */
export function SheetLawyer({ tenantId, textoId: textId }: { tenantId: string; textoId: string }) {
  const download = useMutation({
    mutationFn: async () => {
      let res: Response;
      try {
        res = await fetch(`/api/t/${encodeURIComponent(tenantId)}/textos/${encodeURIComponent(textId)}/folha`, { headers: headerLanguage() });
      } catch {
        throw new ApiError(0, t("Sem conexão com o servidor.", "No connection to the server."));
      }
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { erro?: string; code?: string } | null;
        throw new ApiError(res.status, b?.erro ?? `Erro ${res.status}`, b?.code, b);
      }
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = res.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "folha-advogado.pdf";
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
  });
  return (
    <div className="grid gap-2">
      <button type="button" className="btn-sec justify-self-start bg-papel-2" onClick={() => download.mutate()} disabled={download.isPending}>{download.isPending ? t("Montando a folha…", "Building the sheet…") : t("Folha para o advogado", "Sheet for the lawyer")}</button>
      <p className="ajuda m-0 max-w-[60ch]">{t("Só as frases de risco, com a evidência e o outro lado, em poucas páginas. Nada é reescrito.", "Only the risky sentences, with the evidence and the other side, in a few pages. Nothing is rewritten.")}</p>
      {download.isError && <p role="alert" className="faixa-erro m-0">{message(download.error)}</p>}
      {download.isSuccess && <p role="status" className="m-0 text-[15px] text-verde">{t("Folha baixada.", "Sheet downloaded.")}</p>}
    </div>
  );
}

/** Public sources page: publish the checked version (the checklist gates it) or, when live, view and take it down. */
export function SourcesPage({ tenantId, textoId: textId, estado: state, editor, versao: version, garantirSalvo: savedEnsure, atualizar: update, abrirChecklist: openChecklist }: {
  tenantId: string; textoId: string; estado: DeskState; editor: boolean; versao: () => number; garantirSalvo: () => Promise<void>; atualizar: (d: DeskState) => void; abrirChecklist: () => void;
}) {
  const param = { tenantId, id: textId };
  // Publishes what is on screen: a pending save goes first (and, if it failed, publishing does not go out with the old version).
  const publish = useMutation({
    mutationFn: async () => { await savedEnsure(); return read(route["pagina-fontes"].$post({ param }, bodyJson({ versao: version() }))); },
    onSuccess: update,
    onError: (e) => { if (e instanceof ApiError && e.codigo === "checklist") openChecklist(); },
  });
  const remove = useMutation({ mutationFn: () => read(route["pagina-fontes"].$delete({ param })), onSuccess: update });
  const p = state.paginaFontes;
  if (!editor && !p) return null;
  return (
    <div className="grid gap-1">
      {p ? (
        <p className="mono m-0 text-apoio">
          {t(`página de fontes no ar (versão ${p.versao})`, `sources page live (version ${p.versao})`)} · <a href={p.url} target="_blank" rel="noreferrer" className="link-acao font-normal">{t("ver", "view")}</a>
          {editor && <> · <button type="button" className="link-acao border-0 bg-transparent p-0 font-normal" onClick={() => remove.mutate()} disabled={remove.isPending}>{t("tirar do ar", "take it down")}</button></>}
          {editor && state.texto.versao !== p.versao && <> · <button type="button" className="link-acao border-0 bg-transparent p-0 font-normal" onClick={() => publish.mutate()} disabled={publish.isPending}>{t("publicar a versão atual", "publish the current version")}</button></>}
        </p>
      ) : (
        <button type="button" className="btn-sec justify-self-start bg-papel-2" onClick={() => publish.mutate()} disabled={publish.isPending}>
          {publish.isPending ? t("Publicando…", "Publishing…") : t("Publicar a página de fontes", "Publish the sources page")}
        </button>
      )}
      {(publish.isError || remove.isError) && <p role="alert" className="faixa-erro m-0">{message(publish.error ?? remove.error)}</p>}
    </div>
  );
}
