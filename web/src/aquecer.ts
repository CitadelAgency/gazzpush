// Aquecer a tela do post: quando a pessoa aponta para uma prova (ou toca nela), o que a tela do post vai pedir já vem
// para o cache. Ao abrir, a revisão aparece pronta, sem o esqueleto. As chaves e as funções são as mesmas de Peca,
// Revisao e Publicar: se uma delas mudar, mudar aqui também (senão aquece à toa, sem estragar nada).
import type { QueryClient } from "@tanstack/react-query";
import { api, ler } from "./api";
import { chaves } from "./fila";

const rota = api.t[":tenantId"].pecas[":id"];

/** Status do post e, conforme o estado, a peça completa (revisão) ou o pacote de imagens (aprovado e postado). Falha não faz barulho. */
export async function aquecerPost(qc: QueryClient, tenantId: string, id: string): Promise<void> {
  try {
    const s = await qc.fetchQuery({
      queryKey: chaves.status(tenantId, id),
      queryFn: () => ler(rota.status.$get({ param: { tenantId, id } })),
      staleTime: 20_000,
    });
    if (s.status === "revisao") {
      await qc.prefetchQuery({
        queryKey: [...chaves.peca(tenantId, id), s.versao],
        queryFn: () => ler(rota.$get({ param: { tenantId, id } })),
        staleTime: 30 * 60_000,
      });
    } else if (s.status === "aprovada" || s.status === "agendada" || s.status === "publicada") {
      await qc.prefetchQuery({
        queryKey: [...chaves.peca(tenantId, id), "pacote", s.versao],
        queryFn: () => ler(rota.pacote.$get({ param: { tenantId, id } })),
        staleTime: 12 * 60 * 60_000,
      });
    }
  } catch { /* é só uma tentativa: a tela do post pede de novo e mostra o erro, se houver */ }
}
