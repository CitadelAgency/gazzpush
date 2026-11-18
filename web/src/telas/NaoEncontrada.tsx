import { Link } from "react-router";
import { useTitulo } from "../comum";
import { t } from "../idioma";
import { VoltaLapis } from "../kit/Lapis";
import { MesaVazia } from "../kit/Prova";

// Endereço que não existe: uma prova em branco sobre a mesa e o caminho de volta (a marca à mão da tela).
export default function NaoEncontrada({ mensagem = t("Esse endereço não existe no aplicativo.", "This address doesn't exist in the app.") }: { mensagem?: string }) {
  useTitulo(t("Não encontrada", "Not found"));
  return (
    <main id="conteudo" className="mx-auto max-w-[760px] px-5 pt-14 lg:pt-28">
      <MesaVazia rotulo="404">
        <h1 className="titulo-tela m-0 text-[32px] lg:text-[44px]">{t("Página não encontrada", "Page not found")}</h1>
        <p className="m-0 max-w-[48ch]">{mensagem}</p>
        <Link to="/" className="acao-lapis -ml-[6px]"><span>{t("Ir para o início", "Go to the start")}</span><VoltaLapis desenhar /></Link>
      </MesaVazia>
    </main>
  );
}
