import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Columns2, FileSearch, Mic, Sparkles } from "lucide-react";
import { EvidenceLabel, MetricRow } from "@/components/evidence";
import { EmptyState, ErrorState, LoadingBlock, Page, Panel, QueryView } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { formatClock, formatLongDay } from "@/lib/format";
import { IpcError, useIpc } from "@/lib/ipc";
import { NativeSession } from "@/features/sessions/NativeSession";
import { MoveToTrashButton } from "@/features/sessions/TrashPage";
import { AskListenerButton } from "@/features/events/ListenerPackDialog";
import { ListenerAnswers } from "@/features/events/ListenerAnswers";
import { useAttemptReview, useServiceStatus, useSession } from "@/lib/ipc/queries";
import type { AttemptReview, Observation, SessionDetail } from "@/lib/ipc/schemas";
import { cn } from "@/lib/utils";
import { useSimulatedPlayback, useSpaceToPlay } from "./playback";
import { Transcript } from "./Transcript";
import { Transport } from "./Transport";

export function ReviewPage() {
  const ipc = useIpc();
  const { sessionId, ordinal } = useParams();
  const session = useSession(sessionId);

  if (session.isError && session.error instanceof IpcError && session.error.code === "not_found") {
    return (
      <Page>
        <EmptyState title="This session isn't available" action={<Link to="/sessions">Back to sessions</Link>}>
          It may have been moved to Trash.
        </EmptyState>
      </Page>
    );
  }

  return (
    <Page className="max-w-7xl">
      <QueryView query={session} loading={<LoadingBlock rows={5} label="Loading session" />}>
        {(s) => {
          if (ipc.recordingMode === "native") return <NativeSession key={s.id} session={s} selectedOrdinal={ordinal ? Number(ordinal) : undefined} />;
          const attempt = ordinal ? s.attempts.find((a) => a.ordinal === Number(ordinal)) : s.attempts.at(-1);
          if (!attempt)
            return (
              <EmptyState title="This take doesn't exist" action={<Link to={`/sessions/${s.id}`}>Latest take</Link>} />
            );
          return <Review key={attempt.id} session={s} attemptId={attempt.id} ordinal={attempt.ordinal} />;
        }}
      </QueryView>
    </Page>
  );
}

function Review({ session, attemptId, ordinal }: { session: SessionDetail; attemptId: string; ordinal: number }) {
  const review = useAttemptReview(attemptId);
  const attempt = session.attempts.find((a) => a.id === attemptId)!;
  const navigate = useNavigate();

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <p className="text-meta text-muted-foreground">
            {formatLongDay(session.localDate)} · {attempt.firstTake ? "First take" : `Take ${ordinal}`} ·{" "}
            {session.conditions === null ? "Task conditions unavailable" : session.conditions.familiarity === "unfamiliar" ? "Unfamiliar topic" : "Familiar topic"}
          </p>
          <h1 className="text-title font-semibold tracking-tight">{session.title}</h1>
          <p className="text-muted-foreground">{session.prompt}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MoveToTrashButton session={session} />
          <span aria-hidden className="mx-1 h-6 w-px bg-border" />
          <AskListenerButton attemptId={attemptId} size="default" />
          {session.attempts.length > 1 && (
            <Button variant="outline" asChild>
              <Link to={`/sessions/${session.id}/compare`}>
                <Columns2 aria-hidden /> Compare takes
              </Link>
            </Button>
          )}
          <Button
            onClick={() =>
              navigate(`/practice/ex-${(session.exerciseType ?? "repeat").replace("_", "-")}`, { state: { section: "sessions" } })
            }
          >
            <Mic aria-hidden /> Try again
          </Button>
        </div>
      </header>

      {session.attempts.length > 1 && (
        <nav aria-label="Takes" className="mb-4 flex flex-wrap gap-1">
          {session.attempts.map((a) => (
            <Link
              key={a.id}
              to={`/sessions/${session.id}/attempt/${a.ordinal}`}
              aria-current={a.ordinal === ordinal ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-1.5 text-meta hover:bg-secondary",
                a.ordinal === ordinal && "bg-secondary font-medium",
              )}
            >
              Take {a.ordinal} · <span className="tabular-nums">{formatClock(a.durationMs)}</span>
            </Link>
          ))}
        </nav>
      )}

      <QueryView query={review} loading={<LoadingBlock rows={4} label="Loading transcript" />}>
        {(r) => <ReviewBody session={session} review={r} durationMs={attempt.durationMs} />}
      </QueryView>
      <div className="mt-6">
        <ListenerAnswers sessionId={session.id} title="Listeners' answers" withImport />
      </div>
    </>
  );
}

