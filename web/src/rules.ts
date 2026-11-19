// The queue's pure rules (no React and no API client, so they can be tested in the Worker's vitest in test/web.test.ts):
// dates, the previous visit, the summary of what changed, step names and the failure reason in plain language.
import { locale, t } from "./language";

export const TIMEZONE = "America/Sao_Paulo";

/** A D1 date ("YYYY-MM-DD HH:MM:SS", UTC without a zone) or ISO → milliseconds. */
export const instant = (sql: string) => new Date(sql.includes("T") ? sql : `${sql.replace(" ", "T")}Z`).getTime();

/** "há 5 min", "há 3 h", "ontem, 20:30", "28/10". */
export function when(sql: string, now = new Date()) {
  const d = new Date(instant(sql));
  const min = Math.max(0, Math.round((now.getTime() - d.getTime()) / 60000));
  if (min < 1) return t("agora", "now");
  if (min < 60) return t(`há ${min} min`, `${min} min ago`);
  if (min < 6 * 60) return t(`há ${Math.round(min / 60)} h`, `${Math.round(min / 60)} h ago`);
  const day = (x: Date) => x.toLocaleDateString("pt-BR", { timeZone: TIMEZONE });
  const hm = d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit", timeZone: TIMEZONE });
  if (day(d) === day(now)) return t(`hoje, ${hm}`, `today, ${hm}`);
  if (day(d) === day(new Date(now.getTime() - 864e5))) return t(`ontem, ${hm}`, `yesterday, ${hm}`);
  return d.toLocaleDateString(locale(), { day: "2-digit", month: "2-digit", timeZone: TIMEZONE });
}

export const hour = (sql: string) =>
  new Date(instant(sql)).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit", timeZone: TIMEZONE });

