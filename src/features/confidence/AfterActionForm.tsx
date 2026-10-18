import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { AAR_QUESTIONS, FLOWS, KINDS, RECENT_DAYS } from "@/features/progress/reflection-options";
import { formatRelativeDay } from "@/lib/format";
import { useIpc } from "@/lib/ipc";
import { keys } from "@/lib/ipc/queries";
import type { AfterAction, TransferFlow, TransferTag } from "@/lib/ipc/schemas";

const EMPTY: AfterAction = { planned: "", happened: "", why: "", nextTime: "" };

/**
 * The after-action review (roadmap 12.4): the US Army's four-question debrief
 * after a real talk, in plain words. It is a kind of reflection, so it counts
 * toward Courage and real conversations. The listener's words stay apart from
 * your own reading. Opened from an event's Debrief (14.2), it debriefs that event.
 */
export function AfterActionForm({ onSaved, event }: { onSaved?: () => void; event?: { id: string; title: string } }) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const id = useId();
  const [days] = useState(RECENT_DAYS);
  const [date, setDate] = useState(days[0]);
  const [talk, setTalk] = useState(event?.title ?? "");
  const [answers, setAnswers] = useState<AfterAction>(EMPTY);
  const [listener, setListener] = useState("");
  const [flow, setFlow] = useState<TransferFlow | null>(null);
  const [kinds, setKinds] = useState<TransferTag[]>([]);
  const save = useMutation({ meta: { engagement: "reflection" },
    mutationFn: () =>
      ipc.addTransferReview({
        localDate: date, situation: talk.trim(), preparation: "", listenerText: listener.trim(), clarification: "", success: "", selfReport: "", nextFocus: "",
        flow, tags: kinds, kind: "aar",
        extra: { planned: answers.planned.trim(), happened: answers.happened.trim(), why: answers.why.trim(), nextTime: answers.nextTime.trim(), ...(event ? { eventId: event.id } : {}) },
      }),
    onSuccess: async () => {
      setTalk("");
      setAnswers(EMPTY);
      setListener("");
      setFlow(null);
      setKinds([]);
      toast("After-action review saved on this computer.");
      // A debrief finishes its event's plan item (14.2); the rest refreshes through the engagement tag.
      await Promise.all([qc.invalidateQueries({ queryKey: ["transfer-reviews"] }), qc.invalidateQueries({ queryKey: ["today"] }), ...(event ? [qc.invalidateQueries({ queryKey: keys.realEvents })] : [])]);
      onSaved?.();
    },
  });
  const answered = [answers.planned, answers.happened, answers.why, answers.nextTime].some((a) => a.trim().length > 0);
  return (
    <form
      className="space-y-4"
      aria-label="After-action review"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <div className="space-y-1">
          <Label htmlFor={`${id}-talk`}>What was the talk?</Label>
          <Input id={`${id}-talk`} maxLength={2000} placeholder="e.g. Weekly update to the team" value={talk} onChange={(e) => setTalk(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-date`}>Day</Label>
          <Select value={date} onValueChange={setDate}>
            <SelectTrigger id={`${id}-date`} className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{days.map((d) => <SelectItem key={d} value={d}>{formatRelativeDay(d, days[0])}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      {AAR_QUESTIONS.map((q) => (
        <div key={q.key} className="space-y-1">
          <Label htmlFor={`${id}-${q.key}`}>{q.label}</Label>
          <Textarea id={`${id}-${q.key}`} rows={2} maxLength={2000} value={answers[q.key]} onChange={(e) => setAnswers((a) => ({ ...a, [q.key]: e.target.value }))} />
        </div>
      ))}
      <details className="rounded-lg border px-3 py-2">
        <summary className="cursor-pointer font-medium">More (optional)</summary>
        <div className="mt-3 space-y-4">
          <div className="space-y-1">
            <Label htmlFor={`${id}-listener`}>What did the listener understand? (their words)</Label>
            <Textarea id={`${id}-listener`} rows={2} maxLength={2000} value={listener} onChange={(e) => setListener(e.target.value)} />
          </div>
          <div className="space-y-1">
            <span id={`${id}-flow`} className="text-body font-medium">How did your speaking flow?</span>
            <ToggleGroup type="single" variant="outline" aria-labelledby={`${id}-flow`} className="flex-wrap justify-start" value={flow ?? ""} onValueChange={(v) => setFlow((v || null) as TransferFlow | null)}>
              {FLOWS.map((f) => <ToggleGroupItem key={f.value} value={f.value} className="h-9 px-3">{f.label}</ToggleGroupItem>)}
            </ToggleGroup>
          </div>
          <div className="space-y-1">
            <span id={`${id}-kind`} className="text-body font-medium">What kind of talk?</span>
            <ToggleGroup type="multiple" variant="outline" aria-labelledby={`${id}-kind`} className="flex-wrap justify-start" value={kinds} onValueChange={(v) => setKinds(v as TransferTag[])}>
              {KINDS.map((k) => <ToggleGroupItem key={k.value} value={k.value} size="sm" className="h-9 px-3">{k.label}</ToggleGroupItem>)}
            </ToggleGroup>
          </div>
        </div>
      </details>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={save.isPending || talk.trim().length < 3 || !answered}>Save review</Button>
        <span className="text-meta text-muted-foreground">Answer any of the four questions. Saved as your note.</span>
      </div>
      {save.error && <p role="alert" className="text-meta text-destructive">{save.error.message}</p>}
    </form>
  );
}
