// Matéria viva e LAI (Fase 7). Na aba Depois, os alertas da matéria depois de apurada: fonte que mudou ou saiu do ar,
// pessoa citada em notícia nova, processo com movimento novo, prazo de LAI; cada um oferece atualizar o texto (a
// pessoa edita) ou gerar um post novo de Atualização ou Errata. No Dossiê, os pedidos de LAI: o pedido pronto para
// colar no portal do órgão, o protocolo, o prazo (20 dias + 10), a resposta no dossiê e o recurso.
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { corpoJson, ler } from "../api";
import { quando } from "../fila";
import { t } from "../idioma";
import { useParte } from "../kit/Partes";
import { mensagem, qtd, rota, type Afirmacao, type EstadoMesa, type Resumo } from "./comum";

type Alerta = EstadoMesa["alertas"][number];
type PedidoLai = EstadoMesa["lai"]["pedidos"][number];

const dataBr = (d: string) => d.split("-").reverse().join("/");
const hojeLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const cnj = (n: string) => n.length === 20 ? `${n.slice(0, 7)}-${n.slice(7, 9)}.${n.slice(9, 13)}.${n.slice(13, 14)}.${n.slice(14, 16)}.${n.slice(16)}` : n;

// ── aba Depois ──────────────────────────────────────────────────────────────────────────────────────────────────

const FAMILIAS: { id: string; tipos: string[]; titulo: () => string }[] = [
  { id: "fontes", tipos: ["fonte_mudou", "fonte_fora"], titulo: () => t("Fontes que mudaram", "Sources that changed") },
  { id: "pessoas", tipos: ["pessoa", "processo"], titulo: () => t("Pessoas e processos", "People and court cases") },
  { id: "lai", tipos: ["lai_vence", "lai_vencido"], titulo: () => t("Prazos de LAI", "FOI deadlines") },
];

export function AbaDepois({ tenantId, textoId, slug, estado, editor, atualizar }: {
  tenantId: string; textoId: string; slug: string; estado: EstadoMesa; editor: boolean; atualizar: (d: EstadoMesa) => void;
}) {
  const { alertas, processos } = estado;
  return (
    <div className="grid gap-8">
      {!alertas.length && (
        <p className="m-0 text-apoio">{t(
          "Nenhum alerta. O dossiê é relido todo dia; pessoas citadas no texto, processos e prazos de LAI também são acompanhados. O que mudar aparece aqui.",
          "No alerts. The dossier is reread every day; people named in the text, court cases and FOI deadlines are tracked too. Whatever changes shows up here.",
        )}</p>
      )}
      {FAMILIAS.map((f) => {
        const lista = alertas.filter((a) => f.tipos.includes(a.tipo));
        if (!lista.length) return null;
        return (
          <section key={f.id} aria-labelledby={`depois-${f.id}`} className="grid gap-3">
            <h2 id={`depois-${f.id}`} className="mono m-0 text-[12px] tracking-[.08em] text-apoio uppercase">{f.titulo()}</h2>
            <ul className="m-0 grid list-none gap-3 p-0">
              {lista.map((a) => <CartaoAlerta key={a.id} a={a} tenantId={tenantId} textoId={textoId} slug={slug} estado={estado} editor={editor} atualizar={atualizar} />)}
            </ul>
          </section>
        );
      })}
      <section aria-labelledby="depois-processos" className="grid gap-2">
        <h2 id="depois-processos" className="mono m-0 text-[12px] tracking-[.08em] text-apoio uppercase">{t("Processos citados no texto", "Court cases cited in the text")}</h2>
        {processos.lista.length ? (
          <ul className="m-0 grid list-none gap-1.5 p-0">
            {processos.lista.map((p) => (
              <li key={p.numero} className="grid gap-0.5">
                <span className="mono text-texto-forte">{cnj(p.numero)}{p.tribunal ? ` · ${p.tribunal.toUpperCase()}` : ""}</span>
                <span className="mono text-apoio">
                  {!processos.ligado ? t("acompanhamento desligado (falta a chave do DataJud)", "tracking off (the DataJud key is missing)")
                    : !p.tribunal ? t("tribunal não reconhecido pelo número", "court not recognized from the number")
                    : p.erro ? t(`a consulta falhou: ${p.erro}`, `the lookup failed: ${p.erro}`)
                    : p.ultimoMovimento ? t(`último movimento: ${p.ultimoMovimento} · ${dataBr(p.ultimoMovimentoEm!.slice(0, 10))}`, `last movement: ${p.ultimoMovimento} · ${dataBr(p.ultimoMovimentoEm!.slice(0, 10))}`)
                    : t("ainda não consultado (o acompanhamento roda uma vez por dia)", "not looked up yet (tracking runs once a day)")}
                </span>
              </li>
            ))}
          </ul>
        ) : <p className="m-0 text-apoio">{t("O texto não cita número de processo (no formato do CNJ, 0000000-00.0000.0.00.0000).", "The text doesn't cite a case number (in the CNJ format, 0000000-00.0000.0.00.0000).")}</p>}
      </section>
    </div>
  );
}