function ReviewBody({ session, review, durationMs }: { session: SessionDetail; review: AttemptReview; durationMs: number }) {
  const playback = useSimulatedPlayback(durationMs);
  useSpaceToPlay(playback.toggle);
  const raw = review.revisions.find((r) => r.kind === "raw");
  const [notes, setNotes] = useState(session.notes);

  const playFrom = (ms: number) => {
    playback.seek(ms);
    if (!playback.playing) playback.toggle();
  };

  return (
    <div className="space-y-4">
      <Transport playback={playback} segments={raw?.segments ?? []} />

      {/* Two columns from 1100px; feedback stacks below the transcript on narrower windows (§4). */}
      <div className="grid items-start gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_20rem]">
        <Panel className="p-3 sm:p-4">
          <Tabs defaultValue="raw">
            <TabsList className="mb-3">
              <TabsTrigger value="raw">As transcribed</TabsTrigger>
              <TabsTrigger value="mine">My corrections</TabsTrigger>
              <TabsTrigger value="suggested">Suggested wording</TabsTrigger>
            </TabsList>
            <TabsContent value="raw">
              {raw ? (
                <Transcript revision={raw} positionMs={playback.positionMs} onSeek={playback.seek} onPlayRange={playFrom} attemptId={review.attemptId} />
              ) : (
                <ErrorState
                  title="No transcript for this take"
                  error={new Error("Transcription didn't run or failed. The recording itself is saved.")}
                />
              )}
            </TabsContent>
            <TabsContent value="mine">
              <EmptyState title="No corrections yet">
                Correcting a word creates a new revision. The original transcript and the recording stay unchanged.
              </EmptyState>
            </TabsContent>
            <TabsContent value="suggested">
              <EmptyState title="No suggested wording yet">
                Suggested wording appears here after you ask for feedback.
              </EmptyState>
            </TabsContent>
          </Tabs>
        </Panel>

        <div className="space-y-4">
          <FeedbackPanel observations={review.observations} onSeekSegment={(segId) => {
            const seg = raw?.segments.find((s) => s.id === segId);
            if (seg) playback.seek(seg.startMs);
          }} />
          <CoachingPanel session={session} review={review} />
          <Panel>
            <h2 className="mb-1 font-semibold">Measures</h2>
            <div className="divide-y">
              {review.metrics.map((m) => (
                <MetricRow key={m.key} metric={m} />
              ))}
            </div>
          </Panel>
          <Panel>
            <Label htmlFor="session-notes" className="mb-2 block font-semibold">
              Notes
            </Label>
            <Textarea
              id="session-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What did you notice? What will you try next time?"
              rows={4}
            />
          </Panel>
        </div>
      </div>
    </div>
  );
}

