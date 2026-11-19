// "With your voice" on the Reels screen: the script (the cards' titles and sentences, without the CTA), record or upload
// a file, up to 90 s. The speech is compared with the script by code. Each warning asks a person for a decision, and
// "Make the Reels" only unlocks with all of them decided. The transcript does not appear: what the screen shows is the
// time to listen.
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { scriptReels } from "../../../src/lib/speech";
import type { Card } from "../../../src/lib/cards";
import { headerLanguage, ApiError } from "../api";
import { openPassage } from "../recorder/listen";
import { mimeRecorder, useRecorder } from "../recorder/useRecorder";
import { t as tr } from "../language";
import { mmss } from "../story/Recordings";

const CAP_S = 90;
export interface VoiceState { id: string; duracao: number | null; pronta: boolean }
interface Warning { tipo: "numero" | "nome" | "fora"; motivo: "ausente" | "trocado" | "extra"; esperado: string | null; inicio: number; decisao?: string | null }
interface Narration { id: string; estado: "lendo" | "pronto" | "falhou"; erro: string | null; duracao: number | null; avisos: Warning[] }

async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, { ...init, headers: { ...headerLanguage(), ...init.headers } });
  } catch {
    throw new ApiError(0, tr("Sem conexão com o servidor.", "No connection to the server."));
  }
  const b = (await r.json().catch(() => null)) as (T & { erro?: string }) | null;
  if (!r.ok) throw new ApiError(r.status, b?.erro ?? `Erro ${r.status}`);
  return b as T;
}

const fromWarningText = (a: Warning) => {
  if (a.tipo === "fora") return tr("Há fala fora do roteiro.", "There's speech outside the script.");
  const what = a.tipo === "numero" ? tr(`o número ${a.esperado}`, `the number ${a.esperado}`) : tr(`o nome ${a.esperado}`, `the name ${a.esperado}`);
  return a.motivo === "trocado" ? tr(`Confira ${what}: pode ter saído trocado.`, `Check ${what}: it may have come out wrong.`) : tr(`Não encontramos ${what} na fala.`, `We didn't find ${what} in the speech.`);
};

