import type { FactSession, FactTake, NewRecord, PracticeFacts, RecordRow } from "@/lib/ipc/schemas";
import { metricOf, speechMs } from "./criteria";

/**
 * Personal bests against your own past (roadmap 9.7, appendix B.4). The first
 * eligible value is stored silently as the starting point; ties are not new.
 * The filler record is low-key: a toast at most, never a card, so fewer
 * hesitations never becomes a target (blueprint §7).
 */
export const RECORDS_VERSION = 1;

export type RecordDef = {
  id: string;
  title: string;
  unit: string;
  better: "higher" | "lower";
  source: "measured" | "estimated";
  format: (v: number) => string;
  eligible: (t: FactTake, s: FactSession) => boolean;
  value: (t: FactTake, s: FactSession) => number | null;
  celebrate: "card" | "toast";
};

const firstUnfamiliar = (t: FactTake, s: FactSession) => s.familiarity === "unfamiliar" && t.ordinal === 1;
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;

export const RECORDS: readonly RecordDef[] = [
  { id: "longest_take", title: "Longest take", unit: "s", better: "higher", source: "measured", format: clock,
    eligible: () => true, value: (t) => Math.round(speechMs(t) / 100) / 10, celebrate: "card" },
  { id: "longest_run", title: "Longest run", unit: "words", better: "higher", source: "estimated", format: (v) => `${v} words`,
    eligible: (t) => t.transcribed, value: (t) => metricOf(t, "longestRun"), celebrate: "card" },
  { id: "mean_run_unfamiliar", title: "Longest mean run, unfamiliar topic", unit: "words", better: "higher", source: "estimated", format: (v) => `${v} words`,
    eligible: (t, s) => firstUnfamiliar(t, s) && speechMs(t) >= 45_000, value: (t) => metricOf(t, "meanRun"), celebrate: "card" },
  { id: "different_per_50", title: "Widest vocabulary", unit: "words in 50", better: "higher", source: "estimated", format: (v) => `${Math.round(v)} in every 50`,
    eligible: (t) => (t.words ?? 0) >= 100, value: (t) => metricOf(t, "differentPer50"), celebrate: "toast" },
  { id: "fewest_confirmed_per_100_unfamiliar", title: "Fewest confirmed hesitations, unfamiliar topic", unit: "per 100 words", better: "lower", source: "estimated",
    format: (v) => `${v.toFixed(1)} per 100 words`, eligible: (t, s) => firstUnfamiliar(t, s) && speechMs(t) >= 60_000 && t.fillersReviewed,
    value: (t) => { const v = metricOf(t, "confirmedPer100"); return v == null ? null : Math.round(v * 10) / 10; }, celebrate: "toast" },
  { id: "phrases_in_one_take", title: "Most saved phrases in one take", unit: "phrases", better: "higher", source: "estimated", format: (v) => `${v} phrases`,
    eligible: (t) => t.transcribed && t.phraseIds.length > 0, value: (t) => t.phraseIds.length, celebrate: "toast" },
];

export const recordDef = (id: string) => RECORDS.find((r) => r.id === id);

/** The current best of each record: its newest stored row. */
export function bests(stored: readonly RecordRow[]): Map<string, RecordRow> {
  const out = new Map<string, RecordRow>();
  for (const row of stored) out.set(row.record, row);
  return out;
}

/**
 * Each record's best eligible take, when it beats the stored best (or as the
 * silent starting point when nothing is stored). The native core checks again.
 */
export function newRecords(facts: PracticeFacts, stored: readonly RecordRow[]): NewRecord[] {
  const sessions = new Map(facts.sessions.map((s) => [s.id, s]));
  const current = bests(stored);
  const out: NewRecord[] = [];
  for (const def of RECORDS) {
    let best: { value: number; take: FactTake } | null = null;
    for (const take of facts.takes) {
      const session = sessions.get(take.sessionId);
      if (!session || !def.eligible(take, session)) continue;
      const value = def.value(take, session);
      if (value == null || !Number.isFinite(value) || value < 0) continue;
      if (!best || (def.better === "higher" ? value > best.value : value < best.value)) best = { value, take };
    }
    if (!best) continue;
    const stored = current.get(def.id);
    if (stored && (def.better === "higher" ? best.value <= stored.value : best.value >= stored.value)) continue;
    out.push({ record: def.id, value: best.value, unit: def.unit, attemptId: best.take.id, sessionId: best.take.sessionId, definitionVersion: RECORDS_VERSION });
  }
  return out;
}
