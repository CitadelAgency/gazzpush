// Regras puras da fila (sem React nem cliente da API, para testar no vitest do Worker em test/web.test.ts): datas,
// visita anterior, resumo do que mudou, nomes das etapas e o motivo de falha em linguagem de leigo.
import { locale, t } from "./idioma";

export const FUSO = "America/Sao_Paulo";

/** Data do D1 ("AAAA-MM-DD HH:MM:SS", UTC sem fuso) ou ISO → milissegundos. */
export const instante = (sql: string) => new Date(sql.includes("T") ? sql : `${sql.replace(" ", "T")}Z`).getTime();

/** "há 5 min", "há 3 h", "ontem, 20:30", "28/10". */
export function quando(sql: string, agora = new Date()) {
  const d = new Date(instante(sql));
  const min = Math.max(0, Math.round((agora.getTime() - d.getTime()) / 60000));
  if (min < 1) return t("agora", "now");
  if (min < 60) return t(`há ${min} min`, `${min} min ago`);
  if (min < 6 * 60) return t(`há ${Math.round(min / 60)} h`, `${Math.round(min / 60)} h ago`);
  const dia = (x: Date) => x.toLocaleDateString("pt-BR", { timeZone: FUSO });
  const hm = d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit", timeZone: FUSO });
  if (dia(d) === dia(agora)) return t(`hoje, ${hm}`, `today, ${hm}`);
  if (dia(d) === dia(new Date(agora.getTime() - 864e5))) return t(`ontem, ${hm}`, `yesterday, ${hm}`);
  return d.toLocaleDateString(locale(), { day: "2-digit", month: "2-digit", timeZone: FUSO });
}

export const hora = (sql: string) =>
  new Date(instante(sql)).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit", timeZone: FUSO });

