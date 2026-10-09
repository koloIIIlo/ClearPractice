import { useEffect, useRef, useState } from "react";
import { useBlocker, useNavigate, useParams, useSearchParams } from "react-router";
import { CheckCircle2, Circle, Info, Loader2, Mic, RefreshCw, Square } from "lucide-react";
import { toast } from "sonner";
import { Page, Panel, QueryView } from "@/components/page";
import {
  AlertDialog,
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatClock } from "@/lib/format";
import { useExercises, usePhrases, usePreferences, usePrompts, useInputDevices } from "@/lib/ipc/queries";
import { playCue } from "@/lib/tone";
import { useIpc } from "@/lib/ipc";
import type { ExerciseDefinition, PhraseCard, PracticePrompt } from "@/lib/ipc/schemas";
import { ExpressionPanel, expressionPrompt, IMITATION_PROMPT, ImitationPanel, RepeatFocus } from "./ExercisePanels";
import { SequenceBar } from "./SequenceBar";
import { FollowUpPanel } from "./FollowUpPanel";
import { cn } from "@/lib/utils";
import { describeDemands } from "@/features/exercises/describe";
import { useRecorder, type Recorder } from "./recorder";
import { LiveWaveform } from "@/components/live-waveform";
import { RecordingLibrary, SavedAudio } from "./RecordingLibrary";
import { MoveTakeToTrashButton } from "@/features/sessions/TrashPage";
import { PASSAGES, type Passage } from "@/content/passages";
import { BASELINE_PROMPT, CURRICULUM_VERSION } from "@/content/prompts";
import { passagePrompt, ThoughtGroupPassage } from "./ThoughtGroupPassage";

export function StudioPage() {
  const { exerciseId } = useParams();
  const [params] = useSearchParams();
  const exercises = useExercises();
  const prompts = usePrompts();
  const phrases = usePhrases();

  return (
    <Page className="max-w-4xl">
      <QueryView query={exercises}>
        {(exList) => (
          <QueryView query={prompts}>
            {(promptList) => (
            <QueryView query={phrases}>
            {(phraseList) => {
              const exercise = exList.find((e) => e.id === exerciseId) ?? exList[0];
              // Thought groups practise a passage, not a prompt (4.7).
              const passage = exercise.type === "thought_groups" ? (PASSAGES.find((p) => p.id === params.get("passage")) ?? PASSAGES[0]) : undefined;
              // Use a better expression practises a saved phrase (4.9).
              const phrase = exercise.type === "expression" && phraseList.length > 0 ? (phraseList.find((p) => p.id === params.get("phrase")) ?? phraseList[0]) : undefined;
              const asked = params.get("prompt");
              const prompt = passage ? passagePrompt(passage) : phrase ? expressionPrompt(phrase)
                : exercise.type === "imitate" ? IMITATION_PROMPT
                : asked === BASELINE_PROMPT.id ? BASELINE_PROMPT : (promptList.find((p) => p.id === asked) ?? promptList[0]);
              return <Studio key={`${exercise.id}-${prompt.id}`} exercise={exercise} prompt={prompt} passage={passage} phrase={phrase} phrases={phraseList} />;
            }}
            </QueryView>
            )}
          </QueryView>
        )}
      </QueryView>
    </Page>
  );
}

