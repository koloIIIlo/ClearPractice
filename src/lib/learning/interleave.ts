import { DRILLS, type DrillDef } from "@/content/drills";
import { EXERCISE_IDS } from "@/content/exercises";
import { addLocalDays } from "@/lib/phrase-schedule";
import { seededRandom } from "@/lib/engagement/random";
import { drillPlays } from "@/lib/engagement/drills";
import { available, LEVELS } from "@/lib/engagement/skills";
import type { AreaId, AreaStatus } from "@/lib/engagement/types";
import type { ExerciseType, PracticeFacts, TodayPlan } from "@/lib/ipc/schemas";

/**
 * Interleaving (roadmap 11.3) and the weakest-area sprint (11.8): mixing
 * kinds of practice instead of blocking them (Brunmair & Richter 2019), and a
 * five-minute set aimed at the area with the least practice.
 */
type PlanStep = TodayPlan["steps"][number];

/** Short drills that work as a two-minute warm-up or in a mixed set. */
export const SHORT_DRILLS = ["jam", "roulette", "word-bomb", "emphasis", "story-spine", "story-cubes", "pace-ladder"] as const;
const RECENT_DAYS = 7;
const SPRINT_FALLBACK = ["roulette", "jam"] as const;

const lastPlayed = (facts: PracticeFacts, drill: DrillDef) => drillPlays(facts, drill.type).map((p) => p.session.localDate).sort().at(-1) ?? null;

/** The warm-up drill: for the area with the least practice, preferring one not played in seven days; stable for a day. */
export function pickWarmUp(facts: PracticeFacts, activity: Record<AreaId, number>, today: string): DrillDef {
  const since = addLocalDays(today, -RECENT_DAYS);
  const random = seededRandom(`warm-up-${today}`);
  const candidates = DRILLS.filter((d) => (SHORT_DRILLS as readonly string[]).includes(d.id)).map((d) => ({
    d,
    recent: (lastPlayed(facts, d) ?? "") > since,
    least: Math.min(...d.areas.map((a) => activity[a] ?? 0)),
    tie: random(),
  }));
  candidates.sort((a, b) => Number(a.recent) - Number(b.recent) || a.least - b.least || a.tie - b.tie);
  return candidates[0].d;
}

export function warmUpStep(drill: DrillDef): PlanStep {
  return { exerciseType: drill.type, drillId: drill.id, title: `Warm-up: ${drill.title}`, minutes: 2 };
}

/** Three different short drills in a row, chosen by the date. */
export function mixedSet(today: string): PlanStep[] {
  const random = seededRandom(`mixed-${today}`);
  const pool = DRILLS.filter((d) => (SHORT_DRILLS as readonly string[]).includes(d.id));
  const shuffled = pool.map((d) => ({ d, k: random() })).sort((a, b) => a.k - b.k).map(({ d }) => d);
  return shuffled.slice(0, 3).map((d) => ({ exerciseType: d.type, drillId: d.id, title: d.title, minutes: d.minutes }));
}

/** The lowest current level, ties broken by the least practice over 30 days, then the area order. */
export function weakestArea(areas: readonly Pick<AreaStatus, "area" | "current">[], activity: Record<AreaId, number>): AreaId {
  return [...areas].sort((a, b) => a.current - b.current || (activity[a.area] ?? 0) - (activity[b.area] ?? 0))[0].area;
}

/** A practice link as a sequence step, when it opens something you can practise. */
function linkStep(link: { label: string; to: string }): PlanStep | null {
  const drill = /^\/drill\/([a-z-]+)/.exec(link.to)?.[1];
  if (drill) {
    const d = DRILLS.find((x) => x.id === drill);
    return d ? { exerciseType: d.type, drillId: d.id, title: d.title, minutes: Math.min(d.minutes, 3) } : null;
  }
  const exercise = Object.entries(EXERCISE_IDS).find(([, id]) => link.to.startsWith(`/practice/${id}`));
  if (!exercise) return null;
  const type = ({ repeat: "repeat", thoughtGroups: "thought_groups", imitate: "imitate", expression: "expression" } as const)[exercise[0] as keyof typeof EXERCISE_IDS] as ExerciseType;
  return { exerciseType: type, title: link.label, minutes: 2, to: link.to };
}

/** Two or three steps toward the area's next level (appendix A), about five minutes in all. */
export function buildSprint(area: AreaId, current: number): PlanStep[] {
  const next = Math.min(current + 1, 5);
  const steps: PlanStep[] = [];
  const add = (s: PlanStep | null) => {
    if (s && !steps.some((x) => x.title === s.title && x.drillId === s.drillId)) steps.push(s);
  };
  for (const link of LEVELS[area][next - 1].practise.filter(available)) add(linkStep(link));
  // Fill with this area's short drills, so a sprint always has at least two steps.
  for (const d of DRILLS.filter((x) => x.areas.includes(area) && (SHORT_DRILLS as readonly string[]).includes(x.id))) {
    if (steps.length >= 2) break;
    add({ exerciseType: d.type, drillId: d.id, title: d.title, minutes: 2 });
  }
  // Areas with no drill of their own (courage) rehearse speaking on the spot.
  for (const d of SPRINT_FALLBACK.map((id) => DRILLS.find((x) => x.id === id)!)) {
    if (steps.length >= 2) break;
    add({ exerciseType: d.type, drillId: d.id, title: d.title, minutes: 2 });
  }
  return steps.slice(0, 3);
}
