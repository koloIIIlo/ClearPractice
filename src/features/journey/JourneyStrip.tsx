import { Link, useNavigate } from "react-router";
import { startSprint } from "@/features/learning/sprint";
import { Panel } from "@/components/page";
import { Button } from "@/components/ui/button";
import { usePreferences } from "@/lib/ipc/queries";
import { areaDef } from "@/lib/engagement/skills";
import { areaActivity } from "@/lib/engagement/quests";
import { areaSuggestion } from "@/lib/engagement/suggestion";
import { freshStartNote } from "@/lib/engagement/fresh-start";
import { usePracticeStyle } from "@/features/engagement/style";
import { Companion } from "./Companion";
import { nextStep } from "./SkillMap";
import { QuestList } from "./QuestList";
import { useJourney } from "./useJourney";
import { WeekGoal } from "./WeekGoal";

/**
 * "Journey this week" on Today (roadmap 9.14; named apart from the plan's own "This week"), Playful style only: the goal, the
 * quests and the level closest to done, with a way into Journey.
 */
export function JourneyStrip() {
  const navigate = useNavigate();
  const { playful } = usePracticeStyle();
  const { preferences } = usePreferences();
  const { journey } = useJourney();
  if (!playful || !journey) return null;
  const next = journey.next ? journey.areas.find((a) => a.area === journey.next!.area) : null;
  const note = freshStartNote(journey.events, journey.today, preferences.weekStartsOn);
  const suggestion = journey.facts.takes.length > 0 ? areaSuggestion(journey.areas, areaActivity(journey.facts, journey.today, journey.ctx)) : null;
  return (
    <Panel className="space-y-3 p-4" aria-labelledby="this-week">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 id="this-week" className="font-semibold">Journey this week</h2>
          <WeekGoal days={journey.goal.days} goal={journey.goal.goal} weeksInARow={journey.goal.weeksInARow} xp={journey.xp.week} compact />
        </div>
        {preferences.companion && <Companion stage={journey.stage} size={48} />}
      </div>
      {note && <p className="text-meta text-muted-foreground">{note.text}</p>}
      <QuestList journey={journey} compact />
      {next && (
        <p className="text-meta">
          Next:{" "}
          <Link className="text-primary underline underline-offset-2 hover:no-underline" to={`/journey?area=${next.area}`}>
            {areaDef(next.area).short} {next.next?.level} · {nextStep(next).label}
          </Link>
        </p>
      )}
      {suggestion && (
        <div className="space-y-2 text-meta">
          <p>
            <Link className="text-primary underline underline-offset-2 hover:no-underline" to={suggestion.to}>{suggestion.text}</Link>
            <span className="block text-muted-foreground">{suggestion.reason}</span>
          </p>
          {/* A five-minute set aimed at that area (11.8). */}
          <Button variant="outline" size="sm" onClick={() => startSprint(navigate, suggestion.area, journey.areas.find((a) => a.area === suggestion.area)?.current ?? 0)}>
            5-minute sprint
          </Button>
        </div>
      )}
      <Button variant="outline" size="sm" asChild><Link to="/journey">Open Journey</Link></Button>
    </Panel>
  );
}
