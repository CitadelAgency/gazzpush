// Escudo jurídico da Matéria (Fase 4): o pedido de outro lado (por e-mail pelo app ou copiado e mandado por fora, com
// a hora registrada e o prazo), a resposta que entra no dossiê, o pacote de defesa (zip com carimbo de tempo) e a
// página de fontes pública. O texto do pedido é um modelo fixo que a pessoa edita: nada aqui é escrito por IA.
import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { cabecalhoIdioma, corpoJson, ErroApi, ler } from "../api";
import { useCasca } from "../casca/contexto";
import { quando, quandoFuturo } from "../fila";
import { t } from "../idioma";
import { MEIOS, RISCOS_OUTRO_LADO, rotuloMeio } from "./Assistente";
import { useParte } from "../kit/Partes";
import { mensagem, qtd, rota, type EstadoMesa, type Resumo } from "./comum";

type Pedido = EstadoMesa["outroLado"]["pedidos"][number];

/** "2026-11-05T18:00" no fuso do aparelho (o valor do <input type="datetime-local">). */
const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const iso = (v: string) => new Date(v).toISOString();

/** O pedido no idioma do veículo (o conteúdo sai no idioma de quem publica). */
function modeloPedido(o: { en: boolean; quem: string; nome: string; veiculo: string; titulo: string; trecho: string | null; prazo: string }) {
  const prazo = new Date(o.prazo).toLocaleString(o.en ? "en-US" : "pt-BR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  if (o.en) {
    return `Hello${o.quem ? `, ${o.quem}` : ""}.\n\nI'm ${o.nome}, from ${o.veiculo}. I'm working on a story titled "${o.titulo}".${o.trecho ? ` It states:\n\n"${o.trecho}"` : ""}\n\nI'd like to hear your side. Could you reply by ${prazo}? You can simply answer this e-mail.\n\nThank you,\n${o.nome}`;
  }
  return `Olá${o.quem ? `, ${o.quem}` : ""}.\n\nSou ${o.nome}, do ${o.veiculo}. Estou fazendo uma reportagem com o título "${o.titulo}".${o.trecho ? ` O texto afirma:\n\n"${o.trecho}"` : ""}\n\nGostaria de ouvir o seu lado. Pode responder até ${prazo}? Pode responder a este e-mail mesmo.\n\nObrigado,\n${o.nome}`;
}

export const PEDIR_OUTRO_LADO = "outro-lado";

