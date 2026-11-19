// Parts of the Texts screen that load only when opened: the outlet's style guide (rules that only point things out) and
// the audit panel (marks per month, topic and person mentioned, and the ignored ones), to see whether the check leans
// more to one side. Tables, not charts: the exact numbers matter more than the shape.
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, bodyJson, ApiError, read } from "../api";
import { FailureLoad } from "../common";
import { when } from "../queue";
import { language, locale, t } from "../language";

const route = api.t[":tenantId"].textos;
const TYPES: [string, () => string][] = [
  ["grafia", () => t("Grafia", "Spelling")], ["sigla", () => t("Sigla", "Acronym")], ["numero", () => t("Número", "Number")],
  ["cargo", () => t("Cargo", "Title")], ["linguagem", () => t("Linguagem", "Language")],
];
const typeLabel = (k: string) => TYPES.find(([x]) => x === k)?.[1]() ?? k;
const message = (e: unknown) => (e instanceof ApiError ? e.message : t("Não deu certo agora. Tente de novo.", "That didn't work right now. Try again."));

export function Manual({ tenantId, podeEditar: canEdit }: { tenantId: string; podeEditar: boolean }) {
  const qc = useQueryClient();
  const key = [tenantId, "manual"];
  const q = useQuery({ queryKey: key, queryFn: () => read(route.manual.$get({ param: { tenantId } })) });
  const [type, setType] = useState("grafia");
  const [search, setSearch] = useState("");
  const [prefer, setPrefer] = useState("");
  const [note, setNote] = useState("");
  const create = useMutation({
    mutationFn: () => read(route.manual.$post({ param: { tenantId } }, bodyJson({ tipo: type, procurar: search, preferir: prefer, nota: note }))),
    onSuccess: (d) => { qc.setQueryData(key, { regras: d.regras }); setSearch(""); setPrefer(""); setNote(""); },
  });
  const remove = useMutation({
    mutationFn: (rule: string) => read(route.manual[":regra"].$delete({ param: { tenantId, regra: rule } })),
    onSuccess: (d) => qc.setQueryData(key, d),
  });
  function send(e: FormEvent) {
    e.preventDefault();
    if (search.trim()) create.mutate();
  }
  return (
    <section aria-labelledby="manual-t" className="mt-8 grid gap-4">
      <h2 id="manual-t" className="m-0 text-[22px]">{t("Manual de redação", "Style guide")}</h2>
      <p className="m-0 max-w-[60ch]">{t("Regras mecânicas do veículo (grafia, sigla, número, cargo, linguagem). No editor, elas só apontam onde o texto usa a forma a evitar; a mudança é sempre sua. A mesma regra vale para qualquer pessoa citada.",
        "The outlet's mechanical rules (spelling, acronyms, numbers, titles, language). In the editor they only point to where the text uses the form to avoid; the change is always yours. The same rule applies to anyone quoted.")}</p>
      {q.isPending ? <div className="esqueleto h-20" /> : q.isError ? <FailureLoad oque={t("o manual", "the style guide")} tentar={() => q.refetch()} /> : q.data.regras.length ? (
        <ul className="m-0 grid list-none gap-2 p-0">
          {q.data.regras.map((r) => (
            <li key={r.id} className="grid gap-1 rounded-card bg-branco px-4 py-3 shadow-curta">
              <span className="text-[16px]"><s className="decoration-terracota">{r.procurar}</s>{r.preferir ? <> → <b className="text-texto-forte">{r.preferir}</b></> : null}</span>
              <span className="mono text-apoio">{typeLabel(r.tipo)}{r.nota ? ` · ${r.nota}` : ""}</span>
              {canEdit && <button type="button" className="link-acao justify-self-start border-0 bg-transparent p-0 text-[14px] font-normal" onClick={() => remove.mutate(r.id)} disabled={remove.isPending}
                aria-label={t(`Tirar a regra: ${r.procurar}`, `Remove the rule: ${r.procurar}`)}>{t("Tirar", "Remove")}</button>}
            </li>
          ))}
        </ul>
      ) : <p className="m-0 text-apoio">{t("Nenhuma regra ainda.", "No rules yet.")}</p>}
      {remove.isError && <p role="alert" className="faixa-erro m-0">{message(remove.error)}</p>}
      {canEdit && (
        <form onSubmit={send} noValidate className="grid gap-3 rounded-card bg-papel-2/60 p-4">
          <h3 className="m-0 text-[17px]">{t("Nova regra", "New rule")}</h3>
          <div className="grid gap-3 sm:grid-cols-[160px_1fr_1fr]">
            <label className="campo">
              <span>{t("Tipo", "Type")}</span>
              <select className="entrada bg-branco" value={type} onChange={(e) => setType(e.target.value)}>{TYPES.map(([k, r]) => <option key={k} value={k}>{r()}</option>)}</select>
            </label>
            <label className="campo">
              <span>{t("Evitar", "Avoid")}</span>
              <input className="entrada bg-branco" value={search} maxLength={80} onChange={(e) => { setSearch(e.target.value); create.reset(); }} required />
            </label>
            <label className="campo">
              <span>{t("O manual pede", "The guide asks for")}</span>
              <input className="entrada bg-branco" value={prefer} maxLength={80} onChange={(e) => setPrefer(e.target.value)} />
            </label>
          </div>
          <label className="campo">
            <span>{t("Nota (opcional)", "Note (optional)")}</span>
            <input className="entrada bg-branco" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
          </label>
          {create.isError && <p role="alert" className="faixa-erro m-0">{message(create.error)}</p>}
          <button type="submit" className="btn-sec justify-self-start bg-branco" disabled={create.isPending || !search.trim()}>{t("Acrescentar regra", "Add rule")}</button>
        </form>
      )}
    </section>
  );
}

