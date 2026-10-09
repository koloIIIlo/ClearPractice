import { expect, it } from "vitest";
import { reminderDue } from "./DailyReminder";

it("reminds once a day after the chosen time, only if you have not practised (Settings → Practice)", () => {
  const at = (h: number, m: number) => new Date(2026, 9, 9, h, m);
  expect(reminderDue(at(17, 59), "18:00", null, false)).toBe(false);
  expect(reminderDue(at(18, 0), "18:00", null, false)).toBe(true);
  expect(reminderDue(at(21, 0), "18:00", "2026-10-09", false)).toBe(false);
  expect(reminderDue(at(21, 0), "18:00", "2026-10-08", false)).toBe(true);
  expect(reminderDue(at(21, 0), "18:00", null, true)).toBe(false);
  expect(reminderDue(at(21, 0), null, null, false)).toBe(false);
});
