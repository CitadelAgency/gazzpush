// The recorder: MediaRecorder at 48 kbps, with time, microphone level and on-the-spot warnings. With `subir`, it records
// in segments (each decodable on its own, with 1 s of overlap between two recorders) and each slice goes to the server,
// and "Saved up to" only moves with the confirmation. Without `subir` (the Reels voice), it records a single file, which
// `parar` returns.
import { useCallback, useEffect, useRef, useState } from "react";
import { PER_SLICE_SECONDS, PER_SEGMENT_SECONDS, OVERLAP_S, SESSION_CAP_S, savedUntil } from "../../../src/lib/segments";
import { deleteSlice, saveSlice } from "./queue";

export type Warning = "rede" | "parou" | "trilha" | "silencio" | "escondida";
export type Upload = (f: { segmento: number; fatia: number; blob: Blob }) => Promise<void>;
export interface Options { sessao?: string; subir?: Upload; segundos?: number; fatia?: number; teto?: number }

const WITHOUT_CONFIRMATION_MS = 15_000;
const WITHOUT_SIGNAL_MS = 20_000;
const MIN_LEVEL = 0.01;
const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

export const mimeRecorder = () => (typeof MediaRecorder === "undefined" ? null : ["audio/webm;codecs=opus", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m)) ?? null);

interface Pending { segmento: number; fatia: number; blob: Blob; desde: number }
interface Current {
  stream: MediaStream; ctx: AudioContext; analisador: AnalyserNode; mime: string; o: Options; comeco: number; n: number;
  ativos: Set<MediaRecorder>; saindo: WeakSet<MediaRecorder>; parando: boolean; morta: boolean; enviando: boolean; pendentes: Map<string, Pending>; confirmadas: Set<string>;
  pedacos: Blob[]; ultimoSom: number; relogio: number; wake: WakeLockSentinel | null; bombeando: Promise<void>;
}

