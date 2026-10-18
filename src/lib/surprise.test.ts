import { expect, it } from "vitest";
import { DEFAULT_PREFERENCES as defaults } from "./ipc/schemas";
import { surpriseDue, surpriseMinute } from "./surprise";
it("draws one time inside the window per day", () => {
  for (let day = 1; day <= 28; day++) {
    const date = `2026-10-${String(day).padStart(2, "0")}`;
    const time = surpriseMinute(date, "09:00", "18:00");
    expect(time).toBe(surpriseMinute(date, "09:00", "18:00"));
    expect(time).toBeGreaterThanOrEqual(540);
    expect(time).toBeLessThan(1080);
  }
  const p = { ...defaults, surpriseEnabled: true };
  expect(surpriseDue(new Date(2026, 9, 19, 18), p, null, false)).toBe(false);
  expect(surpriseDue(new Date(2026, 9, 18, 17, 59), p, null, false)).toBe(false);
  expect(surpriseDue(new Date(2026, 9, 19, 17, 59), p, "2026-10-19", false)).toBe(false);
});
it("skips days with practice", () => {
  const now = new Date(2026, 9, 19, 17, 59);
  const p = { ...defaults, surpriseEnabled: true };
  expect(surpriseDue(now, p, null, false)).toBe(true);
  expect(surpriseDue(now, p, null, true)).toBe(false);
  expect(surpriseDue(now, defaults, null, false)).toBe(false);
});
