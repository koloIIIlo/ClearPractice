import { useId, useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { DatePicker } from "@/components/date-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { buildEventPlan, KIND_LABELS, type PlanItem } from "@/lib/events/plan";
import { formatLongDay } from "@/lib/format";
import { useIpc } from "@/lib/ipc";
import { keys, usePreferences } from "@/lib/ipc/queries";
import { RealEventKind, type PlannedEvent } from "@/lib/ipc/schemas";
import { addLocalDays, toLocalDate } from "@/lib/phrase-schedule";

const NO_TIME = "none";
const NOT_SURE = "unsure";
/** Every half hour of the day. */
const TIMES = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);
const LENGTHS = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180];

type Details = { title: string; kind: RealEventKind; localDate: string; startTime: string | null; minutes: number | null; audience: string; goal: string };

/** One plan item's row while you check the plan: change its day or remove it. */
export function PlanRows({ items, onChange, min, max }: { items: PlanItem[]; onChange: (items: PlanItem[]) => void; min?: string; max?: string }) {
  return (
    <ol className="divide-y rounded-panel border" aria-label="Plan">
      {items.map((item, i) => (
        <li key={`${item.kind}-${i}`} className="flex flex-wrap items-center gap-3 px-3 py-2">
          <span className="min-w-0 flex-1">{item.title}</span>
          <DatePicker
            value={item.localDate}
            min={min}
            max={max}
            label={`Day of ${item.title}`}
            className="w-40"
            onChange={(day) => onChange(items.map((x, j) => (j === i ? { ...x, localDate: day } : x)))}
          />
          <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${item.title}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>
            <Trash2 aria-hidden />
          </Button>
        </li>
      ))}
    </ol>
  );
}

/**
 * New event (roadmap 14.2): what it is, the day, an optional time, how long,
 * who for and the one sentence they should remember. Create plan then shows
 * the preparation spread over the days left, to change before saving. With
 * `event`, changes an event's details (its plan stays as it is).
 */
export function EventForm({ open, onOpenChange, event }: { open: boolean; onOpenChange: (open: boolean) => void; event?: PlannedEvent }) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { preferences } = usePreferences();
  const id = useId();
  const today = toLocalDate(new Date());
  const [details, setDetails] = useState<Details>(() =>
    event
      ? { title: event.title, kind: event.kind, localDate: event.localDate, startTime: event.startTime, minutes: event.minutes, audience: event.audience, goal: event.goal }
      : { title: "", kind: "talk", localDate: addLocalDays(today, 7), startTime: null, minutes: 20, audience: "", goal: "" },
  );
  const [plan, setPlan] = useState<PlanItem[] | null>(null);
  const set = <K extends keyof Details>(key: K, value: Details[K]) => setDetails((d) => ({ ...d, [key]: value }));
  const save = useMutation({
    mutationFn: async () => {
      const saved = await ipc.saveEvent({ id: event?.id ?? null, ...details, title: details.title.trim(), audience: details.audience.trim(), goal: details.goal.trim() });
      if (plan) await ipc.saveEventPlan(saved.id, plan);
      return saved;
    },
    onSuccess: async (saved) => {
      await qc.invalidateQueries({ queryKey: keys.realEvents });
      onOpenChange(false);
      if (!event) navigate(`/events/${saved.id}`);
    },
  });
  const valid = details.title.trim().length >= 2;

  return (
    <Dialog open={open} onOpenChange={(o) => !save.isPending && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{event ? "Change the event" : plan ? "Your plan" : "New event"}</DialogTitle>
          <DialogDescription>
            {plan
              ? `Preparation spread over the days before ${formatLongDay(details.localDate)}. Change a day or remove an item, then save. Weekends are included; move items if you need to.`
              : "A real talk, interview, meeting, toast or pitch you want to prepare for."}
          </DialogDescription>
        </DialogHeader>
        {plan ? (
          <div className="space-y-3">
            {plan.length === 0 ? <p className="text-muted-foreground">No items left. You can add practice later from the event's page.</p> : <PlanRows items={plan} onChange={setPlan} min={today} />}
          </div>
        ) : (
          <form
            id={`${id}-form`}
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!valid) return;
              if (event) save.mutate();
              else setPlan(buildEventPlan(details, today));
            }}
          >
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor={`${id}-title`}>What is it?</Label>
              <Input id={`${id}-title`} maxLength={120} placeholder="e.g. Interview at Acme" value={details.title} onChange={(e) => set("title", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${id}-kind`}>Kind</Label>
              <Select value={details.kind} onValueChange={(v) => set("kind", v as RealEventKind)}>
                <SelectTrigger id={`${id}-kind`} className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{RealEventKind.options.map((k) => <SelectItem key={k} value={k}>{KIND_LABELS[k]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${id}-length`}>Length</Label>
              <Select value={details.minutes === null ? NOT_SURE : String(details.minutes)} onValueChange={(v) => set("minutes", v === NOT_SURE ? null : Number(v))}>
                <SelectTrigger id={`${id}-length`} className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NOT_SURE}>Not sure</SelectItem>
                  {[...new Set([...LENGTHS, ...(details.minutes ? [details.minutes] : [])])].sort((a, b) => a - b).map((m) => (
                    <SelectItem key={m} value={String(m)}>{m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <span id={`${id}-day`} className="text-body font-medium">Day</span>
              <Calendar label="Day of the event" value={details.localDate} min={event ? undefined : today} weekStartsOn={preferences.weekStartsOn} onSelect={(day) => set("localDate", day)} />
              <p className="text-meta text-muted-foreground" aria-live="polite">{formatLongDay(details.localDate)}</p>
            </div>
            <div className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor={`${id}-time`}>Time (optional)</Label>
                <Select value={details.startTime ?? NO_TIME} onValueChange={(v) => set("startTime", v === NO_TIME ? null : v)}>
                  <SelectTrigger id={`${id}-time`} className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_TIME}>No set time</SelectItem>
                    {[...new Set([...TIMES, ...(details.startTime ? [details.startTime] : [])])].sort().map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${id}-audience`}>Who is it for? (optional)</Label>
                <Input id={`${id}-audience`} maxLength={200} placeholder="e.g. Two engineers and a manager" value={details.audience} onChange={(e) => set("audience", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${id}-goal`}>The one sentence they should remember (optional)</Label>
                <Input id={`${id}-goal`} maxLength={500} value={details.goal} onChange={(e) => set("goal", e.target.value)} />
              </div>
            </div>
          </form>
        )}
        {save.error && <p role="alert" className="text-meta text-destructive">{save.error.message}</p>}
        <DialogFooter>
          {plan ? (
            <>
              <Button variant="outline" disabled={save.isPending} onClick={() => setPlan(null)}>Back</Button>
              <Button disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save event and plan"}</Button>
            </>
          ) : (
            <>
              <Button variant="outline" disabled={save.isPending} onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" form={`${id}-form`} disabled={!valid || save.isPending}>{event ? "Save changes" : "Create plan"}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
