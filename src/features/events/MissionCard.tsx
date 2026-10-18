import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Compass } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { missionById } from "@/content/missions";
import { evalContext } from "@/lib/engagement/criteria";
import { areaActivity } from "@/lib/engagement/quests";
import { areaDef } from "@/lib/engagement/skills";
import { weekStart } from "@/lib/engagement/weekly";
import { DIFFICULTY_LABELS, leastPractised, missionOffers, recentMissions } from "@/lib/events/missions";
import { useIpc } from "@/lib/ipc";
import { keys, useMissionPick, usePracticeFacts, usePreferences, usePrompts } from "@/lib/ipc/queries";
import { toLocalDate } from "@/lib/phrase-schedule";

/** Where "I did it" leads: the reflection form with the mission preselected (14.1). */
export const missionReflectionHref = (missionId: string) => `/progress?view=real&mission=${encodeURIComponent(missionId)}`;

/**
 * This week's mission (roadmap 14.1), a row of This week on Today and Journey:
 * three offers, one of each difficulty, leaning toward the area you practised
 * least; Choose another and Skip this week. Once picked: how to do it and I
 * did it, which opens the reflection form with the mission preselected.
 */
export function MissionCard() {
  const ipc = useIpc();
  const qc = useQueryClient();
  const { preferences } = usePreferences();
  const today = toLocalDate(new Date());
  const week = weekStart(today, preferences.weekStartsOn);
  const pick = useMissionPick(week);
  const facts = usePracticeFacts();
  const prompts = usePrompts();
  const [round, setRound] = useState(0);
  const offers = useMemo(() => {
    if (!facts.data) return [];
    const activity = areaActivity(facts.data, today, evalContext(facts.data, today, prompts.data ?? []));
    return missionOffers(week, leastPractised(activity), round, recentMissions(facts.data, week));
  }, [facts.data, prompts.data, week, today, round]);
  const refresh = () => qc.invalidateQueries({ queryKey: keys.missionPick(week) }).then(() => qc.invalidateQueries({ queryKey: keys.facts }));
  const choose = useMutation({ mutationFn: (missionId: string | null) => ipc.pickMission(week, missionId), onSuccess: refresh });
  const clear = useMutation({ mutationFn: () => ipc.clearMission(week), onSuccess: refresh });
  const error = choose.error ?? clear.error;

  if (pick.isPending) return null;
  const current = pick.data ?? null;
  const mission = missionById(current?.missionId);
  return (
    <li className="flex flex-wrap items-start gap-4 px-4 py-4" aria-label="This week's mission">
      <Compass aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-2">
        {current?.doneAt && mission ? (
          <>
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-medium">Mission done</span>
              <Check aria-hidden className="size-4 text-primary" />
            </p>
            <p>{mission.title}</p>
            <p className="text-meta text-muted-foreground">
              Logged with your reflection. <Link className="text-primary underline underline-offset-2" to="/progress?view=real">See your reflections</Link>
            </p>
          </>
        ) : current && mission ? (
          <>
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-medium">This week's mission</span>
              <Badge variant="outline">{DIFFICULTY_LABELS[mission.difficulty]}</Badge>
              <Badge variant="outline">{areaDef(mission.area).short}</Badge>
            </p>
            <p>{mission.title}</p>
            <p className="text-meta text-muted-foreground">{mission.how}</p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button size="sm" asChild>
                <Link to={missionReflectionHref(mission.id)}>I did it</Link>
              </Button>
              <Button size="sm" variant="ghost" disabled={clear.isPending} onClick={() => clear.mutate()}>
                Choose a different one
              </Button>
            </div>
          </>
        ) : current ? (
          <>
            <span className="font-medium">No mission this week</span>
            <p className="text-meta text-muted-foreground">You skipped it. Missions come back next week.</p>
            <Button size="sm" variant="outline" disabled={clear.isPending} onClick={() => clear.mutate()}>
              Choose one after all
            </Button>
          </>
        ) : (
          <>
            <span className="font-medium">Mission</span>
            <p className="text-meta text-muted-foreground">One small challenge in a real conversation this week, logged with a reflection. Pick one, or skip the week.</p>
            {offers.length > 0 && (
              <ul className="space-y-2" aria-label="Missions to choose from">
                {offers.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p>{m.title}</p>
                      <p className="text-meta text-muted-foreground">
                        {DIFFICULTY_LABELS[m.difficulty]} · {areaDef(m.area).short}
                      </p>
                    </div>
                    <Button size="sm" variant="outline" disabled={choose.isPending} onClick={() => choose.mutate(m.id)} aria-label={`Pick “${m.title}”`}>
                      Pick
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={() => setRound((r) => r + 1)}>Choose another</Button>
              <Button size="sm" variant="ghost" disabled={choose.isPending} onClick={() => choose.mutate(null)}>Skip this week</Button>
            </div>
          </>
        )}
        {error && <p role="alert" className="text-meta text-destructive">{error.message}</p>}
      </div>
    </li>
  );
}
