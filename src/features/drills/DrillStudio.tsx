import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { Info, ListChecks } from "lucide-react";
import { EmptyState, ErrorState, LoadingBlock, Page, Panel } from "@/components/page";
import { Button } from "@/components/ui/button";
import { drillById, type DrillDef } from "@/content/drills";
import { useIpc } from "@/lib/ipc";
import type { PracticeContext } from "@/lib/ipc/client";
import { usePreferences, usePrompts } from "@/lib/ipc/queries";
import type { PracticePrompt } from "@/lib/ipc/schemas";
import { toLocalDate } from "@/lib/phrase-schedule";
import { useAutoTranscribe } from "@/features/practice/auto-transcribe";
import { useRecorder } from "@/features/practice/recorder";
import { RecorderPanel, useRecorderGuard } from "@/features/practice/RecorderPanel";
import { RecordingLibrary } from "@/features/practice/RecordingLibrary";
import { SequenceBar } from "@/features/practice/SequenceBar";
import { CountdownRing, lightAt } from "./CountdownRing";
import { DRILL_MODULES, type DrillModule, type DrillParams, type DrillPlan } from "./drill-module";
import { newSeed } from "./plan-helpers";
import { useDrillClock, type DrillClock } from "./useDrillClock";

/**
 * The drill studio (roadmap 10.1), at /drill/:drillId. One studio for every
 * drill: rules, the drill's setup, then each round with the shared recorder
 * (the same audio safety as the Studio), its clock and the drill's live view,
 * then the drill's result. A new topic is a new session; "Same topic" adds a
 * take to this one.
 */
export function DrillStudioPage() {
  const { drillId = "" } = useParams();
  const [search] = useSearchParams();
  const drill = drillById(drillId);
  if (!drill) {
    return (
      <Page>
        <EmptyState
          icon={ListChecks}
          title="This drill doesn't exist"
          action={
            <Button variant="outline" asChild>
              <Link to="/exercises?tab=drills">All drills</Link>
            </Button>
          }
        >
          It may have been renamed. Choose one from the Drills tab.
        </EmptyState>
      </Page>
    );
  }
  const seed = search.get("seed");
  return (
    <Page className="max-w-4xl">
      <DrillLoader key={`${drill.id}:${seed ?? ""}`} drill={drill} seed={seed} />
    </Page>
  );
}

const loaded = new Map<string, DrillModule>();

function DrillLoader({ drill, seed }: { drill: DrillDef; seed: string | null }) {
  const [module, setModule] = useState<DrillModule | null>(() => loaded.get(drill.type) ?? null);
  const [error, setError] = useState<unknown>(null);
  const prompts = usePrompts();
  // A fresh seed for each play unless the address names one (links to a past round).
  const [playSeed] = useState(() => seed ?? newSeed());
  useEffect(() => {
    if (module) return;
    let alive = true;
    DRILL_MODULES[drill.type]().then(
      (m) => {
        loaded.set(drill.type, m);
        if (alive) setModule(m);
      },
      (e: unknown) => alive && setError(e),
    );
    return () => {
      alive = false;
    };
  }, [drill.type, module]);
  if (error) return <ErrorState error={error} title="This drill couldn't be opened" />;
  if (prompts.error) return <ErrorState error={prompts.error} onRetry={() => void prompts.refetch()} />;
  if (!module || !prompts.data) return <LoadingBlock rows={3} label="Opening the drill" />;
  return <DrillRun drill={drill} module={module} prompts={prompts.data} seed={playSeed} />;
}

/** Address parameters a drill may read (`?topic=jam-001`); everything else is ignored. */
function paramsFrom(search: URLSearchParams): DrillParams {
  const params: DrillParams = {};
  for (const [k, v] of search) if (k !== "seed" && /^[a-zA-Z0-9_]{1,40}$/.test(k) && v.length <= 96) params[k] = v;
  return params;
}

