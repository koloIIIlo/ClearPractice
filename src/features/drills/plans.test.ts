import { describe, expect, it } from "vitest";
import { PROMPTS } from "@/content/prompts";
import { DRILLS } from "@/content/drills";
import { EMPHASIS_SENTENCES } from "@/content/emphasis-sentences";
import { STORY_ICONS } from "@/content/story";
import { DAILY_EPOCH, DAILY_PROMPTS } from "@/content/daily-prompts";
import { DRILL_TYPES, PracticePrompt } from "@/lib/ipc/schemas";
import { ActivityContext, ActivityStep } from "@/lib/ipc/schemas";
import { DRILL_UNITS } from "@/lib/engagement/drills";
import { DRILL_MODULES, type DrillPlan } from "./drill-module";
import { dailyFor, dailyNumber, shareText } from "./daily";
import { plan as jam } from "./modules/jam";
import { plan as roulette, lightReached } from "./modules/roulette";
import { bombTimes, plan as wordBomb } from "./modules/word-bomb";
import { plan as threeWays } from "./modules/three-ways";
import { plan as emphasis } from "./modules/emphasis";
import { plan as paceLadder } from "./modules/pace-ladder";
import { plan as storySpine } from "./modules/story-spine";
import { plan as storyCubes } from "./modules/story-cubes";
import { plan as pitch } from "./modules/pitch";
import { plan as steelman } from "./modules/steelman";
import { plan as daily } from "./modules/daily";
import { plan as gauntlet } from "./modules/gauntlet";
import { plan as boss } from "./modules/boss";

const prompts: PracticePrompt[] = PROMPTS.map((p) => PracticePrompt.parse(p));
const ctx = { prompts, today: "2026-10-20" };

/** Every plan must be storable as it is: the activity snapshot and each round's step (7.3). */
function expectStorable(p: DrillPlan) {
  expect(() => ActivityContext.parse({ version: p.drill.version, seed: p.seed, groupId: p.groupId ?? undefined, params: p.params })).not.toThrow();
  expect(JSON.stringify(p.params).length).toBeLessThanOrEqual(4096);
  for (const r of p.rounds) {
    expect(() => ActivityStep.parse({ index: r.index, key: r.key, promptId: r.promptId ?? undefined })).not.toThrow();
    expect(r.thinkSeconds).toBeGreaterThanOrEqual(0);
    if (r.promptId) expect(r.promptId).toMatch(/^[A-Za-z0-9_-]{1,96}$/);
  }
  expect(p.rounds.map((r) => r.index)).toEqual(p.rounds.map((_, i) => i));
}