/** How long something has been waiting, as a duration: "now", "5 min", "3 h", "23 h", "2 days". The same grammar in every list. */
export function waitFor(sql: string, now = new Date()): string {
  const min = Math.max(0, Math.round((now.getTime() - instant(sql)) / 60000));
  if (min < 1) return t("agora", "now");
  if (min < 60) return `${min} min`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h`;
  return t(`${Math.round(min / 1440)} dias`, `${Math.round(min / 1440)} days`);
}

/** Fraction of the wait relative to the oldest in the list (proportional bar): 1 for the oldest, 0 for "now". */
export function fractionWait(sql: string, oldest: string, now = new Date()): number {
  const total = now.getTime() - instant(oldest);
  if (total <= 0) return 0;
  return Math.max(0, Math.min(1, (now.getTime() - instant(sql)) / total));
}

// ── previous visit (per outlet, on this device) ─────────────────────────────────────────────────────────────────

const visitKey = (tenantId: string) => `redacao:visita:${tenantId}`;
const previous = new Map<string, number | null>();

/**
 * When the previous visit to this outlet's Ideas was. Read once per app load: while the app stays open, "new" stays
 * relative to the same visit, even after the current one is marked.
 */
export function previousVisit(tenantId: string): number | null {
  if (!previous.has(tenantId)) {
    let v: number | null = null;
    try { v = Number(localStorage.getItem(visitKey(tenantId))) || null; } catch { /* modo privado */ }
    previous.set(tenantId, v);
  }
  return previous.get(tenantId)!;
}

/** Marks the current visit (call only after Ideas loaded: someone who did not see the list did not visit it). */
export function markVisit(tenantId: string, now = Date.now()) {
  previousVisit(tenantId);
  try { localStorage.setItem(visitKey(tenantId), String(now)); } catch { /* modo privado */ }
}

export const newSince = (sql: string, prev: number | null) => prev !== null && instant(sql) > prev;

const plural = (n: number, one: string, several: string) => `${n} ${n === 1 ? one : several}`;

/** The "Since your last visit" line. It only counts what changed, never the total (DESIGN.md §6.2). */
export function summaryVisit(a: { anterior: number | null; prontas: number; novas: number }): { rotulo: string; texto: string } {
  if (a.anterior === null) {
    return {
      rotulo: t("Para começar:", "To start:"),
      texto: a.novas
        ? t(`${plural(a.novas, "ideia sugerida", "ideias sugeridas")} pelas suas fontes.`, `${plural(a.novas, "idea suggested", "ideas suggested")} by your sources.`)
        : t("as ideias aparecem aqui assim que as fontes trouxerem notícia.", "ideas show up here as soon as your sources bring in news."),
    };
  }
  const parts = [
    a.prontas ? plural(a.prontas, t("post pronto para aprovar", "post ready to approve"), t("posts prontos para aprovar", "posts ready to approve")) : "",
    a.novas ? plural(a.novas, t("ideia nova", "new idea"), t("ideias novas", "new ideas")) : "",
  ].filter(Boolean);
  return { rotulo: t("Desde a sua última visita:", "Since your last visit:"), texto: parts.length ? `${parts.join(t(" e ", " and "))}.` : t("nada novo.", "nothing new.") };
}

// ── first steps (sidebar, until the first post goes out) ────────────────────────────────────────────────────────

export type StepId = { id: "veiculo" | "ideia" | "aprovado" | "postado"; rotulo: string; feito: boolean };

/**
 * The path to the first Instagram post, with the first step already done (the outlet exists): progress already started
 * converts better than 0 of 4. It goes away when the first post goes out.
 */
export function firstSteps(a: { ideias: number; posts: number; prontos: number; postados: number }): StepId[] | null {
  if (a.postados > 0) return null;
  return [
    { id: "veiculo", rotulo: t("Veículo criado", "Publication created"), feito: true },
    { id: "ideia", rotulo: t("Primeira ideia", "First idea"), feito: a.ideias + a.posts + a.prontos > 0 },
    { id: "aprovado", rotulo: t("Primeiro post aprovado", "First post approved"), feito: a.prontos > 0 },
    { id: "postado", rotulo: t("Primeiro post no Instagram", "First post on Instagram"), feito: false },
  ];
}

// ── today (sidebar, when there is no First steps or In production) ──────────────────────────────────────────────

const sameDay = (a: Date, b: Date) => a.toLocaleDateString("pt-BR", { timeZone: TIMEZONE }) === b.toLocaleDateString("pt-BR", { timeZone: TIMEZONE });

/** The sources cron runs every 15 min (triggers.crons in wrangler.jsonc). */
export const CRON_COLLECTION_MIN = 15;

/**
 * When the sources will be collected again: each source is due `intervaloMin` after its last collection (never
 * collected: already due) and is picked up by the first cron after that (the same rule as src/monitor/scheduled.ts). The
 * nearest one decides. A source the cron gave up on (`coletavel: false`, 10 consecutive failures) does not count.
 * Without a collectable source, nothing.
 */
export function nextCollection(sources: { coletadaEm: string | null; intervaloMin: number; coletavel: boolean }[], now = new Date()): Date | null {
  const live = sources.filter((f) => f.coletavel);
  if (!live.length) return null;
  const expires = Math.min(...live.map((f) => (f.coletadaEm ? instant(f.coletadaEm) + f.intervaloMin * 60_000 : 0)));
  const tick = CRON_COLLECTION_MIN * 60_000;
  const base = Math.max(expires, now.getTime());
  return new Date(Math.ceil(base / tick) * tick);
}

/**
 * Posts per day over the last `dias` days (the last is today), in the São Paulo time zone. The week's pace, not a total:
 * the caller has already removed simulated publications (nothing really went out).
 */
export function postedPerDay(published: (string | null)[], now = new Date(), days = 7): number[] {
  const key = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: TIMEZONE });
  const keys = Array.from({ length: days }, (_, i) => key(new Date(now.getTime() - (days - 1 - i) * 864e5)));
  const n = keys.map(() => 0);
  for (const p of published) {
    if (!p) continue;
    const i = keys.indexOf(key(new Date(instant(p))));
    if (i >= 0) n[i]++;
  }
  return n;
}

/** "today 2 · week 11" (the last value is today). */
export const weekLine = (perDay: number[]) => {
  const today = perDay[perDay.length - 1] ?? 0, week = perDay.reduce((a, b) => a + b, 0);
  return t(`hoje ${today} · semana ${week}`, `today ${today} · week ${week}`);
};

/**
 * The bars of a sparkline of `valores` in a w×h box (one per value, from the oldest to today's). A zero bar keeps a
 * 1 px base; all zeros is just the baseline, and that is the information.
 */
export function barsSparkline(values: number[], w = 96, h = 20, go = 2): { x: number; y: number; w: number; h: number }[] {
  if (!values.length) return [];
  const largest = Math.max(1, ...values);
  const width = (w - go * (values.length - 1)) / values.length;
  return values.map((v, i) => {
    const height = v ? Math.max(2, Math.round((v / largest) * h)) : 1;
    return { x: Math.round(i * (width + go) * 100) / 100, y: h - height, w: Math.round(width * 100) / 100, h: height };
  });
}

/**
 * One line of the Today card's "waiting · the oldest": "4 to approve · 23 h ago"; with a noted time, it takes the
 * wait's place ("2 to post · noted for today, 20:00"). With nothing waiting, nothing.
 */
export function waitLine(a: { n: number; oque: string; maisAntigo: string | null; anotado?: string | null }, now = new Date()): string | null {
  if (!a.n) return null;
  const when = a.anotado && instant(a.anotado) > now.getTime()
    ? t(`anotado para ${whenFuture(a.anotado, now)}`, `planned for ${whenFuture(a.anotado, now)}`)
    : a.maisAntigo ? t(`há ${waitFor(a.maisAntigo, now)}`, `${waitFor(a.maisAntigo, now)} ago`) : "";
  return [`${a.n} ${a.oque}`, when].filter(Boolean).join(" · ");
}

// ── production ──────────────────────────────────────────────────────────────────────────────────────────────────

export type Step = "redigir" | "validar" | "ilustrar" | "renderizar";
export const STEPS: Step[] = ["redigir", "validar", "ilustrar", "renderizar"];

export function stepLabel(e: Step, format: string) {
  return {
    redigir: t("Escrever o texto", "Write the text"),
    validar: t("Conferir cada frase com as fontes", "Check each sentence against the sources"),
    ilustrar: t("Desenhar a ilustração", "Draw the illustration"),
    renderizar: format === "post" ? t("Montar a imagem", "Build the image") : format === "reels" ? t("Montar o vídeo", "Build the video") : t("Montar os cards", "Build the cards"),
  }[e];
}

type PieceTime = { status: string; rodada: number; created_at: string; updated_at: string };

/**
 * The measured production time for this outlet: the median, in seconds, of how long the posts ready to approve took
 * from creation until ready (first round only: a rewrite adds the editor's wait). Outside 0 to 60 min it does not count
 * (an instance resumed after stopping). Without history, null.
 */
export function productionTime(pieces: PieceTime[]): number | null {
  const seg = pieces
    .filter((p) => p.status === "revisao" && p.rodada === 1)
    .map((p) => (instant(p.updated_at) - instant(p.created_at)) / 1000)
    .filter((s) => s > 0 && s < 3600)
    .sort((a, b) => a - b);
  return seg.length ? seg[Math.floor(seg.length / 2)] : null;
}

/** "It usually takes 1 or 2 minutes." without history; with it, the outlet's measured time ("about 40 s", "about 2 min"). */
export function timeProductionSentence(seg: number | null): string {
  if (seg === null) return t("Costuma levar 1 ou 2 minutos.", "It usually takes 1 or 2 minutes.");
  const dur = seg < 60 ? `${Math.max(5, Math.round(seg / 5) * 5)} s` : `${Math.max(1, Math.round(seg / 60))} min`;
  return t(`Neste veículo costuma levar cerca de ${dur}.`, `For this publication it usually takes about ${dur}.`);
}

/** The failure reason stored by the Workflow → a sentence for a layperson. The technical text goes in "detail". */
export function failureReason(error: string | null): string {
  const e = error ?? "";
  if (/^(validação reprovou|validation failed)/.test(e)) return t("O texto não passou na conferência com as fontes, nem depois de 3 tentativas.", "The text didn't pass the check against the sources, even after 3 tries.");
  if (/^(sem instância|no instance)/.test(e)) return t("A produção não conseguiu começar.", "Production couldn't start.");
  const card916 = e.match(/layout 9:16 (?:reprovado no|rejected on) card (\d+)/)?.[1];
  if (card916) return t(`O card ${card916} não coube em pé. Encurte esse card no carrossel e faça o Reels de novo.`, `Card ${card916} didn't fit upright. Shorten that card in the carousel and make the Reel again.`);
  if (/semContraste/.test(e)) return t("O texto não se lê sobre as cores deste modelo. Troque as cores da marca ou a composição.", "The text can't be read on this template's colors. Change the brand colors or the composition.");
  if (/(sem fatos|has no facts)/.test(e)) return t("A ideia não tem fatos suficientes para virar post.", "The idea doesn't have enough facts to become a post.");
  return t("A produção parou no meio do caminho.", "Production stopped partway through.");
}

