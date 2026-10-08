import { useNavigate } from "react-router";
import { ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toLocalDate } from "@/lib/phrase-schedule";
import { advanceSequence, loadSequence, saveSequence, stepUrl } from "./sequence";

/**
 * Step banner for today's sequence (4.10): where you are, and Next step or
 * Finish. Leaving the sequence keeps every saved take.
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
      <p className="text-meta">
        <span className="font-medium">Today's practice · step {state.index + 1} of {state.steps.length}</span>
        <span className="text-muted-foreground"> · {step.title} · about {step.minutes} min</span>
      </p>
      <div className="ml-auto flex gap-2">
        <Button variant="ghost" size="sm" disabled={locked} onClick={() => { saveSequence(null); navigate("/"); }}>
          Leave sequence
        </Button>
        <Button size="sm" disabled={locked} onClick={next}>
          {last ? <><Check aria-hidden /> Finish</> : <>Next step <ArrowRight aria-hidden /></>}
        </Button>
      </div>
    </div>
  );
}