function tituloAlerta(a: Alerta): string {
  const d = a.detalhe as Record<string, string | number | null | undefined>;
  switch (a.tipo) {
    case "fonte_mudou": return t(`A página mudou: ${a.titulo}`, `The page changed: ${a.titulo}`);
    case "fonte_fora": return t(`A fonte não responde: ${a.titulo}`, `The source isn't responding: ${a.titulo}`);
    case "pessoa": return t(`${a.titulo} aparece em notícia nova`, `${a.titulo} shows up in a new story`);
    case "processo": return t(`Processo ${cnj(String(d.numero))}: movimento novo`, `Case ${cnj(String(d.numero))}: new movement`);
    case "lai_vence": return t(`O prazo do pedido de LAI a ${a.titulo} vence em ${dataBr(String(d.prazo))}`, `The FOI request to ${a.titulo} is due on ${dataBr(String(d.prazo))}`);
    default: return t(`O prazo do pedido de LAI a ${a.titulo} venceu em ${dataBr(String(d.prazo))}`, `The FOI request to ${a.titulo} was due on ${dataBr(String(d.prazo))}`);
  }
}

function CartaoAlerta({ a, tenantId, textoId, slug, estado, editor, atualizar }: {
  a: Alerta; tenantId: string; textoId: string; slug: string; estado: EstadoMesa; editor: boolean; atualizar: (d: EstadoMesa) => void;
}) {
  const param = { tenantId, id: textoId, alerta: a.id };
  const d = a.detalhe as Record<string, string | number | null | undefined>;
  const [post, setPost] = useState<"atualizacao" | "errata" | null>(null);
  const [nota, setNota] = useState("");
  const resolver = useMutation({
    mutationFn: (acao: "texto_atualizado" | "ignorado") => ler(rota.alertas[":alerta"].resolver.$post({ param }, corpoJson({ acao }))),
    onSuccess: atualizar,
  });
  const gerar = useMutation({
    mutationFn: () => ler(rota.alertas[":alerta"].post.$post({ param }, corpoJson({ tipo: post, nota }))),
    onSuccess: (r) => { atualizar(r.estado); setPost(null); setNota(""); },
  });
  const frases = a.tipo === "fonte_mudou" || a.tipo === "fonte_fora" ? estado.afirmacoes.filter((x: Afirmacao) => x.evidenciaId === d.evidenciaId) : [];
  const enviar = (e: FormEvent) => { e.preventDefault(); if (nota.trim().length >= 20) gerar.mutate(); };
  const fechado = a.estado !== "aberto";
  return (
    <li className={`grid gap-1.5 rounded-card px-4 py-3 shadow-curta ${fechado ? "bg-papel-2" : "bg-branco"}`}>
      <b className="text-[15px] text-texto-forte">{tituloAlerta(a)}</b>
      {a.tipo === "fonte_mudou" && <span className="faixa-aviso py-1 text-[14px]">{t(`A página mudou ${quando(String(d.em))}.`, `The page changed ${quando(String(d.em))}.`)}</span>}
      {a.tipo === "fonte_fora" && <span className="faixa-aviso py-1 text-[14px]">{t(`${d.falhas} tentativas seguidas sem resposta.`, `${d.falhas} attempts in a row with no response.`)}</span>}
      {(a.tipo === "fonte_mudou" || a.tipo === "fonte_fora") && <a href={String(d.url)} target="_blank" rel="noreferrer" className="link-acao justify-self-start text-[15px]">{a.titulo}</a>}
      {frases.length > 0 && <p className="m-0 text-[15px]">{t("Sustentava: ", "It supported: ")}{frases.map((x) => `“${x.trecho}”`).join(" · ")}</p>}
      {a.tipo === "pessoa" && <a href={String(d.url)} target="_blank" rel="noreferrer" className="link-acao justify-self-start text-[15px]">{String(d.titulo ?? d.url)}</a>}
      {a.tipo === "processo" && <span className="mono text-texto">{String(d.movimento)} · {dataBr(String(d.em).slice(0, 10))}{d.tribunal ? ` · ${String(d.tribunal).toUpperCase()}` : ""}</span>}
      {a.tipo === "lai_vencido" && d.recorrerAte && <span className="faixa-aviso py-1 text-[14px]">{t(`Sem resposta no prazo: dá para recorrer até ${dataBr(String(d.recorrerAte))} (art. 15 da Lei 12.527/2011).`, `No reply in time: you can appeal until ${dataBr(String(d.recorrerAte))} (art. 15 of Law 12,527/2011).`)}</span>}
      <span className="mono text-apoio">{t(`alerta de ${quando(a.criadoEm)}`, `alert from ${quando(a.criadoEm)}`)}</span>

      {fechado ? (
        <span className="mono text-texto">
          {a.acao === "ignorado" ? t(`ignorado por ${a.porNome ?? "—"} · ${quando(a.resolvidoEm!)}`, `ignored by ${a.porNome ?? "—"} · ${quando(a.resolvidoEm!)}`)
            : a.acao === "texto_atualizado" ? t(`texto atualizado, registrado por ${a.porNome ?? "—"} · ${quando(a.resolvidoEm!)}`, `text updated, recorded by ${a.porNome ?? "—"} · ${quando(a.resolvidoEm!)}`)
            : <>{a.acao === "post_errata" ? t("post de errata criado", "correction post created") : t("post de atualização criado", "update post created")}{t(` por ${a.porNome ?? "—"} · ${quando(a.resolvidoEm!)}`, ` by ${a.porNome ?? "—"} · ${quando(a.resolvidoEm!)}`)}{a.pecaId && <> · <Link to={`/t/${slug}/p/${a.pecaId}`} className="link-acao font-normal">{t("ver o post", "see the post")}</Link></>}</>}
        </span>
      ) : editor && (post ? (
        <form onSubmit={enviar} className="grid gap-2 rounded-card bg-papel-2 px-3 py-3">
          <label className="campo">
            <span>{post === "errata" ? t("O que foi corrigido", "What was corrected") : t("O que mudou", "What changed")}</span>
            <textarea className="entrada min-h-24 bg-branco" value={nota} maxLength={600} onChange={(e) => { setNota(e.target.value); gerar.reset(); }} />
          </label>
          <span className="ajuda">{t("Em uma ou duas frases, com as suas palavras: é o que o post diz. O post de antes não muda (o Instagram não troca a imagem); este sai novo, com o rótulo na manchete.", "In one or two sentences, in your own words: it's what the post says. The earlier post doesn't change (Instagram doesn't swap the image); this one is new, with the label in the headline.")}</span>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn-sec bg-branco" disabled={gerar.isPending || nota.trim().length < 20}>{gerar.isPending ? t("Criando…", "Creating…") : post === "errata" ? t("Criar o post de errata", "Create the correction post") : t("Criar o post de atualização", "Create the update post")}</button>
            <button type="button" className="btn-sec bg-branco" onClick={() => setPost(null)}>{t("Cancelar", "Cancel")}</button>
          </div>
          {gerar.isError && <p role="alert" className="faixa-erro m-0">{mensagem(gerar.error)}</p>}
        </form>
      ) : (
        <div className="flex flex-wrap gap-2 pt-1">
          <Link to="?" className="btn-sec bg-papel-2 no-underline">{t("Abrir o texto", "Open the text")}</Link>
          <button type="button" className="btn-sec bg-papel-2" onClick={() => resolver.mutate("texto_atualizado")} disabled={resolver.isPending}>{t("Atualizei o texto", "I updated the text")}</button>
          <button type="button" className="btn-sec bg-papel-2" onClick={() => setPost("atualizacao")}>{t("Post de atualização", "Update post")}</button>
          <button type="button" className="btn-sec bg-papel-2" onClick={() => setPost("errata")}>{t("Post de errata", "Correction post")}</button>
          <button type="button" className="link-acao border-0 bg-transparent p-0 text-[14px] font-normal" onClick={() => resolver.mutate("ignorado")} disabled={resolver.isPending}>{t("Ignorar", "Ignore")}</button>
        </div>
      ))}
      {resolver.isError && <p role="alert" className="faixa-erro m-0">{mensagem(resolver.error)}</p>}
    </li>
  );
}

