import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { CheckCircle2, ChevronRight, Info } from "lucide-react";
import { Page, QueryView } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatClock } from "@/lib/format";
import { useExercises, usePhrases, usePreferences, usePrompts } from "@/lib/ipc/queries";
import { useIpc } from "@/lib/ipc";
import type { ExerciseDefinition, PhraseCard, PracticePrompt } from "@/lib/ipc/schemas";
import { ExpressionPanel, expressionPrompt, IMITATION_PROMPT, ImitationPanel, RepeatFocus } from "./ExercisePanels";
import { SequenceBar } from "./SequenceBar";
import { FollowUpPanel } from "./FollowUpPanel";
import { cn } from "@/lib/utils";
import { describeDemands } from "@/features/exercises/describe";
import { useRecorder } from "./recorder";
import { RecorderPanel, useRecorderGuard } from "./RecorderPanel";
import { useAutoTranscribe } from "./auto-transcribe";
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
      <TakeSummary attemptId={attemptId} reviewHref={reviewHref} link={link} durationMs={recording?.durationMs} />
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
  const { preferences } = usePreferences();
  const navigate = useNavigate();
  const [outline, setOutline] = useState({ point: "", reason: "", example: "" });
  // Folded by default so the recorder fits on one screen (user request 2026-10-10);
  // the typed keywords show on the folded line. It never folds or opens by itself:
  // it sits above the recorder, which must not move (§3.2).
  const [outlineOpen, setOutlineOpen] = useState(false);
  const outlineWords = [outline.point, outline.reason, outline.example].map((w) => w.trim()).filter(Boolean);
  // Takes you opened or closed by hand; otherwise only the latest is open.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const rec = useRecorder(prompt.text, { sessionId, exerciseId: exercise.id, exerciseVersion: exercise.version,
    curriculumVersion: CURRICULUM_VERSION, contentId: prompt.id,
    exerciseType: exercise.type, prompt: prompt.text, outline, conditions: prompt.conditions });
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

  // Never silently abandon a take by navigating away (§6 Practice studio).
  const guard = useRecorderGuard(rec);

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

  const locked = rec.isCapturing || rec.phase === "countdown";
  useAutoTranscribe(rec.takes.map((t) => t.asset.assetId), sessionId, { enabled: preferences.autoTranscribe });

  return (
    <div ref={studioRef} className="space-y-6">
      {inSequence && <SequenceBar sessionId={sessionId} takeCount={rec.takes.length} locked={locked} />}

      <header className="space-y-2">
        <p className="text-meta text-muted-foreground">
          {exercise.title} · Take {Math.max(1, takeNumber)}
        </p>
        <h1 className="text-title font-semibold tracking-tight text-balance">{prompt.text}</h1>
        <p className="text-meta text-muted-foreground">{describeDemands(prompt.conditions).join(" · ")}</p>
      </header>

      {/* The desktop app needs no notice here (user request 2026-10-10); only the preview says it is simulated. */}
      {!native && (
        <p role="note" className="flex items-center gap-2 text-meta text-muted-foreground">
          <Info aria-hidden className="size-4 shrink-0" /> Browser preview: recording is simulated.
        </p>
      )}

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

      {rec.error && <p role="alert" className="rounded-lg border p-3 text-destructive">{rec.error}</p>}

      <RecorderPanel
        rec={rec}
        tourId="record"
        // In a sequence, Next step takes over as the one solid primary once a take exists.
        deemphasize={inSequence && rec.takes.length > 0}
        // The one thing to change sits inside the recorder, in view while speaking.
        inside={exercise.type === "repeat" && !prompt.conditions.followUp ? <RepeatFocus sessionId={sessionId} takeCount={rec.takes.length} locked={locked} native={native} /> : undefined}
      />

      {/* Between-takes guidance appears below the recorder, so Record never moves when it shows up (§3.2). */}
      {exercise.type === "repeat" && (
        <FollowUpPanel prompt={prompt} sessionId={sessionId} lastTakeId={lastTakeId} takeCount={allTakeCount} native={native} locked={locked} />
      )}

      <section data-tour="takes" aria-labelledby="takes-heading">
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

      {guard}
    </div>
  );
}

