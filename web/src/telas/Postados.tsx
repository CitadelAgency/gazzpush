// Postados: o que já saiu, do mais recente. Em cima, o ritmo da semana: sete barras (hoje marcada) e três números (hoje,
// na semana, prontos para sair), com a mesma conta do card Hoje da lateral (sem as simulações: nada saiu de verdade).
// Embaixo, as provas carimbadas (kit/Prova): a capa grande com o carimbo "Postado", quando saiu e o link do post. Sem
// métricas por ora (conta manual não tem). A próxima ação é postar o que está pronto; vazio aponta para Prontos para postar.
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useCasca } from "../casca/contexto";
import { FalhaCarga, Partes, useTitulo } from "../comum";
import { FUSO, chaves, instante, nomeConta, postadosPorDia, quando, rotuloFormato, useProntos, usePublicacoes, type Publicacao } from "../fila";
import { locale, t } from "../idioma";
import { VoltaLapis } from "../kit/Lapis";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ler } from "../api";
import { aquecerPost } from "../aquecer";
import { LinhaMesa, MesaEsqueleto, MesaVazia, escada, useAquecer } from "../kit/Prova";

const contaDe = (p: Publicacao) => nomeConta({ modo: p.modo, nome: p.conta_nome, external_id: p.conta_external_id });

export default function Postados() {
  const { veiculo } = useCasca();
  useTitulo(t("Postados", "Posted"), veiculo.nome);
  const pub = usePublicacoes(veiculo.id);
  const prontos = useProntos(veiculo.id).data;
  // Quem só traz ideias não posta: a próxima ação (e a marca à mão) não é dele.
  const manuais = veiculo.papel === "reporter" ? 0 : (prontos?.manuais ?? 0);
  // Prontos para sair: tudo o que está em Prontos para postar (quem posta à mão e quem posta sozinho). Sem a resposta, sem número.
  const paraSair = prontos ? (prontos.total.aprovada ?? 0) + (prontos.total.agendada ?? 0) : null;
  const lista = pub.data?.pages.flatMap((p) => p.publicacoes) ?? [];
  const base = `/t/${veiculo.slug}`;
  // O relógio anda de minuto em minuto: "hoje" vira à meia-noite e "o último há 5 min" não envelhece na tela.
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const tique = setInterval(() => setAgora(new Date()), 60_000);
    return () => clearInterval(tique);
  }, []);
  // A semana precisa dos 7 dias inteiros: enquanto a publicação mais antiga carregada ainda é desta semana e há mais
  // páginas, busca a próxima (até 5 páginas, 100 posts; página que falhou não é pedida de novo em laço: fica o "tentar
  // de novo" lá embaixo). É o mesmo cuidado do card Hoje da lateral, sobre a mesma consulta: com `cancelRefetch: false`
  // o pedido que a lateral acabou de fazer é aproveitado, e os dois viram um só. Por isso só pede com a consulta parada
  // (`isFetching`): se pegasse carona numa atualização comum, a página seguinte não viria.
  const maisAntigaCarregada = lista[lista.length - 1]?.publicado_em ?? null;
  const semanaIncompleta = !!pub.hasNextPage && !pub.isFetching && !pub.isFetchNextPageError && (pub.data?.pages.length ?? 0) < 5
    && !!maisAntigaCarregada && instante(maisAntigaCarregada) > agora.getTime() - 7 * 864e5;
  const { fetchNextPage } = pub;
  useEffect(() => { if (semanaIncompleta) void fetchNextPage({ cancelRefetch: false }); }, [semanaIncompleta, fetchNextPage]);
  // Ritmo, não total: as simulações ficam de fora (nada saiu de verdade), como na lateral.
  const reais = lista.filter((p) => p.modo !== "simulada");
  const porDia = postadosPorDia(reais.map((p) => p.publicado_em), agora);
  const semana = porDia.reduce((a, b) => a + b, 0);
  const ultimo = reais.find((p) => p.publicado_em)?.publicado_em ?? null;
  // Tudo o que está à vista saiu pela mesma conta: ela é dita uma vez, no alto; com mais de uma, cada prova diz a sua.
  // Conta sem nome (o "Instagram" de `nomeConta`) não diz nada: fica de fora.
  const contas = [...new Set(lista.map(contaDe))];
  const variasContas = contas.length > 1;
  const umaConta = !variasContas && lista.some((p) => p.conta_nome || p.conta_external_id) ? contas[0] : null;

  return (
    <div className="mx-auto max-w-[1280px] px-5 pt-6 pb-14 lg:px-12 lg:pt-3">
      <h1 className="titulo-tela m-0 text-[32px] lg:text-[34px]">{t("Postados", "Posted")}</h1>
      {pub.isPending ? (
        <div className="mt-8">
          <p role="status" className="sr-only">{t("Carregando os postados", "Loading posted posts")}</p>
          <MesaEsqueleto />
        </div>
      ) : pub.isError && !lista.length ? (
        <div className="mt-6"><FalhaCarga oque={t("os postados", "the posted posts")} tentar={() => pub.refetch()} /></div>
      ) : !lista.length ? (
        <MesaVazia rotulo={t("nada postado", "nothing posted")}>
          <p className="m-0 text-[19px] text-texto-forte">{t("Nada postado ainda.", "Nothing posted yet.")}</p>
          <p className="m-0 max-w-[52ch] text-apoio">
            {manuais
              ? t(`${manuais === 1 ? "1 post está pronto" : `${manuais} posts estão prontos`} para postar. Depois de postar, ele aparece aqui com o link.`,
                `${manuais === 1 ? "1 post is ready" : `${manuais} posts are ready`} to post. Once posted, it shows up here with the link.`)
              : t("Os posts aparecem aqui depois que saem no Instagram, com o link de cada um.", "Posts show up here once they're out on Instagram, each with its link.")}
          </p>
          <Link to={`${base}/postar`} viewTransition className="acao-lapis -ml-[6px]"><span>{t("Ver Prontos para postar", "See Ready to post")}</span><VoltaLapis desenhar /></Link>
        </MesaVazia>
      ) : (
        <>
          <LinhaMesa
            forte={semana ? t(`${semana} nesta semana`, `${semana} this week`) : t("Nenhum nesta semana", "None this week")}
            partes={[ultimo && t(`o último ${quando(ultimo, agora)}`, `the latest ${quando(ultimo, agora)}`), umaConta && t(`em ${umaConta}`, `on ${umaConta}`)]} />
          <Ritmo porDia={porDia} agora={agora} paraSair={paraSair}>
            {manuais > 0 && (
              <Link to={`${base}/postar`} viewTransition className="acao-lapis max-xl:-ml-[6px]"><span>{t("Postar a próxima", "Post the next one")}</span><VoltaLapis desenhar /></Link>
            )}
          </Ritmo>
          <ul className="mesa m-0 mt-[34px] list-none p-0">
            {lista.map((p, i) => <Item key={p.id} pub={p} i={i} slug={veiculo.slug} conta={variasContas} />)}
          </ul>
          {pub.hasNextPage && (
            <button type="button" onClick={() => pub.fetchNextPage()} disabled={pub.isFetchingNextPage} className="btn-sec -ml-4 mt-2">
              {pub.isFetchingNextPage ? t("Carregando…", "Loading…") : t("Ver mais antigos", "See older ones")}
            </button>
          )}
          {pub.isFetchNextPageError && <FalhaCarga oque={t("os mais antigos", "the older ones")} tentar={() => pub.fetchNextPage()} />}
        </>
      )}
    </div>
  );
}

