import type { FactTake, HesitationBucket, PaceBucket, PracticeFacts } from "@/lib/ipc/schemas";

/**
 * Predict, then check (roadmap 11.5): guess first, then look. Accurate
 * self-judgement supports learning (Dunlosky & Rawson 2012). The guess is
 * Your note; the take's bucket is Estimated (A-35).
 */
export const HESITATION_CHOICES: readonly { value: HesitationBucket; label: string }[] = [
  { value: "0-1", label: "0–1" },
  { value: "2-4", label: "2–4" },
  { value: "5+", label: "5 or more" },
];
export const PACE_CHOICES: readonly { value: PaceBucket; label: string }[] = [
  { value: "slower", label: "Slower" },
  { value: "usual", label: "About usual" },
  { value: "faster", label: "Faster" },
];
/** Within this share of your usual pace counts as "About usual". */
export const USUAL_PACE_BAND = 0.07;
/** After this many transcribed takes a tip offers predict-first once. */
export const PREDICT_TIP_AFTER = 10;

export function hesitationBucket(count: number): HesitationBucket {
  return count <= 1 ? "0-1" : count <= 4 ? "2-4" : "5+";
}

/** Hesitations of a take: confirmed ones once you reviewed it, else the candidates. */
export function hesitationsOf(take: Pick<FactTake, "fillersReviewed" | "fillersConfirmed" | "fillerCandidates">): number | null {
  return take.fillersReviewed ? take.fillersConfirmed : take.fillerCandidates;
}

export function paceBucket(pace: number, usual: number): PaceBucket {
  if (pace < usual * (1 - USUAL_PACE_BAND)) return "slower";
  if (pace > usual * (1 + USUAL_PACE_BAND)) return "faster";
  return "usual";
}

/** Your usual pace: the median of your transcribed takes other than this one. */
export function usualPace(facts: PracticeFacts, except?: string): number | null {
  const paces = facts.takes.filter((t) => t.id !== except && t.paceWpm != null).map((t) => t.paceWpm!).sort((a, b) => a - b);
  if (paces.length === 0) return null;
  const mid = Math.floor(paces.length / 2);
  return paces.length % 2 ? paces[mid] : (paces[mid - 1] + paces[mid]) / 2;
}

/** A take's actual buckets, when it has the values. */
export function actualBuckets(take: FactTake, facts: PracticeFacts): { hesitations: HesitationBucket | null; pace: PaceBucket | null } {
  const hesitations = hesitationsOf(take);
  const usual = usualPace(facts, take.id);
  return {
    hesitations: hesitations == null ? null : hesitationBucket(hesitations),
    pace: take.paceWpm == null || usual == null ? null : paceBucket(take.paceWpm, usual),
  };
}

export type SelfAwareness = { matched: number; compared: number; grid: Record<HesitationBucket, Record<HesitationBucket, number>> };

/**
 * How your hesitation guesses matched, over the last ten takes with a guess
 * and a value: a count and a guessed-against-actual grid. Never a percentage.
 */
export function selfAwareness(facts: PracticeFacts, last = 10): SelfAwareness {
  const buckets: HesitationBucket[] = ["0-1", "2-4", "5+"];
  const grid = Object.fromEntries(buckets.map((g) => [g, Object.fromEntries(buckets.map((a) => [a, 0]))])) as SelfAwareness["grid"];
  const pairs = facts.takes
    .filter((t) => t.predictions.hesitations && hesitationsOf(t) != null)
    .slice(-last)
    .map((t) => ({ guessed: t.predictions.hesitations as HesitationBucket, actual: hesitationBucket(hesitationsOf(t)!) }));
  for (const { guessed, actual } of pairs) if (grid[guessed]) grid[guessed][actual] += 1;
  return { matched: pairs.filter((p) => p.guessed === p.actual).length, compared: pairs.length, grid };
}
