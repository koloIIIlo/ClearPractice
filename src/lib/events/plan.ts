import { parseLocalDate } from "@/lib/format";
import { addLocalDays } from "@/lib/phrase-schedule";
import type { EventItemKind, EventPlanItem, EventView, RealEventKind } from "@/lib/ipc/schemas";

/**
 * Event mode's plan (roadmap 14.2): preparation spread over the days before a
 * real talk, interview, meeting, toast or pitch, because spaced rehearsal
 * beats cramming (Cepeda et al. 2006). Weekends are not skipped; you change
 * the dates before saving. Information only: nothing here counts down or
 * marks anything late.
 */
export type PlanItem = { position: number; localDate: string; kind: EventItemKind; title: string };
export type PlanEvent = { kind: RealEventKind; localDate: string; minutes: number | null; startTime?: string | null };

/** Whole days from `from` to `to`, negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseLocalDate(to).getTime() - parseLocalDate(from).getTime()) / 86_400_000);
}

export const KIND_LABELS: Record<RealEventKind, string> = { talk: "Talk", interview: "Interview", meeting: "Meeting", toast: "Toast", pitch: "Pitch", other: "Other" };

export const ITEM_LABELS: Record<EventItemKind, string> = {
  outline: "Outline", run_through: "Run-through", qa_drill: "Q&A drill", mock: "Mock", dress_rehearsal: "Dress rehearsal", routine: "Pre-talk routine", debrief: "Debrief",
};

const outlineTitle = (kind: RealEventKind) => (kind === "interview" ? "Outline your answers" : kind === "meeting" ? "Outline your points" : "Outline your talk");
const mockTitle = (kind: RealEventKind) => (kind === "interview" ? "Mock interview" : "Mock meeting");
const REHEARSALS = new Set<EventItemKind>(["run_through", "dress_rehearsal"]);

/** Spreads preparation over the days left (the event date minus today). */
export function buildEventPlan(event: PlanEvent, today: string): PlanItem[] {
  const days = daysBetween(today, event.localDate);
  const before = (n: number) => addLocalDays(event.localDate, -n);
  // After the event's time on the day, or the day after when no time is set.
  const debrief = { localDate: event.startTime ? event.localDate : addLocalDays(event.localDate, 1), kind: "debrief" as const, title: "Debrief" };
  const routine = { localDate: event.localDate, kind: "routine" as const, title: "Pre-talk routine" };
  const outline = { localDate: today, kind: "outline" as const, title: outlineTitle(event.kind) };
  let items: Omit<PlanItem, "position">[];
  if (days < 0) {
    items = [{ localDate: today, kind: "debrief", title: "Debrief" }];
  } else if (days === 0) {
    items = [{ ...routine, localDate: today }, { localDate: today, kind: "run_through", title: "Run-through" }, debrief];
  } else if (days <= 3) {
    items = [outline, { localDate: today, kind: "run_through", title: "Run-through" }];
    // The day before, when that isn't today.
    if (days >= 2) items.push({ localDate: before(1), kind: "dress_rehearsal", title: "Dress rehearsal" });
    items.push(routine, debrief);
  } else if (days <= 9) {
    items = [
      outline,
      { localDate: addLocalDays(today, 1), kind: "run_through", title: "Run-through" },
      { localDate: addLocalDays(today, Math.round(days / 2)), kind: "qa_drill", title: "Q&A drill" },
      { localDate: before(1), kind: "dress_rehearsal", title: "Dress rehearsal" },
      routine,
      debrief,
    ];
  } else {
    // At 60 %, 50 %, 35 % and 25 % of the time left.
    const at = (share: number) => before(Math.round(days * share));
    items = [
      outline,
      { localDate: at(0.6), kind: "run_through", title: "Run-through 1" },
      { localDate: at(0.5), kind: "qa_drill", title: "Q&A drill" },
      { localDate: at(0.35), kind: "run_through", title: "Run-through 2" },
      ...(event.kind === "interview" || event.kind === "meeting" ? [{ localDate: at(0.25), kind: "mock" as const, title: mockTitle(event.kind) }] : []),
      { localDate: before(2), kind: "dress_rehearsal", title: "Dress rehearsal" },
      routine,
      debrief,
    ];
  }
  return number(apart(items, today, event.localDate));
}

/** Moves a rehearsal off a day another rehearsal already has, when a free day before the event exists. */
function apart(items: Omit<PlanItem, "position">[], today: string, eventDay: string): Omit<PlanItem, "position">[] {
  const taken = new Set<string>();
  return sortByDay(items).map((item) => {
    if (!REHEARSALS.has(item.kind)) return item;
    let day = item.localDate;
    for (let n = 1; taken.has(day) && n <= 60; n += 1) {
      const later = addLocalDays(item.localDate, n);
      const earlier = addLocalDays(item.localDate, -n);
      if (later < eventDay && !taken.has(later)) day = later;
      else if (earlier >= today && !taken.has(earlier)) day = earlier;
    }
    taken.add(day);
    return { ...item, localDate: day };
  });
}

/** By day, keeping the plan's order within a day. */
const sortByDay = <T extends { localDate: string }>(items: T[]) => items.map((item, i) => ({ item, i })).sort((a, b) => a.item.localDate.localeCompare(b.item.localDate) || a.i - b.i).map((x) => x.item);

const number = (items: Omit<PlanItem, "position">[]): PlanItem[] => sortByDay(items).map((item, i) => ({ ...item, position: i + 1 }));

/** About how long an item takes, for "today: run-through 2 (20 min)". */
export function itemMinutes(kind: EventItemKind, eventMinutes: number | null): number | null {
  switch (kind) {
    case "run_through":
    case "dress_rehearsal":
      return eventMinutes;
    case "routine":
      return 3;
    case "outline":
    case "qa_drill":
    case "mock":
      return null;
    case "debrief":
      return 5;
  }
}

/** The next item that isn't done: one due today or before first, else the next one ahead. */
export function nextItem(view: EventView, today: string): { item: EventPlanItem; due: boolean } | null {
  const open = view.items.filter((i) => !i.doneAt);
  const due = open.find((i) => i.localDate <= today);
  if (due) return { item: due, due: true };
  return open[0] ? { item: open[0], due: false } : null;
}

/** After its day, an event moves to Past events once its debrief is written, or after 7 days. */
export function isPast(view: EventView, today: string): boolean {
  const since = daysBetween(view.event.localDate, today);
  return since > 0 && (view.debriefDone || since > 7);
}

/** "in 6 days", "tomorrow", "today", "2 days ago". */
export function whenText(localDate: string, today: string): string {
  const days = daysBetween(today, localDate);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}
