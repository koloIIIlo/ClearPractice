import { useEffect, useRef, useState } from "react";
import { Link, useBlocker, useNavigate, useParams, useSearchParams } from "react-router";
import { Check, CheckCircle2, ChevronRight, Info, Loader2, Mic, RefreshCw, Square } from "lucide-react";
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
import { LiveWaveform, levelToHeight } from "@/components/live-waveform";
import { RecordingLibrary, SavedAudio } from "./RecordingLibrary";
import { NativeTake } from "@/features/sessions/NativeSession";
import { TakeTranscript } from "@/features/review/TakeTranscript";
import { TakeSummary } from "@/features/review/TakeSummary";
import { createPlayerLink } from "@/features/review/player-link";
import { useQuery } from "@tanstack/react-query";
import type { SavedRecording } from "@/lib/ipc/schemas";
import { MoveTakeToTrashButton } from "@/features/sessions/TrashPage";
import { PASSAGES, type Passage } from "@/content/passages";
import { BASELINE_PROMPT, CURRICULUM_VERSION } from "@/content/prompts";
import { passagePrompt, ThoughtGroupPassage } from "./ThoughtGroupPassage";

/**
 * A take in the Studio with its transcript underneath (user request
 * 2026-10-09): transcribe without leaving, so the follow-up question and
 * AI requests that need a transcript work in place. The take's summary sits
 * between the player and the transcript, in the same place for every take.
 */
function TakeWithTranscript({ attemptId, recording, reviewHref }: { attemptId: string; recording?: SavedRecording; reviewHref: string }) {
  const [link] = useState(createPlayerLink);
  return (
    <div className="space-y-3">
      {recording ? <SavedAudio recording={recording} link={link} /> : <NativeTake assetId={attemptId} link={link} />}
      <TakeSummary attemptId={attemptId} reviewHref={reviewHref} />
      <TakeTranscript attemptId={attemptId} link={link} />
    </div>
  );
}

/**
 * One take in the list. Only the latest is open by default, so the Studio
 * doesn't grow by a player and a transcript for every take; the rest fold to
 * one line and open on demand. Everything here sits below the recorder.
 */
