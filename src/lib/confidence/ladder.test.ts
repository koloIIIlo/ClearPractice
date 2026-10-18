import { describe, expect, it } from "vitest";
import type { ExposureAttempt, ExposureStep } from "@/lib/ipc/schemas";
import { offending } from "@/test/no-scores";
import { EXPOSURE_TEMPLATES } from "@/content/exposure-templates";
import { chartRows, exposureCounts, nextUp, statsLine, stepStats } from "./ladder";

let n = 0;
const attempt = (stepId: string, localDate: string, before: number | null, after: number | null, outcome: ExposureAttempt["outcome"] = "yes"): ExposureAttempt =>
  ({ id: `a${(n += 1)}`, stepId, localDate, beforeRating: before, afterRating: after, outcome, note: "", createdAt: `${localDate}T09:00:00.000Z` });
const step = (id: string, position: number): ExposureStep => ({ id, position, title: `Step ${position}`, templateId: null, createdAt: "2026-10-01T09:00:00.000Z" });

describe("the exposure ladder (12.2)", () => {
  it("reads a step's attempts: done count, first before, latest after and an open plan", () => {
    const s = stepStats([attempt("s1", "2026-10-03", 7, 4), attempt("s1", "2026-10-01", 8, 6), attempt("s1", "2026-10-05", 5, null, "planned"), attempt("s1", "2026-10-04", 6, 6, "not_this_time")]);
    expect([s.done, s.firstBefore, s.lastAfter, s.plan?.localDate, s.manageable]).toEqual([2, 8, 6, "2026-10-05", false]);
    expect(statsLine(s)).toBe("done 2× · discomfort 8 → 6");
    expect(statsLine(stepStats([]))).toBe("Not tried yet");
    expect(statsLine(stepStats([attempt("s1", "2026-10-05", 5, null, "planned")]))).toBe("planned · expected discomfort 5");
  });

  it("suggests the next step after two calm attempts and locks nothing", () => {
    const steps = [step("s1", 1), step("s2", 2), step("s3", 3)];
    const calm = [attempt("s1", "2026-10-01", 7, 5), attempt("s1", "2026-10-02", 4, 3), attempt("s1", "2026-10-03", 3, 2)];
    expect(stepStats(calm).manageable).toBe(true);
    expect(nextUp(steps, calm)).toBe("s2");
    // One calm attempt isn't enough; a planned attempt doesn't count as a rating afterwards.
    expect(stepStats([attempt("s1", "2026-10-01", 7, 2)]).manageable).toBe(false);
    expect(stepStats([attempt("s1", "2026-10-01", 7, 2), attempt("s1", "2026-10-02", 6, null, "planned")]).manageable).toBe(false);
    expect(nextUp(steps, [...calm, attempt("s2", "2026-10-04", 5, 3), attempt("s2", "2026-10-05", 4, 1)])).toBe("s3");
    expect(nextUp(steps, [])).toBeNull();
  });

  it("charts before and after per attempt, in order", () => {
    const rows = chartRows([attempt("s1", "2026-10-03", 5, 3), attempt("s1", "2026-10-01", 7, 4), attempt("s1", "2026-10-02", null, null, "not_this_time")]);
    expect(rows).toEqual([{ attempt: 1, date: "2026-10-01", before: 7, after: 4 }, { attempt: 2, date: "2026-10-03", before: 5, after: 3 }]);
  });

  it("counts steps done for Courage, deleted ones included, and stretches rated 6 or more beforehand", () => {
    const facts = [
      { stepId: "s1", attempts: [{ before: 7, done: true }, { before: 4, done: true }] },
      { stepId: "s2", attempts: [{ before: 8, done: false }] },
      { stepId: "s3", attempts: [{ before: 3, done: true }] },
    ];
    expect(exposureCounts(facts)).toEqual({ steps: 2, attempts: 3 });
    expect(exposureCounts(facts, 6)).toEqual({ steps: 1, attempts: 1 });
  });

  it("has four templates of eight plain steps with no score words", () => {
    expect(EXPOSURE_TEMPLATES.map((t) => [t.id, t.steps.length])).toEqual([["meetings", 8], ["social", 8], ["presentations", 8], ["phone", 8]]);
    for (const t of EXPOSURE_TEMPLATES) {
      for (const s of t.steps) {
        expect(s.length, s).toBeGreaterThanOrEqual(3);
        expect(s.length, s).toBeLessThanOrEqual(160);
        expect(offending(s), s).toEqual([]);
      }
      expect(`${t.title} ${t.summary} ${t.steps.join(" ")}`).not.toMatch(/anxious|anxiety|fear|phobia/i);
    }
  });
});
