import { Link } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileInput } from "lucide-react";
import { toast } from "sonner";
import { EvidenceLabel } from "@/components/evidence";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatDay } from "@/lib/format";
import { useIpc } from "@/lib/ipc";
import { useListenerFeedback, useListenerPacks } from "@/lib/ipc/queries";
import type { ListenerFeedback } from "@/lib/ipc/schemas";
import { questionPreset } from "./ListenerPackDialog";

/** Import listener answers… (14.4): an answer file a listener sent back, checked before anything is kept. */
export function ImportListenerAnswers({ size = "sm" }: { size?: "sm" | "default" }) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const run = useMutation({
    meta: { engagement: "reflection" },
    mutationFn: () => ipc.importListenerAnswers(),
    onSuccess: async (result) => {
      if (!result) return;
      const who = result.feedback.listenerName || "Your listener";
      toast.success(result.alreadyImported ? "These answers were already imported. Nothing changed." : `Imported ${who}'s answers.`);
      await qc.invalidateQueries({ queryKey: ["engagement"] });
    },
  });
  return (
    <div className="space-y-1">
      <Button variant="outline" size={size} disabled={run.isPending} onClick={() => run.mutate()}>
        <FileInput aria-hidden /> {run.isPending ? "Importing…" : "Import listener answers…"}
      </Button>
      {run.error && <p role="alert" className="text-meta text-destructive">{run.error.message}</p>}
    </div>
  );
}

/** Your judgement of one answer file: did they get your main point? */
function MainPoint({ feedback }: { feedback: ListenerFeedback }) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const set = useMutation({
    mutationFn: (understood: boolean | null) => ipc.setListenerJudgement(feedback.id, understood),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["engagement"] }),
  });
  const value = feedback.mainPointUnderstood === null ? "" : feedback.mainPointUnderstood ? "yes" : "no";
  const labelId = `main-point-${feedback.id}`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span id={labelId} className="text-meta">Did they get your main point?</span>
      <ToggleGroup type="single" variant="outline" aria-labelledby={labelId} value={value} onValueChange={(v) => set.mutate(v === "yes" ? true : v === "no" ? false : null)}>
        <ToggleGroupItem value="yes" size="sm" className="h-9 px-3">Yes</ToggleGroupItem>
        <ToggleGroupItem value="no" size="sm" className="h-9 px-3">Not quite</ToggleGroupItem>
      </ToggleGroup>
      <span className="text-meta text-muted-foreground">Your judgement</span>
    </div>
  );
}

/** One listener's words: their answers to your questions, kept apart from your own notes. */
export function ListenerWords({ feedback, takeHref }: { feedback: ListenerFeedback; takeHref?: string }) {
  const preset = questionPreset(feedback.answers.map((a) => a.question));
  const heading = preset && preset.id !== "listener" ? preset.title : "Listener's words";
  const name = feedback.listenerName.trim();
  return (
    <li className="space-y-3 rounded-panel border bg-card p-4">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="font-medium">{heading}{name && `: ${name}`}</h3>
        <span className="text-meta text-muted-foreground">Imported {formatDay(feedback.importedAt.slice(0, 10))}</span>
        {takeHref && <Link className="text-meta text-primary underline underline-offset-2" to={takeHref}>Open the take</Link>}
        <EvidenceLabel source="note" className="ml-auto" />
      </div>
      <dl className="space-y-2 border-l-2 border-primary pl-3">
        {feedback.answers.map((a, i) => (
          <div key={i}>
            <dt className="text-meta text-muted-foreground">{a.question}</dt>
            <dd>{a.answer.trim() ? <span className="whitespace-pre-line">“{a.answer}”</span> : <span className="text-muted-foreground">No answer</span>}</dd>
          </div>
        ))}
      </dl>
      <p className="text-meta text-muted-foreground">Written by your listener, not by you or the app.</p>
      <MainPoint feedback={feedback} />
    </li>
  );
}

/**
 * Listeners' answers about a session's takes (or all of them), with the packs
 * still waiting for answers (roadmap 14.4).
 */
export function ListenerAnswers({ sessionId, takeHref, title, withImport }: {
  sessionId?: string;
  takeHref?: (attemptId: string, sessionId: string) => string | undefined;
  title?: string;
  /** Shows Import listener answers… while a pack waits (a session's page). */
  withImport?: boolean;
}) {
  const feedback = useListenerFeedback(sessionId);
  const packs = useListenerPacks(sessionId);
  const waiting = (packs.data ?? []).filter((p) => p.answerFiles === 0);
  if (!feedback.data?.length && waiting.length === 0) return null;
  return (
    <section className="space-y-3" aria-label={title ?? "Listeners' answers"}>
      {title && <h2 className="font-semibold">{title}</h2>}
      {waiting.map((p) => (
        <p key={p.id} role="status" className="text-meta text-muted-foreground">
          Waiting for a listener's answers (pack made {formatDay(p.createdAt.slice(0, 10))}).
        </p>
      ))}
      {withImport && waiting.length > 0 && <ImportListenerAnswers />}
      {!!feedback.data?.length && (
        <ul className="space-y-3">
          {feedback.data.map((f) => <ListenerWords key={f.id} feedback={f} takeHref={takeHref?.(f.attemptId, f.sessionId)} />)}
        </ul>
      )}
    </section>
  );
}
