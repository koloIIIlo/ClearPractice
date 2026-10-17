import { EvidenceLabel } from "@/components/evidence";
import { Panel } from "@/components/page";
import type { PracticeFacts } from "@/lib/ipc/schemas";
import { HESITATION_CHOICES, selfAwareness } from "@/lib/learning/predict";
import { cn } from "@/lib/utils";

/**
 * Progress → Profile → Self-awareness (roadmap 11.5): how your guesses about
 * hesitations matched the takes, as a count and a grid. Never a percentage;
 * shown once you have guessed on a transcribed take.
 */
export function SelfAwareness({ facts }: { facts: PracticeFacts }) {
  const s = selfAwareness(facts);
  if (s.compared === 0) return null;
  return (
    <Panel aria-labelledby="self-awareness-heading">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 id="self-awareness-heading" className="font-semibold">Self-awareness</h2>
        <span className="flex flex-wrap gap-1.5">
          <EvidenceLabel source="note" />
          <EvidenceLabel source="estimated" />
        </span>
      </div>
      <p>
        Your guesses matched {s.matched} of your last {s.compared} {s.compared === 1 ? "take" : "takes"}.
      </p>
      <p className="text-meta text-muted-foreground">Hesitations you guessed, against the estimate from each take. Matches sit on the shaded diagonal.</p>
      <table className="mt-3 text-meta tabular-nums">
        <caption className="sr-only">Guessed hesitations in rows, estimated hesitations in columns</caption>
        <thead>
          <tr>
            <th scope="col" className="pr-4 text-left font-medium text-muted-foreground">You guessed</th>
            {HESITATION_CHOICES.map((a) => (
              <th key={a.value} scope="col" className="px-3 py-1 font-medium">Estimated {a.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {HESITATION_CHOICES.map((g) => (
            <tr key={g.value}>
              <th scope="row" className="py-1 pr-4 text-left font-medium">{g.label}</th>
              {HESITATION_CHOICES.map((a) => (
                <td key={a.value} className={cn("px-3 py-1 text-center", g.value === a.value && "rounded-md bg-secondary font-semibold")}>
                  {s.grid[g.value][a.value]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
