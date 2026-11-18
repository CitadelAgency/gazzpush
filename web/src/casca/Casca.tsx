// Casca do veículo (DESIGN.md §5 e §12). Computador (≥ 1024 px): a mesa (lateral de 256 px e moldura) com a folha de
// papel por cima; na lateral, o seletor de veículo, "Nova ideia" (N), "Ir para…" (⌘K), as seções em linhas de 34 px, um
// card com o que está acontecendo (Em produção, Primeiros passos ou Hoje), o grupo Veículo (recolhe) e a conta no pé; no
// alto da folha, o fólio. Celular: barra no alto (veículo, avatar) e navegação embaixo (Ideias · Aprovar · + · Postar ·
// Postados), opacas, separadas por fio. Aba ativa em grafite.
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Navigate, Outlet, ScrollRestoration, useLocation, useNavigate, useParams } from "react-router";
import { Abertura, FalhaCarga, atalhoLivre } from "../comum";
import {
  ETAPAS, avisoNovaFora, barrasSparkline, hora, instante, linhaEspera, linhaSemana, modoNova, postaSozinho, postadosPorDia, primeirosPassos, rotuloEtapa,
  useFontes, usePautas, usePecas, useProntos, usePublicacoes, useStatusPeca, type ModoNova, type PecaFila,
} from "../fila";
import { t } from "../idioma";
import MarcaGazzpush from "../kit/MarcaGazzpush";
import { lembrarVeiculo, useMe } from "../sessao";
import NaoEncontrada from "../telas/NaoEncontrada";
import { partesVeiculo, secoes, type CtxCasca, type ModoPeca } from "./contexto";
import {
  IconeAprovar, IconeBusca, IconeCerto, IconeContas, IconeEquipe, IconeFechar, IconeFontes, IconeIdeias, IconeKit, IconeMais, IconePlano, IconeMarca, IconePostados, IconePostar, IconeRaio, IconeSeta, IconeTextos, Registro,
} from "./icones";
import FolhaAtalhos from "./FolhaAtalhos";
import { Folio } from "./Folio";
import FolhaNova, { type Trazida } from "./FolhaNova";
import { Marca, MenuConta, SeletorVeiculo, useSair } from "./Menus";
import Paleta, { atalhoPaleta } from "./Paleta";


const ICONES = { "": IconeIdeias, aprovar: IconeAprovar, postar: IconePostar, postados: IconePostados } as const;
const ICONES_VEICULO = { marca: IconeMarca, contas: IconeContas, fontes: IconeFontes, equipe: IconeEquipe, kit: IconeKit, plano: IconePlano, chaves: IconeRaio } as const;

