// Aba "Se a conta cair", usada em crise: a ordem segue o caso. Sem caso aberto, como registrar e o resumo do resto; com
// caso aberto, o prazo e o próximo passo no alto, sempre à vista. Modelos, certidões, reserva e raio-X abrem sob demanda.
import { useState } from "react";
import { useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { corpoJson, ler } from "../../api";
import { FalhaCarga } from "../../comum";
import { Parte, Partes, useParte, type ItemParte } from "../../kit/Partes";
import { quando } from "../../fila";
import { idioma, t as tr } from "../../idioma";
import type { Veiculo as Veic } from "../../sessao";
import { NOTA_CASO_MAX, TIPOS_CASO, diasAte, modelosKit, roteiroKit, type ModeloKit, type TipoCaso } from "../../../../src/lib/kit";
import { Carga, mensagemAcao, t } from "./comum";
import { RaioX, useRaioX } from "./RaioX";

const NOME_CASO = (x: TipoCaso) => ({
  desativada: tr("Conta desativada ou restringida", "Account disabled or restricted"),
  direito_autoral: tr("Denúncia de direito autoral", "Copyright report"),
  cobranca: tr("Cobrança por foto ou texto", "Charge for a photo or text"),
  outro: tr("Outro", "Other"),
})[x];

const hojeLocal = () => new Date().toLocaleDateString("en-CA");
const dataCurta = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(idioma(), { day: "2-digit", month: "short", year: "numeric" });

function contagem(prazo: string | null) {
  if (!prazo) return tr("sem prazo no aviso", "no deadline in the notice");
  const d = diasAte(prazo, hojeLocal());
  if (d < 0) return tr(`o prazo passou há ${-d} ${-d === 1 ? "dia" : "dias"}`, `the deadline passed ${-d} ${-d === 1 ? "day" : "days"} ago`);
  if (d === 0) return tr("o prazo termina hoje", "the deadline is today");
  return tr(`${d === 1 ? "falta 1 dia" : `faltam ${d} dias`} para o prazo`, `${d === 1 ? "1 day" : `${d} days`} left until the deadline`);
}

/** O próximo passo do caso: o que resolve primeiro, com o caminho até o texto pronto. */
const proximoPasso = (tipo: TipoCaso): { texto: string; acao: string; parte: string; modelo?: string } => (tipo === "cobranca"
  ? { texto: tr("Peça a prova de quem cobra: de quem é o direito, qual é o post e de onde vem o valor.", "Ask whoever is charging for proof: who owns the rights, which post it is and where the amount comes from."), acao: tr("Abrir o pedido", "Open the request"), parte: "modelos", modelo: "titularidade" }
  : tipo === "outro"
    ? { texto: tr("Guarde o aviso com a data e junte as certidões do mês.", "Save the notice with its date and gather this month's certificates."), acao: tr("Abrir as certidões", "Open the certificates"), parte: "certidoes" }
    : { texto: tr("Peça a revisão pelo link do próprio aviso. O texto está pronto para copiar.", "Ask for a review through the link in the notice. The text is ready to copy."), acao: tr("Abrir o pedido", "Open the request"), parte: "modelos", modelo: "revisao" });

/** Fechado, só o nome e o Copiar. Se o navegador não deixa copiar, o texto abre para a pessoa selecionar. */
function Modelo({ m, aberto, alternar }: { m: ModeloKit; aberto: boolean; alternar: () => void }) {
  const [copiado, setCopiado] = useState<boolean | null>(null);
  const copiar = () => navigator.clipboard.writeText(m.texto).then(() => setCopiado(true), () => { setCopiado(false); if (!aberto) alternar(); });
  return (
    <li>
      <Parte id={`kit-${m.id}`} rotulo={m.titulo} resumo={null} aberta={aberto} alternar={alternar}
        acao={<button type="button" className="btn-sec flex-none bg-papel-2" onClick={() => void copiar()}>{tr("Copiar", "Copy")}<span className="sr-only"> {m.titulo}</span></button>}>
        <textarea readOnly aria-label={m.titulo} className="entrada min-h-[160px] resize-y py-2 text-[15px]" value={m.texto} />
      </Parte>
      <p role="status" className={copiado === null ? "sr-only" : "ajuda m-0 pb-3"}>{copiado === true ? tr("Copiado.", "Copied.") : copiado === false ? tr("O navegador não deixou copiar: selecione o texto.", "The browser didn't allow copying: select the text.") : ""}</p>
    </li>
  );
}

const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios);

