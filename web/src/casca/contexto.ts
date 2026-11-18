// O que a casca entrega às telas de dentro (Outlet): o veículo da URL e a sessão.
import { useOutletContext } from "react-router";
import { t } from "../idioma";
import type { Me, Veiculo } from "../sessao";

/** Em que ponto está o post aberto: em revisão, decidido (rejeitado), pronto para postar ou postado. */
export type ModoPeca = "revisao" | "decidida" | "postar" | "postado" | null;

export type CtxCasca = {
  veiculo: Veiculo;
  me: NonNullable<Me>;
  /**
   * A tela do post diz em que ponto ele está. Em revisão, no celular a folha de decisão toma o lugar da navegação de
   * baixo. A seção marcada segue o post: andamento em Ideias; revisão ou rejeitado em Para aprovar; aprovado em Prontos
   * para postar; postado em Postados.
   */
  marcarPeca: (m: ModoPeca) => void;
};
export const useCasca = () => useOutletContext<CtxCasca>();

// Funções, não constantes: o texto sai no idioma da hora de desenhar.
export const secoes = () => [
  { to: "", rotulo: t("Ideias", "Ideas"), curto: t("Ideias", "Ideas") },
  { to: "aprovar", rotulo: t("Para aprovar", "To approve"), curto: t("Aprovar", "Approve") },
  { to: "postar", rotulo: t("Prontos para postar", "Ready to post"), curto: t("Postar", "Post") },
  { to: "postados", rotulo: t("Postados", "Posted"), curto: t("Postados", "Posted") },
] as const;

/** Grupo "Veículo" da lateral (e do menu do avatar no celular): as abas da tela do veículo. */
export const partesVeiculo = () => [
  { aba: "marca", rotulo: t("Marca", "Brand") },
  { aba: "contas", rotulo: t("Contas", "Accounts") },
  { aba: "fontes", rotulo: t("Fontes", "Sources") },
  { aba: "equipe", rotulo: t("Equipe", "Team") },
  { aba: "kit", rotulo: t("Se a conta cair", "If the account goes down") },
  { aba: "plano", rotulo: t("Plano", "Plan") },
  { aba: "chaves", rotulo: t("Chaves de IA", "AI keys") },
] as const;

/** Nome do papel na equipe. */
export const papel = (p: string) => ({ admin: "admin", editor: "editor", reporter: t("repórter", "reporter") } as Record<string, string>)[p] ?? p;