export const FORMATS = [
  { valor: "post", get rotulo() { return t("post", "post"); } },
  { valor: "carrossel", get rotulo() { return t("carrossel", "carousel"); } },
] as const;
export type Format = (typeof FORMATS)[number]["valor"];

export const DESK: Record<string, string> = {
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

// ── review ──────────────────────────────────────────────────────────────────────────────────────────────────────

export const CARD_ROLE: Record<string, string> = {
  get capa() { return t("Capa", "Cover"); },
  get o_que_aconteceu() { return t("O que aconteceu", "What happened"); },
  get contexto() { return t("Contexto", "Context"); },
  get convite() { return t("Convite", "Invite card"); },
  // Phase 3 layouts (src/lib/cards.ts): a new card's label is its layout.
  get texto() { return t("Texto", "Text"); },
  get citacao() { return t("Citação", "Quote"); },
  get numero() { return t("Número em destaque", "Key number"); },
  get lista() { return t("Lista", "List"); },
  // Phase 4: the Reels video (a single art).
  reels: "Reels",
};

/** A piece can only be rewritten up to 3 times in total (MAX_ROUNDS in the Worker). */
export const MAX_VERSIONS = 3;

type TextSentence = { texto: string; fatoId: string | null };
type CardText = { papel?: string; layout?: string; titulo: string; frases?: TextSentence[] };

/** Sentences tied to a fact (the CTA does not count: it is the outlet's) and the distinct facts they use, in order. */
export function factsText(cards: CardText[] = []) {
  const sentences = cards.filter((c) => c.papel !== "convite" && c.layout !== "convite").flatMap((c) => c.frases ?? []).filter((f) => f.fatoId);
  return { frases: sentences.length, fatoIds: [...new Set(sentences.map((f) => f.fatoId as string))] };
}

/** "3 frases, 3 fatos, nenhum aviso". */
export function validationLine(sentences: number, facts: number, warnings: number) {
  return [
    plural(sentences, t("frase", "sentence"), t("frases", "sentences")),
    plural(facts, t("fato", "fact"), t("fatos", "facts")),
    warnings ? plural(warnings, t("aviso", "warning"), t("avisos", "warnings")) : t("nenhum aviso", "no warnings"),
  ].join(", ");
}

type TextAccount = { modo: string; nome: string | null; external_id: string | null };

/** "@portal.litoral (manual, celular)" → "@portal.litoral": the parenthesis is a note from whoever registered it. */
export const accountName = (c: TextAccount) => (c.nome ?? "").replace(/\s*\([^)]*\)\s*$/, "").trim() || c.external_id || "Instagram";

