import { BASELINE_PROMPT } from "@/content/prompts";
import { daysBetween } from "@/lib/events/plan";
import type { FactTake, PracticeFacts, PracticePrompt } from "@/lib/ipc/schemas";

/**
 * The voice time capsule (roadmap 14.5): "you versus you". Once a month you
 * answer the same question as your first recording, then listen to the first
 * and the latest side by side. Nothing is judged; the measures sit next to
 * each other.
 */
export const CAPSULE_DAYS = 7;

/** A month's offer as stored: the first app day it was offered, and whether you dismissed it. */
export type CapsuleMonth = { offeredOn: string; dismissed: boolean };

/** Offered from the first app day of a month for seven days, until it is done or dismissed. */
export function capsuleShows(month: CapsuleMonth, today: string, done: boolean): boolean {
  return !done && !month.dismissed && today.slice(0, 7) === month.offeredOn.slice(0, 7) && daysBetween(month.offeredOn, today) < CAPSULE_DAYS;
}

/**
 * The capsule's question: your baseline prompt (4.19), else the first prompt
 * you ever answered, with the first take you recorded for it.
 */
export function capsulePrompt(facts: Pick<PracticeFacts, "sessions" | "takes">, prompts: readonly PracticePrompt[]): { promptId: string; text: string; firstTake: FactTake | null } | null {
  const known = new Map([BASELINE_PROMPT, ...prompts].map((p) => [p.id, p]));
  const answered = facts.sessions
    .filter((s) => s.takeCount > 0 && s.exerciseType !== "capsule" && !!s.contentId && known.has(s.contentId))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const start = answered.find((s) => s.tags.includes("baseline") || s.contentId === BASELINE_PROMPT.id) ?? answered[0];
  if (!start) return null;
  const prompt = known.get(start.contentId!)!;
  const sameQuestion = new Set(facts.sessions.filter((s) => s.contentId === prompt.id).map((s) => s.id));
  const firstTake = facts.takes.filter((t) => sameQuestion.has(t.sessionId)).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0] ?? null;
  return { promptId: prompt.id, text: prompt.text, firstTake };
}

/** Your capsules, one per month (the first take of the month's first capsule), oldest first. */
export function capsuleMonths(facts: Pick<PracticeFacts, "sessions" | "takes">): { month: string; take: FactTake }[] {
  const capsules = new Set(facts.sessions.filter((s) => s.exerciseType === "capsule" && s.takeCount > 0).map((s) => s.id));
  const byMonth = new Map<string, FactTake>();
  for (const take of [...facts.takes].filter((t) => capsules.has(t.sessionId)).sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const month = take.localDate.slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, take);
  }
  return [...byMonth].map(([month, take]) => ({ month, take }));
}
