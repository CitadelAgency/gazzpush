// Posted: what already went out, most recent first. At the top, the week's pace: seven bars (today marked) and three
// numbers (today, this week, ready to go out), with the same count as the sidebar's Today card (without simulations:
// nothing really went out). Below, the stamped proofs (kit/Proof): the large cover with the "Posted" stamp, when it
// went out and the post's link. No metrics for now (a manual account has none). The next action is to post what is
// ready; empty points to Ready to post.
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useShell } from "../shell/context";
import { FailureLoad, Parts, useTitle } from "../common";
import { TIMEZONE, keys, instant, accountName, postedPerDay, when, formatLabel, readyUse, usePublications, type Publication } from "../queue";
import { locale, t } from "../language";
import { BackPencil } from "../kit/Pencil";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, read } from "../api";
import { warmPost } from "../warmup";
import { DeskLine, DeskSkeleton, EmptyDesk, ladder, useWarm } from "../kit/Proof";

const accountOf = (p: Publication) => accountName({ modo: p.modo, nome: p.conta_nome, external_id: p.conta_external_id });

export default function Posted() {
  const { veiculo: outlet } = useShell();
  useTitle(t("Postados", "Posted"), outlet.nome);
  const pub = usePublications(outlet.id);
  const ready = readyUse(outlet.id).data;
  // Whoever only brings ideas does not post: the next action (and the hand mark) is not theirs.
  const manual = outlet.papel === "reporter" ? 0 : (ready?.manuais ?? 0);
  // Ready to go out: everything in Ready to post (posted by hand and by itself). Without the answer, no number.
  const toSignOut = ready ? (ready.total.aprovada ?? 0) + (ready.total.agendada ?? 0) : null;
  const list = pub.data?.pages.flatMap((p) => p.publicacoes) ?? [];
  const base = `/t/${outlet.slug}`;
  // The clock ticks minute by minute: "today" turns at midnight and "the last one 5 min ago" does not go stale on screen.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(tick);
  }, []);
  // The week needs all 7 days: while the oldest loaded publication is still from this week and there are more pages,
  // fetch the next one (up to 5 pages, 100 posts; a page that failed is not requested again in a loop: the "try again"
  // stays at the bottom). It is the same care as the sidebar's Today card, on the same query: with `cancelRefetch:
  // false` the request the sidebar just made is reused, and the two become one. So it only requests with the query idle
  // (`isFetching`): if it rode along with an ordinary refresh, the next page would not come.
  const moreOldLoaded = list[list.length - 1]?.publicado_em ?? null;
  const incompleteWeek = !!pub.hasNextPage && !pub.isFetching && !pub.isFetchNextPageError && (pub.data?.pages.length ?? 0) < 5
    && !!moreOldLoaded && instant(moreOldLoaded) > now.getTime() - 7 * 864e5;
  const { fetchNextPage } = pub;
  useEffect(() => { if (incompleteWeek) void fetchNextPage({ cancelRefetch: false }); }, [incompleteWeek, fetchNextPage]);
  // Pace, not a total: simulations stay out (nothing really went out), as in the sidebar.
  const real = list.filter((p) => p.modo !== "simulada");
  const perDay = postedPerDay(real.map((p) => p.publicado_em), now);
  const week = perDay.reduce((a, b) => a + b, 0);
  const last = real.find((p) => p.publicado_em)?.publicado_em ?? null;
  // Everything in view went out through the same account: it is said once, at the top; with more than one, each proof
  // says its own. An account without a name (`accountName`'s "Instagram") says nothing: it stays out.
  const accounts = [...new Set(list.map(accountOf))];
  const severalAccounts = accounts.length > 1;
  const oneAccount = !severalAccounts && list.some((p) => p.conta_nome || p.conta_external_id) ? accounts[0] : null;

  return (
    <div className="mx-auto max-w-[1280px] px-5 pt-6 pb-14 lg:px-12 lg:pt-3">
      <h1 className="titulo-tela m-0 text-[32px] lg:text-[34px]">{t("Postados", "Posted")}</h1>
      {pub.isPending ? (
        <div className="mt-8">
          <p role="status" className="sr-only">{t("Carregando os postados", "Loading posted posts")}</p>
          <DeskSkeleton />
        </div>
      ) : pub.isError && !list.length ? (
        <div className="mt-6"><FailureLoad oque={t("os postados", "the posted posts")} tentar={() => pub.refetch()} /></div>
      ) : !list.length ? (
        <EmptyDesk rotulo={t("nada postado", "nothing posted")}>
          <p className="m-0 text-[19px] text-texto-forte">{t("Nada postado ainda.", "Nothing posted yet.")}</p>
          <p className="m-0 max-w-[52ch] text-apoio">
            {manual
              ? t(`${manual === 1 ? "1 post está pronto" : `${manual} posts estão prontos`} para postar. Depois de postar, ele aparece aqui com o link.`,
                `${manual === 1 ? "1 post is ready" : `${manual} posts are ready`} to post. Once posted, it shows up here with the link.`)
              : t("Os posts aparecem aqui depois que saem no Instagram, com o link de cada um.", "Posts show up here once they're out on Instagram, each with its link.")}
          </p>
          <Link to={`${base}/postar`} viewTransition className="acao-lapis -ml-[6px]"><span>{t("Ver Prontos para postar", "See Ready to post")}</span><BackPencil desenhar /></Link>
        </EmptyDesk>
      ) : (
        <>
          <DeskLine
            forte={week ? t(`${week} nesta semana`, `${week} this week`) : t("Nenhum nesta semana", "None this week")}
            partes={[last && t(`o último ${when(last, now)}`, `the latest ${when(last, now)}`), oneAccount && t(`em ${oneAccount}`, `on ${oneAccount}`)]} />
          <Pace porDia={perDay} agora={now} paraSair={toSignOut}>
            {manual > 0 && (
              <Link to={`${base}/postar`} viewTransition className="acao-lapis max-xl:-ml-[6px]"><span>{t("Postar a próxima", "Post the next one")}</span><BackPencil desenhar /></Link>
            )}
          </Pace>
          <ul className="mesa m-0 mt-[34px] list-none p-0">
            {list.map((p, i) => <Item key={p.id} pub={p} i={i} slug={outlet.slug} conta={severalAccounts} />)}
          </ul>
          {pub.hasNextPage && (
            <button type="button" onClick={() => pub.fetchNextPage()} disabled={pub.isFetchingNextPage} className="btn-sec -ml-4 mt-2">
              {pub.isFetchingNextPage ? t("Carregando…", "Loading…") : t("Ver mais antigos", "See older ones")}
            </button>
          )}
          {pub.isFetchNextPageError && <FailureLoad oque={t("os mais antigos", "the older ones")} tentar={() => pub.fetchNextPage()} />}
        </>
      )}
    </div>
  );
}