/** Há quanto tempo algo espera, como duração: "agora", "5 min", "3 h", "23 h", "2 dias". A mesma gramática em toda lista. */
export function espera(sql: string, agora = new Date()): string {
  const min = Math.max(0, Math.round((agora.getTime() - instante(sql)) / 60000));
  if (min < 1) return t("agora", "now");
  if (min < 60) return `${min} min`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h`;
  return t(`${Math.round(min / 1440)} dias`, `${Math.round(min / 1440)} days`);
}

/** Fração da espera em relação à mais antiga da lista (traço proporcional): 1 para a mais antiga, 0 para "agora". */
export function fracaoEspera(sql: string, maisAntiga: string, agora = new Date()): number {
  const total = agora.getTime() - instante(maisAntiga);
  if (total <= 0) return 0;
  return Math.max(0, Math.min(1, (agora.getTime() - instante(sql)) / total));
}

// ── visita anterior (por veículo, neste aparelho) ───────────────────────────────────────────────────────────────

const chaveVisita = (tenantId: string) => `redacao:visita:${tenantId}`;
const anteriores = new Map<string, number | null>();

/**
 * Quando foi a visita anterior às Ideias deste veículo. Lida uma vez por carga do app: enquanto ele fica aberto, o
 * "novo" continua relativo à mesma visita, mesmo depois de marcar a atual.
 */
export function visitaAnterior(tenantId: string): number | null {
  if (!anteriores.has(tenantId)) {
    let v: number | null = null;
    try { v = Number(localStorage.getItem(chaveVisita(tenantId))) || null; } catch { /* modo privado */ }
    anteriores.set(tenantId, v);
  }
  return anteriores.get(tenantId)!;
}

/** Marca a visita de agora (chamar só depois que as Ideias carregaram: quem não viu a lista não a visitou). */
export function marcarVisita(tenantId: string, agora = Date.now()) {
  visitaAnterior(tenantId);
  try { localStorage.setItem(chaveVisita(tenantId), String(agora)); } catch { /* modo privado */ }
}

export const novaDesde = (sql: string, anterior: number | null) => anterior !== null && instante(sql) > anterior;

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** A linha "Desde a sua última visita". Conta só o que mudou, nunca o total (DESIGN.md §6.2). */
export function resumoVisita(a: { anterior: number | null; prontas: number; novas: number }): { rotulo: string; texto: string } {
  if (a.anterior === null) {
    return {
      rotulo: t("Para começar:", "To start:"),
      texto: a.novas
        ? t(`${plural(a.novas, "ideia sugerida", "ideias sugeridas")} pelas suas fontes.`, `${plural(a.novas, "idea suggested", "ideas suggested")} by your sources.`)
        : t("as ideias aparecem aqui assim que as fontes trouxerem notícia.", "ideas show up here as soon as your sources bring in news."),
    };
  }
  const partes = [
    a.prontas ? plural(a.prontas, t("post pronto para aprovar", "post ready to approve"), t("posts prontos para aprovar", "posts ready to approve")) : "",
    a.novas ? plural(a.novas, t("ideia nova", "new idea"), t("ideias novas", "new ideas")) : "",
  ].filter(Boolean);
  return { rotulo: t("Desde a sua última visita:", "Since your last visit:"), texto: partes.length ? `${partes.join(t(" e ", " and "))}.` : t("nada novo.", "nothing new.") };
}

// ── primeiros passos (lateral, até o primeiro post sair) ────────────────────────────────────────────────────────

export type Passo = { id: "veiculo" | "ideia" | "aprovado" | "postado"; rotulo: string; feito: boolean };

/**
 * O caminho até o primeiro post no Instagram, já com o primeiro passo feito (o veículo existe): progresso começado
 * converte mais do que 0 de 4. Some quando o primeiro post sai.
 */
export function primeirosPassos(a: { ideias: number; posts: number; prontos: number; postados: number }): Passo[] | null {
  if (a.postados > 0) return null;
  return [
    { id: "veiculo", rotulo: t("Veículo criado", "Publication created"), feito: true },
    { id: "ideia", rotulo: t("Primeira ideia", "First idea"), feito: a.ideias + a.posts + a.prontos > 0 },
    { id: "aprovado", rotulo: t("Primeiro post aprovado", "First post approved"), feito: a.prontos > 0 },
    { id: "postado", rotulo: t("Primeiro post no Instagram", "First post on Instagram"), feito: false },
  ];
}

// ── hoje (lateral, quando não há Primeiros passos nem Em produção) ──────────────────────────────────────────────

const mesmoDia = (a: Date, b: Date) => a.toLocaleDateString("pt-BR", { timeZone: FUSO }) === b.toLocaleDateString("pt-BR", { timeZone: FUSO });

/** O cron das fontes roda a cada 15 min (triggers.crons em wrangler.jsonc). */
export const CRON_COLETA_MIN = 15;

/**
 * Quando as fontes voltam a ser coletadas: cada fonte vence `intervaloMin` depois da última coleta (nunca coletada:
 * já venceu) e é pega pelo primeiro cron depois disso (mesma regra de src/monitor/scheduled.ts). A mais próxima
 * manda. Fonte que o cron desistiu (`coletavel: false`, 10 falhas seguidas) não conta. Sem fonte coletável, nada.
 */
export function proximaColeta(fontes: { coletadaEm: string | null; intervaloMin: number; coletavel: boolean }[], agora = new Date()): Date | null {
  const vivas = fontes.filter((f) => f.coletavel);
  if (!vivas.length) return null;
  const vence = Math.min(...vivas.map((f) => (f.coletadaEm ? instante(f.coletadaEm) + f.intervaloMin * 60_000 : 0)));
  const tick = CRON_COLETA_MIN * 60_000;
  const base = Math.max(vence, agora.getTime());
  return new Date(Math.ceil(base / tick) * tick);
}

/**
 * Postados por dia nos últimos `dias` dias (o último é hoje), no fuso de São Paulo. Ritmo da semana, não total: quem
 * chama já tirou as publicações simuladas (nada saiu de verdade).
 */
export function postadosPorDia(publicados: (string | null)[], agora = new Date(), dias = 7): number[] {
  const chave = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: FUSO });
  const chaves = Array.from({ length: dias }, (_, i) => chave(new Date(agora.getTime() - (dias - 1 - i) * 864e5)));
  const n = chaves.map(() => 0);
  for (const p of publicados) {
    if (!p) continue;
    const i = chaves.indexOf(chave(new Date(instante(p))));
    if (i >= 0) n[i]++;
  }
  return n;
}

/** "hoje 2 · semana 11" (o último valor é hoje). */
export const linhaSemana = (porDia: number[]) => {
  const hoje = porDia[porDia.length - 1] ?? 0, semana = porDia.reduce((a, b) => a + b, 0);
  return t(`hoje ${hoje} · semana ${semana}`, `today ${hoje} · week ${semana}`);
};

/**
 * As barras de um sparkline de `valores` numa caixa w×h (uma por valor, da mais antiga à de hoje). Barra zero fica
 * com 1 px de base; tudo zero é só a linha de base, e isso é a informação.
 */
export function barrasSparkline(valores: number[], w = 96, h = 20, vao = 2): { x: number; y: number; w: number; h: number }[] {
  if (!valores.length) return [];
  const maior = Math.max(1, ...valores);
  const largura = (w - vao * (valores.length - 1)) / valores.length;
  return valores.map((v, i) => {
    const altura = v ? Math.max(2, Math.round((v / maior) * h)) : 1;
    return { x: Math.round(i * (largura + vao) * 100) / 100, y: h - altura, w: Math.round(largura * 100) / 100, h: altura };
  });
}

/**
 * Uma linha do "esperam · o mais antigo" do card Hoje: "4 para aprovar · há 23 h"; com horário anotado, ele entra no
 * lugar da espera ("2 para postar · anotado para hoje, 20:00"). Sem nada esperando, nada.
 */
export function linhaEspera(a: { n: number; oque: string; maisAntigo: string | null; anotado?: string | null }, agora = new Date()): string | null {
  if (!a.n) return null;
  const quando = a.anotado && instante(a.anotado) > agora.getTime()
    ? t(`anotado para ${quandoFuturo(a.anotado, agora)}`, `planned for ${quandoFuturo(a.anotado, agora)}`)
    : a.maisAntigo ? t(`há ${espera(a.maisAntigo, agora)}`, `${espera(a.maisAntigo, agora)} ago`) : "";
  return [`${a.n} ${a.oque}`, quando].filter(Boolean).join(" · ");
}

// ── produção ────────────────────────────────────────────────────────────────────────────────────────────────────

export type Etapa = "redigir" | "validar" | "ilustrar" | "renderizar";
export const ETAPAS: Etapa[] = ["redigir", "validar", "ilustrar", "renderizar"];

export function rotuloEtapa(e: Etapa, formato: string) {
  return {
    redigir: t("Escrever o texto", "Write the text"),
    validar: t("Conferir cada frase com as fontes", "Check each sentence against the sources"),
    ilustrar: t("Desenhar a ilustração", "Draw the illustration"),
    renderizar: formato === "post" ? t("Montar a imagem", "Build the image") : formato === "reels" ? t("Montar o vídeo", "Build the video") : t("Montar os cards", "Build the cards"),
  }[e];
}

type PecaTempo = { status: string; rodada: number; created_at: string; updated_at: string };

/**
 * O tempo medido da produção neste veículo: mediana, em segundos, do que os posts prontos para aprovar levaram da
 * criação até ficarem prontos (só a primeira rodada: uma reescrita soma a espera do editor). Fora de 0 a 60 min não
 * conta (instância retomada depois de parada). Sem histórico, null.
 */
export function tempoProducao(pecas: PecaTempo[]): number | null {
  const seg = pecas
    .filter((p) => p.status === "revisao" && p.rodada === 1)
    .map((p) => (instante(p.updated_at) - instante(p.created_at)) / 1000)
    .filter((s) => s > 0 && s < 3600)
    .sort((a, b) => a - b);
  return seg.length ? seg[Math.floor(seg.length / 2)] : null;
}

/** "Costuma levar 1 ou 2 minutos." sem histórico; com ele, o tempo medido do veículo ("cerca de 40 s", "cerca de 2 min"). */
export function fraseTempoProducao(seg: number | null): string {
  if (seg === null) return t("Costuma levar 1 ou 2 minutos.", "It usually takes 1 or 2 minutes.");
  const dur = seg < 60 ? `${Math.max(5, Math.round(seg / 5) * 5)} s` : `${Math.max(1, Math.round(seg / 60))} min`;
  return t(`Neste veículo costuma levar cerca de ${dur}.`, `For this publication it usually takes about ${dur}.`);
}

/** Motivo de falha gravado pelo Workflow → frase para o leigo. O texto técnico fica em "detalhe". */
export function motivoFalha(erro: string | null): string {
  const e = erro ?? "";
  if (/^validação reprovou/.test(e)) return t("O texto não passou na conferência com as fontes, nem depois de 3 tentativas.", "The text didn't pass the check against the sources, even after 3 tries.");
  if (/^sem instância/.test(e)) return t("A produção não conseguiu começar.", "Production couldn't start.");
  const card916 = e.match(/layout 9:16 reprovado no card (\d+)/)?.[1];
  if (card916) return t(`O card ${card916} não coube em pé. Encurte esse card no carrossel e faça o Reels de novo.`, `Card ${card916} didn't fit upright. Shorten that card in the carousel and make the Reel again.`);
  if (/semContraste/.test(e)) return t("O texto não se lê sobre as cores deste modelo. Troque as cores da marca ou a composição.", "The text can't be read on this template's colors. Change the brand colors or the composition.");
  if (/sem fatos/.test(e)) return t("A ideia não tem fatos suficientes para virar post.", "The idea doesn't have enough facts to become a post.");
  return t("A produção parou no meio do caminho.", "Production stopped partway through.");
}