/** Intermediaries with an adapter (src/lib/publish.ts), by the name the person knows. */
export const PROVIDERS: Record<string, string> = { ayrshare: "Ayrshare", postpeer: "PostPeer", zernio: "Zernio" };

export function asPosts(mode: string, provider?: string | null) {
  if (mode === "intermediario" && provider) {
    const p = PROVIDERS[provider] ?? provider;
    return t(`posta sozinho pelo ${p}`, `posts on its own through ${p}`);
  }
  return ({
    manual: t("você posta pelo celular", "you post from your phone"),
    real: t("posta sozinho no Instagram", "posts on its own to Instagram"),
    intermediario: t("posta sozinho", "posts on its own"),
    simulada: t("teste: nada sai de verdade", "test: nothing is really posted"),
  } as Record<string, string>)[mode] ?? mode;
}

type MemberText = { nome: string; papel: string };
const names = (ns: string[], e = t("ou", "or")) => (ns.length <= 1 ? ns[0] ?? "" : `${ns.slice(0, -1).join(", ")} ${e} ${ns[ns.length - 1]}`);

/**
 * Without an Instagram account, review points the way out: an admin turns one on in Outlet › Accounts; a non-admin
 * learns whom to ask, by name. Returns the sentence without the destination ("Outlet › Accounts"), which the screen
 * renders as a link.
 */