type Account = { com_evidencia: number; sem_fonte: number; risco: number; incerto: number };

function Table({ titulo: title, primeira: first, linhas: lines, incerto: uncertain = false }: { titulo: string; primeira: string; linhas: (Account & { rotulo: string })[]; incerto?: boolean }) {
  return (
    // Scrolls sideways on mobile: the keyboard must reach the content (tabIndex) and the screen reader hears the table's name.
    <div className="overflow-x-auto rounded-card bg-branco shadow-curta" tabIndex={0} role="region" aria-label={title}>
      <table className="w-full border-collapse text-left text-[15px]">
        <caption className="mono px-4 pt-3 pb-1 text-left text-[12px] tracking-[.08em] text-apoio uppercase">{title}</caption>
        <thead>
          <tr className="border-b border-fio">
            <th scope="col" className="px-4 py-2 font-bold">{first}</th>
            <th scope="col" className="px-3 py-2 text-right font-bold">{t("com evidência", "with evidence")}</th>
            <th scope="col" className="px-3 py-2 text-right font-bold">{t("sem fonte", "no source")}</th>
            <th scope="col" className="px-3 py-2 text-right font-bold">{t("risco", "risk")}</th>
            {uncertain && <th scope="col" className="px-4 py-2 text-right font-bold">{t("incerto", "uncertain")}</th>}
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.rotulo} className="border-b border-fio last:border-b-0">
              <th scope="row" className="px-4 py-2 font-normal">{l.rotulo}</th>
              <td className="mono px-3 py-2 text-right text-[14px]">{l.com_evidencia}</td>
              <td className="mono px-3 py-2 text-right text-[14px]">{l.sem_fonte}</td>
              <td className="mono px-3 py-2 text-right text-[14px]">{l.risco}</td>
              {uncertain && <td className="mono px-4 py-2 text-right text-[14px]">{l.incerto}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AuditLog({ tenantId }: { tenantId: string }) {
  const q = useQuery({ queryKey: [tenantId, "auditoria"], queryFn: () => read(route.auditoria.$get({ param: { tenantId } })) });
  const en = language() === "en";
  const month = (m: string) => new Date(`${m}-15T12:00:00`).toLocaleDateString(locale(), { month: "long", year: "numeric" });
  return (
    <section aria-labelledby="auditoria-t" className="mt-8 grid gap-5">
      <h2 id="auditoria-t" className="m-0 text-[22px]">{t("Auditoria das marcas", "Mark audit")}</h2>
      <p className="m-0 max-w-[60ch]">{t("Nos últimos seis meses: as marcas da conferência por mês, por tema e por pessoa citada, e o que foi ignorado. Serve para ver se a conferência pesa mais para um lado. A mesma frase conferida de novo conta uma vez.",
        "Over the last six months: the check's marks by month, by topic and by person quoted, and what was ignored. It helps you see whether the check leans to one side. The same sentence checked again counts once.")}</p>
      {q.isPending ? <div className="esqueleto h-40" /> : q.isError ? <FailureLoad oque={t("a auditoria", "the audit")} tentar={() => q.refetch()} /> : (
        <>
          {q.data.meses.length
            ? <Table titulo={t("Por mês", "By month")} primeira={t("Mês", "Month")} incerto linhas={q.data.meses.map((m) => ({ ...m, rotulo: month(m.mes) }))} />
            : <p className="m-0 text-apoio">{t("Nenhuma conferência ainda.", "No checks yet.")}</p>}
          {q.data.meses.length > 0 && <Table titulo={t("Por tema", "By topic")} primeira={t("Tema", "Topic")} linhas={q.data.temas.map((x) => ({ ...x, rotulo: en ? x.en : x.pt }))} />}
          {q.data.pessoas.length > 0 && <Table titulo={t("Por pessoa ou instituição citada", "By person or institution quoted")} primeira={t("Nome", "Name")} linhas={q.data.pessoas.map((x) => ({ ...x, rotulo: x.nome }))} />}
          <div className="grid gap-2">
            <h3 className="mono m-0 text-[12px] tracking-[.08em] text-apoio uppercase">{t("Ignoradas", "Ignored")}</h3>
            {q.data.ignoradas.length ? (
              <ul className="m-0 grid list-none gap-2 p-0">
                {q.data.ignoradas.map((i) => (
                  <li key={i.id} className="grid gap-1 rounded-card bg-branco px-4 py-3 shadow-curta">
                    <span className="text-[15px]">“{i.trecho}”</span>
                    <span className="mono text-apoio">
                      {t(`${i.por ?? "alguém"}, ${when(i.em)}`, `${i.por ?? "someone"}, ${when(i.em)}`)}{i.desfeitaEm ? t(" · desfeita depois", " · undone later") : ""} · <Link to={i.textoId} className="link-acao font-normal">{i.titulo}</Link>
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p className="m-0 text-apoio">{t("Nada ignorado.", "Nothing ignored.")}</p>}
          </div>
        </>
      )}
    </section>
  );
}
