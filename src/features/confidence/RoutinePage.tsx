import { useEffect, useId, useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Page } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { encouragement, ROUTINE_STEPS, TONGUE_TWISTERS } from "@/content/routine";
import { requestEngagementRefresh } from "@/features/engagement/refresh";
import { SequenceDots } from "@/features/practice/SequenceBar";
import { useIpc } from "@/lib/ipc";
import { keys, usePreferences } from "@/lib/ipc/queries";
import type { RoutineStepId } from "@/lib/ipc/schemas";
import { toLocalDate } from "@/lib/phrase-schedule";
import { BreathingCircle } from "./BreathingCircle";

const UNLOAD_SECONDS = 60;

/** One tongue twister per day, the same all day. */
export function twisterFor(localDate: string): string {
  const day = Math.floor(Date.parse(`${localDate}T00:00:00Z`) / 86_400_000);
  return TONGUE_TWISTERS[((day % TONGUE_TWISTERS.length) + TONGUE_TWISTERS.length) % TONGUE_TWISTERS.length];
}

/** Write worries for a minute; the text is thrown away unless you keep it (Ramirez & Beilock 2011). */
function Unload({ text, onText, keep, onKeep }: { text: string; onText: (t: string) => void; keep: boolean; onKeep: (k: boolean) => void }) {
  const id = useId();
  const [left, setLeft] = useState(UNLOAD_SECONDS);
  useEffect(() => {
    if (left <= 0) return;
    const timer = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [left]);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>Your worries, for one minute</Label>
        {/* The countdown is shown, not announced every second. */}
        <span className="text-meta text-muted-foreground tabular-nums" aria-hidden>{left > 0 ? `${left} s` : "Time"}</span>
      </div>
      <Textarea id={id} rows={5} maxLength={4000} value={text} onChange={(e) => onText(e.target.value)} />
      {left <= 0 && <p role="status" className="text-meta">The minute is up. Keep going if you like.</p>}
      <fieldset>
        <legend className="mb-2 text-meta font-medium">When you finish</legend>
        <RadioGroup value={keep ? "keep" : "discard"} onValueChange={(v) => onKeep(v === "keep")} className="flex flex-wrap gap-3">
          <Label htmlFor={`${id}-discard`} className="flex cursor-pointer items-center gap-2 font-normal">
            <RadioGroupItem id={`${id}-discard`} value="discard" /> Discard it
          </Label>
          <Label htmlFor={`${id}-keep`} className="flex cursor-pointer items-center gap-2 font-normal">
            <RadioGroupItem id={`${id}-keep`} value="keep" /> Keep this note
          </Label>
        </RadioGroup>
      </fieldset>
    </div>
  );
}

/** Asked once, on your first routine: the name to encourage you with. */
function NameField() {
  const id = useId();
  const { update } = usePreferences();
  const [name, setName] = useState("");
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) update({ displayName: name.trim() });
      }}
    >
      <div className="space-y-1">
        <Label htmlFor={id}>Your first name (optional)</Label>
        <Input id={id} className="h-10 w-56" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <Button type="submit" variant="outline" disabled={!name.trim()}>Use my name</Button>
    </form>
  );
}

/**
 * The 3-minute pre-talk routine (roadmap 12.3): breathe, warm up, reframe,
 * unload and encourage. Every step can be skipped, it works offline, and the
 * worry text is never stored unless you keep it.
 */