export default function Kit({ veiculo, admin }: { veiculo: Veic; admin: boolean }) {
  const qc = useQueryClient();
  const chave = [veiculo.id, "kit"] as const;
  const dados = useQuery({ queryKey: chave, queryFn: () => ler(t.kit.$get({ param: { tenantId: veiculo.id } })) });
  const recarregar = () => qc.invalidateQueries({ queryKey: chave });
  const [tipo, setTipo] = useState<TipoCaso>("desativada");
  const [abertoEm, setAbertoEm] = useState(hojeLocal());
  const [prazoEm, setPrazoEm] = useState("");
  const [nota, setNota] = useState("");
  const abrir = useMutation({
    mutationFn: () => ler(t.kit.casos.$post({ param: { tenantId: veiculo.id } }, corpoJson({ tipo, abertoEm, prazoEm: prazoEm || null, nota: nota.trim() || null }))),
    onSuccess: () => { setPrazoEm(""); setNota(""); recarregar(); },
  });
  const encerrar = useMutation({
    mutationFn: (id: string) => ler(t.kit.casos[":id"].$delete({ param: { tenantId: veiculo.id, id } })),
    onSuccess: recarregar,
  });
  const pagina = useMutation({
    mutationFn: (ligada: boolean) => ler(t["pagina-publica"].$patch({ param: { tenantId: veiculo.id } }, corpoJson({ ligada }))),
    onSuccess: recarregar,
  });
  const reporter = veiculo.papel === "reporter";
  const raiox = useRaioX(veiculo.id, !reporter);
  const [erroRaioX, setErroRaioX] = useState<string | null>(null);
  const [textoAberto, abrirTexto] = useParte("texto", null);
  const [, setParams] = useSearchParams();
  const irPara = (parte: string, modelo?: string) => setParams((p) => { p.set("parte", parte); if (modelo) p.set("texto", modelo); return p; }, { replace: true, preventScrollReset: true });
  const ling = idioma();
  // O raio-X entra na conta do que abre sozinho: espera a primeira resposta dele. Só a primeira: depois de uma falha, o
  // painel tenta de novo ao montar, a consulta volta a "pending", e esperar de novo desmontava o painel, num laço sem fim.
  const raioXFalhou = raiox.errorUpdatedAt > 0 && !raiox.data;
  if (dados.isPending || (!reporter && raiox.isPending && !raioXFalhou)) return <Carga oque={tr("o kit", "the kit")} />;
  if (dados.isError) return <FalhaCarga oque={tr("o kit", "the kit")} tentar={() => dados.refetch()} />;
  const { casos, certidoes, paginaPublica } = dados.data;
  // O prazo mais curto primeiro; caso sem prazo no aviso vem depois.
  const emOrdem = [...casos].sort((a, b) => (a.prazo_em ?? "9999").localeCompare(b.prazo_em ?? "9999"));
  const passos = roteiroKit(ling);
  const modelos = modelosKit(ling);
  const falhas = certidoes.filter((c) => c.erro).length;
  const lote = raiox.data?.lote;

  const itemCaso: ItemParte | null = reporter ? null : {
    id: "caso",
    rotulo: casos.length ? tr("Registrar outro caso", "Register another case") : tr("Registrar o caso", "Register the case"),
    resumo: casos.length ? tr(`${casos.length} ${plural(casos.length, "aberto", "abertos")}`, `${casos.length} open`) : tr("nenhum caso aberto", "no open case"),
    conteudo: (
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); abrir.mutate(); }}>
        <label className="campo">
          <span>{tr("O que aconteceu", "What happened")}</span>
          <select className="entrada" value={tipo} onChange={(e) => setTipo(e.target.value as TipoCaso)}>
            {TIPOS_CASO.map((x) => <option key={x} value={x}>{NOME_CASO(x)}</option>)}
          </select>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="campo">
            <span>{tr("Quando a conta caiu", "When the account went down")}</span>
            <input type="date" required className="entrada" value={abertoEm} max={hojeLocal()} onChange={(e) => setAbertoEm(e.target.value)} />
          </label>
          <label className="campo">
            <span>{tr("Prazo do aviso", "Deadline in the notice")}</span>
            <input type="date" className="entrada" value={prazoEm} onChange={(e) => setPrazoEm(e.target.value)} aria-describedby="kit-prazo-ajuda" />
          </label>
        </div>
        <p id="kit-prazo-ajuda" className="ajuda m-0">{tr("Copie a data do aviso que você recebeu. O prazo muda de caso para caso, e o app não adivinha.", "Copy the date from the notice you received. The deadline changes from case to case, and the app doesn't guess.")}</p>
        <label className="campo">
          <span>{tr("Nota", "Note")}</span>
          <input className="entrada" maxLength={NOTA_CASO_MAX} value={nota} onChange={(e) => setNota(e.target.value)} />
        </label>
        {abrir.isError && <p role="alert" className="faixa-erro m-0">{mensagemAcao(abrir.error, tr("registrar o caso", "register the case"))}</p>}
        <button type="submit" className="btn-sec justify-self-start bg-papel-2" disabled={abrir.isPending}>{abrir.isPending ? tr("Registrando…", "Registering…") : tr("Registrar o caso", "Register the case")}</button>
      </form>
    ),
  };
  const itemAgora: ItemParte = {
    id: "agora", rotulo: tr("O que fazer agora", "What to do now"), resumo: tr(`${passos.length} passos`, `${passos.length} steps`),
    conteudo: (
      <ol className="m-0 grid list-decimal gap-3 pl-5">
        {passos.map((p) => <li key={p.titulo}><b className="text-texto-forte">{p.titulo}.</b> <span className="text-apoio">{p.texto}</span></li>)}
      </ol>
    ),
  };
  const itemModelos: ItemParte = {
    id: "modelos", rotulo: tr("Modelos para copiar", "Templates to copy"), resumo: tr(`${modelos.length} modelos`, `${modelos.length} templates`),
    conteudo: <ul className="m-0 grid list-none divide-y divide-fio p-0">{modelos.map((m) => <Modelo key={m.id} m={m} aberto={textoAberto === m.id} alternar={() => abrirTexto(textoAberto === m.id ? null : m.id)} />)}</ul>,
  };
  const itemCertidoes: ItemParte = {
    id: "certidoes", rotulo: tr("Certidões do mês", "This month's certificates"),
    resumo: falhas ? tr(`${falhas} ${plural(falhas, "falhou", "falharam")}: gere de novo em Postados`, `${falhas} failed: generate again in Posted`)
      : certidoes.length ? tr(`${certidoes.length} neste mês`, `${certidoes.length} this month`) : tr("nenhuma neste mês", "none this month"),
    tom: falhas ? "erro" : undefined,
    conteudo: (
      <>
        {certidoes.length ? (
          <ul className="m-0 grid list-none gap-2 p-0">
            {certidoes.map((c) => (
              <li key={c.peca_id} className="flex flex-wrap items-center justify-between gap-3 border-t border-fio py-2">
                <span className="grid min-w-0 gap-0.5">
                  <span className="text-texto-forte">{c.manchete ?? c.peca_id}</span>
                  <span className="mono text-apoio">{c.erro ? tr("falhou: gere de novo em Postados", "failed: generate it again in Posted") : c.carimbo_em ? quando(c.carimbo_em) : ""}</span>
                </span>
                {!c.erro && !reporter && <a className="btn-sec no-underline" href={`/api/t/${veiculo.id}/pecas/${c.peca_id}/certidao`} download>{tr("Baixar", "Download")}<span className="sr-only"> {c.manchete}</span></a>}
              </li>
            ))}
          </ul>
        ) : <p className="m-0 text-apoio">{tr("Nenhuma certidão neste mês. Cada post publicado ganha uma, sozinho.", "No certificates this month. Each published post gets one on its own.")}</p>}
        {!reporter && <a className="btn-sec justify-self-start no-underline" href={`/api/t/${veiculo.id}/kit/mes`} download>{tr("Baixar o mês", "Download the month")}</a>}
      </>
    ),
  };
  const itemReserva: ItemParte = {
    id: "reserva", rotulo: tr("Reserva", "Reserve"),
    resumo: paginaPublica.ligada ? tr("página pública ligada", "public page on") : tr("página pública desligada", "public page off"),
    conteudo: (
      <>
        <p className="m-0 max-w-[60ch] text-apoio">{tr("Canal de WhatsApp: em Prontos para postar, cada post tem \"Mandar para o Canal\".", "WhatsApp Channel: in Ready to post, each post has \"Send to the Channel\".")}</p>
        <label className={`flex min-h-11 items-center gap-2 ${admin ? "cursor-pointer" : ""}`}>
          <input type="checkbox" checked={paginaPublica.ligada} disabled={!admin || pagina.isPending} onChange={(e) => pagina.mutate(e.target.checked)} className="size-[18px] accent-texto-forte" />
          <span className="grid"><b className="text-texto-forte">{tr("Página pública do veículo", "Public outlet page")}</b><span className="ajuda">{tr("Mostra os últimos posts publicados, sem login.", "Shows the latest published posts, with no login.")}</span></span>
        </label>
        {paginaPublica.ligada && <a className="mono break-all text-apoio" href={paginaPublica.url} target="_blank" rel="noopener noreferrer">{paginaPublica.url}<span className="sr-only">{tr(" (abre em outra aba)", " (opens in a new tab)")}</span></a>}
        {pagina.isError && <p role="alert" className="faixa-erro m-0">{mensagemAcao(pagina.error, tr("mudar a página", "change the page"))}</p>}
      </>
    ),
  };
  const itemRaioX: ItemParte | null = reporter ? null : {
    id: "raiox", rotulo: tr("Raio-X dos posts antigos", "Review of old posts"),
    resumo: erroRaioX ?? (raioXFalhou ? tr("não carregou", "didn't load") : lote
      ? tr(`${lote.total} posts · ${lote.marcados} com marca`, `${lote.total} posts · ${lote.marcados} flagged`)
      : tr("ainda não feito", "not done yet")),
    tom: erroRaioX || raioXFalhou ? "erro" : lote?.marcados ? "aviso" : undefined,
    conteudo: <RaioX tenantId={veiculo.id} avisar={setErroRaioX} />,
  };
  // A ordem segue o caso: sem caso, registrar vem primeiro; com caso aberto, o que ajuda a resolver. Alerta passa à frente e abre sozinho.
  const itens = (casos.length ? [itemModelos, itemCertidoes, itemAgora, itemReserva, itemRaioX, itemCaso] : [itemCaso, itemAgora, itemModelos, itemCertidoes, itemReserva, itemRaioX])
    .filter((i): i is ItemParte => i !== null)
    .sort((a, b) => Number(!a.tom) - Number(!b.tom));
  return (
    <div className="grid gap-6">
      {emOrdem.length > 0 && (
        <section aria-labelledby="kit-caso" className="grid max-w-[760px] gap-3">
          <h2 id="kit-caso" className="m-0 text-[22px]">{tr("Caso aberto", "Open case")}</h2>
          <ul aria-label={tr("Casos abertos", "Open cases")} className="m-0 grid list-none gap-2 p-0">
            {emOrdem.map((c) => {
              const passo = proximoPasso(c.tipo as TipoCaso);
              const passou = !!c.prazo_em && diasAte(c.prazo_em, hojeLocal()) < 0;
              return (
                <li key={c.id} className="grid gap-2 rounded-btn bg-papel p-3 shadow-curta">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <span className="grid min-w-0 gap-0.5">
                      <b className={`text-[18px] first-letter:uppercase ${passou ? "text-terracota" : "text-texto-forte"}`}>{contagem(c.prazo_em)}</b>
                      <span className="text-texto-forte">{NOME_CASO(c.tipo as TipoCaso)}</span>
                      <span className="mono text-apoio">{tr(`caiu em ${dataCurta(c.aberto_em)}`, `went down on ${dataCurta(c.aberto_em)}`)}</span>
                      {c.nota && <span className="text-apoio">{c.nota}</span>}
                    </span>
                    {!reporter && <button type="button" className="btn-sec" disabled={encerrar.isPending} onClick={() => encerrar.mutate(c.id)}>{tr("Encerrar", "Close")}<span className="sr-only"> {NOME_CASO(c.tipo as TipoCaso)}</span></button>}
                  </div>
                  <p className="m-0 border-t border-fio pt-2"><b className="text-texto-forte">{tr("Próximo passo: ", "Next step: ")}</b>{passo.texto}{" "}
                    <button type="button" className="link-acao border-0 bg-transparent p-0 font-[inherit]" onClick={() => irPara(passo.parte, passo.modelo)}>{passo.acao}</button>
                  </p>
                </li>
              );
            })}
          </ul>
          {encerrar.isError && <p role="alert" className="faixa-erro m-0">{mensagemAcao(encerrar.error, tr("encerrar o caso", "close the case"))}</p>}
        </section>
      )}
      <Partes itens={itens} padrao={itens[0]?.id ?? null} rotulo={tr("Partes do kit", "Parts of the kit")} />
    </div>
  );
}
