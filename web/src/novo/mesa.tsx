// Peças da mesa revisora que a lista de Textos também usa: os rótulos e ícones das três marcas (cor do DESIGN.md §2
// sempre com ícone e texto), a contagem e as abas da Matéria. O lápis azul nunca marca estado. As marcas no texto são
// desenhadas pelo editor (src/materia/extensoes.ts).
import type { ReactNode } from "react";
import { t } from "../idioma";

export type Estado = "com_evidencia" | "sem_fonte" | "risco";
/** Estados do desenho no editor da Matéria: os três, a apuração registrada e os apontamentos do código. */
export type EstadoTela = Estado | "resolvida" | "conta" | "aspa" | "gravacao" | "manual";

/** Chave da lista de Textos (a mesa invalida ao salvar). */
export const chaveTextos = (tenantId: string) => [tenantId, "textos"] as const;

export const ROTULO_ESTADO: Record<Estado, string> = {
  get com_evidencia() { return t("com evidência", "with evidence"); },
  get sem_fonte() { return t("sem fonte", "no source"); },
  get risco() { return t("risco jurídico", "legal risk"); },
};
export const ROTULO_RISCO: Record<string, string> = {
  get acusacao_sem_condenacao() { return t("acusação sem condenação nem fonte oficial", "accusation with no conviction or official source"); },
  get vitima_ou_menor() { return t("nome de vítima ou de menor de idade", "name of a victim or a minor"); },
  get sem_outro_lado() { return t("acusação sem registro de que o citado foi procurado", "accusation with no record that the person named was asked for comment"); },
};
export const ROTULO_TELA: Record<EstadoTela, string> = {
  get com_evidencia() { return ROTULO_ESTADO.com_evidencia; },
  get sem_fonte() { return ROTULO_ESTADO.sem_fonte; },
  get risco() { return ROTULO_ESTADO.risco; },
  get resolvida() { return t("apuração registrada", "reporting recorded"); },
  get conta() { return t("conta que não fecha", "math that doesn't add up"); },
  get aspa() { return t("aspa sem fonte", "unsourced quote"); },
  get gravacao() { return t("bate com a gravação", "matches the recording"); },
  get manual() { return t("manual de redação", "style guide"); },
};
const COR_ICONE: Record<EstadoTela, string> = {
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
 * Ícone do estado: visto (com evidência), interrogação (sem fonte), triângulo com exclamação (risco); traço (apuração
 * registrada), sinal de diferente (conta), aspas (aspa sem fonte), onda de som (bate com a gravação) e livro aberto (manual).
 */
export function IconeEstado({ estado, className = "size-3.5" }: { estado: EstadoTela; className?: string }) {
  const c = `${className} inline-block flex-none align-[-2px] ${COR_ICONE[estado]}`;
  if (estado === "com_evidencia") return <Svg className={c}><path d="M3 8.5l3 3 7-7" /></Svg>;
  if (estado === "resolvida") return <Svg className={c}><path d="M3 8h10" /></Svg>;
  if (estado === "conta") return <Svg className={c}><path d="M3 6h10" /><path d="M3 10h10" /><path d="M11 3L5 13" /></Svg>;
  if (estado === "aspa") return <Svg className={c}><path d="M4 5v3.5c0 1.2-.6 2.2-1.5 2.8" /><path d="M10 5v3.5c0 1.2-.6 2.2-1.5 2.8" /></Svg>;
  if (estado === "gravacao") return <Svg className={c}><path d="M3 7v2" /><path d="M6 5v6" /><path d="M9 3v10" /><path d="M12 6v4" /></Svg>;
  if (estado === "manual") return <Svg className={c}><path d="M3 3.5h4a1.5 1.5 0 0 1 1.5 1.5v8a1 1 0 0 0-1-1H3z" /><path d="M13 3.5H9.5A1.5 1.5 0 0 0 8 5v8a1 1 0 0 1 1-1h4z" /></Svg>;
  if (estado === "sem_fonte") return <Svg className={c}><path d="M5.8 5.6a2.3 2.3 0 1 1 3.2 2.1c-.6.3-1 .8-1 1.5v.4" /><circle cx="8" cy="12.6" r=".5" fill="currentColor" /></Svg>;
  return <Svg className={c}><path d="M8 2.5l6 11H2z" /><path d="M8 6.5v3.2" /><circle cx="8" cy="11.6" r=".5" fill="currentColor" /></Svg>;
}

export type Contagem = { comEvidencia: number; semFonte: number; risco: number };

export function contagemMarcas(afirmacoes: { estado: Estado }[]): Contagem {
  return {
    comEvidencia: afirmacoes.filter((a) => a.estado === "com_evidencia").length,
    semFonte: afirmacoes.filter((a) => a.estado === "sem_fonte").length,
    risco: afirmacoes.filter((a) => a.estado === "risco").length,
  };
}

/** "3 com evidência · 1 sem fonte · 1 risco jurídico" em mono, cada parte com o ícone do estado. */
export function Marcador({ contagem }: { contagem: Contagem }) {
  const partes: [Estado, number][] = [["com_evidencia", contagem.comEvidencia], ["sem_fonte", contagem.semFonte], ["risco", contagem.risco]];
  const total = partes.reduce((n, [, x]) => n + x, 0);
  if (!total) return <span className="mono text-apoio">{t("nenhuma afirmação de fato marcada", "no factual claims marked")}</span>;
  return (
    <span className="mono inline-flex flex-wrap gap-x-3 gap-y-1 text-texto">
      {partes.filter(([, n]) => n > 0).map(([e, n]) => (
        <span key={e} className="inline-flex items-center gap-1"><IconeEstado estado={e} />{n} {ROTULO_ESTADO[e]}</span>
      ))}
    </span>
  );
}

/** Abas da Matéria (`?aba=`): Dossiê · Texto · Posts · Depois. Desconhecida ou ausente abre o Texto. */
export const ABAS_MATERIA = ["dossie", "texto", "posts", "depois"] as const;
export type AbaMateria = (typeof ABAS_MATERIA)[number];
export const abaMateria = (v: string | null): AbaMateria => ((ABAS_MATERIA as readonly string[]).includes(v ?? "") ? (v as AbaMateria) : "texto");
export const ROTULO_ABA: Record<AbaMateria, string> = {
  get dossie() { return t("Dossiê", "Dossier"); },
  get texto() { return t("Texto", "Text"); },
  get posts() { return t("Posts", "Posts"); },
  get depois() { return t("Depois", "After"); },
};

/** Status do post na aba Posts, em linguagem de leigo (o mesmo do menu). */
export const ROTULO_STATUS_POST: Record<string, string> = {
  get rascunho() { return t("produzindo", "in production"); },
  get revisao() { return t("para aprovar", "to approve"); },
  get aprovada() { return t("pronto para postar", "ready to post"); },
  get agendada() { return t("agendado", "scheduled"); },
  get publicada() { return t("postado", "posted"); },
  get falhou() { return t("falhou", "failed"); },
  get rejeitada() { return t("rejeitado", "rejected"); },
};
