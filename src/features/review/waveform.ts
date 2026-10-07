import type { WaveformPeaks } from "@/lib/ipc/schemas";

/** Shortest loop the player accepts; shorter ranges are not useful to hear. */
export const MIN_LOOP_MS = 300;

export interface LoopRange {
  startMs: number;
  endMs: number;
}

/** "1:02.5" → 62500, "45" → 45000, "0:07" → 7000. Returns null for anything else. */
export function parseClock(text: string): number | null {
  const match = /^\s*(?:(\d+):)?(\d+(?:\.\d{1,3})?)\s*$/.exec(text);
  if (!match) return null;
  const minutes = match[1] === undefined ? 0 : Number(match[1]);
  const seconds = Number(match[2]);
  if (match[1] !== undefined && seconds >= 60) return null;
  return Math.round((minutes * 60 + seconds) * 1000);
}

/** "1:02.5" with tenths, for loop fields where whole seconds are too coarse. */
export function formatClockTenths(ms: number): string {
  const tenths = Math.max(0, Math.round(ms / 100));
  const m = Math.floor(tenths / 600);
  const s = (tenths % 600) / 10;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

/** Clamps a requested range into the take; null when it is too short to loop. */
export function normalizeLoop(startMs: number, endMs: number, durationMs: number): LoopRange | null {
  const start = Math.min(Math.max(0, Math.min(startMs, endMs)), durationMs);
  const end = Math.min(Math.max(0, Math.max(startMs, endMs)), durationMs);
  return end - start >= MIN_LOOP_MS ? { startMs: start, endMs: end } : null;
}

/**
 * Where playback should jump, or null to keep going. While playing, only the
 * loop end wraps, so the user can still seek elsewhere; pressing Play outside
 * the range starts at the loop.
 */
export function loopSeekTarget(positionMs: number, loop: LoopRange | null, starting = false): number | null {
  if (!loop) return null;
  if (positionMs >= loop.endMs) return loop.startMs;
  return starting && positionMs < loop.startMs ? loop.startMs : null;
}

/** WaveSurfer wants one normalised channel; native peaks are 0–32767 maxima. */
export function toChannelPeaks(peaks: WaveformPeaks): Float32Array[] {
  return [Float32Array.from(peaks.peaks, (p) => p / 32767)];
}
