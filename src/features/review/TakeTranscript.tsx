import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2, X } from "lucide-react";
import { EvidenceLabel } from "@/components/evidence";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatClock } from "@/lib/format";
import { useIpc } from "@/lib/ipc";
import { API_MODE_ENABLED, TakeApiTranscribe } from "./ApiTranscribe";
import type { AttemptTranscript, TranscriptMeasures, TranscriptionEvent } from "@/lib/ipc/schemas";

const PHASES: Record<string, string> = {
  preparing: "Preparing audio",
  running: "Transcribing",
  transcribing: "Transcribing",
  completed: "Saving the transcript",
};

/** Display-only match of the words the native measures already flagged in this segment. */
function SegmentText({ text, fillers }: { text: string; fillers: Set<string> }) {
  if (fillers.size === 0) return <span>{text}</span>;
  const parts = text.split(/(\s+)/);
  return (
    <span>
      {parts.map((part, i) => {
        const word = part.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, "").toLowerCase();
        return fillers.has(word) ? (
          <mark key={i} className="rounded-sm bg-highlight px-0.5 text-highlight-foreground" title="Filler candidate">{part}</mark>
        ) : (
          part
        );
      })}
    </span>
  );
}

function Measures({ m }: { m: TranscriptMeasures }) {
  const fillerWords = [...new Set(m.fillers.map((f) => f.word))].join(", ");
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-meta">
      <dt className="text-muted-foreground">Pace</dt>
      <dd>{m.paceWpm != null ? `${Math.round(m.paceWpm)} words per minute` : `Unavailable: ${m.paceUnavailableReason}`}</dd>
      <dt className="text-muted-foreground">Filler candidates</dt>
      <dd>{m.fillers.length ? `${m.fillers.length} (${fillerWords})` : "None found"}</dd>
      <dt className="text-muted-foreground">Pauses of {m.pauseThresholdMs / 1000} s or more</dt>
      <dd>
        {(() => {
          // Silence in the recording itself beats gaps between model segments.
          const fromAudio = m.voice && !m.voice.unavailableReason;
          const pauses = fromAudio ? m.voice!.pauses : m.pauses;
          const reason = fromAudio ? null : m.pausesUnavailableReason;
          const list = reason ? `Unavailable: ${reason}` : pauses.length ? pauses.map((p) => `${(p.durationMs / 1000).toFixed(1)} s at ${formatClock(p.startMs)}`).join(", ") : "None";
          return `${list}${fromAudio ? " · from the recording" : " · from transcript timing"}`;
        })()}
      </dd>
      <dt className="text-muted-foreground">Repeated words</dt>
      <dd>{m.repeatedWords.length ? m.repeatedWords.join(", ") : "None"}</dd>
      {m.untimedSegments > 0 && (
        <dd className="col-span-2 text-muted-foreground">
          {m.untimedSegments} {m.untimedSegments === 1 ? "segment has" : "segments have"} no usable timing and {m.untimedSegments === 1 ? "is" : "are"} left out of pace and pauses.
        </dd>
      )}
    </dl>
  );
}

/** Confirm or dismiss each filler candidate (plan 3.7); decisions are stored per revision. */
function FillerReview({ revisionId, measures, onChanged }: { revisionId: string; measures: TranscriptMeasures; onChanged: () => void }) {
  const ipc = useIpc();
  const decide = useMutation({
    mutationFn: ({ index, word, decision }: { index: number; word: string; decision: "confirmed" | "dismissed" | null }) =>
      ipc.setFillerDecision(revisionId, index, word, decision),
    onSuccess: onChanged,
  });
  const fillers = measures.fillers;
  if (fillers.length === 0) return null;
  const confirmed = fillers.filter((f) => f.decision === "confirmed").length;
  const dismissed = fillers.filter((f) => f.decision === "dismissed").length;
  return (
    <details className="rounded-md border p-2">
      <summary className="cursor-pointer text-meta">
        Review filler candidates · {confirmed} confirmed, {dismissed} dismissed, {fillers.length - confirmed - dismissed} to review
      </summary>
      <ol className="mt-2 space-y-1">
        {fillers.map((f, index) => (
          <li key={index} className="flex flex-wrap items-center gap-2 text-meta">
            <span className="w-28 tabular-nums text-muted-foreground">
              “{f.word}” · {f.segmentStartMs != null ? `near ${formatClock(f.segmentStartMs)}` : "time unknown"}
            </span>
            {(["confirmed", "dismissed"] as const).map((choice) => (
              <Button
                key={choice}
                size="sm"
                variant={f.decision === choice ? "secondary" : "ghost"}
                aria-pressed={f.decision === choice}
                aria-label={`${choice === "confirmed" ? "Filler" : "Not a filler"}: “${f.word}” ${index + 1}`}
                disabled={decide.isPending}
                onClick={() => decide.mutate({ index, word: f.word, decision: f.decision === choice ? null : choice })}
              >
                {choice === "confirmed" ? "Filler" : "Not a filler"}
              </Button>
            ))}
          </li>
        ))}
      </ol>
      {decide.error && <p role="alert" className="text-meta text-destructive">{decide.error.message}</p>}
    </details>
  );
}

