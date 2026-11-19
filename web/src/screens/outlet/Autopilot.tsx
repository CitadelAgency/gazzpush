// Autopilot on the Sources tab: admins only, off by default. Whoever has no account that posts by itself sees what is missing.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { bodyJson, read } from "../../api";
import { keys } from "../../queue";
import { t as tr } from "../../language";
import { actionMessage, t } from "./common";

type Status = { ligado: boolean; porDia: number; contaSozinha: boolean };

/** The closed part's row. On is a risk in progress (posts nobody reads): it shows in amber and the part opens by itself. */
export const summaryAutopilot = ({ ligado: on, porDia: perDay, contaSozinha: soloAccount }: Status) => (on
  ? { texto: tr(`ligado · até ${perDay} por dia sem ninguém ler`, `on · up to ${perDay} a day with nobody reading`), tom: "aviso" as const }
  : { texto: soloAccount ? tr("desligado", "off") : tr("desligado · falta conta que posta sozinha", "off · needs an account that posts on its own"), tom: undefined });

export function Autopilot({ tenantId, ligado: on, porDia: perDay, contaSozinha: soloAccount }: Status & { tenantId: string }) {
  const qc = useQueryClient();
  const change = useMutation({
    mutationFn: (v: boolean) => read(t.piloto.$patch({ param: { tenantId } }, bodyJson({ ligado: v }))),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.fontes(tenantId) }),
  });
  const blocked = !soloAccount && !on;
  return (
    <div className="grid gap-2">
      <label className={`flex min-h-11 items-center gap-2 ${blocked ? "" : "cursor-pointer"}`}>
        <input type="checkbox" checked={on} disabled={blocked || change.isPending} onChange={(e) => change.mutate(e.target.checked)} className="size-[18px] accent-texto-forte" />
        <span className="text-texto-forte">{tr("Aprovar sozinho o que vem do site do veículo", "Approve what comes from the outlet's site on its own")}</span>
      </label>
      {blocked
        ? <p className="ajuda m-0 max-w-[60ch]">{tr("Exige a conexão direta com o Instagram, ou um intermediário, porque a conta precisa postar sozinha. Ligue em Contas.", "It needs the direct Instagram connection, or a posting service, because the account has to post on its own. Set it up in Accounts.")}</p>
        : <p className="ajuda m-0 max-w-[60ch]">{tr("O risco: um post sai sem ninguém ler, e a responsabilidade continua do veículo.", "The risk: a post goes out with nobody reading it, and the outlet is still responsible for it.")}</p>}
      <p className="ajuda m-0 max-w-[60ch]">{tr(
        `Até ${perDay} por dia, com pelo menos 60 minutos entre eles, e só se a conferência não trouxer erro nem aviso. Publicidade, correção, resumo e Reels nunca passam pelo piloto. Desligar vale para os posts seguintes.`,
        `Up to ${perDay} a day, at least 60 minutes apart, and only if the check finds no error or warning. Advertising, corrections, roundups and Reels never go through autopilot. Turning it off applies to the next posts.`,
      )}</p>
      {change.isError && <p role="alert" className="faixa-erro m-0">{actionMessage(change.error, tr("mudar o piloto", "change autopilot"))}</p>}
    </div>
  );
}