export const FORMATOS = [
  { valor: "post", get rotulo() { return t("post", "post"); } },
  { valor: "carrossel", get rotulo() { return t("carrossel", "carousel"); } },
] as const;
export type Formato = (typeof FORMATOS)[number]["valor"];

export const EDITORIA: Record<string, string> = {
  get transito() { return t("Trânsito", "Traffic"); },
  get educacao() { return t("Educação", "Education"); },
  get policia() { return t("Polícia", "Police"); },
  get economia() { return t("Economia", "Economy"); },
  get cidade() { return t("Cidade", "City"); },
  get saude() { return t("Saúde", "Health"); },
  get cultura() { return t("Cultura", "Culture"); },
  get esporte() { return t("Esporte", "Sports"); },
  get politica() { return t("Política", "Politics"); },
  get clima() { return t("Clima", "Weather"); },
  get servico() { return t("Serviço", "Services"); },
};

// ── revisão ─────────────────────────────────────────────────────────────────────────────────────────────────────

export const PAPEL_CARD: Record<string, string> = {
  get capa() { return t("Capa", "Cover"); },
  get o_que_aconteceu() { return t("O que aconteceu", "What happened"); },
  get contexto() { return t("Contexto", "Context"); },
  get convite() { return t("Convite", "Invite card"); },
  // Layouts da Fase 3 (src/lib/cards.ts): o rótulo de um card novo é o layout dele.
  get texto() { return t("Texto", "Text"); },
  get citacao() { return t("Citação", "Quote"); },
  get numero() { return t("Número em destaque", "Key number"); },
  get lista() { return t("Lista", "List"); },
  // Fase 4: o vídeo do Reels (uma arte só).
  reels: "Reels",
};

