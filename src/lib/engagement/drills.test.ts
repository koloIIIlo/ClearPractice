import { describe, expect, it } from "vitest";
import type { FactSession, PracticeFacts } from "@/lib/ipc/schemas";
import { factsBuilder } from "@/test/fixtures/facts";
import { ACHIEVEMENTS, achievementProgress } from "./achievements";
import { computeBaselines, progressOf, type Criterion } from "./criteria";
import { drillPlays, drillTypesPlayed, ladder, sessionResult } from "./drills";
import { evaluateAreas } from "./evaluate";
import { questProgress, QUEST_TEMPLATES } from "./quests";
import { newRecords } from "./records";
import { recommendation } from "./unlocks";

const ctx = (facts: PracticeFacts) => ({ today: facts.today, baselines: computeBaselines(facts), promptTags: {} });
const activity = (params: FactSession["activity"] extends infer A ? (A extends { params: infer P } ? P : never) : never = {}) => ({ version: 1, seed: "s", params });
const state = { levels: [], achievements: [], records: [], quests: [], goalWeeks: [] };
const input = (facts: PracticeFacts) => ({ facts, state, events: [], ctx: ctx(facts), areas: evaluateAreas(facts, [], ctx(facts)), prefs: { weekStartsOn: "monday" as const, weeklyGoalDays: 3 } });
const unlocked = (facts: PracticeFacts, id: string) => achievementProgress(ACHIEVEMENTS.find((a) => a.id === id)!, input(facts)).met;

