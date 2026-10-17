import { themeFor } from "@/content/monthly-themes";
import { parseLocalDate, UI_LOCALE } from "@/lib/format";
import { addLocalDays } from "@/lib/phrase-schedule";
import type { PracticeEvent } from "@/lib/ipc/schemas";
import { allPracticeDays, weekStart, type WeekStartsOn } from "./weekly";

/**
 * Natural fresh starts (roadmap 9.13; Dai, Milkman & Riis 2014): a new week,
 * a new month, coming back after a break. No pressure, nothing lost.
 */
export const COMEBACK_DAYS = 14;

export type FreshStart = { kind: "comeback" | "month" | "week"; text: string } | null;

/** Back after 14 or more days without practice (today not yet practised). */
export function isComeback(events: readonly PracticeEvent[], today: string): boolean {
  const before = allPracticeDays(events).filter((d) => d < today);
  const last = before.at(-1);
  return !!last && addLocalDays(last, COMEBACK_DAYS) <= today;
}

const monthName = new Intl.DateTimeFormat(UI_LOCALE, { month: "long" });

/** The one note to show today, if any: comeback first, then the month, then a new week. */
export function freshStartNote(events: readonly PracticeEvent[], today: string, startsOn: WeekStartsOn): FreshStart {
  if (isComeback(events, today)) return { kind: "comeback", text: "Welcome back. Today's plan is short; pick up where it feels right." };
  if (Number(today.slice(8, 10)) <= 7) {
    const theme = themeFor(today);
    return { kind: "month", text: `${monthName.format(parseLocalDate(today))}: ${theme.title}. ${theme.note}` };
  }
  if (weekStart(today, startsOn) === today) return { kind: "week", text: "New week. Three quests are ready." };
  return null;
}