const LABEL = "mono text-[10.5px] leading-[1.2] tracking-[.1em] text-apoio uppercase";

/**
 * The week's pace (`.ritmo`, desk.css): seven bars, one per day, with today's in solid graphite and a day without posts
 * as a stub; beside them, today, this week and what is ready to go out. The bars have a name with the numbers
 * (`role="img"`); the numbers beside them are text. `children` is the next action, which stays next to the number that
 * asks for it.
 */
function Pace({ porDia: perDay, agora: now, paraSair: toSignOut, children }: { porDia: number[]; agora: Date; paraSair: number | null; children?: ReactNode }) {
  const lastDay = perDay.length - 1;
  const largest = Math.max(1, ...perDay);
  const days = perDay.map((_, i) => (i === lastDay
    ? t("hoje", "today")
    : new Date(now.getTime() - (lastDay - i) * 864e5).toLocaleDateString(locale(), { weekday: "short", timeZone: TIMEZONE }).replace(".", "").toLocaleLowerCase()));
  const numbers = perDay.map((n, i) => `${days[i]} ${n}`).join(", ");
  return (
    <section className="ritmo mt-[26px] max-lg:gap-x-6" aria-label={t("Ritmo da semana", "This week's pace")}>
      <div>
        <div className="semana" role="img" aria-label={t(`Posts por dia nos últimos sete dias: ${numbers}`, `Posts per day over the last seven days: ${numbers}`)}>
          {perDay.map((n, i) => <i key={i} data-n={n} data-hoje={i === lastDay ? "" : undefined} style={{ height: `${n ? Math.round((n / largest) * 100) : 0}%` }} />)}
        </div>
        <div className="semana-dias" aria-hidden="true">{days.map((d, i) => <span key={i}>{d}</span>)}</div>
      </div>
      <div className="cifra"><b>{perDay[lastDay] ?? 0}</b><span className={LABEL}>{t("hoje", "today")}</span></div>
      <div className="cifra"><b>{perDay.reduce((a, b) => a + b, 0)}</b><span className={LABEL}>{t("na semana", "this week")}</span></div>
      {toSignOut !== null && <div className="cifra"><b>{toSignOut}</b><span className={LABEL}>{toSignOut === 1 ? t("pronto para sair", "ready to go out") : t("prontos para sair", "ready to go out")}</span></div>}
      {children && <p className="m-0 max-xl:col-span-full">{children}</p>}
    </section>
  );
}

