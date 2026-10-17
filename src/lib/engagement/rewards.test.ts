import { describe, expect, it } from "vitest";
import { factsBuilder } from "@/test/fixtures/facts";
import { offending } from "@/test/no-scores";
import type { EngagementState, PracticeEvent, PracticeFacts, RecordRow } from "@/lib/ipc/schemas";
import { ACCENTS, POTS, unlockedAccents } from "./accents";
import { achievementProgress, ACHIEVEMENTS, newAchievements, type AchievementInput } from "./achievements";
import { stageForDays, daysToNextStage } from "./companion";
import { computeBaselines, type EvalContext } from "./criteria";
import { evaluateAreas } from "./evaluate";
import { freshStartNote, isComeback } from "./fresh-start";
import { generateWeeklyQuests, QUEST_TEMPLATES, questProgress, swapCandidate } from "./quests";
import { newRecords } from "./records";
import { AREA_IDS } from "./types";
import { goalProgress, practiceDays, weekStart, weeksInARow } from "./weekly";
import { lifetimeXp, weekXp, xpByWeek } from "./xp";

let nextId = 1;
const event = (kind: string, localDate: string, xp = 10, extra: Partial<PracticeEvent> = {}): PracticeEvent =>
  ({ id: nextId++, kind, refId: `${kind}-${nextId}`, localDate, sessionId: null, attemptId: null, xp, backfilled: false, createdAt: `${localDate}T08:00:00.000Z`, ...extra });
const ctx = (facts: PracticeFacts): EvalContext => ({ today: facts.today, baselines: computeBaselines(facts), promptTags: {} });
const empty: EngagementState = { levels: [], achievements: [], records: [], quests: [], goalWeeks: [] };
const input = (facts: PracticeFacts, events: PracticeEvent[] = [], state = empty): AchievementInput =>
  ({ facts, events, state, ctx: ctx(facts), areas: evaluateAreas(facts, [], ctx(facts)), prefs: { weekStartsOn: "monday", weeklyGoalDays: 3 } });

describe("weekly goal (9.8)", () => {
  it("computes week starts for Monday and Sunday weeks across month and year ends", () => {
    expect(weekStart("2026-10-16", "monday")).toBe("2026-10-12");
    expect(weekStart("2026-10-12", "monday")).toBe("2026-10-12");
    expect(weekStart("2026-10-11", "monday")).toBe("2026-10-05");
    expect(weekStart("2026-10-16", "sunday")).toBe("2026-10-11");
    expect(weekStart("2026-11-01", "monday")).toBe("2026-10-26");
    expect(weekStart("2027-01-01", "monday")).toBe("2026-12-28");
    expect(weekStart("2027-01-02", "sunday")).toBe("2026-12-27");
  });

  it("counts a practice day once however many takes", () => {
    const events = [event("take_saved", "2026-10-12"), event("take_saved", "2026-10-12"), event("phrase_reviewed", "2026-10-13"), event("transfer_review", "2026-10-14")];
    expect(practiceDays(events, "2026-10-12")).toEqual(["2026-10-12", "2026-10-14"]);
    expect(goalProgress(events, "2026-10-12", 3)).toEqual({ days: 2, goal: 3, met: false });
    expect(goalProgress(events, "2026-10-12", 2).met).toBe(true);
  });

  it("weeks in a row skips nothing and counts this week once met", () => {
    expect(weeksInARow(["2026-09-28", "2026-10-05"], "2026-10-12", false)).toBe(2);
    expect(weeksInARow(["2026-09-28", "2026-10-05"], "2026-10-12", true)).toBe(3);
    expect(weeksInARow(["2026-09-21", "2026-10-05"], "2026-10-12", false)).toBe(1);
    expect(weeksInARow([], "2026-10-12", false)).toBe(0);
  });

  it("a goal met stays met after the goal changes", () => {
    // The week is recorded when met; a later, higher goal doesn't undo it.
    expect(weeksInARow(["2026-10-12"], "2026-10-12", goalProgress([], "2026-10-12", 7).met)).toBe(1);
  });
});

describe("XP (9.5)", () => {
  it("sums this week from the week's first day and includes backfilled events", () => {
    const events = [event("take_saved", "2026-10-11", 10), event("take_saved", "2026-10-12", 10, { backfilled: true }), event("retake", "2026-10-18", 5), event("quest", "2026-10-19", 30)];
    expect(weekXp(events, "2026-10-12")).toBe(15);
    expect(lifetimeXp(events)).toBe(55);
    expect(xpByWeek(events, "2026-10-19", 3)).toEqual([{ week: "2026-10-05", xp: 10 }, { week: "2026-10-12", xp: 15 }, { week: "2026-10-19", xp: 30 }]);
  });
});

