import { expect, it } from "vitest";
import type { PracticeEvent } from "@/lib/ipc/schemas";
import { factsBuilder } from "@/test/fixtures/facts";
import { evalContext } from "./criteria";
import { evaluate, evaluateAreas } from "./evaluate";
import { generateWeeklyQuests } from "./quests";

/** A-36 for the game layer: one evaluation over two years of seeded history (README performance budgets: ≤ 30 ms, ≤ 200 ms under test load). */
it("evaluates levels, achievements, records and quests over two years within budget", () => {
  let b = factsBuilder("2026-10-16");
  const events: PracticeEvent[] = [];
  for (let day = 730; day >= 1; day -= 1) {
    b = b.onDay(day).session({ familiarity: day % 3 === 0 ? "unfamiliar" : "familiar", outline: [true, day % 2 === 0, true] });
    for (let take = 0; take < 4; take += 1)
      b = b.take({ transcribed: true, fillersReviewed: day % 2 === 0, words: 130, fillersConfirmed: 2, longestRun: 8 + (day % 9), speechSpanMs: 58_000 + (day % 30) * 1000 });
  }
  const facts = b.build();
  for (const [i, take] of facts.takes.entries())
    events.push({ id: i + 1, kind: "take_saved", refId: take.id, localDate: take.localDate, sessionId: take.sessionId, attemptId: take.id, xp: 10, backfilled: false, createdAt: `${take.localDate}T09:00:00.000Z` });
  expect(facts.takes).toHaveLength(2920);
  const state = { levels: [], achievements: [], records: [], quests: [], goalWeeks: [] };
  const prefs = { weeklyGoalDays: 3, weekStartsOn: "monday" as const };

  const started = performance.now();
  const ctx = evalContext(facts, facts.today, []);
  const quests = generateWeeklyQuests(facts, evaluateAreas(facts, [], ctx), events, "2026-10-12", [], ctx);
  const diff = evaluate(facts, events, state, prefs, ctx);
  const elapsed = performance.now() - started;

  expect(quests).toHaveLength(3);
  expect(diff.achievements.length).toBeGreaterThan(5);
  expect(diff.levels.length).toBeGreaterThan(0);
  // 200 ms leaves room for a slow laptop under test load; the budget itself is 30 ms.
  expect(elapsed).toBeLessThan(200);
});
