import type { ExposureAttempt, ExposureOutcome, ExposureStep } from "@/lib/ipc/schemas";

/**
 * The exposure ladder's rules (roadmap 12.2): graded steps from easy to hard,
 * with your own discomfort rated before and after each attempt (Your note).
 * Watching it fall over repeated attempts is the point; nothing ever locks.
 */
/** A step feels manageable once its last two attempts were rated this low afterwards. */
export const MANAGEABLE_AFTER = 3;

export const OUTCOME_LABELS: Record<Exclude<ExposureOutcome, "planned">, string> = {
  yes: "Yes",
  partly: "Partly",
  not_this_time: "Not this time",
};

export const isDone = (a: Pick<ExposureAttempt, "outcome">) => a.outcome === "yes" || a.outcome === "partly";

export type StepStats = {
  /** Attempts done, fully or in part. */
  done: number;
  /** Your first rating before, and your latest rating after (both Your note). */
  firstBefore: number | null;
  lastAfter: number | null;
  /** A plan still waiting for "I did it". */
  plan: ExposureAttempt | null;
  manageable: boolean;
};

const byDate = (a: ExposureAttempt, b: ExposureAttempt) => a.localDate.localeCompare(b.localDate) || a.createdAt.localeCompare(b.createdAt);

/** A step's attempts in order, its first and latest ratings, any open plan, and whether it feels manageable. */
export function stepStats(attempts: readonly ExposureAttempt[]): StepStats {
  const ordered = [...attempts].sort(byDate);
  const rated = ordered.filter((a) => a.outcome !== "planned");
  const lastTwo = rated.filter((a) => a.afterRating !== null).slice(-2);
  return {
    done: ordered.filter(isDone).length,
    firstBefore: ordered.find((a) => a.beforeRating !== null)?.beforeRating ?? null,
    lastAfter: [...rated].reverse().find((a) => a.afterRating !== null)?.afterRating ?? null,
    plan: [...ordered].reverse().find((a) => a.outcome === "planned") ?? null,
    manageable: lastTwo.length === 2 && lastTwo.every((a) => (a.afterRating ?? 11) <= MANAGEABLE_AFTER),
  };
}

/** The step to highlight: the first one after a manageable step that isn't manageable itself. Nothing locks. */
export function nextUp(steps: readonly ExposureStep[], attempts: readonly ExposureAttempt[]): string | null {
  const ordered = [...steps].sort((a, b) => a.position - b.position);
  for (let i = 1; i < ordered.length; i += 1) {
    const prev = stepStats(attempts.filter((a) => a.stepId === ordered[i - 1].id));
    const here = stepStats(attempts.filter((a) => a.stepId === ordered[i].id));
    if (prev.manageable && !here.manageable) return ordered[i].id;
  }
  return null;
}

/** "done 3× · discomfort 6 → 2"; never a fraction or a score (A-26). */
export function statsLine(s: StepStats): string {
  if (s.done === 0 && !s.plan) return "Not tried yet";
  const parts = [s.done > 0 ? `done ${s.done}×` : "planned"];
  if (s.firstBefore !== null && s.lastAfter !== null) parts.push(`discomfort ${s.firstBefore} → ${s.lastAfter}`);
  else if (s.firstBefore !== null) parts.push(`expected discomfort ${s.firstBefore}`);
  return parts.join(" · ");
}

/** Chart rows for one step: one per attempt with a rating, in order. */
export function chartRows(attempts: readonly ExposureAttempt[]): { attempt: number; date: string; before: number | null; after: number | null }[] {
  return [...attempts]
    .sort(byDate)
    .filter((a) => a.beforeRating !== null || a.afterRating !== null)
    .map((a, i) => ({ attempt: i + 1, date: a.localDate, before: a.beforeRating, after: a.afterRating }));
}

/** Distinct steps with an attempt done, and done attempts you rated at least `minBefore` beforehand (Courage 3 and 4). */
export function exposureCounts(exposure: readonly { stepId: string; attempts: readonly { before: number | null; done: boolean }[] }[], minBefore?: number): { steps: number; attempts: number } {
  const qualifying = (a: { before: number | null; done: boolean }) => a.done && (minBefore === undefined || (a.before ?? -1) >= minBefore);
  return {
    steps: exposure.filter((s) => s.attempts.some(qualifying)).length,
    attempts: exposure.reduce((n, s) => n + s.attempts.filter(qualifying).length, 0),
  };
}