export function noteWithoutAccount(a: { admin: boolean; admins: string[] }): string {
  const base = t("Este veículo ainda não tem conta do Instagram ligada.", "This publication doesn't have an Instagram account connected yet.");
  if (a.admin) return t(`${base} Ligue uma em`, `${base} Connect one in`);
  return a.admins.length
    ? t(`${base} Peça a ${names(a.admins)} (admin) para ligar uma em`, `${base} Ask ${names(a.admins)} (admin) to connect one in`)
    : t(`${base} Peça a um admin para ligar uma em`, `${base} Ask an admin to connect one in`);
}

/** For someone who only brings ideas: who decides this post, by name ("Bruno ou Carla decidem; Ana é admin."). */
export function whoDecides(members: MemberText[]): string {
  const editors = members.filter((m) => m.papel === "editor").map((m) => m.nome);
  const admins = members.filter((m) => m.papel === "admin").map((m) => m.nome);
  if (!editors.length && !admins.length) return t("Quem é editor ou admin do veículo aprova, reescreve ou rejeita este post.", "An editor or admin of the publication approves, rewrites or rejects this post.");
  if (!editors.length) return t(`${names(admins)} (admin) decide${admins.length > 1 ? "m" : ""} este post.`, `${names(admins)} (admin) decide${admins.length > 1 ? "" : "s"} on this post.`);
  return t(
    `${names(editors)} decide${editors.length > 1 ? "m" : ""} este post; ${names(admins, "e")} ${admins.length > 1 ? "são admins" : "é admin"}.`,
    `${names(editors)} decide${editors.length > 1 ? "" : "s"} on this post; ${names(admins, "and")} ${admins.length > 1 ? "are admins" : "is admin"}.`,
  );
}

/** For someone who only brings ideas: who confirms that the post went out, by name. */
export function whoConfirms(members: MemberText[]): string {
  const who = members.filter((m) => m.papel === "editor" || m.papel === "admin").map((m) => m.nome);
  if (!who.length) return t("Quem é editor ou admin do veículo confirma que o post saiu.", "An editor or admin of the publication confirms the post went out.");
  return t(`${names(who)} confirma${who.length > 1 ? "m" : ""} que o post saiu.`, `${names(who)} confirm${who.length > 1 ? "" : "s"} the post went out.`);
}

/** The decision sheet's fixed sentence (DESIGN.md §5), depending on the account that will receive the post. */
export function noteApprove(account: TextAccount | undefined) {
  if (!account) return t("Este veículo ainda não tem conta do Instagram ligada. Ligue uma em Veículo › Contas.", "This publication doesn't have an Instagram account connected yet. Connect one in Publication › Accounts.");
  const name = accountName(account);
  if (account.modo === "manual") return t(`Aprovar não publica: o post vai para Prontos para postar, e você posta pelo celular em ${name}.`, `Approving doesn't publish: the post goes to Ready to post, and you post it from your phone on ${name}.`);
  if (account.modo === "simulada") return t(`Aprovar manda para ${name}, uma conta de teste: nada sai de verdade.`, `Approving sends it to ${name}, a test account: nothing is really posted.`);
  return t(`Aprovar publica em ${name} (agora ou no horário que você marcar).`, `Approving publishes on ${name} (now or at the time you set).`);
}