describe("achievements (9.6)", () => {
  it("every achievement has a unique id, title, icon and a criterion", () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
    for (const a of ACHIEVEMENTS) {
      expect(a.id).toMatch(/^[a-z0-9-]{3,40}$/);
      expect(a.title.length, a.id).toBeLessThanOrEqual(30);
      expect(a.icon, a.id).toBeTruthy();
      expect(a.criterion.label.length, a.id).toBeGreaterThan(0);
      expect(offending(`${a.title}. ${a.description}`), a.id).toEqual([]);
      if (a.unlocksAccent) expect(ACCENTS.some((x) => x.id === a.unlocksAccent)).toBe(true);
      if (a.unlocksPot) expect(POTS.some((x) => x.id === a.unlocksPot)).toBe(true);
    }
  });

  it("unlocks First take after one saved take", () => {
    expect(newAchievements(factsBuilder().build(), empty, [], ctx(factsBuilder().build()), [], { weekStartsOn: "monday", weeklyGoalDays: 3 })).toEqual([]);
    const facts = factsBuilder().session().take().build();
    const ids = newAchievements(facts, empty, [], ctx(facts), [], { weekStartsOn: "monday", weeklyGoalDays: 3 }).map((a) => a.id);
    expect(ids).toContain("first-take");
    const already = { ...empty, achievements: [{ id: "first-take", definitionVersion: 1, evidence: {}, unlockedAt: "x" }] };
    expect(newAchievements(facts, already, [], ctx(facts), [], { weekStartsOn: "monday", weeklyGoalDays: 3 }).map((a) => a.id)).not.toContain("first-take");
  });

  it("Comeback needs fourteen days away", () => {
    const comeback = ACHIEVEMENTS.find((a) => a.id === "comeback")!;
    const facts = factsBuilder().build();
    expect(achievementProgress(comeback, input(facts, [event("take_saved", "2026-09-01"), event("take_saved", "2026-09-14")])).met).toBe(false);
    expect(achievementProgress(comeback, input(facts, [event("take_saved", "2026-09-01"), event("take_saved", "2026-09-15")])).met).toBe(true);
  });

  it("Said it without notes needs a 60-second take with no outline", () => {
    const noNotes = ACHIEVEMENTS.find((a) => a.id === "no-notes")!;
    const met = (session: object, take: object) => achievementProgress(noNotes, input(factsBuilder().session(session).take(take).build())).met;
    expect(met({ outline: [false, false, false] }, { speechSpanMs: 60_000 })).toBe(true);
    expect(met({ outline: [false, false, false] }, { speechSpanMs: 59_000 })).toBe(false);
    expect(met({ outline: [true, false, false] }, { speechSpanMs: 90_000 })).toBe(false);
  });
});

describe("personal records (9.7)", () => {
  const row = (record: string, value: number): RecordRow => ({ id: 1, record, value, unit: "words", previous: null, attemptId: null, sessionId: null, definitionVersion: 1, achievedAt: "x" });

  it("stores the first value silently and celebrates only improvements", () => {
    const facts = factsBuilder().session().take({ transcribed: true, longestRun: 11 }).take({ transcribed: true, longestRun: 9 }).build();
    const first = newRecords(facts, []).find((r) => r.record === "longest_run")!;
    expect([first.value, first.attemptId]).toEqual([11, "take-2"]);
    expect(newRecords(facts, [row("longest_run", 11)]).some((r) => r.record === "longest_run")).toBe(false);
    const better = factsBuilder().session().take({ transcribed: true, longestRun: 14 }).build();
    expect(newRecords(better, [row("longest_run", 11)]).find((r) => r.record === "longest_run")?.value).toBe(14);
  });

  it("ignores ties and ineligible takes", () => {
    const facts = factsBuilder().session().take({ transcribed: false, longestRun: 30 }).build();
    expect(newRecords(facts, []).some((r) => r.record === "longest_run")).toBe(false);
    const tie = factsBuilder().session().take({ transcribed: true, longestRun: 11 }).build();
    expect(newRecords(tie, [row("longest_run", 11)]).some((r) => r.record === "longest_run")).toBe(false);
  });

  it("the filler record needs a fully reviewed unfamiliar take of 60 seconds", () => {
    const take = { fillersReviewed: true, words: 150, fillersConfirmed: 3, speechSpanMs: 61_000 };
    const has = (session: object, t: object) => newRecords(factsBuilder().session(session).take(t).build(), []).some((r) => r.record === "fewest_confirmed_per_100_unfamiliar");
    expect(has({ familiarity: "unfamiliar" }, take)).toBe(true);
    expect(has({ familiarity: "familiar" }, take)).toBe(false);
    expect(has({ familiarity: "unfamiliar" }, { ...take, speechSpanMs: 50_000 })).toBe(false);
    expect(has({ familiarity: "unfamiliar" }, { ...take, fillersReviewed: false })).toBe(false);
  });
});