/** A peça só pode ser reescrita até 3 vezes no total (MAX_RODADAS no Worker). */
export const MAX_VERSOES = 3;

type FraseTexto = { texto: string; fatoId: string | null };
type CardTexto = { papel?: string; layout?: string; titulo: string; frases?: FraseTexto[] };

/** Frases presas a um fato (o convite não conta: é do veículo) e os fatos distintos que elas usam, na ordem. */
export function fatosDoTexto(cards: CardTexto[] = []) {
  const frases = cards.filter((c) => c.papel !== "convite" && c.layout !== "convite").flatMap((c) => c.frases ?? []).filter((f) => f.fatoId);
  return { frases: frases.length, fatoIds: [...new Set(frases.map((f) => f.fatoId as string))] };
}

/** "3 frases, 3 fatos, nenhum aviso". */
export function linhaValidacao(frases: number, fatos: number, avisos: number) {
  return [
    plural(frases, t("frase", "sentence"), t("frases", "sentences")),
    plural(fatos, t("fato", "fact"), t("fatos", "facts")),
    avisos ? plural(avisos, t("aviso", "warning"), t("avisos", "warnings")) : t("nenhum aviso", "no warnings"),
  ].join(", ");
}

type ContaTexto = { modo: string; nome: string | null; external_id: string | null };

/** Extrai o nome da conta e descarta a anotação entre parênteses. */
export const nomeConta = (c: ContaTexto) => (c.nome ?? "").replace(/\s*\([^)]*\)\s*$/, "").trim() || c.external_id || "Instagram";

/** Intermediários com adaptador (src/lib/publicar.ts), pelo nome que a pessoa conhece. */
export const PROVEDORES: Record<string, string> = { ayrshare: "Ayrshare", postpeer: "PostPeer", zernio: "Zernio" };

export function comoPosta(modo: string, provedor?: string | null) {
  if (modo === "intermediario" && provedor) {
    const p = PROVEDORES[provedor] ?? provedor;
    return t(`posta sozinho pelo ${p}`, `posts on its own through ${p}`);
  }
  return ({
    manual: t("você posta pelo celular", "you post from your phone"),
    real: t("posta sozinho no Instagram", "posts on its own to Instagram"),
    intermediario: t("posta sozinho", "posts on its own"),
    simulada: t("teste: nada sai de verdade", "test: nothing is really posted"),
  } as Record<string, string>)[modo] ?? modo;
}

type MembroTexto = { nome: string; papel: string };
const nomes = (ns: string[], e = t("ou", "or")) => (ns.length <= 1 ? ns[0] ?? "" : `${ns.slice(0, -1).join(", ")} ${e} ${ns[ns.length - 1]}`);

/**
 * Sem conta do Instagram, a revisão aponta a saída: o admin liga uma em Veículo › Contas; quem não é admin sabe a quem
 * pedir, pelo nome. Devolve a frase sem o destino ("Veículo › Contas"), que a tela põe como link.
 */
