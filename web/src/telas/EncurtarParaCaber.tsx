// Ajuste conferido na edição: duas versões mais curtas de uma frase ou do título, já conferidas com o fato. Escolher só
// troca o texto do campo; quem grava é "Salvar e conferir".
import { useMutation } from "@tanstack/react-query";
import { api, corpoJson, ler } from "../api";
import { t as tr } from "../idioma";

const t = api.t[":tenantId"].pecas[":id"];

export function EncurtarParaCaber({ tenantId, pecaId, versao, cardId, frase, desatualizada, escolher }: {
  tenantId: string; pecaId: string; versao: number; cardId: string; frase: number | null; desatualizada: boolean; escolher: (texto: string) => void;
}) {
  const pedir = useMutation({ mutationFn: () => ler(t.ajuste.$post({ param: { tenantId, id: pecaId } }, corpoJson({ versao, cardId, frase }))) });
  const opcoes = pedir.data?.opcoes ?? [];
  return (
    <div className="grid gap-2">
      <p className="m-0">
        <button type="button" className="btn-sec bg-papel" disabled={pedir.isPending} onClick={() => pedir.mutate()}>
          {pedir.isPending ? tr("Encurtando…", "Shortening…") : tr("Encurtar para caber", "Shorten to fit")}
        </button>
      </p>
      {pedir.isError && <p role="alert" className="m-0 text-[15px] text-terracota">{(pedir.error as Error).message}</p>}
      {pedir.isSuccess && !opcoes.length && <p role="status" className="faixa-aviso m-0">{tr("Nenhuma versão passou na conferência. Encurte à mão.", "No version passed the check. Shorten it by hand.")}</p>}
      {opcoes.length > 0 && (
        <ul aria-label={tr("Versões conferidas", "Checked versions")} className="m-0 grid list-none gap-1 p-0">
          {opcoes.map((o) => (
            <li key={o} className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-fio py-2">
              <span className="min-w-0 flex-1 text-texto-forte">{o}</span>
              <button type="button" className="btn-sec" aria-label={tr(`Usar: ${o}`, `Use: ${o}`)} onClick={() => escolher(o)}>{tr("Usar", "Use")}</button>
            </li>
          ))}
        </ul>
      )}
      {desatualizada && opcoes.length > 0 && <p className="ajuda m-0">{tr("Conferidas com a última versão salva; salvar confere de novo.", "Checked against the last saved version; saving checks again.")}</p>}
    </div>
  );
}
