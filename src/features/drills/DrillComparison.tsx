import { useState } from "react";
import { Link } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { Send, Sparkles } from "lucide-react";
import { EvidenceLabel } from "@/components/evidence";
import { Button } from "@/components/ui/button";
import { useIpc } from "@/lib/ipc";
import { usePreferences } from "@/lib/ipc/queries";
import type { CoachingPreview, DrillComparison, DrillComparisonKind } from "@/lib/ipc/schemas";

const money = (micro: number) => `$${(micro / 1_000_000).toFixed(micro < 10_000 ? 4 : 2)}`;
const TITLES: Record<DrillComparisonKind, string> = {
  three_ways: "Did the wording change for each listener?",
  pitch: "Which words carried your point?",
};

/**
 * An optional AI comparison of a drill's rounds (roadmap 10.5, 10.9). Only
 * with Coaching set to your OpenAI account; you see exactly what would be
 * sent, and nothing leaves the computer until you press Send. Notes quote
 * your own words from that round; the answer is an AI suggestion, never a grade.
 */
export function DrillComparisonPanel({ sessionId, kind, labels }: { sessionId: string; kind: DrillComparisonKind; labels: readonly string[] }) {
  const ipc = useIpc();
  const { preferences } = usePreferences();
  const [preview, setPreview] = useState<CoachingPreview | null>(null);
  const [answer, setAnswer] = useState<DrillComparison | null>(null);
  const prepare = useMutation({ mutationFn: () => ipc.previewDrillComparison(sessionId, kind, preferences.coachingModel), onSuccess: setPreview });
  const send = useMutation({
    mutationFn: (p: CoachingPreview) => ipc.requestDrillComparison(p.requestId, p.payloadSha256),
    onSuccess: (a) => {
      setPreview(null);
      setAnswer(a);
    },
  });
  const cancel = () => {
    if (preview) void ipc.cancelCoachingPreview(preview.requestId).catch(() => {});
    setPreview(null);
  };

  if (preferences.coachingMode === "off") return null;
  return (
    <section aria-label="AI comparison" className="space-y-3 border-t pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">{TITLES[kind]}</h3>
        <EvidenceLabel source="ai" />
      </div>
      {preferences.coachingMode !== "api" ? (
        <p className="text-meta text-muted-foreground">
          This comparison uses your OpenAI account, and Coaching is set to your local model, so nothing is sent.{" "}
          <Link className="text-primary underline underline-offset-2" to="/settings/coaching">Choose in Settings → Coaching</Link>.
        </p>
      ) : answer ? (
        <div className="space-y-2">
          <ul className="space-y-2">
            {answer.notes.map((n) => (
              <li key={n.part} className="space-y-0.5">
                <p className="text-meta font-medium">{labels[n.part - 1] ?? `Round ${n.part}`}</p>
                <p>{n.note}</p>
                <p className="text-meta text-muted-foreground">
                  You said: <q>{n.quote}</q>
                </p>
              </li>
            ))}
          </ul>
          {answer.oneTip && <p><span className="font-medium">One thing to try:</span> {answer.oneTip}</p>}
          <p className="text-meta text-muted-foreground">Shown here only; it isn't saved with your takes.</p>
        </div>
      ) : preview ? (
        <div className="space-y-3 rounded-lg border p-3" role="group" aria-label="Request preview">
          <p className="text-meta">
            <span className="font-medium">Recipient:</span> OpenAI · {preview.model} · at most {money(preview.estimatedMaximumCostMicroUsd)}
          </p>
          <p className="text-meta text-muted-foreground">{preview.costExplanation}</p>
          <details className="text-meta">
            <summary>Exactly what will be sent</summary>
            <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-3 font-sans whitespace-pre-wrap">{preview.selectedText}</pre>
          </details>
          <div className="flex flex-wrap gap-2">
            <Button disabled={send.isPending} onClick={() => send.mutate(preview)}>
              <Send aria-hidden /> {send.isPending ? "Waiting for the answer…" : "Send · may be billed"}
            </Button>
            <Button variant="ghost" disabled={send.isPending} onClick={cancel}>Cancel</Button>
          </div>
          {send.error && <p role="alert" className="text-meta text-destructive">{send.error.message}</p>}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-meta text-muted-foreground">Optional. You see exactly what would be sent first; only the transcripts go, never audio.</p>
          <Button variant="outline" disabled={prepare.isPending} onClick={() => prepare.mutate()}>
            <Sparkles aria-hidden /> {prepare.isPending ? "Preparing…" : "Preview the request"}
          </Button>
          {prepare.error && <p role="alert" className="text-meta text-destructive">{prepare.error.message}</p>}
        </div>
      )}
    </section>
  );
}
