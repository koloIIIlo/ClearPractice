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
  expect(next.weekly.realConversation.task).not.toBe(monday.weekly.realConversation.task);
  // A reflection saved this week (Monday to Sunday) marks the real-conversation row done (4.17).
  const review = { id: "t", localDate: "2026-10-05", situation: "s", preparation: "", listenerText: "", clarification: "", success: "", selfReport: "", nextFocus: "", createdAt: "x", flow: null, tags: [], kind: "reflection" as const, extra: null, missionId: null };
  const args = { length: "short" as const, sessions: [], phrases: [], latest: null, reviews: [review] };
  expect(buildTodayPlan({ ...args, localDate: "2026-10-11" }).weekly.realConversation.done).toBe(true);
  expect(buildTodayPlan({ ...args, localDate: "2026-10-12" }).weekly.realConversation.done).toBe(false);
  expect(buildTodayPlan({ ...args, localDate: "2026-10-04" }).weekly.realConversation.done).toBe(false);
});

it("cycles the daily focus through the focuses of your setup goals (4.19)", () => {
  const plan = (localDate: string, goals: string[]) => buildTodayPlan({ localDate, length: "short", sessions: [], phrases: [], latest: null, goals });
  const days = ["2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12"];
  const hesitation = days.map((d) => plan(d, ["hesitation"]).focus);
  expect(new Set(hesitation)).toEqual(new Set([DAILY_FOCUSES[1], DAILY_FOCUSES[4]]));
  expect(plan("2026-10-09", ["hesitation"]).focusReason).toMatch(/for your goals \(less hesitation\)/);
  expect(plan("2026-10-09", []).focusReason).toMatch(/curriculum's daily rotation/);
});

it("builds progress from real sessions, keeping rehearsed and unfamiliar apart and pace unavailable, never 0 (4.16)", async () => {
  const { buildProgress } = await import("./today-plan");
  const base = structuredClone(sessions[0]);
  const s = (id: string, familiarity: "familiar" | "unfamiliar", startedAt: string, extra: object = {}) =>
    ({ ...base, id, status: "in_progress" as const, startedAt, localDate: startedAt.slice(0, 10), durationMs: 90_000, conditions: { ...base.conditions!, familiarity }, ...extra });
  const details = [
    s("a", "familiar", "2026-10-01T10:00:00Z", { ease: 3 }),
    s("b", "familiar", "2026-10-03T10:00:00Z", { ease: null, takeaway: "Lead with the point." }),
    s("c", "unfamiliar", "2026-10-02T10:00:00Z"),
    s("d", "familiar", "2026-10-04T10:00:00Z", { status: "interrupted" as const }),
  ];
  const rehearsed = buildProgress("rehearsed", details as never, { a: 131 });
  expect(rehearsed.completedSessions).toBe(2);
  expect(rehearsed.practiceMinutes).toBe(3);
  expect(rehearsed.points.map((p) => [p.sessionId, p.ease, p.estimatedPaceWpm])).toEqual([["a", 3, 131], ["b", null, null]]);
  expect(rehearsed.highlight).toEqual({ sessionId: "b", title: base.title, improvement: "Lead with the point.", listenerFeedback: null });
  expect(buildProgress("unfamiliar", details as never).points.map((p) => p.sessionId)).toEqual(["c"]);
  expect(buildProgress("real", details as never).completedSessions).toBe(0);
});

it("buildProgressFromFacts matches buildProgress on the same history (8.6)", async () => {
  const { buildProgress, buildProgressFromFacts, evidenceTakes } = await import("./today-plan");
  const { createMockClient } = await import("./ipc/mock-client");
  const facts = await createMockClient().getPracticeFacts();
  const texts = Object.fromEntries(sessions.map((s) => [s.id, { title: s.title, takeaway: s.takeaway ?? null }]));
  for (const view of ["rehearsed", "unfamiliar", "real"] as const) {
    // The paces the per-session path would have read from each take's transcript.
    const paces: Record<string, number | null> = {};
    for (const s of sessions) {
      const found = evidenceTakes(view, s.attempts).map((a) => facts.takes.find((t) => t.id === a.id)?.paceWpm ?? null).find((p) => p !== null);
      paces[s.id] = found == null ? null : Math.round(found);
    }
    expect(buildProgressFromFacts(view, facts, texts), view).toEqual(buildProgress(view, sessions, paces));
  }
});
