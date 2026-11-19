// Sign in and create an account on the same sheet (email and password; Google postponed by the owner on 31/10).
import { useState, type FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { acceptInvite, createAccount, signIn, ApiError, read, authMessage } from "../api";
import { Opening, useTitle } from "../common";
import { t } from "../language";
import DemoProof from "../kit/ProofDemo";
import PromiseCard from "../kit/PromiseCard";
import { useMe } from "../session";

// Internal paths only: "//other.site" and "https://…" become "/".
const targetSafe = (from: string | null) => (from && from.startsWith("/") && !from.startsWith("//") ? from : "/");

type Invite = { email: string; papel: string; veiculo: string; slug: string; aceito: boolean };
const ROLE: Record<string, string> = { editor: "editor", get reporter() { return t("repórter", "reporter"); } };

export default function SignIn() {
  const [params] = useSearchParams();
  const inviteId = params.get("convite");
  // Team invite: opens on "Create account" with the invited email; on creating, the account already joins the outlet.
  const invite = useQuery({
    queryKey: ["convite", inviteId],
    queryFn: () => read(fetch(`/api/convites/${encodeURIComponent(inviteId!)}`)) as Promise<Invite>,
    enabled: !!inviteId,
    retry: false,
    staleTime: Infinity,
  });
  const [mode, setMode] = useState<"entrar" | "criar">(inviteId ? "criar" : "entrar");
  const create = mode === "criar";
  useTitle(create ? t("Criar conta", "Create account") : t("Entrar", "Sign in"));
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const target = targetSafe(params.get("de"));

  const upload = useMutation({
    mutationFn: async (d: { nome: string; email: string; senha: string }) => {
      await (create ? createAccount(d.nome, d.email, d.senha) : signIn(d.email, d.senha));
      // With an invite: accepting requires the session, the link's id and the same email as the invited one. Refused (another
      // email) or gone, the person signs in anyway, and the screen tells them.
      if (inviteId) {
        try {
          const r = await acceptInvite(inviteId);
          return `/t/${r.slug}`;
        } catch (e) {
          setWarningInvite(e instanceof ApiError && e.status === 403
            ? t("Esse convite é para outro e-mail: você entrou, mas não no veículo convidado.", "This invite is for another email: you're signed in, but not to the publication you were invited to.")
            : t("Esse convite não existe mais: você entrou, mas não no veículo convidado.", "This invite no longer exists: you're signed in, but not to the publication you were invited to."));
        }
      }
      return target;
    },
    onSuccess: async (to) => {
      await qc.invalidateQueries({ queryKey: ["me"] });
      navigate(to, { replace: true });
    },
  });
  const [inviteWarning, setWarningInvite] = useState<string | null>(null);

  if (me.isPending) return <Opening />;
  if (me.data && !upload.isPending && !upload.isSuccess) return <Navigate to={target} replace />;

  function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    upload.mutate({ nome: String(f.get("nome") ?? "").trim(), email: String(f.get("email") ?? "").trim(), senha: String(f.get("senha") ?? "") });
  }

  function swap() {
    upload.reset();
    setMode(create ? "entrar" : "criar");
  }

  return (
    <main id="conteudo" className="mx-auto grid min-h-dvh max-w-[1120px] content-start gap-8 px-5 pt-6 pb-12 lg:grid-cols-[1fr_440px] lg:content-center lg:gap-x-24 lg:gap-y-6 lg:px-12">
      <PromiseCard />

      <section aria-labelledby="form-titulo" className="folha-entrar grid content-start gap-5 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-center">
        <h2 id="form-titulo" className="titulo-tela text-[26px]">{create ? t("Criar conta", "Create account") : t("Entrar", "Sign in")}</h2>
        {invite.data && (
          <p role="status" className={`m-0 rounded-faixa px-3 py-2.5 text-[15px] ${invite.data.aceito ? "bg-papel-2 text-apoio" : "bg-tinta-clara text-texto-forte"}`}>
            {invite.data.aceito
              ? t(`Esse convite já foi usado. Entre com a sua conta para abrir ${invite.data.veiculo}.`, `This invite has already been used. Sign in to your account to open ${invite.data.veiculo}.`)
              : t(
                <>Você foi convidado para <b>{invite.data.veiculo}</b> como {ROLE[invite.data.papel] ?? invite.data.papel}. {create ? "Crie a conta" : "Entre"} com o e-mail <b>{invite.data.email}</b>.</>,
                <>You were invited to <b>{invite.data.veiculo}</b> as {ROLE[invite.data.papel] ?? invite.data.papel}. {create ? "Create your account" : "Sign in"} with the email <b>{invite.data.email}</b>.</>,
              )}
          </p>
        )}
        {invite.isError && <p role="status" className="m-0 rounded-faixa bg-papel-2 px-3 py-2.5 text-[15px] text-apoio">{t("Esse convite não existe mais. Peça outro a quem convidou.", "This invite no longer exists. Ask the person who invited you for a new one.")}</p>}
        {inviteWarning && <p role="status" className="faixa-aviso m-0">{inviteWarning}</p>}
        <form onSubmit={send} className="grid gap-4" aria-describedby={upload.isError ? "form-erro" : undefined}>
          {create && (
            <label className="campo">
              <span>{t("Seu nome", "Your name")}</span>
              <input name="nome" className="entrada" autoComplete="name" autoCapitalize="words" enterKeyHint="next" required minLength={2} maxLength={80} />
            </label>
          )}
          <label className="campo">
            <span>{t("E-mail", "Email")}</span>
            {/* "username": it is what password managers look for at sign-in; the invite's email goes in the same way. */}
            <input name="email" type="email" className="entrada" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" required inputMode="email"
              key={invite.data?.email ?? "livre"} defaultValue={invite.data && !invite.data.aceito ? invite.data.email : undefined} />
          </label>
          <label className="campo">
            <span>{t("Senha", "Password")}</span>
            <input
              name="senha" type="password" className="entrada" required enterKeyHint="done"
              autoComplete={create ? "new-password" : "current-password"} minLength={create ? 10 : undefined}
              aria-describedby={create ? "senha-ajuda" : undefined}
            />
            {create && <span id="senha-ajuda" className="ajuda">{t("Pelo menos 10 caracteres.", "At least 10 characters.")}</span>}
          </label>
          {upload.isError && <p id="form-erro" role="alert" className="faixa-erro m-0">{authMessage(upload.error)}</p>}
          <button type="submit" className="btn-tinta mt-1 w-full" disabled={upload.isPending}>
            {upload.isPending
              ? (create ? t("Criando a conta…", "Creating your account…") : t("Entrando…", "Signing in…"))
              : create ? (inviteId ? t("Criar conta", "Create account") : t("Criar conta e montar o veículo", "Create account and set up your publication")) : t("Entrar", "Sign in")}
          </button>
          {create && !inviteId && <p className="ajuda m-0 text-center">{t("Leva uns três minutos até o primeiro post.", "It takes about three minutes to get your first post.")}</p>}
        </form>
        <p className="-my-3 m-0 flex items-center gap-1 text-[15px]">
          {create ? t("Já tem conta? ", "Already have an account? ") : t("Ainda não tem conta? ", "Don't have an account yet? ")}
          <button type="button" onClick={swap} className="link-acao inline-flex min-h-11 items-center">{create ? t("Entrar", "Sign in") : t("Criar conta", "Create account")}</button>
        </p>
      </section>

      {/* The promise as an image: on mobile, after the form (which stays in view without scrolling); on desktop, under the title. */}
      <div className="demo-moldura lg:col-start-1 lg:row-start-2"><DemoProof /></div>
    </main>
  );
}
