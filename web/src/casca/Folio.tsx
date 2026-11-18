// Fólio (DESIGN.md §12): a linha do alto da folha, como no alto de uma página de jornal. À esquerda, onde estou: o nome
// da tela aparece quando o título rola para fora, e a tela de um post põe ali o caminho de volta (NoFolio). À direita,
// o que está acontecendo (produzindo, fonte indisponível), a data e a praça; a tela pode trocar por algo dela (NoFolioDir).
import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { instante, useFontes, usePecas } from "../fila";
import { locale, t } from "../idioma";
import { PRODUTO } from "../marca";
import { localDe, type Veiculo } from "../sessao";
import { IconeAlerta, Registro } from "./icones";

/** O nome da tela, tirado do título da aba (useTitulo): vale para toda tela, sem cada uma ter de avisar a casca. */
function useNomeDaTela() {
  const ler = () => { const nome = document.title.split(" · ")[0] ?? ""; return nome === PRODUTO ? "" : nome; };
  const [nome, setNome] = useState(ler);
  useEffect(() => {
    const titulo = document.querySelector("title");
    if (!titulo) return;
    const olho = new MutationObserver(() => setNome(ler()));
    olho.observe(titulo, { childList: true, characterData: true, subtree: true });
    setNome(ler());
    return () => olho.disconnect();
  }, []);
  return nome;
}

export function Folio({ veiculo }: { veiculo: Veiculo }) {
  const [rolou, setRolou] = useState(false);
  useEffect(() => {
    const ver = () => setRolou(window.scrollY > 40);
    ver();
    window.addEventListener("scroll", ver, { passive: true });
    return () => window.removeEventListener("scroll", ver);
  }, []);
  const nome = useNomeDaTela();
  const pecas = usePecas(veiculo.id);
  const fontes = useFontes(veiculo.id);
  const rascunhos = (pecas.data?.pecas ?? []).filter((p) => p.status === "rascunho").sort((a, b) => instante(a.created_at) - instante(b.created_at));
  const produzindo = Math.max(pecas.data?.total.rascunho ?? 0, rascunhos.length);
  const fora = fontes.data?.fontes.filter((f) => !f.ok).length ?? 0;
  const hoje = new Intl.DateTimeFormat(locale(), { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
  return (
    <div className="folio" data-rolou={rolou ? "" : undefined}>
      <div className="folio-trilha" id="folio-trilha"><b className="folio-titulo" aria-hidden="true">{nome}</b></div>
      <div className="folio-dir">
        <div id="folio-dir" className="contents" />
        <div className="folio-padrao">
          {produzindo > 0 && rascunhos[0] && (
            <Link to={`p/${rascunhos[0].id}`} viewTransition className="folio-estado mono"><Registro />{t(`${produzindo} produzindo`, `${produzindo} in production`)}</Link>
          )}
          {fora > 0 && (
            <Link to="veiculo?aba=fontes" viewTransition className="folio-estado mono" data-tom="aviso">
              <IconeAlerta className="size-[15px]" />{fora === 1 ? t("1 fonte indisponível", "1 source unavailable") : t(`${fora} fontes indisponíveis`, `${fora} sources unavailable`)}
            </Link>
          )}
          <span className="mono">{hoje} · {localDe(veiculo)}</span>
        </div>
      </div>
    </div>
  );
}

function useNo(id: string) {
  const [no, setNo] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => { setNo(document.getElementById(id)); }, [id]);
  return no;
}

/** O caminho de volta da tela (e o que mais ela quiser dizer de onde está), no lado esquerdo do fólio. */
export function NoFolio({ children }: { children: ReactNode }) {
  const no = useNo("folio-trilha");
  return no ? createPortal(children, no) : null;
}

/** O lado direito do fólio: o que a tela põe ali entra no lugar do estado, da data e da praça (o pager da fila, por exemplo). */
export function NoFolioDir({ children }: { children: ReactNode }) {
  const no = useNo("folio-dir");
  return no ? createPortal(children, no) : null;
}
