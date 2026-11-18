// Aba Chaves de IA, só admin: o veículo cola as chaves dos provedores de IA e escolhe quem escreve o texto e quem desenha a
// ilustração. A chave vai só no corpo do PUT; a API confere com o provedor, guarda cifrada e nunca a devolve (a tela vê os 4
// últimos caracteres). Sem a chave do veículo vale a do servidor; sem nenhuma, a função fica desligada e a tela diz.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { linkDaChave, PROVEDORES, PROVEDORES_IMAGEM, PROVEDORES_TEXTO, type Provedor } from "../../../../src/lib/provedoresTabela";
import { corpoJson, ErroApi, ler, type Sucesso } from "../../api";
import { FalhaCarga } from "../../comum";
import { idioma, t as tr } from "../../idioma";
import type { Veiculo } from "../../sessao";
import { Carga, mensagemAcao, t } from "./comum";

type Estado = Sucesso<Awaited<ReturnType<(typeof t)["chaves-ia"]["$get"]>>>;
type Origem = "veiculo" | "servidor";

const FAZ = (p: Provedor) => ({
  deepseek: tr("Escreve os posts e confere os textos.", "Writes the posts and checks the texts."),
  gemini: tr("Escreve os posts e confere os textos, no lugar do DeepSeek.", "Writes the posts and checks the texts, instead of DeepSeek."),
  anthropic: tr("Dá a segunda opinião em risco jurídico e confere sozinho o texto de tema sensível.", "Gives the second opinion on legal risk and checks sensitive topics on its own."),
  kie: tr("Desenha a ilustração dos posts.", "Draws the posts' illustration."),
  fal: tr("Desenha a ilustração dos posts, no lugar da Kie.", "Draws the posts' illustration, instead of Kie."),
})[p];
const dataDe = (s: string) => new Date(`${s.replace(" ", "T")}Z`).toLocaleDateString(idioma(), { day: "numeric", month: "long", timeZone: "America/Sao_Paulo" });
const comQuem = (o: Origem) => (o === "veiculo" ? tr("com a chave do veículo", "with the publication's key") : tr("com a chave do servidor", "with the server's key"));

/** Erro da API em linguagem de leigo (a API já manda assim); sem conexão ou outro erro, a mensagem comum das abas. */
const mensagemErro = (e: unknown, oque: string) => (e instanceof ErroApi && [400, 409, 422, 502].includes(e.status) ? e.message : mensagemAcao(e, oque));

export default function Chaves({ veiculo, admin }: { veiculo: Veiculo; admin: boolean }) {
  const param = { tenantId: veiculo.id };
  const qc = useQueryClient();
  const chave = [veiculo.id, "chaves-ia"];
  const estado = useQuery({ queryKey: chave, enabled: admin, queryFn: () => ler(t["chaves-ia"].$get({ param })) });
  const guardar = (e: Estado) => qc.setQueryData(chave, e);
  const escolher = useMutation({
    mutationFn: (b: { texto?: string; imagem?: string }) => ler(t["chaves-ia"].$patch({ param }, corpoJson(b))),
    onSuccess: guardar,
  });
  const tituloUso = useId();

  if (!admin) return <p className="m-0 max-w-[60ch]">{tr("Só o admin do veículo vê as chaves de IA.", "Only the outlet's admin sees the AI keys.")}</p>;
  if (estado.isPending) return <Carga oque={tr("as chaves de IA", "the AI keys")} />;
  if (estado.isError) return <FalhaCarga oque={tr("as chaves de IA", "the AI keys")} tentar={() => estado.refetch()} />;

  const e = estado.data;
  const linha = (p: Provedor) => e.provedores.find((x) => x.id === p)!;
  const usos: [string, { provedor: Provedor; origem: Origem } | null, string][] = [
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

      <section aria-labelledby={tituloUso} className="grid gap-2">
        <h2 id={tituloUso} className="m-0 text-[22px]">{tr("Em uso agora", "In use now")}</h2>
        <ul className="m-0 grid list-none p-0">
          {usos.map(([funcao, uso, desligado]) => (
            <li key={funcao} className="grid gap-0.5 border-t border-fio py-2 sm:grid-cols-[180px_1fr]">
              <b className="text-texto-forte">{funcao}</b>
              {uso ? <span>{PROVEDORES[uso.provedor].nome}, {comQuem(uso.origem)}</span> : <span className="text-terracota">{desligado}</span>}
            </li>
          ))}
        </ul>
      </section>

      <Grupo titulo={tr("Texto", "Text")} ajuda={tr("Redação, conferência, ganchos, ajustes e perguntas ao documento.", "Writing, checks, hooks, edits and questions to documents.")}
        opcoes={PROVEDORES_TEXTO} escolhido={e.escolha.texto} nome="provedor-texto" ocupado={escolher.isPending}
        escolher={(p) => escolher.mutate({ texto: p })}>
        {PROVEDORES_TEXTO.map((p) => <ItemChave key={p} veiculo={veiculo.id} p={p} linha={linha(p)} guardar={guardar} />)}
      </Grupo>
      <Grupo titulo={tr("Segunda opinião", "Second opinion")} ajuda={tr("Uma segunda IA, de outra empresa, nos parágrafos com risco.", "A second AI, from another company, on risky paragraphs.")}>
        <ItemChave veiculo={veiculo.id} p="anthropic" linha={linha("anthropic")} guardar={guardar} />
      </Grupo>
      <Grupo titulo={tr("Ilustração", "Illustration")} ajuda={tr("A imagem do post, no estilo da marca. As duas usam o mesmo modelo de imagem.", "The post's image, in the brand's style. Both use the same image model.")}
        opcoes={PROVEDORES_IMAGEM} escolhido={e.escolha.imagem} nome="provedor-imagem" ocupado={escolher.isPending}
        escolher={(p) => escolher.mutate({ imagem: p })}>
        {PROVEDORES_IMAGEM.map((p) => <ItemChave key={p} veiculo={veiculo.id} p={p} linha={linha(p)} guardar={guardar} />)}
      </Grupo>
      {escolher.isError && <p role="alert" className="faixa-erro m-0">{mensagemErro(escolher.error, tr("mudar a escolha", "change the choice"))}</p>}
    </div>
  );
}

