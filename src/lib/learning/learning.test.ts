import { describe, expect, it } from "vitest";
import { PAUSE_FOCUS, PROGRAMMES, weekFocus } from "@/content/programmes";
import { BASELINE_PROMPT, PROMPTS } from "@/content/prompts";
import { REPEAT_FOCUSES } from "@/features/practice/ExercisePanels";
import { addLocalDays } from "@/lib/phrase-schedule";
import { buildTodayPlan, PLAN_STEPS } from "@/lib/today-plan";
import { HARDER_DEMANDS, STAGES, harderPreparation, recentSuccess, stagePrompt, tuning } from "@/lib/scheduler";
import { PracticePrompt, type PracticeEvent, type ProgrammeRun } from "@/lib/ipc/schemas";
import { factsBuilder } from "@/test/fixtures/facts";
import { offending } from "@/test/no-scores";
import { confirmedFillerSpans, matchPresses } from "./catch-it";
import { shouldFoldMeasures } from "./feedback";
import { buildSprint, mixedSet, pickWarmUp, warmUpStep, weakestArea } from "./interleave";
import { hesitationBucket, paceBucket, selfAwareness } from "./predict";
import { canAdvance, detectStep, newlyDetected, nextStep, weekStatus } from "./programmes";
import { answeredAgo, dueReanswers } from "./reanswer";

const today = "2026-10-20";
const prompts = PROMPTS.map((p) => ({ id: p.id, text: p.text }));
const event = (kind: string, refId: string, localDate = today): PracticeEvent => ({ id: 1, kind, refId, localDate, sessionId: null, attemptId: null, xp: 0, backfilled: false, createdAt: `${localDate}T09:00:00.000Z` });
const promptId = PROMPTS.find((p) => p.id !== BASELINE_PROMPT.id)!.id;

describe("spaced re-answering (11.1)", () => {
  const answered = (...days: number[]) => {
    let b = factsBuilder(today);
    for (const d of days) b = b.onDay(d).session({ contentId: promptId }).take();
    return b.build();
  };

  it("schedules 1, 7 and 30 days after the first answer", () => {
    expect(dueReanswers(answered(0), [], today, prompts)).toEqual([]);
    expect(dueReanswers(answered(1), [], today, prompts).map((r) => [r.step, r.overdueDays])).toEqual([[1, 0]]);
    expect(dueReanswers(answered(9), [], today, prompts).map((r) => [r.step, r.dueDate, r.overdueDays])).toEqual([[7, addLocalDays(today, -2), 2]]);
    expect(dueReanswers(answered(40), [], today, prompts)[0].step).toBe(30);
    expect(answeredAgo({ firstDate: addLocalDays(today, -7) }, today)).toBe("you first answered 7 days ago");
  });

  it("counts a later answer on or after the due date as done", () => {
    expect(dueReanswers(answered(9, 2), [], today, prompts)).toEqual([], );
    // An answer before the step's date doesn't count for it.
    expect(dueReanswers(answered(9, 4), [], today, prompts).map((r) => r.step)).toEqual([7]);
  });

  it("never returns a skipped step", () => {
    const facts = answered(9);
    expect(dueReanswers(facts, [event("reanswer_skipped", `${promptId}:7`)], today, prompts)).toEqual([]);
    expect(dueReanswers(facts, [event("reanswer_skipped", `${promptId}:1`)], today, prompts).map((r) => r.step)).toEqual([7]);
  });

  it("ignores the baseline, drill sessions and prompts not in the pack", () => {
    const facts = factsBuilder(today)
      .onDay(9).session({ contentId: BASELINE_PROMPT.id, tags: ["baseline"] }).take()
      .session({ contentId: promptId, exerciseType: "jam", activity: { version: 1, seed: "s", params: {} } }).take()
      .session({ contentId: "p-not-a-prompt" }).take()
      .build();
    expect(dueReanswers(facts, [], today, prompts)).toEqual([]);
  });

  it("orders the most overdue first and starts from your first answer", () => {
    const other = PROMPTS.filter((p) => p.id !== BASELINE_PROMPT.id)[1].id;
    const facts = factsBuilder(today).onDay(12).session({ contentId: other }).take().onDay(8).session({ contentId: promptId }).take().build();
    const due = dueReanswers(facts, [], today, prompts);
    expect(due.map((r) => r.promptId)).toEqual([other, promptId]);
    expect(due[0].firstAttemptId).toBe(facts.takes[0].id);
  });
});

