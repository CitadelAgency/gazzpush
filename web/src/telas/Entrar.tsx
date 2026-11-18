// Entrar e criar conta na mesma folha (e-mail e senha; Google adiado pelo dono em 31/10).
import { useState, type FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { aceitarConvite, criarConta, entrar, ErroApi, ler, mensagemAuth } from "../api";
import { Abertura, useTitulo } from "../comum";
import { t } from "../idioma";
import Promessa from "../kit/Promessa";
import { useMe } from "../sessao";

// Só caminho interno: "//outro.site" e "https://…" viram "/".
const destinoSeguro = (de: string | null) => (de && de.startsWith("/") && !de.startsWith("//") ? de : "/");

type Convite = { email: string; papel: string; veiculo: string; slug: string; aceito: boolean };
const PAPEL: Record<string, string> = { editor: "editor", get reporter() { return t("repórter", "reporter"); } };

export default function Entrar() {
  const [params] = useSearchParams();
  const conviteId = params.get("convite");
  // Convite de equipe: abre em "Criar conta" com o e-mail convidado; ao criar, a conta já entra no veículo.
  const convite = useQuery({
    queryKey: ["convite", conviteId],
    queryFn: () => ler(fetch(`/api/convites/${encodeURIComponent(conviteId!)}`)) as Promise<Convite>,
    enabled: !!conviteId,
    retry: false,
    staleTime: Infinity,
  });
  const [modo, setModo] = useState<"entrar" | "criar">(conviteId ? "criar" : "entrar");
  const criar = modo === "criar";
  useTitulo(criar ? t("Criar conta", "Create account") : t("Entrar", "Sign in"));
  const me = useMe();
  const qc = useQueryClient();
  const navegar = useNavigate();
  const destino = destinoSeguro(params.get("de"));

  const envio = useMutation({
    mutationFn: async (d: { nome: string; email: string; senha: string }) => {
      await (criar ? criarConta(d.nome, d.email, d.senha) : entrar(d.email, d.senha));
      // Com convite: aceitar exige a sessão, o id do link e o e-mail igual ao convidado. Recusado (outro e-mail) ou
      // sumido, a pessoa entra assim mesmo, e a tela avisa.
      if (conviteId) {
        try {
          const r = await aceitarConvite(conviteId);
          return `/t/${r.slug}`;
        } catch (e) {
          setAvisoConvite(e instanceof ErroApi && e.status === 403
            ? t("Esse convite é para outro e-mail: você entrou, mas não no veículo convidado.", "This invite is for another email: you're signed in, but not to the publication you were invited to.")
            : t("Esse convite não existe mais: você entrou, mas não no veículo convidado.", "This invite no longer exists: you're signed in, but not to the publication you were invited to."));
        }
      }
      return destino;
    },
    onSuccess: async (para) => {
      await qc.invalidateQueries({ queryKey: ["me"] });
      navegar(para, { replace: true });
    },
  });
  const [avisoConvite, setAvisoConvite] = useState<string | null>(null);

  if (me.isPending) return <Abertura />;
  if (me.data && !envio.isPending && !envio.isSuccess) return <Navigate to={destino} replace />;

  function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    envio.mutate({ nome: String(f.get("nome") ?? "").trim(), email: String(f.get("email") ?? "").trim(), senha: String(f.get("senha") ?? "") });
  }

  function trocar() {
    envio.reset();
    setModo(criar ? "entrar" : "criar");
  }

  return (
    <main id="conteudo" className="mx-auto grid min-h-dvh max-w-[1120px] content-start gap-8 px-5 pt-6 pb-12 lg:grid-cols-[1fr_440px] lg:content-center lg:gap-x-24 lg:gap-y-6 lg:px-12">
      <Promessa />

      <section aria-labelledby="form-titulo" className="folha-entrar grid content-start gap-5 lg:col-start-2 lg:row-start-1 lg:self-center">
        <h2 id="form-titulo" className="titulo-tela text-[26px]">{criar ? t("Criar conta", "Create account") : t("Entrar", "Sign in")}</h2>
        {convite.data && (
          <p role="status" className={`m-0 rounded-faixa px-3 py-2.5 text-[15px] ${convite.data.aceito ? "bg-papel-2 text-apoio" : "bg-tinta-clara text-texto-forte"}`}>
            {convite.data.aceito
              ? t(`Esse convite já foi usado. Entre com a sua conta para abrir ${convite.data.veiculo}.`, `This invite has already been used. Sign in to your account to open ${convite.data.veiculo}.`)
              : t(
                <>Você foi convidado para <b>{convite.data.veiculo}</b> como {PAPEL[convite.data.papel] ?? convite.data.papel}. {criar ? "Crie a conta" : "Entre"} com o e-mail <b>{convite.data.email}</b>.</>,
                <>You were invited to <b>{convite.data.veiculo}</b> as {PAPEL[convite.data.papel] ?? convite.data.papel}. {criar ? "Create your account" : "Sign in"} with the email <b>{convite.data.email}</b>.</>,
              )}
          </p>
        )}
        {convite.isError && <p role="status" className="m-0 rounded-faixa bg-papel-2 px-3 py-2.5 text-[15px] text-apoio">{t("Esse convite não existe mais. Peça outro a quem convidou.", "This invite no longer exists. Ask the person who invited you for a new one.")}</p>}
        {avisoConvite && <p role="status" className="faixa-aviso m-0">{avisoConvite}</p>}
        <form onSubmit={enviar} className="grid gap-4" aria-describedby={envio.isError ? "form-erro" : undefined}>
          {criar && (
            <label className="campo">
              <span>{t("Seu nome", "Your name")}</span>
              <input name="nome" className="entrada" autoComplete="name" autoCapitalize="words" enterKeyHint="next" required minLength={2} maxLength={80} />
            </label>
          )}
          <label className="campo">
            <span>{t("E-mail", "Email")}</span>
            {/* "username": é o que o gerenciador de senhas procura no login; o e-mail do convite entra do mesmo jeito. */}
            <input name="email" type="email" className="entrada" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" required inputMode="email"
              key={convite.data?.email ?? "livre"} defaultValue={convite.data && !convite.data.aceito ? convite.data.email : undefined} />
          </label>
          <label className="campo">
            <span>{t("Senha", "Password")}</span>
            <input
              name="senha" type="password" className="entrada" required enterKeyHint="done"
              autoComplete={criar ? "new-password" : "current-password"} minLength={criar ? 10 : undefined}
              aria-describedby={criar ? "senha-ajuda" : undefined}
            />
            {criar && <span id="senha-ajuda" className="ajuda">{t("Pelo menos 10 caracteres.", "At least 10 characters.")}</span>}
          </label>
          {envio.isError && <p id="form-erro" role="alert" className="faixa-erro m-0">{mensagemAuth(envio.error)}</p>}
          <button type="submit" className="btn-tinta mt-1 w-full" disabled={envio.isPending}>
            {envio.isPending
              ? (criar ? t("Criando a conta…", "Creating your account…") : t("Entrando…", "Signing in…"))
              : criar ? (conviteId ? t("Criar conta", "Create account") : t("Criar conta e montar o veículo", "Create account and set up your publication")) : t("Entrar", "Sign in")}
          </button>
          {criar && !conviteId && <p className="ajuda m-0 text-center">{t("Leva uns três minutos até o primeiro post.", "It takes about three minutes to get your first post.")}</p>}
        </form>
        <p className="-my-3 m-0 flex items-center gap-1 text-[15px]">
          {criar ? t("Já tem conta? ", "Already have an account? ") : t("Ainda não tem conta? ", "Don't have an account yet? ")}
          <button type="button" onClick={trocar} className="link-acao inline-flex min-h-11 items-center">{criar ? t("Entrar", "Sign in") : t("Criar conta", "Create account")}</button>
        </p>
      </section>

      {/* A promessa em imagem: no celular, depois do formulário (que fica à vista sem rolar); no computador, sob o título. */}
    </main>
  );
}
