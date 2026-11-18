// "Produzir" no limite do plano: explica e leva ao plano. Quem não é admin vê a quem pedir.
import { Link } from "react-router";
import { t } from "../idioma";
import type { Veiculo } from "../sessao";

// `codigo` sem_chave_texto: o que falta é a chave de IA, não o plano (a API responde 402 nos dois casos).
export function AvisoLimite({ mensagem, veiculo, codigo }: { mensagem: string; veiculo: Veiculo; codigo?: string }) {
  const chave = codigo === "sem_chave_texto";
  return (
    <p role="alert" className="m-0 w-full text-[15px] text-terracota">
      {mensagem}{" "}
      {veiculo.papel === "admin"
        ? <Link to={`/t/${veiculo.slug}/veiculo?aba=${chave ? "chaves" : "plano"}`} className="link-acao">{chave ? t("Colar a chave de IA", "Paste the AI key") : t("Ver o plano", "See the plan")}</Link>
        : t("Peça ao admin do veículo.", "Ask the outlet's admin.")}
    </p>
  );
}
