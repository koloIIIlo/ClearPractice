import { MISSIONS, type Mission } from "@/content/missions";
import { seededRandom } from "@/lib/engagement/random";
import { AREA_IDS, type AreaId } from "@/lib/engagement/types";
import { addLocalDays } from "@/lib/phrase-schedule";
import type { PracticeFacts } from "@/lib/ipc/schemas";

/**
 * This week's mission offers (roadmap 14.1): three, one of each difficulty,
 * seeded by the week so they stay put, and one of them from the area you
 * practised least when that area has a mission at its difficulty. Choose
 * another (`round`) shows three you haven't been offered this week.
 */
export function missionOffers(week: string, lean: AreaId | null, round = 0, avoid: readonly string[] = []): Mission[] {
  const seen = new Set(avoid);
  let offers: Mission[] = [];
  for (let r = 0; r <= round; r += 1) {
    offers = offerRound(week, lean, r, seen);
    for (const m of offers) seen.add(m.id);
  }
  return offers;
}

const DIFFICULTIES = [1, 2, 3] as const;

function offerRound(week: string, lean: AreaId | null, round: number, seen: ReadonlySet<string>): Mission[] {
  const random = seededRandom(`missions-${week}-${round}`);
  const pick = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)];
  // Missions not offered yet, or all of that difficulty once every one has been.
  const pool = (d: 1 | 2 | 3) => {
    const all = MISSIONS.filter((m) => m.difficulty === d);
    const fresh = all.filter((m) => !seen.has(m.id));
    return fresh.length > 0 ? fresh : all;
  };
  const leanable = lean ? DIFFICULTIES.filter((d) => pool(d).some((m) => m.area === lean)) : [];
  const leanOn = leanable.length > 0 ? pick(leanable) : null;
  return DIFFICULTIES.map((d) => {
    const inArea = pool(d).filter((m) => m.area === lean);
    return pick(d === leanOn && inArea.length > 0 ? inArea : pool(d));
  });
}

/** Missions you logged in the eight weeks before this one; they aren't offered again yet. */
export function recentMissions(facts: Pick<PracticeFacts, "missionPicks">, week: string): string[] {
  const since = addLocalDays(week, -56);
  return facts.missionPicks.filter((p) => p.done && p.missionId && p.week >= since && p.week < week).map((p) => p.missionId!);
}

/** The area with the least practice this month (the quests' count), which the offers lean toward. */
export function leastPractised(activity: Readonly<Record<AreaId, number>>): AreaId {
  return [...AREA_IDS].sort((a, b) => activity[a] - activity[b])[0];
}

export const DIFFICULTY_LABELS: Record<Mission["difficulty"], string> = { 1: "Easy", 2: "Medium", 3: "Stretch" };
