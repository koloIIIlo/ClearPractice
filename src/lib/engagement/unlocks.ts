import { BOSSES } from "@/content/bosses";
import { DRILLS } from "@/content/drills";
import type { AreaId, AreaStatus } from "./types";

/**
 * Soft locks (roadmap 9.15): drills and boss levels say when they are
 * recommended, but are always playable. Calm style shows no lock text.
 * Keys are drill IDs and `boss:<id>`.
 */
export const RECOMMENDED_AFTER: Record<string, { area: AreaId; level: number }> = Object.fromEntries([
  ...DRILLS.flatMap((d) => (d.recommendedAfter ? [[d.id, d.recommendedAfter] as const] : [])),
  ...BOSSES.map((b) => [`boss:${b.id}`, b.recommendedAfter] as const),
]);

/** The level an item is recommended after and whether you have reached it; null when it has none. */
export function recommendation(itemId: string, areas: readonly AreaStatus[]): { area: AreaId; level: number; met: boolean } | null {
  const rec = RECOMMENDED_AFTER[itemId];
  if (!rec) return null;
  const current = areas.find((a) => a.area === rec.area)?.current ?? 0;
  return { ...rec, met: current >= rec.level };
}
