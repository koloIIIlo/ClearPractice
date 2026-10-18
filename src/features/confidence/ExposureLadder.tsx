import { useId, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EvidenceLabel } from "@/components/evidence";
import { ErrorState, LoadingBlock } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { EXPOSURE_TEMPLATES, type ExposureTemplate } from "@/content/exposure-templates";
import { requestEngagementRefresh } from "@/features/engagement/refresh";
import { formatDay, formatRelativeDay } from "@/lib/format";
import { useIpc } from "@/lib/ipc";
import { keys, useExposure } from "@/lib/ipc/queries";
import type { ExposureAttempt, ExposureOutcome, ExposureStep } from "@/lib/ipc/schemas";
import { chartRows, nextUp, OUTCOME_LABELS, statsLine, stepStats } from "@/lib/confidence/ladder";
import { addLocalDays, toLocalDate } from "@/lib/phrase-schedule";
import { cn } from "@/lib/utils";
import { DiscomfortScale, ofTen } from "./DiscomfortScale";

const MAX_STEPS = 30;

/** Everything a ladder change touches: steps, attempts, effort and the facts the levels read. */
function useRefresh() {
  const qc = useQueryClient();
  return () => {
    requestEngagementRefresh("activity");
    return Promise.all([qc.invalidateQueries({ queryKey: keys.exposureSteps }), qc.invalidateQueries({ queryKey: keys.exposureAttempts }), qc.invalidateQueries({ queryKey: keys.facts })]);
  };
}

type Draft = { key: string; id: string | null; title: string; templateId: string | null };
let draftKey = 0;
const draft = (title: string, id: string | null = null, templateId: string | null = null): Draft => ({ key: `d${(draftKey += 1)}`, id, title, templateId });

/**
 * Build or edit your ladder (12.2): rename, reorder with Move up and Move
 * down, add and remove steps. Saving keeps the attempts of every step, also of
 * a step you removed.
 */
