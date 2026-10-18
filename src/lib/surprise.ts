import { seededRandom } from "./engagement/random";
import { toLocalDate } from "./phrase-schedule";
import type { Preferences } from "./ipc/schemas";

export const SURPRISE_DAY_KEY = "cp-surprise-on";
const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

/** A date always draws the same time. Window is local, start inclusive, end exclusive. */
export function surpriseMinute(date: string, start: string, end: string): number {
  const from = minutes(start);
  return from + Math.floor(seededRandom(date)() * (minutes(end) - from));
}

export function surpriseDue(now: Date, p: Preferences, shownOn: string | null, practised: boolean): boolean {
  const date = toLocalDate(now);
  const minute = now.getHours() * 60 + now.getMinutes();
  return p.surpriseEnabled && !practised && shownOn !== date && p.surpriseDays.includes(days[now.getDay()] as Preferences["surpriseDays"][number])
    && minute >= surpriseMinute(date, p.surpriseStart, p.surpriseEnd) && minute < minutes(p.surpriseEnd);
}
