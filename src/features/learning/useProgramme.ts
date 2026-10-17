import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ProgrammeDef } from "@/content/programmes";
import { useIpc } from "@/lib/ipc";
import { keys, usePracticeEvents, usePracticeFacts, useProgrammeState } from "@/lib/ipc/queries";
import type { PracticeEvent, PracticeFacts, ProgrammeRun } from "@/lib/ipc/schemas";
import { newlyDetected, programmeOf } from "@/lib/learning/programmes";

export type ProgrammeView = {
  state: ReturnType<typeof useProgrammeState>;
  /** The running programme, if any (not finished or stopped). */
  run: ProgrammeRun | null;
  def: ProgrammeDef | null;
  facts: PracticeFacts | undefined;
  events: PracticeEvent[] | undefined;
};

/**
 * The running programme with what it needs (11.6). Steps whose detector saw
 * matching practice since the week started are recorded here, once each, so
 * they count wherever the programme is shown.
 */
export function useProgramme(): ProgrammeView {
  const ipc = useIpc();
  const qc = useQueryClient();
  const state = useProgrammeState();
  const facts = usePracticeFacts();
  const events = usePracticeEvents();
  const run = state.data && !state.data.completedAt && !state.data.stoppedAt ? state.data : null;
  const def = programmeOf(run);
  const sent = useRef(new Set<string>());

  useEffect(() => {
    if (!run || !def || !facts.data || !events.data) return;
    const fresh = newlyDetected(def, run, facts.data, events.data).filter((id) => !sent.current.has(`${run.id}:${run.weekStartedAt}:${id}`));
    if (fresh.length === 0) return;
    fresh.forEach((id) => sent.current.add(`${run.id}:${run.weekStartedAt}:${id}`));
    void Promise.allSettled(fresh.map((id) => ipc.completeProgrammeStep(run.id, id, null))).then(() =>
      Promise.all([qc.invalidateQueries({ queryKey: keys.programme }), qc.invalidateQueries({ queryKey: keys.engagementEvents })]),
    );
  }, [run, def, facts.data, events.data, ipc, qc]);

  return { state, run, def, facts: facts.data, events: events.data };
}
