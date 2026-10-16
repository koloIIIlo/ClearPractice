import { expect, it } from "vitest";
import { buildProgressFromFacts } from "@/lib/today-plan";
import { factsBuilder } from "@/test/fixtures/facts";
import { buildProfile } from "./profile";
import { buildTrends } from "./trends";

/** M8 exit gate: Profile, Trends and Progress from two years of facts within budget (README performance budgets). */
it("builds profile, trends and progress from two years of seeded facts within budget", () => {
  let b = factsBuilder("2026-10-16");
  for (let day = 730; day >= 1; day -= 1) {
    b = b.onDay(day).session({ familiarity: day % 3 === 0 ? "unfamiliar" : "familiar", takeaway: day % 10 === 0 });
    for (let take = 0; take < 4; take += 1)
      b = b.take({ transcribed: true, paceWpm: 120 + (day % 17), meanRun: 6 + (day % 5), speechSpanMs: 58_000, midClausePauses: day % 4, differentPer50: 34 + (day % 6), words: 130, fillersConfirmed: 2, fillersReviewed: day % 2 === 0, rateSps: 4 + (day % 7) / 10, watchPer100: 1.5, hedgesPer100: 2.3 });
  }
  const facts = b.build();
  expect(facts.takes).toHaveLength(2920);
  const started = performance.now();
  const trends = [...buildTrends(facts, "rehearsed"), ...buildTrends(facts, "unfamiliar")];
  const profile = buildProfile(facts);
  const progress = [buildProgressFromFacts("rehearsed", facts), buildProgressFromFacts("unfamiliar", facts)];
  const elapsed = performance.now() - started;
  expect(trends[0].points.length).toBeGreaterThan(400);
  expect(profile.since).not.toBeNull();
  expect(progress[0].points.length).toBeGreaterThan(400);
  // 150 ms leaves room for a slow laptop under test load; typical runs take a fraction of it.
  expect(elapsed).toBeLessThan(150);
});
