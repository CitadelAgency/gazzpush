// Aprovação do anunciante na Revisão: o estado do link e "Copiar link". Avisa, mas não trava o Aprovar: a revisão que
// vale é a do veículo.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ler, type Sucesso } from "../api";
import { FalhaCarga } from "../comum";
import { quando } from "../fila";
import { t as tr } from "../idioma";

const t = api.t[":tenantId"].pecas[":id"];
type Estado = Sucesso<Awaited<ReturnType<typeof t.anuncio.$get>>>;

const FRASE = (e: Estado): string => ({
  sem_link: tr("O anunciante ainda não viu este post. Copie o link e mande para ele aprovar.", "The advertiser hasn't seen this post yet. Copy the link and send it for approval."),
  aguardando: tr("Aguardando a resposta do anunciante.", "Waiting for the advertiser's reply."),
  aprovado: tr(`Aprovado pelo anunciante${e.em ? ` em ${quando(e.em)}` : ""}.`, `Approved by the advertiser${e.em ? ` on ${quando(e.em)}` : ""}.`),
  ajuste: tr("O anunciante pediu ajuste.", "The advertiser asked for a change."),
  versao_mudou: tr("O post mudou depois do link. Gere outro para o anunciante ver esta versão.", "The post changed after the link was created. Create another so the advertiser sees this version."),
  expirado: tr("O link venceu sem resposta. Gere outro.", "The link expired with no reply. Create another."),
})[e.estado];

export function AprovacaoAnunciante({ tenantId, pecaId, editor }: { tenantId: string; pecaId: string; editor: boolean }) {
  const qc = useQueryClient();
  const chave = ["anuncio", tenantId, pecaId];
  const estado = useQuery({ queryKey: chave, queryFn: () => ler(t.anuncio.$get({ param: { tenantId, id: pecaId } })) });
  const [copiou, setCopiou] = useState<string | null>(null);
  const link = useMutation({
    mutationFn: () => ler(t.anuncio.link.$post({ param: { tenantId, id: pecaId } })),
    onSuccess: async (r) => {
      qc.invalidateQueries({ queryKey: chave });
      // Sem permissão de área de transferência, o link fica à vista para copiar à mão.
      const ok = await navigator.clipboard.writeText(r.url).then(() => true, () => false);
      setCopiou(ok ? null : r.url);
    },
  });
  if (estado.isPending) return null;
  if (estado.isError) return <FalhaCarga oque={tr("a aprovação do anunciante", "the advertiser's approval")} tentar={() => estado.refetch()} />;
  const e = estado.data;
  const pendente = e.estado !== "aprovado";
  return (
    <section aria-labelledby="rv-anunciante" className={pendente ? "faixa-aviso" : ""}>
      <h2 id="rv-anunciante" className="m-0 text-[15px] font-bold">{tr(`Publicidade de ${e.anunciante}`, `Advertisement for ${e.anunciante}`)}</h2>
      <p className="m-0 mt-1">{FRASE(e)}</p>
      {e.comentario && <p className="m-0 mt-1"><b>{tr("Comentário", "Comment")}:</b> {e.comentario}</p>}
      {editor && (
        <p className="m-0 mt-2 flex flex-wrap items-center gap-3">
          <button type="button" className="btn-sec bg-papel" disabled={link.isPending} onClick={() => link.mutate()}>{tr("Copiar link", "Copy link")}</button>
          <span role="status" className="ajuda">{link.isSuccess && !copiou ? tr("Link copiado. Vale 7 dias, só para esta versão.", "Link copied. It's valid for 7 days, for this version only.") : ""}</span>
        </p>
      )}
      {copiou && <p className="mono m-0 mt-2 break-all">{copiou}</p>}
      {link.isError && <p role="alert" className="m-0 mt-2 text-terracota">{(link.error as Error).message}</p>}
    </section>
  );
}
