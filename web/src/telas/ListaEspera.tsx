// Lista de espera: a porta pública do produto, com os preços. "/" sem sessão cai aqui; /entrar segue para quem já tem conta.
import { useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { PLANOS, PLANOS_PAGOS, type PlanoPago } from "../../../src/lib/planosTabela";
import { entrarNaLista, ErroApi, mensagemAuth } from "../api";
import { useTitulo } from "../comum";
import { t } from "../idioma";
import Promessa, { fraseApoio } from "../kit/Promessa";

const NOME = (p: PlanoPago) => ({ pagina: t("Página", "Page"), portal: t("Portal", "News site") })[p];
const PARA_QUEM = (p: PlanoPago) => ({
  pagina: t("Para a página de bairro ou o autor que posta todo dia.", "For a neighborhood page or an author posting daily."),
  portal: t("Para o portal com mais de um post por dia.", "For a news site posting more than once a day."),
})[p];

const preco = (p: PlanoPago) => t(`R$ ${PLANOS[p].precoReais} por mês`, `R$ ${PLANOS[p].precoReais} per month`);
const posts = (p: PlanoPago) => t(`${PLANOS[p].limite} posts por mês`, `${PLANOS[p].limite} posts per month`);

// O servidor explica e-mail recusado e limite de cadastros; o resto é a mensagem de sempre (sem conexão, tente de novo).
const mensagem = (e: unknown) => (e instanceof ErroApi && (e.status === 400 || e.status === 429) ? e.message : mensagemAuth(e));

export default function ListaEspera() {
  useTitulo(t("Lista de espera", "Waitlist"));
  const campoEmail = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const envio = useMutation({
    mutationFn: entrarNaLista,
    onSuccess: (_, d) => setEmail(d.email),
    onError: (e) => { if (e instanceof ErroApi && e.status === 400) campoEmail.current?.focus(); },
  });

  function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    envio.mutate({ email: String(f.get("email") ?? "").trim(), nome: String(f.get("nome") ?? "").trim(), plano: String(f.get("plano") ?? ""), site: String(f.get("site") ?? "") });
  }

  const recusado = envio.error instanceof ErroApi && envio.error.status === 400;

  return (
    <main id="conteudo" className="mx-auto grid min-h-dvh max-w-[1120px] content-start gap-8 px-5 pt-6 pb-12 lg:grid-cols-[1fr_440px] lg:content-center lg:gap-x-24 lg:gap-y-6 lg:px-12">
      <Promessa apoioSoNoComputador />

      <section aria-labelledby="lista-titulo" className="folha-entrar grid content-start gap-5 lg:col-start-2 lg:row-start-1 lg:self-center">
        {envio.isSuccess ? (
          // A pessoa estava no botão, que saiu da tela: o foco vem para a confirmação, e o leitor de tela a lê.
          <div role="status" tabIndex={-1} ref={(el) => el?.focus()} className="grid gap-2 outline-none">
            <h2 id="lista-titulo" className="titulo-tela text-[26px]">{t("Você está na lista.", "You're on the list.")}</h2>
            <p className="m-0 text-[16px]">{t(<>Vamos escrever para <b>{email}</b> quando a sua vaga abrir.</>, <>We'll write to <b>{email}</b> when your spot opens.</>)}</p>
          </div>
        ) : (
          <>
            <h2 id="lista-titulo" className="titulo-tela text-[26px]">{t("Entre na lista de espera", "Join the waitlist")}</h2>
            <form onSubmit={enviar} className="grid gap-4" aria-describedby={envio.isError ? "lista-erro" : undefined}>
              <label className="campo">
                <span>{t("E-mail", "Email")}</span>
                <input
                  ref={campoEmail} name="email" type="email" className="entrada" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                  inputMode="email" enterKeyHint="next" required maxLength={254} aria-invalid={recusado || undefined}
                />
              </label>
              <label className="campo">
                <span>{t("Seu nome (opcional)", "Your name (optional)")}</span>
                <input name="nome" className="entrada" autoComplete="name" autoCapitalize="words" enterKeyHint="done" maxLength={80} />
              </label>
              {/* Isca para robô: invisível e fora do teclado. Preenchida, o servidor responde igual e não guarda nada. */}
              <div aria-hidden="true" className="absolute -left-[9999px]">
                <label>Site<input name="site" tabIndex={-1} autoComplete="off" /></label>
              </div>
              <fieldset className="m-0 grid gap-1 border-0 p-0" aria-describedby="planos-ajuda">
                <legend className="mb-1 p-0 text-[15px] font-bold text-texto-forte">{t("Qual plano interessa? (opcional)", "Which plan interests you? (optional)")}</legend>
                {PLANOS_PAGOS.map((p) => (
                  <label key={p} className="flex cursor-pointer items-start gap-3 rounded-btn p-2 hover:bg-papel-2 has-[:checked]:bg-papel-2">
                    <input type="radio" name="plano" value={p} className="mt-[3px] size-[18px] flex-none accent-[var(--color-tinta)]" />
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <b className="text-texto-forte">{NOME(p)}</b>
                        <b className="text-texto-forte">{preco(p)}</b>
                      </span>
                      <span className="ajuda">{posts(p)}. {PARA_QUEM(p)}</span>
                    </span>
                  </label>
                ))}
                <span id="planos-ajuda" className="ajuda px-2">{t("Preço por veículo. Conta post e carrossel novos; reescrita, Reels e correção não contam.", "Price per publication. New posts and carousels count; rewrites, Reels and corrections don't.")}</span>
              </fieldset>
              {envio.isError && <p id="lista-erro" role="alert" className="faixa-erro m-0">{mensagem(envio.error)}</p>}
              <button type="submit" className="btn-tinta mt-1 w-full" disabled={envio.isPending}>
                {envio.isPending ? t("Entrando na lista…", "Joining…") : t("Entrar na lista de espera", "Join the waitlist")}
              </button>
              <p className="ajuda m-0 text-center">{t("Usamos o e-mail só para avisar quando a sua vaga abrir.", "We only use your email to tell you when your spot opens.")}</p>
            </form>
          </>
        )}
        <p className="-my-3 m-0 flex items-center gap-1 text-[15px]">
          {t("Já tem conta? ", "Already have an account? ")}
          <Link to="/entrar" className="link-acao inline-flex min-h-11 items-center">{t("Entrar", "Sign in")}</Link>
        </p>
      </section>

      <p className="m-0 text-[16px] lg:hidden">{fraseApoio()}</p>
    </main>
  );
}