export function notaSemConta(a: { admin: boolean; admins: string[] }): string {
  const base = t("Este veículo ainda não tem conta do Instagram ligada.", "This publication doesn't have an Instagram account connected yet.");
  if (a.admin) return t(`${base} Ligue uma em`, `${base} Connect one in`);
  return a.admins.length
    ? t(`${base} Peça a ${nomes(a.admins)} (admin) para ligar uma em`, `${base} Ask ${nomes(a.admins)} (admin) to connect one in`)
    : t(`${base} Peça a um admin para ligar uma em`, `${base} Ask an admin to connect one in`);
}

/** Para quem só traz ideias: quem decide este post, pelo nome. */
export function quemDecide(membros: MembroTexto[]): string {
  const editores = membros.filter((m) => m.papel === "editor").map((m) => m.nome);
  const admins = membros.filter((m) => m.papel === "admin").map((m) => m.nome);
  if (!editores.length && !admins.length) return t("Quem é editor ou admin do veículo aprova, reescreve ou rejeita este post.", "An editor or admin of the publication approves, rewrites or rejects this post.");
  if (!editores.length) return t(`${nomes(admins)} (admin) decide${admins.length > 1 ? "m" : ""} este post.`, `${nomes(admins)} (admin) decide${admins.length > 1 ? "" : "s"} on this post.`);
  return t(
    `${nomes(editores)} decide${editores.length > 1 ? "m" : ""} este post; ${nomes(admins, "e")} ${admins.length > 1 ? "são admins" : "é admin"}.`,
    `${nomes(editores)} decide${editores.length > 1 ? "" : "s"} on this post; ${nomes(admins, "and")} ${admins.length > 1 ? "are admins" : "is admin"}.`,
  );
}

/** Para quem só traz ideias: quem confirma que o post saiu, pelo nome. */
export function quemConfirma(membros: MembroTexto[]): string {
  const quem = membros.filter((m) => m.papel === "editor" || m.papel === "admin").map((m) => m.nome);
  if (!quem.length) return t("Quem é editor ou admin do veículo confirma que o post saiu.", "An editor or admin of the publication confirms the post went out.");
  return t(`${nomes(quem)} confirma${quem.length > 1 ? "m" : ""} que o post saiu.`, `${nomes(quem)} confirm${quem.length > 1 ? "" : "s"} the post went out.`);
}

/** A frase fixa da folha de decisão (DESIGN.md §5), conforme a conta que vai receber o post. */
export function notaAprovar(conta: ContaTexto | undefined) {
  if (!conta) return t("Este veículo ainda não tem conta do Instagram ligada. Ligue uma em Veículo › Contas.", "This publication doesn't have an Instagram account connected yet. Connect one in Publication › Accounts.");
  const nome = nomeConta(conta);
  if (conta.modo === "manual") return t(`Aprovar não publica: o post vai para Prontos para postar, e você posta pelo celular em ${nome}.`, `Approving doesn't publish: the post goes to Ready to post, and you post it from your phone on ${nome}.`);
  if (conta.modo === "simulada") return t(`Aprovar manda para ${nome}, uma conta de teste: nada sai de verdade.`, `Approving sends it to ${nome}, a test account: nothing is really posted.`);
  return t(`Aprovar publica em ${nome} (agora ou no horário que você marcar).`, `Approving publishes on ${nome} (now or at the time you set).`);
}

/** Erro da decisão → frase para o leigo. Recebe só status e mensagem (sem depender do cliente da API). */
export function mensagemDecisao(e: { status?: number; message?: string } | null | undefined) {
  const msg = e?.message ?? "";
  if (e?.status === 409) {
    if (/limite de \d+ rodadas/.test(msg)) return t(`Já são ${MAX_VERSOES} versões: aprove ou rejeite esta.`, `There are already ${MAX_VERSOES} versions: approve or reject this one.`);
    if (/sem conta|conta .* não encontrada/.test(msg)) return t("A conta escolhida não está mais ativa. Escolha outra.", "The chosen account is no longer active. Choose another one.");
    return t("Este post mudou enquanto você olhava: outra pessoa decidiu ou chegou uma versão nova. A tela foi atualizada.", "This post changed while you were looking: someone else decided, or a new version arrived. The screen has been updated.");
  }
  if (e?.status === 403) return t("Só quem é editor ou admin do veículo aprova, reescreve ou rejeita.", "Only an editor or admin of the publication can approve, rewrite or reject.");
  if (e?.status === 0) return t("Sem conexão. Confira a internet e tente de novo.", "No connection. Check your internet and try again.");
  return t("Não deu para enviar agora. Tente de novo.", "Couldn't send right now. Try again.");
}

