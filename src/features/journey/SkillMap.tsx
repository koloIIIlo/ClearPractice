import { areaDef } from "@/lib/engagement/skills";
import type { AreaStatus, CriterionProgress } from "@/lib/engagement/types";
import { cn } from "@/lib/utils";

/** "1 of 2", the first criterion of the next level that isn't met. */
export function nextStep(area: AreaStatus): { label: string; criterion: CriterionProgress | null } {
  const next = area.next;
  if (!next) return { label: "All five levels reached", criterion: null };
  const criterion = next.criteria.find((c) => !c.met) ?? next.criteria[0];
  if (next.state === "ready") return { label: `${next.name}: ready`, criterion };
  if (criterion?.unavailable) return { label: `${next.name}: ${criterion.unavailable.reason.toLowerCase()}`, criterion };
  return { label: `${next.name}, ${criterion.done} of ${criterion.needed}`, criterion };
}

export function LevelDots({ area }: { area: AreaStatus }) {
  return (
    <span aria-hidden className="flex gap-1">
      {area.levels.map((l) => (
        <span
          key={l.level}
          className={cn(
            "size-2.5 rounded-full border",
            l.state === "reached" ? "border-primary bg-primary" : l.state === "ready" ? "border-2 border-primary" : "border-muted-foreground/60",
          )}
        />
      ))}
    </span>
  );
}

/** The eight areas as cards (roadmap 9.1); each opens its sheet. */
export function SkillMap({ areas, onOpen }: { areas: readonly AreaStatus[]; onOpen: (area: AreaStatus["area"]) => void }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {areas.map((a) => {
        const def = areaDef(a.area);
        const current = a.current > 0 ? a.levels[a.current - 1].name : "Not started";
        const step = nextStep(a);
        const ratio = step.criterion ? Math.min(1, step.criterion.done / step.criterion.needed) : 1;
        const name = `${def.title}, level ${a.current} of 5, ${current}. Next: ${step.label}.`;
        return (
          <li key={a.area}>
            <button
              type="button"
              aria-label={name}
              onClick={() => onOpen(a.area)}
              className="flex h-full w-full flex-col gap-2 rounded-panel border bg-card p-4 text-left transition-colors hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring"
            >
              <span className="flex items-center gap-2 font-semibold">
                <def.icon aria-hidden className="size-4 text-primary" /> {def.title}
              </span>
              <span className="flex items-center gap-2 text-meta">
                <LevelDots area={a} />
                <span className="text-muted-foreground">{current}</span>
              </span>
              <span className="text-meta text-muted-foreground">Next: {step.label}</span>
              <span aria-hidden className="mt-auto block h-1.5 overflow-hidden rounded-full bg-[var(--cp-ring-track)]">
                <span className="block h-full rounded-full bg-primary" style={{ width: `${ratio * 100}%` }} />
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
