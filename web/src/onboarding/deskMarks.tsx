// Review desk pieces the Texts list also uses: the labels and icons of the three marks (DESIGN.md §2 colour, always
// with an icon and text), the count and the Story's tabs. The blue pencil never marks state. The marks in the text are
// drawn by the editor (src/story/extensions.ts).
import type { ReactNode } from "react";
import { t } from "../language";

export type State = "com_evidencia" | "sem_fonte" | "risco";
/** Drawing states in the Story editor: the three, recorded reporting and code findings. */
export type ScreenState = State | "resolvida" | "conta" | "aspa" | "gravacao" | "manual";

/** The Texts list key (the desk invalidates it on save). */
export const textsKey = (tenantId: string) => [tenantId, "textos"] as const;

export const STATE_LABEL: Record<State, string> = {
  get com_evidencia() { return t("com evidência", "with evidence"); },
  get sem_fonte() { return t("sem fonte", "no source"); },
  get risco() { return t("risco jurídico", "legal risk"); },
};
export const RISK_LABEL: Record<string, string> = {
  get acusacao_sem_condenacao() { return t("acusação sem condenação nem fonte oficial", "accusation with no conviction or official source"); },
  get vitima_ou_menor() { return t("nome de vítima ou de menor de idade", "name of a victim or a minor"); },
  get sem_outro_lado() { return t("acusação sem registro de que o citado foi procurado", "accusation with no record that the person named was asked for comment"); },
};
export const SCREEN_LABEL: Record<ScreenState, string> = {
  get com_evidencia() { return STATE_LABEL.com_evidencia; },
  get sem_fonte() { return STATE_LABEL.sem_fonte; },
  get risco() { return STATE_LABEL.risco; },
  get resolvida() { return t("apuração registrada", "reporting recorded"); },
  get conta() { return t("conta que não fecha", "math that doesn't add up"); },
  get aspa() { return t("aspa sem fonte", "unsourced quote"); },
  get gravacao() { return t("bate com a gravação", "matches the recording"); },
  get manual() { return t("manual de redação", "style guide"); },
};
const ICON_COLOR: Record<ScreenState, string> = {
  com_evidencia: "text-verde", sem_fonte: "text-ambar", risco: "text-terracota", resolvida: "text-apoio", conta: "text-terracota", aspa: "text-ambar", gravacao: "text-verde", manual: "text-texto",
};

function Svg({ children, className }: { children: ReactNode; className: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className={className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

/**
 * The state's icon: check (with evidence), question mark (unsourced), triangle with exclamation (risk); dash (recorded
 * reporting), not-equal sign (arithmetic), quote marks (unsourced quote), sound wave (matches the recording) and open
 * book (style guide).
 */
export function IconState({ estado: state, className = "size-3.5" }: { estado: ScreenState; className?: string }) {
  const c = `${className} inline-block flex-none align-[-2px] ${ICON_COLOR[state]}`;
  if (state === "com_evidencia") return <Svg className={c}><path d="M3 8.5l3 3 7-7" /></Svg>;
  if (state === "resolvida") return <Svg className={c}><path d="M3 8h10" /></Svg>;
  if (state === "conta") return <Svg className={c}><path d="M3 6h10" /><path d="M3 10h10" /><path d="M11 3L5 13" /></Svg>;
  if (state === "aspa") return <Svg className={c}><path d="M4 5v3.5c0 1.2-.6 2.2-1.5 2.8" /><path d="M10 5v3.5c0 1.2-.6 2.2-1.5 2.8" /></Svg>;
  if (state === "gravacao") return <Svg className={c}><path d="M3 7v2" /><path d="M6 5v6" /><path d="M9 3v10" /><path d="M12 6v4" /></Svg>;
  if (state === "manual") return <Svg className={c}><path d="M3 3.5h4a1.5 1.5 0 0 1 1.5 1.5v8a1 1 0 0 0-1-1H3z" /><path d="M13 3.5H9.5A1.5 1.5 0 0 0 8 5v8a1 1 0 0 1 1-1h4z" /></Svg>;
  if (state === "sem_fonte") return <Svg className={c}><path d="M5.8 5.6a2.3 2.3 0 1 1 3.2 2.1c-.6.3-1 .8-1 1.5v.4" /><circle cx="8" cy="12.6" r=".5" fill="currentColor" /></Svg>;
  return <Svg className={c}><path d="M8 2.5l6 11H2z" /><path d="M8 6.5v3.2" /><circle cx="8" cy="11.6" r=".5" fill="currentColor" /></Svg>;
}

export type Count = { comEvidencia: number; semFonte: number; risco: number };

export function countMarks(claims: { estado: State }[]): Count {
  return {
    comEvidencia: claims.filter((a) => a.estado === "com_evidencia").length,
    semFonte: claims.filter((a) => a.estado === "sem_fonte").length,
    risco: claims.filter((a) => a.estado === "risco").length,
  };
}

/** "3 with evidence · 1 unsourced · 1 legal risk" in mono, each part with the state's icon. */
export function Marker({ contagem: count }: { contagem: Count }) {
  const parts: [State, number][] = [["com_evidencia", count.comEvidencia], ["sem_fonte", count.semFonte], ["risco", count.risco]];
  const total = parts.reduce((n, [, x]) => n + x, 0);
  if (!total) return <span className="mono text-apoio">{t("nenhuma afirmação de fato marcada", "no factual claims marked")}</span>;
  return (
    <span className="mono inline-flex flex-wrap gap-x-3 gap-y-1 text-texto">
      {parts.filter(([, n]) => n > 0).map(([e, n]) => (
        <span key={e} className="inline-flex items-center gap-1"><IconState estado={e} />{n} {STATE_LABEL[e]}</span>
      ))}
    </span>
  );
}

/** The Story's tabs (`?aba=`): Dossier · Text · Posts · After. Unknown or missing opens Text. */
export const TABS_STORY = ["dossie", "texto", "posts", "depois"] as const;
export type TabStory = (typeof TABS_STORY)[number];
export const tabStory = (v: string | null): TabStory => ((TABS_STORY as readonly string[]).includes(v ?? "") ? (v as TabStory) : "texto");
export const TAB_LABEL: Record<TabStory, string> = {
  get dossie() { return t("Dossiê", "Dossier"); },
  get texto() { return t("Texto", "Text"); },
  get posts() { return t("Posts", "Posts"); },
  get depois() { return t("Depois", "After"); },
};

/** A post's status on the Posts tab, in plain language (the same as the menu). */
export const STATUS_POST_LABEL: Record<string, string> = {
  get rascunho() { return t("produzindo", "in production"); },
  get revisao() { return t("para aprovar", "to approve"); },
  get aprovada() { return t("pronto para postar", "ready to post"); },
  get agendada() { return t("agendado", "scheduled"); },
  get publicada() { return t("postado", "posted"); },
  get falhou() { return t("falhou", "failed"); },
  get rejeitada() { return t("rejeitado", "rejected"); },
};