function Grupo({ titulo, ajuda, opcoes, escolhido, nome, ocupado, escolher, children }: {
  titulo: string; ajuda: string; children: ReactNode;
  opcoes?: readonly Provedor[]; escolhido?: Provedor; nome?: string; ocupado?: boolean; escolher?: (p: Provedor) => void;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="grid gap-3">
      <div className="grid gap-1">
        <h2 id={id} className="m-0 text-[22px]">{titulo}</h2>
        <p className="ajuda m-0">{ajuda}</p>
      </div>
      {opcoes && escolher && (
        <fieldset className="m-0 grid gap-1 border-0 p-0">
          <legend className="mb-1 p-0 text-[15px] font-bold text-texto-forte">{tr("Quem faz", "Who does it")}</legend>
          {opcoes.map((p) => (
            <label key={p} className={`flex cursor-pointer items-start gap-3 rounded-btn px-3 py-2 ${escolhido === p ? "bg-papel-2" : "hover:bg-papel-2/60"}`}>
              <input type="radio" name={nome} value={p} checked={escolhido === p} disabled={ocupado} onChange={() => escolher(p)} className="mt-1 size-[18px] accent-texto-forte" />
              <b className="text-texto-forte">{PROVEDORES[p].nome}</b>
            </label>
          ))}
        </fieldset>
      )}
      <ul className="m-0 grid list-none gap-2 p-0">{children}</ul>
    </section>
  );
}

function ItemChave({ veiculo, p, linha, guardar }: { veiculo: string; p: Provedor; linha: Estado["provedores"][number]; guardar: (e: Estado) => void }) {
  const param = { tenantId: veiculo, provedor: p };
  const [valor, setValor] = useState("");
  const salvar = useMutation({
    mutationFn: (chave: string) => ler(t["chaves-ia"][":provedor"].$put({ param }, corpoJson({ chave }))),
    onSuccess: (e) => { setValor(""); guardar(e); },
  });
  const remover = useMutation({ mutationFn: () => ler(t["chaves-ia"][":provedor"].$delete({ param })), onSuccess: guardar });
  const nome = PROVEDORES[p].nome;
  const link = linkDaChave(p);
  const situacao = linha.veiculo
    ? tr(`chave do veículo terminando em ••••${linha.veiculo.final} · salva em ${dataDe(linha.veiculo.salvaEm)}`, `publication's key ending in ••••${linha.veiculo.final} · saved on ${dataDe(linha.veiculo.salvaEm)}`)
    : linha.servidor ? tr("chave do servidor", "server's key") : tr("sem chave", "no key");
  function enviar(ev: FormEvent) {
    ev.preventDefault();
    const v = valor.trim();
    if (v) { remover.reset(); salvar.mutate(v); }
  }
  return (
    <li className="grid gap-2 rounded-btn bg-papel p-3 shadow-curta" aria-label={nome}>
      <span className="grid gap-0.5">
        <b className="text-texto-forte">{nome}</b>
        <span className="text-[15px]">{FAZ(p)}</span>
        <span className={`mono ${linha.veiculo ? "text-verde" : "text-apoio"}`}>{situacao}</span>
      </span>
      <form onSubmit={enviar} aria-label={tr(`Chave do ${nome}`, `${nome} key`)} className="flex flex-wrap items-end gap-2">
        <label className="campo min-w-[220px] flex-1">
          <span>{linha.veiculo ? tr("Trocar a chave", "Replace the key") : tr("Colar a chave", "Paste the key")}</span>
          <input className="entrada" type="password" value={valor} onChange={(ev) => setValor(ev.target.value)} required autoComplete="off" spellCheck={false} enterKeyHint="done" maxLength={400} />
        </label>
        <button type="submit" className="btn-sec bg-papel-2" disabled={salvar.isPending}>{salvar.isPending ? tr("Conferindo…", "Checking…") : tr("Salvar", "Save")}<span className="sr-only"> {nome}</span></button>
        {linha.veiculo && (
          <button type="button" className="btn-sec" disabled={remover.isPending} onClick={() => { salvar.reset(); remover.mutate(); }}>
            {remover.isPending ? "…" : tr("Remover", "Remove")}<span className="sr-only"> {nome}</span>
          </button>
        )}
      </form>
      <p className="ajuda m-0">
        <a className="link-acao" href={link.url} target="_blank" rel="noreferrer">{tr(`Pegar a chave no site do ${nome}`, `Get the key on the ${nome} site`)}</a>
        {link.afiliado && <span className="mono text-apoio"> · {tr("link de afiliado", "affiliate link")}</span>}
      </p>
      {salvar.isSuccess && !salvar.isPending && <p role="status" className="m-0 text-[15px] text-verde">{tr(`Chave do ${nome} aceita e salva.`, `${nome} key accepted and saved.`)}</p>}
      {salvar.isError && <p role="alert" className="faixa-erro m-0">{mensagemErro(salvar.error, tr("salvar a chave", "save the key"))}</p>}
      {remover.isError && <p role="alert" className="faixa-erro m-0">{mensagemErro(remover.error, tr("remover a chave", "remove the key"))}</p>}
    </li>
  );
}