describe("feedback timing (11.4)", () => {
  it("folds only in the two optional modes", () => {
    expect(shouldFoldMeasures("always", { takesWithFocus: 50, fluencyLevel: 5 })).toBe(false);
    expect(shouldFoldMeasures("on_request", { takesWithFocus: 0, fluencyLevel: 0 })).toBe(true);
  });

  it("fades after five takes with the same focus and from Fluency 3", () => {
    expect(shouldFoldMeasures("fade", { takesWithFocus: 5, fluencyLevel: 4 })).toBe(false);
    expect(shouldFoldMeasures("fade", { takesWithFocus: 6, fluencyLevel: 2 })).toBe(false);
    expect(shouldFoldMeasures("fade", { takesWithFocus: 6, fluencyLevel: 3 })).toBe(true);
  });
});

describe("predict, then check (11.5)", () => {
  it("puts values into the same buckets as the guesses", () => {
    expect([0, 1, 2, 4, 5, 9].map(hesitationBucket)).toEqual(["0-1", "0-1", "2-4", "2-4", "5+", "5+"]);
    expect([92, 94, 100, 107, 108].map((p) => paceBucket(p, 100))).toEqual(["slower", "usual", "usual", "usual", "faster"]);
  });

  it("counts matches over the last ten predictions, with a grid and no percentage", () => {
    let b = factsBuilder(today).session();
    for (let i = 0; i < 12; i += 1) b = b.take({ transcribed: true, fillerCandidates: i % 3 === 0 ? 1 : 3, predictions: { hesitations: "2-4" } });
    const s = selfAwareness(b.build());
    // The last ten are takes 3 to 12: three had one candidate, seven had three.
    expect([s.matched, s.compared]).toEqual([7, 10]);
    expect(s.grid["2-4"]).toEqual({ "0-1": 3, "2-4": 7, "5+": 0 });
  });
});

describe("Catch it (11.6)", () => {
  it("matches each press to at most one filler inside its segment", () => {
    const fillers = [{ startMs: 1_000, endMs: 3_000 }, { startMs: 1_000, endMs: 3_000 }, { startMs: 8_000, endMs: 9_000 }];
    const r = matchPresses([1_500, 2_000, 2_500, 12_000], fillers);
    expect([r.caught, r.total, r.extra]).toEqual([2, 3, 2]);
    expect(r.matched).toEqual([0, 1, null]);
  });

  it("reports caught of total from confirmed fillers only", () => {
    const spans = confirmedFillerSpans(
      [{ segment: 0, decision: "confirmed" }, { segment: 1, decision: "dismissed" }, { segment: 2, decision: null }, { segment: 2, decision: "confirmed" }],
      [{ startMs: 0, endMs: 2_000 }, { startMs: 2_000, endMs: 4_000 }, { startMs: 4_000, endMs: 6_000 }],
    );
    expect(spans).toEqual([{ startMs: 0, endMs: 2_000 }, { startMs: 4_000, endMs: 6_000 }]);
    expect(matchPresses([], spans)).toMatchObject({ caught: 0, total: 2 });
  });
});

