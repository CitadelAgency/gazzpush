// "/": decides where to go (waitlist, create the first outlet, or the last outlet opened). A self-hosted install
// (INSTALACAO_PROPRIA=1 on the server) has no waitlist: without a session, it goes to /entrar.
import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router";
import { Opening, FailureLoad } from "../common";
import { t } from "../language";
import { lastOutlet, useMe } from "../session";

/** Public, before the session. Without an answer, gazzpush.com's default applies (the waitlist). */
async function installation(): Promise<{ propria: boolean }> {
  const r = await fetch("/api/instalacao").catch(() => null);
  return r?.ok ? r.json() : { propria: false };
}

export function Home() {
  const me = useMe();
  const withoutSession = me.isSuccess && !me.data;
  const inst = useQuery({ queryKey: ["instalacao"], queryFn: installation, enabled: withoutSession, staleTime: Infinity });
  if (me.isPending) return <Opening />;
  if (me.isError) {
    return <main className="mx-auto max-w-[560px] px-5 pt-16"><FailureLoad oque={t("a sua conta", "your account")}tentar={() => me.refetch()} /></main>;
  }
  if (!me.data) {
    if (inst.isPending) return <Opening />;
    return <Navigate to={inst.data?.propria ? "/entrar" : "/lista-de-espera"} replace />;
  }
  const outlets = me.data.tenants;
  if (!outlets.length) return <Navigate to="/novo" replace />;
  const last = lastOutlet();
  return <Navigate to={`/t/${outlets.find((v) => v.slug === last)?.slug ?? outlets[0].slug}`} replace />;
}
