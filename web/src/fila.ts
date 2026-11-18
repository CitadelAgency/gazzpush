// Dados da fila (Ideias, andamento, fontes): consultas com chave começando pelo tenantId. As regras puras moram em
// ./regras e são reexportadas daqui.
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { api, ler, type Sucesso } from "./api";
import { postaSozinho, visitaAnterior } from "./regras";

export * from "./regras";

const t = api.t[":tenantId"];
export type Pauta = Sucesso<Awaited<ReturnType<typeof t.pautas.$get>>>["pautas"][number];
export type PecaFila = Sucesso<Awaited<ReturnType<typeof t.pecas.$get>>>["pecas"][number];
export type StatusPeca = Sucesso<Awaited<ReturnType<(typeof t.pecas)[":id"]["status"]["$get"]>>>;

// ── consultas (chave começa pelo tenantId) ──────────────────────────────────────────────────────────────────────

export const chaves = {
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

/** Ideias: sugeridas e as que voltaram de uma produção que falhou (aceita). Pauta nova chega pelo cron de 15 min. */
// `desde` = visita anterior (fixa enquanto o app está aberto): a API conta o que mudou no banco, além da lista.
const desde = (tenantId: string) => String(visitaAnterior(tenantId) ?? "");

export const usePautas = (tenantId: string) => useQuery({
  queryKey: chaves.pautas(tenantId),
  queryFn: () => ler(t.pautas.$get({ param: { tenantId }, query: { status: "sugerida,aceita", desde: desde(tenantId) } })),
  refetchInterval: 60_000,
});

/** Produzindo e em revisão. Com peça produzindo, a lista acompanha de perto; só em revisão, a cada 30 s. */
export const usePecas = (tenantId: string) => useQuery({
  queryKey: chaves.pecas(tenantId),
  queryFn: () => ler(t.pecas.$get({ param: { tenantId }, query: { status: "rascunho,revisao", desde: desde(tenantId) } })),
  refetchInterval: (q) => (q.state.data?.pecas.some((p) => p.status === "rascunho") ? 5_000 : 30_000),
});

/** Contas ativas para escolher na aprovação (a primeira é a padrão do servidor). Mudam pouco. */
export const useContas = (tenantId: string) => useQuery({
  queryKey: chaves.contas(tenantId),
  queryFn: () => ler(t.contas.$get({ param: { tenantId }, query: { todas: undefined } })),
  staleTime: 5 * 60_000,
});
export type Conta = Sucesso<Awaited<ReturnType<typeof t.contas.$get>>>["contas"][number];

/** Todas as contas, inclusive desligadas (tela do veículo). Mesma raiz de chave: invalidar `[tenantId, "contas"]` pega as duas. */
export const useContasTodas = (tenantId: string) => useQuery({
  queryKey: [...chaves.contas(tenantId), "todas"] as const,
  queryFn: () => ler(t.contas.$get({ param: { tenantId }, query: { todas: "1" } })),
});

/**
 * Prontos para postar: aprovadas e agendadas. Com uma postando sozinha agora, acompanha de perto (sai da lista quando
 * sai no Instagram); senão a cada 30 s (outra pessoa pode postar).
 */
export const useProntos = (tenantId: string) => useQuery({
  queryKey: chaves.prontos(tenantId),
  queryFn: () => ler(t.pecas.$get({ param: { tenantId }, query: { status: "aprovada,agendada", desde: "" } })),
  refetchInterval: (q) => (q.state.data?.pecas.some((p) => p.status === "aprovada" && postaSozinho(p.conta_modo)) ? 5_000 : 30_000),
});

/** Postados, 20 por página, da mais recente. */
export const usePublicacoes = (tenantId: string) => useInfiniteQuery({
  queryKey: chaves.publicacoes(tenantId),
  queryFn: ({ pageParam }) => ler(t.publicacoes.$get({ param: { tenantId }, query: { antes: pageParam } })),
  initialPageParam: undefined as string | undefined,
  getNextPageParam: (ultima) => ultima.proximo ?? undefined,
  // Outra pessoa (ou a conta que posta sozinha) pode pôr um post aqui a qualquer hora: confere a cada minuto. Capas
  // assinadas por 1 h, renovadas junto.
  staleTime: 30_000,
  refetchInterval: 60_000,
});
export type Publicacao = Sucesso<Awaited<ReturnType<typeof t.publicacoes.$get>>>["publicacoes"][number];

/** Andamento leve de um post produzindo (etapa, tentativa), para o card "Em produção" da lateral: 5 s enquanto produz. */
export const useStatusPeca = (tenantId: string, id: string | undefined) => useQuery({
  queryKey: chaves.status(tenantId, id ?? ""),
  queryFn: () => ler(t.pecas[":id"].status.$get({ param: { tenantId, id: id! } })),
  enabled: !!id,
  refetchInterval: (q) => (q.state.data?.status === "rascunho" ? 5_000 : false),
  refetchIntervalInBackground: false,
});

export const useFontes = (tenantId: string) => useQuery({
  queryKey: chaves.fontes(tenantId),
  queryFn: () => ler(t.fontes.$get({ param: { tenantId }, query: { todas: undefined } })),
  refetchInterval: 5 * 60_000,
});
export type Fonte = Sucesso<Awaited<ReturnType<typeof t.fontes.$get>>>["fontes"][number];

/** Todas as fontes, inclusive pausadas (tela do veículo). */
export const useFontesTodas = (tenantId: string) => useQuery({
  queryKey: [...chaves.fontes(tenantId), "todas"] as const,
  queryFn: () => ler(t.fontes.$get({ param: { tenantId }, query: { todas: "1" } })),
});

/** Cobertura (municípios do veículo local). Muda pouco; a aba Fontes invalida ao mexer. */
export const useAreas = (tenantId: string, ligado = true) => useQuery({
  queryKey: chaves.areas(tenantId),
  queryFn: () => ler(t.areas.$get({ param: { tenantId } })),
  staleTime: 5 * 60_000,
  enabled: ligado,
});
export type Area = Sucesso<Awaited<ReturnType<typeof t.areas.$get>>>["areas"][number];

/** Equipe do veículo (nomes e papéis; qualquer membro vê): quem decide, para a revisão e o publicar do repórter. */
export const useMembros = (tenantId: string) => useQuery({
  queryKey: chaves.membros(tenantId),
  queryFn: () => ler(t.membros.$get({ param: { tenantId } })),
  staleTime: 5 * 60_000,
});

// A lista de etapas de ./regras tem de cobrir a da API (src/shell/fila.ts): erro de tipo aqui se divergirem.
export const etapasConferem: [NonNullable<StatusPeca["etapa"]>] extends [import("./regras").Etapa] ? true : never = true;
