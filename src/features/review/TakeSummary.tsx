import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Lightbulb, Play, ThumbsUp } from "lucide-react";
import { EvidenceLabel } from "@/components/evidence";
import { Button } from "@/components/ui/button";
import { formatClock } from "@/lib/format";
import { useIpc } from "@/lib/ipc";
import { keys, useAudioMeasures, usePhrases, usePhraseUses, usePreferences } from "@/lib/ipc/queries";
import { recordLine } from "@/features/engagement/celebrations";
import { usePracticeStyle } from "@/features/engagement/style";
import { recordDef } from "@/lib/engagement/records";
import { weekStart } from "@/lib/engagement/weekly";
import { toLocalDate } from "@/lib/phrase-schedule";
import { useTranscriptionQueue } from "@/features/transcription/queue";
import { SelfChecks } from "@/features/insights/SelfChecks";
import { countWatchWords } from "@/lib/insights/words";
import { shouldFoldMeasures } from "@/lib/learning/feedback";
import { PREDICT_TIP_AFTER, usualPace } from "@/lib/learning/predict";
import { PredictCard, PredictionReveal, wasSkipped } from "@/features/learning/PredictCard";
import type { AttemptTranscript, CoachingRun, EvidenceSource, TranscriptMeasures, WordCount } from "@/lib/ipc/schemas";
import type { PlayerLink } from "./player-link";
import { TakePartnerActions } from "@/features/partner/TakePartnerActions";

/** Below this many words the measures say too little to summarise. */
const MIN_WORDS = 15;
/** Fewer filler candidates than this don't stand out in a take. */
const FILLERS_TO_MENTION = 3;
/** A run of at least this many words between pauses is worth mentioning (8.3). */
const LONG_RUN_WORDS = 12;
/** Pauses inside a clause start to matter from this many on. */
const MID_CLAUSE_TO_MENTION = 2;
/** A word you use often stands out from this many times in one take. */
const WATCH_WORD_TO_MENTION = 3;

/** What the summary knows besides the transcript: saved phrases you used and your words to watch (8.2, 8.11). */
export type SummaryContext = { phrasesUsed?: string[]; watchWords?: WordCount[]; personalRecord?: { line: string; source: EvidenceSource } };

const firstWords = (text: string, n = 4) => {
  const words = text.trim().split(/\s+/);
  return words.length > n ? `${words.slice(0, n).join(" ")}…` : words.join(" ");
};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export type SummaryPoint = { text: string; detail?: string; source: EvidenceSource };
export type TakeSummaryResult =
  | { kind: "ready"; wentWell: SummaryPoint; tryNext: SummaryPoint | null; fromAi: boolean; stale: boolean }
  | { kind: "none"; reason: string };

/**
 * What went well first, then one thing to try (§6 Session review, guide §3.13).
 * AI feedback, when you asked for it, supplies both (its summary is told to say
 * what worked). Otherwise only facts from the transcript's measures are used,
 * labelled Estimated; with nothing to go on, the result says why instead.
 */
