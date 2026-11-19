// X-ray of old posts: the Instagram zip is read here in the browser, and only each post's thumbnail and caption are
// uploaded. The app deletes nothing and does not suggest deleting. The zip reader loads only when the person picks the file.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, bodyJson, read } from "../../api";
import { FailureLoad } from "../../common";
import { DeskSkeleton, EmptyDesk } from "../../kit/Proof";
import { t as tr } from "../../language";
import { MAX_ITEMS_BATCH, THUMBNAIL_SIDE } from "../../../../src/lib/xray";
import { actionMessage, t } from "./common";

/** A JPEG of up to 512 px. A video becomes a frame. null: the browser did not open the file. */
async function thumbnail(bytes: Uint8Array, label: string): Promise<Blob | null> {
  const blob = new Blob([bytes as BlobPart]);
  const url = URL.createObjectURL(blob);
  try {
    let source: CanvasImageSource;
    let w: number;
    let h: number;
    if (/\.(mp4|mov|webm|m4v)$/i.test(label)) {
      const v = document.createElement("video");
      v.muted = true;
      v.preload = "auto";
      v.src = url;
      await new Promise((ok, failure) => { v.onloadeddata = ok; v.onerror = failure; });
      v.currentTime = Math.min(0.2, v.duration / 2 || 0);
      await new Promise((ok, failure) => { v.onseeked = ok; v.onerror = failure; });
      [source, w, h] = [v, v.videoWidth, v.videoHeight];
    } else {
      const i = await createImageBitmap(blob);
      [source, w, h] = [i, i.width, i.height];
    }
    const scale = Math.min(1, THUMBNAIL_SIDE / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.round(w * scale);
    c.height = Math.round(h * scale);
    c.getContext("2d")!.drawImage(source, 0, 0, c.width, c.height);
    return await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.8));
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const REASON_NAME = (m: string) => (m === "marca_dagua" ? tr("marca d'água", "watermark")
  : m === "logo" ? tr("logo de terceiro", "third-party logo")
    : m === "credito" ? tr("crédito na imagem", "credit on the image")
      : tr(`na legenda: "${m.replace(/^legenda:/, "")}"`, `in the caption: "${m.replace(/^legenda:/, "")}"`));

type Progress = { feitos: number; total: number } | null;

type Batch = { id: string; total: number; marcados: number; ilegiveis: number; pendentes: number };
type Item = { id: string; data: string | null; legenda: string | null; estado: string; miniatura: string; motivos: string[] };

/** The tab uses the same data for the closed row's summary. */
export const useRayX = (tenantId: string, on = true) => useQuery({
  queryKey: [tenantId, "raiox"] as const,
  queryFn: async () => (await read(t.raiox.$get({ param: { tenantId } }))) as { lote: Batch | null; itens: Item[] },
  enabled: on,
  // While the model reads, the count moves by itself.
  refetchInterval: (q) => ((q.state.data?.lote?.pendentes ?? 0) > 0 ? 5000 : false),
});

export function RayX({ tenantId, avisar: warn }: { tenantId: string; avisar: (error: string | null) => void }) {
  const qc = useQueryClient();
  const key = [tenantId, "raiox"] as const;
  const data = useRayX(tenantId);
  const [progress, setProgress] = useState<Progress>(null);
  const [error, setErrorLocal] = useState<string | null>(null);
  // Reading continues with the part closed: a failure goes up to the row.
  const setError = (e: string | null) => { setErrorLocal(e); warn(e); };
  const [reading, setReading] = useState(false);
  const deleteValue = useMutation({
    mutationFn: (id: string) => read(t.raiox[":lote"].$delete({ param: { tenantId, lote: id } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  const run = async (file: File) => {
    setError(null);
    setReading(true);
    try {
      const { readMediaZip, readPostsZip } = await import("../../../../src/lib/xrayZip");
      const { posts, html } = await readPostsZip(file.stream());
      if (html) { setError(tr("Este arquivo está em HTML. Peça de novo em Baixar suas informações, no formato JSON.", "This file is in HTML. Request it again in Download your information, in JSON format.")); return; }
      if (!posts.length) { setError(tr("Nenhum post neste arquivo. Confira se é o zip em JSON do Instagram.", "No posts in this file. Check that it's the Instagram JSON zip.")); return; }
      const list = posts.slice(0, MAX_ITEMS_BATCH);
      const { id } = await read(t.raiox.$post({ param: { tenantId } }, bodyJson({})));
      setProgress({ feitos: 0, total: list.length });
      await readMediaZip(file.stream(), list, async (post, bytes) => {
        const jpg = await thumbnail(bytes, post.uri);
        if (jpg) {
          const form = new FormData();
          form.set("arquivo", jpg, "miniatura.jpg");
          form.set("data", post.data);
          form.set("legenda", post.legenda);
          const r = await fetch(`/api/t/${tenantId}/raiox/${id}/itens`, { method: "POST", body: form });
          if (!r.ok) throw new ApiError(r.status, "raiox");
        }
        setProgress((a) => a && { ...a, feitos: a.feitos + 1 });
      });
    } catch (e) {
      setError(actionMessage(e, tr("ler o arquivo", "read the file")));
    } finally {
      setReading(false);
      setProgress(null);
      void qc.invalidateQueries({ queryKey: key });
    }
  };

  if (data.isPending) return <DeskSkeleton n={2} />;
  if (data.isError) return <FailureLoad oque={tr("o raio-X", "the review")} tentar={() => data.refetch()} />;
  const { lote: batch, itens: items } = data.data;
  return (
    <div className="grid gap-3">
      <p className="m-0 max-w-[60ch] text-apoio">{tr("Procura marca d'água, logo ou crédito de terceiro nos posts que já saíram. O app não apaga nada, e quem decide é você.", "Looks for third-party watermarks, logos or credits in posts already out. The app deletes nothing, and the decision is yours.")}</p>
      {!batch && (
        <>
          <p className="ajuda m-0 max-w-[60ch]">{tr("No Instagram, peça o arquivo em Baixar suas informações, no formato JSON. O arquivo fica no seu navegador: só uma miniatura e a legenda de cada post sobem.", "On Instagram, request the file in Download your information, in JSON format. The file stays in your browser: only a thumbnail and the caption of each post are uploaded.")}</p>
          <label className="btn-sec justify-self-start bg-papel-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-3 has-[:focus-visible]:outline-texto-forte">
            {reading ? tr("Lendo…", "Reading…") : tr("Escolher o arquivo .zip", "Choose the .zip file")}
            <input type="file" accept=".zip,application/zip" className="sr-only" disabled={reading} onChange={(e) => { const f = e.target.files?.[0]; if (f) void run(f); e.target.value = ""; }} />
          </label>
        </>
      )}
      {progress && <p role="status" className="mono m-0 text-apoio">{tr(`${progress.feitos} de ${progress.total} posts`, `${progress.feitos} of ${progress.total} posts`)}</p>}
      {error && <p role="alert" className="faixa-erro m-0">{error}</p>}
      {batch && (
        <>
          <p role="status" className="mono m-0 text-apoio">{tr(
            `${batch.total} posts · ${batch.marcados} com marca · ${batch.ilegiveis} não deu para ler${batch.pendentes ? ` · ${batch.pendentes} na fila` : ""}`,
            `${batch.total} posts · ${batch.marcados} flagged · ${batch.ilegiveis} unreadable${batch.pendentes ? ` · ${batch.pendentes} in the queue` : ""}`,
          )}</p>
          {items.length ? (
            <ul aria-label={tr("Posts com marca", "Flagged posts")} className="m-0 grid list-none gap-3 p-0">
              {items.map((i) => (
                <li key={i.id} className="grid grid-cols-[84px_1fr] gap-3 border-t border-fio pt-3">
                  <img src={i.miniatura} alt="" width={84} height={105} loading="lazy" className="h-[105px] w-[84px] rounded-card bg-papel-2 object-cover" />
                  <span className="grid min-w-0 content-start gap-1">
                    <span className="mono text-apoio">{i.data?.slice(0, 10)}</span>
                    <span className="text-texto-forte">{i.estado === "ilegivel" ? tr("Não deu para ler", "Couldn't read it") : i.motivos.map(REASON_NAME).join(" · ")}</span>
                    {i.legenda && <span className="line-clamp-2 text-[15px] text-apoio">{i.legenda}</span>}
                  </span>
                </li>
              ))}
            </ul>
          ) : !batch.pendentes && <EmptyDesk rotulo={tr("nada apontado", "nothing flagged")}><p className="m-0 text-apoio">{tr("O modelo não achou marca de terceiro nestes posts. Ele pode errar.", "The model found no third-party marks in these posts. It can be wrong.")}</p></EmptyDesk>}
          <button type="button" className="btn-sec justify-self-start" disabled={deleteValue.isPending} onClick={() => deleteValue.mutate(batch.id)}>{deleteValue.isPending ? tr("Apagando…", "Deleting…") : tr("Apagar este raio-X", "Delete this review")}</button>
          {deleteValue.isError && <p role="alert" className="faixa-erro m-0">{actionMessage(deleteValue.error, tr("apagar o raio-X", "delete the review"))}</p>}
        </>
      )}
    </div>
  );
}