/** "My corrections" (plan 3.9): saved as a child revision; the machine transcript is never edited. */
function Corrections({ data, onSaved }: { data: AttemptTranscript; onSaved: () => void }) {
  const ipc = useIpc();
  const revision = data.revision!;
  const [draft, setDraft] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (text: string) => ipc.saveTranscriptCorrection(data.attemptId, revision.id, text),
    onSuccess: () => {
      setDraft(null);
      onSaved();
    },
  });
  const id = `correction-${data.attemptId}`;
  if (draft !== null)
    return (
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(draft);
        }}
      >
        <Label htmlFor={id}>My corrections</Label>
        <Textarea id={id} value={draft} rows={5} maxLength={64_000} disabled={save.isPending} onChange={(e) => setDraft(e.target.value)} />
        <p className="text-meta text-muted-foreground">Fix words the model misheard. The original transcript and its measures stay as they are.</p>
        <div className="flex gap-2">
          <Button type="submit" disabled={save.isPending || !draft.trim()}>{save.isPending ? "Saving…" : "Save corrections"}</Button>
          <Button type="button" variant="ghost" disabled={save.isPending} onClick={() => setDraft(null)}>Cancel</Button>
        </div>
        {save.error && <p role="alert" className="text-meta text-destructive">{save.error.message}</p>}
      </form>
    );
  return data.correction ? (
    <div className="space-y-1 rounded-md bg-secondary/50 p-2">
      <p className="flex flex-wrap items-center gap-2 text-meta text-muted-foreground">
        <EvidenceLabel source="note" /> My corrections · {data.correction.wordCount} words, {data.correction.fillerCount} filler candidates
        <Button variant="ghost" className="ml-auto" onClick={() => setDraft(data.correction!.text)}>Edit corrections</Button>
      </p>
      <p>{data.correction.text}</p>
    </div>
  ) : (
    <Button variant="outline" onClick={() => setDraft(revision.segments.map((s) => s.text.trim()).filter(Boolean).join(" "))}>
      Correct the transcript
    </Button>
  );
}

function JobMessage({ data }: { data: AttemptTranscript }) {
  const job = data.job;
  if (!job || job.state === "completed" || job.state === "running") return null;
  const newer = data.revision && job.createdAt && data.revision.createdAt > job.createdAt;
  if (newer) return null;
  const lead = job.state === "canceled" ? "Transcription was cancelled." : job.state === "interrupted" ? "Transcription was interrupted." : "Transcription failed.";
  return (
    <p role="alert" className="text-meta text-destructive">
      {lead} {job.errorMessage ?? ""} The recording is unchanged.
    </p>
  );
}

/**
 * Local transcript for one saved take (plan 3.8, 3.11). Text is shown as
 * transcribed; fillers are kept on purpose and every timing is Estimated.
 */
const API_PROVIDER_NAMES: Record<string, string> = { deepgram: "Deepgram", assemblyai: "AssemblyAI" };

