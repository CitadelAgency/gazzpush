// Session = GET /api/me (user + outlets). 401 means "not signed in", not an error.
import { useQuery } from "@tanstack/react-query";
import { api, bodyJson, ApiError, read, type Success } from "./api";
import { isLanguage, language, changeLanguage, t, type Language } from "./language";

export type Me = Success<Awaited<ReturnType<typeof api.me.$get>>>;
export type Outlet = Me["tenants"][number];

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        const me = await read(api.me.$get());
        // Chosen on the sign-in screen, before the session: that choice counts and goes to the account. Otherwise, the one
        // stored on the account counts on any device; with neither, the screen follows this browser.
        if (pendingChoice()) {
          pendingForget();
          if (me.user.idioma !== language()) await save(language());
          return { ...me, user: { ...me.user, idioma: language() } };
        }
        if (isLanguage(me.user.idioma)) changeLanguage(me.user.idioma);
        return me;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
  });
}

const save = (created: Language) => read(api.me.idioma.$put({}, bodyJson({ idioma: created }))).then(() => {}, () => { /* stays in this browser */ });
const PENDING = "redacao:idioma-pendente";
const pendingChoice = () => { try { return localStorage.getItem(PENDING) === "1"; } catch { return false; } };
const pendingForget = () => { try { localStorage.removeItem(PENDING); } catch { /* modo privado */ } };

/**
 * Switches the screen language now. With a session, stores it on the account; without one (sign-in screen), stores it
 * on sign-in, over what the account had.
 */
export async function chooseLanguage(created: Language, signedIn: boolean) {
  changeLanguage(created);
  if (signedIn) return save(created);
  try { localStorage.setItem(PENDING, "1"); } catch { /* modo privado */ }
}

// Last outlet opened: the URL is the source of truth; this only decides where "/" leads.
const KEY = "redacao:veiculo";
export const rememberOutlet = (slug: string) => { try { localStorage.setItem(KEY, slug); } catch { /* modo privado */ } };
export const lastOutlet = () => { try { return localStorage.getItem(KEY); } catch { return null; } };

export const localOf = (v: Pick<Outlet, "modo" | "municipio" | "uf">) =>
  v.modo === "tematico" ? t("temático", "topic-based") : v.modo === "autoral" ? t("autor", "author") : [v.municipio, v.uf].filter(Boolean).join(", ");