// ── LAI (no Dossiê) ─────────────────────────────────────────────────────────────────────────────────────────────

const ROTULO_ESTADO_LAI: Record<PedidoLai["estado"], () => string> = {
  rascunho: () => t("pronto para protocolar", "ready to file"),
  protocolado: () => t("protocolado", "filed"),
  prorrogado: () => t("prorrogado", "extended"),
  vencido: () => t("prazo vencido sem resposta", "deadline passed with no reply"),
  respondido: () => t("respondido", "answered"),
  negado: () => t("respondido sem atender", "answered without meeting the request"),
  recurso: () => t("em recurso", "under appeal"),
};

/** O prazo mais urgente diz a linha: vencido, janela de recurso aberta, prazo perto. */
export function resumoLai(e: EstadoMesa): Resumo {
  const { pedidos, candidatas } = e.lai;
  const total = pedidos.length ? t(qtd(pedidos.length, "pedido", "pedidos"), qtd(pedidos.length, "request", "requests")) : t("nenhum pedido", "no requests");
  const passou = pedidos.filter((p) => p.estado === "vencido" || p.prazoRecursoPassou).length;
  if (passou) return { tom: "erro", texto: `${t(passou === 1 ? "1 com prazo vencido" : `${passou} com prazo vencido`, passou === 1 ? "1 past its deadline" : `${passou} past their deadline`)} · ${total}` };
  const recorrer = pedidos.find((p) => p.podeRecorrer && p.recorrerAte);
  if (recorrer) return { tom: "aviso", texto: `${t(`dá para recorrer até ${dataBr(recorrer.recorrerAte!)}`, `you can appeal until ${dataBr(recorrer.recorrerAte!)}`)} · ${total}` };
  // Negado no recurso: a etapa seguinte é fora do app, e o prazo corre (10 dias da ciência, fora quando a regra é local).
  const negado = pedidos.find((p) => p.proximaInstanciaFora);
  if (negado) return { tom: "aviso", texto: `${negado.regraLocal
    ? t("negado de novo · próxima instância fora do app", "denied again · next level outside the app")
    : t("negado · 10 dias da ciência para a próxima instância", "denied · 10 days from notice for the next level")} · ${total}` };
  const perto = pedidos.filter((p) => !p.respostaEm && p.diasRestantes !== null && p.diasRestantes <= 5).sort((a, b) => a.diasRestantes! - b.diasRestantes!)[0];
  if (perto) {
    const d = perto.diasRestantes!;
    return { tom: "aviso", texto: `${d <= 0 ? t("o prazo vence hoje", "the deadline is today") : d === 1 ? t("falta 1 dia para o prazo", "1 day to the deadline") : t(`faltam ${d} dias para o prazo`, `${d} days to the deadline`)} · ${total}` };
  }
  if (!pedidos.length && candidatas.length) return { texto: `${total} · ${t(candidatas.length === 1 ? "1 frase pode virar pedido" : `${candidatas.length} frases podem virar pedido`, candidatas.length === 1 ? "1 sentence can become a request" : `${candidatas.length} sentences can become requests`)}` };
  return { texto: total };
}

