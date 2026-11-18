// Consumo de tokens (só o dono da plataforma): quanto cada veículo e cada função gastaram, atualizando sozinho. Sem gráfico: o que
// se quer aqui são os números exatos, lado a lado. `GET /api/admin/uso` responde 404 para quem não está em ADMIN_USER_IDS.
import type { ReactNode } from "react";
import { Link, Navigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api, ErroApi, ler, type Sucesso } from "../api";
import { FalhaCarga, useTitulo } from "../comum";
import { t } from "../idioma";
import NaoEncontrada from "./NaoEncontrada";

type Painel = Sucesso<Awaited<ReturnType<typeof api.admin.uso.$get>>>;
type Funcao = Painel["funcoes"][number]["funcao"];
const ATUALIZA_MS = 3000;
const PERIODOS = [["1", () => t("Hoje", "Today")], ["7", () => t("7 dias", "7 days")], ["30", () => t("30 dias", "30 days")]] as const;
const FUNCAO: Record<Funcao, () => string> = {
  conferencia: () => t("Conferência", "Fact check"),
  post: () => t("Post", "Post"),
  ajuste: () => t("Ajuste de frase", "Sentence edit"),
  gancho: () => t("Manchetes", "Headlines"),
  pergunta_documento: () => t("Pergunta ao documento", "Document question"),
  divulgacao: () => t("Divulgação", "Promotion"),
  segunda_leitura: () => t("Segunda leitura", "Second read"),
  ilustracao: () => t("Ilustração", "Illustration"),
};
const numero = (n: number) => n.toLocaleString(t("pt-BR", "en"));
const dolar = (n: number) => `US$ ${n.toLocaleString(t("pt-BR", "en"), { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
const utc = (s: string) => new Date(`${s.replace(" ", "T")}Z`);
const horario = (s: string) => utc(s).toLocaleTimeString(t("pt-BR", "en"), { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const dataCurta = (s: string) => utc(s).toLocaleDateString(t("pt-BR", "en"), { timeZone: "America/Sao_Paulo", day: "numeric", month: "short" });
const diaCurto = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(t("pt-BR", "en"), { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });

type Soma = Painel["totais"];

function Tabela({ titulo, rotulo, linhas }: { titulo: string; rotulo: string; linhas: { chave: string; nome: ReactNode; soma: Soma }[] }) {
  return (
    <section aria-label={titulo} className="grid gap-2">
      <h2 className="mono m-0 text-[12px] tracking-[.08em] text-apoio uppercase">{titulo}</h2>
      {linhas.length ? (
        <table className="w-full border-collapse text-[15px]">
          <thead>
            <tr className="mono text-left text-[12px] text-apoio">
              <th scope="col" className="pb-1 font-normal">{rotulo}</th>
              <th scope="col" className="pb-1 text-right font-normal">{t("Chamadas", "Calls")}</th>
              <th scope="col" className="pb-1 text-right font-normal">{t("Tokens", "Tokens")}</th>
              <th scope="col" className="pb-1 text-right font-normal">{t("Custo", "Cost")}</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.chave} className="border-t border-fio align-top">
                <th scope="row" className="py-2 pr-3 text-left font-normal text-texto-forte">{l.nome}</th>
                <td className="mono py-2 pl-2 text-right">{numero(l.soma.chamadas)}</td>
                <td className="mono py-2 pl-2 text-right">{numero(l.soma.tokens)}</td>
                <td className="mono py-2 pl-2 text-right whitespace-nowrap">{dolar(l.soma.custoUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="m-0 text-apoio">{t("Nenhuma chamada neste período.", "No calls in this period.")}</p>}
    </section>
  );
}

export default function Uso() {
  useTitulo(t("Consumo de tokens", "Token usage"));
  const [params, setParams] = useSearchParams();
  const dias = PERIODOS.some(([d]) => d === params.get("dias")) ? (params.get("dias") as (typeof PERIODOS)[number][0]) : "1";
  const q = useQuery({
    queryKey: ["admin", "uso", dias],
    queryFn: () => ler(api.admin.uso.$get({ query: { dias } })),
    refetchInterval: (c) => (c.state.error instanceof ErroApi && [401, 404].includes(c.state.error.status) ? false : ATUALIZA_MS),
    retry: false,
  });
  if (q.error instanceof ErroApi && q.error.status === 404) return <NaoEncontrada />;
  if (q.error instanceof ErroApi && q.error.status === 401) return <Navigate to="/entrar" replace />;

  const d = q.data;
  return (
    <main id="conteudo" className="mx-auto grid max-w-[1000px] gap-6 px-5 pt-6 pb-14 lg:px-12 lg:pt-10">
      <header className="grid gap-2">
        <Link to="/" className="link-acao justify-self-start text-[15px]">{t("Voltar ao aplicativo", "Back to the app")}</Link>
        <h1 className="titulo-tela m-0 text-[30px] leading-[1.1] lg:text-[40px]">{t("Consumo de tokens", "Token usage")}</h1>
        <div role="group" aria-label={t("Período", "Period")} className="flex flex-wrap gap-1">
          {PERIODOS.map(([p, rotulo]) => (
            <button key={p} type="button" aria-pressed={dias === p} onClick={() => setParams({ dias: p }, { replace: true })}
              className={`inline-flex min-h-11 cursor-pointer items-center rounded-btn border-0 px-3 text-[15px] ${dias === p ? "bg-papel-2 font-bold text-texto-forte" : "bg-transparent text-texto hover:bg-papel-2"}`}>{rotulo()}</button>
          ))}
        </div>
      </header>

      {q.isPending && <p role="status" className="mono m-0 text-apoio">{t("carregando…", "loading…")}</p>}
      {q.isError && !d && <FalhaCarga oque={t("o consumo", "the usage")} tentar={() => q.refetch()} />}
      {/* Falha de carga nunca vira fato: número velho fica à vista dizendo de quando é. */}
      {q.isError && d && <p role="alert" className="faixa-aviso m-0">{t(`Não atualizou. Estes números são das ${new Date(q.dataUpdatedAt).toLocaleTimeString("pt-BR")}.`, `Didn't update. These numbers are from ${new Date(q.dataUpdatedAt).toLocaleTimeString("en")}.`)}</p>}

      {d && (
        <>
          <section aria-label={t("Totais do período", "Period totals")} className="grid gap-1 rounded-card bg-branco p-4 shadow-curta">
            <p className="titulo-tela m-0 text-[34px] leading-[1.15] text-texto-forte lg:text-[44px]">{dolar(d.totais.custoUsd)}</p>
            <p className="m-0 text-[17px] text-texto-forte">{t(`${numero(d.totais.tokens)} tokens em ${numero(d.totais.chamadas)} chamadas`, `${numero(d.totais.tokens)} tokens in ${numero(d.totais.chamadas)} calls`)}</p>
            {d.totais.custoVeiculoUsd > 0 && <p className="m-0 text-[15px]">{t(`Desse total, ${dolar(d.totais.custoVeiculoUsd)} saíram da chave do próprio veículo, não da sua conta.`, `Of this total, ${dolar(d.totais.custoVeiculoUsd)} was paid with the publication's own key, not your account.`)}</p>}
            <p className="mono m-0 text-apoio">{t(`${numero(d.totais.entrada)} de entrada · ${numero(d.totais.cache)} de cache · ${numero(d.totais.saida)} de saída`, `${numero(d.totais.entrada)} input · ${numero(d.totais.cache)} cache · ${numero(d.totais.saida)} output`)}</p>
            {!q.isError && <p className="mono m-0 text-apoio">{t(`ao vivo · atualizado às ${new Date(q.dataUpdatedAt).toLocaleTimeString("pt-BR")}`, `live · updated at ${new Date(q.dataUpdatedAt).toLocaleTimeString("en")}`)}</p>}
          </section>

          <div className="grid gap-8 lg:grid-cols-2">
            <Tabela titulo={t("Por veículo", "By publication")} rotulo={t("Veículo", "Publication")} linhas={d.veiculos.map((v) => ({
              chave: v.id, soma: v,
              nome: <span className="grid"><span>{v.nome}</span><span className="mono text-[13px] text-apoio">{v.plano ?? t("veículo apagado", "deleted publication")}{v.precoReais ? ` · R$ ${v.precoReais}${t("/mês", "/mo")}` : ""}{v.custoVeiculoUsd > 0 ? t(` · ${dolar(v.custoVeiculoUsd)} com a chave dele`, ` · ${dolar(v.custoVeiculoUsd)} on its own key`) : ""}</span></span>,
            }))} />
            <Tabela titulo={t("Por função", "By feature")} rotulo={t("Função", "Feature")} linhas={d.funcoes.map((f) => ({ chave: f.funcao, nome: FUNCAO[f.funcao](), soma: f }))} />
          </div>
          {d.dias > 1 && <Tabela titulo={t("Por dia", "By day")} rotulo={t("Dia", "Day")} linhas={d.porDia.map((x) => ({ chave: x.dia, nome: diaCurto(x.dia), soma: x }))} />}

          <section aria-label={t("Últimas chamadas", "Latest calls")} className="grid gap-2">
            <h2 className="mono m-0 text-[12px] tracking-[.08em] text-apoio uppercase">{t("Últimas chamadas", "Latest calls")}</h2>
            {d.ultimas.length ? (
              <ul className="m-0 grid list-none p-0">
                {d.ultimas.map((u) => (
                  <li key={u.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-t border-fio py-2 text-[15px]">
                    <span className="min-w-0 text-texto-forte">{FUNCAO[u.funcao]()} · {u.veiculo}</span>
                    <span className="mono text-right whitespace-nowrap">{dolar(u.custoUsd)}</span>
                    <span className="mono min-w-0 text-[13px] break-words text-apoio">{horario(u.em)} · {u.modelo}{u.chave === "veiculo" ? t(" · chave do veículo", " · publication's key") : ""}</span>
                    <span className="mono text-right text-[13px] whitespace-nowrap text-apoio">{t(`${numero(u.tokens)} tokens`, `${numero(u.tokens)} tokens`)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="m-0 text-apoio">{t("Nenhuma chamada neste período.", "No calls in this period.")}</p>}
          </section>

          <p className="ajuda m-0 max-w-[70ch]">
            {t("Inclui DeepSeek, Claude e Kie. Workers AI (transcrição, triagem, conferência de imagem) não informa tokens e fica de fora. O custo é estimado pela tabela de preços do código; a fatura de cada fornecedor é o número final.",
              "Includes DeepSeek, Claude and Kie. Workers AI (transcription, triage, image check) doesn't report tokens and is left out. Cost is estimated from the price table in the code; each provider's invoice is the final number.")}
            {d.registrandoDesde ? t(` Contando desde ${dataCurta(d.registrandoDesde)}: o que veio antes não foi registrado.`, ` Counting since ${dataCurta(d.registrandoDesde)}: anything earlier wasn't recorded.`) : ""}
          </p>
        </>
      )}
    </main>
  );
}
