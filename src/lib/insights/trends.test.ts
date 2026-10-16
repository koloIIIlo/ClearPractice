import { describe, expect, it } from "vitest";
import { factsBuilder } from "@/test/fixtures/facts";
import { buildTrends, MIN_TREND_POINTS, rollingMedian } from "./trends";

describe("trends", () => {
  it("uses the first take of unfamiliar sessions and the latest transcribed take of rehearsed ones", () => {
    const facts = factsBuilder()
      .onDay(3).session({ familiarity: "unfamiliar" }).take({ transcribed: true, meanRun: 5 }).take({ transcribed: true, meanRun: 9 })
      .onDay(2).session({ familiarity: "familiar" }).take({ transcribed: true, meanRun: 6 }).take({ transcribed: true, meanRun: 8 }).take({ transcribed: false })
      .build();
    const meanRun = (view: "rehearsed" | "unfamiliar") => buildTrends(facts, view).find((t) => t.key === "meanRun")!.points.map((p) => p.value);
    expect(meanRun("unfamiliar")).toEqual([5]);
    expect(meanRun("rehearsed")).toEqual([8]);
  });

  it("needs four points", () => {
    let b = factsBuilder();
    for (let day = 5; day >= 1; day -= 1) b = b.onDay(day).session().take({ transcribed: true, meanRun: day, speechSpanMs: 60_000, midClausePauses: 2, words: 100, fillersConfirmed: 3, fillersReviewed: day > 2 });
    const trends = buildTrends(b.build(), "rehearsed");
    const count = (key: string) => trends.find((t) => t.key === key)!.points.length;
    expect(count("meanRun")).toBeGreaterThanOrEqual(MIN_TREND_POINTS);
    expect(count("midClausePerMin")).toBe(5);
    expect(trends.find((t) => t.key === "midClausePerMin")!.points[0].value).toBe(2);
    // Confirmed hesitations only from takes where every candidate was reviewed.
    expect(count("confirmedPer100")).toBe(3);
    expect(count("confirmedPer100")).toBeLessThan(MIN_TREND_POINTS);
    expect(count("differentPer50")).toBe(0);
  });

  it("rolling median ignores missing values", () => {
    expect(rollingMedian([4, null, 6, Number.NaN, 8], 5)).toEqual([4, 4, 5, 5, 6]);
    expect(rollingMedian([1, 2, 3, 4, 5, 6, 100], 5)).toEqual([1, 1.5, 2, 2.5, 3, 4, 5]);
    expect(rollingMedian([null], 5)[0]).toBeNaN();
  });
});
