// Cliente da API: Hono RPC (tipos do Worker, só `import type`) e as rotas do Better Auth, que ficam fora do AppType.
import { hc } from "hono/client";
import type { AppType } from "../../src/shell/api";
import { idioma, t } from "./idioma";

/** Todo pedido diz o idioma da tela: o servidor responde as mensagens de erro nele. */
export const cabecalhoIdioma = () => ({ "x-idioma": idioma() });
// Pelo `fetch` do cliente, não pela opção `headers`: `headers` como função põe um `await` antes de cada pedido, e a
// ordem entre pedidos e invalidações do React Query muda (uma consulta recém-aberta era cancelada e pedida de novo).
// Aqui vale também para `init.headers` (corpoJson, corpoArquivo), que tomam o lugar dos cabeçalhos do cliente.
const comIdioma: typeof fetch = (entrada, init) => {
  const h = new Headers(init?.headers);
  if (!h.has("x-idioma")) h.set("x-idioma", idioma());
  return fetch(entrada, { ...init, headers: h });
};
export const api = hc<AppType>(`${location.origin}/api`, { fetch: comIdioma });

export class ErroApi extends Error {
  /** `dados`: o corpo inteiro da resposta de erro (ex.: a mesa recebe em `mudancas` o que mudou no Google Docs). */
  constructor(public status: number, message: string, public codigo?: string, public dados?: unknown) {
    super(message);
  }
}

type Corpo<R> = R extends { json(): Promise<infer J> } ? J : never;
/** Corpo de sucesso: as respostas de erro da API são todas `{ erro }`. */
export type Sucesso<R> = Exclude<Corpo<R>, { erro: string }>;

/** Lê a resposta; erro HTTP vira ErroApi com a mensagem do servidor, rede caída vira status 0. */
export async function ler<R extends { ok: boolean; status: number; json(): Promise<unknown> }>(p: Promise<R>): Promise<Sucesso<R>> {
  let res: R;
  try {
    res = await p;
  } catch {
    throw new ErroApi(0, t("Sem conexão com o servidor.", "No connection to the server."));
  }
  const corpo = (await res.json().catch(() => null)) as { erro?: string; code?: string; message?: string } | null;
  if (!res.ok) throw new ErroApi(res.status, corpo?.erro ?? corpo?.message ?? `Erro ${res.status}`, corpo?.code, corpo);
  return corpo as Sucesso<R>;
}

// ── Better Auth ─────────────────────────────────────────────────────────────────────────────────────────────────
// Mensagens vêm em inglês: traduz pelo código, nunca pelo texto (docs/HANDOFF-ui.md §7).
const errosAuth = (): Record<string, string> => ({
  INVALID_EMAIL_OR_PASSWORD: t("E-mail ou senha não conferem.", "The email or password is wrong."),
  INVALID_EMAIL: t("Esse e-mail não parece válido.", "That email doesn't look valid."),
  INVALID_PASSWORD: t("Senha incorreta.", "Wrong password."),
  PASSWORD_TOO_SHORT: t("A senha precisa de pelo menos 10 caracteres.", "The password needs at least 10 characters."),
  PASSWORD_TOO_LONG: t("Senha longa demais.", "The password is too long."),
  USER_ALREADY_EXISTS: t("Já existe uma conta com esse e-mail. Entre com ela.", "There is already an account with that email. Sign in with it."),
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: t("Já existe uma conta com esse e-mail. Entre com ela.", "There is already an account with that email. Sign in with it."),
  FAILED_TO_CREATE_USER: t("Não deu para criar a conta agora. Tente de novo.", "Couldn't create the account right now. Try again."),
});

export function mensagemAuth(e: unknown): string {
  const erros = errosAuth();
  if (e instanceof ErroApi) {
    if (e.codigo && erros[e.codigo]) return erros[e.codigo];
    if (e.status === 0) return t("Sem conexão. Confira a internet e tente de novo.", "No connection. Check the internet and try again.");
    if (e.status === 429) return t("Muitas tentativas seguidas. Espere um minuto e tente de novo.", "Too many attempts in a row. Wait a minute and try again.");
    if (e.status === 401) return erros.INVALID_EMAIL_OR_PASSWORD;
  }
  return t("Não deu certo agora. Tente de novo.", "That didn't work. Try again.");
}

const auth = (rota: string, corpo: unknown) =>
  ler(fetch(`/api/auth/${rota}`, { method: "POST", headers: { "content-type": "application/json", ...cabecalhoIdioma() }, body: JSON.stringify(corpo) }));

export const entrar = (email: string, password: string) => auth("sign-in/email", { email, password });
export const criarConta = (name: string, email: string, password: string) => auth("sign-up/email", { name, email, password });
export const sair = () => auth("sign-out", {});

/** Aceitar um convite de equipe (sessão + id do link + e-mail igual ao convidado). */
export const aceitarConvite = (id: string) => ler(api.convites[":id"].aceitar.$post({ param: { id } }));

/** Corpo cru para rotas sem validador (o AppType não descreve a entrada delas): JSON ou arquivo. */
/** Pública, sem sessão. `site` é a isca para robô: vazio para quem usa a tela. */
export const entrarNaLista = (d: { email: string; nome: string; plano: string; site: string }) =>
  ler(fetch("/api/lista-espera", { method: "POST", headers: { "content-type": "application/json", ...cabecalhoIdioma() }, body: JSON.stringify(d) }));

export const corpoJson = (dados: unknown) => ({ init: { body: JSON.stringify(dados), headers: { "content-type": "application/json" } } });
export const corpoArquivo = (arquivo: Blob) => ({ init: { body: arquivo, headers: { "content-type": arquivo.type } } });
