import { addLocalDays } from "@/lib/phrase-schedule";
import { isDrillType, type DrillType, type ExerciseType, type FactSession, type FactTake, type PracticeFacts, type PromptTag, type SelfCheckId, type TransferFlow } from "@/lib/ipc/schemas";
import { DRILL_UNITS, drillPlays } from "./drills";
import type { CriterionProgress, EvidenceRef, Fix } from "./types";
import { weekStart } from "./weekly";

/**
 * The criteria DSL of the levels engine (roadmap 9.2, appendix A). Pure and
 * versioned with the definitions. Practice evidence only: there is no field
 * that reads AI feedback (A-29), and a metric never passes on a missing value.
 */

/** Numbers a take carries, plus derived values (`confirmedPer100`). No AI fields. */
export type NumericFactTakeKey =
  | "durationMs" | "speechSpanMs" | "words" | "paceWpm" | "fillerCandidates" | "fillersConfirmed" | "pausesOverThreshold"
  | "meanRun" | "longestRun" | "midClausePauses" | "boundaryPauses" | "watchPer100" | "hedgesPer100" | "differentPer50"
  | "pitchRangeSt" | "rateSps" | "confirmedPer100";

export type MetricValue = number | { baseline: "first5ReviewedMedian"; factor: number };

export type TakeFilter = {
  exercise?: ExerciseType[];
  stepKey?: string[];
  familiarity?: "familiar" | "unfamiliar";
  maxPrepSeconds?: number;
  minSpeechMs?: number;
  audience?: boolean;
  followUp?: boolean;
  tags?: string[];
  promptTags?: PromptTag[];
  noOutline?: boolean;
  transcribed?: boolean;
  fillersReviewed?: boolean;
  prosodyViewed?: boolean;
  check?: { id: SelfCheckId; value: boolean };
  metric?: { key: NumericFactTakeKey; op: "<=" | ">="; value: MetricValue };
  firstTakeOnly?: boolean;
};

export type SessionFilter = Omit<TakeFilter, "metric" | "check" | "stepKey" | "transcribed" | "fillersReviewed" | "prosodyViewed" | "firstTakeOnly"> & {
  minTakes?: number;
  outline?: ("point" | "reason" | "example")[];
  focusIn?: readonly string[];
};

export type Criterion =
  | { kind: "takes"; label: string; filter: TakeFilter; atLeast: number; distinctDays?: number }
  | { kind: "sessions"; label: string; filter: SessionFilter; atLeast: number; distinctDays?: number; distinct?: "focus" | "contentId" }
  | { kind: "transfers"; label: string; listenerWords?: boolean; noClarification?: boolean; flow?: TransferFlow[]; tags?: string[]; mission?: boolean; atLeast: number; distinctWeeks?: number }
  | { kind: "phrases"; label: string; saved?: number; reviews?: number; reviewDays?: number }
  | { kind: "phraseUses"; label: string; takes?: number; distinctPhrases?: number; unfamiliarOnly?: boolean }
  | { kind: "activity"; label: string; type: string; atLeast: number; distinctDays?: number; result?: { key: string; op: ">=" | "<="; value: number } }
  | { kind: "exposure"; label: string; steps: number; minBefore?: number }
  | { kind: "conversation"; label: string; minTurns: number; atLeast: number; minPressure?: 0 | 1 | 2 | 3 }
  | { kind: "listenerAnswers"; label: string; atLeast: number; mainPointAnswered?: boolean }
  | { kind: "debrief"; label: string; atLeast: number }
  | { kind: "anyOf"; label: string; options: Criterion[] }
  | { kind: "allOf"; label: string; parts: Criterion[] };

export type Baselines = { first5ReviewedMedian: Partial<Record<NumericFactTakeKey, number>>; reviewedTakes: number };
/** `promptTags`: each prompt ID's tags (from the content pack and your prompts). */
export type EvalContext = { today: string; baselines: Baselines; promptTags: Record<string, readonly PromptTag[]> };

const MAX_EVIDENCE = 10;
const BASELINE_TAKES = 5;
const NUMERIC_KEYS: readonly NumericFactTakeKey[] = [
  "durationMs", "speechSpanMs", "words", "paceWpm", "fillerCandidates", "fillersConfirmed", "pausesOverThreshold", "meanRun", "longestRun",
  "midClausePauses", "boundaryPauses", "watchPer100", "hedgesPer100", "differentPer50", "pitchRangeSt", "rateSps", "confirmedPer100",
];

