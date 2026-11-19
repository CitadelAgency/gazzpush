// The outlet screen's Accounts tab, in parts (DESIGN.md §9): connect an account, the connected accounts and Google Docs.
// Loads only when opened: outside the Brand budget.
import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { bodyJson, ApiError, read } from "../../api";
import { FailureLoad } from "../../common";
import { keys, asPosts, accountName, useAccountsAll, type Account } from "../../queue";
import { t as tr } from "../../language";
import { Parts, usePart, type ItemPart } from "../../kit/Parts";
import { connectGoogle } from "../../onboarding/google";
import { useMe, type Outlet as Veic } from "../../session";
import { Load, actionMessage, t } from "./common";

type EnableMode = "manual" | "real" | "intermediario";
const modesEnable = (): [EnableMode, string, string][] => [
  ["manual", tr("Manual", "Manual"), tr("Você aprova aqui e posta pelo celular.", "You approve here and post from your phone.")],
  ["real", tr("Instagram direto", "Instagram direct"), tr("Posta sozinho, pelo app Meta do veículo.", "Posts on its own, through the publication's Meta app.")],
  ["intermediario", tr("Por intermediário", "Through a posting service"), tr("Um serviço com app aprovado posta em nome da conta.", "A service with an approved app posts on the account's behalf.")],
];
const PROVIDERS_ENABLE: [string, string, boolean][] = [["ayrshare", "Ayrshare", true], ["postpeer", "PostPeer", false], ["zernio", "Zernio", false]];

