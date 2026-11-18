// Raio-X dos posts antigos: o zip do Instagram é lido aqui no navegador, e só a miniatura e a legenda de cada post sobem. O app
// não apaga nada e não sugere apagar. O leitor do zip carrega só quando a pessoa escolhe o arquivo.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ErroApi, corpoJson, ler } from "../../api";
import { FalhaCarga } from "../../comum";
import { MesaEsqueleto, MesaVazia } from "../../kit/Prova";
import { t as tr } from "../../idioma";
import { MAX_ITENS_LOTE, MINIATURA_LADO } from "../../../../src/lib/raiox";
import { mensagemAcao, t } from "./comum";

/** Um JPEG de até 512 px. Vídeo vira um quadro. null: o navegador não abriu o arquivo. */
async function miniatura(bytes: Uint8Array, nome: string): Promise<Blob | null> {
  const blob = new Blob([bytes as BlobPart]);
  const url = URL.createObjectURL(blob);
  try {
    let fonte: CanvasImageSource;
    let w: number;
    let h: number;
    if (/\.(mp4|mov|webm|m4v)$/i.test(nome)) {
      const v = document.createElement("video");
      v.muted = true;
      v.preload = "auto";
      v.src = url;
      await new Promise((ok, falha) => { v.onloadeddata = ok; v.onerror = falha; });
      v.currentTime = Math.min(0.2, v.duration / 2 || 0);
      await new Promise((ok, falha) => { v.onseeked = ok; v.onerror = falha; });
      [fonte, w, h] = [v, v.videoWidth, v.videoHeight];
    } else {
      const i = await createImageBitmap(blob);
      [fonte, w, h] = [i, i.width, i.height];
    }
    const escala = Math.min(1, MINIATURA_LADO / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.round(w * escala);
    c.height = Math.round(h * escala);
    c.getContext("2d")!.drawImage(fonte, 0, 0, c.width, c.height);
    return await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.8));
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const NOME_MOTIVO = (m: string) => (m === "marca_dagua" ? tr("marca d'água", "watermark")
  : m === "logo" ? tr("logo de terceiro", "third-party logo")
    : m === "credito" ? tr("crédito na imagem", "credit on the image")
      : tr(`na legenda: "${m.replace(/^legenda:/, "")}"`, `in the caption: "${m.replace(/^legenda:/, "")}"`));

type Andamento = { feitos: number; total: number } | null;

type Lote = { id: string; total: number; marcados: number; ilegiveis: number; pendentes: number };
type Item = { id: string; data: string | null; legenda: string | null; estado: string; miniatura: string; motivos: string[] };

/** A aba usa o mesmo dado para o resumo da linha fechada. */
export const useRaioX = (tenantId: string, ligado = true) => useQuery({
  queryKey: [tenantId, "raiox"] as const,
  queryFn: async () => (await ler(t.raiox.$get({ param: { tenantId } }))) as { lote: Lote | null; itens: Item[] },
  enabled: ligado,
  // Enquanto o modelo lê, a contagem anda sozinha.
  refetchInterval: (q) => ((q.state.data?.lote?.pendentes ?? 0) > 0 ? 5000 : false),
});

export function RaioX({ tenantId, avisar }: { tenantId: string; avisar: (erro: string | null) => void }) {
  const qc = useQueryClient();
  const chave = [tenantId, "raiox"] as const;
  const dados = useRaioX(tenantId);
  const [andamento, setAndamento] = useState<Andamento>(null);
  const [erro, setErroLocal] = useState<string | null>(null);
  // A leitura continua com a parte fechada: a falha sobe para a linha.
  const setErro = (e: string | null) => { setErroLocal(e); avisar(e); };
  const [lendo, setLendo] = useState(false);
  const apagar = useMutation({
    mutationFn: (id: string) => ler(t.raiox[":lote"].$delete({ param: { tenantId, lote: id } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: chave }),
  });

  const rodar = async (arquivo: File) => {
    setErro(null);
    setLendo(true);
    try {
      const { lerMidiasDoZip, lerPostsDoZip } = await import("../../../../src/lib/raioxZip");
      const { posts, html } = await lerPostsDoZip(arquivo.stream());
      if (html) { setErro(tr("Este arquivo está em HTML. Peça de novo em Baixar suas informações, no formato JSON.", "This file is in HTML. Request it again in Download your information, in JSON format.")); return; }
      if (!posts.length) { setErro(tr("Nenhum post neste arquivo. Confira se é o zip em JSON do Instagram.", "No posts in this file. Check that it's the Instagram JSON zip.")); return; }
      const lista = posts.slice(0, MAX_ITENS_LOTE);
      const { id } = await ler(t.raiox.$post({ param: { tenantId } }, corpoJson({})));
      setAndamento({ feitos: 0, total: lista.length });
      await lerMidiasDoZip(arquivo.stream(), lista, async (post, bytes) => {
        const jpg = await miniatura(bytes, post.uri);
        if (jpg) {
          const form = new FormData();
          form.set("arquivo", jpg, "miniatura.jpg");
          form.set("data", post.data);
          form.set("legenda", post.legenda);
          const r = await fetch(`/api/t/${tenantId}/raiox/${id}/itens`, { method: "POST", body: form });
          if (!r.ok) throw new ErroApi(r.status, "raiox");
        }
        setAndamento((a) => a && { ...a, feitos: a.feitos + 1 });
      });
    } catch (e) {
      setErro(mensagemAcao(e, tr("ler o arquivo", "read the file")));
    } finally {
      setLendo(false);
      setAndamento(null);
      void qc.invalidateQueries({ queryKey: chave });
    }
  };

  if (dados.isPending) return <MesaEsqueleto n={2} />;
  if (dados.isError) return <FalhaCarga oque={tr("o raio-X", "the review")} tentar={() => dados.refetch()} />;
  const { lote, itens } = dados.data;
  return (
    <div className="grid gap-3">
      <p className="m-0 max-w-[60ch] text-apoio">{tr("Procura marca d'água, logo ou crédito de terceiro nos posts que já saíram. O app não apaga nada, e quem decide é você.", "Looks for third-party watermarks, logos or credits in posts already out. The app deletes nothing, and the decision is yours.")}</p>
      {!lote && (
        <>
          <p className="ajuda m-0 max-w-[60ch]">{tr("No Instagram, peça o arquivo em Baixar suas informações, no formato JSON. O arquivo fica no seu navegador: só uma miniatura e a legenda de cada post sobem.", "On Instagram, request the file in Download your information, in JSON format. The file stays in your browser: only a thumbnail and the caption of each post are uploaded.")}</p>
          <label className="btn-sec justify-self-start bg-papel-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-3 has-[:focus-visible]:outline-texto-forte">
            {lendo ? tr("Lendo…", "Reading…") : tr("Escolher o arquivo .zip", "Choose the .zip file")}
            <input type="file" accept=".zip,application/zip" className="sr-only" disabled={lendo} onChange={(e) => { const f = e.target.files?.[0]; if (f) void rodar(f); e.target.value = ""; }} />
          </label>
        </>
      )}
      {andamento && <p role="status" className="mono m-0 text-apoio">{tr(`${andamento.feitos} de ${andamento.total} posts`, `${andamento.feitos} of ${andamento.total} posts`)}</p>}
      {erro && <p role="alert" className="faixa-erro m-0">{erro}</p>}
      {lote && (
        <>
          <p role="status" className="mono m-0 text-apoio">{tr(
            `${lote.total} posts · ${lote.marcados} com marca · ${lote.ilegiveis} não deu para ler${lote.pendentes ? ` · ${lote.pendentes} na fila` : ""}`,
            `${lote.total} posts · ${lote.marcados} flagged · ${lote.ilegiveis} unreadable${lote.pendentes ? ` · ${lote.pendentes} in the queue` : ""}`,
          )}</p>
          {itens.length ? (
            <ul aria-label={tr("Posts com marca", "Flagged posts")} className="m-0 grid list-none gap-3 p-0">
              {itens.map((i) => (
                <li key={i.id} className="grid grid-cols-[84px_1fr] gap-3 border-t border-fio pt-3">
                  <img src={i.miniatura} alt="" width={84} height={105} loading="lazy" className="h-[105px] w-[84px] rounded-card bg-papel-2 object-cover" />
                  <span className="grid min-w-0 content-start gap-1">
                    <span className="mono text-apoio">{i.data?.slice(0, 10)}</span>
                    <span className="text-texto-forte">{i.estado === "ilegivel" ? tr("Não deu para ler", "Couldn't read it") : i.motivos.map(NOME_MOTIVO).join(" · ")}</span>
                    {i.legenda && <span className="line-clamp-2 text-[15px] text-apoio">{i.legenda}</span>}
                  </span>
                </li>
              ))}
            </ul>
          ) : !lote.pendentes && <MesaVazia rotulo={tr("nada apontado", "nothing flagged")}><p className="m-0 text-apoio">{tr("O modelo não achou marca de terceiro nestes posts. Ele pode errar.", "The model found no third-party marks in these posts. It can be wrong.")}</p></MesaVazia>}
          <button type="button" className="btn-sec justify-self-start" disabled={apagar.isPending} onClick={() => apagar.mutate(lote.id)}>{apagar.isPending ? tr("Apagando…", "Deleting…") : tr("Apagar este raio-X", "Delete this review")}</button>
          {apagar.isError && <p role="alert" className="faixa-erro m-0">{mensagemAcao(apagar.error, tr("apagar o raio-X", "delete the review"))}</p>}
        </>
      )}
    </div>
  );
}
