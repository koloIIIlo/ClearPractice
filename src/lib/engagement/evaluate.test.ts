import { describe, expect, it } from "vitest";
import { factsBuilder } from "@/test/fixtures/facts";
import { EngagementState, PracticeFacts, type PracticeEvent } from "@/lib/ipc/schemas";
import { computeBaselines, type EvalContext } from "./criteria";
import { evaluate, evaluateAreas, isEmptyDiff, nearestNext, newLevels } from "./evaluate";

const ctx = (facts: PracticeFacts): EvalContext => ({ today: facts.today, baselines: computeBaselines(facts), promptTags: { "p-story": ["storytelling"] } });
const empty: EngagementState = { levels: [], achievements: [], records: [], quests: [], goalWeeks: [] };
const event = (kind: string, localDate: string, id: number): PracticeEvent => ({ id, kind, refId: `${kind}-${id}`, localDate, sessionId: null, attemptId: null, xp: 10, backfilled: false, createdAt: `${localDate}T08:00:00.000Z` });

describe("levels engine (9.2)", () => {
  it("earns levels in order and marks a met higher level as ready", () => {
    // Spontaneity 1 and 2 met at once (three unfamiliar sessions, 30 s preparation, two days).
    const facts = factsBuilder()
      .onDay(2).session({ familiarity: "unfamiliar", preparationSeconds: 30 }).take()
      .onDay(1).session({ familiarity: "unfamiliar", preparationSeconds: 10 }).take().session({ familiarity: "unfamiliar", preparationSeconds: 0 }).take()
      .build();
    const spontaneity = evaluateAreas(facts, [], ctx(facts)).find((a) => a.area === "spontaneity")!;
    expect(spontaneity.levels.map((l) => l.state).slice(0, 3)).toEqual(["ready", "ready", "in_progress"]);
    expect(spontaneity.current).toBe(0);
    const recorded = newLevels([spontaneity]);
    expect(recorded.map((l) => l.level)).toEqual([1, 2]);
    expect(recorded[0].evidence).toEqual({ criteria: [expect.arrayContaining(["session-1"])] });
    // With level 1 stored, the next one to record is 2.
    const after = evaluateAreas(facts, [{ area: "spontaneity", level: 1, achievedAt: "2026-10-12T08:00:00.000Z" }], ctx(facts)).find((a) => a.area === "spontaneity")!;
    expect([after.current, after.next?.level, newLevels([after]).map((l) => l.level)]).toEqual([1, 2, [2]]);
  });

  it("keeps stored levels even when their sessions are gone", () => {
    const facts = factsBuilder().build();
    const stored = [1, 2, 3].map((level) => ({ area: "courage", level, achievedAt: "2026-10-01T08:00:00.000Z" }));
    const courage = evaluateAreas(facts, stored, ctx(facts)).find((a) => a.area === "courage")!;
    expect(courage.current).toBe(3);
    expect(courage.levels.slice(0, 3).map((l) => [l.state, l.reachedAt])).toEqual(Array(3).fill(["reached", "2026-10-01T08:00:00.000Z"]));
    expect(newLevels([courage])).toEqual([]);
  });

  it("records the weekly goal once and completed quests", () => {
    const facts = factsBuilder("2026-10-14").onDay(2).session().take().onDay(1).session().take().onDay(0).transfer().build();
    const events = [event("take_saved", "2026-10-12", 1), event("take_saved", "2026-10-13", 2), event("transfer_review", "2026-10-14", 3)];
    const state: EngagementState = { ...empty, quests: [{ week: "2026-10-12", slot: 2, quest: "real-1", params: {}, swapped: false, createdAt: "x", completedAt: null }] };
    const diff = evaluate(facts, events, state, { weeklyGoalDays: 3, weekStartsOn: "monday" }, ctx(facts));
    expect(diff.weeklyGoal).toBe("2026-10-12");
    expect(diff.questsDone).toEqual([{ week: "2026-10-12", slot: 2 }]);
    expect(diff.achievements.map((a) => a.id)).toEqual(expect.arrayContaining(["first-take", "first-reflection"]));
    const again = evaluate(facts, events, { ...state, goalWeeks: ["2026-10-12"], quests: [{ ...state.quests[0], completedAt: "y" }], achievements: diff.achievements.map((a) => ({ id: a.id, definitionVersion: 1, evidence: {}, unlockedAt: "z" })), levels: diff.levels.map((l) => ({ ...l, achievedAt: "z" })), records: diff.records.map((r, i) => ({ ...r, id: i, previous: null, achievedAt: "z" })) }, { weeklyGoalDays: 3, weekStartsOn: "monday" }, ctx(facts));
    expect(isEmptyDiff(again)).toBe(true);
  });

  it("finds the nearest next level", () => {
    const facts = factsBuilder().session({ outline: [true, false, false] }).take().session({ outline: [true, false, false] }).take().build();
    const next = nearestNext(evaluateAreas(facts, [], ctx(facts)));
    expect([next?.area, next?.level.level]).toEqual(["structure", 1]);
  });

  it("matches the golden journey for the sample history", async () => {
    // Stored files; regenerate deliberately with UPDATE_GOLDEN=1 (or when they don't exist yet).
    const golden = import.meta.glob<unknown>("./__golden__/*.json", { eager: true, import: "default" });
    const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
    const update = !!env.UPDATE_GOLDEN || !golden["./__golden__/sample-history.json"];
    const write = async (name: string, value: unknown) => {
      const fs = (await import(/* @vite-ignore */ "node:fs" as string)) as { mkdirSync(p: string, o: object): void; writeFileSync(p: string, d: string): void };
      fs.mkdirSync("src/lib/engagement/__golden__", { recursive: true });
      fs.writeFileSync(`src/lib/engagement/__golden__/${name}`, `${JSON.stringify(value, null, 1)}
`);
    };
    let history = golden["./__golden__/sample-history.json"];
    if (update) {
      let b = factsBuilder("2026-10-12");
      for (let day = 20; day >= 1; day -= 1) {
        b = b.onDay(day).session({ familiarity: day % 3 === 0 ? "unfamiliar" : "familiar", outline: [day % 2 === 0, day % 4 === 0, day % 4 === 0], preparationSeconds: day % 3 === 0 ? 10 : 30,
          exerciseType: day % 5 === 0 ? "imitate" : "repeat", contentId: day % 7 === 0 ? "p-story" : null, followUp: day % 6 === 0 });
        b = b.take({ transcribed: true, fillersReviewed: day % 2 === 0, words: 120, fillersConfirmed: day % 4, speechSpanMs: 62_000, midClausePauses: day % 3, longestRun: 8 + (day % 9),
          checks: day % 3 === 0 ? { point_first: true, clear_ending: true } : {}, prosodyViewed: day % 4 === 0, phraseIds: day % 5 === 0 ? ["phrase-x"] : [] });
        if (day % 2 === 0) b = b.take({ transcribed: true });
        if (day % 4 === 0) b = b.transfer({ hasListenerWords: true, flow: "smooth", tags: ["story"] });
        if (day % 3 === 0) b = b.phrase().phraseReview();
      }
      history = b.build();
      await write("sample-history.json", history);
    }
    const facts = PracticeFacts.parse(history);
    const summary = evaluateAreas(facts, [], ctx(facts)).map((a) => ({ area: a.area, states: a.levels.map((l) => l.state), progress: a.levels.map((l) => l.criteria.map((c) => `${c.done}/${c.needed}`).join(" ")) }));
    if (update) await write("expected-areas.json", summary);
    expect(summary).toEqual(update ? summary : golden["./__golden__/expected-areas.json"]);
  });
});
