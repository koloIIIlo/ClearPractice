import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Panel } from "@/components/page";
import { Button } from "@/components/ui/button";
import { formatDuration, formatLongDay, parseLocalDate, UI_LOCALE } from "@/lib/format";
import { useSessions } from "@/lib/ipc/queries";
import type { SessionSummary } from "@/lib/ipc/schemas";
import { addLocalDays, toLocalDate } from "@/lib/phrase-schedule";
import { cn } from "@/lib/utils";

type Day = { sessions: number; takes: number; speakingMs: number };

/** Each practised day's sessions, takes and speaking time, by the session's own calendar day. */
export function activityByDay(sessions: SessionSummary[]): Map<string, Day> {
  const days = new Map<string, Day>();
  for (const s of sessions) {
    if (s.attemptCount === 0) continue;
    const day = days.get(s.localDate) ?? { sessions: 0, takes: 0, speakingMs: 0 };
    day.sessions += 1;
    day.takes += s.attemptCount;
    day.speakingMs += s.durationMs;
    days.set(s.localDate, day);
  }
  return days;
}

/** 0 (none) to 4, by speaking time: any, 2 min, 5 min, 10 min or more. */
export function intensity(day: Day | undefined): 0 | 1 | 2 | 3 | 4 {
  if (!day) return 0;
  const minutes = day.speakingMs / 60_000;
  return minutes >= 10 ? 4 : minutes >= 5 ? 3 : minutes >= 2 ? 2 : 1;
}

const SHADE = ["bg-muted", "bg-primary/25", "bg-primary/50", "bg-primary/75", "bg-primary"] as const;
const monthFmt = new Intl.DateTimeFormat(UI_LOCALE, { month: "short" });
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Monday-start weeks covering the whole year, as columns of seven dates (or null outside the year). */
function yearWeeks(year: number): (string | null)[][] {
  const first = `${year}-01-01`;
  const start = addLocalDays(first, -((parseLocalDate(first).getDay() + 6) % 7));
  const weeks: (string | null)[][] = [];
  for (let monday = start; monday <= `${year}-12-31`; monday = addLocalDays(monday, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => {
      const date = addLocalDays(monday, i);
      return date.startsWith(`${year}-`) ? date : null;
    }));
  }
  return weeks;
}

/**
 * The whole year of practice at a glance (user request 2026-10-10): one square
 * per day, darker for more speaking time, nothing counting down and no streaks.
 * A practised day opens that day's sessions.
 */
export function ActivityCalendar() {
  const sessions = useSessions({});
  const today = toLocalDate(new Date());
  const thisYear = Number(today.slice(0, 4));
  const days = useMemo(() => activityByDay(sessions.data ?? []), [sessions.data]);
  const firstYear = useMemo(() => {
    const years = [...days.keys()].map((d) => Number(d.slice(0, 4)));
    return years.length ? Math.min(...years, thisYear) : thisYear;
  }, [days, thisYear]);
  const [year, setYear] = useState(thisYear);
  const weeks = useMemo(() => yearWeeks(year), [year]);
  const scroller = useRef<HTMLDivElement>(null);

  // On a narrow window, start at the latest weeks.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = year === thisYear ? el.scrollWidth : 0;
  }, [year, thisYear, sessions.data]);

  const inYear = [...days.entries()].filter(([d]) => d.startsWith(`${year}-`));
  const totals = inYear.reduce((t, [, d]) => ({ takes: t.takes + d.takes, speakingMs: t.speakingMs + d.speakingMs }), { takes: 0, speakingMs: 0 });

  return (
    <Panel data-tour="activity" className="space-y-4" aria-labelledby="activity-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="activity-heading" className="font-semibold">Activity</h2>
          <p className="text-meta text-muted-foreground tabular-nums">
            {inYear.length === 0
              ? `No practice recorded in ${year} yet.`
              : `${plural(inYear.length, "day", "days")} practised in ${year} · ${plural(totals.takes, "take", "takes")} · ${formatDuration(totals.speakingMs)} speaking`}
          </p>
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="Year">
          <Button variant="ghost" size="icon-sm" aria-label="Previous year" disabled={year <= firstYear} onClick={() => setYear((y) => y - 1)}>
            <ChevronLeft aria-hidden />
          </Button>
          <span className="w-12 text-center font-medium tabular-nums" aria-live="polite">{year}</span>
          <Button variant="ghost" size="icon-sm" aria-label="Next year" disabled={year >= thisYear} onClick={() => setYear((y) => y + 1)}>
            <ChevronRight aria-hidden />
          </Button>
        </div>
      </div>

      <div ref={scroller} className="overflow-x-auto pb-1">
        <div className="inline-grid grid-flow-col gap-[3px]" style={{ gridTemplateRows: "auto repeat(7, 12px)" }}>
          {/* Weekday labels: Mon, Wed, Fri. */}
          <span aria-hidden />
          {["Mon", "", "Wed", "", "Fri", "", ""].map((label, i) => (
            <span key={i} aria-hidden className="pr-1.5 text-meta leading-3 text-muted-foreground">{label}</span>
          ))}
          {weeks.map((week, w) => {
            const firstOfMonth = week.find((d) => d?.endsWith("-01"));
            return [
              <span key={`m${w}`} aria-hidden className="h-4 w-3 overflow-visible text-meta leading-none whitespace-nowrap text-muted-foreground">
                {firstOfMonth || (w === 0 && week.some(Boolean)) ? monthFmt.format(parseLocalDate(firstOfMonth ?? week.find(Boolean)!)) : ""}
              </span>,
              ...week.map((date, d) => {
                if (!date) return <span key={`${w}-${d}`} aria-hidden className="size-3" />;
                const day = days.get(date);
                const level = intensity(day);
                const future = date > today;
                const label = `${formatLongDay(date)}: ${day ? `${plural(day.sessions, "session", "sessions")}, ${plural(day.takes, "take", "takes")}, ${formatDuration(day.speakingMs)} speaking` : future ? "later" : "no practice"}`;
                const cell = cn("block size-3 rounded-[3px]", SHADE[level], future && "bg-transparent outline outline-1 -outline-offset-1 outline-border", date === today && "ring-2 ring-primary/40 ring-offset-1 ring-offset-card");
                return day ? (
                  <Link key={date} to={`/sessions?date=${date}`} className={cn(cell, "hover:ring-2 hover:ring-ring")} title={label} aria-label={label} />
                ) : (
                  <span key={date} className={cell} title={label} aria-hidden />
                );
              }),
            ];
          })}
        </div>
      </div>

      <div className="flex items-center justify-end gap-1.5 text-meta text-muted-foreground" aria-hidden>
        Less
        {SHADE.map((s) => <span key={s} className={cn("size-3 rounded-[3px]", s)} />)}
        More
      </div>
    </Panel>
  );
}
