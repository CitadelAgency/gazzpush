// API client: Hono RPC (the Worker's types, `import type` only) and the Better Auth routes, which are outside AppType.
import { hc } from "hono/client";
import type { AppType } from "../../src/shell/api";
import { language, t } from "./language";

/** Every request states the screen's language: the server answers its error messages in it. */
export const headerLanguage = () => ({ "x-idioma": language() });
// Through the client's `fetch`, not the `headers` option: `headers` as a function puts an `await` before every request,
// and the order between requests and React Query invalidations changes (a freshly opened query was cancelled and
// requested again). It also covers `init.headers` (bodyJson, fileBody), which replace the client's headers.
const withLanguage: typeof fetch = (input, init) => {
  const h = new Headers(init?.headers);
  if (!h.has("x-idioma")) h.set("x-idioma", language());
  return fetch(input, { ...init, headers: h });
};
export const api = hc<AppType>(`${location.origin}/api`, { fetch: withLanguage });

export class ApiError extends Error {
  /** `dados`: the whole body of the error response (e.g. the desk receives what changed in Google Docs in `mudancas`). */
  constructor(public status: number, message: string, public codigo?: string, public dados?: unknown) {
    super(message);
  }
}

type Payload<R> = R extends { json(): Promise<infer J> } ? J : never;
/** Success body: the API's error responses are all `{ erro }`. */
export type Success<R> = Exclude<Payload<R>, { erro: string }>;

/** Reads the response; an HTTP error becomes ApiError with the server's message, a dropped network becomes status 0. */
export async function read<R extends { ok: boolean; status: number; json(): Promise<unknown> }>(p: Promise<R>): Promise<Success<R>> {
  let res: R;
  try {
    res = await p;
  } catch {
    throw new ApiError(0, t("Sem conexão com o servidor.", "No connection to the server."));
  }
  const body = (await res.json().catch(() => null)) as { erro?: string; code?: string; message?: string } | null;
  if (!res.ok) throw new ApiError(res.status, body?.erro ?? body?.message ?? `Erro ${res.status}`, body?.code, body);
  return body as Success<R>;
}

// ── Better Auth ─────────────────────────────────────────────────────────────────────────────────────────────────
// Messages come in English: translate by code, never by text (docs/HANDOFF-ui.md §7).
const authErrors = (): Record<string, string> => ({
  INVALID_EMAIL_OR_PASSWORD: t("E-mail ou senha não conferem.", "The email or password is wrong."),
  INVALID_EMAIL: t("Esse e-mail não parece válido.", "That email doesn't look valid."),
  INVALID_PASSWORD: t("Senha incorreta.", "Wrong password."),
  PASSWORD_TOO_SHORT: t("A senha precisa de pelo menos 10 caracteres.", "The password needs at least 10 characters."),
  PASSWORD_TOO_LONG: t("Senha longa demais.", "The password is too long."),
  USER_ALREADY_EXISTS: t("Já existe uma conta com esse e-mail. Entre com ela.", "There is already an account with that email. Sign in with it."),
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: t("Já existe uma conta com esse e-mail. Entre com ela.", "There is already an account with that email. Sign in with it."),
  FAILED_TO_CREATE_USER: t("Não deu para criar a conta agora. Tente de novo.", "Couldn't create the account right now. Try again."),
});

export function authMessage(e: unknown): string {
  const errors = authErrors();
  if (e instanceof ApiError) {
    if (e.codigo && errors[e.codigo]) return errors[e.codigo];
    if (e.status === 0) return t("Sem conexão. Confira a internet e tente de novo.", "No connection. Check the internet and try again.");
    if (e.status === 429) return t("Muitas tentativas seguidas. Espere um minuto e tente de novo.", "Too many attempts in a row. Wait a minute and try again.");
    if (e.status === 401) return errors.INVALID_EMAIL_OR_PASSWORD;
  }
  return t("Não deu certo agora. Tente de novo.", "That didn't work. Try again.");
}

const auth = (route: string, body: unknown) =>
  read(fetch(`/api/auth/${route}`, { method: "POST", headers: { "content-type": "application/json", ...headerLanguage() }, body: JSON.stringify(body) }));

export const signIn = (email: string, password: string) => auth("sign-in/email", { email, password });
export const createAccount = (name: string, email: string, password: string) => auth("sign-up/email", { name, email, password });
export const signOut = () => auth("sign-out", {});

/** Accept a team invite (session + the link's id + an email equal to the invited one). */
export const acceptInvite = (id: string) => read(api.convites[":id"].aceitar.$post({ param: { id } }));

/** A raw body for routes without a validator (AppType does not describe their input): JSON or a file. */
/** Public, no session. `site` is the bot honeypot: empty for whoever uses the screen. */
export const signInInList = (d: { email: string; nome: string; plano: string; site: string }) =>
  read(fetch("/api/lista-espera", { method: "POST", headers: { "content-type": "application/json", ...headerLanguage() }, body: JSON.stringify(d) }));

export const bodyJson = (data: unknown) => ({ init: { body: JSON.stringify(data), headers: { "content-type": "application/json" } } });
export const fileBody = (file: Blob) => ({ init: { body: file, headers: { "content-type": file.type } } });
