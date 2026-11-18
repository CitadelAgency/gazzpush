// Bancada do editor (DESIGN.md §5): o que ajuda a escrever e a sair, em partes que abrem uma de cada vez (`?ferramenta=`). Aspas da
// entrevista entram no texto; o apoio também, a pedido da pessoa. Divulgação e segunda leitura só sugerem: nada do modelo entra no
// documento. Versões mostra o texto antigo e restaura.
import { useState, type ReactNode } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { paragrafosDoDoc, type No } from "../../../src/lib/doc";
import { api, ler } from "../api";
import { t } from "../idioma";
import { Parte } from "../kit/Partes";
import { mmss } from "./Gravacoes";
import { mensagem, qtd, rota, type EstadoMesa } from "./comum";

export type Ferramenta = "aspas" | "apoio" | "divulgar" | "leitura" | "versoes";
const semAcento = (x: string) => x.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const quando = (s: string) => new Date(`${s.replace(" ", "T")}Z`).toLocaleString(t("pt-BR", "en"), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

type Props = {
  tenantId: string; textoId: string; estado: EstadoMesa; aberta: string | null; abrir: (f: string | null) => void;
  inserirAspa: (texto: string) => void; inserirApoio: (patrocinio: string, texto: string) => void;
  irParaTrecho: (blocoId: string, inicio: number, fim: number) => void; garantirSalvo: () => Promise<void>;
  restaurar: (doc: unknown, titulo: string) => Promise<void>;
};

export default function Bancada({ tenantId, textoId, estado, aberta, abrir, inserirAspa, inserirApoio, irParaTrecho, garantirSalvo, restaurar }: Props) {
  const prontas = estado.gravacoes.filter((g) => g.estado === "pronto");
  const parte = (id: Ferramenta, rotulo: string, resumo: string, conteudo: ReactNode) => (
    <Parte id={`ferramenta-${id}`} nivel="h2" rotulo={rotulo} resumo={resumo} aberta={aberta === id} alternar={() => abrir(aberta === id ? null : id)}>{conteudo}</Parte>
  );
  return (
    <section aria-label={t("Bancada do texto", "Writing desk")} className="grid grid-cols-[minmax(0,1fr)]">
      {parte("aspas", t("Aspas da entrevista", "Interview quotes"), prontas.length ? t(qtd(prontas.length, "gravação", "gravações"), qtd(prontas.length, "recording", "recordings")) : "",
        <Aspas tenantId={tenantId} textoId={textoId} prontas={prontas} inserir={inserirAspa} />)}
      {parte("apoio", t("Apoio", "Sponsor"), "", <Apoio tenantId={tenantId} inserir={inserirApoio} aberta={aberta === "apoio"} />)}
      {parte("divulgar", t("Divulgar", "Promote"), "", <Divulgar tenantId={tenantId} textoId={textoId} garantirSalvo={garantirSalvo} />)}
      {parte("leitura", t("Segunda leitura", "Second read"), "", <Leitura tenantId={tenantId} textoId={textoId} garantirSalvo={garantirSalvo} irParaTrecho={irParaTrecho} />)}
      {parte("versoes", t("Versões", "Versions"), "", <Versoes tenantId={tenantId} textoId={textoId} aberta={aberta === "versoes"} restaurar={restaurar} />)}
    </section>
  );
}

/** A transcrição ao lado do texto: clicar insere a fala entre aspas, e a conferência a liga ao minuto. Selecionar um pedaço insere só ele. */
function Aspas({ tenantId, textoId, prontas, inserir }: { tenantId: string; textoId: string; prontas: EstadoMesa["gravacoes"]; inserir: (texto: string) => void }) {
  const [busca, setBusca] = useState("");
  const consultas = useQueries({
    queries: prontas.map((g) => ({
      queryKey: [tenantId, "transcricao", g.id],
      staleTime: Infinity,
      queryFn: () => ler(rota.gravacoes[":arquivo"].transcricao.$get({ param: { tenantId, id: textoId, arquivo: g.id } })),
    })),
  });
  if (!prontas.length) return <p className="m-0 text-apoio">{t("Nenhuma gravação transcrita neste texto. Envie ou grave a entrevista no Dossiê, e a fala aparece aqui.", "No transcribed recording in this text. Upload or record the interview in the Dossier and the speech shows up here.")}</p>;
  const b = semAcento(busca.trim());
  const trechos = consultas.flatMap((c, i) => (c.data?.trechos ?? []).map((tr) => ({ ...tr, nome: prontas[i].nome, chave: `${prontas[i].id}:${tr.inicio}` })))
    .filter((tr) => !b || semAcento(tr.texto).includes(b));
  return (
    <div className="grid gap-2">
      <label className="campo">
        <span>{t("Procurar na fala", "Search the speech")}</span>
        <input type="search" className="entrada bg-branco" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </label>
      {consultas.some((c) => c.isPending) && <p role="status" className="mono m-0 text-apoio">{t("carregando…", "loading…")}</p>}
      {consultas.some((c) => c.isError) && <p role="alert" className="faixa-erro m-0">{t("Uma transcrição não carregou.", "A transcript didn't load.")}</p>}
      <p className="ajuda m-0">{t("Selecione um pedaço da fala para inserir só ele.", "Select part of the speech to insert only that.")}</p>
      <ul className="m-0 grid list-none gap-2 p-0">
        {trechos.map((tr) => (
          <li key={tr.chave} className="grid gap-1 border-t border-fio pt-2">
            <span className="mono text-apoio">{mmss(tr.inicio)} · {tr.nome}</span>
            <span className="text-[15px]">{tr.texto}</span>
            {/* O botão não pega o foco ao apertar: a seleção da fala e o cursor do texto ficam onde estavam. */}
            <button type="button" className="btn-sec justify-self-start bg-papel-2" onMouseDown={(e) => e.preventDefault()} onClick={(e) => {
              const s = window.getSelection();
              const pedaco = s && !s.isCollapsed && e.currentTarget.closest("li")?.contains(s.anchorNode) ? s.toString().trim() : "";
              inserir(pedaco || tr.texto.trim());
            }}>{t("Inserir", "Insert")}<span className="sr-only"> {t("a fala de", "the speech at")} {mmss(tr.inicio)}</span></button>
          </li>
        ))}
      </ul>
      {b && !trechos.length && <p className="m-0 text-apoio">{t("Nada com essas palavras na fala.", "Nothing with those words in the speech.")}</p>}
    </div>
  );
}

function Apoio({ tenantId, inserir, aberta }: { tenantId: string; inserir: (patrocinio: string, texto: string) => void; aberta: boolean }) {
  const q = useQuery({ queryKey: [tenantId, "patrocinios"], enabled: aberta, queryFn: () => ler(api.t[":tenantId"].patrocinios.$get({ param: { tenantId } })) });
  if (q.isPending) return <p role="status" className="mono m-0 text-apoio">{t("carregando…", "loading…")}</p>;
  if (q.isError) return <p role="alert" className="faixa-erro m-0">{mensagem(q.error)}</p>;
  const hoje = new Date().toISOString().slice(0, 10);
  const ativos = q.data.patrocinios.filter((p) => p.inicio <= hoje && hoje <= p.fim);
  if (!ativos.length) return <p className="m-0 text-apoio">{t("Nenhum patrocínio no período. Cadastre em Marca, na seção Patrocínios.", "No sponsorship running now. Add one in Brand, under Sponsorships.")}</p>;
  return (
    <ul className="m-0 grid list-none gap-2 p-0">
      {ativos.map((p) => (
        <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
          <b className="text-texto-forte">{p.nome}</b>
          <button type="button" className="btn-sec bg-papel-2" onMouseDown={(e) => e.preventDefault()}
            onClick={() => inserir(p.id, t(`Publicidade. Esta edição tem o apoio de ${p.nome}.`, `Advertisement. This issue is supported by ${p.nome}.`))}>
            {t("Inserir no texto", "Insert in the text")}<span className="sr-only"> {p.nome}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Copiar({ texto, rotulo }: { texto: string; rotulo: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" className="btn-sec bg-papel-2" onClick={() => { void navigator.clipboard.writeText(texto).then(() => setCopiado(true)); }}>{t("Copiar", "Copy")}<span className="sr-only"> {rotulo}</span></button>
      {copiado && <span role="status" className="mono text-verde">{t("copiado", "copied")}</span>}
    </span>
  );
}

function Divulgar({ tenantId, textoId, garantirSalvo }: { tenantId: string; textoId: string; garantirSalvo: () => Promise<void> }) {
  const pedir = useMutation({
    mutationFn: async () => { await garantirSalvo(); return ler(rota.divulgacao.$post({ param: { tenantId, id: textoId } })); },
  });
  const r = pedir.data;
  return (
    <div className="grid gap-3">
      <p className="ajuda m-0">{t("Sai só do que está no texto. Sugestão com número que não está nele é descartada, e nada entra na matéria.", "It comes only from what's in the text. Suggestions with a number that isn't there are dropped, and nothing goes into the story.")}</p>
      <button type="button" className="btn-sec justify-self-start bg-papel-2" disabled={pedir.isPending} onClick={() => pedir.mutate()}>{pedir.isPending ? t("Sugerindo…", "Suggesting…") : r ? t("Sugerir de novo", "Suggest again") : t("Sugerir", "Suggest")}</button>
      {pedir.isError && <p role="alert" className="faixa-erro m-0">{mensagem(pedir.error)}</p>}
      {r && (r.assuntos.length ? (
        <ul aria-label={t("Assuntos do e-mail", "Email subjects")} className="m-0 grid list-none gap-2 p-0">
          {r.assuntos.map((a) => <li key={a} className="grid gap-1 border-t border-fio pt-2"><span className="text-[15px]">{a}</span><Copiar texto={a} rotulo={a} /></li>)}
        </ul>
      ) : <p className="m-0 text-apoio">{t("Nenhum assunto passou na checagem. Tente de novo.", "No subject passed the check. Try again.")}</p>)}
      {r?.mensagem && (
        <div className="grid gap-1 border-t border-fio pt-2">
          <b className="text-[15px] text-texto-forte">{t("Mensagem para WhatsApp", "WhatsApp message")}</b>
          <p className="m-0 whitespace-pre-line text-[15px]">{r.mensagem}</p>
          <Copiar texto={r.mensagem} rotulo={t("a mensagem", "the message")} />
        </div>
      )}
    </div>
  );
}

const TIPO_NOTA = (x: string) => ({ abertura: t("Abertura", "Opening"), pergunta: t("Pergunta sem resposta", "Unanswered question"), sobra: t("Sobra", "Could go"), clareza: t("Clareza", "Clarity") })[x] ?? x;

function Leitura({ tenantId, textoId, garantirSalvo, irParaTrecho }: { tenantId: string; textoId: string; garantirSalvo: () => Promise<void>; irParaTrecho: Props["irParaTrecho"] }) {
  const ler2 = useMutation({
    mutationFn: async () => { await garantirSalvo(); return ler(rota["segunda-leitura"].$post({ param: { tenantId, id: textoId } })); },
  });
  const notas = ler2.data?.notas;
  return (
    <div className="grid gap-3">
      <p className="ajuda m-0">{t("Aponta o que travaria a leitura, sem reescrever nada. Fatos ficam com a conferência.", "It flags what would slow the reader, without rewriting anything. Facts stay with the check.")}</p>
      <button type="button" className="btn-sec justify-self-start bg-papel-2" disabled={ler2.isPending} onClick={() => ler2.mutate()}>{ler2.isPending ? t("Lendo…", "Reading…") : notas ? t("Ler de novo", "Read again") : t("Pedir a leitura", "Ask for a read")}</button>
      {ler2.isError && <p role="alert" className="faixa-erro m-0">{mensagem(ler2.error)}</p>}
      {notas && (notas.length ? (
        <ul className="m-0 grid list-none gap-2 p-0">
          {notas.map((n, i) => (
            <li key={i} className="grid gap-1 border-t border-fio pt-2">
              <b className="text-[15px] text-texto-forte">{TIPO_NOTA(n.tipo)}</b>
              <span className="text-[15px]">{n.nota}</span>
              <button type="button" className="link-acao justify-self-start border-0 bg-transparent p-0 text-left text-[15px]" onClick={() => irParaTrecho(n.blocoId, n.inicio, n.fim)}>“{n.trecho}”</button>
            </li>
          ))}
        </ul>
      ) : <p className="m-0 text-apoio">{t("Nada a apontar nesta leitura.", "Nothing to flag in this read.")}</p>)}
    </div>
  );
}

function Versoes({ tenantId, textoId, aberta, restaurar }: { tenantId: string; textoId: string; aberta: boolean; restaurar: Props["restaurar"] }) {
  const qc = useQueryClient();
  const param = { tenantId, id: textoId };
  const chave = [tenantId, "historico", textoId];
  const lista = useQuery({ queryKey: chave, enabled: aberta, queryFn: () => ler(rota.historico.$get({ param })) });
  const [vendo, setVendo] = useState<string | null>(null);
  const retrato = useQuery({ queryKey: [...chave, vendo], enabled: !!vendo, queryFn: () => ler(rota.historico[":retrato"].$get({ param: { ...param, retrato: vendo! } })) });
  const voltar = useMutation({
    mutationFn: () => restaurar(retrato.data!.doc, retrato.data!.titulo),
    onSuccess: () => { setVendo(null); void qc.invalidateQueries({ queryKey: chave }); },
  });
  if (lista.isPending) return <p role="status" className="mono m-0 text-apoio">{t("carregando…", "loading…")}</p>;
  if (lista.isError) return <p role="alert" className="faixa-erro m-0">{mensagem(lista.error)}</p>;
  if (!lista.data.versoes.length) return <p className="m-0 text-apoio">{t("Ainda não há versão anterior. Ao salvar, o texto guarda um ponto a cada 10 minutos.", "No earlier version yet. As you save, the text keeps a point every 10 minutes.")}</p>;
  return (
    <ul className="m-0 grid list-none gap-2 p-0">
      {lista.data.versoes.map((v) => (
        <li key={v.id} className="grid gap-1 border-t border-fio pt-2">
          <span className="mono text-apoio">{t(`versão ${v.versao}`, `version ${v.versao}`)} · {quando(v.em)}{v.por ? ` · ${v.por}` : ""}</span>
          <button type="button" className="link-acao justify-self-start border-0 bg-transparent p-0 text-left text-[15px]" aria-expanded={vendo === v.id} onClick={() => setVendo(vendo === v.id ? null : v.id)}>{v.titulo}</button>
          {vendo === v.id && (
            <div className="grid gap-2">
              {retrato.isPending && <p role="status" className="mono m-0 text-apoio">{t("carregando…", "loading…")}</p>}
              {retrato.isError && <p role="alert" className="faixa-erro m-0">{mensagem(retrato.error)}</p>}
              {retrato.data && (
                <>
                  {paragrafosDoDoc(retrato.data.doc as unknown as No).map((p, i) => <p key={i} className="m-0 text-[15px]">{p}</p>)}
                  <p className="ajuda m-0">{t("O texto de agora fica guardado aqui e pode voltar.", "The current text stays saved here and can come back.")}</p>
                  {voltar.isError && <p role="alert" className="faixa-erro m-0">{mensagem(voltar.error)}</p>}
                  <button type="button" className="btn-sec justify-self-start bg-papel-2" disabled={voltar.isPending} onClick={() => voltar.mutate()}>{voltar.isPending ? t("Restaurando…", "Restoring…") : t("Restaurar esta versão", "Restore this version")}</button>
                </>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
