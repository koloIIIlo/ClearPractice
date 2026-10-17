import { Sparkles, Star, TrendingUp } from "lucide-react";
import { Panel } from "@/components/page";
import { usePreferences } from "@/lib/ipc/queries";
import { ACHIEVEMENTS } from "@/lib/engagement/achievements";
import { areaDef, LEVELS } from "@/lib/engagement/skills";
import type { AreaId } from "@/lib/engagement/types";
import { earnedToday } from "@/features/engagement/EngagementProvider";
import { recordLine } from "@/features/engagement/celebrations";
import { usePracticeStyle } from "@/features/engagement/style";
import { Companion } from "./Companion";
import { useJourney } from "./useJourney";

/**
 * "Today you earned" on Practice complete (roadmap 9.14), Playful style only:
 * today's XP and the week, then any level, achievement or record of today.
 */
export function EarnedToday() {
  const { playful } = usePracticeStyle();
  const { preferences } = usePreferences();
  const { journey } = useJourney();
  if (!playful || !journey) return null;
  const today = earnedToday(journey.events, journey.state, journey.today);
  return (
    <Panel aria-labelledby="earned-today" className="space-y-2">
      <h2 id="earned-today" className="font-semibold">Today you earned</h2>
      <p className="tabular-nums">
        +{today.xp} XP · Week: {Math.min(journey.goal.days, journey.goal.goal)} of {journey.goal.goal} days{journey.goal.met ? ", goal reached" : ""}
      </p>
      <ul className="space-y-1">
        {today.levels.map((l) => (
          <li key={`${l.area}-${l.level}`} className="flex items-center gap-2">
            <Sparkles aria-hidden className="size-4 text-primary" /> {areaDef(l.area as AreaId).short} reached level {l.level} · {LEVELS[l.area as AreaId][l.level - 1].name}
          </li>
        ))}
        {today.achievements.map((a) => (
          <li key={a.id} className="flex items-center gap-2">
            <Star aria-hidden className="size-4 text-primary" /> {ACHIEVEMENTS.find((d) => d.id === a.id)?.title ?? a.id}
          </li>
        ))}
        {today.records.map((r) => (
          <li key={r.id} className="flex items-center gap-2">
            <TrendingUp aria-hidden className="size-4 text-primary" /> {recordLine(r, journey.state.records)}
          </li>
        ))}
      </ul>
      {preferences.companion && journey.stage > 0 && (
        <div className="flex items-center gap-2 text-meta text-muted-foreground">
          <Companion stage={journey.stage} size={48} /> Sprout grows with your practice days.
        </div>
      )}
    </Panel>
  );
}
