import { useEffect, useRef, useState } from "react";
import { Link, useBlocker, useNavigate, useParams, useSearchParams } from "react-router";
import { CheckCircle2, Circle, Info, Loader2, Mic, Square, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Page, Panel, QueryView } from "@/components/page";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatClock } from "@/lib/format";
import { useExercises, usePrompts } from "@/lib/ipc/queries";
import type { ExerciseDefinition, PracticePrompt } from "@/lib/ipc/schemas";
import { cn } from "@/lib/utils";
import { describeDemands } from "@/features/exercises/describe";
import { useSimulatedRecorder, type Recorder } from "./recorder";

export function StudioPage() {
  const { exerciseId } = useParams();
  const [params] = useSearchParams();
  const exercises = useExercises();
  const prompts = usePrompts();

  return (
    <Page className="max-w-4xl">
      <QueryView query={exercises}>
        {(exList) => (
          <QueryView query={prompts}>
            {(promptList) => {
              const exercise = exList.find((e) => e.id === exerciseId) ?? exList[0];
              const prompt = promptList.find((p) => p.id === params.get("prompt")) ?? promptList[0];
              return <Studio exercise={exercise} prompt={prompt} />;
            }}
          </QueryView>
        )}
      </QueryView>
    </Page>
  );
}

function Studio({ exercise, prompt }: { exercise: ExerciseDefinition; prompt: PracticePrompt }) {
  const rec = useSimulatedRecorder();
  const navigate = useNavigate();
  const [useCountdown, setUseCountdown] = useState(false);
  const [outline, setOutline] = useState({ point: "", reason: "", example: "" });
  const [announcement, setAnnouncement] = useState("");
  const studioRef = useRef<HTMLDivElement>(null);

  const takeNumber = rec.takes.length + (rec.phase === "saved" || rec.phase === "interrupted" ? 0 : 1);
  const lastTake = rec.takes[rec.takes.length - 1];

  // Never silently abandon a take by navigating away (§6 Practice studio).
  const blocker = useBlocker(rec.isCapturing);

  // Screen-reader announcements for state changes only — never every timer second (§14).
  useEffect(() => {
    const text: Partial<Record<typeof rec.phase, string>> = {
      countdown: "Get ready. Recording starts after the countdown.",
      recording: `Recording take ${takeNumber}.`,
      finalizing: "Saving the take.",
      saved: lastTake ? `Take ${lastTake.ordinal} saved.` : "",
    };
    setAnnouncement(text[rec.phase] ?? "");
    if (rec.phase === "saved" && lastTake) toast.success(`Take ${lastTake.ordinal} saved`);
  }, [rec.phase]);

  const primary = () => {
    if (rec.phase === "recording") void rec.stopAndSave();
    else if (rec.phase === "countdown") rec.cancelCountdown();
    else if (!rec.isCapturing) rec.start({ countdownSeconds: useCountdown ? 3 : 0 });
  };

  // Ctrl+Enter triggers the available record/stop action while the studio has focus (§14).
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey && e.key === "Enter") {
      e.preventDefault();
      primary();
    }
  };

  const locked = rec.isCapturing || rec.phase === "countdown";

  return (
    <div ref={studioRef} onKeyDown={onKeyDown} className="space-y-6">
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>

      <header className="space-y-2">
        <p className="text-meta text-muted-foreground">
          {exercise.title} · Take {Math.max(1, takeNumber)}
        </p>
        <h1 className="text-title font-semibold tracking-tight text-balance">{prompt.text}</h1>
        <p className="text-meta text-muted-foreground">{describeDemands(prompt.conditions).join(" · ")}</p>
      </header>

      <div
        role="note"
        className="flex items-start gap-2 rounded-lg border border-dashed px-3 py-2 text-meta text-muted-foreground"
      >
        <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
        Preview build: the recorder is simulated and no audio is captured yet. Native recording arrives in milestone 2.
      </div>

      <fieldset disabled={locked} className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-2 text-meta font-medium">Outline (optional, up to three keywords)</legend>
        {(["point", "reason", "example"] as const).map((k) => (
          <div key={k} className="space-y-1">
            <Label htmlFor={`outline-${k}`} className="capitalize">
              {k}
            </Label>
            <Input
              id={`outline-${k}`}
              className="h-10"
              value={outline[k]}
              maxLength={60}
              onChange={(e) => setOutline((o) => ({ ...o, [k]: e.target.value }))}
            />
          </div>
        ))}
      </fieldset>

      <Panel className="flex flex-col items-center gap-5 py-10">
        <RecorderStatus rec={rec} />
        <div className="text-5xl font-medium tabular-nums" aria-label="Elapsed time">
          {rec.phase === "countdown" ? rec.countdown : formatClock(rec.elapsedMs)}
        </div>
        <InputLevelMeter level={rec.level} active={rec.phase === "recording"} clipping={rec.clipping} />
        <Button
          size="lg"
          onClick={primary}
          disabled={rec.phase === "preparing" || rec.phase === "finalizing"}
          variant={rec.phase === "recording" ? "outline" : "default"}
          className="min-w-44"
          aria-keyshortcuts="Control+Enter"
        >
          {rec.phase === "recording" ? (
            <>
              <Square aria-hidden className="fill-current" /> Stop and save
            </>
          ) : rec.phase === "countdown" ? (
            "Cancel countdown"
          ) : rec.phase === "finalizing" || rec.phase === "preparing" ? (
            <>
              <Loader2 aria-hidden className="animate-spin" /> {rec.phase === "preparing" ? "Opening microphone" : "Saving"}
            </>
          ) : (
            <>
              <Mic aria-hidden /> {rec.takes.length ? "Record again" : "Record"}
            </>
          )}
        </Button>
        <div className="flex items-center gap-2 text-meta text-muted-foreground">
          <Switch id="countdown" checked={useCountdown} onCheckedChange={setUseCountdown} disabled={locked} />
          <Label htmlFor="countdown" className="font-normal">
            3-second countdown before recording
          </Label>
        </div>
        <p className="text-meta text-muted-foreground">
          Ctrl+Enter to record or stop. The timer is for information only, so there's no need to rush.
        </p>
      </Panel>

      <section aria-labelledby="takes-heading">
        <h2 id="takes-heading" className="mb-3 font-semibold">
          Takes
        </h2>
        {rec.takes.length === 0 ? (
          <p className="text-muted-foreground">No takes yet. Each take is saved as soon as you stop.</p>
        ) : (
          <ol className="divide-y rounded-panel border bg-card">
            {rec.takes.map((t) => (
              <li key={t.ordinal} className="flex items-center gap-3 px-4 py-3">
                {t.state === "saved" ? (
                  <CheckCircle2 aria-hidden className="size-4 text-primary" />
                ) : (
                  <TriangleAlert aria-hidden className="size-4 text-destructive" />
                )}
                <span className="flex-1">Take {t.ordinal}</span>
                <span className="text-meta text-muted-foreground tabular-nums">{formatClock(t.durationMs)}</span>
                <span className="text-meta">{t.state === "saved" ? "Saved" : "Interrupted, recoverable"}</span>
              </li>
            ))}
          </ol>
        )}
        {rec.takes.length > 0 && !locked && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild>
              <Link to="/sessions/s-01/attempt/1">Review take {lastTake.ordinal}</Link>
            </Button>
            <Button variant="outline" onClick={() => navigate("/sessions/s-01")}>
              Finish session
            </Button>
          </div>
        )}
      </section>

      <AlertDialog open={blocker.state === "blocked"}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>A take is still recording</AlertDialogTitle>
            <AlertDialogDescription>
              Stop and save it before leaving, or keep recording. Leaving never discards audio silently.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => blocker.reset?.()}>Continue recording</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                await rec.stopAndSave();
                blocker.proceed?.();
              }}
            >
              Stop and save
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function RecorderStatus({ rec }: { rec: Recorder }) {
  const map = {
    idle: { text: "Ready", tone: "text-muted-foreground" },
    countdown: { text: "Get ready. Not recording yet", tone: "text-muted-foreground" },
    preparing: { text: "Opening microphone…", tone: "text-muted-foreground" },
    recording: { text: "Recording", tone: "text-destructive" },
    finalizing: { text: "Saving…", tone: "text-muted-foreground" },
    saved: { text: "Saved on this computer", tone: "text-primary" },
    interrupted: { text: "Interrupted. Captured audio is recoverable", tone: "text-destructive" },
  } as const;
  const { text, tone } = map[rec.phase];
  return (
    <p className={cn("inline-flex items-center gap-2 font-medium", tone)}>
      {rec.phase === "recording" && <Circle aria-hidden className="size-3 fill-current" />}
      {text}
    </p>
  );
}

/** A modest input meter; no pulsing when idle (§5). */
function InputLevelMeter({ level, active, clipping }: { level: number; active: boolean; clipping: boolean }) {
  const bars = 24;
  const lit = Math.round(level * bars);
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        role="meter"
        aria-label="Input level"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(level * 100)}
        className="flex h-6 items-end gap-0.5"
      >
        {Array.from({ length: bars }, (_, i) => (
          <span
            key={i}
            className={cn(
              "w-1.5 rounded-sm bg-border",
              active && i < lit && (clipping && i > bars - 4 ? "bg-destructive" : "bg-primary"),
            )}
            style={{ height: `${30 + (i / bars) * 70}%` }}
          />
        ))}
      </div>
      {clipping && <span className="text-meta text-destructive">Input is very loud. Consider moving back a little.</span>}
    </div>
  );
}
