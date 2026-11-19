// The product's promise, in view for whoever has no account yet: brand, language, title and the supporting sentence. Sign in and Waitlist.
import { language, t } from "../language";
import { chooseLanguage } from "../session";
import GazzpushBrand from "./GazzpushMark";

/** Separate from the title: on mobile, Waitlist moves it after the form, so the button stays in view. */
export const supportSentence = () => t("Cada frase do post aponta a fonte de onde saiu. Nada é publicado sem a sua leitura.", "Every sentence in the post points to the source it came from. Nothing is published until you read it.");

export default function PromiseCard({ apoioSoNoComputador: supportOnlyInDesktop = false }: { apoioSoNoComputador?: boolean }) {
  return (
    <section className="grid content-start gap-4 lg:col-start-1 lg:row-start-1 lg:gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <GazzpushBrand />
        <ChoiceLanguage />
      </div>
      <h1 className="titulo-tela max-w-[18ch] text-[26px] leading-[1.05] lg:text-[54px]">
        {t("A notícia da sua cidade vira post pronto para o Instagram. Você só confere e aprova.", "Your city's news becomes a post ready for Instagram. You just check and approve.")}
      </h1>
      <p className={`m-0 max-w-[46ch] text-[16px] lg:text-[19px] ${supportOnlyInDesktop ? "max-lg:hidden" : ""}`}>{supportSentence()}</p>
    </section>
  );
}

/**
 * The app's language, in view as soon as the person arrives (before having an account): both options, each written in
 * its own language, the current one marked. It stays in this browser and goes to the account on sign-in (session.ts,
 * chooseLanguage).
 */
function ChoiceLanguage() {
  const current = language();
  return (
    <div role="group" aria-label="Idioma · Language" className="flex rounded-btn bg-papel-2 p-0.5">
      {([["pt-BR", "Português"], ["en", "English"]] as const).map(([value, name]) => (
        <button
          key={value} type="button" lang={value} aria-pressed={current === value}
          onClick={() => { if (current !== value) void chooseLanguage(value, false); }}
          className={`min-h-11 cursor-pointer rounded-btn px-3 text-[15px] ${current === value ? "bg-papel font-bold text-texto-forte shadow-fio" : "text-apoio hover:text-texto-forte"}`}
        >
          {name}
        </button>
      ))}
    </div>
  );
}
