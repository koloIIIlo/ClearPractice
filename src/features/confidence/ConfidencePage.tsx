import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessagesSquare, Trash2, Wind } from "lucide-react";
import { Page, PageHeader, Panel, SectionTitle } from "@/components/page";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/lib/format";
import { useIpc } from "@/lib/ipc";
import { keys } from "@/lib/ipc/queries";
import type { RoutineRun } from "@/lib/ipc/schemas";
import { BestMoments } from "./BestMoments";
import { ExposureLadder } from "./ExposureLadder";

/** A note you kept from the routine's unload step, with Remove (confirmed). */
function KeptNote({ run }: { run: RoutineRun }) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const remove = useMutation({ mutationFn: () => ipc.deleteRoutineRun(run.id), onSuccess: () => qc.invalidateQueries({ queryKey: keys.routineRuns }) });
  return (
    <li className="space-y-1 rounded-lg border px-3 py-2">
      <p className="text-meta text-muted-foreground">{formatDay(run.localDate)}</p>
      <p className="whitespace-pre-wrap">{run.keptNote}</p>
      {confirm ? (
        <p className="flex flex-wrap items-center gap-2 text-meta">
          Remove this note?
          <Button size="sm" variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>Remove</Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Keep</Button>
        </p>
      ) : (
        <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground" onClick={() => setConfirm(true)} aria-label={`Remove the note of ${formatDay(run.localDate)}`}>
          <Trash2 aria-hidden /> Remove
        </Button>
      )}
      {remove.error && <p role="alert" className="text-meta text-destructive">{remove.error.message}</p>}
    </li>
  );
}

function KeptNotes() {
  const ipc = useIpc();
  const runs = useQuery({ queryKey: keys.routineRuns, queryFn: () => ipc.listRoutineRuns() });
  const kept = (runs.data ?? []).filter((r) => r.keptNote);
  if (kept.length === 0) return null;
  return (
    <details className="text-meta">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Notes you kept ({kept.length})</summary>
      <ul className="mt-2 space-y-2 text-body">
        {kept.map((r) => <KeptNote key={r.id} run={r} />)}
      </ul>
    </details>
  );
}

/**
 * Confidence (roadmap 12.1): help with the nerves around speaking, using
 * methods with good evidence: the exposure ladder, a pre-talk routine, an
 * after-action review and your best moments. Shown in both practice styles:
 * it isn't part of the game layer. Every rating here is your own note.
 */
export function ConfidencePage() {
  return (
    <Page>
      <PageHeader title="Confidence" description="Speaking nerves are common, and they ease with gradual practice. Everything here stays on this computer." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <Panel aria-labelledby="ladder-heading" className="space-y-3">
            <SectionTitle id="ladder-heading">Your ladder</SectionTitle>
            <p className="text-muted-foreground">
              Small steps from easy to hard. Rate how uncomfortable each one feels before and after: seeing the number fall over a few attempts is the point.
            </p>
            <ExposureLadder />
          </Panel>
          <Panel aria-labelledby="moments-heading">
            <SectionTitle id="moments-heading">Your best moments this week</SectionTitle>
            <BestMoments />
          </Panel>
        </div>
        <aside className="space-y-6" aria-label="Before and after a real talk">
          <Panel aria-labelledby="before-heading" className="space-y-3">
            <SectionTitle id="before-heading">Before a real talk</SectionTitle>
            <p>A 3-minute routine: breathe, warm up your voice, reframe, unload your worries and encourage yourself.</p>
            <Button asChild>
              <Link to="/confidence/routine"><Wind aria-hidden /> Start the routine</Link>
            </Button>
            <KeptNotes />
          </Panel>
          <Panel aria-labelledby="after-heading" className="space-y-3">
            <SectionTitle id="after-heading">After a real talk</SectionTitle>
            <p>What did you plan, what happened, why, and what will you do next time?</p>
            <Button variant="outline" asChild>
              <Link to="/progress?view=real&form=aar"><MessagesSquare aria-hidden /> Write a review</Link>
            </Button>
          </Panel>
        </aside>
      </div>
    </Page>
  );
}
