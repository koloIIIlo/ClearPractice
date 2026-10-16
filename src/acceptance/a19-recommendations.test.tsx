/**
 * A-19: difficulty recommendations always show a reason, tolerate missing
 * evidence (no sessions, no ratings, no conditions, unknown prompts), and the
 * user can override them at any time: take a challenge before it is offered,
 * decline an offer, or choose easier practice. The choice is recorded with
 * the reason shown.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { PROMPTS } from "@/content/prompts";
import { IpcContext, type IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import { sessions } from "@/lib/ipc/mock-data";
import { TodayPlan, type SessionDetail } from "@/lib/ipc/schemas";
import { currentStage, schedule, STAGES, type ProgressionEvent, type Schedule } from "@/lib/scheduler";
import { buildTodayPlan } from "@/lib/today-plan";
import { StagePanel } from "@/features/today/StagePanel";

const base = structuredClone(sessions[0]) as SessionDetail;
const unfamiliar = PROMPTS.find((p) => STAGES[1].matches(p))!;
const s = (id: string, day: string, extra: Partial<SessionDetail> = {}): SessionDetail => ({
  ...base, id, localDate: day, startedAt: `${day}T10:00:00.000Z`, exerciseType: "repeat", focus: null, ease: null,
  contentId: unfamiliar.id, conditions: { ...base.conditions!, familiarity: "unfamiliar" }, ...extra,
});
const event = (stageTo: number): ProgressionEvent => ({ kind: "advance", stageFrom: Math.max(1, stageTo - 1), stageTo, reason: "", createdAt: "2026-10-01T00:00:00.000Z" });

function reasons(plan: Schedule): string[] {
  return [plan.evidence, plan.offer?.reason, plan.focus?.reason, ...plan.suggestions.flatMap((x) => [x.text, x.reason])].filter((r): r is string => r !== undefined);
}

it("every recommendation comes with a reason", () => {
  const three = [s("c", "2026-10-05", { ease: 4, focus: "Lead with it" }), s("b", "2026-10-04", { focus: "Lead with it" }), s("a", "2026-10-04", { focus: "Lead with it" })];
  const cases = [
    schedule({ recent: three, events: [event(2)], prompts: PROMPTS }), // an offer, a recurring focus, variety
    schedule({ recent: [s("c", "2026-10-05", { ease: 2 }), ...three.slice(1)], events: [event(2)], prompts: PROMPTS }), // strain
    schedule({ recent: [s("c", "2026-10-05"), ...three.slice(1)], events: [event(2)], prompts: PROMPTS }), // missing rating
  ];
  expect(cases[0].offer).not.toBeNull();
  expect(cases.every((c) => c.suggestions.length > 0)).toBe(true);
  for (const plan of cases) {
    for (const reason of reasons(plan)) expect(reason.trim().length).toBeGreaterThan(10);
    if (plan.offer) expect(plan.offer.reason).toMatch(/sessions at this stage.*manageable/);
  }
  expect(cases[1].suggestions[0].reason).toMatch(/felt hard \(2 of 5\).*not a result/);
  expect(cases[2].suggestions[0].reason).toMatch(/missing rating is not a failure/);
});

it("tolerates missing evidence: no sessions, no ratings, no conditions, unknown prompts and unknown stages", () => {
  const sparse = [
    s("a", "2026-10-05", { conditions: null, conditionsUnavailableReason: "Legacy take" }),
    s("b", "2026-10-04", { contentId: null }),
    s("c", "2026-10-03", { contentId: "not-in-the-pack" }),
    s("d", "2026-10-02", { ease: undefined, focus: "   " }),
  ];
  for (const recent of [[], sparse]) {
    for (const events of [[], [event(2)], [event(99)]]) {
      const plan = schedule({ recent, events, prompts: PROMPTS });
      expect(plan.offer).toBeNull(); // not enough evidence is never a failure, just no offer yet
      expect(plan.evidence).toMatch(/^[01] /); // only the session with known conditions and prompt counts
      const today = buildTodayPlan({ localDate: "2026-10-09", length: "short", sessions: [], phrases: [], latest: null, plan, prompts: PROMPTS });
      expect(() => TodayPlan.parse(today)).not.toThrow();
    }
  }
  expect(currentStage([event(99)]).stage).toBe(1); // an unknown stage falls back to the first
  expect(schedule({ recent: [sparse[3]], events: [], prompts: PROMPTS }).focus).toBeNull(); // a blank focus is not carried over
});

function panel(progression: TodayPlan["progression"]) {
  const recordProgression = vi.fn(async (kind: "advance" | "easier" | "stay", reason: string) => ({ kind, stageFrom: 2, stageTo: 3, reason, createdAt: "x" }));
  const client: IpcClient = { ...createMockClient(), recordProgression };
  const plan: TodayPlan = { ...buildTodayPlan({ localDate: "2026-10-09", length: "short", sessions: [], phrases: [], latest: null }), progression, suggestions: [] };
  const view = render(<QueryClientProvider client={new QueryClient()}><IpcContext.Provider value={client}><StagePanel plan={plan} /></IpcContext.Provider></QueryClientProvider>);
  return { recordProgression, view };
}

it("accepts your override at any time and records it with the reason shown", async () => {
  const user = userEvent.setup();
  // No offer yet: you can still choose a challenge, or easier practice.
  const early = panel({ stage: 2, title: "Unfamiliar explanation", demand: "A new question", evidence: "1 unfamiliar session at this stage on 1 day since it started.", offer: null });
  await user.click(screen.getByRole("button", { name: "Try stage 3 anyway" }));
  expect(early.recordProgression).toHaveBeenLastCalledWith("advance", expect.stringMatching(/before the app suggested it/));
  await waitFor(() => expect(screen.getByRole("button", { name: "Easier practice" })).toBeEnabled());
  await user.click(screen.getByRole("button", { name: "Easier practice" }));
  expect(early.recordProgression).toHaveBeenLastCalledWith("easier", expect.stringMatching(/easier practice/));
  early.view.unmount();

  // An offer: accept it, or say Not yet.
  const offered = panel({ stage: 2, title: "Unfamiliar explanation", demand: "A new question", evidence: "3 unfamiliar sessions.", offer: { stage: 3, title: "Audience adaptation", reason: "Your latest one felt manageable (4 of 5)." } });
  expect(screen.queryByRole("button", { name: /anyway/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Not yet" }));
  expect(offered.recordProgression).toHaveBeenLastCalledWith("stay", expect.stringMatching(/stay at this stage/));
  await waitFor(() => expect(screen.getByRole("button", { name: "Try stage 3" })).toBeEnabled());
  await user.click(screen.getByRole("button", { name: "Try stage 3" }));
  expect(offered.recordProgression).toHaveBeenLastCalledWith("advance", "Your latest one felt manageable (4 of 5).");
  offered.view.unmount();

  // The last stage has nothing harder to offer.
  panel({ stage: 5, title: "Interaction practice", demand: "Answer a follow-up", evidence: "e", offer: null });
  expect(screen.queryByRole("button", { name: /anyway/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Easier practice" })).toBeInTheDocument();
});
