import type { IntonationContour } from "@/lib/ipc/schemas";

export type PhraseEnding = {
  /** 1-based position in the take. */
  index: number;
  startMs: number;
  endMs: number;
  direction: "rising" | "falling" | "level";
  /** Pitch change over the ending, in semitones (Estimated). */
  changeSemitones: number;
};

/** Unvoiced stretches shorter than this stay inside a phrase (consonants, short dips). */
const SPLIT_GAP_MS = 250;
/** Phrases with less voicing than this are too short to read an ending from. */
const MIN_VOICED_MS = 300;
/** The ending is the last stretch of voicing in the phrase. */
const ENDING_MS = 250;
/** Smaller movements than this read as level. */
const LEVEL_SEMITONES = 1.5;

/**
 * Phrase endings for the accessible readout (P.7): voiced stretches split at
 * pauses of 250 ms or more, each ending read as rising, falling or level from
 * the pitch at the start and end of its last 250 ms of voicing. Estimated data,
 * not advice: no ending is right or wrong.
 */
export function phraseEndings(c: IntonationContour): PhraseEnding[] {
  const hop = c.hopMs;
  const gapFrames = Math.ceil(SPLIT_GAP_MS / hop);
  const phrases: number[][] = [];
  let current: number[] = [];
  let lastVoiced = -Infinity;
  c.f0Hz.forEach((f0, i) => {
    if (f0 == null) return;
    if (i - lastVoiced > gapFrames && current.length) {
      phrases.push(current);
      current = [];
    }
    current.push(i);
    lastVoiced = i;
  });
  if (current.length) phrases.push(current);

  const endings: PhraseEnding[] = [];
  for (const frames of phrases) {
    if (frames.length * hop < MIN_VOICED_MS) continue;
    const last = frames[frames.length - 1];
    const tail = frames.filter((i) => i > last - ENDING_MS / hop);
    // Average a few frames at each edge so one jittery frame does not decide it.
    const edge = Math.max(1, Math.floor(tail.length / 4));
    const mean = (idx: number[]) => idx.reduce((sum, i) => sum + Math.log2(c.f0Hz[i]!), 0) / idx.length;
    const change = 12 * (mean(tail.slice(-edge)) - mean(tail.slice(0, edge)));
    endings.push({
      index: endings.length + 1,
      startMs: frames[0] * hop,
      endMs: (last + 1) * hop,
      direction: change >= LEVEL_SEMITONES ? "rising" : change <= -LEVEL_SEMITONES ? "falling" : "level",
      changeSemitones: Math.round(change * 10) / 10,
    });
  }
  return endings;
}
