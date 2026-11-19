// Warming up the post screen: when the person points at a proof (or taps it), what the post screen will request is
// already fetched into the cache. On open, review appears ready, without the skeleton. The keys and functions are the
// same as Piece, Review and Publish: if one of them changes, change it here too (otherwise it warms up for nothing,
// without breaking anything).
import type { QueryClient } from "@tanstack/react-query";
import { api, read } from "./api";
import { keys } from "./queue";

const route = api.t[":tenantId"].pecas[":id"];

/** The post's status and, depending on its state, the full piece (review) or the image package (approved and posted). A failure makes no noise. */
export async function warmPost(qc: QueryClient, tenantId: string, id: string): Promise<void> {
  try {
    const s = await qc.fetchQuery({
      queryKey: keys.status(tenantId, id),
      queryFn: () => read(route.status.$get({ param: { tenantId, id } })),
      staleTime: 20_000,
    });
    if (s.status === "revisao") {
      await qc.prefetchQuery({
        queryKey: [...keys.peca(tenantId, id), s.versao],
        queryFn: () => read(route.$get({ param: { tenantId, id } })),
        staleTime: 30 * 60_000,
      });
    } else if (s.status === "aprovada" || s.status === "agendada" || s.status === "publicada") {
      await qc.prefetchQuery({
        queryKey: [...keys.peca(tenantId, id), "pacote", s.versao],
        queryFn: () => read(route.pacote.$get({ param: { tenantId, id } })),
        staleTime: 12 * 60 * 60_000,
      });
    }
  } catch { /* only an attempt: the post screen asks again and shows the error, if any */ }
}
