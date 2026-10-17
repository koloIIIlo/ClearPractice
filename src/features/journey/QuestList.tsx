import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIpc } from "@/lib/ipc";
import { swapCandidate } from "@/lib/engagement/quests";
import type { Journey, QuestView } from "./useJourney";

/**
 * This week's three quests (roadmap 9.9): a state icon (not an input), the
 * title, progress and one swap a week. The reason is in a tooltip and a
 * visible "Why?" disclosure for keyboard users.
 */
export function QuestList({ journey, compact = false }: { journey: Journey; compact?: boolean }) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const swap = useMutation({
    meta: { engagement: "manual" },
    mutationFn: (q: QuestView) => {
      const candidate = swapCandidate(q.slot, journey.quests, journey.facts, journey.state.quests, journey.week);
      if (!candidate) throw new Error("No other quest is available this week.");
      return ipc.swapWeeklyQuest(journey.week, q.slot, candidate);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["engagement"] }),
  });
  if (journey.quests.length === 0) return <p className="text-meta text-muted-foreground">This week's quests appear after a moment.</p>;
  return (
    <div className="space-y-1">
      <ul className="divide-y">
        {journey.quests.map((q) => {
          const done = q.completedAt !== null || q.met;
          return (
            <li key={q.slot} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              {done ? <CheckCircle2 aria-hidden className="size-5 text-primary" /> : <Circle aria-hidden className="size-5 text-muted-foreground" />}
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="min-w-0 flex-1">
                    <span className="sr-only">{done ? "Done: " : "To do: "}</span>
                    {q.title}
                  </span>
                </TooltipTrigger>
                <TooltipContent>{q.reason}</TooltipContent>
              </Tooltip>
              <span className="text-meta text-muted-foreground tabular-nums">{done ? "done · +30 XP" : `${q.done} of ${q.needed}`}</span>
              {!compact && (
                <>
                  <details className="w-full text-meta text-muted-foreground sm:w-auto">
                    <summary className="cursor-pointer">Why?</summary>
                    <p className="mt-1">{q.reason}</p>
                  </details>
                  <Button variant="ghost" size="sm" disabled={done || journey.swapsLeft === 0 || swap.isPending} onClick={() => swap.mutate(q)} aria-label={`Swap ${q.title}`}>
                    <Shuffle aria-hidden /> Swap
                  </Button>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {!compact && (
        <p className="text-meta text-muted-foreground">
          {journey.swapsLeft > 0 ? "Swap (1 left this week)" : "This week's swap is used"} · quests reset each week
        </p>
      )}
      {swap.error && <p role="alert" className="text-meta text-destructive">{swap.error.message}</p>}
    </div>
  );
}