describe("drill plans (10.2–10.13)", () => {
  it("has a module for every drill type, and the engine counts rounds the same way", async () => {
    for (const type of DRILL_TYPES) {
      const m = await DRILL_MODULES[type]();
      const p = m.plan("seed-1", {}, ctx);
      expect(p.drill.type).toBe(type);
      expectStorable(p);
      expect(DRILL_UNITS[type]).toBe(DRILLS.find((d) => d.type === type)!.unit);
    }
  });

  it("picks the same Just a Minute topic for the same seed", () => {
    expect(jam("a", {})).toEqual(jam("a", {}));
    const topics = new Set(["a", "b", "c", "d", "e", "f"].map((s) => jam(s, {}).contentId));
    expect(topics.size).toBeGreaterThan(1);
    expect(jam("a", { topic: "jam-002" }).rounds[0].prompt).toBe("Why people keep houseplants");
    expect(jam("a", {}).rounds[0]).toMatchObject({ thinkSeconds: 5, speakSeconds: 60 });
  });

  it("is deterministic per seed for roulette and allows one re-spin", () => {
    const first = roulette("s", {});
    expect(roulette("s", {})).toEqual(first);
    const respun = roulette("s", { respun: true });
    expect(respun.params.respun).toBe(true);
    expect(roulette("s", { speak: 90 }).rounds[0]).toMatchObject({ speakSeconds: 90, graceSeconds: 5, lights: true, thinkSeconds: 10 });
    expect(roulette("s", { speak: 45 }).rounds[0].speakSeconds).toBe(60);
    expect(lightReached(41_000, 60)).toBe("You reached green at 0:40.");
    expect(lightReached(61_000, 60)).toBe("You spoke until red, the full time.");
    expect(lightReached(20_000, 60)).toBe("You stopped at 0:20, before green at 0:40.");
  });

  it("spaces word bombs at least 15 seconds apart between 15 and 75 seconds", () => {
    for (const seed of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      const t = bombTimes(seed);
      expect(t[0]).toBeGreaterThanOrEqual(15);
      expect(t[1] - t[0]).toBeGreaterThanOrEqual(15);
      expect(t[2] - t[1]).toBeGreaterThanOrEqual(15);
      expect(t[2]).toBeLessThanOrEqual(75);
    }
    const p = wordBomb("a", {}, ctx);
    expect((p.params.words as string[]).every((w) => /^[a-z]+\|[a-z]+$/.test(w))).toBe(true);
    expect(new Set(p.params.wordIds as string[]).size).toBe(3);
  });

  it("creates three ways rounds with fixed keys, open-ended", () => {
    const p = threeWays("s", {}, ctx);
    expect(p.rounds.map((r) => [r.key, r.speakSeconds])).toEqual([["child", null], ["colleague", null], ["expert", null]]);
    expect(threeWays("s", { topic: "How a lock works" }, ctx).sessionPrompt).toBe("Explain it three ways: How a lock works");
  });

  it("plays seven distinct emphasis sentences with a target that changes the meaning", () => {
    const p = emphasis("s", {});
    expect(p.rounds).toHaveLength(7);
    expect(new Set(p.params.ids as string[]).size).toBe(7);
    (p.params.ids as string[]).forEach((id, i) => {
      const sentence = EMPHASIS_SENTENCES.find((s) => s.id === id)!;
      expect(sentence.targets.map((t) => String(t.word))).toContain((p.params.targets as string[])[i]);
      expect((p.params.sentences as string[])[i]).toBe(sentence.text);
    });
  });

  it("climbs the pace ladder slow, natural, fast in 30-second rounds", () => {
    expect(paceLadder("s", {}, ctx).rounds.map((r) => [r.key, r.speakSeconds])).toEqual([["slow", 30], ["natural", 30], ["fast", 30]]);
  });

  it("rolls distinct icons per seed and keeps their words for the result", () => {
    const p = storyCubes("s", { cubes: 5 });
    const ids = p.params.iconIds as string[];
    expect(new Set(ids).size).toBe(5);
    ids.forEach((id, i) => expect((p.params.icons as string[])[i]).toBe(STORY_ICONS.find((icon) => icon.id === id)!.synonyms.join("|")));
    expect(storyCubes("s", { cubes: 5 })).toEqual(p);
    expect(storyCubes("s", { cubes: 9 }).params.cubes).toBe(4);
    expect(storySpine("s", {}).rounds[0].speakSeconds).toBe(90);
  });

  it("uses 60, 30 and 15 seconds for the pitch", () => {
    expect(pitch("s", {}, ctx).rounds.map((r) => r.speakSeconds)).toEqual([60, 30, 15]);
  });

  it("assigns the side you didn't choose in steelman", () => {
    expect(steelman("s", { stand: "for" }, ctx).params.argue).toBe("against");
    expect(steelman("s", { stand: "against" }, ctx).params.argue).toBe("for");
    expect(steelman("s", { stand: "unsure", argue: "for" }, ctx).params.argue).toBe("for");
    const p = steelman("s", { stand: "for" }, ctx);
    expect(p.rounds.map((r) => [r.key, r.speakSeconds])).toEqual([["argue", 90], ["objection", 60]]);
    expect(p.rounds[0].prompt).toMatch(/^Argue against: /);
  });

  it("gives the same daily prompt for the same date and a new one the next day, numbered from the epoch", () => {
    expect(dailyNumber(DAILY_EPOCH)).toBe(1);
    expect(dailyNumber("2026-10-20")).toBe(dailyNumber(DAILY_EPOCH) + 3);
    expect(dailyFor("2026-10-20")).toEqual(dailyFor("2026-10-20"));
    expect(dailyFor("2026-10-20").prompt.id).not.toBe(dailyFor("2026-10-21").prompt.id);
    expect(dailyFor(DAILY_EPOCH).prompt).toBe(DAILY_PROMPTS[0]);
    // The whole list comes round again after a year.
    expect(dailyFor("2027-10-17").prompt).toBe(DAILY_PROMPTS[0]);
    const p = daily("ignored", {}, ctx);
    expect([p.seed, p.params.date, p.sessionPrompt.startsWith("Daily #4:")]).toEqual(["daily-2026-10-20", "2026-10-20", true]);
  });

  it("copies share text with counts and no words of the answer", () => {
    expect(shareText(123, 60_000, [0, 0, 1, 0, 2, 0])).toBe("ClearPractice Daily #123 · 1:00\n🟩🟩🟨🟩⬜🟩\n4 flowing · 1 hesitation · 1 pause");
  });

  it("builds five rounds of increasing demand from the prompt pack for the gauntlet", () => {
    const p = gauntlet("s", {}, ctx);
    expect(p.rounds.map((r) => [r.key, r.thinkSeconds, r.speakSeconds])).toEqual([
      ["familiar", 10, 30], ["unfamiliar", 10, 45], ["listener", 10, 60], ["follow-up", 5, 45], ["steelman", 10, 60],
    ]);
    expect(p.rounds[1].familiarity).toBe("unfamiliar");
    expect(p.rounds[2].audience).toBeTruthy();
    expect(p.rounds[3].followUp).toBe(true);
  });

  it("stops the meeting boss at the interruption and starts the answer round", () => {
    const p = boss("s", { boss: "meeting" });
    expect(p.rounds.map((r) => [r.key, r.speakSeconds])).toEqual([["update", 40], ["answer-1", 30]]);
    const interview = boss("s", { boss: "job-interview" });
    expect(interview.rounds).toHaveLength(4);
    expect((interview.params.questions as string[]).every((q) => q.startsWith("star-"))).toBe(true);
    expect(boss("s", {}).params.boss).toBe("job-interview");
  });
});
