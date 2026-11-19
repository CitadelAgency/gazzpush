// The product's promise in three seconds, on the sign-in screen: a real card (highlighted number, the carousel layout),
// one of its sentences underlined in pencil and the source passage it came from, joined by a stroke. Everything draws
// once, in sequence (card, underline, link, source, check) and stays still; with "reduce motion" it appears finished.
// It is an illustration: the promise's text is in the screen's title, so nothing here is read or focusable. The source
// is made up on purpose ("Diário do Porto"): we do not attribute a sentence to a real outlet.
import { t } from "../language";
import { UnderlinePencil, SeenPencil } from "./Pencil";

export default function DemoProof() {
  return (
    <div className="demo" aria-hidden="true">
      <div className="demo-card corte">
        <p className="demo-topo"><span>{t("Seu veículo", "Your outlet")}</span><span>{t("31 out.", "Oct 31")}</span></p>
        <p className="demo-numero">17h</p>
        <p className="demo-frase">
          {t("de navegação ", "of navigation ")}
          <span className="relative whitespace-nowrap">
            {t("parcialmente suspensa", "partly suspended")}
            <UnderlinePencil desenhar seed={7} larg={2.2} className="demo-risco" />
          </span>
          {t(" no canal do Porto", " in the Port channel")}
        </p>
        <p className="demo-rodape">{t("Fonte: Diário do Porto", "Source: Porto Daily")}</p>
      </div>

      {/* From the end of the underline to the source card. The drawing follows the demo's fixed size (480 × 330). */}
      <svg className="demo-ligacao" viewBox="0 0 480 330" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path pathLength={1} d="M196 210 C 232 212, 244 226, 262 232" />
        <path pathLength={1} className="demo-seta" d="M252 224 L263 232 L250 238" />
      </svg>

      <div className="demo-fonte">
        <p className="demo-fonte-nome">{t("Diário do Porto · 31 out.", "Porto Daily · Oct 31")}</p>
        <p className="demo-trecho">
          {t("…o canal está com a navegação ", "…the channel has seen ")}
          <mark>{t("parcialmente suspensa há mais de 17 horas", "navigation partly suspended for more than 17 hours")}</mark>
          {t(" após um guindaste atingir…", " after a crane hit…")}
        </p>
        <p className="demo-ok"><SeenPencil desenhar seed={4} className="text-verde" /> {t("frase presa à fonte", "sentence tied to its source")}</p>
      </div>
    </div>
  );
}
