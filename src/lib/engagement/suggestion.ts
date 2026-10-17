import type { Suggestion } from "@/lib/scheduler";
import { areaDef, available, LEVELS } from "./skills";
import type { AreaId, AreaStatus } from "./types";

/**
 * One more suggestion source in Playful style (roadmap 9.15): the area with
 * the least practice in the last 30 days, with a place to practise it now.
 * Rules-based, with its reason, and always optional. It lives here, not in
 * the scheduler, so Today's start-up doesn't carry the level catalogue.
 */
export function areaSuggestion(areas: readonly AreaStatus[], activity: Record<AreaId, number>): (Suggestion & { to: string; area: AreaId }) | null {
  const ranked = [...areas].sort((a, b) => activity[a.area] - activity[b.area] || a.current - b.current || a.area.localeCompare(b.area));
  for (const a of ranked) {
    const level = LEVELS[a.area][Math.min(a.current, 4)];
    const link = level.practise.find(available);
    if (!link) continue;
    return { area: a.area, to: link.to, text: `Give ${areaDef(a.area).title} five minutes today: ${link.label}`, reason: "It has had the least practice in the last 30 days." };
  }
  return null;
}
