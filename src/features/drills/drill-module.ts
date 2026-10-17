import type { FC, ReactNode } from "react";
import type { DrillDef } from "@/content/drills";
import type { DrillType, Familiarity, PracticePrompt, TakeMarkKind } from "@/lib/ipc/schemas";

/**
 * The drill contract (roadmap 10.1): a drill is a pure, deterministic plan
 * plus up to three views. The studio owns the recorder, the clock, marks and
 * saving, so every drill gets the same audio safety (P-9, A-31).
 */
export type ParamValue = string | number | boolean | string[];
export type DrillParams = Record<string, ParamValue>;

export type DrillRound = {
  index: number;
  /** The take's step key: lowercase letters, digits, `_` or `-`. */
  key: string;
  /** The content item this round used (a topic, a prompt, a sentence). */
  promptId: string | null;
  prompt: string;
  thinkSeconds: number;
  /** Null: open-ended, you stop the round. */
  speakSeconds: number | null;
  familiarity: Familiarity;
  audience?: string | null;
  followUp?: boolean;
  /** Extra seconds after the limit before the take stops (topic roulette's grace). */
  graceSeconds?: number;
  /** Timing lights at 2/3, 11/12 and the full time (topic roulette). */
  lights?: boolean;
  /** Shown with the prompt: tips, a STAR card, structure cards. */
  card?: ReactNode;
  /** A short line under the prompt. */
  hint?: string;
};

export type DrillPlan = {
  drill: DrillDef;
  seed: string;
  /** Stored with the session (7.3): what the native results need to recompute. Keys, numbers and short strings. */
  params: DrillParams;
  groupId: string | null;
  /** One prompt for the whole session; each take's own prompt is its step. */
  sessionPrompt: string;
  contentId: string | null;
  rounds: DrillRound[];
};

export type DrillTake = { round: DrillRound; attemptId: string; durationMs: number };
export type PlanContext = { prompts: PracticePrompt[]; today: string };
export type Mark = { kind: TakeMarkKind; data?: Record<string, string | number | boolean> };

export interface DrillModule {
  /** Pure: the same seed and params always give the same plan. */
  plan(seed: string, params: DrillParams, ctx: PlanContext): DrillPlan;
  /** Before the first round: spin, roll, pick a side. Calls `onReady` with the final plan. */
  Setup?: FC<{ plan: DrillPlan; ctx: PlanContext; onReady: (plan: DrillPlan) => void }>;
  /** Inside the recorder while a round is ready or speaking. */
  Live?: FC<{ plan: DrillPlan; round: DrillRound; speaking: boolean; elapsedMs: number; mark: (m: Mark) => void }>;
  /** After the last round. Reads each take's result. */
  Result: FC<{ plan: DrillPlan; takes: DrillTake[]; sessionId: string }>;
  /** Single-round drills offer "Same topic" (another take in this session). */
  repeatable?: boolean;
  /** The plan comes from the date alone (the daily prompt): no "new topic". */
  fixedPlan?: boolean;
  /** A session shared by every play of the plan (one daily session a day); otherwise each play is new. */
  sessionId?: (plan: DrillPlan) => string;
}

/** One chunk per drill, loaded when you open it. */
export const DRILL_MODULES: Record<DrillType, () => Promise<DrillModule>> = {
  jam: () => import("./modules/jam").then((m) => m.default),
  roulette: () => import("./modules/roulette").then((m) => m.default),
  word_bomb: () => import("./modules/word-bomb").then((m) => m.default),
  three_ways: () => import("./modules/three-ways").then((m) => m.default),
  emphasis: () => import("./modules/emphasis").then((m) => m.default),
  pace_ladder: () => import("./modules/pace-ladder").then((m) => m.default),
  story_spine: () => import("./modules/story-spine").then((m) => m.default),
  story_cubes: () => import("./modules/story-cubes").then((m) => m.default),
  pitch: () => import("./modules/pitch").then((m) => m.default),
  steelman: () => import("./modules/steelman").then((m) => m.default),
  daily: () => import("./modules/daily").then((m) => m.default),
  gauntlet: () => import("./modules/gauntlet").then((m) => m.default),
  boss: () => import("./modules/boss").then((m) => m.default),
};