export default function Accounts({ veiculo: outlet, admin }: { veiculo: Veic; admin: boolean }) {
  const qc = useQueryClient();
  const accounts = useAccountsAll(outlet.id);
  const google = useMe().data?.google ?? null;
  const [params] = useSearchParams();
  const [, openPart] = usePart("parte", null);
  const [mode, setMode] = useState<EnableMode>("manual");
  const [handle, setHandle] = useState("");
  const [externalId, setExternalId] = useState("");
  const [token, setToken] = useState("");
  const [providerRef, setProviderRef] = useState("");
  const reload = () => qc.invalidateQueries({ queryKey: keys.contas(outlet.id) });
  const enable = useMutation({
    // The secret (Instagram token or the intermediary's key) only goes in the body; the API encrypts it before storing.
    mutationFn: (name: string) => read(t.contas.$post({ param: { tenantId: outlet.id } }, bodyJson(
      mode === "manual" ? { nome: name, modo: mode }
        : mode === "real" ? { nome: name, modo: mode, externalId, token }
          : { nome: name, modo: mode, provedor: "ayrshare", token, ...(providerRef ? { provedorRef: providerRef } : {}) },
    ))),
    // The new account appears where the person will check: in the list.
    onSuccess: () => { setHandle(""); setExternalId(""); setToken(""); setProviderRef(""); reload(); openPart("contas"); },
  });
  const toggle = useMutation({
    mutationFn: ({ id, ativo: active }: { id: string; ativo: boolean }) => read(t.contas[":id"].$patch({ param: { tenantId: outlet.id, id } }, bodyJson({ ativo: active }))),
    onSuccess: reload,
  });
  if (accounts.isPending) return <Load oque={tr("as contas", "the accounts")} />;
  if (accounts.isError) return <FailureLoad oque={tr("as contas", "the accounts")} tentar={() => accounts.refetch()} />;
  function send(e: FormEvent) {
    e.preventDefault();
    const h = handle.trim().replace(/^@/, "");
    if (h) enable.mutate(`@${h}`);
  }
  const enableError = (e: unknown) => {
    if (e instanceof ApiError && e.status === 400) {
      if (e.message.startsWith("externalId")) return tr("O id da conta profissional é só número (ex.: 17841400000000000).", "The professional account id is numbers only (e.g. 17841400000000000).");
      if (e.message.startsWith("token")) return tr("Confira o token: ele está vazio ou grande demais.", "Check the token: it is empty or too long.");
      return tr(`Não deu para ligar: ${e.message}.`, `Couldn't connect: ${e.message}.`);
    }
    return actionMessage(e, tr("ligar a conta", "connect the account"));
  };
  const list = accounts.data.contas;
  const off = list.filter((x) => x.status !== "ativa").length;
  const count = !list.length ? tr("nenhuma conta", "no accounts") : list.length === 1 ? tr("1 conta", "1 account") : tr(`${list.length} contas`, `${list.length} accounts`);
  // Better Auth comes back with ?error= when Google did not connect (the person declined, the account is already linked to someone else…).
  const docsError = !!google && !google.conectado && !!params.get("error");
  const formState = (
        <form onSubmit={send} aria-label={tr("Ligar uma conta", "Connect an account")} className="grid gap-4">
          <fieldset className="m-0 grid gap-1 border-0 p-0">
            <legend className="mb-1 p-0 text-[15px] font-bold text-texto-forte">{tr("Como os posts saem", "How posts go out")}</legend>
            {modesEnable().map(([v, r, help]) => (
              <label key={v} className={`flex cursor-pointer items-start gap-3 rounded-btn px-3 py-2 ${mode === v ? "bg-papel-2" : "hover:bg-papel-2/60"}`}>
                <input type="radio" name="modo-conta" value={v} checked={mode === v} onChange={() => { setMode(v); enable.reset(); }} className="mt-1 size-[18px] accent-texto-forte" />
                <span className="grid"><b className="text-texto-forte">{r}</b><span className="ajuda">{help}</span></span>
              </label>
            ))}
          </fieldset>
          <label className="campo">
            <span>{tr("@ da conta no Instagram", "Instagram account @")}</span>
            <input className="entrada" value={handle} onChange={(e) => setHandle(e.target.value.trim())} placeholder={tr("@seuveiculo", "@yourpublication")} required
              autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint={mode === "manual" ? "done" : "next"}
              maxLength={31} pattern="@?[A-Za-z0-9._]{1,30}" aria-describedby="ligar-ajuda" />
            <span id="ligar-ajuda" className="ajuda">{mode === "manual"
              ? tr("Quem aprova escolhe esta conta; o post sai pelo celular de quem posta.", "Whoever approves picks this account; the post goes out from the phone of whoever posts it.")
              : tr("Quem aprova escolhe esta conta; o post sai sozinho, na hora ou no horário marcado.", "Whoever approves picks this account; the post goes out on its own, right away or at the scheduled time.")}</span>
          </label>
          {mode === "real" && (
            <>
              <label className="campo">
                <span>{tr("Id da conta profissional", "Professional account id")}</span>
                <input className="entrada" value={externalId} onChange={(e) => setExternalId(e.target.value.trim())} required inputMode="numeric" enterKeyHint="next"
                  pattern="[0-9]{5,30}" autoComplete="off" placeholder="17841400000000000" aria-describedby="id-ajuda" />
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
          {mode === "intermediario" && (
            <>
              <fieldset className="m-0 grid gap-1 border-0 p-0">
                <legend className="mb-1 p-0 text-[15px] font-bold text-texto-forte">{tr("Serviço", "Service")}</legend>
                {PROVIDERS_ENABLE.map(([v, r, active]) => (
                  <label key={v} className={`flex items-start gap-3 rounded-btn px-3 py-2 ${active ? "bg-papel-2" : "text-apoio"}`}>
                    <input type="radio" name="provedor" value={v} checked={v === "ayrshare"} disabled={!active} readOnly className="mt-1 size-[18px] accent-texto-forte" />
                    <span className="grid"><b className={active ? "text-texto-forte" : "text-apoio"}>{r}</b>{!active && <span className="mono">{tr("em breve", "coming soon")}</span>}</span>
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
                <input className="entrada" value={providerRef} onChange={(e) => setProviderRef(e.target.value.trim())} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="done" maxLength={200} aria-describedby="perfil-ajuda" />
                <span id="perfil-ajuda" className="ajuda">{tr("O perfil desta conta no Ayrshare (planos com vários perfis). Vazio usa o perfil principal.", "This account's profile in Ayrshare (plans with several profiles). Empty uses the main profile.")}</span>
              </label>
            </>
          )}
          {enable.isError && <p role="alert" className="faixa-erro m-0">{enableError(enable.error)}</p>}
          <button type="submit" className="btn-tinta justify-self-start" disabled={enable.isPending}>{enable.isPending ? tr("Ligando…", "Connecting…") : tr("Ligar conta", "Connect account")}</button>
        </form>
  );
  const items: ItemPart[] = [
    ...(admin ? [{ id: "ligar", rotulo: tr("Ligar uma conta", "Connect an account"), resumo: tr("manual, direto ou intermediário", "manual, direct or a service"), conteudo: formState }] : []),
    {
      id: "contas", rotulo: tr("Onde os posts saem", "Where posts go out"),
      resumo: off ? tr(`${count} · ${off === 1 ? "1 desligada" : `${off} desligadas`}`, `${count} · ${off} disconnected`) : count,
      conteudo: (
        <>
          <p className="m-0 max-w-[52ch] text-apoio">{tr("Conta manual: você aprova aqui e posta pelo celular. Instagram direto ou por intermediário: depois de aprovado, o post sai sozinho.", "Manual account: you approve here and post from your phone. Instagram direct or through a posting service: once approved, the post goes out on its own.")}</p>
          {enable.isSuccess && !enable.isPending && <p role="status" className="m-0 text-[15px] text-verde">{tr(`${enable.variables} ligada.`, `${enable.variables} connected.`)}</p>}
          {list.length ? (
            <ul className="m-0 grid list-none gap-2 p-0">
              {list.map((c) => <ItemAccount key={c.id} c={c} admin={admin} ocupado={toggle.isPending && toggle.variables?.id === c.id}
                alternar={(active) => toggle.mutate({ id: c.id, ativo: active })} />)}
            </ul>
          ) : (
            <p className="m-0 text-[17px] text-texto-forte">{tr("Nenhuma conta ligada ainda.", "No account connected yet.")}{admin ? "" : tr(" Peça ao admin.", " Ask the admin.")}</p>
          )}
          {toggle.isError && <p role="alert" className="faixa-erro m-0">{actionMessage(toggle.error, tr("mudar a conta", "change the account"))}</p>}
        </>
      ),
    },
    ...(google ? [{
      id: "docs", rotulo: "Google Docs", resumo: docsError ? tr("não conectou", "didn't connect") : google.conectado ? tr("conectado", "connected") : tr("não conectado", "not connected"),
      tom: docsError ? "erro" as const : undefined,
      conteudo: <ConnectionDocs google={google} erro={docsError} />,
    }] : []),
  ];
  const fallback = docsError ? "docs" : admin && !list.length ? "ligar" : "contas";
  return (
    <div className="max-w-[640px] min-[1280px]:max-w-[940px]">
      <Parts itens={items} padrao={fallback} rotulo={tr("Partes das contas", "Parts of the accounts")} />
    </div>
  );
}

/**
 * Google Docs (only with the Google configuration on the server). The connection belongs to each person, not to the
 * outlet: it links their Google account with the drive.file scope. Afterwards, New idea and Texts open Google Docs to
 * choose the document; Gazzpush only sees the chosen documents.
 */
function ConnectionDocs({ google, erro: error }: { google: NonNullable<NonNullable<ReturnType<typeof useMe>["data"]>["google"]>; erro: boolean }) {
  const connect = useMutation({ mutationFn: () => connectGoogle(google.escopo, `${location.pathname}?aba=contas`) });
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
      {error && <p role="alert" className="faixa-erro m-0">{tr("O Google não conectou. Tente de novo; se continuar, confira se a conta Google já está ligada a outra pessoa.", "Google didn't connect. Try again; if it keeps happening, check whether the Google account is already linked to someone else.")}</p>}
      {connect.isError && <p role="alert" className="faixa-erro m-0">{actionMessage(connect.error, tr("conectar o Google Docs", "connect Google Docs"))}</p>}
      <button type="button" className="btn-sec justify-self-start bg-papel-2" onClick={() => connect.mutate()} disabled={connect.isPending}>
        {connect.isPending ? tr("Abrindo o Google…", "Opening Google…") : google.conectado ? tr("Conectar de novo", "Connect again") : tr("Conectar Google Docs", "Connect Google Docs")}
      </button>
    </div>
  );
}

function ItemAccount({ c, admin, ocupado: busy, alternar: toggle }: { c: Account; admin: boolean; ocupado: boolean; alternar: (active: boolean) => void }) {
  const active = c.status === "ativa";
  const name = accountName(c);
  return (
    <li className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-btn bg-papel p-3 shadow-curta ${active ? "" : "text-apoio"}`}>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <b className={active ? "text-texto-forte" : "text-apoio"}>{name}</b>
        <span className="mono text-apoio">{active ? (c.modo === "simulada" ? tr("simulação: nada sai de verdade", "simulation: nothing really goes out") : asPosts(c.modo, c.provedor)) : tr("desligada", "disconnected")}</span>
      </span>
      {admin && c.modo !== "simulada" && (
        <button type="button" onClick={() => toggle(!active)} disabled={busy} className="btn-sec -mr-2 text-[15px]">
          {busy ? "…" : active ? tr("Desligar", "Disconnect") : tr("Religar", "Reconnect")}<span className="sr-only"> {name}</span>
        </button>
      )}
    </li>
  );
}
