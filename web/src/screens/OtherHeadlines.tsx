// Checked hook while editing the cover: three headlines from different angles, already checked against the facts.
// Choosing swaps the card's title; "Save and check" is what stores it, through the usual path.
import { useMutation } from "@tanstack/react-query";
import { api, bodyJson, read } from "../api";
import { t as tr } from "../language";

const t = api.t[":tenantId"].pecas[":id"];

const ANGLE_NAME = (): Record<string, string> => ({
  numero: tr("Número", "Number"), consequencia: tr("Consequência", "Consequence"), servico: tr("Serviço", "Service"),
  tese: tr("Tese", "Thesis"), exemplo: tr("Exemplo", "Example"), pergunta: tr("Pergunta", "Question"),
});

export function OtherHeadlines({ tenantId, pecaId: pieceId, versao: version, desatualizada: outdated, escolher: choose }: {
  tenantId: string; pecaId: string; versao: number; desatualizada: boolean; escolher: (title: string) => void;
}) {
  const request = useMutation({ mutationFn: () => read(t.ganchos.$post({ param: { tenantId, id: pieceId } }, bodyJson({ versao: version }))) });
  const options = request.data?.opcoes ?? [];
  return (
    <div className="grid gap-2">
      <p className="m-0 flex flex-wrap items-center gap-3">
        <button type="button" className="btn-sec bg-papel-2" disabled={request.isPending} onClick={() => request.mutate()}>
          {request.isPending ? tr("Conferindo as manchetes…", "Checking the headlines…") : tr("Ver outras manchetes", "See other headlines")}
        </button>
        <span className="ajuda">{tr("Três ângulos, conferidos com os fatos da pauta.", "Three angles, checked against the facts of the idea.")}</span>
      </p>
      {request.isError && <p role="alert" className="m-0 text-[15px] text-terracota">{(request.error as Error).message}</p>}
      {request.isSuccess && !options.length && <p role="status" className="faixa-aviso m-0">{tr("Nenhuma manchete passou na conferência. Fica a que está, ou escreva outra.", "No headline passed the check. Keep the current one, or write another.")}</p>}
      {options.length > 0 && (
        <ul aria-label={tr("Manchetes conferidas", "Checked headlines")} className="m-0 grid list-none gap-1 p-0">
          {options.map((o) => (
            <li key={o.titulo} className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-fio py-2">
              <span className="min-w-0 flex-1"><span className="mono block text-apoio">{ANGLE_NAME()[o.angulo] ?? o.angulo}</span><b className="text-texto-forte">{o.titulo}</b></span>
              <button type="button" className="btn-sec" aria-label={tr(`Usar: ${o.titulo}`, `Use: ${o.titulo}`)} onClick={() => choose(o.titulo)}>{tr("Usar", "Use")}</button>
            </li>
          ))}
        </ul>
      )}
      {outdated && options.length > 0 && <p className="ajuda m-0">{tr("Conferidas com a última versão salva; salvar confere de novo.", "Checked against the last saved version; saving checks again.")}</p>}
    </div>
  );
}
