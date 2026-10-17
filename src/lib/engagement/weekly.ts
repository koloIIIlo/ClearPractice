import { addLocalDays } from "@/lib/phrase-schedule";
import { parseLocalDate } from "@/lib/format";
import type { PracticeEvent } from "@/lib/ipc/schemas";

/**
 * A forgiving habit target (roadmap 9.8): practise on N days of each week.
 * Missing a day never breaks anything, and a met week stays met.
 */
export type WeekStartsOn = "monday" | "sunday";

/** Kinds that make a day a practice day (drill rounds and exposure steps join later). */
const PRACTICE_KINDS = new Set(["take_saved", "transfer_review", "exposure_step", "drill_round"]);

/** The local date of the first day of the week that contains `localDate`. */
export function weekStart(localDate: string, startsOn: WeekStartsOn): string {
  const day = parseLocalDate(localDate).getDay(); // 0 = Sunday
  const back = startsOn === "monday" ? (day + 6) % 7 : day;
  return addLocalDays(localDate, -back);
}

/** The seven local dates of a week. */
export function weekDays(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addLocalDays(start, i));
}

/** Every day with practice, oldest first. */
// One pass asks this a dozen times of the same events (goal, achievements, Sprout), so it is kept per array.
const dayCache = new WeakMap<readonly PracticeEvent[], readonly string[]>();
export function allPracticeDays(events: readonly PracticeEvent[]): readonly string[] {
  let days = dayCache.get(events);
  if (!days) dayCache.set(events, (days = [...new Set(events.filter((e) => PRACTICE_KINDS.has(e.kind)).map((e) => e.localDate))].sort()));
  return days;
}

/** Days of this week with a saved take, a reflection, a drill round or an exposure step. */
export function practiceDays(events: readonly PracticeEvent[], start: string): string[] {
  const end = addLocalDays(start, 6);
  return allPracticeDays(events).filter((d) => d >= start && d <= end);
}

export function goalProgress(events: readonly PracticeEvent[], start: string, goalDays: number): { days: number; goal: number; met: boolean } {
  const days = practiceDays(events, start).length;
  return { days, goal: goalDays, met: days >= goalDays };
}

/**
 * Consecutive weeks with the goal met, counting back from last week; this week
 * counts once it is met. A week not yet met never breaks the count.
 */
export function weeksInARow(goalWeeks: readonly string[], currentWeek: string, metThisWeek: boolean): number {
  const met = new Set(goalWeeks);
  let count = metThisWeek || met.has(currentWeek) ? 1 : 0;
  for (let week = addLocalDays(currentWeek, -7); met.has(week); week = addLocalDays(week, -7)) count += 1;
  return count;
}