export function summarizeTake(transcript: AttemptTranscript | null | undefined, runs: CoachingRun[] = [], context: SummaryContext = {}): TakeSummaryResult {
  const revision = transcript?.revision;
  if (!revision) return { kind: "none", reason: "What went well and one thing to try appear here once this take has a transcript. Nothing is guessed from the audio alone." };
  const m = revision.measures;
  if (m.wordCount === 0) return { kind: "none", reason: "No words were transcribed, so there's nothing to summarise." };

  const ai = runs[0];
  if (ai) {
    const current = transcript.correction?.id ?? revision.id;
    return {
      kind: "ready",
      wentWell: { text: ai.feedback.summary, source: "ai" },
      tryNext: { text: ai.feedback.oneImprovement, detail: ai.feedback.nextAttempt, source: "ai" },
      fromAi: true,
      stale: ai.revisionId !== current,
    };
  }
  if (m.wordCount < MIN_WORDS)
    return { kind: "none", reason: `This take has ${m.wordCount} ${m.wordCount === 1 ? "word" : "words"}, too few to summarise. A few full sentences give the measures something to work with.` };

  const fillers = m.fillers.filter((f) => f.decision !== "dismissed");
  const runsQuote = m.runs && revision.segments[m.runs.longestFromSegment] ? `, from “${firstWords(revision.segments[m.runs.longestFromSegment].text)}”` : "";
  const kinds = m.pausesUnavailableReason ? [] : (m.pauseKinds ?? []);
  const midClause = kinds.filter((k) => k === "mid_clause").length;
  // The first that applies (8.3); a personal record leads once the game layer has them (M9).
  const wentWell: SummaryPoint = context.personalRecord
    ? { text: `New personal record: ${context.personalRecord.line}.`, source: context.personalRecord.source }
    : context.phrasesUsed?.length
    ? { text: `You used a saved phrase: “${context.phrasesUsed[0]}”.`, source: "estimated" }
    : m.runs && m.runs.longestWords >= LONG_RUN_WORDS
      ? { text: `Your longest run: ${m.runs.longestWords} words between pauses${runsQuote}.`, source: "estimated" }
      : kinds.length > 0 && midClause === 0
        ? { text: `Every pause fell between thoughts (${plural(kinds.length, "pause", "pauses")}).`, source: "estimated" }
        : fillers.length === 0
          ? { text: `No filler candidates in ${m.wordCount} words.`, source: "estimated" }
          : { text: `You finished the take: ${m.wordCount} words${m.speechSpanMs != null ? ` in ${formatClock(m.speechSpanMs)}` : ""}.`, source: "estimated" };
  const quoted = [...new Set(fillers.map((f) => f.word))].slice(0, 3).map((w) => `“${w}”`).join(", ");
  const watched = (context.watchWords ?? m.watchWords ?? []).find((w) => w.count >= WATCH_WORD_TO_MENTION);
  const tryNext: SummaryPoint | null =
    midClause >= MID_CLAUSE_TO_MENTION
      ? { text: "Pause at the end of a thought, not in the middle", detail: `${midClause} pauses fell inside a clause.`, source: "estimated" }
      : m.opener?.hint === "starts_with_hesitation"
        ? { text: "Try opening with your point", detail: `Your opening: “${m.opener.text}”`, source: "estimated" }
        : m.ending?.hint === "trails_off"
          ? { text: "Try finishing with one sentence that sums up", detail: `Your ending: “${m.ending.text}”`, source: "estimated" }
          : watched
            ? { text: `Notice how often you say “${watched.word}”`, detail: `${watched.count} times in this take.${watched.word === "like" ? " This counts every “like”, including ordinary uses." : ""}`, source: "estimated" }
            : fillers.length >= FILLERS_TO_MENTION
              ? { text: "Pause between ideas instead of filling the gap", detail: `${fillers.length} filler candidates (${quoted}). A short silent pause can take their place.`, source: "estimated" }
              : null;
  return { kind: "ready", wentWell, tryNext, fromAi: false, stale: false };
}

function Line({ children }: { children: React.ReactNode }) {
  return <p className="flex flex-wrap gap-x-1.5">{children}</p>;
}
const Dot = () => <span aria-hidden className="text-muted-foreground">·</span>;
const Unavailable = ({ reason }: { reason: string | null | undefined }) => <span className="text-muted-foreground">unavailable ({reason ?? "not measured"})</span>;

/** Folded section with its label; open on the latest take, folded on the others. */
function Fold({ title, open, children }: { title: string; open: boolean; children: React.ReactNode }) {
  return (
    <details open={open} className="group border-t pt-2">
      <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-2 rounded-md font-medium focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <span>
          <span aria-hidden className="mr-1.5 inline-block text-muted-foreground transition-transform group-open:rotate-90">›</span>
          {title}
        </span>
        <EvidenceLabel source="estimated" />
      </summary>
      <div className="space-y-1 pb-1 pl-4">{children}</div>
    </details>
  );
}