function LadderEditor({ initial, onDone }: { initial: Draft[]; onDone: () => void }) {
  const ipc = useIpc();
  const refresh = useRefresh();
  const [items, setItems] = useState<Draft[]>(initial);
  const save = useMutation({
    mutationFn: () => ipc.saveExposureSteps(items.map((d) => ({ id: d.id, title: d.title.trim(), templateId: d.templateId }))),
    onSuccess: async () => {
      await refresh();
      onDone();
    },
  });
  const move = (i: number, by: -1 | 1) =>
    setItems((list) => {
      const next = [...list];
      [next[i], next[i + by]] = [next[i + by], next[i]];
      return next;
    });
  const invalid = items.some((d) => d.title.trim().length < 3 || d.title.trim().length > 160);
  return (
    <div className="space-y-3">
      <p className="text-meta text-muted-foreground">From easiest at the top to hardest at the bottom. Removing a step keeps what you did on it.</p>
      <ol className="space-y-2" aria-label="Ladder steps">
        {items.map((d, i) => (
          <li key={d.key} className="flex items-center gap-2">
            <span aria-hidden className="w-6 shrink-0 text-right text-meta text-muted-foreground tabular-nums">{i + 1}</span>
            <Input
              aria-label={`Step ${i + 1}`}
              className="h-10 min-w-0 flex-1"
              maxLength={160}
              value={d.title}
              onChange={(e) => setItems((list) => list.map((x) => (x.key === d.key ? { ...x, title: e.target.value } : x)))}
            />
            <Button variant="ghost" size="icon-sm" aria-label={`Move step ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>
              <ArrowUp aria-hidden />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label={`Move step ${i + 1} down`} disabled={i === items.length - 1} onClick={() => move(i, 1)}>
              <ArrowDown aria-hidden />
            </Button>
            <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label={`Remove step ${i + 1}`} onClick={() => setItems((list) => list.filter((x) => x.key !== d.key))}>
              <Trash2 aria-hidden />
            </Button>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" disabled={items.length >= MAX_STEPS} onClick={() => setItems((list) => [...list, draft("")])}>
          <Plus aria-hidden /> Add a step
        </Button>
        <span className="text-meta text-muted-foreground">{items.length} of {MAX_STEPS} steps at most</span>
      </div>
      {invalid && <p className="text-meta text-muted-foreground">Give each step a short line of 3 to 160 characters.</p>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={invalid || items.length === 0 || save.isPending} onClick={() => save.mutate()}>Save ladder</Button>
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
      {save.error && <p role="alert" className="text-meta text-destructive">{save.error.message}</p>}
    </div>
  );
}

/** The first visit: start from a template, or from scratch (appendix C.6). */
function BuildLadder({ onPick }: { onPick: (template: ExposureTemplate | null) => void }) {
  return (
    <div className="space-y-3">
      <p>Start from a template, then make it yours: rename, reorder and add steps.</p>
      <ul className="grid gap-3 sm:grid-cols-2" aria-label="Ladder templates">
        {EXPOSURE_TEMPLATES.map((t) => (
          <li key={t.id} className="flex flex-col rounded-lg border p-3">
            <p className="font-medium">{t.title}</p>
            <p className="text-meta text-muted-foreground">{t.summary}</p>
            <div className="mt-auto pt-3">
              <Button variant="outline" size="sm" onClick={() => onPick(t)} aria-label={`Use the ${t.title} template`}>Use this</Button>
            </div>
          </li>
        ))}
      </ul>
      <Button variant="ghost" onClick={() => onPick(null)}>Start from scratch</Button>
    </div>
  );
}

const RECENT_DAYS = 7;

/**
 * Plan (your discomfort expected beforehand) or "I did it" (afterwards, and
 * whether you did it). Every rating is Your note.
 */
function AttemptDialog({ step, mode, plan, onClose }: { step: ExposureStep; mode: "plan" | "done"; plan: ExposureAttempt | null; onClose: () => void }) {
  const ipc = useIpc();
  const refresh = useRefresh();
  const today = toLocalDate(new Date());
  const days = useMemo(() => Array.from({ length: RECENT_DAYS }, (_, i) => addLocalDays(today, -i)), [today]);
  const [date, setDate] = useState(today);
  const [before, setBefore] = useState(plan?.beforeRating ?? 5);
  const [after, setAfter] = useState(3);
  const [outcome, setOutcome] = useState<Exclude<ExposureOutcome, "planned">>("yes");
  const [note, setNote] = useState("");
  const noteId = useId();
  const outcomeId = useId();
  const save = useMutation({
    mutationFn: () => {
      if (mode === "plan") return ipc.addExposureAttempt({ stepId: step.id, localDate: today, beforeRating: before, afterRating: null, outcome: "planned", note: "" });
      const input = { stepId: step.id, localDate: date, beforeRating: before, afterRating: after, outcome, note: note.trim() };
      return plan ? ipc.updateExposureAttempt(plan.id, input) : ipc.addExposureAttempt(input);
    },
    onSuccess: async () => {
      await refresh();
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "plan" ? "Plan this step" : "How did it go?"}</DialogTitle>
          <DialogDescription>{step.title}</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          {mode === "plan" ? (
            <DiscomfortScale label="How uncomfortable do you expect this to feel?" value={before} onChange={setBefore} />
          ) : (
            <>
              <div className="space-y-2">
                <span id={outcomeId} className="font-medium">Did you do it?</span>
                <ToggleGroup type="single" variant="outline" aria-labelledby={outcomeId} value={outcome} onValueChange={(v) => v && setOutcome(v as typeof outcome)} className="flex-wrap justify-start">
                  {(Object.keys(OUTCOME_LABELS) as (keyof typeof OUTCOME_LABELS)[]).map((o) => (
                    <ToggleGroupItem key={o} value={o} size="sm" className="h-9 px-3">{OUTCOME_LABELS[o]}</ToggleGroupItem>
                  ))}
                </ToggleGroup>
                {outcome === "not_this_time" && <p className="text-meta text-muted-foreground">That's fine. Noting it still counts as practice in noticing.</p>}
              </div>
              {plan ? (
                <p className="text-meta text-muted-foreground">You expected {ofTen(plan.beforeRating ?? 0)} beforehand.</p>
              ) : (
                <DiscomfortScale label="How uncomfortable did you expect it to be?" value={before} onChange={setBefore} />
              )}
              <DiscomfortScale label="How uncomfortable did it feel afterwards?" value={after} onChange={setAfter} />
              <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
                <div className="space-y-1">
                  <Label htmlFor={`${noteId}-day`}>Day</Label>
                  <Select value={date} onValueChange={setDate}>
                    <SelectTrigger id={`${noteId}-day`} className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{days.map((d) => <SelectItem key={d} value={d}>{formatRelativeDay(d, today)}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor={noteId}>Note (optional)</Label>
                <Textarea id={noteId} rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            </>
          )}
          <p className="text-meta text-muted-foreground">Rating it helps you see it change. It's your own reading, never measured from your voice.</p>
          {save.error && <p role="alert" className="text-meta text-destructive">{save.error.message}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>{mode === "plan" ? "Save plan" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const OUTCOME_WORDS: Record<ExposureOutcome, string> = { planned: "Planned", yes: "Done", partly: "Partly done", not_this_time: "Not this time" };

/** One attempt in a step's history, with Remove (confirmed; what you earned stays). */
function AttemptRow({ attempt: a }: { attempt: ExposureAttempt }) {
  const ipc = useIpc();
  const refresh = useRefresh();
  const [confirm, setConfirm] = useState(false);
  const remove = useMutation({ mutationFn: () => ipc.deleteExposureAttempt(a.id), onSuccess: refresh });
  const ratings = [a.beforeRating !== null && `before ${ofTen(a.beforeRating)}`, a.afterRating !== null && `after ${ofTen(a.afterRating)}`].filter(Boolean).join(", ");
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="tabular-nums">{formatDay(a.localDate)}</span>
      <span>· {OUTCOME_WORDS[a.outcome]}{ratings && ` · ${ratings}`}</span>
      {a.note && <span className="text-muted-foreground">· {a.note}</span>}
      {confirm ? (
        <span className="flex items-center gap-1">
          <Button size="sm" variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>Remove</Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Keep</Button>
        </span>
      ) : (
        <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground" onClick={() => setConfirm(true)} aria-label={`Remove the attempt of ${formatDay(a.localDate)}`}>
          <Trash2 aria-hidden /> Remove
        </Button>
      )}
      {remove.error && <span role="alert" className="text-destructive">{remove.error.message}</span>}
    </li>
  );
}

/** A step's attempts, oldest first, folded until you open them. */
function AttemptHistory({ attempts }: { attempts: ExposureAttempt[] }) {
  if (attempts.length === 0) return null;
  const ordered = [...attempts].sort((x, y) => x.localDate.localeCompare(y.localDate) || x.createdAt.localeCompare(y.createdAt));
  return (
    <details className="text-meta">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Attempts ({attempts.length})</summary>
      <ol className="mt-1 space-y-1 pl-3">
        {ordered.map((a) => <AttemptRow key={a.id} attempt={a} />)}
      </ol>
    </details>
  );
}

/** Before (dashed) and after (solid) per attempt for one step, with a table for screen readers. */
function DiscomfortChart({ steps, attempts }: { steps: ExposureStep[]; attempts: ExposureAttempt[] }) {
  const id = useId();
  const tried = steps.filter((s) => chartRows(attempts.filter((a) => a.stepId === s.id)).length > 0);
  const [chosen, setChosen] = useState<string | null>(null);
  const step = tried.find((s) => s.id === chosen) ?? tried[0];
  if (!step) return null;
  const rows = chartRows(attempts.filter((a) => a.stepId === step.id));
  return (
    <section aria-labelledby={`${id}-title`} className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${id}-title`} className="font-medium">Discomfort over your attempts</h3>
        <Select value={step.id} onValueChange={setChosen}>
          <SelectTrigger aria-label="Step shown in the chart" className="w-full max-w-72"><SelectValue /></SelectTrigger>
          <SelectContent>{tried.map((s) => <SelectItem key={s.id} value={s.id}>{s.position}. {s.title}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="h-44" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 6, right: 8, bottom: 4, left: 0 }} accessibilityLayer={false} tabIndex={-1}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="attempt" tickFormatter={(n) => `#${n}`} stroke="var(--muted-foreground)" fontSize={13} />
            <YAxis domain={[0, 10]} ticks={[0, 5, 10]} stroke="var(--muted-foreground)" fontSize={13} width={64} label={{ value: "Discomfort", angle: -90, position: "insideLeft", fill: "var(--muted-foreground)", fontSize: 12 }} />
            <Tooltip
              labelFormatter={(n) => `Attempt ${n}`}
              formatter={(v, name) => [ofTen(Number(v)), name === "before" ? "Before" : "After"]}
              contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }}
            />
            <Line type="linear" dataKey="before" stroke="var(--chart-4)" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3 }} connectNulls isAnimationActive={false} />
            <Line type="linear" dataKey="after" stroke="var(--chart-1)" strokeWidth={2} dot={{ r: 3.5 }} connectNulls isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-meta text-muted-foreground">Discomfort is your own rating (Your note): dashed is before, solid is after.</p>
      <table className="sr-only">
        <caption>Discomfort before and after each attempt at {step.title}</caption>
        <thead>
          <tr><th scope="col">Attempt</th><th scope="col">Day</th><th scope="col">Before</th><th scope="col">After</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.attempt}>
              <td>{r.attempt}</td><td>{formatDay(r.date)}</td><td>{r.before === null ? "not rated" : ofTen(r.before)}</td><td>{r.after === null ? "not rated" : ofTen(r.after)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/**
 * The exposure ladder (roadmap 12.2): graded steps from easy to hard with your
 * discomfort before and after each attempt. A step whose last two attempts
 * felt manageable suggests the next one; nothing ever locks.
 */
export function ExposureLadder() {
  const { steps, attempts } = useExposure();
  const [editing, setEditing] = useState<Draft[] | null>(null);
  const [dialog, setDialog] = useState<{ step: ExposureStep; mode: "plan" | "done" } | null>(null);
  if (steps.isPending || attempts.isPending) return <LoadingBlock rows={3} label="Loading your ladder" />;
  const error = steps.error ?? attempts.error;
  if (error) return <ErrorState error={error} onRetry={() => void Promise.all([steps.refetch(), attempts.refetch()])} />;
  const list = steps.data ?? [];
  const all = attempts.data ?? [];
  if (editing) return <LadderEditor initial={editing} onDone={() => setEditing(null)} />;
  if (list.length === 0)
    return <BuildLadder onPick={(t) => setEditing(t ? t.steps.map((title) => draft(title, null, t.id)) : [draft("")])} />;
  const highlight = nextUp(list, all);
  return (
    <div className="space-y-4">
      <p className="flex flex-wrap items-center gap-2 text-meta text-muted-foreground">
        <EvidenceLabel source="note" /> Every discomfort rating here is your own, never measured from your voice.
      </p>
      <ol className="divide-y rounded-panel border" aria-label="Your ladder">
        {list.map((s) => {
          const stats = stepStats(all.filter((a) => a.stepId === s.id));
          return (
            <li key={s.id} className={cn("flex flex-wrap items-start gap-3 px-4 py-3", highlight === s.id && "bg-secondary/60")}>
              <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-meta font-medium tabular-nums">{s.position}</span>
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="font-medium">
                  {s.title}
                  {highlight === s.id && <span className="ml-2 rounded-md bg-primary/10 px-1.5 py-0.5 text-meta font-medium text-primary">Next</span>}
                </p>
                <p className="text-meta text-muted-foreground tabular-nums">{statsLine(stats)}</p>
                {stats.manageable && <p className="text-meta">This one feels manageable now. Ready for the next step?</p>}
                <AttemptHistory attempts={all.filter((a) => a.stepId === s.id)} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => setDialog({ step: s, mode: "done" })} aria-label={`I did it: ${s.title}`}>I did it</Button>
                {!stats.plan && <Button variant="ghost" size="sm" onClick={() => setDialog({ step: s, mode: "plan" })} aria-label={`Plan: ${s.title}`}>Plan</Button>}
              </div>
            </li>
          );
        })}
      </ol>
      <DiscomfortChart steps={list} attempts={all} />
      <Button variant="outline" onClick={() => setEditing(list.map((s) => draft(s.title, s.id, s.templateId)))}>Edit ladder</Button>
      {dialog && (
        <AttemptDialog
          key={`${dialog.step.id}-${dialog.mode}`}
          step={dialog.step}
          mode={dialog.mode}
          plan={stepStats(all.filter((a) => a.stepId === dialog.step.id)).plan}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
