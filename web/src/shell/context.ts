// What the shell hands to the screens inside it (Outlet): the URL's outlet and the session.
import { useOutletContext } from "react-router";
import { t } from "../language";
import type { Me, Outlet } from "../session";

/** Where the open post stands: in review, decided (rejected), ready to post or posted. */
export type PieceMode = "revisao" | "decidida" | "postar" | "postado" | null;

export type CtxShell = {
  veiculo: Outlet;
  me: NonNullable<Me>;
  /**
   * The post's screen says where it stands. In review, on mobile the decision sheet takes the place of the bottom
   * navigation. The marked section follows the post: progress in Ideas; review or rejected in To approve; approved in
   * Ready to post; posted in Posted.
   */
  marcarPeca: (m: PieceMode) => void;
};
export const useShell = () => useOutletContext<CtxShell>();

// Functions, not constants: the text comes out in the language at draw time.
export const sections = () => [
  { to: "", rotulo: t("Ideias", "Ideas"), curto: t("Ideias", "Ideas") },
  { to: "aprovar", rotulo: t("Para aprovar", "To approve"), curto: t("Aprovar", "Approve") },
  { to: "postar", rotulo: t("Prontos para postar", "Ready to post"), curto: t("Postar", "Post") },
  { to: "postados", rotulo: t("Postados", "Posted"), curto: t("Postados", "Posted") },
] as const;

/** The sidebar's "Outlet" group (and the avatar menu's on mobile): the outlet screen's tabs. */
export const outletParts = () => [
  { aba: "marca", rotulo: t("Marca", "Brand") },
  { aba: "contas", rotulo: t("Contas", "Accounts") },
  { aba: "fontes", rotulo: t("Fontes", "Sources") },
  { aba: "equipe", rotulo: t("Equipe", "Team") },
  { aba: "kit", rotulo: t("Se a conta cair", "If the account goes down") },
  { aba: "plano", rotulo: t("Plano", "Plan") },
  { aba: "chaves", rotulo: t("Chaves de IA", "AI keys") },
] as const;

/** The name of the role in the team. */
export const role = (p: string) => ({ admin: "admin", editor: "editor", reporter: t("repórter", "reporter") } as Record<string, string>)[p] ?? p;