/** A take's value for a key; derived values are null when their inputs are missing. */
export function metricOf(take: FactTake, key: NumericFactTakeKey): number | null {
  if (key === "confirmedPer100") {
    if (!take.fillersReviewed || take.fillersConfirmed == null || take.words == null || take.words < 20) return null;
    return (take.fillersConfirmed * 100) / take.words;
  }
  const value = take[key];
  return typeof value === "number" ? value : null;
}

/** Speech length: the estimated speech span when known, else the take's duration. */
export const speechMs = (take: FactTake) => take.speechSpanMs ?? take.durationMs;

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** Build the evaluation context; prompt tags come from the content pack and your prompts. */
export function evalContext(facts: PracticeFacts, today: string, prompts: { id: string; tags: readonly string[] }[]): EvalContext {
  return { today, baselines: computeBaselines(facts), promptTags: Object.fromEntries(prompts.map((p) => [p.id, p.tags])) as EvalContext["promptTags"] };
}

/** Your starting point: the median of each metric over your first five fully reviewed takes. */
export function computeBaselines(facts: PracticeFacts): Baselines {
  const reviewed = facts.takes.filter((t) => t.fillersReviewed).sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  const first = reviewed.slice(0, BASELINE_TAKES);
  const out: Partial<Record<NumericFactTakeKey, number>> = {};
  if (first.length === BASELINE_TAKES) {
    for (const key of NUMERIC_KEYS) {
      const values = first.map((t) => metricOf(t, key)).filter((v): v is number => v != null);
      if (values.length > 0) out[key] = median(values);
    }
  }
  return { first5ReviewedMedian: out, reviewedTakes: reviewed.length };
}

const progress = (label: string, done: number, needed: number, evidence: EvidenceRef[] = [], days: CriterionProgress["days"] = null): CriterionProgress => ({
  met: done >= needed && (!days || days.done >= days.needed),
  done: Math.min(done, needed),
  needed,
  label,
  days: days && { ...days, done: Math.min(days.done, days.needed) },
  evidence: evidence.slice(0, MAX_EVIDENCE),
  unavailable: null,
});

const unavailable = (label: string, needed: number, reason: string, fix: Fix, done = 0): CriterionProgress => ({
  met: false, done, needed, label, days: null, evidence: [], unavailable: { reason, fix },
});

function sessionMatches(s: FactSession, f: SessionFilter, ctx: EvalContext): boolean {
  if (f.exercise && !(s.exerciseType && f.exercise.includes(s.exerciseType))) return false;
  if (f.familiarity && s.familiarity !== f.familiarity) return false;
  if (f.maxPrepSeconds !== undefined && !(s.preparationSeconds != null && s.preparationSeconds <= f.maxPrepSeconds)) return false;
  if (f.audience !== undefined && s.audience !== f.audience) return false;
  if (f.followUp !== undefined && s.followUp !== f.followUp) return false;
  if (f.tags && !f.tags.some((tag) => s.tags.includes(tag))) return false;
  if (f.promptTags && !(s.contentId && f.promptTags.some((tag) => ctx.promptTags[s.contentId!]?.includes(tag)))) return false;
  if (f.noOutline && s.outline.some(Boolean)) return false;
  if (f.minTakes !== undefined && s.takeCount < f.minTakes) return false;
  if (f.outline && !f.outline.every((part) => s.outline[["point", "reason", "example"].indexOf(part)])) return false;
  if (f.focusIn && !(s.focus && f.focusIn.includes(s.focus))) return false;
  return true;
}

type MetricResult = { ok: boolean } | { missingBaseline: true };

function metricMatches(t: FactTake, m: NonNullable<TakeFilter["metric"]>, ctx: EvalContext): MetricResult {
  const value = metricOf(t, m.key);
  let target: number;
  if (typeof m.value === "number") target = m.value;
  else {
    const base = ctx.baselines.first5ReviewedMedian[m.key];
    if (base === undefined) return { missingBaseline: true };
    // With a baseline of 0, "fewer than your start" means none at all.
    target = base === 0 ? 0 : base * m.value.factor;
  }
  if (value == null) return { ok: false };
  return { ok: m.op === "<=" ? value <= target : value >= target };
}

