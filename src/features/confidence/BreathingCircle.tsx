import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { BREATH, BREATH_ROUNDS } from "@/content/routine";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

type Phase = "inhale" | "top" | "exhale";
const CUES: Record<Phase, string> = { inhale: "Breathe in…", top: "A second short breath in…", exhale: "Long, slow breath out…" };
const SECONDS: Record<Phase, number> = { inhale: BREATH.inhale, top: BREATH.top, exhale: BREATH.exhale };
const NEXT: Record<Phase, Phase> = { inhale: "top", top: "exhale", exhale: "inhale" };
/** The circle's size in each phase: it grows on the breaths in and shrinks on the long breath out. */
const SCALE: Record<Phase, number> = { inhale: 0.85, top: 1, exhale: 0.5 };

/**
 * Cyclic sighing (roadmap 12.3; Balban et al. 2023): an SVG circle that grows
 * on the two breaths in and shrinks on the long breath out, five rounds. Under
 * reduced motion the circle stays still and only the words change. Cues are
 * announced once per phase, never every second.
 */
export function BreathingCircle({ onFinished }: { onFinished?: () => void }) {
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<Phase | null>(null);
  const [round, setRound] = useState(1);
  const [finished, setFinished] = useState(false);
  useEffect(() => {
    if (!phase) return;
    const timer = setTimeout(() => {
      if (phase === "exhale" && round >= BREATH_ROUNDS) {
        setPhase(null);
        setFinished(true);
        onFinished?.();
        return;
      }
      if (phase === "exhale") setRound((r) => r + 1);
      setPhase(NEXT[phase]);
    }, SECONDS[phase] * 1000);
    return () => clearTimeout(timer);
  }, [phase, round, onFinished]);
  const scale = phase && !reduced ? SCALE[phase] : 0.75;
  return (
    <div className="flex flex-col items-center gap-4">
      <svg viewBox="0 0 200 200" className="size-48" aria-hidden>
        <circle cx="100" cy="100" r="96" fill="none" stroke="var(--border)" strokeWidth="2" />
        <circle
          cx="100"
          cy="100"
          r="90"
          fill="var(--primary)"
          fillOpacity="0.18"
          stroke="var(--primary)"
          strokeWidth="3"
          className={cn("origin-center", !reduced && "transition-transform ease-in-out")}
          style={{ transform: `scale(${scale})`, transformBox: "fill-box", transitionDuration: phase && !reduced ? `${SECONDS[phase]}s` : undefined }}
        />
      </svg>
      <p aria-live="polite" className="min-h-7 text-lg font-medium">
        {phase ? CUES[phase] : finished ? "Well done. Notice how you feel." : "Five slow rounds, about a minute."}
      </p>
      {phase && <p className="text-meta text-muted-foreground tabular-nums">Round {round} of {BREATH_ROUNDS}</p>}
      {!phase && (
        <Button
          variant={finished ? "outline" : "default"}
          onClick={() => {
            setRound(1);
            setFinished(false);
            setPhase("inhale");
          }}
        >
          {finished ? "Breathe again" : "Start breathing"}
        </Button>
      )}
    </div>
  );
}