/** O que está sem resposta diz a linha; frase de risco sem pedido é alerta, mesmo com a lista vazia. */
export function resumoOutroLado(e: EstadoMesa): Resumo {
  const { pedidos } = e.outroLado;
  const total = pedidos.length ? t(qtd(pedidos.length, "pedido", "pedidos"), qtd(pedidos.length, "request", "requests")) : t("nenhum pedido", "no requests");
  const naoSaiu = pedidos.filter((p) => p.erro && !p.respostaEm).length;
  if (naoSaiu) return { tom: "erro", texto: `${t(naoSaiu === 1 ? "1 e-mail não saiu" : `${naoSaiu} e-mails não saíram`, naoSaiu === 1 ? "1 e-mail didn't go out" : `${naoSaiu} e-mails didn't go out`)} · ${total}` };
  const vencidos = pedidos.filter((p) => p.vencido && !p.respostaEm).length;
  if (vencidos) return { tom: "aviso", texto: `${t(vencidos === 1 ? "1 sem resposta no prazo" : `${vencidos} sem resposta no prazo`, `${vencidos} with no reply in time`)} · ${total}` };
  const riscos = pedidos.length ? 0 : e.afirmacoes.filter((a) => a.estado === "risco" && RISCOS_OUTRO_LADO.includes(a.risco ?? "")).length;
  if (riscos) return { tom: "aviso", texto: `${t(riscos === 1 ? "1 frase de risco sem outro lado" : `${riscos} frases de risco sem outro lado`, riscos === 1 ? "1 risky sentence with no other side" : `${riscos} risky sentences with no other side`)}` };
  const esperando = pedidos.filter((p) => !p.respostaEm).sort((a, b) => a.prazo.localeCompare(b.prazo))[0];
  return { texto: esperando ? `${t(`esperando resposta até ${quandoFuturo(esperando.prazo)}`, `waiting for a reply until ${quandoFuturo(esperando.prazo)}`)} · ${total}` : total };
}

/** Outro lado: os pedidos (para quem, quando saiu, prazo, resposta) e o formulário de pedir, que só abre por pedido. */
export function OutroLado({ tenantId, textoId, estado, editor, atualizar }: {
  tenantId: string; textoId: string; estado: EstadoMesa; editor: boolean; atualizar: (d: EstadoMesa) => void;
}) {
  const { pedidos, emailLigado } = estado.outroLado;
  const [pedir, abrirPedir] = useParte("pedir", null);
  const pedindo = pedir === PEDIR_OUTRO_LADO;
  return (
    <div className="grid gap-3">
      {pedidos.length ? (
        <ul className="m-0 grid list-none gap-2 p-0">
          {pedidos.map((p) => <CartaoPedido key={p.id} p={p} tenantId={tenantId} textoId={textoId} editor={editor} atualizar={atualizar} />)}
        </ul>
      ) : <p className="m-0 text-apoio">{t("Nenhum pedido de outro lado ainda. Quem é acusado no texto tem direito de responder antes de publicar.", "No request to the other side yet. Anyone accused in the text has the right to respond before publication.")}</p>}
      {editor && (pedindo
        ? <FormPedido tenantId={tenantId} textoId={textoId} estado={estado} emailLigado={emailLigado} pronto={(d) => { atualizar(d); abrirPedir(null); }} cancelar={() => abrirPedir(null)} />
        : pedidos.length > 0 && <button type="button" className="btn-sec justify-self-start bg-papel-2" onClick={() => abrirPedir(PEDIR_OUTRO_LADO)}>{t("Pedir o outro lado", "Ask the other side")}</button>)}
    </div>
  );
}

function CartaoPedido({ p, tenantId, textoId, editor, atualizar }: { p: Pedido; tenantId: string; textoId: string; editor: boolean; atualizar: (d: EstadoMesa) => void }) {
  const [respondendo, setRespondendo] = useState(false);
  const [resposta, setResposta] = useState("");
  const [chegou, setChegou] = useState(local(new Date()));
  const [copiado, setCopiado] = useState(false);
  const registrar = useMutation({
    mutationFn: () => ler(rota.pedidos[":pedido"].resposta.$post({ param: { tenantId, id: textoId, pedido: p.id } }, corpoJson({ texto: resposta, recebidaEm: iso(chegou) }))),
    onSuccess: (d) => { atualizar(d); setRespondendo(false); setResposta(""); },
  });
  const copiar = async () => { await navigator.clipboard.writeText(`${p.assunto}\n\n${p.corpo}`).then(() => setCopiado(true), () => setCopiado(false)); };
  const envio = p.meio === "email"
    ? (p.enviadoEm ? t(`mandado por e-mail pelo app, ${quando(p.enviadoEm)} (hora do servidor)`, `sent by e-mail from the app, ${quando(p.enviadoEm)} (server time)`) : null)
    : t(`mandado por fora (${rotuloMeio(p.canal ?? "outro")}), ${quando(p.enviadoEm!)}, segundo ${p.porNome ?? "quem registrou"}; registrado ${quando(p.registradoEm)}`,
      `sent outside the app (${rotuloMeio(p.canal ?? "outro")}), ${quando(p.enviadoEm!)}, according to ${p.porNome ?? "whoever recorded it"}; recorded ${quando(p.registradoEm)}`);
  return (
    <li className="grid gap-1.5 rounded-card bg-branco px-3 py-2.5 shadow-curta">
      <b className="text-[15px] text-texto-forte">{p.paraNome}{p.paraEmail && <span className="mono font-normal text-apoio"> · {p.paraEmail}</span>}</b>
      <span className="text-[15px]">{p.assunto}</span>
      {p.trecho && <span className="text-[14px] text-apoio">“{p.trecho}”</span>}
      {envio && <span className="mono text-apoio">{envio}</span>}
      <span className="mono text-apoio">{t(`prazo: ${quandoFuturo(p.prazo)}`, `deadline: ${quandoFuturo(p.prazo)}`)}</span>
      {p.erro && (
        <p role="alert" className="faixa-erro m-0 text-[14px]">
          {t(`O e-mail não saiu (${p.erro}). Copie o pedido e mande por fora.`, `The e-mail didn't go out (${p.erro}). Copy the request and send it yourself.`)}{" "}
          <button type="button" className="link-acao border-0 bg-transparent p-0" onClick={() => void copiar()}>{copiado ? t("Copiado", "Copied") : t("Copiar o pedido", "Copy the request")}</button>
        </p>
      )}
      {p.respostaEm
        ? <span className="mono text-verde">{t(`respondeu ${quando(p.respostaEm)}; a resposta está no dossiê`, `replied ${quando(p.respostaEm)}; the reply is in the dossier`)}</span>
        : p.vencido && <p className="faixa-aviso m-0 py-1 text-[14px]">{t("Prazo vencido, sem resposta. Registre isso no texto.", "Deadline passed with no reply. Say so in the text.")}</p>}
      {editor && !respondendo && (
        <button type="button" className="link-acao justify-self-start border-0 bg-transparent p-0 text-[14px] font-normal" onClick={() => setRespondendo(true)}>
          {p.respostaEm ? t("Registrar outra resposta", "Record another reply") : t("Registrar resposta", "Record reply")}<span className="sr-only">{t(` de ${p.paraNome}`, ` from ${p.paraNome}`)}</span>
        </button>
      )}
      {respondendo && (
        <form className="mt-1 grid gap-2" onSubmit={(e) => { e.preventDefault(); if (resposta.trim()) registrar.mutate(); }}>
          <label className="campo">
            <span className="text-[14px]!">{t("A resposta, como chegou", "The reply, as it arrived")}</span>
            <textarea className="entrada min-h-28 bg-branco py-2" value={resposta} onChange={(e) => setResposta(e.target.value)} required />
          </label>
          <label className="campo">
            <span className="text-[14px]!">{t("Quando chegou", "When it arrived")}</span>
            <input type="datetime-local" className="entrada bg-branco" value={chegou} max={local(new Date())} onChange={(e) => setChegou(e.target.value)} required />
          </label>
          {registrar.isError && <p role="alert" className="m-0 text-[15px] text-terracota">{mensagem(registrar.error)}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn-sec bg-papel-2" disabled={registrar.isPending || !resposta.trim()}>{t("Pôr no dossiê", "Add to the dossier")}</button>
            <button type="button" className="btn-sec" onClick={() => setRespondendo(false)}>{t("Cancelar", "Cancel")}</button>
          </div>
        </form>
      )}
    </li>
  );
}

function FormPedido({ tenantId, textoId, estado, emailLigado, pronto, cancelar }: {
  tenantId: string; textoId: string; estado: EstadoMesa; emailLigado: boolean; pronto: (d: EstadoMesa) => void; cancelar: () => void;
}) {
  const { me, veiculo } = useCasca();
  const en = veiculo.idioma === "en";
  const riscos = estado.afirmacoes.filter((a) => a.estado === "risco" && RISCOS_OUTRO_LADO.includes(a.risco ?? ""));
  const [frase, setFrase] = useState(riscos[0]?.id ?? "");
  const [quem, setQuem] = useState("");
  const [email, setEmail] = useState("");
  const [prazo, setPrazo] = useState(local(new Date(Date.now() + 48 * 3_600_000)));
  const [assunto, setAssunto] = useState(en ? `Request for comment: ${estado.texto.titulo}` : `Pedido de posicionamento: ${estado.texto.titulo}`);
  const [corpo, setCorpo] = useState<string | null>(null);   // null: o modelo acompanha os campos até a pessoa editar
  const [fora, setFora] = useState(false);
  const [canal, setCanal] = useState("email");
  const [mandouEm, setMandouEm] = useState(local(new Date()));
  const [copiado, setCopiado] = useState<boolean | null>(null);
  const a = riscos.find((x) => x.id === frase) ?? null;
  const texto = corpo ?? modeloPedido({ en, quem: quem.trim(), nome: me.user.name, veiculo: veiculo.nome, titulo: estado.texto.titulo, trecho: a?.trecho ?? null, prazo });
  const corpoBase = { paraNome: quem, paraEmail: email || undefined, assunto, corpo: texto, prazo: prazo ? iso(prazo) : "", ...(a ? { blocoId: a.blocoId, trecho: a.trecho } : {}) };
  const enviar = useMutation({
    mutationFn: (meio: "email" | "copiado") => ler(rota.pedidos.$post({ param: { tenantId, id: textoId } },
      corpoJson(meio === "email" ? { ...corpoBase, meio } : { ...corpoBase, meio, canal, enviadoEm: iso(mandouEm) }))),
    onSuccess: pronto,
  });
  const copiar = () => navigator.clipboard.writeText(`${assunto}\n\n${texto}`).then(() => { setCopiado(true); setFora(true); }, () => { setCopiado(false); setFora(true); });
  const faltando = !quem.trim() || !assunto.trim() || !texto.trim() || !prazo;
  return (
    <form className="grid gap-3 rounded-card bg-papel-2/60 p-4" onSubmit={(e: FormEvent) => { e.preventDefault(); if (!faltando && emailLigado) enviar.mutate("email"); }}>
      <h3 className="m-0 text-[17px]">{t("Pedir o outro lado", "Ask the other side")}</h3>
      {riscos.length > 0 && (
        <label className="campo">
          <span>{t("Sobre qual frase", "About which sentence")}</span>
          <select className="entrada bg-branco" value={frase} onChange={(e) => setFrase(e.target.value)}>
            {riscos.map((r) => <option key={r.id} value={r.id}>{r.trecho.length > 90 ? `${r.trecho.slice(0, 90)}…` : r.trecho}</option>)}
            <option value="">{t("Nenhuma frase específica", "No specific sentence")}</option>
          </select>
        </label>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="campo">
          <span>{t("Quem você está procurando", "Who you are contacting")}</span>
          <input className="entrada bg-branco" value={quem} maxLength={200} onChange={(e) => setQuem(e.target.value)} required />
        </label>
        <label className="campo">
          <span>{emailLigado ? t("E-mail", "E-mail") : t("E-mail (opcional)", "E-mail (optional)")}</span>
          <input type="email" className="entrada bg-branco" value={email} autoCapitalize="none" spellCheck={false} onChange={(e) => setEmail(e.target.value)} />
        </label>
      </div>
      <label className="campo">
        <span>{t("Prazo para responder", "Deadline to reply")}</span>
        <input type="datetime-local" className="entrada bg-branco" value={prazo} min={local(new Date())} onChange={(e) => setPrazo(e.target.value)} required />
      </label>
      <label className="campo">
        <span>{t("Assunto", "Subject")}</span>
        <input className="entrada bg-branco" value={assunto} maxLength={200} onChange={(e) => setAssunto(e.target.value)} required />
      </label>
      <label className="campo">
        <span>{t("O pedido", "The request")}</span>
        <textarea className="entrada min-h-56 bg-branco py-2 leading-[1.5]" value={texto} onChange={(e) => setCorpo(e.target.value)} required />
        <span className="ajuda">{t("Um modelo para você ajustar. Diga o que o texto afirma e dê um prazo razoável.", "A template for you to adjust. Say what the text states and give a reasonable deadline.")}</span>
      </label>
      {!emailLigado && <p className="mono m-0 text-apoio">{t("o envio por e-mail não está configurado neste veículo: copie e mande por fora", "sending by e-mail isn't set up for this outlet: copy it and send it yourself")}</p>}
      {fora && (
        <fieldset className="grid gap-3 border-0 p-0">
          <legend className="mb-2 text-[15px]">{copiado === false ? t("O navegador não deixou copiar: selecione o texto acima. Depois de mandar, diga quando e por onde.", "The browser didn't allow copying: select the text above. After sending it, say when and how.") : t("Copiado. Depois de mandar, diga quando e por onde.", "Copied. After sending it, say when and how.")}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="campo">
              <span>{t("Por onde mandou", "How you sent it")}</span>
              <select className="entrada bg-branco" value={canal} onChange={(e) => setCanal(e.target.value)}>{MEIOS.map(([k, r]) => <option key={k} value={k}>{r()}</option>)}</select>
            </label>
            <label className="campo">
              <span>{t("Quando mandou", "When you sent it")}</span>
              <input type="datetime-local" className="entrada bg-branco" value={mandouEm} max={local(new Date())} onChange={(e) => setMandouEm(e.target.value)} required />
            </label>
          </div>
        </fieldset>
      )}
      {enviar.isError && <p role="alert" className="m-0 text-[15px] text-terracota">{mensagem(enviar.error)}</p>}
      <div className="flex flex-wrap gap-2">
        {emailLigado && <button type="submit" className="btn-sec bg-branco" disabled={enviar.isPending || faltando || !email.trim()}>{enviar.isPending ? t("Mandando…", "Sending…") : t("Mandar por e-mail", "Send by e-mail")}</button>}
        {fora
          ? <button type="button" className="btn-sec bg-branco" disabled={enviar.isPending || faltando} onClick={() => enviar.mutate("copiado")}>{t("Registrar o envio", "Record that it was sent")}</button>
          : <button type="button" className="btn-sec bg-branco" disabled={faltando} onClick={() => void copiar()}>{t("Copiar e mandar por fora", "Copy and send it yourself")}</button>}
        <button type="button" className="btn-sec" onClick={cancelar}>{t("Cancelar", "Cancel")}</button>
      </div>
    </form>
  );
}

/** O que faltou no último pacote, para a linha da parte; `null` quando veio completo. */
export function resumoPacote(p: { carimbo: string | null; fora: number }): Resumo | null {
  const falta = [
    ...(p.carimbo ? [] : [t("baixado sem carimbo de tempo", "downloaded without a timestamp")]),
    ...(p.fora > 0 ? [t(p.fora === 1 ? "1 arquivo fora" : `${p.fora} arquivos fora`, p.fora === 1 ? "1 file left out" : `${p.fora} files left out`)] : []),
  ];
  return falta.length ? { tom: "aviso", texto: falta.join(" · ") } : null;
}

/** Pacote de defesa: baixa o zip e diz se veio com carimbo de tempo (ou por que não). */
export function PacoteDefesa({ tenantId, textoId, editor, avisar }: { tenantId: string; textoId: string; editor: boolean; avisar?: (r: Resumo | null) => void }) {
  const [feito, setFeito] = useState<{ carimbo: string | null; erro: string | null; nome: string; fora: number } | null>(null);
  const baixar = useMutation({
    mutationFn: async () => {
      let res: Response;
      try {
        res = await fetch(`/api/t/${encodeURIComponent(tenantId)}/textos/${encodeURIComponent(textoId)}/pacote`, { headers: cabecalhoIdioma() });
      } catch {
        throw new ErroApi(0, t("Sem conexão com o servidor.", "No connection to the server."));
      }
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { erro?: string; code?: string } | null;
        throw new ErroApi(res.status, b?.erro ?? `Erro ${res.status}`, b?.code, b);
      }
      const nome = res.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "pacote-defesa.zip";
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url; link.download = nome;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      const c = res.headers.get("x-carimbo") ?? "";
      const erro = res.headers.get("x-carimbo-erro");
      return { carimbo: c.startsWith("ok ") ? c.slice(3) : null, erro: erro ? decodeURIComponent(erro) : null, nome, fora: Number(res.headers.get("x-pacote-fora") ?? 0) };
    },
    onSuccess: (r) => { setFeito(r); avisar?.(resumoPacote(r)); },
  });
  return (
    <div className="grid gap-3">
      <p className="m-0 max-w-[60ch] text-[15px]">{t("Um zip com as versões do texto, o dossiê (com as cópias do Wayback), as decisões de cada frase, os pedidos de outro lado e as respostas, os posts aprovados e um manifesto com o hash de cada arquivo, carimbado com a hora de uma autoridade de carimbo de tempo. Serve para provar o que você sabia, e quando.",
        "A zip with the text's versions, the dossier (with the Wayback copies), the decisions on each sentence, the requests to the other side and the replies, the approved posts and a manifest with each file's hash, stamped with the time of a timestamp authority. It proves what you knew, and when.")}</p>
      {editor
        ? <button type="button" className="btn-sec justify-self-start bg-papel-2" onClick={() => baixar.mutate()} disabled={baixar.isPending}>{baixar.isPending ? t("Montando o pacote…", "Building the package…") : t("Baixar o pacote de defesa", "Download the defense package")}</button>
        : <p className="mono m-0 text-apoio">{t("só o editor baixa o pacote", "only the editor downloads the package")}</p>}
      {editor && <FolhaAdvogado tenantId={tenantId} textoId={textoId} />}
      <div aria-live="polite" className="grid gap-2 empty:hidden">
        {baixar.isError && <p role="alert" className="faixa-erro m-0">{mensagem(baixar.error)}</p>}
        {feito && (feito.carimbo
          ? <p role="status" className="m-0 text-[15px] text-verde">{t(`Pacote baixado (${feito.nome}), com carimbo de tempo de ${new Date(feito.carimbo).toLocaleString("pt-BR")}.`, `Package downloaded (${feito.nome}), with a timestamp from ${new Date(feito.carimbo).toLocaleString("en-US")}.`)}</p>
          : <p role="status" className="faixa-aviso m-0">{t(`Pacote baixado sem carimbo de tempo: ${feito.erro ?? "a autoridade não respondeu"}. Baixe de novo mais tarde para ter a prova da hora.`, `Package downloaded without a timestamp: ${feito.erro ?? "the authority didn't respond"}. Download it again later to get proof of the time.`)}</p>)}
        {feito && feito.fora > 0 && <p className="faixa-aviso m-0">{t(`${feito.fora === 1 ? "1 arquivo ficou" : `${feito.fora} arquivos ficaram`} fora do pacote (sumiu do armazenamento ou é grande demais). O LEIA-ME e o manifesto dizem quais, com o hash de cada um.`, `${feito.fora === 1 ? "1 file was" : `${feito.fora} files were`} left out of the package (missing from storage or too large). The README and the manifest list them, with each file's hash.`)}</p>}
      </div>
    </div>
  );
}

/** Folha para o advogado: só as frases de risco, em PDF. Texto ainda não conferido: a mensagem pede a conferência. */
export function FolhaAdvogado({ tenantId, textoId }: { tenantId: string; textoId: string }) {
  const baixar = useMutation({
    mutationFn: async () => {
      let res: Response;
      try {
        res = await fetch(`/api/t/${encodeURIComponent(tenantId)}/textos/${encodeURIComponent(textoId)}/folha`, { headers: cabecalhoIdioma() });
      } catch {
        throw new ErroApi(0, t("Sem conexão com o servidor.", "No connection to the server."));
      }
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { erro?: string; code?: string } | null;
        throw new ErroApi(res.status, b?.erro ?? `Erro ${res.status}`, b?.code, b);
      }
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = res.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "folha-advogado.pdf";
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
  });
  return (
    <div className="grid gap-2">
      <button type="button" className="btn-sec justify-self-start bg-papel-2" onClick={() => baixar.mutate()} disabled={baixar.isPending}>{baixar.isPending ? t("Montando a folha…", "Building the sheet…") : t("Folha para o advogado", "Sheet for the lawyer")}</button>
      <p className="ajuda m-0 max-w-[60ch]">{t("Só as frases de risco, com a evidência e o outro lado, em poucas páginas. Nada é reescrito.", "Only the risky sentences, with the evidence and the other side, in a few pages. Nothing is rewritten.")}</p>
      {baixar.isError && <p role="alert" className="faixa-erro m-0">{mensagem(baixar.error)}</p>}
      {baixar.isSuccess && <p role="status" className="m-0 text-[15px] text-verde">{t("Folha baixada.", "Sheet downloaded.")}</p>}
    </div>
  );
}

/** Página de fontes pública: publicar a versão conferida (o checklist trava) ou, no ar, ver e tirar. */
export function PaginaFontes({ tenantId, textoId, estado, editor, versao, garantirSalvo, atualizar, abrirChecklist }: {
  tenantId: string; textoId: string; estado: EstadoMesa; editor: boolean; versao: () => number; garantirSalvo: () => Promise<void>; atualizar: (d: EstadoMesa) => void; abrirChecklist: () => void;
}) {
  const param = { tenantId, id: textoId };
  // Publica o que está na tela: o salvamento pendente vai antes (e, se falhou, a publicação não sai com a versão velha).
  const publicar = useMutation({
    mutationFn: async () => { await garantirSalvo(); return ler(rota["pagina-fontes"].$post({ param }, corpoJson({ versao: versao() }))); },
    onSuccess: atualizar,
    onError: (e) => { if (e instanceof ErroApi && e.codigo === "checklist") abrirChecklist(); },
  });
  const tirar = useMutation({ mutationFn: () => ler(rota["pagina-fontes"].$delete({ param })), onSuccess: atualizar });
  const p = estado.paginaFontes;
  if (!editor && !p) return null;
  return (
    <div className="grid gap-1">
      {p ? (
        <p className="mono m-0 text-apoio">
          {t(`página de fontes no ar (versão ${p.versao})`, `sources page live (version ${p.versao})`)} · <a href={p.url} target="_blank" rel="noreferrer" className="link-acao font-normal">{t("ver", "view")}</a>
          {editor && <> · <button type="button" className="link-acao border-0 bg-transparent p-0 font-normal" onClick={() => tirar.mutate()} disabled={tirar.isPending}>{t("tirar do ar", "take it down")}</button></>}
          {editor && estado.texto.versao !== p.versao && <> · <button type="button" className="link-acao border-0 bg-transparent p-0 font-normal" onClick={() => publicar.mutate()} disabled={publicar.isPending}>{t("publicar a versão atual", "publish the current version")}</button></>}
        </p>
      ) : (
        <button type="button" className="btn-sec justify-self-start bg-papel-2" onClick={() => publicar.mutate()} disabled={publicar.isPending}>
          {publicar.isPending ? t("Publicando…", "Publishing…") : t("Publicar a página de fontes", "Publish the sources page")}
        </button>
      )}
      {(publicar.isError || tirar.isError) && <p role="alert" className="faixa-erro m-0">{mensagem(publicar.error ?? tirar.error)}</p>}
    </div>
  );
}
