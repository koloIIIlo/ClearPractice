import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Lightbulb, ThumbsUp } from "lucide-react";
import { EvidenceLabel } from "@/components/evidence";
import { formatClock } from "@/lib/format";
import { useIpc } from "@/lib/ipc";
import { usePreferences } from "@/lib/ipc/queries";
import { useTranscriptionQueue } from "@/features/transcription/queue";
import type { AttemptTranscript, CoachingRun, EvidenceSource } from "@/lib/ipc/schemas";

/** Below this many words the measures say too little to summarise. */
const MIN_WORDS = 15;
/** Fewer filler candidates than this don't stand out in a take. */
const FILLERS_TO_MENTION = 3;

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
export function summarizeTake(transcript: AttemptTranscript | null | undefined, runs: CoachingRun[] = []): TakeSummaryResult {
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
  const wentWell: SummaryPoint =
    fillers.length === 0
      ? { text: `No filler candidates in ${m.wordCount} words.`, source: "estimated" }
      : { text: `You finished the take: ${m.wordCount} words${m.speechSpanMs != null ? ` in ${formatClock(m.speechSpanMs)}` : ""}.`, source: "estimated" };
  const quoted = [...new Set(fillers.map((f) => f.word))].slice(0, 3).map((w) => `“${w}”`).join(", ");
  const tryNext: SummaryPoint | null =
    fillers.length >= FILLERS_TO_MENTION
      ? { text: "Pause between ideas instead of filling the gap", detail: `${fillers.length} filler candidates (${quoted}). A short silent pause can take their place.`, source: "estimated" }
      : null;
  return { kind: "ready", wentWell, tryNext, fromAi: false, stale: false };
}

/**
 * The take's summary in one predictable place, right under its player in the
 * Studio. It shares the transcript and AI-feedback queries with the views
 * around it, so it fills in as soon as transcription finishes.
 */
export function TakeSummary({ attemptId, reviewHref }: { attemptId: string; reviewHref?: string }) {
  const ipc = useIpc();
  const { preferences } = usePreferences();
  const native = ipc.recordingMode === "native";
  const queue = useTranscriptionQueue();
  const coaching = preferences.coachingMode !== "off";
  const transcript = useQuery({ queryKey: ["attempt-transcript", attemptId], queryFn: () => ipc.getAttemptTranscript(attemptId), enabled: native });
  const runs = useQuery({ queryKey: ["take-coaching", attemptId], queryFn: () => ipc.listTakeCoaching(attemptId), enabled: native && coaching });

  let result: TakeSummaryResult | null = null;
  if (!native)
    result = { kind: "none", reason: "Browser preview: a simulated take has no transcript, so there's nothing to summarise. In the desktop app, what went well and one thing to try appear here once the take is transcribed." };
  else if (transcript.error) result = { kind: "none", reason: "The transcript couldn't be loaded, so there's no summary." };
  else if (transcript.data?.job?.state === "running" && !transcript.data.revision) result = { kind: "none", reason: "The summary appears here when the transcript is ready." };
  // Wait for saved AI feedback too, so the summary doesn't switch source once it arrives.
  else if (transcript.data && !(coaching && runs.isPending)) result = summarizeTake(transcript.data, runs.data ?? []);

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
    </section>
  );
}
