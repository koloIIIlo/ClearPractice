import { cn } from "@/lib/utils";

/** Bars kept on screen: about 8 seconds at the native 10 level events per second. */
export const LEVEL_HISTORY = 80;

/** RMS 0–1 → 0–1 on a −50…0 dB scale, so ordinary speech is clearly visible. */
export function levelToHeight(rms: number): number {
  if (!(rms > 0)) return 0;
  return Math.min(1, Math.max(0, (20 * Math.log10(rms) + 50) / 50));
}

/** Bars drawn: the most recent ~6 seconds at the native 10 level events per second. */
const BARS = 64;

/**
 * Live input waveform while recording: rounded bars scroll from right to left,
 * mirrored around the centre line, easing between heights so the voice reads
 * as one flowing shape; older input fades out to the left. Idle, it is a quiet
 * row of dots, and nothing moves (§5). A finished take stays visible, dimmed.
 */
export function LiveWaveform({ levels, level, active, clipping }: { levels: number[]; level: number; active: boolean; clipping: boolean }) {
  const recent = levels.slice(-BARS);
  const padded = Array.from({ length: BARS }, (_, i) => recent[i - (BARS - recent.length)]);
  return (
    <div className="flex w-full max-w-xl flex-col items-center gap-1">
      <div
        role="meter"
        aria-label="Input level"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(levelToHeight(level) * 100)}
        className="flex h-20 w-fit max-w-full items-center justify-end gap-[3px] overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_30%)]"
      >
        {padded.map((value, i) => {
          const height = value === undefined ? 0.08 : Math.max(0.08, levelToHeight(value));
          return (
            <span
              key={i}
              className={cn(
                "w-1 shrink-0 rounded-full transition-[height,background-color] duration-150 ease-out",
                value === undefined && "bg-muted-foreground/25",
                value !== undefined && !active && "bg-primary/40",
                value !== undefined && active && (clipping && i === BARS - 1 ? "bg-destructive" : "bg-primary"),
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