function DrillRun({ drill, module, prompts, seed }: { drill: DrillDef; module: DrillModule; prompts: PracticePrompt[]; seed: string }) {
  const ipc = useIpc();
  const native = ipc.recordingMode === "native";
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const { preferences } = usePreferences();
  const today = toLocalDate(new Date());
  const ctx = useMemo(() => ({ prompts, today }), [prompts, today]);
  const [plan, setPlan] = useState<DrillPlan>(() => module.plan(seed, paramsFrom(search), ctx));
  const [ready, setReady] = useState(!module.Setup);
  const [sessionId] = useState(() => module.sessionId?.(plan) ?? crypto.randomUUID());
  const [roundIndex, setRoundIndex] = useState(0);
  const round = plan.rounds[Math.min(roundIndex, plan.rounds.length - 1)];
  // The recorder reads this when a take really starts, so each take carries its own round.
  const context: PracticeContext = {
    sessionId,
    exerciseId: drill.exerciseId,
    exerciseVersion: drill.version,
    exerciseType: drill.type,
    prompt: plan.sessionPrompt,
    outline: { point: "", reason: "", example: "" },
    conditions: { familiarity: round.familiarity, preparationSeconds: round.thinkSeconds, targetSeconds: round.speakSeconds ?? 60, audience: round.audience ?? null, followUp: round.followUp ?? false },
    contentId: plan.contentId ?? undefined,
    activity: { version: drill.version, seed: plan.seed, groupId: plan.groupId ?? undefined, params: plan.params },
    step: { index: round.index, key: round.key, promptId: round.promptId ?? undefined },
  };
  const rec = useRecorder(plan.sessionPrompt, context);
  const clock = useDrillClock(plan, rec, roundIndex, setRoundIndex);
  const guard = useRecorderGuard(rec, { leaveDuringCountdown: true });
  useAutoTranscribe(rec.takes.map((t) => t.asset.assetId), sessionId, { enabled: preferences.autoTranscribe });
  const { Setup, Live, Result } = module;
  const speaking = clock.phase === "speak";

  const locked = rec.isCapturing || rec.phase === "countdown";
  return (
    <div className="space-y-6">
      {/* In a sequence (a warm-up, a mixed set, a sprint) the step bar leads on to the next step. */}
      {search.get("seq") === "1" && <SequenceBar sessionId={sessionId} takeCount={clock.takes.length} locked={locked} />}
      <div aria-live="polite" className="sr-only">
        {clock.announcement}
      </div>
      <header className="space-y-2">
        <p className="text-meta text-muted-foreground">
          {!ready ? "Before you start" : clock.phase === "done" ? "Result" : drill.title}
          {ready && clock.phase !== "done" && plan.rounds.length > 1 && ` · Round ${clock.round.index + 1} of ${plan.rounds.length}`}
        </p>
        <h1 className="text-title font-semibold tracking-tight text-balance">{!ready ? drill.title : clock.phase === "done" ? plan.sessionPrompt : clock.round.prompt}</h1>
        {ready && clock.phase !== "done" && clock.round.hint && <p className="text-muted-foreground">{clock.round.hint}</p>}
      </header>

      {!native && (
        <p role="note" className="flex items-center gap-2 text-meta text-muted-foreground">
          <Info aria-hidden className="size-4 shrink-0" /> Browser preview: recording is simulated.
        </p>
      )}

      {!ready && Setup ? (
        <>
          <Rules drill={drill} />
          <Setup
            plan={plan}
            ctx={ctx}
            onReady={(next) => {
              setPlan(next);
              setRoundIndex(0);
              setReady(true);
            }}
          />
        </>
      ) : clock.phase === "done" ? (
        <>
          <Result plan={plan} takes={clock.takes} sessionId={sessionId} />
          {clock.marksLost && <p role="note" className="text-meta text-muted-foreground">Marks from this round weren't saved, so the parts of the result that use them may be missing.</p>}
          <div className="flex flex-wrap gap-2">
            {module.repeatable && (
              <Button onClick={clock.again}>{module.fixedPlan ? "Practise again" : "Same topic"}</Button>
            )}
            {!module.fixedPlan && (
              <Button variant={module.repeatable ? "outline" : "default"} onClick={() => navigate(`/drill/${drill.id}?seed=${newSeed()}`)}>
                {module.repeatable ? "Again, new topic" : "Play again"}
              </Button>
            )}
            <Button variant="outline" asChild>
              <Link to={`/sessions/${sessionId}`}>Open the session</Link>
            </Button>
            <Button variant="ghost" asChild>
              <Link to="/exercises?tab=drills">Done</Link>
            </Button>
          </div>
        </>
      ) : (
        <>
          {clock.round.card && <div>{clock.round.card}</div>}
          {rec.error && <p role="alert" className="rounded-lg border p-3 text-destructive">{rec.error}</p>}
          <RecorderPanel
            rec={rec}
            countdownSeconds={clock.round.thinkSeconds}
            onBeforeStart={clock.beforeStart}
            labels={{ record: "Start round", again: plan.rounds.length > 1 ? `Start round ${clock.round.index + 1}` : "Start round", stop: "End round" }}
            clock={<ClockView clock={clock} />}
            inside={Live && <Live plan={plan} round={clock.round} speaking={speaking} elapsedMs={rec.elapsedMs} mark={clock.mark} />}
            livePace={drill.type === "pace_ladder" ? true : undefined}
            footer={
              <p className="text-meta text-muted-foreground">
                {clock.round.speakSeconds === null
                  ? "Stop the round when you're done. Ctrl+Enter starts and stops."
                  : `The round stops by itself after ${clock.round.speakSeconds} seconds; End round stops it early.`}
              </p>
            }
          />
          {clock.phase === "ready" && <Rules drill={drill} />}
        </>
      )}

      <RecordingLibrary />
      {guard}
    </div>
  );
}

function Rules({ drill }: { drill: DrillDef }) {
  return (
    <Panel aria-label="How it works" className="space-y-2">
      <h2 className="font-semibold">How it works</h2>
      <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
        {drill.rules.map((rule) => (
          <li key={rule}>{rule}</li>
        ))}
      </ul>
    </Panel>
  );
}

function ClockView({ clock }: { clock: DrillClock }) {
  const r = clock.round;
  if (clock.phase === "think") return <CountdownRing totalMs={r.thinkSeconds * 1000} remainingMs={clock.remainingMs} caption="Think time" />;
  if (clock.phase === "speak" || clock.phase === "saving") {
    if (clock.limitMs === null) return <CountdownRing totalMs={null} remainingMs={clock.remainingMs} caption="Speaking" />;
    const elapsed = clock.limitMs - clock.remainingMs;
    return <CountdownRing totalMs={clock.limitMs} remainingMs={clock.remainingMs} caption="Time left" light={r.lights && r.speakSeconds ? lightAt(elapsed, r.speakSeconds * 1000) : null} />;
  }
  return <CountdownRing totalMs={r.speakSeconds ? r.speakSeconds * 1000 : null} remainingMs={(r.speakSeconds ?? 0) * 1000} caption={r.speakSeconds ? "Speaking time" : "You stop when you're done"} />;
}