const ROTULO = "mono text-[10.5px] leading-[1.2] tracking-[.1em] text-apoio uppercase";

/**
 * O ritmo da semana (`.ritmo`, rodada4.css): sete barras, uma por dia, com a de hoje em grafite cheio e o dia sem post
 * como um toco; ao lado, hoje, na semana e o que está pronto para sair. As barras têm nome com os números (`role="img"`);
 * os números ao lado são texto. `children` é a próxima ação, que fica junto do número que a pede.
 */
function Ritmo({ porDia, agora, paraSair, children }: { porDia: number[]; agora: Date; paraSair: number | null; children?: ReactNode }) {
  const ultimoDia = porDia.length - 1;
  const maior = Math.max(1, ...porDia);
  const dias = porDia.map((_, i) => (i === ultimoDia
    ? t("hoje", "today")
    : new Date(agora.getTime() - (ultimoDia - i) * 864e5).toLocaleDateString(locale(), { weekday: "short", timeZone: FUSO }).replace(".", "").toLocaleLowerCase()));
  const numeros = porDia.map((n, i) => `${dias[i]} ${n}`).join(", ");
  return (
    <section className="ritmo mt-[26px] max-lg:gap-x-6" aria-label={t("Ritmo da semana", "This week's pace")}>
      <div>
        <div className="semana" role="img" aria-label={t(`Posts por dia nos últimos sete dias: ${numeros}`, `Posts per day over the last seven days: ${numeros}`)}>
          {porDia.map((n, i) => <i key={i} data-n={n} data-hoje={i === ultimoDia ? "" : undefined} style={{ height: `${n ? Math.round((n / maior) * 100) : 0}%` }} />)}
        </div>
        <div className="semana-dias" aria-hidden="true">{dias.map((d, i) => <span key={i}>{d}</span>)}</div>
      </div>
      <div className="cifra"><b>{porDia[ultimoDia] ?? 0}</b><span className={ROTULO}>{t("hoje", "today")}</span></div>
      <div className="cifra"><b>{porDia.reduce((a, b) => a + b, 0)}</b><span className={ROTULO}>{t("na semana", "this week")}</span></div>
      {paraSair !== null && <div className="cifra"><b>{paraSair}</b><span className={ROTULO}>{paraSair === 1 ? t("pronto para sair", "ready to go out") : t("prontos para sair", "ready to go out")}</span></div>}
      {children && <p className="m-0 max-xl:col-span-full">{children}</p>}
    </section>
  );
}

