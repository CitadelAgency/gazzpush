// Municipality with search (ARIA 1.2 combobox: arrows, Enter, Esc). The IBGE list (~40 KB gzip) only downloads on this screen.
import { useEffect, useId, useMemo, useState } from "react";
import { t } from "../language";
import { fetchMunicipalities, readMunicipalities, municipalityLabel, type Municipality } from "./municipalities";

export function MunicipalityInput({ valor: value, onMudar: onChange, erro: error, rotulo: caption = t("Município", "City"), ajuda: help = t("A triagem só aceita notícia deste município.", "Screening only accepts news from this city.") }:
  { valor: Municipality | null; onMudar: (m: Municipality | null) => void; erro?: string; rotulo?: string; ajuda?: string }) {
  const id = useId();
  const [list, setList] = useState<Municipality[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState(value ? municipalityLabel(value) : "");
  const [open, openSet] = useState(false);
  const [active, activeSet] = useState(0);

  const load = () => {
    setFailed(false);
    import("../data/municipalities").then((m) => setList(readMunicipalities(m.default)), () => setFailed(true));
  };
  useEffect(load, []);

  const options = useMemo(() => (list ? fetchMunicipalities(list, text) : []), [list, text]);
  const show = open && options.length > 0;
  // The active index applies to the current list: choosing changes the text and the list shrinks (sometimes to a single item).
  const current = Math.max(0, Math.min(active, options.length - 1));
  const choose = (m: Municipality) => {
    onChange(m);
    setText(municipalityLabel(m));
    activeSet(0);
    openSet(false);
  };

  return (
    <div className="grid gap-1.5">
      <label htmlFor={`${id}-e`} className="text-[15px] font-bold text-texto-forte">{caption}</label>
      <div className="relative">
        <input
          id={`${id}-e`} className="entrada" role="combobox" autoComplete="off" autoCapitalize="words" autoCorrect="off" spellCheck={false} enterKeyHint="done"
          aria-autocomplete="list" aria-expanded={show} aria-controls={`${id}-l`}
          aria-activedescendant={show ? `${id}-o${current}` : undefined}
          aria-invalid={error ? true : undefined} aria-describedby={`${id}-a`}
          placeholder={t("Digite o nome da cidade", "Type the city name")}
          value={text}
          onChange={(e) => { setText(e.target.value); activeSet(0); openSet(true); if (value) onChange(null); }}
          onFocus={() => openSet(true)}
          onBlur={() => openSet(false)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); openSet(true); activeSet(Math.min(current + 1, options.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); activeSet(Math.max(current - 1, 0)); }
            else if (e.key === "Enter" && show && options[current]) { e.preventDefault(); choose(options[current]); }
            else if (e.key === "Escape") openSet(false);
          }}
        />
        <ul id={`${id}-l`} role="listbox" aria-label={t("Municípios encontrados", "Matching cities")} hidden={!show}
          className="absolute top-full right-0 left-0 z-20 m-0 mt-1 max-h-[320px] list-none overflow-auto rounded-btn bg-papel p-1 shadow-[0_1px_3px_rgb(21_23_27/.14),0_18px_40px_-16px_rgb(21_23_27/.35)]">
          {options.map((m, i) => (
            <li key={m.ibge} id={`${id}-o${i}`} role="option" aria-selected={i === current}
              onMouseDown={(e) => { e.preventDefault(); choose(m); }} onMouseMove={() => { if (current !== i) activeSet(i); }}
              className={`flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-faixa px-3 ${i === current ? "bg-papel-2" : ""}`}>
              <span className="text-texto-forte">{m.nome}</span>{" "}
              <span className="mono text-apoio">{m.uf}</span>
            </li>
          ))}
        </ul>
      </div>
      <p id={`${id}-a`} className={`m-0 ${error ? "text-[15px] text-terracota" : "ajuda"}`}>
        {error ?? (failed
          ? <>{t("Não carregou a lista de municípios.", "Couldn't load the list of cities.")} <button type="button" onClick={load} className="cursor-pointer font-bold underline">{t("Tentar de novo", "Try again")}</button></>
          : help)}
      </p>
    </div>
  );
}
