// A promessa do produto, à vista de quem ainda não tem conta: marca, idioma, título e a frase de apoio. Entrar e Lista de espera.
import { idioma, t } from "../idioma";
import { escolherIdioma } from "../sessao";
import MarcaGazzpush from "./MarcaGazzpush";

/** Separada do título: no celular, a Lista de espera a leva para depois do formulário, para o botão ficar à vista. */
export const fraseApoio = () => t("Cada frase do post aponta a fonte de onde saiu. Nada é publicado sem a sua leitura.", "Every sentence in the post points to the source it came from. Nothing is published until you read it.");

export default function Promessa({ apoioSoNoComputador = false }: { apoioSoNoComputador?: boolean }) {
  return (
    <section className="grid content-start gap-4 lg:col-start-1 lg:row-start-1 lg:gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <MarcaGazzpush />
        <EscolhaIdioma />
      </div>
      <h1 className="titulo-tela max-w-[18ch] text-[26px] leading-[1.05] lg:text-[54px]">
        {t("A notícia da sua cidade vira post pronto para o Instagram. Você só confere e aprova.", "Your city's news becomes a post ready for Instagram. You just check and approve.")}
      </h1>
      <p className={`m-0 max-w-[46ch] text-[16px] lg:text-[19px] ${apoioSoNoComputador ? "max-lg:hidden" : ""}`}>{fraseApoio()}</p>
    </section>
  );
}

/**
 * Idioma do app, à vista assim que a pessoa chega (antes de ter conta): as duas opções, cada uma escrita no próprio
 * idioma, a atual marcada. Fica neste navegador e vai para a conta ao entrar (sessao.ts, escolherIdioma).
 */
function EscolhaIdioma() {
  const atual = idioma();
  return (
    <div role="group" aria-label="Idioma · Language" className="flex rounded-btn bg-papel-2 p-0.5">
      {([["pt-BR", "Português"], ["en", "English"]] as const).map(([valor, nome]) => (
        <button
          key={valor} type="button" lang={valor} aria-pressed={atual === valor}
          onClick={() => { if (atual !== valor) void escolherIdioma(valor, false); }}
          className={`min-h-11 cursor-pointer rounded-btn px-3 text-[15px] ${atual === valor ? "bg-papel font-bold text-texto-forte shadow-fio" : "text-apoio hover:text-texto-forte"}`}
        >
          {nome}
        </button>
      ))}
    </div>
  );
}
