// "/": decide para onde ir (lista de espera, criar o primeiro veículo, ou o último veículo aberto). Instalação própria
// (INSTALACAO_PROPRIA=1 no servidor) não tem lista de espera: sem sessão, vai a /entrar.
import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router";
import { Abertura, FalhaCarga } from "../comum";
import { t } from "../idioma";
import { ultimoVeiculo, useMe } from "../sessao";

/** Pública, antes da sessão. Sem resposta, vale o padrão do gazzpush.com (a lista de espera). */
async function instalacao(): Promise<{ propria: boolean }> {
  const r = await fetch("/api/instalacao").catch(() => null);
  return r?.ok ? r.json() : { propria: false };
}

export function Inicio() {
  const me = useMe();
  const semSessao = me.isSuccess && !me.data;
  const inst = useQuery({ queryKey: ["instalacao"], queryFn: instalacao, enabled: semSessao, staleTime: Infinity });
  if (me.isPending) return <Abertura />;
  if (me.isError) {
    return <main className="mx-auto max-w-[560px] px-5 pt-16"><FalhaCarga oque={t("a sua conta", "your account")}tentar={() => me.refetch()} /></main>;
  }
  if (!me.data) {
    if (inst.isPending) return <Abertura />;
    return <Navigate to={inst.data?.propria ? "/entrar" : "/lista-de-espera"} replace />;
  }
  const veiculos = me.data.tenants;
  if (!veiculos.length) return <Navigate to="/novo" replace />;
  const ultimo = ultimoVeiculo();
  return <Navigate to={`/t/${veiculos.find((v) => v.slug === ultimo)?.slug ?? veiculos[0].slug}`} replace />;
}
