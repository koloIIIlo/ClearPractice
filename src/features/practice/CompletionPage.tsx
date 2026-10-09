import { useState } from "react";
import { Link, useLocation } from "react-router";
import { useMutation, useQueries } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { Page, PageHeader, Panel } from "@/components/page";
import { EvidenceLabel } from "@/components/evidence";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatClock } from "@/lib/format";
import { useIpc } from "@/lib/ipc";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

const EASE = ["Very hard", "Hard", "Manageable", "Easy", "Very easy"] as const;

/**
 * Completion view (plan 4.11): what you practised, how easy it felt (your own
 * 1–5 rating, never a score) and one thing to keep for next time. Both are
 * stored on every session of the sequence.
 */
export function CompletionPage() {
  const ipc = useIpc();
  const location = useLocation();
  const sessionIds: string[] = (location.state as { sessionIds?: string[] } | null)?.sessionIds ?? [];
  const sessions = useQueries({ queries: sessionIds.map((id) => ({ queryKey: ["session", id], queryFn: () => ipc.getSession(id), retry: false })) });
  const [ease, setEase] = useState<number | null>(null);
  const [takeaway, setTakeaway] = useState("");
  const save = useMutation({
    mutationFn: () => Promise.all(sessionIds.map((id) => ipc.setSessionReflection(id, ease, takeaway.trim() || null))),
  });
  const loaded = sessions.flatMap((q) => (q.data ? [q.data] : []));
  const takes = loaded.reduce((n, s) => n + s.attemptCount, 0);
  const focuses = loaded.flatMap((s) => (s.focus ? [s.focus] : []));

  return (
    <Page className="max-w-3xl">
      <PageHeader title="Practice complete" description="Well done for showing up. Here is what you did today." />
      <div className="space-y-6">
        <Panel className="space-y-3">
          <h2 className="flex items-center gap-2 font-semibold"><CheckCircle2 aria-hidden className="size-5 text-primary" /> What you practised</h2>
          {sessionIds.length === 0 ? (
            <p className="text-muted-foreground">No takes were saved in this sequence. That's fine: listening and reading count too.</p>
          ) : (
            <>
              <p>{takes} {takes === 1 ? "take" : "takes"} in {sessionIds.length} {sessionIds.length === 1 ? "exercise" : "exercises"}.</p>
              <ul className="space-y-1">
                {sessions.map((q, i) => (
                  <li key={sessionIds[i]}>
                    {q.data ? (
                      <Link className="underline" to={`/sessions/${q.data.id}`}>
                        {q.data.title} · {q.data.attemptCount} {q.data.attemptCount === 1 ? "take" : "takes"} · {formatClock(q.data.durationMs)}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">{q.isPending ? "Loading…" : "This session is not available."}</span>
                    )}
                  </li>
                ))}
              </ul>
              {focuses.length > 0 && (
                <p className="text-meta"><span className="text-muted-foreground">What you worked on:</span> {focuses.join(" · ")}</p>
              )}
            </>
          )}
        </Panel>

        {sessionIds.length > 0 && (
          <Panel className="space-y-4">
            <h2 className="font-semibold">Before you go</h2>
            <fieldset className="space-y-2">
              <legend className="flex items-center gap-2 font-medium">How easy did today feel? <EvidenceLabel source="note" /></legend>
              <RadioGroup value={ease ? String(ease) : ""} onValueChange={(v) => setEase(Number(v))} className="flex flex-wrap gap-2">
                {EASE.map((label, i) => (
                  <Label key={label} htmlFor={`ease-${i + 1}`} className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-secondary">
                    <RadioGroupItem id={`ease-${i + 1}`} value={String(i + 1)} /> {i + 1} · {label}
                  </Label>
                ))}
              </RadioGroup>
              <p className="text-meta text-muted-foreground">Your own rating, used only to suggest how hard tomorrow's tasks are. It is never a score.</p>
            </fieldset>
            <div className="space-y-1">
              <Label htmlFor="takeaway">One thing to keep for next time</Label>
              <Input id="takeaway" className="h-10" maxLength={500} value={takeaway} onChange={(e) => setTakeaway(e.target.value)} placeholder="For example: pause before the example" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={save.isPending || (ease === null && !takeaway.trim())} onClick={() => save.mutate()}>Save reflection</Button>
              {save.isSuccess && <span role="status" className="text-meta">Saved with today's sessions.</span>}
              {save.error && <span role="alert" className="text-meta text-destructive">{save.error.message}</span>}
            </div>
            <p className="text-meta text-muted-foreground">
              Heard an expression worth keeping? <Link className="underline" to="/phrases">Open Phrases</Link>.
            </p>
          </Panel>
        )}

        <div className="flex flex-wrap gap-2">
          <Button asChild><Link to="/">Back to Today</Link></Button>
          <Button variant="outline" asChild><Link to="/sessions">Open sessions</Link></Button>
        </div>
      </div>
    </Page>
  );
}