/** Runs between pauses, where pauses fell, hesitation candidates, pace and speech rate (8.1, 8.8). */
export function FlowSection({ measures: m, rate, open = true }: { measures: TranscriptMeasures; rate?: { value: number | null; reason: string | null } | null; open?: boolean }) {
  const kinds = m.pauseKinds ?? [];
  const reviewed = m.fillers.length > 0 && m.fillers.every((f) => f.decision !== null);
  return (
    <Fold title="Flow" open={open}>
      {m.runs !== undefined && (
        <Line>
          {m.runs ? (
            <>
              <span>Mean run {m.runs.meanWords} words between pauses</span><Dot /><span>Longest {m.runs.longestWords}</span>
            </>
          ) : (
            <span>Runs between pauses <Unavailable reason={m.runsUnavailableReason} /></span>
          )}
        </Line>
      )}
      <Line>
        {m.pausesUnavailableReason ? (
          <span>Pauses <Unavailable reason={m.pausesUnavailableReason} /></span>
        ) : m.pauseKinds ? (
          <span>
            Pauses: {kinds.filter((k) => k === "boundary").length} between clauses, {kinds.filter((k) => k === "mid_clause").length} inside one
          </span>
        ) : (
          <span>{plural(m.pauses.length, "pause", "pauses")} over {m.pauseThresholdMs / 1000} s</span>
        )}
      </Line>
      <Line>
        <span>Hesitation candidates {m.fillers.length}{reviewed ? ", all reviewed" : ""}</span>
        <Dot />
        {m.paceWpm != null ? <span>Pace about {Math.round(m.paceWpm)} words a minute</span> : <span>Pace <Unavailable reason={m.paceUnavailableReason} /></span>}
      </Line>
      {rate && (
        <Line>
          {rate.value != null ? <span>Speech rate (audio) about {rate.value.toFixed(1)} syllables a second</span> : <span>Speech rate (audio) <Unavailable reason={rate.reason} /></span>}
        </Line>
      )}
    </Fold>
  );
}

/** Words you use often, hedges, vocabulary range and saved phrases you used (8.1, 8.2, 8.11). */
export function WordsSection({ measures: m, watchWords, countsLike, phrasesUsed, onListen, open = true }: {
  measures: TranscriptMeasures;
  watchWords: WordCount[] | undefined;
  countsLike: boolean;
  phrasesUsed: { expression: string; phraseId: string; startMs: number | null }[];
  onListen?: (ms: number) => void;
  open?: boolean;
}) {
  if (m.watchWords === undefined && m.differentPer50 === undefined && phrasesUsed.length === 0) return null;
  const hedges = (m.hedges ?? []).reduce((n, h) => n + h.count, 0);
  return (
    <Fold title="Words" open={open}>
      {m.wordsUnavailableReason ? (
        <Line><span>Words you use often and hedges <Unavailable reason={m.wordsUnavailableReason} /></span></Line>
      ) : (
        <>
          <Line>
            <span>Words you used often:</span>
            {watchWords && watchWords.length > 0 ? (
              watchWords.map((w, i) => (
                <span key={w.word}>
                  {i > 0 && <Dot />} {w.word} {w.count}
                </span>
              ))
            ) : (
              <span className="text-muted-foreground">none of the words you watch</span>
            )}
          </Line>
          {countsLike && <p className="text-meta text-muted-foreground">Counts every “like”, including ordinary uses.</p>}
          <Line>
            <span title={(m.hedges ?? []).map((h) => `${h.word} ${h.count}`).join(", ") || undefined}>Hedges: {hedges}</span>
            <Dot />
            {m.differentPer50 != null ? <span>Different words: {Math.round(m.differentPer50)} in every 50</span> : <span>Different words <Unavailable reason={m.vocabularyUnavailableReason} /></span>}
          </Line>
        </>
      )}
      {phrasesUsed.map((p) => (
        <Line key={p.phraseId}>
          <span>
            Saved phrase you used: <Link className="text-primary hover:underline" to={`/phrases?focus=${encodeURIComponent(p.phraseId)}`}>“{p.expression}”</Link>
          </span>
          {onListen && p.startMs != null && (
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => onListen(p.startMs!)}>
              <Play aria-hidden /> Listen
            </Button>
          )}
        </Line>
      ))}
      {phrasesUsed.length > 0 && <p className="text-meta text-muted-foreground">Matched by words, so a different meaning can match too.</p>}
    </Fold>
  );
}