export function PedidosLai({ tenantId, textoId, estado, editor, atualizar }: {
  tenantId: string; textoId: string; estado: EstadoMesa; editor: boolean; atualizar: (d: EstadoMesa) => void;
}) {
  const { pedidos, candidatas, portal } = estado.lai;
  // O formulário só abre por pedido, e na URL (`?lai=0`), separado do `?pedir=` do outro lado: um não fecha o outro.
  const [pedir, abrirPedir] = useParte("lai", null);
  const n = pedir === null ? null : Number(pedir);
  const escolhida = n !== null && candidatas[n] ? n : null;
  return (
    <div className="grid gap-3">
      {pedidos.length ? (
        <ul className="m-0 grid list-none gap-3 p-0">
          {pedidos.map((p) => <CartaoLai key={p.id} p={p} tenantId={tenantId} textoId={textoId} portal={portal} editor={editor} atualizar={atualizar} />)}
        </ul>
      ) : <p className="m-0 text-apoio">{t("Nenhum pedido de acesso à informação. Frase sem fonte com dado de órgão público pode virar pedido pela Lei 12.527/2011.", "No access-to-information request. A sentence with no source and data from a public body can become a request under Brazil's Law 12,527/2011.")}</p>}
      {editor && candidatas.length > 0 && (escolhida === null ? (
        <div className="grid gap-1.5">
          <span className="text-[15px] font-bold text-texto-forte">{t("Frases sem fonte com dado de órgão público", "Sentences with no source and data from a public body")}</span>
          <ul className="m-0 grid list-none gap-1.5 p-0">
            {candidatas.map((c, i) => (
              <li key={`${c.blocoId}:${c.trecho}`} className="grid gap-1 border-t border-fio pt-2">
                <span className="text-[15px]">“{c.trecho}”</span>
                <button type="button" className="btn-sec justify-self-start bg-papel-2" onClick={() => abrirPedir(String(i))}>{t(`Pedir por LAI a ${c.orgao}`, `File an FOI request with ${c.orgao}`)}</button>
              </li>
            ))}
          </ul>
        </div>
      ) : <FormLai c={candidatas[escolhida]} tenantId={tenantId} textoId={textoId} pronto={(d) => { atualizar(d); abrirPedir(null); }} cancelar={() => abrirPedir(null)} />)}
    </div>
  );
}

