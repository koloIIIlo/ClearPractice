import { expect, it } from "vitest";
import { sessions, phrases } from "./ipc/mock-data";
import { buildTodayPlan, DAILY_FOCUSES, dayNumber, PLAN_STEPS } from "./today-plan";
import { TodayPlan } from "./ipc/schemas";

it("rotates the focus daily and the new topic weekly, from real sessions and phrases (4.12)", () => {
  const summaries = sessions.map(({ attempts: _a, notes: _n, ...s }) => s);
  const latest = { ...structuredClone(sessions[0]), takeaway: "Lead with the point." };
  const plan = buildTodayPlan({ localDate: "2026-10-09", length: "standard", sessions: summaries as never, phrases, latest });
  expect(() => TodayPlan.parse(plan)).not.toThrow();
  expect(plan.steps).toEqual(PLAN_STEPS.standard);
  expect(plan.focus).toBe(DAILY_FOCUSES[dayNumber("2026-10-09") % DAILY_FOCUSES.length]);
  expect(buildTodayPlan({ localDate: "2026-10-10", length: "short", sessions: [], phrases: [], latest: null }).focus).not.toBe(plan.focus);
  expect(plan.focusReason).not.toMatch(/your last|you chose/i); // no invented reasons about the user
  expect(plan.lastCompleted?.id).toBe(sessions.find((s) => s.status === "completed")?.id);
  expect(plan.recentReflection).toBe(plan.lastCompleted?.id === latest.id ? "Lead with the point." : null);
  // The due phrase is the earliest due one; nothing due means none.
  expect(plan.duePhrase === null || plan.duePhrase.dueDate <= "2026-10-09").toBe(true);
  const none = buildTodayPlan({ localDate: "2000-01-01", length: "short", sessions: [], phrases, latest: null });
  expect(none.duePhrase).toBeNull();
  expect(none.lastCompleted).toBeNull();
  expect(none.steps).toEqual(PLAN_STEPS.short);
  // Same week (Monday to Sunday) → same new topic; the next week → another.
  const monday = buildTodayPlan({ localDate: "2026-10-05", length: "short", sessions: [], phrases: [], latest: null });
  const sunday = buildTodayPlan({ localDate: "2026-10-11", length: "short", sessions: [], phrases: [], latest: null });
  const next = buildTodayPlan({ localDate: "2026-10-12", length: "short", sessions: [], phrases: [], latest: null });
  expect(sunday.weekly.newSituation.promptId).toBe(monday.weekly.newSituation.promptId);
  expect(next.weekly.newSituation.promptId).not.toBe(monday.weekly.newSituation.promptId);
});
