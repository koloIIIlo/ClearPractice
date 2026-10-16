import type { FactTake, PracticeFacts } from "@/lib/ipc/schemas";

/**
 * How the M8 measures move over time (roadmap 8.6), kept apart for rehearsed
 * answers and unfamiliar tasks. Each session gives one point, from the take
 * that is its evidence (A-18): the latest transcribed take of a rehearsed
 * answer, the first take of an unfamiliar task. All values are Estimated.
 */
export type TrendKey = "meanRun" | "midClausePerMin" | "differentPer50" | "confirmedPer100";
export type TrendPoint = { date: string; sessionId: string; attemptId: string; value: number };
export type Trend = { key: TrendKey; points: TrendPoint[]; typical: { date: string; value: number }[] };

/** Fewer points than this show the empty state instead of a line (§6 Progress). */
export const MIN_TREND_POINTS = 4;
/** "Typical for you": the median of the last five points. */
const TYPICAL_WINDOW = 5;

export const TREND_INFO: Record<TrendKey, { title: string; unit: string; subtitle?: string }> = {
  meanRun: { title: "Mean run", unit: "words between pauses" },
  midClausePerMin: { title: "Pauses inside a clause", unit: "a minute" },
  differentPer50: { title: "Different words", unit: "in every 50" },
  confirmedPer100: { title: "Confirmed hesitations", unit: "per 100 words", subtitle: "From takes where you reviewed every candidate" },
};

const round1 = (n: number) => Math.round(n * 10) / 10;

function value(key: TrendKey, t: FactTake): number | null {
  switch (key) {
    case "meanRun":
      return t.meanRun;
    case "differentPer50":
      return t.differentPer50;
    case "midClausePerMin":
      return t.midClausePauses != null && t.speechSpanMs ? round1(t.midClausePauses / (t.speechSpanMs / 60_000)) : null;
    case "confirmedPer100":
      return t.fillersReviewed && t.fillersConfirmed != null && t.words ? round1((t.fillersConfirmed / t.words) * 100) : null;
  }
}

/**
 * The median of each value and the ones before it in a trailing window.
 * Missing values (null or NaN) are skipped and get the median so far.
 */
export function rollingMedian(values: readonly (number | null)[], window: number): number[] {
  const seen: number[] = [];
  return values.map((v) => {
    if (v != null && !Number.isNaN(v)) seen.push(v);
    const recent = [...seen.slice(-window)].sort((a, b) => a - b);
    if (recent.length === 0) return Number.NaN;
    const mid = Math.floor(recent.length / 2);
    return recent.length % 2 ? recent[mid] : (recent[mid - 1] + recent[mid]) / 2;
  });
}

export function buildTrends(facts: PracticeFacts, view: "rehearsed" | "unfamiliar"): Trend[] {
  const familiarity = view === "rehearsed" ? "familiar" : "unfamiliar";
  const sessions = facts.sessions.filter((s) => s.familiarity === familiarity && s.takeCount > 0 && s.status !== "interrupted").sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const keys: TrendKey[] = ["meanRun", "midClausePerMin", "differentPer50", "confirmedPer100"];
  // Takes by session once, so two years of history stay fast.
  const bySession = new Map<string, FactTake[]>();
  for (const t of facts.takes) bySession.set(t.sessionId, [...(bySession.get(t.sessionId) ?? []), t]);
  for (const list of bySession.values()) list.sort((a, b) => a.ordinal - b.ordinal);
  return keys.map((key) => {
    const points: TrendPoint[] = [];
    for (const s of sessions) {
      const takes = bySession.get(s.id) ?? [];
      // A-18: an unfamiliar task counts its first take only; a rehearsed answer its latest transcribed one.
      const evidence = view === "unfamiliar" ? takes.filter((t) => t.ordinal === 1) : takes.filter((t) => t.transcribed).reverse();
      const take = evidence.find((t) => value(key, t) != null);
      if (take) points.push({ date: s.localDate, sessionId: s.id, attemptId: take.id, value: value(key, take)! });
    }
    const typical = rollingMedian(points.map((p) => p.value), TYPICAL_WINDOW).map((v, i) => ({ date: points[i].date, value: round1(v) }));
    return { key, points, typical };
  });
}
