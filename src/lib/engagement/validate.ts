import type { UnlockInput } from "@/lib/ipc/schemas";
import { AREA_IDS } from "./types";

/**
 * The browser preview's copy of the native checks on unlocks (roadmap 9.3).
 * The native core is authoritative in the desktop app; this keeps the mock
 * from accepting what the desktop would refuse. Messages match the Rust ones.
 */
export const RECORD_UNITS: Record<string, { unit: string; lowerIsBetter: boolean }> = {
  longest_take: { unit: "s", lowerIsBetter: false },
  longest_run: { unit: "words", lowerIsBetter: false },
  mean_run_unfamiliar: { unit: "words", lowerIsBetter: false },
  different_per_50: { unit: "words in 50", lowerIsBetter: false },
  fewest_confirmed_per_100_unfamiliar: { unit: "per 100 words", lowerIsBetter: true },
  phrases_in_one_take: { unit: "phrases", lowerIsBetter: false },
  jam_clean_seconds: { unit: "s", lowerIsBetter: false },
  word_bomb_woven: { unit: "words", lowerIsBetter: false },
  pace_range: { unit: "syll/s", lowerIsBetter: false },
  emphasis_hits: { unit: "sentences", lowerIsBetter: false },
  gauntlet_rounds: { unit: "rounds", lowerIsBetter: false },
  conversation_turns: { unit: "turns", lowerIsBetter: false },
};

const ID = /^[A-Za-z0-9_-]{1,96}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG = /^[a-z0-9-]{2,40}$/;

/** IDs and numbers only, in arrays or objects, at most 4 KB (A-30). */
export function validEvidence(value: unknown, depth = 0): boolean {
  if (depth >= 6) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return ID.test(value) || DATE.test(value);
  if (Array.isArray(value)) return value.every((v) => validEvidence(v, depth + 1));
  if (typeof value === "object") return Object.entries(value as Record<string, unknown>).every(([k, v]) => /^[A-Za-z0-9_]{1,40}$/.test(k) && validEvidence(v, depth + 1));
  return false;
}

const evidenceOk = (value: unknown) => validEvidence(value) && JSON.stringify(value ?? {}).length <= 4096;

export function isWeekStart(week: string): boolean {
  if (!DATE.test(week)) return false;
  const [y, m, d] = week.split("-").map(Number);
  const day = new Date(y, m - 1, d).getDay();
  return day === 0 || day === 1;
}

/** Throws the same plain sentences as the native core; `levelsStored` lists "area:level" already stored. */
export function validateUnlockInput(input: UnlockInput, levelsStored: ReadonlySet<string>): void {
  if (!DATE.test(input.localDate)) throw new Error("Invalid date.");
  const present = new Set(levelsStored);
  for (const l of input.levels) {
    if (!(AREA_IDS as readonly string[]).includes(l.area)) throw new Error("Unknown skill area.");
    if (!Number.isInteger(l.level) || l.level < 1 || l.level > 5 || l.definitionVersion < 1) throw new Error("Levels go from 1 to 5.");
    if (!evidenceOk(l.evidence)) throw new Error("Evidence holds IDs and numbers only.");
    if (l.level > 1 && !present.has(`${l.area}:${l.level - 1}`)) throw new Error(`Level ${l.level} of ${l.area} comes after level ${l.level - 1}.`);
    present.add(`${l.area}:${l.level}`);
  }
  for (const a of input.achievements) {
    if (!SLUG.test(a.id) || a.id.length < 3 || a.definitionVersion < 1) throw new Error("Unknown achievement.");
    if (!evidenceOk(a.evidence)) throw new Error("Evidence holds IDs and numbers only.");
  }
  for (const r of input.records) {
    if (RECORD_UNITS[r.record]?.unit !== r.unit) throw new Error("Unknown personal record.");
    if (!Number.isFinite(r.value) || r.value < 0 || r.definitionVersion < 1) throw new Error("A record is a number of zero or more.");
    for (const id of [r.attemptId, r.sessionId]) if (id !== null && !ID.test(id)) throw new Error("Invalid recording identifier.");
  }
  for (const q of input.questsDone) {
    if (!isWeekStart(q.week)) throw new Error("A week starts on a Monday or a Sunday.");
    if (q.slot < 1 || q.slot > 3) throw new Error("A week has three quests.");
  }
  if (input.weeklyGoal !== null && !isWeekStart(input.weeklyGoal)) throw new Error("A week starts on a Monday or a Sunday.");
}
