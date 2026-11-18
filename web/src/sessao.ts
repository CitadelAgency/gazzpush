// Sessão = GET /api/me (usuário + veículos). 401 é "não entrou", não erro.
import { useQuery } from "@tanstack/react-query";
import { api, corpoJson, ErroApi, ler, type Sucesso } from "./api";
import { ehIdioma, idioma, mudarIdioma, t, type Idioma } from "./idioma";

export type Me = Sucesso<Awaited<ReturnType<typeof api.me.$get>>>;
export type Veiculo = Me["tenants"][number];

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        const me = await ler(api.me.$get());
        // Escolheu na tela de entrar, antes da sessão: essa escolha vale e vai para a conta. Senão, a guardada na conta
        // vale em qualquer aparelho; sem nenhuma, a tela segue este navegador.
        if (escolhaPendente()) {
          esquecerPendente();
          if (me.user.idioma !== idioma()) await guardar(idioma());
          return { ...me, user: { ...me.user, idioma: idioma() } };
        }
        if (ehIdioma(me.user.idioma)) mudarIdioma(me.user.idioma);
        return me;
      } catch (e) {
        if (e instanceof ErroApi && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
  });
}

const guardar = (novo: Idioma) => ler(api.me.idioma.$put({}, corpoJson({ idioma: novo }))).then(() => {}, () => { /* fica neste navegador */ });
const PENDENTE = "redacao:idioma-pendente";
const escolhaPendente = () => { try { return localStorage.getItem(PENDENTE) === "1"; } catch { return false; } };
const esquecerPendente = () => { try { localStorage.removeItem(PENDENTE); } catch { /* modo privado */ } };

/**
 * Troca o idioma das telas agora. Com sessão, guarda na conta; sem sessão (tela de entrar), guarda ao entrar, por cima
 * do que a conta tinha.
 */
export async function escolherIdioma(novo: Idioma, logado: boolean) {
  mudarIdioma(novo);
  if (logado) return guardar(novo);
  try { localStorage.setItem(PENDENTE, "1"); } catch { /* modo privado */ }
}

// Último veículo aberto: a URL é a fonte da verdade; isto só decide para onde "/" leva.
const CHAVE = "redacao:veiculo";
export const lembrarVeiculo = (slug: string) => { try { localStorage.setItem(CHAVE, slug); } catch { /* modo privado */ } };
export const ultimoVeiculo = () => { try { return localStorage.getItem(CHAVE); } catch { return null; } };

export const localDe = (v: Pick<Veiculo, "modo" | "municipio" | "uf">) =>
  v.modo === "tematico" ? t("temático", "topic-based") : v.modo === "autoral" ? t("autor", "author") : [v.municipio, v.uf].filter(Boolean).join(", ");