describe("the filler programme (11.6)", () => {
  const def = PROGRAMMES[0];
  const run = (week: number, started: string, steps: string[] = []): ProgrammeRun => ({
    id: "prog-1", programme: def.id, week, startedAt: `${started}T08:00:00.000Z`, weekStartedAt: `${started}T08:00:00.000Z`, weekStartedDate: started,
    completedAt: null, stoppedAt: null, steps: steps.map((stepId) => ({ stepId, refId: null, doneAt: `${started}T09:00:00.000Z` })),
  });

  it("has four weeks of three steps, plain words and the Studio's pause focus", () => {
    expect(def.weeks.map((w) => [w.week, w.steps.length])).toEqual([[1, 3], [2, 3], [3, 3], [4, 3]]);
    expect(REPEAT_FOCUSES).toContain(PAUSE_FOCUS);
    for (const w of def.weeks) for (const s of w.steps) expect([...offending(s.title), ...offending(s.how)]).toEqual([]);
    expect(weekFocus(run(1, today))).toBeNull();
    expect(weekFocus(run(2, today))?.text).toBe(PAUSE_FOCUS);
  });

  it("detects automatic steps from facts since the week started", () => {
    const started = addLocalDays(today, -3);
    const facts = factsBuilder(today)
      .onDay(5).session().take({ catchRuns: [{ caught: 2, total: 3, localDate: addLocalDays(today, -5) }] })
      .onDay(2).session().take({ catchRuns: [{ caught: 3, total: 3, localDate: addLocalDays(today, -2) }] }).take({ catchRuns: [{ caught: 1, total: 4, localDate: addLocalDays(today, -1) }] })
      .build();
    const events = [event("transcript_reviewed", "r1", addLocalDays(today, -4)), event("transcript_reviewed", "r2", addLocalDays(today, -2)), event("transcript_reviewed", "r3", today), event("transcript_reviewed", "r4", today)];
    expect(detectStep({ kind: "catch", atLeast: 3 }, facts, events, started)).toEqual({ done: 2, needed: 3 });
    expect(detectStep({ kind: "reviewed", atLeast: 3 }, facts, events, started)).toEqual({ done: 3, needed: 3 });
    const status = weekStatus(def, run(1, started, ["w1-note"]), facts, events);
    expect(status.map((s) => [s.step.id, s.met, s.auto])).toEqual([["w1-catch-3", false, true], ["w1-review-3", true, true], ["w1-note", true, false]]);
    expect(newlyDetected(def, run(1, started, ["w1-note"]), facts, events)).toEqual(["w1-review-3"]);
    expect(nextStep(def, run(1, started, ["w1-note"]), facts, events)?.step.id).toBe("w1-catch-3");
    // Week 2: three different sessions with the pause focus, a minute or more each.
    const pausing = factsBuilder(today)
      .session({ focus: PAUSE_FOCUS, familiarity: "familiar" }).take({ speechSpanMs: 61_000 }).take({ speechSpanMs: 62_000 })
      .session({ focus: PAUSE_FOCUS, familiarity: "familiar" }).take({ speechSpanMs: 40_000 })
      .session({ focus: PAUSE_FOCUS, familiarity: "familiar" }).take({ speechSpanMs: 70_000 })
      .build();
    expect(detectStep(def.weeks[1].steps[0].detect!, pausing, [], started)).toEqual({ done: 2, needed: 3 });
  });

  it("advances after three steps or seven days and never fails", () => {
    const facts = factsBuilder(today).build();
    expect(canAdvance(def, run(1, addLocalDays(today, -2)), facts, [], today).ready).toBe(false);
    expect(canAdvance(def, run(1, addLocalDays(today, -2), ["w1-catch-3", "w1-review-3", "w1-note"]), facts, [], today)).toEqual({ ready: true, reason: "You've done 3 steps this week." });
    expect(canAdvance(def, run(1, addLocalDays(today, -7)), facts, [], today).ready).toBe(true);
    const text = [def.title, def.summary, ...def.weeks.map((w) => w.theme)].join(" ");
    expect(text).not.toMatch(/fail|missed|behind/i);
  });
});

