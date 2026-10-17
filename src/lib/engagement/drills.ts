import { bossById } from "@/content/bosses";
import type { DrillType, FactSession, FactTake, PracticeFacts } from "@/lib/ipc/schemas";

/**
 * Drills in the game layer (roadmap M10): what counts as a round of each
 * drill and the results of drills that span a session. Take results come
 * from the native result cache (facts v4); session results are combined here
 * from the latest take of each step. Nothing reads AI feedback (A-29).
 */

/** A round of these drills is one take of 10 seconds or more; the rest count whole sessions. Matches `DRILLS[].unit`. */
export const DRILL_UNITS: Readonly<Record<DrillType, "take" | "session">> = {
  jam: "take", roulette: "take", word_bomb: "take", story_spine: "take", story_cubes: "take",
  three_ways: "session", emphasis: "session", pace_ladder: "session", pitch: "session", steelman: "session", daily: "session", gauntlet: "session", boss: "session",
};
export const ROUND_MIN_MS = 10_000;
/** Rates at least this far apart (syllables a second) are clearly different speeds (10.7). */
export const MIN_GAP_SPS = 0.4;
/** Rounds a session needs to count as finished. */
const ROUNDS: Partial<Record<DrillType, number>> = { three_ways: 3, pitch: 3, steelman: 2, gauntlet: 5, emphasis: 7, pace_ladder: 3 };

export type DrillPlay = { session: FactSession; takes: FactTake[]; result: Record<string, number> };

/** Range and whether the three rates climb with clear gaps (slow < natural < fast). */
export function ladder(rates: readonly (number | null | undefined)[]): { range: number | null; distinct: boolean } {
  const [slow, natural, fast] = rates;
  if (slow == null || natural == null || fast == null) return { range: null, distinct: false };
  return { range: Math.round((fast - slow) * 10) / 10, distinct: natural - slow >= MIN_GAP_SPS && fast - natural >= MIN_GAP_SPS };
}

/** The latest take of each step, in step order of first appearance. */
function latestByStep(takes: readonly FactTake[]): Map<string, FactTake> {
  const latest = new Map<string, FactTake>();
  for (const t of takes) latest.set(t.stepKey ?? "round", t);
  return latest;
}

/** A session's combined result (emphasis hits, the pace range, gauntlet rounds, a finished boss…). */
export function sessionResult(type: DrillType, session: FactSession, takes: readonly FactTake[]): Record<string, number> {
  const latest = latestByStep(takes);
  const steps = [...latest.values()];
  const rounds = steps.length;
  switch (type) {
    case "emphasis":
      return { rounds, estimatedHits: steps.filter((t) => t.result?.hit === 1).length, finished: Number(rounds >= ROUNDS.emphasis!) };
    case "pace_ladder": {
      const rates = ["slow", "natural", "fast"].map((k) => latest.get(k)?.result?.rateSps ?? null);
      const { range, distinct } = ladder(rates);
      const known = rates.filter((r): r is number => r != null);
      return {
        rounds,
        ...(range !== null ? { range } : {}),
        distinctSpeeds: distinct ? 3 : known.length >= 2 && Math.max(...known) - Math.min(...known) >= MIN_GAP_SPS ? 2 : known.length > 0 ? 1 : 0,
      };
    }
    case "gauntlet":
      return { rounds, roundsCompleted: steps.filter((t) => t.durationMs >= ROUND_MIN_MS).length, speakingMs: steps.reduce((n, t) => n + t.durationMs, 0) };
    case "boss": {
      const boss = bossById(String(session.activity?.params.boss ?? ""));
      const needed = boss ? boss.rounds.reduce((n, r) => n + (r.kind === "fixed" ? 1 : r.count), 0) : Infinity;
      return { rounds, finished: Number(rounds >= needed) };
    }
    case "daily":
      // The first take of the day is the official one.
      return { ...(takes[0]?.result ?? {}), rounds: takes.length };
    default:
      return { rounds, finished: Number(rounds >= (ROUNDS[type] ?? 1)) };
  }
}

const groups = new WeakMap<PracticeFacts, Map<string, FactTake[]>>();
function takesBySession(facts: PracticeFacts): Map<string, FactTake[]> {
  let map = groups.get(facts);
  if (!map) {
    map = new Map();
    for (const t of facts.takes) {
      const list = map.get(t.sessionId);
      if (list) list.push(t);
      else map.set(t.sessionId, [t]);
    }
    groups.set(facts, map);
  }
  return map;
}

/** Every round of a drill: a take of 10 seconds or more, or a session with its combined result. */
export function drillPlays(facts: PracticeFacts, type: DrillType): DrillPlay[] {
  const bySession = takesBySession(facts);
  const plays: DrillPlay[] = [];
  for (const session of facts.sessions) {
    if (session.exerciseType !== type) continue;
    const takes = bySession.get(session.id) ?? [];
    if (takes.length === 0) continue;
    if (DRILL_UNITS[type] === "take") {
      for (const t of takes) if (t.durationMs >= ROUND_MIN_MS) plays.push({ session, takes: [t], result: t.result ?? {} });
    } else {
      plays.push({ session, takes, result: sessionResult(type, session, takes) });
    }
  }
  return plays;
}

/** Drill types you have played at least once. */
export function drillTypesPlayed(facts: PracticeFacts): Set<DrillType> {
  const played = new Set<DrillType>();
  for (const type of Object.keys(DRILL_UNITS) as DrillType[]) if (drillPlays(facts, type).length > 0) played.add(type);
  return played;
}
