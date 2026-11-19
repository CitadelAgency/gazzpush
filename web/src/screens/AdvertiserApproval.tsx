// The advertiser's approval in Review: the link's state and "Copy link". It warns, but does not gate Approve: the
// review that counts is the outlet's.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, read, type Success } from "../api";
import { FailureLoad } from "../common";
import { when } from "../queue";
import { t as tr } from "../language";

const t = api.t[":tenantId"].pecas[":id"];
type State = Success<Awaited<ReturnType<typeof t.anuncio.$get>>>;

const SENTENCE = (e: State): string => ({
  sem_link: tr("O anunciante ainda não viu este post. Copie o link e mande para ele aprovar.", "The advertiser hasn't seen this post yet. Copy the link and send it for approval."),
  aguardando: tr("Aguardando a resposta do anunciante.", "Waiting for the advertiser's reply."),
  aprovado: tr(`Aprovado pelo anunciante${e.em ? ` em ${when(e.em)}` : ""}.`, `Approved by the advertiser${e.em ? ` on ${when(e.em)}` : ""}.`),
  ajuste: tr("O anunciante pediu ajuste.", "The advertiser asked for a change."),
  versao_mudou: tr("O post mudou depois do link. Gere outro para o anunciante ver esta versão.", "The post changed after the link was created. Create another so the advertiser sees this version."),
  expirado: tr("O link venceu sem resposta. Gere outro.", "The link expired with no reply. Create another."),
})[e.estado];

export function ApprovalAdvertiser({ tenantId, pecaId: pieceId, editor }: { tenantId: string; pecaId: string; editor: boolean }) {
  const qc = useQueryClient();
  const key = ["anuncio", tenantId, pieceId];
  const state = useQuery({ queryKey: key, queryFn: () => read(t.anuncio.$get({ param: { tenantId, id: pieceId } })) });
  const [copied, setCopied] = useState<string | null>(null);
  const link = useMutation({
    mutationFn: () => read(t.anuncio.link.$post({ param: { tenantId, id: pieceId } })),
    onSuccess: async (r) => {
      qc.invalidateQueries({ queryKey: key });
      // Without clipboard permission, the link stays in view to copy by hand.
      const ok = await navigator.clipboard.writeText(r.url).then(() => true, () => false);
      setCopied(ok ? null : r.url);
    },
  });
  if (state.isPending) return null;
  if (state.isError) return <FailureLoad oque={tr("a aprovação do anunciante", "the advertiser's approval")} tentar={() => state.refetch()} />;
  const e = state.data;
  const pending = e.estado !== "aprovado";
  return (
    <section aria-labelledby="rv-anunciante" className={pending ? "faixa-aviso" : ""}>
      <h2 id="rv-anunciante" className="m-0 text-[15px] font-bold">{tr(`Publicidade de ${e.anunciante}`, `Advertisement for ${e.anunciante}`)}</h2>
      <p className="m-0 mt-1">{SENTENCE(e)}</p>
      {e.comentario && <p className="m-0 mt-1"><b>{tr("Comentário", "Comment")}:</b> {e.comentario}</p>}
      {editor && (
        <p className="m-0 mt-2 flex flex-wrap items-center gap-3">
          <button type="button" className="btn-sec bg-papel" disabled={link.isPending} onClick={() => link.mutate()}>{tr("Copiar link", "Copy link")}</button>
          <span role="status" className="ajuda">{link.isSuccess && !copied ? tr("Link copiado. Vale 7 dias, só para esta versão.", "Link copied. It's valid for 7 days, for this version only.") : ""}</span>
        </p>
      )}
      {copied && <p className="mono m-0 mt-2 break-all">{copied}</p>}
      {link.isError && <p role="alert" className="m-0 mt-2 text-terracota">{(link.error as Error).message}</p>}
    </section>
  );
}
