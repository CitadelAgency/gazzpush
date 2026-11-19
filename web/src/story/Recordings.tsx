// Quotes against the recording (Phase 6): the interview audio, transcribed by Whisper; each quotation in the text
// checked by code against the transcript ("matches the recording at mm:ss", with the playable passage, or "not found").
// The transcript appears as the model returned it, with each passage's minute.
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { headerLanguage, ApiError, read } from "../api";
import { t } from "../language";
import { message, qty, route, type DeskState, type Summary } from "./common";
import { RecordNow } from "./RecordNow";
import { openPassage } from "../recorder/listen";

type Finding = DeskState["apontamentos"][number];

/** 192.4 → "03:12"; 3725 → "1:02:05" (the same as the server). */
export function mmss(seg: number) {
  const s = Math.max(0, Math.floor(seg));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${String(m).padStart(2, "0")}:${ss}`;
}

const urlAudio = (tenantId: string, textId: string, fileId: string, time?: number) =>
  `/api/t/${encodeURIComponent(tenantId)}/textos/${encodeURIComponent(textId)}/gravacoes/${encodeURIComponent(fileId)}/audio${time === undefined ? "" : `?t=${time}`}`;

/** Plays only the quotation's passage (a little before and after) and stops by itself. */
export function PlayPassage({ tenantId, textoId: textId, g }: { tenantId: string; textoId: string; g: { arquivoId: string; inicio: number; fim: number; segmentada?: boolean } }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const shifts = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => () => { audio.current?.pause(); }, []);
  async function play() {
    if (playing) { audio.current?.pause(); setPlaying(false); return; }
    setFailed(false);
    try {
      if (!audio.current) {
        if (g.segmentada) {
          const t = await openPassage(urlAudio(tenantId, textId, g.arquivoId, g.inicio));
          audio.current = t.a;
          shifts.current = t.inicio;
        } else audio.current = new Audio(urlAudio(tenantId, textId, g.arquivoId));
      }
      const a = audio.current;
      const until = g.fim - shifts.current + 0.4;
      a.ontimeupdate = () => { if (a.currentTime >= until) { a.pause(); setPlaying(false); } };
      a.onerror = () => { setFailed(true); setPlaying(false); };
      a.currentTime = Math.max(0, g.inicio - shifts.current - 0.3);
      await a.play();
      setPlaying(true);
    } catch {
      setFailed(true);
      setPlaying(false);
    }
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2">
      <button type="button" className="btn-sec min-h-11 bg-papel-2 px-3 text-[14px]" onClick={() => void play()} aria-pressed={playing}>
        {playing ? t("Parar", "Stop") : t("Ouvir o trecho", "Play the excerpt")}<span className="sr-only">{t(` (${mmss(g.inicio)})`, ` (${mmss(g.inicio)})`)}</span>
      </button>
      {failed && <span role="alert" className="mono text-terracota">{t("o navegador não tocou o áudio", "the browser couldn't play the audio")}</span>}
    </span>
  );
}

/** `gravando`: what the recorder has to say while recording; the recording continues with the part closed, and the warning in view. */
export function summaryRecordings(e: DeskState, error: unknown, recording: string | null): Summary {
  if (recording) return { tom: "aviso", texto: recording };
  if (error) return { tom: "erro", texto: message(error) };
  const n = e.gravacoes.length;
  const total = n ? t(qty(n, "gravação", "gravações"), qty(n, "recording", "recordings")) : t("nenhuma gravação", "no recordings");
  const failures = e.gravacoes.filter((g) => g.estado === "falhou" || g.segmentos?.falhos.length).length;
  if (failures) return { tom: "erro", texto: `${t(failures === 1 ? "1 com falha na transcrição" : `${failures} com falha na transcrição`, `${failures} with a transcription failure`)} · ${total}` };
  if (e.sessoesAbertas.length) return { tom: "aviso", texto: `${t("gravação sem concluir", "unfinished recording")} · ${total}` };
  if (e.gravacoes.some((g) => g.segmentos?.faltas.length)) return { tom: "aviso", texto: `${t("trecho que não chegou", "a part never arrived")} · ${total}` };
  const withoutSource = e.gravacoes.some((g) => g.estado === "pronto") ? e.apontamentos.filter((p) => p.tipo === "aspa").length : 0;
  if (withoutSource) return { tom: "aviso", texto: `${t(withoutSource === 1 ? "1 aspa não encontrada" : `${withoutSource} aspas não encontradas`, withoutSource === 1 ? "1 quote not found" : `${withoutSource} quotes not found`)} · ${total}` };
  const reading = e.gravacoes.filter((g) => g.estado === "lendo").length;
  return { texto: reading ? `${t(`${reading} transcrevendo`, `${reading} transcribing`)} · ${total}` : total };
}

/** Uploading stays outside the panel: an empty part offers "Upload audio" on its own row. */
export function useSendAudio(tenantId: string, textId: string, update: (d: DeskState) => void) {
  return useMutation({
    mutationFn: async (file: File) => {
      let res: Response;
      try {
        res = await fetch(`/api/t/${encodeURIComponent(tenantId)}/textos/${encodeURIComponent(textId)}/gravacoes`, {
          method: "POST", headers: { "content-type": file.type || "application/octet-stream", "x-nome": encodeURIComponent(file.name), ...headerLanguage() }, body: file,
        });
      } catch {
        throw new ApiError(0, t("Sem conexão com o servidor.", "No connection to the server."));
      }
      const b = (await res.json().catch(() => null)) as (DeskState & { erro?: string; code?: string }) | null;
      if (!res.ok) throw new ApiError(res.status, b?.erro ?? `Erro ${res.status}`, b?.code, b);
      return b as DeskState;
    },
    onSuccess: update,
  });
}

export function AudioButton({ enviar: send }: { enviar: ReturnType<typeof useSendAudio> }) {
  function choose(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) send.mutate(f);
  }
  return (
    <label className="btn-sec flex-none justify-self-start bg-papel-2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-texto-forte">
      {send.isPending ? t("Enviando o áudio…", "Uploading the audio…") : t("Enviar áudio", "Upload audio")}
      <input type="file" accept="audio/*,.mp3,.m4a,.wav,.ogg,.flac,.webm" className="sr-only" onChange={choose} disabled={send.isPending} />
    </label>
  );
}

export function Recordings({ tenantId, textoId: textId, estado: state, editor, atualizar: update, enviar: send, avisar: warn }: {
  tenantId: string; textoId: string; estado: DeskState; editor: boolean; atualizar: (d: DeskState) => void; enviar: ReturnType<typeof useSendAudio>; avisar: (s: string | null) => void;
}) {
  // While a recording is being transcribed (queued), the Story asks again every 2 s (screens/Desk.tsx).
  const quotes = state.apontamentos.filter((p): p is Finding => p.tipo === "gravacao" || p.tipo === "aspa");
  const ready = state.gravacoes.filter((g) => g.estado === "pronto").length;
  return (
    <div className="grid gap-3">
      {state.gravacoes.length ? (
        <ul className="m-0 grid list-none gap-3 p-0">
          {state.gravacoes.map((g) => (
            <li key={g.id} className="grid gap-2 rounded-card bg-branco px-3 py-3 shadow-curta">
              <b className="text-[15px] text-texto-forte">{g.nome}</b>
              {g.estado === "lendo" && (
                <span role="status" className="mono text-apoio">{g.segmentos ? t(`Transcrevendo ${g.segmentos.prontos} de ${g.segmentos.total}`, `Transcribing ${g.segmentos.prontos} of ${g.segmentos.total}`) : t("transcrevendo…", "transcribing…")}</span>
              )}
              {g.segmentos && <Parts tenantId={tenantId} textoId={textId} arquivoId={g.id} partes={g.segmentos} editor={editor} atualizar={update} />}
              {g.estado === "falhou" && <p role="alert" className="faixa-erro m-0 text-[14px]">{t(`Não deu para transcrever: ${g.erro ?? "erro"}.`, `Couldn't transcribe it: ${g.erro ?? "error"}.`)}</p>}
              {g.estado === "pronto" && (
                <>
                  <span className="mono text-apoio">{t(`${mmss(g.duracao ?? 0)} de áudio · transcrito`, `${mmss(g.duracao ?? 0)} of audio · transcribed`)}</span>
                  {g.segmentos ? <ListenParts tenantId={tenantId} textoId={textId} arquivoId={g.id} nome={g.nome} inicios={g.segmentos.inicios} /> : (
                    <audio controls preload="none" src={urlAudio(tenantId, textId, g.id)} aria-label={t(`Áudio: ${g.nome}`, `Audio: ${g.nome}`)} className="w-full max-w-[520px]" />
                  )}
                  <Transcript tenantId={tenantId} textoId={textId} arquivoId={g.id} />
                </>
              )}
            </li>
          ))}
        </ul>
      ) : <p className="m-0 text-apoio">{t("Nenhuma gravação ainda. Envie o áudio da entrevista: cada aspa do texto é conferida contra o que foi dito, com o minuto.", "No recordings yet. Upload the interview audio: each quote in the text is checked against what was said, with the minute.")}</p>}
      {ready > 0 && (
        <div className="grid gap-2">
          <h3 className="m-0 text-[15px] font-bold text-texto-forte">{t("Aspas do texto", "Quotes in the text")}</h3>
          {quotes.length ? (
            <ul className="m-0 grid list-none gap-2 p-0">
              {quotes.map((p) => (
                <li key={p.id} className="grid gap-1.5 border-t border-fio pt-2">
                  <span className="text-[15px]">{p.trecho}</span>
                  {p.tipo === "gravacao" && p.gravacao ? (
                    <>
                      <span className="mono text-verde">{t(`bate com a gravação aos ${mmss(p.gravacao.inicio)} · ${p.gravacao.nome}`, `matches the recording at ${mmss(p.gravacao.inicio)} · ${p.gravacao.nome}`)}</span>
                      <PlayPassage tenantId={tenantId} textoId={textId} g={p.gravacao} />
                    </>
                  ) : <span className="mono text-ambar">{t("não encontrada nas gravações nem no dossiê", "not found in the recordings or the dossier")}</span>}
                </li>
              ))}
            </ul>
          ) : <p className="m-0 text-apoio">{t("O texto não tem citação entre aspas para conferir (ou todas estão em fontes do dossiê).", "The text has no quote to check (or they're all in dossier sources).")}</p>}
        </div>
      )}
      {editor && <RecordNow tenantId={tenantId} textoId={textId} estado={state} atualizar={update} avisar={warn} />}
      {editor && (
        <div className="grid gap-1">
          {state.gravacoes.length > 0 && <AudioButton enviar={send} />}
          <span className="ajuda">{t("Até 25 MB (MP3, M4A, WAV, OGG, FLAC ou WebM). A transcrição é do Whisper e não é corrigida: a aspa vale se as palavras estão lá.", "Up to 25 MB (MP3, M4A, WAV, OGG, FLAC or WebM). The transcript is Whisper's and isn't corrected: a quote counts if the words are there.")}</span>
        </div>
      )}
      {send.isError && <p role="alert" className="faixa-erro m-0">{message(send.error)}</p>}
    </div>
  );
}

