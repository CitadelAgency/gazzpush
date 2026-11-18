// Outra ilustração na edição do card: gera e já mostra na prévia. Quem grava é "Salvar e conferir".
import { useMutation } from "@tanstack/react-query";
import { api, corpoJson, ler } from "../api";
import { t as tr } from "../idioma";

const t = api.t[":tenantId"].pecas[":id"].cards[":cardId"];

export function OutraIlustracao({ tenantId, pecaId, versao, cardId, atual, gerou, voltar }: {
  tenantId: string; pecaId: string; versao: number; cardId: string; atual: string | null;
  gerou: (cardId: string, chave: string, url: string) => void; voltar: () => void;
}) {
  const pedir = useMutation({
    mutationFn: () => ler(t.ilustracao.$post({ param: { tenantId, id: pecaId, cardId } }, corpoJson({ versao }))),
    onSuccess: (r) => gerou(cardId, r.chave, r.url),
  });
  const ajuda = pedir.isPending ? tr("Pode levar até um minuto.", "It can take up to a minute.")
    : pedir.data ? tr(`Pode pedir mais ${pedir.data.restantes} para este card.`, `You can ask for ${pedir.data.restantes} more for this card.`)
      : tr("Até 3 por card. A escolhida vale depois de salvar.", "Up to 3 per card. The chosen one counts after saving.");
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-sec bg-papel-2" disabled={pedir.isPending || pedir.data?.restantes === 0} onClick={() => pedir.mutate()}>
          {pedir.isPending ? tr("Gerando…", "Generating…") : tr("Outra ilustração", "Another illustration")}
        </button>
        {atual && <button type="button" className="btn-sec" onClick={voltar}>{tr("Voltar à do post", "Back to the post's")}</button>}
      </div>
      {pedir.isError
        ? <p role="alert" className="m-0 text-[15px] text-terracota">{(pedir.error as Error).message}</p>
        : <p role="status" className="ajuda m-0">{ajuda}</p>}
    </div>
  );
}
