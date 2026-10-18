import criteriaSource from "./criteria.ts?raw";
import { describe, expect, it } from "vitest";
import { factsBuilder } from "@/test/fixtures/facts";
import type { PracticeFacts } from "@/lib/ipc/schemas";
import { computeBaselines, metricOf, progressOf, type Criterion, type EvalContext, type TakeFilter } from "./criteria";
import { evaluateAreas } from "./evaluate";

const ctx = (facts: PracticeFacts, promptTags: EvalContext["promptTags"] = {}): EvalContext => ({ today: facts.today, baselines: computeBaselines(facts), promptTags });
const takes = (filter: TakeFilter, atLeast = 1, distinctDays?: number): Criterion => ({ kind: "takes", label: "t", filter, atLeast, distinctDays });
const run = (c: Criterion, facts: PracticeFacts, tags: EvalContext["promptTags"] = {}) => progressOf(c, facts, ctx(facts, tags));

describe("criteria DSL (9.2)", () => {
  it("counts takes that match every filter field", () => {
    // Each row: a filter, a take that matches, and one that doesn't.
    const cases: [string, TakeFilter, Parameters<ReturnType<typeof factsBuilder>["session"]>[0], Parameters<ReturnType<typeof factsBuilder>["take"]>[0], Parameters<ReturnType<typeof factsBuilder>["session"]>[0], Parameters<ReturnType<typeof factsBuilder>["take"]>[0]][] = [
      ["exercise", { exercise: ["imitate"] }, { exerciseType: "imitate" }, {}, { exerciseType: "repeat" }, {}],
      ["stepKey", { stepKey: ["slow"] }, {}, { stepKey: "slow" }, {}, { stepKey: "fast" }],
      ["familiarity", { familiarity: "unfamiliar" }, { familiarity: "unfamiliar" }, {}, { familiarity: "familiar" }, {}],
      ["maxPrepSeconds", { maxPrepSeconds: 10 }, { preparationSeconds: 10 }, {}, { preparationSeconds: 15 }, {}],
      ["minSpeechMs", { minSpeechMs: 60_000 }, {}, { speechSpanMs: 61_000 }, {}, { speechSpanMs: 59_000 }],
      ["audience", { audience: true }, { audience: true }, {}, { audience: false }, {}],
      ["followUp", { followUp: true }, { followUp: true }, {}, { followUp: false }, {}],
      ["tags", { tags: ["baseline"] }, { tags: ["baseline"] }, {}, { tags: [] }, {}],
      ["promptTags", { promptTags: ["storytelling"] }, { contentId: "p-story" }, {}, { contentId: "p-habit" }, {}],
      ["noOutline", { noOutline: true }, { outline: [false, false, false] }, {}, { outline: [true, false, false] }, {}],
      ["transcribed", { transcribed: true }, {}, { transcribed: true }, {}, { transcribed: false }],
      ["fillersReviewed", { fillersReviewed: true }, {}, { fillersReviewed: true }, {}, { fillersReviewed: false }],
      ["prosodyViewed", { prosodyViewed: true }, {}, { prosodyViewed: true }, {}, { prosodyViewed: false }],
      ["check", { check: { id: "clear_ending", value: true } }, {}, { checks: { clear_ending: true } }, {}, { checks: { clear_ending: false } }],
      ["metric", { metric: { key: "longestRun", op: ">=", value: 15 } }, {}, { longestRun: 15 }, {}, { longestRun: 14 }],
      ["firstTakeOnly", { firstTakeOnly: true }, {}, {}, {}, {}],
    ];
    for (const [name, filter, matchSession, matchTake, missSession, missTake] of cases) {
      const b = factsBuilder().session(matchSession).take(matchTake).session(missSession).take(missTake);
      if (name === "firstTakeOnly") b.take(); // the second session's second take is not a first take
      const facts = b.build();
      const expected = name === "firstTakeOnly" ? 2 : 1;
      expect(run(takes(filter, 5), facts, { "p-story": ["storytelling"], "p-habit": ["daily_life"] }).done, name).toBe(expected);
    }
  });

  it("requires distinct days separately from the count", () => {
    const facts = factsBuilder().onDay(1).session().take().take().take().build();
    const p = run(takes({}, 3, 2), facts);
    expect([p.done, p.needed, p.days?.done, p.days?.needed, p.met]).toEqual([3, 3, 1, 2, false]);
    const spread = factsBuilder().onDay(2).session().take().onDay(1).session().take().take().build();
    expect(run(takes({}, 3, 2), spread).met).toBe(true);
  });

  it("never passes a metric criterion on a missing value", () => {
    const facts = factsBuilder().session().take({ midClausePauses: null, transcribed: true }).take({ midClausePauses: 0, transcribed: true }).build();
    expect(run(takes({ metric: { key: "midClausePauses", op: "<=", value: 1 } }, 2), facts).done).toBe(1);
    // A derived value is missing under 20 words or when not fully reviewed.
    const take = factsBuilder().session().take({ fillersReviewed: true, fillersConfirmed: 1, words: 19 }).build().takes[0];
    expect(metricOf(take, "confirmedPer100")).toBeNull();
    expect(metricOf({ ...take, words: 50 }, "confirmedPer100")).toBe(2);
    expect(metricOf({ ...take, words: 50, fillersReviewed: false }, "confirmedPer100")).toBeNull();
  });

  it("asks for five reviewed takes before a baseline criterion can progress", () => {
    const fluency2: Criterion = takes({ fillersReviewed: true, metric: { key: "confirmedPer100", op: "<=", value: { baseline: "first5ReviewedMedian", factor: 0.7 } } }, 3);
    let b = factsBuilder().session();
    for (let i = 0; i < 4; i += 1) b = b.take({ transcribed: true, fillersReviewed: true, words: 100, fillersConfirmed: 5 });
    const early = run(fluency2, b.build());
    expect(early.unavailable).toEqual({ reason: "Review 5 takes to set your starting point", fix: "review" });
    expect(early.done).toBe(4);
    b = b.take({ transcribed: true, fillersReviewed: true, words: 100, fillersConfirmed: 5 }).take({ transcribed: true, fillersReviewed: true, words: 100, fillersConfirmed: 3 });
    const later = run(fluency2, b.build());
    expect([later.unavailable, later.done]).toEqual([null, 1]);
    // A starting point of zero is met only by none at all.
    let zero = factsBuilder().session();
    for (let i = 0; i < 5; i += 1) zero = zero.take({ transcribed: true, fillersReviewed: true, words: 100, fillersConfirmed: 0 });
    expect(run(fluency2, zero.build()).done).toBe(3);
  });

  it("anyOf shows the available option you are furthest along and is met by any", () => {
    const any: Criterion = { kind: "anyOf", label: "either", options: [
      { kind: "activity", label: "a later format", type: "upgrade", atLeast: 1 },
      { kind: "sessions", label: "3 sessions", filter: {}, atLeast: 3 },
      { kind: "transfers", label: "1 reflection", atLeast: 1 },
    ] };
    const facts = factsBuilder().session().take().build();
    const p = run(any, facts);
    expect([p.label, p.done, p.needed, p.met, p.unavailable]).toEqual(["either", 1, 3, false, null]);
    expect(run(any, factsBuilder().session().take().transfer().build()).met).toBe(true);
  });

  it("reports unavailable criteria with the feature that brings them", () => {
    const facts = factsBuilder().build();
    expect(run({ kind: "activity", label: "talk", type: "rehearsal", atLeast: 1 }, facts).unavailable?.fix).toBe("events");
    expect(run({ kind: "activity", label: "jam", type: "jam", atLeast: 1 }, facts).unavailable).toBeNull();
    // The conversation partner (M13) is here.
    expect(run({ kind: "activity", label: "upgrade", type: "upgrade", atLeast: 1 }, facts).unavailable).toBeNull();
    expect(run({ kind: "conversation", label: "talk", minTurns: 5, atLeast: 1 }, facts).unavailable).toBeNull();
    expect(run({ kind: "debrief", label: "event", atLeast: 1 }, facts).unavailable?.fix).toBe("events");
    const noTranscription = { ...factsBuilder().session().take().build(), transcriptionAvailable: false };
    expect(run(takes({ transcribed: true, fillersReviewed: true }, 3), noTranscription).unavailable).toEqual({ reason: "Needs local transcription", fix: "transcription" });
  });

  it("counts conversations you ended, with enough answers and pressure (M13)", () => {
    const facts = factsBuilder()
      .onDay(3).conversation({ learnerTurns: 6, pressure: 2 })
      .onDay(2).conversation({ learnerTurns: 4, pressure: 3 })
      .onDay(1).conversation({ learnerTurns: 8, pressure: 3, endedAt: null })
      .build();
    const six = run({ kind: "conversation", label: "6 turns", minTurns: 6, atLeast: 1 }, facts);
    expect([six.done, six.met, six.evidence.map((e) => [e.kind, e.id])]).toEqual([1, true, [["conversation", "conversation-1"]]]);
    expect(run({ kind: "conversation", label: "pressured", minTurns: 6, minPressure: 3, atLeast: 1 }, facts).met).toBe(false);
    expect(run({ kind: "conversation", label: "any", minTurns: 3, atLeast: 3 }, facts).done).toBe(2);
  });

  it("counts upgrade loops by their retell take (M13)", () => {
    const facts = factsBuilder()
      .session({ exerciseType: "upgrade" }).take({ stepKey: "shadow" }).take({ stepKey: "retell" })
      .session({ exerciseType: "upgrade" }).take({ stepKey: "shadow" })
      .build();
    const loops = run({ kind: "activity", label: "3 upgrade loops", type: "upgrade", atLeast: 3 }, facts);
    expect([loops.done, loops.needed, loops.evidence.map((e) => e.id)]).toEqual([1, 3, ["session-1"]]);
  });

  it("counts ladder steps you did, including deleted ones, and the ones you rated high beforehand (M12)", () => {
    const attempt = (localDate: string, before: number | null, after: number | null, outcome: "yes" | "partly" | "planned" | "not_this_time") =>
      ({ localDate, before, after, outcome, done: outcome === "yes" || outcome === "partly" });
    const facts = {
      ...factsBuilder().build(),
      exposure: [
        { stepId: "step-a", position: 1, deleted: false, attempts: [attempt("2026-10-09", 4, 3, "not_this_time"), attempt("2026-10-10", 7, 3, "yes")] },
        { stepId: "step-b", position: 2, deleted: true, attempts: [attempt("2026-10-11", 4, 2, "partly")] },
        { stepId: "step-c", position: 3, deleted: false, attempts: [attempt("2026-10-12", 8, null, "planned")] },
      ],
    };
    expect(run({ kind: "exposure", label: "ladder", steps: 3 }, factsBuilder().build())).toMatchObject({ done: 0, needed: 3, met: false, unavailable: null });
    const ladder = run({ kind: "exposure", label: "ladder", steps: 3 }, facts);
    expect([ladder.done, ladder.met]).toEqual([2, false]);
    expect(ladder.evidence).toEqual([{ kind: "exposure", id: "step-a", date: "2026-10-10" }, { kind: "exposure", id: "step-b", date: "2026-10-11" }]);
    expect(run({ kind: "exposure", label: "stretch", steps: 1, minBefore: 6 }, facts)).toMatchObject({ done: 1, met: true });
  });

  it("never reads AI feedback", () => {
    // Every take has AI feedback and nothing else: no level moves (A-29).
    let b = factsBuilder();
    for (let i = 0; i < 10; i += 1) b = b.session({ outline: [false, false, false] }).take({ hasAiFeedback: true });
    const facts = b.build();
    const areas = evaluateAreas(facts, [], ctx(facts));
    const reachedOrReady = areas.flatMap((a) => a.levels).filter((l) => l.state === "ready" || l.state === "reached");
    expect(reachedOrReady).toEqual([]);
    expect(criteriaSource).not.toMatch(/hasAiFeedback/);
    // Nor does any other part of the engine: levels, achievements, records and quests.
    const engine = import.meta.glob(["./*.ts", "!./*.test.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    expect(Object.keys(engine).length).toBeGreaterThan(10);
    expect(Object.entries(engine).filter(([, src]) => /hasAiFeedback|aiFeedback|coaching/i.test(src)).map(([f]) => f)).toEqual([]);
  });
});
