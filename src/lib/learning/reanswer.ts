import { BASELINE_PROMPT } from "@/content/prompts";
import { addLocalDays } from "@/lib/phrase-schedule";
import type { FactSession, PracticeEvent, PracticeFacts } from "@/lib/ipc/schemas";

/**
 * Spaced re-answering (roadmap 11.1): answer the same question again 1, 7 and
 * 30 days after your first answer, then hear the difference. Spaced practice
 * beats massed practice (Cepeda et al. 2006), retrieval strengthens memory
 * (Roediger & Karpicke 2006), and task repetition supports fluency (§7).
 */
export const REANSWER_DAYS = [1, 7, 30] as const;
export type ReanswerStep = (typeof REANSWER_DAYS)[number];
export type Reanswer = {
  promptId: string;
  promptText: string;
  firstSessionId: string;
  firstAttemptId: string;
  firstDate: string;
  step: ReanswerStep;
  dueDate: string;
  overdueDays: number;
};

const dayIndex = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);

/** Sessions that answer a prompt of the pack or your own: not the baseline, not drills, not phrase practice. */
function promptSessions(facts: PracticeFacts, prompts: ReadonlyMap<string, string>): Map<string, FactSession[]> {
  const out = new Map<string, FactSession[]>();
  for (const s of facts.sessions) {
    if (s.takeCount === 0 || !s.contentId || !prompts.has(s.contentId)) continue;
    if (s.contentId === BASELINE_PROMPT.id || s.tags.includes("baseline")) continue;
    if (s.exerciseType !== "repeat" || s.activity) continue;
    const list = out.get(s.contentId);
    if (list) list.push(s);
    else out.set(s.contentId, [s]);
  }
  return out;
}

/**
 * Prompts whose next re-answer is due today or earlier, most overdue first.
 * The step due is the latest one whose date has come; it is done when you
 * answered the prompt again on or after that date, and a step you skipped
 * ("Not this one") never returns.
 */
export function dueReanswers(facts: PracticeFacts, events: readonly PracticeEvent[], today: string, prompts: readonly { id: string; text: string }[]): Reanswer[] {
  const texts = new Map(prompts.map((p) => [p.id, p.text]));
  const skipped = new Set(events.filter((e) => e.kind === "reanswer_skipped").map((e) => e.refId));
  const firstTake = new Map<string, string>();
  for (const t of facts.takes) if (!firstTake.has(t.sessionId)) firstTake.set(t.sessionId, t.id);
  const due: Reanswer[] = [];
  for (const [promptId, sessions] of promptSessions(facts, texts)) {
    const ordered = [...sessions].sort((a, b) => a.localDate.localeCompare(b.localDate) || a.startedAt.localeCompare(b.startedAt));
    const first = ordered[0];
    const step = [...REANSWER_DAYS].reverse().find((d) => addLocalDays(first.localDate, d) <= today);
    if (!step) continue;
    const dueDate = addLocalDays(first.localDate, step);
    const answered = ordered.some((s) => s.localDate >= dueDate);
    const attempt = firstTake.get(first.id);
    if (answered || skipped.has(`${promptId}:${step}`) || !attempt) continue;
    due.push({ promptId, promptText: texts.get(promptId)!, firstSessionId: first.id, firstAttemptId: attempt, firstDate: first.localDate, step, dueDate, overdueDays: dayIndex(today) - dayIndex(dueDate) });
  }
  return due.sort((a, b) => b.overdueDays - a.overdueDays || a.promptId.localeCompare(b.promptId));
}

/** "you first answered 7 days ago" */
export function answeredAgo(r: Pick<Reanswer, "firstDate">, today: string): string {
  const days = dayIndex(today) - dayIndex(r.firstDate);
  return days === 1 ? "you first answered yesterday" : `you first answered ${days} days ago`;
}