function TakeRow({ open, onOpenChange, label, meta, status, done, action, children }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: React.ReactNode;
  meta: string;
  status?: string;
  done: boolean;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <li className="px-4 py-2">
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <div className="flex items-center gap-3">
          <CollapsibleTrigger className="flex h-10 min-w-0 flex-1 items-center gap-3 rounded-md text-left hover:text-foreground">
            <ChevronRight aria-hidden className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
            <CheckCircle2 aria-hidden className={cn("size-4 shrink-0", done ? "text-primary" : "text-muted-foreground")} />
            <span className="min-w-0 flex-1">{label}</span>
            <span className="text-meta text-muted-foreground tabular-nums">{meta}</span>
            {status && <span className="text-meta">{status}</span>}
          </CollapsibleTrigger>
          {action}
        </div>
        <CollapsibleContent className="mt-2 mb-1 space-y-3">{children}</CollapsibleContent>
      </Collapsible>
    </li>
  );
}

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
  const [params] = useSearchParams();
  // Continue an earlier session (?session=<id>): new takes are added to it.
  const continuing = params.get("session");
  const [sessionId] = useState(() => continuing ?? crypto.randomUUID());
  const earlier = useQuery({ queryKey: ["session", continuing ?? ""], queryFn: () => ipc.getSession(continuing!), enabled: native && !!continuing, retry: false });
  const earlierTakes = (earlier.data?.attempts ?? []).filter((a) => !a.audioUnavailableReason);
  const devices = useInputDevices();
  const { preferences, update: updatePreferences } = usePreferences();
  const preferred = devices.data?.find((device) => device.id === preferences.inputDeviceId && device.available)?.id;
  const selectedDevice = preferred || devices.data?.find((device) => device.isDefault && device.available)?.id || devices.data?.find((device) => device.available)?.id || "";
  const setDeviceId = (id: string) => updatePreferences({ inputDeviceId: devices.data?.find((d) => d.id === id)?.isDefault ? null : id });
  const navigate = useNavigate();
  const [useCountdown, setUseCountdown] = useState(false);
  const [outline, setOutline] = useState({ point: "", reason: "", example: "" });
  // Open for a fresh prompt; folded when continuing a session. It never folds by
  // itself after a take: it sits above the recorder, which must not move (§3.2).
  const [outlineOpen, setOutlineOpen] = useState(!continuing);
  const outlineWords = [outline.point, outline.reason, outline.example].map((w) => w.trim()).filter(Boolean);
  // Takes you opened or closed by hand; otherwise only the latest is open.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const rec = useRecorder(prompt.text, { sessionId, exerciseId: exercise.id, exerciseVersion: exercise.version,
    curriculumVersion: CURRICULUM_VERSION, contentId: prompt.id,
    exerciseType: exercise.type, prompt: prompt.text, outline, conditions: prompt.conditions });
  const [announcement, setAnnouncement] = useState("");
  const [trashed, setTrashed] = useState<Set<string>>(() => new Set());
  const newIds = new Set(rec.takes.map((t) => t.asset.assetId));
  const shownEarlier = earlierTakes.filter((a) => !newIds.has(a.id));
  const allTakeCount = shownEarlier.length + rec.takes.length;
  const lastTakeId = rec.takes.at(-1)?.asset.assetId ?? shownEarlier.at(-1)?.id;
  const inSequence = params.get("seq") === "1";
  const studioRef = useRef<HTMLDivElement>(null);
  const takeOpen = (id: string) => expanded[id] ?? id === lastTakeId;
  const setTakeOpen = (id: string) => (open: boolean) => setExpanded((e) => ({ ...e, [id]: open }));
  const reviewHref = (ordinal: number) => `/sessions/${sessionId}/attempt/${ordinal}`;

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
        {native ? "Recordings stay on this computer. Transcribe a take below it to see what went well and one thing to try; open the session to compare takes or ask for AI feedback." : "Browser preview: recording is simulated. Open the desktop app to capture and save real audio."}
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

      {!passage && !phrase && exercise.type !== "imitate" && (
        <Collapsible open={outlineOpen} onOpenChange={setOutlineOpen}>
          <CollapsibleTrigger className="flex min-h-7 max-w-full items-center gap-2 rounded-sm text-left text-meta font-medium hover:text-foreground">
            <ChevronRight aria-hidden className={cn("size-4 shrink-0 text-muted-foreground transition-transform", outlineOpen && "rotate-90")} />
            Outline (optional, up to three keywords)
            {!outlineOpen && outlineWords.length > 0 && <span className="min-w-0 truncate font-normal text-muted-foreground">· {outlineWords.join(" · ")}</span>}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <fieldset disabled={locked} className="mt-2 grid gap-3 sm:grid-cols-3">
              <legend className="sr-only">Outline</legend>
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
          </CollapsibleContent>
        </Collapsible>
      )}

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

      <Panel className="flex flex-col items-center gap-4 py-8">
        <RecorderStatus rec={rec} />
        <div className="text-5xl font-semibold tracking-tight tabular-nums" aria-label="Elapsed time">
          {rec.phase === "countdown" ? rec.countdown : formatClock(rec.elapsedMs)}
        </div>
        <LiveWaveform levels={rec.levels} level={rec.level} active={rec.phase === "recording"} clipping={rec.clipping} />
        {/* The one thing to change sits inside the recorder, in view while speaking. */}
        {exercise.type === "repeat" && !prompt.conditions.followUp && (
          <RepeatFocus sessionId={sessionId} takeCount={rec.takes.length} locked={locked} native={native} />
        )}
        <Button
          size="lg"
          onClick={primary}
          disabled={!canUsePrimary}
          // One solid primary: Stop while recording; in a sequence, Next step takes over once a take exists.
          variant={rec.phase !== "recording" && inSequence && rec.takes.length > 0 ? "outline" : "default"}
          className={cn("min-w-44 rounded-full", rec.phase === "recording" && "level-halo")}
          style={rec.phase === "recording" ? ({ "--level": levelToHeight(rec.level) } as React.CSSProperties) : undefined}
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

      {/* Between-takes guidance appears below the recorder, so Record never moves when it shows up (§3.2). */}
      {exercise.type === "repeat" && (
        <FollowUpPanel prompt={prompt} sessionId={sessionId} lastTakeId={lastTakeId} takeCount={allTakeCount} native={native} locked={locked} />
      )}

      <section aria-labelledby="takes-heading">
        <h2 id="takes-heading" className="mb-3 font-semibold">
          Takes
        </h2>
        {continuing && earlier.data && (
          <p className="mb-3 text-meta text-muted-foreground">
            Continuing “{earlier.data.title}”: new takes are added to this session. <Link className="underline" to={`/sessions/${continuing}`}>Open the session</Link>
          </p>
        )}
        {continuing && earlier.error && <p role="alert" className="mb-3 text-meta text-destructive">{earlier.error.message} New takes start a new session.</p>}
        {shownEarlier.length > 0 && (
          <ol className="mb-3 divide-y rounded-panel border bg-card" aria-label="Earlier takes in this session">
            {shownEarlier.map((a) => (
              <TakeRow
                key={a.id}
                open={takeOpen(a.id)}
                onOpenChange={setTakeOpen(a.id)}
                done={false}
                label={<>Take {a.ordinal} <span className="text-meta text-muted-foreground">· earlier</span></>}
                meta={formatClock(a.durationMs)}
              >
                <TakeWithTranscript attemptId={a.id} reviewHref={reviewHref(a.ordinal)} />
              </TakeRow>
            ))}
          </ol>
        )}
        {rec.takes.length === 0 ? (
          shownEarlier.length === 0 && 
          <p className="text-muted-foreground">No takes yet. {native ? "Each take is saved as soon as you stop." : "This preview simulates the recording flow."}</p>
        ) : (
          <ol className="divide-y rounded-panel border bg-card">
            {rec.takes.map((t) => (
              <TakeRow
                key={t.ordinal}
                open={takeOpen(t.asset.assetId)}
                onOpenChange={setTakeOpen(t.asset.assetId)}
                done
                label={`Take ${t.ordinal}`}
                meta={formatClock(t.durationMs)}
                status={trashed.has(t.asset.assetId) ? "In Trash" : native ? "Saved" : "Simulated"}
                action={native && !trashed.has(t.asset.assetId) && (
                  <MoveTakeToTrashButton
                    take={{ id: t.asset.assetId, ordinal: t.ordinal, durationMs: t.durationMs }}
                    sessionTitle={prompt.text}
                    onMoved={() => setTrashed((s) => new Set(s).add(t.asset.assetId))}
                    onRestored={() => setTrashed((s) => { const next = new Set(s); next.delete(t.asset.assetId); return next; })}
                  />
                )}
              >
                {trashed.has(t.asset.assetId) ? (
                  <p className="text-meta text-muted-foreground">Moved to Trash. Restore it from the toast or from Sessions → Trash.</p>
                ) : native ? (
                  <TakeWithTranscript attemptId={t.asset.assetId} recording={t.asset} reviewHref={reviewHref(t.ordinal)} />
                ) : (
                  <>
                    <SavedAudio recording={t.asset} />
                    <TakeSummary attemptId={t.asset.assetId} />
                  </>
                )}
              </TakeRow>
            ))}
          </ol>
        )}
        {/* In a sequence the step bar's Leave sequence is the one way out. */}
        {allTakeCount > 0 && !locked && !inSequence && (
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

/** The recorder's state as a small pill; a live dot pulses while recording (still under reduced motion). */
function RecorderStatus({ rec }: { rec: Recorder }) {
  const quiet = "bg-secondary text-muted-foreground";
  const map = {
    idle: { text: "Ready", tone: quiet },
    countdown: { text: "Get ready. Not recording yet", tone: quiet },
    preparing: { text: "Opening microphone…", tone: quiet },
    recording: { text: "Recording", tone: "bg-destructive/10 text-destructive" },
    finalizing: { text: "Saving…", tone: quiet },
    saved: { text: "Take complete", tone: "bg-primary/10 text-primary" },
    interrupted: { text: "Recording interrupted", tone: "bg-destructive/10 text-destructive" },
  } as const;
  const { text, tone } = map[rec.phase];
  return (
    <p className={cn("inline-flex h-7 items-center gap-2 rounded-full px-3 text-meta font-medium", tone)}>
      {rec.phase === "recording" && (
        <span aria-hidden className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-current" />
        </span>
      )}
      {rec.phase === "saved" && <Check aria-hidden className="size-3.5" />}
      {text}
    </p>
  );
}
