import { expect, it } from "vitest";
import { PROMPTS } from "@/content/prompts";
import { sessions } from "./ipc/mock-data";
import type { SessionDetail } from "./ipc/schemas";
import { currentStage, schedule, stagePrompt, STAGES, type ProgressionEvent } from "./scheduler";
import { buildTodayPlan } from "./today-plan";
import { TodayPlan } from "./ipc/schemas";

const unfamiliarPlain = PROMPTS.find((p) => STAGES[1].matches(p))!;
const familiar = PROMPTS.find((p) => STAGES[0].matches(p))!;
const base = structuredClone(sessions[0]) as SessionDetail;
const s = (id: string, day: string, extra: Partial<SessionDetail> = {}): SessionDetail => ({
  ...base, id, localDate: day, startedAt: `${day}T10:00:00.000Z`, exerciseType: "repeat", focus: null, ease: null,
  contentId: unfamiliarPlain.id, conditions: { ...base.conditions!, familiarity: "unfamiliar" }, ...extra,
});
const at2: ProgressionEvent[] = [{ kind: "advance", stageFrom: 1, stageTo: 2, reason: "", createdAt: "2026-10-01T00:00:00.000Z" }];

it("offers the next stage only after three unfamiliar sessions on two days that felt manageable (4.18)", () => {
  expect(currentStage([]).stage).toBe(1);
  expect(currentStage(at2).stage).toBe(2);
  const three = [s("c", "2026-10-05", { ease: 4 }), s("b", "2026-10-04"), s("a", "2026-10-04")];
  const offered = schedule({ recent: three, events: at2, prompts: PROMPTS });
  expect(offered.offer?.to.stage).toBe(3);
  expect(offered.offer?.reason).toMatch(/3 unfamiliar sessions at this stage on 2 days.*manageable \(4 of 5\)/);

  // One day only, or only two sessions: no offer yet.
  expect(schedule({ recent: three.map((x) => ({ ...x, localDate: "2026-10-05" })), events: at2, prompts: PROMPTS }).offer).toBeNull();
  expect(schedule({ recent: three.slice(0, 2), events: at2, prompts: PROMPTS }).offer).toBeNull();
  // Sessions from before the current stage started don't count.
  expect(schedule({ recent: three, events: [{ ...at2[0], createdAt: "2026-10-06T00:00:00.000Z" }], prompts: PROMPTS }).offer).toBeNull();
  // A missing rating is "not enough evidence", never a failure.
  const unrated = schedule({ recent: [s("c", "2026-10-05"), ...three.slice(1)], events: at2, prompts: PROMPTS });
  expect(unrated.offer).toBeNull();
  expect(unrated.suggestions[0].reason).toMatch(/missing rating is not a failure/);
  // A hard session pauses any offer.
  const hard = schedule({ recent: [s("c", "2026-10-05", { ease: 2 }), ...three.slice(1)], events: at2, prompts: PROMPTS });
  expect(hard.offer).toBeNull();
  expect(hard.suggestions[0].reason).toMatch(/felt hard \(2 of 5\)/);
});

it("carries your focus over, asks after three sessions with the same one, and suggests variety", () => {
  const same = ["c", "b", "a"].map((id, i) => s(id, `2026-10-0${5 - i}`, { focus: "Pause between ideas", contentId: familiar.id, ease: 3, conditions: { ...base.conditions!, familiarity: "familiar" } }));
  const plan = schedule({ recent: same, events: [], prompts: PROMPTS });
  expect(plan.focus).toEqual(expect.objectContaining({ text: "Pause between ideas", recurring: true }));
  expect(plan.suggestions.map((x) => x.text)).toEqual(["Try a different exercise today.", "Answer this week's new situation instead of the same prompt."]);
  expect(plan.offer?.reason).toMatch(/^3 sessions at this stage on 3 days/);
  const once = schedule({ recent: [s("c", "2026-10-05", { focus: "Lead with the point" })], events: [], prompts: PROMPTS });
  expect(once.focus).toEqual({ text: "Lead with the point", recurring: false, reason: "The focus you chose in your last session." });
  expect(schedule({ recent: [], events: [], prompts: PROMPTS }).focus).toBeNull();
});

it("puts the stage, its weekly task and the reasons into Today's plan", () => {
  const plan = schedule({ recent: [s("c", "2026-10-05", { focus: "Lead with the point" })], events: at2, prompts: PROMPTS });
  const today = buildTodayPlan({ localDate: "2026-10-09", length: "short", sessions: [], phrases: [], latest: null, plan, prompts: PROMPTS });
  expect(() => TodayPlan.parse(today)).not.toThrow();
  expect(today.focus).toBe("Lead with the point");
  expect(today.progression).toEqual(expect.objectContaining({ stage: 2, title: "Unfamiliar explanation", offer: null }));
  const weekly = PROMPTS.find((p) => p.id === today.weekly.newSituation.promptId)!;
  expect(STAGES[1].matches(weekly)).toBe(true);
  expect(today.weekly.newSituation.reason).toMatch(/at your stage, unfamiliar explanation/);
  expect(stagePrompt(STAGES[4], PROMPTS, 0)?.conditions.followUp).toBe(true);
  // Every stage has bundled prompts to practise with.
  for (const stage of STAGES) expect(stagePrompt(stage, PROMPTS, 0)).not.toBeNull();
});
