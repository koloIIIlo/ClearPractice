import { Link } from "react-router";
import { EvidenceLabel } from "@/components/evidence";
import { formatDay } from "@/lib/format";
import { RECORDS } from "@/lib/engagement/records";
import type { Journey } from "./useJourney";

/**
 * Personal bests against your own past (roadmap 9.7): value, date and a link
 * to the take. A record whose take was deleted keeps its value.
 */
export function RecordsList({ journey }: { journey: Journey }) {
  const takes = new Map(journey.facts.takes.map((t) => [t.id, t]));
  const rows = RECORDS.flatMap((def) => {
    const best = journey.records.get(def.id);
    return best ? [{ def, best, history: journey.state.records.filter((r) => r.record === def.id) }] : [];
  });
  if (rows.length === 0) return <p className="text-meta text-muted-foreground">Your first takes set your starting points. Beating one becomes a record.</p>;
  return (
    <ul className="divide-y">
      {rows.map(({ def, best, history }) => {
        const take = best.attemptId ? takes.get(best.attemptId) : undefined;
        return (
          <li key={def.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2">
            <span className="min-w-0 flex-1">{def.title}</span>
            <span className="font-medium tabular-nums">{def.format(best.value)}</span>
            <span className="text-meta text-muted-foreground">
              {formatDay(best.achievedAt.slice(0, 10))}
              {best.previous !== null && ` (previous ${def.format(best.previous)})`}
              {" · "}
              {take ? <Link className="text-primary underline underline-offset-2" to={`/sessions/${take.sessionId}/attempt/${take.ordinal}`}>the take</Link> : "take deleted"}
            </span>
            <EvidenceLabel source={def.source} />
            {history.length > 1 && (
              <details className="w-full text-meta text-muted-foreground">
                <summary className="cursor-pointer">History</summary>
                <ol className="mt-1 flex flex-wrap gap-x-3">
                  {history.map((h) => <li key={h.id} className="tabular-nums">{def.format(h.value)} · {formatDay(h.achievedAt.slice(0, 10))}</li>)}
                </ol>
              </details>
            )}
          </li>
        );
      })}
    </ul>
  );
}
