// The Plan tab, admins only: the plan, the month's usage, the comparison, subscribing and managing. Without the Stripe
// secrets, it says billing is not configured, and the rest of the app works the same.
import { useMutation, useQuery } from "@tanstack/react-query";
import { useId } from "react";
import type { Plano as IdPlano } from "../../../../src/lib/plans";
import { bodyJson, ApiError, read } from "../../api";
import { FailureLoad } from "../../common";
import { language, t as tr } from "../../language";
import type { Outlet } from "../../session";
import { Load, t } from "./common";

const NAME = (p: IdPlano) => ({ teste: tr("Sem plano", "No plan"), pagina: tr("Página", "Page"), portal: tr("Portal", "News site"), cortesia: tr("Cortesia", "Complimentary") })[p];
const TO_WHO = (p: IdPlano) => (p === "pagina" ? tr("Para a página de bairro ou o autor que posta todo dia.", "For a neighborhood page or an author posting daily.") : tr("Para o portal com mais de um post por dia.", "For a news site with several posts a day."));
const currentMonth = () => new Date().toLocaleDateString(language(), { month: "long", timeZone: "America/Sao_Paulo" });
const dateOf = (s: string) => new Date(s).toLocaleDateString(language(), { day: "numeric", month: "long", timeZone: "America/Sao_Paulo" });

export default function Plan({ veiculo: outlet, admin }: { veiculo: Outlet; admin: boolean }) {
  const param = { tenantId: outlet.id };
  const plan = useQuery({ queryKey: [outlet.id, "plano"], enabled: admin, queryFn: () => read(t.plano.$get({ param })) });
  const go = (r: { url: string }) => { window.location.assign(r.url); };
  const sign = useMutation({ mutationFn: (id: "pagina" | "portal") => read(t.assinatura.checkout.$post({ param }, bodyJson({ plano: id }))), onSuccess: go });
  const manage = useMutation({ mutationFn: () => read(t.assinatura.portal.$post({ param }, bodyJson({}))), onSuccess: go });
  const title = useId();

  if (!admin) return <p className="m-0 max-w-[60ch]">{tr("Só o admin do veículo vê o plano.", "Only the outlet's admin sees the plan.")}</p>;
  if (plan.isPending) return <Load oque={tr("o plano", "the plan")} />;
  if (plan.isError) return <FailureLoad oque={tr("o plano", "the plan")} tentar={() => plan.refetch()} />;

  const p = plan.data;
  const name = NAME(p.plano);
  const withoutPlan = p.limite === 0;
  const usage = p.limite === null ? null
    : withoutPlan ? tr("Assine um plano para produzir posts e conferir textos.", "Subscribe to a plan to produce posts and check texts.")
      : tr(`${p.usados} de ${p.limite} posts em ${currentMonth()}`, `${p.usados} of ${p.limite} posts in ${currentMonth()}`);
  const fraction = p.limite ? Math.min(1, p.usados / p.limite) : 0;
  const inLimit = !!p.limite && p.usados >= p.limite;
  const failure = sign.error ?? manage.error;

  return (
    <div className="grid max-w-[640px] gap-6">
      <section aria-labelledby={title} className="grid gap-2">
        <h2 id={title} className="m-0 text-[22px]">{withoutPlan ? name : tr(`Plano ${name}`, `${name} plan`)}</h2>
        {usage ? <p className="m-0">{usage}</p> : <p className="m-0">{tr(`Sem limite de posts. Foram ${p.usados} em ${currentMonth()}.`, `No post limit. ${p.usados} in ${currentMonth()}.`)}</p>}
        {!!p.limite && (
          <div aria-hidden="true" className="h-1.5 w-full bg-papel-2"><div className={`h-full ${fraction >= p.avisoEm ? "bg-terracota" : "bg-tinta"}`} style={{ width: `${fraction * 100}%` }} /></div>
        )}
        {inLimit
          ? <p role="status" className="faixa-erro m-0">{tr("O limite chegou. Ideias novas esperam na lista, e o que está pronto continua podendo ser aprovado e publicado.", "The limit is reached. New ideas wait on the list, and what is ready can still be approved and published.")}</p>
          : fraction >= p.avisoEm && <p role="status" className="faixa-aviso m-0">{tr(`Faltam ${p.limite! - p.usados} posts.`, `${p.limite! - p.usados} posts left.`)}</p>}
        {p.bloqueado && <p role="alert" className="faixa-erro m-0">{tr("O pagamento está atrasado há mais de 7 dias, e post novo está parado. Acerte em Gerenciar assinatura.", "The payment is more than 7 days late, and new posts are stopped. Sort it out in Manage subscription.")}</p>}
        {!p.bloqueado && p.assinatura?.atrasoDesde && <p role="status" className="faixa-aviso m-0">{tr("A última cobrança falhou. Depois de 7 dias, post novo para. Acerte em Gerenciar assinatura.", "The last charge failed. After 7 days, new posts stop. Sort it out in Manage subscription.")}</p>}
        {p.assinatura?.periodoFim && p.assinatura.status !== "canceled" && <p className="ajuda m-0">{tr(`Próxima cobrança em ${dateOf(p.assinatura.periodoFim)}.`, `Next charge on ${dateOf(p.assinatura.periodoFim)}.`)}</p>}
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
                  <b className="text-texto-forte">{NAME(o.id)}</b>
                  <span>{tr(`R$ ${o.precoReais} por mês · ${o.limite} posts por mês`, `R$ ${o.precoReais} a month · ${o.limite} posts a month`)}</span>
                  <span className="ajuda">{TO_WHO(o.id)}</span>
                </div>
                {p.plano === o.id ? <span className="mono text-apoio">{tr("seu plano", "your plan")}</span>
                  : !p.assinatura?.gerenciavel || p.assinatura.status === "canceled"
                    ? <button type="button" className="btn-sec justify-self-start" disabled={sign.isPending} onClick={() => sign.mutate(o.id)}>{tr(`Assinar ${NAME(o.id)}`, `Subscribe to ${NAME(o.id)}`)}</button>
                    : null}
              </li>
            ))}
          </ul>
          <p className="ajuda m-0">{tr("Cada veículo tem o seu plano. Conta post e carrossel novos; reescrita, Reels e correção não contam.", "Each outlet has its own plan. New posts and carousels count; rewrites, Reels and corrections don't.")}</p>
          {p.assinatura?.gerenciavel && <button type="button" className="btn-sec justify-self-start" disabled={manage.isPending} onClick={() => manage.mutate()}>{manage.isPending ? tr("Abrindo…", "Opening…") : tr("Gerenciar assinatura", "Manage subscription")}</button>}
          {failure && <p role="alert" className="faixa-erro m-0">{failure instanceof ApiError && failure.status !== 0 ? failure.message : tr("Sem conexão. Tente de novo.", "No connection. Try again.")}</p>}
        </section>
      )}
    </div>
  );
}
