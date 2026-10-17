/**
 * Catch it (roadmap 11.6): press when you hear a filler while your take plays
 * with the transcript hidden. Filler timings are approximate, so a press
 * counts when it falls inside a segment that holds a confirmed filler; each
 * filler is caught at most once. The result is Estimated.
 */
export type FillerSpan = { startMs: number; endMs: number };
export type CatchResult = { caught: number; total: number; matched: (number | null)[]; extra: number };

/** Matches presses to fillers: each press to the first uncaught filler whose segment contains it. */
export function matchPresses(presses: readonly number[], fillers: readonly FillerSpan[]): CatchResult {
  const caughtBy: (number | null)[] = fillers.map(() => null);
  let extra = 0;
  [...presses].sort((a, b) => a - b).forEach((press, i) => {
    const filler = fillers.findIndex((f, k) => caughtBy[k] === null && press >= f.startMs && press <= f.endMs);
    if (filler >= 0) caughtBy[filler] = i;
    else extra += 1;
  });
  return { caught: caughtBy.filter((c) => c !== null).length, total: fillers.length, matched: caughtBy, extra };
}

/** The spans to catch from a reviewed transcript: one per confirmed filler, in its timed segment. */
export function confirmedFillerSpans(
  fillers: readonly { segment: number; decision: "confirmed" | "dismissed" | null }[],
  segments: readonly { startMs: number; endMs: number }[],
): FillerSpan[] {
  return fillers.flatMap((f) => {
    const s = segments[f.segment];
    return f.decision === "confirmed" && s && s.endMs > s.startMs ? [{ startMs: s.startMs, endMs: s.endMs }] : [];
  });
}

/** Takes worth catching: reviewed, with at least this many confirmed fillers. */
export const MIN_CONFIRMED_FOR_CATCH = 3;
