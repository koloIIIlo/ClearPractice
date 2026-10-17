import { PASSAGES } from "@/content/passages";
import { PROMPTS } from "@/content/prompts";
import type { SessionLength, TodayPlan } from "@/lib/ipc/schemas";
import { EXERCISE_IDS } from "@/content/exercises";

type PlanStep = TodayPlan["steps"][number];

/**
 * Today's practice sequence (plan 4.10): the 13- or 5-minute plan walked step
 * by step through the Studio. Progress is a per-device convenience kept in
 * local storage; the takes themselves are saved as sessions as usual.
 */
export type SequenceState = {
  localDate: string;
  length: SessionLength;
  steps: PlanStep[];
  index: number;
  /** Sessions that got at least one take, in order. */
  sessionIds: string[];
};

const KEY = "clearpractice.sequence.v1";

export function loadSequence(localDate: string): SequenceState | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const state = JSON.parse(raw) as SequenceState;
    // Yesterday's unfinished sequence is not resumed: each day starts fresh.
    return state.localDate === localDate && state.index < state.steps.length ? state : null;
  } catch {
    return null;
  }
}

export function saveSequence(state: SequenceState | null) {
  try {
    if (state) window.localStorage.setItem(KEY, JSON.stringify(state));
    else window.localStorage.removeItem(KEY);
  } catch {
    // Storage can be unavailable; the sequence then simply cannot be resumed.
  }
}

/** Stable per-day choice, so a resumed step shows the same content. */
function pick<T>(items: T[], localDate: string, salt: number): T {
  const day = Math.floor(Date.parse(`${localDate}T00:00:00Z`) / 86_400_000);
  return items[(((day + salt) % items.length) + items.length) % items.length];
}

/** Where a step opens in the Studio, with the day's content. */
export function stepUrl(step: PlanStep, localDate: string, firstPromptId?: string): string {
  switch (step.exerciseType) {
    case "repeat":
      return `/practice/${EXERCISE_IDS.repeat}?prompt=${firstPromptId ?? pick(PROMPTS, localDate, 0).id}&seq=1`;
    case "thought_groups":
      return `/practice/${EXERCISE_IDS.thoughtGroups}?passage=${pick(PASSAGES, localDate, 3).id}&seq=1`;
    case "imitate":
      return `/practice/${EXERCISE_IDS.imitate}?seq=1`;
    case "expression":
      return `/practice/${EXERCISE_IDS.expression}?seq=1`;
    default:
      // Drills (M10) open in the drill studio.
      return `/drill/${step.exerciseType.replace(/_/g, "-")}?seq=1`;
  }
}

export function startSequence(localDate: string, length: SessionLength, steps: PlanStep[]): SequenceState {
  const state = { localDate, length, steps, index: 0, sessionIds: [] };
  saveSequence(state);
  return state;
}

/** Records this step's session (if it got a take) and moves on; past the last step the sequence ends. */
export function advanceSequence(state: SequenceState, sessionId: string, hadTake: boolean): SequenceState {
  const sessionIds = hadTake && !state.sessionIds.includes(sessionId) ? [...state.sessionIds, sessionId] : state.sessionIds;
  const next = { ...state, index: state.index + 1, sessionIds };
  saveSequence(next.index < next.steps.length ? next : null);
  return next;
}
