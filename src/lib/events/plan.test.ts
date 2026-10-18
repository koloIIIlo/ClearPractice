import { describe, expect, it } from "vitest";
import { addLocalDays } from "@/lib/phrase-schedule";
import type { EventView, RealEventKind } from "@/lib/ipc/schemas";
import { buildEventPlan, daysBetween, isPast, nextItem, whenText } from "./plan";

const today = "2026-10-18";
const plan = (days: number, kind: RealEventKind = "talk", startTime: string | null = null) => buildEventPlan({ kind, localDate: addLocalDays(today, days), minutes: 20, startTime }, today);
/** Each item as kind@days-from-today. */
const brief = (items: ReturnType<typeof plan>) => items.map((i) => `${i.kind}@${daysBetween(today, i.localDate)}`);

describe("event plans (14.2)", () => {
  it("spreads items by the documented percentages for ten or more days", () => {
    const items = plan(20, "interview");
    // 60, 50, 35 and 25 % of the 20 days left: 12, 10, 7 and 5 days before.
    expect(brief(items)).toEqual(["outline@0", "run_through@8", "qa_drill@10", "run_through@13", "mock@15", "dress_rehearsal@18", "routine@20", "debrief@21"]);
    expect(items.map((i) => i.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(items.map((i) => i.title)).toEqual(["Outline your answers", "Run-through 1", "Q&A drill", "Run-through 2", "Mock interview", "Dress rehearsal", "Pre-talk routine", "Debrief"]);
    // With a start time, the debrief is on the day, after it.
    expect(brief(plan(20, "talk", "14:00")).at(-1)).toBe("debrief@20");
  });

  it("compresses for four to nine, one to three and zero days", () => {
    expect(brief(plan(6))).toEqual(["outline@0", "run_through@1", "qa_drill@3", "dress_rehearsal@5", "routine@6", "debrief@7"]);
    expect(brief(plan(4))).toEqual(["outline@0", "run_through@1", "qa_drill@2", "dress_rehearsal@3", "routine@4", "debrief@5"]);
    expect(brief(plan(3))).toEqual(["outline@0", "run_through@0", "dress_rehearsal@2", "routine@3", "debrief@4"]);
    // Tomorrow: the dress rehearsal would fall on today's run-through, so there is none.
    expect(brief(plan(1))).toEqual(["outline@0", "run_through@0", "routine@1", "debrief@2"]);
    expect(brief(plan(0, "toast", "19:00"))).toEqual(["routine@0", "run_through@0", "debrief@0"]);
    expect(brief(plan(-2))).toEqual(["debrief@0"]);
  });

  it("adds a mock only for interviews and meetings", () => {
    for (const kind of ["interview", "meeting"] as const) expect(plan(14, kind).some((i) => i.kind === "mock"), kind).toBe(true);
    for (const kind of ["talk", "toast", "pitch", "other"] as const) expect(plan(14, kind).some((i) => i.kind === "mock"), kind).toBe(false);
    expect(plan(14, "meeting").find((i) => i.kind === "mock")?.title).toBe("Mock meeting");
    expect(plan(7, "interview").some((i) => i.kind === "mock"), "shorter plans have none").toBe(false);
  });

  it("never schedules two rehearsals on one day when avoidable", () => {
    for (let days = 0; days <= 120; days += 1)
      for (const kind of ["talk", "interview"] as const) {
        const items = plan(days, kind);
        const rehearsals = items.filter((i) => i.kind === "run_through" || i.kind === "dress_rehearsal").map((i) => i.localDate);
        expect(new Set(rehearsals).size, `${kind} in ${days} days`).toBe(rehearsals.length);
        expect(items.every((i, n) => n === 0 || items[n - 1].localDate <= i.localDate), "in date order").toBe(true);
        expect(items.every((i) => i.localDate >= today), "nothing before today").toBe(true);
      }
  });

  it("finds the next item, and when an event moves to Past events", () => {
    const item = (localDate: string, done = false) => ({ id: `i-${localDate}`, position: 1, localDate, kind: "run_through" as const, title: "Run-through", doneAt: done ? "x" : null, refId: null, byHand: false });
    const view = (localDate: string, items = [item("2026-10-17", true), item("2026-10-18"), item("2026-10-20")], debriefDone = false): EventView => ({
      event: { id: "e", title: "Demo", kind: "talk", localDate, startTime: null, minutes: 20, audience: "", goal: "", talkId: null, createdAt: "x" }, items, debriefDone,
    });
    expect(nextItem(view("2026-10-22"), today)).toMatchObject({ due: true, item: { localDate: "2026-10-18" } });
    expect(nextItem(view("2026-10-22", [item("2026-10-20")]), today)).toMatchObject({ due: false, item: { localDate: "2026-10-20" } });
    expect(nextItem(view("2026-10-22", [item("2026-10-17", true)]), today)).toBeNull();
    expect(isPast(view(today), today)).toBe(false);
    expect(isPast(view("2026-10-15"), today), "waits for its debrief").toBe(false);
    expect(isPast(view("2026-10-15", [], true), today)).toBe(true);
    expect(isPast(view("2026-10-10"), today), "or 7 days").toBe(true);
    expect([whenText("2026-10-24", today), whenText(today, today), whenText("2026-10-19", today), whenText("2026-10-16", today)]).toEqual(["in 6 days", "today", "tomorrow", "2 days ago"]);
  });
});