function Studio({ exercise, prompt, passage, phrase, phrases = [] }: { exercise: ExerciseDefinition; prompt: PracticePrompt; passage?: Passage; phrase?: PhraseCard; phrases?: PhraseCard[] }) {
  const ipc = useIpc();
  const native = ipc.recordingMode === "native";
  const [sessionId] = useState(() => crypto.randomUUID());
  const devices = useInputDevices();
  const { preferences, update: updatePreferences } = usePreferences();
  const preferred = devices.data?.find((device) => device.id === preferences.inputDeviceId && device.available)?.id;
  const selectedDevice = preferred || devices.data?.find((device) => device.isDefault && device.available)?.id || devices.data?.find((device) => device.available)?.id || "";
  const setDeviceId = (id: string) => updatePreferences({ inputDeviceId: devices.data?.find((d) => d.id === id)?.isDefault ? null : id });
  const navigate = useNavigate();
  const [useCountdown, setUseCountdown] = useState(false);
  const [outline, setOutline] = useState({ point: "", reason: "", example: "" });
  const rec = useRecorder(prompt.text, { sessionId, exerciseId: exercise.id, exerciseVersion: exercise.version,
    curriculumVersion: CURRICULUM_VERSION, contentId: prompt.id,
    exerciseType: exercise.type, prompt: prompt.text, outline, conditions: prompt.conditions });
  const [announcement, setAnnouncement] = useState("");
  const [trashed, setTrashed] = useState<Set<string>>(() => new Set());
  const [params] = useSearchParams();
  const inSequence = params.get("seq") === "1";
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
      saved: lastTake ? `Take ${lastTake.ordinal} ${native ? "saved" : "simulated"}.` : "",
      interrupted: rec.error ?? "The take was interrupted.",
    };
    setAnnouncement(text[rec.phase] ?? "");
    if (preferences.recordingSounds && native) {
      if (rec.phase === "preparing") playCue("start");
      if (rec.phase === "saved") playCue("stop");
    }
    if (rec.phase === "saved" && lastTake) toast.success(`Take ${lastTake.ordinal} ${native ? "saved" : "simulated"}`);
  }, [rec.phase]);

  // The first-launch baseline is tagged "baseline" once its first take is saved (4.19).
  const tagged = useRef(false);
  useEffect(() => {
    if (prompt.id !== BASELINE_PROMPT.id || !native || tagged.current || rec.takes.length === 0) return;
    tagged.current = true;
    void ipc
      .getSession(sessionId)
      .then((s) => (s.tags.includes("baseline") ? undefined : ipc.updateSession(sessionId, { title: s.title, notes: s.notes, tags: [...s.tags, "baseline"], favorite: s.favorite })))
      .catch(() => { tagged.current = false; });
  }, [rec.takes.length]);

  const primary = () => {
    if (rec.phase === "recording") void rec.stopAndSave();
    else if (rec.phase === "countdown") rec.cancelCountdown();
    else if (!rec.isCapturing) rec.start({ countdownSeconds: useCountdown ? 3 : 0, deviceId: selectedDevice || null });
  };

  // Ctrl+Enter records or stops anywhere on this page, not only when focus is
  // inside the studio (§14). Open dialogs keep their own keyboard handling.
  const primaryRef = useRef(primary);
  primaryRef.current = primary;
  const shortcuts = preferences.recordingShortcuts;
  const canUsePrimary = rec.ready && rec.phase !== "preparing" && rec.phase !== "finalizing" && (rec.isCapturing || !!selectedDevice);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!shortcuts) return;
      if (!(e.ctrlKey || e.metaKey) || e.key !== "Enter" || e.repeat || e.defaultPrevented) return;
      if (document.querySelector("[role=alertdialog], [role=dialog]")) return;
      if (!canUsePrimary) return;
      e.preventDefault();
      primaryRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canUsePrimary, shortcuts]);

  const locked = rec.isCapturing || rec.phase === "countdown";

  return (
    <div ref={studioRef} className="space-y-6">
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {inSequence && <SequenceBar sessionId={sessionId} takeCount={rec.takes.length} locked={locked} />}

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
        {native ? "Recordings stay on this computer. After saving, open the session to transcribe a take, review fillers, pauses and intonation, compare takes, and ask for optional AI feedback." : "Browser preview: recording is simulated. Open the desktop app to capture and save real audio."}
      </div>

      {passage && (
        <ThoughtGroupPassage
          passage={passage}
          locked={locked || rec.takes.length > 0}
          onChoose={(id) => navigate(`/practice/${exercise.id}?passage=${id}`, { replace: true })}
        />
      )}

      {phrase && (
        <ExpressionPanel
          phrase={phrase}
          phrases={phrases}
          sessionId={sessionId}
          hasTake={rec.takes.length > 0}
          locked={locked}
          native={native}
          onChoose={(id) => navigate(`/practice/${exercise.id}?phrase=${id}`, { replace: true })}
        />
      )}
      {exercise.type === "imitate" && <ImitationPanel sessionId={sessionId} hasTake={rec.takes.length > 0} locked={locked} native={native} lastTakeAssetId={rec.takes.at(-1)?.asset.assetId} />}
      {exercise.type === "repeat" && (
        <FollowUpPanel prompt={prompt} sessionId={sessionId} lastTakeId={rec.takes.at(-1)?.asset.assetId} takeCount={rec.takes.length} native={native} locked={locked} />
      )}
      {exercise.type === "repeat" && !prompt.conditions.followUp && <RepeatFocus sessionId={sessionId} takeCount={rec.takes.length} locked={locked} native={native} />}

      {!passage && !phrase && exercise.type !== "imitate" && <fieldset disabled={locked} className="grid gap-3 sm:grid-cols-3">
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
      </fieldset>}

      <div className="space-y-1">
        <Label htmlFor="studio-microphone">Microphone</Label>
        <div className="flex items-center gap-2">
          <Select value={selectedDevice} onValueChange={setDeviceId} disabled={locked || devices.isPending}>
            <SelectTrigger id="studio-microphone" className="min-w-0 flex-1">
              <SelectValue placeholder={devices.isPending ? "Looking for microphones…" : "No microphone found"} />
            </SelectTrigger>
            <SelectContent>
              {devices.data?.map((device) => <SelectItem key={device.id} value={device.id} disabled={!device.available}>{device.name}{device.isDefault ? " (system default)" : ""}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" title="Refresh microphones" aria-label={devices.isFetching ? "Looking for microphones…" : "Refresh microphones"} disabled={locked || devices.isFetching} onClick={() => void devices.refetch()}>
            <RefreshCw aria-hidden className={devices.isFetching ? "animate-spin" : undefined} />
          </Button>
        </div>
        {devices.error && <p role="alert" className="text-meta text-destructive">{devices.error.message}</p>}
      </div>
      {rec.error && <p role="alert" className="rounded-lg border p-3 text-destructive">{rec.error}</p>}

      <Panel className="flex flex-col items-center gap-5 py-10">
        <RecorderStatus rec={rec} />
        <div className="text-5xl font-medium tabular-nums" aria-label="Elapsed time">
          {rec.phase === "countdown" ? rec.countdown : formatClock(rec.elapsedMs)}
        </div>
        <LiveWaveform levels={rec.levels} level={rec.level} active={rec.phase === "recording"} clipping={rec.clipping} />
        <Button
          size="lg"
          onClick={primary}
          disabled={!canUsePrimary}
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
          {shortcuts ? "Ctrl+Enter to record or stop. " : ""}The timer is for information only, so there's no need to rush.
        </p>
      </Panel>

      <section aria-labelledby="takes-heading">
        <h2 id="takes-heading" className="mb-3 font-semibold">
          Takes
        </h2>
        {rec.takes.length === 0 ? (
          <p className="text-muted-foreground">No takes yet. {native ? "Each take is saved as soon as you stop." : "This preview simulates the recording flow."}</p>
        ) : (
          <ol className="divide-y rounded-panel border bg-card">
            {rec.takes.map((t) => (
              <li key={t.ordinal} className="space-y-3 px-4 py-3">
                <div className="flex items-center gap-3">
                  <CheckCircle2 aria-hidden className="size-4 text-primary" />
                <span className="flex-1">Take {t.ordinal}</span>
                <span className="text-meta text-muted-foreground tabular-nums">{formatClock(t.durationMs)}</span>
                <span className="text-meta">{trashed.has(t.asset.assetId) ? "In Trash" : native ? "Saved" : "Simulated"}</span>
                {native && !trashed.has(t.asset.assetId) && (
                  <MoveTakeToTrashButton
                    take={{ id: t.asset.assetId, ordinal: t.ordinal, durationMs: t.durationMs }}
                    sessionTitle={prompt.text}
                    onMoved={() => setTrashed((s) => new Set(s).add(t.asset.assetId))}
                    onRestored={() => setTrashed((s) => { const next = new Set(s); next.delete(t.asset.assetId); return next; })}
                  />
                )}
                </div>
                {trashed.has(t.asset.assetId) ? (
                  <p className="text-meta text-muted-foreground">Moved to Trash. Restore it from the toast or from Sessions → Trash.</p>
                ) : (
                  <SavedAudio recording={t.asset} />
                )}
              </li>
            ))}
          </ol>
        )}
        {rec.takes.length > 0 && !locked && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => navigate("/")}>
              Return to Today
            </Button>
          </div>
        )}
      </section>
      <RecordingLibrary />

      <AlertDialog open={blocker.state === "blocked" || rec.closeRequested}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>A take is still recording</AlertDialogTitle>
            <AlertDialogDescription>
              Stop and save it before leaving, or keep recording. Leaving never discards audio silently.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { blocker.reset?.(); rec.continueRecording(); }}>Continue recording</AlertDialogCancel>
            <Button
              disabled={rec.phase === "finalizing"}
              onClick={async () => {
                if (rec.closeRequested) await rec.saveAndClose();
                else if (await rec.stopAndSave()) blocker.proceed?.();
              }}
            >
              Stop and save
            </Button>
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
    saved: { text: "Take complete", tone: "text-primary" },
    interrupted: { text: "Recording interrupted", tone: "text-destructive" },
  } as const;
  const { text, tone } = map[rec.phase];
  return (
    <p className={cn("inline-flex items-center gap-2 font-medium", tone)}>
      {rec.phase === "recording" && <Circle aria-hidden className="size-3 fill-current" />}
      {text}
    </p>
  );
}