export function useRecorder() {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [saved, savedSet] = useState(0);
  const [warnings, setWarnings] = useState<ReadonlySet<Warning>>(new Set());
  const current = useRef<Current | null>(null);
  const stop = useRef<(() => Promise<Blob | null>) | null>(null);

  const beep = useCallback((c: Current) => {
    navigator.vibrate?.(200);
    const osc = c.ctx.createOscillator();
    osc.frequency.value = 880;
    osc.connect(c.ctx.destination);
    osc.start();
    osc.stop(c.ctx.currentTime + 0.15);
  }, []);
  const mark = useCallback((c: Current, a: Warning, on: boolean) => {
    setWarnings((v) => {
      if (v.has(a) === on) return v;
      if (on) beep(c);
      const created = new Set(v);
      if (on) created.add(a); else created.delete(a);
      return created;
    });
  }, [beep]);

  const requestScreenLit = useCallback(async (c: Current) => {
    c.wake = await navigator.wakeLock?.request("screen").catch(() => null) ?? null;
  }, []);

  /** One slice at a time, in order; one that does not upload waits and tries again, without stopping the recording. */
  const pump = useCallback((c: Current) => {
    if (c.enviando) return;
    c.enviando = true;
    c.bombeando = (async () => {
      while (c.pendentes.size && !c.morta) {
        const [key, p] = c.pendentes.entries().next().value as [string, Pending];
        try {
          await c.o.subir!({ segmento: p.segmento, fatia: p.fatia, blob: p.blob });
          c.pendentes.delete(key);
          c.confirmadas.add(key);
          savedSet(savedUntil(c.confirmadas, c.o.segundos ?? PER_SEGMENT_SECONDS, c.o.fatia ?? PER_SLICE_SECONDS));
          void deleteSlice({ sessao: c.o.sessao!, segmento: p.segmento, fatia: p.fatia }).catch(() => {});
        } catch {
          await wait(3000);
        }
      }
      c.enviando = false;
    })();
  }, []);

  const newRecorder = useCallback((c: Current, n: number) => {
    const rec = new MediaRecorder(c.stream, { mimeType: c.mime, audioBitsPerSecond: 48_000 });
    let slice = 0;
    rec.ondataavailable = (e) => {
      if (!e.data.size) return;
      if (!c.o.subir) { c.pedacos.push(e.data); return; }
      const f = { segmento: n, fatia: slice++, blob: e.data };
      c.pendentes.set(`${n}/${f.fatia}`, { ...f, desde: Date.now() });
      void saveSlice({ sessao: c.o.sessao!, ...f }).catch(() => {});
      pump(c);
    };
    rec.onerror = () => mark(c, "parou", true);
    rec.onstop = () => {
      c.ativos.delete(rec);
      if (!c.parando && !c.saindo.has(rec)) mark(c, "parou", true);
    };
    rec.start((c.o.fatia ?? PER_SLICE_SECONDS) * 1000);
    c.ativos.add(rec);
  }, [pump, mark]);

  const release = useCallback((c: Current) => {
    window.clearInterval(c.relogio);
    c.stream.getTracks().forEach((t) => t.stop());
    void c.wake?.release().catch(() => {});
    void c.ctx.close().catch(() => {});
  }, []);

  const start = useCallback(async (o: Options = {}) => {
    const mime = mimeRecorder();
    if (!mime) throw new Error("sem-gravador");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new AudioContext();
    const analyzer = ctx.createAnalyser();
    analyzer.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyzer);
    const now = Date.now();
    const c: Current = {
      stream, ctx, analisador: analyzer, mime, o, comeco: now, n: 0, ativos: new Set(), saindo: new WeakSet(), parando: false, morta: false, enviando: false,
      pendentes: new Map(), confirmadas: new Set(), pedacos: [], ultimoSom: now, relogio: 0, wake: null, bombeando: Promise.resolve(),
    };
    current.current = c;
    setSeconds(0); savedSet(0); setWarnings(new Set()); setRecording(true);
    for (const t of stream.getAudioTracks()) {
      t.onended = () => { if (!c.parando) mark(c, "trilha", true); };
      t.onmute = () => mark(c, "trilha", true);
      t.onunmute = () => mark(c, "trilha", false);
    }
    void requestScreenLit(c);
    newRecorder(c, 0);
    const sample = new Uint8Array(analyzer.fftSize);
    const step = o.segundos ?? PER_SEGMENT_SECONDS;
    c.relogio = window.setInterval(() => {
      const now = Date.now();
      const t = (now - c.comeco) / 1000;
      setSeconds(t);
      analyzer.getByteTimeDomainData(sample);
      const rms = Math.sqrt(sample.reduce((s, v) => s + ((v - 128) / 128) ** 2, 0) / sample.length);
      setLevel(Math.min(1, rms * 3));
      if (rms >= MIN_LEVEL) c.ultimoSom = now;
      mark(c, "silencio", now - c.ultimoSom > WITHOUT_SIGNAL_MS);
      if (t >= (o.teto ?? SESSION_CAP_S)) { mark(c, "parou", true); void stop.current?.(); return; }
      if (!o.subir) return;
      mark(c, "rede", [...c.pendentes.values()].some((p) => now - p.desde > WITHOUT_CONFIRMATION_MS));
      // The handover: the new one starts before the old one stops, and no word falls into the seam.
      if (t >= (c.n + 1) * step) {
        const old = [...c.ativos].at(-1);
        c.n++;
        newRecorder(c, c.n);
        if (old) {
          c.saindo.add(old);
          window.setTimeout(() => { if (old.state !== "inactive") old.stop(); }, OVERLAP_S * 1000);
        }
      }
    }, 250);
  }, [mark, newRecorder, requestScreenLit]);

  /** Stops and waits for what is left to upload. Without `subir`, returns the file. */
  const stopNow = useCallback(async () => {
    const c = current.current;
    if (!c) return null;
    c.parando = true;
    await Promise.all([...c.ativos].map((rec) => new Promise<void>((ok) => {
      rec.addEventListener("stop", () => ok(), { once: true });
      if (rec.state === "inactive") ok(); else rec.stop();
    })));
    release(c);
    setRecording(false);
    setLevel(0);
    if (!c.o.subir) return new Blob(c.pedacos, { type: c.mime.split(";")[0] });
    while (c.pendentes.size) { pump(c); await c.bombeando; }
    return null;
  }, [pump, release]);
  stop.current = stopNow;

  useEffect(() => {
    const changed = () => {
      const c = current.current;
      if (!c || c.parando) return;
      mark(c, "escondida", document.hidden);
      if (!document.hidden) void requestScreenLit(c);
    };
    document.addEventListener("visibilitychange", changed);
    return () => {
      document.removeEventListener("visibilitychange", changed);
      const c = current.current;
      if (c && !c.parando) {
        c.parando = true;
        c.morta = true;
        c.ativos.forEach((rec) => rec.state !== "inactive" && rec.stop());
        release(c);
      }
    };
  }, [mark, requestScreenLit, release]);

  return { gravando: recording, segundos: seconds, nivel: level, salvo: saved, avisos: warnings, iniciar: start, parar: stopNow };
}
