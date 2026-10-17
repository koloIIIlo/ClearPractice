import { useId } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EvidenceLabel } from "@/components/evidence";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useIpc } from "@/lib/ipc";
import { keys } from "@/lib/ipc/queries";
import type { Edge, SelfCheck, SelfCheckId } from "@/lib/ipc/schemas";

/** Takes this long or longer also ask about your voice (feeds Voice & delivery, appendix A). */
export const VARIED_VOICE_MIN_MS = 90_000;

const QUESTIONS: Partial<Record<SelfCheckId, string>> = {
  point_first: "Did you open with your point?",
  clear_ending: "Did you finish clearly?",
  varied_voice: "Did you vary your voice on purpose?",
};
const HINTS: Record<NonNullable<Edge["hint"]>, string> = {
  starts_with_hesitation: "starts with a hesitation",
  trails_off: "trails off",
};

function Quote({ label, edge }: { label: string; edge: Edge | null }) {
  if (!edge) return null;
  return (
    <p className="text-muted-foreground">
      {label}: <q className="text-foreground">{edge.text}</q>
      {edge.hint && <span className="ml-2 inline-flex rounded-md border border-dashed px-1.5 text-meta">{HINTS[edge.hint]}</span>}
    </p>
  );
}

function Question({ id, value, onChange, disabled }: { id: SelfCheckId; value: boolean | undefined; onChange: (value: boolean | null) => void; disabled: boolean }) {
  const labelId = useId();
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
      <span id={labelId}>{QUESTIONS[id]}</span>
      {/* Single choice; clicking the chosen answer again clears it. Saved at once, no Save button. */}
      <ToggleGroup
        type="single"
        variant="outline"
        aria-labelledby={labelId}
        disabled={disabled}
        value={value === undefined ? "" : value ? "yes" : "no"}
        onValueChange={(v) => onChange(v === "yes" ? true : v === "no" ? false : null)}
      >
        <ToggleGroupItem value="yes" size="sm" className="h-9 px-3">Yes</ToggleGroupItem>
        <ToggleGroupItem value="no" size="sm" className="h-9 px-3">Not this time</ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}

/**
 * Two questions a listener cares about most (roadmap 8.3, §11 "Main point
 * clarity: user/listener rating"), answered by you with the opening and ending
 * sentences quoted to help you judge. Your answers are labelled Your note and
 * kept apart from every measure.
 */
export function SelfChecks({ attemptId, opener, ending, durationMs }: { attemptId: string; opener: Edge | null; ending: Edge | null; durationMs?: number | null }) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const key = keys.selfChecks(attemptId);
  const checks = useQuery({ queryKey: key, queryFn: () => ipc.listSelfChecks(attemptId) });
  const save = useMutation({ meta: { engagement: "review" },
    mutationFn: ({ checkId, value }: { checkId: SelfCheckId; value: boolean | null }) => ipc.setSelfCheck(attemptId, checkId, value),
    // The choice shows immediately; a failure puts the saved state back.
    onMutate: ({ checkId, value }) => {
      const previous = qc.getQueryData<SelfCheck[]>(key);
      qc.setQueryData<SelfCheck[]>(key, (old = []) => {
        const rest = old.filter((c) => c.checkId !== checkId);
        return value === null ? rest : [...rest, { attemptId, checkId, value, createdAt: new Date().toISOString() }];
      });
      return { previous };
    },
    onError: (_error, _vars, context) => qc.setQueryData(key, context?.previous),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.facts }),
  });
  const value = (id: SelfCheckId) => checks.data?.find((c) => c.checkId === id)?.value;
  const asked: SelfCheckId[] = ["point_first", "clear_ending", ...((durationMs ?? 0) >= VARIED_VOICE_MIN_MS ? (["varied_voice"] as const) : [])];
  return (
    <section aria-label="Quick self-check" data-self-check className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-medium">Quick self-check</h4>
        <EvidenceLabel source="note" />
      </div>
      <Quote label="Opening" edge={opener} />
      <Question id="point_first" value={value("point_first")} disabled={!checks.isSuccess} onChange={(v) => save.mutate({ checkId: "point_first", value: v })} />
      <Quote label="Ending" edge={ending} />
      {asked.slice(1).map((id) => (
        <Question key={id} id={id} value={value(id)} disabled={!checks.isSuccess} onChange={(v) => save.mutate({ checkId: id, value: v })} />
      ))}
      {save.error && <p role="alert" className="text-meta text-destructive">Your answer couldn't be saved. {save.error.message}</p>}
    </section>
  );
}