/**
 * The take's summary in one predictable place, right under its player in the
 * Studio. It shares the transcript and AI-feedback queries with the views
 * around it, so it fills in as soon as transcription finishes.
 */
export function TakeSummary({ attemptId, reviewHref, link, durationMs, latest = true }: {
  attemptId: string;
  reviewHref?: string;
  /** The take's player, so "Listen" can jump to a saved phrase. */
  link?: PlayerLink;
  durationMs?: number | null;
  /** Flow and Words are open on the latest take and folded on the others (8.3). */
  latest?: boolean;
}) {
  const ipc = useIpc();
  const { preferences, update } = usePreferences();
  const native = ipc.recordingMode === "native";
  const queue = useTranscriptionQueue();
  const coaching = preferences.coachingMode !== "off";
  const transcript = useQuery({ queryKey: ["attempt-transcript", attemptId], queryFn: () => ipc.getAttemptTranscript(attemptId), enabled: native });
  const runs = useQuery({ queryKey: ["take-coaching", attemptId], queryFn: () => ipc.listTakeCoaching(attemptId), enabled: native && coaching });
  const revision = transcript.data?.revision ?? null;
  const uses = usePhraseUses();
  const phrases = usePhrases();
  const audio = useAudioMeasures(attemptId, native && !!revision);
  // A personal record set by this take leads in Playful style (9.7).
  const { playful } = usePracticeStyle();
  const week = weekStart(toLocalDate(new Date()), preferences.weekStartsOn);
  const timing = preferences.measuresTiming;
  const engagement = useQuery({ queryKey: keys.engagementState(week), queryFn: () => ipc.getEngagementState(week), enabled: native && (playful || timing === "fade") });
  const recordRow = playful ? engagement.data?.records.find((r) => r.attemptId === attemptId && r.previous !== null) : undefined;
  const personalRecord = recordRow ? { line: recordLine(recordRow, engagement.data?.records), source: recordDef(recordRow.record)?.source ?? "estimated" } : undefined;
  const phrasesUsed = (uses.data ?? [])
    .filter((u) => u.attemptId === attemptId)
    .flatMap((u) => {
      const card = phrases.data?.find((p) => p.id === u.phraseId);
      return card ? [{ phraseId: u.phraseId, expression: card.expression, startMs: revision?.segments[u.segment]?.startMs ?? null }] : [];
    });
  // Feedback timing (11.4) and predict, then check (11.5) read the facts snapshot.
  const predictFirst = preferences.predictFirst;
  const facts = useQuery({ queryKey: keys.facts, queryFn: () => ipc.getPracticeFacts(), enabled: native && !!revision && (timing === "fade" || predictFirst || !preferences.predictTipSeen) });
  const predictions = useQuery({ queryKey: keys.predictions, queryFn: () => ipc.listPredictions(), enabled: native && predictFirst });
  const [skippedGuess, setSkippedGuess] = useState(() => wasSkipped(attemptId));
  const [measuresOpen, setMeasuresOpen] = useState(false);
  const guesses = (predictions.data ?? []).filter((p) => p.attemptId === attemptId);
  const asking = native && predictFirst && !!revision && guesses.length === 0 && !skippedGuess;
  const fade = (() => {
    const take = facts.data?.takes.find((t) => t.id === attemptId);
    if (timing !== "fade" || !facts.data || !take) return { takesWithFocus: 0, fluencyLevel: 0 };
    const focusOf = new Map(facts.data.sessions.map((s) => [s.id, s.focus ?? null]));
    const focus = focusOf.get(take.sessionId) ?? null;
    return {
      takesWithFocus: facts.data.takes.filter((t) => t.createdAt <= take.createdAt && (focusOf.get(t.sessionId) ?? null) === focus).length,
      fluencyLevel: Math.max(0, ...(engagement.data?.levels ?? []).filter((l) => l.area === "fluency").map((l) => l.level)),
    };
  })();
  const folded = shouldFoldMeasures(timing, fade) && !measuresOpen;
  const showTip = native && latest && !predictFirst && !preferences.predictTipSeen && (facts.data?.takes.filter((t) => t.transcribed).length ?? 0) >= PREDICT_TIP_AFTER;
  // Your own words to watch are counted here, with the default list (8.11).
  const watchWords = revision && preferences.watchWords.length > 0 ? countWatchWords(revision.segments.length ? revision.segments.map((s) => s.text) : revision.text, preferences.watchWords) : revision?.measures.watchWords;

  let result: TakeSummaryResult | null = null;
  if (!native)
    result = { kind: "none", reason: "Browser preview: a simulated take has no transcript, so there's nothing to summarise. In the desktop app, what went well and one thing to try appear here once the take is transcribed." };
  else if (transcript.error) result = { kind: "none", reason: "The transcript couldn't be loaded, so there's no summary." };
  else if (transcript.data?.job?.state === "running" && !transcript.data.revision) result = { kind: "none", reason: "The summary appears here when the transcript is ready." };
  // Wait for saved AI feedback too, so the summary doesn't switch source once it arrives.
  else if (transcript.data && !(coaching && runs.isPending)) result = summarizeTake(transcript.data, runs.data ?? [], { phrasesUsed: phrasesUsed.map((p) => p.expression), watchWords, personalRecord });
  // Guessing first: wait for your earlier guesses so measures never flash before the question.
  if (result?.kind === "ready" && asking && predictions.isPending) result = null;
  if (result?.kind === "ready" && asking && predictions.isSuccess) return <PredictCard attemptId={attemptId} onSkip={() => setSkippedGuess(true)} />;

  if (result?.kind !== "ready") {
    // Without a transcript, say plainly what happens next (user request 2026-10-10).
    const waiting = native && transcript.data && !transcript.data.revision;
    const queued = queue.current?.attemptId === attemptId ? "now" : queue.waiting.some((i) => i.attemptId === attemptId) ? "queued" : null;
    const next = !waiting
      ? null
      : queued === "now" || transcript.data?.job?.state === "running"
        ? "Transcribing on this computer now."
        : queued === "queued"
          ? "Waiting its turn to be transcribed on this computer."
          : !queue.available
            ? queue.unavailableReason
            : preferences.autoTranscribe
              ? "New takes are transcribed automatically; this one was recorded earlier, so transcribe it below."
              : "Transcribe it below, or turn on automatic transcription in Settings → Transcription.";
    return (
      <p role={result ? undefined : "status"} className="rounded-lg border border-dashed px-3 py-2 text-meta text-muted-foreground">
        {queued === "now" || transcript.data?.job?.state === "running" ? "The summary appears here when the transcript is ready." : (result?.reason ?? "Loading the summary…")}
        {next && queued !== "now" && transcript.data?.job?.state !== "running" && (
          <>
            {" "}
            {next}
            {!queue.available && native && <> <Link className="text-primary hover:underline" to="/settings/transcription">Open Settings</Link></>}
          </>
        )}
      </p>
    );
  }

  const { wentWell, tryNext } = result;
  return (
    // Two columns only when the summary itself is wide enough (it lives in narrow take rows too).
    <section role="group" aria-label="Take summary" className="@container rounded-lg border p-3">
      {revision && guesses.length > 0 && (
        <PredictionReveal predictions={guesses} measures={revision.measures} usualPace={facts.data ? usualPace(facts.data, attemptId) : null} />
      )}
      <div className="grid gap-x-6 gap-y-4 @xl:grid-cols-2">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 font-medium">
              <ThumbsUp aria-hidden className="size-4 text-primary" /> What went well
            </h3>
            <EvidenceLabel source={wentWell.source} />
          </div>
          <p>{wentWell.text}</p>
        </div>
        <div className="space-y-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 font-medium">
              <Lightbulb aria-hidden className="size-4 text-muted-foreground" /> One thing to try
            </h3>
            {tryNext && <EvidenceLabel source={tryNext.source} />}
          </div>
          {tryNext ? (
            <>
              <p className="font-medium">{tryNext.text}</p>
              {tryNext.detail && <p className="text-muted-foreground">{tryNext.detail}</p>}
            </>
          ) : (
            <p className="text-muted-foreground">Nothing stood out. Listen back and add a note if something did.</p>
          )}
        </div>
        {result.stale && <p className="text-meta text-muted-foreground @xl:col-span-2">Based on an earlier version of the transcript.</p>}
        {!result.fromAi && coaching && reviewHref && (
          <p className="text-meta text-muted-foreground @xl:col-span-2">
            From the transcript's measures. For comments on your wording,{" "}
            <Link className="text-primary hover:underline" to={reviewHref}>ask for AI feedback in the session</Link>.
          </p>
        )}
      </div>
      {revision && (
        <div className="mt-3 space-y-2">
          {folded ? (
            // "When I ask" and "Fewer as I improve" fold Flow and Words; what went well and the self-check stay (11.4).
            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2">
              <span className="text-meta text-muted-foreground">
                {timing === "fade" ? "Measures fold as you improve." : "Measures show when you ask."} You can change this in Settings → Practice.
              </span>
              <Button variant="outline" size="sm" onClick={() => setMeasuresOpen(true)}>Show measures</Button>
            </div>
          ) : (
            <>
              <FlowSection
                measures={revision.measures}
                open={latest || measuresOpen}
                rate={audio.data ? { value: audio.data.rateSps, reason: audio.data.unavailableReason } : audio.error ? { value: null, reason: "the audio couldn't be read" } : null}
              />
              <WordsSection
                measures={revision.measures}
                open={latest || measuresOpen}
                watchWords={watchWords}
                countsLike={preferences.watchWords.includes("like")}
                phrasesUsed={phrasesUsed}
                onListen={link ? (ms) => link.seek(ms, true) : undefined}
              />
            </>
          )}
          <div className="border-t pt-2">
            <SelfChecks attemptId={attemptId} opener={revision.measures.opener ?? null} ending={revision.measures.ending ?? null} durationMs={durationMs ?? revision.measures.speechSpanMs} />
          </div>
          {/* The conversation partner (13.9, 13.10): a panel's questions about this answer, or a clearer version of it. */}
          <TakePartnerActions attemptId={attemptId} />
        </div>
      )}
      {showTip && (
        // Offered once, after ten transcribed takes (11.5).
        <div role="note" className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3 text-meta">
          <Lightbulb aria-hidden className="size-4 text-muted-foreground" />
          <span className="min-w-0 flex-1">Try guessing first: before the measures show, guess your hesitations and pace, then compare.</span>
          <Button variant="outline" size="sm" onClick={() => update({ predictFirst: true, predictTipSeen: true })}>Turn it on</Button>
          <Button variant="ghost" size="sm" onClick={() => update({ predictTipSeen: true })}>No thanks</Button>
        </div>
      )}
    </section>
  );
}
