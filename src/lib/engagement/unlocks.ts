import type { AreaId, AreaStatus } from "./types";

/**
 * Soft locks (roadmap 9.15): drills and boss levels say when they are
 * recommended, but are always playable. Calm style shows no lock text.
 * Entries arrive with the drills (M10).
 */
export const RECOMMENDED_AFTER: Record<string, { area: AreaId; level: number }> = {};

export function recommendation(itemId: string, areas: readonly AreaStatus[]): { area: AreaId; level: number; met: boolean } | null {
  const rec = RECOMMENDED_AFTER[itemId];
  if (!rec) return null;
  const current = areas.find((a) => a.area === rec.area)?.current ?? 0;
  return { ...rec, met: current >= rec.level };
}
