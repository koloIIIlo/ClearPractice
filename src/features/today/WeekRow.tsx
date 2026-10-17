import { Link } from "react-router";
import { useSessions } from "@/lib/ipc/queries";
import type { SessionSummary } from "@/lib/ipc/schemas";
import { formatDuration, parseLocalDate, UI_LOCALE } from "@/lib/format";
import { addLocalDays } from "@/lib/phrase-schedule";
import { cn } from "@/lib/utils";
import { usePracticeStyle } from "@/features/engagement/style";
import { GoalRing } from "@/features/journey/WeekGoal";
import { useWeekGoal } from "@/features/journey/useWeekGoal";

type Tally = { days: number; takes: number; speakingMs: number };
export type WeekRecap = {
  days: { date: string; practised: boolean; isToday: boolean; future: boolean }[];
  thisWeek: Tally;
  lastWeek: Tally;
  anyHistory: boolean;
};

/** Monday of the week that contains `localDate` (weeks start on Monday in en-GB). */
function mondayOf(localDate: string): string {
  return addLocalDays(localDate, -((parseLocalDate(localDate).getDay() + 6) % 7));
}

function tally(sessions: SessionSummary[], from: string, to: string): Tally {
  const inRange = sessions.filter((s) => s.localDate >= from && s.localDate <= to);
  return {
    days: new Set(inRange.map((s) => s.localDate)).size,
    takes: inRange.reduce((n, s) => n + s.attemptCount, 0),
    speakingMs: inRange.reduce((n, s) => n + s.durationMs, 0),
  };
}

/** This week's days with a saved take, from the sessions list (each session's own calendar day). */
export function weekRecap(sessions: SessionSummary[], today: string): WeekRecap {
  const practised = sessions.filter((s) => s.attemptCount > 0);
  const monday = mondayOf(today);
  const dates = new Set(practised.map((s) => s.localDate));
  return {
    days: Array.from({ length: 7 }, (_, i) => {
      const date = addLocalDays(monday, i);
      return { date, practised: dates.has(date), isToday: date === today, future: date > today };
    }),
    thisWeek: tally(practised, monday, today),
    lastWeek: tally(practised, addLocalDays(monday, -7), addLocalDays(monday, -1)),
    anyHistory: practised.length > 0,
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One calm line under the dots. A new week leads with last week's work, never a zero. */
export function recapLine({ thisWeek, lastWeek }: WeekRecap): string {
  if (thisWeek.days > 0)
    return `${plural(thisWeek.days, "day", "days")} · ${plural(thisWeek.takes, "take", "takes")} · ${formatDuration(thisWeek.speakingMs)} speaking`;
  if (lastWeek.days > 0) return `New week. Last week: ${plural(lastWeek.days, "day", "days")}, ${formatDuration(lastWeek.speakingMs)} speaking`;
  return "Your next take fills today's dot";
}

const initialFmt = new Intl.DateTimeFormat(UI_LOCALE, { weekday: "narrow" });
const longFmt = new Intl.DateTimeFormat(UI_LOCALE, { weekday: "long", day: "numeric", month: "long" });

/**
 * A compact recap for Today (guide §3.13): seven dots for this week, filled on
 * days with a saved take, and one line with days, takes and speaking time.
 * Nothing counts down and a missed day is just an empty dot. Hidden until there
 * is at least one take, so a first visit isn't greeted by a row of zeros.
 */
export function WeekRow({ today }: { today: string }) {
  const sessions = useSessions({});
  const { playful } = usePracticeStyle();
  // Playful style adds the weekly goal (9.8); Calm keeps the plain recap.
  const goal = useWeekGoal(playful);
  if (!sessions.data) return null;
  const recap = weekRecap(sessions.data, today);
  if (!recap.anyHistory) return null;
  return (
    <section data-tour="week" aria-label="Your week" className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 lg:flex-col lg:items-end lg:pt-1">
      <ol className="flex gap-1.5">
        {recap.days.map((d) => (
          <li key={d.date} className="flex w-5 flex-col items-center gap-1">
            <span aria-hidden className={cn("text-meta leading-none", d.isToday ? "font-semibold text-foreground" : "text-muted-foreground")}>
              {initialFmt.format(parseLocalDate(d.date))}
            </span>
            <span
              aria-hidden
              className={cn(
                "size-3 rounded-full border",
                // Empty past days ≥ 3:1 against the page in both themes; days still to come stay faint.
                d.practised ? "border-primary bg-primary" : d.isToday ? "border-2 border-primary" : d.future ? "border-dashed border-muted-foreground/40" : "border-muted-foreground/70",
                d.isToday && d.practised && "ring-2 ring-primary/30 ring-offset-1 ring-offset-background",
              )}
            />
            <span className="sr-only">
              {longFmt.format(parseLocalDate(d.date))}: {d.practised ? "practised" : d.future ? "later this week" : d.isToday ? "today, not yet" : "no take"}
            </span>
          </li>
        ))}
      </ol>
      <p className="flex flex-wrap items-center gap-x-1.5 text-meta text-muted-foreground tabular-nums">
        {goal && (
          <span className="inline-flex items-center gap-1.5">
            <GoalRing days={goal.days} goal={goal.goal} size={18} />
            <span className="text-foreground">{Math.min(goal.days, goal.goal)} of {goal.goal} days</span>
            {goal.weeksInARow >= 2 && <span>· {goal.weeksInARow} weeks in a row</span>}
            <span aria-hidden>·</span>
          </span>
        )}
        {recapLine(recap)} ·{" "}
        {/* Underlined: inside a line of text, colour alone is too close to the grey around it in dark mode (axe link-in-text-block). */}
        <Link to="/progress" className="text-primary underline underline-offset-2 hover:no-underline">Your year</Link>
      </p>
    </section>
  );
}
