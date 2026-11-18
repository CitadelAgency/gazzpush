// O gravador: MediaRecorder a 48 kbps, com tempo, nível do microfone e avisos na hora. Com `subir`, grava em segmentos
// (cada um decodificável sozinho, com 1 s de sobreposição entre dois recorders) e cada fatia vai ao servidor, e "Salvo até"
// só anda com a confirmação. Sem `subir` (a voz do Reels), grava um arquivo só, que `parar` devolve.
import { useCallback, useEffect, useRef, useState } from "react";
import { SEGUNDOS_POR_FATIA, SEGUNDOS_POR_SEGMENTO, SOBREPOSICAO_S, TETO_SESSAO_S, salvoAte } from "../../../src/lib/segmentos";
import { apagarFatia, guardarFatia } from "./fila";

export type Aviso = "rede" | "parou" | "trilha" | "silencio" | "escondida";
export type Subir = (f: { segmento: number; fatia: number; blob: Blob }) => Promise<void>;
export interface Opcoes { sessao?: string; subir?: Subir; segundos?: number; fatia?: number; teto?: number }

const SEM_CONFIRMACAO_MS = 15_000;
const SEM_SINAL_MS = 20_000;
const NIVEL_MINIMO = 0.01;
const espera = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

export const mimeDoGravador = () => (typeof MediaRecorder === "undefined" ? null : ["audio/webm;codecs=opus", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m)) ?? null);

interface Pendente { segmento: number; fatia: number; blob: Blob; desde: number }
interface Corrente {
  stream: MediaStream; ctx: AudioContext; analisador: AnalyserNode; mime: string; o: Opcoes; comeco: number; n: number;
  ativos: Set<MediaRecorder>; saindo: WeakSet<MediaRecorder>; parando: boolean; morta: boolean; enviando: boolean; pendentes: Map<string, Pendente>; confirmadas: Set<string>;
  pedacos: Blob[]; ultimoSom: number; relogio: number; wake: WakeLockSentinel | null; bombeando: Promise<void>;
}

