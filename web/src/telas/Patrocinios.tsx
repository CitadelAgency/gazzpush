// Patrocinadores do veículo, na aba Marca: nome, logo e período. Quem liga a faixa é o modelo. Só o admin altera.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, corpoArquivo, corpoJson, ler } from "../api";
import { FalhaCarga } from "../comum";
import { t as tr } from "../idioma";
import { Carga } from "./veiculo/comum";

const rota = api.t[":tenantId"].patrocinios;
const chave = (tenantId: string) => [tenantId, "patrocinios"] as const;

export const usePatrocinios = (tenantId: string) => useQuery({ queryKey: chave(tenantId), queryFn: () => ler(rota.$get({ param: { tenantId } })) });
export const resumoPatrocinios = (n: number | undefined) => (n === undefined ? "" : n ? String(n) : tr("nenhum", "none"));

const data = (d: string) => d.split("-").reverse().join("/");

export function SecaoPatrocinios({ tenantId, admin }: { tenantId: string; admin: boolean }) {
  const qc = useQueryClient();
  const lista = usePatrocinios(tenantId);
  const [nome, setNome] = useState("");
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [logo, setLogo] = useState<File | null>(null);
  const [aberto, setAberto] = useState(false);
  const atualizar = () => qc.invalidateQueries({ queryKey: chave(tenantId) });
  const criar = useMutation({
    mutationFn: async () => {
      const { id } = await ler(rota.$post({ param: { tenantId } }, corpoJson({ nome, inicio, fim })));
      if (logo) await ler(rota[":id"].logo.$post({ param: { tenantId, id } }, corpoArquivo(logo)));
    },
    onSuccess: async () => {
      await atualizar();
      setNome(""); setInicio(""); setFim(""); setLogo(null); setAberto(false);
    },
  });
  const arquivar = useMutation({ mutationFn: (id: string) => ler(rota[":id"].$delete({ param: { tenantId, id } })), onSuccess: atualizar });
  if (lista.isPending) return <Carga oque={tr("os patrocínios", "the sponsors")} />;
  if (lista.isError) return <FalhaCarga oque={tr("os patrocínios", "the sponsors")} tentar={() => lista.refetch()} />;
  const itens = lista.data.patrocinios;
  return (
    <div className="grid gap-4" onKeyDown={(e) => { if (e.key === "Enter" && e.target instanceof HTMLInputElement) e.preventDefault(); }}>
      <p className="ajuda m-0">{tr("Uma faixa \"Oferecimento\", separada do texto e marcada como publicidade, nos modelos que você escolher. Polícia, publicidade, correção e errata ficam sem faixa.", "A \"Sponsored by\" band, apart from the text and labeled as an ad, on the templates you choose. Police, ads, updates and corrections carry no band.")}</p>
      {itens.length === 0 && !aberto && <p className="m-0">{tr("Nenhum patrocinador ainda.", "No sponsors yet.")}</p>}
      {itens.length > 0 && (
        <ul aria-label={tr("Patrocinadores", "Sponsors")} className="m-0 grid list-none gap-0 p-0">
          {itens.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-fio py-2.5 first:border-t-0">
              <span className="grid min-w-0 flex-1">
                <b className="text-texto-forte">{p.nome}</b>
                <span className="mono text-[13px] text-apoio">{data(p.inicio)} – {data(p.fim)}{p.temLogo ? "" : tr(" · sem logo", " · no logo")}</span>
              </span>
              {admin && <button type="button" className="btn-sec" disabled={arquivar.isPending} onClick={() => arquivar.mutate(p.id)} aria-label={tr(`Arquivar ${p.nome}`, `Archive ${p.nome}`)}>{tr("Arquivar", "Archive")}</button>}
            </li>
          ))}
        </ul>
      )}
      {admin && !aberto && <p className="m-0"><button type="button" className="btn-sec" onClick={() => setAberto(true)}>{tr("Novo patrocinador", "New sponsor")}</button></p>}
      {aberto && (
        <div className="grid gap-4 border-t border-fio pt-4">
          <label className="campo"><span>{tr("Nome do patrocinador", "Sponsor name")}</span><input className="entrada" maxLength={60} autoComplete="off" value={nome} onChange={(e) => setNome(e.target.value)} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="campo"><span>{tr("Início", "Start")}</span><input type="date" className="entrada" value={inicio} onChange={(e) => setInicio(e.target.value)} /></label>
            <label className="campo"><span>{tr("Fim", "End")}</span><input type="date" className="entrada" value={fim} onChange={(e) => setFim(e.target.value)} /></label>
          </div>
          <label className="campo"><span>{tr("Logo (PNG ou SVG, até 512 KB)", "Logo (PNG or SVG, up to 512 KB)")}</span><input type="file" accept="image/png,image/svg+xml" onChange={(e) => setLogo(e.target.files?.[0] ?? null)} /></label>
          {criar.isError && <p role="alert" className="faixa-erro m-0">{(criar.error as Error).message}</p>}
          <p className="m-0 flex flex-wrap gap-3">
            <button type="button" className="btn-tinta" disabled={criar.isPending} onClick={() => criar.mutate()}>{tr("Salvar o patrocinador", "Save sponsor")}</button>
            <button type="button" className="btn-sec" onClick={() => setAberto(false)}>{tr("Cancelar", "Cancel")}</button>
          </p>
        </div>
      )}
      {arquivar.isError && <p role="alert" className="faixa-erro m-0">{(arquivar.error as Error).message}</p>}
    </div>
  );
}
