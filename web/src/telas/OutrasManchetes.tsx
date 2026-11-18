// Gancho conferido na edição da capa: três manchetes de ângulos diferentes, já conferidas com os fatos. Escolher troca o
// título do card; quem grava é "Salvar e conferir", pelo caminho de sempre.
import { useMutation } from "@tanstack/react-query";
import { api, corpoJson, ler } from "../api";
import { t as tr } from "../idioma";

const t = api.t[":tenantId"].pecas[":id"];

const NOME_ANGULO = (): Record<string, string> => ({
  numero: tr("Número", "Number"), consequencia: tr("Consequência", "Consequence"), servico: tr("Serviço", "Service"),
  tese: tr("Tese", "Thesis"), exemplo: tr("Exemplo", "Example"), pergunta: tr("Pergunta", "Question"),
});

export function OutrasManchetes({ tenantId, pecaId, versao, desatualizada, escolher }: {
  tenantId: string; pecaId: string; versao: number; desatualizada: boolean; escolher: (titulo: string) => void;
}) {
  const pedir = useMutation({ mutationFn: () => ler(t.ganchos.$post({ param: { tenantId, id: pecaId } }, corpoJson({ versao }))) });
  const opcoes = pedir.data?.opcoes ?? [];
  return (
    <div className="grid gap-2">
      <p className="m-0 flex flex-wrap items-center gap-3">
        <button type="button" className="btn-sec bg-papel-2" disabled={pedir.isPending} onClick={() => pedir.mutate()}>
          {pedir.isPending ? tr("Conferindo as manchetes…", "Checking the headlines…") : tr("Ver outras manchetes", "See other headlines")}
        </button>
        <span className="ajuda">{tr("Três ângulos, conferidos com os fatos da pauta.", "Three angles, checked against the facts of the idea.")}</span>
      </p>
      {pedir.isError && <p role="alert" className="m-0 text-[15px] text-terracota">{(pedir.error as Error).message}</p>}
      {pedir.isSuccess && !opcoes.length && <p role="status" className="faixa-aviso m-0">{tr("Nenhuma manchete passou na conferência. Fica a que está, ou escreva outra.", "No headline passed the check. Keep the current one, or write another.")}</p>}
      {opcoes.length > 0 && (
        <ul aria-label={tr("Manchetes conferidas", "Checked headlines")} className="m-0 grid list-none gap-1 p-0">
          {opcoes.map((o) => (
            <li key={o.titulo} className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-fio py-2">
              <span className="min-w-0 flex-1"><span className="mono block text-apoio">{NOME_ANGULO()[o.angulo] ?? o.angulo}</span><b className="text-texto-forte">{o.titulo}</b></span>
              <button type="button" className="btn-sec" aria-label={tr(`Usar: ${o.titulo}`, `Use: ${o.titulo}`)} onClick={() => escolher(o.titulo)}>{tr("Usar", "Use")}</button>
            </li>
          ))}
        </ul>
      )}
      {desatualizada && opcoes.length > 0 && <p className="ajuda m-0">{tr("Conferidas com a última versão salva; salvar confere de novo.", "Checked against the last saved version; saving checks again.")}</p>}
    </div>
  );
}