type Segments = NonNullable<DeskState["gravacoes"][number]["segmentos"]>;

/** A passage that failed stays in view, with "Try again", and what did not arrive says its time. */
function Parts({ tenantId, textoId: textId, arquivoId: fileId, partes: parts, editor, atualizar: update }: { tenantId: string; textoId: string; arquivoId: string; partes: Segments; editor: boolean; atualizar: (d: DeskState) => void }) {
  const attempt = useMutation({
    mutationFn: async (n: number) => {
      const r = await fetch(`/api/t/${encodeURIComponent(tenantId)}/textos/${encodeURIComponent(textId)}/gravacoes/${encodeURIComponent(fileId)}/segmentos/${n}/tentar`, { method: "POST", headers: headerLanguage() });
      const b = (await r.json().catch(() => null)) as (DeskState & { erro?: string; code?: string }) | null;
      if (!r.ok) throw new ApiError(r.status, b?.erro ?? `Erro ${r.status}`, b?.code, b);
      return b as DeskState;
    },
    onSuccess: update,
  });
  return (
    <>
      {parts.faltas.map((f) => <p key={f.de} role="alert" className="faixa-aviso m-0 text-[14px]">{t(`Faltou de ${mmss(f.de)} a ${mmss(f.ate)}: esse trecho não chegou ao servidor.`, `Missing from ${mmss(f.de)} to ${mmss(f.ate)}: that part never reached the server.`)}</p>)}
      {parts.falhos.map((f) => (
        <p key={f.n} role="alert" className="faixa-erro m-0 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[14px]">
          <span>{t(`O trecho de ${mmss(f.inicio)} não foi transcrito: ${f.erro ?? "erro"}.`, `The part at ${mmss(f.inicio)} wasn't transcribed: ${f.erro ?? "error"}.`)}</span>
          {editor && <button type="button" className="btn-sec" disabled={attempt.isPending} onClick={() => attempt.mutate(f.n)}>{t("Tentar de novo", "Try again")}</button>}
        </p>
      ))}
      {attempt.isError && <p role="alert" className="faixa-erro m-0">{message(attempt.error)}</p>}
    </>
  );
}

