import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Check, Circle, Pencil, Plus, Trash2 } from "lucide-react";
import { EmptyState, LoadingBlock, Page, PageHeader, Panel, QueryView, SectionTitle } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BOSSES } from "@/content/bosses";
import { talkTemplate, templateForEvent } from "@/content/talk-templates";
import { daysBetween, ITEM_LABELS, itemMinutes, KIND_LABELS, nextItem, whenText, type PlanItem } from "@/lib/events/plan";
import { formatClock, formatDay, formatLongDay } from "@/lib/format";
import { IpcError, useIpc } from "@/lib/ipc";
import { keys, useEvent, useTalk } from "@/lib/ipc/queries";
import { EventItemKind, type EventPlanItem, type EventView } from "@/lib/ipc/schemas";
import { addLocalDays, toLocalDate } from "@/lib/phrase-schedule";
import { cn } from "@/lib/utils";
import { EventForm, PlanRows } from "./EventForm";

/** The mock scenario of an interview or a meeting (13.x), and the Q&A drill's boss (10.13). */
const MOCK_SCENARIOS: Partial<Record<string, string>> = { interview: "job-interview", meeting: "meeting-update" };
const QA_BOSS: Record<string, string> = { interview: "job-interview", meeting: "meeting", toast: "toast" };

/** Where an item's action leads (14.2). */
function itemAction(item: EventPlanItem, view: EventView): { label: string; to: string } | null {
  const { event } = view;
  const talk = event.talkId;
  switch (item.kind) {
    case "outline":
      return talk ? { label: "Open the outline", to: `/events/talks/${talk}` } : null;
    case "run_through":
    case "dress_rehearsal":
      return talk ? { label: "Rehearse", to: `/events/talks/${talk}/rehearse?event=${event.id}` } : { label: "Rehearse", to: `/events/talks/new?event=${event.id}&template=${templateForEvent(event.kind)}` };
    case "qa_drill": {
      const boss = BOSSES.find((b) => b.id === (QA_BOSS[event.kind] ?? "skeptical-qa")) ?? BOSSES[0];
      return { label: "Q&A drill", to: `/drill/boss?boss=${boss.id}` };
    }
    case "mock":
      return { label: "Start the mock", to: `/partner?scenario=${MOCK_SCENARIOS[event.kind] ?? "job-interview"}` };
    case "routine":
      return { label: "Start the routine", to: `/confidence/routine?event=${event.id}` };
    case "debrief":
      return { label: "Write the debrief", to: `/progress?view=real&form=aar&event=${event.id}` };
  }
}

/** An item's state in words: done, today, or when. No countdown and no red (14.2). */
function itemState(item: EventPlanItem, today: string): string {
  if (item.doneAt) return item.byHand ? "Done (ticked by you)" : "Done";
  if (item.localDate === today) return "Today";
  if (item.localDate < today) return `Was planned for ${formatDay(item.localDate)}`;
  return formatDay(item.localDate);
}

/** Builds the event's outline from the template for its kind, links it and opens the builder. */
function useBuildOutline(view: EventView) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: async () => {
      const template = talkTemplate(templateForEvent(view.event.kind))!;
      const talk = await ipc.saveTalk({
        title: view.event.title, template: template.id,
        sections: template.sections.map((s) => ({ title: s.title, keywords: [], notes: "", targetSeconds: s.targetSeconds })),
      });
      await ipc.linkEventTalk(view.event.id, talk.talk.id);
      return talk;
    },
    onSuccess: async (talk) => {
      await qc.invalidateQueries({ queryKey: keys.realEvents });
      await qc.invalidateQueries({ queryKey: keys.talks });
      navigate(`/events/talks/${talk.talk.id}`);
    },
  });
}

