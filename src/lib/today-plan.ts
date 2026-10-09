/**
 * Today's plan from real data (plan 4.12): the daily focus and the weekly new
 * topic rotate through the bundled curriculum by date (a fixed, visible rule,
 * not a judgement of your recordings), the last session and its takeaway come
 * from your sessions, and the phrase to review is your next due phrase.
 */
import { PROMPTS } from "@/content/prompts";
import type { PhraseCard, ProgressSummary, ProgressView, SessionDetail, SessionLength, SessionSummary, TodayPlan } from "./ipc/schemas";

export const PLAN_STEPS: Record<SessionLength, TodayPlan["steps"]> = {
  standard: [
    { exerciseType: "repeat", title: "Record and repeat", minutes: 6 },
    { exerciseType: "thought_groups", title: "Thought groups", minutes: 2 },
    { exerciseType: "imitate", title: "Listen and imitate", minutes: 3 },
    { exerciseType: "expression", title: "Expression practice", minutes: 2 },
  ],
  short: [{ exerciseType: "repeat", title: "Record and repeat, two short takes", minutes: 5 }],
};

/** One focus per day, in a fixed order. */
export const DAILY_FOCUSES = [
  "State your point before explaining it.",
  "Pause between ideas instead of filling the gap.",
  "Give one concrete example.",
  "Finish each answer with a clear ending.",
  "Slow down a little on the important words.",
] as const;

/** Days since 1970-01-01 for a YYYY-MM-DD local date (no timezone drift). */
export function dayNumber(localDate: string): number {
  const [y, m, d] = localDate.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

export function buildTodayPlan({ localDate, length, sessions, phrases, latest }: {
  localDate: string;
  length: SessionLength;
  sessions: SessionSummary[];
  phrases: PhraseCard[];
  /** Details of the newest session, for its takeaway or note. */
  latest: SessionDetail | null;
}): TodayPlan {
  const day = dayNumber(localDate);
  const unfamiliar = PROMPTS.filter((p) => p.conditions.familiarity === "unfamiliar");
  // Monday-based weeks: 1970-01-01 was a Thursday.
  const week = Math.floor((day + 3) / 7);
  const topic = unfamiliar[week % unfamiliar.length];
  // Native sessions stay "in progress" after their takes are saved; any session with takes counts.
  const lastCompleted = sessions.find((s) => s.status === "completed") ?? sessions.find((s) => s.status !== "interrupted" && s.attemptCount > 0) ?? null;
  const reflection = latest && lastCompleted && latest.id === lastCompleted.id ? (latest.takeaway?.trim() || latest.notes.trim() || null) : null;
  const due = phrases.filter((p) => p.dueDate <= localDate).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] ?? null;
  return {
    localDate,
    focus: DAILY_FOCUSES[day % DAILY_FOCUSES.length],
    focusReason: "Today's focus in the curriculum's daily rotation. It's a suggestion: keep your own if you have one.",
    length,
    steps: PLAN_STEPS[length],
    resumable: null,
    lastCompleted,
    recentReflection: reflection,
    duePhrase: due,
    weekly: {
      newSituation: {
        promptId: topic.id,
        text: topic.text,
        familiarity: "unfamiliar",
        reason: "This week's new topic from the curriculum, so you also practise speaking without rehearsal.",
      },
      realConversation: { task: "Explain a recent decision to someone and ask what they understood.", done: false },
    },
  };
}

/**
 * Progress from real sessions (plan 4.16, first part): rehearsed and unfamiliar
 * practice are kept apart by each session's task conditions; ease is your own
 * rating. Pace is the Estimated pace of the session's latest transcribed take
 * that has one; otherwise unavailable (null, never 0). Real conversations
 * arrive with 4.17.
 */
export function buildProgress(view: ProgressView, details: SessionDetail[], paces: Record<string, number | null> = {}): ProgressSummary {
  const familiarity = view === "rehearsed" ? "familiar" : view === "unfamiliar" ? "unfamiliar" : null;
  const subset = familiarity === null ? [] : details.filter((s) => s.status !== "interrupted" && s.attempts.length > 0 && s.conditions?.familiarity === familiarity);
  const ordered = [...subset].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const withTakeaway = [...ordered].reverse().find((s) => s.takeaway?.trim());
  return {
    view,
    practiceMinutes: Math.round(subset.reduce((n, s) => n + s.durationMs, 0) / 60_000),
    completedSessions: subset.length,
    points: ordered.map((s) => ({ date: s.localDate, sessionId: s.id, estimatedPaceWpm: paces[s.id] ?? null, ease: s.ease ?? null })),
    highlight: withTakeaway ? { sessionId: withTakeaway.id, title: withTakeaway.title, improvement: withTakeaway.takeaway!.trim(), listenerFeedback: null } : null,
  };
}