/** Valor do campo "datetime-local" (horário do aparelho) → ISO; nulo se vazio, inválido ou já passou. */
export function horarioAgendado(local: string, agora = Date.now()): string | null {
  if (!local) return null;
  const t = new Date(local).getTime();
  return Number.isFinite(t) && t > agora ? new Date(t).toISOString() : null;
}

// ── postar ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Horário que ainda vai chegar (anotado ou agendado): "hoje, 14:00", "amanhã, 09:30", "05/11, 18:00". */
export function quandoFuturo(sql: string, agora = new Date()) {
  const d = new Date(instante(sql));
  const dia = (x: Date) => x.toLocaleDateString("pt-BR", { timeZone: FUSO });
  const hm = d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit", timeZone: FUSO });
  if (dia(d) === dia(agora)) return t(`hoje, ${hm}`, `today, ${hm}`);
  if (dia(d) === dia(new Date(agora.getTime() + 864e5))) return t(`amanhã, ${hm}`, `tomorrow, ${hm}`);
  return `${d.toLocaleDateString(locale(), { day: "2-digit", month: "2-digit", timeZone: FUSO })}, ${hm}`;
}

/** Conta que posta sozinha (real, intermediário, simulada). Sem conta gravada, quem posta é a pessoa. */
export const postaSozinho = (modo: string | null | undefined) => !!modo && modo !== "manual";

type Pronto = { status: string; updated_at: string; agendado_para: string | null; conta_modo: string | null };

/** A linha de situação de um post aprovado, em Prontos para postar e na tela de publicar. */
export function situacaoPronto(p: Pronto, agora = new Date()) {
  const futuro = p.agendado_para && instante(p.agendado_para) > agora.getTime();
  if (postaSozinho(p.conta_modo)) {
    return futuro ? t(`posta sozinho ${quandoFuturo(p.agendado_para!, agora)}`, `posts on its own ${quandoFuturo(p.agendado_para!, agora)}`) : t("postando sozinho", "posting on its own");
  }
  if (p.agendado_para) return `${futuro ? t("anotado para", "planned for") : t("era para", "was planned for")} ${quandoFuturo(p.agendado_para, agora)}`;
  return t(`aprovado ${quando(p.updated_at, agora)}`, `approved ${quando(p.updated_at, agora)}`);
}

/**
 * Link colado na confirmação: vazio vale (postou sem copiar o link); senão, só um post do Instagram
 * (instagram.com/p/…, /reel/…, /tv/…). Devolve o link limpo ou o erro em linguagem de leigo.
 */
export function linkDoPost(texto: string): { url: string | null } | { erro: string } {
  const s = texto.trim();
  if (!s) return { url: null };
  const comEsquema = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(comEsquema);
    // Valem as formas que o Instagram gera: /p/…, /reel/…, /tv/…, com o usuário na frente (/usuario/p/…, do site) e
    // as do "Copiar link" do app (/share/p/…, /share/reel/…, /share/<token>). Perfil (/usuario/) não é post.
    const post = /^\/(?:[A-Za-z0-9._]{1,30}\/)?(?:(?:share\/)?(?:p|reels?|tv)\/|share\/)[A-Za-z0-9_-]+/;
    if ((u.protocol === "https:" || u.protocol === "http:") && /(^|\.)instagram\.com$/.test(u.hostname) && post.test(u.pathname)) return { url: u.href };
  } catch { /* cai no erro abaixo */ }
  return { erro: t("Esse link não é de um post do Instagram. No app, toque nos três pontos do post e em Copiar link; ou deixe em branco.", "This link isn't from an Instagram post. In the app, tap the three dots on the post, then Copy link; or leave it blank.") };
}

/** Nome do arquivo para baixar ou compartilhar uma peça. */
export function nomeImagem(veiculo: string, i: number, papel: string) {
  const limpo = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return [limpo(veiculo), String(i + 1), limpo(papel)].filter(Boolean).join("-") + ".jpg";
}

/** "carrossel de 4" (quantas imagens vão no carrossel), "post". */
export const rotuloFormato = (formato: string, n?: number | null) => (
  formato === "carrossel" && n ? t(`carrossel de ${n}`, `carousel of ${n}`)
    : formato === "reels" ? "Reels"
      : formato === "carrossel" ? t("carrossel", "carousel")
        : formato
);

/** Perfil do Instagram a partir do nome da conta; sem @, nada. */
export function perfilInstagram(nome: string): string | null {
  const m = nome.trim().match(/^@([A-Za-z0-9._]{1,30})$/);
  return m ? `https://www.instagram.com/${m[1]}/` : null;
}

// ── + Nova (folha "Nova ideia") ─────────────────────────────────────────────────────────────────────────────────