/** A decision error → a sentence for a layperson. It only receives status and message (no dependency on the API client). */
export function decisionMessage(e: { status?: number; message?: string } | null | undefined) {
  const msg = e?.message ?? "";
  if (e?.status === 409) {
    if (/limite de \d+ rodadas|limit of \d+ rounds/.test(msg)) return t(`Já são ${MAX_VERSIONS} versões: aprove ou rejeite esta.`, `There are already ${MAX_VERSIONS} versions: approve or reject this one.`);
    if (/sem conta|conta .* não encontrada|has no active Instagram account|account .* not found/.test(msg)) return t("A conta escolhida não está mais ativa. Escolha outra.", "The chosen account is no longer active. Choose another one.");
    return t("Este post mudou enquanto você olhava: outra pessoa decidiu ou chegou uma versão nova. A tela foi atualizada.", "This post changed while you were looking: someone else decided, or a new version arrived. The screen has been updated.");
  }
  if (e?.status === 403) return t("Só quem é editor ou admin do veículo aprova, reescreve ou rejeita.", "Only an editor or admin of the publication can approve, rewrite or reject.");
  if (e?.status === 0) return t("Sem conexão. Confira a internet e tente de novo.", "No connection. Check your internet and try again.");
  return t("Não deu para enviar agora. Tente de novo.", "Couldn't send right now. Try again.");
}

/** A "datetime-local" field value (the device's time) → ISO; null if empty, invalid or already past. */
export function timeScheduled(local: string, now = Date.now()): string | null {
  if (!local) return null;
  const t = new Date(local).getTime();
  return Number.isFinite(t) && t > now ? new Date(t).toISOString() : null;
}

// ── postar ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** A time still to come (noted or scheduled): "today, 14:00", "tomorrow, 09:30", "05/11, 18:00". */
export function whenFuture(sql: string, now = new Date()) {
  const d = new Date(instant(sql));
  const day = (x: Date) => x.toLocaleDateString("pt-BR", { timeZone: TIMEZONE });
  const hm = d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit", timeZone: TIMEZONE });
  if (day(d) === day(now)) return t(`hoje, ${hm}`, `today, ${hm}`);
  if (day(d) === day(new Date(now.getTime() + 864e5))) return t(`amanhã, ${hm}`, `tomorrow, ${hm}`);
  return `${d.toLocaleDateString(locale(), { day: "2-digit", month: "2-digit", timeZone: TIMEZONE })}, ${hm}`;
}

/** An account that posts by itself (real, intermediary, simulated). Without a stored account, the person posts. */
export const alonePosts = (mode: string | null | undefined) => !!mode && mode !== "manual";

type Ready = { status: string; updated_at: string; agendado_para: string | null; conta_modo: string | null };

/** The status line of an approved post, in Ready to post and on the publish screen. */
export function readyStatus(p: Ready, now = new Date()) {
  const future = p.agendado_para && instant(p.agendado_para) > now.getTime();
  if (alonePosts(p.conta_modo)) {
    return future ? t(`posta sozinho ${whenFuture(p.agendado_para!, now)}`, `posts on its own ${whenFuture(p.agendado_para!, now)}`) : t("postando sozinho", "posting on its own");
  }
  if (p.agendado_para) return `${future ? t("anotado para", "planned for") : t("era para", "was planned for")} ${whenFuture(p.agendado_para, now)}`;
  return t(`aprovado ${when(p.updated_at, now)}`, `approved ${when(p.updated_at, now)}`);
}

/**
 * A link pasted in the confirmation: empty counts (posted without copying the link); otherwise, only an Instagram post
 * (instagram.com/p/…, /reel/…, /tv/…). Returns the clean link or the error in plain language.
 */
