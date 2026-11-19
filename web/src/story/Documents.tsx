// Ask the document (Phase 5): the dossier's PDFs, read per page; questions answered only when the citation checks out
// (page and literal passage, by code); the cited passage becomes evidence in one click; what the document contains
// (people, companies, CNPJs, amounts, dates) by code.
import { useState, type ChangeEvent, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { headerLanguage, bodyJson, ApiError, read } from "../api";
import { when } from "../queue";
import { t } from "../language";
import { message, qty, route, type DeskState, type Summary } from "./common";

type DocumentEntry = DeskState["documentos"][number];

export function summaryDocuments(e: DeskState, error: unknown): Summary {
  if (error) return { tom: "erro", texto: message(error) };
  const n = e.documentos.length;
  const failed = e.documentos.filter((d) => d.estado === "falhou").length;
  const total = n ? t(qty(n, "documento", "documentos"), qty(n, "document", "documents")) : t("nenhum documento", "no documents");
  if (failed) return { tom: "erro", texto: `${t(failed === 1 ? "1 não foi lido" : `${failed} não foram lidos`, failed === 1 ? "1 couldn't be read" : `${failed} couldn't be read`)} · ${total}` };
  const reading = e.documentos.filter((d) => d.estado === "lendo").length;
  return { texto: reading ? `${t(reading === 1 ? "1 sendo lido" : `${reading} sendo lidos`, `${reading} being read`)} · ${total}` : total };
}

/** Uploading stays outside the panel: an empty part offers "Upload PDF" on its own row. */
export function useSendPdf(tenantId: string, textId: string, update: (d: DeskState) => void) {
  return useMutation({
    mutationFn: async (file: File) => {
      let res: Response;
      try {
        res = await fetch(`/api/t/${encodeURIComponent(tenantId)}/textos/${encodeURIComponent(textId)}/documentos`, {
          method: "POST", headers: { "content-type": "application/pdf", "x-nome": encodeURIComponent(file.name), ...headerLanguage() }, body: file,
        });
      } catch {
        throw new ApiError(0, t("Sem conexão com o servidor.", "No connection to the server."));
      }
      const b = (await res.json().catch(() => null)) as (DeskState & { erro?: string; code?: string }) | null;
      if (!res.ok) throw new ApiError(res.status, b?.erro ?? `Erro ${res.status}`, b?.code, b);
      return b as DeskState;
    },
    onSuccess: update,
  });
}

export function ButtonPdf({ enviar: send }: { enviar: ReturnType<typeof useSendPdf> }) {
  function choose(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) send.mutate(f);
  }
  return (
    <label className="btn-sec flex-none justify-self-start bg-papel-2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-texto-forte">
      {send.isPending ? t("Enviando o PDF…", "Uploading the PDF…") : t("Enviar PDF", "Upload PDF")}
      <input type="file" accept="application/pdf,.pdf" className="sr-only" onChange={choose} disabled={send.isPending} />
    </label>
  );
}

export function Documents({ tenantId, textoId: textId, estado: state, editor, atualizar: update, enviar: send }: {
  tenantId: string; textoId: string; estado: DeskState; editor: boolean; atualizar: (d: DeskState) => void; enviar: ReturnType<typeof useSendPdf>;
}) {
  // While a PDF is being read (queued), the Story asks again every 2 s (screens/Desk.tsx).
  return (
    <div className="grid gap-3">
      {state.documentos.length ? (
        <ul className="m-0 grid list-none gap-3 p-0">
          {state.documentos.map((d) => <CardDocument key={d.id} d={d} tenantId={tenantId} textoId={textId} editor={editor} atualizar={update} />)}
        </ul>
      ) : <p className="m-0 text-apoio">{t("Nenhum documento ainda. Envie o PDF (relatório, contrato, processo) e pergunte a ele: a resposta só vem com a página e o trecho.", "No documents yet. Upload the PDF (report, contract, court record) and ask it questions: the answer only comes with the page and the passage.")}</p>}
      {editor && (
        <div className="grid gap-1">
          {state.documentos.length > 0 && <ButtonPdf enviar={send} />}
          <span className="ajuda">{t("Até 20 MB e 500 páginas. O texto de cada página é lido e guardado; PDF que é só imagem escaneada não tem texto para ler.", "Up to 20 MB and 500 pages. Each page's text is read and stored; a PDF that is only a scanned image has no text to read.")}</span>
        </div>
      )}
      {send.isError && <p role="alert" className="faixa-erro m-0">{message(send.error)}</p>}
    </div>
  );
}

function CardDocument({ d, tenantId, textoId: textId, editor, atualizar: update }: { d: DocumentEntry; tenantId: string; textoId: string; editor: boolean; atualizar: (e: DeskState) => void }) {
  const param = { tenantId, id: textId, arquivo: d.id };
  const [question, setQuestion] = useState("");
  const ask = useMutation({
    mutationFn: () => read(route.documentos[":arquivo"].perguntas.$post({ param }, bodyJson({ pergunta: question }))),
    onSuccess: (r) => { update(r.estado); setQuestion(""); },
  });
  const become = useMutation({
    mutationFn: (c: { pagina: number; trecho: string }) => read(route.documentos[":arquivo"].evidencia.$post({ param }, bodyJson(c))),
    onSuccess: update,
  });
  const urlPdf = `/api/t/${encodeURIComponent(tenantId)}/textos/${encodeURIComponent(textId)}/documentos/${encodeURIComponent(d.id)}/pdf`;
  const send = (e: FormEvent) => { e.preventDefault(); if (question.trim().length >= 3) ask.mutate(); };
  return (
    <li className="grid gap-2 rounded-card bg-branco px-3 py-3 shadow-curta">
      <span className="flex flex-wrap items-baseline gap-x-2">
        <b className="text-[15px] text-texto-forte">{d.nome}</b>
        <a href={urlPdf} target="_blank" rel="noreferrer" className="link-acao text-[14px] font-normal">{t("abrir o PDF", "open the PDF")}</a>
      </span>
      {d.estado === "lendo" && <span role="status" className="mono text-apoio">{t("lendo o PDF…", "reading the PDF…")}</span>}
      {d.estado === "falhou" && <p role="alert" className="faixa-erro m-0 text-[14px]">{t(`Não deu para ler: ${d.erro ?? "erro"}.`, `Couldn't read it: ${d.erro ?? "error"}.`)}</p>}
      {d.estado === "pronto" && (
        <>
          <span className="mono text-apoio">
            {d.paginas === 1 ? t("1 página", "1 page") : t(`${d.paginas} páginas`, `${d.paginas} pages`)} · {d.vetor === "indexado" ? t("busca por palavra e por sentido", "search by word and by meaning") : t("busca por palavra", "search by word")}
            {d.vetor === "falhou" && t(" (a busca por sentido falhou ao indexar)", " (search by meaning failed to index)")}
          </span>
          {editor && (
            <form onSubmit={send} className="grid gap-2">
              <label className="campo">
                <span>{t("Pergunte ao documento", "Ask the document")}</span>
                <input className="entrada bg-papel" value={question} maxLength={500} onChange={(e) => { setQuestion(e.target.value); ask.reset(); }} />
              </label>
              <button type="submit" className="btn-sec justify-self-start bg-papel-2" disabled={ask.isPending || question.trim().length < 3}>{ask.isPending ? t("Procurando…", "Searching…") : t("Perguntar", "Ask")}</button>
            </form>
          )}
          {ask.isError && <p role="alert" className="faixa-erro m-0">{message(ask.error)}</p>}
          {become.isError && <p role="alert" className="faixa-erro m-0">{message(become.error)}</p>}
          {d.perguntas.length > 0 && (
            <ul aria-label={t(`Perguntas a ${d.nome}`, `Questions to ${d.nome}`)} className="m-0 grid list-none gap-2 p-0">
              {d.perguntas.map((p) => (
                <li key={p.id} className="grid gap-1.5 border-t border-fio pt-2">
                  <b className="text-[15px] text-texto-forte">{p.pergunta}</b>
                  {p.encontrou ? (
                    <>
                      <p className="m-0 text-[15px]">{p.resposta}</p>
                      <span className="mono text-apoio">{t(`resposta do modelo, presa às citações abaixo (conferidas no documento) · ${when(p.em)}`, `model's answer, tied to the citations below (checked in the document) · ${when(p.em)}`)}</span>
                      {p.citacoes.map((c) => (
                        <div key={`${c.pagina}-${c.trecho}`} className="grid gap-1">
                          <p className="m-0 text-[15px] leading-[1.55]"><span className="mono mr-1.5 text-apoio">{t(`p. ${c.pagina}`, `p. ${c.pagina}`)}</span><mark className="bg-verde-claro px-0.5 text-texto-forte [box-decoration-break:clone]">{c.trecho}</mark></p>
                          {editor && (
                            <button type="button" className="link-acao justify-self-start border-0 bg-transparent p-0 text-[14px] font-normal" onClick={() => become.mutate(c)} disabled={become.isPending}>
                              {t("Usar como evidência", "Use as evidence")}<span className="sr-only">{t(` (página ${c.pagina})`, ` (page ${c.pagina})`)}</span>
                            </button>
                          )}
                        </div>
                      ))}
                    </>
                  ) : p.situacao === "falhou" ? (
                    <p className="faixa-erro m-0 text-[15px]">{t("O modelo não respondeu: a pergunta ficou sem resposta conferida. Pergunte de novo.", "The model didn't respond: the question has no checked answer. Ask again.")}</p>
                  ) : p.situacao === "invalida" ? (
                    <p className="faixa-aviso m-0 text-[15px]">
                      {t("A resposta do modelo não conferiu com o documento (citou o que não está nas páginas, ou veio fora do formato) e foi descartada. Pergunte de outro jeito.", "The model's answer didn't check against the document (it quoted what isn't on the pages, or came in the wrong format) and was discarded. Ask another way.")}
                      {p.descartadas > 0 && <span className="mono ml-1 text-apoio">{t(`(${p.descartadas} trecho(s) descartado(s))`, `(${p.descartadas} passage(s) discarded)`)}</span>}
                    </p>
                  ) : (
                    <p className="m-0 text-[15px]">
                      {t("Não encontrei no documento.", "I didn't find it in the document.")}
                      {p.descartadas > 0 && <span className="mono ml-1 text-apoio">{p.descartadas === 1 ? t("(1 trecho citado não estava na página: descartado)", "(1 cited passage wasn't on the page: discarded)") : t(`(${p.descartadas} trechos citados não estavam na página: descartados)`, `(${p.descartadas} cited passages weren't on the page: discarded)`)}</span>}
                    </p>
                  )}
                  {p.aviso && <span className="faixa-aviso py-1 text-[14px]">{t(`Busca incompleta: ${p.aviso}.`, `Incomplete search: ${p.aviso}.`)}</span>}
                </li>
              ))}
            </ul>
          )}
          {d.entidades && <Entities e={d.entidades} />}
        </>
      )}
    </li>
  );
}

function Entities({ e }: { e: NonNullable<DocumentEntry["entidades"]> }) {
  const groups: [string, { valor: string; paginas: number[] }[]][] = [
    [t("Pessoas e instituições", "People and institutions"), e.pessoas], [t("Empresas", "Companies"), e.empresas], ["CNPJ", e.cnpjs],
    [t("Valores", "Amounts"), e.valores], [t("Datas", "Dates"), e.datas],
  ];
  const full = groups.filter(([, l]) => l.length);
  if (!full.length) return null;
  return (
    <details className="text-[15px]">
      <summary className="link-acao w-fit cursor-pointer font-normal">{t("O que o documento traz", "What the document contains")}</summary>
      <dl className="mt-2 grid gap-2">
        {full.map(([label, list]) => (
          <div key={label} className="grid gap-0.5">
            <dt className="mono text-apoio">{label}</dt>
            <dd className="m-0">{list.map((x, i) => <span key={x.valor}>{i > 0 && " · "}{x.valor} <span className="mono text-apoio">p. {x.paginas.join(", ")}</span></span>)}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
