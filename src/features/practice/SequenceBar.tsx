import { useNavigate } from "react-router";
import { ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toLocalDate } from "@/lib/phrase-schedule";
import { cn } from "@/lib/utils";
import { advanceSequence, loadSequence, saveSequence, stepUrl } from "./sequence";

/** One dot per step (roadmap 8.9): done is filled with a check, current a ring, upcoming hollow. Not interactive. */
export function SequenceDots({ steps, index }: { steps: { title: string }[]; index: number }) {
  return (
    <ol className="flex items-center gap-1.5" aria-label="Steps">
      {steps.map((s, i) => {
        const state = i < index ? "done" : i === index ? "current" : "upcoming";
        return (
          <li
            key={i}
            aria-label={`Step ${i + 1} of ${steps.length}, ${s.title}, ${state}`}
            data-state={state}
            className={cn(
              "flex size-4 items-center justify-center rounded-full border",
              state === "done" && "border-primary bg-primary text-primary-foreground",
              state === "current" && "border-2 border-primary ring-2 ring-primary/25 ring-offset-1 ring-offset-background",
              state === "upcoming" && "border-muted-foreground/70",
            )}
          >
            {state === "done" && <Check aria-hidden className="size-2.5" strokeWidth={3} />}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Step banner for today's sequence (4.10): where you are, with a dot per step
 * (8.9), and Next step or Finish. Leaving the sequence keeps every saved take.
 */
export function SequenceBar({ sessionId, takeCount, locked }: { sessionId: string; takeCount: number; locked: boolean }) {
  const navigate = useNavigate();
  const state = loadSequence(toLocalDate(new Date()));
  if (!state) return null;
  const step = state.steps[state.index];
  const last = state.index === state.steps.length - 1;
  const next = () => {
    const advanced = advanceSequence(state, sessionId, takeCount > 0);
    if (advanced.index < advanced.steps.length) navigate(stepUrl(advanced.steps[advanced.index], advanced.localDate));
    else navigate("/practice/done", { state: { sessionIds: advanced.sessionIds, length: advanced.length } });
  };
  return (
    <div role="region" aria-label="Today's practice" className="flex flex-wrap items-center gap-3 rounded-panel border bg-secondary/40 px-4 py-3">
      <SequenceDots steps={state.steps} index={state.index} />
      <p className="text-meta">
        <span className="font-medium">Today's practice · step {state.index + 1} of {state.steps.length}</span>
        <span className="text-muted-foreground"> · {step.title} · about {step.minutes} min</span>
      </p>
      <div className="ml-auto flex gap-2">
        <Button variant="ghost" size="sm" disabled={locked} onClick={() => { saveSequence(null); navigate("/"); }}>
          Leave sequence
        </Button>
        {/* Solid only once this step has a take; before that, Record is the one primary. */}
        <Button size="sm" variant={takeCount > 0 ? "default" : "outline"} disabled={locked} onClick={next}>
          {last ? <><Check aria-hidden /> Finish</> : <>Next step <ArrowRight aria-hidden /></>}
        </Button>
      </div>
    </div>
  );
}