describe("weekly quests (9.9)", () => {
  const monday = "2026-10-12";
  const facts = factsBuilder("2026-10-14").session({ outline: [true, true, true] }).take().build();
  const areas = evaluateAreas(facts, [], ctx(facts));

  it("has unique templates, short titles and something for every area", () => {
    expect(new Set(QUEST_TEMPLATES.map((q) => q.id)).size).toBe(QUEST_TEMPLATES.length);
    for (const q of QUEST_TEMPLATES) expect(q.title.length).toBeLessThanOrEqual(50);
    for (const area of AREA_IDS) expect(QUEST_TEMPLATES.some((q) => q.area === area), area).toBe(true);
  });

  it("fills three slots with weakest area, real world and variety", () => {
    const quests = generateWeeklyQuests(facts, areas, [], monday, [], ctx(facts));
    expect(quests.map((q) => q.slot)).toEqual([1, 2, 3]);
    expect(quests[1].quest).toBe("real-1");
    expect(new Set(quests.map((q) => q.quest)).size).toBe(3);
    expect(quests[0].params).toHaveProperty("area");
  });

  it("is deterministic for a week", () => {
    expect(generateWeeklyQuests(facts, areas, [], monday, [], ctx(facts))).toEqual(generateWeeklyQuests(facts, areas, [], monday, [], ctx(facts)));
  });

  it("never repeats a template from the last three weeks in slot 3", () => {
    const recent = QUEST_TEMPLATES.filter((q) => q.id !== "real-1" && q.id !== "phrases-10").map((q, i) => ({ week: "2026-10-05", slot: (i % 3) + 1, quest: q.id, params: {}, swapped: false, createdAt: "x", completedAt: null }));
    const [first, , third] = generateWeeklyQuests(facts, areas, [], monday, recent, ctx(facts));
    // Only phrases-10 wasn't a quest in the last three weeks.
    if (first.quest !== "phrases-10") expect(third.quest).toBe("phrases-10");
    const thisWeek = [{ week: monday, slot: 2, quest: "real-1", params: {}, swapped: false, createdAt: "x", completedAt: null }];
    expect(swapCandidate(1, thisWeek, facts, recent, monday)?.quest).toBe("phrases-10");
  });

  it("detects completion from this week's facts only", () => {
    const f = factsBuilder("2026-10-14").onDay(8).session({ familiarity: "unfamiliar" }).take().onDay(1).session({ familiarity: "unfamiliar" }).take().build();
    expect(questProgress({ quest: "unfamiliar-2", week: monday }, f, [], ctx(f))).toEqual({ done: 1, needed: 2, met: false });
    const g = factsBuilder("2026-10-14").onDay(1).session({ familiarity: "unfamiliar" }).take().session({ familiarity: "unfamiliar" }).take().build();
    expect(questProgress({ quest: "unfamiliar-2", week: monday }, g, [], ctx(g)).met).toBe(true);
  });
});

describe("companion, accents and fresh starts (9.11–9.13)", () => {
  it("maps practice days to stages", () => {
    expect([0, 1, 2, 3, 7, 13, 14, 30, 60, 100, 179, 180, 500].map(stageForDays)).toEqual([0, 1, 1, 2, 3, 3, 4, 5, 6, 7, 7, 8, 8]);
    expect([daysToNextStage(0), daysToNextStage(5), daysToNextStage(200)]).toEqual([1, 2, null]);
  });

  it("unlocks accents with their achievements and violet with any level 3", () => {
    expect([...unlockedAccents(undefined)]).toEqual(["green"]);
    const state = { achievements: [{ id: "goal-1", definitionVersion: 1, evidence: {}, unlockedAt: "x" }], levels: [{ area: "voice", level: 3, definitionVersion: 1, evidence: {}, achievedAt: "x" }] };
    expect([...unlockedAccents(state)].sort()).toEqual(["green", "ocean", "violet"]);
  });

  it("picks the right note for Mondays, month starts and comebacks", () => {
    expect(freshStartNote([], "2026-10-19", "monday")).toEqual({ kind: "week", text: "New week. Three quests are ready." });
    expect(freshStartNote([], "2026-10-02", "monday")?.text).toBe("October: Storytelling month. Quests lean toward stories.");
    expect(freshStartNote([], "2026-10-15", "monday")).toBeNull();
    const away = [event("take_saved", "2026-09-30")];
    expect(isComeback(away, "2026-10-14")).toBe(true);
    expect(isComeback(away, "2026-10-13")).toBe(false);
    expect(freshStartNote(away, "2026-10-15", "monday")?.kind).toBe("comeback");
  });
});
