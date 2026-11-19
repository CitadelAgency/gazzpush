import { Link } from "react-router";
import { useTitle } from "../common";
import { t } from "../language";
import { BackPencil } from "../kit/Pencil";
import { EmptyDesk } from "../kit/Proof";

// An address that does not exist: a blank proof on the desk and the way back (the screen's hand mark).
export default function NotFound({ mensagem: message = t("Esse endereço não existe no aplicativo.", "This address doesn't exist in the app.") }: { mensagem?: string }) {
  useTitle(t("Não encontrada", "Not found"));
  return (
    <main id="conteudo" className="mx-auto max-w-[760px] px-5 pt-14 lg:pt-28">
      <EmptyDesk rotulo="404">
        <h1 className="titulo-tela m-0 text-[32px] lg:text-[44px]">{t("Página não encontrada", "Page not found")}</h1>
        <p className="m-0 max-w-[48ch]">{message}</p>
        <Link to="/" className="acao-lapis -ml-[6px]"><span>{t("Ir para o início", "Go to the start")}</span><BackPencil desenhar /></Link>
      </EmptyDesk>
    </main>
  );
}
