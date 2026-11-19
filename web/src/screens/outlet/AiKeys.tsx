// The AI keys tab, admins only: the outlet pastes the AI providers' keys and chooses who writes the text and who draws
// the illustration. The key goes only in the PUT body; the API checks it with the provider, stores it encrypted and
// never returns it (the screen sees the last 4 characters). Without the outlet's key the server's applies; without
// either, the feature is off and the screen says so.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { fromKeyLink, PROVIDERS, PROVIDERS_IMAGE, PROVIDERS_TEXT, type Provider } from "../../../../src/lib/providersTable";
import { bodyJson, ApiError, read, type Success } from "../../api";
import { FailureLoad } from "../../common";
import { language, t as tr } from "../../language";
import type { Outlet } from "../../session";
import { Load, actionMessage, t } from "./common";

type State = Success<Awaited<ReturnType<(typeof t)["chaves-ia"]["$get"]>>>;
type Origin = "veiculo" | "servidor";

const DOES = (p: Provider) => ({
  deepseek: tr("Escreve os posts e confere os textos.", "Writes the posts and checks the texts."),
  gemini: tr("Escreve os posts e confere os textos, no lugar do DeepSeek.", "Writes the posts and checks the texts, instead of DeepSeek."),
  anthropic: tr("Dá a segunda opinião em risco jurídico e confere sozinho o texto de tema sensível.", "Gives the second opinion on legal risk and checks sensitive topics on its own."),
  kie: tr("Desenha a ilustração dos posts.", "Draws the posts' illustration."),
  fal: tr("Desenha a ilustração dos posts, no lugar da Kie.", "Draws the posts' illustration, instead of Kie."),
})[p];
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
    mutationFn: (b: { texto?: string; imagem?: string }) => read(t["chaves-ia"].$patch({ param }, bodyJson(b))),
    onSuccess: save,
  });
  const usageTitle = useId();

  if (!admin) return <p className="m-0 max-w-[60ch]">{tr("Só o admin do veículo vê as chaves de IA.", "Only the outlet's admin sees the AI keys.")}</p>;
  if (state.isPending) return <Load oque={tr("as chaves de IA", "the AI keys")} />;
  if (state.isError) return <FailureLoad oque={tr("as chaves de IA", "the AI keys")} tentar={() => state.refetch()} />;

  const e = state.data;
  const line = (p: Provider) => e.provedores.find((x) => x.id === p)!;
  const usages: [string, { provedor: Provider; origem: Origin } | null, string][] = [
    [tr("Texto", "Text"), e.emUso.texto, tr("desligado: sem chave, não sai post nem conferência", "off: with no key, no posts or checks")],
    [tr("Segunda opinião", "Second opinion"), e.emUso.segunda, tr("desligada: a conferência tem uma opinião só", "off: the check has only one opinion")],
    [tr("Ilustração", "Illustration"), e.emUso.imagem, tr("desligada: o post sai com a ilustração simples", "off: the post gets the simple illustration")],
  ];

  return (
    <div className="grid max-w-[640px] gap-6">
      <p className="m-0 max-w-[60ch] text-apoio">{tr(
        "Cada veículo pode pagar a IA com as próprias chaves. A chave do veículo vem primeiro; sem ela, vale a do servidor. Ela fica guardada cifrada e não aparece de novo.",
        "Each outlet can pay for AI with its own keys. The outlet's key comes first; without it, the server's applies. It is stored encrypted and is not shown again.",
      )}</p>

      <section aria-labelledby={usageTitle} className="grid gap-2">
        <h2 id={usageTitle} className="m-0 text-[22px]">{tr("Em uso agora", "In use now")}</h2>
        <ul className="m-0 grid list-none p-0">
          {usages.map(([fn, usage, off]) => (
            <li key={fn} className="grid gap-0.5 border-t border-fio py-2 sm:grid-cols-[180px_1fr]">
              <b className="text-texto-forte">{fn}</b>
              {usage ? <span>{PROVIDERS[usage.provedor].nome}, {withWho(usage.origem)}</span> : <span className="text-terracota">{off}</span>}
            </li>
          ))}
        </ul>
      </section>

      <Group titulo={tr("Texto", "Text")} ajuda={tr("Redação, conferência, ganchos, ajustes e perguntas ao documento.", "Writing, checks, hooks, edits and questions to documents.")}
        opcoes={PROVIDERS_TEXT} escolhido={e.escolha.texto} nome="provedor-texto" ocupado={choose.isPending}
        escolher={(p) => choose.mutate({ texto: p })}>
        {PROVIDERS_TEXT.map((p) => <ItemKey key={p} veiculo={outlet.id} p={p} linha={line(p)} guardar={save} />)}
      </Group>
      <Group titulo={tr("Segunda opinião", "Second opinion")} ajuda={tr("Uma segunda IA, de outra empresa, nos parágrafos com risco.", "A second AI, from another company, on risky paragraphs.")}>
        <ItemKey veiculo={outlet.id} p="anthropic" linha={line("anthropic")} guardar={save} />
      </Group>
      <Group titulo={tr("Ilustração", "Illustration")} ajuda={tr("A imagem do post, no estilo da marca. As duas usam o mesmo modelo de imagem.", "The post's image, in the brand's style. Both use the same image model.")}
        opcoes={PROVIDERS_IMAGE} escolhido={e.escolha.imagem} nome="provedor-imagem" ocupado={choose.isPending}
        escolher={(p) => choose.mutate({ imagem: p })}>
        {PROVIDERS_IMAGE.map((p) => <ItemKey key={p} veiculo={outlet.id} p={p} linha={line(p)} guardar={save} />)}
      </Group>
      {choose.isError && <p role="alert" className="faixa-erro m-0">{errorMessage(choose.error, tr("mudar a escolha", "change the choice"))}</p>}
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

function ItemKey({ veiculo: outlet, p, linha: line, guardar: store }: { veiculo: string; p: Provider; linha: State["provedores"][number]; guardar: (e: State) => void }) {
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
        <span className="text-[15px]">{DOES(p)}</span>
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
