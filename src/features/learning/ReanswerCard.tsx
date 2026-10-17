import { Link } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EXERCISE_IDS } from "@/content/exercises";
import { useIpc } from "@/lib/ipc";
import { keys, usePracticeEvents, usePracticeFacts, usePrompts } from "@/lib/ipc/queries";
import { answeredAgo, dueReanswers, type Reanswer } from "@/lib/learning/reanswer";
import { toLocalDate } from "@/lib/phrase-schedule";

/** Re-answers due today or earlier, most overdue first (11.1); null until everything has loaded. */
export function useDueReanswers(): { due: Reanswer[] | null; today: string } {
  const facts = usePracticeFacts();
  const events = usePracticeEvents();
  const prompts = usePrompts();
  const today = toLocalDate(new Date());
  if (!facts.data || !events.data || !prompts.data) return { due: null, today };
  return { due: dueReanswers(facts.data, events.data, today, prompts.data), today };
}

/** The Studio with the same prompt, remembering the first answer for the comparison afterwards. */
export const reanswerHref = (r: Pick<Reanswer, "promptId" | "firstAttemptId">) =>
  `/practice/${EXERCISE_IDS.repeat}?prompt=${encodeURIComponent(r.promptId)}&reanswer=${encodeURIComponent(r.firstAttemptId)}`;

const capitalised = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * "Answer again" (roadmap 11.1): a question you answered 1, 7 or 30 days ago,
 * to answer once more and then hear both. Not this one records the skip with
 * no points, and that step doesn't come back.
 */
export function ReanswerRow({ item, today, section = "today" }: { item: Reanswer; today: string; section?: "today" | "exercises" }) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const skip = useMutation({
    mutationFn: () => ipc.skipReanswer(item.promptId, item.step),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.engagementEvents }),
  });
  return (
    <li className="flex flex-wrap items-start gap-4 px-4 py-4">
      <History aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-1">
        <span className="font-medium">Answer again</span>
        <p>{item.promptText}</p>
        <p className="text-meta text-muted-foreground">
          {capitalised(answeredAgo(item, today))}. Answering again after a gap, then listening to both, shows what changed.
        </p>
        {skip.error && <p role="alert" className="text-meta text-destructive">{skip.error.message}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" asChild>
          <Link to={reanswerHref(item)} state={{ section }}>Answer again</Link>
        </Button>
        <Button variant="ghost" size="sm" disabled={skip.isPending} onClick={() => skip.mutate()}>
          Not this one
        </Button>
      </div>
    </li>
  );
}

/** Today shows one re-answer at most: the most overdue, unless it is already this week's task. */
export function TodayReanswer({ except }: { except?: string }) {
  const { due, today } = useDueReanswers();
  const first = due?.find((r) => r.promptId !== except);
  return first ? <ReanswerRow item={first} today={today} /> : null;
}
