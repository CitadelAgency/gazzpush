// The AI keys tab, admins only: the outlet chooses either one Kie.ai key for everything or separate BYOK keys per
// function (text, second opinion, illustration). The key goes only in the PUT body; the API checks it with the
// provider, stores it encrypted and never returns it (the screen sees the last 4 characters). Without the outlet's key
// the server's applies; without either, the feature is off and the screen says so. Kie.ai is strictly opt-in for text
// and second opinion: nothing switches until the admin explicitly chooses it.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { fromKeyLink, PROVIDERS, PROVIDERS_IMAGE, PROVIDERS_TEXT_BYOK, type Provider } from "../../../../src/lib/providersTable";
import { bodyJson, ApiError, read, type Success } from "../../api";
import { FailureLoad } from "../../common";
import { language, t as tr } from "../../language";
import type { Outlet } from "../../session";
import { Load, actionMessage, t } from "./common";

type State = Success<Awaited<ReturnType<(typeof t)["chaves-ia"]["$get"]>>>;
type Origin = "veiculo" | "servidor";
type Role = "texto" | "segunda" | "imagem";

const DOES = (p: Provider) => ({
  deepseek: tr("Escreve os posts e confere os textos.", "Writes the posts and checks the texts."),
  gemini: tr("Escreve os posts e confere os textos, no lugar do DeepSeek.", "Writes the posts and checks the texts, instead of DeepSeek."),
  anthropic: tr("Dá a segunda opinião em risco jurídico e confere sozinho o texto de tema sensível.", "Gives the second opinion on legal risk and checks sensitive topics on its own."),
  kie: tr("Desenha a ilustração dos posts. Opcionalmente, também faz texto e segunda opinião.", "Draws the posts' illustration. Optionally also handles text and second opinion."),
  fal: tr("Desenha a ilustração dos posts, no lugar da Kie.", "Draws the posts' illustration, instead of Kie."),
})[p];

const displayName = (role: Role, p: Provider) => {
  if (p === "kie" && role === "texto") return "Kie (Gemini)";
  if (p === "kie" && role === "segunda") return "Kie (Claude)";
  return PROVIDERS[p].nome;
};

const dateOf = (s: string) => new Date(`${s.replace(" ", "T")}Z`).toLocaleDateString(language(), { day: "numeric", month: "long", timeZone: "America/Sao_Paulo" });
const withWho = (o: Origin) => (o === "veiculo" ? tr("com a chave do veículo", "with the publication's key") : tr("com a chave do servidor", "with the server's key"));

/** An API error in plain language (the API already sends it that way); without a connection or another error, the tabs' usual message. */
const errorMessage = (e: unknown, what: string) => (e instanceof ApiError && [400, 409, 422, 502].includes(e.status) ? e.message : actionMessage(e, what));

