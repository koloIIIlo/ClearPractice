import { useEffect, useRef, useState } from "react";
import { EarnedToday } from "@/features/journey/EarnedToday";
import { requestEngagementRefresh } from "@/features/engagement/refresh";
import { Link, useLocation } from "react-router";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { BookmarkPlus, Check, CheckCircle2 } from "lucide-react";
import { PhraseForm } from "@/features/phrases/PhrasesPage";
import { Page, Panel } from "@/components/page";
import { EvidenceLabel } from "@/components/evidence";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatClock } from "@/lib/format";
import { toLocalDate } from "@/lib/phrase-schedule";
import { keys } from "@/lib/ipc/queries";
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
  const [addingPhrase, setAddingPhrase] = useState(false);
  const [phraseSaved, setPhraseSaved] = useState(false);
  const sessionIds: string[] = (location.state as { sessionIds?: string[] } | null)?.sessionIds ?? [];
  // The finished sequence earns effort points once (roadmap 7.4); without a take it records nothing.
  const qc = useQueryClient();
  const recorded = useRef(false);
  useEffect(() => {
    if (recorded.current || sessionIds.length === 0) return;
    recorded.current = true;
    void ipc
      .recordSequenceCompleted(sessionIds.slice(0, 10), toLocalDate(new Date()))
      .then(() => {
        requestEngagementRefresh("activity");
        return qc.invalidateQueries({ queryKey: keys.engagementEvents });
      })
      .catch(() => {}); // effort is a bonus; a failure never blocks this page
  }, [ipc, qc, sessionIds]);
  const sessions = useQueries({ queries: sessionIds.map((id) => ({ queryKey: ["session", id], queryFn: () => ipc.getSession(id), retry: false })) });
  const [ease, setEase] = useState<number | null>(null);
  const [takeaway, setTakeaway] = useState("");
  const loaded = sessions.flatMap((q) => (q.data ? [q.data] : []));
  const takes = loaded.reduce((n, s) => n + s.attemptCount, 0);
  const anyPending = sessions.some((q) => q.isPending);
  // A step left without a take has no session; it is counted, not listed as an error.
  const skipped = sessions.filter((q) => q.isError).length;
  const save = useMutation({ meta: { engagement: "reflection" },
    mutationFn: () => Promise.all(loaded.map((s) => ipc.setSessionReflection(s.id, ease, takeaway.trim() || null))),
  });
  const focuses = loaded.flatMap((s) => (s.focus ? [s.focus] : []));

  const spokenMs = loaded.reduce((n, s) => n + s.durationMs, 0);
  const hasTakes = loaded.length > 0;

  return (
    <Page className="max-w-3xl">
      {/* The day's peak-end moment (§3.13): one short celebration, three numbers, one button. */}
      <header className="mb-8 flex items-center gap-4">
        <span aria-hidden className="flex size-14 shrink-0 animate-pop items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="size-7" strokeWidth={2.5} />
        </span>
        <div className="min-w-0 space-y-1">
          <h1 className="text-title font-semibold tracking-tight">Practice complete</h1>
          <p className="text-muted-foreground">Well done for showing up. Here is what you did today.</p>
        </div>
      </header>
      <div className="space-y-6">
        {!hasTakes && !anyPending ? (
          <Panel>
            <p className="text-muted-foreground">No takes were saved in this sequence. That's fine: listening and reading count too.</p>
          </Panel>
        ) : (
          <section aria-labelledby="practised-heading" className="space-y-4">
            <h2 id="practised-heading" className="sr-only">What you practised</h2>
            <dl className="grid grid-cols-3 gap-3">
              {[
                { label: "Takes", value: anyPending && !hasTakes ? "…" : String(takes) },
                { label: loaded.length === 1 ? "Exercise" : "Exercises", value: anyPending && !hasTakes ? "…" : String(loaded.length) },
                { label: "Speaking time", value: anyPending && !hasTakes ? "…" : formatClock(spokenMs) },
              ].map((stat) => (
                <div key={stat.label} className="rounded-panel border bg-card px-4 py-3">
                  <dt className="text-meta text-muted-foreground">{stat.label}</dt>
                  <dd className="text-2xl font-semibold tabular-nums">{stat.value}</dd>
                </div>
              ))}
            </dl>
            <ul className="space-y-1 text-meta">
              {loaded.map((s) => (
                <li key={s.id} className="flex items-center gap-2">
                  <CheckCircle2 aria-hidden className="size-4 shrink-0 text-primary" />
                  <Link className="hover:underline" to={`/sessions/${s.id}`}>
                    {s.title} · {s.attemptCount} {s.attemptCount === 1 ? "take" : "takes"} · {formatClock(s.durationMs)}
                  </Link>
                </li>
              ))}
              {anyPending && <li className="text-muted-foreground">Loading…</li>}
              {skipped > 0 && (
                <li className="text-muted-foreground">
                  {skipped} {skipped === 1 ? "step" : "steps"} without a take
                </li>
              )}
            </ul>
            {focuses.length > 0 && (
              <p className="text-meta"><span className="text-muted-foreground">What you worked on:</span> {focuses.join(" · ")}</p>
            )}
          </section>
        )}

        {hasTakes && <EarnedToday />}

        {hasTakes && (
          <Panel className="space-y-4">
            <h2 className="font-semibold">Before you go <span className="text-meta font-normal text-muted-foreground">· optional</span></h2>
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
              <Button variant="outline" disabled={save.isPending || (ease === null && !takeaway.trim())} onClick={() => save.mutate()}>Save reflection</Button>
              {save.isSuccess && <span role="status" className="text-meta">Saved with today's sessions.</span>}
              {save.error && <span role="alert" className="text-meta text-destructive">{save.error.message}</span>}
            </div>
            {addingPhrase ? (
              <PhraseForm sourceSessionId={sessionIds[0] ?? null} onDone={() => { setAddingPhrase(false); setPhraseSaved(true); }} />
            ) : (
              <div className="flex flex-wrap items-center gap-2 text-meta">
                <Button variant="outline" size="sm" onClick={() => setAddingPhrase(true)}><BookmarkPlus aria-hidden /> Save a phrase…</Button>
                <span className="text-muted-foreground">
                  {phraseSaved ? <>Saved. <Link className="underline" to="/phrases">Open Phrases</Link></> : "Heard or used an expression worth keeping? It will come up for review."}
                </span>
              </div>
            )}
          </Panel>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button asChild><Link to="/">Done</Link></Button>
          <Button variant="ghost" asChild><Link to="/sessions">Open sessions</Link></Button>
        </div>
      </div>
    </Page>
  );
}
