import { cn } from "@/lib/utils";

/** Bars kept on screen: about 8 seconds at the native 10 level events per second. */
export const LEVEL_HISTORY = 80;

/** RMS 0–1 → 0–1 on a −50…0 dB scale, so ordinary speech is clearly visible. */
export function levelToHeight(rms: number): number {
  if (!(rms > 0)) return 0;
  return Math.min(1, Math.max(0, (20 * Math.log10(rms) + 50) / 50));
}

/**
 * Live input waveform while recording: the most recent ~8 seconds of input
 * level scroll from right to left, mirrored around the centre line like a
 * voice recorder. Nothing moves when idle (§5).
 */
export function LiveWaveform({ levels, level, active, clipping }: { levels: number[]; level: number; active: boolean; clipping: boolean }) {
  const padded = Array.from({ length: LEVEL_HISTORY }, (_, i) => levels[i - (LEVEL_HISTORY - levels.length)] ?? 0);
  return (
    <div className="flex w-full max-w-xl flex-col items-center gap-1">
      <div
        role="meter"
        aria-label="Input level"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(levelToHeight(level) * 100)}
        className="flex h-16 w-full items-center gap-px overflow-hidden"
      >
        {padded.map((value, i) => {
          const height = active || levels.length ? Math.max(0.04, levelToHeight(value)) : 0.04;
          return (
            <span
              key={i}
              className={cn(
                "min-w-px flex-1 rounded-full",
                !active && "bg-border",
                active && (clipping && i === LEVEL_HISTORY - 1 ? "bg-destructive" : "bg-primary"),
                active && i < LEVEL_HISTORY - levels.length && "bg-border",
              )}
              style={{ height: `${height * 100}%` }}
            />
          );
        })}
      </div>
      {clipping && <span className="text-meta text-destructive">Input is very loud. Consider moving back a little.</span>}
    </div>
  );
}
