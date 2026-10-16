import { useEffect, useState } from "react";
import { useIpc } from "@/lib/ipc";
import { usePracticeFacts } from "@/lib/ipc/queries";
import { middleHalf } from "@/lib/insights/profile";

/** The meter's scale in syllables a second; speech rarely sits outside it. */
const SCALE: [number, number] = [2, 7];
const USUAL_FROM_TAKES = 20;

const share = (v: number) => Math.round(((Math.min(SCALE[1], Math.max(SCALE[0], v)) - SCALE[0]) / (SCALE[1] - SCALE[0])) * 1000) / 10;
const position = (v: number) => `${share(v)}%`;

/** The live pace of the take being recorded (8.8): about once a second; null until there is enough speech. */
export function useLivePace(active: boolean): number | null {
  const ipc = useIpc();
  const [rate, setRate] = useState<number | null>(null);
  useEffect(() => {
    if (!active) return;
    setRate(null);
    let remove: (() => void) | undefined;
    let disposed = false;
    void ipc.onLivePace((pace) => setRate(pace.syllablesPerSecond)).then((r) => (disposed ? r() : (remove = r)));
    return () => {
      disposed = true;
      remove?.();
    };
  }, [ipc, active]);
  return active ? rate : null;
}

/** Your usual speech rate: the middle half of your recent takes' rates from the audio (8.7). */
export function useUsualRate(enabled: boolean): [number, number] | null {
  const facts = usePracticeFacts();
  if (!enabled || !facts.data) return null;
  const rates = facts.data.takes.slice(-USUAL_FROM_TAKES).map((t) => t.rateSps).filter((v): v is number => v != null);
  return middleHalf(rates);
}

/**
 * A calm live meter (roadmap 8.8, D-34): where your pace sits compared with
 * your usual range, never a target speed. No red or green: a neutral band and
 * one dot. Screen readers get one line, not a stream of numbers.
 */
export function LivePaceMeter({ rate, usual }: { rate: number | null; usual: [number, number] | null }) {
  return (
    <div className="w-full max-w-md space-y-1" data-testid="live-pace">
      <p className="sr-only">Live pace is shown visually; it is an estimate.</p>
      <div aria-hidden className="space-y-1">
        <div className="flex items-center gap-2 text-meta text-muted-foreground">
          <span>slower</span>
          <div className="relative h-2 flex-1 rounded-full bg-muted">
            {usual && (
              <span
                data-testid="usual-band"
                className="absolute inset-y-0 rounded-full bg-[var(--cp-ring-track)] ring-1 ring-border"
                style={{ left: position(usual[0]), width: `${share(usual[1]) - share(usual[0])}%` }}
              />
            )}
            {rate != null && (
              <span
                data-testid="pace-dot"
                className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--cp-accent)] ring-2 ring-background transition-[left] duration-700 motion-reduce:transition-none"
                style={{ left: position(rate) }}
              />
            )}
          </div>
          <span>faster</span>
        </div>
        <p className="text-center text-meta text-muted-foreground tabular-nums">
          {rate == null ? "Listening…" : `about ${rate.toFixed(1)} syllables a second${usual ? " · the band is your usual" : ""} · Estimated`}
        </p>
      </div>
    </div>
  );
}
