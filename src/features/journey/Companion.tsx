import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { COMPANION_STAGES, MAX_STAGE } from "@/lib/engagement/companion";
import type { PotId } from "@/lib/engagement/achievements";
import { cn } from "@/lib/utils";

/** Leaf tint by month (cosmetic): from spring green toward autumn olive and back. */
function leafColour(month: number): string {
  const autumn = [0, 0, 0, 0, 0, 5, 10, 15, 25, 35, 30, 15][month - 1] ?? 0;
  return `color-mix(in oklab, var(--cp-sprout-leaf), var(--cp-sprout-autumn) ${autumn}%)`;
}

/**
 * Sprout (roadmap 9.11): a plant that grows with practice days and never
 * wilts, gets sad or shrinks. Inline SVG, one group per growth part. A gentle
 * sway only while it is on screen and not under reduced motion.
 */
export function Companion({ stage, pot = "clay", size = 120, month }: { stage: number; pot?: PotId; size?: 48 | 64 | 120; month?: number }) {
  const reduced = useReducedMotion();
  const ref = useRef<SVGSVGElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const s = Math.max(0, Math.min(MAX_STAGE, stage));
  const leaf = leafColour(month ?? new Date().getMonth() + 1);
  const name = COMPANION_STAGES[s].name;
  const potColour = `var(--cp-pot-${pot})`;
  const rim = `color-mix(in oklab, var(--cp-pot-${pot}), black 15%)`;
  return (
    <svg
      ref={ref}
      role="img"
      aria-label={`Sprout, ${name} at stage ${s} of ${MAX_STAGE}. It grows with your practice days.`}
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className="shrink-0"
    >
      <g className={cn("origin-[60px_86px]", visible && !reduced && "animate-sway")}>
        {s === 0 && <ellipse cx="60" cy="80" rx="5" ry="3.5" fill="var(--cp-sprout-seed)" />}
        {s >= 1 && <path d={`M60 86 C60 ${78 - s * 4} 60 ${70 - s * 5} 60 ${64 - s * 5}`} stroke={leaf} strokeWidth={s >= 7 ? 5 : s >= 4 ? 3.5 : 2.5} fill="none" strokeLinecap="round" />}
        {s >= 1 && <path d="M60 78 q-8 -8 -14 -4 q6 6 14 4z" fill={leaf} />}
        {s >= 2 && <path d="M60 74 q9 -9 15 -4 q-7 7 -15 4z" fill={leaf} />}
        {s >= 3 && <path d="M60 64 q-11 -9 -18 -3 q8 7 18 3z" fill={leaf} />}
        {s >= 3 && <path d="M60 58 q11 -9 17 -3 q-8 7 -17 3z" fill={leaf} />}
        {s >= 4 && <path d="M60 50 q-12 -8 -19 -1 q9 6 19 1z" fill={leaf} opacity="0.9" />}
        {s >= 4 && <path d="M60 46 q12 -9 19 -2 q-9 7 -19 2z" fill={leaf} opacity="0.9" />}
        {s >= 5 && <ellipse cx="60" cy={34 - (s - 5) * 2} rx="4" ry="6" fill="var(--cp-sprout-bud)" />}
        {s >= 6 && (
          <g fill="var(--cp-sprout-petal)">
            {[0, 72, 144, 216, 288].map((a) => (
              <ellipse key={a} cx="60" cy={26 - (s - 6) * 2} rx="4" ry="7" transform={`rotate(${a} 60 ${32 - (s - 6) * 2})`} />
            ))}
            <circle cx="60" cy={32 - (s - 6) * 2} r="3" fill="var(--cp-sprout-centre)" />
          </g>
        )}
        {s >= 7 && <circle cx="60" cy="38" r="24" fill={leaf} opacity="0.35" />}
        {s >= 8 && (
          <g fill="var(--cp-sprout-petal)">
            {[[42, 30], [78, 32], [50, 18], [70, 20], [60, 44]].map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="3.5" />)}
          </g>
        )}
      </g>
      <path d="M38 86 h44 l-5 24 h-34z" fill={potColour} />
      <rect x="35" y="82" width="50" height="8" rx="2" fill={rim} />
    </svg>
  );
}
