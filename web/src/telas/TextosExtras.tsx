// Partes da tela Textos que carregam só quando abertas: o manual de redação do veículo (regras que só apontam) e o
// painel de auditoria (marcas por mês, tema e pessoa citada, e as ignoradas), para ver se a conferência pesa mais para
// um lado. Tabelas, não gráficos: os números exatos importam mais que a forma.
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, corpoJson, ErroApi, ler } from "../api";
import { FalhaCarga } from "../comum";
import { quando } from "../fila";
import { idioma, locale, t } from "../idioma";

const rota = api.t[":tenantId"].textos;
const TIPOS: [string, () => string][] = [
  ["grafia", () => t("Grafia", "Spelling")], ["sigla", () => t("Sigla", "Acronym")], ["numero", () => t("Número", "Number")],
  ["cargo", () => t("Cargo", "Title")], ["linguagem", () => t("Linguagem", "Language")],
];
const rotuloTipo = (k: string) => TIPOS.find(([x]) => x === k)?.[1]() ?? k;
const mensagem = (e: unknown) => (e instanceof ErroApi ? e.message : t("Não deu certo agora. Tente de novo.", "That didn't work right now. Try again."));

export function Manual({ tenantId, podeEditar }: { tenantId: string; podeEditar: boolean }) {
  const qc = useQueryClient();
  const chave = [tenantId, "manual"];
  const q = useQuery({ queryKey: chave, queryFn: () => ler(rota.manual.$get({ param: { tenantId } })) });
  const [tipo, setTipo] = useState("grafia");
  const [procurar, setProcurar] = useState("");
  const [preferir, setPreferir] = useState("");
  const [nota, setNota] = useState("");
  const criar = useMutation({
    mutationFn: () => ler(rota.manual.$post({ param: { tenantId } }, corpoJson({ tipo, procurar, preferir, nota }))),
    onSuccess: (d) => { qc.setQueryData(chave, { regras: d.regras }); setProcurar(""); setPreferir(""); setNota(""); },
  });
  const tirar = useMutation({
    mutationFn: (regra: string) => ler(rota.manual[":regra"].$delete({ param: { tenantId, regra } })),
    onSuccess: (d) => qc.setQueryData(chave, d),
  });
  function enviar(e: FormEvent) {
    e.preventDefault();
    if (procurar.trim()) criar.mutate();
  }
  return (
    <section aria-labelledby="manual-t" className="mt-8 grid gap-4">
      <h2 id="manual-t" className="m-0 text-[22px]">{t("Manual de redação", "Style guide")}</h2>
      <p className="m-0 max-w-[60ch]">{t("Regras mecânicas do veículo (grafia, sigla, número, cargo, linguagem). No editor, elas só apontam onde o texto usa a forma a evitar; a mudança é sempre sua. A mesma regra vale para qualquer pessoa citada.",
        "The outlet's mechanical rules (spelling, acronyms, numbers, titles, language). In the editor they only point to where the text uses the form to avoid; the change is always yours. The same rule applies to anyone quoted.")}</p>
      {q.isPending ? <div className="esqueleto h-20" /> : q.isError ? <FalhaCarga oque={t("o manual", "the style guide")} tentar={() => q.refetch()} /> : q.data.regras.length ? (
        <ul className="m-0 grid list-none gap-2 p-0">
          {q.data.regras.map((r) => (
            <li key={r.id} className="grid gap-1 rounded-card bg-branco px-4 py-3 shadow-curta">
              <span className="text-[16px]"><s className="decoration-terracota">{r.procurar}</s>{r.preferir ? <> → <b className="text-texto-forte">{r.preferir}</b></> : null}</span>
              <span className="mono text-apoio">{rotuloTipo(r.tipo)}{r.nota ? ` · ${r.nota}` : ""}</span>
              {podeEditar && <button type="button" className="link-acao justify-self-start border-0 bg-transparent p-0 text-[14px] font-normal" onClick={() => tirar.mutate(r.id)} disabled={tirar.isPending}
                aria-label={t(`Tirar a regra: ${r.procurar}`, `Remove the rule: ${r.procurar}`)}>{t("Tirar", "Remove")}</button>}
            </li>
          ))}
        </ul>
      ) : <p className="m-0 text-apoio">{t("Nenhuma regra ainda.", "No rules yet.")}</p>}
      {tirar.isError && <p role="alert" className="faixa-erro m-0">{mensagem(tirar.error)}</p>}
      {podeEditar && (
        <form onSubmit={enviar} noValidate className="grid gap-3 rounded-card bg-papel-2/60 p-4">
          <h3 className="m-0 text-[17px]">{t("Nova regra", "New rule")}</h3>
          <div className="grid gap-3 sm:grid-cols-[160px_1fr_1fr]">
            <label className="campo">
              <span>{t("Tipo", "Type")}</span>
              <select className="entrada bg-branco" value={tipo} onChange={(e) => setTipo(e.target.value)}>{TIPOS.map(([k, r]) => <option key={k} value={k}>{r()}</option>)}</select>
            </label>
            <label className="campo">
              <span>{t("Evitar", "Avoid")}</span>
              <input className="entrada bg-branco" value={procurar} maxLength={80} onChange={(e) => { setProcurar(e.target.value); criar.reset(); }} required />
            </label>
            <label className="campo">
              <span>{t("O manual pede", "The guide asks for")}</span>
              <input className="entrada bg-branco" value={preferir} maxLength={80} onChange={(e) => setPreferir(e.target.value)} />
            </label>
          </div>
          <label className="campo">
            <span>{t("Nota (opcional)", "Note (optional)")}</span>
            <input className="entrada bg-branco" value={nota} maxLength={200} onChange={(e) => setNota(e.target.value)} />
          </label>
          {criar.isError && <p role="alert" className="faixa-erro m-0">{mensagem(criar.error)}</p>}
          <button type="submit" className="btn-sec justify-self-start bg-branco" disabled={criar.isPending || !procurar.trim()}>{t("Acrescentar regra", "Add rule")}</button>
        </form>
      )}
    </section>
  );
}