describe("the challenge dial (11.2)", () => {
  const sessions = (manageable: number, hard: number) =>
    [...Array(manageable).fill(4), ...Array(hard).fill(2)].map((ease, i) => ({ ease, startedAt: `2026-10-${String(10 + i).padStart(2, "0")}T08:00:00.000Z` }));

  it("suggests one harder demand after nine manageable sessions of ten", () => {
    expect(recentSuccess([...sessions(9, 1), { ease: null, startedAt: "2026-10-30T08:00:00.000Z" }])).toEqual({ manageable: 9, rated: 10 });
    const s = tuning(sessions(9, 1), STAGES[0], 0)!;
    expect(s.text).toBe("Try one harder demand today: less preparation time.");
    expect(s.reason).toContain("(9 of 10)");
    expect(tuning(sessions(9, 1), STAGES[0], -1)).toBeNull();
    expect(tuning(sessions(5, 0), STAGES[0], 0)).toBeNull();
  });

  it("suggests keeping or easing after four hard sessions of ten", () => {
    const s = tuning(sessions(6, 4), STAGES[1], 1)!;
    expect(s.text).toBe("Keep the same demand, or choose Easier.");
    expect(s.reason).toContain("(4 of 10)");
    expect(tuning(sessions(8, 2), STAGES[1], 0)).toBeNull();
  });

  it("raises demands in the documented order and never asks for faster speech", () => {
    expect(HARDER_DEMANDS).toEqual(["less preparation time", "a topic you haven't practised", "a named listener", "a longer answer", "a follow-up question"]);
    expect(STAGES.map((stage) => tuning(sessions(10, 0), stage, 0)!.text)).toEqual([
      "Try one harder demand today: less preparation time.",
      "Try one harder demand today: a named listener.",
      "Try one harder demand today: a longer answer.",
      "Try one harder demand today: a follow-up question.",
      "Try one harder demand today: less preparation time.",
    ]);
    expect(HARDER_DEMANDS.join(" ")).not.toMatch(/fast|speed|quick/i);
  });

  it("Harder halves preparation in the chosen prompt; Easier picks familiar prompts with time to prepare", () => {
    const all = PROMPTS.map((p) => PracticePrompt.parse(p));
    const harder = stagePrompt(STAGES[0], all, 3, 1)!;
    const original = all.find((p) => p.id === harder.id)!;
    expect(harder.conditions.preparationSeconds).toBe(harderPreparation(original.conditions.preparationSeconds));
    const easier = stagePrompt(STAGES[2], all, 3, -1)!;
    expect([easier.conditions.familiarity, easier.conditions.preparationSeconds >= 30]).toEqual(["familiar", true]);
    expect(harderPreparation(0)).toBe(0);
  });
});

describe("interleaving and the sprint (11.3, 11.8)", () => {
  const activity = { structure: 3, fluency: 2, voice: 0, spontaneity: 4, vocabulary: 1, listening: 5, storytelling: 2, courage: 1 };

  it("adds a warm-up drill only when enabled", () => {
    const base = { localDate: today, length: "standard" as const, sessions: [], phrases: [], latest: null };
    expect(buildTodayPlan(base).steps).toEqual(PLAN_STEPS.standard);
    const warm = warmUpStep(pickWarmUp(factsBuilder(today).build(), activity, today));
    const steps = buildTodayPlan({ ...base, warmUp: warm }).steps;
    expect(steps).toHaveLength(PLAN_STEPS.standard.length + 1);
    expect(steps[0]).toMatchObject({ minutes: 2, drillId: warm.drillId });
  });

  it("prefers the least-practised area for the warm-up, and a drill not played lately", () => {
    expect(pickWarmUp(factsBuilder(today).build(), activity, today).areas).toContain("voice");
    const played = factsBuilder(today).onDay(2).session({ exerciseType: "emphasis", activity: { version: 1, seed: "s", params: {} } }).take({ durationMs: 3_000 })
      .session({ exerciseType: "pace_ladder", activity: { version: 1, seed: "s", params: {} } }).take().build();
    expect(pickWarmUp(played, activity, today).id).not.toMatch(/emphasis|pace-ladder/);
    expect(pickWarmUp(played, activity, today)).toEqual(pickWarmUp(played, activity, today));
  });

  it("walks a mixed set of three different short drills", () => {
    const set = mixedSet(today);
    expect(set).toHaveLength(3);
    expect(new Set(set.map((s) => s.drillId)).size).toBe(3);
    expect(mixedSet(today)).toEqual(set);
  });

  it("picks the lowest level, then the least practised", () => {
    const areas = (["structure", "fluency", "voice", "spontaneity", "vocabulary", "listening", "storytelling", "courage"] as const).map((area) => ({ area, current: (area === "fluency" || area === "voice" ? 1 : 2) as 1 | 2 }));
    expect(weakestArea(areas, activity)).toBe("voice");
    expect(weakestArea(areas.map((a) => ({ ...a, current: 3 as const })), { ...activity, courage: 0 })).toBe("voice");
  });

  it("builds two or three steps for the next level", () => {
    for (const area of ["structure", "fluency", "voice", "spontaneity", "vocabulary", "listening", "storytelling", "courage"] as const) {
      for (const current of [0, 1, 2, 3, 4, 5]) {
        const sprint = buildSprint(area, current);
        expect(sprint.length, `${area} ${current}`).toBeGreaterThanOrEqual(2);
        expect(sprint.length, `${area} ${current}`).toBeLessThanOrEqual(3);
        for (const step of sprint) expect(!!step.drillId || !!step.to?.startsWith("/practice/"), area).toBe(true);
      }
    }
  });
});