export default function Keys({ veiculo: outlet, admin }: { veiculo: Outlet; admin: boolean }) {
  const param = { tenantId: outlet.id };
  const qc = useQueryClient();
  const key = [outlet.id, "chaves-ia"];
  const state = useQuery({ queryKey: key, enabled: admin, queryFn: () => read(t["chaves-ia"].$get({ param })) });
  const save = (e: State) => qc.setQueryData(key, e);
  const choose = useMutation({
    mutationFn: (b: { texto?: string; segunda?: string; imagem?: string }) => read(t["chaves-ia"].$patch({ param }, bodyJson(b))),
    onSuccess: save,
  });
  const [pickedMode, setPickedMode] = useState<"kie" | "byok" | null>(null);
  const usageTitle = useId();
  const modeTitle = useId();
  const kieTitle = useId();

  if (!admin) return <p className="m-0 max-w-[60ch]">{tr("Só o admin do veículo vê as chaves de IA.", "Only the outlet's admin sees the AI keys.")}</p>;
  if (state.isPending) return <Load oque={tr("as chaves de IA", "the AI keys")} />;
  if (state.isError) return <FailureLoad oque={tr("as chaves de IA", "the AI keys")} tentar={() => state.refetch()} />;

  const e = state.data;
  const line = (p: Provider) => e.provedores.find((x) => x.id === p)!;
  const kieLine = line("kie");
  const hasKieKey = !!kieLine.veiculo || kieLine.servidor;
  const allKie = e.escolha.texto === "kie" && e.escolha.segunda === "kie" && e.escolha.imagem === "kie";
  const mode = pickedMode ?? (allKie ? "kie" : "byok");
  const kieLink = fromKeyLink("kie");
  const fallbackByokText = PROVIDERS_TEXT_BYOK.find((p) => {
    const l = line(p);
    return !!l.veiculo || l.servidor;
  });

  const usages: [Role, string, { provedor: Provider; origem: Origin } | null, string][] = [
    ["texto", tr("Texto", "Text"), e.emUso.texto, tr("desligado: sem chave, não sai post nem conferência", "off: with no key, no posts or checks")],
    ["segunda", tr("Segunda opinião", "Second opinion"), e.emUso.segunda, tr("desligada: a conferência tem uma opinião só", "off: the check has only one opinion")],
    ["imagem", tr("Ilustração", "Illustration"), e.emUso.imagem, tr("desligada: o post sai com a ilustração simples", "off: the post gets the simple illustration")],
  ];

  function switchBackToByok() {
    setPickedMode("byok");
    if (fallbackByokText) {
      choose.mutate({ texto: fallbackByokText, segunda: "anthropic" });
    } else if (e.escolha.segunda === "kie") {
      choose.mutate({ segunda: "anthropic" });
    }
  }

  return (
    <div className="grid max-w-[640px] gap-6">
      <p className="m-0 max-w-[60ch] text-apoio">{tr(
        "Cada veículo pode pagar a IA com as próprias chaves. A chave do veículo vem primeiro; sem ela, vale a do servidor. Ela fica guardada cifrada e não aparece de novo.",
        "Each outlet can pay for AI with its own keys. The outlet's key comes first; without it, the server's applies. It is stored encrypted and is not shown again.",
      )}</p>

      <section aria-labelledby={usageTitle} className="grid gap-2">
        <h2 id={usageTitle} className="m-0 text-[22px]">{tr("Em uso agora", "In use now")}</h2>
        <ul className="m-0 grid list-none p-0">
          {usages.map(([role, fn, usage, off]) => (
            <li key={role} className="grid gap-0.5 border-t border-fio py-2 sm:grid-cols-[180px_1fr]">
              <b className="text-texto-forte">{fn}</b>
              {usage ? <span>{displayName(role, usage.provedor)}, {withWho(usage.origem)}</span> : <span className="text-terracota">{off}</span>}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby={modeTitle} className="grid gap-3">
        <div className="grid gap-1">
          <h2 id={modeTitle} className="m-0 text-[22px]">{tr("Como configurar a IA", "How to configure AI")}</h2>
          <p className="ajuda m-0">{tr(
            "Escolha entre uma assinatura única na Kie.ai para tudo ou chaves separadas de cada provedor (BYOK). Nada muda até você confirmar.",
            "Choose between one Kie.ai subscription for everything or separate keys from each provider (BYOK). Nothing changes until you confirm.",
          )}</p>
        </div>

        <fieldset className="m-0 grid gap-2 border-0 p-0">
          <legend className="sr-only">{tr("Modo das chaves de IA", "AI key mode")}</legend>

          <div className={`grid gap-2 rounded-btn p-3 shadow-curta ${mode === "kie" ? "bg-papel-2" : "bg-papel"}`}>
            <label className="flex cursor-pointer items-start gap-3">
              <input type="radio" name="modo-ia" value="kie" checked={mode === "kie"} onChange={() => { choose.reset(); setPickedMode("kie"); }} className="mt-1 size-[18px] accent-texto-forte" />
              <span className="grid gap-0.5">
                <b className="text-texto-forte">
                  {tr("Uma chave só para tudo (Kie.ai)", "One key for everything (Kie.ai)")}
                  {allKie && <span className="mono ml-2 text-[13px] font-normal text-verde">{tr("em uso", "active")}</span>}
                </b>
                <span className="text-[15px] text-apoio">{tr(
                  "Texto (Gemini Flash), segunda opinião (Claude) e ilustração (Grok Imagine) em uma conta só.",
                  "Text (Gemini Flash), second opinion (Claude) and illustrations (Grok Imagine) in one account.",
                )}</span>
              </span>
            </label>
            <p className="ajuda m-0 pl-[30px]">
              <a className="link-acao" href={kieLink.url} target="_blank" rel="noreferrer">{tr("Assinar a Kie.ai", "Subscribe on Kie.ai")}</a>
              {kieLink.afiliado && <span className="mono text-apoio"> · {tr("link de afiliado", "affiliate link")}</span>}
            </p>
          </div>

          <label className={`flex cursor-pointer items-start gap-3 rounded-btn p-3 shadow-curta ${mode === "byok" ? "bg-papel-2" : "bg-papel"}`}>
            <input type="radio" name="modo-ia" value="byok" checked={mode === "byok"} onChange={() => { choose.reset(); setPickedMode("byok"); }} className="mt-1 size-[18px] accent-texto-forte" />
            <span className="grid gap-0.5">
              <b className="text-texto-forte">
                {tr("Chaves separadas (BYOK)", "Separate keys (BYOK)")}
                {!allKie && <span className="mono ml-2 text-[13px] font-normal text-verde">{tr("em uso", "active")}</span>}
              </b>
              <span className="text-[15px] text-apoio">{tr(
                "Escolha e pague DeepSeek, Gemini, Anthropic, Kie ou fal separadamente.",
                "Pick and pay DeepSeek, Gemini, Anthropic, Kie or fal separately.",
              )}</span>
            </span>
          </label>
        </fieldset>
      </section>

      {mode === "kie" ? (
        <section aria-labelledby={kieTitle} className="grid gap-3">
          <div className="grid gap-1">
            <h2 id={kieTitle} className="m-0 text-[22px]">{tr("Kie.ai para tudo", "Kie.ai for everything")}</h2>
            <p className="ajuda m-0">{tr(
              "Assine a Kie.ai, cole a sua chave abaixo e clique para ativar. Você pode voltar para chaves separadas quando quiser.",
              "Subscribe on Kie.ai, paste your key below and click to activate. You can switch back to separate keys anytime.",
            )}</p>
          </div>

          <div className="grid gap-3 rounded-btn bg-papel p-4 shadow-curta">
            <div className="flex flex-wrap items-center gap-3">
              <a
                className={hasKieKey ? "btn-sec bg-papel-2 no-underline" : "btn-tinta no-underline"}
                href={kieLink.url}
                target="_blank"
                rel="noreferrer"
              >
                {tr("Assinar a Kie.ai", "Subscribe on Kie.ai")}
              </a>
              <a className="link-acao text-[15px]" href={PROVIDERS.kie.link} target="_blank" rel="noreferrer">
                {tr("Já tem conta? Abrir chaves da API", "Already subscribed? Open API keys")}
              </a>
            </div>
            {kieLink.afiliado && (
              <p className="mono m-0 text-[13px] text-apoio">
                {tr("Link de afiliado — ajuda a manter o Gazzpush open source, sem custo extra para você.", "Affiliate link — helps fund open-source Gazzpush, at no extra cost to you.")}
              </p>
            )}
          </div>

          <ul className="m-0 grid list-none gap-2 p-0">
            <ItemKey
              veiculo={outlet.id}
              p="kie"
              linha={kieLine}
              guardar={save}
              descricao={tr(
                "Uma chave para texto (Gemini Flash), segunda opinião (Claude) e ilustração (Grok Imagine).",
                "One key for text (Gemini Flash), second opinion (Claude) and illustrations (Grok Imagine).",
              )}
            />
          </ul>

          <div className="flex flex-wrap items-center gap-3">
            {allKie ? (
              <>
                <p role="status" className="m-0 text-[15px] text-verde">
                  {tr("Kie.ai está ativa para texto, segunda opinião e ilustração.", "Kie.ai is active for text, second opinion and illustrations.")}
                </p>
                <button type="button" className="btn-sec bg-papel-2" disabled={choose.isPending} onClick={switchBackToByok}>
                  {tr("Voltar para chaves separadas (BYOK)", "Switch back to separate keys (BYOK)")}
                </button>
              </>
            ) : (
              <button
                type="button"
                className={hasKieKey ? "btn-tinta" : "btn-sec bg-papel-2"}
                disabled={choose.isPending}
                onClick={() => choose.mutate({ texto: "kie", segunda: "kie", imagem: "kie" })}
              >
                {choose.isPending ? tr("Ativando…", "Activating…") : tr("Usar Kie.ai para tudo", "Use Kie.ai for everything")}
              </button>
            )}
          </div>
          {choose.isError && <p role="alert" className="faixa-erro m-0">{errorMessage(choose.error, tr("mudar a escolha", "change the choice"))}</p>}
        </section>
      ) : (
        <>
          <Group titulo={tr("Texto", "Text")} ajuda={tr("Redação, conferência, ganchos, ajustes e perguntas ao documento.", "Writing, checks, hooks, edits and questions to documents.")}
            opcoes={PROVIDERS_TEXT_BYOK} escolhido={e.escolha.texto} nome="provedor-texto" ocupado={choose.isPending}
            escolher={(p) => choose.mutate({ texto: p })}>
            {e.escolha.texto === "kie" && (
              <li className="rounded-btn bg-papel-2 px-3 py-2 text-[15px] text-apoio">
                {tr("O texto está usando Kie.ai. Escolha DeepSeek ou Gemini acima para trocar para chave separada.", "Text is currently using Kie.ai. Pick DeepSeek or Gemini above to switch to a separate key.")}
              </li>
            )}
            {PROVIDERS_TEXT_BYOK.map((p) => <ItemKey key={p} veiculo={outlet.id} p={p} linha={line(p)} guardar={save} />)}
          </Group>

          <Group titulo={tr("Segunda opinião", "Second opinion")} ajuda={tr("Uma segunda IA, de outra empresa, nos parágrafos com risco.", "A second AI, from another company, on risky paragraphs.")}>
            {e.escolha.segunda === "kie" && (
              <li className="flex flex-wrap items-center justify-between gap-2 rounded-btn bg-papel-2 px-3 py-2 text-[15px] text-apoio">
                <span>{tr("A segunda opinião está usando Kie.ai (Claude).", "Second opinion is currently using Kie.ai (Claude).")}</span>
                <button type="button" className="btn-sec bg-papel" disabled={choose.isPending} onClick={() => choose.mutate({ segunda: "anthropic" })}>
                  {tr("Usar Anthropic (BYOK)", "Use Anthropic (BYOK)")}
                </button>
              </li>
            )}
            <ItemKey veiculo={outlet.id} p="anthropic" linha={line("anthropic")} guardar={save} />
          </Group>

          <Group titulo={tr("Ilustração", "Illustration")} ajuda={tr("A imagem do post, no estilo da marca. As duas usam o mesmo modelo de imagem.", "The post's image, in the brand's style. Both use the same image model.")}
            opcoes={PROVIDERS_IMAGE} escolhido={e.escolha.imagem} nome="provedor-imagem" ocupado={choose.isPending}
            escolher={(p) => choose.mutate({ imagem: p })}>
            {PROVIDERS_IMAGE.map((p) => <ItemKey key={p} veiculo={outlet.id} p={p} linha={line(p)} guardar={save} />)}
          </Group>

          {choose.isError && <p role="alert" className="faixa-erro m-0">{errorMessage(choose.error, tr("mudar a escolha", "change the choice"))}</p>}
        </>
      )}
    </div>
  );
}

function Group({ titulo: title, ajuda: help, opcoes: options, escolhido: chosen, nome: displayName, ocupado: busy, escolher: choose, children }: {
  titulo: string; ajuda: string; children: ReactNode;
  opcoes?: readonly Provider[]; escolhido?: Provider; nome?: string; ocupado?: boolean; escolher?: (p: Provider) => void;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="grid gap-3">
      <div className="grid gap-1">
        <h2 id={id} className="m-0 text-[22px]">{title}</h2>
        <p className="ajuda m-0">{help}</p>
      </div>
      {options && choose && (
        <fieldset className="m-0 grid gap-1 border-0 p-0">
          <legend className="mb-1 p-0 text-[15px] font-bold text-texto-forte">{tr("Quem faz", "Who does it")}</legend>
          {options.map((p) => (
            <label key={p} className={`flex cursor-pointer items-start gap-3 rounded-btn px-3 py-2 ${chosen === p ? "bg-papel-2" : "hover:bg-papel-2/60"}`}>
              <input type="radio" name={displayName} value={p} checked={chosen === p} disabled={busy} onChange={() => choose(p)} className="mt-1 size-[18px] accent-texto-forte" />
              <b className="text-texto-forte">{PROVIDERS[p].nome}</b>
            </label>
          ))}
        </fieldset>
      )}
      <ul className="m-0 grid list-none gap-2 p-0">{children}</ul>
    </section>
  );
}

function ItemKey({ veiculo: outlet, p, linha: line, guardar: store, descricao }: {
  veiculo: string; p: Provider; linha: State["provedores"][number]; guardar: (e: State) => void; descricao?: string;
}) {
  const param = { tenantId: outlet, provedor: p };
  const [value, setValue] = useState("");
  const save = useMutation({
    mutationFn: (key: string) => read(t["chaves-ia"][":provedor"].$put({ param }, bodyJson({ chave: key }))),
    onSuccess: (e) => { setValue(""); store(e); },
  });
  const remove = useMutation({ mutationFn: () => read(t["chaves-ia"][":provedor"].$delete({ param })), onSuccess: store });
  const name = PROVIDERS[p].nome;
  const link = fromKeyLink(p);
  const status = line.veiculo
    ? tr(`chave do veículo terminando em ••••${line.veiculo.final} · salva em ${dateOf(line.veiculo.salvaEm)}`, `publication's key ending in ••••${line.veiculo.final} · saved on ${dateOf(line.veiculo.salvaEm)}`)
    : line.servidor ? tr("chave do servidor", "server's key") : tr("sem chave", "no key");
  function send(ev: FormEvent) {
    ev.preventDefault();
    const v = value.trim();
    if (v) { remove.reset(); save.mutate(v); }
  }
  return (
    <li className="grid gap-2 rounded-btn bg-papel p-3 shadow-curta" aria-label={name}>
      <span className="grid gap-0.5">
        <b className="text-texto-forte">{name}</b>
        <span className="text-[15px]">{descricao ?? DOES(p)}</span>
        <span className={`mono ${line.veiculo ? "text-verde" : "text-apoio"}`}>{status}</span>
      </span>
      <form onSubmit={send} aria-label={tr(`Chave do ${name}`, `${name} key`)} className="flex flex-wrap items-end gap-2">
        <label className="campo min-w-[220px] flex-1">
          <span>{line.veiculo ? tr("Trocar a chave", "Replace the key") : tr("Colar a chave", "Paste the key")}</span>
          <input className="entrada" type="password" value={value} onChange={(ev) => setValue(ev.target.value)} required autoComplete="off" spellCheck={false} enterKeyHint="done" maxLength={400} />
        </label>
        <button type="submit" className="btn-sec bg-papel-2" disabled={save.isPending}>{save.isPending ? tr("Conferindo…", "Checking…") : tr("Salvar", "Save")}<span className="sr-only"> {name}</span></button>
        {line.veiculo && (
          <button type="button" className="btn-sec" disabled={remove.isPending} onClick={() => { save.reset(); remove.mutate(); }}>
            {remove.isPending ? "…" : tr("Remover", "Remove")}<span className="sr-only"> {name}</span>
          </button>
        )}
      </form>
      <p className="ajuda m-0">
        <a className="link-acao" href={link.url} target="_blank" rel="noreferrer">{tr(`Pegar a chave no site do ${name}`, `Get the key on the ${name} site`)}</a>
        {link.afiliado && <span className="mono text-apoio"> · {tr("link de afiliado", "affiliate link")}</span>}
      </p>
      {save.isSuccess && !save.isPending && <p role="status" className="m-0 text-[15px] text-verde">{tr(`Chave do ${name} aceita e salva.`, `${name} key accepted and saved.`)}</p>}
      {save.isError && <p role="alert" className="faixa-erro m-0">{errorMessage(save.error, tr("salvar a chave", "save the key"))}</p>}
      {remove.isError && <p role="alert" className="faixa-erro m-0">{errorMessage(remove.error, tr("remover a chave", "remove the key"))}</p>}
    </li>
  );
}
