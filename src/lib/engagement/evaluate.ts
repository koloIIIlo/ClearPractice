import type { EngagementState, NewAchievement, NewLevel, NewRecord, PracticeEvent, PracticeFacts, Preferences } from "@/lib/ipc/schemas";
import { newAchievements } from "./achievements";
import { progressOf, type EvalContext } from "./criteria";
import { questProgress } from "./quests";
import { newRecords } from "./records";
import { LEVEL_DEFINITIONS_VERSION, LEVELS } from "./skills";
import { AREA_IDS, type AreaId, type AreaStatus, type CriterionProgress, type LevelStatus } from "./types";
import { goalProgress, weekStart } from "./weekly";

export type StoredLevel = { area: string; level: number; achievedAt: string };
export type EngagementDiff = {
  levels: NewLevel[];
  achievements: NewAchievement[];
  records: NewRecord[];
  questsDone: { week: string; slot: number }[];
  weeklyGoal: string | null;
};

/** The evidence saved with a level: the IDs that met each criterion, at most 10 each. */
function evidenceOf(criteria: CriterionProgress[]): Record<string, unknown> {
  return { criteria: criteria.map((c) => c.evidence.map((e) => e.id)) };
}

/**
 * Where you stand in each area. Levels are earned in order; a higher level
 * whose criteria are already met shows as "ready" and is recorded right after
 * the one below it. A stored level always counts, even when the sessions
 * behind it are gone (A-28).
 */
export function evaluateAreas(facts: PracticeFacts, reached: readonly StoredLevel[], ctx: EvalContext): AreaStatus[] {
  return AREA_IDS.map((area) => {
    const stored = new Map(reached.filter((r) => r.area === area).map((r) => [r.level, r.achievedAt]));
    const levels: LevelStatus[] = LEVELS[area].map((def) => {
      const criteria = def.criteria.map((c) => progressOf(c, facts, ctx));
      const reachedAt = stored.get(def.level) ?? null;
      const met = criteria.every((c) => c.met);
      const started = criteria.some((c) => c.done > 0 || (c.days?.done ?? 0) > 0);
      return { level: def.level, name: def.name, state: reachedAt ? "reached" : met ? "ready" : started ? "in_progress" : "not_started", reachedAt, criteria };
    });
    let current = 0;
    while (current < 5 && levels[current].state === "reached") current += 1;
    return { area, current: current as AreaStatus["current"], levels, next: levels[current] ?? null };
  });
}

/** Levels to record now: from the first not reached, upward while each is met. */
export function newLevels(areas: readonly AreaStatus[]): NewLevel[] {
  const out: NewLevel[] = [];
  for (const a of areas) {
    for (const level of a.levels.slice(a.current)) {
      if (level.state !== "ready") break;
      out.push({ area: a.area, level: level.level, definitionVersion: LEVEL_DEFINITIONS_VERSION, evidence: evidenceOf(level.criteria) });
    }
  }
  return out;
}

/** Everything new since the last evaluation, for `recordUnlocks`. */
export function evaluate(
  facts: PracticeFacts,
  events: readonly PracticeEvent[],
  state: EngagementState,
  prefs: Pick<Preferences, "weeklyGoalDays" | "weekStartsOn">,
  ctx: EvalContext,
): EngagementDiff {
  const areas = evaluateAreas(facts, state.levels, ctx);
  const week = weekStart(ctx.today, prefs.weekStartsOn);
  const goal = goalProgress(events, week, prefs.weeklyGoalDays);
  const questsDone = state.quests
    .filter((q) => q.week === week && q.completedAt === null)
    .filter((q) => questProgress(q, facts, events, ctx).met)
    .map((q) => ({ week: q.week, slot: q.slot }));
  const weeklyGoal = goal.met && !state.goalWeeks.includes(week) ? week : null;
  const levels = newLevels(areas);
  // Achievements see what this same pass records (a goal week, new levels), so none waits a turn.
  const after: EngagementState = {
    ...state,
    goalWeeks: weeklyGoal ? [...state.goalWeeks, weeklyGoal] : state.goalWeeks,
    levels: [...state.levels, ...levels.map((l) => ({ ...l, achievedAt: ctx.today }))],
  };
  return { levels, achievements: newAchievements(facts, after, events, ctx, areas, prefs), records: newRecords(facts, state.records), questsDone, weeklyGoal };
}

export const isEmptyDiff = (d: EngagementDiff) => d.levels.length + d.achievements.length + d.records.length + d.questsDone.length === 0 && d.weeklyGoal === null;

/** The in-progress level closest to done, for "Next" on Today and in Journey. */
export function nearestNext(areas: readonly AreaStatus[]): { area: AreaId; level: LevelStatus; ratio: number } | null {
  let best: { area: AreaId; level: LevelStatus; ratio: number } | null = null;
  for (const a of areas) {
    const next = a.next;
    if (!next || next.criteria.some((c) => c.unavailable && !c.met)) continue;
    const ratio = next.criteria.reduce((sum, c) => sum + Math.min(1, c.done / c.needed), 0) / next.criteria.length;
    if (!best || ratio > best.ratio) best = { area: a.area, level: next, ratio };
  }
  return best;
}