/** One useful observation up front; the rest collapsed (§6). */
function FeedbackPanel({ observations, onSeekSegment }: { observations: Observation[]; onSeekSegment: (id: string) => void }) {
  const [main, ...rest] = observations;
  if (!main)
    return (
      <Panel>
        <h2 className="mb-1 font-semibold">Feedback</h2>
        <p className="text-muted-foreground">Nothing stood out. Listen back and add a note if something did.</p>
      </Panel>
    );
  return (
    <Panel aria-labelledby="feedback-heading">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id="feedback-heading" className="font-semibold">
          One thing to try
        </h2>
        <EvidenceLabel source={main.source} />
      </div>
      <ObservationBody o={main} onSeekSegment={onSeekSegment} />
      {rest.length > 0 && (
        <Collapsible className="mt-4 border-t pt-3">
          <CollapsibleTrigger className="text-meta font-medium text-muted-foreground hover:text-foreground">
            {rest.length} more {rest.length === 1 ? "observation" : "observations"}
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 space-y-4">
            {rest.map((o) => (
              <div key={o.id} className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{o.title}</p>
                  <EvidenceLabel source={o.source} />
                </div>
                <ObservationBody o={o} onSeekSegment={onSeekSegment} hideTitle />
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}
    </Panel>
  );
}

function ObservationBody({ o, onSeekSegment, hideTitle }: { o: Observation; onSeekSegment: (id: string) => void; hideTitle?: boolean }) {
  return (
    <div className="space-y-2">
      {!hideTitle && <p className="text-lg font-medium">{o.title}</p>}
      <p className="text-muted-foreground">{o.detail}</p>
      {o.quote && (
        <blockquote className="border-l-2 border-primary pl-3">
          “{o.quote}”
          {o.segmentId && (
            <button
              type="button"
              // Padding offset by negative margins: the target grows past 24 px, the line stays put.
              className="-my-1 ml-2 inline-block rounded py-1 text-meta text-primary hover:underline"
              onClick={() => onSeekSegment(o.segmentId!)}
            >
              Find in recording
            </button>
          )}
        </blockquote>
      )}
      {o.nextAction && <p className="font-medium">{o.nextAction}</p>}
    </div>
  );
}

/**
 * Coaching is an explicit request. The user can see exactly what would be sent,
 * and nothing leaves the computer automatically (§6, §10).
 */
function CoachingPanel({ session, review }: { session: SessionDetail; review: AttemptReview }) {
  const status = useServiceStatus();
  const coaching = status.data?.coaching;
  const raw = review.revisions.find((r) => r.kind === "raw");
  const text = raw?.segments.map((s) => s.text).join(" ") ?? "";
  const ready = coaching?.mode !== "off" && coaching?.state === "ready";
  const label =
    coaching?.mode === "off" ? "Off" : coaching?.mode === "local_llm" ? "Local LLM" : `API${coaching?.providerLabel ? ` · ${coaching.providerLabel}` : ""}`;

  return (
    <Panel aria-labelledby="coaching-heading">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id="coaching-heading" className="font-semibold">
          Coaching
        </h2>
        <span className="text-meta text-muted-foreground">{label}</span>
      </div>
      {coaching?.mode === "off" ? (
        <p className="text-muted-foreground">Coaching is off. Playback, the transcript, and your notes work as usual.</p>
      ) : (
        <>
          <p className="text-meta text-muted-foreground">
            Sends only the transcript text below, the prompt, and your focus to the selected provider. The audio stays on
            this computer. API calls may be billed by your provider.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button disabled={!ready || !raw}>
              <Sparkles aria-hidden /> Get feedback
            </Button>
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" disabled={!raw}>
                  <FileSearch aria-hidden /> View text to send
                </Button>
              </SheetTrigger>
              <SheetContent className="w-full sm:max-w-lg">
                <SheetHeader>
                  <SheetTitle>Text that would be sent</SheetTitle>
                  <SheetDescription>
                    Exactly this, and nothing else from your history. Recipient: {label}.
                  </SheetDescription>
                </SheetHeader>
                <dl className="space-y-4 overflow-y-auto px-4 pb-6 text-body">
                  <div>
                    <dt className="text-meta font-medium text-muted-foreground">Prompt</dt>
                    <dd>{session.prompt}</dd>
                  </div>
                  <div>
                    <dt className="text-meta font-medium text-muted-foreground">Focus</dt>
                    <dd>{session.focus ?? "None selected"}</dd>
                  </div>
                  <div>
                    <dt className="text-meta font-medium text-muted-foreground">Transcript (as transcribed)</dt>
                    <dd className="rounded-md bg-muted p-3 whitespace-pre-wrap">{text}</dd>
                  </div>
                  <p className="text-meta text-muted-foreground">
                    ≈ {Math.ceil(text.length / 4)} tokens. In the desktop app you can hide words (names, places) before anything is sent.
                  </p>
                </dl>
              </SheetContent>
            </Sheet>
          </div>
          {!ready && (
            <p className="mt-2 text-meta">
              Not set up yet.{" "}
              <Link to="/settings/coaching" className="text-primary hover:underline">
                Choose a provider in Settings
              </Link>
              .
            </p>
          )}
        </>
      )}
    </Panel>
  );
}
