// Aba Equipe da tela do veículo (carregada só quando abre: fora do orçamento da Marca).
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { corpoJson, ErroApi, ler } from "../../api";
import { papel as nomePapel } from "../../casca/contexto";
import { FalhaCarga } from "../../comum";
import { chaves, useMembros } from "../../fila";
import { t as tr } from "../../idioma";
import type { Veiculo as Veic } from "../../sessao";
import { Carga, mensagemAcao, t } from "./comum";

type Convite = { id: string; email: string; papel: string; link: string };

export default function Equipe({ veiculo, admin }: { veiculo: Veic; admin: boolean }) {
  const qc = useQueryClient();
  const equipe = useMembros(veiculo.id);
  const [email, setEmail] = useState("");
  const [papel, setPapel] = useState<"editor" | "reporter">("editor");
  const recarregar = () => qc.invalidateQueries({ queryKey: chaves.membros(veiculo.id) });
  const convidar = useMutation({
    mutationFn: () => ler(t.convites.$post({ param: { tenantId: veiculo.id } }, corpoJson({ email, papel }))),
    onSuccess: () => { setEmail(""); recarregar(); },
  });
  const cancelar = useMutation({
    mutationFn: (id: string) => ler(t.convites[":id"].$delete({ param: { tenantId: veiculo.id, id } })),
    onSuccess: recarregar,
  });
  if (equipe.isPending) return <Carga oque={tr("a equipe", "the team")} />;
  if (equipe.isError) return <FalhaCarga oque={tr("a equipe", "the team")} tentar={() => equipe.refetch()} />;
  const erroConvidar = (e: unknown) => {
    if (e instanceof ErroApi && e.status === 409) return tr(`Essa pessoa ${e.message}.`, `This person ${e.message}.`);
    if (e instanceof ErroApi && e.status === 400) return e.message.startsWith("email") ? tr("Esse e-mail não parece válido.", "That email doesn't look valid.") : e.message;
    return mensagemAcao(e, tr("convidar", "send the invite"));
  };
  const { membros, convites } = equipe.data;
  const feito = convidar.data;
  return (
    <section aria-labelledby="equipe-titulo" className="grid max-w-[640px] gap-5">
      <div className="grid gap-1">
        <h2 id="equipe-titulo" className="m-0 text-[22px]">{tr("Quem trabalha aqui", "Who works here")}</h2>
        <p className="m-0 max-w-[52ch] text-apoio">{tr("Admin altera tudo; editor aprova e posta; repórter traz ideias.", "Admin changes everything; editor approves and posts; reporter brings ideas.")}</p>
      </div>
      <ul className="m-0 grid list-none gap-2 p-0">
        {membros.map((m) => (
          <li key={m.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-btn bg-papel p-3 shadow-curta">
            <b className="text-texto-forte">{m.nome}</b>
            <span className="mono text-apoio">{nomePapel(m.papel)}</span>
            <span className="mono ml-auto truncate text-apoio">{m.email}</span>
          </li>
        ))}
      </ul>
      {admin && convites.length > 0 && (
        <section aria-labelledby="convites-titulo" className="grid gap-2">
          <h3 id="convites-titulo" className="m-0 text-[17px]">{tr("Convites pendentes", "Pending invites")}</h3>
          <p className="m-0 text-[14px] text-apoio">{tr("Não mandamos e-mail: copie o link e mande por onde preferir. Vale quando a pessoa criar a conta com esse e-mail.", "We don't send email: copy the link and send it however you like. It works once the person creates an account with that email.")}</p>
          <ul className="m-0 grid list-none gap-2 p-0">
            {convites.map((cv) => <ItemConvite key={cv.id} cv={cv} ocupado={cancelar.isPending && cancelar.variables === cv.id} cancelar={() => cancelar.mutate(cv.id)} />)}
          </ul>
          {cancelar.isError && <p role="alert" className="faixa-erro m-0">{mensagemAcao(cancelar.error, tr("cancelar o convite", "cancel the invite"))}</p>}
        </section>
      )}
      {feito && (
        <p role="status" className="m-0 text-[15px] text-verde">
          {feito.membro
            ? tr(`${feito.membro.nome} já tinha conta e entrou como ${nomePapel(feito.membro.papel)}.`, `${feito.membro.nome} already had an account and joined as ${nomePapel(feito.membro.papel)}.`)
            : tr("Convite criado: copie o link em \"Convites pendentes\" e mande para a pessoa.", "Invite created: copy the link under \"Pending invites\" and send it to the person.")}
        </p>
      )}
      {admin && (
        <form onSubmit={(e) => { e.preventDefault(); convidar.mutate(); }} aria-labelledby="convidar-titulo" className="grid gap-4 rounded-btn bg-papel p-4 shadow-curta">
          <h3 id="convidar-titulo" className="m-0 text-[17px]">{tr("Convidar", "Invite")}</h3>
          <p className="m-0 -mt-2 text-[14px] text-apoio">{tr("Quem já tem conta entra na hora. Quem não tem ganha um link, que você manda.", "People who already have an account join right away. People who don't get a link, which you send them.")}</p>
          <label className="campo">
            <span>{tr("E-mail", "Email")}</span>
            <input className="entrada" type="email" value={email} onChange={(e) => setEmail(e.target.value.trim())} required inputMode="email" autoComplete="off"
              autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="done" />
          </label>
          <fieldset className="m-0 grid gap-1 border-0 p-0">
            <legend className="mb-1 p-0 text-[15px] font-bold text-texto-forte">{tr("Papel", "Role")}</legend>
            {([["editor", tr("Editor", "Editor"), tr("Aprova, reescreve, rejeita e posta.", "Approves, rewrites, rejects and posts.")], ["reporter", tr("Repórter", "Reporter"), tr("Só traz ideias (link, texto, print).", "Only brings ideas (link, text, screenshot).")]] as const).map(([v, r, ajuda]) => (
              <label key={v} className={`flex cursor-pointer items-start gap-3 rounded-btn px-3 py-2 ${papel === v ? "bg-papel-2" : "hover:bg-papel-2/60"}`}>
                <input type="radio" name="papel" value={v} checked={papel === v} onChange={() => setPapel(v)} className="mt-1 size-[18px] accent-texto-forte" />
                <span className="grid"><b className="text-texto-forte">{r}</b><span className="ajuda">{ajuda}</span></span>
              </label>
            ))}
          </fieldset>
          {convidar.isError && <p role="alert" className="faixa-erro m-0">{erroConvidar(convidar.error)}</p>}
          <button type="submit" className="btn-tinta justify-self-start" disabled={convidar.isPending}>{convidar.isPending ? tr("Convidando…", "Inviting…") : tr("Convidar", "Invite")}</button>
        </form>
      )}
    </section>
  );
}

function ItemConvite({ cv, ocupado, cancelar }: { cv: Convite; ocupado: boolean; cancelar: () => void }) {
  const [copiado, setCopiado] = useState(false);
  const link = `${location.origin}${cv.link}`;
  async function copiar() {
    try { await navigator.clipboard.writeText(link); setCopiado(true); setTimeout(() => setCopiado(false), 2000); } catch { /* sem clipboard: o link está à vista */ }
  }
  return (
    <li className="grid gap-1.5 rounded-btn bg-papel p-3 shadow-curta">
      <span className="flex flex-wrap items-baseline gap-x-3">
        <b className="text-texto-forte">{cv.email}</b>
        <span className="mono text-apoio">{nomePapel(cv.papel)}</span>
      </span>
      <span className="mono truncate text-apoio" title={link}>{link}</span>
      <span className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={copiar} className="btn-sec -ml-3 text-[15px]">{copiado ? tr("Copiado", "Copied") : tr("Copiar link", "Copy link")}<span className="sr-only">{tr(` do convite para ${cv.email}`, ` for the invite to ${cv.email}`)}</span></button>
        <button type="button" onClick={cancelar} disabled={ocupado} className="btn-sec ml-auto text-[15px] text-apoio">{tr("Revogar", "Revoke")}<span className="sr-only">{tr(` o convite para ${cv.email}`, ` the invite to ${cv.email}`)}</span></button>
      </span>
    </li>
  );
}
