import { addLocalDays } from "@/lib/phrase-schedule";
import type { PracticeEvent } from "@/lib/ipc/schemas";
import { weekStart, type WeekStartsOn } from "./weekly";

/**
 * Effort points (roadmap 9.5, appendix B.1). Amounts come from the native core
 * (`practice_events.xp`); XP rewards practising and never measures how you sound.
 */
export const XP_REASONS: Record<string, string> = {
  take_saved: "Take saved",
  retake: "Another take",
  sequence_completed: "Practice complete",
  reflection_saved: "Reflection",
  transcript_reviewed: "Take reviewed",
  phrase_saved: "Phrase saved",
  phrase_reviewed: "Phrase reviewed",
  transfer_review: "Real conversation noted",
  baseline_saved: "Starting point",
  level_reached: "Level reached",
  achievement: "Achievement",
  personal_record: "Personal record",
  weekly_goal: "Weekly goal",
  quest: "Quest done",
};

/** XP of the week that starts on `start`, backfilled events included. */
export function weekXp(events: readonly PracticeEvent[], start: string): number {
  const end = addLocalDays(start, 6);
  return events.filter((e) => e.localDate >= start && e.localDate <= end).reduce((n, e) => n + e.xp, 0);
}

export function lifetimeXp(events: readonly PracticeEvent[]): number {
  return events.reduce((n, e) => n + e.xp, 0);
}

export function dayXp(events: readonly PracticeEvent[], localDate: string): number {
  return events.filter((e) => e.localDate === localDate).reduce((n, e) => n + e.xp, 0);
}

/** XP per week for the last `weeks` weeks, oldest first, ending with the week of `today`. */
export function xpByWeek(events: readonly PracticeEvent[], today: string, weeks = 12, startsOn: WeekStartsOn = "monday"): { week: string; xp: number }[] {
  const current = weekStart(today, startsOn);
  return Array.from({ length: weeks }, (_, i) => {
    const week = addLocalDays(current, -7 * (weeks - 1 - i));
    return { week, xp: weekXp(events, week) };
  });
}

/** XP a take earned (take_saved and retake), for the saved toast. */
export function takeXp(events: readonly PracticeEvent[], attemptId: string): number {
  return events.filter((e) => e.attemptId === attemptId && (e.kind === "take_saved" || e.kind === "retake")).reduce((n, e) => n + e.xp, 0);
}
