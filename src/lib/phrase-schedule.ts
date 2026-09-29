/**
 * Transparent phrase review schedule — blueprint §6 Phrases.
 * A simple product heuristic, not an optimised learning algorithm:
 *   ladder 1 → 3 → 7 → 14 → 30 days after successful recall;
 *   Again → back to tomorrow, Hard → keep the interval, Good → one step up.
 * The authoritative implementation will live in src-tauri/src/learning;
 * this module mirrors it for the mock client and pins the contract in tests.
 */
import type { PhraseRating } from "./ipc/schemas";

export const INTERVAL_LADDER = [1, 3, 7, 14, 30] as const;

export function nextIntervalDays(currentDays: number, rating: PhraseRating): number {
  if (rating === "again") return 1;
  if (rating === "hard") return Math.max(1, currentDays);
  const next = INTERVAL_LADDER.find((d) => d > currentDays);
  return next ?? INTERVAL_LADDER[INTERVAL_LADDER.length - 1];
}

/** Adds days to a YYYY-MM-DD local calendar date without timezone drift. */
export function addLocalDays(localDate: string, days: number): string {
  const [y, m, d] = localDate.split("-").map(Number);
  const date = new Date(y, m - 1, d + days);
  return toLocalDate(date);
}

export function toLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