type Conta = { com_evidencia: number; sem_fonte: number; risco: number; incerto: number };

function Tabela({ titulo, primeira, linhas, incerto = false }: { titulo: string; primeira: string; linhas: (Conta & { rotulo: string })[]; incerto?: boolean }) {
  return (
    // Rola de lado no celular: o teclado precisa chegar ao conteúdo (tabIndex) e o leitor de tela ouve o nome da tabela.
    <div className="overflow-x-auto rounded-card bg-branco shadow-curta" tabIndex={0} role="region" aria-label={titulo}>
      <table className="w-full border-collapse text-left text-[15px]">
        <caption className="mono px-4 pt-3 pb-1 text-left text-[12px] tracking-[.08em] text-apoio uppercase">{titulo}</caption>
        <thead>
          <tr className="border-b border-fio">
            <th scope="col" className="px-4 py-2 font-bold">{primeira}</th>
            <th scope="col" className="px-3 py-2 text-right font-bold">{t("com evidência", "with evidence")}</th>
            <th scope="col" className="px-3 py-2 text-right font-bold">{t("sem fonte", "no source")}</th>
            <th scope="col" className="px-3 py-2 text-right font-bold">{t("risco", "risk")}</th>
            {incerto && <th scope="col" className="px-4 py-2 text-right font-bold">{t("incerto", "uncertain")}</th>}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.rotulo} className="border-b border-fio last:border-b-0">
              <th scope="row" className="px-4 py-2 font-normal">{l.rotulo}</th>
              <td className="mono px-3 py-2 text-right text-[14px]">{l.com_evidencia}</td>
              <td className="mono px-3 py-2 text-right text-[14px]">{l.sem_fonte}</td>
              <td className="mono px-3 py-2 text-right text-[14px]">{l.risco}</td>
              {incerto && <td className="mono px-4 py-2 text-right text-[14px]">{l.incerto}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Auditoria({ tenantId }: { tenantId: string }) {
  const q = useQuery({ queryKey: [tenantId, "auditoria"], queryFn: () => ler(rota.auditoria.$get({ param: { tenantId } })) });
  const en = idioma() === "en";
  const mes = (m: string) => new Date(`${m}-15T12:00:00`).toLocaleDateString(locale(), { month: "long", year: "numeric" });
  return (
    <section aria-labelledby="auditoria-t" className="mt-8 grid gap-5">
      <h2 id="auditoria-t" className="m-0 text-[22px]">{t("Auditoria das marcas", "Mark audit")}</h2>
      <p className="m-0 max-w-[60ch]">{t("Nos últimos seis meses: as marcas da conferência por mês, por tema e por pessoa citada, e o que foi ignorado. Serve para ver se a conferência pesa mais para um lado. A mesma frase conferida de novo conta uma vez.",
        "Over the last six months: the check's marks by month, by topic and by person quoted, and what was ignored. It helps you see whether the check leans to one side. The same sentence checked again counts once.")}</p>
      {q.isPending ? <div className="esqueleto h-40" /> : q.isError ? <FalhaCarga oque={t("a auditoria", "the audit")} tentar={() => q.refetch()} /> : (
        <>
          {q.data.meses.length
            ? <Tabela titulo={t("Por mês", "By month")} primeira={t("Mês", "Month")} incerto linhas={q.data.meses.map((m) => ({ ...m, rotulo: mes(m.mes) }))} />
            : <p className="m-0 text-apoio">{t("Nenhuma conferência ainda.", "No checks yet.")}</p>}
          {q.data.meses.length > 0 && <Tabela titulo={t("Por tema", "By topic")} primeira={t("Tema", "Topic")} linhas={q.data.temas.map((x) => ({ ...x, rotulo: en ? x.en : x.pt }))} />}
          {q.data.pessoas.length > 0 && <Tabela titulo={t("Por pessoa ou instituição citada", "By person or institution quoted")} primeira={t("Nome", "Name")} linhas={q.data.pessoas.map((x) => ({ ...x, rotulo: x.nome }))} />}
          <div className="grid gap-2">
            <h3 className="mono m-0 text-[12px] tracking-[.08em] text-apoio uppercase">{t("Ignoradas", "Ignored")}</h3>
            {q.data.ignoradas.length ? (
              <ul className="m-0 grid list-none gap-2 p-0">
                {q.data.ignoradas.map((i) => (
                  <li key={i.id} className="grid gap-1 rounded-card bg-branco px-4 py-3 shadow-curta">
                    <span className="text-[15px]">“{i.trecho}”</span>
                    <span className="mono text-apoio">
                      {t(`${i.por ?? "alguém"}, ${quando(i.em)}`, `${i.por ?? "someone"}, ${quando(i.em)}`)}{i.desfeitaEm ? t(" · desfeita depois", " · undone later") : ""} · <Link to={i.textoId} className="link-acao font-normal">{i.titulo}</Link>
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
