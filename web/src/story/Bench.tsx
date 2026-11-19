// The editor's bench (DESIGN.md §5): what helps writing and finishing, in parts that open one at a time
// (`?ferramenta=`). Interview quotes go into the text; the support block too, at the person's request. Promotion and
// second read only suggest: nothing from the model goes into the document. Versions shows the old text and restores it.
import { useState, type ReactNode } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { paragraphsDoc, type In } from "../../../src/lib/doc";
import { api, read } from "../api";
import { t } from "../language";
import { Part } from "../kit/Parts";
import { mmss } from "./Recordings";
import { message, qty, route, type DeskState } from "./common";

export type ToolId = "aspas" | "apoio" | "divulgar" | "leitura" | "versoes";
const withoutAccent = (x: string) => x.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const when = (s: string) => new Date(`${s.replace(" ", "T")}Z`).toLocaleString(t("pt-BR", "en"), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

type Props = {
  tenantId: string; textoId: string; estado: DeskState; aberta: string | null; abrir: (f: string | null) => void;
  inserirAspa: (text: string) => void; inserirApoio: (sponsorship: string, text: string) => void;
  irParaTrecho: (blockId: string, home: number, end: number) => void; garantirSalvo: () => Promise<void>;
  restaurar: (doc: unknown, title: string) => Promise<void>;
};

export default function Bench({ tenantId, textoId: textId, estado: state, aberta: isOpen, abrir: launch, inserirAspa: insertQuote, inserirApoio: insertSupport, irParaTrecho: goToPassage, garantirSalvo: savedEnsure, restaurar: restore }: Props) {
  const ready = state.gravacoes.filter((g) => g.estado === "pronto");
  const part = (id: ToolId, label: string, summary: string, content: ReactNode) => (
    <Part id={`ferramenta-${id}`} nivel="h2" rotulo={label} resumo={summary} aberta={isOpen === id} alternar={() => launch(isOpen === id ? null : id)}>{content}</Part>
  );
  return (
    <section aria-label={t("Bancada do texto", "Writing desk")} className="grid grid-cols-[minmax(0,1fr)]">
      {part("aspas", t("Aspas da entrevista", "Interview quotes"), ready.length ? t(qty(ready.length, "gravação", "gravações"), qty(ready.length, "recording", "recordings")) : "",
        <Quotes tenantId={tenantId} textoId={textId} prontas={ready} inserir={insertQuote} />)}
      {part("apoio", t("Apoio", "Sponsor"), "", <Support tenantId={tenantId} inserir={insertSupport} aberta={isOpen === "apoio"} />)}
      {part("divulgar", t("Divulgar", "Promote"), "", <Promote tenantId={tenantId} textoId={textId} garantirSalvo={savedEnsure} />)}
      {part("leitura", t("Segunda leitura", "Second read"), "", <Reading tenantId={tenantId} textoId={textId} garantirSalvo={savedEnsure} irParaTrecho={goToPassage} />)}
      {part("versoes", t("Versões", "Versions"), "", <Versions tenantId={tenantId} textoId={textId} aberta={isOpen === "versoes"} restaurar={restore} />)}
    </section>
  );
}

/** The transcript beside the text: clicking inserts the speech in quotes, and the check ties it to the minute. Selecting a piece inserts only that. */
function Quotes({ tenantId, textoId: textId, prontas: ready, inserir: insert }: { tenantId: string; textoId: string; prontas: DeskState["gravacoes"]; inserir: (text: string) => void }) {
  const [search, setSearch] = useState("");
  const queries = useQueries({
    queries: ready.map((g) => ({
      queryKey: [tenantId, "transcricao", g.id],
      staleTime: Infinity,
      queryFn: () => read(route.gravacoes[":arquivo"].transcricao.$get({ param: { tenantId, id: textId, arquivo: g.id } })),
    })),
  });
  if (!ready.length) return <p className="m-0 text-apoio">{t("Nenhuma gravação transcrita neste texto. Envie ou grave a entrevista no Dossiê, e a fala aparece aqui.", "No transcribed recording in this text. Upload or record the interview in the Dossier and the speech shows up here.")}</p>;
  const b = withoutAccent(search.trim());
  const passages = queries.flatMap((c, i) => (c.data?.trechos ?? []).map((tr) => ({ ...tr, nome: ready[i].nome, chave: `${ready[i].id}:${tr.inicio}` })))
    .filter((tr) => !b || withoutAccent(tr.texto).includes(b));
  return (
    <div className="grid gap-2">
      <label className="campo">
        <span>{t("Procurar na fala", "Search the speech")}</span>
        <input type="search" className="entrada bg-branco" value={search} onChange={(e) => setSearch(e.target.value)} />
      </label>
      {queries.some((c) => c.isPending) && <p role="status" className="mono m-0 text-apoio">{t("carregando…", "loading…")}</p>}
      {queries.some((c) => c.isError) && <p role="alert" className="faixa-erro m-0">{t("Uma transcrição não carregou.", "A transcript didn't load.")}</p>}
      <p className="ajuda m-0">{t("Selecione um pedaço da fala para inserir só ele.", "Select part of the speech to insert only that.")}</p>
      <ul className="m-0 grid list-none gap-2 p-0">
        {passages.map((tr) => (
          <li key={tr.chave} className="grid gap-1 border-t border-fio pt-2">
            <span className="mono text-apoio">{mmss(tr.inicio)} · {tr.nome}</span>
            <span className="text-[15px]">{tr.texto}</span>
            {/* The button does not take focus on press: the speech selection and the text cursor stay where they were. */}
            <button type="button" className="btn-sec justify-self-start bg-papel-2" onMouseDown={(e) => e.preventDefault()} onClick={(e) => {
              const s = window.getSelection();
              const chunk = s && !s.isCollapsed && e.currentTarget.closest("li")?.contains(s.anchorNode) ? s.toString().trim() : "";
              insert(chunk || tr.texto.trim());
            }}>{t("Inserir", "Insert")}<span className="sr-only"> {t("a fala de", "the speech at")} {mmss(tr.inicio)}</span></button>
          </li>
        ))}
      </ul>
      {b && !passages.length && <p className="m-0 text-apoio">{t("Nada com essas palavras na fala.", "Nothing with those words in the speech.")}</p>}
    </div>
  );
}

function Support({ tenantId, inserir: insert, aberta: isOpen }: { tenantId: string; inserir: (sponsorship: string, text: string) => void; aberta: boolean }) {
  const q = useQuery({ queryKey: [tenantId, "patrocinios"], enabled: isOpen, queryFn: () => read(api.t[":tenantId"].patrocinios.$get({ param: { tenantId } })) });
  if (q.isPending) return <p role="status" className="mono m-0 text-apoio">{t("carregando…", "loading…")}</p>;
  if (q.isError) return <p role="alert" className="faixa-erro m-0">{message(q.error)}</p>;
  const today = new Date().toISOString().slice(0, 10);
  const active = q.data.patrocinios.filter((p) => p.inicio <= today && today <= p.fim);
  if (!active.length) return <p className="m-0 text-apoio">{t("Nenhum patrocínio no período. Cadastre em Marca, na seção Patrocínios.", "No sponsorship running now. Add one in Brand, under Sponsorships.")}</p>;
  return (
    <ul className="m-0 grid list-none gap-2 p-0">
      {active.map((p) => (
        <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
          <b className="text-texto-forte">{p.nome}</b>
          <button type="button" className="btn-sec bg-papel-2" onMouseDown={(e) => e.preventDefault()}
            onClick={() => insert(p.id, t(`Publicidade. Esta edição tem o apoio de ${p.nome}.`, `Advertisement. This issue is supported by ${p.nome}.`))}>
            {t("Inserir no texto", "Insert in the text")}<span className="sr-only"> {p.nome}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Copy({ texto: text, rotulo: label }: { texto: string; rotulo: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" className="btn-sec bg-papel-2" onClick={() => { void navigator.clipboard.writeText(text).then(() => setCopied(true)); }}>{t("Copiar", "Copy")}<span className="sr-only"> {label}</span></button>
      {copied && <span role="status" className="mono text-verde">{t("copiado", "copied")}</span>}
    </span>
  );
}

function Promote({ tenantId, textoId: textId, garantirSalvo: savedEnsure }: { tenantId: string; textoId: string; garantirSalvo: () => Promise<void> }) {
  const request = useMutation({
    mutationFn: async () => { await savedEnsure(); return read(route.divulgacao.$post({ param: { tenantId, id: textId } })); },
  });
  const r = request.data;
  return (
    <div className="grid gap-3">
      <p className="ajuda m-0">{t("Sai só do que está no texto. Sugestão com número que não está nele é descartada, e nada entra na matéria.", "It comes only from what's in the text. Suggestions with a number that isn't there are dropped, and nothing goes into the story.")}</p>
      <button type="button" className="btn-sec justify-self-start bg-papel-2" disabled={request.isPending} onClick={() => request.mutate()}>{request.isPending ? t("Sugerindo…", "Suggesting…") : r ? t("Sugerir de novo", "Suggest again") : t("Sugerir", "Suggest")}</button>
      {request.isError && <p role="alert" className="faixa-erro m-0">{message(request.error)}</p>}
      {r && (r.assuntos.length ? (
        <ul aria-label={t("Assuntos do e-mail", "Email subjects")} className="m-0 grid list-none gap-2 p-0">
          {r.assuntos.map((a) => <li key={a} className="grid gap-1 border-t border-fio pt-2"><span className="text-[15px]">{a}</span><Copy texto={a} rotulo={a} /></li>)}
        </ul>
      ) : <p className="m-0 text-apoio">{t("Nenhum assunto passou na checagem. Tente de novo.", "No subject passed the check. Try again.")}</p>)}
      {r?.mensagem && (
        <div className="grid gap-1 border-t border-fio pt-2">
          <b className="text-[15px] text-texto-forte">{t("Mensagem para WhatsApp", "WhatsApp message")}</b>
          <p className="m-0 whitespace-pre-line text-[15px]">{r.mensagem}</p>
          <Copy texto={r.mensagem} rotulo={t("a mensagem", "the message")} />
        </div>
      )}
    </div>
  );
}

const NOTE_TYPE = (x: string) => ({ abertura: t("Abertura", "Opening"), pergunta: t("Pergunta sem resposta", "Unanswered question"), sobra: t("Sobra", "Could go"), clareza: t("Clareza", "Clarity") })[x] ?? x;

function Reading({ tenantId, textoId: textId, garantirSalvo: savedEnsure, irParaTrecho: goToPassage }: { tenantId: string; textoId: string; garantirSalvo: () => Promise<void>; irParaTrecho: Props["irParaTrecho"] }) {
  const read2 = useMutation({
    mutationFn: async () => { await savedEnsure(); return read(route["segunda-leitura"].$post({ param: { tenantId, id: textId } })); },
  });
  const notes = read2.data?.notas;
  return (
    <div className="grid gap-3">
      <p className="ajuda m-0">{t("Aponta o que travaria a leitura, sem reescrever nada. Fatos ficam com a conferência.", "It flags what would slow the reader, without rewriting anything. Facts stay with the check.")}</p>
      <button type="button" className="btn-sec justify-self-start bg-papel-2" disabled={read2.isPending} onClick={() => read2.mutate()}>{read2.isPending ? t("Lendo…", "Reading…") : notes ? t("Ler de novo", "Read again") : t("Pedir a leitura", "Ask for a read")}</button>
      {read2.isError && <p role="alert" className="faixa-erro m-0">{message(read2.error)}</p>}
      {notes && (notes.length ? (
        <ul className="m-0 grid list-none gap-2 p-0">
          {notes.map((n, i) => (
            <li key={i} className="grid gap-1 border-t border-fio pt-2">
              <b className="text-[15px] text-texto-forte">{NOTE_TYPE(n.tipo)}</b>
              <span className="text-[15px]">{n.nota}</span>
              <button type="button" className="link-acao justify-self-start border-0 bg-transparent p-0 text-left text-[15px]" onClick={() => goToPassage(n.blocoId, n.inicio, n.fim)}>“{n.trecho}”</button>
            </li>
          ))}
        </ul>
      ) : <p className="m-0 text-apoio">{t("Nada a apontar nesta leitura.", "Nothing to flag in this read.")}</p>)}
    </div>
  );
}

function Versions({ tenantId, textoId: textId, aberta: isOpen, restaurar: restore }: { tenantId: string; textoId: string; aberta: boolean; restaurar: Props["restaurar"] }) {
  const qc = useQueryClient();
  const param = { tenantId, id: textId };
  const key = [tenantId, "historico", textId];
  const list = useQuery({ queryKey: key, enabled: isOpen, queryFn: () => read(route.historico.$get({ param })) });
  const [seeing, setSeeing] = useState<string | null>(null);
  const snapshot = useQuery({ queryKey: [...key, seeing], enabled: !!seeing, queryFn: () => read(route.historico[":retrato"].$get({ param: { ...param, retrato: seeing! } })) });
  const back = useMutation({
    mutationFn: () => restore(snapshot.data!.doc, snapshot.data!.titulo),
    onSuccess: () => { setSeeing(null); void qc.invalidateQueries({ queryKey: key }); },
  });
  if (list.isPending) return <p role="status" className="mono m-0 text-apoio">{t("carregando…", "loading…")}</p>;
  if (list.isError) return <p role="alert" className="faixa-erro m-0">{message(list.error)}</p>;
  if (!list.data.versoes.length) return <p className="m-0 text-apoio">{t("Ainda não há versão anterior. Ao salvar, o texto guarda um ponto a cada 10 minutos.", "No earlier version yet. As you save, the text keeps a point every 10 minutes.")}</p>;
  return (
    <ul className="m-0 grid list-none gap-2 p-0">
      {list.data.versoes.map((v) => (
        <li key={v.id} className="grid gap-1 border-t border-fio pt-2">
          <span className="mono text-apoio">{t(`versão ${v.versao}`, `version ${v.versao}`)} · {when(v.em)}{v.por ? ` · ${v.por}` : ""}</span>
          <button type="button" className="link-acao justify-self-start border-0 bg-transparent p-0 text-left text-[15px]" aria-expanded={seeing === v.id} onClick={() => setSeeing(seeing === v.id ? null : v.id)}>{v.titulo}</button>
          {seeing === v.id && (
            <div className="grid gap-2">
              {snapshot.isPending && <p role="status" className="mono m-0 text-apoio">{t("carregando…", "loading…")}</p>}
              {snapshot.isError && <p role="alert" className="faixa-erro m-0">{message(snapshot.error)}</p>}
              {snapshot.data && (
                <>
                  {paragraphsDoc(snapshot.data.doc as unknown as In).map((p, i) => <p key={i} className="m-0 text-[15px]">{p}</p>)}
                  <p className="ajuda m-0">{t("O texto de agora fica guardado aqui e pode voltar.", "The current text stays saved here and can come back.")}</p>
                  {back.isError && <p role="alert" className="faixa-erro m-0">{message(back.error)}</p>}
                  <button type="button" className="btn-sec justify-self-start bg-papel-2" disabled={back.isPending} onClick={() => back.mutate()}>{back.isPending ? t("Restaurando…", "Restoring…") : t("Restaurar esta versão", "Restore this version")}</button>
                </>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
