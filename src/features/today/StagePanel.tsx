import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Panel, SectionTitle } from "@/components/page";
import { Button } from "@/components/ui/button";
import { useIpc } from "@/lib/ipc";
import type { TodayPlan } from "@/lib/ipc/schemas";

/**
 * Your stage in the progression (4.18, §7). The app only offers; you choose,
 * and the choice is recorded with the reason shown. Easier practice is always
 * available. Suggestions from the scheduler appear with their reasons.
 */
export function StagePanel({ plan }: { plan: TodayPlan }) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const choose = useMutation({
    mutationFn: ({ kind, reason }: { kind: "advance" | "easier" | "stay"; reason: string }) => ipc.recordProgression(kind, reason),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["today"] }),
  });
  const p = plan.progression;
  if (!p && !plan.suggestions?.length) return null;
  return (
    <Panel aria-labelledby="stage-heading">
      {p && (
        <>
          <SectionTitle id="stage-heading">Stage {p.stage} of 5</SectionTitle>
          <p className="font-medium">{p.title}</p>
          <p className="text-meta text-muted-foreground">{p.demand}.</p>
          <p className="mt-2 text-meta text-muted-foreground">{p.evidence}</p>
          {p.offer && (
            <div className="mt-3 space-y-2 rounded-lg border p-3" role="group" aria-label="Suggested next stage">
              <p className="text-meta"><span className="font-medium">Ready to try {p.offer.title.toLowerCase()}?</span> {p.offer.reason}</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={choose.isPending} onClick={() => choose.mutate({ kind: "advance", reason: p.offer!.reason })}>Try stage {p.offer.stage}</Button>
                <Button size="sm" variant="ghost" disabled={choose.isPending} onClick={() => choose.mutate({ kind: "stay", reason: "You chose to stay at this stage for now." })}>Not yet</Button>
              </div>
            </div>
          )}
          {p.stage > 1 && (
            <Button className="mt-3" size="sm" variant="outline" disabled={choose.isPending}
              onClick={() => choose.mutate({ kind: "easier", reason: "You chose easier practice." })}>
              Easier practice
            </Button>
          )}
          {choose.error && <p role="alert" className="mt-2 text-meta text-destructive">{choose.error.message}</p>}
        </>
      )}
      {!!plan.suggestions?.length && (
        <ul className={p ? "mt-4 space-y-2 border-t pt-3" : "space-y-2"} aria-label="Suggestions">
          {plan.suggestions.map((s) => (
            <li key={s.text} className="text-meta">
              <p className="font-medium">{s.text}</p>
              <p className="text-muted-foreground">{s.reason}</p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
