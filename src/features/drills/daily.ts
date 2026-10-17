import { DAILY_EPOCH, DAILY_PROMPTS, type DailyPrompt } from "@/content/daily-prompts";
import { formatClock } from "@/lib/format";

/**
 * The daily prompt (roadmap 10.11): one prompt a day, the same for everyone
 * on the same version, chosen by date with no server. Daily #1 is the epoch.
 */
const DAY_MS = 86_400_000;
export const dayNumber = (localDate: string) => Math.floor(Date.parse(`${localDate}T00:00:00Z`) / DAY_MS);

/** "Daily #N" for a date (dates before the epoch are #1). */
export function dailyNumber(localDate: string): number {
  return Math.max(1, dayNumber(localDate) - dayNumber(DAILY_EPOCH) + 1);
}

export function dailyFor(localDate: string): { number: number; prompt: DailyPrompt } {
  const number = dailyNumber(localDate);
  return { number, prompt: DAILY_PROMPTS[(number - 1) % DAILY_PROMPTS.length] };
}

/** The daily's session, one a day: every take that day joins it. */
export const dailySessionId = (localDate: string) => `daily-${localDate}`;

/** Window classes of the daily grid, as the native result codes them. */
export const WINDOW_CLASSES = [
  { code: 0, label: "flowing", square: "🟩" },
  { code: 1, label: "hesitation", square: "🟨" },
  { code: 2, label: "pause", square: "⬜" },
  { code: 3, label: "silent", square: "⬛" },
] as const;

/**
 * The text "Copy share text" puts on the clipboard: the number, the length,
 * the squares and the counts in words. Never the topic or anything you said.
 */
export function shareText(number: number, durationMs: number, windows: readonly number[]): string {
  const squares = windows.map((w) => WINDOW_CLASSES[w]?.square ?? "⬛").join("");
  const counts = WINDOW_CLASSES.map((c) => ({ c, n: windows.filter((w) => w === c.code).length }))
    .filter(({ n }) => n > 0)
    .map(({ c, n }) => `${n} ${c.label}`)
    .join(" · ");
  return `ClearPractice Daily #${number} · ${formatClock(durationMs)}\n${squares}\n${counts}`;
}