export default function Casca() {
  const { veiculo: slug } = useParams();
  const local = useLocation();
  const me = useMe();
  const veiculo = me.data?.tenants.find((t) => t.slug === slug);
  const saida = useSair();
  const navegar = useNavigate();
  const folha = modoNova(new URLSearchParams(local.search).get("nova"));
  const [modoPeca, marcarPeca] = useState<ModoPeca>(null);
  const revisao = modoPeca === "revisao";
  // A leitura do + Nova que terminou com a folha fechada: o aviso fica na tela até "Ver" ou fechar, com o veículo em
  // que a leitura começou (a pessoa pode ter trocado de veículo nesse meio-tempo).
  const [trazidaFora, setTrazidaFora] = useState<{ r: Trazida; slug: string } | null>(null);
  useEffect(() => { if (veiculo) lembrarVeiculo(veiculo.slug); }, [veiculo]);
  // Trocou de tela: o foco vai para o começo do conteúdo novo (o link clicado sumiu com a tela velha), sem rolar.
  const conteudo = useRef<HTMLElement>(null);
  const primeira = useRef(true);
  useEffect(() => {
    if (primeira.current) { primeira.current = false; return; }
    conteudo.current?.focus({ preventScroll: true });
  }, [local.pathname]);

  // ⌘K / Ctrl K abre a paleta de comandos. A paleta do editor da Matéria usa a mesma tecla e responde primeiro (ela
  // chama preventDefault): aqui só vale o que ninguém tratou.
  const [paleta, setPaleta] = useState(false);
  // Na mesa de um texto (/textos/:id) o ⌘K é do editor da Matéria, mesmo com o foco fora do texto (o painel, o corpo).
  const naMesa = /\/textos\/[^/]+$/.test(local.pathname);
  const naMesaRef = useRef(naMesa);
  naMesaRef.current = naMesa;
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "k" || naMesaRef.current) return;
      e.preventDefault();
      setPaleta((v) => !v);
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, []);
  // N abre a Nova ideia e ? abre a folha de atalhos: uma tecla só, com o foco no conteúdo e fora de campo (§6.12).
  const [atalhos, setAtalhos] = useState(false);
  const abrirNovaRef = useRef<() => void>(() => {});
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (!atalhoLivre(e) || naMesaRef.current) return;
      if (e.key === "?") { e.preventDefault(); setAtalhos(true); }
      else if (e.key.toLowerCase() === "n" && !e.shiftKey) { e.preventDefault(); abrirNovaRef.current(); }
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, []);

  if (me.isPending) return <Abertura />;
  if (me.isError) {
    return <main className="mx-auto max-w-[560px] px-5 pt-16"><FalhaCarga oque={t("a sua conta", "your account")} tentar={() => me.refetch()} /></main>;
  }
  if (!me.data) return <Navigate to={`/entrar?de=${encodeURIComponent(local.pathname)}`} replace />;
  if (!veiculo) return <NaoEncontrada mensagem={t("Esse veículo não existe ou você não faz parte dele.", "This publication doesn't exist or you're not part of it.")} />;

  const ctx: CtxCasca = { veiculo, me: me.data, marcarPeca };
  // + Nova: a folha mora na URL (`?nova=<aba>`) por cima da tela atual. Quem abriu por aqui volta no histórico ao
  // fechar; quem chegou com o `?nova` na URL só perde o parâmetro.
  const abrirNova = () => { setTrazidaFora(null); navegar({ pathname: local.pathname, search: "?nova=link" }, { state: { folha: true } }); };
  abrirNovaRef.current = abrirNova;
  const comNova = (m: ModoNova | null) => {
    const b = new URLSearchParams(local.search);
    if (m) b.set("nova", m); else b.delete("nova");
    return { pathname: local.pathname, search: b.size ? `?${b}` : "" };
  };
  const trocarAba = (m: ModoNova) => navegar(comNova(m), { replace: true, state: local.state });
  const fecharNova = () => ((local.state as { folha?: boolean } | null)?.folha ? navegar(-1) : navegar(comNova(null), { replace: true }));
  return (
    <div data-casca className="min-h-dvh lg:pl-64">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-btn focus:bg-papel focus:px-4 focus:py-3 focus:font-bold">
        {t("Pular para o conteúdo", "Skip to content")}
      </a>
      <Lateral ctx={ctx} modoPeca={modoPeca} onSair={() => saida.mutate()} onNova={abrirNova} onPaleta={() => setPaleta(true)} onAtalhos={() => setAtalhos(true)} />
      {/* A moldura da folha (só no computador): fixa e vazada, pinta a mesa por fora e desenha a borda de papel. */}
      <div aria-hidden="true" className="moldura" />
      <header className="fixed inset-x-0 top-0 z-30 flex h-[58px] items-center gap-2 bg-papel pr-3 pl-3 shadow-fio lg:hidden">
        <Marca veiculo={veiculo} className="size-8 text-[15px]" />
        <SeletorVeiculo veiculo={veiculo} veiculos={me.data.tenants} />
        <MenuConta me={me.data} onSair={() => saida.mutate()} partes textos={veiculo.modo === "autoral"} />
      </header>
      {saida.isError && (
        <div role="alert" className="faixa-erro fixed inset-x-3 top-[66px] z-40 flex flex-wrap items-baseline gap-x-2 shadow-curta lg:top-4 lg:right-6 lg:left-[280px]">
          <span>{t("Não deu para sair agora; você continua conectado.", "Couldn't sign out right now; you're still signed in.")}</span>
          <button type="button" onClick={() => saida.mutate()} className="cursor-pointer font-bold underline underline-offset-3">{t("Tentar de novo", "Try again")}</button>
        </div>
      )}
      {trazidaFora && (
        <p role="status" className="fixed inset-x-3 bottom-[calc(78px+env(safe-area-inset-bottom))] z-40 m-0 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-faixa bg-papel-2 py-1.5 pr-1 pl-3 text-[15px] font-bold text-texto-forte shadow-curta lg:right-6 lg:bottom-6 lg:left-auto lg:max-w-[560px]">
          <span className="py-1">{avisoNovaFora(trazidaFora.r)}{trazidaFora.slug !== veiculo.slug ? ` (${me.data.tenants.find((t) => t.slug === trazidaFora.slug)?.nome ?? t("outro veículo", "another publication")})` : ""}</span>
          <Link to={`/t/${trazidaFora.slug}${trazidaFora.r.peca ? `/p/${trazidaFora.r.peca.id}` : ""}`} state={{ nova: trazidaFora.r }} viewTransition onClick={() => setTrazidaFora(null)}
            className="link-acao inline-flex min-h-9 items-center">{t("Ver", "View")}</Link>
          <button type="button" onClick={() => setTrazidaFora(null)} aria-label={t("Fechar aviso", "Close notice")}
            className="ml-auto grid size-9 cursor-pointer place-items-center rounded-btn text-apoio hover:bg-papel hover:text-texto-forte">
            <IconeFechar className="size-5" />
          </button>
        </p>
      )}
      <main id="conteudo" ref={conteudo} tabIndex={-1} className={`folha-mesa pt-[58px] outline-none lg:pt-2 lg:pr-2 lg:pb-2 ${revisao ? "" : "pb-[calc(76px+env(safe-area-inset-bottom))]"}`}>
        <Folio veiculo={veiculo} />
        {/* Só o miolo troca na troca de tela (view-transition-name): a mesa, a moldura e o fólio ficam parados. */}
        <div id="miolo">
          {/* No fluxo da página, no alto: presa ao fim da tela, ela cobria os botões de quem está montando o veículo. */}
          {veiculo.plano === "teste" && (
            <p role="status" className="faixa-aviso m-0 flex flex-wrap items-center gap-x-3 rounded-none px-5 lg:px-12">
              <span>{t("Este veículo ainda não tem plano. Assine para produzir posts e conferir textos.", "This outlet has no plan yet. Subscribe to produce posts and check texts.")}</span>
              {veiculo.papel === "admin" && <Link to={`/t/${veiculo.slug}/veiculo?aba=plano`} className="link-acao inline-flex min-h-9 items-center">{t("Ver os planos", "See the plans")}</Link>}
            </p>
          )}
          <Outlet context={ctx} />
        </div>
      </main>
      <ScrollRestoration />
      {!revisao && <NavBaixo tenantId={veiculo.id} papel={veiculo.papel} modoPeca={modoPeca} onNova={abrirNova} />}
      {folha && (
        <FolhaNova tenantId={veiculo.id} slug={veiculo.slug} autoral={veiculo.modo === "autoral"} modo={folha} trocar={trocarAba} fechar={fecharNova} aoFecharLendo={(r, slug) => setTrazidaFora({ r, slug })} />
      )}
      <Paleta aberta={paleta} fechar={() => setPaleta(false)} veiculo={veiculo} veiculos={me.data.tenants} onNova={abrirNova} onSair={() => saida.mutate()} />
      <FolhaAtalhos aberta={atalhos} fechar={() => setAtalhos(false)} autoral={veiculo.modo === "autoral"} />
    </div>
  );
}