export function useGravador() {
  const [gravando, setGravando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const [nivel, setNivel] = useState(0);
  const [salvo, setSalvo] = useState(0);
  const [avisos, setAvisos] = useState<ReadonlySet<Aviso>>(new Set());
  const atual = useRef<Corrente | null>(null);
  const parar = useRef<(() => Promise<Blob | null>) | null>(null);

  const apitar = useCallback((c: Corrente) => {
    navigator.vibrate?.(200);
    const osc = c.ctx.createOscillator();
    osc.frequency.value = 880;
    osc.connect(c.ctx.destination);
    osc.start();
    osc.stop(c.ctx.currentTime + 0.15);
  }, []);
  const marcar = useCallback((c: Corrente, a: Aviso, ligado: boolean) => {
    setAvisos((v) => {
      if (v.has(a) === ligado) return v;
      if (ligado) apitar(c);
      const novo = new Set(v);
      if (ligado) novo.add(a); else novo.delete(a);
      return novo;
    });
  }, [apitar]);

  const pedirTelaAcesa = useCallback(async (c: Corrente) => {
    c.wake = await navigator.wakeLock?.request("screen").catch(() => null) ?? null;
  }, []);

  /** Uma fatia por vez, na ordem; a que não sobe espera e tenta de novo, sem parar a gravação. */
  const bombear = useCallback((c: Corrente) => {
    if (c.enviando) return;
    c.enviando = true;
    c.bombeando = (async () => {
      while (c.pendentes.size && !c.morta) {
        const [chave, p] = c.pendentes.entries().next().value as [string, Pendente];
        try {
          await c.o.subir!({ segmento: p.segmento, fatia: p.fatia, blob: p.blob });
          c.pendentes.delete(chave);
          c.confirmadas.add(chave);
          setSalvo(salvoAte(c.confirmadas, c.o.segundos ?? SEGUNDOS_POR_SEGMENTO, c.o.fatia ?? SEGUNDOS_POR_FATIA));
          void apagarFatia({ sessao: c.o.sessao!, segmento: p.segmento, fatia: p.fatia }).catch(() => {});
        } catch {
          await espera(3000);
        }
      }
      c.enviando = false;
    })();
  }, []);

  const novoRecorder = useCallback((c: Corrente, n: number) => {
    const rec = new MediaRecorder(c.stream, { mimeType: c.mime, audioBitsPerSecond: 48_000 });
    let fatia = 0;
    rec.ondataavailable = (e) => {
      if (!e.data.size) return;
      if (!c.o.subir) { c.pedacos.push(e.data); return; }
      const f = { segmento: n, fatia: fatia++, blob: e.data };
      c.pendentes.set(`${n}/${f.fatia}`, { ...f, desde: Date.now() });
      void guardarFatia({ sessao: c.o.sessao!, ...f }).catch(() => {});
      bombear(c);
    };
    rec.onerror = () => marcar(c, "parou", true);
    rec.onstop = () => {
      c.ativos.delete(rec);
      if (!c.parando && !c.saindo.has(rec)) marcar(c, "parou", true);
    };
    rec.start((c.o.fatia ?? SEGUNDOS_POR_FATIA) * 1000);
    c.ativos.add(rec);
  }, [bombear, marcar]);

  const soltar = useCallback((c: Corrente) => {
    window.clearInterval(c.relogio);
    c.stream.getTracks().forEach((t) => t.stop());
    void c.wake?.release().catch(() => {});
    void c.ctx.close().catch(() => {});
  }, []);

  const iniciar = useCallback(async (o: Opcoes = {}) => {
    const mime = mimeDoGravador();
    if (!mime) throw new Error("sem-gravador");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new AudioContext();
    const analisador = ctx.createAnalyser();
    analisador.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analisador);
    const agora = Date.now();
    const c: Corrente = {
      stream, ctx, analisador, mime, o, comeco: agora, n: 0, ativos: new Set(), saindo: new WeakSet(), parando: false, morta: false, enviando: false,
      pendentes: new Map(), confirmadas: new Set(), pedacos: [], ultimoSom: agora, relogio: 0, wake: null, bombeando: Promise.resolve(),
    };
    atual.current = c;
    setSegundos(0); setSalvo(0); setAvisos(new Set()); setGravando(true);
    for (const t of stream.getAudioTracks()) {
      t.onended = () => { if (!c.parando) marcar(c, "trilha", true); };
      t.onmute = () => marcar(c, "trilha", true);
      t.onunmute = () => marcar(c, "trilha", false);
    }
    void pedirTelaAcesa(c);
    novoRecorder(c, 0);
    const amostra = new Uint8Array(analisador.fftSize);
    const passo = o.segundos ?? SEGUNDOS_POR_SEGMENTO;
    c.relogio = window.setInterval(() => {
      const agora = Date.now();
      const t = (agora - c.comeco) / 1000;
      setSegundos(t);
      analisador.getByteTimeDomainData(amostra);
      const rms = Math.sqrt(amostra.reduce((s, v) => s + ((v - 128) / 128) ** 2, 0) / amostra.length);
      setNivel(Math.min(1, rms * 3));
      if (rms >= NIVEL_MINIMO) c.ultimoSom = agora;
      marcar(c, "silencio", agora - c.ultimoSom > SEM_SINAL_MS);
      if (t >= (o.teto ?? TETO_SESSAO_S)) { marcar(c, "parou", true); void parar.current?.(); return; }
      if (!o.subir) return;
      marcar(c, "rede", [...c.pendentes.values()].some((p) => agora - p.desde > SEM_CONFIRMACAO_MS));
      // A virada: o novo começa antes de o velho parar, e nenhuma palavra cai na emenda.
      if (t >= (c.n + 1) * passo) {
        const velho = [...c.ativos].at(-1);
        c.n++;
        novoRecorder(c, c.n);
        if (velho) {
          c.saindo.add(velho);
          window.setTimeout(() => { if (velho.state !== "inactive") velho.stop(); }, SOBREPOSICAO_S * 1000);
        }
      }
    }, 250);
  }, [marcar, novoRecorder, pedirTelaAcesa]);

  /** Para e espera o que falta subir. Sem `subir`, devolve o arquivo. */
  const pararAgora = useCallback(async () => {
    const c = atual.current;
    if (!c) return null;
    c.parando = true;
    await Promise.all([...c.ativos].map((rec) => new Promise<void>((ok) => {
      rec.addEventListener("stop", () => ok(), { once: true });
      if (rec.state === "inactive") ok(); else rec.stop();
    })));
    soltar(c);
    setGravando(false);
    setNivel(0);
    if (!c.o.subir) return new Blob(c.pedacos, { type: c.mime.split(";")[0] });
    while (c.pendentes.size) { bombear(c); await c.bombeando; }
    return null;
  }, [bombear, soltar]);
  parar.current = pararAgora;

  useEffect(() => {
    const mudou = () => {
      const c = atual.current;
      if (!c || c.parando) return;
      marcar(c, "escondida", document.hidden);
      if (!document.hidden) void pedirTelaAcesa(c);
    };
    document.addEventListener("visibilitychange", mudou);
    return () => {
      document.removeEventListener("visibilitychange", mudou);
      const c = atual.current;
      if (c && !c.parando) {
        c.parando = true;
        c.morta = true;
        c.ativos.forEach((rec) => rec.state !== "inactive" && rec.stop());
        soltar(c);
      }
    };
  }, [marcar, pedirTelaAcesa, soltar]);

  return { gravando, segundos, nivel, salvo, avisos, iniciar, parar: pararAgora };
}
