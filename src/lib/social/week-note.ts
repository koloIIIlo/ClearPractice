import { DRILLS } from "@/content/drills";
import { practiceDays, weekStart, type WeekStartsOn } from "@/lib/engagement/weekly";
import type { PracticeEvent, PracticeFacts } from "@/lib/ipc/schemas";
import { addLocalDays } from "@/lib/phrase-schedule";

const counted = (n: number, singular: string) => `${n} ${singular}${n === 1 ? "" : "s"}`;
const times = (n: number) => n === 1 ? "once" : n === 2 ? "twice" : `${n} times`;
const join = (parts: string[]) => parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;

/** A private note of this week's activity, plus only the highlight you chose (15.4). */
export function buildWeekNote(facts: PracticeFacts, events: readonly PracticeEvent[], startsOn: WeekStartsOn, highlight = ""): string {
  const start = weekStart(facts.today, startsOn);
  const end = addLocalDays(start, 6);
  const inWeek = (date: string) => date >= start && date <= end;
  const takes = facts.takes.filter((t) => inWeek(t.localDate));
  const days = practiceDays(events, start).length;
  const minutes = Math.round(takes.reduce((n, t) => n + t.durationMs, 0) / 60_000);
  const totals = [days > 0 ? counted(days, "day") : "", minutes > 0 ? counted(minutes, "minute") : "", takes.length > 0 ? counted(takes.length, "take") : ""].filter(Boolean);
  const lines = [totals.length > 0 ? `My speaking practice this week: ${totals.join(", ")}.` : "No speaking practice recorded this week."];
  const sessions = new Map(facts.sessions.map((s) => [s.id, s]));
  const drills: string[] = [];
  for (const drill of DRILLS) {
    const rounds = takes.filter((t) => sessions.get(t.sessionId)?.exerciseType === drill.type);
    const count = drill.unit === "take" ? rounds.length : new Set(rounds.map((t) => t.sessionId)).size;
    if (count === 0) continue;
    const clean = drill.type === "jam" ? rounds.flatMap((t) => t.result?.cleanSeconds != null ? [t.result.cleanSeconds] : []) : [];
    const best = clean.length > 0 ? Math.max(...clean) : null;
    drills.push(`${drill.title} ${times(count)}${best !== null && best > 0 ? ` (best ${best} clean seconds)` : ""}`);
  }
  const conversations = facts.transferReviews.filter((r) => inWeek(r.localDate)).length;
  const activity = [drills.length > 0 ? `played ${join(drills)}` : "", conversations > 0 ? `had ${counted(conversations, "real conversation")}` : ""].filter(Boolean).join(" and ");
  if (activity) lines.push(`${activity[0].toUpperCase()}${activity.slice(1)}.`);
  if (highlight.trim()) lines.push(`Highlight: "${highlight.trim()}"`);
  return lines.join("\n");
}
