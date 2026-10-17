import { useId, useState } from "react";
import { Link } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle } from "lucide-react";
import { ErrorState, LoadingBlock, Panel } from "@/components/page";
import { Button } from "@/components/ui/button";
import { PROGRAMMES, type ProgrammeDef } from "@/content/programmes";
import { formatDay } from "@/lib/format";
import { useIpc } from "@/lib/ipc";
import { keys } from "@/lib/ipc/queries";
import type { PracticeEvent, PracticeFacts, ProgrammeRun } from "@/lib/ipc/schemas";
import { canAdvance, weekStatus, type StepStatus } from "@/lib/learning/programmes";
import { toLocalDate } from "@/lib/phrase-schedule";
import { useProgramme } from "./useProgramme";

/** Everything a programme change affects: the run, points earned, and Today's focus. */
function useRefresh() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: keys.programme }), qc.invalidateQueries({ queryKey: keys.engagementEvents }), qc.invalidateQueries({ queryKey: ["today"] })]);
}

/** A step's progress: counted from your practice, or ticked by you. */
export function stepProgress(s: StepStatus): string | null {
  if (s.auto) return `${s.done} of ${s.needed}${s.met && s.done < s.needed ? " · marked done" : ""}`;
  return s.ticked ? "Marked done" : null;
}

function StepRow({ status: s, onTick, busy }: { status: StepStatus; onTick: () => void; busy: boolean }) {
  const progress = stepProgress(s);
  return (
    <li className="flex flex-wrap items-start gap-3 px-4 py-3">
      {s.met ? <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" /> : <Circle aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />}
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="font-medium">
          {s.step.title}
          <span className="sr-only">{s.met ? ", done" : ", not done yet"}</span>
        </p>
        <p className="text-meta text-muted-foreground">{s.step.how}</p>
        {progress && <p className="text-meta text-muted-foreground tabular-nums">{progress}{s.auto && !s.met ? " · counts by itself" : ""}</p>}
      </div>
      {!s.met && (
        <div className="flex flex-wrap gap-2">
          {s.step.link && (
            <Button variant="outline" size="sm" asChild>
              <Link to={s.step.link.to} state={{ section: "exercises" }}>{s.step.link.label}</Link>
            </Button>
          )}
          <Button variant="ghost" size="sm" disabled={busy} onClick={onTick}>
            Mark done<span className="sr-only">: {s.step.title}</span>
          </Button>
        </div>
      )}
    </li>
  );
}

/**
 * The running programme (roadmap 11.6): this week's steps, which tick
 * themselves when your practice matches them, and Move on, Repeat this week
 * or Stop. Weeks wait for you: Move on is offered once three steps are done
 * or seven days have passed, and nothing is ever failed.
 */
function ProgrammeRunCard({ run, def, facts, events }: { run: ProgrammeRun; def: ProgrammeDef; facts: PracticeFacts | undefined; events: PracticeEvent[] | undefined }) {
  const ipc = useIpc();
  const refresh = useRefresh();
  const titleId = useId();
  const [confirmStop, setConfirmStop] = useState(false);
  const week = def.weeks.find((w) => w.week === run.week) ?? def.weeks[0];
  const steps = facts && events ? weekStatus(def, run, facts, events) : null;
  const ready = facts && events ? canAdvance(def, run, facts, events, toLocalDate(new Date())) : { ready: false, reason: null };
  const last = run.week >= def.weeks.length;
  const tick = useMutation({ mutationFn: (stepId: string) => ipc.completeProgrammeStep(run.id, stepId, null), onSuccess: refresh });
  const setWeek = useMutation({ mutationFn: ({ week, finished }: { week: number; finished: boolean }) => ipc.setProgrammeWeek(run.id, week, finished), onSuccess: refresh });
  const stop = useMutation({ mutationFn: () => ipc.stopProgramme(run.id), onSuccess: refresh });
  const busy = setWeek.isPending || stop.isPending;
  const error = tick.error ?? setWeek.error ?? stop.error;
  return (
    <Panel aria-labelledby={titleId} className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={titleId} className="text-lg font-semibold">{def.title}</h2>
        <p className="text-meta text-muted-foreground">
          Week {run.week} of {def.weeks.length} · {week.theme}
        </p>
      </div>
      <ol className="flex gap-1.5" aria-label="Weeks">
        {def.weeks.map((w) => (
          <li key={w.week} className={w.week <= run.week ? "h-1.5 w-10 rounded-full bg-primary" : "h-1.5 w-10 rounded-full bg-muted"}>
            <span className="sr-only">Week {w.week}, {w.theme}{w.week < run.week ? ", done" : w.week === run.week ? ", this week" : ""}</span>
          </li>
        ))}
      </ol>
      {week.focus && (
        <p className="text-meta">
          This week's focus: <span className="font-medium">{week.focus}</span>. Today suggests it, and you can change it in any session.
        </p>
      )}
      {steps ? (
        <ul className="divide-y rounded-panel border" aria-label={`Week ${run.week} steps`}>
          {steps.map((s) => <StepRow key={s.step.id} status={s} busy={tick.isPending} onTick={() => tick.mutate(s.step.id)} />)}
        </ul>
      ) : (
        <LoadingBlock rows={3} label="Loading this week's steps" />
      )}
      {ready.reason && <p className="text-meta">{ready.reason}</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant={ready.ready ? "default" : "outline"} disabled={busy} onClick={() => setWeek.mutate({ week: last ? run.week : run.week + 1, finished: last })}>
          {last ? "Finish the programme" : `Move on to week ${run.week + 1}`}
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => setWeek.mutate({ week: run.week, finished: false })}>
          Repeat this week
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => setConfirmStop(true)}>
          Stop the programme
        </Button>
      </div>
      {confirmStop && (
        <p className="flex flex-wrap items-center gap-2 text-meta">
          Stop the programme? Everything you practised stays, and you can start again any time.
          <Button size="sm" variant="destructive" disabled={busy} onClick={() => stop.mutate()}>Stop</Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirmStop(false)}>Keep going</Button>
        </p>
      )}
      {error && <p role="alert" className="text-meta text-destructive">{error.message}</p>}
      <p className="text-meta text-muted-foreground">Take your time; the programme waits for you. Steps count by themselves when your practice matches them, and you can mark any step done yourself.</p>
    </Panel>
  );
}

