/**
 * Shared types of the game layer (roadmap M9, D-29). Everything here is earned
 * from practice evidence and your own notes, never from AI feedback, and never
 * grades how you sound.
 */
export const AREA_IDS = ["structure", "fluency", "voice", "spontaneity", "vocabulary", "listening", "storytelling", "courage"] as const;
export type AreaId = (typeof AREA_IDS)[number];

export type EvidenceRef = { kind: "session" | "take" | "transfer" | "phrase" | "activity" | "exposure" | "conversation"; id: string; date: string };

/** What brings a criterion that can't progress yet. */
export type Fix = "transcription" | "review" | "drills" | "learning" | "confidence" | "partner" | "events" | null;

export type CriterionProgress = {
  met: boolean;
  done: number;
  needed: number;
  label: string;
  /** A second requirement, e.g. "on 1 of 2 days". */
  days: { done: number; needed: number; unit: "days" | "weeks" } | null;
  evidence: EvidenceRef[];
  unavailable: { reason: string; fix: Fix } | null;
};

export type LevelState = "reached" | "ready" | "in_progress" | "not_started";
export type LevelStatus = {
  level: 1 | 2 | 3 | 4 | 5;
  name: string;
  state: LevelState;
  reachedAt: string | null;
  criteria: CriterionProgress[];
};
export type AreaStatus = { area: AreaId; current: 0 | 1 | 2 | 3 | 4 | 5; levels: LevelStatus[]; next: LevelStatus | null };
