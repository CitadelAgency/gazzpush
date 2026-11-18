// Município com busca (combobox ARIA 1.2: setas, Enter, Esc). A lista do IBGE (~40 KB gzip) só baixa nesta tela.
import { useEffect, useId, useMemo, useState } from "react";
import { t } from "../idioma";
import { buscarMunicipios, lerMunicipios, rotuloMunicipio, type Municipio } from "./municipios";

export function CampoMunicipio({ valor, onMudar, erro, rotulo = t("Município", "City"), ajuda = t("A triagem só aceita notícia deste município.", "Screening only accepts news from this city.") }:
  { valor: Municipio | null; onMudar: (m: Municipio | null) => void; erro?: string; rotulo?: string; ajuda?: string }) {
  const id = useId();
  const [lista, setLista] = useState<Municipio[] | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [texto, setTexto] = useState(valor ? rotuloMunicipio(valor) : "");
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(0);

  const carregar = () => {
    setFalhou(false);
    import("../dados/municipios").then((m) => setLista(lerMunicipios(m.default)), () => setFalhou(true));
  };
  useEffect(carregar, []);

  const opcoes = useMemo(() => (lista ? buscarMunicipios(lista, texto) : []), [lista, texto]);
  const mostrar = aberto && opcoes.length > 0;
  // O índice ativo vale para a lista atual: escolher troca o texto e a lista encolhe (às vezes para um item só).
  const atual = Math.max(0, Math.min(ativo, opcoes.length - 1));
  const escolher = (m: Municipio) => {
    onMudar(m);
    setTexto(rotuloMunicipio(m));
    setAtivo(0);
    setAberto(false);
  };

  return (
    <div className="grid gap-1.5">
      <label htmlFor={`${id}-e`} className="text-[15px] font-bold text-texto-forte">{rotulo}</label>
      <div className="relative">
        <input
          id={`${id}-e`} className="entrada" role="combobox" autoComplete="off" autoCapitalize="words" autoCorrect="off" spellCheck={false} enterKeyHint="done"
          aria-autocomplete="list" aria-expanded={mostrar} aria-controls={`${id}-l`}
          aria-activedescendant={mostrar ? `${id}-o${atual}` : undefined}
          aria-invalid={erro ? true : undefined} aria-describedby={`${id}-a`}
          placeholder={t("Digite o nome da cidade", "Type the city name")}
          value={texto}
          onChange={(e) => { setTexto(e.target.value); setAtivo(0); setAberto(true); if (valor) onMudar(null); }}
          onFocus={() => setAberto(true)}
          onBlur={() => setAberto(false)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setAberto(true); setAtivo(Math.min(atual + 1, opcoes.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setAtivo(Math.max(atual - 1, 0)); }
            else if (e.key === "Enter" && mostrar && opcoes[atual]) { e.preventDefault(); escolher(opcoes[atual]); }
            else if (e.key === "Escape") setAberto(false);
          }}
        />
        <ul id={`${id}-l`} role="listbox" aria-label={t("Municípios encontrados", "Matching cities")} hidden={!mostrar}
          className="absolute top-full right-0 left-0 z-20 m-0 mt-1 max-h-[320px] list-none overflow-auto rounded-btn bg-papel p-1 shadow-[0_1px_3px_rgb(21_23_27/.14),0_18px_40px_-16px_rgb(21_23_27/.35)]">
          {opcoes.map((m, i) => (
            <li key={m.ibge} id={`${id}-o${i}`} role="option" aria-selected={i === atual}
              onMouseDown={(e) => { e.preventDefault(); escolher(m); }} onMouseMove={() => { if (atual !== i) setAtivo(i); }}
              className={`flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-faixa px-3 ${i === atual ? "bg-papel-2" : ""}`}>
              <span className="text-texto-forte">{m.nome}</span>{" "}
              <span className="mono text-apoio">{m.uf}</span>
            </li>
          ))}
        </ul>
      </div>
      <p id={`${id}-a`} className={`m-0 ${erro ? "text-[15px] text-terracota" : "ajuda"}`}>
        {erro ?? (falhou
          ? <>{t("Não carregou a lista de municípios.", "Couldn't load the list of cities.")} <button type="button" onClick={carregar} className="cursor-pointer font-bold underline">{t("Tentar de novo", "Try again")}</button></>
          : ajuda)}
      </p>
    </div>
  );
}
