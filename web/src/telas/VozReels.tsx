// "Com a sua voz" na tela do Reels: o roteiro (títulos e frases dos cards, sem o convite), gravar ou enviar arquivo, até 90 s.
// A fala é comparada com o roteiro por código. Cada aviso pede decisão de uma pessoa, e "Fazer o Reels" só libera com todos
// decididos. A transcrição não aparece: o que a tela mostra é o tempo para ouvir.
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { roteiroDoReels } from "../../../src/lib/fala";
import type { Card } from "../../../src/lib/cards";
import { cabecalhoIdioma, ErroApi } from "../api";
import { abrirTrecho } from "../gravador/ouvir";
import { mimeDoGravador, useGravador } from "../gravador/useGravador";
import { t as tr } from "../idioma";
import { mmss } from "../materia/Gravacoes";

const TETO_S = 90;
export interface EstadoVoz { id: string; duracao: number | null; pronta: boolean }
interface Aviso { tipo: "numero" | "nome" | "fora"; motivo: "ausente" | "trocado" | "extra"; esperado: string | null; inicio: number; decisao?: string | null }
interface Narracao { id: string; estado: "lendo" | "pronto" | "falhou"; erro: string | null; duracao: number | null; avisos: Aviso[] }

async function chamar<T>(url: string, init: RequestInit = {}): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, { ...init, headers: { ...cabecalhoIdioma(), ...init.headers } });
  } catch {
    throw new ErroApi(0, tr("Sem conexão com o servidor.", "No connection to the server."));
  }
  const b = (await r.json().catch(() => null)) as (T & { erro?: string }) | null;
  if (!r.ok) throw new ErroApi(r.status, b?.erro ?? `Erro ${r.status}`);
  return b as T;
}

const textoDoAviso = (a: Aviso) => {
  if (a.tipo === "fora") return tr("Há fala fora do roteiro.", "There's speech outside the script.");
  const oque = a.tipo === "numero" ? tr(`o número ${a.esperado}`, `the number ${a.esperado}`) : tr(`o nome ${a.esperado}`, `the name ${a.esperado}`);
  return a.motivo === "trocado" ? tr(`Confira ${oque}: pode ter saído trocado.`, `Check ${oque}: it may have come out wrong.`) : tr(`Não encontramos ${oque} na fala.`, `We didn't find ${oque} in the speech.`);
};