export function TakeTranscript({ attemptId }: { attemptId: string }) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const key = ["attempt-transcript", attemptId] as const;
  const transcript = useQuery({ queryKey: key, queryFn: () => ipc.getAttemptTranscript(attemptId) });
  const setup = useQuery({ queryKey: ["transcription-setup"], queryFn: () => ipc.getTranscriptionSetup(), staleTime: 60_000 });
  const [live, setLive] = useState<TranscriptionEvent | null>(null);

  useEffect(() => {
    let disposed = false;
    let remove: (() => void) | undefined;
    void ipc
      .onTranscriptionEvent((event) => {
        if (event.attemptId !== attemptId) return;
        if (event.phase === "finished") {
          setLive(null);
          void qc.invalidateQueries({ queryKey: ["attempt-transcript", attemptId] });
        } else {
          setLive(event);
        }
      })
      .then((unsubscribe) => (disposed ? unsubscribe() : (remove = unsubscribe)))
      .catch(() => {});
    return () => {
      disposed = true;
      remove?.();
    };
  }, [ipc, qc, attemptId]);

  const start = useMutation({
    mutationFn: () => ipc.transcribeAttempt(attemptId),
    onSuccess: () => {
      setLive({ jobId: "pending", attemptId, phase: "preparing", percent: null });
      void qc.invalidateQueries({ queryKey: key });
    },
  });
  const cancel = useMutation({ mutationFn: () => ipc.cancelTranscription() });

  const data = transcript.data;
  const running = !!live || data?.job?.state === "running";
  const revision = data?.revision ?? null;
  const notSetUp = setup.data && !setup.data.configured;

  return (
    <section aria-label="Transcript" className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-2 font-medium">
          <FileText aria-hidden className="size-4" /> Transcript
        </h3>
        {revision && (
          <span className="text-meta text-muted-foreground">
            As transcribed · {revision.source === "api" ? `${API_PROVIDER_NAMES[revision.provider ?? ""] ?? revision.provider ?? "API"} ${revision.modelId ?? ""} (sent with your approval)` : `local ${revision.modelId ?? "Whisper"}`}
            {revision.backend ? ` (${revision.backend.toUpperCase()})` : ""}
            {revision.workerElapsedMs != null ? ` · ${Math.round(revision.workerElapsedMs / 1000)} s` : ""}
          </span>
        )}
        <div className="ml-auto flex gap-2">
          {running ? (
            <Button variant="outline" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
              <X aria-hidden /> Cancel
            </Button>
          ) : (
            <Button
              variant={revision ? "ghost" : "default"}
              disabled={start.isPending || !!notSetUp || !setup.data}
              onClick={() => start.mutate()}
            >
              {revision ? "Transcribe again" : "Transcribe"}
            </Button>
          )}
        </div>
      </div>

      {running && (
        <p role="status" className="flex items-center gap-2 text-meta text-muted-foreground">
          <Loader2 aria-hidden className="size-4 animate-spin" />
          {PHASES[live?.phase ?? "running"] ?? "Transcribing"}
          {live?.percent != null ? ` · ${live.percent}%` : "…"} Recording a new take cancels this; you can run it again.
        </p>
      )}
      {notSetUp && !revision && (
        <p className="text-meta text-muted-foreground">
          Local transcription isn't set up yet. <Link className="underline" to="/settings/transcription">Set it up in Settings → Transcription</Link>.
        </p>
      )}
      {API_MODE_ENABLED && !running && <TakeApiTranscribe attemptId={attemptId} />}
      {start.error && <p role="alert" className="text-meta text-destructive">{start.error.message}</p>}
      {transcript.error && <p role="alert" className="text-meta text-destructive">{transcript.error.message}</p>}
      {data && !running && <JobMessage data={data} />}

      {revision && (
        <>
          <ol className="space-y-1.5">
            {revision.segments.map((segment, i) =>
              segment.text.trim() ? (
                <li key={i} className="flex gap-3">
                  <span className="w-12 shrink-0 pt-0.5 text-right text-meta text-muted-foreground tabular-nums">
                    {segment.startMs != null ? formatClock(segment.startMs) : "–"}
                  </span>
                  <SegmentText
                    text={segment.text.trim()}
                    fillers={new Set(revision.measures.fillers.filter((f) => f.segment === i && f.decision !== "dismissed").map((f) => f.word))}
                  />
                </li>
              ) : null,
            )}
          </ol>
          <Measures m={revision.measures} />
          <FillerReview revisionId={revision.id} measures={revision.measures} onChanged={() => void qc.invalidateQueries({ queryKey: key })} />
          {data && <Corrections data={data} onSaved={() => void qc.invalidateQueries({ queryKey: key })} />}
          <p className="flex flex-wrap items-center gap-2 text-meta text-muted-foreground">
            <EvidenceLabel source="estimated" /> Times and measures are estimated from the model's segments. Fillers such as “uh” and
            “um” are kept on purpose; highlighted words are candidates to review, not errors.
          </p>
        </>
      )}
    </section>
  );
}
