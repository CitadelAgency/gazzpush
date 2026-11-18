/** Áudio do MediaRecorder: vem inteiro para a memória, e o navegador acha a duração varrendo até o fim, porque o WebM não a traz. */
export async function abrirTrecho(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(String(r.status));
  const a = new Audio(URL.createObjectURL(await r.blob()));
  await new Promise<void>((ok, falhou) => {
    a.onerror = () => falhou(new Error("audio"));
    a.onloadedmetadata = () => {
      if (Number.isFinite(a.duration)) { ok(); return; }
      a.ondurationchange = () => { if (Number.isFinite(a.duration)) { a.ondurationchange = null; ok(); } };
      a.currentTime = 1e7;
    };
  });
  return { a, inicio: Number(r.headers.get("x-inicio")) || 0 };
}
