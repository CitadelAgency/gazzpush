// Waitlist: the product's public door, with the prices. "/" without a session lands here; /entrar stays for whoever already has an account.
import { useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { PLANS, PLANS_PAID, type PaidPlan } from "../../../src/lib/plansTable";
import { signInInList, ApiError, authMessage } from "../api";
import { useTitle } from "../common";
import { t } from "../language";
import DemoProof from "../kit/ProofDemo";
import PromiseCard, { supportSentence } from "../kit/PromiseCard";

const NAME = (p: PaidPlan) => ({ pagina: t("Página", "Page"), portal: t("Portal", "News site") })[p];
const TO_WHO = (p: PaidPlan) => ({
  pagina: t("Para a página de bairro ou o autor que posta todo dia.", "For a neighborhood page or an author posting daily."),
  portal: t("Para o portal com mais de um post por dia.", "For a news site posting more than once a day."),
})[p];

const price = (p: PaidPlan) => t(`R$ ${PLANS[p].precoReais} por mês`, `R$ ${PLANS[p].precoReais} per month`);
const posts = (p: PaidPlan) => t(`${PLANS[p].limite} posts por mês`, `${PLANS[p].limite} posts per month`);

// The server explains a refused email and the sign-up limit; the rest is the usual message (no connection, try again).
const message = (e: unknown) => (e instanceof ApiError && (e.status === 400 || e.status === 429) ? e.message : authMessage(e));

export default function WaitList() {
  useTitle(t("Lista de espera", "Waitlist"));
  const emailField = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const upload = useMutation({
    mutationFn: signInInList,
    onSuccess: (_, d) => setEmail(d.email),
    onError: (e) => { if (e instanceof ApiError && e.status === 400) emailField.current?.focus(); },
  });

  function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    upload.mutate({ email: String(f.get("email") ?? "").trim(), nome: String(f.get("nome") ?? "").trim(), plano: String(f.get("plano") ?? ""), site: String(f.get("site") ?? "") });
  }

  const refused = upload.error instanceof ApiError && upload.error.status === 400;

  return (
    <main id="conteudo" className="mx-auto grid min-h-dvh max-w-[1120px] content-start gap-8 px-5 pt-6 pb-12 lg:grid-cols-[1fr_440px] lg:content-center lg:gap-x-24 lg:gap-y-6 lg:px-12">
      <PromiseCard apoioSoNoComputador />

      <section aria-labelledby="lista-titulo" className="folha-entrar grid content-start gap-5 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-center">
        {upload.isSuccess ? (
          // The person was on the button, which left the screen: focus comes to the confirmation, and the screen reader reads it.
          <div role="status" tabIndex={-1} ref={(el) => el?.focus()} className="grid gap-2 outline-none">
            <h2 id="lista-titulo" className="titulo-tela text-[26px]">{t("Você está na lista.", "You're on the list.")}</h2>
            <p className="m-0 text-[16px]">{t(<>Vamos escrever para <b>{email}</b> quando a sua vaga abrir.</>, <>We'll write to <b>{email}</b> when your spot opens.</>)}</p>
          </div>
        ) : (
          <>
            <h2 id="lista-titulo" className="titulo-tela text-[26px]">{t("Entre na lista de espera", "Join the waitlist")}</h2>
            <form onSubmit={send} className="grid gap-4" aria-describedby={upload.isError ? "lista-erro" : undefined}>
              <label className="campo">
                <span>{t("E-mail", "Email")}</span>
                <input
                  ref={emailField} name="email" type="email" className="entrada" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                  inputMode="email" enterKeyHint="next" required maxLength={254} aria-invalid={refused || undefined}
                />
              </label>
              <label className="campo">
                <span>{t("Seu nome (opcional)", "Your name (optional)")}</span>
                <input name="nome" className="entrada" autoComplete="name" autoCapitalize="words" enterKeyHint="done" maxLength={80} />
              </label>
              {/* Bait for bots: invisible and out of keyboard reach. Filled in, the server answers the same and stores nothing. */}
              <div aria-hidden="true" className="absolute -left-[9999px]">
                <label>Site<input name="site" tabIndex={-1} autoComplete="off" /></label>
              </div>
              <fieldset className="m-0 grid gap-1 border-0 p-0" aria-describedby="planos-ajuda">
                <legend className="mb-1 p-0 text-[15px] font-bold text-texto-forte">{t("Qual plano interessa? (opcional)", "Which plan interests you? (optional)")}</legend>
                {PLANS_PAID.map((p) => (
                  <label key={p} className="flex cursor-pointer items-start gap-3 rounded-btn p-2 hover:bg-papel-2 has-[:checked]:bg-papel-2">
                    <input type="radio" name="plano" value={p} className="mt-[3px] size-[18px] flex-none accent-[var(--color-tinta)]" />
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <b className="text-texto-forte">{NAME(p)}</b>
                        <b className="text-texto-forte">{price(p)}</b>
                      </span>
                      <span className="ajuda">{posts(p)}. {TO_WHO(p)}</span>
                    </span>
                  </label>
                ))}
                <span id="planos-ajuda" className="ajuda px-2">{t("Preço por veículo. Conta post e carrossel novos; reescrita, Reels e correção não contam.", "Price per publication. New posts and carousels count; rewrites, Reels and corrections don't.")}</span>
              </fieldset>
              {upload.isError && <p id="lista-erro" role="alert" className="faixa-erro m-0">{message(upload.error)}</p>}
              <button type="submit" className="btn-tinta mt-1 w-full" disabled={upload.isPending}>
                {upload.isPending ? t("Entrando na lista…", "Joining…") : t("Entrar na lista de espera", "Join the waitlist")}
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

      <p className="m-0 text-[16px] lg:hidden">{supportSentence()}</p>
      <div className="demo-moldura lg:col-start-1 lg:row-start-2"><DemoProof /></div>
    </main>
  );
}
