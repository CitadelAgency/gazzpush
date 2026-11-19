// "Produce" at the plan's limit: explains and leads to the plan. A non-admin sees whom to ask.
import { Link } from "react-router";
import { t } from "../language";
import type { Outlet } from "../session";

// `codigo` sem_chave_texto: what is missing is the AI key, not the plan (the API answers 402 in both cases).
export function LimitWarning({ mensagem: message, veiculo: outlet, codigo: code }: { mensagem: string; veiculo: Outlet; codigo?: string }) {
  const key = code === "sem_chave_texto";
  return (
    <p role="alert" className="m-0 w-full text-[15px] text-terracota">
      {message}{" "}
      {outlet.papel === "admin"
        ? <Link to={`/t/${outlet.slug}/veiculo?aba=${key ? "chaves" : "plano"}`} className="link-acao">{key ? t("Colar a chave de IA", "Paste the AI key") : t("Ver o plano", "See the plan")}</Link>
        : t("Peça ao admin do veículo.", "Ask the outlet's admin.")}
    </p>
  );
}
