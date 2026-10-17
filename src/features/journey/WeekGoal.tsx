import { cn } from "@/lib/utils";

/** A ring that fills with this week's practice days (roadmap 9.8). Days without practice are just empty; never red. */
export function GoalRing({ days, goal, size = 36, className }: { days: number; goal: number; size?: number; className?: string }) {
  const share = Math.min(1, days / Math.max(1, goal)) * 100;
  return (
    <svg aria-hidden viewBox="0 0 36 36" width={size} height={size} className={cn("shrink-0 -rotate-90", className)}>
      <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--cp-ring-track)" strokeWidth="3.5" />
      {share > 0 && <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--cp-accent)" strokeWidth="3.5" strokeLinecap="round" pathLength={100} strokeDasharray={`${share} 100`} />}
    </svg>
  );
}

/** "2 of 3 days this week" with the ring, and weeks in a row from two on. */
export function WeekGoal({ days, goal, weeksInARow, xp, compact = false }: { days: number; goal: number; weeksInARow: number; xp?: number; compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <GoalRing days={days} goal={goal} size={compact ? 28 : 40} />
      <p className={cn("tabular-nums", compact && "text-meta")}>
        <span className="font-medium">{Math.min(days, goal)} of {goal} days</span>
        {days >= goal ? <span className="text-muted-foreground"> · goal reached</span> : <span className="text-muted-foreground"> this week</span>}
        {xp !== undefined && <span className="text-muted-foreground"> · {xp} XP</span>}
        {weeksInARow >= 2 && <span className="text-muted-foreground"> · {weeksInARow} weeks in a row</span>}
      </p>
    </div>
  );
}
