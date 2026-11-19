// The outlet's sponsors, on the Brand tab: name, logo and period. The template is what turns the strip on. Only admins change it.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, fileBody, bodyJson, read } from "../api";
import { FailureLoad } from "../common";
import { t as tr } from "../language";
import { Load } from "./outlet/common";

const route = api.t[":tenantId"].patrocinios;
const key = (tenantId: string) => [tenantId, "patrocinios"] as const;

export const useSponsorships = (tenantId: string) => useQuery({ queryKey: key(tenantId), queryFn: () => read(route.$get({ param: { tenantId } })) });
export const summarySponsorships = (n: number | undefined) => (n === undefined ? "" : n ? String(n) : tr("nenhum", "none"));

const data = (d: string) => d.split("-").reverse().join("/");

export function SectionSponsorships({ tenantId, admin }: { tenantId: string; admin: boolean }) {
  const qc = useQueryClient();
  const list = useSponsorships(tenantId);
  const [name, setName] = useState("");
  const [home, setHome] = useState("");
  const [end, setEnd] = useState("");
  const [logo, setLogo] = useState<File | null>(null);
  const [open, openSet] = useState(false);
  const update = () => qc.invalidateQueries({ queryKey: key(tenantId) });
  const create = useMutation({
    mutationFn: async () => {
      const { id } = await read(route.$post({ param: { tenantId } }, bodyJson({ nome: name, inicio: home, fim: end })));
      if (logo) await read(route[":id"].logo.$post({ param: { tenantId, id } }, fileBody(logo)));
    },
    onSuccess: async () => {
      await update();
      setName(""); setHome(""); setEnd(""); setLogo(null); openSet(false);
    },
  });
  const archive = useMutation({ mutationFn: (id: string) => read(route[":id"].$delete({ param: { tenantId, id } })), onSuccess: update });
  if (list.isPending) return <Load oque={tr("os patrocínios", "the sponsors")} />;
  if (list.isError) return <FailureLoad oque={tr("os patrocínios", "the sponsors")} tentar={() => list.refetch()} />;
  const items = list.data.patrocinios;
  return (
    <div className="grid gap-4" onKeyDown={(e) => { if (e.key === "Enter" && e.target instanceof HTMLInputElement) e.preventDefault(); }}>
      <p className="ajuda m-0">{tr("Uma faixa \"Oferecimento\", separada do texto e marcada como publicidade, nos modelos que você escolher. Polícia, publicidade, correção e errata ficam sem faixa.", "A \"Sponsored by\" band, apart from the text and labeled as an ad, on the templates you choose. Police, ads, updates and corrections carry no band.")}</p>
      {items.length === 0 && !open && <p className="m-0">{tr("Nenhum patrocinador ainda.", "No sponsors yet.")}</p>}
      {items.length > 0 && (
        <ul aria-label={tr("Patrocinadores", "Sponsors")} className="m-0 grid list-none gap-0 p-0">
          {items.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-fio py-2.5 first:border-t-0">
              <span className="grid min-w-0 flex-1">
                <b className="text-texto-forte">{p.nome}</b>
                <span className="mono text-[13px] text-apoio">{data(p.inicio)} – {data(p.fim)}{p.temLogo ? "" : tr(" · sem logo", " · no logo")}</span>
              </span>
              {admin && <button type="button" className="btn-sec" disabled={archive.isPending} onClick={() => archive.mutate(p.id)} aria-label={tr(`Arquivar ${p.nome}`, `Archive ${p.nome}`)}>{tr("Arquivar", "Archive")}</button>}
            </li>
          ))}
        </ul>
      )}
      {admin && !open && <p className="m-0"><button type="button" className="btn-sec" onClick={() => openSet(true)}>{tr("Novo patrocinador", "New sponsor")}</button></p>}
      {open && (
        <div className="grid gap-4 border-t border-fio pt-4">
          <label className="campo"><span>{tr("Nome do patrocinador", "Sponsor name")}</span><input className="entrada" maxLength={60} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="campo"><span>{tr("Início", "Start")}</span><input type="date" className="entrada" value={home} onChange={(e) => setHome(e.target.value)} /></label>
            <label className="campo"><span>{tr("Fim", "End")}</span><input type="date" className="entrada" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
          </div>
          <label className="campo"><span>{tr("Logo (PNG ou SVG, até 512 KB)", "Logo (PNG or SVG, up to 512 KB)")}</span><input type="file" accept="image/png,image/svg+xml" onChange={(e) => setLogo(e.target.files?.[0] ?? null)} /></label>
          {create.isError && <p role="alert" className="faixa-erro m-0">{(create.error as Error).message}</p>}
          <p className="m-0 flex flex-wrap gap-3">
            <button type="button" className="btn-tinta" disabled={create.isPending} onClick={() => create.mutate()}>{tr("Salvar o patrocinador", "Save sponsor")}</button>
            <button type="button" className="btn-sec" onClick={() => openSet(false)}>{tr("Cancelar", "Cancel")}</button>
          </p>
        </div>
      )}
      {archive.isError && <p role="alert" className="faixa-erro m-0">{(archive.error as Error).message}</p>}
    </div>
  );
}
