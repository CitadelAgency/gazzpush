// Gravar no app: o tempo, o nível do microfone e "Salvo até mm:ss", que só anda com a confirmação do servidor. Fechar a aba
// não perde o que subiu: ao voltar, a tela oferece concluir, e o cron conclui sessão parada há mais de 2 horas.
import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { cabecalhoIdioma, ErroApi } from "../api";
import { apagarFatia, fatiasDaSessao } from "../gravador/fila";
import { mimeDoGravador, useGravador, type Aviso } from "../gravador/useGravador";
import { t } from "../idioma";
import { mensagem, type EstadoMesa } from "./comum";
import { mmss } from "./Gravacoes";

const textoDoAviso = (a: Aviso) => ({
  rede: t("Sem confirmação do servidor há 15 s. A gravação continua e sobe quando a rede voltar.", "No confirmation from the server for 15 s. Recording continues and uploads when the connection returns."),
  parou: t("A gravação parou. Toque em Gravar para continuar numa gravação nova.", "Recording stopped. Tap Record to continue in a new recording."),
  trilha: t("O microfone foi cortado, talvez por uma ligação.", "The microphone was cut off, perhaps by a call."),
  silencio: t("Nenhum som no microfone há 20 s. Confira se ele está ligado.", "No sound from the microphone for 20 s. Check that it's on."),
  escondida: t("O app saiu da frente. No celular, isso pode cortar a gravação.", "The app is in the background. On a phone, this can cut the recording."),
})[a];

export function GravarAgora({ tenantId, textoId, estado, atualizar, avisar }: {
  tenantId: string; textoId: string; estado: EstadoMesa; atualizar: (d: EstadoMesa) => void; avisar: (s: string | null) => void;
}) {
  const base = `/api/t/${encodeURIComponent(tenantId)}/textos/${encodeURIComponent(textoId)}/gravacoes/sessao`;
  const g = useGravador();
  const [ativa, setAtiva] = useState<string | null>(null);
  const encerrada = useRef(new Set<string>());
  // A parte pode fechar com a gravação andando: o estado e o primeiro aviso sobem para a linha dela.
  const [primeiro] = g.avisos;
  const situacao = g.gravando ? (primeiro ? textoDoAviso(primeiro) : t("gravando agora", "recording now")) : null;
  useEffect(() => { avisar(situacao); }, [situacao, avisar]);

  async function chamar(url: string, init: RequestInit) {
    let r: Response;
    try {
      r = await fetch(url, { ...init, headers: { ...cabecalhoIdioma(), ...init.headers } });
    } catch {
      throw new ErroApi(0, t("Sem conexão com o servidor.", "No connection to the server."));
    }
    const b = (await r.json().catch(() => null)) as ({ erro?: string; code?: string } & Record<string, unknown>) | null;
    if (!r.ok) throw new ErroApi(r.status, b?.erro ?? `Erro ${r.status}`, b?.code, b);
    return b;
  }
  const subir = (sessao: string, f: { segmento: number; fatia: number; blob: Blob }) =>
    chamar(`${base}/${sessao}/${f.segmento}/${f.fatia}`, { method: "PUT", headers: { "content-type": "application/octet-stream" }, body: f.blob });
  const concluirSessao = async (sessao: string) => atualizar(await chamar(`${base}/${sessao}/concluir`, { method: "POST" }) as EstadoMesa);

  const comecar = useMutation({
    mutationFn: async () => {
      const mime = mimeDoGravador();
      if (!mime) throw new ErroApi(0, t("Este navegador não grava áudio.", "This browser can't record audio."));
      const r = await chamar(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mime }) }) as { sessao: string; segundos: number; fatia: number };
      try {
        await g.iniciar({ sessao: r.sessao, segundos: r.segundos, fatia: r.fatia, subir: (f) => subir(r.sessao, f).then(() => undefined) });
      } catch {
        throw new ErroApi(0, t("O navegador não liberou o microfone.", "The browser didn't allow the microphone."));
      }
      setAtiva(r.sessao);
    },
  });
  const parar = useMutation({
    mutationFn: async () => {
      await g.parar();
      await concluirSessao(ativa!);
      encerrada.current.add(ativa!);
      setAtiva(null);
    },
  });
  // Voltou depois de fechar a aba: o que ficou guardado sobe antes de concluir.
  const retomar = useMutation({
    mutationFn: async (sessao: string) => {
      for (const f of await fatiasDaSessao(sessao).catch(() => [])) {
        await subir(sessao, f);
        await apagarFatia(f).catch(() => {});
      }
      await concluirSessao(sessao);
    },
  });

  const abertas = estado.sessoesAbertas.filter((s) => s.id !== ativa && !encerrada.current.has(s.id));
  return (
    <div className="grid gap-2">
      {abertas.map((s) => (
        <p key={s.id} className="faixa-aviso m-0 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span>{t(`Uma gravação de ${s.criadoEm.slice(0, 10).split("-").reverse().join("/")} ficou sem concluir.`, `A recording from ${s.criadoEm.slice(0, 10)} wasn't finished.`)}</span>
          <button type="button" className="btn-sec" disabled={retomar.isPending} onClick={() => retomar.mutate(s.id)}>{t("Concluir", "Finish")}</button>
        </p>
      ))}
      {!g.gravando && !parar.isPending ? (
        <div className="grid gap-1">
          <button type="button" className="btn-sec justify-self-start bg-papel-2" disabled={comecar.isPending} onClick={() => comecar.mutate()}>
            {comecar.isPending ? t("Abrindo o microfone…", "Opening the microphone…") : t("Gravar", "Record")}
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
          {[...g.avisos].map((a) => <p key={a} role="alert" className="faixa-erro m-0 text-[14px]">{textoDoAviso(a)}</p>)}
          <button type="button" className="btn-tinta justify-self-start" disabled={parar.isPending} onClick={() => parar.mutate()}>
            {parar.isPending ? t("Subindo o que falta…", "Uploading the rest…") : t("Parar e concluir", "Stop and finish")}
          </button>
        </div>
      )}
      {[comecar, parar, retomar].map((m, i) => m.isError && <p key={i} role="alert" className="faixa-erro m-0">{mensagem(m.error)}</p>)}
    </div>
  );
}
