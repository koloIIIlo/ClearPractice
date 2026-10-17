import { useId, type ReactNode } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EvidenceLabel } from "@/components/evidence";
import { Panel } from "@/components/page";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useIpc } from "@/lib/ipc";
import { keys, useServiceStatus } from "@/lib/ipc/queries";
import type { ActivityResult, SelfCheck, SelfCheckId } from "@/lib/ipc/schemas";

/** A drill take's result (10.1), refreshed when its transcript or marks change. */
export function useActivityResult(attemptId: string | null | undefined) {
  const ipc = useIpc();
  return useQuery({ queryKey: keys.activityResult(attemptId ?? ""), queryFn: () => ipc.getActivityResult(attemptId!), enabled: !!attemptId, retry: false });
}

/** The result as one kind, or undefined while loading or when it is another kind. */
export function resultOf<K extends ActivityResult["kind"]>(result: ActivityResult | undefined, kind: K): Extract<ActivityResult, { kind: K }> | undefined {
  return result?.kind === kind ? (result as Extract<ActivityResult, { kind: K }>) : undefined;
}

export function ResultPanel({ title, source = "estimated", children, label }: { title: string; source?: "estimated" | "note" | "measured"; children: ReactNode; label?: string }) {
  const id = useId();
  return (
    <Panel aria-labelledby={id} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="font-semibold">{title}</h2>
        <EvidenceLabel source={source} />
      </div>
      {label && <p className="text-meta text-muted-foreground">{label}</p>}
      {children}
    </Panel>
  );
}

/** Says why part of a result is missing and what would fill it, never showing it as zero. */
export function NeedsTranscript({ reason }: { reason: string | null | undefined }) {
  const status = useServiceStatus();
  if (!reason) return null;
  const setUp = status.data?.transcription.state === "needs_setup";
  return (
    <p className="text-meta text-muted-foreground">
      {reason}{" "}
      {setUp ? (
        <>
          The full result appears once the take is transcribed. <Link className="text-primary underline underline-offset-2" to="/settings/transcription">Set up local transcription</Link>
        </>
      ) : (
        "It fills in by itself once the take is transcribed."
      )}
    </p>
  );
}

/** One question about a take, answered by you (Your note), saved at once; clicking the answer again clears it. */
export function DrillCheck({ attemptId, checkId, question, yes = "Yes", no = "Not this time" }: { attemptId: string; checkId: SelfCheckId; question: string; yes?: string; no?: string }) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const labelId = useId();
  const key = keys.selfChecks(attemptId);
  const checks = useQuery({ queryKey: key, queryFn: () => ipc.listSelfChecks(attemptId) });
  const save = useMutation({
    meta: { engagement: "review" },
    mutationFn: (value: boolean | null) => ipc.setSelfCheck(attemptId, checkId, value),
    onMutate: (value) => {
      const previous = qc.getQueryData<SelfCheck[]>(key);
      qc.setQueryData<SelfCheck[]>(key, (old = []) => {
        const rest = old.filter((c) => c.checkId !== checkId);
        return value === null ? rest : [...rest, { attemptId, checkId, value, createdAt: new Date().toISOString() }];
      });
      return { previous };
    },
    onError: (_error, _value, context) => qc.setQueryData(key, context?.previous),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.facts }),
  });
  const value = checks.data?.find((c) => c.checkId === checkId)?.value;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
      <span id={labelId}>{question}</span>
      <div className="flex items-center gap-2">
        <ToggleGroup
          type="single"
          variant="outline"
          aria-labelledby={labelId}
          disabled={!checks.isSuccess}
          value={value === undefined ? "" : value ? "yes" : "no"}
          onValueChange={(v) => save.mutate(v === "yes" ? true : v === "no" ? false : null)}
        >
          <ToggleGroupItem value="yes" size="sm" className="h-9 px-3">{yes}</ToggleGroupItem>
          <ToggleGroupItem value="no" size="sm" className="h-9 px-3">{no}</ToggleGroupItem>
        </ToggleGroup>
        <EvidenceLabel source="note" />
      </div>
      {save.error && <p role="alert" className="w-full text-meta text-destructive">Your answer couldn't be saved. {save.error.message}</p>}
    </div>
  );
}

/** A figure with its label; a missing value says so instead of showing zero. */
export function Figure({ label, value, unit }: { label: string; value: ReactNode | null | undefined; unit?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-meta text-muted-foreground">{label}</div>
      {value === null || value === undefined ? (
        <div className="text-meta text-muted-foreground">Not available</div>
      ) : (
        <div className="font-medium tabular-nums">
          {value}
          {unit && <span className="ml-1 text-meta font-normal text-muted-foreground">{unit}</span>}
        </div>
      )}
    </div>
  );
}

/** Where you can listen to a take again. */
export function TakeLink({ sessionId, ordinal, children }: { sessionId: string; ordinal: number; children: ReactNode }) {
  return (
    <Link className="text-primary underline underline-offset-2" to={`/sessions/${sessionId}/attempt/${ordinal}`}>
      {children}
    </Link>
  );
}
