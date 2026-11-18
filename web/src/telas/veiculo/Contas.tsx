// Aba Contas da tela do veículo, em partes (DESIGN.md §9): ligar uma conta, as contas ligadas e o Google Docs. Carrega
// só quando abre: fora do orçamento da Marca.
import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { corpoJson, ErroApi, ler } from "../../api";
import { FalhaCarga } from "../../comum";
import { chaves, comoPosta, nomeConta, useContasTodas, type Conta } from "../../fila";
import { t as tr } from "../../idioma";
import { Partes, useParte, type ItemParte } from "../../kit/Partes";
import { conectarGoogle } from "../../novo/google";
import { useMe, type Veiculo as Veic } from "../../sessao";
import { Carga, mensagemAcao, t } from "./comum";

type ModoLigar = "manual" | "real" | "intermediario";
const modosLigar = (): [ModoLigar, string, string][] => [
  ["manual", tr("Manual", "Manual"), tr("Você aprova aqui e posta pelo celular.", "You approve here and post from your phone.")],
  ["real", tr("Instagram direto", "Instagram direct"), tr("Posta sozinho, pelo app Meta do veículo.", "Posts on its own, through the publication's Meta app.")],
  ["intermediario", tr("Por intermediário", "Through a posting service"), tr("Um serviço com app aprovado posta em nome da conta.", "A service with an approved app posts on the account's behalf.")],
];
const PROVEDORES_LIGAR: [string, string, boolean][] = [["ayrshare", "Ayrshare", true], ["postpeer", "PostPeer", false], ["zernio", "Zernio", false]];