export function fromPostLink(text: string): { url: string | null } | { erro: string } {
  const s = text.trim();
  if (!s) return { url: null };
  const withSchema = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withSchema);
    // The forms Instagram generates count: /p/…, /reel/…, /tv/…, with the user in front (/user/p/…, from the site) and
    // those from the app's "Copy link" (/share/p/…, /share/reel/…, /share/<token>). A profile (/user/) is not a post.
    const post = /^\/(?:[A-Za-z0-9._]{1,30}\/)?(?:(?:share\/)?(?:p|reels?|tv)\/|share\/)[A-Za-z0-9_-]+/;
    if ((u.protocol === "https:" || u.protocol === "http:") && /(^|\.)instagram\.com$/.test(u.hostname) && post.test(u.pathname)) return { url: u.href };
  } catch { /* cai no erro abaixo */ }
  return { erro: t("Esse link não é de um post do Instagram. No app, toque nos três pontos do post e em Copiar link; ou deixe em branco.", "This link isn't from an Instagram post. In the app, tap the three dots on the post, then Copy link; or leave it blank.") };
}

/** File name to download/share: "portal-litoral-1-capa.jpg". */
export function imageName(outlet: string, i: number, role: string) {
  const clean = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return [clean(outlet), String(i + 1), clean(role)].filter(Boolean).join("-") + ".jpg";
}

/** "carousel of 4" (how many images go in the carousel), "post". */
export const formatLabel = (format: string, n?: number | null) => (
  format === "carrossel" && n ? t(`carrossel de ${n}`, `carousel of ${n}`)
    : format === "reels" ? "Reels"
      : format === "carrossel" ? t("carrossel", "carousel")
        : format
);

/** Instagram profile from the account name ("@portal.litoral" → profile link); without @, nothing. */
export function profileInstagram(handle: string): string | null {
  const m = handle.trim().match(/^@([A-Za-z0-9._]{1,30})$/);
  return m ? `https://www.instagram.com/${m[1]}/` : null;
}

// ── + Nova (folha "Nova ideia") ─────────────────────────────────────────────────────────────────────────────────

export type NewMode = "link" | "texto" | "print" | "docs" | "anuncio";
/** `docs` (Google Docs) only appears with the Google configuration on the server (`me.google`). `anuncio`, outside author mode. */
export const NEW_MODES: { valor: NewMode; rotulo: string }[] = [
  { valor: "link", get rotulo() { return t("Link", "Link"); } },
  { valor: "texto", get rotulo() { return t("Texto", "Text"); } },
  { valor: "print", get rotulo() { return t("Print", "Screenshot"); } },
  { valor: "docs", rotulo: "Docs" },
  { valor: "anuncio", get rotulo() { return t("Anúncio", "Ad"); } },
];
/** The URL's `?nova=` → the sheet's tab (an unknown value opens on link; missing, the sheet is closed). */
export const newMode = (v: string | null): NewMode | null => (v === null ? null : NEW_MODES.some((m) => m.valor === v) ? (v as NewMode) : "link");