/**
 * O que espera você em cada seção: posts para aprovar (mesma consulta das Ideias) e aprovados que alguém posta à mão
 * (os que postam sozinhos não esperam ninguém). Somem ao aprovar e ao postar. O repórter só traz ideias: para ele
 * nada "espera", e o contador (que é a próxima ação) não aparece.
 */
function useEsperando(tenantId: string, papel: string): Record<string, number> {
  const aprovar = usePecas(tenantId).data?.total.revisao ?? 0;
  const postar = useProntos(tenantId).data?.manuais ?? 0;
  return papel === "reporter" ? {} : { aprovar, postar };
}
const ESPERANDO: Record<string, string> = {
  get aprovar() { return t("para aprovar", "to approve"); },
  get postar() { return t("para postar", "to post"); },
};

const SECAO_DO_POST: Record<string, string> = { revisao: "aprovar", decidida: "aprovar", postar: "postar", postado: "postados" };
/** A tela de um post marca a seção em que ele está (ModoPeca); fora dela, vale a rota. */
const useSecaoPeca = (modo: ModoPeca) => (/\/t\/[^/]+\/p\//.test(useLocation().pathname) ? (modo ? SECAO_DO_POST[modo] : "") : null);

/** Contador do que espera você (lápis azul: é a próxima ação). Nunca total: Ideias e Postados não têm. */
function Contador({ n, oque }: { n: number; oque: string }) {
  if (!n) return null;
  return <b className="selo">{n}<span className="sr-only"> {oque}</span></b>;
}

// Um sistema só de rótulo na lateral: todo grupo que não é a navegação principal (Veículo e os cards) leva mono em
// caixa-alta; o seletor e a conta são nomes próprios, em sans. A navegação principal não tem rótulo.
const ROTULO = "lat-rotulo m-0";
const CARTAO = "mt-3 rounded-faixa bg-branco p-3 shadow-curta";
const CHAVE_GRUPO = "redacao:lateral-veiculo";

/**
 * Lateral do computador (DESIGN.md §5 e §12): veículo (logo, nome, @), "Nova ideia" (N), "Ir para…" (⌘K), as seções do
 * fluxo com o que espera você, um card com o que está acontecendo (Em produção; até o primeiro post sair, Primeiros
 * passos; senão, Hoje), o grupo Veículo (recolhe; a linha Fontes diz a situação da coleta) e a conta no pé. A única
 * coisa azul cheia é a próxima ação: o contador do que espera você, ou "Nova ideia" para quem só traz ideias (repórter).
 */
function Lateral({ ctx: { veiculo, me }, modoPeca, onSair, onNova, onPaleta, onAtalhos }: { ctx: CtxCasca; modoPeca: ModoPeca; onSair: () => void; onNova: () => void; onPaleta: () => void; onAtalhos: () => void }) {
  const esperando = useEsperando(veiculo.id, veiculo.papel);
  // O grupo Veículo recolhe, e a escolha fica neste navegador. Com uma parte dele aberta na tela, ele não fecha.
  const [grupoAberto, setGrupoAberto] = useState(() => { try { return localStorage.getItem(CHAVE_GRUPO) !== "fechado"; } catch { return true; } });
  const alternarGrupo = () => setGrupoAberto((v) => { try { localStorage.setItem(CHAVE_GRUPO, v ? "fechado" : "aberto"); } catch { /* modo privado */ } return !v; });
  const local = useLocation();
  const naTelaVeiculo = /\/veiculo$/.test(local.pathname);
  const abaVeiculo = naTelaVeiculo ? (new URLSearchParams(local.search).get("aba") ?? "marca") : null;
  const pautas = usePautas(veiculo.id);
  const pecas = usePecas(veiculo.id);
  const prontos = useProntos(veiculo.id);
  const publicacoes = usePublicacoes(veiculo.id);
  const secaoPeca = useSecaoPeca(modoPeca);
  const marcada = (to: string, ativo: boolean) => !naTelaVeiculo && (secaoPeca === null ? ativo : to === secaoPeca);
  const novas = pautas.data?.novasDesde ?? 0;
  const reporter = veiculo.papel === "reporter";
  // Em produção: o post mais antigo em rascunho; os outros viram "+n produzindo" (o total da API vale quando a lista para em 50).
  const rascunhos = (pecas.data?.pecas ?? []).filter((p) => p.status === "rascunho").sort((a, b) => instante(a.created_at) - instante(b.created_at));
  const produzindo = rascunhos[0];
  const maisProduzindo = Math.max(pecas.data?.total.rascunho ?? 0, rascunhos.length) - 1;
  const carregou = pautas.isSuccess && pecas.isSuccess && prontos.isSuccess && publicacoes.isSuccess;
  // A semana do Hoje precisa dos 7 dias inteiros: enquanto a publicação mais antiga carregada ainda é desta semana e
  // há mais páginas, busca a próxima (até 5 páginas, 100 posts; acima disso a semana sai contada até aí).
  const publicadas = publicacoes.data?.pages.flatMap((pg) => pg.publicacoes) ?? [];
  const maisAntigaCarregada = publicadas[publicadas.length - 1]?.publicado_em ?? null;
  // Página que falhou não é pedida de novo em laço: fica a semana contada até ali (o Postados tem o tentar de novo).
  const semanaIncompleta = !!publicacoes.hasNextPage && !publicacoes.isFetchingNextPage && !publicacoes.isFetchNextPageError && (publicacoes.data?.pages.length ?? 0) < 5
    && !!maisAntigaCarregada && instante(maisAntigaCarregada) > Date.now() - 7 * 864e5;
  useEffect(() => { if (semanaIncompleta) publicacoes.fetchNextPage(); }, [semanaIncompleta, publicacoes]);
  const passos = carregou
    ? primeirosPassos({
        ideias: pautas.data.pautas.length, posts: Object.values(pecas.data.total).reduce((a, b) => a + b, 0),
        prontos: prontos.data.pecas.length, postados: publicacoes.data.pages[0]?.publicacoes.length ?? 0,
      })
    : null;
  return (
    <aside data-lateral aria-label={t("Veículo e seções", "Publication and sections")} className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col overflow-y-auto bg-mesa px-3 lg:flex">
      {/* O topo fica preso: em tela baixa a lateral rola por baixo dele, e o veículo e a Nova ideia continuam no lugar. */}
      <div className="sticky top-0 z-10 -mx-3 grid gap-2 bg-mesa px-3 pt-2.5 pb-2">
        <SeletorVeiculo veiculo={veiculo} veiculos={me.tenants} lateral />
        <button type="button" onClick={onNova} aria-haspopup="dialog" aria-keyshortcuts="N"
          className={`flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-btn pr-2 pl-2.5 text-[14px] font-semibold transition-[background-color,box-shadow,scale] duration-150 ${reporter ? "bg-tinta text-sobre-tinta" : "bg-branco text-tinta shadow-curta hover:shadow-eleva"}`}>
          <IconeMais className="size-[18px]" /> {t("Nova ideia", "New idea")}
          <span aria-hidden="true" className={`kbd ml-auto ${reporter ? "bg-transparent text-sobre-tinta shadow-[0_0_0_1px_rgb(255_255_255/.35)]" : ""}`}>N</span>
        </button>
        {/* Ir para qualquer lugar: seções, posts pelo título, veículos (⌘K). Tem cara de campo para o atalho ficar à vista. */}
        <button type="button" onClick={onPaleta} aria-haspopup="dialog" aria-keyshortcuts="Control+K Meta+K"
          className="flex min-h-[34px] w-full cursor-pointer items-center gap-2 rounded-btn bg-papel-3 pr-2 pl-2.5 text-[14px] text-apoio shadow-[inset_0_-1px_0_var(--color-fio)] transition-[background-color,color,scale] duration-150 hover:bg-branco hover:text-texto-forte">
          <IconeBusca className="size-4" /> {t("Ir para…", "Go to…")}
          <span aria-hidden="true" className="kbd ml-auto">{atalhoPaleta()}</span>
        </button>
      </div>
      <nav aria-label={t("Seções", "Sections")} className="grid gap-px pt-1.5">
        {/* Veículo de autor: os Textos (mesa revisora) abrem o Fluxo; a seção segue marcada dentro de um texto. */}
        {veiculo.modo === "autoral" && (
          <NavLink to="textos" viewTransition className={({ isActive }) => `lat-item ${marcada("textos", isActive) ? "lat-ativa" : ""}`}>
            {({ isActive }) => (
              <>
                {marcada("textos", isActive) && <span aria-hidden="true" className="marca-margem" />}
                <IconeTextos className="size-[18px]" />
                <span className="min-w-0 flex-1 truncate">{t("Textos", "Texts")}</span>
              </>
            )}
          </NavLink>
        )}
        {secoes().map(({ to, rotulo }) => {
          const Icone = ICONES[to];
          return (
            <NavLink key={to} to={to} end viewTransition className={({ isActive }) => `lat-item ${marcada(to, isActive) ? "lat-ativa" : ""}`}>
              {({ isActive }) => (
                <>
                  {marcada(to, isActive) && <span aria-hidden="true" className="marca-margem" />}
                  <Icone className="size-[18px]" />
                  <span className="min-w-0 flex-1 truncate">{rotulo}</span>
                  {to === "" && novas > 0 && <span className="mono flex-none text-[11px] text-apoio">{t(`${novas} nova${novas > 1 ? "s" : ""}`, `${novas} new`)}</span>}
                  {ESPERANDO[to] && <span className="flex-none"><Contador n={esperando[to] ?? 0} oque={ESPERANDO[to]} /></span>}
                </>
              )}
            </NavLink>
          );
        })}
      </nav>
      {passos ? (
        <section aria-labelledby="lt-passos" className={CARTAO}>
          <h2 id="lt-passos" className={`${ROTULO} mb-2.5 flex items-baseline justify-between font-normal`}>
            {t("Primeiros passos", "Getting started")} <span className="normal-case tracking-normal">{passos.filter((p) => p.feito).length} {t("de", "of")} {passos.length}</span>
          </h2>
          <ol className="m-0 grid list-none gap-2 p-0 text-[13.5px]">
            {passos.map((p, i) => {
              const proximo = !p.feito && passos.slice(0, i).every((x) => x.feito);
              const para = p.id === "aprovado" ? (esperando.aprovar ? "aprovar" : "") : p.id === "postado" ? "postar" : "";
              return (
                <li key={p.id} className={`flex items-center gap-2 ${p.feito ? "text-apoio" : proximo ? "font-bold text-texto-forte" : "text-apoio"}`}>
                  <span aria-hidden="true" className={`grid size-[18px] flex-none place-items-center rounded-full text-[11px] ${p.feito ? "bg-verde-claro text-verde" : proximo ? "bg-tinta text-sobre-tinta" : "bg-papel-2 text-apoio"}`}>
                    {p.feito ? <IconeCerto className="size-3" /> : i + 1}
                  </span>
                  {proximo && p.id === "ideia" ? (
                    <button type="button" onClick={onNova} className="link-acao cursor-pointer">{p.rotulo}</button>
                  ) : proximo ? (
                    <Link to={para} viewTransition className="link-acao">{p.rotulo}</Link>
                  ) : (
                    <span className={p.feito ? "line-through decoration-fio-forte" : ""}>{p.rotulo}</span>
                  )}
                  <span className="sr-only">{p.feito ? t(", feito", ", done") : proximo ? t(", próximo passo", ", next step") : ""}</span>
                </li>
              );
            })}
          </ol>
        </section>
      ) : produzindo ? (
        <EmProducao tenantId={veiculo.id} peca={produzindo} mais={maisProduzindo} />
      ) : null}
      {carregou && !passos && !produzindo && (
        <Hoje
          publicados={publicacoes.data.pages.flatMap((pg) => pg.publicacoes).filter((p) => p.modo !== "simulada").map((p) => p.publicado_em)}
          aprovar={reporter ? null : { n: esperando.aprovar ?? 0, maisAntigo: pecas.data.pecas.find((p) => p.status === "revisao")?.updated_at ?? null }}
          postar={reporter ? null : (() => {
            const manual = prontos.data.pecas.find((p) => !postaSozinho(p.conta_modo));
            return { n: esperando.postar ?? 0, maisAntigo: manual?.updated_at ?? null, anotado: manual?.agendado_para ?? null };
          })()} />
      )}
      {/* Grupo Veículo: recolhe para a lateral caber em tela baixa. A linha Fontes diz a situação da coleta. */}
      <button type="button" data-linha onClick={alternarGrupo} aria-expanded={grupoAberto || naTelaVeiculo} aria-controls="lt-veiculo"
        className={`${ROTULO} mt-3.5 flex min-h-[30px] w-full cursor-pointer items-center justify-between rounded-faixa pr-2 pl-2.5 hover:bg-papel-3 hover:text-texto-forte active:bg-aperto`}>
        {t("Veículo", "Publication")}
        <IconeSeta className={`size-3.5 transition-transform duration-200 ${grupoAberto || naTelaVeiculo ? "" : "-rotate-90"}`} />
      </button>
      <nav id="lt-veiculo" aria-label={t("Veículo", "Publication")} hidden={!(grupoAberto || naTelaVeiculo)} className="grid gap-px pb-3">
        {partesVeiculo().map(({ aba, rotulo }) => {
          const Icone = ICONES_VEICULO[aba];
          const ativa = abaVeiculo === aba;
          return (
            <Link key={aba} to={`veiculo?aba=${aba}`} viewTransition aria-current={ativa ? "page" : undefined} className={`lat-item ${ativa ? "lat-ativa" : ""}`}>
              {ativa && <span aria-hidden="true" className="marca-margem" />}
              <Icone className="size-[18px]" />
              <span className="min-w-0 flex-1 truncate">{rotulo}</span>
              {aba === "fontes" && <EstadoFontes tenantId={veiculo.id} />}
            </Link>
          );
        })}
      </nav>
      {/* A conta fica presa no pé: em tela baixa a lateral rola por baixo dela, e o menu continua à mão. */}
      <div className="sticky bottom-0 z-10 -mx-3 mt-auto bg-mesa px-3 pt-2 pb-2.5">
        <MarcaGazzpush className="mb-2 ml-2 w-32" />
        <MenuConta me={me} onSair={onSair} papel={veiculo.papel} onAtalhos={onAtalhos} />
      </div>
    </aside>
  );
}

/** O post que está sendo produzido agora: etapa, passo de 4 e o que vem depois. Acompanha a cada 5 s. */
function EmProducao({ tenantId, peca, mais }: { tenantId: string; peca: PecaFila; mais: number }) {
  const status = useStatusPeca(tenantId, peca.id);
  const etapa = status.data?.etapa ?? null;
  const passo = etapa ? ETAPAS.indexOf(etapa) + 1 : 0;
  return (
    <section aria-labelledby="lt-producao" className={CARTAO}>
      <h2 id="lt-producao" className={`${ROTULO} mb-2 flex items-center justify-between gap-2 font-normal`}>
        {t("Em produção", "In production")}
        <Registro className="text-texto-forte" />
      </h2>
      <p className="m-0 line-clamp-2 text-[13.5px] leading-[1.3] font-semibold text-texto-forte">{peca.manchete ?? peca.titulo}</p>
      {/* As etapas em grafite (andamento não é ação): as feitas cheias, a de agora com o traço que corre. */}
      <span aria-hidden="true" className="etapas mt-2.5">
        {ETAPAS.map((e, i) => <i key={e} data-feita={i < passo - 1 ? "" : undefined} data-agora={i === Math.max(passo - 1, 0) ? "" : undefined} />)}
      </span>
      <p className="mono m-0 mt-2 text-[11px] text-apoio">{etapa ? `${rotuloEtapa(etapa, peca.formato)} · ${passo} ${t("de", "of")} ${ETAPAS.length}` : t("começando", "starting")}</p>
      <p className="m-0 mt-2 flex items-baseline justify-between text-[13px] text-apoio">
        <span>{t("depois: Para aprovar", "next: To approve")}</span>
        <Link to={`p/${peca.id}`} viewTransition className="link-acao text-[13px]">{t("Acompanhar", "Follow")}</Link>
      </p>
      {mais > 0 && (
        <p className="m-0 mt-1.5 text-[13px]">
          <Link to="" viewTransition className="link-acao text-[13px]">{t(`+${mais} produzindo`, `+${mais} in production`)}</Link>
        </p>
      )}
    </section>
  );
}

type Fila = { n: number; maisAntigo: string | null; anotado?: string | null };

/**
 * Hoje, no lugar do card de andamento quando não há nada produzindo nem Primeiros passos: a semana em sete barras
 * (hoje marcada) com "hoje n · semana n", e, embaixo, quanto espera em cada fila e há quanto tempo o mais antigo
 * espera (o horário anotado entra no lugar da espera). É o contexto que o contador da lateral não tem. Ritmo, não
 * total: lê as páginas de Postados já carregadas (20 por página), sem as simuladas (nada saiu de verdade). Para o
 * repórter nada espera, e as filas não aparecem. A próxima coleta mora na linha Fontes.
 */
function Hoje({ publicados, aprovar, postar }: { publicados: (string | null)[]; aprovar: Fila | null; postar: Fila | null }) {
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setAgora(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  const porDia = postadosPorDia(publicados, agora);
  // Do tamanho de uma palavra, ao lado do número (cabe na lateral de 256 px sem quebrar a linha). Vão de 4 px: os sete
  // dias se leem um a um, mesmo quando todos são toco.
  const W = 60, H = 20;
  const barras = barrasSparkline(porDia, W, H, 4);
  const filas = [
    aprovar && linhaEspera({ ...aprovar, oque: t("para aprovar", "to approve") }, agora),
    postar && linhaEspera({ ...postar, oque: t("para postar", "to post") }, agora),
  ].filter((x): x is string => !!x);
  return (
    <section aria-labelledby="lt-hoje" className={CARTAO}>
      <h2 id="lt-hoje" className={`${ROTULO} mb-2.5 font-normal`}>{t("Hoje", "Today")}</h2>
      <div className="flex items-end gap-3">
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true" className="block flex-none overflow-visible">
          <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} stroke="var(--color-fio-forte)" strokeWidth="1" />
          {barras.map((b, i) => { const h = Math.max(b.h, 3); return <rect key={i} x={b.x} y={H - h} width={b.w} height={h} rx="1" fill={i === barras.length - 1 ? "var(--color-texto-forte)" : "var(--color-fio-forte)"} />; })}
        </svg>
        <p className="mono m-0 text-[11px] whitespace-nowrap text-apoio">{linhaSemana(porDia)}</p>
      </div>
      {filas.length > 0 && (
        <>
          <p className={`${ROTULO} mt-3 mb-1.5 border-t border-fio pt-2.5`}>{t("esperam · o mais antigo", "waiting · oldest")}</p>
          <ul className="m-0 grid list-none gap-1 p-0">
            {filas.map((f) => {
              // "4 para aprovar · há 23 h": o que espera à esquerda, há quanto tempo à direita.
              const [oque, ...resto] = f.split(" · ");
              return (
                <li key={f} className="mono flex items-baseline justify-between gap-2 text-[11px] text-apoio">
                  <span className="text-texto-forte">{oque}<span className="sr-only"> · </span></span>
                  <span className="whitespace-nowrap">{resto.join(" · ")}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

/**
 * A situação das fontes, na própria linha Fontes do grupo Veículo: "coleta 08:37" quando tudo está bem ou "1
 * indisponível" em âmbar. A aba Fontes tem o detalhe; a lateral não cresce com o número de feeds. Falha de carga não vira
 * fato (DESIGN.md §6.8): "não carregou", e a aba tem o tentar de novo.
 */
function EstadoFontes({ tenantId }: { tenantId: string }) {
  const fontes = useFontes(tenantId);
  if (fontes.isPending || (fontes.isSuccess && !fontes.data.fontes.length)) return null;
  const fora = fontes.data?.fontes.filter((f) => !f.ok).length ?? 0;
  return (
    <span className="mono flex-none text-[11px] text-apoio">
      <span className="sr-only">: </span>
      {fontes.isError ? t("não carregou", "didn't load") : fora > 0 ? <span className="text-ambar">{fora === 1 ? t("1 indisponível", "1 unavailable") : t(`${fora} indisponíveis`, `${fora} unavailable`)}</span> : fontes.data.coletaEm ? t(`coleta ${hora(fontes.data.coletaEm)}`, `fetched ${hora(fontes.data.coletaEm)}`) : ""}
    </span>
  );
}

function NavBaixo({ tenantId, papel, modoPeca, onNova }: { tenantId: string; papel: string; modoPeca: ModoPeca; onNova: () => void }) {
  const esperando = useEsperando(tenantId, papel);
  const secaoPeca = useSecaoPeca(modoPeca);
  const item = (ativo: boolean) =>
    `relative flex flex-col items-center justify-center gap-0.5 text-[12px] no-underline ${ativo
      ? "font-bold text-texto-forte after:absolute after:bottom-1.5 after:h-0.5 after:w-9 after:rounded-[1px] after:bg-texto-forte"
      : "text-apoio"}`;
  const [ideias, ...resto] = secoes();
  const link = ({ to, curto }: ReturnType<typeof secoes>[number]) => {
    const Icone = ICONES[to];
    return (
      <NavLink key={to} to={to} end viewTransition className={({ isActive }) => item(secaoPeca === null ? isActive : to === secaoPeca)}>
        <span className="relative grid h-8 place-items-center">
          <Icone />
          {ESPERANDO[to] && esperando[to] > 0 && (
            <b className="absolute -top-1 -right-3 min-w-[18px] rounded-full bg-texto-forte px-1 text-center text-[11px] leading-[18px] text-papel">
              {esperando[to]}<span className="sr-only"> {ESPERANDO[to]}</span>
            </b>
          )}
        </span>
        {curto}
      </NavLink>
    );
  };
  return (
    <nav aria-label={t("Seções", "Sections")} className="fixed inset-x-0 bottom-0 z-30 grid h-[calc(66px+env(safe-area-inset-bottom))] grid-cols-5 bg-papel pb-[env(safe-area-inset-bottom)] shadow-[0_-1px_0_var(--color-fio-forte)] lg:hidden">
      {link(ideias)}
      {link(resto[0])}
      <button type="button" onClick={onNova} aria-haspopup="dialog" className={`${item(false)} cursor-pointer text-tinta`}>
        <span className="grid h-8 w-11 place-items-center rounded-btn bg-tinta-clara text-tinta"><IconeMais /></span>
        <span className="text-tinta">{t("Nova", "New")}</span>
      </button>
      {resto.slice(1).map(link)}
    </nav>
  );
}
