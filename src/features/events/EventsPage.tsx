import { useState } from "react";
import { Link } from "react-router";
import { CalendarClock, Check, Circle, Plus, Projector } from "lucide-react";
import { EmptyState, LoadingBlock, Page, PageHeader, Panel, QueryView, SectionTitle } from "@/components/page";
import { Button } from "@/components/ui/button";
import { isPast, itemMinutes, KIND_LABELS, nextItem, whenText } from "@/lib/events/plan";
import { formatClock, formatDay } from "@/lib/format";
import { useEvents, useTalks } from "@/lib/ipc/queries";
import type { EventView } from "@/lib/ipc/schemas";
import { toLocalDate } from "@/lib/phrase-schedule";
import { EventForm } from "./EventForm";

/** "today: run-through 2 (20 min)", or the next item and its day. */
export function nextText(view: EventView, today: string): string | null {
  const next = nextItem(view, today);
  if (!next) return null;
  const minutes = itemMinutes(next.item.kind, view.event.minutes);
  const what = `${next.item.title.charAt(0).toLowerCase()}${next.item.title.slice(1)}${minutes !== null ? ` (${minutes} min)` : ""}`;
  return next.due ? `today: ${what}` : `next: ${what} on ${formatDay(next.item.localDate)}`;
}

function UpcomingEvent({ view, today }: { view: EventView; today: string }) {
  const { event } = view;
  const next = nextText(view, today);
  return (
    <li className="space-y-2 px-4 py-4">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <Link to={`/events/${event.id}`} className="font-medium hover:underline">{event.title}</Link>
        <span className="text-meta text-muted-foreground">
          {KIND_LABELS[event.kind]} · {formatDay(event.localDate)} · {whenText(event.localDate, today)}
        </span>
      </div>
      {next && <p className="first-letter:uppercase">{next}</p>}
      {view.items.length > 0 && (
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-meta text-muted-foreground" aria-label={`Plan for ${event.title}`}>
          {view.items.map((item) => (
            <li key={item.id} className="inline-flex items-center gap-1">
              {item.doneAt ? <Check aria-hidden className="size-3.5 text-primary" /> : <Circle aria-hidden className="size-3.5" />}
              <span className="sr-only">{item.doneAt ? "Done:" : "To do:"}</span>
              {item.title}
            </li>
          ))}
        </ul>
      )}
      <Button size="sm" variant="outline" asChild><Link to={`/events/${event.id}`}>Open</Link></Button>
    </li>
  );
}

/**
 * Events (roadmap 14.2): real talks, interviews, meetings, toasts and pitches
 * you prepare for with a plan spread over the days before, your talks (14.3),
 * and past events.
 */
export function EventsPage() {
  const events = useEvents();
  const talks = useTalks();
  const [creating, setCreating] = useState(false);
  const today = toLocalDate(new Date());
  return (
    <Page>
      <PageHeader
        title="Events"
        description="Prepare for a real talk, interview, meeting, toast or pitch. Practice is spread over the days before it, and a debrief comes after."
        actions={
          <>
            <Button variant="outline" asChild><Link to="/events/talks/new"><Projector aria-hidden /> Build a talk</Link></Button>
            <Button onClick={() => setCreating(true)}><Plus aria-hidden /> New event</Button>
          </>
        }
      />
      <div className="space-y-8">
        <QueryView query={events} loading={<LoadingBlock rows={3} label="Loading events" />}>
          {(list) => {
            const upcoming = list.filter((v) => !isPast(v, today));
            const past = list.filter((v) => isPast(v, today)).reverse();
            return (
              <>
                <section aria-labelledby="events-upcoming">
                  <SectionTitle id="events-upcoming">Coming up</SectionTitle>
                  {upcoming.length === 0 ? (
                    <EmptyState icon={CalendarClock} title="No events coming up" action={<Button onClick={() => setCreating(true)}><Plus aria-hidden /> New event</Button>}>
                      Add the day of a real talk or interview, and the app spreads your preparation over the days before it.
                    </EmptyState>
                  ) : (
                    <ul className="divide-y rounded-panel border bg-card">
                      {upcoming.map((v) => <UpcomingEvent key={v.event.id} view={v} today={today} />)}
                    </ul>
                  )}
                </section>
                {past.length > 0 && (
                  <section aria-labelledby="events-past">
                    <SectionTitle id="events-past">Past events</SectionTitle>
                    <ul className="divide-y rounded-panel border bg-card">
                      {past.map((v) => (
                        <li key={v.event.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                          <span className="min-w-0 flex-1">
                            <span className="font-medium">{v.event.title}</span>
                            <span className="text-meta text-muted-foreground"> · {formatDay(v.event.localDate)} · {v.debriefDone ? "debrief written" : "no debrief"}</span>
                          </span>
                          <Button size="sm" variant="outline" asChild><Link to={`/events/${v.event.id}`}>Open</Link></Button>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            );
          }}
        </QueryView>
        <Panel aria-labelledby="events-talks">
          <SectionTitle id="events-talks" action={<Button size="sm" variant="ghost" asChild><Link to="/events/talks/new">Build a talk</Link></Button>}>Your talks</SectionTitle>
          {talks.data && talks.data.length === 0 && (
            <p className="text-meta text-muted-foreground">An outline with cue cards and a timed rehearsal report. Start from a template: Classic, Story, STAR answer, Pitch, Toast or Update.</p>
          )}
          {!!talks.data?.length && (
            <ul className="divide-y">
              {talks.data.map((t) => (
                <li key={t.talk.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="min-w-0 flex-1">
                    <Link to={`/events/talks/${t.talk.id}`} className="font-medium hover:underline">{t.talk.title}</Link>
                    <span className="text-meta text-muted-foreground"> · {t.sections.length} {t.sections.length === 1 ? "section" : "sections"} · {formatClock(t.targetSeconds * 1000)} · {t.rehearsals} {t.rehearsals === 1 ? "rehearsal" : "rehearsals"}</span>
                  </span>
                  <Button size="sm" variant="outline" asChild><Link to={`/events/talks/${t.talk.id}/rehearse`}>Rehearse</Link></Button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      {creating && <EventForm open={creating} onOpenChange={setCreating} />}
    </Page>
  );
}