const LINK = "link-acao relative z-[2] inline-flex min-h-11 items-center lg:min-h-9";

/** A ready certificate: download. Without it (an old post, or the timestamp authority failed): generate, with the timestamp after publication. */
function Certificate({ tenantId, pecaId: pieceId, pronta: ready, erro: error }: { tenantId: string; pecaId: string; pronta: boolean; erro: boolean }) {
  const qc = useQueryClient();
  const generate = useMutation({
    mutationFn: () => read(api.t[":tenantId"].pecas[":id"].certidao.$post({ param: { tenantId, id: pieceId } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.publicacoes(tenantId) }),
  });
  if (ready) return <a href={`/api/t/${tenantId}/pecas/${pieceId}/certidao`} download className={LINK}>{t("Certidão", "Certificate")}</a>;
  return (
    <>
      <button type="button" className={`${LINK} disabled:cursor-not-allowed disabled:opacity-55`} disabled={generate.isPending} onClick={() => generate.mutate()}>{generate.isPending ? t("Gerando…", "Generating…") : t("Gerar certidão", "Generate certificate")}</button>
      {(error || generate.isError) && <span role="alert" className="relative z-[2] basis-full text-terracota">{generate.isError ? (generate.error as Error).message : t("A certidão falhou na publicação. Gere de novo.", "The certificate failed at publication. Generate it again.")}</span>}
    </>
  );
}

/** `conta`: the proof says which account it went out through (only when the list has more than one; with just one, it is at the top of the screen). */
function Item({ pub: p, i, slug, conta: account }: { pub: Publication; i: number; slug: string; conta: boolean }) {
  const { veiculo: outlet } = useShell();
  const qc = useQueryClient();
  const point = useWarm(() => void warmPost(qc, outlet.id, p.peca_id));
  const format = formatLabel(p.formato, p.ncards);
  const test = p.modo === "simulada";
  const ad = p.tipo_post === "publicidade";
  const url = p.url && /^https?:\/\//.test(p.url) && !test ? p.url : null;
  return (
    <li className="prova-li entra" style={ladder(i)}>
      <div className="prova">
        <span className="prova-arte corte" data-pilha={p.formato === "carrossel" ? "" : undefined}>
          {p.capa ? <img src={p.capa} alt="" width={540} height={675} loading="lazy" decoding="async" /> : <span aria-hidden="true" className="prova-vaga" />}
          {/* The stamp belongs to the state; the date and the account are in text (in the caption and at the top of the screen). */}
          <span aria-hidden="true" className="prova-carimbo carimbo">{test ? t("Simulado", "Test run") : ad ? t("Publicidade", "Advertisement") : t("Postado", "Posted")}</span>
        </span>
        <div className="prova-corpo">
          {/* One line on desktop: when it went out and the format. The simulation is already stated below ("Test account…"). */}
          <p className="mono prova-meta prova-meta-solo m-0">
            <span>
              <Parts partes={[
                p.publicado_em ? when(p.publicado_em) : null, format, account && accountOf(p),
                ad && t("publicidade", "advertisement"), !!p.piloto && t("Aprovado pelo piloto", "Approved by autopilot"),
              ]} />
            </span>
          </p>
          {/* A stretched link: the whole card opens the post; "View on Instagram" and the documents sit on top, as links of their own. */}
          <h2 className="prova-manchete m-0">
            <Link to={`/t/${slug}/p/${p.peca_id}`} viewTransition {...point} className="text-texto-forte no-underline after:absolute after:inset-0 after:z-[1] after:content-['']">{p.manchete ?? p.titulo}</Link>
          </h2>
          <div className="acao flex flex-wrap items-center gap-x-3.5 text-[14px]">
            {url ? (
              <a href={url} target="_blank" rel="noopener noreferrer" className={LINK}>
                {t("Ver no Instagram", "View on Instagram")}<span className="sr-only">{t(" (abre em outra aba)", " (opens in a new tab)")}</span>
              </a>
            ) : (
              <p className="m-0 basis-full text-apoio">{test ? t("Conta de teste: sem link de verdade.", "Test account: no real link.") : t("Confirmado sem o link do post.", "Confirmed without the post link.")}</p>
            )}
            {!test && outlet.papel !== "reporter" && <Certificate tenantId={outlet.id} pecaId={p.peca_id} pronta={!!p.certidao} erro={!!p.certidao_erro} />}
            {ad && outlet.papel !== "reporter" && (
              <a href={`/api/t/${outlet.id}/pecas/${p.peca_id}/comprovante`} download className={LINK}>{t("Comprovante", "Proof of publication")}</a>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
