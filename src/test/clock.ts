import { vi } from "vitest";

/**
 * Runs `fn` with "today" fixed to a local date, at noon so no time zone moves
 * it to another day (roadmap 7.7). Only Date is faked: Testing Library's timers
 * keep working.
 */
export async function withFakeToday(localDate: string, fn: () => Promise<void> | void): Promise<void> {
  const [y, m, d] = localDate.split("-").map(Number);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(y, m - 1, d, 12, 0, 0));
  try {
    await fn();
  } finally {
    vi.useRealTimers();
  }
}
