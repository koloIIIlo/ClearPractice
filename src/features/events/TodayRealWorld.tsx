import { Link } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { capsulePrompt } from "@/lib/capsule";
import { isPast, whenText } from "@/lib/events/plan";
import { useIpc } from "@/lib/ipc";
import { keys, useCapsuleOffer, useEvents, usePracticeFacts, usePrompts } from "@/lib/ipc/queries";
import { toLocalDate } from "@/lib/phrase-schedule";
import { nextText } from "./EventsPage";
import { MissionCard } from "./MissionCard";

/** The next item of your soonest event, as information: no countdown and no red (14.2). */
function EventRow({ today }: { today: string }) {
  const events = useEvents();
  const view = events.data?.find((v) => !isPast(v, today));
  if (!view) return null;
  const next = nextText(view, today);
  return (
    <li className="flex flex-wrap items-start gap-4 px-4 py-4">
      <CalendarClock aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-1">
        <span className="font-medium">{view.event.title} {whenText(view.event.localDate, today)}</span>
        {next && <p>{next.charAt(0).toUpperCase() + next.slice(1)}</p>}
      </div>
      <Button variant="outline" size="sm" asChild>
        <Link to={`/events/${view.event.id}`}>Open the plan</Link>
      </Button>
    </li>
  );
}

/** The monthly time capsule (14.5): from the first app day of a month, for seven days. */
function CapsuleRow({ today }: { today: string }) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const offer = useCapsuleOffer(today);
  const facts = usePracticeFacts();
  const prompts = usePrompts();
  const dismiss = useMutation({
    mutationFn: (month: string) => ipc.dismissCapsule(month),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.capsule(today) }),
  });
  // Shown only when there is a first question to ask again.
  if (!offer.data?.show || !facts.data || !prompts.data || !capsulePrompt(facts.data, prompts.data)) return null;
  return (
    <li className="flex flex-wrap items-start gap-4 px-4 py-4">
      <History aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-1">
        <span className="font-medium">Time capsule</span>
        <p>Answer your first question again (about 2 minutes), then listen to then and now side by side.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" asChild>
          <Link to="/capsule">Record it</Link>
        </Button>
        <Button variant="ghost" size="sm" disabled={dismiss.isPending} onClick={() => dismiss.mutate(offer.data!.month)}>
          Not this month
        </Button>
      </div>
    </li>
  );
}

/** Real-world rows of This week on Today (M14): the mission, the next event item and the monthly capsule. */
export function TodayRealWorld() {
  const today = toLocalDate(new Date());
  return (
    <>
      <MissionCard />
      <EventRow today={today} />
      <CapsuleRow today={today} />
    </>
  );
}
