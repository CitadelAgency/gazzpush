// Queue data (Ideas, progress, sources): queries whose keys start with the tenantId. The pure rules live in ./rules and
// are re-exported from here.
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { api, read, type Success } from "./api";
import { alonePosts, previousVisit } from "./rules";

export * from "./rules";

const t = api.t[":tenantId"];
export type Lead = Success<Awaited<ReturnType<typeof t.pautas.$get>>>["pautas"][number];
export type PieceQueue = Success<Awaited<ReturnType<typeof t.pecas.$get>>>["pecas"][number];
export type PieceStatus = Success<Awaited<ReturnType<(typeof t.pecas)[":id"]["status"]["$get"]>>>;

// ── queries (key starts with the tenantId) ──────────────────────────────────────────────────────────────────────

export const keys = {
  pautas: (tenantId: string) => [tenantId, "pautas", "fila"] as const,
  pecas: (tenantId: string) => [tenantId, "pecas", "andamento"] as const,
  fontes: (tenantId: string) => [tenantId, "fontes"] as const,
  status: (tenantId: string, id: string) => [tenantId, "peca", id, "status"] as const,
  peca: (tenantId: string, id: string) => [tenantId, "peca", id] as const,
  contas: (tenantId: string) => [tenantId, "contas"] as const,
  prontos: (tenantId: string) => [tenantId, "pecas", "prontos"] as const,
  publicacoes: (tenantId: string) => [tenantId, "publicacoes"] as const,
  areas: (tenantId: string) => [tenantId, "areas"] as const,
  membros: (tenantId: string) => [tenantId, "membros"] as const,
};

/** Ideas: suggested ones and those that came back from a failed production (aceita). New leads arrive through the 15-min cron. */
// `desde` = the previous visit (fixed while the app is open): the API counts what changed in the database, besides the list.
const since = (tenantId: string) => String(previousVisit(tenantId) ?? "");

export const useLeads = (tenantId: string) => useQuery({
  queryKey: keys.pautas(tenantId),
  queryFn: () => read(t.pautas.$get({ param: { tenantId }, query: { status: "sugerida,aceita", desde: since(tenantId) } })),
  refetchInterval: 60_000,
});

/** Producing and in review. With a piece producing, the list follows closely; only in review, every 30 s. */
export const usePieces = (tenantId: string) => useQuery({
  queryKey: keys.pecas(tenantId),
  queryFn: () => read(t.pecas.$get({ param: { tenantId }, query: { status: "rascunho,revisao", desde: since(tenantId) } })),
  refetchInterval: (q) => (q.state.data?.pecas.some((p) => p.status === "rascunho") ? 5_000 : 30_000),
});

/** Active accounts to choose from at approval (the first is the server's default). They change little. */
export const useAccounts = (tenantId: string) => useQuery({
  queryKey: keys.contas(tenantId),
  queryFn: () => read(t.contas.$get({ param: { tenantId }, query: { todas: undefined } })),
  staleTime: 5 * 60_000,
});
export type Account = Success<Awaited<ReturnType<typeof t.contas.$get>>>["contas"][number];

/** All accounts, including disabled ones (outlet screen). Same key root: invalidating `[tenantId, "contas"]` hits both. */
export const useAccountsAll = (tenantId: string) => useQuery({
  queryKey: [...keys.contas(tenantId), "todas"] as const,
  queryFn: () => read(t.contas.$get({ param: { tenantId }, query: { todas: "1" } })),
});

/**
 * Ready to post: approved and scheduled. With one posting by itself right now, it follows closely (it leaves the list
 * when it is out on Instagram); otherwise every 30 s (someone else may post).
 */
export const readyUse = (tenantId: string) => useQuery({
  queryKey: keys.prontos(tenantId),
  queryFn: () => read(t.pecas.$get({ param: { tenantId }, query: { status: "aprovada,agendada", desde: "" } })),
  refetchInterval: (q) => (q.state.data?.pecas.some((p) => p.status === "aprovada" && alonePosts(p.conta_modo)) ? 5_000 : 30_000),
});

/** Posted, 20 per page, most recent first. */
export const usePublications = (tenantId: string) => useInfiniteQuery({
  queryKey: keys.publicacoes(tenantId),
  queryFn: ({ pageParam }) => read(t.publicacoes.$get({ param: { tenantId }, query: { antes: pageParam } })),
  initialPageParam: undefined as string | undefined,
  getNextPageParam: (last) => last.proximo ?? undefined,
  // Someone else (or the account that posts by itself) can put a post here at any time: it checks every minute. Covers
  // signed for 1 h, renewed along with it.
  staleTime: 30_000,
  refetchInterval: 60_000,
});
export type Publication = Success<Awaited<ReturnType<typeof t.publicacoes.$get>>>["publicacoes"][number];

/** Light progress of a producing post (step, attempt), for the sidebar's "In production" card: every 5 s while it produces. */
export const useStatusPiece = (tenantId: string, id: string | undefined) => useQuery({
  queryKey: keys.status(tenantId, id ?? ""),
  queryFn: () => read(t.pecas[":id"].status.$get({ param: { tenantId, id: id! } })),
  enabled: !!id,
  refetchInterval: (q) => (q.state.data?.status === "rascunho" ? 5_000 : false),
  refetchIntervalInBackground: false,
});

export const useSources = (tenantId: string) => useQuery({
  queryKey: keys.fontes(tenantId),
  queryFn: () => read(t.fontes.$get({ param: { tenantId }, query: { todas: undefined } })),
  refetchInterval: 5 * 60_000,
});
export type Source = Success<Awaited<ReturnType<typeof t.fontes.$get>>>["fontes"][number];

/** All sources, including paused ones (outlet screen). */
export const useSourcesAll = (tenantId: string) => useQuery({
  queryKey: [...keys.fontes(tenantId), "todas"] as const,
  queryFn: () => read(t.fontes.$get({ param: { tenantId }, query: { todas: "1" } })),
});

/** Coverage (the local outlet's municipalities). Changes little; the Sources tab invalidates it on change. */
export const useAreas = (tenantId: string, on = true) => useQuery({
  queryKey: keys.areas(tenantId),
  queryFn: () => read(t.areas.$get({ param: { tenantId } })),
  staleTime: 5 * 60_000,
  enabled: on,
});
export type Area = Success<Awaited<ReturnType<typeof t.areas.$get>>>["areas"][number];

/** The outlet's team (names and roles; any member sees it): who decides, for the reporter's review and publish. */
export const useMembers = (tenantId: string) => useQuery({
  queryKey: keys.membros(tenantId),
  queryFn: () => read(t.membros.$get({ param: { tenantId } })),
  staleTime: 5 * 60_000,
});

// The list of steps in ./rules must cover the API's (src/shell/queue.ts): a type error here if they diverge.
export const stepsCheck: [NonNullable<PieceStatus["etapa"]>] extends [import("./rules").Step] ? true : never = true;
