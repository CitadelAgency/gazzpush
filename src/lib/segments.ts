// The arithmetic of recording in segments, pure: the Worker and the screen's recorder use the same functions.
// Measured on 05/11 with recording uploads: 48 kbps WebM transcribes up to 24.9 MB, with intermittent failures close to
// that. 120 s give about 720 KB and 25 s in the queue, and a failure loses two minutes, not the interview.
export const PER_SEGMENT_SECONDS = 120;
/** Two recorders together at the handover: no word falls into the seam. */
export const OVERLAP_S = 1;
export const PER_SLICE_SECONDS = 5;
export const SESSION_CAP_S = 3 * 3600;
export const SLICE_MAX_BYTES = 256 * 1024;
export const MAX_SEGMENTS = Math.ceil(SESSION_CAP_S / PER_SEGMENT_SECONDS);
/** How many slices a full segment has. The last one has whatever had time to be recorded. */
export const SLICES_PER_SEGMENT = Math.ceil((PER_SEGMENT_SECONDS + OVERLAP_S) / PER_SLICE_SECONDS);

export const fromSegmentHome = (n: number) => n * PER_SEGMENT_SECONDS;
/** The segment that plays second `t`: the same seam as the word cut. */
export const segmentTime = (t: number) => Math.max(0, Math.floor((t - OVERLAP_S / 2) / PER_SEGMENT_SECONDS));

/** What this segment counts: each word of the overlap stays on only one side of the seam. */
export function fromSegmentWindow(n: number, last: number) {
  const amendment = (i: number) => fromSegmentHome(i) + OVERLAP_S / 2;
  return { de: n === 0 ? 0 : amendment(n), ate: n === last ? Infinity : amendment(n + 1) };
}

export interface Word { p: string; i: number; f: number }
export interface TimePassage { inicio: number; fim: number; texto: string; palavras: Word[] }
const two = (n: number) => Math.round(n * 100) / 100;

/** Whisper passages in absolute time, without the overlap words the other segment counts. */
export function shiftPassages(
  segments: { start: number; end: number; text: string; words?: { word: string; start: number; end: number }[] }[],
  home: number, win: { de: number; ate: number },
): TimePassage[] {
  const inside = (t: number) => t >= win.de && t < win.ate;
  const output: TimePassage[] = [];
  for (const s of segments) {
    const text = s.text.trim().normalize('NFC');
    const all = (s.words ?? []).map((w) => ({ p: w.word, i: two(w.start + home), f: two(w.end + home) }));
    if (!all.length) {
      if (inside(s.start + home)) output.push({ inicio: two(s.start + home), fim: two(s.end + home), texto: text, palavras: [] });
      continue;
    }
    const words = all.filter((w) => inside(w.i));
    if (!words.length) continue;
    output.push({
      inicio: words[0].i, fim: words.at(-1)!.f, palavras: words,
      texto: words.length === all.length ? text : words.map((w) => w.p.trim()).join(' ').normalize('NFC'),
    });
  }
  return output;
}

export interface Missing { de: number; ate: number }

/**
 * The passages that did not arrive, by slice number. What is missing only in the overlap is not a loss: the neighbour
 * has it. `lastSegment`: its end is unknown, so it only counts gaps before the last slice that arrived.
 */
export function gapsSegment(n: number, slices: number[], lastSegment: boolean): Missing[] {
  const has = new Set(slices);
  const total = lastSegment ? Math.max(-1, ...slices) + 1 : SLICES_PER_SEGMENT;
  const gaps: Missing[] = [];
  for (let f = 0; f < total; f++) {
    if (has.has(f) || f * PER_SLICE_SECONDS >= PER_SEGMENT_SECONDS) continue;
    const from = fromSegmentHome(n) + f * PER_SLICE_SECONDS;
    const until = fromSegmentHome(n) + Math.min((f + 1) * PER_SLICE_SECONDS, PER_SEGMENT_SECONDS);
    const before = gaps.at(-1);
    if (before?.ate === from) before.ate = until;
    else gaps.push({ de: from, ate: until });
  }
  return gaps;
}

/** How far the recording is saved without gaps: "Saved up to mm:ss" only moves with the server's confirmation. */
export function savedUntil(confirmed: ReadonlySet<string>, s = PER_SEGMENT_SECONDS, slice = PER_SLICE_SECONDS) {
  let time = 0;
  for (let n = 0; ; n++) {
    for (let f = 0; f * slice < s; f++) {
      if (!confirmed.has(`${n}/${f}`)) return time;
      time = n * s + Math.min((f + 1) * slice, s);
    }
  }
}
