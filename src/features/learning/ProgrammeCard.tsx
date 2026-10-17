import { Link } from "react-router";
import { Panel, SectionTitle } from "@/components/page";
import { Button } from "@/components/ui/button";
import { canAdvance, nextStep } from "@/lib/learning/programmes";
import { toLocalDate } from "@/lib/phrase-schedule";
import { useProgramme } from "./useProgramme";

/** While a programme runs, Today's aside shows its week and the next step (11.6). */
export function ProgrammeCard() {
  const { run, def, facts, events } = useProgramme();
  if (!run || !def) return null;
  const week = def.weeks.find((w) => w.week === run.week) ?? def.weeks[0];
  const next = facts && events ? nextStep(def, run, facts, events) : null;
  const ready = facts && events ? canAdvance(def, run, facts, events, toLocalDate(new Date())) : null;
  return (
    <Panel aria-labelledby="programme-heading">
      <SectionTitle id="programme-heading">{def.title}</SectionTitle>
      <p className="text-meta text-muted-foreground">
        Week {run.week} of {def.weeks.length} · {week.theme}
      </p>
      {ready?.ready ? (
        <p className="mt-2 text-meta">{ready.reason}</p>
      ) : (
        next && (
          <p className="mt-2">
            Next: {next.step.title}
            {next.auto && <span className="text-meta text-muted-foreground tabular-nums"> · {next.done} of {next.needed}</span>}
          </p>
        )
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {!ready?.ready && next?.step.link && (
          <Button variant="outline" size="sm" asChild>
            <Link to={next.step.link.to} state={{ section: "today" }}>{next.step.link.label}</Link>
          </Button>
        )}
        <Button variant="ghost" size="sm" asChild>
          <Link to="/exercises?tab=programmes">Open the programme</Link>
        </Button>
      </div>
    </Panel>
  );
}