function FormLai({ c, tenantId, textoId, pronto, cancelar }: {
  c: EstadoMesa["lai"]["candidatas"][number]; tenantId: string; textoId: string; pronto: (d: EstadoMesa) => void; cancelar: () => void;
}) {
  const [orgao, setOrgao] = useState(c.orgao);
  const [esfera, setEsfera] = useState<"federal" | "estadual" | "municipal">(/^Prefeitura|^Câmara Municipal|^Secretaria Municipal/.test(c.orgao) ? "municipal" : "estadual");
  const [pedido, setPedido] = useState(c.modelo);
  const criar = useMutation({
    mutationFn: () => ler(rota.lai.$post({ param: { tenantId, id: textoId } }, corpoJson({ blocoId: c.blocoId, trecho: c.trecho, orgao, esfera, pedido }))),
    onSuccess: pronto,
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); criar.mutate(); }} className="grid gap-3 rounded-card bg-papel-2 px-4 py-4">
      <p className="m-0 text-[15px]">“{c.trecho}”</p>
      <label className="campo"><span>{t("Órgão", "Agency")}</span><input className="entrada bg-branco" value={orgao} maxLength={200} onChange={(e) => setOrgao(e.target.value)} /></label>
      <label className="campo">
        <span>{t("Esfera", "Level")}</span>
        <select className="entrada bg-branco" value={esfera} onChange={(e) => setEsfera(e.target.value as typeof esfera)}>
          <option value="federal">{t("federal", "federal")}</option>
          <option value="estadual">{t("estadual", "state")}</option>
          <option value="municipal">{t("municipal", "municipal")}</option>
        </select>
      </label>
      <label className="campo">
        <span>{t("O pedido (em português, como vai para o órgão)", "The request (in Portuguese, as it goes to the agency)")}</span>
        <textarea className="entrada min-h-64 bg-branco" value={pedido} maxLength={8000} onChange={(e) => setPedido(e.target.value)} />
      </label>
      <span className="ajuda">{t("Complete depois de “Especificamente:” com o que você quer (período, valores, contratos). O app não entra no portal: você cola o pedido lá e registra o protocolo aqui.", "Complete after “Especificamente:” with what you want (period, amounts, contracts). The app doesn't log into the portal: you paste the request there and record the protocol here.")}</span>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-sec bg-branco" disabled={criar.isPending}>{t("Preparar o pedido", "Prepare the request")}</button>
        <button type="button" className="btn-sec bg-branco" onClick={cancelar}>{t("Cancelar", "Cancel")}</button>
      </div>
      {criar.isError && <p role="alert" className="faixa-erro m-0">{mensagem(criar.error)}</p>}
    </form>
  );
}