const NEW_ERRORS = (): Record<string, string> => ({
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

/** A + New error in plain language, by the API's code (never by its text). */
export function newMessage(e: { status?: number; codigo?: string } | null | undefined): string {
  const errors = NEW_ERRORS();
  if (e?.codigo && errors[e.codigo]) return errors[e.codigo];
  if (e?.status === 0) return t("Sem conexão. Confira a internet e tente de novo.", "No connection. Check your internet and try again.");
  if (e?.status && e.status >= 500) return t("A leitura falhou agora. Tente de novo em instantes.", "Reading failed just now. Try again in a moment.");
  return t("Não deu certo agora. Tente de novo.", "That didn't work just now. Try again.");
}

/** What the list says after + New (on the idea itself; already in production, at the top of the screen, depending on its post). */
export function newWarning(state: string, status: string, piece?: string | null): string {
  if (state === "nova") return t("Ideia nova, no topo da lista.", "New idea, at the top of the list.");
  if (state === "de_volta") return t("Essa notícia já tinha passado por aqui e voltou para o topo da lista.", "This story had already come through here and is back at the top of the list.");
  if (status !== "em_producao") return t("Essa notícia já estava na lista.", "This story was already on the list.");
  if (piece === "revisao") return t("Essa notícia já virou post e espera aprovação.", "This story is already a post and is waiting for approval.");
  if (piece === "aprovada" || piece === "agendada") return t("Essa notícia já foi aprovada e espera ser postada.", "This story has already been approved and is waiting to be posted.");
  return t("Essa notícia já está sendo produzida.", "This story is already in production.");
}

/**
 * The + New read finished with the sheet already closed (going back midway): the notice appears on the screen the
 * person is on, with "View" for the idea (or for the post, if the story already became one).
 */
export function newOutsideWarning(r: { situacao: string; status: string; peca?: { id: string; status: string } | null }): string {
  if (r.situacao === "nova") return t("A ideia que você trouxe entrou no topo das Ideias.", "The idea you brought in is at the top of Ideas.");
  if (r.situacao === "de_volta") return t("A notícia que você trouxe já tinha passado por aqui e voltou para o topo das Ideias.", "The story you brought in had already come through here and is back at the top of Ideas.");
  if (r.status === "em_producao" && r.peca) return t("A notícia que você trouxe já virou post.", "The story you brought in is already a post.");
  return t("A notícia que você trouxe já estava nas Ideias.", "The story you brought in was already in Ideas.");
}

/** Uploaded screenshot: width up to 1200 px and up to 4 million pixels (the vision model shrinks it anyway). */
export const printScale = (w: number, h: number) => Math.min(1, 1200 / w, Math.sqrt(4_000_000 / (w * h)));

// ── simple illustration (Kie's fallback to Workers AI) ──────────────────────────────────────────────────────────

/** The illustration fell back to the default style for lack of a key (neither the outlet's nor the server's): an admin turns it on in the AI keys tab. */
export const withoutKeyIllustration = (fallbackOf: string) => /KIE_API_KEY|FAL_KEY/.test(fallbackOf);

/** The `fallbackDe` of the `peca.ilustracao` event (src/lib/illustrate.ts) in plain language, for review's amber strip. */
export function illustrationReason(fallbackOf: string): string {
  if (withoutKeyIllustration(fallbackOf)) return t("o serviço de ilustração ainda não foi ligado", "the illustration service hasn't been turned on yet");
  if (/arteRefR2/.test(fallbackOf)) return t("a marca não tem imagem de referência", "the brand has no reference image");
  if (/\b402\b/.test(fallbackOf)) return t("o serviço de ilustração está sem crédito", "the illustration service is out of credit");
  if (/^(teto de custo|piece cost cap)/.test(fallbackOf)) return t("este post chegou ao limite de custo", "this post reached its cost limit");
  return t("o serviço de ilustração falhou desta vez", "the illustration service failed this time");
}

type PieceEvent = { tipo: unknown; payload?: unknown };
/** Did the displayed version's illustration fall back to the default style? Returns the reason (already in plain language) or null. */
export function simpleIllustration(events: PieceEvent[], version: number): string | null {
  const fallback = fallbackVersion(events, version);
  return fallback ? illustrationReason(fallback) : null;
}
/** The raw reason (`fallbackDe`) for the displayed version's illustration, or null. */
export function fallbackVersion(events: PieceEvent[], version: number): string | null {
  const ev = [...events].reverse().find((e) => e.tipo === "peca.ilustracao" && (e.payload as { versao?: unknown } | null)?.versao === version);
  const fallback = (ev?.payload as { fallbackDe?: unknown } | undefined)?.fallbackDe;
  return typeof fallback === "string" && fallback ? fallback : null;
}

// ── cobertura multi-cidade ─────────────────────────────────────────────────────────────────────────────────────

import { ufIbge } from "../../src/lib/uf";
export { ufIbge as ufDoIbge };
/** "Santos · SP" (without the UF when the code does not match). */
export const areaLabel = (a: { ibge: string; nome: string | null }) => [a.nome ?? a.ibge, ufIbge(a.ibge)].filter(Boolean).join(" · ");

/**
 * Ideas' `?cidade=<ibge>`: only counts if it is a city in the coverage and the outlet covers more than one (otherwise,
 * all). An idea without a city (brought by hand, without a place) only appears in "All".
 */
export function cityFilter(param: string | null, areas: { ibge: string }[]): string | null {
  return param && areas.length > 1 && areas.some((a) => a.ibge === param) ? param : null;
}
export const filterPerCity = <T extends { municipio_ibge: string | null }>(leads: T[], city: string | null) =>
  city ? leads.filter((p) => p.municipio_ibge === city) : leads;