function PlanItemRow({ item, view, today }: { item: EventPlanItem; view: EventView; today: string }) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const action = itemAction(item, view);
  const build = useBuildOutline(view);
  const tick = useMutation({
    mutationFn: (done: boolean) => ipc.setPlanItemDone(item.id, done),
    onSuccess: (next) => qc.setQueryData(keys.realEvent(view.event.id), next),
  });
  const minutes = itemMinutes(item.kind, view.event.minutes);
  const done = !!item.doneAt;
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      {done ? <Check aria-hidden className="size-5 shrink-0 text-primary" /> : <Circle aria-hidden className="size-5 shrink-0 text-muted-foreground" />}
      <div className="min-w-0 flex-1">
        <p className={cn("font-medium", done && "text-muted-foreground")}>
          {item.title}
          {minutes !== null && <span className="font-normal text-muted-foreground"> · {minutes} min</span>}
        </p>
        <p className="text-meta text-muted-foreground">{itemState(item, today)}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {!done && item.kind === "outline" && !view.event.talkId ? (
          <Button size="sm" disabled={build.isPending} onClick={() => build.mutate()}>Build the outline</Button>
        ) : (
          !done && action && <Button size="sm" variant={item.localDate <= today ? "default" : "outline"} asChild><Link to={action.to}>{action.label}</Link></Button>
        )}
        <Button size="sm" variant="ghost" disabled={tick.isPending} aria-label={done ? `Mark ${item.title} as not done` : `Mark ${item.title} as done`} onClick={() => tick.mutate(!done)}>
          {done ? "Not done" : "Mark done"}
        </Button>
      </div>
      {(tick.error || build.error) && <p role="alert" className="w-full text-meta text-destructive">{(tick.error ?? build.error)!.message}</p>}
    </li>
  );
}

/** Changes the items that aren't done: their days, removing them, or adding one. */
function EditPlan({ view, onDone }: { view: EventView; onDone: () => void }) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const today = toLocalDate(new Date());
  const [items, setItems] = useState<PlanItem[]>(() => view.items.filter((i) => !i.doneAt).map((i) => ({ position: i.position, localDate: i.localDate, kind: i.kind, title: i.title })));
  const [kind, setKind] = useState<EventItemKind>("run_through");
  const save = useMutation({
    mutationFn: () => ipc.saveEventPlan(view.event.id, items),
    onSuccess: (next) => {
      qc.setQueryData(keys.realEvent(view.event.id), next);
      void qc.invalidateQueries({ queryKey: keys.realEvents });
      onDone();
    },
  });
  const add = () => setItems((list) => [...list, { position: list.length + 1, localDate: today > view.event.localDate ? today : addLocalDays(view.event.localDate, -1) < today ? today : addLocalDays(view.event.localDate, -1), kind, title: ITEM_LABELS[kind] }]);
  return (
    <div className="space-y-3">
      <p className="text-meta text-muted-foreground">Done items stay as they are.</p>
      {items.length > 0 ? <PlanRows items={items} onChange={setItems} /> : <p className="text-muted-foreground">No open items.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={kind} onValueChange={(v) => setKind(v as EventItemKind)}>
          <SelectTrigger aria-label="Kind of item to add" className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>{EventItemKind.options.map((k) => <SelectItem key={k} value={k}>{ITEM_LABELS[k]}</SelectItem>)}</SelectContent>
        </Select>
        <Button variant="outline" onClick={add}><Plus aria-hidden /> Add</Button>
        <span className="flex-1" />
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
        <Button disabled={save.isPending} onClick={() => save.mutate()}>Save the plan</Button>
      </div>
      {save.error && <p role="alert" className="text-meta text-destructive">{save.error.message}</p>}
    </div>
  );
}

function TalkPanel({ talkId }: { talkId: string }) {
  const talk = useTalk(talkId);
  if (!talk.data) return null;
  const t = talk.data;
  return (
    <Panel aria-labelledby="event-talk">
      <SectionTitle id="event-talk">Your outline</SectionTitle>
      <p className="font-medium">{t.talk.title}</p>
      <p className="text-meta text-muted-foreground">
        {t.sections.length} {t.sections.length === 1 ? "section" : "sections"} · {formatClock(t.targetSeconds * 1000)} in total · {t.rehearsals} {t.rehearsals === 1 ? "rehearsal" : "rehearsals"}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" asChild><Link to={`/events/talks/${talkId}`}>Open</Link></Button>
        <Button size="sm" variant="outline" asChild><Link to={`/events/talks/${talkId}/cards`}>Cue cards</Link></Button>
        {t.rehearsals > 0 && <Button size="sm" variant="outline" asChild><Link to={`/events/talks/${talkId}/reports`}>Reports</Link></Button>}
      </div>
    </Panel>
  );
}

