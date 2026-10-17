/**
 * Sprout, a small plant that grows with your practice days (roadmap 9.11). It
 * never wilts, never gets sad and never shrinks: stages only go up.
 */
export const COMPANION_STAGES = [
  { stage: 0, days: 0, name: "a seed" },
  { stage: 1, days: 1, name: "a sprout" },
  { stage: 2, days: 3, name: "two leaves" },
  { stage: 3, days: 7, name: "a young plant" },
  { stage: 4, days: 14, name: "a bushy plant" },
  { stage: 5, days: 30, name: "a plant with a bud" },
  { stage: 6, days: 60, name: "a flowering plant" },
  { stage: 7, days: 100, name: "a small tree" },
  { stage: 8, days: 180, name: "a blossoming tree" },
] as const;
export const MAX_STAGE = 8;

export function stageForDays(days: number): number {
  let stage = 0;
  for (const s of COMPANION_STAGES) if (days >= s.days) stage = s.stage;
  return stage;
}

/** Practice days until the next stage, or null at the last one. */
export function daysToNextStage(days: number): number | null {
  const next = COMPANION_STAGES.find((s) => s.days > days);
  return next ? next.days - days : null;
}
