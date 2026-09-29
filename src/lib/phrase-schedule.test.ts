import { describe, expect, it } from "vitest";
import { addLocalDays, nextIntervalDays } from "./phrase-schedule";

describe("phrase review schedule (§6 Phrases)", () => {
  it("advances one step on Good along 1, 3, 7, 14, 30", () => {
    const seen: number[] = [];
    let d = 0;
    for (let i = 0; i < 6; i++) {
      d = nextIntervalDays(d, "good");
      seen.push(d);
    }
    expect(seen).toEqual([1, 3, 7, 14, 30, 30]);
  });

  it("keeps the interval on Hard", () => {
    expect(nextIntervalDays(7, "hard")).toBe(7);
    expect(nextIntervalDays(0, "hard")).toBe(1);
  });

  it("returns to the next day on Again", () => {
    expect(nextIntervalDays(14, "again")).toBe(1);
  });

  it("adds calendar days across month and year boundaries", () => {
    expect(addLocalDays("2026-09-29", 3)).toBe("2026-10-02");
    expect(addLocalDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addLocalDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("does not drift across a daylight-saving change", () => {
    // Europe switches clocks on the last Sunday of October.
    expect(addLocalDays("2026-10-24", 2)).toBe("2026-10-26");
  });
});
