import { programmeById, weekFocus, type ProgrammeDef, type ProgrammeStep, type StepDetector } from "@/content/programmes";
import { addLocalDays } from "@/lib/phrase-schedule";
import type { PracticeEvent, PracticeFacts, ProgrammeRun } from "@/lib/ipc/schemas";
import { speechMs } from "@/lib/engagement/criteria";
import { drillPlays } from "@/lib/engagement/drills";

/**
 * Guided programmes (roadmap 11.6): which steps are done this week, when a
 * week can move on, and the step to suggest next. Steps count practice since
 * the week started; a week moves on after three steps or seven days, and you
 * can always repeat it or move on yourself. Nothing is ever failed.
 */
export const WEEK_DAYS = 7;
export const STEPS_TO_ADVANCE = 3;

export type StepStatus = { step: ProgrammeStep; done: number; needed: number; met: boolean; ticked: boolean; auto: boolean };

/** How far a detected step is, from practice since `since` (a local date). */
export function detectStep(detect: StepDetector, facts: PracticeFacts, events: readonly PracticeEvent[], since: string): { done: number; needed: number } {
  const sessions = new Map(facts.sessions.map((s) => [s.id, s]));
  switch (detect.kind) {
    case "catch": {
      const takes = facts.takes.filter((t) => t.catchRuns.some((r) => r.localDate >= since) && (!detect.newTakes || t.localDate >= since));
      return { done: takes.length, needed: detect.atLeast };
    }
    case "reviewed":
      return { done: events.filter((e) => e.kind === "transcript_reviewed" && e.localDate >= since).length, needed: detect.atLeast };
    case "focus": {
      const takes = facts.takes.filter((t) => {
        const s = sessions.get(t.sessionId);
        return !!s && t.localDate >= since && s.focus === detect.focus && s.familiarity === detect.familiarity && speechMs(t) >= (detect.minSpeechMs ?? 0);
      });
      // One per session: three answers means three sessions, not three retakes of one.
      return { done: new Set(takes.map((t) => t.sessionId)).size, needed: detect.atLeast };
    }
    case "drill":
      return { done: drillPlays(facts, detect.type).filter((p) => p.takes.some((t) => t.localDate >= since)).length, needed: detect.atLeast };
    case "reflections":
      return { done: facts.transferReviews.filter((r) => r.localDate >= since && (!detect.nextFocus || r.hasNextFocus)).length, needed: detect.atLeast };
  }
}

/** Every step of the run's current week, with what was done and what you ticked. */
export function weekStatus(def: ProgrammeDef, run: ProgrammeRun, facts: PracticeFacts, events: readonly PracticeEvent[]): StepStatus[] {
  const week = def.weeks.find((w) => w.week === run.week) ?? def.weeks[0];
  // Only steps done since the week (re)started count, so Repeat this week starts it afresh.
  const since = Date.parse(run.weekStartedAt);
  const ticked = new Set(run.steps.filter((s) => Date.parse(s.doneAt) >= since).map((s) => s.stepId));
  return week.steps.map((step) => {
    const found = step.detect ? detectStep(step.detect, facts, events, run.weekStartedDate) : { done: 0, needed: 1 };
    const isTicked = ticked.has(step.id);
    return { step, done: Math.min(found.done, found.needed), needed: found.needed, met: isTicked || found.done >= found.needed, ticked: isTicked, auto: !!step.detect };
  });
}

/** Steps that met their detector and aren't stored yet: the provider records them. */
export function newlyDetected(def: ProgrammeDef, run: ProgrammeRun, facts: PracticeFacts, events: readonly PracticeEvent[]): string[] {
  return weekStatus(def, run, facts, events).filter((s) => s.auto && s.met && !s.ticked).map((s) => s.step.id);
}

/** Whether the week can move on: three steps done, or seven days since it started. */
export function canAdvance(def: ProgrammeDef, run: ProgrammeRun, facts: PracticeFacts, events: readonly PracticeEvent[], today: string): { ready: boolean; reason: string | null } {
  const done = weekStatus(def, run, facts, events).filter((s) => s.met).length;
  if (done >= STEPS_TO_ADVANCE) return { ready: true, reason: `You've done ${done} steps this week.` };
  if (addLocalDays(run.weekStartedDate, WEEK_DAYS) <= today) return { ready: true, reason: "A week has passed. Move on, or repeat this week if you'd like more time." };
  return { ready: false, reason: null };
}

export function programmeOf(run: ProgrammeRun | null | undefined): ProgrammeDef | null {
  return run ? (programmeById(run.programme) ?? null) : null;
}

/** The programme's focus this week, for the Studio's suggestion; null in week 1 or with no programme. */
export function programmeFocus(run: ProgrammeRun | null | undefined): string | null {
  return weekFocus(run)?.text ?? null;
}

/** The next step to suggest: the first one not met this week. */
export function nextStep(def: ProgrammeDef, run: ProgrammeRun, facts: PracticeFacts, events: readonly PracticeEvent[]): StepStatus | null {
  return weekStatus(def, run, facts, events).find((s) => !s.met) ?? null;
}