export function VoiceReels({ tenantId, pecaId: pieceId, cards, mudou: changed }: { tenantId: string; pecaId: string; cards: Card[]; mudou: (v: VoiceState | null) => void }) {
  const base = `/api/t/${encodeURIComponent(tenantId)}/pecas/${encodeURIComponent(pieceId)}/narracao`;
  const key = [tenantId, "narracao", pieceId];
  const qc = useQueryClient();
  const script = useMemo(() => scriptReels(cards), [cards]);
  const g = useRecorder();
  const current = useQuery({
    queryKey: key,
    queryFn: () => call<{ narracao: Narration | null }>(base),
    refetchInterval: (q) => (q.state.data?.narracao?.estado === "lendo" ? 2000 : false),
  });
  const n = current.data?.narracao ?? null;
  const pending = n?.avisos.filter((a) => !a.decisao).length ?? 0;
  useEffect(() => {
    changed(n?.estado === "pronto" ? { id: n.id, duracao: n.duracao, pronta: !pending } : null);
  }, [n?.id, n?.estado, n?.duracao, pending]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useMutation({
    mutationFn: (body: Blob) => call<{ id: string }>(base, { method: "POST", headers: { "content-type": body.type || "application/octet-stream" }, body: body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
  const decision = useMutation({
    mutationFn: (i: number) => call(`${base}/${n!.id}/avisos/${i}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decisao: "fala_certa" }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
  const [micError, setErrorMic] = useState<string | null>(null);
  const [failedListen, setFailedListen] = useState(false);
  const sound = useRef<HTMLAudioElement | null>(null);

  async function record() {
    setErrorMic(null);
    if (!mimeRecorder()) { setErrorMic(tr("Este navegador não grava áudio. Envie um arquivo.", "This browser can't record audio. Upload a file.")); return; }
    await g.iniciar().catch(() => setErrorMic(tr("O navegador não liberou o microfone.", "The browser didn't allow the microphone.")));
  }
  async function stop() {
    const blob = await g.parar();
    if (blob?.size) send.mutate(blob);
  }
  useEffect(() => { if (g.gravando && g.segundos >= CAP_S) void stop(); }, [g.gravando, g.segundos]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { sound.current?.pause(); }, []);

  function choose(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) send.mutate(f);
  }
  async function listen(home: number) {
    setFailedListen(false);
    try {
      sound.current?.pause();
      const { a } = await openPassage(`${base}/${n!.id}/audio`);
      sound.current = a;
      const until = home + 4;
      a.ontimeupdate = () => { if (a.currentTime >= until) a.pause(); };
      a.currentTime = Math.max(0, home - 1);
      await a.play();
    } catch {
      setFailedListen(true);
    }
  }

  const busy = send.isPending || n?.estado === "lendo";
  return (
    <div className="grid gap-3">
      <details className="text-[15px]" open>
        <summary className="min-h-11 cursor-pointer content-center font-bold text-texto-forte">{tr("Roteiro", "Script")}</summary>
        <ol className="m-0 mt-1 grid gap-1 pl-5">{script.map((p, i) => <li key={i}>{p.texto}</li>)}</ol>
      </details>
      <p className="ajuda m-0">{tr("Leia o roteiro como está, em até 90 s. O convite do último card não entra na fala.", "Read the script as written, in up to 90 s. The last card's invite isn't part of the speech.")}</p>

      {g.gravando ? (
        <div className="grid gap-2 rounded-card bg-branco px-3 py-3 shadow-curta" role="group" aria-label={tr("Gravação em andamento", "Recording in progress")}>
          <span className="mono text-[24px] text-texto-forte">{mmss(g.segundos)} <span className="text-[15px] text-apoio">/ 01:30</span></span>
          <div role="meter" aria-label={tr("Nível do microfone", "Microphone level")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(g.nivel * 100)} className="h-2 w-full bg-papel-2">
            <div className="h-full bg-texto-forte" style={{ width: `${Math.round(g.nivel * 100)}%` }} />
          </div>
          <button type="button" className="btn-tinta justify-self-start" onClick={() => void stop()}>{tr("Parar", "Stop")}</button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-sec bg-papel-2" disabled={busy} onClick={() => void record()}>{n ? tr("Gravar de novo", "Record again") : tr("Gravar a voz", "Record your voice")}</button>
          <label className="btn-sec bg-papel-2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-texto-forte">
            {tr("Enviar arquivo", "Upload a file")}
            <input type="file" accept="audio/*,.mp3,.m4a,.wav,.ogg,.flac,.webm" className="sr-only" onChange={choose} disabled={busy} />
          </label>
        </div>
      )}

      {busy && <p role="status" className="mono m-0 text-apoio">{tr("Conferindo a fala com o roteiro…", "Checking the speech against the script…")}</p>}
      {micError && <p role="alert" className="faixa-erro m-0">{micError}</p>}
      {send.isError && <p role="alert" className="faixa-erro m-0">{(send.error as Error).message}</p>}
      {n?.estado === "falhou" && <p role="alert" className="faixa-erro m-0">{tr(`Não deu para conferir a fala: ${n.erro ?? "erro"}.`, `Couldn't check the speech: ${n.erro ?? "error"}.`)}</p>}
      {n?.estado === "pronto" && !n.avisos.length && <p role="status" className="m-0 text-[15px] text-verde">{tr("Números e nomes conferem com o roteiro.", "Numbers and names match the script.")}</p>}
      {n?.estado === "pronto" && n.avisos.length > 0 && (
        <ul aria-label={tr("Avisos da fala", "Speech warnings")} className="m-0 grid list-none gap-2 p-0">
          {n.avisos.map((a, i) => (
            <li key={i} className="grid gap-1 border-t border-fio pt-2">
              <span className="text-[15px] text-texto-forte">{fromWarningText(a)} <span className="mono text-apoio">{mmss(a.inicio)}</span></span>
              <span className="flex flex-wrap items-center gap-2">
                <button type="button" className="btn-sec min-h-11 bg-papel-2 px-3 text-[14px]" onClick={() => void listen(a.inicio)}>{tr("Ouvir", "Listen")}<span className="sr-only"> {mmss(a.inicio)}</span></button>
                {a.decisao ? <span className="mono text-verde">{tr("a fala está certa", "the speech is right")}</span> : (
                  <button type="button" className="btn-sec min-h-11 bg-papel-2 px-3 text-[14px]" disabled={decision.isPending} onClick={() => decision.mutate(i)}>{tr("A fala está certa", "The speech is right")}<span className="sr-only"> {mmss(a.inicio)}</span></button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {failedListen && <p role="alert" className="m-0 text-[15px] text-terracota">{tr("O navegador não tocou o áudio.", "The browser couldn't play the audio.")}</p>}
    </div>
  );
}
