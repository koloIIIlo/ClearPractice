/** Display formatting. Dates in the data layer are YYYY-MM-DD local dates or ISO UTC instants. */

export function parseLocalDate(localDate: string): Date {
  const [y, m, d] = localDate.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** "0:28", "1:02", "12:45" — for timers and durations; render with tabular numerals. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** "28 s", "3 min", "1 h 5 min" — for summaries. */
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

/**
 * Formatting follows the interface language, not the Windows display locale.
 * English only for now (D-9); becomes a profile setting later.
 */
export const UI_LOCALE = "en-GB";

const dayFmt = new Intl.DateTimeFormat(UI_LOCALE, { weekday: "short", day: "numeric", month: "short" });
const longFmt = new Intl.DateTimeFormat(UI_LOCALE, { weekday: "long", day: "numeric", month: "long" });

export function formatDay(localDate: string): string {
  return dayFmt.format(parseLocalDate(localDate));
}

export function formatLongDay(localDate: string): string {
  return longFmt.format(parseLocalDate(localDate));
}

/** "Today", "Yesterday", "3 days ago", or a short date beyond a week. */
export function formatRelativeDay(localDate: string, today: string): string {
  const diff = Math.round((parseLocalDate(today).getTime() - parseLocalDate(localDate).getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff > 1 && diff < 7) return `${diff} days ago`;
  if (diff === -1) return "Tomorrow";
  if (diff < -1 && diff > -7) return `In ${-diff} days`;
  return formatDay(localDate);
}