export function VozReels({ tenantId, pecaId, cards, mudou }: { tenantId: string; pecaId: string; cards: Card[]; mudou: (v: EstadoVoz | null) => void }) {
  const base = `/api/t/${encodeURIComponent(tenantId)}/pecas/${encodeURIComponent(pecaId)}/narracao`;
  const chave = [tenantId, "narracao", pecaId];
  const qc = useQueryClient();
  const roteiro = useMemo(() => roteiroDoReels(cards), [cards]);
  const g = useGravador();
  const atual = useQuery({
    queryKey: chave,
    queryFn: () => chamar<{ narracao: Narracao | null }>(base),
    refetchInterval: (q) => (q.state.data?.narracao?.estado === "lendo" ? 2000 : false),
  });
  const n = atual.data?.narracao ?? null;
  const pendentes = n?.avisos.filter((a) => !a.decisao).length ?? 0;
  useEffect(() => {
    mudou(n?.estado === "pronto" ? { id: n.id, duracao: n.duracao, pronta: !pendentes } : null);
  }, [n?.id, n?.estado, n?.duracao, pendentes]); // eslint-disable-line react-hooks/exhaustive-deps

  const enviar = useMutation({
    mutationFn: (corpo: Blob) => chamar<{ id: string }>(base, { method: "POST", headers: { "content-type": corpo.type || "application/octet-stream" }, body: corpo }),
    onSuccess: () => qc.invalidateQueries({ queryKey: chave }),
  });
  const decidir = useMutation({
    mutationFn: (i: number) => chamar(`${base}/${n!.id}/avisos/${i}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decisao: "fala_certa" }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: chave }),
  });
  const [erroMic, setErroMic] = useState<string | null>(null);
  const [falhouOuvir, setFalhouOuvir] = useState(false);
  const som = useRef<HTMLAudioElement | null>(null);

  async function gravar() {
    setErroMic(null);
    if (!mimeDoGravador()) { setErroMic(tr("Este navegador não grava áudio. Envie um arquivo.", "This browser can't record audio. Upload a file.")); return; }
    await g.iniciar().catch(() => setErroMic(tr("O navegador não liberou o microfone.", "The browser didn't allow the microphone.")));
  }
  async function parar() {
    const blob = await g.parar();
    if (blob?.size) enviar.mutate(blob);
  }
  useEffect(() => { if (g.gravando && g.segundos >= TETO_S) void parar(); }, [g.gravando, g.segundos]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { som.current?.pause(); }, []);

  function escolher(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) enviar.mutate(f);
  }
  async function ouvir(inicio: number) {
    setFalhouOuvir(false);
    try {
      som.current?.pause();
      const { a } = await abrirTrecho(`${base}/${n!.id}/audio`);
      som.current = a;
      const ate = inicio + 4;
      a.ontimeupdate = () => { if (a.currentTime >= ate) a.pause(); };
      a.currentTime = Math.max(0, inicio - 1);
      await a.play();
    } catch {
      setFalhouOuvir(true);
    }
  }

  const ocupado = enviar.isPending || n?.estado === "lendo";
  return (
    <div className="grid gap-3">
      <details className="text-[15px]" open>
        <summary className="min-h-11 cursor-pointer content-center font-bold text-texto-forte">{tr("Roteiro", "Script")}</summary>
        <ol className="m-0 mt-1 grid gap-1 pl-5">{roteiro.map((p, i) => <li key={i}>{p.texto}</li>)}</ol>
      </details>
      <p className="ajuda m-0">{tr("Leia o roteiro como está, em até 90 s. O convite do último card não entra na fala.", "Read the script as written, in up to 90 s. The last card's invite isn't part of the speech.")}</p>

      {g.gravando ? (
        <div className="grid gap-2 rounded-card bg-branco px-3 py-3 shadow-curta" role="group" aria-label={tr("Gravação em andamento", "Recording in progress")}>
          <span className="mono text-[24px] text-texto-forte">{mmss(g.segundos)} <span className="text-[15px] text-apoio">/ 01:30</span></span>
          <div role="meter" aria-label={tr("Nível do microfone", "Microphone level")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(g.nivel * 100)} className="h-2 w-full bg-papel-2">
            <div className="h-full bg-texto-forte" style={{ width: `${Math.round(g.nivel * 100)}%` }} />
          </div>
          <button type="button" className="btn-tinta justify-self-start" onClick={() => void parar()}>{tr("Parar", "Stop")}</button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-sec bg-papel-2" disabled={ocupado} onClick={() => void gravar()}>{n ? tr("Gravar de novo", "Record again") : tr("Gravar a voz", "Record your voice")}</button>
          <label className="btn-sec bg-papel-2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-texto-forte">
            {tr("Enviar arquivo", "Upload a file")}
            <input type="file" accept="audio/*,.mp3,.m4a,.wav,.ogg,.flac,.webm" className="sr-only" onChange={escolher} disabled={ocupado} />
          </label>
        </div>
      )}

      {ocupado && <p role="status" className="mono m-0 text-apoio">{tr("Conferindo a fala com o roteiro…", "Checking the speech against the script…")}</p>}
      {erroMic && <p role="alert" className="faixa-erro m-0">{erroMic}</p>}
      {enviar.isError && <p role="alert" className="faixa-erro m-0">{(enviar.error as Error).message}</p>}
      {n?.estado === "falhou" && <p role="alert" className="faixa-erro m-0">{tr(`Não deu para conferir a fala: ${n.erro ?? "erro"}.`, `Couldn't check the speech: ${n.erro ?? "error"}.`)}</p>}
      {n?.estado === "pronto" && !n.avisos.length && <p role="status" className="m-0 text-[15px] text-verde">{tr("Números e nomes conferem com o roteiro.", "Numbers and names match the script.")}</p>}
      {n?.estado === "pronto" && n.avisos.length > 0 && (
        <ul aria-label={tr("Avisos da fala", "Speech warnings")} className="m-0 grid list-none gap-2 p-0">
          {n.avisos.map((a, i) => (
            <li key={i} className="grid gap-1 border-t border-fio pt-2">
              <span className="text-[15px] text-texto-forte">{textoDoAviso(a)} <span className="mono text-apoio">{mmss(a.inicio)}</span></span>
              <span className="flex flex-wrap items-center gap-2">
                <button type="button" className="btn-sec min-h-11 bg-papel-2 px-3 text-[14px]" onClick={() => void ouvir(a.inicio)}>{tr("Ouvir", "Listen")}<span className="sr-only"> {mmss(a.inicio)}</span></button>
                {a.decisao ? <span className="mono text-verde">{tr("a fala está certa", "the speech is right")}</span> : (
                  <button type="button" className="btn-sec min-h-11 bg-papel-2 px-3 text-[14px]" disabled={decidir.isPending} onClick={() => decidir.mutate(i)}>{tr("A fala está certa", "The speech is right")}<span className="sr-only"> {mmss(a.inicio)}</span></button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {falhouOuvir && <p role="alert" className="m-0 text-[15px] text-terracota">{tr("O navegador não tocou o áudio.", "The browser couldn't play the audio.")}</p>}
    </div>
  );
}
