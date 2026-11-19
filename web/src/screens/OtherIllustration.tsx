// Another illustration while editing the card: generates it and shows it in the preview. "Save and check" is what stores it.
import { useMutation } from "@tanstack/react-query";
import { api, bodyJson, read } from "../api";
import { t as tr } from "../language";

const t = api.t[":tenantId"].pecas[":id"].cards[":cardId"];

export function OtherIllustration({ tenantId, pecaId: pieceId, versao: version, cardId, atual: current, gerou: generated, voltar: back }: {
  tenantId: string; pecaId: string; versao: number; cardId: string; atual: string | null;
  gerou: (cardId: string, key: string, url: string) => void; voltar: () => void;
}) {
  const request = useMutation({
    mutationFn: () => read(t.ilustracao.$post({ param: { tenantId, id: pieceId, cardId } }, bodyJson({ versao: version }))),
    onSuccess: (r) => generated(cardId, r.chave, r.url),
  });
  const help = request.isPending ? tr("Pode levar até um minuto.", "It can take up to a minute.")
    : request.data ? tr(`Pode pedir mais ${request.data.restantes} para este card.`, `You can ask for ${request.data.restantes} more for this card.`)
      : tr("Até 3 por card. A escolhida vale depois de salvar.", "Up to 3 per card. The chosen one counts after saving.");
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-sec bg-papel-2" disabled={request.isPending || request.data?.restantes === 0} onClick={() => request.mutate()}>
          {request.isPending ? tr("Gerando…", "Generating…") : tr("Outra ilustração", "Another illustration")}
        </button>
        {current && <button type="button" className="btn-sec" onClick={back}>{tr("Voltar à do post", "Back to the post's")}</button>}
      </div>
      {request.isError
        ? <p role="alert" className="m-0 text-[15px] text-terracota">{(request.error as Error).message}</p>
        : <p role="status" className="ajuda m-0">{help}</p>}
    </div>
  );
}