export type ModoNova = "link" | "texto" | "print" | "docs" | "anuncio";
/** `docs` (Google Docs) só aparece com a configuração do Google no servidor (`me.google`). `anuncio`, fora do modo autoral. */
export const MODOS_NOVA: { valor: ModoNova; rotulo: string }[] = [
  { valor: "link", get rotulo() { return t("Link", "Link"); } },
  { valor: "texto", get rotulo() { return t("Texto", "Text"); } },
  { valor: "print", get rotulo() { return t("Print", "Screenshot"); } },
  { valor: "docs", rotulo: "Docs" },
  { valor: "anuncio", get rotulo() { return t("Anúncio", "Ad"); } },
];
/** `?nova=` da URL → aba da folha (valor desconhecido abre no link; ausente, folha fechada). */
export const modoNova = (v: string | null): ModoNova | null => (v === null ? null : MODOS_NOVA.some((m) => m.valor === v) ? (v as ModoNova) : "link");

const ERROS_NOVA = (): Record<string, string> => ({
  url_invalida: t("Esse link não parece o endereço de uma notícia. Copie o endereço completo da página (começa com https).", "This link doesn't look like the address of a news story. Copy the full page address (it starts with https)."),
  link_ilegivel: t("Não deu para ler a notícia desse link: o site não respondeu ou a página não tem o texto. Tente outro link ou escreva o que aconteceu.", "Couldn't read the story at this link: the site didn't respond or the page has no text. Try another link or write what happened."),
  relato_curto: t("Escreva um pouco mais: o que aconteceu, onde e quando.", "Write a little more: what happened, where and when."),
  anunciante_invalido: t("Diga o nome do anunciante, até 80 caracteres.", "Give the advertiser's name, up to 80 characters."),
  relato_longo: t("Texto longo demais: até 4.000 caracteres.", "The text is too long: up to 4,000 characters."),
  print_sem_noticia: t("Não deu para ler uma notícia nesse print. Mande um print com o título e o texto à vista.", "Couldn't read a news story in this screenshot. Send a screenshot with the headline and text in view."),
  imagem_invalida: t("Não deu para usar essa imagem. Mande um print em PNG ou JPEG.", "Couldn't use this image. Send a screenshot in PNG or JPEG."),
  imagem_grande: t("Imagem grande demais. Mande um print menor.", "The image is too large. Send a smaller screenshot."),
  texto_curto: t("O documento está vazio ou curto demais. Escolha o documento do texto.", "The document is empty or too short. Choose the document with your text."),
  texto_longo: t("Texto longo demais: até 100 mil caracteres.", "The text is too long: up to 100,000 characters."),
  sem_conta: t("Conecte o Google Docs para trazer um documento.", "Connect Google Docs to bring in a document."),
  reconectar: t("O acesso ao Google Docs venceu. Conecte de novo.", "Access to Google Docs has expired. Connect again."),
  sem_acesso: t("Este documento não está liberado para o Gazzpush. Escolha de novo pelo botão do Google Docs.", "This document isn't shared with Gazzpush. Choose it again with the Google Docs button."),
  documento_invalido: t("Este documento não está liberado para o Gazzpush. Escolha de novo pelo botão do Google Docs.", "This document isn't shared with Gazzpush. Choose it again with the Google Docs button."),
});

/** Erro do + Nova em linguagem de leigo, pelo código da API (nunca pelo texto). */
export function mensagemNova(e: { status?: number; codigo?: string } | null | undefined): string {
  const erros = ERROS_NOVA();
  if (e?.codigo && erros[e.codigo]) return erros[e.codigo];
  if (e?.status === 0) return t("Sem conexão. Confira a internet e tente de novo.", "No connection. Check your internet and try again.");
  if (e?.status && e.status >= 500) return t("A leitura falhou agora. Tente de novo em instantes.", "Reading failed just now. Try again in a moment.");
  return t("Não deu certo agora. Tente de novo.", "That didn't work just now. Try again.");
}

/** O que a lista diz depois do + Nova (na própria ideia; já em produção, no alto da tela, conforme o post dela). */
export function avisoNova(situacao: string, status: string, peca?: string | null): string {
  if (situacao === "nova") return t("Ideia nova, no topo da lista.", "New idea, at the top of the list.");
  if (situacao === "de_volta") return t("Essa notícia já tinha passado por aqui e voltou para o topo da lista.", "This story had already come through here and is back at the top of the list.");
  if (status !== "em_producao") return t("Essa notícia já estava na lista.", "This story was already on the list.");
  if (peca === "revisao") return t("Essa notícia já virou post e espera aprovação.", "This story is already a post and is waiting for approval.");
  if (peca === "aprovada" || peca === "agendada") return t("Essa notícia já foi aprovada e espera ser postada.", "This story has already been approved and is waiting to be posted.");
  return t("Essa notícia já está sendo produzida.", "This story is already in production.");
}

