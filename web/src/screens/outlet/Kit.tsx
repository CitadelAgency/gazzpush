// The "If the account goes down" tab, used in a crisis: the order follows the case. Without an open case, how to report
// it and the summary of the rest; with an open case, the deadline and the next step at the top, always in view.
// Templates, certificates, backup and X-ray open on demand.
import { useState } from "react";
import { useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { bodyJson, read } from "../../api";
import { FailureLoad } from "../../common";
import { Part, Parts, usePart, type ItemPart } from "../../kit/Parts";
import { when } from "../../queue";
import { language, t as tr } from "../../language";
import type { Outlet as Veic } from "../../session";
import { NOTE_CASE_MAX, CASE_TYPES, untilDays, modelsKit, scriptKit, type KitModel, type CaseType } from "../../../../src/lib/kit";
import { Load, actionMessage, t } from "./common";
import { RayX, useRayX } from "./XRay";

const CASE_NAME = (x: CaseType) => ({
  desativada: tr("Conta desativada ou restringida", "Account disabled or restricted"),
  direito_autoral: tr("Denúncia de direito autoral", "Copyright report"),
  cobranca: tr("Cobrança por foto ou texto", "Charge for a photo or text"),
  outro: tr("Outro", "Other"),
})[x];

const todayLocal = () => new Date().toLocaleDateString("en-CA");
const shortDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(language(), { day: "2-digit", month: "short", year: "numeric" });

function count(deadline: string | null) {
  if (!deadline) return tr("sem prazo no aviso", "no deadline in the notice");
  const d = untilDays(deadline, todayLocal());
  if (d < 0) return tr(`o prazo passou há ${-d} ${-d === 1 ? "dia" : "dias"}`, `the deadline passed ${-d} ${-d === 1 ? "day" : "days"} ago`);
  if (d === 0) return tr("o prazo termina hoje", "the deadline is today");
  return tr(`${d === 1 ? "falta 1 dia" : `faltam ${d} dias`} para o prazo`, `${d === 1 ? "1 day" : `${d} days`} left until the deadline`);
}

/** The case's next step: what resolves it first, with the path to the ready text. */
const nextStep = (type: CaseType): { texto: string; acao: string; parte: string; modelo?: string } => (type === "cobranca"
  ? { texto: tr("Peça a prova de quem cobra: de quem é o direito, qual é o post e de onde vem o valor.", "Ask whoever is charging for proof: who owns the rights, which post it is and where the amount comes from."), acao: tr("Abrir o pedido", "Open the request"), parte: "modelos", modelo: "titularidade" }
  : type === "outro"
    ? { texto: tr("Guarde o aviso com a data e junte as certidões do mês.", "Save the notice with its date and gather this month's certificates."), acao: tr("Abrir as certidões", "Open the certificates"), parte: "certidoes" }
    : { texto: tr("Peça a revisão pelo link do próprio aviso. O texto está pronto para copiar.", "Ask for a review through the link in the notice. The text is ready to copy."), acao: tr("Abrir o pedido", "Open the request"), parte: "modelos", modelo: "revisao" });

/** Closed, only the name and Copy. If the browser does not allow copying, the text opens for the person to select. */
function Model({ m, aberto: isOpen, alternar: toggle }: { m: KitModel; aberto: boolean; alternar: () => void }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const copy = () => navigator.clipboard.writeText(m.texto).then(() => setCopied(true), () => { setCopied(false); if (!isOpen) toggle(); });
  return (
    <li>
      <Part id={`kit-${m.id}`} rotulo={m.titulo} resumo={null} aberta={isOpen} alternar={toggle}
        acao={<button type="button" className="btn-sec flex-none bg-papel-2" onClick={() => void copy()}>{tr("Copiar", "Copy")}<span className="sr-only"> {m.titulo}</span></button>}>
        <textarea readOnly aria-label={m.titulo} className="entrada min-h-[160px] resize-y py-2 text-[15px]" value={m.texto} />
      </Part>
      <p role="status" className={copied === null ? "sr-only" : "ajuda m-0 pb-3"}>{copied === true ? tr("Copiado.", "Copied.") : copied === false ? tr("O navegador não deixou copiar: selecione o texto.", "The browser didn't allow copying: select the text.") : ""}</p>
    </li>
  );
}

const plural = (n: number, one: string, several: string) => (n === 1 ? one : several);

export default function Kit({ veiculo: outlet, admin }: { veiculo: Veic; admin: boolean }) {
  const qc = useQueryClient();
  const key = [outlet.id, "kit"] as const;
  const data = useQuery({ queryKey: key, queryFn: () => read(t.kit.$get({ param: { tenantId: outlet.id } })) });
  const reload = () => qc.invalidateQueries({ queryKey: key });
  const [type, setType] = useState<CaseType>("desativada");
  const [openAt, setOpenAt] = useState(todayLocal());
  const [deadlineAt, setDeadlineAt] = useState("");
  const [note, setNote] = useState("");
  const open = useMutation({
    mutationFn: () => read(t.kit.casos.$post({ param: { tenantId: outlet.id } }, bodyJson({ tipo: type, abertoEm: openAt, prazoEm: deadlineAt || null, nota: note.trim() || null }))),
    onSuccess: () => { setDeadlineAt(""); setNote(""); reload(); },
  });
  const close = useMutation({
    mutationFn: (id: string) => read(t.kit.casos[":id"].$delete({ param: { tenantId: outlet.id, id } })),
    onSuccess: reload,
  });
  const page = useMutation({
    mutationFn: (on: boolean) => read(t["pagina-publica"].$patch({ param: { tenantId: outlet.id } }, bodyJson({ ligada: on }))),
    onSuccess: reload,
  });
  const reporter = outlet.papel === "reporter";
  const xray = useRayX(outlet.id, !reporter);
  const [rayXError, setErrorRayX] = useState<string | null>(null);
  const [openTextId, openText] = usePart("texto", null);
  const [, setParams] = useSearchParams();
  const goTo = (part: string, model?: string) => setParams((p) => { p.set("parte", part); if (model) p.set("texto", model); return p; }, { replace: true, preventScrollReset: true });
  const ling = language();
  // The X-ray counts among what opens by itself: wait for its first answer. Only the first: after a failure, the panel
  // retries on mount, the query goes back to "pending", and waiting again unmounted the panel, in an endless loop.
  const rayXFailed = xray.errorUpdatedAt > 0 && !xray.data;
  if (data.isPending || (!reporter && xray.isPending && !rayXFailed)) return <Load oque={tr("o kit", "the kit")} />;
  if (data.isError) return <FailureLoad oque={tr("o kit", "the kit")} tentar={() => data.refetch()} />;
  const { casos: cases, certidoes: certificates, paginaPublica: publicPage } = data.data;
  // The shortest deadline first; a case with no deadline in the notice comes after.
  const inOrder = [...cases].sort((a, b) => (a.prazo_em ?? "9999").localeCompare(b.prazo_em ?? "9999"));
  const steps = scriptKit(ling);
  const models = modelsKit(ling);
  const failures = certificates.filter((c) => c.erro).length;
  const batch = xray.data?.lote;

  const itemCase: ItemPart | null = reporter ? null : {
    id: "caso",
    rotulo: cases.length ? tr("Registrar outro caso", "Register another case") : tr("Registrar o caso", "Register the case"),
    resumo: cases.length ? tr(`${cases.length} ${plural(cases.length, "aberto", "abertos")}`, `${cases.length} open`) : tr("nenhum caso aberto", "no open case"),
    conteudo: (
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); open.mutate(); }}>
        <label className="campo">
          <span>{tr("O que aconteceu", "What happened")}</span>
          <select className="entrada" value={type} onChange={(e) => setType(e.target.value as CaseType)}>
            {CASE_TYPES.map((x) => <option key={x} value={x}>{CASE_NAME(x)}</option>)}
          </select>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="campo">
            <span>{tr("Quando a conta caiu", "When the account went down")}</span>
            <input type="date" required className="entrada" value={openAt} max={todayLocal()} onChange={(e) => setOpenAt(e.target.value)} />
          </label>
          <label className="campo">
            <span>{tr("Prazo do aviso", "Deadline in the notice")}</span>
            <input type="date" className="entrada" value={deadlineAt} onChange={(e) => setDeadlineAt(e.target.value)} aria-describedby="kit-prazo-ajuda" />
          </label>
        </div>
        <p id="kit-prazo-ajuda" className="ajuda m-0">{tr("Copie a data do aviso que você recebeu. O prazo muda de caso para caso, e o app não adivinha.", "Copy the date from the notice you received. The deadline changes from case to case, and the app doesn't guess.")}</p>
        <label className="campo">
          <span>{tr("Nota", "Note")}</span>
          <input className="entrada" maxLength={NOTE_CASE_MAX} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {open.isError && <p role="alert" className="faixa-erro m-0">{actionMessage(open.error, tr("registrar o caso", "register the case"))}</p>}
        <button type="submit" className="btn-sec justify-self-start bg-papel-2" disabled={open.isPending}>{open.isPending ? tr("Registrando…", "Registering…") : tr("Registrar o caso", "Register the case")}</button>
      </form>
    ),
  };
  const itemNow: ItemPart = {
    id: "agora", rotulo: tr("O que fazer agora", "What to do now"), resumo: tr(`${steps.length} passos`, `${steps.length} steps`),
    conteudo: (
      <ol className="m-0 grid list-decimal gap-3 pl-5">
        {steps.map((p) => <li key={p.titulo}><b className="text-texto-forte">{p.titulo}.</b> <span className="text-apoio">{p.texto}</span></li>)}
      </ol>
    ),
  };
  const itemModels: ItemPart = {
    id: "modelos", rotulo: tr("Modelos para copiar", "Templates to copy"), resumo: tr(`${models.length} modelos`, `${models.length} templates`),
    conteudo: <ul className="m-0 grid list-none divide-y divide-fio p-0">{models.map((m) => <Model key={m.id} m={m} aberto={openTextId === m.id} alternar={() => openText(openTextId === m.id ? null : m.id)} />)}</ul>,
  };
  const itemCertificates: ItemPart = {
    id: "certidoes", rotulo: tr("Certidões do mês", "This month's certificates"),
    resumo: failures ? tr(`${failures} ${plural(failures, "falhou", "falharam")}: gere de novo em Postados`, `${failures} failed: generate again in Posted`)
      : certificates.length ? tr(`${certificates.length} neste mês`, `${certificates.length} this month`) : tr("nenhuma neste mês", "none this month"),
    tom: failures ? "erro" : undefined,
    conteudo: (
      <>
        {certificates.length ? (
          <ul className="m-0 grid list-none gap-2 p-0">
            {certificates.map((c) => (
              <li key={c.peca_id} className="flex flex-wrap items-center justify-between gap-3 border-t border-fio py-2">
                <span className="grid min-w-0 gap-0.5">
                  <span className="text-texto-forte">{c.manchete ?? c.peca_id}</span>
                  <span className="mono text-apoio">{c.erro ? tr("falhou: gere de novo em Postados", "failed: generate it again in Posted") : c.carimbo_em ? when(c.carimbo_em) : ""}</span>
                </span>
                {!c.erro && !reporter && <a className="btn-sec no-underline" href={`/api/t/${outlet.id}/pecas/${c.peca_id}/certidao`} download>{tr("Baixar", "Download")}<span className="sr-only"> {c.manchete}</span></a>}
              </li>
            ))}
          </ul>
        ) : <p className="m-0 text-apoio">{tr("Nenhuma certidão neste mês. Cada post publicado ganha uma, sozinho.", "No certificates this month. Each published post gets one on its own.")}</p>}
        {!reporter && <a className="btn-sec justify-self-start no-underline" href={`/api/t/${outlet.id}/kit/mes`} download>{tr("Baixar o mês", "Download the month")}</a>}
      </>
    ),
  };
  const itemReserve: ItemPart = {
    id: "reserva", rotulo: tr("Reserva", "Reserve"),
    resumo: publicPage.ligada ? tr("página pública ligada", "public page on") : tr("página pública desligada", "public page off"),
    conteudo: (
      <>
        <p className="m-0 max-w-[60ch] text-apoio">{tr("Canal de WhatsApp: em Prontos para postar, cada post tem \"Mandar para o Canal\".", "WhatsApp Channel: in Ready to post, each post has \"Send to the Channel\".")}</p>
        <label className={`flex min-h-11 items-center gap-2 ${admin ? "cursor-pointer" : ""}`}>
          <input type="checkbox" checked={publicPage.ligada} disabled={!admin || page.isPending} onChange={(e) => page.mutate(e.target.checked)} className="size-[18px] accent-texto-forte" />
          <span className="grid"><b className="text-texto-forte">{tr("Página pública do veículo", "Public outlet page")}</b><span className="ajuda">{tr("Mostra os últimos posts publicados, sem login.", "Shows the latest published posts, with no login.")}</span></span>
        </label>
        {publicPage.ligada && <a className="mono break-all text-apoio" href={publicPage.url} target="_blank" rel="noopener noreferrer">{publicPage.url}<span className="sr-only">{tr(" (abre em outra aba)", " (opens in a new tab)")}</span></a>}
        {page.isError && <p role="alert" className="faixa-erro m-0">{actionMessage(page.error, tr("mudar a página", "change the page"))}</p>}
      </>
    ),
  };
  const itemRayX: ItemPart | null = reporter ? null : {
    id: "raiox", rotulo: tr("Raio-X dos posts antigos", "Review of old posts"),
    resumo: rayXError ?? (rayXFailed ? tr("não carregou", "didn't load") : batch
      ? tr(`${batch.total} posts · ${batch.marcados} com marca`, `${batch.total} posts · ${batch.marcados} flagged`)
      : tr("ainda não feito", "not done yet")),
    tom: rayXError || rayXFailed ? "erro" : batch?.marcados ? "aviso" : undefined,
    conteudo: <RayX tenantId={outlet.id} avisar={setErrorRayX} />,
  };
  // The order follows the case: without a case, reporting comes first; with an open case, what helps resolve it. An alert moves ahead and opens by itself.
  const items = (cases.length ? [itemModels, itemCertificates, itemNow, itemReserve, itemRayX, itemCase] : [itemCase, itemNow, itemModels, itemCertificates, itemReserve, itemRayX])
    .filter((i): i is ItemPart => i !== null)
    .sort((a, b) => Number(!a.tom) - Number(!b.tom));
  return (
    <div className="grid gap-6">
      {inOrder.length > 0 && (
        <section aria-labelledby="kit-caso" className="grid max-w-[760px] gap-3">
          <h2 id="kit-caso" className="m-0 text-[22px]">{tr("Caso aberto", "Open case")}</h2>
          <ul aria-label={tr("Casos abertos", "Open cases")} className="m-0 grid list-none gap-2 p-0">
            {inOrder.map((c) => {
              const step = nextStep(c.tipo as CaseType);
              const passed = !!c.prazo_em && untilDays(c.prazo_em, todayLocal()) < 0;
              return (
                <li key={c.id} className="grid gap-2 rounded-btn bg-papel p-3 shadow-curta">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <span className="grid min-w-0 gap-0.5">
                      <b className={`text-[18px] first-letter:uppercase ${passed ? "text-terracota" : "text-texto-forte"}`}>{count(c.prazo_em)}</b>
                      <span className="text-texto-forte">{CASE_NAME(c.tipo as CaseType)}</span>
                      <span className="mono text-apoio">{tr(`caiu em ${shortDate(c.aberto_em)}`, `went down on ${shortDate(c.aberto_em)}`)}</span>
                      {c.nota && <span className="text-apoio">{c.nota}</span>}
                    </span>
                    {!reporter && <button type="button" className="btn-sec" disabled={close.isPending} onClick={() => close.mutate(c.id)}>{tr("Encerrar", "Close")}<span className="sr-only"> {CASE_NAME(c.tipo as CaseType)}</span></button>}
                  </div>
                  <p className="m-0 border-t border-fio pt-2"><b className="text-texto-forte">{tr("Próximo passo: ", "Next step: ")}</b>{step.texto}{" "}
                    <button type="button" className="link-acao border-0 bg-transparent p-0 font-[inherit]" onClick={() => goTo(step.parte, step.modelo)}>{step.acao}</button>
                  </p>
                </li>
              );
            })}
          </ul>
          {close.isError && <p role="alert" className="faixa-erro m-0">{actionMessage(close.error, tr("encerrar o caso", "close the case"))}</p>}
        </section>
      )}
      <Parts itens={items} padrao={items[0]?.id ?? null} rotulo={tr("Partes do kit", "Parts of the kit")} />
    </div>
  );
}