function takeMatches(t: FactTake, s: FactSession | undefined, f: TakeFilter, ctx: EvalContext): boolean {
  if (!s) return false;
  if (!sessionMatches(s, f, ctx)) return false;
  if (f.stepKey && !(t.stepKey && f.stepKey.includes(t.stepKey))) return false;
  if (f.minSpeechMs !== undefined && speechMs(t) < f.minSpeechMs) return false;
  if (f.transcribed !== undefined && t.transcribed !== f.transcribed) return false;
  if (f.fillersReviewed !== undefined && t.fillersReviewed !== f.fillersReviewed) return false;
  if (f.prosodyViewed !== undefined && t.prosodyViewed !== f.prosodyViewed) return false;
  if (f.check && t.checks[f.check.id] !== f.check.value) return false;
  if (f.firstTakeOnly && t.ordinal !== 1) return false;
  if (f.metric) {
    const result = metricMatches(t, f.metric, ctx);
    if (!("ok" in result) || !result.ok) return false;
  }
  return true;
}

const distinctCount = (dates: string[]) => new Set(dates).size;

// One session lookup per facts snapshot, not one per criterion (A-36: about 100 criteria a pass).
const sessionMaps = new WeakMap<PracticeFacts, Map<string, FactSession>>();
function sessionsOf(facts: PracticeFacts): Map<string, FactSession> {
  let map = sessionMaps.get(facts);
  if (!map) sessionMaps.set(facts, (map = new Map(facts.sessions.map((s) => [s.id, s]))));
  return map;
}