function ProgrammeOffer({ def, last }: { def: ProgrammeDef; last: ProgrammeRun | null }) {
  const ipc = useIpc();
  const refresh = useRefresh();
  const titleId = useId();
  const start = useMutation({ mutationFn: () => ipc.startProgramme(def.id), onSuccess: refresh });
  const previous = last?.programme === def.id ? last : null;
  return (
    <Panel aria-labelledby={titleId} className="space-y-3">
      <h2 id={titleId} className="text-lg font-semibold">{def.title}</h2>
      <p>{def.summary}</p>
      <ol className="grid gap-2 sm:grid-cols-2">
        {def.weeks.map((w) => (
          <li key={w.week} className="rounded-lg border px-3 py-2">
            <p className="font-medium">Week {w.week} · {w.theme}</p>
            <p className="text-meta text-muted-foreground">{w.steps.map((s) => s.title).join(" · ")}</p>
          </li>
        ))}
      </ol>
      {previous?.completedAt && <p className="text-meta text-muted-foreground">You finished it on {formatDay(previous.completedAt.slice(0, 10))}. Run it again whenever you like.</p>}
      {previous?.stoppedAt && <p className="text-meta text-muted-foreground">You stopped it on {formatDay(previous.stoppedAt.slice(0, 10))}. Starting again begins at week 1.</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={start.isPending} onClick={() => start.mutate()}>Start the programme</Button>
        <span className="text-meta text-muted-foreground">About 10 minutes a day for four weeks, at your own pace.</span>
      </div>
      {start.error && <p role="alert" className="text-meta text-destructive">{start.error.message}</p>}
      <p className="text-meta text-muted-foreground">Based on habit reversal: noticing a habit, then practising something to do instead (Azrin and Nunn 1973; Mancuso and Miltenberger 2016).</p>
    </Panel>
  );
}

/** Exercises → Programmes (roadmap 11.6). */
export function ProgrammesTab() {
  const { state, run, def, facts, events } = useProgramme();
  if (state.isPending) return <LoadingBlock rows={3} label="Loading programmes" />;
  if (state.error) return <ErrorState error={state.error} onRetry={() => void state.refetch()} />;
  if (run && def) return <ProgrammeRunCard run={run} def={def} facts={facts} events={events} />;
  return (
    <div className="space-y-4">
      {PROGRAMMES.map((p) => <ProgrammeOffer key={p.id} def={p} last={state.data ?? null} />)}
    </div>
  );
}