export default function Contas({ veiculo, admin }: { veiculo: Veic; admin: boolean }) {
  const qc = useQueryClient();
  const contas = useContasTodas(veiculo.id);
  const google = useMe().data?.google ?? null;
  const [params] = useSearchParams();
  const [, abrirParte] = useParte("parte", null);
  const [modo, setModo] = useState<ModoLigar>("manual");
  const [handle, setHandle] = useState("");
  const [externalId, setExternalId] = useState("");
  const [token, setToken] = useState("");
  const [provedorRef, setProvedorRef] = useState("");
  const recarregar = () => qc.invalidateQueries({ queryKey: chaves.contas(veiculo.id) });
  const ligar = useMutation({
    // O segredo (token do Instagram ou chave do intermediário) só vai no corpo; a API cifra antes de gravar.
    mutationFn: (nome: string) => ler(t.contas.$post({ param: { tenantId: veiculo.id } }, corpoJson(
      modo === "manual" ? { nome, modo }
        : modo === "real" ? { nome, modo, externalId, token }
          : { nome, modo, provedor: "ayrshare", token, ...(provedorRef ? { provedorRef } : {}) },
    ))),
    // A conta nova aparece onde a pessoa vai conferir: na lista.
    onSuccess: () => { setHandle(""); setExternalId(""); setToken(""); setProvedorRef(""); recarregar(); abrirParte("contas"); },
  });
  const alternar = useMutation({
    mutationFn: ({ id, ativo }: { id: string; ativo: boolean }) => ler(t.contas[":id"].$patch({ param: { tenantId: veiculo.id, id } }, corpoJson({ ativo }))),
    onSuccess: recarregar,
  });
  if (contas.isPending) return <Carga oque={tr("as contas", "the accounts")} />;
  if (contas.isError) return <FalhaCarga oque={tr("as contas", "the accounts")} tentar={() => contas.refetch()} />;
  function enviar(e: FormEvent) {
    e.preventDefault();
    const h = handle.trim().replace(/^@/, "");
    if (h) ligar.mutate(`@${h}`);
  }
  const erroLigar = (e: unknown) => {
    if (e instanceof ErroApi && e.status === 400) {
      if (e.message.startsWith("externalId")) return tr("O id da conta profissional é só número.", "The professional account id is numbers only.");
      if (e.message.startsWith("token")) return tr("Confira o token: ele está vazio ou grande demais.", "Check the token: it is empty or too long.");
      return tr(`Não deu para ligar: ${e.message}.`, `Couldn't connect: ${e.message}.`);
    }
    return mensagemAcao(e, tr("ligar a conta", "connect the account"));
  };
  const lista = contas.data.contas;
  const desligadas = lista.filter((x) => x.status !== "ativa").length;
  const contagem = !lista.length ? tr("nenhuma conta", "no accounts") : lista.length === 1 ? tr("1 conta", "1 account") : tr(`${lista.length} contas`, `${lista.length} accounts`);
  // O Better Auth volta com ?error= quando o Google não conectou (a pessoa negou, conta já ligada a outra pessoa…).
  const erroDocs = !!google && !google.conectado && !!params.get("error");
  const formulario = (
        <form onSubmit={enviar} aria-label={tr("Ligar uma conta", "Connect an account")} className="grid gap-4">
          <fieldset className="m-0 grid gap-1 border-0 p-0">
            <legend className="mb-1 p-0 text-[15px] font-bold text-texto-forte">{tr("Como os posts saem", "How posts go out")}</legend>
            {modosLigar().map(([v, r, ajuda]) => (
              <label key={v} className={`flex cursor-pointer items-start gap-3 rounded-btn px-3 py-2 ${modo === v ? "bg-papel-2" : "hover:bg-papel-2/60"}`}>
                <input type="radio" name="modo-conta" value={v} checked={modo === v} onChange={() => { setModo(v); ligar.reset(); }} className="mt-1 size-[18px] accent-texto-forte" />
                <span className="grid"><b className="text-texto-forte">{r}</b><span className="ajuda">{ajuda}</span></span>
              </label>
            ))}
          </fieldset>
          <label className="campo">
            <span>{tr("@ da conta no Instagram", "Instagram account @")}</span>
            <input className="entrada" value={handle} onChange={(e) => setHandle(e.target.value.trim())} placeholder="@" required
              autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint={modo === "manual" ? "done" : "next"}
              maxLength={31} pattern="@?[A-Za-z0-9._]{1,30}" aria-describedby="ligar-ajuda" />
            <span id="ligar-ajuda" className="ajuda">{modo === "manual"
              ? tr("Quem aprova escolhe esta conta; o post sai pelo celular de quem posta.", "Whoever approves picks this account; the post goes out from the phone of whoever posts it.")
              : tr("Quem aprova escolhe esta conta; o post sai sozinho, na hora ou no horário marcado.", "Whoever approves picks this account; the post goes out on its own, right away or at the scheduled time.")}</span>
          </label>
          {modo === "real" && (
            <>
              <label className="campo">
                <span>{tr("Id da conta profissional", "Professional account id")}</span>
                <input className="entrada" value={externalId} onChange={(e) => setExternalId(e.target.value.trim())} required inputMode="numeric" enterKeyHint="next"
                  pattern="[0-9]{5,30}" autoComplete="off" aria-describedby="id-ajuda" />
                <span id="id-ajuda" className="ajuda">{tr(
                  <>O número da conta do Instagram ligada à página do Facebook (em <span className="mono">/me/accounts</span>, campo <span className="mono">instagram_business_account</span>).</>,
                  <>The number of the Instagram account linked to the Facebook page (in <span className="mono">/me/accounts</span>, field <span className="mono">instagram_business_account</span>).</>,
                )}</span>
              </label>
              <label className="campo">
                <span>{tr("Token de acesso", "Access token")}</span>
                <input className="entrada" type="password" value={token} onChange={(e) => setToken(e.target.value)} required autoComplete="off" spellCheck={false} enterKeyHint="done" aria-describedby="token-ajuda" />
                <span id="token-ajuda" className="ajuda">{tr(
                  "Token de longa duração do app Meta em modo desenvolvimento (Graph API Explorer). Passo a passo no HANDOFF.md. Fica guardado cifrado e não aparece de novo.",
                  "Long-lived token from the Meta app in development mode (Graph API Explorer). Step by step in HANDOFF.md. It is stored encrypted and is not shown again.",
                )}</span>
              </label>
            </>
          )}
          {modo === "intermediario" && (
            <>
              <fieldset className="m-0 grid gap-1 border-0 p-0">
                <legend className="mb-1 p-0 text-[15px] font-bold text-texto-forte">{tr("Serviço", "Service")}</legend>
                {PROVEDORES_LIGAR.map(([v, r, ativo]) => (
                  <label key={v} className={`flex items-start gap-3 rounded-btn px-3 py-2 ${ativo ? "bg-papel-2" : "text-apoio"}`}>
                    <input type="radio" name="provedor" value={v} checked={v === "ayrshare"} disabled={!ativo} readOnly className="mt-1 size-[18px] accent-texto-forte" />
                    <span className="grid"><b className={ativo ? "text-texto-forte" : "text-apoio"}>{r}</b>{!ativo && <span className="mono">{tr("em breve", "coming soon")}</span>}</span>
                  </label>
                ))}
              </fieldset>
              <label className="campo">
                <span>{tr("Chave da API", "API key")}</span>
                <input className="entrada" type="password" value={token} onChange={(e) => setToken(e.target.value)} required autoComplete="off" spellCheck={false} enterKeyHint="next" aria-describedby="chave-ajuda" />
                <span id="chave-ajuda" className="ajuda">{tr("No painel do Ayrshare, em API Key. Fica guardada cifrada e não aparece de novo.", "In the Ayrshare dashboard, under API Key. It is stored encrypted and is not shown again.")}</span>
              </label>
              <label className="campo">
                <span>{tr("Profile Key (opcional)", "Profile Key (optional)")}</span>
                <input className="entrada" value={provedorRef} onChange={(e) => setProvedorRef(e.target.value.trim())} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="done" maxLength={200} aria-describedby="perfil-ajuda" />
                <span id="perfil-ajuda" className="ajuda">{tr("O perfil desta conta no Ayrshare (planos com vários perfis). Vazio usa o perfil principal.", "This account's profile in Ayrshare (plans with several profiles). Empty uses the main profile.")}</span>
              </label>
            </>
          )}
          {ligar.isError && <p role="alert" className="faixa-erro m-0">{erroLigar(ligar.error)}</p>}
          <button type="submit" className="btn-tinta justify-self-start" disabled={ligar.isPending}>{ligar.isPending ? tr("Ligando…", "Connecting…") : tr("Ligar conta", "Connect account")}</button>
        </form>
  );
  const itens: ItemParte[] = [
    ...(admin ? [{ id: "ligar", rotulo: tr("Ligar uma conta", "Connect an account"), resumo: tr("manual, direto ou intermediário", "manual, direct or a service"), conteudo: formulario }] : []),
    {
      id: "contas", rotulo: tr("Onde os posts saem", "Where posts go out"),
      resumo: desligadas ? tr(`${contagem} · ${desligadas === 1 ? "1 desligada" : `${desligadas} desligadas`}`, `${contagem} · ${desligadas} disconnected`) : contagem,
      conteudo: (
        <>
          <p className="m-0 max-w-[52ch] text-apoio">{tr("Conta manual: você aprova aqui e posta pelo celular. Instagram direto ou por intermediário: depois de aprovado, o post sai sozinho.", "Manual account: you approve here and post from your phone. Instagram direct or through a posting service: once approved, the post goes out on its own.")}</p>
          {ligar.isSuccess && !ligar.isPending && <p role="status" className="m-0 text-[15px] text-verde">{tr(`${ligar.variables} ligada.`, `${ligar.variables} connected.`)}</p>}
          {lista.length ? (
            <ul className="m-0 grid list-none gap-2 p-0">
              {lista.map((c) => <ItemConta key={c.id} c={c} admin={admin} ocupado={alternar.isPending && alternar.variables?.id === c.id}
                alternar={(ativo) => alternar.mutate({ id: c.id, ativo })} />)}
            </ul>
          ) : (
            <p className="m-0 text-[17px] text-texto-forte">{tr("Nenhuma conta ligada ainda.", "No account connected yet.")}{admin ? "" : tr(" Peça ao admin.", " Ask the admin.")}</p>
          )}
          {alternar.isError && <p role="alert" className="faixa-erro m-0">{mensagemAcao(alternar.error, tr("mudar a conta", "change the account"))}</p>}
        </>
      ),
    },
    ...(google ? [{
      id: "docs", rotulo: "Google Docs", resumo: erroDocs ? tr("não conectou", "didn't connect") : google.conectado ? tr("conectado", "connected") : tr("não conectado", "not connected"),
      tom: erroDocs ? "erro" as const : undefined,
      conteudo: <ConexaoDocs google={google} erro={erroDocs} />,
    }] : []),
  ];
  const padrao = erroDocs ? "docs" : admin && !lista.length ? "ligar" : "contas";
  return (
    <div className="max-w-[640px] min-[1280px]:max-w-[940px]">
      <Partes itens={itens} padrao={padrao} rotulo={tr("Partes das contas", "Parts of the accounts")} />
    </div>
  );
}