/**
 * A leitura do + Nova terminou com a folha já fechada (voltar no meio): o aviso aparece na tela em que a pessoa está,
 * com "Ver" para a ideia (ou para o post, se a notícia já virou um).
 */
export function avisoNovaFora(r: { situacao: string; status: string; peca?: { id: string; status: string } | null }): string {
  if (r.situacao === "nova") return t("A ideia que você trouxe entrou no topo das Ideias.", "The idea you brought in is at the top of Ideas.");
  if (r.situacao === "de_volta") return t("A notícia que você trouxe já tinha passado por aqui e voltou para o topo das Ideias.", "The story you brought in had already come through here and is back at the top of Ideas.");
  if (r.status === "em_producao" && r.peca) return t("A notícia que você trouxe já virou post.", "The story you brought in is already a post.");
  return t("A notícia que você trouxe já estava nas Ideias.", "The story you brought in was already in Ideas.");
}

/** Print enviado: largura até 1200 px e até 4 milhões de pixels (o modelo de visão reduz de qualquer jeito). */
export const escalaPrint = (w: number, h: number) => Math.min(1, 1200 / w, Math.sqrt(4_000_000 / (w * h)));

// ── ilustração simples (fallback do Kie para o Workers AI) ──────────────────────────────────────────────────────

/** A ilustração caiu no estilo padrão por falta de chave (nem a do veículo, nem a do servidor): o admin liga na aba Chaves de IA. */
export const semChaveIlustracao = (fallbackDe: string) => /KIE_API_KEY|FAL_KEY/.test(fallbackDe);

/** `fallbackDe` do evento `peca.ilustracao` (src/lib/ilustrar.ts) em linguagem de leigo, para a faixa âmbar da revisão. */
export function motivoIlustracao(fallbackDe: string): string {
  if (semChaveIlustracao(fallbackDe)) return t("o serviço de ilustração ainda não foi ligado", "the illustration service hasn't been turned on yet");
  if (/arteRefR2/.test(fallbackDe)) return t("a marca não tem imagem de referência", "the brand has no reference image");
  if (/\b402\b/.test(fallbackDe)) return t("o serviço de ilustração está sem crédito", "the illustration service is out of credit");
  if (/^teto de custo/.test(fallbackDe)) return t("este post chegou ao limite de custo", "this post reached its cost limit");
  return t("o serviço de ilustração falhou desta vez", "the illustration service failed this time");
}

type EventoPeca = { tipo: unknown; payload?: unknown };
/** A ilustração da versão exibida caiu no estilo padrão? Devolve o motivo (já em linguagem de leigo) ou null. */
export function ilustracaoSimples(eventos: EventoPeca[], versao: number): string | null {
  const fallback = fallbackDaVersao(eventos, versao);
  return fallback ? motivoIlustracao(fallback) : null;
}
/** O motivo cru (`fallbackDe`) da ilustração da versão exibida, ou null. */
export function fallbackDaVersao(eventos: EventoPeca[], versao: number): string | null {
  const ev = [...eventos].reverse().find((e) => e.tipo === "peca.ilustracao" && (e.payload as { versao?: unknown } | null)?.versao === versao);
  const fallback = (ev?.payload as { fallbackDe?: unknown } | undefined)?.fallbackDe;
  return typeof fallback === "string" && fallback ? fallback : null;
}

// ── cobertura multi-cidade ─────────────────────────────────────────────────────────────────────────────────────

import { ufDoIbge } from "../../src/lib/uf";
export { ufDoIbge };
/** "Santos · SP" (sem a UF quando o código não bate). */
export const rotuloArea = (a: { ibge: string; nome: string | null }) => [a.nome ?? a.ibge, ufDoIbge(a.ibge)].filter(Boolean).join(" · ");

/**
 * `?cidade=<ibge>` das Ideias: vale só se é uma cidade da cobertura e o veículo cobre mais de uma (senão, todas).
 * Ideia sem cidade (trazida à mão, sem local) só aparece em "Todas".
 */
export function cidadeDoFiltro(param: string | null, areas: { ibge: string }[]): string | null {
  return param && areas.length > 1 && areas.some((a) => a.ibge === param) ? param : null;
}
export const filtrarPorCidade = <T extends { municipio_ibge: string | null }>(pautas: T[], cidade: string | null) =>
  cidade ? pautas.filter((p) => p.municipio_ibge === cidade) : pautas;
