// Aba Plano, só admin: o plano, o uso do mês, a comparação, assinar e gerenciar. Sem os segredos da Stripe, diz que a cobrança não
// está configurada, e o resto do app segue igual.
import { useMutation, useQuery } from "@tanstack/react-query";
import { useId } from "react";
import type { Plano as IdPlano } from "../../../../src/lib/planos";
import { corpoJson, ErroApi, ler } from "../../api";
import { FalhaCarga } from "../../comum";
import { idioma, t as tr } from "../../idioma";
import type { Veiculo } from "../../sessao";
import { Carga, t } from "./comum";

const NOME = (p: IdPlano) => ({ teste: tr("Sem plano", "No plan"), pagina: tr("Página", "Page"), portal: tr("Portal", "News site"), cortesia: tr("Cortesia", "Complimentary") })[p];
const PARA_QUEM = (p: IdPlano) => (p === "pagina" ? tr("Para a página de bairro ou o autor que posta todo dia.", "For a neighborhood page or an author posting daily.") : tr("Para o portal com mais de um post por dia.", "For a news site with several posts a day."));
const mesAtual = () => new Date().toLocaleDateString(idioma(), { month: "long", timeZone: "America/Sao_Paulo" });
const dataDe = (s: string) => new Date(s).toLocaleDateString(idioma(), { day: "numeric", month: "long", timeZone: "America/Sao_Paulo" });

