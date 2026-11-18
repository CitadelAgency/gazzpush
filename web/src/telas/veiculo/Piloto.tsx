// Piloto automático na aba Fontes: só admin, desligado por padrão. Quem não tem conta que posta sozinha vê o que falta.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { corpoJson, ler } from "../../api";
import { chaves } from "../../fila";
import { t as tr } from "../../idioma";
import { mensagemAcao, t } from "./comum";

type Situacao = { ligado: boolean; porDia: number; contaSozinha: boolean };

/** A linha da parte fechada. Ligado é risco em curso (post sem ninguém ler): fica em âmbar e a parte abre sozinha. */
export const resumoPiloto = ({ ligado, porDia, contaSozinha }: Situacao) => (ligado
  ? { texto: tr(`ligado · até ${porDia} por dia sem ninguém ler`, `on · up to ${porDia} a day with nobody reading`), tom: "aviso" as const }
  : { texto: contaSozinha ? tr("desligado", "off") : tr("desligado · falta conta que posta sozinha", "off · needs an account that posts on its own"), tom: undefined });

export function Piloto({ tenantId, ligado, porDia, contaSozinha }: Situacao & { tenantId: string }) {
  const qc = useQueryClient();
  const mudar = useMutation({
    mutationFn: (v: boolean) => ler(t.piloto.$patch({ param: { tenantId } }, corpoJson({ ligado: v }))),
    onSuccess: () => qc.invalidateQueries({ queryKey: chaves.fontes(tenantId) }),
  });
  const barrado = !contaSozinha && !ligado;
  return (
    <div className="grid gap-2">
      <label className={`flex min-h-11 items-center gap-2 ${barrado ? "" : "cursor-pointer"}`}>
        <input type="checkbox" checked={ligado} disabled={barrado || mudar.isPending} onChange={(e) => mudar.mutate(e.target.checked)} className="size-[18px] accent-texto-forte" />
        <span className="text-texto-forte">{tr("Aprovar sozinho o que vem do site do veículo", "Approve what comes from the outlet's site on its own")}</span>
      </label>
      {barrado
        ? <p className="ajuda m-0 max-w-[60ch]">{tr("Exige a conexão direta com o Instagram, ou um intermediário, porque a conta precisa postar sozinha. Ligue em Contas.", "It needs the direct Instagram connection, or a posting service, because the account has to post on its own. Set it up in Accounts.")}</p>
        : <p className="ajuda m-0 max-w-[60ch]">{tr("O risco: um post sai sem ninguém ler, e a responsabilidade continua do veículo.", "The risk: a post goes out with nobody reading it, and the outlet is still responsible for it.")}</p>}
      <p className="ajuda m-0 max-w-[60ch]">{tr(
        `Até ${porDia} por dia, com pelo menos 60 minutos entre eles, e só se a conferência não trouxer erro nem aviso. Publicidade, correção, resumo e Reels nunca passam pelo piloto. Desligar vale para os posts seguintes.`,
        `Up to ${porDia} a day, at least 60 minutes apart, and only if the check finds no error or warning. Advertising, corrections, roundups and Reels never go through autopilot. Turning it off applies to the next posts.`,
      )}</p>
      {mudar.isError && <p role="alert" className="faixa-erro m-0">{mensagemAcao(mudar.error, tr("mudar o piloto", "change autopilot"))}</p>}
    </div>
  );
}
