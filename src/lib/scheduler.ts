/**
 * Rules-based scheduler (plan 4.18, blueprint §7). Every recommendation comes
 * with a short, visible reason and can be overridden; nothing here is a score
 * or a level awarded by the app. Rules:
 *
 * - Stages follow §7 "Progression beyond the first four weeks". Advancement is
 *   offered after three unfamiliar sessions at the current stage (any session
 *   at stage 1) on at least two days, when your own ease rating says the
 *   latest was manageable (3+).
 *   Missing ratings mean "not enough evidence", never failure.
 * - A hard session (ease 1–2) pauses any offer of more difficulty.
 * - After three sessions with the same focus, ask whether it is still useful.
 * - Three sessions of the same exercise, or the same prompt, suggest variety.
 */
import type { PracticePrompt, SessionDetail } from "./ipc/schemas";

export type Stage = { stage: number; title: string; demand: string; matches: (p: PracticePrompt) => boolean };

export const STAGES: Stage[] = [
  { stage: 1, title: "Clear explanation", demand: "Main point and one supporting example on a familiar topic",
    matches: (p) => p.conditions.familiarity === "familiar" && p.conditions.targetSeconds <= 90 && !p.conditions.followUp },
  { stage: 2, title: "Unfamiliar explanation", demand: "A new question with less rehearsal and limited preparation",
    matches: (p) => p.conditions.familiarity === "unfamiliar" && !p.conditions.audience && !p.conditions.followUp && p.conditions.targetSeconds <= 120 },
  { stage: 3, title: "Audience adaptation", demand: "The same kind of explanation for a named listener",
    matches: (p) => p.conditions.familiarity === "unfamiliar" && !!p.conditions.audience && !p.conditions.followUp },
  { stage: 4, title: "Extended expression", demand: "Two minutes or more with sequence, precision and detail",
    matches: (p) => p.conditions.targetSeconds >= 120 && !p.conditions.followUp },
  { stage: 5, title: "Interaction practice", demand: "Answer a follow-up question and adjust",
    matches: (p) => p.conditions.followUp },
];

export type ProgressionEvent = { kind: "advance" | "easier" | "stay"; stageFrom: number; stageTo: number; reason: string; createdAt: string };

export type Suggestion = { text: string; reason: string };

export type Schedule = {
  stage: Stage;
  /** An offer to try the next stage, or why there is none yet. */
  offer: { to: Stage; reason: string } | null;
  evidence: string;
  /** Your own focus when it should carry over, else null (the daily rotation applies). */
  focus: { text: string; reason: string; recurring: boolean } | null;
  suggestions: Suggestion[];
};

export function currentStage(events: ProgressionEvent[]): Stage {
  const latest = [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
  return STAGES.find((s) => s.stage === latest?.stageTo) ?? STAGES[0];
}

const EXERCISE_NAMES: Record<string, string> = { repeat: "Record and repeat", thought_groups: "Thought groups", imitate: "Listen and imitate", expression: "Expression practice" };

/**
 * `recent` is your recent sessions with takes, newest first. `prompts` resolves
 * a session's prompt to its task demands.
 */
export function schedule({ recent, events, prompts }: { recent: SessionDetail[]; events: ProgressionEvent[]; prompts: PracticePrompt[] }): Schedule {
  const stage = currentStage(events);
  const since = [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1)?.createdAt ?? "";
  const byId = new Map(prompts.map((p) => [p.id, p]));
  const atStage = recent.filter((s) => {
    const p = s.contentId ? byId.get(s.contentId) : undefined;
    // Stage 1 is rehearsed explanation; from stage 2 on only unfamiliar tasks count.
    return !!p && stage.matches(p) && (stage.stage === 1 || s.conditions?.familiarity === "unfamiliar") && s.startedAt > since;
  });
  const days = new Set(atStage.map((s) => s.localDate)).size;
  const latest = recent[0];
  const next = STAGES.find((s) => s.stage === stage.stage + 1);
  const kind = stage.stage === 1 ? "" : "unfamiliar ";
  const evidence = `${atStage.length} ${kind}${atStage.length === 1 ? "session" : "sessions"} at this stage on ${days} ${days === 1 ? "day" : "days"} since it started.`;
  const suggestions: Suggestion[] = [];

  let offer: Schedule["offer"] = null;
  const strained = latest?.ease != null && latest.ease <= 2;
  if (strained) {
    suggestions.push({
      text: "Keep today's demand the same, or choose the short plan.",
      reason: `Your last session felt hard (${latest.ease} of 5). More difficulty can wait; a poor recording day is not a result.`,
    });
  } else if (next && atStage.length >= 3 && days >= 2) {
    const rated = atStage[0].ease ?? null;
    if (rated !== null && rated >= 3) {
      offer = { to: next, reason: `${evidence} Your latest one felt manageable (${rated} of 5). The next stage adds one demand: ${next.demand.toLowerCase()}.` };
    } else if (rated === null) {
      suggestions.push({ text: "Rate how easy your next unfamiliar session felt.", reason: `${evidence} A rating of how manageable it felt is needed before suggesting more difficulty; a missing rating is not a failure.` });
    }
  }

  // The same focus three times in a row: still useful?
  const focuses = recent.slice(0, 3).map((s) => s.focus?.trim().toLowerCase() ?? "");
  let focus: Schedule["focus"] = null;
  if (latest?.focus?.trim()) {
    const recurring = focuses.length === 3 && focuses.every((f) => f && f === focuses[0]);
    focus = recurring
      ? { text: latest.focus.trim(), recurring, reason: "You chose this focus in your last three sessions. Keep it if it is still useful, or pick a new one in the session." }
      : { text: latest.focus.trim(), recurring, reason: "The focus you chose in your last session." };
  }

  const types = recent.slice(0, 3).map((s) => s.exerciseType);
  if (types.length === 3 && types[0] && types.every((t) => t === types[0])) {
    suggestions.push({ text: "Try a different exercise today.", reason: `Your last three sessions were all ${EXERCISE_NAMES[types[0]] ?? types[0]}. Today's sequence mixes in the others.` });
  }
  const contents = recent.slice(0, 3).map((s) => s.contentId ?? null);
  if (contents.length === 3 && contents[0] && contents.every((c) => c === contents[0])) {
    suggestions.push({ text: "Answer this week's new situation instead of the same prompt.", reason: "You answered the same prompt in your last three sessions; a new one checks how it transfers." });
  }

  return { stage, offer, evidence, focus, suggestions };
}

/** This week's new-situation prompt at the current stage, rotating weekly. */
export function stagePrompt(stage: Stage, prompts: PracticePrompt[], week: number): PracticePrompt | null {
  const fitting = prompts.filter((p) => p.source === "bundled" && stage.matches(p));
  return fitting.length ? fitting[week % fitting.length] : null;
}