export default function Plano({ veiculo, admin }: { veiculo: Veiculo; admin: boolean }) {
  const param = { tenantId: veiculo.id };
  const plano = useQuery({ queryKey: [veiculo.id, "plano"], enabled: admin, queryFn: () => ler(t.plano.$get({ param })) });
  const ir = (r: { url: string }) => { window.location.assign(r.url); };
  const assinar = useMutation({ mutationFn: (id: "pagina" | "portal") => ler(t.assinatura.checkout.$post({ param }, corpoJson({ plano: id }))), onSuccess: ir });
  const gerenciar = useMutation({ mutationFn: () => ler(t.assinatura.portal.$post({ param }, corpoJson({}))), onSuccess: ir });
  const titulo = useId();

  if (!admin) return <p className="m-0 max-w-[60ch]">{tr("Só o admin do veículo vê o plano.", "Only the outlet's admin sees the plan.")}</p>;
  if (plano.isPending) return <Carga oque={tr("o plano", "the plan")} />;
  if (plano.isError) return <FalhaCarga oque={tr("o plano", "the plan")} tentar={() => plano.refetch()} />;

  const p = plano.data;
  const nome = NOME(p.plano);
  const semPlano = p.limite === 0;
  const uso = p.limite === null ? null
    : semPlano ? tr("Assine um plano para produzir posts e conferir textos.", "Subscribe to a plan to produce posts and check texts.")
      : tr(`${p.usados} de ${p.limite} posts em ${mesAtual()}`, `${p.usados} of ${p.limite} posts in ${mesAtual()}`);
  const fracao = p.limite ? Math.min(1, p.usados / p.limite) : 0;
  const noLimite = !!p.limite && p.usados >= p.limite;
  const falha = assinar.error ?? gerenciar.error;

  return (
    <div className="grid max-w-[640px] gap-6">
      <section aria-labelledby={titulo} className="grid gap-2">
        <h2 id={titulo} className="m-0 text-[22px]">{semPlano ? nome : tr(`Plano ${nome}`, `${nome} plan`)}</h2>
        {uso ? <p className="m-0">{uso}</p> : <p className="m-0">{tr(`Sem limite de posts. Foram ${p.usados} em ${mesAtual()}.`, `No post limit. ${p.usados} in ${mesAtual()}.`)}</p>}
        {!!p.limite && (
          <div aria-hidden="true" className="h-1.5 w-full bg-papel-2"><div className={`h-full ${fracao >= p.avisoEm ? "bg-terracota" : "bg-tinta"}`} style={{ width: `${fracao * 100}%` }} /></div>
        )}
        {noLimite
          ? <p role="status" className="faixa-erro m-0">{tr("O limite chegou. Ideias novas esperam na lista, e o que está pronto continua podendo ser aprovado e publicado.", "The limit is reached. New ideas wait on the list, and what is ready can still be approved and published.")}</p>
          : fracao >= p.avisoEm && <p role="status" className="faixa-aviso m-0">{tr(`Faltam ${p.limite! - p.usados} posts.`, `${p.limite! - p.usados} posts left.`)}</p>}
        {p.bloqueado && <p role="alert" className="faixa-erro m-0">{tr("O pagamento está atrasado há mais de 7 dias, e post novo está parado. Acerte em Gerenciar assinatura.", "The payment is more than 7 days late, and new posts are stopped. Sort it out in Manage subscription.")}</p>}
        {!p.bloqueado && p.assinatura?.atrasoDesde && <p role="status" className="faixa-aviso m-0">{tr("A última cobrança falhou. Depois de 7 dias, post novo para. Acerte em Gerenciar assinatura.", "The last charge failed. After 7 days, new posts stop. Sort it out in Manage subscription.")}</p>}
        {p.assinatura?.periodoFim && p.assinatura.status !== "canceled" && <p className="ajuda m-0">{tr(`Próxima cobrança em ${dataDe(p.assinatura.periodoFim)}.`, `Next charge on ${dataDe(p.assinatura.periodoFim)}.`)}</p>}
      </section>

      {p.instalacaoPropria ? (
        <p className="ajuda m-0 max-w-[60ch]">{tr("Esta instalação é própria: não há cobrança. Os veículos criados aqui nascem sem limite de posts, e cada um usa as chaves de IA coladas na aba Chaves de IA.", "This is a self-hosted install: there is no billing. Publications created here start with no post limit, and each one uses the AI keys pasted in the AI keys tab.")}</p>
      ) : !p.cobranca ? (
        <p className="ajuda m-0 max-w-[60ch]">{tr("A assinatura ainda não está disponível neste ambiente. Os limites valem, e o resto do app segue igual.", "Subscriptions aren't available in this environment yet. The limits apply, and the rest of the app works the same.")}</p>
      ) : (
        <section aria-label={tr("Comparar planos", "Compare plans")} className="grid gap-2">
          <ul className="m-0 grid list-none p-0">
            {p.planos.map((o) => (
              <li key={o.id} className="grid gap-2 border-t border-fio py-3 sm:grid-cols-[1fr_auto] sm:items-center">
                <div className="grid">
                  <b className="text-texto-forte">{NOME(o.id)}</b>
                  <span>{tr(`R$ ${o.precoReais} por mês · ${o.limite} posts por mês`, `R$ ${o.precoReais} a month · ${o.limite} posts a month`)}</span>
                  <span className="ajuda">{PARA_QUEM(o.id)}</span>
                </div>
                {p.plano === o.id ? <span className="mono text-apoio">{tr("seu plano", "your plan")}</span>
                  : !p.assinatura?.gerenciavel || p.assinatura.status === "canceled"
                    ? <button type="button" className="btn-sec justify-self-start" disabled={assinar.isPending} onClick={() => assinar.mutate(o.id)}>{tr(`Assinar ${NOME(o.id)}`, `Subscribe to ${NOME(o.id)}`)}</button>
                    : null}
              </li>
            ))}
          </ul>
          <p className="ajuda m-0">{tr("Cada veículo tem o seu plano. Conta post e carrossel novos; reescrita, Reels e correção não contam.", "Each outlet has its own plan. New posts and carousels count; rewrites, Reels and corrections don't.")}</p>
          {p.assinatura?.gerenciavel && <button type="button" className="btn-sec justify-self-start" disabled={gerenciar.isPending} onClick={() => gerenciar.mutate()}>{gerenciar.isPending ? tr("Abrindo…", "Opening…") : tr("Gerenciar assinatura", "Manage subscription")}</button>}
          {falha && <p role="alert" className="faixa-erro m-0">{falha instanceof ErroApi && falha.status !== 0 ? falha.message : tr("Sem conexão. Tente de novo.", "No connection. Try again.")}</p>}
        </section>
      )}
    </div>
  );
}