function CartaoLai({ p, tenantId, textoId, portal, editor, atualizar }: {
  p: PedidoLai; tenantId: string; textoId: string; portal: string; editor: boolean; atualizar: (d: EstadoMesa) => void;
}) {
  const param = { tenantId, id: textoId, pedido: p.id };
  const [passo, setPasso] = useState<"protocolo" | "prorrogacao" | "resposta" | "recurso" | null>(null);
  const [protocolo, setProtocolo] = useState("");
  const [data, setData] = useState(hojeLocal());
  const [texto, setTexto] = useState("");
  const [atendeu, setAtendeu] = useState<"sim" | "nao">("sim");
  const [copiado, setCopiado] = useState<string | null>(null);
  const andar = useMutation({
    mutationFn: () => {
      const corpo = passo === "protocolo" ? { protocolo, protocoladoEm: data } : passo === "prorrogacao" ? { em: data }
        : passo === "resposta" ? { texto, recebidaEm: data, atendeu: atendeu === "sim" } : { texto, em: data };
      return ler(rota.lai[":pedido"][":acao"].$post({ param: { ...param, acao: passo! } }, corpoJson(corpo)));
    },
    onSuccess: (d) => { atualizar(d); setPasso(null); setTexto(""); setProtocolo(""); },
  });
  const copiar = async (qual: string, s: string) => { await navigator.clipboard.writeText(s).then(() => setCopiado(qual), () => setCopiado(null)); };
  const abrir = (q: typeof passo) => { setPasso(q); setData(hojeLocal()); setTexto(q === "recurso" ? p.modeloRecurso ?? "" : ""); andar.reset(); };
  const aviso = p.estado === "vencido" || p.estado === "negado";
  const reclamacao = p.tipoRecurso === "reclamacao";
  // Em recurso, a resposta que chega é a do recurso (ou da reclamação).
  const respostaDoRecurso = p.estado === "recurso";
  return (
    <li className="grid gap-1.5 rounded-card bg-branco px-4 py-3 shadow-curta">
      <b className="text-[15px] text-texto-forte">{p.orgao} <span className="mono font-normal text-apoio">· {p.esfera === "federal" ? t("federal", "federal") : p.esfera === "estadual" ? t("estadual", "state") : t("municipal", "municipal")}</span></b>
      <span className="text-[15px] text-apoio">“{p.trecho}”</span>
      <span className={`mono ${aviso ? "text-terracota" : p.estado === "respondido" ? "text-verde" : "text-texto"}`}>
        {ROTULO_ESTADO_LAI[p.estado]()}
        {p.protocolo ? t(` · protocolo ${p.protocolo}`, ` · protocol ${p.protocolo}`) : ""}
        {p.protocoladoEm ? t(` · em ${dataBr(p.protocoladoEm)}`, ` · on ${dataBr(p.protocoladoEm)}`) : ""}
      </span>
      {p.prazoFinal && !p.respostaEm && (
        <span className="mono text-texto">
          {t(`prazo: ${dataBr(p.prazoFinal)}`, `due: ${dataBr(p.prazoFinal)}`)}
          {p.prorrogadoEm ? t(" (20 dias + 10 de prorrogação)", " (20 days + 10 extension)") : t(" (20 dias; o órgão pode prorrogar por mais 10)", " (20 days; the agency may extend by 10 more)")}
          {p.diasRestantes !== null && p.diasRestantes >= 0 ? t(` · faltam ${p.diasRestantes} dias`, ` · ${p.diasRestantes} days left`) : ""}
        </span>
      )}
      {p.respostaEm && <span className="mono text-texto">{t(`resposta em ${dataBr(p.respostaEm)}: está no dossiê`, `reply on ${dataBr(p.respostaEm)}: it's in the dossier`)}</span>}
      {p.recorrerAte && !p.recursoEm && (p.prazoRecursoPassou
        ? <span className="faixa-erro py-1 text-[14px]">{t(`O prazo para ${reclamacao ? "reclamar" : "recorrer"} terminou em ${dataBr(p.recorrerAte)}. Se você protocolou a tempo, registre com a data do protocolo.`, `The deadline to ${reclamacao ? "complain" : "appeal"} ended on ${dataBr(p.recorrerAte)}. If you filed in time, record it with the filing date.`)}</span>
        : p.podeRecorrer
        ? <span className="faixa-aviso py-1 text-[14px]">{reclamacao
          ? t(`Dá para reclamar até ${dataBr(p.recorrerAte)} à autoridade de monitoramento da LAI do órgão (Decreto nº 7.724/2012, art. 22).`, `You can file a complaint until ${dataBr(p.recorrerAte)} with the agency's access-to-information monitoring authority (Decree 7,724/2012, art. 22).`)
          : t(`Dá para recorrer até ${dataBr(p.recorrerAte)} à autoridade acima de quem respondeu (art. 15).`, `You can appeal until ${dataBr(p.recorrerAte)} to the authority above whoever answered (art. 15).`)}</span>
        : p.recorrerDe && <span className="faixa-aviso py-1 text-[14px]">{t(`Sem resposta no Executivo federal, a reclamação abre em ${dataBr(p.recorrerDe)} (30 dias do pedido) e vai até ${dataBr(p.recorrerAte)}.`, `With no reply from the federal Executive, the complaint opens on ${dataBr(p.recorrerDe)} (30 days after the request) and runs until ${dataBr(p.recorrerAte)}.`)}</span>)}
      {p.regraLocal && p.protocoladoEm && !p.respostaEm && <span className="mono text-apoio">{t("estado e município têm regulamento próprio da LAI: confira o prazo e a quem recorrer", "states and municipalities have their own access-to-information rules: check the deadline and whom to appeal to")}</span>}
      {!p.regraLocal && p.protocoladoEm && !p.respostaEm && <span className="mono text-apoio">{t("o prazo conta Carnaval e Corpus Christi; ponto facultativo decretado no ano não entra: confira", "the deadline skips Carnival and Corpus Christi; one-off holidays decreed each year aren't counted: check")}</span>}
      {p.recursoEm && <span className="mono text-texto">{p.recursoTipo === "reclamacao" ? t(`reclamação protocolada em ${dataBr(p.recursoEm)}`, `complaint filed on ${dataBr(p.recursoEm)}`) : t(`recurso protocolado em ${dataBr(p.recursoEm)}`, `appeal filed on ${dataBr(p.recursoEm)}`)}</span>}
      {p.proximaInstanciaFora && <span className="faixa-aviso py-1 text-[14px]">{p.regraLocal
        ? t("Negado de novo: a instância seguinte segue o regulamento do estado ou do município, fora do app.", "Denied again: the next level follows the state or city rules, outside the app.")
        : p.recursoTipo === "reclamacao"
          ? t("A reclamação não resolveu: dá para recorrer à CGU em 10 dias da ciência (Decreto 7.724/2012, art. 23), pelo Fala.BR. O app não acompanha essa etapa.", "The complaint didn't resolve it: you can appeal to the CGU within 10 days of notice (Decree 7,724/2012, art. 23), through Fala.BR. The app doesn't track this step.")
          : t("Recurso negado: dá para recorrer à autoridade máxima do órgão em 10 dias da ciência (Decreto 7.724/2012, art. 21, parágrafo único) e, se negar de novo, à CGU (art. 23). O app não acompanha essas etapas.", "Appeal denied: you can appeal to the agency's highest authority within 10 days of notice (Decree 7,724/2012, art. 21, sole paragraph) and, if denied again, to the CGU (art. 23). The app doesn't track these steps.")}</span>}
      {p.recursoRespostaEm && <span className="mono text-texto">{t(`resposta ${p.recursoTipo === "reclamacao" ? "à reclamação" : "ao recurso"} em ${dataBr(p.recursoRespostaEm)}: está no dossiê`, `reply to the ${p.recursoTipo === "reclamacao" ? "complaint" : "appeal"} on ${dataBr(p.recursoRespostaEm)}: it's in the dossier`)}</span>}

      {p.estado === "rascunho" && (
        <details className="text-[15px]">
          <summary className="link-acao w-fit cursor-pointer font-normal">{t("Ver o pedido", "See the request")}</summary>
          <pre className="mt-2 whitespace-pre-wrap rounded-card bg-papel-2 px-3 py-2 font-[inherit] text-[15px]">{p.pedido}</pre>
        </details>
      )}
      {editor && !passo && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {p.estado === "rascunho" && <>
            <button type="button" className="btn-sec bg-papel-2" onClick={() => void copiar("pedido", p.pedido)}>{copiado === "pedido" ? t("Pedido copiado", "Request copied") : t("Copiar o pedido", "Copy the request")}</button>
            {p.esfera === "federal" && <a href={portal} target="_blank" rel="noreferrer" className="link-acao text-[14px] font-normal">{t("abrir o Fala.BR", "open Fala.BR")}</a>}
            <button type="button" className="btn-sec bg-papel-2" onClick={() => abrir("protocolo")}>{t("Registrar o protocolo", "Record the protocol")}</button>
          </>}
          {(p.estado === "protocolado" || p.estado === "vencido") && !p.prorrogadoEm && <button type="button" className="btn-sec bg-papel-2" onClick={() => abrir("prorrogacao")}>{t("O órgão prorrogou", "The agency extended it")}</button>}
          {(p.estado === "protocolado" || p.estado === "prorrogado" || p.estado === "vencido") && <button type="button" className="btn-sec bg-papel-2" onClick={() => abrir("resposta")}>{t("Registrar a resposta", "Record the reply")}</button>}
          {respostaDoRecurso && <button type="button" className="btn-sec bg-papel-2" onClick={() => abrir("resposta")}>{p.recursoTipo === "reclamacao" ? t("Registrar a resposta à reclamação", "Record the reply to the complaint") : t("Registrar a resposta ao recurso", "Record the reply to the appeal")}</button>}
          {p.podeRecorrer && <button type="button" className="btn-sec bg-papel-2" onClick={() => abrir("recurso")}>{reclamacao ? t("Preparar a reclamação", "Prepare the complaint") : t("Preparar o recurso", "Prepare the appeal")}</button>}
        </div>
      )}
      {editor && passo && (
        <form onSubmit={(e) => { e.preventDefault(); andar.mutate(); }} className="grid gap-2 rounded-card bg-papel-2 px-3 py-3">
          {passo === "protocolo" && <label className="campo"><span>{t("Número do protocolo", "Protocol number")}</span><input className="entrada bg-branco" value={protocolo} maxLength={80} onChange={(e) => setProtocolo(e.target.value)} /></label>}
          {(passo === "resposta" || passo === "recurso") && (
            <label className="campo">
              <span>{passo === "resposta" ? t("A resposta do órgão, como chegou", "The agency's reply, as it arrived") : reclamacao ? t("A reclamação (em português, como vai para o órgão)", "The complaint (in Portuguese, as it goes to the agency)") : t("O recurso (em português, como vai para o órgão)", "The appeal (in Portuguese, as it goes to the agency)")}</span>
              <textarea className="entrada min-h-40 bg-branco" value={texto} maxLength={passo === "resposta" ? 20000 : 8000} onChange={(e) => setTexto(e.target.value)} />
            </label>
          )}
          {passo === "resposta" && (
            <fieldset className="m-0 flex flex-wrap gap-x-4 gap-y-1 border-0 p-0">
              <legend className="mb-1 text-[15px] font-bold text-texto-forte">{t("A resposta atendeu o pedido?", "Did the reply meet the request?")}</legend>
              <label className="inline-flex min-h-11 items-center gap-2"><input type="radio" name={`atendeu-${p.id}`} checked={atendeu === "sim"} onChange={() => setAtendeu("sim")} />{t("Sim", "Yes")}</label>
              <label className="inline-flex min-h-11 items-center gap-2"><input type="radio" name={`atendeu-${p.id}`} checked={atendeu === "nao"} onChange={() => setAtendeu("nao")} />{t("Não (abre o recurso)", "No (opens the appeal)")}</label>
            </fieldset>
          )}
          <label className="campo">
            <span>{passo === "protocolo" ? t("Data do protocolo", "Filing date") : passo === "prorrogacao" ? t("Data em que o órgão prorrogou", "Date the agency extended it") : passo === "resposta" ? t("Data da resposta", "Reply date") : t("Data em que você protocolou o recurso", "Date you filed the appeal")}</span>
            <input type="date" className="entrada bg-branco" value={data} max={hojeLocal()} onChange={(e) => setData(e.target.value)} />
          </label>
          {passo === "recurso" && <button type="button" className="btn-sec justify-self-start bg-branco" onClick={() => void copiar("recurso", texto)}>{copiado === "recurso" ? t("Texto copiado", "Text copied") : reclamacao ? t("Copiar a reclamação", "Copy the complaint") : t("Copiar o recurso", "Copy the appeal")}</button>}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn-sec bg-branco" disabled={andar.isPending}>{passo === "recurso" ? (reclamacao ? t("Registrar a reclamação", "Record the complaint") : t("Registrar o recurso", "Record the appeal")) : t("Registrar", "Record")}</button>
            <button type="button" className="btn-sec bg-branco" onClick={() => setPasso(null)}>{t("Cancelar", "Cancel")}</button>
          </div>
          {andar.isError && <p role="alert" className="faixa-erro m-0">{mensagem(andar.error)}</p>}
        </form>
      )}
    </li>
  );
}
