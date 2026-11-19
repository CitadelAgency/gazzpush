// Minimal real audio for the Worker tests and the recordings e2e (Phase 6): the format is read from the file's start,
// so a valid WAV is enough; the sound does not matter (the transcript is simulated).
/** A minimal real WAV (8 kHz, 8 bits, mono) with `seg` seconds of silence. */
export function fakeWav(seg = 1, brand = 0): Uint8Array<ArrayBuffer> {
  const n = 8000 * seg;
  const b = new Uint8Array(44 + n);
  const v = new DataView(b.buffer);
  const s = (i: number, x: string) => [...x].forEach((c, k) => { b[i + k] = c.charCodeAt(0); });
  s(0, 'RIFF'); v.setUint32(4, 36 + n, true); s(8, 'WAVE'); s(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); s(36, 'data'); v.setUint32(40, n, true);
  b.fill(128, 44);
  b[44] = 128 + brand;   // changes the hash without changing the sound
  return b;
}
