import type { AccentId, PotId } from "./achievements";
import type { EngagementState } from "@/lib/ipc/schemas";

/**
 * Cosmetic rewards (roadmap 9.12, appendix B.3): accent colours and Sprout's
 * pots. Unlocked ones stay unlocked; appearance also works in Calm style.
 */
export const ACCENTS: readonly { id: AccentId; name: string; unlock: string | null; achievement: string | null }[] = [
  { id: "green", name: "Green", unlock: null, achievement: null },
  { id: "ocean", name: "Ocean", unlock: "your first weekly goal", achievement: "goal-1" },
  { id: "amber", name: "Amber", unlock: "10 practice days", achievement: "days-10" },
  { id: "violet", name: "Violet", unlock: "your first level 3 in any area", achievement: null },
  { id: "rose", name: "Rose", unlock: "your first real-conversation reflection", achievement: "first-reflection" },
  { id: "graphite", name: "Graphite", unlock: "30 practice days", achievement: "days-30" },
];

export const POTS: readonly { id: PotId; name: string; unlock: string | null; achievement: string | null }[] = [
  { id: "clay", name: "Clay", unlock: null, achievement: null },
  { id: "white", name: "White glaze", unlock: "playing 5 different drills", achievement: "drill-sampler" },
  { id: "blue", name: "Blue glaze", unlock: "four weekly goals in a row", achievement: "goal-4" },
  { id: "wood", name: "Wood", unlock: "100 practice days", achievement: "days-100" },
  { id: "stone", name: "Stone", unlock: "twelve weekly goals in a row", achievement: "goal-12" },
];

/** Accents you can choose now. Violet comes with any level 3. */
export function unlockedAccents(state: Pick<EngagementState, "achievements" | "levels"> | undefined): Set<AccentId> {
  const ids = new Set(state?.achievements.map((a) => a.id) ?? []);
  const out = new Set<AccentId>(["green"]);
  for (const a of ACCENTS) if (a.achievement && ids.has(a.achievement)) out.add(a.id);
  if (state?.levels.some((l) => l.level >= 3)) out.add("violet");
  return out;
}

export function unlockedPots(state: Pick<EngagementState, "achievements"> | undefined): Set<PotId> {
  const ids = new Set(state?.achievements.map((a) => a.id) ?? []);
  return new Set(POTS.filter((p) => !p.achievement || ids.has(p.achievement)).map((p) => p.id));
}
