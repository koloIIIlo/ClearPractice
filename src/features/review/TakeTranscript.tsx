import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2, X } from "lucide-react";
import { EvidenceLabel } from "@/components/evidence";
import { Button } from "@/components/ui/button";
import { formatClock } from "@/lib/format";
import { useIpc } from "@/lib/ipc";
import type { AttemptTranscript, TranscriptionEvent } from "@/lib/ipc/schemas";

const PHASES: Record<string, string> = {
  preparing: "Preparing audio",
  running: "Transcribing",
  transcribing: "Transcribing",
  completed: "Saving the transcript",
};

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
            As transcribed · local {revision.modelId ?? "Whisper"}
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
                  <span>{segment.text.trim()}</span>
                </li>
              ) : null,
            )}
          </ol>
          <p className="flex flex-wrap items-center gap-2 text-meta text-muted-foreground">
            <EvidenceLabel source="estimated" /> Segment times are estimated by the model. Fillers such as “uh” and “um” are kept on
            purpose; they are things to review, not errors.
          </p>
        </>
      )}
    </section>
  );
}
