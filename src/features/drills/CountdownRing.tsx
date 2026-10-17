import { formatClock } from "@/lib/format";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

/**
 * The drill clock's ring (roadmap 10.1): time left in the middle, the ring
 * empties as it runs. Timing lights (10.3) colour the ring and a text line
 * always says which light is on, so colour is never the only signal. Under
 * reduced motion it steps once a second with no transition.
 */
export type Light = "green" | "amber" | "red";

/** Toastmasters timing lights: green at 2/3 of the time, amber at 11/12, red at the full time. */
export function lightAt(elapsedMs: number, totalMs: number): Light | null {
  if (elapsedMs >= totalMs) return "red";
  if (elapsedMs >= (totalMs * 11) / 12) return "amber";
  if (elapsedMs >= (totalMs * 2) / 3) return "green";
  return null;
}

export const LIGHT_TEXT: Record<Light, string> = {
  green: "Green: minimum time reached",
  amber: "Amber: start finishing",
  red: "Red: time",
};

const SIZE = 160;
const STROKE = 10;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function CountdownRing({ totalMs, remainingMs, light, caption }: { totalMs: number | null; remainingMs: number; light?: Light | null; caption?: string }) {
  const reduced = useReducedMotion();
  const shown = reduced ? Math.ceil(remainingMs / 1000) * 1000 : remainingMs;
  const fraction = totalMs && totalMs > 0 ? Math.min(1, Math.max(0, shown / totalMs)) : 1;
  const stroke = light ? `var(--cp-light-${light})` : "var(--cp-accent)";
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg aria-hidden width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="-rotate-90">
          <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="var(--cp-ring-track)" strokeWidth={STROKE} />
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke={stroke}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
            className={cn(!reduced && "transition-[stroke-dashoffset] duration-200 ease-linear")}
            data-testid="countdown-arc"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-5xl font-semibold tabular-nums" aria-label={caption ? `${caption}: ${formatClock(remainingMs)}` : formatClock(remainingMs)}>
          {formatClock(Math.ceil(remainingMs / 1000) * 1000)}
        </span>
      </div>
      {caption && <p className="text-meta text-muted-foreground">{caption}</p>}
      {light && (
        <p className="text-meta font-medium" data-light={light}>
          {LIGHT_TEXT[light]}
        </p>
      )}
    </div>
  );
}