/** How far a criterion is, with the evidence behind it. */
export function progressOf(c: Criterion, facts: PracticeFacts, ctx: EvalContext): CriterionProgress {
  const sessions = sessionsOf(facts);
  switch (c.kind) {
    case "takes": {
      // Takes that need a transcript can't progress without transcription.
      const needsTranscript = c.filter.transcribed || c.filter.fillersReviewed || (c.filter.metric && c.filter.metric.key !== "durationMs" && c.filter.metric.key !== "speechSpanMs");
      if (c.filter.metric && typeof c.filter.metric.value !== "number" && ctx.baselines.first5ReviewedMedian[c.filter.metric.key] === undefined) {
        return unavailable(c.label, c.atLeast, "Review 5 takes to set your starting point", "review", Math.min(ctx.baselines.reviewedTakes, BASELINE_TAKES));
      }
      const matches = facts.takes.filter((t) => takeMatches(t, sessions.get(t.sessionId), c.filter, ctx));
      if (needsTranscript && matches.length === 0 && !facts.transcriptionAvailable && !facts.takes.some((t) => t.transcribed)) {
        return unavailable(c.label, c.atLeast, "Needs local transcription", "transcription");
      }
      const evidence = matches.slice(0, MAX_EVIDENCE).map((t): EvidenceRef => ({ kind: "take", id: t.id, date: t.localDate }));
      return progress(c.label, matches.length, c.atLeast, evidence, c.distinctDays ? { done: distinctCount(matches.map((t) => t.localDate)), needed: c.distinctDays, unit: "days" } : null);
    }
    case "sessions": {
      const matches = facts.sessions.filter((s) => s.takeCount > 0 && sessionMatches(s, c.filter, ctx));
      const count = c.distinct === "focus" ? new Set(matches.map((s) => s.focus)).size : c.distinct === "contentId" ? new Set(matches.map((s) => s.contentId)).size : matches.length;
      const evidence = matches.slice(0, MAX_EVIDENCE).map((s): EvidenceRef => ({ kind: "session", id: s.id, date: s.localDate }));
      return progress(c.label, count, c.atLeast, evidence, c.distinctDays ? { done: distinctCount(matches.map((s) => s.localDate)), needed: c.distinctDays, unit: "days" } : null);
    }
    case "transfers": {
      if (c.mission) return unavailable(c.label, c.atLeast, "Arrives with missions", "events");
      const matches = facts.transferReviews.filter(
        (r) =>
          (!c.listenerWords || r.hasListenerWords) &&
          (!c.noClarification || !r.neededClarification) &&
          (!c.flow || (r.flow !== null && c.flow.includes(r.flow))) &&
          (!c.tags || c.tags.some((tag) => (r.tags as string[]).includes(tag))),
      );
      const evidence = matches.map((r): EvidenceRef => ({ kind: "transfer", id: r.id, date: r.localDate }));
      const weeks = c.distinctWeeks ? { done: new Set(matches.map((r) => weekStart(r.localDate, "monday"))).size, needed: c.distinctWeeks, unit: "weeks" as const } : null;
      return progress(c.label, matches.length, c.atLeast, evidence, weeks);
    }
    case "phrases": {
      if (c.saved !== undefined) {
        const saved = facts.phrases.filter((p) => !p.starter && !p.deleted);
        return progress(c.label, saved.length, c.saved, saved.map((p) => ({ kind: "phrase", id: p.id, date: p.createdAt.slice(0, 10) })));
      }
      const reviews = facts.phraseReviews;
      const days = c.reviewDays ? { done: distinctCount(reviews.map((r) => r.localDate)), needed: c.reviewDays, unit: "days" as const } : null;
      return progress(c.label, reviews.length, c.reviews ?? 1, [], days);
    }
    case "phraseUses": {
      const takes = facts.takes.filter((t) => t.phraseIds.length > 0 && (!c.unfamiliarOnly || sessions.get(t.sessionId)?.familiarity === "unfamiliar"));
      const evidence = takes.slice(0, MAX_EVIDENCE).map((t): EvidenceRef => ({ kind: "take", id: t.id, date: t.localDate }));
      if (c.distinctPhrases !== undefined) return progress(c.label, new Set(takes.flatMap((t) => t.phraseIds)).size, c.distinctPhrases, evidence);
      return progress(c.label, takes.length, c.takes ?? 1, evidence);
    }
    case "activity": {
      if (!isDrillType(c.type)) {
        return c.type === "upgrade"
          ? unavailable(c.label, c.atLeast, "Arrives with the learning engine", "learning")
          : unavailable(c.label, c.atLeast, "Arrives with talks and events", "events");
      }
      const result = c.result;
      const plays = drillPlays(facts, c.type).filter((p) => {
        if (!result) return true;
        const value = p.result[result.key];
        return value !== undefined && (result.op === ">=" ? value >= result.value : value <= result.value);
      });
      const evidence = plays.slice(0, MAX_EVIDENCE).map((p): EvidenceRef => ({ kind: p.takes.length === 1 && DRILL_UNITS[c.type as DrillType] === "take" ? "take" : "session", id: p.takes.length === 1 && DRILL_UNITS[c.type as DrillType] === "take" ? p.takes[0].id : p.session.id, date: p.session.localDate }));
      return progress(c.label, plays.length, c.atLeast, evidence, c.distinctDays ? { done: distinctCount(plays.map((p) => p.session.localDate)), needed: c.distinctDays, unit: "days" } : null);
    }
    case "exposure":
      return unavailable(c.label, c.steps, "Arrives with the confidence pack", "confidence");
    case "conversation":
      return unavailable(c.label, c.atLeast, "Arrives with the conversation partner", "partner");
    case "listenerAnswers":
    case "debrief":
      return unavailable(c.label, c.atLeast, "Arrives with events and listener packs", "events");
    case "anyOf": {
      const options = c.options.map((o) => progressOf(o, facts, ctx));
      const met = options.find((o) => o.met);
      if (met) return { ...met, label: c.label };
      const available = options.filter((o) => !o.unavailable);
      if (available.length === 0) return { ...options[0], label: c.label };
      // The available option you are furthest along shows (the first on a tie); any option meets it.
      const along = (o: CriterionProgress) => Math.min(1, o.done / Math.max(1, o.needed)) + (o.days ? Math.min(1, o.days.done / Math.max(1, o.days.needed)) : 1);
      return { ...available.reduce((best, o) => (along(o) > along(best) ? o : best)), label: c.label };
    }
    case "allOf": {
      const parts = c.parts.map((p) => progressOf(p, facts, ctx));
      const blocked = parts.find((p) => p.unavailable);
      const metParts = parts.filter((p) => p.met).length;
      if (blocked && !blocked.met) return { ...unavailable(c.label, parts.length, blocked.unavailable!.reason, blocked.unavailable!.fix, metParts) };
      return { ...progress(c.label, metParts, parts.length, parts.flatMap((p) => p.evidence)), met: parts.every((p) => p.met) };
    }
  }
}

/** True when a criterion only counts this week's items (quests). */
export function inWeek(date: string, start: string): boolean {
  return date >= start && date <= addLocalDays(start, 6);
}
