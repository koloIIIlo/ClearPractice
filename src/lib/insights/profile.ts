import { addLocalDays } from "@/lib/phrase-schedule";
import type { FactTake, PracticeFacts } from "@/lib/ipc/schemas";

/**
 * How you typically speak (roadmap 8.7): a description, not a grade. Ranges
 * are the middle half (25th–75th percentile) of your recent eligible takes;
 * "Since your first month" compares the median of your first 30 days of
 * practice with your last 30, only when each side has five takes. All values
 * are Estimated and every row says where it came from or why it is missing.
 */
export type ProfileRow = { key: string; label: string; value: string | null; detail: string | null; unavailableReason: string | null; source: "estimated"; link: string | null };
export type Profile = { rows: ProfileRow[]; since: ProfileRow[] | null; takes: number };

const RECENT = 20;
const SINCE_MIN_TAKES = 5;
const SINCE_DAYS = 30;

const percentile = (sorted: number[], p: number) => {
  const at = (sorted.length - 1) * p;
  const lo = Math.floor(at);
  return sorted[lo] + (sorted[Math.ceil(at)] - sorted[lo]) * (at - lo);
};

/** The 25th and 75th percentile, or null with fewer than two values. */
export function middleHalf(values: readonly number[]): [number, number] | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length < 2) return null;
  return [percentile(sorted, 0.25), percentile(sorted, 0.75)];
}

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? percentile(sorted, 0.5) : null;
};

const range = (r: [number, number], digits = 0) => {
  const [lo, hi] = r.map((v) => v.toFixed(digits));
  return lo === hi ? `about ${lo}` : `${lo}–${hi}`;
};

function row(key: string, label: string, values: number[], format: (r: [number, number]) => string, missing: string, link: string | null, detail: string | null = null): ProfileRow {
  const r = middleHalf(values);
  return { key, label, value: r ? format(r) : null, detail: r ? detail : null, unavailableReason: r ? null : missing, source: "estimated", link };
}

export function buildProfile(facts: PracticeFacts, opts: { recent?: number } = {}): Profile {
  const familiarity = new Map(facts.sessions.map((s) => [s.id, s.familiarity]));
  const takes = [...facts.takes].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const recent = takes.slice(-(opts.recent ?? RECENT));
  const pick = (list: FactTake[], f: (t: FactTake) => number | null) => list.map(f).filter((v): v is number => v != null);
  const paceBy = (view: "familiar" | "unfamiliar") => median(pick(recent.filter((t) => familiarity.get(t.sessionId) === view), (t) => t.paceWpm));
  const rehearsed = paceBy("familiar");
  const unfamiliar = paceBy("unfamiliar");
  const paceDetail = [rehearsed != null ? `rehearsed ${Math.round(rehearsed)}` : null, unfamiliar != null ? `unfamiliar ${Math.round(unfamiliar)}` : null].filter(Boolean).join(" · ") || null;

  // Facts hold how often words to watch come up (per 100 words), not which words: the take summary names them.
  const since30 = addLocalDays(facts.today, -SINCE_DAYS);
  const phrasesUsed = new Set(takes.filter((t) => t.localDate > since30).flatMap((t) => t.phraseIds));

  const transcribe = facts.transcriptionAvailable ? "Transcribe a few takes to see this." : "Needs transcribed takes.";
  const rows: ProfileRow[] = [
    row("pace", "Typical pace", pick(recent, (t) => t.paceWpm), (r) => `${range(r)} words a minute`, transcribe, "/progress?view=rehearsed", paceDetail),
    row("run", "Typical run", pick(recent, (t) => t.meanRun), (r) => `${range(r)} words between pauses`, transcribe, "/progress?view=rehearsed"),
    row("pitch", "Pitch range", pick(recent, (t) => t.pitchRangeSt), (r) => `usually ${range(r)} semitones`, "No take has an intonation track yet. Show intonation on a take to add one.", null),
    row("rate", "Speech rate (audio)", pick(recent, (t) => t.rateSps), (r) => `about ${range(r, 1)} syllables a second`, "Open a take's summary to measure it from the audio.", null),
    row("watch", "Words you use often", pick(recent, (t) => t.watchPer100), (r) => `about ${range(r, 1)} in every 100 words`, transcribe, null),
    row("hedges", "Hedges", pick(recent, (t) => t.hedgesPer100), (r) => `about ${range(r, 1)} in every 100 words`, transcribe, null),
    {
      key: "phrases", label: "Saved phrases used", value: `${phrasesUsed.size} in the last 30 days`, detail: null,
      unavailableReason: null, source: "estimated", link: "/phrases",
    },
  ];

  // Then and now: the median of your first 30 days of practice against your last 30.
  const first = takes[0]?.localDate;
  let since: ProfileRow[] | null = null;
  if (first) {
    const early = takes.filter((t) => t.localDate <= addLocalDays(first, SINCE_DAYS - 1));
    const late = takes.filter((t) => t.localDate > since30);
    const thenNow = (key: string, label: string, f: (t: FactTake) => number | null, unit: string, digits = 0): ProfileRow | null => {
      const then = pick(early, f);
      const now = pick(late, f);
      if (then.length < SINCE_MIN_TAKES || now.length < SINCE_MIN_TAKES || early.some((t) => late.includes(t))) return null;
      return { key, label, value: `${median(then)!.toFixed(digits)} → ${median(now)!.toFixed(digits)} ${unit}`, detail: null, unavailableReason: null, source: "estimated", link: null };
    };
    const rowsSince = [
      thenNow("run", "Mean run", (t) => t.meanRun, "words", 1),
      thenNow("different", "Different words", (t) => t.differentPer50, "in every 50"),
      thenNow("pace", "Pace", (t) => t.paceWpm, "words a minute"),
    ].filter((r): r is ProfileRow => r !== null);
    since = rowsSince.length > 0 ? rowsSince : null;
  }
  return { rows, since, takes: recent.length };
}