export function RoutinePage() {
  const ipc = useIpc();
  const qc = useQueryClient();
  const { preferences } = usePreferences();
  const runs = useQuery({ queryKey: keys.routineRuns, queryFn: () => ipc.listRoutineRuns() });
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState<RoutineStepId[]>([]);
  const [worries, setWorries] = useState("");
  const [keep, setKeep] = useState(false);
  const save = useMutation({
    mutationFn: (steps: RoutineStepId[]) => ipc.saveRoutineRun({ steps, keptNote: keep && worries.trim() ? worries.trim() : null }),
    onSuccess: () => {
      requestEngagementRefresh("activity");
      return qc.invalidateQueries({ queryKey: keys.routineRuns });
    },
  });
  const today = toLocalDate(new Date());
  const step = ROUTINE_STEPS[index];
  const finished = index >= ROUTINE_STEPS.length;
  const move = (did: boolean) => {
    const steps = did && step ? [...done, step.id] : done;
    setDone(steps);
    if (index === ROUTINE_STEPS.length - 1) {
      // Nothing is saved for a routine you skipped through; the worry text is gone either way unless kept.
      if (steps.length > 0) save.mutate(steps);
      if (!keep) setWorries("");
    }
    setIndex((i) => i + 1);
  };

  return (
    <Page className="max-w-3xl">
      <div className="space-y-8">
        <header className="space-y-3">
          <p className="text-meta text-muted-foreground">Before a real talk · about 3 minutes</p>
          <SequenceDots steps={ROUTINE_STEPS.map((s) => ({ title: s.title }))} index={Math.min(index, ROUTINE_STEPS.length)} />
        </header>
        {finished ? (
          <section aria-labelledby="routine-end" className="space-y-4 text-center">
            <h1 id="routine-end" className="text-title font-semibold tracking-tight">You're ready. Good luck.</h1>
            {save.isSuccess && <p className="text-muted-foreground">Saved on this computer{save.data.keptNote ? ", with your note" : ""}.</p>}
            {done.length === 0 && <p className="text-muted-foreground">You skipped every step, so nothing was saved. That's fine too.</p>}
            {save.error && <p role="alert" className="text-meta text-destructive">{save.error.message}</p>}
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="outline" asChild><Link to="/confidence">Back to Confidence</Link></Button>
              <Button variant="ghost" asChild><Link to="/progress?view=real&form=aar">Afterwards: write a review</Link></Button>
            </div>
          </section>
        ) : (
          <section aria-labelledby="routine-step" className="space-y-6">
            <div className="space-y-2">
              <p className="text-meta text-muted-foreground">Step {index + 1} of {ROUTINE_STEPS.length} · about {step.seconds} s</p>
              <h1 id="routine-step" className="text-title font-semibold tracking-tight">{step.title}</h1>
              <p className="text-lg">{step.how}</p>
            </div>
            {step.id === "breathe" && <BreathingCircle />}
            {step.id === "warm_up" && (
              <ol className="list-decimal space-y-2 pl-6 text-lg">
                <li>Lip trills: let your lips flutter on a long breath out.</li>
                <li>Sirens: glide your voice from low to high and back.</li>
                <li>Say this slowly, then at a normal pace: <span className="font-semibold">“{twisterFor(today)}”</span></li>
              </ol>
            )}
            {step.id === "reframe" && <p className="text-center text-4xl font-semibold tracking-tight">“I'm excited.”</p>}
            {step.id === "unload" && <Unload text={worries} onText={setWorries} keep={keep} onKeep={setKeep} />}
            {step.id === "encourage" && (
              <div className="space-y-4">
                <p className="text-center text-3xl font-semibold tracking-tight">{encouragement(preferences.displayName)}</p>
                {!preferences.displayName && runs.data?.length === 0 && <NameField />}
              </div>
            )}
            <details className="text-meta text-muted-foreground">
              <summary className="cursor-pointer hover:text-foreground">Why this helps</summary>
              <p className="mt-1">{step.why} ({step.source})</p>
            </details>
            <div className="flex flex-wrap gap-2">
              <Button size="lg" onClick={() => move(true)}>{index === ROUTINE_STEPS.length - 1 ? "Finish" : "Next"}</Button>
              <Button size="lg" variant="ghost" onClick={() => move(false)}>Skip</Button>
            </div>
          </section>
        )}
      </div>
    </Page>
  );
}
