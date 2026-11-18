// Pergunte ao documento (Fase 5): PDFs do dossiê, lidos por página; perguntas com resposta só quando a citação confere
// (página e trecho literal, por código); o trecho citado vira evidência num clique; o que o documento traz (pessoas,
// empresas, valores, datas) por código.
import { useState, type ChangeEvent, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { cabecalhoIdioma, corpoJson, ErroApi, ler } from "../api";
import { quando } from "../fila";
import { t } from "../idioma";
import { mensagem, qtd, rota, type EstadoMesa, type Resumo } from "./comum";

type Documento = EstadoMesa["documentos"][number];

export function resumoDocumentos(e: EstadoMesa, erro: unknown): Resumo {
  if (erro) return { tom: "erro", texto: mensagem(erro) };
  const n = e.documentos.length;
  const falhos = e.documentos.filter((d) => d.estado === "falhou").length;
  const total = n ? t(qtd(n, "documento", "documentos"), qtd(n, "document", "documents")) : t("nenhum documento", "no documents");
  if (falhos) return { tom: "erro", texto: `${t(falhos === 1 ? "1 não foi lido" : `${falhos} não foram lidos`, falhos === 1 ? "1 couldn't be read" : `${falhos} couldn't be read`)} · ${total}` };
  const lendo = e.documentos.filter((d) => d.estado === "lendo").length;
  return { texto: lendo ? `${t(lendo === 1 ? "1 sendo lido" : `${lendo} sendo lidos`, `${lendo} being read`)} · ${total}` : total };
}

/** O envio fica fora do painel: parte vazia oferece "Enviar PDF" na própria linha. */
export function useEnviarPdf(tenantId: string, textoId: string, atualizar: (d: EstadoMesa) => void) {
  return useMutation({
    mutationFn: async (arquivo: File) => {
      let res: Response;
      try {
        res = await fetch(`/api/t/${encodeURIComponent(tenantId)}/textos/${encodeURIComponent(textoId)}/documentos`, {
          method: "POST", headers: { "content-type": "application/pdf", "x-nome": encodeURIComponent(arquivo.name), ...cabecalhoIdioma() }, body: arquivo,
        });
      } catch {
        throw new ErroApi(0, t("Sem conexão com o servidor.", "No connection to the server."));
      }
      const b = (await res.json().catch(() => null)) as (EstadoMesa & { erro?: string; code?: string }) | null;
      if (!res.ok) throw new ErroApi(res.status, b?.erro ?? `Erro ${res.status}`, b?.code, b);
      return b as EstadoMesa;
    },
    onSuccess: atualizar,
  });
}

export function BotaoPdf({ enviar }: { enviar: ReturnType<typeof useEnviarPdf> }) {
  function escolher(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) enviar.mutate(f);
  }
  return (
    <label className="btn-sec flex-none justify-self-start bg-papel-2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-texto-forte">
      {enviar.isPending ? t("Enviando o PDF…", "Uploading the PDF…") : t("Enviar PDF", "Upload PDF")}
      <input type="file" accept="application/pdf,.pdf" className="sr-only" onChange={escolher} disabled={enviar.isPending} />
    </label>
  );
}

export function Documentos({ tenantId, textoId, estado, editor, atualizar, enviar }: {
  tenantId: string; textoId: string; estado: EstadoMesa; editor: boolean; atualizar: (d: EstadoMesa) => void; enviar: ReturnType<typeof useEnviarPdf>;
}) {
  // Enquanto um PDF está sendo lido (na fila), a Matéria pergunta de novo a cada 2 s (telas/Mesa.tsx).
  return (
    <div className="grid gap-3">
      {estado.documentos.length ? (
        <ul className="m-0 grid list-none gap-3 p-0">
          {estado.documentos.map((d) => <CartaoDocumento key={d.id} d={d} tenantId={tenantId} textoId={textoId} editor={editor} atualizar={atualizar} />)}
        </ul>
      ) : <p className="m-0 text-apoio">{t("Nenhum documento ainda. Envie o PDF (relatório, contrato, processo) e pergunte a ele: a resposta só vem com a página e o trecho.", "No documents yet. Upload the PDF (report, contract, court record) and ask it questions: the answer only comes with the page and the passage.")}</p>}
      {editor && (
        <div className="grid gap-1">
          {estado.documentos.length > 0 && <BotaoPdf enviar={enviar} />}
          <span className="ajuda">{t("Até 20 MB e 500 páginas. O texto de cada página é lido e guardado; PDF que é só imagem escaneada não tem texto para ler.", "Up to 20 MB and 500 pages. Each page's text is read and stored; a PDF that is only a scanned image has no text to read.")}</span>
        </div>
      )}
      {enviar.isError && <p role="alert" className="faixa-erro m-0">{mensagem(enviar.error)}</p>}
    </div>
  );
}

function CartaoDocumento({ d, tenantId, textoId, editor, atualizar }: { d: Documento; tenantId: string; textoId: string; editor: boolean; atualizar: (e: EstadoMesa) => void }) {
  const param = { tenantId, id: textoId, arquivo: d.id };
  const [pergunta, setPergunta] = useState("");
  const perguntar = useMutation({
    mutationFn: () => ler(rota.documentos[":arquivo"].perguntas.$post({ param }, corpoJson({ pergunta }))),
    onSuccess: (r) => { atualizar(r.estado); setPergunta(""); },
  });
  const virar = useMutation({
    mutationFn: (c: { pagina: number; trecho: string }) => ler(rota.documentos[":arquivo"].evidencia.$post({ param }, corpoJson(c))),
    onSuccess: atualizar,
  });
  const urlPdf = `/api/t/${encodeURIComponent(tenantId)}/textos/${encodeURIComponent(textoId)}/documentos/${encodeURIComponent(d.id)}/pdf`;
  const enviar = (e: FormEvent) => { e.preventDefault(); if (pergunta.trim().length >= 3) perguntar.mutate(); };
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
            <form onSubmit={enviar} className="grid gap-2">
              <label className="campo">
                <span>{t("Pergunte ao documento", "Ask the document")}</span>
                <input className="entrada bg-papel" value={pergunta} maxLength={500} onChange={(e) => { setPergunta(e.target.value); perguntar.reset(); }} />
              </label>
              <button type="submit" className="btn-sec justify-self-start bg-papel-2" disabled={perguntar.isPending || pergunta.trim().length < 3}>{perguntar.isPending ? t("Procurando…", "Searching…") : t("Perguntar", "Ask")}</button>
            </form>
          )}
          {perguntar.isError && <p role="alert" className="faixa-erro m-0">{mensagem(perguntar.error)}</p>}
          {virar.isError && <p role="alert" className="faixa-erro m-0">{mensagem(virar.error)}</p>}
          {d.perguntas.length > 0 && (
            <ul aria-label={t(`Perguntas a ${d.nome}`, `Questions to ${d.nome}`)} className="m-0 grid list-none gap-2 p-0">
              {d.perguntas.map((p) => (
                <li key={p.id} className="grid gap-1.5 border-t border-fio pt-2">
                  <b className="text-[15px] text-texto-forte">{p.pergunta}</b>
                  {p.encontrou ? (
                    <>
                      <p className="m-0 text-[15px]">{p.resposta}</p>
                      <span className="mono text-apoio">{t(`resposta do modelo, presa às citações abaixo (conferidas no documento) · ${quando(p.em)}`, `model's answer, tied to the citations below (checked in the document) · ${quando(p.em)}`)}</span>
                      {p.citacoes.map((c) => (
                        <div key={`${c.pagina}-${c.trecho}`} className="grid gap-1">
                          <p className="m-0 text-[15px] leading-[1.55]"><span className="mono mr-1.5 text-apoio">{t(`p. ${c.pagina}`, `p. ${c.pagina}`)}</span><mark className="bg-verde-claro px-0.5 text-texto-forte [box-decoration-break:clone]">{c.trecho}</mark></p>
                          {editor && (
                            <button type="button" className="link-acao justify-self-start border-0 bg-transparent p-0 text-[14px] font-normal" onClick={() => virar.mutate(c)} disabled={virar.isPending}>
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
          {d.entidades && <Entidades e={d.entidades} />}
        </>
      )}
    </li>
  );
}

function Entidades({ e }: { e: NonNullable<Documento["entidades"]> }) {
  const grupos: [string, { valor: string; paginas: number[] }[]][] = [
    [t("Pessoas e instituições", "People and institutions"), e.pessoas], [t("Empresas", "Companies"), e.empresas],
    [t("Valores", "Amounts"), e.valores], [t("Datas", "Dates"), e.datas],
  ];
  const cheios = grupos.filter(([, l]) => l.length);
  if (!cheios.length) return null;
  return (
    <details className="text-[15px]">
      <summary className="link-acao w-fit cursor-pointer font-normal">{t("O que o documento traz", "What the document contains")}</summary>
      <dl className="mt-2 grid gap-2">
        {cheios.map(([rotulo, lista]) => (
          <div key={rotulo} className="grid gap-0.5">
            <dt className="mono text-apoio">{rotulo}</dt>
            <dd className="m-0">{lista.map((x, i) => <span key={x.valor}>{i > 0 && " · "}{x.valor} <span className="mono text-apoio">p. {x.paginas.join(", ")}</span></span>)}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