function EventDetail({ view }: { view: EventView }) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const today = toLocalDate(new Date());
  const [editing, setEditing] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const remove = useMutation({
    mutationFn: () => ipc.deleteEvent(view.event.id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: keys.realEvents });
      navigate("/events");
    },
  });
  const { event } = view;
  const next = nextItem(view, today);
  const days = daysBetween(today, event.localDate);
  return (
    <>
      <PageHeader
        meta={KIND_LABELS[event.kind]}
        title={event.title}
        description={`${formatLongDay(event.localDate)}${event.startTime ? `, ${event.startTime}` : ""} · ${whenText(event.localDate, today)}${event.minutes ? ` · ${event.minutes} min` : ""}`}
        actions={
          <>
            <Button variant="outline" onClick={() => setEditing(true)}><Pencil aria-hidden /> Change</Button>
            <Button variant="ghost" className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onClick={() => setConfirm(true)}><Trash2 aria-hidden /> Delete</Button>
          </>
        }
      />
      {confirm && (
        <p role="alert" className="mb-6 flex flex-wrap items-center gap-2 rounded-panel border px-4 py-3">
          Delete this event and its plan? Your outline and rehearsal takes stay.
          <Button size="sm" variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>Delete</Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Keep</Button>
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-labelledby="plan-heading" className="space-y-3">
          <SectionTitle id="plan-heading" action={!planning && <Button size="sm" variant="ghost" onClick={() => setPlanning(true)}>Change the plan</Button>}>
            {next?.due ? `Today: ${next.item.title}` : "Plan"}
          </SectionTitle>
          {planning ? (
            <EditPlan view={view} onDone={() => setPlanning(false)} />
          ) : view.items.length === 0 ? (
            <EmptyState title="No plan items">Change the plan to add practice before the day.</EmptyState>
          ) : (
            <ol className="divide-y rounded-panel border bg-card">
              {view.items.map((item) => <PlanItemRow key={item.id} item={item} view={view} today={today} />)}
            </ol>
          )}
          <p className="text-meta text-muted-foreground">Items tick themselves when you do their practice. You can tick or untick any item yourself.</p>
        </section>
        <aside className="space-y-6">
          {(event.audience || event.goal) && (
            <Panel>
              {event.audience && <p><span className="text-meta text-muted-foreground">For</span><br />{event.audience}</p>}
              {event.goal && <p className="mt-3"><span className="text-meta text-muted-foreground">The one sentence they should remember</span><br />{event.goal}</p>}
            </Panel>
          )}
          {event.talkId && <TalkPanel talkId={event.talkId} />}
          {days < 0 && !view.debriefDone && (
            <Panel>
              <p>How did it go? A debrief closes the event.</p>
              <Button className="mt-3" asChild><Link to={`/progress?view=real&form=aar&event=${event.id}`}>Write the debrief</Link></Button>
            </Panel>
          )}
        </aside>
      </div>
      {editing && <EventForm open={editing} onOpenChange={setEditing} event={event} />}
    </>
  );
}

/** One event and its plan (roadmap 14.2): a timeline of items, each with its action. */
export function EventPage() {
  const { eventId } = useParams();
  const view = useEvent(eventId);
  if (view.error instanceof IpcError && view.error.code === "not_found") {
    return (
      <Page>
        <EmptyState icon={CalendarClock} title="This event isn't available" action={<Button variant="outline" asChild><Link to="/events">Back to events</Link></Button>}>
          It may have been deleted.
        </EmptyState>
      </Page>
    );
  }
  return (
    <Page>
      <QueryView query={view} loading={<LoadingBlock rows={4} label="Loading the event" />}>
        {(v) => <EventDetail view={v} />}
      </QueryView>
    </Page>
  );
}
