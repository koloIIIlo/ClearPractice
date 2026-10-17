import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ear, Hand, Play } from "lucide-react";
import { AudioPlayer, type AudioPlayerHandle } from "@/components/audio-player";
import { EvidenceLabel } from "@/components/evidence";
import { EmptyState, ErrorState, LoadingBlock, Page, PageHeader, Panel } from "@/components/page";
import { Button } from "@/components/ui/button";
import { formatClock, formatDay } from "@/lib/format";
import { useIpc } from "@/lib/ipc";
import { keys, usePracticeFacts, useSessions } from "@/lib/ipc/queries";
import type { FactTake } from "@/lib/ipc/schemas";
import { confirmedFillerSpans, matchPresses, MIN_CONFIRMED_FOR_CATCH, type CatchResult, type FillerSpan } from "@/lib/learning/catch-it";
import { playCue } from "@/lib/tone";
import { requestEngagementRefresh } from "@/features/engagement/refresh";
import { cn } from "@/lib/utils";

/** A run is saved once you've heard this much of the take (or all of it). */
export const HEARD_TO_SAVE = 0.8;

/** Takes worth catching: reviewed, with at least three confirmed fillers; newest first. */
export function catchableTakes(takes: readonly FactTake[]): FactTake[] {
  return takes.filter((t) => t.fillersReviewed && (t.fillersConfirmed ?? 0) >= MIN_CONFIRMED_FOR_CATCH).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function TakePicker({ onPick }: { onPick: (id: string) => void }) {
  const facts = usePracticeFacts();
  const sessions = useSessions({});
  if (facts.isPending) return <LoadingBlock rows={3} label="Loading your takes" />;
  if (facts.error) return <ErrorState error={facts.error} onRetry={() => void facts.refetch()} />;
  const takes = catchableTakes(facts.data?.takes ?? []).slice(0, 20);
  if (takes.length === 0)
    return (
      <EmptyState
        icon={Ear}
        title="No take is ready for Catch it yet"
        action={<Button variant="outline" asChild><Link to="/sessions">Open sessions</Link></Button>}
      >
        Catch it needs a transcribed take where you confirmed at least {MIN_CONFIRMED_FOR_CATCH} hesitation candidates as fillers. Open a take, decide on each candidate, then come back.
      </EmptyState>
    );
  const title = (t: FactTake) => sessions.data?.find((s) => s.id === t.sessionId)?.title ?? "A session";
  return (
    <section aria-labelledby="pick-heading" className="space-y-3">
      <h2 id="pick-heading" className="font-semibold">Choose a take</h2>
      <ul className="divide-y rounded-panel border bg-card">
        {takes.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{title(t)}</p>
              <p className="text-meta text-muted-foreground tabular-nums">
                Take {t.ordinal} · {formatDay(t.localDate)} · {formatClock(t.durationMs)} · {t.fillersConfirmed} confirmed fillers
                {t.catchRuns.length > 0 && ` · played ${t.catchRuns.length} ${t.catchRuns.length === 1 ? "time" : "times"}`}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => onPick(t.id)} aria-label={`Play ${title(t)}, take ${t.ordinal}`}>
              <Play aria-hidden /> Play
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Your presses against the fillers along the take, drawn after play (never during it). */
function Timeline({ durationMs, fillers, presses, result }: { durationMs: number; fillers: FillerSpan[]; presses: number[]; result: CatchResult }) {
  const at = (ms: number) => `${Math.min(100, Math.max(0, (ms / Math.max(1, durationMs)) * 100))}%`;
  return (
    <div aria-hidden className="relative h-12 rounded-lg border bg-secondary/40">
      {fillers.map((f, i) => (
        <span
          key={`f${i}`}
          className={cn("absolute top-1.5 h-4 rounded-sm", result.matched[i] !== null ? "bg-primary/70" : "bg-highlight")}
          style={{ left: at(f.startMs), width: `max(4px, calc(${at(f.endMs)} - ${at(f.startMs)}))` }}
        />
      ))}
      {presses.map((p, i) => (
        <span key={`p${i}`} className="absolute bottom-1.5 h-4 w-0.5 rounded-full bg-foreground" style={{ left: at(p) }} />
      ))}
    </div>
  );
}

function CatchRound({ take, onChooseAnother }: { take: FactTake; onChooseAnother: () => void }) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const player = useRef<AudioPlayerHandle>(null);
  const [playing, setPlaying] = useState(false);
  const [presses, setPresses] = useState<number[]>([]);
  const [result, setResult] = useState<CatchResult | null>(null);
  const [started, setStarted] = useState(false);
  const heardMs = useRef(0);
  const [saved, setSaved] = useState<boolean | null>(null);
  const playback = useQuery({ queryKey: ["recording-playback", take.id], queryFn: () => ipc.getRecordingPlaybackUrl(take.id), retry: false });
  const transcript = useQuery({ queryKey: ["attempt-transcript", take.id], queryFn: () => ipc.getAttemptTranscript(take.id), retry: false });
  const revision = transcript.data?.revision;
  const fillers = revision
    ? confirmedFillerSpans(revision.measures.fillers, revision.segments.map((s) => ({ startMs: s.startMs ?? 0, endMs: s.endMs ?? 0 })))
    : [];
  const save = useMutation({
    mutationFn: (r: CatchResult) => ipc.saveCatchRun(take.id, presses.map((p) => Math.min(take.durationMs, Math.max(0, Math.round(p)))), r.caught, r.total),
    onSuccess: () => {
      requestEngagementRefresh("activity");
      return qc.invalidateQueries({ queryKey: keys.facts });
    },
  });

  const press = () => {
    // A press counts only while the take plays (11.6).
    if (result || !playing || !player.current) return;
    setPresses((p) => (p.length >= 500 ? p : [...p, player.current!.positionMs()]));
    playCue("tick");
  };
  const pressRef = useRef(press);
  pressRef.current = press;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "f" || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable=true]")) return;
      e.preventDefault();
      pressRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const finish = (ended = false) => {
    if (result) return;
    player.current?.pause();
    const r = matchPresses(presses, fillers);
    setResult(r);
    // Only a run where you heard (nearly) the whole take is kept and earns its points.
    const whole = ended || heardMs.current >= take.durationMs * HEARD_TO_SAVE;
    setSaved(whole);
    if (whole) save.mutate(r);
  };
  const again = () => {
    setPresses([]);
    setResult(null);
    setSaved(null);
    setStarted(false);
    heardMs.current = 0;
    save.reset();
    player.current?.seek(0);
  };

  if (playback.isPending || transcript.isPending) return <LoadingBlock rows={2} label="Opening the take" />;
  const error = playback.error ?? transcript.error;
  if (error) return <ErrorState error={error} />;
  if (fillers.length < MIN_CONFIRMED_FOR_CATCH)
    return (
      <EmptyState title="This take has too few confirmed fillers" action={<Button variant="outline" onClick={onChooseAnother}>Choose another take</Button>}>
        Catch it needs at least {MIN_CONFIRMED_FOR_CATCH} confirmed fillers with timed segments.
      </EmptyState>
    );

  return (
    <div className="space-y-6">
      <Panel className="space-y-4">
        <p>
          Play the take with the transcript hidden. Press <kbd className="rounded border px-1.5 font-mono text-meta">F</kbd>, or Caught one, whenever you hear a filler. A soft click confirms each press.
        </p>
        <AudioPlayer
          ref={player}
          src={playback.data!}
          label="your take"
          onPlayingChange={(on) => {
            setPlaying(on);
            if (on) setStarted(true);
          }}
          onPositionChange={(ms) => {
            if (!result) heardMs.current = Math.max(heardMs.current, ms);
          }}
          onEnded={() => finish(true)}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button size="lg" className="min-w-44 rounded-full" disabled={!playing || !!result} onClick={press} aria-keyshortcuts="F">
            <Hand aria-hidden /> Caught one
          </Button>
          <span className="text-meta text-muted-foreground tabular-nums" aria-live="polite">
            {presses.length} {presses.length === 1 ? "press" : "presses"}
          </span>
          {!result && (
            <Button variant="outline" className="ml-auto" disabled={!started} onClick={() => finish()}>
              Finish
            </Button>
          )}
        </div>
      </Panel>

      {result && (
        <Panel aria-labelledby="catch-result" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="catch-result" className="text-lg font-semibold">
              You caught {result.caught} of {result.total}
            </h2>
            <EvidenceLabel source="estimated" />
          </div>
          <p className="text-meta text-muted-foreground">
            Timings are approximate: a press counts when it falls inside the stretch of speech that holds a filler, and each filler counts once.
            {result.extra > 0 && ` ${result.extra} ${result.extra === 1 ? "press" : "presses"} fell elsewhere.`}
          </p>
          <Timeline durationMs={take.durationMs} fillers={fillers} presses={presses} result={result} />
          <ol className="divide-y rounded-panel border">
            {fillers.map((f, i) => (
              <li key={i} className="flex flex-wrap items-center gap-3 px-4 py-2">
                <span className="tabular-nums">{formatClock(f.startMs)}</span>
                <span className="min-w-0 flex-1 text-meta text-muted-foreground">{result.matched[i] !== null ? "Caught" : "Not caught this time"}</span>
                <Button variant="ghost" size="sm" onClick={() => player.current?.playRange(f.startMs, f.endMs)}>
                  <Play aria-hidden /> Listen<span className="sr-only"> from {formatClock(f.startMs)}</span>
                </Button>
              </li>
            ))}
          </ol>
          {save.error && <p role="alert" className="text-meta text-destructive">{save.error.message}</p>}
          {save.isSuccess && <p className="text-meta text-muted-foreground">Saved with this take.</p>}
          {saved === false && <p className="text-meta text-muted-foreground">Not saved: a run is kept when you listen to the whole take.</p>}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={again}>Play it again</Button>
            <Button variant="ghost" onClick={onChooseAnother}>Choose another take</Button>
          </div>
        </Panel>
      )}
    </div>
  );
}

/**
 * Catch it (roadmap 11.6): awareness training for fillers. Play one of your
 * reviewed takes with the transcript hidden and press whenever you hear one;
 * afterwards see which you caught. The result is Estimated and never a grade.
 */
export function CatchItPage() {
  const ipc = useIpc();
  const [params, setParams] = useSearchParams();
  const facts = usePracticeFacts();
  const takeId = params.get("take");
  const take = takeId ? facts.data?.takes.find((t) => t.id === takeId) : undefined;
  const choose = (id: string | null) =>
    setParams((p) => {
      if (id) p.set("take", id);
      else p.delete("take");
      return p;
    });
  return (
    <Page className="max-w-4xl">
      <PageHeader title="Catch it" description="Noticing a filler is the first step to replacing it with a pause." />
      {ipc.recordingMode !== "native" ? (
        <EmptyState icon={Ear} title="Catch it plays your own takes">
          It works in the desktop app, with takes you recorded and reviewed there. This browser preview has no recorded audio.
        </EmptyState>
      ) : takeId && take ? (
        <CatchRound key={take.id} take={take} onChooseAnother={() => choose(null)} />
      ) : takeId && facts.isPending ? (
        <LoadingBlock rows={2} label="Opening the take" />
      ) : (
        <TakePicker onPick={choose} />
      )}
    </Page>
  );
}
