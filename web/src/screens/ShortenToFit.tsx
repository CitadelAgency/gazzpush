// Checked fit while editing: two shorter versions of a sentence or of the title, already checked against the fact.
// Choosing only swaps the field's text; "Save and check" is what stores it.
import { useMutation } from "@tanstack/react-query";
import { api, bodyJson, read } from "../api";
import { t as tr } from "../language";

const t = api.t[":tenantId"].pecas[":id"];

export function ShortenToFit({ tenantId, pecaId: pieceId, versao: version, cardId, frase: sentence, desatualizada: outdated, escolher: choose }: {
  tenantId: string; pecaId: string; versao: number; cardId: string; frase: number | null; desatualizada: boolean; escolher: (text: string) => void;
}) {
  const request = useMutation({ mutationFn: () => read(t.ajuste.$post({ param: { tenantId, id: pieceId } }, bodyJson({ versao: version, cardId, frase: sentence }))) });
  const options = request.data?.opcoes ?? [];
  return (
    <div className="grid gap-2">
      <p className="m-0">
        <button type="button" className="btn-sec bg-papel" disabled={request.isPending} onClick={() => request.mutate()}>
          {request.isPending ? tr("Encurtando…", "Shortening…") : tr("Encurtar para caber", "Shorten to fit")}
        </button>
      </p>
      {request.isError && <p role="alert" className="m-0 text-[15px] text-terracota">{(request.error as Error).message}</p>}
      {request.isSuccess && !options.length && <p role="status" className="faixa-aviso m-0">{tr("Nenhuma versão passou na conferência. Encurte à mão.", "No version passed the check. Shorten it by hand.")}</p>}
      {options.length > 0 && (
        <ul aria-label={tr("Versões conferidas", "Checked versions")} className="m-0 grid list-none gap-1 p-0">
          {options.map((o) => (
            <li key={o} className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-fio py-2">
              <span className="min-w-0 flex-1 text-texto-forte">{o}</span>
              <button type="button" className="btn-sec" aria-label={tr(`Usar: ${o}`, `Use: ${o}`)} onClick={() => choose(o)}>{tr("Usar", "Use")}</button>
            </li>
          ))}
        </ul>
      )}
      {outdated && options.length > 0 && <p className="ajuda m-0">{tr("Conferidas com a última versão salva; salvar confere de novo.", "Checked against the last saved version; saving checks again.")}</p>}
    </div>
  );
}