/** One player at a time: the app's recording is heard passage by passage. */
function ListenParts({ tenantId, textoId: textId, arquivoId: fileId, nome: title, inicios: starts }: { tenantId: string; textoId: string; arquivoId: string; nome: string; inicios: number[] }) {
  const [home, setHome] = useState(starts[0] ?? 0);
  return (
    <div className="grid gap-1">
      {starts.length > 1 && (
        <label className="grid gap-1 text-[15px]">
          <span>{t("Trecho", "Part")}</span>
          <select className="entrada max-w-[220px]" value={home} onChange={(e) => setHome(Number(e.target.value))}>
            {starts.map((i) => <option key={i} value={i}>{t(`a partir de ${mmss(i)}`, `from ${mmss(i)}`)}</option>)}
          </select>
        </label>
      )}
      <audio key={home} controls preload="none" src={urlAudio(tenantId, textId, fileId, home)} aria-label={t(`Áudio: ${title}`, `Audio: ${title}`)} className="w-full max-w-[520px]" />
    </div>
  );
}

function Transcript({ tenantId, textoId: textId, arquivoId: fileId }: { tenantId: string; textoId: string; arquivoId: string }) {
  const [open, openSet] = useState(false);
  const q = useQuery({
    queryKey: [tenantId, "transcricao", fileId],
    queryFn: () => read(route.gravacoes[":arquivo"].transcricao.$get({ param: { tenantId, id: textId, arquivo: fileId } })),
    enabled: open,
  });
  return (
    <details className="text-[15px]" onToggle={(e) => openSet((e.target as HTMLDetailsElement).open)}>
      <summary className="link-acao w-fit cursor-pointer font-normal">{t("Ler a transcrição", "Read the transcript")}</summary>
      {q.isPending && open && <p role="status" className="mono m-0 mt-2 text-apoio">{t("carregando…", "loading…")}</p>}
      {q.isError && <p role="alert" className="faixa-erro m-0 mt-2">{message(q.error)}</p>}
      {q.data && (
        <ol className="m-0 mt-2 grid list-none gap-1 p-0">
          {q.data.trechos.map((tr) => (
            <li key={tr.inicio} className="grid grid-cols-[64px_1fr] gap-2"><span className="mono text-apoio">{mmss(tr.inicio)}</span><span>{tr.texto}</span></li>
          ))}
        </ol>
      )}
    </details>
  );
}