const LINK = "link-acao relative z-[2] inline-flex min-h-11 items-center lg:min-h-9";

/** Certidão pronta: baixar. Sem ela (post antigo, ou a autoridade de carimbo falhou): gerar, com o carimbo posterior à publicação. */
function Certidao({ tenantId, pecaId, pronta, erro }: { tenantId: string; pecaId: string; pronta: boolean; erro: boolean }) {
  const qc = useQueryClient();
  const gerar = useMutation({
    mutationFn: () => ler(api.t[":tenantId"].pecas[":id"].certidao.$post({ param: { tenantId, id: pecaId } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: chaves.publicacoes(tenantId) }),
  });
  if (pronta) return <a href={`/api/t/${tenantId}/pecas/${pecaId}/certidao`} download className={LINK}>{t("Certidão", "Certificate")}</a>;
  return (
    <>
      <button type="button" className={`${LINK} disabled:cursor-not-allowed disabled:opacity-55`} disabled={gerar.isPending} onClick={() => gerar.mutate()}>{gerar.isPending ? t("Gerando…", "Generating…") : t("Gerar certidão", "Generate certificate")}</button>
      {(erro || gerar.isError) && <span role="alert" className="relative z-[2] basis-full text-terracota">{gerar.isError ? (gerar.error as Error).message : t("A certidão falhou na publicação. Gere de novo.", "The certificate failed at publication. Generate it again.")}</span>}
    </>
  );
}

/** `conta`: a prova diz por qual conta saiu (só quando a lista tem mais de uma; com uma só, ela está no alto da tela). */
function Item({ pub: p, i, slug, conta }: { pub: Publicacao; i: number; slug: string; conta: boolean }) {
  const { veiculo } = useCasca();
  const qc = useQueryClient();
  const apontar = useAquecer(() => void aquecerPost(qc, veiculo.id, p.peca_id));
  const formato = rotuloFormato(p.formato, p.ncards);
  const teste = p.modo === "simulada";
  const publi = p.tipo_post === "publicidade";
  const url = p.url && /^https?:\/\//.test(p.url) && !teste ? p.url : null;
  return (
    <li className="prova-li entra" style={escada(i)}>
      <div className="prova">
        <span className="prova-arte corte" data-pilha={p.formato === "carrossel" ? "" : undefined}>
          {p.capa ? <img src={p.capa} alt="" width={540} height={675} loading="lazy" decoding="async" /> : <span aria-hidden="true" className="prova-vaga" />}
          {/* O carimbo é do estado; a data e a conta estão em texto (na legenda e no alto da tela). */}
          <span aria-hidden="true" className="prova-carimbo carimbo">{teste ? t("Simulado", "Test run") : publi ? t("Publicidade", "Advertisement") : t("Postado", "Posted")}</span>
        </span>
        <div className="prova-corpo">
          {/* Uma linha no computador: quando saiu e o formato. A simulação já está dita embaixo ("Conta de teste…"). */}
          <p className="mono prova-meta prova-meta-solo m-0">
            <span>
              <Partes partes={[
                p.publicado_em ? quando(p.publicado_em) : null, formato, conta && contaDe(p),
                publi && t("publicidade", "advertisement"), !!p.piloto && t("Aprovado pelo piloto", "Approved by autopilot"),
              ]} />
            </span>
          </p>
          {/* Link esticado: o cartão inteiro abre o post; "Ver no Instagram" e os documentos ficam por cima, como links próprios. */}
          <h2 className="prova-manchete m-0">
            <Link to={`/t/${slug}/p/${p.peca_id}`} viewTransition {...apontar} className="text-texto-forte no-underline after:absolute after:inset-0 after:z-[1] after:content-['']">{p.manchete ?? p.titulo}</Link>
          </h2>
          <div className="acao flex flex-wrap items-center gap-x-3.5 text-[14px]">
            {url ? (
              <a href={url} target="_blank" rel="noopener noreferrer" className={LINK}>
                {t("Ver no Instagram", "View on Instagram")}<span className="sr-only">{t(" (abre em outra aba)", " (opens in a new tab)")}</span>
              </a>
            ) : (
              <p className="m-0 basis-full text-apoio">{teste ? t("Conta de teste: sem link de verdade.", "Test account: no real link.") : t("Confirmado sem o link do post.", "Confirmed without the post link.")}</p>
            )}
            {!teste && veiculo.papel !== "reporter" && <Certidao tenantId={veiculo.id} pecaId={p.peca_id} pronta={!!p.certidao} erro={!!p.certidao_erro} />}
            {publi && veiculo.papel !== "reporter" && (
              <a href={`/api/t/${veiculo.id}/pecas/${p.peca_id}/comprovante`} download className={LINK}>{t("Comprovante", "Proof of publication")}</a>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
