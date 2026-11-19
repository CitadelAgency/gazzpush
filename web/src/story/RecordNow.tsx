// Recording in the app: the time, the microphone level and "Saved up to mm:ss", which only moves with the server's
// confirmation. Closing the tab does not lose what was uploaded: on return, the screen offers to finish, and the cron
// finishes a session idle for more than 2 hours.
import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { headerLanguage, ApiError } from "../api";
import { deleteSlice, slicesSession } from "../recorder/queue";
import { mimeRecorder, useRecorder, type Warning } from "../recorder/useRecorder";
import { t } from "../language";
import { message, type DeskState } from "./common";
import { mmss } from "./Recordings";

const fromWarningText = (a: Warning) => ({
  rede: t("Sem confirmação do servidor há 15 s. A gravação continua e sobe quando a rede voltar.", "No confirmation from the server for 15 s. Recording continues and uploads when the connection returns."),
  parou: t("A gravação parou. Toque em Gravar para continuar numa gravação nova.", "Recording stopped. Tap Record to continue in a new recording."),
  trilha: t("O microfone foi cortado, talvez por uma ligação.", "The microphone was cut off, perhaps by a call."),
  silencio: t("Nenhum som no microfone há 20 s. Confira se ele está ligado.", "No sound from the microphone for 20 s. Check that it's on."),
  escondida: t("O app saiu da frente. No celular, isso pode cortar a gravação.", "The app is in the background. On a phone, this can cut the recording."),
})[a];

export function RecordNow({ tenantId, textoId: textId, estado: state, atualizar: update, avisar: warn }: {
  tenantId: string; textoId: string; estado: DeskState; atualizar: (d: DeskState) => void; avisar: (s: string | null) => void;
}) {
  const base = `/api/t/${encodeURIComponent(tenantId)}/textos/${encodeURIComponent(textId)}/gravacoes/sessao`;
  const g = useRecorder();
  const [active, activeSet] = useState<string | null>(null);
  const closed = useRef(new Set<string>());
  // The part may close with the recording running: the state and the first warning move up to its row.
  const [first] = g.avisos;
  const status = g.gravando ? (first ? fromWarningText(first) : t("gravando agora", "recording now")) : null;
  useEffect(() => { warn(status); }, [status, warn]);

  async function call(url: string, init: RequestInit) {
    let r: Response;
    try {
      r = await fetch(url, { ...init, headers: { ...headerLanguage(), ...init.headers } });
    } catch {
      throw new ApiError(0, t("Sem conexão com o servidor.", "No connection to the server."));
    }
    const b = (await r.json().catch(() => null)) as ({ erro?: string; code?: string } & Record<string, unknown>) | null;
    if (!r.ok) throw new ApiError(r.status, b?.erro ?? `Erro ${r.status}`, b?.code, b);
    return b;
  }
  const upload = (session: string, f: { segmento: number; fatia: number; blob: Blob }) =>
    call(`${base}/${session}/${f.segmento}/${f.fatia}`, { method: "PUT", headers: { "content-type": "application/octet-stream" }, body: f.blob });
  const finishSession = async (session: string) => update(await call(`${base}/${session}/concluir`, { method: "POST" }) as DeskState);

  const start = useMutation({
    mutationFn: async () => {
      const mime = mimeRecorder();
      if (!mime) throw new ApiError(0, t("Este navegador não grava áudio.", "This browser can't record audio."));
      const r = await call(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mime }) }) as { sessao: string; segundos: number; fatia: number };
      try {
        await g.iniciar({ sessao: r.sessao, segundos: r.segundos, fatia: r.fatia, subir: (f) => upload(r.sessao, f).then(() => undefined) });
      } catch {
        throw new ApiError(0, t("O navegador não liberou o microfone.", "The browser didn't allow the microphone."));
      }
      activeSet(r.sessao);
    },
  });
  const stop = useMutation({
    mutationFn: async () => {
      await g.parar();
      await finishSession(active!);
      closed.current.add(active!);
      activeSet(null);
    },
  });
  // Came back after closing the tab: what was kept uploads before finishing.
  const resume = useMutation({
    mutationFn: async (session: string) => {
      for (const f of await slicesSession(session).catch(() => [])) {
        await upload(session, f);
        await deleteSlice(f).catch(() => {});
      }
      await finishSession(session);
    },
  });

  const open = state.sessoesAbertas.filter((s) => s.id !== active && !closed.current.has(s.id));
  return (
    <div className="grid gap-2">
      {open.map((s) => (
        <p key={s.id} className="faixa-aviso m-0 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span>{t(`Uma gravação de ${s.criadoEm.slice(0, 10).split("-").reverse().join("/")} ficou sem concluir.`, `A recording from ${s.criadoEm.slice(0, 10)} wasn't finished.`)}</span>
          <button type="button" className="btn-sec" disabled={resume.isPending} onClick={() => resume.mutate(s.id)}>{t("Concluir", "Finish")}</button>
        </p>
      ))}
      {!g.gravando && !stop.isPending ? (
        <div className="grid gap-1">
          <button type="button" className="btn-sec justify-self-start bg-papel-2" disabled={start.isPending} onClick={() => start.mutate()}>
            {start.isPending ? t("Abrindo o microfone…", "Opening the microphone…") : t("Gravar", "Record")}
          </button>
          <span className="ajuda">{t("Até 3 horas. No celular, a tela apagada pode cortar a gravação: deixe-a acesa e o app aberto.", "Up to 3 hours. On a phone, a dark screen can cut the recording: keep it on and the app open.")}</span>
        </div>
      ) : (
        <div className="grid gap-2 rounded-card bg-branco px-3 py-3 shadow-curta" aria-label={t("Gravação em andamento", "Recording in progress")} role="group">
          <div className="flex flex-wrap items-baseline gap-x-4">
            <span className="mono text-[24px] text-texto-forte">{mmss(g.segundos)}</span>
            <span role="status" className="mono text-apoio">{t(`Salvo até ${mmss(g.salvo)}`, `Saved up to ${mmss(g.salvo)}`)}</span>
          </div>
          <div role="meter" aria-label={t("Nível do microfone", "Microphone level")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(g.nivel * 100)} className="h-2 w-full bg-papel-2">
            <div className="h-full bg-texto-forte" style={{ width: `${Math.round(g.nivel * 100)}%` }} />
          </div>
          {[...g.avisos].map((a) => <p key={a} role="alert" className="faixa-erro m-0 text-[14px]">{fromWarningText(a)}</p>)}
          <button type="button" className="btn-tinta justify-self-start" disabled={stop.isPending} onClick={() => stop.mutate()}>
            {stop.isPending ? t("Subindo o que falta…", "Uploading the rest…") : t("Parar e concluir", "Stop and finish")}
          </button>
        </div>
      )}
      {[start, stop, resume].map((m, i) => m.isError && <p key={i} role="alert" className="faixa-erro m-0">{message(m.error)}</p>)}
    </div>
  );
}