describe("drills in the game layer (M10)", () => {
  it("counts takes of 10 seconds or more as rounds of single-round drills", () => {
    const facts = factsBuilder()
      .session({ exerciseType: "jam", activity: activity() }).take({ durationMs: 61_000, result: { cleanSeconds: 47 } }).take({ durationMs: 4_000, result: { cleanSeconds: 3 } })
      .session({ exerciseType: "jam", activity: activity() }).take({ durationMs: 60_000, result: { cleanSeconds: 52 } })
      .build();
    expect(drillPlays(facts, "jam").map((p) => p.result.cleanSeconds)).toEqual([47, 52]);
    const twice: Criterion = { kind: "activity", label: "45 clean seconds, twice", type: "jam", result: { key: "cleanSeconds", op: ">=", value: 45 }, atLeast: 2 };
    const p = progressOf(twice, facts, ctx(facts));
    expect([p.done, p.met, p.evidence.map((e) => e.kind)]).toEqual([2, true, ["take", "take"]]);
  });

  it("combines session drills from the latest take of each step", () => {
    const rate = (stepKey: string, rateSps: number) => ({ stepKey, durationMs: 30_000, result: { rateSps } });
    const facts = factsBuilder()
      .session({ exerciseType: "pace_ladder", activity: activity() }).take(rate("slow", 3.1)).take(rate("natural", 3.3)).take(rate("fast", 5.0)).take(rate("natural", 4.0))
      .build();
    const [play] = drillPlays(facts, "pace_ladder");
    expect(play.result).toEqual({ rounds: 3, range: 1.9, distinctSpeeds: 3 });
    expect(ladder([4, 4.2, 5])).toEqual({ range: 1, distinct: false });
    expect(ladder([4, null, 5]).range).toBeNull();
  });

  it("counts emphasis hits, gauntlet rounds and a finished boss", () => {
    const facts = factsBuilder()
      .session({ exerciseType: "emphasis", activity: activity() })
      .take({ stepKey: "s1", durationMs: 3_000, result: { hit: 1, aligned: 1 } }).take({ stepKey: "s2", durationMs: 3_000, result: { hit: 0, aligned: 1 } }).take({ stepKey: "s3", durationMs: 3_000, result: { hit: 1, aligned: 1 } })
      .session({ exerciseType: "gauntlet", activity: activity() })
      .take({ stepKey: "familiar", durationMs: 30_000 }).take({ stepKey: "unfamiliar", durationMs: 8_000 }).take({ stepKey: "listener", durationMs: 60_000 })
      .session({ exerciseType: "boss", activity: activity({ boss: "meeting" }) }).take({ stepKey: "update", durationMs: 40_000 }).take({ stepKey: "answer-1", durationMs: 30_000 })
      .build();
    expect(drillPlays(facts, "emphasis")[0].result).toMatchObject({ estimatedHits: 2, rounds: 3 });
    expect(drillPlays(facts, "gauntlet")[0].result).toMatchObject({ roundsCompleted: 2, rounds: 3 });
    expect(drillPlays(facts, "boss")[0].result.finished).toBe(1);
    const unfinished = factsBuilder().session({ exerciseType: "boss", activity: activity({ boss: "job-interview" }) }).take({ stepKey: "about" }).build();
    expect(sessionResult("boss", unfinished.sessions[0], unfinished.takes).finished).toBe(0);
    expect(unlocked(facts, "boss-meeting")).toBe(true);
    expect(unlocked(facts, "boss-interview")).toBe(false);
  });

  it("unlocks drill achievements from results and the drills you have tried", () => {
    let b = factsBuilder();
    for (const type of ["jam", "roulette", "word_bomb", "story_spine"] as const) b = b.session({ exerciseType: type, activity: activity() }).take({ durationMs: 60_000, result: type === "word_bomb" ? { shown: 3, woven: 3 } : {} });
    let facts = b.build();
    expect(unlocked(facts, "jam-first")).toBe(true);
    expect(unlocked(facts, "word-bomb-all")).toBe(true);
    expect(unlocked(facts, "drill-sampler")).toBe(false);
    facts = b.session({ exerciseType: "story_cubes", activity: activity() }).take({ durationMs: 60_000 }).build();
    expect(drillTypesPlayed(facts).size).toBe(5);
    expect(unlocked(facts, "drill-sampler")).toBe(true);
    expect(unlocked(facts, "all-drills")).toBe(false);
    // Drills don't count toward trying all four exercises.
    expect(unlocked(facts, "all-exercises")).toBe(false);
  });

  it("keeps drill records from round results, the first one silently", () => {
    const facts = factsBuilder()
      .session({ exerciseType: "jam", activity: activity() }).take({ durationMs: 60_000, result: { cleanSeconds: 41 } })
      .session({ exerciseType: "gauntlet", activity: activity() }).take({ stepKey: "familiar", durationMs: 30_000 }).take({ stepKey: "unfamiliar", durationMs: 45_000 })
      .build();
    const found = newRecords(facts, []).filter((r) => ["jam_clean_seconds", "gauntlet_rounds"].includes(r.record));
    expect(found.map((r) => [r.record, r.value, r.unit, r.attemptId])).toEqual([
      ["jam_clean_seconds", 41, "s", facts.takes[0].id],
      ["gauntlet_rounds", 2, "rounds", facts.takes[2].id],
    ]);
    const stored = found.map((r, i) => ({ ...r, id: i + 1, previous: null, achievedAt: "x" }));
    expect(newRecords(facts, stored).filter((r) => ["jam_clean_seconds", "gauntlet_rounds"].includes(r.record))).toEqual([]);
  });

  it("offers a quest for each drill and counts this week's sessions", () => {
    expect(QUEST_TEMPLATES.filter((q) => q.id.startsWith("drill-")).map((q) => q.title)).toContain("Play Just a Minute");
    expect(QUEST_TEMPLATES.find((q) => q.id === "drill-boss")?.title).toBe("Play a boss level");
    const facts = factsBuilder("2026-10-14").session({ exerciseType: "daily", activity: activity() }).take().onDay(1).session({ exerciseType: "daily", activity: activity() }).take().build();
    expect(questProgress({ quest: "daily-3", week: "2026-10-12" }, facts, [], ctx(facts))).toEqual({ done: 2, needed: 3, met: false });
    expect(questProgress({ quest: "story-1", week: "2026-10-12" }, factsBuilder("2026-10-14").session({ exerciseType: "story_spine", activity: activity() }).take().build(), [], ctx(facts)).met).toBe(true);
  });

  it("recommends some drills after a level but never blocks", () => {
    expect(recommendation("gauntlet", [])).toEqual({ area: "spontaneity", level: 3, met: false });
    expect(recommendation("boss:toast", [{ area: "storytelling", current: 3, levels: [], next: null }])?.met).toBe(true);
    expect(recommendation("jam", [])).toBeNull();
  });
});
