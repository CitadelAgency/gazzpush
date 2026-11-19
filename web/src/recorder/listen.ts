/** MediaRecorder audio: it comes whole into memory, and the browser finds the duration by scanning to the end, because WebM does not carry it. */
export async function openPassage(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(String(r.status));
  const a = new Audio(URL.createObjectURL(await r.blob()));
  await new Promise<void>((ok, failed) => {
    a.onerror = () => failed(new Error("audio"));
    a.onloadedmetadata = () => {
      if (Number.isFinite(a.duration)) { ok(); return; }
      a.ondurationchange = () => { if (Number.isFinite(a.duration)) { a.ondurationchange = null; ok(); } };
      a.currentTime = 1e7;
    };
  });
  return { a, inicio: Number(r.headers.get("x-inicio")) || 0 };
}