/**
 * Google Docs (só com a configuração do Google no servidor). A conexão é de cada pessoa, não do veículo: vincula a
 * conta Google dela com o escopo drive.file. Depois, a Nova ideia e os Textos abrem o Google Docs para escolher o
 * documento; o Gazzpush só enxerga os documentos escolhidos.
 */
function ConexaoDocs({ google, erro }: { google: NonNullable<NonNullable<ReturnType<typeof useMe>["data"]>["google"]>; erro: boolean }) {
  const conectar = useMutation({ mutationFn: () => conectarGoogle(google.escopo, `${location.pathname}?aba=contas`) });
  return (
    <div className="grid gap-3">
      <p className="m-0 max-w-[52ch] text-apoio">
        {google.conectado
          ? tr("Conectado à sua conta Google. Na Nova ideia e nos Textos, o Google Docs abre para você escolher o documento. O Gazzpush só enxerga os documentos que você escolher.",
            "Connected to your Google account. In New idea and in Texts, Google Docs opens so you can pick the document. Gazzpush only sees the documents you pick.")
          : tr("Conecte a sua conta Google para trazer rascunhos do Google Docs. O Gazzpush só enxerga os documentos que você escolher; a conexão é sua, não do veículo.",
            "Connect your Google account to bring in drafts from Google Docs. Gazzpush only sees the documents you pick; the connection is yours, not the publication's.")}
      </p>
      {google.conectado && <p className="mono m-0 text-verde">{tr("conectado", "connected")}</p>}
      {erro && <p role="alert" className="faixa-erro m-0">{tr("O Google não conectou. Tente de novo; se continuar, confira se a conta Google já está ligada a outra pessoa.", "Google didn't connect. Try again; if it keeps happening, check whether the Google account is already linked to someone else.")}</p>}
      {conectar.isError && <p role="alert" className="faixa-erro m-0">{mensagemAcao(conectar.error, tr("conectar o Google Docs", "connect Google Docs"))}</p>}
      <button type="button" className="btn-sec justify-self-start bg-papel-2" onClick={() => conectar.mutate()} disabled={conectar.isPending}>
        {conectar.isPending ? tr("Abrindo o Google…", "Opening Google…") : google.conectado ? tr("Conectar de novo", "Connect again") : tr("Conectar Google Docs", "Connect Google Docs")}
      </button>
    </div>
  );
}

function ItemConta({ c, admin, ocupado, alternar }: { c: Conta; admin: boolean; ocupado: boolean; alternar: (ativo: boolean) => void }) {
  const ativa = c.status === "ativa";
  const nome = nomeConta(c);
  return (
    <li className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-btn bg-papel p-3 shadow-curta ${ativa ? "" : "text-apoio"}`}>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <b className={ativa ? "text-texto-forte" : "text-apoio"}>{nome}</b>
        <span className="mono text-apoio">{ativa ? (c.modo === "simulada" ? tr("simulação: nada sai de verdade", "simulation: nothing really goes out") : comoPosta(c.modo, c.provedor)) : tr("desligada", "disconnected")}</span>
      </span>
      {admin && c.modo !== "simulada" && (
        <button type="button" onClick={() => alternar(!ativa)} disabled={ocupado} className="btn-sec -mr-2 text-[15px]">
          {ocupado ? "…" : ativa ? tr("Desligar", "Disconnect") : tr("Religar", "Reconnect")}<span className="sr-only"> {nome}</span>
        </button>
      )}
    </li>
  );
}
